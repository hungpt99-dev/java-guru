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

The database is where "it works on my machine" dies. Junior developers write `SELECT *` and wonder why prod is slow; seniors can show the exact `EXPLAIN` proving why a query does a sequential scan and which index fixes it. This post climbs from joins to isolation anomalies to pool exhaustion — 50 questions, pick the level you are interviewing at, and read one above it, with SQL and JDBC you can actually run.

> Mindset: junior writes a query that returns the right rows; senior writes one that returns the right rows _and_ won't take the site down at 10x traffic — and can prove it with `EXPLAIN ANALYZE`.

## Junior — foundations

**Q1. What is a primary key, foreign key, and index?**
A primary key uniquely identifies a row (enforced unique + not null). A foreign key references a PK in another table, enforcing referential integrity. An index is a B-tree that speeds lookups at the cost of write overhead. Without an index, `WHERE` does a sequential scan — on a 10M-row table that's ~10M row reads (~hundreds of ms to seconds); with an index it's ~4 B-tree levels (~4 random reads, ~0.5 ms). Note that a FK does _not_ create an index on the child column in most engines — a missing FK index turns every parent delete into a scan of the child table:

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
`INNER JOIN` returns only matched rows; `LEFT JOIN` returns all left rows with matched right columns or NULLs. A classic bug — using `INNER` when you need orphans drops data silently:

```sql
-- WRONG: drops users with no orders
SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = u.id;

-- RIGHT: keeps every user, shows NULL when they have no orders
SELECT u.name, o.id FROM users u LEFT JOIN orders o ON o.user_id = u.id;

-- and if a user appears 3×, that is 3 orders — the join is not broken,
-- you asked for row-per-order. Use DISTINCT or aggregation deliberately.
```

**Q3. What is the difference between `WHERE` and `HAVING`?**
`WHERE` filters rows before grouping; `HAVING` filters groups after `GROUP BY`. You cannot use an aggregate in `WHERE` — it's a syntax error. The order matters for performance too: `WHERE` runs before aggregation, so it can use an index and shrink the input from 10M rows to 10k before grouping; `HAVING` can only see the already-aggregated result:

```sql
-- WRONG
SELECT user_id, COUNT(*) FROM orders WHERE COUNT(*) > 1 GROUP BY user_id;
-- RIGHT
SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1;
```

**Q4. What is a transaction and ACID?**
A transaction groups operations into an all-or-nothing unit. ACID: **A**tomicity (all or nothing), **C**onsistency (valid state), **I**solation (concurrent txns don't interfere), **D**urability (committed data survives crashes). A transfer: debit A and credit B must both commit or both roll back — never leave money vanished. Durability is not free: each commit forces a WAL flush, typically ~1–10 ms, which is why batching matters (Q29):

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;      -- or ROLLBACK; if the second UPDATE fails
```

**Q5. What is the difference between `COUNT(*)`, `COUNT(col)`, `COUNT(DISTINCT col)`?**
`COUNT(*)` counts rows (incl. NULLs); `COUNT(col)` counts non-NULL values; `COUNT(DISTINCT col)` counts unique non-NULL. On a 1M-row table, mixing them silently changes your number — a common reporting bug. And `COUNT(*)` is not free: without an index-only scan it reads every row of the table (~seconds on 10M rows), which is why dashboards pre-aggregate:

```sql
SELECT COUNT(*) FROM orders;                 -- all rows, NULLs included
SELECT COUNT(shipped_at) FROM orders;        -- only non-NULL shipped dates
SELECT COUNT(DISTINCT customer_id) FROM orders;  -- unique customers
```

**Q6. Why not store money as `FLOAT`?**
Binary floats can't represent decimals exactly (0.1 + 0.2 ≠ 0.3), causing rounding drift that makes ledgers not reconcile. Use `DECIMAL(19,4)` or store integer minor units (cents). And once the DB is safe, the Java side must be too — never map money to `double`:

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
A PK is `UNIQUE NOT NULL` plus the table's identity anchor; a table has exactly one PK but many `UNIQUE` constraints. The trap is NULL semantics: in Postgres, `UNIQUE` treats NULLs as distinct, so two rows with `NULL` in a unique column are legal — which surprises people enforcing "one email per user":

```sql
-- WRONG: this allows an unlimited number of NULL email rows
CREATE TABLE users (email TEXT UNIQUE);
INSERT INTO users VALUES (NULL), (NULL);   -- succeeds in Postgres!

-- RIGHT: enforce "at most one NULL" with a partial unique index
CREATE UNIQUE INDEX one_null_email ON users (email) WHERE email IS NOT NULL;
```

**Q8. What is the difference between `DELETE`, `TRUNCATE`, and `DROP`?**
`DELETE` is DML: row-by-row, fires triggers, writes WAL, and leaves dead tuples (bloat) behind. `TRUNCATE` is fast metadata work — it releases whole pages instead of touching rows, so clearing 10M rows takes ~ms where `DELETE` takes tens of seconds. `DROP` removes the table and its indexes permanently:

```sql
-- DELETE: 10M rows one by one, ~30–60 s, bloats the table with dead tuples
DELETE FROM logs WHERE created_at < '2024-01-01';
-- TRUNCATE: frees all pages at once, ~1 ms, cannot be filtered
TRUNCATE logs;
-- DROP: the table and its indexes are gone
DROP TABLE logs;
```

**Q9. What is SQL injection and how does `PreparedStatement` stop it?**
Injection happens when user input is concatenated into SQL text — the input is parsed as _code_, not _data_. The fix is parameterization: the driver sends the value out-of-band, so `' OR 1=1 --` stays a string. A prepared statement also reuses the parsed plan, saving the parse cost (~10–50 µs) on every repeated execution — correctness and speed in one move:

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
`NULL` means "unknown", and comparisons with it yield `NULL`, which `WHERE` treats as false. So `WHERE x = NULL` matches nothing — a legendary bug. Aggregates skip NULLs too, so `AVG` over a column with NULLs ignores those rows. `COALESCE` and `NULLIF` are the everyday tools:

```sql
-- WRONG: matches zero rows, every time
SELECT * FROM orders WHERE discount = NULL;
-- RIGHT
SELECT * FROM orders WHERE discount IS NULL;
-- fill a default for display, without corrupting the stored value
SELECT COALESCE(discount, 0) AS discount FROM orders;
```

**Q11. What is normalization and when do you denormalize?**
Normalization removes redundancy: 1NF atomic columns, 2NF no partial dependencies, 3NF no transitive dependencies. The payoff is eliminating update anomalies; the cost is joins. A denormalized copy of `customer_name` on every order means one rename must touch millions of rows. But a reporting table that repeats a denormalized value turns a 5-way join (~50–200 ms on 100k rows) into a single read (~5–20 ms) — denormalize deliberately at the edge, not by accident in the OLTP schema:

```sql
-- WRONG (not 3NF): customer name duplicated in every order row —
-- rename the customer and you must rewrite every order (update anomaly)
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_name TEXT, amount DECIMAL(19,4));

-- RIGHT: reference by id, join only when you need the name
CREATE TABLE customers (id BIGINT PRIMARY KEY, name TEXT);
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL, amount DECIMAL(19,4));
```

**Q12. Regular view vs materialized view?**
A regular view is a saved query — it is re-executed on every access, always fresh, zero storage. A materialized view is a precomputed snapshot stored on disk: reads are milliseconds, but it is stale until you `REFRESH` it (which recomputes and can take seconds, blocking readers in some engines). Rule of thumb: live data → view; slow aggregation whose staleness you can tolerate → materialized:

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
`OFFSET` does not skip work — the DB still scans and discards the offset rows. Page 1000001 costs the same as scanning 1M rows. Keyset pagination ("seek") uses the index directly and is O(page size) regardless of depth:

```sql
-- WRONG at scale: OFFSET 1000000 → scan + discard 1M rows, ~50–200 ms and growing
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 1000000;
-- RIGHT: seek on the index — ~1–5 ms at any depth, and stable under inserts
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 20;
```

**Q14. How do you manage a transaction from JDBC?**
JDBC defaults to autocommit — every statement is its own transaction, so a two-statement transfer can half-commit. Turn autocommit off, do the work, `commit()`, and `rollback()` on failure. Two rules seniors live by: the transaction lives on the connection, so never let a pooled connection escape without being returned, and always release the connection in `finally`:

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
B-tree is the default: equality, range, and ordering. Hash indexes are pure-equality (rarely beat B-tree in Postgres). GIN indexes serve "contains" queries — arrays, jsonb, full-text. BRIN is the sleeper: for huge, physically-ordered tables (time series) it stores per-block summaries, so a ~1 GB B-tree on 100 GB of logs collapses to ~1 MB:

```sql
CREATE INDEX ix_orders_btree ON orders (created_at);          -- range scans, ORDER BY
CREATE INDEX ix_orders_gin ON orders USING GIN (tags);        -- WHERE 'urgent' = ANY(tags)
CREATE INDEX ix_logs_brin ON logs USING BRIN (created_at);    -- ~100x smaller, still fast
```

**Q16. How do you read `EXPLAIN` output?**
`EXPLAIN` shows the planner's tree: the node type (Seq Scan vs Index Scan vs Index Only Scan vs Hash Join vs Nested Loop), estimated cost and rows, and with `ANALYZE` the actual time and rows. The "cost" unit is roughly the time of one sequential page read (~0.01 ms), so compare node types, not absolute numbers. The red flag is `rows` estimate vs `actual` — if they disagree by 100x, statistics are stale (`ANALYZE`) or the query hides the column in a function:

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;
-- Seq Scan on orders  (cost=0.00..185000.00 rows=5000 width=32)
--                    (actual time=0.012..1250.0 rows=5000 loops=1)
-- 10M rows read sequentially because there is no index on customer_id;
-- adding ix_orders_customer turns this into an Index Scan of ~4 levels (~0.5 ms).
```

**Q17. Can `LIKE` use an index, and what about case-insensitive search?**
`LIKE 'foo%'` (no leading wildcard) uses a B-tree; `LIKE '%foo%'` cannot, because the pattern doesn't tell the tree where to start — it becomes a full scan of 10M rows. Case-insensitivity adds a second problem: `ILIKE` also blocks the index. Solutions: trigram GIN indexes for contains, an expression index on `lower(col)` for case-insensitive prefix:

```sql
-- WRONG: leading wildcard → sequential scan over 10M rows
SELECT * FROM users WHERE email LIKE '%@gmail.com';
-- RIGHT: prefix match walks the B-tree
SELECT * FROM users WHERE email LIKE 'a%@gmail.com';
-- RIGHT at scale for contains: trigram index, ~10–50 ms on 10M rows
CREATE INDEX ix_users_email_trgm ON users USING GIN (email gin_trgm_ops);
```

## Mid — tradeoffs & pitfalls

**Q18. How does a B-tree index work, and when is it useless?**
A B-tree keeps rows sorted by the indexed column, so equality/range scans are O(log n) instead of O(n). For 1B rows a B-tree is ~4 levels deep — ~4 random reads (~0.5 ms each) to find a row, vs a full scan of 1B rows (~tens of seconds). A page holds ~200 entries, which is the fanout that keeps the tree shallow. It's useless when the predicate wraps the column in a function (can't use the index) or is so unselective it returns >~20–30% of rows (planner prefers a scan):

```sql
-- WRONG: function on column -> index on created_at NOT used
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- RIGHT: range that the index serves
SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

**Q19. What is a composite index and the leftmost-prefix rule?**
`(a, b, c)` is sorted by a, then b, then c. It serves queries filtering on `a`, `(a,b)`, or `(a,b,c)` — but NOT `b` or `c` alone. Order by selectivity: the most selective column first shrinks the tree walk fastest. Wrong column order = a dead index:

```sql
-- index: (customer_id, created_at)
SELECT * FROM orders
 WHERE customer_id = 42 ORDER BY created_at DESC;   -- uses index ✓
SELECT * FROM orders WHERE created_at > '2024-01-01'; -- ignores index ✗ (no leftmost a)
-- a single-column index on the hot column beats a dead composite every time
CREATE INDEX ix_orders_created ON orders (created_at);
```

**Q20. Explain isolation levels and their anomalies.**
Each level buys fewer anomalies at the price of more locking/snapshotting:

- **Read committed**: no dirty reads; non-repeatable reads possible (same row differs mid-txn).
- **Repeatable read**: consistent within a txn; phantoms and write skew possible.
- **Serializable**: fully isolated, like running serially — safest, slowest (can be 5–10× slower than read committed under contention).

Most engines default to read committed. The level is set per transaction, and a snapshot in Postgres is taken at the first statement — so `SET TRANSACTION` must come before any query:

```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT balance FROM accounts WHERE id = 1;   -- snapshot pinned here
-- commits from other txns after this point are invisible for the whole txn
COMMIT;
```

**Q21. What is a deadlock and how do you avoid it?**
Two transactions each hold a lock the other needs. The DB detects the cycle in its wait-for graph and rolls one back (Postgres raises `40P01`; MySQL `1213`). Avoid by accessing resources in a **consistent global order** and keeping txns short — a 10 ms txn holds a lock for 10 ms, a 10 s txn with an HTTP call inside holds it for 10 s:

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
Your ORM loads N parents, then issues N separate child queries. At N=1000 that's 1001 round-trips (~each 1–5 ms → ~1–5 s added). Fix with a join, a batch fetch, or a projection — one query, one round trip:

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
Opening a DB connection costs ~5–20 ms (TCP + auth + backend process). A pool reuses them. You exhaust it by leaking connections (no close in `finally`) or holding one inside a slow call, so `HikariPool` throws `ConnectionTimeoutException` after `connectionTimeout` (default 30 s). Rule of thumb: `pool_size ≈ concurrency × (avg_query_ms / target_latency_ms)`:

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
A covering index stores extra columns (`INCLUDE`) inside the B-tree leaves, so the query never touches the heap at all. Each heap fetch is a random read (~0.1–0.5 ms); an index-only scan reads only 8 KB index pages sequentially. On a hot report this is often 10–100× fewer I/Os. Caveat: Postgres must consult the visibility map, which only `VACUUM` maintains — a freshly-bloated table degrades to a bitmap scan:

```sql
CREATE INDEX ix_orders_status ON orders (status) INCLUDE (total, created_at);
-- Index Only Scan — no heap fetch at all
SELECT total, created_at FROM orders WHERE status = 'shipped';
```

**Q25. How do nested-loop, hash, and merge joins differ, and when is each right?**
Nested loop is O(N×M) but each inner lookup is an indexed ~0.1 ms — perfect when the outer side is small (100 rows × 1 lookup = 10 ms). Hash join builds a hash table over one side: O(N+M), the workhorse for big unindexed sets; it needs memory (default `work_mem` 4 MB — spilling to disk makes it 10–100× slower). Merge join requires sorted inputs and streams results in order — ideal when the planner can feed it from an index and you want ordered output anyway:

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
The cost model: random reads are ~10× slower than sequential ones, so if an index would return >~5–20% of the table, a sequential scan wins. A bitmap heap scan is the middle path — read the index, build a bitmap of pages, then read only those pages sequentially. And if `EXPLAIN` shows a wild `rows` estimate (100x off), the statistics are stale: run `ANALYZE`:

```sql
-- 10M rows, 40% are 'pending': index on status exists, seq scan is CORRECT —
-- 4M random heap reads (~tens of seconds) beat one sequential pass (~2–5 s)
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'pending';
-- when a card is selective, the planner will show
-- Bitmap Heap Scan on orders -> Bitmap Index Scan on ix_orders_status
```

**Q27. `IN` vs `EXISTS` vs `JOIN` — same result, different plans?**
All three can express "orders of VIP customers", but the planner treats them differently. `IN` often gets unnested into a semi-join; `EXISTS` stops at the first match; `JOIN` multiplies rows if the right side can match more than once — then you pay for `DISTINCT` (a sort, ~100 ms+ on big sets). For pure existence checks, semi-joins scan the right side only until the first hit:

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
Check-then-insert is two statements and a race: two concurrent requests both pass the `SELECT`, then one fails with a unique violation (`23505`). The fix is one atomic statement — `INSERT ... ON CONFLICT` (Postgres) or standard `MERGE` — so the conflict is handled by the engine in the same statement:

```sql
-- WRONG: check-then-act races under concurrency
SELECT 1 FROM inventory WHERE sku = 'A1';   -- both requests pass
INSERT INTO inventory (sku, qty) VALUES ('A1', 5);  -- one blows up: 23505

-- RIGHT: atomic in one statement; on conflict, add instead of fail
INSERT INTO inventory (sku, qty) VALUES ('A1', 5)
ON CONFLICT (sku) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty;
```

**Q29. Why is inserting 10k rows one-by-one so slow, and what fixes it?**
Each `executeUpdate()` is a full round trip: ~0.5–5 ms on a LAN, 10–50 ms cross-region. 10k rows one-by-one ≈ 10k round trips ≈ 10–50 s. `addBatch()`/`executeBatch()` sends one network flush per batch, collapsing the same work to ~100 ms — a ~50–100× win:

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
Repeatable read kills dirty/non-repeatable reads, but not phantoms or **write skew**: two txns each read a snapshot, both make decisions on it, both commit — and the invariant breaks. The on-call example: two doctors each check "someone else is on call" in their snapshot, both go off call, both commit. Postgres detects this at SERIALIZABLE via SSI and aborts one with `40001` — the app must retry:

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
Lazy collections only load when touched — outside an open transaction that throws `LazyInitializationException`, and inside one it fires a query per access (N+1 at the worst possible moment: during view rendering). `spring.jpa.open-in-view` papers over it by keeping the connection open for the whole request — which also pins a pooled connection per request. Fix at the query, not with the setting:

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
The FK guarantees integrity but creates no index on the child column in Postgres. Every delete or update of a parent row must then scan the whole child table to check for references — and `ON DELETE CASCADE` makes it worse: deleting 10k parents against a 50M-row child without an index is 10k full scans (minutes, plus locks); with an index it's 10k index lookups (seconds):

```sql
-- WRONG: FK without an index on the child side — cascade deletes scan everything
CREATE TABLE order_items (order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE);
-- RIGHT: index the FK column
CREATE INDEX ix_order_items_order ON order_items (order_id);
-- and prefer soft-delete over cascade for anything big: a cascade that
-- silently deletes 1M children is a production incident waiting to happen
```

**Q33. `BIGSERIAL` vs `UUID` primary keys — when does it bite?**
Sequential keys keep the B-tree append-only: new rows land at the right edge, no page splits. Random UUIDs scatter inserts across the whole tree — every insert splits pages and leaves them ~half empty, so indexes bloat ~10–30% and inserts slow down 2–5×. But UUIDs are generated client-side (no round trip, no contention on the sequence) and survive sharding. The compromise: monotonic `BIGSERIAL` as PK, UUID as a separate `UNIQUE` key for the public API:

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
All three produce numbers; the difference is where the increment happens and whether the app can supply its own value. `SERIAL`/`BIGSERIAL` uses a sequence with a default — the app can still insert explicit ids. `GENERATED ALWAYS AS IDENTITY` forbids explicit values (the DB is the only writer). A bare sequence decouples id allocation from the table — handy for batching (pre-fetch ranges) but easy to misuse. The practical gotcha: explicit ids can collide with sequence ranges, and sequence increments are not rolled back on failed txns (gaps are normal, not a bug):

```sql
CREATE TABLE a (id BIGSERIAL PRIMARY KEY);             -- sequence-backed default
CREATE TABLE b (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY);  -- DB-owned
CREATE SEQUENCE order_seq START 1000;                  -- hand-rolled allocation
-- fetching 1000 ids in one round trip enables batch inserts (Q29)
SELECT nextval('order_seq') FROM generate_series(1, 1000);
```

## Senior — design & defense

**Q35. A report query on a 500M-row table times out. Walk the diagnosis and fix.**
"I'd `EXPLAIN ANALYZE` — usually a sequential scan because the predicate wraps a column in a function or the index isn't leftmost-matching. If it's an aggregation, a materialized view refreshed every 5–15 min turns a 30 s scan into a 50 ms read. If it must be live, a **covering index** lets the planner do an index-only scan (no heap fetch). Proof before/after:"

```sql
-- Before: Seq Scan on orders  (cost=0.00..8_500_000 rows=120_000_000)
-- After adding (status, created_at) INCLUDE (total):
--   Index Only Scan using ix_orders_status_created ... (cost=0.00..1_200)
CREATE INDEX ix_orders_status_created ON orders (status, created_at) INCLUDE (total);
```

"I confirm p95 drops from ~30 s to <100 ms — measured, not assumed."

**Q36. Design a schema for 1M orders/day. Indexing strategy?**
"Partition by month (range partitions) so old data archives and recent queries scan less. Index `(customer_id, created_at)` for 'my orders, newest first' (leftmost + sort). I'd avoid indexing every column — each index adds ~10–20% write amplification, and at 1M/day that matters. Push hot analytics to a read replica, and keep the write path to 1–2 indexes per hot table:"

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
"For the transfer path I use `REPEATABLE READ`/`SERIALIZABLE` — a non-repeatable read could double-debit. Cost: more locks and possible serialization failures (Postgres `serialization_failure`, SQLSTATE 40001) under contention, so I keep those txns tiny (just the balance math) and retry on 40001. For read-heavy reporting I drop to `READ COMMITTED` on a replica. The anomaly you can't tolerate dictates the level — you pay for isolation only where the money is:"

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
"I'd query `pg_locks` joined to `pg_stat_activity` for the blocking PID and its statement. Nine times out of ten a long txn holds a row lock while doing a slow external call — the lock lives for seconds instead of ms. Fix: shrink the txn to minimal writes, move the slow work outside it, set `lock_timeout = 2s` so a blocked txn fails fast instead of cascading. I measure lock-wait time before/after:"

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
"When the query is complex (deep joins, window functions, bulk updates) or hot, JPA's generated SQL is opaque and often does N+1. I use `JdbcTemplate`/jOOQ with exactly the columns I need — the SQL is reviewable and the plan is predictable. For CRUD-shaped data, JPA is still the faster dev path; the decision is per-query, not per-project:"

```java
// WRONG: loads the whole entity graph, then a field
Order o = repo.findById(42L).get();  // + lazy collections = N+1
// RIGHT: one projection, one query
String sql = "SELECT status, total FROM orders WHERE id = ?";
return jdbcTemplate.queryForObject(sql,
    (rs, r) -> new OrderView(rs.getString(1), rs.getBigDecimal(2)), id);
```

**Q40. Defend a connection-pool size with Little's Law.**
"`pool ≈ target_concurrency × (avg_query_ms / acceptable_latency_ms)`. At 5 ms avg and 200 concurrent, that's ~200 × (0.005 / 0.1) ≈ 10, padded for variance to ~20–30 — not 200. Oversizing wastes DB connections (each holds a backend process + ~5–10 MB) and can _worsen_ throughput via lock contention. I set `maximumPoolSize` from real numbers, monitor wait time, and tune:"

```java
HikariConfig cfg = new HikariConfig();
cfg.setMaximumPoolSize(30);        // Little's Law ~10, padded to 20–30
cfg.setConnectionTimeout(2000);    // fail fast — don't queue 30 s when the DB is sick
cfg.setValidationTimeout(1000);
cfg.setLeakDetectionThreshold(10_000);  // catches leaked connections in tests
```

**Q41. Partial and expression indexes — where does the index budget go?**
"An index on every column is how write-heavy services die. A **partial index** indexes only the rows a query actually cares about (say 1% of the table): 100× smaller, ~100× cheaper to maintain, same query speed. An **expression index** indexes the function you actually call — `WHERE lower(email) = ?` can't use a plain index on `email`, but can use one on `lower(email)`. Both are how I stay under the ~20% write-amplification budget at scale:"

```sql
-- partial: only the 1% of rows in 'open' status are indexed
CREATE INDEX ix_orders_open ON orders (created_at) WHERE status = 'open';
-- expression: index the function, not the column
CREATE INDEX ix_users_email_lower ON users (lower(email));
SELECT * FROM users WHERE lower(email) = 'dev@example.com';   -- uses it now
```

**Q42. Partitioning — when does it help and when does it backfire?**
"Range partitioning by month pays off when (a) queries filter on the partition key, so pruning skips whole partitions, and (b) you retire data by `DETACH`/`DROP PARTITION` — O(1) metadata work instead of a bloat-and-lock `DELETE`. It backfires below scale: each partition adds planner overhead, and a query that _doesn't_ filter on the key scans every partition. Hash partitioning spreads hot writes across shards but doesn't help range queries. Rule of thumb: partition when the table is >~100 GB or ~100M+ rows, and always put the partition key in the hot predicates:"

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
"Async replicas lag by tens of ms to seconds under load, so a user who just placed an order and then hits a replica may see '0 orders' — the read-your-writes problem. I route the user's own data to the primary for a short window after a write (session affinity), and I monitor `pg_stat_replication` so a lagging replica is taken out of rotation before reports silently skew. Dashboards on replicas must state their staleness budget out loud:"

```sql
-- on the replica, lag = how far behind the primary it is
SELECT replay_lag FROM pg_stat_replication;
-- app-side guard for write-then-read flows:
-- if the request was written by THIS user in the last 5 s → hit the primary
```

**Q44. How do you keep the DB and a message broker consistent?**
"Writing the row and publishing the event in separate transactions is a dual-write: crash between them and you lose the event forever. The **transaction outbox** puts the event in the same DB transaction — atomic by construction — and a poller publishes and deletes it. The event is never lost; it's just delayed by up to the poll interval (~100 ms–1 s), which is a great trade for 'never lose a refund event':"

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
"Optimistic locking (a `@Version` column) costs nothing until commit time: the UPDATE checks the version, and if someone else wrote first, zero rows match and you retry the whole txn. Pessimistic (`SELECT ... FOR UPDATE`) holds the row lock from the read to the commit — correct, but a slow txn parks everyone else. For web traffic, optimistic wins: contention is usually <5% of requests, so a rare retry beats holding locks for the median request's whole lifetime:"

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
"One row, one lock: every update serializes, capping you at ~1–5k updates/s on that row no matter how many app instances you have. For counters (likes, view counts, seats remaining), **shard the row**: split the count across N buckets, write one bucket per request, `SUM` on read. Works only where the total can be slightly stale or where buckets are per-request anyway — never for money, where a single row plus retries is the honest design:"

```sql
-- WRONG: every like hits the same row — one lock, one serialized writer
UPDATE posts SET likes = likes + 1 WHERE id = 9;

-- RIGHT: 64 shards — 64 concurrent writers on the same logical counter
UPDATE post_likes SET n = n + 1
WHERE post_id = 9 AND shard = (random() * 63)::int;   -- pick a bucket
SELECT SUM(n) FROM post_likes WHERE post_id = 9;      -- read = sum of buckets
```

**Q47. Why does a table grow without inserts, and what is bloat?**
"MVCC means an UPDATE is a new row version; the old one becomes a **dead tuple** that only `VACUUM` reclaims. If autovacuum can't keep up (defaults trigger at 20% dead + 50 rows), the table and its indexes bloat: a table that holds 1 GB of live data can occupy 5 GB, and every scan and index walk gets slower for 'nothing'. I watch `pg_stat_user_tables`; when dead tuples exceed ~30% of live, I `VACUUM` (cheap) or `VACUUM FULL`/`pg_repack` (reclaims space, but locks — so schedule it):"

```sql
SELECT relname, n_dead_tup, n_live_tup,
       round(100.0 * n_dead_tup / greatest(n_live_tup, 1), 1) AS dead_pct
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 5;
-- dead > 30% of live → bloat is costing you; VACUUM reclaims the tuples,
-- VACUUM FULL rebuilds the files (ACCESS EXCLUSIVE lock — do it in a window)
```

**Q48. `ALTER TABLE` on a 500M-row table — how do you do it without downtime?**
"The two killers are table rewrites and `ACCESS EXCLUSIVE` locks. Postgres 11+ made `ADD COLUMN ... DEFAULT` metadata-only (~ms, no rewrite) — but `NOT NULL` still scans the table, and an index build still locks writers. The safe sequence: add the column, backfill in batches, add the constraint `NOT VALID`, then `VALIDATE` (a lock-free recheck). For indexes: `CREATE INDEX CONCURRENTLY`, always:"

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
"First suspect: statistics. The planner's `rows` estimate drives every join choice; if a table grew 100× since the last `ANALYZE`, the planner still thinks it has 100k rows and picks a nested loop instead of a hash join — 100× slower. Second: distribution change (a column that was 50/50 is now 99/1). Third: the index itself bled bloat. The drill is never blind tuning — `EXPLAIN (ANALYZE, BUFFERS)` now, compare with the old plan, check `last_analyze`:"

```sql
SELECT relname, last_analyze, last_autoanalyze, n_mod_since_analyze
FROM pg_stat_user_tables WHERE relname = 'orders';
-- n_mod_since_analyze >> 10% of the table → statistics are lying to the planner
ANALYZE orders;   -- refresh stats, then re-EXPLAIN before touching anything
```

**Q50. What is your backup and recovery story — with numbers?**
"Backup strategy is a contract: **RPO** (how much data can I lose) and **RTO** (how long to be back). For Postgres: continuous WAL archiving gives RPO of seconds — a base backup plus every WAL segment, so I can recover to any point in time. Logical dumps (`pg_dump`) of a 1 TB DB take hours, so they're for schema/portability, not disaster recovery. And the non-negotiable: I restore to staging on a schedule and time it — the day we need the backup is not the day to learn how to use it:"

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
