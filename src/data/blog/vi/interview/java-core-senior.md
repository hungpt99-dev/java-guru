---
title: "Ôn thi Java #1: Java Core (JVM, GC, Concurrency) — Junior đến Senior"
description: "Xương sống của mọi buổi phỏng vấn Java — bộ nhớ JVM, thu gom rác, JMM và concurrency. Junior thuộc tên; senior chứng minh từng đứng nhìn heap dump lúc 3 giờ sáng."
pubDatetime: 2026-08-10T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

Java core là bộ lọc loại nhiều ứng viên hơn cả system design. Đây là nơi một junior có thể học thuộc từ khóa, còn một senior có thể chứng minh mình từng nhìn vào heap dump lúc 3 giờ sáng. Bài này đi cùng một chủ đề, từ "heap là gì" đến "tôi đã giảm một nửa GC pause trên service 40 GB như thế nào" — hãy chọn mức bạn đang phỏng vấn, và đọc thêm một mức ở trên.

> Mindset: junior gọi được tên các garbage collector; senior kể được collector nào đã làm service của họ dừng lại quý trước, lâu bao nhiêu, và họ đổi gì.

## Junior — nền tảng

**Q1. Các vùng bộ nhớ chính của JVM là gì?**
JVM chia bộ nhớ thành: **heap** (mọi instance object, chia sẻ, do GC quản lý), **metaspace** (metadata của class, trước kia là permgen), **stack** riêng cho mỗi thread (frame, biến local, operand), **PC register** riêng cho mỗi thread, và **native method stack**. Mọi thứ bạn `new` nằm trên heap; mỗi lời gọi hàm đẩy một frame lên stack của thread.

**Q2. Khác nhau giữa `==` và `equals()`?**
`==` so sánh tham chiếu (có phải cùng một object trong memory không). `equals()` so sánh tính _logic_ bằng nhau, và bạn phải override nó (cùng `hashCode()`) nếu không sẽ thừa kế so sánh tham chiếu từ `Object`. Hai `String` cùng ký tự chỉ `==` khi string pool intern literal — bẫy kinh điển:

```java
String a = "java";
String b = new String("java");
System.out.println(a == b);        // false — hai object khác nhau
System.out.println(a.equals(b));   // true  — cùng ký tự
```

**Q3. Kiểu nguyên thủy là gì và chúng có phải object không?**
`byte, short, int, long, float, double, char, boolean` — tám kiểu nguyên thủy, không phải object, lưu theo giá trị. Mọi thứ khác là tham chiếu đến object trên heap. Autoboxing (`int` ↔ `Integer`) là đường ngắn che giấu việc cấp phát; `IntegerCache` intern -128..127, nên `Integer.valueOf(42) == Integer.valueOf(42)` là `true` nhưng `Integer.valueOf(200) == Integer.valueOf(200)` là `false`.

**Q4. Khác nhau giữa `String`, `StringBuilder`, và `StringBuffer`?**
`String` immutable — mỗi phép nối chuỗi cấp phát object mới. `StringBuilder` mutable và không thread-safe (nhanh). `StringBuffer` tương tự nhưng `synchronized` (chậm, hiếm khi cần). Trong vòng lặp, `+=` trên `String` là O(n²) cấp phát; hãy dùng `StringBuilder`.

**Q5. Khác nhau giữa `final`, `finally`, và `finalize`?**
`final` trên class cấm kế thừa, trên method cấm override, trên biến cấm gán lại. `finally` chạy sau `try`/`catch` bất kể có exception (dùng để dọn dẹp). `finalize()` là hook GC gọi trước khi thu hồi object — đừng bao giờ dựa vào nó; hãy dùng `try-with-resources` hoặc `Cleaner`.

**Q6. Exception handling hoạt động thế nào — checked vs unchecked?**
Checked exception (`Exception` trừ `RuntimeException`) phải được catch hoặc khai báo; mô hình điều kiện có thể phục hồi. Unchecked (`RuntimeException`, `Error`) không cần khai báo. Lạm dụng checked exception làm nhiễu mọi signature; code hiện đại ưu tiên unchecked cho lỗi lập trình và chỉ dành checked cho lỗi thực sự từ bên ngoài.

## Mid — tradeoff & điểm mù

**Q1. Garbage collector generational hoạt động ra sao, và gì hỏng ở production?**
Heap chia thành **young** (Eden + hai Survivor) và **old**. Hầu hết object chết trẻ: minor GC copy survivor từ Eden→Survivor, rồi Survivor→old khi đủ tuổi. **Major/full GC** thu old gen và có thể dừng mọi thread ứng dụng vài giây trên heap lớn. Lỗi production kinh điển: cache không giới hạn làm đầy old gen → full GC liên tục → **pause stop-the-world 1–5 s** → p99 latency nổ tung. Fix: giới hạn cache, tune `-Xmx`, hoặc chuyển sang collector low-pause.

**Q2. G1 vs ZGC vs Shenandoah — khi nào chọn cái nào?**

- **G1** (mặc định từ Java 9): region-based, nhắm mục tiêu pause (`-XX:MaxGCPauseMillis=200`). Mặc định tốt cho heap đến ~chục GB.
- **ZGC** (production từ Java 15): concurrent, pause dưới mili-giây ngay cả heap **nhiều terabyte**, nhưng tốn CPU/throughput hơn.
- **Shenandoah**: mục tiêu concurrent tương tự, cũng pause sub-ms.
  Chọn G1 trừ khi pause ăn vào SLA latency, lúc đó ZGC. Một số cần nhớ: G1 pause ~tens-to-hundreds ms trên heap lớn; ZGC ~<1 ms bất kể kích thước heap.

**Q3. Java Memory Model là gì và tại sao `volatile` quan trọng?**
JMM định nghĩa _happens-before_: ghi vào field `volatile` happens-before mọi lần đọc sau nó, cho tính visibility xuyên thread. Không có `volatile`, thread có thể đọc giá trị cũ trong cache và không bao giờ thấy update của thread khác. Nhưng `volatile` **không nguyên tử cho thao tác phức hợp** — `volatile int n; n++` vẫn là race (read-modify-write). Dùng `AtomicInteger` cho trường hợp đó.

**Q4. `synchronized` vs `ReentrantLock` — cái nào bạn với tới?**
`synchronized` đơn giản, JVM tối ưu (lock elision, từng có biased locking), và tự giải phóng. `ReentrantLock` thêm: try-lock có timeout (`tryLock(100, ms)` tránh treo do deadlock), tùy chọn fairness, và nhiều condition variable. Hãy với tới `ReentrantLock` chỉ khi cần timeout hoặc acquire có thể interrupt; còn lại `synchronized` gọn hơn.

**Q5. Nguy hiểm của việc tạo thread thủ công?**
`new Thread(() -> ...).start()` mỗi task sẽ cạn thread OS và không có queue, monitor, hay backpressure. Fix là **thread pool** qua `Executors` hoặc tốt hơn `new ThreadPoolExecutor(core, max, keepAlive, queue, factory, rejectionPolicy)`. Lỗi phổ biến: `Executors.newFixedThreadPool` dùng **`LinkedBlockingQueue` không giới hạn** — nếu task nhiều hơn consumer, queue phình đến **OutOfMemoryError**. Hãy giới hạn nó.

**Q6. `ConcurrentModificationException` nghĩa là gì và tránh thế nào?**
Nó bắn khi collection bị sửa cấu trúc trong lúc duyệt (trừ qua `remove` của iterator). Fix: duyệt bằng `Iterator.remove()`, dùng concurrent collection (`CopyOnWriteArrayList`, `ConcurrentHashMap`), hoặc collect-to-remove rồi `removeAll`. `CopyOnWriteArrayList` tuyệt cho list đọc nhiều, ghi hiếm (snapshot-on-write).

## Senior — thiết kế & phòng thủ

**Q1. Một service có pause 3 s mỗi vài phút dưới tải. Hãy đi qua chẩn đoán.**
"Đầu tiên tôi xác nhận đó là GC, không phải network: `-Xlog:gc*:time` cho thấy full GC trùng với pause. Đồ thị heap leo rồi rớt — leak hoặc cache không giới hạn. Tôi chụp heap dump tại đáy sau full GC (`jmap -dump` hoặc `-XX:+HeapDumpOnOutOfMemoryError`) và mở bằng Eclipse MAT, sort theo retained size. Thường là một `Map` static hoặc thread-local không bao giờ clear. Fix: giới hạn cấu trúc đó (Caffeine với `maximumSize` + `expireAfterWrite`), hoặc đẩy data ra khỏi JVM. Sau đó chuyển G1 → ZGC nếu latency vẫn cắn. Tôi đo p99 trước/sau; mục tiêu <200 ms."

**Q2. Bạn phải share một counter xuyên 64 thread ở 1M ops/s. Thiết kế đi.**
"Naive `AtomicLong.incrementAndGet()` tuần tự hóa trên một cache line — false sharing và trần ~tens of M ops/s. Lựa chọn: `LongAdder` (JDK 8+) chia counter thành các cell, đổi độ chính xác đọc lấy throughput — dễ dàng 5–10× cao hơn. Ở 1M ops/s `LongAdder` là lựa chọn đúng; read là `sum()` (xấp xỉ nhưng ổn cho metrics). Tôi cũng gắn nó vào metrics path, không phải counter đòi hỏi đúng-sai nghiêm ngặt, và ghi chú điều đó."

**Q3. Giải thích false sharing và chứng minh nó từng tốn performance của bạn.**
"Hai field `long` ghi thường xuyên trên cùng một cache line 64-byte bị invalidate xuyên core dù logic độc lập. Triệu chứng: scaling tệ _hơn_ khi thêm thread. Chứng minh: annotate padding (`@Contended`, hoặc padding 64-byte thủ công) — nếu throughput nhảy vọt, bạn có false sharing. `LongAdder` đã tích hợp sẵn. Trong một service, thêm `@Contended` vào field counter nóng đưa hot loop từ 40M lên 220M ops/s."

**Q4. Khi nào bạn KHÔNG dùng thread pool, và thay bằng gì?**
"Với blocking I/O quy mô lớn — pool N thread giới hạn concurrency ở N và tất cả treo trên socket. Virtual thread (Java 21+, `Executors.newVirtualThreadPerTaskExecutor()`) cho phép spawn hàng triệu thread rẻ; mỗi lần blocking sẽ park thay vì pin OS thread. Quy tắc: dùng virtual thread cho code I/O-bound task-per-request; giữ platform-thread pool cho work CPU-bound nơi bạn muốn giới hạn concurrency cứng."

**Q5. Một `HashMap` được nhiều thread dùng, thỉnh thoảng trả null cho key đã put. Tại sao, và fix?**
"Nó không thread-safe — put đồng thời có thể làm hỏng cấu trúc bucket hoặc mất entry khi resize giữa chừng (và ở Java cũ, có thể loop vô tận). Fix: `ConcurrentHashMap` cho truy cập concurrent. Nhưng lưu ý `ConcurrentHashMap.computeIfAbsent` nguyên tử per-key; `get-then-put` thì không. Nếu cần thao tác compound nguyên tử, dùng `compute`/`merge`, đừng tự viết check-then-act."

**Q6. Bạn phòng thủ lựa chọn giữa G1 và ZGC bằng số thế nào?**
"Tôi baseline p99 latency và % GC pause dưới tải giống production (vd 500 rps, 30 GB heap). Nếu G1 pause ~150 ms và SLA p99 < 250 ms còn headroom, G1 thắng về throughput (ZGC tốn ~10–15% CPU). Nếu pause ăn vào SLA, ZGC <1 ms biện minh cho thuế CPU. Tôi không chọn theo cảm giác — chạy cả hai ở staging với cùng tải và đọc GC log. Quyết định là một bảng tradeoff, ký bằng con số đo được."

#### Self-check

- [ ] Junior: Tôi gọi được tên các vùng bộ nhớ JVM, giải thích `==` vs `equals`, primitive vs wrapper, và checked vs unchecked exception.
- [ ] Mid: Tôi mô tả được generational GC, chọn G1 vs ZGC, giải thích `volatile`/JMM, và tránh được unbounded thread-pool queue.
- [ ] Senior: Tôi chẩn đoán được GC pause từ log + heap dump, thiết kế counter 1M-ops/s, giải thích false sharing, và phòng thủ lựa chọn collector bằng số before/after.
