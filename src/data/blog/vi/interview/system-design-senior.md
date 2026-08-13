---
title: "Ôn thi Java #7: System Design — Junior đến Senior"
description: "System design là capstone của senior — một bài test phán đoán 45 phút. Process, ước lượng capacity, caching, CAP, scalability, và observability."
pubDatetime: 2026-08-10T10:25:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - system-design
  - scalability
---

System design là buổi phỏng vấn không có đáp án đúng — chỉ có trade-off có thể phòng thủ. Junior gọi tên component; senior đi một bài toán từ yêu cầu mơ hồ đến thiết kế có số và chỉ chỗ nó gãy. Bài này leo từ "vẽ diagram" đến "đây là latency budget và failure tôi đang canh".

> Mindset: junior sản xuất diagram; senior sản xuất diagram _và_ latency budget, capacity estimate, và failure mode duy nhất có khả năng page họ lúc 2 giờ sáng nhất.

## Junior — nền tảng

**Q1. Các building block chính của một web system là gì?**
Một stack điển hình: client → load balancer → web/app server → cache → database → async worker/queue. Mỗi layer tồn tại để thêm capability: LB spread load, cache absorb read, queue decouple slow work. Biết role của mỗi block là sàn.

**Q2. Caching là gì và cache-aside pattern?**
Cache lưu kết quả đắt gần reader. Trong **cache-aside**, app check cache trước; miss thì đọc DB, populate cache, trả về. Đơn giản và resilient (cache fail fallback DB) nhưng chịu stampede trên hot-key miss. Biến thể: write-through (viết cache+DB cùng nhau), write-back (viết cache, flush sau).

**Q3. Load balancer là gì và tại sao dùng?**
Nó distribute traffic đến nhiều server để không node nào quá tải và bạn scale horizontally. Nó cũng cung cấp health check (ngừng gửi đến node chết) và một endpoint duy nhất cho client. Không có nó, một server là ceiling và SPOF của bạn.

**Q4. Khác nhau giữa horizontal và vertical scaling?**
Vertical = làm machine lớn hơn (nhiều CPU/RAM) — đơn giản nhưng capped và SPOF. Horizontal = thêm machine sau LB — không hard cap, resilient, nhưng đòi statelessness và shared storage. Hầu hết cloud system scale horizontally.

**Q5. CDN là gì và khi nào dùng?**
Content Delivery Network cache static asset (image, JS, video) tại edge gần user, cắt latency và origin load. Dùng cho anything static và read-heavy. Nó không giúp dynamic, user-specific response (dù edge compute đang làm mờ điều này).

**Q6. Stateless nghĩa là gì, và tại sao quan trọng cho scaling?**
Service stateless không giữ per-request memory trên server — mọi request mang thứ nó cần (hoặc pull state từ shared store). Điều đó cho phép node nào xử lý request nào, nên bạn thêm node tự do. Stateful service (session in memory) ép sticky session và complicate scaling và failover.

## Mid — tradeoff & điểm mù

**Q1. Giải thích CAP theorem bằng từ đơn giản.**
Bạn không có cả ba Consistency (mọi read thấy latest write), Availability (mọi request có response), và Partition tolerance (system sống sót network split) — và partition là inevitable, nên bạn thực chọn giữa **CP** (pause để giữ consistent) và **AP** (vẫn up, rủi ro stale read). Payment ledger là CP; social feed là AP. Bẫy phỏng vấn là nói "chúng tôi có cả ba".

**Q2. Cache invalidation là gì và tại sao khó?**
Phần khó của caching là giữ cache đúng khi data đổi. Chiến lược: **TTL** (auto-expire, đơn giản, cho phép brief staleness), **write-invalidate** (xóa cache entry khi write, rồi repopulate trên read tiếp), hoặc **write-update** (refresh khi write). Race: một write và một read có thể interleave nên cache kết thúc với stale data. Hầu hết team chấp nhận short TTL staleness hơn đuổi perfect invalidation.

**Q3. Size capacity thế nào — vd bao nhiêu server cho 10k req/s?**
Back-of-envelope: nếu một server xử lý ~500 req/s tại p99 < 200 ms (đo, không đoán), 10k req/s cần ~20 server + headroom → ~25–30. Rồi check bottleneck không phải DB (mỗi req có thể làm 2–3 query; connection pool cap effective throughput). Capacity là về layer _yếu nhất_, không phải cái bạn size đầu.

**Q4. Message queue là gì và giải quyết vấn đề gì?**
Queue buffer work giữa producer và consumer không kịp pace, và decouple chúng nên slow consumer hoặc crash không block producer. Nó cũng smooth spike (queue absorb burst; consumer drain tại rate). Không có nó, traffic spike hoặc drop request hoặc cascade failure.

**Q5. Idempotency trong API là gì và implement thế nào?**
Endpoint idempotent tạo cùng result nếu gọi một hoặc nhiều lần với cùng input — thiết yếu vì network retry. Implement với client-supplied **idempotency key**: lưu result của call đầu key bởi nó, và trả stored result trên retry thay vì re-execute. `PUT` tự nhiên idempotent; `POST` không, nên cần key.

**Q6. Khác nhau giữa SQL và NoSQL, và khi nào chọn?**
SQL (relational) cho ACID, rich query, strong schema — tốt nhất cho transactional, relational data (money, order). NoSQL (document, key-value, column, graph) trade một số guarantee lấy horizontal scale và flexible schema — tốt nhất cho high-volume, loosely-structured, hoặc specialized data (session store, time-series, graph). Chọn bằng consistency và shape của data, không phải fashion.

## Senior — thiết kế & phòng thủ

**Q1. Thiết kế URL shortener (vd 100M URL, 1B redirect/day). Đi qua.**
"Requirements trước: redirect phải nhanh (<50 ms) và highly available; write hiếm vs read (~100:1). Thiết kế: hash/Base62 của counter hoặc hash của long URL → short key. Lưu (short_key → long_url) trong DB; cache hot key trong Redis (hầu hết redirect hit một hot set nhỏ). Redirect service stateless sau LB, đọc cache → DB trên miss. Scale: shard DB theo key prefix; Redis cluster cho cache. Capacity: 1B/86400 ≈ 11.5k redirect/s avg, với spike — vài stateless app node + Redis xử lý. Failure tôi canh: cache miss stampede trên link suddenly-hot → dùng single-flight/lock per key trên miss."

**Q2. p99 latency của một service gấp 3 sau deploy. Tìm nguyên nhân với budget.**
"Tôi decompose latency budget: LB → TLS → app → cache (1–2 ms) → DB (5–15 ms) → downstream call. Tôi so sánh new trace waterfall với baseline. p99 gấp 3 hầu như luôn nghĩa một synchronous dependency mới hoặc N+1 query (mỗi request giờ làm 50 DB call thay vì 1). Fix: batch call, chuyển dependency mới sang async/off critical path, hoặc thêm cache. Tôi chứng minh bằng cách show per-span p99 before/after — span offending là cái tăng, không phải 'system chậm'."

**Q3. Bạn phải giữ system up trong full region outage. Thiết kế cho nó.**
"Active-passive hoặc active-active xuyên hai region. Data: replicate DB (async cross-region) và dùng CP store chịu split; chấp nhận trong partition, secondary có thể serve stale data (AP during partition, reconcile sau). Traffic: DNS hoặc global LB failover sang region khỏe; client retry với backoff. Rủi ro thật là split-brain trên write — tôi làm inactive region read-only hoặc dùng consensus store cho vài write path quan trọng. Tôi test failover với game day, không assume nó work."

**Q4. Chọn giữa cache và database lớn hơn cho read scale thế nào?**
"Nếu read hot và repetitive (cùng 5% data được 95% traffic), cache offload DB dramatic và rẻ hơn scale DB vertically. Nếu read uniformly distributed và cold, cache có low hit rate và bạn better scale DB (read replica) — caching cold data chỉ thêm layer vô dụng. Tôi đo working-set hit rate trước; cache chỉ pay off trên ~80% hit rate trên hot set. Không thì read replica + indexing là win đơn giản hơn."

**Q5. Thiết kế observability cho system bạn giao cho on-call. Gì non-negotiable?**
"Ba pillar: metrics (RED — rate, errors, duration — với SLO và alert trên SLO burn), structured log keyed by trace ID, và distributed tracing cho request path. Non-negotiable: mọi external call được time và tag, mọi error countable, và alert page trên _symptom_ (user-facing latency/error rate), không phải cause (CPU). Senior không ship system on-call không debug được lúc 2 giờ sáng — nếu không trace được slow request đến span, design chưa xong."

**Q6. Interviewer bảo 'giờ make nó 100x lớn hơn.' Gì gãy trước?**
"Tôi gọi tên weakest link, không hand-wave. Ở 100x, single relational DB là cái gãy đầu — connection pool exhaust, write throughput cap. Nên tôi shard nó (theo tenant/user key), push read sang replica, và chuyển analytics off primary. Stateless app tier scale horizontally, nên ổn. Cache cluster scale bằng thêm shard. Thứ 'gãy' là coordination: cross-shard transaction, và global query không còn fit một node — những thứ ép redesign data model (denormalize, pre-aggregate). Câu trả lời thật: DB, rồi assumption của data model."

#### Self-check

- [ ] Junior: Tôi gọi được building block (LB, cache, queue, DB), giải thích cache-aside, horizontal vs vertical scaling, CDN, và statelessness.
- [ ] Mid: Tôi giải thích được CAP, cache invalidation, capacity sizing từ req/s, message queue, API idempotency, và SQL vs NoSQL trade-off.
- [ ] Senior: Tôi thiết kế được URL shortener với latency budget và stampede protection, chẩn đoán p99 regression từ trace, thiết kế cho region failure, chọn cache vs bigger DB bằng hit rate, định nghĩa observability non-negotiable, và gọi tên component gãy đầu ở 100x.
