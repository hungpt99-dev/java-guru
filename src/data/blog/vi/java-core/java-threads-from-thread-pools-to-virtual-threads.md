---
title: "Java Threads: Từ Thread Pool đến Virtual Threads"
description: "Cẩm nang concurrency Java đậm chất production với 31 ví dụ chạy được: thread thực sự là gì, vì sao shared state bị hỏng, thread pool và backpressure hoạt động ra sao, vì sao thêm thread lại chậm hơn, và Virtual Threads thực sự thay đổi điều gì bên dưới."
pubDatetime: 2026-08-09T00:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Hãy tưởng tượng một dịch vụ nhận 10.000 request cùng một lúc.

Một số request cần CPU — parse JSON, băm, nén.
Một số chờ truy vấn database.
Một số chờ một HTTP API bên ngoài mất 300 ms mới trả lời.

Câu hỏi đầu tiên mọi kỹ sư đặt ra: _chúng ta có nên tạo 10.000 thread?_

Nếu không, tại sao không? Và câu hỏi tiếp theo khiến ai cũng bối rối: _nếu
Java Virtual Threads cho phép tạo hàng triệu thread, tại sao không thể làm
ứng dụng concurrency vô hạn?_

Bài viết này trả lời những câu hỏi đó. Nhưng thay vì bắt đầu bằng định nghĩa
của thread, nó bắt đầu bằng chồng các lớp máy móc quyết định mọi thứ về
concurrency:

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
External Resources (databases, APIs, files)
```

Mọi câu hỏi trong bài viết này thực chất chỉ xoay quanh một điều: **bottleneck
thực sự của hệ thống nằm ở đâu, và việc thêm thread có giải quyết đúng
bottleneck đó hay chỉ dịch chuyển nó sang chỗ khác?**

Đây là mô hình tư duy chúng ta sẽ dùng đi dùng lại:

> **Trước khi thêm thread, hãy tự hỏi: thứ đang giới hạn hệ thống thực sự là
> gì?** CPU? Số connection database? Rate limit của API bên ngoài? Mạng? Bộ
> nhớ? Tranh chấp lock? Chính thread pool? Dung lượng queue?
> Tăng concurrency chỉ có ích nếu nó giải quyết đúng bottleneck thực tế. Nếu
> không, nó có thể chỉ đẩy bottleneck sang chỗ khác.

Bốn câu hỏi bài viết này trả lời một cách sâu sắc:

- Vì sao thêm nhiều thread có thể khiến ứng dụng **chậm hơn**?
- Vì sao một thread pool với hàng trăm thread không cải thiện CPU utilization?
- Vì sao Virtual Threads xử lý được concurrency khổng lồ nhưng không làm code tính toán (CPU-bound) nhanh hơn?
- Vì sao lỗi concurrency hầu như **chỉ xuất hiện ở production**?

Mọi khẳng định đều được hỗ trợ bởi một ví dụ thật, chạy được. Bài viết được
thiết kế để đọc cùng repository đồng hành [`java-lab`](https://github.com/hungpt99-dev/java-lab/tree/lab/thread),
một dự án Maven thuần với **31 ví dụ nhỏ, độc lập**, không framework, chỉ dùng
API concurrency thuần của JDK. Mỗi phần gắn một khái niệm với một class cụ thể,
trình bày code thật, và cho bạn biết chính xác chạy gì và quan sát gì.

Tất cả ví dụ biên dịch với Java 21+ (`maven.compiler.release` được đặt là `21`
trong `pom.xml`; Virtual Threads yêu cầu Java 21). Mọi con số đo đạc trong bài
viết này được sinh ra khi chạy các ví dụ trên một máy 12 lõi với JDK 21 — hãy
coi chúng là dữ liệu mẫu, không phải benchmark chuẩn.

**Cách đọc bài viết này:** mỗi khái niệm đều nêu tên class trong repository;
chạy nó bằng các lệnh trong khung "Try It Yourself" và so sánh quan sát của
bạn với kết quả ghi lại ở đây. Cấu trúc luôn giống nhau: một vấn đề, một trực
giác, code, điều gì thực sự xảy ra, tại sao, điều gì xảy ra bên dưới
(under the hood), đánh đổi (trade-offs), và khi nào nó quan trọng ở production.

---

## 1. Vấn đề thực sự: 10.000 Requests

Quay lại tình huống mở đầu. Một chương trình thông thường thực thi chỉ thị
**tuần tự** — một việc hoàn thành xong việc tiếp theo mới bắt đầu:

```text
Task A
  ↓
Task B
  ↓
Task C
```

Nhưng một backend thực tế hiếm khi như vậy. Tại bất kỳ thời điểm nào nó cũng
có các request ở những pha hoàn toàn khác nhau:

```text
Request A ───── chờ database
Request B ───── đang tính toán
Request C ───── chờ HTTP API
Request D ───── đang xử lý file
```

Đây là cơ hội bị bỏ phí: trong khi Request A chờ database, CPU đang rảnh. Một
chương trình tuần tự không thể bắt đầu Request B cho đến khi A hoàn thành — vậy
nên máy dành phần lớn thời gian làm không, chờ các tài nguyên bên ngoài chậm
hơn CPU hàng nghìn lần.

Một lõi CPU thực thi hàng tỷ chỉ thị mỗi giây. Một round-trip database mất
miligiây — bằng thời gian của hàng triệu chỉ thị. _Chờ đợi_ không phải sự kiện
hiếm trong backend; nó là trạng thái mặc định.

Khoảng cách giữa "CPU nhanh" và "mọi thứ còn lại chậm" chính là lý do gốc rễ
thread tồn tại. Thread cho phép một chương trình giữ CPU bận rộn với việc khác
trong khi một phần công việc của nó đang bị chặn bởi thứ gì đó chậm.

Nhưng thread mang đến một loạt vấn đề mới: tạo ra không rẻ, dùng chung bộ nhớ,
có thể làm hỏng trạng thái của nhau, và không tạo thêm sức mạnh CPU. Phần còn
lại của bài viết đi qua đánh đổi đó — từng khái niệm, cơ chế của nó, và cái
giá của nó.

---

## 2. Concurrency và Parallelism: Hai Công Cụ Khác Nhau

Trước khi nhìn vào Java, chúng ta cần sự phân biệt mà cả bài viết xây dựng
trên đó.

### 2.1. Concurrency là về cấu trúc; parallelism là về thực thi

- **Concurrency**: nhiều tác vụ cùng tiến triển trong _các khoảng thời gian
  chồng lấn_, đan xen trên cùng một CPU. Đó là cách _cấu trúc_ một chương
  trình có chờ đợi bên trong.
- **Parallelism**: nhiều tác vụ _thực thi cùng một thời điểm_ trên các lõi CPU
  khác nhau. Đó là thuộc tính của _phần cứng_ thực thi.

Một phép loại suy hữu ích và trung thực về mặt kỹ thuật: concurrency là một
đầu bếp luân phiên giữa nhiều món trên một bếp — không món nào chín nhanh hơn,
nhưng tất cả cùng tiến triển trong lúc mỗi món chờ. Parallelism là nhiều đầu
bếp nấu cùng lúc — throughput thật sự, nhưng chỉ vì có nhiều bếp.

```text
Concurrency (đan xen trên 1 lõi):
  Thread A:  |--A1--|        |--A2--|        |--A3--|
  Thread B:        |--B1--|        |--B2--|        |--B3--|

Parallelism (đồng thời trên 2 lõi):
  Core 1:    |------A1------|------A2------|
  Core 2:    |------B1------|------B2------|
```

Điểm sâu hơn: **concurrency thường là để xử lý chờ đợi, còn parallelism là để
tận dụng nhiều tài nguyên thực thi.** Nếu tác vụ của bạn không bao giờ chờ,
concurrency gần như không mua được gì — chỉ parallelism (thêm lõi) mới giúp.
Nếu tác vụ chờ nhiều, concurrency cho phép các tác vụ khác dùng khoảng thời
gian mà bạn lẽ ra lãng phí.

Concurrency không đòi hỏi nhiều lõi. Parallelism thì có. Nếu máy bạn có 4 lõi
và bạn tạo 1000 thread, nhiều nhất **4 tác vụ chạy cùng một thời điểm** — 996
cái còn lại đang chờ, ngủ, hoặc bị context-switch. **Tạo thread không tạo ra
lõi.**

### 2.2. Hai loại workload quyết định mọi thứ

Chỉ có một câu hỏi cần đặt cho bất kỳ tác vụ nào: _nó đang chờ điều gì?_

- **CPU-bound**: tác vụ dành thời gian để tính toán — parse, băm, crypto,
  nén. Tốc độ bị giới hạn bởi số lõi CPU, không phải số thread.
- **I/O-bound**: tác vụ dành phần lớn thời gian _chờ đợi_ — chờ database, một
  HTTP response, một lần đọc file. Tốc độ bị giới hạn bởi latency và
  concurrency.

```text
CPU-bound task:   [=====compute=====][=====compute=====][=====compute=====]
                  ↑ CPU là bottleneck → chỉ #cores mới quan trọng

I/O-bound task:   [wait 95ms][wait 95ms][wait 95ms]
                  [ 5ms work ][ 5ms work ][ 5ms work ]
                  ↑ 95% thời gian là chờ → thêm concurrency giúp
```

Vì sao điều này quan trọng trước cả khi nói về thread? Vì _toàn bộ_ thiết kế
concurrency của Java — thread pool, Virtual Threads, backpressure — là câu trả
lời cho thực tế I/O-bound của backend. Một request handler điển hình ở
production làm 5 ms công việc thật và 95 ms chờ đợi. CPU utilization của tác
vụ đơn lẻ đó là 5%. Bạn có thể chạy ~20 tác vụ như vậy trên một lõi trước khi
CPU bận — 19 cái còn lại gần như miễn phí trong lúc chúng chờ.

Repository dành hẳn một package để chứng minh hai phát biểu này bằng đo đạc
(Mục 10), vì chúng quyết định bạn nên tạo bao nhiêu thread.

### 2.3. Blocking: "chờ đợi" nghĩa là gì ở cấp độ thread

Một thread **bị block** khi nó không thể tiếp tục nếu không có sự kiện bên
ngoài — một lock, một `sleep()`, một query DB, một HTTP response. Một thread
bị block tiêu thụ **0** CPU (nó không được lên lịch) nhưng vẫn giữ bộ nhớ của
nó và vẫn được tính là một thread với OS scheduler.

Blocking chính là thuộc tính khiến công việc I/O-bound có thể mở rộng bằng
thread: trong khi thread A chờ DB, CPU có thể chạy thread B. Toàn bộ trò chơi
của thread pool — và sau này là Virtual Threads — là giữ CPU bận trong khi đa
số thread bị block, mà không phải trả giá quá đắt cho những thread chỉ đang
chờ.

---

## 3. Platform Thread Thực Sự Là Gì

**Repository examples:** `src/main/java/com/example/javalab/basics/CreateThreadExample.java`, `src/main/java/com/example/javalab/basics/RunnableExample.java`

Giáo trình nói thread là "một đơn vị thực thi". Điều đó cho bạn biết nó _làm
gì_, chứ không phải nó _là gì_. Bên dưới, một thread là một bó trạng thái mà
CPU có thể chuyển đến, chạy, tạm ngưng, và chuyển đi:

- **Một stack** — vùng nhớ chứa biến cục bộ và các call frame. Trong môi
  trường JVM/OS điển hình, một platform thread dành khoảng **1 MB** stack. Đây
  là chi phí bộ nhớ chiếm ưu thế của thread.
- **Một program counter** — địa chỉ chỉ thị tiếp theo sẽ thực thi.
- **Trạng thái thực thi** — các thanh ghi (general-purpose, stack pointer,
  frame pointer, instruction pointer), cộng với các cờ như "interrupted".
- **Metadata lập lịch** — độ ưu tiên, trạng thái, hàng đợi chờ, hạch toán thời
  gian CPU. Đây là thứ OS scheduler dùng để quyết định _khi nào_ chạy nó.

Điểm mấu chốt về một thread _platform_ (classic `Thread` của Java) là mối quan
hệ của nó với hệ điều hành. Về mặt khái niệm:

```text
Java Platform Thread
        │
        ▼
JVM
        │
        ▼
Native / OS Thread
        │
        ▼
Operating System Scheduler
        │
        ▼
CPU Core
```

Một platform thread ánh xạ **1:1 với một OS/native thread**: khi JVM tạo một
`Thread`, nó yêu cầu OS tạo một native thread; khi thread đó chạy, OS scheduler
quyết định nó chạy trên lõi nào. Cách triển khai chính xác thay đổi theo OS và
JVM, nhưng cấu trúc chi phí thì nhất quán, và chính cấu trúc chi phí này định
hình mọi quyết định thiết kế trong concurrency của Java:

- **Chi phí tạo lập.** Tạo một thread nghĩa là một system call vào kernel và
  cấp phát một native stack — mất miligiây, không phải nanogiây, và là một thao
  tác kernel, nên nó cạnh tranh với mọi process khác trên máy.
- **Bộ nhớ stack.** ~1 MB dành riêng cho mỗi thread. 10.000 thread ≈ 10 GB bộ
  nhớ ảo. Trong thực tế, hầu hết process chạm `OutOfMemoryError: unable to
create native thread` trước khi cạn heap.
- **Lập lịch kernel.** OS scheduler phải theo dõi mọi thread runnable. Nhiều
  thread hơn = nhiều việc cho scheduler hơn, ở mỗi context switch, mỗi timer
  tick.
- **Context switching.** Chuyển CPU từ thread này sang thread khác tốn thời
  gian CPU và phá hủy tính cục bộ của CPU cache (Mục 10).
- **Chi phí scheduler ở quy mô lớn.** Với hàng nghìn thread runnable, một phần
  lớn thời gian CPU có thể dành để _quyết định_ chạy gì và _chuyển_ sang nó,
  thay vì chạy nó.

Package `basics` minh họa cách thread được tạo và API cho bạn những gì, để các
chi phí trên là thứ bạn _cảm nhận được_ thay vì chỉ đọc về nó.

### Ví dụ: Tạo một Thread

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

**Điều gì xảy ra khi chạy:** ba thread thực thi đồng thời; mỗi thread in dòng
của nó từ chính thread của nó. **Vì sao:** mỗi `start()` tạo một native thread
mà OS scheduler chạy song song với `main`. **Bên dưới:** mỗi thread đó có stack
riêng (~1 MB dành riêng) và thanh ghi riêng; `join()` chặn `main` cho đến khi
mỗi thread kết thúc — bản thân `join()` là một thao tác blocking. **Tác động
production:** tạo một `Thread` mỗi request chính là mẫu thiết kế sụp đổ ở
10.000 request đồng thời (Mục 8). **Điểm mấu chốt:** một thread là một tài
nguyên OS thật, đắt — ba thread thì rẻ, ba nghìn thread thì không.

### Ví dụ: Runnable vs Callable

`Runnable` có `void run()` — không trả kết quả, không ném checked exception.
`Callable` có `V call()` — nó trả về một giá trị và có thể ném exception. Ví dụ
chạy một `Callable` qua một `ExecutorService` và lấy kết quả qua `Future.get()`:

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

**Bên dưới:** tác vụ được thực thi trên một worker thread; kết quả được lưu
trong `Future`. `future.get()` chặn _caller_ cho đến khi giá trị sẵn sàng — lưu
ý caller không busy-wait, OS park nó. **Tác động production:** mẫu "submit công
việc, lấy `Future`, block trên `get()`" là cách hầu hết orchestration bất đồng
bộ hoạt động; `Future` cũng là nơi exception của tác vụ âm thầm biến mất nếu
bạn không bao giờ gọi `get()` (Mục 11.5).

> **Những thứ khác được các ví dụ này bao phủ:** `join()` (chờ một thread kết
> thúc) và `sleep()` (dùng khắp nơi để mô phỏng công việc). Tên thread làm log
> dễ đọc — mọi ví dụ pool trong repository đặt tên thread bằng một
> `ThreadFactory` tùy chỉnh.

## Try It Yourself

```bash
cd java-lab
mvn clean compile
java -cp target/classes com.example.javalab.basics.CreateThreadExample
java -cp target/classes com.example.javalab.basics.RunnableExample
```

Quan sát kỳ vọng: ba dòng trong `CreateThreadExample` được in từ ba tên thread
khác nhau theo _thứ tự khác nhau ở mỗi lần chạy_. Thứ tự phi định xác đó _chính
là_ concurrency.

---

## 4. start() vs run(): Điều Gì Thực Sự Thay Đổi

**Repository example:** `src/main/java/com/example/javalab/basics/StartVsRunExample.java`

Đây là sự phân biệt quan trọng nhất cho người mới trong concurrency Java, và
lý do đằng sau nó chính là cỗ máy của Mục 3:

```java
Runnable task = () -> System.out.println("  task executed in thread: "
        + Thread.currentThread().getName());

Thread t = new Thread(task, "new-thread");

t.run();    // runs in the CALLER thread (here: 'main')
t.start();  // runs in a NEW thread (here: 'new-thread')
```

**Kết quả thực tế của ví dụ:**

```
1) t.run()   -> runs in the CALLER thread:
  task executed in thread: main
2) t.start() -> runs in a NEW thread:
  task executed in thread: new-thread
```

**Điều gì thực sự thay đổi.** Gọi `run()` chỉ là một lời gọi phương thức bình
thường. Luồng thực thi:

```text
Current Thread
     ↓
Call run() như một phương thức bình thường
     ↓
Thực thi tuần tự
```

Gọi `start()` thay đổi toàn bộ kiến trúc:

```text
Current Thread
     ↓
Yêu cầu JVM bắt đầu một thread thực thi mới
     ↓
Native thread mới được tạo và lên lịch
     ↓
JVM gọi run() trên thread mới
```

**Vì sao thứ tự in ra phi định xác.** Một khi `start()` được gọi, có hai thread
độc lập và cả hai đều _runnable_. Từ khoảnh khắc đó, developer không còn kiểm
soát hoàn toàn thứ tự thực thi: JVM và OS scheduler quyết định khi nào mỗi
thread nhận thời gian CPU, và quyết định đó phụ thuộc vào tải máy, các process
khác, ngắt timer, và chính sách của scheduler. Ngay cả trên một máy có vẻ rảnh,
bạn không thể đoán thread nào in trước.

`run()` cho bạn concurrency bằng 0, và bug vô hình vì code vẫn cho kết quả đúng
— nó chỉ chạy tuần tự trên caller. Đây là một lỗi im lặng kinh điển: code
_trông có vẻ_ concurrent nhưng thực ra không.

**Bên dưới:** `start()` thực hiện một native call tạo kernel thread, cấp phát
stack của nó, và đưa nó vào hàng đợi runnable. Chỉ sau đó OS scheduler mới nhặt
nó lên và cuối cùng cho nó thực thi `run()`. Ngược lại, `run()` không bao giờ
rời khỏi stack của caller.

**Tác động production:** `t.run()` bên trong một request handler thay vì
`t.start()` biến một fan-out "song song" thành thực thi tuần tự — latency nhân
lên theo số tác vụ. Nó cũng giải thích vì sao các bug concurrency "works on my
machine" tồn tại: cùng một code có thể hoạt động khác đi khi scheduler còn
việc khác phải làm.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.basics.StartVsRunExample
```

Quan sát kỳ vọng: `run()` luôn in tên thread của caller (`main`); `start()` in
tên thread mới (`new-thread`).

---

## 5. Vòng Đời của Thread: Vì Sao Các Trạng Thái Tồn Tại

**Repository example:** `src/main/java/com/example/javalab/basics/ThreadLifecycleExample.java`

Mỗi trạng thái thread là câu trả lời cho một câu hỏi scheduler phải trả lời:
_thread này có thể chạy ngay bây giờ không, và nếu không, nó đang chờ gì?_ Sáu
trạng thái là từ vựng của thread dump — nghĩa là hiểu chúng là một kỹ năng
debug, không phải kiến thức tò mò.

```
        ┌─────────────────────────────────────────────────────┐
        ▼                                                     │
   ┌──────────┐  start()   ┌──────────────┐                   │
   │  NEW     │────────────►│ RUNNABLE     │──────────────────►│  running on a core
   └──────────┘            └──────────────┘                   │
                            │  ▲                             │
       blocked on a lock    │  │  lock acquired              │
                            ▼  │                             │
                        ┌──────────┐                         │
                        │ BLOCKED  │                         │
                        └──────────┘                         │
                            │  ▲                             │
       wait()/join()/park   │  │  notified                   │
                            ▼  │                             │
                        ┌──────────┐                         │
                        │ WAITING  │                         │
                        └──────────┘                         │
                            │  ▲                             │
       sleep()/await(ms)    │  │  timeout/notify             │
                            ▼  │                             │
                        ┌──────────────┐                     │
                        │TIMED_WAITING │                     │
                        └──────────────┘                     │
                            │                                │
   run() returns/exits      │                                │
                            ▼                                │
                        ┌────────────┐                       │
                        │TERMINATED  │───────────────────────┘
                        └────────────┘
```

- **NEW** — đã tạo nhưng chưa gọi `start()`. Chưa có OS thread. _Nguyên nhân:_
  chưa có gì yêu cầu JVM bắt đầu thực thi.
- **RUNNABLE** — sẵn sàng chạy hoặc đang thực sự chạy. Quan trọng: **"runnable"
  không có nghĩa là "đang thực thi trên một CPU".** Một thread runnable có thể
  đang chờ trong hàng đợi run của OS để nhận thời gian CPU. Java cố ý không
  phân biệt "đang chạy" với "sẵn sàng": quyết định đó thuộc về OS scheduler,
  thứ Java không nhìn thấy được.
- **BLOCKED** — chờ giành một `synchronized` monitor đang bị thread khác giữ.
  Thread không thể tiếp tục _vì nó cần truy cập độc quyền_.

  ```text
  Thread A owns Lock
          ↓
  Thread B needs same Lock
          ↓
  Thread B không thể tiếp tục
          ↓
  BLOCKED
  ```

- **WAITING** — thread _cố ý_ tạm dừng chính nó để chờ một thread khác hành
  động: `Object.wait()` không timeout, `Thread.join()`, `LockSupport.park()`.
  Nó chờ một _tín hiệu_, không phải thời gian CPU.
- **TIMED_WAITING** — giống trên, nhưng có hạn chót: `Thread.sleep()`,
  `join(millis)`, `await(timeout, unit)`. Khác WAITING ở chỗ OS có thể đánh
  thức nó bằng timer.
- **TERMINATED** — `run()` đã trả về hoặc ném exception. Thread đã chết; không
  thể khởi động lại.

Ví dụ tạo ra từng trạng thái theo yêu cầu: một thread thứ hai block trên một
`synchronized` monitor do `main` giữ (→ `BLOCKED`), worker gọi `LOCK.wait(300)`
(→ `TIMED_WAITING`) rồi `LOCK.wait()` (→ `WAITING`), và cuối cùng `join()` phơi
bày `TERMINATED`. Vì timing chính xác là phi định xác, ví dụ _poll_ cho đến khi
mỗi trạng thái kỳ vọng xuất hiện (có timeout) thay vì dựa vào sleep.

**Kết quả thực tế (rút gọn):**

```
1) NEW         state = NEW
2) RUNNABLE    state = RUNNABLE  (running or ready - Java does not distinguish)
3) BLOCKED     state = BLOCKED  (waiting for synchronized monitor held by main)
4) TIMED_WAITING state = TIMED_WAITING  (LOCK.wait(300) / Thread.sleep)
5) WAITING     state = WAITING  (LOCK.wait() - parked until notify)
6) TERMINATED  state = TERMINATED
```

**Tác động production — đọc thread dump.** Một bản dump `jstack`/`jcmd
Thread.print` là bức ảnh chụp các trạng thái này, và mỗi trạng thái chỉ về một
lớp vấn đề khác nhau:

- Nhiều thread `BLOCKED` → tranh chấp synchronized lock; tìm monitor trong
  stack trace, tìm ai đang giữ nó. Cách sửa thường là bớt tranh chấp (critical
  section nhỏ hơn, lock striping) hoặc một cấu trúc khác.
- Đống `WAITING`/`TIMED_WAITING` trên `park` → hàng đợi pool, future, hoặc
  thread pool đang rảnh; nếu chúng _đang tăng_, pool đang ứ đọng.
- Vô số `RUNNABLE` → CPU bão hòa: máy là bottleneck.

**Điểm mấu chốt:** các trạng thái không phải sổ sách — chúng cho bạn biết một
thread đang chờ CPU, chờ lock, hay chờ sự kiện, và mỗi câu trả lời dẫn đến một
chẩn đoán production khác nhau.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.basics.ThreadLifecycleExample
```

Quan sát kỳ vọng: cả sáu trạng thái được in theo thứ tự. Lưu ý điểm mẫu
`RUNNABLE` chính xác thay đổi theo từng lần chạy — state machine thì cố định,
_timing_ thì không.

---

## 6. Race Condition: Khoa Học Đằng Sau count++

**Repository example:** `src/main/java/com/example/javalab/synchronization/RaceConditionExample.java`

### Vấn đề

Nhiều thread dùng chung mutable state. Phép đột biến dùng chung đơn giản nhất
có thể — tăng một biến đếm — đã hỏng. Không phải "thi thoảng hỏng": hỏng theo
cách vô hình cho đến khi có tải production, và lúc đó vô cùng bực bội vì lỗi
mang tính thống kê, không phải logic.

### Code

```java
public class RaceConditionExample {

    private int count;                    // shared mutable state, NO synchronization

    public void increment() {
        count++;                          // read-modify-write: NOT atomic
    }
    // ...
}
```

Tám thread gọi `increment()` 50.000 lần mỗi thread — kết quả kỳ vọng là
400.000. Ví dụ chạy năm lần (trials) và in kết quả thực tế.

### Điều gì xảy ra khi chạy

**Kết quả thực tế của ví dụ:**

```
Trial 1: expected=400000 actual=84596 (<-- WRONG: increments lost)
Trial 2: expected=400000 actual=136178 (<-- WRONG: increments lost)
Trial 3: expected=400000 actual=98973 (<-- WRONG: increments lost)
Trial 4: expected=400000 actual=60526 (<-- WRONG: increments lost)
Trial 5: expected=400000 actual=400000 (correct this time)
```

### Vì sao xảy ra: tách nhỏ thao tác

`count++` trông như một câu lệnh. Nó là ba thao tác:

```text
Read count
   ↓
Add 1
   ↓
Write count
```

Giờ đan xen hai thread — mỗi thread tự thực hiện Read/Add/Write:

```text
Time ──────────────────────────────────────►

Thread A: Read ─── Add ─── Write
Thread B:      Read ─── Add ─── Write

Thread A đọc: 0
Thread B đọc: 0        ← cả hai đều thấy giá trị CŨ

Thread A tính: 1
Thread B tính: 1       ← cả hai cùng tính ra kết quả giống nhau

Thread A ghi: 1
Thread B ghi: 1        ← một lần tăng đã bị mất

Kỳ vọng: 2
Thực tế: 1
```

**Vì sao nó phi định xác:** việc các interleaving có va chạm hay không phụ
thuộc vào lập lịch, trạng thái JIT, và tải máy. Trial 5 tình cờ đúng — đó chính
là lý do những bug này vượt qua code review và nổ tung ở production. Code biên
dịch, chạy, và _thi thoảng_ cho kết quả đúng.

### Vấn đề sâu hơn: ba sự đảm bảo riêng biệt

Lập trình concurrent khó vì "làm cho nó đúng" thực ra nghĩa là "thiết lập ba
sự đảm bảo riêng biệt", và **giải pháp cho một cái không giải quyết được hai
cái kia**:

- **Atomicity** — một thao tác chạy như một đơn vị không thể chia cắt; không
  thread nào có thể quan sát nó đang dở dang. Bị phá vỡ bởi `count++` (nó là
  ba bước). Được sửa bởi `synchronized`, `Atomic*`, lock.
- **Visibility** — một lần ghi của thread A có thể không bao giờ được thread B
  thấy, vì mỗi thread có thể cache giá trị trong thanh ghi hoặc CPU-local
  cache. Lần ghi không tự động được đẩy ra bộ nhớ dùng chung.
- **Ordering** — JIT compiler và CPU có thể sắp xếp lại chỉ thị miễn là ngữ
  nghĩa đơn luồng được giữ. Code trông có thứ tự trong source có thể thực thi
  theo thứ tự khác trên một lõi khác.

### Java Memory Model: mô hình tư duy bạn cần

JMM là hợp đồng định nghĩa khi nào các thread có thể quan sát lần ghi của nhau.
Bạn không cần toàn bộ đặc tả — bạn cần mô hình tư duy thực dụng:

```text
Thread A has a view of shared state
Thread B has a view of shared state

Without correct synchronization,
changes are not necessarily observed
in the way developers expect.
```

Mỗi thread hoạt động trên "tầm nhìn" của riêng nó (thanh ghi + CPU cache) và
JMM định nghĩa chính xác hành động nào buộc các tầm nhìn đó được hợp nhất:
đọc/ghi `volatile`, khối `synchronized`, thao tác `Atomic*`, và một vài thứ
khác. Các hành động này tạo ra các cạnh **happens-before** — cách nói trang
trọng cho "mọi thứ thread A làm trước khi nhả lock đều hiển thị với thread B
sau khi nó giành được cùng lock đó".

Đó là lý do ví dụ này không phải điều tò mò: mọi race trong production bạn
từng debug đều là cùng một kiểu lỗi — mutable state dùng chung bị đột biến mà
thiếu sự đồng bộ tạo ra visibility và atomicity. "Works on my machine" là JMM
đang làm việc của nó _quá tốt_ trên một máy tải nhẹ.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.synchronization.RaceConditionExample
```

Quan sát kỳ vọng: hầu hết các trial cho actual count thấp xa 400.000; thi
thoảng một trial đúng. Không bao giờ tin một lần chạy duy nhất.

---

## 7. Synchronization: Vì Sao Các Cách Sửa Hoạt Động

Package `synchronization` chứa bốn cách sửa cộng với "kẻ nói thật" `volatile`.
Mỗi cách sửa thiết lập các đảm bảo của JMM qua một cơ chế khác nhau — và mỗi
cách có đánh đổi riêng.

### 7.1. synchronized: mutual exclusion + visibility

**Repository example:** `src/main/java/com/example/javalab/synchronization/SynchronizedExample.java`

```java
public class SynchronizedExample {

    private int count;

    public synchronized void increment() {
        count++;
    }
}
```

**Cơ chế:** monitor `synchronized` cho thread _quyền sở hữu độc quyền_ đối với
critical section. Chỉ một thread có thể ở bên trong tại một thời điểm:

```text
Chỉ một thread vào critical section
            ↓
Shared state được đột biến an toàn
            ↓
Lock được nhả
            ↓
Một thread khác có thể vào
```

Nó thiết lập cả hai đảm bảo cùng lúc: **mutual exclusion** (atomicity — thao
tác read-modify-write không thể đan xen) và **visibility** (việc nhả monitor
tạo một cạnh happens-before: mọi thứ được ghi bên trong khối đều hiển thị với
thread tiếp theo bước vào).

Cùng workload 8×50.000 giờ luôn đúng: cả ba trial in
`actual=400000 (correct)`.

**Các đánh đổi — vì sao không synchronized mọi thứ?**

- **Lock contention.** Nếu nhiều thread cùng đập vào một monitor, chúng _xếp
  hàng_. Mỗi thread trượt lock phải bị deschedule và reschedule — đó là một
  context switch, cộng thêm việc cho scheduler. Dưới contention nặng, code trở
  nên hiệu quả là đơn luồng: lock tuần tự hóa mọi thứ.
- **Kích thước critical section.** Section càng lớn, thread càng lâu chờ bên
  ngoài nó. Cách sửa thường là critical section _nhỏ hơn_ — chỉ giữ lock cho
  thao tác đột biến, không phải cả phương thức.
- **Không có timeout.** `synchronized` không thể hết hạn: một thread giữ lock
  mãi mãi sẽ chặn mọi người khác mãi mãi. Không có cách "bỏ cuộc".
- **Không công bằng.** Monitor mặc định không fair: dưới contention liên tục,
  một thread chờ có thể bị bỏ đói (Mục 11.2).

Quy tắc rút ra: đồng bộ vùng nhỏ nhất có thể bảo vệ invariant — và ưu tiên
immutable state cùng `Atomic*` khi thao tác cập nhật đơn giản.

### 7.2. AtomicInteger: atomicity nhờ phần cứng, không blocking

**Repository example:** `src/main/java/com/example/javalab/synchronization/AtomicIntegerExample.java`

```java
public class AtomicIntegerExample {

    private final AtomicInteger count = new AtomicInteger();

    public void increment() {
        count.incrementAndGet();
    }
}
```

**Cơ chế — CAS, về mặt khái niệm.** `AtomicInteger` dựa trên compare-and-swap
(CAS): một chỉ thị của bộ xử lý thực hiện nguyên tử "nếu giá trị vẫn là X, thay
nó bằng Y; cho tôi biết tôi có thành công không". JVM biên dịch
`incrementAndGet()` thành một vòng CAS: đọc giá trị, tính giá trị mới, CAS;
nếu một thread khác đổi giá trị ở giữa chừng, CAS thất bại và vòng lặp thử lại.

```text
Thread A: read 5 → compute 6 → CAS(5 → 6)? yes → done
Thread B: read 5 → compute 6 → CAS(5 → 6)? no (A won) → retry with 6 → CAS(6 → 7)? yes
```

Hai hệ quả quan trọng:

- **Nó không blocking.** Thread thua cuộc đua không ngủ — nó thử lại ngay lập
  tức. Không context switch, không deschedule. Dưới contention nhẹ, nó rẻ hơn
  nhiều so với `synchronized`.
- **Nó đúng mà không cần block**, vì bản thân chỉ thị CAS là nguyên tử ở mức
  phần cứng (với một fallback của JVM khi phần cứng không hỗ trợ). Cơ chế chính
  xác do cách triển khai quyết định, nhưng về khái niệm: _phần cứng là cái
  lock_.

Ví dụ cũng in các thao tác hữu ích khác
(`get()`, `getAndIncrement()`, `addAndGet(n)`, `compareAndSet(exp, upd)`).

**Vì sao AtomicInteger không thay thế được mọi critical section.** Một biến
atomic bảo vệ _một_ giá trị. Nếu một thao tác liên quan:

- kiểm tra nhiều giá trị,
- sửa đổi nhiều đối tượng,
- duy trì một invariant trải qua nhiều field,

thì một biến atomic không đủ. Ví dụ: chuyển tiền giữa hai tài khoản cần cả hai
số dư thay đổi nguyên tử; hai `AtomicLong` riêng biệt có thể bị quan sát giữa
chừng của lần chuyển. Với invariant phức hợp, bạn cần `synchronized` hoặc một
lock — đó chính là mục đích của mutual exclusion.

### 7.3. ReentrantLock: kiểm soát, timeout, và quy tắc finally

**Repository example:** `src/main/java/com/example/javalab/synchronization/LockExample.java`

`ReentrantLock` tồn tại vì `synchronized` cố ý tối giản: không timeout, không
kiểm soát fairness, không conditions, không cách kiểm tra khả dụng mà không
block. `ReentrantLock` bổ sung tất cả:

- **lock/unlock tường minh** — lock là một đối tượng riêng với vòng đời bạn
  kiểm soát.
- **`tryLock(timeout)`** — thử giành và bỏ cuộc sau một hạn chót. Đây là phòng
  thủ đầu tiên chống deadlock: một thread không giành được lock trong một giây
  có thể làm việc khác thay vì chờ mãi mãi.
- **Fairness** — `new ReentrantLock(true)` phục vụ người chờ theo thứ tự FIFO,
  ngăn starvation với cái giá là một chút throughput.
- **Conditions** — đánh thức chính xác: một thread có thể chờ một điều kiện cụ
  thể và chỉ được tín hiệu khi nó đúng.
- **Reentrancy** — cùng một thread có thể giành lại lock, điều cần thiết cho
  các phương thức gọi lẫn nhau trong khi đang giữ lock.

Ví dụ minh họa một counter được lock bảo vệ (luôn đúng) và mẹo mấu chốt:

```java
boolean acquired = held.tryLock(1, TimeUnit.SECONDS);
// thread B holds the lock for 3 s: main gives up after 1 s instead of blocking
```

**Kết quả thực tế:** `tryLock = false (main did NOT wait for the holder - it moved on)`.
Với `synchronized`, tình huống tương tự sẽ block cho đến khi người giữ nhả.

**Mối nguy — quy tắc finally.** Vì việc unlock là tường minh, nó có thể bị bỏ
qua:

```text
lock()
  ↓
Exception
  ↓
unlock() không bao giờ xảy ra
```

Một lock không bao giờ được nhả sẽ chặn mọi thread khác mãi mãi. Quy tắc: giành,
dùng, và nhả trong `finally` — luôn luôn.

```java
lock.lock();
try {
    // critical section
} finally {
    lock.unlock();   // even when the body throws
}
```

**Đánh đổi với synchronized:** `ReentrantLock` linh hoạt hơn nhưng dễ sai hơn
(quên unlock, bỏ sót reentrancy); `synchronized` an toàn bởi thiết kế (việc nhả
xảy ra tự động khi thoát) nhưng kém linh hoạt. Ưu tiên `synchronized` cho các
section đơn giản; dùng `ReentrantLock` khi bạn cần timeout, fairness, hoặc
conditions.

### 7.4. volatile: visibility, KHÔNG PHẢI atomicity

**Repository example:** `src/main/java/com/example/javalab/synchronization/VolatileExample.java`

Ví dụ này chứng minh hai điểm bằng những con số cứng.

**Phần A — `volatile int count; count++` vẫn KHÔNG nguyên tử:**

```java
private volatile int count;     // volatile: visible, but STILL not atomic

public void increment() {
    count++;                    // still READ+ADD+WRITE: racy despite volatile
}
```

**Kết quả thực tế:**

```
Part A - volatile int count++; does it stay atomic?

expected=400000 actual=191212 (<-- WRONG)
```

`volatile` chỉ đảm bảo visibility và ordering — mọi lần đọc thấy lần ghi gần
nhất. Thao tác read-modify-write ba bước vẫn có thể đan xen giữa các thread.
**Đừng tin rằng `volatile` làm phép tăng thread-safe — nó không.**

**Phần B — một flag không volatile có thể không bao giờ được thấy.** Một worker
lặp trên một `boolean keepRunning` thường trong khi `main` đặt nó thành `false`
sau 200 ms. JIT có thể nâng field ra khỏi vòng lặp (compiler quan sát thấy nó
không bao giờ được ghi _bên trong vòng lặp_ và được phép giả định ngữ nghĩa đơn
luồng), nên lần ghi không bao giờ được quan sát. Phần này cố ý phi định xác —
trong lần chạy ghi lại, nó tái hiện 0 trên 3 trials, trong khi cửa thoát (một
`volatile boolean forceStop`) dừng worker ngay lập tức mọi lần. Ví dụ luôn kết
thúc, và thông điệp in ra của nó là quy tắc kinh nghiệm:

> `volatile` cho flag và trạng thái; `AtomicInteger`/`AtomicLong` cho bộ đếm và
> shared state; `synchronized`/lock cho critical section phức tạp.

**Vì sao có sự phân chia này:** mỗi công cụ trả lời một câu hỏi khác nhau từ
Mục 6. `volatile` trả lời "lần ghi của tôi có được thấy không?" `Atomic*` trả
lời "read-modify-write của tôi có thể chia cắt không?" Lock trả lời cả hai, cộng
thêm "tôi có thể bảo vệ một invariant phức hợp không?" — với cái giá là blocking.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.synchronization.RaceConditionExample
java -cp target/classes com.example.javalab.synchronization.SynchronizedExample
java -cp target/classes com.example.javalab.synchronization.AtomicIntegerExample
java -cp target/classes com.example.javalab.synchronization.LockExample
java -cp target/classes com.example.javalab.synchronization.VolatileExample
```

Quan sát kỳ vọng: counter hỏng mất increment; cả ba cách sửa luôn đúng;
`VolatileExample` Phần A mất increment ngay cả trên field `volatile`, và bug
visibility của Phần B có thể có hoặc không tái hiện trong lần chạy của bạn.

---

## 8. Thread Pool: Vấn Đề Chúng Giải Quyết

**Repository example:** `src/main/java/com/example/javalab/threadpool/FixedThreadPoolExample.java`

### Vấn đề: một thread cho mỗi tác vụ không mở rộng được

Thiết kế ngây thơ cho 10.000 request đồng thời là:

```text
Incoming Tasks
     ↓
Create OS Thread
     ↓
Create OS Thread
     ↓
Create OS Thread
     ↓
...
```

Nhớ lại cấu trúc chi phí của Mục 3: mỗi thread là một thao tác kernel, một stack
~1 MB, và một mục trong sổ sách của scheduler. Tạo một thread mỗi tác vụ nghĩa
là:

- **Latency tạo lập** trên mọi request (miligiây mỗi thread, tuần tự qua
  kernel).
- **Bộ nhớ** tăng theo tốc độ request: 10.000 request đồng thời ≈ 10 GB stack.
- **Scheduler hỗn loạn**: với nhiều thread runnable hơn số lõi, CPU dành nhiều
  thời gian chuyển đổi giữa các thread hơn là làm việc.
- **Không có chặn trên**: không gì ngăn số thread tăng cho đến khi
  `OutOfMemoryError: unable to create native thread`.

### Giải pháp: pool như một cơ chế quản lý tài nguyên

Thread pool thường được mô tả là "tái sử dụng thread". Điều đó nói chưa đủ. Một
thread pool là một **cơ chế quản lý tài nguyên** với bốn công việc:

- **Tái sử dụng tài nguyên thực thi đắt đỏ** — worker được tạo một lần và sống
  nhiều năm; tác vụ thì rẻ để nộp.
- **Kiểm soát concurrency** — số worker là trần cứng cho số tác vụ chạy cùng
  lúc. Đây là "núm vặn" concurrency.
- **Giới hạn tiêu thụ tài nguyên** — worker có chặn × queue có chặn = bộ nhớ có
  chặn, bất kể tốc độ tác vụ đến.
- **Quản lý quá tải** — khi pool bão hòa, _một điều được định nghĩa_ xảy ra
  (xếp hàng, từ chối) thay vì âm thầm cấp phát tài nguyên không giới hạn cho
  đến khi JVM chết.

```text
Tasks
  │
  ▼
Queue
  │
  ▼
Worker Pool
 ┌───────────────┐
 │ Worker 1      │
 │ Worker 2      │
 │ Worker 3      │
 └───────────────┘
```

### Ví dụ: Fixed Thread Pool

`Executors.newFixedThreadPool(3)` với một `ThreadFactory` có tên chạy 10 tác
vụ. Phần "inside the box" được in bởi ví dụ nêu sự thật mấu chốt:

```
newFixedThreadPool(3) == ThreadPoolExecutor(3, 3, 0L,
    TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>())
Because the queue is UNBOUNDED, the pool can never grow
beyond 3 threads and can never reject a task - tasks just
pile up in memory.
```

**Kết quả thực tế:** tasks 1–10 đều chạy trên `fixed-worker-1..3` — worker được
tái sử dụng. Một pool "fixed" cố định chính xác vì queue không chặn của nó
không bao giờ buộc pool phải lớn lên.

**Bên dưới:** `Executors.newFixedThreadPool(n)` là phím tắt cho
`ThreadPoolExecutor(n, n, 0L, MILLISECONDS, new LinkedBlockingQueue<>())` —
constructor là API thật, các phương thức factory chỉ là đường cát. Hãy chú ý
điều phím tắt che giấu: một queue **không chặn**. Một chi tiết duy nhất đó quyết
định hành vi của pool dưới quá tải (Mục 9).

**Tác động production:** các phím tắt `Executors` mặc định là nguồn sự cố
production đã biết — `newFixedThreadPool` và `newSingleThreadExecutor` xếp hàng
không giới hạn (bộ nhớ tăng trưởng), `newCachedThreadPool` tạo một thread mỗi
tác vụ (không chặn trên số thread). Pool production được dựng bằng constructor
đầy đủ của `ThreadPoolExecutor` để mọi núm vặn đều tường minh và mọi tài nguyên
đều có chặn.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.threadpool.FixedThreadPoolExample
```

Quan sát kỳ vọng: cả 10 tác vụ chạy trên 3 worker được tái sử dụng; ghi chú
"inside the box" được in giải thích vì sao một fixed pool là cố định.

---

## 9. Đường Ống: Core, Queue, Max, Rejection

**Repository examples:** `src/main/java/com/example/javalab/threadpool/ThreadPoolExecutorExample.java`, `src/main/java/com/example/javalab/threadpool/BoundedQueueExample.java`, `src/main/java/com/example/javalab/threadpool/RejectedExecutionExample.java`, `src/main/java/com/example/javalab/practical/GracefulShutdownExample.java`

### Quy trình quyết định cho mỗi tác vụ mới

`ThreadPoolExecutor` không nhận một tác vụ theo cách bạn có thể kỳ vọng ("nếu
một worker rảnh thì chạy; nếu không thì xếp hàng"). Nó tuân theo một thuật toán
bốn bước cố định, và **thứ tự của các bước chính là thiết kế**:

```text
New Task
   │
   ├── Ít hơn số core threads?
   │        └── Tạo worker
   │
   ├── Queue còn chỗ?
   │        └── Đưa tác vụ vào queue
   │
   ├── Ít hơn số maximum threads?
   │        └── Tạo thêm worker
   │
   └── Nếu không
            └── Từ chối tác vụ
```

Điểm tinh tế mấu chốt: **queue được hỏi ý kiến _trước khi_ pool lớn lên quá
core size.** Pool ưu tiên đệm công việc trong queue, và chỉ tạo thêm worker khi
queue đầy. Hệ quả: với queue không chặn, `maximumPoolSize` là cấu hình chết —
pool không bao giờ lớn hơn core size, và tác vụ chất đống trong bộ nhớ mãi mãi.
**Tăng `maximumPoolSize` không nhất thiết tăng concurrency khi dùng queue không
chặn.**

Ví dụ cấu hình mọi núm vặn — core=2, max=4, queue có chặn dung lượng 2,
`AbortPolicy` — và log `poolSize`/`queueSize` sau mỗi lần submit:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        2,                                    // corePoolSize
        4,                                    // maximumPoolSize
        30, TimeUnit.SECONDS,                 // keepAliveTime
        new ArrayBlockingQueue<>(2),          // BOUNDED work queue
        runnable -> new Thread(runnable, "pool-thread-" + threadCounter.getAndIncrement()),
        new ThreadPoolExecutor.AbortPolicy());
```

**Kết quả thực tế (màn trình diễn đang hoạt động):**

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

Quan sát thứ tự: tasks 1–2 chạm vào core threads; tasks 3–4 vào queue; pool chỉ
lớn lên quá core size **sau khi** queue đầy (tasks 5–6); một khi queue đầy _và_
đạt max, `AbortPolicy` ném exception.

**Vì sao thứ tự này quan trọng:** queue là _bộ đệm_ của pool — nó hấp thụ các
đợt bùng nổ ngắn. Core threads là công suất _ổn định_; các thread thêm (core→max)
là công suất _bùng nổ_, chỉ tham gia khi bộ đệm tràn. Thuật toán cố ý ưu tiên
đệm hơn là sinh thread, vì worker thread là tài nguyên đắt; một ô trong queue thì
rẻ.

### Backpressure: một queue không loại bỏ quá tải

Đây là ý tưởng mấu chốt của cả phần:

> **Một queue không loại bỏ quá tải. Nó cất quá tải vào một nơi nào đó.**

Queue không chặn không từ chối gì — nó làm quá tải _vô hình_ cho đến khi quá
muộn:

```text
Unbounded Queue
     ↓
Nhiều tác vụ chờ hơn
     ↓
Nhiều bộ nhớ tiêu thụ hơn
     ↓
Latency dài hơn
     ↓
Áp lực GC
     ↓
Hỏng hóc tiềm tàng (OOM / tổng đình trệ)
```

`BoundedQueueExample` chứng minh sự khác biệt với hai pool giống hệt nhau
(core=2/max=4) và 6 tác vụ ngủ — khác biệt duy nhất là loại queue:

```
A) UNBOUNDED queue (LinkedBlockingQueue) - what newFixedThreadPool uses
   -> poolSize=2 queueSize=4 (max=4 was NEVER reached!)

B) BOUNDED queue (ArrayBlockingQueue capacity=2)
   -> poolSize=4 queueSize=2 (pool grew to 4)
```

Với queue không chặn, `maximumPoolSize` không bao giờ kích hoạt — queue _chính
là_ giới hạn thật, và tác vụ tích tụ trong bộ nhớ. Queue có chặn buộc pool kích
hoạt các thread thêm, rồi đến rejection policy. **Queue có chặn là cách pool
tham gia vào backpressure:** nó chỉ đệm được một lượng nhất định, và quá mức đó
người sản xuất bị nói "không".

### Rejection policies: "không" nghĩa là gì

Khi pool bão hòa, rejection policy quyết định điều gì xảy ra với tác vụ. Ví dụ
chạy cùng chuỗi (core=1, max=2, queue dung lượng 1, bốn lần submit) với
`AbortPolicy` và `CallerRunsPolicy`:

```
1) AbortPolicy (default):
   -> submit 4: REJECTED: RejectedExecutionException
   tasks actually executed: 2

2) CallerRunsPolicy:
   -> submit 4: accepted
   tasks actually executed: 4
```

| Policy                   | Hành vi                                 | Dùng khi                                 |
| ------------------------ | --------------------------------------- | ---------------------------------------- |
| `AbortPolicy` (mặc định) | Ném `RejectedExecutionException`        | Fail nhanh; caller tự xử lý              |
| `CallerRunsPolicy`       | Tác vụ chạy **trong thread của caller** | Backpressure tự nhiên: producer chậm lại |
| `DiscardPolicy`          | Lặng lẽ bỏ tác vụ                       | Không bao giờ — mất dữ liệu im lặng      |
| `DiscardOldestPolicy`    | Bỏ tác vụ cũ nhất trong queue           | Chỉ cho công việc cũ/rời rạc theo cửa sổ |

**Bên dưới `CallerRunsPolicy`:** chính thread đang submit tự thực thi tác vụ,
nên producer tự động chậm lại theo tốc độ của consumer — cơ chế từ chối _chính
là_ cơ chế backpressure. Đây là lý do nó được ưa chuộng ở production: thay vì
ném lỗi, hệ thống tự tiết lưu.

### Tắt pool: vòng đời bạn không được bỏ qua

Thread của pool là non-daemon theo mặc định: một pool không bao giờ được tắt sẽ
giữ JVM sống mãi — trong một application server điều đó có chủ đích (pool sống
cả vòng đời ứng dụng), nhưng trong một batch job hay một bài test thì đó là một
leak treo process. Trình tự tắt đúng, được minh họa với 8 tác vụ × 2 s trên 3
thread và hạn chót 800 ms:

```java
pool.shutdown();                 // 1) stop accepting new tasks
boolean finished = pool.awaitTermination(800, TimeUnit.MILLISECONDS);  // 2) deadline
if (!finished) {
    List<Runnable> dropped = pool.shutdownNow();   // 3) interrupt + drop queue
    System.out.println("dropped " + dropped.size() + " queued task(s).");
}
pool.awaitTermination(5, TimeUnit.SECONDS);        // 4) wait for cleanup
```

**Kết quả thực tế:** `shutdownNow()` bỏ 5 tác vụ trong queue và interrupt 3
worker đang chạy (`started=3 interrupted=3`). Tác vụ cư xử tốt bắt
`InterruptedException` và dọn dẹp trước khi thoát.

**Vì sao chuỗi ba pha tồn tại:** `shutdown()` chặn _đầu vào_ — không nhận tác vụ
mới, nhưng công việc trong queue vẫn chạy. `awaitTermination(deadline)` cho công
việc đang dang dở một cơ hội. `shutdownNow()` interrupt _đầu ra_ — tác vụ đang
chạy nhận cờ interrupt, tác vụ trong queue bị trả về. Một tác vụ cư xử tốt coi
interrupt như "hệ thống đang tắt: giải phóng socket, roll back, thoát". Tôn
trọng cờ interrupt là thứ làm graceful shutdown hoạt động ở production
(Spring/Quarkus gọi trình tự này giúp bạn).

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.threadpool.ThreadPoolExecutorExample
java -cp target/classes com.example.javalab.threadpool.BoundedQueueExample
java -cp target/classes com.example.javalab.threadpool.RejectedExecutionExample
java -cp target/classes com.example.javalab.practical.GracefulShutdownExample
```

Quan sát kỳ vọng: các lần submit 7–9 bị từ chối trong `ThreadPoolExecutorExample`
(điều đó là tất định — các worker vẫn bận); queue không chặn không bao giờ làm
pool lớn lên; `CallerRunsPolicy` thực thi cả 4 tác vụ; `GracefulShutdownExample`
in cùng tỷ lệ 3/3/5.

---

## 10. Hiệu Năng: Khi Thêm Thread Làm Mọi Thứ Chậm Hơn

**Repository examples:** `src/main/java/com/example/javalab/performance/CpuBoundThreadExample.java`, `src/main/java/com/example/javalab/performance/IoBoundThreadExample.java`, `src/main/java/com/example/javalab/performance/TooManyThreadsExample.java`

### Cơ chế: một context switch tốn những gì

Một platform thread chạy trên một lõi một lúc, rồi scheduler đổi nó ra để chạy
một thread runnable khác. Sự đổi chỗ đó gọi là **context switch**, và nó không
miễn phí:

```text
Context switch
   │
   ├── Lưu trạng thái thread A (thanh ghi, PC, stack pointer)
   ├── Sổ sách của scheduler (run queue, độ ưu tiên)
   ├── Ô nhiễm CPU cache / TLB (dữ liệu của thread mới đẩy ra dữ liệu của A)
   └── Khôi phục trạng thái thread B và tiếp tục nó
```

Trên một máy có ít lõi hơn số thread runnable, CPU dành một phần trăm chu kỳ
của nó cho việc chuyển đổi thay vì làm việc — chi phí đó **vô hình cho đến khi
được đo**. Tệ hơn, ô nhiễm cache là siêu tuyến tính: một thread có dữ liệu từng
ở L2/L3 phải tải lại từ bộ nhớ, chậm gấp 50–100 lần một cache hit.

Nguyên tắc đầu tiên rút ra:

> **Số thread đúng là con số giữ cho các lõi bận — không bao giờ mù quáng thêm
> thread để nhanh hơn.**

### CPU-bound: parallelism bị chặn bởi số lõi

**Repository example:** `CpuBoundThreadExample`

Công việc không bao giờ block — tính toán thuần túy — chỉ có thể dùng số lõi
hiện có. Mỗi tác vụ thực hiện 25 triệu phép toán số nguyên; ví dụ chạy cùng
workload với 1, 12, 48 và 192 thread trên một máy 12 lõi.

**Kết quả thực tế (12 lõi, JDK 21):**

```
12 threads:  ~49 ms    <- sweet spot
1 thread:    ~262 ms
48 threads:  ~52 ms
192 threads: ~49 ms
```

**Kết quả thực tế (24 lõi, JDK 21):**

```
24 threads:  ~57 ms    <- sweet spot
1 thread:    ~250 ms
96 threads:  ~53 ms
384 threads: ~53 ms
```

**Những con số nói gì:** đi từ 1 → 12 thread cho toàn bộ lợi ích parallelism
(5× ở đây — thấp hơn 12× vì băng thông bộ nhớ dùng chung, tranh chấp bộ nhớ và
chi phí scheduler). Quá 12 thread, workload không nhanh hơn: nó không thể. Số
lõi là trần. Trên một máy 12 lõi, pool "nên được đặt cỡ ~12 cho CPU-bound" — lần
chạy ghi lại xác nhận điều đó.

**Mẫu này không phải ngẫu nhiên:** công việc CPU-bound chỉ mở rộng đến số lõi,
rồi nằm ngang — và sau đó _suy thoái_ khi chi phí chuyển đổi tăng. Đây là lý do
tồn tại quy tắc kinh nghiệm về cỡ pool:

> CPU-bound: `cores` (thường là `cores + 1` để bù trục trặc).
> I/O-bound: nhiều thread hơn lõi rất nhiều — nhưng con số chính xác phụ thuộc
> vào tỷ lệ blocking (Mục 2.2): `cores × (1 + wait/calculate)`.

### I/O-bound: thread rẻ, chờ đợi đắt

**Repository example:** `IoBoundThreadExample`

Ví dụ mô phỏng công việc I/O-bound với 50 ms ngủ mỗi tác vụ. Tỷ lệ blocking
cực cao: 25 ms tính + 50 ms chờ = 2/3 thời gian chờ. Máy có 12 lõi — và số
thread tối ưu gấp ~10 lần thế.

**Kết quả thực tế (12 lõi, JDK 21):**

```
1 thread:   ~5991 ms  (~20 tasks/s)
12 threads: ~503 ms   (~239 tasks/s)
96 threads: ~101 ms   (~1188 tasks/s)
120 threads:~67 ms    (~1791 tasks/s)   <- best
```

**Những con số nói gì:** 120 thread đánh bại 12 thread ~7× trên máy 12 lõi. Mỗi
thread dành phần lớn thời gian ngủ (bị block, tiêu thụ 0 CPU); 12 lõi là đủ để
chạy các chùm tính toán nhỏ, và các thread thêm chỉ lấp các khoảng trống giữa
các giấc ngủ. Concurrency gấp ~10 lần số lõi vì tỷ lệ blocking.

**Tác động production:** định cỡ một pool I/O không phải "chọn một con số lớn".
Con số là `cores × (1 + wait/calculate)` — và `wait` là biến _duy nhất bạn kiểm
soát được_. Đổi lời gọi API từ 50 ms thành 5 s và cỡ pool đúng nhảy lên 100×.
Xem lại cỡ pool khi latency thay đổi.

### Quá nhiều thread: ca đo được

**Repository example:** `TooManyThreadsExample`

Ví dụ này đo việc oversubscription _thực sự_ làm gì. 4, 64, 400 và 800 platform
thread mỗi cái quay trên CPU 1,5 giây đồng hồ trên một máy 12 lõi.

**Kết quả thực tế (12 lõi, JDK 21):**

```
4 threads:   ~1089 ms
64 threads:  ~167 ms
400 threads: ~212 ms
800 threads: ~205 ms
```

**Những con số nói gì:** 4 thread hoàn thành trong 1,09 s (0,4 s là chi phí
chuyển đổi và lập lịch thuần); 64 thread nhanh hơn — nhưng 400 thread _chậm
hơn_ 64 (167 ms → 212 ms), và 800 thread không hồi phục. Các thread thêm không
thêm công việc — CPU đã dùng hết ở 64; chúng thêm _chi phí chuyển đổi_: nhiều
thread runnable hơn số lõi nghĩa là scheduler phải vòng qua chúng, và mỗi vòng
là một context switch.

Đây là bằng chứng "thêm thread làm chậm mọi thứ": **oversubscription có cái giá,
và nó không phải tưởng tượng.** Vách đá hiệu năng là sự khác biệt giữa "đủ thread
để giữ lõi bận" và "đủ thread để bão hòa scheduler".

### Bottleneck là gì? — bài kiểm tra lặp lại

```text
CPU-bound task   → bottleneck là CPU   → số thread ≈ số lõi
I/O-bound task   → bottleneck là I/O   → số thread >> số lõi
Quá nhiều thread → bottleneck là scheduler → số thread chính là vấn đề
```

Mọi ví dụ hiệu năng trong khóa học này trả lời cùng một câu hỏi: _bottleneck là
gì?_ Tìm nó trước — số thread là một quyết định, không phải một con số.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.performance.CpuBoundThreadExample
java -cp target/classes com.example.javalab.performance.IoBoundThreadExample
java -cp target/classes com.example.javalab.performance.TooManyThreadsExample
```

Quan sát kỳ vọng: con số của bạn khác, nhưng hình dạng thì ổn định — CPU-bound
nằm ngang ở số lõi; I/O-bound đạt đỉnh cao hơn hẳn; ca quá nhiều thread suy
thoái sau oversubscription. Bỏ qua miligiây chính xác.

---

## 11. Những Lỗi Thường Gặp: Những Câu Chuyện Kinh Hoàng ở Production

**Repository examples:** `src/main/java/com/example/javalab/problems/DeadlockExample.java`, `StarvationExample.java`, `ThreadPoolExhaustionExample.java`, `ThreadLocalLeakExample.java`, `LostExceptionExample.java` và `src/main/java/com/example/javalab/problems/BlockingSharedPoolExample.java`

### 11.1. Deadlock: các điều kiện Coffman

**Repository example:** `DeadlockExample`

```java
class Chopstick {
    private final String name;
    synchronized void use(Chopstick other, String philosopher) {
        System.out.println(philosopher + " picked up " + name);
        sleepQuietly(200);          // simulate holding
        other.use(this, philosopher);  // acquire the second stick
        // ...eating...
    }
}
```

Hai thread, hai lock dùng chung, thứ tự giành chéo nhau. Mỗi triết gia nhặt
chiếc đũa bên trái, tạm dừng để _suy nghĩ_ (giấc ngủ là mấu chốt: nó cho thread
kia thời gian giành chiếc đũa thứ hai), rồi chờ chiếc bên phải. Deadlock.

**Kết quả thực tế:** sau vài vòng ăn, chương trình treo vĩnh viễn — cả hai triết
gia đều giữ một chiếc đũa và chờ chiếc của người kia. Ví dụ thả một gợi ý trong
output: `Pausing for 5 seconds to prove deadlock...` rồi tuyên bố nó. **Không
lỗi nào được ném — chương trình chỉ đơn giản dừng.**

**Vì sao xảy ra — các điều kiện Coffman.** Để có deadlock, bốn điều kiện phải
đồng thời giữ:

```text
1. Mutual Exclusion     - các tài nguyên (đũa) là độc quyền
2. Hold and Wait        - mỗi thread giữ một cái, chờ cái kia
3. No Preemption        - tài nguyên đang giữ không thể bị lấy cưỡng bức
4. Circular Wait        - A chờ B, B chờ A
```

**Bên dưới:** mọi khối `synchronized` là một monitor; monitor có một chủ sở hữu
và một hàng đợi người chờ bị block. Khi cả hai thread block trên monitor thứ
hai, không cái nào tiến được — không timeout nào trong `synchronized` cứu được
chúng (đây chính xác là việc `ReentrantLock.tryLock` dành cho).

**Cách sửa — phá vỡ bất kỳ một điều kiện:**

- **Phá Circular Wait: giành lock theo một thứ tự toàn cục.** Bắt mọi thread
  lấy lock A trước lock B (ví dụ luôn nhặt chiếc đũa có _số thấp hơn_ trước).
  Đây là cách sửa chuẩn: một thứ tự toàn phần trên các lock đảm bảo không thể
  hình thành vòng.
- **Phá Hold and Wait: giành mọi tài nguyên một cách nguyên tử**, hoặc
  try-lock-với-timeout và nhả những gì đang giữ khi thất bại.
- **Phá No Preemption:** `tryLock(timeout)` + lùi lại.
- **Phát hiện và phục hồi**: thread dump (`jstack <pid>`) cho thấy trạng thái
  blocked và chuỗi chờ. Ở production, deadlock được chẩn đoán từ dump, không
  phải đoán trước.

**Tác động production:** deadlock là lỗi "không có lỗi": dịch vụ chỉ ngừng đáp
ứng, thread chất đống ở BLOCKED, request timeout từ phía client. Nguyên nhân
thực tế phổ biến nhất là _thứ tự giành lock không nhất quán_ giữa các đường mã
— quy tắc "luôn giành theo cùng một thứ tự" rẻ mà ngăn được lớp lỗi tệ nhất.

### 11.2. Starvation: đối nghịch của fairness

**Repository example:** `StarvationExample`

Người em im lặng của deadlock. Ba thread tranh một lock với một thao tác cập
nhật đơn giản; thread tham lam giữ lock ~95% thời gian nhờ tính không fair mặc
định của `synchronized`.

```java
while (true) {
    synchronized (lock) {        // greedy: acquires, updates, releases
        count++;
    }
}
```

**Kết quả thực tế:** `greedy` được cập nhật 955.386 lần; hai thread kia cộng lại
6.854 — cái sau có thể hiển thị 0 lần trong một lần chạy cụ thể. Các worker
không deadlock: chúng **sống nhưng không tiến triển**.

> Thread tham lam có thể bỏ đói những thread khác bằng cách giành monitor liên
> tục; dưới contention kéo dài `synchronized` không hứa hẹn fairness (JVM có thể
> giành lại cho người vừa nhả), nên người chờ có thể bị vượt mặt vô hạn. Cách
> sửa: `ReentrantLock(true)` (fair mode) hoặc định cỡ critical section cẩn
> thận.

**Tác động production:** starvation hiện ra như "một số request không bao giờ
hoàn thành, nhưng hệ thống trông khỏe mạnh". Các lần đếm trong output ghi lại
chỉ là vi mô (thread tham lam dẫn trước ~140×) — nguyên tắc mới là điều quan
trọng: **một lock không đảm bảo tiến triển cho tất cả, chỉ đảm bảo loại trừ
cho người giữ.**

### 11.3. Cạn kiệt thread pool: vụ sụp đổ dây chuyền

**Repository example:** `ThreadPoolExhaustionExample`

Một pool 1 thread. Task 1 nhanh (~211 ms trong lần chạy ghi lại); tasks 2–10
chậm (2 s mỗi cái). Tổng kỳ vọng: ~18 s.

**Kết quả thực tế:**

```
Task 1 completed: ... 211 ms
... (2–10 complete one by one) ...
ALL 10 tasks completed. Total time: ~18 seconds
```

**Vì sao xảy ra — vụ sụp đổ dây chuyền:**

```text
Một tác vụ chặn cả pool
        ↓
Mọi tác vụ khác chờ trong queue
        ↓
Latency dịch vụ leo lên bằng tác vụ chậm nhất
        ↓
Request mới xếp hàng phía sau
        ↓
Queue lớn hơn → áp lực bộ nhớ
        ↓
Các dịch vụ khác gọi dịch vụ này bị timeout
        ↓
Chúng retry → pool của chúng đầy retry
```

Tác vụ chậm duy nhất (hoặc tệ hơn, một tác vụ **block mãi mãi** — một lời gọi
từ xa không timeout là kinh điển) trở thành tính khả dụng của toàn bộ dịch vụ.
Queue giữ lấy sự thất bại.

**Tác động production — vòng phản hồi:** khi một thành phần chậm lại, thread của
người gọi block chờ, pool của họ đầy, pool của người gọi tiếp theo cũng đầy —
một _dây chuyền_ đánh sập cả hệ phân tán. Phòng thủ là các ý tưởng quản lý tài
nguyên của khóa học này, áp dụng cùng nhau: **pool có chặn (Mục 9), timeout trên
mọi lời gọi từ xa (một tác vụ có thể block phải có khả năng bỏ cuộc), và
rejection policies (cạn kiệt nên fail nhanh, không chất đống).**

### 11.4. ThreadLocal: rò rỉ bộ nhớ của thread trong pool

**Repository example:** `ThreadLocalLeakExample`

Một thread trong pool _là một đối tượng sống lâu_ — và các giá trị `ThreadLocal`
được gắn vào thread. Kết hợp hai thứ và một lần `set()` bất cẩn trở thành một
rò rỉ bộ nhớ vô hình trong một thời gian dài.

Ví dụ dùng một **thread pool 4 thread** (không phải 4 thread thô!) và một
`ThreadLocal<HashMap<Long, byte[]>>` tích lũy:

- **Pha 1:** các tác vụ lưu "session data" theo tác vụ — một buffer heap mỗi tác
  vụ. Vì thread được tái sử dụng, các map không bao giờ bị xóa.
- **Pha 2:** các tác vụ mới _không còn_ set ThreadLocal nữa — chúng gọi
  `session.get()`.

**Kết quả thực tế:**

```
Phase 1: memory leaked as tasks saved data per task (grew continuously)
Phase 2: session.get() → STALE data from previous tasks (threads were reused!)
```

**Cơ chế:** bộ nhớ `ThreadLocal` thuộc về đối tượng thread. Một thread trong
pool chạy tác vụ A, giữ giá trị của A, rồi chạy tác vụ B — `get()` của B trả về
_giá trị của A_. Đó vừa là rò rỉ (giá trị không bao giờ chết cùng tác vụ) vừa
là bug đúng đắn (các tác vụ nhìn thấy dữ liệu của nhau).

```text
Giá trị ThreadLocal (ví dụ một session buffer lớn)
        ↓
Được lưu bên trong đối tượng thread trong pool
        ↓
Thread được tái sử dụng cho tác vụ kế tiếp
        ↓
Giá trị sống sót; tác vụ kế tiếp đọc nó (hoặc nó không bao giờ được giải phóng)
```

**Cách sửa — remove tường minh:**

```java
try {
    // work with session
} finally {
    session.remove();   // mandatory: pooled threads are reused
}
```

**Vì sao đây không phải vấn đề trong code "bình thường" (không pool):** một
`new Thread(runnable)` thường khởi động, chạy một lần, và chết; cái chết của
thread thu hồi các ThreadLocal của nó. Rò rỉ tồn tại _vì_ sự tái sử dụng. Khoảnh
khắc bạn đưa pooling vào, mọi ThreadLocal trở thành trách nhiệm vòng đời —
`remove()` trong `finally`, nếu không giá trị sẽ sống lâu hơn tác vụ và làm ô
nhiễm tác vụ kế tiếp.

### 11.5. Exception bị mất: sự thất bại im lặng

**Repository example:** `LostExceptionExample`

Với `submit()`, exception bên trong tác vụ không tự động lan truyền:

```java
pool.submit(() -> {
    throw new RuntimeException("Something went wrong in the task!");
});
```

**Kết quả thực tế:**

```
LOST!!! The main thread did NOT see the exception:
- The task failed silently
- The call is still in the queue
- The Future returned by submit() holds the exception
  - future.get() rethrows ExecutionException (the wrapper)
```

**Cơ chế:** `submit()` trả về một `Future`; exception được lưu _bên trong
future_ để giao trên `get()`. Không ai gọi `get()` → sự thất bại biến mất. Dòng
tắt máy (`pool.shutdown()`) phơi bày rò rỉ: `Future` bị từ chối vẫn giữ tham
chiếu đến exception của tác vụ thất bại.

**Tác động production:** đây là cách "job cứ ngừng sinh kết quả, không lỗi nào
trong log" xảy ra. Các cách sửa:

- `future.get()` — và xử lý `ExecutionException` (luôn bóc lớp vỏ để tìm
  nguyên nhân).
- `execute()` thay vì `submit()` cho các tác vụ fire-and-forget: exception lan
  truyền đến uncaught exception handler.
- Một rejected-execution handler hoặc một wrapper tác vụ ghi log.
- Các chuỗi `CompletableFuture.exceptionally(...)` ghi lại sự thất bại.

### 11.6. Chặn một pool dùng chung: hiệu ứng domino

**Repository example:** `src/main/java/com/example/javalab/problems/BlockingSharedPoolExample.java`

Lỗi "vô hình" nhất trong tất cả. Một pool dùng chung (4 thread) chạy _mọi_ tác
vụ — cả một tác vụ xử lý đơn hàng nhanh lẫn một tác vụ chậm phụ thuộc dịch vụ
khác (mô phỏng bằng ngủ 100 ms). Tác vụ chậm chiếm cả pool, và các tác vụ nhanh
bị bỏ đói phía sau nó.

**Thiết kế XẤU (pool dùng chung):**

```text
All Tasks
     ↓
Shared Pool (4 threads)
     ↓
Order Task ... Order Task ... External Call Task (100 ms) ...
     ↓
Tác vụ chậm chiếm worker; tác vụ đơn hàng chờ
```

**Kết quả thực tế (XẤU — pool dùng chung):**

```
fast order task completed: 1904 ms
fast order task completed: 1908 ms
fast order task completed: 1914 ms
fast order task completed: 1917 ms
(và các tác vụ nhanh tiếp theo cũng chịu độ trễ tương tự)
```

**Thiết kế TỐT (các pool riêng):**

```text
Order Tasks            Slow Tasks
     ↓                      ↓
Order Pool (2)      External Call Pool (2)
     ↓                      ↓
Mỗi pool nhỏ; pool chậm không thể bỏ đói pool nhanh
```

**Kết quả thực tế (TỐT — các pool riêng):**

```
fast order task completed: 6 ms
fast order task completed: 5 ms
fast order task completed: 5 ms
fast order task completed: 5 ms
(không can thiệp giữa các pool)
```

**Cơ chế — tail latency:** với pool dùng chung, 100 ms của tác vụ chậm trở
thành _tầng đáy_ cho mọi tác vụ khác dùng chung pool. Tác vụ nhanh lẽ ra hoàn
thành trong 6 ms phải chờ 1900 ms vì nó xếp sau tác vụ chậm. Đây là **sự khuếch
đại tail-latency** của pooling: một dependency hạ nguồn chậm làm chậm mọi
request không liên quan.

**Tác động production — đây là bug pool phổ biến nhất trong thế giới thực.**
Cách sửa không phải "thêm thread vào pool dùng chung" — nó là **cô lập: các
pool riêng cho các workload có hồ sơ latency khác nhau** (một cho công việc
trong bộ nhớ nhanh, một cho lời gọi ngoài chậm). Cùng ý tưởng tài nguyên như
bulkhead trong con tàu: một lỗ thủng ở một khoang chỉ đánh chìm khoang đó.

**Bản phân loại lỗi giờ đã đầy đủ — mọi "câu chuyện kinh hoàng production"
quy về một vấn đề quản lý tài nguyên: tài nguyên không giới hạn (cạn kiệt, rò
rỉ), tài nguyên dùng chung không cô lập (bỏ đói, dây chuyền, tail latency),
hoặc tài nguyên được giành sai thứ tự (deadlock).**

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.problems.DeadlockExample
java -cp target/classes com.example.javalab.problems.StarvationExample
java -cp target/classes com.example.javalab.threadpool.ThreadPoolExhaustionExample
java -cp target/classes com.example.javalab.problems.ThreadLocalLeakExample
java -cp target/classes com.example.javalab.problems.LostExceptionExample
java -cp target/classes com.example.javalab.problems.BlockingSharedPoolExample
```

Quan sát kỳ vọng: `DeadlockExample` treo (đó là màn trình diễn — nhấn Ctrl+C);
số đếm starvation thay đổi; exhaustion mất ~18 s; rò rỉ ThreadLocal in dữ liệu
cũ ở pha 2; `LostExceptionExample` cho thấy lỗi bị nuốt; `BlockingSharedPoolExample`
cho thấy sự tương phản ~1900 ms vs ~6 ms.

---

## 12. Virtual Threads: Giải Pháp Cho Vấn Đề Mở Rộng

**Repository examples:** `src/main/java/com/example/javalab/virtualthread/BasicVirtualThreadExample.java`, `src/main/java/com/example/javalab/virtualthread/VirtualThreadExecutorExample.java`, `src/main/java/com/example/javalab/virtualthread/PlatformVsVirtualThreadExample.java`

### Vấn đề được trình bày lại

Các Mục 8–11 dựng lên một bức tranh khó chịu:

- Platform thread đắt (đối tượng kernel, stack ~1 MB).
- Pool giới hạn chúng — nhưng pool mang vào việc xếp hàng, từ chối, cạn kiệt,
  tail latency, các vấn đề cô lập.
- Định cỡ pool là một bài vặn vít thủ công mong manh (`cores × (1 + wait/calc)`,
  với mọi núm vặn là một quả mìn).
- Các lời gọi blocking bên trong pool _chính là_ chế độ thất bại của pool.

Tất cả điều này tồn tại vì một thuộc tính duy nhất của platform thread: **một
platform thread bị block chiếm một tài nguyên OS — một ô tốn ~1 MB bộ nhớ và
một mục trong scheduler.** Khi một thread chờ I/O, _tài nguyên_ chờ cùng với nó.
Virtual threads được thiết kế để làm "chờ đợi" rẻ: **một virtual thread là một
thread Java bình thường có thread OS nền bên dưới được nhả ra trong lúc nó
chờ.**

### Kiến trúc: điều gì thay đổi bên dưới

```text
Platform thread = 1 Java thread ↔ 1 OS thread
                    (ánh xạ 1:1, Mục 3)

Virtual thread  = 1 Java thread ↔ 1 OS thread CHỈ KHI ĐANG CHẠY
                    (nhiều virtual thread dùng chung vài OS thread)
```

Virtual thread được **mang** (carried) bởi platform thread:

```text
Carrier Platform Threads (ví dụ 8)
        ↓ mang
Virtual Thread A ── running ──► I/O call ──► BLOCKED
Virtual Thread B ── running ──► I/O call ──► BLOCKED
Virtual Thread C ── ready ──► I/O call ──► BLOCKED
Virtual Thread D ── ready ──► I/O call ──► BLOCKED
...
```

Khi một virtual thread thực thi một thao tác blocking, runtime **unmount** nó:
stack của nó được lưu (trong bộ nhớ heap, như một phần của đối tượng thread) và
carrier thread được giải phóng để chạy một virtual thread khác. Khi I/O hoàn
thành, virtual thread được **remount** lên một carrier.

**Bên dưới — cơ chế mang tính khái niệm:** trong một JVM điển hình, lời gọi
blocking trên carrier được phát hiện, stack của virtual thread được sao chép
vào heap, và carrier trở lại bể scheduler — thao tác từng tiêu thụ một OS thread
1 MB giờ chỉ tiêu thụ một buffer heap nhỏ. Cách triển khai chính xác (sao chép
stack, cỗ máy Continuation, chi tiết scheduler) thay đổi theo JVM; hợp đồng quan
sát được là: **một virtual thread bị block không pin hay tiêu thụ một OS
thread.** Hai hệ quả trực tiếp:

- **Bạn có thể tạo nhiều hơn rất nhiều** — chúng tốn heap, không tốn kernel
  memory.
- **Phép toán định cỡ pool biến mất cho trường hợp I/O** — "một virtual thread
  mỗi tác vụ, không pool, không vặn vít" là mục tiêu thiết kế (Mục 14 giải
  thích điều lưu ý còn lại).

### Tạo virtual thread

**Repository example:** `BasicVirtualThreadExample`

```java
// 1) Thread.ofVirtual()
Thread vThread = Thread.ofVirtual()
        .name("vt-", 0)              // named, numbered
        .unstarted(() -> {           // not started until we call start()
            System.out.println(Thread.currentThread().getName());
        });
vThread.start();

// 2) Thread.startVirtualThread(runnable)
Thread started = Thread.startVirtualThread(() ->
        System.out.println("Started: " + Thread.currentThread().getName()));

// 3) Executors.newVirtualThreadPerTaskExecutor()
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
```

**Kết quả thực tế:**

```
Running in: virtual thread: vt-0
Started: virtual thread: started-thread
virtual per task executor: virtual thread: vExecutor-1
```

**Cái tên là một món quà chẩn đoán:** chuỗi `virtual thread: ...` trong tên cho
bạn biết ngay lập tức (trong log, dump, profiler) một tác vụ có đang chạy trên
virtual thread hay không. `Thread.currentThread().getName()` trả về chính xác
điều đó.

**Dòng quan trọng nhất trong ví dụ:**

```
I am virtual: true
```

**Executor per-task:** `Executors.newVirtualThreadPerTaskExecutor()` là sự thay
thế hiện đại cho `newFixedThreadPool` trong trường hợp I/O. Nó tạo một _virtual
thread mới cho mọi tác vụ_ — không có pool để định cỡ, không queue, không từ
chối. Ví dụ nộp 20 tác vụ ngủ và in parallelism tối đa
(`newVirtualThreadPerTaskExecutor().getMaximumPoolSize() = Integer.MAX_VALUE`):

**Kết quả thực tế:** `maximum pool size of the v-executor: 2147483647` — "pool
size" không giới hạn vì toàn bộ điểm mấu chốt là: thread giờ rẻ.

**Tác động production:** với workload I/O-bound, điều này xóa một lớp hoàn toàn
các lỗi production — cạn kiệt, tail latency, cô lập, định cỡ pool. "Một thread
mỗi tác vụ, không vặn vít" là mặc định mới cho công việc I/O.

### Platform vs Virtual thread: ca đo được

**Repository example:** `PlatformVsVirtualThreadExample`

1.000 tác vụ × 50 ms ngủ, chạy hai lần — một lần trên platform thread (10 cùng
lúc), một lần với virtual thread.

**Kết quả thực tế (JDK 21):**

```
Platform threads: 1,000 tasks * 50ms sleep -> 2108 ms (10 threads)
Virtual threads:  1,000 tasks * 50ms sleep -> 54 ms
```

**Những con số nói gì:** phiên bản virtual nhanh hơn ~39× vì 1.000 virtual
thread _chờ_ trên 10 carrier; phiên bản platform chờ trên 10 thread _và_ xếp
hàng 990 tác vụ. Cả hai đều đúng — nhưng một cái block thread, cái kia không.

**Phép đo thứ hai là bằng chứng mở rộng:**

**Kết quả thực tế (JDK 21):**

```
Starting 100,000 virtual threads...
All 100,000 virtual threads finished! Elapsed: ~59 ms
```

100.000 virtual thread, được tạo và hủy trong ~59 ms. Platform thread sẽ cần
100.000 × ~1 MB stack (≈ 97 GB) và hàng nghìn kernel object; virtual thread chỉ
tốn heap frames. **Việc chất ~2.000 tác vụ trên mỗi lõi không phải vấn đề phải
né — đó là thiết kế.**

**Khi nào KHÔNG dùng virtual thread (và khi nào nên ưu tiên platform thread):**

- **Công việc CPU-bound** — virtual thread chạy _trên_ platform thread; chúng
  không thêm parallelism, chỉ thêm chi phí unmount. Một pool CPU-bound nên là
  `newFixedThreadPool(cores)`.
- **Code bị pin** — một virtual thread block bên trong `synchronized` hoặc một
  native call sẽ **pin** carrier của nó (JVM không thể unmount nó). Các framework
  khóa dùng `synchronized` cho các section dài sẽ mất lợi ích mở rộng; hãy ưu
  tiên `ReentrantLock` ở đó.
- **Tranh chấp shared state mức hạt mịn** — nhiều virtual thread đánh nhau trên
  một monitor tuần tự hóa y như platform thread, cộng thêm chi phí lập lịch.
  Concurrency vẫn bị chặn bởi lock, không phải số thread.
- **Hàng triệu thread sống lâu với trạng thái lớn mỗi thread** — virtual thread
  rẻ, nhưng không miễn phí; mỗi cái lưu stack của nó trong heap.

**Mô hình tư duy trở thành:**

> Platform threads: các khe thực thi đắt — phải pool và vặn vít.
> Virtual threads: các vật mang tác vụ rẻ — một tác vụ một thread, không pool,
> cho I/O.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.BasicVirtualThreadExample
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadExecutorExample
java -cp target/classes com.example.javalab.virtualthread.PlatformVsVirtualThreadExample
```

Quan sát kỳ vọng: maximum pool size của executor in ra 2147483647; 1.000 tác vụ
ngủ mất ~54 ms trên virtual thread so với ~2.100 ms trên 10 platform thread;
100.000 virtual thread hoàn thành trong ~60 ms trên một máy hiện đại.

---

## 13. Virtual Threads Trong Hành Động: I/O và CPU Được Đo

**Repository examples:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadIoExample.java`, `src/main/java/com/example/javalab/virtualthread/VirtualThreadCpuBoundExample.java`

### 13.1. I/O-bound: virtual thread xóa phép toán pool

**Repository example:** `VirtualThreadIoExample`

200 tác vụ, mỗi tác vụ ngủ 50 ms rồi _xử lý_ 25 ms (cùng tỷ lệ
calculate/wait như `IoBoundThreadExample` — 2/3 blocking). So với một fixed pool
12 platform thread.

**Kết quả thực tế (JDK 21):**

```
Platform threads (12): 4269 ms  (p95: 4070 ms)
Virtual threads:        67 ms   (p95: 58 ms)
```

**Những con số nói gì:** virtual thread hoàn thành nhanh hơn ~64×. Pool platform
xếp hàng 200 tác vụ sau 12 worker (4269 ms ≈ 200/12 × 50 ms + 200 × 25 ms);
virtual thread _bắt đầu một thread mỗi tác vụ_ — không queue, không tuần tự
hóa. p95 xác nhận: tác vụ virtual _chậm nhất_ (58 ms) còn nhanh hơn tác vụ
platform _nhanh nhất_ (4269 ms tổng).

**Hệ quả production:** đây là cùng thí nghiệm với việc định cỡ pool I/O của Mục
10 — nhưng đã bỏ phần vặn vít. Không `cores × (1 + wait/calc)`, không xem lại cỡ
pool khi latency thay đổi. JVM hấp thụ sự chờ đợi.

### 13.2. CPU-bound: virtual thread không làm CPU nhanh hơn

**Repository example:** `VirtualThreadCpuBoundExample`

12 triệu phép toán số nguyên, chạy với 12 virtual thread và 12 platform thread
trên một máy 12 lõi — cộng thêm 48 virtual thread để chứng minh điểm nằm ngang.

**Kết quả thực tế (JDK 21):**

```
12 virtual threads:  ~75 ms
12 platform threads: ~27 ms
48 virtual threads:  ~29 ms
```

**Những con số nói gì:** 12 virtual thread _chậm_ hơn ~3× so với 12 platform
thread (cỗ máy unmount và quản lý heap-stack thêm chi phí cho công việc nặng
tính toán), và 48 virtual thread không nhanh hơn 12 (chúng đã dùng hết mọi lõi).
Virtual thread không thêm parallelism — chúng thêm chi phí unmount.

**Điểm mấu chốt không phải "virtual thread chậm" — nó là:**

> **Virtual thread trả lời vấn đề blocking, không phải vấn đề CPU. Workload
> CPU-bound vẫn cần `newFixedThreadPool(cores)`.**

**Khi một workload trộn cả hai** (hầu hết công việc thực tế đều vậy): giữ các
phần nặng CPU ra khỏi virtual thread nếu chúng chiếm ưu thế, hoặc chấp nhận chi
phí nhỏ — khoản tiết kiệm I/O lớn hơn chi phí CPU 10–100×.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadIoExample
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadCpuBoundExample
```

Quan sát kỳ vọng: thí nghiệm I/O cho thấy virtual thread nhanh hơn ~50–70×; thí
nghiệm CPU cho thấy platform thread bằng hoặc nhanh hơn — và khoảng cách nhỏ so
với thí nghiệm I/O. Bỏ qua con số chính xác; giữ lấy hình dạng.

---

## 14. Quan Niệm Sai: Virtual Threads Không Xóa Giới Hạn Tài Nguyên

**Repository examples:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadResourceLimitExample.java`, `src/main/java/com/example/javalab/practical/SemaphoreConcurrencyLimitExample.java`, `src/main/java/com/example/javalab/practical/ProducerConsumerExample.java`

### Cái bẫy

Virtual thread giải quyết bottleneck _thread_. Vẫn còn một bottleneck — nó chỉ
dời chỗ: **bottleneck giờ là tài nguyên bên ngoài** (connection database, HTTP
client, I/O đĩa, rate limit). Và `newVirtualThreadPerTaskExecutor` xóa đi cái
pool từng là "núm vặn" concurrency.

**Cụ thể:** 100.000 tác vụ virtual, mỗi tác vụ thực hiện một lời gọi ngoài chỉ
xử lý được 20 connection đồng thời. 100.000 tác vụ, tất cả cùng lúc, tất cả
block chờ một trong 20 connection. Không gì hỏng — chúng chỉ đơn giản là đều
chờ. **Thread không giới hạn không có nghĩa throughput không giới hạn; nó có
nghĩa chờ đợi không giới hạn đằng sau một tài nguyên hữu hạn.**

> **Virtual threads không xóa giới hạn tài nguyên. Chúng dời bottleneck từ số
> thread sang tài nguyên bên ngoài.**

### Ca đo được

**Repository example:** `VirtualThreadResourceLimitExample`

Ba chiến lược giới hạn concurrency ở 10 lời gọi ngoài cùng lúc (mỗi lời gọi mô
phỏng bằng ngủ 10 ms), trên 100 tác vụ:

**Kết quả thực tế (JDK 21):**

```
Strategy A (shared lock) : total 2304 ms, max concurrent = 10
Strategy B (Semaphore)   : total 2320 ms, max concurrent = 10
Strategy C (bounded pool): total 62 ms,   max concurrent = 400
```

**Những con số nói gì:** chiến lược A và B chặn concurrency đúng ở 10 (2300 ms
≈ 100/10 × 10 ms × 23 vòng) — cái chặn là điều quan trọng, không phải cơ chế.
Chiến lược C là một _bẫy so sánh_: một fixed pool dùng chung 10 platform thread
cũng sẽ chặn ở 10 — nhưng với virtual thread không có pool, nên cái chặn phải
đến từ nơi khác.

**Cơ chế — cái chặn được thực thi thế nào:**

```text
Semaphore (10 permits)
        ↓
Virtual task: tryAcquire()
        ↓
        ├── có permit → tiến hành lời gọi ngoài
        └── không có permit → chờ (trên một virtual thread rẻ, không phải platform)
```

10 permit của semaphore là giới hạn concurrency thật; sự chờ đợi của virtual
thread là phần rẻ. Bài học được in ra của ví dụ là điều mang đi:

> **Giới hạn concurrency cho virtual thread: dùng Semaphore / rate limits /
> bounded connection pools. Đừng dựa vào pool size của executor — với virtual
> thread, nó gần như vô hạn.**

### Hộp công cụ giới hạn tài nguyên (dùng gì khi nào)

| Cơ chế                    | Giới hạn cái gì                 | Ví dụ                              |
| ------------------------- | ------------------------------- | ---------------------------------- |
| `Semaphore(n)`            | Tác vụ _đồng thời_ tại một điểm | 20 permit cho 20 connection DB     |
| Bounded connection pool   | Connection DB / HTTP / socket   | `HikariCP maximumPoolSize=20`      |
| Rate limiter              | Request mỗi giây                | Hạn ngạch API                      |
| Bulkhead / executor riêng | Cô lập thất bại                 | một pool mỗi dịch vụ hạ nguồn      |
| Backpressure / rejection  | Quá tải đầu vào                 | bounded queue + `CallerRunsPolicy` |

**Tác động production — thứ tự quyết định đúng:**

1. Sửa bottleneck _trước_ — nó là một tài nguyên bên ngoài, không phải thread.
2. Giới hạn concurrency _đúng bằng công suất của tài nguyên đó_ — `Semaphore`,
   connection pool, rate limit — và đo: nếu tài nguyên xử lý được 20 connection,
   chặn ở ~20 (20 permit), không phải 10.000.
3. Dùng virtual thread cho việc _chờ đợi_; dùng các cơ chế giới hạn cho _tài
   nguyên_.
4. Giữ timeout trên mọi lời gọi ngoài — một lời gọi treo giờ là một virtual
   thread treo (rẻ, nhưng vẫn là một tác vụ treo chiếm một permit).

### Bảo vệ tài nguyên bằng Semaphore (phiên bản tường minh)

**Repository example:** `src/main/java/com/example/javalab/practical/SemaphoreConcurrencyLimitExample.java`

Cùng ý tưởng, được minh họa bằng công việc ngủ tường minh: 50 tác vụ, một
`Semaphore(10)`, 8 platform thread. Semaphore — không phải số thread — chặn công
việc đồng thời ở 10.

**Kết quả thực tế (JDK 21):**

```
Semaphore-based limit: 3389 ms, max concurrent tasks: 10
```

**Vì sao semaphore phải đứng trước tài nguyên dùng chung** (DB, HTTP client),
không chỉ quanh một giấc ngủ: mục đích của giới hạn là tài nguyên hạ nguồn có
công suất hữu hạn. `tryAcquire()`/`acquire()` với permit được nhả trong
`finally` là mẫu chuẩn:

```java
try {
    semaphore.acquire();      // wait for a permit
    // guarded section: touch the limited resource
} finally {
    semaphore.release();      // always release
}
```

### Thái cực tác vụ không giới hạn: Producer–Consumer

**Repository example:** `src/main/java/com/example/javalab/practical/ProducerConsumerExample.java`

Mảnh cuối của câu chuyện mở rộng: virtual thread làm "hàng nghìn tác vụ" rẻ đến
mức vấn đề điều phối (tail latency của Mục 11) đổi hình dạng. 10 producer × 5
tác vụ mỗi cái = 50 tác vụ, mỗi tác vụ làm một "lời gọi HTTP" 50 ms, vào một
`ArrayBlockingQueue(2)` — consumer gọi `take()` và ngủ 10 ms mỗi mục.

**Kết quả thực tế (JDK 21, mẫu — số đang bay thay đổi theo lần chạy):**

```
All 50 tasks submitted. Task 42 completed.
Consumed: 46 of 50 produced (some are still in the queue / in flight)
```

**Điểm production:** với virtual thread, các producer gần như miễn phí; _queue
và tốc độ consumer_ giờ là thứ duy nhất quyết định throughput. Số cuối thay đổi
vì các mục cuối vẫn đang bay khi main thread đo — queue đang làm việc của nó
(cơ chế điều phối), không phải số thread.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadResourceLimitExample
java -cp target/classes com.example.javalab.practical.SemaphoreConcurrencyLimitExample
java -cp target/classes com.example.javalab.practical.ProducerConsumerExample
```

Quan sát kỳ vọng: Chiến lược A và B chặn concurrency ở 10; ví dụ semaphore chặn
ở 10; số producer-consumer luôn ~46–50 nhưng con số chính xác thay đổi. Các
_giới hạn_ là tất định — số đang bay cuối cùng thì không.

---

## 15. Mô Hình Tư Duy Cuối Cùng

Toàn bộ khóa học quy về một câu, lặp lại qua mọi phần:

> **Một thread là một tài nguyên — và bottleneck không bao giờ là chính số
> thread. Nó là thứ mà các thread chờ đợi.**

**Bốn câu hỏi (từ phần mở đầu), được trả lời:**

1. **Vì sao thread tồn tại?** Để chồng lấn chờ đợi (I/O, sleep, lời gọi từ xa)
   với thực thi. Nếu công việc không bao giờ chờ, một thread là đủ.
2. **Vì sao chúng ta pool chúng?** Vì platform thread là tài nguyên đắt —
   pooling là quản lý tài nguyên, không phải tiện lợi. Mọi lỗi trong Mục 11 là
   một lỗi quản lý tài nguyên.
3. **Vì sao chúng ta đếm chúng?** Vì concurrency ≠ parallelism: công việc
   CPU-bound đạt đỉnh ở số lõi; công việc I/O-bound đạt đỉnh ở
   `cores × (1 + wait/calculate)`; quá nhiều thread thêm chi phí chuyển đổi
   (Mục 10 đã đo cả ba).
4. **Vì sao virtual thread?** Vì chờ đợi là vấn đề — và một virtual thread
   _unmount_ thread OS của nó trong lúc chờ. Thread trở nên đủ rẻ để có một
   thread mỗi tác vụ; bottleneck dời sang tài nguyên bên ngoài (Mục 14).

**Bức tranh cuối cùng:**

```text
Your Code
   │
   ├── Platform threads  → pool chúng (core=max, bounded queue, phép toán cỡ)
   ├── Virtual threads   → một tác vụ một thread, không pool (công việc I/O-bound)
   │                         + Semaphore / rate limit / bulkhead
   │                         trên tài nguyên BÊN NGOÀI
   ├── Shared state      → synchronized / Atomic* / locks
   │                         (atomicity, visibility, ordering)
   └── Failures          → chẩn đoán qua trạng thái, dump, tài nguyên có chặn,
                            thứ tự lock, cô lập
```

**Danh sách kiểm tra quyết định cho một mẩu code threaded mới:**

| Câu hỏi                             | Trả lời | Thì                                                             |
| ----------------------------------- | ------- | --------------------------------------------------------------- |
| Công việc có I/O-bound?             | Có      | Virtual thread mỗi tác vụ; chặn _tài nguyên_, không phải thread |
| Công việc có CPU-bound?             | Có      | `newFixedThreadPool(cores)`                                     |
| Hỗn hợp tác vụ không đều?           | Có      | Các pool riêng / bulkhead                                       |
| Lời gọi từ xa thiếu timeout?        | Có      | Sửa nó trước mọi thứ khác                                       |
| Tác vụ có block trên một lock?      | Có      | Kiểm tra thứ tự lock; ưu tiên `ReentrantLock` + `tryLock`       |
| Có dùng ThreadLocal trong một pool? | Có      | `remove()` trong `finally`                                      |
| Quá tải có thể đến?                 | Có      | Bounded queue + rejection policy được định nghĩa                |

---

## 16. Code: Mọi Ví Dụ Trong Một Bảng

Cả 31 ví dụ nằm trong repository
[`java-lab`](https://github.com/hungpt99-dev/java-lab/tree/lab/thread) — clone nó, chạy
`scripts/run-all.ps1` (Windows) hoặc các lệnh Maven bên dưới, và thấy mọi khẳng
định trong bài viết này tái hiện trên máy của bạn. Repository là nguồn chân lý
duy nhất: mọi con số phía trên đều đến từ các file này, và không gì trong bài
viết khẳng định hành vi mà code không minh họa.

| #   | Example                             | Đường dẫn                                                                                | Nó cho thấy gì                                              |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | `CreateThreadExample`               | `src/main/java/com/example/javalab/basics/CreateThreadExample.java`                      | Tạo thread, đặt tên, `currentThread()`                      |
| 2   | `RunnableExample`                   | `src/main/java/com/example/javalab/basics/RunnableExample.java`                          | `Runnable`, `ThreadFactory`, thứ tự thực thi                |
| 3   | `JoinExample`                       | `src/main/java/com/example/javalab/basics/JoinExample.java`                              | `join()` như chờ-cho-hoàn-thành                             |
| 4   | `ThreadLifecycleExample`            | `src/main/java/com/example/javalab/basics/ThreadLifecycleExample.java`                   | Cả sáu trạng thái vòng đời với một thread lấy mẫu           |
| 5   | `RaceConditionExample`              | `src/main/java/com/example/javalab/synchronization/RaceConditionExample.java`            | `count++` hỏng (Mục 6)                                      |
| 6   | `SynchronizedExample`               | `src/main/java/com/example/javalab/synchronization/SynchronizedExample.java`             | Cách sửa `synchronized` (Mục 7.1)                           |
| 7   | `AtomicIntegerExample`              | `src/main/java/com/example/javalab/synchronization/AtomicIntegerExample.java`            | Atomicity dựa trên CAS (Mục 7.2)                            |
| 8   | `LockExample`                       | `src/main/java/com/example/javalab/synchronization/LockExample.java`                     | `ReentrantLock`, `tryLock`, quy tắc `finally` (Mục 7.3)     |
| 9   | `VolatileExample`                   | `src/main/java/com/example/javalab/synchronization/VolatileExample.java`                 | Visibility vs atomicity (Mục 7.4)                           |
| 10  | `FixedThreadPoolExample`            | `src/main/java/com/example/javalab/threadpool/FixedThreadPoolExample.java`               | Pool như quản lý tài nguyên (Mục 8)                         |
| 11  | `ThreadPoolExecutorExample`         | `src/main/java/com/example/javalab/threadpool/ThreadPoolExecutorExample.java`            | Luồng core → queue → max → rejection (Mục 9)                |
| 12  | `BoundedQueueExample`               | `src/main/java/com/example/javalab/threadpool/BoundedQueueExample.java`                  | Queue không chặn vs có chặn (Mục 9)                         |
| 13  | `RejectedExecutionExample`          | `src/main/java/com/example/javalab/threadpool/RejectedExecutionExample.java`             | Rejection policies (Mục 9)                                  |
| 14  | `CpuBoundThreadExample`             | `src/main/java/com/example/javalab/performance/CpuBoundThreadExample.java`               | Điểm nằm ngang ở số lõi (Mục 10)                            |
| 15  | `IoBoundThreadExample`              | `src/main/java/com/example/javalab/performance/IoBoundThreadExample.java`                | Mở rộng theo tỷ lệ blocking (Mục 10)                        |
| 16  | `TooManyThreadsExample`             | `src/main/java/com/example/javalab/performance/TooManyThreadsExample.java`               | Chi phí oversubscription (Mục 10)                           |
| 17  | `DeadlockExample`                   | `src/main/java/com/example/javalab/problems/DeadlockExample.java`                        | Các điều kiện Coffman (Mục 11.1)                            |
| 18  | `StarvationExample`                 | `src/main/java/com/example/javalab/problems/StarvationExample.java`                      | Lock không fair (Mục 11.2)                                  |
| 19  | `ThreadPoolExhaustionExample`       | `src/main/java/com/example/javalab/threadpool/ThreadPoolExhaustionExample.java`          | Vụ sụp đổ dây chuyền (Mục 11.3)                             |
| 20  | `ThreadLocalLeakExample`            | `src/main/java/com/example/javalab/problems/ThreadLocalLeakExample.java`                 | Rò rỉ ThreadLocal trong thread pool (Mục 11.4)              |
| 21  | `LostExceptionExample`              | `src/main/java/com/example/javalab/problems/LostExceptionExample.java`                   | Exception của `submit()` bị nuốt (Mục 11.5)                 |
| 22  | `BlockingSharedPoolExample`         | `src/main/java/com/example/javalab/problems/BlockingSharedPoolExample.java`              | Domino tail-latency (Mục 11.6)                              |
| 23  | `BasicVirtualThreadExample`         | `src/main/java/com/example/javalab/virtualthread/BasicVirtualThreadExample.java`         | Tạo virtual thread (Mục 12)                                 |
| 24  | `VirtualThreadExecutorExample`      | `src/main/java/com/example/javalab/virtualthread/VirtualThreadExecutorExample.java`      | Executor per-task (Mục 12)                                  |
| 25  | `PlatformVsVirtualThreadExample`    | `src/main/java/com/example/javalab/virtualthread/PlatformVsVirtualThreadExample.java`    | 1.000 tác vụ: 2108 ms vs 54 ms; 100k thread (Mục 12)        |
| 26  | `VirtualThreadIoExample`            | `src/main/java/com/example/javalab/virtualthread/VirtualThreadIoExample.java`            | I/O-bound: 4269 ms vs 67 ms (Mục 13)                        |
| 27  | `VirtualThreadCpuBoundExample`      | `src/main/java/com/example/javalab/virtualthread/VirtualThreadCpuBoundExample.java`      | CPU-bound: virtual thread không thêm tốc độ (Mục 13)        |
| 28  | `VirtualThreadResourceLimitExample` | `src/main/java/com/example/javalab/virtualthread/VirtualThreadResourceLimitExample.java` | Semaphore vs lock vs pool caps (Mục 14)                     |
| 29  | `SemaphoreConcurrencyLimitExample`  | `src/main/java/com/example/javalab/practical/SemaphoreConcurrencyLimitExample.java`      | Bảo vệ một tài nguyên dùng chung (Mục 14)                   |
| 30  | `ProducerConsumerExample`           | `src/main/java/com/example/javalab/practical/ProducerConsumerExample.java`               | Tác vụ không giới hạn, queue có chặn (Mục 14)               |
| 31  | `GracefulShutdownExample`           | `src/main/java/com/example/javalab/practical/GracefulShutdownExample.java`               | `shutdown()` → `awaitTermination` → `shutdownNow()` (Mục 9) |

### Cách chạy mọi thứ

```bash
# 1. Clone
git clone -b lab/thread https://github.com/hungpt99-dev/java-lab.git
cd java-lab

# 2. Build (requires JDK 21+)
mvn clean package

# 3. Run one example
java -cp target/classes com.example.javalab.virtualthread.PlatformVsVirtualThreadExample

# 4. Or run everything (Windows PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-all.ps1
```

`README.md` của repository
([đọc tại đây](https://github.com/hungpt99-dev/java-lab/blob/lab/thread/README.md))
chứa lộ trình đầy đủ, và `docs/architecture.md` giải thích cấu trúc package.
Mọi ví dụ in một lời giải thích ngắn trước khi chạy — hãy chạy chúng, phá vỡ
chúng, chạy lại. Các con số trong bài viết này đến từ chính những file này trên
một máy 12 lõi với JDK 21, và chúng sẽ khác trên máy của bạn — các _hình dạng_
(điểm nằm ngang, vách đá, khoảng cách 39×) thì không.

---

## Kết Luận

Bạn bắt đầu với một sơ đồ chồng lớp và 10.000 request. Đây là toàn bộ hành
trình trong một đoạn văn:

Platform thread là tài nguyên thực thi đắt, nên chúng ta pool chúng; pool làm
concurrency tường minh và có chặn, nên chúng ta vặn vít chúng; việc vặn vít đòi
hỏi hiểu công việc chờ cái gì, nên chúng ta đo context switch, tỷ lệ blocking
và oversubscription; các phép đo phơi bày những lỗi — deadlock, starvation, cạn
kiệt, rò rỉ, exception mất, tail latency — tất cả đều là lỗi quản lý tài
nguyên; và virtual thread xóa phần khó nhất của phép toán tài nguyên bằng cách
làm _chờ đợi_ rẻ, nên bottleneck cuối cùng dời về đúng chỗ nó luôn luôn là:
các connection database, các HTTP timeout, các rate limit — những tài nguyên
bên ngoài. Thread chưa bao giờ là bottleneck. Chúng chỉ là cách chúng ta trải
nghiệm nó.

**Điều duy nhất cần nhớ:** một thread là một tài nguyên — pool nó, định cỡ nó,
giới hạn nó, hoặc virtual hóa nó; nhưng luôn tự hỏi _nó đang chờ cái gì?_ Đó là
câu hỏi mà cả khóa học trả lời.

---
