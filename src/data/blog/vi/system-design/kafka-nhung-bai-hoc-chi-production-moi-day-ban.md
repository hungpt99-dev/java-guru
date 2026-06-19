---
title: "Kafka: Những bài học chỉ Production mới dạy bạn"
description: "Không có tutorial Kafka nào chuẩn bị cho bạn cảm giác 2 giờ sáng bị gọi dậy vì consumer lag tăng không kiểm soát. Bài viết ghi lại những bài học xương máu về Kafka trong production."
pubDatetime: 2026-01-24T07:31:00+07:00
featured: true
draft: false
tags:
  - kafka
  - system-design
  - microservices
---

Không có tutorial Kafka nào chuẩn bị cho bạn cảm giác 2 giờ sáng bị gọi dậy vì consumer lag tăng không kiểm soát. Bạn mở Grafana, thấy offset đứng im như tượng đồng. Bạn restart pod - lag tụt một chút rồi lại bám chặt. Bạn scale thêm consumer - năm phút sau, cả group rebalance liên tục, throughput rơi về 0. Cả hệ thống chết lâm sàng vì một vài message lỗi.

Kafka trên slide lúc nào cũng sạch sẽ hoàn hảo: at-least-once, offset, partition, consumer group, retry. Mọi ví dụ đều gọn gàng, mọi flow đều "happy path", mọi lỗi đều được xử lý trong 3 dòng code.

Kafka trong production thì khác. Nó không quan tâm bạn đọc documentation kỹ đến đâu. Nó chỉ quan tâm bạn commit offset sai chỗ nào, block poll thread bao lâu, và retry thiếu kiểm soát ra sao. Nó là chiến trường nơi lý thuyết gặp thực tế, nơi "it works on my machine" bị đập tan thành từng mảnh.

Bài này không dạy bạn Kafka API - đã có hàng trăm tutorial làm việc đó. Bài này ghi lại những bài học xương máu chỉ có được sau vài incident thật sự, khi dữ liệu bị duplicate vô tội vạ, message biến mất không dấu vết, và cả hệ thống đứng hình chỉ vì một message tưởng chừng rất nhỏ.

## 1. Một message lỗi có thể làm nghẽn cả hệ thống

Hầu hết tutorial đều dạy bạn viết consumer handler theo một công thức rất đẹp mắt: deserialize message, gọi service xử lý business, nếu lỗi thì throw exception. Code nhìn gọn gàng, chạy local mượt mà, QA test cũng không phát hiện vấn đề gì.

Production sẽ tặng bạn một bài học đắt giá: chỉ cần một message có payload "bẩn" — JSON sai schema, field null bất ngờ, enum value không map được — handler của bạn throw exception. Spring Kafka retry message đó (nếu được cấu hình). Handler lại throw. Vòng lặp này tiếp tục cho đến khi... bạn phải can thiệp thủ công.

**Phân biệt lỗi là kỹ năng sống còn:**

- **Lỗi permanent (không thể retry):** Lỗi parse JSON, schema violation, validation error, business logic error. Retry 1.000 lần cũng không làm JSON đó hợp lệ hơn. Đây là những lỗi cần được xử lý ngay và đưa vào Dead Letter Queue.
- **Lỗi transient (có thể retry):** Lỗi mạng tạm thời, database connection timeout, deadlock ngắn, service dependency tạm thời unavailable. Có khả năng thành công sau một số lần retry có kiểm soát.

**Lưu ý quan trọng:** Kafka core không có cơ chế retry. Retry là do client libraries như Spring Kafka cung cấp thông qua cơ chế `DefaultErrorHandler` với `RetryTemplate`. Nếu không cấu hình đúng, exception sẽ làm consumer loop bị block.

**Schema Registry là lá chắn đầu tiên:** Sử dụng Schema Registry với compatibility mode STRONG sẽ bắt lỗi schema ngay từ producer side. Message không hợp lệ sẽ bị reject trước khi vào topic, không bao giờ đến được consumer của bạn.

## 2. Rebalance có thể phá nát throughput

Rebalance là cơ chế Kafka phân phối lại partition cho các consumer khi có sự thay đổi trong group. Trong production, rebalance xảy ra thường xuyên hơn bạn nghĩ: deploy mới, pod restart, network blip nhẹ, consumer chậm xử lý.

**Sai lầm chết người:** Bạn block xử lý message quá lâu trong poll thread, vượt quá `max.poll.interval.ms` (thường là 5 phút). Broker không thấy heartbeat, nghĩ consumer "chết", kick khỏi group → trigger rebalance toàn bộ.

**Static Membership - cứu tinh của stability:** Từ Kafka 2.3, bạn có thể cấu hình `group.instance.id`. Khi consumer restart với cùng instance ID, broker nhận diện được là "bạn cũ" và cho phép rejoining mà không gây rebalance toàn bộ group.

## 3. Retry sai cách sẽ giết downstream

Tutorial thường nói: "Dùng exponential backoff, retry 5 lần là được." Nghe có vẻ hợp lý, cho đến khi bạn đối mặt với thực tế.

Production scenario kinh điển: Downstream service có timeout 2 giây. Có 1.000 message cùng gọi endpoint đó. Mỗi message retry 5 lần = 5.000 request dồn dập trong vài phút. Downstream service chết hẳn → tất cả message fail → retry tiếp → tạo thành retry storm phá hủy hoàn toàn downstream service.

**Retry pipeline độc lập - giải pháp trưởng thành:**

- Main consumer chỉ xử lý message thành công ngay lần đầu
- Khi gặp lỗi transient → produce vào Retry Topic với timestamp delay
- Retry consumer riêng biệt xử lý message từ Retry Topic sau khoảng delay định trước
- Sau N lần retry thất bại → đẩy vào DLQ để manual inspection

## 4. Consumer không thread-safe - commit offset thế nào cho an toàn?

Câu này cần được khắc vào tâm trí: **Kafka consumer client KHÔNG thread-safe.**

Sai lầm phổ biến nhất: Xử lý message trong thread pool, rồi commit offset từ worker thread → race condition → commit sai offset → mất message hoặc duplicate message hàng loạt.

**AckMode thông minh:**

- `RECORD`: commit sau mỗi message → overhead cao, nhưng an toàn nhất
- `BATCH`: commit sau mỗi batch → cân bằng tốt
- `MANUAL`/`MANUAL_IMMEDIATE`: commit thủ công khi bạn ready → linh hoạt nhất

## 5. Producer: Idempotence, Transaction và Outbox Pattern

**Ba lớp phòng thủ cho producer:**

**Idempotence - lớp cơ bản:** Luôn bật `enable.idempotence=true`. Tính năng này gán mỗi producer một ID và đánh số sequence cho mỗi message, giúp broker phát hiện và loại bỏ duplicate do producer retry.

**Transaction - cho cross-partition atomicity:** Spring Kafka hỗ trợ transaction thông qua `KafkaTransactionManager`. Khi bạn cần atomicity across multiple partitions/topics.

**Outbox Pattern - giải quyết bài toán kinh điển:** "Commit database trước hay send Kafka message trước?" - Outbox Pattern trả lời: cả hai, nhưng theo thứ tự đúng.

1. Trong cùng một database transaction với business logic, write event vào bảng `outbox`
2. Commit transaction (business data + outbox record)
3. Background process (CDC hoặc scheduled job) đọc từ `outbox` và produce sang Kafka

## 6. Race condition mà tutorial không bao giờ nói

Kafka chỉ đảm bảo ordering **trong một partition**, không đảm bảo ordering theo logic business của bạn.

**Scenario kinh điển:** Message A (update order status = "PROCESSING") và message B (update order status = "COMPLETED") cho cùng `order_id=123`. Nếu chúng vào hai partition khác nhau do hash key khác nhau, consumer xử lý song song → message B có thể được xử lý trước message A.

**Partition key strategy - chìa khóa của ordering:** Luôn sử dụng `entity_id` làm partition key cho tất cả message liên quan đến cùng entity.

## 7. Observability: Bạn không thể debug cái bạn không measure

Lag metric từ Kafka (consumer lag) là cần thiết nhưng không đủ. Nó giống như chỉ nhìn đồng hồ tốc độ mà không biết xe đang ở đâu, xăng còn bao nhiêu.

**Production observability checklist:**

- Distributed Tracing là bắt buộc: Inject trace-id vào message header
- Business Metrics: Số message xử lý thành công/thất bại mỗi phút, p95, p99 latency
- Kafka Client Metrics: Spring Kafka tích hợp với Micrometer
- Health Check có ý nghĩa: consumer có assigned partition không? Có đang rebalance không?

## 8. DLQ không phải thùng rác

Ngày đầu lên Kafka, team nào cũng rất tự tin: "Có lỗi thì quăng vào DLQ, khỏi block consumer." Ba tháng sau: DLQ có vài triệu message. Không ai dám đọc. Không ai dám replay. Không ai dám xóa.

**DLQ chỉ có giá trị khi nó có semantics:** Mỗi message trong DLQ phải trả lời được ba câu hỏi:

1. Vì sao fail? (error category, error message, stack trace)
2. Fail thuộc loại gì? (permanent/transient)
3. Có nên replay không? Và replay thế nào?

## Kết luận

Kafka không khó. Cách con người dùng Kafka mới khó.

Tutorial dạy bạn API, dạy bạn concept, dạy bạn happy path. Production dạy bạn: Offset là tiền, rebalance là bão, commit sai là mất tất cả. Retry không phải feature của Kafka core, mà là của client libraries - và là con dao cần được cầm bằng cả hai tay.

Kafka production-ready không phải là checklist feature, mà là một mindset. Mindset của sự khiêm tốn trước độ phức tạp của distributed system. Mindset của phòng thủ nhiều lớp thay vì tin tưởng mù quáng. Mindset của observability-driven development thay vì "it works on my machine".
