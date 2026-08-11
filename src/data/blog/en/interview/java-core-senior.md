---
title: "Senior Java Interview: Java Core Deep Dive"
description: "What senior interviewers actually probe in Java core — GC and the JMM, concurrency traps, virtual threads, and the runtime tooling that proves you've debugged production."
pubDatetime: 2026-08-12T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

A junior knows Java syntax. A senior knows **what the JVM is doing, why it behaves that way, and where it will surprise you in production.** This is the Java-core slice of senior interview prep.

> Mindset: "it depends, and here's the trade-off" beats reciting facts every time.

## 1. Memory model and GC

Expect: "What happens when you `new` an object?" A mid answer stops at "it goes on the heap." A senior continues:

- **Heap vs metaspace vs stack.** Short-lived objects land in the young generation (Eden); most die there, survivors are copied to survivor spaces, then promoted to old gen. Metaspace holds class metadata (it replaced perm gen). The stack holds frames and local references/primitives.
- **Stop-the-world.** Any GC pause freezes app threads. Throughput collectors (Parallel) minimize total work; low-latency collectors (G1, ZGC, Shenandoah) minimize pause time. For latency-sensitive services talk about `MaxGCPauseMillis`, region sizing, and how ZGC hits sub-ms pauses via colored pointers / load barriers.
- **Trap:** GC does not mean you stop managing memory. Unbounded caches, static collections, and thread-local leaks still OOM you.

```java
// Classic leak: a static cache that never evicts
private static final Map<String, Expensive> CACHE = new HashMap<>();

// Senior fix: bounded + time-based eviction
private static final Cache<String, Expensive> CACHE = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .build();
```

## 2. Concurrency — the real differentiator

- **`synchronized` vs `ReentrantLock`.** `synchronized` is simpler and JVM-optimized (biased locking was deprecated in JDK 17 — know that). `ReentrantLock` adds `tryLock(timeout)`, multiple condition variables, and fairness control.
- **`volatile`** gives visibility, **not** atomicity. It does not make `i++` safe.
- **`Atomic*` / `LongAdder`.** Under high contention `LongAdder` wins because it spreads updates across cells.
- **Thread pools.** Never `Executors.newFixedThreadPool` with an unbounded `LinkedBlockingQueue` for untrusted work — it buffers infinitely and OOMs. Size deliberately, use a bounded queue + `RejectedExecutionHandler`, and understand `corePoolSize` / `maxPoolSize` / `keepAliveTime` / `workQueue`.
- **`CompletableFuture`.** Non-blocking composition; `thenCompose` (flatMap) vs `thenCombine`; handle errors with `handle`/`exceptionally`. Heavily tested.
- **Virtual threads (Project Loom, Java 21+).** Millions of cheap virtual threads scheduled on a few carrier threads. Not faster for CPU work, but they destroy thread-per-request bottlenecks for I/O-heavy services. Know the pinning pitfall: long `synchronized` blocks or native calls pin the carrier thread.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = urls.stream()
        .map(url -> executor.submit(() -> fetch(url)))
        .toList();
}
```

## 3. JVM internals interviewers love

- **Class loading:** bootstrap → platform → application, parent-delegation (security + no duplicate core classes). Know `ClassNotFoundException` vs `NoClassDefFoundError`.
- **JMM and happens-before:** final, volatile, lock acquire, thread start/join all establish happens-before edges — the rigorous answer to "why isn't my flag change visible?"
- **`String` immutability, `Integer` caching (`-128..127`), and why `==` on wrappers bites.**

## 4. Runtime & tooling

A senior says: "when it's slow in prod, I don't guess — I measure." Name two you've actually used: `jstack`, `jmap`, `jstat`, async-profiler, JFR. Being able to describe a real incident you debugged is worth more than any definition.

## 5. Self-check

- [ ] Explain young/old generation and why most objects die young.
- [ ] `synchronized` vs `ReentrantLock` in one sentence each.
- [ ] Why `volatile` doesn't make `i++` safe.
- [ ] When virtual threads help and when they don't.
- [ ] One GC/perf issue you found with a profiling tool.

If those feel easy, you're ready on Java core.
