---
title: "Java Interview Prep #5: Apache Kafka — From Fundamentals to Operations"
description: "A practical Kafka interview guide covering topics, partitions, delivery semantics, ordering, consumer groups, offsets, serialization, and metadata."
pubDatetime: 2026-08-10T10:20:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - kafka
  - event-driven
---

Kafka interviews are not mainly about remembering configuration names. The harder part is explaining what a successful write or read means, which guarantees Kafka actually provides, and how a consumer behaves when processing is slow or a record cannot be handled. This article covers the available questions from the fundamentals upward: partitioning, delivery semantics, ordering, retention, consumer groups, offsets, serialization, and metadata.

The examples use an `orders` topic and Java client configuration. Values such as partition counts, retention periods, and timeouts are examples from the source draft, not universal production defaults. Tune them against workload, broker capacity, and failure-recovery requirements.

## Junior: Foundations

**Q1. What are topics, partitions, and offsets?**

[SOURCE FACT] A topic is a named log divided into **partitions**. Each partition is an ordered, append-only log, and every record receives a sequential **offset** within that partition.

[ANALYSIS] More partitions can increase consumer parallelism, but they also increase operational overhead, including open files and rebalance work. A partition is stored as a directory containing segment files; the source draft uses approximately 1 GB as an example segment size.

[PROPOSED DESIGN] The following creates an `orders` topic with 50 partitions and replication factor 3. Those values are a starting example, not a sizing rule:

```bash
kafka-topics --create --topic orders --partitions 50 --replication-factor 3 \
  --bootstrap-server broker-1:9092
```

[SOURCE FACT] Each partition has one leader and `RF - 1` followers. With 50 partitions and replication factor 3, the topic has 150 replica assignments distributed across the brokers.

**Q2. What are producers, consumers, and consumer groups?**

[SOURCE FACT] A producer appends records to a topic. A consumer in a **consumer group** is assigned a subset of that group's partitions. With 12 partitions and 4 consumers, an even assignment gives each consumer 3 partitions. A fifth consumer cannot receive an active partition while all 12 are already assigned, so one consumer remains idle.

The `group.id` identifies the group whose members share the work:

```java
props.put(ConsumerConfig.GROUP_ID_CONFIG, "orders-service"); // instances with this ID share partitions
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
```

[SOURCE FACT] Two different groups can read the same topic independently. Each group maintains its own offsets and can progress at its own pace.

**Q3. What is `acks`, and why does it matter?**

[SOURCE FACT] `acks=0` asks the producer not to wait for a broker acknowledgement. `acks=1` waits for the partition leader; data can be lost if that leader fails before the record is replicated. `acks=all` waits for acknowledgement from the in-sync replicas (ISR), providing the strongest durability option among these settings at the cost of additional latency.

[ANALYSIS] The exact latency difference depends on the network, disk, broker load, replication, and client configuration. The source draft's 2–5 ms versus 20–50 ms figures are workload-specific and should not be treated as a general benchmark.

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true"); // preserve ordering across retries and avoid producer duplicates
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "30000"); // example maximum delivery window
```

[SOURCE FACT] The leader can acknowledge an `acks=all` write only after the record satisfies the replication condition represented by the current ISR. Waiting for that acknowledgement is different from assuming replication succeeded.

**Q4. What is a keyed message, and why use one?**

[SOURCE FACT] Kafka uses a record key to route records with the same key to the same partition. The default Java producer partitioner uses a murmur2 hash for keyed records. This provides ordering within that partition, and therefore per-key ordering when the key remains stable. Records without a key do not provide a per-key ordering guarantee; since Kafka 2.4, the default producer behavior can use a sticky partitioner to fill one batch before moving to another partition.

```java
// Same key -> same partition -> order for that key.
producer.send(new ProducerRecord<>("orders", user.getId(), orderEvent));
```

[ANALYSIS] Keying trades distribution flexibility for ordering. A hot key, such as a disproportionately active user, can concentrate traffic on one partition and create skew. The key should reflect the ordering boundary the application actually needs.

**Q5. How is a queue different from a Kafka log?**

[SOURCE FACT] A traditional queue commonly removes or acknowledges a message as it is consumed. Kafka is an append-only log: each consumer group reads from its own offset, and records are removed by **retention**, not simply because they were read.

[PROPOSED DESIGN] The source draft uses 7 days as an illustrative retention period:

```bash
kafka-configs --alter --entity-type topics --entity-name orders \
  --add-config retention.ms=604800000   # illustrative 7-day value
```

[ANALYSIS] If a topic writes 10 GB per day and retains 7 days, the raw retained data is approximately 70 GB before replication, indexes, and other storage overhead. This is an illustrative capacity calculation, not a capacity guarantee.

**Q6. What does a consumer group do when a member crashes?**

[SOURCE FACT] When a group member leaves, its partitions are reassigned to surviving members during a **rebalance**. Members may stop fetching records while the rebalance completes. Rebalances that happen frequently can reduce throughput, especially when caused by slow polling or missed heartbeats.

[ANALYSIS] `session.timeout.ms` controls how long the coordinator waits for heartbeats before considering a member failed. `heartbeat.interval.ms` controls heartbeat frequency. `max.poll.interval.ms` limits the time between successful calls to `poll()` before the member is considered unable to make progress. The source draft identifies 45 seconds as the default session timeout since Kafka 2.3; verify defaults for the Kafka version and deployment. The following are example values from the source draft:

```java
props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, "45000");
props.put(ConsumerConfig.HEARTBEAT_INTERVAL_MS_CONFIG, "3000");
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, "300000");
```

**Q7. Where are committed offsets stored?**

[SOURCE FACT] Committed consumer offsets are stored in Kafka's internal compacted topic, `__consumer_offsets`, rather than on the consumer process. A `commitSync()` writes the group's position there. After a restart, the group can resume from its committed position if that offset is still available.

[SOURCE FACT] The source draft identifies 50 partitions as the default for `__consumer_offsets` and 7 days as the default `offsets.retention.minutes` value. Defaults can vary by Kafka version and deployment, so verify them in the running cluster.

```bash
kafka-consumer-groups --bootstrap-server broker-1:9092 --describe --group orders-service
```

[ANALYSIS] If a group remains empty long enough for its committed offsets to expire, the consumer falls back to `auto.offset.reset` rather than its old position. This is a common recovery surprise for a group that has been inactive for an extended period.

**Q8. What are serializers, and where can they fail?**

[SOURCE FACT] Brokers store record keys and values as bytes. Serializers and deserializers are client-side contracts: both sides must agree on the encoding. Common choices include strings for keys or values, JSON for values, and Avro with Schema Registry when a team needs schema management and evolution.

For a Spring Kafka JSON consumer, the following configuration is an example of allowing and selecting the expected value type:

```java
props.put(JsonDeserializer.TRUSTED_PACKAGES, "com.acme.orders.*");
props.put(JsonDeserializer.VALUE_DEFAULT_TYPE, OrderEvent.class);
```

[ANALYSIS] A mismatch such as a producer using `StringSerializer` while the consumer expects JSON can make deserialization fail for every affected record. The consumer then stops making useful progress until the incompatibility is fixed or the records are handled through an explicit error path.

**Q9. What is `bootstrap.servers` actually used for?**

[SOURCE FACT] `bootstrap.servers` supplies the initial broker addresses for the metadata handshake. After receiving metadata, the client connects to the leader of the partition it needs. One reachable broker can be enough to bootstrap a client, but relying on one address creates an avoidable availability dependency.

[PROPOSED DESIGN] List multiple brokers so the initial metadata request can still succeed if one broker is unavailable:

```java
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG,
    "broker-1:9092,broker-2:9092,broker-3:9092");
props.put(ProducerConfig.METADATA_MAX_AGE_CONFIG, "300000"); // example metadata refresh interval
```

[SOURCE FACT] The client periodically refreshes metadata. The 300000 ms value is the source draft's five-minute example; it is a refresh interval, not a guarantee that every topology change is invisible until then.
