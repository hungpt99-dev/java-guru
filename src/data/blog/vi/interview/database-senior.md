---
title: "Ôn thi Java #4: Database & SQL — Junior đến Senior"
description: "Tầng database quyết định scale thực tế. Ứng viên senior phải nói lưu loát về indexing, transaction isolation, connection pooling, và cái bẫy ORM."
pubDatetime: 2026-08-10T10:15:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - database
  - sql
---

Database là nơi "chạy trên máy tôi vẫn ok" chết. Junior viết `SELECT *` và thắc mắc tại sao prod chậm; senior giải thích được tại sao query quét tuần tự và index nào sửa nó. Bài này leo từ join đến isolation anomaly đến pool exhaustion.

> Mindset: junior viết query trả đúng rows; senior viết query trả đúng rows _và_ không gục site ở 10x traffic.

## Junior — nền tảng

**Q1. Primary key, foreign key, và index là gì?**
Primary key định danh duy nhất một row (ép unique + not null). Foreign key tham chiếu PK ở bảng khác, ép referential integrity. Index là cấu trúc dữ liệu (thường B-tree) tăng tốc lookup trên cột với giá write overhead và storage. Không có index, `WHERE` quét whole table.

**Q2. Khác nhau giữa `INNER JOIN` và `LEFT JOIN`?**
`INNER JOIN` chỉ trả row có match ở cả hai bảng. `LEFT JOIN` trả mọi row từ bảng trái, với cột bảng phải tương ứng hoặc NULL khi không match. Bug kinh điển: dùng `INNER` khi cần orphaned row, thầm drop data.

**Q3. Khác nhau giữa `WHERE` và `HAVING`?**
`WHERE` filter row _trước_ group; `HAVING` filter group _sau_ `GROUP BY`. Bạn không dùng aggregate trong `WHERE` (`WHERE COUNT(*) > 1` không hợp lệ); dùng `HAVING`.

**Q4. Transaction và ACID là gì?**
Transaction gộp các operation thành đơn vị all-or-nothing. ACID: **A**tomicity (tất cả hoặc không), **C**onsistency (chuyển trạng thái hợp lệ), **I**solation (txn đồng thời không can thiệp), **D**urability (data committed sống sót crash). Bank transfer là ví dụ sách giáo khoa: debit và credit phải cùng xảy ra hoặc không.

**Q5. Khác nhau giữa `COUNT(*)`, `COUNT(col)`, và `COUNT(DISTINCT col)`?**
`COUNT(*)` đếm row (kể cả NULL). `COUNT(col)` đếm giá trị non-NULL trong cột đó. `COUNT(DISTINCT col)` đếm giá trị unique non-NULL. Trộn lẫn chúng đổi số của bạn thầm lặng.

**Q6. Kiểu cột nào lưu tiền và tại sao không `FLOAT`?**
Đừng lưu tiền bằng `FLOAT`/`DOUBLE` — binary floating point không biểu diễn decimal exact (0.1 + 0.2 ≠ 0.3), gây rounding drift. Dùng `DECIMAL(p, s)` / `NUMERIC` (exact, fixed scale) hoặc lưu integer minor units (cents). Cách "integer cents" tránh decimal math hoàn toàn trong code.

## Mid — tradeoff & điểm mù

**Q1. B-tree index hoạt động ra sao, và khi nào vô dụng?**
B-tree index giữ row sort theo cột indexed, nên equality và range scan là O(log n) thay vì O(n). Với 1B row B-tree sâu ~4 level — ~4 random read để tìm một row. Nó vô dụng khi: predicate dùng function trên cột (`WHERE YEAR(created) = 2024` không dùng được index `created` — dùng functional/indexed expression hoặc range), hoặc filter quá unselective (trả >~20–30% row) planner thích full scan.

**Q2. Composite index và leftmost-prefix rule là gì?**
Composite (multi-column) index như `(a, b, c)` sort theo a, rồi b, rồi c. Nó phục vụ query filter trên `a`, `(a, b)`, hoặc `(a, b, c)` — **leftmost prefix** — nhưng KHÔNG phục vụ query chỉ filter trên `b` hay `c`. Sắp xếp cột theo selectivity và theo predicate bạn thực dùng. Thứ tự cột sai là dead index.

**Q3. Giải thích transaction isolation level và anomaly.**

- **Read uncommitted**: thấy dirty (uncommitted) read. Hiếm dùng.
- **Read committed**: không dirty read, nhưng non-repeatable read (cùng row khác nhau giữa các read trong một txn).
- **Repeatable read**: read row nhất quán trong txn; vẫn có thể phantom read (row mới xuất hiện).
- **Serializable**: full isolation, như chạy serial — an toàn nhất, chậm nhất.
  Hầu hết engine mặc định read committed (Postgres repeatable read). Isolation cao hơn = ít anomaly hơn = nhiều lock/overhead hơn.

**Q4. Deadlock là gì và tránh thế nào?**
Deadlock là hai txn mỗi cái giữ lock cái kia cần. Database phát hiện và rollback một. Tránh bằng **truy cập resource theo thứ tự global nhất quán** (luôn update account theo ID), giữ txn ngắn, và không giữ lock qua network call. Luôn sẵn sàng retry txn bị rollback.

**Q5. N+1 query problem là gì và fix thế nào?**
ORM load list N parent, rồi issue N query riêng cho child ("N+1"). Fix: eager fetch / `JOIN FETCH` / batch fetch (`@BatchSize`) để thành 1 hoặc vài query. N+1 là silent performance killer #1 trong JPA/Hibernate — đẹp ở test (data nhỏ) và tan chảy ở prod.

**Q6. Connection pooling là gì và tại sao bạn cạn nó?**
Pool tái dùng DB connection (mở một cái tốn ~ms đến tens of ms). Bạn cạn nó bằng: (1) leak connection (quên close / không dùng try-with-resources), (2) giữ connection trong long transaction hay external call, (3) `maxPoolSize` quá thấp cho concurrency. Triệu chứng: `Timeout: could not get a connection`. Tune `maximumPoolSize` theo (core_concurrency × avg_query_time / target_latency) và không bao giờ làm slow work trên pooled connection.

## Senior — thiết kế & phòng thủ

**Q1. Một report query trên bảng 500M row timeout. Đi qua chẩn đoán và fix.**
"Tôi `EXPLAIN ANALYZE` nó — thường là sequential scan vì predicate bọc cột trong function, hoặc index không leftmost-matching. Nếu là aggregation report, tôi hỏi có cần real-time không: thường materialized view refresh mỗi 5–15 phút là đáp án đúng, biến scan 30 s thành read 50 ms. Nếu phải live, tôi thêm covering composite index để planner làm index-only scan. Tôi chứng minh fix bằng `EXPLAIN ANALYZE` before/after và confirm p95."

**Q2. Thiết kế schema cho orders table ở 1M orders/day. Indexing strategy?**
"Tôi partition theo time (vd monthly range partition) để archive partition cũ và query gần đây scan ít hơn. Index `(customer_id, created_at)` cho query phổ biến 'my orders, newest first' (leftmost prefix + sort), và index riêng trên `status` chỉ nếu selective. Tôi tránh index mọi cột — mỗi index làm chậm write, và ở 1M/day write amplification quan trọng. Tôi cũng chuyển hot analytics sang read replica / columnar store thay vì hammer primary."

**Q3. Chọn isolation level cho payment service thế nào, và phòng thủ bằng failure mode?**
"Cho payment tôi dùng `REPEATABLE READ` hoặc `SERIALIZABLE` trên critical transfer path — non-repeatable read ở đó có thể double-debit. Cái giá: nhiều lock hơn, có thể serialization failure dưới contention, nên tôi giữ txn đó thật nhỏ (chỉ balance math, không external call) và retry khi serialization fail. Cho read-heavy reporting tôi drop xuống `READ COMMITTED` trên replica. Phòng thủ là: anomaly bạn không chịu được quyết định level; bạn trả cho isolation chỉ ở nơi có tiền."

**Q4. Bạn thấy lock wait và timeout dưới tải vừa. Tìm nguyên nhân.**
"Tôi xem `pg_locks` / `SHOW ENGINE INNODB STATUS` cho blocking session và statement nó giữ. Chín trên mười là long transaction giữ row lock trong khi làm việc chậm (call, log, sleep) — lock bị giữ vài giây thay vì ms. Fix: thu nhỏ txn chỉ còn write tối thiểu, đẩy slow work ra ngoài, và thêm lock timeout để blocked txn fail nhanh thay vì cascade. Tôi đo lock-wait time trước/sau."

**Q5. ORM hay raw SQL — khi nào bỏ JPA cho hand-written SQL?**
"Khi query phức tạp (deep join, window function, bulk update) hoặc performance-critical, SQL JPA sinh ra opaque và thường làm N+1 hoặc fetch quá nhiều. Tôi dùng thin JDBC/`JdbcTemplate` hoặc jOOQ query với đúng cột cần, map sang DTO. Quy tắc: JPA cho CRUD trên entity đơn giản; hand-written SQL (hoặc jOOQ) cho report, bulk op, và hot path. Tôi không bao giờ để ORM che giấu full-table fetch trong production."

**Q6. Bạn phòng thủ con số connection-pool sizing cho team thế nào?**
"Tôi size nó từ Little's Law: `pool_size ≈ target_concurrency × (avg_query_time / acceptable_latency)`. Nếu query trung bình 5 ms và cần 200 concurrent, đó là ~200 × (0.005 / 0.1) ≈ 10, nhưng tôi pad cho variance và failover, chốt ~20–30, không 200. Oversize lãng phí DB connection (mỗi cái giữ memory + backend process) và có thể _tệ hơn_ throughput bằng tăng lock contention. Tôi set `maximumPoolSize` có chủ đích, monitor wait time, và tune từ số thật — không phải `200` vì 'nhiều hơn tốt hơn'."

#### Self-check

- [ ] Junior: Tôi giải thích được PK/FK/index, INNER vs LEFT join, WHERE vs HAVING, ACID, và tại sao không FLOAT cho tiền.
- [ ] Mid: Tôi giải thích được B-tree indexing, composite leftmost-prefix, isolation level, deadlock, N+1, và pool exhaustion.
- [ ] Senior: Tôi chẩn đoán được slow report query với EXPLAIN ANALYZE, thiết kế partitioning + indexing cho 1M/day, chọn isolation theo failure mode, và size connection pool từ Little's Law bằng số thật.
