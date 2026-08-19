---
title: "AI Ops Incident Triage: From Alert Noise to Safe Hypotheses"
description: "How FinPay reasons about correlating Prometheus alerts and OpenTelemetry traces without allowing an LLM to become an operational or money-moving authority."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> Repo: https://github.com/finpay-lab/observability

## The Problem

At 03:00, a settlement batch is delayed. Prometheus reports higher latency, a KYC service reports timeouts, Kafka consumer lag grows, and several dead-letter queues begin filling. Some alerts are symptoms of one dependency failure; others are independent. The on-call engineer needs to know what to investigate first and whether a proposed action could affect a payment, a settlement, or a customer review.

The engineering question is not “Can an LLM summarize these alerts?” It is: **Can a system produce a useful incident hypothesis quickly while remaining safe when its inputs are incomplete, its provider is unavailable, and its recommendation is wrong?**

`ai-ops-incident-triage` is a fictional, production-oriented FinPay reference service. It uses an LLM for reading, correlation, and first-pass classification. It does not authorize operational actions that move money, change KYC status, or bypass a control. A model produces a signal; deterministic policy converts the signal into an allowed business action.

The same boundary applies to a runbook recommendation. “Restart the settlement consumer” is not an execution command. It is a typed proposal that may require approval, a maintenance window, or a narrower deterministic procedure.

## Why This Is Harder Than It Looks

The inputs have different meanings and lifetimes:

- Prometheus is excellent at time-series alerting, but an alert is a symptom, not necessarily a causal event.
- OpenTelemetry traces provide request context and timing, but traces can be sampled, late, incomplete, or absent during an outage.
- Kafka is the durable event and replay source. It is not the query API for an operator dashboard.
- OpenSearch is useful as a trace and read/index model. It is not the authoritative payment ledger.
- The LLM can correlate language and evidence, but it is nondeterministic and can hallucinate a cause or a runbook step.

The dangerous error is not only a false positive. A false negative can hide a real incident. A plausible but unsupported explanation can focus the on-call engineer on the wrong service. A harmless-looking retry can multiply provider calls, AI cost, and Kafka lag. A model upgrade can change the decision distribution without changing application code.

The goal is therefore bounded assistance, not automated control-plane authority.

## The Naive Design

The first design is attractive because it has very few moving parts:

```text
Prometheus alert ──▶ Kafka ──▶ Consumer ──▶ LLM ──▶ create incident / runbook action
```

The consumer sends the alert, perhaps some trace text, and the question “What should we do?” It stores the answer and acknowledges Kafka. At low traffic, this appears to work.

## Where the Naive Design Breaks

At 10,000 alert events per second, an LLM call taking two seconds requires approximately:

```text
concurrency = throughput × latency = 10,000 × 2 = 20,000 in-flight calls
```

At ten seconds, it requires 100,000. That is not a reason to allocate 100,000 threads. It is evidence that synchronous provider calls cannot sit directly on the Kafka consumer path. Provider quotas, connection pools, memory, and downstream rate limits become the actual capacity boundary.

The failure cases are more important than the happy path:

1. **Provider latency or outage.** A blocking call holds a consumer. Polls slow down, partitions lag, and the alert backlog grows while the dependency is already failing.
2. **Retry storm.** Three attempts per event turns a provider outage into three times the traffic. Multiple consumer instances can amplify the same storm.
3. **Timeout ambiguity.** The client times out, but the provider may have completed the request. Retrying can create duplicate model calls and conflicting audit records.
4. **Duplicate or replayed event.** Kafka redelivery, rebalance, offset reset, or a replay runs triage twice and can page twice. `exists()` followed by `insert()` is not a lock: two consumers can both observe “absent.”
5. **Consumer crash.** If the process dies after a runbook task is created but before the offset is committed, redelivery can create the task again.
6. **Out-of-order data.** A trace may arrive after the alert. An enrichment query can return no spans and falsely suggest that nothing failed.
7. **Poison message.** Malformed model output or an oversized payload can repeatedly fail one record and stall a partition.
8. **Backpressure and queue saturation.** A bounded worker pool is necessary, but when full the system must pause intake, defer work, or use a rules-only path. Unbounded queues only move the outage into heap memory.
9. **Model regression.** A new prompt, model, or retrieval corpus can increase high-severity recommendations or reduce detection of KYC and settlement incidents.
10. **Partial failure.** OpenSearch may be unavailable while Kafka remains healthy; the audit sink may be down after triage succeeds; the provider may succeed while the approval service fails.

Most importantly, who has authority? The model must not be able to turn “refund” or “disable KYC review” into a side effect. The authority belongs to deterministic policy, an approval workflow, and the system of record that applies the action.

## The First Design Decision

Separate a **signal path** from an **authority path**:

```text
AI signal ──▶ policy validation ──▶ triage state / approval task ──▶ controlled operator or ledger action
```

AI output is evidence with confidence and provenance. Policy decides whether it is display-only, eligible for a human approval task, or rejected. The ledger and KYC systems remain authoritative for their own records.

This also separates the event source from query storage:

- Kafka retains alert, trace-reference, triage, and audit events for at-least-once processing and replay.
- A database or ledger remains the system of record for payment and approval state.
- OpenSearch stores searchable traces, incident documents, and read models.

If an OpenSearch index is lost, it should be possible to replay Kafka and rebuild it. If an index write fails, the source event must not be silently discarded.

## The Hard Engineering Problems

### 1. Correlation is evidence assembly, not causal truth

The service builds `IncidentContext` from a Prometheus alert, service metadata, deployment information, and correlated OpenTelemetry spans. Trace enrichment is effectively a small RAG step: retrieve relevant, bounded evidence, then ask the model to reason over that evidence. Runbook retrieval is another RAG step, but retrieved text is reference material, not an instruction with authority.

```java
@Component
public class OpenSearchTraceEnricher {
    private final OpenSearchClient client;

    public List<TraceSpan> correlatedSpans(String traceId) {
        return client.search(b -> b
                .index("finpay-traces-*")
                .query(q -> q.term(t -> t.field("trace.id").value(traceId)))
                .size(200), TraceSpan.class)
            .hits().hits().stream().map(h -> h.source()).toList();
    }
}
```

The context must record missing evidence. “No trace found” is not “no failure.” A KYC timeout, for example, may have a trace sampled out or a span delayed in OpenSearch. The model should receive an explicit uncertainty field and a freshness timestamp.

The shared **AI core library** should own prompt templates, schema validation, redaction, provider metadata, model/prompt version fields, and evaluation hooks. Feature services should supply domain facts and policy, not each invent a different safety wrapper.

### 2. AI is a signal, and signals need policy

Incident triage has several techniques with different failure profiles:

- **Rules** are best for known conditions: a dead-letter queue above a threshold, a missing approval event, or a provider error code. They are deterministic, cheap, and easy to audit, but brittle for novel combinations.
- **Statistical methods** are useful for seasonality and sudden changes in latency or lag. They provide anomaly scores, but correlation is not causation.
- **ML classifiers** fit repeated incident categories when labelled history exists. They can learn useful patterns but require drift monitoring, calibration, and versioned evaluation data.
- **LLMs** fit unstructured alert text, runbook retrieval, and a readable hypothesis across services. They are expensive, rate-limited, nondeterministic, and vulnerable to prompt injection in log content.

The output contract is therefore explicit:

```java
public record TriageOutcome(
        String eventId,
        Severity severity,
        String hypothesis,
        double confidence,
        Recommendation recommendation,
        String source,          // llm | rules
        String modelVersion,
        String promptVersion,
        boolean evidenceSufficient) {}

public record Recommendation(ActionKind kind, String reason,
        String runbookId, boolean touchesMoney, boolean changesKycState) {}
```

The policy layer can reject a recommendation when confidence is below a threshold, evidence is stale, the action touches money or KYC, the runbook is not allow-listed, or the model version is not approved. That is the required sequence: **AI signal -> policy -> business decision**.

### 3. Delivery semantics and idempotency

Kafka consumers generally need at-least-once processing. “Exactly once” at the broker does not make external calls exactly once. The naive check is wrong:

```java
// WRONG: both consumers can read false before either insert commits.
if (!store.exists(event.eventId())) {
    store.insert(event.eventId());
    createApprovalTask(event); // duplicate side effect
}
```

Use an atomic uniqueness operation instead:

```java
public interface IdempotencyPort {
    boolean tryClaim(String eventId); // atomic, with lease/recovery state
    void complete(String eventId, TriageOutcome outcome);
}

public boolean tryClaim(String eventId) {
    try {
        client.index(b -> b.index("finpay-incident-triage")
                .id(eventId).opType(OpType.Create));
        return true;
    } catch (ResourceAlreadyExistsException duplicate) {
        return false;
    }
}
```

Equivalent mechanisms include a database unique constraint with atomic insert, Redis `SETNX` with an expiry, an inbox table, or a transactional outbox/inbox arrangement. A deterministic incident ID should be derived from the source identity, not generated on every retry.

There are two different idempotency problems:

- **Idempotent storage:** the same `eventId` does not create multiple triage records.
- **Idempotent side effects:** the same approval task, page, notification, or restart request is not executed twice.

The first does not automatically solve the second. Approval creation needs its own idempotency key, and an external action needs an API idempotency key or a durable command state machine. A claim also needs a lease or recovery policy: an in-flight record left forever after a consumer crash is a hidden data-loss mode.

## Design Options and Trade-offs

**Option A: synchronous LLM in the Kafka listener.** It is simple and gives an immediate answer, but latency and provider availability control partition progress. It is unsuitable for bursty traffic.

**Option B: Kafka work topic plus bounded workers.** The listener validates and claims the event; workers enrich and call the provider. Partitioned backpressure, concurrency limits, and a retry topic make load visible. This is the default production-oriented choice.

**Option C: rules-first, AI-assisted escalation.** Rules handle known incidents immediately; only ambiguous cases use the LLM. This lowers cost and outage impact, but rules and thresholds need maintenance and can miss novel incidents.

FinPay combines B and C. Kafka is the replay source, a deterministic rules engine is the fallback and first filter, and the LLM is isolated behind an `IncidentTriagePort`. OpenSearch is the trace/read model and an atomic claim store in this reference design; a transactional database may be preferable when claim leases and approval state need stronger transactional semantics.

## The Architecture

```text
Prometheus / OTel ─▶ Kafka source ─▶ validator + atomic inbox claim
                                      │
                         bounded triage workers / backpressure
                                      │
                   OpenSearch trace + runbook retrieval (RAG)
                                      │
                   AI core library ──▶ BYOK LLM adapter
                                      │ timeout/retry/breaker
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
                audit events ─▶ Kafka ─▶ OpenSearch read model + archive
```

The domain core depends on ports, not Kafka, Spring AI, or OpenSearch:

```text
com.finpay.observability
├── domain
│   ├── model  IncidentContext, TriageOutcome, Recommendation
│   ├── port   IncidentTriagePort, RuleEnginePort, IdempotencyPort, AuditPort
│   └── service TriageOrchestrator
├── infrastructure
│   ├── kafka  IncidentConsumer, AuditProducer
│   ├── ai    OpenAiIncidentTriageAdapter, AiCoreClient
│   ├── opensearch TraceEnricher, RunbookRetriever, ReadModel
│   └── config Resilience4jConfig
```

The orchestrator owns policy, not model interpretation:

```java
public TriageOutcome triage(IncidentContext ctx) {
    TriageOutcome outcome;
    try {
        outcome = triagePort.triage(ctx); // strict JSON schema
    } catch (TriageUnavailableException ex) {
        outcome = ruleEnginePort.triage(ctx).withSource("rules");
    }

    if (!outcome.evidenceSufficient()
            || outcome.confidence() < policy.minConfidence()
            || outcome.recommendation().touchesMoney()
            || outcome.recommendation().changesKycState()) {
        approvalPort.open(ApprovalTask.create(ctx.eventId(), outcome));
        outcome = outcome.withStatus(Status.AWAITING_REVIEW);
    }
    auditPort.record(AuditEntry.decided(ctx, outcome));
    return outcome;
}
```

The LLM adapter uses runtime-injected BYOK credentials, strict output, and bounded resilience. Fifteen seconds and three attempts are example policy values, not universal benchmarks; they must be chosen against the alert SLO, provider contract, and concurrency budget.

```java
return retry.executeSupplier(() ->
        circuitBreaker.executeSupplier(() ->
                timeLimiter.executeFutureSupplier(
                    () -> CompletableFuture.supplyAsync(() -> callLlm(ctx)))));
```

Retries should apply only to transient, safe-to-repeat failures, use exponential backoff with jitter, and stop at a retry budget. A timeout is not proof that the provider did nothing, so the audit records the attempt and provider request correlation ID.

## Failure Scenarios

- **LLM unavailable or rate-limited:** open the breaker, use rules, publish `source=rules`, and continue alert processing. Do not queue unlimited provider retries.
- **Timeout or partial provider response:** classify as unavailable or invalid, audit it, and avoid treating a late response as authoritative.
- **OpenSearch unavailable:** retain the Kafka event, pause or route to a bounded retry topic, and expose enrichment freshness. Do not invent trace evidence.
- **Kafka retry or duplicate:** the atomic inbox claim suppresses duplicate triage; approval and notification APIs still require separate idempotency keys.
- **Out-of-order alert and trace:** wait within a bounded enrichment window, then process with `evidenceSufficient=false`. A later replay can rebuild the read model without changing the original audit entry.
- **Consumer crash or rebalance:** commit the offset only after durable outcome/audit intent. Expiring claims and retry topics recover abandoned work.
- **Poison message or schema mismatch:** send it to a dead-letter topic with the reason, event ID, and bounded payload metadata. Do not retry forever.
- **Queue saturation:** apply admission control and pause partitions. Track oldest event age and shed optional RAG context before dropping the source event.
- **Database or approval service failure:** leave the outcome in an explicit pending state. Never infer approval from a successful model call.
- **Model regression or rollback:** deploy model and prompt versions independently, shadow-test on a fixed evaluation set, monitor decision distributions, and retain the previous version for rollback. Replaying Kafka with a new model must create a new evaluation/run ID rather than overwrite the original audit.

## Capacity and Performance

Capacity follows the queue, provider, and worker limits, not a guessed thread count. If the target triage rate is `R`, the p95 provider latency is `L`, and the desired utilization is `U`, a first estimate is:

```text
workers >= ceil(R × L / U)
```

For example, `R=200 events/s`, `L=2s`, and `U=0.7` implies at least `ceil(571)` concurrent call slots before accounting for retries, enrichment, and provider quotas. That calculation may show that the right answer is not more workers but rules-first filtering, batching, a faster local model, or a lower intake rate. At ten seconds, the same service needs five times the slots.

Use bounded connection pools and queues. Measure Kafka lag, oldest event age, OpenSearch query latency, provider latency, timeout rate, retry volume, and queue utilization. Protect tenants with per-tenant quotas because BYOK assigns cost and provider capacity to each customer.

## Security and Privacy

Redact before prompt construction, not after logging. Do not casually send full transactions, card numbers, credentials, KYC documents, customer payloads, or tokens to an external provider. Prefer a minimal incident schema containing service names, aggregate metrics, identifiers that are safe for the provider boundary, and references to evidence.

```java
String redact(String raw) {
    return raw.replaceAll("\\d{13,19}", "****")
              .replaceAll("(?i)(password|token)=\\S+", "$1=REDACTED");
}
```

Regex is only a small defense. Structured allow-lists, provider data-retention controls, encryption in transit and at rest, secret injection through Kubernetes Secret or Vault, role-based access, audited access to prompts, and retention limits are required. Log redaction masks and hashes, not raw payloads. Treat log content and retrieved runbooks as untrusted text because prompt injection can be embedded in them.

## Auditability and Observability

A log line is not an audit trail. An append-only audit event should preserve, subject to data-minimization rules:

```text
transaction_id, event_id, trace_id, occurred_at
features/evidence references, risk or confidence score, decision
model, model_version, prompt_version, provider, provider_request_id
policy_version, fallback reason, approval actor and approval time
```

Store the original event in Kafka, the searchable projection in OpenSearch, and approval/payment state in its authoritative store. Preserve a prompt hash and redacted input snapshot where retention policy permits so a reviewer can distinguish “same input, different model” from “different evidence.” Reproducibility means reconstructing the evidence and versions, not claiming that an LLM will always return byte-identical text.

Observability must cover business behavior and system health:

```text
transactions_processed, anomalies_detected, review_rate
false_positive_rate, false_negative_rate, decision_distribution
ai_timeout_rate, ai_cost, model_error_rate, provider_error_rate
model_version, queue_age, kafka_lag, opensearch_query_latency
```

Do not put `transaction_id`, `account_id`, `event_id`, or `trace_id` in Prometheus labels. Their cardinality can overwhelm the metrics backend. Put them in structured logs, traces, or the audit store, and use bounded labels such as service, provider, model version, outcome, and environment.

## AI-Specific Considerations

Use temperature and JSON Schema to reduce variability, but do not confuse lower variability with correctness. Evaluate the system on historical and synthetic incidents with labelled severity, root-cause evidence, and safe action. Track false positives, false negatives, calibration, abstention rate, unsupported claims, and prompt-injection tests.

Version prompts, retrieval corpus, model, policy, and AI core library separately. A runbook update can change output even when the model is unchanged. A model can be unavailable, too expensive, or rate-limited. A fallback should remain useful without pretending to provide semantic correlation.

The RAG context should be bounded by service, time window, trace ID, and allow-listed runbook documents. Never let retrieved text override the system policy. The model should be able to answer “insufficient evidence,” and that answer should be a valid outcome, not a parser failure.

## What We Would Do Differently

We would keep the first version rules-first and read-only, then add LLM assistance after measuring the incident taxonomy and review burden. We would use a durable inbox/outbox or database for approval state if OpenSearch claim leases became difficult to operate. We would test replay cost before enabling broad historical reprocessing, because each replay can consume provider quota and produce a new model version's recommendations.

We would also make the AI core library a platform dependency with conformance tests: no unredacted prompt leaves the process, every response has a schema and version, every fallback emits an audit event, and every external side effect has an idempotency key.

## Key Lessons

1. Start with the failure and authority boundary, not the model or the diagram.
2. Treat LLM output as an AI signal; deterministic policy owns business decisions.
3. Kafka is a replayable source, OpenSearch is a read model, and the ledger or approval store is authoritative.
4. `exists()` followed by `insert()` is not idempotency. Use atomic uniqueness and separately protect side effects.
5. Capacity is `concurrency = throughput × latency`; retries and provider quotas belong in the calculation.
6. Audit versions, evidence, decisions, fallbacks, and approvals so a result can be explained and evaluated.
7. Minimize PII and make model failure, uncertainty, and rollback normal states.

## References

- Apache Kafka documentation on delivery semantics: https://kafka.apache.org/documentation/#semantics
- OpenTelemetry documentation on traces: https://opentelemetry.io/docs/concepts/signals/traces/
- Prometheus guidance on metric label cardinality: https://prometheus.io/docs/practices/naming/
- OWASP Top 10 for Large Language Model Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/

> Repo: https://github.com/finpay-lab/observability
