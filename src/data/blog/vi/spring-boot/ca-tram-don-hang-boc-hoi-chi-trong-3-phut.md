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

## Mở màn: Một buổi tối tưởng như bình thường

Hôm đó là thứ Sáu, 20h00, team tôi chuẩn bị triển khai bản cập nhật cho hệ thống order-service – microservice quan trọng nhất trong chuỗi xử lý đơn hàng của công ty.

Mọi thứ đều suôn sẻ. Test pass. CI/CD xanh lè. Tôi nhấn nút Deploy lên môi trường production với một tâm thế tự tin đến đáng sợ.

"Một cú rollout nhỏ thôi, chắc không sao đâu..."

5 phút sau, Slack bỗng réo inh ỏi. Các channel #alert, #ops, #order-system cháy đỏ.

Grafana hiển thị spike lạ: lượng đơn hàng thất bại tăng vọt.

Có những dòng log lạnh gáy:

```
java.net.SocketException: Connection reset
org.apache.kafka.common.errors.TimeoutException
Connection refused: no further information
```

Tôi đứng hình. Trong vài phút, gần cả trăm đơn hàng biến mất không để lại dấu vết. Tất cả đều dừng giữa chừng như có ai bấm "pause" rồi "delete".

## Điều tra: Có gì đó không đúng

Chúng tôi họp chiến cấp tốc. Không lỗi code. Không lỗi Kafka. Không lỗi DB.

Chỉ có một điều trùng khớp duy nhất: các đơn hàng lỗi đều rơi vào đúng thời điểm phiên bản mới được deploy.

Một người trong team chợt hỏi:

"Có ai setup graceful shutdown cho service này chưa?"

Tôi cứng họng. Mọi thứ bắt đầu rõ ràng:

Pod cũ vừa nhận request chưa xử lý xong, thì bị K8s bắn tín hiệu SIGTERM.

Spring Boot chưa được cấu hình graceful shutdown, nên kill luôn, kill sạch. Kafka chưa kịp gửi message. DB chưa kịp commit. Dữ liệu dở dang bị xóa sạch.

## Hậu quả: Production sụp vì một config bị quên

Không ai nghĩ việc quên một dòng cấu hình lại có thể tạo nên hậu quả như vậy.

Gần cả trăm đơn hàng bị mất, phải khôi phục thủ công từng cái một.

4 giờ OT, tôi và một anh DevOps ngồi restore log từ Kafka để truy ngược request.

Một email xin lỗi khách hàng, kèm theo voucher bù lỗi.

Lúc đó tôi chỉ nghĩ: "Ước gì mình biết chuyện này sớm hơn."

## Giác ngộ: Một service shutdown như thế nào, cũng quan trọng như cách nó start

Tôi bắt đầu tìm hiểu về graceful shutdown – khái niệm mà trước giờ tôi chỉ lướt qua.

### Bài học đầu tiên: Bật chế độ shutdown "có lương tâm"

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Giúp Spring chờ các request đang xử lý xong rồi mới shutdown.

### Bài học thứ hai: Nói lời tạm biệt với Kafka cho đàng hoàng

```java
@PreDestroy
public void cleanUp() {
    kafkaProducer.flush();
    kafkaProducer.close(Duration.ofSeconds(10));
    log.info("Kafka producer closed.");
}
```

Nếu không đóng producer đúng cách, bạn đang gửi message vào… hư vô.

### Bài học thứ ba: Đừng quên thread pool của bạn

```java
@Bean
public Executor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);
    return executor;
}
```

### Bài học cuối: readiness probe là lá chắn sinh mạng

```java
@EventListener
public void onAppShutdown(ContextClosedEvent event) {
    isReady.set(false); // readiness = false => K8s không gửi thêm request mới
}
```

Nếu Pod đang shutdown mà vẫn nhận request mới, thì chẳng khác gì... bệnh nhân đang hấp hối vẫn bị gọi dậy đi làm.

## Kết luận

Vụ việc hôm đó là một bài học đau đớn nhưng đáng giá. Nó cho tôi hiểu rằng, một hệ thống không chỉ cần được thiết kế để chạy tốt, mà còn phải được chuẩn bị kỹ càng để dừng đúng cách.

Trong thế giới microservices, nơi mọi thứ liên kết chặt chẽ và real-time, một dịch vụ chết đột ngột có thể tạo ra hiệu ứng domino, ảnh hưởng đến dữ liệu, trải nghiệm người dùng, và uy tín của cả hệ thống.

Những bài học rút ra:

1. Graceful shutdown không phải là tùy chọn – nó là bắt buộc.
   Đặc biệt với các service xử lý request, giao tiếp với Kafka, RabbitMQ, database, hay bên thứ ba.

2. Luôn cấu hình server.shutdown: graceful và timeout-per-shutdown-phase phù hợp.

3. Đảm bảo các tài nguyên quan trọng được đóng đúng cách:
   - Kafka producer
   - Thread pool
   - DB connection
   - External clients

4. Sử dụng readiness probe để ngăn Pod sắp shutdown nhận thêm request.

5. Test kỹ kịch bản shutdown ở staging – đừng chỉ test startup.

6. Và cuối cùng: Tránh deploy vào cuối tuần nếu có thể.
   Hệ thống có thể bị lỗi, nhưng người trực production cũng cần thời gian để sống.

Viết code tốt là một chuyện. Nhưng vận hành hệ thống an toàn, có trách nhiệm, lại là một câu chuyện khác – và thường ít được nói đến hơn.

Hy vọng bài viết này sẽ giúp bạn không phải trải qua một "thứ Sáu đen tối" giống như tôi.
