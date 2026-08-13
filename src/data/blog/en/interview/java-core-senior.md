---
title: "Java Interview Prep #1: Java Core (JVM, GC, Concurrency) — Junior to Senior"
description: "The spine of every Java interview — JVM memory, garbage collection, the JMM, and concurrency. Junior recites; senior proves they've debugged a production OutOfMemoryError."
pubDatetime: 2026-08-10T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

Java core is the filter that ends more interviews than system design ever does. It is where a junior can memorize keywords and a senior can prove they have stared at a heap dump at 3 a.m. This post walks the same topic from "what is the heap" to "here is how I halved GC pause on a 40 GB service" — pick the level you are interviewing at, and read one above it.

> Mindset: junior names the garbage collectors; senior can tell you which one paused their service last quarter, by how much, and what they changed.

## Junior — foundations

**Q1. What are the main memory areas of the JVM?**
The JVM divides memory into: the **heap** (all object instances, shared, GC-managed), **metaspace** (class metadata, formerly permgen), the **stack** per thread (frames, locals, operands), the **PC register** per thread, and **native method stacks**. Everything you `new` lives in the heap; every method call pushes a frame onto the thread stack.

**Q2. What is the difference between `==` and `equals()`?**
`==` compares references (are these the same object in memory). `equals()` compares _logical_ equality, and you must override it (with `hashCode()`) or you inherit the reference comparison from `Object`. Two `String`s with the same characters are `==` only because the string pool interns literals — a classic trap:

```java
String a = "java";
String b = new String("java");
System.out.println(a == b);        // false — different objects
System.out.println(a.equals(b));   // true  — same characters
```

**Q3. What are the primitive types and are they objects?**
`byte, short, int, long, float, double, char, boolean` — eight primitives, not objects, stored by value. Everything else is a reference to an object on the heap. Autoboxing (`int` ↔ `Integer`) is syntactic sugar that hides allocations; `IntegerCache` interns -128..127, so `Integer.valueOf(42) == Integer.valueOf(42)` is `true` but `Integer.valueOf(200) == Integer.valueOf(200)` is `false`.

**Q4. What is the difference between `String`, `StringBuilder`, and `StringBuffer`?**
`String` is immutable — every concatenation allocates a new object. `StringBuilder` is mutable and not thread-safe (fast). `StringBuffer` is the same but `synchronized` (slow, rarely needed). In a loop, `+=` on a `String` is O(n²) allocations; use `StringBuilder`.

**Q5. What is the difference between `final`, `finally`, and `finalize`?**
`final` on a class forbids subclassing, on a method forbids override, on a variable forbids reassignment. `finally` runs after `try`/`catch` regardless of exception (used for cleanup). `finalize()` is a deprecated hook the GC calls before reclaiming an object — never rely on it; use `try-with-resources` or `Cleaner`.

**Q6. How does exception handling work — checked vs unchecked?**
Checked exceptions (`Exception` minus `RuntimeException`) must be caught or declared; they model recoverable conditions. Unchecked (`RuntimeException`, `Error`) need not be declared. Overusing checked exceptions pollutes every signature; modern code prefers unchecked for programming errors and reserves checked for genuinely external failures.

## Mid — tradeoffs & pitfalls

**Q1. How does the generational garbage collector work, and what breaks in production?**
The heap is split into **young** (Eden + two Survivor spaces) and **old** generations. Most objects die young: a minor GC copies survivors Eden→Survivor, then Survivor→old once they age out. A **major/full GC** collects the old generation and can pause every application thread for seconds on a large heap. The classic production failure: a cache that grows unbounded fills the old gen → frequent full GCs → **stop-the-world pauses of 1–5 s** → p99 latency blows up. Fix: bound the cache, tune `-Xmx`, or move to a low-pause collector.

**Q2. G1 vs ZGC vs Shenandoah — when do you pick which?**

- **G1** (default since Java 9): region-based, targets a pause-time goal (e.g. `-XX:MaxGCPauseMillis=200`). Good default up to ~十几 GB heaps.
- **ZGC** (production since Java 15): concurrent, sub-millisecond pauses even at **multi-terabyte** heaps, but higher CPU/throughput overhead.
- **Shenandoah**: similar concurrent goal, also sub-ms pauses.
  Pick G1 unless pauses dominate latency SLAs, then ZGC. One number to remember: G1 pause ~tens-to-hundreds of ms on big heaps; ZGC ~<1 ms regardless of heap size.

**Q3. What is the Java Memory Model and why does `volatile` matter?**
The JMM defines _happens-before_: a write to a `volatile` field happens-before any later read of it, giving visibility across threads. Without `volatile`, a thread may read a stale cached value and never see another thread's update. But `volatile` is **not atomic for compound actions** — `volatile int n; n++` is still a race (read-modify-write). Use `AtomicInteger` for that.

**Q4. `synchronized` vs `ReentrantLock` — what would you reach for?**
`synchronized` is simple, JVM-optimized (lock elision, biased locking historically), and automatically released. `ReentrantLock` adds: try-lock with timeout (`tryLock(100, ms)` avoids deadlock hangs), fairness option, and multiple condition variables. Reach for `ReentrantLock` only when you need a timeout or interruptible acquisition; otherwise `synchronized` is cleaner.

**Q5. What are the dangers of creating threads manually?**
`new Thread(() -> ...).start()` per task exhausts OS threads and offers no queueing, monitoring, or backpressure. The fix is a **thread pool** via `Executors` or, better, `new ThreadPoolExecutor(core, max, keepAlive, queue, factory, rejectionPolicy)`. A common bug: `Executors.newFixedThreadPool` uses an **unbounded `LinkedBlockingQueue`** — if tasks outpace consumers, the queue grows until **OutOfMemoryError**. Bound it.

**Q6. What does `ConcurrentModificationException` mean and how do you avoid it?**
It fires when a collection is structurally modified while iterated (except via the iterator's own `remove`). Fixes: iterate with `Iterator.remove()`, use a concurrent collection (`CopyOnWriteArrayList`, `ConcurrentHashMap`), or collect-to-remove then `removeAll`. `CopyOnWriteArrayList` is great for read-heavy, rarely-written lists (snapshot-on-write).

## Senior — design & defense

**Q1. A service shows 3 s pauses every few minutes under load. Walk the diagnosis.**
"First I confirm it is GC, not network: `-Xlog:gc*:time` shows full GCs aligned with the pauses. The heap graph climbs then drops — a leak or unbounded cache. I take a heap dump at the trough after a full GC (`jmap -dump` or `-XX:+HeapDumpOnOutOfMemoryError`) and open it in Eclipse MAT, sorting by retained size. Usually it is a static `Map` or a thread-local that never clears. Fix: cap the structure (Caffeine with `maximumSize` + `expireAfterWrite`), or move the data out of the JVM. Then switch G1 → ZGC if latency still bites. I measure p99 before/after; target <200 ms."

**Q2. You must share a counter across 64 threads at 1M ops/s. Design it.**
"Naive `AtomicLong.incrementAndGet()` serializes on one cache line — false sharing and ~tens of M ops/s ceiling. Options: `LongAdder` (JDK 8+) shards the counter across cells, trading exact reads for throughput — easily 5–10× higher. At 1M ops/s `LongAdder` is the right call; reads are `sum()` (approximate but fine for metrics). I'd also pin it to a metrics path, not a correctness-critical counter, and document that."

**Q3. Explain false sharing and how to prove it cost you performance.**
"Two frequently-written `long` fields on the same 64-byte cache line get invalidated across cores even when logically independent. Symptom: scaling gets _worse_ with more threads. Proof: annotate padding (`@Contended`, or manual 64-byte padding) — if throughput jumps, you had false sharing. `LongAdder` bakes this in. In one service, adding `@Contended` to a hot counter field took a hot loop from 40M to 220M ops/s."

**Q4. When would you NOT use a thread pool, and what do you reach for instead?**
"For blocking I/O at scale — a pool of N threads caps your concurrency at N and they all stall on sockets. Virtual threads (Java 21+, `Executors.newVirtualThreadPerTaskExecutor()`) let you spawn millions cheaply; each blocking call parks instead of pinning an OS thread. Rule: use virtual threads for I/O-bound task-per-request code; keep platform-thread pools for CPU-bound work where you want a hard concurrency cap."

**Q5. A `HashMap` is used by many threads, occasionally returning null for a key that was put. Why, and the fix?**
"It is not thread-safe — concurrent puts can corrupt the bucket structure or a resize mid-put loses entries (and in old Java, could loop forever). Fix: `ConcurrentHashMap` for concurrent access. But note `ConcurrentHashMap.computeIfAbsent` is atomic per-key; `get-then-put` is not. If you need a compound atomic operation, use `compute`/`merge`, not a hand-rolled check-then-act."

**Q6. How do you defend a choice between G1 and ZGC with numbers?**
"I'd baseline p99 latency and GC pause percent under production-like load (e.g. 500 rps, 30 GB heap). If G1 pause is ~150 ms and SLA is p99 < 250 ms with headroom, G1 wins on throughput (ZGC costs ~10–15% CPU). If pauses eat the SLA, ZGC's <1 ms pauses justify the CPU tax. I never pick on vibes — I run both in staging with the same load and read the GC logs. The decision is a tradeoff table, signed with measurements."

#### Self-check

- [ ] Junior: I can name the JVM memory areas, explain `==` vs `equals`, primitives vs wrappers, and checked vs unchecked exceptions.
- [ ] Mid: I can describe generational GC, choose G1 vs ZGC, explain `volatile`/JMM, and avoid unbounded thread-pool queues.
- [ ] Senior: I can diagnose a GC pause from logs + heap dump, design a 1M-ops/s counter, explain false sharing, and defend a collector choice with before/after numbers.
