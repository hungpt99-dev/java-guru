---
title: "Java Interview Prep #4: Database and SQL"
description: "A practical database and SQL interview guide covering joins, constraints, transactions, aggregation, SQL injection, and the trade-offs behind common schema and query decisions."
pubDatetime: 2026-08-10T10:15:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - database
  - sql
---

Database questions are rarely about memorizing SQL syntax. The difficult part is explaining what the database guarantees, what a query costs, and where an application design can fail under concurrency or load. This guide covers the foundational questions in the supplied set, with SQL and JDBC examples. It separates established database behavior from analysis and design recommendations.

## Junior: foundations

**Q1. What are a primary key, a foreign key, and an index?**

**[SOURCE FACT]** A primary key identifies a row and is enforced as unique and non-null. A foreign key references a key in another table and enforces referential integrity. An index is an additional data structure, commonly a B-tree, that can reduce the work needed for lookups and filtering. It also adds storage and write-maintenance cost.

**[ANALYSIS]** A foreign key does not generally create an index on the child column. Indexing that column is often important when the application joins by it or when the database checks child rows while updating or deleting a referenced parent. The right choice depends on the engine and workload; do not treat an index as automatically beneficial.

```sql
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  total DECIMAL(19,4) NOT NULL
);

CREATE INDEX ix_orders_customer ON orders (customer_id);
```

**Q2. What is the difference between `INNER JOIN` and `LEFT JOIN`?**

**[SOURCE FACT]** `INNER JOIN` returns rows for which the join condition matches on both sides. `LEFT JOIN` returns every row from the left table and fills the right-side columns with `NULL` when there is no match.

**[ANALYSIS]** A join can return multiple rows for one left-side row. That is expected when the relationship is one-to-many. Use `DISTINCT` or aggregation only when that is the intended result, not as a way to hide an incorrect join.

```sql
-- Excludes users who have no orders.
SELECT u.name, o.id
FROM users u
JOIN orders o ON o.user_id = u.id;

-- Keeps every user and returns NULL for users without an order.
SELECT u.name, o.id
FROM users u
LEFT JOIN orders o ON o.user_id = u.id;
```

**Q3. What is the difference between `WHERE` and `HAVING`?**

**[SOURCE FACT]** `WHERE` filters input rows before grouping. `HAVING` filters groups after `GROUP BY`. Aggregate expressions such as `COUNT(*)` belong in `HAVING`, not `WHERE`.

**[ANALYSIS]** Filtering before aggregation can reduce the amount of data that must be grouped and may allow the optimizer to use an appropriate index. The actual plan still depends on the database engine, statistics, and available indexes.

```sql
-- Invalid: the aggregate is evaluated at the grouping stage.
SELECT user_id, COUNT(*)
FROM orders
WHERE COUNT(*) > 1
GROUP BY user_id;

-- Valid.
SELECT user_id, COUNT(*)
FROM orders
GROUP BY user_id
HAVING COUNT(*) > 1;
```

**Q4. What is a transaction, and what does ACID mean?**

**[SOURCE FACT]** A transaction groups operations into a unit with all-or-nothing commit behavior. ACID means Atomicity, Consistency, Isolation, and Durability. Together, these properties describe how the database applies a transaction, preserves valid states, controls the visibility of concurrent work, and preserves committed data across a failure. The exact guarantees depend on the database and isolation level.

**[ANALYSIS]** A transfer should debit one account and credit the other in the same transaction. A transaction does not make arbitrary business logic correct: constraints, locking, isolation, and error handling still need to match the invariant being protected.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT; -- ROLLBACK if a required operation fails.
```

**Q5. What is the difference between `COUNT(*)`, `COUNT(col)`, and `COUNT(DISTINCT col)`?**

**[SOURCE FACT]** `COUNT(*)` counts rows. `COUNT(col)` counts non-`NULL` values in the selected column. `COUNT(DISTINCT col)` counts distinct non-`NULL` values.

**[ANALYSIS]** These expressions answer different questions and should not be substituted casually in reports. A count over a large table can require substantial work unless the engine can use a suitable index or another optimized plan. Measure the plan instead of assuming that `COUNT(*)` is cheap.

```sql
SELECT COUNT(*) FROM orders;                         -- rows
SELECT COUNT(shipped_at) FROM orders;                -- non-NULL dates
SELECT COUNT(DISTINCT customer_id) FROM orders;      -- unique customers
```

**Q6. Why should money not be stored as `FLOAT`?**

**[SOURCE FACT]** Binary floating-point cannot represent many decimal fractions exactly. Arithmetic can therefore produce rounding differences, which is unsafe for values that must reconcile in a ledger.

**[PROPOSED DESIGN]** Use a fixed-precision decimal type such as `DECIMAL(19,4)`, or store integer minor units when that matches the domain. Keep the representation consistent through JDBC and Java; do not convert a decimal amount to `double` in the application.

```sql
-- Prefer a fixed-precision representation for decimal amounts.
amount DECIMAL(19,4);
```

```java
// Keep the value as BigDecimal across the JDBC boundary.
BigDecimal total = rs.getBigDecimal("amount")
    .setScale(2, RoundingMode.HALF_EVEN);
```

**Q7. What is the difference between `UNIQUE` and `PRIMARY KEY`?**

**[SOURCE FACT]** A primary key is a table's identity constraint and is unique and non-null. A table has one primary key constraint, but it can have multiple unique constraints. In PostgreSQL, ordinary unique constraints allow multiple `NULL` values because `NULL` is not considered equal to another `NULL`.

**[ANALYSIS]** If the requirement is one non-null email per user, make the column `NOT NULL` and unique. If the requirement is also at most one missing email in the whole table, that is a separate rule and needs a separate constraint. A partial unique index on `email WHERE email IS NOT NULL` does not enforce the latter; it only enforces uniqueness among non-null emails.

```sql
CREATE TABLE users (
  email TEXT
);

-- PostgreSQL: an ordinary UNIQUE constraint also permits multiple NULLs.
CREATE TABLE nullable_users (
  email TEXT UNIQUE
);
INSERT INTO nullable_users VALUES (NULL), (NULL);

-- Enforce uniqueness for present emails.
CREATE UNIQUE INDEX users_email_not_null
ON users (email)
WHERE email IS NOT NULL;

-- If the domain requires at most one NULL as well, use a separate
-- database-specific constraint or design that rule explicitly.
```

**Q8. What is the difference between `DELETE`, `TRUNCATE`, and `DROP`?**

**[SOURCE FACT]** `DELETE` removes rows and can use a predicate. It is row-level DML and may fire applicable triggers. `TRUNCATE` removes all rows as a bulk table operation and does not support a row filter. `DROP` removes the table definition and its dependent objects according to the database's rules.

**[ANALYSIS]** These operations have different locking, transaction, trigger, identity-reset, and replication behavior across database engines. Choose based on the required semantics, not on an assumed universal speed difference. For a large selective delete, plan for index usage, lock duration, and table maintenance.

```sql
DELETE FROM logs WHERE created_at < DATE '2024-01-01';
TRUNCATE logs;
DROP TABLE logs;
```

**Q9. What is SQL injection, and how does `PreparedStatement` prevent it?**

**[SOURCE FACT]** SQL injection occurs when untrusted input is concatenated into SQL text and is then interpreted as part of the statement. A parameterized query sends the SQL structure separately from the parameter values, so the value is handled as data rather than SQL syntax.

**[PROPOSED DESIGN]** Bind every user-controlled value with a parameter. Do not build a query by concatenating input. Parameters do not replace authorization, validation, or careful handling of dynamic identifiers such as a column name; identifiers need an allowlist because they cannot be bound as ordinary values.

```java
String sql = "SELECT id, email FROM users WHERE email = ?";
try (PreparedStatement statement = connection.prepareStatement(sql)) {
  statement.setString(1, emailFromRequest);
  try (ResultSet result = statement.executeQuery()) {
    // Read the result normally.
  }
}
```
