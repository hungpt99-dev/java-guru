---
title: "Kafka: The Lessons Only Production Teaches You"
description: "No Kafka tutorial prepares you for the feeling of being woken up at 2 a.m. because consumer lag is rising uncontrollably. You open Grafana and see the offset standing still like a bronze statue."
slug: "kafka-nhung-bai-hoc-chi-production-moi-day-ban"
locale: "en"
translationKey: "kafka-nhung-bai-hoc-chi-production-moi-day-ban"
pubDate: 2026-01-24T14:31:22+07:00
category: "Distributed Systems"
tags: ["apache kafka", "microservices", "System Design"]
featured: true
draft: false
series: null
coverImage: "./cover.png"
readingTime: 13
---

# Introduction

No Kafka tutorial prepares you for the feeling of being woken up at 2 a.m. because consumer lag is rising uncontrollably. You open Grafana and see the offset standing still like a bronze statue. You restart the pod - lag drops a little, then clings on tight again. You add more consumers - five minutes later, the whole group is rebalancing continuously and throughput falls back to 0. The entire system is clinically dead because of a handful of bad messages.

Kafka on slides is always perfectly clean: at-least-once, offset, partition, consumer group, retry. Every example is neat, every flow is a "happy path", every error is handled in 3 lines of code.

Kafka in production is different. It doesn't care how carefully you read the documentation. It only cares where you commit offsets wrong, how long you block the poll thread, and how uncontrolled your retries are. It's a battlefield where theory meets reality, where "it works on my machine" gets smashed to pieces.

This post doesn't teach you the Kafka API - hundreds of tutorials already do that. It records the hard-earned lessons that only come after a few real incidents, when data is duplicated left and right, messages disappear without a trace, and the whole system freezes over one seemingly tiny message. These are the things that aren't in the official documentation, yet they decide the survival of your system.

---

## 1. One bad message can clog the entire system

Most tutorials teach you to write a consumer handler with a very pretty formula: deserialize the message, call the service to handle the business logic, throw an exception if it fails. The code looks neat, runs smoothly locally, and QA testing doesn't find any issues either.

Production will give you an expensive lesson: it only takes one message with a "dirty" payload — wrong JSON schema, unexpectedly null field, unmappable enum value — and your handler throws an exception. **Spring Kafka** retries that message (if configured). The handler throws again. This loop continues until... you have to intervene manually.

**Distinguishing error types is a survival skill:**
- **Permanent errors (not retryable):** JSON parse errors, schema violations, validation errors, business logic errors. Retrying 1,000 times won't make that JSON any more valid. These are the errors that need to be handled immediately and pushed into the Dead Letter Queue.
- **Transient errors (retryable):** temporary network errors, database connection timeouts, brief deadlocks, temporarily unavailable dependency services. There's a chance of success after a controlled number of retries.

**Important note:** **Kafka core has no retry mechanism.** Retry is provided by **client libraries** like Spring Kafka through the `DefaultErrorHandler` with a `RetryTemplate`. If not configured correctly, an exception will block the consumer loop.

**Schema Registry is the first shield:** Using Schema Registry with STRONG compatibility mode catches schema errors right on the producer side. Invalid messages are rejected before they enter the topic and never reach your consumer. This is proactive defense instead of reactive handling.

**Handle it properly from the start:** Permanent-error messages must go straight into the DLQ with full metadata - what the error was, when it happened, how many retries, and most importantly: whether it can be replayed. Don't let one bad message block the whole partition; commit its offset after handling it appropriately so the consumer can continue.

---

## 2. Rebalance can destroy throughput

Rebalance is Kafka's mechanism for redistributing partitions among consumers when something changes in the group. In production, rebalances happen more often than you think: a new deploy, a pod restart, a slight network blip, a slow consumer.

**The deadly mistake:** You block message processing for too long in the poll thread, exceeding `max.poll.interval.ms` (usually 5 minutes). The broker doesn't see a heartbeat, thinks the consumer is "dead", kicks it out of the group → triggers a full rebalance. During the rebalance (which can take tens of seconds to several minutes), no messages are processed and throughput drops to 0.

**Static Membership - the savior of stability:** Since Kafka 2.3, you can configure `group.instance.id`. When a consumer restarts with the same instance ID, the broker recognizes it as an "old friend" and allows it to rejoin without triggering a full group rebalance, as long as the assignment is still valid. This is especially important in container-based deployment environments where pods restart frequently.

**Keep the poll thread light:** The poll thread should only do one thing - fetch messages and send heartbeats. Never run heavy business logic in this thread. Spring Kafka has `ConcurrentKafkaListenerContainerFactory` which allows parallel processing, but you need to understand how it manages offsets and threads.

**Tune configuration dynamically:** Lower `max.poll.records` when processing is slow, raise it when the system is idle. Adjust `fetch.min.bytes` and `fetch.max.wait.ms` to balance latency and throughput according to the actual load pattern.

---

## 3. Retrying the wrong way will kill downstream

Tutorials usually say: "Use exponential backoff, retry 5 times and you're done." Sounds reasonable, until you face reality.

The classic production scenario: The downstream service has a 2-second timeout. There are 1,000 messages all calling that endpoint. Each message retries 5 times = 5,000 requests hammering in within a few minutes. The downstream service dies completely → all messages fail → retry again → forming a **retry storm** that utterly destroys the downstream service.

**Retry in Spring Kafka is client-side:** Spring Kafka provides `RetryTemplate` with `ExponentialBackOffPolicy` or `FixedBackOffPolicy`. But retrying immediately in the same consumer thread can cause blocking and rebalance.

**Independent retry pipeline - the mature solution:**
- The main consumer only handles messages that succeed on the first attempt
- On a transient error → produce to a Retry Topic with a delay timestamp (5s, 30s, 2 minutes, 10 minutes...)
- A separate retry consumer processes messages from the Retry Topic after the predetermined delay
- After N failed retries → push into the DLQ for manual inspection

**Spring Kafka has built-in retry with backoff:** You can configure `DefaultErrorHandler` with `FixedBackOff` or `ExponentialBackOff`. But be careful: retrying too many times in the same thread will block processing of other messages.

**Circuit breaker - not a luxury but a necessity:** Monitor error rates in real time. When the error rate exceeds a threshold (for example: 50% within 1 minute), automatically pause retries and push messages straight into the DLQ. Don't keep beating on a service that's already dead.

**Jitter in backoff:** Add randomness to the retry interval to avoid the "thundering herd" phenomenon - all retries firing at the same moment after each cycle.

---

## 4. Consumer is not thread-safe - how do you commit offsets safely?

This sentence needs to be engraved in your mind: **The Kafka consumer client is NOT thread-safe.**

The most common mistake: Process messages in a thread pool, then commit offsets from the worker thread → race condition → wrong offset commit → mass message loss or duplication. You won't know this happened until customers complain about missing or duplicated data.

**Spring Kafka manages offsets automatically, but...:** With `@KafkaListener` and the default `AckMode` (BATCH), Spring commits offsets automatically after the batch is processed. But if you process asynchronously with `@Async` or a thread pool without managing offsets manually, you'll run into problems.

**A safe commit model in production with Spring Kafka:**

**Smart AckMode:**
- `RECORD`: commit after each message → high overhead, but the safest
- `BATCH`: commit after each batch → a good balance, but if one message in the batch fails, the whole batch gets retried
- `MANUAL`/`MANUAL_IMMEDIATE`: commit manually when you're ready → the most flexible, but requires careful code

**Managing offsets in order within a partition:** Kafka only guarantees ordering within a single partition. Offsets must be committed in increasing order. If you process multiple messages from the same partition in parallel, you need to make sure commits happen in the correct order.

**Only one thread should commit:** When using `ConcurrentMessageListenerContainer`, each partition is processed by a separate thread. Spring manages this well, but if you build your own thread pool, you must ensure each partition has only one thread processing it.

---

## 5. Producer: Idempotence, Transaction and Outbox Pattern

`producer.send(record)` in a tutorial is far from `producer.send(record)` in production.

**Three layers of defense for the producer:**

**Idempotence - the baseline layer:** Always enable `enable.idempotence=true`. This feature assigns each producer an ID and numbers a sequence for each message, helping the broker detect and eliminate duplicates caused by producer retries (within the same producer session). This is a "must have", not a "nice to have".

**Transaction - for cross-partition atomicity:** Spring Kafka supports transactions through `KafkaTransactionManager`. When you need atomicity across multiple partitions/topics - for example: consume a message from an input topic and produce a message to an output topic within the same transaction. Transactions guarantee all-or-nothing semantics. But remember: transactions have overhead, only use them when you really need to.

**Outbox Pattern - solving the classic problem:** This is the most important model for distributed transaction systems. "Commit the database first or send the Kafka message first?" - the Outbox Pattern answers: both, but in the right order.

1. Within the same database transaction as the business logic, write the event into the `outbox` table
2. Commit the transaction (business data + outbox record)
3. A background process (CDC or a scheduled job) reads from `outbox` and produces to Kafka
4. Mark the outbox record as published

Guarantee: if the business transaction succeeds → the event will be sent to Kafka (at least once). This pattern solves the dual-write problem without needing complex distributed transactions.

---

## 6. The race condition tutorials never mention

Kafka only guarantees ordering **within a single partition**, not ordering according to your business logic.

**The classic headache-inducing scenario:** Message A (update order status = "PROCESSING") and message B (update order status = "COMPLETED") for the same `order_id=123`. If they land in two different partitions because of different hash keys, the consumer processes them in parallel → message B may be processed before message A → the order status jumps from "PENDING" straight to "COMPLETED" and only then back to "PROCESSING".

**Partition key strategy - the key to ordering:** Always use `entity_id` as the partition key for all messages related to the same entity. This ensures all events for the same entity land in the same partition and are processed sequentially.

**Idempotent processing - the final line of defense:** Even with ordering within a partition, duplicates can still happen because of retries. Use a version number or a conditional update in the database:

```sql
UPDATE orders 
SET status = 'COMPLETED', version = 2
WHERE order_id = 123 AND version = 1;
```

If this update fails (version mismatch), you know there was a concurrent update and you need to handle the conflict.

**Debezium/CDC when you need strong ordering:** Sometimes, instead of producing events from application code, consider using Change Data Capture (Debezium) to stream database change events. CDC guarantees ordering by commit order in the database, and is often the most powerful solution for event ordering.

---

## 7. Observability: You can't debug what you don't measure

Lag metrics from Kafka (consumer lag) are necessary but not sufficient. It's like only looking at the speedometer without knowing where the car is, how much fuel is left, or whether the engine is overheating.

**Production observability checklist:**

**Distributed Tracing is mandatory:** Inject the trace-id into the message header at the producer, propagate it through every consumer, service call, and database query. Spring Cloud Sleuth or Micrometer Tracing does this well.

**Business Metrics - measuring what actually matters:**
- Number of messages processed successfully/failed per minute, categorized by error type
- Average processing time, p95, p99 (to detect outliers)
- Rate of messages entering the DLQ, Retry Topic
- End-to-end latency: from the moment of produce to the moment consumption completes

**Kafka Client Metrics:** Spring Kafka integrates with Micrometer, exposing metrics:
- `spring.kafka.consumer.records.consumed`
- `spring.kafka.consumer.fetch.manager.records.lag`
- `spring.kafka.producer.record.send.total`

**Meaningful health checks:** Spring Actuator with a `HealthContributor` for Kafka. The consumer's health check endpoint shouldn't just return "UP". It should tell you: does the consumer have assigned partitions? Is it rebalancing? Is the lag within the allowed threshold?

---

## 8. A DLQ is not a trash can

On their first day on Kafka, every team is very confident: "If something fails, throw it into the DLQ, no need to block the consumer." So every unhandled exception gets produced to a very nicely named topic: `order-dlq`, `payment-dlq`.

At first the DLQ looks very clean: a few dozen messages a day. Three months later: the DLQ has a few million messages. Nobody dares to read it. Nobody dares to replay it. Nobody dares to delete it. The DLQ becomes a message graveyard - wasting resources, wasting storage money, and completely useless.

**The mistake is here:** all kinds of errors get thrown into one place. Permanent errors, transient errors, bugs in the code, data quality issues - all become one chaotic pile.

**Spring Kafka DLQ support:** `DefaultErrorHandler` can be configured to send failed messages to the DLQ automatically. But it needs to be configured correctly:

```java
@Bean
public DefaultErrorHandler errorHandler(KafkaTemplate<String, Object> template) {
    DefaultErrorHandler handler = new DefaultErrorHandler(
        new DeadLetterPublishingRecoverer(template),
        new FixedBackOff(1000L, 3) // retry 3 lần, mỗi lần cách 1 giây
    );
    handler.addNotRetryableExceptions(JsonParseException.class);
    handler.addRetryableExceptions(TimeoutException.class);
    return handler;
}
```

**A DLQ only has value when it has semantics:** Each message in the DLQ must be able to answer three questions:
1. Why did it fail? (error category, error message, stack trace)
2. What kind of failure is it? (permanent/transient, retryable/non-retryable)
3. Should it be replayed? And how should it be replayed?

**Designing a DLQ for production:**

**Only push permanent errors into the DLQ:** Transient errors go to a Retry Topic with a backoff strategy. A bug in the code? Fix the code and replay from the old offset, no DLQ needed.

**The DLQ payload must be rich in metadata:** Use Spring Kafka's `DeadLetterPublishingRecoverer`, it automatically adds headers: `kafka_dlt-exception-fqcn`, `kafka_dlt-exception-message`, `kafka_dlt-exception-stack-trace`, `kafka_dlt-original-topic`, `kafka_dlt-original-partition`, `kafka_dlt-original-offset`.

---

## 9. Configuration is more than default values

Every tutorial uses the default config. Production needs tuning based on workload patterns, SLAs, and infrastructure.

**The configs that need careful tuning:**

**`max.poll.records` - a double-edged sword:**
- Too high: slow processing, easily exceeds `max.poll.interval.ms` → rebalance
- Too low: low throughput, high network overhead
- Approach: start with a small value (10-100), monitor, increase gradually if the system is stable

**`fetch.min.bytes` vs `fetch.max.wait.ms` - the latency-throughput tradeoff:**
- `fetch.min.bytes=1`, `fetch.max.wait.ms=500`: low latency, high CPU/network
- `fetch.min.bytes=524288` (512KB), `fetch.max.wait.ms=500`: larger batches, higher throughput, slightly increased latency
- Tune based on SLA: real-time systems need low latency, batch processing needs high throughput

**`session.timeout.ms` vs `heartbeat.interval.ms` - keeping the connection alive:**
- Rule of thumb: `session.timeout.ms` = 3 × `heartbeat.interval.ms`
- Unstable network environments: increase `session.timeout.ms` (for example: 30s instead of 10s)
- But be careful: too high a timeout → slow detection of dead consumers, partitions not reassigned in time

**`acks` - durability vs latency:**
- `acks=0`: fire-and-forget, highest throughput, messages can be lost
- `acks=1`: the leader replies once it has written, a good balance for many use cases
- `acks=all`: guarantees replicas have written, the safest, highest latency
- **Production recommendation:** `acks=all` for critical data (financial transactions), `acks=1` for the rest

**Auto Offset Reset - development only:**
- `auto.offset.reset=earliest`: development - you want to read all the data
- `auto.offset.reset=latest`: development - you only care about new messages
- **Production:** Do NOT use auto.offset.reset! Always manage offsets manually or use Spring Kafka's `ConsumerSeekAware` to control offsets precisely.

---

## Conclusion

Kafka isn't hard. The way people use Kafka is what's hard.

Tutorials teach you the API, teach you the concepts, teach you the happy path. Production teaches you:
- Offset is money, rebalance is a storm, a wrong commit loses everything
- Retry isn't a feature of Kafka core, but of client libraries - and it's a knife that needs to be held with both hands
- The DLQ isn't a trash can, but an emergency room that needs a doctor with expertise
- Observability isn't a luxury feature, but a survival skill
- Monitoring isn't for admiring pretty charts, but for preventing the 2 a.m. nightmare

**An important correction about retry:** Remember clearly - **the Kafka broker has no retry mechanism**. Retry is provided by client libraries (Spring Kafka, kafka-python, etc.). Spring Kafka retry is client-side retry: throw an exception → Spring catches it → retry according to configuration → if it still fails, send it to the DLQ or skip it.

If you've never lost a message, never duplicated data, never taken a rebalance storm, then you haven't really used Kafka in production. But once you've been through those things - when you've debugged all night, when you've learned to read metrics instead of logs, when you've designed systems with failure as a first-class citizen - you'll understand: Kafka production-ready isn't a feature checklist, it's a mindset.

The mindset of humility before the complexity of distributed systems. The mindset of layered defense instead of blind trust. The mindset of observability-driven development instead of "it works on my machine".

Kafka gives you the power to process millions of messages per second. But with great power comes great responsibility. The responsibility to understand your system deeply, the responsibility to design for failure, and the responsibility not to let one small bad message bring down the whole system.

Welcome to the world of Kafka in production - where everything can fail, and your job is to make sure that when it fails, it fails gracefully.
