---
title: "From Ambiguous Documents to Auditable KYC Decisions"
description: "A practical design for extracting KYC fields from identity documents, validating them with deterministic rules, and routing uncertain cases to human review."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/identity-service>

## Problem

KYC document intake starts with an image and ends with a consequential business decision: accept, reject, or ask a person to review it. The apparent task, “read the fields,” hides several contracts. The upload may be blurry or rotated, a document may have several layouts, the same event may arrive twice, and an external AI provider may be slow or unavailable. Every decision also needs an explanation that can survive an audit.

FinPay is a reference design, not a report of a deployed system. A production-oriented design would treat the document as evidence, the database as the system of record, and the model as one fallible signal.

## Why Hard

There are two different kinds of uncertainty. Extraction uncertainty asks whether the model read `date_of_birth` correctly. Decision uncertainty asks what the business should do when the field is missing, the document is expired, or two checks disagree. Combining those questions in one prompt makes both hard to test.

Delivery semantics add another problem. Kafka can replay a message, consumers can crash after a database commit, and a retry can repeat an email, screening request, or review task. “The handler ran once” is not a reliable assumption.

## Naive Design

A tempting implementation puts everything in the upload request:

```java
DocumentResult result = vlm.extract(file);
if (result.confidence() > 0.8) accept(result);
else reject(result);
```

The HTTP thread uploads the file, calls the VLM, asks it for a fraud opinion, writes a decision, and returns a response. The threshold becomes the policy, the model becomes the decision-maker, and the request lifecycle becomes the workflow engine.

## Why It Breaks

The synchronous path couples user latency to provider latency and makes timeouts ambiguous: the client may retry while the first provider call is still running. A model can return plausible but false data, vary after a model or prompt change, or consume the rate limit during a traffic spike. A single confidence score does not explain which field failed or whether a deterministic rule contradicted it.

There is also a classic duplicate bug:

```java
if (!repository.exists(event.eventId())) { // WRONG: two consumers can both see false
    repository.save(event);
}
```

The `exists()` check and the insert are separate operations. Even if storage becomes idempotent, an email or provider call performed before the insert can still happen twice.

## Hard Problems

The useful boundary is not “AI versus no AI.” It is signal, policy, and decision:

```text
Document -> extraction signal -> policy evaluation -> business decision
             fields + confidence    rules + thresholds    accept/reject/review
```

Extraction should return typed fields, per-field confidence, provider/model metadata, and an explicit status such as `SUCCEEDED`, `PARTIAL`, or `UNREADABLE`. Deterministic checks should cover document type, checksum, expiry, required fields, and consistency. A judge model can assess a bounded question that rules cannot answer, but its output is still a signal. Policy maps signals to `ACCEPT`, `REJECT`, or `MANUAL_REVIEW`; the policy, not the model, owns the business decision.

The workflow must also define identity and retry behavior. An `event_id` identifies a delivery, while an `idempotency_key` can identify the intended intake operation. A transaction identifier ties all attempts to one business case.

## Trade-offs

An asynchronous workflow increases operational machinery and makes the API return a status rather than an immediate decision. That cost buys bounded request latency, durable retries, and isolation from provider outages. Human review increases completion time and staffing cost, but is safer than silently converting low confidence into rejection.

Keeping raw documents improves reprocessing and auditability, but increases privacy exposure and storage cost. Keeping only normalized fields minimizes data, but prevents some investigations. A production-oriented design should choose a retention period, encrypt the raw object, restrict access, and record why a reprocessing attempt occurred.

## Better Design

The proposed flow is:

```text
Kafka event -> intake worker -> DB transaction -> extraction -> rules -> policy
    replay source       DB = truth                         -> decision + outbox
                                                               -> Kafka -> OpenSearch
                                                                 read model
```

The event contains an `event_id` and an object reference such as an S3 key, not a web multipart object. The adapter creates an `IntakeCommand` and a `DocumentSnapshot`. A worker loads the object, calls ports such as `VisionExtractionPort` and (only when needed) `LlmJudgePort`, then persists the result and an outbox event.

The database is the system of record for the intake, attempts, decision, and audit facts. Kafka is the replayable event source for work and notifications. OpenSearch is a read model for operational search, not authoritative decision storage.

The real duplicate-safe write uses a unique constraint and an atomic insert, not a pre-check:

```sql
CREATE UNIQUE INDEX one_intake_per_key ON intake(event_id, idempotency_key);

INSERT INTO intake(event_id, idempotency_key, status)
VALUES (:event_id, :key, 'RECEIVED')
ON CONFLICT (event_id, idempotency_key) DO NOTHING;
```

Equivalent mechanisms include Redis `SETNX` with an expiry, an inbox table for consumed event IDs, or a transactional outbox for published facts. Select one according to the ownership and lifetime of the key. A unique insert makes storage idempotent; it does not make an external side effect idempotent. Provider calls need a provider-supported idempotency key where available, or a durable attempt record and a reconciliation policy. Outbox publication should be retried from committed state, and consumers should use an inbox or unique event constraint.

Version every AI-dependent result with `model_version` and `prompt_version`. Version the business mapping with `policy_version`. Store an audit record containing at least `transaction_id`, `event_id`, `model_version`, `prompt_version`, `policy_version`, `decision`, and `reason`, plus the input hash and timestamps. A replay should use the recorded versions when reproducing an old decision, while a deliberate re-evaluation creates a new attempt.

Timeouts, bounded retries with jitter, circuit breaking, and a provider rate limiter belong around each external call. A safe fallback is not “accept on error”: persist `AI_UNAVAILABLE` or `EXTRACTION_UNREADABLE` and route to manual review when policy permits. A dead-letter path must preserve the event and failure reason for inspection.

## Failure Scenarios

- A duplicate Kafka delivery hits the unique inbox constraint and produces no second intake or outbox event.
- A worker dies after committing extraction but before publishing. The outbox publisher later emits the event.
- A provider times out. The attempt records the timeout; retries are bounded. Exhaustion routes to review or a controlled failure state.
- The provider returns malformed JSON or a low-confidence field. Schema validation rejects the response, and policy can choose review without inventing a value.
- Kafka is replayed after a policy release. The old audit record remains immutable; a new policy version is an explicit new decision.
- OpenSearch is unavailable. Decisions remain queryable from the database; the projection consumer catches up later.
- A downstream notification is retried. Its consumer uses an idempotency key, and the notification provider receives a stable key if supported.

## Capacity

Capacity starts with measured workload, not a server count. For arrival rate `λ` and end-to-end latency `W`:

```text
Concurrency = Throughput x Latency = λ x W
```

At 20 documents/second and a 12-second workflow, roughly 240 workflow slots are in flight before headroom. If the VLM call occupies a worker for 3 seconds, its service needs about 60 concurrent call slots at that rate, subject to provider quotas. Size Kafka partitions and consumer concurrency for throughput, the database for write rate and connection limits, object storage for bytes and retention, and OpenSearch for indexing plus query load. Queue depth, oldest-message age, provider rate limits, and retry traffic are capacity signals. Backpressure should stop accepting work or slow consumers before the database or provider is overwhelmed.

## Security/Privacy

Identity documents contain PII and often sensitive biometric information. Use object references, short-lived scoped URLs, encryption in transit and at rest, strict service authorization, access logging, and retention/deletion controls. Minimize fields sent to external AI: crop or redact irrelevant regions, send only the needed image and question, and do not casually send the full transaction, account history, or unrelated customer data. Treat prompts and model responses as sensitive data, prevent prompt content from becoming executable instructions, and keep secrets out of logs. Human reviewers need least-privilege access and a defined export policy.

## Observability

System metrics should include intake throughput, queue depth, oldest event age, processing latency by stage, provider latency, timeout/retry/circuit-breaker counts, rate-limit responses, database conflicts, outbox lag, and OpenSearch indexing lag. AI metrics should include extraction status, per-field confidence distributions, schema-validation failures, fallback rate, token/cost estimates, and model/prompt versions in structured logs or dimensions with bounded cardinality.

Business metrics should include accept/reject/manual-review rates, reasons, review backlog and age, reprocessing rate, and disagreement between deterministic checks and AI signals. Do not use `transaction_id`, `account_id`, document number, or event ID as Prometheus labels. Put those identifiers in secured logs and trace context instead, with redaction and access controls. Traces should connect the intake, provider attempt, database transaction, outbox event, and projection without exposing raw document contents.

## Lessons

- Start with the failure and decision contract; introduce architecture only to satisfy it.
- Treat AI output as a versioned, typed signal. Policy owns the business decision.
- Use atomic uniqueness, inbox/outbox patterns, and provider idempotency separately because storage and side effects fail differently.
- Keep Kafka as replay source, the database as system of record, and OpenSearch as a rebuildable read model.
- Capacity, privacy, auditability, and observability are part of correctness for KYC, not post-production polish.
