---
title: "Java Interview Prep #5: Apache Kafka — Junior to Senior"
description: "Event-driven systems on Kafka — delivery semantics, replication, partitioning for order, consumer lag, and the dead-letter queue every production consumer needs. With producer/consumer code and real numbers."
pubDatetime: 2026-08-10T10:20:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - kafka
  - event-driven
---

Kafka is the topic that separates "I've sent a message" from "I understand a distributed log". Junior developers produce and consume; seniors reason about ordering, exactly-once, and what happens when a consumer falls behind — with the config and code to prove it. This post climbs from topics to delivery guarantees to lag at scale.

> Mindset: junior sends a record and hopes it arrives; senior can tell you the exact semantics of "arrives" and what they built so a poison message can never take down the pipeline.

## Junior — foundations

**Q1. What are topics, partitions, and offsets?**
A topic is a named log split into **partitions** — ordered, append-only logs. Each record gets a sequential **offset** within its partition. More partitions = more parallelism, but also more open files (each partition is a directory of segment files, ~1 GB each by default) and slightly longer rebalances. A topic with 50 partitions on a 3-broker cluster is a normal starting point.

**Q2. Producer vs consumer, and consumer groups?**
A producer appends to a topic; a consumer in a **consumer group** gets exclusive access to a subset of partitions. With 12 partitions and 4 consumers, each consumer handles 3 partitions. Adding a 5th consumer leaves one idle (you can't have more active consumers than partitions).

**Q3. What is `acks` and why does it matter?**
`acks=0` (fire-and-forget, ~0 guarantee), `acks=1` (leader acks; lost if leader dies pre-replica), `acks=all` (all in-sync replicas ack — strongest, but ~2–5× higher latency, ~20–50 ms vs ~2–5 ms). Durability vs latency, directly:

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true"); // no duplicates on retry
```

**Q4. What is a keyed message and why use one?**
A key routes all records with the same key to the **same partition** (hash), giving **per-key ordering**. Records with no key are round-robined — no ordering guarantee.

```java
// same key -> same partition -> in order. Critical for "all events for user 42 in order"
producer.send(new ProducerRecord<>("orders", user.getId(), orderEvent));
```

**Q5. Queue vs Kafka log?**
A queue removes a message once consumed; Kafka is an append-only log — every consumer reads the full history at its own offset, and messages expire by **retention** (e.g. 7 days), not on read.

**Q6. What does a consumer group do on a crash?**
When a member dies, its partitions are **reassigned** (rebalance) to survivors. During a rebalance all group members stop consuming briefly. Frequent rebalances (from slow poll heartbeats) cause throughput cliffs.

## Mid — tradeoffs & pitfalls

**Q1. The three delivery semantics.**

- **At-most-once**: `acks=0`; possible loss, no duplicates.
- **At-least-once**: `acks=all` + retries; no loss, possible duplicates (crash after process, before commit).
- **Exactly-once**: needs idempotent producer + transactional writes, or Kafka transactions. Most teams settle for at-least-once + idempotent processing.

**Q2. Per-key ordering and what breaks it.**
Key → same partition → in-order. Breaks when you change partition count (a rehash moves keys to new partitions mid-stream) or on a reassignment. Ordering is per-partition, never global, unless you have one partition (no parallelism).

**Q3. Consumer lag and why monitor it.**
Lag = produced-but-not-consumed (high-water-mark offset minus committed offset). At 10k msg/s with a consumer doing 20 ms of work per batch of 500, lag stays near zero; if processing slips to 200 ms/batch, lag grows by ~thousands/sec and can exceed the 7-day retention — **permanent data loss for the slow consumer**.

**Q4. Idempotent production.**
`enable.idempotence=true` gives a producer ID + sequence numbers; the broker deduplicates retries. Pair with a keyed partition for safe ordered retries.

**Q5. Rebalances — make them cheap.**
Tune `max.poll.interval.ms` (default 5 min) and `max.poll.records` (default 500) so a slow batch doesn't trigger a timeout rebalance. Prefer incremental cooperative rebalancing (Kafka 2.4+) over stop-the-world eager rebalances.

**Q6. Replication and ISR.**
Each partition has a leader + followers; the **in-sync replica (ISR)** set are followers caught up within `replica.lag.time.max.ms` (default 30 s). With `min.insync.replicas=2` and `replication.factor=3`, you survive one broker loss with no data loss. If two brokers die, that partition becomes unavailable (durability over availability).

```java
props.put("min.insync.replicas", "2");   // with replication.factor=3
```

## Senior — design & defense

**Q1. A consumer crashes on one bad message (poison pill). Design the handling.**
"Never let one record kill the pipeline. Catch the processing exception, publish the offending record to a **dead-letter topic** with the error context, and `ack` the original so the consumer advances. A separate monitor alerts on the DLQ. For retryable errors use a retry topic with exponential backoff:"

```java
try {
  processor.handle(record);
  consumer.commitSync();           // ack only after success
} catch (PoisonMessageException e) {
  deadLetterProducer.send(new ProducerRecord<>("orders-dlq", record.key(), record.value()));
  consumer.commitSync();           // acknowledge so we DON'T retry forever
} catch (RetryableException e) {
  // route to orders-retry with backoff; do NOT ack
}
```

"The principle: a poison message must move the pipeline forward, not halt it."

**Q2. You need global ordering of 1M events/sec. What do you do?**
"Global ordering = one partition = one consumer = you've killed throughput. I'd challenge the requirement: almost always it's _per-entity_ order (per-order, per-user), which keying gives at full parallelism. If global order is genuinely required, I accept the single-partition ceiling (~tens of thousands msg/s on one consumer) and reconsider whether Kafka fits — a total-order requirement fights its design."

**Q3. Consumer lag spikes to 2M during a deploy. Diagnose.**
"First, the spike correlates with the rebalance from the rolling deploy — consumers stopped, lag accumulated, then resumed. If lag doesn't drain, the consumer is now slower than the produce rate (a new synchronous call in the handler). I check per-partition lag (one hot partition = key skew), consumer CPU, and `max.poll.records`/processing time. Fix: more partitions for the hot key, parallelize handling, raise `max.poll.interval.ms`. I measure drain rate vs produce rate to confirm recovery."

**Q4. Exactly-once for a 'consume DB update + produce event' flow.**
"Naive at-least-once double-writes on crash. Options: (1) Kafka **transactions** — consume+produce+offset-commit atomic, so a crash either fully commits or rolls back. (2) Idempotent sink: write to the DB keyed by the offset, so reprocessing is a no-op:"

```java
// Atomic: read_committed consumers only see committed transactional writes
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "order-sink-1");
producer.initTransactions();
producer.beginTransaction();
db.update(order, offset);          // side effect
producer.send(event);              // Kafka write
producer.sendOffsetsToTransaction(currentOffsets, groupId);
producer.commitTransaction();      // all-or-nothing
```

"Exactly-once is a property of the _whole_ pipeline, not the producer flag."

**Q5. How do you size partitions for 50k msg/s with 10 consumers?**
"Throughput per partition is bounded by one consumer's processing (~5–10k msg/s realistic). I size partitions ≈ `target_consumer_parallelism / single_consumer_throughput × safety` → ~20–30 for 10 consumers. Too few = idle consumers; too many = file-handle + metadata overhead and longer rebalances. I validate by load-testing one partition's max consume rate, then divide."

**Q6. Defend a retention policy and what 'data loss' really means.**
"Retention (e.g. 7 days) deletes records older than that regardless of consumption — so a consumer down >7 days loses them, permanently. 'Data loss' in Kafka is usually retention-based, not broker failure (RF≥3, min.insync.replicas=2 survives a single broker). I set retention by the longest plausible reprocessing window + buffer, and for critical streams use tiered storage. I defend retention with the reprocessing SLA, not a guess."

#### Self-check

- [ ] Junior: I can explain topic/partition/offset, producer vs consumer groups, `acks` (0/1/all, with latency numbers), keyed messages, log vs queue, and rebalances.
- [ ] Mid: I can explain the three delivery semantics, per-key ordering + what breaks it, consumer lag (and 7-day retention loss), idempotent production, rebalance tuning, and ISR/replication (min.insync.replicas=2, RF=3).
- [ ] Senior: I can design poison-message handling with a DLQ + commit-only-on-success, challenge false global-ordering needs, diagnose lag spikes during deploys, design exactly-once via transactions or idempotent sink, size partitions from load, and defend retention by reprocessing SLA.
