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

The database is the layer that actually decides whether your system scales. Interviewers probe it hard.

## 1. Indexing is non-negotiable

- **B-tree vs hash:** range queries need B-tree.
- **Composite index column order:** most selective / equality-first, range-last. `WHERE a=? AND b>?` wants `(a,b)`, not `(b,a)`.
- **Covering indexes** avoid a table lookup.
- **Trap:** a query "using an index" but still scanning millions of rows (low cardinality, functions on the column, implicit casts). Read `EXPLAIN`.

## 2. Transactions & isolation

- **Levels:** read uncommitted / committed / repeatable read / serializable.
- **Read types prevented:** dirty / non-repeatable / phantom — know which level blocks which.
- **Lost updates** — prevent with `SELECT ... FOR UPDATE`, optimistic locking via a version column, or `SERIALIZABLE`.
- **MVCC:** readers don't block writers (Postgres/InnoDB). That's why "my read locked the table" is usually a misunderstanding.

```sql
UPDATE accounts SET balance = balance - 100, version = version + 1
WHERE id = ? AND version = ?;
-- 0 rows => someone moved first => retry or reject
```

## 3. Connection pooling

The pool is a shared, scarce resource. HikariCP sizing heuristic: `connections ≈ ((core_count * 2) + effective_spindle_count)` — but the real answer is "measure under load." Too large → context-switch thrash; too small → queueing.

## 4. SQL vs NoSQL — the real decision

Don't say "NoSQL is faster." Pick the model that fits the access pattern: document (MongoDB) for flexible schema, wide-column (Cassandra) for write-heavy scale, relational (Postgres) when you need joins/transactions/integrity. Redis is a cache/counter/pub-sub, not a durable store.

## 5. N+1 and the ORM trap

- **N+1:** lazy loading inside a loop. Fix with `JOIN FETCH` / entity graphs / batch fetching.
- **Know the generated SQL.** A senior reads it. "Works" with 10 rows and dies with 10M is classic.

## 6. Self-check

- [ ] Pick a composite index for a given query and justify order.
- [ ] Which isolation level prevents phantom reads?
- [ ] Optimistic vs pessimistic locking with SQL.
- [ ] Find and fix an N+1 in a snippet.

That's the database bar.
