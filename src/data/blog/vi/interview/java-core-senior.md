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

> Tư duy: "tùy thuộc, và đây là đánh đổi" đánh bại đọc thuộc lòng mọi lúc.

## 1. Memory model và GC

Câu hỏi: "Chuyện gì xảy ra khi bạn `new` một object?" Junior dừng ở "nó nằm trên heap." Senior tiếp tục:

- **Heap vs metaspace vs stack.** Object sống ngắn vào young generation (Eden); đa số chết ở đó, survivor được copy sang, rồi promote lên old gen. Metaspace giữ metadata class (thay perm gen). Stack giữ frame và reference/primitive cục bộ.
- **Stop-the-world.** Mọi GC pause đóng băng luồng ứng dụng. Throughput collector (Parallel) tối ưu tổng công; low-latency (G1, ZGC, Shenandoah) tối thiểu pause. Với service nhạy latency, nói về `MaxGCPauseMillis`, region sizing, và cách ZGC đạt pause dưới ms nhờ colored pointers / load barriers.
- **Bẫy:** GC không nghĩa là hết quản lý bộ nhớ. Unbounded cache, static collection, thread-local leak vẫn OOM.

```java
// Rò rỉ kinh điển: static cache không evict
private static final Map<String, Expensive> CACHE = new HashMap<>();

// Sửa kiểu senior: bounded + time-based eviction
private static final Cache<String, Expensive> CACHE = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .build();
```

## 2. Concurrency — chỗ phân hóa thật

- **`synchronized` vs `ReentrantLock`.** `synchronized` đơn giản, JVM tối ưu (biased locking bỏ ở JDK 17). `ReentrantLock` thêm `tryLock(timeout)`, nhiều condition, fairness.
- **`volatile`** cho visibility, **không** atomicity. Không làm `i++` an toàn.
- **`Atomic*` / `LongAdder`.** Contention cao thì `LongAdder` thắng nhờ chia update thành cell.
- **Thread pools.** Đừng `Executors.newFixedThreadPool` với `LinkedBlockingQueue` vô hạn cho workload không tin cậy — buffer vô hạn rồi OOM. Size có chủ đích, bounded queue + `RejectedExecutionHandler`, hiểu `corePoolSize`/`maxPoolSize`/`keepAliveTime`/`workQueue`.
- **`CompletableFuture`.** Composition non-blocking; `thenCompose` vs `thenCombine`; lỗi bằng `handle`/`exceptionally`.
- **Virtual threads (Loom, Java 21+).** Hàng triệu virtual thread rẻ trên vài carrier thread. Không nhanh hơn cho CPU, nhưng giải nghẽn thread-per-request cho service nặng I/O. Bẫy pinning: block `synchronized` dài hoặc native call pin carrier thread.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = urls.stream()
        .map(url -> executor.submit(() -> fetch(url)))
        .toList();
}
```

## 3. JVM internals hay gặp

- **Class loading:** bootstrap → platform → application, parent-delegation. Biết `ClassNotFoundException` vs `NoClassDefFoundError`.
- **JMM và happens-before:** final, volatile, lock acquire, thread start/join tạo happens-before edge — câu trả lời chặt chẽ cho "tại sao flag không visible?"
- **`String` immutable, `Integer` cache (`-128..127`), và tại sao `==` trên wrapper cắn.**

## 4. Runtime & tooling

Senior: "chậm trên prod thì đo, không đoán." Kể tên hai cái từng dùng: `jstack`, `jmap`, `jstat`, async-profiler, JFR. Kể được một incident thật bạn debug còn giá trị hơn mọi định nghĩa.

## 5. Tự kiểm tra

- [ ] Giải thích young/old gen và tại sao đa số object chết sớm.
- [ ] `synchronized` vs `ReentrantLock` trong một câu.
- [ ] Tại sao `volatile` không làm `i++` an toàn.
- [ ] Khi virtual thread giúp và khi không.
- [ ] Một vấn đề GC/perf bạn tìm ra bằng profiling tool.

Dễ thì bạn sẵn sàng mảng Java core.
