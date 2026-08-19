---
title: "Từ tài liệu mơ hồ đến quyết định KYC có thể audit"
description: "Thiết kế thực tế để trích xuất trường KYC từ giấy tờ định danh, kiểm tra bằng các rule xác định và chuyển các trường hợp không chắc chắn sang người duyệt."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/identity-service>

## Bài toán

Tiếp nhận tài liệu KYC bắt đầu bằng một ảnh và kết thúc bằng quyết định có hậu quả nghiệp vụ: chấp nhận, từ chối hoặc yêu cầu người duyệt kiểm tra. Nhiệm vụ tưởng như chỉ là “đọc các trường” lại chứa nhiều contract. Ảnh có thể mờ hoặc bị xoay, giấy tờ có nhiều layout, cùng một event có thể đến nhiều lần, nhà cung cấp AI có thể chậm hoặc không khả dụng. Mỗi quyết định cũng cần một lời giải thích có thể đứng vững khi audit.

FinPay là thiết kế tham chiếu, không phải báo cáo về một hệ thống đã triển khai. Một thiết kế hướng production sẽ coi tài liệu là bằng chứng, database là system of record và model là một tín hiệu có thể sai.

## Vì sao khó

Có hai loại không chắc chắn. Không chắc chắn khi extraction hỏi model có đọc đúng `date_of_birth` hay không. Không chắc chắn khi ra quyết định hỏi business nên làm gì nếu thiếu trường, giấy tờ hết hạn hoặc hai kiểm tra mâu thuẫn. Trộn hai câu hỏi vào một prompt khiến cả hai khó test.

Semantics của việc giao message tạo thêm vấn đề. Kafka có thể replay message, consumer có thể crash sau khi commit database, và retry có thể gửi email, gọi screening hoặc tạo review task hai lần. Không thể giả định “handler chỉ chạy một lần”.

## Thiết kế ngây thơ

Một cách triển khai dễ nghĩ là đặt mọi thứ trong request upload:

```java
DocumentResult result = vlm.extract(file);
if (result.confidence() > 0.8) accept(result);
else reject(result);
```

HTTP thread upload file, gọi VLM, hỏi model về fraud, ghi decision rồi trả response. Threshold trở thành policy, model trở thành bên quyết định, còn vòng đời request trở thành workflow engine.

## Vì sao vỡ

Luồng synchronous buộc latency của người dùng phụ thuộc vào latency của provider và khiến timeout trở nên mơ hồ: client có thể retry trong khi lần gọi đầu vẫn đang chạy. Model có thể trả dữ liệu hợp lý nhưng sai, thay đổi sau khi model hoặc prompt được nâng version, hoặc làm cạn rate limit lúc traffic tăng. Một confidence score duy nhất không giải thích được field nào lỗi hay rule xác định nào mâu thuẫn với nó.

Cũng có lỗi duplicate kinh điển:

```java
if (!repository.exists(event.eventId())) { // SAI: hai consumer đều có thể thấy false
    repository.save(event);
}
```

`exists()` và insert là hai thao tác riêng. Dù storage đã idempotent, email hoặc provider call thực hiện trước insert vẫn có thể chạy hai lần.

## Những bài toán khó

Ranh giới hữu ích không phải “có AI hay không”. Đó là signal, policy và decision:

```text
Document -> extraction signal -> policy evaluation -> business decision
             fields + confidence    rules + thresholds    accept/reject/review
```

Extraction nên trả về field có kiểu rõ ràng, confidence theo từng field, metadata provider/model và status cụ thể như `SUCCEEDED`, `PARTIAL` hoặc `UNREADABLE`. Rule xác định nên kiểm tra loại giấy tờ, checksum, hạn sử dụng, field bắt buộc và tính nhất quán. Judge model có thể đánh giá một câu hỏi giới hạn mà rule không trả lời được, nhưng output vẫn chỉ là signal. Policy ánh xạ signal thành `ACCEPT`, `REJECT` hoặc `MANUAL_REVIEW`; policy, không phải model, sở hữu business decision.

Workflow cũng phải định nghĩa identity và hành vi retry. `event_id` định danh một lần giao event, còn `idempotency_key` có thể định danh một lần intake được mong muốn. Transaction ID liên kết mọi attempt với cùng một business case.

## Trade-off

Workflow asynchronous làm tăng phần vận hành và khiến API trả về status thay vì decision ngay. Chi phí đó đổi lấy request latency có giới hạn, retry bền vững và cô lập khỏi outage của provider. Human review làm tăng thời gian hoàn tất và chi phí nhân sự, nhưng an toàn hơn việc âm thầm biến confidence thấp thành reject.

Lưu raw document giúp reprocess và audit tốt hơn, nhưng tăng rủi ro privacy và chi phí lưu trữ. Chỉ lưu field đã chuẩn hóa giúp giảm dữ liệu, nhưng cản trở một số điều tra. Một thiết kế hướng production nên chọn retention period, mã hóa object raw, giới hạn quyền truy cập và ghi lại lý do reprocess.

## Thiết kế tốt hơn

Luồng đề xuất:

```text
Kafka event -> intake worker -> DB transaction -> extraction -> rules -> policy
    replay source       DB = truth                         -> decision + outbox
                                                               -> Kafka -> OpenSearch
                                                                 read model
```

Event chứa `event_id` và object reference như S3 key, không chứa web multipart object. Adapter tạo `IntakeCommand` và `DocumentSnapshot`. Worker tải object, gọi các port như `VisionExtractionPort` và (chỉ khi cần) `LlmJudgePort`, sau đó lưu result cùng outbox event.

Database là system of record cho intake, attempt, decision và các audit fact. Kafka là event source có thể replay cho work và notification. OpenSearch là read model cho tìm kiếm vận hành, không phải nơi lưu decision có tính thẩm quyền.

Cách ghi an toàn với duplicate dùng unique constraint và atomic insert, không dùng pre-check:

```sql
CREATE UNIQUE INDEX one_intake_per_key ON intake(event_id, idempotency_key);

INSERT INTO intake(event_id, idempotency_key, status)
VALUES (:event_id, :key, 'RECEIVED')
ON CONFLICT (event_id, idempotency_key) DO NOTHING;
```

Các cơ chế tương đương gồm Redis `SETNX` kèm expiry, inbox table cho event ID đã consume, hoặc transactional outbox cho fact đã publish. Chọn theo ownership và lifetime của key. Unique insert làm storage idempotent; nó không làm external side effect idempotent. Provider call cần provider hỗ trợ idempotency key nếu có, hoặc durable attempt record cùng reconciliation policy. Outbox publication nên retry từ state đã commit, còn consumer nên dùng inbox hoặc unique event constraint.

Mỗi result phụ thuộc AI phải có `model_version` và `prompt_version`. Mapping nghiệp vụ phải có `policy_version`. Audit record tối thiểu gồm `transaction_id`, `event_id`, `model_version`, `prompt_version`, `policy_version`, `decision`, `reason`, cùng input hash và timestamp. Replay để tái hiện decision cũ phải dùng version đã ghi; re-evaluation có chủ đích tạo attempt mới.

Timeout, retry có giới hạn và jitter, circuit breaker và rate limiter của provider phải bao quanh từng external call. Fallback an toàn không phải “lỗi thì accept”: lưu `AI_UNAVAILABLE` hoặc `EXTRACTION_UNREADABLE` và chuyển sang manual review khi policy cho phép. Dead-letter path phải giữ event và failure reason để kiểm tra.

## Kịch bản lỗi

- Kafka giao duplicate gặp unique inbox constraint và không tạo intake hoặc outbox event thứ hai.
- Worker chết sau khi commit extraction nhưng trước khi publish. Outbox publisher sẽ phát event sau đó.
- Provider timeout. Attempt ghi nhận timeout; retry có giới hạn. Khi hết retry, chuyển review hoặc controlled failure state.
- Provider trả JSON sai schema hoặc field confidence thấp. Schema validation loại response; policy có thể chọn review mà không tự bịa giá trị.
- Kafka replay sau khi release policy. Audit record cũ vẫn immutable; policy version mới là decision mới có chủ ý.
- OpenSearch không khả dụng. Decision vẫn truy vấn được từ database; projection consumer sẽ catch up sau.
- Notification downstream retry. Consumer dùng idempotency key và notification provider nhận stable key nếu được hỗ trợ.

## Capacity

Capacity bắt đầu từ workload đo được, không phải số server. Với arrival rate `λ` và end-to-end latency `W`:

```text
Concurrency = Throughput x Latency = λ x W
```

Ở 20 document/giây và workflow dài 12 giây, có khoảng 240 workflow slot đang chạy trước khi cộng headroom. Nếu VLM chiếm worker trong 3 giây, riêng service gọi model cần khoảng 60 call slot đồng thời ở rate đó, còn phụ thuộc quota provider. Kafka partitions và consumer concurrency phải đủ throughput; database phải chịu write rate và connection limit; object storage phải chịu byte volume và retention; OpenSearch phải chịu indexing và query load. Queue depth, tuổi event lâu nhất, provider rate limit, và retry traffic là tín hiệu capacity. Backpressure nên ngừng nhận work hoặc làm chậm consumer trước khi database hay provider bị quá tải.

## Security/Privacy

Giấy tờ định danh chứa PII và thường có dữ liệu sinh trắc học nhạy cảm. Dùng object reference, URL có scope và thời hạn ngắn, mã hóa khi truyền và khi lưu, authorization chặt, access log và cơ chế retention/deletion. Tối thiểu hóa dữ liệu gửi tới AI bên ngoài: crop hoặc redact vùng không liên quan, chỉ gửi ảnh và câu hỏi cần thiết, không tùy tiện gửi toàn bộ transaction, lịch sử account hay dữ liệu khách hàng không liên quan. Coi prompt và model response là dữ liệu nhạy cảm, ngăn prompt biến thành instruction có thể thực thi và không ghi secret vào log. Human reviewer cần quyền tối thiểu và export policy rõ ràng.

## Observability

System metrics nên gồm intake throughput, queue depth, tuổi event lâu nhất, latency theo stage, provider latency, số timeout/retry/circuit-breaker, rate-limit response, database conflict, outbox lag và OpenSearch indexing lag. AI metrics nên gồm extraction status, phân bố confidence theo field, schema-validation failure, fallback rate, ước tính token/chi phí và model/prompt version trong structured log hoặc dimension có cardinality giới hạn.

Business metrics nên gồm tỷ lệ accept/reject/manual-review, reason, backlog và tuổi review, reprocessing rate, cùng mức bất đồng giữa deterministic check và AI signal. Không dùng `transaction_id`, `account_id`, document number hoặc event ID làm Prometheus label. Đưa các identifier đó vào log bảo mật và trace context, kèm redaction và access control. Trace nên nối intake, provider attempt, database transaction, outbox event và projection nhưng không làm lộ raw document.

## Bài học

- Bắt đầu từ failure và decision contract; chỉ đưa architecture vào để đáp ứng chúng.
- Coi output AI là signal có kiểu và có version. Policy sở hữu business decision.
- Dùng atomic uniqueness, inbox/outbox và provider idempotency riêng biệt vì storage và side effect có cách fail khác nhau.
- Giữ Kafka là replay source, database là system of record và OpenSearch là read model có thể rebuild.
- Capacity, privacy, auditability và observability là một phần của correctness trong KYC, không phải việc trang trí sau production.
