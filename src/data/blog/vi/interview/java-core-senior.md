---
title: "Ôn thi Java #1: Java Core (JVM, GC, Concurrency) — Junior đến Senior"
description: "Bộ lọc kết thúc nhiều buổi phỏng vấn hơn system design. JVM memory, garbage collection, JMM, và concurrency. 50 câu hỏi phỏng vấn từ 'heap là gì' đến 'tôi đã giảm một nửa GC pause trên service 40 GB thế nào'."
pubDatetime: 2026-08-10T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

Java core là bộ lọc kết thúc nhiều buổi phỏng vấn hơn system design. Junior học thuộc keyword; senior chứng minh họ đã nhìn heap dump lúc 3 giờ sáng. Bài này đi từ "heap là gì" đến "tôi giảm một nửa GC pause trên service 40 GB thế nào" — 50 câu hỏi, chọn mức bạn phỏng vấn, và đọc cao hơn một mức.

> Mindset: junior gọi tên các garbage collector; senior kể được cái nào đã pause service họ quý trước, bao nhiêu, và họ đổi gì.

## Junior — nền tảng

**Q1. Các vùng nhớ chính của JVM?**
JVM chia memory thành: **heap** (mọi instance object, chia sẻ, GC quản lý), **metaspace** (metadata class, trước là permgen), **stack** mỗi thread (frame, local, operand), **PC register** mỗi thread, và **native method stack**. Mọi thứ bạn `new` nằm trong heap; mỗi method call push một frame lên thread stack. Heap thường chiếm 70–90% RAM process Java; metaspace bắt đầu ~20 MB và tăng.

**Q2. Khác nhau giữa `==` và `equals()`?**
`==` so sánh reference (cùng object trong memory). `equals()` so sánh _logical_ equality; bạn phải override nó (cùng `hashCode()`) hoặc thừa kế so sánh reference từ `Object`. Hai `String` cùng ký tự chỉ `==` vì string pool interns literals:

```java
String a = "java";
String b = new String("java");
System.out.println(a == b);        // false — object khác nhau
System.out.println(a.equals(b));   // true  — cùng ký tự
```

**Q3. Primitive types là gì, có phải object không?**
`byte, short, int, long, float, double, char, boolean` — tám primitive, lưu by value, không phải object. Mọi thứ khác là reference đến heap object. Autoboxing (`int`↔`Integer`) che giấu allocation; `IntegerCache` interns -128..127, nên `Integer.valueOf(42) == Integer.valueOf(42)` là `true` nhưng `Integer.valueOf(200) == Integer.valueOf(200)` là `false`.

**Q4. `String`, `StringBuilder`, `StringBuffer` — khác gì?**
`String` immutable — mỗi concat allocate object mới. `StringBuilder` mutable, không thread-safe (nhanh). `StringBuffer` tương tự nhưng `synchronized` (chậm, hiếm cần). Trong loop, `+=` trên `String` là O(n²) allocation; dùng `StringBuilder`.

**Q5. `final`, `finally`, `finalize` — nghĩa gì?**
`final` cấm subclassing (class), override (method), hoặc reassignment (variable). `finally` chạy sau `try`/`catch` bất kể exception (cleanup). `finalize()` là hook deprecated GC gọi trước khi reclaim object — đừng bao giờ dựa vào; dùng `try-with-resources` hoặc `Cleaner`.

**Q6. Checked vs unchecked exception?**
Checked (`Exception` trừ `RuntimeException`) phải catch hoặc declare; model điều kiện recoverable. Unchecked (`RuntimeException`, `Error`) không cần declare. Code hiện đại thích unchecked cho programming error, giữ checked cho failure thực sự external.

**Q7. Autoboxing là gì và trap nó gây?**
Autoboxing convert primitive sang wrapper (`int`→`Integer`) tự động. Trap: `Integer` là object, nên `Map<Integer,String>` lookup với primitive key auto-box, và unbox `null` throw `NullPointerException`:

```java
Integer i = null;
int x = i;   // NullPointerException lúc runtime — unbox của null
```

**Q8. Khác nhau `int` và `Integer` trong collection?**
Collection chỉ lưu object, nên `List<Integer>` box mỗi `int`, thêm ~16 bytes overhead mỗi giá trị + GC pressure. Với 1M ints đó là ~16 MB wrapper objects. Dùng `int[]` hoặc `IntStream`/array khi size và speed quan trọng.

**Q9. `switch` trên `String` (Java 7+) hoạt động ra sao?**
Compiler hash string và so sánh qua `equals` trong lookup ẩn — O(1) amortized nhưng có cost `hashCode`+`equals` ẩn, không phải jump-table của `int`/`enum`. Cho hot path thích `enum` switch (~1 ns) hơn `String` (~10–20 ns).

**Q10. `static` block là gì và chạy khi nào?**
`static {}` chạy một lần, khi class đầu tiên load (lazy, lúc first use). Nó init static state. Bug thường: static initializer throw để lại class vĩnh viễn unloadable (`ExceptionInInitializerError`).

**Q11. Khác nhau `this` và `super`?**
`this` chỉ instance hiện tại; `super` chỉ implementation của superclass. `super()` (câu lệnh đầu trong constructor) gọi parent constructor; bỏ nó ngầm gọi no-arg parent constructor.

**Q12. Thứ tự giải quyết method overloading?**
Compiler chọn overload cụ thể nhất applicable tại compile time (KHÔNG chọn theo runtime type). Ambiguity (vd `log(Object)` vs `log(String)` với `null`) là compile error, không phải runtime choice.

**Q13. Giá trị mặc định của field chưa init vs local?**
Object field có type default (`0`, `false`, `null`); local variable uninitialized và compiler cấm dùng trước assignment. Đó là lý do `int x; System.out.println(x);` không compile.

**Q14. Khác nhau `>>` và `>>>`?**
`>>` là signed right shift (sign bit replicate); `>>>` là unsigned (zero-filled). Với số âm chúng khác: `-8 >> 1` là `-4`, `-8 >>> 1` là số dương rất lớn. Dùng `>>>` khi treat bit là unsigned data.

**Q15. Khác nhau `Math.round`, `ceil`, `floor`?**
`round` trả `long`/`int` gần nhất (0.5 làm tròn lên); `ceil` làm tròn lên `double` kế; `floor` làm tròn xuống. `Math.round(-2.5)` là `-2` (về +∞, không "xa 0") — trap thường gặp.

## Mid — tradeoff & điểm mù

**Q1. Generational GC hoạt động ra sao, và gì vỡ ở production?**
Heap chia thành **young** (Eden + hai Survivor) và **old**. Hầu hết object chết trẻ: minor GC copy survivor Eden→Survivor, rồi Survivor→old khi age out. **Major/full GC** collect old generation và có thể pause mọi app thread vài giây trên heap lớn. Failure kinh điển: unbounded cache đầy old gen → full GC thường xuyên → **stop-the-world pause 1–5 s** → p99 latency nổ. Fix: bound cache, tune `-Xmx`, hoặc chuyển sang low-pause collector.

**Q2. G1 vs ZGC vs Shenandoah — khi nào chọn nào?**

- **G1** (default từ Java 9): region-based, target pause-time goal (`-XX:MaxGCPauseMillis=200`). Mặc định tốt đến heap vài chục GB.
- **ZGC** (production từ Java 15): concurrent, sub-millisecond pause ngay cả heap **multi-terabyte**, nhưng CPU/throughput overhead cao hơn.
- **Shenandoah**: mục tiêu concurrent tương tự, cũng sub-ms pause.
  Một số nhớ: G1 pause ~tens-to-hundreds ms trên heap lớn; ZGC ~<1 ms bất kể heap size.

**Q3. Java Memory Model và `volatile` quan trọng vì sao?**
JMM định nghĩa _happens-before_: write vào `volatile` field happens-before mọi read sau của nó, cho visibility xuyên thread. Không `volatile`, thread có thể đọc stale cached value và không thấy update của thread khác. Nhưng `volatile` **không atomic cho compound action** — `volatile int n; n++` vẫn là race (read-modify-write). Dùng `AtomicInteger`.

**Q4. `synchronized` vs `ReentrantLock` — bạn với tới cái nào?**
`synchronized` đơn giản, JVM-optimized, tự release. `ReentrantLock` thêm: try-lock với timeout (`tryLock(100, ms)` tránh deadlock hang), option fairness, và nhiều condition variable. With tới `ReentrantLock` chỉ khi cần timeout hoặc interruptible acquisition; không thì `synchronized` sạch hơn.

**Q5. Nguy hiểm của tạo thread thủ công?**
`new Thread(() -> ...).start()` mỗi task cạn OS thread và không có queueing, monitoring, hay backpressure. Fix là **thread pool** qua `Executors` hoặc tốt hơn `new ThreadPoolExecutor(core, max, keepAlive, queue, factory, rejectionPolicy)`. Bug thường: `Executors.newFixedThreadPool` dùng **unbounded `LinkedBlockingQueue`** — nếu task nhanh hơn consumer, queue tăng đến **OutOfMemoryError**. Bound nó.

**Q6. `ConcurrentModificationException` — gì và tránh thế nào?**
Nó bắn khi collection bị structurally modify trong lúc iterate (trừ qua iterator's own `remove`). Fix: iterate với `Iterator.remove()`, dùng concurrent collection (`CopyOnWriteArrayList`, `ConcurrentHashMap`), hoặc collect-to-remove rồi `removeAll`. `CopyOnWriteArrayList` tuyệt cho read-heavy, rarely-written list (snapshot-on-write, ~O(n) mỗi write).

**Q7. `hashCode` contract và tại sao `HashMap` cần nó?**
Object bằng phải có hash code bằng; object không bằng _nên_ có hash khác để tránh collision. `hashCode` tệ (vd constant) collapse mọi key vào một bucket → `HashMap` degrade từ O(1) thành O(n) — map 1M entry thành linked list scan线性 (~microseconds mỗi op thay vì ~50 ns).

**Q8. `HashMap` resize thế nào, và tại sao đắt?**
Khi entries vượt `capacity × loadFactor` (mặc định 0.75), nó double capacity và rehash mọi entry vào bucket mới. Map tăng từ 1M sang 2M rehash 1M entry trong một bước stop-the-world (~tens of ms). Pre-size với `new HashMap<>(expectedSize)` để tránh resize giữa run.

**Q9. False sharing là gì và chứng minh thế nào?**
Hai field `long` thường write trên cùng một cache line 64-byte bị invalidate xuyên core dù logic độc lập. Triệu chứng: scaling tệ hơn với nhiều thread. Chứng minh: thêm `@Contended` padding — nếu throughput nhảy, bạn có false sharing. `LongAdder` bake sẵn. Trong một service, `@Contended` trên hot counter field đưa loop từ 40M lên 220M ops/s.

**Q10. `volatile` vs `AtomicReference` — khi nào cái nào?**
`volatile` cho visibility + single-field atomicity cho primitive/reference nhưng không cho compound action. `AtomicReference`/`AtomicInteger` cho atomic read-modify-write dựa CAS (`compareAndSet`), thiết yếu cho lock-free counter và state machine. Dùng `Atomic*` khi cần "check-then-act" atomic.

**Q11. Cost của `synchronized` contention?**
Uncontended `synchronized` ~20–30 ns (biased-lock fast path). Dưới heavy contention nó balloon lên microseconds khi thread park/unpark và OS schedule chúng. Hot uncontended lock rẻ; hot _contended_ lock là cost thực.

**Q12. Tại sao `Double.parseDouble` / `String` concat là hidden cost trong hot loop?**
`String` concat trong loop allocate `StringBuilder` + char array mới mỗi iteration (~tens of ns + GC). `Double.parseDouble` ~100–200 ns và allocate. Trong hot path làm 1M/s, đó là 100–200 ms/s pure parsing — move nó ra ngoài hoặc cache result.

**Q13. Khác nhau `Runnable` và `Callable`?**
`Runnable.run()` trả `void` và không throw checked exception. `Callable.call()` trả result và có thể throw. Submit `Callable` vào `ExecutorService` và lấy `Future<T>` cho result/exception.

**Q14. `Future.get()` blocking behavior, và form timeout?**
`future.get()` block calling thread đến khi complete. Không timeout nó có thể block mãi nếu task kẹt — luôn dùng `get(timeout, unit)` để hung task throw `TimeoutException` thay vì hang thread vĩnh viễn.

**Q15. `InterruptedException` — tại sao không được nuốt?**
Nó báo thread được yêu cầu stop (qua `interrupt()`). Nuốt nó (catch và ignore) phá propagation của cancellation — task ignore interrupt không bao giờ shutdown sạch. Re-interrupt: `Thread.currentThread().interrupt();` sau khi catch.

**Q16. Khác nhau daemon và non-daemon thread?**
JVM exit khi chỉ còn daemon thread; non-daemon thread giữ nó sống. Đừng làm việc quan trọng trên daemon thread — nó có thể bị kill giữa task lúc JVM shutdown không cleanup.

**Q17. `ThreadLocal` và leak kinh điển?**
`ThreadLocal` cho mỗi thread bản copy riêng. Trong thread pool, `ThreadLocal` set và không remove leak xuyên task dùng cùng pooled thread — nguyên nhân kinh điển của cross-request data bleed và PermGen/metaspace growth. Luôn `remove()` trong `finally`.

## Senior — thiết kế & phòng thủ

**Q1. Service show pause 3 s mỗi vài phút dưới load. Điền chẩn đoán.**
"Đầu tiên tôi confirm nó là GC, không phải network: `-Xlog:gc*:time` show full GC align với pause. Heap graph climb rồi drop — leak hoặc unbounded cache. Tôi chụp heap dump tại trough sau full GC (`jmap -dump` hoặc `-XX:+HeapDumpOnOutOfMemoryError`) và mở bằng Eclipse MAT, sort theo retained size. Thường là static `Map` hoặc thread-local không clear. Fix: cap structure (Caffeine với `maximumSize` + `expireAfterWrite`), hoặc move data ra khỏi JVM. Rồi chuyển G1 → ZGC nếu latency vẫn cắn. Tôi đo p99 before/after; target <200 ms."

**Q2. Bạn phải share counter xuyên 64 thread tại 1M ops/s. Thiết kế.**
"Naive `AtomicLong.incrementAndGet()` serialize trên một cache line — false sharing và ~tens of M ops/s ceiling. Lựa chọn: `LongAdder` (JDK 8+) shard counter qua các cell, trade exact read lấy throughput — dễ 5–10× cao hơn. Tại 1M ops/s `LongAdder` là lựa chọn đúng; read là `sum()` (approximate nhưng ổn cho metric). Tôi pin nó vào metrics path, không phải correctness-critical counter, và document."

**Q3. Giải thích false sharing và chứng minh nó tốn performance thế nào.**
"Hai field `long` thường write trên cùng cache line 64-byte bị invalidate xuyên core dù logic độc lập. Triệu chứng: scaling tệ hơn với nhiều thread. Chứng minh: annotate padding (`@Contended`, hoặc manual 64-byte padding) — nếu throughput nhảy, bạn có false sharing. `LongAdder` bake sẵn. Trong một service, thêm `@Contended` vào hot counter field đưa loop từ 40M lên 220M ops/s."

**Q4. Khi nào KHÔNG dùng thread pool, và thay bằng gì?**
"Cho blocking I/O ở scale — pool N thread cap concurrency tại N và chúng đều stall trên socket. Virtual thread (Java 21+, `Executors.newVirtualThreadPerTaskExecutor()`) cho bạn spawn hàng triệu rẻ; mỗi blocking call park thay vì pin OS thread. Rule: dùng virtual thread cho I/O-bound task-per-request; giữ platform-thread pool cho CPU-bound nơi bạn muốn hard concurrency cap."

**Q5. `HashMap` dùng bởi nhiều thread, thỉnh thoảng trả null cho key đã put. Tại sao, và fix?**
"Nó không thread-safe — concurrent put có thể corrupt bucket structure hoặc resize mid-put mất entry (và ở Java cũ, có thể loop mãi). Fix: `ConcurrentHashMap` cho concurrent access. Nhưng note `ConcurrentHashMap.computeIfAbsent` atomic per-key; `get-then-put` không. Nếu cần compound atomic operation, dùng `compute`/`merge`, không phải hand-rolled check-then-act."

**Q6. Phòng thủ G1 vs ZGC bằng số?**
"Tôi baseline p99 latency và GC pause percent dưới production-like load (vd 500 rps, 30 GB heap). Nếu G1 pause ~150 ms và SLA p99 < 250 ms có headroom, G1 thắng trên throughput (ZGC tốn ~10–15% CPU). Nếu pause ăn SLA, ZGC <1 ms pause justify CPU tax. Tôi không chọn trên vibes — tôi chạy cả hai ở staging với cùng load và đọc GC log. Quyết định là tradeoff table, ký bằng measurement."

**Q7. Bạn có lock contended 80% thời gian. Bạn đổi gì?**
"Tôi hỏi trước tiên shared state có cần per-request không — thường nó shard được by key (vd `ConcurrentHashMap` của per-key lock, hoặc `StampedLock` cho read-heavy). Nếu read dominate, `ReentrantReadWriteLock` hoặc `StampedLock.tryOptimisticRead()` drop read path xuống ~nanosecond. Nếu thực sự là single hot counter, `LongAdder`. Đo lock hold time với `-Djdk.trace`/async-profiler before và after."

**Q8. Tìm CPU hotspot không có profiler GUI thế nào?**
"`async-profiler` với `./profiler.sh -e cpu -d 30 -f flame.html <pid>` sinh flame graph trong một command, không restart agent, ~1% overhead. Tôi tìm frame rộng nhất — đó là chỗ CPU đi. Cho allocation pressure, `-e alloc`. Cho lock contention, `-e lock`. Đó là nước đi đầu trước khi động vào code."

**Q9. Native memory leak (off-heap) — tìm thế nào?**
"Heap ổn nhưng RSS tăng không bound → off-heap. Check `-XX:MaxDirectMemorySize`, NIO direct buffer, và JNI. `jcmd <pid> VM.native_memory summary` show breakdown (metaspace, thread, code, direct). Tôi từng thấy Netty `ByteBuf` pool misconfigured leak 2 GB/hour thế này. Fix pool, không phải heap."

**Q10. `CompletableFuture` vs plain thread cho async orchestration?**
"Cho fan-out/fan-in của N call, `CompletableFuture.allOf(...)` compose chúng không block một thread mỗi call; callback chạy trên common `ForkJoinPool` (hoặc custom executor). Pitfall: default pool shared — callback chậm starve unrelated future. Tôi luôn pass explicit executor: `supplyAsync(task, myExecutor)`. Cũng không bao giờ block inside CF callback."

**Q11. Size thread pool đúng cách thế nào?**
"Little's Law: `pool ≈ target_concurrency × (avg_task_ms / acceptable_latency_ms)`. Cho 200 concurrent user tại 5 ms task và 100 ms budget, ~10, pad lên ~20. Cho CPU-bound work, `cores` đến `cores×2`. Oversize lãng phí memory (mỗi thread ~1 MB stack) và tăng context-switch cost; undersize queue work và raise latency. Tôi đo queue length và rejection rate, rồi tune."

**Q12. `StampedLock` là gì và khi nào hơn `ReentrantReadWriteLock`?**
"`StampedLock` thêm optimistic read mode: `tryOptimisticRead()` validate sau read với `validate(stamp)`, skip locking hoàn toàn khi không có writer — ~nanosecond read vs ~microsecond cho RWLock. Cost: không reentrant và writer có thể starve. Dùng nó chỉ cho read-heavy, simple critical section nơi bạn structure read để retry trên invalidation."

**Q13. Object pooling — khi là win vs liability?**
"Pooling tránh allocation + GC cho object rất đắt để tạo (DB connection, buffer lớn). Cho cheap object (small DTO) nó là liability — allocation ~10 ns và pool thêm contention + correctness bug (quên reset state). Rule: chỉ pool thứ có creation cost >~1 µs hoặc external resource; để GC handle phần còn lại."

**Q14. Làm shutdown graceful dưới load thế nào?**
"`Runtime.getRuntime().addShutdownHook` drain in-flight request: stop accept work mới, `executor.shutdown()` rồi `awaitTermination(30s)`, rồi `shutdownNow()` để interrupt straggler. Kubernetes gửi SIGTERM; không có hook bạn bị abrupt connection reset và lost write. Tôi verify với load test abort giữa flight và check zero lost commit."

**Q15. `var` (Java 10+) — khi dùng?**
"`var` infer local type: `var map = new HashMap<String,List<Integer>>()` remove noise. Đừng dùng chỗ type non-obvious (method trả `var` từ complex expression) — readability thắng. Nó local-only; không bao giờ trong signature hay field. Dùng khéo nó giảm ~20% verbose type declaration với zero runtime cost."

**Q16. Java 21 đổi gì bạn thực dùng production?**
"Virtual thread (stable ở 21) cho I/O-bound concurrency — thay thread-per-request pool. `switch` pattern matching và record pattern giảm boilerplate. `SequencedCollection` cho ordered collection. String template (preview). Tôi adopt virtual thread trước — nó là bước nhảy lớn nhất từ stream, ~0 code change lấy massive concurrency headroom."

**Q17. Chứng minh `volatile` fix thực sự fix được race thế nào?**
"Tôi reproduce với stress test: 100 thread làm check-then-act trên non-volatile flag, chạy 10k iteration, assert không stale read. Với `-Xint` (interpreter-only) để remove JIT masking, race show nhanh hơn. Rồi thêm `volatile` và re-run — failure rate drop về 0. Ở prod tôi confirm qua canary + metric show anomaly (vd double-debit count) chạm 0."

**Q18. Library bạn depend làm `System.gc()` trong hot path. Bạn làm gì?**
"`System.gc()` là full-stop-the-world suggestion JVM thường honor — nó có thể pause 100 ms+ trên heap lớn, destroy latency. Tôi thử `-XX:+DisableExplicitGC` trước (nếu library không rely vào nó cho correctness, điều nó không nên). Nếu break, fork/patch library hoặc isolate nó trong process riêng. Không bao giờ để dependency dictate GC behavior của bạn."

#### Self-check

- [ ] Junior: Tôi gọi được vùng nhớ JVM, giải thích `==` vs `equals`, primitive vs wrapper, autoboxing trap, checked vs unchecked exception, và basic bit/rounding.
- [ ] Mid: Tôi mô tả được generational GC, chọn G1 vs ZGC, giải thích `volatile`/JMM, tránh unbounded thread-pool queue, giải thích `HashMap` resize và false sharing, và handle `InterruptedException` đúng.
- [ ] Senior: Tôi chẩn đoán được GC pause từ log + heap dump, thiết kế 1M-ops/s counter, giải thích false sharing, phòng thủ collector choice với before/after number, orchestrate async với `CompletableFuture`, size pool từ Little's Law, và làm shutdown graceful.
