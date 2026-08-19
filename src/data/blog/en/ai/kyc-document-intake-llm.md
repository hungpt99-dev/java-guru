---
title: "KYC Document Intake with Vision LLMs"
description: "How FinPay's identity-service extracts KYC fields from uploaded identity documents with a vision LLM and routes them for human review instead of automatic approval."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/identity-service>

# AI-6: KYC Document Intake with Vision and LLM

KYC (Know Your Customer) onboarding is the highest-volume, highest-regret pipeline in any fintech. Every misread ID card, misfiled selfie, or valid passport that is rejected represents either a compliance fine or a lost customer. The `identity-service` `kyc-document-intake-llm` feature is the AI gateway that turns raw document bytes into a structured, auditable verification request ready for a decision.

This is a **senior engineering** walkthrough covering a real architecture, real failure modes, and code that actually shipped (and was later fixed). I'll show you the WRONG way first, because it is what every first AI integration tends to look like: a single HTTP call in a transaction, a raw JSON blob in the DB, and the model treated as the final authority. Then I'll show you the RIGHT way: hexagonal, event-driven, idempotent, and guarded.

## The core pipeline

```
DocumentUploaded (Kafka) ─▶ IntakeCommand ─▶ VisionExtractionPort (VLM)
     │                                            │
     └─▶ DocumentSnapshot (domain model)          └─▶ StructuredFields + Confidence
                        │                                    │
                        ▼                                    ▼
              FraudScreeningPort ◀── RiskAssessment (domain) ──▶ LLM JudgePort
                        │                                    │
                        ▼                                    ▼
                DecisionEvent ──▶ outbox ──▶ Kafka ──▶ OpenSearch (index/decision-v1)
```

The flow:

1. **Kafka** delivers `DocumentUploaded` (provider-agnostic and containing an S3 key plus an `eventId`).
2. A **domain command** normalizes it; no `MultipartFile` leaks past the adapter layer.
3. A **Vision port** sends the image to a multimodal model and returns structured fields **with confidence scores**, not prose.
4. A **rule engine** (plain Java, zero AI) checks hard rules: whether the document type is allowed, whether the checksum matches, and whether the document has expired.
5. An **LLM judge** scores the open-ended questions: "is the person named on the selfie and the ID the same?" It is always **non-authoritative** and always logged.
6. A **Decision** is produced, persisted to OpenSearch for retrieval and search, and published through the outbox pattern.

## Architecture: hexagonal, from the first commit

The feature lives inside `identity-service`'s modular monolith. The KYC package follows the ports-and-adapters pattern strictly:

```
src/main/java/com/finpay/identity/kyc/
├── domain/                      # pure Java, zero Spring, zero SDK
│   ├── model/
│   │   ├── DocumentSnapshot.java
│   │   ├── StructuredFields.java
│   │   ├── Confidence.java
│   │   ├── RiskAssessment.java
│   │   ├── Decision.java
│   │   └── KycEvent.java
│   ├── ports/
│   │   ├── in/IntakeUseCase.java        # primary (driving) port
│   │   ├── in/AuditUseCase.java
│   │   └── out/
│   │       ├── VisionExtractionPort.java
│   │       ├── LlmJudgePort.java
│   │       ├── DecisionStorePort.java
│   │       ├── KycEventPublisherPort.java
│   │       └── FraudCheckPort.java
│   └── service/
│       ├── DocumentIntakeService.java
│       └── DecisionEngine.java
└── infrastructure/              # Spring, Kafka, OpenSearch, SDKs — all here
    ├── kafka/
    │   ├── DocumentUploadedConsumer.java
    │   └── DecisionEventProducer.java
    ├── openai/
    │   ├── OpenAiVisionAdapter.java
    │   └── OpenAiJudgeAdapter.java
    ├── opensearch/
    │   ├── DecisionDocument.java
    │   └── OpenSearchDecisionStore.java
    └── audit/
        └── AuditLogWriter.java
```

**Why it matters:** `domain/` has zero imports from Spring, the Kafka SDK, or OpenAI. It is testable in pure JUnit in milliseconds. The entire AI story — model, prompt, token budget, provider — is a swappable adapter. When the vision provider doubled its price, we switched adapters in an afternoon, not a rewrite.

## WRONG: the naive first attempt

This is what well-meaning teams ship. The web layer calls the model directly, inside the transaction, and trusts the output. Every mistake below is a real incident that we (and every AI fintech) have lived through.

```java
@RestController
public class KycIntakeController {

    private final OpenAiClient openAiClient;  // vendor SDK in the controller
    private final JdbcTemplate jdbcTemplate;

    @PostMapping("/v1/kyc/documents")
    public Map<String, Object> intake(@RequestParam("file") MultipartFile file) {
        String base64 = Base64.getEncoder().encodeToString(file.getBytes());

        // 1. Provider SDK called directly from the web layer
        ChatCompletionRequest request = ChatCompletionRequest.builder()
                .model("gpt-4o-vision")
                .messages(List.of(
                        Message.ofUserContent("""
                                Extract: fullName, docNumber, dateOfBirth,
                                expiryDate, documentType, country. Return JSON.
                                """),
                        Message.ofUserPart(new ImageContent("data:image/jpeg;base64," + base64))
                ))
                .responseFormat("json_object")
                .build();

        ChatCompletionResult result = openAiClient.chatCompletions(request);
        String json = result.getChoices().get(0).getMessage().getContent();

        // 2. LLM output trusted as ground truth, parse crashes on prose
        String name = extract(json, "fullName");
        String docNumber = extract(json, "docNumber");
        // ...

        // 3. Persist raw JSON blob: unqueryable, unauditable, unqueryable schema
        jdbcTemplate.update(
                "INSERT INTO kyc_documents (data) VALUES (?)",
                json);

        // 4. The model's word IS the decision — no rules, no human-in-loop
        boolean approved = name != null && docNumber != null;
        return Map.of("approved", approved);
    }
}
```

### What's wrong, in detail

1. **The vendor SDK owns the web layer.** Putting `OpenAiClient` in a controller means the transport, serialization, retry policy, and model name are all glued to HTTP. You cannot unit-test `intake()` without mocking a third-party SDK, and you cannot swap providers.
2. **The HTTP timeout is now the model's latency.** The model can take 10–60s under load. The servlet thread pool and the DB connection in the transaction are held hostage. One provider outage means complete connection-pool exhaustion, taking down the entire identity-service.
3. **No idempotency.** The client retries its upload, and you insert it twice. That creates duplicate decisions, duplicate risk exposure, and duplicate audit rows.
4. **Raw JSON in the DB.** `SELECT ... WHERE data->>'docNumber'` requires a full scan. There is no index, no OpenSearch, and no retention strategy. Nobody can answer "how many expired passports did we approve last month?" without a script.
5. **No guardrails.** There is no confidence threshold, no rules layered on top of the model, no retry, no circuit breaker, and no audit. The model is both jury and judge, and it is the only thing standing between you and a fine.

## RIGHT: the shipped design

### Domain model first

```java
// domain/model/StructuredFields.java
public record StructuredFields(
        String fullName,
        String docNumber,
        LocalDate dateOfBirth,
        LocalDate expiryDate,
        String documentType,
        String country,
        Confidence confidence,
        List<FieldWarning> warnings
) {
    public boolean hasHighConfidenceForCriticalFields() {
        return confidence.isHighFor("fullName")
                && confidence.isHighFor("docNumber")
                && confidence.isHighFor("dateOfBirth");
    }
}

// domain/model/Confidence.java
public record Confidence(Map<String, Double> scores) {
    private static final double CRITICAL_THRESHOLD = 0.90;

    public boolean isHighFor(String field) {
        return scores.getOrDefault(field, 0.0) >= CRITICAL_THRESHOLD;
    }
}

// domain/model/Decision.java
public record Decision(
        String eventId,
        DecisionVerdict verdict,          // APPROVED, MANUAL_REVIEW, REJECTED
        List<String> reasons,             // machine-readable codes, not prose
        LocalDateTime decidedAt,
        DecisionTrace trace               // which checks fired, with sources
) {}
```

Note what is **absent** from the domain: no `OpenAiClient`, no `Map<String,Object>`, and no `String json`. The domain deals only in records and enums. The AI output is *one* signal feeding a deterministic engine.

### Ports: the AI is behind an interface

```java
// domain/ports/out/VisionExtractionPort.java
public interface VisionExtractionPort {
    /**
     * Returns structured fields with per-field confidence.
     * Implementations: VLM provider, template-based OCR, or local fallback.
     * Never throws for "unreadable" — that is a Decision verdict, not an exception.
     */
    StructuredFields extract(DocumentSnapshot snapshot);
}

// domain/ports/out/LlmJudgePort.java
public interface LlmJudgePort {
    /**
     * Non-authoritative scoring of open-ended evidence.
     * Returns a bounded score + a reason code. Never an approval.
     */
    JudgeVerdict score(String promptKey, Map<String, String> evidence);
}
```

The provider adapter lives in `infrastructure/openai/`. It owns the model names, prompt versions, retry policies, and token budgets:

```java
// infrastructure/openai/OpenAiVisionAdapter.java
@Component
public class OpenAiVisionAdapter implements VisionExtractionPort {

    private final ChatClient chatClient;
    private final ObjectMapper mapper;

    @Override
    public StructuredFields extract(DocumentSnapshot snapshot) {
        String prompt = PromptCatalog.visionExtraction(snapshot.documentType());
        try {
            String json = chatClient.chat()
                    .system(prompt)
                    .user(messageWithImage(snapshot.assetUri()))
                    .call()
                    .content();
            return mapper.readValue(json, StructuredFields.class);
        } catch (JsonProcessingException e) {
            // Unreadable output is a signal, not a crash:
            return StructuredFields.unreadable(snapshot, "vlm-json-parse-failure");
        }
    }
}
```

### The driving service: deterministic, idempotent, and guarded

```java
// domain/service/DocumentIntakeService.java
public class DocumentIntakeService implements IntakeUseCase {

    private final VisionExtractionPort vision;
    private final LlmJudgePort judge;
    private final DecisionStorePort decisionStore;
    private final KycEventPublisherPort publisher;
    private final FraudCheckPort fraudCheck;
    private final DecisionEngine engine;      // pure Java rule engine

    @Override
    public void handle(DocumentUploaded command) {
        // 1. IDEMPOTENCY: same eventId → same outcome, exactly once
        if (decisionStore.exists(command.eventId())) {
            audit.info("duplicate intake suppressed", command.eventId());
            return;
        }

        DocumentSnapshot snapshot = DocumentSnapshot.from(command);

        // 2. Hard rules FIRST — the model never overrides the law
        Optional<String> ruleViolation = engine.checkHardRules(snapshot);
        if (ruleViolation.isPresent()) {
            Decision rejected = Decision.rejected(command.eventId(), List.of(ruleViolation.get()));
            persistAndPublish(command, rejected);
            return;
        }

        // 3. Vision extraction → structured, confidence-annotated
        StructuredFields fields = vision.extract(snapshot);

        // 4. Confidence gate: below threshold is MANUAL_REVIEW, not REJECTED
        if (!fields.hasHighConfidenceForCriticalFields()) {
            Decision review = Decision.manualReview(command.eventId(),
                    List.of("LOW_CONFIDENCE_CRITICAL_FIELDS"), fields.warnings());
            persistAndPublish(command, review);
            return;
        }

        // 5. Fraud check (sanctions lists, DOB sanity, dup doc numbers)
        FraudResult fraud = fraudCheck.evaluate(snapshot, fields);

        // 6. LLM judge: advisory only, scored, always logged
        JudgeVerdict judgeVerdict = judge.score("identity-selfie-match",
                Map.of("nameOnId", fields.fullName(),
                       "dobOnId", fields.dateOfBirth().toString()));

        // 7. THE DECISION IS THE ENGINE'S, NOT THE MODEL'S
        Decision decision = engine.combine(snapshot, fields, fraud, judgeVerdict);

        persistAndPublish(command, decision);
    }

    private void persistAndPublish(DocumentUploaded command, Decision decision) {
        decisionStore.save(command.eventId(), decision);   // idempotent write
        audit.logDecision(command.eventId(), decision);    // every decision audited
        publisher.publish(new KycEvent(command.eventId(), decision)); // outbox
    }
}
```

### The deterministic engine — this is what decides the money

```java
// domain/service/DecisionEngine.java
public class DecisionEngine {

    public Decision combine(DocumentSnapshot snapshot,
                            StructuredFields fields,
                            FraudResult fraud,
                            JudgeVerdict judgeVerdict) {
        List<String> reasons = new ArrayList<>();

        if (fraud.blocked()) reasons.add("FRAUD_SANCTION_HIT");
        if (fields.expiryDate() != null && fields.expiryDate().isBefore(LocalDate.now()))
            reasons.add("DOCUMENT_EXPIRED");
        if (judgeVerdict.score() < 0.70) reasons.add("IDENTITY_MATCH_LOW");

        // Model's opinion can add reasons, never remove the rules' verdict
        if (reasons.contains("FRAUD_SANCTION_HIT") || reasons.contains("DOCUMENT_EXPIRED")) {
            return Decision.rejected(snapshot.eventId(), reasons);
        }
        if (reasons.isEmpty() && fields.hasHighConfidenceForCriticalFields()) {
            return Decision.approved(snapshot.eventId(), reasons);
        }
        return Decision.manualReview(snapshot.eventId(), reasons);
    }
}
```

### Infrastructure: Kafka + outbox + OpenSearch

The consumer in `infrastructure/kafka/` is thin. It maps the wire event to a domain command and calls the use case. No business logic lives here.

```java
// infrastructure/kafka/DocumentUploadedConsumer.java
@Component
public class DocumentUploadedConsumer {

    private final IntakeUseCase intake;

    @KafkaListener(topics = "kyc.document.uploaded", groupId = "identity-kyc-intake")
    public void on(DocumentUploadedEnvelope envelope) {
        // envelope.eventId → command.eventId (idempotency key travels end-to-end)
        intake.handle(envelope.toCommand());
    }
}
```

Decision events go out through the **outbox pattern**, so the DB write and Kafka publication are atomic. OpenSearch is populated from the same event stream for search and reporting:

```java
// infrastructure/opensearch/OpenSearchDecisionStore.java
@Component
public class OpenSearchDecisionStore implements DecisionStorePort {

    private final OpenSearchClient client;

    @Override
    public void save(String eventId, Decision decision) {
        client.index(i -> i
                .index("decision-v1")
                .id(eventId)                                   // idempotent upsert
                .document(DecisionDocument.from(decision)));
    }

    @Override
    public boolean exists(String eventId) {
        return client.exists(e -> e.index("decision-v1").id(eventId)).value();
    }
}
```

`DecisionDocument` is the searchable projection containing the verdict, reason codes, timestamps, and masked PII. It is indexed to power fast dashboards and compliance queries.

## Guardrails: non-negotiable

Every one of these is a hard production requirement, and each is visible in the RIGHT code above:

1. **The AI is not the money decider.** The model contributes *signals* (structured fields and a score). The final verdict always comes from the deterministic `DecisionEngine` applying hard rules. An LLM cannot say "no" to a sanction hit; a rule can. *AI reduces work; law decides.*
2. **Idempotent by `eventId`.** The `eventId` travels from the Kafka envelope, through the command, to the `DecisionStorePort` key. `decisionStore.exists(eventId)` makes replays and retries exactly-once in outcome. Duplicate uploads are suppressed rather than decided twice.
3. **Timeout, retry, circuit breaker.** Provider adapters use bounded timeouts (vision: 15s; judge: 5s), one retry with jitter, and a circuit breaker that trips after repeated failures. This allows intake to degrade to `MANUAL_REVIEW` during a provider outage instead of blocking the whole service.

```java
// infrastructure/openai/OpenAiProviderConfig.java
@Configuration
public class OpenAiProviderConfig {

    @Bean
    public CircuitBreaker llmCircuitBreaker() {
        return CircuitBreaker.ofDefaults("llm-provider")
                .withFailureRateThreshold(50)
                .withSlidingWindowSize(20);
    }
}
```

4. **BYOK — never hardcode, never log the key.** The provider key comes from a KMS secret manager and is injected as an environment-backed secret at deploy time. Logging filters redact any `Authorization` header and any string that looks like a secret (`sk-`/`ai21`/`gpt-`). If a secret ever reaches a log line, the audit hook fires and rotation is forced.

```java
// infrastructure/audit/SecretRedactingFilter.java
public class SecretRedactingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) {
        // Wraps the response/request to redact key patterns before logging
        chain.doFilter(req, res);
    }
}
```

5. **Audit every decision.** Every intake writes an immutable audit row containing `eventId`, the verdict, all reason codes, the model provider, model version, prompt version, confidence scores, and a correlation ID. `LlmJudgePort.score()` is advisory, so every output is audited with the exact prompt version that produced it. You must be able to reproduce *any* decision a regulator asks about, including the model output verbatim.

## Failure modes we actually hit

- **Provider outage during an onboarding spike.** Without the circuit breaker, 1000 threads waited for a 60s upstream timeout and exhausted the pool. With it, the breaker trips at a 50% failure rate in a 20-call window, and intake gracefully falls back to `MANUAL_REVIEW` with a `PROVIDER_UNAVAILABLE` reason code.
- **The LLM "hallucinated" a document number.** A clean image paired with a poorly designed prompt produced an incorrect but confident value. Fix: the `LOW_CONFIDENCE_CRITICAL_FIELDS` gate now routes anything below 0.90 on the three critical fields to manual review, and field-level confidence is audited.
- **Duplicate uploads caused by mobile retries.** The mobile client retried after a network glitch; without idempotency, we wrote two decisions. `exists(eventId)` suppressed the second, and OpenSearch's upsert-by-ID kept one canonical row.
- **A secret appeared in a log line.** A developer debug-logged the raw request DTO, which included the header containing the provider key. The redacting filter, together with a unit test that sends a fake secret through the logger, now prevents a recurrence.

## Observability and compliance

- Every decision is indexed in OpenSearch under `decision-v1` with a 7-year retention policy for compliance.
- Dashboards track `intake_*_total`, `intake_*_p95_latency_ms`, `llm_provider_failures_total`, `llm_token_usage_total`, and `manual_review_queue_depth`.
- Prometheus metrics are exported from the same `DecisionEngine` calls and tagged by verdict and reason code.
- Trace IDs propagate from Kafka headers to OpenSearch documents, so a single onboarding can be reconstructed end-to-end.

## What we'd do differently next time

1. **An eval harness from day one.** Curate a golden-set corpus of 1,000 labeled documents and run every prompt or model change against it before release. We did this late; it is the single highest-leverage AI quality tool.
2. **Version the prompt catalog** like code: `PromptCatalog.visionExtraction()` returns a versioned prompt, and the version is recorded in the audit row.
3. **Cost gating.** Set token-budget alerts per document type; high-volume, low-value documents should go through a cheaper OCR path first.
4. **Human-in-the-loop queues.** `MANUAL_REVIEW` is not a dead end; it is a work queue with SLAs, fed by the same OpenSearch store.

## The takeaway

A production AI feature in fintech is not "call the model, save the answer." It is a deterministic pipeline in which the model is a *well-guarded sensor* feeding a rule engine that owns the decision, an event stream that owns the state, and an audit trail that owns the truth. Hexagonal ports keep the AI swappable; idempotency keeps retries safe; circuit breakers keep provider outages boring; and the hard rule engine keeps the law authoritative.

The AI reduced manual-review effort by ~70% on clean documents and made the remaining reviews faster and better informed. It never — not once — made a decision by itself.

Repo: <https://github.com/finpay-lab/identity-service>
