---
title: "AI Ops Triage sự cố: Từ nhiễu cảnh báo đến giả thuyết an toàn"
description: "Cách FinPay suy luận để tương quan cảnh báo Prometheus và trace OpenTelemetry mà không biến LLM thành thẩm quyền vận hành hay chuyển tiền."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> Repo: https://github.com/finpay-lab/observability

## Bài toán

Lúc 03:00, một lô quyết toán bị chậm. Prometheus báo độ trễ tăng, dịch vụ KYC báo timeout, độ trễ consumer Kafka tăng và nhiều dead-letter queue bắt đầu đầy. Kỹ sư trực ca cần biết nên điều tra gì trước, và một hành động được đề xuất có thể ảnh hưởng tới payment, settlement hay việc review khách hàng hay không.

Câu hỏi kỹ thuật không phải là “LLM có thể tóm tắt các cảnh báo này không?” mà là: **Hệ thống có thể tạo ra giả thuyết sự cố hữu ích đủ nhanh, nhưng vẫn an toàn khi input thiếu, provider không khả dụng và khuyến nghị sai hay không?**

`ai-ops-incident-triage` là một dịch vụ tham chiếu hư cấu, hướng tới thiết kế production cho FinPay. Dịch vụ dùng LLM để đọc, tương quan và phân loại bước đầu. Nó không cấp quyền cho thao tác vận hành có thể chuyển tiền, thay đổi trạng thái KYC hay bỏ qua một kiểm soát. Model tạo ra signal; policy xác định signal đó có thể dẫn tới business action nào.

Ranh giới tương tự áp dụng cho khuyến nghị runbook. “Restart settlement consumer” không phải lệnh thực thi. Đó là một đề xuất có kiểu, có thể cần phê duyệt, maintenance window hoặc một thủ tục xác định hẹp hơn.

## Vì Sao Khó Hơn Ta Nghĩ

Các input có ý nghĩa và vòng đời khác nhau:

- Prometheus phù hợp với alerting time-series, nhưng một alert là triệu chứng, không nhất thiết là event nguyên nhân.
- Trace OpenTelemetry cung cấp context và timing của request, nhưng trace có thể được sample, đến muộn, thiếu hoặc không tồn tại khi outage.
- Kafka là event source và replay source bền vững. Nó không phải query API cho dashboard vận hành.
- OpenSearch phù hợp làm nơi lưu trace và read/index model. Nó không phải payment ledger authoritative.
- LLM có thể tương quan ngôn ngữ và bằng chứng, nhưng nondeterministic, có thể hallucinate nguyên nhân hoặc bước runbook.

Sai lầm nguy hiểm không chỉ là false positive. False negative có thể che giấu sự cố thật. Một giải thích nghe hợp lý nhưng không có bằng chứng có thể hướng on-call tới nhầm service. Một retry có vẻ vô hại có thể nhân số provider call, chi phí AI và Kafka lag. Một lần nâng model có thể thay đổi phân bố quyết định dù application code không đổi.

Mục tiêu là hỗ trợ có giới hạn, không phải biến AI thành thẩm quyền của control plane.

## Thiết Kế Ngây Thơ

Thiết kế đầu tiên hấp dẫn vì có rất ít thành phần:

```text
Prometheus alert ──▶ Kafka ──▶ Consumer ──▶ LLM ──▶ tạo incident / hành động runbook
```

Consumer gửi alert, có thể kèm một ít trace text, rồi hỏi “Chúng ta nên làm gì?” Nó lưu câu trả lời và ack Kafka. Ở tải thấp, thiết kế này có vẻ hoạt động.

## Thiết Kế Ngây Thơ Hỏng Ở Đâu

Ở 10.000 alert event mỗi giây, một lời gọi LLM mất hai giây cần xấp xỉ:

```text
concurrency = throughput × latency = 10.000 × 2 = 20.000 lời gọi đang xử lý
```

Ở mười giây, con số là 100.000. Đây không phải lý do để cấp 100.000 thread. Nó cho thấy provider call đồng bộ không thể nằm trực tiếp trên đường Kafka consumer. Quota provider, connection pool, memory và rate limit downstream mới là giới hạn capacity thực tế.

Các ca lỗi quan trọng hơn happy path:

1. **Provider chậm hoặc outage.** Blocking call giữ consumer. Poll chậm lại, partition lag tăng và backlog cảnh báo lớn dần khi dependency đã lỗi.
2. **Retry storm.** Ba attempt cho mỗi event biến outage provider thành gấp ba traffic. Nhiều consumer instance còn có thể khuếch đại storm.
3. **Timeout không rõ nghĩa.** Client timeout nhưng provider có thể đã hoàn thành request. Retry có thể tạo duplicate model call và audit record mâu thuẫn.
4. **Event duplicate hoặc replay.** Kafka redelivery, rebalance, reset offset hoặc replay chạy triage hai lần và có thể page hai lần. `exists()` rồi `insert()` không phải lock: hai consumer đều có thể thấy “chưa tồn tại.”
5. **Consumer crash.** Process chết sau khi tạo runbook task nhưng trước khi commit offset; redelivery có thể tạo task lần nữa.
6. **Dữ liệu out-of-order.** Trace có thể đến sau alert. Query enrichment không thấy span và kết luận sai rằng không có lỗi.
7. **Poison message.** Model output sai format hoặc payload quá lớn có thể fail lặp lại và chặn partition.
8. **Backpressure và queue đầy.** Worker pool phải bounded, nhưng khi đầy hệ thống cần pause intake, defer work hoặc dùng rules-only path. Queue không giới hạn chỉ chuyển outage vào heap memory.
9. **Model regression.** Prompt, model hoặc retrieval corpus mới có thể làm tăng khuyến nghị severity cao hoặc giảm khả năng phát hiện sự cố KYC và settlement.
10. **Partial failure.** OpenSearch có thể unavailable trong khi Kafka vẫn khỏe; audit sink có thể down sau khi triage thành công; provider có thể thành công nhưng approval service thất bại.

Quan trọng nhất là ai có authority? Model không được biến “refund” hay “disable KYC review” thành side effect. Authority thuộc về deterministic policy, approval workflow và system of record thực hiện action.

## Quyết Định Thiết Kế Đầu Tiên

Tách **signal path** khỏi **authority path**:

```text
AI signal ──▶ policy validation ──▶ trạng thái triage / approval task ──▶ operator hoặc ledger có kiểm soát
```

AI output là bằng chứng kèm confidence và provenance. Policy quyết định nó chỉ được hiển thị, có thể mở human approval task hay phải bị từ chối. Ledger và hệ thống KYC vẫn authoritative đối với record của chính chúng.

Đồng thời tách event source khỏi query storage:

- Kafka giữ alert, trace-reference, triage và audit event để xử lý at-least-once và replay.
- Database hoặc ledger vẫn là system of record cho payment và approval state.
- OpenSearch lưu trace có thể tìm kiếm, incident document và read model.

Nếu OpenSearch index bị mất, có thể replay Kafka để dựng lại. Nếu ghi index thất bại, source event không được âm thầm bỏ đi.

## Các Bài Toán Kỹ Thuật Khó

### 1. Tương quan là gom bằng chứng, không phải sự thật về nguyên nhân

Dịch vụ xây dựng `IncidentContext` từ Prometheus alert, metadata service, thông tin deployment và các OpenTelemetry span tương quan. Trace enrichment thực chất là một bước RAG nhỏ: lấy bằng chứng liên quan, có giới hạn, rồi yêu cầu model suy luận trên bằng chứng đó. Truy hồi runbook cũng là RAG, nhưng text được truy hồi chỉ là tài liệu tham khảo, không phải instruction có authority.

```java
@Component
public class OpenSearchTraceEnricher {
    private final OpenSearchClient client;

    public List<TraceSpan> correlatedSpans(String traceId) {
        return client.search(b -> b
                .index("finpay-traces-*")
                .query(q -> q.term(t -> t.field("trace.id").value(traceId)))
                .size(200), TraceSpan.class)
            .hits().hits().stream().map(h -> h.source()).toList();
    }
}
```

Context phải ghi nhận bằng chứng bị thiếu. “Không tìm thấy trace” không có nghĩa là “không có lỗi.” Ví dụ timeout KYC có thể đã bị sample hoặc span chưa kịp vào OpenSearch. Model nên nhận một field uncertainty rõ ràng và timestamp freshness.

**AI core library** dùng chung nên sở hữu prompt template, schema validation, redaction, provider metadata, model/prompt version và evaluation hook. Feature service nên cung cấp domain fact và policy, không tự phát minh một safety wrapper khác.

### 2. AI là signal, signal cần policy

Incident triage có nhiều kỹ thuật với failure profile khác nhau:

- **Rules** phù hợp với điều kiện đã biết: dead-letter queue vượt ngưỡng, thiếu approval event hoặc provider error code. Chúng deterministic, rẻ và dễ audit, nhưng cứng nhắc với tổ hợp mới.
- **Phương pháp thống kê** hữu ích cho seasonality và thay đổi đột ngột của latency hoặc lag. Chúng cho anomaly score, nhưng tương quan không phải nguyên nhân.
- **ML classifier** phù hợp với nhóm incident lặp lại khi có lịch sử đã gắn nhãn. Chúng cần drift monitoring, calibration và evaluation data có version.
- **LLM** phù hợp với alert text không cấu trúc, truy hồi runbook và giả thuyết dễ đọc giữa nhiều service. Nó đắt, bị rate limit, nondeterministic và dễ bị prompt injection trong log.

Vì vậy output contract phải rõ ràng:

```java
public record TriageOutcome(
        String eventId,
        Severity severity,
        String hypothesis,
        double confidence,
        Recommendation recommendation,
        String source,          // llm | rules
        String modelVersion,
        String promptVersion,
        boolean evidenceSufficient) {}

public record Recommendation(ActionKind kind, String reason,
        String runbookId, boolean touchesMoney, boolean changesKycState) {}
```

Policy layer có thể từ chối recommendation nếu confidence dưới ngưỡng, bằng chứng cũ, action chạm tiền hoặc KYC, runbook không nằm trong allow-list hay model version chưa được duyệt. Trình tự bắt buộc là: **AI signal -> policy -> business decision**.

### 3. Delivery semantics và idempotency

Kafka consumer thường cần xử lý at-least-once. “Exactly once” ở broker không làm external call exactly once. Check ngây thơ sau là sai:

```java
// WRONG: cả hai consumer có thể đọc false trước khi insert của bên nào commit.
if (!store.exists(event.eventId())) {
    store.insert(event.eventId());
    createApprovalTask(event); // duplicate side effect
}
```

Dùng operation uniqueness nguyên tử:

```java
public interface IdempotencyPort {
    boolean tryClaim(String eventId); // atomic, có lease/recovery state
    void complete(String eventId, TriageOutcome outcome);
}

public boolean tryClaim(String eventId) {
    try {
        client.index(b -> b.index("finpay-incident-triage")
                .id(eventId).opType(OpType.Create));
        return true;
    } catch (ResourceAlreadyExistsException duplicate) {
        return false;
    }
}
```

Các cơ chế tương đương gồm database unique constraint với atomic insert, Redis `SETNX` kèm expiry, inbox table hoặc transactional outbox/inbox. Incident ID deterministic nên được suy ra từ source identity, không generate lại ở mỗi retry.

Có hai bài toán idempotency khác nhau:

- **Idempotent storage:** cùng `eventId` không tạo nhiều triage record.
- **Idempotent side effect:** cùng approval task, page, notification hoặc restart request không được thực thi hai lần.

Giải quyết vấn đề đầu không tự động giải quyết vấn đề sau. Approval creation cần idempotency key riêng; external action cần API idempotency key hoặc durable command state machine. Claim cũng cần lease hoặc recovery policy: in-flight record tồn tại vĩnh viễn sau crash là một dạng mất dữ liệu ẩn.

## Các Lựa Chọn Và Đánh Đổi

**Option A: LLM đồng bộ trong Kafka listener.** Đơn giản và có câu trả lời ngay, nhưng latency và availability của provider kiểm soát tiến độ partition. Không phù hợp với traffic burst.

**Option B: Kafka work topic và bounded worker.** Listener validate và claim event; worker enrichment và gọi provider. Backpressure theo partition, giới hạn concurrency và retry topic làm tải trở nên quan sát được. Đây là lựa chọn production-oriented mặc định.

**Option C: rules-first, AI hỗ trợ escalation.** Rules xử lý incident đã biết ngay; chỉ case mơ hồ mới dùng LLM. Cách này giảm cost và tác động của outage, nhưng rules và threshold cần bảo trì và có thể bỏ sót incident mới.

FinPay kết hợp B và C. Kafka là replay source, deterministic rules engine là fallback và first filter, còn LLM bị cô lập sau `IncidentTriagePort`. Trong thiết kế tham chiếu này, OpenSearch là trace/read model và atomic claim store; nếu lease claim và approval state cần transactional semantics mạnh hơn, database transactional có thể phù hợp hơn.

## Kiến Trúc

```text
Prometheus / OTel ─▶ Kafka source ─▶ validator + atomic inbox claim
                                      │
                         bounded triage workers / backpressure
                                      │
                   OpenSearch trace + runbook retrieval (RAG)
                                      │
                   AI core library ──▶ BYOK LLM adapter
                                      │ timeout/retry/breaker
                                      ├──────────────▶ rules fallback
                                      ▼
                         AI signal + evidence + versions
                                      │
                              deterministic policy
                           ┌─────────┴─────────┐
                           ▼                   ▼
                    incident chỉ đọc      approval task
                    / hướng dẫn operator   (money/KYC có guard)
                                      │
                audit events ─▶ Kafka ─▶ OpenSearch read model + archive
```

Domain core phụ thuộc vào port, không phụ thuộc Kafka, Spring AI hay OpenSearch:

```text
com.finpay.observability
├── domain
│   ├── model  IncidentContext, TriageOutcome, Recommendation
│   ├── port   IncidentTriagePort, RuleEnginePort, IdempotencyPort, AuditPort
│   └── service TriageOrchestrator
├── infrastructure
│   ├── kafka  IncidentConsumer, AuditProducer
│   ├── ai    OpenAiIncidentTriageAdapter, AiCoreClient
│   ├── opensearch TraceEnricher, RunbookRetriever, ReadModel
│   └── config Resilience4jConfig
```

Orchestrator sở hữu policy, không sở hữu việc diễn giải model:

```java
public TriageOutcome triage(IncidentContext ctx) {
    TriageOutcome outcome;
    try {
        outcome = triagePort.triage(ctx); // strict JSON schema
    } catch (TriageUnavailableException ex) {
        outcome = ruleEnginePort.triage(ctx).withSource("rules");
    }

    if (!outcome.evidenceSufficient()
            || outcome.confidence() < policy.minConfidence()
            || outcome.recommendation().touchesMoney()
            || outcome.recommendation().changesKycState()) {
        approvalPort.open(ApprovalTask.create(ctx.eventId(), outcome));
        outcome = outcome.withStatus(Status.AWAITING_REVIEW);
    }
    auditPort.record(AuditEntry.decided(ctx, outcome));
    return outcome;
}
```

LLM adapter dùng BYOK credential được inject lúc runtime, output strict và resilience có giới hạn. Mười lăm giây và ba attempt chỉ là ví dụ policy, không phải benchmark phổ quát; chúng phải được chọn theo alert SLO, hợp đồng provider và ngân sách concurrency.

```java
return retry.executeSupplier(() ->
        circuitBreaker.executeSupplier(() ->
                timeLimiter.executeFutureSupplier(
                    () -> CompletableFuture.supplyAsync(() -> callLlm(ctx)))));
```

Retry chỉ nên áp dụng cho lỗi transient và an toàn để lặp lại, dùng exponential backoff có jitter và dừng theo retry budget. Timeout không chứng minh provider chưa làm gì, vì vậy audit phải ghi attempt và provider request correlation ID.

## Các Kịch Bản Thất Bại

- **LLM unavailable hoặc rate-limited:** mở breaker, dùng rules, publish `source=rules` và tiếp tục xử lý alert. Không queue provider retry vô hạn.
- **Timeout hoặc provider response một phần:** phân loại là unavailable hoặc invalid, audit và không xem late response là authoritative.
- **OpenSearch unavailable:** giữ Kafka event, pause hoặc route sang bounded retry topic và công khai enrichment freshness. Không tự tạo trace evidence.
- **Kafka retry hoặc duplicate:** atomic inbox claim ngăn duplicate triage; approval và notification API vẫn cần idempotency key riêng.
- **Alert và trace đến không đúng thứ tự:** chờ trong enrichment window có giới hạn, sau đó xử lý với `evidenceSufficient=false`. Replay về sau có thể dựng read model nhưng không sửa audit entry gốc.
- **Consumer crash hoặc rebalance:** chỉ commit offset sau durable outcome/audit intent. Claim hết hạn và retry topic giúp khôi phục work bị bỏ dở.
- **Poison message hoặc schema mismatch:** gửi dead-letter topic với reason, event ID và metadata payload có giới hạn. Không retry mãi.
- **Queue đầy:** áp dụng admission control và pause partition. Theo dõi tuổi event lâu nhất và bỏ context RAG tùy chọn trước khi bỏ source event.
- **Database hoặc approval service lỗi:** giữ outcome ở pending state rõ ràng. Không suy ra approval từ việc model call thành công.
- **Model regression hoặc rollback:** deploy model và prompt version độc lập, shadow-test trên evaluation set cố định, theo dõi decision distribution và giữ version trước để rollback. Replay Kafka bằng model mới phải tạo run/evaluation ID mới, không overwrite audit gốc.

## Capacity Và Hiệu Năng

Capacity phụ thuộc queue, provider và worker limit, không phụ thuộc một thread count đoán mò. Nếu target triage rate là `R`, p95 provider latency là `L` và utilization mong muốn là `U`, ước lượng ban đầu là:

```text
workers >= ceil(R × L / U)
```

Ví dụ `R=200 events/s`, `L=2s`, `U=0.7` cần ít nhất `ceil(571)` call slot đồng thời trước khi tính retry, enrichment và provider quota. Phép tính có thể cho thấy câu trả lời đúng không phải thêm worker mà là rules-first filtering, batching, local model nhanh hơn hoặc giảm intake rate. Ở mười giây, cùng service cần gấp năm lần số slot.

Dùng connection pool và queue bounded. Đo Kafka lag, tuổi event lâu nhất, OpenSearch query latency, provider latency, timeout rate, retry volume và queue utilization. Bảo vệ tenant bằng quota riêng vì BYOK phân bổ cost và provider capacity cho từng khách hàng.

## Security Và Privacy

Redact trước khi tạo prompt, không phải sau khi log. Không tùy tiện gửi toàn bộ transaction, số thẻ, credential, tài liệu KYC, customer payload hay token tới external provider. Ưu tiên incident schema tối thiểu gồm service name, metric aggregate, identifier an toàn ở provider boundary và reference tới evidence.

```java
String redact(String raw) {
    return raw.replaceAll("\\d{13,19}", "****")
              .replaceAll("(?i)(password|token)=\\S+", "$1=REDACTED");
}
```

Regex chỉ là một lớp phòng thủ nhỏ. Cần structured allow-list, kiểm soát data retention của provider, mã hóa khi truyền và khi lưu, secret injection qua Kubernetes Secret hoặc Vault, role-based access, audit quyền truy cập prompt và retention limit. Log redaction mask và hash, không log payload thô. Xem log content và runbook được retrieve là text không đáng tin vì prompt injection có thể nằm trong đó.

## Auditability Và Observability

Một log line không phải audit trail. Append-only audit event nên lưu, theo data-minimization policy:

```text
transaction_id, event_id, trace_id, occurred_at
feature/evidence reference, confidence score, decision
model, model_version, prompt_version, provider, provider_request_id
policy_version, fallback reason, approval actor và approval time
```

Lưu original event trong Kafka, searchable projection trong OpenSearch và approval/payment state ở authoritative store của nó. Giữ prompt hash và redacted input snapshot khi retention policy cho phép để reviewer phân biệt “cùng input, khác model” với “evidence khác.” Reproducibility nghĩa là dựng lại evidence và version, không phải tuyên bố LLM luôn trả về text byte-identical.

Observability phải bao phủ business behavior và system health:

```text
transactions_processed, anomalies_detected, review_rate
false_positive_rate, false_negative_rate, decision_distribution
ai_timeout_rate, ai_cost, model_error_rate, provider_error_rate
model_version, queue_age, kafka_lag, opensearch_query_latency
```

Không đặt `transaction_id`, `account_id`, `event_id` hay `trace_id` vào Prometheus label. Cardinality của chúng có thể làm metrics backend quá tải. Đưa chúng vào structured log, trace hoặc audit store; dùng label bounded như service, provider, model version, outcome và environment.

## Các Lưu Ý Riêng Cho AI

Dùng temperature và JSON Schema để giảm biến động, nhưng đừng nhầm biến động thấp với tính đúng. Đánh giá hệ thống bằng incident lịch sử và synthetic incident có severity, root-cause evidence và safe action được gắn nhãn. Theo dõi false positive, false negative, calibration, abstention rate, unsupported claim và prompt-injection test.

Version prompt, retrieval corpus, model, policy và AI core library độc lập. Một runbook update có thể đổi output dù model không đổi. Model có thể unavailable, quá đắt hoặc rate-limited. Fallback phải hữu ích mà không giả vờ cung cấp semantic correlation.

Giới hạn RAG context theo service, time window, trace ID và runbook document trong allow-list. Không cho retrieved text ghi đè system policy. Model phải có thể trả lời “insufficient evidence”, và đây phải là outcome hợp lệ, không phải parser failure.

## Nếu Làm Lại

Chúng tôi sẽ giữ phiên bản đầu tiên rules-first và read-only, sau đó mới thêm LLM sau khi đo incident taxonomy và review burden. Nếu claim lease trở nên khó vận hành, chúng tôi sẽ dùng durable inbox/outbox hoặc database cho approval state. Chúng tôi sẽ kiểm tra replay cost trước khi bật historical reprocessing rộng, vì mỗi replay có thể tiêu quota provider và tạo recommendation từ model version mới.

Chúng tôi cũng sẽ biến AI core library thành platform dependency có conformance test: không prompt chưa redact được rời process, mọi response có schema và version, mọi fallback phát audit event và mọi external side effect có idempotency key.

## Bài Học Chính

1. Bắt đầu từ failure và authority boundary, không bắt đầu từ model hay diagram.
2. Xem LLM output là AI signal; deterministic policy sở hữu business decision.
3. Kafka là replayable source, OpenSearch là read model, còn ledger hoặc approval store là authoritative.
4. `exists()` rồi `insert()` không phải idempotency. Dùng uniqueness nguyên tử và bảo vệ side effect riêng.
5. Capacity là `concurrency = throughput × latency`; retry và provider quota phải nằm trong phép tính.
6. Audit version, evidence, decision, fallback và approval để có thể giải thích và đánh giá kết quả.
7. Giảm thiểu PII và coi model failure, uncertainty, rollback là các state bình thường.

## Câu Hỏi Phỏng Vấn

- Điều gì xảy ra khi provider hoàn thành sau khi client timeout?
- Hai consumer tránh cùng claim một event như thế nào?
- Authority của refund hoặc thay đổi KYC status là hệ thống nào?
- Làm sao replay sáu tháng incident mà không tạo provider hoặc approval side effect?
- Metric nào cho thấy model regression trước khi khách hàng báo lỗi?

## Tài Liệu Tham Khảo

- Tài liệu Apache Kafka về delivery semantics: https://kafka.apache.org/documentation/#semantics
- Tài liệu OpenTelemetry về trace: https://opentelemetry.io/docs/concepts/signals/traces/
- Hướng dẫn Prometheus về cardinality của metric label: https://prometheus.io/docs/practices/naming/
- OWASP Top 10 cho ứng dụng Large Language Model: https://owasp.org/www-project-top-10-for-large-language-model-applications/

> Repo: https://github.com/finpay-lab/observability
