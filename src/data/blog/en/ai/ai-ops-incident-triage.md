---
title: "AI Ops Incident Triage with Alerts and Traces"
description: "How FinPay's observability stack turns Prometheus alerts and OpenTelemetry traces into an auditable root-cause hypothesis and runbook recommendation."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> Repo: https://github.com/finpay-lab/observability

## The problem

When a settlement batch is delayed, several symptoms can appear at once: latency rises, the error rate changes, and dead-letter queues fill. An on-call engineer must decide which alerts describe the same incident, where the failure started, and whether a proposed response could affect money. The difficult part is not producing a summary. It is making the summary safe to use in an operational workflow.

**[SOURCE FACT]** The `ai-ops-incident-triage` service is the fourth feature in the FinPay observability platform. It uses an LLM for reading, correlation, and first-pass classification. It does not make money-related decisions.

**[ANALYSIS]** The useful boundary is therefore narrow: the model proposes a severity, a root-cause hypothesis, and a recommendation; deterministic code, a human approver, and the ledger remain responsible for actions.

This article covers the Spring Boot, Kafka, and OpenSearch design, the trace-enrichment path, and the guardrails around the LLM. The code is intentionally small; the surrounding controls are the important part.

## Service boundary

**[SOURCE FACT]** The service:

1. Consumes alert events and correlated distributed traces from Kafka.
2. Enriches each alert with trace context queried from OpenSearch.
3. Sends a redacted, schema-constrained prompt to a BYOK (bring your own key) LLM.
4. Applies idempotency, timeout, retry, circuit breaker, human approval for money-related actions, and audit controls.
5. Publishes the triage decision and audit entry to Kafka and then OpenSearch.

## Architecture

**[SOURCE FACT]** The service uses hexagonal architecture. The domain core depends on ports, not on Kafka, Spring AI, or OpenSearch. Adapters are under `infrastructure/`.

```
com.finpay.observability
├── domain
│   ├── model        IncidentContext, TriageOutcome, Severity, Recommendation
│   ├── port         IncidentTriagePort, IdempotencyPort, AuditPort, ApprovalPort
│   └── service      TriageOrchestrator (orchestration, no framework dependencies)
├── infrastructure
│   ├── kafka        IncidentConsumer, AuditProducer
│   ├── ai           OpenAiIncidentTriageAdapter, LlmProperties
│   ├── opensearch   OpenSearchIdempotencyStore, OpenSearchTraceEnricher
│   └── config       Resilience4jConfig
```

```
 alerts + traces ──▶ Kafka ──▶ IncidentConsumer ──▶ domain (TriageOrchestrator)
                                                          │
                                          IncidentTriagePort (LLM) ──▶ BYOK model
                                                          │
                                     fallback ──▶ rules engine (no LLM)
                                                          │
                             money recommendation? ──▶ human ApprovalTask
                                                          │
                                   audit ──▶ Kafka("finpay.observability.audit") ──▶ OpenSearch
```

The domain model uses immutable records. That is a practical choice when model output must cross an audit boundary: the value being recorded should not change underneath the audit event.

## Guardrails

**[PROPOSED DESIGN]** These controls define the safe operating boundary for the service:

1. **The AI is not a money decider.** The model may suggest a refund or compensation. A human or a fully deterministic rule must authorize execution. The ledger, not the prompt, moves money.
2. **Idempotency by `eventId`.** Kafka provides at-least-once delivery, so retries, redelivery, replay, rebalance, or an offset reset can repeat an event. The service atomically claims `eventId` in OpenSearch and skips a duplicate.
3. **Timeout, retry, and circuit breaker.** The LLM call is time-boxed, retried with backoff, and protected by a circuit breaker. An open breaker routes triage to a deterministic rules engine instead of blocking the alert consumer.
4. **BYOK key handling.** The key is injected at runtime through a Kubernetes Secret or Vault. It is never hardcoded or logged; logs may contain only a masked preview.
5. **Auditability.** Triage, fallback, retry, and human approval produce append-only audit entries keyed by `eventId`, including the model, model version, trace ID, and outcome.

## WRONG and RIGHT

### Secrets and BYOK

**WRONG.** A key in a constant leaks into source history, developer environments, or logs and cannot be rotated without a deployment.

```java
// WRONG: secret in source code, with no rotation or masking.
public class OpenAiClient {
    private static final String BYOK_KEY = "<redacted>";
    private static final String MODEL = "gpt-4o";

    public String triage(String prompt) {
        // The key is read from the constant and sent in a request header.
    }
}
```

**[PROPOSED DESIGN] RIGHT.** Inject the key at runtime and expose only a masked form to diagnostics.

```java
@Configuration
@ConfigurationProperties(prefix = "app.llm")
public record LlmProperties(String endpoint, String model, String byokKey) {
    public String maskedKey() {
        if (byokKey == null || byokKey.isBlank()) return "<unset>";
        return byokKey.substring(0, 3) + "..." + byokKey.substring(byokKey.length() - 4);
    }
}
```

```yaml
# application.yml: the value is injected by the runtime environment.
app:
  llm:
    endpoint: ${LLM_ENDPOINT:https://api.example-llm.com/v1}
    model: ${LLM_MODEL:gpt-4o}
    byok-key: ${LLM_BYOK_KEY}
```

```java
@Configuration
public class LlmConfig {
    @Bean
    public ChatModel chatModel(LlmProperties props) {
        OpenAiApi api = new OpenAiApi(props.endpoint(), props.byokKey());
        return OpenAiChatModel.builder()
                .openAiApi(api)
                .defaultOptions(OpenAiChatOptions.builder()
                        .model(props.model())
                        .temperature(0.0)
                        .responseFormat(new ResponseFormat(ResponseFormat.Type.JSON_SCHEMA))
                        .build())
                .build();
    }
}
```

**[SOURCE FACT]** The source design also uses a CI check for `sk-`-shaped literals and a log filter that redacts key-shaped strings. These are defense-in-depth controls, not substitutes for secret injection.

### Timeout, retry, and circuit breaker

**WRONG.** A blocking call without a timeout can hold a consumer while a provider is slow. Without retry, a circuit breaker, or fallback, one provider failure becomes a pipeline failure.

```java
// WRONG: can block indefinitely and has no degradation path.
HttpResponse<String> r = client.send(request, HttpResponse.BodyHandlers.ofString());
```

**[PROPOSED DESIGN] RIGHT.** Put a time limit inside the circuit breaker and retry around the breaker. Use a deterministic fallback when the LLM is unavailable.

```java
@Configuration
public class Resilience4jConfig {
    @Bean
    public TimeLimiter llmTimeLimiter() {
        return TimeLimiter.of("llm-triage", TimeLimiterConfig.custom()
                .timeoutDuration(Duration.ofSeconds(15))
                .cancelRunningFuture(true).build());
    }

    @Bean
    public CircuitBreaker llmCircuitBreaker() {
        return CircuitBreaker.of("llm-triage", CircuitBreakerConfig.custom()
                .failureRateThreshold(50f)
                .waitDurationInOpenState(Duration.ofSeconds(30))
                .permittedNumberOfCallsInHalfOpenState(5)
                .minimumNumberOfCalls(10)
                .slidingWindowSize(20).build());
    }

    @Bean
    public Retry llmRetry() {
        return Retry.of("llm-triage", RetryConfig.custom()
                .maxAttempts(3)
                .waitDuration(Duration.ofMillis(500)).build());
    }
}
```

```java
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
        // Inner to outer: timeout inside breaker, retry around breaker.
        return retry.executeSupplier(() ->
                circuitBreaker.executeSupplier(() -> timeBoxed(ctx)));
    }

    private TriageOutcome timeBoxed(IncidentContext ctx) {
        try {
            return timeLimiter.executeFutureSupplier(
                    () -> CompletableFuture.supplyAsync(() -> callLlm(ctx)));
        } catch (Exception e) {
            throw new TriageUnavailableException(ctx.eventId(), e);
        }
    }

    private TriageOutcome callLlm(IncidentContext ctx) {
        Prompt prompt = new Prompt(new SystemMessage(SYSTEM_PROMPT),
                new UserMessage(redact(ctx.serialize())));
        ChatResponse response = chatModel.call(prompt);
        TriageOutcome outcome = TriageParser.parseStrict(ctx.eventId(), response);
        auditPort.record(AuditEntry.llmDecision(ctx.eventId(), props.maskedKey(),
                outcome, response.getMetadata()));
        return outcome;
    }
}
```

```java
public TriageOutcome triage(IncidentContext ctx) {
    try {
        return triagePort.triage(ctx);
    } catch (TriageUnavailableException ex) {
        log.warn("LLM unavailable, using rules for eventId={}: {}",
                ctx.eventId(), ex.getMessage());
        return ruleEnginePort.triage(ctx).withSource(TriageSource.RULES);
    }
}
```

**[ANALYSIS]** Degradation is preferable to making alert triage depend entirely on provider availability. A fallback must be deterministic and audited; it is not an attempt to imitate the model.

### Idempotency by `eventId`

**WRONG.** Calling the triage service directly from a Kafka listener duplicates work when the same event is delivered again.

```java
@KafkaListener(topics = "finpay.observability.alerts")
public void onAlert(AlertEvent event) {
    TriageOutcome outcome = ai.triage(event);
    incidentService.create(outcome);
}
```

**[PROPOSED DESIGN] RIGHT.** Claim the ID atomically before enrichment or triage.

```java
public interface IdempotencyPort {
    boolean tryClaim(String eventId);
    void complete(String eventId, TriageOutcome outcome);
}
```

```java
@Component
public class OpenSearchIdempotencyStore implements IdempotencyPort {
    private final OpenSearchClient client;

    @Override
    public boolean tryClaim(String eventId) {
        try {
            client.index(builder -> builder.index("finpay-incident-triage")
                    .id(eventId).opType(OpType.Create));
            return true;
        } catch (ResourceAlreadyExistsException ex) {
            return false;
        }
    }

    @Override
    public void complete(String eventId, TriageOutcome outcome) {
        client.index(builder -> builder.index("finpay-incident-triage")
                .id(eventId).document(outcome));
    }
}
```

```java
@KafkaListener(topics = "finpay.observability.alerts")
public void onAlert(AlertEvent event) {
    String eventId = event.eventId();
    if (!idempotency.tryClaim(eventId)) return;
    IncidentContext ctx = enrich(event);
    TriageOutcome outcome = orchestrator.triage(ctx);
    idempotency.complete(eventId, outcome);
    auditPort.record(AuditEntry.processed(eventId, outcome));
}
```

**[ANALYSIS]** Using `eventId` as the OpenSearch document ID gives the claim a distributed uniqueness constraint. The complete document blocks later replays. If a consumer dies mid-processing, the claim needs a lease or recovery policy; an unbounded in-flight claim would be an operational failure mode.

### Money-related recommendations

**WRONG.** A string returned by the model must never authorize a payment write.

```java
String decision = llm.complete("Should we refund this failed payment? Reply REFUND or NO_ACTION.");
if ("REFUND".equalsIgnoreCase(decision)) {
    paymentService.refund(event.amount(), event.payerId());
}
```

**[PROPOSED DESIGN] RIGHT.** Make the recommendation typed and route money-related outcomes to approval.

```java
public enum ActionKind { NO_ACTION, ROLLBACK_DESIGN, REFUND, COMPENSATION }
public record Recommendation(ActionKind kind, String reason,
        String runbook, boolean touchesMoney) {}
```

```java
public TriageOutcome triage(IncidentContext ctx) {
    TriageOutcome outcome = triageWithFallback(ctx);
    if (outcome.recommendation().touchesMoney()) {
        approvalPort.open(ApprovalTask.create(ctx.eventId(), outcome));
        outcome = outcome.withStatus(Status.AWAITING_HUMAN_APPROVAL);
    }
    auditPort.record(AuditEntry.decided(ctx.eventId(), outcome,
            outcome.recommendation().touchesMoney()));
    return outcome;
}
```

The model is an analyst. The approver decides, and the ledger is the source of truth. There must be no path from model output to a payment write without an approval event in the audit trail.

### Audit every decision

**WRONG.** A log line is not an audit trail: it does not reliably preserve the trace, model version, or approval context.

```java
public void triage(AlertEvent event) {
    String d = llm.complete(buildPrompt(event));
    incidentService.create(d);
}
```

**[PROPOSED DESIGN] RIGHT.** Publish immutable, append-only entries keyed by `eventId`.

```java
public interface AuditPort {
    void record(AuditEntry entry);
}

@Component
public class AuditProducer implements AuditPort {
    private final KafkaTemplate<String, Object> kafka;

    @Override
    public void record(AuditEntry entry) {
        kafka.send("finpay.observability.audit", entry.eventId(), entry);
    }
}
```

```java
public record AuditEntry(
        String eventId, Instant at,
        String actor,       // "llm" | "rules" | "human:alice"
        String action,
        String llmTraceId,  // links the prompt/response pair
        String model,
        String modelVersion,
        TriageOutcome outcome,
        boolean humanApproved) {}
```

The audit record must let an operator reconstruct what was sent to the model, what it returned, which version was used, and who approved the action. Otherwise it is only an operational log.

## Trace enrichment and redaction

**[SOURCE FACT]** `IncidentContext` joins the alert with correlated traces. OpenTelemetry traces stored in OpenSearch help locate the failure; the alert describes the externally observed symptom.

```java
@Component
public class OpenSearchTraceEnricher {
    private final OpenSearchClient client;

    public List<TraceSpan> correlatedSpans(String traceId) {
        return client.search(builder -> builder
                        .index("finpay-traces-*")
                        .query(q -> q.term(t -> t.field("trace.id").value(traceId)))
                        .size(200), TraceSpan.class)
                .hits().hits().stream().map(h -> h.source()).toList();
    }
}
```

**[ANALYSIS]** Redact before constructing the prompt. Card numbers, credentials, and customer payloads should not reach the model. Log the redaction mask, not the original payload.

```java
String redact(String raw) {
    return raw.replaceAll("\\d{13,19}", "****")
            .replaceAll("(?i)(password|token)=\\S+", "$1=REDACTED");
}
```

## Operational notes

- **`temperature = 0` and JSON Schema.** Parse the response strictly. A parse failure counts as a breaker failure and uses the rules fallback.
- **Manual consumer acknowledgement.** At-least-once delivery plus the `eventId` claim store provides exactly-once effect without Kafka transactions.
- **Audit fallbacks too.** A rules decision uses `actor = "rules"` and the same `eventId`.
- **Measure the right cost.** BYOK assigns provider spend and capacity to each customer. The service measures latency for SLOs rather than token count.

## Conclusion

**[ANALYSIS]** An LLM can be a useful first-pass analyst and a poor final authority. `ai-ops-incident-triage` keeps that boundary explicit: typed output, deterministic fallback, human approval for money-related recommendations, and an audit trail around every decision.

> Repo: https://github.com/finpay-lab/observability
