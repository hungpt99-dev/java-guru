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

## 1. Khi retry là con dao hai lưỡi

Hãy tưởng tượng: Service A gọi sang Service B. Service B bị nghẽn, trả về lỗi 503. Service A có retry 3 lần. Giờ nếu có 1000 request đến Service A cùng lúc: mỗi request thực hiện 4 lần gọi đến Service B = 4000 requests. Trong khi Service B đang quá tải, lượng retry này khiến nó nghẹt thở hoàn toàn, dẫn đến cascading failure.

## 2. Các dạng retry nguy hiểm

- Retry không có delay → Gây dồn dập
- Retry đồng loạt từ nhiều instance → Spike traffic
- Retry vô hạn → Memory leak, queue nghẽn

## 3. Khi nào nên retry và khi nào không nên

**Nên retry khi:** Lỗi tạm thời (timeout, connection reset), HTTP 5xx, hệ thống downstream đang khởi động lại

**Không nên retry khi:** Lỗi client (400, 401, 403, 404), lỗi nghiệp vụ, lỗi 422

## 4. Retry như thế nào cho đúng?

- Giới hạn số lần retry: Tối đa 2–3 lần
- Dùng delay và jitter: Exponential/linear backoff + jitter
- Chỉ retry hành động idempotent
- Sử dụng circuit breaker
- Deferred Retry: Đưa vào queue hoặc DB rồi xử lý bằng background job
- Log đầy đủ

## 5. Công cụ hỗ trợ

Java / Spring ecosystem:

- Spring Retry: Hỗ trợ annotation @Retryable
- Resilience4j: Gộp retry, circuit breaker, rate limiter
- Kafka Retry Topic: Tách retry ra topic riêng

## 6. Case thực tế

Cuối năm, hệ thống chịu tải lớn do chiến dịch khuyến mãi. Một service xử lý thanh toán bị quá tải. Batch job tự động retry 5 lần, không delay, không jitter → service thanh toán tắc nghẽn hoàn toàn → downtime 15 phút.

Cách xử lý: Giảm retry còn 2 lần, thêm exponential backoff và jitter, áp dụng circuit breaker, di chuyển retry sang background job. Kết quả: Hệ thống ổn định lại sau chưa đầy 10 phút.

## 7. Kết luận

Retry là thuốc – dùng đúng thì chữa bệnh, dùng sai thì đầu độc chính hệ thống của bạn. Retry hiệu quả không nằm ở việc "gọi lại bao nhiêu lần", mà ở chỗ "biết lúc nào nên dừng và chờ đợi".
