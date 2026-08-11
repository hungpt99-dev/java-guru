---
title: "Phỏng vấn Senior Java: Apache Kafka"
description: "Hệ thống event-driven trên Kafka — delivery semantics, replication, partitioning cho order, consumer lag, và dead-letter queue mọi consumer production cần."
pubDatetime: 2026-08-12T10:20:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - kafka
  - event-driven
---

Câu hỏi Kafka phân biệt người từng chạy prod và người chỉ đọc docs.

## 1. Core model

- **Topics, partitions, offsets, consumer groups.** Partition là đơn vị parallelism và ordering — order đảm bảo _trong_ partition, không across.
- **Consumer group** chia partition cho member; thêm consumer vượt partition count thì vô ích.

## 2. Delivery semantics — biết cả ba

- **At most once:** có thể mất (commit offset trước khi xử lý).
- **At least once:** có thể trùng (xử lý trước khi commit) — default thực tế; làm consumer **idempotent** (dedupe bằng key/offset).
- **Exactly once:** EOS qua idempotent producer + transactional API, hoặc đơn giản hơn "idempotent consumer + at-least-once."

```java
// Idempotent consumer: dedupe bằng key ổn định
if (processedKeys.putIfAbsent(event.key(), event.offset()) != null) return;
```

## 3. Replication & durability

- **RF và ISR.** `acks=all` + RF≥3 sống sót mất broker không mất data.
- **Tại sao `acks=1` nguy hiểm:** leader ack rồi chết trước khi replicate.

## 4. Ordering & partitioning

Order quan trọng (payment, audit) thì key bằng entity id để mọi event vào một partition. Trade-off: hot key tạo hot partition — đôi khi shard cái key.

## 5. Failure mode thật

- **Rebalance storms** khi consumer churn — hiểu cooperative rebalancing.
- **Consumer lag** — monitor; tín hiệu đầu của consumer chậm hoặc producer surge.
- **Poison messages** — record xấu luôn fail; thiếu DLQ thì block partition mãi. Luôn build DLQ.

```java
try { process(record); }
catch (PoisonException e) { sendToDlq(record, e); /* commit và đi tiếp */ }
```

## 6. Tự kiểm tra

- [ ] At-least-once vs exactly-once, và làm consumer idempotent.
- [ ] Tại sao `acks=all` + RF≥3 quan trọng.
- [ ] Cách guarantee order cho một entity.
- [ ] DLQ để làm gì và khi nào cần.

Đó là bar Kafka.
