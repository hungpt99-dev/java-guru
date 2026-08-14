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

Kafka is the topic that separates "I've sent a message" from "I understand a distributed log". Junior developers produce and consume; seniors reason about ordering, exactly-once, and what happens when a consumer falls behind — with the config and code to prove it. This post climbs from topics to delivery guarantees to lag at scale: 50 questions, pick the level you are interviewing at, and read one above it.

> Mindset: junior sends a record and hopes it arrives; senior can tell you the exact semantics of "arrives" and what they built so a poison message can never take down the pipeline.

## Junior — foundations

**Q1. What are topics, partitions, and offsets?**
A topic is a named log split into **partitions** — ordered, append-only logs. Each record gets a sequential **offset** within its partition. More partitions = more parallelism, but also more open files (each partition is a directory of ~1 GB segment files) and slightly longer rebalances. A topic with 50 partitions on a 3-broker cluster is a normal starting point:

```bash
kafka-topics --create --topic orders --partitions 50 --replication-factor 3 \
  --bootstrap-server broker-1:9092
```

Each partition has one leader and (RF−1) followers; 50 partitions × RF 3 = 150 replica assignments to spread across the brokers.

**Q2. Producer vs consumer, and consumer groups?**
A producer appends to a topic; a consumer in a **consumer group** gets exclusive access to a subset of partitions. With 12 partitions and 4 consumers, each consumer handles 3 partitions. Adding a 5th consumer leaves one idle (you can't have more active consumers than partitions). The `group.id` is what makes Kafka scale horizontally — every instance with the same id shares the load:

```java
props.put(ConsumerConfig.GROUP_ID_CONFIG, "orders-service"); // all instances split the partitions
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
```

Two different groups reading the same topic are fully independent — each keeps its own offsets and reads at its own pace.

**Q3. What is `acks` and why does it matter?**
`acks=0` (fire-and-forget, ~0 guarantee), `acks=1` (leader acks; lost if leader dies pre-replica), `acks=all` (all in-sync replicas ack — strongest, but ~2–5× higher latency, ~20–50 ms vs ~2–5 ms). Durability vs latency, directly:

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true"); // no duplicates on retry
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "30000"); // how long to keep trying
```

The leader can only tell followers "commit" once the record is in all ISR members' logs; `acks=all` just means you wait for that decision instead of guessing.

**Q4. What is a keyed message and why use one?**
A key routes all records with the same key to the **same partition** (murmur2 hash), giving **per-key ordering**. Records with no key are round-robined (since Kafka 2.4, a sticky partitioner fills one batch before moving on) — no ordering guarantee:

```java
// same key -> same partition -> in order. Critical for "all events for user 42 in order"
producer.send(new ProducerRecord<>("orders", user.getId(), orderEvent));
```

The corollary interviewers probe: one hot key (a celebrity user) makes one partition hot — keying buys order at the price of skew.

**Q5. Queue vs Kafka log?**
A queue removes a message once consumed; Kafka is an append-only log — every consumer reads the full history at its own offset, and messages expire by **retention** (e.g. 7 days), not on read. Retention 7 days at 10 GB/day of writes means ~70 GB of disk per topic you must provision:

```bash
kafka-configs --alter --entity-type topics --entity-name orders \
  --add-config retention.ms=604800000   # 7 days in milliseconds
```

That is also why "who read it?" is the wrong question for Kafka — the log keeps the record until retention deletes it, regardless of consumption.

**Q6. What does a consumer group do on a crash?**
When a member dies, its partitions are **reassigned** (a rebalance) to survivors. During a rebalance all group members stop consuming briefly. Frequent rebalances (from slow poll heartbeats) cause throughput cliffs. Three dials decide whether you get kicked out of the group:

```java
props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, "45000");    // default 45 s since Kafka 2.3
props.put(ConsumerConfig.HEARTBEAT_INTERVAL_MS_CONFIG, "3000");  // must be well under the timeout
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, "300000"); // 5 min to finish a poll cycle
```

**Q7. Where are committed offsets stored?**
Committed offsets live in an internal compacted topic called `__consumer_offsets` (50 partitions by default), not on the consumer. Every `commitSync()` writes there; on restart the group resumes from it. One command shows group state, per-partition offsets, and lag:

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
```

Pitfall: offsets expire after `offsets.retention.minutes` (default 7 days) when a group stays empty — a long-silent group returns to `auto.offset.reset` instead of its old position.

**Q8. What are serializers and where do they break?**
Brokers store bytes; serializers are a client-side contract. String for keys, JSON/`String` for values, Avro + Schema Registry for evolving schemas. The classic 3 a.m. crash: a JSON consumer without `trusted.packages` rejects every record produced by another service:

```java
props.put(JsonDeserializer.TRUSTED_PACKAGES, "com.acme.orders.*");
props.put(JsonDeserializer.VALUE_DEFAULT_TYPE, OrderEvent.class);
```

Serializer and deserializer must match on both ends — a `StringSerializer` writer against a JSON reader yields a `JsonMappingException` on every record and the group falls behind.

**Q9. What is `bootstrap.servers` really for?**
It lists brokers for the initial **metadata handshake** only — the client then connects directly to each partition's leader. One broker is technically enough; you list 3+ so a metadata fetch survives a dead broker, and clients re-fetch metadata every 5 minutes:

```java
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "broker-1:9092,broker-2:9092,broker-3:9092");
props.put(ProducerConfig.METADATA_MAX_AGE_CONFIG, "300000"); // re-fetch partition layout every 5 min
```

This is why a topic expansion takes effect within ~5 minutes: clients learn about new partitions on the next metadata refresh.

**Q10. How does the partitioner work, and can you replace it?**
The **DefaultPartitioner** hashes the key with **murmur2** and mods by partition count — same key, same partition, deterministic. Null keys get **sticky partitioning** (Kafka 2.4+): records pile into one batch per partition instead of round-robining, which lifts batch efficiency. Custom routing (shard a hot key, pin tenants to ranges) implements `Partitioner`:

```java
public class TenantPartitioner implements Partitioner {
  public int partition(String topic, Object key, byte[] keyBytes, Object value,
                       byte[] valueBytes, Cluster cluster) {
    return Math.abs(key.toString().hashCode()) % cluster.partitionCountForTopic(topic);
  }
}
props.put(ProducerConfig.PARTITIONER_CLASS_CONFIG, TenantPartitioner.class.getName());
```

Warning: any partitioner change re-routes keys mid-stream — your ordering guarantees shift with it.

**Q11. What does `consumer.poll()` actually do?**
`poll()` is the heartbeat, fetch, and rebalance engine in one call; it returns up to `max.poll.records` (default 500) and must keep being called even when idle. The canonical loop:

```java
while (running) {
  ConsumerRecords<String, Order> records = consumer.poll(Duration.ofMillis(100));
  for (ConsumerRecord<String, Order> r : records) process(r);
  consumer.commitSync(); // offsets advance only here
}
```

Spring Kafka wraps this loop in `KafkaMessageListenerContainer` — your `@KafkaListener` method runs inside it, which is exactly why a slow method trips `max.poll.interval.ms`.

**Q12. How does producer batching work, and what are the knobs?**
`send()` doesn't touch the network — records land in the `RecordAccumulator` (`buffer.memory`, default 32 MB) and leave in batches of `batch.size` (default **16 KB**) after `linger.ms` (default 0). Raising `linger.ms` to 5–10 ms trades milliseconds of latency for 3–5× higher throughput via fuller batches:

```java
props.put(ProducerConfig.BATCH_SIZE_CONFIG, "16384");       // 16 KB default
props.put(ProducerConfig.LINGER_MS_CONFIG, "10");           // wait up to 10 ms for a fuller batch
props.put(ProducerConfig.BUFFER_MEMORY_CONFIG, "67108864"); // 64 MB accumulator
```

At 1M msg/s × 500 B that's 500 MB/s of records; in 16 KB batches that's ~31k batches/s — the broker's appends become the ceiling, not your CPU.

**Q13. What is `auto.offset.reset` and when does it matter?**
A brand-new group has no committed offset, so the broker picks a start: `earliest` (the full history within retention), `latest` (default — only new records), or `none` (fail if no offset exists). It's a one-time decision per group that silently decides how much of the backlog a new deployment eats:

```java
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest"); // reprocess up to 7 days of history
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "latest");   // skip the backlog, start fresh
```

`kafka-console-consumer --from-beginning` is the CLI version of earliest. Mis-picking is why a new consumer "misses" events — or re-fires a month of side effects.

**Q14. What is a broker, and where does cluster metadata live?**
A broker is one server holding partition leaders + followers; one broker doubles as **controller**, electing partition leaders and tracking membership. Kafka's metadata store was ZooKeeper; since Kafka 3.x **KRaft** replaced it with an internal Raft-based controller quorum, and Kafka 4.0 removed ZooKeeper entirely:

```bash
# KRaft: generate a cluster id, format storage, start — no ZooKeeper anywhere
kafka-storage random-uuid > /tmp/cluster-id
kafka-storage format -t "$(cat /tmp/cluster-id)" -c config/kraft/server.properties
kafka-server-start config/kraft/server.properties
```

Interview-wise, ZooKeeper is legacy vocabulary; KRaft (Raft, controller quorum) is the current answer.

**Q15. How is a partition leader elected?**
Each partition has one **leader** (all reads and writes) with followers replicating it. When the leader dies, the controller picks a new leader **from the ISR** — a follower behind the ISR cannot become leader, which protects against truncating uncommitted records. `unclean.leader.election.enable=false` (default) means you prefer durability over availability when every ISR member is gone:

```bash
kafka-leader-election --bootstrap-server broker-1:9092 --topic orders \
  --partition 12 --election-type preferred
```

A **preferred** election returns leadership to the original assignment so load spreads evenly again after a broker comes back.

**Q16. What's inside a `ProducerRecord` — key, value, headers, timestamp?**
Every record is a key (routing), value (payload), timestamp (defaults to broker arrival), and headers (trace ids, schema versions, correlation ids). Headers travel with the record and are the cheap way to trace one order across five services:

```java
ProducerRecord<String, OrderEvent> record = new ProducerRecord<>(
    "orders", 2, System.currentTimeMillis(),   // topic, partition, timestamp
    order.getId(), order,                       // key, value
    new RecordHeaders().add("traceparent", traceBytes));
producer.send(record);
```

A `traceparent` header is how you follow a request through produce → consume → produce without parsing payloads.

**Q17. Session timeout vs poll interval — which one kicks you?**
Two independent timers eject you from the group. `session.timeout.ms` (default 45 s) fires when the **background heartbeat thread** misses heartbeats (sent every 3 s) — broker gone, or a GC pause longer than 45 s. `max.poll.interval.ms` (default 5 min) fires when processing a polled batch takes too long — you're alive but not making progress. Slow handlers trip the second; dead instances trip the first:

```java
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, "600000"); // 10 min for slow handlers
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "100");        // smaller batches -> faster cycles
```

Rule of thumb: batch processing time × `max.poll.records` must fit well inside `max.poll.interval.ms`, or the group kicks you mid-deploy.

## Mid — tradeoffs & pitfalls

**Q18. The three delivery semantics.**

- **At-most-once**: `acks=0`; possible loss, no duplicates.
- **At-least-once**: `acks=all` + retries; no loss, possible duplicates (crash after process, before commit).
- **Exactly-once**: idempotent producer + transactional writes, or Kafka transactions; consumers must opt in with `read_committed`:

```java
props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed"); // only see committed txn records
```

Most teams settle for at-least-once + an idempotent sink — cheaper than transactions and usually sufficient.

**Q19. Per-key ordering and what breaks it.**
Key → same partition → in-order. Breaks when you change partition count (a rehash moves keys to new partitions mid-stream) or on a reassignment. Ordering is per-partition, never global, unless you have one partition (no parallelism):

```bash
kafka-topics --alter --topic orders --partitions 60   # keys re-shuffle NOW
```

Every record for a key continues to one partition, but which partition — and the relative order of records written before/after the expansion — can change.

**Q20. Consumer lag and why monitor it.**
Lag = produced-but-not-consumed (high-water-mark offset minus committed offset). At 10k msg/s with a consumer doing 20 ms of work per batch of 500, lag stays near zero; if processing slips to 200 ms/batch, lag grows by ~thousands/sec and can exceed the 7-day retention — **permanent data loss for the slow consumer**:

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
#  TOPIC  PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
#  orders 0          482130          482210          80
```

Watch the per-partition LAG column, not just the group total — one hot partition hides inside a healthy-looking average.

**Q21. Idempotent production.**
`enable.idempotence=true` gives the producer a PID + sequence numbers; the broker deduplicates retried batches, so a retry after a timeout that actually committed can't double-write. Pair with keyed partitioning for safe ordered retries:

```java
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true"); // requires acks=all, retries>0
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, "5"); // ≤5 for idempotence
```

Idempotence dedupes per producer instance and epoch — it does not cover two different producers writing the same data; that needs application-level dedupe (Q34).

**Q22. Rebalances — make them cheap.**
Tune `max.poll.interval.ms` (default 5 min) and `max.poll.records` (default 500) so a slow batch doesn't trigger a timeout rebalance. Prefer incremental **cooperative** rebalancing (Kafka 2.4+) over stop-the-world eager rebalances:

```java
props.put(ConsumerConfig.PARTITION_ASSIGNMENT_STRATEGY_CONFIG,
    CooperativeStickyAssignor.class.getName());
```

Cooperative rebalancing only revokes the partitions that must move instead of the whole group — the difference between a 30 s pause and a 2 s hiccup on a 50-partition topic.

**Q23. Replication and ISR.**
Each partition has a leader + followers; the **in-sync replica (ISR)** set are followers caught up within `replica.lag.time.max.ms` (default 30 s). With `min.insync.replicas=2` and `replication.factor=3`, you survive one broker loss with no data loss. If two brokers die, that partition becomes unavailable (durability over availability):

```java
props.put("min.insync.replicas", "2"); // with replication.factor=3
```

```bash
kafka-topics --describe --topic orders   # ISR column: replicas behind the leader drop out
```

Tradeoff to defend: if the ISR ever shrinks below `min.insync.replicas`, producers get `NotEnoughReplicasException` — you chose durability, and the write is rejected rather than half-replicated.

**Q24. commitSync vs commitAsync, and commit ordering.**
Offsets must be committed **after** processing, never before — and `enable.auto.commit=true` (the default!) commits at the next `poll()` every `auto.commit.interval.ms` (5 s), so a crash in that window replays records (at-least-once). Committing _before_ processing loses them permanently. Production pattern:

```java
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false"); // committing is MY decision
while (running) {
  ConsumerRecords<String, Order> records = consumer.poll(Duration.ofMillis(100));
  process(records);          // side effects FIRST
  consumer.commitSync();     // then record progress — never the reverse order
}
```

`commitSync` retries and blocks (correct); `commitAsync` is fire-and-forget (fast, can drop commits). The worst hybrid: async commit then immediate shutdown — the last commits vanish and the group replays them.

**Q25. One record is 2 MB and your pipeline dies. Why?**
The broker rejects records bigger than `message.max.bytes` (default **1 MB**) with `RecordTooLargeException`, and the producer's `max.request.size` defaults to 1 MB too — the send fails before it leaves the machine. To carry big payloads you must raise all three sides:

```java
props.put(ProducerConfig.MAX_REQUEST_SIZE_CONFIG, "10485760");      // producer: 10 MB
props.put(ConsumerConfig.FETCH_MAX_BYTES_CONFIG, "10485760");       // consumer: 10 MB
// broker: kafka-configs --alter --entity-type brokers --entity-default \
//   --add-config message.max.bytes=10485760
```

The better engineering answer: 2 MB JSON blobs belong in an object store — a URL in the record keeps Kafka at 1 MB and consumers fast.

**Q26. Compression: why, and which codec?**
Compression happens per batch **on the client**, so it pairs with `linger.ms` — bigger batches compress better. zstd (Kafka 2.1+) wins on ratio (~2–3×), snappy/lz4 on CPU; the cost is ~5–10% producer CPU:

```java
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd"); // none | gzip | snappy | lz4 | zstd
```

At 1M msg/s × 500 B ≈ 500 MB/s ≈ 4 Gbps — over 1 Gbps NICs that's four links. zstd at ~3× drops it to ~1.4 Gbps, which fits a pair. Consumers decompress transparently; keep `compression.type` consistent per topic.

**Q27. `subscribe` vs `assign` — when is manual assignment right?**
`subscribe()` joins a group: rebalancing, cooperative assignment, shared offsets. `assign()` takes partitions manually — no group, no rebalance, nobody moves your partitions mid-job, and nobody commits for you:

```java
consumer.subscribe(List.of("orders"));            // group-managed; rebalances on membership change
consumer.assign(List.of(new TopicPartition("orders", 3))); // manual — you own partition 3, period
```

Use `subscribe` by default; `assign` for utilities (a one-off replayer, a lag dumper, a test consumer) that must not be rebalanced away.

**Q28. How does Spring Kafka's `@KafkaListener` actually run?**
A `@KafkaListener` method runs inside a `ConcurrentMessageListenerContainer`; `concurrency` = number of consumer instances in the group, and `ackMode` decides when the container commits for you:

```java
@Bean
public ConcurrentKafkaListenerContainerFactory<String, Order> kafkaListenerContainerFactory(
    ConsumerFactory<String, Order> cf) {
  ConcurrentKafkaListenerContainerFactory<String, Order> f =
      new ConcurrentKafkaListenerContainerFactory<>();
  f.setConsumerFactory(cf);
  f.setConcurrency(4);                                        // 4 consumers, 4 partitions at a time
  f.getContainerProperties().setAckMode(ContainerProperties.AckMode.BATCH);
  return f;
}

@KafkaListener(topics = "orders", groupId = "orders-service")
public void onOrders(List<Order> orders) {                    // batch listener
  orders.forEach(this::apply);
}
```

Trap: `concurrency` above the partition count leaves threads idle; below it leaves partitions idle — the same law as Q2, now in Spring vocabulary.

**Q29. Static membership — why restarts should not rebalance.**
On a rolling deploy, every restart triggers a rebalance that stalls the whole group for seconds; with 50 partitions that's a rewrite of the assignment map per pod. **Static membership** (`group.instance.id`, Kafka 2.3+) tells the broker "same member, just reconnecting", so restarts skip rebalancing entirely:

```java
props.put(ConsumerConfig.GROUP_INSTANCE_ID_CONFIG, "orders-service-" + hostname); // unique per instance
```

The id must be unique per instance and stable across restarts — Kubernetes StatefulSet pod names are the perfect source.

**Q30. `read_committed` vs `read_uncommitted`.**
Transactional producers write records that consumers either see or filter. `read_uncommitted` (default) delivers committed **and aborted** records; `read_committed` only delivers committed ones and trims aborted records from fetched batches:

```java
props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
```

Cost: records inside an open transaction are hidden until commit, so consumers lag by the transaction window — bound it with `transaction.timeout.ms` (default 60 s) rather than discovering a 15-minute hidden gap.

**Q31. Rebalance strategies: range, sticky, cooperative sticky.**
`RangeAssignor` (the old default) assigns partitions per-topic and gets uneven across many topics; `StickyAssignor` keeps prior assignments where possible; `CooperativeStickyAssignor` (2.4+) combines stickiness with the cooperative protocol that only revokes what must move:

```java
props.put(ConsumerConfig.PARTITION_ASSIGNMENT_STRATEGY_CONFIG,
    List.of(CooperativeStickyAssignor.class.getName()));
```

With eager rebalancing, every membership change is stop-the-world for the whole group; cooperative shrinks that to just the moved partitions. For a 50-partition topic, that's the difference between a ~30 s stall and a ~2 s hiccup per deploy.

**Q32. Producer retries: what actually limits them?**
`retries` is effectively infinite by default (2,147,483,647) but bounded in _time_ by `delivery.timeout.ms` (default 120 s); each attempt waits `retry.backoff.ms` (100 ms). Idempotence requires `retries > 0` and `max.in.flight.requests.per.connection ≤ 5`:

```java
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "30000"); // give up after 30 s, not 2 min
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, "5");
```

The gotcha: a retried batch whose first attempt actually committed is _exactly_ what idempotence dedupes (PID + sequence). Without it, one retried batch can duplicate up to `batch.size` worth of records.

**Q33. How do you reset a consumer group to reprocess?**
Reprocessing = moving the group's committed offsets. The CLI resets to earliest/latest/a date/shift and can even export and import the whole map:

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --group orders-service \
  --reset-offsets --to-datetime 2026-08-10T00:00:00.000 --execute --all-topics
```

Safety rules: quiesce the pipeline first or you replay fresh events too, confirm the consumer is idempotent (Q34), and prefer `--to-datetime` over `--to-earliest` so you replay the broken window — not 7 days of retention.

**Q34. Consumer-side dedupe: at-least-once means duplicates.**
The same record can arrive twice (producer retry, crash between process and commit). The sink must dedupe: an idempotency key (record key + offset) with a unique constraint turns "process twice" into "second attempt is a no-op":

```java
try {
  jdbc.update("INSERT INTO processed_events(idempotency_key, payload) VALUES (?, ?)",
              key(record), serialize(record));
} catch (DuplicateKeyException e) {
  log.info("duplicate, skipping: {}", record.offset()); // replay = no-op
}
```

This is the pattern that makes retention replay, DLQ replay, and consumer restarts all safe — without it, every replay is a double-side-effect roulette.

## Senior — design & defense

**Q35. A consumer crashes on one bad message (poison pill). Design the handling.**
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

"Spring Kafka gives this for free — a `DefaultErrorHandler` with backoff and a dead-letter recoverer:"

```java
@Bean
public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, Order> template) {
  var recoverer = new DeadLetterPublishingRecoverer(
      template, r -> new TopicPartition("orders-dlq", r.partition()));
  return new DefaultErrorHandler(recoverer, new FixedBackOff(1_000L, 3)); // 3 tries, 1 s apart, then DLQ
}
```

"The principle: a poison message must move the pipeline forward, not halt it."

**Q36. You need global ordering of 1M events/sec. What do you do?**
"Global ordering = one partition = one consumer = you've killed throughput (single-partition ceiling ~tens of thousands msg/s). I'd challenge the requirement: almost always it's _per-entity_ order (per-order, per-user), which keying gives at full parallelism — 1M msg/s across 50 partitions with every key landing in one partition. If global order is genuinely required, I accept the single-partition ceiling and reconsider whether Kafka fits — a total-order requirement fights its design."

**Q37. Consumer lag spikes to 2M during a deploy. Diagnose.**
"First, the spike correlates with the rebalance from the rolling deploy — consumers stopped, lag accumulated, then resumed. If lag doesn't drain, the consumer is now slower than the produce rate (a new synchronous call in the handler). I check per-partition lag (one hot partition = key skew), consumer CPU, and `max.poll.records`/processing time:"

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
# look at the LAG column per partition; one huge value next to zeros = key skew, not a slow group
```

"Then the drain math: lag 2M at 50k msg/s drain clears in ~40 s; if drain < produce, lag grows forever and you cross the 7-day retention edge. Fix: more partitions for the hot key, parallelize handling, raise `max.poll.interval.ms` — and measure drain rate vs produce rate to confirm recovery."

**Q38. Exactly-once for a 'consume DB update + produce event' flow.**
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

"Exactly-once is a property of the _whole_ pipeline, not the producer flag — the DB write, the topic write, and the offset commit must all be in the same decision."

**Q39. How do you size partitions for 50k msg/s with 10 consumers?**
"Throughput per partition is bounded by one consumer's processing (~5–10k msg/s realistic, 50–100k with big batches). I size partitions ≈ `target_consumer_parallelism / single_consumer_throughput × safety` → ~20–30 for 10 consumers. Too few = idle consumers; too many = file-handle + metadata overhead and longer rebalances. I validate by load-testing one partition's max consume rate, then divide:"

```bash
# rough budget: 50k msg/s ÷ 2.5k msg/s per partition = 20 partitions, RF 3 -> 60 replicas
kafka-topics --create --topic orders --partitions 20 --replication-factor 3 \
  --bootstrap-server broker-1:9092
```

"Partitions are also a floor, not a ceiling — you can add later, but rebalancing and rehash (Q19) cost you."

**Q40. Defend a retention policy and what 'data loss' really means.**
"Retention (e.g. 7 days) deletes records older than that regardless of consumption — so a consumer down >7 days loses them, permanently. 'Data loss' in Kafka is usually retention-based, not broker failure (RF≥3, `min.insync.replicas=2` survives a single broker). I set retention by the longest plausible reprocessing window + buffer, and for critical streams use tiered storage:"

```bash
kafka-configs --alter --entity-type topics --entity-name orders \
  --add-config retention.ms=604800000,local.retention.ms=259200000   # 7 d total, 3 d local
```

"I defend retention with the reprocessing SLA, not a guess: how long does a failed consumer have to recover and replay before the window is gone?"

**Q41. How do you test a Kafka consumer for correctness?**
"Deterministically — `@EmbeddedKafka` (spring-kafka-test) boots a real broker in-process for integration tests, or Testcontainers runs the real image in CI. Test the failure paths, not just the happy path: a poison record must land in the DLQ, and a crash between process and commit must replay safely (thanks to Q34's idempotent sink):"

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

"Production repro: reset the group to a datetime (Q33), replay, and assert no double-applied effects."

**Q42. Schema evolution: why raw JSON is a runtime landmine.**
"JSON schema drift is a runtime failure: the producer adds a field, the consumer's `JsonMappingException` starts, and the group falls behind at 10k msg/s. Avro + Schema Registry makes compatibility a **registration-time decision**: an incompatible schema is rejected when you register, before a single bad record reaches the topic:"

```java
props.put("key.serializer", KafkaAvroSerializer.class);
props.put("value.serializer", KafkaAvroSerializer.class);
props.put("schema.registry.url", "http://schema-registry:8081"); // compatibility enforced here
```

"Compatibility types to defend: BACKWARD (new readers can read old data — safe for consumers), FORWARD (old readers can read new — safe for producers), FULL (both). Rule: define the evolution direction before the incident, not after."

**Q43. A consumer is down 3 hours; retention is 7 days. Design the recovery.**
"Down 3 hours at 10k msg/s ≈ 108M records in backlog. That's a drain problem, not a data-loss problem — 7-day retention is the safety net. The decision tree: if the consumer is idempotent (Q34), replay the window; if not, fast-forward and alert:"

```java
// idempotent consumer: replay the failure window
consumer.seekToBeginning(consumer.assignment());
// non-idempotent: skip the backlog, resume near now
consumer.seek(new TopicPartition("orders", 3), committedOffset);
```

"At 50k msg/s drain, 108M records clear in ~36 min. The senior answer is the decision tree — idempotent? replay. Not idempotent? fast-forward + manual reconciliation. And never replay without quiescing the upstream first (Q33)."

**Q44. Zombie producers: transactional fencing.**
"Two instances holding the same `transactional.id` (a failed-over pod that lingers) must never both commit. Each `initTransactions()` bumps the producer epoch, and the older instance gets `ProducerFencedException` — the fencing guarantee:"

```java
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "order-sink-" + instanceId); // unique per instance
producer.initTransactions();
while (running) {
  try {
    producer.beginTransaction();
    produce(records);
    producer.sendOffsetsToTransaction(offsets, groupId);
    producer.commitTransaction();
  } catch (ProducerFencedException e) {
    throw new FatalException("fenced by a newer instance — I am the zombie", e); // stop writing
  }
}
```

"The trap: a shared, non-unique transactional.id looks fine until failover — then two writers fight, and the unfenced one keeps double-writing until you notice. Uniqueness per instance is the fence."

**Q45. Design for 1M msg/s end-to-end.**
"Goal: 1M msg/s × ~500 B = ~500 MB/s in, and with RF=3 the cluster moves ~1.5 GB/s internally. Per-partition reality: one consumer with 500-record batches processed in ~10 ms sustains 50k msg/s, so I need ~20 consumers; producers batch hard so brokers see ~31k batches/s of 16 KB. Concrete starting point — 48 partitions, 6 brokers, RF 3, zstd:"

```java
props.put(ProducerConfig.BATCH_SIZE_CONFIG, "65536");    // 64 KB batches
props.put(ProducerConfig.LINGER_MS_CONFIG, "10");
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "1000"); // bigger batches, fewer poll cycles
```

"Disk reality check: 500 MB/s × 7 days ≈ 300 TB before compression, ~100 TB with zstd — retention is a storage budget decision, not a default. Validate with a load test: the math gets you 80% there, the test signs the design."

**Q46. Lag alerting and autoscaling with numbers.**
"Average lag hides a hot partition. Monitor per-partition lag and convert to **backlog time**: lag ÷ produce rate = seconds of backlog. At 10k msg/s produce: alert when backlog > 300 s (lag 3M) for 5 min, page at > 30 min (lag 18M):"

```bash
# per-partition lag is the signal; max lag, not average
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
```

"Spring Boot exposes `kafka.consumer.*` metrics via Micrometer; in Kubernetes, KEDA's Kafka autoscaler scales consumers on lag directly. The threshold is a budget: 'how much backlog can I tolerate and still drain within SLA?' — then alert on lag, page on backlog time."

**Q47. DB write + Kafka publish must be atomic — the outbox pattern.**
"The dual-write problem: a DB commit and a Kafka send can't be atomic across two systems — crash between them = DB updated, event lost, downstream never hears about it. **Transactional outbox**: write the event to an outbox table in the _same DB transaction_, and a relay publishes it after commit:"

```java
@Transactional
public void placeOrder(Order order) {
  orderRepo.save(order);   // business write
  outboxRepo.save(new OutboxEvent("orders", order.getId(), serialize(order))); // same tx
} // both commit or neither — atomic via the DB

// relay: poll unsent, send, mark on success (idempotent consumers = safe retries)
for (OutboxEvent e : outboxRepo.findUnsent(100)) {
  producer.send(new ProducerRecord<>(e.topic(), e.key(), e.value()));
  outboxRepo.markSent(e.getId());
}
```

"Choice to defend: the DB owns the data → outbox; Kafka owns the ordering/offsets → Kafka transactions (Q38). The trap: outbox relay retries can double-publish — pair it with Q34's idempotent sink."

**Q48. Multi-region replication and disaster recovery.**
"Within a region, RF=3 spread across racks/AZs handles a broker loss automatically. Across regions you need **MirrorMaker 2**, which copies topics with remapping:"

```bash
kafka-mirror-maker2 --config mm2.properties   # primary -> standby, topic remapping applied
```

"Defend the semantics: active-standby (one source of truth, async copy) vs active-active (both produce, conflicts to resolve). Async mirroring means the standby lags seconds behind — if the primary region dies, the last N seconds of records are lost. RPO = mirroring lag, RTO = failover time (minutes: consumers re-point, MM2 resumes). Decide who owns the source of truth _before_ the incident, and make consumers idempotent so the failover replay can't double side effects."

**Q49. A `@KafkaListener` throws on one record in a batch. What happens?**
"With BATCH ackMode nothing commits, so Spring re-delivers the whole batch — one bad record re-runs the good ones too. Control it with a `DefaultErrorHandler`: fixed backoff for transient failures, dead-letter recoverer for poison, and `setCommitRecovered(true)` so DLQ'd batches commit instead of looping:"

```java
@Bean
public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, Order> template) {
  DeadLetterPublishingRecoverer dlq = new DeadLetterPublishingRecoverer(
      template, r -> new TopicPartition("orders-dlq", r.partition()));
  DefaultErrorHandler handler = new DefaultErrorHandler(dlq, new FixedBackOff(1_000L, 3));
  handler.setCommitRecovered(true);              // commit once DLQ'd — no infinite loop
  handler.setLogLevel(KafkaException.Level.WARN);
  return handler;                                // wire into the container factory
}
```

"Never swallow inside the listener without a decision — retry (transient), DLQ (poison), or fail (SLA). Silently catching advances offsets past the record and is the quietest way to lose data in Kafka."

**Q50. A broker is down and traffic doubles. Design backpressure.**
"Overload math: traffic doubles to 2× the cluster's capacity; producer `buffer.memory` (32 MB default) fills, `send()` blocks up to `max.block.ms` (60 s default), then throws `TimeoutException` — the client sees latency, then errors, then drops. Defense in layers: fail fast, cap the noisy client, spill and replay:"

```java
props.put(ProducerConfig.MAX_BLOCK_MS_CONFIG, "5000");       // fail fast instead of piling up
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "30000");
// broker side: a client quota stops one tenant starving the cluster
kafka-configs --bootstrap-server broker-1:9092 --alter --entity-type clients \
  --entity-name web --add-config producer_byte_rate=104857600   # 100 MB/s cap
```

"Backpressure is a system property: broker quotas bound the blast radius, producer timeouts bound the waiting, and a local spool + replay path is the only true overflow valve — which, again, needs idempotent consumers (Q34) to be safe."

#### Self-check

- [ ] Junior: Can I explain partitions/offsets, consumer groups, `acks` 0/1/all with latency numbers, keyed routing, producer batching (16 KB, `linger.ms`), and which timers eject a consumer from its group?
- [ ] Mid: Can I articulate the three delivery semantics, offset-commit ordering, per-key ordering and what breaks it, ISR with `min.insync.replicas=2` and RF 3, and rebalance strategies vs static membership?
- [ ] Mid: Can I write the Spring Kafka variant — `@KafkaListener`, `ConcurrentKafkaListenerContainerFactory`, ackMode — and explain the consumer-side dedupe that makes replays safe?
- [ ] Senior: Can I design exactly-once via transactions or an idempotent sink, diagnose a lag spike with drain-rate math, size partitions from load, and defend retention by reprocessing SLA?
- [ ] Senior: Can I defend a 1M msg/s design (partitions, batches, compression, consumers), replay a failed window safely, and explain outbox vs transactions and multi-region semantics with numbers?
