---
title: "Distributed Rate Limiter: Design and Failure Behavior"
description: "A practical design for low-latency request limits, burst handling, route policies, and explicit failure behavior."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Problem

An API gateway needs a decision before it invokes application code: **may this principal consume one unit of quota now?** A principal may be a user, source IP, API key, or OAuth token. The applicable policy may vary by route, HTTP method, tenant plan, and region.

The limiter must support a token bucket for a refill rate with controlled bursts, and a sliding window when a product needs a hard count over an interval. A rejected request returns HTTP `429 Too Many Requests` with a useful `Retry-After` value. Policy changes must reach gateways without a restart.

The callers are API gateways and internal services. Platform and product teams operate the service. Because the limiter is on the synchronous request path, latency, availability, counter semantics, scaling, clock behavior, and failure safety are the important constraints.

### Requirements [SOURCE FACT]

| Requirement | Target |
|---|---|
| Decision latency | p99 under 1 ms at the gateway, excluding network time to the origin |
| Decision availability | 99.99% monthly for the limiter path |
| Counter semantics | One global logical counter per key and policy, with bounded and documented cross-region staleness |
| Scaling | No permanently central hotspot; shard ownership horizontally |
| Clock behavior | Correctness must not depend on synchronized wall clocks |
| Safety | A limiter outage must not silently become unlimited expensive traffic |

### Design direction [ANALYSIS]

Separate the fast decision plane from the slower control plane. Treat `fail-open` and `fail-closed` as explicit policy choices, not as accidental consequences of a timeout. The right choice can differ by endpoint: an expensive operation may fail closed, while a low-risk read may have a bounded fail-open path.

## 2. Capacity Estimate

The following is an illustrative capacity model, not an observed production measurement. Replace the assumptions with service telemetry before provisioning.

### Illustrative assumptions [ANALYSIS]

- 10 million daily active users (DAU).
- 100 API requests per active user per day.
- A 10x peak multiplier for launch traffic and daily concentration.
- 30% capacity headroom.
- 20% of decisions come from API keys or service tokens that are not represented by a user session. This traffic is included in the estimate, not added twice.
- A 90:10 allow-to-reject ratio at peak.
- 500 million active keys, two replicas, and 40 bytes of token-bucket state per key before indexes and memory overhead.
- 2.5x memory overhead, 24-hour idle-bucket expiry, and a 100-byte compact audit/event record per decision.
- Seven-day event retention with compressed data at 30% of raw size.
- 100,000 policies at 1 KB each and 5% daily key growth.

### Calculation [ANALYSIS]

The assumptions produce `10,000,000 x 100 = 1,000,000,000` decisions per day. Dividing by 86,400 seconds gives `11,574` decisions per second on average. Applying the illustrative 10x peak gives `115,740` decisions per second; adding 30% headroom gives a planning target of approximately `150,000` decisions per second.

At that peak, a 90:10 allow-to-reject ratio implies approximately `135,000` allows per second and `15,000` rejects per second. Each decision reads a counter and usually performs a small atomic update, so the decision-plane read-to-write ratio is approximately `1:1`. Cached policy reads are outside this path.

For the token bucket, `500,000,000 x 40 x 2 = 40 GB` of hot state before index and memory overhead. Applying the illustrative 2.5x overhead gives a reservation of 100 GB of usable in-memory capacity. Expiring an idle bucket after 24 hours is an activity TTL; it is not a clock used for correctness.

At peak, `150,000 x 100 = 15 MB/s` of uncompressed event data is approximately `1.296 TB/day`. Keep detailed decision events sampled, while retaining counters and all rejects. At the illustrative 30% compressed size, seven days of retention is approximately `1.296 TB x 7 x 0.3 = 2.72 TB`.

The policy configuration is approximately 100 MB before replication and cache overhead (`100,000 x 1 KB`). With 5% daily key growth, active state would move from 500 million to approximately 525 million keys after one day if expiry did not offset growth. A 99.99% monthly availability target corresponds to approximately 4.4 minutes in a 30-day month. The p99 latency target must be much tighter than this availability budget: a slow limiter can exhaust origin connections or threads before it is formally unavailable.

## 3. API Design

### Decision endpoint [PROPOSED DESIGN]

The gateway sends a stable request identity. Authenticate gateway-to-limiter traffic with mTLS. Do not trust a caller-supplied tenant identifier unless the gateway identity and its authorization are validated.

```http
POST /v1/decisions
Authorization: mTLS
Content-Type: application/json
X-Request-Id: 01J...
Idempotency-Key: gateway-01J...-attempt-1

{
  "principal_type": "api_key",
  "principal_id": "key_7f3",
  "route": "POST:/v1/payments",
  "region": "sg",
  "cost": 1
}
```

An allowed response is:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"allowed":true,"remaining":39,"limit":40,"reset_at":"2026-08-15T03:01:00Z","policy_version":812}
```

A rejected response is:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2
Content-Type: application/json

{"allowed":false,"remaining":0,"limit":40,"retry_after_ms":1840,"policy_version":812}
```

`cost` lets an expensive operation consume more than one token. The gateway forwards the same `X-Request-Id`; a retry reuses the same `Idempotency-Key`. Deduplicate the decision record for a short, documented horizon so a timed-out response does not spend quota twice. This key does not replace the business operation's idempotency key: payment creation still requires its own durable idempotency contract.

### Policy administration [PROPOSED DESIGN]

```http
PUT /v1/policies/{policy_id}
If-Match: "policy-version-811"

{"match":{"route":"POST:/v1/payments","plan":"standard"},"algorithm":"token_bucket","rate_per_second":20,"burst":40,"scope":"api_key"}
```

`PUT` is idempotent, and `If-Match` prevents lost updates. Restrict policy changes to authorized operators. Store policies as immutable versions. During propagation, a gateway may briefly use the previous version; expose the maximum propagation delay as a metric.

## 4. Data Model

### Control plane [PROPOSED DESIGN]

Use a relational control database as the source of truth for policy configuration. Keep mutable bucket state in a sharded in-memory decision store. Periodically summarize that state; do not synchronously copy every mutation into SQL.

```sql
CREATE TABLE rate_policy (
  policy_id        BIGINT PRIMARY KEY,
  version          BIGINT NOT NULL,
  route_pattern    TEXT NOT NULL,
  method           TEXT NOT NULL,
  principal_scope  TEXT NOT NULL,
  algorithm        TEXT NOT NULL CHECK (algorithm IN ('token_bucket', 'sliding_window')),
  rate_per_second  NUMERIC,
  burst            INTEGER,
  window_seconds   INTEGER,
  limit_count      INTEGER,
  state            TEXT NOT NULL CHECK (state IN ('active', 'disabled')),
  updated_at       TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX rate_policy_version
  ON rate_policy (policy_id, version);

CREATE INDEX rate_policy_match
  ON rate_policy (method, route_pattern, principal_scope, state);

CREATE TABLE policy_audit (
  policy_id BIGINT NOT NULL,
  version BIGINT NOT NULL,
  actor TEXT NOT NULL,
  change_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (policy_id, version)
);
```

### Decision state [PROPOSED DESIGN]

Use the key `hash(tenant_id | principal_type | principal_id | route | policy_id)`. Hash partitioning distributes arbitrary customer traffic and avoids range hotspots caused by sequential IDs. A token-bucket value contains `{tokens, last_elapsed_ns, policy_version, dedupe_entries}`.

Use elapsed time from a monotonic source for refill calculations. Wall-clock timestamps may be returned for client-facing fields such as `reset_at`, but clock synchronization must not determine whether a request is allowed. The policy version in the value makes configuration changes observable and supports safe cache invalidation.
