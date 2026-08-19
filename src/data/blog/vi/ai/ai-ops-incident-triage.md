---
title: "AI Ops Triage sự cố: Từ nhiễu cảnh báo đến giả thuyết an toàn"
description: "Cách FinPay suy luận để tương quan cảnh báo Prometheus và trace OpenTelemetry mà không biến LLM thành thẩm quyền vận hành hay chuyển tiền."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## Sự cố chưa phải là chẩn đoán

Hãy giả sử một lô settlement bị trễ lúc 03:00. Prometheus báo độ trễ API tăng, KYC bắt đầu timeout, consumer lag của Kafka tăng và nhiều dead-letter queue bắt đầu đầy. Kỹ sư on-call có bốn dashboard nhưng chưa có câu chuyện nhân quả đáng tin cậy. Một số cảnh báo có thể là triệu chứng của cùng một dependency lỗi; số khác có thể không liên quan.

Yêu cầu đầu tiên thường là: “Nên restart thành phần nào?” Đó là điểm bắt đầu sai đối với hệ thống tài chính. Một thao tác vận hành sai có thể làm settlement trễ hơn, bỏ qua kiểm soát KYC hoặc lặp lại side effect phía payment. FinPay cần tạo giả thuyết hữu ích nhanh, nhưng vẫn phải giữ invariant xuyên suốt series: ledger là nguồn sự thật, settlement mang tính tất định, và kết quả AI không bao giờ là quyền thay đổi trạng thái tài chính.

Đây là bài viết khép lại mạch reliability đó. Nó dùng lại các AI core port, trường audit, cách tách idempotency và ranh giới `Kafka = replay / database = record / OpenSearch = read model` đã có trong các bài trước. Vấn đề mới là tập hợp bằng chứng từ alert và trace mà không nhầm tương quan với nguyên nhân. Insight trung tâm là: **tương quan chỉ tập hợp bằng chứng; nó không chứng minh sự thật nhân quả. Recommendation là proposal có kiểu, không phải lệnh thực thi.**

## Vì sao thiết kế hiển nhiên thất bại

Thiết kế đầu tiên khá hấp dẫn:

```text
Prometheus alert ──▶ Kafka ──▶ consumer ──▶ LLM ──▶ execute runbook action
```

Consumer gửi nội dung alert, vài trường trace và câu hỏi “Chúng ta nên làm gì?” cho model. Nó lưu câu trả lời rồi acknowledge Kafka. Cách này có thể ổn trong test nhỏ, nhưng ghép bốn miền lỗi khác nhau vào cùng một path: nhận alert, tìm bằng chứng, inference từ provider và thẩm quyền vận hành.

Các con số dưới đây là giả định để suy luận capacity, không phải số đo của FinPay. Nếu 10.000 alert event mỗi giây đều giữ một LLM call trong hai giây, stage đó tạo ra:

```text
concurrency = throughput × latency = 10,000 × 2 = 20,000 in-flight calls
```

Ở mười giây, con số là 100.000. Điều đó không có nghĩa phải tạo từng ấy thread. Nó cho thấy quota provider, connection pool, memory và đường consumer Kafka không thể tăng theo độ trễ provider. Listener đồng bộ còn biến outage của provider thành outage nhìn như của partition.

Lúc 14:03, giả sử độ trễ provider tăng từ 300 ms lên 4 giây. Worker của listener bị giữ lại, poll chậm đi và consumer lag tăng. Chính sách retry ba lần gửi khoảng gấp ba traffic thất bại trong lúc provider đã không khỏe. Client timeout không chứng minh provider không xử lý request; request có thể hoàn tất sau khi client bỏ cuộc. Retry vì vậy có thể tạo nhiều model call trùng và recommendation mâu thuẫn. Queue không giới hạn chỉ chuyển lỗi từ Kafka lag sang cạn heap.

Còn có vấn đề về dữ liệu. Trace có thể đến sau alert, bị sampling hoặc không được index trong khi Kafka vẫn khỏe. “Không tìm thấy span” không có nghĩa “không có lỗi”. Kafka redelivery và consumer rebalance là những tình huống at-least-once bình thường. `exists()` rồi `insert()` không phải lock: hai consumer có thể cùng thấy chưa có bản ghi và tạo hai review task.

Mũi tên cuối cùng nguy hiểm nhất. LLM không được restart settlement consumer, đổi trạng thái KYC, authorize payment, cập nhật account balance, sửa ledger hoặc settlement funds. Log và runbook là input không đáng tin cậy và có thể chứa prompt injection. Một lời giải thích nghe hợp lý vẫn chỉ là giả thuyết.

## Xác định constraint trước component

Trong thiết kế tham chiếu này, ta giả định:

- Nhận alert vẫn tiếp tục khi AI provider chậm hoặc không khả dụng.
- Triage có thể trễ, nhưng alert nguồn phải được giữ lại và replay được.
- Trace thiếu hoặc cũ phải hiện thành uncertainty, không âm thầm trở thành bằng chứng.
- Failure pattern đã biết phải có path tất định và ít tốn kém.
- Recommendation ảnh hưởng đến production control phải đi qua approval workflow rõ ràng.
- Payment, ledger, settlement và KYC state vẫn authoritative trong các deterministic store tương ứng.
- Mọi decision phải giải thích được từ evidence, policy và metadata phiên bản.
- Rate và latency trong ví dụ chỉ để minh họa; giới hạn thật đến từ load test, hợp đồng provider và alert SLO.

Các constraint này loại bỏ giả định “model quyết định” trước cả khi chọn database hay queue.

## Ranh giới làm hệ thống an toàn

Thiết kế tách **signal path** và **authority path**:

```text
AI signal ──▶ deterministic policy ──▶ triage state / approval task ──▶ controlled action
```

AI tạo signal có kiểu: severity suggestion, hypothesis, confidence, reference đến evidence và recommendation kind. Policy kiểm tra schema, độ mới của evidence, ngưỡng confidence, runbook được phép và việc proposal có chạm đến money hoặc KYC hay không. Kết quả có thể là guidance chỉ đọc, task chờ người duyệt hoặc trạng thái abstention rõ ràng.

Đây là contract `AI signal → policy → business decision` được dùng ở các AI surface khác của FinPay. Authority path tách riêng vì approval task không phải action. Operator được kiểm soát hoặc deterministic service phải authorize state transition tiếp theo; ledger hoặc KYC system phải áp dụng nó theo invariant riêng. Khi AI unavailable, rules có thể phân loại incident đã biết; với case mơ hồ và rủi ro cao, degraded mode đúng là “awaiting review”, không tự động block hay tự động release.

## Tập hợp bằng chứng nhưng không khẳng định quá mức

Prometheus alert mô tả threshold violation. OpenTelemetry trace cung cấp request context và timing nhưng có thể bị sampling, đến trễ hoặc thiếu. Kafka là durable source cho alert và audit event; nó không phải query API cho operator. OpenSearch là trace và incident read model có thể tìm kiếm; nó không phải payment ledger.

Service xây `IncidentContext` có giới hạn từ alert, metadata service/deployment và span được correlate bằng identifier cùng time window. Đây giống một RAG flow nhỏ: lấy evidence liên quan, ghi nhận evidence nào thiếu, rồi yêu cầu model suy luận trên tập dữ liệu giới hạn. Runbook text được retrieve chỉ là tài liệu tham khảo, không bao giờ là instruction có authority.

```java
public record IncidentContext(
        String eventId, String service, Instant alertTime,
        List<TraceSpan> spans, List<String> missingEvidence,
        Instant evidenceAsOf) {}

public record TriageOutcome(
        String eventId, Severity severity, String hypothesis,
        double confidence, Recommendation recommendation,
        String source, String modelVersion, String promptVersion,
        boolean evidenceSufficient) {}

public record Recommendation(ActionKind kind, String reason,
        String runbookId, boolean touchesMoney, boolean changesKycState) {}
```

AI core library đã được thiết lập trong series sở hữu redaction, strict schema validation, provider metadata, prompt version và evaluation hook. Service này cung cấp incident fact và policy; nó không tạo thêm một safety wrapper khác.

## Rules trước, dùng AI khi ambiguity đáng với chi phí

Rules phù hợp với điều kiện đã biết như dead-letter queue vượt ngưỡng hoặc thiếu approval event. Statistical detection có thể phát hiện latency hay lag thay đổi bất thường, nhưng anomaly score không phải nguyên nhân. Classifier có thể phù hợp với nhóm incident lặp lại và có label. LLM hữu ích với alert text không có cấu trúc, bounded runbook retrieval và giả thuyết dễ đọc xuyên nhiều service. Nó cũng nondeterministic, bị rate-limit, tốn chi phí và dễ bị text độc hại trong log tác động.

Vì vậy FinPay chọn rules-first, AI-assisted escalation. Rule path giữ các incident đã biết tiếp tục chạy khi provider outage. Model chỉ thấy các case mà việc ghép evidence thực sự có giá trị. Đổi lại, đội ngũ phải duy trì threshold và incident taxonomy, nhưng giảm phụ thuộc provider, review noise và retry amplification.

Policy reject hoặc downgrade kết quả khi evidence cũ, confidence dưới ngưỡng được duyệt, thiếu field bắt buộc, runbook không nằm trong allow-list hoặc proposal chạm money/KYC mà chưa có approval. Model có thể trả lời “insufficient evidence”; đó là outcome hợp lệ.

## Async giải quyết một lỗi và tạo ra lỗi mới

Đưa provider call ra khỏi Kafka listener giải quyết việc ghép latency, nhưng tạo duplicate delivery và abandoned work. Listener validate event rồi atomic claim; bounded worker enrich evidence và gọi provider. Offset chỉ commit sau durable outcome và audit intent. Retry topic, backoff có jitter, circuit breaker và retry budget làm pressure hiện rõ thay vì vô hạn.

```java
public interface IdempotencyPort {
    boolean tryClaim(String eventId); // atomic claim with lease/recovery state
    void complete(String eventId, TriageOutcome outcome);
}

public boolean tryClaim(String eventId) {
    try {
        client.index(b -> b.index("finpay-incident-inbox")
                .id(eventId).opType(OpType.Create));
        return true;
    } catch (ResourceAlreadyExistsException duplicate) {
        return false;
    }
}
```

Cùng tính duy nhất atomic có thể làm bằng database unique constraint và inbox table. Redis `SETNX` có thể phù hợp cho claim ngắn hạn, nhưng expiry không phải recovery protocol hoàn chỉnh. Claim lease cần owner, timeout và retry state an toàn. Storage idempotency cũng không làm side effect idempotent: tạo approval, paging và controlled command đều cần idempotency key riêng.

Thiết kế mặc định là Kafka work topic với bounded worker cộng rule-first filter. At-most-once tránh duplicate nhưng có thể làm mất incident khi process crash. At-least-once giữ replay và recovery, nên FinPay chấp nhận duplicate delivery và trả chi phí bằng idempotency. Direct HTTP đơn giản hơn ở volume thấp, nhưng replay boundary yếu hơn và biến availability của producer thành một phần timeout budget của caller.

## Kiến trúc hình thành sau các quyết định

```text
Prometheus / OTel ─▶ Kafka source ─▶ validator + atomic inbox claim
                                      │
                         rules-first filter + bounded workers
                                      │
                   OpenSearch trace + runbook retrieval (RAG)
                                      │
                   AI core ──▶ LLM adapter (timeout/retry/breaker)
                                      ├──────────────▶ rules fallback
                                      ▼
                         AI signal + evidence + versions
                                      │
                              deterministic policy
                           ┌─────────┴─────────┐
                           ▼                   ▼
                    read-only incident     approval task
                    / operator guidance    (money/KYC guarded)
                                      │
                audit events ─▶ Kafka ─▶ OpenSearch read model
                                      │
                           authoritative action service
```

Mỗi box tồn tại vì một failure hoặc authority boundary. Kafka cung cấp input được giữ lại và replay. OpenSearch làm evidence dễ query mà không giả làm ledger. Bounded worker cô lập provider latency. AI adapter cô lập timeout và credential theo provider. Policy ngăn model response trở thành command. Approval task ghi lại một state transition do người kiểm soát thay vì thực thi nó.

## Capacity và thực tế vận hành

Nếu triage rate mục tiêu là `R`, p95 provider latency là `L`, utilization mong muốn là `U`, ước lượng đầu tiên là:

```text
worker slots >= ceil(R × L / U)
```

Với `R=200 events/s`, `L=2s`, `U=0.7` chỉ để minh họa, cần `ceil(572)` concurrent slot trước khi tính retry, enrichment và provider quota. Kết quả có thể biện minh cho nhiều worker hơn, nhưng cũng có thể cho thấy cần thêm rules, model nhanh hơn hoặc admission thấp hơn. Bounded connection pool và queue là một phần thiết kế. Theo dõi oldest event age, queue utilization, Kafka lag, provider latency/error, OpenSearch latency, retry volume và dead-letter rate. Per-tenant quota ngăn một BYOK tenant chiếm capacity dùng chung.

Lúc 03:00, on-call cần một chuỗi có thể trace: request hoặc payment reference, alert event, evidence freshness, AI inference ID, model/prompt version, policy version, fallback reason, approval actor và timestamp. Đặt chúng trong structured log, trace và audit record, không đặt làm Prometheus label cardinality cao. Dùng label có miền giới hạn như service, provider, model version, outcome và environment. Không dùng `payment_id`, `account_id`, `event_id` hoặc `trace_id` làm metric label.

Security tuân theo cùng ranh giới. Redact trước khi dựng prompt. Không gửi card data, credential, KYC document hay raw customer payload nếu chưa có quyết định xử lý dữ liệu rõ ràng. Dùng structured allow-list thay vì chỉ dựa vào regex; bảo vệ provider credential bằng secret management; enforce tenant authorization; audit quyền truy cập prompt; áp dụng retention limit. Coi log và runbook retrieve là input không đáng tin vì prompt injection có thể yêu cầu model bỏ qua policy.

Khi provider fail, circuit mở và incident đã biết dùng rules. Incident mơ hồ vẫn hiện với `source=rules` hoặc `status=AWAITING_REVIEW`; không được biến mất. Khi OpenSearch fail, Kafka giữ source và freshness của enrichment được hiển thị. Khi approval service fail, triage result ở trạng thái pending. Khi poison message không qua schema validation, dead-letter topic ghi bounded reason và hỗ trợ replay sau đó.

## Evaluation, rollback và bài học

Temperature thấp hơn và JSON Schema có thể giảm output variation; không điều nào chứng minh correctness. Đánh giá incident lịch sử và synthetic theo false positive, false negative, calibration, abstention, unsupported claim và khả năng chống prompt injection. Version model, prompt, retrieval corpus, policy và AI core độc lập. Replay bằng model mới phải tạo evaluation run mới, không overwrite audit decision ban đầu.

Release đầu nên read-only và rules-first. Chỉ thêm model assistance sau khi đo incident taxonomy và review burden của operator. Nếu approval state vượt khả năng của search index, chuyển claim và approval sang transactional database mà không đổi signal contract. Kiến trúc được phép tiến hóa; authority boundary thì không.

Bài học không phải “dùng LLM cho operations”. Hãy đặt hệ thống inference không đáng tin ở nơi nó có thể bổ sung evidence nhưng không có authority. **AI đề xuất. Policy giới hạn. Một path tất định được cấp quyền mới thực thi.** Nhờ vậy FinPay đang tiến hóa có thể dùng AI lúc 03:00 mà không biến một câu nghe hợp lý thành side effect vận hành hoặc tài chính.

## Tài liệu tham khảo

- Tài liệu Apache Kafka về delivery semantics: https://kafka.apache.org/documentation/#semantics
- Tài liệu OpenTelemetry về trace: https://opentelemetry.io/docs/concepts/signals/traces/
- Hướng dẫn Prometheus về cardinality của metric label: https://prometheus.io/docs/practices/naming/
- OWASP Top 10 cho ứng dụng Large Language Model: https://owasp.org/www-project-top-10-for-large-language-model-applications/

> Repo: https://github.com/finpay-lab/observability
