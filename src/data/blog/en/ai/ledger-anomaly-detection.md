---
title: "Designing Ledger Anomaly Detection with Kafka and Prometheus"
description: "A guarded design for scoring ledger events asynchronously without putting AI on the money path."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> **Repository:** https://github.com/finpay-lab/ledger-service

# Ledger anomaly detection with Kafka and Prometheus

Anomaly detection is useful only if it does not make ledger posting less reliable. The difficult part is not calling a model. It is keeping model latency, provider failures, duplicate messages, secrets, and audit requirements out of the transaction that moves money.

This article describes the supplied `ledger-service` design and a safer integration boundary: post the ledger entry first, publish an event, score it asynchronously, and expose the scoring path through Prometheus. AI produces a signal. Deterministic policy and, where required, a human approval flow make the financial decision.

## What is factual and what is design

**[SOURCE FACT]** The supplied service description identifies `ledger-service` as a Spring Boot service. It records each payment as a double-entry `debit`/`credit` pair in one database transaction, publishes ledger events to Kafka on `ledger.events`, and makes them searchable in OpenSearch. The stated product goal is to flag suspicious ledger patterns before reconciliation and before the batch job at 2 AM.

**[SOURCE FACT]** The repository is attributed to FinPay in the supplied material. The repository link is retained above; no additional company or platform claims are made here.

**[ANALYSIS]** The model must be an observer of the money path, not a dependency of it. The rest of this article is a proposed boundary for that requirement. Code marked as proposed is illustrative and should be adapted to the actual service.

## 1. Keep the money path small

The core invariant is a single database transaction containing the two ledger entries:

```java
// application/PostingService.java
@Transactional
public void post(LedgerCommand cmd) {
    ledger.entry(new Entry(cmd.eventId(), DEBIT, cmd.partyId(), cmd.amount()));
    ledger.entry(new Entry(cmd.eventId(), CREDIT, cmd.counterparty(), cmd.amount()));
}
```

**[ANALYSIS]** Any additional work in this method competes for the same database transaction, connection, and row locks. A remote model call is especially unsuitable here: its timeout and retry behavior are outside the ledger's control.

## 2. What not to do

The following example is intentionally unsafe. It shows the failure modes that the design must exclude.

```java
// WRONG: remote AI call on the money path, hardcoded secret, no safeguards.
public class PaymentProcessor {
    private static final String OPENAI_API_KEY = "sk-proj-...";

    @Transactional
    public void postLedger(PaymentEvent event) {
        ledger.post(debit(event), credit(event));
        String answer = openAiClient.ask(prompt(event), OPENAI_API_KEY);
        if ("YES".equals(answer)) {
            fundsService.hold(event.eventId());
        }
        auditRepo.save(new AuditRow(event.eventId(), answer));
    }
}
```

**[ANALYSIS]** This has several independent problems:

- The database transaction remains open while the service waits for a third-party API. As an illustrative assumption, a model with a 2-second p95 would hold locks for that wait, consume a connection, and add latency to unrelated ledger posts.
- There is no timeout, retry policy, circuit breaker, or fallback. A provider outage can therefore become a ledger outage.
- The credential is hardcoded and can be committed, scanned, rotated, or leaked. It also makes the deploy depend on one static credential instead of runtime secret injection.
- `fundsService.hold(...)` turns an unverified model response into a money action. There is no deterministic policy or human approval boundary.
- Kafka delivery is at-least-once. A redelivery can post the entries again and call `hold` again unless the consumer and side effects are idempotent.
- The audit write shares the money transaction. If the remote call hangs or the transaction rolls back, the record of the decision can be missing when it is most needed.

## 3. Guardrails

**[PROPOSED DESIGN]** Treat these as product and reliability requirements, not implementation details:

1. AI emits a signal; it never directly decides a money outcome.
2. Use `eventId` as the idempotency key. Consumers, stores, and external side effects must tolerate replay.
3. Apply `timeout -> retry -> circuit breaker` in that order. On failure, use a deterministic fallback that records the failure and does not block posting.
4. Use BYOK (Bring Your Own Key) through runtime secret injection. Never hardcode or log the key; redact accidental secret output.
5. Write a versioned, append-only audit record containing the input evidence, model identifier, verdict, and timestamp.
6. Instrument the AI path. Latency, failures, fallback use, and anomaly rate should be available to Prometheus so the monitor can be monitored.

## 4. Ports and adapters

**[PROPOSED DESIGN]** Keep the domain independent of Kafka, HTTP, JSON, OpenSearch, and model SDKs. The domain owns models and ports (interfaces). Infrastructure owns adapters (implementations).

```text
com.finpay.ledger
├── domain/
│   ├── model/              # LedgerEvent, AnomalyScore, AnomalyRecord
│   └── port/               # AnomalyScorer, AnomalyStore, AuditTrail
├── application/            # PostingService, DetectAnomalyService
└── infrastructure/
    ├── kafka/              # LedgerEventListener
    ├── ai/                 # OpenAiAnomalyScorer, RuleBasedScorer
    ├── opensearch/         # OpenSearchAnomalyStore
    ├── audit/              # AuditTrailImpl
    └── metrics/            # Prometheus/Micrometer adapter
```

The ports can stay small:

```java
public interface AnomalyScorer {
    AnomalyScore score(LedgerEvent event);
}

public interface AnomalyStore {
    boolean exists(String eventId);
    void save(AnomalyRecord record);
}

public interface AuditTrail {
    void append(AnomalyRecord record);
}
```

`OpenAiAnomalyScorer` and `RuleBasedScorer` are adapters behind `AnomalyScorer`. The application layer chooses the configured scorer and fallback; the domain does not import an AI client.

## 5. Proposed asynchronous flow

**[PROPOSED DESIGN]** Keep event publication and scoring separate from the posting transaction:

```text
PostingService
    -> database transaction: debit + credit
    -> publish LedgerEvent(eventId)

LedgerEventListener
    -> check idempotency by eventId
    -> score with timeout, retry, and circuit breaker
    -> fall back to deterministic rules on failure
    -> save AnomalyRecord
    -> append audit record
    -> update Prometheus metrics
```

The listener must not call `fundsService.hold(...)` merely because a scorer returns an anomalous verdict. A separate deterministic policy evaluates the signal and the available evidence. If the business requires a hold, that action should have its own idempotency key and audit entry. The model remains advisory.

The exact delivery mechanism between the database and Kafka is an implementation choice. If the service needs stronger coordination between the ledger commit and event publication, an outbox is a possible proposal; it is not asserted as an existing repository fact here.

## 6. Idempotency and audit

**[PROPOSED DESIGN]** Make the event identifier the boundary for replay handling. A consumer should check whether the event has already been processed before creating an anomaly record. The check and the durable write need a uniqueness guarantee, not only an in-memory check, because multiple deliveries can be processed concurrently.

The scorer itself may be called again after a timeout or redelivery, so it should not be treated as a one-time operation. Persist the result with the event identifier, model/version metadata, evidence reference, verdict, and timestamp. Keep the record append-only; corrections should be new records linked to the original event rather than destructive updates.

Audit is a separate concern from the money transaction. A failure to score should produce an auditable fallback or failure state. It should not prevent the ledger transaction from completing.

## 7. Secrets and resilience

**[PROPOSED DESIGN]** Inject the model credential at runtime from a secret store or equivalent deployment mechanism. Pass it only to the adapter that needs it. Do not include credentials, full prompts, or sensitive ledger fields in application logs. Redaction belongs in the logging path as a second line of defense, not as a substitute for access control.

The resilience order matters:

- `timeout` bounds how long one provider call can occupy a worker.
- `retry` handles transient failures, with a bounded policy appropriate to the provider and workload.
- `circuit breaker` stops sending calls when the dependency is persistently unhealthy.
- `fallback` applies deterministic rules or records an unknown result and allows the monitoring pipeline to continue.

These controls protect the anomaly detector. They do not turn a provider failure into a financial decision.

## 8. Prometheus metrics

**[PROPOSED DESIGN]** Expose metrics for the detector itself, not only the anomalies it reports. Useful dimensions include scorer outcome, fallback use, and dependency state. Keep labels bounded: do not use `eventId`, party identifiers, prompts, or other high-cardinality ledger data as metric labels.

At minimum, operators need to distinguish:

- scoring latency and timeout rate;
- provider failures and circuit-breaker state;
- fallback count;
- processed, duplicate, and failed events;
- anomaly verdict rate.

Prometheus can then alert on a silent detector, a rising failure rate, or a change in anomaly volume. Grafana is a suitable visualization and alerting surface when it is already part of the deployment; the detector must still function when the monitoring system is unavailable.

## Conclusion

The safe integration is intentionally unremarkable: commit the ledger entries without a remote model call, publish an event, score asynchronously, make replay safe, record every outcome, and measure the detector's own health. The model can help prioritize investigation, but deterministic policy and human review remain responsible for money decisions.
