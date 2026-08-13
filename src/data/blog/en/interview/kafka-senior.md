---
title: "Java Interview Prep #5: Apache Kafka — Junior to Senior"
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

Kafka is the interview topic that separates "I've sent a message" from "I understand a distributed log". Junior developers produce and consume; seniors reason about ordering, exactly-once, and what happens when a consumer falls behind. This post walks from topics to delivery guarantees to consumer lag at scale.

> Mindset: junior sends a record and hopes it arrives; senior can tell you the exact semantics of "arrives" and what they built so a poison message can never take down the pipeline.

## Junior — foundations

**Q1. What are topics, partitions, and offsets?**
A **topic** is a named log (a stream of events). It is split into **partitions** — ordered, immutable append-only logs. Each record within a partition gets a sequential **offset**. Consumers track their offset to know where they are. More partitions = more parallelism, but also more open files and election overhead.

**Q2. What is a producer and a consumer?**
A producer appends records to a topic (it picks the partition by key or round-robin). A consumer reads records; consumers in the same **consumer group** split partitions among themselves, so each partition is consumed by exactly one member of the group. Adding consumers beyond partition count leaves some idle.

**Q3. What is a consumer group?**
A consumer group is a set of consumers that jointly process a topic — Kafka assigns each partition to one group member. If a member dies, its partitions are reassigned (rebalance) to the survivors. Different groups each get their own independent view of the full topic.

**Q4. What is the difference between a queue and a Kafka topic (log)?**
A traditional queue removes a message once consumed; many consumers compete for the same message. A Kafka topic is an **append-only log** — every consumer reads the full history at its own offset; messages aren't deleted on read (they expire by retention). That's what enables replay and multiple independent consumers.

**Q5. What is `acks` in the producer, and why does it matter?**
`acks=0`: fire-and-forget (no guarantee). `acks=1`: leader acknowledges once it wrote the record (loss if leader dies before replication). `acks=all`: leader waits until the **in-sync replicas** have it — strongest durability, lower throughput. Durability and latency trade directly.

**Q6. What is a keyed message and why use one?**
When you set a message key, Kafka deterministically routes all records with the same key to the **same partition** (via a hash). That gives you **per-key ordering** — essential for "all events for user 42 in order". Records with no key are round-robined, giving no ordering guarantee.

## Mid — tradeoffs & pitfalls

**Q1. Explain the delivery semantics: at-most-once, at-least-once, exactly-once.**

- **At-most-once**: producer may lose messages (acks=0); consumer may skip (commit offset before processing). No duplicates, possible loss.
- **At-least-once**: producer retries until acked (acks=all); consumer processes then commits. No loss, but duplicates possible (crash after process, before commit → reprocess).
- **Exactly-once**: needs idempotent producer + transactional writes + consumer idempotency, or Kafka's transactions. Harder; often people settle for at-least-once + idempotent processing.

**Q2. How do you get per-key ordering, and what breaks it?**
Set a key → same partition → in-order within that partition. What breaks it: changing the partition count (rehash moves keys to new partitions, breaking order during the window), or a partition reassignment mid-stream. Also, if you process concurrently within a partition you can reorder at the _effect_ level. Ordering is per-partition, never global, unless you have one partition (no parallelism).

**Q3. What is consumer lag and why should you monitor it?**
**Consumer lag** = number of records produced but not yet consumed (high-water-mark offset minus committed offset). Growing lag means consumers can't keep up — downstream goes stale, and if a consumer falls far behind, a rebalance or retention-based data loss can occur. Monitor lag per partition; alert before it exhausts retention.

**Q4. What is idempotent production and how does it work?**
An idempotent producer (`enable.idempotence=true`) gets a producer ID and sequence numbers; the broker deduplicates retries within a session, so a retried `send` doesn't create a duplicate. It's at-least-once with no duplicates from retries. Pair it with a keyed partition for safe ordered retries.

**Q5. What is a rebalance and how do you make it cheap?**
A rebalance redistributes partitions when a consumer joins/leaves (crash, deploy, timeout). During a rebalance, **all** consumers in the group stop consuming (stop-the-world for the group), commit offsets, and resume. Frequent rebalances (e.g. from slow poll heartbeat timeouts) cause throughput cliffs. Mitigate with `max.poll.interval.ms` tuning and incremental cooperative rebalancing.

**Q6. What happens when a broker dies — replication and ISR?**
Each partition has a leader (on one broker) and followers (replicas on others). The **in-sync replica (ISR)** set are followers caught up within `replica.lag.time`. If the leader dies, an ISR follower is elected. If you set `acks=all` and `min.insync.replicas=2`, a write needs 2 ISR — you survive one broker loss without data loss. Losing too many brokers can make a partition unavailable (durability over availability trade).

## Senior — design & defense

**Q1. A consumer keeps crashing on one bad message (poison pill). Design the handling.**
"I'd never let one record kill the pipeline. I wrap processing in try/catch; on a non-retryable error I publish the offending record to a **dead-letter topic** (with the error context) and `ack` the original so the consumer advances. A separate monitor/alert watches the DLQ. For retryable errors I use a retry topic with backoff (or Spring Kafka's `SeekToCurrentErrorHandler`). The key design principle: a poison message must move the pipeline forward, not halt it."

**Q2. You need global ordering of 1M events/sec. What do you do?**
"Global ordering means one partition — which caps me at one consumer and kills throughput. So I'd challenge the requirement: do you truly need _global_ order, or _per-entity_ order? Almost always it's per-entity (per-order, per-user), which keying gives you at full parallelism. If global order is genuinely required, I'd accept the single-partition throughput ceiling and scale by partitioning the _problem_ (e.g. shard the stream by time window) or reconsider whether Kafka is the right tool — a total-order requirement fights Kafka's design."

**Q3. Consumer lag spikes to 2M on one partition during a deploy. Diagnose.**
"First, the spike correlates with the rebalance from the rolling deploy — consumers stopped, lag accumulated, then they resumed. If lag doesn't drain afterward, the consumer is now slower than the produce rate (maybe a new synchronous call in the handler). I'd check: per-partition lag (is it one hot partition? — key skew), consumer CPU, and whether `max.poll.records` / processing time per batch is too high causing poll-timeout rebalances. Fix: increase partitions for the hot key, parallelize handling, raise `max.poll.interval.ms`. I measure drain rate vs produce rate to confirm recovery."

**Q4. Design exactly-once for a 'consume DB update + produce event' flow.**
"Naive at-least-once double-writes on crash. Options: (1) Kafka **transactions** (`read_committed` consumer isolation) — the consume+produce+offset-commit happen atomically; a crash either fully commits or fully rolls back. (2) Idempotent sink: write to the DB with the offset as a unique key, so reprocessing is a no-op. I'd prefer the idempotent-sink pattern when feasible (simpler, no transaction overhead); use Kafka transactions when the event must be atomic with the offset commit. Either way, the consumer must be idempotent — exactly-once is a property of the _whole_ pipeline, not the producer flag."

**Q5. How do you size partitions for a topic expecting 50k msg/s with 10 consumers?**
"Throughput per partition is bounded (~tens of MB/s, but realistically limited by a single consumer's processing). I'd size partitions ≈ `target_consumer_parallelism / single_consumer_throughput × safety`. With 10 consumers each handling ~10k msg/s, I'd set ~20–30 partitions (2–3× consumers) so rebalances and skewed keys still leave headroom. Too few = consumers idle; too many = file-handle and metadata overhead, and longer rebalances. I validate by load-testing one partition's max consume rate, then divide."

**Q6. Defend a retention policy and what 'data loss' really means in Kafka.**
"Retention (e.g. 7 days) means records older than that are deleted regardless of consumption — so if a consumer is down >7 days, those records are _gone_, not replayable. 'Data loss' in Kafka is usually retention-based, not broker failure (with RF≥3 and min.insync.replicas=2, broker loss is survivable). I'd set retention by the longest plausible reprocessing window + buffer, and for true durability of critical streams use tiered storage or mirror to a cold store. I defend retention with the reprocessing SLA, not a guess."

#### Self-check

- [ ] Junior: I can explain topic/partition/offset, producer vs consumer, consumer groups, log vs queue, `acks`, and keyed messages.
- [ ] Mid: I can explain the three delivery semantics, per-key ordering and what breaks it, consumer lag, idempotent production, rebalances, and ISR/replication.
- [ ] Senior: I can design poison-message handling with a DLQ, challenge false global-ordering needs, diagnose lag spikes during deploys, design exactly-once via idempotent sink or transactions, size partitions from load, and defend retention by reprocessing SLA.
