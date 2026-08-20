---
title: "Thiết kế phát hiện bất thường trong ledger với Kafka và Prometheus"
description: "Thiết kế có guardrail để chấm điểm sự kiện ledger bất đồng bộ mà không đưa AI vào luồng xử lý tiền."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> **Repository:** https://github.com/finpay-lab/ledger-service

## Sự Cố Cần Ngăn Chặn

FinPay đã có payment core. Invariant quan trọng là: payment được ghi sổ tạo ra debit và credit cân bằng trong cùng một database transaction. Database của ledger là nguồn sự thật cho tiền. Invariant này có trước khi AI xuất hiện trong thiết kế.

Hãy xét một lần review của đội vận hành. Một beneficiary mới nhận nhiều payment có giá trị bất thường trong vài phút. Quy tắc account vẫn cho phép từng payment nên việc ghi sổ thành công. Signal này hữu ích, nhưng sẽ đến quá muộn nếu đội ngũ chỉ thấy nó trong batch review lúc 2 giờ sáng. Đồng thời, không thể cho model sửa balance hay settlement chỉ vì nó cho rằng payment đáng ngờ.

Bài toán thiết kế không phải là “làm ledger thông minh hơn”. Bài toán hẹp hơn: làm sao thêm một signal kịp thời, có audit, mà không đưa một dependency không đáng tin vào financial transaction?

Trong bài này, mô tả repository là source fact: `ledger-service` được mô tả là Spring Boot service ghi payment thành cặp `debit`/`credit` double-entry trong một database transaction, publish ledger event lên Kafka tại `ledger.events`, và cho phép tìm kiếm event trong OpenSearch. FinPay là bối cảnh hư cấu; flow production-oriented bên dưới là thiết kế đề xuất, không phải khẳng định về behavior đã triển khai.

Ranh giới cần có cố ý không đối xứng:

```text
ledger event -> AI signal -> deterministic policy -> business state transition
                                      |
                                      v
                              REVIEW / HOLD command
                                      |
                                      v
                               ledger / settlement
```

AI có thể trả về `SUSPICIOUS`, `NORMAL`, hoặc `UNKNOWN`, kèm evidence có giới hạn và score. AI không được gọi `hold`, reject payment, ghi ledger entry, đổi balance, hay settlement funds. Policy quyết định signal có nghĩa gì, còn payment state machine quyết định transition nào hợp lệ.

## Thiết Kế Hiển Nhiên Hỏng Ở Money Path

Implementation đầu tiên hấp dẫn vì cho câu trả lời ngay lập tức:

```java
// WRONG: provider latency and an untrusted answer control money.
@Transactional
public void postLedger(PaymentEvent event) {
    ledger.post(debit(event), credit(event));
    String answer = openAi.ask(prompt(event), "sk-proj-...");
    if ("YES".equals(answer)) fundsService.hold(event.eventId());
    audit.save(new AuditRow(event.eventId(), answer));
}
```

Đoạn code trộn bốn trách nhiệm: ghi tiền, gọi provider từ xa, diễn giải output tự do, và tạo financial side effect. Failure mode không mang tính lý thuyết. Nếu latency provider 2 giây là **giả định thiết kế**, database transaction có thể giữ connection và lock trong lúc chờ. Với 10.000 payment mỗi giây là **giả định minh họa**, 200 ms xử lý đồng bộ tạo khoảng `10,000 x 0.2 = 2,000` call in-flight. Ở 2 giây là khoảng 20.000, chưa tính retry và headroom. Đây là ví dụ capacity, không phải số đo của FinPay.

Tiếp tục lần theo một slowdown. Trong incident giả định lúc 14:03, latency provider tăng từ 300 ms lên 4 giây. Request worker phải chờ. Connection pool đầy. Gateway timeout tạo retry, còn retry lại làm provider quá tải hơn. Timeout có thể khiến caller không biết request đã hoàn thành chưa, vì vậy payment hoặc hold bị gọi lặp. Trong khi đó, `YES` không phải contract bền vững: output có thể sai schema, nondeterministic, hoặc khác đi sau khi prompt hay model version thay đổi.

Audit write thất bại theo hai hướng. Nếu dùng chung ledger transaction, rollback có thể xóa bằng chứng việc scoring đã được thử. Nếu ghi sau remote call, timeout hoặc process crash có thể khiến nó không chạy. Secret hardcode còn tạo ra security failure có thể tránh được: source control, log, hoặc exception text có thể làm lộ secret.

Bài học từ thiết kế ngây thơ không chỉ là “dùng Kafka”. Đó là money transaction không được chờ, diễn giải, hay tin một AI response.

## Ràng Buộc Trước Khi Chọn Component

Reference design có các ràng buộc rõ ràng:

- Ledger database vẫn là authority cho tiền đã ghi sổ. Cân bằng double-entry và settlement xác định không phụ thuộc vào AI availability.
- Scoring có thể trễ, lặp, hoặc không khả dụng. Input và outcome cần durable audit và replay.
- AI output là untrusted input. Output cần schema, version, deadline có giới hạn, và cách xử lý `UNKNOWN` rõ ràng.
- Provider quota, concurrency, và cost là hữu hạn. Queue depth không thể biện minh cho số call không giới hạn.
- Payment data có thể chứa PII và dữ liệu counterparty nhạy cảm. Provider chỉ nhận feature set tối thiểu hữu ích.
- Review có SLA. “Async” không thể có nghĩa là “xong lúc nào cũng được”.

Đây là constraint được đề xuất, không phải production measurement. Limit phải đến từ load test, provider contract, và business risk model.

## Quyết Định Về Ranh Giới

Có ba lựa chọn hợp lý.

**Synchronous scoring** cho signal ngay lập tức, nhưng gắn authorization với provider latency và availability. Nó có thể phù hợp với một pre-authorization check cho risk tier cụ thể, nếu deadline và degraded behavior được quy định rõ. Đây không phải default tốt cho payment đã post.

**Rules-only** rẻ hơn, lặp lại được, và dễ giải thích. Nhưng rules bỏ sót pattern khó liệt kê. AI có thể thêm evidence, nhưng false positive tạo chi phí review còn false negative làm bỏ sót investigation.

**Asynchronous scoring** giữ posting độc lập. Payment post, event được giữ lại, bounded worker chấm điểm, rồi deterministic policy có thể phát command tiếp theo tới state machine. Payment rủi ro thấp có thể vào delayed review khi outage; risk tier cao đã cấu hình có thể cần step-up verification hoặc manual review. Không có câu trả lời fail-open chung.

Ta chọn xử lý asynchronous, at-least-once cho payment thông thường đã post. Kafka hữu ích vì event có thể được giữ và replay; HTTP trực tiếp từ ledger tới detector sẽ đưa availability của detector vào posting. At-most-once giảm duplicate work nhưng có thể mất input. At-least-once giữ input và chuyển complexity sang idempotency. Với anomaly investigation, trade-off này chỉ chấp nhận được nếu storage và financial side effect có idempotency boundary riêng.

## Failure Mới: Async Tạo Duplicate

Loại provider latency khỏi posting không có nghĩa là loại bỏ failure. Consumer có thể gọi provider, crash trước khi ghi result, rồi nhận lại cùng event. `exists()` rồi `save()` không an toàn vì hai consumer có thể cùng thấy record chưa tồn tại.

```sql
-- The database arbitrates concurrent deliveries.
INSERT INTO anomaly_results(event_id, processing_kind, result_status,
                            model_version, decision, reason_code)
VALUES (:event_id, :kind, 'COMPLETE', :model, :decision, :reason)
ON CONFLICT (event_id, processing_kind) DO NOTHING;
```

Unique key làm result storage idempotent. Nó không làm cho hold, notification, hay webhook idempotent. Các side effect đó cần provider idempotency key, durable command/outbox, hoặc state machine chỉ nhận một transition cho deterministic command key. Idempotency của storage và idempotency của side effect là hai guarantee khác nhau.

Retry lại tạo một bẫy khác. Chỉ retry transient error đã phân loại, với deadline, exponential backoff, jitter, và retry budget. Circuit breaker ngừng call khi provider rõ ràng không khỏe. Worker pool có giới hạn và concurrency limit biến backpressure (áp lực ngược) thành queue được kiểm soát thay vì work in-flight không giới hạn. Nếu event lâu nhất vượt review SLA, phải alert và áp dụng intake, sampling, hoặc fallback policy rõ ràng.

Cache có thể giảm cost, nhưng cached signal sẽ cũ khi hành vi account hoặc model version thay đổi. Nếu dùng, chỉ cache feature dẫn xuất với TTL và version key; không dùng cache làm ledger state. OpenSearch có thể làm investigation nhanh hơn, nhưng là read model có thể rebuild. OpenSearch outage có thể làm chậm việc tìm kiếm, không được quyết định tiền có tồn tại hay không.

## AI Là Untrusted Adapter

Adapter nên nhận stable feature schema, không nhận payment payload tùy ý. Redact hoặc tokenize identifier, chỉ gửi time window và amount feature cần thiết, đồng thời giữ secret ngoài prompt và log. Authentication, authorization, và rate limit theo tenant bảo vệ provider budget dùng chung.

Response phải có cấu trúc và được validate. Field thiếu, range sai, nội dung prompt injection, và output không parse được đều trở thành `UNKNOWN`, không bao giờ tự nhiên thành `YES`. Model và prompt version, input-feature reference, provider, timestamp, và fallback status phải nằm trong audit record. Retention và access control nên giới hạn investigator ở lượng PII cần cho case.

Model update có thể thay đổi signal mà không có code deployment. Shadow hoặc canary evaluation trên labeled sample có thể cho thấy drift, thay đổi false-positive, và thay đổi cost trước khi policy dùng version mới. Replay phải ghi version đã dùng; chạy lại với provider đã thay đổi không phải reproducibility.

## Architecture Sau Khi Đã Suy Luận

Chỉ lúc này các component mới có lý do tồn tại:

```text
                 PAYMENT CORE
command -> DB transaction: debit + credit + outbox(event_id)
                                      |
                                      v
                              Kafka ledger.events
                    retained, replayable, at-least-once
                                      |
                                      v
                 AI LAYER: bounded consumer and adapter
                 claim -> validate -> score -> record signal
                                      |
                         deterministic policy + version
                                      |
                         REVIEW / HOLD command
                                      |
                                      v
                 PAYMENT CORE: idempotent state transition

                 OpenSearch: rebuildable investigation view
                 Prometheus: bounded operational and business metrics
```

Outbox chỉ cần khi publication phải được phối hợp với ledger commit; nếu không, publish failure có thể để lại payment đã commit nhưng detector không có input. Consumer atomically claim `(event_id, processing_kind)` trong durable storage, gọi provider qua domain port, và ghi signal tách biệt khỏi policy decision. Policy sở hữu threshold, risk tier, degraded mode, và yêu cầu human approval. Đây là deterministic code, không phải AI wrapper.

Synchronous transaction vẫn nhỏ:

```java
// RIGHT: only the double-entry invariant is on the money path.
@Transactional
public void post(LedgerCommand command) {
    ledger.entry(new Entry(command.eventId(), DEBIT,
                           command.payerId(), command.amount()));
    ledger.entry(new Entry(command.eventId(), CREDIT,
                           command.payeeId(), command.amount()));
}
```

Nếu policy yêu cầu hold, nó phát idempotent command tới payment state machine. Command có thể chuyển payment sang `REVIEW` hoặc `HOLD` theo deterministic rule. Nó không bao giờ sửa balance trực tiếp. Ledger và settlement state vẫn là authority.

## Một Failure Có Thể Vận Hành

Dùng slowdown lúc 14:03 như bài tập thiết kế, không phải production claim của FinPay. Adapter hết deadline ở 4 giây, retry budget nhỏ đã dùng hết, và circuit mở. Consumer ghi `UNKNOWN` cùng fallback status, commit claim/result, rồi ngừng gọi provider. Kafka lag tăng, nhưng gateway latency và ledger connection vẫn bình thường vì posting độc lập. Policy áp dụng behavior theo risk tier đã cấu hình. Khi provider hồi phục, replay xử lý event được giữ lại; unique claim ngăn duplicate result record.

Nếu consumer crash sau khi provider đã nhận request nhưng trước result insert, redelivery là điều được dự kiến. Request có side effect cần idempotency key; pure inference call vẫn cần bảo vệ duplicate result. Nếu result store không khả dụng, event ở trạng thái retryable hoặc chuyển vào DLQ sau attempt policy có giới hạn. DLQ không phải nơi xóa dữ liệu: cần owner, reason, alert, và quy trình replay.

Với 100 event mỗi giây và scoring latency **giả định minh họa** 2 giây, stage có khoảng 200 call in-flight. Đặt concurrency thấp hơn provider quota, dành capacity cho retry, và đo queue age thay vì chỉ throughput. Thêm worker có ích cho đến khi provider quota, CPU, socket, hoặc database connection trở thành giới hạn tiếp theo. Capacity planning là giải bài toán ràng buộc, không phải thêm consumer đến khi biểu đồ xanh.

## On-Call Cần Gì

Prometheus nên expose scoring latency, timeout và provider-error rate, rate-limit response, circuit state, work in-flight, consumer lag, tuổi event lớn nhất, retry count, duplicate-claim rate, DLQ count, audit failure, và read-model failure. Business metric gồm signal, `REVIEW`, `HOLD`, và fallback/unknown rate, cùng các mẫu false-positive và false-negative được gắn nhãn về sau. Giữ label có miền hữu hạn: provider, model version, outcome, fallback, reason code, và topic. Không dùng `payment_id`, `event_id`, `account_id`, hoặc `trace_id` làm label.

Tracing nên nối payment/request ID, ledger event, consumer attempt, inference ID, model và prompt version, policy version, và state-machine command. Log phải trả lời evidence nào được dùng, rule nào kích hoạt, có human override hay không, và từng transition xảy ra lúc nào, nhưng không ghi raw PII hoặc prompt trong log thông thường. Audit storage nên giữ lịch sử append-only hoặc correction; OpenSearch document không thể thay thế lịch sử đó.

Mỗi alert phải dẫn đến một hành động: pause hoặc shed detector intake, chuyển sang fallback đã cấu hình, page provider owner, replay một phạm vi DLQ, hoặc điều tra policy spike. Runbook phải xác định payment nào đã post trong degraded mode và cách phục hồi review SLA của chúng.

## Bài Học

1. Money transaction giữ nhỏ và đồng bộ; anomaly scoring là bất đồng bộ và mang tính tư vấn.
2. AI tạo signal. Deterministic policy và payment state machine sở hữu decision và financial side effect.
3. Ledger database là authority, Kafka là replayable transport, còn OpenSearch là read model có thể rebuild.
4. At-least-once chỉ chấp nhận được khi result storage và mọi side effect có idempotency boundary riêng.
5. Provider timeout, quota, model change, giới hạn privacy, và cost budget là input thiết kế, không phải việc dọn dẹp sau cùng.
6. Fail-open, fail-closed, step-up, và manual review là quyết định của risk owner theo tier. Không có một chính sách AI outage dùng cho mọi trường hợp.

Insight bền vững là AI chỉ nên thêm một nguồn evidence có giới hạn và có thể replay quanh một ledger deterministic. Nó không được làm phình money path. Các financial invariant phải vẫn đúng khi model chậm, sai, thay đổi, hoặc không khả dụng.
