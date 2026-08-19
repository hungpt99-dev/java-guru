---
title: "Java Interview Prep #7: System Design Fundamentals and Trade-offs"
description: "A practical system-design interview guide covering requirements, capacity, data, failure handling, scalability, and observability."
pubDatetime: 2026-08-10T10:25:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - system-design
  - scalability
---

System design is not a component-naming exercise. The hard part is turning incomplete requirements into explicit decisions about latency, consistency, capacity, failure handling, and operations. This guide moves from foundations to trade-offs and then to end-to-end designs.

**How to read the numbers.** Unless a value is a protocol property, every number below is an **illustrative assumption**. Replace it with measurements from the proposed workload, dependency, and region. Labels identify the kind of statement being made: **[SOURCE FACT]** describes a protocol or generally established behavior; **[ANALYSIS]** explains a trade-off; **[PROPOSED DESIGN]** is one defensible design, not a universal answer.

## Junior: Foundations

**Q1. What are the main building blocks of a web system?**
**[ANALYSIS]** A common request path uses DNS, a load balancer, stateless application servers, a cache, a database, and sometimes a queue with workers. A CDN serves cacheable static assets. Each block has a boundary: the database is the system of record, the cache is an optimization, and the queue decouples work that need not finish in the request:

```text
Client -> DNS -> Load Balancer -> App -> Cache
                         |          |       |
                         |          +-> Queue -> Workers
                         +-> CDN    +-> Database primary -> replicas
```

**Q2. What happens after entering a URL?**
**[SOURCE FACT]** The usual sequence is DNS lookup, TCP connection, TLS negotiation, HTTP request, application work, and response. **[ANALYSIS]** Treat each part as a measurable latency budget. A cached DNS lookup may add almost no network work; a remote round trip and TLS negotiation may dominate a small request budget. Do not claim that application code is the bottleneck before looking at a trace.

**Q3. L4 versus L7 load balancing?**
**[SOURCE FACT]** L4 routes using transport information such as TCP or UDP. It does not understand an HTTP URL. L7 parses HTTP and can route by path, apply HTTP-aware policy, and sometimes retry. **[ANALYSIS]** L7 adds processing and policy complexity; use it when that visibility is worth the cost.

```text
L4: Client -> TCP:443 -> LB -> healthy node
L7: Client -> LB -> /api/* -> API nodes
                 +-> /static/* -> CDN origin
```

**Q4. Horizontal versus vertical scaling?**
**[SOURCE FACT]** Vertical scaling means a larger machine. Horizontal scaling means more machines, usually behind a load balancer. **[ANALYSIS]** Vertical scaling is simpler but bounded and can leave a single failure domain. Horizontal scaling requires stateless application instances and shared or externalized state. **[ILLUSTRATIVE ASSUMPTION]** If one node serves 500 RPS and the target is 10,000 RPS, 20 nodes cover only the mean; a 25% headroom factor gives 25 nodes:

```text
nodes = target_rps / node_rps * (1 + headroom)
      = 10,000 / 500 * 1.25 = 25
```

**Q5. What does stateless mean?**
**[SOURCE FACT]** A stateless instance does not keep request-specific state that a later request must find on that same instance. **[ANALYSIS]** In-memory sessions create a routing dependency. Store session state in a shared store or use a client token instead:

```java
// Avoid instance-local session state.
session.put("cart", cart);

// External state lets any instance serve the request.
String cartId = redis.set(cartJson); // illustrative TTL: 24h
```

**Q6. What is cache-aside, and where does it fail?**
**[SOURCE FACT]** The application reads the cache, reads the database on a miss, then populates the cache. **[ANALYSIS]** This keeps the database authoritative and can fall back when the cache is unavailable, but it permits stale data and can create a stampede. **[ILLUSTRATIVE ASSUMPTION]** A 60-second TTL and 95% hit rate are workload assumptions, not properties of cache-aside:

```java
String value = redis.get(key);
if (value == null) {
    value = db.query(key);
    redis.set(key, value, 60); // illustrative TTL in seconds
}
return value;
```

**Q7. What is a CDN?**
**[SOURCE FACT]** A CDN caches content at edge locations, reducing origin requests and often reducing user latency. **[ANALYSIS]** It is a good fit for versioned static assets and other explicitly cacheable responses. User-specific dynamic responses need suitable cache keys and privacy controls; otherwise do not cache them.

**Q8. SQL versus NoSQL?**
**[SOURCE FACT]** SQL databases provide relational queries, schemas, and transactional guarantees such as ACID. NoSQL systems vary, but commonly optimize for a particular access pattern, scale-out model, or flexible representation. **[ANALYSIS]** Choose from data shape, query patterns, consistency, and operational constraints, not category preference. A hybrid such as Redis for cache, PostgreSQL for transactional truth, and a column store for analytics can be reasonable.

**Q9. What is an index?**
**[SOURCE FACT]** A B-tree index can avoid scanning every row for suitable predicates, at the cost of additional storage and write work. **[ANALYSIS]** The right answer is measured with `EXPLAIN` and representative data. **[ILLUSTRATIVE ASSUMPTION]** A 10-million-row scan taking seconds and an indexed lookup taking milliseconds are examples, not guarantees.

**Q10. What problem does a message queue solve?**
**[SOURCE FACT]** A queue buffers work between a producer and a consumer, allowing asynchronous processing and retries. **[ANALYSIS]** It absorbs bursts only for as long as retention and capacity allow; it does not remove overload. Monitor lag and define what happens to poison messages.

**Q11. Explain CAP.**
**[SOURCE FACT]** During a network partition, a distributed system cannot guarantee both availability and strong consistency for the same operation. **[ANALYSIS]** CP behavior rejects or pauses some operations to preserve consistency; AP behavior continues serving while permitting stale or conflicting observations. A ledger and a like counter have different correctness requirements. Avoid saying a system provides all three during a partition.

**Q12. Monolith or microservices?**
**[ANALYSIS]** A monolith usually has fewer network and deployment boundaries and makes local transactions simpler. Microservices can provide independent ownership, deployment, and scaling, but add network failure, distributed data, and operational overhead. **[PROPOSED DESIGN]** Start with a well-factored monolith unless a team boundary, isolation requirement, or independent scaling axis justifies a split. Any throughput comparison must be measured for the actual workload.

**Q13. What is HTTP idempotency?**
**[SOURCE FACT]** An idempotent operation has the same intended effect when repeated. `PUT` and `DELETE` are defined as idempotent at the HTTP semantic level; a business operation sent with `POST` often is not. **[PROPOSED DESIGN]** Give retryable creates a client-supplied idempotency key and persist the result under a unique constraint.

**Q14. Reverse proxy versus forward proxy?**
**[SOURCE FACT]** A forward proxy represents clients to external servers. A reverse proxy represents servers to clients. **[ANALYSIS]** A reverse proxy can terminate TLS, route traffic, enforce policy, and hide the application fleet:

```text
Forward: client -> proxy -> internet
Reverse: internet -> proxy/LB -> app instances
```

**Q15. WebSocket versus long polling?**
**[SOURCE FACT]** Long polling holds an HTTP request until an event or timeout and then repeats. WebSocket maintains a bidirectional connection. **[ANALYSIS]** Long polling is easier where WebSocket is unavailable; WebSocket is usually a better fit for frequent, low-latency server push. Size connections, heartbeats, and reconnect storms before choosing.

**Q16. What does replication provide?**
**[SOURCE FACT]** Replication copies data from a primary to replicas. It can provide read capacity and failover, depending on the database and topology. **[ANALYSIS]** Asynchronous replication introduces lag and stale reads. A design with three replicas is an illustrative topology, not a general availability guarantee.

**Q17. What is sharding?**
**[SOURCE FACT]** Sharding partitions data across nodes using a shard key. **[ANALYSIS]** It can increase write capacity but makes joins, transactions, backups, rebalancing, and global queries harder. Choose the key from access patterns and failure isolation; do not shard merely because the diagram looks more scalable.

## Mid: Trade-offs and Failure Modes

**Q18. TTL, write-through, or write-back?**
**[SOURCE FACT]** TTL expires entries. Write-through updates the cache as part of a write path. Write-back acknowledges the cache and persists later. **[ANALYSIS]** TTL accepts bounded staleness; write-through adds coordination and latency; write-back risks losing unflushed data. A read miss racing with a write can repopulate stale data, so invalidation ordering must be explicit.

**Q19. What is a cache stampede?**
**[SOURCE FACT]** Many requests can miss simultaneously when a hot entry expires. **[PROPOSED DESIGN]** Use TTL jitter, per-key single-flight, or refresh-before-expiry. Bound the wait and provide a fallback; otherwise one hot key can overload the database.

**Q20. How do you estimate capacity?**
**[ANALYSIS]** Start with the weakest layer and show the arithmetic. **[ILLUSTRATIVE ASSUMPTION]** At 10,000 QPS, if one measured app node sustains 500 RPS at the target p99, 25 nodes is a 25% headroom estimate. If each request performs two database queries and the cache hit rate is 95%, the database sees roughly 1,000 QPS. Validate every assumption with load tests and production telemetry.

**Q21. When is SQL the wrong answer?**
**[ANALYSIS]** SQL is a poor fit when the access pattern needs write scale or distribution that the chosen relational topology cannot provide. NoSQL is a poor fit when the domain needs joins and multi-row transactions that the selected store cannot express safely. **[ILLUSTRATIVE ASSUMPTION]** Clickstream at 100,000 writes/s versus a primary measured at 5,000 writes/s is a capacity mismatch, not a universal SQL limit.

**Q22. CP and AP in practice?**
**[SOURCE FACT]** Coordination stores commonly favor consistency during a partition; many eventually consistent stores favor availability. **[ANALYSIS]** Name the user-visible cost: a ledger may reject writes, while a like count may be temporarily stale. Do not infer guarantees from a product name alone; verify its consistency mode and configuration.

**Q23. Why not `hash(key) % N`?**
**[SOURCE FACT]** Modulo sharding remaps many keys when `N` changes. Consistent hashing limits movement to keys in the new node's range; virtual nodes smooth uneven ownership. **[ANALYSIS]** The exact fraction moved depends on the hash and migration strategy. **[ILLUSTRATIVE ASSUMPTION]** Moving from three to four nodes remaps roughly three quarters under simple modulo.

**Q24. Delivery semantics?**
**[SOURCE FACT]** At-least-once delivery can produce duplicates after an acknowledgement is lost. At-most-once can lose messages. **[ANALYSIS]** “Exactly once” usually means exactly-once effect: an at-least-once consumer deduplicates by message ID and makes side effects idempotent.

**Q25. How do you implement API idempotency?**
**[PROPOSED DESIGN]** Accept an `Idempotency-Key`, reserve it with a unique constraint, execute the operation, and store the response and status. A check followed by an unconstrained insert is racy:

```java
// The key must be unique in the database.
Order existing = orders.findByKey(key);
if (existing != null) return existing;
Order order = orderService.create(cart);
orders.insertWithKey(order, key); // concurrent insert cannot create a second order
```

**Q26. How do you size a connection pool?**
**[ANALYSIS]** Pool size follows concurrency and database capacity, not request rate alone. Use measured query time, target latency, transaction behavior, and database CPU. More connections can increase contention. The rough relation `in_flight = rate * service_time` is a starting estimate; benchmark the chosen pool.

**Q27. What is N+1?**
**[SOURCE FACT]** Loading children once per parent creates one query plus N child queries. **PROPOSED DESIGN** Batch by IDs or use a join, then inspect the query plan. The fix must preserve pagination and avoid creating an oversized `IN` list.

**Q28. When does an index hurt?**
**[SOURCE FACT]** Writes update affected indexes, and indexes consume storage and cache space. **ANALYSIS** Extra indexes can reduce write throughput, especially on write-heavy tables. Keep indexes that support real queries, verify them with `EXPLAIN`, and remove unused ones after observing workload impact.

**Q29. What breaks with read replicas?**
**[SOURCE FACT]** Asynchronous replicas can lag the primary. **PROPOSED DESIGN** Route read-after-write traffic to the primary, use a session consistency token, or tolerate stale reads explicitly:

```text
write -> primary -> async replica
own read -> primary; other eligible reads -> replica
```

**Q30. How should timeouts and retries work?**
**[PROPOSED DESIGN]** Set a deadline smaller than the caller's deadline, retry only safe or idempotent operations, use exponential backoff with jitter, and cap attempts with a retry budget. Retries without a budget turn a dependency incident into a retry storm.

```java
for (int attempt = 0; attempt < maxAttempts; attempt++) {
    try { return client.call(request); }
    catch (TimeoutException e) { backoffWithJitter(attempt); }
}
return fallbackOrError();
```

**Q31. How does a token bucket work?**
**[SOURCE FACT]** Tokens refill at a rate and each request consumes one. The bucket permits bounded bursts and limits the sustained rate. **[PROPOSED DESIGN]** Enforce a global limit at the edge and a tenant limit near the business operation. Make the state distributed if requests can reach multiple nodes.

**Q32. What is backpressure?**
**[SOURCE FACT]** Backpressure makes a producer slow down or reject work when consumers cannot keep up. **[PROPOSED DESIGN]** Use bounded queues, explicit rejection, blocking where appropriate, or documented dropping. **[ILLUSTRATIVE ASSUMPTION]** A producer at 10,000 messages/s and consumer at 2,000 messages/s accumulates 8,000 messages/s until capacity or retention is exhausted.

**Q33. Why is 2PC often a poor service boundary?**
**[SOURCE FACT]** Two-phase commit holds prepared resources while the coordinator and participants agree, increasing coupling and blocking risk. **[PROPOSED DESIGN]** Prefer local transactions plus a saga and compensating actions, or keep the data in one transactional boundary. Compensation must be durable and idempotent.

**Q34. What does eventual consistency mean to users?**
**[SOURCE FACT]** Replicas may return stale data temporarily and converge after writes stop propagating. **[ANALYSIS]** State the contract: read-your-writes, monotonic reads, or a documented convergence window. Eventual consistency is a user-visible behavior, not a synonym for “incorrect.”

## Senior: Design and Defense

**Q35. Design a URL shortener.**
**[PROPOSED DESIGN]** Clarify redirect latency, availability, retention, abuse controls, and the read/write ratio. Generate a collision-safe key, keep the app tier stateless, cache hot mappings, and shard the durable store only when measured growth requires it. **[ILLUSTRATIVE ASSUMPTION]** For 1 billion redirects/day, average traffic is about 11.6k RPS; a 30k RPS peak and 95% cache hit rate are workload assumptions. The primary failure mode is a hot-key miss, handled with single-flight and bounded fallback.

**Q36. p99 tripled after a deploy. What do you do?**
**[ANALYSIS]** Decompose the request budget by span, compare the new trace waterfall with baseline, and identify the span whose tail grew. Check new synchronous dependencies, query plans, and N+1 behavior. Fix the offending path, then verify per-span p99 rather than declaring that “the system is slow.”

**Q37. How do you implement consistent hashing?**
**[PROPOSED DESIGN]** Hash physical nodes and virtual nodes onto a ring. Route a key to the first clockwise position, and move only the affected ranges when adding a node. The implementation needs membership changes, collision handling, migration, and observability; the ring lookup alone is not a production design.

**Q38. How does single-flight prevent a stampede?**
**[PROPOSED DESIGN]** Keep one in-flight future per key. The first miss loads the database; concurrent misses await the same future. Remove it on completion, bound the wait, and do not cache failures as successful values. Combine this with TTL jitter.

**Q39. What does a 99.95% SLA require?**
**[SOURCE FACT]** 99.95% availability permits about 26 minutes of unavailability in a 365-day year. **[ANALYSIS]** The budget must be allocated across dependencies; multiplying component availability can produce a lower composite result. **[PROPOSED DESIGN]** Use redundancy, tested failover, and an error budget. “Three replicas” or “two nodes per zone” are illustrative design choices, not guarantees.

**Q40. Active-active versus active-passive?**
**[ANALYSIS]** Active-passive simplifies write ownership but has failover time and possible write loss. Active-active improves utilization and failover time but needs conflict resolution. **[PROPOSED DESIGN]** Start active-passive for a write-heavy path; if active-active is required, assign disjoint ownership or define a conflict model and reconcile it.

**Q41. How do you design a circuit breaker?**
**[PROPOSED DESIGN]** Track failures and latency in a window, open after a defined threshold, fail fast or use a safe fallback, then allow limited probes in half-open state. Thresholds and cooldowns are workload-specific assumptions. Also set timeouts and bulkheads; a breaker alone does not create capacity.

```text
CLOSED -> OPEN -> HALF_OPEN -> CLOSED
             \--------failure--------/
```

**Q42. What observability is non-negotiable?**
**[PROPOSED DESIGN]** Instrument external calls, errors, queue lag, saturation, and user-visible latency. Use RED metrics per endpoint, structured logs keyed by trace ID, traces across service hops, and alerts on symptoms. **[ILLUSTRATIVE ASSUMPTION]** An SLO of 99.9% under a 200 ms target and a 14x burn-rate alert are policy examples, not universal thresholds.

**Q43. How does distributed tracing work?**
**[SOURCE FACT]** A trace ID links spans across service and message boundaries. **[PROPOSED DESIGN]** Propagate it in HTTP headers and message metadata, record parentage and timing, and sample deliberately. Do not trust a client-provided trace ID without validation:

```java
String traceId = tracer.startOrContinue(request.header("traceparent"));
MDC.put("traceId", traceId);
```

**Q44. What breaks first at 100x scale?**
**[ANALYSIS]** Usually the first hard limit is a shared stateful dependency: primary write capacity, connection pools, coordination, or hot partitions. **[PROPOSED DESIGN]** Shard by a deliberate key, move analytics off the transaction path, pre-aggregate where valid, and redesign cross-shard queries. **[ILLUSTRATIVE ASSUMPTION]** Moving from 10k to 1M QPS and using 256 shards illustrates the arithmetic; it is not a sizing recommendation.

**Q45. How do you choose a shard key?**
**[ANALYSIS]** Prefer high cardinality, even distribution, and locality for data read together. Test for hot tenants and resharding. A key that is even globally can still produce a hot shard for one customer; mitigate with key splitting or dedicated capacity, accepting query fan-out.

**Q46. Design a notification system.**
**[PROPOSED DESIGN]** Emit events to a durable queue, fan out by recipient, store delivery state, and send through WebSocket or push providers with rate limits, retries, deduplication, and a dead-letter path. **[ILLUSTRATIVE ASSUMPTION]** 1 million messages/day is about 11.6 messages/s on average; peak rate and provider limits must be measured rather than assumed.

**Q47. Design chat for 1 million concurrent connections.**
**[PROPOSED DESIGN]** Use a connection tier for WebSockets, a broker partitioned by `conversation_id`, and a history store with the same access-oriented key. **[ILLUSTRATIVE ASSUMPTION]** At one message per 10 seconds per concurrent user, ingress is about 100k messages/s. Connection density, fan-out, broker limits, and reconnect behavior need load tests.

**Q48. How do you implement a money-moving saga?**
**[PROPOSED DESIGN]** Make each step a local transaction, record durable state before progressing, and make every compensation idempotent. Retry from a recovery table or log. If the business cannot tolerate temporary inconsistency, keep the operation inside one transactional boundary instead of hiding the problem behind a saga.

```text
create order -> charge payment -> reserve inventory
                                      failure -> refund -> cancel order
```

**Q49. How do you size Kafka partitions?**
**[ANALYSIS]** Measure producer rate, message size, consumer processing rate, replication, and recovery time. A first estimate is `partitions >= peak rate / sustainable rate per partition`, then add operational headroom. **[ILLUSTRATIVE ASSUMPTION]** 100k messages/s at 10k per partition implies at least 10 before headroom. Ordering is per partition, not global.

**Q50. How do you defend a design to on-call?**
**[PROPOSED DESIGN]** List the likely failure modes, detection signal, alert policy, runbook, and recovery test. Typical entries include cache stampede, pool exhaustion, region loss, consumer lag, and bad deploys. The answer is incomplete if it names components but cannot say what pages the team and what action is safe:

```text
failure -> metric -> alert -> runbook -> recovery test
```

#### Self-check

- [ ] Junior: I can explain the request path, scaling, state, cache, data stores, queues, replication, and sharding.
- [ ] Mid: I can reason about invalidation, stampedes, capacity, idempotency, pool limits, retries, backpressure, and lag.
- [ ] Senior: I can propose an end-to-end design, state assumptions, identify the first bottleneck, and defend failure handling with telemetry.
- [ ] Verification: For each answer, I can name the requirement, trade-off, and measurement that would validate the design.
