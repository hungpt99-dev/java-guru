---
title: "Java Interview Prep #7: System Design — Junior to Senior"
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

System design is the interview that has no right answer — only defensible trade-offs. Junior candidates name components; seniors walk a problem from vague requirements to a number-backed design and say where it breaks. This post climbs from "draw a diagram" to "here is the latency budget and the failure I'm watching" — 50 questions, pick the level you are interviewing at, and read one above it.

> Mindset: junior produces a diagram; senior produces a diagram _and_ a latency budget, a capacity estimate, and the single failure mode most likely to page them at 2 a.m.

## Junior — foundations

**Q1. What are the main building blocks of a web system?**
A typical stack is a pipeline where each layer adds one capability: the LB spreads load, the cache absorbs reads, the queue decouples slow work, the DB owns truth. Know the role of each block before you can debate any of them:

```
Client ──> DNS ──> Load Balancer ──> App Servers ──> Cache (Redis)
                         │               │  │            │
                         │               │  └──> Message Queue ──> Workers
                         │               └──────> Database (primary ──> replicas)
                         └───────────────> CDN (static assets)
```

**Q2. What happens when you type a URL and press Enter?**
DNS lookup → TCP handshake → TLS handshake → HTTP request → app logic → response. Each step costs measurable time — DNS ~10–50 ms (cached ~0 ms), RTT ~1–50 ms, TLS ~10–100 ms. This is your first latency budget: a "fast" request is mostly waiting on the network, not your code:

```text
browser → DNS (10–50 ms) → TCP handshake (1 RTT) → TLS (1–2 RTT, ~10–100 ms)
        → HTTP req (RTT) → app logic (10–200 ms) → HTTP resp (RTT)
a 200 ms budget: network eats ~60–80% of it before your code runs
```

**Q3. What is the difference between L4 and L7 load balancing?**
L4 routes on TCP/UDP ports — fast (~µs), no packet inspection, can't route by URL. L7 routes on HTTP — slower (parses headers, ~tens of µs), but can path-route, retry, and do sticky sessions:

```
L4:  Client ── TCP:443 ──> LB ──> any healthy node
L7:  Client ──> LB ── /api/*    ──> api nodes
                  └─ /static/*  ──> CDN origin
```

**Q4. What is the difference between horizontal and vertical scaling?**
Vertical = bigger machine (more CPU/RAM) — simple but capped at the largest cloud instance and a SPOF. Horizontal = more nodes behind an LB — no hard cap, but requires statelessness. If one node does ~500 RPS and you need 10k QPS, vertical needs a 20× machine that doesn't exist; horizontal needs ~20–25 nodes (with headroom):

```text
needed_nodes = target_rps / per_node_rps × (1 + headroom)
             = 10_000 / 500 × 1.25 ≈ 25 nodes
```

**Q5. What does stateless mean, and why does it matter for scaling?**
A stateless server keeps no per-request memory — every request carries what it needs, so any node can serve any request. Sessions in memory are the classic violation; moving them to a shared store (Redis) or a client token is the fix:

```java
// WRONG — state in the instance, sticky sessions required
session.put("cart", cart);

// RIGHT — state outside the instance; any node handles any request
String cartId = redis.set(cartJson);   // TTL 24h
```

**Q6. What is cache-aside, and when does it break?**
The app checks the cache first; on a miss it reads the DB, populates the cache, and returns. Simple and resilient (cache failure falls back to DB) but you pay a stale window and risk a stampede on a hot-key miss:

```java
String v = redis.get(key);
if (v == null) {
    v = db.query(key);              // miss: hit the DB
    redis.set(key, v, 60s);         // populate with TTL
}
return v;                           // hit rate ~95% on hot keys
```

**Q7. What is a CDN and when do you use it?**
A CDN caches static assets at edge locations near users, cutting both latency and origin load. Use it for anything static and read-heavy. Dynamic user-specific responses don't cache — that's the boundary:

```
user in Hanoi ──> edge node SG (5 ms) ──> cache hit, done
origin in Frankfurt (200 ms) only touched on cache miss
```

**Q8. What is the difference between SQL and NoSQL, in one minute?**
SQL gives ACID, joins, and strong schema — best for transactional relational data (money, orders). NoSQL trades guarantees for scale and flexible schema — best for high-volume or loose data (sessions, time-series, graphs). Pick by data shape and consistency needs, not fashion:

```text
order + money + joins → SQL (ACID across rows)
sessions, feeds, metrics, docs → NoSQL (scale-out, flexible schema)
the hybrid that wins: Redis cache + Postgres truth + column store for analytics
```

**Q9. What is a database index, and why does a query slow down without one?**
An index is a sorted structure (B-tree) mapping key → row location, turning a full table scan into a log-time lookup. Without an index, a 10M-row table scan is ~1–5 s and reads every row; with one, a lookup is ~1–10 ms and reads a few pages. The index has a cost — every write must update it:

```text
no index:  SELECT * FROM orders WHERE user_id = 42 → full scan of 10M rows ~1–5 s
with index: B-tree lookup → ~1–10 ms (a few pages read, not 10M rows)
cost: each INSERT/UPDATE now also writes the index B-tree
```

**Q10. What is a message queue, and what problem does it solve?**
A queue buffers work between a producer and a consumer that can't keep pace, decoupling them so a slow consumer or a crash doesn't block the producer — and it smooths spikes: the queue absorbs the burst, consumers drain at their own rate:

```
Producers (10k req/s burst) ──> Queue ──> Consumers (drain 2k req/s)
                                      └──> retries + no drops, drains after the spike
```

**Q11. What is CAP in plain terms?**
You can't have all three of Consistency, Availability, and Partition tolerance — and partitions (network splits) are inevitable, so you really choose between **CP** (pause writes to stay consistent) and **AP** (stay up, risk stale reads). A payments ledger is CP; a social feed is AP. The interview trap is claiming "we have all three":

```text
         Consistency
            /\
           /  \
          /    \
         /  YOU \
        /   pick \
       /    ONE   \
Consistency─CP───AP─Availability
   (pause)      (stale)
   ZooKeeper    Cassandra
   ledgers      like-counts
```

**Q12. Monolith vs microservices — which is better?**
A monolith is one deployable; microservices are many small ones with network calls between them. Monoliths win on simplicity and transactionality; microservices win on independent scaling and deployment. A 3-person team with a monolith at 10k QPS beats a 20-person team with 12 services at 2k QPS. The honest senior says: start monolithic, split when the team and the load justify it:

```text
monolith:       one deployable, one DB → local transactions, simple deploys
microservices:  many deployables → independent scale/deploy, but network calls,
                distributed transactions, and 3× the operational surface
rule of thumb: keep the monolith until a team boundary or a scaling axis demands the split
```

**Q13. What is idempotency in HTTP, and why does `POST` need help?**
An idempotent operation gives the same result whether called once or ten times — essential because clients retry on timeouts. `PUT` and `DELETE` are naturally idempotent; `POST` is not, so it needs a client-supplied idempotency key:

```
Client ── POST /orders (key=abc-123) ──> Server
Retry  ── POST /orders (key=abc-123) ──> Server returns stored result, no double-charge
```

**Q14. What is a reverse proxy, and how is it different from a forward proxy?**
A forward proxy sits in front of clients (hides them); a reverse proxy sits in front of servers (hides them) — it terminates TLS, balances load, and exposes one endpoint:

```
Forward:  client ──> proxy ──> internet
Reverse:  internet ──> LB/proxy ──> app1, app2, app3 (clients never see the fleet)
```

**Q15. WebSocket vs HTTP long polling — when do you pick which?**
HTTP request/response means the client must poll for updates; WebSocket holds a bidirectional connection, pushing updates instantly. Long polling is simple and works everywhere but costs a request per event — a dashboard updating 1×/s from 1k clients is ~1k RPS of polling. WebSocket keeps one connection per client — better for chat, live prices, dashboards:

```
long polling: client ──req──> server (holds open until event) ──resp──> repeat
websocket:    client ══ one bidirectional connection ══> server (instant push)
```

**Q16. What is replication, and what does it give you?**
Replication copies writes from a primary to replicas, giving read scale and failover. With **3 replicas** you can survive a node loss and still serve reads; you pay replication lag (typically <1 s in the same region) and stale reads if you read from replicas:

```
Primary (writes) ──async──> Replica 1
                    └──────> Replica 2
                    └──────> Replica 3
writes: 1 primary. reads: spread across 3 replicas (3× read capacity)
```

**Q17. What is sharding, and what does it cost you?**
Sharding splits data across nodes by a key, multiplying write capacity — but it breaks joins, transactions, and global queries. Sharding into **256 shards** gives ~256× write headroom, but each shard is now its own database with its own backups and capacity planning. Shard late, shard deliberately, and choose the key before you need it:

````
hash(user_id) % 256 → shard 0..255, each holding 1/256 of rows
one order's rows all live on one shard → reads stay single-shard
```## Mid — tradeoffs & pitfalls

**Q18. Cache invalidation — TTL vs write-through vs write-back, and the race?**
**TTL** (auto-expire) is simple and allows brief staleness. **Write-through** updates cache and DB together — always consistent, but doubles write latency. **Write-back** writes the cache, flushes later — fastest writes, but a crash loses unflushed data. The race: a read populating stale data can interleave with a write, leaving the cache wrong until TTL. Most teams accept short-TTL staleness:

```java
db.save(order); redis.del(key);        // write-through: +1 round trip on every write
redis.set(key, order, 60);            // TTL: stale up to 60s, zero coordination
// the race: read misses → DB returns old row → write commits → cache holds old value
````

**Q19. What is a cache stampede, and why doesn't TTL alone save you?**
When a hot key expires, 1k concurrent requests all miss and all hit the DB — the DB gets 1k× load for the same single value. TTL makes it worse (all keys expire together). Fixes: jitter the TTL, single-flight per key, or refresh before expiry. A stampede on one hot key at 10k QPS can take a DB from 200 ms p99 to 2 s in seconds:

```java
// jitter: stagger expiry so the herd doesn't expire at once
redis.set(key, v, baseTtl + ThreadLocalRandom.current().nextInt(30));
```

**Q20. How do you estimate capacity for 10k QPS?**
Back-of-envelope, weakest layer first. One stateless app node handles ~500 RPS at p99 < 200 ms (measured, not guessed) → ~20 nodes + headroom → 25–30. Then check the DB: each request may do 2–3 queries, and a connection pool caps effective throughput:

```text
app nodes  = 10_000 / 500 × 1.25         ≈ 25
db queries = 10_000 × 2 per request      = 20k QPS → 95% cache hit → ~1k QPS to DB
cache      = hot set ~5% of data → hit rate ~95% → 5–10 GB Redis
```

**Q21. When is SQL the wrong answer, and when is NoSQL a trap?**
SQL is wrong when you need horizontal write scale with flexible schema — clickstream at 100k writes/s vs a single Postgres primary at ~5–10k writes/s. NoSQL is a trap when you have real joins and multi-row transactions — you'll reimplement them badly. Pick by data shape: relational + money → SQL; high-volume + loose + single-doc access → NoSQL. Both at once is legitimate — cache in Redis, truth in Postgres, analytics in a column store:

```text
clickstream at 100k writes/s: SQL primary caps ~5–10k writes/s → NoSQL/column store
orders + invoices with joins: NoSQL re-implements joins badly → stay SQL
decision: shape + consistency first, scale second
```

**Q22. CAP in practice — which real systems are CP, which are AP?**
ZooKeeper/etcd are CP (they stop writes during a split); Cassandra/Dynamo are AP (they accept writes, reconcile later, and you may read stale). A ledger is CP; a "like count" is AP. The senior answer adds the cost: during a partition, CP loses availability (a bank that pauses is fine for seconds, not minutes), AP loses correctness guarantees (a like counter at 99.5% accuracy is invisible; a balance at 99.5% is not):

```text
system          | during partition        | cost of being wrong
ZooKeeper, etcd | CP: writes pause        | seconds of unavailability
Cassandra       | AP: writes accepted     | stale reads, reconciles later
ledger          | CP                      | money must never double-spend
like counter    | AP                      | 99.5% accuracy is invisible
```

**Q23. Why not shard by `hash(key) % N`?**
Modulo sharding means adding a node rehashes nearly everything — going 3 → 4 nodes re-maps ~75% of keys, and during migration, lookups miss. **Consistent hashing** maps keys and nodes onto a ring so adding a node moves only ~1/N of keys (1/4 when going 3 → 4). With **virtual nodes** (each physical node owns ~100–200 ring positions) load also smooths out:

```
ring: [n1] [n2] [n3] [n1] [n3] [n2] ...   (virtual nodes)
add n4 → only keys whose hash lands in n4's slots move (~1/4 of keys)
modulo 4 → 75% of keys move
```

**Q24. At-least-once vs at-most-once vs exactly-once — which can you actually have?**
Queues give **at-least-once** by default (retries on ack loss → duplicates). At-most-once drops duplicates but can lose messages. Exactly-once is marketing — you get it by making consumers **idempotent** (dedupe on a message ID), not by magic. At-least-once + idempotent consumer is the only production-sane combination:

```text
producer ──> queue (retries) ──> consumer processes the message twice
consumer dedupes on msgId in the DB → exactly-once effect, no double side-effects
```

**Q25. How do you implement idempotency in a real API?**
The client sends an `Idempotency-Key` header; the server stores the first response keyed by it and returns the stored result on retry. The atomic part matters — check-then-insert must be a single unique-constrained write, or two concurrent requests both execute:

```java
String key = req.getHeader("Idempotency-Key");
Order existing = orders.findByKey(key);
if (existing != null) return existing;        // replay: return stored result
Order order = orderService.create(cart);       // first execution
orders.insertWithKey(order, key);              // UNIQUE(key) → second insert throws
```

**Q26. How do you size a database connection pool?**
Pool size follows concurrency, not request rate: `pool ≈ desired_concurrency × (avg_query_ms / target_latency_ms)`. At 10k QPS with 5 ms average queries and a 200 ms budget, ~50 queries are in flight per node — a pool of 10–20 per node is plenty. More connections is not more speed: each Postgres connection costs ~1–10 MB and CPU, and beyond ~cores×2 they add contention:

```text
in-flight queries = 10_000 req/s × 0.005 s = 50 across the fleet
pool per node     = 50 / 25 nodes ≈ 2–4 minimum, 10–20 for headroom
```

**Q27. What is the N+1 query problem, and how do you fix it?**
Looping over N parent rows and fetching children per row issues 1 + N queries — 1k orders becomes 1,001 queries and p99 explodes. Fix with a single `IN`/join query or batch fetching:

```java
// WRONG: 1 + N queries
for (Order o : orders) { customers.get(o.customerId); }   // 1_001 queries

// RIGHT: 2 queries total
Map<Long, Customer> byId = customers.getByIds(orders.stream()
        .map(Order::customerId).toList());                 // 2 queries
```

**Q28. When does an index hurt more than it helps?**
Every index multiplies write cost — an insert must update the table plus every index (each a B-tree write). On a write-heavy table, 5 extra indexes can cut write throughput by half, and a 1 GB table with heavy indexes can be 2–3 GB on disk. Rule: index what your reads filter on, verify with `EXPLAIN`, and drop unused indexes:

```text
read-optimized:  1 index → lookup 1 ms vs full scan 2 s (2,000×)
write-optimized: 5 indexes → each insert pays 6 B-tree writes, not 1
```

**Q29. Read replicas — what breaks when you add them?**
Replicas scale reads but introduce replication lag (asynchronous; typically <1 s, seconds under load). A user who writes then reads can hit a replica that hasn't seen the write — "read-your-writes" breaks. Fixes: route the user's own reads to the primary (or add a read-after-write delay), and accept lag for everything else:

```
write ──> primary ──async (lag 100 ms–2 s)──> replica
user reads own order from a replica → stale/404 for up to the lag
fix: own-reads → primary; everyone else's reads → replicas
```

**Q30. Timeouts, retries, backoff — how do you do this without killing your service?**
Every downstream call needs a timeout (a 10 s default timeout on a 5 s SLA is a bug), retries with exponential backoff + jitter, and a retry budget cap. Without jitter, retries synchronize into a retry storm that takes down the downstream you were trying to save:

```java
int attempts = 0;
while (attempts < 3) {
    try { return client.call(req); }
    catch (TimeoutException e) {
        long wait = Math.min(1000L << attempts, 4000L);              // 1s, 2s, 4s
        Thread.sleep(wait + ThreadLocalRandom.current().nextLong(200)); // +jitter
        attempts++;
    }
}
```

**Q31. How does a token-bucket rate limiter work, and where does it live?**
Tokens refill at a fixed rate (e.g. 100 tokens/s) and each request spends one; bursts up to the bucket size pass, sustained rate is capped. Put it at the edge (API gateway/LB) to protect the fleet, and again per-tenant so one noisy customer can't starve everyone. The algorithm is O(1) per request:

```java
class TokenBucket {
    private final double rate;                   // tokens per second
    private final long capacity;
    private double tokens;
    private long lastRefill = nowNanos();

    boolean tryAcquire() {
        tokens = Math.min(capacity, tokens + (nowNanos() - lastRefill) / 1e9 * rate);
        lastRefill = nowNanos();
        if (tokens < 1) return false;
        tokens -= 1;
        return true;
    }
}
```

**Q32. What is backpressure, and what happens without it?**
Backpressure is the system telling the producer "slow down" — otherwise the queue grows, memory grows, and the JVM dies of OOM, or the consumer keeps getting overwhelmed and cascades failures. Options: bounded queues with rejection, blocking producers, or dropping oldest. An unbounded queue at 10k req/s with a 2k req/s consumer grows ~8k messages/s until the heap dies:

```java
new ThreadPoolExecutor(core, max, keepAlive, SECONDS,
        new ArrayBlockingQueue<>(1000),           // BOUNDED: backpressure
        new AbortPolicy());                       // reject → 503, not OOM
```

**Q33. Distributed transactions — why is 2PC a trap, and what do you use instead?**
Two-phase commit locks resources across services for the duration — the coordinator becomes a SPOF and one slow participant stalls everything. The alternative is the **saga pattern**: a sequence of local transactions with compensating actions. The senior answer: don't make money moves across services in one transaction — redesign the split or accept eventual consistency:

```text
2PC:  order ──prepare──> payment ──prepare──> inventory (all commit or all abort, locked)
saga: createOrder ✓ → chargePayment ✓ → reserveInventory ✗ → refundPayment (compensate)
```

**Q34. Eventual consistency — what does it actually mean for your users?**
After a write stops, all replicas converge — but in between, reads may be stale. The practical contract is read-your-writes (your own writes are visible), monotonic reads, and "converges in seconds". Eventual consistency is not "sometimes wrong forever" — it's "briefly stale, then right, and here's the reconciliation":

````
write ──> primary ──> replicas (eventually, <1 s typical)
user reads stale for ~lag, then correct — never permanently divergent
```## Senior — design & defense

**Q35. Design a URL shortener for 100M URLs and 1B redirects/day. Walk it.**
"Requirements first: redirects <50 ms and highly available; reads dominate writes ~100:1. 1B redirects / 86400 s ≈ **11.5k RPS** average with spikes to ~30k. Base62-encode a counter or hash into a 7-char key. Hot keys live in Redis — most traffic hits ~5% of links, so **cache hit ~95%** — the app tier is stateless behind an LB, and the DB is sharded by key prefix. The failure I watch: a suddenly-viral link stampedes the cache → single-flight per key on miss:

````

Client ──> LB ──> redirect service (stateless ×N)
├──> Redis (hit ~95%, ~1 ms)
└──> DB shards on miss (shard by key, 3 replicas)
1B/86400 ≈ 11.5k RPS → ~25 nodes @ ~500 RPS, Redis cluster ~5–10 GB

```

**Q36. A service's p99 latency tripled after a deploy. Find the cause with a budget.**
"I decompose the budget: LB → TLS → app → cache (1–2 ms) → DB (5–15 ms) → downstream. I compare the new trace waterfall to baseline and look for the span that grew — tripled p99 almost always means a new synchronous dependency or an N+1 query (50 DB calls instead of 1). Fix: batch the calls, move the dependency off the critical path, or cache. I prove it with per-span p99 before/after — the offending span is the one that grew, not 'the system is slow':

```

span budget: LB 5 ms → TLS 20 ms → app 80 ms → cache 2 ms → DB 10 ms
after deploy: DB span 10 ms → 60 ms (6×) ← an index-less query, found in one trace

````

**Q37. Implement consistent hashing with virtual nodes.**
"Each physical node owns ~100–200 virtual positions on a 2^32 ring; a key goes to the first clockwise node. Adding a node only relocates the keys that land in its new slots (~1/N of them), versus ~75% for modulo. With **256 physical shards** I'd skip virtual nodes (granularity is already fine); for 8 nodes under uneven load, virtual nodes rebalance:

```java
class ConsistentHash {
    private final TreeMap<Integer, String> ring = new TreeMap<>();

    void addNode(String node, int vnodes) {
        for (int i = 0; i < vnodes; i++) {
            int h = hash(node + "#" + i);        // virtual position on the ring
            ring.put(h, node);
        }
    }
    String get(String key) {
        var e = ring.ceilingEntry(hash(key));     // next clockwise node
        return (e != null ? e : ring.firstEntry()).getValue();
    }
}
````

**Q38. How do you defend against a cache stampede with single-flight?**
"When a hot key misses, only one request should hit the DB; the rest wait on the first. A `ConcurrentHashMap<String, CompletableFuture>` per key gives that — on miss, create the future; everyone else awaits it. Combined with a 60 s TTL, the DB sees ~1 query per key per TTL window instead of 10k:

```java
CompletableFuture<V> f = inflight.computeIfAbsent(key,
        k -> supplyAsync(() -> db.query(key))        // ONE DB call
                .whenComplete((v, t) -> inflight.remove(key)));
return f.get(200, MILLISECONDS);                     // the other 9,999 await it
```

**Q39. Design for a 99.95% SLA — what does the number actually require?**
"99.95% allows **26 minutes of downtime a year** — about 4 minutes a month. A single region typically gives 99.9–99.99% per component, and the chain multiplies: 0.999 × 0.999 × 0.999 ≈ 99.7%. So the number dictates the architecture: 99.95% forces redundancy at every layer — **3 replicas** of the DB, ≥2 app nodes per AZ, a cross-region failover plan — and game days proving it:

```
single server:      99.9%  → 8.8 h/year down
app + DB pairs:     99.99% → 52 min/year
+ cross-region:     99.95% → 26 min/year ← target budget
```

**Q40. Active-active vs active-passive across regions — and the split-brain risk?**
"Active-passive is simple: one region serves, the other fails over — you eat failover time and lose writes in the gap. Active-active serves both but risks split-brain on writes — two regions accepting writes for the same key. The safe pattern: each region owns a disjoint shard of keys, and reads are eventual across regions. I'd start active-passive and go active-active only for the read path:

```
active-passive: region A serves (99.95%), B standby (RTO ~minutes)
active-active:  A owns keys 0–127, B owns 128–255 → no write conflict
both: async replication; the failure I watch is lag + stale reads
```

**Q41. Design a circuit breaker for a failing dependency.**
"Count recent failures; past a threshold (e.g. **>50% failures in a 10 s window**), open the circuit — requests fail fast (or serve a fallback) without touching the dependency, giving it time to recover. Half-open after a cooldown to probe with one request. `Resilience4j` or a hand-rolled state machine — the state machine is the interview answer:

```
CLOSED (normal) ── failures > 50% in 10 s ──> OPEN (fail fast, ~30 s)
OPEN ── cooldown elapsed ──> HALF_OPEN (1 probe)
HALF_OPEN ── probe ok ──> CLOSED    |    probe fails ──> OPEN
```

**Q42. What is non-negotiable observability for a system you hand to on-call?**
"Three pillars, but the non-negotiables: every external call timed and tagged, every error countable, and alerts on _symptoms_ (user-facing error rate/latency), not causes (CPU). RED metrics — rate, errors, duration — with SLOs and burn-rate alerting. If p99 > 200 ms on 2% of traffic burns the error budget 14× faster than budgeted for 5 minutes, page me. The alert math is burn, not threshold:

```text
SLO: 99.9% of requests with p99 < 200 ms over 30 days
alert when: budget burns at 14× for 5 min → page
logs: structured, keyed by traceId; metrics: RED per endpoint; traces: every span
```

**Q43. How does distributed tracing work end-to-end?**
"A trace ID is generated at the edge and propagated through every hop — header on HTTP, key on messages. Each service emits spans (name, start, duration, parent); a collector aggregates them by trace ID, and a search tool reconstructs the waterfall. Without it, a 2 s request is a wall of 'who knows' — with it, the slow span is one click:

```java
MDC.put("traceId", request.getHeader("X-Trace-Id"));
// every log line now carries the traceId, joinable to spans
response.setHeader("X-Trace-Id", traceId);   // user pastes it in a bug report
```

**Q44. The interviewer says 'now make it 100x bigger.' What breaks first?**
"The relational DB — connection pools exhaust and write throughput caps; 10k → 1M QPS cannot sit on one primary. So: shard by tenant/user key across **256 shards**, push reads to replicas, move analytics off the primary. The app tier scales horizontally — it's stateless. What _really_ breaks is coordination: cross-shard transactions, global queries, and hot shards (one tenant with 40% of traffic). Those force a data-model redesign — denormalize, pre-aggregate, accept per-shard eventual consistency:

```
10k QPS: Postgres primary + replicas + Redis
1M QPS:  256 shards (≈3.9k QPS each) + cache tier + pre-aggregated analytics
first break: the single primary; second: the join/global-query assumptions
```

**Q45. How do you choose a shard key, and what happens when it's wrong?**
"A bad key creates hot shards — one tenant hammers shard 7 while 254 idle. Rules: high cardinality, even distribution, and collocate rows you read together (shard orders by `customer_id` so one customer's data lives on one shard). With **256 shards** at 10k QPS, per-shard load is ~39 QPS — until a hot tenant does 5k QPS on its single shard. Mitigations: split the hot key (`tenant_1a/1b/1c`) or give the tenant dedicated shards:

```
shard = hash(customer_id) % 256        // even for normal tenants
hot tenant: 5k QPS → shard 7 saturated → split key: c_7_a, c_7_b, c_7_c
tradeoff: per-tenant queries now fan out to 3 shards
```

**Q46. Design a notification system that sends 1M messages/day.**
"Write path: services emit events to a queue; a dispatcher fans out per recipient and stores per-user state. Read path: the app checks an in-app inbox (DB) and pushes via WebSocket/APNs. 1M messages/day ≈ **11.6 msg/s** average, peaks ~100/s — trivial for Kafka. The interesting numbers are the providers: APNs/FCM throttle to ~2k–5k msg/s per connection, so rate-limit per provider and batch device tokens:

```
services ──> Kafka (burst 100k msg/min) ──> dispatcher ──> in-app inbox (DB)
                                        └──────> APNs/FCM (rate-limited, retried)
dedupe on messageId; store delivery status; dead-letter the undeliverable
```

**Q47. Design a chat system for 10M users with 1M concurrent.**
"Connection tier: WebSocket servers hold ~50k–100k connections each → ~10–20 nodes for 1M concurrent. Messages go to a broker (Redis pub/sub or Kafka) that fans out to the connection servers of each room's members; history lives in a sharded store keyed by `conversation_id`. 1M concurrent × 1 msg/10 s ≈ **100k msg/s** — the broker must partition by conversation so no single partition exceeds ~10k msg/s:

```
1M connections / 50k per node ≈ 20 nodes
user ──> conn node ──> broker (partitioned by conversation_id)
                    └──> all conn nodes holding room members
history: shard by conversation_id; unread counts: Redis + periodic flush
```

**Q48. Implement a saga — how do you keep money consistent across services?**
"Every step is a local transaction with a compensating action; a failure triggers rollbacks in reverse order. The compensation must be idempotent and durable — a failed saga retries via a recovery table, not by hoping. For money I'd never use 2PC across services; the saga's compensation log is the source of truth:

```java
try {
    orderService.create(order);        // step 1
    paymentService.charge(order);      // step 2
    inventoryService.reserve(order);   // step 3
} catch (ReservationFailed e) {
    paymentService.refund(order);      // compensate step 2 (idempotent)
    orderService.cancel(order);        // compensate step 1
}
// each compensation is recorded in the saga log before it runs → crash-safe retry
```

**Q49. How do you size Kafka partitions for 100k msg/s?**
"Throughput per partition is bounded by the slowest consumer in its group — a JSON-processing consumer does maybe 5–20k msg/s per instance. 100k msg/s with 10k msg/s per partition → ≥10 partitions, and I'd double it for headroom and rebalancing. Rule: partitions ≥ peak_rate / per-partition_throughput, and one partition per in-flight processing:

```text
needed = 100_000 msg/s ÷ 10_000 msg/s per partition = 10 partitions → run 20
replication: 3 replicas of each partition (2 brokers can fail, no data loss)
ordering: only within a partition — order by key = user_id, not globally
```

**Q50. Design a system you already run — what pages you at 2 a.m., and how do you defend it?**
"Defense is a numbered list of known failure modes, each with a detection and a response: (1) cache stampede on a viral key → single-flight + jitter, alerted by miss-rate; (2) DB connection pool exhaustion → bounded pool + read replicas, alerted by pool wait time; (3) region loss → failover in <5 min within the 99.95% budget, game-day tested; (4) a slow consumer filling the queue → backpressure + dead-letter, alerted by lag; (5) a bad deploy → canary + rollback in minutes. If I can't tell you which failure will page me, the design isn't done:

```
failure → detection (metric) → alert (burn) → response (runbook) → recovery
p99 > 200 ms for 5 min → page on-call → trace to the span → rollback/cache-fix
the number I defend: SLO 99.95%, error budget 26 min/year, burn-rate paging
```

#### Self-check

- [ ] Junior: I can draw the building blocks, explain L4 vs L7, horizontal vs vertical scaling, statelessness, cache-aside, CDN, replication, and sharding — each with the number that makes it matter.
- [ ] Mid: I can reason about cache invalidation and stampedes, size capacity from 10k QPS back-of-envelope, explain consistent hashing vs modulo, implement idempotency and rate limiting, and handle backpressure, retries, and replication lag.
- [ ] Senior: I can design a URL shortener end-to-end with a latency budget and stampede defense, diagnose a p99 regression from a trace, meet a 99.95% SLA with 3 replicas and failover, choose a shard key across 256 shards, and pick sagas over 2PC.
- [ ] Senior: I can state what breaks first at 100× scale, size Kafka partitions from RPS, and defend the five failure modes that page me at 2 a.m. with the metric that triggers each.
- [ ] Verification: I can answer any of the 50 questions with a diagram or code block and at least one concrete number — QPS, p99, hit rate, shard count, or SLA.
