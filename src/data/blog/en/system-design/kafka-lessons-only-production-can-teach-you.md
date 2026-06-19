---
title: "Kafka: Lessons Only Production Can Teach You"
description: "No Kafka tutorial prepares you for the 2 AM wake-up call when consumer lag spirals out of control. Hard-earned lessons about Kafka in production."
pubDatetime: 2026-01-24T07:31:00+07:00
featured: true
draft: false
tags:
  - kafka
  - system-design
  - microservices
---

## Foreword

No Kafka tutorial prepares you for the 2 AM wake-up call when consumer lag spirals out of control. You open Grafana, see offsets frozen like bronze statues. You restart pods — lag drops slightly then clings back. You scale up consumers — five minutes later, the entire group rebalances continuously, throughput drops to zero. The whole system clinically dead because of a few bad messages.

Kafka on slides is always clean and perfect: at-least-once, offset, partition, consumer group, retry. Every example is tidy, every flow is a "happy path", every error is handled in 3 lines of code.

Kafka in production is different. It doesn't care how thoroughly you've read the documentation. It only cares where you commit offsets wrong, how long you block the poll thread, and how uncontrolled your retries are. It's a battlefield where theory meets reality, where "it works on my machine" gets shattered into pieces.

This article doesn't teach you the Kafka API — hundreds of tutorials already do that. This article records hard-earned lessons only gained after a few real incidents: when data duplicates uncontrollably, messages vanish without a trace, and the entire system freezes because of a seemingly tiny message. These are things not found in official documentation, yet they determine your system's survival.

---

## 1. One Bad Message Can Clog the Entire System

Most tutorials teach you to write consumer handlers following a very elegant formula: deserialize message, call business service, throw exception on error. Code looks clean, runs smoothly locally, QA testing finds no issues.

Production will gift you an expensive lesson: just one message with a "dirty" payload — wrong JSON schema, unexpected null field, unmappable enum value — your handler throws an exception. **Spring Kafka** retries that message (if configured). Handler throws again. This loop continues until... you have to intervene manually.

**Error classification is a survival skill:**

- **Permanent errors (non-retryable):** JSON parse errors, schema violations, validation errors, business logic errors. Retrying 1,000 times won't make that JSON any more valid. These errors need immediate handling and routing to a Dead Letter Queue.
- **Transient errors (retryable):** Temporary network errors, database connection timeouts, short deadlocks, temporarily unavailable service dependencies. These may succeed after a controlled number of retries.

**Important note:** **Kafka core has no retry mechanism.** Retry is provided by **client libraries** like Spring Kafka through the `DefaultErrorHandler` mechanism with `RetryTemplate`. Without proper configuration, exceptions will block the consumer loop.

**Schema Registry is your first shield:** Use Schema Registry with STRONG compatibility mode to catch schema errors at the producer side. Invalid messages get rejected before entering the topic, never reaching your consumer. This is proactive defense rather than reactive handling.

**Handle correctly from the start:** Permanent error messages must go straight to DLQ with full metadata — what error, when, retry count, and most importantly: can it be replayed? Don't let one bad message block an entire partition. Commit its offset after appropriate handling so the consumer can continue.

---

## 2. Rebalance Can Destroy Throughput

Rebalance is Kafka's mechanism for redistributing partitions among consumers when the group changes. In production, rebalance happens more often than you think: new deployments, pod restarts, slight network blips, slow consumers.

**Deadly mistake:** You block message processing too long in the poll thread, exceeding `max.poll.interval.ms` (typically 5 minutes). The broker doesn't see heartbeats, thinks the consumer is "dead", kicks it from the group → triggers full rebalance. During rebalance (tens of seconds to minutes), no messages are processed, throughput drops to zero.

**Static Membership — stability savior:** Since Kafka 2.3, you can configure `group.instance.id`. When a consumer restarts with the same instance ID, the broker recognizes it as an "old friend" and allows rejoining without triggering a full group rebalance, as long as the assignment remains valid. This is especially important in container-based deployment environments where pods frequently restart.

**Keep the poll thread lightweight:** The poll thread should only do one thing — fetch messages and send heartbeats. Never process heavy business logic in this thread. Spring Kafka has `ConcurrentKafkaListenerContainerFactory` for parallel processing, but you need to understand how it manages offsets and threads.

**Dynamic configuration tuning:** Reduce `max.poll.records` when processing is slow, increase it when the system is idle. Adjust `fetch.min.bytes` and `fetch.max.wait.ms` to balance latency and throughput based on actual load patterns.

---

## 3. Wrong Retry Kills Downstream

Tutorials often say: "Use exponential backoff, retry 5 times." Sounds reasonable, until you face reality.

Classic production scenario: Downstream service has a 2-second timeout. 1,000 messages all call that endpoint. Each message retries 5 times = 5,000 requests flooding in within minutes. Downstream service dies completely → all messages fail → retry again → creating a **retry storm** that completely destroys the downstream service.

**Retry in Spring Kafka is client-side:** Spring Kafka provides `RetryTemplate` with `ExponentialBackOffPolicy` or `FixedBackOffPolicy`. But immediate retry in the same consumer thread can cause blocking and rebalance.

**Independent retry pipeline — the mature solution:**

- Main consumer only processes messages that succeed on the first attempt
- On transient error → produce to Retry Topic with timestamp delay (5s, 30s, 2 min, 10 min...)
- Separate retry consumer processes messages from Retry Topic after the predetermined delay
- After N failed retries → push to DLQ for manual inspection

**Spring Kafka has built-in retry with backoff:** You can configure `DefaultErrorHandler` with `FixedBackOff` or `ExponentialBackOff`. But be careful: too many retries in the same thread will block processing of other messages.

**Circuit breaker — not a luxury but a necessity:** Monitor error rates in real-time. When the error rate exceeds a threshold (e.g., 50% in 1 minute), automatically pause retries, route messages directly to DLQ. Don't beat a dying service to death.

**Jitter in backoff:** Add randomness to retry intervals to avoid the "thundering herd" phenomenon — all retries happening simultaneously after each cycle.

---

## 4. Consumer Is Not Thread-Safe — How to Commit Offsets Safely?

This needs to be engraved in your mind: **Kafka consumer client is NOT thread-safe.**

The most common mistake: Processing messages in a thread pool, then committing offsets from a worker thread → race condition → wrong offset commit → mass message loss or duplication. You won't know this is happening until customers complain about missing or duplicate data.

**Spring Kafka manages offsets automatically but...:** With `@KafkaListener` and default `AckMode` (BATCH), Spring automatically commits offsets after processing a batch. But if you process asynchronously with `@Async` or a thread pool without manual offset management, you'll have problems.

**Safe commit model in production with Spring Kafka:**

**Smart AckMode:**

- `RECORD`: commit after each message → high overhead, but safest
- `BATCH`: commit after each batch → good balance, but if there's an error in the batch, the entire batch will be retried
- `MANUAL`/`MANUAL_IMMEDIATE`: manual commit when you're ready → most flexible, but requires careful coding

**Manage offsets in partition order:** Kafka only guarantees ordering within a partition. Offsets must be committed in ascending order. If processing multiple messages from the same partition in parallel, ensure correct commit order.

**Only one thread commits:** When using `ConcurrentMessageListenerContainer`, each partition is processed by a separate thread. Spring manages this well, but if you create your own thread pool, ensure each partition has only one processing thread.

---

## 5. Producer: Idempotence, Transaction, and Outbox Pattern

`producer.send(record)` in a tutorial is worlds apart from `producer.send(record)` in production.

**Three defense layers for producer:**

**Idempotence — the basic layer:** Always enable `enable.idempotence=true`. This feature assigns each producer an ID and sequences each message, allowing the broker to detect and eliminate duplicates from producer retries (within the same producer session). This is a "must-have", not a "nice-to-have".

**Transaction — for cross-partition atomicity:** Spring Kafka supports transactions through `KafkaTransactionManager`. When you need atomicity across multiple partitions/topics — for example: consuming a message from an input topic and producing a message to an output topic in the same transaction. Transactions ensure all-or-nothing semantics. But remember: transactions have overhead, only use when truly needed.

**Outbox Pattern — solving the classic dilemma:** This is the most important pattern for distributed transaction systems. "Commit database first or send Kafka message first?" — Outbox Pattern answers: both, but in the right order.

- Within the same database transaction as business logic, write event to the `outbox` table
- Commit transaction (business data + outbox record)
- Background process (CDC or scheduled job) reads from `outbox` and produces to Kafka
- Mark outbox record as published

Guarantee: if business transaction succeeds → event will be sent to Kafka (at least once). This pattern solves the dual-write problem without complex distributed transactions.

---

## 6. Race Conditions Tutorials Never Mention

Kafka only guarantees ordering **within a partition**, not ordering according to your business logic.

**Classic headache scenario:** Message A (update order status = "PROCESSING") and message B (update order status = "COMPLETED") for the same `order_id=123`. If they land in two different partitions due to different hash keys, consumers process in parallel → message B may be processed before message A → order status jumps from "PENDING" straight to "COMPLETED" then back to "PROCESSING".

**Partition key strategy — the key to ordering:** Always use `entity_id` as the partition key for all messages related to the same entity. This ensures all events for the same entity go to the same partition and are processed sequentially.

**Idempotent processing — the last line of defense:** Even with in-partition ordering, duplicates can still occur due to retries. Use version numbers or conditional updates in the database:

```sql
UPDATE orders
SET status = 'COMPLETED', version = 2
WHERE order_id = 123 AND version = 1;
```

If this update fails (version mismatch), you know there's been a concurrent update and need to handle the conflict.

**Debezium/CDC when strong ordering is needed:** Sometimes, instead of producing events from application code, consider using Change Data Capture (Debezium) to stream database change events. CDC ensures ordering by database commit order, often the most robust solution for event ordering.

---

## 7. Observability: You Can't Debug What You Don't Measure

Lag metrics from Kafka (consumer lag) are necessary but insufficient. It's like only looking at the speedometer without knowing where the car is, how much fuel is left, or whether the engine is overheating.

**Production observability checklist:**

**Distributed Tracing is mandatory:** Inject trace-id into message headers at the producer, propagate through all consumers, service calls, database queries. Spring Cloud Sleuth or Micrometer Tracing does this well.

**Business Metrics — measure what truly matters:**

- Messages processed successfully/failed per minute, categorized by error type
- Average processing time, p95, p99 (to detect outliers)
- Rate of messages entering DLQ, Retry Topic
- End-to-end latency: from produce to consume completion

**Kafka Client Metrics:** Spring Kafka integrates with Micrometer, exposing metrics:

- `spring.kafka.consumer.records.consumed`
- `spring.kafka.consumer.fetch.manager.records.lag`
- `spring.kafka.producer.record.send.total`

**Meaningful Health Checks:** Spring Actuator with `HealthContributor` for Kafka. Consumer health check endpoints shouldn't just return "UP". They should indicate: does the consumer have assigned partitions? Is it rebalancing? Is lag within acceptable thresholds?

---

## 8. DLQ Is Not a Trash Can

Day one on Kafka, every team is confident: "If there's an error, throw it into DLQ, don't block the consumer." So every unhandled exception gets produced to a nicely named topic: `order-dlq`, `payment-dlq`.

Initially, DLQ looks clean: a few dozen messages per day. Three months later: DLQ has millions of messages. No one dares to read them. No one dares to replay. No one dares to delete. DLQ becomes a message graveyard — wasting resources, wasting storage money, and completely useless.

**The mistake:** every type of error gets dumped into one place. Permanent errors, transient errors, code bugs, data quality issues — all become a chaotic mess.

**Spring Kafka DLQ support:** `DefaultErrorHandler` can be configured to automatically send failed messages to DLQ. But it needs proper configuration:

```java
@Bean
public DefaultErrorHandler errorHandler(KafkaTemplate<String, Object> template) {
    DefaultErrorHandler handler = new DefaultErrorHandler(
        new DeadLetterPublishingRecoverer(template),
        new FixedBackOff(1000L, 3) // retry 3 times, 1 second apart
    );
    handler.addNotRetryableExceptions(JsonParseException.class);
    handler.addRetryableExceptions(TimeoutException.class);
    return handler;
}
```

**DLQ only has value when it has semantics:** Every message in DLQ must answer three questions:

- Why did it fail? (error category, error message, stack trace)
- What type of failure? (permanent/transient, retryable/non-retryable)
- Should it be replayed? And how?

**Designing DLQ for production:**

**Only push permanent errors to DLQ:** Transient errors go to Retry Topic with backoff strategy. Bug in code? Fix code then replay from old offset, no DLQ needed.

**DLQ payload must be rich in metadata:** Use Spring Kafka's `DeadLetterPublishingRecoverer`, which automatically adds headers: `kafka_dlt-exception-fqcn`, `kafka_dlt-exception-message`, `kafka_dlt-exception-stack-trace`, `kafka_dlt-original-topic`, `kafka_dlt-original-partition`, `kafka_dlt-original-offset`.

---

## 9. Configuration Is Not Just Default Values

Every tutorial uses default config. Production needs tuning based on workload patterns, SLA, and infrastructure.

**Configs that need careful tuning:**

**`max.poll.records` — a double-edged sword:**

- Too high: long processing, easily exceeds `max.poll.interval.ms` → rebalance
- Too low: low throughput, high network overhead
- Approach: start with small values (10-100), monitor, gradually increase if system is stable

**`fetch.min.bytes` vs `fetch.max.wait.ms` — latency-throughput tradeoff:**

- `fetch.min.bytes=1`, `fetch.max.wait.ms=500`: low latency, high CPU/network
- `fetch.min.bytes=524288` (512KB), `fetch.max.wait.ms=500`: larger batches, higher throughput, slightly increased latency
- Tune based on SLA: real-time systems need low latency, batch processing needs high throughput

**`session.timeout.ms` vs `heartbeat.interval.ms` — keeping connections alive:**

- Rule of thumb: `session.timeout.ms` = 3 × `heartbeat.interval.ms`
- Unstable network environments: increase `session.timeout.ms` (e.g., 30s instead of 10s)
- But be careful: timeout too high → slow detection of dead consumers, partitions not reassigned in time

**`acks` — durability vs latency:**

- `acks=0`: fire-and-forget, highest throughput, may lose messages
- `acks=1`: leader writes then replies, good balance for many use cases
- `acks=all`: ensures replicas have written, safest, highest latency
- **Production recommendation:** `acks=all` for critical data (financial transactions), `acks=1` for the rest

**Auto Offset Reset — development only:**

- `auto.offset.reset=earliest`: development — want to read all data
- `auto.offset.reset=latest`: development — only care about new messages
- **Production:** Do NOT use auto.offset.reset! Always manage offsets manually or use Spring Kafka's `ConsumerSeekAware` for precise offset control.

---

## Conclusion

Kafka isn't hard. How people use Kafka is hard.

Tutorials teach you API, concepts, happy paths. Production teaches you:

- Offsets are money, rebalance is a storm, wrong commits lose everything
- Retry is not a Kafka core feature, it's from client libraries — and it's a knife that needs both hands to hold
- DLQ is not a trash can, it's an emergency room needing a skilled doctor
- Observability is not a luxury feature, it's a survival skill
- Monitoring is not for admiring pretty charts, it's for preventing 2 AM nightmares

**Important correction about retry:** Remember clearly — **Kafka broker has no retry mechanism**. Retry is provided by client libraries (Spring Kafka, kafka-python, etc.). Spring Kafka retry is client-side retry: throw exception → Spring catches → retry per configuration → if still failing, send to DLQ or skip.

If you've never lost a message, never duplicated data, never endured a rebalance storm, you haven't truly used Kafka in production. But once you've been through those things — debugged all night, learned to read metrics instead of logs, designed systems with failure as a first-class citizen — you'll understand: Kafka production-ready is not a feature checklist, it's a mindset.

A mindset of humility before the complexity of distributed systems. A mindset of defense in depth instead of blind trust. A mindset of observability-driven development instead of "it works on my machine."

Kafka gives you the power to process millions of messages per second. But with great power comes great responsibility. The responsibility to understand your system deeply, the responsibility to design for failure, and the responsibility not to let one small bad message bring down the entire system.

Welcome to the world of Kafka production — where everything can fail, and your job is to ensure that when it fails, it fails gracefully.
