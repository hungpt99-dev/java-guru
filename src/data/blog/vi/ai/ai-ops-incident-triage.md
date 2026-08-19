---
title: "Triage sự cố AI Ops bằng cảnh báo và trace"
description: "Cách tầng observability của FinPay chuyển cảnh báo Prometheus và trace OpenTelemetry thành giả thuyết nguyên nhân gốc cùng khuyến nghị runbook có thể kiểm toán."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> Repo: https://github.com/finpay-lab/observability

## Bài toán

Khi một lô quyết toán bị chậm, nhiều triệu chứng có thể xuất hiện cùng lúc: độ trễ tăng, tỷ lệ lỗi thay đổi và các hàng đợi dead-letter đầy lên. Kỹ sư trực ca phải xác định cảnh báo nào thuộc cùng một sự cố, lỗi bắt đầu ở đâu và một phương án xử lý có thể ảnh hưởng đến tiền hay không. Điểm khó không phải là tạo một bản tóm tắt, mà là đưa bản tóm tắt đó vào quy trình vận hành mà không mở thêm đường rủi ro.

**[SOURCE FACT]** Dịch vụ `ai-ops-incident-triage` là tính năng thứ tư trong nền tảng observability của FinPay. Dịch vụ dùng LLM để đọc dữ liệu, đối chiếu tương quan và phân loại bước đầu. Dịch vụ không đưa ra quyết định liên quan đến tiền.

**[ANALYSIS]** Vì vậy, ranh giới phù hợp là ranh giới hẹp: mô hình đề xuất mức độ nghiêm trọng, giả thuyết nguyên nhân gốc và khuyến nghị; code xác định, người phê duyệt và sổ cái chịu trách nhiệm về hành động.

Bài viết trình bày thiết kế Spring Boot, Kafka và OpenSearch, đường đi làm giàu trace và các guardrail quanh LLM. Code được giữ ngắn; phần kiểm soát bao quanh mô hình mới là trọng tâm.

## Ranh giới dịch vụ

**[SOURCE FACT]** Dịch vụ:

1. Tiêu thụ sự kiện cảnh báo và distributed trace đã tương quan từ Kafka.
2. Làm giàu mỗi cảnh báo bằng trace context truy vấn từ OpenSearch.
3. Gửi prompt đã khử dữ liệu nhạy cảm và bị ràng buộc theo schema tới LLM BYOK (bring your own key).
4. Áp dụng idempotency, timeout, retry, circuit breaker, phê duyệt của con người cho thao tác liên quan đến tiền và audit.
5. Xuất bản quyết định triage cùng audit entry lên Kafka rồi OpenSearch.

## Kiến trúc

**[SOURCE FACT]** Dịch vụ dùng kiến trúc hexagonal. Lõi domain phụ thuộc vào port, không phụ thuộc Kafka, Spring AI hay OpenSearch. Các adapter nằm dưới `infrastructure/`.

```
com.finpay.observability
├── domain
│   ├── model        IncidentContext, TriageOutcome, Severity, Recommendation
│   ├── port         IncidentTriagePort, IdempotencyPort, AuditPort, ApprovalPort
│   └── service      TriageOrchestrator (điều phối, không phụ thuộc framework)
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
                                     fallback ──▶ rules engine (không LLM)
                                                          │
                             money recommendation? ──▶ human ApprovalTask
                                                          │
                                   audit ──▶ Kafka("finpay.observability.audit") ──▶ OpenSearch
```

Domain model dùng các record bất biến. Đây là lựa chọn thực tế khi output của model đi qua ranh giới audit: giá trị được ghi không nên thay đổi sau khi audit event được tạo.

## Guardrail

**[PROPOSED DESIGN]** Các kiểm soát sau xác định ranh giới vận hành an toàn:

1. **AI không quyết định việc chuyển tiền.** Model có thể gợi ý hoàn tiền hoặc bồi thường. Con người hoặc rule hoàn toàn xác định phải phê duyệt việc thực thi. Sổ cái, không phải prompt, mới chuyển tiền.
2. **Idempotency theo `eventId`.** Kafka dùng cơ chế giao nhận at-least-once, nên retry, redelivery, replay, rebalance hoặc reset offset có thể xử lý lại một event. Dịch vụ claim `eventId` nguyên tử trong OpenSearch và bỏ qua bản trùng.
3. **Timeout, retry và circuit breaker.** Lời gọi LLM bị giới hạn thời gian, retry với backoff và được bảo vệ bởi circuit breaker. Khi breaker mở, triage chuyển sang rules engine xác định thay vì chặn consumer cảnh báo.
4. **Xử lý khóa BYOK.** Khóa được tiêm lúc runtime qua Kubernetes Secret hoặc Vault. Khóa không hardcode và không ghi log; log chỉ được chứa bản xem trước đã che.
5. **Khả năng kiểm toán.** Triage, fallback, retry và phê duyệt của con người tạo audit entry append-only theo `eventId`, gồm model, model version, trace ID và outcome.

## WRONG và RIGHT

### Secret và BYOK

**WRONG.** Khóa trong constant có thể lọt vào lịch sử source, môi trường phát triển hoặc log; không thể rotate nếu không deployment lại.

```java
// WRONG: secret nằm trong source code, không rotate hoặc masking.
public class OpenAiClient {
    private static final String BYOK_KEY = "<redacted>";
    private static final String MODEL = "gpt-4o";

    public String triage(String prompt) {
        // Đọc khóa từ constant và gửi trong request header.
    }
}
```

**[PROPOSED DESIGN] RIGHT.** Tiêm khóa lúc runtime và chỉ cho phép dạng đã che xuất hiện trong diagnostics.

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
# application.yml: giá trị do runtime environment tiêm vào.
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

**[SOURCE FACT]** Thiết kế nguồn cũng có CI check để quét literal dạng `sk-` và log filter che chuỗi trông giống khóa. Đây là phòng thủ nhiều lớp, không thay thế việc tiêm secret.

### Timeout, retry và circuit breaker

**WRONG.** Lời gọi blocking không có timeout có thể giữ consumer khi provider chậm. Không có retry, circuit breaker hoặc fallback, một lỗi của provider sẽ biến thành lỗi của pipeline.

```java
// WRONG: có thể block vô hạn và không có đường hạ cấp.
HttpResponse<String> r = client.send(request, HttpResponse.BodyHandlers.ofString());
```

**[PROPOSED DESIGN] RIGHT.** Đặt giới hạn thời gian bên trong circuit breaker và retry bên ngoài breaker. Khi LLM không khả dụng, dùng fallback xác định.

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
        // Từ trong ra ngoài: timeout trong breaker, retry quanh breaker.
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

**[ANALYSIS]** Hạ cấp tốt hơn là làm triage phụ thuộc hoàn toàn vào availability của provider. Fallback phải xác định và được audit; nó không nhằm bắt chước model.

### Idempotency theo `eventId`

**WRONG.** Gọi trực tiếp triage từ Kafka listener sẽ xử lý trùng khi cùng event được giao lại.

```java
@KafkaListener(topics = "finpay.observability.alerts")
public void onAlert(AlertEvent event) {
    TriageOutcome outcome = ai.triage(event);
    incidentService.create(outcome);
}
```

**[PROPOSED DESIGN] RIGHT.** Claim ID nguyên tử trước khi enrichment hoặc triage.

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

**[ANALYSIS]** Dùng `eventId` làm document ID của OpenSearch tạo ràng buộc duy nhất phân tán cho claim. Document hoàn tất chặn replay về sau. Nếu consumer dừng giữa chừng, claim cần lease hoặc chính sách khôi phục; claim đang xử lý không có giới hạn sẽ là một failure mode vận hành.

### Khuyến nghị liên quan đến tiền

**WRONG.** Không được để chuỗi trả về từ model trực tiếp cho phép ghi thanh toán.

```java
String decision = llm.complete("Should we refund this failed payment? Reply REFUND or NO_ACTION.");
if ("REFUND".equalsIgnoreCase(decision)) {
    paymentService.refund(event.amount(), event.payerId());
}
```

**[PROPOSED DESIGN] RIGHT.** Dùng recommendation có kiểu và chuyển outcome liên quan đến tiền sang bước phê duyệt.

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

Model là nhà phân tích. Người phê duyệt đưa ra quyết định, còn sổ cái là nguồn sự thật. Không được có đường đi từ output của model tới thao tác ghi thanh toán nếu thiếu approval event trong audit trail.

### Audit mọi quyết định

**WRONG.** Một log line không phải audit trail: nó không bảo đảm giữ lại trace, model version hay ngữ cảnh phê duyệt.

```java
public void triage(AlertEvent event) {
    String d = llm.complete(buildPrompt(event));
    incidentService.create(d);
}
```

**[PROPOSED DESIGN] RIGHT.** Xuất bản entry bất biến, append-only, định danh bằng `eventId`.

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
        String llmTraceId,  // nối cặp prompt/response
        String model,
        String modelVersion,
        TriageOutcome outcome,
        boolean humanApproved) {}
```

Audit record phải cho phép operator dựng lại dữ liệu đã gửi model, output nhận được, version đã dùng và người phê duyệt. Nếu không, đó chỉ là operational log.

## Enrichment trace và khử dữ liệu

**[SOURCE FACT]** `IncidentContext` ghép cảnh báo với các trace tương quan. Trace OpenTelemetry lưu trong OpenSearch giúp xác định lỗi xảy ra ở đâu; cảnh báo mô tả triệu chứng quan sát được từ bên ngoài.

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

**[ANALYSIS]** Khử dữ liệu trước khi tạo prompt. Số thẻ, credential và payload khách hàng không nên đi tới model. Hãy log mask khử dữ liệu, không log payload gốc.

```java
String redact(String raw) {
    return raw.replaceAll("\\d{13,19}", "****")
            .replaceAll("(?i)(password|token)=\\S+", "$1=REDACTED");
}
```

## Ghi chú vận hành

- **`temperature = 0` và JSON Schema.** Parse output nghiêm ngặt. Parse failure được tính là breaker failure và dùng fallback rules.
- **Manual acknowledgement trên consumer.** At-least-once kết hợp với kho claim `eventId` tạo hiệu ứng exactly-once mà không cần Kafka transaction.
- **Audit cả fallback.** Quyết định từ rules dùng `actor = "rules"` và cùng `eventId`.
- **Đo đúng chi phí.** BYOK phân bổ chi phí và capacity của provider cho từng khách hàng. Dịch vụ đo latency cho SLO thay vì số token.

## Kết luận

**[ANALYSIS]** LLM có thể là nhà phân tích bước đầu hữu ích nhưng không nên là thẩm quyền cuối cùng. `ai-ops-incident-triage` giữ ranh giới đó rõ ràng: output có kiểu, fallback xác định, phê duyệt của con người cho khuyến nghị liên quan đến tiền và audit trail quanh mọi quyết định.

> Repo: https://github.com/finpay-lab/observability
