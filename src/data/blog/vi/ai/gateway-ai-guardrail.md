---
title: "Thiết kế AI guardrail cho payment API gateway"
description: "Thiết kế dựa trên bài toán để giữ tín hiệu AI có tính xác suất ngoài quyết định thanh toán có thẩm quyền, đồng thời bảo đảm an toàn, latency, replay và audit."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## Ranh giới cần có

FinPay đã có payment core. Ledger là hệ thống ghi nhận chính; settlement là một state machine xác định. Một payment chỉ được chuyển từ `RECEIVED` sang `AUTHORIZED`, `HELD` hoặc `REJECTED` thông qua các business rule có thể audit và replay.

Giờ đây merchant gửi payment kèm một ghi chú dạng văn bản tự do. Ghi chú có thể chỉ là ngữ cảnh vô hại, một nỗ lực vượt qua rule review, hoặc văn bản khách hàng không tin cậy sao chép vào request. Đội ngũ muốn kiểm tra bằng AI trước khi route payment. Yêu cầu này nghe như “gửi text cho model rồi từ chối nếu kết quả xấu”. Thực tế không đơn giản như vậy. Model từ xa chậm, có tính xác suất, tốn chi phí, và do một provider nằm ngoài phạm vi lỗi mà FinPay trực tiếp kiểm soát.

Câu hỏi thiết kế thực sự là:

> Làm thế nào để API gateway sử dụng một dependency không chắc chắn mà không cho phép nó trực tiếp authorize, reject hoặc mutate tiền?

Đây là thiết kế tham chiếu hư cấu, không phải tuyên bố về một hệ thống FinPay đã triển khai. Ranh giới trung tâm dưới đây là thiết kế đề xuất, không phải kết luận từ số đo production:

```text
AI inference -> bounded AI signal -> deterministic policy -> business decision -> financial state transition
```

Model có thể báo `injection_suspected`, một risk score hoặc một classification. Model không được update account balance, ghi ledger, authorize settlement, hay biến phần giải thích của chính nó thành payment command.

## Thiết kế hiển nhiên thất bại

Bản phác thảo đầu tiên hấp dẫn vì gần như không có component:

```text
client -> JWT authentication -> LLM -> route or reject -> payment service
```

Gateway gửi request đã authenticate cho model và chỉ route nếu model trả về `allow`. Như vậy model trở thành một authorization service ẩn. Đồng thời mọi payment đều phụ thuộc vào latency và availability của provider.

Giả sử cho mục đích minh họa gateway nhận 10.000 request mỗi giây và provider mất hai giây. Stage model tạo ra xấp xỉ:

```text
in-flight concurrency = throughput x latency = 10,000/s x 2s = 20,000 calls
```

Ở mười giây, cùng lưu lượng đó tạo ra 100.000 call đang xử lý. Tăng thread pool không tạo thêm capacity cho provider. Nó chỉ tiêu thụ memory, connection và downstream slot cho tới khi queue trở thành sự cố.

Vấn đề thứ hai là timeout không tự ngăn lỗi lan truyền. Giả sử lúc 14:03 latency của provider tăng từ 300 ms lên 4 giây. Gateway worker bị giữ lâu hơn, deadline của các layer hết hạn ở những thời điểm khác nhau, và một retry lạc quan gửi request thứ hai trong khi request đầu có thể vẫn đang chạy. Connection pool đầy. Provider bắt đầu trả lỗi rate limit. Retry queue phình ra, khiến payment bình thường phải cạnh tranh với các AI call đã lỗi. Circuit breaker và concurrency limit không phải đồ trang trí hiệu năng; chúng ngăn dependency này kéo payment path xuống theo.

Kết quả của model cũng tạo ra vấn đề correctness. Model có thể trả JSON hợp lệ nhưng chứa amount không thể xảy ra, lý do bịa ra, hoặc false positive có độ tin cậy cao. False negative có thể để lọt payment đáng ngờ; false positive có thể từ chối merchant hợp lệ. Không hậu quả nào nên được chọn một cách ngầm định bởi nhánh timeout hoặc parser tình cờ chạy.

Cuối cùng, chuyển sang async cũng không tự động an toàn. Consumer có thể crash sau khi gọi downstream service nhưng trước khi ghi trạng thái hoàn tất. Message được giao lại. Một lần `exists()` rồi insert cho phép hai consumer cùng thấy “chưa có” và cùng gọi provider. Search index có thể nhận verdict trong khi bản ghi durable bị thiếu, hoặc index lỗi trong khi payment vẫn khỏe. Search là read model, không phải ledger.

## Xác định constraint trước component

Trong ví dụ này, ta giả định các constraint sau. Đây là assumption, không phải số đo production của FinPay:

- Authorization của payment và các chuyển trạng thái ledger phải deterministic, có audit, và độc lập với response của LLM.
- Budget synchronous của gateway có giới hạn. Thiết kế phải nói rõ điều gì xảy ra khi hết budget.
- Free text là input không tin cậy. Không được gửi PII của khách hàng hay credential cho model chỉ vì gateway có thể truy cập chúng.
- Quota, latency, thay đổi model và outage của provider nằm ngoài quyền kiểm soát trực tiếp của FinPay.
- Analysis phải replay đủ để điều tra quyết định, trong khi prompt thô và dữ liệu payment phải tuân theo retention policy.
- Duplicate delivery và consumer crash là các sự kiện recovery bình thường, không phải trường hợp ngoại lệ.
- Search và dashboard có thể tạm unavailable mà không được thay đổi financial truth.

Các constraint này loại bỏ ý tưởng “LLM là bước kiểm tra cuối cùng”. Nhưng chúng chưa quyết định mọi request có phải chờ synchronous hay không.

## Chọn detector

Rule phù hợp với schema validation, allowlist, amount limit và các mẫu prompt injection rõ ràng. Chúng nhanh và dễ giải thích, nhưng khả năng tổng quát hóa hạn chế.

Velocity và thống kê theo nhóm tương đồng có thể phát hiện amount hoặc frequency bất thường. Chúng ít tốn kém, nhưng hành vi merchant theo mùa có thể trông như anomaly. Một model truyền thống đã calibrate có thể phù hợp hơn cho risk score ổn định, nếu FinPay có label, drift check và quy trình release.

LLM hữu ích khi signal phụ thuộc vào free text mơ hồ hoặc cần trích xuất có cấu trúc nhỏ. Đây cũng là lựa chọn khó dự đoán nhất: output có thể không deterministic, latency và cost thay đổi, và một ghi chú độc hại có thể cố ảnh hưởng tới instruction. Gateway không nên dùng LLM ở nơi rule hoặc model đã calibrate là đủ.

AI core dùng chung từ bài viết FinPay trước cung cấp `LlmPort` hẹp, redaction, deadline, provider metadata và metrics. Dùng lại port này tránh lặp cơ chế provider. Nhưng nó không được che giấu policy của gateway. KYC intake và giải thích có retrieval-augmentation là các use case bounded khác; guardrail này không nên truy xuất knowledge tùy ý hoặc gửi toàn bộ customer profile tới provider bên ngoài chỉ vì nó dùng chung client AI.

## Giới hạn signal

Port nên nhận input theo một mục đích cụ thể, không phải chat transcript tổng quát:

```java
record BoundedInput(
        String paymentId,
        String merchantText,
        long amountMinor,
        String currency) {}

record AiSignal(
        String classification,
        double confidence,
        String modelVersion,
        String promptVersion) {}
```

Adapter redact hoặc tokenize field trước khi gọi, giới hạn kích thước input và output, đồng thời validate structured output nghiêm ngặt. Response đúng cú pháp vẫn cần semantic check: confidence phải nằm trong range, classification phải được biết, và model không được tự tạo ra payment fact có thẩm quyền. Adapter có deadline cho connection, read và toàn bộ operation. Chỉ retry lỗi transient đã phân loại, và chỉ khi deadline còn đủ.

Nếu request có budget 300 ms, retry thêm 300 ms là vi phạm budget. Exponential backoff có jitter, chính sách xử lý rate limit, circuit breaker và concurrency limit giúp giới hạn thiệt hại. Khi provider unavailable, adapter trả về kết quả kiểu `unavailable`, không âm thầm biến nó thành `allow`.

## Sync, async hay hybrid?

Ba lựa chọn đều hợp lý.

**Synchronous blocking.** Provider khỏe cho signal ngay, nhưng availability của payment bị gắn với latency, quota và health của model. Chỉ dùng khi đây là một gate hẹp và business chấp nhận rõ latency cũng như degraded mode.

**Asynchronous analysis sau acceptance.** Gateway accept payment và publish event; consumer phân tích sau đó, rồi có thể chuyển payment sang `HELD` hoặc `REVIEW`. Cách này bảo vệ latency của gateway và hỗ trợ replay, nhưng không thể ngăn side effect đã authorize. Payment state machine phải hỗ trợ trạng thái pending hoặc đường compensating.

**Hybrid bounded gate.** Cheap deterministic check chạy synchronous. Chỉ một subset được gọi model trong deadline nghiêm ngặt; analysis sâu hơn được publish để xử lý async. Cách này cần nhiều thiết kế hơn, nhưng giữ high-volume path ổn định và cho case không chắc chắn một kết quả có kiểm soát.

Ta chọn hybrid cho hệ thống tham chiếu này vì nó giữ một safety boundary synchronous nhỏ mà không biến AI thành điều kiện bắt buộc của mọi payment. Outcome cụ thể là quyết định về product và risk:

- `fail-open` bảo vệ availability nhưng tăng exposure khi provider outage;
- `fail-closed` giảm exposure nhưng có thể biến outage thành denial of service;
- `STEP_UP` yêu cầu authentication mạnh hơn và tạo thêm friction;
- `REVIEW` giữ payment ở trạng thái pending deterministic.

Payment rủi ro thấp có thể dùng rule deterministic khi AI unavailable. Nhóm payment rủi ro cao có thể yêu cầu step-up hoặc review. “AI lỗi nên block tất cả” không phải kiến trúc; đó là một quyết định business chưa được xem xét.

## Async tạo ra vấn đề correctness mới

Event boundary tách latency, nhưng at-least-once delivery nghĩa là consumer phải chờ duplicate. Đoạn code sau không an toàn:

```java
// WRONG: the check and the side effect are separate.
if (!store.exists(eventId)) {
    AiSignal signal = llm.analyze(input);
    settlementApi.execute(signal);
    store.save(eventId, signal);
}
```

Crash sau `execute` nhưng trước `save` sẽ lặp external call. Atomic inbox claim ngăn xử lý đồng thời cùng event, nhưng idempotency của storage không làm external side effect trở thành idempotent:

```java
// RIGHT: claim atomically; the unique key serializes duplicates.
if (!store.insertIfAbsent(eventId, PROCESSING)) {
    return store.resultFor(eventId); // existing or in-progress
}

try {
    AiSignal signal = llm.analyze(input);
    Verdict verdict = policy.evaluate(input, signal);
    store.complete(eventId, verdict);
    outbox.append(eventId, verdict); // publish after durable state is committed
    return verdict;
} catch (RetryableFailure failure) {
    store.releaseOrLease(eventId);
    throw failure;
}
```

Unique key có thể đặt trong database inbox hoặc một durable atomic store khác. Lease cho phép reclaim row `PROCESSING` bị bỏ dở. Settlement API vẫn cần idempotency key riêng, vì crash có thể xảy ra sau network call dù inbox đúng. Outbox làm cho database state và publish intent atomic, nhưng consumer của outbox cũng phải deduplicate. Mỗi guarantee mới đóng một failure window và đồng thời để lộ một failure window khác.

Ordering cũng có giới hạn. Partition theo `paymentId` có thể giữ thứ tự của key đó, nhưng không giữ global order. Stale event phải bị deterministic payment state machine từ chối, không phải được tin chỉ vì nó đến từ một partition cụ thể. Poison message cần số lần thử hữu hạn, backoff có jitter và quarantine trong dead-letter topic; nếu không, một payload hỏng có thể chiếm toàn bộ retry.

## Kiến trúc hình thành sau cùng

Chỉ sau các quyết định trên, các component mới có lý do tồn tại:

```text
JWT-authenticated request
        |
        v
cheap rules + bounded input validation -----> immediate policy outcome
        |
        v
gateway.raw.in (Kafka: replay source)
        |
        v
guardrail consumers
  atomic inbox claim by eventId
  redact/minimize -> LLM adapter with budget
  schema validation -> deterministic policy
        |
        +--> gateway.ai.verdict (signal/decision intent)
        +--> durable audit/outbox
                          |
                          v
                 OpenSearch (query/index model)
```

Kafka xuất hiện vì analysis cần hấp thụ burst, replay được và tách khỏi latency của provider. Ledger database vẫn là financial source of truth. Inbox sở hữu processing state. Outbox bảo vệ publish intent. OpenSearch phục vụ investigation và query nhanh; nó có thể được rebuild và không bao giờ authorize settlement.

Guardrail phát ra recommendation bounded như `ALLOW_WITH_SIGNAL`, `HOLD`, `STEP_UP` hoặc `REVIEW`. Payment service áp dụng transition có thẩm quyền và kiểm tra account state, limit cùng idempotency. Model không bao giờ có port tới ledger.

## Thực tế vận hành

Với 2.000 event được phân tích mỗi giây và p95 model minh họa là 400 ms:

```text
required in-flight calls ~= 2,000/s x 0.4s = 800
```

Đó là work đang xử lý trước khi tính headroom, retry, slow tail, connection limit và provider quota. Nếu provider cho phép 500 call đồng thời, thêm consumer không thể tạo ra 300 slot còn thiếu. FinPay phải giảm lượng gọi model bằng rule, chấp nhận lag, dùng detector khác hoặc thương lượng capacity. Nếu 5% trong 10.000 request mỗi giây gọi model, đó là 500 call mỗi giây, tương đương 43,2 triệu call mỗi ngày trước retry. Cost là một constraint của capacity.

On-call lúc 3 giờ sáng cần lần theo một payment qua toàn hệ thống. Trace nên nối request ID, payment ID, event ID, AI inference ID, model version và policy version mà không đưa các identifier đó vào metric label. Metric chỉ nên dùng label bounded như provider, model version, policy version, outcome và error class. Cần theo dõi gateway latency, AI timeout và provider error rate, circuit state, consumer lag và queue age, duplicate rate, policy outcome, retry và DLQ rate, mức sử dụng database connection cùng lỗi index.

Audit data nên ghi decision timestamp và event timestamp, feature snapshot đã tối giản hoặc protected reference, signal và confidence, validation result, provider, model và prompt version, policy version, latency, fallback reason và override. Không mặc định lưu raw prompt. Dùng hash hoặc reference khi chúng đủ để tái hiện evidence, và ghi rõ phần nào không thể reconstruct.

Security cũng tuân theo ranh giới này. Key ID do caller chọn chỉ định danh credential; nó không phải credential. Resolve secret qua secret manager, scope và rotate key, đồng thời không để secret xuất hiện trong prompt, log hay exception. Authenticate caller, authorize tenant, rate-limit trước phần xử lý tốn kém, và ngăn một tenant tiêu thụ toàn bộ provider budget dùng chung. Coi merchant text là dữ liệu hostile, không phải instruction. Tối giản PII, kiểm tra điều khoản retention và residency của provider, rồi áp dụng kiểm soát xóa dữ liệu.

Thay đổi model cần evaluation set gồm injection attempt, output hỏng, edge case hợp lệ và outcome đã review. Theo dõi precision, recall, calibration, drift, mức bất đồng với rule deterministic và thay đổi phân phối decision. Version model, prompt, input snapshot, provider và policy. Replay bằng model mới là một analysis mới, không phải bằng chứng về historical truth.

## Bài học của ranh giới này

Đơn vị kiến trúc hữu ích không phải là “một LLM đứng trước payment”. Đó là một port bounded biến input không tin cậy thành signal có version. Deterministic policy quyết định signal có ý nghĩa gì. Payment state machine quyết định tiền có được chuyển hay không. Ledger ghi financial truth.

Xử lý async giải quyết latency nhưng tạo duplicate delivery. Atomic claim giải quyết concurrent work nhưng không giải quyết external side effect. Retry cải thiện recovery nhưng có thể tạo retry storm. Cache có thể giảm tải nhưng tạo staleness. Mỗi lần sửa đều di chuyển failure boundary; thiết kế tốt làm rõ sự di chuyển đó.

Ở các lớp FinPay tiếp theo, đây là contract cần giữ: AI có thể tư vấn, giải thích, phân loại và enrich. Nó không trở thành authority chỉ vì được đặt gần payment API.

## Tài liệu tham khảo

- Tài liệu Apache Kafka, “Message Delivery Semantics”: <https://kafka.apache.org/documentation/#semantics>
- OWASP, “LLM01: Prompt Injection”: <https://owasp.org/www-project-top-10-for-large-language-model-applications/>
- Tài liệu Prometheus, “Instrumentation labels”: <https://prometheus.io/docs/practices/instrumentation/#labels>
- NIST, “AI Risk Management Framework”: <https://www.nist.gov/itl/ai-risk-management-framework>
