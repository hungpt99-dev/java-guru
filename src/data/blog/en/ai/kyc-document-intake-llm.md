---
title: "From Ambiguous Documents to Auditable KYC Decisions"
description: "A practical design for extracting KYC fields from identity documents, validating them with deterministic rules, and routing uncertain cases to human review."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## The first uncomfortable question

Suppose a customer uploads an identity document while opening a FinPay account. The product wants a quick answer: accept, reject, or ask an operator to review it. “Read the name and date of birth” sounds like an image-processing feature. It is actually a decision workflow around evidence.

The image can be rotated, cropped, blurry, or laid out differently from the previous document. A model can read a plausible date incorrectly. The same upload event can be delivered twice. The provider can take seconds to respond or be unavailable. Yet the final KYC decision must be explainable later: which document was used, which checks ran, which model and policy versions produced the result, and why a person was asked to intervene.

FinPay is a fictional reference system, not a report of a deployed incident. The useful design exercise is to start from those constraints. The existing payment core already treats its database and ledger as authoritative for financial state. This document workflow must fit that system: AI can produce a risk or extraction signal, but it cannot mutate an account, authorize a payment, or change a ledger or settlement state.

The central distinction is simple and easy to lose:

```text
document -> extraction signal -> deterministic policy -> KYC decision
              fields + confidence    rules + thresholds    accept/reject/review
```

A confidence score describes the model’s uncertainty about extraction. It is not a business decision.

## The design that looks reasonable

The first implementation proposal is usually synchronous. The upload endpoint stores the multipart file, calls a vision-language model (VLM), asks the model whether the document looks genuine, and writes the result before returning HTTP 200:

```java
DocumentResult result = vlm.extract(file);
if (result.confidence() > 0.8) accept(result);
else reject(result);
```

That snippet has two hidden decisions. It makes provider latency part of customer-facing latency, and it turns an arbitrary aggregate confidence threshold into policy. Worse, it allows a model response to become an irreversible business action. It is not a safe boundary for FinPay.

Assume, only for capacity reasoning, that an example workload reaches 20 documents per second and a VLM call takes 3 seconds. That stage creates about `20 x 3 = 60` concurrent provider calls. If the end-to-end workflow takes 12 seconds, about `20 x 12 = 240` workflow cases are in flight. These are design assumptions, not FinPay production measurements.

Now imagine the provider latency rises from 300 ms to 4 seconds at 14:03. Synchronous request threads or virtual threads remain occupied longer, client timeouts begin, and clients retry. The first calls may still be running when the retries arrive. Connection pools and provider quotas see the multiplied load. A retry storm makes the outage harder to recover from, while the gateway still has no durable representation of work that was accepted but not finished.

Making the endpoint wait longer is not a fix. It increases the timeout budget and customer frustration. Failing every request is safer than guessing, but unnecessarily rejects customers when a human could resolve the case. Calling a second model immediately improves availability only by increasing cost and may repeat the same bad interpretation. The important choice is to remove the unreliable, slow operation from the upload request while preserving an explicit business outcome.

## Constraints before components

For this example, the design has these constraints:

- The upload response must be bounded and must not depend on a full VLM workflow.
- A document intake must be processed more than once safely because delivery is at-least-once in practice.
- Financial and identity decisions need immutable audit facts, not just the latest row.
- Extraction needs typed fields and per-field confidence, not one opaque score.
- Deterministic checks own acceptance and rejection. AI unavailability must have a defined degraded mode.
- Raw documents are PII. Access, retention, reprocessing, and external-provider sharing need explicit controls.
- Human review is a valid outcome, not an error disguised as rejection.

There are also boundaries from the wider FinPay series. The AI core supplies ports, resilience controls, and common audit fields. The idempotency model distinguishes storage deduplication from side-effect deduplication. This article applies those contracts to document intake; it does not create a separate AI architecture.

## From extraction to a decision

The VLM should answer a narrow, typed question: “What fields can be read from this document, and how certain is each field?” A response might include normalized name, document number, date of birth, expiry date, document type, a per-field confidence, provider/model metadata, and an extraction status such as `SUCCEEDED`, `PARTIAL`, or `UNREADABLE`.

Schema validation must happen before policy evaluation. Malformed JSON, an impossible date, or a field with the wrong type is an extraction failure, not a reason to invent a value. Prompt instructions are also not a security boundary: text printed on a document or embedded in an image must be treated as untrusted content, not as instructions to the application.

Rules then evaluate facts they can own: required fields, document type, expiry, checksum, country-specific format, and consistency with the customer’s submitted data. A bounded judge-model call may provide an additional signal for a question deterministic rules cannot answer, but it remains a signal.

The policy combines these inputs:

```text
VLM fields + per-field confidence + deterministic checks + optional judge signal
                                      |
                              policy_version
                                      v
                         ACCEPT / REJECT / MANUAL_REVIEW
```

For example, a missing expiry date may require review; an expired document may be rejected; a provider timeout may route to review rather than reject a customer without evidence. The exact mapping is a product and compliance decision. The important invariant is that no model response directly updates financial state or KYC state outside the deterministic state machine.

## Why asynchronous processing is worth its cost

The upload endpoint can persist an intake with status `RECEIVED` and return a status resource. A worker later loads the object, performs extraction, evaluates policy, and records the decision. Synchronous processing would be simpler to deploy and gives an immediate result, so it remains reasonable for a fast, highly available internal check. Here, the provider’s variable latency, retry behavior, and human-review branch make it a poor fit for the customer request.

The asynchronous choice introduces a new problem: messages can be delivered twice, and a worker can die at any point. At-least-once delivery is useful because losing a KYC intake is worse than retrying it, but it means “the handler ran once” is not a correctness guarantee.

This check is unsafe:

```java
if (!repository.exists(event.eventId())) { // WRONG: two consumers can both see false
    repository.save(event);
}
```

Two workers can observe absence before either inserts. Use an atomic uniqueness constraint for the business key and make the insert the decision:

```sql
CREATE UNIQUE INDEX one_intake_per_key ON intake(event_id, idempotency_key);

INSERT INTO intake(event_id, idempotency_key, status)
VALUES (:event_id, :key, 'RECEIVED')
ON CONFLICT (event_id, idempotency_key) DO NOTHING;
```

The key needs a clear meaning. `event_id` identifies a delivery; `idempotency_key` identifies the intended intake operation; a transaction or case identifier connects attempts to one business case. A unique insert makes the database write idempotent. It does not make an email, screening request, or provider call idempotent when that side effect happened before a crash. Those calls need a provider-supported stable key where available, or a durable attempt record plus reconciliation policy.

The same reasoning leads to an outbox. If the worker commits a decision and crashes before publishing `KycDecisionRecorded`, the database has the truth but downstream consumers do not know it exists. An outbox row committed in the same database transaction can be published later. Its publisher can also repeat a publish, so consumers still need an inbox or unique event constraint. The solution to one duplicate problem creates another boundary to make explicit.

## AI failure is a workflow state

Retries are useful for transient timeouts, but unlimited retries turn a provider incident into FinPay’s incident. Each external call gets a deadline inside the overall workflow timeout, bounded retries with exponential backoff and jitter, a concurrency limit, a rate limiter, and a retry budget. A circuit breaker prevents known provider failure from consuming all available slots. A dead-letter path preserves the event and failure reason after the budget is exhausted.

The degraded outcome depends on the operation’s risk. For an ordinary document with an unavailable model, route to `MANUAL_REVIEW` if staffing and policy allow it. For a high-risk document, policy may hold the case until an additional check succeeds. Neither “accept on error” nor “reject on error” is universally correct. What must not happen is silently converting an infrastructure failure into a customer rejection with no audit reason.

Every AI-dependent attempt records `model_version`, `prompt_version`, input hash, extraction status, and timestamps. The decision records `policy_version`, the checks, the outcome, and the reason. A replay of an old decision uses the recorded versions when reproducibility matters. A deliberate re-evaluation creates a new attempt and does not overwrite the old audit fact. Model updates can change output, so “re-run” is a new business event, not a repair of history.

Raw retention is another trade-off. Keeping the encrypted object makes investigation and reprocessing possible, but increases PII exposure and storage cost. Keeping only normalized fields reduces exposure but limits evidence. A production-oriented design would select a retention period, use short-lived scoped access, log every reviewer access, restrict who can trigger reprocessing, and delete on schedule. Only the required image region and question should be sent to an external provider; unrelated account history does not belong in a KYC prompt.

## The architecture after the reasoning

Only now do the boundaries become useful:

```text
Upload API -> object storage + DB intake -> work event -> intake worker
                  DB = business truth       replayable       |
                                                           V
                                                VLM extraction port
                                                           |
                                                typed signal + audit
                                                           |
                                            deterministic policy engine
                                                           |
                                  ACCEPT / REJECT / MANUAL_REVIEW
                                             |             |
                                      DB + outbox      review queue
                                             |
                                  decision event -> projection
                                                   OpenSearch
```

The upload event carries an object reference, such as an S3 key, rather than a multipart object. The adapter maps it to an `IntakeCommand` and a document snapshot. The database is authoritative for intake status, attempts, decisions, and audit facts. The event stream is useful for durable work, replay, and notifications. OpenSearch is a rebuildable operational read model, not authoritative decision storage. If its cluster is unavailable, decisions remain available from the database and projection lag is observable.

A review task must also be idempotent. Replaying a decision event must not create five tasks for one case. Claiming a task needs an atomic state transition such as `OPEN -> CLAIMED`, an owner, and an expiry or recovery path if the reviewer disappears. A reviewer can resolve the task once; a second callback sees the terminal state and becomes a no-op. Human involvement changes the latency and staffing model, but not the need for deterministic state transitions.

## A concrete propagation path

Consider a worker that commits extraction at 14:03:10 and dies before its outbox publish. The intake row and audit attempt are committed, so the worker does not need to call the VLM again merely because publishing failed. The outbox publisher emits the decision after recovery. If the publisher emits twice, the projection’s inbox constraint accepts one copy. If OpenSearch is down, its lag grows while the database remains authoritative.

Now consider a provider timeout. The worker records the failed attempt, retries only within its budget, and releases capacity between attempts. Once the budget is exhausted, policy chooses manual review or a controlled failure state. The review queue shows the reason `AI_UNAVAILABLE`; it does not show a fabricated confidence score. A replay can inspect the original event and attempt metadata. This is the operational value of separating signal, decision, and side effect.

## Capacity and backpressure

For arrival rate `lambda` and stage latency `W`, Little’s Law gives the useful approximation:

```text
in_flight_concurrency = throughput x latency = lambda x W
```

At an illustrative 20 documents per second and a 12-second workflow, about 240 cases are in flight before headroom. If the VLM stage occupies a call slot for 3 seconds, that stage needs about 60 concurrent slots at that arrival rate. The actual limit may be lower because of provider quotas, database connections, memory, or a cost budget.

Measure queue depth and oldest-message age, not only CPU. Also watch provider latency and rate-limit responses, retry volume, worker concurrency, database connection utilization, outbox lag, review backlog age, and dead-letter rate. When the provider slows, the worker must stop claiming unlimited new work. Bounded queues and admission control let FinPay return `PROCESSING` or defer work instead of overwhelming the database and provider. Backpressure is part of correctness because an overloaded recovery path can create more duplicate attempts and more PII copies.

## What an on-call engineer needs at 3 AM

Metrics should show upload throughput, queue depth, oldest event age, processing latency by stage, provider timeout and error rates, circuit-breaker state, rate-limit responses, database uniqueness conflicts, outbox lag, projection lag, review backlog, and duplicate delivery rate. AI quality signals include schema-validation failures, extraction status, per-field confidence distributions, fallback rate, and bounded model/prompt dimensions. Token and cost estimates help detect a prompt or image-size regression.

Business dashboards should separate `ACCEPT`, `REJECT`, and `MANUAL_REVIEW` by bounded reason codes. A sudden rise in `AI_UNAVAILABLE`, or a sharp change after a model version rollout, is more actionable than a single average confidence number.

Tracing connects request ID, intake/case ID, provider attempt, database transaction, outbox record, and projection. Put model and policy versions in structured data. Do not use document number, account ID, transaction ID, event ID, or trace ID as Prometheus labels; keep them in protected logs and trace context with redaction. Audit records need the decision, reason, versions, hashes, timestamps, and correlation identifiers, but never raw document contents by default.

Security follows the data flow. Authenticate the uploader and authorize access by tenant and case. Use short-lived scoped object URLs, encryption in transit and at rest, secret management, access logs, retention/deletion controls, and least privilege for workers and reviewers. Treat image text and model output as untrusted data. Validate structured output, constrain what fields policy can read, and never execute instructions found in a document or prompt. Keep raw documents out of unrelated AI calls and out of ordinary application logs.

## The lesson

The hard part was not choosing a VLM. It was refusing to confuse “the model extracted a field with 0.86 confidence” with “FinPay should accept this customer.” Once that distinction was explicit, the rest followed from failures: asynchronous work bounded provider latency, at-least-once delivery required atomic idempotency, outbox publication protected committed decisions, and uncertainty became a review queue rather than a hidden rejection.

This is one bounded use case in FinPay’s shared AI layer. The payment core and ledger remain the source of truth for money movement. The document workflow contributes versioned signals and an auditable KYC decision through deterministic policy. AI can be slow, unavailable, nondeterministic, or wrong; the surrounding system must make each of those conditions visible and safe.
