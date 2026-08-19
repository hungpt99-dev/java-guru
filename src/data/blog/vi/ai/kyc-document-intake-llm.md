---
title: "KYC Document Intake with Vision LLMs"
description: "identity-service của FinPay trích xuất trường KYC từ giấy tờ tải lên bằng vision LLM và chuyển sang duyệt thủ công thay vì tự động phê duyệt."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/identity-service>

# AI-6: Tiếp nhận tài liệu KYC bằng Vision và LLM

KYC (Know Your Customer) là pipeline có khối lượng xử lý lớn nhất và rủi ro nhất trong bất kỳ fintech nào. Mỗi thẻ căn cước bị đọc sai, mỗi ảnh chân dung nộp sai chỗ, mỗi hộ chiếu hợp lệ bị từ chối oan — tất cả đều dẫn đến hoặc một khoản phạt tuân thủ, hoặc mất một khách hàng. Feature `kyc-document-intake-llm` của `identity-service` là cổng AI biến bytes tài liệu thô thành một yêu cầu xác minh có cấu trúc, kiểm toán được, sẵn sàng ra quyết định.

Đây là một bài viết đi sâu **cấp kỹ sư senior**: kiến trúc thật, các chế độ hỏng thật, và code đã thực sự lên production (rồi được sửa). Tôi sẽ cho bạn thấy cách WRONG trước, vì cách sai ấy chính là thứ mà mọi tích hợp AI đầu tiên đều làm — một lần gọi HTTP nằm trong transaction, một blob JSON thô trong DB, và coi mô hình như lời phán quyết cuối cùng. Sau đó là cách RIGHT: hexagonal, hướng sự kiện, idempotent, và được canh gác.

## Pipeline cốt lõi

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

Luồng xử lý:

1. **Kafka** chuyển `DocumentUploaded` (không phụ thuộc nhà cung cấp, chứa S3 key + `eventId`).
2. Một **domain command** chuẩn hóa nó — không có `MultipartFile` nào lọt qua khỏi lớp adapter.
3. Một **Vision port** gửi ảnh tới mô hình đa phương thức và trả về các trường có cấu trúc **kèm điểm tin cậy**, không phải văn xuôi.
4. Một **rule engine** (Java thuần, zero AI) kiểm tra các luật cứng: loại tài liệu được phép, checksum khớp, hạn hiệu lực chưa qua.
5. Một **LLM judge** chấm điểm các phần mở: "tên trên ảnh chân dung và trên căn cước có cùng một người không?" — luôn **không có thẩm quyền quyết định**, luôn được ghi log.
6. Một **Decision** được tạo ra, lưu vào OpenSearch để truy vấn, và được phát hành qua outbox pattern.

## Kiến trúc: hexagonal, ngay từ commit đầu tiên

Feature này nằm bên trong monolith dạng mô-đun của `identity-service`. Package KYC tuân thủ nghiêm ngặt mô hình ports & adapters:

```
src/main/java/com/finpay/identity/kyc/
├── domain/                      # Java thuần, zero Spring, zero SDK
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
└── infrastructure/              # Spring, Kafka, OpenSearch, SDK — tất cả ở đây
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

**Vì sao quan trọng:** `domain/` không import gì từ Spring, Kafka SDK, hay OpenAI. Nó có thể được test bằng JUnit thuần trong vài mili-giây. Toàn bộ câu chuyện AI — mô hình, prompt, token budget, nhà cung cấp — chỉ nằm trong một adapter có thể thay thế. Khi nhà cung cấp vision tăng giá gấp đôi, chúng tôi đổi adapter trong một buổi chiều, chứ không phải viết lại toàn bộ.

## WRONG: nỗ lực ngây thơ đầu tiên

Đây là thứ được đưa lên production bởi những đội có thiện chí. Lớp web gọi thẳng mô hình, nằm trong transaction, và tin tuyệt đối vào output. Mỗi sai lầm dưới đây là một sự cố có thật mà chúng tôi (và mọi fintech AI khác) từng gặp.

```java
@RestController
public class KycIntakeController {

    private final OpenAiClient openAiClient;  // SDK của nhà cung cấp trong controller
    private final JdbcTemplate jdbcTemplate;

    @PostMapping("/v1/kyc/documents")
    public Map<String, Object> intake(@RequestParam("file") MultipartFile file) {
        String base64 = Base64.getEncoder().encodeToString(file.getBytes());

        // 1. Gọi SDK của nhà cung cấp trực tiếp từ lớp web
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

        // 2. Coi output của LLM là ground truth, parse vỡ khi có văn xuôi
        String name = extract(json, "fullName");
        String docNumber = extract(json, "docNumber");
        // ...

        // 3. Lưu blob JSON thô: không truy vấn được, không kiểm toán được
        jdbcTemplate.update(
                "INSERT INTO kyc_documents (data) VALUES (?)",
                json);

        // 4. Lời của mô hình CHÍNH LÀ quyết định — không rule, không người duyệt
        boolean approved = name != null && docNumber != null;
        return Map.of("approved", approved);
    }
}
```

### Sai ở đâu, chi tiết

1. **SDK của nhà cung cấp chi phối lớp web.** `OpenAiClient` trong controller nghĩa là transport, serialization, retry policy, và tên mô hình đều bị dán chặt vào HTTP. Bạn không thể unit test `intake()` mà không mock SDK bên thứ ba, và không thể đổi nhà cung cấp.
2. **HTTP timeout giờ là độ trễ của mô hình.** Mô hình có thể mất 10–60s khi quá tải. Thread pool của servlet và connection DB trong transaction bị giữ làm con tin. Một lần outage của nhà cung cấp = cạn kiệt toàn bộ connection pool = cả `identity-service` sập.
3. **Không có idempotency.** Client retry upload, bạn insert hai lần. Dẫn đến decision trùng, rủi ro trùng, dòng audit trùng.
4. **JSON thô trong DB.** `SELECT ... WHERE data->>'docNumber'` là full scan. Không có index, không có OpenSearch, không có kế hoạch lưu trữ. Không ai trả lời được câu hỏi "tháng trước chúng ta đã duyệt bao nhiêu hộ chiếu hết hạn?" mà không chạy script.
5. **Không guardrails.** Không ngưỡng tin cậy, không rule chồng lên mô hình, không retry, không circuit breaker, không audit. Mô hình vừa là bồi thẩm đoàn vừa là thẩm phán, và nó là thứ duy nhất giữa bạn và một khoản phạt.

## RIGHT: thiết kế đã lên production

### Domain model trước tiên

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
        List<String> reasons,             // mã máy đọc được, không phải văn xuôi
        LocalDateTime decidedAt,
        DecisionTrace trace               // các check nào đã bắn, kèm nguồn
) {}
```

Chú ý thứ **không có** trong domain: không `OpenAiClient`, không `Map<String,Object>`, không `String json`. Domain chỉ giao tiếp bằng record và enum. Output của AI là *một* tín hiệu nuôi một engine quyết định thuần xác định.

### Ports: AI nằm sau một interface

```java
// domain/ports/out/VisionExtractionPort.java
public interface VisionExtractionPort {
    /**
     * Trả về các trường có cấu trúc kèm điểm tin cậy từng trường.
     * Triển khai: VLM provider, OCR theo template, hoặc fallback nội bộ.
     * Không bao giờ throw vì "không đọc được" — đó là một verdict, không phải exception.
     */
    StructuredFields extract(DocumentSnapshot snapshot);
}

// domain/ports/out/LlmJudgePort.java
public interface LlmJudgePort {
    /**
     * Chấm điểm không có thẩm quyền cho các bằng chứng mở.
     * Trả về một score có chặn trên + một reason code. Không bao giờ là một approval.
     */
    JudgeVerdict score(String promptKey, Map<String, String> evidence);
}
```

Adapter nhà cung cấp nằm trong `infrastructure/openai/`. Nó sở hữu tên mô hình, phiên bản prompt, retry, và token budget:

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
            // Output không đọc được là một tín hiệu, không phải sập:
            return StructuredFields.unreadable(snapshot, "vlm-json-parse-failure");
        }
    }
}
```

### Driving service: xác định, idempotent, được canh gác

```java
// domain/service/DocumentIntakeService.java
public class DocumentIntakeService implements IntakeUseCase {

    private final VisionExtractionPort vision;
    private final LlmJudgePort judge;
    private final DecisionStorePort decisionStore;
    private final KycEventPublisherPort publisher;
    private final FraudCheckPort fraudCheck;
    private final DecisionEngine engine;      // rule engine Java thuần

    @Override
    public void handle(DocumentUploaded command) {
        // 1. IDEMPOTENCY: cùng eventId → cùng kết quả, đúng-một-lần
        if (decisionStore.exists(command.eventId())) {
            audit.info("duplicate intake suppressed", command.eventId());
            return;
        }

        DocumentSnapshot snapshot = DocumentSnapshot.from(command);

        // 2. Rule cứng TRƯỚC TIÊN — mô hình không bao giờ được lấn quyền luật
        Optional<String> ruleViolation = engine.checkHardRules(snapshot);
        if (ruleViolation.isPresent()) {
            Decision rejected = Decision.rejected(command.eventId(), List.of(ruleViolation.get()));
            persistAndPublish(command, rejected);
            return;
        }

        // 3. Vision extraction → có cấu trúc, kèm điểm tin cậy
        StructuredFields fields = vision.extract(snapshot);

        // 4. Cổng tin cậy: dưới ngưỡng là MANUAL_REVIEW, không phải REJECTED
        if (!fields.hasHighConfidenceForCriticalFields()) {
            Decision review = Decision.manualReview(command.eventId(),
                    List.of("LOW_CONFIDENCE_CRITICAL_FIELDS"), fields.warnings());
            persistAndPublish(command, review);
            return;
        }

        // 5. Fraud check (danh sách cấm, DOB hợp lý, trùng số tài liệu)
        FraudResult fraud = fraudCheck.evaluate(snapshot, fields);

        // 6. LLM judge: chỉ tư vấn, có điểm, luôn được ghi log
        JudgeVerdict judgeVerdict = judge.score("identity-selfie-match",
                Map.of("nameOnId", fields.fullName(),
                       "dobOnId", fields.dateOfBirth().toString()));

        // 7. QUYẾT ĐỊNH LÀ CỦA ENGINE, KHÔNG PHẢI CỦA MÔ HÌNH
        Decision decision = engine.combine(snapshot, fields, fraud, judgeVerdict);

        persistAndPublish(command, decision);
    }

    private void persistAndPublish(DocumentUploaded command, Decision decision) {
        decisionStore.save(command.eventId(), decision);   // ghi idempotent
        audit.logDecision(command.eventId(), decision);    // mọi quyết định đều được audit
        publisher.publish(new KycEvent(command.eventId(), decision)); // outbox
    }
}
```

### Engine xác định — đây mới là người quyết định tiền

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

        // Ý kiến mô hình chỉ thêm được reasons, không bao giờ gỡ verdict của rules
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

Consumer trong `infrastructure/kafka/` rất mỏng. Nó ánh xạ event trên wire thành domain command và gọi use case. Không có logic nghiệp vụ nào nằm ở đây.

```java
// infrastructure/kafka/DocumentUploadedConsumer.java
@Component
public class DocumentUploadedConsumer {

    private final IntakeUseCase intake;

    @KafkaListener(topics = "kyc.document.uploaded", groupId = "identity-kyc-intake")
    public void on(DocumentUploadedEnvelope envelope) {
        // envelope.eventId → command.eventId (khóa idempotency đi xuyên suốt)
        intake.handle(envelope.toCommand());
    }
}
```

Các decision event đi ra qua **outbox pattern** để việc ghi DB và publish Kafka là nguyên tử, và OpenSearch được cấp dữ liệu từ chính event stream đó để phục vụ tìm kiếm và báo cáo:

```java
// infrastructure/opensearch/OpenSearchDecisionStore.java
@Component
public class OpenSearchDecisionStore implements DecisionStorePort {

    private final OpenSearchClient client;

    @Override
    public void save(String eventId, Decision decision) {
        client.index(i -> i
                .index("decision-v1")
                .id(eventId)                                   // upsert idempotent
                .document(DecisionDocument.from(decision)));
    }

    @Override
    public boolean exists(String eventId) {
        return client.exists(e -> e.index("decision-v1").id(eventId)).value();
    }
}
```

`DecisionDocument` là projection có thể tìm kiếm: verdict, reason codes, timestamps, PII đã được che — được index để phục vụ dashboard nhanh và các truy vấn tuân thủ.

## Guardrails: không thể thương lượng

Mỗi điều trong số này là một yêu cầu cứng khi lên production, và từng điều đều hiện diện trong code RIGHT ở trên:

1. **AI không phải là người quyết định tiền.** Mô hình đóng góp *tín hiệu* (trường có cấu trúc, một điểm số). Verdict cuối cùng luôn đến từ `DecisionEngine` xác định áp dụng các rule cứng. Một LLM không thể bị bảo "không" khi dính sanction hit; một rule thì có thể. *AI giảm công việc; luật quyết định.*
2. **Idempotent theo `eventId`.** `eventId` đi từ Kafka envelope, qua command, tới key của `DecisionStorePort`. `decisionStore.exists(eventId)` đảm bảo replay và retry cho kết quả đúng-một-lần. Upload trùng bị loại bỏ, không bị xử lý hai lần.
3. **Timeout, retry, circuit breaker.** Các adapter nhà cung cấp dùng timeout có chặn (vision: 15s; judge: 5s), một lần retry có jitter, và một circuit breaker ngắt khi lỗi lặp lại — để khi outage nhà cung cấp xảy ra, intake chuyển sang `MANUAL_REVIEW` thay vì chặn cả service.

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

4. **BYOK — không bao giờ hardcode, không bao giờ log key.** Key của nhà cung cấp đến từ KMS secret manager, được inject như một secret đọc từ biến môi trường lúc deploy. Bộ lọc log che bất kỳ header `Authorization` nào và bất kỳ chuỗi trông giống secret nào (`sk-`/`ai21`/`gpt-`). Nếu một secret lọt vào một dòng log, hook audit được kích hoạt và buộc phải xoay vòng key.

```java
// infrastructure/audit/SecretRedactingFilter.java
public class SecretRedactingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) {
        // Bọc response/request để che các pattern key trước khi log
        chain.doFilter(req, res);
    }
}
```

5. **Audit mọi quyết định.** Mỗi intake ghi một dòng audit bất biến: `eventId`, verdict, mọi reason code, nhà cung cấp mô hình + phiên bản mô hình + phiên bản prompt, điểm tin cậy, và một correlation ID. `LlmJudgePort.score()` chỉ mang tính tư vấn, nên mọi output của nó đều được audit kèm đúng phiên bản prompt đã sinh ra nó — bạn phải tái hiện được *bất kỳ* quyết định nào mà cơ quan quản lý hỏi, kể cả output nguyên văn của mô hình.

## Các chế độ hỏng chúng tôi thực sự gặp phải

- **Outage của nhà cung cấp trong đợt onboarding tăng đột biến.** Không có circuit breaker, 1000 thread chờ một upstream timeout 60s và làm cạn kiệt pool. Có breaker, nó ngắt ở mức 50% lỗi trong cửa sổ 20 lần gọi và intake rơi về `MANUAL_REVIEW` với reason code `PROVIDER_UNAVAILABLE`.
- **LLM "bịa" một số tài liệu.** Ảnh sạch mà prompt bẩn cho ra một giá trị sai nhưng tự tin. Cách sửa: cổng `LOW_CONFIDENCE_CRITICAL_FIELDS` giờ chuyển mọi kết quả dưới 0.90 trên ba trường quan trọng sang manual review, và độ tin cậy từng trường được audit.
- **Upload trùng từ mobile retry.** Client mobile retry khi mạng chập chờn; không có idempotency, chúng tôi đã ghi hai decision. `exists(eventId)` loại bỏ cái thứ hai, và OpenSearch upsert theo id giữ đúng một dòng duy nhất.
- **Secret lọt vào một dòng log.** Một dev debug-log DTO request thô, trong đó có header chứa key nhà cung cấp. Bộ lọc che + một unit test nạp secret giả qua logger giờ đã ngăn được việc này tái diễn.

## Observability và tuân thủ

- Mọi decision được index trong OpenSearch tại `decision-v1` với chính sách lưu trữ 7 năm để tuân thủ.
- Dashboard: `intake_*_total`, `intake_*_p95_latency_ms`, `llm_provider_failures_total`, `llm_token_usage_total`, `manual_review_queue_depth`.
- Metric Prometheus được xuất ra từ chính các lời gọi `DecisionEngine`, gắn tag theo verdict và reason code.
- Trace ID lan truyền từ header Kafka tới document OpenSearch, để một lần onboarding có thể được tái dựng end-to-end.

## Lần sau chúng tôi sẽ làm khác gì

1. **Eval harness ngay từ ngày đầu.** Xây dựng một golden-set gồm 1.000 tài liệu được gán nhãn và chạy mọi thay đổi prompt/mô hình qua nó trước khi release. Chúng tôi làm việc này quá muộn; đó là công cụ chất lượng AI có đòn bẩy lớn nhất.
2. **Version hóa catalog prompt** như code — `PromptCatalog.visionExtraction()` trả về prompt có phiên bản, và phiên bản đó được ghi vào dòng audit.
3. **Cost gating.** Cảnh báo token budget theo từng loại tài liệu; với các tài liệu khối lượng lớn, giá trị thấp, nên cho đi qua đường OCR rẻ hơn trước khi dùng vision.
4. **Hàng đợi human-in-the-loop.** `MANUAL_REVIEW` không phải ngõ cụt; nó là một work queue có SLA, được cấp dữ liệu từ chính OpenSearch store.

## Bài học rút ra

Một feature AI lên production trong fintech không phải là "gọi mô hình, lưu câu trả lời". Nó là một pipeline xác định, trong đó mô hình là một *cảm biến được canh gác kỹ* nuôi một rule engine sở hữu quyết định, một event stream sở hữu trạng thái, và một dấu vết audit sở hữu sự thật. Ports hexagonal giữ AI có thể thay thế được; idempotency giữ retry an toàn; circuit breaker khiến các outage nhà cung cấp trở nên nhàm chán; và rule engine cứng giữ luật có thẩm quyền.

AI đã giảm ~70% công sức manual review trên các tài liệu sạch và khiến các review còn lại nhanh hơn, có căn cứ hơn. Nó chưa bao giờ — dù chỉ một lần — tự mình ra quyết định.

Repo: <https://github.com/finpay-lab/identity-service>
