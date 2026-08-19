---
title: "Designing a Shared AI Core for FinPay Microservices: From Failure Modes to Guardrails"
description: "A practical design for shared LLM integration with BYOK credentials, resilience controls, idempotency, and auditable outcomes."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo referenced by the source material: <https://github.com/finpay-lab/platform>

## Problem

Adding an LLM call to one service is easy. Operating that call across a microservice fleet is not. Different services may call providers directly, keep keys in `application.yml`, parse responses differently, retry without a timeout, or record completion as `logger.info("done")`. The result is inconsistent security, failure behavior, duplicate processing, and weak evidence when a transaction is investigated.

**[SOURCE FACT]** The source material describes those integration patterns across three services. **[ANALYSIS]** This article treats them as platform problems, not proof of a production FinPay implementation. FinPay is a reference design; a production-oriented design would validate every assumption against its actual compliance, data, and traffic requirements.

## Why It Is Hard

An AI result is probabilistic, while a payment workflow needs deterministic control. A false positive can delay a legitimate payment; a false negative can miss fraud. The same prompt may behave differently after a model update, and a provider can be slow, rate-limited, unavailable, or expensive. A retry can also turn one delivery into multiple side effects unless storage and effects are designed separately.

The useful contract is therefore:

```text
AI signal -> policy evaluation -> business decision
```

The AI component emits a bounded observation such as a score, label, confidence, model version, and reason code. A deterministic policy or authorized human decides whether to hold, review, or continue a payment. The AI never receives authority to move money.

## Naive Design

A first implementation often puts provider code in a controller:

```java
// WRONG: secret, unbounded call, and business authority in one request
String answer = llm.chat(apiKey, request.toJson());
return answer.contains("approve") ? APPROVE : REJECT;
```

A second attempt may add `exists()` before saving an outcome:

```java
// WRONG: two consumers can both observe false
if (!outcomeRepository.exists(eventId)) {
    outcomeRepository.save(new Outcome(eventId, signal));
}
```

Both examples appear to work in a happy-path test. Neither defines what happens under concurrency, provider failure, redelivery, or an ambiguous model response.

## Why It Breaks

`exists()` followed by `save()` is a race: two workers can both see absence and both insert. A timeout-free retry can hold threads indefinitely, amplify provider load, and redeliver the same event. A key in configuration can leak through configuration dumps, logs, or support tooling. Parsing free-form text makes schema drift a business incident. Treating a model label as approval silently converts a probabilistic signal into a financial command.

There is also no single source of truth in the naive layout. A search index is not a transaction ledger, a dead-letter queue is not an audit record, and a log line is not a replayable decision history.

## Hard Problems

### Idempotency is two problems

Storage idempotency means the same logical event produces one stored outcome. It does not make external side effects idempotent. A notification, case creation, or payment command needs its own idempotency key or outbox-driven delivery.

Real mechanisms include:

- A database unique constraint on `(tenant_id, event_id)` with an atomic insert; the loser reads the existing outcome.
- `SETNX` with an expiry for a short-lived claim, followed by durable outcome storage; Redis alone is not the system of record.
- An inbox table that claims consumed event IDs transactionally.
- An outbox row written in the same transaction as the outcome, then delivered with a stable effect idempotency key.

```java
// RIGHT: the database arbitrates the race
try {
    outcomeRepository.insertUnique(tenantId, eventId, signal);
    outboxRepository.insert(tenantId, eventId, "RISK_SIGNAL_RECORDED");
} catch (DuplicateKeyException alreadyProcessed) {
    return outcomeRepository.get(tenantId, eventId);
}
```

The provider call itself may still be repeated. The design must tolerate that by making the final stored outcome authoritative, or by using a provider request idempotency key where supported.

### AI uncertainty and evolution

The response must be validated against a versioned schema. Invalid JSON, missing fields, contradictory labels, low confidence, and timeout are explicit outcomes, not reasons to guess. Store `model_version` and `prompt_version`; a changed prompt is a changed decision input. Policies should have their own `policy_version` and thresholds should be testable against historical cases.

### Resilience and cost

Set a per-attempt timeout, a total deadline, bounded retries with exponential backoff and jitter, and a circuit breaker. Retry only transient failures such as selected 429/5xx responses; do not retry validation failures. Rate limits require admission control and backpressure. A fallback can use deterministic rules or route to manual review, but it must be labeled as fallback and must not invent an AI signal.

## Trade-offs

A shared library standardizes contracts and instrumentation, but it cannot force every service to use it or make incompatible provider semantics disappear. A sidecar or gateway centralizes policy and rotation but adds a network hop and another availability boundary. Synchronous scoring is simple for a user request but couples payment latency to AI latency; asynchronous scoring improves isolation but requires a pending state and eventual consistency.

BYOK improves tenant isolation and cost attribution, while increasing secret-manager calls and rotation complexity. Persisting hashes and metadata supports investigations with less exposure, but limits later prompt-level debugging. These are deliberate boundaries, not claims that one option is universally best.

## Better Design

The shared module should expose a narrow, typed port: `assess(signalRequest) -> aiSignal`. It resolves a tenant's key by Vault reference, builds a provider-neutral request, validates a structured response, and applies resilience controls. The caller owns business policy; the module owns technical safety and evidence.

```text
Kafka (replay source) -> consumer -> AI core -> signal store + outbox
                                      |              |
                                      v              v
                               policy service   notifications/effects

DB = system of record
OpenSearch = read model for investigation and dashboards
Vault = secret source
```

The transaction that records an outcome should include `transaction_id`, `event_id`, `tenant_id`, signal data, `model_version`, `prompt_version`, `policy_version`, `decision`, `reason`, timestamps, and a correlation reference. The audit record must never contain the raw API key. If the policy decision is recorded separately, link it to the same event and transaction rather than overwriting the original signal.

## Failure Scenarios

- **Provider timeout:** stop at the deadline, record `AI_TIMEOUT`, and route to deterministic fallback or manual review.
- **429 or 5xx:** retry only within the request budget; honor provider rate limits and open the circuit when failures persist.
- **Malformed or nondeterministic response:** reject the response as invalid, record the model and prompt versions, and do not infer approval.
- **Consumer crash after insert:** the unique outcome and outbox make redelivery safe; an inbox can mark consumption in the same transaction.
- **Outbox delivery retry:** use an effect idempotency key; storage idempotency alone does not prevent duplicate email, case, or payment calls.
- **OpenSearch outage:** continue the business path if the durable DB audit succeeds; replay indexing later. Do not make the search index authoritative.
- **Vault outage or key rotation race:** fail closed for unavailable credentials, cache only within an explicit short TTL, and never fall back to a hard-coded key.

## Capacity

For a synchronous path, the basic relationship is:

```text
Concurrency = Throughput x Latency
```

At 200 requests/second and a 750 ms end-to-end latency, the path needs about 150 in-flight requests before safety headroom. Size consumer concurrency, connection pools, provider quotas, and circuit-breaker limits independently. Retries increase attempted provider throughput, so if 10% of calls retry once, provider attempts are roughly `200 x 1.10 = 220/second`, not 200.

Kafka is the replay source, not the business ledger. The DB is the system of record for outcomes and idempotency. OpenSearch is a denormalized read model and may lag or be rebuilt. Capacity planning must include peak partitions, consumer lag, DB unique-index contention, Vault QPS, OpenSearch indexing rate, token cost, and a retry storm during provider recovery.

## Security and Privacy

Minimize data before sending anything to an external AI provider: prefer derived features, redaction, tokenization, and a strict allowlist over a full transaction payload. Do not casually send names, account numbers, addresses, free-form notes, or regulated identifiers. Encrypt data in transit and at rest, isolate tenants, restrict Vault access, rotate keys, and redact secrets and PII from logs, traces, prompts, and exception messages.

Access to the audit trail needs least privilege and retention rules. Hashing a prompt is not anonymization if the original can be reconstructed from a small input space. Define provider retention, residency, training-use, and deletion terms before enabling BYOK routing. A production-oriented design would also require threat modeling, access reviews, and compliance approval.

## Observability

Measure both system behavior and business quality. Useful system metrics include request count, latency percentiles, timeout and retry counts, circuit state, rate-limit responses, token usage, cost estimates, Vault failures, DB conflict counts, outbox age, consumer lag, and OpenSearch indexing lag. Useful business metrics include fallback rate, manual-review rate, policy outcomes, false-positive/false-negative samples from reviewed cases, and drift by model and policy version.

Never use `transaction_id`, `account_id`, prompt text, or event ID as Prometheus labels: their cardinality and sensitivity are unsafe. Put correlation IDs in structured logs or trace context with access controls, and use aggregate labels such as service, provider, model version, policy version, and outcome class. A useful audit query can then reconstruct: transaction, event, signal, versions, decision, and reason without exposing the payload.

## Lessons

1. Start from failure modes and decision authority, then choose the architecture.
2. Treat AI as a versioned, fallible signal; policy converts it into a business decision.
3. Use atomic uniqueness, inbox/outbox patterns, and effect keys instead of `exists()` checks.
4. Bound latency, retries, rate limits, cost, and fallback behavior explicitly.
5. Keep Kafka for replay, the DB as the record of truth, and OpenSearch as a rebuildable read model.
6. Minimize sensitive data and make audit and observability useful without turning identifiers into metrics labels.
