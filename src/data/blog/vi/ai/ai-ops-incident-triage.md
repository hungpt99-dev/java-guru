---
title: "AI Ops Triage sự cố: Từ nhiễu cảnh báo đến giả thuyết an toàn"
description: "Cách FinPay suy luận để tương quan cảnh báo Prometheus và trace OpenTelemetry mà không biến LLM thành thẩm quyền vận hành hay chuyển tiền."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## Câu hỏi lúc 03:00

Lúc 03:00, một lô settlement của FinPay bị trễ. Prometheus cho thấy API latency tăng. Request KYC bắt đầu timeout. Kafka consumer lag tăng, còn nhiều dead-letter queue bắt đầu đầy.

Kỹ sư on-call có bốn dashboard và một câu hỏi khẩn cấp: “Nên restart thành phần nào?” Câu hỏi này nguy hiểm. Restart có thể che khuất triệu chứng, tạo thêm công việc trùng lặp hoặc làm settlement trễ hơn. Thay đổi KYC state, payment state, balance hay ledger còn nguy hiểm hơn.

Kết quả hữu ích đầu tiên không phải là chẩn đoán. Đó là một giả thuyết có giới hạn, có bằng chứng và có mức độ không chắc chắn rõ ràng. Các invariant của FinPay phải đứng trước: ledger là nguồn sự thật tài chính, settlement chạy theo state machine tất định, và AI không bao giờ authorize một action không thể đảo ngược.

Bài viết này tập trung vào một insight: **correlation chỉ tập hợp bằng chứng; nó không chứng minh causality. Recommendation từ AI là proposal có kiểu, không phải lệnh thực thi.**

## Bắt đầu từ thiết kế hiển nhiên

Thiết kế đầu tiên rất dễ vẽ:

```text
Prometheus alert ──▶ Kafka ──▶ consumer ──▶ LLM ──▶ execute runbook action
```

Consumer gửi alert text và vài trường trace cho LLM, lưu câu trả lời, acknowledge Kafka rồi thực thi runbook được đề xuất. Nó đơn giản vì ingestion, investigation, inference và authority nằm trong cùng một request.

Sự đơn giản đó không chịu được traffic và failure. Các con số sau là **giả định minh họa**, không phải số đo của FinPay. Với 10.000 alert event mỗi giây và model latency hai giây:

```text
in-flight calls = throughput × latency = 10,000 × 2 = 20,000
```

Ở mười giây, cùng path có 100.000 call đang xử lý. Đây không phải đề xuất tạo 100.000 thread. Nó cho thấy provider quota, connection pool, memory và Kafka listener không thể tăng theo provider latency.

Giả sử provider latency tăng từ 300 ms lên bốn giây. Worker của listener bị giữ lại, poll chậm đi và Kafka lag trông như lỗi chính. Retry ba lần có thể đẩy khoảng gấp ba traffic thất bại vào provider vốn đã không khỏe. Client timeout cũng không chứng minh provider chưa xử lý request: request có thể hoàn tất sau khi client bỏ cuộc. Retry vì vậy có thể tạo hypothesis trùng lặp và mâu thuẫn.

Queue nội bộ không giới hạn chỉ chuyển failure từ Kafka lag sang cạn heap. `exists()` rồi `insert()` cũng không phải atomic claim; hai consumer có thể cùng tạo hai review task. Trace có thể đến sau alert, bị sampling hoặc không được index. “Không tìm thấy span” là bằng chứng về evidence bị thiếu, không phải bằng chứng rằng không có failure.

Mũi tên cuối cùng không thể chấp nhận. LLM không được restart settlement consumer, đổi KYC state, authorize payment, cập nhật balance, mutate ledger hay settle funds. Log và runbook là input không đáng tin và có thể chứa prompt injection. Một đoạn văn nghe hợp lý vẫn chỉ là giả thuyết.

## Constraint trước component

Với thiết kế tham chiếu này, ta dùng các **giả định và yêu cầu** sau:

- Alert ingestion tiếp tục khi AI provider chậm hoặc không khả dụng.
- Triage có thể trễ, nhưng alert nguồn vẫn durable và replay được.
- Trace thiếu hoặc cũ phải được ghi nhận là uncertainty.
- Pattern đã biết có path tất định, ít tốn kém.
- Recommendation ảnh hưởng đến production control phải có approval rõ ràng.
- Payment, KYC, settlement và ledger state vẫn authoritative trong deterministic store tương ứng.
- Mọi result phải giải thích được từ evidence, policy và version metadata.
- Rate và latency trong ví dụ chỉ để minh họa; giới hạn thật cần load test, hợp đồng provider và alert SLO được thống nhất.

Các constraint này đã loại bỏ giả định “model quyết định”. Sau đó ta mới so sánh boundary, thay vì chọn infrastructure theo thói quen.

## Chọn boundary

Synchronous processing có ưu điểm là caller nhận câu trả lời ngay. Nhưng nó đặt provider latency và availability vào timeout của alert ingestion. Nó phù hợp với operator query volume thấp, nơi mất query là chấp nhận được. Nó không phải default tốt cho việc xử lý alert durable.

Direct HTTP với database inbox đơn giản hơn broker ở volume thấp. Đổi lại, producer phụ thuộc availability của consumer và phải tự có cơ chế replay khác. Durable work topic tạo handoff rõ ràng: nhận source event trước, điều tra sau.

At-most-once tránh duplicate work nhưng có thể làm mất incident khi process crash sau action và trước acknowledge. At-least-once giữ replay và recovery, nên FinPay chấp nhận duplicate delivery và trả chi phí bằng atomic claim cùng idempotent side effect.

Vì vậy, ta chọn signal path bất đồng bộ với bounded worker. Rules chạy trước model. Model chỉ được dùng khi việc ghép evidence đáng với chi phí. Thiết kế này thêm queue lag và cơ chế vận hành, nhưng ngăn provider outage biến thành alert-ingestion outage.

Authority boundary được tách riêng:

```text
AI signal ──▶ deterministic policy ──▶ triage state / approval task ──▶ controlled action
```

Model trả về severity suggestion, hypothesis, confidence, evidence reference và recommendation kind có kiểu rõ ràng. Policy validate schema, evidence freshness, confidence threshold, runbook trong allow-list, và proposal có ảnh hưởng money hoặc KYC không. Result có thể là guidance chỉ đọc, approval task hoặc abstention rõ ràng. Approval task không phải action; operator được authorize hoặc deterministic service phải thực hiện state transition tiếp theo.

## Tập hợp evidence, không tự bịa nguyên nhân

Prometheus mô tả threshold violation. OpenTelemetry trace cung cấp timing và request context nhưng có thể bị sampling, đến trễ hoặc thiếu. Kafka là durable source cho alert và audit event, không phải operator query API. OpenSearch là trace và incident read model có thể tìm kiếm, không phải payment ledger.

Triage service dựng `IncidentContext` có giới hạn từ alert, service/deployment metadata và span được correlate trong một time window. Service ghi lại evidence nào thiếu và evidence được quan sát lúc nào. Đây là một flow retrieval-and-reasoning nhỏ, không phải quyền coi text được retrieve là instruction.

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

AI core đã được thiết lập trong các bài trước sở hữu redaction, strict schema validation, provider metadata, prompt version và evaluation hook. Service này cung cấp incident fact và policy; nó không tạo thêm một cơ chế authority thứ hai.

## Rules trước, AI cho ambiguity

Rule phù hợp với condition đã biết như dead-letter queue vượt threshold được duyệt hoặc thiếu approval event. Anomaly score có thể đánh dấu lag bất thường nhưng không thể chứng minh nguyên nhân. Classifier có thể phù hợp với nhóm incident lặp lại và có label. LLM hữu ích cho alert text không có cấu trúc, bounded runbook retrieval và hypothesis dễ đọc xuyên nhiều service. Nó cũng nondeterministic, bị rate-limit, tốn chi phí và chịu ảnh hưởng của log độc hại.

Rules-first vì thế vừa là fast path vừa là degraded mode. Khi provider unavailable, incident đã biết vẫn có triage hữu ích. Case mơ hồ và rủi ro cao trở thành `AWAITING_REVIEW`, không tự động block hay release. Policy reject hoặc downgrade output khi evidence cũ, thiếu field, confidence thấp hơn threshold được duyệt, runbook không nằm trong allow-list hoặc proposal money/KYC chưa được approve. “Insufficient evidence” là result hợp lệ.

## Async sửa coupling và tạo duplicate

Quyết định async tạo ra vấn đề mới: crash hoặc rebalance có thể redeliver cùng alert, còn task đã claim có thể bị bỏ dở. Listener validate event và atomic claim. Bounded worker enrich evidence rồi gọi provider. Offset chỉ commit sau khi outcome và audit intent đã durable.

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

Cùng atomic uniqueness có thể dùng database unique constraint và inbox table. Redis `SETNX` có thể phù hợp với claim ngắn hạn, nhưng expiry một mình không phải recovery. Lease cần owner, timeout và retry state an toàn. Inbox idempotency cũng không làm paging, tạo approval hay controlled command trở thành idempotent; mỗi side effect cần key riêng.

Retry topic, backoff có jitter, circuit breaker, bounded queue và retry budget làm pressure lộ rõ. Chúng không làm provider unavailable trở nên khỏe lại. Khi claim bị kẹt, recovery phải explicit thay vì cho phép hai worker xử lý đồng thời.

## Kiến trúc sau quá trình suy luận

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

Mỗi box trả lời một failure cụ thể. Kafka giữ source và hỗ trợ replay. Inbox ngăn duplicate claim. Bounded worker cô lập provider latency. OpenSearch giúp query evidence mà không trở thành ledger. Adapter cô lập timeout, retry, credential và circuit state theo provider. Policy ngăn model response trở thành command. Approval task ghi lại transition do người kiểm soát thay vì thực thi nó.

## Thực tế vận hành

Nếu triage rate mục tiêu là `R`, p95 provider latency là `L`, utilization mong muốn là `U`, capacity estimate ban đầu là:

```text
worker slots >= ceil(R × L / U)
```

Với **giả định minh họa** `R=200 events/s`, `L=2s`, `U=0.7`, kết quả là `ceil(572)` slot trước khi tính retry, enrichment và provider quota. Kết quả có thể cần thêm capacity, nhưng cũng có thể cho thấy cần thêm rule, model nhanh hơn hoặc admission thấp hơn. Bounded connection pool và queue là một phần của thiết kế.

Theo dõi oldest event age, queue utilization, Kafka lag, provider latency/error, OpenSearch latency, retry volume, claim age và dead-letter rate. Định nghĩa alert SLO theo yêu cầu thật; không coi các con số ví dụ là cam kết của FinPay. Dùng metric label có miền giới hạn như service, provider, model version, outcome và environment. Không dùng `payment_id`, `account_id`, `event_id` hay `trace_id` làm Prometheus label.

Lúc 03:00, một chuỗi có thể trace là điều quan trọng: request hoặc payment reference, alert event, evidence freshness, AI inference ID, model/prompt version, policy version, fallback reason, approval actor và timestamp. Lưu chúng trong structured log, trace và audit record.

Redact trước khi dựng prompt. Không gửi card data, credential, KYC document hoặc raw customer payload nếu chưa có quyết định xử lý dữ liệu rõ ràng. Enforce tenant authorization, bảo vệ provider credential bằng secret management, audit quyền truy cập prompt và áp dụng retention limit. Coi log và runbook được retrieve là input không đáng tin vì prompt injection có thể yêu cầu model bỏ qua policy.

Nếu provider fail, circuit mở và rule xử lý incident đã biết. Nếu OpenSearch fail, Kafka giữ source và freshness bị thiếu được hiển thị. Nếu approval fail, result giữ trạng thái pending. Nếu schema validation reject poison message, dead-letter topic ghi bounded reason để replay sau. Không path nào trong số này mutate ledger.

## Đánh giá và bài học

Temperature thấp hơn và JSON Schema có thể giảm output variation; không điều nào chứng minh correctness. Đánh giá incident lịch sử và synthetic theo false positive, false negative, calibration, abstention, unsupported claim và khả năng chống prompt injection. Version model, prompt, retrieval corpus, policy và AI core độc lập. Replay bằng model mới tạo evaluation run mới và không overwrite audit decision ban đầu.

Release đầu nên read-only và rules-first. Chỉ thêm model assistance sau khi đo incident taxonomy và review burden của operator. Nếu approval state vượt khả năng của search index, chuyển claim và approval sang transactional database mà không đổi signal contract.

Bài học không phải “dùng LLM cho operations”. Hãy đặt inference không đáng tin ở nơi nó có thể bổ sung evidence nhưng không có authority:

```text
AI đề xuất → policy giới hạn → path tất định được cấp quyền thực thi
```

Boundary này cho phép FinPay điều tra sự cố lúc 03:00 mà không biến một câu nghe hợp lý thành side effect vận hành hoặc tài chính.

## Tài liệu tham khảo

- Tài liệu Apache Kafka về delivery semantics: https://kafka.apache.org/documentation/#semantics
- Tài liệu OpenTelemetry về trace: https://opentelemetry.io/docs/concepts/signals/traces/
- Hướng dẫn Prometheus về cardinality của metric label: https://prometheus.io/docs/practices/naming/
- OWASP Top 10 cho ứng dụng Large Language Model: https://owasp.org/www-project-top-10-for-large-language-model-applications/

> Repo: https://github.com/finpay-lab/observability
