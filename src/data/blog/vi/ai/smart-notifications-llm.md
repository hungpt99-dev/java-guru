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

## Tính năng AI nhỏ nhất nhưng hữu ích

FinPay đã có payment core. Core này xác thực payment, ghi state có thẩm quyền vào ledger và quyết định notification nào bắt buộc phải gửi. Tính năng AI được đề xuất cố ý nhỏ hơn một “AI notification platform”: LLM chỉ được soạn lời cho notification mà domain đã quyết định gửi.

Điều đó quan trọng khi payment event ghi `2,431,876 VND`, nhưng model viết “khoảng 2.4M VND.” Người đọc có thể xem đây là cách diễn đạt thân thiện. Hệ thống tài chính phải xem đó là một phép biến đổi dữ kiện không được hỗ trợ. Model cũng không được quyết định bỏ qua fraud alert, đổi recipient, hoặc biến một payment thất bại thành thành công.

Quy tắc trung tâm là:

```text
canonical payment facts -> AI draft -> claim validator -> domain policy -> delivery
                                          (untrusted)       (authority)
```

LLM chỉ đề xuất nội dung. Dữ kiện và quyết định gửi thuộc về code FinPay tất định.

Đây là thiết kế tham chiếu, không phải khẳng định về một hệ thống FinPay đã triển khai. Các con số bên dưới là giả định minh họa để phân tích capacity.

## Thiết kế đầu tiên đã thất bại như thế nào

Cách triển khai hiển nhiên hấp dẫn vì rất nhỏ:

```java
// WRONG: deliberately unsafe; do not ship
public String copyFor(NotificationEvent event) {
    return llm.complete("Write a friendly notification: " + event.rawPayload());
}
```

Nó gửi raw event cho model và coi một string là kết quả. Ba contract bị che khuất trong một lời gọi:

- Model được thấy những field không cần thiết, gồm PII hoặc nội dung độc hại trong description.
- Caller không thể phân biệt payment fact với câu do model bịa ra.
- Không có timeout, giới hạn output, fallback, audit record hay bảo vệ trước việc gửi lặp.

Lỗi không chỉ là hallucination. Response tự do có thể bỏ title bắt buộc, vượt giới hạn SMS, chứa link chưa được phê duyệt hoặc lặp lại chỉ dẫn nằm trong text do merchant kiểm soát. Provider của model cũng có thể rate-limit hoặc timeout. Nếu consumer chờ vô hạn, lượng việc đang xử lý tăng theo `concurrency = throughput x latency`. Với giả định minh họa 200 notification/giây, response provider 4 giây tạo ra 800 model call đang xử lý trước khi tính retry. Consumer, connection pool và quota của provider sau đó có thể cùng chịu lỗi.

Cuối cùng, timeout không chứng minh provider chưa hoàn tất request. Retry một thao tác vừa generate vừa send vì thế có thể tạo hai lần gửi bên ngoài. Kiểm tra database kiểu `exists()` cũng không đóng được race này.

## Xác định constraint trước khi chọn component

Với tính năng này, constraint hữu ích hơn danh sách công nghệ:

1. Ledger và payment state machine vẫn là source of truth. Model không được mutate balance, authorization, settlement hay ledger state.
2. Notification bắt buộc vẫn phải được gửi khi AI không hoạt động. Với fraud alert cần nội dung chính xác, policy chọn template tất định thay vì chặn việc gửi. Với marketing message, policy có thể suppress hoặc defer.
3. Generated text chỉ được dùng minimal canonical fact object. Model không được suy diễn amount, currency, status, recipient hay payment identifier.
4. Processing phải chịu được event delivery at-least-once, trong khi side effect SEND bên ngoài cần chiến lược deduplication riêng.
5. Reviewer phải reconstruct được decision sau khi prompt, model, policy hoặc template thay đổi.
6. Provider call cần latency có giới hạn, retry có giới hạn, tenant isolation và cost budget rõ ràng.

Các constraint này vẫn để lại nhiều lựa chọn thiết kế. Chúng không biện minh cho việc trao thêm authority cho LLM.

## Ranh giới authority

Quyết định đầu tiên là tách fact khỏi ngôn ngữ. Payment event được map thành object canonical do domain sở hữu:

```text
PaymentFacts {
  paymentId, amount, currency, status, recipient, requiredReason
}
```

Model nhận minimal view và trả về structured output, chẳng hạn:

```json
{
  "title": "Payment completed",
  "body": "Your payment of 2,431,876 VND was completed.",
  "tone": "concise",
  "claims": ["amount=2431876", "currency=VND", "status=COMPLETED"]
}
```

Schema validator kiểm tra type và field bắt buộc; claim validator đối chiếu mọi claim với `PaymentFacts`; channel policy kiểm tra length, encoding, link và locale. Hệ thống không bao giờ parse fact ngược từ generated body. Nếu body nói amount khác, validation thất bại dù JSON hợp lệ.

Bước validation tạo ra một vấn đề mới: validator chặt hơn có thể reject draft chỉ vì cách viết vụng, làm fallback tăng. Đây là trade-off chấp nhận được để bảo vệ độ chính xác tài chính. Fallback rate được đo như tín hiệu sản phẩm và vận hành; chất lượng copy có thể cải thiện mà không làm yếu ranh giới fact.

```java
// RIGHT: facts and delivery authority stay outside the model
NotificationDecision decide(PaymentFacts facts, Policy policy) {
    AiDraft draft = policy.aiEnabled()
        ? llm.generate(facts.minimalView(), policy.promptVersion(), policy.deadline())
        : null;
    ValidatedCopy copy = policy.validateOrFallback(draft, facts);
    return policy.authorize(facts, copy); // send, suppress, or retry
}
```

`authorize` không phải LLM call. Nó áp dụng rule tất định cho payment status, notification purpose, recipient consent, yêu cầu pháp lý và channel khả dụng. Draft có confidence cao không thể bật một message bị cấm. Ngược lại, AI failure không thể ngăn required alert dùng safe template.

## Xử lý bất đồng bộ và failure mới

Generation không nên nằm trên payment authorization request. Nếu model path minh họa mất 400 ms, thêm nó vào payment request 200 ms sẽ tiêu hết latency budget và gắn money movement với service bên ngoài. Synchronous generation chỉ hợp lý cho preview không critical, khi user chấp nhận dependency đó.

Với required notification, FinPay có thể persist notification intent sau payment state transition rồi xử lý generation bất đồng bộ:

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

Cách này tách payment latency và làm các state pending, fallback, uncertain delivery trở nên rõ ràng. Cái giá là durable state và notification delivery có eventual consistency. User có thể thấy payment completed trước khi message được gửi.

Chọn at-least-once consumption vì mất required notification tệ hơn reprocess event. Nó tạo duplicate work, nên inbox record dùng atomic unique insert trên `(tenant_id, payment_id, purpose, channel)`. Consumer chỉ acknowledge event sau khi durable record commit. Outbox sau đó publish delivery work từ record này; Kafka hữu ích cho replay, database là record của notification state, còn OpenSearch chỉ là read model để search.

Unique insert bảo vệ storage, không bảo vệ SEND call. Hai worker vẫn có thể cùng đến provider sau crash xảy ra giữa lúc provider accept và local acknowledgement. Vì vậy delivery adapter dùng stable key như `notification/{tenant}/{payment}/{purpose}/{channel}` khi provider hỗ trợ idempotency. Nếu provider không hỗ trợ, ghi nhận uncertain result và reconcile; retry mù có thể gửi hai lần. Đây là trade-off khó tránh: không có provider deduplication, hệ thống không phải lúc nào cũng chứng minh được timed-out send đã xảy ra hay chưa.

## Provider failure cũng là bài toán capacity

Xét một incident minh họa lúc 14:03: model latency tăng từ 300 ms lên 4 giây. Deadline của consumer hết hạn, bounded retry với jitter bắt đầu, và retry budget nhanh chóng cạn. Nếu vẫn consume ở 200 notification/giây, pending queue tăng khoảng 200 item mỗi giây mà completed work không theo kịp. Thêm thread không sửa được provider; nó chỉ tiêu tốn connection và tăng pressure.

Adapter cần concurrency limit theo tenant và toàn cục, rate limiter, timeout ngắn và circuit breaker. Chỉ retry transient error như một số timeout hoặc response 5xx; không retry malformed output, authentication failure hay policy rejection. Backoff có jitter ngăn mọi worker retry cùng lúc. Khi budget hết, required message dùng template còn optional message chuyển sang deferred state.

Trade-off phải được nói rõ: fail-closed cho AI quality sẽ bảo vệ wording nhưng làm mất required alert. FinPay thay vào đó fail-closed với generated copy và fail-open sang deterministic template cho required delivery. Với operation rủi ro cao, policy có thể chọn step-up hoặc manual review, nhưng đó là domain decision, không phải generic exception handler.

AI outage không được biến thành database outage. Notification worker không nên giữ database transaction mở trong lúc chờ model. Hãy claim work atomically, gọi provider ngoài transaction, rồi commit kết quả với version check. Connection pool nên được sizing cho database work, không phải số model call tối đa.

## Security và auditability

Canonical fact mapper cũng là privacy boundary. Nó loại account identifier không cần thiết, free-form description và internal metadata trước external call. Event field vẫn là untrusted data: prompt injection trong merchant description không được override system instruction hoặc policy. Output được escape theo channel, còn link phải qua allowlist thay vì copy từ model text.

Kiểm tra tenant authorization trước khi tạo notification work. Credential của tenant được scoped adapter lấy từ secret manager; chúng không bao giờ đi vào prompt, generated content, trace hay log thông thường. Quyền đọc audit và search được kiểm soát riêng, cùng retention và deletion rule cho generated content và PII.

Audit record nên cho phép tái dựng decision mà không giả vờ model output là deterministic. Lưu `payment_id`, `event_id`, purpose, channel, `model_version`, `prompt_version`, `policy_version`, decision, reason, timestamp, output hash và provider outcome. Chỉ lưu generated content thật khi retention và access policy cho phép. Version giải thích vì sao replay về sau có thể tạo draft khác.

Trước khi đổi model hoặc prompt, hãy đánh giá trên một tập canonical fact đã được redacted và version hóa. Kiểm tra claim accuracy, độ bao phủ field bắt buộc, channel length, việc reject unsafe link, fallback rate và cost. Điểm offline đạt yêu cầu không phải quyền bỏ qua runtime validation. Monitoring production cần phát hiện drift trong rejection và fallback reason, vì provider model có thể đổi style hoặc behavior mà không cần FinPay code thay đổi. Rollout thay đổi theo tenant hoặc channel, đồng thời phải có cách tắt AI nhanh và giữ lại deterministic template.

## Thực tế vận hành

Lúc 3 AM, on-call cần biết notification trễ vì Kafka, database, model hay delivery provider. Các metric hữu ích gồm:

- Consumer lag, notification processing latency, inbox conflict rate và outbox age.
- Model latency, timeout và rate-limit count, retry attempt, circuit state, token usage và fallback rate.
- Validation failure theo reason, provider latency, provider error, uncertain delivery và duplicate-send attempt đã ngăn chặn.
- Business count cho required notification đã gửi, template fallback, optional notification deferred và policy suppression.

Không dùng `payment_id`, `account_id`, `event_id` hay `trace_id` làm Prometheus label. Đưa identifier vào structured log được bảo vệ hoặc trace context. Trace nên nối request hoặc payment ID, notification work, AI inference ID, model và prompt version, policy evaluation, outbox record và provider call. Alert nên dựa trên dimension có giới hạn như tenant, channel, provider và status.

Khi provider timeout làm delivery uncertain, runbook phải nói reconciliation diễn ra thế nào và khi nào cần manual review. Khi validation failure tăng sau prompt change, operator cần prompt version và sample đã redacted. Khi lag tăng, pause optional work trước required alert và bảo vệ database connection pool. Dead-letter queue dành cho poison event cần kiểm tra, không phải nơi required notification biến mất im lặng.

## Kết quả

Final architecture cố ý vừa đủ. Payment state và notification eligibility ở lại trong deterministic domain của FinPay. Async worker consume durable notification intent, tùy chọn hỏi LLM để tạo constrained copy, validate claim với canonical fact và chọn template khi draft không có hoặc không an toàn. Outbox chuyển work tới delivery adapter với stable idempotency key. Audit storage ghi lại reasoning, còn OpenSearch phục vụ điều tra mà không trở thành source of truth.

Ranh giới quan trọng không phải “AI so với template.” Đó là authority. LLM có thể làm required message rõ hơn, nhưng không thể làm payment trở thành sự thật, authorize một send, hoặc biến provider response không chắc chắn thành outcome chắc chắn.

## Bài học cho thiết kế FinPay lớn hơn

1. Bắt đầu từ side effect không thể đảo ngược. SEND cần guarantee mạnh hơn việc lưu một draft.
2. Giữ AI contract hẹp: structured output cộng claim validation, không extract fact từ prose.
3. Tách inbox idempotency khỏi provider-side send idempotency; cái này không tự kéo theo cái kia.
4. Để degraded behavior là một policy choice. Required alert dùng deterministic template; message tùy chọn có thể defer hoặc suppress.
5. Coi model, prompt, policy, template và provider behavior là các operational contract có version.
6. Để payment ledger tiếp tục có authority trong khi AI phát triển thành advisory layer xung quanh nó.
