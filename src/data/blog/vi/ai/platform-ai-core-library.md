---
title: "Thiết kế AI Core dùng chung cho FinPay: Từ failure mode đến guardrail"
description: "Thiết kế thực tế cho tích hợp LLM dùng chung với credential BYOK, cơ chế chống lỗi, idempotency và kết quả có audit."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

FinPay đã có những phần không được phép mang tính thử nghiệm: ledger là nguồn sự thật tài chính, settlement tuân theo các quy tắc deterministic, và payment state transition được payment core kiểm soát. Vấn đề mới hẹp hơn và mang tính vận hành:

Nhiều service FinPay muốn có AI hỗ trợ. Một service cần risk signal trong payment review. Service khác muốn KYC enrichment. Workflow support muốn classification. Làm thế nào thêm một dependency bên ngoài không ổn định và bị giới hạn rate mà không làm suy yếu các invariant đang bảo vệ tiền?

Insight trung tâm của thiết kế là: **AI phải dừng ở một boundary của typed signal.** Signal có thể hữu ích, đến trễ, sai, bị duplicate hoặc unavailable. Deterministic policy quyết định signal có ý nghĩa gì. Payment state machine quyết định transition nào hợp lệ. Ledger ghi lại kết quả tài chính.

```text
AI signal
    -> deterministic policy
    -> business state machine
    -> financial transaction
    -> ledger / settlement
```

Đây là reference design và bài tập về cách suy luận. Nội dung không khẳng định FinPay đã gặp các incident này hoặc đang chạy ở các volume ví dụ bên dưới.

## Một lần thử hợp lý

Hãy hình dung team payment-review thêm một AI call trực tiếp vào endpoint:

```java
// WRONG: secret, lời gọi không giới hạn và quyền quyết định nghiệp vụ nằm cùng request
String answer = llm.chat(apiKey, request.toJson());
return answer.contains("approve") ? APPROVE : REJECT;
```

Thiết kế này trông hiệu quả. Caller gửi request, nhận answer rồi tiếp tục. Production sẽ làm lộ các quyết định đang bị che giấu:

- Provider mất bao lâu thì request bị timeout?
- Failure nào được phép retry?
- Output malformed hoặc mâu thuẫn có nghĩa là gì?
- Model label có được phép authorize payment không?
- Evidence nào giúp investigator dựng lại kết quả?

Phần nguy hiểm nhất là parser dựa trên string. Model response là text, không phải payment command. Một thay đổi chính tả, một câu được thêm vào hoặc một label không được dự kiến có thể đổi nhánh xử lý. Quan trọng hơn, nó trao quyền cho một dependency bên ngoài thực hiện financial side effect.

Lần thử tiếp theo thường thêm duplicate check:

```java
// WRONG: hai consumer có thể cùng thấy false
if (!outcomeRepository.exists(eventId)) {
    outcomeRepository.save(new Outcome(eventId, signal));
}
```

Check này không phải atomic claim. Hai consumer xử lý một event redeliver có thể cùng đọc `false`, cùng gọi provider và cùng thử ghi. Ngay cả khi unique index bảo vệ row, nó cũng không khiến email, HTTP request hoặc review-case creation phía sau trở thành exactly once.

Vấn đề cuối là latency. Giả sử minh họa 200 request mỗi giây và 750 ms chờ toàn bộ AI path:

```text
concurrency = throughput x latency
            = 200 x 0.75
            = 150 in-flight requests
```

Đây là giả định minh họa cho capacity reasoning, không phải measurement của FinPay. Nếu provider latency tăng lên 4 giây, cùng arrival rate tạo khoảng 800 in-flight call. Cộng thêm retry, database write, connection-pool limit và gateway timeout. Provider chậm có thể chiếm tài nguyên của caller, rồi kích hoạt client retry và làm tải tới provider tăng đúng lúc outage đang xảy ra.

“Thêm retry” tự nó không phải resilience strategy. Nó có thể khuếch đại outage.

## Constraint trước component

Trước khi chọn Kafka, cache, shared library hay service riêng, chúng ta ghi rõ các constraint:

- Ledger và payment state machine đã sở hữu balance, authorization, settlement và các transition không thể đảo ngược.
- AI có thể trả về risk signal, classification, explanation, recommendation hoặc enrichment có giới hạn. AI không được mutate balance, ledger entry, settlement state, authorization hay financial state.
- Tenant có thể mang credential provider riêng (BYOK). Credential phải đến từ secret manager, không được vào source code, prompt hoặc log.
- Inference có thể chậm, unavailable, bị rate-limit, nondeterministic hoặc đắt hơn dự kiến.
- Mỗi workflow cần degraded mode rõ ràng. `AI_FAILED` không được ngầm có nghĩa là `APPROVE` hoặc `REJECT` trong mọi trường hợp.
- Investigator cần đủ evidence để dựng lại kết quả, trong khi raw payload nhạy cảm phải được giảm thiểu và kiểm soát truy cập.

Các constraint này cho biết nhiều hơn một component diagram. Chúng ta cần một technical contract hẹp, call có giới hạn, output được validate, durable outcome state và ranh giới rõ giữa AI observation với business decision.

## Các lựa chọn và quyết định

### Provider client trong từng service

Mỗi service tự sở hữu provider adapter. Cách này đơn giản lúc bắt đầu và cho phép thử nghiệm cục bộ. Nó cũng tạo policy drift: timeout, credential handling, retry, schema và audit field sẽ khác nhau. Càng thêm caller, càng khó chứng minh mọi caller đều xử lý provider failure an toàn.

### Một AI service lớn

Service trung tâm có thể chuẩn hóa behavior. Nhưng nếu nó cũng sở hữu payment threshold hoặc phát payment command, nó trở thành business authority thứ hai. Một service generic không thể biết loss tolerance, yêu cầu pháp lý hay fallback phù hợp của từng workflow.

### Shared technical core

Một module dùng chung hoặc internal service có scope hẹp có thể sở hữu technical control lặp lại, còn business meaning ở caller. Cách này có cost về versioning và adoption; library cũng có thể bị bypass. Tuy vậy, đây là cost dễ nhìn thấy hơn việc giấu business policy trong một AI authority trung tâm.

### Synchronous và asynchronous execution

Inference đồng bộ giữ user flow đơn giản và hợp lý khi signal cần ngay, latency budget đủ cho provider. Cái giá là availability bị liên kết: provider outage nằm trên payment path.

Inference bất đồng bộ tách payment latency và cho phép giới hạn consumer concurrency, replay cùng review sau. Cái giá là eventual consistency. Payment có thể cần state `PENDING_RISK`, giới hạn queue age và product decision cho payment pending quá lâu.

Chúng ta chọn shared technical core với một signal contract và cả hai execution mode. Caller quan trọng với payment chỉ dùng synchronous call có giới hạn chặt khi policy chứng minh dependency này cần thiết. Enrichment, review và phân tích sau dùng asynchronous path. Không ép mọi AI use case vào cùng một latency model.

## Contract bảo vệ ledger

Core expose một port hẹp như `assess(SignalRequest) -> AISignal`. `AISignal` có thể chứa score có giới hạn, label từ enum được cho phép, confidence, reason code, model version, prompt version và status rõ ràng như `VALID`, `TIMEOUT` hoặc `INVALID_OUTPUT`.

Policy sở hữu đánh giá signal cho payment, tenant và risk tier cụ thể. Payment state machine validate rồi thực hiện transition hợp lệ. Chỉ deterministic path thông thường mới được ghi ledger hoặc settlement state.

Boundary này cũng làm model change dễ giải thích hơn. Model mới có thể trả score khác cho cùng input, nhưng model version và policy version được lưu cho biết value và rule nào tạo ra outcome. Khi AI unavailable, policy có thể chọn deterministic check, step-up verification, manual review hoặc delayed processing. Response đúng phụ thuộc workflow; core báo failure và không tự tạo response.

```text
payment / review service
        |
        | SignalRequest: input đã minimize + correlation context
        v
  shared AI core
  - secret resolution
  - provider adapter
  - deadline / retry budget / circuit / concurrency limit
  - structured-output validation
        |
        v
  AISignal + durable outcome
        |
        +--> deterministic policy --> payment state machine --> ledger / settlement
        |
        +--> outbox --> notifications / cases / other effects
```

Mỗi box có lý do tồn tại. Core cô lập provider behavior. Validation ngăn text trở thành control flow. Durable outcome làm redelivery an toàn. Policy và state machine giữ financial authority. Outbox tách committed state khỏi các effect có thể retry.

## Idempotency có hai boundary

Boundary đầu tiên là durable storage. Để database phân xử concurrent delivery, dùng unique constraint trên `(tenant_id, event_id)`:

```java
try {
    outcomeRepository.insertUnique(tenantId, eventId, signal);
    outboxRepository.insert(tenantId, eventId, "RISK_SIGNAL_RECORDED");
} catch (DuplicateKeyException alreadyProcessed) {
    return outcomeRepository.get(tenantId, eventId);
}
```

Outcome và outbox row nên commit cùng nhau. Nếu consumer crash sau commit nhưng trước khi acknowledge event, redelivery sẽ tìm thấy outcome đã có. Cache hoặc search index có thể tăng tốc read; không component nào thay thế được database arbitration này.

Boundary thứ hai là side effect. Outbox worker có thể gửi cùng notification hoặc case request nhiều lần. Mỗi effect cần stable key như `(tenant_id, event_id, effect_type)`, receiver phải enforce key đó hoặc worker phải giữ effect state bền vững. Storage idempotency không làm email hay HTTP call trở thành idempotent.

Provider call cũng không được giả định là exactly once. Timeout có thể xảy ra sau khi provider đã nhận request. Retry có thể lặp inference nếu provider không công bố hỗ trợ request idempotency key. Core phải báo điều nó biết, lưu một outcome có authority cho event và không hứa guarantee nó không thể cung cấp.

## Failure mới do async tạo ra

Lựa chọn asynchronous loại provider latency khỏi request path. Nó tạo queue, vì vậy xuất hiện câu hỏi mới:

- `PENDING_RISK` có thể cũ bao lâu trước khi cần escalation?
- Làm gì khi event đến duplicate hoặc out of order?
- Consumer được phép admit bao nhiêu work khi provider bị rate-limit?
- Operator có thể replay dead-letter event mà không tạo financial effect thứ hai không?

Inbox hoặc unique outcome key xử lý duplicate delivery. Payment sequence hoặc workflow version có thể enforce ordering cần cho một workflow; global ordering đắt hơn và thường không cần. Giới hạn concurrency trước provider call để queue tăng không biến thành burst không kiểm soát tới provider. Replay giữ event identity ban đầu và dùng cùng idempotency rule.

Trade-off được nói rõ: chúng ta chấp nhận eventual consistency để bảo vệ payment request khỏi model latency, rồi đưa queue age và cách xử lý pending state vào business design.

## Resilience là một budget

Mỗi request nhận một total deadline. Provider attempt, backoff, retry, response validation và persistence phải nằm trong deadline đó. Chỉ retry transient failure đã chọn, chẳng hạn rate limit hoặc temporary server error. Không retry schema invalid, payload bị từ chối hay policy decision. Exponential backoff với jitter tránh retry đồng bộ; retry budget ngăn traffic lúc recovery trở thành outage thứ hai.

Trong incident minh họa lúc 14:03, provider latency tăng từ 300 ms lên 4 giây. Admission control dừng synchronous work không giới hạn. Client timeout trong budget được cấp. Circuit breaker mở sau failure threshold đã cấu hình. Consumer không tiếp tục tăng concurrency. Signal được ghi là `AI_TIMEOUT`, và policy sở hữu route workflow vào fallback đã khai báo.

Circuit breaker không có admission control chỉ thay đổi thời điểm queue đầy. Fallback không phải technical default. Core có thể trả unavailable signal cùng evidence; policy chọn deterministic check, step-up verification, manual review hoặc delay. Path được gắn nhãn fallback. Hệ thống không bịa confidence hoặc âm thầm biến outage thành approval.

## Safety, credential và evidence

Provider output phải khớp schema có version. Thiếu field, label không biết, value mâu thuẫn, JSON hỏng hoặc confidence ngoài range đều trở thành `INVALID_OUTPUT`. Hệ thống không suy đoán intent từ free-form text.

Payment description và support note là untrusted input. Hãy phân tách chúng, chỉ gửi subset nằm trong allowlist và validate response như data. Giảm thiểu name, account number, address và regulated identifier bằng derived feature, redaction hoặc tokenization. BYOK hỗ trợ credential riêng của tenant và cost attribution, nhưng thêm secret-manager traffic và rotation race. Cache credential ngắn hạn có thể giảm traffic, đổi lại có stale credential; vì vậy cần TTL và refresh behavior.

Raw prompt và provider payload không mặc nhiên là audit record phù hợp. Chỉ giữ evidence tối thiểu cần cho investigation, bảo vệ quyền truy cập và lưu hash hoặc reference khi không nên giữ payload. Hash không phải anonymization nếu input space đủ nhỏ để khôi phục bản gốc.

## Vận hành thiết kế

On-call engineer phải trả lời được provider và model nào đang lỗi, call đang chờ hay đang chạy, retry có tiêu budget không, và workflow nào đang fallback hoặc pending.

Metric aggregate hữu ích gồm gateway và AI latency, timeout và invalid-output rate, provider error và rate-limit, circuit state, consumer lag, queue age, outbox age, duplicate conflict, database connection utilization và dead-letter rate. Business metric gồm fallback rate, manual-review rate, policy outcome và các mẫu false-positive hoặc false-negative đã review theo model và policy version.

Không đưa `transaction_id`, `account_id`, `event_id` hoặc trace ID vào Prometheus label. Đưa correlation data vào structured log được kiểm soát và trace context. Trace nên nối request, payment, event, inference, model version và policy version mà không lộ prompt hay credential. Audit record phải phân biệt AI signal với deterministic action đi sau nó.

Dead-letter record cần owner và replay procedure, không chỉ topic name. Replay phải giữ event identity ban đầu và dùng cùng idempotency rule. Capacity review nên bao gồm peak event rate, consumer concurrency, provider quota, database unique-index contention, connection pool, secret-manager QPS, search indexing rate, token budget và số attempt tăng thêm do retry. Cost là một phần của reliability: prompt hoặc retry loop không giới hạn có thể làm cạn budget tenant trước khi infrastructure limit kích hoạt.

## Điều rút ra

Shared AI core có giá trị không phải vì nó giấu AI sau một abstraction lớn hơn. Nó có giá trị vì làm failure behavior nhất quán và visible trong các workflow payment, KYC, review và operations đang phát triển của FinPay.

Quy tắc bền vững là:

```text
AI signal -> deterministic policy -> business decision
```

Ledger vẫn là financial truth. Khi có lý do chính đáng, Kafka cung cấp replay cho asynchronous work; database ghi durable outcome, inbox state và outbox state; search index là investigation view có thể rebuild. Idempotent storage bảo vệ event record, còn idempotent effect bảo vệ các system được gọi sau đó.

AI có thể cải thiện, giải thích hoặc ưu tiên một decision. AI không thể trở thành authority di chuyển tiền của FinPay.

<!-- finpay-repo-link -->

## Triển khai tham khảo FinPay

Bài viết này thuộc series tham khảo FinPay. Mã nguồn dịch vụ liên quan nằm trong repo [finpay-lab/platform](https://github.com/finpay-lab/platform).
