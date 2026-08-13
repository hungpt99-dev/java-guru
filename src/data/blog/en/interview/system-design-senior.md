---
title: "Senior Java Interview: System Design"
description: "System design is the senior capstone — a 45-minute judgment test. Process, capacity estimation, caching, CAP, scalability, and observability."
pubDatetime: 2026-08-10T10:25:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - system-design
  - scalability
---

System design is the one interview section where the code you've written stops mattering and the judgment you've earned takes over. It's a 45–60 minute construction project performed in front of a live audience: ambiguous requirements, fuzzy numbers, and every single decision carrying a price tag. The interviewer is not looking for "the right architecture" — there is no right architecture. They're looking for how you think when the room is uncertain.

A junior draws boxes. A senior narrates a tradeoff: "I'll cache the hot 1% in Redis because those keys serve 99% of the reads, and I'll accept up to 60 seconds of staleness on the write path because the business tolerates it — and here's the incident that taught me the naive cache is where the outage hides." That last clause is the whole game. Every section below ends with the drill an interviewer actually runs.

> Mindset: recite a diagram and you're mid-level. Walk through a tradeoff with real numbers and a production failure mode, and you've earned the "senior" checkbox. You don't need to design Twitter — you need to design the part of Twitter that would actually break first, and say so out loud.

## Interview question ladder (Junior → Mid → Senior)

> Drill these out loud. Junior = "do you know the concept"; Mid = "do you know the tradeoffs"; Senior = "can you defend a decision under pressure, with a number and a postmortem."

### Junior — foundations

- **Q: What are the steps of a system-design answer?**
  A: Clarify requirements (functional + non-functional: scale, latency, consistency) → estimate capacity → sketch the high-level components → dive into the 1-2 hardest parts → name the failure modes. Interviewers grade the _shape_ of your thinking, not a "correct" diagram.

- **Q: What's the difference between latency and throughput?**
  A: Latency = time for one request (ms); throughput = how many per second (req/s). A system can have low latency but low throughput (single-threaded) or high throughput but high tail latency (a queue). You optimize them with different levers.

- **Q: What's a cache and why do we use one?**
  A: A fast store (RAM) that holds the results of expensive work (DB query, compute) so repeated reads are cheap. The point: most read traffic hits a tiny hot set, so a cache turns a DB-bound path into a memory path (microseconds vs milliseconds).

- **Q: SQL vs NoSQL — when do you pick which?**
  A: Relational when you need ACID + joins + flexible queries on structured data. NoSQL (document/columnar/KV) when you need horizontal scale on a simple access pattern (single-key lookups, huge write volume). Pick by the _access pattern_, not the hype.

- **Q: What's the difference between horizontal and vertical scaling?**
  A: Vertical = bigger box (more CPU/RAM, hits a ceiling, downtime to resize). Horizontal = more boxes behind a load balancer (near-unlimited, needs statelessness + shared storage). The senior default is horizontal for stateless services.

### Mid — tradeoffs & pitfalls

- **Q: Cache aside vs write-through — when do you use each?**
  A: Cache-aside (app reads cache, on miss loads DB and populates): simple, handles a cold cache gracefully, but a miss can stampede. Write-through (writes go to cache + DB together): reads are always fast, but every write pays the cache cost. The trap: choosing one without stating the write/read ratio of the workload.

- **Q: "60-second staleness is fine." Now design the cache invalidation.**
  A: TTL-based (expire after 60 s) is the simplest; event-based invalidation (on write, purge the key) is fresher but needs a reliable event. The senior names the _stale-read window_ the business accepts and designs to it — and knows that "cache invalidation" is the famous hard problem because deletes race with writes.

- **Q: CAP theorem — pick two, and what does that actually mean?**
  A: Under a network partition you trade Consistency (every node sees the same data) for Availability (every request gets a response). CP systems (e.g. strongly-consistent DBs) reject during a partition; AP systems (e.g. Dynamo-style) serve stale-but-present. "Pick two" is really "what do you sacrifice _during a partition_."

- **Q: How would you shard a 10 TB user table?**
  A: By a shard key (user_id hash) so each shard owns a range of keys and queries stay single-shard. The trap: a bad key (signup-date) creates hot shards; a join across shards becomes a scatter-gather. State the key, the resharding plan, and the cross-shard query you'll avoid.

- **Q: What breaks first at 10× traffic — and how do you find out before it happens?**
  A: Usually the single shared resource: one DB, one cache, one downstream. You don't guess — you load-test to find the knee, and you add a circuit breaker + backpressure so a slow dependency degrades gracefully instead of cascading. Name the _one_ resource you'd watch.

### Senior — design & defense

- **Q: Design a URL shortener for 100M new links/day, 1B reads/day. Size it.**
  A: Writes ~1.2k/s, reads ~11.5k/s. A 7-char base62 key = ~3.5 trillion combos — plenty. Storage: 1B links × ~500 B = 500 GB + replicas. Reads dominate, so cache the hot 1% in Redis (serves ~99% of reads). The senior move is naming the bottleneck (read path) and solving _that_, not over-building.

- **Q: A cache stampede just took down your DB on a hot key. Walk it and the fix.**
  A: A popular key expires; 10k requests all miss simultaneously, all hit the DB, it falls over. Fix: request coalescing (single-flight — one request loads, others wait), jittered TTLs (keys don't all expire at once), and a hot-key local cache. The postmortem: the miss path, not the cache, was the danger.

- **Q: Design for "99.99% available" — what does that actually cost?**
  A: 99.99% = ~52 min/year downtime. It forces multi-AZ (one AZ dies, you survive), no single points of failure, and automated failover. The trade-off: 99.99% costs far more than 99.9% (redundancy, runbooks, game-days). Senior judgment: price the SLA and let the business choose, don't gold-plate by default.

- **Q: You need strongly-consistent cross-region writes. Defend the design.**
  A: That's expensive: synchronous replication across regions adds inter-region latency (tens of ms) to every write, and a partition means unavailability. The senior answer often is "don't" — keep the authoritative write in one region, replicate async for reads, and only pay the consistency cost for the specific records that need it (e.g. balances), not the whole system.

- **Q: The naive cache is "where the outage hides." Give a concrete example.**
  A: A cache that caches _errors_ or _empty results_ — a brief DB hiccup now serves "not found" for 60 s, so users see missing data even after the DB recovers. Or a cache that returns a stale price during a flash sale and oversells. The senior design treats the cache as a _copy with a freshness contract_, not a source of truth, and tests the stale window explicitly.

#### Self-check

- [ ] Junior: the steps of a design answer, latency vs throughput, what a cache is, SQL vs NoSQL, horizontal vs vertical scaling.
- [ ] Mid: cache-aside vs write-through, design invalidation to a staleness SLA, CAP under partition, shard-key choice + resharding, find the first-break resource.
- [ ] Senior: size a URL shortener end-to-end, narrate + fix a cache stampede, price a 99.99% SLA, defend cross-region consistency (usually "don't"), name a cache-outage hiding spot.

## 1. The interview loop — what they're actually scoring

The loop looks like a sequence of five steps. It is, but the sequence is a disguise — the scorecard is filled in during the first ten seconds of each step.

1. **Clarify requirements & scope.** QPS? reads vs writes? latency budget? data size? consistency vs availability? The senior tell: you don't ask "how many users" — that's a population, not a load. You ask the questions that _reveal_ the load: "how many requests per second, what's the peak-to-average ratio, what's the read/write split, and what happens when a read is stale?" "10M users" tells you nothing about whether the service needs one node or fifty.
2. **Back-of-envelope capacity.** "10M users × 100 reads/user/day = 1B reads/day ≈ 11.5k QPS." Numbers stop hand-waving. A senior rounds aggressively, sanity-checks against a known anchor (a single instance serves ~1–10k simple JSON req/s; a single Postgres does low thousands of writes/s), and says "this is within an order of magnitude" instead of pretending to precision.
3. **High-level components.** Clients → CDN → load balancer → API gateway → services → cache → DB → async workers/queues. The order matters less than the story you tell about each hop: what it does, what it costs, and what it's for.
4. **Drill one or two areas deeply.** This is where the interview actually happens. Pick the two decisions with real consequences — the cache consistency contract, the sharding key, the queue depth — and go to internals.
5. **Address failure.** What breaks first? How do you degrade? A senior volunteers this without being asked, because "it works until it doesn't" is the definition of a production system.

The scorecard, in the order interviewers fill it: Did they ask clarifying questions before designing? Did they do the math, or skip it? Did they name tradeoffs, or recite "best practice"? Did they mention failure modes unprompted? Did they know when to stop designing?

> The drill: "Design Twitter." The interview doesn't start when you draw boxes. It starts when you ask "is the timeline read-heavy or write-heavy?" — and the silence before your first question is a datapoint. A senior starts asking questions immediately, because the first question is the one that decides whether the next 40 minutes are a design session or a monologue.

## 2. Capacity estimation — the math that separates engineers from diagram-drawers

Back-of-envelope math is the interview's anti-bullshit filter. Nobody expects an exact number; everybody expects an _anchored_ number — one you can defend from first principles instead of a vibe.

The anchors a senior carries in their head:

```
1 small JSON response           ≈ 1 KB
1 HTML page + assets            ≈ 100 KB
1 image / thumbnail             ≈ 100 KB–1 MB
1 user/day                      ≈ 10 requests (light) / 100 (heavy app) / 1000 (ad-tech)
1 Gbps NIC                      ≈ 125 MB/s  ≈  ~100k small (1 KB) responses/s
1 stateless app instance        ≈ 1k–10k simple JSON req/s
1 single-writer Postgres        ≈ low thousands of writes/s, ~10x that for reads
1 network round trip within a DC ≈ 0.1–0.5 ms
```

The standard walk for a read-heavy service:

```
10M users, 50 reads/user/day, ~1 KB responses

→ 10M × 50 = 500M reads/day
→ 500M / 86,400 s ≈ 5,800 reads/s average
→ 5,800 × 1 KB ≈ 5.8 MB/s ≈ 46 Mbps across the wire   (one NIC has headroom)
→ peak ≈ 3× average ≈ 17,400 r/s ≈ 140 Mbps
→ two or three stateless instances, a Redis cache for the hot set,
  one DB tier — that's the whole architecture, and the numbers prove it
```

The trap every senior names unprompted: **peak-to-average ratio**. Average is the easy number; peaks are where systems die. 5.8k average QPS means nothing when a flash sale or a breaking-news moment pushes you to 50k for forty minutes. Design for the flash sale, not the Tuesday afternoon. And be honest about the ratio you chose — "3×" is a guess, and it should be a guess you can defend from your own dashboards.

The storage math has its own trap: the application data is usually the small number, and the logs are the big one.

```
100M URLs × 500 bytes raw ≈ 50 GB/year        (negligible)
× replication factor 3    ≈ 150 GB/year        (still nothing)
1B redirects × 100 byte log line ≈ 100 GB/day  (a third of a TB per DAY)
```

That "third of a TB a day" forces the real design decision — retention, sampling, and aggregation — long before the URL table does. And the sanity check interviewers love: take a throughput number and convert it to a network or disk number, then say whether the bottleneck is CPU, NIC, or storage. "5.8k req/s of 1 KB responses is 46 Mbps" is a sentence that ends the hand-waving.

> The drill: "10M users, 5 posts/user/day, each post read 100 times. Size it." The senior answer produces reads/s, writes/s, bandwidth, and a year of storage — and then says the ratio out loud: "that's a 100:1 read:write workload, so I'm designing a cache, not a write engine." The ratio is the answer the interviewer was fishing for; the arithmetic is just the receipt.

## 3. Cache strategy — the section where seniors earn their keep

The beginner answer is "use Redis." The senior answer is the consistency contract, the eviction policy, the stampede protection, the L1/L2 layering, and the one cache architecture that collapsed a production system they've seen or caused.

### The four placement strategies and what each one costs

| Strategy                      | What the cache does                                                | Cost / risk                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cache-aside (lazy)**        | App checks cache, misses, queries DB, populates cache              | Simple; app owns invalidation; a miss under concurrency is a stampede                                                                                                                  |
| **Read-through**              | Cache itself loads from DB on miss (Caffeine loader, CacheManager) | Less app code; harder to reason about who's really loading                                                                                                                             |
| **Write-through**             | App writes cache, cache writes DB synchronously                    | Reads always fresh-ish; every write pays the cache hop, and the cache must not lose data                                                                                               |
| **Write-behind (write-back)** | App writes cache, cache batches to DB asynchronously               | Highest write throughput — absorbs a 10× write spike a synchronous path can't — but a crash between cache and DB is lost data. The DB is behind by batch_size × batch_interval, always |

Cache-aside is the default for a reason: it's the one where a cache failure degrades gracefully instead of corrupting. The others buy write performance or read simplicity at the price of a new failure mode, and a senior says which one they're buying.

### The stampede — the classic production collapse

**Cache stampede / thundering herd**: a hot key expires, and 10,000 concurrent requests all miss at once. That single cache miss is worth 10,000 database queries landing in the same millisecond — enough to turn a healthy DB into a pile of slow queries, which makes the cache miss again on the slow repopulation, which makes everything worse.

```java
// WRONG: every miss is an independent DB call → 10,000 misses = 10,000 DB queries
Order o = cache.get(key);
if (o == null) {
    o = db.find(key);          // all 10,000 requests arrive here simultaneously
    cache.put(key, o, Duration.ofMinutes(5));
}

// RIGHT: single-flight — exactly ONE request talks to the DB, the rest wait on it
CompletableFuture<Order> inflight = inflight.computeIfAbsent(key, k ->
    CompletableFuture.supplyAsync(() -> db.find(k))
        .whenComplete((v, e) -> inflight.remove(k)));
Order o = inflight.get(2, TimeUnit.SECONDS);
```

And the silent companion to the stampede: **synchronized expiry**. A thousand keys written with the same TTL all expire at the same instant, so the stampede isn't one key — it's a thousand keys at once. The fix is a smear:

```java
Duration ttl = Duration.ofSeconds(60 + ThreadLocalRandom.current().nextInt(20));
```

With a 60s base and ±10s jitter, keys that were born together expire across a 20-second window instead of one synchronized instant. That jitter is the cheapest ten lines of latency insurance in distributed systems.

### Invalidation — the two hard problems

"There are only two hard things in computer science: cache invalidation and naming things." The senior version of cache invalidation:

- **TTL-only** — you accept up-to-TTL staleness as a business contract. Fine when "the feed is a few seconds old" is acceptable; fatal for a balance or an inventory count.
- **Invalidate on write, never update on write.** Write the DB, then delete the cache key. The delete is not atomic with the write, so a failed delete leaves a stale entry — and that's what the TTL backstop is for. The catastrophic variant is write-through-update: the app writes the DB then writes the new value into the cache, and the two writes race, and the cache can end up holding an older value than the DB forever, with no TTL that helps, because "forever" is the point of the exercise.
- **Versioned keys.** `user:123:v41` → on every write, bump to `v42`. A reader that picked up `:v41` can never see a half-written `:v42`; the old key dies by TTL. This is the mechanism that kills the read-during-write race, and it's the honest answer to "how do you keep the cache and DB from diverging mid-write."

### The L1/L2 hierarchy — where cache design becomes architecture

The number that separates the diagram from the deployment:

```
in-JVM Caffeine hit   → ~10–50 ns      (essentially free)
Redis round trip      → ~0.5–1 ms      (50,000× slower than L1 — still "fast")
DB query, warm pool   → ~1–10 ms
```

A hot read path in production is rarely "Redis." It's a **local L1 cache** (Caffeine) in each app instance holding the genuinely hot keys, with Redis as L2 behind it. The tradeoffs are the interesting part:

- L1 is per-instance. A fleet of 100 instances each holds its own copy, so two instances can disagree for up to the TTL — that's fine for reads, fatal if you put a "balance" in L1.
- **Cold-start stampede.** Every instance repopulating L1 after a deploy sends 100 × its miss-rate at Redis simultaneously. If L1 was silently absorbing 99% of traffic, Redis was sized for 1% — and the deploy is now the outage.
- A senior watches the **L1 hit ratio**, not the Redis hit ratio. The Redis hit ratio can look healthy while L1 is doing all the work, and vice versa — the layering is invisible until it isn't.

### Redis as cache, Redis as store, and the eviction dial

Saying "Redis is fast" is mid-level. The senior framing is the durability contract:

- **As a cache** — pure LRU/LFU eviction, loss-tolerant. `maxmemory` and an eviction policy (`allkeys-lru` vs `volatile-lru`) are capacity planning, not afterthoughts. In `noeviction` mode, a full Redis **rejects writes** — which for a cache means the DB suddenly absorbs the entire load with zero warning. Eviction policy is a load-shedding dial, and you set it on purpose.
- **As a store** — AOF + fsync on every write is a few thousand ops/s; fsync every second loses up to a second of data on a crash; RDB snapshots lose whatever you wrote since the last snapshot. A senior says "Redis as source of truth" and immediately defends the durability setting, because the words "source of truth" and "maybe I lost the last second" don't belong in the same sentence.

And the hot key — the cache's own single point of failure. One celebrity key, one viral URL, one shared counter that 100,000 users hammer: a single Redis key with a giant value serializes on the single-threaded core, and its node becomes the ceiling. Fixes: split the key (`hot:user:123:0..31`), or serve it from L1 where it's genuinely hot, or — for the truly pathological case — accept the ceiling and instrument it.

> The drill: "A flash sale starts at midnight, and every discounted item is cached with a TTL that expires at midnight." The senior answer names the stampede, the single-flight, the jittered TTL, the L1 fallback — and then the part that wins: a deliberate **pre-warm** of the hot keys ten minutes before midnight, so the DB never sees the cold-start curve at all.

## 4. Consistency — CAP, PACELC, and why "eventual" needs a decision, not a hope

The beginner answer is "you choose two of three." The senior answer starts by correcting the framing: **partitions are not a rare failure mode — they're an assumed condition of the network.** Every distributed system operates on the assumption that a partition will happen, so the real question is what you sacrifice _during_ the partition, and what happens _when it heals_.

Under a partition you choose CP or AP:

- **CP** (Raft, single-leader, quorum): the minority side returns errors or waits, but the two sides never diverge. When the partition heals, there's nothing to reconcile.
- **AP** (Dynamo-style): both sides accept writes, so when the partition heals you hold **two conflicting values for the same key**, and somebody has to decide which one wins. "Eventual consistency" is not the data sorting itself out by magic — it's you having a written-down merge strategy.

**PACELC** is the extension that makes seniors shine: even when there is **no** partition (the "ELC"), you're still choosing between **Latency and Consistency** on every operation. That's the honest cost of strong consistency — a synchronous quorum write costs the round trips it takes to reach the quorum, and the latency is the price of the guarantee. A senior volunteers PACELC unprompted because it turns a philosophy debate into a latency budget.

### R + W > N — the math under "eventual"

```
N = replicas, R = read quorum, W = write quorum
R + W > N   →   every read intersects a node that holds the latest write
```

N=3, W=2, R=2: a write lands on two nodes, a read reads two nodes, the sets intersect on at least one — so a read can never miss a completed write. That intersection is the entire mechanism behind "quorum reads/writes," and it's the concrete meaning of "eventual" — the eventual is bounded by how long until a read covers the quorum, not by vibes.

Two senior caveats sit on top of the math:

1. **R + W > N tells you that a read sees _a_ node with the write — not _which_ write is newest.** You still need versioning: vector clocks, or a logical clock (Lamport/HLC). And **last-write-wins with wall-clock timestamps is how you lose data**: two clients on different clocks, an NTP correction, a rollback, and LWW silently picks the wrong "latest."
2. **Quorum availability is a cliff, not a slope.** With N=3, W=2, losing one node is a non-event, but losing two makes writes impossible. "Three replicas" sounds like triple redundancy and behaves like: one failure is fine, two is an outage.

### The leader-based reality of most Java systems

Here's the honest punchline interviewers want to hear: for a typical Java service, you don't actually choose between CP and AP. You choose a **single leader** — Postgres primary, a Redis master, Raft in ZooKeeper/etcd — which is CP with a single writer, and you accept the availability ceiling that comes with it. You reach for Dynamo-style AP only when the availability requirement genuinely cannot be met by a leader: global scale, always-writeable, offline-capable — shopping carts, messaging, collaboration. A senior says "I want one source of truth" out loud and reaches for the complexity budget only when the requirement demands it. The most expensive sentence in system design is "but what if the leader is down?" — a senior knows the answer is "then writes are down," and decides whether that's acceptable before the architecture, not after.

### The failure modes interviewers probe

- **Read-your-writes.** User posts, refreshes, and their post isn't there. Under eventual consistency this is real and business-visible. Fixes: read-after-write affinity (route reads for that session to the replica that just accepted the write), or a session-stickiness layer.
- **Split-brain.** Two nodes both accept writes believing they're the leader. The defense is quorum (W=2 makes two simultaneous leaders impossible with N=3) plus **fencing tokens / epoch numbers** so a demoted leader can't keep writing after losing the election. "Stale leader, new leader, the old one writes anyway" is the exact trace a senior narrates.
- **The two-generals problem.** Two processes over an unreliable channel can never be _guaranteed_ to agree on a message. There is no protocol that makes distributed commit free — only protocols that make the failure window smaller, and you pay for the size of the window. That's why the transactional outbox (write the row and the event in one DB transaction, let a relay publish) exists: it trades a distributed transaction for a local one plus a retryable relay.

> The drill: "Your order service runs two Postgres primaries for 'availability.' The auditor finds orders that exist on one and not the other." The senior answer: that's split-brain, and the fix is a leader election plus fencing — or a quorum — and if the requirement really is availability-first, you design AP with a conflict-resolution policy you can defend to a regulator, and you say the phrase "two primaries is not a distributed system, it's a bug with high availability" out loud.

## 5. Scalability patterns — the mechanics behind the boxes

The beginner answer is "add more servers." The senior answer is the three axes, the statelessness prerequisite, the sharding math, the backpressure contract, and the load-balancer layers — because each of those is a place where "add more servers" silently stops working.

### Statelessness — the prerequisite nobody argues with but everybody violates

You cannot horizontally scale a service that keeps session state in local memory. Sessions belong in Redis (or a session store); `HttpSession` in local memory means a node failure evicts every session it held, and scaling out doesn't spread load so much as shuffle it. The senior addition: statelessness is not just sessions — it's any **local cache you treat as disposable** and any **background thread that assumes it's the only one**. A `@Scheduled` job running on every instance is a bug you deploy on purpose:

```java
// WRONG: five instances, five concurrent purges — double work, races, no single owner
@Component
class NightlyPurge {
    @Scheduled(cron = "0 0 2 * * *")
    void purge() { /* everyone runs this */ }
}

// RIGHT: ShedLock (or a DB row lease) — exactly one leader runs the job
@SchedulerLock(name = "nightlyPurge", lockAtMostFor = "PT1H")
@Scheduled(cron = "0 0 2 * * *")
void purge() { /* one instance holds the lease */ }
```

### Sharding — the math, the hot key, and the growth trap

Sharding splits the data by a key so no single node holds everything. The three strategies, with their failure modes:

- **Range** — `user_id < 1M` on shard 1. Great for range scans; fatal for hot ranges — newest users, latest timestamps, all land on one shard, and that shard becomes the ceiling while the rest idle.
- **Hash** — `hash(key) % N`. Uniform distribution, but no range locality, and **adding a shard remaps almost every key**. Consistent hashing reduces the reshuffle to ~1/N of keys when a node joins or leaves — with 10 nodes, ~10% of keys move instead of ~90%.
- **Directory** — a lookup table mapping key → shard. Most flexible; but the directory is itself a hot, strongly-consistent store, which is just the bottleneck wearing a different hat.

The hot key bites in sharding exactly the way it bites in Kafka: one celebrity, one top seller, one busiest customer — the hash drops them on one shard, and that shard's ceiling is your system's ceiling. The fixes are the same family: composite keys, shard-within-the-shard, or instrument and accept. And the clarifying statement interviewers fish for: **replication gives you failure tolerance, not scale.** A shard replicated 3× still has the write ceiling of one node — copies don't parallelize writes.

### Async + backpressure — the "shed load" decision

A queue between the request path and the slow work is the classic design. The part candidates skip is **backpressure** — what happens when the queue fills faster than the workers drain it. Little's law, one more time:

```
queue depth  =  arrival rate  ×  processing time
10k msg/s × 1 s of processing  =  10,000 messages in flight at steady state
```

A queue with no bound and no scaling is just a buffer for a delayed outage: the workers fall behind, the queue grows, the queue's storage grows, then the queue dies and the producers pile up instead. The senior playbook:

- **Bound the queue** and reject or drop when full — a fast, clean failure beats a slow, cascading one.
- **Scale the workers with the backlog** (KEDA on Kafka lag, SQS autoscaling by queue depth) so the queue is the load signal, not a death spiral.
- **Degrade deliberately.** Serve the cache, shed the non-critical writes, return a friendly `503` instead of queueing forever.
- **Circuit breaker** (Resilience4j): after N failures, trip the breaker and fail fast. The number that makes this concrete: a dependency at 2 s latency with a 500 ms client timeout doesn't "slow down" — every caller becomes a parked thread, and at 10k req/s that's 20,000 threads waiting on a dead dependency. That's the outage pattern: not "the dependency failed," but "the failure propagated and took the whole fleet with it." The breaker converts a 2-minute timeout-fest into a 50 ms rejection.

### Load balancing — the layers, and the deploy detail

L4 balances TCP connections (fast, opaque, healthy-node-aware); L7 balances HTTP (path-based routing, endpoint health checks, sticky sessions). The senior detail interviewers probe is **connection draining**: on a rolling deploy, the LB stops sending new traffic to an old node and waits for in-flight requests to finish. A `kill -9` on a node still serving traffic is how "deploy" becomes "outage." Same family as the Kafka rebalance and the GC pause: graceful degradation is a design feature, not a nicety.

> The drill: "My order service has 40 instances and still feels slow. The interviewer points out the single Postgres. Why is it the bottleneck?" The senior answer names the write path: a single writer means single-node write throughput, and 40 instances reading don't help writes. Then the honest follow-up — "so we either shard the write path, or, since the write QPS actually fits on one node, we accept the ceiling and tune the reads." Saying "we didn't need to shard" is a senior sentence.

## 6. Mini example: URL shortener, done to senior depth

The canonical system-design question, and the one where most prep blogs get the math wrong. The senior version:

### The encoding math, with the birthday bound nobody mentions

The standard line is "62^7 ≈ 3.5 trillion — more than enough space." That's true and it's a trap, because it confuses **space** with **collision probability**. A random 7-char code drawn from that space collides embarrassingly fast:

```
62^7  ≈ 3.5 × 10^12   → at 100M inserts, expected collisions ≈ N²/2M ≈ 1,400
62^10 ≈ 8.4 × 10^17   → at 100M inserts, expected collisions ≈ 0.006
```

A hundred million random 7-char codes collide on the order of fourteen hundred times. The naive loop ("while key exists, retry") turns into a retry storm at scale. The senior fix is to stop _generating_ keys and start _encoding_ them:

```java
// WRONG: random 7-char codes — "3.5T of space" ignores the birthday bound
String key = randomBase62(7);                 // ~1,400 collisions per 100M inserts
while (keyExists(key)) key = randomBase62(7);

// RIGHT: bijective encoding of a unique id — zero collisions by construction
long id = idService.nextId();                 // snowflake or DB sequence
String key = encodeBase62(id);                // 7 chars cover 3.5T sequential ids

// RIGHT for unguessable keys: hash the URL, take 10 base62 chars (birthday-safe)
String key = encodeBase62(sha256(url), 10);
```

### The numbers that size the whole thing

```
100M new URLs/day → ~1,200 writes/s sustained, 3–5× peak
1B redirects/day  → ~11.5k reads/s, ~35k peak
read:write ratio  → ~10:1  → textbook cache profile: hot reads, cold writes
```

```
Storage: 100M URLs × 500 bytes ≈ 50 GB/year, RF3 ≈ 150 GB  →  trivial
Logs:    1B redirects × ~100 bytes ≈ 100 GB/day  →  ~3 TB/month
```

The logs are the storage problem, not the URLs. Retention and aggregation decide the real infrastructure cost, and saying so unprompted is the senior tell.

### The cache layer, with the latency budget

A redirect has a ~10 ms latency budget. Against that budget: a DB hit is 1–10 ms (most of the budget), a Redis hit is ~0.5 ms, a CDN edge redirect is ~1–5 ms from the nearest PoP. Most redirects hit a small set of URLs — the 1% of keys that serve 99% of the traffic — so the design is:

1. **CDN edge cache** for the genuinely viral URLs (a redirect served from the edge never reaches your infrastructure).
2. **Redis with LRU** for the hot set, `R + W` tuned as a cache, not a store.
3. **The DB** for everything else, protected by single-flight so a cache eviction never becomes a stampede.

The cache isn't a "nice to have" here — it's the design. Without it, the DB is the redirect path, and the 10 ms budget dies on the first popularity spike.

### The decisions with consequences

- **301 vs 302.** A `301` is cached by browsers and every intermediate proxy — one redirect is served and never hits you again. Cheap, and you pay for it with: you can't change the target for that key for the cache lifetime, analytics go blind, and a bad redirect survives your fix in every client's cache. A `302` hits your service (or your CDN) every time — more load, but you control the target and measure every click. The senior answer: `302` + CDN, and `301` only for keys you will never change.
- **Enumeration.** Sequential base62 keys are crawlable — every short URL in order, for free. Random keys are not. If the service is public, rate-limit lookups and think about whether keys should be unguessable.
- **The viral URL.** One URL doing 1M redirects in two minutes: the hot key saturates Redis (single-threaded core, one node), so the answer is CDN-first plus the split-key trick, and instrument the top-K list so you see it coming.

> The drill: "Design a URL shortener." The senior answer delivers, in about ten minutes: the read:write ratio (~10:1), the birthday-bound correction (random 7-char codes collide ~1,400 times per 100M; encode an ID instead), the log-storage math (~3 TB/month of raw logs), the 301/302 decision, and the CDN-first hot-key answer. That sequence, unprompted, is the whole section.

## 7. Observability — the design isn't done until you can see it fail

"We'll add monitoring later" is a red flag because it's the only sentence that makes every other design decision undebuggable. Observability is not a dashboard you add at the end; it's the difference between a senior who can walk into an incident and a senior who gets paged into a mystery.

- **Metrics.** RED for request services (Rate, Errors, Duration); USE for resources (Utilization, Saturation, Errors). The senior move is naming the metric that maps to the SLO — p99 latency, error rate, queue depth — rather than "CPU." CPU is a resource metric; the user feels latency.
- **Logs.** Structured JSON, one line per event, and every line carries `traceId`/`spanId`. At 10k req/s, logging every success is 10k lines/s of noise — log at warn/error by default and sample the happy path. The correlation ID is the thread that ties the request across services, and the W3C `traceparent` header is how it travels.
- **Tracing.** Distributed traces (Micrometer Tracing / OpenTelemetry) show the first slow span in a chain. They're not free: each span is serialized and exported, ~0.1–1% of request latency and a real CPU tax at scale — so head-based sampling (10% or 1% at high QPS) is part of the design, not a compromise.
- **SLI / SLO / error budget.** An SLO of 99.9% is ~43 minutes of allowed downtime per month. The error budget converts "can we ship?" from a vibe into arithmetic: budget burned → stop shipping risky changes. Alert on the SLO — symptom-based (latency, errors), not cause-based (a specific log line) — because symptoms are what users feel and causes are what your on-call will find anyway.

> The drill: "p95 latency doubled at 3 a.m. Walk me through your first ten minutes." The senior answer: check the SLO burn rate first (is this trending or a blip?), grab a failing request's correlation ID, follow its trace to the first slow span, then ask the branching question — is it a dependency (trip the circuit breaker) or the DB (buffer-pool hit ratio, slow-query log, connection-pool saturation)? — and, the part that wins: "I can do all of that because I instrumented it before the deploy, so the data was already there."

## 8. Self-check

- [ ] Ask the clarifying questions that reveal load (QPS, peak-to-average, read/write ratio) before drawing a single box.
- [ ] Size a read-heavy service from anchors: users → requests/day → QPS → bandwidth, with a defensible peak factor.
- [ ] Explain why a random 7-char base62 key collides ~1,400 times per 100M inserts and how encoding an ID fixes it.
- [ ] Design cache-aside with single-flight stampede protection, jittered TTL, and invalidate-on-write — and say which failure each fix prevents.
- [ ] Name the L1/L2 tradeoffs and the cold-start stampede after a deploy.
- [ ] State CAP correctly (what you sacrifice _during_ a partition) and add PACELC unprompted.
- [ ] Prove `R + W > N` and explain why LWW with wall-clock timestamps loses data.
- [ ] Defend a sharding key — and say what a hot key does to the system's ceiling.
- [ ] Give the backpressure contract: bound the queue, scale workers on backlog, circuit-break the dead dependency.
- [ ] Answer "what breaks first and how do you degrade?" without being asked.

## 9. Interviewer follow-ups

When your first answer lands, they start drilling. Be ready for these:

- "10M users is a population, not a load. What numbers do you actually need, and why?"
- "Your cache hit ratio is 90%. Is that good? What's the number you'd really watch?"
- "A hot key expires and 10,000 requests hit the DB at once. Walk me through the fix, then tell me which of the three failure modes you just handled."
- "Cache the value, or invalidate the key, on write? What does TTL protect you from in each case?"
- "Redis restarts at 3 a.m. What happens to your service, and what do you do before the next deploy?"
- "State CAP for me — and tell me what happens when the partition heals, not just during it."
- "Why does last-write-wins with timestamps lose data? What would you use instead?"
- "Your queue depth is climbing, workers at 100% CPU, DB at 40%. Where's the bottleneck, and what do you change first?"
- "Add a shard to a hash-sharded store. What breaks, and what does consistent hashing change?"
- "A 301 vs a 302 for redirects — which one do you pick, and what do you lose either way?"
- "Your p95 just doubled. SLO is 99.9%. What's your error budget, and what do you check first?"
- "Why is 'two Postgres primaries' not high availability — and what's the design that actually is?"

That's the system-design bar.
