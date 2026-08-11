---
title: "Senior Java Interview: System Design"
description: "System design is the senior capstone — a 45-minute judgment test. Process, capacity estimation, caching, CAP, scalability, and observability."
pubDatetime: 2026-08-12T10:25:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - system-design
  - scalability
---

System design is where judgment is tested for 45–60 minutes. The process matters more than the answer.

## 1. The interview loop

1. **Clarify requirements & scope.** QPS? reads vs writes? latency budget? data size? consistency vs availability?
2. **Back-of-envelope capacity.** "10M users, 100 reads/user/day = 1B reads/day ≈ 11.5k QPS." Numbers stop hand-waving.
3. **High-level components.** Clients → CDN → API gateway → services → cache → DB → async workers/queues.
4. **Drill one or two areas deeply.**
5. **Address failure.** What breaks first? How do you degrade?

## 2. Cache strategy

- **Cache-aside (lazy):** app checks cache, misses DB, populates cache. Handle **cache stampede** with request coalescing / single-flight; handle **stale data** with TTL; handle **thundering herd on expiry** with jittered TTL.
- **Write-through / write-behind** when consistency with the store matters.
- **Cache invalidation** is the hard part — prefer TTL + explicit invalidation on write.

## 3. Consistency models

- **CAP:** under partition you choose CP or AP. Say it correctly — partitions are rare but unavoidable, so the real choice is what you sacrifice *during* a partition.
- **Eventual consistency:** fine for feeds/counts/search; dangerous for balances/inventory without guards.

## 4. Scalability patterns

- **Horizontal scaling + stateless services** (sessions in Redis, not local memory).
- **Sharding/partitioning** by tenant or hash.
- **Async processing** to flatten spikes (Kafka + workers).
- **Backpressure & queues** so a slow dependency degrades instead of collapsing.

## 5. Mini example: URL shortener

- 100M new URLs/day, 1B redirects/day, low latency.
- Key-value store; key = base62(encoded counter or hash); collisions → retry with salt.
- Cache hot URLs in Redis (most redirects hit a small set).
- 301 lets browsers cache (less load) but is harder to change; 302 is flexible.
- Capacity: 1B redirects × ~500 bytes ≈ 0.5 TB/day logs; plan retention/aggregation.

## 6. Observability is part of the design

Bake in tracing (request IDs across services), metrics (RED: rate/errors/duration), and structured logs from day one. "We'll add monitoring later" is a red flag.

## 7. Self-check

- [ ] Estimate capacity for a given QPS.
- [ ] Design a cache-aside flow with stampede protection.
- [ ] State CAP correctly under partition.
- [ ] Diagram a read-heavy service with cache, DB, queue.

That's the system-design bar.
