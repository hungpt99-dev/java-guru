---
title: "Java Threads và Concurrency: Từ CPU, Thread Pool đến Virtual Threads"
description: "Một số request cần CPU để parse JSON, hash hoặc nén dữ liệu. Một số đang chờ database. Một số đang chờ HTTP API bên ngoài trả lời sau vài trăm mili-giây."
slug: "java-threads-va-concurrency-tu-cpu-thread-pool-den-virtual-threads"
locale: "vi"
translationKey: "java-threads-va-concurrency-tu-cpu-thread-pool-den-virtual-threads"
pubDate: 2026-08-10T15:38:12+07:00
category: "Java & JVM"
tags: ["Java", "programming language", "thread", "concurrency"]
featured: true
draft: false
readingTime: 19
series: null
coverImage: "./cover.png"
---


Hãy tưởng tượng một service nhận **10.000 request cùng lúc**.

Một số request cần CPU để parse JSON, hash hoặc nén dữ liệu. Một số đang chờ database. Một số đang chờ HTTP API bên ngoài trả lời sau vài trăm mili-giây.

Câu hỏi đầu tiên là:

> **Có nên tạo 10.000 thread?**

Nếu không, tại sao? Và nếu Java Virtual Threads cho phép tạo hàng trăm nghìn hoặc hàng triệu thread, tại sao concurrency vẫn không thể tăng vô hạn?

Để trả lời, hãy nhìn toàn bộ stack:

```text
Application Code
       ↓
Java Threads
       ↓
JVM
       ↓
Operating System Scheduler
       ↓
CPU Cores
       ↓
External Resources
(Database, API, Network, Files...)
```

Hầu hết vấn đề concurrency thực chất là một câu hỏi:

> **Bottleneck thật sự nằm ở đâu?**

CPU? Database connection? HTTP API? Memory? Lock contention? Thread pool? Queue?

Thêm thread chỉ giúp khi nó giải quyết đúng bottleneck. Nếu không, bạn chỉ chuyển bottleneck sang một nơi khác.

Bài viết này đi từ nền tảng đến production:

1. Concurrency và parallelism khác nhau thế nào?
2. Platform thread thực sự là gì?
3. Vì sao `count++` không thread-safe?
4. `synchronized`, `Atomic*`, `Lock` và `volatile` khác nhau ra sao?
5. Thread pool hoạt động thế nào dưới quá tải?
6. Vì sao thêm nhiều thread đôi khi làm ứng dụng chậm hơn?
7. Những lỗi concurrency phổ biến ở production.
8. Virtual Threads thay đổi điều gì?
9. Vì sao Virtual Threads vẫn cần giới hạn concurrency?

Các ví dụ đi cùng repository `java-lab`, chạy trên Java 21+. Các số liệu trong bài là kết quả mẫu từ các ví dụ, không phải benchmark tuyệt đối.

---

## Source Code & Examples

Bạn có thể đọc bài viết đầy đủ tại:

https://java-guru.pages.dev/en/posts/java-core/java-threads-from-thread-pools-to-virtual-threads/

Toàn bộ ví dụ trong bài viết được triển khai trong repository:

[java-lab — Thread Examples](https://github.com/hungpt99-dev/java-lab/tree/lab/thread?utm_source=chatgpt.com)

Repository bao gồm các ví dụ thực tế về:

* Tạo và quản lý `Thread`, `Runnable`, `Callable`, `join()`
* Thread lifecycle
* Race condition và shared state
* `synchronized`, `AtomicInteger`, `ReentrantLock`, `volatile`
* `ThreadPoolExecutor`, bounded queue và rejection policies
* CPU-bound vs I/O-bound workloads
* Deadlock, starvation, thread pool exhaustion và `ThreadLocal` leak
* Virtual Threads
* Giới hạn concurrency bằng `Semaphore`
* Producer–Consumer và backpressure
* Graceful shutdown

Bạn có thể đọc bài viết song song với source code để xem từng khái niệm hoạt động thực tế.

# 1. Vì sao chúng ta cần Thread?

Một chương trình tuần tự chạy như sau:

```text
Task A
  ↓
Task B
  ↓
Task C
```

Nhưng backend thực tế thường có nhiều request ở các trạng thái khác nhau:

```text
Request A ── chờ database
Request B ── đang tính toán
Request C ── chờ HTTP API
Request D ── đọc file
```

Nếu chương trình xử lý hoàn toàn tuần tự, CPU có thể ngồi rảnh trong khi một request chờ database.

Đó là lý do thread tồn tại:

> **Cho phép công việc khác tiếp tục trong khi một công việc đang chờ.**

CPU có thể thực hiện hàng tỷ chỉ thị mỗi giây, trong khi một database hoặc HTTP request có thể mất vài mili-giây hoặc vài giây.

Thread giúp chồng lấp thời gian chờ đó.

Nhưng thread không miễn phí. Nó có bộ nhớ, chi phí scheduler, context switching và đặc biệt là shared mutable state.

Vì vậy, concurrency luôn là bài toán đánh đổi:

```text
Nhiều concurrency hơn
        ↓
CPU ít bị bỏ phí hơn
        ↓
Nhưng nhiều shared state, scheduling và resource contention hơn
```

---

# 2. Concurrency và Parallelism

Hai khái niệm này thường bị dùng lẫn nhau.

## Concurrency

Nhiều tác vụ cùng **tiến triển trong các khoảng thời gian chồng lấn**.

Trên một CPU:

```text
Thread A: |--A1--|        |--A2--|        |--A3--|
Thread B:        |--B1--|        |--B2--|
```

CPU không nhất thiết chạy hai task cùng lúc. Nó chuyển qua lại giữa chúng.

Concurrency đặc biệt hữu ích khi task thường xuyên chờ I/O.

## Parallelism

Nhiều tác vụ thực sự chạy cùng thời điểm trên nhiều CPU core:

```text
Core 1: |------Task A------|
Core 2: |------Task B------|
```

Điểm quan trọng:

> **Concurrency giúp che giấu thời gian chờ. Parallelism giúp tận dụng nhiều CPU core.**

Tạo 1.000 thread trên máy 4 core không tạo ra 1.000 đơn vị tính toán song song.

Nhiều nhất chỉ có khoảng 4 thread thực sự chạy trên CPU tại một thời điểm. Những thread còn lại đang:

* chờ I/O;
* chờ lock;
* sleeping;
* hoặc chờ scheduler.

**Tạo thread không tạo thêm CPU core.**

---

## 2.1 CPU-bound và I/O-bound

Đây là câu hỏi đầu tiên trước khi thiết kế concurrency.

### CPU-bound

Task dành phần lớn thời gian để tính toán:

* hashing;
* compression;
* encryption;
* image processing;
* tính toán lớn.

```text
[===== compute =====][===== compute =====]
```

Bottleneck là CPU.

Thêm thread chỉ giúp đến gần số CPU core.

### I/O-bound

Task dành phần lớn thời gian chờ:

* database;
* HTTP API;
* file;
* network.

```text
[wait 95ms]
[work  5ms]
```

Trong khi Task A chờ, CPU có thể chạy Task B.

Đây là nơi concurrency mang lại lợi ích lớn.

Mô hình đơn giản:

```text
CPU-bound → giới hạn bởi số core
I/O-bound → giới hạn bởi latency và số tài nguyên bên ngoài
```

---

# 3. Platform Thread Thực Sự Là Gì?

Một Java platform thread không chỉ là một object.

Về mặt khái niệm:

```text
Java Platform Thread
        ↓
       JVM
        ↓
Native / OS Thread
        ↓
Operating System Scheduler
        ↓
CPU Core
```

Platform thread thường có quan hệ gần như 1:1 với OS thread.

Một thread cần:

* stack;
* program counter;
* register state;
* scheduling metadata;
* kernel resources.

Vì vậy, tạo rất nhiều platform thread có chi phí:

```text
More threads
     ↓
More memory
     ↓
More scheduler work
     ↓
More context switches
     ↓
More cache disruption
```

Đó là lý do mô hình sau không mở rộng tốt:

```java
new Thread(task).start();
```

cho mỗi request.

Ba thread thì không có vấn đề.

Ba nghìn hoặc mười nghìn thread có thể trở thành vấn đề về memory và scheduling.

---

## Runnable và Callable

`Runnable`:

```java
void run()
```

* không trả về kết quả;
* không ném checked exception.

`Callable<V>`:

```java
V call() throws Exception
```

* trả về giá trị;
* có thể ném exception.

Ví dụ:

```java
Callable<Integer> task = () -> {
    Thread.sleep(100);
    return 42;
};

ExecutorService executor = Executors.newSingleThreadExecutor();

try {
    Future<Integer> future = executor.submit(task);
    System.out.println(future.get());
} finally {
    executor.shutdown();
}
```

`Future.get()` sẽ block caller cho đến khi kết quả sẵn sàng.

Một chi tiết quan trọng:

> Exception bên trong task có thể được giữ trong `Future`.

Nếu bạn submit task nhưng không bao giờ kiểm tra `Future`, failure có thể bị bỏ qua.

---

# 4. `start()` và `run()` Không Giống Nhau

```java
Thread thread = new Thread(task, "worker");

thread.run();
thread.start();
```

Hai dòng này có ý nghĩa hoàn toàn khác.

## `run()`

Chỉ là một method call bình thường:

```text
main
 ↓
run()
 ↓
task chạy trên main
```

## `start()`

Yêu cầu JVM tạo một execution thread mới:

```text
main
 ↓
start()
 ↓
new thread
 ↓
JVM gọi run() trên thread mới
```

Ví dụ:

```java
Runnable task = () ->
    System.out.println(Thread.currentThread().getName());

Thread thread = new Thread(task, "new-thread");

thread.run();    // main
thread.start();  // new-thread
```

Sau `start()`, thứ tự thực thi trở thành nondeterministic.

Bạn không thể giả định:

```text
A luôn chạy trước B
```

Scheduler quyết định điều đó.

Đây là một trong những lý do concurrency bug khó tái hiện:

> Code đúng trong một lần chạy không có nghĩa là nó đúng trong mọi interleaving.

---

# 5. Thread Lifecycle

Các trạng thái thread rất quan trọng khi đọc thread dump:

```text
NEW
 ↓ start()
RUNNABLE
 ├── BLOCKED
 ├── WAITING
 ├── TIMED_WAITING
 ↓
TERMINATED
```

## `NEW`

Thread đã được tạo nhưng chưa gọi `start()`.

## `RUNNABLE`

Thread đang chạy hoặc sẵn sàng chạy.

Quan trọng:

> `RUNNABLE` không có nghĩa chắc chắn đang chạy trên CPU.

Nó có thể đang chờ scheduler cấp CPU time.

## `BLOCKED`

Đang chờ một `synchronized` monitor.

```text
Thread A giữ lock
        ↓
Thread B cần lock đó
        ↓
Thread B → BLOCKED
```

## `WAITING`

Chờ một sự kiện mà không có timeout.

Ví dụ:

* `Object.wait()`;
* `Thread.join()`;
* `LockSupport.park()`.

## `TIMED_WAITING`

Chờ có timeout:

* `Thread.sleep()`;
* `join(timeout)`;
* `await(timeout)`.

## `TERMINATED`

`run()` đã kết thúc hoặc thread bị terminate vì exception.

---

## Đọc thread dump

Thread state thường cho bạn hướng debug:

```text
Nhiều BLOCKED
→ lock contention

Nhiều RUNNABLE
→ có thể CPU saturation

Nhiều WAITING/TIMED_WAITING
→ đang chờ queue, future hoặc external event
```

Thread states không chỉ là lý thuyết.

Chúng là một trong những công cụ đầu tiên khi production bị treo.

---

# 6. Race Condition: Vì Sao `count++` Bị Sai?

Giả sử:

```java
private int count;

public void increment() {
    count++;
}
```

Nhiều developer nhìn thấy một câu lệnh.

CPU nhìn thấy:

```text
Read count
    ↓
Add 1
    ↓
Write count
```

Hai thread có thể interleave:

```text
Thread A đọc 0
Thread B đọc 0

Thread A tính 1
Thread B tính 1

Thread A ghi 1
Thread B ghi 1
```

Kỳ vọng:

```text
2
```

Thực tế:

```text
1
```

Một increment đã bị mất.

Đây là **race condition**.

Điều nguy hiểm là lỗi không phải lúc nào cũng xảy ra.

Một lần chạy có thể đúng.

Lần sau có thể sai.

Production có nhiều CPU, nhiều request và nhiều interleaving hơn nên bug dễ xuất hiện hơn.

---

## 6.1 Ba vấn đề khác nhau trong concurrency

Thread safety không chỉ là một vấn đề.

Có ít nhất ba đảm bảo cần phân biệt:

### Atomicity

Một operation không bị chia nhỏ theo cách thread khác có thể xen vào.

`count++` không atomic.

### Visibility

Thread A ghi dữ liệu nhưng thread B có thể không thấy nó đúng lúc nếu không có synchronization phù hợp.

### Ordering

CPU và JIT có thể reorder một số thao tác miễn là single-thread semantics vẫn đúng.

Vì vậy:

> Một giải pháp cho visibility chưa chắc giải quyết atomicity.

Đó là lý do cần hiểu `volatile`, `Atomic*` và lock khác nhau thế nào.

---

# 7. Java Memory Model và Synchronization

Java Memory Model định nghĩa khi nào thay đổi của một thread được nhìn thấy bởi thread khác.

Bạn không cần thuộc toàn bộ specification.

Mô hình tư duy thực tế là:

```text
Thread A view of memory
        ↕
Synchronization
        ↕
Thread B view of memory
```

Các cơ chế như:

* `synchronized`;
* `volatile`;
* `Atomic*`;
* `Lock`;

tạo ra các quy tắc visibility và ordering cụ thể.

Khái niệm trung tâm là **happens-before**.

Ví dụ đơn giản:

> Thao tác xảy ra trước khi thread A nhả một lock sẽ trở nên visible với thread B sau khi B acquire cùng lock đó.

---

## 7.1 `synchronized`

```java
public synchronized void increment() {
    count++;
}
```

`synchronized` cung cấp:

1. **Mutual exclusion** — chỉ một thread vào critical section.
2. **Visibility** — thay đổi được đồng bộ giữa các thread.

```text
Thread A
  ↓ acquire lock
modify shared state
  ↓ release lock
  ↓
Thread B
  ↓ acquire same lock
sees synchronized state
```

Nhược điểm:

* lock contention;
* thread phải chờ;
* không có timeout;
* không đảm bảo fairness.

Critical section càng lớn, contention càng cao.

Vì vậy:

> Chỉ lock phần nhỏ nhất cần thiết để bảo vệ invariant.

---

## 7.2 `AtomicInteger`

```java
private final AtomicInteger count = new AtomicInteger();

public void increment() {
    count.incrementAndGet();
}
```

Về mặt khái niệm, nó dùng CAS:

```text
Read current value
      ↓
Compute new value
      ↓
Compare-And-Swap
      ↓
Failed? Retry
```

Ví dụ:

```text
A: CAS(5 → 6) → success
B: CAS(5 → 6) → failed
B: retry
B: CAS(6 → 7) → success
```

Ưu điểm:

* phù hợp với state đơn giản;
* không cần critical section lớn;
* thường hiệu quả dưới contention nhẹ.

Nhưng `AtomicInteger` không thay thế lock khi bạn cần bảo vệ invariant giữa nhiều field.

Ví dụ:

```text
Check account A
Check account B
Transfer money
Update A
Update B
```

Đây là một operation logic lớn hơn một atomic variable.

---

## 7.3 `ReentrantLock`

Dùng khi bạn cần nhiều quyền kiểm soát hơn:

```java
lock.lock();
try {
    // critical section
} finally {
    lock.unlock();
}
```

`ReentrantLock` hỗ trợ:

* `tryLock()`;
* timeout;
* fairness;
* conditions;
* kiểm soát lock tường minh.

Ví dụ:

```java
if (lock.tryLock(1, TimeUnit.SECONDS)) {
    try {
        // work
    } finally {
        lock.unlock();
    }
}
```

Điểm quan trọng nhất:

> Luôn `unlock()` trong `finally`.

Nếu exception xảy ra và lock không được release, các thread khác có thể chờ mãi mãi.

Dùng `ReentrantLock` khi cần timeout hoặc control đặc biệt. Với critical section đơn giản, `synchronized` thường ít lỗi hơn.

---

## 7.4 `volatile`: Visibility, không phải Atomicity

```java
private volatile int count;
```

Điều này **không** làm:

```java
count++;
```

trở thành atomic.

Nó vẫn là:

```text
read
add
write
```

`volatile` phù hợp với các trường hợp như:

```java
private volatile boolean running = true;
```

Một thread:

```java
while (running) {
    // work
}
```

Thread khác:

```java
running = false;
```

Ở đây vấn đề chính là visibility.

Quy tắc thực dụng:

```text
volatile
→ flags / visibility

Atomic*
→ atomic read-modify-write trên state đơn giản

synchronized / Lock
→ critical section và invariant phức tạp
```

---

# 8. Thread Pool: Không Chỉ Là Tái Sử Dụng Thread

Một cách đơn giản để xử lý task là:

```java
new Thread(task).start();
```

Nhưng với 10.000 request:

```text
10,000 tasks
    ↓
10,000 OS threads
```

Điều này gây:

* chi phí tạo thread;
* memory stack;
* scheduler overhead;
* context switching;
* nguy cơ cạn native threads.

Thread pool giải quyết bằng cách:

```text
Tasks
  ↓
Queue
  ↓
Worker Pool
```

Một pool làm bốn việc:

1. Tái sử dụng worker threads.
2. Giới hạn concurrency.
3. Giới hạn resource consumption.
4. Xác định hành vi khi overload.

Đây là ý tưởng quan trọng:

> **Thread pool là một cơ chế quản lý tài nguyên.**

Không chỉ là tiện ích để chạy async.

---

# 9. `ThreadPoolExecutor`: Core → Queue → Max → Reject

`ThreadPoolExecutor` xử lý task mới theo thứ tự:

```text
New Task
   │
   ├─ workers < corePoolSize?
   │      → create worker
   │
   ├─ queue has space?
   │      → enqueue
   │
   ├─ workers < maximumPoolSize?
   │      → create more workers
   │
   └─ otherwise
          → reject
```

Thứ tự này cực kỳ quan trọng.

**Queue được kiểm tra trước khi pool tăng từ core lên max.**

Ví dụ:

```java
new ThreadPoolExecutor(
    2,
    4,
    30,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(2),
    threadFactory,
    new ThreadPoolExecutor.AbortPolicy()
);
```

Task có thể đi như sau:

```text
Task 1 → worker 1
Task 2 → worker 2
Task 3 → queue
Task 4 → queue
Task 5 → worker 3
Task 6 → worker 4
Task 7 → rejected
```

Đó là:

```text
core
  ↓
queue
  ↓
max
  ↓
rejection
```

---

## 9.1 Unbounded Queue là một cái bẫy

Với queue không giới hạn:

```text
Tasks keep coming
      ↓
Queue keeps growing
      ↓
Memory increases
      ↓
Latency increases
      ↓
GC pressure
      ↓
Possible failure
```

Một queue không loại bỏ overload.

> **Nó chỉ cất overload vào bộ nhớ.**

Với `LinkedBlockingQueue` không giới hạn, `maximumPoolSize` có thể gần như không bao giờ được sử dụng.

Task chỉ tiếp tục vào queue.

Vì vậy, production cần suy nghĩ rõ:

* queue capacity;
* max threads;
* rejection policy;
* upstream backpressure.

---

## 9.2 Rejection Policy

Khi pool và queue đều đầy, hệ thống phải quyết định nói gì với task mới.

### `AbortPolicy`

```text
Reject
→ RejectedExecutionException
```

Phù hợp khi muốn fail fast.

### `CallerRunsPolicy`

Task chạy trên thread submit:

```text
Producer submits task
       ↓
Pool full
       ↓
Producer runs task itself
       ↓
Producer becomes slower
```

Đây là một dạng backpressure tự nhiên.

### `DiscardPolicy`

Bỏ task im lặng.

Thường nguy hiểm vì mất dữ liệu mà không ai biết.

---

## 9.3 Shutdown

Executor phải có vòng đời rõ ràng:

```java
executor.shutdown();

if (!executor.awaitTermination(800, TimeUnit.MILLISECONDS)) {
    executor.shutdownNow();
}
```

Ý nghĩa:

```text
shutdown()
→ stop accepting new tasks

awaitTermination()
→ give current work time to finish

shutdownNow()
→ interrupt running tasks and return queued tasks
```

Interrupt chỉ hoạt động tốt nếu task tôn trọng interruption.

Production shutdown không phải chỉ là "kill process".

Task cần có cơ hội:

* đóng socket;
* cleanup;
* rollback;
* release resources.

---

# 10. Hiệu Năng: Khi Thêm Thread Làm Hệ Thống Chậm Hơn

Context switch không miễn phí.

Khi CPU chuyển từ Thread A sang Thread B:

```text
Save A state
   ↓
Scheduler bookkeeping
   ↓
Cache/TLB disruption
   ↓
Restore B state
   ↓
Continue B
```

Nếu có quá nhiều runnable thread:

```text
More threads
    ↓
More scheduling
    ↓
More context switches
    ↓
Less useful work
```

Vì vậy:

> **Số thread đúng không phải là số lớn nhất. Đó là số đủ để giữ tài nguyên hữu ích bận.**

---

## 10.1 CPU-bound

Với workload thuần tính toán:

```text
1 thread
   ↓
slow

≈ number of cores
   ↓
maximum useful parallelism

far above cores
   ↓
little improvement or degradation
```

Một quy tắc thực dụng:

```text
CPU-bound pool ≈ number of CPU cores
```

Hoặc đôi khi `cores + 1`.

Thêm 100 thread cho máy 12 core không tạo thêm 88 core.

---

## 10.2 I/O-bound

Với workload:

```text
Compute: 5 ms
Wait:   95 ms
```

Thread dành phần lớn thời gian không dùng CPU.

Do đó nhiều thread hơn số core có thể hữu ích.

Một công thức heuristic phổ biến:

```text
threads ≈ cores × (1 + wait / compute)
```

Nhưng đây chỉ là điểm bắt đầu.

Nếu latency external service thay đổi, con số phù hợp cũng thay đổi.

Vì vậy:

> Đo workload thật quan trọng hơn tin tuyệt đối vào một công thức.

---

## 10.3 Oversubscription

Quá nhiều thread runnable gây:

* scheduler overhead;
* context switching;
* cache disruption.

Mô hình:

```text
Too few threads
→ CPU idle

Enough threads
→ good utilization

Too many threads
→ scheduler becomes the bottleneck
```

Đây là lý do "tăng pool size để tăng performance" đôi khi làm tình hình tệ hơn.

---

# 11. Những Lỗi Concurrency Thường Gặp ở Production

## 11.1 Deadlock

Ví dụ kinh điển:

```text
Thread A holds Lock 1
Thread A waits for Lock 2

Thread B holds Lock 2
Thread B waits for Lock 1
```

Không exception.

Không crash.

Chỉ treo.

Deadlock xảy ra khi bốn điều kiện Coffman cùng tồn tại:

1. Mutual Exclusion.
2. Hold and Wait.
3. No Preemption.
4. Circular Wait.

Cách phòng thủ quan trọng nhất:

> **Luôn acquire locks theo cùng một thứ tự toàn cục.**

Ví dụ:

```text
Luôn Lock A trước
sau đó Lock B
```

Không có:

```text
Code path 1: A → B
Code path 2: B → A
```

Khi debug production, thread dump thường là công cụ quan trọng nhất.

---

## 11.2 Starvation

Deadlock nghĩa là không ai tiến triển.

Starvation nghĩa là một số thread vẫn tiến triển, nhưng thread khác có thể bị bỏ đói.

Ví dụ:

```text
Greedy thread
→ repeatedly acquires lock

Other threads
→ repeatedly lose
```

`synchronized` không đảm bảo fairness.

Nếu fairness quan trọng:

```java
new ReentrantLock(true)
```

có thể phù hợp, với trade-off về throughput.

---

## 11.3 Thread Pool Exhaustion

Một pool nhỏ có một task bị block lâu:

```text
Slow task occupies worker
        ↓
Other tasks queue
        ↓
Latency increases
        ↓
More requests arrive
        ↓
Queue grows
        ↓
Memory pressure
        ↓
Timeouts
        ↓
Retries
        ↓
Cascading failure
```

Đây là lý do mọi external call nên có timeout.

Không timeout nghĩa là một thread có thể bị chiếm vô hạn.

Phòng thủ:

* timeout;
* bounded queue;
* rejection;
* bulkhead;
* giới hạn concurrency.

---

## 11.4 `ThreadLocal` Leak trong Pool

`ThreadLocal` gắn với thread, không gắn với task.

Trong pool:

```text
Worker runs Task A
→ ThreadLocal = A data

Worker reused for Task B
→ A data can still exist
```

Vì worker sống lâu, dữ liệu có thể:

* gây memory leak;
* bị task sau nhìn thấy;
* gây cross-request contamination.

Mẫu an toàn:

```java
try {
    threadLocal.set(value);
    // work
} finally {
    threadLocal.remove();
}
```

Quy tắc:

> Pooled thread được tái sử dụng, nên ThreadLocal cần cleanup rõ ràng.

---

## 11.5 Exception Bị Mất

```java
executor.submit(() -> {
    throw new RuntimeException("failed");
});
```

Exception có thể được giữ trong `Future`.

Nếu bạn không gọi:

```java
future.get();
```

failure có thể không được xử lý theo cách bạn mong đợi.

Các lựa chọn:

* kiểm tra `Future`;
* xử lý exception trong `CompletableFuture`;
* wrapper có logging;
* dùng `execute()` khi semantics phù hợp.

Đừng giả định rằng:

```text
task throws
→ chắc chắn có log
```

---

## 11.6 Một Shared Pool Cho Mọi Thứ

Giả sử một pool xử lý:

* request nhanh;
* background jobs;
* slow external API calls.

```text
All tasks
    ↓
Shared Pool
    ↓
Slow tasks occupy workers
    ↓
Fast tasks wait behind them
```

Một task đáng lẽ mất 5 ms có thể mất hàng giây chỉ vì đứng sau một dependency chậm.

Cách tốt hơn:

```text
Fast workload → Pool A
Slow external calls → Pool B
```

Đây là **bulkhead isolation**.

Đừng để một dependency chậm có khả năng chiếm toàn bộ execution capacity của hệ thống.

---

# 12. Virtual Threads: Làm Cho Blocking Rẻ Hơn

Platform thread có chi phí vì nó gắn với OS thread.

Virtual thread thay đổi điều đó.

Mô hình:

```text
Platform Thread
Java Thread ↔ OS Thread
```

Trong khi virtual thread:

```text
Many Virtual Threads
        ↓
Scheduled on fewer Carrier Threads
        ↓
OS Threads
```

Khi virtual thread block ở một blocking operation phù hợp:

```text
Virtual Thread
    ↓
I/O blocks
    ↓
Virtual Thread is unmounted
    ↓
Carrier becomes available
    ↓
Another Virtual Thread runs
```

Khi I/O hoàn thành:

```text
Virtual Thread
    ↓
Scheduled again
    ↓
Mounted on a carrier
    ↓
Continue
```

Ý tưởng chính:

> **Virtual Threads không làm CPU nhanh hơn. Chúng làm việc chờ đợi rẻ hơn.**

---

## 12.1 Tạo Virtual Thread

```java
Thread.startVirtualThread(() -> {
    // task
});
```

Hoặc:

```java
Thread.Builder builder = Thread.ofVirtual();
```

Hoặc:

```java
try (ExecutorService executor =
         Executors.newVirtualThreadPerTaskExecutor()) {

    executor.submit(task);
}
```

`newVirtualThreadPerTaskExecutor()` tạo một virtual thread cho mỗi task.

Mô hình tư duy mới cho I/O:

```text
Platform threads:
limited execution slots
→ pool them

Virtual threads:
cheap task carriers
→ one task per thread
```

---

## 12.2 Virtual Thread vs Platform Thread

Với nhiều task chủ yếu `sleep()` hoặc chờ I/O:

```text
Platform thread pool
→ limited workers
→ remaining tasks wait in queue

Virtual threads
→ one thread per task
→ tasks can all wait concurrently
```

Do đó Virtual Threads đặc biệt mạnh với:

* HTTP calls;
* database access;
* blocking network I/O;
* file I/O;
* RPC;
* request-per-task workloads.

---

# 13. Virtual Threads Không Làm CPU-bound Nhanh Hơn

Đây là hiểu lầm phổ biến.

Virtual thread vẫn cần CPU để chạy.

Nếu máy có 12 core:

```text
12 CPU-bound tasks
→ can use ~12 cores

1,000 CPU-bound virtual threads
→ still share those same cores
```

Virtual Threads không tạo thêm parallelism.

Với CPU-bound workload, một fixed-size platform-thread executor gần số core thường phù hợp hơn.

Quy tắc:

```text
I/O-bound
→ Virtual Threads are often a strong default

CPU-bound
→ limit parallelism around available cores
```

---

# 14. Virtual Threads Có Xóa Giới Hạn Không?

Không.

Chúng chỉ loại bỏ hoặc giảm **thread bottleneck**.

Bottleneck vẫn có thể là:

```text
100,000 virtual threads
        ↓
20 database connections
        ↓
Only 20 requests can use DB at once
```

100.000 task vẫn có thể tồn tại.

Nhưng throughput database vẫn bị giới hạn bởi 20 connection.

Vì vậy:

> **Unlimited threads do not mean unlimited throughput.**

Bottleneck chỉ chuyển từ:

```text
Number of threads
```

sang:

```text
External resource capacity
```

---

## 14.1 Giới hạn concurrency bằng Semaphore

```java
Semaphore semaphore = new Semaphore(20);

semaphore.acquire();
try {
    // access limited resource
} finally {
    semaphore.release();
}
```

Mô hình:

```text
1000 virtual tasks
       ↓
Semaphore(20)
       ↓
20 access resource
980 wait cheaply
```

Đây là một kết hợp rất mạnh:

```text
Virtual Threads
→ cheap waiting

Semaphore / connection pool
→ resource protection
```

Dùng cơ chế phù hợp với tài nguyên:

| Cơ chế           | Giới hạn              |
| ---------------- | --------------------- |
| `Semaphore`      | số tác vụ đồng thời   |
| Connection pool  | DB/socket connections |
| Rate limiter     | requests per second   |
| Bulkhead         | failure isolation     |
| Bounded queue    | overload buffering    |
| Rejection policy | overload response     |

---

# 15. Producer–Consumer và Backpressure

Khi tạo task trở nên rất rẻ, vấn đề có thể chuyển sang queue và consumer.

```text
Fast Producers
      ↓
Bounded Queue
      ↓
Consumers
```

Nếu producer nhanh hơn consumer:

```text
Without bounds
→ queue grows

With bounds
→ producer must slow down or wait
```

Backpressure không làm hệ thống nhanh hơn.

Nó ngăn hệ thống tự hủy khi demand lớn hơn capacity.

Một queue bounded nói:

> "Tôi chỉ có thể hấp thụ từng này quá tải."

Đó là một property tốt hơn queue tăng vô hạn.

---

# 16. Mô Hình Tư Duy Cho Production

Toàn bộ bài viết có thể rút thành một câu:

> **Thread là một tài nguyên; nhưng bottleneck thực sự thường là thứ thread đang chờ.**

Khi thiết kế concurrency, đi theo thứ tự:

## Bước 1: Xác định workload

```text
CPU-bound?
I/O-bound?
Mixed?
```

## Bước 2: Tìm bottleneck

```text
CPU?
DB connections?
External API?
Lock?
Memory?
Queue?
```

## Bước 3: Chọn execution model

```text
CPU-bound
→ limit parallelism around cores

I/O-bound
→ consider Virtual Threads
```

## Bước 4: Bảo vệ shared state

```text
Simple atomic state
→ Atomic*

Visibility flag
→ volatile

Complex invariant
→ synchronized / Lock
```

## Bước 5: Bảo vệ external resources

```text
Semaphore
Connection pool
Rate limit
Timeout
```

## Bước 6: Chuẩn bị cho overload

```text
Bounded queue
Rejection policy
Backpressure
Bulkhead isolation
```

## Bước 7: Chuẩn bị cho failure

```text
Timeout
Interrupt handling
Exception handling
Graceful shutdown
Thread dumps
```

---

# 17. Decision Checklist

| Câu hỏi                                | Hướng xử lý                            |
| -------------------------------------- | -------------------------------------- |
| Task chủ yếu I/O-bound?                | Cân nhắc Virtual Thread mỗi task       |
| Task CPU-bound?                        | Giới hạn parallelism gần số core       |
| External resource có capacity hữu hạn? | Semaphore / pool / rate limit          |
| Có thể overload?                       | Bounded queue + rejection/backpressure |
| Có shared mutable state?               | Atomic / synchronized / Lock           |
| Có nhiều lock?                         | Thống nhất lock ordering               |
| Dùng ThreadLocal trong pool?           | `remove()` trong `finally`             |
| Có external call?                      | Luôn đặt timeout                       |
| Workload latency khác nhau?            | Tách executor/bulkhead                 |
| Pool có vòng đời riêng?                | Shutdown đúng cách                     |

---

# Kết Luận

Java concurrency không bắt đầu bằng:

> "Tôi nên tạo bao nhiêu thread?"

Câu hỏi đúng hơn là:

> **"Task của tôi đang chờ cái gì, và tài nguyên nào thực sự giới hạn hệ thống?"**

Platform threads là tài nguyên tương đối đắt, nên thread pool tồn tại để quản lý chúng. Nhưng pool mang theo queue, rejection, sizing, exhaustion và tail latency.

Virtual Threads thay đổi cuộc chơi bằng cách làm blocking rẻ hơn. Với I/O-bound workloads, bạn có thể chuyển sang mô hình:

```text
One task
   ↓
One virtual thread
```

Nhưng Virtual Threads không tạo thêm CPU core, không tăng số database connection và không bỏ qua rate limit.

Do đó mô hình cuối cùng là:

```text
Your Code
   │
   ├── CPU-bound
   │     → limited parallelism
   │
   ├── I/O-bound
   │     → Virtual Threads
   │
   ├── Shared state
   │     → Atomic / synchronized / Lock
   │
   ├── External resources
   │     → Semaphore / connection pool / rate limit
   │
   └── Overload
         → bounded queues / backpressure / rejection
```

**Điều quan trọng nhất cần nhớ:**

> **Đừng bắt đầu bằng việc chọn số thread. Hãy bắt đầu bằng bottleneck.**
>
> Thread chỉ là cách công việc được thực thi hoặc chờ đợi. Giới hạn thật sự của hệ thống thường nằm ở CPU, lock, queue hoặc một tài nguyên bên ngoài mà các thread đang tranh chấp.
