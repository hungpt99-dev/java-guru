---
title: "Ôn thi Java #5: Apache Kafka — Junior đến Senior"
description: "Hệ thống event-driven trên Kafka — delivery semantics, replication, partitioning cho thứ tự, consumer lag, và dead-letter queue mọi consumer production đều cần. Với producer/consumer code và số thật."
pubDatetime: 2026-08-10T10:20:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - kafka
  - event-driven
---

Kafka là chủ đề tách biệt "tôi đã gửi một message" và "tôi hiểu một distributed log". Junior produce và consume; senior lập luận về ordering, exactly-once, và chuyện gì khi consumer tụt hậu — với config và code để chứng minh. Bài này leo từ topic đến delivery guarantee đến lag ở scale.

> Mindset: junior gửi một record và cầu nó tới; senior kể được semantics chính xác của "tới" và họ xây gì để một poison message không bao giờ gục pipeline.

## Junior — nền tảng

**Q1. Topic, partition, và offset là gì?**
Topic là một log có tên chia thành **partition** — ordered, append-only log. Mỗi record có một **offset** tuần tự trong partition. Nhiều partition = nhiều parallelism, nhưng cũng nhiều open file (mỗi partition là directory của segment file, mặc định ~1 GB) và rebalance hơi dài hơn. Topic 50 partition trên cluster 3 broker là điểm bắt đầu bình thường.

**Q2. Producer vs consumer, và consumer group?**
Producer append vào topic; consumer trong **consumer group** có exclusive access đến tập con partition. Với 12 partition và 4 consumer, mỗi consumer xử lý 3 partition. Thêm consumer thứ 5 thì idle (không thể có nhiều active consumer hơn partition).

**Q3. `acks` là gì và tại sao quan trọng?**
`acks=0` (fire-and-forget, ~0 guarantee), `acks=1` (leader ack; mất nếu leader chết trước replica), `acks=all` (mọi in-sync replica ack — mạnh nhất, nhưng latency ~2–5× cao hơn, ~20–50 ms vs ~2–5 ms). Durability vs latency, trực tiếp:

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true"); // không duplicate trên retry
```

**Q4. Keyed message là gì và tại sao dùng?**
Key route mọi record cùng key vào **cùng partition** (hash), cho **per-key ordering**. Record không key bị round-robin — không guarantee ordering.

```java
// same key -> same partition -> in order. Critical cho "mọi event của user 42 theo thứ tự"
producer.send(new ProducerRecord<>("orders", user.getId(), orderEvent));
```

**Q5. Queue vs Kafka log?**
Queue xóa message một khi consumed; Kafka là append-only log — mọi consumer đọc full history tại offset riêng, và message expire theo **retention** (vd 7 ngày), không phải trên read.

**Q6. Consumer group làm gì khi crash?**
Khi member chết, partition của nó được **reassigned** (rebalance) cho survivor. Trong rebalance mọi member dừng consume thoáng chốc. Rebalance thường xuyên (từ slow poll heartbeat) gây throughput cliff.

## Mid — tradeoff & điểm mù

**Q1. Ba delivery semantics.**

- **At-most-once**: `acks=0`; có thể mất, không duplicate.
- **At-least-once**: `acks=all` + retry; không mất, có thể duplicate (crash sau process, trước commit).
- **Exactly-once**: cần idempotent producer + transactional write, hoặc Kafka transaction. Hầu hết team chốt at-least-once + idempotent processing.

**Q2. Per-key ordering và gì phá nó.**
Key → cùng partition → in-order. Phá khi đổi partition count (rehash chuyển key sang partition mới giữa stream) hoặc trên reassignment. Ordering là per-partition, không bao giờ global, trừ khi một partition (không parallelism).

**Q3. Consumer lag và tại sao monitor?**
Lag = produced-nhưng-chưa-consumed (high-water-mark offset trừ committed offset). Tại 10k msg/s với consumer làm 20 ms mỗi batch 500, lag giữ gần zero; nếu processing trượt xuống 200 ms/batch, lag tăng hàng nghìn/giây và có thể vượt retention 7 ngày — **data loss vĩnh viễn cho slow consumer**.

**Q4. Idempotent production.**
`enable.idempotence=true` cho producer ID + sequence number; broker deduplicate retry. Ghép với keyed partition cho ordered retry an toàn.

**Q5. Rebalance — làm rẻ.**
Tune `max.poll.interval.ms` (mặc định 5 phút) và `max.poll.records` (mặc định 500) để batch chậm không trigger timeout rebalance. Ưu tiên incremental cooperative rebalancing (Kafka 2.4+) hơn eager rebalance stop-the-world.

**Q6. Replication và ISR.**
Mỗi partition có leader + follower; tập **in-sync replica (ISR)** là follower bắt kịp trong `replica.lag.time.max.ms` (mặc định 30 s). Với `min.insync.replicas=2` và `replication.factor=3`, bạn sống sót mất một broker không data loss. Nếu hai broker chết, partition đó unavailable (durability over availability).

```java
props.put("min.insync.replicas", "2");   // với replication.factor=3
```

## Senior — thiết kế & phòng thủ

**Q1. Consumer crash trên một message xấu (poison pill). Thiết kế xử lý.**
"Không bao giờ để một record gục pipeline. Catch processing exception, publish record lỗi sang **dead-letter topic** với error context, và `ack` original để consumer tiến lên. Một monitor alert trên DLQ. Cho retryable error dùng retry topic với exponential backoff:"

```java
try {
  processor.handle(record);
  consumer.commitSync();           // ack chỉ sau success
} catch (PoisonMessageException e) {
  deadLetterProducer.send(new ProducerRecord<>("orders-dlq", record.key(), record.value()));
  consumer.commitSync();           // acknowledge để KHÔNG retry mãi
} catch (RetryableException e) {
  // route sang orders-retry với backoff; đừng ack
}
```

"Nguyên tắc: poison message phải tiến pipeline lên, không dừng nó."

**Q2. Bạn cần global ordering của 1M events/sec. Làm gì?**
"Global ordering = một partition = một consumer = bạn giết throughput. Tôi thách thức requirement: gần như luôn là order _per-entity_ (per-order, per-user), keying cho bạn ở full parallelism. Nếu global order thực sự cần, tôi chấp nhận single-partition ceiling (~tens of thousands msg/s trên một consumer) và xem lại Kafka có fit không — total-order requirement chống lại thiết kế nó."

**Q3. Consumer lag vọt 2M trong deploy. Chẩn đoán.**
"Đầu tiên, spike tương quan với rebalance từ rolling deploy — consumer dừng, lag tích, rồi resume. Nếu lag không drain, consumer giờ chậm hơn produce rate (một synchronous call mới trong handler). Tôi check per-partition lag (một hot partition = key skew), consumer CPU, và `max.poll.records`/processing time. Fix: nhiều partition cho hot key, parallelize handling, nâng `max.poll.interval.ms`. Tôi đo drain rate vs produce rate để confirm recovery."

**Q4. Exactly-once cho flow 'consume DB update + produce event'.**
"Naive at-least-once double-write trên crash. Lựa chọn: (1) Kafka **transaction** — consume+produce+offset-commit nguyên tử, crash hoặc fully commit hoặc rollback. (2) Idempotent sink: viết vào DB keyed bằng offset, nên reprocessing là no-op:"

```java
// Atomic: read_committed consumer chỉ thấy committed transactional write
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "order-sink-1");
producer.initTransactions();
producer.beginTransaction();
db.update(order, offset);          // side effect
producer.send(event);              // Kafka write
producer.sendOffsetsToTransaction(currentOffsets, groupId);
producer.commitTransaction();      // all-or-nothing
```

"Exactly-once là property của _toàn bộ_ pipeline, không phải producer flag."

**Q5. Size partition cho 50k msg/s với 10 consumer thế nào?**
"Throughput per partition bị giới hạn bởi processing của một consumer (~5–10k msg/s realistic). Tôi size partition ≈ `target_consumer_parallelism / single_consumer_throughput × safety` → ~20–30 cho 10 consumer. Quá ít = idle consumer; quá nhiều = file-handle + metadata overhead và rebalance dài hơn. Tôi validate bằng load-test max consume rate của một partition, rồi chia."

**Q6. Phòng thủ retention policy và 'data loss' thực sự nghĩa gì.**
"Retention (vd 7 ngày) xóa record cũ hơn bất kể consumption — nên consumer down >7 ngày mất chúng, vĩnh viễn. 'Data loss' trong Kafka thường là retention-based, không phải broker failure (RF≥3, min.insync.replicas=2 sống sót một broker). Tôi set retention theo longest plausible reprocessing window + buffer, và cho stream critical dùng tiered storage. Tôi phòng thủ retention bằng reprocessing SLA, không phải đoán."

#### Self-check

- [ ] Junior: Tôi giải thích được topic/partition/offset, producer vs consumer group, `acks` (0/1/all, với latency number), keyed message, log vs queue, và rebalance.
- [ ] Mid: Tôi giải thích được ba delivery semantics, per-key ordering + gì phá nó, consumer lag (và 7-day retention loss), idempotent production, rebalance tuning, và ISR/replication (min.insync.replicas=2, RF=3).
- [ ] Senior: Tôi thiết kế được poison-message handling với DLQ + commit-chỉ-khi-success, thách thức false global-ordering need, chẩn đoán lag spike trong deploy, thiết kế exactly-once qua transaction hoặc idempotent sink, size partition từ load, và phòng thủ retention bằng reprocessing SLA.
