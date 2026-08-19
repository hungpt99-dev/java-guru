---
title: "Designing Ledger Anomaly Detection with Kafka and Prometheus"
description: "A guarded design for scoring ledger events asynchronously without putting AI on the money path."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> **Repository:** https://github.com/finpay-lab/ledger-service

## The Problem Starts After Posting

FinPay already has a payment path with a hard invariant: a posted payment creates a balanced double-entry debit and credit in one database transaction. The ledger database is the source of truth for money movement. That path is deliberately small. It validates the command, posts the entries, and returns a result that the rest of the payment state machine can understand.

The next problem appears after posting. A payment can be valid according to the account rules and still resemble an unusual pattern: a new beneficiary receives several large payments in minutes, or a normally quiet account suddenly pays from a new region. The business wants that signal before reconciliation and the 2 AM batch review, but it does not want a model response to become a balance mutation.

**[SOURCE FACT]** The supplied repository description identifies `ledger-service` as a Spring Boot service. It records each payment as a double-entry `debit`/`credit` pair in one database transaction, publishes ledger events to Kafka on `ledger.events`, and makes events searchable in OpenSearch. FinPay is fictional here; the production-oriented flow below is a design proposal, not a claim about a deployed system.

The contract is intentionally asymmetric:

```text
ledger event -> AI signal -> deterministic policy -> business decision
                                      |
                                      v
                            review / risk-tier action
                                      |
                                      v
                              ledger / settlement
```

The model can report `SUSPICIOUS`, `NORMAL`, or `UNKNOWN`, with evidence and a score. It cannot call `hold`, reject a payment, post a ledger entry, change a balance, or settle funds. Policy owns the mapping to `ALLOW`, `REVIEW`, or `HOLD`, and a deterministic state machine owns any financial transition.

## The Obvious Design

The first design is easy to explain: post the payment, call an AI provider, and hold the payment if the answer looks risky.

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

That looked reasonable until we followed one request through a slow provider. The database transaction stays open during an uncontrolled network call. If model latency is an explicit design assumption of 2 seconds, a payment can hold a database connection and locks for that period. At 10,000 payments per second, a synchronous stage with 200 ms latency creates roughly `10,000 x 0.2 = 2,000` in-flight requests before retries and headroom. At 2 seconds, it creates about 20,000. Those are capacity calculations, not FinPay measurements, but they show why provider latency belongs outside the money path.

The failure propagates. In a hypothetical incident at 14:03, provider latency rises from 300 ms to 4 seconds. Request workers wait, connection pools fill, and gateway timeouts begin. A retry policy sends more calls while the provider is already slow. If the payment consumer retries after a timeout, the same post or hold can be attempted again. A provider response of `YES` is also not a stable contract: output may be malformed, nondeterministic, or different after a prompt or model rollout. Even a correct signal has no authority to mutate financial state.

The audit write is flawed too. If it shares the money transaction, a rollback can erase the evidence of the attempted analysis. If it is written after a remote timeout, it may never happen. The secret in the example can also leak through source control, logs, or an exception message.

## Constraints We Cannot Negotiate

For this reference design, the constraints are:

- The ledger database remains authoritative for posted money. Double-entry balance and deterministic settlement must not depend on AI availability.
- Scoring may be delayed, duplicated, or unavailable. The system must preserve a replayable input and an auditable outcome.
- AI output is untrusted input. It needs a schema, version, bounded deadline, and an explicit `UNKNOWN` result.
- Provider limits and cost are finite. Concurrency cannot grow merely because Kafka has more events.
- Payment data may contain PII and sensitive counterparty information. The provider boundary must receive only the minimum useful data.
- The review workflow needs an explicit SLA. “Asynchronous” is not the same as “eventually, with no bound.”

These are assumptions and design constraints, not production measurements. The right limits must be obtained from load tests, provider contracts, and the business risk model.

## Choosing the Boundary

Synchronous scoring would give an immediate signal. That is useful for a high-risk operation where a decision must precede authorization, but it couples authorization to provider latency and availability. For ordinary posted payments, the safer boundary is asynchronous review: post first, then score, then let policy decide whether a follow-up state transition is needed. A separate pre-authorization risk check could exist for a particular risk tier, but it must be a bounded deterministic workflow with an explicit degraded mode, not an unbounded LLM call inside posting.

Rules-only detection is cheaper, explainable, and repeatable. It misses patterns that are difficult to enumerate. AI can add a useful advisory signal, but false positives create review cost and false negatives create missed investigations. Therefore the policy should be able to use rules, AI, or both, and should distinguish `UNKNOWN` from `NORMAL`.

For unavailable scoring, there is no universal fail-open answer. A low-risk payment can post and enter delayed review. A high-risk payment may require step-up verification or manual review. Blocking every payment during a provider outage turns an advisory dependency into a payment outage; allowing every high-risk payment may accept too much exposure. The risk owner, not the model, chooses this fail-open, fail-closed, or step-up behavior by risk tier.

Kafka is useful here because the event can be replayed, but direct HTTP from the ledger to a detector would make detector availability part of posting. At-most-once delivery avoids duplicate work at the cost of losing events. At-least-once delivery preserves the input but forces idempotency. We choose replayable at-least-once processing because an omitted anomaly is harder to investigate than a duplicate delivery, provided side effects are separately protected.

## The New Problems

Async processing removes provider latency from posting, then creates duplicate delivery. A consumer can call the provider, crash before recording the result, and receive the same event again. `exists()` followed by `save()` is not a solution: two consumers can observe absence concurrently.

```sql
-- The database arbitrates concurrent deliveries.
INSERT INTO anomaly_results(event_id, processing_kind, result_status,
                            model_version, decision, reason_code)
VALUES (:event_id, :kind, 'COMPLETE', :model, :decision, :reason)
ON CONFLICT (event_id, processing_kind) DO NOTHING;
```

The unique key makes result storage idempotent. It does not make an external `hold`, notification, or webhook idempotent. Those require a provider idempotency key, a durable command/outbox, or a state machine that accepts one transition for a deterministic command key. Storage idempotency and side-effect idempotency are separate guarantees.

Retries solve transient failures, then create retry storms. The adapter should retry only classified transient errors, with a deadline, exponential backoff, jitter, and a retry budget. A circuit breaker prevents calls when the provider is demonstrably unhealthy. A bounded worker pool and provider quota turn backpressure into a controlled queue instead of unlimited in-flight work. If lag exceeds the review SLA, the system should alert, reduce intake or sampling according to policy, and expose the age of the oldest unprocessed payment.

Caching can reduce cost, but a cached signal becomes stale when account behavior or the model changes. If used, cache only derived, non-authoritative features with a TTL and model/prompt version; never treat a cache as ledger state. OpenSearch makes investigation fast, but it is a read model. Its outage should delay search, not decide whether money exists. Kafka is the replay source for the detector; the ledger database remains the financial record.

## AI Guardrails

The adapter accepts a stable feature schema rather than an arbitrary payment payload. It redacts or tokenizes identifiers, sends only the needed time window and amount features, and keeps secrets out of prompts and logs. Authentication and authorization restrict which tenant or service can submit a scoring request. Per-tenant rate limits prevent one customer from consuming the shared budget.

The response must be structured and validated. Unknown fields can be ignored or rejected according to the schema; missing required fields, invalid ranges, prompt-injection content, and non-parseable output become `UNKNOWN`, not an accidental `YES`. The prompt is data, not an instruction channel from the customer. Model and prompt versions, input feature reference, provider, timestamps, and fallback status belong in the audit record. Retention and access controls should prevent investigators from seeing more PII than the case requires.

A model update can change decisions without a code deployment. Shadow or canary evaluation against labeled samples can reveal drift, false-positive changes, and cost changes before policy uses the new signal. Historical replay should record the version used; “run it again” is not reproducibility if the provider has changed.

## The Bounded Design

Only after these decisions does the architecture become useful:

```text
                 PAYMENT CORE
command -> DB transaction: debit + credit + outbox(event_id)
                                      |
                                      v
                              Kafka ledger.events
                                      |
                    replayable, at-least-once transport
                                      |
                                      v
                 AI LAYER: bounded consumer and AI adapter
                 claim -> validate -> score -> record signal
                                      |
                         deterministic policy + version
                                      |
                         ALLOW / REVIEW / HOLD command
                                      |
                                      v
                 PAYMENT CORE: idempotent state transition

                 OpenSearch: rebuildable investigation read model
                 Prometheus: bounded operational and business metrics
```

The outbox is present only if publication must be coordinated with the ledger commit; otherwise a failed publish could leave a committed payment with no detector input. The consumer atomically claims `(event_id, processing_kind)` in durable storage, invokes a domain port for the provider, and records the signal separately from the policy decision. The policy service is not an AI wrapper. It is deterministic code that owns thresholds, risk tiers, degraded-mode behavior, and human approval requirements.

The payment transaction remains tiny and synchronous:

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

If policy later requests a hold, it emits an idempotent command to the payment state machine. That command may move a payment into `REVIEW` or `HOLD` according to deterministic rules. It never edits a balance directly. The double-entry post and settlement state are still the source of truth.

## A Failure We Can Operate

Consider the 14:03 provider slowdown as a design exercise, not a FinPay production claim. The adapter’s deadline expires at 4 seconds, its small retry budget is consumed, and the circuit opens. The consumer records `UNKNOWN` with fallback status, commits the claim/result, and stops calling the provider. Kafka lag grows, but gateway latency and ledger connections remain normal because posting is independent. Policy applies the risk-tier rule: low-risk payments enter delayed review, while a configured high-risk tier may require step-up or manual review. When the provider recovers, replay processes the retained events; the unique claim prevents duplicate signal records.

If a consumer crashes after the provider accepted a request but before the result insert, redelivery is expected. The provider request must carry an idempotency key if the request has a side effect; a pure inference call still needs duplicate-result protection. If the result store is down, the event stays retryable or goes to a DLQ after a bounded attempt policy. A DLQ is not deletion: it needs an owner, alert, reason, and replay procedure.

At 100 events per second and an assumed 2-second scoring latency, the stage has about 200 in-flight calls. Add a concurrency limit below the provider quota, reserve capacity for retries, and measure queue age rather than only consumer throughput. More workers can reduce lag until they exhaust provider quotas, CPU, sockets, or database connections. Capacity planning is therefore a constraint-solving exercise, not “add consumers until the graph looks green.”

## What On-Call Needs at 3 AM

Prometheus should expose scoring latency, timeout and provider-error rates, rate-limit responses, circuit state, in-flight work, consumer lag, oldest event age, retry count, duplicate-claim rate, DLQ count, audit failures, and read-model failures. Business metrics include signal rates, `REVIEW` and `HOLD` rates, fallback/unknown rate, and later-labeled false-positive and false-negative samples. Labels stay bounded: use provider, model version, outcome, fallback, reason code, and topic. Never use `payment_id`, `event_id`, `account_id`, or `trace_id` as Prometheus labels.

Tracing should connect a request/payment ID to the ledger event, consumer attempt, AI inference ID, model and prompt versions, policy version, and state-machine command. Logs should answer which evidence was used, which rule fired, whether a human overrode it, and when each transition occurred, without putting raw PII or prompts in ordinary log lines. Audit storage should be append-only or preserve correction history; an OpenSearch document can show the current investigation view but cannot replace that history.

An alert should lead to an action: pause or shed detector intake, switch to the configured fallback, page the provider owner, replay a DLQ range, or investigate a policy spike. The runbook must state which payments were posted during degraded mode and how their review SLA is recovered.

## Lessons

1. The money transaction stays tiny and synchronous; anomaly scoring is asynchronous and advisory.
2. AI produces a signal. Deterministic policy and the payment state machine own decisions and financial side effects.
3. The ledger database is authoritative, Kafka is replayable transport, and OpenSearch is a rebuildable read model.
4. At-least-once delivery is acceptable only when result storage and every side effect have their own idempotency boundary.
5. Provider timeouts, quotas, model changes, privacy limits, and cost budgets are normal design inputs, not cleanup tasks.
6. Fail-open, fail-closed, step-up, and manual review are risk-owner decisions by tier. There is no universal AI outage policy.

The durable insight is simple: adding AI to a financial system should not enlarge the money path. It should add a bounded, replayable source of evidence around a deterministic ledger whose invariants remain true even when the model is slow, wrong, changed, or unavailable.
