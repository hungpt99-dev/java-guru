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

System design is the interview that has no right answer — only defensible trade-offs. Junior candidates name components; seniors walk a problem from vague requirements to a number-backed design and say where it breaks. This post climbs from "draw a diagram" to "here is the latency budget and the failure I'm watching".

> Mindset: junior produces a diagram; senior produces a diagram _and_ a latency budget, a capacity estimate, and the single failure mode most likely to page them at 2 a.m.

## Junior — foundations

**Q1. What are the main building blocks of a web system?**
A typical stack: client → load balancer → web/app servers → cache → database → async workers/queue. Each layer exists to add a capability: the LB spreads load, the cache absorbs reads, the queue decouples slow work. Knowing the role of each block is the floor.

**Q2. What is caching and the cache-aside pattern?**
A cache stores expensive results close to the reader. In **cache-aside**, the app checks the cache first; on a miss it reads the DB, populates the cache, and returns. It's simple and resilient (cache failure falls back to DB) but suffers a stampede on a hot-key miss. Variants: write-through (write to cache+DB together), write-back (write to cache, flush later).

**Q3. What is a load balancer and why use one?**
It distributes incoming traffic across multiple servers so no single node is overwhelmed and you can scale horizontally. It also provides health checks (stop sending to dead nodes) and a single endpoint for clients. Without it, one server is your ceiling and your SPOF.

**Q4. What is the difference between horizontal and vertical scaling?**
Vertical = make one machine bigger (more CPU/RAM) — simple but capped and a SPOF. Horizontal = add more machines behind a load balancer — no hard cap, resilient, but requires statelessness and shared storage. Most cloud systems scale horizontally.

**Q5. What is a CDN and when do you use it?**
A Content Delivery Network caches static assets (images, JS, video) at edge locations near users, cutting latency and origin load. Use it for anything static and read-heavy. It doesn't help dynamic, user-specific responses (though edge compute is blurring this).

**Q6. What does stateless mean, and why does it matter for scaling?**
A stateless service keeps no per-request memory on the server — every request carries what it needs (or pulls state from a shared store). That lets any node handle any request, so you can add nodes freely. Stateful services (sessions in memory) force sticky sessions and complicate scaling and failover.

## Mid — tradeoffs & pitfalls

**Q1. Explain CAP theorem in plain terms.**
You can't have all three of Consistency (every read sees the latest write), Availability (every request gets a response), and Partition tolerance (the system survives network splits) — and partitions are inevitable, so you really choose between **CP** (pause to stay consistent) and **AP** (stay up, risk stale reads). A payments ledger is CP; a social feed is AP. The interview trap is saying "we have all three".

**Q2. What is cache invalidation and why is it hard?**
The hard part of caching is keeping the cache correct when data changes. Strategies: **TTL** (auto-expire, simple, allows brief staleness), **write-invalidate** (delete cache entry on write, then repopulate on next read), or **write-update** (refresh on write). The race: a write and a read can interleave so the cache ends up with stale data. Most teams accept short TTL staleness rather than chase perfect invalidation.

**Q3. How do you size capacity — e.g. how many servers for 10k req/s?**
Back-of-envelope: if one server handles ~500 req/s at p99 < 200 ms (measured, not guessed), 10k req/s needs ~20 servers + headroom → ~25–30. Then check the bottleneck isn't the DB (each req might do 2–3 queries; a DB connection pool caps effective throughput). Capacity is about the _weakest_ layer, not the one you sized first.

**Q4. What is a message queue and what problem does it solve?**
A queue buffers work between a producer and a consumer that can't keep pace, and decouples them so a slow consumer or a crash doesn't block the producer. It also smooths spikes (the queue absorbs a burst; consumers drain at their rate). Without it, a traffic spike either drops requests or cascades failures.

**Q5. What is idempotency in APIs and how do you implement it?**
An idempotent endpoint produces the same result if called once or many times with the same input — essential because networks retry. Implement with a client-supplied **idempotency key**: store the result of the first call keyed by it, and return the stored result on retries instead of re-executing. `PUT` is naturally idempotent; `POST` is not, so it needs the key.

**Q6. What is the difference between SQL and NoSQL, and when pick each?**
SQL (relational) gives ACID, rich queries, and strong schema — best for transactional, relational data (money, orders). NoSQL (document, key-value, column, graph) trades some guarantees for horizontal scale and flexible schema — best for high-volume, loosely-structured, or specialized data (session store, time-series, graphs). Pick by the data's consistency and shape, not fashion.

## Senior — design & defense

**Q1. Design a URL shortener (e.g. 100M URLs, 1B redirects/day). Walk it.**
"Requirements first: redirects must be fast (<50 ms) and highly available; writes are rare vs reads (~100:1). Design: a hash/Base62 of a counter or hash of the long URL → short key. Store (short_key → long_url) in a DB; cache hot keys in Redis (most redirects hit a small hot set). Redirect service is stateless behind an LB, reads cache → DB on miss. Scale: shard the DB by key prefix; Redis cluster for cache. Capacity: 1B/86400 ≈ 11.5k redirects/s avg, with spikes — a few stateless app nodes + Redis handle it. The failure I watch: cache miss stampede on a suddenly-hot link → use a single-flight/lock per key on miss."

**Q2. A service's p99 latency tripled after a deploy. Find the cause with a budget.**
"I decompose the latency budget: LB → TLS → app → cache (1–2 ms) → DB (5–15 ms) → downstream call. I'd compare the new trace waterfall to baseline. Tripled p99 almost always means a new synchronous dependency or an N+1 query (each request now does 50 DB calls instead of 1). Fix: batch the calls, move the new dependency to async/off the critical path, or add a cache. I prove it by showing the per-span p99 before/after — the offending span is the one that grew, not 'the system is slow'."

**Q3. You must keep the system up during a full region outage. Design for it.**
"Active-passive or active-active across two regions. Data: replicate the DB (async cross-region) and use a CP store that tolerates the split; accept that during the partition, the secondary may serve slightly stale data (AP during partition, reconcile after). Traffic: DNS or global LB fails over to the healthy region; clients retry with backoff. The real risk is split-brain on writes — I'd make the inactive region read-only or use a consensus store for the few write paths that matter. I'd test the failover with a game day, not assume it works."

**Q4. How do you choose between a cache and a bigger database for read scale?**
"If reads are hot and repetitive (same 5% of data gets 95% of traffic), a cache offloads the DB dramatically and is cheaper than scaling the DB vertically. If reads are uniformly distributed and cold, a cache has low hit rate and you're better scaling the DB (read replicas) — caching cold data just adds a useless layer. I'd measure the working-set hit rate first; cache only pays off above ~80% hit rate on a hot set. Otherwise, read replicas + indexing is the simpler win."

**Q5. Design observability for a system you're handing to on-call. What's non-negotiable?**
"Three pillars: metrics (RED — rate, errors, duration — with SLOs and alerting on SLO burn), structured logs keyed by trace ID, and distributed tracing for request paths. Non-negotiable: every external call is timed and tagged, every error is countable, and alerts page on _symptoms_ (user-facing latency/error rate), not causes (CPU). A senior doesn't ship a system on-call can't debug at 2 a.m. — if you can't trace a slow request to a span, the design isn't done."

**Q6. The interviewer says 'now make it 100x bigger.' What breaks first?**
"I'd name the weakest link, not hand-wave. At 100x, the single relational DB is the first to break — connection pools exhaust, write throughput caps. So I'd shard it (by tenant/user key), push reads to replicas, and move any analytics off the primary. The stateless app tier scales horizontally, so that's fine. The cache cluster scales by adding shards. The thing that 'breaks' is coordination: cross-shard transactions, and global queries that no longer fit one node — those force a redesign of the data model (denormalize, pre-aggregate). The honest answer: the DB, then the data model's assumptions."

#### Self-check

- [ ] Junior: I can name the building blocks (LB, cache, queue, DB), explain cache-aside, horizontal vs vertical scaling, CDN, and statelessness.
- [ ] Mid: I can explain CAP, cache invalidation, capacity sizing from req/s, message queues, API idempotency, and SQL vs NoSQL trade-offs.
- [ ] Senior: I can design a URL shortener with a latency budget and stampede protection, diagnose a p99 regression from a trace, design for region failure, choose cache vs bigger DB by hit rate, define non-negotiable observability, and name the first component to break at 100x.
