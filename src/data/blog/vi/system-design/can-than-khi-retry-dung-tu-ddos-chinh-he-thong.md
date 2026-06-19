---
title: "Cẩn thận khi retry – đừng tự DDoS chính hệ thống của mình"
description: "Retry không kiểm soát có thể gây cascading failure. Hướng dẫn retry đúng cách với exponential backoff, jitter, circuit breaker và deferred retry."
pubDatetime: 2025-06-22T16:02:00+07:00
featured: false
draft: false
tags:
  - system-design
  - microservices
  - backend
---

Retry không xấu. Nhưng nếu dùng sai cách, bạn có thể vô tình trở thành "hacker DDoS"... chính hệ thống của mình.

Retry – cơ chế lặp lại yêu cầu khi gặp lỗi – là một phần không thể thiếu trong thiết kế hệ thống phân tán. Khi một API gọi đến service khác thất bại do lỗi mạng, timeout hay lỗi tạm thời, ta thường cài đặt retry để tăng khả năng thành công.

Từ một cơ chế hỗ trợ, retry dễ dàng trở thành thủ phạm gây ra hiệu ứng domino nếu thiếu kiểm soát.

## 1. Khi retry là con dao hai lưỡi

Hãy tưởng tượng một tình huống đơn giản:

- Service A gọi sang Service B.
- Service B bị nghẽn, trả về lỗi 503 (Service Unavailable).
- Service A có retry 3 lần, mỗi lần delay 100ms.

Giờ nếu có 1000 request đến Service A cùng lúc:

- Mỗi request thực hiện 4 lần gọi đến Service B (1 lần gốc + 3 lần retry).
- Tổng cộng: 1000 × 4 = 4000 requests tới Service B.
- Trong khi Service B đang quá tải, lượng retry này khiến nó nghẹt thở hoàn toàn, dẫn đến cascading failure.

Retry không kiểm soát = tự bắn vào chân.

## 2. Các dạng retry nguy hiểm

- Retry không có delay → Gây dồn dập, tấn công liên tiếp khi gặp lỗi.
- Retry đồng loạt từ nhiều instance → Cùng một lúc nhiều instance retry → spike traffic lớn → service đích sập.
- Retry vô hạn → Có thể gây memory leak, queue nghẽn, tạo bão request không dừng.

## 3.5 Khi nào nên retry và khi nào không nên

Không phải lỗi nào cũng nên retry.

Nên retry khi:

- Lỗi tạm thời: timeout, connection reset
- Lỗi hệ thống: HTTP 5xx như 500, 502, 503, 504
- Trường hợp hệ thống downstream đang khởi động lại

Không nên retry khi:

- Lỗi client: 400, 401, 403, 404
- Lỗi nghiệp vụ: user không tồn tại, hết tiền, validation sai
- Lỗi 422 – Unprocessable Entity

✅ Chỉ nên retry nếu lỗi có khả năng tự hồi phục.

## 3.6 Retry như thế nào cho đúng?

1. Giới hạn số lần retry
   Không bao giờ retry vô hạn. Tối đa 2–3 lần tùy ngữ cảnh.

2. Dùng delay và jitter
   Thêm khoảng trễ giữa các lần retry (exponential/linear), kết hợp jitter để tránh đồng loạt.

3. Chỉ retry hành động idempotent
   Ví dụ: GET, PUT an toàn hơn POST, tránh tạo nhiều đơn hàng, chuyển tiền trùng.

4. Sử dụng circuit breaker
   Ngắt tạm khi service downstream lỗi liên tục, thử lại sau.

5. Deferred Retry – Retry thông minh qua job
   Thay vì retry ngay, đưa vào queue hoặc DB rồi xử lý bằng background job khi hệ thống ổn định. Tránh làm quá tải thêm lúc hệ thống đang gặp sự cố.

6. Log đầy đủ
   Ghi lại nguyên nhân lỗi, số lần retry, thời điểm retry để dễ debug và cảnh báo.

## 3.7 Làm sao biết khi nào retry lại được?

1. Dùng circuit breaker
   Ngắt kết nối tạm thời nếu service đích lỗi liên tục. Sau đó mở dần lại (half-open).

2. Quan sát health check hoặc metric
   Kiểm tra /health hoặc số liệu từ Prometheus, Grafana để biết hệ thống đã phục hồi chưa.

3. Dựa vào header Retry-After
   Một số API chuẩn trả về thời gian gợi ý để thử lại.

4. Giới hạn tốc độ retry (rate limit)
   Tránh trường hợp retry dồn dập khiến service quá tải trở lại.

## 4. Công cụ hỗ trợ triển khai retry hiệu quả

Java / Spring ecosystem:

- Spring Retry: Hỗ trợ annotation @Retryable, cấu hình delay, backoff, fallback với @Recover.
- Resilience4j: Gộp retry, circuit breaker, rate limiter, bulkhead trong cùng thư viện. Tích hợp tốt với Spring Boot và Micrometer.
- Kafka Retry Topic: Tách retry ra topic riêng có delay, tránh block consumer chính. Kết hợp với dead-letter topic để không mất dữ liệu.
- Quartz / Spring Task: Dùng để lên lịch xử lý retry dạng deferred background job.

Ngôn ngữ/platform khác:

- Python: tenacity: retry decorator mạnh mẽ; celery: có built-in retry policy cho task async
- Node.js: retry, bull, agenda: hỗ trợ retry theo thời gian và số lần
- Go: go-retryablehttp, backoff: đơn giản, hiệu quả

Cloud-native:

- AWS: SQS + Lambda + DLQ; Step Functions với retry/catch block
- GCP: Cloud Tasks, Pub/Sub retry + DLQ; Workflows có retry logic
- Azure: Service Bus với retry policy cấu hình sẵn; Azure Durable Functions hỗ trợ retry built-in

## 5. Case thực tế: Cứu hệ thống mùa cao điểm nhờ retry có chiến lược

Bối cảnh:
Cuối năm, hệ thống chịu tải lớn do chiến dịch khuyến mãi. Một service xử lý thanh toán bị quá tải, trả về lỗi timeout liên tục. Trong khi đó, một batch job tự động đang chạy hàng ngàn request mỗi phút, có retry 5 lần, không delay, không jitter.

Hậu quả:
Retry dồn dập khiến service thanh toán tắc nghẽn hoàn toàn → ảnh hưởng dây chuyền các hệ thống khác → downtime 15 phút trong giờ cao điểm.

Cách xử lý:

- Giảm số lần retry còn 2
- Thêm exponential backoff và jitter
- Áp dụng circuit breaker cho job
- Di chuyển các retry sang hàng đợi và xử lý qua background job

Kết quả:
Hệ thống ổn định lại sau chưa đầy 10 phút. Retry không còn gây "nghẹt thở" cho backend.

Bài học:

Retry không phải để "cố đấm ăn xôi", mà là để giúp hệ thống hồi phục có kiểm soát.

## 6. Kết luận

Retry là một công cụ mạnh nếu được dùng đúng cách. Nhưng nếu triển khai thiếu kiểm soát, nó có thể phá vỡ hệ thống nhanh hơn cả lỗi ban đầu.

Hãy nhớ:

- Retry chỉ dùng cho lỗi tạm thời, có khả năng tự hồi phục
- Giới hạn retry, thêm delay + jitter, và luôn có circuit breaker
- Retry hiệu quả không nằm ở việc "gọi lại bao nhiêu lần", mà ở chỗ "biết lúc nào nên dừng và chờ đợi"

Retry là thuốc – dùng đúng thì chữa bệnh, dùng sai thì đầu độc chính hệ thống của bạn.
