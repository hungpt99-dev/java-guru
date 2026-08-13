---
title: "Phỏng vấn Senior Java: Database và SQL"
description: "Tầng database quyết định scale thực tế. Ứng viên senior phải nói lưu loát về indexing, transaction isolation, connection pooling, và bẫy ORM."
pubDatetime: 2026-08-10T10:15:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - database
  - sql
---

Database là tầng quyết định hệ thống có scale được thật hay không — và phỏng vấn viên soi nó không phải để kiểm tra từ vựng, mà để xem bạn đã vào bếp bao giờ chưa. Junior thuộc lòng bốn mức cô lập. Senior kể được chính xác trace khi phantom xuất hiện, chứng minh composite index tới tận chiều cao của B-tree, giải thích vì sao pool 50 connection đánh bại pool 2000 connection, và chỉ ra _một_ metric đã chứng minh rằng pool — chứ không phải database — mới là nút thắt của tháng trước.

> Tư duy: nhả thuật ngữ thì bạn chỉ ở tầm mid-level. Đi qua một tradeoff bằng số thật và một failure mode trong production thì bạn chạm nốt "senior". Mỗi phần dưới đây đều kết bằng bài tập phỏng vấn viên thực sự hay chạy.

## Thang câu hỏi phỏng vấn (Junior → Mid → Senior)

> Tự drill to tiếng. Junior = "bạn có biết khái niệm"; Mid = "bạn có biết tradeoff"; Senior = "bạn có thể bảo vệ quyết định dưới áp lực, kèm một con số và một postmortem."

### Junior — nền tảng

- **Q: Khác nhau giữa clustered và non-clustered index?**
  A: Clustered index *chính là* bảng — các row được lưu theo thứ tự của nó (ở InnoDB là `PRIMARY KEY`), nên mỗi bảng chỉ có đúng một cái; lookup theo PK là một lần đi qua B-tree tới row. Non-clustered (secondary) index là một B-tree riêng, lá của nó trỏ về clustered key, nên một lookup qua secondary index mất hai bước: index → clustered key → row.

- **Q: Kể tên bốn mức cô lập transaction (isolation level).**
  A: Read uncommitted, read committed, repeatable read, serializable — tăng dần độ nghiêm ngặt. Chúng đánh đổi concurrency lấy việc ngăn anomaly.

- **Q: Primary key làm được gì mà unique constraint không làm?**
  A: PK là clustered key (InnoDB) — nó định nghĩa thứ tự vật lý của row và vừa non-null vừa unique. Unique constraint chỉ là một lời hứa non-clustered về tính duy nhất; bạn có thể có nhiều cái.

- **Q: Foreign key là gì, và `ON DELETE CASCADE` làm gì?**
  A: FK ràng buộc một cột phải tồn tại ở cột được tham chiếu của bảng khác. `CASCADE` khi xoá parent sẽ xoá (hoặc set null với `SET NULL`) các row con — tiện, nhưng một vụ mass delete có thể khoá / cascade nặng hơn bạn tưởng.

- **Q: Tại sao `SELECT *` lại tệ?**
  A: Nó kéo mọi cột (nhiều I/O, nhiều network), phá việc covering index (index không tự thoả mãn query được), và gãy khi thêm/bớt cột. Hãy gọi tên từng cột bạn cần.

### Mid — tradeoff & bẫy

- **Q: Tại sao `WHERE YEAR(created_at) = 2026` lại full scan dù `created_at` có index?**
  A: Hàm trên cột che giấu nó khỏi B-tree, nên optimizer không seek theo range được — nó scan từng row, áp hàm, lọc. Viết lại thành range trên cột gốc: `created_at >= '2026-01-01' AND created_at < '2027-01-01'`. Cùng bẫy: `LIKE '%x%'`, phép toán trên cột, ép kiểu ngầm.

- **Q: Khi nào composite index có ích, và quy tắc cột dẫn đầu là gì?**
  A: Composite index phục vụ các query lọc trên *tiền tố* của các cột, từ trái sang phải (leftmost-prefix rule). `(a, b, c)` giúp `WHERE a=?`, `(a,b)=?`, `(a,b,c)=?` nhưng KHÔNG giúp `WHERE b=?`. Đặt cột chọn lọc nhất / hay dùng nhất ở equality lên đầu, nhưng cũng cân nhắc cột có lợi cho predicate.

- **Q: N+1 query là gì và bạn giết nó thế nào?**
  A: Bạn lấy N parent, rồi một query riêng cho mỗi parent để lấy con = N+1 round trip. Sửa: một `JOIN`/`IN` batch, hoặc `@BatchSize`/`fetch join` trong ORM. Dấu hiệu: latency không bao giờ lộ trong một slow-query log vì mỗi call chỉ ~1 ms.

- **Q: Tại sao pool 2000 connection lại tệ hơn pool 50 connection?**
  A: Connection là tài nguyên *có hạn* mà DB phải schedule. Vượt `max_connections` của DB thì mọi request mới đều timeout; nhiều connection hơn cũng nghĩa là nhiều context-switch và lock contention hơn ở phía DB. Chọn size bằng Little's law (`TPS × avg_query_time`), không phải bằng core count của máy.

- **Q: Read committed vs repeatable read — anomaly nào mỗi cái vẫn cho phép?**
  A: Read committed vẫn cho phép *non-repeatable read* (cùng một row khác nhau giữa hai lần đọc trong một txn). Repeatable read vẫn cho phép *phantom read* (một range query trả về các row khác nhau). Serializable chặn cả hai — với giá là concurrency (thường qua range lock / SSI).

### Senior — thiết kế & bảo vệ

- **Q: Chọn size connection pool cho service 1,000 req/s với 20 ms avg query time. Giờ nếu 10% call mất 5 s thì sao?**
  A: `1000 × 0.02s = 20` connection là con số steady-state; `cores × 10` là heuristic khởi điểm tốt và HikariCP mặc định là 10. Nhưng 10% call 5 s cần `1000 × 0.1 × 5 = 500` connection *nếu* mỗi call chậm giữ một cái — nghĩa là vài query chậm có thể cạn pool và làm nghẽn 90% đường nhanh. Cách của senior là một pool *riêng* có bound (hoặc timeout + circuit breaker) cho đường chậm để nó không thể làm đói đường nhanh.

- **Q: "Index làm mọi thứ nhanh hơn." Bảo vệ hay phản bác — kèm chi phí phía write.**
  A: Phản bác. Mọi index đều được duy trì trên mỗi `INSERT`/`UPDATE`/`DELETE`: thêm nhiều lần đi B-tree, thêm page split, thêm WAL. Một bảng write-heavy với 8 index trả thuế duy trì gấp 8 lần và insert chậm hơn. Cách phòng thủ: index cho những query bạn thật sự chạy; drop các index vô dụng; cân nhắc read replica cho mấy truy vấn analytical nặng.

- **Q: Báo cáo nói "DB trung bình 0.1 ms nhưng app mất 800 ms." Bạn nhìn đâu trước?**
  A: Cái *pool*, không phải DB. Nếu cả thread pool và connection pool đều xếp hàng, request đợi đến lượt lấy connection trong khi DB thì rỗi. Kiểm tra pool saturation, `connectionTimeout`, và xem `wait` time có áp đảo `query` time không. Sửa thường không phải "to hơn DB".

- **Q: Đi qua một phantom read xuất hiện trong production và bạn đóng nó thế nào.**
  A: Một batch xử lý "tất cả order chưa trả", một txn khác insert một order chưa trả mới cùng range giữa chừng → batch lọt nó (hoặc đếm trùng khi retry). Phòng thủ: `REPEATABLE READ`/`SERIALIZABLE` với range lock, hoặc `SELECT … FOR UPDATE SKIP LOCKED` để claim row nguyên tử nên các worker concurrent không đụng nhau. Nêu rõ isolation level và loại lock.

- **Q: Bạn cần thêm index cho bảng 2 tỉ row mà zero downtime. Làm sao?**
  A: Dùng online/DDL tool (`CREATE INDEX CONCURRENTLY` ở Postgres; InnoDB online DDL với `ALGORITHM=INPLACE, LOCK=NONE`) build index mà không block write — nhưng vẫn tăng tải và có thể mất hàng tiếng ở scale lớn; làm trong maintenance window, monitor replication lag, và có rollback. Đừng bao giờ `LOCK=TABLE` trên bảng nóng.

#### Tự kiểm tra

- [ ] Junior: giải thích clustered vs non-clustered, 4 isolation level, PK vs unique, FK cascade, tại sao `SELECT *` tệ.
- [ ] Mid: viết lại predicate hàm-trên-cột thành range, nêu leftmost-prefix rule, giết N+1, chọn size pool bằng Little's law, kể anomaly mỗi isolation level vẫn cho phép.
- [ ] Senior: bảo vệ connection-pool sizing dưới đuôi slow-query, định lượng chi phí index phía write, trace một vụ phantom-read, và thêm index 2B-row online không downtime.

## 1. Indexing — nơi phỏng vấn hay "chết"

"Thêm index" là câu trả lời của người mới. Câu trả lời của senior giải thích vì sao cây index cao ba hay bốn tầng B-tree, cột nào đứng trước cột nào, vì sao optimizer vẫn ngoảnh mặt làm ngơ, và một index "hot" tốn bạn bao nhiêu trên mỗi lần ghi bạn không hề lên kế hoạch.

### Nội tại B-tree và bài toán chiều cao

Một node của B-tree là một page của database — 16 KB trong InnoDB (mặc định; 4/8/32/64 KB cấu hình được qua `innodb_page_size`), 8 KB trong Postgres. Một internal node chứa các cặp `(key, con trỏ tới node con)`, nên với key điển hình bạn nhét được vài trăm cặp mỗi page. Chiều cao tăng theo logarit của fanout:

```
Fanout ~300–700 key/page, row ~100–200 byte trong leaf page clustered:

~1M rows   → cao 3   (root + 1 internal + leaf)
~1B rows   → cao 4   (root + 2 internal + leaf)
~1T rows   → cao 5
```

Vì sao các con số đó? Một leaf page 16 KB chứa cỡ một trăm row, nên 1B row là ~10M leaf page. Các tầng internal chia đi theo fanout mỗi bước: ~10M / 500 ≈ 20K, / 500 ≈ 40, / 500 ≈ 1. Cái "1" cuối cùng là root — tổng chiều cao 4. Đây là phép toán đằng sau câu "index như phép màu": bốn cú nhảy con trỏ để chạm bất kỳ row nào trong bảng tỷ row, và mỗi cú nhảy chỉ là một page fetch.

Nhưng mỗi cú nhảy là một lần access page với chi phí khác biệt cực lớn tùy page đó nằm ở đâu:

```
Hit L1/L2 cache   → ~5–15 ns     (B-tree gần như miễn phí)
RAM / buffer pool → ~100 ns      (vì sao working set phải nằm trong memory)
SSD (leaf nguội)  → ~0.1–0.5 ms  (chậm hơn ba bậc độ lớn)
Đĩa từ            → ~5–10 ms     (chậm hơn bốn bậc độ lớn)
```

Vậy mục tiêu thiết kế của senior không phải "tạo index", mà là "**giữ các page index hot nằm trong buffer pool**". Một index tỷ row mà mỗi ngày mới quét một lần là thảm họa quét đĩa mỗi khi chạm tới; một covering index nhỏ và nóng là khoảng cách giữa lookup 100 ns và lookup 10 ms. Khi phỏng vấn viên hỏi "làm sao cho query này nhanh?", bước đầu tiên phải là page residency, không phải tạo index.

### Composite index — bản WRONG vs RIGHT

Câu hỏi tách người ta ra: "Đây là query — thiết kế index cho nó."

```sql
SELECT id, status, created_at
FROM orders
WHERE customer_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 20;
```

**WRONG — cách phần lớn junior trả lời:**

```sql
CREATE INDEX idx_orders_status   ON orders(status);          -- vô dụng: 99% row là 'paid'
CREATE INDEX idx_orders_customer ON orders(customer_id);     -- đúng cột, nhưng ép filesort
```

`status` cardinality thấp: 99% order là `'paid'`. Optimizer thấy selectivity tệ đến vậy thì hoặc full-scan, hoặc dùng index rồi lọc tiếp vài triệu row. Còn index `customer_id` đơn lẻ trả về toàn bộ lịch sử đơn hàng của khách, phải sort trên đĩa trước khi `LIMIT 20` — một filesort ngày càng chậm khi "tuổi" tài khoản tăng, rồi kéo theo temp table, rồi có thể tràn ra đĩa.

**RIGHT — equality trước, range/ordering cuối, leaf page đã sắp xếp:**

```sql
CREATE INDEX idx_orders_cust_status_created
  ON orders(customer_id, status, created_at DESC);
```

Ba quy tắc từ leftmost-prefix principle:

1. **Cột equality trước** — `customer_id` và `status` thu hẹp đường đi trên cây bằng phép so sánh `=`.
2. **Cột range/ordering cuối** — một cột range là điểm dừng; bất cứ thứ gì đứng sau nó không tham gia được vào đường đi.
3. **Khớp `ORDER BY`** — leaf page đã sắp theo `created_at DESC`, nên planner đi qua chúng đúng thứ tự và dừng sau 20 row. Không filesort, không temp table. Nếu bạn còn chỉ `SELECT` đúng các cột đã index, bạn có **index-only scan** — leaf page chứa tất cả, và clustered index (bản thân bảng) không bao giờ bị chạm.

```text
EXPLAIN:
type: ref
key: idx_orders_cust_status_created
rows: 20
Extra: Using index condition; Backward index scan
```

Bài tập phỏng vấn là xáo trộn các mệnh đề:

```sql
WHERE customer_id = ? AND created_at > ?          -- muốn (customer_id, created_at)
WHERE status = ? ORDER BY created_at LIMIT 20     -- muốn (status, created_at)
WHERE created_at > ? ORDER BY created_at LIMIT 20 -- riêng created_at, và nó đóng cả hai vai
```

`(created_at, customer_id)` thay vì `(customer_id, created_at)` là thứ tự ngây thơ và tệ hơn hẳn — range trên `created_at` chặn đường đi, nên `customer_id` không bao giờ được dùng để lọc. Phỏng vấn viên cực thích đảo chúng; hãy sẵn sàng biện hộ cho từng vị trí.

### Khi index phản bội bạn

- **Cardinality thấp.** Index trên `gender` hay `is_deleted` có thể tốn chi phí quét nhiều hơn chính bảng; planner lặng lẽ bỏ qua nó. Khi `EXPLAIN` cho thấy index được dùng mà `rows` vẫn bảy chữ số, đó là khẩu súng còn bốc khói — optimizer đang đi trên một index lọc gần như không gì cả.
- **Hàm và implicit cast.** `WHERE lower(email) = ?` làm index trên `email` vô dụng — cột bị biến đổi trước khi so sánh, nên cây không đi được. Tương tự `WHERE order_no = 12345` trên cột `VARCHAR`: mỗi row đều bị cast. Cách sửa: expression index trong Postgres (`CREATE INDEX ON users(lower(email))`), functional index trong MySQL 8.0.13+, generated column trong MySQL 5.7+, hoặc — đơn giản nhất — đừng lưu dữ liệu bắt buộc phải cast.
- **Wildcard ở đầu.** `LIKE '%guru'` không dùng được prefix index; `LIKE 'guru%'` thì đi được. Bản senior: full-text index hay trigram (`pg_trgm`) khi wildcard đầu là bất khả kháng.
- **Một range hay `IN` nằm giữa index.** `(a, b, c)` với `WHERE a = ? AND c = ?` trong khi `b` là range nghĩa là `c` chỉ lọc trong khoảng `b` đã fetch. Thứ tự cột là một hợp đồng; hỏi planner thì nó sẽ vui vẻ giải thích.
- **`NULL`.** Trong Postgres, `NULL` sort lên đầu theo mặc định và hầu hết loại index đều chứa chúng; `WHERE x IS NULL` dùng được index, nhưng index `UNIQUE` coi các `NULL` là khác nhau (cho phép nhiều `NULL`). Trong InnoDB, unique index cũng cho phép nhiều `NULL` — "unique" không có nghĩa "không null".
- **`EXPLAIN` ước lượng nói dối.** Dự đoán cũ của planner từ statistics lỗi thời đẩy bạn vào một plan tồi. `ANALYZE TABLE` (MySQL) / `ANALYZE` (PG), rồi chạy lại. Senior trích dẫn actual của `EXPLAIN ANALYZE`, không phải dự đoán của planner — khoảng cách "`rows` vs `actual rows`" chính là nơi query chậm thú nhận tội.

### Bẫy clustered key: UUID vs BIGINT

Đây là câu tách người từng chứng kiến incident production khỏi người mới chỉ đọc docs. Trong InnoDB, clustered index **chính là** bảng, sắp theo primary key. Chèn một `UUID` (v4) ngẫu nhiên tức là bạn đang chèn vào một vị trí ngẫu nhiên trong một cấu trúc đã sắp xếp:

```sql
-- WRONG cho bảng hot: primary key chính là thứ tự vật lý của row
CREATE TABLE orders (
  id BINARY(16) PRIMARY KEY,   -- hoặc CHAR(36) chứa chuỗi UUIDv4
  ...
);
```

Mỗi insert rơi vào một leaf page ngẫu nhiên → page split, phân mảnh, và mỗi page ngẫu nhiên là một cache miss khi đọc. Bạn trả thuế kép: write fan-out nhân đôi mỗi khi cây tái cân bằng, và "cái đầu nóng" của index (nơi `BIGINT AUTO_INCREMENT` lẽ ra ghi) không còn nằm trong buffer pool. Với insert rate cao, đây là khoảng cách giữa ghi tuần tự append-only và một cơn bão ghi đĩa làm sập p95 latency. Cách sửa:

- `BIGINT` identity (hoặc `IDENTITY` / sequence) — insert tuần tự, page đuôi nóng luôn được cache.
- `UUIDv7` (sắp theo thời gian) — trung dung "global, nhưng gần tuần tự" hiện đại; MySQL 9+ có `UUIDv7()`.
- ID kiểu Snowflake — tuần tự theo từng worker, shard được qua các node.

Senior không bao giờ nói "UUID chậm" — họ nói "UUID ngẫu nhiên phá vỡ locality của clustered index; đây là cách tôi đo page split và vì sao UUIDv7 sửa được nó."

### Buffer-pool hit ratio — con số phỏng vấn viên hay moi

InnoDB phơi nó ra trực tiếp:

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read_requests';  -- tổng logical reads
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_reads';          -- số physical disk reads thật
```

```
hit_ratio = 1 - (physical_reads / logical_reads)
```

Workload OLTP muốn hit ratio trên 99%. Dưới ~95%, "database nhanh" của bạn thực chất là một cái máy đọc đĩa — random point read cứ dập vào storage, throughput sụp, và cách sửa thường là **working set không vừa memory**, không phải thêm CPU và không phải index tốt hơn. Câu hỏi follow-up kinh điển: "working set 2 TB mà buffer pool 128 GB — bạn làm gì?" Câu trả lời senior bắt đầu bằng "10% dữ liệu nào phục vụ 90% số reads" — hot-row caching, denormalize một cột hot, hoặc tách bảng hot/cold — chứ không phải "mua thêm RAM". Và trước khi chỉnh bất cứ gì: `SHOW ENGINE INNODB STATUS` để xem trạng thái pool tạm thời, đồng thời tách **one-shot scan** (báo cáo, `SELECT COUNT(*)`) khỏi point lookup — một query analytics chạy đêm có thể kéo hit ratio xuống trong khi workload thật của bạn vẫn ổn.

## 2. Transaction & isolation — pháp y các anomaly

Đọc thuộc bốn mức là câu trả lời của mid-level. Câu trả lời của senior là các trace — anomaly mà giáo trình bỏ qua, lock chặn cả hàng đợi của bạn, và nội tại MVCC giải thích vì sao hai database bất đồng về REPEATABLE READ.

### Ma trận, cộng cái "nhưng" chẳng ai nói ra

- **Dirty read** — chặn ở READ COMMITTED.
- **Non-repeatable read** — chặn ở REPEATABLE READ.
- **Phantom read** — SQL chuẩn cho phép nó dưới REPEATABLE READ, nhưng **InnoDB vẫn chặn nó** nhờ next-key lock, và REPEATABLE READ của Postgres (snapshot isolation) không bao giờ lộ phantom khi đọc.

Vậy khi phỏng vấn viên hỏi "mức cô lập nào chặn phantom read?", câu trả lời trong sách giáo khoa là SERIALIZABLE — và đó là cái bẫy. Trong InnoDB, REPEATABLE READ đã chặn rồi, vì mọi _locking_ read dưới RR đều lấy next-key lock (row + gap). Và đây là phần giúp ứng viên senior thắng follow-up: **REPEATABLE READ của InnoDB và REPEATABLE READ của Postgres là hai con vật khác nhau.**

- **InnoDB RR** = MVCC consistent read + next-key lock trên locking read/DML. Phantom bị chặn với các thao tác _locking_ nhờ gap lock.
- **Postgres RR** = snapshot isolation thuần (MVCC, kiểu SSI). **Không hề có gap lock**, nên locking read không bao giờ block vì "những row chưa tồn tại" — phantom bị loại cho _đọc_ nhờ snapshot, nhưng hai `SELECT ... FOR UPDATE` trên cùng một khoảng trống không bao giờ chặn nhau.

Cả hai engine dù vậy đều chung một lỗ hổng: **write skew sống sót qua REPEATABLE READ** ở cả hai, vì những read quan trọng là read _không locking_ — xem bên dưới.

### Nội tại MVCC — lớp nằm dưới câu trả lời

Bạn không kể được các anomaly cô lập mà không biết "consistent read" thực sự là gì. Trong InnoDB:

1. Mỗi row mang các cột ẩn: transaction ID và roll pointer trỏ vào **undo log**.
2. Một `UPDATE` không ghi đè row — nó ghi một **phiên bản mới** và đẩy phiên bản cũ vào undo log (version chain).
3. Read đầu tiên của một transaction trong RR tạo một **read view** — snapshot của "những transaction đã commit trước khi tôi bắt đầu".
4. Một read đi theo version chain và trả phiên bản mới nhất mà snapshot nhìn thấy. Ai cũng đọc lịch sử riêng của mình về bảng, nên reader không bao giờ block writer và writer không bao giờ block reader.

Điểm cuối cùng chính là lý do bạn thấy `MVCC` trong mọi mô tả công việc: "reader không block writer." Tradeoff chẳng ai tình nguyện nhắc là mỗi version bạn giữ lại **tốn đĩa và CPU**, và transaction dài làm đóng băng garbage collector:

- InnoDB: undo log purge không thể thu hồi những version một transaction chạy lâu vẫn có thể đọc. `SHOW ENGINE INNODB STATUS` → để mắt tới **history list length**. Nó tăng, undo tablespace phình ra, và một transaction báo cáo chạy 30 phút có thể âm thầm nhân đôi dung lượng đĩa của bạn.
- Postgres: các row version cũ ở lại thành **dead tuple**, và autovacuum theo không kịp. Bảng phình ra, và index scan của bạn chậm lại _ngay cả khi trả đúng một row_ — vì page đầy những con ma.

Failure mode production phỏng vấn viên hay moi: "một batch transaction chạy đêm 45 phút, sáng hôm sau mọi write chậm lại." Câu trả lời senior: read snapshot giữ purge/vacuum lại, undo/dead-tuple list phình, page write chậm, và các transaction _ngắn_ lẽ ra 10 ms bắt đầu giật cục vì buffer replacement. Cách sửa thường là **transaction ngắn hơn** (commit theo batch), không phải hardware to hơn.

### Trace phantom read (dưới READ COMMITTED)

```
T1: BEGIN;
T1: SELECT COUNT(*) FROM shifts WHERE day = 'Monday';     -- 5

T2: BEGIN;
T2: INSERT INTO shifts(day) VALUES ('Monday'); COMMIT;

T1: SELECT COUNT(*) FROM shifts WHERE day = 'Monday';     -- 6  ← phantom
```

Tập row đã đổi ngay dưới chân T1. Chú ý khác biệt giữa RC và RR ở đây: dưới **READ COMMITTED** mỗi statement nhận một read view mới, nên `COUNT` thứ hai của T1 thấy insert đã commit của T2 — cả phantom lẫn non-repeatable read đều xuất hiện. Dưới **REPEATABLE READ** read view được cố định ở lần đọc đầu tiên, nên cả hai COUNT đều trả 5 (đó là lý do RR "chặn" nó cho việc đọc). Nếu bạn kể được _vì sao_ mức cô lập đổi kết quả — read view mới cho từng statement thay vì từng transaction — thì bạn đang nói bằng engine, không phải bằng giáo trình.

Bạn sửa bằng SERIALIZABLE hoặc lock tường minh — và trả giá bằng concurrency. Cái giá đó chính là tradeoff phỏng vấn viên muốn nghe bạn nêu tên: **isolation level là một nút chỉnh latency/throughput, không phải ô checkbox an toàn.**

### Lost update và write skew — lãnh thổ senior

Lost update là dạng dễ, sửa bằng cột version (optimistic locking):

```sql
UPDATE accounts SET balance = balance - 100, version = version + 1
WHERE id = ? AND version = ?;
-- 0 row bị ảnh hưởng => có người đi trước => retry hoặc reject
```

Anomaly thực sự cắn người ta trong phỏng vấn (và production) là **write skew**: hai transaction mỗi bên đọc state chồng lấn, không bên nào block bên kia vì chúng ghi vào các row _khác nhau_, và invariant lặng lẽ chết.

```
T1: BEGIN;
T1: SELECT COUNT(*) FROM doctors WHERE on_call = true;   -- 1, giới hạn là 1

T2: BEGIN;
T2: SELECT COUNT(*) FROM doctors WHERE on_call = true;   -- 1, giới hạn là 1

T1: UPDATE doctors SET on_call = true WHERE id = 101;    -- ok, "vẫn một" theo read của tôi
T2: UPDATE doctors SET on_call = true WHERE id = 102;    -- ok, "vẫn một" theo read của tôi
-- COMMIT × 2  →  giờ HAI bác sĩ cùng on_call. Invariant vỡ.
```

Không dirty read, không lost update — snapshot nhất quán với từng transaction, mà constraint vẫn vỡ. Đây là anomaly duy nhất sống sót qua REPEATABLE READ ở **cả** InnoDB và Postgres, vì `SELECT COUNT(*)` là một read MVCC _không locking_: không transaction nào giữ một lock mà transaction kia có thể chờ. Các cách sửa:

```sql
-- PESSIMISTIC: lock các row đã kiểm tra, nên T2 chờ tới khi T1 commit
SELECT COUNT(*) FROM doctors WHERE on_call = true FOR UPDATE;

-- Hoặc serialize toàn bộ read-modify-write trên một guard row duy nhất
SELECT ... FROM doctor_schedule WHERE id = ? FOR UPDATE;

-- USE-CASE HÀNG ĐỢI: không chờ gì cả
SELECT ... FOR UPDATE SKIP LOCKED;   -- nhận một task, bỏ qua các task đang bị lock
```

- **Pessimistic (`FOR UPDATE`)** — locking read của T1 giữ next-key lock; T2 block tới khi T1 commit, rồi đọc lại và thấy đã có hai người on_call → reject. Đúng, nhưng bạn serialize mọi thay đổi on-call.
- **Optimistic (cột version)** — cả hai tăng version, `UPDATE` của kẻ thua trả 0 row, app retry.
- **Postgres SERIALIZABLE (SSI)** — engine phát hiện read-write dependency lúc commit và **abort một transaction** với `40001 serialization_failure`. App _bắt buộc_ phải bắt và retry; không retry thì bạn đang biến serializable thành mất dữ liệu.

Nếu bạn tự sinh trace này mà không cần gợi ý, nêu đúng nguyên nhân gốc là non-locking read, và đưa ra bộ ba pessimistic + optimistic + SSI, bạn đã vượt thanh cao nhất của phần này.

### Deadlock — câu follow-up luôn được thả ra

Ngay sau write skew, phỏng vấn viên quay sang: "bạn deploy, và đột nhiên `DeadlockLoserDataAccessException` đầy log." Câu trả lời senior không phải "thêm retry" — mà là "đọc bản báo cáo deadlock."

- **InnoDB phát hiện deadlock** và rollback transaction làm ít việc hơn (ít undo bytes hơn). `SHOW ENGINE INNODB STATUS` in ra hai transaction, chính xác các lock đang giữ, và SQL bị chặn.
- **Pattern**: T1 lock row A rồi muốn row B; T2 lock row B rồi muốn row A. Cùng một _thứ tự lock_ trong mọi transaction là cách sửa — sort các key của `WHERE id IN (...)`, lock cha trước con.
- **`NOWAIT` / `SKIP LOCKED`** là cửa thoát cho queue-consumer pattern; một job queue mà _chờ_ trên các row bị lock sẽ tự deadlock tới chết dưới tải.

```java
// WRONG: deadlock → exception → transaction rollback → job mất tích
try {
    doTransfer(a, b);
} catch (DeadlockLoserDataAccessException e) {
    // nuốt: tiền đã chuyển một lần, hoặc không hề chuyển — ta không biết
}

// RIGHT: retry exponential backoff có chặn trên, và idempotency trên write
int retries = 0;
while (retries < 3) {
    try {
        doTransfer(a, b);            // update idempotent nhờ unique txn_id
        break;
    } catch (DeadlockLoserDataAccessException e) {
        retries++;
        Thread.sleep(50L << retries);   // 100ms, 200ms, 400ms
    }
}
```

## 3. Connection pooling — khoảng cách giữa 2000 và 50 connection

Heuristic HikariCP `connections ≈ ((core_count * 2) + effective_spindle_count)` chỉ là con số khởi điểm — và mọi senior đều biết nó chỉ là con số khởi điểm. Con số bảo vệ được đến từ định luật Little:

```
Định luật Little:  công việc đang bay  =  arrival rate  ×  thời gian mỗi request giữ tài nguyên

pool_size = requests_per_second × số giây một connection bị checkout
500 req/s × 0.05 s = 25 connections
```

Làm phép tính đó đi thì bạn sẽ không phải người đặt pool 200 chỉ vì máy có 64 core. Và đây là hai con số khiến tiêu đề của phần này trở nên cụ thể: một connection đơn lẻ chạy thoải mái **cỡ một nghìn transaction ngắn mỗi giây** (query 1 ms ~ 1000/s; query 10 ms ~ 100/s). Vậy pool 50 connection không phải "50 user đồng thời" — nó cỡ **50.000 short TPS**, nhiều hơn hầu hết service từng thấy. Pool 2000 không phải throughput gấp 40×; nó là 2000 thread chờ một database chỉ phục vụ được một phần nhỏ trong số đó.

Điểm tinh tế làm kể cả ứng viên mạnh cũng vấp: **connection bị giữ trọn cả thời gian checkout, chứ không phải mỗi query.** Nếu request của bạn checkout một connection, chạy query A, làm 100 ms business logic trong Java, rồi mới chạy query B, pool phải đủ cho _cả_ 150 ms. Định luật Little với W sai (query time thay vì transaction time) sinh ra một pool nhỏ 3× và xếp hàng ngay tại DB — chính cái failure bạn đang cố tránh.

- **Quá lớn** → context-switch thrash, hàng trăm MB connection rỗi ở phía DB (MySQL thread-per-connection: mỗi connection rỗi là một thread + stack + buffer), và queueing _bên trong_ database.
- **Quá nhỏ** → request xếp hàng tại `connectionTimeout`, latency tăng, rồi throughput sụp — sự cố "pool là nút thắt, không phải DB".
- **R2DBC non-blocking**: thread không bao giờ block trên I/O, nên pool 10–20 connection là quá đủ — pool được định cỡ theo concurrency, không theo tải.

### Các failure mode production, vì phỏng vấn viên hay hỏi về incident

- **Connection bị rò rỉ.** `getConnection()` mà không release thì pool cạn kiệt → `Connection is not available, request timed out` → mọi request chồng đống → outage. Đây là sự cố kinh điển "DB tưởng chết mà thực ra vẫn ổn, pool rỗng". Sửa bằng try-with-resources và `leakDetectionThreshold` để pool báo cho bạn trước khi khách hàng báo.
- **`maxLifetime` vs timeout của server.** `wait_timeout` của MySQL mặc định 8 giờ; nếu pool giữ connection quá mức đó, server âm thầm giết nó và bạn gặp `Communications link failure`. `maxLifetime` của pool phải thấp hơn idle timeout của server. Chiều ngược lại: `connectionTimeout` của pool (mặc định 30 s trong HikariCP) là thời gian một request _chờ_ connection rảnh — nếu thấy timeout, hãy kiểm tra queueing trước khi soi DB.
- **`minimumIdle` = `maximumPoolSize` thì ổn với service hot**, nhưng với service bursty pool nên được phép rút bớt connection rỗi; chỉnh `idleTimeout` để một cú spike không để 200 socket đỗ xe cả buổi chiều.
- **Bật chẩn đoán:** `leakDetectionThreshold`, `connectionTimeout`, `validationTimeout`, và `isValid()` của JDBC4 (không phải một vòng round-trip `SELECT 1`) là bắt buộc trong production. Theo dõi `active` vs `idle` trong Hikari metrics — một pool luôn `active` ở mức max chính là một hàng đợi đội lốt.

```java
// WRONG: một exception ở giữa là connection mất tích vĩnh viễn
Connection c = pool.getConnection();
Statement s = c.createStatement();
s.execute("UPDATE accounts SET balance = balance - 100 WHERE id = ?");
c.close();  // không bao giờ tới nếu execute ném → rò rỉ → pool cạn

// RIGHT: try-with-resources đảm bảo release trên mọi đường đi
try (Connection c = pool.getConnection();
     PreparedStatement ps = c.prepareStatement(
         "UPDATE accounts SET balance = balance - ? WHERE id = ?")) {
    ps.setBigDecimal(1, amount);
    ps.setInt(2, accountId);
    ps.executeUpdate();
}
```

Và mối ràng buộc với ORM khép kín vòng lặp: nếu bạn đang trên Spring Boot mà còn bật Open Session in View, pool của bạn đang bị bắt làm con tin — chi tiết ở phần 5.

## 4. SQL vs NoSQL — quyết định theo access pattern + consistency, không theo hype

Nói "NoSQL nhanh hơn" là bạn tự thua vòng phỏng vấn. Cách đặt vấn đề trung thực: mỗi store đưa ra một hợp đồng consistency, flexibility và scale khác nhau, và việc chọn là một tradeoff, không phải cuộc đua tốc độ. Phỏng vấn viên muốn nghe bạn hỏi ba câu _trước khi_ nêu tên một công nghệ:

1. **Access pattern là gì?** — point lookup theo key, range scan, join, aggregation, hay append-only?
2. **Hợp đồng consistency mà nghiệp vụ cần là gì?** — read-your-writes cho giỏ hàng khác với eventual cho analytics.
3. **Write/read ratio và cardinality của hot key space là bao nhiêu?**

- **Relational (Postgres/MySQL)** — join, transaction, referential integrity, và khả năng `EXPLAIN` để thoát khỏi cái hố performance. Lựa chọn mặc định khi dữ liệu có quan hệ và có tiền di chuyển. Postgres hiện đại làm mờ ranh giới: `jsonb` cho bạn một document store với `GIN` index và một query planner thực thụ.
- **Document (MongoDB)** — schema linh hoạt và scale ngang, nhưng join phía server bị giới hạn (`$lookup` là một chi phí pipeline aggregation tăng rất nhanh), document bị chặn ở 16 MB, và một shard key tồi sinh ra **hot shard** chặn throughput dù bạn thêm bao nhiêu node. Một shard key phải phân tán writes VÀ khớp với reads — "ai cũng query theo `customer_id`, nên shard theo `customer_id`" là câu trả lời senior; shard theo `created_at` khiến mọi write gần đây dồn về một shard.
- **Wide-column (Cassandra)** — thiết kế log-structured ghi mọi nơi (LSM) cho scale write-heavy, với consistency điều chỉnh được. QUORUM với RF=3 nghĩa là hai node phải đồng thuận; **eventual consistency ổn cho telemetry và nguy hiểm cho ledger**. Reads mới là phần đắt — một read phải merge qua các memtable và SSTable, nên "Cassandra nhanh" nghĩa là _write nhanh_, và read path chính là nơi bất ngờ cư trú.
- **Redis** — một cache/counter/pub-sub với giả định bền vững dựa vào RAM, không phải store bền vững. Core đơn thread, nên vài 10k ops/s ở p99 — pipelining quan trọng hơn bạn tưởng. Nếu bạn tuyên bố nó là source of truth, hãy sẵn sàng bảo vệ tradeoff của AOF + fsync (fsync mỗi write → vài nghìn ops/s; fsync mỗi giây → mất tối đa một giây dữ liệu khi crash) và eviction policy (`allkeys-lru` vs `volatile-lru`) quyết định cache sống hay chết.

Và sắc thái gây ấn tượng tốt: `jsonb` của Postgres làm mờ ranh giới relational/document — bạn có thể có schema cho các cột tiền bạc và một JSON document cho các cột linh hoạt, với index vào trong JSON. "Tôi lưu order lines là bảng relational còn metadata của từng nhà cung cấp là jsonb" đánh bại "Tôi xài MongoDB" trong hầu hết buổi phỏng vấn backend. Các đáp án NoSQL có lý do chính đáng: event log append-only và telemetry → Cassandra/ClickHouse; per-user profile hay đổi với hot row → Redis + relational; dữ liệu dạng document linh hoạt mà cần query thật → Postgres `jsonb`.

## 5. N+1 và bẫy ORM

Câu trả lời của người mới là "xài JOIN FETCH." Câu trả lời của senior là "xài JOIN FETCH, rồi biết nó vỡ ở đâu, rồi đo lường SQL mà ORM thực sự chạy."

**Phiên bản kinh điển:**

```java
// WRONG: 1 query cho các parent + 1 query cho mỗi child = N+1
List<Order> orders = orderRepository.findAll();
for (Order order : orders) {
    order.getLineItems().size();   // lazy-load bắn ra ở đây, mỗi order một lần
}
```

1.000 order → 1.001 query. Với 10 row thì không thấy gì; với 10 triệu thì nó nấu chín database. Đường cong "chạy với 10, chết với 10M" đó chính là thứ phỏng vấn viên thích hỏi. Rồi họ bảo bạn _chứng minh_ nó tồn tại trong production mà không cần IDE — và câu trả lời senior là `format_sql` + timing (`slow_query_log` trong MySQL, `auto_explain` trong Postgres cho thấy 1.001 query tuần tự), hoặc chỉ cần thấy bộ đếm query của DB nhảy đúng một lần mỗi parent row.

**RIGHT — fetch cả graph trong một câu lệnh:**

```java
// Hibernate
List<Order> orders = em.createQuery(
    "select distinct o from Order o join fetch o.lineItems", Order.class)
    .getResultList();

// Spring Data
@Query("select o from Order o join fetch o.lineItems")
List<Order> findAllWithItems();
```

Các lựa chọn thay thế kèm tradeoff riêng: `@BatchSize` (batch fetching: `1 + ceil(N/1000)` query thay vì `1 + N` — đúng lúc danh sách parent lớn và một join sẽ nổ thành cartesian product), entity graph/`@EntityGraph` cho fetch strategy theo từng use-case, hoặc — nước đi senior nhất — bỏ qua entity hoàn toàn và **project một DTO** với đúng các cột trang cần:

```java
@Query("""
    select new com.acme.dto.OrderItemDTO(o.id, o.status, l.sku, l.qty)
    from Order o join o.lineItems l
    where o.customerId = :customerId
    """)
List<OrderItemDTO> findForCustomer(long customerId);
```

Một query, không managed entity, không bẫy lazy, và payload row nhỏ nhất. Nếu bạn giải thích được _khi nào ngừng dùng JOIN FETCH và project thay thế_ — đó chính là điểm ngoặt senior.

**Nơi JOIN FETCH phản bội bạn — gotcha chỉ dành cho senior.** Phân trang một query fetch-join một `Collection` thì Hibernate không áp dụng được `LIMIT` trong SQL, vì join nhân số row. Nó rơi về **in-memory pagination** — tải toàn bộ result set rồi cắt trong JVM. Dòng log là `HHH000104: firstResult/maxResults specified with collection fetch; applying in memory!` — và "page 2" của bạn giờ đây sai lặng lẽ, database đột nhiên phải làm việc của một full scan. Cách sửa: fetch ID của page 1 trước, rồi fetch child cho các ID đó trong query thứ hai, hoặc phân trang một DTO projection.

**Bẫy OSIV — cài đặt ngầm giấu kín của Spring Boot.** `spring.jpa.open-in-view` mặc định là **true**, và Spring Boot log một cảnh báo mỗi lần khởi động. OSIV giữ EntityManager (và connection JDBC của nó) mở **trọn cả HTTP request**, kể cả sau khi transaction của bạn đã commit. Hai hệ quả: lazy load ở bất kỳ đâu trong request (kể cả serializer và template rendering) "tự nhiên chạy" — che giấu N+1 — và connection pool của bạn bị giữ mở suốt thời gian request, nghĩa là **phép tính định cỡ pool ở phần 3 giờ lệch đi đúng bằng chiều rộng của endpoint chậm nhất của bạn**. Đòn senior: tắt OSIV (`spring.jpa.open-in-view: false`), xử lý lazy loading trong transaction (hoặc fetch eager), và để pool release connection ngay khi business logic xong. Điều đầu tiên bạn gặp khi tắt OSIV là `LazyInitializationException` từ serializer — và đó là một tính năng, không phải bug: framework cuối cùng đã chỉ cho bạn N+1 nằm ở đâu.

Và meta-skill nằm dưới tất cả: **đọc SQL được sinh ra.** Bật `spring.jpa.properties.hibernate.format_sql=true` hoặc gắn p6spy, và đối chiếu điều bạn _tưởng_ mình viết với SQL ORM _thực sự_ thực thi. Senior coi ORM là một code generator có chính kiến, không phải hộp đen — và biết rằng `@Cacheable`/second-level cache chỉ là giải pháp _cuối cùng_ cho dữ liệu dùng chung nóng và ít thay đổi, vì invalidation giữa các node là nơi cache lặng lẽ trở nên stale.

## 6. Tự kiểm tra

- [ ] Thiết kế composite index cho `WHERE customer_id = ? AND status = ? ORDER BY created_at` và biện hộ thứ tự cột — xuống tận leftmost-prefix rule và thứ tự leaf `DESC`.
- [ ] Giải thích vì sao primary key `UUIDv4` là thảm họa clustered index và `UUIDv7` thay đổi điều gì.
- [ ] Anomaly nào REPEATABLE READ _chuẩn_ cho phép, vì sao InnoDB vẫn chặn nó với locking read, và vì sao RR của Postgres cư xử khác?
- [ ] Dựng trace write skew hai transaction và bộ ba sửa pessimistic + optimistic + SSI.
- [ ] Đọc một deadlock từ `SHOW ENGINE INNODB STATUS` và viết vòng retry.
- [ ] Định cỡ connection pool từ throughput và hold-time bằng định luật Little — và giải thích vì sao "hold time" không phải query time.
- [ ] Tìm và sửa N+1 trong một snippet, rồi giải thích gotcha phân trang fetch-join và bẫy OSIV.
- [ ] Nêu tên hai status variable tính hit ratio buffer-pool của InnoDB và nước đi đầu tiên khi nó tụt.

## 7. Interviewer follow-ups

Khi câu trả lời đầu tiên của bạn chạm đúng, họ bắt đầu khoan. Sẵn sàng cho những câu này:

- "Query trả về 40M row — index còn được dùng không, và nó có đúng hình dạng không?"
- "Vì sao optimizer bỏ qua index trên `status` của tôi dù `EXPLAIN` hiển thị nó?"
- "Working set của bạn không vừa buffer pool. Nước đi đầu tiên là gì?"
- "SERIALIZABLE có chặn được write skew không? Nó tốn những gì — và ai chịu trách nhiệm retry?"
- "Bạn thấy `Connection is not available, request timed out` ở 100 req/s với pool 25. Phép toán thế nào, và bạn kiểm tra gì đầu tiên?"
- "Khi nào bạn vẫn chọn MySQL thay vì Postgres, hoặc Postgres thay vì MongoDB — và `jsonb` thay đổi điều gì?"
- "Làm sao chứng minh N+1 tồn tại trong production mà không mở IDE?"
- "Transaction đọc chạy lâu đang làm chậm mọi write. Bloat nằm ở đâu, và bạn đổi gì?"
- "Một job queue liên tục deadlock dưới tải. Thứ đầu tiên bạn đổi là gì — và vì sao `SKIP LOCKED`?"
- "Giải thích vì sao Postgres `SERIALIZABLE` có thể abort một transaction vừa commit một write logic hợp lệ."

Đó là bar database.
