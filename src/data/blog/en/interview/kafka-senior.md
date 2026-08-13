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

Kafka questions separate people who've run it in production from those who've only read the docs. And that gap is wider than with almost any other tool, because Kafka looks deceptively simple — an append-only log, a producer on one side, a consumer on the other — right up until a rebalance storm freezes your queues at 2 a.m., or a single poison record silently stalls one partition for hours while every dashboard around it stays green.

A junior knows the three delivery semantics. A senior can narrate the exact instant a record becomes "committed," justify a partition count with throughput math instead of a guess, explain why `enable.idempotence=true` still doesn't protect the Postgres write on the other side of the consumer, and name the single metric that proved the consumer — not the broker — was last month's bottleneck.

> Mindset: recite semantics and you're mid-level. Walk through a tradeoff with real numbers and a production failure mode, and you've earned the "senior" checkbox. Every section below ends with the drill an interviewer actually runs.

## Interview question ladder (Junior → Mid → Senior)

> Drill these out loud. Junior = "do you know the concept"; Mid = "do you know the tradeoffs"; Senior = "can you defend a decision under pressure, with a number and a postmortem."

### Junior — foundations

- **Q: What are the three delivery semantics in Kafka?**
  A: At-most-once (may lose), at-least-once (may duplicate), exactly-once (no loss, no dup). Producers default to at-least-once; consumers must dedupe or make processing idempotent to approach exactly-once.

- **Q: What's a topic, partition, and consumer group?**
  A: A topic is a log; it's split into partitions (each an ordered, immutable sequence). A consumer group is a set of consumers sharing the work — each partition is consumed by exactly one member of the group.

- **Q: What does a consumer offset represent?**
  A: The position of the next record to read in a partition. Committed offsets let a consumer resume after a restart or rebalance. `auto-commit` commits periodically; manual commit gives you control over the consume-process-commit boundary.

- **Q: What's the difference between a queue and a topic?**
  A: A traditional queue delivers each message to one consumer; a Kafka topic broadcasts to all consumer groups that subscribe. That's why one topic can feed analytics, audit, and the core service at once.

- **Q: What does `acks=all` mean?**
  A: The producer waits for the leader _and_ all in-sync replicas to acknowledge the write before considering it successful — stronger durability, at the cost of latency. `acks=1` waits only for the leader; `acks=0` fires and forgets.

### Mid — tradeoffs & pitfalls

- **Q: `enable.idempotence=true` — does it protect the Postgres write on the other side of my consumer?**
  A: No. Idempotence only de-dupes producer→broker retries within Kafka. Once your consumer writes to Postgres, a redelivery (crash before offset commit) writes again. Exactly-once end-to-end needs an idempotent _sink_ (upsert by key) or transactional outbox.

- **Q: A single poison record silently stalls one partition for hours while dashboards stay green. Why, and the fix?**
  A: The consumer throws on that record, never commits the offset, and Kafka redelivers it forever — a 1-record poison blocks the whole partition. Fix: a dead-letter queue (route the bad record after N retries) and alert on consumer lag, which is the metric that actually shows the stall.

- **Q: How do you pick partition count?**
  A: By throughput and consumer parallelism, not a guess: `partitions ≈ max(target_producer_MBps / per_partition_MBps, target_consumer_instances)`. More partitions = more parallelism but also more open files, more rebalances, and longer election if a broker dies.

- **Q: What causes a rebalance storm, and why does it freeze your queues?**
  A: Consumers repeatedly join/leave the group (slow poll, long GC pause, heartbeat timeout), triggering a rebalance that revokes all partitions, pauses consumption, and reassigns. Fix: tune `session.timeout.ms`/`heartbeat.interval.ms`, keep poll loops fast, and use cooperative rebalancing (incremental) where possible.

- **Q: Consumer lag is climbing — where do you look first?**
  A: Whether it's a _throughput_ problem (the consumer can't keep up — add instances/partitions) or a _processing_ problem (each record is slow — a slow downstream call). Lag per partition tells you if it's one hot partition or global. The metric that proves the _consumer_, not the broker, is the bottleneck is consumer lag vs broker CPU.

### Senior — design & defense

- **Q: You need exactly-once across "Kafka → consume → write Postgres." Design it.**
  A: Either (a) transactional outbox in Postgres + a relay that publishes to Kafka atomically with the business write (the DB is the source of truth), or (b) idempotent sink: consumer upserts by a deterministic key and commits the offset in the same local transaction. `enable.idempotence` + `ack=all` covers the producer; the sink covers the consumer. Name which you picked and why.

- **Q: A partition leader election took 30 s and every dashboard around it stayed green. Explain.**
  A: Broker failure triggers leader election for that partition's replicas; until a new ISR leader is elected, that partition is unavailable for writes — but other partitions and other services are fine, so global dashboards look healthy. The tell is per-partition unavailability + producer timeouts, not a system-wide red. Fix: more replicas, faster `election.timeout`, and producers that retry with backoff.

- **Q: Size a cluster for 50 MB/s ingest with 3-day retention at 1 KB records. How many brokers?**
  A: 50 MB/s × 3 days = ~13 TB raw; ×replication factor 3 = ~39 TB, ÷usable-per-broker (say 5 TB) ≈ 8 brokers minimum, plus headroom for rebalancing. Throughput per broker is ~hundreds of MB/s, so brokers are disk/retention-bound here, not CPU. State the assumption and the knob you'd watch (disk, not cores).

- **Q: Walk me through a duplicate-payment incident caused by a rebalance and how you closed it.**
  A: Consumer processed a payment, crashed before committing the offset, rebalance reassigned the partition, redelivery processed it again. Close it with idempotent processing (dedupe by `paymentId` in a unique DB constraint) so the redelivery is a no-op. The postmortem: offset-commit timing, not Kafka itself, was the bug.

- **Q: When would you NOT use Kafka for this?**
  A: For request/response or low-latency RPC, a queue/topic adds a hop and at-least-once semantics you must design around. For a single-producer/single-consumer with tight latency, a direct call or a lighter broker may be simpler. Kafka earns its keep with fan-out, replay, and decoupling at scale — name the case where it's overkill.

#### Self-check

- [ ] Junior: the 3 semantics, topic/partition/consumer-group, what an offset is, queue vs topic, `acks=all`.
- [ ] Mid: why idempotence doesn't protect the sink, poison-record+DLQ, partition sizing math, rebalance-storm cause, lag-as-the-metric.
- [ ] Senior: design exactly-once end-to-end, explain a 30 s leader election, size a cluster by retention, trace a duplicate-payment rebalance incident, name when Kafka is the wrong tool.

## 1. The log is the product — partitions, offsets, order

Kafka is not a message queue that happens to be fast. It's a **distributed, immutable, append-only commit log**. That framing is the whole senior answer: everything else — consumer groups, retention, even "exactly once" — is a consequence of the log, not a feature bolted on top.

Think of a kitchen's ticket rail. The **topic** is the rail. A **partition** is one lane of the rail — and here's the part that catches people: partitions are both the unit of _ordering_ and the unit of _parallelism_, and you can't have more of one than the other. Order is guaranteed _within_ a partition and absolutely not across them. The moment an entity's events span two partitions, all bets are off for sequence.

The **offset** is the ticket number. It's a monotonically increasing position within a partition, and it's the only checkpoint a consumer has. When your consumer "commits an offset," it's telling the group: _I have fully processed everything up to here — if I crash, start me from here._ Choose that point wrong and you've just decided your delivery semantics (section 2) — most "Kafka lost my message" incidents are actually "my consumer committed before processing."

The **consumer group** is the waitstaff shift. The group splits the partitions among its members, so each partition has exactly one active consumer at a time. The consequence that separates people who've tuned it: **adding consumers beyond the partition count does nothing**. Twelve consumers, four partitions — four of them work, eight sit idle and the group just rebalanced more often for the privilege.

And the part that makes Kafka fast on boring hardware: the broker writes to a **segment file** through the OS **page cache**, and it serves reads with `sendfile()` (zero-copy — the kernel memcpys the page cache straight to the NIC, no trip through the JVM heap). A hot topic is effectively served from RAM. That's why a handful of brokers can do hundreds of MB/s without exotic storage — the disk is only for the tail you've outgrown the cache.

> The drill: "How many partitions should my topic have?" The senior answer is never "as many consumers as I have" or "one per core." It's a throughput calculation with a growth caveat — and that caveat is the trap.

## 2. Delivery semantics — where "exactly once" goes to die

The three are the vocabulary, not the answer. The answer is being able to produce the exact interleaving that loses or duplicates a record, and then being honest about what the cluster actually gives you.

- **At most once.** Commit the offset _before_ processing. Crash between commit and process → the record is never processed. You traded loss for the guarantee you'll never redo work.
- **At least once.** Process _then_ commit. Crash after processing but before the commit lands → the record gets reprocessed. You trade duplicates for the guarantee nothing is lost. This is the realistic default for most systems, and the price of it is **idempotent consumers**.
- **Exactly once.** The whole point of this section: in Kafka, EOS is a _closed-world_ guarantee, and it does not extend to your database.

### What the cluster's "exactly once" actually does

Two mechanisms, and knowing the boundary between them is the senior tell:

1. **Idempotent producer** (`enable.idempotence=true`). The broker assigns the producer a `PID` and every record gets a sequence number. The broker drops duplicates for a given (PID, partition, sequence). This kills the "retry created a double write inside Kafka" failure — for a _single_ producer session.
2. **Kafka transactions** (`transactional.id`, `initTransactions()`, `beginTransaction()` / `commitTransaction()`). This lets one producer atomically commit records across several partitions plus its **consumer offsets** — coordinated by the transaction coordinator, visible only to `read_committed` consumers. This is exactly-once _within the cluster_: a Kafka Streams app can read, process, and write such that a crash-and-restart replays nothing.

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);      // PID + sequence numbers
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "orders-pipeline");   // enables transactions
```

And here's the boundary that wins interviews: **the moment your consumer writes to Postgres, the Kafka transaction is irrelevant.** Kafka cannot put your DB write and its offset commit in one atomic unit — there is no distributed transaction spanning Kafka and Postgres, XA over Kafka is not a thing you should attempt. The instant your architecture has a sink, you are back to at-least-once plus idempotency, full stop.

### The consumer-side idempotency that actually saves you

```java
// WRONG: auto-commit fires BEFORE your processing finishes → at-most-once, silent loss
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, true);

// RIGHT: at-least-once — commit only after the batch is processed; make the work idempotent
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
while (true) {
    ConsumerRecords<String, byte[]> batch = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, byte[]> r : batch) {
        applyIdempotently(r);   // unique constraint on (event_id) in your DB
    }
    consumer.commitSync();      // crash before this → reprocess, and duplicates are harmless
}
```

The idempotency key belongs in your sink, and it belongs in the database — not in an in-memory `Set` that dies on restart:

```sql
INSERT INTO payments(id, order_id, event_id, amount) VALUES (?, ?, ?, ?)
ON CONFLICT (event_id) DO NOTHING;   -- event_id is the dedupe key, unique constraint enforced by the DB
```

The cost reality: idempotent producers are nearly free (a few bytes per batch). Transactions cost a control record, a two-phase-style commit marker, and a round-trip to the coordinator per transaction — meaningfully higher latency and lower throughput, which is exactly why you don't wrap every single event in its own transaction.

> The drill: "I set `enable.idempotence=true`. My payments are now exactly-once. Right?" A senior kills that sentence in one breath and walks through the DB write. Then they get asked about the outbox (section 7).

## 3. The producer side — batching, acks, and the throughput math

Most people's first producer is a latency nightmare and they never find out, because it "works" at 200 events a day.

```java
// WRONG: flush() per record — one full round-trip per message
for (OrderEvent e : events) {
    producer.send(new ProducerRecord<>("orders", e.orderId(), e.payload()));
    producer.flush();   // RTT-bound: a handful of messages per second, not thousands
}

// RIGHT: let the batch fill and the network amortize
for (OrderEvent e : events) {
    producer.send(new ProducerRecord<>("orders", e.orderId(), e.payload()));
}
producer.flush();
```

`send()` is asynchronous; the records queue up in the client buffer and are shipped as a **batch**. Without that, every record is its own TCP round trip: at a 5 ms RTT you're hard-capped around a few hundred messages per second. With a 1 MB batch, `linger.ms=10`, and `zstd` compression, a single producer thread pushes on the order of **100k+ small records per second** — zstd alone routinely cuts 3–10× off the bytes on the wire for text payloads, which is often the difference between "network is the bottleneck" and "the batch drains instantly."

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
props.put(ProducerConfig.LINGER_MS_CONFIG, 10);
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 1_048_576);
```

The three `acks` values are a durability dial, not a speed setting:

- `acks=0` — fire and forget. Loses data on any hiccup. Fine for metrics, insane for ledgers.
- `acks=1` — the leader acks after writing to its local log. **Dangerous in prod:** the leader can ack, then crash before the followers replicate, and your "successfully sent" record is gone. You told the business it was durable and it wasn't.
- `acks=all` — ack only after every in-sync replica appended (with `min.insync.replicas` guarding _how many_ that is, section 4).

And the ordering gotcha: with retries enabled, `max.in.flight.requests.per.connection > 1` can reorder messages on retry — batch A fails, batch B succeeds, A retries after B. The old fix (in-flight = 1) killed throughput. The modern fix is `enable.idempotence=true`, which preserves ordering via sequence numbers while allowing in-flight > 1. Idempotence is not just a duplicate-guard; it's also your ordering guarantee.

> The drill: "My producer throughput tops out at 2k msg/s on a 1 ms RTT. What do I change first?" — batching and compression, never `acks=0`. And then: "will that help if the bottleneck is a hot partition?" — which is section 5's question.

## 4. Replication & durability — ISR, `min.insync.replicas`, and the availability trap

The write path is: leader appends to its segment (page cache), followers fetch and append, and the leader acks once the **ISR** — the in-sync replica set — has it. Durability in Kafka is a _replication_ property, not an fsync property; `acks=all` + RF≥3 is the phrase interviewers want to hear, but the full sentence includes `min.insync.replicas`.

- **RF (replication factor)** — how many copies of each partition exist across brokers.
- **ISR** — the subset of those replicas that are actually caught up (in-sync with the leader, tracked by a high-watermark lag).
- **`min.insync.replicas`** — the floor the leader requires before it will ack an `acks=all` write.

So the production sweet spot is `RF=3`, `min.insync.replicas=2`, `acks=all`: the leader acks only when **two** replicas hold the record. Losing one broker is a non-event. And the trap that shows up in interviews: `acks=all` with `min.insync.replicas=1` is **not** more durable than `acks=1` — the leader alone is the ISR, so the leader can ack, then die before anyone else saw the record. "All" refers to all _in-sync_ replicas; `min.insync.replicas` is the real number.

The availability tradeoff is the follow-up: with `min.insync.replicas=2` on a 3-broker cluster, lose **two** brokers and the partition stops accepting writes — you get `NotEnoughReplicasException` and a queue of failed requests. That's not a bug; it's you choosing durability over availability. The alternative is `min.insync.replicas=1`, where a lone leader can always take writes but a single-broker crash can lose acked data. There is no setting where you get both.

**Unclean leader election** is the darkest corner of this section. If all ISR replicas are down and you set `unclean.leader.election.enable=true`, the controller can promote an out-of-sync replica to leader — the partition stays _available_ but silently **serves reads and acks writes for data that was never replicated**. With it false, the partition goes unavailable until an ISR member returns. Availability or data integrity; pick one and tell the business which.

And the page-cache point from section 1 pays off here: each follower replica is effectively a continuous read of the leader's page cache. A topic replicated to RF=3 costs the leader ~2× the write I/O plus the network to the followers — that replication fan-out is often why "my writes are slow" is really "my RF is 3 and my NIC is saturated."

> The drill: "My broker died and I didn't lose data. Prove that's what happened — and what happens when the second one dies?" The senior answer names the ISR, the high-watermark, and which exception the producer sees, and then states plainly: writes block until an ISR member returns, or you flip `unclean.leader.election.enable` and accept the data-loss risk.

## 5. Partitioning & ordering — hot keys, grow-only sizing, and per-key parallelism

Ordering for an entity is simple in Kafka and violated in a thousand subtle ways. If order matters for `order-123`, every event for it must hit the **same partition**, so you key by the entity id:

```java
producer.send(new ProducerRecord<>("orders", e.orderId(), e.payload()));   // key = orderId
```

The cost is the **hot key**. One giant entity — a celebrity account, a top seller, a bank's busiest customer — lands on one partition, saturates that partition's leader, and your "scaled" system has a single-partition ceiling while the other 99 partitions idle. The fixes, in senior order:

1. **Composite key: `shard + entityId`**, where `shard = hash(entityId) % N`. Each entity spreads across N shards, so the leader can parallelize. The price: events for one entity lose global order across shards — usually acceptable if your consumer re-sorts by a monotonic timestamp or you only need per-shard ordering.
2. **Partition by a coarse grain** (e.g., `customerId` when the hot entity is a product) and accept that the hottest customer is the ceiling. Honest, simple, and often the right call.
3. **Buffering / rate-limit at the producer** for the pathological case, so one key can't starve the rest.

### Partition count: grow-only, so size for the future

Two hard truths that make this a senior question:

- **You can only add partitions, never remove them.** Kafka deliberately forbids shrinking. So the number you choose today is a floor forever, and sizing it wrong means a migration that touches every consumer, every metric, every dashboard.
- **Adding partitions silently breaks per-entity ordering.** When the partition count changes, the key→partition mapping changes (default partitioner hashes the key). New events for `order-123` land on a different partition than its old events, so anything reading history-plus-news for one entity now sees the tail arrive out of order. "I'll just add partitions when I need them" is a data-corruption decision wearing a scaling hat.

The sizing math: a single partition on a modern broker sustains on the order of **10–30 MB/s of writes (roughly tens of thousands of small records per second)**. So:

```
partitions ≈ (peak throughput you must absorb) / (per-partition throughput) × headroom
            ÷ your max planned consumers per group (each needs a partition to be useful)
```

If you expect 300 MB/s peak, that's ~15–30 partitions — and you take the headroom _before_ you multiply by consumers, because a consumer count over partition count is idle capacity (section 1). Each partition also costs real things: file descriptors, controller/`KRaft` metadata, and **rebalance time** — every full rebalance grows with partition count, which is how a 50k-partition cluster turns a five-minute deploy into a ten-minute one.

### Per-key order with parallelism — Little's law in the consumer

The naive "speed up my consumer with a thread pool" is how you lose per-key ordering:

```java
// WRONG: a raw pool breaks per-key order the moment two events for the same key race
ExecutorService pool = Executors.newFixedThreadPool(32);
for (ConsumerRecord<String, byte[]> r : batch) {
    pool.submit(() -> process(r));   // events for order-123 can now execute out of sequence
}

// RIGHT: shard by key — each key is always handled by the same single-threaded worker
class KeyedExecutor {
    final ExecutorService[] workers = IntStream.range(0, 32)
        .mapToObj(i -> Executors.newSingleThreadExecutor())
        .toArray(ExecutorService[]::new);

    CompletableFuture<Void> submit(String key, Runnable task) {
        int slot = Math.floorMod(key.hashCode(), workers.length);
        return CompletableFuture.runAsync(task, workers[slot]);
    }
}
```

Sizing it is Little's law again — the same formula that sizes connection pools:

```
concurrency needed  =  messages/second  ×  seconds per message
e.g. 10,000 msg/s × 0.01 s  =  100 workers in flight
```

But there's a ceiling nobody mentions: **workers can't exceed partitions and still matter.** More workers than partitions means some are idle (their shard has no partition to pull from); fewer workers than partitions means some partitions queue behind the pool. The golden rule: parallelize to the _partition count_, not to the number of CPUs, if you need per-key order — then watch the queue depth of each worker, because a full single-threaded worker is a hot key in disguise.

> The drill: "My `orders` topic handles 200 MB/s. Size it and defend it." The senior answer produces a number, then adds "and I can't shrink it, and if I add partitions later I break per-key order" unprompted.

## 6. The consumer loop, lag, rebalances, and the poison message

The poll loop looks like a `while(true)` and a `poll()`. Everything that bites you in production hides in the dials around it:

```java
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 500);
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, 300_000);   // 5 min default
props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, 10_000);      // default is laxer; 10s is common
props.put(ConsumerConfig.HEARTBEAT_INTERVAL_MS_CONFIG, 3_000);    // must be ≤ session.timeout / 3
```

While you're inside the poll loop, the client can't send heartbeats. Two timers decide your life:

- **`session.timeout.ms`** — if the coordinator misses your heartbeats for this long, you're dead → **rebalance**.
- **`max.poll.interval.ms`** — if you take longer than this between `poll()` calls, the coordinator _assumes_ you're stuck and evicts you → **rebalance**, even though your heartbeats are fine.

The numbers that matter: 500 records per poll, each taking 700 ms of processing → **5.8 minutes per poll**, which blows past the 5-minute default → the consumer is kicked out of its own group every cycle, forever. This is the classic "my consumer keeps rebalancing" incident, and the fixes are: fewer records per poll, faster (async) processing, or a genuinely justified larger interval — never a lazy "just bump it."

### Rebalances: the two protocols and the storm

- **Eager (old default):** stop-the-world. Every member drops its partitions, the coordinator reassigns everything, everyone rejoins. On a group with thousands of partitions, that pause is measured in seconds — and every one of those seconds is a partition with no consumer.
- **Cooperative-sticky (KIP-429, the modern default):** only the affected members revoke, and only then rejoin. Rebalances go from "all consumers frozen for seconds" to "a handful of partitions shift in under a second."

**Rebalance storms** are churn — consumers leaving and rejoining in a loop, each cycle freezing the group. Root causes in production order: a full GC pause long enough to trip `session.timeout.ms` (a 6-second STW pause vs a 10-second timeout is a rebalance), processing that blows `max.poll.interval.ms`, or code that subscribes/unsubscribes per request. The senior fix is instrumentation, not wishes: **watch rebalance time and rebalance rate** as first-class metrics, and tune the timeouts so the _slowest_ thing you do still fits.

### Consumer lag — the first signal, and reading it correctly

**Lag = log-end-offset − consumer-offset** for a partition. It's the first symptom of almost every consumer problem, but it's a symptom, not a diagnosis. The senior reading:

- **Flat lag across all partitions, draining at spikes** → bursty producer, healthy consumer. Fine.
- **Lag growing on _every_ partition while the consumer sits at ~100% CPU** → capacity problem: you need more partitions/consumers or faster processing, and Little's law from section 5 tells you how many.
- **Lag growing on _one_ partition while the rest drain** → a hot key (section 5), not a capacity problem. Throwing more consumers at it changes nothing — one partition, one consumer, by construction.
- **Lag growing while the consumer's CPU is idle** → a slow sink: your DB, an external API, or the dedupe table is the real bottleneck. The consumer is queueing on I/O, not starving.

> The drill: "Lag is climbing but the consumer CPU is 30%. What do you do?" — and the wrong answer is "more consumers." The right answer names the sink, then the hot key, then capacity — in that order.

### Poison messages and the DLQ — the section title's promise

A **poison message** is a record that always throws — bad JSON, a schema version your consumer doesn't know, a business rule that rejects it. And here's the mechanism that makes it a catastrophe: a consumer **reads, fails, re-reads**. Without handling, that one record is re-processed on every single poll, the consumer never commits past it, and the **entire partition stalls forever** while lag climbs without bound. One bad record in a million can freeze an order pipeline for a weekend.

```java
// WRONG: let the poison record loop forever → the partition stalls, lag grows unboundedly
while (true) {
    for (ConsumerRecord<String, byte[]> r : consumer.poll(Duration.ofMillis(100))) {
        process(r);    // throws → next poll returns the same record → forever
    }
}

// RIGHT: bounded in-process retries for transient errors, then quarantine the poison record
while (true) {
    for (ConsumerRecord<String, byte[]> r : consumer.poll(Duration.ofMillis(100))) {
        int attempt = 0;
        while (true) {
            try {
                process(r);
                break;
            } catch (PoisonException e) {
                sendToDlq(r, e);          // preserve key + partition + offset in headers
                dlqCount.increment();
                break;
            } catch (TransientException e) {
                if (++attempt >= 3) { sendToDlq(r, e); break; }
                Thread.sleep(200L * attempt);   // 200ms, 400ms, 600ms backoff
            }
        }
    }
    consumer.commitSync();
}
```

The DLQ design details interviewers probe:

- **Preserve provenance.** Write the original partition, offset, timestamp, and the exception to the DLQ record's headers, so the ops engineer can find the poison record in five minutes, not five days.
- **Never block the partition.** The DLQ _is_ the mechanism that lets the consumer commit and move on. A DLQ without a commit-on-success is a slower poison loop.
- **A DLQ topic is a production problem, not a fix.** Someone must consume it — replay against the _fixed_ code, or drop it deliberately. An unattended DLQ is just a second poison topic you're not reading.
- **Retry topics vs in-process retries.** A full retry-topic pipeline (fail → retry topic with delay → reconsume) survives process restarts, unlike the `Thread.sleep` above, which dies with the JVM. Choose based on whether "reprocess after a crash" matters.

> The drill: "A partition's lag is spiking and the consumer logs show the same record every two seconds." The senior answer names the poison message, sketches the DLQ with provenance headers, and — the part that wins — answers "who consumes the DLQ, and when?"

## 7. Kafka → your database — the outbox and the exactly-once trap

Section 2 established that Kafka's transactions end at the cluster boundary. So how do senior systems actually get "the business state and the event are consistent"? The **transactional outbox** — the pattern that makes your database the source of truth for both.

Write the business row and the outgoing event in the **same database transaction**:

```sql
BEGIN;
UPDATE orders SET status = 'PAID' WHERE id = :orderId;
INSERT INTO outbox (id, aggregate_id, event_type, payload, created_at)
VALUES (:eventId, :orderId, 'ORDER_PAID', :payload, NOW());
COMMIT;
```

Now the "publish to Kafka" step is decoupled and safe: either the whole transaction commits (state **and** event), or it rolls back (neither). Then a relay drains the outbox and publishes:

- **A poller** — `SELECT ... FROM outbox WHERE published_at IS NULL`, publish, mark published. Simple, but double-publish on crash unless you mark idempotently.
- **CDC (Debezium)** — the DB binlog/WAL _is_ the source; a Debezium connector turns each outbox insert into a Kafka record. No poller loop, no 5-second delivery window, no extra read traffic.

The honest framing interviewers want: the outbox gives you **atomicity** between the DB commit and the Kafka publish, which is as close as the industry gets to "exactly once" across a database and a broker. What it does **not** give you is exactly-once _delivery_ to a downstream consumer — the relay can crash after a publish or the consumer can crash mid-process, so downstream consumers still must be idempotent (section 2). The outbox closes the atomicity gap; it never removes the need for idempotency.

The two anti-patterns this kills: **publish-then-write** (event sent, DB write fails → the world knows about an order that never happened) and **write-then-publish** without the outbox (DB committed, producer fails → the event is silently lost, and nobody can prove the gap happened because there's no record of the intended event at all).

> The drill: "How do I get exactly-once delivery from Kafka to Postgres?" The wrong answer is a confident "Kafka transactions." The senior answer is "you don't — you get atomicity with the outbox, and idempotency with a unique key, and here's where each one stops."

## 8. Self-check

- [ ] Name the three delivery semantics and produce the exact interleaving where at-least-once duplicates a record.
- [ ] Explain what `enable.idempotence` and Kafka transactions actually do — PID, sequence numbers, coordinator — and why neither protects your database write.
- [ ] Size a topic's partition count from throughput math and defend why it's grow-only — including what happens to per-entity order if you add partitions.
- [ ] Justify `acks=all` + `min.insync.replicas=2` + RF=3, and state exactly what happens when two of three brokers die.
- [ ] Explain why `acks=all` with `min.insync.replicas=1` is barely more durable than `acks=1`.
- [ ] Diagnose "lag growing on one partition" vs "lag growing everywhere with idle CPU" and name the different fixes.
- [ ] Write the poison-message handler with bounded retries and a DLQ that preserves partition, offset, and the exception.
- [ ] Design the transactional outbox with SQL and explain what it does and does not guarantee.
- [ ] Size the consumer's worker pool so per-key order holds, using both Little's law and the partition count as the ceiling.

## 9. Interviewer follow-ups

When your first answer lands, they start drilling. Be ready for these:

- "You have 12 consumers in a group and 4 partitions. What happens, and what's the fix?"
- "`acks=all` with `min.insync.replicas=1` — is that durable? Why?"
- "My consumer lag is growing, CPU is idle, and the DB is at 40%. Where's the bottleneck?"
- "You add 4 partitions to a topic whose consumers rely on per-key order. What breaks, and how do you detect it?"
- "`enable.idempotence=true` — what does it protect you from, and what doesn't it protect you from?"
- "How do you get exactly-once delivery from Kafka to Postgres?" (trap: you don't — outbox plus idempotency.)
- "One record in a million always throws. What happens to the partition, and how do you keep the pipeline moving?"
- "My consumer gets kicked from the group every few minutes. Which two timers do you check, and which number is the giveaway?"
- "What's the difference between retention and compaction — and when does compaction bite you in production?"
- "How would you parallelize a consumer while keeping per-key order, and what's the ceiling on your parallelism?"
- "A full GC pauses your consumer for 6 seconds. Which config is now wrong, and what does the group do?"

That's the Kafka bar.
