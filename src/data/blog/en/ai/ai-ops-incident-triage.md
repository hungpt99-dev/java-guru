---
title: "AI Ops Incident Triage: From Alert Noise to Safe Hypotheses"
description: "How FinPay reasons about correlating Prometheus alerts and OpenTelemetry traces without allowing an LLM to become an operational or money-moving authority."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## The 03:00 question

At 03:00, a FinPay settlement batch is late. Prometheus shows higher API latency. KYC requests are timing out. Kafka consumer lag is rising, and several dead-letter queues are filling.

The on-call engineer has four dashboards and one urgent question: “What should I restart?” That question is dangerous. A restart can hide the symptom, increase duplicate work, or delay settlement. Changing KYC state, payment state, a balance, or the ledger is more dangerous still.

The useful first outcome is not a diagnosis. It is a bounded hypothesis with evidence and an explicit uncertainty level. FinPay’s existing invariants come first: the ledger is the financial source of truth, settlement follows a deterministic state machine, and AI never authorizes an irreversible action.

This article owns one engineering insight: **correlation assembles evidence; it does not prove causality. An AI recommendation is a typed proposal, not an execution command.**

## Start with the obvious design

The first design is easy to draw:

```text
Prometheus alert ──▶ Kafka ──▶ consumer ──▶ LLM ──▶ execute runbook action
```

The consumer sends alert text and a few trace fields to an LLM, stores the answer, acknowledges Kafka, and executes the recommended runbook. It is simple because ingestion, investigation, inference, and authority are all one request.

That simplicity does not survive traffic or failure. The following numbers are **illustrative assumptions**, not FinPay measurements. At 10,000 alert events per second and two seconds of model latency:

```text
in-flight calls = throughput × latency = 10,000 × 2 = 20,000
```

At ten seconds, the same path has 100,000 calls in flight. This is not a request to create 100,000 threads. It is a warning that provider quota, connection pools, memory, and the Kafka listener cannot be allowed to expand with provider latency.

Suppose provider latency rises from an assumed 300 ms to four seconds. Listener workers stay occupied, polls slow down, and Kafka lag looks like the primary incident. A three-attempt retry policy can send roughly three times the failed traffic into an already unhealthy provider. A client timeout also does not prove the provider did nothing: the request may complete after the client gives up. Retrying can produce duplicate and contradictory hypotheses.

An unbounded internal queue only moves the failure from Kafka lag to heap exhaustion. `exists()` followed by `insert()` is not an atomic claim either; two consumers can create two review tasks. A trace may arrive after the alert, be sampled, or fail to index. “No span found” is evidence of missing evidence, not evidence that no failure occurred.

Finally, the last arrow is unacceptable. An LLM must not restart a settlement consumer, change KYC state, authorize a payment, update a balance, mutate the ledger, or settle funds. Logs and runbooks are untrusted input and may contain prompt injection. A plausible paragraph remains a hypothesis.

## Constraints before components

For this reference design, we use these **assumptions and requirements**:

- Alert ingestion continues when the AI provider is slow or unavailable.
- Triage may be delayed, but the source alert remains durable and replayable.
- Missing or stale traces are recorded as uncertainty.
- Known patterns have a deterministic, inexpensive path.
- A recommendation affecting production controls requires explicit approval.
- Payment, KYC, settlement, and ledger state remain authoritative in deterministic stores.
- Every result is explainable from evidence, policy, and version metadata.
- Example rates and latencies are illustrative; real limits require load tests, provider contracts, and an agreed alert SLO.

These constraints already reject “the model decides.” We can now compare the boundaries rather than choosing infrastructure by habit.

## Choosing the boundary

Synchronous processing has one advantage: the caller receives an answer immediately. It also puts provider latency and availability inside the alert-ingestion timeout. It is reasonable for a low-volume operator query where losing the query is acceptable. It is a poor default for durable alert processing.

Direct HTTP with a database inbox is simpler than a broker at small volume. It makes the producer depend on the consumer’s availability and requires another replay mechanism. A durable work topic gives FinPay a clear handoff: accept the source event first, investigate later.

At-most-once processing avoids duplicate work but can lose an incident when a process crashes after acting and before acknowledging. At-least-once processing preserves replay and recovery, so FinPay accepts duplicate delivery and pays for atomic claims and idempotent side effects.

We therefore choose an asynchronous signal path with bounded workers. Rules run before the model. The model is used only when combining evidence is worth its cost. This adds queue lag and operational machinery, but it prevents a provider outage from becoming an alert-ingestion outage.

The authority boundary is separate:

```text
AI signal ──▶ deterministic policy ──▶ triage state / approval task ──▶ controlled action
```

The model returns a typed severity suggestion, hypothesis, confidence, evidence references, and recommendation kind. Policy validates the schema, evidence freshness, confidence threshold, allow-listed runbook, and whether money or KYC is affected. The result can be read-only guidance, an approval task, or explicit abstention. An approval task is not an action; an authorized operator or deterministic service must perform the next state transition.

## Evidence is assembled, not invented

Prometheus describes threshold violations. OpenTelemetry traces provide timing and request context, but may be sampled, late, or incomplete. Kafka is the durable source for alert and audit events, not an operator query API. OpenSearch is a searchable trace and incident read model, not the payment ledger.

The triage service builds a bounded `IncidentContext` from the alert, service and deployment metadata, and correlated spans within a time window. It records what was absent and when the evidence was observed. That is a small retrieval-and-reasoning flow, not permission to treat retrieved text as instructions.

```java
public record IncidentContext(
        String eventId, String service, Instant alertTime,
        List<TraceSpan> spans, List<String> missingEvidence,
        Instant evidenceAsOf) {}

public record TriageOutcome(
        String eventId, Severity severity, String hypothesis,
        double confidence, Recommendation recommendation,
        String source, String modelVersion, String promptVersion,
        boolean evidenceSufficient) {}

public record Recommendation(ActionKind kind, String reason,
        String runbookId, boolean touchesMoney, boolean changesKycState) {}
```

The AI core established earlier in the series owns redaction, strict schema validation, provider metadata, prompt versions, and evaluation hooks. This service supplies incident facts and policy; it does not create a second authority mechanism.

## Rules first, AI for ambiguity

A rule can classify a known condition such as a dead-letter queue over an approved threshold or a missing approval event. An anomaly score can flag unusual lag, but it cannot establish the cause. A classifier may fit repeated incident categories with labels. An LLM is useful for unstructured alert text, bounded runbook retrieval, and a readable hypothesis spanning services. It is also nondeterministic, rate-limited, costly, and exposed to malicious log text.

Rules-first therefore becomes the degraded mode as well as the fast path. When the provider is unavailable, known incidents still produce useful triage. Ambiguous high-risk cases become `AWAITING_REVIEW`, not automatic block or release. Policy rejects or downgrades outputs with stale evidence, missing fields, low approved confidence, a non-allow-listed runbook, or an unapproved money/KYC proposal. “Insufficient evidence” is a valid result.

## Async fixes coupling and introduces duplicates

The asynchronous decision creates a new problem: a crash or rebalance can redeliver the same alert, while a claimed task can be abandoned. The listener validates the event and atomically claims it. Bounded workers enrich evidence and call the provider. The offset is committed only after the outcome and audit intent are durable.

```java
public interface IdempotencyPort {
    boolean tryClaim(String eventId); // atomic claim with lease/recovery state
    void complete(String eventId, TriageOutcome outcome);
}

public boolean tryClaim(String eventId) {
    try {
        client.index(b -> b.index("finpay-incident-inbox")
                .id(eventId).opType(OpType.Create));
        return true;
    } catch (ResourceAlreadyExistsException duplicate) {
        return false;
    }
}
```

The same atomic uniqueness can use a database unique constraint and inbox table. Redis `SETNX` may fit a short-lived claim, but expiry alone is not recovery. A lease needs an owner, timeout, and safe retry state. Inbox idempotency also does not make paging, approval creation, or a controlled command idempotent; each side effect needs its own key.

Retry topics, jittered backoff, a circuit breaker, bounded queues, and a retry budget make pressure visible. They do not make an unavailable provider healthy. When a claim is stuck, recovery must be explicit rather than allowing two workers to act concurrently.

## Architecture after the reasoning

```text
Prometheus / OTel ─▶ Kafka source ─▶ validator + atomic inbox claim
                                      │
                         rules-first filter + bounded workers
                                      │
                   OpenSearch trace + runbook retrieval (RAG)
                                      │
                   AI core ──▶ LLM adapter (timeout/retry/breaker)
                                      ├──────────────▶ rules fallback
                                      ▼
                         AI signal + evidence + versions
                                      │
                              deterministic policy
                           ┌─────────┴─────────┐
                           ▼                   ▼
                    read-only incident     approval task
                    / operator guidance    (money/KYC guarded)
                                      │
                audit events ─▶ Kafka ─▶ OpenSearch read model
                                      │
                           authoritative action service
```

Each box answers a concrete failure. Kafka retains the source and supports replay. The inbox prevents duplicate claims. Bounded workers contain provider latency. OpenSearch makes evidence queryable without becoming the ledger. The adapter isolates provider timeout, retry, credentials, and circuit state. Policy prevents a model response from becoming a command. The approval task records a human-controlled transition rather than executing one.

## Operational reality

If target triage rate is `R`, p95 provider latency is `L`, and desired utilization is `U`, a first capacity estimate is:

```text
worker slots >= ceil(R × L / U)
```

For the **illustrative assumption** `R=200 events/s`, `L=2s`, and `U=0.7`, the estimate is `ceil(572)` slots before retries, enrichment, and provider quotas. That result might justify capacity, but it might instead justify more rules, a faster model, or lower admission. Bounded connection pools and queues are part of the design.

Track oldest event age, queue utilization, Kafka lag, provider latency and errors, OpenSearch latency, retry volume, claim age, and dead-letter rate. Define an alert SLO using actual requirements; do not treat the example numbers as FinPay commitments. Use bounded metric labels such as service, provider, model version, outcome, and environment. Do not use `payment_id`, `account_id`, `event_id`, or `trace_id` as Prometheus labels.

At 03:00, one traceable chain matters: request or payment reference, alert event, evidence freshness, AI inference ID, model and prompt versions, policy version, fallback reason, approval actor, and timestamps. Keep these in structured logs, traces, and audit records.

Redact before prompt construction. Do not send card data, credentials, KYC documents, or raw customer payloads without an explicit data-processing decision. Enforce tenant authorization, protect provider credentials with secret management, audit prompt access, and apply retention limits. Treat logs and retrieved runbooks as untrusted input because prompt injection can tell a model to ignore policy.

If the provider fails, the circuit opens and rules handle known incidents. If OpenSearch fails, Kafka retains the source and the missing freshness is visible. If approval fails, the result stays pending. If schema validation rejects a poison message, a dead-letter topic records the bounded reason for later replay. None of these paths mutate the ledger.

## Evaluation and learning

Lower temperature and JSON Schema can reduce output variation; neither proves correctness. Evaluate historical and synthetic incidents for false positives, false negatives, calibration, abstention, unsupported claims, and prompt-injection resistance. Version the model, prompt, retrieval corpus, policy, and AI core independently. A replay with a new model creates a new evaluation run and never overwrites the original audit decision.

The first release should be read-only and rules-first. Add model assistance after measuring the incident taxonomy and operator review burden. If approval state outgrows a search index, move claims and approvals to a transactional database without changing the signal contract.

The lesson is not “use an LLM for operations.” Place unreliable inference where it can add evidence without gaining authority:

```text
AI proposes → policy constrains → authorized deterministic path acts
```

That boundary lets FinPay investigate a 03:00 incident without turning a plausible sentence into an operational or financial side effect.

## References

- Apache Kafka documentation on delivery semantics: https://kafka.apache.org/documentation/#semantics
- OpenTelemetry documentation on traces: https://opentelemetry.io/docs/concepts/signals/traces/
- Prometheus guidance on metric label cardinality: https://prometheus.io/docs/practices/naming/
- OWASP Top 10 for Large Language Model Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/

> Repo: https://github.com/finpay-lab/observability

<!-- finpay-repo-link -->

## FinPay Reference Implementation

This article is part of the FinPay reference series. The related service implementation lives in the [finpay-lab/observability](https://github.com/finpay-lab/observability) repository.
