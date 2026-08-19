---
title: "Ôn thi Java #5: Apache Kafka — Junior đến Senior"
description: "Hệ thống hướng sự kiện với Kafka: semantics giao nhận, replication, partitioning để đảm bảo thứ tự, consumer lag và dead-letter queue mà mọi consumer production đều cần. Bao gồm code producer/consumer và các số liệu thực tế."
pubDatetime: 2026-08-10T10:20:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - kafka
  - event-driven
---

Kafka là chủ đề phân biệt câu "tôi đã gửi một message" với câu "tôi hiểu distributed log". Junior biết produce và consume; senior biết phân tích thứ tự, exactly-once và điều gì xảy ra khi consumer tụt hậu, với config và code để chứng minh. Bài viết đi từ topic đến delivery guarantee rồi đến lag ở quy mô lớn: 50 câu hỏi, hãy chọn đúng level bạn đang phỏng vấn và đọc thêm một level cao hơn.

> Mindset: junior gửi một record và hy vọng nó đến nơi; senior giải thích chính xác "đến nơi" có nghĩa gì và đã xây dựng gì để một poison message không bao giờ quật ngã pipeline.

## Junior — nền tảng

**Q1. Topic, partition, và offset là gì?**
Topic là một log có tên, được chia thành các **partition** — những log có thứ tự và chỉ ghi nối tiếp. Mỗi record nhận một **offset** tuần tự trong partition của nó. Nhiều partition hơn đồng nghĩa với nhiều parallelism hơn, nhưng cũng có nhiều file đang mở hơn (mỗi partition là một directory chứa các segment file khoảng 1 GB) và thời gian rebalance dài hơn một chút. Một topic có 50 partition trên cluster 3 broker là điểm khởi đầu hợp lý:

```bash
kafka-topics --create --topic orders --partitions 50 --replication-factor 3 \
  --bootstrap-server broker-1:9092
```

Mỗi partition có một leader và (RF−1) follower; 50 partition × RF 3 = 150 replica assignment được phân bổ trên các broker.

**Q2. Producer vs consumer, và consumer group?**
Producer append vào topic; consumer trong **consumer group** được độc quyền xử lý một tập con partition. Với 12 partition và 4 consumer, mỗi consumer xử lý 3 partition. Thêm consumer thứ 5 thì một consumer sẽ không có việc, vì không thể có nhiều active consumer hơn số partition. `group.id` là thứ giúp Kafka scale ngang: mọi instance cùng ID sẽ chia sẻ tải:

```java
props.put(ConsumerConfig.GROUP_ID_CONFIG, "orders-service"); // mọi instance cùng chia các partition
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
```

Hai group khác nhau đọc cùng một topic hoàn toàn độc lập: mỗi group giữ offset riêng và đọc theo tốc độ riêng.

**Q3. `acks` là gì và tại sao quan trọng?**
`acks=0` (fire-and-forget, gần như không có đảm bảo), `acks=1` (leader acknowledge; có thể mất dữ liệu nếu leader chết trước khi kịp replicate), và `acks=all` (mọi in-sync replica cùng acknowledge; mạnh nhất nhưng latency cao hơn khoảng 2–5 lần: ~20–50 ms so với ~2–5 ms). Đây là đánh đổi giữa durability và latency, thể hiện bằng số liệu:

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true"); // không duplicate khi retry
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "30000"); // thử trong bao lâu thì bỏ cuộc
```

Leader chỉ có thể báo cho follower "commit" sau khi record đã nằm trong log của mọi member ISR; `acks=all` nghĩa là bạn chờ quyết định đó thay vì phỏng đoán.

**Q4. Keyed message là gì và tại sao dùng?**
Một key định tuyến mọi record có cùng key về **cùng partition** (bằng murmur2 hash), nhờ đó đảm bảo **per-key ordering**. Record không có key được phân phối theo round-robin (từ Kafka 2.4, sticky partitioner gom record vào một batch trước khi chuyển sang partition khác), nên không có đảm bảo về thứ tự:

```java
// cùng key -> cùng partition -> đúng thứ tự. Tối quan trọng cho "mọi event của user 42 theo thứ tự"
producer.send(new ProducerRecord<>("orders", user.getId(), orderEvent));
```

Hệ quả mà interviewer thường đào sâu là vấn đề hot key: một hot key (chẳng hạn user nổi tiếng) làm một partition bị quá tải. Keying mang lại thứ tự, nhưng phải đánh đổi bằng skew.

**Q5. Queue vs Kafka log?**
Queue xóa message sau khi được consume; Kafka là append-only log. Mỗi consumer đọc lịch sử từ offset riêng, còn message hết hạn theo **retention** (ví dụ 7 ngày), chứ không phải khi được đọc. Retention 7 ngày với lượng ghi 10 GB/ngày nghĩa là bạn phải dự trù khoảng 70 GB disk cho mỗi topic:

```bash
kafka-configs --alter --entity-type topics --entity-name orders \
  --add-config retention.ms=604800000   # 7 ngày, tính bằng mili giây
```

Đó cũng là lý do "ai đã đọc nó?" là câu hỏi sai đối với Kafka: log giữ record cho đến khi retention xóa nó, bất kể record đã được consume hay chưa.

**Q6. Consumer group làm gì khi crash?**
Khi một member chết, partition của nó được **reassigned** cho các member còn lại trong một đợt rebalance. Trong thời gian đó, mọi member của group tạm dừng consume. Rebalance thường xuyên, thường do poll hoặc heartbeat bị chậm, khiến throughput sụt mạnh. Ba thiết lập quyết định bạn có bị loại khỏi group hay không:

```java
props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, "45000");    // mặc định 45 s từ Kafka 2.3
props.put(ConsumerConfig.HEARTBEAT_INTERVAL_MS_CONFIG, "3000");  // phải nhỏ hơn timeout nhiều
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, "300000"); // 5 phút để xong một poll cycle
```

**Q7. Offset đã commit được lưu ở đâu?**
Offset đã commit được lưu trong một internal compacted topic tên `__consumer_offsets` (mặc định 50 partition), không phải trên consumer. Mỗi `commitSync()` ghi vào topic này; khi restart, group tiếp tục từ đó. Một lệnh cho thấy trạng thái group, offset của từng partition và lag:

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
```

Cạm bẫy: offset hết hạn sau `offsets.retention.minutes` (mặc định 7 ngày) nếu group bị bỏ trống quá lâu. Khi đó, một group im lặng lâu ngày sẽ quay về `auto.offset.reset` thay vì tiếp tục từ vị trí cũ.

**Q8. Serializer là gì và chúng hỏng ở đâu?**
Broker chỉ lưu bytes; serializer là hợp đồng phía client. String cho key, JSON/`String` cho value, Avro + Schema Registry cho schema tiến hóa. Crash 3 giờ sáng kinh điển: một JSON consumer không có `trusted.packages` từ chối mọi record do service khác produce:

```java
props.put(JsonDeserializer.TRUSTED_PACKAGES, "com.acme.orders.*");
props.put(JsonDeserializer.VALUE_DEFAULT_TYPE, OrderEvent.class);
```

Serializer và deserializer hai đầu phải khớp — writer dùng `StringSerializer` mà reader dùng JSON thì mọi record đều ném `JsonMappingException` và group tụt hậu.

**Q9. `bootstrap.servers` thực sự dùng để làm gì?**
Nó chỉ liệt kê broker cho **metadata handshake** ban đầu — sau đó client kết nối thẳng tới leader của từng partition. Một broker về lý thuyết là đủ; bạn liệt kê 3+ để metadata fetch sống sót khi một broker chết, và client re-fetch metadata mỗi 5 phút:

```java
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "broker-1:9092,broker-2:9092,broker-3:9092");
props.put(ProducerConfig.METADATA_MAX_AGE_CONFIG, "300000"); // re-fetch bố cục partition mỗi 5 phút
```

Đó là lý do việc tăng partition phát huy tác dụng trong ~5 phút: client học về partition mới ở lần refresh metadata kế tiếp.

**Q10. Partitioner hoạt động thế nào, và bạn thay nó được không?**
**DefaultPartitioner** hash key bằng **murmur2** rồi mod theo số partition — cùng key, cùng partition, deterministic. Key null được **sticky partitioning** (Kafka 2.4+): record dồn vào một batch mỗi partition thay vì round-robin, nâng hiệu quả batching. Routing tùy chỉnh (shard hot key, cố định tenant vào dải partition) implement `Partitioner`:

```java
public class TenantPartitioner implements Partitioner {
  public int partition(String topic, Object key, byte[] keyBytes, Object value,
                       byte[] valueBytes, Cluster cluster) {
    return Math.abs(key.toString().hashCode()) % cluster.partitionCountForTopic(topic);
  }
}
props.put(ProducerConfig.PARTITIONER_CLASS_CONFIG, TenantPartitioner.class.getName());
```

Cảnh báo: đổi partitioner giữa chừng là re-route key giữa stream — guarantee thứ tự của bạn đổi theo nó.

**Q11. `consumer.poll()` thực sự làm gì?**
`poll()` gộp heartbeat, fetch và rebalance engine vào một lần gọi. Nó trả về tối đa `max.poll.records` (mặc định 500) và phải tiếp tục được gọi ngay cả khi consumer đang rảnh. Vòng lặp chuẩn là:

```java
while (running) {
  ConsumerRecords<String, Order> records = consumer.poll(Duration.ofMillis(100));
  for (ConsumerRecord<String, Order> r : records) process(r);
  consumer.commitSync(); // offset chỉ tiến ở đây
}
```

Spring Kafka bọc vòng lặp này trong `KafkaMessageListenerContainer` — method `@KafkaListener` của bạn chạy bên trong nó, chính là lý do một method chậm làm vấp `max.poll.interval.ms`.

**Q12. Producer batching hoạt động thế nào, và các núm chỉnh?**
`send()` không chạm tới network ngay lập tức. Record được đưa vào `RecordAccumulator` (`buffer.memory`, mặc định 32 MB) và được gửi theo batch `batch.size` (mặc định **16 KB**) sau `linger.ms` (mặc định 0). Tăng `linger.ms` lên 5–10 ms là cách đổi vài mili giây latency lấy throughput cao hơn 3–5× nhờ các batch đầy hơn:

```java
props.put(ProducerConfig.BATCH_SIZE_CONFIG, "16384");       // 16 KB mặc định
props.put(ProducerConfig.LINGER_MS_CONFIG, "10");           // chờ tối đa 10 ms cho batch đầy hơn
props.put(ProducerConfig.BUFFER_MEMORY_CONFIG, "67108864"); // accumulator 64 MB
```

Ở 1M msg/s × 500 B, lưu lượng là 500 MB/s record. Với batch 16 KB, đó là khoảng 31k batch/s — lúc này giới hạn nằm ở tốc độ append của broker, không phải CPU của bạn.

**Q13. `auto.offset.reset` là gì và khi nào nó quan trọng?**
Một group mới toanh chưa có offset đã commit, nên broker chọn điểm bắt đầu: `earliest` (toàn bộ lịch sử trong retention), `latest` (mặc định — chỉ record mới), hoặc `none` (fail nếu không có offset). Đó là quyết định một lần cho mỗi group, thầm lặng quyết định deployment mới ngốn bao nhiêu backlog:

```java
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest"); // xử lý lại tới 7 ngày lịch sử
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "latest");   // bỏ qua backlog, bắt đầu mới
```

`kafka-console-consumer --from-beginning` là bản CLI của earliest. Chọn sai là lý do consumer mới "bỏ lỡ" event — hoặc kích hoạt lại cả tháng side effect.

**Q14. Broker là gì, và cluster metadata sống ở đâu?**
Broker là một server giữ các partition leader + follower; một broker kiêm luôn **controller**, bầu partition leader và theo dõi membership. Metadata store của Kafka từng là ZooKeeper; từ Kafka 3.x **KRaft** thay nó bằng một controller quorum nội bộ dựa trên Raft, và Kafka 4.0 bỏ ZooKeeper hoàn toàn:

```bash
# KRaft: sinh cluster id, format storage, chạy — không còn ZooKeeper ở bất kỳ đâu
kafka-storage random-uuid > /tmp/cluster-id
kafka-storage format -t "$(cat /tmp/cluster-id)" -c config/kraft/server.properties
kafka-server-start config/kraft/server.properties
```

Về mặt phỏng vấn: ZooKeeper là từ vựng của quá khứ; KRaft (Raft, controller quorum) là câu trả lời hiện tại.

**Q15. Partition leader được bầu thế nào?**
Mỗi partition có một **leader** (mọi đọc ghi) với các follower replicate theo. Khi leader chết, controller chọn leader mới **từ ISR** — một follower tụt sau ISR không thể thành leader, bảo vệ khỏi việc cắt mất record chưa commit. `unclean.leader.election.enable=false` (mặc định) nghĩa là bạn chọn durability hơn availability khi mọi member ISR đều mất:

```bash
kafka-leader-election --bootstrap-server broker-1:9092 --topic orders \
  --partition 12 --election-type preferred
```

Bầu cử **preferred** trả quyền lãnh đạo về assignment gốc để tải dàn đều lại sau khi broker quay về.

**Q16. Trong một `ProducerRecord` có gì — key, value, headers, timestamp?**
Mỗi record là một key (routing), value (payload), timestamp (mặc định là lúc tới broker), và headers (trace id, schema version, correlation id). Headers đi cùng record và là cách rẻ để trace một order qua năm service:

```java
ProducerRecord<String, OrderEvent> record = new ProducerRecord<>(
    "orders", 2, System.currentTimeMillis(),   // topic, partition, timestamp
    order.getId(), order,                       // key, value
    new RecordHeaders().add("traceparent", traceBytes));
producer.send(record);
```

Một header `traceparent` là cách bạn theo một request qua produce → consume → produce mà không cần parse payload.

**Q17. Session timeout vs poll interval — cái nào đá bạn ra?**
Hai bộ đếm giờ độc lập đẩy bạn khỏi group. `session.timeout.ms` (mặc định 45 s) nổ khi **background heartbeat thread** lỡ nhịp heartbeat (gửi mỗi 3 s) — broker mất, hoặc một GC pause dài hơn 45 s. `max.poll.interval.ms` (mặc định 5 phút) nổ khi xử lý một batch poll mất quá lâu — bạn còn sống nhưng không tiến triển. Handler chậm vấp cái thứ hai; instance chết vấp cái thứ nhất:

```java
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, "600000"); // 10 phút cho handler chậm
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "100");        // batch nhỏ hơn -> vòng lặp nhanh hơn
```

Kinh nghiệm: thời gian xử lý một batch × `max.poll.records` phải nằm gọn trong `max.poll.interval.ms`, không thì group đá bạn giữa deploy.

## Mid — đánh đổi & cạm bẫy

**Q18. Ba delivery semantics.**

- **At-most-once**: `acks=0`; có thể mất, không duplicate.
- **At-least-once**: `acks=all` + retry; không mất, có thể duplicate (crash sau process, trước commit).
- **Exactly-once**: idempotent producer + transactional write, hoặc Kafka transaction; consumer phải chọn `read_committed`:

```java
props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed"); // chỉ thấy record txn đã commit
```

Hầu hết team dừng ở at-least-once + idempotent sink — rẻ hơn transaction và thường là đủ.

**Q19. Per-key ordering và thứ gì phá nó.**
Key → cùng partition → đúng thứ tự. Phá khi bạn đổi partition count (rehash chuyển key sang partition mới giữa stream) hoặc khi reassignment. Ordering là per-partition, không bao giờ global, trừ khi bạn có một partition (thì mất parallelism):

```bash
kafka-topics --alter --topic orders --partitions 60   # key được xáo lại NGAY BÂY GIỜ
```

Mọi record của một key vẫn về một partition, nhưng partition nào — và thứ tự tương đối giữa record viết trước/sau khi mở rộng — có thể đổi.

**Q20. Consumer lag và tại sao phải monitor.**
Lag = đã produce-nhưng-chưa-consumed (high-water-mark offset trừ committed offset). Ở 10k msg/s với consumer làm 20 ms mỗi batch 500, lag giữ gần zero; nếu processing trượt xuống 200 ms/batch, lag tăng hàng nghìn/giây và có thể vượt retention 7 ngày — **data loss vĩnh viễn cho consumer chậm**:

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
#  TOPIC  PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
#  orders 0          482130          482210          80
```

Theo dõi cột LAG từng partition, không chỉ tổng của group — một hot partition nấp sau một con số trung bình trông khỏe mạnh.

**Q21. Idempotent production.**
`enable.idempotence=true` cho producer một PID + sequence number; broker deduplicate batch được retry, nên một retry sau timeout mà thực ra đã commit không thể double-write. Ghép với keyed partitioning cho retry có thứ tự an toàn:

```java
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true"); // yêu cầu acks=all, retries>0
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, "5"); // ≤5 cho idempotence
```

Idempotence dedupe theo từng producer instance và epoch — nó không phủ hai producer khác nhau ghi cùng dữ liệu; việc đó cần dedupe ở tầng ứng dụng (Q34).

**Q22. Rebalance — làm chúng rẻ.**
Tune `max.poll.interval.ms` (mặc định 5 phút) và `max.poll.records` (mặc định 500) để một batch chậm không trigger timeout rebalance. Ưu tiên incremental **cooperative** rebalancing (Kafka 2.4+) hơn eager rebalancing stop-the-world:

```java
props.put(ConsumerConfig.PARTITION_ASSIGNMENT_STRATEGY_CONFIG,
    CooperativeStickyAssignor.class.getName());
```

Cooperative rebalancing chỉ thu hồi các partition phải di chuyển thay vì cả group — khác biệt giữa một cú dừng 30 s và một cú giật 2 s trên topic 50 partition.

**Q23. Replication và ISR.**
Mỗi partition có leader + follower; tập **in-sync replica (ISR)** là các follower bắt kịp trong `replica.lag.time.max.ms` (mặc định 30 s). Với `min.insync.replicas=2` và `replication.factor=3`, bạn sống sót mất một broker không mất data. Nếu hai broker chết, partition đó unavailable (durability over availability):

```java
props.put("min.insync.replicas", "2"); // với replication.factor=3
```

```bash
kafka-topics --describe --topic orders   # cột ISR: replica tụt sau leader sẽ bị loại
```

Đánh đổi phải bảo vệ được: nếu ISR co xuống dưới `min.insync.replicas`, producer nhận `NotEnoughReplicasException` — bạn đã chọn durability, và write bị từ chối thay vì bán replication nửa vời.

**Q24. commitSync vs commitAsync, và thứ tự commit.**
Offset phải được commit **sau khi** xử lý xong, không bao giờ trước — và `enable.auto.commit=true` (mặc định đấy!) commit ở `poll()` kế tiếp mỗi `auto.commit.interval.ms` (5 s), nên crash trong khoảng đó replay record (at-least-once). Commit _trước_ khi xử lý thì mất vĩnh viễn. Pattern production:

```java
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false"); // commit là quyết định CỦA TÔI
while (running) {
  ConsumerRecords<String, Order> records = consumer.poll(Duration.ofMillis(100));
  process(records);          // side effect TRƯỚC
  consumer.commitSync();     // rồi mới ghi nhận tiến trình — không bao giờ đảo thứ tự
}
```

`commitSync` retry và block (đúng); `commitAsync` fire-and-forget (nhanh, có thể rớt commit). Hybrid tệ nhất: async commit rồi shutdown ngay — commit cuối biến mất và group replay lại chúng.

**Q25. Một record 2 MB và pipeline của bạn chết. Tại sao?**
Broker từ chối record lớn hơn `message.max.bytes` (mặc định **1 MB**) bằng `RecordTooLargeException`, và `max.request.size` của producer cũng mặc định 1 MB — send fail trước khi rời máy. Để chở payload lớn bạn phải nâng cả ba phía:

```java
props.put(ProducerConfig.MAX_REQUEST_SIZE_CONFIG, "10485760");      // producer: 10 MB
props.put(ConsumerConfig.FETCH_MAX_BYTES_CONFIG, "10485760");       // consumer: 10 MB
// broker: kafka-configs --alter --entity-type brokers --entity-default \
//   --add-config message.max.bytes=10485760
```

Câu trả lời kỹ thuật tốt hơn: JSON blob 2 MB thuộc về object store — một URL trong record giữ Kafka ở 1 MB và consumer nhanh.

**Q26. Compression: tại sao, và codec nào?**
Compression xảy ra từng batch **phía client**, nên nó đi cặp với `linger.ms` — batch càng to nén càng hiệu quả. zstd (Kafka 2.1+) thắng về tỷ lệ (~2–3×), snappy/lz4 thắng về CPU; cái giá là ~5–10% CPU producer:

```java
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd"); // none | gzip | snappy | lz4 | zstd
```

Ở 1M msg/s × 500 B ≈ 500 MB/s ≈ 4 Gbps — trên NIC 1 Gbps đó là bốn đường mạng. zstd ~3× hạ còn ~1.4 Gbps, vừa một cặp. Consumer giải nén trong suốt; giữ `compression.type` nhất quán cho từng topic.

**Q27. `subscribe` vs `assign` — khi nào assignment thủ công là đúng?**
`subscribe()` tham gia một group: rebalancing, cooperative assignment, offset dùng chung. `assign()` tự nắm partition — không group, không rebalance, không ai dời partition của bạn giữa job, và cũng không ai commit hộ bạn:

```java
consumer.subscribe(List.of("orders"));            // group quản lý; rebalance khi membership đổi
consumer.assign(List.of(new TopicPartition("orders", 3))); // thủ công — bạn sở hữu partition 3, chấm hết
```

Mặc định dùng `subscribe`; `assign` cho các utility (một replayer dùng một lần, một lag dumper, một test consumer) mà không được phép bị rebalance đi mất.

**Q28. `@KafkaListener` của Spring Kafka thực sự chạy thế nào?**
Method `@KafkaListener` chạy bên trong một `ConcurrentMessageListenerContainer`; `concurrency` = số consumer instance trong group, và `ackMode` quyết định khi nào container commit hộ bạn:

```java
@Bean
public ConcurrentKafkaListenerContainerFactory<String, Order> kafkaListenerContainerFactory(
    ConsumerFactory<String, Order> cf) {
  ConcurrentKafkaListenerContainerFactory<String, Order> f =
      new ConcurrentKafkaListenerContainerFactory<>();
  f.setConsumerFactory(cf);
  f.setConcurrency(4);                                        // 4 consumer, 4 partition cùng lúc
  f.getContainerProperties().setAckMode(ContainerProperties.AckMode.BATCH);
  return f;
}

@KafkaListener(topics = "orders", groupId = "orders-service")
public void onOrders(List<Order> orders) {                    // batch listener
  orders.forEach(this::apply);
}
```

Cạm bẫy: `concurrency` cao hơn số partition thì thread ngồi không; thấp hơn thì partition ngồi không — cùng định luật Q2, giờ bằng từ vựng Spring.

**Q29. Static membership — vì sao restart không nên rebalance.**
Khi rolling deploy, mỗi lần restart trigger một rebalance làm cả group nghẽn vài giây; với 50 partition đó là viết lại toàn bộ map assignment cho từng pod. **Static membership** (`group.instance.id`, Kafka 2.3+) bảo broker "cùng member, chỉ đang reconnect", nên restart bỏ qua rebalance hoàn toàn:

```java
props.put(ConsumerConfig.GROUP_INSTANCE_ID_CONFIG, "orders-service-" + hostname); // unique mỗi instance
```

Id phải unique mỗi instance và ổn định qua các lần restart — tên pod của Kubernetes StatefulSet là nguồn hoàn hảo.

**Q30. `read_committed` vs `read_uncommitted`.**
Transactional producer ghi record mà consumer hoặc thấy hoặc lọc. `read_uncommitted` (mặc định) giao cả record đã commit **lẫn đã abort**; `read_committed` chỉ giao record đã commit và cắt record aborted khỏi batch fetch:

```java
props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
```

Cái giá: record trong transaction đang mở bị giấu tới khi commit, nên consumer lag theo độ dài transaction — hãy chặn nó bằng `transaction.timeout.ms` (mặc định 60 s) thay vì phát hiện ra một khoảng trống 15 phút.

**Q31. Rebalance strategies: range, sticky, cooperative sticky.**
`RangeAssignor` (mặc định cũ) assign theo từng topic và lệch khi nhiều topic; `StickyAssignor` giữ assignment cũ ở mức có thể; `CooperativeStickyAssignor` (2.4+) gộp stickiness với cooperative protocol chỉ thu hồi thứ phải di chuyển:

```java
props.put(ConsumerConfig.PARTITION_ASSIGNMENT_STRATEGY_CONFIG,
    List.of(CooperativeStickyAssignor.class.getName()));
```

Với eager rebalancing, mỗi lần membership đổi là stop-the-world cả group; cooperative thu nhỏ chỉ còn các partition bị dời. Với topic 50 partition, đó là khác biệt giữa ~30 s nghẽn và ~2 s giật mỗi lần deploy.

**Q32. Producer retry: thứ gì thực sự giới hạn chúng?**
`retries` mặc định gần như vô hạn (2,147,483,647) nhưng bị chặn theo _thời gian_ bởi `delivery.timeout.ms` (mặc định 120 s); mỗi lần thử chờ `retry.backoff.ms` (100 ms). Idempotence đòi `retries > 0` và `max.in.flight.requests.per.connection ≤ 5`:

```java
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "30000"); // bỏ cuộc sau 30 s, không phải 2 phút
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, "5");
```

Cái bẫy: một batch retry mà lần thử đầu thực ra đã commit chính là thứ idempotence dedupe (PID + sequence). Không có nó, một batch retry có thể duplicate tới `batch.size` record.

**Q33. Reset consumer group để reprocess thế nào?**
Reprocessing = dời offset đã commit của group. CLI reset về earliest/latest/một mốc thời gian/độ dịch và thậm chí export-import cả bản đồ:

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --group orders-service \
  --reset-offsets --to-datetime 2026-08-10T00:00:00.000 --execute --all-topics
```

Luật an toàn: quiesce pipeline trước, không thì bạn replay cả event mới; xác nhận consumer idempotent (Q34); và ưu tiên `--to-datetime` hơn `--to-earliest` để chỉ replay cửa sổ lỗi — không phải 7 ngày retention.

**Q34. Dedupe phía consumer: at-least-once nghĩa là duplicate.**
Cùng một record có thể tới hai lần (producer retry, crash giữa process và commit). Sink phải dedupe: một idempotency key (record key + offset) với unique constraint biến "xử lý hai lần" thành "lần hai là no-op":

```java
try {
  jdbc.update("INSERT INTO processed_events(idempotency_key, payload) VALUES (?, ?)",
              key(record), serialize(record));
} catch (DuplicateKeyException e) {
  log.info("duplicate, skipping: {}", record.offset()); // replay = no-op
}
```

Đây là pattern làm cho retention replay, DLQ replay, và consumer restart đều an toàn — không có nó, mỗi replay là một ván cược double side effect.

## Senior — thiết kế & phòng thủ

**Q35. Consumer crash trên một message xấu (poison pill). Thiết kế xử lý.**
"Không bao giờ để một record quật ngã pipeline. Catch processing exception, publish record lỗi sang **dead-letter topic** kèm error context, rồi `ack` bản gốc để consumer tiến lên. Một monitor riêng alert trên DLQ. Cho lỗi retryable dùng retry topic với exponential backoff:"

```java
try {
  processor.handle(record);
  consumer.commitSync();           // ack chỉ sau khi thành công
} catch (PoisonMessageException e) {
  deadLetterProducer.send(new ProducerRecord<>("orders-dlq", record.key(), record.value()));
  consumer.commitSync();           // acknowledge để KHÔNG retry vô hạn
} catch (RetryableException e) {
  // route sang orders-retry với backoff; đừng ack
}
```

"Spring Kafka cho thứ này miễn phí — một `DefaultErrorHandler` với backoff và dead-letter recoverer:"

```java
@Bean
public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, Order> template) {
  var recoverer = new DeadLetterPublishingRecoverer(
      template, r -> new TopicPartition("orders-dlq", r.partition()));
  return new DefaultErrorHandler(recoverer, new FixedBackOff(1_000L, 3)); // 3 lần, cách 1 s, rồi DLQ
}
```

"Nguyên tắc: một poison message phải đẩy pipeline tiến lên, không phải dừng nó."

**Q36. Bạn cần global ordering của 1M events/sec. Làm gì?**
"Global ordering = một partition = một consumer = bạn đã giết throughput (trần single-partition ~hàng chục nghìn msg/s). Tôi sẽ thách thức requirement: gần như luôn luôn là thứ tự _per-entity_ (per-order, per-user), thứ keying cho ở full parallelism — 1M msg/s rải 50 partition, mọi key đều đáp đúng một partition. Nếu global order thực sự bắt buộc, tôi chấp nhận trần single-partition và cân nhắc lại việc Kafka có fit không — một total-order requirement đi ngược thiết kế của nó."

**Q37. Consumer lag vọt lên 2M trong lúc deploy. Chẩn đoán.**
"Đầu tiên, spike tương quan với rebalance từ rolling deploy — consumer dừng, lag tích lũy, rồi resume. Nếu lag không drain, consumer giờ chậm hơn produce rate (một synchronous call mới trong handler). Tôi check lag từng partition (một hot partition = key skew), CPU consumer, và `max.poll.records`/thời gian xử lý:"

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
# nhìn cột LAG từng partition; một giá trị khổng lồ cạnh toàn số 0 = key skew, không phải group chậm
```

"Rồi tính drain: lag 2M ở mức drain 50k msg/s sẽ hết trong ~40 s; nếu drain < produce, lag tăng vô hạn và bạn vượt mép retention 7 ngày. Fix: thêm partition cho hot key, parallelize handling, nâng `max.poll.interval.ms` — và đo drain rate vs produce rate để xác nhận hồi phục."

**Q38. Exactly-once cho flow 'consume DB update + produce event'.**
"At-least-once ngây thơ sẽ double-write khi crash. Lựa chọn: (1) Kafka **transaction** — consume+produce+offset-commit nguyên tử, nên crash thì hoặc commit toàn bộ hoặc rollback. (2) Idempotent sink: ghi DB keyed bằng offset, nên reprocessing là no-op:"

```java
// Atomic: consumer read_committed chỉ thấy transactional write đã commit
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "order-sink-1");
producer.initTransactions();
producer.beginTransaction();
db.update(order, offset);          // side effect
producer.send(event);              // ghi Kafka
producer.sendOffsetsToTransaction(currentOffsets, groupId);
producer.commitTransaction();      // all-or-nothing
```

"Exactly-once là property của _toàn bộ_ pipeline, không phải của producer flag — DB write, topic write, và offset commit phải nằm trong cùng một quyết định."

**Q39. Size partition cho 50k msg/s với 10 consumer thế nào?**
"Throughput mỗi partition bị chặn bởi processing của một consumer (~5–10k msg/s thực tế, 50–100k với batch to). Tôi size partition ≈ `target_consumer_parallelism / single_consumer_throughput × safety` → ~20–30 cho 10 consumer. Quá ít = consumer ngồi không; quá nhiều = file-handle + metadata overhead và rebalance lâu hơn. Tôi validate bằng cách load-test tốc độ consume tối đa của một partition, rồi chia:"

```bash
# ước lượng thô: 50k msg/s ÷ 2.5k msg/s mỗi partition = 20 partition, RF 3 -> 60 replica
kafka-topics --create --topic orders --partitions 20 --replication-factor 3 \
  --bootstrap-server broker-1:9092
```

"Partition cũng là sàn chứ không phải trần — bạn thêm được sau này, nhưng rebalancing và rehash (Q19) có giá."

**Q40. Phòng thủ retention policy và 'data loss' thực sự nghĩa gì.**
"Retention (vd 7 ngày) xóa record cũ hơn mốc đó bất kể consumption — nên một consumer down >7 ngày mất chúng, vĩnh viễn. 'Data loss' trong Kafka thường là do retention, không phải broker failure (RF≥3, `min.insync.replicas=2` sống sót một broker). Tôi đặt retention bằng cửa sổ reprocessing dài nhất hợp lý + buffer, và cho stream critical dùng tiered storage:"

```bash
kafka-configs --alter --entity-type topics --entity-name orders \
  --add-config retention.ms=604800000,local.retention.ms=259200000   # 7 ngày tổng, 3 ngày local
```

"Tôi phòng thủ retention bằng SLA reprocessing, không phải đoán: một consumer hỏng có bao lâu để hồi phục và replay trước khi cửa sổ đóng?"

**Q41. Bạn test consumer Kafka thế nào cho đúng?**
"Deterministic — `@EmbeddedKafka` (spring-kafka-test) boot một broker thật trong process cho integration test, hoặc Testcontainers chạy image thật trong CI. Test các đường failure, không chỉ happy path: một poison record phải đáp DLQ, và crash giữa process và commit phải replay an toàn (nhờ idempotent sink của Q34):"

```java
@EmbeddedKafka(partitions = 3, topics = "orders")
class OrderConsumerTest {
  @Test
  void poisonRecordGoesToDlq() {
    kafkaTemplate.send("orders", "bad", "not-json");
    await().atMost(Duration.ofSeconds(10)).until(() -> !dlqRecords().isEmpty());
    assertThat(dlqRecords()).extracting(r -> r.key()).contains("bad");
  }
}
```

"Tái hiện prod: reset group về một mốc datetime (Q33), replay, và assert không có effect nào bị áp hai lần."

**Q42. Schema evolution: vì sao raw JSON là quả mìn thời gian ở runtime.**
"JSON schema drift là một failure runtime: producer thêm một field, `JsonMappingException` của consumer nổ, và group tụt hậu ở 10k msg/s. Avro + Schema Registry biến compatibility thành **quyết định lúc registration**: schema không tương thích bị từ chối ngay khi bạn đăng ký, trước khi một record xấu nào chạm topic:"

```java
props.put("key.serializer", KafkaAvroSerializer.class);
props.put("value.serializer", KafkaAvroSerializer.class);
props.put("schema.registry.url", "http://schema-registry:8081"); // compatibility được ép ở đây
```

"Compatibility types phải phòng thủ được: BACKWARD (reader mới đọc được data cũ — an toàn cho consumer), FORWARD (reader cũ đọc được data mới — an toàn cho producer), FULL (cả hai). Luật: định hướng tiến hóa trước sự cố, không phải sau."

**Q43. Consumer down 3 giờ; retention 7 ngày. Thiết kế hồi phục.**
"Down 3 giờ ở 10k msg/s ≈ 108M record trong backlog. Đó là bài toán drain, không phải data loss — retention 7 ngày là lưới an toàn. Cây quyết định: consumer idempotent (Q34) thì replay cửa sổ; không thì fast-forward và alert:"

```java
// consumer idempotent: replay cửa sổ lỗi
consumer.seekToBeginning(consumer.assignment());
// không idempotent: bỏ qua backlog, tiếp tục gần hiện tại
consumer.seek(new TopicPartition("orders", 3), committedOffset);
```

"Ở drain 50k msg/s, 108M record hết trong ~36 phút. Câu trả lời senior là cây quyết định — idempotent? replay. Không idempotent? fast-forward + reconcile thủ công. Và không bao giờ replay khi chưa quiesce upstream trước (Q33)."

**Q44. Zombie producer: transactional fencing.**
"Hai instance cùng giữ `transactional.id` (một pod failover còn lảng vảng) không bao giờ được cùng commit. Mỗi `initTransactions()` tăng producer epoch, và instance cũ nhận `ProducerFencedException` — guarantee fencing:"

```java
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "order-sink-" + instanceId); // unique mỗi instance
producer.initTransactions();
while (running) {
  try {
    producer.beginTransaction();
    produce(records);
    producer.sendOffsetsToTransaction(offsets, groupId);
    producer.commitTransaction();
  } catch (ProducerFencedException e) {
    throw new FatalException("fenced by a newer instance — I am the zombie", e); // ngừng ghi
  }
}
```

"Cạm bẫy: một transactional.id dùng chung, không unique trông ổn tới lúc failover — rồi hai writer đánh nhau, và thằng không bị fence cứ double-write tới khi bạn phát hiện. Unique mỗi instance chính là hàng rào."

**Q45. Thiết kế 1M msg/s end-to-end.**
"Goal: 1M msg/s × ~500 B = ~500 MB/s vào, và với RF=3 cluster dịch chuyển ~1.5 GB/s nội bộ. Hiện thực per-partition: một consumer xử lý batch 500 record trong ~10 ms trụ được 50k msg/s, nên tôi cần ~20 consumer; producer batch mạnh để broker thấy ~31k batch/s × 16 KB. Điểm khởi đầu cụ thể — 48 partition, 6 broker, RF 3, zstd:"

```java
props.put(ProducerConfig.BATCH_SIZE_CONFIG, "65536");    // batch 64 KB
props.put(ProducerConfig.LINGER_MS_CONFIG, "10");
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "1000"); // batch to hơn, ít poll cycle hơn
```

"Kiểm tra disk thực tế: 500 MB/s × 7 ngày ≈ 300 TB trước nén, ~100 TB với zstd — retention là quyết định ngân sách lưu trữ, không phải mặc định. Validate bằng load test: phép tính đưa bạn tới 80%, bài test ký duyệt thiết kế."

**Q46. Lag alerting và autoscaling có số liệu.**
"Lag trung bình giấu một hot partition. Monitor lag từng partition và quy đổi thành **backlog time**: lag ÷ produce rate = giây backlog. Ở produce 10k msg/s: alert khi backlog > 300 s (lag 3M) trong 5 phút, page khi > 30 phút (lag 18M):"

```bash
# lag per-partition mới là tín hiệu; max lag, không phải trung bình
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
```

"Spring Boot expose metric `kafka.consumer.*` qua Micrometer; trong Kubernetes, Kafka autoscaler của KEDA scale consumer trực tiếp theo lag. Ngưỡng là một ngân sách: 'tôi chịu được bao nhiêu backlog mà vẫn drain trong SLA?' — rồi alert theo lag, page theo backlog time."

**Q47. DB write + Kafka publish phải nguyên tử — outbox pattern.**
"Bài toán dual-write: một DB commit và một Kafka send không thể nguyên tử qua hai hệ thống — crash giữa chừng = DB đã update, event mất, downstream không bao giờ hay. **Transactional outbox**: ghi event vào bảng outbox _trong cùng transaction DB_, và một relay publish sau khi commit:"

```java
@Transactional
public void placeOrder(Order order) {
  orderRepo.save(order);   // ghi nghiệp vụ
  outboxRepo.save(new OutboxEvent("orders", order.getId(), serialize(order))); // cùng txn
} // cả hai commit hoặc cả hai không — nguyên tử qua DB

// relay: poll bản chưa gửi, gửi, đánh dấu khi thành công (consumer idempotent = retry an toàn)
for (OutboxEvent e : outboxRepo.findUnsent(100)) {
  producer.send(new ProducerRecord<>(e.topic(), e.key(), e.value()));
  outboxRepo.markSent(e.getId());
}
```

"Lựa chọn phải phòng thủ: DB nắm data → outbox; Kafka nắm ordering/offsets → Kafka transaction (Q38). Cạm bẫy: relay outbox retry có thể double-publish — ghép với idempotent sink của Q34."

**Q48. Multi-region replication và disaster recovery.**
"Trong một region, RF=3 rải khắp rack/AZ xử lý tự động việc mất một broker. Xuyên region bạn cần **MirrorMaker 2**, copy topic kèm remapping:"

```bash
kafka-mirror-maker2 --config mm2.properties   # primary -> standby, topic remapping được áp
```

"Phòng thủ semantics: active-standby (một nguồn sự thật, copy async) vs active-active (cả hai produce, conflict phải giải). Mirroring async nghĩa là standby tụt sau vài giây — nếu region primary chết, vài giây record cuối bị mất. RPO = lag mirroring, RTO = thời gian failover (phút: consumer trỏ lại, MM2 tiếp tục). Quyết định ai là nguồn sự thật _trước_ sự cố, và làm consumer idempotent để replay failover không double side effect."

**Q49. Một `@KafkaListener` throw trên một record trong batch. Chuyện gì xảy ra?**
"Với ackMode BATCH không gì được commit, nên Spring re-deliver cả batch — một record xấu kéo record tốt chạy lại. Điều khiển bằng `DefaultErrorHandler`: fixed backoff cho lỗi tạm thời, dead-letter recoverer cho poison, và `setCommitRecovered(true)` để batch đã vào DLQ được commit thay vì lặp vô hạn:"

```java
@Bean
public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, Order> template) {
  DeadLetterPublishingRecoverer dlq = new DeadLetterPublishingRecoverer(
      template, r -> new TopicPartition("orders-dlq", r.partition()));
  DefaultErrorHandler handler = new DefaultErrorHandler(dlq, new FixedBackOff(1_000L, 3));
  handler.setCommitRecovered(true);              // commit sau khi vào DLQ — không lặp vô hạn
  handler.setLogLevel(KafkaException.Level.WARN);
  return handler;                                // nối vào container factory
}
```

"Không bao giờ swallow trong listener mà không có quyết định — retry (tạm thời), DLQ (poison), hoặc fail (SLA). Catch im lặng làm offset tiến qua record và đó là cách mất data êm nhất trong Kafka."

**Q50. Một broker chết và traffic nhân đôi. Thiết kế backpressure.**
"Toán quá tải: traffic nhân đôi thành 2× capacity cluster; `buffer.memory` producer (32 MB mặc định) đầy, `send()` block tới `max.block.ms` (60 s mặc định), rồi ném `TimeoutException` — client thấy latency, rồi error, rồi drop. Phòng thủ theo tầng: fail fast, chặn client ồn ào, tràn ra thì spool và replay:"

```java
props.put(ProducerConfig.MAX_BLOCK_MS_CONFIG, "5000");       // fail fast thay vì chất đống
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "30000");
// phía broker: client quota ngăn một tenant bỏ đói cả cluster
kafka-configs --bootstrap-server broker-1:9092 --alter --entity-type clients \
  --entity-name web --add-config producer_byte_rate=104857600   # cap 100 MB/s
```

"Backpressure là property của hệ thống: broker quota chặn blast radius, producer timeout chặn sự chờ đợi, và một đường spool local + replay là van tràn thực sự duy nhất — mà nó, một lần nữa, cần consumer idempotent (Q34) để an toàn."

#### Self-check

- [ ] Junior: Tôi giải thích được partition/offset, consumer group, `acks` 0/1/all kèm số latency, keyed routing, producer batching (16 KB, `linger.ms`), và timer nào đá consumer khỏi group?
- [ ] Mid: Tôi nói được ba delivery semantics, thứ tự offset-commit, per-key ordering và gì phá nó, ISR với `min.insync.replicas=2` và RF 3, và rebalance strategies vs static membership?
- [ ] Mid: Tôi viết được biến thể Spring Kafka — `@KafkaListener`, `ConcurrentKafkaListenerContainerFactory`, ackMode — và giải thích consumer-side dedupe làm replay an toàn?
- [ ] Senior: Tôi thiết kế được exactly-once qua transaction hoặc idempotent sink, chẩn đoán lag spike bằng toán drain-rate, size partition từ load, và phòng thủ retention bằng SLA reprocessing?
- [ ] Senior: Tôi phòng thủ được thiết kế 1M msg/s (partition, batch, compression, consumer), replay cửa sổ lỗi an toàn, và giải thích outbox vs transaction và semantics multi-region kèm số liệu?
