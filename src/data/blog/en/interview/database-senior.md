---
title: "Java Interview Prep #4: Database & SQL — Junior to Senior"
description: "The database layer decides real-world scale. Senior candidates must speak fluently about indexing, transaction isolation, connection pooling, and the ORM trap."
pubDatetime: 2026-08-10T10:15:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - database
  - sql
---

The database is where "it works on my machine" dies. Junior developers write `SELECT *` and wonder why prod is slow; seniors can explain why a query does a sequential scan and what index would fix it. This post climbs from joins to isolation anomalies to pool exhaustion.

> Mindset: junior writes a query that returns the right rows; senior writes one that returns the right rows _and_ won't take the site down at 10x traffic.

## Junior — foundations

**Q1. What is a primary key, foreign key, and index?**
A primary key uniquely identifies a row (enforced unique + not null). A foreign key references a PK in another table, enforcing referential integrity. An index is a data structure (usually B-tree) that speeds lookups on a column at the cost of write overhead and storage. Without an index, a `WHERE` scans the whole table.

**Q2. What is the difference between `INNER JOIN` and `LEFT JOIN`?**
`INNER JOIN` returns only rows with matches in both tables. `LEFT JOIN` returns all rows from the left table, with matched right-table columns or NULLs when there's no match. A classic bug: using `INNER` when you need orphaned rows, silently dropping data.

**Q3. What is the difference between `WHERE` and `HAVING`?**
`WHERE` filters rows _before_ grouping; `HAVING` filters groups _after_ `GROUP BY`. You cannot use an aggregate in `WHERE` (`WHERE COUNT(*) > 1` is invalid); use `HAVING`.

**Q4. What is a transaction and ACID?**
A transaction groups operations into an all-or-nothing unit. ACID: **A**tomicity (all or nothing), **C**onsistency (valid state transitions), **I**solation (concurrent txns don't interfere), **D**urability (committed data survives crashes). A bank transfer is the textbook example: debit and credit must both happen or neither.

**Q5. What is the difference between `COUNT(*)`, `COUNT(col)`, and `COUNT(DISTINCT col)`?**
`COUNT(*)` counts rows (including NULLs). `COUNT(col)` counts non-NULL values in that column. `COUNT(DISTINCT col)` counts unique non-NULL values. Mixing them up changes your numbers silently.

**Q6. What are the main column types for storing money and why not `FLOAT`?**
Never store money as `FLOAT`/`DOUBLE` — binary floating point can't represent decimals exactly (0.1 + 0.2 ≠ 0.3), causing rounding drift. Use `DECIMAL(p, s)` / `NUMERIC` (exact, fixed scale) or store integer minor units (cents). The "use integer cents" approach avoids decimal math entirely in code.

## Mid — tradeoffs & pitfalls

**Q1. How does a B-tree index work, and when is it useless?**
A B-tree index keeps rows sorted by the indexed column, so equality and range scans are O(log n) instead of O(n). For 1B rows a B-tree is ~4 levels deep — ~4 random reads to find a row. It becomes useless when: the predicate uses a function on the column (`WHERE YEAR(created) = 2024` can't use the `created` index — use a functional/indexed expression or range), or when the filter is so unselective (returns >~20–30% of rows) the planner prefers a full scan anyway.

**Q2. What is a composite index and the leftmost-prefix rule?**
A composite (multi-column) index like `(a, b, c)` is sorted by a, then b, then c. It can serve queries that filter on `a`, `(a, b)`, or `(a, b, c)` — the **leftmost prefix** — but NOT a query that filters only on `b` or `c`. Order the columns by selectivity and by which predicates you actually use. A wrong column order is a dead index.

**Q3. Explain the transaction isolation levels and their anomalies.**

- **Read uncommitted**: sees dirty (uncommitted) reads. Rarely used.
- **Read committed**: no dirty reads, but non-repeatable reads (same row differs between reads in one txn).
- **Repeatable read**: same row reads consistently within a txn; may still get phantom reads (new rows appear).
- **Serializable**: full isolation, like running serially — safest, slowest.
  Most engines default to read committed (Postgres repeatable read). Higher isolation = fewer anomalies = more locking/overhead.

**Q4. What is a deadlock and how do you avoid it?**
A deadlock is two transactions each holding a lock the other needs. Databases detect and roll back one. Avoid by **accessing resources in a consistent global order** (always update accounts in ID order), keeping transactions short, and not holding locks across network calls. Always be ready to retry a rolled-back txn.

**Q5. What is an N+1 query problem and how do you fix it?**
Your ORM loads a list of N parents, then issues N separate queries for their children ("N+1"). Fix: eager fetch / `JOIN FETCH` / batch fetch (`@BatchSize`) so it's 1 or few queries. N+1 is the #1 silent performance killer in JPA/Hibernate apps — it looks fine in tests (small data) and melts in prod.

**Q6. What is connection pooling and why would you exhaust it?**
A pool reuses DB connections (opening one is expensive, ~ms to tens of ms). You exhaust it by: (1) leaking connections (forgot to close / not using try-with-resources), (2) holding a connection inside a long transaction or external call, (3) too-low `maxPoolSize` for your concurrency. Symptom: `Timeout: could not get a connection`. Tune `maximumPoolSize` to (core_concurrency × avg_query_time / target_latency) and never do slow work on a pooled connection.

## Senior — design & defense

**Q1. A report query on a 500M-row table times out. Walk the diagnosis and fix.**
"I'd `EXPLAIN ANALYZE` it — usually it's a sequential scan because the predicate wraps the column in a function, or the index isn't leftmost-matching. If it's an aggregation report, I'd ask whether it needs to be real-time: often a materialized view refreshed every 5–15 min is the right answer, turning a 30 s scan into a 50 ms read. If it must be live, I add a covering composite index so the planner does an index-only scan. I prove the fix with `EXPLAIN ANALYZE` before/after and confirm p95."

**Q2. Design a schema for an orders table at 1M orders/day. Indexing strategy?**
"I'd partition by time (e.g. monthly range partitions) so old partitions can be archived and recent queries scan less. Index `(customer_id, created_at)` for the common 'my orders, newest first' query (leftmost prefix + sort), and a separate index on `status` only if it's selective. I'd avoid indexing every column — each index slows writes, and at 1M/day write amplification matters. I'd also move hot analytics to a read replica / columnar store rather than hammer the primary."

**Q3. How do you choose isolation level for a payment service, and defend it with a failure mode?**
"For payments I'd use `REPEATABLE READ` or `SERIALIZABLE` on the critical transfer path — a non-repeatable read there could double-debit. Cost: more locks, possible serialization failures under contention, so I keep those transactions tiny (just the balance math, no external calls) and retry on serialization failure. For read-heavy reporting I'd drop to `READ COMMITTED` on a replica. The defense is: the anomaly you can't tolerate dictates the level; you pay for isolation only where the money is."

**Q4. You're seeing lock waits and timeouts under moderate load. Find the cause.**
"I'd look at `pg_locks` / `SHOW ENGINE INNODB STATUS` for the blocking session and the statement it holds. Nine times out of ten it's a long transaction holding a row lock while it does something slow (a call, a log, a sleep) — the lock is held for seconds instead of milliseconds. Fix: shrink the transaction to the minimal writes, move the slow work outside it, and add a lock timeout so a blocked txn fails fast instead of cascading. I measure lock-wait time before/after."

**Q5. ORM or raw SQL — when do you drop JPA for hand-written SQL?**
"When the query is complex (deep joins, window functions, bulk updates) or performance-critical, JPA's generated SQL is opaque and often does N+1 or fetches too much. I'd use a thin JDBC/`JdbcTemplate` or jOOQ query with exactly the columns I need, mapped to a DTO. Rule: JPA for CRUD on simple entities; hand-written SQL (or jOOQ) for reports, bulk ops, and hot paths. I never let the ORM hide a full-table fetch in production."

**Q6. How do you defend a connection-pool sizing number to your team?**
"I size it from Little's Law: `pool_size ≈ target_concurrency × (avg_query_time / acceptable_latency)`. If queries average 5 ms and I need 200 concurrent, that's ~200 × (0.005 / 0.1) ≈ 10, but I pad for variance and failover, landing ~20–30, not 200. Oversizing wastes DB connections (each holds memory + a backend process) and can _worsen_ throughput by increasing lock contention. I set `maximumPoolSize` deliberately, monitor wait time, and tune from real numbers — not `200` because 'more is better'."

#### Self-check

- [ ] Junior: I can explain PK/FK/index, INNER vs LEFT join, WHERE vs HAVING, ACID, and why not FLOAT for money.
- [ ] Mid: I can explain B-tree indexing, composite leftmost-prefix, isolation levels, deadlocks, N+1, and pool exhaustion.
- [ ] Senior: I can diagnose a slow report query with EXPLAIN ANALYZE, design partitioning + indexing for 1M/day, pick isolation by failure mode, and size a connection pool from Little's Law with real numbers.
