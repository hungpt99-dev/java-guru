---
title: "Ôn phỏng vấn Java #5: Apache Kafka — Từ nền tảng đến vận hành"
description: "Cẩm nang phỏng vấn Kafka thực tế về topic, partition, delivery semantics, ordering, consumer group, offset, serialization và metadata."
pubDatetime: 2026-08-10T10:20:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - kafka
  - event-driven
---

Phỏng vấn Kafka không chủ yếu kiểm tra việc nhớ tên các cấu hình. Phần khó hơn là giải thích một lần ghi hoặc đọc thành công thực sự có nghĩa gì, Kafka cung cấp guarantee nào, và consumer hoạt động ra sao khi xử lý chậm hoặc gặp record không thể xử lý. Bài viết bao phủ phần câu hỏi hiện có, đi từ nền tảng đến vận hành: partitioning, delivery semantics, ordering, retention, consumer group, offset, serialization và metadata.

Các ví dụ dùng topic `orders` và cấu hình Java client. Những giá trị như số partition, thời gian retention và timeout là ví dụ trong bản thảo nguồn, không phải production default áp dụng cho mọi hệ thống. Cần điều chỉnh theo workload, năng lực broker và yêu cầu khôi phục khi có sự cố.

## Junior: Nền tảng

**Q1. Topic, partition và offset là gì?**

[SOURCE FACT] Topic là một log có tên, được chia thành các **partition**. Mỗi partition là một log có thứ tự và chỉ ghi nối tiếp; mỗi record nhận một **offset** tuần tự trong partition đó.

[ANALYSIS] Nhiều partition hơn có thể tăng parallelism cho consumer, nhưng cũng tăng overhead vận hành, gồm số file mở và công việc rebalance. Một partition được lưu trong một directory chứa các segment file; bản thảo nguồn dùng khoảng 1 GB làm ví dụ cho kích thước segment.

[PROPOSED DESIGN] Lệnh sau tạo topic `orders` với 50 partition và replication factor bằng 3. Đây chỉ là ví dụ khởi đầu, không phải quy tắc sizing:

```bash
kafka-topics --create --topic orders --partitions 50 --replication-factor 3 \
  --bootstrap-server broker-1:9092
```

[SOURCE FACT] Mỗi partition có một leader và `RF - 1` follower. Với 50 partition và replication factor bằng 3, topic có 150 replica assignment được phân bổ trên các broker.

**Q2. Producer, consumer và consumer group là gì?**

[SOURCE FACT] Producer append record vào topic. Consumer trong một **consumer group** được assign một tập con partition của group đó. Với 12 partition và 4 consumer, một assignment cân bằng sẽ cho mỗi consumer 3 partition. Consumer thứ năm không thể nhận partition đang được assign hết, nên sẽ ở trạng thái idle.

`group.id` xác định group mà các member cùng chia sẻ công việc:

```java
props.put(ConsumerConfig.GROUP_ID_CONFIG, "orders-service"); // các instance cùng ID chia sẻ partition
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
```

[SOURCE FACT] Hai group khác nhau có thể đọc cùng một topic độc lập. Mỗi group giữ offset riêng và có thể tiến triển theo tốc độ riêng.

**Q3. `acks` là gì và vì sao quan trọng?**

[SOURCE FACT] `acks=0` yêu cầu producer không chờ broker acknowledge. `acks=1` chờ partition leader acknowledge; dữ liệu có thể mất nếu leader hỏng trước khi record được replicate. `acks=all` chờ các in-sync replica (ISR) acknowledge, nên là lựa chọn có durability mạnh nhất trong ba mức này nhưng phải trả thêm latency.

[ANALYSIS] Chênh lệch latency cụ thể phụ thuộc vào network, disk, tải broker, replication và cấu hình client. Các con số 2–5 ms so với 20–50 ms trong bản thảo nguồn phụ thuộc workload, không nên xem là benchmark chung.

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true"); // giữ thứ tự khi retry và tránh duplicate từ producer
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "30000"); // khoảng thời gian giao ví dụ
```

[SOURCE FACT] Leader chỉ có thể acknowledge một write `acks=all` sau khi record đáp ứng điều kiện replication được biểu diễn bởi ISR hiện tại. Chờ acknowledgement này khác với việc giả định rằng replication đã thành công.

**Q4. Keyed message là gì và vì sao dùng?**

[SOURCE FACT] Kafka dùng record key để định tuyến các record có cùng key vào cùng một partition. Default partitioner của Java producer dùng murmur2 hash cho keyed record. Điều này tạo ordering trong partition đó, và do đó tạo per-key ordering khi key được giữ ổn định. Record không có key không có guarantee ordering theo key; từ Kafka 2.4, hành vi mặc định của producer có thể dùng sticky partitioner để lấp đầy một batch trước khi chuyển sang partition khác.

```java
// Cùng key -> cùng partition -> giữ thứ tự cho key đó.
producer.send(new ProducerRecord<>("orders", user.getId(), orderEvent));
```

[ANALYSIS] Keying đánh đổi khả năng phân phối linh hoạt để lấy ordering. Một hot key, chẳng hạn một user có lưu lượng lớn bất thường, có thể dồn traffic vào một partition và tạo skew. Key nên phản ánh đúng ranh giới ordering mà ứng dụng cần.

**Q5. Queue khác Kafka log như thế nào?**

[SOURCE FACT] Queue truyền thống thường xóa hoặc acknowledge message khi message được consume. Kafka là append-only log: mỗi consumer group đọc từ offset riêng, còn record bị xóa theo **retention**, không đơn giản chỉ vì đã được đọc.

[PROPOSED DESIGN] Bản thảo nguồn dùng 7 ngày làm thời gian retention minh họa:

```bash
kafka-configs --alter --entity-type topics --entity-name orders \
  --add-config retention.ms=604800000   # giá trị 7 ngày để minh họa
```

[ANALYSIS] Nếu topic ghi 10 GB mỗi ngày và giữ 7 ngày, dữ liệu raw được giữ lại khoảng 70 GB trước replication, index và overhead lưu trữ khác. Đây là phép tính capacity minh họa, không phải cam kết capacity.

**Q6. Consumer group làm gì khi một member crash?**

[SOURCE FACT] Khi một member rời group, partition của nó được assign lại cho các member còn sống trong một đợt **rebalance**. Các member có thể tạm dừng fetch record trong lúc rebalance hoàn tất. Rebalance xảy ra thường xuyên có thể làm giảm throughput, đặc biệt khi nguyên nhân là poll chậm hoặc heartbeat bị bỏ lỡ.

[ANALYSIS] `session.timeout.ms` quy định coordinator chờ heartbeat trong bao lâu trước khi coi member đã chết. `heartbeat.interval.ms` quy định tần suất heartbeat. `max.poll.interval.ms` giới hạn thời gian giữa các lần gọi `poll()` thành công trước khi member bị coi là không thể tiến triển. Bản thảo nguồn nêu 45 giây là session timeout mặc định từ Kafka 2.3; cần kiểm tra default theo phiên bản Kafka và deployment. Các giá trị sau là ví dụ từ bản thảo nguồn:

```java
props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, "45000");
props.put(ConsumerConfig.HEARTBEAT_INTERVAL_MS_CONFIG, "3000");
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, "300000");
```

**Q7. Committed offset được lưu ở đâu?**

[SOURCE FACT] Committed consumer offset được lưu trong internal compacted topic của Kafka là `__consumer_offsets`, không nằm trên process consumer. `commitSync()` ghi vị trí của group vào đó. Sau khi restart, group có thể tiếp tục từ committed position nếu offset đó vẫn còn khả dụng.

[SOURCE FACT] Bản thảo nguồn nêu 50 partition là default của `__consumer_offsets` và 7 ngày là giá trị mặc định của `offsets.retention.minutes`. Default có thể khác theo phiên bản Kafka và deployment, nên cần kiểm tra trên cluster đang chạy.

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
```

[ANALYSIS] Nếu group bị empty đủ lâu để committed offset hết hạn, consumer sẽ fallback về `auto.offset.reset` thay vì vị trí cũ. Đây là một tình huống dễ gây bất ngờ khi group ngừng hoạt động trong thời gian dài.

**Q8. Serializer là gì và có thể lỗi ở đâu?**

[SOURCE FACT] Broker lưu key và value của record dưới dạng bytes. Serializer và deserializer là contract ở phía client: hai đầu phải thống nhất encoding. Các lựa chọn thường gặp gồm string cho key hoặc value, JSON cho value, và Avro cùng Schema Registry khi cần quản lý và tiến hóa schema.

Với JSON consumer của Spring Kafka, cấu hình sau minh họa việc cho phép package và chọn kiểu value được mong đợi:

```java
props.put(JsonDeserializer.TRUSTED_PACKAGES, "com.acme.orders.*");
props.put(JsonDeserializer.VALUE_DEFAULT_TYPE, OrderEvent.class);
```

[ANALYSIS] Nếu producer dùng `StringSerializer` nhưng consumer chờ JSON, deserialization có thể fail với mọi record bị ảnh hưởng. Consumer sẽ không tiến triển hữu ích cho đến khi incompatibility được sửa hoặc record được đưa qua error path rõ ràng.

**Q9. `bootstrap.servers` thực sự dùng để làm gì?**

[SOURCE FACT] `bootstrap.servers` cung cấp địa chỉ broker ban đầu cho metadata handshake. Sau khi nhận metadata, client kết nối tới leader của partition cần dùng. Một broker có thể đủ để bootstrap nếu truy cập được, nhưng phụ thuộc vào một địa chỉ tạo ra một dependency về availability không cần thiết.

[PROPOSED DESIGN] Khai báo nhiều broker để initial metadata request vẫn có thể thành công khi một broker không khả dụng:

```java
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG,
    "broker-1:9092,broker-2:9092,broker-3:9092");
props.put(ProducerConfig.METADATA_MAX_AGE_CONFIG, "300000"); // ví dụ interval refresh metadata
```

[SOURCE FACT] Client định kỳ refresh metadata. Giá trị 300000 ms là ví dụ năm phút trong bản thảo nguồn; đây là refresh interval, không phải cam kết rằng mọi thay đổi topology sẽ bị che khuất cho đến thời điểm đó.
