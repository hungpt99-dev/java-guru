---
title: "Designing Ledger Anomaly Detection with Kafka and Prometheus"
description: "A guarded design for scoring ledger events asynchronously without putting AI on the money path."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> **Repository:** https://github.com/finpay-lab/ledger-service

# Ledger anomaly detection: from risk to a bounded design

Anomaly detection sounds like a model-integration problem. In a ledger, it is first a reliability and accountability problem: suspicious activity should be surfaced early, but a slow, wrong, unavailable, or non-repeatable AI provider must not corrupt posting or silently move money.

This article separates the supplied repository facts from a production-oriented design proposal. FinPay is treated as a reference/fictional context; this is not a claim that the proposal was deployed.

## 1. Problem

**[SOURCE FACT]** The supplied description identifies `ledger-service` as a Spring Boot service. Each payment is recorded as a double-entry `debit`/`credit` pair in one database transaction. Ledger events are published to Kafka on `ledger.events` and are searchable in OpenSearch. The stated goal is to flag suspicious patterns before reconciliation and the 2 AM batch job.

The useful outcome is not “the model said yes.” It is a traceable pipeline:

```text
ledger event -> AI signal -> deterministic policy -> business decision
```

The signal may request investigation. Policy may choose `ALLOW`, `REVIEW`, or `HOLD`, subject to evidence and possibly human approval. AI must not directly call `hold`, `block`, or `reject`.

## 2. Why hard

There are several independent failure sources:

- **False positives:** a legitimate large payment can look unusual and create operational or customer harm.
- **False negatives:** an attacker can pass a detector; “not suspicious” is not proof of safety.
- **Nondeterminism:** the same input can produce different output after sampling, provider changes, or prompt changes. A verdict needs a model, prompt, and policy version.
- **Latency and cost:** remote inference adds variable latency and a per-request cost. Rate limits, quotas, provider outages, timeouts, and partial responses are normal cases, not theoretical exceptions.
- **Delivery semantics:** Kafka commonly delivers at least once. A timeout after a side effect can be followed by a retry, so “called once” cannot be the correctness model.
- **Privacy:** a full transaction may contain PII or sensitive counterparties. Sending it casually to an external AI provider expands the data boundary.

## 3. Naive design

The tempting design calls the model after posting and lets its answer trigger a hold:

```java
// WRONG: AI is synchronous, decides money, and uses a hardcoded secret.
@Transactional
public void postLedger(PaymentEvent event) {
    ledger.post(debit(event), credit(event));
    String answer = openAi.ask(prompt(event), "sk-proj-...");
    if ("YES".equals(answer)) fundsService.hold(event.eventId());
    audit.save(new AuditRow(event.eventId(), answer));
}
```

## 4. Why it breaks

The database transaction remains open while an uncontrolled network call runs. If model p95 is 2 seconds, that wait can hold locks and connections for 2 seconds; retries multiply the damage. Provider failure becomes a ledger failure, and a hung socket can exhaust consumer or request workers.

The string `YES` has no calibrated meaning, schema validation, confidence policy, or human boundary. A provider update can change behavior without a code deploy. The secret can be committed or logged. The audit record is coupled to the money transaction, so the record may disappear on rollback or never be written after a timeout.

Finally, Kafka redelivery can execute `post` and `hold` again. An `exists()` check is not idempotency:

```java
// WRONG: two consumers can both observe false before either saves.
if (!store.exists(event.eventId())) {
    store.save(record); // check-then-act race
}
```

## 5. Hard problems

### Idempotent storage is not idempotent side effects

For a detector record, use a durable uniqueness mechanism. Depending on the system of record, that can be a database unique constraint on `(event_id, processing_kind)`, an atomic insert/upsert, Kafka inbox table, or `SETNX` with an expiry and a durable outcome. An outbox can atomically stage publication with the ledger commit; an idempotency key can protect an API command.

The real boundary is atomic, for example:

```sql
-- RIGHT: the database arbitrates concurrent deliveries.
INSERT INTO anomaly_results(event_id, model_version, decision, reason)
VALUES (:event_id, :model, :decision, :reason)
ON CONFLICT (event_id, processing_kind) DO NOTHING;
```

Only the transaction that wins the insert should create the result. If the result is stored in OpenSearch, a deterministic document ID plus create-only semantics can make the document write replay-safe, but it does not make an external `hold` call safe. That side effect needs its own idempotency key, provider-supported idempotency, or a transactional command/outbox and a status machine. Storage idempotency and side-effect idempotency are separate guarantees.

### Capacity and backpressure

The detector must be sized from measured or explicitly assumed throughput and latency:

```text
Concurrency = Throughput x Latency
```

At 100 events/second and 2 seconds of end-to-end scoring latency, about 200 in-flight workers are required before retries, batching, and headroom. A fixed pool of four cannot meet that load without growing Kafka lag; blindly adding workers can hit provider rate limits and increase cost. Bound concurrency, use quotas, pause or slow consumption, and define what happens when lag exceeds the review SLA.

Kafka is the replay source, not the financial system of record. The database remains the system of record for ledger state. OpenSearch is a read model for investigation and search, so it can be rebuilt from Kafka/database-derived events and must not be the authority for posting.

### Versioning, privacy, and policy

Persist `model_version` and `prompt_version` with every signal. Also persist `policy_version`, because a policy change can alter a business decision without changing the model. Use a stable input schema and validate structured output; unknown, malformed, or low-confidence output is a first-class outcome.

Minimize data sent outside the trust boundary: prefer derived features, tokenized identifiers, amount bands, and the minimum time window needed. Do not send a full transaction to an external AI service casually. Apply retention, access control, encryption, provider terms, and redaction to PII. Never put prompts, account identifiers, or secrets in ordinary logs.

## 6. Trade-offs

- **Synchronous scoring** gives an immediate signal but couples money availability to provider latency and availability. Asynchronous scoring adds lag and requires a review/hold workflow.
- **Rules only** are cheap, explainable, and predictable but miss novel patterns. AI can add a useful signal but costs more and is harder to reproduce.
- **Fail open** preserves posting when detection is unavailable but can increase missed detections. **Fail closed** protects more aggressively but can become a payment outage. The policy must choose explicitly by risk tier; a generic fallback is not a business decision.
- **OpenSearch overwrite by event ID** is simple for a current read model. Append-only audit records are better for historical accountability and correction history.

## 7. Better design

Keep the money transaction small:

```java
// RIGHT: only the double-entry invariant is on the money path.
@Transactional
public void post(LedgerCommand cmd) {
    ledger.entry(new Entry(cmd.eventId(), DEBIT, cmd.partyId(), cmd.amount()));
    ledger.entry(new Entry(cmd.eventId(), CREDIT, cmd.counterparty(), cmd.amount()));
}
```

A production-oriented boundary would use an outbox if publication must be coordinated with commit:

```text
DB transaction: debit + credit + outbox(event_id)
                         |
                         v
Kafka ledger.events  (replay source)
                         |
                         v
consumer -> bounded AI adapter -> rule fallback -> signal store
                                      |                 |
                                      v                 v
                                  policy service     OpenSearch read model
                                      |
                              review / idempotent side effect
```

The consumer claims `(event_id, processing_kind)` atomically, then invokes an adapter behind a small domain port. The adapter enforces a deadline, retries only bounded transient failures, opens a circuit when the provider is unhealthy, and returns a deterministic rule result or `UNKNOWN` on failure. Rate limits and cost budgets are enforced before sending work. A dead-letter path preserves poison events for later replay.

The signal and decision are separate records. An append-only audit entry should contain at least:

```text
transaction_id, event_id, model_version, prompt_version,
policy_version, decision, reason
```

It should also identify the signal/provider, timestamps, evidence reference, fallback status, and human override where applicable. If an audit write fails, alert and retry it through a durable path; do not pretend that a missing audit is success.

## 8. Failure and recovery

The design must answer failures rather than hide them:

- A provider timeout returns `UNKNOWN` or rule-based scoring after bounded retries; posting is unaffected, and the event remains auditable.
- A rate-limit response backs off or pauses the detector, instead of retrying unboundedly and amplifying load.
- A consumer crash after the model call causes redelivery. The unique result claim prevents duplicate storage; an idempotency key or outbox protects any business side effect.
- A malformed response is rejected and recorded, not coerced into `YES`.
- OpenSearch downtime pauses or retries the read-model sink while Kafka retains the replayable event. The database remains authoritative.
- A model or prompt rollout is canaried or shadowed, with versions recorded so policy can compare outcomes and replay historical inputs.

## 9. Observability

Measure both business behavior and system health. Useful bounded Prometheus labels include `provider`, `model_version`, `outcome`, `fallback`, `reason_code`, and `topic`; never use `transaction_id`, `event_id`, or `account_id` as labels.

Business metrics: anomaly signal rate, review rate, hold rate, false-positive/false-negative samples when labels arrive, and decision latency against the review SLA. System metrics: consumer lag, throughput, in-flight concurrency, scoring latency, timeout/retry counts, provider errors, rate-limit responses, circuit state, cost estimate, duplicate claims, DLQ count, and audit/read-model failures.

## 10. Lessons and interview questions

Lessons:

1. Protect the money path first; AI is an advisory signal.
2. Kafka is replayable transport, the database is ledger authority, and OpenSearch is a rebuildable read model.
3. `exists()` followed by `save()` is a race; uniqueness and atomic claims are the real guardrail.
4. Idempotent storage does not make a hold, email, or webhook idempotent.
5. Version models, prompts, policies, evidence, and decisions for auditability.
6. Capacity, privacy, rate limits, and failure behavior are part of the AI design.

Interview questions:

- Where is the atomic boundary between an event claim and its result?
- What happens when the provider times out after accepting the request?
- How does `Concurrency = Throughput x Latency` change worker and quota sizing?
- Which outcomes fail open or closed for each risk tier, and who owns that policy?
- Can a reviewer reproduce why a decision was made six months later without exposing unnecessary PII?
