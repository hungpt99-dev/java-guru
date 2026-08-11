---
title: "Phỏng vấn Senior Java: Java Core sâu"
description: "Phỏng vấn viên senior thực sự kiểm tra gì ở Java core — GC và JMM, bẫy concurrency, virtual threads, và tooling runtime chứng tỏ bạn từng debug production."
pubDatetime: 2026-08-10T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

Junior biết cú pháp Java. Senior biết **JVM đang làm gì, tại sao nó hành xử vậy, và ở đâu nó sẽ làm bạn bất ngờ trên production.** Đây là phần Java core của bộ ôn thi senior.

> Tư duy: "tùy thuộc, và đây là đánh đổi" đánh bại đọc thuộc lòng mọi lúc. Khoảnh khắc bạn trả lời bằng một trade-off, một con số, hay một câu chuyện postmortem thay vì một định nghĩa — bạn đã qua vạch.

## 1. Heap, GC, và bài toán pause

Họ sẽ hỏi: "Chuyện gì xảy ra khi bạn `new` một object?" Một ứng viên mid dừng ở "nó nằm trên heap." Senior nói về **ở đâu**, **nhanh bao nhiêu**, và **pause đáng giá gì** — vì đó mới là thứ cắn trên production. Mọi câu trong phần này đều có một đáp án bằng số; phỏng vấn viên lắng nghe con số, không phải danh từ.

### Allocation không phải một lệnh gọi malloc — nó là một cú bump con trỏ

Mỗi thread cắt một **TLAB (Thread-Local Allocation Buffer)** từ Eden — từ vài trăm KB tới vài MB không gian riêng nóng trong cache — nên allocation chỉ là bump một con trỏ. Không khóa toàn cục, không CAS. Vì thế `new` rẻ tới mức một JVM thường cấp phát hàng chục triệu object dùng một lần mỗi giây mà không vấn đề gì.

```java
String tmp = prefix + id;   // trông như phí phạm; một cú bump TLAB khiến nó gần như miễn phí
```

Chỗ senior đi sâu hơn: **escape analysis**. JIT (C2) có thể chứng minh một object không bao giờ rời khỏi method và **scalar-replace** nó — các field thành thanh ghi JIT và slot stack, và cái allocation cứ thế biến mất. Đây không phải "stack allocation" theo nghĩa đen; mà là "không có object". Chạy `-XX:+PrintEliminateAllocations` và bạn sẽ thấy JIT vứt bỏ allocation trước mắt. Những object thực sự escape — truyền sang thread khác, return, gán vào field — mới là thứ rơi vào Eden và bị promote.

### Object layout và ngưỡng compressed oops

Mọi object mang một phần header: 8 byte mark word (identity hash, trạng thái khóa, GC age) cộng 4 byte con trỏ class **khi compressed oops bật** — mặc định cho heap dưới **~32 GB**. Một `Object` rỗng là 16 byte; một `Long` trần là 24. Trên một service cấp phát 100M object mỗi lần fan-out, đó là một gigabyte tiền thuế header thuần — lý do tái thiết kế theo value (records với primitive, collection kiểu primitive) là một nước đi senior thật, không phải chuyện vặt.

Ngưỡng này quan trọng: vượt 32 GB heap, JVM không còn địa chỉ hóa object bằng con trỏ hẹp 32 bit, nên nó hoặc **tắt compressed oops** (mọi header phình ra), hoặc bạn nâng `-XX:ObjectAlignmentInBytes` (mặc định 8, nên nâng lên 16 thì padding gấp đôi). Cả hai đều đội bộ nhớ mỗi object. Đó là một lý do heap 40 GB có thể chạy tệ hơn heap 28 GB — "chúng tôi tăng size mà lại chậm" thường là chuyện này, hoặc một đổi thay pattern GC. Nếu phỏng vấn viên hỏi về heap sizing, hãy nêu con số 32 GB trước khi họ kịp nói.

### Giả thuyết generational, và các con số giải thích nó

"Đa số object chết trẻ" không phải khẩu hiệu — nó là một phân bố đo được: trên workload service điển hình **~90% object thành garbage chỉ sau vài chu kỳ GC**. Đó là lý do heap bị chia:

- **Eden** — đa số object cấp phát và chết tại đây; phần lớn không bao giờ chạm survivor space.
- **Survivor spaces (S0/S1)** — object sống sót qua minor GC được copy qua lại; cố ý làm nhỏ.
- **Old gen** — object sống sót qua `-XX:MaxTenuringThreshold` lần copy (mặc định 15, G1 tự điều chỉnh động).

Tỷ lệ quan trọng hơn tên gọi: nếu ~90% object chết trong Eden, một lần young-gen GC chỉ copy ~10% còn sống, nên pause bị chi phối bởi **số live byte được copy**, không phải tổng allocation.

### Phép tính pause mà phỏng vấn viên câu

Một pause stop-the-world về cơ bản là

```
pause ≈ live_bytes_copied / copy_throughput
```

nên đòn bẩy đầu tiên luôn là **kích thước young gen**, không phải lựa chọn collector:

```
Ví dụ: young gen 2 GB, 70% survivor set sống sót qua minor GC → ~1.4 GB được copy.
Với ~10 GB/s copy throughput đó là ~140 ms STW, mỗi lần minor GC.
Thu nhỏ young gen còn 512 MB → ~36 ms. Nhỏ hơn nữa → GC thường xuyên hơn.
```

Căng thẳng này có thật: young gen to hơn → ít pause hơn nhưng dài hơn; nhỏ hơn → pause ngắn hơn nhưng nhiều lần hơn. Con số thứ hai nên bỏ túi là **GC overhead**:

```
GC overhead = time_in_GC / wall_time
200 ms GC mỗi phút → ~0,33% thuế throughput.
```

G1 tấn công pause bằng cách thu gom **tăng dần** theo vùng hướng tới `-XX:MaxGCPauseMillis` (mặc định 200 ms) — nhưng đó là một **mục tiêu mềm**. Nếu survivor set thực sự không copy kịp trong thời gian đó, G1 âm thầm kéo dài pause. Những failure mode quan trọng hơn mục tiêu:

- **Concurrent-mode failure** — old gen đầy nhanh hơn chu kỳ marking đồng thời có thể thu hồi, và G1 ngã về **Full GC STW toàn bộ**. Trên heap 50 GB đó là vài giây mọi luồng dừng — cái "biểu đồ latency biến thành vách đá" kinh điển trong postmortem.
- **Evacuation failure / promotion failure** — to-space cạn giữa lúc copy (thường do survivor spike đột ngột), object bị giữ nguyên chỗ, và các GC sau phải trả giá.
- **Humongous allocations** — region G1 rộng 1–32 MB; thứ gì lớn hơn nửa region là object **humongous**, đi thẳng vào old gen, không copy đi bằng cách thường, và có thể kích hoạt full GC. Một `byte[]` 4 MB trong heap region 2 MB là humongous. Buffer được pool, không phải mảng byte mỗi request, là cách sửa của senior.

### Chọn collector với một con số trong tay

```
Parallel GC   → throughput tối đa, STW ở mọi major GC. Đúng khi pause không sao
                (batch job, offline). Thường từ vài trăm ms tới vài giây ở quy mô lớn.
G1 (mặc định)  → cân bằng; region-based, mixed GCs. Mặc định tốt cho service heap
                tới ~100 GB. Pause 10s–200 ms tùy heap.
ZGC           → pause dưới ms kể cả heap nhiều TB, nhờ colored pointers +
                load barriers làm phần lớn việc đồng thời. Đánh thuế throughput CPU.
Shenandoah    → cùng mục tiêu, mẹo khác (concurrent evacuation, forwarding
                pointers). Pause ~milisecond, nặng bộ nhớ.
```

(CMS từng là đáp án latency thời xưa và đã **bị gỡ khỏi JDK 14** — nói điều đó nếu ai đó lạc sang.) Senior chọn bằng con số: "chúng tôi chạy heap 50 GB, pause phân vị 99 phải dưới 50 ms, và thừa CPU, nên ZGC — và đây là cái giá, ZGC đánh đổi ~5–10% throughput CPU lấy độ trễ đó." Và **không bao giờ dùng `System.gc()` như một cách chữa** — dưới Parallel nó là một cú pause STW toàn bộ mọi luồng trong nhiều giây; dưới G1 nó thậm chí có thể không kích hoạt thứ bạn nghĩ.

### Reference types — Soft, Weak, Phantom

Phỏng vấn viên GC mê reference types vì lạm dụng trên production quá phổ biến:

- **`SoftReference`** — được giữ sống tới khi JVM thấy bộ nhớ căng; sống qua GC thường, bị thu khi áp lực. Đúng cho "cache tự co lại khi máy nóng", nhưng phụ thuộc JVM và hiếm khi là một ngân sách bộ nhớ chính xác.
- **`WeakReference`** — bị thu ở GC kế tiếp, không chờ đợi. Đúng cho identity map key bởi object chóng tàn (một `WeakHashMap` key bởi request context).
- **`PhantomReference`** — referent đã unreachable khi reference được đưa vào queue, nên bạn có thể giải phóng native resource an toàn tại đó; bạn **phải** gọi `clear()` nếu không nó không bao giờ được thu. Đây là sự thay thế hiện đại cho đường `finalize()` đã bị deprecated (JEP 421, deprecated từ JDK 18) — kết hợp với `ReferenceQueue`/`Cleaner`.

```java
// SAI — finalize để dọn native: không dự đoán được, có thể bị resurrect, deprecated
@Override protected void finalize() { nativeFree(handle); }

// ĐÚNG — PhantomReference + ReferenceQueue: dọn dẹp chạy trên thread drainer
// của bạn chỉ khi object đã chứng minh là unreachable, không bao giờ trên GC thread
ReferenceQueue<Resource> queue = new ReferenceQueue<>();
PhantomReference<Resource> ref = new PhantomReference<>(resource, queue);
// thread drainer: poll queue; với mỗi ref → nativeFree(handle) và ref.clear()
```

### Failure mode trên production

- **GC không nghĩa là bạn hết việc quản lý bộ nhớ.** Cache không giới hạn, static collection, và thread-local reference vẫn khiến bạn OOM — GC không thu được cái code bạn giữ rễ (rooted).

```java
// SAI — một "cache" thực chất là một root đang lớn dần
private static final Map<String, Expensive> CACHE = new HashMap<>();

// ĐÚNG — eviction theo size + thời gian; Caffeine là một ConcurrentHashMap
// với admission window W-TinyLFU, nên đây không phải "một timer + một map".
private static final Cache<String, Expensive> CACHE = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .build();
```

- **`ThreadLocal` rò rỉ trong thread pool.** Tinh vi hơn người ta nghĩ: **key** trong `ThreadLocalMap` là một `WeakReference`, nên key có thể bị thu — nhưng **value bị tham chiếu mạnh** và sống trong map entry cho tới khi slot đó bị expunge. Trong một pooled thread sống lâu không bao giờ chạm lại slot đó, value rò rỉ mãi. Một request-scoped context giữ blob 10 MB, đặt trên pool 200 thread → 2 GB "heap đầy không lý do". Cách sửa: `ThreadLocal.remove()` trong `finally`, hoặc scoped values (phần 4).
- **Allocation storm trong vòng lặp chặt** làm tăng tần suất GC, không phải thời gian pause. `jstat -gcutil` cho thấy FGC/FGCT leo lên trong khi heap không bao giờ sạch.
- **String interning bùng nổ.** `String.intern()` trên mọi response header mỗi request sẽ làm phình string table và old gen. `-XX:+PrintStringTableStatistics` sẽ cho bạn thấy.
- **`-histo:live` không miễn phí.** `jmap -histo:live` (và `jcmd GC.class_histogram -live`) kích hoạt một full GC — chạy nó chống lại heap production 50 GB lúc cao điểm là một incident tự gây. Ưu tiên `-histo` hoặc JFR.

## 2. JMM và visibility — happens-before, fences, và cái giá của một barrier

"Volatile làm write hiển thị" là câu trả lời mid. Câu trả lời senior là **happens-before edge** — hợp đồng thực sự mà JMM bảo đảm — cộng với cái giá phần cứng tính cho bạn. Câu hỏi "tại sao flag của tôi không hiển thị?" được trả lời bằng luật program-order + synchronizes-with, không bao giờ bằng "máy tôi nó cứ không chạy."

Những happens-before edge bạn thực sự có thể dựa vào:

- `volatile` write → `volatile` read sau đó trên cùng field.
- Mở khóa một monitor → khóa lại cùng monitor sau đó (nên `synchronized` cho visibility, không chỉ exclusion).
- `Thread.start()` → mọi thứ thread được start làm.
- Mọi thứ một thread làm → cái thread join thấy sau `join()`.
- Ghi một field `final` trong constructor → các read sau safe publication.
- `Atomic*` write → các read sau (CAS tạo thành một full fence).

```java
// SAI — classic vòng lặp vô hạn. stop có thể ở mãi trong register/cache của thread T;
// compiler còn có thể hoist read ra khỏi vòng lặp.
boolean stop = false;                 // không volatile
while (!stop) { doWork(); }

// ĐÚNG — volatile write trên T1 happens-before volatile read trên T2
volatile boolean stop = false;
while (!stop) { doWork(); }
```

### Cái bẫy double-checked locking họ luôn đào

Câu JMM kinh điển. Vấn đề không phải khóa — mà là read không đồng bộ có thể quan sát thấy một reference tới một object **chưa được xây xong**: việc lưu reference được phép trôi nổi lên trước khi các write trong constructor kết thúc (không có happens-before xuyên thread), nên thread B thấy `instance != null` và trả về một singleton xây dở.

```java
// SAI — DCL không volatile. Cả hai thread có thể quan sát một instance xây dở.
private static Singleton instance;
public static Singleton get() {
    if (instance == null) {                 // read không đồng bộ
        synchronized (Singleton.class) {
            if (instance == null) {
                instance = new Singleton();
            }
        }
    }
    return instance;
}

// ĐÚNG — volatile tạo happens-before edge constructor-write → read
private static volatile Singleton instance;
```

Trên JVM 64-bit, đọc `volatile long` là một load nguyên tử, nhưng trên **JVM 32-bit nó là hai nửa 32-bit** — nên `volatile long` chính xác là trường hợp "volatile" và "atomic" rẽ đôi. Trivia nhỏ phân loại người đọc JMM với người sống qua nó.

### Một fence giá bao nhiêu

`volatile` biên dịch xuống một memory barrier — trên x86 một lệnh có tiền tố `lock` hoặc một `mfence` cho trường hợp store-load. Nó không rẻ: một volatile write có fence chạy trong **hàng chục nanosecond**, so với ~1 ns cho một cache-local read. Cái thang latency là mô hình tinh thần phỏng vấn viên muốn nghe:

```
L1 cache hit:                ~1 ns
L2:                          ~4 ns
L3:                          ~10–15 ns
main memory:                 ~100 ns
fenced volatile write:       ~20–80 ns (store-load barrier)
NVMe random read:            ~20–50 µs
same-DC network round trip:  ~100–500 µs
```

Cái thang đó là lý do "cứ volatile hết đi" là một bug latency thật trong hot loop, và lý do false sharing — cái bẫy kế tiếp — đau đến vậy.

### volatile ≠ atomicity, và đáp án "chọn cái nào"

`volatile` cho visibility và ordering, **không** atomicity. `i++` là read-modify-write; hai thread có thể cùng đọc 41 và cùng ghi 42. Công cụ đúng phụ thuộc hình dạng của contention:

- **`AtomicLong`** — một CAS duy nhất trên một cache line. Nhanh tới khi các thread va nhau, rồi chúng spin-retry và cái line bật qua lại giữa các core.
- **`LongAdder`** — chia bộ đếm ra một tập các cell, một cell cho mỗi core bị tranh, và cộng lại ở `sum()`. Dưới contention nặng (nói ≥ 16 thread đập một bộ đếm) nó chạy **nhanh hơn nhiều lần** `AtomicLong` vì CAS retry biến mất. Trade-off: `sum()` là O(cells) và xấp xỉ dưới concurrent write — ổn cho metrics, sai cho một sổ nợ debit cần chính xác.

### False sharing — cái bẫy không phải khóa

Một cache line là 64 byte. Hai field **độc lập** nhưng nằm chung một line sẽ bị ping-pong coherence mỗi lần một trong hai bị ghi, kể cả trong code lock-free. Cái `long[]` bộ đếm mỗi thread là kinh điển: thread 0 sở hữu index 0, thread 1 sở hữu index 1 — liền kề trong bộ nhớ — và chúng giẫm lên nhau với chi phí gấp 10–100× dự kiến. `@Contended` (JEP 142) pad các field lên các line riêng, hoặc bạn chia slot mỗi thread theo độ rộng line. Khi phỏng vấn viên nói "bộ đếm lock-free của bạn còn chậm hơn cái `synchronized`", đây là điều họ đang thăm dò.

```
Bản báo cáo "tại sao counter của tôi 2% CPU mà chậm gấp 40×" là false sharing —
một coherence miss tốn ~100 ns traffic bộ nhớ mỗi lần ping, ở tần suất cao.
```

## 3. Concurrency primitives — phía dưới cái khóa có gì

### `synchronized` không phải một khóa, nó là một state machine

Một monitor khởi đầu **mỏng** — bit trong mark word của object, không có OS mutex. Dưới contention nó **inflate** thành monitor hạng nặng với wait queue và wait set cấp OS, và JVM áp dụng **adaptive spinning** trước khi park thread. Biased locking từng làm việc acquire không tranh chấp gần như miễn phí, nhưng nó đã **bị deprecate từ JDK 15 và gỡ khỏi JDK 18** — nói đúng cái mốc đó và bạn đã ra tín hiệu rằng mình theo dõi JEP. Bài học thực tiễn: `synchronized` không tranh chấp gần như miễn phí (một cập nhật mark word, ~hàng chục ns); `synchronized` tranh chấp trả giá một vòng park/unpark đi vào kernel — microsecond, tệ hơn đường không tranh chấp ba bốn bậc. Đó là _lý do_ bạn với tới atomics hoặc striping.

### `ReentrantLock` và AQS

`ReentrantLock`, `Semaphore`, `CountDownLatch` đều xây trên **AQS** (`AbstractQueuedSynchronizer`): một `volatile int state` duy nhất cộng một CLH-style wait queue, đột biến qua CAS và `LockSupport.park/unpark`. Khi bạn gọi `tryLock(2, TimeUnit.SECONDS)` bạn đang chạy một vòng CAS có thời hạn + park — núm fairness (`new ReentrantLock(true)`) làm waiter đi FIFO nhưng tốn throughput vì nhiều context switch hơn. Nước đi senior là chọn dựa trên failure mode:

```java
// SAI — block mãi chờ một khóa có thể không bao giờ tới
lock.lock();
try { update(); } finally { lock.unlock(); }

// ĐÚNG — một lease có deadline. Đây là cách tránh incident "thread kẹt,
// heap đầy thread chờ, không ai giữ khóa".
if (lock.tryLock(2, TimeUnit.SECONDS)) {
    try { update(); } finally { lock.unlock(); }
} else {
    // degrade: trả 503, bỏ qua, log — đừng treo
}
```

- **`ReentrantLock`** thêm `tryLock(timeout)`, nhiều `Condition` (await/signal với predicate có tên), và kiểm soát fairness — `synchronized` chỉ có đúng một wait set.
- **`StampedLock`** — cái khóa đa số không gọi tên nổi, chính vì thế nó là một probe tốt. **Optimistic read** của nó không bao giờ block: lấy một stamp, đọc, rồi `validate()` — nếu một writer chen vào, ngã về read lock thật. Tuyệt khi reader chiếm ưu thế và write hiếm; sai khi write dày, vì validate liên tục thất bại và bạn thrash.

```java
long stamp = lock.tryOptimisticRead();     // không khóa gì cả
int v = shared;
if (!lock.validate(stamp)) {               // writer lẻn vào?
    stamp = lock.readLock();
    try { v = shared; } finally { lock.unlockRead(stamp); }
}
```

- **`ConcurrentHashMap` (Java 8+)** dùng CAS cho bin rỗng và `synchronized` trên đầu bin cho va chạm; bin **treeify ở ≥ 8 entries** thành red-black tree (một bin toàn key hash trùng sẽ thoái hóa thành O(n)). `size()` là tổng của các base counter, nên nó **xấp xỉ** — nói to điều đó ra, nó là "gotcha họ kiểm tra" kinh điển.
- **Cái bẫy deadlock `computeIfAbsent`.** Nó giữ khóa của bin trong lúc mapping function của bạn chạy, nên một `computeIfAbsent` đệ quy trên **cùng key** từ bên trong chính nó làm deadlock bin trong Java 8 (sửa ở JDK 9 bằng một bin-occupancy re-check). Bản production: một cache xây value lười nhác, mà cái value đó lại nạp lười nhác chính cái value kia. Biết nó bằng tên.

```java
// SAI — deadlock Java 8: mapping function tính lại chính key đó
cache.computeIfAbsent(key, k -> cache.computeIfAbsent(k, x -> build(x)));

// ĐÚNG — tính một lần bên ngoài, hoặc dùng putIfAbsent semantics bạn kiểm soát
var v = cache.get(key);
if (v == null) { v = build(key); cache.putIfAbsent(key, v); }
```

### `CompletableFuture` — cái bẫy pool không ai đọc Javadoc

`thenApplyAsync` chạy trên **`ForkJoinPool.commonPool()`**, có parallelism là `availableProcessors - 1`. Khoảnh khắc một async task làm việc block — một call JDBC, một `Thread.sleep`, một block `synchronized` — nó ăn cắp một worker, và nếu đủ task block, pool cạn kiệt và **mọi thứ phía sau nghẽn dù máy đang rảnh**. Triệu chứng production: "chúng tôi thay futures bằng một thread pool to hơn và nó tự hết bệnh." Cách sửa của senior là truyền một executor tường minh được size cho công việc block:

```java
// SAI — JDBC blocking bên trong async code bỏ đói commonPool
CompletableFuture.supplyAsync(() -> accountRepository.findById(id).get())
    .thenApplyAsync(Account::getBalance);

// ĐÚNG — executor tường minh size theo Little's law (phần 4), hoặc virtual threads
CompletableFuture.supplyAsync(() -> accountRepository.findById(id).get(), jdbcExecutor)
    .thenApplyAsync(Account::getBalance, jdbcExecutor);
```

Sắc thái xử lý lỗi họ khoan sâu: `handle` thấy cả value lẫn throwable, `exceptionally` chỉ xử lý lỗi, và **một exception trong `thenApply` trả về một future completed exceptionally** — nên hãy quyết bạn muốn compose hay recover. Và nhớ: `thenCompose` (flatMap) vs `thenCombine` (zip) là khác biệt giữa một chuỗi và một fork-join.

## 4. Threads, thread pools, và virtual threads

### Size pool bằng Little's law — con số chấm dứt cuộc cãi

Câu trả lời ngây thơ là "cores × 2". Câu trả lời có thể bảo vệ là Little's law, vì với worker **blocking** thì pool là một băng chuyền:

```
pool_size = throughput × average time-in-pool
300 req/s × 80 ms thời gian JDBC+CPU trung bình = 24 workers
```

Với công việc **CPU-bound** không có số hạng chờ, nên pool nên đứng quanh số core (+1) — nhiều thread hơn core chỉ xếp hàng và switch. Hình dạng chung là `N = cores × (1 + wait/compute)` — hãy suy ra nó, đừng trích nguyên văn.

Oversize qua mức đó là hại thật: context-switch thrash, connection idle phía DB, và queue _bên trong_ database. Undersize làm request xếp hàng ở `connectionTimeout` tới khi latency leo rồi throughput sụp — cái incident kinh điển "DB vẫn khỏe, pool thì rỗng."

```java
// SAI — 200 thread vì máy có 64 core, queue vô hạn
// (queue vô hạn + task blocking = cái OOM "vùng đệm bộ nhớ vô hạn")
ExecutorService pool = new ThreadPoolExecutor(
    0, 200, 60, SECONDS, new LinkedBlockingQueue<>());   // vô hạn!

// ĐÚNG — Little's law nói ~25; queue có giới hạn; chính sách bão hòa tường minh
ExecutorService pool = new ThreadPoolExecutor(
    25, 25, 0, MILLISECONDS, new ArrayBlockingQueue<>(100), new CallerRunsPolicy());
```

`CallerRunsPolicy` — task bị từ chối chạy trên chính calling thread — là lựa chọn chống-OOM: nó thêm **backpressure** thay vì buffering hay dropping. Biết `AbortPolicy` (mặc định, ném exception), `DiscardPolicy`, và tại sao không cái nào backpressure ngoài `CallerRuns`. Và kiểm lại các mặc định JDK bạn _tưởng_ mình biết: `Executors.newFixedThreadPool` dùng `LinkedBlockingQueue` vô hạn, nên với task blocking nó là một vector OOM, không phải một pool. `SynchronousQueue` (dùng bởi `newCachedThreadPool`) là cực đối diện — một handoff zero-buffer.

### Platform thread đắt; virtual thread thì không

Một platform thread mang theo stack mặc định ~1 MB (virtual memory) cộng kernel scheduling; tạo một cái tốn microsecond và context-switch hàng chục ngàn cái đốt thời gian kernel thật. **Virtual threads** (Java 21+, Project Loom) là Java object với stack vài KB, được schedule trên một nắm **carrier threads** (một `ForkJoinPool` với parallelism = số CPU) — OS chỉ bao giờ thấy các carrier.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = urls.stream()
        .map(url -> executor.submit(() -> fetch(url)))
        .toList();
}
```

- **Chúng để làm gì:** công việc I/O-bound bị block — call HTTP, round trip DB, RPC. Một triệu call outbound đồng thời trên một thread-per-request platform-thread pool thì chết; trên virtual threads nó là một triệu stack rẻ.
- **Chúng KHÔNG phải:** thứ làm CPU-bound nhanh hơn. Vẫn chỉ có N CPU; một virtual thread CPU-bound chẳng lợi gì.
- **Pinning — cái bẫy:** một virtual thread block trong khi giữ một carrier resource thì pin nó. Trước JDK 24 nghĩa là bất kỳ **block `synchronized` nào**; **JEP 491 (JDK 24) gỡ pinning cho `synchronized`**, nên các nguồn còn lại là **native frame** bị block (JNI / Foreign Function & Memory API), **class loading / class initializers**, và **local file I/O trên Linux**. Khóa kiểu AQS như `ReentrantLock` chưa bao giờ pin — `LockSupport.park` hiểu virtual-thread và unmount thread, đó là hiểu lầm kinh điển. "Cái gì vẫn còn pin?" là tín hiệu theo dõi JEP hiện tại, và công cụ rà là JFR event `jdk.VirtualThreadPinned` (được nâng cấp ở JDK 24 để nói rõ _lý do_).
- **`ThreadLocal` trên virtual threads là một footgun:** mỗi virtual thread có map riêng, nên một `ThreadLocal` request-scoped trên một triệu virtual thread là một triệu entries. Người kế nhiệm là **scoped values** (`ScopedValue`), immutable, chỉ kế thừa trong structured-concurrency scope, và thu hồi rẻ — đó là thứ bạn nên nêu tên thay vì "dùng một ThreadLocal."
- **Virtual threads không gỡ bỏ cái chặn connection pool.** Một triệu virtual thread có thể cùng block trên một HikariCP pool với `maximumPoolSize` mặc định là 10 — bạn chỉ dời cái queue từ thread pool sang connection pool. Size connection bằng Little's law luôn (phần 5).

### Structured concurrency

"Triệu thread" kéo theo câu hỏi: làm sao cancel cả nhóm khi một cái thất bại? `StructuredTaskScope` (Java 21+) ràng buộc child task vào vòng đời của parent — `fork` các child, rồi `join` và xử lý shutdown khi lỗi, và khi scope kết thúc nó **tự động cancel mọi child còn đang chạy**. Failure mode mà thứ này diệt: một fan-out request âm thầm để lại 900 trong 1.000 call outbound chạy tiếp sau timeout. Nếu bạn đối chiếu "fire-and-forget futures rò rỉ công việc" với "`StructuredTaskScope` tắt cả fan-out", bạn đã trả lời câu hỏi concurrency-resilience trước khi nó được hỏi.

## 5. Cái database sống sau các method của bạn

Một cuộc phỏng vấn backend senior trôi từ JVM sang pools sang SQL, vì các failure mode đều cùng một hình dạng: một tài nguyên có giới hạn — heap, threads, connections, index pages — và một thứ gì đó âm thầm xếp hàng trên nó. Ba cái bẫy xuất hiện liên tục.

### Connection pools là Little's law, với một trần cứng

```java
// SAI — số thread và connection đều vô hạn: 500 request đồng thời
// → 500 JDBC connections → DB chạm max_connections và ai cũng timeout
```

```
connections = TPS × average query time
1.000 req/s × 20 ms avg query = 20 connections
rồi chặn nó — mặc định của HikariCP là 10; "cores × 10" là một heuristic khởi điểm tốt
```

Undersize làm request xếp hàng (cùng hình dạng "DB vẫn khỏe, pool thì rỗng" như phần 4); oversize thêm context switch và wait phía DB. Khi thread pool _và_ connection pool cùng xếp hàng, bạn gặp bản báo cáo nói "DB trung bình 0,1 ms mà app mất 800 ms."

### Index B-tree height — tại sao point lookup rẻ và scan thì không

Một index là một B+tree: page 8–16 KB, vài trăm key mỗi page (~500–1.000 nếu mỗi entry ~16 byte). Ở một tỷ row, cái cây chỉ cao **3–4 tầng**, nên một point lookup là 3–4 page fetch — và các tầng trên sống trong buffer pool, nên các fetch đó là read bộ nhớ ~100 ns, không phải disk. Đó là câu trả lời bằng số cho "vì sao indexed lookup nhanh."

Cái bẫy là hỏi một cột đã index theo cách không phải range:

```sql
-- SAI: hàm trên cột giấu nó khỏi B-tree → full scan
SELECT * FROM orders WHERE YEAR(created_at) = 2026;

-- ĐÚNG: predicate range trên cột thô → B-tree range scan
SELECT * FROM orders
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01';
```

Cùng họ: `LIKE '%needle%'` (leading wildcard = scan), phép toán trên cột, và `IS NOT NULL` trên một cột đa số null. Phỏng vấn viên xem bạn nói "tùy selectivity" hay phát biểu trống rỗng "index làm mọi thứ nhanh."

### N+1 — cái query bạn không nhận ra mình đã viết

```java
// SAI — một query cho các order, rồi thêm một query cho mỗi order = N+1 round trip.
// Với 1.000 order đó là 1.001 query × ~1 ms network+parse mỗi cái → ~1 s
// latency không bao giờ xuất hiện trong bất kỳ slow-query log nào.
for (Order order : orders) {
    count += itemRepo.findByOrderId(order.getId()).size();
}

// ĐÚNG — một round trip cho tất cả; batching (ví dụ Hibernate @BatchSize)
// là lựa chọn giữa chừng khi IN-list trở nên vô lý.
var ids = orders.stream().map(Order::getId).toList();
long count = itemRepo.findByOrderIdIn(ids).size();
```

```sql
-- cùng hình dạng trong SQL
SELECT * FROM item WHERE order_id IN (1001, 1002, /* ... */);
```

Dấu hiệu senior không chỉ là biết N+1 tồn tại — mà là biết _nó ẩn ở đâu_: `@ManyToOne` lazy-load được serialize vào DTO, per-row JSON enrichment, một `findById` trong một `map()`. Và cách sửa thường dời vấn đề: batching giúp, nhưng câu trả lời thật thường là "fetch DTO bạn thực sự cần bằng JOIN, không phải các entity."

## 6. JVM internals phỏng vấn viên mê

- **Class loading và ba loader.** bootstrap (parent null, `java.*`), platform (JDK 9+; thay extension loader), application (classpath). **Parent-delegation** — một classloader trước tiên hỏi cha nó — là một cơ chế bảo mật và nhất quán: bạn không thể lén nhét một `java.lang.String` giả. Một senior kể lạnh lưng các failure mode: `ClassNotFoundException` được ném bởi `Class.forName`/`loadClass` tường minh khi class **không được tìm thấy**; `NoClassDefFoundError` được ném ở **lúc link/use** khi class _từng có_ lúc biên dịch nhưng giờ thiếu hoặc thất bại khi initialize ở runtime — điển hình là thiếu dependency JAR hoặc một exception trong static initializer đã hủy việc load. Biết sự khác biệt lạnh lưng.
- **Classloader leak OOM Metaspace của bạn.** Mỗi lần redeploy app (Tomcat, Spring Boot dev-mode reload, dynamic proxying/bytecode gen) tạo một classloader; nếu thứ gì root cái loader cũ — một static field, một JDBC driver đăng ký trong `DriverManager`, một proxy bị cache — metadata của nó không bao giờ unload, và **Metaspace** (class metadata, không giới hạn theo mặc định) leo tới khi native memory chết. `jcmd <pid> VM.native_memory` cộng `-XX:MaxMetaspaceSize` là kho vũ khí. Con số người ta đánh giá thấp: một leak lớn vài MB mỗi reload trông vô hại cho tới khi nó thành 2 GB sau một trăm lần deploy.
- **JIT là lý do code ấm chạy nhanh.** Tiered compilation: C1 (client, warmup nhanh) rồi C2 (server, tối ưu mạnh: inlining, escape analysis, loop unrolling), với **OSR** (on-stack replacement) để đổi sang code đã tối ưu giữa vòng lặp và **deoptimization** khi một giả định vỡ. "Request đầu tiên sau deploy bị chậm" là JIT warmup, và profiling cho thấy nó như các sự kiện compilation — không phải "ta cần một cái máy to hơn." `-Xlog:jit+compilation=debug` cho thấy dòng thác recompile. Gotcha production: một hot method vẫn không nhanh sau traffic vì call site **megamorphic** (quá nhiều loại receiver để inline), hoặc vì nó recompile liên tục quá `-XX:CompileThreshold`.
- **`String`, caches, và `==`.** `String` immutable theo hợp đồng lẫn layout (private `byte[]`), cho phép constant pool và chia sẻ an toàn; **string pool được chuyển từ perm gen sang heap ở JDK 7**. `Integer.valueOf` cache **-128..127** (có thể nới bằng `-XX:AutoBoxCacheMax`); `Long` cache cùng khoảng đó. Nên `==` trên wrapper "hoạt động" trong khoảng cache và cắn người ngoài khoảng — loại bug tệ nhất có thể: vì nó qua tests và chết trên production ở 128.

```java
Integer a = 127, b = 127;   // được cache → a == b là true
Integer c = 128, d = 128;   // object mới → c == d là false
```

- **Records** là câu trả lời hiện tại thân thiện với phỏng vấn: chúng là class mà `equals`/`hashCode`/`toString`/accessor được dẫn xuất từ danh sách component, `final` do cấu trúc, và serialization được định nghĩa trên component. Nói thật trade-off: chúng là một giá trị-semantics _mặc định_, không phải một value object — nếu equality theo business key chứ không phải mọi field, bạn vẫn phải tự viết `equals`.
- **Stack depth là một tài nguyên thật.** `-Xss` mặc định là 512 KB–1 MB; đệ quy sâu — một JSON walker đệ quy, một tree traversal ngây thơ — ném `StackOverflowError` khi các frame vượt nó, và đó là một lỗi phía native, không phải heap. Hỏi "stack size trên máy này là bao nhiêu?" trước khi đề xuất xử lý nặng đệ quy.

## 7. Runtime & tooling — chứng minh bạn từng debug production

Senior nói: "khi production chậm, tôi không đoán — tôi đo." Phỏng vấn viên không thể kiểm chứng kiến thức tool của bạn từ một định nghĩa; họ _có thể_ nghe một incident thật. Hãy có một cái trong túi theo hình dạng này: symptom → hypothesis → tool → finding → fix.

Bộ toolkit, với mỗi cái thực sự dùng để làm gì:

- **`jstack`** — thread dumps. Tìm `BLOCKED` threads chất đống trên một monitor, deadlock (chính JVM in một phần deadlock), hoặc một `RUNNABLE` thread kẹt trong socket read. Chụp **ba dumps cách nhau vài giây** — một dump đơn là một bức ảnh nhòe.
- **`jmap -histo`** — object histogram; tìm class giữ hàng trăm MB (`byte[]`, `char[]` đứng đầu bảng một cách đáng ngờ) và truy dấu ai root nó. Dùng biến thể non-live trên prod — `-histo:live` ép một full GC (phần 1).
- **`jstat -gcutil`** — tần suất và xu hướng pause GC _theo thời gian_, đây là cách bạn phát hiện allocation storm hoặc old gen phình to trước khi OOM.
- **`jcmd`** — con dao đa năng: `jcmd <pid> GC.heap_dump`, `VM.native_memory`, `Thread.print`, `VM.flags`. `jmap` dành cho dump; `jcmd` cho quan sát nội tại lúc sống.
- **JFR (Java Flight Recorder)** — JDK 11+ gồm sẵn miễn phí. Event cho GC phase pause (`jdk.GCPhasePause`), allocation (`jdk.ObjectAllocationInNewTLAB`), lock contention (`jdk.JavaMonitorEnter`), virtual-thread pinning (`jdk.VirtualThreadPinned`), method sampling, socket reads. Bắt đầu với `jcmd <pid> JFR.start name=profile settings=profile`, rồi `jfr view` file. Overhead ở cấu hình mặc định dưới 1% — nói điều đó, nó là killer feature.
- **async-profiler** — on-CPU + off-CPU wall-clock + allocation + lock profiling với flamegraph, không có JVMTI agent trong hot path. Đây là cái tìm ra _tại sao_ CPU cao, không chỉ _rằng_ nó cao.
- **GC logs.** `-Xlog:gc*` (JDK 9+ unified logging) với `-Xlog:gc:file=gc.log:time,uptime`. Đọc các pause _và_ heap-sau-GC; một service có heap sau GC cứ leo là đang leak, một service pause dài mà heap phẳng là bài toán sizing.

Một câu chuyện mẫu: "P99 latency tăng gấp đôi sau release. `jstat -gcutil` cho thấy FGC nhảy mỗi 2 phút; `jmap -histo` cho thấy 800 MB `byte[]`; JFR allocation event chỉ vào code gzip mới; cách sửa là streaming + pooling các buffer. P99 về lại 40 ms." **Đoạn đó, trong một buổi phỏng vấn, đáng giá hơn bất kỳ định nghĩa nào bạn có thể đọc thuộc.**

## 8. Tự kiểm tra

- [ ] Giải thích TLAB allocation, và tại sao escape analysis làm `new` đôi khi không tốn gì.
- [ ] Phát biểu ngưỡng 32 GB compressed oops và tại sao heap 40 GB có thể chậm hơn heap 28 GB.
- [ ] Đưa ra phép tính pause: cái gì kiểm soát một young-gen STW pause, và G1 đánh đổi tần suất vs thời lượng thế nào.
- [ ] Nêu tên concurrent-mode failure, evacuation failure, và luật humongous-object của G1.
- [ ] SoftReference vs WeakReference vs PhantomReference — khi nào mỗi loại đúng?
- [ ] Nêu tên các happens-before edge của `volatile`, monitor unlock→lock, `start()`/`join()`.
- [ ] Viết double-checked locking đúng và giải thích vì sao bản không-volatile hỏng.
- [ ] Giải thích vì sao `LongAdder` đánh bại `AtomicLong` dưới contention, và khi nào nó là công cụ sai.
- [ ] False sharing là gì, và `@Contended` làm gì?
- [ ] Optimistic read của `StampedLock` làm gì, và khi nào nó thrash?
- [ ] Chuyện gì xảy ra với `thenApplyAsync` trên `commonPool` khi một task block, và cách sửa?
- [ ] Size một thread pool bằng Little's law, và chọn một chính sách bão hòa có backpressure.
- [ ] Khi nào virtual threads giúp, khi nào không, và thứ gì vẫn pin một carrier sau JDK 24?
- [ ] `ClassNotFoundException` vs `NoClassDefFoundError`, và cái gì làm Metaspace leak khi redeploy.
- [ ] Giải thích B-tree height và tại sao `WHERE YEAR(col) = ?` scan trong khi predicate range thì không.
- [ ] Một incident GC/perf bạn thực sự tìm ra bằng profiling tool.

Nếu những thứ đó thấy dễ, bạn sẵn sàng phần Java core.

## 9. Follow-ups từ phỏng vấn viên

Khi câu trả lời đầu tiên của bạn đáp xuống, họ bắt đầu khoan. Sẵn sàng cho những câu này:

- "Service của bạn chạy 2.000 req/s và mỗi request block ~50 ms trong JDBC. Size thread pool. Giờ nếu 10% call mất 5 giây thì sao?"
- "Cùng service đó: bạn cấp bao nhiêu DB connection, và chuyện gì xảy ra với các virtual thread khi pool là 10?"
- "Bạn nói G1 pause là một mục tiêu mềm. Dẫn một dòng log `gc` chứng minh G1 trượt `MaxGCPauseMillis`, và bạn sẽ đổi gì?"
- "`volatile` cho happens-before. Điều đó có làm một `volatile int` an toàn làm counter không? Nếu là `volatile long` trên JVM 32-bit thì sao?"
- "Tôi viết code `synchronized` và nó chậm hơn bản `ConcurrentHashMap`. Có phải `synchronized` hỏng?"
- "`ThreadLocal` trong thread pool của bạn đang giữ 200 MB. Cái gì thực sự root nó, cách sửa là gì — và thứ thay thế trong tương lai?"
- "Giải thích tại sao JDK 24 đổi hành vi pinning, và thứ gì vẫn pin một virtual thread."
- "`SELECT * FROM orders WHERE YEAR(created_at) = 2026` chậm, và cột có index. Tại sao, và bạn viết lại thành gì?"
- "Bạn thấy `OutOfMemoryError: Metaspace` sau một redeploy mà không thêm class nào. Lệnh đầu tiên của bạn là gì, và bạn tìm gì?"
- "Một hot method vẫn chậm sau 10 phút traffic. JIT có thể đang làm gì, và bạn chứng minh bằng log thế nào?"

Đó là bar Java core.
