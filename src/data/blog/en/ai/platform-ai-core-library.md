---
title: "Designing a Shared AI Core for FinPay Microservices: From Failure Modes to Guardrails"
description: "A practical design for shared LLM integration with BYOK credentials, resilience controls, idempotency, and auditable outcomes."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

FinPay already has the parts that cannot be experimental: the ledger is the financial source of truth, settlement follows deterministic rules, and payment state transitions are controlled by the payment core. The new problem is narrower and more operational:

Several FinPay services want AI assistance. One needs a risk signal during payment review. Another wants KYC enrichment. A support workflow wants classification. How do we add an unreliable, rate-limited external dependency without allowing it to weaken the invariants that already protect money?

The central design insight is simple: **AI must stop at a typed signal boundary.** The signal can be useful, late, wrong, duplicated, or unavailable. Deterministic policy decides what it means. The payment state machine decides which transition is legal. The ledger records the financial result.

```text
AI signal
    -> deterministic policy
    -> business state machine
    -> financial transaction
    -> ledger / settlement
```

This article is a reference design and reasoning exercise. It does not claim that FinPay has experienced the incidents or operates at the example volumes below.

## A Reasonable First Attempt

Imagine the payment-review team adding an AI call directly to its endpoint:

```java
// WRONG: secret, unbounded call, and business authority in one request
String answer = llm.chat(apiKey, request.toJson());
return answer.contains("approve") ? APPROVE : REJECT;
```

It looks efficient. The caller sends a request, receives an answer, and continues. Production exposes the hidden decisions:

- What happens when the provider takes too long?
- Which failures are safe to retry?
- What does malformed or contradictory output mean?
- Can a model label authorize a payment?
- Which evidence lets an investigator reconstruct the result?

The string parser is the most dangerous part. A model response is text, not a payment command. A spelling change, an extra sentence, or an unexpected label can change a branch. More importantly, it gives an external dependency authority over a financial side effect.

The next attempt often adds a duplicate check:

```java
// WRONG: two consumers can both observe false
if (!outcomeRepository.exists(eventId)) {
    outcomeRepository.save(new Outcome(eventId, signal));
}
```

That check is not an atomic claim. Two consumers processing a redelivered event can both read `false`, call the provider, and attempt the write. Even if a unique index protects the row, it does not make a later email, HTTP request, or review-case creation exactly once.

The final problem is latency. Assume, for illustration, 200 requests per second and 750 ms spent waiting for the complete AI path:

```text
concurrency = throughput x latency
            = 200 x 0.75
            = 150 in-flight requests
```

That is an assumption for capacity reasoning, not a FinPay measurement. If provider latency rises to 4 seconds, the same arrival rate creates about 800 in-flight calls. Add retries, database writes, connection-pool limits, and gateway timeouts. A provider slowdown can now consume the caller's resources and trigger client retries, increasing provider load during the outage.

“Add a retry” is not a resilience strategy by itself. It can be an outage multiplier.

## Constraints Before Components

Before choosing Kafka, a cache, a shared library, or a separate service, we write down the constraints:

- The ledger and payment state machine already own balances, authorization, settlement, and irreversible transitions.
- AI may return a bounded risk signal, classification, explanation, recommendation, or enrichment. It may not mutate a balance, ledger entry, settlement state, authorization, or financial state.
- A tenant may bring its own provider credential (BYOK). The credential must come from a secret manager and must not enter source code, prompts, or logs.
- Inference may be slow, unavailable, rate-limited, nondeterministic, or more expensive than expected.
- Each workflow needs an explicit degraded mode. `AI_FAILED` must not silently mean either `APPROVE` or `REJECT` everywhere.
- Investigators need enough evidence to reconstruct a result, while sensitive raw payloads must be minimized and access-controlled.

These constraints tell us more than a component diagram would. We need a narrow technical contract, bounded calls, validated output, durable outcome state, and a clear distinction between an AI observation and a business decision.

## Alternatives and the Decision

### Local provider clients

Each service can own its provider adapter. This is simple to start and allows local experimentation. It also guarantees policy drift: different timeouts, credential handling, retry behavior, schemas, and audit fields. The more callers FinPay adds, the harder it becomes to prove that every one handles provider failure safely.

### One large AI service

A central service can standardize behavior. But if it also owns payment thresholds or emits payment commands, it becomes a second business authority. A generic service cannot know every workflow's loss tolerance, regulatory requirement, or acceptable fallback.

### A shared technical core

A shared module or narrowly scoped internal service can own the repeated technical controls while leaving business meaning with the caller. It creates versioning and adoption work, and a library can still be bypassed. Those are real costs. They are preferable to hiding business policy inside a central AI authority.

### Synchronous versus asynchronous execution

Synchronous inference keeps a user flow simple and is reasonable when the signal is required immediately and the latency budget permits it. Its cost is coupled availability: a provider outage sits on the payment path.

Asynchronous inference isolates payment latency and allows controlled consumer concurrency, replay, and later review. Its cost is eventual consistency. A payment may need a `PENDING_RISK` state, queue-age limits, and a product decision for a payment that remains pending.

We choose a shared technical core with one signal contract and both execution modes. Payment-critical callers may use a tightly bounded synchronous call only when policy justifies the dependency. Enrichment, review, and later analysis use the asynchronous path. We do not force every AI use case into one latency model.

## The Contract That Protects the Ledger

The core exposes a narrow port such as `assess(SignalRequest) -> AISignal`. `AISignal` can contain a bounded score, an allowed enum label, confidence, reason codes, model version, prompt version, and an explicit status such as `VALID`, `TIMEOUT`, or `INVALID_OUTPUT`.

The owning policy evaluates the signal for a particular payment, tenant, and risk tier. The payment state machine validates and performs the legal transition. Only the normal deterministic path can write the ledger or settlement state.

This boundary also makes model changes explainable. A new model can produce a different score for the same input, but the stored model version and policy version show which values and rules produced the outcome. If AI is unavailable, policy can choose deterministic checks, step-up verification, manual review, or delayed processing. The correct response depends on the workflow; the core reports the failure and does not invent one.

```text
payment / review service
        |
        | SignalRequest: minimized input + correlation context
        v
  shared AI core
  - secret resolution
  - provider adapter
  - deadline / retry budget / circuit / concurrency limit
  - structured-output validation
        |
        v
  AISignal + durable outcome
        |
        +--> deterministic policy --> payment state machine --> ledger / settlement
        |
        +--> outbox --> notifications / cases / other effects
```

Every box has a reason. The core isolates provider behavior. Validation prevents text from becoming control flow. The durable outcome makes redelivery safe. Policy and the state machine preserve financial authority. The outbox separates committed state from effects that can be retried.

## Idempotency Has Two Boundaries

The first boundary is durable storage. Let the database arbitrate concurrent delivery with a unique constraint on `(tenant_id, event_id)`:

```java
try {
    outcomeRepository.insertUnique(tenantId, eventId, signal);
    outboxRepository.insert(tenantId, eventId, "RISK_SIGNAL_RECORDED");
} catch (DuplicateKeyException alreadyProcessed) {
    return outcomeRepository.get(tenantId, eventId);
}
```

The outcome and outbox row should commit together. If a consumer crashes after commit but before acknowledging the event, redelivery finds the existing outcome. A cache or search index can accelerate reads; neither can replace this database arbitration.

The second boundary is the side effect. An outbox worker may deliver the same notification or case request more than once. Each effect needs a stable key such as `(tenant_id, event_id, effect_type)`, and the receiver must enforce it or the worker must maintain durable effect state. Idempotent storage does not make an email or HTTP call idempotent.

The provider call is not assumed to be exactly once either. A timeout may occur after the provider accepted the request. A retry can repeat inference unless the provider explicitly supports a request idempotency key. The core must report what it knows, store one authoritative outcome for the event, and avoid promising guarantees it cannot provide.

## The New Failure Created by Async

The asynchronous choice removes provider latency from the request path. It introduces a queue and therefore new questions:

- How old can a `PENDING_RISK` payment become before it needs escalation?
- What happens when events arrive twice or out of order?
- How much work may consumers admit while the provider is rate-limited?
- Can an operator replay a dead-letter event without creating a second financial effect?

An inbox or unique outcome key handles duplicate delivery. A payment sequence or workflow version can enforce the ordering that one workflow needs; global ordering is more expensive and usually unnecessary. Concurrency is limited before provider calls, so queue growth does not become an uncontrolled provider burst. Replay preserves the original event identity and uses the same idempotency rules.

The trade-off is explicit: we accept eventual consistency to protect the payment request from model latency, then make queue age and pending-state handling part of the business design.

## Resilience Is a Budget

Each request receives a total deadline. Provider attempts, backoff, retries, response validation, and persistence must fit inside it. Retry only selected transient failures such as rate limits or temporary server errors. Do not retry invalid schema, rejected payloads, or policy decisions. Exponential backoff with jitter avoids synchronized retries; a retry budget prevents recovery traffic from becoming a second outage.

For an illustrative incident at 14:03, provider latency rises from 300 ms to 4 seconds. Admission control stops unlimited synchronous work. The client times out within its allocated budget. The circuit breaker opens after the configured failure threshold. Consumers stop increasing concurrency. The signal is recorded as `AI_TIMEOUT`, and the owning policy routes the workflow to its declared fallback.

A circuit breaker without admission control only changes when the queue fills. A fallback is not a technical default. The core can return an unavailable signal and evidence; policy chooses deterministic checks, step-up verification, manual review, or delay. The path is labeled as fallback. The system never fabricates confidence or silently converts an outage into approval.

## Safety, Credentials, and Evidence

Provider output must match a versioned schema. Missing fields, unknown labels, contradictory values, malformed JSON, or confidence outside the accepted range become `INVALID_OUTPUT`. The system does not infer intent from free-form text.

Payment descriptions and support notes are untrusted input. Delimit them, send only an allowlisted subset, and validate the response as data. Minimize names, account numbers, addresses, and regulated identifiers through derived features, redaction, or tokenization. BYOK supports tenant-specific credentials and cost attribution, but adds secret-manager traffic and rotation races. A short-lived credential cache can reduce that traffic, at the cost of stale credentials; it therefore needs a TTL and refresh behavior.

Raw prompts and provider payloads are not automatically suitable audit records. Retain the minimum evidence needed for investigation, protect access, and store hashes or references when the payload itself should not be retained. A hash is not anonymization if the input space is small enough to recover the original.

## Operating the Design

An on-call engineer should be able to answer which provider and model are failing, whether calls are waiting or executing, whether retries consume the budget, and which workflows are in fallback or pending states.

Useful aggregate metrics include gateway and AI latency, timeout and invalid-output rates, provider errors and rate limits, circuit state, consumer lag, queue age, outbox age, duplicate conflicts, database connection utilization, and dead-letter rate. Business metrics include fallback rate, manual-review rate, policy outcomes, and reviewed false-positive or false-negative samples by model and policy version.

Do not put `transaction_id`, `account_id`, `event_id`, or trace ID in Prometheus labels. Put correlation data in controlled structured logs and trace context. A trace should connect the request, payment, event, inference, model version, and policy version without exposing the prompt or credential. The audit record should distinguish the AI signal from the deterministic action that followed it.

Dead-letter records need an owner and replay procedure, not merely a topic name. Capacity reviews should include peak event rate, consumer concurrency, provider quotas, database unique-index contention, connection pools, secret-manager QPS, search indexing rate, token budgets, and the extra attempts caused by retries. Cost is part of reliability: an unbounded prompt or retry loop can exhaust a tenant budget before an infrastructure limit fires.

## What We Learned

The shared AI core is not valuable because it hides AI behind a larger abstraction. It is valuable because it makes failure behavior consistent and visible across FinPay's payment, KYC, review, and operations workflows.

The durable rule is:

```text
AI signal -> deterministic policy -> business decision
```

The ledger remains the financial truth. Kafka, when justified, provides replay for asynchronous work; the database records durable outcomes, inbox state, and outbox state; a search index is a rebuildable investigation view. Storage idempotency protects the event record, while effect idempotency protects systems called afterward.

AI may improve, explain, or prioritize a decision. It cannot become the authority that moves FinPay's money.
