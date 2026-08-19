---
title: "Designing a Search Autocomplete Service"
description: "A practical design for low-latency, personalized, typo-tolerant search suggestions at high QPS."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Problem and scope

[SOURCE FACT] A search box needs suggestions while the user is still typing. For a prefix such as `phot`, the service returns a short, ordered list such as “photo printer”, “photo editor”, and “photography”. The same service serves web, mobile, and voice-assisted clients.

The request path has to support anonymous visitors, signed-in customers, and internal ingestion jobs. It must provide:

- Prefix matches from the global catalog.
- Personalization from recent searches and user preferences.
- Trending suggestions that respond to recent demand without allowing one noisy event to dominate.
- Tolerance for common edit-distance-one typos.
- Category-aware ranking for products, people, places, and help articles.
- Partial results when personalization, trending data, or an index replica is unavailable.

[SOURCE FACT] The user-visible SLO is p99 under 50 ms at the service boundary, excluding client network time. The core prefix path targets 99.99% monthly availability. A stale but safe response is preferable to an error. Suggestions must not expose private queries, blocked terms, or another tenant’s data. A click or search event may be lost briefly, but an accepted ingestion request must be idempotent and eventually indexed.

[ANALYSIS] The hard part is not prefix lookup by itself. It is combining several data sources without turning an optional dependency into latency on the critical path. The design therefore separates the read-optimized serving index from event ingestion and treats personalization and trends as bounded, degradable inputs.

## 2. Capacity assumptions

[ASSUMPTIONS] These figures are planning inputs, not measurements from a particular production system. Replace them with production telemetry before capacity commitments are made.

- 50 million daily active users (DAU). This represents a large consumer product, not a global web index.
- Each user makes 20 autocomplete requests per day. This counts keystrokes that pass the client debounce, not every keypress.
- `50,000,000 x 20 = 1,000,000,000 requests/day`.
- Average rate: `1,000,000,000 / 86,400 = 11,574 RPS`.
- Traffic is bursty around launches and evening usage. A 10x peak gives about `116,000 RPS`; 30% headroom gives `151,000 RPS` of read capacity.
- An average response contains 10 suggestions at 80 bytes each plus JSON overhead, or approximately 2 KB. Peak egress is `116,000 x 2 KB = 232 MB/s`, about 1.86 Gbit/s before protocol overhead.
- Assume 10 million accepted query or event writes per day. The read-to-write ratio is `100:1`.
- An accepted event is about 500 bytes. Raw storage for 30 days is `10,000,000 x 500 x 30 = 150 GB`. With three durable replicas, indexes, and 40% overhead, reserve about 630 GB. Retain the event log for 30 days, then compact or delete it.
- The serving vocabulary contains 200 million unique phrases. A compact trie/FST entry, category metadata, counters, and ranking features average 120 bytes, or 24 GB raw. Five regional replicas plus temporary build space require roughly 150 GB.
- 99.99% availability allows about 4 minutes 23 seconds of unavailability in a 30-day month. The 50 ms p99 target applies to successful core responses; dependency degradation should return a bounded partial response rather than wait for a timeout.
- Phrase growth is 5% per month. Event volume grows with DAU and usage, so the event pipeline should support at least 2x the current peak before expansion is scheduled.

[ANALYSIS] These assumptions point to a read-optimized, memory-resident serving index, an independently scalable event pipeline, and bounded fan-out. The hot path should not query a relational database once per keystroke.

## 3. API contract

[PROPOSED DESIGN] The public endpoint is:

```http
GET /v1/suggestions?q=phot&limit=8&category=all&locale=en-US
Authorization: Bearer <token>       # optional for personalization
X-Request-Id: 7f2c...
```

```json
{
  "query": "phot",
  "suggestions": [
    {"text": "photo printer", "category": "product", "score": 0.94},
    {"text": "photo editor", "category": "app", "score": 0.89}
  ],
  "complete": true,
  "sources": ["global", "trending"],
  "index_version": "2026-08-15T09:59:40Z",
  "request_id": "7f2c..."
}
```

`limit` is capped at 10. Before lookup, normalize the query with Unicode normalization, case folding, and a bounded length. Return `200` with `complete: false` when an optional source times out. Return `400` for an invalid locale or query shape, `401` only when an explicitly requested authenticated feature requires identity, and `429` when the caller exceeds its quota. If the core index is unavailable, return a cached result when one exists; otherwise return `503` with `Retry-After`.

Ingestion is a separate endpoint:

```http
POST /v1/query-events
Idempotency-Key: 6b5d6b9e-...
Authorization: Bearer <token>
Content-Type: application/json

{"query":"photo printer","selected_suggestion":"photo printer","locale":"en-US","occurred_at":"2026-08-15T03:00:02Z"}
```

Return `202 Accepted` after durable queue admission. Scope the idempotency key to the tenant and endpoint and retain it for 48 hours. A client must not retry a `4xx` other than `429`; it may retry a lost response with the same key. The server assigns the producer timestamp. Do not use event fields as the source of authorization or tenant identity.

## 4. Source data and serving representation

[SOURCE FACT] Relational metadata is the source of truth because phrase ownership, moderation, and versioned publication require constraints and transactions.

```sql
CREATE TABLE phrases (
  tenant_id       BIGINT NOT NULL,
  phrase_id       BIGINT NOT NULL,
  normalized_text  TEXT NOT NULL,
  locale           TEXT NOT NULL,
  category         TEXT NOT NULL,
  status           TEXT NOT NULL,
  base_score       DOUBLE PRECISION NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, phrase_id),
  UNIQUE (tenant_id, locale, normalized_text)
);

CREATE INDEX phrases_lookup
  ON phrases (tenant_id, locale, status, normalized_text);

CREATE TABLE query_events (
  tenant_id       BIGINT NOT NULL,
  event_id        UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  user_id         BIGINT,
  normalized_text TEXT NOT NULL,
  category        TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX events_time ON query_events (tenant_id, occurred_at);
```

The phrase uniqueness constraint prevents duplicate catalog entries within a tenant and locale. `phrases_lookup` supports moderation and rebuild tools, not the hot suggestion path. `(tenant_id, event_id)` provides durable event deduplication, while the time index supports windowed aggregation. Partition large event tables by day so 30-day retention can be implemented by dropping partitions instead of deleting a billion rows.

[PROPOSED DESIGN] Serve an immutable, memory-mapped FST/trie snapshot. Each terminal stores the phrase ID, category, base score, and compact references to ranking features. Keep a separate per-user list keyed by `(tenant_id, user_id, locale)` with a short TTL.

Partition the event stream by `hash(tenant_id, normalized_text)`. The normalized phrase is the ordering key for deterministic window aggregation. A tenant-specific salt can prevent predictable placement patterns across tenants; the salt must not weaken tenant isolation or authorization checks.

## 5. Read path

[PROPOSED DESIGN] The request handler performs the following bounded sequence:

1. Authenticate when personalization or another identity-dependent feature was requested, then validate tenant, locale, and query shape.
2. Normalize the query and check a small response cache where the cache key includes tenant, locale, category, and the normalized prefix.
3. Query the local global index for prefix matches. A typo-tolerant side index can supply candidates for common edit-distance-one variants.
4. Fetch the per-user list and trending candidates in parallel, each with its own short timeout and bounded result set.
5. Remove blocked, private, duplicate, and cross-tenant candidates before ranking.
6. Merge candidates using category, base-score, trend, recency, and personalization features, then return at most the requested limit.

The response records which sources contributed. If an optional fetch fails, return the core global results with `complete: false`; do not make the client infer completeness from an empty list. If the core index fails, use a bounded cache fallback. A circuit breaker (cơ chế ngắt mạch) prevents repeated calls to an unhealthy dependency, while backpressure (kiểm soát áp lực ngược) limits work when traffic exceeds the service’s processing capacity.

## 6. Ingestion and index builds

[PROPOSED DESIGN] The ingestion endpoint validates the authenticated tenant and payload, performs idempotency handling, and appends an event to a durable queue. Consumers update aggregates and write the relational event store asynchronously. A completed `202` means the queue accepted the request, not that the phrase is already visible in the serving index.

Consumers should tolerate duplicates and out-of-order delivery. Aggregate updates therefore need idempotent keys and a defined event-time policy. A lost click can affect ranking temporarily; it must not create a second accepted event when the client retries.

Build a new FST/trie snapshot from approved relational metadata and computed features. Validate it before publication, then publish the version atomically. Serving processes can keep the previous snapshot available while loading the new one. The response’s `index_version` makes it possible to correlate behavior with a specific snapshot.

## 7. Ranking, privacy, and moderation

[ANALYSIS] Ranking should be explicit about feature provenance. Global popularity and editorial scores are catalog-level signals. Trending signals come from recent aggregates and need smoothing or caps so a single noisy event cannot dominate. Personalization is tenant- and user-scoped, and should be treated as optional on the latency-critical path.

[PROPOSED DESIGN] Apply moderation and privacy filters before returning candidates, not only during offline indexing. Do not place raw private queries in a shared global index. Keep blocked terms out of both the serving snapshot and fallback caches. Cache keys and per-user data must include tenant scope; authorization is still required even when a cache entry exists.

## 8. Failure handling and operations

[PROPOSED DESIGN] Set independent timeouts for cache, global index, personalization, and trending dependencies. The aggregate timeout must leave time for serialization and response transmission within the 50 ms p99 target. Retries are appropriate only for operations that can be retried safely, and retry budgets must be bounded to avoid a retry storm.

Track latency by source and by result completeness, along with cache hit rate, index version, queue lag, consumer failures, rejected events, deduplication conflicts, and moderation-filter counts. Alerting should distinguish an unavailable core index from a degraded optional source.

Use tenant-aware rate limits and quotas. Protect the event endpoint with authentication, payload validation, durable queue limits, and backpressure. Redact query text from ordinary logs unless it is needed under an approved privacy policy.

## 9. Trade-offs

- An in-memory FST/trie gives predictable prefix lookup latency but requires snapshot builds, memory planning, and atomic publication.
- A relational source of truth makes moderation and versioned publication enforceable, but it is not suitable for per-keystroke reads at the assumed peak.
- Separate global, trending, and personalized sources allow independent scaling and partial responses, but ranking and debugging become more complex.
- Eventual indexing accepts brief visibility lag and possible loss of low-value events in exchange for a fast interactive path.
- Typo tolerance improves recall but can increase candidate work and produce unexpected matches; it should be bounded to the supported edit-distance-one cases.

## 10. Summary

[ANALYSIS] The design keeps the interactive path small: normalize the prefix, read a local immutable index, merge bounded optional sources, filter for safety, and return a partial result when those optional sources fail. Ingestion, aggregation, and index publication remain asynchronous and independently scalable. The key operational boundaries are explicit: a durable queue defines ingestion acceptance, an immutable snapshot defines what is being served, and tenant-aware filtering applies before any result reaches the client.
