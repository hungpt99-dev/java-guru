---
title: "Designing an AI Guardrail for a Payment API Gateway"
description: "A problem-driven design for keeping probabilistic AI signals out of authoritative payment decisions while preserving safety, latency, replayability, and auditability."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/gateway>

## The Problem

Consider a payment gateway that has already authenticated a caller with JWT and now has to route a request. The request may contain free text from a merchant, customer, or upstream integration. That text can contain a prompt-injection attempt, malformed instructions, or a description that conflicts with the structured payment fields.

The team wants an AI check before routing. It sounds modest: send the text to a model, receive a fraud or safety verdict, and reject suspicious requests. The engineering question is more precise:

> How can a gateway use an uncertain, remote, expensive component without letting it become the authority for money movement?

This is a fictional/reference design, not a claim about an independently verified FinPay deployment. A production-oriented design would put the guardrail after JWT authentication and before routing, but would keep settlement and deterministic business rules authoritative.

## Why This Is Harder Than It Looks

The guardrail is not just a classifier. It sits at the intersection of two very different contracts:

- The ledger and settlement path needs strict consistency, stable outcomes, and controlled side effects.
- Anomaly and content analysis can tolerate eventual processing, bounded uncertainty, and a fallback.

Keeping those paths separate lets each fail independently. A model can time out without corrupting a payment, and an audit index can be rebuilt without becoming the source of truth.

The model also has failure modes that a normal HTTP dependency does not: false positives, false negatives, nondeterministic responses, prompt injection, hallucinated fields, model or prompt changes, provider rate limits, and an answer that is syntactically valid but semantically impossible. A valid JSON document is not evidence that a payment decision is valid.

The useful contract is therefore:

```text
AI signal -> deterministic policy -> business decision
```

Not:

```text
AI response -> block money
```

## The Naive Design

The smallest design places the model in the synchronous gateway path:

```text
client -> JWT auth -> LLM -> route or reject -> payment service
```

It appears to solve the problem with little infrastructure. The model sees the request, returns JSON, and the gateway routes only when the answer is positive.

## Where the Naive Design Breaks

At 10,000 requests per second, a synchronous model call makes the gateway an AI connection pool. If the provider takes two seconds, Little's Law gives an approximate in-flight demand of:

```text
concurrency = throughput x latency = 10,000/s x 2s = 20,000 calls
```

At ten seconds, it is 100,000 calls. A fixed thread pool of four is not a capacity plan; it merely turns overload into a queue. A queue with no bounded admission policy eventually consumes memory and increases customer latency.

Other failures are less visible:

- The provider is unavailable, so every request waits for a timeout. Retries amplify the outage and can create a retry storm.
- A model says `allow` after a false negative, or says `block` for a legitimate customer. The business must choose the consequence; the model cannot choose it implicitly.
- Payment succeeds, then audit indexing fails. Treating OpenSearch as the authority would make a harmless index outage look like a payment failure; treating it as best-effort without an audit plan loses evidence.
- A Kafka record is redelivered after a consumer crash. An `exists()` check followed by an insert is racy: two consumers can both observe `false` and both call the provider or downstream side effect.
- A consumer rebalance or out-of-order event may process a newer request before an older one. Ordering is not automatically preserved across partitions or business keys.
- One malformed record is retried forever, starving healthy records: a poison message needs a bounded retry policy and a dead-letter or quarantine path.
- A model update changes the decision distribution. Without model and prompt versions, the team cannot explain why two equivalent requests received different treatment or reproduce a previous result.

The failure that looks harmless is often an audit write. If the system writes a verdict to an OpenSearch index and considers the operation complete, an index loss silently destroys the query model. OpenSearch is useful for search and investigation, but Kafka or a durable audit store must retain the rebuildable source.

## The First Design Decision

The gateway must not ask the model to approve a payment. It asks for a bounded signal about untrusted content or unusual attributes. Policy then combines that signal with authoritative facts:

```text
structured payment + bounded text -> AI signal
AI signal + rules + limits + account state -> policy outcome
policy outcome -> route, step-up, hold, or manual review
```

A policy may treat `confidence=0.61` as “review” rather than “block.” It may ignore a model claim that contradicts the payment amount or authenticated account. The policy is deterministic, versioned, tested, and accountable to the business.

## The Hard Engineering Problems

### 1. What kind of detector belongs here?

There is no reason to use an LLM for every signal.

- **Rules** fit known indicators, allowlists, amount limits, schema constraints, and prompt-injection patterns. They are fast and explainable, but brittle against new patterns.
- **Statistical methods** fit rate, amount, velocity, and peer-group deviations. They are cheap and useful for baselines, but can confuse legitimate seasonal behavior with risk.
- **Traditional ML** fits a trained fraud or risk score over stable features. It supports calibration and offline evaluation, but requires labeled data, drift monitoring, and a controlled release process.
- **LLMs** fit ambiguous free text, classification with context, and extracting a small set of structured signals. They are slower, costlier, nondeterministic, and vulnerable to prompt injection and hallucination. They should not be the only control on a payment path.

The gateway can use a shared AI core library for provider adapters, timeouts, redaction, model metadata, and metrics. It should not use that library to hide business policy. KYC document intake and RAG-based transaction explanation are separate use cases: a gateway guardrail should not retrieve arbitrary knowledge or send a full customer profile to an external model merely because a shared client makes it easy.

### 2. How do we make a remote model bounded?

`LlmPort` should expose a narrow operation, such as `analyze(BoundedInput)`, rather than a general chat interface. The adapter should enforce:

- a total deadline propagated from the request or event;
- connection, read, and response-size limits;
- one or a small number of retries only for classified transient failures;
- exponential backoff with jitter;
- a circuit breaker and concurrency limit;
- provider rate-limit handling and a fallback outcome.

If the caller has a 300 ms budget, a retry that can consume another 300 ms is not a retry policy; it is a timeout violation. When the provider is down, the guardrail should return `unavailable` and route to deterministic rules, step-up authentication, or review according to policy. Failure must not silently become approval.

### 3. How do we prevent duplicate work and duplicate effects?

This code is not idempotent:

```java
// WRONG: the check and the write are separate operations.
if (!processingStore.exists(eventId)) {
    ModelOutput output = llm.analyze(input);
    settlementApi.execute(output);
    processingStore.save(eventId, output);
}
```

Two consumers can both see `false`. A crash after `settlementApi.execute` and before `save` causes a replay to execute the external effect again.

The real boundary needs an atomic claim, normally a unique constraint or atomic insert:

```java
// RIGHT: claim atomically; the unique key serializes duplicates.
if (!processingStore.insertIfAbsent(eventId, PROCESSING)) {
    return processingStore.resultFor(eventId); // existing or in-progress
}

try {
    ModelOutput output = llm.analyze(input);
    GuardrailVerdict verdict = policy.validate(input, output);
    processingStore.complete(eventId, verdict); // durable result
    outbox.append(eventId, verdict);            // publish later
    return verdict;
} catch (RetryableFailure failure) {
    processingStore.releaseOrLease(eventId);
    throw failure;
}
```

`insertIfAbsent` can be backed by a database unique index, Redis `SETNX` with an expiry, or a transactional inbox. The choice depends on recovery and durability requirements. A deterministic event ID and downstream idempotency key are still required.

Idempotent **storage** is not idempotent **side effects**. A unique processing row prevents two rows, but it cannot undo two emails, provider calls, or settlement requests already sent. For money movement, the settlement API needs its own idempotency contract or a durable deduplication boundary. A transactional outbox makes the processing-record update and the intent to publish atomic within one database, but the consumer of that outbox must also deduplicate.

## Design Options

**A. Synchronous blocking guardrail.** Lowest conceptual latency when the provider is healthy, but it couples payment availability to AI latency, capacity, and provider health. Use only for a narrowly bounded, fail-closed control when the business accepts the latency.

**B. Asynchronous analysis after acceptance.** Kafka receives the event, the guardrail analyzes it, and a later policy action can hold or review the transaction. This isolates the payment path and scales consumers independently, but cannot prevent an already authorized action unless the business state machine supports a pending state.

**C. Hybrid bounded gate.** Run cheap deterministic checks synchronously, optionally call AI within a strict budget for a subset, and emit an event for deeper analysis. This usually gives the best separation: obvious bad requests fail quickly, uncertain requests take a controlled path, and expensive analysis is asynchronous.

For this gateway, option C is the proposed direction. The exact synchronous behavior is a product and risk decision, not an architectural assumption.

## Trade-offs

Fail-open maximizes availability but can increase exposure during a provider outage. Fail-closed reduces that exposure but can deny legitimate traffic and create a denial of service through the dependency. A review or step-up state is often a better third outcome.

At-least-once Kafka processing is practical and replayable, but requires idempotent consumers. Exactly-once Kafka semantics do not make an external HTTP settlement call exactly once. More partitions improve throughput but do not guarantee global ordering. A compact audit record protects privacy and cost but may reduce forensic detail; the system should store the minimum reproducible evidence rather than entire prompts by default.

## The Architecture

The resulting boundary is:

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

Kafka is the event source and replay mechanism, not the ledger. The payment or ledger database remains the system of record. OpenSearch is a read model for investigations; if its index is lost, consume retained events or audit records and rebuild it. A database inbox/outbox or equivalent durable store owns processing state. The application layer coordinates this flow; hexagonal ports such as `LlmPort`, `KeyProviderPort`, `ProcessingStore`, `PolicyPort`, and `DecisionAuditPort` keep Spring, Kafka, HTTP, secret-manager, and OpenSearch adapters outside the domain.

The guardrail emits a recommendation such as `ALLOW_WITH_SIGNAL`, `HOLD`, `STEP_UP`, or `REVIEW`. A settlement service applies its own authoritative state transition. It never treats an AI verdict as permission to mutate the ledger.

## Failure Scenarios

- **AI provider unavailable or rate-limited:** circuit opens, no unbounded retry occurs, and policy selects rules, step-up, or review.
- **Timeout or invalid JSON:** record a typed failure and model metadata; do not parse partial text or approve by default.
- **Duplicate or out-of-order event:** the atomic inbox and deterministic event key return the prior result. Business sequence checks reject stale state transitions.
- **Consumer crash or rebalance:** an unfinished lease becomes reclaimable. The downstream idempotency key prevents repeated external effects.
- **Retry storm:** exponential backoff, jitter, maximum attempts, concurrency limits, and a circuit breaker cap pressure. A dead-letter topic quarantines poison messages for inspection.
- **Queue saturation or backpressure:** bound Kafka consumer concurrency and local buffers. Pause or slow intake rather than allowing unbounded memory growth; alert on consumer lag.
- **Database failure:** do not acknowledge the Kafka record until the durable processing state is committed. If the database is unavailable, the record remains retryable.
- **OpenSearch failure:** keep the durable audit or outbox record, alert, and rebuild the index later. Search availability must not determine settlement correctness.
- **Model regression or rollback:** deploy model and prompt versions as configuration with evaluation gates. Route traffic by version, compare decision distributions, and retain the prior version for rollback.
- **Replay:** replaying Kafka should reproduce signals only when the input snapshot, feature values, model, prompt, provider, and policy versions are retained. Otherwise mark the result as a new analysis, not historical truth.

## Capacity & Performance

Capacity starts with measured workload assumptions, not a thread count. If 2,000 events/s are analyzed and the model p95 latency is 400 ms:

```text
required in-flight calls ~= 2,000/s x 0.4s = 800
```

That is before headroom, retries, slow-tail latency, connection limits, and provider quotas. A concurrency limit should be lower than the provider quota and sized through load tests; excess work should remain in Kafka rather than occupy unbounded application threads. If the provider allows 500 concurrent calls, the design must either use a cheaper detector, partition traffic, or accept lag. Raising consumer count alone cannot create provider capacity.

Cost is also capacity. If 5% of 10,000 requests/s reach a model, that is 500 calls/s, or 43.2 million calls per day before retries. Rules and statistical features can reduce both cost and blast radius. Track token or request usage by model and service, but never place `transaction_id` or `account_id` in Prometheus labels; those create unbounded cardinality. Use logs or traces for individual IDs.

## Security & Privacy

`X-FinPay-Key-Id` identifies a caller-selected BYOK credential; it is not the credential. Resolve the secret through a secret manager, keep it out of source, prompts, exceptions, and logs, and expose it to the adapter only for the call. Rotate and scope keys, and audit access to them.

Minimize the model input. Send only the fields needed for the specific signal, tokenize or redact PII, encrypt data in transit and at rest, restrict operator access, and enforce retention and deletion policies. Do not casually send an entire transaction, customer profile, or KYC document to an external provider. Verify provider retention, training, residency, and subprocessors before sending data. Prompt injection can attempt to extract system instructions or sensitive context; treat all external text as data and keep secrets out of prompts.

## Observability

Operational metrics are necessary but insufficient. Useful business and system signals include:

- `transactions_processed`, `anomalies_detected`, `review_rate`, and decision distribution;
- estimated false-positive and false-negative rates from reviewed outcomes;
- `ai_timeout_rate`, provider error rate, model error rate, circuit-open events, and Kafka lag;
- request latency, queue age, retry count, dead-letter count, and database/OpenSearch failures;
- AI request cost or token usage, model version, prompt version, policy version, and provider.

Use bounded labels such as `provider`, `model_version`, `policy_version`, `outcome`, and `error_class`. Never use transaction or account identifiers as Prometheus label values. Logs and traces may carry a protected correlation ID under access control, but should redact prompts, tokens, API keys, and unnecessary payment data.

For auditability, preserve at least `transaction_id`, `event_id`, event and decision timestamps, the minimized feature snapshot, `risk_score` or signal, decision, model version, prompt version, provider, latency, validation result, policy version, fallback reason, and human or rule override. This is more than application logging. It is the evidence needed to explain and, where possible, reproduce a decision. Store hashes or references when the raw payload is too sensitive, and document what cannot be reconstructed.

## AI-Specific Considerations

Evaluate the guardrail as a decision-support system. A hold rate can rise while the model becomes worse. Build labeled evaluation sets for injection, malformed output, legitimate edge cases, and adversarial text. Monitor precision, recall, calibration, drift, disagreement with deterministic rules, and changes in decision distribution. Test provider and model changes offline before routing production-like traffic.

Use structured output with strict size and field constraints, but do not confuse schema compliance with truth. Set a low-variance temperature where supported, record nondeterminism, and make policy robust to missing or low-confidence signals. A timeout, hallucinated explanation, or low confidence should produce an explicit fallback reason. Explanations are evidence for review, not authoritative facts.

## What We Would Do Differently

We would avoid starting with a generic “AI guardrail” service. First define the business state machine and authority boundary, then identify which signals cannot be produced by rules or a calibrated model. We would keep KYC intake, RAG retrieval, and gateway content analysis as separate bounded use cases even if they share an AI core library.

We would also make replay a design requirement at the beginning. Capture versioned inputs and decisions, use an inbox/outbox, and test duplicate, crash, rebalance, provider outage, and index rebuild scenarios before optimizing the happy path. The architecture is a consequence of those guarantees, not the other way around.

## Key Lessons

1. Put AI behind a bounded port and make it produce a signal, not a money-moving command.
2. Use an atomic durable idempotency boundary; `exists()` followed by `save()` is not safe under concurrency.
3. Separate Kafka replay, the ledger system of record, and OpenSearch’s query model.
4. Design timeout, fallback, backpressure, and provider outage behavior before choosing a model.
5. Version the model, prompt, policy, input features, and provider so decisions can be audited and replayed.
6. Measure business outcomes as well as latency and errors, while keeping high-cardinality identifiers out of Prometheus labels.
7. Minimize sensitive data sent to AI providers and treat external text as untrusted data.

## Interview Questions

- Who has authority to block or settle a payment, and what happens when the AI signal disagrees with that authority?
- Given throughput and model latency, how many concurrent provider calls are required, and what quota limits the design?
- What exact operation prevents two Kafka consumers from claiming the same event?
- What happens after a crash between an external side effect and the idempotency record?
- Can an OpenSearch index be deleted and rebuilt without changing the ledger?
- Which model, prompt, feature snapshot, and policy version explain a historical decision?
- How are false positives, false negatives, provider outages, and model regressions detected?

## References

- Apache Kafka documentation, “Message Delivery Semantics”: <https://kafka.apache.org/documentation/#semantics>
- OWASP, “LLM01: Prompt Injection”: <https://owasp.org/www-project-top-10-for-large-language-model-applications/>
- Prometheus documentation, “Instrumentation labels”: <https://prometheus.io/docs/practices/instrumentation/#labels>
- NIST, “AI Risk Management Framework”: <https://www.nist.gov/itl/ai-risk-management-framework>
