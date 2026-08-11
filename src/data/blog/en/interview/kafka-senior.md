---
title: "Senior Java Interview: Apache Kafka"
description: "Event-driven systems on Kafka — delivery semantics, replication, partitioning for order, consumer lag, and the dead-letter queue every production consumer needs."
pubDatetime: 2026-08-10T10:20:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - kafka
  - event-driven
---

Kafka questions separate people who've run it in production from those who've only read the docs.

## 1. Core model

- **Topics, partitions, offsets, consumer groups.** Partitions are the unit of parallelism and ordering — order is guaranteed _within_ a partition, not across.
- **A consumer group** splits partitions among members; adding consumers beyond the partition count does nothing.

## 2. Delivery semantics — know all three

- **At most once:** may lose messages (offset commit before processing).
- **At least once:** may duplicate (processing before commit) — the realistic default; make consumers **idempotent** (dedupe by key/offset).
- **Exactly once:** Kafka EOS via idempotent producer + transactional API, or the simpler "idempotent consumer + at-least-once."

```java
// Idempotent consumer: dedupe by a stable key, not by hoping for exactly-once
if (processedKeys.putIfAbsent(event.key(), event.offset()) != null) return;
```

## 3. Replication & durability

- **RF and ISR** (in-sync replicas). `acks=all` + RF≥3 survives broker loss without data loss.
- **Why `acks=1` is dangerous in prod:** the leader can ack then die before replicating.

## 4. Ordering & partitioning

If order matters (payments, audit), key by entity id so all its events land on one partition. Trade-off: hot keys create hot partitions — sometimes shard the key.

## 5. Real failure modes

- **Rebalance storms** when consumers churn — understand cooperative rebalancing.
- **Consumer lag** — monitor it; first signal of a slow consumer or a producer surge.
- **Poison messages** — a bad record that always fails; without a DLQ it blocks the partition forever. Always build a DLQ.

```java
try { process(record); }
catch (PoisonException e) { sendToDlq(record, e); /* commit and move on */ }
```

## 6. Self-check

- [ ] At-least-once vs exactly-once, and how to make a consumer idempotent.
- [ ] Why `acks=all` + RF≥3 matters.
- [ ] How to guarantee order for one entity.
- [ ] What a DLQ is for and when you need one.

That's the Kafka bar.
