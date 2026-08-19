---
title: "Thiết kế thông báo thanh toán sinh bằng LLM an toàn"
description: "Thiết kế thực tế để dùng LLM viết nội dung thông báo mà không cho phép model thay đổi dữ kiện thanh toán, chặn việc gửi, hoặc làm lộ credential."
pubDatetime: 2026-08-15T10:00:00+07:00
tags:
  - java
  - ai
  - fintech
  - architecture
draft: false
featured: false
---

> Repository: <https://github.com/finpay-lab/notification-service>

## Bài toán

Thông báo thanh toán có hai yêu cầu khác nhau. Nội dung phải nêu đúng giao dịch, đồng thời phải dễ đọc trên SMS, email hoặc push. Template cố định đáng tin cậy nhưng thường tăng nhanh khi yêu cầu của sản phẩm và pháp lý tách ra. LLM có thể thay đổi cách diễn đạt, nhưng tạo ra rủi ro nghiêm trọng hơn: model có thể thay đổi dữ kiện trong lúc cố làm câu chữ tự nhiên.

Bài viết này tách hai trách nhiệm đó. Domain sở hữu các dữ kiện thanh toán đã được kiểm tra và quyết định gửi. LLM chỉ được đề xuất câu chữ. Phần còn lại trình bày idempotency của sự kiện, structured output, timeout và retry, template fallback, khóa provider do tenant cung cấp, cùng audit record.

> **[SOURCE FACT]** Ví dụ được cung cấp sử dụng `notification-service`, một Kafka consumer, Spring Boot, cấu trúc hexagonal, adapter cho LLM, adapter cho OpenSearch và repository ở URL trên. Sơ đồ và code bên dưới mô tả cấu trúc đó; các giá trị cấu hình là ví dụ từ bài gốc, không phải mặc định áp dụng cho mọi hệ thống.

## Bắt đầu từ thiết kế không an toàn

Đưa raw event payload cho model rồi trả về một chuỗi không định kiểu khiến mọi ranh giới quan trọng đều không rõ ràng:

```java
// PROPOSED DESIGN: ví dụ cố ý không an toàn; không đưa vào production
@Service
public class CopyService {
    private final LlmClient llm;

    public String copyFor(NotificationEvent event) {
        String prompt = """
            Write a friendly Vietnamese push notification about this event:
            %s
            """.formatted(event.rawPayload());
        return llm.complete(prompt); // không timeout, retry policy hoặc schema
    }
}
```

Có năm lỗi độc lập:

1. **Không bảo vệ dữ kiện.** Không có gì buộc output giữ nguyên số tiền. Ví dụ nguồn dùng `2,431,876 VND`; đổi thành `2.4M` sẽ làm mất tính chính xác và có thể tạo vấn đề tuân thủ.
2. **Output không có contract.** Push sender có thể cần `{ title, body, tone }`, nhưng method này trả về một chuỗi tùy ý.
3. **Dependency không có chính sách lỗi.** Không có timeout, provider chậm có thể giữ request. Không có retry có giới hạn và circuit breaker (cơ chế tạm dừng gọi dependency đang lỗi), sự suy giảm của provider có thể lan sang việc gửi thông báo.
4. **Model được trao quá nhiều quyền.** Model có thể thêm số tiền phải trả, khoản hoàn tiền hoặc khoản thu không có trong event.
5. **Operation không idempotent.** Xử lý lại một event có thể tạo câu chữ khác và gửi trùng nếu pipeline không có event key ổn định cùng chính sách khử trùng lặp.

Đây là lỗi thiết kế, không phải chỉ là vấn đề viết prompt. Chúng cần được enforce tại các boundary của ứng dụng.

## Kiến trúc đề xuất

```text
                     +-------------------------------------------+
Kafka topic -------->|          notification-service              |
 event.payment       |                                             |
                     |  +-----------+       +------------------+   |
                     |  | domain/   |<----->| infrastructure/  |   |
                     |  | (ports)   |       | (adapters)       |   |
                     |  +-----+-----+       +--------+---------+   |
                     |        |                     |             |
                     | idempotency store            | LLM provider |
                     | (eventId dedupe)              | (BYOK client)|
                     |                               | OpenSearch   |
                     +-------------------------------------------+
```

Spring Boot tiêu thụ Kafka topic. Trong kiến trúc hexagonal đề xuất, code domain công bố các port (interface), còn Kafka, LLM provider, OpenSearch và persistence là các infrastructure adapter. Domain không import SDK của provider. Nhờ vậy, các quy tắc thanh toán có thể được kiểm thử mà không cần truy cập mạng.

```text
src/main/java/dev/finpay/notifications/
|- domain/
|  |- port/
|  |  |- CopyGenerator.java
|  |  |- DedupStore.java
|  |  `- AuditLog.java
|  |- model/
|  |  |- NotificationEvent.java
|  |  |- GeneratedCopy.java
|  |  `- Decision.java
|  `- service/
|     `- CopyPipeline.java
`- infrastructure/
   |- kafka/
   |- llm/
   |- opensearch/
   `- store/
```

Pipeline phải tất định về dữ kiện và trạng thái gửi. Chỉ phần câu chữ được phép thay đổi.

## Bước 1: chuẩn hóa event

> **[PROPOSED DESIGN]** Chuyển wire event thành tập dữ kiện đã định kiểu và được validate trước khi gọi model. Object này là contract mà generated copy không được ghi đè.

```java
public record PaymentSettled(
    String eventId,
    String userId,
    BigDecimal amountPaid,
    String currency,
    LocalDateTime settledAt
) {
    public PaymentSettled {
        Objects.requireNonNull(eventId, "eventId is required");
        if (amountPaid == null || amountPaid.signum() <= 0)
            throw new IllegalArgumentException("amountPaid must be positive");
        if (currency == null || currency.isBlank())
            throw new IllegalArgumentException("currency is required");
    }
}
```

Kafka adapter ánh xạ wire JSON sang `PaymentSettled` trong `infrastructure/kafka/`. Domain pipeline chỉ thấy domain record. Nếu schema của topic thay đổi, adapter thay đổi; domain không cần biết wire format đó.

## Bước 2: claim event một lần

Kafka có thể giao một event ít nhất một lần, vì vậy consumer phải sẵn sàng nhận lại cùng event. Pipeline nên claim `eventId` trước external call và release claim khi xử lý thất bại.

```java
@Transactional
public Decision decide(PaymentSettled event) {
    if (dedupStore.alreadyProcessed(event.eventId()))
        return Decision.replay(event.eventId());

    dedupStore.claim(event.eventId(), leaseTtlMinutes);
    try {
        GeneratedCopy copy = copyGenerator.generate(event);
        Decision decision = Decision.accepted(event.eventId(), copy, now());
        auditLog.record(decision);
        return decision;
    } catch (Throwable t) {
        dedupStore.release(event.eventId());
        Decision decision = Decision.failed(event.eventId(), reason(t), now());
        auditLog.record(decision);
        return decision;
    }
}
```

Các thuộc tính quan trọng:

- Claim được khóa theo `eventId`, và replay được phát hiện trước external call.
- Attempt thất bại sẽ release claim để Kafka consumer redeliver. Số lần retry và backoff thuộc boundary của consumer, không nằm trong một vòng lặp thứ hai trong pipeline.
- Cả quyết định accepted, failed và replay đều có thể audit.

## Bước 3: dùng idempotency key cho provider request

Khử trùng lặp ở event không xử lý được tình huống mạng không rõ kết quả. Request có thể timeout ở phía local sau khi provider đã xử lý xong. Một provider request key ổn định cho phép retry tham chiếu cùng operation, nếu provider hỗ trợ request idempotency.

```java
String idempotencyKey = "copy:" + event.eventId();

var request = CopyRequest.builder()
    .idempotencyKey(idempotencyKey)
    .model(providerModel)
    .messages(List.of(systemPrompt(), userMessage(event)))
    .responseFormat(JSON_OBJECT)
    .build();
```

Cùng event tạo ra cùng key. Kết hợp với dedup store, đường đi tạo copy là idempotent từ đầu đến cuối. Hành vi idempotency cụ thể của provider vẫn là trách nhiệm của adapter và phải được kiểm tra theo API contract của provider đó.

## Bước 4: dữ kiện vào, JSON ra

> **[PROPOSED DESIGN]** Xem system prompt là một phần của application contract, không phải lời đề nghị model làm đúng. Cung cấp dữ kiện chính xác, cấm bịa giá trị và nêu rõ model không được quyết định tiền.

```java
String systemPrompt = """
    You write notification copy for a fintech app. The recipient is the customer.

    HARD RULES:
    1. Use only facts in the user message. Never invent, round, or correct numbers.
       Never imply a balance, refund, or charge that is not in the facts.
    2. Reproduce monetary values exactly.
    3. Return valid JSON matching the schema. Do not return markdown.
    4. Tone: warm and concise, in Vietnamese. Body limit: 160 characters.
    5. If the facts are insufficient, return {"error":"unsatisfiable"}.
    """;
```

Adapter validate response trước khi response đến sender:

```java
public record GeneratedCopy(
    String title,
    String body,
    Tone tone,
    String model,
    String rawModelOutput
) {
    public enum Tone { NEUTRAL, URGENT, CELEBRATORY }
}
```

Jackson có thể deserialize contract này trong `infrastructure/`. Vi phạm schema hoặc enum sẽ fail tại adapter boundary. `rawModelOutput` được giữ để audit và không bao giờ hiển thị cho khách hàng.

## Bước 5: timeout, retry, circuit breaker, fallback

LLM là một downstream dependency. Hãy đặt timeout rõ ràng và cô lập nó bằng circuit breaker. Các giá trị dưới đây là giá trị nguồn trong bài gốc; trong service thật, chúng phải nằm trong configuration và được chọn dựa trên yêu cầu latency và delivery.

```java
@Bean
public RestClient llmClient(LlmProperties props) {
    return RestClient.builder()
        .baseUrl(props.baseUrl())
        .requestFactory(ClientHttpRequestFactories.get(
            ClientHttpRequestFactorySettings.defaults()
                .withConnectTimeout(props.connectTimeout()) // source: 2s
                .withReadTimeout(props.readTimeout())))     // source: 10s
        .build();
}

@Bean
public CircuitBreaker llmBreaker(CircuitBreakerConfigProps props) {
    return CircuitBreaker.of("llm", props.toConfig()); // source example: 60%
}
```

```java
public Optional<GeneratedCopy> generate(PaymentSettled event) {
    return Try.ofSupplier(() ->
        circuitBreaker.executeSupplier(() ->
            llmClient.post()
                .uri("/chat/completions")
                .body(requestFor(event))
                .retrieve()
                .body(LlmResponse.class)
                .toGeneratedCopy()))
        .recover(TimeoutException.class, e -> fallbackCopy(event))
        .recover(CallNotPermittedException.class, e -> fallbackCopy(event))
        .recover(e -> {
            auditLog.record(Decision.failed(event.eventId(), describe(e), now()));
            return null;
        })
        .toJavaOptional();
}
```

Các trách nhiệm được tách riêng:

- **Timeout:** sender thread không bị provider giữ vô thời hạn.
- **Retry:** Kafka consumer áp dụng số lần thử có giới hạn và backoff. Copy pipeline không tự lặp.
- **Circuit breaker:** khi provider lỗi, dùng template đã được con người duyệt và điền bằng cùng dữ kiện đã validate.

Fallback không phải là nguồn sự thật thứ hai về thanh toán. Đây là đường hiển thị có ít biến động hơn. Nếu không tạo được copy an toàn, hãy ghi nhận failure và để delivery policy của consumer xử lý.

## Bước 6: BYOK không làm lộ credential

> **[PROPOSED DESIGN]** Provider key do tenant cung cấp nên đến dưới dạng mã hóa, được giải mã tại adapter boundary và không bao giờ hardcode, ghi log hoặc đưa vào stack trace.

```java
@Service
public class ByokVault {
    public SecretKey keyFor(String tenantId) {
        return vault.readSecret(Path.of("byok", tenantId));
    }
}
```

Adapter gắn key vào authorization header của request rồi loại bỏ sau đó. Request logging phải loại credential bằng filter cho các LLM DTO. Test nên khẳng định key không xuất hiện trong prompt, log hoặc exception. Không cần log cả một phần key; hãy log tenant identifier hoặc request identifier.

## Bước 7: audit mọi quyết định

Port `AuditLog` có thể ghi các quyết định accepted, failed và replay vào OpenSearch thông qua infrastructure adapter.

```java
public record AuditRecord(
    String eventId,
    String userId,
    String decision,       // ACCEPTED | FAILED | REPLAY
    String copyTitle,
    String copyBody,
    String model,
    String rawModelOutput,
    Instant occurredAt
) {}
```

> **[SOURCE FACT]** Bài gốc chỉ định OpenSearch, phân trang `search_after`, xoay vòng index theo ngày và giữ hot storage trong 90 ngày rồi chuyển sang cold storage. Đây là lựa chọn triển khai, không phải yêu cầu chung. Các lựa chọn này hỗ trợ truy vấn điều tra theo khoảng thời gian và khoảng số tiền, kèm output nguyên văn của model.

Dữ liệu audit cũng cần access control, chính sách retention và quyết định rõ liệu raw output có thể chứa dữ liệu cá nhân hay không. Audit trail chỉ hữu ích khi có thể tìm kiếm và được bảo vệ khi truy cập.

## Guardrail tóm tắt

| Guardrail | Cơ chế |
| --- | --- |
| Model không quyết định tiền | Dữ kiện đã validate, prompt có ràng buộc, schema validation, template fallback |
| Idempotency theo `eventId` | Dedup store, claim/release, provider request key |
| Downstream failure có giới hạn | Connect/read timeout, consumer retry, circuit breaker |
| Không để lộ BYOK key | Secret store, chỉ adapter được truy cập, filter credential |
| Audit mọi quyết định | OpenSearch `AuditRecord` hoặc search-oriented store tương đương |

## Kết luận kỹ thuật

1. **Coi prompt là code.** Version hóa, review và test đường `unsatisfiable` cùng quy tắc không bịa số.
2. **Giữ dữ kiện tất định.** Câu chữ có thể thay đổi; mọi chữ số tiền phải đến từ domain.
3. **Luôn có fallback thực sự.** Template do con người duyệt là cơ chế reliability, không phải giải pháp tạm bợ.
4. **Audit hành vi thay vì đoán trước.** Output được ghi lại giúp điều tra khi behavior của model hoặc prompt thay đổi.
5. **Dùng một event key ổn định.** `eventId` nối deduplication của consumer, request idempotency của provider và audit record.

Repository nằm tại <https://github.com/finpay-lab/notification-service>. Quy tắc cốt lõi là: LLM có thể chọn câu chữ, nhưng không sở hữu dữ kiện, tiền, trạng thái gửi hoặc credential.
