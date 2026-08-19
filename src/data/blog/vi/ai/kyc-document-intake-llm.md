---
title: "KYC Document Intake with Vision LLMs"
description: "Cách identity-service của FinPay trích xuất các trường KYC từ giấy tờ định danh được tải lên bằng vision LLM và chuyển chúng sang duyệt thủ công thay vì tự động phê duyệt."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/identity-service>

# AI-6: Tiếp nhận tài liệu KYC bằng Vision và LLM

KYC (Know Your Customer) là pipeline có khối lượng xử lý lớn nhất và rủi ro cao nhất trong bất kỳ fintech nào. Mỗi thẻ căn cước bị đọc sai, mỗi ảnh chân dung bị xếp nhầm, hay mỗi hộ chiếu hợp lệ bị từ chối oan đều có thể dẫn đến một khoản phạt tuân thủ hoặc làm mất một khách hàng. Feature `kyc-document-intake-llm` của `identity-service` là cổng AI biến dữ liệu byte thô của tài liệu thành một yêu cầu xác minh có cấu trúc, có thể kiểm toán và sẵn sàng cho việc ra quyết định.

Đây là bài viết đi sâu ở **cấp kỹ sư senior**, với kiến trúc thực tế, các chế độ hỏng thực tế và code đã thực sự được đưa lên production (rồi được sửa). Tôi sẽ trình bày cách WRONG trước, vì đó là cách mọi tích hợp AI đầu tiên thường được xây dựng: một lần gọi HTTP nằm trong transaction, một blob JSON thô trong DB và coi mô hình là phán quyết cuối cùng. Sau đó là cách RIGHT: hexagonal, hướng sự kiện, idempotent và có các cơ chế bảo vệ.

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

1. **Kafka** chuyển `DocumentUploaded` (không phụ thuộc nhà cung cấp, chứa S3 key và `eventId`).
2. Một **domain command** chuẩn hóa sự kiện này; không có `MultipartFile` nào lọt qua lớp adapter.
3. Một **Vision port** gửi ảnh tới mô hình đa phương thức và trả về các trường có cấu trúc **kèm điểm tin cậy**, không phải văn xuôi.
4. Một **rule engine** (Java thuần, zero AI) kiểm tra các luật cứng: loại tài liệu có được phép hay không, checksum có khớp hay không và tài liệu đã hết hạn hay chưa.
5. Một **LLM judge** chấm điểm các câu hỏi mở: "người có tên trên ảnh chân dung và trên giấy tờ tùy thân có phải là cùng một người không?" Nó luôn **không có thẩm quyền quyết định** và luôn được ghi log.
6. Một **Decision** được tạo ra, lưu vào OpenSearch để truy vấn và tìm kiếm, rồi được phát hành qua outbox pattern.

## Kiến trúc: hexagonal, ngay từ commit đầu tiên

Feature này nằm trong monolith dạng mô-đun của `identity-service`. Package KYC tuân thủ nghiêm ngặt mô hình ports-and-adapters:

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

Đây là thứ các đội ngũ có thiện chí thường đưa lên production. Lớp web gọi thẳng mô hình bên trong transaction và tin tuyệt đối vào output. Mỗi sai lầm dưới đây đều là một sự cố có thật mà chúng tôi (và các fintech sử dụng AI khác) từng gặp.

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

1. **SDK của nhà cung cấp chi phối lớp web.** Đặt `OpenAiClient` trong controller nghĩa là transport, serialization, retry policy và tên mô hình đều bị gắn chặt với HTTP. Bạn không thể unit test `intake()` mà không mock SDK bên thứ ba, cũng không thể đổi nhà cung cấp.
2. **HTTP timeout giờ chính là độ trễ của mô hình.** Mô hình có thể mất 10–60 giây khi quá tải. Thread pool của servlet và kết nối DB trong transaction bị giữ lại. Một lần nhà cung cấp gặp sự cố có thể làm cạn kiệt toàn bộ connection pool và khiến cả `identity-service` sập.
3. **Không có idempotency.** Client retry thao tác upload, còn bạn insert hai lần. Kết quả là decision, rủi ro và các dòng audit đều bị nhân đôi.
4. **JSON thô trong DB.** `SELECT ... WHERE data->>'docNumber'` yêu cầu full scan. Không có index, không có OpenSearch và không có chiến lược lưu trữ. Không ai trả lời được câu hỏi "tháng trước chúng ta đã duyệt bao nhiêu hộ chiếu hết hạn?" nếu không chạy script.
5. **Không có guardrail.** Không có ngưỡng tin cậy, rule bổ sung cho mô hình, retry, circuit breaker hay audit. Mô hình vừa là bồi thẩm đoàn vừa là thẩm phán, và là thứ duy nhất đứng giữa bạn và một khoản phạt.

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

Hãy chú ý những thứ **không có** trong domain: không `OpenAiClient`, không `Map<String,Object>` và không `String json`. Domain chỉ làm việc với record và enum. Output của AI chỉ là *một* tín hiệu đầu vào cho một decision engine xác định.

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

Adapter của nhà cung cấp nằm trong `infrastructure/openai/`. Nó quản lý tên mô hình, phiên bản prompt, chính sách retry và token budget:

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

### Driving service: xác định, idempotent và có cơ chế bảo vệ

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

### Engine xác định — đây mới là thành phần quyết định tiền

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

Consumer trong `infrastructure/kafka/` rất mỏng. Nó ánh xạ event trên wire thành domain command rồi gọi use case. Không có logic nghiệp vụ nào nằm ở đây.

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

Các decision event được phát hành qua **outbox pattern**, để việc ghi DB và publish lên Kafka là nguyên tử. OpenSearch được nạp dữ liệu từ chính event stream đó để phục vụ tìm kiếm và báo cáo:

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

`DecisionDocument` là projection có thể tìm kiếm, gồm verdict, reason codes, timestamps và PII đã được che. Projection này được index để phục vụ dashboard nhanh và các truy vấn tuân thủ.

## Guardrails: không thể thương lượng

Tất cả những điều này đều là yêu cầu bắt buộc trong production, và từng điều đều hiện diện trong code RIGHT ở trên:

1. **AI không phải là thành phần quyết định tiền.** Mô hình đóng góp các *tín hiệu* (trường có cấu trúc và một điểm số). Verdict cuối cùng luôn đến từ `DecisionEngine` xác định, nơi áp dụng các rule cứng. Một LLM không thể nói "không" khi phát hiện sanction hit; một rule thì có thể. *AI giảm công việc; luật quyết định.*
2. **Idempotent theo `eventId`.** `eventId` đi từ Kafka envelope, qua command, tới key của `DecisionStorePort`. `decisionStore.exists(eventId)` đảm bảo replay và retry cho cùng một kết quả. Upload trùng bị loại bỏ thay vì bị ra quyết định hai lần.
3. **Timeout, retry, circuit breaker.** Các adapter của nhà cung cấp dùng timeout có giới hạn (vision: 15 giây; judge: 5 giây), một lần retry có jitter và một circuit breaker ngắt khi lỗi lặp lại. Nhờ đó, khi nhà cung cấp gặp sự cố, intake chuyển sang `MANUAL_REVIEW` thay vì chặn toàn bộ service.

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

4. **BYOK — không bao giờ hardcode, không bao giờ log key.** Key của nhà cung cấp đến từ KMS secret manager và được inject dưới dạng secret lấy từ biến môi trường lúc deploy. Bộ lọc log che mọi header `Authorization` và mọi chuỗi có vẻ là secret (`sk-`/`ai21`/`gpt-`). Nếu một secret lọt vào dòng log, audit hook sẽ được kích hoạt và buộc phải xoay vòng key.

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

5. **Audit mọi quyết định.** Mỗi intake ghi một dòng audit bất biến gồm `eventId`, verdict, mọi reason code, nhà cung cấp mô hình, phiên bản mô hình, phiên bản prompt, điểm tin cậy và correlation ID. `LlmJudgePort.score()` chỉ mang tính tư vấn, nên mọi output của nó đều được audit kèm đúng phiên bản prompt đã tạo ra output đó. Bạn phải có khả năng tái hiện *bất kỳ* quyết định nào mà cơ quan quản lý yêu cầu, kể cả output nguyên văn của mô hình.

## Các chế độ hỏng chúng tôi thực sự gặp phải

- **Nhà cung cấp gặp sự cố trong đợt onboarding tăng đột biến.** Không có circuit breaker, 1000 thread phải chờ upstream timeout 60 giây và làm cạn kiệt pool. Khi có breaker, nó ngắt ở mức tỷ lệ lỗi 50% trong cửa sổ 20 lần gọi, và intake chuyển về `MANUAL_REVIEW` với reason code `PROVIDER_UNAVAILABLE`.
- **LLM "bịa" ra số tài liệu.** Một ảnh rõ kết hợp với prompt được thiết kế kém đã tạo ra một giá trị sai nhưng có độ tự tin cao. Cách sửa: cổng `LOW_CONFIDENCE_CRITICAL_FIELDS` hiện chuyển mọi kết quả dưới 0.90 ở ba trường quan trọng sang manual review, đồng thời audit độ tin cậy ở cấp trường.
- **Upload trùng do mobile retry.** Client mobile retry sau khi mạng chập chờn; nếu không có idempotency, chúng tôi đã ghi hai decision. `exists(eventId)` loại bỏ decision thứ hai, còn OpenSearch upsert theo ID giữ lại một dòng chuẩn duy nhất.
- **Secret lọt vào dòng log.** Một developer debug-log DTO request thô, trong đó có header chứa key của nhà cung cấp. Bộ lọc che secret cùng với unit test đưa secret giả qua logger hiện đã ngăn việc này tái diễn.

## Observability và tuân thủ

- Mọi decision được index trong OpenSearch tại `decision-v1` với chính sách lưu trữ 7 năm nhằm đáp ứng yêu cầu tuân thủ.
- Dashboard theo dõi `intake_*_total`, `intake_*_p95_latency_ms`, `llm_provider_failures_total`, `llm_token_usage_total` và `manual_review_queue_depth`.
- Metric Prometheus được xuất từ chính các lời gọi `DecisionEngine` và gắn tag theo verdict và reason code.
- Trace ID được truyền từ header Kafka tới document OpenSearch, để một lần onboarding có thể được tái dựng end-to-end.

## Lần sau chúng tôi sẽ làm khác gì

1. **Eval harness ngay từ ngày đầu.** Xây dựng một golden set gồm 1.000 tài liệu được gán nhãn và chạy mọi thay đổi về prompt hoặc mô hình qua bộ này trước khi release. Chúng tôi đã làm việc này quá muộn; đây là công cụ cải thiện chất lượng AI có đòn bẩy lớn nhất.
2. **Version hóa catalog prompt** như code: `PromptCatalog.visionExtraction()` trả về prompt có phiên bản, và phiên bản đó được ghi vào dòng audit.
3. **Cost gating.** Thiết lập cảnh báo token budget theo từng loại tài liệu; các tài liệu có khối lượng lớn nhưng giá trị thấp nên đi qua đường OCR rẻ hơn trước.
4. **Hàng đợi human-in-the-loop.** `MANUAL_REVIEW` không phải ngõ cụt; đó là một work queue có SLA, được cấp dữ liệu từ chính OpenSearch store.

## Bài học rút ra

Một feature AI trong fintech khi lên production không chỉ là "gọi mô hình, lưu câu trả lời". Đó là một pipeline xác định, trong đó mô hình là một *cảm biến được bảo vệ chặt chẽ*, cung cấp tín hiệu cho rule engine chịu trách nhiệm về quyết định; event stream chịu trách nhiệm về trạng thái; còn audit trail chịu trách nhiệm lưu giữ sự thật. Các port hexagonal giúp AI có thể thay thế; idempotency giúp retry an toàn; circuit breaker khiến sự cố của nhà cung cấp trở nên vô hại; và rule engine cứng bảo đảm luật luôn có thẩm quyền.

AI đã giảm khoảng 70% công sức manual review đối với các tài liệu rõ ràng, đồng thời giúp những lượt review còn lại nhanh hơn và có căn cứ hơn. Nó chưa bao giờ — dù chỉ một lần — tự mình ra quyết định.

Repo: <https://github.com/finpay-lab/identity-service>
