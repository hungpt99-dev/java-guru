---
title: "Ôn thi Java #4: Database & SQL — Junior đến Senior"
description: "Tầng database quyết định scale thực tế. Ứng viên senior phải nói lưu loát về indexing, transaction isolation, connection pooling, và cái bẫy ORM — với SQL thật, không chỉ prose."
pubDatetime: 2026-08-10T10:15:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - database
  - sql
---

Database là nơi "chạy trên máy tôi vẫn ok" chết. Junior viết `SELECT *` và thắc mắc tại sao prod chậm; senior show được `EXPLAIN` chính xác chứng minh tại sao query quét tuần tự và index nào sửa nó. Bài này leo từ join đến isolation anomaly đến pool exhaustion — với SQL bạn thực chạy được.

> Mindset: junior viết query trả đúng rows; senior viết query trả đúng rows _và_ không gục site ở 10x traffic — và chứng minh bằng `EXPLAIN ANALYZE`.

## Junior — nền tảng

**Q1. Primary key, foreign key, và index là gì?**
Primary key định danh duy nhất một row (ép unique + not null). Foreign key tham chiếu PK ở bảng khác, ép referential integrity. Index là B-tree tăng tốc lookup với giá write overhead. Không index, `WHERE` quét tuần tự — trên bảng 10M row là ~10M row read (~hàng trăm ms đến giây); có index là ~4 B-tree level (~4 random read, ~0.5 ms).

**Q2. Khác nhau giữa `INNER JOIN` và `LEFT JOIN`?**
`INNER JOIN` chỉ trả row khớp; `LEFT JOIN` trả mọi row trái với cột phải tương ứng hoặc NULL. Bug kinh điển — dùng `INNER` khi cần orphan làm mất data thầm:

```sql
-- WRONG: drop user không có order
SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = u.id;
-- RIGHT: giữ mọi user, NULL khi không có order
SELECT u.name, o.id FROM users u LEFT JOIN orders o ON o.user_id = u.id;
```

**Q3. Khác nhau giữa `WHERE` và `HAVING`?**
`WHERE` filter row trước group; `HAVING` filter group sau `GROUP BY`. Không dùng aggregate trong `WHERE` — syntax error:

```sql
-- WRONG
SELECT user_id, COUNT(*) FROM orders WHERE COUNT(*) > 1 GROUP BY user_id;
-- RIGHT
SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1;
```

**Q4. Transaction và ACID là gì?**
Transaction gộp operations thành all-or-nothing. ACID: **A**tomicity, **C**onsistency, **I**solation, **D**urability. Một transfer: debit A và credit B phải cùng commit hoặc cùng rollback — không bao giờ để tiền biến mất.

**Q5. Khác nhau `COUNT(*)`, `COUNT(col)`, `COUNT(DISTINCT col)`?**
`COUNT(*)` đếm row (kể cả NULL); `COUNT(col)` đếm non-NULL; `COUNT(DISTINCT col)` đếm unique non-NULL. Trên bảng 1M row, trộn lẫn chúng đổi số của bạn thầm lặng.

**Q6. Tại sao không lưu tiền bằng `FLOAT`?**
Binary float không biểu diễn decimal exact (0.1 + 0.2 ≠ 0.3), gây rounding drift làm ledger không reconcile. Dùng `DECIMAL(19,4)` hoặc lưu integer minor units (cents):

```sql
-- WRONG: never
amount FLOAT;
-- RIGHT
amount DECIMAL(19,4);   -- 19 digits, 4 sau dấu phẩy
-- hoặc app code: lưu BIGINT cents, format chỉ ở edge
```

## Mid — tradeoff & điểm mù

**Q1. B-tree index hoạt động ra sao, và khi nào vô dụng?**
B-tree giữ row sort theo cột indexed, nên equality/range scan O(log n) thay vì O(n). Với 1B row B-tree sâu ~4 level — ~4 random read (~0.5 ms mỗi cái) tìm một row, so với full scan 1B row (~hàng chục giây). Vô dụng khi predicate bọc cột trong function (không dùng được index) hoặc unselective trả >~20–30% row (planner thích scan):

```sql
-- WRONG: function trên column -> index created_at KHÔNG dùng
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- RIGHT: range mà index phục vụ
SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

**Q2. Composite index và leftmost-prefix rule?**
`(a, b, c)` sort theo a, rồi b, rồi c. Phục vụ query filter `a`, `(a,b)`, hoặc `(a,b,c)` — nhưng KHÔNG `b` hay `c` một mình. Sort theo selectivity. Thứ tự sai = dead index:

```sql
-- index: (customer_id, created_at)
SELECT * FROM orders
 WHERE customer_id = 42 ORDER BY created_at DESC;   -- dùng index ✓
SELECT * FROM orders WHERE created_at > '2024-01-01'; -- bỏ qua index ✗ (không leftmost a)
```

**Q3. Isolation level và anomaly?**

- **Read committed**: không dirty read; non-repeatable read có thể.
- **Repeatable read**: nhất quán trong txn; phantom có thể.
- **Serializable**: fully isolated, như chạy serial — an toàn nhất, chậm nhất (có thể 5–10× chậm hơn read committed dưới contention).
  Hầu hết engine mặc định read committed (Postgres repeatable read). Isolation cao = ít anomaly = nhiều lock.

**Q4. Deadlock và tránh thế nào?**
Hai txn mỗi cái giữ lock cái kia cần. DB phát hiện và rollback một (Postgres `40P01`). Tránh bằng truy cập resource theo **thứ tự global nhất quán** và giữ txn ngắn:

```sql
-- Cả hai service update account; LUÔN update theo id tăng để tránh cross-deadlock
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- id thấp trước
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- rồi id cao
COMMIT;
```

**Q5. N+1 problem và fix thế nào?**
ORM load N parent, rồi issue N query con. Tại N=1000 đó là 1001 round-trip (~mỗi 1–5 ms → ~1–5 s thêm). Fix bằng join hoặc batch fetch:

```sql
-- WRONG (N+1): 1 query orders, rồi 1 query mỗi order cho items
SELECT * FROM orders WHERE user_id = 42;
SELECT * FROM order_items WHERE order_id = ?;   -- lặp 1000x
-- RIGHT: 1 query, mọi items
SELECT o.id, i.sku, i.qty
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.user_id = 42;
```

**Q6. Connection pooling là gì và tại sao cạn?**
Mở DB connection tốn ~5–20 ms. Pool tái dùng chúng. Bạn cạn bằng leak (không try-with-resources) hoặc giữ một cái trong slow call, nên `HikariPool` throw `ConnectionTimeoutException` sau `connectionTimeout` (mặc định 30 s). Rule of thumb: `pool_size ≈ concurrency × (avg_query_ms / target_latency_ms)`.

## Senior — thiết kế & phòng thủ

**Q1. Report query trên bảng 500M row timeout. Đi qua chẩn đoán và fix.**
"Tôi `EXPLAIN ANALYZE` — thường sequential scan vì predicate bọc cột trong function hoặc index không leftmost-matching. Nếu là aggregation, materialized view refresh mỗi 5–15 phút biến scan 30 s thành read 50 ms. Nếu phải live, **covering index** cho planner làm index-only scan (không heap fetch). Chứng minh before/after:"

```sql
-- Before: Seq Scan on orders  (cost=0.00..8_500_000 rows=120_000_000)
-- After thêm (status, created_at) INCLUDE (total):
--   Index Only Scan using ix_orders_status_created ... (cost=0.00..1_200)
```

"Tôi confirm p95 từ ~30 s xuống <100 ms."

**Q2. Thiết kế schema cho 1M orders/day. Indexing strategy?**
"Partition theo tháng (range partitions) để archive data cũ và query gần đây scan ít hơn. Index `(customer_id, created_at)` cho 'my orders, newest first' (leftmost + sort). Tôi tránh index mọi cột — mỗi index thêm ~10–20% write amplification, và ở 1M/day nó quan trọng. Push hot analytics sang read replica."

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

**Q3. Chọn isolation cho payment service, phòng thủ bằng failure mode.**
"Cho transfer path tôi dùng `REPEATABLE READ`/`SERIALIZABLE` — non-repeatable read có thể double-debit. Cái giá: nhiều lock hơn và có thể serialization failure (Postgres `serialization_failure`, SQLSTATE 40001) dưới contention, nên tôi giữ txn đó thật nhỏ (chỉ balance math) và retry trên 40001. Cho read-heavy reporting tôi drop xuống `READ COMMITTED` trên replica. Anomaly bạn không chịu được quyết định level — bạn trả cho isolation chỉ ở nơi có tiền."

**Q4. Bạn thấy lock wait dưới tải vừa. Tìm nguyên nhân.**
"Tôi query `pg_locks` join `pg_stat_activity` cho blocking PID và statement của nó. Chín trên mười là long txn giữ row lock trong khi làm slow external call — lock sống vài giây thay vì ms. Fix: thu nhỏ txn chỉ còn write tối thiểu, đẩy slow work ra ngoài, set `lock_timeout = 2s` để blocked txn fail nhanh thay vì cascade. Tôi đo lock-wait time trước/sau."

**Q5. ORM hay raw SQL — khi nào bỏ JPA?**
"Khi query phức tạp (deep join, window function, bulk update) hoặc hot, SQL JPA sinh ra opaque và thường làm N+1. Tôi dùng `JdbcTemplate`/jOOQ với đúng cột cần"

```java
// WRONG: load whole entity graph, rồi một field
Order o = repo.findById(42L).get();  // + lazy collections = N+1
// RIGHT: một projection, một query
String sql = "SELECT status, total FROM orders WHERE id = ?";
return jdbcTemplate.queryForObject(sql, (rs,r) -> new OrderView(rs.getString(1), rs.getBigDecimal(2)), id);
```

**Q6. Phòng thủ connection-pool size bằng Little's Law.**
"`pool ≈ target_concurrency × (avg_query_ms / acceptable_latency_ms)`. Tại 5 ms avg và 200 concurrent, đó là ~200 × (0.005 / 0.1) ≈ 10, pad cho variance lên ~20–30 — không 200. Oversize lãng phí DB connection (mỗi cái giữ backend process + ~5–10 MB) và có thể _tệ hơn_ throughput qua lock contention. Tôi set `maximumPoolSize` từ số thật, monitor wait time, và tune."

#### Self-check

- [ ] Junior: Tôi giải thích được PK/FK/index, INNER vs LEFT join, WHERE vs HAVING, ACID, và tại sao không FLOAT cho tiền — với SQL.
- [ ] Mid: Tôi giải thích được B-tree indexing + function-wrap pitfall, composite leftmost-prefix, isolation level, deadlock avoidance, N+1, và pool exhaustion.
- [ ] Senior: Tôi chẩn đoán được slow report với EXPLAIN ANALYZE + covering index, thiết kế partitioning/indexing cho 1M/day, chọn isolation theo failure mode, tìm lock wait, bỏ JPA cho hand-written SQL, và size pool từ Little's Law.
