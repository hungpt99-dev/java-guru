---
title: "Designing Safe LLM-Assisted Payment Notifications"
description: "A practical design for using an LLM to write notification copy without letting it change payment facts, block delivery, or leak credentials."
pubDatetime: 2026-08-15T10:00:00+07:00
tags:
  - java
  - ai
  - fintech
  - architecture
draft: false
featured: false
---

> Repository: <https://github.com/finpay-lab/notification-service>

## Problem

A payment notification has two different jobs: state the transaction accurately and make that information readable in SMS, email, or push. A fixed template is dependable, but templates multiply as product, locale, channel, and legal requirements diverge. An LLM can propose natural wording, but it can also change a fact while trying to improve the sentence.

The important boundary is therefore not “template versus AI.” It is authority. The payment domain owns validated facts and the decision to deliver. The LLM may propose copy only.

This is a reference design for FinPay. A production-oriented design would need to validate these assumptions against its own regulatory, provider, and operational requirements; no deployment claim is implied.

## Why Hard

The system must combine an asynchronous event, a probabilistic dependency, and an irreversible side effect. A model can produce false positives, false negatives, or different wording for the same input. Providers can time out, rate-limit, return malformed output, or become unavailable. A retry can recover a response, but can also repeat an external send.

There are several independent contracts:

- The event must be consumed at least once without creating duplicate business work.
- Facts such as amount, currency, status, and recipient must not be inferred from generated text.
- AI quality must not decide whether a legally required notification is sent.
- Provider credentials and transaction data must remain within approved boundaries.
- Every decision must be explainable after model, prompt, or policy versions change.

## Naive Design

Passing a raw event to a model and returning an untyped string leaves those contracts implicit:

```java
// WRONG: deliberately unsafe; do not ship
public String copyFor(NotificationEvent event) {
    return llm.complete("Write a friendly notification: " + event.rawPayload());
}
```

The model sees more data than it needs, the result has no schema, and there is no timeout, bounded retry, or fallback. Most importantly, a caller cannot tell whether a sentence is a fact, a model suggestion, or a delivery decision.

## Why It Breaks

Suppose the source event contains `2,431,876 VND`, while the model returns “about 2.4M VND.” That is not a cosmetic difference. It can be incorrect, misleading, or non-compliant. A free-form string may also omit a required title, exceed an SMS limit, include an unsupported claim, or contain prompt-injected text from a field that was supposed to be data.

The dependency failure is just as serious. An unbounded call holds consumer work indefinitely. Blind retries amplify rate limits. Reprocessing an event can generate different copy and send it twice. A timeout does not prove that the provider did not complete the request, so retrying a send without an idempotency key can duplicate the side effect.

## Hard Problems

### AI is a signal, not a decision

The pipeline should make the authority explicit:

```text
validated facts -> AI signal -> policy -> business decision -> delivery
                    (style/risk)   (rules)     (send/fallback/suppress)
```

For example, the AI signal can be `tone=concise`, `risk=low`, and `confidence=0.91`. Policy can reject low confidence, unsupported claims, or a body over the channel limit. The business decision still comes from domain rules: a required fraud alert is delivered with a safe template even when AI is unavailable. A prohibited notification is not enabled by a confident model.

### Idempotency is more than `exists()`

This is a race, not an idempotency mechanism:

```java
// WRONG: two consumers can both observe false
if (!repository.exists(event.eventId())) {
    repository.save(event.eventId());
    sender.send(message);
}
```

Two consumers can pass the check before either inserts. A real design uses a unique constraint on `(tenant_id, event_id, purpose, channel)` and an atomic insert, or a conditional `SETNX` with an expiry when a cache is appropriate. A Kafka consumer can also use an inbox table: insert the event key in the same transaction as the derived notification, then acknowledge Kafka only after commit. An outbox publishes the resulting work reliably from the database.

Storage idempotency and side-effect idempotency are different. The unique insert prevents duplicate processing records; it cannot undo two calls already made to an email, SMS, or push provider. The delivery request needs a stable idempotency key, or a provider-specific deduplication strategy. If the provider has neither, record the uncertain outcome and use reconciliation rather than blindly retrying.

### Versions and structured output

The model adapter should receive a minimal, canonical fact object and return a schema such as `{ title, body, tone, claims }`. The validator checks that every claim is present in the facts, that required fields and channel limits are satisfied, and that no credential or secret appears. Store `model_version` and `prompt_version`; changing either can change behavior. Policy changes require `policy_version` as well.

### Timeouts, retries, and fallback

Use a short deadline, bounded exponential backoff with jitter for retryable errors, and a circuit breaker to stop calls during an outage. Do not retry validation errors or authentication failures. A fallback template is deterministic and should be selected by policy, not by whichever exception happened last. Dead-letter poison events, and route exhausted work to reconciliation.

## Trade-offs

Allowing AI to write copy improves variation and can reduce template maintenance, but adds latency, token cost, provider dependency, and audit complexity. Sending only canonical facts lowers privacy exposure but reduces stylistic context. Synchronous generation gives a fresh response but couples delivery latency to the model; asynchronous generation improves isolation but requires durable state and a visible pending state.

For high-risk or legally exact messages, deterministic templates are the safer default. AI can be disabled per tenant, locale, channel, or policy version without changing payment facts.

## Better Design

Keep the domain and ports small. A production-oriented flow would look like this:

```text
Kafka event -> consumer -> inbox/unique insert -> fact mapper
                                      |
                         policy -> LLM adapter (optional)
                                      |
                         validator -> template fallback
                                      |
                         outbox -> delivery adapter -> provider
                                      |
                         audit + OpenSearch read model
```

```java
// RIGHT: facts and delivery authority stay outside the model
NotificationDecision decide(PaymentFacts facts, Policy policy) {
    AiDraft draft = policy.aiEnabled()
        ? llm.generate(facts.minimalView(), policy.promptVersion(), policy.deadline())
        : null;
    ValidatedCopy copy = policy.validateOrFallback(draft, facts);
    return policy.authorize(facts, copy); // send, suppress, or retry
}
```

The database is the system of record for facts, processing state, and audit entries. Kafka is the replay source, not the canonical payment ledger. OpenSearch is a read model for searching notification history, not an authority for deciding whether a payment happened. The outbox carries a stable delivery idempotency key. Tenant-supplied provider keys are resolved from a secret manager, never placed in prompts or logs.

An audit record should include at least `transaction_id`, `event_id`, `model_version`, `prompt_version`, `policy_version`, `decision`, and `reason`, plus timestamps, channel, template or output hash, and provider outcome. Store generated content only where retention and access policy permit.

## Failure Scenarios

- **Duplicate Kafka delivery:** the inbox unique key returns the existing result; the consumer acknowledges without creating another notification.
- **Model timeout or rate limit:** bounded retries may run for transient errors; policy selects the deterministic template after the deadline.
- **Malformed or unsafe output:** schema and claim validation reject it and record the reason; they do not send it.
- **Provider timeout after acceptance:** mark delivery as uncertain, keep the idempotency key, and reconcile provider status rather than issuing an unkeyed retry.
- **Database outage:** do not acknowledge the event; Kafka can replay it after recovery.
- **OpenSearch outage:** delivery and audit persistence continue; indexing retries from the durable record.
- **Prompt injection in a transaction description:** treat all event fields as untrusted data and never let them override system instructions or policy.

## Capacity

Capacity must be calculated from traffic, latency, and retry behavior, not from a topic partition count alone. The basic relationship is:

```text
Concurrency = Throughput x Latency
```

At 200 notifications/second and a 400 ms model path, the nominal in-flight model work is `200 x 0.4 = 80` requests. Retries and a fallback path add load, so size provider quotas, consumer concurrency, connection pools, and database writes for the failure case too. A rate limiter and per-tenant quotas prevent one tenant from consuming all model capacity. Kafka partitions provide parallelism and replay; they do not make the database or provider faster.

Keep payloads small, bound output tokens, and prefer templates when the model queue grows. Batch indexing to OpenSearch separately from the delivery critical path. Backpressure should pause or slow consumption before memory and provider queues become unbounded.

## Security/Privacy

Payment events can contain PII, account identifiers, merchant details, and sensitive descriptions. Minimize the model input to the facts needed for wording. Tokenize or redact identifiers, classify fields, and use an approved provider boundary. Do not casually send the full transaction to an external AI service. A tenant's provider credential belongs in a secret manager, is scoped to that tenant, and is excluded from prompts, traces, and ordinary logs.

Authorize access to audit and search views, encrypt data in transit and at rest, define retention and deletion rules, and treat model output as untrusted content. Output encoding and channel-specific escaping are required to prevent markup or link abuse. Security policy can force deterministic templates for sensitive categories.

## Observability

Measure both system behavior and business outcomes:

- System: consumer lag, processing latency, model latency, timeout and rate-limit counts, retry attempts, circuit state, validation failures, outbox age, provider latency, and uncertain deliveries.
- Business: notifications accepted, sent, fallback-selected, suppressed by policy, failed by channel, and duplicate attempts prevented.

Prometheus labels must remain bounded. Never use `transaction_id` or `account_id` as labels; put correlated identifiers in structured logs or the trace context with access controls. Audit records carry the versions and reason needed for reconstruction. Dashboards should distinguish model rejection from provider failure and from a business-policy suppression.

## Lessons

1. Put payment facts and delivery authority in the domain; let AI produce only a constrained signal or draft.
2. Prove idempotency with atomic storage operations and separately make external side effects deduplicable.
3. Treat model, prompt, policy, provider, timeout, retry, and fallback behavior as versioned operational contracts.
4. Use Kafka for replay, the database as system of record, and OpenSearch as a read model.
5. Minimize PII before an external model call and never treat tenant credentials as prompt data.
6. Observe business decisions and failure modes without turning high-cardinality identifiers into metric labels.
