---
title: "Ôn thi Senior Java: Java, OOP, Microservices, Database, Kafka, System Design"
description: "Cẩm nang ôn thi phỏng vấn Java backend cấp senior — những khái niệm phỏng vấn viên thực sự kiểm tra, các bẫy khiến ứng viên giỏi trượt, và những chi tiết code thể hiện tư duy cấp cao."
pubDatetime: 2026-08-12T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - system-design
  - microservices
  - kafka
  - database
---

Phỏng vấn Senior Java không phải để kiểm tra bạn thuộc syntax. Nó để chứng minh bạn có thể **đưa ra đánh đổi khi đối mặt với sự mơ hồ** — đúng cái việc mà một senior được trả tiền để làm.

Bài viết này đi qua sáu mảng bạn đã nhắc: Java core, OOP, microservices, database, Kafka và system design. Với mỗi mảng, mình cho bạn những câu hỏi phỏng vấn viên hay hỏi thật, câu trả lời phân biệt mid và senior, cùng các bẫy phổ biến.

> Quan trọng nhất là tư duy: một phỏng vấn viên nghe câu "tùy thuộc" theo sau bởi một phân tích đánh đổi rõ ràng sẽ hiểu về bạn nhiều hơn trong 30 giây so với mười câu sự thật. Sự thật thì dễ Google, nhưng sự phán đoán thì không.

## 1. Java Core — "senior" thực sự nghĩa là gì

Junior biết cú pháp. Senior biết **JVM đang làm gì, tại sao nó lại hành xử như vậy, và ở đâu nó sẽ làm bạn bất ngờ trên production.**

### 1.1 Memory model và GC

Câu hỏi thường gặp: "Giải thích chuyện gì xảy ra khi bạn `new` một object." Câu trả lời của junior dừng ở "nó nằm trên heap." Senior thì tiếp tục:

- **Heap vs metaspace vs stack.** Object sống ngắn nằm young generation (Eden). Đa số chết ở đó; những object sống sót được copy sang survivor, rồi promote lên old gen. Metaspace giữ metadata của class (thay thế perm gen cũ). Stack giữ frame và primitive/reference cục bộ.
- **Stop-the-world.** Bất kỳ GC pause nào cũng đóng băng luồng ứng dụng. Các throughput collector (Parallel) tối ưu tổng công việc; low-latency collector (G1, ZGC, Shenandoah) tối thiểu hóa thời gian pause. Với service nhạy latency, "dùng G1" là khởi đầu ổn, nhưng hãy sẵn sàng nói về `MaxGCPauseMillis`, region sizing, và cách ZGC đạt pause dưới mili-giây nhờ colored pointers / load barriers.
- **Bẫy hay gặp:** nghĩ GC nghĩa là không cần quản lý bộ nhớ. Unbounded cache, static collection, thread-local leak vẫn làm bạn OOM. Senior sẽ nhắc những thứ này.

```java
// Rò rỉ kinh điển: static cache không bao giờ evict
private static final Map<String, Expensive> CACHE = new HashMap<>();

// Sửa kiểu senior: bounded + time-based eviction
private static final Cache<String, Expensive> CACHE = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .build();
```

### 1.2 Concurrency — chỗ phân hóa thực sự

Đây là nơi phần lớn ứng viên trượt. Bạn nên thạo:

- **`synchronized` vs `ReentrantLock`.** `synchronized` đơn giản và được JVM tối ưu (biased locking bị bỏ ở JDK 17 — cần biết). `ReentrantLock` cho `tryLock(timeout)`, nhiều condition variable, và lựa chọn fairness.
- **`volatile`** — chỉ đảm bảo visibility, không phải atomicity. Nó **không** làm `i++` an toàn.
- **`Atomic*` / `LongAdder`** — `LongAdder` thắng khi contention cao vì nó chia việc update thành nhiều cell.
- **Thread pools.** Đừng dùng `Executors.newFixedThreadPool` với `LinkedBlockingQueue` vô hạn cho workload không tin cậy — nó buffer vô hạn và OOM. Hãy size có chủ đích, dùng bounded queue + `RejectedExecutionHandler`, và hiểu tương tác `corePoolSize` / `maxPoolSize` / `keepAliveTime` / `workQueue`.
- **`CompletableFuture`** — composition non-blocking, `thenCompose` (flatMap) vs `thenCombine`, xử lý exception bằng `handle`/`exceptionally`. Bị kiểm tra rất nhiều.
- **Virtual threads (Project Loom, Java 21+).** Senior năm 2026 phải biết: hàng triệu virtual thread rẻ được schedule trên vài carrier thread. Nó **không** nhanh hơn cho tác vụ CPU, nhưng giải quyết triệt để nghẽn thread-per-request cho service nặng I/O. Biết bẫy pinning (block `synchronized` dài hoặc native call sẽ pin carrier thread).

```java
// Blocking I/O trên virtual thread thì rẻ và ổn:
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = urls.stream()
        .map(url -> executor.submit(() -> fetch(url)))
        .toList();
}
```

### 1.3 JVM internals mà phỏng vấn viên thích

- **Class loading:** bootstrap → platform → application, parent-delegation model, tại sao nó tồn tại (bảo mật + tránh trùng class core). Biết cách debug `ClassNotFoundException` vs `NoClassDefFoundError`.
- **JMM và happens-before:** final, volatile, lock acquisition, thread start/join đều tạo happens-before edge. Đây là câu trả lời chặt chẽ cho "tại sao flag thay đổi không visible?"
- **`String` và immutability,** `Integer` caching (`-128..127`), và tại sao `==` trên wrapper "cắn" người ta.

### 1.4 Runtime & tooling

Senior nói "khi chậy trên prod, tôi không đoán — tôi đo": `jstack`, `jmap`, `jstat`, async-profiler, flight recorder. Kể tên ít nhất hai cái bạn từng dùng để tìm ra vấn đề thật.

## 2. OOP — nguyên lý là vé vào cửa, thiết kế là bài kiểm tra

### 2.1 SOLID không phải để đọc định nghĩa

Phỏng vấn viên muốn thấy SOLID được áp dụng, không phải định nghĩa. Hai cái bị soi kỹ nhất:

- **Open/Closed:** thêm tính năng bằng type mới, không sửa class đang chạy tốt. Strategy / Plugin patterns.
- **Dependency Inversion:** phụ thuộc vào abstraction. Đây là *lý do* Spring tồn tại — bạn inject `PaymentGateway`, không phải `StripeGateway`.

```java
// Vi phạm DIP: dependency cụ thể được gắn cứng
class OrderService {
    private final StripeGateway gateway = new StripeGateway();
}

// Senior: phụ thuộc vào abstraction, được inject
class OrderService {
    private final PaymentGateway gateway;
    OrderService(PaymentGateway gateway) { this.gateway = gateway; }
}
```

### 2.2 Composition over inheritance

Câu hỏi "favor composition over inheritance" rất hay gặp. Câu trả lời senior: inheritance gắn bạn vào implementation của cha và phá encapsulation (kiểu "fragile base class"). Hãy delegate behavior thay vì kế thừa.

### 2.3 Polymorphism & interface trong thực tế

Interface segregation quan trọng khi scale — một interface `UserService` 40 method bắt mọi implementer phải stub 35 method là code smell. Hãy tách theo role.

### 2.4 Bẫy phổ biến

Nói "OOP lỗi thời rồi vì có functional Java." Senior nói: cả hai. Streams cho data transform, OOP cho model domain giàu behavior. Record (Java 16+) tuyệt cho DTO immutable, nhưng Record chứa business logic là code smell — hãy đặt behavior vào service hoặc rich domain type.

## 3. Microservices — bạn sẽ bị hỏi "khi nào KHÔNG nên dùng"

### 3.1 Bẫy distributed-monolith

Câu trả lời senior nhất cho "thiết kế một microservice" đôi khi là "chưa, đừng." Chia nhỏ sớm quá mang lại **network call thay vì method call**, distributed transaction, và 10× chi phí vận hành mà chẳng có lợi ích. Biết trigger để tách: deploy độc lập, profile scaling khác nhau, team khác nhau, failure domain khác nhau.

### 3.2 Service communication

- **Đồng bộ (REST/gRPC):** đơn giản nhất, nhưng mỗi hop thêm latency và điểm chết. Dùng timeout + retry with backoff + circuit breaker (Resilience4j). Không bao giờ retry thiếu idempotency.
- **Bất đồng bộ (event/message):** decouple producer/consumer, hấp thụ spike, cho phép replay. Cái giá là eventual consistency và khó debug hơn.

### 3.3 Resilience patterns (vẽ mấy cái này)

- **Circuit breaker:** mở sau N failure, half-open để thăm dò phục hồi. Ngăn cascading failure.
- **Bulkhead:** cô lập failure (tách thread pool / connection pool) để một dependency chậm không làm cạn kiệt tất cả.
- **Retry + backoff + jitter:** retry `for(i<3)` ngây thơ lúc outage là **tự DDoS chính mình**. Phải thêm jitter.

```java
// Resilience4j: timeout + retry + circuit breaker gộp lại
Supplier<String> decorated = Decorators.ofSupplier(() -> callDownstream())
    .withTimeout(Timeout.of(Duration.ofMillis(800)))
    .withRetry(Retry.ofDefaults("svc"))
    .withCircuitBreaker(CircuitBreaker.ofDefaults("svc"))
    .decorate();
```

### 3.4 Service discovery, config, gateway

Biết vai trò: discovery (Consul/Eureka/K8s DNS), centralized config (Spring Cloud Config / K8s ConfigMap), API gateway (routing, auth, rate limiting), và observability (trace qua OpenTelemetry, metric qua Micrometer/Prometheus).

### 3.5 Distributed data & transactions

- **Saga pattern:** chuỗi local transaction kèm compensating action. Hai style: orchestration (có coordinator) vs choreography (event). Biết đánh đổi: orchestration dễ suy luận; choreography tránh bottleneck trung tâm nhưng khó trace.
- **Two-phase commit (2PC):** tránh — nó giữ lock và không sống sót nếu coordinator chết. Chỉ nhắc để giải thích tại sao không dùng.

## 4. Database — tầng quyết định scale thực sự

### 4.1 Indexing là bắt buộc

- **B-tree vs hash index**, và tại sao range query cần B-tree.
- **Thứ tự cột composite index** — selective nhất / equality trước, range cuối. Giải thích vì sao `WHERE a=? AND b>?` muốn `(a,b)` chứ không `(b,a)`.
- **Covering index** tránh table lookup.
- **Bẫy:** query "dùng index" mà vẫn scan hàng triệu row (low cardinality, function trên cột, implicit type cast). Hãy đọc `EXPLAIN`.

### 4.2 Transaction & isolation

Phỏng vấn viên thích "giải thích isolation levels." Phải chuẩn:

- **Read uncommitted / committed / repeatable read / serializable.**
- **Dirty / non-repeatable / phantom reads** — level nào ngăn cái nào.
- **Lost updates** và cách ngăn: `SELECT ... FOR UPDATE`, optimistic locking với version column, hoặc `SERIALIZABLE`.
- **MVCC** — reader không block writer (PostgreSQL/InnoDB). Đó là lý do "read của tôi lock cả table" thường là hiểu sai.

```sql
-- Optimistic concurrency: tăng version, fail nếu ai đó đã đổi
UPDATE accounts SET balance = balance - 100, version = version + 1
WHERE id = ? AND version = ?;
-- 0 row updated => có người khác đi trước => retry hoặc reject
```

### 4.3 Connection pooling

Senior biết pool là tài nguyên chia sẻ, khan hiếm. Sizing HikariCP: `connections ≈ ((core_count * 2) + effective_spindle_count)` là heuristic khởi điểm, nhưng đáp án thật là "đo dưới tải." Pool quá lớn gây context-switch thrash; quá nhỏ gây queueing.

### 4.4 SQL vs NoSQL — quyết định thật

Đừng nói "NoSQL nhanh hơn." Hãy nói: chọn model khớp access pattern. Document store (MongoDB) cho schema linh hoạt; wide-column (Cassandra) cho write-heavy time-series ở quy mô khổng lồ; relational (Postgres) khi cần join, transaction, integrity. Biết khi nào dùng Redis (cache / counter / pub-sub) thay store bền vững.

### 4.5 N+1 và bẫy ORM

- **N+1 queries** — lazy loading trong loop. Sửa bằng `JOIN FETCH` / entity graphs / batch fetching.
- **Biết SQL mà ORM sinh ra.** Senior đọc SQL. "Nó chạy" với 10 row và chết với 10 triệu là kinh điển.

## 5. Kafka — hệ thống event-driven

### 5.1 Core model

- **Topics, partitions, offsets, consumer groups.** Partition là đơn vị parallelism và ordering — ordering được đảm bảo *trong* một partition, không phải across.
- **Một consumer group** chia partition cho các member; thêm consumer vượt quá partition count thì vô ích.

### 5.2 Delivery semantics — biết cả ba

- **At most once:** có thể mất message (commit offset trước khi xử lý).
- **At least once:** có thể trùng (xử lý trước khi commit) — default thực tế; hãy làm consumer **idempotent** (dedupe bằng message key / offset).
- **Exactly once:** EOS của Kafka qua idempotent producer + transactional API, hoặc đơn giản hơn nhiều là "idempotent consumer + at-least-once."

```java
// Idempotent consumer: dedupe bằng key ổn định, không hy vọng exactly-once
if (processedKeys.putIfAbsent(event.key(), event.offset()) != null) return;
```

### 5.3 Replication & durability

- **Replication factor (RF)** và **ISR** (in-sync replicas). `acks=all` + RF≥3 sống sót mất broker không mất data.
- **Tại sao "acks=1" nguy hiểm** trên prod: leader có thể ack rồi chết trước khi replicate.

### 5.4 Ordering & partitioning

Nếu order quan trọng (payment, audit), bạn phải key bằng entity id để mọi event của nó vào cùng một partition. Đánh đổi: hot key tạo hot partition — đôi khi shard cái key.

### 5.5 Failure mode thực tế

- **Rebalance storms** khi consumer churn. Hiểu cooperative rebalancing.
- **Consumer lag** — monitor nó; là tín hiệu đầu tiên của consumer chậm hoặc producer surge.
- **Poison messages** — record xấu luôn fail; thiếu dead-letter queue (DLQ) thì nó block partition mãi mãi. Senior luôn build DLQ.

```java
// Luôn có đường dead-letter
try { process(record); } 
catch (PoisonException e) { sendToDlq(record, e); /* commit và đi tiếp */ }
```

## 6. System Design — bài capstone của senior

Đây là nơi phán đoán bị test trong 45–60 phút. Quy trình quan trọng hơn đáp án.

### 6.1 Vòng lặp phỏng vấn

1. **Làm rõ yêu cầu & scope.** QPS? read vs write? latency budget? data size? consistency vs availability?
2. **Tính capacity tầm bậy.** "10M user, 100 read/user/ngày = 1B read/ngày ≈ 11.5k QPS." Con số dẹp việc đoán mò.
3. **Component cao cấp.** Clients → CDN → API gateway → services → cache → DB → async workers/queues.
4. **Đào sâu 1–2 chỗ** (theo quan tâm phỏng vấn viên).
5. **Xử lý failure.** Cái gì gãy trước? Làm sao degrade?

### 6.2 Cache strategy

- **Cache-aside (lazy):** app check cache, miss thì đọc DB, ghi ngược cache. Phổ biến nhất. Xử lý **cache stampede** (nhiều request miss cùng lúc) bằng request coalescing / single-flight; xử lý **stale data** bằng TTL; xử lý **thundering herd lúc expire** bằng jittered TTL.
- **Write-through / write-behind** khi cần consistency với store.
- **Cache invalidation** là phần khó — ưu tiên TTL + explicit invalidation on write.

### 6.3 Consistency models

- **CAP:** dưới partition, bạn chọn CP (consistency) hoặc AP (availability). Nói đúng — partition hiếm nhưng không thể tránh, nên chọn thật là "bỏ cái gì *trong lúc* partition."
- **Eventual consistency:** chấp nhận cho feed, count, search; nguy hiểm cho balance, inventory nếu không guard.

### 6.4 Scalability patterns

- **Horizontal scaling + stateless services** (session trong Redis, không phải local memory).
- **Sharding/partitioning** database theo tenant hoặc hash.
- **Async processing** để làm phẳng spike (Kafka + workers).
- **Backpressure & queues** để dependency chậm degrade thay vì sập.

### 6.5 Ví dụ nhỏ: thiết kế URL shortener

- Yêu cầu: 100M URL mới/ngày, 1B redirect/ngày, low latency.
- Key-value store, key = base62(encoded counter hoặc hash). Hash collision → retry với salt.
- Cache URL nóng trong Redis (đa số redirect đánh vào tập nhỏ).
- Redirect là 301/302 — 301 cho browser cache (ít load hơn) nhưng khó đổi hơn.
- Capacity: 1B redirect × ~500 bytes log ≈ 0.5 TB/ngày; plan retention/aggregation.

### 6.6 Observability là một phần của thiết kế

Senior tích hợp tracing (request ID xuyên service), metrics (RED: rate/errors/duration), và structured log từ ngày đầu. "Sau này thêm monitoring" là red flag.

## 7. Cách thể hiện mình là senior

- **Narrate trade-off.** "Tôi dùng at-least-once + idempotent consumer vì exactly-once nặng hơn và hiếm khi cần."
- **Thừa nhận không chắc chắn một cách trung thực.** "Tôi sẽ đo trước khi chốt RF=5; 3 thường đủ."
- **Gắn với experience thật.** "Trên prod chúng tôi từng thấy rebalance storm khi…" đánh bại đọc thuộc lòng.
- **Phản biện nhẹ nhàng.** Nếu design là microservices sớm quá, hãy nói và giải thích cái giá.

## 8. Tự kiểm tra nhanh

Trước phỏng vấn, đảm bảo bạn whiteboard được:

- [ ] Một counter thread-safe dưới contention cao (và tại sao `AtomicLong` có thể nghẽn).
- [ ] Một hàm retry-with-backoff-and-jitter.
- [ ] Một câu SQL + index để sửa N+1 hoặc report chậm.
- [ ] Một Kafka consumer idempotent và có DLQ.
- [ ] Một system diagram cho service nặng read với cache, DB, và queue.
- [ ] Khác nhau giữa `synchronized`, `volatile`, và `AtomicReference` trong một câu mỗi cái.

Nếu mấy cái đó thấy dễ, bạn sẵn sàng rồi. Nếu chưa, đó chính là các lỗ hổng cần vá trước tiên.

Chúc may mắn — và nhớ: senior nghĩa là bạn có thể nói "tùy thuộc" và sau đó *bảo vệ được nó*.
