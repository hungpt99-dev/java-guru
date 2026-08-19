---
title: "Designing a Shared AI Core for FinPay Microservices: From Failure Modes to Guardrails"
description: "A practical design for shared LLM integration with BYOK credentials, resilience controls, idempotency, and auditable outcomes."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

FinPay already has the part that must not be experimental: the ledger is the system of record, settlement is deterministic, and every money movement is auditable. The question in this article is narrower: how can several FinPay services use AI without allowing an unreliable external dependency to weaken those invariants?

The answer is not a larger AI service. It is a shared technical contract. The core standardizes how a service obtains credentials, bounds an inference call, validates its output, records evidence, and handles duplicates. It does not decide whether a payment is approved. That remains the responsibility of deterministic policy and the payment state machine.

## The First Failure Was Inconsistency

Imagine FinPay adding AI-assisted risk analysis to payment review, KYC enrichment, and support triage. The first implementation is usually local: each team calls a provider from its own service. One key sits in `application.yml`, another comes from an environment variable, and a third is copied into a test configuration. One client retries 5xx responses; another has no deadline. One parser accepts free-form text such as `approve`; another expects JSON. A successful request is recorded as `logger.info("done")`.

That is not three independent implementation choices. It is three versions of a security and failure policy. A provider slowdown can consume request threads in one service while another fails fast. A model response that is harmless in support triage can become dangerous when a payment service interprets the same label as authorization.

This is a reference-design scenario, not a claim about a deployed FinPay incident. The useful design question is: what would force us to centralize the technical behavior, and what must remain local?

## Why the Obvious Design Fails

A naive payment-risk endpoint looks attractive:

```java
// WRONG: secret, unbounded call, and business authority in one request
String answer = llm.chat(apiKey, request.toJson());
return answer.contains("approve") ? APPROVE : REJECT;
```

It has a short path from request to result. It also hides four decisions. There is no timeout budget, no defined behavior for a provider outage, no schema validation, and no separation between an AI observation and a financial decision. A spelling change or additional sentence in the response can change the branch.

The next attempt often protects persistence with a pre-check:

```java
// WRONG: two consumers can both observe false
if (!outcomeRepository.exists(eventId)) {
    outcomeRepository.save(new Outcome(eventId, signal));
}
```

Under redelivery or two competing consumers, both reads can return false. A uniqueness check in application code is not an atomic claim. Even an atomic insert solves only durable storage. If the same outcome sends an email, creates a review case, or calls another service, that side effect needs its own idempotency key.

Synchronous inference creates a second boundary problem. Suppose 200 requests per second each wait 750 ms for the complete path. The AI stage alone creates approximately:

```text
concurrency = throughput x latency
            = 200 x 0.75
            = 150 in-flight requests
```

That is an illustrative capacity calculation, not a FinPay measurement. Add provider retries, a connection pool, database writes, and a gateway timeout, and a temporary provider slowdown can occupy resources far beyond the AI client itself. If latency rises from 300 ms to 4 seconds, the same arrival rate creates roughly 800 in-flight calls. If clients retry while the first calls are still waiting, the provider sees more load precisely when it is least able to handle it.

At that point, “just add a retry” is not resilience. It is an amplifier. A shared core must make the deadline, retry budget, concurrency limit, and fallback explicit.

## Constraints Before Components

For this reference design, we use these assumptions:

- FinPay’s ledger and payment state machine already own balances, authorization, settlement, and irreversible transitions.
- AI may produce a bounded risk signal, classification, explanation, or enrichment. It may not mutate a balance, ledger entry, settlement state, payment authorization, or financial transaction state.
- Different tenants may bring their own provider credentials (BYOK). A credential must be resolved from a secret manager, not source code, prompts, or logs.
- Inference can be slow, unavailable, rate-limited, nondeterministic, or more expensive than expected.
- Payment paths need an explicit degraded mode. “AI failed” cannot silently mean “approve” or “reject” for every operation.
- Investigators need to reconstruct what happened, while raw sensitive payloads should be minimized and access-controlled.

These are design constraints and examples, not production measurements. They lead to a small set of boundaries: a typed AI port, a durable outcome record, an asynchronous option for work that does not belong on the payment critical path, and a versioned audit trail.

## The Contract: Signal, Policy, Decision

The core returns an `AISignal`, not an approval:

```text
AI inference -> AI signal -> deterministic policy -> business decision -> financial state transition
```

An AI signal might contain a bounded score, a label from an allowed enum, confidence, reason codes, model version, prompt version, and an explicit status such as `VALID`, `TIMEOUT`, or `INVALID_OUTPUT`. The policy service decides what that signal means for a particular payment, tenant, and risk tier. The payment state machine then performs the authorized transition and writes the ledger through its normal deterministic path.

This split matters when the model changes. A new model may produce a different score for the same input; a policy version can still make the rule used for the decision explicit. It also matters when AI is unavailable. A low-risk enrichment may be queued for later. A high-risk payment might enter step-up verification or manual review. Some low-value flows may continue under deterministic rules. The correct choice depends on the operation’s loss, regulatory requirements, and customer experience. The core must report the failure; the owning policy must choose the business response.

## What the Shared Core Owns

The module exposes a narrow typed port such as `assess(SignalRequest) -> AISignal`. A caller supplies an already-minimized request and a correlation context. The core resolves the tenant’s secret reference, constructs a provider-neutral request, applies a deadline and bounded retry policy, validates structured output, and records technical evidence.

It owns:

- BYOK credential resolution and redaction.
- Provider adapters, request timeouts, retry classification, backoff with jitter, circuit state, and concurrency limits.
- Structured-output validation and explicit invalid or unavailable statuses.
- Idempotent storage of the signal and an outbox record for durable downstream effects.
- Audit fields such as `transaction_id`, `event_id`, `model_version`, `prompt_version`, `policy_version`, `decision`, `reason`, timestamps, and correlation ID.
- Metrics and traces that describe behavior without putting payment or account identifiers into metric labels.

It does not own payment thresholds, fraud policy, account balances, settlement, or the authority to translate `approve` in an LLM response into a payment command. A library can standardize behavior; it cannot make business policy generic without making it less visible and harder to audit.

## Idempotency Has Two Boundaries

The first boundary is storage. A durable database unique constraint on `(tenant_id, event_id)` lets the database arbitrate concurrent delivery:

```java
try {
    outcomeRepository.insertUnique(tenantId, eventId, signal);
    outboxRepository.insert(tenantId, eventId, "RISK_SIGNAL_RECORDED");
} catch (DuplicateKeyException alreadyProcessed) {
    return outcomeRepository.get(tenantId, eventId);
}
```

The outcome and outbox row should be committed together. If the consumer crashes after the commit but before acknowledging the message, redelivery finds the existing outcome. The database is the system of record; a cache or search index cannot replace this arbitration.

The second boundary is the side effect. An outbox worker may deliver the same notification or case request more than once. Each effect needs a stable key such as `(tenant_id, event_id, effect_type)`, and the receiver must either enforce it or the worker must maintain a durable effect state. Storage idempotency does not make an HTTP call, email, or case creation idempotent.

This is also why the provider call itself is not assumed to be exactly once. If a timeout occurs after the provider accepted the request, a retry can repeat inference. The final stored signal remains authoritative for this event, and a provider request idempotency key can be used where the provider explicitly supports one. The core must not claim an exactly-once guarantee it cannot provide.

## Choosing the Execution Boundary

Synchronous scoring keeps the user flow simple and gives an immediate result. It is appropriate when the decision truly needs the signal and the latency budget can accommodate the provider. Its cost is coupled availability: a provider outage becomes a payment-path dependency unless the policy defines a fallback.

Asynchronous scoring isolates the payment request from model latency. A payment can enter `PENDING_RISK`, an event can be replayed, and a consumer can process at controlled concurrency. The cost is eventual consistency and a more complicated state machine. Timeouts now become queue age, and the product must define what happens if a payment remains pending.

For the shared foundation, we do not force one mode on every caller. The core provides the same signal contract for both. Payment-critical callers use a tightly bounded synchronous call only where justified; enrichment, review, and later analysis use the asynchronous path. This preserves the hard payment invariants without pretending all AI work has the same latency requirement.

The asynchronous decision introduces duplicate delivery, ordering, and backpressure problems. The inbox or unique outcome key handles duplicates. Partitioning and a payment sequence can preserve the ordering a particular workflow needs; global ordering would be more expensive and is not required. Consumer concurrency is limited before provider calls, so a growing queue does not become an unbounded provider burst.

## Resilience Is a Budget, Not a Boolean

Each request gets a total deadline. Individual provider attempts, retries, and downstream persistence must fit inside it. Retry only selected transient failures such as a provider rate limit or temporary server error. Do not retry an invalid schema, a rejected payload, or a policy decision. Exponential backoff with jitter prevents a fleet from retrying in lockstep, and a retry budget prevents recovery traffic from becoming a second outage.

At 14:03 in an illustrative scenario, provider latency rises from 300 ms to 4 seconds. The gateway should stop accepting unlimited synchronous work, the AI client should time out within its allocated budget, and the circuit should open after the configured failure threshold. Consumers should respect a concurrency limit rather than create thousands of waiting calls. The service records `AI_TIMEOUT`, routes according to the owning policy, and leaves enough capacity for recovery. A circuit breaker without admission control only changes when the queue fills.

Fallback is a business decision with technical support from the core. The core can return an unavailable signal and its evidence. Policy may choose deterministic checks, step-up verification, manual review, or a delayed decision. It must label the path as fallback; it must not fabricate confidence or silently convert an outage into approval.

## The Architecture That Emerges

Once these problems are explicit, the components have clear reasons to exist:

```text
payment / review service
        |
        | typed SignalRequest
        v
  shared AI core
  - secret resolution
  - provider adapter
  - timeout / retry / circuit / limit
  - schema validation
        |
        v
  AISignal + durable audit outcome
        |
        +--> deterministic policy --> business state machine --> ledger / settlement
        |
        +--> outbox --> notifications / cases / other effects

Kafka = replay source for asynchronous work
DB = system of record for outcomes, inbox, and outbox
OpenSearch = rebuildable read model for investigation and dashboards
Vault = secret source; keys never enter prompts or logs
```

Kafka is useful here only when replayable asynchronous work and controlled consumer processing justify it. It is not the ledger. The database owns durable outcome and idempotency state. OpenSearch can make investigations fast, but if it is unavailable the durable path continues and indexing catches up later. These boundaries prevent a convenient operational component from becoming an accidental financial authority.

## AI Safety and Evidence

The provider response must match a versioned schema. Missing fields, an unknown label, contradictory values, malformed JSON, or a confidence outside the accepted range become `INVALID_OUTPUT`. The system never guesses from free-form text. Store model and prompt versions with the signal; a prompt change is a change to the decision input.

Prompt construction also needs an input boundary. Payment descriptions and support notes can contain instructions aimed at the model. Treat them as untrusted data, delimit them, send only an allowlisted subset, and validate the result as data. Minimize names, account numbers, addresses, and regulated identifiers through derived features, redaction, or tokenization. BYOK improves tenant isolation and cost attribution, but adds secret-manager traffic and rotation races. A short, explicit cache can reduce that traffic; it introduces stale credentials and must have a TTL and clear refresh behavior.

Prompt text and raw provider payloads are not automatically appropriate audit data. Retain the minimum needed for investigation, protect access to sensitive evidence, and record hashes or references when the payload itself should not be stored. A hash is not anonymization if a small input space makes the original easy to recover.

## Operating the Failure Modes

An on-call engineer should be able to answer: which provider and model are failing, whether calls are waiting or actively executing, whether retries are consuming the budget, and which payment workflows are in fallback or pending states. Useful aggregate metrics include gateway latency, AI latency, timeout and invalid-output rates, provider error and rate-limit rates, circuit state, consumer lag, outbox age, duplicate conflicts, database connection utilization, and dead-letter rate. Business metrics include fallback rate, manual-review rate, policy outcomes, and reviewed false-positive or false-negative samples by model and policy version.

Do not put `transaction_id`, `account_id`, `event_id`, or trace ID in Prometheus labels. Put correlation data in controlled structured logs and trace context instead. A trace should connect the request, payment, event, AI inference, model version, and policy version without exposing the prompt or credential. The audit record should preserve the decision, reason, timestamps, and versions so an investigator can distinguish an AI signal from the deterministic action that followed it.

Dead-letter records need an owner and replay procedure, not just a topic name. Replay must preserve the original event identity and use the same idempotency rules. Capacity reviews should include peak event rate, consumer concurrency, provider quotas, database unique-index contention, connection pools, secret-manager QPS, search indexing rate, token budgets, and the extra attempts created by retries. Cost is part of reliability: an unbounded prompt or retry loop can exhaust a tenant’s budget before any infrastructure limit fires.

## What This Foundation Establishes

The shared AI core is valuable because it makes fallibility visible and repeatable. It standardizes secrets, deadlines, retries, validation, idempotency, and evidence across the evolving FinPay system. It does not hide the decisions that belong to payment, KYC, review, or operations teams.

The contract for the later articles is therefore simple:

```text
AI signal -> deterministic policy -> business decision
```

The ledger remains the financial truth. Kafka, when needed, provides replay; the database records durable outcomes; OpenSearch serves a rebuildable view. Idempotent storage protects the event record, while idempotent side effects protect the systems reached afterward. AI can improve a decision, explain it, or prioritize it. It cannot become the authority that moves FinPay’s money.
