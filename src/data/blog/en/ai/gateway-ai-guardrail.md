---
title: "Designing an AI Guardrail for a Payment API Gateway"
description: "A problem-driven design for keeping probabilistic AI signals out of authoritative payment decisions while preserving safety, latency, replayability, and auditability."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## The Boundary We Need

FinPay already has a payment core. Its ledger is the system of record; settlement is a deterministic state machine. A payment can move from `RECEIVED` to `AUTHORIZED`, `HELD`, or `REJECTED` only through business rules that can be audited and replayed.

Now a merchant sends a payment with a free-text note. The note might be harmless context, an attempt to override a review rule, or text copied from an untrusted customer. The team wants an AI check before routing the payment. That request sounds like “send the text to a model and reject a bad answer.” It is not that simple. A remote model is slow, probabilistic, expensive, and controlled by a provider outside FinPay’s failure domain.

The real design question is:

> How can an API gateway use an uncertain dependency without allowing it to authorize, reject, or mutate money directly?

This is a fictional reference design, not a claim about a deployed FinPay system. The central boundary is proposed, not discovered from production measurements:

```text
AI inference -> bounded AI signal -> deterministic policy -> business decision -> financial state transition
```

The model may report `injection_suspected`, a risk score, or a classification. It may not update an account balance, write the ledger, authorize settlement, or turn its own explanation into a payment command.

## The Obvious Design Fails

The first sketch is attractive because it has almost no moving parts:

```text
client -> JWT authentication -> LLM -> route or reject -> payment service
```

The gateway sends the authenticated request to the model and routes only if the model says `allow`. That makes the model a hidden authorization service. It also makes every payment depend on model latency and provider availability.

Suppose, as an illustrative capacity assumption, the gateway receives 10,000 requests per second and the provider takes two seconds. The model stage creates approximately:

```text
in-flight concurrency = throughput x latency = 10,000/s x 2s = 20,000 calls
```

At ten seconds, the same traffic creates 100,000 in-flight calls. Increasing a thread pool does not create provider capacity. It consumes memory, connections, and downstream slots until the queue becomes the outage.

There is a second problem: the timeout does not stop propagation. At 14:03, imagine provider latency rising from 300 ms to 4 seconds. Gateway workers remain occupied, request deadlines expire at different layers, and an optimistic retry sends another request while the first is still running. Connection pools fill. The provider rate limit starts returning errors. The retry queue grows, and healthy payments now compete with failed AI calls. A circuit breaker and concurrency limit are not performance decorations; they stop this dependency from taking the payment path with it.

The model’s answer creates correctness problems too. It can produce valid JSON with an impossible amount, a fabricated reason, or a confident false positive. A false negative may expose a suspicious payment; a false positive may deny a legitimate merchant. Neither consequence should be selected accidentally by whichever timeout or parser branch happened to run.

Finally, an asynchronous repair is not automatically safe. A consumer can crash after calling a downstream service but before recording completion. The message is delivered again. An `exists()` check followed by an insert lets two consumers both see “absent” and both call the provider. A search index can accept the verdict while the durable record is missing, or fail while the payment is healthy. Search is a read model, not the ledger.

## Constraints Before Components

For this example, we assume the following design constraints. They are assumptions, not FinPay production measurements:

- Payment authorization and ledger transitions must remain deterministic, auditable, and independent of an LLM response.
- The synchronous gateway budget is bounded. The design must declare what happens when that budget is exhausted.
- Free text is untrusted input. Customer PII and credentials must not be sent to a model merely because the gateway can access them.
- Provider quotas, latency, model changes, and outages are outside FinPay’s direct control.
- Analysis must be replayable enough to investigate a decision, while raw prompts and payment data follow retention rules.
- Duplicate delivery and consumer crashes are normal recovery events, not exceptional cases.
- Search and dashboards may be unavailable without changing financial truth.

These constraints rule out “the LLM is the final check.” They do not yet tell us whether every request should wait synchronously.

## Choosing the Detector

Rules are the right tool for schema validation, allowlists, amount limits, and obvious prompt-injection patterns. They are fast and explainable, but they do not generalize well.

Velocity and peer-group statistics can identify unusual amount or frequency patterns. They are inexpensive, but seasonal merchant behavior can look anomalous. A calibrated traditional model may be a better fit for a stable risk score, provided FinPay has labels, drift checks, and a release process.

An LLM is useful when the signal depends on ambiguous free text or small structured extraction. It is also the least predictable option here: output can be nondeterministic, latency and cost vary, and a malicious note can try to influence the instructions. The gateway should not use an LLM where a rule or calibrated model is sufficient.

The shared AI core from the earlier FinPay article gives adapters a narrow `LlmPort`, redaction, deadlines, provider metadata, and metrics. Reusing that port avoids duplicating provider mechanics. It must not hide gateway policy. KYC intake and retrieval-augmented explanations are different bounded use cases; this guardrail should not retrieve arbitrary knowledge or send a full customer profile to an external model.

## Make the Signal Bounded

The port should accept a purpose-specific input, not a general chat transcript:

```java
record BoundedInput(
        String paymentId,
        String merchantText,
        long amountMinor,
        String currency) {}

record AiSignal(
        String classification,
        double confidence,
        String modelVersion,
        String promptVersion) {}
```

The adapter redacts or tokenizes fields before the call, caps input and output size, and validates strict structured output. A syntactically valid response still needs semantic checks: confidence must be in range, classification must be known, and the model cannot invent authoritative payment facts. The adapter has connection, read, and total deadlines. A retry is allowed only for a classified transient failure and only if the remaining deadline permits it.

If a request has a 300 ms budget, a second 300 ms retry violates the budget. Exponential backoff with jitter, a provider rate-limit policy, a circuit breaker, and a concurrency limit bound the damage. When the provider is unavailable, the adapter returns a typed `unavailable` result, not an implicit `allow`.

## Sync, Async, or Hybrid?

Three alternatives are reasonable.

**Synchronous blocking.** A healthy provider gives an immediate signal, but payment availability is coupled to model latency, quota, and provider health. This is acceptable only for a narrow gate when the business explicitly accepts its latency and degraded-mode behavior.

**Asynchronous analysis after acceptance.** The gateway accepts the payment and publishes an event; a consumer later analyzes it and can place the payment into `HELD` or `REVIEW`. This protects gateway latency and supports replay, but it cannot prevent an already-authorized side effect. The payment state machine must support a pending or compensating path.

**Hybrid bounded gate.** Cheap deterministic checks run synchronously. Only a selected subset receives a model call within a strict deadline, while deeper analysis is published for asynchronous processing. This costs more design effort, but keeps the high-volume path predictable and gives uncertain cases a controlled outcome.

We choose the hybrid design for this reference system because it preserves a small synchronous safety boundary without making AI a prerequisite for every payment. The exact outcome is a product and risk decision:

- `fail-open` protects availability but increases exposure during an outage;
- `fail-closed` limits exposure but can turn a provider outage into a denial of service;
- `STEP_UP` asks for stronger authentication and adds friction;
- `REVIEW` leaves the payment in a deterministic pending state.

Low-risk payments may use deterministic rules when AI is unavailable. High-risk payment classes may require step-up or review. “AI failed, so block everything” is not an architecture; it is an unexamined business decision.

## Async Creates a New Correctness Problem

The event boundary isolates latency, but at-least-once delivery means a consumer must expect duplicates. This is unsafe:

```java
// WRONG: the check and the side effect are separate.
if (!store.exists(eventId)) {
    AiSignal signal = llm.analyze(input);
    settlementApi.execute(signal);
    store.save(eventId, signal);
}
```

A crash after `execute` and before `save` repeats the external call. An atomic inbox claim prevents concurrent processing of the same event, but storage idempotency does not make an external side effect idempotent:

```java
// RIGHT: claim atomically; the unique key serializes duplicates.
if (!store.insertIfAbsent(eventId, PROCESSING)) {
    return store.resultFor(eventId); // existing or in-progress
}

try {
    AiSignal signal = llm.analyze(input);
    Verdict verdict = policy.evaluate(input, signal);
    store.complete(eventId, verdict);
    outbox.append(eventId, verdict); // publish after durable state is committed
    return verdict;
} catch (RetryableFailure failure) {
    store.releaseOrLease(eventId);
    throw failure;
}
```

The unique key can live in a database inbox or another durable atomic store. A lease makes abandoned `PROCESSING` rows reclaimable. The settlement API still needs its own idempotency key, because a crash can happen after the network call even when the inbox is correct. An outbox makes the database state and publish intent atomic, but its consumers must deduplicate too. Each new guarantee closes one failure window and exposes another.

Ordering is similarly limited. Partitioning by `paymentId` can preserve order for that key, but not global order. A stale event must be rejected by the deterministic payment state machine, not trusted because it arrived from a particular partition. Poison messages need bounded attempts, backoff and jitter, and quarantine in a dead-letter topic; otherwise one malformed payload can consume all retries.

## The Resulting Architecture

Only after those decisions do the components earn their place:

```text
JWT-authenticated request
        |
        v
cheap rules + bounded input validation -----> immediate policy outcome
        |
        v
gateway.raw.in (Kafka: replay source)
        |
        v
guardrail consumers
  atomic inbox claim by eventId
  redact/minimize -> LLM adapter with budget
  schema validation -> deterministic policy
        |
        +--> gateway.ai.verdict (signal/decision intent)
        +--> durable audit/outbox
                          |
                          v
                 OpenSearch (query/index model)
```

Kafka exists here because the analysis must absorb bursts, be replayable, and be decoupled from provider latency. The ledger database remains the financial source of truth. The inbox owns processing state. The outbox protects publication intent. OpenSearch exists for investigation and query speed; it can be rebuilt and never authorizes settlement.

The guardrail emits a bounded recommendation such as `ALLOW_WITH_SIGNAL`, `HOLD`, `STEP_UP`, or `REVIEW`. A payment service applies the authoritative transition and enforces account state, limits, and idempotency. The model never receives a port to the ledger.

## Operational Reality

At 2,000 analyzed events per second and an illustrative model p95 of 400 ms:

```text
required in-flight calls ~= 2,000/s x 0.4s = 800
```

That is in-flight work before headroom, retries, slow tails, connection limits, and provider quotas. If the provider permits 500 concurrent calls, adding consumers cannot create the missing 300 slots. FinPay must reduce model traffic with rules, accept lag, use another detector, or negotiate capacity. If 5% of 10,000 requests per second reach the model, that is 500 calls per second, or 43.2 million calls per day before retries. Cost is a capacity constraint.

An on-call engineer at 3 AM needs to follow one payment through the system. Traces should connect a request ID, payment ID, event ID, AI inference ID, model version, and policy version without putting those identifiers into metric labels. Metrics should use bounded labels such as provider, model version, policy version, outcome, and error class. Watch gateway latency, AI timeout and provider error rates, circuit state, consumer lag and queue age, duplicate rate, policy outcomes, retry and DLQ rates, database connection utilization, and index failures.

Audit data should record decision and event timestamps, a minimized feature snapshot or protected reference, signal and confidence, validation result, provider, model and prompt versions, policy version, latency, fallback reason, and override. Do not retain raw prompts by default. Store hashes or references when they are enough to reproduce the evidence, and document what cannot be reconstructed.

Security follows the same boundary. A caller-selected key ID identifies a credential; it is not the credential. Resolve the secret through a secret manager, scope and rotate it, and keep it out of prompts, logs, and exceptions. Authenticate callers, authorize tenants, rate-limit before expensive work, and prevent one tenant from consuming the shared provider budget. Treat merchant text as hostile data, not instructions. Minimize PII, verify provider retention and residency terms, and apply deletion controls.

Model changes need evaluation sets containing injection attempts, malformed output, legitimate edge cases, and reviewed outcomes. Track precision, recall, calibration, drift, disagreement with deterministic rules, and decision-distribution changes. Version the model, prompt, input snapshot, provider, and policy. A replay with a changed model is a new analysis, not proof of historical truth.

## What This Boundary Teaches

The useful architectural unit is not “an LLM in front of payments.” It is a bounded port that turns untrusted input into a versioned signal. Deterministic policy decides what that signal means. The payment state machine decides whether money may move. The ledger records the financial truth.

Async processing solves the latency problem but creates duplicate delivery. Atomic claims solve concurrent work but do not solve external side effects. Retries improve recovery but can create storms. Caches may reduce load but introduce staleness. Every fix moves the failure boundary; experienced design makes that movement explicit.

For the next FinPay layers, this boundary is the useful contract: AI can advise, explain, classify, and enrich. It cannot become the authority merely because it sits close to the payment API.

## References

- Apache Kafka documentation, “Message Delivery Semantics”: <https://kafka.apache.org/documentation/#semantics>
- OWASP, “LLM01: Prompt Injection”: <https://owasp.org/www-project-top-10-for-large-language-model-applications/>
- Prometheus documentation, “Instrumentation labels”: <https://prometheus.io/docs/practices/instrumentation/#labels>
- NIST, “AI Risk Management Framework”: <https://www.nist.gov/itl/ai-risk-management-framework>
