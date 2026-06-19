---
title: "Cả trăm đơn hàng bốc hơi chỉ trong 3 phút – tất cả vì một dòng config bị quên"
description: "Case study thực tế về hậu quả của việc quên cấu hình graceful shutdown trong Spring Boot: mất đơn hàng, Kafka message và bài học rút ra."
pubDatetime: 2025-06-18T15:13:00+07:00
featured: true
draft: false
tags:
  - spring-boot
  - microservices
  - devops
  - case-study
---

Hôm đó là thứ Sáu, 20h00, team tôi chuẩn bị triển khai bản cập nhật cho hệ thống order-service – microservice quan trọng nhất trong chuỗi xử lý đơn hàng.

Mọi thứ đều suôn sẻ. Test pass. CI/CD xanh lè. Tôi nhấn nút Deploy lên môi trường production với một tâm thế tự tin đến đáng sợ.

5 phút sau, Slack bỗng réo inh ỏi. Grafana hiển thị spike lạ: lượng đơn hàng thất bại tăng vọt. Có những dòng log lạnh gáy:

```
java.net.SocketException: Connection reset
org.apache.kafka.common.errors.TimeoutException
```

Tôi đứng hình. Trong vài phút, gần cả trăm đơn hàng biến mất không để lại dấu vết.

## Điều tra

Chúng tôi họp chiến cấp tốc. Không lỗi code. Không lỗi Kafka. Không lỗi DB. Một người trong team chợt hỏi: "Có ai setup graceful shutdown cho service này chưa?"

Tôi cứng họng. Pod cũ vừa nhận request chưa xử lý xong, thì bị K8s bắn tín hiệu SIGTERM. Spring Boot chưa được cấu hình graceful shutdown, nên kill luôn, kill sạch. Kafka chưa kịp gửi message. DB chưa kịp commit.

## Bài học

### 1. Bật chế độ shutdown "có lương tâm"

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

### 2. Nói lời tạm biệt với Kafka cho đàng hoàng

```java
@PreDestroy
public void cleanUp() {
    kafkaProducer.flush();
    kafkaProducer.close(Duration.ofSeconds(10));
}
```

### 3. Đừng quên thread pool

```java
@Bean
public Executor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);
    return executor;
}
```

### 4. Readiness probe là lá chắn sinh mạng

```java
@EventListener
public void onAppShutdown(ContextClosedEvent event) {
    isReady.set(false); // K8s không gửi thêm request mới
}
```

## Kết luận

Một hệ thống không chỉ cần được thiết kế để chạy tốt, mà còn phải được chuẩn bị kỹ càng để dừng đúng cách. Graceful shutdown không phải là tùy chọn – nó là bắt buộc.
