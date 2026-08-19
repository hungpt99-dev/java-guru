---
title: "AI Ops: Turning Alerts and Traces into Root-Cause Hypotheses"
description: "How FinPay's observability stack uses an LLM to summarize Prometheus alerts and OpenTelemetry traces into a root-cause hypothesis, complete with a runbook link."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> Repo: https://github.com/finpay-lab/observability

## The 3 a.m. pager problem

FinPay runs payments. When a settlement batch is delayed, hundreds of alerts fire within minutes: latency spikes, error rates plunge, and dead-letter queues fill up. By the time an on-call engineer wades through the noise, the *real* incident — the one that only a fraction of those alerts were actually about — has already burned through the SLO budget.

We built **ai-ops-incident-triage**, the fourth feature in our observability platform, to answer one question as early as possible: *"Is this one incident or many? What broke, and does it touch money?"* The AI handles the reading, correlation, and first-pass classification. It never makes the money decision.

This post covers the complete design: the architecture, the Spring Boot + Kafka + OpenSearch wiring, and the WRONG → RIGHT code we wrote along the way, including the five guardrails that make an LLM safe inside a fintech control plane.

> Repo: https://github.com/finpay-lab/observability

## What we built

`ai-ops-incident-triage` is a Spring Boot service that:

1. Consumes alert events and correlated distributed traces from Kafka.
2. Enriches each alert with its trace context (queried from OpenSearch).
3. Sends a redacted, schema-forced prompt to a BYOK LLM to get severity, root cause, and a recommendation.
4. Applies the guardrails (idempotency, timeouts, retries, circuit breaking, human approval for money-related actions, and full auditing).
5. Publishes the triage decision and audit entry to Kafka → OpenSearch.

## Architecture map

The service follows a hexagonal architecture. The domain core knows nothing about Kafka, Spring AI, or OpenSearch; it only knows about ports. Adapters live in `infrastructure/`:

```
com.finpay.observability
├── domain
│   ├── model        IncidentContext, TriageOutcome, Severity, Recommendation
│   ├── port         IncidentTriagePort, IdempotencyPort, AuditPort, ApprovalPort
│   └── service      TriageOrchestrator (pure orchestration, zero framework deps)
├── infrastructure
│   ├── kafka        IncidentConsumer, AuditProducer
│   ├── ai           OpenAiIncidentTriageAdapter, LlmProperties
│   ├── opensearch   OpenSearchIdempotencyStore, OpenSearchTraceEnricher
│   └── config       Resilience4jConfig
```

```
                        ┌───────────────────────────────────────────┐
 alerts + traces ──▶ Kafka ──▶ IncidentConsumer ──▶ domain (TriageOrchestrator)
                                                          │
                                          IncidentTriagePort (LLM) ──▶ BYOK model
                                                          │
                                     fallback ──▶ rules engine (no LLM)
                                                          │
                             money recommendation? ──▶ human ApprovalTask
                                                          │
                                   audit ──▶ Kafka("finpay.observability.audit") ──▶ OpenSearch
                        └───────────────────────────────────────────┘
```

The domain model consists of deliberately boring, immutable records — exactly what you want when an LLM's output has to flow through an audit trail.

## The five guardrails

These are not optional decorations. They are the contract that allows us to run an LLM inside a payments company.

1. **AI is not a money decider.** The model may *suggest* a refund or compensation; only a human (or a fully deterministic rule) may execute it. The ledger, not the prompt, moves money.
2. **Idempotent by `eventId`.** Any retry, redelivery, or replay must produce the same outcome. We claim the `eventId` atomically in OpenSearch; duplicate processing is skipped.
3. **Timeout, retry, circuit breaker.** The LLM call is time-boxed, retried with backoff, and protected by a circuit breaker. When the breaker opens, we degrade to a deterministic rule engine instead of failing the triage or, worse, blocking the alert pipeline.
4. **BYOK key, never hardcoded, never logged.** The customer's key is injected at runtime via Kubernetes Secret/Vault, and the only key-shaped string that may ever reach a log is the masked preview.
5. **Audit every decision.** Every triage, fallback, retry, and human approval produces an append-only audit entry keyed by `eventId`, with the exact model, version, trace ID, and outcome.

## WRONG then RIGHT

### 1. Secrets & BYOK

**WRONG.** The key lives in a constant, so it ends up in git history, IDEs, and log dumps. It cannot be rotated without a deployment.

```java
// WRONG — the key is in code, therefore in git history and everyone's IDE.
public class OpenAiClient {
    private static final String BYOK_KEY = "«redacted:sk-…»...";
    private static final String MODEL = "gpt-4o";

    public String triage(String prompt) {
        // key read from a constant, sent in headers, never rotated, never masked
    }
}
```

**RIGHT.** The key is injected at runtime and can only be printed in masked form.

```java
// infrastructure/config/LlmProperties.java
@Configuration
@ConfigurationProperties(prefix = "app.llm")
public record LlmProperties(String endpoint, String model, String byokKey) {

    /** The masked form is the ONLY representation of the key allowed in logs. */
    public String maskedKey() {
        if (byokKey == null || byokKey.isBlank()) return "<unset>";
        return byokKey.substring(0, 3) + "..." + byokKey.substring(byokKey.length() - 4);
    }
}
```

```yaml
# application.yml — no key here. Injected from a Kubernetes Secret (Vault) at runtime.
app:
  llm:
    endpoint: ${LLM_ENDPOINT:https://api.example-llm.com/v1}
    model: ${LLM_MODEL:gpt-4o}
    byok-key: ${LLM_BYOK_KEY}   # never commit, never print
```

```java
// infrastructure/config/LlmConfig.java
@Configuration
public class LlmConfig {

    @Bean
    public ChatModel chatModel(LlmProperties props) {
        OpenAiApi api = new OpenAiApi(props.endpoint(), props.byokKey());
        return OpenAiChatModel.builder()
                .openAiApi(api)
                .defaultOptions(OpenAiChatOptions.builder()
                        .model(props.model())
                        .temperature(0.0)   // triage must be as deterministic as possible
                        .responseFormat(new ResponseFormat(ResponseFormat.Type.JSON_SCHEMA))
                        .build())
                .build();
    }
}
```

We also have a CI check that greps the module for `sk-`-shaped literals, plus a log filter that redacts anything that *looks* like a key — defense in depth.

### 2. Timeout, retry, circuit breaker

**WRONG.** A blocking call without a timeout means that one slow provider can hang the consumer, drain the Kafka poll, and stall every alert behind it. There is no retry, breaker, or fallback.

```java
// WRONG — blocks forever, single point of failure, no degradation path.
HttpResponse<String> r = client.send(request, HttpResponse.BodyHandlers.ofString());
```

**RIGHT.** The call is time-boxed, retried with backoff, protected by a circuit breaker, and backed by a deterministic fallback.

```java
// infrastructure/config/Resilience4jConfig.java
@Configuration
public class Resilience4jConfig {

    @Bean
    public TimeLimiter llmTimeLimiter() {
        return TimeLimiter.of("llm-triage", TimeLimiterConfig.custom()
                .timeoutDuration(Duration.ofSeconds(15))
                .cancelRunningFuture(true)
                .build());
    }

    @Bean
    public CircuitBreaker llmCircuitBreaker() {
        return CircuitBreaker.of("llm-triage", CircuitBreakerConfig.custom()
                .failureRateThreshold(50f)
                .waitDurationInOpenState(Duration.ofSeconds(30))
                .permittedNumberOfCallsInHalfOpenState(5)
                .minimumNumberOfCalls(10)
                .slidingWindowSize(20)
                .build());
    }

    @Bean
    public Retry llmRetry() {
        return Retry.of("llm-triage", RetryConfig.custom()
                .maxAttempts(3)
                .waitDuration(Duration.ofMillis(500))
                .build());
    }
}
```

```java
// infrastructure/ai/OpenAiIncidentTriageAdapter.java
@Component
public class OpenAiIncidentTriageAdapter implements IncidentTriagePort {

    private final ChatModel chatModel;
    private final LlmProperties props;
    private final TimeLimiter timeLimiter;
    private final CircuitBreaker circuitBreaker;
    private final Retry retry;
    private final AuditPort auditPort;

    public OpenAiIncidentTriageAdapter(ChatModel chatModel, LlmProperties props,
                                       TimeLimiter timeLimiter, CircuitBreaker circuitBreaker,
                                       Retry retry, AuditPort auditPort) {
        this.chatModel = chatModel;
        this.props = props;
        this.timeLimiter = timeLimiter;
        this.circuitBreaker = circuitBreaker;
        this.retry = retry;
        this.auditPort = auditPort;
    }

    @Override
    public TriageOutcome triage(IncidentContext ctx) {
        // inner -> outer: timebox inside the breaker, retry around the breaker.
        return retry.executeSupplier(() ->
                circuitBreaker.executeSupplier(() -> timeBoxed(ctx)));
    }

    private TriageOutcome timeBoxed(IncidentContext ctx) {
        try {
            return timeLimiter.executeFutureSupplier(
                    () -> CompletableFuture.supplyAsync(() -> callLlm(ctx)));
        } catch (Exception e) {
            // TimeoutException, provider errors -> counted by the breaker -> retried.
            throw new TriageUnavailableException(ctx.eventId(), e);
        }
    }

    private TriageOutcome callLlm(IncidentContext ctx) {
        Prompt prompt = new Prompt(
                new SystemMessage(SYSTEM_PROMPT),
                new UserMessage(redact(ctx.serialize())));
        ChatResponse response = chatModel.call(prompt);
        TriageOutcome outcome = TriageParser.parseStrict(ctx.eventId(), response);
        auditPort.record(AuditEntry.llmDecision(ctx.eventId(), props.maskedKey(), outcome, response.getMetadata()));
        return outcome;
    }
}
```

When the breaker opens (or the LLM is simply unavailable), the orchestrator degrades instead of failing:

```java
// domain/service/TriageOrchestrator.java
public TriageOutcome triage(IncidentContext ctx) {
    TriageOutcome outcome;
    try {
        outcome = triagePort.triage(ctx);
    } catch (TriageUnavailableException ex) {
        log.warn("LLM unavailable, using rules for eventId={}: {}", ctx.eventId(), ex.getMessage());
        outcome = ruleEnginePort.triage(ctx)      // deterministic, zero LLM, still idempotent
                .withSource(TriageSource.RULES);
    }
    return outcome;
}
```

Degradation beats failure. Alert triage in the middle of a provider outage is exactly when you need the fallback most.

### 3. Idempotent by `eventId`

**WRONG.** The consumer has no memory. Kafka provides at-least-once delivery: any retry, rebalance, or manual offset reset can replay the alert, producing duplicate incidents, pager pages, and decisions.

```java
// WRONG — a single redelivery duplicates the incident and the pager page.
@KafkaListener(topics = "finpay.observability.alerts")
public void onAlert(AlertEvent event) {
    TriageOutcome outcome = ai.triage(event);   // same eventId -> second triage
    incidentService.create(outcome);            // duplicate incident, duplicate page
}
```

**RIGHT.** Every event is claimed atomically by `eventId` in OpenSearch before any work begins. A replayed event is skipped.

```java
// domain/port/IdempotencyPort.java
public interface IdempotencyPort {
    /** Atomic claim; returns false if eventId was already processed or is in flight. */
    boolean tryClaim(String eventId);
    void complete(String eventId, TriageOutcome outcome);
}
```

```java
// infrastructure/opensearch/OpenSearchIdempotencyStore.java
@Component
public class OpenSearchIdempotencyStore implements IdempotencyPort {

    private final OpenSearchClient client;

    @Override
    public boolean tryClaim(String eventId) {
        try {
            client.index(builder -> builder
                    .index("finpay-incident-triage")
                    .id(eventId)                 // _id = eventId => unique constraint
                    .opType(OpType.Create));     // Create fails if the doc already exists
            return true;
        } catch (ResourceAlreadyExistsException ex) {
            return false;                        // duplicate or in-flight -> skip
        }
    }

    @Override
    public void complete(String eventId, TriageOutcome outcome) {
        client.index(builder -> builder
                .index("finpay-incident-triage")
                .id(eventId)
                .document(outcome));
    }
}
```

```java
// infrastructure/kafka/IncidentConsumer.java
@Component
public class IncidentConsumer {

    private final IdempotencyPort idempotency;
    private final TriageOrchestrator orchestrator;
    private final AuditPort auditPort;

    @KafkaListener(topics = "finpay.observability.alerts")
    public void onAlert(AlertEvent event) {
        String eventId = event.eventId();
        if (!idempotency.tryClaim(eventId)) {
            log.info("eventId={} already handled, skipping", eventId);
            return;
        }
        IncidentContext ctx = enrich(event);           // join traces from OpenSearch
        TriageOutcome outcome = orchestrator.triage(ctx);
        idempotency.complete(eventId, outcome);
        auditPort.record(AuditEntry.processed(eventId, outcome));
    }
}
```

`_id = eventId` is the key: OpenSearch gives us an atomic, distributed, replay-safe claim without additional coordination. Even if the consumer dies mid-processing, the in-flight claim blocks a duplicate until the lease expires, and the completed document blocks it permanently.

### 4. AI is not a money decider

**WRONG.** The model moves money by quoting a single word. No human, no limit, no audit — just a prompt.

```java
// WRONG — a word from the model authorizes a refund. Nothing else is consulted.
String decision = llm.complete("Should we refund this failed payment? Reply REFUND or NO_ACTION.");
if ("REFUND".equalsIgnoreCase(decision)) {
    paymentService.refund(event.amount(), event.payerId());   // money moved by a prompt
}
```

**RIGHT.** The recommendation is a first-class, typed, auditable value, and the orchestrator treats anything that touches money as "requiring human approval."

```java
// domain/model/Recommendation.java
public enum ActionKind { NO_ACTION, ROLLBACK_DESIGN, REFUND, COMPENSATION }

public record Recommendation(ActionKind kind, String reason, String runbook, boolean touchesMoney) {}
```

```java
// domain/service/TriageOrchestrator.java
public TriageOutcome triage(IncidentContext ctx) {
    TriageOutcome outcome = triageWithFallback(ctx);

    if (outcome.recommendation().touchesMoney()) {
        // Guardrail: the ledger decides, not the model.
        approvalPort.open(ApprovalTask.create(ctx.eventId(), outcome));
        outcome = outcome.withStatus(Status.AWAITING_HUMAN_APPROVAL);
    }
    auditPort.record(AuditEntry.decided(ctx.eventId(), outcome, outcome.recommendation().touchesMoney()));
    return outcome;
}
```

The LLM's job is to be a fast, observant analyst. The human's job is to make the decision, and the ledger is the source of truth. We never create a path in which model output reaches a payment write without an approval event on the audit trail.

### 5. Audit every decision

**WRONG.** The decision happens in a void. When regulators or customers ask, "Why did this happen?", there is no answer, trace, or model version.

```java
// WRONG — the decision is invisible. No trace, no model version, no audit.
public void triage(AlertEvent event) {
    String d = llm.complete(buildPrompt(event));
    incidentService.create(d);      // gone the moment the log rotates
}
```

**RIGHT.** Every decision is an append-only audit entry keyed by `eventId`, published to Kafka, and written to OpenSearch.

```java
// domain/port/AuditPort.java
public interface AuditPort {
    void record(AuditEntry entry);
}

// infrastructure/kafka/AuditProducer.java
@Component
public class AuditProducer implements AuditPort {

    private final KafkaTemplate<String, Object> kafka;

    @Override
    public void record(AuditEntry entry) {
        // Append-only, immutable. OpenSearch sink + S3 archive via ILM.
        kafka.send("finpay.observability.audit", entry.eventId(), entry);
    }
}
```

```java
public record AuditEntry(
        String eventId,
        Instant at,
        String actor,            // "llm" | "rules" | "human:alice"
        String action,
        String llmTraceId,       // links the exact prompt/response pair
        String model,
        String modelVersion,
        TriageOutcome outcome,
        boolean humanApproved) {}
```

If, for a given `eventId`, you cannot reconstruct *what the model was asked, what it answered, which version it used, and who approved it*, you do not have an audit trail; you have a hope.

## The trace enrichment step

`IncidentContext` is built by joining the alert with its correlated traces. Traces (via OpenTelemetry → OpenSearch) tell the model *where* the failure occurred; the alert tells it *what* is observable from outside.

```java
// infrastructure/opensearch/OpenSearchTraceEnricher.java
@Component
public class OpenSearchTraceEnricher {

    private final OpenSearchClient client;

    public List<TraceSpan> correlatedSpans(String traceId) {
        return client.search(builder -> builder
                        .index("finpay-traces-*")
                        .query(q -> q.term(t -> t.field("trace.id").value(traceId)))
                        .size(200), TraceSpan.class)
                .hits()
                .hits()
                .stream()
                .map(h -> h.source())
                .toList();
    }
}
```

One senior-level warning: **redact before you prompt.** Card numbers, credentials, and customer payloads must never reach the model. We strip PII and payment data before serializing `IncidentContext`, and log the redaction mask rather than the payload.

```java
String redact(String raw) {
    return raw.replaceAll("\\d{13,19}", "****")        // PANs
              .replaceAll("(?i)(password|token)=\\S+", "$1=REDACTED");
}
```

## Operational notes

- **`temperature = 0` + JSON schema.** Triage output is parsed strictly; a parse failure counts as a breaker failure and triggers a fallback to rules. We never let the model improvise a field name.
- **Manual ack on the consumer.** At-least-once delivery + the `eventId` claim store gives exactly-once *effect* without Kafka transactions.
- **Every fallback is also audited.** A rule-engine triage has `actor = "rules"` and the same `eventId`; the audit trail must tell the whole story.
- **Cost is a feature.** BYOK means each customer meters their own spend and capacity; we meter latency, not tokens, for SLOs.

## Wrap-up

An LLM is a great first responder and a terrible final authority. **ai-ops-incident-triage** treats it accordingly: fast analysis, typed recommendations, hard guardrails, and a complete audit trail. When you put a model inside a fintech control plane, the code around the model matters more than the model itself.

> Repo: https://github.com/finpay-lab/observability
