---
title: "Designing Ledger Anomaly Detection with Kafka and Prometheus"
description: "A guarded design for scoring ledger events asynchronously without putting AI on the money path."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> **Repository:** https://github.com/finpay-lab/ledger-service

## The Incident We Are Trying to Prevent

FinPay already has a payment core. Its important invariant is simple: a posted payment creates balanced debit and credit entries in one database transaction. The ledger database is the source of truth for money. That invariant existed before AI entered the design.

Now consider an operations review. A new beneficiary receives several unusually large payments within minutes. The account rules allow every payment, so posting succeeds. The signal is useful, but it arrives too late if the team sees it only in the 2 AM batch review. At the same time, a model must not be allowed to edit a balance or settle funds because it thinks a payment looks suspicious.

The design problem is therefore not “how do we make the ledger intelligent?” It is narrower: how do we add a timely, auditable signal without making an unreliable dependency part of the financial transaction?

For this article, the repository description is the source fact: `ledger-service` is described as a Spring Boot service that records a payment as a double-entry `debit`/`credit` pair in one database transaction, publishes ledger events to Kafka on `ledger.events`, and makes events searchable in OpenSearch. FinPay is fictional; the production-oriented flow below is a proposed design, not a claim about deployed behavior.

The boundary we want is deliberately asymmetric:

```text
ledger event -> AI signal -> deterministic policy -> business state transition
                                      |
                                      v
                              REVIEW / HOLD command
                                      |
                                      v
                               ledger / settlement
```

AI may return `SUSPICIOUS`, `NORMAL`, or `UNKNOWN`, with bounded evidence and a score. It cannot call `hold`, reject a payment, post a ledger entry, change a balance, or settle funds. Policy decides what the signal means, and the payment state machine decides whether a legal transition exists.

## The Obvious Design Fails in the Money Path

The first implementation is attractive because it gives an immediate answer:

```java
// WRONG: provider latency and an untrusted answer control money.
@Transactional
public void postLedger(PaymentEvent event) {
    ledger.post(debit(event), credit(event));
    String answer = openAi.ask(prompt(event), "sk-proj-...");
    if ("YES".equals(answer)) fundsService.hold(event.eventId());
    audit.save(new AuditRow(event.eventId(), answer));
}
```

That code mixes four different responsibilities: posting money, calling a remote provider, interpreting free-form output, and issuing a financial side effect. The failure mode is not theoretical. If provider latency is a **design assumption** of 2 seconds, the database transaction can retain a connection and locks while it waits. With an assumed 10,000 payments per second, 200 ms of synchronous work implies roughly `10,000 x 0.2 = 2,000` in-flight calls. At 2 seconds it implies about 20,000, before retries and headroom. These are capacity examples, not FinPay measurements.

Now follow a slowdown. In a hypothetical 14:03 incident, provider latency rises from 300 ms to 4 seconds. Request workers wait. The connection pool fills. Gateway timeouts cause retries, and retries increase provider load. A timeout may leave the caller unsure whether a request completed, so a retried payment or hold can be duplicated. Meanwhile, `YES` is not a durable contract: output can be malformed, nondeterministic, or different after a prompt or model version changes.

The audit write fails in two opposite ways. If it shares the ledger transaction, a rollback can erase evidence that scoring was attempted. If it happens after the remote call, a timeout or process crash can prevent it entirely. The hardcoded secret adds an avoidable security failure: source control, logs, or exception text can expose it.

The lesson from the naive design is not merely “use Kafka.” It is that the money transaction must not wait for, interpret, or trust an AI response.

## Constraints Before Components

The reference design has these explicit constraints:

- The ledger database remains authoritative for posted money. Double-entry balance and deterministic settlement do not depend on AI availability.
- Scoring may be delayed, duplicated, or unavailable. The input and outcome need durable audit and replay.
- AI output is untrusted input. It needs a schema, version, bounded deadline, and explicit `UNKNOWN` handling.
- Provider quota, concurrency, and cost are finite. Queue depth cannot justify unlimited calls.
- Payment data may contain PII and sensitive counterparty data. The provider receives only the minimum useful feature set.
- Review has an SLA. “Async” cannot mean “whenever it eventually finishes.”

These are proposed constraints, not production measurements. Limits must come from load tests, provider contracts, and the business risk model.

## The Boundary Decision

There are three plausible choices.

**Synchronous scoring** gives an immediate signal, but couples authorization to provider latency and availability. It may be appropriate for a specific high-risk pre-authorization check, provided the deadline and degraded behavior are explicit. It is a poor default for already-posted payments.

**Rules only** are cheaper, repeatable, and easier to explain. They also miss patterns that are difficult to enumerate. AI can add evidence, but false positives create review cost and false negatives leave investigations undiscovered.

**Asynchronous scoring** keeps posting independent. The payment posts, an event is retained, a bounded worker scores it, and deterministic policy may issue a later state-machine command. Low-risk payments can enter delayed review during an outage; a configured high-risk tier may require step-up verification or manual review. There is no universal fail-open answer.

We choose asynchronous, at-least-once processing for ordinary posted payments. Kafka is useful here because the event can be retained and replayed; direct HTTP from ledger to detector would make detector availability part of posting. At-most-once delivery reduces duplicate work but can lose an input. At-least-once preserves the input and transfers complexity to idempotency. For anomaly investigation, that trade is acceptable only if storage and financial side effects have separate idempotency boundaries.

## The New Failure: Async Creates Duplicates

Removing provider latency from posting does not remove failure. A consumer can call the provider, crash before recording the result, and receive the same event again. `exists()` followed by `save()` is unsafe because two consumers can observe absence concurrently.

```sql
-- The database arbitrates concurrent deliveries.
INSERT INTO anomaly_results(event_id, processing_kind, result_status,
                            model_version, decision, reason_code)
VALUES (:event_id, :kind, 'COMPLETE', :model, :decision, :reason)
ON CONFLICT (event_id, processing_kind) DO NOTHING;
```

The unique key makes result storage idempotent. It does not make a hold, notification, or webhook idempotent. Those need a provider idempotency key, a durable command/outbox, or a state machine that accepts one transition for a deterministic command key. Storage idempotency and side-effect idempotency are different guarantees.

Retries create another trap. Retry only classified transient errors, with a deadline, exponential backoff, jitter, and a retry budget. A circuit breaker stops calls when the provider is demonstrably unhealthy. A bounded worker pool and concurrency limit turn backpressure into a controlled queue instead of unlimited in-flight work. If the oldest event exceeds the review SLA, alert and apply an explicit intake, sampling, or fallback policy.

Caching can reduce cost, but a cached signal becomes stale when account behavior or model versions change. If used, cache only derived features with a TTL and version key; never use a cache as ledger state. OpenSearch can accelerate investigation, but it is a rebuildable read model. Its outage may delay search, not decide whether money exists.

## AI Is an Untrusted Adapter

The adapter should receive a stable feature schema, not an arbitrary payment payload. Redact or tokenize identifiers, send only the required time window and amount features, and keep secrets out of prompts and logs. Authentication, authorization, and per-tenant rate limits protect the shared provider budget.

The response must be structured and validated. Missing fields, invalid ranges, prompt-injection content, and non-parseable output become `UNKNOWN`, never an accidental `YES`. The model and prompt versions, input-feature reference, provider, timestamps, and fallback status belong in the audit record. Retention and access controls should limit investigator access to the PII needed for the case.

A model update can change signals without a code deployment. Shadow or canary evaluation against labeled samples can expose drift, false-positive changes, and cost changes before policy uses the new version. Replay must record the version used; rerunning against a changed provider is not reproducibility.

## Architecture After the Reasoning

Only now do the components have a reason to exist:

```text
                 PAYMENT CORE
command -> DB transaction: debit + credit + outbox(event_id)
                                      |
                                      v
                              Kafka ledger.events
                    retained, replayable, at-least-once
                                      |
                                      v
                 AI LAYER: bounded consumer and adapter
                 claim -> validate -> score -> record signal
                                      |
                         deterministic policy + version
                                      |
                         REVIEW / HOLD command
                                      |
                                      v
                 PAYMENT CORE: idempotent state transition

                 OpenSearch: rebuildable investigation view
                 Prometheus: bounded operational and business metrics
```

The outbox is needed only when publication must be coordinated with the ledger commit; otherwise a publish failure can leave a committed payment with no detector input. The consumer atomically claims `(event_id, processing_kind)` in durable storage, calls the provider through a domain port, and records the signal separately from the policy decision. Policy owns thresholds, risk tiers, degraded modes, and human approval requirements. It is deterministic code, not an AI wrapper.

The synchronous transaction remains small:

```java
// RIGHT: only the double-entry invariant is on the money path.
@Transactional
public void post(LedgerCommand command) {
    ledger.entry(new Entry(command.eventId(), DEBIT,
                           command.payerId(), command.amount()));
    ledger.entry(new Entry(command.eventId(), CREDIT,
                           command.payeeId(), command.amount()));
}
```

If policy requests a hold, it emits an idempotent command to the payment state machine. That command may move the payment to `REVIEW` or `HOLD` according to deterministic rules. It never edits a balance directly. The ledger and settlement state remain authoritative.

## A Failure We Can Operate

Use the 14:03 slowdown as a design exercise, not a FinPay production claim. The adapter deadline expires at 4 seconds, its small retry budget is consumed, and the circuit opens. The consumer records `UNKNOWN` and fallback status, commits the claim/result, and stops calling the provider. Kafka lag grows, but gateway latency and ledger connections remain normal because posting is independent. Policy applies the configured risk-tier behavior. When the provider recovers, replay processes retained events; the unique claim prevents duplicate result records.

If a consumer crashes after the provider accepted a request but before the result insert, redelivery is expected. A request with side effects needs an idempotency key; a pure inference call still needs duplicate-result protection. If the result store is unavailable, the event remains retryable or moves to a DLQ after a bounded attempt policy. A DLQ is not deletion: it needs an owner, reason, alert, and replay procedure.

At 100 events per second and an **assumed** 2-second scoring latency, the stage has about 200 in-flight calls. Set concurrency below the provider quota, reserve capacity for retries, and measure queue age, not only throughput. More workers help until provider quota, CPU, sockets, or database connections become the next limit. Capacity planning is constraint solving, not adding consumers until a graph looks green.

## What On-Call Needs

Prometheus should expose scoring latency, timeout and provider-error rates, rate-limit responses, circuit state, in-flight work, consumer lag, oldest event age, retry count, duplicate-claim rate, DLQ count, audit failures, and read-model failures. Business metrics include signal, `REVIEW`, `HOLD`, and fallback/unknown rates, plus later-labeled false-positive and false-negative samples. Keep labels bounded: provider, model version, outcome, fallback, reason code, and topic. Never use `payment_id`, `event_id`, `account_id`, or `trace_id` as labels.

Tracing should connect payment/request ID, ledger event, consumer attempt, inference ID, model and prompt versions, policy version, and state-machine command. Logs should answer which evidence was used, which rule fired, whether a human overrode it, and when each transition occurred, without raw PII or prompts in ordinary lines. Audit storage should preserve append-only history or corrections; an OpenSearch document cannot replace that history.

Every alert needs an action: pause or shed detector intake, switch to configured fallback, page the provider owner, replay a DLQ range, or investigate a policy spike. The runbook must identify payments posted during degraded mode and explain how their review SLA will be recovered.

## What We Learned

1. The money transaction stays small and synchronous; anomaly scoring is asynchronous and advisory.
2. AI produces a signal. Deterministic policy and the payment state machine own decisions and financial side effects.
3. The ledger database is authoritative, Kafka is replayable transport, and OpenSearch is a rebuildable read model.
4. At-least-once delivery is acceptable only when result storage and every side effect have separate idempotency boundaries.
5. Provider timeout, quota, model change, privacy limits, and cost budgets are design inputs, not cleanup work.
6. Fail-open, fail-closed, step-up, and manual review are risk-owner decisions by tier. There is no universal AI outage policy.

The durable insight is that AI should add a bounded, replayable source of evidence around a deterministic ledger. It should not enlarge the money path. The financial invariants must remain true when the model is slow, wrong, changed, or unavailable.

<!-- finpay-repo-link -->

## FinPay Reference Implementation

This article is part of the FinPay reference series. The related service implementation lives in the [finpay-lab/ledger-service](https://github.com/finpay-lab/ledger-service) repository.
