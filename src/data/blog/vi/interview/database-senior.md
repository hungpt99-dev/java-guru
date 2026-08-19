---
title: "Ôn thi Java #4: Database và SQL"
description: "Tài liệu thực hành cho phỏng vấn về database và SQL: join, constraint, transaction, aggregation, SQL injection và các trade-off trong thiết kế schema và query."
pubDatetime: 2026-08-10T10:15:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - database
  - sql
---

Câu hỏi về database hiếm khi chỉ kiểm tra việc nhớ cú pháp SQL. Phần khó là giải thích database đảm bảo điều gì, một query tốn chi phí ở đâu, và thiết kế ứng dụng có thể lỗi thế nào khi có concurrency hoặc tải cao. Bài này bao phủ các câu hỏi nền tảng trong phần tài liệu được cung cấp, kèm ví dụ SQL và JDBC. Nội dung phân biệt hành vi database đã được xác lập với phần phân tích và đề xuất thiết kế.

## Junior: nền tảng

**Q1. Primary key, foreign key và index là gì?**

**[SOURCE FACT]** Primary key định danh một row và được ép là unique, non-null. Foreign key tham chiếu đến một key ở bảng khác và đảm bảo referential integrity. Index là một cấu trúc dữ liệu bổ sung, thường là B-tree, có thể giảm lượng công việc cần làm khi lookup và filter. Index cũng làm tăng chi phí lưu trữ và duy trì khi ghi.

**[ANALYSIS]** Foreign key thường không tự tạo index trên cột ở bảng con. Việc index cột này thường quan trọng khi application join bằng cột đó, hoặc khi database phải kiểm tra các row con trong lúc update hay delete parent được tham chiếu. Quyết định đúng còn phụ thuộc vào engine và workload; không nên mặc định index nào cũng có lợi.

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

**Q2. `INNER JOIN` khác `LEFT JOIN` thế nào?**

**[SOURCE FACT]** `INNER JOIN` trả về các row có điều kiện join khớp ở cả hai phía. `LEFT JOIN` trả về mọi row từ bảng bên trái và điền `NULL` vào các cột bên phải nếu không có row khớp.

**[ANALYSIS]** Một join có thể trả về nhiều row cho một row ở phía trái. Điều đó là đúng khi quan hệ là one-to-many. Chỉ dùng `DISTINCT` hoặc aggregation khi đó là kết quả mong muốn, không dùng chúng để che một join sai.

```sql
-- Loại các user không có order.
SELECT u.name, o.id
FROM users u
JOIN orders o ON o.user_id = u.id;

-- Giữ mọi user và trả về NULL cho user không có order.
SELECT u.name, o.id
FROM users u
LEFT JOIN orders o ON o.user_id = u.id;
```

**Q3. `WHERE` khác `HAVING` thế nào?**

**[SOURCE FACT]** `WHERE` lọc các row đầu vào trước khi grouping. `HAVING` lọc các group sau `GROUP BY`. Các aggregate expression như `COUNT(*)` thuộc về `HAVING`, không phải `WHERE`.

**[ANALYSIS]** Lọc trước aggregation có thể giảm lượng dữ liệu cần group và có thể cho phép optimizer dùng index phù hợp. Execution plan thực tế vẫn phụ thuộc vào database engine, statistics và các index hiện có.

```sql
-- Sai: aggregate được tính ở giai đoạn grouping.
SELECT user_id, COUNT(*)
FROM orders
WHERE COUNT(*) > 1
GROUP BY user_id;

-- Đúng.
SELECT user_id, COUNT(*)
FROM orders
GROUP BY user_id
HAVING COUNT(*) > 1;
```

**Q4. Transaction là gì, và ACID có nghĩa gì?**

**[SOURCE FACT]** Transaction gom các operation thành một đơn vị với cơ chế commit all-or-nothing. ACID là Atomicity, Consistency, Isolation và Durability. Bốn thuộc tính này mô tả cách database áp dụng transaction, giữ trạng thái hợp lệ, kiểm soát khả năng nhìn thấy công việc đồng thời và bảo toàn dữ liệu đã commit khi có sự cố. Mức đảm bảo cụ thể còn phụ thuộc vào database và isolation level.

**[ANALYSIS]** Một giao dịch chuyển tiền nên debit tài khoản này và credit tài khoản kia trong cùng một transaction. Transaction không tự làm cho business logic đúng: constraint, locking, isolation và error handling vẫn phải phù hợp với invariant cần bảo vệ.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT; -- ROLLBACK nếu một operation bắt buộc bị lỗi.
```

**Q5. `COUNT(*)`, `COUNT(col)` và `COUNT(DISTINCT col)` khác nhau thế nào?**

**[SOURCE FACT]** `COUNT(*)` đếm row. `COUNT(col)` đếm các giá trị non-`NULL` trong cột được chọn. `COUNT(DISTINCT col)` đếm các giá trị non-`NULL` không trùng nhau.

**[ANALYSIS]** Ba biểu thức trả lời ba câu hỏi khác nhau và không nên thay thế tùy tiện trong report. Việc count trên bảng lớn có thể tốn đáng kể công sức, trừ khi engine dùng được index phù hợp hoặc execution plan được tối ưu theo cách khác. Hãy đo plan thay vì mặc định `COUNT(*)` luôn rẻ.

```sql
SELECT COUNT(*) FROM orders;                         -- số row
SELECT COUNT(shipped_at) FROM orders;                -- ngày non-NULL
SELECT COUNT(DISTINCT customer_id) FROM orders;      -- customer duy nhất
```

**Q6. Tại sao không nên lưu tiền bằng `FLOAT`?**

**[SOURCE FACT]** Binary floating-point không thể biểu diễn chính xác nhiều phân số thập phân. Vì vậy phép tính có thể tạo ra sai số rounding, không an toàn với các giá trị phải reconcile trong ledger.

**[PROPOSED DESIGN]** Dùng kiểu decimal fixed-precision như `DECIMAL(19,4)`, hoặc lưu integer minor units nếu phù hợp với domain. Giữ representation nhất quán qua JDBC và Java; không chuyển amount decimal sang `double` trong application.

```sql
-- Ưu tiên representation fixed-precision cho amount dạng thập phân.
amount DECIMAL(19,4);
```

```java
// Giữ giá trị là BigDecimal xuyên suốt ranh giới JDBC.
BigDecimal total = rs.getBigDecimal("amount")
    .setScale(2, RoundingMode.HALF_EVEN);
```

**Q7. `UNIQUE` khác `PRIMARY KEY` thế nào?**

**[SOURCE FACT]** Primary key là constraint định danh của bảng, đồng thời unique và non-null. Một bảng có một primary key constraint, nhưng có thể có nhiều unique constraint. Trong PostgreSQL, unique constraint thông thường cho phép nhiều giá trị `NULL` vì `NULL` không được xem là bằng một `NULL` khác.

**[ANALYSIS]** Nếu yêu cầu là mỗi email không-NULL phải duy nhất, hãy khai báo cột là `NOT NULL` và unique. Nếu còn yêu cầu cả bảng có nhiều nhất một email bị thiếu, đó là một quy tắc riêng và cần constraint riêng. Partial unique index trên `email WHERE email IS NOT NULL` không ép được quy tắc thứ hai; nó chỉ ép tính duy nhất giữa các email non-null.

```sql
CREATE TABLE users (
  email TEXT
);

-- PostgreSQL: ordinary UNIQUE constraint cũng cho phép nhiều NULL.
CREATE TABLE nullable_users (
  email TEXT UNIQUE
);
INSERT INTO nullable_users VALUES (NULL), (NULL);

-- Ép tính duy nhất của các email có giá trị.
CREATE UNIQUE INDEX users_email_not_null
ON users (email)
WHERE email IS NOT NULL;

-- Nếu domain yêu cầu tối đa một NULL, hãy dùng constraint riêng
-- phụ thuộc database hoặc thiết kế rule đó một cách tường minh.
```

**Q8. `DELETE`, `TRUNCATE` và `DROP` khác nhau thế nào?**

**[SOURCE FACT]** `DELETE` xóa row và có thể dùng predicate. Đây là row-level DML và có thể kích hoạt các trigger áp dụng. `TRUNCATE` xóa toàn bộ row theo kiểu bulk operation của table và không hỗ trợ filter theo row. `DROP` xóa định nghĩa của table cùng các dependent object theo rule của database.

**[ANALYSIS]** Locking, transaction, trigger, việc reset identity và replication behavior của các operation này khác nhau giữa các database engine. Hãy chọn dựa trên semantics cần có, không dựa trên một giả định chung rằng operation nào luôn nhanh hơn. Với selective delete lớn, cần tính đến index usage, thời gian giữ lock và bảo trì table.

```sql
DELETE FROM logs WHERE created_at < DATE '2024-01-01';
TRUNCATE logs;
DROP TABLE logs;
```

**Q9. SQL injection là gì, và `PreparedStatement` ngăn nó thế nào?**

**[SOURCE FACT]** SQL injection xảy ra khi input không đáng tin cậy bị nối vào SQL text rồi được parser hiểu như một phần của statement. Parameterized query gửi cấu trúc SQL tách khỏi giá trị parameter, nên giá trị được xử lý như data thay vì SQL syntax.

**[PROPOSED DESIGN]** Bind mọi giá trị do user kiểm soát bằng parameter. Không dựng query bằng cách nối input. Parameter không thay thế authorization, validation hoặc việc xử lý cẩn thận các dynamic identifier như tên cột; identifier không thể bind như value thông thường và cần một allowlist.

```java
String sql = "SELECT id, email FROM users WHERE email = ?";
try (PreparedStatement statement = connection.prepareStatement(sql)) {
  statement.setString(1, emailFromRequest);
  try (ResultSet result = statement.executeQuery()) {
    // Đọc result như bình thường.
  }
}
```
