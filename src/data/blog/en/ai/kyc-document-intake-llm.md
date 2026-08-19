---
title: "Designing a KYC Document Intake Pipeline with Vision LLMs"
description: "A practical design for extracting KYC fields from identity documents, validating them with deterministic rules, and routing uncertain cases to human review."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/identity-service>


KYC (Know Your Customer) document intake looks simple until it has to handle bad images, different document formats, duplicate delivery, provider failures, and audit requirements. A vision language model (VLM) can help extract fields from an identity document, but it should not be the system of record or the final decision-maker.

This article describes a boundary-first design for the `kyc-document-intake-llm` feature: normalize an upload into a domain command, extract structured fields, apply deterministic checks, use an LLM only for questions that need judgment, and route uncertain results to human review. It also contrasts that design with a common synchronous implementation and explains the failure modes that need explicit handling.

The code and package tree below are illustrative. They show the intended boundaries; they are not evidence that a particular provider, model, or production incident exists.

## Pipeline

```text
DocumentUploaded (Kafka) -> IntakeCommand -> VisionExtractionPort (VLM)
     |                                              |
     +-> DocumentSnapshot (domain model)            +-> StructuredFields + Confidence
                         |                                      |
                         v                                      v
              FraudScreeningPort <- RiskAssessment (domain) -> LlmJudgePort
                         |                                      |
                         v                                      v
                DecisionEvent -> outbox -> Kafka -> OpenSearch (decision index)
```

**[SOURCE FACT]** The supplied design uses `DocumentUploaded` on Kafka, an S3 key and `eventId`, a vision extraction port, structured fields with confidence, a rule-based fraud check, an LLM judge, an outbox, Kafka, and OpenSearch.

**[PROPOSED DESIGN]** The processing sequence is:

1. Kafka delivers `DocumentUploaded`. The event should carry an object reference, such as an S3 key, and an `eventId`; the consumer should not depend on a web multipart type.
2. An adapter maps the event to an `IntakeCommand` and a `DocumentSnapshot`.
3. A vision adapter sends the document to a multimodal model and returns a typed result. The result includes field values, confidence, provider metadata, and an explicit extraction status rather than free-form prose.
4. A deterministic rule engine checks constraints such as allowed document type, checksum consistency, and expiry. These checks remain ordinary application code.
5. An LLM judge may answer open-ended questions, such as whether the person in a selfie appears to match the identity document. Its result is evidence, not an approval. Store the result and rationale needed for review, subject to the application's privacy policy.
6. A decision is persisted and an event is published through an outbox. OpenSearch can support retrieval and search; it should not be treated as the only durable source unless that is an explicit storage decision.

## Hexagonal boundaries

**[SOURCE FACT]** The supplied package layout places domain code under `domain/` and integrations under `infrastructure/`:

```text
src/main/java/com/finpay/identity/kyc/
├── domain/                      # pure Java, no Spring or SDK imports
│   ├── model/
│   │   ├── DocumentSnapshot.java
│   │   ├── StructuredFields.java
│   │   ├── Confidence.java
│   │   ├── RiskAssessment.java
│   │   ├── Decision.java
│   │   └── KycEvent.java
│   ├── ports/
│   │   ├── in/IntakeUseCase.java
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
└── infrastructure/              # Spring, Kafka, OpenSearch, and SDK adapters
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

**[ANALYSIS]** Keeping provider SDKs out of the domain gives the application a stable contract for extraction and judgment. It also makes the decision engine testable without a network call. Provider selection, prompt construction, token limits, timeout, retry, and response parsing belong in adapters or application services, not in a controller.

Do not claim that a provider can be replaced in a particular time or that a price change caused a particular migration unless those facts are documented. The architectural benefit is the smaller change surface, not a guaranteed migration schedule.

## The naive synchronous version

This abbreviated example is intentionally illustrative. It shows the coupling that the proposed design avoids.

```java
@RestController
public class KycIntakeController {
    private final ProviderClient providerClient;
    private final JdbcTemplate jdbcTemplate;

    @PostMapping("/kyc/documents")
    public Map<String, Object> intake(@RequestParam("file") MultipartFile file)
            throws IOException {
        String base64 = Base64.getEncoder().encodeToString(file.getBytes());

        ProviderResult result = providerClient.extract(
                "Extract fullName, docNumber, dateOfBirth, expiryDate, "
                        + "documentType, and country as JSON.",
                "data:image/jpeg;base64," + base64);
        String json = result.content();

        String name = extract(json, "fullName");
        String docNumber = extract(json, "docNumber");
        jdbcTemplate.update("INSERT INTO kyc_documents (data) VALUES (?)", json);

        return Map.of("approved", name != null && docNumber != null);
    }
}
```

**[ANALYSIS]** This version has several independent problems:

1. The controller owns the provider SDK, request format, parsing, persistence, and decision logic. That makes the HTTP boundary the integration boundary and makes provider changes expensive.
2. The request is synchronous. A slow provider holds an HTTP worker and potentially a database connection. Under load, this can exhaust the connection pool or thread pool before the provider recovers.
3. There is no idempotency key or inbox record. A Kafka redelivery or client retry can invoke extraction and persistence again.
4. A JSON blob does not provide a stable schema for querying, validation, or audit. Raw provider output may still be useful, but it should be stored alongside normalized fields and metadata, with access controls for sensitive data.
5. Presence of two fields is not an approval policy. It ignores document validity, expiry, fraud signals, confidence thresholds, and human review.
6. The example assumes a successful response and a predictable JSON shape. It has no timeout, retry policy, fallback, circuit breaker, size limit, content-type validation, or handling for malformed output.

## A safer application flow

**[PROPOSED DESIGN]** Keep the use case independent of HTTP and provider types:

```java
public Decision handle(IntakeCommand command) {
    if (inbox.alreadyProcessed(command.eventId())) {
        return inbox.previousDecision(command.eventId());
    }

    DocumentSnapshot snapshot = documents.load(command.objectKey());
    ExtractionResult extraction = vision.extract(snapshot);
    RiskAssessment rules = ruleEngine.check(extraction.fields(), snapshot);
    JudgeResult judgment = rules.requiresJudgment()
            ? judge.evaluate(snapshot, extraction.fields())
            : JudgeResult.notRun();

    Decision decision = decisionEngine.decide(extraction, rules, judgment);
    decisions.save(decision);
    outbox.append(DecisionEvent.from(decision));
    inbox.markProcessed(command.eventId(), decision.id());
    return decision;
}
```

The transaction around the database writes should be designed so that marking the event processed and appending the outbox record are atomic. Publishing to Kafka happens after commit and must tolerate retries. Consumers of `DecisionEvent` should also be idempotent.

## Failure handling

**[ANALYSIS]** A model call is an external dependency. Treat it like one:

- Set a timeout appropriate to the asynchronous worker, not to an interactive HTTP request.
- Retry only transient failures, with bounded exponential backoff and a maximum attempt policy. Do not retry validation errors or a refusal as if they were network failures.
- Use a circuit breaker to stop sending traffic while the provider is failing.
- Use a fallback state such as `MANUAL_REVIEW` or `EXTRACTION_UNAVAILABLE`; do not turn an unavailable model into an approval.
- Apply backpressure (giới hạn tốc độ nhận việc khi downstream quá tải) at the consumer or queue boundary.
- Bound document size, image dimensions, and prompt payload before calling the provider.
- Record a correlation ID, `eventId`, provider request ID when available, model configuration, extraction status, and decision version. Do not log document images or raw personally identifiable information by default.

Confidence is not a universal probability. A threshold is a policy decision that needs calibration against reviewed cases. If there is no validated threshold, route the case to review rather than presenting a number as a guarantee.

## Data and audit model

**[PROPOSED DESIGN]** Keep separate representations for different purposes:

- `DocumentSnapshot`: immutable reference to the uploaded object, its content metadata, and the event identity.
- `StructuredFields`: normalized values, field-level confidence, extraction status, and validation errors.
- `RiskAssessment`: deterministic rule results and their versions.
- `JudgeResult`: the question, model response, confidence or uncertainty signal, and provider metadata.
- `Decision`: the policy outcome, reason codes, review status, and decision version.
- Raw provider payload: optional, encrypted or access-controlled, and retained only when required by policy.

Use an explicit schema version for persisted decisions and events. Audit records should answer who or what produced each input, which rules ran, which model configuration was used, and why the final status was selected. Redact or tokenize sensitive fields wherever the audit requirement permits.

## What the LLM must not decide alone

The LLM should not be the sole authority for identity approval, document validity, sanctions decisions, or a policy exception. It can extract candidate values and provide supplementary evidence. Deterministic validation, policy rules, and an authorized reviewer remain responsible for the final path.

That separation is the main design constraint. The useful abstraction is not “an API endpoint that calls a model”; it is an intake workflow with explicit state, durable events, bounded dependencies, and an audit trail.
