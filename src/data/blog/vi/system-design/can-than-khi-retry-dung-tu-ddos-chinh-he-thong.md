---
title: "Thiết kế retry cho hệ thống phân tán"
description: "Cách dùng retry có giới hạn, backoff, jitter, circuit breaker và xử lý trì hoãn để giảm cascading failure."
pubDatetime: 2025-06-22T16:02:00+07:00
featured: false
draft: false
tags:
  - system-design
  - microservices
  - backend
---

[SOURCE FACT] Retry là việc thực hiện lại một thao tác sau khi thao tác đó thất bại. Retry hữu ích khi lỗi có tính tạm thời, chẳng hạn gián đoạn mạng, timeout hoặc lỗi tạm thời ở downstream. Retry không phải là lời giải chung cho mọi request thất bại.

Điểm khó là retry tạo thêm tải đúng lúc dependency có thể đã không khỏe. Vì vậy, một policy hợp lý phải trả lời bốn câu hỏi: lỗi nào có thể retry, được phép tạo thêm bao nhiêu công việc, khi nào nên đưa công việc ra khỏi request path, và khi nào caller phải dừng gửi traffic? Bài viết này trình bày các quyết định đó cùng một số lựa chọn triển khai phổ biến.

## 1. Vì sao retry có thể khuếch đại sự cố

[ANALYSIS] Xét phép tính minh họa sau:

- Service A gọi Service B.
- Service B đang quá tải và trả về HTTP 503 (Service Unavailable).
- Service A thực hiện 3 lần retry, mỗi lần cách nhau 100 ms.
- 1.000 request đến Service A gần như cùng lúc.

Mỗi request có thể tạo ra 4 lần gọi đến Service B: 1 lần ban đầu và 3 lần retry. Như vậy có thể có tới 4.000 lần gọi, với giả định mọi attempt đều đến được dependency. Lưu lượng retry có thể tiêu thụ phần capacity còn lại của Service B và lan lỗi sang các caller khác.

Phép tính này là giả định minh họa, không phải số đo production. Điều cần chú ý là hệ số khuếch đại: phải đánh giá retry policy trên tổng traffic của tất cả caller và instance, không chỉ trên một request.

## 2. Các pattern retry cần tránh

[ANALYSIS] Những policy sau thường biến lỗi tạm thời thành outage lớn hơn:

- Retry không delay gửi request tiếp theo khi dependency có thể vẫn đang xử lý nguyên nhân của lỗi trước.
- Nhiều instance retry theo cùng lịch tạo ra traffic spike đồng bộ. Jitter, tức một khoảng trễ ngẫu nhiên nhỏ, giúp giảm sự đồng bộ này.
- Retry vô hạn giữ công việc ở trạng thái đang xử lý, tiêu thụ connection và worker capacity, đồng thời làm queue bị nghẽn. Hành vi hoàn tất hoặc thất bại cũng trở nên khó dự đoán.

## 3. Quyết định lỗi có thể retry hay không

[PROPOSED DESIGN] Chỉ retry khi operation có khả năng hợp lý sẽ thành công mà không cần thay đổi input.

Thường có thể retry, tùy contract của API:

- Timeout và connection reset
- HTTP 5xx như 500, 502, 503 và 504
- Downstream service đang restart hoặc tạm thời không khả dụng

Thường không nên retry:

- Client error như 400, 401, 403 và 404
- Business error như không tìm thấy user, không đủ tiền hoặc validation thất bại
- HTTP 422 (Unprocessable Entity)

Chỉ nhìn status code là chưa đủ. Timeout không chứng minh server chưa xử lý write. Với operation không idempotent, cần dùng idempotency key và cơ chế deduplication ở server trước khi cân nhắc retry.

## 4. Retry policy có giới hạn

[PROPOSED DESIGN] Một policy thực tế nên quy định rõ từng giới hạn:

1. Giới hạn số attempt. Không retry vô hạn. Mức tối đa phụ thuộc request deadline và dependency; ví dụ nguồn dùng khoảng 2–3 retry chỉ là một khoảng minh họa.
2. Thêm backoff và jitter. Exponential backoff tăng thời gian chờ sau mỗi lần thất bại; linear backoff cũng là một lựa chọn. Thêm jitter để các caller độc lập không retry cùng lúc.
3. Chỉ retry operation an toàn. GET thường idempotent và PUT thường được thiết kế idempotent, nhưng API contract mới là căn cứ quyết định. POST chỉ nên retry khi operation hỗ trợ idempotency, chẳng hạn qua idempotency key.
4. Đặt total deadline. Timeout cho từng attempt và deadline tổng của request phải ngăn retry tiêu thụ capacity của caller không giới hạn.
5. Ghi log quyết định retry. Lưu nguyên nhân lỗi, số attempt, timestamp, delay đã chọn và kết quả cuối. Không ghi dữ liệu request nhạy cảm vào log.

## 5. Circuit breaker và deferred retry

[PROPOSED DESIGN] Circuit breaker dừng gọi dependency sau khi dependency thất bại liên tục. Ở trạng thái open, request fail fast. Sau một khoảng chờ đã cấu hình, breaker chuyển sang half-open và cho phép một số probe giới hạn. Breaker chỉ đóng lại khi dependency có đủ request thành công. Đây là cơ chế điều tiết traffic, không thay thế timeout hoặc giới hạn retry.

Với công việc không cần phản hồi ngay, dùng deferred retry. Lưu công việc vào queue hoặc database rồi xử lý bằng background consumer khi dependency hồi phục. Giới hạn queue, áp dụng backpressure và định nghĩa dead-letter path cho item vượt quá retry policy. Cách này ngăn request path tạo thêm tải trong lúc có sự cố.

Retry rate cũng cần giới hạn. Circuit breaker có thể dừng một caller, nhưng cả fleet caller vẫn có thể tạo ra lượng retry đáng kể. Khi phù hợp, hãy áp dụng rate limit theo client, operation hoặc toàn hệ thống.

## 6. Quyết định khi nào thử lại

[PROPOSED DESIGN] Dùng các tín hiệu mô tả dependency và request:

- Tôn trọng `Retry-After` nếu API cung cấp và giá trị đó vẫn nằm trong request deadline.
- Dùng health check và service metrics làm tín hiệu vận hành, không xem đó là bảo đảm request tiếp theo sẽ thành công. Các hệ thống metrics như Prometheus và Grafana giúp quan sát recovery, latency và xu hướng lỗi.
- Để circuit breaker điều khiển việc khôi phục dần thông qua các probe ở trạng thái half-open.
- Tiếp tục rate-limit retry traffic trong khi dependency hồi phục.

## 7. Các lựa chọn triển khai

[SOURCE FACT] Một số lựa chọn phổ biến:

Java và Spring:

- Spring Retry cung cấp `@Retryable`, backoff có thể cấu hình và recovery qua `@Recover`.
- Resilience4j cung cấp retry, circuit breaker, rate limiter và bulkhead, đồng thời tích hợp với Spring Boot và Micrometer.
- Kafka retry topic chuyển record lỗi sang topic riêng để không block main consumer. Dead-letter topic xử lý record vượt quá policy.
- Quartz và Spring Task có thể lên lịch background work dạng deferred.

Nền tảng khác:

- Python: Tenacity cho retry decorator và Celery cho retry policy của async task.
- Node.js: `retry`, Bull và Agenda hỗ trợ policy dựa trên thời gian hoặc số attempt.
- Go: `go-retryablehttp` và `backoff` cung cấp các building block cho retry và backoff.

Cloud service:

- AWS: SQS kết hợp Lambda và dead-letter queue (DLQ), hoặc retry và catch state trong Step Functions.
- GCP: Cloud Tasks, Pub/Sub retry kết hợp DLQ, hoặc retry logic trong Workflows.
- Azure: retry policy của Service Bus hoặc retry support của Azure Durable Functions.

Đây là các lựa chọn triển khai, không phải khuyến nghị dùng tất cả cơ chế cùng lúc. Hãy chọn bộ cơ chế nhỏ nhất phù hợp với delivery guarantee, yêu cầu latency và failure mode của operation.

## 8. Tình huống minh họa

[ANALYSIS; ILLUSTRATIVE ASSUMPTION] Trong một đợt cao điểm khuyến mại, payment dependency bị timeout trong khi batch job vẫn tiếp tục gửi request. Giả định job được cấu hình 5 retry, không delay và không jitter, và retry traffic góp phần gây quá tải. Tác động thực tế phụ thuộc capacity, concurrency và cách dependency xử lý; các con số sau không mô tả một incident đã quan sát.

Một thiết kế an toàn hơn sẽ:

- Giảm retry budget của operation xuống 2 lần retry.
- Thêm exponential backoff và jitter.
- Đặt circuit breaker quanh các lệnh gọi dependency của batch job.
- Đưa non-interactive work vào queue và xử lý bằng background consumer.
- Theo dõi timeout rate, latency, queue depth và final failure rate.

Mục tiêu là khôi phục có kiểm soát thay vì tạo thêm synchronous load. Không thể suy ra hệ thống ổn định trong 10 phút từ ví dụ này; tuyên bố như vậy cần số đo từ hệ thống thực tế.

## 9. Kết luận

Retry là quyết định về capacity và correctness, không chỉ là tiện ích phía client. Chỉ retry các lỗi có khả năng tự hồi phục, giới hạn số attempt và tổng thời gian, phân tán attempt bằng backoff và jitter, đồng thời bảo vệ dependency bằng circuit breaker và rate limit. Khi không cần phản hồi ngay, hãy chuyển công việc bền vững sang deferred processing.

Câu hỏi quan trọng không chỉ là “request này nên chạy lại bao nhiêu lần?” mà còn là “dependency có thể nhận thêm bao nhiêu tải, và khi nào caller nên dừng rồi chờ?”
