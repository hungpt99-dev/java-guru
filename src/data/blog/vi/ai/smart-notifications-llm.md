---
title: "Thiết kế thông báo thanh toán có LLM hỗ trợ một cách an toàn"
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

Một thông báo thanh toán có hai nhiệm vụ khác nhau: nêu chính xác giao dịch và trình bày dễ đọc trên SMS, email hoặc push. Template cố định đáng tin cậy, nhưng số lượng template tăng nhanh khi yêu cầu sản phẩm, ngôn ngữ, kênh và pháp lý phân nhánh. LLM có thể đề xuất câu chữ tự nhiên, nhưng cũng có thể đổi dữ kiện trong lúc cố cải thiện câu văn.

Ranh giới quan trọng không phải là “template hay AI”, mà là quyền hạn. Domain thanh toán sở hữu dữ kiện đã kiểm tra và quyết định gửi. LLM chỉ được đề xuất nội dung.

Đây là thiết kế tham chiếu cho FinPay. Một thiết kế hướng production cần kiểm chứng các giả định với yêu cầu pháp lý, provider và vận hành thực tế; bài viết không tuyên bố đã triển khai.

## Vì sao khó

Hệ thống phải kết hợp event bất đồng bộ, dependency có tính xác suất và side effect khó hoàn tác. Model có thể tạo false positive, false negative hoặc sinh câu chữ khác nhau cho cùng input. Provider có thể timeout, giới hạn tốc độ, trả output sai cấu trúc hoặc ngừng hoạt động. Retry có thể khôi phục response, nhưng cũng có thể lặp lại việc gửi ra bên ngoài.

Các contract độc lập cần được giữ vững:

- Event phải được consume ít nhất một lần mà không tạo duplicate business work.
- Các dữ kiện như amount, currency, status và recipient không được suy ra từ text sinh bởi model.
- Chất lượng AI không được quyết định việc gửi một thông báo bắt buộc về mặt pháp lý.
- Credential của provider và dữ liệu giao dịch phải nằm trong ranh giới đã được phê duyệt.
- Mọi quyết định phải giải thích được sau khi model, prompt hoặc policy thay đổi.

## Thiết kế ngây thơ

Đưa raw event cho model rồi trả về một chuỗi không định kiểu khiến các contract này không được thể hiện:

```java
// WRONG: ví dụ cố ý không an toàn; không đưa vào production
public String copyFor(NotificationEvent event) {
    return llm.complete("Write a friendly notification: " + event.rawPayload());
}
```

Model thấy nhiều dữ liệu hơn cần thiết, kết quả không có schema, và không có timeout, retry có giới hạn hay fallback. Quan trọng nhất, caller không thể biết câu nào là dữ kiện, câu nào là đề xuất của model, và câu nào là quyết định gửi.

## Vì sao sẽ hỏng

Giả sử event nguồn chứa `2,431,876 VND`, còn model trả về “khoảng 2.4M VND”. Đây không chỉ là khác biệt về văn phong. Nó có thể sai, gây hiểu nhầm hoặc không tuân thủ quy định. Chuỗi tự do cũng có thể thiếu title bắt buộc, vượt giới hạn SMS, thêm claim không được hỗ trợ hoặc chứa prompt injection từ một field vốn chỉ là dữ liệu.

Dependency cũng hỏng theo cách nguy hiểm. Call không có giới hạn giữ việc consumer vô thời hạn. Retry mù làm khuếch đại rate limit. Xử lý lại event có thể sinh nội dung khác và gửi hai lần. Timeout không chứng minh provider chưa hoàn thành request, nên retry việc gửi không có idempotency key có thể tạo duplicate side effect.

## Các bài toán khó

### AI là signal, không phải quyết định

Pipeline nên làm rõ quyền hạn:

```text
facts đã kiểm tra -> AI signal -> policy -> business decision -> delivery
                       (style/risk)  (luật)    (gửi/fallback/bỏ qua)
```

Ví dụ AI signal có thể là `tone=concise`, `risk=low`, `confidence=0.91`. Policy có thể từ chối confidence thấp, claim không có trong facts hoặc body vượt giới hạn kênh. Business decision vẫn đến từ luật domain: cảnh báo gian lận bắt buộc vẫn được gửi bằng template an toàn khi AI không hoạt động. Một thông báo bị cấm không trở nên hợp lệ chỉ vì model có confidence cao.

### Idempotency không chỉ là `exists()`

Đây là một race, không phải cơ chế idempotency:

```java
// WRONG: hai consumer có thể cùng thấy false
if (!repository.exists(event.eventId())) {
    repository.save(event.eventId());
    sender.send(message);
}
```

Hai consumer có thể cùng vượt qua bước kiểm tra trước khi một bên insert. Thiết kế thật cần unique constraint trên `(tenant_id, event_id, purpose, channel)` cùng atomic insert, hoặc `SETNX` có điều kiện và expiry khi cache phù hợp. Kafka consumer cũng có thể dùng inbox table: insert event key trong cùng transaction với notification được tạo, rồi chỉ acknowledge Kafka sau commit. Outbox giúp publish work một cách đáng tin cậy từ database.

Idempotent storage và idempotent side effect là hai việc khác nhau. Unique insert ngăn duplicate processing record, nhưng không thể hủy hai call đã gửi tới email, SMS hoặc push provider. Delivery request cần idempotency key ổn định hoặc cơ chế deduplication riêng của provider. Nếu provider không hỗ trợ, hãy ghi nhận trạng thái không chắc chắn và reconciliation, thay vì retry mù không có key.

### Version và structured output

LLM adapter nên nhận một fact object tối thiểu, canonical và trả về schema như `{ title, body, tone, claims }`. Validator kiểm tra mọi claim có trong facts, field bắt buộc, giới hạn độ dài kênh và việc output có chứa credential hoặc secret hay không. Lưu `model_version` và `prompt_version`, vì thay đổi một trong hai có thể đổi hành vi. Policy thay đổi cũng phải có `policy_version`.

### Timeout, retry và fallback

Dùng deadline ngắn, exponential backoff có giới hạn và jitter cho lỗi có thể retry, cùng circuit breaker để ngừng gọi dependency đang outage. Không retry lỗi validation hoặc authentication. Fallback template phải deterministic và được policy chọn, không phụ thuộc exception xảy ra sau cùng. Đưa poison event vào dead-letter, còn work đã hết retry vào reconciliation.

## Trade-off

Cho AI viết nội dung giúp tăng sự đa dạng và có thể giảm số template phải bảo trì, nhưng thêm latency, token cost, dependency provider và độ phức tạp audit. Chỉ gửi canonical facts giúp giảm lộ dữ liệu nhưng ít ngữ cảnh văn phong hơn. Sinh nội dung synchronous cho response mới nhất nhưng gắn latency gửi với model; asynchronous cô lập tốt hơn nhưng cần state bền vững và trạng thái pending rõ ràng.

Với message rủi ro cao hoặc cần chính xác pháp lý, template deterministic là mặc định an toàn hơn. Có thể tắt AI theo tenant, locale, channel hoặc policy version mà không thay đổi payment facts.

## Thiết kế tốt hơn

Giữ domain và port nhỏ. Một flow hướng production có thể như sau:

```text
Kafka event -> consumer -> inbox/unique insert -> fact mapper
                                      |
                         policy -> LLM adapter (optional)
                                      |
                         validator -> template fallback
                                      |
                         outbox -> delivery adapter -> provider
                                      |
                         audit + OpenSearch read model
```

```java
// RIGHT: facts và quyền gửi nằm ngoài model
NotificationDecision decide(PaymentFacts facts, Policy policy) {
    AiDraft draft = policy.aiEnabled()
        ? llm.generate(facts.minimalView(), policy.promptVersion(), policy.deadline())
        : null;
    ValidatedCopy copy = policy.validateOrFallback(draft, facts);
    return policy.authorize(facts, copy); // send, suppress hoặc retry
}
```

Database là system of record cho facts, processing state và audit entry. Kafka là replay source, không phải payment ledger canonical. OpenSearch là read model để tìm lịch sử notification, không phải authority để quyết định payment có xảy ra hay không. Outbox mang theo delivery idempotency key ổn định. Tenant provider key được lấy từ secret manager, không bao giờ đặt trong prompt hoặc log.

Audit record tối thiểu nên có `transaction_id`, `event_id`, `model_version`, `prompt_version`, `policy_version`, `decision` và `reason`, cùng timestamp, channel, template hoặc output hash và provider outcome. Chỉ lưu generated content khi retention và access policy cho phép.

## Kịch bản lỗi

- **Kafka giao lại duplicate:** inbox unique key trả về kết quả đã có; consumer acknowledge mà không tạo notification khác.
- **Model timeout hoặc rate limit:** retry có giới hạn có thể chạy với lỗi tạm thời; sau deadline, policy chọn template deterministic.
- **Output sai cấu trúc hoặc không an toàn:** schema và claim validation từ chối, ghi reason và không gửi.
- **Provider timeout sau khi đã nhận:** đánh dấu delivery không chắc chắn, giữ nguyên idempotency key và reconcile trạng thái provider thay vì retry không key.
- **Database outage:** không acknowledge event; Kafka sẽ replay sau khi phục hồi.
- **OpenSearch outage:** delivery và audit persistence vẫn tiếp tục; indexing retry từ durable record.
- **Prompt injection trong mô tả giao dịch:** coi mọi field event là untrusted data, không cho chúng ghi đè system instruction hoặc policy.

## Capacity

Capacity phải tính từ traffic, latency và hành vi retry, không chỉ từ số partition. Quan hệ cơ bản là:

```text
Concurrency = Throughput x Latency
```

Với 200 notification/giây và model path 400 ms, số request model đang xử lý danh nghĩa là `200 x 0.4 = 80`. Retry và fallback làm tăng tải, nên quota provider, consumer concurrency, connection pool và database write phải được dimension cho cả failure case. Rate limiter và quota theo tenant ngăn một tenant chiếm toàn bộ model capacity. Kafka partition tạo parallelism và replay; chúng không làm database hay provider nhanh hơn.

Giữ payload nhỏ, giới hạn output token và ưu tiên template khi model queue tăng. Tách batch indexing vào OpenSearch khỏi critical path gửi. Backpressure nên làm chậm hoặc tạm dừng consumption trước khi memory và provider queue tăng không giới hạn.

## Security/Privacy

Payment event có thể chứa PII, account identifier, thông tin merchant và mô tả nhạy cảm. Minimize model input còn đúng những facts cần cho việc viết. Tokenize hoặc redact identifier, phân loại field và dùng provider nằm trong boundary đã phê duyệt. Không tùy tiện gửi toàn bộ transaction tới external AI service. Credential của tenant nằm trong secret manager, được scope theo tenant và không xuất hiện trong prompt, trace hay log thông thường.

Phân quyền audit và search view, mã hóa khi truyền và khi lưu, đặt retention và deletion rule, đồng thời coi model output là untrusted content. Cần output encoding và escaping theo channel để ngăn lạm dụng markup hoặc link. Security policy có thể buộc dùng template deterministic cho nhóm dữ liệu nhạy cảm.

## Observability

Đo cả hành vi hệ thống và kết quả nghiệp vụ:

- System: consumer lag, processing latency, model latency, số timeout và rate limit, retry attempt, circuit state, validation failure, outbox age, provider latency và delivery không chắc chắn.
- Business: notification được accept, sent, chọn fallback, bị policy suppress, fail theo channel và số duplicate attempt được ngăn.

Prometheus label phải có cardinality bị giới hạn. Không bao giờ dùng `transaction_id` hoặc `account_id` làm label; đặt identifier liên quan trong structured log hoặc trace context với access control. Audit record giữ version và reason cần thiết để tái dựng. Dashboard phải phân biệt model rejection, provider failure và business-policy suppression.

## Bài học

1. Đặt payment facts và quyền gửi trong domain; AI chỉ tạo signal hoặc draft có giới hạn.
2. Chứng minh idempotency bằng atomic storage operation và làm external side effect deduplicable một cách riêng biệt.
3. Coi model, prompt, policy, provider, timeout, retry và fallback là các operational contract có version.
4. Dùng Kafka để replay, database làm system of record và OpenSearch làm read model.
5. Minimize PII trước khi gọi model bên ngoài và không coi credential của tenant là prompt data.
6. Quan sát business decision và failure mode mà không biến identifier cardinality cao thành metric label.
