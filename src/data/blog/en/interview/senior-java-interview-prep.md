---
title: "Senior Java Interview Prep: Java, OOP, Microservices, Database, Kafka, System Design"
description: "A practical study guide for senior Java backend interviews — the concepts interviewers actually probe, the traps that fail strong candidates, and the code-level details that signal senior-level thinking."
pubDatetime: 2026-08-12T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - system-design
  - microservices
  - kafka
  - database
---

Senior Java interviews are not about memorizing syntax. They are about proving you can **make trade-offs under ambiguity** — the exact thing a senior is paid to do.

This guide walks through the six areas you named: Java core, OOP, microservices, databases, Kafka, and system design. For each, I give you the questions interviewers really ask, the answers that separate mid from senior, and the common traps.

> Mindset first: an interviewer who hears "it depends" followed by a clear trade-off analysis learns more about you in 30 seconds than from ten facts. Facts are easy to Google. Judgment is not.

## 1. Java Core — what "senior" really means

A junior knows the syntax. A senior knows **what the JVM is doing, why it behaves the way it does, and where it will surprise you in production.**

### 1.1 Memory model and GC

Expect: "Explain what happens when you `new` an object." A mid answer stops at "it goes on the heap." A senior continues:

- **Heap vs metaspace vs stack.** Short-lived objects go to the young generation (Eden). Most die there; survivors get copied to survivor spaces, then promoted to old gen. The metaspace holds class metadata (replaced the old perm gen). The stack holds frames and primitives/local references.
- **Stop-the-world.** Any GC pause freezes application threads. Throughput collectors (Parallel) optimize total work; low-latency collectors (G1, ZGC, Shenandoah) minimize pause time. For a latency-sensitive service, "we use G1" is a fine start, but be ready to talk about `MaxGCPauseMillis`, region sizing, and how ZGC gets sub-millisecond pauses via colored pointers / load barriers.
- **Common trap:** assuming GC means you don't need to manage memory. Unbounded caches, static collections, and thread-local leaks still OOM you. A senior mentions these.

```java
// A classic leak: a static cache that never evicts
private static final Map<String, Expensive> CACHE = new HashMap<>();

// Senior fix: bounded + time-based eviction
private static final Cache<String, Expensive> CACHE = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .build();
```

### 1.2 Concurrency — the real differentiator

This is where most candidates fail. Be fluent in:

- **`synchronized` vs `ReentrantLock`.** `synchronized` is simpler and JVM-optimized (biased locking was deprecated in JDK 17 — know that). `ReentrantLock` gives you `tryLock(timeout)`, multiple condition variables, and fairness choices.
- **`volatile`** — visibility, not atomicity. It does **not** make `i++` safe.
- **`Atomic*` / `LongAdder`** — `LongAdder` wins under high contention because it spreads updates across cells.
- **Thread pools.** Never `Executors.newFixedThreadPool` with an unbounded `LinkedBlockingQueue` for untrusted workloads — it can buffer infinitely and OOM. Size it deliberately, use a bounded queue + a `RejectedExecutionHandler`, and understand `corePoolSize` / `maxPoolSize` / `keepAliveTime` / `workQueue` interaction.
- **`CompletableFuture`** — non-blocking composition, `thenCompose` (flatMap) vs `thenCombine`, exception handling with `handle`/`exceptionally`. This is heavily tested.
- **Virtual threads (Project Loom, Java 21+).** A senior in 2026 should know them: millions of cheap virtual threads scheduled on a few carrier threads. They are **not** faster for CPU work, but they destroy thread-per-request bottlenecks for I/O-heavy services. Know the pinning pitfall (long `synchronized` blocks or native calls pin the carrier thread).

```java
// Blocking I/O on a virtual thread is fine and cheap:
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = urls.stream()
        .map(url -> executor.submit(() -> fetch(url)))
        .toList();
}
```

### 1.3 JVM internals interviewers love

- **Class loading:** bootstrap → platform → application, parent-delegation model, why it exists (security + avoiding duplicate core classes). Mention how you'd debug `ClassNotFoundException` vs `NoClassDefFoundError`.
- **JMM and happens-before:** final, volatile, lock acquisition, thread start/join all establish happens-before edges. This is the rigorous answer to "why is my flag change not visible?"
- **`String` and immutability,** `Integer` caching (`-128..127`), and why `==` on wrappers bites people.

### 1.4 Runtime & tooling

A senior says "when it's slow in prod, I don't guess — I measure": `jstack`, `jmap`, `jstat`, async-profiler, flight recorder. Name at least two you've actually used to find a real problem.

## 2. OOP — principles are the entry ticket, design is the test

### 2.1 SOLID without reciting definitions

Interviewers want to see SOLID applied, not defined. The two that get probed hardest:

- **Open/Closed:** add features via new types, not by editing working classes. Strategy / Plugin patterns.
- **Dependency Inversion:** depend on abstractions. This is *why* Spring exists — you inject `PaymentGateway`, not `StripeGateway`.

```java
// Violates DIP: concrete dependency baked in
class OrderService {
    private final StripeGateway gateway = new StripeGateway();
}

// Senior: depends on abstraction, injected
class OrderService {
    private final PaymentGateway gateway;
    OrderService(PaymentGateway gateway) { this.gateway = gateway; }
}
```

### 2.2 Composition over inheritance

Expect a "favor composition over inheritance" question. The senior answer: inheritance couples you to a parent's implementation and breaks encapsulation (the "fragile base class" problem). Delegate behavior instead.

### 2.3 Polymorphism & interfaces in the real world

Interface segregation matters at scale — a 40-method `UserService` interface that forces every implementer to stub 35 methods is a design smell. Split by role.

### 2.4 Common trap

Saying "OOP is outdated because of functional Java." A senior says: both. Streams for data transforms, OOP for modeling behavior-rich domain objects. Records (Java 16+) are great for immutable DTOs but a `Record` with business logic is a code smell — put behavior in services or rich domain types.

## 3. Microservices — you will be asked "when NOT to"

### 3.1 The distributed-monolith trap

The most senior answer to "design a microservice" is sometimes "don't, yet." Premature decomposition gives you **network calls instead of method calls**, distributed transactions, and 10× operational cost with none of the benefit. Know the triggers for splitting: independent deployability, different scaling profiles, different teams, different failure domains.

### 3.2 Service communication

- **Synchronous (REST/gRPC):** simplest, but every hop adds latency and a failure point. Use timeouts + retries with backoff + circuit breakers (Resilience4j). Never retry without idempotency.
- **Asynchronous (events/messages):** decouples producers/consumers, absorbs load spikes, enables replay. The cost is eventual consistency and harder debugging.

### 3.3 Resilience patterns (draw these)

- **Circuit breaker:** open after N failures, half-open to probe recovery. Prevents cascading failure.
- **Bulkhead:** isolate failures (separate thread pools / connection pools) so one slow dependency can't exhaust everything.
- **Retry + backoff + jitter:** naive `for (i<3) retry` during an outage is a **self-inflicted DDoS**. Add jitter.

```java
// Resilience4j: timeout + retry + circuit breaker composed
Supplier<String> decorated = Decorators.ofSupplier(() -> callDownstream())
    .withTimeout(Timeout.of(Duration.ofMillis(800)))
    .withRetry(Retry.ofDefaults("svc"))
    .withCircuitBreaker(CircuitBreaker.ofDefaults("svc"))
    .decorate();
```

### 3.4 Service discovery, config, gateway

Know the roles: discovery (Consul/Eureka/K8s DNS), centralized config (Spring Cloud Config / K8s ConfigMap), API gateway (routing, auth, rate limiting), and observability (traces via OpenTelemetry, metrics via Micrometer/Prometheus).

### 3.5 Distributed data & transactions

- **Saga pattern:** sequence of local transactions with compensating actions. Two styles: orchestration (a coordinator) vs choreography (events). Know the trade-off: orchestration is easier to reason about; choreography avoids a central bottleneck but is harder to trace.
- **Two-phase commit (2PC):** avoid it — it holds locks and doesn't survive coordinator failure. Mention it only to explain why you don't use it.

## 4. Database — the layer that actually decides scale

### 4.1 Indexing is non-negotiable

- **B-tree vs hash indexes**, and why range queries need B-tree.
- **Composite index column order** — most selective / equality-first, range-last. Explain why `WHERE a=? AND b>?` wants `(a,b)` not `(b,a)`.
- **Covering indexes** avoid a table lookup.
- **Trap:** a query that "uses an index" but still scans millions of rows (low cardinality, functions on the column, implicit type casts). Read `EXPLAIN`.

### 4.2 Transactions & isolation

Interviewers love "explain isolation levels." Be precise:

- **Read uncommitted / committed / repeatable read / serializable.**
- **Dirty / non-repeatable / phantom reads** — which levels prevent which.
- **Lost updates** and how to prevent: `SELECT ... FOR UPDATE`, optimistic locking with a version column, or `SERIALIZABLE`.
- **MVCC** — readers don't block writers (PostgreSQL/InnoDB). This is why "my read locked the table" is usually a misunderstanding.

```sql
-- Optimistic concurrency: bump version, fail if someone changed it
UPDATE accounts SET balance = balance - 100, version = version + 1
WHERE id = ? AND version = ?;
-- 0 rows updated => someone else moved first => retry or reject
```

### 4.3 Connection pooling

A senior knows the pool is a shared, scarce resource. HikariCP sizing: `connections ≈ ((core_count * 2) + effective_spindle_count)` is a starting heuristic, but the real answer is "measure under load." A too-large pool causes context-switch thrash; too small causes queueing.

### 4.4 SQL vs NoSQL — the actual decision

Don't say "NoSQL is faster." Say: pick the model that fits the access pattern. Document stores (MongoDB) for flexible schemas; wide-column (Cassandra) for write-heavy time-series at massive scale; relational (Postgres) when you need joins, transactions, and integrity. Know when to reach for Redis (cache / counters / pub-sub) vs a durable store.

### 4.5 N+1 and the ORM trap

- **N+1 queries** — lazy loading in a loop. Fix with `JOIN FETCH` / entity graphs / batch fetching.
- **Know what your ORM generates.** A senior reads the SQL. "It works" with 10 rows and dies with 10 million is a classic.

## 5. Kafka — event-driven systems

### 5.1 Core model

- **Topics, partitions, offsets, consumer groups.** Partitions are the unit of parallelism and ordering — ordering is guaranteed *within* a partition, not across.
- **A consumer group** splits partitions among members; adding consumers beyond partition count does nothing.

### 5.2 Delivery semantics — know all three

- **At most once:** may lose messages (offset commit before processing).
- **At least once:** may duplicate (processing before commit) — the realistic default; make consumers **idempotent** (dedupe by message key / offset).
- **Exactly once:** Kafka's EOS via idempotent producer + transactional API, or the much simpler "idempotent consumer + at-least-once."

```java
// Idempotent consumer: dedupe by a stable key, not by hoping for exactly-once
if (processedKeys.putIfAbsent(event.key(), event.offset()) != null) return;
```

### 5.3 Replication & durability

- **Replication factor (RF)** and **ISR** (in-sync replicas). `acks=all` + RF≥3 survives broker loss without data loss.
- **Why "acks=1" is dangerous** in production: the leader can ack then die before replicating.

### 5.4 Ordering & partitioning

If order matters (payments, audit), you must key by the entity id so all its events land on one partition. Trade-off: hot keys create hot partitions — sometimes you shard the key.

### 5.5 Real failure modes

- **Rebalance storms** when consumers churn. Understand cooperative rebalancing.
- **Consumer lag** — monitor it; it's the first signal of a slow consumer or a producer surge.
- **Poison messages** — a bad record that always fails; without a dead-letter queue (DLQ) it blocks the partition forever. A senior always builds a DLQ.

```java
// Always have a dead-letter path
try { process(record); } 
catch (PoisonException e) { sendToDlq(record, e); /* commit and move on */ }
```

## 6. System Design — the senior capstone

This is where judgment is tested for 45–60 minutes. Process matters more than the answer.

### 6.1 The interview loop

1. **Clarify requirements & scope.** QPS? reads vs writes? latency budget? data size? consistency vs availability?
2. **Back-of-envelope capacity.** "10M users, 100 reads/user/day = 1B reads/day ≈ 11.5k QPS." Numbers stop hand-waving.
3. **High-level components.** Clients → CDN → API gateway → services → cache → DB → async workers/queues.
4. **Drill one or two areas deeply** (the interviewer's interest).
5. **Address failure.** What breaks first? How do you degrade?

### 6.2 Cache strategy

- **Cache-aside (lazy):** app checks cache, misses DB, populates cache. Most common. Handle **cache stampede** (many requests miss at once) with request coalescing / single-flight; handle **stale data** with TTL; handle **thundering herd on expiry** with jittered TTL.
- **Write-through / write-behind** when consistency with the store matters.
- **Cache invalidation** is the hard part — prefer TTL + explicit invalidation on write.

### 6.3 Consistency models

- **CAP:** under partition, you choose CP (consistency) or AP (availability). Say it correctly — partitions are rare but unavoidable, so the real choice is "what do we sacrifice *during* a partition."
- **Eventual consistency:** acceptable for feeds, counts, search; dangerous for balances, inventory if not guarded.

### 6.4 Scalability patterns

- **Horizontal scaling + stateless services** (sessions in Redis, not local memory).
- **Sharding/partitioning** the database by tenant or hash.
- **Async processing** to flatten spikes (Kafka + workers).
- **Backpressure & queues** so a slow dependency degrades instead of collapsing.

### 6.5 A mini example: design a URL shortener

- Requirements: 100M new URLs/day, 1B redirects/day, low latency.
- Key-value store, key = base62(encoded counter or hash). Hash collisions → retry with salt.
- Cache hot URLs in Redis (most redirects hit a small set).
- Redirect is a 301/302 — 301 lets browsers cache (less load) but harder to change.
- Capacity: 1B redirects × ~500 bytes logs ≈ 0.5 TB/day; plan retention/aggregation.

### 6.6 Observability is part of the design

A senior bakes in tracing (request IDs across services), metrics (RED: rate/errors/duration), and structured logs from day one. "We'll add monitoring later" is a red flag.

## 7. How to present yourself as senior

- **Narrate trade-offs.** "I'd use at-least-once + idempotent consumer because exactly-once is heavier and rarely needed."
- **Admit uncertainty honestly.** "I'd measure before committing to RF=5; 3 is usually enough."
- **Connect to real experience.** "In prod we saw rebalance storms when…" beats textbook recitation.
- **Push back respectfully.** If a design is premature microservices, say so and explain the cost.

## 8. Quick self-check

Before the interview, make sure you can whiteboard:

- [ ] A thread-safe counter under high contention (and why `AtomicLong` can bottleneck).
- [ ] A retry-with-backoff-and-jitter helper.
- [ ] An SQL query + index to fix an N+1 or a slow report.
- [ ] A Kafka consumer that's idempotent and has a DLQ.
- [ ] A system diagram for a read-heavy service with cache, DB, and a queue.
- [ ] The difference between `synchronized`, `volatile`, and `AtomicReference` in one sentence each.

If those feel easy, you're ready. If not, those are exactly the gaps to close first.

Good luck — and remember: senior means you can say "it depends" and then *justify it*.
