---
title: "How Discord Stores Billions of Messages: Lessons from the Cassandra→ScyllaDB Migration"
description: "A source-backed analysis of Discord's message-storage evolution, Cassandra data modeling, and a clearly separated ScyllaDB migration design."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

The title describes an interesting engineering question, but there is an important limitation in the available historical source: it does not report a completed Cassandra-to-ScyllaDB migration. It describes Cassandra running in production and mentions Scylla as a possible long-term option.

This article keeps that distinction explicit. The goal is not to claim that Discord completed a migration that the source does not report, but to use the real Discord engineering experience as a foundation for understanding the storage design and then extend it into a proposed migration scenario.

## 1. Original Engineering Problem

[SOURCE FACT] Discord wanted to keep chat history indefinitely while the number of messages continued to grow rapidly. The data also had to remain available and support predictable reads and writes. In the source article, traffic increased from 40 million messages per day in July, to 100 million in December, and to more than 120 million by January 2017. Discord, “How Discord Stores Billions of Messages”

[SOURCE FACT] Discord initially stored messages in a MongoDB replica set with a compound index on channel_id and created_at. Once the system reached around 100 million stored messages, the data and index could no longer fit in RAM. As a result, query latency became unpredictable. Source

[ANALYSIS] The underlying problem was closely related to the way messages were accessed. Most requests were about a range of messages in a particular channel rather than arbitrary relational queries.

This made the storage model important.

There were several challenges:

- Inactive channels could require random disk reads.
- Very active public channels could create heavily used recent ranges.
- Deleted messages could leave behind large numbers of tombstones.
- As the amount of data increased, keeping partitions reasonably sized became increasingly important.

The key lesson is that at this scale, choosing a database is only part of the problem. The data model and access pattern have to match each other.

## 2. What the Original System Did

[SOURCE FACT] Discord moved from MongoDB to Cassandra because Cassandra matched the requirements they had identified at the time. These included scaling by adding nodes, automatic failover, low operational overhead, predictable performance, no need for a separate message cache, a data model that was not based on large blobs, and open-source availability. Source

[SOURCE FACT] Discord used a dark launch during the migration. The application temporarily read from and wrote to both MongoDB and Cassandra before Cassandra became the primary store. During one week of testing, Cassandra reads were observed below 5 milliseconds and writes below 1 millisecond. Discord later reported a 12-node cluster with a replication factor of 3. These are historical observations and configuration values, not current capacity recommendations. Source

The first Cassandra key was:

```text
(channel_id, message_id)
```

[SOURCE FACT] The message_id was a Snowflake ID, which provided chronological ordering.

This design worked initially, but large channels eventually produced very large partitions.

Discord therefore introduced time buckets and changed the key to:

```text
((channel_id, bucket), message_id)
```

[SOURCE FACT] For the largest channels, the source says Discord used a bucket of roughly 10 days so that partitions would remain comfortably below 100 MB. Source

This is an important design change.

Instead of allowing all messages from a channel to live in one continuously growing partition, the data is divided into smaller time ranges.

For example:

```text
Channel A
│
├── Bucket 1: Jan 1 - Jan 10
├── Bucket 2: Jan 11 - Jan 20
├── Bucket 3: Jan 21 - Jan 30
└── Bucket 4: Jan 31 - Feb 9
```

The application can then determine which bucket contains the requested messages instead of scanning one potentially huge partition.

### The Edit/Delete Problem

[SOURCE FACT] Cassandra's upsert behavior and last-write-wins semantics introduced an edit/delete race. Discord used the required author_id field to detect corrupted rows, deleted those messages, and changed writes so that only non-null fields were written. Deletes created tombstones. After a production incident involving millions of deleted messages, Discord reduced the tombstone lifetime from 10 days to 2 days and tracked empty buckets to avoid repeatedly scanning them. Source

This illustrates an important point about distributed databases:

> A write succeeding does not automatically mean that the resulting data is semantically correct.

The application still needs to understand how concurrent edits, deletes, retries, and partial data interact.

### Cassandra and ScyllaDB

[SOURCE FACT] The source mentions Scylla as a long-term idea because Cassandra repair had become CPU-intensive and took longer as the amount of accumulated data and writes increased. The source does not say that Discord completed a migration from Cassandra to ScyllaDB. Source

The second permitted Discord article is about moving from Redis to relational databases. It does not provide evidence of a Cassandra-to-ScyllaDB migration. Source

Therefore, the ScyllaDB migration discussed later in this article is a proposed design exercise, not a historical claim about Discord.

## 3. Architecture Diagram

The architecture below separates what is supported by the historical source from what is added for the proposed migration design.

```text
flowchart LR
    C[Client]
    API[Message API\n[Source-backed component]]
    MONGO[(MongoDB replica set\n[Source-backed historical component])]
    CAS[(Cassandra cluster\n[Source-backed component])]
    B[Time bucket: channel_id + bucket\n[Source-backed component]]
    REP[Replication and repair\n[Source-backed component]]
    IDX[Empty-bucket tracking\n[Source-backed component]]
    SCY[(ScyllaDB cluster\n[Proposed component])]
    MIG[Migration controller\n[Proposed component]]

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

[SOURCE FACT] MongoDB dual reads and writes, Cassandra, time buckets, replication, repair, and empty-bucket tracking are described in the source.

[PROPOSED DESIGN] The ScyllaDB cluster and migration controller are additions for the interview-style design in this article. They should not be interpreted as Discord's reported production architecture.

## 4. System Design Analysis

[ANALYSIS] Partitioning by (channel_id, bucket) solves two related problems.

First, channel_id keeps messages from the same channel together, which matches the main access pattern.

Second, bucket puts a limit on how much data can accumulate in one partition.

This matters because an unbounded channel partition can become expensive not only because it contains a lot of data, but also because compaction, deletion, and reads may have to deal with an increasingly large amount of data.

### Query-Driven Data Modeling

The design is intentionally shaped around the queries the application needs to run.

A request for recent messages in a channel can:

- Determine the relevant bucket.
- Read a range of message_id values inside that partition.
- Move to an older bucket if necessary.
- Stop once enough valid messages have been collected.

The system does not need a secondary index to discover where the messages are.

For a quiet channel, this can mean checking several buckets before finding enough messages.

For a busy channel, the newest bucket will often contain enough recent messages to satisfy the request.

This is a reasonable trade-off because the common case remains efficient while partition size stays bounded.

### Cassandra vs. ScyllaDB

[ANALYSIS] Cassandra and ScyllaDB share a similar data-model approach, so the same partitioning strategy can be used as a starting point.

However, similar data models do not mean that the two systems behave identically in production.

A real migration would still need to validate:

- Repair behavior.
- Compaction behavior.
- Database drivers.
- Consistency settings.
- Metrics and monitoring.
- Failure handling.
- Workload isolation.
- Operational procedures.

Therefore, saying that ScyllaDB has faster repair is not enough to justify a migration. The expected improvement needs to be measured under the actual workload.

## 5. Data Model

[SOURCE FACT] The source describes Cassandra as a partition-and-clustering-key data store. The partition key determines where the data belongs, while the clustering key identifies and orders rows within a partition. The production message key became:

```text
((channel_id, bucket), message_id)
```

Source

[PROPOSED DESIGN] A minimal table for the same access pattern could look like this:

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

The important part is the primary key:

```text
((channel_id, bucket), message_id)
```

Here:

- channel_id identifies the channel.
- bucket limits the size of each partition.
- message_id provides ordering inside the partition.

[PROPOSED DESIGN] The bucket must be calculated deterministically from the message time or ID.

The service should also maintain a small amount of metadata about known empty buckets. This prevents the read path from repeatedly querying buckets that are known to contain no messages.

Because edits and deletes can happen concurrently, the write model also needs to account for ordering.

Possible approaches include:

- Storing complete message versions.
- Using field-aware updates carefully.
- Attaching a version number or event timestamp.
- Validating required fields when reading.

The exact choice depends on the consistency and update semantics required by the application.

## 6. API Design

[PROPOSED DESIGN] The API should stay close to the operations that the database can handle efficiently:

```text
POST   /channels/{channel_id}/messages
GET    /channels/{channel_id}/messages?before={message_id}&limit={limit}
GET    /channels/{channel_id}/messages?after={message_id}&limit={limit}
PATCH  /channels/{channel_id}/messages/{message_id}
DELETE /channels/{channel_id}/messages/{message_id}
```

The read APIs use before and after rather than numeric offsets.

For example:

```text
GET /channels/123/messages?before=847362918273&limit=50
```

This means:

> Return up to 50 messages older than the specified message ID.

### Why Not Offset Pagination?

Offset pagination is not a good fit for a very large, continuously changing message table.

For example:

```text
?page=10000
```

requires the database to conceptually skip a large number of rows before returning the requested page.

A cursor based on the message ID is more natural for this access pattern.

[ANALYSIS] The read service can calculate the relevant bucket candidates from the cursor, skip known empty buckets, query each partition in order, and stop when it has collected the requested number of valid rows.

The application should also put a limit on the number of buckets it is willing to check for one request. Otherwise, a pathological request could turn into an unbounded scan.

### Other Queries Need Other Models

Messages by channel are only one access pattern.

A request such as:

- Find all messages mentioning a user.
- Search message content.
- Find pinned messages.
- Build analytics.
- Find messages across many channels.

does not naturally fit the primary message table.

Trying to support every query with the same table would recreate the random-read problem that the original design was trying to avoid.

A better approach is to create separate read models for those use cases.

### Migration API Behavior

[PROPOSED DESIGN] During migration, the application can read from both stores for a controlled sample of traffic and compare the results.

Writes should also carry an operation ID or idempotency key so that a retry cannot create different versions of the same message in the two databases.

## 7. Scaling Strategy

[SOURCE FACT] Discord's strategy was to add nodes rather than manually re-shard the system. Replication and repair were used to provide resilience. The source reports a 12-node Cassandra cluster with a replication factor of 3 at that point in time. Source

Adding nodes increases the total capacity of the cluster, but it does not automatically solve every hotspot.

Consider a very active channel:

```text
Channel A
│
├── Bucket 1
├── Bucket 2
├── Bucket 3
└── Current Bucket  ← very high traffic
```

The overall cluster may have plenty of capacity while the current partition for one popular channel is receiving a disproportionate amount of traffic.

Therefore, monitoring only cluster-wide averages is not enough.

[ANALYSIS] Useful metrics include:

- Latency by partition or channel.
- Per-node latency.
- Partition-size distribution.
- Tombstone scans.
- Compaction backlog.
- Repair duration.
- Read and write throughput.
- Hot-channel distribution.

### Proposed ScyllaDB Migration

[PROPOSED DESIGN] A migration should be performed gradually rather than switching the entire system at once.

A possible sequence is:

```text
1. Shadow reads
       ↓
2. Dual writes
       ↓
3. Compare data
       ↓
4. Small production cohort
       ↓
5. Expand rollout
       ↓
6. Full cutover
```

Keep the schema and bucket calculation the same during the first stage.

This is important because changing both the database engine and the partitioning strategy at the same time makes it much harder to determine the source of any data mismatch or performance regression.

Repair, compaction, backfill, and failover should also be tested independently rather than assuming that a successful migration test covers all of them.

## 8. Failure Scenarios

[SOURCE FACT] Discord experienced a production problem involving millions of tombstones created by deleted channel history. Loading the affected channel caused Cassandra to scan the tombstones and resulted in repeated 10-second stop-the-world garbage-collection pauses. Discord reduced the tombstone lifetime and added empty-bucket tracking to avoid repeatedly scanning known-empty ranges. Source

This shows why deletion needs to be treated as part of the storage design rather than as a simple opposite operation to insertion.

### Edit/Delete Race

[ANALYSIS] Another failure mode is semantic rather than purely mechanical.

Suppose an edit and a delete happen at nearly the same time:

```text
Edit message
     │
     ├─────────────┐
     │             │
     ▼             ▼
Write content    Delete fields
     │             │
     └──────┬──────┘
            ▼
       Final row
```

Under column-level last-write-wins behavior, the final row can contain only some of the expected fields.

Therefore:

> A successful database write does not necessarily mean that the resulting message is valid.

Required-field validation and explicit ordering rules are part of the application's correctness model.

### Migration Failure

[PROPOSED DESIGN] A database migration introduces another class of failure.

For example:

```text
Cassandra write → SUCCESS
Scylla write   → TIMEOUT
```

or:

```text
Cassandra write → TIMEOUT
Scylla write   → SUCCESS
```

The two databases can now temporarily disagree.

The migration layer should therefore record an operation ID and make retries idempotent.

Differences can be detected asynchronously:

```text
Write
 │
 ├── Cassandra
 │
 └── Scylla
       │
       ▼
  Async comparison
       │
       ├── Match
       │
       └── Divergence → Repair Queue
```

The system should not move to the next migration stage until the amount of divergence is measurable and within an acceptable limit.

If the two databases disagree, the winner should be determined by an explicit version or event-ordering policy rather than whichever write happened to arrive last according to wall-clock time.

## 9. Capacity Estimation

[SOURCE FACT] Historical source numbers include more than 120 million messages per day, a 12-node cluster, replication factor 3, nearly 1 TB of compressed data per node, and a stated possibility of increasing that to 2 TB per node. The source also reports reads below 5 milliseconds and writes below 1 millisecond during testing. Source

These numbers are useful historical reference points, but they should not be copied directly into a new production capacity plan.

[PROPOSED DESIGN] For illustration, assume an average stored message payload and metadata size of 200 bytes before replication.

At 120 million messages per day:

```text
120,000,000 messages/day * 200 bytes/message
= 24,000,000,000 bytes/day
≈ 24 GB/day
```

This is only an illustrative calculation.

With a replication factor of 3:

```text
24 GB/day * 3
≈ 72 GB/day
```

That is the approximate replicated payload before considering:

- Compaction overhead.
- Tombstones.
- Internal metadata.
- Backups.
- Temporary repair space.
- Operational headroom.

Real capacity planning should replace the assumed 200-byte row size with measurements from the actual message distribution.

It should also consider the distribution of traffic rather than only the daily average.

For example, 120 million messages spread evenly across 24 hours is very different from the same number concentrated into several peak hours.

## 10. Trade-offs

[SOURCE FACT] Cassandra provided availability, scale through additional nodes, predictable latency, and locality for related data. At the same time, its eventual-consistency model and tombstone behavior created correctness and operational problems that Discord had to handle explicitly. Source

### Bucket Size

[ANALYSIS] Time buckets introduce a trade-off.

Smaller buckets:

- Keep partitions smaller.
- Reduce the amount of data affected by compaction.
- Reduce the worst-case tombstone range.
- Increase the number of buckets that a read may need to check.

Larger buckets:

- Reduce the number of bucket lookups.
- Reduce metadata overhead.
- Increase partition size.
- Increase the amount of data affected by compaction.
- Increase the risk of hotspots.

There is no universally correct bucket size.

The right value depends on the actual message distribution and the largest channels in the workload.

### ScyllaDB Migration Cost

[PROPOSED DESIGN] ScyllaDB may be attractive if database repair CPU usage and repair duration are important bottlenecks.

However, moving databases has a real engineering cost:

- Running both systems during migration.
- Validating data.
- Testing drivers.
- Matching observability.
- Testing failure behavior.
- Building rollback procedures.
- Managing backfill.
- Operating two systems temporarily.

Therefore:

> Changing the database does not automatically solve the scaling problem.

The partition key, data distribution, deletion strategy, compaction behavior, and operational process still determine whether the system works well.

## 11. What We Can Learn From This Architecture

### 1. Start with the query

[ANALYSIS] Before choosing a database, understand the dominant query.

Discord's message access pattern was primarily:

```text
Give me messages from this channel around this point in time.
```

That led naturally to a key structure based on:

```text
(channel_id, bucket, message_id)
```

The database is therefore not being asked to perform a general search. It is being given a very specific location and range to read.

### 2. Put a limit on partition size

[ANALYSIS] Partitions should have a practical size limit based on the workload.

The source discusses Cassandra's documented partition-size limits, but those limits should not be interpreted as healthy production targets.

A partition can become operationally expensive well before a database reaches its theoretical maximum.

The right question is:

> How large can this partition become before reads, compaction, repair, and failure recovery become uncomfortable?

### 3. Treat deletion as a workload

[ANALYSIS] Deletes create storage work.

Tombstones affect:

- Reads.
- Compaction.
- Repair.
- Garbage collection.
- Storage usage.

Therefore, deletion metrics should be part of the normal operational dashboard.

### 4. Migration should be measurable

[SOURCE FACT] Dark launching, measured latency, and a gradual migration path were central to the original Discord effort. The source also describes a small engineering team operating the system without dedicated DevOps engineers at that time. Source

The broader lesson is that large migrations should not depend on assumptions such as:

```text
"The new database should be faster."
```

Instead, define what success means:

- p95 latency
- p99 latency
- error rate
- data divergence
- repair duration
- compaction backlog
- storage growth
- failure recovery time

Then measure the new system against those criteria.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN]

### Requirements

The system should:

- Retain messages for a long period.
- Read a bounded page of messages around a channel cursor.
- Support edits and deletes.
- Tolerate node failures.
- Scale by adding nodes.
- Keep search and analytics outside the primary message store.

### Storage

Use:

```text
((channel_id, bucket), message_id)
```

with descending clustering order.

Choose the bucket duration from the measured growth of the largest channels rather than using a universal constant.

Maintain metadata for known empty buckets and a repair queue for data mismatches.

### Write Path

The write flow can be:

```text
Client
  │
  ▼
Message API
  │
  ├── Authenticate
  ├── Validate
  ├── Generate message ID
  ├── Write message
  └── Return result
```

Writes should include an idempotency key or operation ID so that a retry does not create a second logical operation.

For edits and deletes, attach an explicit version or event timestamp.

On reads, validate required fields so that a partially written or corrupted row is not silently returned as a valid message.

### Read Path

The read flow can be:

```text
Client
  │
  ▼
Message API
  │
  ▼
Calculate bucket candidates
  │
  ▼
Skip known empty buckets
  │
  ▼
Read partition-local ranges
  │
  ▼
Merge by message ID
  │
  ▼
Return requested page
```

The service should stop once it has enough valid messages.

It should also limit how many buckets a single request can scan.

If the request would require an excessive number of bucket reads, the API should return a controlled retryable error rather than performing an unbounded scan.

### Migration Path

A proposed Cassandra-to-ScyllaDB migration could follow this sequence:

```text
1. Keep Cassandra as the compatibility baseline
             ↓
2. Shadow-read Scylla
             ↓
3. Dual-write with operation IDs
             ↓
4. Compare IDs, versions, and required fields
             ↓
5. Roll out by channel cohorts
             ↓
6. Monitor production behavior
             ↓
7. Increase rollout gradually
             ↓
8. Keep rollback available
```

Important metrics include:

- p95 latency.
- p99 latency.
- Read divergence.
- Write divergence.
- Repair duration.
- Tombstone density.
- Compaction backlog.
- Error rate.
- Recovery time.

### Capacity

Use the historical Discord measurements as context, not as current capacity targets.

For a new system, calculate capacity from:

- Actual row-size percentiles.
- Peak message rate.
- Message distribution across channels.
- Replication factor.
- Repair bandwidth.
- Compaction requirements.
- Failure headroom.
- Storage growth.

Any number that is not directly quoted from the source should be treated as an assumption and validated with measurements.

## Original Sources

Company: Discord. Exact Article Title: “How Discord Stores Billions of Messages.” URL: https://discord.com/blog/how-discord-stores-billions-of-messages.

Information used from the source: the message-retention goal, MongoDB limitations, Cassandra requirements and data model, time buckets, dark launch, eventual-consistency behavior, tombstones, performance observations, historical cluster configuration, and ScyllaDB as a future possibility rather than a completed migration.

Company: Discord. Exact Article Title: “Why Discord is switching from Redis to relational databases and what’s next.” URL: https://discord.com/blog/why-discord-is-switching-from-redis-to-relational-databases-and-whats-next.

Information used from the source: only the scope distinction that this article concerns Redis and relational databases, not a Cassandra-to-ScyllaDB migration.
