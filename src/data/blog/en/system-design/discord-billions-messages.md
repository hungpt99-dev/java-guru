---
title: "How Discord Stores Billions of Messages: Lessons from the Cassandra→ScyllaDB Migration"
description: "A source-backed analysis of Discord's message-storage evolution, Cassandra data modeling, and a clearly separated ScyllaDB migration design."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

The title describes a useful engineering question, but the permitted historical source does not report a completed Cassandra-to-ScyllaDB migration. It reports Cassandra in production and Scylla as a long-term option. This article keeps that boundary explicit.

## 1. Original Engineering Problem

**[SOURCE FACT]** Discord wanted to retain chat history forever, while message data kept increasing in velocity and size and had to remain available. In the source article, traffic had grown from 40 million messages per day in July, to 100 million in December, and to more than 120 million by January 2017. [Discord, “How Discord Stores Billions of Messages”](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** The initial MongoDB replica set used a compound index on `channel_id` and `created_at`. At 100 million stored messages, the data and index no longer fit in RAM and latency became unpredictable. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[ANALYSIS]** This is a time-series access problem with an uneven key distribution. The natural query is “messages around a position in one channel,” not an arbitrary relational join. Yet inactive channels cause random disk seeks, busy public channels create hot recent ranges, and deleted history can leave expensive tombstone scans.

## 2. What the Original System Did

**[SOURCE FACT]** Discord first moved from MongoDB to Cassandra because Cassandra met the stated requirements: linear scale by adding nodes, automatic failover, low maintenance, proven operation, predictable performance, no need for a message cache, a non-blob data model, and open source. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** The migration used a dark launch: application code double-read and double-wrote MongoDB and Cassandra before Cassandra became primary. Cassandra reads were observed under 5 milliseconds and writes were sub-millisecond during a week of testing. Discord later reported a 12-node cluster with replication factor 3. These are historical observations and configuration values, not current capacity targets. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** The first Cassandra key was `(channel_id, message_id)`, where the Snowflake `message_id` provided chronological ordering. Large partitions then appeared, so Discord introduced time buckets and changed the key to `((channel_id, bucket), message_id)`. The source says the bucket was chosen as about 10 days for the largest channels to stay comfortably below 100 MB. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** Cassandra upserts and last-write-wins behavior exposed an edit/delete race. Discord detected a corrupt row using the required `author_id` field, deleted corrupt messages, and changed writes to include only non-null values. Deletes produced tombstones; after a production incident involving millions of deleted messages, Discord reduced tombstone lifespan from 10 days to 2 days and tracked empty buckets to avoid rescanning them. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** The article says Scylla was a long-term idea because Cassandra repair became CPU-bound and increased in duration with accumulated writes; it does not say that Discord completed a migration. The second permitted article concerns switching from Redis to relational databases and does not establish a Cassandra-to-Scylla migration. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages) [Source](https://discord.com/blog/why-discord-is-switching-from-redis-to-relational-databases-and-whats-next)

## 3. Architecture Diagram

```mermaid
flowchart LR
    C[Client]
    API[Message API\n[Source-backed component]]
    MONGO[(MongoDB replica set\n[Source-backed historical component])]
    CAS[(Cassandra cluster\n[Source-backed component])]
    B[Time bucket: channel_id + bucket\n[Source-backed component]]
    REP[Replication and repair\n[Source-backed component]]
    IDX[Empty-bucket tracking\n[Source-backed component]]
    SCY[(ScyllaDB cluster\n[Proposed component])]
    MIG[Dual-read / dual-write migration controller\n[Proposed component]]

    C --> API
    API -. dark launch .-> MONGO
    API --> CAS
    CAS --> B
    CAS --> REP
    API --> IDX
    API -. proposed migration .-> MIG
    MIG --> SCY
    MIG -. validation .-> CAS
```

**[SOURCE FACT]** MongoDB dual reads/writes, Cassandra, time buckets, replication, repair, and empty-bucket tracking are described in the source. **[PROPOSED DESIGN]** The ScyllaDB cluster and migration controller are extensions for an interview design; the diagram must not be read as Discord's reported production architecture.

## 4. System Design Analysis

**[ANALYSIS]** Partitioning by `(channel_id, bucket)` addresses two independent risks. `channel_id` preserves the main access locality, while `bucket` bounds the amount of data and tombstones a read or compaction operation can touch. A single unbounded channel partition is a hotspot in storage, not only a routing hotspot.

**[ANALYSIS]** The design is intentionally query-shaped. A recent-history request computes candidate buckets and range-scans by `message_id`; it does not ask Cassandra to discover rows through a secondary index. The cost for a quiet channel is extra bucket probes, while the common active-channel case usually finds enough rows in the newest bucket.

**[ANALYSIS]** Cassandra and ScyllaDB are compatible at the data-model level, but compatibility is not proof of operational equivalence. Repair behavior, compaction, drivers, metrics, consistency settings, and workload isolation still require migration tests. “Faster repair” is a hypothesis to validate, not a migration guarantee.

## 5. Data Model

**[SOURCE FACT]** The source describes Cassandra as a partition-and-clustering-key store: the partition key locates data, and the clustering key identifies and sorts rows within a partition. The production message key became `((channel_id, bucket), message_id)`. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[PROPOSED DESIGN]** A minimal table for the same access pattern could be:

```sql
CREATE TABLE messages_by_channel_bucket (
    channel_id bigint,
    bucket date,
    message_id bigint,
    author_id bigint,
    content text,
    created_at timestamp,
    edited_at timestamp,
    PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

**[PROPOSED DESIGN]** `bucket` must be deterministic from message time or ID, and the service should maintain a small channel metadata record containing known empty buckets. If edits and deletes can race, writes should be whole-message or field-aware, and reads should reject rows missing required fields rather than silently returning partial data.

## 6. API Design

**[PROPOSED DESIGN]** Keep APIs aligned to partition-local operations:

```text
POST   /channels/{channel_id}/messages
GET    /channels/{channel_id}/messages?before={message_id}&limit={limit}
GET    /channels/{channel_id}/messages?after={message_id}&limit={limit}
PATCH  /channels/{channel_id}/messages/{message_id}
DELETE /channels/{channel_id}/messages/{message_id}
```

**[ANALYSIS]** `before` and `after` are opaque cursors built from Snowflake-like ordering, not offsets. The read service derives bucket candidates, skips recorded empty buckets, queries in order, and stops after `limit` valid rows. A request for mentions, pins, or full-text search needs a separate read model; forcing it into the message table recreates the random-read problem.

**[PROPOSED DESIGN]** During migration, reads can be sampled from both stores and compared by message ID plus required-field validity. Writes need an idempotency key and a deterministic retry policy so a timeout does not create divergent versions.

## 7. Scaling Strategy

**[SOURCE FACT]** Discord's strategy was to add nodes instead of manually re-sharding, with replication and repair providing resilience. The source reports a 12-node Cassandra cluster with replication factor 3 at that point in time. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[ANALYSIS]** Adding nodes solves aggregate capacity but not every hotspot. One extremely active channel still maps to a bounded sequence of buckets, and its newest bucket can be disproportionately hot. Monitor per-partition and per-node latency, compaction debt, tombstone scans, and bucket-size distribution, not only cluster averages.

**[PROPOSED DESIGN]** For a Scylla migration, use a staged path: shadow reads, dual writes, consistency comparison, bounded cohort rollout, then rollback by routing reads back to Cassandra. Keep schema and bucket derivation identical first; changing storage engine and partition semantics at the same time makes discrepancies hard to diagnose. Treat repair, compaction, backfill, and failover as separate load tests.

## 8. Failure Scenarios

**[SOURCE FACT]** A deleted channel history left millions of tombstones. Loading the channel caused Cassandra to scan them and triggered repeated 10-second stop-the-world garbage collection. Discord reduced tombstone lifespan and avoided known empty buckets. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[ANALYSIS]** A second failure class is semantic rather than mechanical: an edit concurrent with deletion can leave a partial row under column-level last-write-wins upserts. “Successful write” therefore does not imply “valid message.” Required-field validation and delete/edit ordering are part of correctness.

**[PROPOSED DESIGN]** A migration must also handle asymmetric success: Cassandra accepts a write while Scylla times out, or the reverse. Record the operation ID, retry idempotently, compare asynchronously, and expose a repair queue. Do not cut over until divergence is measurable and bounded. If both stores disagree, prefer the version selected by an explicit event timestamp or version policy, not wall-clock arrival at the API.

## 9. Capacity Estimation

**[SOURCE FACT]** Historical source numbers include more than 120 million messages per day, a 12-node cluster, replication factor 3, nearly 1 TB of compressed data per node, and a stated possibility of increasing that to 2 TB per node. The source also reports reads under 5 milliseconds and writes below 1 millisecond during testing. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[PROPOSED DESIGN]** The following is an illustrative assumption, not a Discord measurement: assume 200 bytes of stored message payload and metadata before replication. At 120 million messages per day, raw logical storage would be:

```text
120,000,000 messages/day * 200 bytes/message
= 24,000,000,000 bytes/day
≈ 24 GB/day (illustrative assumption)
```

**[PROPOSED DESIGN]** With replication factor 3, the illustrative physical payload is about 72 GB/day before compaction overhead, indexes, backups, and tombstones. Real sizing must replace the assumed row size with measured distributions, then reserve headroom for repair and compaction. No new throughput target is asserted here.

## 10. Trade-offs

**[SOURCE FACT]** Cassandra offered availability, node-based scale, predictable latency, and locality for related data, but its eventual consistency and tombstones created correctness and operational issues that Discord had to handle explicitly. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[ANALYSIS]** Time buckets trade write simplicity for read fan-out on quiet channels. Smaller buckets reduce worst-case partition and tombstone cost but increase metadata and probes. Larger buckets reduce probes but increase compaction and hotspot exposure.

**[PROPOSED DESIGN]** Scylla may be attractive where repair CPU and duration are the bottleneck, but migration has a real cost: dual operation, data validation, driver behavior, observability parity, and rollback. A database name is not a scaling strategy; the partition key, deletion policy, and operational evidence are.

## 11. What We Can Learn From This Architecture

**[ANALYSIS]** Model the dominant query before choosing the database. Discord moved from a general-purpose indexed collection to a key layout that tells the database exactly which channel range to scan.

**[ANALYSIS]** Bound partitions proactively. The source's 2 GB advertised limit was not a safe operating target; observed large partitions created GC and distribution pressure. Limits in documentation are not automatically limits for a healthy production workload.

**[ANALYSIS]** Deletion is a storage workload. Tombstones, repairs, compaction, and empty-range metadata deserve first-class dashboards and tests.

**[SOURCE FACT]** Dark launching, measured latency, and a migration path were central to the original effort. The article also describes a small engineering team operating the system without dedicated DevOps engineers at that time. [Source](https://discord.com/blog/how-discord-stores-billions-of-messages)

## 12. Proposed Interview-Style System Design

**[PROPOSED DESIGN]** Requirements: retain messages, read a bounded page around a channel cursor, support edits and deletes, tolerate node loss, and scale by adding nodes. Search and analytics are separate systems.

**[PROPOSED DESIGN]** Storage: use `((channel_id, bucket), message_id)` with descending clustering order. Pick the bucket duration from measured largest-channel growth, not a universal constant. Keep an empty-bucket index and a repair queue.

**[PROPOSED DESIGN]** Write path: authenticate, allocate a monotonic message ID, write only populated fields, and make retries idempotent. For edits/deletes, attach a version or event timestamp and enforce required-field validation on reads.

**[PROPOSED DESIGN]** Read path: calculate bucket candidates from the cursor, skip known empty buckets, issue partition-local range reads, merge in message-ID order, and stop at the requested page size. Bound the number of bucket probes and return a retryable error rather than an unbounded scan.

**[PROPOSED DESIGN]** Migration path: keep the Cassandra schema as the compatibility baseline; shadow-read Scylla; dual-write with operation IDs; compare IDs, versions, and required fields; roll out by channel cohorts; monitor p95/p99 latency, read divergence, repair duration, tombstone density, and compaction backlog; retain a tested rollback switch.

**[PROPOSED DESIGN]** Capacity: use source measurements as historical anchors, but size the proposed system from observed row-size percentiles, message-rate distribution, replication, repair bandwidth, and failure headroom. Any numeric target not quoted from the source is an illustrative assumption and must be labeled accordingly.

## Original Sources

1. Company: Discord. Exact Article Title: “How Discord Stores Billions of Messages.” URL: https://discord.com/blog/how-discord-stores-billions-of-messages. What information from the source was used: message-retention goal, MongoDB limitations, Cassandra requirements and model, time buckets, dark launch, eventual-consistency behavior, tombstones, performance observations, historical cluster configuration, and Scylla as a future exploration rather than a reported completed migration.
2. Company: Discord. Exact Article Title: “Why Discord is switching from Redis to relational databases and what’s next.” URL: https://discord.com/blog/why-discord-is-switching-from-redis-to-relational-databases-and-whats-next. What information from the source was used: only the scope distinction that this permitted article concerns Redis and relational databases, not a Cassandra-to-ScyllaDB migration.
