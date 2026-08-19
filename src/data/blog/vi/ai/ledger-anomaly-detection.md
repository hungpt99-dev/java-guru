---
title: "Thiết kế phát hiện bất thường trong ledger với Kafka và Prometheus"
description: "Thiết kế có guardrail để chấm điểm sự kiện ledger bất đồng bộ mà không đưa AI vào luồng xử lý tiền."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> **Repository:** https://github.com/finpay-lab/ledger-service

# Phát hiện bất thường trong ledger: từ rủi ro đến thiết kế có giới hạn

Phát hiện bất thường nghe như một bài toán tích hợp model. Với ledger, trước hết đây là bài toán reliability và accountability: hệ thống cần phát hiện sớm hoạt động đáng ngờ, nhưng provider AI chậm, sai, không khả dụng hoặc không lặp lại được không được làm hỏng việc posting hay âm thầm di chuyển tiền.

Bài viết tách dữ kiện của repository được cung cấp khỏi đề xuất thiết kế hướng production. FinPay được xem là ngữ cảnh tham chiếu/giả tưởng; đây không phải tuyên bố rằng thiết kế đã được triển khai.

## 1. Vấn đề

**[SOURCE FACT]** Mô tả được cung cấp xác định `ledger-service` là Spring Boot service. Mỗi payment được ghi thành cặp `debit`/`credit` theo double-entry trong một database transaction. Ledger event được publish lên Kafka, topic `ledger.events`, và có thể tìm kiếm trong OpenSearch. Mục tiêu được nêu là gắn cờ mẫu đáng ngờ trước đối soát và batch job lúc 2 giờ sáng.

Kết quả hữu ích không phải là “model nói yes”. Pipeline cần có thể giải thích:

```text
ledger event -> AI signal -> deterministic policy -> business decision
```

Signal có thể yêu cầu điều tra. Policy có thể chọn `ALLOW`, `REVIEW` hoặc `HOLD`, dựa trên bằng chứng và có thể cần human approval. AI không được trực tiếp gọi `hold`, `block` hay `reject`.

## 2. Vì sao khó

Có nhiều nguồn failure độc lập:

- **False positive:** payment hợp lệ nhưng lớn bất thường có thể bị gắn cờ, gây hại cho khách hàng hoặc vận hành.
- **False negative:** kẻ tấn công có thể lọt qua detector; “không đáng ngờ” không phải bằng chứng an toàn.
- **Nondeterminism:** cùng input có thể cho output khác sau sampling, thay đổi provider hoặc prompt. Verdict cần đi kèm version của model, prompt và policy.
- **Latency và cost:** inference từ xa có latency biến động và chi phí theo request. Rate limit, quota, outage, timeout và response một phần là các case bình thường.
- **Delivery semantics:** Kafka thường giao at-least-once. Timeout sau một side effect có thể bị tiếp nối bằng retry, nên không thể lấy “chỉ gọi một lần” làm mô hình correctness.
- **Privacy:** full transaction có thể chứa PII hoặc thông tin counterparty nhạy cảm. Gửi tùy tiện sang provider AI bên ngoài sẽ mở rộng ranh giới dữ liệu.

## 3. Thiết kế ngây thơ

Thiết kế dễ nghĩ đến là gọi model sau posting rồi để câu trả lời kích hoạt hold:

```java
// WRONG: AI đồng bộ, quyết định tiền và dùng secret hardcode.
@Transactional
public void postLedger(PaymentEvent event) {
    ledger.post(debit(event), credit(event));
    String answer = openAi.ask(prompt(event), "sk-proj-...");
    if ("YES".equals(answer)) fundsService.hold(event.eventId());
    audit.save(new AuditRow(event.eventId(), answer));
}
```

## 4. Vì sao nó hỏng

Database transaction vẫn mở trong lúc chạy network call không kiểm soát được. Nếu p95 của model là 2 giây, thời gian chờ đó có thể giữ lock và connection 2 giây; retry sẽ nhân tác động. Provider failure biến thành ledger failure, còn socket bị treo có thể làm cạn worker của request hoặc consumer.

Chuỗi `YES` không có ý nghĩa được calibrate, schema validation, confidence policy hay ranh giới human review. Provider update có thể đổi behavior mà không cần code deploy. Secret có thể bị commit hoặc log. Audit gắn với money transaction nên có thể mất khi rollback hoặc không được ghi sau timeout.

Cuối cùng, Kafka redelivery có thể chạy lại `post` và `hold`. Check `exists()` không phải idempotency:

```java
// WRONG: hai consumer có thể cùng thấy false trước khi một bên save.
if (!store.exists(event.eventId())) {
    store.save(record); // race kiểu check-then-act
}
```

## 5. Các bài toán khó

### Storage idempotent không đồng nghĩa side effect idempotent

Với detector record, cần cơ chế uniqueness bền vững. Tùy system of record, có thể dùng unique constraint trên `(event_id, processing_kind)`, atomic insert/upsert, Kafka inbox table, hoặc `SETNX` kèm expiry và outcome bền vững. Outbox có thể stage việc publish một cách atomic cùng ledger commit; idempotency key có thể bảo vệ API command.

Ranh giới đúng phải là atomic, ví dụ:

```sql
-- RIGHT: database phân xử các delivery đồng thời.
INSERT INTO anomaly_results(event_id, model_version, decision, reason)
VALUES (:event_id, :model, :decision, :reason)
ON CONFLICT (event_id, processing_kind) DO NOTHING;
```

Chỉ transaction thắng insert mới tạo result. Nếu lưu ở OpenSearch, deterministic document ID cùng create-only semantics có thể làm document write an toàn khi replay, nhưng không làm cho external `hold` an toàn. Side effect đó cần idempotency key riêng, idempotency do provider hỗ trợ, hoặc transactional command/outbox cùng status machine. Storage idempotency và side-effect idempotency là hai guarantee khác nhau.

### Capacity và backpressure

Detector phải được sizing từ throughput và latency đã đo hoặc giả định rõ:

```text
Concurrency = Throughput x Latency
```

Với 100 event/giây và latency scoring end-to-end 2 giây, cần khoảng 200 worker đang chạy trước khi tính retry, batching và headroom. Pool cố định 4 worker không đáp ứng được tải đó nếu không làm Kafka lag tăng; tăng worker mù quáng lại có thể chạm rate limit và tăng cost. Cần giới hạn concurrency, quota, pause hoặc làm chậm consumption, đồng thời định nghĩa cách xử lý khi lag vượt review SLA.

Kafka là replay source, không phải system of record tài chính. Database vẫn là system of record của ledger. OpenSearch là read model để điều tra và search, có thể rebuild từ event Kafka hoặc dữ liệu suy ra từ database, và không được là authority để posting.

### Version, privacy và policy

Lưu `model_version` và `prompt_version` với mọi signal. Đồng thời lưu `policy_version`, vì thay đổi policy có thể đổi business decision mà không đổi model. Dùng input schema ổn định và validate structured output; output unknown, malformed hoặc confidence thấp phải là outcome chính thức.

Giảm thiểu dữ liệu đi ra ngoài trust boundary: ưu tiên feature đã derive, identifier đã token hóa, amount band và time window tối thiểu. Không gửi full transaction đến external AI một cách tùy tiện. Áp dụng retention, access control, encryption, điều khoản provider và redaction cho PII. Không đưa prompt, account identifier hay secret vào log thông thường.

## 6. Trade-off

- **Scoring đồng bộ** cho signal ngay lập tức nhưng gắn việc cung cấp tiền với latency và availability của provider. Scoring bất đồng bộ thêm lag và cần workflow review/hold.
- **Chỉ dùng rule** rẻ, dễ giải thích và predictable nhưng bỏ sót pattern mới. AI thêm signal hữu ích nhưng đắt hơn và khó reproduce hơn.
- **Fail open** giữ posting khi detector không khả dụng nhưng có thể tăng missed detection. **Fail closed** bảo vệ mạnh hơn nhưng có thể biến thành payment outage. Policy phải chọn rõ theo risk tier; fallback chung chung không phải business decision.
- **OpenSearch overwrite theo event ID** đơn giản cho read model hiện tại. Audit append-only phù hợp hơn với accountability lịch sử và lịch sử correction.

## 7. Thiết kế tốt hơn

Giữ money transaction nhỏ:

```java
// RIGHT: chỉ invariant double-entry nằm trên money path.
@Transactional
public void post(LedgerCommand cmd) {
    ledger.entry(new Entry(cmd.eventId(), DEBIT, cmd.partyId(), cmd.amount()));
    ledger.entry(new Entry(cmd.eventId(), CREDIT, cmd.counterparty(), cmd.amount()));
}
```

Một ranh giới hướng production sẽ dùng outbox nếu cần phối hợp commit với publication:

```text
DB transaction: debit + credit + outbox(event_id)
                         |
                         v
Kafka ledger.events  (replay source)
                         |
                         v
consumer -> bounded AI adapter -> rule fallback -> signal store
                                      |                 |
                                      v                 v
                                  policy service     OpenSearch read model
                                      |
                              review / idempotent side effect
```

Consumer claim `(event_id, processing_kind)` theo cách atomic, sau đó gọi adapter qua domain port nhỏ. Adapter áp deadline, chỉ retry bounded transient failure, mở circuit khi provider không khỏe, rồi trả rule result xác định hoặc `UNKNOWN` khi lỗi. Rate limit và cost budget được kiểm tra trước khi gửi. Dead-letter path giữ poison event để replay sau.

Signal và decision là hai record khác nhau. Audit append-only tối thiểu nên có:

```text
transaction_id, event_id, model_version, prompt_version,
policy_version, decision, reason
```

Ngoài ra nên có signal/provider, timestamp, evidence reference, trạng thái fallback và human override nếu có. Khi audit write thất bại, cần alert và retry qua durable path; không được coi audit bị thiếu là thành công.

## 8. Failure và recovery

Thiết kế phải trả lời failure thay vì che giấu chúng:

- Provider timeout trả `UNKNOWN` hoặc rule-based score sau retry có giới hạn; posting không bị ảnh hưởng và event vẫn audit được.
- Rate-limit response kích hoạt backoff hoặc pause detector, thay vì retry vô hạn và khuếch đại tải.
- Consumer crash sau model call khiến event được redeliver. Unique result claim ngăn duplicate storage; idempotency key hoặc outbox bảo vệ business side effect.
- Response malformed bị reject và ghi nhận, không bị ép thành `YES`.
- OpenSearch downtime khiến read-model sink pause hoặc retry trong khi Kafka giữ event có thể replay. Database vẫn là authority.
- Rollout model hoặc prompt cần canary hoặc shadow, ghi version để policy so sánh outcome và replay input lịch sử.

## 9. Observability

Đo cả business behavior và system health. Prometheus label nên bounded, ví dụ `provider`, `model_version`, `outcome`, `fallback`, `reason_code` và `topic`; tuyệt đối không dùng `transaction_id`, `event_id` hay `account_id` làm label.

Business metrics: signal anomaly rate, review rate, hold rate, mẫu false-positive/false-negative khi có nhãn, và decision latency so với review SLA. System metrics: consumer lag, throughput, in-flight concurrency, scoring latency, timeout/retry count, provider error, rate-limit response, circuit state, cost estimate, duplicate claim, DLQ count và audit/read-model failure.

## 10. Bài học và câu hỏi phỏng vấn

Bài học:

1. Bảo vệ money path trước; AI chỉ là advisory signal.
2. Kafka là transport có replay, database là ledger authority, OpenSearch là read model có thể rebuild.
3. `exists()` rồi `save()` là race; uniqueness và atomic claim mới là guardrail thật.
4. Storage idempotent không làm cho hold, email hay webhook idempotent.
5. Version model, prompt, policy, evidence và decision để audit được.
6. Capacity, privacy, rate limit và failure behavior đều thuộc thiết kế AI.

Câu hỏi phỏng vấn:

- Atomic boundary giữa event claim và result nằm ở đâu?
- Điều gì xảy ra khi provider timeout sau khi đã nhận request?
- Công thức `Concurrency = Throughput x Latency` thay đổi sizing worker và quota thế nào?
- Risk tier nào fail open hoặc fail closed, và ai sở hữu policy đó?
- Sáu tháng sau, reviewer có reproduce được lý do decision mà không phải lộ PII không cần thiết không?
