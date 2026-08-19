---
title: "Designing a Durable Multi-Channel Notification System"
description: "An operational design for durable, idempotent, multi-channel notifications at one million channel messages per day."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Problem and scope

The platform accepts notification commands from product services such as billing, chat, security, and marketing. It renders a versioned template, evaluates recipient preferences, creates channel deliveries for email, SMS, push, and in-app, and keeps a durable audit trail.

The difficult part is not sending a message once. It is preserving the state transition when any boundary can fail: the client can retry, a worker can crash, or a provider can time out after accepting the message. This design covers the acceptance API, durable state, asynchronous delivery, retries, provider isolation, cancellation, and auditability.

**[SOURCE FACT]** The delivery contract is **at least once**. An accepted notification must not be silently lost. Exactly-once delivery is not promised because a provider timeout can occur after the provider accepted a message.

**[PROPOSED DESIGN]** Use an idempotency key at every command boundary and a stable delivery ID for provider calls when the provider supports deduplication. The synchronous response confirms durable acceptance, not provider delivery. This keeps a slow SMS provider from extending every product request.

Functional requirements:

- Accept commands from many authenticated product services.
- Render locale- and channel-specific templates with bounded, validated variables.
- Apply preferences, channel opt-outs, quiet hours, consent, and policy rules.
- Fan out one logical notification into independently retried channel deliveries.
- Support scheduled notifications, cancellation before dispatch, and in-app inbox reads.
- Keep an immutable audit of acceptance, policy decisions, attempts, provider results, and final state.

**[SOURCE FACT]** Non-functional requirements are:

- Return an enqueue response in under 1 second at p99.
- Provide at-least-once processing, idempotent producer submission, exponential-backoff retry, and a dead-letter queue (DLQ).
- Isolate slow or failing providers and apply backpressure rather than exhausting worker or database connection pools.
- Target 99.95% monthly availability for acceptance and 99.9% successful dispatch within the channel's retry window.
- Retain audit data for 13 months and support deletion of personal content under the privacy policy.

## 2. Capacity model

**[SOURCE FACT]** The seed workload is one million channel messages per day. A logical notification can fan out, so the sizing unit is a channel message, not a producer event.

| Quantity | Basis | Result |
|---|---|---:|
| Daily messages | Stated requirement | 1,000,000/day |
| Average enqueue/dispatch rate | 1,000,000 / 86,400 | 11.6 messages/s |
| Peak rate | 10x average for launches and billing runs | 116 messages/s |
| Growth headroom | 3x peak for capacity and burst absorption | 350 messages/s |
| Average message payload | 4 KB rendered body plus metadata | 4 GB/day raw |
| Durable row footprint | 4 KB payload plus 2 KB indexes/overhead | 6 GB/day |
| Audit retention | 13 months, approximately 395 days | 2.37 TB before compression |
| Delivery-attempt rows | 1.5 attempts/message, 2 KB each | 1.19 TB/year |
| In-app reads | 20% of messages become inbox items; 5 reads/item | 1,000,000 reads/day |

**[ANALYSIS]** The 6 GB/day estimate is `1,000,000 x 6 KB`. With 3x replicas, that is about 7.1 TB over 395 days. Cold audit storage can reduce cost; the hot database should not be expected to hold all 13 months. Monthly partitions make retention and deletion operationally simpler.

Rendered payload bandwidth at the stated envelope is `4 KB x 350 messages/s = 1.4 MB/s`, or about 11.2 Mb/s before protocol overhead. Provider egress is separate. SMS and email can add provider responses, while push payloads are usually smaller. In-app traffic is approximately 5:1 reads to writes under the stated workload; the durable delivery path is still write-heavy.

**[ASSUMPTION]** A product model with 2 million daily active users and 0.5 notifications per active user per day produces `2,000,000 x 0.5 = 1,000,000` notifications. This is an illustrative product assumption, not a claim about all products. At 15% annual volume growth, the year-one average is about 1.08M/day; 350 messages/s remains the initial capacity envelope.

**[ANALYSIS]** 99.95% availability allows approximately 21.9 minutes of monthly downtime for the acceptance API. Dispatch can continue from the queue during a short API outage, so acceptance and delivery should have separate SLOs.

## 3. API contract

**[PROPOSED DESIGN]** All endpoints use TLS, service-to-service OAuth2/mTLS, and `X-Request-Id`. The server derives `tenant_id` from the credential and checks tenant authorization before reading or mutating data.

### Submit a notification

`POST /v1/notifications`

```json
{
  "idempotency_key": "billing:invoice:inv_928:due",
  "recipient": {"user_id": "usr_42"},
  "template": {"name": "invoice_due", "version": 3},
  "variables": {"amount": "125.00", "currency": "USD", "due_date": "2026-08-20"},
  "channels": ["email", "push", "in_app"],
  "send_at": "2026-08-19T04:00:00Z",
  "dedupe_window_seconds": 86400
}
```

The producer is authenticated. Variables are schema-validated and size-limited; arbitrary HTML and URLs are rejected by default. The server returns `202 Accepted` after recording the command durably:

```json
{"notification_id":"ntf_01J...", "status":"accepted", "channels":["email","push","in_app"]}
```

The unique key `(tenant_id, idempotency_key)` makes a retry return the original notification ID. A lost response is therefore safe to retry. `409 Conflict` means that the same key was reused with a different request fingerprint.

### Query status

`GET /v1/notifications/{notification_id}` returns the logical state and per-channel state. The result is eventually consistent by up to a few seconds while workers update attempts.

### Preferences

`GET /v1/users/{user_id}/notification-preferences` and `PUT /v1/users/{user_id}/notification-preferences` manage opt-outs and quiet hours. `PUT` is idempotent with an `If-Match` version; a stale version returns `412 Precondition Failed`. Product-critical channels may be policy-protected, but legal opt-outs take precedence.

### In-app inbox

`GET /v1/users/{user_id}/inbox?cursor=...&limit=50` returns a cursor-paginated list. `POST /v1/users/{user_id}/inbox/{message_id}/read` is idempotent and records `read_at`.

Cancellation uses `POST /v1/notifications/{id}/cancel` with an idempotency key. It succeeds only while a channel delivery is `pending` or `scheduled`. A provider call already in progress may still win, so cancellation is not advertised as retraction.

## 4. Durable state

**[PROPOSED DESIGN]** PostgreSQL is the source of truth for commands, preferences, and state transitions. Kafka carries work; it is not the audit database. The command and its idempotency record must be committed before the API returns `202`.

```sql
CREATE TABLE notifications (
  tenant_id        bigint NOT NULL,
  notification_id  uuid NOT NULL,
  idempotency_key  text NOT NULL,
  request_hash     bytea NOT NULL,
  user_id          bigint NOT NULL,
  template_name    text NOT NULL,
  template_version int NOT NULL,
  variables_json   jsonb NOT NULL,
  created_at       timestamptz NOT NULL,
  send_at          timestamptz NOT NULL,
  status           text NOT NULL,
  PRIMARY KEY (tenant_id, notification_id),
  UNIQUE (tenant_id, idempotency_key)
) PARTITION BY RANGE (created_at);

CREATE TABLE deliveries (
  tenant_id        bigint NOT NULL,
  delivery_id      uuid NOT NULL,
  notification_id  uuid NOT NULL,
  channel          text NOT NULL,
  status            text NOT NULL,
  attempt_count    int NOT NULL,
  next_attempt_at  timestamptz,
  provider_id      text,
  last_error       text,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, delivery_id)
);
```

The `request_hash` prevents an idempotency key from being reused for a different request. Each delivery has its own status and retry schedule, so a failing SMS provider does not block an otherwise healthy email delivery.

Preferences and inbox rows are tenant-scoped. Audit records should be append-only and include the event type, actor or service, timestamp, delivery ID where applicable, and outcome. Personal content should be separable from operational metadata so privacy deletion does not require rewriting the entire operational history.

## 5. Processing flow

**[PROPOSED DESIGN]** Use a transactional outbox:

1. The API validates the command, checks the idempotency key, stores the notification and channel deliveries, and writes an outbox event in one PostgreSQL transaction.
2. An outbox publisher reads committed rows and publishes work to Kafka. It marks an outbox row published only after the broker acknowledges it.
3. Channel consumers claim work, re-check cancellation and policy state, render or load the approved template, and call the provider through a channel adapter.
4. Consumers persist the attempt and next state. A crash can cause redelivery, so the state transition and attempt record must be safe to repeat.

The outbox closes the database-to-broker gap. It does not make provider delivery exactly once; only the stable delivery ID, provider deduplication support, and local idempotent state handling can reduce duplicate effects.

Scheduled work can remain in PostgreSQL until `send_at`, or be placed in a delay-capable queue. The important invariant is that a scheduled item is not dispatched before its due time and that cancellation takes a row lock before dispatch claims it.

## 6. Retry and provider isolation

Provider calls use a bounded timeout. Retryable failures include timeouts, connection failures, and provider responses explicitly classified as transient. Permanent validation or policy failures are not retried. Exponential backoff includes jitter and a maximum retry window; exhausted deliveries move to the DLQ with their error and delivery ID.

**[PROPOSED DESIGN]** Keep a separate concurrency limit and connection pool per provider and channel. A circuit breaker opens after a configured failure threshold, stops new calls for a recovery interval, and then permits a small probe. Consumers apply backpressure when the provider limit or local pool is full instead of accepting unlimited in-memory work.

Provider adapters should distinguish `accepted`, `rejected`, `rate_limited`, `transient_error`, and `permanent_error`. If a timeout leaves the result unknown, record `unknown` and retry with the same delivery ID. Do not mark the message failed merely because the client-side timeout expired.

## 7. Consistency, cancellation, and inbox reads

A notification can be accepted while preference evaluation or delivery is still pending. Preference changes should be read at the policy decision point. After a delivery is handed to a provider, a later opt-out cannot reliably recall it; the system can stop future attempts and record the decision.

Cancellation acquires a row lock or uses a compare-and-set transition from `scheduled` or `pending` to `cancelled`. Dispatch uses the same transition boundary. If dispatch has already moved to `sending`, cancellation returns a non-success outcome because the provider call may complete.

Inbox reads are independent of external delivery status. Insert an in-app item as its own channel delivery, paginate by a stable `(created_at, message_id)` cursor, and make the read endpoint an idempotent update. This avoids offset pagination shifting as new messages arrive.

## 8. Operations and correctness

Track acceptance latency, queue lag, delivery latency by channel, retry counts, DLQ depth, provider error classes, circuit-breaker state, database pool usage, and outbox age. Alert on sustained lag and growing DLQ depth, not only on API errors.

Audit state transitions rather than relying only on mutable status columns. A useful record answers: when was the command accepted, which policy decision was made, which attempts ran, what the provider returned, and why the final state was selected.

Test the failure boundaries explicitly: duplicate submissions, lost responses, consumer crashes after a provider call, provider timeouts with unknown outcomes, outbox retries, stale preference versions, cancellation racing with dispatch, and DLQ replay. A replay tool must preserve the delivery ID and must not bypass tenant authorization or policy checks.

## 9. Summary

The design separates durable acceptance from asynchronous provider delivery. PostgreSQL owns the command and state, an outbox publishes committed work, Kafka buffers it, and channel consumers handle retries independently. Idempotency keys, stable delivery IDs, bounded timeouts, backpressure, circuit breakers, and an append-only audit trail address the failure modes that matter. The capacity figures are an initial sizing envelope; production limits should be validated with measured payload sizes, provider quotas, and failure testing.
