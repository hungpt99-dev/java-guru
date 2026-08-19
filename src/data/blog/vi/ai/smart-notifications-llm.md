---
title: 'AI-2 Smart Notifications with LLM-generated copy'
description: 'FinPay notification-service AI integration: smart-notifications-llm.'
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

## Lời mở đầu: bug thông báo ngớ ngẩn nhất chúng tôi từng phát hành

Một khách hàng trả nợ trước hạn. Hệ thống cũ bắn ra một thông báo:

> "Khoản thanh toán 2.400.000 VND của quý khách đã được ghi nhận. Số dư nợ hiện tại: 0 VND."

Chính xác về mặt kỹ thuật. Vô dụng trong thực tế. Đoạn lời văn là một template cứng do một pipeline sinh ra, vốn chưa bao giờ hiểu sự kiện đó *có nghĩa là gì*. Chúng tôi cứ mãi đánh nhau trên cùng một mặt trận: template cứ thế nhân bản ra, bộ phận product và pháp lý tranh nhau từng dấu câu, và không ai chịu trách nhiệm về lời văn. Vậy nên chúng tôi bỏ templating và bắt đầu *sinh* nội dung.

Đây là câu chuyện về `smart-notifications-llm`, tích hợp AI bên trong notification-service của FinPay: chúng tôi đã để LLM viết lời văn như thế nào — và quan trọng hơn — làm sao để việc để một LLM viết lời văn bên trong một hệ thống thanh toán là *an toàn*.

## Tại sao không dùng template? Cách SAI trước

Cách ngây thơ: ném payload sự kiện vào model và cầu nguyện.

```java
// SAI — đừng bao giờ phát hành thứ này
@Service
public class CopyService {
    private final OpenAiClient openAi; // nhà cung cấp nào cũng được

    public String copyFor(NotificationEvent event) {
        String prompt = """
            Hãy viết một thông báo push thân thiện bằng tiếng Việt về sự kiện này:
            %s
            """.formatted(event.getRawPayload());
        return openAi.complete(prompt); // không timeout, không retry, không hợp đồng
    }
}
```

Đoạn code này thất bại theo năm cách riêng biệt, và tôi muốn bạn nhớ từng cách một:

1. **Model có thể thay đổi sự thật.** Không có gì ràng buộc lời văn phải khớp với các con số trong payload. Một LLM "tử tế" làm tròn 2.431.876 VND thành "2,4 triệu" là một sự cố tuân thủ đang chực chờ xảy ra.
2. **Không có schema.** Bên tiêu thụ (bộ phận gửi push) mong đợi `{ title, body, tone }`. Thứ được trả về chỉ là một chuỗi ký tự không rõ cấu trúc.
3. **Không retry, không timeout, không circuit breaker.** Bên gửi downstream sẽ bị treo vô thời hạn vì phải chờ một lời gọi model chậm, và một LLM provider suy giảm sẽ kéo sập toàn bộ hệ thống thông báo.
4. **AI là người quyết định tiền.** Không có gì trong code này ngăn model bịa ra một "số dư nợ mới" hoặc một "hoàn tiền" mà không ai cho phép.
5. **Không idempotent.** Hai bản sao của cùng một sự kiện sinh ra hai thông báo khác nhau, khiến khách hàng nhận cùng một sự thật nhưng được diễn đạt khác nhau — may thì khó hiểu, rủi thì tự mâu thuẫn.

Từng điều một trong năm điều trên đều là vi phạm guardrail. Để tôi cho bạn xem kiến trúc chúng tôi xây dựng để khiến chúng *không thể xảy ra về mặt cấu trúc*.

## Kiến trúc

```
                    ┌───────────────────────────────────────────┐
Kafka topic ───────►│          notification-service            │
 event."payment"    │                                           │
                    │  ┌───────────┐    ┌──────────────────┐    │
                    │  │  domain/  │◄──►│ infrastructure/  │    │
                    │  │  (ports)  │    │  (adapters)      │    │
                    │  └─────┬─────┘    └────┬─────────────┘    │
                    │        │               │                  │
                    │  idempotency store     │  LLM provider    │
                    │  (eventId dedupe)      │  (BYOK client)   │
                    │                        │  OpenSearch sink  │
                    └───────────────────────────────────────────┘
```

Spring Boot tiêu thụ một topic Kafka. Code tuân theo kiến trúc hexagonal: các quy tắc nghiệp vụ nằm trong `domain/` dưới dạng ports (interface), và mọi thứ bên ngoài — Kafka, LLM provider, OpenSearch, lớp lưu trữ — nằm trong `infrastructure/` dưới dạng adapters. Domain không bao giờ import một SDK nào. Bạn có thể suy luận về logic tiền bạc mà không cần truy cập mạng tới bất kỳ thứ gì.

```
src/main/java/dev/finpay/notifications/
├── domain/
│   ├── port/
│   │   ├── CopyGenerator.java
│   │   ├── DedupStore.java
│   │   └── AuditLog.java
│   ├── model/
│   │   ├── NotificationEvent.java
│   │   ├── GeneratedCopy.java
│   │   └── Decision.java
│   └── service/
│       └── CopyPipeline.java
└── infrastructure/
    ├── kafka/
    ├── llm/
    ├── opensearch/
    └── store/
```

Pipeline là trái tim của hệ thống. Nó *tất định* về sự thật, và chỉ *bất định* về lời văn.

## Bước 1 — Chuẩn hóa sự kiện thành các dữ kiện

Trước khi bất kỳ thứ gì chạm vào LLM, sự kiện được biến thành một tập dữ kiện đã định kiểu và được kiểm tra hợp lệ. Domain model chính là hợp đồng mà model không bao giờ được phép phá vỡ.

```java
public record PaymentSettled(
    String eventId,
    String userId,
    BigDecimal amountPaid,
    String currency,
    LocalDateTime settledAt
) {
    public PaymentSettled {
        Objects.requireNonNull(eventId, "eventId là bắt buộc");
        if (amountPaid == null || amountPaid.signum() <= 0)
            throw new IllegalArgumentException("amountPaid phải lớn hơn 0");
        if (currency == null || currency.isBlank())
            throw new IllegalArgumentException("currency là bắt buộc");
    }
}
```

Chi tiết hexagonal: adapter Kafka ánh xạ JSON dạng wire sang record này trong `infrastructure/kafka/`, còn pipeline trong domain chỉ nhìn thấy `PaymentSettled`. Nếu schema topic thay đổi, adapter thay đổi — domain thì không.

## Bước 2 — Khử trùng lặp theo eventId (idempotency)

Ngữ nghĩa at-least-once của Kafka nghĩa là cùng một sự kiện *chắc chắn* sẽ đến hai lần. Nếu chúng tôi sinh và gửi hai lần, khách hàng sẽ nhận một thông báo trùng, hoặc tệ hơn, audit trail sẽ có hai quyết định tự mâu thuẫn. Vì vậy điều đầu tiên pipeline làm là *claim* sự kiện.

```java
@Transactional
public Decision decide(PaymentSettled event) {
    if (dedupStore.alreadyProcessed(event.eventId())) {
        return Decision.replay(event.eventId()); // idempotent: cùng một kết quả
    }
    dedupStore.claim(event.eventId(), leaseTtlMinutes); // duy nhất theo eventId
    try {
        GeneratedCopy copy = copyGenerator.generate(event);
        auditLog.record(Decision.accepted(event.eventId(), copy, now()));
        return Decision.accepted(event.eventId(), copy, now());
    } catch (Throwable t) {
        dedupStore.release(event.eventId());
        auditLog.record(Decision.failed(event.eventId(), reason(t), now()));
        return Decision.failed(event.eventId(), reason(t), now());
    }
}
```

Các quy tắc đúc kết từ sự cố:

- Claim chỉ được khóa bởi `eventId`. Replay được phát hiện trước khi *bất kỳ* lời gọi ra ngoài nào xảy ra.
- Khi thất bại, chúng tôi giải phóng claim và để Kafka gửi lại — ngân sách retry nằm ở consumer, không nằm trong pipeline.
- Quyết định luôn được ghi lại bất kể kết quả. **Ghi audit mọi quyết định** là bắt buộc, không phải tùy chọn.

## Bước 3 — Request ID idempotent cho LLM

Ngay cả khi đã dedup ở mức sự kiện, lần thử đầu tiên vẫn có thể timeout ở tầng mạng dù provider *đã* trả lời. Khi đó redelivery sẽ sinh ra bản copy thứ hai. Cách xử lý là truyền cho provider một khóa idempotency theo từng sự kiện.

```java
// ĐÚNG — idempotency ở tầng HTTP request
String idempotencyKey = "copy:" + event.eventId();

var req = CopyRequest.builder()
    .idempotencyKey(idempotencyKey)   // provider khử trùng theo khóa này
    .model("gpt-4o-mini")             // rẻ, nhanh, đủ dùng
    .messages(List.of(
        systemPrompt(),
        userMessage(event)
    ))
    .responseFormat(JSON_OBJECT)      // ép buộc output có cấu trúc
    .build();
```

Cùng sự kiện → cùng khóa → cùng bản copy (hoặc một bản đã được cache). Kết hợp với dedup store, toàn bộ đường đi từ Kafka đến bản copy là idempotent từ đầu đến cuối.

## Bước 4 — Hợp đồng: dữ kiện vào, JSON ra, tiền bị khóa

System prompt được viết như một *hợp đồng*, chứ không phải một lời gợi ý. Nó liệt kê chính xác các dữ kiện, cấm bịa ra giá trị, và bảo model rằng nó không được phép quyết định các khoản tiền.

```java
String systemPrompt = """
    Bạn viết lời văn thông báo push cho một ứng dụng fintech. Người dùng là khách hàng.

    QUY TẮC CỨNG — vi phạm bất kỳ quy tắc nào là một sự cố tuân thủ:
    1. Chỉ dùng các dữ kiện được cung cấp trong user message. Không bao giờ bịa,
       làm tròn, hay "sửa" con số. Không bao giờ ngụ ý số dư, hoàn tiền, hay khoản
       thu không nằm trong dữ kiện.
    2. Các con số tiền là chân lý gốc. Sao chép chúng y nguyên.
    3. Chỉ trả về JSON hợp lệ khớp schema bên dưới. Không markdown.
    4. Giọng văn: ấm áp, súc tích, tiếng Việt. Body tối đa 160 ký tự.
    5. Nếu không thể thỏa mãn các quy tắc với dữ kiện đã cho, trả về
       {"error": "unsatisfiable"} — không bao giờ tự ý sáng tạo.
    """;
```

Và response được khóa vào một schema, để code downstream có thể tin tưởng vào cấu trúc:

```java
public record GeneratedCopy(
    String title,
    String body,
    Tone tone,
    String model,
    String rawModelOutput     // giữ để audit, không bao giờ hiển thị cho người dùng
) {
    public enum Tone { NEUTRAL, URGENT, CELEBRATORY }
}
```

Hợp đồng JSON cộng với enum có nghĩa là `infrastructure/` sẽ deserialize bằng Jackson, và mọi vi phạm cấu trúc sẽ fail nhanh ngay tại ranh giới adapter — trước khi bất cứ thứ gì đến tay khách hàng.

## Bước 5 — Timeout, retry, circuit breaker

Một lời gọi model thì chậm, không ổn định và tốn kém. Nó được đối xử như bất kỳ dependency bên ngoài mong manh nào khác:

```java
// ĐÚNG — lời gọi LLM có khả năng chống chịu
@Bean
public RestClient llmClient(LlmProperties props) {
    return RestClient.builder()
        .baseUrl(props.baseUrl())
        .requestFactory(ClientHttpRequestFactories.get(ClientHttpRequestFactorySettings
            .defaults()
            .withConnectTimeout(props.connectTimeout())   // 2s
            .withReadTimeout(props.readTimeout())))       // 10s
        .build();
}

@Bean
public CircuitBreaker llmBreaker(CircuitBreakerConfigProps props) {
    return CircuitBreaker.of("llm", props.toConfig());    // 60% lỗi → mở
}
```

Lời gọi được bọc lại để khi một provider hỏng, nó chỉ làm suy giảm *tính năng*, chứ không phải cả nền tảng:

```java
public Optional<GeneratedCopy> generate(PaymentSettled event) {
    return Try.ofSupplier(() ->
        circuitBreaker.executeSupplier(() ->
            llmClient.post()
                .uri("/chat/completions")
                .body(requestFor(event))
                .retrieve()
                .body(OpenAiResponse.class)
                .toGeneratedCopy()
        )
    )
    .recover(TimeoutException.class, e -> fallbackCopy(event)) // template được con người duyệt
    .recover(CallNotPermittedException.class, e -> fallbackCopy(event)) // breaker đang mở
    .recover(e -> {
        auditLog.record(Decision.failed(event.eventId(), describe(e), now()));
        return null; // bỏ qua; Kafka redelivery + dedup sẽ retry sạch sẽ
    })
    .toJavaOptional();
}
```

Ba hành vi cần chú ý:

- **Timeout**: read timeout cứng; thread gửi không bao giờ bị provider bắt làm con tin.
- **Retry**: diễn ra ở tầng Kafka consumer với số lần giới hạn và backoff. Bản thân pipeline copy không tự lặp lại.
- **Circuit breaker**: khi LLM suy giảm, chúng tôi fallback về template do con người duyệt, điền *cùng một dữ kiện*. Khách hàng vẫn nhận thông báo đúng; chỉ là kém phần cá nhân hóa thôi.

Fallback tồn tại vì guardrail **"AI không phải là người quyết định tiền."** Một template không thể phủ hết mọi trường hợp, nhưng fallback luôn chính xác về dữ kiện — vốn chính là đặc tính thực sự quan trọng.

## Bước 6 — BYOK: mang khóa của bạn, không phải trách nhiệm của chúng tôi

Khóa provider do khách thuê cung cấp. Nó đến dưới dạng đã mã hóa, chỉ được giải mã tại ranh giới adapter, và **không bao giờ bị hardcode, không bao giờ bị log, không bao giờ xuất hiện trong stack trace**.

```java
// ĐÚNG — vật liệu khóa không nằm trong code và log
@Service
public class ByokVault {
    public SecretKey keyFor(String tenantId) {
        // lấy từ Vault (Kubernetes Secret mount, hoặc Vault API)
        // không bao giờ cache vượt quá scope của một request
        return vault.readSecret(Path.of("byok", tenantId));
    }
}

private void maskKey(String key) {
    log.debug("dùng provider key {}", key.substring(0, 4) + "…"); // không bao giờ log cả khóa
}
```

Client adapter gắn khóa vào header `Authorization: Bearer` cho từng request rồi vứt đi. Nếu một khóa lọt vào prompt, vào dòng log, hay vào exception, đó là một test thất bại, chứ không phải cú sốc sáng thứ Hai. Khi body request được log, khóa sẽ bị loại bỏ nhờ một Jackson filter đăng ký cho các DTO LLM.

## Bước 7 — OpenSearch: audit trail là một sản phẩm

Mọi quyết định — accepted, failed, replay — đều được ghi vào OpenSearch bởi một adapter đứng sau port `AuditLog`.

```java
public record AuditRecord(
    String eventId,
    String userId,
    String decision,       // ACCEPTED | FAILED | REPLAY
    String copyTitle,      // cho ACCEPTED
    String copyBody,       // cho ACCEPTED
    String model,
    String rawModelOutput, // output nguyên văn của model
    Instant occurredAt
) {}
```

Vì sao là OpenSearch chứ không phải một bảng? Vì câu hỏi mang tính *pháp y*: "cho tôi xem mọi bản copy model sinh ra hôm thứ Ba tuần trước cho các khoản trên 10 triệu VND, kèm output nguyên văn." Đó là một bài toán tìm kiếm, và OpenSearch xử lý nó ở quy mô lớn bằng phân trang `search_after` và xoay vòng index theo ngày. Đó cũng là cách nhanh nhất để product và compliance kiểm tra xem model có đang đi chệch hướng hay không.

Quy tắc lưu giữ: 90 ngày nóng trong OpenSearch, sau đó chuyển sang cold storage. Nếu compliance hỏi, câu trả lời là "truy vấn đi" — không bao giờ là "chúng tôi không lưu."

## Guardrails trên một trang

| Guardrail | Cơ chế |
| --- | --- |
| AI không phải là người quyết định tiền | Prompt chỉ chứa dữ kiện, quy tắc cứng, template fallback, JSON khóa schema |
| Idempotent theo eventId | Dedup store + claim/release + khóa idempotency request theo từng sự kiện |
| Timeout, retry, circuit breaker | Read timeout, retry ở consumer, breaker `Resilience4j` + fallback template |
| BYOK khóa không bao giờ hardcode/log | Secret đặt trong Vault, log che khóa, Jackson filter loại khóa |
| Audit mọi quyết định | OpenSearch `AuditRecord` cho accepted/failed/replay, giữ nóng 90 ngày |

## Điều chúng tôi học được

1. **Prompt là code, hãy review nó như code.** Chúng tôi version hóa các prompt trong repo, cùng với các test khẳng định đường "unsatisfiable" và quy tắc "không bịa con số". Một prompt của model cũng là một bề mặt bảo trì, y hệt một chữ ký phương thức.
2. **Tính tất định là sản phẩm.** Lời văn hiển thị cho khách hàng có thể thay đổi, nhưng *dữ kiện* thì không bao giờ. Mọi byte của một con số tiền là do domain viết ra, không bao giờ do model.
3. **Fallback không phải là giải pháp chắp vá.** Template fallback là quyết định chống chịu quan trọng nhất mà chúng tôi từng đưa ra. Khi LLM ngừng hoạt động, thông báo vẫn được gửi đi, đúng và đúng giờ.
4. **Audit thắng tiên đoán.** Chúng tôi không thể dự đoán model sẽ nói gì, nhưng chúng tôi có thể ghi lại mọi thứ nó đã nói và tìm kiếm lại sau này. Sự bất đối xứng đó chính là toàn bộ lý do khiến OpenSearch góp mặt trong kiến trúc.
5. **`eventId` là bạn của bạn.** Cùng một kỷ luật khiến thanh toán idempotent cũng khiến copy của LLM idempotent. Không có dedup store thì không gì trong số này vận hành được, và đó là đoạn code rẻ nhất chúng tôi từng viết.

Repository nằm tại <https://github.com/finpay-lab/notification-service>. Code trong bài này là code thật, được lược bớt phần rườm rà để dễ đọc. Nếu bạn sắp thêm một LLM vào một hệ thống mà tiền chuyển động qua, hãy sao chép guardrails trước — tính năng sau.
