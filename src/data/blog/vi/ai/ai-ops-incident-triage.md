---
title: "AI Ops: Turning Alerts and Traces into Root-Cause Hypotheses"
description: "Tầng observability của FinPay sử dụng LLM để tóm tắt các cảnh báo Prometheus và trace OpenTelemetry thành giả thuyết về nguyên nhân gốc, kèm liên kết đến runbook."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> Repo: https://github.com/finpay-lab/observability

## Bài toán chiếc pager lúc 3 giờ sáng

FinPay xử lý các giao dịch thanh toán. Khi một lô quyết toán bị chậm, hàng trăm cảnh báo có thể bùng lên chỉ trong vài phút: độ trễ tăng vọt, tỷ lệ lỗi lao dốc và các hàng đợi dead-letter đầy lên. Đến khi kỹ sư trực ca lần qua được mớ nhiễu đó, sự cố *thật sự* — vấn đề mà chỉ một phần nhỏ trong số các cảnh báo kia thực sự phản ánh — đã tiêu tốn ngân sách SLO từ lâu.

Chúng tôi xây dựng **ai-ops-incident-triage**, tính năng thứ tư trong nền tảng observability của mình, để trả lời một câu hỏi sớm nhất có thể: *"Đây là một sự cố hay nhiều sự cố? Điều gì đã hỏng, và sự cố có liên quan đến tiền không?"* AI đảm nhiệm việc đọc dữ liệu, đối chiếu tương quan và phân loại bước đầu. Nó **không bao giờ** đưa ra quyết định liên quan đến tiền.

Bài viết này trình bày toàn bộ thiết kế: kiến trúc, cách kết nối Spring Boot + Kafka + OpenSearch và các đoạn code WRONG → RIGHT được viết trong quá trình xây dựng, cùng năm rào chắn an toàn (guardrails) giúp LLM vận hành an toàn bên trong hệ thống kiểm soát tài chính.

> Repo: https://github.com/finpay-lab/observability

## Chúng tôi đã xây dựng gì

`ai-ops-incident-triage` là một dịch vụ Spring Boot có nhiệm vụ:

1. Tiêu thụ các sự kiện cảnh báo và các trace đã được tương quan từ Kafka.
2. Làm giàu mỗi cảnh báo bằng ngữ cảnh trace của nó (truy vấn từ OpenSearch).
3. Gửi một prompt đã khử dữ liệu nhạy cảm (redacted) và được ràng buộc theo schema tới LLM BYOK để nhận mức độ nghiêm trọng, nguyên nhân gốc và khuyến nghị.
4. Áp dụng các rào chắn an toàn (idempotency, timeout, retry, circuit breaker, phê duyệt của con người đối với các thao tác liên quan đến tiền và kiểm toán đầy đủ).
5. Xuất bản quyết định triage và bản ghi kiểm toán lên Kafka → OpenSearch.

## Bản đồ kiến trúc

Dịch vụ tuân theo kiến trúc hexagonal. Lõi domain không biết gì về Kafka, Spring AI hay OpenSearch; nó chỉ biết các cổng (ports). Các bộ điều hợp (adapters) nằm trong `infrastructure/`:

```
com.finpay.observability
├── domain
│   ├── model        IncidentContext, TriageOutcome, Severity, Recommendation
│   ├── port         IncidentTriagePort, IdempotencyPort, AuditPort, ApprovalPort
│   └── service      TriageOrchestrator (điều phối thuần túy, không phụ thuộc framework)
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
                                     fallback ──▶ rules engine (không LLM)
                                                          │
                             khuyến nghị chạm tiền? ──▶ ApprovalTask (con người)
                                                          │
                                   audit ──▶ Kafka("finpay.observability.audit") ──▶ OpenSearch
                        └───────────────────────────────────────────┘
```

Mô hình domain gồm những record bất biến, cố ý đơn giản — chính xác là thứ bạn cần khi đầu ra của LLM phải đi qua một vết kiểm toán.

## Năm rào chắn an toàn

Đây không phải những chi tiết trang trí tùy chọn. Đây là các nguyên tắc cho phép chúng tôi vận hành LLM bên trong một công ty thanh toán.

1. **AI không phải người quyết định tiền.** Mô hình có thể *gợi ý* hoàn tiền hoặc bồi thường; chỉ con người (hoặc một quy tắc hoàn toàn xác định) mới được phép thực hiện. Sổ cái, không phải prompt, mới là nơi quyết định việc chuyển tiền.
2. **Idempotent theo `eventId`.** Mọi lần retry, redelivery hoặc replay phải cho ra cùng một kết quả. Chúng tôi claim `eventId` một cách nguyên tử trong OpenSearch; các lần xử lý trùng lặp sẽ bị bỏ qua.
3. **Timeout, retry, circuit breaker.** Lời gọi LLM được giới hạn thời gian, retry với backoff và bảo vệ bằng circuit breaker. Khi breaker mở, hệ thống chuyển sang một rule engine xác định thay vì làm triage thất bại hoặc, tệ hơn, chặn đường ống cảnh báo.
4. **Khóa BYOK, không hardcode, không ghi log.** Khóa của khách hàng được tiêm lúc runtime qua Kubernetes Secret/Vault, và chuỗi duy nhất có dạng khóa được phép xuất hiện trong log là bản xem trước đã che.
5. **Kiểm toán mọi quyết định.** Mỗi lần triage, fallback, retry và phê duyệt của con người đều tạo ra một bản ghi kiểm toán append-only, được định danh bằng `eventId` và chứa chính xác model, phiên bản, trace ID cùng kết quả.

## WRONG rồi RIGHT

### 1. Bí mật & BYOK

**WRONG.** Khóa nằm trong một hằng số, nên sẽ xuất hiện trong lịch sử git, IDE và các bản dump log. Không thể xoay vòng (rotate) khóa nếu không triển khai lại.

```java
// WRONG — khóa nằm trong code, nên nằm trong lịch sử git và IDE của mọi người.
public class OpenAiClient {
    private static final String BYOK_KEY = "«redacted:sk-…»...";
    private static final String MODEL = "gpt-4o";

    public String triage(String prompt) {
        // khóa được đọc từ hằng số, gửi trong header, không bao giờ rotate, không che giấu
    }
}
```

**RIGHT.** Khóa được tiêm lúc runtime và chỉ có thể được in dưới dạng đã che.

```java
// infrastructure/config/LlmProperties.java
@Configuration
@ConfigurationProperties(prefix = "app.llm")
public record LlmProperties(String endpoint, String model, String byokKey) {

    /** Dạng đã che là biểu diễn DUY NHẤT của khóa được phép xuất hiện trong log. */
    public String maskedKey() {
        if (byokKey == null || byokKey.isBlank()) return "<unset>";
        return byokKey.substring(0, 3) + "..." + byokKey.substring(byokKey.length() - 4);
    }
}
```

```yaml
# application.yml — không có khóa ở đây. Được tiêm từ Kubernetes Secret (Vault) lúc runtime.
app:
  llm:
    endpoint: ${LLM_ENDPOINT:https://api.example-llm.com/v1}
    model: ${LLM_MODEL:gpt-4o}
    byok-key: ${LLM_BYOK_KEY}   # không bao giờ commit, không bao giờ in ra
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
                        .temperature(0.0)   // triage phải xác định nhất có thể
                        .responseFormat(new ResponseFormat(ResponseFormat.Type.JSON_SCHEMA))
                        .build())
                .build();
    }
}
```

Chúng tôi cũng có bước kiểm tra CI để quét module tìm các literal dạng `sk-`, cùng một log filter che mọi thứ *trông giống* một khóa — tạo thành cơ chế phòng thủ nhiều lớp.

### 2. Timeout, retry, circuit breaker

**WRONG.** Một lời gọi chặn không có timeout có thể khiến một provider chậm treo consumer, làm cạn vòng poll Kafka và khiến mọi cảnh báo phía sau bị đình trệ. Không retry, không breaker, không fallback.

```java
// WRONG — chặn vô thời hạn, điểm lỗi đơn lẻ, không có đường hạ cấp.
HttpResponse<String> r = client.send(request, HttpResponse.BodyHandlers.ofString());
```

**RIGHT.** Lời gọi được giới hạn thời gian, retry với backoff, bảo vệ bằng circuit breaker và có fallback xác định.

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
        // trong -> ngoài: timebox bên trong breaker, retry bọc quanh breaker.
        return retry.executeSupplier(() ->
                circuitBreaker.executeSupplier(() -> timeBoxed(ctx)));
    }

    private TriageOutcome timeBoxed(IncidentContext ctx) {
        try {
            return timeLimiter.executeFutureSupplier(
                    () -> CompletableFuture.supplyAsync(() -> callLlm(ctx)));
        } catch (Exception e) {
            // TimeoutException, lỗi provider -> được breaker tính -> retry.
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

Khi breaker mở (hoặc LLM không khả dụng), orchestrator chuyển sang phương án hạ cấp thay vì thất bại:

```java
// domain/service/TriageOrchestrator.java
public TriageOutcome triage(IncidentContext ctx) {
    TriageOutcome outcome;
    try {
        outcome = triagePort.triage(ctx);
    } catch (TriageUnavailableException ex) {
        log.warn("LLM unavailable, using rules for eventId={}: {}", ctx.eventId(), ex.getMessage());
        outcome = ruleEnginePort.triage(ctx)      // xác định, không LLM, vẫn idempotent
                .withSource(TriageSource.RULES);
    }
    return outcome;
}
```

Hạ cấp còn tốt hơn thất bại. Triage cảnh báo giữa lúc provider ngừng hoạt động chính là lúc bạn cần fallback nhất.

### 3. Idempotent theo `eventId`

**WRONG.** Consumer không có bộ nhớ. Kafka cung cấp cơ chế giao nhận at-least-once: bất kỳ lần retry, rebalance hoặc reset offset thủ công nào cũng có thể phát lại cảnh báo, tạo ra sự cố, trang pager và quyết định trùng lặp.

```java
// WRONG — một lần giao lại là nhân đôi sự cố và nhân đôi trang pager.
@KafkaListener(topics = "finpay.observability.alerts")
public void onAlert(AlertEvent event) {
    TriageOutcome outcome = ai.triage(event);   // cùng eventId -> triage lần hai
    incidentService.create(outcome);            // sự cố trùng, trang báo trùng
}
```

**RIGHT.** Mỗi sự kiện được claim nguyên tử bằng `eventId` trong OpenSearch trước khi bắt đầu xử lý. Sự kiện bị phát lại sẽ bị bỏ qua.

```java
// domain/port/IdempotencyPort.java
public interface IdempotencyPort {
    /** Claim nguyên tử; trả false nếu eventId đã được xử lý hoặc đang xử lý dở. */
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
                    .id(eventId)                 // _id = eventId => ràng buộc duy nhất
                    .opType(OpType.Create));     // Create sẽ lỗi nếu doc đã tồn tại
            return true;
        } catch (ResourceAlreadyExistsException ex) {
            return false;                        // trùng lặp hoặc đang dở -> bỏ qua
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
        IncidentContext ctx = enrich(event);           // ghép nối trace từ OpenSearch
        TriageOutcome outcome = orchestrator.triage(ctx);
        idempotency.complete(eventId, outcome);
        auditPort.record(AuditEntry.processed(eventId, outcome));
    }
}
```

`_id = eventId` chính là điểm mấu chốt: OpenSearch cung cấp cho chúng tôi một claim nguyên tử, phân tán và an toàn trước replay mà không cần thêm cơ chế phối hợp. Dù consumer có dừng giữa chừng, claim đang xử lý sẽ chặn bản trùng lặp cho đến khi lease hết hạn, còn document đã hoàn tất sẽ chặn nó vĩnh viễn.

### 4. AI không phải người quyết định tiền

**WRONG.** Mô hình di chuyển tiền chỉ bằng cách nói ra một từ. Không có con người, không hạn mức, không kiểm toán — chỉ một prompt.

```java
// WRONG — một từ từ mô hình cho phép hoàn tiền. Không có gì khác được tham vấn.
String decision = llm.complete("Should we refund this failed payment? Reply REFUND or NO_ACTION.");
if ("REFUND".equalsIgnoreCase(decision)) {
    paymentService.refund(event.amount(), event.payerId());   // tiền bị di chuyển bởi một prompt
}
```

**RIGHT.** Khuyến nghị là một giá trị hạng nhất, có kiểu và có thể kiểm toán; orchestrator xem mọi đề xuất liên quan đến tiền là "cần con người phê duyệt."

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
        // Rào chắn: sổ cái quyết định, không phải mô hình.
        approvalPort.open(ApprovalTask.create(ctx.eventId(), outcome));
        outcome = outcome.withStatus(Status.AWAITING_HUMAN_APPROVAL);
    }
    auditPort.record(AuditEntry.decided(ctx.eventId(), outcome, outcome.recommendation().touchesMoney()));
    return outcome;
}
```

LLM có nhiệm vụ làm một nhà phân tích nhanh nhạy và tinh ý. Con người có nhiệm vụ đưa ra quyết định, còn sổ cái là nguồn sự thật. Chúng tôi không bao giờ tạo ra đường đi để đầu ra của mô hình dẫn tới thao tác ghi thanh toán nếu không có sự kiện phê duyệt trong vết kiểm toán.

### 5. Kiểm toán mọi quyết định

**WRONG.** Quyết định diễn ra trong khoảng không. Khi cơ quan quản lý hoặc khách hàng hỏi "Tại sao chuyện này xảy ra?", không có câu trả lời, trace hay phiên bản mô hình.

```java
// WRONG — quyết định vô hình. Không trace, không phiên bản mô hình, không kiểm toán.
public void triage(AlertEvent event) {
    String d = llm.complete(buildPrompt(event));
    incidentService.create(d);      // biến mất ngay khi log xoay vòng
}
```

**RIGHT.** Mọi quyết định đều là một bản ghi kiểm toán append-only được định danh bằng `eventId`, xuất bản lên Kafka và ghi vào OpenSearch.

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
        // Append-only, bất biến. Đổ vào OpenSearch + lưu trữ S3 qua ILM.
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
        String llmTraceId,       // nối đúng cặp prompt/response
        String model,
        String modelVersion,
        TriageOutcome outcome,
        boolean humanApproved) {}
```

Nếu với một `eventId` cụ thể, bạn không thể dựng lại *mô hình đã được hỏi gì, đã trả lời gì, sử dụng phiên bản nào và ai đã phê duyệt*, thì bạn không có vết kiểm toán; bạn chỉ có hy vọng.

## Bước làm giàu trace

`IncidentContext` được xây dựng bằng cách ghép cảnh báo với các trace tương quan. Trace (thông qua OpenTelemetry → OpenSearch) cho mô hình biết lỗi *xảy ra ở đâu*; cảnh báo cho biết *điều gì có thể quan sát được từ bên ngoài*.

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

Một cảnh báo quan trọng dành cho kỹ sư senior: **hãy khử dữ liệu nhạy cảm trước khi tạo prompt.** Số thẻ, thông tin xác thực và payload của khách hàng không bao giờ được gửi đến mô hình. Chúng tôi loại bỏ PII và dữ liệu thanh toán trước khi serialize `IncidentContext`, đồng thời log mặt nạ khử dữ liệu thay vì payload.

```java
String redact(String raw) {
    return raw.replaceAll("\\d{13,19}", "****")        // PAN
              .replaceAll("(?i)(password|token)=\\S+", "$1=REDACTED");
}
```

## Ghi chú vận hành

- **`temperature = 0` + JSON schema.** Đầu ra triage được parse nghiêm ngặt; lỗi parse được tính là lỗi của breaker và kích hoạt fallback sang rules. Chúng tôi không bao giờ để mô hình tự nghĩ ra tên trường.
- **Ack thủ công trên consumer.** Cơ chế giao nhận at-least-once kết hợp với kho claim `eventId` tạo ra hiệu ứng exactly-once *trên thực tế* mà không cần Kafka transaction.
- **Mọi fallback cũng được kiểm toán.** Một lần triage bằng rule engine có `actor = "rules"` và cùng `eventId`; vết kiểm toán phải kể trọn câu chuyện.
- **Chi phí là một tính năng.** BYOK nghĩa là mỗi khách hàng tự chi trả và quản lý mức sử dụng cùng năng lực của mình; để phục vụ SLO, chúng tôi đo độ trễ chứ không đo token.

## Kết luận

LLM là một người phản hồi đầu tiên tuyệt vời nhưng là một thẩm quyền cuối cùng tồi tệ. **ai-ops-incident-triage** đối xử với nó đúng như vậy: phân tích nhanh, khuyến nghị có kiểu, rào chắn chặt chẽ và vết kiểm toán đầy đủ. Khi đặt một mô hình bên trong hệ thống kiểm soát tài chính, phần code bao quanh mô hình quan trọng hơn chính mô hình đó.

> Repo: https://github.com/finpay-lab/observability
