---
title: "Thiết kế AI Core dùng chung cho FinPay: Từ failure mode đến guardrail"
description: "Thiết kế thực tế cho tích hợp LLM dùng chung với credential BYOK, cơ chế chống lỗi, idempotency và kết quả có audit."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

FinPay đã có phần không được phép mang tính thử nghiệm: ledger là system of record, settlement là quá trình xác định bằng quy tắc, và mọi luồng tiền đều có thể audit. Câu hỏi của bài này hẹp hơn: làm thế nào để nhiều service FinPay dùng AI mà không để một dependency bên ngoài thiếu ổn định làm suy yếu các invariant đó?

Câu trả lời không phải là xây một AI service lớn hơn. Đó là một technical contract dùng chung. Core chuẩn hóa cách service lấy credential, giới hạn một lần inference, validate output, ghi evidence và xử lý duplicate. Core không quyết định payment có được approve hay không. Quyền đó vẫn thuộc về policy xác định và payment state machine.

## Failure đầu tiên là sự không nhất quán

Hãy hình dung FinPay thêm risk analysis có hỗ trợ AI vào payment review, KYC enrichment và support triage. Cách triển khai đầu tiên thường nằm ngay trong từng service: mỗi team tự gọi provider. Một key nằm trong `application.yml`, key khác lấy từ environment variable, key thứ ba được chép vào test configuration. Một client retry lỗi 5xx; client khác không có deadline. Một parser chấp nhận text tự do như `approve`; parser khác yêu cầu JSON. Một request thành công chỉ được ghi bằng `logger.info("done")`.

Đây không phải ba lựa chọn cài đặt độc lập. Đây là ba phiên bản của security policy và failure policy. Provider chậm có thể chiếm request thread ở service này trong khi service khác fail fast. Một model label vô hại trong support triage có thể trở nên nguy hiểm nếu payment service hiểu label đó là authorization.

Đây là kịch bản thiết kế tham chiếu, không phải khẳng định về một incident thật của FinPay. Câu hỏi hữu ích là: điều gì buộc chúng ta tập trung behavior kỹ thuật, và phần nào phải để lại cho từng service?

## Vì sao thiết kế hiển nhiên thất bại

Một payment-risk endpoint ngây thơ trông khá hấp dẫn:

```java
// WRONG: secret, lời gọi không giới hạn và quyền quyết định nghiệp vụ nằm cùng một chỗ
String answer = llm.chat(apiKey, request.toJson());
return answer.contains("approve") ? APPROVE : REJECT;
```

Đường đi từ request đến result rất ngắn. Nhưng nó che giấu bốn quyết định. Không có timeout budget, không có hành vi rõ ràng khi provider outage, không có schema validation và không tách AI observation khỏi financial decision. Chỉ một thay đổi chính tả hoặc thêm một câu trong response cũng có thể làm thay đổi nhánh xử lý.

Lần thử tiếp theo thường bảo vệ persistence bằng một pre-check:

```java
// WRONG: hai consumer có thể cùng thấy false
if (!outcomeRepository.exists(eventId)) {
    outcomeRepository.save(new Outcome(eventId, signal));
}
```

Khi message được redeliver hoặc có hai consumer cạnh tranh, cả hai lần đọc đều có thể trả về false. Kiểm tra uniqueness trong application code không phải atomic claim. Ngay cả atomic insert cũng chỉ giải quyết durable storage. Nếu outcome gửi email, tạo review case hoặc gọi service khác, side effect đó cần idempotency key riêng.

Inference đồng bộ tạo ra một boundary thứ hai. Giả sử 200 request mỗi giây, mỗi request chờ 750 ms cho toàn bộ path. Chỉ riêng AI stage đã tạo ra xấp xỉ:

```text
concurrency = throughput x latency
            = 200 x 0.75
            = 150 in-flight requests
```

Đây là phép tính capacity minh họa, không phải measurement của FinPay. Khi cộng provider retry, connection pool, database write và gateway timeout, provider chậm tạm thời có thể chiếm tài nguyên vượt xa AI client. Nếu latency tăng từ 300 ms lên 4 giây, cùng arrival rate sẽ tạo khoảng 800 in-flight call. Nếu client retry trong lúc call đầu vẫn đang chờ, provider nhận nhiều tải hơn đúng lúc nó khó xử lý nhất.

Khi đó, “chỉ cần thêm retry” không phải resilience. Nó là bộ khuếch đại. Shared core phải làm rõ deadline, retry budget, concurrency limit và fallback.

## Xác định constraint trước component

Trong thiết kế tham chiếu này, chúng ta dùng các giả định sau:

- Ledger và payment state machine của FinPay đã sở hữu balance, authorization, settlement và các transition không thể đảo ngược.
- AI có thể tạo risk signal, classification, explanation hoặc enrichment có giới hạn. AI không được mutate balance, ledger entry, settlement state, payment authorization hay financial transaction state.
- Các tenant có thể mang credential của provider riêng (BYOK). Credential phải được resolve từ secret manager, không nằm trong source code, prompt hay log.
- Inference có thể chậm, unavailable, bị rate-limit, nondeterministic hoặc đắt hơn dự kiến.
- Payment path phải có degraded mode rõ ràng. “AI failed” không thể ngầm có nghĩa là “approve” hoặc “reject” cho mọi operation.
- Investigator cần dựng lại chuyện đã xảy ra, trong khi raw sensitive payload phải được giảm thiểu và kiểm soát quyền truy cập.

Đây là constraint thiết kế và ví dụ, không phải production measurement. Chúng dẫn đến một số boundary nhỏ: typed AI port, durable outcome record, lựa chọn asynchronous cho công việc không thuộc payment critical path và audit trail có version.

## Contract: signal, policy, decision

Core trả về `AISignal`, không phải approval:

```text
AI inference -> AI signal -> deterministic policy -> business decision -> financial state transition
```

Một AI signal có thể chứa score có giới hạn, label từ allowed enum, confidence, reason code, model version, prompt version và status rõ ràng như `VALID`, `TIMEOUT` hoặc `INVALID_OUTPUT`. Policy service quyết định signal đó có nghĩa gì với một payment, tenant và risk tier cụ thể. Payment state machine sau đó thực hiện transition đã được cho phép và ghi ledger qua path deterministic thông thường.

Việc tách này quan trọng khi model thay đổi. Model mới có thể tạo score khác cho cùng input; policy version vẫn làm rõ rule được dùng để ra quyết định. Nó cũng quan trọng khi AI unavailable. Một enrichment rủi ro thấp có thể được queue để xử lý sau. Payment rủi ro cao có thể chuyển sang step-up verification hoặc manual review. Một flow giá trị thấp có thể tiếp tục bằng deterministic rule. Lựa chọn đúng phụ thuộc vào tổn thất của operation, yêu cầu pháp lý và trải nghiệm khách hàng. Core phải báo failure; policy sở hữu phải chọn business response.

## Shared core sở hữu gì

Module expose một typed port hẹp như `assess(SignalRequest) -> AISignal`. Caller gửi request đã được minimize cùng correlation context. Core resolve secret reference của tenant, tạo provider-neutral request, áp dụng deadline và retry policy có giới hạn, validate structured output và ghi technical evidence.

Core sở hữu:

- Resolve và redact BYOK credential.
- Provider adapter, request timeout, retry classification, backoff có jitter, circuit state và concurrency limit.
- Structured-output validation cùng status invalid hoặc unavailable rõ ràng.
- Idempotent storage cho signal và outbox record cho downstream effect bền vững.
- Audit field như `transaction_id`, `event_id`, `model_version`, `prompt_version`, `policy_version`, `decision`, `reason`, timestamp và correlation ID.
- Metric và trace mô tả behavior mà không đưa payment hoặc account identifier vào metric label.

Core không sở hữu payment threshold, fraud policy, account balance, settlement hay quyền biến `approve` trong response LLM thành payment command. Library có thể chuẩn hóa behavior; nó không thể biến business policy thành thứ generic mà không làm policy khó nhìn thấy và khó audit hơn.

## Idempotency có hai boundary

Boundary đầu tiên là storage. Durable database unique constraint trên `(tenant_id, event_id)` để database phân xử concurrent delivery:

```java
try {
    outcomeRepository.insertUnique(tenantId, eventId, signal);
    outboxRepository.insert(tenantId, eventId, "RISK_SIGNAL_RECORDED");
} catch (DuplicateKeyException alreadyProcessed) {
    return outcomeRepository.get(tenantId, eventId);
}
```

Outcome và outbox row nên được commit cùng nhau. Nếu consumer crash sau commit nhưng trước khi acknowledge message, redelivery sẽ tìm thấy outcome hiện có. Database là system of record; cache hoặc search index không thể thay thế việc phân xử này.

Boundary thứ hai là side effect. Outbox worker có thể gửi cùng notification hoặc case request nhiều hơn một lần. Mỗi effect cần key ổn định như `(tenant_id, event_id, effect_type)`, và receiver phải enforce key đó hoặc worker phải duy trì effect state bền vững. Storage idempotency không làm cho HTTP call, email hay case creation trở thành idempotent.

Đó cũng là lý do không giả định provider call được thực hiện đúng một lần. Nếu timeout xảy ra sau khi provider đã nhận request, retry có thể lặp inference. Stored signal cuối cùng vẫn là authority cho event này, và có thể dùng provider request idempotency key nếu provider tuyên bố hỗ trợ. Core không được hứa exactly-once guarantee mà nó không thể cung cấp.

## Chọn execution boundary

Scoring đồng bộ giữ user flow đơn giản và cho result ngay lập tức. Nó phù hợp khi decision thực sự cần signal và latency budget đủ cho provider. Cái giá là availability bị liên kết: provider outage trở thành dependency của payment path trừ khi policy định nghĩa fallback.

Scoring bất đồng bộ tách payment request khỏi model latency. Payment có thể chuyển sang `PENDING_RISK`, event có thể replay và consumer có thể xử lý với concurrency được kiểm soát. Cái giá là eventual consistency và state machine phức tạp hơn. Timeout lúc này trở thành queue age, và sản phẩm phải định nghĩa điều gì xảy ra nếu payment pending quá lâu.

Với foundation dùng chung, chúng ta không ép mọi caller dùng một mode. Core cung cấp cùng signal contract cho cả hai. Caller quan trọng với payment chỉ dùng synchronous call có giới hạn chặt khi thực sự cần; enrichment, review và phân tích sau dùng asynchronous path. Cách này bảo vệ hard payment invariant mà không giả vờ mọi AI work có cùng yêu cầu latency.

Quyết định asynchronous tạo ra vấn đề duplicate delivery, ordering và backpressure. Inbox hoặc unique outcome key xử lý duplicate. Partitioning và payment sequence có thể giữ ordering cần cho một workflow cụ thể; global ordering sẽ đắt hơn và không cần thiết. Giới hạn consumer concurrency trước provider call để queue tăng không biến thành burst không giới hạn tới provider.

## Resilience là budget, không phải boolean

Mỗi request nhận một total deadline. Individual provider attempt, retry và downstream persistence phải nằm trong deadline đó. Chỉ retry một số transient failure như rate limit hoặc temporary server error. Không retry schema invalid, payload bị từ chối hay policy decision. Exponential backoff có jitter ngăn cả fleet retry đồng thời, còn retry budget ngăn traffic lúc recovery trở thành outage thứ hai.

Trong một kịch bản minh họa lúc 14:03, provider latency tăng từ 300 ms lên 4 giây. Gateway phải ngừng nhận synchronous work không giới hạn, AI client timeout trong budget được cấp, và circuit mở sau failure threshold đã cấu hình. Consumer phải tuân thủ concurrency limit thay vì tạo hàng nghìn call đang chờ. Service ghi `AI_TIMEOUT`, route theo policy sở hữu và giữ đủ capacity để phục hồi. Circuit breaker không có admission control chỉ thay đổi thời điểm queue đầy.

Fallback là business decision được core hỗ trợ về mặt kỹ thuật. Core có thể trả về unavailable signal cùng evidence. Policy có thể chọn deterministic check, step-up verification, manual review hoặc delayed decision. Path đó phải được gắn nhãn fallback; hệ thống không được bịa confidence hoặc âm thầm biến outage thành approval.

## Kiến trúc xuất hiện từ các vấn đề

Khi các vấn đề trên được làm rõ, mỗi component có lý do tồn tại:

```text
payment / review service
        |
        | typed SignalRequest
        v
  shared AI core
  - secret resolution
  - provider adapter
  - timeout / retry / circuit / limit
  - schema validation
        |
        v
  AISignal + durable audit outcome
        |
        +--> deterministic policy --> business state machine --> ledger / settlement
        |
        +--> outbox --> notifications / cases / other effects

Kafka = replay source for asynchronous work
DB = system of record for outcomes, inbox, and outbox
OpenSearch = rebuildable read model for investigation and dashboards
Vault = secret source; keys never enter prompts or logs
```

Kafka chỉ hữu ích khi asynchronous work cần replay và consumer processing có kiểm soát. Kafka không phải ledger. Database sở hữu durable outcome và idempotency state. OpenSearch giúp investigation nhanh hơn, nhưng nếu nó unavailable thì durable path vẫn tiếp tục và indexing xử lý bù sau. Các boundary này ngăn một component vận hành tiện lợi vô tình trở thành authority tài chính.

## AI safety và evidence

Provider response phải khớp schema có version. Thiếu field, label không biết, giá trị mâu thuẫn, JSON hỏng hoặc confidence ngoài range chấp nhận được đều trở thành `INVALID_OUTPUT`. Hệ thống không đoán từ free-form text. Lưu model và prompt version cùng signal; thay đổi prompt là thay đổi input của decision.

Prompt construction cũng cần input boundary. Payment description và support note có thể chứa instruction nhắm vào model. Hãy coi chúng là untrusted data, phân tách chúng, chỉ gửi subset nằm trong allowlist và validate result như data. Giảm thiểu name, account number, address và regulated identifier bằng derived feature, redaction hoặc tokenization. BYOK cải thiện tenant isolation và cost attribution, nhưng thêm secret-manager traffic và rotation race. Cache ngắn, có quy định rõ, có thể giảm traffic đó; đổi lại có stale credential và phải có TTL cùng refresh behavior.

Prompt text và raw provider payload không mặc nhiên là audit data phù hợp. Chỉ lưu mức tối thiểu cần cho investigation, bảo vệ quyền truy cập vào evidence nhạy cảm và lưu hash hoặc reference khi không nên giữ payload. Hash không phải anonymization nếu input space nhỏ khiến bản gốc dễ khôi phục.

## Vận hành các failure mode

On-call engineer cần trả lời được: provider và model nào đang lỗi, call đang chờ hay đang thực thi, retry có tiêu hết budget không, workflow payment nào đang fallback hoặc pending. Metric aggregate hữu ích gồm gateway latency, AI latency, timeout và invalid-output rate, provider error và rate-limit rate, circuit state, consumer lag, outbox age, duplicate conflict, database connection utilization và dead-letter rate. Business metric gồm fallback rate, manual-review rate, policy outcome và mẫu false-positive hoặc false-negative đã được review theo model và policy version.

Không đưa `transaction_id`, `account_id`, `event_id` hoặc trace ID vào Prometheus label. Đưa correlation data vào structured log được kiểm soát và trace context. Trace nên nối request, payment, event, AI inference, model version và policy version mà không lộ prompt hay credential. Audit record phải giữ decision, reason, timestamp và version để investigator phân biệt AI signal với deterministic action đi sau nó.

Dead-letter record cần owner và quy trình replay, không chỉ một topic name. Replay phải giữ event identity ban đầu và dùng cùng idempotency rule. Capacity review nên bao gồm peak event rate, consumer concurrency, provider quota, database unique-index contention, connection pool, secret-manager QPS, search indexing rate, token budget và số attempt tăng thêm do retry. Cost là một phần của reliability: prompt hoặc retry loop không giới hạn có thể làm cạn budget của tenant trước khi bất kỳ infrastructure limit nào kích hoạt.

## Foundation này thiết lập điều gì

Shared AI core có giá trị vì nó làm sự không chắc chắn trở nên visible và có thể lặp lại. Nó chuẩn hóa secret, deadline, retry, validation, idempotency và evidence cho FinPay đang tiếp tục phát triển. Nó không che giấu các decision thuộc về team payment, KYC, review hay operations.

Contract cho các bài sau rất đơn giản:

```text
AI signal -> deterministic policy -> business decision
```

Ledger vẫn là financial truth. Khi cần, Kafka cung cấp replay; database ghi durable outcome; OpenSearch cung cấp read model có thể rebuild. Idempotent storage bảo vệ event record, còn idempotent side effect bảo vệ các system được gọi sau đó. AI có thể cải thiện, giải thích hoặc ưu tiên một decision. AI không thể trở thành authority di chuyển tiền của FinPay.
