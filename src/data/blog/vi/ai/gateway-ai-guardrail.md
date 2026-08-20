---
title: "Thiết kế AI guardrail cho payment API gateway"
description: "Thiết kế dựa trên bài toán để giữ tín hiệu AI có tính xác suất ngoài quyết định thanh toán có thẩm quyền, đồng thời bảo đảm an toàn, latency, replay và audit."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## Sự cố làm thay đổi câu hỏi

Hãy hình dung một merchant FinPay gửi payment kèm ghi chú dạng văn bản tự do. Ghi chú có thể là ngữ cảnh vô hại, văn bản khách hàng được sao chép vào request, hoặc nỗ lực tác động vào rule review. Đội ngũ risk đề nghị kiểm tra bằng AI trước khi route payment.

Yêu cầu đầu tiên thường rất đơn giản: gửi ghi chú cho model, rồi từ chối payment nếu kết quả không an toàn. Cách diễn đạt này che khuất vấn đề thật. Payment core của FinPay đã có các invariant cứng: ledger là financial source of truth, còn một state machine deterministic điều khiển các transition như `RECEIVED`, `AUTHORIZED`, `HELD` và `REJECTED`.

Model bên ngoài không thuộc authority boundary đó. Nó chậm, có tính xác suất, tốn chi phí và do provider nằm ngoài failure domain mà FinPay trực tiếp kiểm soát. Vì vậy câu hỏi thiết kế không phải là “Làm thế nào để model ra quyết định?” mà là:

> Làm thế nào để gateway sử dụng một dependency không chắc chắn mà không cho phép nó trực tiếp authorize, reject hoặc mutate tiền?

Đây là thiết kế tham chiếu hư cấu, không phải tuyên bố về một hệ thống FinPay đã triển khai. Quy tắc trung tâm là đề xuất:

```text
AI inference -> bounded AI signal -> deterministic policy -> payment state machine -> ledger / settlement
```

Model có thể báo `injection_suspected`, một risk score hoặc một classification. Model không được update account balance, ghi ledger, authorize settlement hay biến phần giải thích thành payment command.

## Bắt đầu bằng thiết kế hiển nhiên

Bản phác thảo đầu tiên có rất ít box:

```text
client -> JWT authentication -> LLM -> route or reject -> payment service
```

Gateway authenticate request, hỏi model `allow` hoặc `deny`, rồi chỉ route payment được cho phép. Trên whiteboard, cách này có vẻ hiệu quả. Trong thực tế, nó biến model thành một authorization service ẩn và đặt mọi payment phía sau latency cùng availability của provider.

Giả định minh họa gateway nhận 10.000 request mỗi giây và provider mất hai giây. Little’s Law cho concurrency gần đúng của model:

```text
in-flight calls = throughput x latency = 10,000/s x 2s = 20,000
```

Ở mười giây, cùng lưu lượng đó tạo ra 100.000 call đang xử lý. Tăng thread pool không tạo thêm capacity cho provider. Nó chỉ tiêu thụ memory, connection và downstream slot cho tới khi queue trở thành sự cố.

Giờ chỉ thay đổi latency của provider. Nếu latency tăng từ 300 ms minh họa lên 4 giây, gateway worker bị giữ lâu hơn, deadline của các layer hết hạn ở những thời điểm khác nhau, và một retry bất cẩn có thể chạy chồng lên call ban đầu. Connection pool đầy. Provider trả thêm rate-limit error. Retry queue phình ra, khiến payment khỏe phải cạnh tranh với AI call đã lỗi. Failure đã vượt ranh giới từ “AI unavailable” thành “payment unavailable”.

Response cũng là một failure surface. JSON hợp lệ về cú pháp vẫn có thể chứa classification không được biết, confidence ngoài range hoặc payment fact bịa ra. False negative có thể bỏ sót text đáng ngờ; false positive có thể từ chối merchant hợp lệ. Không outcome nào nên được chọn bởi nhánh timeout hoặc parser tình cờ chạy.

## Xác định constraint trước component

Trong ví dụ này, đây là các design assumption, không phải số đo production của FinPay:

- Authorization của payment và transition ledger vẫn deterministic, có audit và độc lập với response của LLM.
- Budget synchronous của gateway có giới hạn và degraded outcome khi hết budget phải được xác định rõ.
- Free text là input không tin cậy. Không gửi PII của khách hàng hay credential cho model chỉ vì gateway truy cập được chúng.
- Quota, latency, thay đổi model và outage của provider nằm ngoài quyền kiểm soát trực tiếp của FinPay.
- Analysis đủ replay để điều tra quyết định, còn prompt thô và dữ liệu payment tuân theo retention rule.
- Duplicate delivery và consumer crash là các sự kiện recovery bình thường.
- Search và dashboard có thể unavailable mà không thay đổi financial truth.

Các constraint này loại bỏ ý tưởng “LLM là bước kiểm tra cuối cùng”. Nhưng chúng chưa quyết định mọi payment có phải chờ synchronous hay không.

## Chọn detector rẻ nhất nhưng hữu ích

Rule nên xử lý schema validation, allowlist, amount limit và các mẫu prompt injection rõ ràng. Chúng nhanh, dễ giải thích nhưng không tổng quát tốt.

Velocity và thống kê theo peer group có thể phát hiện amount hoặc frequency bất thường. Chúng ít tốn kém hơn remote model, nhưng hành vi merchant theo mùa có thể trông như anomaly. Một traditional model đã calibrate có thể phù hợp hơn cho risk score ổn định nếu FinPay có label, drift check và quy trình release.

LLM hữu ích khi signal phụ thuộc vào free text mơ hồ hoặc một lần structured extraction nhỏ. Đây cũng là lựa chọn khó dự đoán nhất: output có thể nondeterministic, latency và cost thay đổi, còn text hostile có thể cố tác động vào instruction. Gateway không nên dùng LLM ở nơi rule hoặc calibrated model đã đủ.

AI core dùng chung từ bài viết FinPay trước cung cấp `LlmPort` hẹp, redaction, deadline, provider metadata và metrics. Dùng lại port này tránh lặp provider mechanics. Nhưng port không được che giấu gateway policy. KYC intake và giải thích có retrieval-augmentation là các bounded use case khác; guardrail này không nên truy xuất knowledge tùy ý hoặc gửi toàn bộ customer profile tới provider bên ngoài.

## Biến model thành bounded signal

Adapter nhận input theo mục đích cụ thể, không phải chat transcript tổng quát:

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

Trước khi gọi, adapter redact hoặc tokenize field, giới hạn kích thước input và output. Nó validate structured output nghiêm ngặt. Đúng cú pháp là chưa đủ: confidence phải nằm trong range, classification phải được biết và model không được tự tạo authoritative payment fact.

Adapter có deadline cho connection, read và toàn bộ operation. Chỉ retry lỗi transient đã phân loại và chỉ khi deadline còn đủ. Nếu request có budget 300 ms, thêm một retry 300 ms đã vi phạm budget. Backoff có jitter, xử lý rate limit của provider, circuit breaker và concurrency limit giúp giới hạn thiệt hại. Khi provider unavailable, adapter trả về `unavailable` có kiểu rõ ràng, không âm thầm biến thành `allow`.

## Quyết định chỗ phải chờ

Ba thiết kế đều có thể hợp lý.

**Synchronous blocking.** Provider khỏe trả signal ngay, nhưng availability của payment bị gắn với latency, quota và health. Chỉ chấp nhận khi đây là gate hẹp và business xác nhận latency cùng degraded-mode behavior.

**Asynchronous analysis sau acceptance.** Gateway accept payment và publish event. Consumer phân tích sau đó, rồi có thể yêu cầu `HELD` hoặc `REVIEW`. Cách này bảo vệ latency của gateway và hỗ trợ replay, nhưng không thể ngăn side effect đã authorize. Payment state machine cần pending path hoặc compensating path.

**Hybrid bounded gate.** Cheap deterministic check chạy synchronous. Chỉ subset được gọi model trong deadline nghiêm ngặt; analysis sâu hơn được publish để xử lý async. Cách này cần nhiều design effort hơn, nhưng giữ high-volume path ổn định và cho case không chắc chắn một outcome có kiểm soát.

Ta chọn hybrid cho hệ thống tham chiếu này vì nó giữ một synchronous safety boundary nhỏ mà không biến AI thành điều kiện bắt buộc của mọi payment. Degraded outcome cụ thể là quyết định product và risk:

- `fail-open` bảo vệ availability nhưng tăng exposure khi outage;
- `fail-closed` giảm exposure nhưng có thể biến outage thành denial of service;
- `STEP_UP` yêu cầu authentication mạnh hơn và tạo thêm friction;
- `REVIEW` giữ payment ở pending state deterministic.

Payment rủi ro thấp có thể dùng rule deterministic khi AI unavailable. Nhóm risk cao có thể yêu cầu step-up hoặc review. “AI lỗi nên block tất cả” không phải kiến trúc; đó là business decision chưa được xem xét.

## Async di chuyển failure boundary

Event boundary tách latency của provider, nhưng at-least-once delivery nghĩa là duplicate phải được dự kiến. Đoạn code này không an toàn:

```java
// WRONG: the check and the side effect are separate.
if (!store.exists(eventId)) {
    AiSignal signal = llm.analyze(input);
    settlementApi.execute(signal);
    store.save(eventId, signal);
}
```

Crash sau `execute` nhưng trước `save` sẽ lặp external call. Atomic inbox claim ngăn concurrent processing của một event, nhưng storage idempotency không làm external side effect trở thành idempotent:

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

Unique key có thể nằm trong database inbox hoặc durable atomic store khác. Lease cho phép reclaim row `PROCESSING` bị bỏ dở. Settlement API vẫn cần idempotency key riêng vì crash có thể xảy ra sau network call dù inbox đúng. Outbox làm database state và publish intent atomic, nhưng outbox consumer cũng phải deduplicate.

Ordering cũng có giới hạn. Partition theo `paymentId` có thể giữ order cho key đó, không phải global order. Stale event phải bị deterministic payment state machine từ chối, không được tin chỉ vì đến từ một partition cụ thể. Poison message cần số attempt hữu hạn, backoff có jitter và quarantine trong dead-letter topic.

## Kiến trúc sau khi đã suy luận

Chỉ lúc này các component mới có lý do tồn tại:

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

Kafka xuất hiện vì analysis cần hấp thụ burst, hỗ trợ replay và tách khỏi latency của provider. Ledger database vẫn là financial source of truth. Inbox sở hữu processing state. Outbox bảo vệ publish intent. OpenSearch phục vụ investigation và query speed; nó có thể rebuild và không bao giờ authorize settlement.

Guardrail phát ra bounded recommendation như `ALLOW_WITH_SIGNAL`, `HOLD`, `STEP_UP` hoặc `REVIEW`. Payment service áp dụng authoritative transition và enforce account state, limit cùng idempotency. Model không có port tới ledger.

## Thực tế vận hành

Giả định để capacity planning: 2.000 event được phân tích mỗi giây và model p95 minh họa là 400 ms:

```text
required in-flight calls ~= 2,000/s x 0.4s = 800
```

Đó là work đang xử lý trước headroom, retry, slow tail, connection limit và provider quota. Nếu provider cho phép 500 call đồng thời, thêm consumer không tạo được 300 slot còn thiếu. FinPay phải giảm model traffic bằng rule, chấp nhận lag, dùng detector khác hoặc thương lượng capacity. Nếu 5% của 10.000 request mỗi giây minh họa đi tới model, đó là 500 call mỗi giây, tương đương 43,2 triệu call mỗi ngày trước retry. Cost là capacity constraint.

On-call cần lần theo một payment qua hệ thống. Trace nên nối request ID, payment ID, event ID, AI inference ID, model version và policy version mà không đưa các identifier đó vào metric label. Metric nên dùng label bounded như provider, model version, policy version, outcome và error class. Theo dõi gateway latency, AI timeout và provider error rate, circuit state, consumer lag và queue age, duplicate rate, policy outcome, retry và DLQ rate, database connection utilization cùng index failure.

Audit data nên ghi event timestamp và decision timestamp, feature snapshot đã tối giản hoặc protected reference, signal và confidence, validation result, provider, model và prompt version, policy version, latency, fallback reason và override. Không mặc định lưu raw prompt. Dùng hash hoặc reference khi chúng đủ để tái hiện evidence, và ghi rõ phần nào không thể reconstruct.

Security tuân theo cùng boundary. Key ID do caller chọn chỉ định danh credential; nó không phải credential. Resolve secret qua secret manager, scope và rotate key, đồng thời giữ secret ngoài prompt, log và exception. Authenticate caller, authorize tenant, rate-limit trước phần xử lý tốn kém và ngăn một tenant tiêu thụ shared provider budget. Coi merchant text là hostile data, không phải instruction. Tối giản PII, kiểm tra điều khoản retention và residency của provider, rồi áp dụng deletion control.

Model change cần evaluation set có injection attempt, malformed output, legitimate edge case và outcome đã review. Theo dõi precision, recall, calibration, drift, mức bất đồng với deterministic rule và thay đổi decision distribution. Version model, prompt, input snapshot, provider và policy. Replay bằng model mới là analysis mới, không phải bằng chứng cho historical truth.

## Bài học

Đơn vị kiến trúc hữu ích không phải “một LLM trước payment”. Đó là một port bounded biến input không tin cậy thành signal có version. Deterministic policy quyết định signal có nghĩa gì. Payment state machine quyết định tiền có được chuyển hay không. Ledger ghi financial truth.

Async giải quyết latency nhưng tạo duplicate delivery. Atomic claim giải quyết concurrent work nhưng không giải quyết external side effect. Retry cải thiện recovery nhưng có thể tạo storm. Cache có thể giảm tải nhưng tạo staleness. Mỗi fix đều di chuyển failure boundary; thiết kế tốt làm cho sự di chuyển đó rõ ràng.

Contract cho các layer FinPay sau này rất đơn giản: AI có thể tư vấn, giải thích, phân loại và enrich. Nó không thể trở thành authority chỉ vì nằm gần payment API.

## Tài liệu tham khảo

- Tài liệu Apache Kafka, “Message Delivery Semantics”: <https://kafka.apache.org/documentation/#semantics>
- OWASP, “LLM01: Prompt Injection”: <https://owasp.org/www-project-top-10-for-large-language-model-applications/>
- Tài liệu Prometheus, “Instrumentation labels”: <https://prometheus.io/docs/practices/instrumentation/#labels>
- NIST, “AI Risk Management Framework”: <https://www.nist.gov/itl/ai-risk-management-framework>
