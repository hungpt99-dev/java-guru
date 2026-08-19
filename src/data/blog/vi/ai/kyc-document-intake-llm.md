---
title: "Thiết kế pipeline tiếp nhận tài liệu KYC bằng Vision LLM"
description: "Thiết kế thực tế để trích xuất trường KYC từ giấy tờ định danh, kiểm tra bằng các rule xác định và chuyển các trường hợp không chắc chắn sang người duyệt."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/identity-service>


Tiếp nhận giấy tờ KYC (Know Your Customer) chỉ có vẻ đơn giản cho đến khi hệ thống phải xử lý ảnh kém chất lượng, nhiều định dạng giấy tờ, sự kiện gửi trùng, lỗi từ nhà cung cấp và yêu cầu audit. Vision language model (VLM, mô hình ngôn ngữ có khả năng xử lý hình ảnh) có thể hỗ trợ trích xuất trường dữ liệu, nhưng không nên là hệ thống lưu trữ chuẩn hay bên tự quyết định cuối cùng.

Bài viết trình bày một thiết kế ưu tiên ranh giới cho feature `kyc-document-intake-llm`: chuẩn hóa file tải lên thành domain command, trích xuất các trường có cấu trúc, áp dụng các kiểm tra xác định, chỉ dùng LLM cho những câu hỏi cần đánh giá và chuyển kết quả không chắc chắn sang người duyệt. Bài viết cũng đối chiếu thiết kế này với một cách triển khai synchronous phổ biến và giải thích các failure mode cần xử lý rõ ràng.

Code và package tree dưới đây mang tính minh họa. Chúng mô tả các ranh giới dự kiến, không phải bằng chứng về một provider, model hay sự cố production cụ thể.

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

**[SOURCE FACT]** Thiết kế được cung cấp sử dụng `DocumentUploaded` trên Kafka, một S3 key và `eventId`, một vision extraction port, các trường có cấu trúc kèm confidence, một fraud check dựa trên rule, một LLM judge, outbox, Kafka và OpenSearch.

**[PROPOSED DESIGN]** Trình tự xử lý:

1. Kafka chuyển `DocumentUploaded`. Event nên chứa một object reference, chẳng hạn S3 key, cùng `eventId`; consumer không nên phụ thuộc vào kiểu multipart của web.
2. Adapter ánh xạ event thành `IntakeCommand` và `DocumentSnapshot`.
3. Vision adapter gửi tài liệu tới multimodal model và trả về một kết quả có kiểu rõ ràng. Kết quả gồm giá trị các trường, confidence, metadata của provider và trạng thái extraction cụ thể, thay vì văn xuôi tự do.
4. Rule engine xác định kiểm tra các ràng buộc như loại giấy tờ được phép, checksum có nhất quán hay không và giấy tờ đã hết hạn chưa. Các kiểm tra này vẫn là application code thông thường.
5. LLM judge có thể trả lời câu hỏi mở, chẳng hạn người trong ảnh selfie có vẻ khớp với người trên giấy tờ hay không. Kết quả chỉ là bằng chứng, không phải quyết định phê duyệt. Lưu kết quả và rationale cần cho việc review, tuân theo chính sách bảo mật của ứng dụng.
6. Decision được lưu và event được phát hành qua outbox. OpenSearch có thể phục vụ việc truy xuất và tìm kiếm; không nên coi nó là nguồn dữ liệu bền vững duy nhất nếu đó chưa phải quyết định rõ ràng về storage.

## Ranh giới hexagonal

**[SOURCE FACT]** Package layout được cung cấp đặt domain code dưới `domain/` và các integration dưới `infrastructure/`:

```text
src/main/java/com/finpay/identity/kyc/
├── domain/                      # Java thuần, không import Spring hoặc SDK
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
└── infrastructure/              # adapter cho Spring, Kafka, OpenSearch và SDK
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

**[ANALYSIS]** Không đưa provider SDK vào domain giúp application có một contract ổn định cho extraction và judgment. Decision engine cũng có thể được test mà không cần gọi network. Provider, prompt, token limit, timeout, retry và response parsing nên nằm trong adapter hoặc application service, không nằm trong controller.

Không nên khẳng định một provider có thể được thay thế trong một khoảng thời gian cụ thể, hoặc một thay đổi về giá đã dẫn đến một migration cụ thể, nếu không có tài liệu chứng minh. Lợi ích của kiến trúc là giảm phạm vi thay đổi, không phải bảo đảm một lịch migration nhất định.

## Phiên bản synchronous đơn giản

Ví dụ rút gọn này chỉ mang tính minh họa. Nó cho thấy sự kết dính mà thiết kế đề xuất cần tránh.

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

**[ANALYSIS]** Phiên bản này có nhiều vấn đề độc lập:

1. Controller sở hữu provider SDK, request format, parsing, persistence và decision logic. Như vậy HTTP boundary cũng trở thành integration boundary, khiến việc thay provider tốn kém hơn.
2. Request chạy synchronous. Provider chậm sẽ giữ HTTP worker và có thể giữ cả database connection. Khi tải tăng, connection pool hoặc thread pool có thể cạn trước khi provider phục hồi.
3. Không có idempotency key hoặc inbox record. Kafka redelivery hay client retry có thể gọi extraction và persistence thêm lần nữa.
4. JSON blob không cung cấp schema ổn định cho việc query, validation hay audit. Raw provider output vẫn có thể hữu ích, nhưng nên được lưu cùng normalized fields và metadata, với access control cho dữ liệu nhạy cảm.
5. Chỉ kiểm tra hai trường có tồn tại không phải là approval policy. Cách này bỏ qua document validity, expiry, fraud signal, confidence threshold và human review.
6. Ví dụ giả định response luôn thành công và JSON luôn đúng shape. Nó không có timeout, retry policy, fallback, circuit breaker, giới hạn kích thước, kiểm tra content type hay xử lý output malformed.

## Application flow an toàn hơn

**[PROPOSED DESIGN]** Giữ use case độc lập với HTTP và kiểu dữ liệu của provider:

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

Transaction bao quanh các database write cần được thiết kế để việc đánh dấu event đã xử lý và append outbox record là atomic. Publish lên Kafka diễn ra sau commit và phải chịu được retry. Các consumer của `DecisionEvent` cũng phải idempotent.

## Xử lý failure

**[ANALYSIS]** Model call là một external dependency. Hãy xử lý nó như vậy:

- Đặt timeout phù hợp với asynchronous worker, không lấy timeout của interactive HTTP request làm mặc định.
- Chỉ retry các lỗi tạm thời, dùng bounded exponential backoff và chính sách giới hạn số lần thử. Không retry validation error hoặc refusal như thể đó là lỗi network.
- Dùng circuit breaker để ngừng gửi request trong lúc provider đang lỗi.
- Dùng fallback state như `MANUAL_REVIEW` hoặc `EXTRACTION_UNAVAILABLE`; không biến việc model không khả dụng thành approval.
- Áp dụng backpressure (giới hạn tốc độ nhận việc khi downstream quá tải) ở consumer hoặc queue boundary.
- Giới hạn document size, image dimension và prompt payload trước khi gọi provider.
- Ghi correlation ID, `eventId`, provider request ID nếu có, model configuration, extraction status và decision version. Mặc định không log image của giấy tờ hoặc raw personally identifiable information.

Confidence không phải là xác suất có ý nghĩa thống nhất trong mọi model. Threshold là một policy decision và cần được calibration bằng các case đã review. Nếu chưa có threshold được kiểm chứng, hãy chuyển case sang review thay vì trình bày một con số như một bảo đảm.

## Data và audit model

**[PROPOSED DESIGN]** Tách các representation theo mục đích sử dụng:

- `DocumentSnapshot`: reference bất biến tới object đã tải lên, content metadata và event identity.
- `StructuredFields`: giá trị đã normalize, confidence theo từng field, extraction status và validation error.
- `RiskAssessment`: kết quả của các rule xác định và version của chúng.
- `JudgeResult`: câu hỏi, model response, confidence hoặc uncertainty signal và provider metadata.
- `Decision`: policy outcome, reason code, review status và decision version.
- Raw provider payload: tùy chọn, phải được mã hóa hoặc kiểm soát quyền truy cập, và chỉ lưu khi policy yêu cầu.

Dùng schema version rõ ràng cho decision và event đã lưu. Audit record phải trả lời được ai hoặc thành phần nào tạo ra từng input, rule nào đã chạy, model configuration nào được dùng và vì sao status cuối cùng được chọn. Redact hoặc tokenize các trường nhạy cảm ở nơi policy audit cho phép.

## LLM không được tự quyết định

LLM không nên là bên duy nhất quyết định identity approval, document validity, sanctions decision hay policy exception. Nó có thể trích xuất giá trị ứng viên và cung cấp bằng chứng bổ sung. Deterministic validation, policy rules và reviewer có thẩm quyền vẫn chịu trách nhiệm cho hướng xử lý cuối cùng.

Đó là ràng buộc thiết kế chính. Abstraction hữu ích không phải là “một API endpoint gọi model”, mà là một workflow tiếp nhận có state rõ ràng, event bền vững, dependency được giới hạn và audit trail.
