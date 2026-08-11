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

Database là tầng quyết định hệ thống có scale được thật hay không. Phỏng vấn viên soi kỹ.

## 1. Indexing là bắt buộc

- **B-tree vs hash:** range query cần B-tree.
- **Thứ tự cột composite:** selective nhất / equality trước, range cuối. `WHERE a=? AND b>?` muốn `(a,b)`, không `(b,a)`.
- **Covering index** tránh table lookup.
- **Bẫy:** query "dùng index" mà vẫn scan triệu row (low cardinality, function trên cột, implicit cast). Đọc `EXPLAIN`.

## 2. Transaction & isolation

- **Levels:** read uncommitted / committed / repeatable read / serializable.
- **Read types bị ngăn:** dirty / non-repeatable / phantom — biết level nào chặn cái nào.
- **Lost updates** — ngăn bằng `SELECT ... FOR UPDATE`, optimistic locking qua version, hoặc `SERIALIZABLE`.
- **MVCC:** reader không block writer (Postgres/InnoDB). Đó là lý do "read lock cả table" thường hiểu sai.

```sql
UPDATE accounts SET balance = balance - 100, version = version + 1
WHERE id = ? AND version = ?;
-- 0 row => có người đi trước => retry hoặc reject
```

## 3. Connection pooling

Pool là tài nguyên chia sẻ khan hiếm. HikariCP heuristic: `connections ≈ ((core_count * 2) + effective_spindle_count)` — nhưng đáp án thật là "đo dưới tải." Quá lớn → context-switch thrash; quá nhỏ → queueing.

## 4. SQL vs NoSQL — quyết định thật

Đừng nói "NoSQL nhanh hơn." Chọn model khớp access pattern: document (MongoDB) schema linh hoạt, wide-column (Cassandra) write-heavy, relational (Postgres) khi cần join/transaction/integrity. Redis là cache/counter/pub-sub, không phải store bền vững.

## 5. N+1 và bẫy ORM

- **N+1:** lazy loading trong loop. Sửa bằng `JOIN FETCH` / entity graphs / batch fetching.
- **Biết SQL sinh ra.** Senior đọc nó. "Chạy" với 10 row, chết với 10M là kinh điển.

## 6. Tự kiểm tra

- [ ] Chọn composite index cho một query và giải thích thứ tự.
- [ ] Level nào ngăn phantom read?
- [ ] Optimistic vs pessimistic locking bằng SQL.
- [ ] Tìm và sửa N+1 trong snippet.

Đó là bar database.
