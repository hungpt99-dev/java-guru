---
title: "Kafka in Production: Four Failure Modes to Design For"
description: "Practical Kafka operating lessons: poison messages, consumer rebalances, retry storms, and safe offset commits."
pubDatetime: 2026-01-24T07:31:00+07:00
featured: true
draft: false
tags:
  - kafka
  - system-design
  - microservices
---

Kafka concepts are easy to describe in isolation: producers write records, consumers read partitions, consumer groups coordinate work, and offsets record progress. Production is harder because these mechanisms interact with application latency, dependency failures, deployment behavior, and error handling.

This article focuses on four operational problems that deserve explicit design decisions:

- a permanent failure that repeatedly blocks a partition;
- a slow consumer that causes group instability;
- retries that overload a failing dependency; and
- offset commits that do not match the business side effect.

The labels below separate Kafka behavior from analysis and proposed design choices. The thresholds in examples are illustrative assumptions, not universal defaults.

## 1. A Poison Message Can Block a Partition

**[SOURCE FACT]** Kafka stores records in order within a partition. A consumer normally advances its position by polling records and committing offsets. Kafka itself does not provide an application-level retry policy or a dead-letter queue. Those behaviors come from the consumer application or a client framework such as Spring Kafka.

**[ANALYSIS]** A malformed payload, schema mismatch, unexpected null, invalid enum value, or rejected business command may fail every time. If the consumer retries the same record without a limit or alternate route, it may never reach later records in that partition. This is not the same as a transient database timeout, which may succeed after the dependency recovers.

Classify failures before choosing a retry policy:

- **Permanent, non-retryable errors:** parsing, schema, validation, and deterministic business-rule failures. Repeating the same operation will not change the input or rule result.
- **Transient, retryable errors:** temporary network failures, connection timeouts, short database deadlocks, and temporarily unavailable dependencies. These can be retried under a bounded policy.

**[PROPOSED DESIGN]** Route permanent failures to a dead-letter topic or queue with the original record, topic, partition, offset, error classification, and processing timestamp. Record whether replay is safe and what correction is required. Commit the failed record's offset only after this handling succeeds, so the consumer can continue. Do not acknowledge a record merely because its handler threw an exception.

Schema Registry can help prevent incompatible schemas from being registered when compatibility rules are enabled. It does not replace payload validation, and it does not protect a topic when producers bypass the expected serialization path. Treat it as an additional producer-side control, not as the only consumer-side defense.

## 2. Rebalances Can Remove Throughput

**[SOURCE FACT]** A consumer group rebalances when its membership or partition assignment changes. A consumer can also leave the group when it exceeds `max.poll.interval.ms` between calls to `poll`. Heartbeats are handled by the Kafka client, but successful heartbeats do not prevent a consumer from being removed for failing to call `poll` within the configured interval.

**[ANALYSIS]** Long synchronous processing in the poll loop, stop-the-world pauses, slow shutdowns, and unstable network conditions can all make rebalances more likely or more expensive. During a rebalance, partitions are revoked and reassigned; affected partitions cannot make normal progress until ownership is settled. Repeated rebalances can therefore reduce throughput even when the broker and network are healthy.

**[PROPOSED DESIGN]** Keep the poll path bounded. Reduce `max.poll.records` when one batch takes too long, or move business work to a controlled worker pool if the client framework supports that model. In the latter case, define how records are ordered, paused, retried, and committed; concurrency without an offset policy only moves the failure elsewhere.

Static membership using `group.instance.id` can reduce avoidable reassignment during a restart when the instance returns with the same identity and the assignment remains valid. It is not a guarantee that every restart avoids a rebalance, and it requires an identity-management strategy that prevents two live consumers from using the same ID.

Tune `fetch.min.bytes`, `fetch.max.wait.ms`, and `max.poll.records` from observed latency and throughput requirements. These settings are workload controls, not universal performance fixes.

## 3. Uncontrolled Retry Creates a Retry Storm

**[SOURCE FACT]** A retry is another request to the failing dependency. Exponential backoff spaces retries out, but it does not by itself bound concurrency, coordinate consumers, or protect the dependency. Spring Kafka can apply policies such as `FixedBackOff` or `ExponentialBackOff` through its error-handling facilities, but retries performed on the consumer thread still occupy that thread.

**[ANALYSIS]** Suppose, as an illustrative assumption, that a dependency is timing out while many records are being processed. If each record is retried immediately, the consumer creates more traffic against the same failing dependency. The dependency remains unhealthy, processing slows, and more records become eligible for retry. This feedback loop is a retry storm.

**[PROPOSED DESIGN]** Use a bounded retry policy with an explicit failure route:

1. Process the record once in the main consumer.
2. For a transient error, publish it to a retry topic with the next-attempt time and failure metadata.
3. Have a separate retry consumer release records after the intended delay.
4. After the configured retry budget is exhausted, route the record to the dead-letter topic for inspection or a controlled replay.

The exact delays and retry budget are deployment assumptions. Choose them from dependency recovery behavior and the business deadline, not from a generic recipe.

Use a circuit breaker to stop sending work to a dependency that is consistently failing. A circuit breaker should have an explicit opening condition, a controlled half-open probe, and an operational route for records that cannot wait. Add jitter to backoff so independent consumers do not retry at the same instant. Rate limits, bounded worker pools, and backpressure (slowing intake when processing capacity is exhausted) are complementary controls.

## 4. The Consumer Is Not Thread-Safe: Commit Offsets Deliberately

**[SOURCE FACT]** The Kafka consumer client is not designed for concurrent access by multiple application threads. The thread that owns the consumer should poll, manage its assignment, and perform consumer operations such as commits. A record's committed offset represents a position in the partition; it is not proof that the associated business side effect completed.

**[ANALYSIS]** If an application commits before writing to a database or calling a downstream service, a crash can leave the side effect undone while Kafka considers the record processed. If it performs the side effect and crashes before committing, the record may be delivered again. This is the normal at-least-once trade-off, not an offset bug. The side effect must therefore tolerate duplicates or participate in an appropriate transaction boundary.

**[PROPOSED DESIGN]** Define ownership and commit order explicitly:

- Keep consumer-client calls on the consumer thread, unless the framework documents a safe alternative.
- Commit only after the required side effect has succeeded, or after a permanent failure has been durably routed to the dead-letter path.
- If work is handed to workers, track completion per partition and commit only the highest contiguous completed offset. Do not commit a later record while an earlier record is still unresolved unless the processing model explicitly permits that ordering.
- Make writes idempotent (safe to apply more than once), for example with a stable event ID and a database uniqueness constraint. Use a row lock or an outbox/inbox pattern when the operation requires stronger coordination.
- Monitor commit failures, consumer lag, retry volume, dead-letter volume, and rebalance frequency together. A single healthy-looking metric can hide a stalled pipeline.

Kafka does not decide where your business transaction ends. The consumer design must make that boundary, the duplicate behavior, and the recovery procedure explicit.
