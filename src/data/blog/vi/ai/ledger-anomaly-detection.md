---
title: "Thiết kế phát hiện bất thường trong ledger với Kafka và Prometheus"
description: "Thiết kế có guardrail để chấm điểm sự kiện ledger bất đồng bộ mà không đưa AI vào luồng xử lý tiền."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> **Repository:** https://github.com/finpay-lab/ledger-service

## Bài Toán Bắt Đầu Sau Khi Ghi Sổ

FinPay đã có luồng payment với một bất biến cứng: một payment đã ghi sổ tạo ra cặp debit và credit double-entry cân bằng trong cùng một giao dịch cơ sở dữ liệu. Database của ledger là nguồn sự thật cho việc di chuyển tiền. Luồng này được cố ý giữ nhỏ: xác thực command, ghi các entry, rồi trả về kết quả để state machine của payment xử lý.

Vấn đề tiếp theo xuất hiện sau khi ghi sổ. Một payment có thể hợp lệ theo quy tắc tài khoản nhưng vẫn giống một mẫu bất thường: beneficiary mới nhận nhiều payment lớn trong vài phút, hoặc một tài khoản vốn ít hoạt động đột nhiên thanh toán từ khu vực mới. Doanh nghiệp muốn có tín hiệu này trước kỳ reconciliation và batch review lúc 2 giờ sáng, nhưng không muốn câu trả lời của model trở thành thao tác thay đổi số dư.

**[SOURCE FACT]** Mô tả repository được cung cấp xác định `ledger-service` là một Spring Boot service. Service ghi mỗi payment thành cặp `debit`/`credit` double-entry trong một giao dịch cơ sở dữ liệu, publish ledger event lên Kafka tại `ledger.events`, và cho phép tìm kiếm event trong OpenSearch. FinPay là bối cảnh hư cấu ở đây; flow production-oriented bên dưới là một đề xuất thiết kế, không phải khẳng định về một hệ thống đã triển khai.

Contract này cố ý không đối xứng:

```text
ledger event -> AI signal -> deterministic policy -> business decision
                                      |
                                      v
                            review / risk-tier action
                                      |
                                      v
                              ledger / settlement
```

Model có thể báo `SUSPICIOUS`, `NORMAL`, hoặc `UNKNOWN`, kèm evidence và score. Model không được gọi `hold`, reject payment, ghi ledger entry, đổi balance, hay settlement funds. Policy sở hữu việc ánh xạ sang `ALLOW`, `REVIEW`, hoặc `HOLD`, còn state machine xác định mọi financial transition.

## Thiết Kế Hiển Nhiên

Thiết kế đầu tiên rất dễ giải thích: ghi payment, gọi AI provider, rồi hold payment nếu câu trả lời có vẻ rủi ro.

```java
// WRONG: AI is synchronous, decides money, and uses a hardcoded secret.
@Transactional
public void postLedger(PaymentEvent event) {
    ledger.post(debit(event), credit(event));
    String answer = openAi.ask(prompt(event), "sk-proj-...");
    if ("YES".equals(answer)) fundsService.hold(event.eventId());
    audit.save(new AuditRow(event.eventId(), answer));
}
```

Thiết kế này có vẻ hợp lý cho đến khi lần theo một request qua provider chậm. Giao dịch cơ sở dữ liệu vẫn mở trong lúc chờ network call không kiểm soát được. Nếu lấy latency model 2 giây làm **giả định thiết kế**, một payment có thể giữ connection và lock của database trong khoảng thời gian đó. Với 10.000 payment mỗi giây, một stage đồng bộ có latency 200 ms tạo khoảng `10,000 x 0.2 = 2,000` request đang in-flight, chưa tính retry và headroom. Ở 2 giây, con số là khoảng 20.000. Đây là phép tính capacity, không phải số đo của FinPay, nhưng nó cho thấy vì sao latency của provider không nên nằm trên money path.

Failure lan truyền theo chuỗi. Trong một kịch bản giả định lúc 14:03, latency provider tăng từ 300 ms lên 4 giây. Request worker phải chờ, connection pool đầy, rồi gateway timeout bắt đầu xuất hiện. Retry tiếp tục gửi thêm call trong khi provider đã chậm. Nếu payment consumer retry sau timeout, cùng một post hoặc hold có thể bị gọi lại. Câu trả lời `YES` của provider cũng không phải contract ổn định: output có thể sai schema, nondeterministic, hoặc thay đổi sau khi prompt/model rollout. Ngay cả signal đúng cũng không có quyền thay đổi trạng thái tài chính.

Audit write cũng có vấn đề. Nếu dùng chung transaction với money transaction, rollback có thể xóa bằng chứng về lần phân tích đã được thử. Nếu ghi sau remote timeout, thao tác này có thể không bao giờ chạy. Secret trong ví dụ còn có thể lộ qua source control, log, hoặc exception message.

## Các Ràng Buộc Không Thể Thỏa Hiệp

Với reference design này, các ràng buộc là:

- Ledger database vẫn là authority cho tiền đã ghi sổ. Cân bằng double-entry và settlement xác định không được phụ thuộc vào khả dụng của AI.
- Scoring có thể bị trễ, bị lặp, hoặc không khả dụng. Hệ thống phải giữ input có thể replay và outcome có audit.
- AI output là untrusted input. Output cần schema, version, deadline có giới hạn, và kết quả `UNKNOWN` rõ ràng.
- Giới hạn provider và chi phí là hữu hạn. Concurrency không thể tăng chỉ vì Kafka còn nhiều event.
- Payment data có thể chứa PII và thông tin counterparty nhạy cảm. Chỉ gửi dữ liệu tối thiểu cần thiết qua biên provider.
- Review workflow cần SLA rõ ràng. “Bất đồng bộ” không có nghĩa là “để lúc nào xong cũng được”.

Đây là assumption và design constraint, không phải production measurement. Các giới hạn phù hợp phải được lấy từ load test, contract của provider, và risk model của doanh nghiệp.

## Chọn Ranh Giới

Scoring đồng bộ cho signal ngay lập tức. Điều đó hữu ích với một thao tác rủi ro cao cần quyết định trước authorization, nhưng nó gắn authorization với latency và availability của provider. Với payment đã post thông thường, ranh giới an toàn hơn là review bất đồng bộ: post trước, score sau, rồi để policy quyết định có cần transition tiếp theo hay không. Có thể có risk check trước authorization cho một risk tier cụ thể, nhưng đó phải là workflow có deadline và degraded mode rõ ràng, không phải LLM call không giới hạn nằm trong posting.

Rules-only detection rẻ, dễ giải thích, và lặp lại được. Nó bỏ sót những pattern khó liệt kê. AI có thể thêm advisory signal hữu ích, nhưng false positive tạo chi phí review còn false negative làm bỏ sót investigation. Vì vậy policy phải dùng được rules, AI, hoặc cả hai, và phải phân biệt `UNKNOWN` với `NORMAL`.

Khi scoring không khả dụng, không có đáp án fail-open chung cho mọi payment. Payment rủi ro thấp có thể post rồi vào delayed review. Payment rủi ro cao có thể cần step-up verification hoặc manual review. Block mọi payment khi provider outage sẽ biến dependency tư vấn thành payment outage; allow mọi payment rủi ro cao có thể chấp nhận exposure quá lớn. Risk owner, không phải model, chọn fail-open, fail-closed, hay step-up theo từng risk tier.

Kafka phù hợp vì event có thể replay, còn HTTP trực tiếp từ ledger tới detector sẽ đưa availability của detector vào posting. At-most-once tránh duplicate work nhưng có thể làm mất event. At-least-once giữ input nhưng bắt buộc idempotency. Ta chọn xử lý at-least-once có thể replay vì bỏ sót anomaly khó điều tra hơn duplicate delivery, với điều kiện side effect được bảo vệ riêng.

## Các Vấn Đề Mới Do Quyết Định Tạo Ra

Xử lý async loại latency của provider khỏi posting, nhưng tạo duplicate delivery. Consumer có thể gọi provider, crash trước khi ghi result, rồi nhận lại cùng event. `exists()` rồi `save()` không giải quyết được: hai consumer có thể cùng quan sát trạng thái chưa tồn tại.

```sql
-- The database arbitrates concurrent deliveries.
INSERT INTO anomaly_results(event_id, processing_kind, result_status,
                            model_version, decision, reason_code)
VALUES (:event_id, :kind, 'COMPLETE', :model, :decision, :reason)
ON CONFLICT (event_id, processing_kind) DO NOTHING;
```

Unique key làm việc lưu result trở nên idempotent. Nó không làm cho `hold`, notification, hoặc webhook bên ngoài trở nên idempotent. Các side effect đó cần provider idempotency key, durable command/outbox, hoặc state machine chỉ nhận một transition cho một command key xác định. Idempotency của storage và idempotency của side effect là hai guarantee khác nhau.

Retry xử lý transient failure, rồi có thể tạo retry storm. Adapter chỉ retry lỗi transient đã phân loại, với deadline, exponential backoff, jitter, và retry budget. Circuit breaker ngăn call khi provider rõ ràng đang không khỏe. Worker pool có giới hạn và quota của provider biến backpressure thành queue được kiểm soát thay vì work in-flight không giới hạn. Nếu lag vượt review SLA, hệ thống phải alert, giảm intake hoặc sampling theo policy, và hiển thị tuổi của payment chưa được xử lý lâu nhất.

Cache có thể giảm chi phí, nhưng signal trong cache sẽ cũ khi hành vi account hoặc model thay đổi. Nếu dùng cache, chỉ cache feature dẫn xuất, không phải authority, với TTL và model/prompt version; không bao giờ coi cache là ledger state. OpenSearch giúp investigation nhanh, nhưng là read model. OpenSearch outage chỉ nên làm chậm việc tìm kiếm, không được quyết định tiền có tồn tại hay không. Kafka là replay source của detector; ledger database vẫn là financial record.

## Guardrail Cho AI

Adapter nhận stable feature schema thay vì payment payload tùy ý. Adapter redact hoặc tokenize identifier, chỉ gửi time window và amount feature cần thiết, đồng thời giữ secret ngoài prompt và log. Authentication và authorization giới hạn tenant hoặc service nào được gửi scoring request. Rate limit theo tenant ngăn một khách hàng dùng hết budget chung.

Response phải có cấu trúc và được validate. Unknown field có thể được bỏ qua hoặc reject theo schema; field bắt buộc bị thiếu, range sai, nội dung prompt injection, và output không parse được đều trở thành `UNKNOWN`, không phải `YES` ngẫu nhiên. Prompt là data, không phải instruction channel từ customer. Model version, prompt version, input feature reference, provider, timestamp, và fallback status phải nằm trong audit record. Retention và access control phải ngăn investigator nhìn thấy nhiều PII hơn mức case cần.

Model update có thể thay đổi decision mà không cần code deployment. Shadow hoặc canary evaluation trên labeled sample có thể phát hiện drift, thay đổi false-positive, và thay đổi chi phí trước khi policy sử dụng signal mới. Historical replay phải ghi version đã dùng; “chạy lại” không tạo reproducibility nếu provider đã thay đổi.

## Thiết Kế Có Giới Hạn

Chỉ sau các quyết định trên, architecture mới trở nên hữu ích:

```text
                 PAYMENT CORE
command -> DB transaction: debit + credit + outbox(event_id)
                                      |
                                      v
                              Kafka ledger.events
                                      |
                    replayable, at-least-once transport
                                      |
                                      v
                 AI LAYER: bounded consumer and AI adapter
                 claim -> validate -> score -> record signal
                                      |
                         deterministic policy + version
                                      |
                         ALLOW / REVIEW / HOLD command
                                      |
                                      v
                 PAYMENT CORE: idempotent state transition

                 OpenSearch: rebuildable investigation read model
                 Prometheus: bounded operational and business metrics
```

Outbox chỉ xuất hiện nếu cần phối hợp publication với ledger commit; nếu không, publish thất bại có thể khiến payment đã commit nhưng detector không có input. Consumer atomically claim `(event_id, processing_kind)` trong durable storage, gọi domain port cho provider, và ghi signal tách biệt với policy decision. Policy service không phải AI wrapper. Đây là code deterministic sở hữu threshold, risk tier, degraded-mode behavior, và yêu cầu human approval.

Payment transaction vẫn nhỏ và đồng bộ:

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

Nếu policy yêu cầu hold, nó phát idempotent command tới payment state machine. Command đó có thể chuyển payment sang `REVIEW` hoặc `HOLD` theo deterministic rule. Nó không bao giờ sửa balance trực tiếp. Double-entry post và settlement state vẫn là nguồn sự thật.

## Một Failure Có Thể Vận Hành

Hãy xem provider slowdown lúc 14:03 như một bài tập thiết kế, không phải production claim của FinPay. Deadline của adapter hết hạn ở 4 giây, retry budget nhỏ đã dùng hết, và circuit mở. Consumer ghi `UNKNOWN` cùng fallback status, commit claim/result, rồi ngừng gọi provider. Kafka lag tăng, nhưng gateway latency và ledger connection vẫn bình thường vì posting độc lập. Policy áp dụng rule theo risk tier: payment rủi ro thấp vào delayed review, còn tier rủi ro cao đã cấu hình có thể yêu cầu step-up hoặc manual review. Khi provider hồi phục, replay xử lý các event còn giữ; unique claim ngăn duplicate signal record.

Nếu consumer crash sau khi provider đã nhận request nhưng trước result insert, redelivery là điều được dự kiến. Request tới provider phải mang idempotency key nếu request có side effect; pure inference call vẫn cần bảo vệ duplicate result. Nếu result store down, event ở trạng thái retryable hoặc vào DLQ sau chính sách attempt có giới hạn. DLQ không phải nơi xóa dữ liệu: cần owner, reason, alert, và quy trình replay.

Với 100 event mỗi giây và scoring latency giả định 2 giây, stage có khoảng 200 call in-flight. Đặt concurrency limit thấp hơn quota provider, dành capacity cho retry, và đo queue age thay vì chỉ đo consumer throughput. Thêm worker có thể giảm lag cho đến khi cạn quota provider, CPU, socket, hoặc database connection. Capacity planning vì vậy là bài toán giải các ràng buộc, không phải “thêm consumer đến khi biểu đồ xanh”.

## On-Call Cần Gì Lúc 3 Giờ Sáng

Prometheus nên expose scoring latency, timeout và provider-error rate, rate-limit response, circuit state, work in-flight, consumer lag, tuổi event lớn nhất, retry count, duplicate-claim rate, DLQ count, audit failure, và read-model failure. Business metric gồm signal rate, `REVIEW` và `HOLD` rate, fallback/unknown rate, cùng các mẫu false-positive và false-negative được gắn nhãn về sau. Label phải có miền hữu hạn: dùng provider, model version, outcome, fallback, reason code, và topic. Không dùng `payment_id`, `event_id`, `account_id`, hoặc `trace_id` làm Prometheus label.

Tracing nên nối request/payment ID với ledger event, consumer attempt, AI inference ID, model và prompt version, policy version, và state-machine command. Log phải trả lời evidence nào được dùng, rule nào được kích hoạt, có human override hay không, và từng transition xảy ra lúc nào, nhưng không ghi PII thô hoặc prompt vào log thông thường. Audit storage nên append-only hoặc giữ correction history; một OpenSearch document có thể hiển thị investigation view hiện tại nhưng không thay thế lịch sử.

Alert phải dẫn đến một hành động: pause hoặc shed detector intake, chuyển sang fallback đã cấu hình, page provider owner, replay một phạm vi DLQ, hoặc điều tra policy spike. Runbook phải nói rõ payment nào đã post trong degraded mode và phục hồi review SLA của chúng ra sao.

## Bài Học

1. Money transaction giữ nhỏ và đồng bộ; anomaly scoring là bất đồng bộ và mang tính tư vấn.
2. AI tạo signal. Deterministic policy và payment state machine sở hữu decision và financial side effect.
3. Ledger database là authority, Kafka là replayable transport, còn OpenSearch là read model có thể rebuild.
4. At-least-once chỉ chấp nhận được khi result storage và mọi side effect có idempotency boundary riêng.
5. Provider timeout, quota, model change, giới hạn privacy, và cost budget là input thiết kế bình thường, không phải việc dọn dẹp sau cùng.
6. Fail-open, fail-closed, step-up, và manual review là quyết định của risk owner theo tier. Không có một chính sách outage AI dùng cho mọi trường hợp.

Insight bền vững rất đơn giản: thêm AI vào hệ thống tài chính không nên làm phình money path. AI chỉ thêm một nguồn evidence có giới hạn và có thể replay quanh một ledger deterministic, nơi các invariant vẫn đúng dù model chậm, sai, thay đổi, hay không khả dụng.
