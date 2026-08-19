---
title: "AI Ops Incident Triage: From Alert Noise to Safe Hypotheses"
description: "How FinPay reasons about correlating Prometheus alerts and OpenTelemetry traces without allowing an LLM to become an operational or money-moving authority."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## The incident that is not yet a diagnosis

Suppose a settlement batch is late at 03:00. Prometheus reports higher API latency, KYC timeouts appear, Kafka consumer lag rises, and several dead-letter queues begin filling. The on-call engineer has four dashboards and no reliable causal story. Some alerts may be symptoms of one dependency failure; others may be unrelated.

The first request is usually, “What should I restart?” That is the wrong starting point for a financial system. A bad operational action can delay settlement further, bypass a KYC control, or duplicate a payment-side effect. FinPay needs a useful hypothesis quickly, but it must preserve the same invariant used everywhere else in the series: the ledger is the source of truth, settlement is deterministic, and an AI result is never permission to mutate financial state.

This article is the capstone of that reliability story. It reuses FinPay’s AI core ports, audit fields, idempotency split, and `Kafka = replay / database = record / OpenSearch = read model` boundary. The new problem is how to assemble evidence from alerts and traces without confusing correlation with cause. The central insight is simple: **correlation assembles evidence; it does not establish causal truth. A recommendation is a typed proposal, not an execution command.**

## Why the obvious design fails

The first design is tempting:

```text
Prometheus alert ──▶ Kafka ──▶ consumer ──▶ LLM ──▶ execute runbook action
```

The consumer sends alert text, a few trace fields, and “What should we do?” to the model. It stores the answer and acknowledges Kafka. This can look fine in a small test. It couples four different failure domains on one path, though: alert ingestion, evidence search, provider inference, and operational authority.

The numbers below are design assumptions for capacity reasoning, not FinPay measurements. If 10,000 alert events per second each hold an LLM call for two seconds, the stage creates:

```text
concurrency = throughput × latency = 10,000 × 2 = 20,000 in-flight calls
```

At ten seconds, it creates 100,000. That does not mean we should create that many threads. It means provider quotas, connection pools, memory, and the Kafka consumer path cannot be allowed to grow with provider latency. A synchronous listener also makes a provider outage look like a partition outage.

At 14:03, imagine provider latency rising from 300 ms to 4 seconds. Listener workers remain occupied, polls slow down, and consumer lag grows. A three-attempt retry policy sends roughly three times the failed traffic while the provider is already unhealthy. Client timeouts do not prove the provider did nothing; a request may have completed after the client gave up. Retrying can therefore create duplicate model calls and conflicting recommendations. An unbounded queue only moves the failure from Kafka lag to heap exhaustion.

There are data problems too. A trace may arrive after its alert, be sampled out, or fail to index while Kafka remains healthy. “No span found” is not “no failure.” Kafka redelivery and consumer rebalancing are normal at-least-once concerns. `exists()` followed by `insert()` is not a lock: two consumers can both observe absence and create two review tasks.

Most dangerous is the final arrow. An LLM must not restart a settlement consumer, change KYC state, authorize a payment, update an account balance, mutate the ledger, or settle funds. Logs and runbooks are untrusted input and can contain prompt injection. A plausible explanation is still only a hypothesis.

## Constraints before components

For this reference design, we assume:

- Alert ingestion should continue when the AI provider is slow or unavailable.
- Triage may be delayed, but the source alert must be retained and replayable.
- Missing or stale traces must be visible as uncertainty, not silently treated as evidence.
- Known failure patterns should have a deterministic, inexpensive path.
- Recommendations that affect production controls require an explicit approval workflow.
- Payment, ledger, settlement, and KYC state remain authoritative in their own deterministic stores.
- Every decision must be explainable from evidence, policy, and version metadata.
- Example rates and latency values are illustrative; real limits come from load tests, provider contracts, and the alert SLO.

These constraints rule out “the model decides” before we choose a database or a queue.

## The boundary that makes the system safe

The design separates a **signal path** from an **authority path**:

```text
AI signal ──▶ deterministic policy ──▶ triage state / approval task ──▶ controlled action
```

The AI produces a typed signal: severity suggestion, hypothesis, confidence, evidence references, and a recommendation kind. Policy checks schema, evidence freshness, confidence thresholds, approved runbooks, and whether the proposal touches money or KYC. The result may be read-only guidance, a task awaiting a human approval, or an explicit abstention.

This is the same `AI signal → policy → business decision` contract used by FinPay’s other AI surfaces. The authority path is separate because an approval task is not an action. A controlled operator or deterministic service must authorize the next state transition, and the ledger or KYC system must apply it according to its own invariants. If AI is unavailable, rules can classify known incidents; for an ambiguous high-risk case, the correct degraded mode is “awaiting review,” not an automatic block or automatic release.

## Evidence assembly without causal overclaiming

Prometheus alerts describe threshold violations. OpenTelemetry traces provide request context and timing, but can be sampled, late, or incomplete. Kafka is the durable source for alert and audit events; it is not an operator query API. OpenSearch is a searchable trace and incident read model; it is not the payment ledger.

The service builds a bounded `IncidentContext` from an alert, service and deployment metadata, and trace spans correlated by identifiers and a time window. This resembles a small RAG flow: retrieve relevant evidence, record what was missing, then ask the model to reason over that bounded set. Retrieved runbook text is reference material, never an instruction with authority.

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

The AI core library already established in the series owns redaction, strict schema validation, provider metadata, prompt versions, and evaluation hooks. This service supplies incident facts and policy; it does not invent a second safety wrapper.

## Rules first, AI when ambiguity is worth the cost

Rules are the right tool for a known condition such as a dead-letter queue above a threshold or a missing approval event. Statistical detection can identify an unusual latency or lag change, but an anomaly score is not a cause. A classifier can work for repeated, labelled incident categories. An LLM is useful for unstructured alert text, bounded runbook retrieval, and a readable hypothesis across services. It is also nondeterministic, rate-limited, costly, and vulnerable to malicious text in logs.

FinPay therefore chooses rules-first, AI-assisted escalation. The rule path keeps known incidents moving during a provider outage. The model sees only cases where combining evidence has real value. This costs engineering effort in thresholds and incident taxonomy, but it reduces provider dependency, review noise, and retry amplification.

Policy rejects or downgrades a result when evidence is stale, confidence is below the approved threshold, required fields are absent, the runbook is not allow-listed, or the proposal touches money or KYC without approval. The model can say “insufficient evidence”; that is a valid outcome.

## Async processing creates a new problem

Moving provider calls off the Kafka listener fixes latency coupling, but creates duplicate delivery and abandoned work. The listener validates the event and atomically claims it; bounded workers enrich evidence and call the provider. The offset is committed only after durable outcome and audit intent. A retry topic, backoff with jitter, a circuit breaker, and a retry budget make pressure visible instead of infinite.

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

The same atomic uniqueness can be implemented with a database unique constraint and inbox table. Redis `SETNX` can be suitable for a short-lived claim, but an expiry is not a complete recovery protocol. A claim lease needs an owner, timeout, and safe retry state. Storage idempotency also does not make side effects idempotent: approval creation, paging, and any controlled command need their own idempotency key.

The default design is a Kafka work topic with bounded workers plus the rules-first filter. At-most-once processing would avoid duplicates but can lose an incident when a process crashes. At-least-once keeps replay and recovery, so FinPay accepts duplicate delivery and pays the idempotency cost. Direct HTTP would be simpler at low volume, but it provides a weaker replay boundary and makes producer availability part of the caller’s timeout budget.

## The resulting architecture

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

Each box exists for a failure or authority boundary. Kafka provides retained input and replay. OpenSearch makes evidence queryable without pretending to be the ledger. Bounded workers contain provider latency. The AI adapter isolates provider-specific timeouts and credentials. Policy prevents a model response from becoming a command. The approval task records a human-controlled transition rather than executing one.

## Capacity and operational reality

If the target triage rate is `R`, p95 provider latency is `L`, and desired utilization is `U`, a first estimate is:

```text
worker slots >= ceil(R × L / U)
```

For illustrative `R=200 events/s`, `L=2s`, and `U=0.7`, this is `ceil(572)` concurrent slots before retries, enrichment, and provider quotas. The result may justify more workers, but it may instead justify more rules, a faster model, or lower admission. Bounded connection pools and queues are part of the design. Track oldest event age, queue utilization, Kafka lag, provider latency and errors, OpenSearch latency, retry volume, and dead-letter rate. Per-tenant quotas prevent one BYOK tenant from consuming shared capacity.

At 03:00, an on-call engineer needs one traceable chain: request or payment reference, alert event, evidence freshness, AI inference ID, model and prompt versions, policy version, fallback reason, approval actor, and timestamps. Put these in structured logs, traces, and audit records, not high-cardinality Prometheus labels. Use bounded labels such as service, provider, model version, outcome, and environment. Never use `payment_id`, `account_id`, `event_id`, or `trace_id` as metric labels.

Security follows the same boundary. Redact before prompt construction. Send neither card data, credentials, KYC documents, nor raw customer payloads unless an explicit data-processing decision permits it. Use structured allow-lists rather than relying on regex alone; protect provider credentials with secret management; enforce tenant authorization; audit prompt access; and apply retention limits. Treat logs and retrieved runbooks as untrusted input because prompt injection can instruct the model to ignore policy.

When the provider fails, the circuit opens and known incidents use rules. Ambiguous incidents remain visible with `source=rules` or `status=AWAITING_REVIEW`; they do not silently disappear. When OpenSearch fails, Kafka retains the source and enrichment freshness is exposed. When an approval service fails, the triage result remains pending. When a poison message cannot pass schema validation, a dead-letter topic records the bounded reason and supports later replay.

## Evaluation, rollback, and learning

Lower temperature and JSON Schema can reduce output variation; neither establishes correctness. Evaluate historical and synthetic incidents for false positives, false negatives, calibration, abstention, unsupported claims, and prompt-injection resistance. Version the model, prompt, retrieval corpus, policy, and AI core independently. A replay with a new model must create a new evaluation run and must not overwrite the original audit decision.

The first release should be read-only and rules-first. Add model assistance after measuring the incident taxonomy and operator review burden. If approval state outgrows a search index, move claims and approvals to a transactional database without changing the signal contract. The architecture is allowed to evolve; the authority boundary is not.

The lesson is not “use an LLM for operations.” It is to place an unreliable inference system where it can add evidence without gaining authority. **AI proposes. Policy constrains. An authorized deterministic path acts.** That is how an evolving FinPay system can use AI at 03:00 without letting a plausible sentence become a financial or operational side effect.

## References

- Apache Kafka documentation on delivery semantics: https://kafka.apache.org/documentation/#semantics
- OpenTelemetry documentation on traces: https://opentelemetry.io/docs/concepts/signals/traces/
- Prometheus guidance on metric label cardinality: https://prometheus.io/docs/practices/naming/
- OWASP Top 10 for Large Language Model Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/

> Repo: https://github.com/finpay-lab/observability
