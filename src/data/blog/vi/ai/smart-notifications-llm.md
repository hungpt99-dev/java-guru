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

## Incident Làm Thay Đổi Thiết Kế

Payment core của FinPay đã có phần khó nhất của một payment system: xác thực payment, chuyển payment state machine và ghi kết quả có thẩm quyền vào ledger. Notification eligibility cũng là quyết định của domain. Nếu payment completed, receipt có thể là notification bắt buộc; nếu payment bị reject, khách hàng có thể cần message lỗi chính xác.

Tính năng AI được đề xuất nghe có vẻ vô hại: để LLM làm cho các message rõ ràng và tự nhiên hơn.

Nhưng hãy xét payment completed có canonical event chứa `2,431,876 VND`. Model viết: “Payment của bạn khoảng 2.4M VND đã completed.” Đây không chỉ là vấn đề style. Hệ thống đã thay đổi một financial fact. Một draft khác có thể bỏ qua fraud alert bắt buộc, copy recipient từ text do attacker kiểm soát, hoặc mô tả payment failed thành successful.

Vì vậy câu hỏi thiết kế trung tâm là: **một language service không đáng tin cậy được phép tham gia ở đâu, và ở đâu code tất định của FinPay phải giữ authority?**

Câu trả lời phải hẹp một cách có chủ đích:

```text
canonical payment facts -> AI draft -> claim validator -> domain policy -> delivery
                                          (untrusted)       (authority)
```

LLM được đề xuất ngôn ngữ. Nó không được authorize notification, thay đổi payment state, mutate ledger hoặc quyết định SEND không thể đảo ngược. Đây là production-oriented design được đề xuất, không phải khẳng định về một hệ thống FinPay đã triển khai. Các con số capacity bên dưới là giả định minh họa.

## Bắt Đầu Từ Thay Đổi Nhỏ Nhất

Implementation đầu tiên thường trông như sau:

```java
// WRONG: deliberately unsafe; do not ship
public String copyFor(NotificationEvent event) {
    return llm.complete("Write a friendly notification: " + event.rawPayload());
}
```

Nó có vẻ chỉ thêm một dependency. Thực tế, một string call đang che giấu ba quyết định:

- Model thấy raw event, gồm field không cần thiết, PII và cả instruction do merchant kiểm soát.
- Caller không biết từ nào là payment fact, từ nào là nội dung được bịa.
- Call không có timeout bounded, output contract, fallback, audit record hoặc cơ chế chống delivery lặp.

Giả sử minh họa traffic đạt 200 notification/giây và provider mất 4 giây để response. Little's Law cho khoảng `200 x 4 = 800` model call đang in-flight trước khi tính retry. Thêm thread chỉ làm tăng áp lực lên connection pool mà không tăng capacity của provider. Nếu consumer chờ synchronous, model latency trực tiếp làm notification processing trễ; nếu đặt call trên payment request, provider bên ngoài bị gắn với money movement.

Race nguy hiểm hơn xuất hiện sau generation. Worker có thể generate copy, gọi delivery provider, timeout khi provider đang accept request rồi retry. Kiểm tra database bằng `exists()` không chứng minh được external send đầu tiên đã xảy ra hay chưa. Kết quả có thể là hai message cho khách dù payment event chỉ được xử lý một lần.

Vì vậy bài toán không phải “prompt thế nào cho tốt hơn?”. Bài toán là giữ component advisory cách xa fact và irreversible side effect, đồng thời chấp nhận duplicate event và provider outcome không chắc chắn.

## Constraint Trước Infrastructure

Constraint quyết định thiết kế đáng tin cậy hơn một technology stack có sẵn:

1. Ledger và payment state machine là source of truth. AI không được mutate balance, authorization, settlement hoặc ledger state.
2. AI downtime không được chặn required notification. Required alert có thể dùng deterministic template; optional message có thể defer hoặc suppress theo policy.
3. Prompt chỉ nhận minimal canonical fact object. Model không được suy diễn amount, currency, status, recipient hoặc payment ID từ prose.
4. Event processing phải chịu được at-least-once delivery. External SEND side effect cần chiến lược idempotency riêng.
5. Reviewer phải reconstruct được fact nào, version nào, policy decision nào và provider outcome nào đã tạo notification.
6. Provider work cần deadline, retry bounded, isolation theo tenant, concurrency limit và cost budget.

Các constraint này không bắt buộc phải có Kafka, search cluster hay LLM. Chúng bắt buộc phải có durable state, authority boundary và behavior rõ ràng khi dependency failure.

## Các Lựa Chọn: Generation Nằm Ở Đâu?

**Synchronous generation trên payment request** cho copy ngay lập tức và control flow đơn giản. Nhưng nó tiêu payment latency budget cho một provider không có authority. Model timeout có thể làm payment request thành công bị fail, hoặc buộc payment service gánh work không ảnh hưởng đến ledger. Điều đó không phù hợp với required notification path.

**Synchronous generation trong notification consumer** loại dependency khỏi payment authorization nhưng vẫn giữ worker trong lúc chờ provider. Cách này có thể đủ ở volume thấp với deadline chặt, nhưng provider chậm sẽ chuyển thẳng thành consumer backlog và connection pressure.

**Asynchronous generation sau khi persist durable notification intent** thêm eventual delivery và nhiều state hơn, nhưng tách payment latency và làm pending, fallback, uncertain delivery trở nên rõ ràng. Nó cũng cho phép ưu tiên required work trước optional copy.

Chúng ta chọn async boundary vì wording của notification hữu ích nhưng không có authority. Payment transition phải hoàn tất độc lập. Đây là trade-off, không phải quy tắc tuyệt đối: preview hiển thị cho user có thể synchronous nếu caller chấp nhận copy unavailable hoặc stale.

## Ranh Giới Authority

Event trước hết được map thành object do domain sở hữu, thay vì truyền nguyên event vào model:

```text
PaymentFacts {
  paymentId, amount, currency, status, recipient, requiredReason
}
```

LLM chỉ nhận minimal view và phải trả structured output:

```json
{
  "title": "Payment completed",
  "body": "Your payment of 2,431,876 VND was completed.",
  "tone": "concise",
  "claims": ["amount=2431876", "currency=VND", "status=COMPLETED"]
}
```

Structured output không đồng nghĩa trusted output. Schema validator kiểm tra type và field bắt buộc. Claim validator đối chiếu từng claim với `PaymentFacts`. Channel policy kiểm tra length, encoding, locale và link. Hệ thống không extract payment fact ngược từ prose. Nếu body nói amount khác, draft bị reject dù JSON hợp lệ.

Boundary chặt hơn tạo ra failure mới: draft chỉ hơi vụng cũng bị reject, khiến template fallback tăng. Chúng ta chấp nhận chi phí này vì financial statement sai nguy hiểm hơn wording kém cá nhân hóa. Đo rejection theo reason để cải thiện prompt và template mà không làm yếu validation.

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

`authorize` là deterministic. Nó áp dụng payment status, notification purpose, recipient consent, yêu cầu pháp lý và channel availability. Draft thuyết phục đến đâu cũng không thể bật một message bị cấm. AI failure cũng không thể ngăn required alert dùng safe template.

## Failure Mới: Async Vẫn Có Thể Gửi Trùng

Thiết kế async cần durable notification intent sau payment state transition:

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

Mỗi box tồn tại vì một lý do. Event mang work qua process boundary; inbox làm event handling idempotent; fact mapper tạo authority boundary; adapter tùy chọn cô lập provider không đáng tin; validation và fallback bảo vệ content; outbox làm delivery work durable; audit giải thích decision; OpenSearch phục vụ điều tra nhưng không làm source of truth.

Chọn at-least-once consumption vì mất required notification âm thầm tệ hơn reprocess. Inbox dùng atomic unique insert trên `(tenant_id, payment_id, purpose, channel)`, consumer chỉ acknowledge sau khi durable record commit. Database là record của notification state; Kafka hữu ích cho transport và replay; search index chỉ là read model.

Nhưng cách này chỉ giải quyết duplicate processing, không giải quyết duplicate external send. Worker có thể crash sau khi provider accept nhưng trước local acknowledgement. Vì vậy delivery adapter gửi stable key như `notification/{tenant}/{payment}/{purpose}/{channel}` khi provider hỗ trợ idempotency. Nếu provider không có deduplication, outcome sau timeout thực sự là uncertain. Hãy ghi state đó và reconcile; đừng retry mù rồi gọi kết quả là “exactly once.”

Outbox cũng thêm operational work: một row có thể được publish hai lần, bị kẹt, hoặc được delivery khi notification record đã đổi. Publish và claim cần version check cùng idempotent consumer. Mỗi guarantee bảo vệ một boundary khác nhau; không có một inbox hay một transaction nào bảo vệ toàn bộ chain.

## Provider Failure Là Bài Toán Capacity

Xét incident minh họa khác. Lúc 14:03, model latency tăng từ 300 ms lên 4 giây. Deadline hết hạn, bounded retry với jitter bắt đầu và retry budget cạn. Ở 200 notification/giây, backlog tăng khoảng 200 item mỗi giây nếu completed work không theo kịp. Thêm worker thread chỉ tiêu tốn thêm connection và provider quota.

Vì vậy LLM adapter cần timeout ngắn, concurrency limit toàn cục và theo tenant, rate limiting và circuit breaker. Chỉ retry một số timeout transient và response 5xx. Không retry malformed output, authentication failure hoặc policy rejection. Backoff có jitter tránh retry đồng bộ. Khi retry budget hết, required message dùng template còn optional message chuyển sang deferred.

Đây là lựa chọn degraded mode quan trọng: fail-closed với generated copy, nhưng fallback sang deterministic content cho required delivery. Với notification rủi ro cao, policy có thể chọn step-up hoặc manual review. Đó là domain decision, không phải exception handler giấu trong LLM client.

Worker không được giữ database transaction mở trong lúc chờ model. Hãy claim work atomically, gọi provider ngoài transaction rồi commit result bằng version check. Sizing database connection pool theo database work, không theo số model call tối đa.

## Security Và Auditability Là Một Phần Của Boundary

Canonical mapper là privacy boundary. Nó loại account identifier, free-form description và internal metadata không cần thiết trước external call. Merchant text vẫn là untrusted input: prompt injection không được override system instruction hoặc policy. Escape output theo channel và allowlist link thay vì copy URL từ model text.

Kiểm tra tenant authorization trước khi tạo notification work. Scoped adapter lấy credential của tenant từ secret manager; credential không bao giờ đi vào prompt, generated content, trace hoặc log thông thường. Audit và search có authorization, retention và deletion rule riêng cho generated content và PII.

Audit record phải reconstruct decision mà không giả vờ model output deterministic. Lưu `payment_id`, `event_id`, purpose, channel, `model_version`, `prompt_version`, `policy_version`, decision, reason, timestamp, output hash và provider outcome. Chỉ lưu generated content khi retention và access policy cho phép. Versioning giải thích vì sao replay về sau có thể tạo copy khác.

Trước khi đổi model hoặc prompt, đánh giá trên tập canonical fact đã redacted và version hóa. Kiểm tra claim accuracy, required-field coverage, channel length, unsafe-link rejection, fallback rate và cost. Offline quality không thay thế runtime validation. Rollout theo tenant hoặc channel, đồng thời giữ kill switch để tắt AI nhanh mà deterministic template vẫn hoạt động.

## Thực Tế Vận Hành

Lúc 3 AM, on-call phải phân biệt Kafka lag, database contention, model failure và delivery-provider failure. Metric hữu ích gồm:

- Consumer lag, processing latency, inbox conflict rate và outbox age.
- Model latency, timeout, rate limit, retry attempt, circuit state, token usage và fallback rate.
- Validation failure theo reason, provider latency và error, uncertain delivery và duplicate send đã được ngăn.
- Required notification đã gửi, template fallback, optional notification deferred và policy suppression.

Không dùng `payment_id`, `account_id`, `event_id` hoặc `trace_id` làm Prometheus label. Đưa identifier vào protected structured log hoặc trace context. Trace nên nối payment work, notification work, AI inference ID, model và prompt version, policy evaluation, outbox record và provider call.

Runbook phải giải thích reconciliation cho uncertain delivery và ngưỡng cần manual review. Khi validation failure tăng sau prompt change, operator cần prompt version. Khi backlog tăng, pause optional work trước required alert và bảo vệ database connection pool. Dead-letter queue dành cho poison event cần điều tra, không phải nơi required notification biến mất im lặng.

## Kiến Trúc Cuối Cùng

Thiết kế cuối cùng vừa đủ vì bài toán không cần AI có authority:

```text
Payment state machine + ledger
             |
     durable notification intent
             |
     async worker and policy
        /             \
 constrained LLM       deterministic template
        \             /
      claim/channel validation
             |
       outbox + delivery adapter
             |
        external provider
```

Payment state và notification eligibility vẫn deterministic. Worker tùy chọn hỏi LLM để tạo constrained copy, validate với canonical facts và fallback khi không chứng minh được safety. Outbox chuyển delivery work bằng stable idempotency key. Audit ghi reasoning; search hỗ trợ điều tra nhưng không bao giờ là source of truth.

Ranh giới đáng nhớ không phải “AI so với template.” Đó là authority. LLM có thể làm required message rõ hơn, nhưng không thể làm payment thành sự thật, authorize một send hoặc biến provider response không chắc chắn thành outcome chắc chắn.

## Bài Học Cho FinPay Lớn Hơn

1. Bắt đầu từ irreversible side effect. Gửi message cần reasoning mạnh hơn lưu draft.
2. Giữ AI contract hẹp: structured output và claim validation, không extract fact từ prose.
3. Inbox idempotency và provider-side send idempotency giải quyết hai failure khác nhau.
4. Degraded behavior phải là policy choice. Required alert dùng deterministic template; optional message có thể defer hoặc suppress.
5. Version hóa model, prompt, policy, template và provider outcome thành operational contract.
6. Để payment ledger tiếp tục có authority trong khi AI phát triển xung quanh nó như advisory layer.
