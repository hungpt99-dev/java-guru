---
title: "Java Interview Prep #1: Java Core (JVM, GC, Concurrency) — Junior to Senior"
description: "The spine of every Java interview — JVM memory, garbage collection, the JMM, and concurrency. 50 interview-grade questions from 'what is the heap' to 'here is how I halved GC pause on a 40 GB service'."
pubDatetime: 2026-08-10T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

Java core is the filter that ends more interviews than system design ever does. A junior can memorize keywords; a senior can prove they have stared at a heap dump at 3 a.m. This post walks the same topic from "what is the heap" to "here is how I halved GC pause on a 40 GB service" — 50 questions, pick the level you are interviewing at, and read one above it.

> Mindset: junior names the garbage collectors; senior can tell you which one paused their service last quarter, by how much, and what they changed.

## Junior — foundations

**Q1. What are the main memory areas of the JVM?**
The JVM divides memory into: the **heap** (all object instances, shared, GC-managed), **metaspace** (class metadata, formerly permgen), the **stack** per thread (frames, locals, operands), the **PC register** per thread, and **native method stacks**. Everything you `new` lives in the heap; every method call pushes a frame onto the thread stack. Heap is typically 70–90% of a Java process's RAM; metaspace starts at ~20 MB and grows.

**Q2. What is the difference between `==` and `equals()`?**
`==` compares references (same object in memory). `equals()` compares _logical_ equality; you must override it (with `hashCode()`) or inherit the reference comparison from `Object`. Two `String`s with the same characters are `==` only because the string pool interns literals:

```java
String a = "java";
String b = new String("java");
System.out.println(a == b);        // false — different objects
System.out.println(a.equals(b));   // true  — same characters
```

**Q3. What are the primitive types and are they objects?**
`byte, short, int, long, float, double, char, boolean` — eight primitives, stored by value, not objects. Everything else is a reference to a heap object. Autoboxing (`int` ↔ `Integer`) hides allocations; `IntegerCache` interns -128..127, so `Integer.valueOf(42) == Integer.valueOf(42)` is `true` but `Integer.valueOf(200) == Integer.valueOf(200)` is `false`.

**Q4. `String`, `StringBuilder`, `StringBuffer` — what's the difference?**
`String` is immutable — every concatenation allocates a new object. `StringBuilder` is mutable, not thread-safe (fast). `StringBuffer` is the same but `synchronized` (slow, rarely needed). In a loop, `+=` on a `String` is O(n²) allocations; use `StringBuilder`.

**Q5. `final`, `finally`, `finalize` — what do they mean?**
`final` forbids subclassing (class), override (method), or reassignment (variable). `finally` runs after `try`/`catch` regardless of exception (cleanup). `finalize()` is a deprecated hook the GC calls before reclaiming an object — never rely on it; use `try-with-resources` or `Cleaner`.

**Q6. Checked vs unchecked exceptions?**
Checked exceptions (`Exception` minus `RuntimeException`) must be caught or declared; they model recoverable conditions. Unchecked (`RuntimeException`, `Error`) need not be declared. Modern code prefers unchecked for programming errors and reserves checked for genuinely external failures.

**Q7. What is autoboxing and a trap it causes?**
Autoboxing converts a primitive to its wrapper (`int`→`Integer`) automatically. Trap: `Integer` is an object, so `Map<Integer,String>` lookups with a primitive key auto-box, and `null` unboxing throws `NullPointerException`:

```java
Integer i = null;
int x = i;   // NullPointerException at runtime — autounbox of null
```

**Q8. What is the difference between `int` and `Integer` in a collection?**
Collections store only objects, so `List<Integer>` boxes each `int`, adding ~16 bytes of object overhead per value plus GC pressure. For 1M ints that's ~16 MB of wrapper objects. Use `int[]` or `IntStream`/arrays when size and speed matter.

**Q9. How does `switch` work on `String` (Java 7+)?**
The compiler hashes the string and compares via `equals` in a synthetic lookup — O(1) amortized but with a hidden `hashCode` + `equals` cost, not the jump-table of `int`/`enum` switches. For hot paths prefer `enum` switches (~1 ns) over `String` switches (~10–20 ns).

**Q10. What is a `static` block and when does it run?**
A `static {}` block runs once, when the class is first loaded (lazily, on first use). It initializes static state. A common bug: a `static` initializer that throws leaves the class in a permanently unloadable state (`ExceptionInInitializerError`).

**Q11. What is the difference between `this` and `super`?**
`this` refers to the current instance; `super` refers to the superclass's implementation. `super()` (first statement in a constructor) calls the parent constructor; omitting it implicitly calls the no-arg parent constructor.

**Q12. What is method overloading resolution order?**
The compiler picks the most specific applicable overload at compile time (it does NOT pick based on runtime type). Ambiguity (e.g. `log(Object)` vs `log(String)` with `null`) is a compile error, not a runtime choice.

**Q13. What is the default value of an uninitialized field vs local?**
Object fields get type defaults (`0`, `false`, `null`); local variables are uninitialized and the compiler forbids use before assignment. This is why `int x; System.out.println(x);` does not compile.

**Q14. What is the difference between `>>` and `>>>`?**
`>>` is signed right shift (sign bit replicated); `>>>` is unsigned (zero-filled). For negative numbers they differ: `-8 >> 1` is `-4`, `-8 >>> 1` is a huge positive number. Use `>>>` when treating bits as unsigned data.

**Q15. What is the difference between `Math.round`, `ceil`, `floor`?**
`round` returns the nearest `long`/`int` (0.5 rounds up); `ceil` rounds up to the next `double`; `floor` rounds down. `Math.round(-2.5)` is `-2` (toward +∞, not "away from zero") — a frequent trap.

## Mid — tradeoffs & pitfalls

**Q1. How does the generational garbage collector work, and what breaks in production?**
The heap splits into **young** (Eden + two Survivor spaces) and **old** generations. Most objects die young: a minor GC copies survivors Eden→Survivor, then Survivor→old once they age out. A **major/full GC** collects the old generation and can pause every application thread for seconds on a large heap. The classic production failure: an unbounded cache fills the old gen → frequent full GCs → **stop-the-world pauses of 1–5 s** → p99 latency blows up. Fix: bound the cache, tune `-Xmx`, or move to a low-pause collector.

**Q2. G1 vs ZGC vs Shenandoah — when do you pick which?**

- **G1** (default since Java 9): region-based, targets a pause-time goal (`-XX:MaxGCPauseMillis=200`). Good default up to ~tens of GB heaps.
- **ZGC** (production since Java 15): concurrent, sub-millisecond pauses even at **multi-terabyte** heaps, but higher CPU/throughput overhead.
- **Shenandoah**: similar concurrent goal, also sub-ms pauses.
  One number to remember: G1 pause ~tens-to-hundreds of ms on big heaps; ZGC ~<1 ms regardless of heap size.

**Q3. What is the Java Memory Model and why does `volatile` matter?**
The JMM defines _happens-before_: a write to a `volatile` field happens-before any later read of it, giving visibility across threads. Without `volatile`, a thread may read a stale cached value and never see another thread's update. But `volatile` is **not atomic for compound actions** — `volatile int n; n++` is still a race (read-modify-write). Use `AtomicInteger`.

**Q4. `synchronized` vs `ReentrantLock` — what would you reach for?**
`synchronized` is simple, JVM-optimized, and automatically released. `ReentrantLock` adds: try-lock with timeout (`tryLock(100, ms)` avoids deadlock hangs), fairness option, and multiple condition variables. Reach for `ReentrantLock` only when you need a timeout or interruptible acquisition; otherwise `synchronized` is cleaner.

**Q5. Dangers of creating threads manually?**
`new Thread(() -> ...).start()` per task exhausts OS threads and offers no queueing, monitoring, or backpressure. The fix is a **thread pool** via `Executors` or, better, `new ThreadPoolExecutor(core, max, keepAlive, queue, factory, rejectionPolicy)`. A common bug: `Executors.newFixedThreadPool` uses an **unbounded `LinkedBlockingQueue`** — if tasks outpace consumers, the queue grows until **OutOfMemoryError**. Bound it.

**Q6. `ConcurrentModificationException` — what and how to avoid?**
It fires when a collection is structurally modified while iterated (except via the iterator's own `remove`). Fixes: iterate with `Iterator.remove()`, use a concurrent collection (`CopyOnWriteArrayList`, `ConcurrentHashMap`), or collect-to-remove then `removeAll`. `CopyOnWriteArrayList` is great for read-heavy, rarely-written lists (snapshot-on-write, ~O(n) per write).

**Q7. What is `hashCode` contract and why does `HashMap` need it?**
Equal objects must have equal hash codes; unequal objects _should_ have different ones to avoid collisions. A bad `hashCode` (e.g. constant) collapses every key into one bucket → `HashMap` degrades from O(1) to O(n) — a 1M-entry map becomes a linked list scanned linearly (~microseconds per op instead of ~50 ns).

**Q8. How does `HashMap` resize, and why is it expensive?**
When entries exceed `capacity × loadFactor` (default 0.75), it doubles capacity and rehashes all entries into the new buckets. A map growing from 1M to 2M entries rehashes 1M entries in one stop-the-world step (~tens of ms). Pre-size with `new HashMap<>(expectedSize)` to avoid mid-run resizes.

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
