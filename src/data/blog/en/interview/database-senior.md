---
title: "Java Interview Prep #4: Database & SQL — Junior to Senior"
description: "The database layer decides real-world scale. Senior candidates must speak fluently about indexing, transaction isolation, connection pooling, and the ORM trap — with real SQL, not just prose."
pubDatetime: 2026-08-10T10:15:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - database
  - sql
---

The database is where "it works on my machine" dies. Junior developers write `SELECT *` and wonder why prod is slow; seniors can show the exact `EXPLAIN` proving why a query does a sequential scan and which index fixes it. This post climbs from joins to isolation anomalies to pool exhaustion — with SQL you can actually run.

> Mindset: junior writes a query that returns the right rows; senior writes one that returns the right rows _and_ won't take the site down at 10x traffic — and can prove it with `EXPLAIN ANALYZE`.

## Junior — foundations

**Q1. What is a primary key, foreign key, and index?**
A primary key uniquely identifies a row (enforced unique + not null). A foreign key references a PK in another table, enforcing referential integrity. An index is a B-tree that speeds lookups at the cost of write overhead. Without an index, `WHERE` does a sequential scan — on a 10M-row table that's ~10M row reads (~hundreds of ms to seconds); with an index it's ~4 B-tree levels (~4 random reads, ~0.5 ms).

**Q2. What is the difference between `INNER JOIN` and `LEFT JOIN`?**
`INNER JOIN` returns only matched rows; `LEFT JOIN` returns all left rows with matched right columns or NULLs. A classic bug — using `INNER` when you need orphans drops data silently:

```sql
-- WRONG: drops users with no orders
SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = u.id;

-- RIGHT: keeps every user, shows NULL when they have no orders
SELECT u.name, o.id FROM users u LEFT JOIN orders o ON o.user_id = u.id;
```

**Q3. What is the difference between `WHERE` and `HAVING`?**
`WHERE` filters rows before grouping; `HAVING` filters groups after `GROUP BY`. You cannot use an aggregate in `WHERE` — it's a syntax error:

```sql
-- WRONG
SELECT user_id, COUNT(*) FROM orders WHERE COUNT(*) > 1 GROUP BY user_id;
-- RIGHT
SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1;
```

**Q4. What is a transaction and ACID?**
A transaction groups operations into an all-or-nothing unit. ACID: **A**tomicity (all or nothing), **C**onsistency (valid state), **I**solation (concurrent txns don't interfere), **D**urability (committed data survives crashes). A transfer: debit A and credit B must both commit or both roll back — never leave money vanished.

**Q5. What is the difference between `COUNT(*)`, `COUNT(col)`, `COUNT(DISTINCT col)`?**
`COUNT(*)` counts rows (incl. NULLs); `COUNT(col)` counts non-NULL values; `COUNT(DISTINCT col)` counts unique non-NULL. On a 1M-row table, mixing them silently changes your number — a common reporting bug.

**Q6. Why not store money as `FLOAT`?**
Binary floats can't represent decimals exactly (0.1 + 0.2 ≠ 0.3), causing rounding drift that makes ledgers not reconcile. Use `DECIMAL(19,4)` or store integer minor units (cents):

```sql
-- WRONG: never
amount FLOAT;
-- RIGHT
amount DECIMAL(19,4);   -- 19 digits, 4 after the decimal
-- or in app code: store BIGINT cents, format only at the edge
```

## Mid — tradeoffs & pitfalls

**Q1. How does a B-tree index work, and when is it useless?**
A B-tree keeps rows sorted by the indexed column, so equality/range scans are O(log n) instead of O(n). For 1B rows a B-tree is ~4 levels deep — ~4 random reads (~0.5 ms each) to find a row, vs a full scan of 1B rows (~tens of seconds). It's useless when the predicate wraps the column in a function (can't use the index) or is so unselective it returns >~20–30% of rows (planner prefers a scan):

```sql
-- WRONG: function on column -> index on created_at NOT used
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- RIGHT: range that the index serves
SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

**Q2. What is a composite index and the leftmost-prefix rule?**
`(a, b, c)` is sorted by a, then b, then c. It serves queries filtering on `a`, `(a,b)`, or `(a,b,c)` — but NOT `b` or `c` alone. Order by selectivity. Wrong column order = a dead index:

```sql
-- index: (customer_id, created_at)
SELECT * FROM orders
 WHERE customer_id = 42 ORDER BY created_at DESC;   -- uses index ✓
SELECT * FROM orders WHERE created_at > '2024-01-01'; -- ignores index ✗ (no leftmost a)
```

**Q3. Explain isolation levels and their anomalies.**

- **Read committed**: no dirty reads; non-repeatable reads possible (same row differs mid-txn).
- **Repeatable read**: consistent within a txn; phantoms possible.
- **Serializable**: fully isolated, like running serially — safest, slowest (can be 5–10× slower than read committed under contention).
  Most engines default to read committed (Postgres repeatable read). Higher isolation = fewer anomalies = more locking.

**Q4. What is a deadlock and how do you avoid it?**
Two transactions each hold a lock the other needs. The DB detects and rolls one back (raise `40P01` in Postgres). Avoid by accessing resources in a **consistent global order** and keeping txns short:

```sql
-- Both services update accounts; ALWAYS update in id order to avoid cross-deadlock
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- lower id first
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- then higher
COMMIT;
```

**Q5. What is the N+1 problem and how do you fix it?**
Your ORM loads N parents, then issues N separate child queries. At N=1000 that's 1001 round-trips (~each 1–5 ms → ~1–5 s added). Fix with a join or batch fetch:

```sql
-- WRONG (N+1): 1 query for orders, then 1 per order for its items
SELECT * FROM orders WHERE user_id = 42;
SELECT * FROM order_items WHERE order_id = ?;   -- repeated 1000x

-- RIGHT: 1 query, all items
SELECT o.id, i.sku, i.qty
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.user_id = 42;
```

**Q6. What is connection pooling and why exhaust it?**
Opening a DB connection costs ~5–20 ms. A pool reuses them. You exhaust it by leaking connections (no try-with-resources) or holding one inside a slow call, so `HikariPool` throws `ConnectionTimeoutException` after `connectionTimeout` (default 30 s). Rule of thumb: `pool_size ≈ concurrency × (avg_query_ms / target_latency_ms)`.

## Senior — design & defense

**Q1. A report query on a 500M-row table times out. Walk the diagnosis and fix.**
"I'd `EXPLAIN ANALYZE` — usually a sequential scan because the predicate wraps a column in a function or the index isn't leftmost-matching. If it's an aggregation, a materialized view refreshed every 5–15 min turns a 30 s scan into a 50 ms read. If it must be live, a **covering index** lets the planner do an index-only scan (no heap fetch). Proof before/after:"

```sql
-- Before: Seq Scan on orders  (cost=0.00..8_500_000 rows=120_000_000)
-- After adding (status, created_at) INCLUDE (total):
--   Index Only Scan using ix_orders_status_created ... (cost=0.00..1_200)
```

"I confirm p95 drops from ~30 s to <100 ms."

**Q2. Design a schema for 1M orders/day. Indexing strategy?**
"Partition by month (range partitions) so old data archives and recent queries scan less. Index `(customer_id, created_at)` for 'my orders, newest first' (leftmost + sort). I'd avoid indexing every column — each index adds ~10–20% write amplification, and at 1M/day that matters. Push hot analytics to a read replica."

```sql
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  total DECIMAL(19,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (created_at);

CREATE INDEX ix_orders_cust_created ON orders (customer_id, created_at DESC);
```

**Q3. Choose isolation for a payment service, defended by failure mode.**
"For the transfer path I use `REPEATABLE READ`/`SERIALIZABLE` — a non-repeatable read could double-debit. Cost: more locks and possible serialization failures (Postgres `serialization_failure`, SQLSTATE 40001) under contention, so I keep those txns tiny (just the balance math) and retry on 40001. For read-heavy reporting I drop to `READ COMMITTED` on a replica. The anomaly you can't tolerate dictates the level — you pay for isolation only where the money is."

**Q4. You see lock waits under moderate load. Find the cause.**
"I'd query `pg_locks` joined to `pg_stat_activity` for the blocking PID and its statement. Nine times out of ten a long txn holds a row lock while doing a slow external call — the lock lives for seconds instead of ms. Fix: shrink the txn to minimal writes, move the slow work outside it, set `lock_timeout = 2s` so a blocked txn fails fast instead of cascading. I measure lock-wait time before/after."

**Q5. ORM or raw SQL — when do you drop JPA?**
"When the query is complex (deep joins, window functions, bulk updates) or hot, JPA's generated SQL is opaque and often does N+1. I use `JdbcTemplate`/jOOQ with exactly the columns I need"

```java
// WRONG: loads the whole entity graph, then a field
Order o = repo.findById(42L).get();  // + lazy collections = N+1
// RIGHT: one projection, one query
String sql = "SELECT status, total FROM orders WHERE id = ?";
return jdbcTemplate.queryForObject(sql, (rs,r) -> new OrderView(rs.getString(1), rs.getBigDecimal(2)), id);
```

**Q6. Defend a connection-pool size with Little's Law.**
"`pool ≈ target_concurrency × (avg_query_ms / acceptable_latency_ms)`. At 5 ms avg and 200 concurrent, that's ~200 × (0.005 / 0.1) ≈ 10, padded for variance to ~20–30 — not 200. Oversizing wastes DB connections (each holds a backend process + ~5–10 MB) and can _worsen_ throughput via lock contention. I set `maximumPoolSize` from real numbers, monitor wait time, and tune."

#### Self-check

- [ ] Junior: I can explain PK/FK/index, INNER vs LEFT join, WHERE vs HAVING, ACID, and why not FLOAT for money — with SQL.
- [ ] Mid: I can explain B-tree indexing + function-wrap pitfall, composite leftmost-prefix, isolation levels, deadlock avoidance, N+1, and pool exhaustion.
- [ ] Senior: I can diagnose a slow report with EXPLAIN ANALYZE + covering index, design partitioning/indexing for 1M/day, pick isolation by failure mode, find lock waits, drop JPA for hand-written SQL, and size a pool from Little's Law.
