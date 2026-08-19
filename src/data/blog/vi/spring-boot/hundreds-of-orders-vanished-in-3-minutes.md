---
title: "Mất đơn hàng trong lúc triển khai Spring Boot: Vì sao graceful shutdown quan trọng"
description: "Một sự cố production liên quan đến xử lý đơn hàng bị gián đoạn, việc gửi Kafka và cấu hình graceful shutdown bị bỏ sót."
pubDatetime: 2025-06-18T15:13:00+07:00
featured: true
draft: false
tags:
  - spring-boot
  - microservices
  - devops
  - case-study
---

## Sự cố

Đây là bản tường trình sau sự cố của một lần triển khai order-service. Phần khó không phải là khởi động phiên bản mới, mà là dừng phiên bản cũ mà không làm gián đoạn công việc đang xử lý.

### [SOURCE FACT] Chuyện gì đã xảy ra

Việc triển khai diễn ra vào thứ Sáu lúc 8:00 tối. Test đã đạt và pipeline CI/CD đều xanh. Khoảng năm phút sau khi bắt đầu triển khai production, hệ thống monitoring cho thấy số đơn thất bại tăng mạnh. Một số log liên quan là:

```text
java.net.SocketException: Connection reset
org.apache.kafka.common.errors.TimeoutException
Connection refused: no further information
```

Gần một trăm đơn hàng không hoàn tất. Các lỗi trùng với thời điểm triển khai. Trước khi triển khai, nhóm không tìm thấy lỗi tương ứng trong ứng dụng, Kafka hoặc database.

Pod cũ đã nhận các request vẫn đang được xử lý khi Kubernetes gửi `SIGTERM`. Service chưa bật graceful shutdown của Spring Boot. Process bị dừng trước khi một số message Kafka được gửi và trước khi một số transaction database được commit.

Việc ứng phó mất bốn giờ làm thêm. Tôi cùng một đồng nghiệp DevOps dùng log Kafka để truy vết và khôi phục thủ công các request bị ảnh hưởng. Khách hàng nhận được email xin lỗi và voucher bồi thường.

Các chi tiết trên mô tả sự cố này; đây không phải khẳng định rằng mọi deployment không có graceful shutdown đều làm mất đơn. Kết quả còn phụ thuộc vào thời lượng request, ranh giới transaction, cách gửi message, thời điểm termination và thiết kế retry cũng như recovery xung quanh workflow.

## [ANALYSIS] Vì sao shutdown làm gián đoạn workflow

Một order workflow thường trải qua nhiều resource: HTTP request, thread của ứng dụng, database transaction và message producer. Hoàn tất ở một resource không có nghĩa là các resource còn lại cũng đã hoàn tất.

Khi Pod bắt đầu termination, traffic có thể vẫn đang đi vào trong lúc ứng dụng shutdown. Request có thể bị gián đoạn trước khi database commit, hoặc ứng dụng có thể thoát trước khi producer gửi record thành công. Client hoặc upstream consumer khi đó có thể nhận reset hoặc timeout và retry. Nếu không có idempotency, retry còn có thể tạo bản ghi trùng thay vì khôi phục thao tác ban đầu.

Graceful shutdown xử lý một phần của vấn đề: nó cung cấp một giai đoạn shutdown có kiểm soát và cơ hội hoàn tất công việc đã nhận. Nó không biến workflow qua nhiều resource thành một transaction nguyên tử, cũng không thay thế durable retry, idempotency, reconciliation hoặc quy trình recovery đã được kiểm thử.

Readiness cũng là một phần của quá trình chuyển giao. Pod đang termination nên ngừng nhận traffic mới càng sớm càng tốt. Cập nhật readiness trong lúc ứng dụng shutdown giúp giảm request mới, nhưng không loại bỏ race ngắn giữa việc cập nhật endpoint, load balancing và các request đang bay. Ứng dụng vẫn phải chịu được những request đã được nhận trước khi readiness thay đổi.

## [PROPOSED DESIGN] Một quy trình shutdown an toàn hơn

Các setting dưới đây là baseline đề xuất cho một service Spring Boot. Giá trị `30s` là ví dụ trong hướng dẫn cấu hình của sự cố này, không phải yêu cầu chung. Cần đặt thời gian dài hơn thời gian drain dự kiến và đồng bộ với termination grace period của container.

### 1. Bật graceful shutdown của Spring Boot

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Thiết lập này yêu cầu Spring ngừng nhận công việc mới và chờ các lifecycle component đang hoạt động trong giai đoạn shutdown. Cần kiểm tra hành vi với server, loại request và phiên bản Spring Boot thực tế đang dùng.

### 2. Chủ động đóng resource của producer

Nếu service tự quản lý Kafka producer, shutdown hook nên flush các record đang chờ và đóng producer trong một timeout có giới hạn:

```java
@PreDestroy
public void cleanUp() {
    kafkaProducer.flush();
    kafkaProducer.close(Duration.ofSeconds(10));
    log.info("Kafka producer closed.");
}
```

Timeout `10s` là giá trị minh họa từ thiết kế ban đầu, không bảo đảm việc gửi sẽ thành công. Với producer do framework quản lý, hãy dùng lifecycle của framework thay vì đóng cùng resource hai lần.

### 3. Drain executor của ứng dụng

Background work cũng cần chính sách shutdown rõ ràng. Với executor do Spring quản lý, chờ các task đã submit là một cấu hình có thể dùng:

```java
@Bean
public Executor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);
    return executor;
}
```

Giá trị `30` giây là cùng một timeout minh họa và nên được chọn dựa trên workload cũng như giới hạn của deployment. Việc chờ chỉ hữu ích khi task có giới hạn và có thể hoàn tất; task bị treo vẫn cần timeout hoặc chính sách cancel.

### 4. Ngừng route traffic mới

Readiness, tức tín hiệu cho biết Pod có thể nhận traffic, nên chuyển sang false trong lúc shutdown. Một pattern ở tầng ứng dụng là:

```java
@EventListener
public void onAppShutdown(ContextClosedEvent event) {
    isReady.set(false);
}
```

Readiness endpoint phải thực sự expose `isReady`, và deployment phải sử dụng endpoint đó. Khi các thay đổi endpoint được lan truyền, Kubernetes sẽ loại Pod khỏi nhóm có thể nhận traffic. Đây là tín hiệu drain, không phải bằng chứng rằng không request nào có thể đến.

### 5. Thiết kế workflow để có thể recovery

Cấu hình shutdown làm giảm công việc bị gián đoạn, nhưng không loại bỏ các failure window. Order workflow cũng nên xác định:

- Ranh giới database transaction và cách nhận diện đơn chưa hoàn tất.
- Idempotency key cho client request và message consumer.
- Chính sách retry có timeout, backoff và circuit breaker khi phù hợp.
- Cách xử lý message bền vững và một reconciliation path cho trường hợp trạng thái database và Kafka của đơn hàng không đồng nhất.
- Metric và alert cho request bị gián đoạn, consumer lag, producer failure và khối lượng recovery.

## Kiểm chứng

Shutdown cần được test, không chỉ startup. Trong môi trường staging, gửi các request đủ lâu để chồng lấn với termination, sau đó kiểm tra readiness transition, việc hoàn tất request, hành vi database commit, việc Kafka delivery hoặc retry, quá trình drain executor và recovery của phần việc chưa hoàn tất.

Cũng cần test các trường hợp lỗi: dependency timeout, task bị treo, producer close vượt quá ngân sách thời gian và request đến trong lúc endpoint đang được lan truyền. Mục tiêu không phải giả định shutdown luôn sạch. Mục tiêu là làm cho các failure mode còn lại có thể quan sát và recovery.

## Kết luận

Sự cố cho thấy một operational control bị thiếu, không phải một lỗi bí ẩn của Spring Boot hay Kafka. Service cần quy trình rõ ràng cho việc start, serve, drain và stop. Graceful shutdown, quản lý readiness, cleanup resource có giới hạn, idempotency và reconciliation xử lý các phần khác nhau của quy trình đó.

Checklist thực tế:

1. Cấu hình `server.shutdown: graceful` và chọn shutdown timeout dựa trên workload đo được cũng như giới hạn deployment.
2. Ngừng traffic mới qua readiness, đồng thời vẫn xử lý các request đã được nhận.
3. Drain thread pool và đóng các client bên ngoài do ứng dụng quản lý, gồm Kafka producer, database client và HTTP client.
4. Dùng chính sách timeout, retry, fallback, circuit breaker và backpressure khi workflow cần.
5. Làm cho request và consumer có idempotency, đồng thời cung cấp reconciliation cho phần hoàn tất dang dở.
6. Test termination và recovery trong staging, không chỉ startup và traffic ổn định.
7. Nếu quy trình release cho phép, tránh xếp lịch deployment rủi ro cao vào lúc on-call coverage bị hạn chế.

Deployment là trigger. Bài học cốt lõi là vận hành an toàn phải bao gồm shutdown path và recovery path, không chỉ phần code chạy khi mọi thứ đang ổn định.
