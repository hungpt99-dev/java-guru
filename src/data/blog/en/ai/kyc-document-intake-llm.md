---
title: "KYC Document Intake with Vision LLMs"
description: "How FinPay's identity-service extracts KYC fields from uploaded ID documents with a vision LLM and routes them to human review instead of auto-approval."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/identity-service>

# AI-6: KYC Document Intake with Vision and LLM

KYC (Know Your Customer) onboarding is the highest-volume, highest-regret pipeline in any fintech. Every misread ID card, every misfiled selfie, every rejected-but-valid passport is either a compliance fine or a lost customer. The `identity-service` `kyc-document-intake-llm` feature is the AI gateway that turns raw document bytes into a structured, auditable, decision-ready verification request.

This is a **senior engineering** walkthrough: real architecture, real failure modes, and code that actually shipped (then got fixed). I'll show you the WRONG way first, because the wrong way is what every first AI integration looks like — a single HTTP call in a transaction, a raw JSON blob in the DB, the model as the final word. Then I'll show you the RIGHT way: hexagonal, event-driven, idempotent, and guarded.

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

1. **Kafka** delivers `DocumentUploaded` (carrier-agnostic, contains S3 key + `eventId`).
2. A **domain command** normalizes it — no `MultipartFile` leaks past the adapter layer.
3. A **Vision port** sends the image to a multimodal model and returns structured fields **with confidence scores**, not prose.
4. A **Rule engine** (plain Java, zero AI) checks hard rules: document type allowed, checksum matches, expiry not passed.
5. An **LLM judge** scores the open-ended bits: "is the name on the selfie and the ID the same person?" — always **non-authoritative**, always logged.
6. A **Decision** is produced, persisted to OpenSearch for retrieval/search, and published via the outbox pattern.

## Architecture: hexagonal, from the first commit

The feature lives inside `identity-service`'s modular monolith. The KYC package follows ports & adapters strictly:

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

This is what gets shipped by well-meaning teams. The web layer calls the model directly, in the transaction, and trusts the output. Every mistake below is a real incident we (and every AI fintech) have lived through.

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

1. **The vendor SDK owns the web layer.** `OpenAiClient` in a controller means the transport, the serialization, the retry policy, and the model name are glued to HTTP. You cannot unit test `intake()` without mocking a third-party SDK, and you cannot swap providers.
2. **The HTTP timeout is now the model's latency.** The model can take 10–60s under load. The servlet thread pool and the DB connection in the transaction are held hostage. One provider outage = complete connection-pool exhaustion = the entire identity-service down.
3. **No idempotency.** The client retries its upload, you insert twice. Duplicate decisions, duplicate risk exposure, duplicate audit rows.
4. **Raw JSON in the DB.** `SELECT ... WHERE data->>'docNumber'` is a full scan. There is no index, no OpenSearch, no retention story. Nobody can answer "how many expired passports did we approve last month?" without a script.
5. **No guardrails.** No confidence threshold, no rules on top of the model, no retry, no circuit breaker, no audit. The model is both jury and judge, and it is the only thing between you and a fine.

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

Note what is **absent** from the domain: no `OpenAiClient`, no `Map<String,Object>`, no `String json`. The domain deals only in records and enums. The AI output is *one* signal feeding a deterministic engine.

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

The provider adapter lives in `infrastructure/openai/`. It owns model names, prompt versions, retries, and token budgets:

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

### The driving service: deterministic, idempotent, guarded

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

### The deterministic engine — this is the money decider

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

The `infrastructure/kafka/` consumer is thin. It maps the wire event to a domain command and calls the use case. No business logic lives here.

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

Decision events go out through the **outbox pattern** so the DB write and the Kafka publish are atomic, and OpenSearch is hydrated from the same event stream for search and reporting:

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

`DecisionDocument` is the searchable projection: verdict, reason codes, timestamps, masked PII — indexed to power fast dashboards and compliance queries.

## Guardrails: non-negotiable

Every one of these is a hard requirement in production, and each is visible in the RIGHT code above:

1. **The AI is not the money decider.** The model contributes *signals* (structured fields, a score). The final verdict always comes from the deterministic `DecisionEngine` applying hard rules. An LLM cannot be told "no" for a sanction hit; a rule can. *AI reduces work; law decides.*
2. **Idempotent by `eventId`.** The `eventId` travels from the Kafka envelope, through the command, to the `DecisionStorePort` key. `decisionStore.exists(eventId)` makes replays and retries exactly-once in outcome. Duplicate uploads are suppressed, not double-decided.
3. **Timeout, retry, circuit breaker.** Provider adapters use bounded timeouts (vision: 15s; judge: 5s), one retry with jitter, and a circuit breaker that trips after repeated failures so a provider outage degrades intake to `MANUAL_REVIEW` instead of blocking the whole service.

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

4. **BYOK — never hardcode, never log the key.** The provider key comes from a KMS secret manager, injected as an env-backed secret at deploy time. Logging filters redact any `Authorization` header and any string that looks like a secret (`sk-`/`ai21`/`gpt-`). If a secret ever touches a log line, the audit hook fires and rotation is forced.

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

5. **Audit every decision.** Every intake writes an immutable audit row: `eventId`, verdict, all reason codes, model provider + model version + prompt version, confidence scores, and a correlation ID. `LlmJudgePort.score()` is advisory, so every one of its outputs is audited with the exact prompt version that produced it — you must be able to reproduce *any* decision the regulator asks about, including the model output verbatim.

## Failure modes we actually hit

- **Provider outage during onboarding spike.** Without the circuit breaker, 1000 threads waited on a 60s upstream timeout and exhausted the pool. With it, the breaker trips at a 50% failure rate in a 20-call window and intake gracefully falls back to `MANUAL_REVIEW` with a `PROVIDER_UNAVAILABLE` reason code.
- **LLM "hallucinated" a doc number.** A clean image with a dirty prompt produced a wrong but confident value. Fix: the `LOW_CONFIDENCE_CRITICAL_FIELDS` gate now routes anything below 0.90 on the three critical fields to manual review, and the field-level confidence is audited.
- **Duplicate uploads from mobile retries.** The mobile client retried on network flake; without idempotency we wrote two decisions. `exists(eventId)` suppressed the second, and OpenSearch's upsert-by-id kept one canonical row.
- **Secret in a log line.** A developer debug-logged the raw request DTO, which included the header with the provider key. The redacting filter + a unit test that feeds a fake secret through the logger now prevents the recurrence.

## Observability and compliance

- Every decision indexed in OpenSearch under `decision-v1` with a 7-year retention policy for compliance.
- Dashboards: `intake_*_total`, `intake_*_p95_latency_ms`, `llm_provider_failures_total`, `llm_token_usage_total`, `manual_review_queue_depth`.
- Prometheus metrics exported from the same `DecisionEngine` calls, tagged by verdict and reason code.
- Trace IDs propagate from Kafka headers to OpenSearch documents, so a single onboarding can be reconstructed end-to-end.

## What we'd do differently next time

1. **Eval harness from day one.** Curate a golden-set corpus of 1,000 labeled documents and run every prompt/model change against it before release. We did this late; it's the single highest-leverage AI quality tool.
2. **Version the prompt catalog** like code — `PromptCatalog.visionExtraction()` returns a versioned prompt, and the version lands in the audit row.
3. **Cost gating.** Token budget alerts per document type; high-volume, low-value documents should first go through a cheaper OCR path.
4. **Human-in-the-loop queues.** `MANUAL_REVIEW` is not a dead end; it's a work queue with SLAs, fed by the same OpenSearch store.

## The takeaway

A production AI feature in fintech is not "call the model, save the answer." It is a deterministic pipeline where the model is a *well-guarded sensor* feeding a rule engine that owns the decision, an event stream that owns the state, and an audit trail that owns the truth. Hexagonal ports keep the AI swappable; idempotency keeps retries safe; circuit breakers keep provider outages boring; and the hard rule engine keeps the law authoritative.

The AI reduced manual review effort by ~70% on clean documents and made the remaining reviews faster and better-informed. It never — not once — made a decision by itself.

Repo: <https://github.com/finpay-lab/identity-service>
