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

Database là nơi câu "chạy trên máy tôi vẫn ok" chết. Junior viết `SELECT *` rồi thắc mắc tại sao prod chậm; senior chỉ ra được `EXPLAIN` chính xác chứng minh tại sao query quét tuần tự và index nào sửa nó. Bài này leo từ join qua isolation anomaly đến pool exhaustion — 50 câu hỏi, chọn đúng level bạn đang phỏng vấn và đọc thêm một level trên nó, với SQL và JDBC bạn chạy được thật.

> Mindset: junior viết query trả đúng rows; senior viết query trả đúng rows _và_ không gục site ở 10x traffic — và chứng minh được bằng `EXPLAIN ANALYZE`.

## Junior — nền tảng

**Q1. Primary key, foreign key, và index là gì?**
Primary key định danh duy nhất một row (ép unique + not null). Foreign key tham chiếu PK ở bảng khác, ép referential integrity. Index là B-tree tăng tốc lookup với cái giá là write overhead. Không có index, `WHERE` quét tuần tự — trên bảng 10M row là ~10M row read (~hàng trăm ms đến vài giây); có index chỉ là ~4 B-tree level (~4 random read, ~0.5 ms). Lưu ý rằng FK trong hầu hết engine _không_ tự tạo index trên cột con — thiếu FK index, mỗi lần xóa parent là một lần quét cả bảng con:

```sql
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),  -- FK: đảm bảo integrity
  total DECIMAL(19,4) NOT NULL
);

-- mỗi INSERT/DELETE giờ phải duy trì hai cấu trúc; mỗi index thêm
-- khoảng 10–20% write overhead, nên chỉ index những gì query thực sự filter
CREATE INDEX ix_orders_customer ON orders (customer_id);
```

**Q2. Khác nhau giữa `INNER JOIN` và `LEFT JOIN`?**
`INNER JOIN` chỉ trả các row khớp; `LEFT JOIN` trả mọi row bên trái kèm cột bên phải khớp được hoặc NULL. Bug kinh điển — dùng `INNER` khi cần orphan làm mất data thầm lặng:

```sql
-- WRONG: mất thầm user không có order
SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = u.id;

-- RIGHT: giữ mọi user, hiện NULL khi họ không có order
SELECT u.name, o.id FROM users u LEFT JOIN orders o ON o.user_id = u.id;

-- và nếu user xuất hiện 3 lần, đó là 3 orders — join không sai,
-- bạn đã yêu cầu row-per-order. Dùng DISTINCT hoặc aggregation có chủ đích.
```

**Q3. Khác nhau giữa `WHERE` và `HAVING`?**
`WHERE` filter row trước khi group; `HAVING` filter group sau `GROUP BY`. Không thể dùng aggregate trong `WHERE` — đó là syntax error. Thứ tự cũng quan trọng với hiệu năng: `WHERE` chạy trước aggregation nên dùng được index và thu nhỏ input từ 10M rows xuống 10k trước khi group; `HAVING` chỉ thấy kết quả đã aggregate xong:

```sql
-- WRONG
SELECT user_id, COUNT(*) FROM orders WHERE COUNT(*) > 1 GROUP BY user_id;
-- RIGHT
SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1;
```

**Q4. Transaction và ACID là gì?**
Transaction gộp các operation thành một khối all-or-nothing. ACID: **A**tomicity (tất cả hoặc không gì cả), **C**onsistency (trạng thái hợp lệ), **I**solation (các txn đồng thời không làm nhiễu nhau), **D**urability (data đã commit sống sót qua crash). Một transfer: debit A và credit B phải cùng commit hoặc cùng rollback — không bao giờ để tiền biến mất. Durability không miễn phí: mỗi commit ép một lần WAL flush, thường ~1–10 ms, đó là lý do batching quan trọng (Q29):

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;      -- hoặc ROLLBACK; nếu UPDATE thứ hai thất bại
```

**Q5. Khác nhau giữa `COUNT(*)`, `COUNT(col)`, `COUNT(DISTINCT col)`?**
`COUNT(*)` đếm row (kể cả NULL); `COUNT(col)` đếm giá trị non-NULL; `COUNT(DISTINCT col)` đếm giá trị unique non-NULL. Trên bảng 1M row, trộn lẫn chúng làm đổi số của bạn thầm lặng — một bug báo cáo kinh điển. Và `COUNT(*)` không miễn phí: không có index-only scan thì nó đọc mọi row của bảng (~vài giây trên 10M rows), đó là lý do dashboard phải pre-aggregate:

```sql
SELECT COUNT(*) FROM orders;                 -- mọi row, kể cả NULL
SELECT COUNT(shipped_at) FROM orders;        -- chỉ ngày ship non-NULL
SELECT COUNT(DISTINCT customer_id) FROM orders;  -- customer duy nhất
```

**Q6. Tại sao không lưu tiền bằng `FLOAT`?**
Binary float không biểu diễn chính xác số thập phân (0.1 + 0.2 ≠ 0.3), gây rounding drift làm ledger không reconcile được. Dùng `DECIMAL(19,4)` hoặc lưu integer minor units (cents). Và khi DB đã an toàn, phía Java cũng phải an toàn — không bao giờ map tiền sang `double`:

```sql
-- WRONG: không bao giờ
amount FLOAT;
-- RIGHT
amount DECIMAL(19,4);   -- 19 chữ số, 4 sau dấu phẩy
-- hoặc trong app code: lưu BIGINT cents, chỉ format ở biên
```

```java
// WRONG: cùng bug float lọt qua JDBC
double total = rs.getDouble("amount");
// RIGHT: BigDecimal xuyên suốt, kèm chế độ rounding tường minh
BigDecimal total = rs.getBigDecimal("amount").setScale(2, RoundingMode.HALF_EVEN);
```

**Q7. Khác nhau giữa `UNIQUE` và `PRIMARY KEY`?**
PK là `UNIQUE NOT NULL` cộng vai trò neo định danh của bảng; một bảng có đúng một PK nhưng nhiều constraint `UNIQUE`. Cái bẫy nằm ở ngữ nghĩa NULL: trong Postgres, `UNIQUE` coi các NULL là khác nhau, nên hai row cùng `NULL` ở cột unique là hợp lệ — điều làm người ta giật mình khi đang ép "mỗi user một email":

```sql
-- WRONG: cho phép vô hạn row email NULL
CREATE TABLE users (email TEXT UNIQUE);
INSERT INTO users VALUES (NULL), (NULL);   -- thành công trong Postgres!

-- RIGHT: ép "tối đa một NULL" bằng partial unique index
CREATE UNIQUE INDEX one_null_email ON users (email) WHERE email IS NOT NULL;
```

**Q8. Khác nhau giữa `DELETE`, `TRUNCATE`, và `DROP`?**
`DELETE` là DML: xóa từng row, kích hoạt trigger, ghi WAL, và để lại dead tuples (bloat) phía sau. `TRUNCATE` là thao tác metadata nhanh — nó giải phóng cả pages thay vì đụng từng row, nên xóa 10M rows mất ~ms trong khi `DELETE` mất hàng chục giây. `DROP` xóa vĩnh viễn bảng và mọi index của nó:

```sql
-- DELETE: 10M rows từng dòng một, ~30–60 s, làm bảng phình vì dead tuples
DELETE FROM logs WHERE created_at < '2024-01-01';
-- TRUNCATE: giải phóng mọi pages một lượt, ~1 ms, không filter được
TRUNCATE logs;
-- DROP: bảng và mọi index của nó biến mất
DROP TABLE logs;
```

**Q9. SQL injection là gì và `PreparedStatement` chặn nó bằng cách nào?**
Injection xảy ra khi input của user bị nối thẳng vào chuỗi SQL — input được parse như _code_, không phải _data_. Cách sửa là parameterization: driver gửi giá trị theo kênh riêng, nên `' OR 1=1 --` chỉ là một chuỗi. Prepared statement còn tái dùng plan đã parse, tiết kiệm chi phí parse (~10–50 µs) cho mỗi lần thực thi lặp lại — đúng và nhanh trong một động tác:

```java
// WRONG: attacker gửi email = "x' OR '1'='1" và thành bất kỳ user nào
String sql = "SELECT * FROM users WHERE email = '" + input + "'";

// RIGHT: giá trị đi như data, không bao giờ như SQL
try (PreparedStatement ps = conn.prepareStatement(
        "SELECT * FROM users WHERE email = ?")) {
  ps.setString(1, input);
  try (ResultSet rs = ps.executeQuery()) { /* ... */ }
}
```

**Q10. NULL và three-valued logic là gì?**
`NULL` nghĩa là "không biết", và mọi so sánh với nó ra `NULL`, mà `WHERE` coi `NULL` là false. Nên `WHERE x = NULL` không khớp gì cả — một bug huyền thoại. Aggregate cũng bỏ qua NULL, nên `AVG` trên cột có NULL sẽ bỏ những row đó. `COALESCE` và `NULLIF` là công cụ hằng ngày:

```sql
-- WRONG: khớp 0 row, lần nào cũng vậy
SELECT * FROM orders WHERE discount = NULL;
-- RIGHT
SELECT * FROM orders WHERE discount IS NULL;
-- điền default để hiển thị, không làm hỏng giá trị lưu trữ
SELECT COALESCE(discount, 0) AS discount FROM orders;
```

**Q11. Normalization là gì và khi nào denormalize?**
Normalization loại bỏ redundancy: 1NF cột nguyên tử, 2NF không dependency bộ phận, 3NF không dependency chuyển tiếp. Cái được là loại bỏ update anomaly; cái mất là join. Một bản denormalized của `customer_name` trên mỗi order nghĩa là một lần đổi tên phải đụng hàng triệu rows. Nhưng một bảng report lặp lại giá trị denormalized biến join 5 chiều (~50–200 ms trên 100k rows) thành một lần đọc (~5–20 ms) — denormalize có chủ đích ở biên, không phải vô tình trong schema OLTP:

```sql
-- WRONG (không 3NF): tên customer lặp lại trong mọi row order —
-- đổi tên customer là phải viết lại mọi order (update anomaly)
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_name TEXT, amount DECIMAL(19,4));

-- RIGHT: tham chiếu bằng id, chỉ join khi cần tên
CREATE TABLE customers (id BIGINT PRIMARY KEY, name TEXT);
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL, amount DECIMAL(19,4));
```

**Q12. Regular view vs materialized view?**
Regular view là một query được lưu — nó chạy lại mỗi lần truy cập, luôn tươi, không tốn storage. Materialized view là snapshot đã tính sẵn lưu trên đĩa: đọc chỉ vài ms, nhưng cũ hơn cho đến khi bạn `REFRESH` (việc này tính lại và có thể mất vài giây, chặn reader ở một số engine). Quy tắc: data sống → view; aggregation chậm mà chấp nhận cũ → materialized:

```sql
-- live view: luôn hiện tại, không tốn storage
CREATE VIEW active_customers AS
  SELECT id, name FROM customers WHERE status = 'active';

-- materialized: aggregation 30 s thành read 50 ms sau khi refresh
CREATE MATERIALIZED VIEW daily_sales AS
  SELECT date_trunc('day', created_at) AS day, SUM(total) AS revenue
  FROM orders GROUP BY 1;
REFRESH MATERIALIZED VIEW daily_sales;   -- mỗi 5–15 phút, giờ thấp điểm
```

**Q13. Pagination `LIMIT`/`OFFSET` hoạt động ra sao, và cái bẫy của nó?**
`OFFSET` không bỏ qua công việc — DB vẫn quét rồi vứt số rows offset đó đi. Trang 1000001 tốn chi phí y như quét 1M rows. Keyset pagination ("seek") dùng thẳng index và có độ phức tạp O(kích thước trang) bất kể độ sâu:

```sql
-- WRONG khi scale: OFFSET 1000000 → quét + vứt 1M rows, ~50–200 ms và tăng dần
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 1000000;
-- RIGHT: seek trên index — ~1–5 ms ở bất kỳ độ sâu nào, và ổn định khi insert
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 20;
```

**Q14. Quản lý transaction từ JDBC thế nào?**
JDBC mặc định autocommit — mỗi statement là một transaction riêng, nên một transfer hai statement có thể half-commit. Tắt autocommit, làm việc, `commit()`, và `rollback()` khi thất bại. Hai luật senior sống cùng: transaction sống trên connection, nên không bao giờ để connection từ pool thoát ra mà không được trả về, và luôn trả connection trong `finally`:

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
  conn.commit();                       // cả hai update có hiệu lực, hoặc không cái nào
} catch (SQLException e) {
  conn.rollback();
  throw e;
} finally {
  conn.setAutoCommit(true);            // để lại connection sạch cho pool
  conn.close();                        // LUÔN LUÔN — không thì pool cạn (Q23)
}
```

**Q15. Có những loại index nào ngoài B-tree?**
B-tree là mặc định: equality, range, và ordering. Hash index chỉ hợp equality (hiếm khi thắng B-tree trong Postgres). GIN index phục vụ query "chứa" — array, jsonb, full-text. BRIN là quân bài ngủ quên: với bảng khổng lồ sắp xếp vật lý theo thứ tự (time series), nó lưu tóm tắt theo block, nên một B-tree ~1 GB trên 100 GB logs co lại còn ~1 MB:

```sql
CREATE INDEX ix_orders_btree ON orders (created_at);          -- range scan, ORDER BY
CREATE INDEX ix_orders_gin ON orders USING GIN (tags);        -- WHERE 'urgent' = ANY(tags)
CREATE INDEX ix_logs_brin ON logs USING BRIN (created_at);    -- nhỏ hơn ~100x, vẫn nhanh
```

**Q16. Đọc output `EXPLAIN` thế nào?**
`EXPLAIN` hiện cây plan của planner: loại node (Seq Scan vs Index Scan vs Index Only Scan vs Hash Join vs Nested Loop), cost và rows ước tính, và với `ANALYZE` là thời gian và số rows thực tế. Đơn vị "cost" xấp xỉ thời gian một lần đọc trang tuần tự (~0.01 ms), nên hãy so loại node, đừng so số tuyệt đối. Cờ đỏ là `rows` ước tính vs thực tế — nếu lệch nhau 100x, statistics đã cũ (`ANALYZE`) hoặc query giấu cột trong function:

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;
-- Seq Scan on orders  (cost=0.00..185000.00 rows=5000 width=32)
--                    (actual time=0.012..1250.0 rows=5000 loops=1)
-- 10M rows bị đọc tuần tự vì không có index trên customer_id;
-- thêm ix_orders_customer biến nó thành Index Scan ~4 levels (~0.5 ms).
```

**Q17. `LIKE` dùng được index không, và tìm kiếm không phân biệt hoa thường thì sao?**
`LIKE 'foo%'` (không có wildcard ở đầu) dùng được B-tree; `LIKE '%foo%'` thì không, vì pattern không cho cây biết bắt đầu từ đâu — nó thành full scan 10M rows. Không phân biệt hoa thường thêm vấn đề thứ hai: `ILIKE` cũng chặn index. Giải pháp: trigram GIN index cho "contains", expression index trên `lower(col)` cho prefix không phân biệt hoa thường:

```sql
-- WRONG: wildcard đầu câu → quét tuần tự 10M rows
SELECT * FROM users WHERE email LIKE '%@gmail.com';
-- RIGHT: prefix match đi trên B-tree
SELECT * FROM users WHERE email LIKE 'a%@gmail.com';
-- RIGHT khi scale cho contains: trigram index, ~10–50 ms trên 10M rows
CREATE INDEX ix_users_email_trgm ON users USING GIN (email gin_trgm_ops);
```

## Mid — đánh đổi & cạm bẫy

**Q18. B-tree index hoạt động ra sao, và khi nào nó vô dụng?**
B-tree giữ rows sắp xếp theo cột được index, nên equality/range scan là O(log n) thay vì O(n). Với 1B rows B-tree sâu chỉ ~4 level — ~4 random read (~0.5 ms mỗi cái) để tìm một row, so với full scan 1B rows (~hàng chục giây). Một page chứa ~200 entries, đó là fanout giữ cây nông. Nó vô dụng khi predicate bọc cột trong function (không dùng được index) hoặc kém chọn lọc đến mức trả >~20–30% rows (planner thích quét hơn):

```sql
-- WRONG: function trên cột -> index created_at KHÔNG được dùng
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- RIGHT: range mà index phục vụ
SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

**Q19. Composite index là gì và leftmost-prefix rule?**
`(a, b, c)` được sắp theo a, rồi b, rồi c. Nó phục vụ query filter `a`, `(a,b)`, hoặc `(a,b,c)` — nhưng KHÔNG phục vụ `b` hay `c` một mình. Đặt theo độ chọn lọc: cột chọn lọc nhất đứng đầu giúp rút ngắn cây walk nhanh nhất. Sai thứ tự cột = một index chết:

```sql
-- index: (customer_id, created_at)
SELECT * FROM orders
 WHERE customer_id = 42 ORDER BY created_at DESC;   -- dùng index ✓
SELECT * FROM orders WHERE created_at > '2024-01-01'; -- bỏ qua index ✗ (không có leftmost a)
-- index một cột trên cột nóng luôn thắng composite chết
CREATE INDEX ix_orders_created ON orders (created_at);
```

**Q20. Giải thích isolation levels và các anomaly của chúng.**
Mỗi level mua ít anomaly hơn với cái giá là nhiều locking/snapshotting hơn:

- **Read committed**: không dirty reads; non-repeatable reads có thể (cùng row khác nhau giữa txn).
- **Repeatable read**: nhất quán trong txn; phantoms và write skew vẫn có thể.
- **Serializable**: cô lập hoàn toàn, như chạy tuần tự — an toàn nhất, chậm nhất (có thể chậm hơn read committed 5–10× dưới contention).

Hầu hết engine mặc định read committed. Level được đặt theo từng transaction, và snapshot trong Postgres được chốt ở câu lệnh đầu tiên — nên `SET TRANSACTION` phải đứng trước mọi query:

```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT balance FROM accounts WHERE id = 1;   -- snapshot bị chốt tại đây
-- các commit từ txn khác sau điểm này vô hình trong suốt txn
COMMIT;
```

**Q21. Deadlock là gì và tránh nó thế nào?**
Hai transaction, mỗi cái giữ một lock mà cái kia cần. DB phát hiện vòng lặp trong wait-for graph và rollback một txn (Postgres ném `40P01`; MySQL `1213`). Tránh bằng cách truy cập resource theo **thứ tự toàn cục nhất quán** và giữ txn ngắn — txn 10 ms giữ lock 10 ms, txn 10 s với HTTP call bên trong giữ lock 10 s:

```sql
-- Cả hai service đều update accounts; LUÔN update theo thứ tự id để tránh cross-deadlock
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- id thấp trước
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- rồi id cao
COMMIT;
-- dây an toàn: txn bị chặn fail nhanh thay vì xếp hàng vô hạn
SET lock_timeout = '2s';
```

**Q22. N+1 problem là gì và sửa thế nào?**
ORM của bạn load N parent, rồi phát ra N query con riêng lẻ. Với N=1000 đó là 1001 round-trip (~mỗi cái 1–5 ms → thêm ~1–5 s). Sửa bằng join, batch fetch, hoặc projection — một query, một round trip:

```sql
-- WRONG (N+1): 1 query lấy orders, rồi 1 query mỗi order lấy items
SELECT * FROM orders WHERE user_id = 42;
SELECT * FROM order_items WHERE order_id = ?;   -- lặp 1000x

-- RIGHT: 1 query, mọi items
SELECT o.id, i.sku, i.qty
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.user_id = 42;
```

```java
// Trong JPA: fetch graph eagerly trong một statement thay vì lazy từng row
@EntityGraph(attributePaths = {"items"})
List<Order> findByCustomerId(Long customerId);
```

**Q23. Connection pooling là gì và vì sao nó cạn kiệt?**
Mở một DB connection tốn ~5–20 ms (TCP + auth + backend process). Pool tái dùng chúng. Bạn làm cạn pool bằng cách leak connection (không close trong `finally`) hoặc giữ một cái trong một call chậm, nên `HikariPool` ném `ConnectionTimeoutException` sau `connectionTimeout` (mặc định 30 s). Rule of thumb: `pool_size ≈ concurrency × (avg_query_ms / target_latency_ms)`:

```java
// WRONG: connection không bao giờ trả lại → pool cạn sau N request,
// rồi mọi caller chờ 30 s và fail
Connection c = dataSource.getConnection();
ResultSet rs = c.createStatement().executeQuery("SELECT ...");
// không c.close() — quyền mượn mất vĩnh viễn

// RIGHT: try-with-resources trả về pool kể cả khi exception
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement("SELECT ...")) {
  try (ResultSet rs = ps.executeQuery()) { /* ... */ }
}
```

**Q24. Covering index và index-only scan là gì?**
Covering index lưu thêm cột (`INCLUDE`) bên trong lá B-tree, nên query không cần đụng heap chút nào. Mỗi heap fetch là một random read (~0.1–0.5 ms); index-only scan chỉ đọc tuần tự các index page 8 KB. Trên một report nóng, đây thường giảm 10–100× số I/O. Lưu ý: Postgres phải tham khảo visibility map, thứ chỉ `VACUUM` duy trì — bảng vừa bloat sẽ thoái hóa thành bitmap scan:

```sql
CREATE INDEX ix_orders_status ON orders (status) INCLUDE (total, created_at);
-- Index Only Scan — không heap fetch chút nào
SELECT total, created_at FROM orders WHERE status = 'shipped';
```

**Q25. Nested-loop, hash, và merge join khác nhau thế nào, và dùng mỗi loại khi nào?**
Nested loop là O(N×M) nhưng mỗi lookup bên trong là ~0.1 ms có index — hoàn hảo khi phía outer nhỏ (100 rows × 1 lookup = 10 ms). Hash join dựng hash table trên một phía: O(N+M), con ngựa thồ cho các tập lớn không index; nó cần bộ nhớ (mặc định `work_mem` 4 MB — tràn ra đĩa chậm hơn 10–100×). Merge join cần input đã sắp xếp và trả kết quả theo thứ tự — lý tưởng khi planner lấy từ index và bạn muốn output có thứ tự sẵn:

```sql
-- outer nhỏ, inner có index → nested loop, ~100 × 0.1 ms ≈ 10 ms
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.* FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE c.id IN (SELECT id FROM customers WHERE signup_at > now() - interval '1 hour');

-- hai tập lớn không index → hash join: dựng hash, rồi một lượt mỗi bên.
-- Không có index trên cột join, nested loop 1M×1M là ~10^12 lần so sánh
-- (hàng giờ); hash join làm trong vài giây.
```

**Q26. Vì sao planner bỏ qua index của bạn?**
Mô hình cost: random read chậm hơn ~10× so với tuần tự, nên nếu index trả >~5–20% bảng, quét tuần tự thắng. Bitmap heap scan là con đường giữa — đọc index, dựng bitmap các pages, rồi chỉ đọc tuần tự những pages đó. Và nếu `EXPLAIN` hiện `rows` ước tính lệch trời (100x), statistics đã cũ: chạy `ANALYZE`:

```sql
-- 10M rows, 40% là 'pending': index trên status có, nhưng seq scan là ĐÚNG —
-- 4M heap read ngẫu nhiên (~vài chục giây) thua một lần quét tuần tự (~2–5 s)
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'pending';
-- khi một giá trị có selectivity tốt, planner sẽ hiện
-- Bitmap Heap Scan on orders -> Bitmap Index Scan on ix_orders_status
```

**Q27. `IN` vs `EXISTS` vs `JOIN` — cùng kết quả, khác plan?**
Cả ba đều diễn đạt được "orders của khách VIP", nhưng planner xử lý khác nhau. `IN` thường được unnest thành semi-join; `EXISTS` dừng ở match đầu tiên; `JOIN` nhân rows nếu phía phải khớp nhiều hơn một lần — rồi bạn trả giá cho `DISTINCT` (một sort, ~100 ms+ trên tập lớn). Với phép kiểm tra tồn tại thuần túy, semi-join chỉ quét phía phải đến hit đầu tiên:

```sql
-- cùng kết quả logic, ba plan khác nhau:
SELECT * FROM orders
 WHERE customer_id IN (SELECT id FROM customers WHERE vip = true);
SELECT * FROM orders o
 WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.vip);
SELECT DISTINCT o.* FROM orders o
 JOIN customers c ON c.id = o.customer_id WHERE c.vip;   -- DISTINCT = thêm một sort
-- cho "existence" trên 1M orders × 50k customers: EXISTS/IN ~5–20 ms,
-- JOIN + DISTINCT thường gấp 10×+ thế
```

**Q28. Viết upsert an toàn với race thế nào?**
Check-then-insert là hai statement và một cuộc đua: hai request đồng thời cùng vượt qua `SELECT`, rồi một cái fail với unique violation (`23505`). Cách sửa là một statement atomic — `INSERT ... ON CONFLICT` (Postgres) hoặc `MERGE` chuẩn — để engine xử lý conflict ngay trong cùng statement:

```sql
-- WRONG: check-then-act chạy đua dưới concurrency
SELECT 1 FROM inventory WHERE sku = 'A1';   -- cả hai request đều vượt qua
INSERT INTO inventory (sku, qty) VALUES ('A1', 5);  -- một cái nổ: 23505

-- RIGHT: atomic trong một statement; khi conflict, cộng thay vì fail
INSERT INTO inventory (sku, qty) VALUES ('A1', 5)
ON CONFLICT (sku) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty;
```

**Q29. Vì sao insert 10k rows từng dòng một chậm, và cái gì sửa nó?**
Mỗi `executeUpdate()` là một round trip trọn vẹn: ~0.5–5 ms trên LAN, 10–50 ms cross-region. 10k rows từng dòng ≈ 10k round trips ≈ 10–50 s. `addBatch()`/`executeBatch()` chỉ đẩy mạng một lần mỗi batch, co cùng công việc về ~100 ms — thắng ~50–100×:

```java
// WRONG: một round trip mỗi row — 10k rows ≈ 10k lần đẩy mạng
for (Order o : orders) {
  ps.setLong(1, o.customerId());
  ps.setBigDecimal(2, o.total());
  ps.executeUpdate();
}

// RIGHT: driver đệm lại, một lần đẩy mỗi batch
for (Order o : orders) {
  ps.setLong(1, o.customerId());
  ps.setBigDecimal(2, o.total());
  ps.addBatch();
}
ps.executeBatch();   // ~100 ms thay vì ~10–50 s
```

**Q30. Anomaly nào còn sống sót qua REPEATABLE READ?**
Repeatable read giết dirty/non-repeatable reads, nhưng không giết phantoms hay **write skew**: hai txn cùng đọc một snapshot, cùng quyết định dựa trên nó, cùng commit — và invariant vỡ. Ví dụ on-call: hai bác sĩ cùng kiểm tra "còn người khác trực" trong snapshot của mình, cả hai cùng off call, cả hai cùng commit. Postgres phát hiện điều này ở SERIALIZABLE qua SSI và hủy một txn bằng `40001` — app phải retry:

```sql
-- Write skew: cả hai txn đều thấy "1 bác sĩ khác" trong snapshot riêng của mình...
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) FROM on_call WHERE doctor_id <> 1;   -- txn A: thấy 1 người khác
-- ... txn B (bác sĩ 2) chạy cùng phép kiểm tra và cũng thấy 1 người khác
UPDATE on_call SET active = false WHERE doctor_id = 1;
UPDATE on_call SET active = false WHERE doctor_id = 2;
COMMIT;   -- cả hai commit → 0 bác sĩ trực, invariant vỡ

-- Ở SERIALIZABLE, Postgres hủy một txn với SQLSTATE 40001; hãy retry nó.
```

**Q31. Cái bẫy lazy-loading của JPA là gì?**
Collection lazy chỉ load khi bị chạm vào — bên ngoài transaction đang mở nó ném `LazyInitializationException`, còn bên trong transaction nó bắn một query mỗi lần truy cập (N+1 đúng lúc tệ nhất: lúc render view). `spring.jpa.open-in-view` trét bùa bằng cách giữ connection mở suốt request — đồng nghĩa một pooled connection bị cầm giữ mỗi request. Sửa ở query, không sửa bằng setting:

```java
// WRONG: txn đóng ở ranh giới repository...
List<Order> orders = orderRepo.findByCustomerId(42L);
return orders.stream().map(o -> o.getItems().size()).toList();  // 💥 LazyInitializationException
// (với open-in-view: thêm một query mỗi order, và mọi connection bị giữ lâu hơn)

// RIGHT: fetch graph ngay trong query, hoặc chỉ project cột bạn cần
@EntityGraph(attributePaths = {"items"})
List<Order> findByCustomerId(Long customerId);
```

**Q32. Điều gì vỡ khi cột FK không có index?**
FK đảm bảo integrity nhưng không tạo index trên cột con trong Postgres. Mỗi lần delete hoặc update một parent row phải quét cả bảng con để kiểm tra tham chiếu — và `ON DELETE CASCADE` làm tệ hơn: xóa 10k parents trong bảng con 50M-row không index là 10k full scans (hàng phút, kèm locks); có index là 10k index lookups (vài giây):

```sql
-- WRONG: FK không index phía bảng con — cascade delete quét mọi thứ
CREATE TABLE order_items (order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE);
-- RIGHT: index cột FK
CREATE INDEX ix_order_items_order ON order_items (order_id);
-- và ưu tiên soft-delete hơn cascade cho thứ gì lớn: cascade mà
-- thầm lặng xóa 1M row con là một production incident đang chực nổ
```

**Q33. `BIGSERIAL` vs `UUID` primary keys — khi nào nó cắn bạn?**
Khóa tuần tự giữ B-tree append-only: rows mới rơi vào mép phải, không page splits. UUID ngẫu nhiên rải insert khắp cây — mỗi insert split pages và để chúng lửng ~nửa trống, nên index phình ~10–30% và insert chậm hơn 2–5×. Nhưng UUID sinh được phía client (không round trip, không tranh chấp sequence) và sống sót qua sharding. Thỏa hiệp: `BIGSERIAL` tăng dần làm PK, UUID là `UNIQUE` key riêng cho public API:

```sql
-- WRONG cho bảng insert nóng: PK UUID ngẫu nhiên → ghi rải rác, page splits
CREATE TABLE events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payload JSONB);
-- RIGHT: identity tăng dần cho cây, UUID chỉ nơi thế giới bên ngoài nhìn thấy
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID UNIQUE DEFAULT gen_random_uuid(),
  payload JSONB
);
-- insert tuần tự duy trì ~10–50k rows/s; ngẫu nhiên thường chậm hơn 2–5×
```

**Q34. `IDENTITY`, `SEQUENCE`, và `GENERATED BY DEFAULT` — khác gì nhau?**
Cả ba đều sinh số; khác biệt nằm ở chỗ bước tăng xảy ra ở đâu và app có tự cấp giá trị được không. `SERIAL`/`BIGSERIAL` dùng sequence qua một default — app vẫn insert id tường minh được. `GENERATED ALWAYS AS IDENTITY` cấm giá trị tường minh (DB là writer duy nhất). Một sequence trần tách việc cấp phát id khỏi bảng — tiện cho batching (pre-fetch dải) nhưng dễ dùng sai. Gotcha thực tế: id tường minh có thể đụng dải sequence, và bước tăng sequence không bị rollback khi txn fail (gap là bình thường, không phải bug):

```sql
CREATE TABLE a (id BIGSERIAL PRIMARY KEY);             -- default từ sequence
CREATE TABLE b (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY);  -- DB sở hữu
CREATE SEQUENCE order_seq START 1000;                  -- cấp phát tự làm
-- lấy 1000 id trong một round trip giúp batch insert được (Q29)
SELECT nextval('order_seq') FROM generate_series(1, 1000);
```

## Senior — thiết kế & bảo vệ

**Q35. Report query trên bảng 500M row bị timeout. Đi qua quy trình chẩn đoán và fix.**
"Tôi `EXPLAIN ANALYZE` — thường là sequential scan vì predicate bọc cột trong function hoặc index không leftmost-matching. Nếu là aggregation, materialized view refresh mỗi 5–15 phút biến scan 30 s thành read 50 ms. Nếu phải live, **covering index** cho phép planner làm index-only scan (không heap fetch). Bằng chứng trước/sau:"

```sql
-- Trước: Seq Scan on orders  (cost=0.00..8_500_000 rows=120_000_000)
-- Sau khi thêm (status, created_at) INCLUDE (total):
--   Index Only Scan using ix_orders_status_created ... (cost=0.00..1_200)
CREATE INDEX ix_orders_status_created ON orders (status, created_at) INCLUDE (total);
```

"Tôi xác nhận p95 tụt từ ~30 s xuống <100 ms — đo lường, không đoán mò."

**Q36. Thiết kế schema cho 1M orders/ngày. Chiến lược index?**
"Partition theo tháng (range partitions) để archive data cũ và query gần đây scan ít hơn. Index `(customer_id, created_at)` cho 'my orders, newest first' (leftmost + sort). Tôi tránh index mọi cột — mỗi index thêm ~10–20% write amplification, và ở 1M/ngày điều đó đáng kể. Đẩy analytics nóng sang read replica, và giữ write path chỉ 1–2 index trên mỗi bảng nóng:"

```sql
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  total DECIMAL(19,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (created_at);

CREATE INDEX ix_orders_cust_created ON orders (customer_id, created_at DESC);
-- ngân sách index: mỗi index thêm tốn ~10–20% write overhead;
-- ở 1M rows/ngày là con số đo được — hãy index query, không index cột
```

**Q37. Chọn isolation cho payment service, phòng thủ bằng failure mode.**
"Cho transfer path tôi dùng `REPEATABLE READ`/`SERIALIZABLE` — non-repeatable read có thể double-debit. Cái giá: nhiều lock hơn và có thể gặp serialization failures (Postgres `serialization_failure`, SQLSTATE 40001) dưới contention, nên tôi giữ các txn đó thật nhỏ (chỉ balance math) và retry khi gặp 40001. Cho reporting đọc nặng tôi tụt xuống `READ COMMITTED` trên replica. Anomaly bạn không thể chịu được quyết định level — bạn chỉ trả tiền cho isolation ở nơi có tiền:"

```java
// txn thanh toán chỉ 2 UPDATE — cố tình nhỏ, retry khi 40001
@Transactional
public void transfer(long fromId, long toId, BigDecimal amt) {
  jdbc.update("UPDATE accounts SET balance = balance - ? WHERE id = ?", amt, fromId);
  jdbc.update("UPDATE accounts SET balance = balance + ? WHERE id = ?", amt, toId);
}
// phía caller: bắt SQLException SQLState "40001" → retry tối đa 3 lần, backoff 50/100/200 ms
```

**Q38. Bạn thấy lock waits dưới tải vừa phải. Tìm nguyên nhân.**
"Tôi query `pg_locks` join `pg_stat_activity` lấy PID đang chặn và statement của nó. Chín trên mười lần là một txn dài giữ row lock trong lúc làm một slow external call — lock sống vài giây thay vì vài ms. Fix: thu nhỏ txn còn các write tối thiểu, đẩy việc chậm ra ngoài txn, set `lock_timeout = 2s` để txn bị chặn fail nhanh thay vì cascade. Tôi đo lock-wait time trước/sau:"

```sql
-- ai đang giữ lock hơn 5 giây?
SELECT pid, state, now() - xact_start AS txn_age, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE state <> 'idle' AND now() - xact_start > interval '5 seconds'
ORDER BY txn_age DESC;

-- và ai chặn ai:
SELECT b.pid AS blocker, b.query AS blocker_query, a.pid AS blocked
FROM pg_stat_activity a
JOIN pg_locks l ON l.pid = a.pid
JOIN pg_locks bl ON bl.locktype = l.locktype AND bl.database = l.database
  AND bl.relation = l.relation AND bl.mode = l.mode AND bl.pid <> a.pid
JOIN pg_stat_activity b ON b.pid = bl.pid;
```

**Q39. ORM hay raw SQL — khi nào bỏ JPA?**
"Khi query phức tạp (deep joins, window functions, bulk updates) hoặc hot, SQL do JPA sinh ra opaque và thường gây N+1. Tôi dùng `JdbcTemplate`/jOOQ với đúng các cột cần — SQL review được và plan đoán trước được. Với data hình dạng CRUD, JPA vẫn là đường dev nhanh hơn; quyết định theo từng query, không theo từng project:"

```java
// WRONG: load cả entity graph, rồi mới lấy một field
Order o = repo.findById(42L).get();  // + lazy collections = N+1
// RIGHT: một projection, một query
String sql = "SELECT status, total FROM orders WHERE id = ?";
return jdbcTemplate.queryForObject(sql,
    (rs, r) -> new OrderView(rs.getString(1), rs.getBigDecimal(2)), id);
```

**Q40. Phòng thủ connection-pool size bằng Little's Law.**
"`pool ≈ target_concurrency × (avg_query_ms / acceptable_latency_ms)`. Với avg 5 ms và 200 concurrent, đó là ~200 × (0.005 / 0.1) ≈ 10, pad cho variance lên ~20–30 — không phải 200. Oversize lãng phí DB connection (mỗi cái giữ một backend process + ~5–10 MB) và có thể làm _tệ đi_ throughput vì lock contention. Tôi set `maximumPoolSize` từ số liệu thật, monitor wait time, và tune:"

```java
HikariConfig cfg = new HikariConfig();
cfg.setMaximumPoolSize(30);        // Little's Law ~10, pad lên 20–30
cfg.setConnectionTimeout(2000);    // fail nhanh — đừng queue 30 s khi DB ốm
cfg.setValidationTimeout(1000);
cfg.setLeakDetectionThreshold(10_000);  // bắt leak connection trong test
```

**Q41. Partial và expression index — ngân sách index nên đi đâu?**
"Index trên mọi cột là cách write-heavy service chết. **Partial index** chỉ index những rows query thực sự quan tâm (ví dụ 1% bảng): nhỏ hơn 100×, tốn chi phí duy trì ~100× ít hơn, cùng tốc độ query. **Expression index** index đúng hàm bạn gọi — `WHERE lower(email) = ?` không dùng được index thường trên `email`, nhưng dùng được index trên `lower(email)`. Cả hai là cách tôi giữ dưới ngân sách ~20% write-amplification khi scale:"

```sql
-- partial: chỉ 1% rows ở trạng thái 'open' được index
CREATE INDEX ix_orders_open ON orders (created_at) WHERE status = 'open';
-- expression: index hàm, không index cột
CREATE INDEX ix_users_email_lower ON users (lower(email));
SELECT * FROM users WHERE lower(email) = 'dev@example.com';   -- giờ dùng được nó
```

**Q42. Partitioning — khi nào nó giúp và khi nào nó phản tác dụng?**
"Range partitioning theo tháng đáng giá khi (a) query filter trên partition key, để pruning bỏ qua cả partition, và (b) bạn lùi data bằng `DETACH`/`DROP PARTITION` — thao tác metadata O(1) thay vì `DELETE` vừa bloat vừa khóa. Nó phản tác dụng dưới ngưỡng scale: mỗi partition thêm planner overhead, và query _không_ filter trên key sẽ quét mọi partition. Hash partitioning dàn hot writes qua các shard nhưng không giúp range query. Rule of thumb: partition khi bảng >~100 GB hoặc ~100M+ rows, và luôn đặt partition key vào các predicate nóng:"

```sql
CREATE TABLE events (...) PARTITION BY RANGE (created_at);
CREATE TABLE events_2026_08 PARTITION OF events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- lùi một tháng: O(1), không bloat, không khóa phần còn lại của bảng
ALTER TABLE events DETACH PARTITION events_2026_01;
-- bẫy: WHERE created_at >= ... phải khớp partition key,
-- không thì pruning thất bại và mọi partition bị quét
```

**Q43. Read replicas và replication lag — giữ reads đúng thế nào?**
"Async replicas lag vài chục ms đến vài giây dưới tải, nên user vừa đặt order rồi đánh vào replica có thể thấy '0 orders' — bài toán read-your-writes. Tôi route data của chính user đó về primary trong một cửa sổ ngắn sau write (session affinity), và monitor `pg_stat_replication` để một replica lag bị đưa ra khỏi rotation trước khi report lệch thầm. Dashboard trên replica phải nói rõ ngân sách staleness của nó:"

```sql
-- trên replica, lag = replica cách primary bao xa
SELECT replay_lag FROM pg_stat_replication;
-- chốt chặn phía app cho luồng write-then-read:
-- nếu request được chính USER này ghi trong 5 s vừa qua → đánh vào primary
```

**Q44. Giữ DB và message broker nhất quán thế nào?**
"Ghi row và publish event trong hai transaction riêng là dual-write: crash giữa chừng là mất event vĩnh viễn. **Transaction outbox** đặt event vào cùng DB transaction — atomic theo cấu trúc — và một poller publish rồi xóa nó. Event không bao giờ mất; nó chỉ bị trễ tối đa bằng poll interval (~100 ms–1 s), một cái giá rất đáng cho 'không bao giờ mất event refund':"

```java
@Transactional
public void refund(long orderId) {
  jdbc.update("UPDATE orders SET status = 'refunded' WHERE id = ?", orderId);
  // cùng txn, cùng commit — row outbox không thể tồn tại mà không có update
  jdbc.update("INSERT INTO outbox (event_id, payload) VALUES (?, ?)",
      UUID.randomUUID(), json(orderId, "REFUNDED"));
}
// dispatcher riêng: SELECT pending → publish lên broker → DELETE theo event_id
// (consumer idempotent ở phía kia — delivery at-least-once)
```

**Q45. Optimistic vs pessimistic locking — bạn với tay tới cái nào?**
"Optimistic locking (một cột `@Version`) không tốn gì cho đến lúc commit: UPDATE kiểm tra version, và nếu người khác ghi trước, 0 rows khớp và bạn retry cả txn. Pessimistic (`SELECT ... FOR UPDATE`) giữ row lock từ lúc read đến lúc commit — đúng đắn, nhưng txn chậm làm mọi người khác đứng đợi. Với web traffic, optimistic thắng: contention thường <5% requests, nên một lần rety hiếm hoi còn hơn giữ lock suốt vòng đời của request median:"

```java
@Entity
public class Order {
  @Version private long version;   // tăng lên mỗi lần UPDATE
}
```

```sql
-- kiểm tra version làm check-then-act atomic:
UPDATE orders SET total = ?, version = version + 1
WHERE id = ? AND version = ?;
-- 0 row được update → người khác ghi trước → retry cả txn

-- phương án pessimistic — lock được giữ đến COMMIT:
BEGIN;
SELECT total FROM orders WHERE id = 42 FOR UPDATE;
```

**Q46. Một hot row bị mọi request update — bạn làm gì?**
"Một row, một lock: mọi update nối tiếp nhau, chặn bạn ở ~1–5k updates/s trên row đó dù có bao nhiêu app instances đi nữa. Cho counters (likes, view counts, seats remaining), **shard row**: chia count ra N buckets, mỗi request ghi một bucket, `SUM` khi đọc. Chỉ hiệu quả khi total chấp nhận hơi cũ hoặc buckets vốn là per-request — không bao giờ cho tiền, nơi mà một row duy nhất cộng retries là thiết kế trung thực:"

```sql
-- WRONG: mọi like đập vào cùng một row — một lock, một writer nối tiếp
UPDATE posts SET likes = likes + 1 WHERE id = 9;

-- RIGHT: 64 shard — 64 writer đồng thời trên cùng một counter logic
UPDATE post_likes SET n = n + 1
WHERE post_id = 9 AND shard = (random() * 63)::int;   -- chọn một bucket
SELECT SUM(n) FROM post_likes WHERE post_id = 9;      -- đọc = tổng các bucket
```

**Q47. Vì sao bảng to lên dù không insert, và bloat là gì?**
"MVCC nghĩa là một UPDATE tạo một row version mới; bản cũ thành **dead tuple** chỉ `VACUUM` thu hồi. Nếu autovacuum không theo kịp (default kích hoạt ở 20% dead + 50 rows), bảng và index của nó phình: bảng chứa 1 GB data sống có thể chiếm 5 GB, và mọi scan cùng index walk chậm đi 'vô cớ'. Tôi theo dõi `pg_stat_user_tables`; khi dead tuples vượt ~30% của live, tôi `VACUUM` (rẻ) hoặc `VACUUM FULL`/`pg_repack` (thu hồi không gian, nhưng khóa — nên lên lịch):"

```sql
SELECT relname, n_dead_tup, n_live_tup,
       round(100.0 * n_dead_tup / greatest(n_live_tup, 1), 1) AS dead_pct
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 5;
-- dead > 30% live → bloat đang tốn tiền bạn; VACUUM thu hồi tuple,
-- VACUUM FULL dựng lại file (lock ACCESS EXCLUSIVE — làm trong cửa sổ bảo trì)
```

**Q48. `ALTER TABLE` trên bảng 500M row — làm sao không downtime?**
"Hai kẻ giết người là table rewrites và lock `ACCESS EXCLUSIVE`. Postgres 11+ biến `ADD COLUMN ... DEFAULT` thành chỉ metadata (~ms, không rewrite) — nhưng `NOT NULL` vẫn quét bảng, và dựng index vẫn khóa writer. Chuỗi an toàn: thêm cột, backfill theo lô, thêm constraint `NOT VALID`, rồi `VALIDATE` (recheck không khóa). Cho index: `CREATE INDEX CONCURRENTLY`, luôn luôn:"

```sql
-- WRONG: khóa bảng suốt quá trình rewrite — 500M rows = ~30–60 phút downtime
ALTER TABLE orders ADD COLUMN region TEXT NOT NULL DEFAULT 'eu';

-- RIGHT (PG 11+): default chỉ metadata, ~ms, không rewrite
ALTER TABLE orders ADD COLUMN region TEXT;
ALTER TABLE orders ALTER COLUMN region SET DEFAULT 'eu';
-- backfill theo lô 100k, rồi validate constraint không khóa:
ALTER TABLE orders ADD CONSTRAINT orders_region_nn CHECK (region IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_region_nn;
-- và index: CREATE INDEX CONCURRENTLY ix_orders_region ON orders (region);
```

**Q49. Một query nhanh bao tháng bỗng chậm — vì sao?**
"Điều tra đầu tiên: statistics. Ước tính `rows` của planner dẫn dắt mọi quyết định join; nếu bảng lớn gấp 100× từ lần `ANALYZE` cuối, planner vẫn nghĩ nó có 100k rows và chọn nested loop thay vì hash join — chậm hơn 100×. Thứ hai: phân bố đổi (cột từng 50/50 giờ thành 99/1). Thứ ba: chính index nhiễm bloat. Quy trình không bao giờ là tune mù — `EXPLAIN (ANALYZE, BUFFERS)` ngay bây giờ, so với plan cũ, kiểm tra `last_analyze`:"

```sql
SELECT relname, last_analyze, last_autoanalyze, n_mod_since_analyze
FROM pg_stat_user_tables WHERE relname = 'orders';
-- n_mod_since_analyze >> 10% bảng → statistics đang nói dối planner
ANALYZE orders;   -- refresh stats, rồi chạy lại EXPLAIN trước khi đụng vào bất cứ thứ gì
```

**Q50. Câu chuyện backup và recovery của bạn — kèm số liệu?**
"Chiến lược backup là một hợp đồng: **RPO** (mất được bao nhiêu data) và **RTO** (mất bao lâu để quay lại). Cho Postgres: WAL archiving liên tục cho RPO cấp giây — một base backup cộng mọi WAL segment, nên tôi recovery được đến bất kỳ điểm nào trong thời gian. Logical dumps (`pg_dump`) của DB 1 TB mất hàng giờ, nên chúng dành cho schema/portability, không phải disaster recovery. Và điều không thể thương lượng: tôi restore lên staging theo lịch và đo thời gian — ngày chúng ta cần backup không phải ngày học cách dùng nó:"

```sql
-- tạo restore point để một deploy hỏng chỉ cần một lệnh để lùi lại
SELECT pg_create_restore_point('before_deploy_v42');

-- bài tập restore: base backup + replay WAL đến restore point
-- pg_restore -d appdb latest.dump       (logical — schema/portability)
-- pg_basebackup + replay WAL archive    (physical — RPO cấp giây)
-- RPO ≈ WAL đã archive gần nhất (giây); RTO ≈ restore base + replay WAL (phút)
```

#### Self-check

- [ ] Tôi viết được DDL/DML cho PK/FK/index, giải thích được three-valued logic của NULL, các biến thể `COUNT`, và cột tiền — kèm code, và nói được vì sao `FLOAT` bị cấm?
- [ ] Tôi giải thích được B-tree/composite/covering index, vì sao planner bỏ qua index (selectivity, function wrap), N+1, JDBC batching, và thang isolation levels với từng anomaly cụ thể?
- [ ] Tôi chẩn đoán được query chậm từ output `EXPLAIN ANALYZE` và sửa bằng index đúng — không đoán mò?
- [ ] Tôi phòng thủ được các lựa chọn schema (partitioning, `BIGSERIAL` vs UUID, outbox, sharded counters, pool sizing) bằng số liệu và failure modes?
- [ ] Tôi xử lý được lock waits, bloat, `ALTER TABLE` an toàn, một plan đột nhiên thoái hóa, và câu chuyện backup với lệnh thật và RPO/RTO?
