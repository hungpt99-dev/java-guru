---
title: "Java Interview Prep #1: Java Core (JVM, GC, Concurrency) — Junior to Senior"
description: "The backbone of every Java interview: JVM memory, garbage collection, the JMM, and concurrency. Fifty interview-grade questions, from 'what is the heap?' to 'here is how I halved GC pauses on a 40 GB service.'"
pubDatetime: 2026-08-10T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

Java core is the filter that ends more interviews than system design ever does. A junior can memorize keywords; a senior can prove they have stared at a heap dump at 3 a.m. This post covers the same topic from "what is the heap?" to "here is how I halved GC pauses on a 40 GB service": 50 questions. Pick the level you are interviewing for, then read one level above it.

> Mindset: a junior can name the garbage collectors; a senior can tell you which one paused their service last quarter, for how long, and what they changed.

## Junior — foundations

**Q1. What are the main memory areas of the JVM?**
The JVM divides memory into the **heap** (all object instances; shared and GC-managed), **metaspace** (class metadata, formerly PermGen), a **stack** for each thread (frames, local variables, and operands), a **PC register** for each thread, and **native method stacks**. Everything you create with `new` lives in the heap; every method call pushes a frame onto the thread's stack. The heap typically accounts for 70–90% of a Java process's RAM; metaspace starts at roughly 20 MB and grows.

**Q2. What is the difference between `==` and `equals()`?**
`==` compares references (whether two references point to the same object). `equals()` compares _logical_ equality; you must override it (together with `hashCode()`) or inherit `Object`'s reference-based comparison. Two `String`s with the same characters are `==` only when they refer to the same interned literal in the string pool:

```java
String a = "java";
String b = new String("java");
System.out.println(a == b);        // false — different objects
System.out.println(a.equals(b));   // true  — same characters
```

**Q3. What are the primitive types and are they objects?**
`byte, short, int, long, float, double, char, boolean` are the eight primitive types. They are stored by value, not as objects. Everything else is a reference to a heap object. Autoboxing (`int` ↔ `Integer`) hides allocations; `IntegerCache` interns values from -128 to 127, so `Integer.valueOf(42) == Integer.valueOf(42)` is `true`, but `Integer.valueOf(200) == Integer.valueOf(200)` is `false`.

**Q4. `String`, `StringBuilder`, `StringBuffer` — what's the difference?**
`String` is immutable: every concatenation allocates a new object. `StringBuilder` is mutable and not thread-safe, which makes it fast. `StringBuffer` is similar but synchronized, so it is slower and rarely needed. In a loop, `+=` on a `String` causes O(n²) allocations; use `StringBuilder` instead.

**Q5. `final`, `finally`, `finalize` — what do they mean?**
`final` forbids subclassing a class, overriding a method, or reassigning a variable. `finally` runs after `try`/`catch`, regardless of whether an exception was thrown, and is commonly used for cleanup. `finalize()` is a deprecated hook that the GC may call before reclaiming an object. Never rely on it; use `try-with-resources` or `Cleaner` instead.

**Q6. Checked vs unchecked exceptions?**
Checked exceptions (`Exception` minus `RuntimeException`) must be caught or declared; they model recoverable conditions. Unchecked exceptions (`RuntimeException` and `Error`) need not be declared. Modern code generally prefers unchecked exceptions for programming errors and reserves checked exceptions for genuinely external failures.

**Q7. What is autoboxing and a trap it causes?**
Autoboxing automatically converts a primitive to its wrapper type (`int`→`Integer`). The trap is that `Integer` is an object: `Map<Integer,String>` lookups with a primitive key auto-box it, while unboxing `null` throws `NullPointerException`:

```java
Integer i = null;
int x = i;   // NullPointerException at runtime — autounbox of null
```

**Q8. What is the difference between `int` and `Integer` in a collection?**
Collections store only objects, so `List<Integer>` boxes each `int`, adding roughly 16 bytes of object overhead per value along with extra GC pressure. For 1M ints, that is roughly 16 MB of wrapper objects. Use `int[]` or primitive-oriented streams and arrays when size and speed matter.

**Q9. How does `switch` work on `String` (Java 7+)?**
The compiler hashes the string and compares it with `equals` in a synthetic lookup: O(1) amortized, but with hidden `hashCode` and `equals` costs. It is not the jump table used by `int` and `enum` switches. For hot paths, prefer `enum` switches (~1 ns) over `String` switches (~10–20 ns).

**Q10. What is a `static` block and when does it run?**
A `static {}` block runs once, when the class is first loaded (lazily, on first use). It initializes static state. A common bug is a `static` initializer that throws, leaving the class in a permanently unusable state (`ExceptionInInitializerError`).

**Q11. What is the difference between `this` and `super`?**
`this` refers to the current instance; `super` refers to the superclass's implementation. `super()` (the first statement in a constructor) calls the parent constructor; omitting it implicitly calls the parent's no-argument constructor.

**Q12. What is method overloading resolution order?**
The compiler picks the most specific applicable overload at compile time; it does not choose based on the runtime type. Ambiguity (for example, `log(Object)` versus `log(String)` with `null`) is a compile-time error, not a runtime choice.

**Q13. What is the default value of an uninitialized field vs local?**
Object fields get type-specific defaults (`0`, `false`, `null`); local variables are uninitialized, and the compiler forbids using them before assignment. This is why `int x; System.out.println(x);` does not compile.

**Q14. What is the difference between `>>` and `>>>`?**
`>>` is a signed right shift (the sign bit is replicated); `>>>` is unsigned (zero-filled). They differ for negative numbers: `-8 >> 1` is `-4`, while `-8 >>> 1` is a very large positive number. Use `>>>` when treating bits as unsigned data.

**Q15. What is the difference between `Math.round`, `ceil`, `floor`?**
`round` returns the nearest `long` or `int` (0.5 rounds up); `ceil` rounds up to the next `double`; `floor` rounds down. `Math.round(-2.5)` is `-2` (toward +∞, not "away from zero"), which is a frequent trap.

## Mid — trade-offs and pitfalls

**Q1. How does the generational garbage collector work, and what breaks in production?**
The heap is split into **young** (Eden plus two Survivor spaces) and **old** generations. Most objects die young: a minor GC copies survivors from Eden to a Survivor space, then promotes them to old once they age out. A **major/full GC** collects the old generation and can pause every application thread for seconds on a large heap. The classic production failure is an unbounded cache filling the old generation, causing frequent full GCs and **stop-the-world pauses of 1–5 s**, which send p99 latency soaring. Fix it by bounding the cache, tuning `-Xmx`, or moving to a low-pause collector.

**Q2. G1 vs ZGC vs Shenandoah: when do you choose each one?**

- **G1** (default since Java 9): region-based, targets a pause-time goal (`-XX:MaxGCPauseMillis=200`). Good default up to ~tens of GB heaps.
- **ZGC** (production since Java 15): concurrent, sub-millisecond pauses even at **multi-terabyte** heaps, but higher CPU/throughput overhead.
- **Shenandoah**: similar concurrent goal, also sub-ms pauses.
  One number to remember: G1 pauses last tens to hundreds of milliseconds on large heaps; ZGC pauses are typically under 1 ms regardless of heap size.

**Q3. What is the Java Memory Model and why does `volatile` matter?**
The JMM defines _happens-before_: a write to a `volatile` field happens-before any later read of it, providing visibility across threads. Without `volatile`, a thread may read a stale cached value and never see another thread's update. But `volatile` is **not atomic for compound actions**: `volatile int n; n++` is still a race (read-modify-write). Use `AtomicInteger`.

**Q4. `synchronized` vs `ReentrantLock`: which would you choose?**
`synchronized` is simple, JVM-optimized, and released automatically. `ReentrantLock` adds a timed try-lock (`tryLock(100, ms)` avoids hanging during a deadlock), an optional fairness policy, and multiple condition variables. Choose `ReentrantLock` only when you need a timeout or interruptible acquisition; otherwise, `synchronized` is cleaner.

**Q5. What are the dangers of creating threads manually?**
Creating a `new Thread(() -> ...).start()` for every task can exhaust OS threads and provides no queueing, monitoring, or backpressure. The fix is a **thread pool** via `Executors` or, better, `new ThreadPoolExecutor(core, max, keepAlive, queue, factory, rejectionPolicy)`. A common bug is that `Executors.newFixedThreadPool` uses an **unbounded `LinkedBlockingQueue`**: if tasks arrive faster than consumers can process them, the queue grows until **OutOfMemoryError**. Bound it.

**Q6. What is `ConcurrentModificationException`, and how do you avoid it?**
It is thrown when a collection is structurally modified during iteration, except through the iterator's own `remove`. Fixes include iterating with `Iterator.remove()`, using a concurrent collection (`CopyOnWriteArrayList`, `ConcurrentHashMap`), or collecting items to remove and then calling `removeAll`. `CopyOnWriteArrayList` is excellent for read-heavy, rarely written lists because each write takes ~O(n) and readers use a snapshot.

**Q7. What is the `hashCode` contract, and why does `HashMap` need it?**
Equal objects must have equal hash codes; unequal objects _should_ have different ones to avoid collisions. A poor `hashCode` (for example, a constant) puts every key in one bucket, causing `HashMap` to degrade from O(1) to O(n). A 1M-entry map becomes a linked list scanned linearly, taking microseconds per operation instead of roughly 50 ns.

**Q8. How does `HashMap` resize, and why is resizing expensive?**
When the number of entries exceeds `capacity × loadFactor` (0.75 by default), it doubles the capacity and rehashes all entries into the new buckets. A map growing from 1M to 2M entries rehashes 1M entries in one stop-the-world step, taking tens of milliseconds. Pre-size it with `new HashMap<>(expectedSize)` to avoid resizes during a run.

**Q9. What is false sharing and how to prove it?**
Two frequently-written `long` fields on the same 64-byte cache line get invalidated across cores even when logically independent. Symptom: scaling gets _worse_ with more threads. Proof: add `@Contended` padding — if throughput jumps, you had false sharing. `LongAdder` bakes this in. In one service, `@Contended` on a hot counter took a loop from 40M to 220M ops/s.

**Q10. `volatile` vs `AtomicReference` — when which?**
`volatile` gives visibility + single-field atomicity for primitives/references but not compound actions. `AtomicReference`/`AtomicInteger` give CAS-based atomic read-modify-write (`compareAndSet`), essential for lock-free counters and state machines. Use `Atomic*` when you need "check-then-act" to be atomic.

**Q11. What is the cost of `synchronized` contention?**
Uncontended `synchronized` is ~20–30 ns (biased-lock fast path). Under heavy contention it can balloon to microseconds as threads park/unpark and the OS schedules them. Hot uncontended locks are cheap; hot _contended_ locks are the real cost.

**Q12. Why is `Double.parseDouble` / `String` concat a hidden cost in hot loops?**
`String` concatenation in a loop allocates a new `StringBuilder` + char array each iteration (~tens of ns + GC). `Double.parseDouble` is ~100–200 ns and allocates. In a hot path doing 1M/s, that's 100–200 ms/s of pure parsing — move it out or cache the result.

**Q13. What is the difference between `Runnable` and `Callable`?**
`Runnable.run()` returns `void` and can't throw checked exceptions. `Callable.call()` returns a result and can throw. Submit a `Callable` to an `ExecutorService` and get a `Future<T>` for the result/exception.

**Q14. What is `Future.get()` blocking behavior, and the timeout form?**
`future.get()` blocks the calling thread until completion. Without a timeout it can block forever if the task is stuck — always use `get(timeout, unit)` so a hung task throws `TimeoutException` instead of hanging the thread indefinitely.

**Q15. `InterruptedException` — why must you not swallow it?**
It signals the thread was asked to stop (via `interrupt()`). Swallowing it (catching and ignoring) breaks cancellation propagation — a task that ignores interrupts can never be shut down cleanly. Re-interrupt: `Thread.currentThread().interrupt();` after catching.

**Q16. What is the difference between a daemon and a non-daemon thread?**
The JVM exits when only daemon threads remain; non-daemon threads keep it alive. Don't do important work on a daemon thread — it can be killed mid-task on JVM shutdown with no cleanup.

**Q17. What is `ThreadLocal` and a classic leak?**
`ThreadLocal` gives each thread its own copy. In a thread pool, a `ThreadLocal` set and never removed leaks across tasks using the same pooled thread — a classic cause of cross-request data bleed and PermGen/metaspace growth. Always `remove()` in a `finally`.

## Senior — design & defense

**Q1. A service shows 3 s pauses every few minutes under load. Walk the diagnosis.**
"First I confirm it is GC, not network: `-Xlog:gc*:time` shows full GCs aligned with the pauses. The heap graph climbs then drops — a leak or unbounded cache. I take a heap dump at the trough after a full GC (`jmap -dump` or `-XX:+HeapDumpOnOutOfMemoryError`) and open it in Eclipse MAT, sorting by retained size. Usually it is a static `Map` or a thread-local that never clears. Fix: cap the structure (Caffeine with `maximumSize` + `expireAfterWrite`), or move the data out of the JVM. Then switch G1 → ZGC if latency still bites. I measure p99 before/after; target <200 ms."

**Q2. You must share a counter across 64 threads at 1M ops/s. Design it.**
"Naive `AtomicLong.incrementAndGet()` serializes on one cache line — false sharing and ~tens of M ops/s ceiling. Options: `LongAdder` (JDK 8+) shards the counter across cells, trading exact reads for throughput — easily 5–10× higher. At 1M ops/s `LongAdder` is the right call; reads are `sum()` (approximate but fine for metrics). I'd pin it to a metrics path, not a correctness-critical counter, and document that."

**Q3. Explain false sharing and how to prove it cost you performance.**
"Two frequently-written `long` fields on the same 64-byte cache line get invalidated across cores even when logically independent. Symptom: scaling gets _worse_ with more threads. Proof: annotate padding (`@Contended`, or manual 64-byte padding) — if throughput jumps, you had false sharing. `LongAdder` bakes this in. In one service, adding `@Contended` to a hot counter field took a hot loop from 40M to 220M ops/s."

**Q4. When would you NOT use a thread pool, and what instead?**
"For blocking I/O at scale — a pool of N threads caps your concurrency at N and they all stall on sockets. Virtual threads (Java 21+, `Executors.newVirtualThreadPerTaskExecutor()`) let you spawn millions cheaply; each blocking call parks instead of pinning an OS thread. Rule: use virtual threads for I/O-bound task-per-request code; keep platform-thread pools for CPU-bound work where you want a hard concurrency cap."

**Q5. A `HashMap` is used by many threads, occasionally returning null for a key that was put. Why, and the fix?**
"It is not thread-safe — concurrent puts can corrupt the bucket structure or a resize mid-put loses entries (and in old Java, could loop forever). Fix: `ConcurrentHashMap` for concurrent access. But note `ConcurrentHashMap.computeIfAbsent` is atomic per-key; `get-then-put` is not. If you need a compound atomic operation, use `compute`/`merge`, not a hand-rolled check-then-act."

**Q6. How do you defend G1 vs ZGC with numbers?**
"I'd baseline p99 latency and GC pause percent under production-like load (e.g. 500 rps, 30 GB heap). If G1 pause is ~150 ms and SLA is p99 < 250 ms with headroom, G1 wins on throughput (ZGC costs ~10–15% CPU). If pauses eat the SLA, ZGC's <1 ms pauses justify the CPU tax. I never pick on vibes — I run both in staging with the same load and read the GC logs. The decision is a tradeoff table, signed with measurements."

**Q7. You have a lock that's contended 80% of the time. What do you change?**
"I'd first ask whether the shared state is even needed per-request — often it can be sharded by key (e.g. `ConcurrentHashMap` of per-key locks, or `StampedLock` for read-heavy). If reads dominate, `ReentrantReadWriteLock` or `StampedLock.tryOptimisticRead()` drops the read path to ~nanoseconds. If it's truly a single hot counter, `LongAdder`. Measure lock hold time with `-Djdk.trace`/async-profiler before and after."

**Q8. How would you find a CPU hotspot without a profiler GUI?**
"`async-profiler` with `./profiler.sh -e cpu -d 30 -f flame.html <pid>` generates a flame graph in one command, no agent restarts, ~1% overhead. I look for the widest frame — that's where CPU goes. For allocation pressure, `-e alloc`. For lock contention, `-e lock`. It's my first move before touching code."

**Q9. A native memory leak (off-heap) — how do you find it?**
"Heap looks fine but RSS grows without bound → off-heap. Check `-XX:MaxDirectMemorySize`, NIO direct buffers, and JNI. `jcmd <pid> VM.native_memory summary` shows the breakdown (metaspace, thread, code, direct). I've seen a Netty `ByteBuf` pool misconfigured leak 2 GB/hour this way. Fix the pool, not the heap."

**Q10. `CompletableFuture` vs plain threads for async orchestration?**
"For fan-out/fan-in of N calls, `CompletableFuture.allOf(...)` composes them without blocking a thread per call; the callbacks run on the common `ForkJoinPool` (or a custom executor). Pitfall: the default pool is shared — a slow callback starves unrelated futures. I always pass an explicit executor: `supplyAsync(task, myExecutor)`. Also never block inside a CF callback."

**Q11. How do you size a thread pool correctly?**
"Little's Law: `pool ≈ target_concurrency × (avg_task_ms / acceptable_latency_ms)`. For 200 concurrent users at 5 ms tasks and 100 ms budget, ~10, padded to ~20. For CPU-bound work, `cores` to `cores×2`. Oversizing wastes memory (each thread ~1 MB stack) and increases context-switch cost; undersizing queues work and raises latency. I measure queue length and rejection rate, then tune."

**Q12. What is `StampedLock` and when over `ReentrantReadWriteLock`?**
"`StampedLock` adds an optimistic read mode: `tryOptimisticRead()` validates after a read with `validate(stamp)`, skipping locking entirely when there's no writer — ~nanosecond reads vs ~microsecond for RWLock. Cost: it's not reentrant and a write can starve. Use it only for read-heavy, simple critical sections where you can structure reads to retry on invalidation."

**Q13. Object pooling — when is it a win vs a liability?**
"Pooling avoids allocation + GC for very expensive-to-create objects (DB connections, large buffers). For cheap objects (small DTOs) it's a liability — allocation is ~10 ns and the pool adds contention + correctness bugs (forgetting to reset state). Rule: pool only things with >~1 µs creation cost or external resources; let the GC handle the rest."

**Q14. How do you make a shutdown graceful under load?**
"`Runtime.getRuntime().addShutdownHook` drains in-flight requests: stop accepting new work, `executor.shutdown()` then `awaitTermination(30s)`, then `shutdownNow()` to interrupt stragglers. Kubernetes sends SIGTERM; without a hook you get abrupt connection resets and lost writes. I verify with a load test that aborts mid-flight and checks zero lost commits."

**Q15. `var` (Java 10+) — when to use it?**
"`var` infers local types: `var map = new HashMap<String,List<Integer>>()` removes noise. Don't use it where the type is non-obvious (a method returning `var` from a complex expression) — readability wins. It's local-only; never in signatures or fields. Used judiciously it cuts ~20% of verbose type declarations with zero runtime cost."

**Q16. What changed in Java 21 you'd actually use in production?**
"Virtual threads (stable in 21) for I/O-bound concurrency — replaces thread-per-request pools. `switch` pattern matching and record patterns reduce boilerplate. `SequencedCollection` for ordered collections. String templates (preview). I'd adopt virtual threads first — it's the biggest leap since streams, ~0 code change to get massive concurrency headroom."

**Q17. How do you prove a `volatile` fix actually fixed a race?**
"I reproduce with a stress test: 100 threads doing check-then-act on a non-volatile flag, run 10k iterations, assert no stale read. With `-Xint` (interpreter-only) to remove JIT masking, races show faster. Then add `volatile` and re-run — the failure rate drops to zero. In prod I confirm via a canary + metrics showing the anomaly (e.g. double-debit count) hitting 0."

**Q18. A library you depend on does `System.gc()` in a hot path. What do you do?**
"`System.gc()` is a full-stop-the-world suggestion the JVM usually honors — it can pause 100 ms+ on a big heap, destroying latency. I'd first try `-XX:+DisableExplicitGC` (if the library doesn't rely on it for correctness, which it shouldn't). If that breaks it, fork/patch the library or isolate it in its own process. Never let a dependency dictate your GC behavior."

#### Self-check

- [ ] Junior: I can name the JVM memory areas, explain `==` vs `equals`, primitives vs wrappers, autoboxing traps, checked vs unchecked exceptions, and basic bit/rounding behavior.
- [ ] Mid: I can describe generational GC, choose G1 vs ZGC, explain `volatile`/JMM, avoid unbounded thread-pool queues, explain `HashMap` resize and false sharing, and handle `InterruptedException` correctly.
- [ ] Senior: I can diagnose a GC pause from logs + heap dump, design a 1M-ops/s counter, explain false sharing, defend a collector choice with before/after numbers, orchestrate async with `CompletableFuture`, size pools from Little's Law, and make shutdowns graceful.
