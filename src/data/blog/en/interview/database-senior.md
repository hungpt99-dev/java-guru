---
title: "Senior Java Interview: Database and SQL"
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

The database is the layer that actually decides whether your system scales. Interviewers probe it hard — not for vocabulary, but for whether you've been inside the kitchen. A junior knows the four isolation levels. A senior can narrate the exact trace where a phantom appears, justify a composite index down to the B-tree height, explain why a 50-connection pool outruns a 2000-connection one, and name the one metric that proved the pool — not the database — was last month's bottleneck.

> Mindset: recite facts and you're mid-level. Walk through a tradeoff with real numbers and a production failure mode, and you've earned the "senior" checkbox. Every section below ends with the drill an interviewer actually runs.

## Interview question ladder (Junior → Mid → Senior)

> Drill these out loud. Junior = "do you know the concept"; Mid = "do you know the tradeoffs"; Senior = "can you defend a decision under pressure, with a number and a postmortem."

### Junior — foundations

- **Q: What's the difference between a clustered and a non-clustered index?**
  A: A clustered index _is_ the table — rows are stored in its order (InnoDB's `PRIMARY KEY`), so there's exactly one per table; lookups by PK are one B-tree walk to the row. A non-clustered (secondary) index is a separate B-tree whose leaves point back to the clustered key, so a secondary-index lookup is two hops: index → clustered key → row.

- **Q: Name the four SQL transaction isolation levels.**
  A: Read uncommitted, read committed, repeatable read, serializable — in increasing strictness. They trade concurrency for anomaly prevention.

- **Q: What does a primary key do that a unique constraint doesn't?**
  A: A PK is the clustered key (InnoDB) — it defines physical row order and is non-null + unique. A unique constraint is just a non-clustered uniqueness guarantee; you can have several.

- **Q: What is a foreign key, and what does `ON DELETE CASCADE` do?**
  A: A FK constrains a column to exist in another table's referenced column. `CASCADE` makes deleting the parent delete (or null, with `SET NULL`) the dependent rows — convenient, but a mass delete can lock/cascade harder than you expect.

- **Q: Why does `SELECT *` hurt?**
  A: It pulls every column (more I/O, more network), defeats covering indexes (the index can't satisfy the query alone), and breaks when columns are added/removed. Name the columns you need.

### Mid — tradeoffs & pitfalls

- **Q: Why is `WHERE YEAR(created_at) = 2026` a full scan even when `created_at` is indexed?**
  A: A function on the column hides it from the B-tree, so the optimizer can't do a range seek — it scans every row, applies the function, filters. Rewrite as a raw-column range: `created_at >= '2026-01-01' AND created_at < '2027-01-01'`. Same trap: `LIKE '%x%'`, arithmetic on the column, implicit casts.

- **Q: When is a composite index useful, and what's the leading-column rule?**
  A: Composite indexes serve queries that filter on a _prefix_ of the columns, left to right (the leftmost-prefix rule). `(a, b, c)` helps `WHERE a=?`, `(a,b)=?`, `(a,b,c)=?` but NOT `WHERE b=?` alone. Put the most selective / most-filtered-leading column first, but also the one that benefits equality predicates.

- **Q: N+1 query — what is it and how do you kill it?**
  A: You fetch N parents, then one query per parent for its children = N+1 round trips. Fix: a single `JOIN`/`IN` batch, or `@BatchSize`/`fetch join` in ORM. The tell: latency that never shows in any single slow-query log because each call is ~1 ms.

- **Q: Why is a 2000-connection pool worse than a 50-connection one?**
  A: Connections are a _bounded_ resource the DB must schedule. Past the DB's `max_connections` every new request times out; more connections also mean more context-switch and lock contention on the DB side. Size by Little's law (`TPS × avg_query_time`), not by box core count.

- **Q: Read committed vs repeatable read — what anomaly does each still allow?**
  A: Read committed still allows _non-repeatable reads_ (same row differs between reads in the same txn). Repeatable read still allows _phantom reads_ (a range query returns different rows). Serializable prevents both — at the cost of concurrency (often via range locks / SSI).

### Senior — design & defense

- **Q: Size the connection pool for a service doing 1,000 req/s with 20 ms avg query time. Now what if 10% of calls take 5 s?**
  A: `1000 × 0.02s = 20` connections is the steady-state number; `cores × 10` is a fine starting heuristic and HikariCP defaults to 10. But the 10% at 5 s case needs `1000 × 0.1 × 5 = 500` connections _if_ every slow call holds one — which means a handful of slow queries can exhaust the pool and stall the 90% fast path. The senior move is a _separate_ bounded pool (or timeout + circuit breaker) for the slow path so it can't starve the fast one.

- **Q: "Indexes make everything fast." Defend or refute — with the write-side cost.**
  A: Refute. Every index is maintained on every `INSERT`/`UPDATE`/`DELETE`: more B-tree walks, more page splits, more WAL. A write-heavy table with 8 indexes pays 8× the index-maintenance tax and slower inserts. The defense: index for the queries you actually run; drop the vanity indexes; consider a read replica for heavy analytical reads.

- **Q: A report says "the DB averages 0.1 ms but the app takes 800 ms." Where do you look first?**
  A: The _pool_, not the DB. If the thread pool and connection pool both queue, requests wait in line for a connection while the DB sits idle. Check pool saturation, `connectionTimeout`, and whether `wait` time dwarfs `query` time. The fix is rarely "bigger DB."

- **Q: Walk me through a phantom read appearing in production and how you closed it.**
  A: A batch processes "all unpaid orders," another txn inserts a new unpaid order in the same range mid-batch → the batch misses it (or double-counts on retry). Defense: `REPEATABLE READ`/`SERIALIZABLE` with range locks, or `SELECT … FOR UPDATE SKIP LOCKED` to claim rows atomically so concurrent workers don't collide. Name the isolation level and the lock type.

- **Q: You need to add an index to a 2-billion-row table with zero downtime. How?**
  A: Online/DDL tools (`CREATE INDEX CONCURRENTLY` in Postgres; InnoDB online DDL with `ALGORITHM=INPLACE, LOCK=NONE`) build the index without blocking writes — but they still add load and can take hours at scale; do it in a maintenance window, monitor replication lag, and have a rollback. Never `LOCK=TABLE` on a hot table.

#### Self-check

- [ ] Junior: explain clustered vs non-clustered, the 4 isolation levels, PK vs unique, FK cascade, why `SELECT *` hurts.
- [ ] Mid: rewrite a function-on-column predicate to a range, state the leftmost-prefix rule, kill an N+1, size a pool with Little's law, name the anomaly each isolation level still allows.
- [ ] Senior: defend connection-pool sizing under a slow-query tail, quantify the write-side index cost, trace a phantom-read incident, and add a 2B-row index online without downtime.

## 1. Indexing — where interviews go to die

"Add an index" is the beginner answer. The senior answer explains why the index is three or four B-tree levels tall, which columns go in which order, why the optimizer still refuses to touch it, and what a hot index costs you on every write you didn't plan for.

### B-tree internals and the height math

A B-tree node is a database page — 16 KB in InnoDB (the default; 4/8/32/64 KB are configurable via `innodb_page_size`), 8 KB in Postgres. An internal node stores `(key, child pointer)` pairs, so with a typical key you fit a few hundred of them per page. Height grows logarithmically with fanout:

```
Fanout ~300–700 keys/page, rows ~100–200 bytes in a clustered leaf page:

~1M rows   → height 3   (root + 1 internal level + leaf)
~1B rows   → height 4   (root + 2 internal levels + leaf)
~1T rows   → height 5
```

Why those numbers? A 16 KB leaf page holds on the order of a hundred rows, so 1B rows is ~10M leaf pages. Internal levels divide by the fanout each step: ~10M / 500 ≈ 20K, / 500 ≈ 40, / 500 ≈ 1. That last "1" is the root — total height 4. This is the math behind "indexes feel like magic": four pointer hops to reach any row in a billion-row table, and each hop is one page fetch.

But each hop is a page access with a wildly different cost depending on where the page lives:

```
L1/L2 cache hit    → ~5–15 ns     (the B-tree is effectively free)
RAM / buffer pool  → ~100 ns      (why the working set must fit in memory)
SSD (cold leaf)    → ~0.1–0.5 ms  (three orders of magnitude slower)
Spinning disk      → ~5–10 ms     (four orders of magnitude slower)
```

So a senior's design goal isn't "create an index," it's "**make sure the hot index pages stay in the buffer pool**." A billion-row index you scan once a day is a disk-clearing disaster every time it's touched; a small, hot, covering index is the difference between a 100 ns lookup and a 10 ms one. When an interviewer asks "how do you make this query fast?", the first move is page residency, not index creation.

### WRONG vs RIGHT composite index

The question that separates people: "Here's the query — design the index."

```sql
SELECT id, status, created_at
FROM orders
WHERE customer_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 20;
```

**WRONG — the way most juniors answer:**

```sql
CREATE INDEX idx_orders_status   ON orders(status);          -- useless: 99% of rows are 'paid'
CREATE INDEX idx_orders_customer ON orders(customer_id);     -- right column, forces a filesort
```

`status` is low cardinality: 99% of orders are `'paid'`. The optimizer sees selectivity that bad and either full-scans or uses the index and then filters millions of rows anyway. And the `customer_id` index alone returns that customer's entire order history, which has to be sorted on disk before `LIMIT 20` — a filesort that gets slower as the account ages, then a temp table, then maybe spill to disk.

**RIGHT — equality first, range/ordering last, ordered leaf pages:**

```sql
CREATE INDEX idx_orders_cust_status_created
  ON orders(customer_id, status, created_at DESC);
```

Three rules from the leftmost-prefix principle:

1. **Equality columns first** — `customer_id` and `status` narrow the tree walk with `=` comparisons.
2. **Range/ordering columns last** — a range column is a stopping point; anything after it can't participate in the walk.
3. **Match the `ORDER BY`** — the leaf pages are sorted by `created_at DESC`, so the planner walks them in order and stops after 20 rows. No filesort, no temp table. If you also stop `SELECT`-ing columns that aren't indexed, you get an **index-only scan** — the leaf pages hold everything, and the clustered index (the table itself) is never touched.

```text
EXPLAIN:
type: ref
key: idx_orders_cust_status_created
rows: 20
Extra: Using index condition; Backward index scan
```

The interview drill is reordering the clauses:

```sql
WHERE customer_id = ? AND created_at > ?          -- want (customer_id, created_at)
WHERE status = ? ORDER BY created_at LIMIT 20     -- want (status, created_at)
WHERE created_at > ? ORDER BY created_at LIMIT 20 -- created_at alone, and it's both
```

`(created_at, customer_id)` instead of `(customer_id, created_at)` is the naive order and it is strictly worse — the range on `created_at` stops the walk, so `customer_id` never gets used as a filter. Interviewers love swapping these around; be ready to justify every position.

### When the index betrays you

- **Low cardinality.** An index on `gender` or `is_deleted` can cost more to scan than the table itself; the planner quietly ignores it. When `EXPLAIN` shows the index in use but `rows` is still seven digits, that's your smoking gun — the optimizer is walking an index that filters almost nothing.
- **Functions and implicit casts.** `WHERE lower(email) = ?` renders an index on `email` unusable — the column is transformed before comparison, so the tree can't be walked. Same for `WHERE order_no = 12345` on a `VARCHAR` column: every row gets cast. Fixes: expression indexes in Postgres (`CREATE INDEX ON users(lower(email))`), functional indexes in MySQL 8.0.13+, generated columns in MySQL 5.7+, or — easiest — don't store data that requires casting.
- **Leading wildcard.** `LIKE '%guru'` can't use a prefix index; `LIKE 'guru%'` can walk it. The senior version: full-text index or trigram (`pg_trgm`) when the leading wildcard is non-negotiable.
- **A range or `IN` in the middle of the index.** `(a, b, c)` with `WHERE a = ? AND c = ?` while `b` is a range means `c` only filters inside the fetched `b` range. Column order is a contract; a planner will happily explain it to you if you ask.
- **`NULL`s.** In Postgres, `NULL` sorts first by default and most index types include them; `WHERE x IS NULL` can use an index, but `UNIQUE` indexes treat `NULL`s as distinct (multiple `NULL`s are allowed). In InnoDB, a unique index allows many `NULL`s too — "unique" does not mean "no nulls."
- **`EXPLAIN` estimates lie.** A stale planner guess from outdated statistics sends you down a bad plan. `ANALYZE TABLE` (MySQL) / `ANALYZE` (PG), then re-run. A senior quotes `EXPLAIN ANALYZE` actuals, not the planner's guesses — the "`rows` vs `actual rows`" gap is where slow queries confess.

### The clustered-key trap: UUID vs BIGINT

This is the question that separates people who've seen a production incident from those who've only seen the docs. In InnoDB the clustered index **is** the table, ordered by primary key. Insert a random `UUID` (v4) and you're inserting at a random position in a sorted structure:

```sql
-- WRONG for a hot table: the primary key is the physical row order
CREATE TABLE orders (
  id BINARY(16) PRIMARY KEY,   -- or CHAR(36) with a UUIDv4 string
  ...
);
```

Every insert lands in a random leaf page → page splits, fragmentation, and each random page is a cache miss on read. You pay a double tax: the write fan-out doubles every time the tree re-balances, and the hot head of the index (where a `BIGINT AUTO_INCREMENT` would write) no longer stays in the buffer pool. At high insert rates this is the difference between append-only sequential writes and a disk-write-storm that tanks your p95 latency. Fixes:

- `BIGINT` identity (or `IDENTITY` / sequence) — sequential inserts, hot-tail pages stay cached.
- `UUIDv7` (time-ordered) — the modern "global, but sequential-ish" middle ground; MySQL 9+ has `UUIDv7()`.
- Snowflake-style IDs — sequence-like within a worker, shardable across nodes.

A senior never says "UUIDs are slow" — they say "random UUIDs break clustered-index locality; here's how I measured the page splits and why UUIDv7 fixes it."

### Buffer-pool hit ratio — the number interviewers fish for

InnoDB exposes it directly:

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read_requests';  -- total logical reads
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_reads';          -- actual physical disk reads
```

```
hit_ratio = 1 - (physical_reads / logical_reads)
```

OLTP workloads want a hit ratio above 99%. Below ~95%, your "fast" database is secretly a disk reader — random point reads hitting storage, throughput collapsing, and the fix is usually **the working set not fitting in memory**, not more CPU and not a better index. The classic follow-up: "your working set is 2 TB and the buffer pool is 128 GB — what do you do?" The senior answer starts with "which 10% of the data serves 90% of the reads" — hot-row caching, denormalizing a hot column, or splitting hot vs cold tables — not "buy more RAM." And before you tune anything: `SHOW ENGINE INNODB STATUS` for the transient pool state, and separate **one-shot scans** (reporting, `SELECT COUNT(*)`) from point lookups — a nightly analytics query can drag the hit ratio down while your real workload is fine.

## 2. Transactions & isolation — anomaly forensics

Reciting the four levels is the mid-level answer. The senior answer is the traces — the one anomaly textbooks skip, the lock that blocks your queue, and the MVCC internals that explain why two databases disagree about REPEATABLE READ.

### The matrix, plus the gotcha nobody says out loud

- **Dirty read** — prevented at READ COMMITTED.
- **Non-repeatable read** — prevented at REPEATABLE READ.
- **Phantom read** — standard SQL permits it under REPEATABLE READ, but **InnoDB prevents it anyway** using next-key locks, and Postgres REPEATABLE READ (snapshot isolation) never shows phantoms on reads either.

So when the interviewer asks "which isolation level prevents phantom reads?", the textbook answer is SERIALIZABLE, and it's a trap. Under InnoDB, REPEATABLE READ already does, because every _locking_ read under RR takes next-key locks (row + gap). And here's the part that makes senior candidates win the follow-up: **InnoDB's REPEATABLE READ and Postgres's REPEATABLE READ are different animals.**

- **InnoDB RR** = MVCC consistent reads + next-key locks on locking reads/DML. Phantoms are blocked for _locking_ operations by gap locks.
- **Postgres RR** = pure snapshot isolation (MVCC, SSI-style). There are **no gap locks at all**, so locking reads never block on "rows that don't exist yet" — phantoms are avoided for _reads_ by the snapshot, but two `SELECT ... FOR UPDATE` on a gap never block each other.

Both engines, though, share the same hole: **write skew survives REPEATABLE READ** in both, because the reads that matter are _non-locking_ reads — see below.

### MVCC internals — the layer under the answer

You can't narrate isolation anomalies without knowing what a "consistent read" actually is. In InnoDB:

1. Every row carries hidden columns: a transaction ID and a roll pointer to the **undo log**.
2. An `UPDATE` doesn't overwrite the row — it writes a **new version** and points the old one into the undo log (the version chain).
3. A transaction's first read in RR creates a **read view** — a snapshot of "which transactions were committed before I started."
4. A read walks the version chain and returns the newest version visible to the snapshot. Everyone reads their own private history of the table, so readers never block writers and writers never block readers.

That last point is the whole reason you see `MVCC` in every job description: "readers don't block writers." The tradeoff nobody volunteers is that every version you keep **costs disk and CPU**, and long transactions freeze the garbage collector:

- InnoDB: undo log purge can't reclaim versions a long-running transaction might still read. `SHOW ENGINE INNODB STATUS` → watch the **history list length**. It climbs, the undo tablespace grows, and one 30-minute reporting transaction can silently double your disk usage.
- Postgres: old row versions stay as **dead tuples**, and autovacuum falls behind. The table bloats, and your index scans get slower _even when they return one row_ — because the pages are full of ghosts.

The production failure mode interviewers probe: "a nightly batch transaction ran for 45 minutes, and the next morning writes were slow." Senior answer: the read snapshot held the purge/vacuum back, the undo/dead-tuple list grew, page writes slowed down, and _short_ transactions that should have been 10 ms started stalling on buffer replacement. The fix is usually **shorter transactions** (commit in batches), not bigger hardware.

### Phantom read trace (under READ COMMITTED)

```
T1: BEGIN;
T1: SELECT COUNT(*) FROM shifts WHERE day = 'Monday';     -- 5

T2: BEGIN;
T2: INSERT INTO shifts(day) VALUES ('Monday'); COMMIT;

T1: SELECT COUNT(*) FROM shifts WHERE day = 'Monday';     -- 6  ← phantom
```

The set of rows changed under T1's feet. Note the difference between RC and RR here: under **READ COMMITTED** each statement gets a fresh read view, so T1's second `COUNT` sees T2's committed insert — phantoms and non-repeatable reads both appear. Under **REPEATABLE READ** the read view is fixed at the first read, so both counts return 5 (that's _why_ RR "prevents" it for reads). If you can narrate _why_ the level changes the result — a fresh read view per statement vs per transaction — you're speaking engine, not exam.

You fix it with SERIALIZABLE or explicit locks — and you pay with concurrency. That cost is the tradeoff interviewers want to hear you name: **isolation level is a latency/throughput dial, not a safety checkbox.**

### Lost update and write skew — the senior territory

Lost update is the easy one, fixed with a version column (optimistic locking):

```sql
UPDATE accounts SET balance = balance - 100, version = version + 1
WHERE id = ? AND version = ?;
-- 0 rows affected => someone moved first => retry or reject
```

The anomaly that actually bites in interviews (and production) is **write skew**: two transactions each read overlapping state, neither blocks the other because they write _different_ rows, and the invariant silently dies.

```
T1: BEGIN;
T1: SELECT COUNT(*) FROM doctors WHERE on_call = true;   -- 1, limit is 1

T2: BEGIN;
T2: SELECT COUNT(*) FROM doctors WHERE on_call = true;   -- 1, limit is 1

T1: UPDATE doctors SET on_call = true WHERE id = 101;    -- ok, "still one" per my read
T2: UPDATE doctors SET on_call = true WHERE id = 102;    -- ok, "still one" per my read
-- COMMIT × 2  →  now TWO doctors are on call. Invariant violated.
```

No dirty read, no lost update — the snapshot is consistent to each transaction, and the constraint still breaks. This is the one anomaly that survives REPEATABLE READ in **both** InnoDB and Postgres, because the `SELECT COUNT(*)` was a _non-locking_ MVCC read: neither transaction took a lock the other could wait on. The fixes:

```sql
-- PESSIMISTIC: lock the examined rows, so T2 blocks until T1 commits
SELECT COUNT(*) FROM doctors WHERE on_call = true FOR UPDATE;

-- Or serialize the whole read-modify-write on a single guard row
SELECT ... FROM doctor_schedule WHERE id = ? FOR UPDATE;

-- QUEUE USE-CASE: don't wait at all
SELECT ... FOR UPDATE SKIP LOCKED;   -- claim one task, ignore the locked ones
```

- **Pessimistic (`FOR UPDATE`)** — T1's locking read holds next-key locks; T2 blocks until T1 commits, then re-reads and sees two already on call → rejects. Correct, but you serialize all on-call changes.
- **Optimistic (version column)** — both bump versions, the loser's `UPDATE` returns 0 rows, the app retries.
- **Postgres SERIALIZABLE (SSI)** — the engine detects the read-write dependency at commit time and **aborts one transaction** with `40001 serialization_failure`. The app _must_ catch and retry; if you don't retry, you're turning serializable into data loss.

If you can produce this trace unprompted, name the non-locking-read root cause, and give the pessimistic + optimistic + SSI fix triad, you've cleared the highest bar in this section.

### Deadlocks — the follow-up that always lands

Right after write skew, interviewers pivot to: "you deploy, and suddenly `DeadlockLoserDataAccessException` in the logs." The senior answer is not "add retries" — it's "read the deadlock report."

- **InnoDB detects deadlocks** and rolls back the transaction that did less work (fewer undo bytes). `SHOW ENGINE INNODB STATUS` prints the two transactions, the exact locks held, and the SQL that blocked.
- **The pattern**: T1 locks row A then wants row B; T2 locks row B then wants row A. Same lock _order_ across every transaction is the fix — sort your `WHERE id IN (...)` keys, lock parent before child.
- **`NOWAIT` / `SKIP LOCKED`** are your escape hatches for queue-consumer patterns; a job queue that _waits_ on locked rows will deadlock itself to death under load.

```java
// WRONG: deadlock → exception → transaction rolled back → job lost
try {
    doTransfer(a, b);
} catch (DeadlockLoserDataAccessException e) {
    // swallowed: money moved once, or not at all — we don't know
}

// RIGHT: bounded exponential backoff retry, and idempotency on the write
int retries = 0;
while (retries < 3) {
    try {
        doTransfer(a, b);            // update is idempotent via a unique txn_id
        break;
    } catch (DeadlockLoserDataAccessException e) {
        retries++;
        Thread.sleep(50L << retries);   // 100ms, 200ms, 400ms
    }
}
```

## 3. Connection pooling — the difference between 2000 and 50 connections

The HikariCP sizing heuristic `connections ≈ ((core_count * 2) + effective_spindle_count)` is a starting guess, and every senior knows it's a starting guess. The defensible number comes from Little's law:

```
Little's law:  in-flight work  =  arrival rate  ×  time each request holds the resource

pool_size = requests_per_second × seconds_a_connection_is_checked_out
500 req/s × 0.05 s = 25 connections
```

Run that math and you won't be the person who sizes a pool at 200 because the box has 64 cores. And here's the two numbers that make the section title concrete: a single connection can comfortably execute **on the order of a thousand short transactions per second** (a 1 ms query ~ 1000/s; a 10 ms query ~ 100/s). So a pool of 50 connections is not "50 concurrent users" — it's on the order of **50,000 short TPS**, which is more than most services ever see. A pool of 2000 is not 40× more throughput; it's 2000 threads waiting on a database that can service only a fraction of them.

The subtlety that trips up even strong candidates: **the connection is held for the whole checkout, not the query.** If your request checks out a connection, runs query A, does 100 ms of business logic in Java, then runs query B, the pool must cover the _full_ 150 ms. Little's law with the wrong W (query time instead of transaction time) produces a pool that's 3× too small and queues at the DB — the exact failure you're trying to avoid.

- **Too large** → context-switch thrash, hundreds of MB of idle connections on the DB side (MySQL thread-per-connection: every idle connection is a thread + stack + buffers), and queueing _inside_ the database.
- **Too small** → requests queue at `connectionTimeout`, latency climbs, then throughput collapses — the "pool is the bottleneck, not the DB" incident.
- **Non-blocking R2DBC**: threads never block on I/O, so a pool of 10–20 connections is plenty — the pool is sized to concurrency, not load.

### Production failure modes, because interviewers ask about incidents

- **Leaked connections.** `getConnection()` without a release and the pool exhausts → `Connection is not available, request timed out` → every request piles up → outage. This is the classic "DB seems down but it's fine, the pool is empty" incident. Fix with try-with-resources and `leakDetectionThreshold` so the pool tells you before customers do.
- **`maxLifetime` vs server timeout.** MySQL's `wait_timeout` defaults to 8 hours; if your pool holds a connection past it, the server silently kills it and you get `Communications link failure`. Pool `maxLifetime` must be below the server's idle timeout. The inverse: a pool's `connectionTimeout` (default 30 s in HikariCP) is how long a request _waits_ for a free connection — if you see timeouts, check queueing before you check the DB.
- **`minimumIdle` = `maximumPoolSize` is fine for hot services**, but for bursty ones the pool should be able to drain idle connections; tune `idleTimeout` so a spike doesn't leave 200 sockets parked for the afternoon.
- **Turn on diagnostics:** `leakDetectionThreshold`, `connectionTimeout`, `validationTimeout`, and JDBC4's `isValid()` (not a `SELECT 1` round-trip) are not optional in production. Watch `active` vs `idle` in the Hikari metrics — a pool that is permanently `active` at max is a queue in disguise.

```java
// WRONG: one exception in the middle and the connection is gone forever
Connection c = pool.getConnection();
Statement s = c.createStatement();
s.execute("UPDATE accounts SET balance = balance - 100 WHERE id = ?");
c.close();  // never reached if execute throws → leak → pool exhaustion

// RIGHT: try-with-resources guarantees release on every path
try (Connection c = pool.getConnection();
     PreparedStatement ps = c.prepareStatement(
         "UPDATE accounts SET balance = balance - ? WHERE id = ?")) {
    ps.setBigDecimal(1, amount);
    ps.setInt(2, accountId);
    ps.executeUpdate();
}
```

And the ORM tie-in that closes the loop: if you're on Spring Boot and you left Open Session in View on, your pool is being held hostage — more in section 5.

## 4. SQL vs NoSQL — decide on access pattern + consistency, not hype

Saying "NoSQL is faster" costs you the interview. The honest framing: each store offers a different contract of consistency, flexibility, and scale, and the choice is a tradeoff, not a speed race. Interviewers want to hear you ask the three questions _before_ you name a technology:

1. **What is the access pattern?** — point lookups by key, range scans, joins, aggregations, append-only?
2. **What consistency contract does the business need?** — read-your-writes for a cart is different from eventual for analytics.
3. **What is the write/read ratio and the cardinality of the hot key space?**

- **Relational (Postgres/MySQL)** — joins, transactions, referential integrity, and the ability to `EXPLAIN` your way out of a performance hole. The default when data has relationships and money moves. Modern Postgres blurs the line: `jsonb` gives you a document store with `GIN` indexes and a real query planner.
- **Document (MongoDB)** — flexible schema and horizontal scale, but server-side joins are limited (`$lookup` is an aggregation-stage pipeline cost that gets expensive fast), documents cap at 16 MB, and a bad shard key produces **hot shards** that cap throughput no matter how many nodes you add. A shard key must spread writes AND match your reads — "everyone queries by `customer_id`, so shard on `customer_id`" is the senior answer; sharding on `created_at` makes all recent writes land on one shard.
- **Wide-column (Cassandra)** — write-anywhere log-structured design (LSM) for write-heavy scale, with tunable consistency. QUORUM on RF=3 means two nodes must agree; **eventual consistency is fine for telemetry and dangerous for ledgers**. Reads are the expensive part — a read does a merge across memtables and SSTables, so "Cassandra is fast" means _fast writes_, and your read path is where the surprises live.
- **Redis** — a cache/counter/pub-sub with RAM durability assumptions, not a durable store. Single-threaded core, so a few 10k-ops/s at the p99 — pipelining matters more than you think. If you claim it's your source of truth, be ready to defend AOF + fsync tradeoffs (fsync every write → a few thousand ops/s; fsync every second → you can lose a second of data on crash) and the eviction policy (`allkeys-lru` vs `volatile-lru`) that makes or breaks a cache.

And the nuance that lands well: Postgres `jsonb` blurs the relational/document line — you can have a schema for the money columns and a JSON document for the flexible ones, with indexes into the JSON. "I'd store the order lines as a relational table and the supplier's vendor-specific metadata as jsonb" beats "I'd use MongoDB" in most backend interviews. The honest NoSQL-for-a-reason answers: append-only event logs and telemetry → Cassandra/ClickHouse; per-user mutable profiles with hot rows → Redis + relational; document-ish flexible data that needs real queries → Postgres `jsonb`.

## 5. N+1 and the ORM trap

The beginner answer is "use JOIN FETCH." The senior answer is "use JOIN FETCH, then know where it breaks, then measure the SQL the ORM actually runs."

**The classic:**

```java
// WRONG: 1 query for the parents + 1 query per child = N+1
List<Order> orders = orderRepository.findAll();
for (Order order : orders) {
    order.getLineItems().size();   // lazy-load fires here, once per order
}
```

1,000 orders → 1,001 queries. With 10 rows it's invisible; with 10 million it melts the database. That "works with 10, dies with 10M" is the exact curve interviewers love to ask about. Then they ask you to _prove_ it exists in production without an IDE — and the senior answer is `format_sql` + timing (`slow_query_log` in MySQL, `auto_explain` in Postgres showing `1,001` sequential queries), or just watching the DB's query counter jump by exactly one per parent row.

**RIGHT — fetch the graph in one statement:**

```java
// Hibernate
List<Order> orders = em.createQuery(
    "select distinct o from Order o join fetch o.lineItems", Order.class)
    .getResultList();

// Spring Data
@Query("select o from Order o join fetch o.lineItems")
List<Order> findAllWithItems();
```

Alternatives with their own tradeoffs: `@BatchSize` (batch fetching: `1 + ceil(N/1000)` queries instead of `1 + N` — right when the parent list is large and a join would explode into a cartesian product), entity graphs/`@EntityGraph` for per-use-case fetch strategies, or — the most senior move — skip the entities entirely and **project a DTO** with the exact columns the page needs:

```java
@Query("""
    select new com.acme.dto.OrderItemDTO(o.id, o.status, l.sku, l.qty)
    from Order o join o.lineItems l
    where o.customerId = :customerId
    """)
List<OrderItemDTO> findForCustomer(long customerId);
```

One query, no managed entities, no lazy traps, and the smallest row payload. If you can explain _when to stop using JOIN FETCH and project instead_ — that's the senior inflection point.

**Where JOIN FETCH betrays you — the senior-only gotcha.** Paginate a query that fetch-joins a `Collection` and Hibernate can't apply `LIMIT` in SQL, because the join multiplies rows. It falls back to **in-memory pagination** — the whole result set loaded, then truncated in the JVM. The log line is `HHH000104: firstResult/maxResults specified with collection fetch; applying in memory!` — and your "page 2" is now silently wrong and your DB is suddenly doing the work of a full scan. Fix: fetch the IDs on page 1 first, then fetch children for those IDs in a second query, or paginate a DTO projection instead.

**The OSIV trap — Spring Boot's hidden default.** `spring.jpa.open-in-view` defaults to **true**, and Spring Boot logs a warning every time it boots. OSIV keeps the EntityManager (and its JDBC connection) open for the **entire HTTP request**, even after your transaction commits. Two consequences: lazy loads anywhere in the request (including serializers and template rendering) "just work" — hiding the N+1 — and your connection pool is held open for the full request duration, which means **your pool sizing math from section 3 is now off by the width of your slowest endpoint**. Senior play: turn OSIV off (`spring.jpa.open-in-view: false`), handle lazy loading inside the transaction (or fetch eagerly), and let the pool release connections the moment business logic finishes. The first thing you'll hit with OSIV off is `LazyInitializationException` from a serializer — and that's a feature, not a bug: it's the framework finally telling you where the N+1 is.

And the meta-skill underneath all of this: **read the generated SQL.** Enable `spring.jpa.properties.hibernate.format_sql=true` or wire in p6spy, and check that what you _think_ you wrote is what the ORM _actually_ executes. A senior treats the ORM as a code generator with opinions, not as a black box — and knows that `@Cacheable`/second-level cache is a _last_ resort for hot, rarely-changing shared data, because invalidation across nodes is where caches quietly go stale.

## 6. Self-check

- [ ] Design a composite index for `WHERE customer_id = ? AND status = ? ORDER BY created_at` and justify the column order — down to the leftmost-prefix rule and the `DESC` leaf order.
- [ ] Explain why a `UUIDv4` primary key is a clustered-index disaster and what `UUIDv7` changes.
- [ ] Which anomaly does the _standard_ REPEATABLE READ permit, why does InnoDB still prevent it for locking reads, and why does Postgres's RR behave differently?
- [ ] Produce a two-transaction write-skew trace and the pessimistic + optimistic + SSI fix triad.
- [ ] Read a deadlock out of `SHOW ENGINE INNODB STATUS` and write the retry loop.
- [ ] Size a connection pool from throughput and hold-time with Little's law — and explain why "hold time" isn't query time.
- [ ] Find and fix the N+1 in a snippet, then explain the fetch-join pagination gotcha and the OSIV trap.
- [ ] Name the two status variables that compute the InnoDB buffer-pool hit ratio and the first move when it drops.

## 7. Interviewer follow-ups

When your first answer lands, they start drilling. Be ready for these:

- "The query returns 40M rows — would the index still be used, and would it be the right shape?"
- "Why did the optimizer ignore my index on `status` even though `EXPLAIN` shows it?"
- "Your working set doesn't fit in the buffer pool. What's your first move?"
- "Would SERIALIZABLE have stopped the write skew? What does it cost — and who's responsible for the retry?"
- "You see `Connection is not available, request timed out` at 100 req/s with a pool of 25. What's the math, and what do you check first?"
- "When would you still choose MySQL over Postgres, or Postgres over MongoDB — and what does `jsonb` change?"
- "How do you prove an N+1 exists in production without opening an IDE?"
- "Your long-running read transaction is slowing down all writes. Where does the bloat live, and what do you change?"
- "A job queue keeps deadlocking under load. What's the first thing you change — and why `SKIP LOCKED`?"
- "Explain why Postgres `SERIALIZABLE` can abort a transaction that already committed a logically-valid write."

That's the database bar.
