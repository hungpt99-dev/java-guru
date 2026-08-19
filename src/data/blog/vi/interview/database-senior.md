---
title: "Ôn thi Java #4: Database & SQL — Junior đến Senior"
description: "Tầng cơ sở dữ liệu quyết định khả năng mở rộng trong thực tế. Ứng viên senior phải trình bày trôi chảy về indexing, transaction isolation, connection pooling và cái bẫy ORM, bằng SQL thực tế chứ không chỉ bằng lời."
pubDatetime: 2026-08-10T10:15:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - database
  - sql
---

Database là nơi câu "chạy trên máy tôi vẫn ổn" chết. Junior viết `SELECT *` rồi thắc mắc tại sao production chậm; senior chỉ ra được output `EXPLAIN` chứng minh chính xác vì sao query quét tuần tự và index nào sẽ giải quyết vấn đề. Bài này đi từ join qua các isolation anomaly đến pool exhaustion. Có 50 câu hỏi: hãy bắt đầu ở level bạn đang phỏng vấn, rồi đọc thêm một level phía trên, với các ví dụ SQL và JDBC có thể chạy thật.

> Tư duy: junior viết query trả về đúng rows; senior viết query trả về đúng rows _và_ không làm sập site khi traffic tăng gấp 10 lần, rồi chứng minh điều đó bằng `EXPLAIN ANALYZE`.

## Junior — nền tảng

**Q1. Primary key, foreign key, và index là gì?**
Primary key định danh duy nhất một row (được ép là unique và not null). Foreign key tham chiếu đến PK ở bảng khác và đảm bảo referential integrity. Index thường là B-tree, giúp tăng tốc lookup với cái giá là write overhead. Không có index, `WHERE` phải quét tuần tự; trên bảng 10M row, đó là khoảng 10M row read (từ hàng trăm ms đến vài giây). Có index thì chỉ cần đi qua khoảng 4 B-tree level (khoảng 4 random read, ~0.5 ms). Lưu ý rằng FK trong hầu hết engine _không_ tự tạo index trên cột con. Nếu thiếu FK index, mỗi lần xóa parent đều phải quét bảng con:

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
`INNER JOIN` chỉ trả về các row khớp; `LEFT JOIN` trả về mọi row ở bên trái, kèm các cột bên phải nếu khớp hoặc NULL nếu không khớp. Một bug kinh điển là dùng `INNER JOIN` khi cần giữ các row mồ côi, khiến dữ liệu bị mất một cách âm thầm:

```sql
-- WRONG: mất thầm user không có order
SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = u.id;

-- RIGHT: giữ mọi user, hiện NULL khi họ không có order
SELECT u.name, o.id FROM users u LEFT JOIN orders o ON o.user_id = u.id;

-- và nếu user xuất hiện 3 lần, đó là 3 orders — join không sai,
-- bạn đã yêu cầu row-per-order. Dùng DISTINCT hoặc aggregation có chủ đích.
```

**Q3. Khác nhau giữa `WHERE` và `HAVING`?**
`WHERE` lọc row trước khi group; `HAVING` lọc group sau `GROUP BY`. Không thể dùng aggregate trong `WHERE`; đó là syntax error. Thứ tự cũng quan trọng đối với hiệu năng: `WHERE` chạy trước aggregation nên có thể dùng index và thu nhỏ input từ 10M rows xuống 10k trước khi group. `HAVING` chỉ nhìn thấy kết quả đã aggregate:

```sql
-- WRONG
SELECT user_id, COUNT(*) FROM orders WHERE COUNT(*) > 1 GROUP BY user_id;
-- RIGHT
SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1;
```

**Q4. Transaction và ACID là gì?**
Transaction gộp các operation thành một khối all-or-nothing. ACID gồm: **A**tomicity (tất cả hoặc không gì cả), **C**onsistency (trạng thái hợp lệ), **I**solation (các txn đồng thời không can thiệp lẫn nhau), và **D**urability (data đã commit vẫn tồn tại sau crash). Trong một transfer, debit A và credit B phải cùng commit hoặc cùng rollback; không bao giờ được để tiền biến mất. Durability không miễn phí: mỗi commit buộc phải flush WAL, thường mất ~1–10 ms, đó là lý do batching quan trọng (Q29):

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;      -- hoặc ROLLBACK; nếu UPDATE thứ hai thất bại
```

**Q5. Khác nhau giữa `COUNT(*)`, `COUNT(col)`, `COUNT(DISTINCT col)`?**
`COUNT(*)` đếm row, kể cả NULL; `COUNT(col)` đếm các giá trị non-NULL; `COUNT(DISTINCT col)` đếm các giá trị non-NULL duy nhất. Trên bảng 1M row, nhầm lẫn giữa chúng sẽ âm thầm làm thay đổi kết quả, một bug báo cáo kinh điển. `COUNT(*)` cũng không miễn phí: nếu không có index-only scan, nó phải đọc mọi row trong bảng (~vài giây trên 10M rows), đó là lý do dashboard phải pre-aggregate:

```sql
SELECT COUNT(*) FROM orders;                 -- mọi row, kể cả NULL
SELECT COUNT(shipped_at) FROM orders;        -- chỉ ngày ship non-NULL
SELECT COUNT(DISTINCT customer_id) FROM orders;  -- customer duy nhất
```

**Q6. Tại sao không lưu tiền bằng `FLOAT`?**
Binary float không thể biểu diễn chính xác số thập phân (0.1 + 0.2 ≠ 0.3), gây rounding drift khiến ledger không thể reconcile. Hãy dùng `DECIMAL(19,4)` hoặc lưu integer minor units (cents). Khi DB đã an toàn, phía Java cũng phải an toàn: không bao giờ map tiền sang `double`:

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
PK là `UNIQUE NOT NULL`, đồng thời là điểm neo định danh của bảng; một bảng có đúng một PK nhưng có thể có nhiều constraint `UNIQUE`. Cái bẫy nằm ở ngữ nghĩa của NULL: trong Postgres, `UNIQUE` coi các NULL là khác nhau, nên hai row cùng có `NULL` ở cột unique vẫn hợp lệ. Điều này thường gây bất ngờ khi ta muốn ép quy tắc "mỗi user một email":

```sql
-- WRONG: cho phép vô hạn row email NULL
CREATE TABLE users (email TEXT UNIQUE);
INSERT INTO users VALUES (NULL), (NULL);   -- thành công trong Postgres!

-- RIGHT: ép "tối đa một NULL" bằng partial unique index
CREATE UNIQUE INDEX one_null_email ON users (email) WHERE email IS NOT NULL;
```

**Q8. Khác nhau giữa `DELETE`, `TRUNCATE`, và `DROP`?**
`DELETE` là DML: xóa từng row, kích hoạt trigger, ghi WAL và để lại dead tuples (bloat). `TRUNCATE` là thao tác metadata nhanh; nó giải phóng cả pages thay vì xử lý từng row, nên xóa 10M rows chỉ mất ~ms trong khi `DELETE` mất hàng chục giây. `DROP` xóa vĩnh viễn bảng và các index của bảng:

```sql
-- DELETE: 10M rows từng dòng một, ~30–60 s, làm bảng phình vì dead tuples
DELETE FROM logs WHERE created_at < '2024-01-01';
-- TRUNCATE: giải phóng mọi pages một lượt, ~1 ms, không filter được
TRUNCATE logs;
-- DROP: bảng và mọi index của nó biến mất
DROP TABLE logs;
```

**Q9. SQL injection là gì và `PreparedStatement` chặn nó bằng cách nào?**
SQL injection xảy ra khi input của user bị nối thẳng vào chuỗi SQL; input được parse như _code_, không phải _data_. Cách sửa là parameterization: driver gửi giá trị qua một kênh riêng, nên `' OR 1=1 --` chỉ được xem là một chuỗi. Prepared statement còn tái sử dụng plan đã parse, tiết kiệm chi phí parse (~10–50 µs) cho mỗi lần thực thi lặp lại: vừa đúng vừa nhanh:

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
`NULL` nghĩa là "không biết", và mọi phép so sánh với nó đều cho ra `NULL`, giá trị mà `WHERE` xem như false. Vì vậy, `WHERE x = NULL` không khớp với row nào, một bug huyền thoại. Aggregate cũng bỏ qua NULL, nên `AVG` trên cột có NULL sẽ bỏ qua các row đó. `COALESCE` và `NULLIF` là những công cụ dùng hằng ngày:

```sql
-- WRONG: khớp 0 row, lần nào cũng vậy
SELECT * FROM orders WHERE discount = NULL;
-- RIGHT
SELECT * FROM orders WHERE discount IS NULL;
-- điền default để hiển thị, không làm hỏng giá trị lưu trữ
SELECT COALESCE(discount, 0) AS discount FROM orders;
```

**Q11. Normalization là gì và khi nào denormalize?**
Normalization loại bỏ redundancy: 1NF yêu cầu các cột nguyên tử, 2NF loại bỏ dependency bộ phận, và 3NF loại bỏ dependency chuyển tiếp. Lợi ích là loại bỏ update anomaly; cái giá phải trả là các join bổ sung. Một bản sao denormalized của `customer_name` trên mỗi order có nghĩa là một lần đổi tên sẽ phải cập nhật hàng triệu rows. Tuy nhiên, một bảng report lặp lại giá trị denormalized có thể biến join 5 chiều (~50–200 ms trên 100k rows) thành một lần đọc (~5–20 ms). Hãy denormalize có chủ đích ở biên, không phải vô tình trong schema OLTP:

```sql
-- WRONG (không 3NF): tên customer lặp lại trong mọi row order —
-- đổi tên customer là phải viết lại mọi order (update anomaly)
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_name TEXT, amount DECIMAL(19,4));

-- RIGHT: tham chiếu bằng id, chỉ join khi cần tên
CREATE TABLE customers (id BIGINT PRIMARY KEY, name TEXT);
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL, amount DECIMAL(19,4));
```

**Q12. Regular view vs materialized view?**
Regular view là một query được lưu: nó chạy lại mỗi lần truy cập, luôn mới và không tốn storage. Materialized view là snapshot đã tính sẵn và được lưu trên đĩa: đọc chỉ mất vài ms, nhưng dữ liệu sẽ cũ cho đến khi bạn `REFRESH`; thao tác này tính lại view, có thể mất vài giây và chặn reader ở một số engine. Quy tắc: data cần cập nhật → view; aggregation chậm nhưng có thể chấp nhận độ trễ → materialized view:

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
`OFFSET` không bỏ qua công việc; DB vẫn quét rồi loại bỏ số rows được offset. Trang 1000001 có chi phí tương đương việc quét 1M rows. Keyset pagination ("seek") dùng trực tiếp index và có độ phức tạp O(kích thước trang), bất kể độ sâu:

```sql
-- WRONG khi scale: OFFSET 1000000 → quét + vứt 1M rows, ~50–200 ms và tăng dần
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 1000000;
-- RIGHT: seek trên index — ~1–5 ms ở bất kỳ độ sâu nào, và ổn định khi insert
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 20;
```

**Q14. Quản lý transaction từ JDBC thế nào?**
JDBC mặc định bật autocommit: mỗi statement là một transaction riêng, nên một transfer gồm hai statement có thể chỉ commit một nửa. Hãy tắt autocommit, thực hiện công việc, gọi `commit()` và gọi `rollback()` khi thất bại. Hai nguyên tắc senior luôn tuân theo: transaction gắn với connection, vì vậy không bao giờ để connection từ pool thoát ra mà chưa được trả lại, và luôn giải phóng connection trong `finally`:

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
B-tree là lựa chọn mặc định cho equality, range và ordering. Hash index chỉ phù hợp với equality và hiếm khi vượt B-tree trong Postgres. GIN index phục vụ các query "chứa" trên array, jsonb và full-text. BRIN là quân bài bị xem nhẹ: với các bảng khổng lồ được sắp xếp vật lý theo thứ tự, chẳng hạn time series, nó lưu thông tin tóm tắt theo block, nên một B-tree ~1 GB trên 100 GB log có thể thu gọn còn ~1 MB:

```sql
CREATE INDEX ix_orders_btree ON orders (created_at);          -- range scan, ORDER BY
CREATE INDEX ix_orders_gin ON orders USING GIN (tags);        -- WHERE 'urgent' = ANY(tags)
CREATE INDEX ix_logs_brin ON logs USING BRIN (created_at);    -- nhỏ hơn ~100x, vẫn nhanh
```

**Q16. Đọc output `EXPLAIN` thế nào?**
`EXPLAIN` hiển thị cây plan của planner: loại node (Seq Scan vs Index Scan vs Index Only Scan vs Hash Join vs Nested Loop), cost và số rows ước tính; với `ANALYZE`, nó còn hiển thị thời gian và số rows thực tế. Đơn vị "cost" xấp xỉ thời gian đọc một trang tuần tự (~0.01 ms), nên hãy so sánh loại node thay vì các con số tuyệt đối. Cờ đỏ là sự chênh lệch giữa `rows` ước tính và thực tế. Nếu lệch nhau 100x, statistics đã cũ (hãy chạy `ANALYZE`) hoặc query đang bọc cột trong một function:

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;
-- Seq Scan on orders  (cost=0.00..185000.00 rows=5000 width=32)
--                    (actual time=0.012..1250.0 rows=5000 loops=1)
-- 10M rows bị đọc tuần tự vì không có index trên customer_id;
-- thêm ix_orders_customer biến nó thành Index Scan ~4 levels (~0.5 ms).
```

**Q17. `LIKE` dùng được index không, và tìm kiếm không phân biệt hoa thường thì sao?**
`LIKE 'foo%'` (không có wildcard ở đầu) có thể dùng B-tree; `LIKE '%foo%'` thì không, vì pattern không cho cây biết bắt đầu từ đâu, nên trở thành full scan 10M rows. Tìm kiếm không phân biệt hoa thường tạo thêm một vấn đề: `ILIKE` cũng ngăn việc sử dụng index. Giải pháp là dùng trigram GIN index cho tìm kiếm contains và expression index trên `lower(col)` cho prefix không phân biệt hoa thường:

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
B-tree giữ rows được sắp xếp theo cột được index, nên equality và range scan có độ phức tạp O(log n) thay vì O(n). Với 1B rows, B-tree chỉ sâu khoảng 4 level: khoảng 4 random read (~0.5 ms mỗi lần) để tìm một row, so với full scan 1B rows (~hàng chục giây). Một page chứa khoảng 200 entries; đó là fanout giúp cây luôn nông. Index trở nên vô dụng khi predicate bọc cột trong function hoặc kém chọn lọc đến mức trả về hơn ~20–30% số rows, khiến planner chọn quét tuần tự:

```sql
-- WRONG: function trên cột -> index created_at KHÔNG được dùng
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- RIGHT: range mà index phục vụ
SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

**Q19. Composite index là gì và leftmost-prefix rule?**
`(a, b, c)` được sắp theo `a`, rồi `b`, rồi `c`. Nó phục vụ query filter trên `a`, `(a,b)` hoặc `(a,b,c)`, nhưng không phục vụ `b` hay `c` riêng lẻ. Hãy sắp xếp theo độ chọn lọc: đặt cột chọn lọc nhất lên đầu sẽ rút ngắn việc đi qua cây nhanh nhất. Sai thứ tự cột sẽ tạo ra một index chết:

```sql
-- index: (customer_id, created_at)
SELECT * FROM orders
 WHERE customer_id = 42 ORDER BY created_at DESC;   -- dùng index ✓
SELECT * FROM orders WHERE created_at > '2024-01-01'; -- bỏ qua index ✗ (không có leftmost a)
-- index một cột trên cột nóng luôn thắng composite chết
CREATE INDEX ix_orders_created ON orders (created_at);
```

**Q20. Giải thích isolation levels và các anomaly của chúng.**
Mỗi level cao hơn giúp ngăn nhiều anomaly hơn, với cái giá là nhiều locking hoặc snapshotting hơn:

- **Read committed**: không dirty reads; non-repeatable reads có thể (cùng row khác nhau giữa txn).
- **Repeatable read**: nhất quán trong txn; phantoms và write skew vẫn có thể.
- **Serializable**: cô lập hoàn toàn, như chạy tuần tự — an toàn nhất, chậm nhất (có thể chậm hơn read committed 5–10× dưới contention).

Hầu hết engine mặc định dùng read committed. Level được đặt theo từng transaction, và Postgres chốt snapshot ở statement đầu tiên, nên `SET TRANSACTION` phải đứng trước mọi query:

```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT balance FROM accounts WHERE id = 1;   -- snapshot bị chốt tại đây
-- các commit từ txn khác sau điểm này vô hình trong suốt txn
COMMIT;
```

**Q21. Deadlock là gì và tránh nó thế nào?**
Hai transaction, mỗi cái giữ một lock mà cái kia cần. DB phát hiện vòng lặp trong wait-for graph và rollback một txn (Postgres ném `40P01`; MySQL ném `1213`). Hãy tránh deadlock bằng cách truy cập resource theo **thứ tự toàn cục nhất quán** và giữ txn ngắn: txn 10 ms giữ lock 10 ms, còn txn 10 s có HTTP call bên trong sẽ giữ lock 10 s:

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
ORM load N parent rồi phát ra N query con riêng lẻ. Với N=1000, đó là 1001 round-trip (mỗi cái khoảng 1–5 ms, cộng thêm ~1–5 s). Hãy sửa bằng join, batch fetch hoặc projection: một query, một round trip:

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
Mở một DB connection tốn ~5–20 ms (TCP, auth và backend process). Pool tái sử dụng các connection này. Pool sẽ cạn nếu bạn làm leak connection (không close trong `finally`) hoặc giữ một connection trong lúc thực hiện call chậm, khiến `HikariPool` ném `ConnectionTimeoutException` sau `connectionTimeout` (mặc định 30 s). Quy tắc ước lượng: `pool_size ≈ concurrency × (avg_query_ms / target_latency_ms)`:

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
Covering index lưu thêm cột (`INCLUDE`) trong các lá của B-tree, nên query không cần truy cập heap. Mỗi heap fetch là một random read (~0.1–0.5 ms); index-only scan chỉ đọc tuần tự các index page 8 KB. Với một report được dùng thường xuyên, cách này thường giảm 10–100× số I/O. Lưu ý: Postgres phải tham chiếu visibility map, vốn chỉ được `VACUUM` duy trì; một bảng vừa bị bloat có thể thoái hóa thành bitmap scan:

```sql
CREATE INDEX ix_orders_status ON orders (status) INCLUDE (total, created_at);
-- Index Only Scan — không heap fetch chút nào
SELECT total, created_at FROM orders WHERE status = 'shipped';
```

**Q25. Nested-loop, hash, và merge join khác nhau thế nào, và dùng mỗi loại khi nào?**
Nested loop có độ phức tạp O(N×M), nhưng mỗi lookup bên trong có index chỉ mất khoảng 0.1 ms, nên rất phù hợp khi phía outer nhỏ (100 rows × 1 lookup = 10 ms). Hash join dựng hash table trên một phía: O(N+M), là lựa chọn chủ lực cho các tập dữ liệu lớn không có index. Nó cần bộ nhớ (mặc định `work_mem` là 4 MB; tràn ra đĩa khiến nó chậm hơn 10–100×). Merge join cần input đã được sắp xếp và trả kết quả theo thứ tự, nên lý tưởng khi planner có thể lấy dữ liệu từ index và bạn vốn cần output có thứ tự:

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
Theo mô hình cost, random read chậm hơn ~10× so với đọc tuần tự, nên nếu index trả về hơn ~5–20% số rows của bảng thì quét tuần tự sẽ nhanh hơn. Bitmap heap scan là lựa chọn ở giữa: đọc index, dựng bitmap các page, rồi chỉ đọc tuần tự những page đó. Nếu `EXPLAIN` hiển thị `rows` ước tính sai lệch nghiêm trọng (100x), statistics đã cũ; hãy chạy `ANALYZE`:

```sql
-- 10M rows, 40% là 'pending': index trên status có, nhưng seq scan là ĐÚNG —
-- 4M heap read ngẫu nhiên (~vài chục giây) thua một lần quét tuần tự (~2–5 s)
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'pending';
-- khi một giá trị có selectivity tốt, planner sẽ hiện
-- Bitmap Heap Scan on orders -> Bitmap Index Scan on ix_orders_status
```

**Q27. `IN` vs `EXISTS` vs `JOIN` — cùng kết quả, khác plan?**
Cả ba đều diễn đạt được "orders của khách VIP", nhưng planner xử lý chúng khác nhau. `IN` thường được unnest thành semi-join; `EXISTS` dừng ở match đầu tiên; `JOIN` nhân rows nếu phía phải khớp nhiều hơn một lần, sau đó bạn phải trả giá cho `DISTINCT` (một lần sort, ~100 ms trở lên trên tập lớn). Với phép kiểm tra tồn tại thuần túy, semi-join chỉ quét phía phải đến match đầu tiên:

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
Check-then-insert dùng hai statement và tạo ra race condition: hai request đồng thời có thể cùng vượt qua `SELECT`, sau đó một request sẽ fail với unique violation (`23505`). Cách sửa là dùng một statement atomic, như `INSERT ... ON CONFLICT` (Postgres) hoặc `MERGE` chuẩn, để engine xử lý conflict ngay trong statement đó:

```sql
-- WRONG: check-then-act chạy đua dưới concurrency
SELECT 1 FROM inventory WHERE sku = 'A1';   -- cả hai request đều vượt qua
INSERT INTO inventory (sku, qty) VALUES ('A1', 5);  -- một cái nổ: 23505

-- RIGHT: atomic trong một statement; khi conflict, cộng thay vì fail
INSERT INTO inventory (sku, qty) VALUES ('A1', 5)
ON CONFLICT (sku) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty;
```

**Q29. Vì sao insert 10k rows từng dòng một chậm, và cái gì sửa nó?**
Mỗi `executeUpdate()` là một round trip trọn vẹn: ~0.5–5 ms trên LAN và 10–50 ms khi qua region. Insert 10k rows từng dòng nghĩa là ~10k round trips, tương đương ~10–50 s. `addBatch()`/`executeBatch()` chỉ flush mạng một lần cho mỗi batch, giảm cùng khối lượng công việc xuống ~100 ms, nhanh hơn khoảng 50–100×:

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
Repeatable read ngăn dirty read và non-repeatable read, nhưng không ngăn phantom hay **write skew**: hai txn cùng đọc snapshot, cùng ra quyết định dựa trên snapshot đó, rồi cùng commit, khiến invariant bị phá vỡ. Ví dụ on-call: hai bác sĩ cùng kiểm tra "còn người khác trực" trong snapshot của mình, rồi cả hai cùng off call và commit. Postgres phát hiện việc này ở SERIALIZABLE thông qua SSI và hủy một txn bằng `40001`; app phải retry:

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
Collection lazy chỉ được load khi truy cập. Bên ngoài transaction đang mở, việc truy cập sẽ ném `LazyInitializationException`; bên trong transaction, mỗi lần truy cập lại phát sinh một query (N+1 đúng vào thời điểm tệ nhất: lúc render view). `spring.jpa.open-in-view` chỉ che giấu vấn đề bằng cách giữ connection mở suốt request, đồng nghĩa mỗi request giữ một pooled connection. Hãy sửa ở query, không sửa bằng setting:

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
FK đảm bảo integrity nhưng không tạo index trên cột con trong Postgres. Mỗi lần xóa hoặc update một parent row, DB phải quét toàn bộ bảng con để kiểm tra tham chiếu. `ON DELETE CASCADE` còn làm tình hình tệ hơn: xóa 10k parent khỏi bảng con 50M-row không có index sẽ cần 10k full scan (mất hàng phút và giữ lock); có index thì chỉ cần 10k index lookup (mất vài giây):

```sql
-- WRONG: FK không index phía bảng con — cascade delete quét mọi thứ
CREATE TABLE order_items (order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE);
-- RIGHT: index cột FK
CREATE INDEX ix_order_items_order ON order_items (order_id);
-- và ưu tiên soft-delete hơn cascade cho thứ gì lớn: cascade mà
-- thầm lặng xóa 1M row con là một production incident đang chực nổ
```

**Q33. `BIGSERIAL` vs `UUID` primary keys — khi nào nó cắn bạn?**
Khóa tuần tự giữ B-tree ở dạng append-only: rows mới rơi vào mép phải và không gây page split. UUID ngẫu nhiên rải insert khắp cây; các insert làm split page và để page trống khoảng một nửa, khiến index phình thêm ~10–30% và insert chậm hơn 2–5×. Tuy nhiên, UUID có thể được sinh ở phía client (không cần round trip và không tranh chấp sequence) và phù hợp với sharding. Giải pháp dung hòa là dùng `BIGSERIAL` tăng dần làm PK, còn UUID là một `UNIQUE` key riêng cho public API:

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
Cả ba đều sinh số; khác biệt nằm ở nơi thực hiện việc tăng số và việc app có thể tự cung cấp giá trị hay không. `SERIAL`/`BIGSERIAL` dùng sequence thông qua một default, nên app vẫn có thể insert id tường minh. `GENERATED ALWAYS AS IDENTITY` cấm giá trị tường minh vì DB là writer duy nhất. Một sequence độc lập tách việc cấp phát id khỏi bảng, tiện cho batching (pre-fetch một dải id) nhưng dễ dùng sai. Điểm cần lưu ý là id tường minh có thể đụng với dải sequence, và sequence không rollback khi txn fail. Gap là điều bình thường, không phải bug:

```sql
CREATE TABLE a (id BIGSERIAL PRIMARY KEY);             -- default từ sequence
CREATE TABLE b (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY);  -- DB sở hữu
CREATE SEQUENCE order_seq START 1000;                  -- cấp phát tự làm
-- lấy 1000 id trong một round trip giúp batch insert được (Q29)
SELECT nextval('order_seq') FROM generate_series(1, 1000);
```

## Senior — thiết kế & bảo vệ

**Q35. Report query trên bảng 500M row bị timeout. Đi qua quy trình chẩn đoán và fix.**
"Tôi bắt đầu bằng `EXPLAIN ANALYZE`; thường sẽ thấy sequential scan vì predicate bọc cột trong function hoặc index không khớp leftmost prefix. Nếu là aggregation, materialized view được refresh mỗi 5–15 phút có thể biến scan 30 s thành read 50 ms. Nếu dữ liệu phải luôn live, **covering index** cho phép planner dùng index-only scan mà không cần heap fetch. Bằng chứng trước và sau:"

```sql
-- Trước: Seq Scan on orders  (cost=0.00..8_500_000 rows=120_000_000)
-- Sau khi thêm (status, created_at) INCLUDE (total):
--   Index Only Scan using ix_orders_status_created ... (cost=0.00..1_200)
CREATE INDEX ix_orders_status_created ON orders (status, created_at) INCLUDE (total);
```

"Tôi xác nhận p95 giảm từ ~30 s xuống <100 ms: đo lường, không đoán mò."

**Q36. Thiết kế schema cho 1M orders/ngày. Chiến lược index?**
"Tôi partition theo tháng (range partitions) để archive data cũ và giúp các query gần đây phải scan ít hơn. Tôi thêm index `(customer_id, created_at)` cho 'my orders, newest first' (leftmost prefix và sort). Tôi tránh index mọi cột: mỗi index thêm ~10–20% write amplification, và ở mức 1M row/ngày, con số đó đáng kể. Tôi đẩy analytics nóng sang read replica và giữ write path chỉ còn 1–2 index trên mỗi bảng nóng:"

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
"Với transfer path, tôi dùng `REPEATABLE READ` hoặc `SERIALIZABLE`; non-repeatable read có thể gây double-debit. Cái giá là nhiều lock hơn và có thể gặp serialization failure (Postgres `serialization_failure`, SQLSTATE 40001) khi contention, nên tôi giữ các txn này thật nhỏ (chỉ tính balance) và retry khi gặp 40001. Với reporting đọc nhiều, tôi dùng `READ COMMITTED` trên replica. Anomaly không thể chấp nhận sẽ quyết định level: chỉ trả giá cho isolation ở nơi có tiền:"

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
"Tôi query `pg_locks` join `pg_stat_activity` để tìm PID đang chặn và statement của nó. Chín trên mười lần, nguyên nhân là một txn dài giữ row lock trong lúc thực hiện slow external call, khiến lock tồn tại vài giây thay vì vài ms. Tôi thu nhỏ txn còn các write tối thiểu, đẩy việc chậm ra ngoài txn và set `lock_timeout = 2s` để txn bị chặn fail nhanh thay vì gây cascade. Tôi đo lock-wait time trước và sau:"

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
"Khi query phức tạp (deep join, window function hoặc bulk update) hoặc được gọi thường xuyên, SQL do JPA sinh ra có thể opaque và thường gây N+1 query. Tôi dùng `JdbcTemplate` hoặc jOOQ với đúng các cột cần thiết; SQL có thể review và plan có thể dự đoán. Với data dạng CRUD, JPA vẫn là con đường phát triển nhanh hơn. Quyết định được đưa ra theo từng query, không theo từng project:"

```java
// WRONG: load cả entity graph, rồi mới lấy một field
Order o = repo.findById(42L).get();  // + lazy collections = N+1
// RIGHT: một projection, một query
String sql = "SELECT status, total FROM orders WHERE id = ?";
return jdbcTemplate.queryForObject(sql,
    (rs, r) -> new OrderView(rs.getString(1), rs.getBigDecimal(2)), id);
```

**Q40. Phòng thủ connection-pool size bằng Little's Law.**
"`pool ≈ target_concurrency × (avg_query_ms / acceptable_latency_ms)`. Với average 5 ms và 200 request đồng thời, kết quả là ~200 × (0.005 / 0.1) ≈ 10; cộng thêm biên độ cho variance thành ~20–30, không phải 200. Pool quá lớn lãng phí DB connection (mỗi connection giữ một backend process và ~5–10 MB) và có thể làm throughput _tệ đi_ vì lock contention. Tôi set `maximumPoolSize` dựa trên số liệu thực tế, monitor wait time và tune:"

```java
HikariConfig cfg = new HikariConfig();
cfg.setMaximumPoolSize(30);        // Little's Law ~10, pad lên 20–30
cfg.setConnectionTimeout(2000);    // fail nhanh — đừng queue 30 s khi DB ốm
cfg.setValidationTimeout(1000);
cfg.setLeakDetectionThreshold(10_000);  // bắt leak connection trong test
```

**Q41. Partial và expression index — ngân sách index nên đi đâu?**
"Index mọi cột là cách khiến write-heavy service chết. **Partial index** chỉ index những rows mà query thực sự cần (ví dụ 1% của bảng): nhỏ hơn 100×, chi phí duy trì thấp hơn khoảng 100× nhưng vẫn giữ nguyên tốc độ query. **Expression index** index đúng function bạn gọi: `WHERE lower(email) = ?` không dùng được index thường trên `email`, nhưng dùng được index trên `lower(email)`. Cả hai giúp tôi giữ write amplification dưới ngân sách ~20% khi scale:"

```sql
-- partial: chỉ 1% rows ở trạng thái 'open' được index
CREATE INDEX ix_orders_open ON orders (created_at) WHERE status = 'open';
-- expression: index hàm, không index cột
CREATE INDEX ix_users_email_lower ON users (lower(email));
SELECT * FROM users WHERE lower(email) = 'dev@example.com';   -- giờ dùng được nó
```

**Q42. Partitioning — khi nào nó giúp và khi nào nó phản tác dụng?**
"Range partitioning theo tháng đáng giá khi (a) query filter trên partition key, để pruning bỏ qua cả partition, và (b) bạn loại bỏ data bằng `DETACH`/`DROP PARTITION`, là thao tác metadata O(1) thay cho `DELETE` vốn gây bloat và lock. Nó phản tác dụng khi quy mô còn nhỏ: mỗi partition thêm planner overhead, và query _không_ filter trên key sẽ quét mọi partition. Hash partitioning dàn hot write qua các shard nhưng không giúp range query. Quy tắc ước lượng: partition khi bảng lớn hơn ~100 GB hoặc ~100M rows, và luôn đưa partition key vào các predicate nóng:"

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
"Async replica có thể lag từ vài chục ms đến vài giây dưới tải, nên user vừa đặt order xong nhưng đọc từ replica có thể thấy '0 orders'. Đây là bài toán read-your-writes. Tôi route data của chính user đó về primary trong một cửa sổ ngắn sau write (session affinity), đồng thời monitor `pg_stat_replication` để đưa replica bị lag ra khỏi rotation trước khi report âm thầm lệch. Dashboard trên replica phải nói rõ ngân sách staleness của nó:"

```sql
-- trên replica, lag = replica cách primary bao xa
SELECT replay_lag FROM pg_stat_replication;
-- chốt chặn phía app cho luồng write-then-read:
-- nếu request được chính USER này ghi trong 5 s vừa qua → đánh vào primary
```

**Q44. Giữ DB và message broker nhất quán thế nào?**
"Ghi row và publish event trong hai transaction riêng là dual-write: nếu process crash ở giữa, event sẽ mất vĩnh viễn. **Transaction outbox** đặt event vào cùng DB transaction, khiến thao tác atomic theo thiết kế; sau đó một poller publish rồi xóa event. Event không bao giờ mất, chỉ bị trễ tối đa bằng poll interval (~100 ms–1 s), một cái giá rất đáng để 'không bao giờ mất event refund':"

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
"Optimistic locking (một cột `@Version`) không tốn chi phí cho đến lúc commit: UPDATE kiểm tra version, và nếu người khác đã ghi trước, 0 rows khớp, nên bạn retry toàn bộ txn. Pessimistic locking (`SELECT ... FOR UPDATE`) giữ row lock từ lúc read đến lúc commit. Cách này đúng đắn, nhưng txn chậm sẽ khiến mọi người khác phải chờ. Với web traffic, optimistic thường thắng: contention thường dưới 5% request, nên một lần retry hiếm hoi vẫn tốt hơn việc giữ lock trong toàn bộ request trung vị:"

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
"Một row tương ứng với một lock: mọi update bị tuần tự hóa, giới hạn ở ~1–5k updates/s trên row đó dù có bao nhiêu app instance. Với counter (like, lượt xem hoặc số ghế còn lại), hãy **shard row**: chia count thành N bucket, mỗi request ghi vào một bucket và dùng `SUM` khi đọc. Cách này chỉ hiệu quả khi total có thể hơi cũ hoặc bucket vốn đã là per-request. Không bao giờ dùng cho tiền, nơi một row duy nhất cộng với retry mới là thiết kế đúng đắn:"

```sql
-- WRONG: mọi like đập vào cùng một row — một lock, một writer nối tiếp
UPDATE posts SET likes = likes + 1 WHERE id = 9;

-- RIGHT: 64 shard — 64 writer đồng thời trên cùng một counter logic
UPDATE post_likes SET n = n + 1
WHERE post_id = 9 AND shard = (random() * 63)::int;   -- chọn một bucket
SELECT SUM(n) FROM post_likes WHERE post_id = 9;      -- đọc = tổng các bucket
```

**Q47. Vì sao bảng to lên dù không insert, và bloat là gì?**
"MVCC nghĩa là một UPDATE tạo ra row version mới; bản cũ trở thành **dead tuple**, chỉ `VACUUM` mới thu hồi được. Nếu autovacuum không theo kịp (mặc định kích hoạt ở 20% dead tuple cộng 50 rows), bảng và các index của nó sẽ phình to: bảng chứa 1 GB data sống có thể chiếm 5 GB, và mọi scan cùng index walk đều chậm đi 'vô cớ'. Tôi theo dõi `pg_stat_user_tables`; khi dead tuple vượt ~30% live tuple, tôi chạy `VACUUM` (rẻ) hoặc `VACUUM FULL`/`pg_repack` (thu hồi không gian nhưng có lock, nên phải lên lịch):"

```sql
SELECT relname, n_dead_tup, n_live_tup,
       round(100.0 * n_dead_tup / greatest(n_live_tup, 1), 1) AS dead_pct
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 5;
-- dead > 30% live → bloat đang tốn tiền bạn; VACUUM thu hồi tuple,
-- VACUUM FULL dựng lại file (lock ACCESS EXCLUSIVE — làm trong cửa sổ bảo trì)
```

**Q48. `ALTER TABLE` trên bảng 500M row — làm sao không downtime?**
"Hai mối nguy chính là table rewrite và lock `ACCESS EXCLUSIVE`. Postgres 11+ biến `ADD COLUMN ... DEFAULT` thành thao tác chỉ trên metadata (~ms, không rewrite), nhưng `NOT NULL` vẫn quét bảng và cách dựng index thông thường vẫn khóa writer. Chuỗi an toàn là: thêm cột, backfill theo lô, thêm constraint với `NOT VALID`, rồi `VALIDATE` (recheck không khóa). Với index, luôn dùng `CREATE INDEX CONCURRENTLY`:"

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
"Đầu tiên, tôi nghi ngờ statistics. Ước tính `rows` của planner dẫn dắt mọi quyết định join; nếu bảng lớn gấp 100× kể từ lần `ANALYZE` cuối, planner vẫn nghĩ bảng có 100k rows và chọn nested loop thay vì hash join, khiến query chậm hơn 100×. Thứ hai, phân bố dữ liệu đã thay đổi (một cột từng 50/50 nay thành 99/1). Thứ ba, chính index đã bị bloat. Quy trình không bao giờ là tune mù: chạy `EXPLAIN (ANALYZE, BUFFERS)`, so sánh với plan cũ và kiểm tra `last_analyze`:"

```sql
SELECT relname, last_analyze, last_autoanalyze, n_mod_since_analyze
FROM pg_stat_user_tables WHERE relname = 'orders';
-- n_mod_since_analyze >> 10% bảng → statistics đang nói dối planner
ANALYZE orders;   -- refresh stats, rồi chạy lại EXPLAIN trước khi đụng vào bất cứ thứ gì
```

**Q50. Câu chuyện backup và recovery của bạn — kèm số liệu?**
"Chiến lược backup là một hợp đồng: **RPO** (có thể mất bao nhiêu data) và **RTO** (mất bao lâu để khôi phục). Với Postgres, WAL archiving liên tục cho RPO tính bằng giây: một base backup cộng với mọi WAL segment cho phép tôi recovery đến bất kỳ thời điểm nào. Logical dump (`pg_dump`) của DB 1 TB mất hàng giờ, nên phù hợp cho schema và portability, không phải disaster recovery. Điều không thể thương lượng là phải restore lên staging theo lịch và đo thời gian. Ngày chúng ta cần backup không phải là ngày học cách sử dụng nó:"

```sql
-- tạo restore point để một deploy hỏng chỉ cần một lệnh để lùi lại
SELECT pg_create_restore_point('before_deploy_v42');

-- bài tập restore: base backup + replay WAL đến restore point
-- pg_restore -d appdb latest.dump       (logical — schema/portability)
-- pg_basebackup + replay WAL archive    (physical — RPO cấp giây)
-- RPO ≈ WAL đã archive gần nhất (giây); RTO ≈ restore base + replay WAL (phút)
```

#### Tự kiểm tra

- [ ] Tôi viết được DDL/DML cho PK/FK/index, giải thích được three-valued logic của NULL, các biến thể `COUNT`, và cột tiền — kèm code, và nói được vì sao `FLOAT` bị cấm?
- [ ] Tôi giải thích được B-tree/composite/covering index, vì sao planner bỏ qua index (selectivity, function wrap), N+1, JDBC batching, và thang isolation levels với từng anomaly cụ thể?
- [ ] Tôi chẩn đoán được query chậm từ output `EXPLAIN ANALYZE` và sửa bằng index đúng — không đoán mò?
- [ ] Tôi phòng thủ được các lựa chọn schema (partitioning, `BIGSERIAL` vs UUID, outbox, sharded counters, pool sizing) bằng số liệu và failure modes?
- [ ] Tôi xử lý được lock waits, bloat, `ALTER TABLE` an toàn, một plan đột nhiên thoái hóa, và câu chuyện backup với lệnh thật và RPO/RTO?
