---
title: "Java Threads: Từ Thread Pool đến Virtual Threads"
description: "Vì sao thêm nhiều thread lại khiến ứng dụng chậm hơn, cách thread pool và backpressure thực sự hoạt động, những lỗi concurrency chỉ xuất hiện ở production, và khi nào Virtual Threads thực sự giúp ích."
pubDatetime: 2026-08-09T00:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Trong nhiều thập kỷ, lập trình viên Java được dạy rằng thread là cách để làm cho ứng dụng nhanh hơn. Và trong nhiều thập kỷ, các sự cố production đã chứng minh điều ngược lại: càng thêm thread, ứng dụng càng chậm — hoặc tệ hơn, càng bất ổn định.

Hãy bắt đầu với bốn câu hỏi mà bất kỳ backend developer nào cũng từng tự hỏi:

- Vì sao thêm nhiều thread lại khiến ứng dụng **chậm hơn**?
- Vì sao một thread pool với hàng trăm thread không cải thiện được CPU utilization?
- Vì sao Virtual Threads xử lý được concurrency khổng lồ nhưng không làm code tính toán (CPU-bound) nhanh hơn?
- Vì sao lỗi concurrency hầu như **chỉ xuất hiện ở production**?

Bài viết này trả lời cả bốn câu hỏi. Chúng ta sẽ đi từ nền tảng (thread thực sự là gì), qua thread pool và các kiểu thất bại của nó, đến những lỗi concurrency phổ biến nhất, và cuối cùng là Virtual Threads — chúng giải quyết được gì, **không** giải quyết được gì, và cách quyết định khi nào dùng thứ gì.

## 1. Thread là gì?

### 1.1. Process vs Thread

**Process** là một chương trình đang chạy: có vùng nhớ riêng, file descriptor riêng, không gian địa chỉ riêng. Hai process không thể đọc trực tiếp bộ nhớ của nhau; chúng giao tiếp qua pipe, socket, file hoặc shared memory — tất cả đều cần phối hợp tường minh.

**Thread** là một đơn vị thực thi *bên trong* một process. Các thread của cùng một process dùng chung bộ nhớ của process (heap, static field, class metadata), đó là lý do chúng giao tiếp với nhau dễ dàng — và cũng là lý do chúng dễ làm hỏng trạng thái của nhau.

```
+-------------------------------------------------------+
|  PROCESS                                               |
|  +-----------------+  +-----------------+             |
|  | Thread 1        |  | Thread 2        |             |
|  | stack riêng     |  | stack riêng     |             |
|  +-----------------+  +-----------------+             |
|                                                       |
|  BỘ NHỚ DÙNG CHUNG: heap, static fields, classes      |
+-------------------------------------------------------+
```

Mỗi thread có **stack riêng** (biến cục bộ, call frame) nhưng **dùng chung** heap. Sự phân tách này giải thích gần như mọi thứ về multithreading: dùng chung là thứ làm nó hữu ích, và dùng chung cũng là thứ làm nó nguy hiểm.

### 1.2. Concurrency vs Parallelism

Hai thuật ngữ này bị nhầm lẫn liên tục, và sự khác biệt là nền móng của cả bài viết.

- **Concurrency** nói về *cấu trúc*: nhiều tác vụ cùng tiến triển trong các khoảng thời gian chồng lấn, xen kẽ nhau trên cùng một CPU.
- **Parallelism** nói về *thực thi*: nhiều tác vụ chạy ở đúng cùng một thời điểm, trên các lõi CPU khác nhau.

```
Concurrency (xen kẽ trên 1 lõi):
  Thread A:  |--A1--|        |--A2--|        |--A3--|
  Thread B:        |--B1--|        |--B2--|        |--B3--|

Parallelism (đồng thời trên 2 lõi):
  Lõi 1:     |------A1------|------A2------|
  Lõi 2:     |------B1------|------B2------|
```

Concurrency không cần nhiều lõi. Parallelism thì bắt buộc phải có. Nếu máy có 4 lõi và bạn tạo 1000 thread, bạn vẫn chỉ có **tối đa 4 tác vụ chạy cùng một lúc** — 996 thread còn lại đang chờ, ngủ, hoặc bị context switch. Tạo thread không tạo ra lõi CPU.

### 1.3. Workload CPU-bound vs I/O-bound

Câu hỏi quan trọng nhất cần đặt ra cho bất kỳ tác vụ nào: *nó đang chờ cái gì?*

- **CPU-bound**: tác vụ dành thời gian để tính toán — parse JSON, băm, xử lý ảnh, mã hóa, nén. Tốc độ bị giới hạn bởi số lõi CPU, không phải số thread.
- **I/O-bound**: tác vụ dành phần lớn thời gian để *chờ* — chờ database, chờ HTTP response, chờ đọc file, chờ message từ Kafka. Tốc độ bị giới hạn bởi độ trễ và mức concurrency, và càng nhiều tác vụ song song càng trực tiếp giúp ích.

```
Tác vụ CPU-bound: [=====tính toán=====][=====tính toán=====][=====tính toán=====]
                  ↑ CPU là điểm nghẽn → chỉ có #cores mới có ý nghĩa

Tác vụ I/O-bound: [chờ DB 95ms][chờ DB 95ms][chờ DB 95ms]
                  [ 5ms làm việc ][ 5ms làm việc ][ 5ms làm việc ]
                  ↑ 95% thời gian là chờ → tăng concurrency giúp ích
```

Một lần gọi DB điển hình trong production: 5 ms làm việc thật, 95 ms chờ đợi. Đó là CPU utilization chỉ 5%. Bạn có thể chạy ~20 tác vụ như vậy trên mỗi lõi trước khi bão hòa CPU — 19 tác vụ kia gần như "miễn phí" trong lúc chờ.

### 1.4. Context Switching

Khi CPU chuyển từ chạy thread này sang thread khác, OS phải lưu toàn bộ trạng thái của thread hiện tại (register, program counter, stack pointer) và nạp trạng thái của thread tiếp theo. Đây là **context switch**, và nó không hề miễn phí:

- Tốn thời gian CPU (microsecond mỗi lần; hàng nghìn lần mỗi giây sẽ cộng dồn thành con số lớn).
- Phá hỏng CPU cache và TLB entries — dữ liệu của thread mới là dữ liệu "lạnh", nên độ trễ bộ nhớ tăng vọt ngay sau mỗi lần chuyển.
- Càng nhiều thread, càng nhiều lần chuyển, và càng nhiều thời gian CPU dành cho *chuyển đổi* thay vì *làm việc*.

Đây chính là câu trả lời trực tiếp cho câu hỏi đầu tiên: **thêm thread nhiều hơn mức máy có thể chạy đồng thời không tăng sức làm việc — nó chỉ tăng chi phí chuyển đổi.**

### 1.5. Blocking

Một thread bị **block** khi nó không thể tiếp tục mà không có sự kiện bên ngoài: chờ lock, `sleep()`, chờ câu query DB, chờ HTTP response. Một thread bị block:

- Bị đưa ra khỏi CPU (tốn **0** CPU trong lúc bị block).
- Vẫn giữ bộ nhớ của nó (stack, khoảng 1 MB dự trữ).
- Vẫn được OS scheduler tính là một thread.

Blocking chính là thứ làm cho công việc I/O-bound có thể scale bằng thread: trong khi thread A chờ DB, CPU có thể chạy thread B. Toàn bộ trò chơi của thread pool — và sau này là của Virtual Threads — là luôn có đủ công việc sẵn sàng chạy để giữ CPU bận rộn trong khi phần lớn thread đang bị block.

## 2. Tạo và sử dụng Thread trong Java

### 2.1. Thread và Runnable

Cách cấp thấp nhất là tạo một `Thread` với một `Runnable`:

```java
Runnable task = () -> System.out.println("Hello from " + Thread.currentThread().getName());

Thread t = new Thread(task, "worker-1");
t.start();
```

Từ Java 8, bạn có thể dùng `Callable` khi cần kết quả trả về:

```java
Callable<Integer> callable = () -> {
    // ... làm việc ...
    return 42;
};
```

### 2.2. start() vs run()

Đây là câu hỏi phỏng vấn kinh điển với một ý nghĩa production thật sự:

```java
Thread t = new Thread(() -> System.out.println("chạy trong " + Thread.currentThread().getName()));

t.start();  // ✅ tạo một OS thread MỚI; tác vụ chạy trong thread đó
t.run();    // ❌ chỉ gọi run() trong thread HIỆN TẠI — không có concurrency nào cả!
```

`run()` không tạo ra thread nào. Nó là một lời gọi phương thức bình thường, được thực thi bởi caller. Nếu bạn thấy `run()` trong code production, ai đó đang gọi một "thread" chưa bao giờ trở thành thread — code vẫn chạy, nhưng với zero parallelism, và lỗi thì vô hình vì kết quả vẫn đúng.

### 2.3. Vì sao `new Thread()` cho từng tác vụ lại nguy hiểm

Cách tiếp cận ngây thơ — một thread cho một tác vụ:

```java
for (int i = 0; i < 100_000; i++) {
    new Thread(() -> {
        // gọi HTTP gì đó
    }).start();
}
```

Đoạn code này gần như chắc chắn sẽ crash hoặc đóng băng ứng dụng. Vì sao?

- **Bộ nhớ**: mỗi platform thread dự trữ khoảng 1 MB stack. 100.000 thread ≈ 100 GB bộ nhớ ảo. JVM sẽ chết vì `OutOfMemoryError: unable to create native thread` trước đó rất lâu.
- **Chi phí tạo**: tạo một thread cần một system call xuống kernel và cấp phát native stack — tính bằng millisecond, không phải nanosecond.
- **Scheduler hỗn loạn**: 100.000 thread trên 8 lõi nghĩa là ~12.500 context switch mỗi thread chỉ để quay một vòng.
- **Không kiểm soát vòng đời**: bạn không thể chờ tất cả chúng, không thể giới hạn số lượng, không thể xử lý lỗi.

JVM không giới hạn số thread bạn tạo — **OS và RAM** mới giới hạn. Mọi giới hạn số thread bạn từng thấy trong production (Tomcat `maxThreads`, HikariCP `maximumPoolSize`) đều tồn tại vì thực tế cứng này.

## 3. Vòng đời của Thread

Mỗi `Thread` đi qua sáu trạng thái. `Thread.getState()` và thread dump hiển thị chúng, và mỗi trạng thái có một ý nghĩa cụ thể trong production:

```
        ┌──────────────────────────────────────────┐
        ▼                                          │
   ┌─────────┐  start()   ┌────────────┐           │
   │  NEW    │───────────▶│ RUNNABLE   │───────────┼──▶  đang chạy trên một lõi
   └─────────┘            └────────────┘           │
                            │  ▲                   │
       bị block vì lock     │  │  có được lock     │
                            ▼  │                   │
                        ┌─────────┐                │
                        │ BLOCKED │                │
                        └─────────┘                │
                            │  ▲                   │
       wait()/join()/park   │  │  được notify      │
                            ▼  │                   │
                        ┌─────────┐                │
                        │ WAITING │                │
                        └─────────┘                │
                            │  ▲                   │
       sleep()/await(ms)    │  │  hết timeout/notify│
                            ▼  │                   │
                        ┌──────────────┐           │
                        │TIMED_WAITING │           │
                        └──────────────┘           │
                            │                      │
   run() trả về/thoát       │                      │
                            ▼                      │
                        ┌───────────┐              │
                        │TERMINATED │──────────────┘
                        └───────────┘
```

- **NEW**: mới được khởi tạo, `start()` chưa được gọi. Thread chưa tồn tại dưới dạng OS thread.
- **RUNNABLE**: thread sẵn sàng chạy, hoặc đang chạy trên một lõi. Lưu ý: Java không phân biệt "đang chạy" và "sẵn sàng chạy" — cả hai đều là RUNNABLE.
- **BLOCKED**: đang chờ giành một `synchronized` monitor mà thread khác đang giữ. Đây là trạng thái bạn thấy khi các thread chất đống trên một hot lock.
- **WAITING**: bị park vô thời hạn qua `Object.wait()`, `Thread.join()` hoặc `LockSupport.park()`. Đang chờ một thread khác đánh thức.
- **TIMED_WAITING**: `Thread.sleep()`, `join(millis)`, `await(timeout, unit)` — chờ với một deadline.
- **TERMINATED**: `run()` trả về hoặc ném exception. Thread đã chết; không thể khởi động lại.

**Bạn gặp các trạng thái này ở đâu trong ứng dụng thực tế:**

- Thread dump đầy các thread `BLOCKED` → synchronized lock contention: một đối tượng dùng chung (thường là database connection hoặc một static map) đang là điểm nghẽn.
- Nhiều thread `WAITING` trên `park` và chất đống → task queue của một `ExecutorService` đầy, hoặc các chuỗi `CompletableFuture` đang chờ nhau.
- Nhiều thread `TIMED_WAITING` trên `sleep` → các job định kỳ; nếu hàng trăm thread đang ngủ, có gì đó đang cấu hình sai.
- Nhiều thread `RUNNABLE` → máy gần như chắc chắn đã bão hòa CPU: `top` sẽ xác nhận điều này.

## 4. Thread Pool và ExecutorService

### 4.1. Vì sao thread pool tồn tại

Kết luận của mục 2: thread đắt đỏ, và tạo thread không giới hạn sẽ giết ứng dụng. Giải pháp là **tái sử dụng một số lượng thread cố định**. Thread pool chính xác là như vậy: một tập worker thread sống lâu và kéo task từ một hàng đợi.

```java
ExecutorService pool = Executors.newFixedThreadPool(10);

for (int i = 0; i < 10_000; i++) {
    pool.submit(() -> processRequest(i));   // 10 thread thực thi 10.000 task
}

pool.shutdown();
// pool.awaitTermination(30, TimeUnit.SECONDS);
```

### 4.2. ThreadPoolExecutor thực sự hoạt động thế nào

Phiên bản cấu hình đầy đủ là `ThreadPoolExecutor`. Nó có bốn núm chỉnh, và **sự tương tác giữa chúng rất tinh tế**:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        10,                                  // corePoolSize
        100,                                 // maximumPoolSize
        60, TimeUnit.SECONDS,                // keepAliveTime (cho các thread trên core)
        new ArrayBlockingQueue<>(10_000),    // work queue
        new ThreadPoolExecutor.CallerRunsPolicy()  // rejection policy
);
```

Thuật toán tiếp nhận task, từng bước:

```
submit(task):
  1. nếu worker threads < corePoolSize       → tạo worker mới, chạy task
  2. nếu queue chưa đầy                      → đẩy task vào queue
  3. nếu worker threads < maximumPoolSize    → tạo worker mới (tối đa đến max)
  4. ngược lại                               → áp dụng rejection policy
```

Điểm mấu chốt: **queue được dùng *trước khi* pool tăng vượt core size.** Với `newFixedThreadPool(10)`, queue nội bộ là unbounded, nên bước 3 không bao giờ xảy ra — một pool "cố định" 10 thread sẽ **không bao giờ** vượt quá 10 thread, dù bạn nộp bao nhiêu task đi nữa. Hàng nghìn task xếp hàng sẽ chỉ... chờ.

### 4.3. Core size, Max size và Queue

- **corePoolSize**: số thread mà pool duy trì ổn định.
- **maximumPoolSize**: trần tuyệt đối, chỉ đạt được khi queue *đã đầy*.
- **work queue**: vùng đệm giữa producer và worker.
- **keepAliveTime**: một thread rảnh *trên core size* sống bao lâu trước khi bị hủy (hành vi mặc định; `allowCoreThreadTimeOut(true)` mở rộng điều này cho cả core threads).

Điều này có nghĩa cùng một cấu hình `ThreadPoolExecutor` sẽ hoạt động hoàn toàn khác nhau tùy queue:

```java
// ❌ queue unbounded: task chất đống vô hạn, bộ nhớ tăng cho đến OOM
new ThreadPoolExecutor(10, 100, 60, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(),            // unbounded!
        ...);

// ✅ queue có giới hạn: task dư tràn sang extra threads, rồi bị reject
new ThreadPoolExecutor(10, 100, 60, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(1_000),        // bounded
        ...);
```

Với queue unbounded, `maximumPoolSize` là cấu hình chết — pool không bao giờ chạm tới nó.

### 4.4. Rejection Policies

Khi pool bão hòa (mọi worker đều bận, queue đầy), rejection policy quyết định:

| Policy | Hành vi | Khi nào dùng |
| ------ | ------- | ------------ |
| `AbortPolicy` (mặc định) | Ném `RejectedExecutionException` | Fail nhanh; caller phải xử lý |
| `CallerRunsPolicy` | Task chạy **trong thread của caller** | Backpressure tự nhiên: producer tự chậm lại |
| `DiscardPolicy` | Lặng lẽ bỏ task | Không bao giờ — mất dữ liệu âm thầm |
| `DiscardOldestPolicy` | Bỏ task cũ nhất trong queue | Chỉ cho công việc stale/theo cửa sổ thời gian |

`CallerRunsPolicy` là lựa chọn được yêu thích trong production để tạo backpressure: code nộp task buộc phải tự thực thi nó, nên nó bị chặn, nên producer tự động chậm lại đúng bằng tốc độ của consumer.

### 4.5. Vòng đời worker và shutdown pool

Worker được tạo lười biếng (khi có task đến), không phải tạo sẵn. Khi shutdown pool:

```java
pool.shutdown();                    // ngừng nhận task mới, chờ task đã xếp hàng chạy xong
pool.shutdownNow();                 // interrupt worker đang chạy, trả về các task đang xếp hàng

boolean done = pool.awaitTermination(30, TimeUnit.SECONDS);
if (!done) pool.shutdownNow();
```

Pool không bao giờ được shutdown sẽ giữ thread sống mãi mãi — và trong ngữ cảnh Spring/application server, điều đó là có chủ đích (pool sống theo vòng đời ứng dụng).

### 4.6. Backpressure

**Backpressure** là nguyên tắc: một producer nhanh phải bị buộc chậm lại khi consumer không theo kịp — thay vì để task, bộ nhớ, hay kết nối chất đống không giới hạn.

Trong thế giới thread pool, backpressure đến từ ba lớp:

1. **Queue có giới hạn** — producer chỉ đẩy được xa đến mức nào đó.
2. **Rejection policy** — điều gì xảy ra khi buffer đầy (`CallerRunsPolicy` làm producer chậm lại; `AbortPolicy` làm request thất bại).
3. **Circuit breaker ở tầng API** — từ chối request trước khi chúng chạm đến pool khi hệ thống đã bão hòa.

Ví dụ production: một request handler nộp công việc cho một pool:

```java
@Service
public class RequestService {

    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(
            20, 40, 60, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(5_000),
            new ThreadPoolExecutor.CallerRunsPolicy());

    public void handle(Request request) {
        try {
            executor.execute(() -> process(request));
        } catch (RejectedExecutionException e) {
            throw new TooBusyException("system at capacity, try again later");
        }
    }
}
```

Queue đầy → `CallerRunsPolicy` chạy task trong thread của request (producer chậm lại). Nếu kể cả caller cũng không chạy được, exception được biến thành lỗi kiểu `503` sạch sẽ thay vì chất đống âm thầm.

## 5. Hiệu suất của Thread: Sự thật về số lượng thread

Huyền thoại đắt giá nhất trong Java concurrency: *nhiều thread hơn = nhanh hơn*.

### 5.1. Giới hạn lõi cho công việc CPU-bound

Một workload CPU-bound chỉ có thể chạy song song đúng bằng số lõi. Kích thước pool tối ưu gần bằng **#cores** (đôi khi `cores + 1` để bù cho page fault thi thoảng xảy ra).

```
8 lõi, CPU-bound, 200 thread:

Lõi 1-8: [đang làm việc][đang làm việc][đang làm việc][đang làm việc][đang làm việc][đang làm việc][đang làm việc][đang làm việc]
192 thread còn lại: --------------- tắc đường context switch ---------------
```

192 thread thừa không làm gì ngoài đốt CPU vào context switch. **Ứng dụng chậm hơn**, không phải nhanh hơn, vì chi phí chuyển đổi tăng theo số thread.

### 5.2. Công thức cho công việc I/O-bound

Với workload I/O-bound, công thức kinh điển là:

```
số thread tối ưu ≈ cores × (1 + thời gian chờ / thời gian tính toán)
```

Một tác vụ chờ database 95 ms và tính toán 5 ms có `chờ/tính = 19`, nên một máy 8 lõi có thể chạy hữu ích khoảng 160 thread. Các thread đang chờ gần như miễn phí — chúng bị block, không dùng CPU.

### 5.3. Ý nghĩa thực tế

- Số thread phải được suy ra từ **loại workload** và **tài nguyên sẵn có**, không bao giờ từ đoán mò hay tư duy "càng to càng tốt".
- CPU-bound: pool size ≈ số lõi. Thêm thread = thêm overhead.
- I/O-bound: pool size ≈ cores × (1 + chờ/tính). Tăng concurrency = cải thiện latency/throughput, cho đến giới hạn của tài nguyên mà các tác vụ đang chờ.
- Tài nguyên mà các tác vụ chờ (DB connection, HTTP client, file) cũng có giới hạn — pool không phải là cái trần duy nhất.

## 6. Các lỗi Concurrency phổ biến và sai lầm thường gặp

Phần này bao gồm những lỗi vượt qua code review và sụp đổ ở production. Mỗi lỗi có cùng khuôn mẫu: ví dụ, vì sao xảy ra, hậu quả, và cách sửa.

### 6.1. Race Condition

```java
public class Counter {
    private int count;

    public void increment() {
        count++;                    // ❌ không atomic
    }
}
```

**Vì sao xảy ra:** `count++` là ba thao tác: đọc field, cộng 1, ghi field. Thread A đọc được `count = 5`, thread B cũng đọc được `5`, cả hai cùng ghi `6` — một lần tăng bị mất.

**Hậu quả:** tổng số sai chỉ xuất hiện khi có tải. Đây là lỗi kinh điển chỉ xuất hiện ở production: nó cần một sự xen kẽ cụ thể của hai thread tại đúng cùng một câu lệnh.

**Cách sửa:**

```java
public class Counter {
    private final AtomicInteger count = new AtomicInteger();

    public void increment() {
        count.incrementAndGet();    // ✅ read-modify-write atomic
    }
}
```

### 6.2. Atomicity, Visibility và Ordering

Đây là ba trụ cột của Java Memory Model (JMM), và mọi lỗi concurrency trong Java đều là vi phạm một trong ba:

- **Atomicity**: một thao tác chạy như một khối không thể tách rời (không thread nào thấy nó hoàn thành nửa chừng). Bị phá vỡ bởi `count++`; được sửa bởi `synchronized`, `Atomic*` hoặc lock.
- **Visibility**: write của thread A có thể không bao giờ được thread B thấy, vì mỗi thread có thể cache giá trị trong register hoặc CPU cache. Write không tự động được flush ra main memory.
- **Ordering**: JIT compiler và CPU có thể sắp xếp lại lệnh miễn là ngữ nghĩa đơn luồng vẫn đúng — điều này có thể tạo ra hành vi trông như không thể xảy ra trong thế giới đơn luồng.

```java
public class VisibilityBug {
    private boolean running = true;     // ❌ không có volatile

    public void stop() {
        running = false;
    }

    public void work() {
        while (running) {               // có thể lặp vô hạn — write không bao giờ được thấy
            // ...
        }
    }
}
```

**Cách sửa:** khai báo field là `volatile`, hoặc bảo vệ bằng `synchronized` — cả hai đều tạo quan hệ **happens-before** giúp publish write tới các thread khác.

### 6.3. synchronized

```java
public class Counter {
    private int count;

    public synchronized void increment() {
        count++;                        // ✅ vừa atomic vừa visible
    }
}
```

`synchronized` cho bạn mutual exclusion (atomicity) *và* memory visibility, thông qua việc giành intrinsic monitor. Nó reentrant (cùng thread có thể vào lại), và nó chặn các thread đang chờ. Điểm yếu: không có timeout (một lock holder bị kẹt sẽ chặn tất cả mọi người mãi mãi), không fair (mặc định là non-fair), và granularity thô dễ gây contention.

### 6.4. volatile và vì sao nó KHÔNG làm count++ atomic

`volatile` chỉ đảm bảo **visibility và ordering**. Nó đảm bảo read luôn thấy write mới nhất, và ngăn reordering. Nó **không** cung cấp atomicity:

```java
private volatile int count;

count++;        // ❌ VẪN hỏng: read-modify-write vẫn là ba bước
```

`incrementAndGet()` của `AtomicInteger` atomic vì nó dùng CAS (compare-and-swap) ở mức phần cứng. `volatile` không làm được điều đó. Quy tắc ngón tay cái: **`volatile` dành cho cờ và trạng thái, `AtomicInteger`/`AtomicLong`/`AtomicReference` dành cho bộ đếm và đối tượng trạng thái.**

### 6.5. Locks

`ReentrantLock` là người anh em lập trình được của `synchronized`, với nhiều công cụ hơn:

```java
ReentrantLock lock = new ReentrantLock();

lock.lock();
try {
    // critical section
} finally {
    lock.unlock();          // ✅ luôn trong finally, nếu không lock sẽ không bao giờ được nhả
}
```

Những gì `synchronized` không làm được, `ReentrantLock` làm được:

```java
boolean acquired = lock.tryLock(2, TimeUnit.SECONDS);   // ✅ bỏ cuộc sau 2 giây
// -> tránh chờ vô hạn một thread giữ lock bị kẹt

Lock readLock = rwLock.readLock();   // ✅ nhiều reader / một writer
Lock writeLock = rwLock.writeLock();

Condition notEmpty = lock.newCondition();  // ✅ chờ chính xác: await()/signal()
```

`tryLock(timeout)` là tuyến phòng thủ đầu tiên chống deadlock và chặn vô thời hạn.

### 6.6. Deadlock

```java
// Thread 1                        // Thread 2
synchronized (lockA) {             synchronized (lockB) {
    synchronized (lockB) {             synchronized (lockA) {
        // ...                            // ...
    }                                }
}                                }
```

**Vì sao xảy ra:** mỗi thread giữ một lock và chờ lock mà thread kia đang giữ. Chờ vòng: A→B→A.

**Hậu quả:** các thread kẹt vĩnh viễn trong trạng thái `BLOCKED`. Toàn hệ thống suy thoái âm thầm — không lỗi, không exception, chỉ là các thread chất đống trong dump và latency tăng dần cho đến khi ai đó chụp một thread dump.

**Cách sửa:**

1. **Lock ordering**: luôn giành lock theo cùng một thứ tự toàn cục (ví dụ sắp theo ID), để vòng lặp không thể hình thành.
2. **`tryLock(timeout)`**: đừng chờ vô hạn; retry hoặc thất bại sau timeout.
3. **Một lock duy nhất**: giữ tối đa một lock tại một thời điểm.
4. **Phát hiện**: chụp thread dump — deadlock hiện ra ngay lập tức dưới dạng các trạng thái `BLOCKED`/`WAITING` vòng tròn.

### 6.7. Thread Starvation (đói tài nguyên)

Starvation là khi một số thread **không bao giờ** được tiến triển trong khi những thread khác vẫn chạy. Ba dạng production phổ biến:

1. **Lock starvation**: `synchronized` mặc định không fair — khi có contention liên tục, một thread có thể chờ vô thời hạn trong khi các thread mới đến cứ giành được lock.
2. **Task starvation**: một task dài ở đầu queue của pool trì hoãn mọi task đứng sau nó.
3. **Resource starvation**: một số task giữ connection/permits trong khi chờ những thứ khác — ở thái cực, đây trở thành deadlock.

**Giảm thiểu:** fair lock (`new ReentrantLock(true)`) khi phân bố latency quan trọng, timeout ở mọi nơi, task có giới hạn (chia nhỏ job dài), và theo dõi thread dump xem có thread nào kẹt `WAITING`/`BLOCKED` quá lâu.

### 6.8. Thread Pool Exhaustion (cạn kiệt thread pool)

```java
// ❌ sự cố production kinh điển
ExecutorService pool = Executors.newFixedThreadPool(10);   // 10 thread
// một đợt bùng nổ DB call chậm chất 50.000 task vào queue
// → mọi request chờ lâu hơn 10.000%; queue phình to; bộ nhớ tăng; sắp OOM
```

**Vì sao xảy ra:** producer nộp task nhanh hơn khả năng pool tiêu thụ. Với queue unbounded, pool không bao giờ reject — nó chỉ suy thoái: queue tăng → latency tăng → request chất đống → OOM hoặc mất phản hồi hoàn toàn.

**Cách sửa:** queue có giới hạn + rejection policy + giám sát độ sâu queue (cảnh báo khi nó tăng), như ở mục 4.6.

### 6.9. Blocking operations trong thread pool dùng chung

Thảm họa kinh điển: một pool dùng chung cho mọi service, và ai đó thêm một task làm HTTP call đồng bộ chậm, query DB, hoặc `Thread.sleep()`:

```java
// ❌ một task chậm chặn cả một pool dùng chung
executor.execute(() -> {
    String response = externalApi.call();   // 5 giây blocking
    // ... trong lúc đó 49 task còn lại phải chờ
});
```

Một pool 10 thread mà 8 thread kẹt ở các external call chậm thì chỉ còn 2 thread xử lý *mọi thứ* — kể cả các request nhanh, nhạy cảm với latency. **Hậu quả:** một dependency chậm kéo sập chức năng không liên quan.

**Cách sửa:** không bao giờ trộn nhiều loại workload vào một pool. Pool riêng cho từng loại: một pool cho DB, một pool cho HTTP, một pool cho CPU-bound. Kích thước từng pool theo tỷ lệ chờ/tính của riêng nó.

### 6.10. Unbounded Queue

Đã đề cập ở trên nhưng đáng được nhắc lại riêng: `new LinkedBlockingQueue<>()` không chỉ định kích thước, hoặc `Executors.newCachedThreadPool()` (dùng `SynchronousQueue`, *tạo một thread mới cho mọi task* — thread không giới hạn!), là hai cách phổ biến nhất để biến một consumer chậm thành OOM. Luôn giới hạn queue của bạn.

### 6.11. Thiếu Backpressure

Không có backpressure, một producer nhanh (một batch Kafka consumer, một cơn lũ webhook) đổ task vào pool không giới hạn. Queue phình to, latency bùng nổ, và đến một lúc hệ thống ngã quỵ — trong khi producer *vẫn đang* sản xuất. Cách sửa là ba lớp phòng thủ ở mục 4.6: queue có giới hạn, rejection policy, circuit breaker. **Backpressure không phải thứ tùy chọn; nó là ranh giới giữa suy thoái có kiểm soát và sụp đổ hoàn toàn.**

### 6.12. ThreadLocal leak với thread pool

`ThreadLocal` lưu giá trị theo từng thread. Với một thread thông thường, giá trị chết cùng thread. Với **pool, các thread được tái sử dụng trong nhiều năm** — nên một `ThreadLocal` không bao giờ được gỡ sẽ rò rỉ bộ nhớ, *và* task tiếp theo dùng lại thread đó sẽ thấy **dữ liệu cũ**:

```java
// ❌ leak: thread giữ user context mãi mãi
public void process(Request r) {
    ThreadLocal<SecurityContext> ctx = ThreadLocal.withInitial(SecurityContext::new);
    ctx.set(loadContext(r));
    // ... làm việc ...
    // không bao giờ remove → task kế tiếp trên thread này thấy context của NGƯỜI KHÁC!
}
```

**Cách sửa:** luôn dọn dẹp trong `finally`:

```java
ThreadLocal<SecurityContext> ctx = new ThreadLocal<>();

public void process(Request r) {
    try {
        ctx.set(loadContext(r));
        // ... làm việc ...
    } finally {
        ctx.remove();       // ✅ ngăn cả memory leak lẫn cross-request leak
    }
}
```

Biến thể nhạy cảm về bảo mật: context xác thực cũ rò rỉ giữa các request là lỗi lộ dữ liệu, không chỉ là memory leak.

### 6.13. Exception biến mất âm thầm với ExecutorService

Đây là lỗi vô hình phổ biến nhất trong Java concurrency:

```java
// ❌ exception biến mất
executor.submit(() -> {
    throw new RuntimeException("boom");
});
// không ai gọi future.get() → lỗi bị nuốt trọn, không để lại dấu vết
```

`submit()` giữ exception trong `Future` — nó không bao giờ được in ra, không bao giờ được log, không bao giờ được thấy. Task "thất bại" mà hệ thống trông vẫn khỏe mạnh. **Đây là lý do lỗi concurrency chỉ xuất hiện ở production: các lỗi không bao giờ nổi lên ở bất kỳ đâu.**

```java
// ✅ cách 1: luôn xử lý Future
Future<?> future = executor.submit(task);
try {
    future.get(10, TimeUnit.SECONDS);     // làm lộ exception (kèm timeout)
} catch (Exception e) {
    log.error("task failed", e);
}

// ✅ cách 2: bọc task bằng try/catch của chính nó
executor.execute(() -> {
    try {
        doWork();
    } catch (Exception e) {
        log.error("task failed", e);      // không bao giờ bị nuốt âm thầm
    }
});
```

Lưu ý sự khác biệt: `execute()` đưa exception tới `UncaughtExceptionHandler` của thread; `submit()` đưa exception vào `Future`. Nếu bạn dùng `submit()` rồi bỏ qua `Future`, lỗi sẽ không đi đến đâu cả.

## 7. Platform Threads vs Virtual Threads

### 7.1. Platform Threads là gì

Mọi thứ trước phần này đều nói về **platform threads**: `Thread` kinh điển của Java, gói một OS thread theo tỷ lệ 1:1. JVM tạo một native thread, OS lên lịch cho nó, và Java stack nằm trên native stack.

```
Mô hình platform thread:

  Java thread ──1:1──▶ OS thread ──▶ core
        ▲
        │ ~1 MB stack, do kernel tạo, do kernel lên lịch
        │ thời gian tạo: millisecond; số lượng: hàng nghìn, không phải hàng triệu
```

Các giới hạn là giới hạn của OS: chi phí tạo, bộ nhớ stack, overhead của scheduler. Đây là lý do 10.000 platform thread đã là rất nhiều, và 100.000 thì thường là bất khả thi.

### 7.2. Virtual Threads là gì

**Virtual thread** là một lightweight thread do JVM quản lý (Java 21, JEP 444). Nó không phải OS thread. Nó là một đối tượng `Thread` có stack và trạng thái riêng, nhưng được *lên lịch bởi JVM* lên một pool nhỏ các platform thread gọi là **carrier threads**.

```
Mô hình virtual thread (nhiều : ít):

  100.000 virtual threads
        │   JVM scheduler
        ▼
   ( 8 carrier threads — platform threads — OS threads )
        │
        ▼
        Lõi CPU
```

Cơ chế mấu chốt: khi một virtual thread **block** (DB call, HTTP call, `sleep()`), JVM **unmount** nó khỏi carrier — lưu trạng thái, tách nó ra — rồi mount một virtual thread sẵn sàng khác lên carrier vừa được giải phóng. Với OS, không có gì xảy ra; carrier chưa bao giờ block.

```java
// virtual thread bị block
Thread.startVirtualThread(() -> {
    String body = restClient.get(URI).getBody();   // block -> JVM park VT này
    System.out.println(body);                      // tiếp tục sau, trên một carrier bất kỳ
});
```

### 7.3. JVM park một Virtual Thread bị unmount như thế nào

Đứng sau cơ chế này là **continuations**: trạng thái thực thi của virtual thread (call stack, biến cục bộ, program counter) có thể được đóng băng và phục hồi. Một lời gọi blocking trong code tương thích với virtual thread (socket I/O, `LockSupport.park`, `sleep`, thao tác queue) kích hoạt một cú nhảy vào JVM scheduler: lưu continuation, trả quyền điều khiển cho scheduler, chọn virtual thread runnable tiếp theo. Khi thao tác blocking hoàn tất (ví dụ một I/O completion event), continuation được đưa vào hàng chờ runnable và re-mount lên một carrier.

Một lưu ý quan trọng — **pinning**: nếu một virtual thread block trong khi đang ở bên trong một khối `synchronized` (hoặc native code), nó có thể *pin* carrier thread, tức là carrier không thể được tái sử dụng. JVM phải giữ platform thread sống và block thật sự. JDK 21 giới hạn pinning ở các trường hợp cụ thể (class initialization, native frames, `synchronized` trong native/foreign code); dù vậy, nguyên tắc production vẫn là: **tránh các blocking call dài bên trong khối `synchronized` khi dùng virtual threads** — đó là phiên bản hiện đại của việc chặn một pool thread.

### 7.4. Ví dụ thực hành

```java
// ✅ 1. một virtual thread dùng một lần
Thread vt = Thread.startVirtualThread(() -> {
    // blocking I/O hoàn toàn ổn — JVM park, không phải OS
});

// ✅ 2. executor theo task: một virtual thread cho mỗi task
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 10_000).forEach(i ->
        executor.submit(() -> fetchOrder(i))    // 10.000 blocking task
    );
}
// close() chờ mọi task hoàn thành
```

So sánh: 10.000 task kiểu này với platform threads cần 10.000 OS thread (~10 GB stack) hoặc một pool tinh chỉnh thủ công với batching phức tạp. Với virtual threads, đây chỉ là một chương trình bình thường.

### 7.5. Khi nào chúng giúp ích? Workload blocking I/O

Virtual threads tỏa sáng đúng chỗ có tỷ lệ chờ/tính cao — các workload I/O-bound trong mục 5.2:

- **HTTP calls**: một service fan-out ra nhiều external API.
- **Database calls**: JDBC call block trên socket; mỗi virtual thread bị block tốn gần như không có gì.
- **File I/O**: read/write trên network filesystem.
- **Nhiều blocking task đồng thời**: web server (Tomcat với `maxThreads` cấu hình sang virtual thread executor), batch job gọi nhiều service song song.

```java
// 100.000 blocking HTTP call, code tuần tự trông đơn giản:
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = urls.stream()
            .map(url -> executor.submit(() -> httpClient.get(url)))
            .toList();
    for (var f : futures) f.get();              // chờ tất cả
}
```

Một virtual thread cho mỗi task nghĩa là không cần tính pool size, không cần chỉnh queue, không cần núm backpressure ở tầng thread — JVM lo toàn bộ sổ sách. Đây là chiến thắng thực sự của Virtual Threads: **bạn viết code blocking, và bài toán scaling biến mất.**

## 8. Khi nào Virtual Threads KHÔNG giúp ích

Đây là phần mà hầu hết bài viết bỏ qua, và là phần ngăn chặn các sự cố production.

### 8.1. Chúng không làm CPU-bound task nhanh hơn

Một virtual thread vẫn cần một CPU để chạy. Công việc CPU-bound (parse JSON, crypto, nén, xử lý ảnh) bị giới hạn bởi số lõi — đúng giới hạn như platform threads. Chạy một task CPU-bound trên virtual threads không thay đổi gì ngoài việc thêm scheduling overhead:

```java
// ❌ 100.000 virtual thread parse JSON sẽ KHÔNG nhanh hơn 100.000 lần
// nó chỉ nhanh đúng bằng số lõi cho phép — kèm overhead chuyển đổi
```

**Quy tắc: CPU-bound → dùng theo số lõi; I/O-bound → dùng virtual threads.**

### 8.2. Chúng không tạo thêm lõi CPU

Virtual threads không nhân bản phần cứng. Nếu máy có 8 lõi, tối đa 8 virtual thread tính toán tại bất kỳ thời điểm nào — y hệt trước đây.

### 8.3. Chúng không giải quyết race condition

```java
// ❌ vẫn hỏng trên virtual threads
public void increment() {
    count++;    // ba lệnh, vẫn race trên virtual threads
}
```

Virtual threads xen kẽ y hệt platform threads. Shared mutable state, truy cập không đồng bộ, và mất update đều vẫn là bug. **Thread-safety là thuộc tính của code của bạn, không phải của mô hình threading.**

### 8.4. Chúng không gỡ bỏ giới hạn tài nguyên

Đây là insight quan trọng nhất, cần được nói thẳng:

> **Virtual Threads loại bỏ chi phí của các thread đang chờ — chứ không loại bỏ chi phí của tài nguyên mà chúng đang chờ.**

Hãy tưởng tượng 100.000 virtual thread, mỗi thread làm một query database. JDBC pool chỉ có 20 connection:

```
100.000 virtual threads
        │  mỗi thread muốn một DB connection
        ▼
   DB connection pool (20 connections)
        ▼
        database (chỉ xử lý được ~20 query cùng lúc)
```

Trước Virtual Threads: "chúng ta chỉ có 100 thread, nên tối đa 100 query phải chờ." An ủi sai lầm — pool vốn đã là điểm nghẽn, thread chỉ che giấu nó.

Sau Virtual Threads: 100.000 thread chờ trên một semaphore bên trong connection pool. **Database vẫn chỉ nhận đúng 20 query đồng thời.** Latency, throughput và tải database giống hệt từng byte. Điều gì thay đổi? 100.000 người chờ giờ gần như không tốn bộ nhớ hay CPU — đó là điều tốt — nhưng *điểm nghẽn* (20 connections) vẫn y nguyên. Nếu bạn giờ tràn ngập request vào, pool vẫn block, việc xếp hàng chỉ chuyển sang một lớp khác, và 20 connections vẫn trở thành tài nguyên nóng.

Logic tương tự áp dụng cho mọi thứ mà các task chờ đợi:

- Database connection pool (HikariCP `maximumPoolSize`).
- HTTP client connection pool (keep-alive connections).
- Rate limit và quota của external API.
- File handle, Kafka partitions, lock.

### 8.5. Chúng không xóa bỏ nhu cầu backpressure

Tạo virtual thread không giới hạn nguy hiểm y hệt nộp task không giới hạn: 10 triệu virtual thread đang chờ không crash JVM, nhưng các tài nguyên mà chúng chất lên (DB pool, external API, đĩa) vẫn bão hòa, và hàng đợi chỉ dời vào bên trong các tài nguyên đó. Bạn vẫn cần queue có giới hạn, semaphore, và từ chối ở tầng API — Virtual Threads chỉ làm cho việc chờ đợi trở nên rẻ, không phải vô hạn.

## 9. Những sai lầm phổ biến khi dùng Virtual Threads

### 9.1. Concurrency không giới hạn

```java
// ❌ mỗi request sinh ra một virtual thread, không có giới hạn ở bất kỳ đâu
Executors.newVirtualThreadPerTaskExecutor();
// 50k request đồng thời -> 50k DB call đồng thời -> pool bão hòa -> timeout
```

Vì virtual threads rẻ, các team ngừng nghĩ về giới hạn. Nhưng các tài nguyên mà chúng chờ vẫn có giới hạn. **Giới hạn công việc đồng thời bằng một `Semaphore` (hoặc một `Executor` với virtual threads có giới hạn):**

```java
// ✅ giới hạn concurrency ở đúng mức DB pool có thể phục vụ
Semaphore dbSlots = new Semaphore(20);                 // HikariCP maximumPoolSize = 20

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request r : requests) {
        executor.submit(() -> {
            try {
                dbSlots.acquire();
                orderRepository.save(r);               // chỉ 20 request cùng lúc chạm DB
            } finally {
                dbSlots.release();
            }
        });
    }
}
```

### 9.2. Workload nặng CPU trên virtual threads

Virtual threads không tăng tốc tính toán; chúng thêm scheduling overhead vào tính toán. Hãy dùng fixed pool theo số lõi cho công việc CPU-bound.

### 9.3. Shared mutable state

```java
// ❌ "virtual threads" không tự nhiên thread-safe
static int totalRequests;          // race, y hệt platform threads
```

### 9.4. Quên giới hạn tài nguyên

20 DB connections, quota API 30 RPS, giới hạn 10 file descriptor — không thứ nào thay đổi với virtual threads. Kích thước semaphore và pool phải dựa trên giới hạn *phía downstream*, không phải dựa trên số thread bạn *có thể* tạo.

### 9.5. Cho rằng Virtual Threads tự động làm ứng dụng thread-safe

Không. Toàn bộ mục 6 vẫn áp dụng nguyên vẹn. Ngữ nghĩa lifecycle và visibility giống hệt platform threads.

### 9.6. Cho rằng Virtual Threads xóa bỏ mọi giới hạn concurrency

Chúng xóa bỏ *số lượng thread* khỏi danh sách yếu tố giới hạn. Chúng không xóa bỏ: connection pool, quota API, lõi CPU, heap memory — và quan trọng là, chúng vẫn còn những lưu ý về pinning trong `synchronized`. Kỷ luật (concurrency có giới hạn, timeout, backpressure) vẫn phải giữ.

## 10. Bảng quyết định thực hành

| Nhu cầu | Công cụ | Vì sao / khi nào |
| ------- | ------- | ---------------- |
| Background task dùng một lần, test, script | Raw `Thread` | Đơn giản, ngắn hạn; không bao giờ trong request path production |
| Thực thi task nói chung, cần kiểm soát vòng đời | `ExecutorService` | submit/await/shutdown, tái sử dụng worker |
| Workload CPU-bound | Fixed pool ≈ `#cores` | Thêm thread chỉ thêm switching overhead |
| Workload I/O-bound, concurrency vừa phải | Fixed/bounded pool, kích thước theo chờ/tính | Kinh điển, dễ hiểu; bắt buộc bounded queue |
| Blocking concurrency khổng lồ (fan-out HTTP, nhiều DB call) | Virtual Threads (`newVirtualThreadPerTaskExecutor`) | Thread bị block giá rẻ; code blocking đơn giản; không cần chỉnh pool |
| Bộ đếm, cờ, trạng thái đơn giản | `AtomicInteger` / `AtomicLong` / `AtomicReference`, `volatile` | Atomicity (bộ đếm) hoặc visibility (cờ) |
| Critical section phức tạp, chờ nhiều điều kiện | `synchronized` / `ReentrantLock` / `Condition` | Mutual exclusion; ưu tiên `tryLock(timeout)` cho an toàn |
| Giới hạn concurrency cho tài nguyên khan hiếm (DB pool, quota API) | `Semaphore` | Backpressure ở tầng tài nguyên — hoạt động cả với virtual threads |
| Rate limiting / circuit breaking | `RateLimiter`, `Resilience4j`, `Bucket4j` | Từ chối từ phía upstream trước khi bão hòa nội bộ |
| Tính toán song song nặng | Parallel streams, `ForkJoinPool`, `CompletableFuture` với pool tùy chỉnh | Parallelism tường minh, kích thước theo số lõi |

## 11. Debugging trong production: điều tra vấn đề thread

Khi có gì đó chậm hoặc kẹt, bước đầu tiên luôn giống nhau: **chụp một thread dump và nhìn vào các trạng thái.**

### 11.1. Thread dumps

```bash
jcmd <pid> Thread.print            # hoặc: jstack <pid>  hoặc: kill -3 <pid>
```

Cần nhìn những gì:

- Nhiều thread ở trạng thái `BLOCKED` → synchronized contention; tìm monitor trong stack trace, tìm ai đang giữ nó.
- Thread ở `WAITING`/`TIMED_WAITING` trên `park` → đang chờ `CompletableFuture`, chờ queue của pool, hoặc pool thread đang rảnh.
- **Deadlock**: `jstack` in ra mục `Found one Java-level deadlock` kèm vòng lặp.
- Toàn bộ pool thread bận trên cùng một call chậm → dependency đó chính là điểm nghẽn.

### 11.2. Giám sát JVM và metrics

- **CPU utilization**: `top`/`htop` theo từng thread (`top -H`), cộng thêm `jstat`. 100% trên mọi lõi với nhiều thread `RUNNABLE` → bão hòa CPU-bound; CPU thấp mà latency dài → đang chờ một thứ gì đó.
- **JFR** (`jfr start --filename app.jfr`, `jfr view`): thread allocation, lock contention (`jdk.JavaMonitorEnter`), CPU sampling, không cần restart ứng dụng.
- **Micrometer/JMX** cho `ThreadPoolExecutor`:
  - `executor_active_threads`, `executor_pool_size`, `executor_queue_size` — queue tăng trưởng là dấu hiệu cảnh báo sớm nhất của pool exhaustion.
  - `executor_completed_task_count` — đường thẳng nằm ngang nghĩa là công việc đang kẹt.
- **HikariCP metrics**: `hikaricp_connections_pending` (số thread đang chờ), `hikaricp_connections_active`, `hikaricp_connections_timeout_total` — connection starvation hiện ra ở đây *trước khi* latency request bùng nổ.

### 11.3. Vòng lặp điều tra

```
1. Latency tăng vọt?       → kiểm tra percentiles latency request (p95/p99)
2. CPU bão hòa?            → không: đang chờ thứ gì đó (dumps, DB metrics)
                            → có: điểm nghẽn CPU-bound (profiler, số lõi)
3. Trạng thái thread trong dumps:
   - đống BLOCKED          → lock contention (tìm monitor)
   - đống WAITING          → queue/pool exhaustion (metric độ sâu queue)
   - mọi thread bận cùng 1 call → một dependency chậm (thêm timeout/circuit breaker)
4. DB pool: pending > 0?   → connection starvation (tăng size, tối ưu query, hoặc giới hạn concurrency)
5. Queue size tăng?        → producer chạy nhanh hơn consumer (backpressure!)
```

Các tín hiệu luôn chéo xác nhận lẫn nhau: latency + trạng thái thread + pool metrics + DB metrics. Không bao giờ chỉnh một cách mù quáng — thread dump cho bạn biết hệ thống kẹt *ở đâu*; metrics cho bạn biết nó đã kẹt *bao lâu*.

## 12. Mô hình tư duy cuối cùng

Sau tất cả các cơ chế, năm câu sau tóm gọn toàn bộ bài viết:

1. **Một thread không tự động làm code nhanh hơn.** Nó chỉ cho công việc cơ hội chạy song song — và nếu máy không thể chạy song song, thread đó là overhead thuần túy.
2. **Concurrency không phải parallelism.** Concurrency là cấu trúc (xen kẽ); parallelism là thực thi (nhiều lõi cùng lúc). Thread cho bạn concurrency; chỉ có phần cứng mới cho bạn parallelism.
3. **Nhiều thread không có nghĩa là nhiều sức mạnh CPU hơn.** Công việc CPU-bound bị giới hạn bởi số lõi. Thread vượt quá giới hạn đó chỉ mua cho bạn context switch.
4. **Virtual Threads cải thiện khả năng mở rộng cho blocking concurrency, chứ không phải hiệu suất CPU.** Chúng làm cho việc chờ đợi trở nên rẻ. Chúng không làm cho việc tính toán nhanh hơn, và chúng không thay đổi giới hạn của các tài nguyên mà mọi người đang chờ.
5. **Phần khó của multithreading là quản lý shared state, giới hạn tài nguyên, backpressure, vòng đời và lỗi.** API threading thì dễ. Kỷ luật — visibility của shared state, mọi thứ có giới hạn, xử lý lỗi tường minh, giám sát — mới là thứ phân biệt ứng dụng scale tốt với ứng dụng sụp đổ lúc 4 giờ sáng.

Khi phân vân, hãy hỏi câu hỏi mà cả bài viết này được xây dựng trên đó: *công việc này thực sự đang chờ điều gì?* Câu trả lời sẽ cho bạn biết dùng công cụ nào, cần bao nhiêu thread, và thứ gì sẽ hỏng đầu tiên.
