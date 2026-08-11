---
title: "Senior Java Interview: Java Core Deep Dive"
description: "What senior interviewers actually probe in Java core — GC and the JMM, concurrency traps, virtual threads, and the runtime tooling that proves you've debugged production."
pubDatetime: 2026-08-10T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

A junior knows Java syntax. A senior knows **what the JVM is doing, why it behaves that way, and where it will surprise you in production.** This is the Java-core slice of senior interview prep.

> Mindset: "it depends, and here's the trade-off" beats reciting facts every time. The moment you answer with a tradeoff, a number, or a postmortem instead of a definition, you've cleared the bar.

## 1. Heap, GC, and the pause math

Expect: "What happens when you `new` an object?" A mid answer stops at "it goes on the heap." A senior talks about **where**, **how fast**, and **what the pause costs** — because that's what actually bites in production. Every question in this section has a numeric answer; interviewers listen for the number, not the noun.

### Allocation isn't a malloc call — it's a pointer bump

Each thread carves out a **TLAB (Thread-Local Allocation Buffer)** from Eden — a few hundred KB to a couple of MB of cache-hot private space — so allocating is just bumping a pointer. No global lock, no CAS. That's why `new` is so cheap that a JVM routinely allocates tens of millions of throwaway objects per second without breaking a sweat.

```java
String tmp = prefix + id;   // looks wasteful; a TLAB bump makes it nearly free
```

Where a senior goes deeper: **escape analysis**. The JIT (C2) can prove an object never leaves the method and **scalar-replace** it — the fields become JIT registers and stack slots and the allocation simply disappears. It's not literal "stack allocation"; it's "there is no object." Run `-XX:+PrintEliminateAllocations` and you'll watch the JIT throw allocations away. Objects that genuinely escape — passed to another thread, returned, stored in a field — are the ones that land in Eden and get promoted.

### Object layout and the compressed-oops threshold

Every object carries a header: an 8-byte mark word (identity hash, lock state, GC age) plus a 4-byte class pointer **when compressed oops are on** — the default for heaps below **~32 GB**. An empty `Object` is 16 bytes; a bare `Long` is 24. On a service allocating 100M objects per fan-out that's a gigabyte of pure header tax, which is why value-based redesigns (records with primitives, primitive-typed collections) are a real senior move, not trivia.

The threshold matters: cross 32 GB of heap and the JVM can no longer address objects with 32-bit narrow pointers, so it either **disables compressed oops** (every header widens) or you raise `-XX:ObjectAlignmentInBytes` (default 8, so raising it to 16 doubles padding). Both inflate memory-per-object. That's one reason a 40 GB heap can behave worse than a 28 GB one — "we sized up and got slower" is often this, or a GC pattern change. If the interviewer asks about heap sizing, name the 32 GB line before they do.

### The generational hypothesis, and the numbers that explain it

"Most objects die young" isn't a slogan, it's a measured distribution: on typical service workloads **~90% of objects are garbage within a few GC cycles**. That's why the heap is split:

- **Eden** — most objects allocate and die here; the majority never touch a survivor space.
- **Survivor spaces (S0/S1)** — objects that survive minor GC get copied back and forth; deliberately small.
- **Old gen** — objects that survive `-XX:MaxTenuringThreshold` of copying (default 15, dynamically adapted by G1).

The ratio matters more than the names: if ~90% of objects die in Eden, a young-gen GC copies only the surviving ~10%, which is why the pause is dominated by **live bytes copied**, not by total allocations.

### The pause math interviewers fish for

A stop-the-world pause is fundamentally

```
pause ≈ live_bytes_copied / copy_throughput
```

so the first lever is always **young-gen size**, not collector choice:

```
Example: 2 GB young gen, 70% survivor set survives a minor GC → ~1.4 GB copied.
At ~10 GB/s copy throughput that's ~140 ms of STW, every minor GC.
Shrink young gen to 512 MB → ~36 ms. Smaller still → more frequent GCs.
```

The tension is real: a bigger young gen means fewer, longer pauses; a smaller one means shorter pauses, more often. The second number to keep in your pocket is the **GC overhead**:

```
GC overhead = time_in_GC / wall_time
200 ms of GC per minute → 0.33% throughput tax.
```

G1 attacks the pause by doing **incremental** collection of regions toward `-XX:MaxGCPauseMillis` (default 200 ms) — but it's a **soft goal**. If the survivor set genuinely can't be copied in time, G1 quietly grows the pause. The failure modes matter more than the goal:

- **Concurrent-mode failure** — old gen fills faster than the concurrent marking cycle can reclaim it, and G1 falls back to a **full STW Full GC**. On a 50 GB heap that's seconds of everyone-stopped — the classic "latency chart turns into a cliff" postmortem.
- **Evacuation failure / promotion failure** — the to-space runs out mid-copy (usually a sudden survivor spike), objects get retained in place, and the following GCs pay for it.
- **Humongous allocations** — G1 regions are 1–32 MB; anything bigger than half a region is a **humongous** object that goes straight to old gen, can't be moved by normal copying, and can trigger a full GC. A 4 MB `byte[]` in a 2 MB-region heap is humongous. Pooled buffers, not per-request byte arrays, is the senior fix.

### Picking a collector with a number in hand

```
Parallel GC   → max throughput, STW on every major GC. Right when pauses are fine
                (batch jobs, offline). Often 100s of ms to seconds at scale.
G1 (default)  → balanced; region-based, mixed GCs. Good default for service heaps
                up to ~100 GB. Pauses 10s–200 ms depending on heap.
ZGC           → sub-ms pauses even on multi-TB heaps, via colored pointers +
                load barriers doing most work concurrently. Taxes CPU throughput.
Shenandoah    → same goal, different trick (concurrent evacuation, forwarding
                pointers). Pauses ~milliseconds, memory-heavy.
```

(CMS was the old latency answer and was **removed in JDK 14** — say that if someone drifts there.) A senior picks with a number in hand: "we run a 50 GB heap, the 99th-pctile pause must stay under 50 ms, and we have spare CPU, so ZGC — and here's the tradeoff, ZGC trades ~5–10% CPU throughput for that latency." And **never reach for `System.gc()` as a fix** — under Parallel it's a full STW pause of every thread for seconds; under G1 it may not even trigger what you think.

### Reference types — Soft, Weak, Phantom

GC interviewers love reference types because production misuse is so common:

- **`SoftReference`** — kept alive until the JVM decides memory is tight; survives normal GCs, collected under pressure. Good for a "cache that shrinks when the box gets hot," but JVM-specific and rarely a precise memory budget.
- **`WeakReference`** — collected on the next GC, no waiting. Right for identity maps keyed by ephemeral objects (a `WeakHashMap` keyed by a request context).
- **`PhantomReference`** — the referent is already unreachable when the reference is queued, so you can safely release native resources there; you **must** call `clear()` or it's never collected. This is the modern replacement for the deprecated `finalize()` path (JEP 421, deprecated in JDK 18) — pair it with a `ReferenceQueue`/`Cleaner`.

```java
// WRONG — finalize for native cleanup: unpredictable, resurrectable, deprecated
@Override protected void finalize() { nativeFree(handle); }

// RIGHT — PhantomReference + ReferenceQueue: cleanup runs on your drainer
// thread only when the object is provably unreachable, never on the GC thread
ReferenceQueue<Resource> queue = new ReferenceQueue<>();
PhantomReference<Resource> ref = new PhantomReference<>(resource, queue);
// drainer thread: poll queue; for each ref → nativeFree(handle) and ref.clear()
```

### Production failure modes

- **GC does not mean you stop managing memory.** Unbounded caches, static collections, and thread-local references still OOM you — GC can't collect what your code keeps rooted.

```java
// WRONG — a "cache" that is actually a growing root
private static final Map<String, Expensive> CACHE = new HashMap<>();

// RIGHT — bounded + time-based eviction; Caffeine is a ConcurrentHashMap
// with a W-TinyLFU admission window, so this is not "a timer + a map".
private static final Cache<String, Expensive> CACHE = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .build();
```

- **`ThreadLocal` leaks in thread pools.** Subtler than people think: the **key** in `ThreadLocalMap` is a `WeakReference`, so the key can be collected — but the **value is strongly referenced** and stays alive in the map entry until that slot is expunged. In a long-lived pooled thread that never touches the slot again, the value leaks forever. A request-scoped context holding a 10 MB blob, set on a 200-thread pool → 2 GB of "heap is full for no reason." The fix: `ThreadLocal.remove()` in a `finally`, or scoped values (section 4).
- **Allocation storms in tight loops** inflate GC frequency, not pause time. `jstat -gcutil` shows FGC/FGCT climbing while the heap never clears.
- **String interning explosions.** `String.intern()` on every request response header will balloon the string table and old gen. `-XX:+PrintStringTableStatistics` will show you.
- **`-histo:live` is not free.** `jmap -histo:live` (and `jcmd GC.class_histogram -live`) triggers a full GC — running that against a 50 GB production heap at peak is a self-inflicted incident. Prefer `-histo` or JFR.

## 2. The JMM and memory visibility — happens-before, fences, and what a barrier costs

"Volatile makes writes visible" is a mid answer. The senior answer is the **happens-before edge** — the actual contract the JMM guarantees — plus the price the hardware charges you for it. The question "why isn't my flag visible?" is answered with the program-order + synchronizes-with rules, never with "it just doesn't work on my machine."

The happens-before edges you can actually rely on:

- `volatile` write → subsequent `volatile` read of the same field.
- Unlocking a monitor → subsequent locking of the same monitor (so `synchronized` gives visibility, not just exclusion).
- `Thread.start()` → everything the started thread does.
- Everything a thread does → what the joining thread sees after `join()`.
- Writing a `final` field in a constructor → reads after safe publication.
- `Atomic*` writes → subsequent reads (CAS forms a full fence).

```java
// WRONG — the infinite-loop classic. stop may stay in thread T's register/cache
// forever; the compiler may even hoist the read out of the loop.
boolean stop = false;                 // not volatile
while (!stop) { doWork(); }

// RIGHT — volatile write on T1 happens-before the volatile read on T2
volatile boolean stop = false;
while (!stop) { doWork(); }
```

### The double-checked-locking trap they always probe

The canonical JMM question. The problem isn't the lock — it's that the unsynchronized read can observe a reference to an **incompletely constructed** object: the reference store is allowed to float before the constructor's writes finish (no happens-before across threads), so thread B sees `instance != null` and returns a half-built singleton.

```java
// WRONG — DCL without volatile. Both threads can observe a partially-built instance.
private static Singleton instance;
public static Singleton get() {
    if (instance == null) {                 // unsynchronized read
        synchronized (Singleton.class) {
            if (instance == null) {
                instance = new Singleton();
            }
        }
    }
    return instance;
}

// RIGHT — volatile creates the constructor-write → read happens-before edge
private static volatile Singleton instance;
```

On a 64-bit JVM a `volatile long` read is one atomic load, but on a **32-bit JVM it's two 32-bit halves** — so `volatile long` is exactly the case where "volatile" and "atomic" diverge. Small trivia that separates people who read the JMM from people who lived through it.

### What a fence actually costs

`volatile` compiles down to a memory barrier — on x86 a `lock`-prefixed instruction or an `mfence` for the store-load case. It's not free: a fenced volatile write runs in the **tens of nanoseconds**, versus ~1 ns for a cache-local read. The latency ladder is the mental model interviewers want to hear:

```
L1 cache hit:                ~1 ns
L2:                          ~4 ns
L3:                          ~10–15 ns
main memory:                 ~100 ns
fenced volatile write:       ~20–80 ns (store-load barrier)
NVMe random read:            ~20–50 µs
same-DC network round trip:  ~100–500 µs
```

That ladder is why "just make everything volatile" is a real latency bug in hot loops, and why false sharing — the next trap — stings so hard.

### volatile ≠ atomicity, and the "which one" answer

`volatile` gives visibility and ordering, **not** atomicity. `i++` is read-modify-write; two threads can both read 41 and both write 42. The correct tool depends on the shape of the contention:

- **`AtomicLong`** — a single CAS on one cache line. Fast until threads collide, then they spin-retry and the line bounces across cores.
- **`LongAdder`** — stripes the counter across a set of cells, one per contended core, and sums them on `sum()`. Under heavy contention (say ≥ 16 threads hammering one counter) it runs **several times faster** than `AtomicLong` because CAS retries vanish. Tradeoff: `sum()` is O(cells) and approximate under concurrent writes — fine for metrics, wrong for a precise debit ledger.

### False sharing — the trap that isn't a lock

A cache line is 64 bytes. Two fields that are **independent** but sit on the same line get a coherence ping-pong every time either is written, even in lock-free code. A per-thread `long[]` counter is the classic: thread 0 owns index 0, thread 1 owns index 1 — adjacent in memory — and they trample each other at 10–100× the expected cost. `@Contended` (JEP 142) pads the fields onto separate lines, or you size per-thread slots by line width. When an interviewer says "your lock-free counter is slower than the `synchronized` one," this is what they're probing.

```
That "why is my counter at 2% CPU but 40× slow" report is false sharing —
a coherence miss costs ~100 ns of memory traffic per ping, at high frequency.
```

## 3. Concurrency primitives — what's under the lock

### `synchronized` is not a lock, it's a state machine

A monitor starts **thin** — bits in the object's mark word, no OS mutex involved. Under contention it **inflates** to a heavyweight monitor with an OS-level wait queue and a wait set, and the JVM applies **adaptive spinning** before parking the thread. Biased locking used to make uncontended acquisition ~free, but it was **deprecated in JDK 15 and removed in JDK 18** — say that date confidently and you've signaled you follow JEPs. The practical lesson: uncontended `synchronized` is nearly free (a mark-word update, ~tens of ns); contended `synchronized` pays a park/unpark round trip that crosses into the kernel — microseconds, three to four orders of magnitude worse than the uncontended path. That's _why_ you reach for atomics or striping.

### `ReentrantLock` and AQS

`ReentrantLock`, `Semaphore`, `CountDownLatch` are all built on **AQS** (`AbstractQueuedSynchronizer`): a single `volatile int state` plus a CLH-style wait queue, mutation via CAS and `LockSupport.park/unpark`. When you call `tryLock(2, TimeUnit.SECONDS)` you're doing a timed CAS + park loop — the fairness knob (`new ReentrantLock(true)`) makes waiters go FIFO but costs throughput via more context switches. The senior move is picking based on the failure mode:

```java
// WRONG — block forever waiting for a lock you may never get
lock.lock();
try { update(); } finally { lock.unlock(); }

// RIGHT — a lease with a deadline. This is how you avoid "stuck thread,
// heap full of waiting threads, nobody holding the lock" incidents.
if (lock.tryLock(2, TimeUnit.SECONDS)) {
    try { update(); } finally { lock.unlock(); }
} else {
    // degrade: return 503, skip, log — don't hang
}
```

- **`ReentrantLock`** adds `tryLock(timeout)`, multiple `Condition`s (await/signal with named predicates), and fairness control — `synchronized` has exactly one wait set.
- **`StampedLock`** — the lock most people can't name, which is exactly why it's a good probe. Its **optimistic read** never blocks at all: take a stamp, read, then `validate()` — if a writer barged in, fall back to a real read lock. Great when readers dominate and writes are rare; wrong when writes are frequent, because validation keeps failing and you thrash.

```java
long stamp = lock.tryOptimisticRead();     // no lock at all
int v = shared;
if (!lock.validate(stamp)) {               // writer sneaked in?
    stamp = lock.readLock();
    try { v = shared; } finally { lock.unlockRead(stamp); }
}
```

- **`ConcurrentHashMap` (Java 8+)** uses CAS for empty bins and `synchronized` on the bin head for collisions; bins **treeify at ≥ 8 entries** into a red-black tree (a bin of equal-hash keys would otherwise degenerate to O(n)). `size()` is a sum of base counters, so it's **approximate** — say that out loud, it's a classic "gotcha they check for."
- **The `computeIfAbsent` deadlock trap.** It holds the bin's lock while your mapping function runs, so a recursive `computeIfAbsent` on the **same key** from inside itself deadlocks the bin in Java 8 (fixed in JDK 9 by a bin-occupancy re-check). Production version: a cache that lazily builds a value which lazily loads the same value. Know it by name.

```java
// WRONG — Java 8 deadlock: mapping function recomputes the same key
cache.computeIfAbsent(key, k -> cache.computeIfAbsent(k, x -> build(x)));

// RIGHT — compute once outside, or use putIfAbsent semantics you control
var v = cache.get(key);
if (v == null) { v = build(key); cache.putIfAbsent(key, v); }
```

### `CompletableFuture` — the pool trap nobody reads the Javadoc for

`thenApplyAsync` runs on **`ForkJoinPool.commonPool()`**, whose parallelism is `availableProcessors - 1`. The moment any async task does blocking work — a JDBC call, a `Thread.sleep`, a `synchronized` block — it steals a worker, and if enough tasks block, the pool is exhausted and **everything downstream stalls even though the box is idle**. Production symptom: "we replaced futures with a bigger thread pool and it fixed itself." The senior fix is to pass an explicit executor sized for the blocking work:

```java
// WRONG — blocking JDBC inside async code starves commonPool
CompletableFuture.supplyAsync(() -> accountRepository.findById(id).get())
    .thenApplyAsync(Account::getBalance);

// RIGHT — explicit executor sized by Little's law (section 4), or virtual threads
CompletableFuture.supplyAsync(() -> accountRepository.findById(id).get(), jdbcExecutor)
    .thenApplyAsync(Account::getBalance, jdbcExecutor);
```

Error handling nuance they drill on: `handle` sees both value and throwable, `exceptionally` only errors, and **an exception in `thenApply` returns a completed exceptionally** — so decide whether you want to compose or recover. And remember: `thenCompose` (flatMap) vs `thenCombine` (zip) is the difference between a chain and a fork-join.

## 4. Threads, thread pools, and virtual threads

### Pool sizing with Little's law — the number that ends the argument

The naive answer is "cores × 2". The defensible answer is Little's law, because for **blocking** workers the pool is a conveyor belt:

```
pool_size = throughput × average time-in-pool
300 req/s × 80 ms average JDBC+CPU time = 24 workers
```

For **CPU-bound** work there's no waiting term, so the pool should sit at roughly the core count (+1) — more threads than cores just queues and switches. The general shape is `N = cores × (1 + wait/compute)` — derive it, don't quote it.

Oversizing past that is actively harmful: context-switch thrash, idle connections on the DB side, and queueing _inside_ the database. Undersizing queues requests at `connectionTimeout` until latency climbs then throughput collapses — the classic "DB is fine, the pool is empty" incident.

```java
// WRONG — 200 threads because the box has 64 cores, unbounded queue
// (unbounded queue + blocking tasks = the "infinite memory buffer" OOM)
ExecutorService pool = new ThreadPoolExecutor(
    0, 200, 60, SECONDS, new LinkedBlockingQueue<>());   // unbounded!

// RIGHT — Little's law says ~25; bounded queue; explicit saturation policy
ExecutorService pool = new ThreadPoolExecutor(
    25, 25, 0, MILLISECONDS, new ArrayBlockingQueue<>(100), new CallerRunsPolicy());
```

`CallerRunsPolicy` — the rejected task runs on the calling thread — is the anti-OOM choice: it adds **backpressure** instead of buffering or dropping. Know `AbortPolicy` (default, throws), `DiscardPolicy`, and why none of them backpressure except `CallerRuns`. And re-check the JDK defaults you _think_ you know: `Executors.newFixedThreadPool` uses an unbounded `LinkedBlockingQueue`, so with blocking tasks it's an OOM vector, not a pool. `SynchronousQueue` (used by `newCachedThreadPool`) is the opposite extreme — a zero-buffer handoff.

### Platform threads are expensive; virtual threads are not

A platform thread carries a ~1 MB default stack (virtual memory) plus kernel scheduling; creating one costs microseconds and context-switching tens of thousands of them burns real kernel time. **Virtual threads** (Java 21+, Project Loom) are Java objects with a few-KB stack, scheduled on a handful of **carrier threads** (a `ForkJoinPool` with parallelism = CPU count) — the OS only ever sees the carriers.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = urls.stream()
        .map(url -> executor.submit(() -> fetch(url)))
        .toList();
}
```

- **What they're for:** I/O-bound work that blocks — HTTP calls, DB round trips, RPCs. A million concurrent outbound calls on a thread-per-request platform-thread pool dies; on virtual threads it's a million cheap stacks.
- **What they are NOT:** faster CPU-bound work. There's still only N CPUs; a CPU-bound virtual thread gains nothing.
- **Pinning — the trap:** a virtual thread that blocks while holding a carrier resource pins it. Before JDK 24 that meant any **`synchronized` block that blocks**; **JEP 491 (JDK 24) removed pinning for `synchronized`**, so the residual sources are blocking **native frames** (JNI / the Foreign Function & Memory API), **class loading / class initializers**, and **local file I/O on Linux**. AQS-based locks like `ReentrantLock` never pinned — `LockSupport.park` is virtual-thread-aware and unmounts the thread, which is the classic misunderstanding. "What still pins?" is the current-JEPs signal, and the audit tool is the `jdk.VirtualThreadPinned` JFR event (enhanced in JDK 24 to say _why_).
- **`ThreadLocal` on virtual threads is a footgun:** every virtual thread has its own map, so a request-scoped `ThreadLocal` on a million virtual threads is a million entries. The successor is **scoped values** (`ScopedValue`), which are immutable, inheritable only in structured-concurrency scopes, and reclaim cheaply — that's what you'd name instead of "use a ThreadLocal."
- **Virtual threads don't remove the connection-pool bound.** A million virtual threads can all block on a HikariCP pool whose default `maximumPoolSize` is 10 — you've only moved the queue from the thread pool to the connection pool. Size connections with Little's law too (section 5).

### Structured concurrency

"Millions of threads" begs the question: how do you cancel them as a group when one fails? `StructuredTaskScope` (Java 21+) binds child tasks to the parent's lifetime — `fork` children, then `join` and handle shutdown on failure, and the scope's end **cancels every still-running child automatically**. The failure mode this kills: a fan-out request that silently leaves 900 of 1,000 outbound calls running after a timeout. If you can contrast "fire-and-forget futures that leak work" with "`StructuredTaskScope` that shuts the whole fan-out down," you've answered the concurrency-resilience question before it's asked.

## 5. The database that lives behind your methods

A senior backend interview drifts from the JVM to the pools to the SQL, because the failure modes are all the same shape: a bounded resource — heap, threads, connections, index pages — and something that quietly queues on it. Three traps that show up constantly.

### Connection pools are Little's law, with a hard ceiling

```java
// WRONG — thread and connection counts both unbounded: 500 concurrent requests
// → 500 JDBC connections → the DB hits max_connections and everyone times out
```

```
connections = TPS × average query time
1,000 req/s × 20 ms avg query = 20 connections
then cap it — HikariCP's default is 10; "cores × 10" is a fine starting heuristic
```

Under-sizing queues requests (the same "DB is fine, the pool is empty" shape as section 4); over-sizing adds DB-side context switches and waits. When the thread pool _and_ the connection pool both queue, you get the report that says "the DB averages 0.1 ms but the app takes 800 ms."

### Index B-tree height — why a point lookup is cheap and a scan is not

An index is a B+tree: 8–16 KB pages, a few hundred keys per page (~500–1,000 if each entry is ~16 bytes). At a billion rows the tree is only **3–4 levels tall**, so a point lookup is 3–4 page fetches — and the top levels live in the buffer pool, so those fetches are ~100 ns memory reads, not disk. That's the numeric answer to "why is an indexed lookup fast."

The trap is asking for an indexed column in a way that isn't a range:

```sql
-- WRONG: function on the column hides it from the B-tree → full scan
SELECT * FROM orders WHERE YEAR(created_at) = 2026;

-- RIGHT: range predicate on the raw column → B-tree range scan
SELECT * FROM orders
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01';
```

Same family: `LIKE '%needle%'` (leading wildcard = scan), arithmetic on the column, and `IS NOT NULL` on a mostly-null column. Interviewers watch for whether you say "it depends on the selectivity" versus a blanket "indexes make everything fast."

### N+1 — the query you didn't notice you wrote

```java
// WRONG — one query for the orders, then one more per order = N+1 round trips.
// With 1,000 orders that's 1,001 queries × ~1 ms network+parse each → ~1 s of
// latency that never shows up in any single slow-query log.
for (Order order : orders) {
    count += itemRepo.findByOrderId(order.getId()).size();
}

// RIGHT — one round trip for all of them; batching (e.g. Hibernate @BatchSize)
// is the middle ground when the IN-list would get absurd.
var ids = orders.stream().map(Order::getId).toList();
long count = itemRepo.findByOrderIdIn(ids).size();
```

```sql
-- same shape in SQL
SELECT * FROM item WHERE order_id IN (1001, 1002, /* ... */);
```

The senior tell isn't just knowing N+1 exists — it's knowing _where it hides_: the lazy-loaded `@ManyToOne` serialized into a DTO, per-row JSON enrichment, a `findById` inside a `map()`. And the fix often moves the problem: batching helps, but the real answer is often "fetch the DTO you actually need with a JOIN, not the entities."

## 6. JVM internals interviewers love

- **Class loading & the three loaders.** bootstrap (null parent, `java.*`), platform (JDK 9+; replaced the extension loader), application (classpath). **Parent-delegation** — a classloader first asks its parent — is a security and consistency mechanism: you can't smuggle in a fake `java.lang.String`. A senior can narrate the failure modes cold: `ClassNotFoundException` is thrown by explicit `Class.forName`/`loadClass` when the class **isn't found**; `NoClassDefFoundError` is thrown at **link/use time** when the class _was_ there during compilation but is missing or failed to initialize at runtime — typically a missing dependency JAR or a static-initializer exception that aborted loading. Know the difference cold.
- **The classloader leak that OOMs your Metaspace.** Every app redeploy (Tomcat, Spring Boot dev-mode reload, dynamic proxying/bytecode gen) creates a classloader; if anything roots the old loader — a static field, a JDBC driver registered in `DriverManager`, a cached proxy — its metadata never unloads, and **Metaspace** (class metadata, unbounded by default) climbs until native memory dies. `jcmd <pid> VM.native_memory` plus `-XX:MaxMetaspaceSize` is the arsenal. The number people underestimate: a leak that grows a few MB per reload looks harmless until it's 2 GB after a hundred deploys.
- **The JIT is why warm code is fast.** Tiered compilation: C1 (client, fast warmup) then C2 (server, aggressive optimizations: inlining, escape analysis, loop unrolling), with **OSR** (on-stack replacement) to swap in optimized code mid-loop and **deoptimization** when an assumption breaks. "Our first request after deploy is slow" is JIT warmup, and profiling shows it as compilation events — not "we need a bigger box." `-Xlog:jit+compilation=debug` shows the recompilation cascade. The production gotcha: a hot method that still isn't fast after traffic because the call site is **megamorphic** (too many receiver types to inline), or because it recompiles constantly past `-XX:CompileThreshold`.
- **`String`, caches, and `==`.** `String` is immutable by contract and by layout (private `byte[]`), enabling the constant pool and safe sharing; the **string pool moved from perm gen to the heap in JDK 7**. `Integer.valueOf` caches **-128..127** (stretchable with `-XX:AutoBoxCacheMax`); `Long` caches the same range. So `==` on wrappers "works" in the cache range and bites outside it — the worst possible kind of bug because it passes tests and dies in production at 128.

```java
Integer a = 127, b = 127;   // cached → a == b is true
Integer c = 128, d = 128;   // new objects → c == d is false
```

- **Records** are the interview-friendly current answer: they're classes whose `equals`/`hashCode`/`toString`/accessors are derived from the component list, they're `final` by construction, and their serialization is defined over components. State the tradeoff honestly: they're a value-semantics _default_, not a value object — if equality is by business key not all fields, you still hand-write `equals`.
- **Stack depth is a real resource.** Default `-Xss` is 512 KB–1 MB; deep recursion — a recursive JSON walker, a naive tree traversal — throws `StackOverflowError` when the frames exceed it, and it's a native-side failure, not a heap one. Ask "what's the stack size on this box?" before proposing recursion-heavy processing.

## 7. Runtime & tooling — prove you've debugged production

A senior says: "when it's slow in prod, I don't guess — I measure." The interviewer can't verify your tool knowledge from a definition; they _can_ hear a real incident. Have one in your pocket with this shape: symptom → hypothesis → tool → finding → fix.

The toolkit, with what each is actually for:

- **`jstack`** — thread dumps. Find `BLOCKED` threads piled on one monitor, deadlocks (JVM prints a deadlock section itself), or a `RUNNABLE` thread stuck in a socket read. Take **three dumps a few seconds apart** — a single dump is a blurry photo.
- **`jmap -histo`** — object histogram; find the class holding hundreds of MB (`byte[]`, `char[]` tops the list suspiciously often) and trace who roots it. Use the non-live variant in prod — `-histo:live` forces a full GC (section 1).
- **`jstat -gcutil`** — GC frequency and pause trend _over time_, which is how you spot an allocation storm or a ballooning old gen before the OOM.
- **`jcmd`** — the Swiss Army knife: `jcmd <pid> GC.heap_dump`, `VM.native_memory`, `Thread.print`, `VM.flags`. `jmap` is for dumps; `jcmd` for live introspection.
- **JFR (Java Flight Recorder)** — JDK 11+ includes it free. Events for GC phase pauses (`jdk.GCPhasePause`), allocation (`jdk.ObjectAllocationInNewTLAB`), lock contention (`jdk.JavaMonitorEnter`), virtual-thread pinning (`jdk.VirtualThreadPinned`), method sampling, socket reads. Start with `jcmd <pid> JFR.start name=profile settings=profile`, then `jfr view` the file. Overhead at default settings is well under 1% — say that, it's the killer feature.
- **async-profiler** — on-CPU + off-CPU wall-clock + allocation + lock profiling with flamegraphs, no JVMTI agent in the hot path. This is the one that finds _why_ the CPU is high, not just _that_ it is.
- **GC logs.** `-Xlog:gc*` (JDK 9+ unified logging) with `-Xlog:gc:file=gc.log:time,uptime`. Read the pauses _and_ the heap-after-GC; a service whose heap after GC keeps climbing is leaking, a service whose pauses are long but heap is flat is a sizing problem.

Sample narrative: "P99 latency doubled after the release. `jstat -gcutil` showed FGC jumping every 2 minutes; `jmap -histo` showed 800 MB of `byte[]`; JFR allocation events pointed at the new gzip code; the fix was streaming + pooling the buffers. P99 back to 40 ms." **That paragraph, in an interview, is worth more than any definition you can recite.**

## 8. Self-check

- [ ] Explain TLAB allocation, and why escape analysis makes `new` sometimes cost nothing.
- [ ] State the compressed-oops 32 GB threshold and why a 40 GB heap can be slower than a 28 GB one.
- [ ] Produce the pause math: what controls a young-gen STW pause, and how G1 trades frequency vs duration.
- [ ] Name concurrent-mode failure, evacuation failure, and the humongous-object rule for G1.
- [ ] SoftReference vs WeakReference vs PhantomReference — when is each correct?
- [ ] Name the happens-before edges for `volatile`, monitor unlock→lock, `start()`/`join()`.
- [ ] Write double-checked locking correctly and explain why the non-volatile version is broken.
- [ ] Explain why `LongAdder` beats `AtomicLong` under contention, and when it's the wrong tool.
- [ ] What is false sharing, and what does `@Contended` do?
- [ ] What does `StampedLock`'s optimistic read do, and when does it thrash?
- [ ] What happens to `thenApplyAsync` on the `commonPool` when a task blocks, and the fix?
- [ ] Size a thread pool with Little's law, and pick a saturation policy that backpressures.
- [ ] When do virtual threads help, when not, and what still pins a carrier after JDK 24?
- [ ] `ClassNotFoundException` vs `NoClassDefFoundError`, and what leaks Metaspace on redeploy.
- [ ] Explain B-tree height and why `WHERE YEAR(col) = ?` scans while a range predicate doesn't.
- [ ] One GC/perf incident you actually found with a profiling tool.

If those feel easy, you're ready on Java core.

## 9. Interviewer follow-ups

When your first answer lands, they start drilling. Be ready for these:

- "Your service does 2,000 req/s and each request blocks ~50 ms in JDBC. Size the thread pool. Now what if 10% of calls take 5 seconds?"
- "Same service: how many DB connections do you give it, and what happens to the virtual threads when the pool is 10?"
- "You claim G1 pause is a soft goal. Walk me through a `gc` log line that proves G1 missed `MaxGCPauseMillis`, and what you'd change."
- "`volatile` gives happens-before. Does that make a `volatile int` safe as a counter? What if it's a `volatile long` on a 32-bit JVM?"
- "I wrote `synchronized` code and it's slower than the `ConcurrentHashMap` version. Is `synchronized` broken?"
- "The `ThreadLocal` in your thread pool is holding 200 MB. What's actually rooting it, and what's the fix — and the future replacement?"
- "Explain why JDK 24 changed pinning behavior, and what still pins a virtual thread."
- "`SELECT * FROM orders WHERE YEAR(created_at) = 2026` is slow, and the column is indexed. Why, and what do you rewrite it to?"
- "You see `OutOfMemoryError: Metaspace` after a redeploy with no class added. What's your first command, and what do you look for?"
- "A hot method is still slow after 10 minutes of traffic. What's the JIT possibly doing, and how do you prove it with a log?"

That's the Java-core bar.
