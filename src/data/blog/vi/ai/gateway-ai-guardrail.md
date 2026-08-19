---
title: "Thiết kế AI guardrail cho payment API gateway"
description: "Thiết kế dựa trên bài toán để giữ tín hiệu AI có tính xác suất ngoài quyết định thanh toán có thẩm quyền, đồng thời bảo đảm an toàn, latency, replay và audit."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/gateway>

## Bài toán

Hãy xét một payment gateway đã xác thực caller bằng JWT và đang chuẩn bị định tuyến request. Request có thể chứa free text từ merchant, customer hoặc integration upstream. Text này có thể chứa prompt injection, instruction sai hoặc mô tả mâu thuẫn với các field thanh toán có cấu trúc.

Team muốn có một AI check trước khi routing. Nghe có vẻ đơn giản: gửi text cho model, nhận fraud hoặc safety verdict rồi reject request đáng ngờ. Câu hỏi kỹ thuật chính xác hơn là:

> Làm thế nào để gateway sử dụng một component không chắc chắn, ở xa và tốn chi phí mà không biến nó thành nguồn có thẩm quyền đối với việc chuyển tiền?

Đây là thiết kế hư cấu/tham khảo, không phải tuyên bố về một deployment FinPay đã được xác minh độc lập. Một thiết kế hướng production có thể đặt guardrail sau JWT authentication và trước routing, nhưng settlement và business rule xác định vẫn phải có thẩm quyền.

## Vì sao khó hơn tưởng tượng

Guardrail không chỉ là classifier. Nó nằm giữa hai contract rất khác nhau:

- Ledger và settlement cần consistency chặt, outcome ổn định và side effect được kiểm soát.
- Phân tích anomaly và content có thể chấp nhận xử lý eventual, mức độ không chắc chắn có giới hạn và fallback.

Tách hai path giúp mỗi path có thể fail độc lập. Model timeout không được làm hỏng payment, còn audit index bị mất vẫn phải có cách rebuild mà không biến index thành source of truth.

Model còn có các failure mode mà một HTTP dependency thông thường không có: false positive, false negative, response không deterministic, prompt injection, field bị hallucinate, thay đổi model hoặc prompt, rate limit từ provider và câu trả lời đúng cú pháp nhưng không thể đúng về mặt nghiệp vụ. Một JSON hợp lệ không chứng minh quyết định thanh toán là hợp lệ.

Vì vậy contract nên là:

```text
AI signal -> deterministic policy -> business decision
```

Không phải:

```text
AI response -> block money
```

## Thiết kế ngây thơ

Thiết kế nhỏ nhất đặt model vào synchronous gateway path:

```text
client -> JWT auth -> LLM -> route hoặc reject -> payment service
```

Thiết kế này dường như giải quyết bài toán với ít infrastructure. Model thấy request, trả JSON, gateway chỉ routing khi câu trả lời là positive.

## Khi thiết kế ngây thơ hỏng

Ở 10.000 request/giây, synchronous model call biến gateway thành connection pool của AI. Nếu provider mất hai giây, Little’s Law cho lượng request đang xử lý xấp xỉ:

```text
concurrency = throughput x latency = 10,000/s x 2s = 20,000 calls
```

Ở mười giây là 100.000 calls. Một fixed thread pool bằng bốn không phải capacity plan; nó chỉ biến overload thành queue. Queue không có admission policy giới hạn cuối cùng sẽ tiêu thụ memory và làm latency của customer tăng.

Các failure khác khó nhìn thấy hơn:

- Provider unavailable nên mọi request chờ timeout. Retry khuếch đại outage và có thể tạo retry storm.
- Model trả `allow` do false negative hoặc `block` với customer hợp lệ do false positive. Business phải chọn hậu quả; model không được tự ngầm chọn.
- Payment thành công rồi audit indexing thất bại. Coi OpenSearch là authority sẽ biến index outage vô hại thành payment failure; coi nó là best-effort mà không có kế hoạch audit lại làm mất bằng chứng.
- Kafka record được redelivery sau khi consumer crash. Kiểm tra `exists()` rồi insert là race: hai consumer có thể cùng thấy `false` và cùng gọi provider hoặc side effect downstream.
- Rebalance hoặc event out-of-order khiến request mới được xử lý trước request cũ. Ordering không tự động được bảo toàn giữa các partition hoặc business key.
- Một record lỗi bị retry vô hạn, làm đói các record khỏe mạnh. Poison message cần retry có giới hạn và dead-letter hoặc quarantine path.
- Model update làm thay đổi phân bố quyết định. Không có model version và prompt version, team không thể giải thích vì sao hai request tương đương có kết quả khác nhau hoặc reproduce kết quả cũ.

Failure trông có vẻ vô hại thường là audit write. Nếu hệ thống ghi verdict vào OpenSearch index rồi coi operation đã hoàn tất, việc mất index sẽ âm thầm phá hủy query model. OpenSearch hữu ích cho search và investigation, nhưng Kafka hoặc durable audit store phải giữ source có thể rebuild.

## Quyết định thiết kế đầu tiên

Gateway không được hỏi model phê duyệt payment. Gateway hỏi một signal có giới hạn về untrusted content hoặc thuộc tính bất thường. Policy sau đó kết hợp signal với fact có thẩm quyền:

```text
structured payment + bounded text -> AI signal
AI signal + rules + limits + account state -> policy outcome
policy outcome -> route, step-up, hold hoặc manual review
```

Policy có thể coi `confidence=0.61` là “review” thay vì “block”. Nó có thể bỏ qua claim của model nếu claim mâu thuẫn với amount hoặc account đã authenticated. Policy phải deterministic, có version, được test và chịu trách nhiệm trước business.

## Các bài toán kỹ thuật khó

### 1. Detector nào phù hợp với gateway?

Không có lý do dùng LLM cho mọi signal.

- **Rules** phù hợp với indicator đã biết, allowlist, amount limit, schema constraint và pattern của prompt injection. Chúng nhanh, dễ giải thích nhưng cứng nhắc trước pattern mới.
- **Statistical methods** phù hợp với rate, amount, velocity và độ lệch so với peer group. Chúng rẻ, hữu ích cho baseline nhưng có thể nhầm hành vi mùa vụ hợp lệ là risk.
- **Traditional ML** phù hợp với fraud hoặc risk score được train trên feature ổn định. Nó hỗ trợ calibration và offline evaluation nhưng cần labeled data, drift monitoring và quy trình release có kiểm soát.
- **LLM** phù hợp với free text mơ hồ, classification có context và extraction một nhóm nhỏ signal có cấu trúc. Nó chậm hơn, đắt hơn, không deterministic và dễ bị prompt injection hoặc hallucination. Không nên dùng nó làm control duy nhất trên payment path.

Gateway có thể dùng AI core library dùng chung cho provider adapter, timeout, redaction, metadata của model và metrics. Library này không nên che giấu business policy. KYC document intake và RAG-based transaction explanation là use case riêng: gateway guardrail không nên tự retrieve knowledge tùy ý hoặc gửi toàn bộ customer profile ra external model chỉ vì shared client làm việc đó dễ dàng.

### 2. Làm thế nào giới hạn remote model?

`LlmPort` nên expose operation hẹp như `analyze(BoundedInput)`, không phải general chat interface. Adapter cần enforce:

- total deadline được truyền từ request hoặc event;
- connection, read và response-size limit;
- chỉ một hoặc một số ít retry cho transient failure đã phân loại;
- exponential backoff kèm jitter;
- circuit breaker và concurrency limit;
- xử lý rate limit của provider và fallback outcome.

Nếu caller có budget 300 ms, một retry có thể mất thêm 300 ms không phải retry policy; đó là vi phạm timeout. Khi provider down, guardrail nên trả `unavailable` và routing sang deterministic rules, step-up authentication hoặc review tùy policy. Failure không được âm thầm trở thành approval.

### 3. Ngăn duplicate work và duplicate effect thế nào?

Đoạn code này không idempotent:

```java
// SAI: check và write là hai operation riêng biệt.
if (!processingStore.exists(eventId)) {
    ModelOutput output = llm.analyze(input);
    settlementApi.execute(output);
    processingStore.save(eventId, output);
}
```

Hai consumer có thể cùng thấy `false`. Nếu process crash sau `settlementApi.execute` nhưng trước `save`, replay sẽ thực thi external effect lần nữa.

Boundary thực sự cần atomic claim, thường là unique constraint hoặc atomic insert:

```java
// ĐÚNG: claim là atomic; unique key serialize duplicate.
if (!processingStore.insertIfAbsent(eventId, PROCESSING)) {
    return processingStore.resultFor(eventId); // existing hoặc in-progress
}

try {
    ModelOutput output = llm.analyze(input);
    GuardrailVerdict verdict = policy.validate(input, output);
    processingStore.complete(eventId, verdict); // durable result
    outbox.append(eventId, verdict);            // publish later
    return verdict;
} catch (RetryableFailure failure) {
    processingStore.releaseOrLease(eventId);
    throw failure;
}
```

`insertIfAbsent` có thể dựa trên database unique index, Redis `SETNX` kèm expiry hoặc transactional inbox. Chọn cách nào phụ thuộc vào yêu cầu recovery và durability. Deterministic event ID và downstream idempotency key vẫn cần thiết.

Idempotent **storage** không đồng nghĩa với idempotent **side effect**. Processing row unique ngăn hai row nhưng không thể hoàn tác hai email, provider call hoặc settlement request đã gửi. Với money movement, settlement API cần contract idempotency riêng hoặc durable deduplication boundary. Transactional outbox làm update processing record và intent publish atomic trong một database, nhưng consumer của outbox cũng phải deduplicate.

## Các lựa chọn thiết kế

**A. Synchronous blocking guardrail.** Conceptual latency thấp nhất khi provider khỏe, nhưng payment availability bị ghép với AI latency, capacity và health của provider. Chỉ dùng cho control có giới hạn chặt và fail-closed nếu business chấp nhận latency đó.

**B. Asynchronous analysis sau acceptance.** Kafka nhận event, guardrail phân tích, rồi policy ở bước sau có thể hold hoặc đưa vào review. Payment path được cô lập và consumer scale độc lập, nhưng không ngăn được action đã authorize nếu state machine không có trạng thái pending.

**C. Hybrid bounded gate.** Chạy check deterministic rẻ ở synchronous path, chỉ gọi AI cho một subset trong budget chặt, đồng thời emit event cho phân tích sâu hơn. Đây thường là cách tách tốt nhất: request chắc chắn xấu bị từ chối nhanh, request không chắc chắn đi qua path có kiểm soát và phân tích đắt tiền chạy asynchronous.

Với gateway này, hướng đề xuất là option C. Hành vi synchronous cụ thể là quyết định về product và risk, không phải giả định tự động của architecture.

## Trade-off

Fail-open tối đa availability nhưng có thể tăng exposure khi provider outage. Fail-closed giảm exposure nhưng có thể từ chối traffic hợp lệ và biến dependency thành denial of service. Review hoặc step-up thường là outcome thứ ba tốt hơn.

Kafka at-least-once processing thực tế và replay được, nhưng cần consumer idempotent. Kafka exactly-once semantics không làm external HTTP settlement call exactly once. Thêm partition tăng throughput nhưng không bảo đảm global ordering. Audit record gọn giúp bảo vệ privacy và chi phí nhưng giảm forensic detail; mặc định nên lưu evidence tối thiểu có thể reproduce thay vì toàn bộ prompt.

## Architecture

Boundary sau khi suy luận là:

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

Kafka là event source và cơ chế replay, không phải ledger. Payment hoặc ledger database vẫn là system of record. OpenSearch là read model cho investigation; nếu index mất, consume event hoặc audit record còn retained để rebuild. Database inbox/outbox hoặc durable store tương đương sở hữu processing state. Application layer điều phối flow; các hexagonal port như `LlmPort`, `KeyProviderPort`, `ProcessingStore`, `PolicyPort` và `DecisionAuditPort` giữ adapter Spring, Kafka, HTTP, secret manager và OpenSearch ở ngoài domain.

Guardrail emit recommendation như `ALLOW_WITH_SIGNAL`, `HOLD`, `STEP_UP` hoặc `REVIEW`. Settlement service tự áp dụng state transition có thẩm quyền. Nó không bao giờ coi AI verdict là permission để mutate ledger.

## Các kịch bản failure

- **AI provider unavailable hoặc rate-limited:** circuit mở, không retry vô hạn, policy chọn rules, step-up hoặc review.
- **Timeout hoặc JSON không hợp lệ:** ghi typed failure và model metadata; không parse text dở dang hay mặc định approve.
- **Duplicate hoặc event out-of-order:** inbox atomic và event key deterministic trả kết quả cũ. Sequence check nghiệp vụ từ chối state transition cũ.
- **Consumer crash hoặc rebalance:** lease chưa hoàn tất có thể được reclaim. Downstream idempotency key ngăn external effect lặp lại.
- **Retry storm:** exponential backoff, jitter, maximum attempts, concurrency limit và circuit breaker giới hạn áp lực. Dead-letter topic quarantine poison message để kiểm tra.
- **Queue saturation hoặc backpressure:** giới hạn consumer concurrency và local buffer. Pause hoặc giảm intake thay vì cho memory tăng vô hạn; alert theo consumer lag.
- **Database failure:** không acknowledge Kafka record trước khi durable processing state commit. Nếu database unavailable, record vẫn retryable.
- **OpenSearch failure:** giữ durable audit hoặc outbox record, alert và rebuild index sau. Search availability không được quyết định settlement correctness.
- **Model regression hoặc rollback:** deploy model và prompt version như configuration kèm evaluation gate. Route traffic theo version, so sánh decision distribution và giữ version cũ để rollback.
- **Replay:** replay Kafka chỉ reproduce signal khi lưu input snapshot, feature values, model, prompt, provider và policy version. Nếu không, phải đánh dấu đó là analysis mới, không phải historical truth.

## Capacity & Performance

Capacity bắt đầu từ giả định workload đo được, không phải từ số thread. Nếu phân tích 2.000 event/giây và model p95 latency là 400 ms:

```text
required in-flight calls ~= 2,000/s x 0.4s = 800
```

Con số này chưa bao gồm headroom, retry, slow-tail latency, connection limit và provider quota. Concurrency limit nên thấp hơn quota provider và được chọn qua load test; phần việc dư nên nằm trong Kafka thay vì chiếm application thread không giới hạn. Nếu provider chỉ cho 500 concurrent calls, phải dùng detector rẻ hơn, chia traffic hoặc chấp nhận lag. Tăng consumer count không tự tạo thêm provider capacity.

Cost cũng là capacity. Nếu 5% của 10.000 request/giây đi tới model, đó là 500 call/giây, tương đương 43,2 triệu call/ngày trước retry. Rules và statistical feature có thể giảm cả cost lẫn blast radius. Theo dõi token hoặc request usage theo model và service, nhưng không đặt `transaction_id` hoặc `account_id` làm Prometheus label; các giá trị này tạo cardinality không giới hạn. Dùng log hoặc trace cho ID cụ thể.

## Security & Privacy

`X-FinPay-Key-Id` chỉ định danh BYOK credential do caller chọn; nó không phải credential. Resolve secret qua secret manager, giữ secret ngoài source, prompt, exception và log, chỉ đưa vào adapter khi gọi. Rotate và scope key, đồng thời audit việc truy cập key.

Minimize input gửi cho model. Chỉ gửi field cần cho signal cụ thể, tokenize hoặc redact PII, mã hóa khi truyền và khi lưu, giới hạn quyền operator, áp dụng retention và deletion policy. Không gửi tùy tiện toàn bộ transaction, customer profile hoặc KYC document tới external provider. Trước khi gửi data, cần kiểm tra retention, training, data residency và subprocessor của provider. Prompt injection có thể tìm cách lấy system instruction hoặc context nhạy cảm; coi mọi external text là data và không đưa secret vào prompt.

## Observability

Metrics vận hành là cần thiết nhưng chưa đủ. Các business và system signal hữu ích gồm:

- `transactions_processed`, `anomalies_detected`, `review_rate` và decision distribution;
- false-positive rate và false-negative rate ước tính từ outcome đã review;
- `ai_timeout_rate`, provider error rate, model error rate, circuit-open event và Kafka lag;
- request latency, queue age, retry count, dead-letter count và database/OpenSearch failure;
- AI request cost hoặc token usage, model version, prompt version, policy version và provider.

Dùng label có miền giá trị giới hạn như `provider`, `model_version`, `policy_version`, `outcome` và `error_class`. Không bao giờ dùng transaction hoặc account identifier làm Prometheus label value. Log và trace có thể mang protected correlation ID với access control, nhưng phải redact prompt, token, API key và payment data không cần thiết.

Để audit được, tối thiểu lưu `transaction_id`, `event_id`, event timestamp và decision timestamp, minimized feature snapshot, `risk_score` hoặc signal, decision, model version, prompt version, provider, latency, validation result, policy version, fallback reason và human hoặc rule override. Đây không chỉ là application logging. Đây là evidence để giải thích và, khi có thể, reproduce quyết định. Khi raw payload quá nhạy cảm, lưu hash hoặc reference và ghi rõ phần nào không thể reconstruct.

## Các điểm riêng của AI

Hãy đánh giá guardrail như một decision-support system. Hold rate tăng không có nghĩa model tốt hơn. Xây labeled evaluation set cho injection, output sai, edge case hợp lệ và text adversarial. Theo dõi precision, recall, calibration, drift, mức bất đồng với deterministic rule và thay đổi trong decision distribution. Test provider và model change offline trước khi route traffic giống production.

Dùng structured output với giới hạn chặt về size và field, nhưng không nhầm schema compliance với truth. Đặt temperature ít biến động nếu provider hỗ trợ, ghi nhận nondeterminism và làm policy chịu được signal thiếu hoặc confidence thấp. Timeout, explanation bị hallucinate hoặc confidence thấp phải tạo fallback reason rõ ràng. Explanation là evidence cho review, không phải fact có thẩm quyền.

## Nếu làm lại

Chúng tôi sẽ không bắt đầu bằng một service “AI guardrail” tổng quát. Trước hết cần xác định business state machine và authority boundary, sau đó tìm những signal không thể có từ rules hoặc model đã calibrated. KYC intake, RAG retrieval và gateway content analysis nên là các use case bounded riêng, dù chúng có thể dùng chung AI core library.

Replay cũng phải là yêu cầu từ đầu. Lưu input và decision có version, dùng inbox/outbox, rồi test duplicate, crash, rebalance, provider outage và index rebuild trước khi tối ưu happy path. Architecture là kết quả của các guarantee đó, không phải điểm xuất phát.

## Bài học chính

1. Đặt AI sau một port có giới hạn và để nó tạo signal, không tạo command chuyển tiền.
2. Dùng durable idempotency boundary có atomic operation; `exists()` rồi `save()` không an toàn khi concurrent.
3. Tách Kafka replay, ledger system of record và query model của OpenSearch.
4. Thiết kế timeout, fallback, backpressure và provider outage trước khi chọn model.
5. Version model, prompt, feature snapshot, policy và provider để audit và replay quyết định.
6. Đo business outcome cùng latency và error, đồng thời giữ identifier cardinality cao ngoài Prometheus label.
7. Minimize data nhạy cảm gửi tới AI provider và coi external text là untrusted data.

## Câu hỏi phỏng vấn

- Ai có authority block hoặc settle payment, và điều gì xảy ra khi AI signal mâu thuẫn với authority đó?
- Với throughput và model latency đã cho, cần bao nhiêu provider call concurrent và quota nào giới hạn thiết kế?
- Operation chính xác nào ngăn hai Kafka consumer claim cùng một event?
- Điều gì xảy ra sau crash giữa external side effect và idempotency record?
- Có thể xóa OpenSearch index rồi rebuild mà không thay đổi ledger không?
- Model, prompt, feature snapshot và policy version nào giải thích một quyết định lịch sử?
- False positive, false negative, provider outage và model regression được phát hiện thế nào?

## Tài liệu tham khảo

- Apache Kafka, “Message Delivery Semantics”: <https://kafka.apache.org/documentation/#semantics>
- OWASP, “LLM01: Prompt Injection”: <https://owasp.org/www-project-top-10-for-large-language-model-applications/>
- Prometheus, “Instrumentation labels”: <https://prometheus.io/docs/practices/instrumentation/#labels>
- NIST, “AI Risk Management Framework”: <https://www.nist.gov/itl/ai-risk-management-framework>
