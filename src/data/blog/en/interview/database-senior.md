---
title: "Java Interview Prep #4: Database & SQL — Junior to Senior"
description: "The database layer determines real-world scalability. Senior candidates must speak fluently about indexing, transaction isolation, connection pooling, and the ORM trap, using real SQL rather than just prose."
pubDatetime: 2026-08-10T10:15:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - database
  - sql
---

The database is where "it works on my machine" dies. Junior developers write `SELECT *` and wonder why production is slow; seniors can show the exact `EXPLAIN` output proving why a query performs a sequential scan and which index will fix it. This post moves from joins to isolation anomalies and pool exhaustion. It contains 50 questions: start at the level you are interviewing for, then read one level above it, with SQL and JDBC examples you can actually run.

> Mindset: a junior writes a query that returns the right rows; a senior writes one that returns the right rows _and_ will not take the site down at 10x traffic, then proves it with `EXPLAIN ANALYZE`.

## Junior — foundations

**Q1. What is a primary key, foreign key, and index?**
A primary key uniquely identifies a row (enforced as unique and not null). A foreign key references a primary key in another table and enforces referential integrity. An index is usually a B-tree that speeds up lookups at the cost of write overhead. Without an index, `WHERE` performs a sequential scan — on a 10M-row table, that means roughly 10M row reads (hundreds of milliseconds to seconds); with an index, it means roughly four B-tree levels (about four random reads, or ~0.5 ms). Note that a foreign key does _not_ create an index on the child column in most engines. Without an FK index, every parent deletion requires a scan of the child table:

```sql
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),  -- FK: integrity
  total DECIMAL(19,4) NOT NULL
);

-- every INSERT/DELETE now maintains two structures; each index adds
-- roughly 10–20% write overhead, so index only what queries actually filter on
CREATE INDEX ix_orders_customer ON orders (customer_id);
```

**Q2. What is the difference between `INNER JOIN` and `LEFT JOIN`?**
`INNER JOIN` returns only matched rows; `LEFT JOIN` returns all rows from the left table, with matching columns from the right table or NULLs. A classic bug is using `INNER JOIN` when you need orphaned rows, which silently drops data:

```sql
-- WRONG: drops users with no orders
SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = u.id;

-- RIGHT: keeps every user, shows NULL when they have no orders
SELECT u.name, o.id FROM users u LEFT JOIN orders o ON o.user_id = u.id;

-- and if a user appears 3×, that is 3 orders — the join is not broken,
-- you asked for row-per-order. Use DISTINCT or aggregation deliberately.
```

**Q3. What is the difference between `WHERE` and `HAVING`?**
`WHERE` filters rows before grouping; `HAVING` filters groups after `GROUP BY`. You cannot use an aggregate in `WHERE`; that is a syntax error. The order also matters for performance: `WHERE` runs before aggregation, so it can use an index and shrink the input from 10M rows to 10k before grouping. `HAVING` can see only the already-aggregated result:

```sql
-- WRONG
SELECT user_id, COUNT(*) FROM orders WHERE COUNT(*) > 1 GROUP BY user_id;
-- RIGHT
SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1;
```

**Q4. What is a transaction and ACID?**
A transaction groups operations into an all-or-nothing unit. ACID stands for **A**tomicity (all or nothing), **C**onsistency (a valid state), **I**solation (concurrent transactions do not interfere), and **D**urability (committed data survives crashes). In a transfer, debiting A and crediting B must either both commit or both roll back; money must never disappear. Durability is not free: each commit forces a WAL flush, typically ~1–10 ms, which is why batching matters (Q29):

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;      -- or ROLLBACK; if the second UPDATE fails
```

**Q5. What is the difference between `COUNT(*)`, `COUNT(col)`, `COUNT(DISTINCT col)`?**
`COUNT(*)` counts rows, including NULLs; `COUNT(col)` counts non-NULL values; `COUNT(DISTINCT col)` counts unique non-NULL values. On a 1M-row table, confusing them silently changes the result, a common reporting bug. And `COUNT(*)` is not free: without an index-only scan, it reads every row in the table (taking ~seconds on 10M rows), which is why dashboards pre-aggregate:

```sql
SELECT COUNT(*) FROM orders;                 -- all rows, NULLs included
SELECT COUNT(shipped_at) FROM orders;        -- only non-NULL shipped dates
SELECT COUNT(DISTINCT customer_id) FROM orders;  -- unique customers
```

**Q6. Why not store money as `FLOAT`?**
Binary floating-point values cannot represent decimal fractions exactly (0.1 + 0.2 ≠ 0.3), causing rounding drift that prevents ledgers from reconciling. Use `DECIMAL(19,4)` or store integer minor units (cents). Once the database is safe, the Java side must be safe too: never map money to `double`:

```sql
-- WRONG: never
amount FLOAT;
-- RIGHT
amount DECIMAL(19,4);   -- 19 digits, 4 after the decimal
-- or in app code: store BIGINT cents, format only at the edge
```

```java
// WRONG: the same float bug smuggled through JDBC
double total = rs.getDouble("amount");
// RIGHT: BigDecimal end to end, with an explicit rounding mode
BigDecimal total = rs.getBigDecimal("amount").setScale(2, RoundingMode.HALF_EVEN);
```

**Q7. What is the difference between `UNIQUE` and `PRIMARY KEY`?**
A primary key is `UNIQUE NOT NULL` plus the table's identity anchor; a table has exactly one primary key but can have many `UNIQUE` constraints. The trap is NULL semantics: in Postgres, `UNIQUE` treats NULLs as distinct, so two rows with `NULL` in a unique column are legal. This surprises people trying to enforce "one email per user":

```sql
-- WRONG: this allows an unlimited number of NULL email rows
CREATE TABLE users (email TEXT UNIQUE);
INSERT INTO users VALUES (NULL), (NULL);   -- succeeds in Postgres!

-- RIGHT: enforce "at most one NULL" with a partial unique index
CREATE UNIQUE INDEX one_null_email ON users (email) WHERE email IS NOT NULL;
```

**Q8. What is the difference between `DELETE`, `TRUNCATE`, and `DROP`?**
`DELETE` is DML: it works row by row, fires triggers, writes WAL, and leaves dead tuples (bloat) behind. `TRUNCATE` is a fast metadata operation; it releases whole pages instead of touching individual rows, so clearing 10M rows takes ~ms, whereas `DELETE` takes tens of seconds. `DROP` permanently removes the table and its indexes:

```sql
-- DELETE: 10M rows one by one, ~30–60 s, bloats the table with dead tuples
DELETE FROM logs WHERE created_at < '2024-01-01';
-- TRUNCATE: frees all pages at once, ~1 ms, cannot be filtered
TRUNCATE logs;
-- DROP: the table and its indexes are gone
DROP TABLE logs;
```

**Q9. What is SQL injection and how does `PreparedStatement` stop it?**
SQL injection occurs when user input is concatenated into SQL text; the input is parsed as _code_, not _data_. The fix is parameterization: the driver sends the value out of band, so `' OR 1=1 --` remains a string. A prepared statement also reuses the parsed plan, saving the parse cost (~10–50 µs) on every repeated execution: correctness and speed in one move:

```java
// WRONG: attacker sends email = "x' OR '1'='1" and becomes any user
String sql = "SELECT * FROM users WHERE email = '" + input + "'";

// RIGHT: the value travels as data, never as SQL
try (PreparedStatement ps = conn.prepareStatement(
        "SELECT * FROM users WHERE email = ?")) {
  ps.setString(1, input);
  try (ResultSet rs = ps.executeQuery()) { /* ... */ }
}
```

**Q10. What is NULL and three-valued logic?**
`NULL` means "unknown", and comparisons with it yield `NULL`, which `WHERE` treats as false. Thus, `WHERE x = NULL` matches nothing, a legendary bug. Aggregates also skip NULLs, so `AVG` over a column containing NULLs ignores those rows. `COALESCE` and `NULLIF` are the everyday tools:

```sql
-- WRONG: matches zero rows, every time
SELECT * FROM orders WHERE discount = NULL;
-- RIGHT
SELECT * FROM orders WHERE discount IS NULL;
-- fill a default for display, without corrupting the stored value
SELECT COALESCE(discount, 0) AS discount FROM orders;
```

**Q11. What is normalization and when do you denormalize?**
Normalization removes redundancy: 1NF requires atomic columns, 2NF removes partial dependencies, and 3NF removes transitive dependencies. The payoff is the elimination of update anomalies; the cost is additional joins. A denormalized copy of `customer_name` on every order means that one rename must touch millions of rows. However, a reporting table that repeats a denormalized value can turn a 5-way join (~50–200 ms on 100k rows) into a single read (~5–20 ms). Denormalize deliberately at the edge, not accidentally in the OLTP schema:

```sql
-- WRONG (not 3NF): customer name duplicated in every order row —
-- rename the customer and you must rewrite every order (update anomaly)
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_name TEXT, amount DECIMAL(19,4));

-- RIGHT: reference by id, join only when you need the name
CREATE TABLE customers (id BIGINT PRIMARY KEY, name TEXT);
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL, amount DECIMAL(19,4));
```

**Q12. Regular view vs materialized view?**
A regular view is a saved query: it is re-executed on every access, is always fresh, and uses no storage. A materialized view is a precomputed snapshot stored on disk: reads take milliseconds, but the data is stale until you `REFRESH` it, which recomputes the view and can take seconds while blocking readers in some engines. Rule of thumb: live data → view; a slow aggregation whose staleness you can tolerate → materialized view:

```sql
-- live view: always current, no storage
CREATE VIEW active_customers AS
  SELECT id, name FROM customers WHERE status = 'active';

-- materialized: a 30 s aggregation becomes a 50 ms read after refresh
CREATE MATERIALIZED VIEW daily_sales AS
  SELECT date_trunc('day', created_at) AS day, SUM(total) AS revenue
  FROM orders GROUP BY 1;
REFRESH MATERIALIZED VIEW daily_sales;   -- every 5–15 min, off-peak
```

**Q13. How does `LIMIT`/`OFFSET` pagination work, and what is its trap?**
`OFFSET` does not skip work; the database still scans and discards the offset rows. Page 1000001 costs roughly as much as scanning 1M rows. Keyset pagination ("seek") uses the index directly and is O(page size), regardless of depth:

```sql
-- WRONG at scale: OFFSET 1000000 → scan + discard 1M rows, ~50–200 ms and growing
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 1000000;
-- RIGHT: seek on the index — ~1–5 ms at any depth, and stable under inserts
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 20;
```

**Q14. How do you manage a transaction from JDBC?**
JDBC defaults to autocommit: every statement is its own transaction, so a two-statement transfer can be half-committed. Turn autocommit off, perform the work, call `commit()`, and call `rollback()` on failure. Two rules seniors live by: the transaction belongs to the connection, so never let a pooled connection escape without returning it, and always release the connection in `finally`:

```java
Connection conn = dataSource.getConnection();
try {
  conn.setAutoCommit(false);
  try (PreparedStatement ps = conn.prepareStatement(
          "UPDATE accounts SET balance = balance - ? WHERE id = ?")) {
    ps.setBigDecimal(1, amt); ps.setLong(2, fromId); ps.executeUpdate();
  }
  try (PreparedStatement ps = conn.prepareStatement(
          "UPDATE accounts SET balance = balance + ? WHERE id = ?")) {
    ps.setBigDecimal(1, amt); ps.setLong(2, toId); ps.executeUpdate();
  }
  conn.commit();                       // both updates land, or neither
} catch (SQLException e) {
  conn.rollback();
  throw e;
} finally {
  conn.setAutoCommit(true);            // leave it clean for the pool
  conn.close();                        // ALWAYS — or the pool drains (Q23)
}
```

**Q15. What index types exist beyond B-tree?**
B-tree is the default for equality, range, and ordering queries. Hash indexes support equality only and rarely outperform B-trees in Postgres. GIN indexes serve "contains" queries over arrays, jsonb, and full text. BRIN is the sleeper: for huge, physically ordered tables such as time series, it stores per-block summaries, so a ~1 GB B-tree on 100 GB of logs can shrink to ~1 MB:

```sql
CREATE INDEX ix_orders_btree ON orders (created_at);          -- range scans, ORDER BY
CREATE INDEX ix_orders_gin ON orders USING GIN (tags);        -- WHERE 'urgent' = ANY(tags)
CREATE INDEX ix_logs_brin ON logs USING BRIN (created_at);    -- ~100x smaller, still fast
```

**Q16. How do you read `EXPLAIN` output?**
`EXPLAIN` shows the planner's tree: the node type (Seq Scan vs Index Scan vs Index Only Scan vs Hash Join vs Nested Loop), the estimated cost and row count, and, with `ANALYZE`, the actual time and row count. The "cost" unit is roughly the time of one sequential page read (~0.01 ms), so compare node types rather than absolute numbers. The red flag is the estimated `rows` versus `actual` rows. If they disagree by 100x, the statistics are stale (run `ANALYZE`) or the query hides the column inside a function:

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;
-- Seq Scan on orders  (cost=0.00..185000.00 rows=5000 width=32)
--                    (actual time=0.012..1250.0 rows=5000 loops=1)
-- 10M rows read sequentially because there is no index on customer_id;
-- adding ix_orders_customer turns this into an Index Scan of ~4 levels (~0.5 ms).
```

**Q17. Can `LIKE` use an index, and what about case-insensitive search?**
`LIKE 'foo%'` (with no leading wildcard) can use a B-tree; `LIKE '%foo%'` cannot, because the pattern does not tell the tree where to start, so it becomes a full scan of 10M rows. Case-insensitive matching adds a second problem: `ILIKE` also prevents use of the index. Solutions include a trigram GIN index for contains searches and an expression index on `lower(col)` for case-insensitive prefixes:

```sql
-- WRONG: leading wildcard → sequential scan over 10M rows
SELECT * FROM users WHERE email LIKE '%@gmail.com';
-- RIGHT: prefix match walks the B-tree
SELECT * FROM users WHERE email LIKE 'a%@gmail.com';
-- RIGHT at scale for contains: trigram index, ~10–50 ms on 10M rows
CREATE INDEX ix_users_email_trgm ON users USING GIN (email gin_trgm_ops);
```

## Mid — trade-offs & pitfalls

**Q18. How does a B-tree index work, and when is it useless?**
A B-tree keeps rows sorted by the indexed column, so equality and range scans are O(log n) instead of O(n). For 1B rows, a B-tree is about four levels deep: roughly four random reads (~0.5 ms each) to find a row, versus a full scan of 1B rows (~tens of seconds). A page holds about 200 entries, providing the fanout that keeps the tree shallow. An index is useless when the predicate wraps the column in a function or is so unselective that it returns more than ~20–30% of the rows, causing the planner to prefer a scan:

```sql
-- WRONG: function on column -> index on created_at NOT used
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- RIGHT: range that the index serves
SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

**Q19. What is a composite index and the leftmost-prefix rule?**
`(a, b, c)` is sorted by `a`, then `b`, then `c`. It serves queries filtering on `a`, `(a,b)`, or `(a,b,c)`, but not on `b` or `c` alone. Order columns by selectivity: putting the most selective column first shrinks the tree walk fastest. The wrong column order creates a dead index:

```sql
-- index: (customer_id, created_at)
SELECT * FROM orders
 WHERE customer_id = 42 ORDER BY created_at DESC;   -- uses index ✓
SELECT * FROM orders WHERE created_at > '2024-01-01'; -- ignores index ✗ (no leftmost a)
-- a single-column index on the hot column beats a dead composite every time
CREATE INDEX ix_orders_created ON orders (created_at);
```

**Q20. Explain isolation levels and their anomalies.**
Each higher level prevents more anomalies at the cost of more locking or snapshotting:

- **Read committed**: no dirty reads; non-repeatable reads possible (same row differs mid-txn).
- **Repeatable read**: consistent within a txn; phantoms and write skew possible.
- **Serializable**: fully isolated, like running serially — safest, slowest (can be 5–10× slower than read committed under contention).

Most engines default to read committed. The level is set per transaction, and Postgres takes a snapshot at the first statement, so `SET TRANSACTION` must come before any query:

```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT balance FROM accounts WHERE id = 1;   -- snapshot pinned here
-- commits from other txns after this point are invisible for the whole txn
COMMIT;
```

**Q21. What is a deadlock and how do you avoid it?**
Two transactions each hold a lock that the other needs. The database detects the cycle in its wait-for graph and rolls one back (Postgres raises `40P01`; MySQL raises `1213`). Avoid deadlocks by accessing resources in a **consistent global order** and keeping transactions short: a 10 ms transaction holds a lock for 10 ms, while a 10 s transaction containing an HTTP call holds it for 10 s:

```sql
-- Both services update accounts; ALWAYS update in id order to avoid cross-deadlock
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- lower id first
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- then higher
COMMIT;
-- belt and braces: a blocked txn fails fast instead of queueing forever
SET lock_timeout = '2s';
```

**Q22. What is the N+1 problem and how do you fix it?**
Your ORM loads N parents and then issues N separate child queries. At N=1000, that is 1001 round trips (about 1–5 ms each, adding ~1–5 s). Fix it with a join, a batch fetch, or a projection: one query, one round trip:

```sql
-- WRONG (N+1): 1 query for orders, then 1 per order for its items
SELECT * FROM orders WHERE user_id = 42;
SELECT * FROM order_items WHERE order_id = ?;   -- repeated 1000x

-- RIGHT: 1 query, all items
SELECT o.id, i.sku, i.qty
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.user_id = 42;
```

```java
// In JPA: fetch the graph eagerly in one statement instead of lazily per row
@EntityGraph(attributePaths = {"items"})
List<Order> findByCustomerId(Long customerId);
```

**Q23. What is connection pooling and why exhaust it?**
Opening a database connection costs ~5–20 ms (TCP, authentication, and a backend process). A pool reuses connections. You exhaust it by leaking connections (not closing them in `finally`) or holding one during a slow call, causing `HikariPool` to throw `ConnectionTimeoutException` after `connectionTimeout` (30 s by default). Rule of thumb: `pool_size ≈ concurrency × (avg_query_ms / target_latency_ms)`:

```java
// WRONG: connection never returned → the pool drains after N requests,
// then every caller waits 30 s and fails
Connection c = dataSource.getConnection();
ResultSet rs = c.createStatement().executeQuery("SELECT ...");
// no c.close() — the lease is gone forever

// RIGHT: try-with-resources returns it to the pool even on exception
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement("SELECT ...")) {
  try (ResultSet rs = ps.executeQuery()) { /* ... */ }
}
```

**Q24. What is a covering index and an index-only scan?**
A covering index stores extra columns (`INCLUDE`) in the B-tree leaves, so the query never needs to access the heap. Each heap fetch is a random read (~0.1–0.5 ms); an index-only scan reads only 8 KB index pages sequentially. On a frequently used report, this often means 10–100× fewer I/Os. Caveat: Postgres must consult the visibility map, which only `VACUUM` maintains; a freshly bloated table can degrade to a bitmap scan:

```sql
CREATE INDEX ix_orders_status ON orders (status) INCLUDE (total, created_at);
-- Index Only Scan — no heap fetch at all
SELECT total, created_at FROM orders WHERE status = 'shipped';
```

**Q25. How do nested-loop, hash, and merge joins differ, and when is each right?**
Nested loop is O(N×M), but each inner lookup can be an indexed ~0.1 ms operation, making it ideal when the outer side is small (100 rows × 1 lookup = 10 ms). Hash join builds a hash table over one side: O(N+M), making it the workhorse for large, unindexed sets. It requires memory (the default `work_mem` is 4 MB; spilling to disk makes it 10–100× slower). Merge join requires sorted inputs and streams results in order, so it is ideal when the planner can feed it from an index and ordered output is useful:

```sql
-- small outer, indexed inner → nested loop, ~100 × 0.1 ms ≈ 10 ms
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.* FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE c.id IN (SELECT id FROM customers WHERE signup_at > now() - interval '1 hour');

-- two big unindexed sets → hash join: build the hash, then one pass per side.
-- Without an index on the join column, a 1M×1M nested loop is ~10^12 row
-- comparisons (hours); the hash join does it in seconds.
```

**Q26. Why does the planner ignore your index?**
The cost model assumes that random reads are ~10× slower than sequential reads, so if an index would return more than ~5–20% of the table, a sequential scan wins. A bitmap heap scan is the middle path: read the index, build a bitmap of pages, and then read only those pages sequentially. If `EXPLAIN` shows a wildly inaccurate `rows` estimate (off by 100x), the statistics are stale; run `ANALYZE`:

```sql
-- 10M rows, 40% are 'pending': index on status exists, seq scan is CORRECT —
-- 4M random heap reads (~tens of seconds) beat one sequential pass (~2–5 s)
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'pending';
-- when a card is selective, the planner will show
-- Bitmap Heap Scan on orders -> Bitmap Index Scan on ix_orders_status
```

**Q27. `IN` vs `EXISTS` vs `JOIN` — same result, different plans?**
All three can express "orders of VIP customers", but the planner treats them differently. `IN` is often unnested into a semi-join; `EXISTS` stops at the first match; `JOIN` multiplies rows when the right side can match more than once, so you then pay for `DISTINCT` (a sort, ~100 ms or more on large sets). For pure existence checks, semi-joins scan the right side only until the first match:

```sql
-- same logical result, three plans:
SELECT * FROM orders
 WHERE customer_id IN (SELECT id FROM customers WHERE vip = true);
SELECT * FROM orders o
 WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.vip);
SELECT DISTINCT o.* FROM orders o
 JOIN customers c ON c.id = o.customer_id WHERE c.vip;   -- DISTINCT = extra sort
-- for "existence" on 1M orders × 50k customers: EXISTS/IN ~5–20 ms,
-- JOIN + DISTINCT typically 10×+ that
```

**Q28. How do you write a race-safe upsert?**
Check-then-insert uses two statements and contains a race: two concurrent requests can both pass the `SELECT`, after which one fails with a unique violation (`23505`). The fix is a single atomic statement, such as `INSERT ... ON CONFLICT` (Postgres) or standard `MERGE`, so the engine handles the conflict within that statement:

```sql
-- WRONG: check-then-act races under concurrency
SELECT 1 FROM inventory WHERE sku = 'A1';   -- both requests pass
INSERT INTO inventory (sku, qty) VALUES ('A1', 5);  -- one blows up: 23505

-- RIGHT: atomic in one statement; on conflict, add instead of fail
INSERT INTO inventory (sku, qty) VALUES ('A1', 5)
ON CONFLICT (sku) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty;
```

**Q29. Why is inserting 10k rows one-by-one so slow, and what fixes it?**
Each `executeUpdate()` is a full round trip: ~0.5–5 ms on a LAN and 10–50 ms across regions. Inserting 10k rows one by one means ~10k round trips, or ~10–50 s. `addBatch()`/`executeBatch()` sends one network flush per batch, reducing the same work to ~100 ms, a ~50–100× improvement:

```java
// WRONG: one round trip per row — 10k rows ≈ 10k network flushes
for (Order o : orders) {
  ps.setLong(1, o.customerId());
  ps.setBigDecimal(2, o.total());
  ps.executeUpdate();
}

// RIGHT: buffer in the driver, one flush per batch
for (Order o : orders) {
  ps.setLong(1, o.customerId());
  ps.setBigDecimal(2, o.total());
  ps.addBatch();
}
ps.executeBatch();   // ~100 ms instead of ~10–50 s
```

**Q30. Which anomalies survive REPEATABLE READ?**
Repeatable read prevents dirty and non-repeatable reads, but not phantoms or **write skew**: two transactions read their snapshots, make decisions based on them, and both commit, breaking the invariant. In the on-call example, two doctors each check that someone else is on call in their snapshot, then both go off call and commit. Postgres detects this at SERIALIZABLE through SSI and aborts one with `40001`; the application must retry:

```sql
-- Write skew: both txns see "1 other doctor" in their own snapshots...
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) FROM on_call WHERE doctor_id <> 1;   -- txn A: sees 1 other
-- ... txn B (doctor 2) runs the same check and also sees 1 other
UPDATE on_call SET active = false WHERE doctor_id = 1;
UPDATE on_call SET active = false WHERE doctor_id = 2;
COMMIT;   -- both commit → 0 doctors on call, invariant broken

-- At SERIALIZABLE, Postgres aborts one with SQLSTATE 40001; retry it.
```

**Q31. What is the JPA lazy-loading trap?**
Lazy collections load only when accessed. Outside an open transaction, that access throws `LazyInitializationException`; inside a transaction, it fires one query per access (N+1 at the worst possible moment: during view rendering). `spring.jpa.open-in-view` papers over the problem by keeping the connection open for the entire request, which also pins a pooled connection per request. Fix the query, not the setting:

```java
// WRONG: the txn closes at the repository boundary...
List<Order> orders = orderRepo.findByCustomerId(42L);
return orders.stream().map(o -> o.getItems().size()).toList();  // 💥 LazyInitializationException
// (with open-in-view: one extra query per order, and every connection held longer)

// RIGHT: fetch the graph in the query, or project only the columns you need
@EntityGraph(attributePaths = {"items"})
List<Order> findByCustomerId(Long customerId);
```

**Q32. What breaks when the FK column has no index?**
The FK guarantees integrity but creates no index on the child column in Postgres. Every deletion or update of a parent row must then scan the entire child table to check for references. `ON DELETE CASCADE` makes this worse: deleting 10k parents from a 50M-row child table without an index requires 10k full scans (minutes, plus locks); with an index, it requires 10k index lookups (seconds):

```sql
-- WRONG: FK without an index on the child side — cascade deletes scan everything
CREATE TABLE order_items (order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE);
-- RIGHT: index the FK column
CREATE INDEX ix_order_items_order ON order_items (order_id);
-- and prefer soft-delete over cascade for anything big: a cascade that
-- silently deletes 1M children is a production incident waiting to happen
```

**Q33. `BIGSERIAL` vs `UUID` primary keys — when does it bite?**
Sequential keys keep the B-tree append-only: new rows land at the right edge, with no page splits. Random UUIDs scatter inserts across the tree; inserts split pages and leave them about half empty, so indexes bloat by ~10–30% and inserts slow down 2–5×. However, UUIDs can be generated client-side (with no round trip or sequence contention) and survive sharding. The compromise is a monotonic `BIGSERIAL` as the primary key and a UUID as a separate `UNIQUE` key for the public API:

```sql
-- WRONG for hot insert tables: random UUID PK → scattered writes, page splits
CREATE TABLE events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payload JSONB);
-- RIGHT: monotonic identity for the tree, UUID only where the outside world sees it
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID UNIQUE DEFAULT gen_random_uuid(),
  payload JSONB
);
-- sequential inserts sustain ~10–50k rows/s; random ones typically 2–5× slower
```

**Q34. `IDENTITY`, `SEQUENCE`, and `GENERATED BY DEFAULT` — what differs?**
All three produce numbers; the difference is where the increment occurs and whether the application can supply its own value. `SERIAL`/`BIGSERIAL` uses a sequence with a default, so the application can still insert explicit IDs. `GENERATED ALWAYS AS IDENTITY` forbids explicit values because the database is the only writer. A standalone sequence decouples ID allocation from the table, which is useful for batching (pre-fetching ranges) but easy to misuse. The practical gotcha is that explicit IDs can collide with sequence ranges, and sequence increments are not rolled back when transactions fail. Gaps are normal, not a bug:

```sql
CREATE TABLE a (id BIGSERIAL PRIMARY KEY);             -- sequence-backed default
CREATE TABLE b (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY);  -- DB-owned
CREATE SEQUENCE order_seq START 1000;                  -- hand-rolled allocation
-- fetching 1000 ids in one round trip enables batch inserts (Q29)
SELECT nextval('order_seq') FROM generate_series(1, 1000);
```

## Senior — design & defense

**Q35. A report query on a 500M-row table times out. Walk the diagnosis and fix.**
"I'd start with `EXPLAIN ANALYZE`, which will usually reveal a sequential scan because the predicate wraps a column in a function or the index does not match the leftmost prefix. If it is an aggregation, a materialized view refreshed every 5–15 minutes can turn a 30 s scan into a 50 ms read. If the data must be live, a **covering index** lets the planner use an index-only scan with no heap fetch. Proof before and after:"

```sql
-- Before: Seq Scan on orders  (cost=0.00..8_500_000 rows=120_000_000)
-- After adding (status, created_at) INCLUDE (total):
--   Index Only Scan using ix_orders_status_created ... (cost=0.00..1_200)
CREATE INDEX ix_orders_status_created ON orders (status, created_at) INCLUDE (total);
```

"I confirm that p95 drops from ~30 s to <100 ms: measured, not assumed."

**Q36. Design a schema for 1M orders/day. Indexing strategy?**
"I'd partition by month (range partitions) so old data can be archived and recent queries scan less. I'd add `(customer_id, created_at)` for 'my orders, newest first' (leftmost prefix plus sort). I'd avoid indexing every column: each index adds ~10–20% write amplification, which matters at 1M rows per day. I'd push hot analytics to a read replica and keep the write path to 1–2 indexes per hot table:"

```sql
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  total DECIMAL(19,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (created_at);

CREATE INDEX ix_orders_cust_created ON orders (customer_id, created_at DESC);
-- index budget: every extra index costs ~10–20% write overhead;
-- at 1M rows/day that is measurable — index queries, not columns
```

**Q37. Choose isolation for a payment service, defended by failure mode.**
"For the transfer path, I use `REPEATABLE READ` or `SERIALIZABLE`; a non-repeatable read could cause a double debit. The cost is more locks and possible serialization failures (Postgres `serialization_failure`, SQLSTATE 40001) under contention, so I keep these transactions tiny (just the balance calculation) and retry on 40001. For read-heavy reporting, I use `READ COMMITTED` on a replica. The anomaly you cannot tolerate determines the level: you pay for isolation only where the money is:"

```java
// the payment txn is 2 UPDATEs — small on purpose, retried on 40001
@Transactional
public void transfer(long fromId, long toId, BigDecimal amt) {
  jdbc.update("UPDATE accounts SET balance = balance - ? WHERE id = ?", amt, fromId);
  jdbc.update("UPDATE accounts SET balance = balance + ? WHERE id = ?", amt, toId);
}
// caller: catch SQLException with SQLState "40001" → retry up to 3×, backoff 50/100/200 ms
```

**Q38. You see lock waits under moderate load. Find the cause.**
"I'd query `pg_locks` joined to `pg_stat_activity` to find the blocking PID and its statement. Nine times out of ten, a long transaction holds a row lock while making a slow external call, so the lock lasts for seconds instead of milliseconds. I'd shrink the transaction to the minimum writes, move the slow work outside it, and set `lock_timeout = 2s` so a blocked transaction fails fast instead of causing a cascade. I'd measure lock-wait time before and after:"

```sql
-- who is holding locks for more than 5 seconds?
SELECT pid, state, now() - xact_start AS txn_age, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE state <> 'idle' AND now() - xact_start > interval '5 seconds'
ORDER BY txn_age DESC;

-- and who blocks whom:
SELECT b.pid AS blocker, b.query AS blocker_query, a.pid AS blocked
FROM pg_stat_activity a
JOIN pg_locks l ON l.pid = a.pid
JOIN pg_locks bl ON bl.locktype = l.locktype AND bl.database = l.database
  AND bl.relation = l.relation AND bl.mode = l.mode AND bl.pid <> a.pid
JOIN pg_stat_activity b ON b.pid = bl.pid;
```

**Q39. ORM or raw SQL — when do you drop JPA?**
"When a query is complex (deep joins, window functions, or bulk updates) or frequently used, JPA's generated SQL can be opaque and often causes N+1 queries. I use `JdbcTemplate` or jOOQ with exactly the columns I need; the SQL is reviewable and the plan is predictable. For CRUD-shaped data, JPA is still the faster development path. The decision is per query, not per project:"

```java
// WRONG: loads the whole entity graph, then a field
Order o = repo.findById(42L).get();  // + lazy collections = N+1
// RIGHT: one projection, one query
String sql = "SELECT status, total FROM orders WHERE id = ?";
return jdbcTemplate.queryForObject(sql,
    (rs, r) -> new OrderView(rs.getString(1), rs.getBigDecimal(2)), id);
```

**Q40. Defend a connection-pool size with Little's Law.**
"`pool ≈ target_concurrency × (avg_query_ms / acceptable_latency_ms)`. With a 5 ms average and 200 concurrent requests, that is ~200 × (0.005 / 0.1) ≈ 10, padded for variance to ~20–30, not 200. Oversizing wastes database connections (each holds a backend process plus ~5–10 MB) and can _reduce_ throughput through lock contention. I set `maximumPoolSize` from real measurements, monitor wait time, and tune:"

```java
HikariConfig cfg = new HikariConfig();
cfg.setMaximumPoolSize(30);        // Little's Law ~10, padded to 20–30
cfg.setConnectionTimeout(2000);    // fail fast — don't queue 30 s when the DB is sick
cfg.setValidationTimeout(1000);
cfg.setLeakDetectionThreshold(10_000);  // catches leaked connections in tests
```

**Q41. Partial and expression indexes — where does the index budget go?**
"Indexing every column is how write-heavy services die. A **partial index** indexes only the rows a query actually needs (say, 1% of the table): it is 100× smaller, ~100× cheaper to maintain, and provides the same query speed. An **expression index** indexes the function you actually call: `WHERE lower(email) = ?` cannot use a plain index on `email`, but can use one on `lower(email)`. Both help me stay under the ~20% write-amplification budget at scale:"

```sql
-- partial: only the 1% of rows in 'open' status are indexed
CREATE INDEX ix_orders_open ON orders (created_at) WHERE status = 'open';
-- expression: index the function, not the column
CREATE INDEX ix_users_email_lower ON users (lower(email));
SELECT * FROM users WHERE lower(email) = 'dev@example.com';   -- uses it now
```

**Q42. Partitioning — when does it help and when does it backfire?**
"Range partitioning by month pays off when (a) queries filter on the partition key, allowing pruning to skip whole partitions, and (b) you retire data with `DETACH`/`DROP PARTITION`, which is O(1) metadata work instead of a bloating, locking `DELETE`. It backfires at smaller scales: each partition adds planner overhead, and a query that _doesn't_ filter on the key scans every partition. Hash partitioning spreads hot writes across shards but does not help range queries. Rule of thumb: partition when the table exceeds ~100 GB or ~100M rows, and always include the partition key in hot predicates:"

```sql
CREATE TABLE events (...) PARTITION BY RANGE (created_at);
CREATE TABLE events_2026_08 PARTITION OF events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- retire a month: O(1), no bloat, no lock on the rest of the table
ALTER TABLE events DETACH PARTITION events_2026_01;
-- trap: WHERE created_at >= ... must match the partition key,
-- otherwise pruning fails and every partition gets scanned
```

**Q43. Read replicas and replication lag — how do you keep reads correct?**
"Asynchronous replicas can lag by tens of milliseconds to seconds under load, so a user who has just placed an order may see '0 orders' when the next read goes to a replica. This is the read-your-writes problem. I route that user's data to the primary for a short window after a write (session affinity), and monitor `pg_stat_replication` so a lagging replica is removed from rotation before reports silently become inaccurate. Dashboards on replicas must state their staleness budget clearly:"

```sql
-- on the replica, lag = how far behind the primary it is
SELECT replay_lag FROM pg_stat_replication;
-- app-side guard for write-then-read flows:
-- if the request was written by THIS user in the last 5 s → hit the primary
```

**Q44. How do you keep the DB and a message broker consistent?**
"Writing the row and publishing the event in separate transactions is a dual write: if the process crashes between them, the event is lost forever. The **transaction outbox** puts the event in the same database transaction, making the operation atomic by construction; a poller then publishes and deletes it. The event is never lost; it is merely delayed by up to the polling interval (~100 ms–1 s), a good trade-off for 'never lose a refund event':"

```java
@Transactional
public void refund(long orderId) {
  jdbc.update("UPDATE orders SET status = 'refunded' WHERE id = ?", orderId);
  // same txn, same commit — the outbox row cannot exist without the update
  jdbc.update("INSERT INTO outbox (event_id, payload) VALUES (?, ?)",
      UUID.randomUUID(), json(orderId, "REFUNDED"));
}
// separate dispatcher: SELECT pending → publish to broker → DELETE by event_id
// (idempotent consumer on the other side — at-least-once delivery)
```

**Q45. Optimistic vs pessimistic locking — which do you reach for?**
"Optimistic locking (a `@Version` column) costs nothing until commit time: the UPDATE checks the version, and if someone else wrote first, zero rows match and you retry the entire transaction. Pessimistic locking (`SELECT ... FOR UPDATE`) holds the row lock from the read until commit. It is correct, but a slow transaction makes everyone else wait. For web traffic, optimistic locking usually wins: contention is typically under 5% of requests, so a rare retry is better than holding locks for the entire median request:"

```java
@Entity
public class Order {
  @Version private long version;   // bumped on every UPDATE
}
```

```sql
-- the version check makes check-then-act atomic:
UPDATE orders SET total = ?, version = version + 1
WHERE id = ? AND version = ?;
-- 0 rows updated → someone else wrote first → retry the whole txn

-- pessimistic alternative — lock is held until COMMIT:
BEGIN;
SELECT total FROM orders WHERE id = 42 FOR UPDATE;
```

**Q46. A single hot row is updated by every request — what do you do?**
"One row means one lock: every update is serialized, capping you at ~1–5k updates/s on that row regardless of how many application instances you have. For counters (likes, view counts, or seats remaining), **shard the row**: split the count across N buckets, write to one bucket per request, and use `SUM` when reading. This works only when the total can be slightly stale or the buckets are naturally per-request. Never use it for money, where a single row plus retries is the honest design:"

```sql
-- WRONG: every like hits the same row — one lock, one serialized writer
UPDATE posts SET likes = likes + 1 WHERE id = 9;

-- RIGHT: 64 shards — 64 concurrent writers on the same logical counter
UPDATE post_likes SET n = n + 1
WHERE post_id = 9 AND shard = (random() * 63)::int;   -- pick a bucket
SELECT SUM(n) FROM post_likes WHERE post_id = 9;      -- read = sum of buckets
```

**Q47. Why does a table grow without inserts, and what is bloat?**
"MVCC means an UPDATE creates a new row version; the old one becomes a **dead tuple** that only `VACUUM` can reclaim. If autovacuum cannot keep up (the defaults trigger at 20% dead tuples plus 50 rows), the table and its indexes bloat: a table holding 1 GB of live data can occupy 5 GB, and every scan and index walk slows down for 'no reason'. I monitor `pg_stat_user_tables`; when dead tuples exceed ~30% of live tuples, I run `VACUUM` (cheap) or `VACUUM FULL`/`pg_repack` (reclaims space but takes locks, so schedule it):"

```sql
SELECT relname, n_dead_tup, n_live_tup,
       round(100.0 * n_dead_tup / greatest(n_live_tup, 1), 1) AS dead_pct
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 5;
-- dead > 30% of live → bloat is costing you; VACUUM reclaims the tuples,
-- VACUUM FULL rebuilds the files (ACCESS EXCLUSIVE lock — do it in a window)
```

**Q48. `ALTER TABLE` on a 500M-row table — how do you do it without downtime?**
"The two main dangers are table rewrites and `ACCESS EXCLUSIVE` locks. Postgres 11+ made `ADD COLUMN ... DEFAULT` metadata-only (~ms, with no rewrite), but `NOT NULL` still scans the table, and a normal index build still locks writers. The safe sequence is: add the column, backfill in batches, add the constraint as `NOT VALID`, then `VALIDATE` it (a lock-free recheck). For indexes, always use `CREATE INDEX CONCURRENTLY`:"

```sql
-- WRONG: locks the table for the whole rewrite — 500M rows = ~30–60 min down
ALTER TABLE orders ADD COLUMN region TEXT NOT NULL DEFAULT 'eu';

-- RIGHT (PG 11+): metadata-only default, ~ms, no rewrite
ALTER TABLE orders ADD COLUMN region TEXT;
ALTER TABLE orders ALTER COLUMN region SET DEFAULT 'eu';
-- backfill in batches of 100k, then validate the constraint without locking:
ALTER TABLE orders ADD CONSTRAINT orders_region_nn CHECK (region IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_region_nn;
-- and indexes: CREATE INDEX CONCURRENTLY ix_orders_region ON orders (region);
```

**Q49. A query that was fast for months suddenly goes slow — why?**
"First suspect: statistics. The planner's `rows` estimate drives every join choice. If a table has grown 100× since the last `ANALYZE`, the planner may still think it has 100k rows and choose a nested loop instead of a hash join, making the query 100× slower. Second: the data distribution changed (a column that was 50/50 is now 99/1). Third: the index itself has accumulated bloat. The process is never blind tuning: run `EXPLAIN (ANALYZE, BUFFERS)`, compare it with the old plan, and check `last_analyze`:"

```sql
SELECT relname, last_analyze, last_autoanalyze, n_mod_since_analyze
FROM pg_stat_user_tables WHERE relname = 'orders';
-- n_mod_since_analyze >> 10% of the table → statistics are lying to the planner
ANALYZE orders;   -- refresh stats, then re-EXPLAIN before touching anything
```

**Q50. What is your backup and recovery story — with numbers?**
"A backup strategy is a contract: **RPO** (how much data can be lost) and **RTO** (how long recovery may take). For Postgres, continuous WAL archiving provides an RPO of seconds: a base backup plus every WAL segment lets me recover to any point in time. Logical dumps (`pg_dump`) of a 1 TB database take hours, so they are for schema and portability, not disaster recovery. The non-negotiable practice is to restore to staging on a schedule and measure the time. The day we need the backup is not the day to learn how to use it:"

```sql
-- take a restore point so a bad deploy is one command to undo
SELECT pg_create_restore_point('before_deploy_v42');

-- the restore drill: base backup + replay WAL to the restore point
-- pg_restore -d appdb latest.dump       (logical — schema/portability)
-- pg_basebackup + WAL archive replay    (physical — seconds-level RPO)
-- RPO ≈ last archived WAL (seconds); RTO ≈ base restore + WAL replay (minutes)
```

#### Self-check

- [ ] Can I write DDL/DML for PK/FK/index, explain NULL's three-valued logic, `COUNT` variants, and money columns — with code, and say why `FLOAT` is banned?
- [ ] Can I explain B-tree/composite/covering indexes, why the planner ignores an index (selectivity, function wrap), N+1, JDBC batching, and the isolation-level ladder with concrete anomalies?
- [ ] Can I diagnose a slow query from `EXPLAIN ANALYZE` output and fix it with the right index — without guessing?
- [ ] Can I defend schema choices (partitioning, `BIGSERIAL` vs UUID, outbox, sharded counters, pool sizing) with numbers and failure modes?
- [ ] Can I handle lock waits, bloat, safe `ALTER TABLE`, a plan that suddenly degrades, and a backup story with real commands and RPO/RTO?
