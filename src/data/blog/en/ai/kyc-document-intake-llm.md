---
title: "From Ambiguous Documents to Auditable KYC Decisions"
description: "A practical design for extracting KYC fields from identity documents, validating them with deterministic rules, and routing uncertain cases to human review."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## The business problem is not OCR

Consider a customer opening a FinPay account. They upload an identity document and expect a quick answer: accepted, rejected, or waiting for review. The first feature request may sound small: read the name, document number, and date of birth.

The business problem is different. FinPay must make a decision from imperfect evidence and explain that decision later. The image may be blurry, cropped, rotated, or unfamiliar. A model may return a plausible but incorrect date. The same upload may be delivered twice. A provider may time out after the customer request has already been accepted.

The payment core already has a hard boundary: its database and ledger are authoritative for financial state. The document workflow must fit that boundary. AI may produce extracted fields, confidence values, classifications, or risk signals. It must not authorize a payment, update a balance, mutate the ledger, or silently decide KYC status.

The central engineering insight is this:

> Uncertainty is not an exception to hide. It is a workflow state to persist, explain, and resolve.

That gives us the correct direction:

```text
document -> AI signal -> deterministic policy -> KYC state -> financial boundary
            fields +       rules +             accept/reject/
            confidence     thresholds          manual review
```

A confidence score describes the model's uncertainty about extraction. It is not permission to perform a business action.

## The obvious design, and the failure it creates

The first implementation proposal is synchronous:

```java
DocumentResult result = vlm.extract(file);
if (result.confidence() > 0.8) {
    accept(result);
} else {
    reject(result);
}
```

It looks attractive because the upload response contains the answer. It also hides three dangerous assumptions:

- Provider latency is stable enough to put in the customer request.
- One aggregate score is a sufficient KYC policy.
- A model response is safe to turn into an irreversible decision.

None of those assumptions is safe. A model can be confident about the name and uncertain about the expiry date. A single score loses that distinction. More importantly, an external AI call is an unreliable dependency, not a transaction participant in FinPay's ledger.

For capacity reasoning only, assume an illustrative arrival rate of 20 documents per second, a 3-second VLM call, and a 12-second end-to-end workflow. The VLM stage would hold roughly `20 x 3 = 60` concurrent calls; the workflow would have roughly `20 x 12 = 240` cases in flight. These are assumptions for the example, not FinPay production measurements.

Now suppose provider latency rises from 300 ms to 4 seconds at 14:03. Request threads or virtual threads remain occupied. Clients time out and retry. The original calls may still be running when the retries arrive, so provider quota, connection pools, and worker capacity all see amplified load. The gateway has no durable record distinguishing “not received” from “received but still processing.”

Increasing the HTTP timeout only keeps the failure in the request path longer. Rejecting every timeout protects against accepting bad evidence, but turns an infrastructure failure into an unexplained customer rejection. Calling a second model improves availability at the cost of more provider traffic and may reproduce the same interpretation error.

The first decision is therefore not “which model should we use?” It is “which part of the process may remain synchronous?”

## Constraints before components

For this design example, the constraints are:

- Upload acknowledgement must be bounded and must not wait for the full VLM workflow.
- Delivery may be at-least-once, so duplicate intake events must be harmless.
- Extraction must return typed fields and per-field confidence, not one opaque score.
- Schema errors and impossible values must fail extraction; they must not become invented data.
- Deterministic rules own acceptance and rejection. AI unavailability needs an explicit degraded path.
- `MANUAL_REVIEW` is a valid business state, not a disguised error.
- The raw document is PII. Storage, provider access, reprocessing, retention, and deletion require controls.
- Intake status, decisions, and audit facts must be recoverable from authoritative storage.

These constraints extend the shared FinPay model. The payment core and ledger remain the source of truth for money movement. The shared AI layer can provide ports, timeouts, retry budgets, concurrency limits, and common audit fields. This workflow applies those contracts; it does not create a second financial authority.

## Make the model produce evidence, not a verdict

The VLM receives a narrow question: which fields can be read, with what confidence? A typed response may contain normalized name, document number, date of birth, expiry date, document type, per-field confidence, provider and model metadata, and `SUCCEEDED`, `PARTIAL`, or `UNREADABLE` status.

Validate the response schema before policy evaluation. Malformed JSON, an impossible date, or a wrong field type is an extraction failure. It is not a reason to fill in a likely value. Text printed in an image is untrusted data, not an instruction to the application; prompts are not a security boundary.

The policy engine evaluates facts it can own: required fields, document type, expiry, checksum, country-specific format, and consistency with customer-submitted data. A bounded secondary model call may add a signal for a question deterministic checks cannot answer, but the signal remains advisory.

```text
typed AI fields + deterministic checks + optional signal
                         |
                   policy_version
                         v
              ACCEPT / REJECT / MANUAL_REVIEW
```

An expired document may be rejected. A missing expiry date may require review. A provider timeout may lead to review if policy and staffing allow it. The exact mapping is a product and compliance decision. The invariant is stronger: no AI response directly mutates KYC state outside the deterministic state machine, and no KYC result directly mutates financial state.

## Choose asynchronous processing, then accept its cost

The upload API can store the object reference and an intake row with `RECEIVED`, commit a work event, and return a status resource. A worker later loads the document, calls the extraction port, validates the signal, evaluates policy, and records the outcome.

Synchronous processing is simpler and can be reasonable for a fast internal check with a reliable dependency. It is a poor fit here because provider latency is variable and human review has no useful upper bound for an HTTP request. Async processing converts customer-facing latency into workflow latency, but it also introduces duplicate delivery and crash recovery as correctness problems.

This check is unsafe:

```java
if (!repository.exists(event.eventId())) { // WRONG: both workers can see false
    repository.save(event);
}
```

Two workers can observe absence before either insert. Let an atomic uniqueness constraint decide:

```sql
CREATE UNIQUE INDEX one_intake_per_key ON intake(event_id, idempotency_key);

INSERT INTO intake(event_id, idempotency_key, status)
VALUES (:event_id, :key, 'RECEIVED')
ON CONFLICT (event_id, idempotency_key) DO NOTHING;
```

`event_id` identifies a delivery. `idempotency_key` identifies the intended intake operation. A case identifier links attempts to one business case. The unique insert protects the database write; it does not undo a provider call that happened before a crash. External side effects need a provider-supported stable key where available, or a durable attempt record and reconciliation policy.

The same crash window explains the outbox. If a worker commits a decision and dies before publishing `KycDecisionRecorded`, the database contains the truth but downstream consumers do not know it exists. An outbox row committed in the same transaction can be published later. Since its publisher can publish twice, consumers still need an inbox or unique event constraint. Solving duplicate intake creates a second duplicate boundary that must also be designed.

## The new failure: AI outage becomes queue pressure

Async processing removes provider latency from the upload request. It does not remove the provider failure. If workers retry without limits, a provider incident fills the queue, consumes database connections, and delays healthy work. The system has traded request timeouts for backlog growth.

Each external call therefore gets a deadline inside the workflow deadline, bounded retries with exponential backoff and jitter, a concurrency limit, a rate limiter, and a retry budget. A circuit breaker stops known provider failures from consuming every slot. After the budget is exhausted, a dead-letter path preserves the event and reason for controlled recovery.

The degraded state must be explicit. A normal document might enter `MANUAL_REVIEW` with reason `AI_UNAVAILABLE`. A higher-risk case might remain held until another check succeeds. “Accept on error” and “reject on error” are both policy choices, not universal defaults. What is unacceptable is silently labeling an infrastructure failure as customer evidence.

Each attempt records `model_version`, `prompt_version`, input hash, extraction status, and timestamps. The decision records `policy_version`, checks, outcome, and reason. Re-evaluation creates a new attempt and preserves the old audit fact. A model update changes the evidence; replay is a new business event, not a rewrite of history.

Keeping encrypted raw documents helps investigation and reprocessing but increases PII exposure and storage cost. Keeping only normalized fields reduces exposure but removes evidence. A production-oriented design would choose a retention period, use short-lived scoped access, log reviewer access, restrict reprocessing, and delete on schedule. Only the required image region and question should go to an external provider.

## Architecture that follows from the failures

```text
Upload API -> object storage + DB intake -> work event -> intake worker
                  DB = business truth       replayable       |
                                                           v
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

Each box has a reason. Object storage avoids putting a large PII payload in the work event. The database owns intake status, attempts, decisions, and audit facts. The work event gives durable scheduling and replay. The extraction port isolates provider-specific behavior and resilience controls. The policy engine is the authority for the KYC state. The review queue makes uncertainty actionable. OpenSearch is a rebuildable operational read model, never authoritative decision storage.

Review-task creation follows the same state-machine rule. Replaying a decision must not create five tasks. Claiming uses an atomic `OPEN -> CLAIMED` transition with an owner and expiry or recovery path. A second resolution callback sees a terminal state and becomes a no-op.

## Follow one failure through the system

At 14:03:10, a worker commits an extraction attempt and decision, then dies before its outbox publish. The intake and audit rows already exist, so recovery must publish the outbox, not call the VLM again. If publishing happens twice, the projection inbox accepts one copy. If OpenSearch is unavailable, projection lag increases while the database remains authoritative.

In a different incident, the provider times out. The worker records the failed attempt, retries within budget, and releases capacity between attempts. When the budget ends, policy selects `MANUAL_REVIEW` or a controlled failure state. The review queue shows `AI_UNAVAILABLE`, not a fabricated confidence. Operators can replay the original event with its attempt metadata.

## Capacity, backpressure, and on-call signals

For arrival rate `lambda` and stage latency `W`, Little’s Law gives a useful approximation:

```text
in_flight_concurrency = throughput x latency = lambda x W
```

With the illustrative 20 documents per second and 12-second workflow, roughly 240 cases are in flight before headroom. A 3-second VLM stage needs roughly 60 concurrent call slots at that arrival rate. The real limit may be lower because of provider quota, database connections, memory, or cost budget.

Measure queue depth and oldest-event age, not CPU alone. Track provider latency and rate-limit responses, retry volume, worker concurrency, database connection utilization, outbox lag, projection lag, review backlog age, and dead-letter rate. When the provider slows, admission control must stop workers claiming unlimited work. Returning `PROCESSING` or deferring work is safer than overwhelming the recovery path and creating more duplicate PII copies.

Tracing should connect request ID, case ID, provider attempt, database transaction, outbox record, and projection. Put model and policy versions in structured fields. Do not use document number, account ID, event ID, or trace ID as Prometheus labels. Audit records should include decision, reason, versions, hashes, timestamps, and correlation identifiers, but not raw document contents by default.

Security follows the data flow: authenticate the uploader, authorize by tenant and case, use scoped short-lived object access, encrypt data, log access, enforce retention, and grant least privilege. Treat image text and model output as untrusted data. Validate structured output and constrain the fields policy can read. Never execute instructions found in a document or model response.

## What we learned

The difficult choice was not the VLM. It was refusing to turn “the model extracted a field with confidence 0.86” into “FinPay should accept this customer.” Once uncertainty became a persisted workflow state, the architecture emerged from concrete failures: async processing bounded provider latency, atomic idempotency handled duplicate delivery, the outbox protected committed decisions, and manual review gave uncertainty a controlled destination.

This is one bounded use case in FinPay’s shared AI layer. The payment core and ledger remain the source of truth for money movement. The document workflow contributes versioned signals and an auditable KYC decision through deterministic policy. AI can be slow, unavailable, nondeterministic, or wrong. The surrounding system must make each condition visible without allowing it to cross the financial side-effect boundary.
