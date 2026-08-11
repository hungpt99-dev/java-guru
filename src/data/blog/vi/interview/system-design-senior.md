---
title: "Phỏng vấn Senior Java: System Design"
description: "System design là bài capstone của senior — test tư duy 45 phút. Quy trình, ước lượng capacity, caching, CAP, scalability, và observability."
pubDatetime: 2026-08-10T10:25:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - system-design
  - scalability
---

System design là nơi phán đoán bị test 45–60 phút. Quy trình quan trọng hơn đáp án.

## 1. Vòng lặp phỏng vấn

1. **Làm rõ yêu cầu & scope.** QPS? read vs write? latency budget? data size? consistency vs availability?
2. **Tính capacity tầm bậy.** "10M user, 100 read/user/ngày = 1B read/ngày ≈ 11.5k QPS." Con số dẹp đoán mò.
3. **Component cao cấp.** Clients → CDN → API gateway → services → cache → DB → async workers/queues.
4. **Đào sâu 1–2 chỗ.**
5. **Xử lý failure.** Cái gì gãy trước? Làm sao degrade?

## 2. Cache strategy

- **Cache-aside (lazy):** app check cache, miss thì đọc DB, ghi ngược. Xử lý **cache stampede** bằng request coalescing / single-flight; **stale data** bằng TTL; **thundering herd lúc expire** bằng jittered TTL.
- **Write-through / write-behind** khi cần consistency với store.
- **Cache invalidation** là khó — ưu tiên TTL + explicit invalidation on write.

## 3. Consistency models

- **CAP:** dưới partition chọn CP hoặc AP. Nói đúng — partition hiếm nhưng không tránh được, nên chọn thật là "bỏ cái gì _trong lúc_ partition."
- **Eventual consistency:** ổn cho feed/count/search; nguy hiểm cho balance/inventory thiếu guard.

## 4. Scalability patterns

- **Horizontal scaling + stateless services** (session trong Redis, không local memory).
- **Sharding/partitioning** theo tenant hoặc hash.
- **Async processing** làm phẳng spike (Kafka + workers).
- **Backpressure & queues** để dependency chậm degrade thay sập.

## 5. Ví dụ: URL shortener

- 100M URL mới/ngày, 1B redirect/ngày, low latency.
- Key-value store; key = base62(encoded counter hoặc hash); collision → retry với salt.
- Cache URL nóng trong Redis (đa số redirect đánh tập nhỏ).
- 301 cho browser cache (ít load) nhưng khó đổi; 302 linh hoạt.
- Capacity: 1B redirect × ~500 bytes ≈ 0.5 TB/ngày log; plan retention/aggregation.

## 6. Observability là một phần thiết kế

Tích hợp tracing (request ID xuyên service), metrics (RED: rate/errors/duration), structured log từ ngày đầu. "Sau này thêm monitoring" là red flag.

## 7. Tự kiểm tra

- [ ] Ước lượng capacity cho một QPS.
- [ ] Thiết kế cache-aside có stampede protection.
- [ ] Phát biểu CAP đúng dưới partition.
- [ ] Vẽ diagram service nặng read với cache, DB, queue.

Đó là bar system design.
