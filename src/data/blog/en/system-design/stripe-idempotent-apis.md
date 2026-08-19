---
title: "Designing Idempotent APIs: Stripe's Idempotency-Key Pattern"
description: "A source-backed analysis of idempotency keys, safe retries, concurrency, replay, and a proposed payment API design."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

[SOURCE FACT] Networks fail in several materially different ways: a connection can fail before the request reaches the server, the call can fail while the server is performing the operation, or the operation can succeed while the response is lost. Stripe describes the resulting client state as uncertain: the client may not know whether retrying is safe. Source: https://stripe.com/blog/idempotency

[ANALYSIS] The dangerous case is not an ordinary error response. It is the timeout with no authoritative answer. A payment client that treats every timeout as “not charged” can create a second charge; a client that never retries can leave an order permanently unresolved. Availability and correctness are coupled at the request boundary.

[SOURCE FACT] Stripe frames even an API client and one server as a distributed system because they exchange messages over an unreliable network. Source: https://stripe.com/blog/idempotency

[ANALYSIS] Therefore, an API contract must define what a retry means. “The server probably did not receive it” is not a contract. The contract needs an operation identity, a durable outcome, and a replay rule.

## 2. What the Original System Did

[SOURCE FACT] The article recommends making endpoints idempotent where possible. An idempotent operation can be invoked repeatedly while its side effects occur only once. A DNS `PUT` is the example: the request contains the complete record, and a duplicate can be ignored while returning success. Source: https://stripe.com/blog/idempotency

[SOURCE FACT] The article distinguishes this from operations such as charging a customer, where calling the operation twice must not double-charge the customer. The client generates a unique identifier for that operation and sends it with the normal payload. The server correlates that identifier with request state. Source: https://stripe.com/blog/idempotency

[SOURCE FACT] Stripe's API supports idempotency keys on mutating endpoints under `POST`, using the `Idempotency-Key` header. A client can retry a failed request with the same key and charge the customer only once. If the operation succeeded but its response was lost, the server returns a cached successful result. Source: https://stripe.com/blog/idempotency

[SOURCE FACT] For a failure midway through an operation, the article says behavior depends on implementation. If the previous operation was rolled back by an ACID database, retrying wholesale is safe; otherwise, state is recovered and the call is continued. Source: https://stripe.com/blog/idempotency

[SOURCE FACT] Stripe recommends exponential backoff and random jitter. Backoff reduces pressure on a degraded server, while jitter spreads synchronized retries and mitigates a thundering herd. The article also says the Stripe Ruby library retries automatically with an idempotency key, increasing backoff, and jitter. Source: https://stripe.com/blog/idempotency

[ANALYSIS] The source establishes the externally important behavior, not a complete internal architecture. It does not specify the idempotency-store database, retention policy, lock implementation, replication topology, or an HTTP status for concurrent reuse. Those details must not be presented as Stripe internals.

## 3. Architecture Diagram

The diagram separates what the source establishes from an interview-style extension.

```mermaid
flowchart LR
    C[Client\n[Source-backed component]]
    R[Retry policy: exponential backoff + jitter\n[Source-backed component]]
    G[API endpoint\n[Source-backed component]]
    K[(Idempotency record store\n[Proposed component])]
    L[Per-key serialization\n[Proposed component]]
    P[Payment side effect\n[Proposed component]]
    O[Persist result for replay\n[Proposed component]]
    X[Response or cached replay\n[Source-backed behavior]]

    C -->|POST + Idempotency-Key| G
    C --> R
    R -->|same key on retry| G
    G --> K
    K --> L
    L --> P
    P --> O
    O --> K
    K --> X
    X --> C
```

[SOURCE FACT] The source-backed path is a client sending a unique key to a mutating API, retrying with the same key after failure, and receiving the previously successful result when the original response was lost. Source: https://stripe.com/blog/idempotency

[PROPOSED DESIGN] The record store, per-key serialization, atomic result persistence, and payment-side-effect boundary are an extension that makes the behavior implementable. The diagram does not claim that Stripe uses these exact components.

## 4. System Design Analysis

[ANALYSIS] The key is an operation identity, not a request attempt ID. Every retry of one logical charge must carry the same key. Two distinct charges must carry different keys even when their payloads are identical.

[PROPOSED DESIGN] Scope the identity by authenticated account and API operation. A lookup key can be `(account_id, endpoint, idempotency_key)`. This prevents one tenant from replaying another tenant's result and prevents accidental collisions between unrelated endpoints.

[PROPOSED DESIGN] Bind the key to a canonical request fingerprint. On the first request, store a hash of the relevant method, path, and normalized payload. If the same key arrives with a different payload, reject it as a key misuse rather than replaying the first operation. A `409 Conflict` is a reasonable proposed response because the resource identity conflicts with the new representation; this status is not stated by the source as Stripe behavior.

[ANALYSIS] Safe replay requires more than deduplicating at the HTTP edge. The idempotency record and the business effect must have a recoverable relationship. If a process writes “completed” before charging, a crash can suppress the charge. If it charges before recording completion, a crash can cause a duplicate unless the payment operation itself is keyed or the same transaction boundary covers both actions.

[PROPOSED DESIGN] For a single transactional database, create the idempotency row and payment intent in one transaction, lock the row for an in-flight key, and commit the final response with the business state. For an external processor, pass the same logical key downstream when supported, or use an outbox and reconciliation state. Never claim that a local database transaction alone makes an external side effect exactly once.

[SOURCE FACT] The article explicitly leaves midway-failure behavior implementation-dependent and names ACID rollback as one safe route. Source: https://stripe.com/blog/idempotency

## 5. Data Model

[PROPOSED DESIGN] The following SQL is an illustrative relational model, not a description of Stripe's schema. It stores enough information to serialize concurrent attempts and replay the final response.

```sql
CREATE TABLE idempotency_records (
    account_id       BIGINT       NOT NULL,
    endpoint         TEXT         NOT NULL,
    idempotency_key  TEXT         NOT NULL,
    request_hash     BYTEA        NOT NULL,
    status           TEXT         NOT NULL CHECK (status IN ('in_progress', 'succeeded', 'failed')),
    response_status  INTEGER,
    response_body    JSONB,
    created_at       TIMESTAMPTZ  NOT NULL,
    completed_at     TIMESTAMPTZ,
    PRIMARY KEY (account_id, endpoint, idempotency_key)
);
```

[PROPOSED DESIGN] The primary key makes concurrent first attempts contend on one logical operation. `request_hash` detects reuse with changed parameters. `response_status` and `response_body` support replay, while `in_progress` lets the API distinguish work that is still running from a durable result.

[ANALYSIS] Retention is a business and correctness decision. Expiring a record too early reopens the duplicate-charge risk for a late retry. Retaining records forever increases storage and privacy obligations. The source does not state a retention duration, so this article intentionally supplies none.

## 6. API Design

[SOURCE FACT] Stripe's documented pattern in the source uses the `Idempotency-Key` header on a `POST` charge request. Source: https://stripe.com/blog/idempotency

[PROPOSED DESIGN] An equivalent contract for a proposed payment endpoint is:

```http
POST /v1/payments
Idempotency-Key: order-8f2c-attempt-1
Content-Type: application/json

{"amount":2000,"currency":"usd","customer":"cus_example"}
```

[PROPOSED DESIGN] Response rules:

- First accepted request: execute once and persist the status and body.
- Retry with the same key and identical fingerprint: return the persisted response, including its original success or terminal failure status.
- Same key with a different fingerprint: return `409 Conflict` with a stable error code such as `idempotency_key_reused`.
- Same key while work is actively owned by another request: return `409 Conflict` with `operation_in_progress`, or wait within a bounded server timeout. This is a proposed contract, not a source fact.
- Missing key for a non-idempotent mutation: reject, unless the endpoint explicitly documents another safety mechanism.

[ANALYSIS] Replaying only successful responses is weaker than replaying every terminal outcome. A client that retries a deterministic validation failure should receive the same answer; otherwise it may observe inconsistent behavior. Transient failures should not be cached as terminal results unless the API contract makes them terminal.

[SOURCE FACT] The source says clients should continue retrying after errors until they can verify success, and should use exponential backoff with random jitter. Source: https://stripe.com/blog/idempotency

## 7. Scaling Strategy

[PROPOSED DESIGN] Partition idempotency records by account or a hash of `(account_id, idempotency_key)`. Keep the uniqueness check and state transition for one key on one authoritative partition. Replicas can serve completed replays only if replication lag cannot return “missing” for a record that the primary has committed; otherwise route key lookups to the primary.

[PROPOSED DESIGN] Use a short-lived lease or row lock for `in_progress`, with fencing or an attempt token so a delayed worker cannot overwrite a newer owner. A lease is not a substitute for durable business-state checks. Recovery must inspect the payment state before re-executing.

[ANALYSIS] Backoff and jitter shape load at the client edge, but they do not eliminate hot keys, abusive clients, or a replay-store outage. Rate limits should be keyed by account and endpoint, and observability should distinguish first attempts, safe replays, conflicts, expired keys, and unknown outcomes.

[SOURCE FACT] The source recommends exponential backoff so clients do not hammer a down server, and random jitter so simultaneous clients do not retry in alignment. Source: https://stripe.com/blog/idempotency

## 8. Failure Scenarios

[SOURCE FACT] If the initial connection fails, the retry may be the first time the server sees the key and can be processed normally. If execution fails midway, the server must either rely on a safe rollback or recover and continue. If execution succeeds but the response fails, the server can return a cached result. Source: https://stripe.com/blog/idempotency

[PROPOSED DESIGN] Apply those cases as follows:

- Lost before admission: no idempotency row exists; retry inserts the operation.
- Lost after admission: the row is `in_progress`; the retry reads or waits for the owner and must not start an unkeyed second charge.
- Crash after business commit but before response: the completed row is replayed.
- Concurrent duplicate: one request wins the unique-key race; the other receives the proposed `409` or a bounded wait.
- Changed payload: the fingerprint mismatch is a proposed `409`; do not silently reinterpret the key.
- Idempotency store unavailable: fail closed for a charge rather than execute without deduplication.
- Client retries aggressively: exponential backoff and jitter reduce, but cannot guarantee, recovery load.

[ANALYSIS] “Exactly once” describes the externally visible business effect under the API's identity and storage guarantees; it does not mean the network delivered one packet or that internal code ran once. This distinction matters during reconciliation and incident response.

## 9. Capacity Estimation

[PROPOSED DESIGN] The following are illustrative assumptions, not Stripe measurements: 1,000 payment attempts per second at peak, 5% retries, one idempotency record averaging 2 KB including the response, and 24 hours of retention.

[PROPOSED DESIGN] Peak request rate including retries is approximately:

```text
1,000 * (1 + 0.05) = 1,050 requests/second
```

[PROPOSED DESIGN] Daily logical attempts are:

```text
1,000 * 86,400 = 86,400,000 records/day
```

At 2 KB per record, the raw record volume is approximately 173 GB per day before indexes, replication, and operational overhead. These figures are illustrative assumptions and must be replaced with measured traffic, payload sizes, retry distributions, and retention requirements.

[ANALYSIS] The important sizing variable is not just write throughput. Replay reads, conflict contention, durable response size, partition skew, and recovery scans can dominate. Capacity tests should include the same-key concurrency pattern, not only unique-key traffic.

## 10. Trade-offs

[ANALYSIS] Idempotency keys trade storage and protocol complexity for safety under ambiguity. The client must persist the key across retries, and the server must retain enough state to recognize it.

[PROPOSED DESIGN] A strict `409` for concurrent use gives clients a clear signal but forces them to poll or retry. Waiting can improve ergonomics but consumes server resources and risks head-of-line blocking. A bounded wait followed by `409` is a reasonable compromise.

[PROPOSED DESIGN] Caching complete response bodies makes replay deterministic but increases storage cost and may retain sensitive data. Storing only a resource ID reduces exposure but requires a reliable read path and may not reproduce the original response.

[ANALYSIS] A database-backed transaction is easier to reason about for local state than a distributed lock. External payment processors remain a separate failure boundary, so downstream idempotency or reconciliation is necessary. No design can infer an external outcome from a timeout alone.

[SOURCE FACT] The source presents idempotency, client retries, exponential backoff, and jitter as complementary techniques for robust and predictable APIs. Source: https://stripe.com/blog/idempotency

## 11. What We Can Learn From This Architecture

[SOURCE FACT] The article's central lesson is to handle failures consistently, safely, and responsibly: retry remote operations, use idempotency and idempotency keys, and avoid overwhelming degraded servers with exponential backoff and jitter. Source: https://stripe.com/blog/idempotency

[ANALYSIS] The deeper lesson is to design for the uncertain interval between side effect and acknowledgement. A successful business operation without a delivered response is not exceptional noise; it is a first-class protocol state.

[ANALYSIS] Idempotency is also a boundary discipline. The key must identify the business intent, the server must preserve the association between intent and result, and the client must reuse the identity rather than generating a new attempt ID. If any layer changes the identity, retries lose their safety property.

[PROPOSED DESIGN] For production APIs, document key scope, payload mismatch behavior, in-progress behavior, retention, replayed headers, and the exact set of retryable failures. These are the operational details that turn a slogan into a usable contract.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN] Requirements:

- Accept a payment mutation without charging twice when the client retries.
- Return the same terminal result for repeated requests with the same key and payload.
- Detect concurrent use and payload changes.
- Recover after process, network, and dependency failures.
- Keep the design explicit about what is proposed rather than attributed to Stripe.

[PROPOSED DESIGN] Request flow:

1. Authenticate the account and validate the key format.
2. Canonicalize the request and compute its fingerprint.
3. Insert the idempotency record with `in_progress`; a unique constraint chooses one owner.
4. On an existing record, compare fingerprints. Replay a terminal result, or return/wait on `in_progress`.
5. Execute the payment using a downstream idempotency identity when available.
6. Commit the payment state and response record atomically where possible.
7. Return the stored response. A later retry follows the same replay path.

[PROPOSED DESIGN] Correctness invariant: for a given `(account, endpoint, key)`, all accepted requests have one request fingerprint and at most one committed business effect. The invariant depends on durable uniqueness and a safe downstream/reconciliation protocol; it is not created by the header alone.

[PROPOSED DESIGN] Test the design with a fault-injection matrix: drop the request before admission, kill the worker during the side effect, drop the response after commit, race many identical requests, reuse a key with changed payload, and make the idempotency store unavailable. Success means the API exposes a deterministic result or an explicit unknown/in-progress state, never an accidental second charge.

## Original Sources

- Company: Stripe
- Exact Article Title: Designing robust and predictable APIs with idempotency
- URL: https://stripe.com/blog/idempotency
- What information from the source was used: Network failure modes; idempotent HTTP operations; operation-scoped idempotency keys; Stripe's `Idempotency-Key` pattern on mutating `POST` endpoints; cached replay after a lost response; ACID rollback as one implementation case; exponential backoff, random jitter, and the thundering-herd problem.
