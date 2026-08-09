---
title: "Java Threads: Từ Thread Pool đến Virtual Threads"
description: "Cẩm nang thực hành về concurrency trong Java với 31 ví dụ chạy được: thread, race condition, thread pool, backpressure, những lỗi chỉ xuất hiện ở production, và điều Virtual Threads thực sự làm được — cùng những gì chúng không làm được."
pubDatetime: 2026-08-09T00:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Mọi backend developer Java rồi cũng tự hỏi bốn câu giống nhau:

- Vì sao thêm nhiều thread lại khiến ứng dụng **chậm hơn**?
- Vì sao một thread pool với hàng trăm thread không cải thiện được CPU utilization?
- Vì sao Virtual Threads xử lý được concurrency khổng lồ nhưng không làm code tính toán (CPU-bound) nhanh hơn?
- Vì sao lỗi concurrency hầu như **chỉ xuất hiện ở production**?

Bài viết này trả lời cả bốn câu — và khác với hầu hết các bài viết khác về chủ đề này, mọi khẳng định ở đây đều dựa trên một ví dụ thật, chạy được. Bài viết được thiết kế để đọc cùng repository đồng hành [`java-lab`](https://github.com/hungpt99-dev/java-lab), một dự án Maven thuần với **31 ví dụ nhỏ, độc lập**, không framework, chỉ dùng API concurrency thuần của JDK. Mỗi phần dưới đây gắn một khái niệm với một class cụ thể trong repository, trình bày code thật, và cho bạn biết chính xác chạy gì và quan sát gì.

Tất cả ví dụ biên dịch với Java 21+ (`maven.compiler.release` được đặt là `21` trong `pom.xml`; Virtual Threads yêu cầu Java 21). Mọi con số đo đạc trong bài viết này được sinh ra khi chạy các ví dụ trên một máy 12 lõi với JDK 21 — hãy coi chúng là dữ liệu mẫu, không phải benchmark chuẩn.

---

## 1. Giới thiệu

Nếu bạn từng vận hành một backend Java, bạn biết rõ những dấu hiệu cảnh báo: một đợt bùng nổ các lời gọi database chậm, một thread dump đầy các thread `BLOCKED`, một queue tăng không kiểm soát, latency leo thang trong khi CPU rảnh rỗi. Tất cả những thứ này đến từ một tập nhỏ các sự thật cơ học:

- Một thread rất đắt: ~1 MB stack, do kernel tạo, do kernel lên lịch.
- Một thread chỉ chạy trên một lõi tại một thời điểm — và một máy có số lõi cố định.
- Bộ nhớ dùng chung nhanh *chính vì* nó được dùng chung — đúng thứ khiến nó hỏng dưới truy cập không đồng bộ.
- Thread bị block không tốn CPU, nhưng tài nguyên chúng chờ (connection, quota, socket) vẫn hữu hạn.

Bài viết này đi qua những sự thật đó một cách cơ học, đúng theo thứ tự mà repository `java-lab` dạy: thread là gì (Mục 2), cách tạo (Mục 3), vòng đời (Mục 4), vì sao shared state hỏng (Mục 5–6), thread pool thực sự hoạt động thế nào (Mục 7), số thread mua được gì (Mục 8), những kiểu lỗi cắn người ở production (Mục 9), và cuối cùng Virtual Threads thay đổi điều gì — và quan trọng không kém, chúng *không* thay đổi điều gì (Mục 10–13). Mục 14–16 đưa ra vòng lặp debugging, bảng quyết định, và mô hình tư duy để mang đi.

**Cách đọc bài viết này:** mỗi khái niệm đều nêu tên class trong repository; chạy nó bằng các lệnh trong khung "Try It Yourself" và so sánh quan sát của bạn với kết quả ghi lại ở đây.

---

## 2. Thread là gì?

### 2.1. Process vs Thread

**Process** là một chương trình đang chạy với vùng nhớ riêng, file descriptor riêng, không gian địa chỉ riêng. **Thread** là một đơn vị thực thi *bên trong* một process. Các thread của cùng một process dùng chung bộ nhớ của process (heap, static field, class metadata), đó là lý do chúng giao tiếp với nhau dễ dàng — và cũng là lý do chúng dễ làm hỏng trạng thái của nhau.

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

Mỗi thread có **stack riêng** nhưng **dùng chung** heap. Sự phân tách đó giải thích gần như mọi thứ về multithreading: dùng chung là thứ làm nó hữu ích, và dùng chung cũng là thứ làm nó nguy hiểm.

### 2.2. Concurrency vs Parallelism

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

Concurrency không cần nhiều lõi. Parallelism thì bắt buộc phải có. Nếu máy của bạn có 4 lõi và bạn tạo 1000 thread, **tối đa 4 tác vụ chạy ở cùng một thời điểm** — 996 thread còn lại đang chờ, ngủ, hoặc bị context switch. Tạo thread không tạo ra lõi CPU.

### 2.3. Workload CPU-bound vs I/O-bound

Câu hỏi quan trọng nhất cần đặt ra cho bất kỳ tác vụ nào: *nó đang chờ cái gì?*

- **CPU-bound**: tác vụ dành thời gian để tính toán — parse, băm, crypto, nén. Tốc độ bị giới hạn bởi lõi CPU, không phải số thread.
- **I/O-bound**: tác vụ dành phần lớn thời gian để *chờ* — chờ database, chờ HTTP response, chờ đọc file. Tốc độ bị giới hạn bởi độ trễ và mức concurrency.

```
Tác vụ CPU-bound: [=====tính toán=====][=====tính toán=====][=====tính toán=====]
                  ↑ CPU là điểm nghẽn → chỉ có #cores mới có ý nghĩa

Tác vụ I/O-bound: [chờ 95ms][chờ 95ms][chờ 95ms]
                  [ 5ms làm việc ][ 5ms làm việc ][ 5ms làm việc ]
                  ↑ 95% thời gian là chờ → tăng concurrency giúp ích
```

Sự phân biệt này là xương sống của cả bài viết — repository có các thí nghiệm chuyên dụng cho cả hai loại workload (Mục 8).

### 2.4. Context Switching

Khi CPU chuyển từ thread này sang thread khác, OS phải lưu toàn bộ trạng thái của thread hiện tại và nạp trạng thái của thread tiếp theo. Đây là **context switch**, và nó không miễn phí: tốn thời gian CPU, phá hỏng CPU cache (dữ liệu của thread mới là dữ liệu "lạnh"), và càng nhiều thread thì càng nhiều thời gian CPU dành cho *chuyển đổi* thay vì *làm việc*. Đây là câu trả lời trực tiếp cho câu hỏi đầu tiên: **thêm thread nhiều hơn mức máy có thể chạy đồng thời không tăng sức làm việc — nó chỉ tăng chi phí chuyển đổi.**

### 2.5. Blocking

Một thread bị **block** khi nó không thể tiếp tục mà không có sự kiện bên ngoài (một lock, một `sleep()`, một query DB, một HTTP response). Một thread bị block tiêu thụ **zero** CPU nhưng vẫn giữ bộ nhớ và vẫn được OS scheduler tính là một thread. Toàn bộ trò chơi của thread pool — và sau này là của Virtual Threads — là luôn có đủ công việc sẵn sàng chạy để giữ CPU bận rộn trong khi phần lớn thread đang bị block.

---

## 3. Tạo và chạy Thread

Package `basics` của repository chứa bốn ví dụ. Hãy xem chúng thực sự minh họa điều gì.

### Ví dụ: Tạo một Thread

**Repository example:** `src/main/java/com/example/javalab/basics/CreateThreadExample.java`

Ví dụ này cho thấy ba cách tạo thread — một `Runnable` ẩn danh, một `Runnable` lambda, và một `Thread` subclass — tất cả được khởi động bằng `start()` và chờ bằng `join()`:

```java
Thread t1 = new Thread(new Runnable() {
    @Override
    public void run() {
        System.out.println("[" + Thread.currentThread().getName() + "] anonymous Runnable");
    }
}, "thread-1");

Thread t2 = new Thread(
        () -> System.out.println("[" + Thread.currentThread().getName() + "] lambda Runnable"),
        "thread-2");

Thread t3 = new MyWorkerThread("thread-3");

t1.start();
t2.start();
t3.start();

t1.join();
t2.join();
t3.join();
```

**Điều cần quan sát:** ba dòng in ra từ ba tên thread khác nhau theo *thứ tự khác nhau mỗi lần chạy*. Thứ tự bất định đó *chính là* concurrency.

### Ví dụ: Runnable vs Callable

**Repository example:** `src/main/java/com/example/javalab/basics/RunnableExample.java`

`Runnable` có `void run()` — không trả kết quả, không ném checked exception. `Callable` có `V call()` — trả về một giá trị và có thể ném exception. Ví dụ chạy một `Callable` qua một `ExecutorService` và lấy kết quả bằng `Future.get()`:

```java
Callable<Integer> callable = () -> {
    Thread.sleep(100);
    return 42;                           // Callable produces a value
};

ExecutorService pool = Executors.newSingleThreadExecutor();
try {
    Future<Integer> future = pool.submit(callable);
    System.out.println("Callable result: " + future.get());   // blocks until ready
} finally {
    pool.shutdown();                     // ALWAYS shut down executors
}
```

### Ví dụ: start() vs run()

**Repository example:** `src/main/java/com/example/javalab/basics/StartVsRunExample.java`

Sự khác biệt quan trọng nhất cho người mới trong Java concurrency:

```java
Runnable task = () -> System.out.println("  task executed in thread: "
        + Thread.currentThread().getName());

Thread t = new Thread(task, "new-thread");

t.run();    // runs in the CALLER thread (here: 'main')
t.start();  // runs in a NEW thread (here: 'new-thread')
```

**Kết quả thật của ví dụ:**

```
1) t.run()   -> runs in the CALLER thread:
  task executed in thread: main
2) t.start() -> runs in a NEW thread:
  task executed in thread: new-thread
```

`run()` chỉ là một lời gọi phương thức bình thường — gọi nó cho bạn zero concurrency, và bug vô hình vì code vẫn cho kết quả đúng. `start()` yêu cầu JVM tạo một thread mới thực sự.

> **Các ví dụ này cũng minh họa:** `join()` (chờ một thread kết thúc) và `sleep()` (dùng khắp nơi để mô phỏng công việc). Tên thread làm log dễ đọc — mọi ví dụ về pool trong repository đều đặt tên thread bằng một `ThreadFactory` tùy chỉnh.

## Try It Yourself

```bash
cd java-lab
mvn clean compile
java -cp target/classes com.example.javalab.basics.StartVsRunExample
java -cp target/classes com.example.javalab.basics.CreateThreadExample
java -cp target/classes com.example.javalab.basics.RunnableExample
```

Quan sát mong đợi: `run()` luôn in tên thread của caller (`main`); `start()` in tên thread mới; ba thread trong `CreateThreadExample` in theo thứ tự khác nhau mỗi lần chạy.

---

## 4. Vòng đời của Thread

**Repository example:** `src/main/java/com/example/javalab/basics/ThreadLifecycleExample.java`

Ví dụ này dẫn một thread đơn lẻ qua cả sáu trạng thái và lấy mẫu `thread.getState()` từ thread main tại từng điểm:

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

Code tạo ra từng trạng thái theo yêu cầu: một thread thứ hai bị block trên một `synchronized` monitor mà `main` đang giữ (→ `BLOCKED`), worker gọi `LOCK.wait(300)` (→ `TIMED_WAITING`) rồi `LOCK.wait()` (→ `WAITING`), và cuối cùng `join()` hé lộ `TERMINATED`. Vì thời điểm chính xác là bất định, ví dụ *poll* cho đến khi từng trạng thái mong đợi xuất hiện (kèm timeout) thay vì dựa vào sleep.

**Kết quả thật (rút gọn):**

```
1) NEW         state = NEW
2) RUNNABLE    state = RUNNABLE  (running or ready - Java does not distinguish)
3) BLOCKED     state = BLOCKED  (waiting for synchronized monitor held by main)
4) TIMED_WAITING state = TIMED_WAITING  (LOCK.wait(300) / Thread.sleep)
5) WAITING     state = WAITING  (LOCK.wait() - parked until notify)
6) TERMINATED  state = TERMINATED
```

**Bạn gặp các trạng thái này ở đâu trong production:** một dump `jstack`/`jcmd Thread.print` đầy các thread `BLOCKED` nghĩa là synchronized lock contention; đống `WAITING`/`TIMED_WAITING` trên `park` nghĩa là pool queue hoặc future; lũ `RUNNABLE` nghĩa là CPU bão hòa.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.basics.ThreadLifecycleExample
```

Quan sát mong đợi: cả sáu trạng thái in ra đúng thứ tự. Lưu ý rằng điểm lấy mẫu `RUNNABLE` chính xác thay đổi giữa các lần chạy — bản thân state machine là cố định, còn *thời điểm* thì không.

---

## 5. Race Condition và Shared State

**Repository example:** `src/main/java/com/example/javalab/synchronization/RaceConditionExample.java`

Repository mở đầu bằng một bộ đếm cố tình hỏng:

```java
public class RaceConditionExample {

    private int count;                    // shared mutable state, NO synchronization

    public void increment() {
        count++;                          // read-modify-write: NOT atomic
    }
    // ...
}
```

Tám thread gọi `increment()` 50.000 lần mỗi thread — kết quả mong đợi là 400.000. Ví dụ chạy năm lượt và in kết quả thật.

**Kết quả thật của ví dụ:**

```
Trial 1: expected=400000 actual=84596 (<-- WRONG: increments lost)
Trial 2: expected=400000 actual=136178 (<-- WRONG: increments lost)
Trial 3: expected=400000 actual=98973 (<-- WRONG: increments lost)
Trial 4: expected=400000 actual=60526 (<-- WRONG: increments lost)
Trial 5: expected=400000 actual=400000 (correct this time)
```

**Vì sao kết quả có thể sai:** `count++` là ba thao tác — ĐỌC field, CỘNG 1, GHI lại. Hai thread có thể cùng ĐỌC `5`, cùng tính `6`, và cùng GHI `6` — một lần tăng bị mất.

**Vì sao nó bất định:** việc xen kẽ có va chạm hay không phụ thuộc vào scheduler, trạng thái JIT và tải máy. Lượt 5 tình cờ đúng — chính điều đó giải thích vì sao các bug này vượt qua code review và nổ tung ở production. Code biên dịch được, chạy được, và *thi thoảng* cho kết quả đúng.

Đây là sự vi phạm ba trụ cột của Java Memory Model (JMM):

- **Atomicity**: một thao tác chạy như một khối không thể tách rời. Bị phá vỡ bởi `count++`; được sửa bởi `synchronized`, `Atomic*`, lock.
- **Visibility**: write của thread A có thể không bao giờ được thread B thấy (giá trị có thể bị cache trong register/CPU cache).
- **Ordering**: JIT và CPU có thể sắp xếp lại lệnh miễn là ngữ nghĩa đơn luồng vẫn đúng.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.synchronization.RaceConditionExample
```

Quan sát mong đợi: hầu hết các lượt cho thấy actual count thấp hơn 400.000 rất nhiều; thi thoảng có một lượt đúng. Đừng bao giờ tin một lần chạy duy nhất.

---

## 6. Các chiến lược Đồng bộ hóa

Package `synchronization` chứa bốn cách sửa cộng với một "người nói thật" về `volatile`.

### Ví dụ: synchronized

**Repository example:** `src/main/java/com/example/javalab/synchronization/SynchronizedExample.java`

```java
public class SynchronizedExample {

    private int count;

    public synchronized void increment() {
        count++;
    }
}
```

Monitor `synchronized` biến read-modify-write thành một khối không thể tách rời và cũng publish write (happens-before). Cùng workload 8×50.000 giờ luôn đúng: cả ba lượt đều in `actual=400000 (correct)`. Cái giá phải trả: các thread tranh chấp bị **block**, và contention nặng trên một monitor biến code thành chạy đơn luồng trên thực tế. `synchronized` reentrant, mặc định non-fair, và không thể timeout.

### Ví dụ: AtomicInteger

**Repository example:** `src/main/java/com/example/javalab/synchronization/AtomicIntegerExample.java`

```java
public class AtomicIntegerExample {

    private final AtomicInteger count = new AtomicInteger();

    public void increment() {
        count.incrementAndGet();
    }
}
```

`AtomicInteger` đúng *và* không chặn: nó dùng CAS (compare-and-swap) ở mức phần cứng, thử lại nếu một thread khác thay đổi giá trị giữa chừng. Ví dụ cũng in các thao tác hữu ích khác (`get()`, `getAndIncrement()`, `addAndGet(n)`, `compareAndSet(exp, upd)`).

### Ví dụ: ReentrantLock

**Repository example:** `src/main/java/com/example/javalab/synchronization/LockExample.java`

`ReentrantLock` bổ sung thứ `synchronized` không làm được — timeout, fairness, condition. Ví dụ minh họa một bộ đếm bảo vệ bằng lock (luôn đúng) và mẹo mấu chốt, `tryLock(timeout)`:

```java
boolean acquired = held.tryLock(1, TimeUnit.SECONDS);
// thread B holds the lock for 3 s: main gives up after 1 s instead of blocking
```

**Kết quả thật:** `tryLock = false (main did NOT wait for the holder - it moved on)`. Với `synchronized`, tình huống tương tự sẽ block cho đến khi holder nhả lock. `tryLock(timeout)` là tuyến phòng thủ đầu tiên chống deadlock.

### Ví dụ: volatile — visibility, KHÔNG phải atomicity

**Repository example:** `src/main/java/com/example/javalab/synchronization/VolatileExample.java`

Ví dụ này chứng minh hai điểm bằng những con số cứng.

**Phần A — `volatile int count; count++` vẫn KHÔNG atomic:**

```java
private volatile int count;     // volatile: visible, but STILL not atomic

public void increment() {
    count++;                    // still READ+ADD+WRITE: racy despite volatile
}
```

**Kết quả thật:**

```
Part A - volatile int count++; does it stay atomic?

expected=400000 actual=191212 (<-- WRONG)
```

`volatile` chỉ đảm bảo visibility và ordering. Chuỗi ba bước read-modify-write vẫn có thể xen kẽ giữa các thread. **Đừng tin rằng `volatile` làm cho việc tăng biến trở nên thread-safe — không phải vậy.**

**Phần B — một flag không volatile có thể không bao giờ được thấy.** Một worker lặp trên `boolean keepRunning` thường trong khi `main` đặt nó thành `false` sau 200 ms. JIT có thể đưa field ra ngoài vòng lặp, nên write không bao giờ được quan sát. Phần này cố tình bất định — trong lần chạy ghi lại, nó tái hiện 0 trên 3 lượt, trong khi cửa thoát (một `volatile boolean forceStop`) dừng worker ngay lập tức mỗi lần. Ví dụ luôn kết thúc, và takeaway in ra là quy tắc ngón tay cái:

> `volatile` cho cờ và trạng thái; `AtomicInteger`/`AtomicLong` cho bộ đếm và shared state; `synchronized`/lock cho các critical section phức tạp.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.synchronization.RaceConditionExample
java -cp target/classes com.example.javalab.synchronization.SynchronizedExample
java -cp target/classes com.example.javalab.synchronization.AtomicIntegerExample
java -cp target/classes com.example.javalab.synchronization.LockExample
java -cp target/classes com.example.javalab.synchronization.VolatileExample
```

Quan sát mong đợi: bộ đếm hỏng mất increment; cả ba cách sửa luôn đúng; `VolatileExample` Phần A mất increment ngay cả trên field `volatile`, và bug visibility của Phần B có thể tái hiện hoặc không trong các lần chạy của bạn.

---

## 7. Thread Pool và Thực thi Task

Package `threadpool` là trái tim của bài viết — nó cho thấy `ThreadPoolExecutor` thực sự hoạt động *thế nào*, không chỉ các shortcut của `Executors`.

### Ví dụ: Fixed Thread Pool

**Repository example:** `src/main/java/com/example/javalab/threadpool/FixedThreadPoolExample.java`

`Executors.newFixedThreadPool(3)` với một `ThreadFactory` đặt tên chạy 10 task. Phần "inside the box" được in ra của ví dụ nêu sự thật mấu chốt:

```
newFixedThreadPool(3) == ThreadPoolExecutor(3, 3, 0L,
    TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>())
Because the queue is UNBOUNDED, the pool can never grow
beyond 3 threads and can never reject a task - tasks just
pile up in memory.
```

**Kết quả thật:** task 1–10 đều chạy trên `fixed-worker-1..3` — các worker được tái sử dụng. Một pool "cố định" cố định chính xác vì queue unbounded của nó không bao giờ ép pool phát triển.

### Ví dụ: ThreadPoolExecutor — toàn bộ pipeline

**Repository example:** `src/main/java/com/example/javalab/threadpool/ThreadPoolExecutorExample.java`

Ví dụ này cấu hình mọi núm chỉnh — core=2, max=4, bounded queue dung lượng 2, `AbortPolicy` — và log `poolSize`/`queueSize` sau mỗi submit:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        2,                                    // corePoolSize
        4,                                    // maximumPoolSize
        30, TimeUnit.SECONDS,                 // keepAliveTime
        new ArrayBlockingQueue<>(2),          // BOUNDED work queue
        runnable -> new Thread(runnable, "pool-thread-" + threadCounter.getAndIncrement()),
        new ThreadPoolExecutor.AbortPolicy());
```

Thuật toán tiếp nhận task mà nó minh họa:

```
Task
 ↓
1. core threads free?       -> run on a core thread
2. no, queue not full?      -> enqueue
3. no, workers < max?       -> spawn an extra thread (up to max)
4. no                        -> rejection policy
```

**Kết quả thật (màn trình diễn đang hoạt động):**

```
submitted 1 -> poolSize=1 queueSize=0
submitted 2 -> poolSize=2 queueSize=0
submitted 3 -> poolSize=2 queueSize=1
submitted 4 -> poolSize=2 queueSize=2
submitted 5 -> poolSize=3 queueSize=2
submitted 6 -> poolSize=4 queueSize=2
submitted 7 -> REJECTED (pool full, queue full): RejectedExecutionException
submitted 8 -> REJECTED (pool full, queue full): RejectedExecutionException
submitted 9 -> REJECTED (pool full, queue full): RejectedExecutionException
```

Hãy quan sát thứ tự: task 1–2 chạm core threads; task 3–4 vào queue; pool chỉ phát triển vượt core size **sau khi** queue đã đầy (task 5–6); một khi queue đầy *và* đạt max, `AbortPolicy` ném exception.

### Ví dụ: Queue có giới hạn vs không giới hạn

**Repository example:** `src/main/java/com/example/javalab/threadpool/BoundedQueueExample.java`

Hai pool với cấu hình core=2/max=4 giống hệt và 6 task ngủ — điểm khác biệt duy nhất là loại queue. **Kết quả thật:**

```
A) UNBOUNDED queue (LinkedBlockingQueue) - what newFixedThreadPool uses
   -> poolSize=2 queueSize=4 (max=4 was NEVER reached!)

B) BOUNDED queue (ArrayBlockingQueue capacity=2)
   -> poolSize=4 queueSize=2 (pool grew to 4)
```

Với queue unbounded, `maximumPoolSize` là cấu hình chết — queue *mới là* giới hạn thật, và task chất đống trong bộ nhớ vĩnh viễn. Queue có giới hạn buộc pool huy động thêm thread, rồi đến rejection policy.

### Ví dụ: Rejection Policies

**Repository example:** `src/main/java/com/example/javalab/threadpool/RejectedExecutionExample.java`

Với core=1, max=2, queue capacity=1, bốn submission vừa khớp ba task; cái thứ tư đi qua đường rejection. Ví dụ chạy cùng chuỗi thao tác với `AbortPolicy` và `CallerRunsPolicy`:

**Kết quả thật:**

```
1) AbortPolicy (default):
   -> submit 4: REJECTED: RejectedExecutionException
   tasks actually executed: 2

2) CallerRunsPolicy:
   -> submit 4: accepted
   tasks actually executed: 4
```

| Policy | Hành vi | Khi nào dùng |
| ------ | ------- | ------------ |
| `AbortPolicy` (mặc định) | Ném `RejectedExecutionException` | Fail nhanh; caller phải xử lý |
| `CallerRunsPolicy` | Task chạy **trong thread của caller** | Backpressure tự nhiên: producer tự chậm lại |
| `DiscardPolicy` | Lặng lẽ bỏ task | Không bao giờ — mất dữ liệu âm thầm |
| `DiscardOldestPolicy` | Bỏ task cũ nhất trong queue | Chỉ cho công việc stale/theo cửa sổ thời gian |

`CallerRunsPolicy` là lựa chọn được ưa chuộng trong production để tạo backpressure: bản thân thread đang nộp task buộc phải thực thi nó, nên producer tự động chậm lại đúng bằng tốc độ của consumer.

### Ví dụ: Cạn kiệt Thread Pool

**Repository example:** `src/main/java/com/example/javalab/threadpool/ThreadPoolExhaustionExample.java`

Một pool 2 thread nhận 6 task block trên một `CountDownLatch` — mô phỏng sự cố downstream. Cả hai worker kẹt cứng. Rồi một task "nhanh" đến và phải chờ trong queue:

**Kết quả thật (rút gọn):**

```
Both workers are now blocked on the slow downstream.
A FAST task arrives (an unrelated quick request)...
  200ms later: fast task has NOT started yet -> it sits in the queue
  ...
Total wait for the fast task: ~211 ms (it should have been < 1 ms).
```

**Vì sao mọi worker đều mất khả năng phục vụ:** mọi worker block bên trong task trên latch. Task nhanh không thể bắt đầu vì cả hai worker đều bận và queue (unbounded) cứ hấp thụ task — bộ nhớ tăng, latency leo thang, và **không có exception nào được ném ra**. Cách sửa trong production: bounded queue + rejection policy, pool riêng cho từng loại workload, timeout và circuit breaker ở downstream, và giám sát `executor_queue_size`.

### Ví dụ: Shutdown lịch sự

**Repository example:** `src/main/java/com/example/javalab/practical/GracefulShutdownExample.java`

Cách đúng để dừng một pool, minh họa với 8 task × 2 s trên 3 thread và deadline 800 ms:

```java
pool.shutdown();                 // 1) stop accepting new tasks
boolean finished = pool.awaitTermination(800, TimeUnit.MILLISECONDS);  // 2) deadline
if (!finished) {
    List<Runnable> dropped = pool.shutdownNow();   // 3) interrupt + drop queue
    System.out.println("dropped " + dropped.size() + " queued task(s).");
}
pool.awaitTermination(5, TimeUnit.SECONDS);        // 4) wait for cleanup
```

**Kết quả thật:** `shutdownNow()` bỏ 5 task đang xếp hàng và interrupt 3 worker đang chạy (`started=3 interrupted=3`). Task ngoan ngoãn bắt `InterruptedException` và dọn dẹp trước khi thoát.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.threadpool.FixedThreadPoolExample
java -cp target/classes com.example.javalab.threadpool.ThreadPoolExecutorExample
java -cp target/classes com.example.javalab.threadpool.BoundedQueueExample
java -cp target/classes com.example.javalab.threadpool.RejectedExecutionExample
java -cp target/classes com.example.javalab.threadpool.ThreadPoolExhaustionExample
java -cp target/classes com.example.javalab.practical.GracefulShutdownExample
```

Quan sát mong đợi: submission 7–9 bị reject trong `ThreadPoolExecutorExample` (điều này là tất định — các worker vẫn đang bận); queue unbounded không bao giờ khiến pool phát triển; task "nhanh" trong `ThreadPoolExhaustionExample` luôn phải chờ; `GracefulShutdownExample` in ra tỷ lệ 3/3/5 giống nhau.

---

## 8. Hiệu suất: Nhiều Thread ≠ Nhanh Hơn

Package `performance` biến luận điểm của bài viết thành các thí nghiệm. Cả ba đều dùng một lượng công việc tổng cố định và chỉ thay đổi số thread. **Kết quả phụ thuộc vào máy — hãy nhìn xu hướng, đừng nhìn con số.**

### Workload CPU-bound

**Repository example:** `src/main/java/com/example/javalab/performance/CpuBoundThreadExample.java`

32 task, mỗi task đếm số nguyên tố đến 150.000 bằng phương pháp ngây thơ O(n·√n) — công việc CPU tất định. **Kết quả thật trên máy 12 lõi:**

```
threads                tasks      wall time    note
-------                -----      ---------    ----
1                      32         262          baseline
12                     32         49           up to cores: helps
48                     32         52           beyond cores
192                    32         49           excessive
```

**Vì sao lõi CPU giới hạn việc chạy song song thật sự:** chỉ 12 task có thể tính toán cùng lúc trên 12 lõi. Đi từ 1 → 12 thread cho speedup gần như tuyến tính (262 → 49 ms); vượt quá đó các lợi ích dẹt lại (49 → 52 → 49 ms), và với đủ nhiều thread, chi phí context switch có thể đẩy thời gian tăng trở lại. **Thread thừa gây ra chi phí context switch, không phải thêm sức mạnh CPU.**

### Workload I/O-bound

**Repository example:** `src/main/java/com/example/javalab/performance/IoBoundThreadExample.java`

Mỗi task mô phỏng một lời gọi remote 40 ms (`LockSupport.parkNanos` — không phụ thuộc mạng bên ngoài) cộng 1 ms tính toán. Tổng cộng 120 task. **Kết quả thật:**

```
threads    tasks      wall time    throughput
-------    -----      ---------    ----------
1          120        5991         20
12         120        503          239
96         120        101          1188
120        120        67           1791
```

**Vì sao các task đang chờ hưởng lợi từ concurrency cao hơn:** một thread bị block không tốn CPU, nên trong khi một task chờ, các task khác chạy. Throughput scale theo concurrency — 20 → 1791 task/giây trong lần chạy này. Công thức sizing kinh điển mà ví dụ in ra: `threads ≈ cores × (1 + wait/compute)`. Và caveat trung thực nó nêu: vượt quá điểm bão hòa, thêm thread chỉ thêm overhead — và trong hệ thống thật, giới hạn là thứ các task đang chờ (DB connection, API quota), không phải số thread. **Điều này không có nghĩa concurrency không giới hạn luôn luôn tốt.**

### Quá nhiều Thread

**Repository example:** `src/main/java/com/example/javalab/performance/TooManyThreadsExample.java`

Cùng 400 task hỗn hợp (~10 ms mỗi task) chạy với 4, 64, 400 và 800 thread. Kích thước workload và số thread đều cấu hình được:

```bash
java -cp target/classes com.example.javalab.performance.TooManyThreadsExample 400 4 64 400 800
```

**Kết quả thật:**

```
threads      tasks      wall time (ms)
-------      -----      --------------
4            400        1089
64           400        167
400          400        212
800          400        205
```

**Điều cần nhìn:** tăng thread trước tiên *giúp* (4 → 64 thread: 1089 → 167 ms), rồi lợi ích dẹt lại, và với thread quá nhiều thời gian có thể tăng *trở lại* (64 → 400 thread: 167 → 212 ms) — context switch và cache thrashing ăn hết CPU. Ví dụ cũng cảnh báo rằng tạo hơn 10.000 platform thread có thể thất bại với `OutOfMemoryError: unable to create native thread` (~1 MB stack mỗi thread).

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.performance.CpuBoundThreadExample
java -cp target/classes com.example.javalab.performance.IoBoundThreadExample
java -cp target/classes com.example.javalab.performance.TooManyThreadsExample
```

Quan sát mong đợi: bảng CPU-bound bão hòa ở ~#cores; bảng I/O-bound cải thiện liên tục cho đến khi mọi lõi bận; bảng too-many-threads trở nên *tệ hơn* ở đầu cao. Con số tuyệt đối của bạn sẽ khác — *hình dạng* của các đường cong mới là bài học.

---

## 9. Những lỗi Concurrency phổ biến

Package `problems` tái hiện các sự cố xảy ra ở production — từng sự cố được kiểm soát, tất định khi có thể, và luôn kết thúc.

### Deadlock

**Repository example:** `src/main/java/com/example/javalab/problems/DeadlockExample.java`

Hai lock, hai thread, thứ tự giành ngược nhau:

```java
Thread t1 = new Thread(() -> {
    synchronized (LOCK_A) {
        sleep(100);                       // make the interleaving deterministic
        synchronized (LOCK_B) { /* never reached */ }
    }
}, "deadlock-thread-1");

Thread t2 = new Thread(() -> {
    synchronized (LOCK_B) {
        sleep(100);
        synchronized (LOCK_A) { /* never reached */ }
    }
}, "deadlock-thread-2");
```

Thread-1 giữ `LOCK_A` và muốn `LOCK_B`; thread-2 giữ `LOCK_B` và muốn `LOCK_A` — chờ vòng. Cả hai thread đều là **daemon**, nên JVM vẫn có thể thoát sau khi `main` kết thúc (trong ứng dụng thật chúng sẽ treo process vĩnh viễn). Sau 2 s ngủ, ví dụ nhờ chính JVM phát hiện vấn đề:

```java
ThreadMXBean mxBean = ManagementFactory.getThreadMXBean();
long[] deadlockedIds = mxBean.findDeadlockedThreads();
```

**Kết quả thật:**

```
  [thread-1] holds LOCK_A, wants LOCK_B...
  [thread-2] holds LOCK_B, wants LOCK_A...

JVM deadlock detector (findDeadlockedThreads):
  DEADLOCKED: deadlock-thread-1 state=BLOCKED
  DEADLOCKED: deadlock-thread-2 state=BLOCKED
```

**Kiểm tra bằng thread dump:** các comment trong file giải thích cách chạy với `Thread.sleep(30_000)` và gắn `jcmd <pid> Thread.print` — dump khi đó chứa mục `Found one Java-level deadlock` với đúng vòng lặp. Các quy tắc phòng ngừa được ví dụ in ra: thứ tự giành lock nhất quán, `tryLock` kèm timeout, tối đa một lock tại một thời điểm.

### Thread Starvation (đói tài nguyên)

**Repository example:** `src/main/java/com/example/javalab/problems/StarvationExample.java`

Một pool 2 thread; hai task dài (2 s) đến trước và chiếm *cả hai* worker; mười task ngắn đến sau 100 ms và chờ trong queue. Mỗi task ngắn ghi lại nó đã chờ bao lâu.

**Kết quả thật (rút gọn):**

```
  [short-01] ran after waiting ~1902 ms (work itself: <1 ms)
  [short-02] ran after waiting ~1902 ms (work itself: <1 ms)
  ...
Results:
  short tasks executed : 10/10
  worst delay for a short task: ~1909 ms
```

**Vì sao một số task không thể chạy kịp:** các task dài ở đầu queue làm đói mọi task đứng sau — head-of-line blocking. Ví dụ ghi chú biến thể liên quan, *lock starvation* (monitor `synchronized` mặc định non-fair có thể làm đói một thread chờ vô thời hạn dưới contention liên tục), và các cách sửa: pool riêng cho từng loại workload, chia nhỏ job dài, timeout cho các lời gọi downstream.

### Cạn kiệt Thread Pool

Đã trình bày ở Mục 7 với `ThreadPoolExhaustionExample` — mọi worker block trên một downstream chậm, một task nhanh kẹt trong queue, không có exception nào được ném ra.

### ThreadLocal Leak

**Repository example:** `src/main/java/com/example/javalab/problems/ThreadLocalLeakExample.java`

Thread của pool sống *nhiều năm*; một giá trị `ThreadLocal` không bao giờ bị gỡ sẽ rò rỉ cả bộ nhớ lẫn **dữ liệu** — task tiếp theo dùng lại thread đó thấy giá trị của task trước. Pha 1 của ví dụ là code hỏng (không `remove()`), Pha 2 là cách sửa:

```java
try {
    CURRENT_USER.set(user);
    // ... work ...
} finally {
    CURRENT_USER.remove();      // the fix: never leak across tasks
}
```

**Kết quả thật:**

```
PHASE 1 - BROKEN: tasks never call remove()
  reader-1 sees user=user-3 on leaky-worker  <-- STALE value set by an EARLIER task!
  reader-2 sees user=user-1 on leaky-worker  <-- STALE value set by an EARLIER task!
  ...
PHASE 2 - FIXED: tasks call remove() in finally
  reader-2 sees user=null  <-- clean (nothing leaked between tasks)
```

Các reader chỉ được nộp *sau khi* một latch xác nhận mọi setter đã xong, nên mọi giá trị non-null chắc chắn là stale. Trong ứng dụng thật, đây là cách một request kết thúc với **security context của người dùng khác** — một rò rỉ dữ liệu, không chỉ rò rỉ bộ nhớ.

### Exception bị nuốt âm thầm

**Repository example:** `src/main/java/com/example/javalab/problems/LostExceptionExample.java`

Sự khác biệt giữa `execute()` và `submit()` trong một chương trình:

1. `submit()` một task ném exception, không bao giờ gọi `future.get()` → exception bị giữ bên trong `Future` và biến mất: không log, không lỗi, hệ thống trông vẫn khỏe mạnh.
2. `execute()` cùng task đó với một `UncaughtExceptionHandler` → lỗi hiện rõ.
3. `submit()` + `future.get()` → `ExecutionException` phơi bày nguyên nhân.

**Kết quả thật:**

```
1) submit() and NEVER call future.get():
   ...the task threw, but nothing printed, nothing logged.
   The exception sits inside the Future - invisible.
2) execute() -> UncaughtExceptionHandler caught: kaboom (via execute)
3) submit() + future.get() surfaced the failure:
   ExecutionException cause = kapow (via submit + get)
```

Đây là một trong những lý do chính khiến bug concurrency "chỉ xuất hiện ở production": các lỗi được sinh ra, bị máy móc hứng lấy, và bị giấu đi. Cách sửa: luôn xử lý `Future`, hoặc bọc thân task trong `try/catch` và log.

### Blocking Shared Thread Pool

**Repository example:** `src/main/java/com/example/javalab/problems/BlockingSharedPoolExample.java`

Một pool dùng chung 4 thread phục vụ cả task "external call chậm" (2 s) lẫn task "local nhanh" (5 ms). Rồi cùng chương trình chạy các task nhanh trên một pool **riêng**.

**Kết quả thật:**

```
BAD DESIGN - one shared pool for everything:
   fast task latencies: [1904, 1908, 1914, 1917] ms

GOOD DESIGN - dedicated pools per workload type:
   fast task latencies: [6, 5, 5, 5] ms
```

**Các task blocking ảnh hưởng đến công việc không liên quan thế nào:** 4 call chậm chiếm mọi worker, nên 4 task nhanh xếp hàng sau chúng và latency của chúng bùng nổ từ ~5 ms lên ~2 s — một dependency chậm kéo sập chức năng không liên quan. **Cách sửa:** không bao giờ trộn nhiều loại workload trong một pool; sizing từng pool theo tỷ lệ chờ/tính riêng của nó.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.problems.DeadlockExample
java -cp target/classes com.example.javalab.problems.StarvationExample
java -cp target/classes com.example.javalab.problems.ThreadLocalLeakExample
java -cp target/classes com.example.javalab.problems.LostExceptionExample
java -cp target/classes com.example.javalab.problems.BlockingSharedPoolExample
```

Quan sát mong đợi: deadlock được chính JVM phát hiện; các task ngắn chờ ~2 s trong ví dụ starvation; reader pha 1 thấy user stale; exception của `submit()` không in ra gì cho đến khi gọi `get()`; latency task nhanh giảm từ ~1900 ms xuống ~5 ms với pool riêng.

---

## 10. Platform Threads vs Virtual Threads

### Platform Threads

Mọi thứ cho đến giờ đều dùng **platform threads**: `Thread` kinh điển của Java, gói một OS thread theo tỷ lệ 1:1 — kernel tạo nó, lên lịch cho nó, và cấp cho nó một stack ~1 MB. Các giới hạn là giới hạn của OS: chi phí tạo tính bằng millisecond, bộ nhớ mỗi thread, overhead của scheduler. Đây là lý do 10.000 platform thread là rất nhiều và 100.000 thường là bất khả thi.

### Virtual Threads

**Virtual thread** là một lightweight thread do JVM quản lý (Java 21, JEP 444). Nó không phải OS thread: nó được JVM lên lịch lên một pool nhỏ các platform thread gọi là **carrier threads**. Khi một virtual thread bị block, JVM **unmount** nó khỏi carrier (lưu continuation) và mount một virtual thread runnable khác vào chỗ của nó. Với OS, không có gì xảy ra — carrier không bao giờ block. Một caveat cần nhớ: nếu một virtual thread block *bên trong* một khối `synchronized` (hoặc native code), nó có thể **pin** carrier; tránh các blocking call dài bên trong `synchronized` khi dùng virtual threads.

```
Mô hình virtual thread (nhiều : ít):

  100.000 virtual threads
        │   JVM scheduler
        ▼
   ( carrier threads - platform threads )
        │
        ▼
        Lõi CPU
```

### Ví dụ: Tạo Virtual Thread cơ bản

**Repository example:** `src/main/java/com/example/javalab/virtualthread/BasicVirtualThreadExample.java`

```java
Thread vt1 = Thread.startVirtualThread(() -> { /* blocking code is fine here */ });

Thread vt2 = Thread.ofVirtual()
        .name("my-named-vt")
        .start(() -> System.out.println(Thread.currentThread().isVirtual()));
```

**Kết quả thật:** cả hai virtual thread đều báo `isVirtual=true`; một `Thread` thường báo `false`. Các sự thật ví dụ in ra: virtual threads mặc định là daemon, dùng chung heap (các quy tắc thread-safety không đổi), và park trên các blocking call gần như không tốn gì.

### Ví dụ: Platform vs Virtual Threads

**Repository example:** `src/main/java/com/example/javalab/virtualthread/PlatformVsVirtualThreadExample.java`

1.000 task, mỗi task "block" 30 ms. **Kết quả thật:**

```
  platform pool (16 threads):  2108 ms
  virtual threads (1000):        54 ms
```

Rồi kiểm tra quy mô: tạo **100.000 virtual thread rảnh rỗi mất ~59 ms** — trong khi 100.000 platform thread (~1 MB stack mỗi thread) rất có thể ném `OutOfMemoryError: unable to create native thread`.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.BasicVirtualThreadExample
java -cp target/classes com.example.javalab.virtualthread.PlatformVsVirtualThreadExample
```

Quan sát mong đợi: `isVirtual=true` với virtual threads; platform pool mất ~2 s trong khi 1.000 virtual thread mất ~50 ms trên cùng workload blocking; 100.000 virtual thread được tạo trong chưa đầy một giây.

---

## 11. Khi nào Virtual Threads giúp ích

### Ví dụ: Một Virtual Thread cho mỗi Task

**Repository example:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadExecutorExample.java`

10.000 task, mỗi task ngủ 10 ms, nộp vào `Executors.newVirtualThreadPerTaskExecutor()`. Khối try-with-resources đóng executor, tức là chờ mọi task:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 10_000).forEach(i -> executor.submit(() -> {
        // ... blocking work ...
    }));
}   // close() == shutdown() + awaitTermination: waits for all tasks
```

**Kết quả thật:**

```
All 10,000 tasks completed.
Wall time: 541 ms
Max concurrently running: 9809 (near 10,000 - they all run at once)
```

Nếu chạy tuần tự, cùng công việc này mất 100 giây. Với virtual threads, cả 10.000 task block một cách rẻ tiền cùng lúc — **zero pool sizing, zero queue tuning**.

### Ví dụ: Độ trễ Blocking I/O

**Repository example:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadIoExample.java`

600 lời gọi remote mô phỏng 50 ms mỗi lần, chạy theo hai cách. **Kết quả thật:**

```
platform pool (8 threads): wall  4269 ms, p95 latency 4070 ms
virtual threads (600):     wall    67 ms, p95 latency  58 ms
```

**Điều được mô phỏng:** mỗi task park 50 ms (`LockSupport.parkNanos`) tượng trưng cho một HTTP call, JDBC query, hay file read. Với một platform pool nhỏ, phần lớn latency là **queueing** — chờ một thread rảnh; p95 ~4 s là ~80× thời gian gọi thật. Với virtual threads, mọi call bắt đầu ngay lập tức và p95 (~58 ms) *chính là* thời gian gọi. Đây là điểm ngọt cho HTTP calls, database calls, file I/O và mọi workload blocking concurrency cao.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadExecutorExample
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadIoExample
```

Quan sát mong đợi: batch 10.000 task kết thúc trong chưa đầy một giây với max concurrency gần 10.000; ví dụ I/O cho thấy p95 latency sụp từ ~4 s xuống ~60 ms trên cùng workload.

---

## 12. Khi nào Virtual Threads KHÔNG giúp ích

### Ví dụ: Công việc CPU-bound trên Virtual Threads

**Repository example:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadCpuBoundExample.java`

Cùng workload đếm số nguyên tố như `CpuBoundThreadExample`, chạy trên một platform pool #cores, một pool 4×#cores, và trên virtual threads. **Kết quả thật:**

```
  platform pool  12 threads:    75 ms
  platform pool  48 threads:    27 ms
  virtual threads          :    29 ms
```

**Quan sát:** virtual threads chạy *cùng* công việc CPU với tốc độ *xấp xỉ* bằng một platform pool được sizing đúng — không có speedup thần kỳ, thi thoảng chậm hơn một chút do scheduling overhead. Virtual threads không:

- làm task CPU-bound nhanh hơn (cores vẫn là giới hạn);
- tạo thêm lõi CPU;
- giải quyết race condition (mọi quy tắc của `synchronization` áp dụng nguyên vẹn);
- gỡ bỏ giới hạn database connection, API rate limit, hay nhu cầu backpressure.

> **Virtual Threads cải thiện khả năng mở rộng cho blocking concurrency. Chúng không tự động làm code CPU-bound nhanh hơn.**

Quy tắc ngón tay cái được ví dụ in ra: CPU-bound → fixed pool ~#cores; I/O-bound → virtual threads tỏa sáng.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadCpuBoundExample
java -cp target/classes com.example.javalab.performance.CpuBoundThreadExample
```

Quan sát mong đợi: wall time CPU-bound nằm trong cùng một khoảng trên virtual threads và trên pool ~#cores — khác biệt chỉ là nhiễu, không phải phép màu.

---

## 13. Giới hạn tài nguyên và Backpressure

Đây là phần liên quan nhất đến production của bài viết, và repository dành ví dụ trung tâm của mình cho nó.

### Ví dụ: Virtual Threads và Giới hạn tài nguyên

**Repository example:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadResourceLimitExample.java`

Kịch bản: 400 request, mỗi request cần một "database query". Một `Semaphore` với 10 permits mô phỏng một connection pool 10. Ví dụ chạy ba pha:

```java
Semaphore connections = new Semaphore(POOL_LIMIT);   // POOL_LIMIT = 10

Thread.startVirtualThread(() -> {
    try {
        connections.acquire();        // wait for a "connection"
        // ... simulated query (50 ms) ...
    } finally {
        connections.release();
    }
});
```

**Kết quả thật:**

```
   max parallel queries observed: 10
A) 400 virtual threads + semaphore(10): 2304 ms, max parallel = 10

   max parallel queries observed: 10
B) 10 platform threads (pool=10):       2320 ms, max parallel = 10

   max parallel queries observed: 400
C) 400 virtual threads, NO limit:         62 ms, max parallel = 400
```

Toàn bộ luồng đang được minh họa:

```
Nhiều Virtual Threads
        ↓
Cố gắng truy cập tài nguyên
        ↓
Giới hạn concurrency (Semaphore)
        ↓
Chỉ các task bị giới hạn được tiếp tục (max 10)
        ↓
Các task khác chờ (một cách rẻ tiền)
```

**Các con số chứng minh điều gì:** pha A và B mất *cùng* thời gian (~2,3 s) — điểm nghẽn là 10 connections, không phải mô hình threading. Virtual threads chỉ làm 390 thread đang chờ gần như miễn phí. Pha C "thắng" về thời gian nhưng sẽ làm quá tải một database thật: 400 query đồng thời vào một pool 10 connection nghĩa là timeout và queueing bên trong driver của pool.

> **Virtual Threads loại bỏ chi phí của các thread đang chờ — chứ không loại bỏ chi phí của tài nguyên mà chúng đang chờ.**

Điều này áp dụng cho mọi tài nguyên backend:

- **Database connection pool** (HikariCP `maximumPoolSize`) — connection, không phải thread, giới hạn DB throughput.
- **External HTTP API** — rate limit và quota (phản hồi 429).
- **Redis** — xử lý lệnh đơn luồng; một cơn lũ chỉ xếp hàng và latency bùng nổ cho tất cả mọi người.
- **Bất kỳ downstream service nào** — việc xếp hàng xảy ra trong *hạ tầng của họ*.

### Ví dụ: Semaphore giới hạn concurrency

**Repository example:** `src/main/java/com/example/javalab/practical/SemaphoreConcurrencyLimitExample.java`

1.000 task đến trên virtual threads, một `Semaphore(10)`, một lời gọi tài nguyên mô phỏng 30 ms. **Kết quả thật:**

```
All 1000 tasks finished in 3389 ms.
Max simultaneous resource calls: 10 (never exceeds 10)
```

Ví dụ in ra "lý do": một connection pool 10 không thể phục vụ 1.000 query đồng thời; API có giới hạn RPS/hour; Redis đơn luồng. **Quy tắc: sizing `Semaphore` theo dung lượng downstream — không phải theo số thread bạn có thể tạo.** Điều này áp dụng cho cả virtual threads lẫn platform threads.

### Backpressure trong Thread Pool

Backpressure là nguyên tắc: một producer nhanh phải bị buộc chậm lại khi consumer không theo kịp. Trong repository, nó xuất hiện dưới dạng:

- **bounded queue** (`BoundedQueueExample`) — producer chỉ đẩy được xa đến mức đó;
- **rejection policy** (`RejectedExecutionExample`) — `CallerRunsPolicy` làm chậm producer bằng cách chạy task trong chính thread của nó;
- **mẫu producer/consumer** (`ProducerConsumerExample`) — một `ArrayBlockingQueue` dung lượng 5 block các producer khi đầy. Ví dụ in `produced=50 consumed=46` (các item đang trên đường) và kết thúc sạch sẽ nhờ poison pills — một viên cho mỗi consumer, nên cả ba consumer đều thoát.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadResourceLimitExample
java -cp target/classes com.example.javalab.practical.SemaphoreConcurrencyLimitExample
java -cp target/classes com.example.javalab.practical.ProducerConsumerExample
```

Quan sát mong đợi: pha A và B của ví dụ resource-limit mất gần như cùng thời gian (max parallel = 10) trong khi pha C kết thúc ngay lập tức với max parallel = 400; ví dụ semaphore không bao giờ vượt quá 10 call đồng thời; ví dụ producer/consumer kết thúc với mọi consumer thoát nhờ poison pills.

---

## 14. Debugging các vấn đề Thread trong production

Repository cho bạn vốn từ vựng cho vòng lặp debugging.

### Thread Dumps

```bash
jcmd <pid> Thread.print        # or: jstack <pid>
```

- Nhiều thread `BLOCKED` → synchronized contention; tìm monitor trong stack trace, tìm ai đang giữ nó.
- Đống `WAITING`/`TIMED_WAITING` trên `park` → pool queue, future, hoặc pool thread đang rảnh.
- **Deadlock**: dump chứa mục `Found one Java-level deadlock` — chính xác thứ `DeadlockExample` tái hiện (và lời gọi `findDeadlockedThreads()` của nó cho cùng kết quả một cách lập trình).

### Giám sát JVM và Metrics

- **CPU utilization**: `top -H` cho CPU theo từng thread; 100% trên mọi lõi với nhiều thread `RUNNABLE` → bão hòa CPU; CPU thấp mà latency dài → đang chờ một thứ gì đó.
- **JFR** (`jfr start --filename app.jfr`): sự kiện lock contention (`jdk.JavaMonitorEnter`), thread allocation, CPU sampling — không cần restart.
- **Executor metrics** (Micrometer/JMX): `executor_active_threads`, `executor_queue_size`, `executor_completed_task_count`. Một queue tăng trưởng là dấu hiệu cảnh báo sớm nhất của pool exhaustion — trạng thái mà `ThreadPoolExhaustionExample` mô phỏng.
- **Connection pool metrics** (ví dụ HikariCP): `connections_pending`, `connections_active`, `connections_timeout_total` — connection starvation hiện ra ở đây trước khi latency request bùng nổ.

### Vòng lặp điều tra

```
1. Latency tăng vọt?         → kiểm tra percentiles p95/p99
2. CPU bão hòa?              → không: đang chờ thứ gì đó (dumps, DB metrics)
                              → có: điểm nghẽn CPU-bound (profiler)
3. Trạng thái thread trong dumps:
   - đống BLOCKED            → lock contention (tìm monitor)
   - đống WAITING            → queue/pool exhaustion (metric độ sâu queue)
   - mọi thread bận cùng 1 call → một dependency chậm (timeout, circuit breaker)
4. Pool metrics tăng?        → producer chạy nhanh hơn consumer (backpressure!)
```

---

## 15. Bảng quyết định thực hành

| Nhu cầu | Công cụ | Vì sao / khi nào |
| ------- | ------- | ---------------- |
| Background task dùng một lần, test, script | Raw `Thread` (`CreateThreadExample`) | Đơn giản, ngắn hạn; không bao giờ trong request path production |
| Thực thi task nói chung, cần kiểm soát vòng đời | `ExecutorService` (`RunnableExample`) | submit/await/shutdown, tái sử dụng worker |
| Workload CPU-bound | Fixed pool ≈ `#cores` (`CpuBoundThreadExample`) | Thêm thread chỉ thêm switching overhead |
| Workload I/O-bound, concurrency vừa phải | Bounded fixed pool sizing theo chờ/tính (`IoBoundThreadExample`) | Bắt buộc bounded queue (`BoundedQueueExample`) |
| Blocking concurrency khổng lồ | Virtual Threads (`VirtualThreadExecutorExample`) | Thread bị block giá rẻ; code blocking đơn giản |
| Bộ đếm, cờ, trạng thái đơn giản | `AtomicInteger` / `volatile` (`AtomicIntegerExample`, `VolatileExample`) | Atomicity cho bộ đếm, visibility cho cờ |
| Critical section phức tạp, timeout | `synchronized` / `ReentrantLock` (`SynchronizedExample`, `LockExample`) | `tryLock(timeout)` chống deadlock |
| Giới hạn concurrency cho tài nguyên khan hiếm | `Semaphore` (`SemaphoreConcurrencyLimitExample`) | Sizing theo dung lượng downstream — hoạt động với virtual threads |
| Rate limiting / circuit breaking | `RateLimiter`, `Resilience4j`, `Bucket4j` | Từ chối từ phía upstream trước khi bão hòa nội bộ |
| Tính toán song song nặng về CPU | Parallel streams, `ForkJoinPool` | Sizing theo số lõi |

---

## 16. Mô hình tư duy cuối cùng

Năm câu tóm gọn toàn bộ bài viết — mỗi câu đều được hỗ trợ bởi một ví dụ trong repository:

1. **Một thread không tự động làm code nhanh hơn.** Nó chỉ cho công việc cơ hội chạy song song (`CpuBoundThreadExample`).
2. **Concurrency không phải parallelism.** Concurrency là cấu trúc; parallelism là thực thi trên nhiều lõi. Thread cho bạn thứ thứ nhất; chỉ có phần cứng mới cho bạn thứ thứ hai.
3. **Nhiều thread không có nghĩa là nhiều sức mạnh CPU hơn.** Vượt quá số lõi, thread chỉ mua cho bạn context switch (`TooManyThreadsExample`).
4. **Virtual Threads cải thiện khả năng mở rộng cho blocking concurrency, chứ không phải hiệu suất CPU.** Chúng làm việc chờ đợi trở nên rẻ (`VirtualThreadIoExample`) nhưng không tăng tốc tính toán (`VirtualThreadCpuBoundExample`).
5. **Phần khó của multithreading là quản lý shared state, giới hạn tài nguyên, backpressure, vòng đời và lỗi** — chính xác những lỗi mà package `problems` tái hiện, và chính xác những thứ package `practical` sửa.

Thông điệp trung tâm, được in bởi ví dụ resource-limit:

> Virtual Threads loại bỏ chi phí của các thread đang chờ — chứ không loại bỏ chi phí của tài nguyên mà chúng đang chờ.

---

## Mã ví dụ trong repository này

Mọi ví dụ là một class độc lập có `main`, chạy được sau `mvn clean compile` qua `java -cp target/classes <fully.qualified.ClassName>`. Danh sách chạy được đầy đủ (31 ví dụ) nằm trong [`README.md`](https://github.com/hungpt99-dev/java-lab/blob/main/README.md) của repository; bảng dưới đây ánh xạ từng ví dụ với các mục của bài viết và bài học của nó.

| Mục bài viết | Ví dụ trong Repository | Điều nó minh họa |
| ------------ | ---------------------- | ---------------- |
| Tạo và chạy Thread | `basics.CreateThreadExample` | Ba cách tạo thread; kết quả đồng thời, không theo thứ tự |
| Tạo và chạy Thread | `basics.RunnableExample` | Runnable vs Callable, `join()`, `sleep()`, `Future.get()` |
| Tạo và chạy Thread | `basics.StartVsRunExample` | `run()` chạy trong caller; `start()` tạo thread mới |
| Vòng đời của Thread | `basics.ThreadLifecycleExample` | Cả sáu trạng thái, được tạo ra và quan sát |
| Race Condition | `synchronization.RaceConditionExample` | Bộ đếm hỏng: `count++` mất increment (bất định) |
| Đồng bộ hóa | `synchronization.SynchronizedExample` | Cùng bộ đếm, luôn đúng với monitor |
| Đồng bộ hóa | `synchronization.VolatileExample` | `volatile` ≠ atomicity; visibility của shared flag |
| Đồng bộ hóa | `synchronization.AtomicIntegerExample` | Bộ đếm CAS lock-free, luôn đúng |
| Đồng bộ hóa | `synchronization.LockExample` | `ReentrantLock`, reentrancy, `tryLock(timeout)` |
| Thread Pool | `threadpool.FixedThreadPoolExample` | Fixed pool = unbounded queue; tái sử dụng worker |
| Thread Pool | `threadpool.ThreadPoolExecutorExample` | Pipeline core → queue → max → rejection |
| Thread Pool | `threadpool.BoundedQueueExample` | Queue unbounded không bao giờ huy động `maximumPoolSize` |
| Thread Pool | `threadpool.RejectedExecutionExample` | `AbortPolicy` vs `CallerRunsPolicy` trong thực tế |
| Thread Pool | `threadpool.ThreadPoolExhaustionExample` | Mọi worker block; task nhanh phải chờ; không exception |
| Thread Pool | `practical.GracefulShutdownExample` | `shutdown()` → `awaitTermination()` → `shutdownNow()` |
| Lỗi phổ biến | `problems.DeadlockExample` | Chờ vòng; JVM phát hiện; kiểm tra bằng thread dump |
| Lỗi phổ biến | `problems.StarvationExample` | Task dài làm đói task ngắn (head-of-line blocking) |
| Lỗi phổ biến | `problems.ThreadLocalLeakExample` | Dữ liệu stale + memory leak; cách sửa bằng `remove()` |
| Lỗi phổ biến | `problems.LostExceptionExample` | `execute()` vs `submit()`; exception bị nuốt |
| Lỗi phổ biến | `problems.BlockingSharedPoolExample` | Call chậm phá latency task nhanh; pool riêng là cách sửa |
| Hiệu suất | `performance.CpuBoundThreadExample` | CPU-bound: giới hạn bởi cores, không phải thread |
| Hiệu suất | `performance.IoBoundThreadExample` | I/O-bound: concurrency scale throughput |
| Hiệu suất | `performance.TooManyThreadsExample` | Số thread ít → hợp lý → quá mức |
| Virtual Threads | `virtualthread.BasicVirtualThreadExample` | `startVirtualThread`, `ofVirtual()`, `isVirtual` |
| Virtual Threads | `virtualthread.VirtualThreadExecutorExample` | Per-task executor; 10.000 task chạy cùng lúc |
| Virtual Threads | `virtualthread.PlatformVsVirtualThreadExample` | 16 platform threads vs 1.000 VTs; tạo 100k VTs |
| Virtual Threads | `virtualthread.VirtualThreadIoExample` | p95 latency: queueing vs thời gian gọi |
| Virtual Threads | `virtualthread.VirtualThreadCpuBoundExample` | VTs KHÔNG tăng tốc công việc CPU-bound |
| Virtual Threads | `virtualthread.VirtualThreadResourceLimitExample` | Tài nguyên giới hạn bằng semaphore: VTs không nâng giới hạn |
| Giới hạn tài nguyên | `practical.SemaphoreConcurrencyLimitExample` | Chặn concurrency theo dung lượng downstream |
| Mẫu thực hành | `practical.ProducerConsumerExample` | Bounded queue, backpressure, shutdown bằng poison pill |

**Cách chạy tất cả cùng lúc:** `powershell -File scripts/run-all.ps1` biên dịch nếu cần và chạy toàn bộ 31 ví dụ theo thứ tự (chính script này đã bắt được một bug thật trong lúc bài viết được viết: một `executor.shutdown()` bị quên khiến JVM không thoát — đúng loại rò rỉ mà `LostExceptionExample` cảnh báo). Mọi ví dụ đều kết thúc sạch sẽ; các ví dụ nguy hiểm (deadlock) dùng daemon threads; mọi thời gian đo đều phụ thuộc vào máy và được đánh dấu cố ý trong output của chúng.
