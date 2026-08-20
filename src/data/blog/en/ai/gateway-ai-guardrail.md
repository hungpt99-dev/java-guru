---
title: "Designing an AI Guardrail for a Payment API Gateway"
description: "A problem-driven design for keeping probabilistic AI signals out of authoritative payment decisions while preserving safety, latency, replayability, and auditability."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## The Incident That Changes the Question

Imagine a FinPay merchant submitting a payment with a free-text note. The note may be harmless context, copied customer text, or an attempt to influence a review rule. The risk team asks for an AI check before the payment is routed.

The first request usually sounds simple: send the note to a model, then reject the payment if the answer is unsafe. That wording hides the real problem. FinPay's payment core already has hard invariants: the ledger is the financial source of truth, and a deterministic state machine controls transitions such as `RECEIVED`, `AUTHORIZED`, `HELD`, and `REJECTED`.

An external model is not part of that authority boundary. It is slow, probabilistic, expensive, and controlled by a provider outside FinPay's failure domain. The design question is therefore not “How do we make the model decide?” It is:

> How can the gateway use an uncertain dependency without allowing it to authorize, reject, or mutate money directly?

This is a fictional reference design, not a claim about a deployed FinPay system. Its central rule is proposed:

```text
AI inference -> bounded AI signal -> deterministic policy -> payment state machine -> ledger / settlement
```

The model may report `injection_suspected`, a risk score, or a classification. It may not update an account balance, write the ledger, authorize settlement, or turn its explanation into a payment command.

## Start With the Obvious Design

The first sketch has very few boxes:

```text
client -> JWT authentication -> LLM -> route or reject -> payment service
```

The gateway authenticates the request, asks the model for `allow` or `deny`, and routes only an allowed payment. That looks efficient on a whiteboard. In practice, it has made the model a hidden authorization service and put every payment behind provider latency and availability.

Assume, for illustration, that the gateway receives 10,000 requests per second and the provider takes two seconds. Little's Law gives an approximate model concurrency of:

```text
in-flight calls = throughput x latency = 10,000/s x 2s = 20,000
```

At ten seconds, the same traffic would create 100,000 in-flight calls. A larger thread pool does not create provider capacity. It consumes memory, connections, and downstream slots until the queue becomes the outage.

Now change only provider latency. If it rises from an illustrative 300 ms to 4 seconds, gateway workers stay occupied, request deadlines expire at different layers, and a careless retry can overlap the original call. Connection pools fill. Provider rate limits return more errors. The retry queue grows, so healthy payments compete with failed AI calls. The failure has crossed the boundary from “AI is unavailable” to “payments are unavailable.”

The response itself is another failure surface. Valid JSON can still contain an unknown classification, an out-of-range confidence, or a fabricated payment fact. A false negative can miss suspicious text; a false positive can deny a legitimate merchant. Neither outcome should be selected by whichever timeout or parser branch happened to execute.

## Constraints Before Components

For this example, these are design assumptions, not FinPay production measurements:

- Payment authorization and ledger transitions remain deterministic, auditable, and independent of an LLM response.
- The synchronous gateway budget is bounded, and the degraded outcome when that budget is exhausted is explicit.
- Free text is untrusted input. Customer PII and credentials are not sent to a model merely because the gateway can access them.
- Provider quotas, latency, model changes, and outages are outside FinPay's direct control.
- Analysis is replayable enough to investigate a decision, while raw prompts and payment data follow retention rules.
- Duplicate delivery and consumer crashes are normal recovery events.
- Search and dashboards may be unavailable without changing financial truth.

These constraints rule out “the LLM is the final check.” They do not yet tell us whether every payment should wait synchronously.

## Choose the Cheapest Useful Detector

Rules should handle schema validation, allowlists, amount limits, and obvious prompt-injection patterns. They are fast and explainable, but do not generalize well.

Velocity and peer-group statistics can identify unusual amount or frequency patterns. They cost less than a remote model, but seasonal merchant behavior can look anomalous. A calibrated traditional model may be a better fit for a stable risk score if FinPay has labels, drift checks, and a release process.

An LLM is useful when the signal depends on ambiguous free text or a small structured extraction. It is also the least predictable option: output can be nondeterministic, latency and cost vary, and hostile text can try to influence the instructions. The gateway should not use an LLM where a rule or calibrated model is sufficient.

The shared AI core from an earlier FinPay article provides a narrow `LlmPort`, redaction, deadlines, provider metadata, and metrics. Reusing that port avoids duplicating provider mechanics. It must not hide gateway policy. KYC intake and retrieval-augmented explanations are different bounded use cases; this guardrail should not retrieve arbitrary knowledge or send a full customer profile to an external model.

## Turn the Model Into a Bounded Signal

The adapter receives purpose-specific input, not a general chat transcript:

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

Before the call, the adapter redacts or tokenizes fields and caps input and output size. It validates strict structured output. Syntactic validity is not enough: confidence must be in range, classification must be known, and the model cannot invent authoritative payment facts.

The adapter has connection, read, and total deadlines. A retry is allowed only for a classified transient failure and only when the remaining deadline permits it. If the request budget is 300 ms, another 300 ms retry already violates it. Backoff with jitter, provider rate-limit handling, a circuit breaker, and a concurrency limit bound the damage. When the provider is unavailable, the adapter returns typed `unavailable`, not an implicit `allow`.

## Decide Where to Wait

Three designs are plausible.

**Synchronous blocking.** A healthy provider returns a signal immediately, but payment availability is coupled to model latency, quota, and health. This is acceptable only for a narrow gate when the business explicitly accepts the latency and degraded-mode behavior.

**Asynchronous analysis after acceptance.** The gateway accepts the payment and publishes an event. A consumer analyzes it later and may request `HELD` or `REVIEW`. This protects gateway latency and supports replay, but cannot prevent an already-authorized side effect. The payment state machine needs a pending or compensating path.

**Hybrid bounded gate.** Cheap deterministic checks run synchronously. Only a selected subset receives a model call within a strict deadline; deeper analysis is published for asynchronous processing. This takes more design work, but keeps the high-volume path predictable and gives uncertain cases a controlled outcome.

We choose the hybrid design for this reference system because it preserves a small synchronous safety boundary without making AI a prerequisite for every payment. The exact degraded outcome is a product and risk decision:

- `fail-open` protects availability but increases exposure during an outage;
- `fail-closed` limits exposure but can turn an outage into denial of service;
- `STEP_UP` asks for stronger authentication and adds friction;
- `REVIEW` keeps the payment in a deterministic pending state.

Low-risk payments may use deterministic rules when AI is unavailable. High-risk classes may require step-up or review. “AI failed, so block everything” is not an architecture; it is an unexamined business decision.

## Async Moves the Failure Boundary

The event boundary isolates provider latency, but at-least-once delivery means duplicates are expected. This is unsafe:

```java
// WRONG: the check and the side effect are separate.
if (!store.exists(eventId)) {
    AiSignal signal = llm.analyze(input);
    settlementApi.execute(signal);
    store.save(eventId, signal);
}
```

A crash after `execute` and before `save` repeats the external call. An atomic inbox claim prevents concurrent processing of one event, but storage idempotency does not make an external side effect idempotent:

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

The unique key can live in a database inbox or another durable atomic store. A lease makes abandoned `PROCESSING` rows reclaimable. The settlement API still needs its own idempotency key because a crash can occur after the network call even when the inbox is correct. An outbox makes database state and publish intent atomic, but outbox consumers must deduplicate too.

Ordering is also limited. Partitioning by `paymentId` can preserve order for that key, not global order. A stale event must be rejected by the deterministic payment state machine, not trusted because it arrived from a particular partition. Poison messages need bounded attempts, backoff with jitter, and quarantine in a dead-letter topic.

## Architecture After the Reasoning

Only now do the components earn their place:

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

Kafka exists here because analysis must absorb bursts, support replay, and be decoupled from provider latency. The ledger database remains the financial source of truth. The inbox owns processing state. The outbox protects publication intent. OpenSearch exists for investigation and query speed; it can be rebuilt and never authorizes settlement.

The guardrail emits a bounded recommendation such as `ALLOW_WITH_SIGNAL`, `HOLD`, `STEP_UP`, or `REVIEW`. The payment service applies the authoritative transition and enforces account state, limits, and idempotency. The model has no port to the ledger.

## Operational Reality

Assume, for capacity planning, 2,000 analyzed events per second and an illustrative model p95 of 400 ms:

```text
required in-flight calls ~= 2,000/s x 0.4s = 800
```

That is in-flight work before headroom, retries, slow tails, connection limits, and provider quotas. If the provider permits 500 concurrent calls, more consumers cannot create the missing 300 slots. FinPay must reduce model traffic with rules, accept lag, use another detector, or negotiate capacity. If 5% of an illustrative 10,000 requests per second reach the model, that is 500 calls per second, or 43.2 million calls per day before retries. Cost is a capacity constraint.

An on-call engineer needs to follow one payment through the system. Traces should connect request ID, payment ID, event ID, AI inference ID, model version, and policy version without putting those identifiers into metric labels. Metrics should use bounded labels such as provider, model version, policy version, outcome, and error class. Watch gateway latency, AI timeout and provider error rates, circuit state, consumer lag and queue age, duplicate rate, policy outcomes, retry and DLQ rates, database connection utilization, and index failures.

Audit data should record event and decision timestamps, a minimized feature snapshot or protected reference, signal and confidence, validation result, provider, model and prompt versions, policy version, latency, fallback reason, and override. Do not retain raw prompts by default. Store hashes or references when they are enough to reproduce the evidence, and document what cannot be reconstructed.

Security follows the same boundary. A caller-selected key ID identifies a credential; it is not the credential. Resolve the secret through a secret manager, scope and rotate it, and keep it out of prompts, logs, and exceptions. Authenticate callers, authorize tenants, rate-limit before expensive work, and prevent one tenant from consuming the shared provider budget. Treat merchant text as hostile data, not instructions. Minimize PII, verify provider retention and residency terms, and apply deletion controls.

Model changes need evaluation sets containing injection attempts, malformed output, legitimate edge cases, and reviewed outcomes. Track precision, recall, calibration, drift, disagreement with deterministic rules, and decision-distribution changes. Version the model, prompt, input snapshot, provider, and policy. A replay with a changed model is a new analysis, not proof of historical truth.

## What We Learned

The useful architectural unit is not “an LLM in front of payments.” It is a bounded port that turns untrusted input into a versioned signal. Deterministic policy decides what that signal means. The payment state machine decides whether money may move. The ledger records financial truth.

Async processing solves latency but creates duplicate delivery. Atomic claims solve concurrent work but not external side effects. Retries improve recovery but can create storms. Caches may reduce load but introduce staleness. Every fix moves the failure boundary; experienced design makes that movement explicit.

The contract for later FinPay layers is simple: AI may advise, explain, classify, and enrich. It cannot become the authority merely because it sits close to the payment API.

## References

- Apache Kafka documentation, “Message Delivery Semantics”: <https://kafka.apache.org/documentation/#semantics>
- OWASP, “LLM01: Prompt Injection”: <https://owasp.org/www-project-top-10-for-large-language-model-applications/>
- Prometheus documentation, “Instrumentation labels”: <https://prometheus.io/docs/practices/instrumentation/#labels>
- NIST, “AI Risk Management Framework”: <https://www.nist.gov/itl/ai-risk-management-framework>

<!-- finpay-repo-link -->

## FinPay Reference Implementation

This article is part of the FinPay reference series. The related service implementation lives in the [finpay-lab/gateway](https://github.com/finpay-lab/gateway) repository.
