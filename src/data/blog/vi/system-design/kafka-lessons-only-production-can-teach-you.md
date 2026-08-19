---
title: "Kafka trong production: Bốn dạng lỗi cần thiết kế trước"
description: "Các bài học vận hành Kafka: poison message, consumer rebalance, retry storm và commit offset an toàn."
pubDatetime: 2026-01-24T07:31:00+07:00
featured: true
draft: false
tags:
  - kafka
  - system-design
  - microservices
---

Các khái niệm Kafka khá dễ mô tả khi đứng riêng lẻ: producer ghi record, consumer đọc partition, consumer group phối hợp việc xử lý, còn offset ghi nhận tiến độ. Production khó hơn vì các cơ chế này tương tác với latency của ứng dụng, lỗi dependency, cách deploy và chiến lược xử lý lỗi.

Bài viết tập trung vào bốn vấn đề vận hành cần có quyết định thiết kế rõ ràng:

- một lỗi vĩnh viễn liên tục chặn partition;
- consumer chậm làm consumer group mất ổn định;
- retry làm quá tải dependency đang lỗi; và
- commit offset không phản ánh đúng business side effect.

Các nhãn dưới đây tách hành vi của Kafka khỏi phần phân tích và các lựa chọn thiết kế đề xuất. Các ngưỡng trong ví dụ chỉ là giả định minh họa, không phải giá trị mặc định cho mọi hệ thống.

## 1. Một Poison Message Có Thể Chặn Partition

**[SOURCE FACT]** Kafka lưu record theo thứ tự trong từng partition. Consumer thường tiến hành bằng cách poll record rồi commit offset. Bản thân Kafka không cung cấp application-level retry policy hay dead-letter queue. Những hành vi này phải do ứng dụng consumer hoặc client framework như Spring Kafka thực hiện.

**[ANALYSIS]** Payload sai định dạng, schema không khớp, trường null ngoài dự kiến, enum không hợp lệ hoặc business command bị từ chối có thể sẽ luôn thất bại. Nếu consumer retry cùng record mà không có giới hạn hoặc route thay thế, nó có thể không bao giờ đọc tới các record sau trong partition đó. Trường hợp này khác với database timeout tạm thời, vốn có thể thành công sau khi dependency hồi phục.

Hãy phân loại lỗi trước khi chọn retry policy:

- **Lỗi vĩnh viễn, không retry:** lỗi parse, schema, validation và business rule mang tính quyết định. Lặp lại cùng một thao tác sẽ không thay đổi input hoặc kết quả của rule.
- **Lỗi tạm thời, có thể retry:** lỗi network tạm thời, connection timeout, deadlock database ngắn và dependency tạm thời không khả dụng. Có thể retry trong một policy có giới hạn.

**[PROPOSED DESIGN]** Đưa lỗi vĩnh viễn vào dead-letter topic hoặc queue, kèm record gốc, topic, partition, offset, phân loại lỗi và thời điểm xử lý. Ghi rõ việc replay có an toàn hay không và cần sửa gì. Chỉ commit offset của record lỗi sau khi việc route này thành công để consumer có thể tiếp tục. Không acknowledge record chỉ vì handler của nó đã ném exception.

Schema Registry có thể giúp ngăn việc đăng ký schema không tương thích khi đã bật compatibility rules. Nó không thay thế payload validation và cũng không bảo vệ topic nếu producer bỏ qua serialization path dự kiến. Hãy xem đây là một lớp kiểm soát bổ sung ở phía producer, không phải lớp phòng vệ duy nhất ở phía consumer.

## 2. Rebalance Có Thể Làm Mất Throughput

**[SOURCE FACT]** Consumer group rebalance khi membership hoặc partition assignment thay đổi. Consumer cũng có thể rời group nếu khoảng thời gian giữa các lần gọi `poll` vượt quá `max.poll.interval.ms`. Heartbeat do Kafka client xử lý, nhưng heartbeat thành công không ngăn consumer bị loại vì không gọi `poll` trong interval đã cấu hình.

**[ANALYSIS]** Xử lý synchronous quá lâu trong poll loop, các pause dài của runtime, shutdown chậm và network không ổn định đều có thể làm rebalance xảy ra thường xuyên hơn hoặc tốn kém hơn. Trong lúc rebalance, partition bị revoke rồi assign lại; các partition bị ảnh hưởng không thể tiến hành bình thường cho tới khi quyền sở hữu được ổn định. Vì vậy, rebalance lặp đi lặp lại có thể làm giảm throughput ngay cả khi broker và network vẫn khỏe.

**[PROPOSED DESIGN]** Giữ poll path trong giới hạn thời gian. Giảm `max.poll.records` khi một batch mất quá nhiều thời gian, hoặc chuyển business work sang worker pool có kiểm soát nếu client framework hỗ trợ mô hình đó. Với cách thứ hai, phải định nghĩa rõ việc ordering, pause, retry và commit; tăng concurrency mà không có offset policy chỉ chuyển lỗi sang nơi khác.

Static membership dùng `group.instance.id` có thể giảm việc assignment lại không cần thiết trong lúc restart nếu instance quay lại với cùng identity và assignment vẫn hợp lệ. Đây không phải cam kết rằng mọi lần restart đều tránh được rebalance, đồng thời cần cơ chế quản lý identity để hai consumer đang chạy không dùng cùng một ID.

Hãy tuning `fetch.min.bytes`, `fetch.max.wait.ms` và `max.poll.records` dựa trên yêu cầu latency và throughput quan sát được. Đây là các tham số điều khiển workload, không phải các cách sửa hiệu năng đúng cho mọi hệ thống.

## 3. Retry Không Kiểm Soát Tạo Ra Retry Storm

**[SOURCE FACT]** Retry là một request khác gửi tới dependency đang lỗi. Exponential backoff làm giãn khoảng cách giữa các lần retry, nhưng tự nó không giới hạn concurrency, không phối hợp các consumer và không bảo vệ dependency. Spring Kafka có thể áp dụng các policy như `FixedBackOff` hoặc `ExponentialBackOff` qua cơ chế error handling, nhưng retry trên consumer thread vẫn chiếm thread đó.

**[ANALYSIS]** Giả sử minh họa rằng một dependency đang timeout trong khi có nhiều record được xử lý. Nếu mỗi record được retry ngay, consumer sẽ tạo thêm traffic tới chính dependency đang lỗi. Dependency tiếp tục không khỏe, xử lý chậm lại và nhiều record hơn đủ điều kiện retry. Vòng lặp phản hồi này là retry storm.

**[PROPOSED DESIGN]** Dùng retry policy có giới hạn và route lỗi rõ ràng:

1. Main consumer xử lý record một lần.
2. Với lỗi tạm thời, publish record vào retry topic cùng thời điểm thử tiếp theo và metadata lỗi.
3. Một retry consumer riêng chỉ lấy record sau khoảng delay dự kiến.
4. Khi hết retry budget đã cấu hình, đưa record vào dead-letter topic để kiểm tra hoặc replay có kiểm soát.

Khoảng delay và retry budget cụ thể là các giả định của từng deployment. Hãy chọn chúng dựa trên thời gian dependency thường hồi phục và deadline nghiệp vụ, không dựa trên một công thức chung.

Dùng circuit breaker để ngừng gửi work tới dependency liên tục thất bại. Circuit breaker cần có điều kiện mở rõ ràng, một lần thử half-open có kiểm soát và route vận hành cho các record không thể chờ. Thêm jitter vào backoff để các consumer độc lập không retry cùng một thời điểm. Rate limit, worker pool có giới hạn và backpressure, tức giảm tốc độ nhận khi năng lực xử lý đã cạn, là các cơ chế bổ trợ.

## 4. Consumer Không Thread-Safe: Commit Offset Có Chủ Đích

**[SOURCE FACT]** Kafka consumer client không được thiết kế để nhiều application thread truy cập đồng thời. Thread sở hữu consumer nên thực hiện poll, quản lý assignment và các thao tác consumer như commit. Offset đã commit biểu thị vị trí trong partition; nó không chứng minh business side effect tương ứng đã hoàn tất.

**[ANALYSIS]** Nếu ứng dụng commit trước khi ghi database hoặc gọi downstream service, một crash có thể khiến side effect chưa xảy ra nhưng Kafka đã coi record là đã xử lý. Nếu ứng dụng thực hiện side effect rồi crash trước khi commit, record có thể được giao lại. Đây là trade-off thông thường của at-least-once, không phải lỗi của offset. Vì vậy side effect phải chịu được duplicate hoặc nằm trong transaction boundary phù hợp.

**[PROPOSED DESIGN]** Xác định rõ ownership và thứ tự commit:

- Giữ các lời gọi tới consumer client trên consumer thread, trừ khi framework có tài liệu xác nhận mô hình an toàn khác.
- Chỉ commit sau khi side effect cần thiết thành công, hoặc sau khi lỗi vĩnh viễn đã được route bền vững vào dead-letter path.
- Nếu giao work cho worker, theo dõi completion theo từng partition và chỉ commit offset liên tục cao nhất đã hoàn tất. Không commit record sau trong khi record trước còn unresolved, trừ khi processing model cho phép thứ tự đó một cách rõ ràng.
- Làm cho write có tính idempotency, tức áp dụng nhiều lần vẫn an toàn, chẳng hạn dùng event ID ổn định cùng database uniqueness constraint. Dùng row lock hoặc outbox/inbox pattern khi thao tác cần phối hợp chặt hơn.
- Theo dõi commit failure, consumer lag, retry volume, dead-letter volume và tần suất rebalance cùng nhau. Một metric trông khỏe có thể che giấu pipeline đang bị kẹt.

Kafka không quyết định business transaction của bạn kết thúc ở đâu. Consumer design phải làm rõ boundary đó, cách xử lý duplicate và quy trình recovery.
