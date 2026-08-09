---
title: "Java Threads: From Thread Pools to Virtual Threads"
description: "Why more threads can make applications slower, how thread pools and backpressure really work, the concurrency bugs that only appear in production, and when Virtual Threads actually help."
pubDatetime: 2026-08-09T00:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

For decades, Java developers have been told that threads are the way to make applications fast. And for decades, production incidents have proven the opposite: the more threads people add, the slower — or worse, the more unstable — the application becomes.

Let's start with four questions that every backend developer has asked at some point:

- Why can adding more threads make an application **slower**?
- Why does a thread pool with hundreds of threads not improve CPU utilization?
- Why can Virtual Threads handle massive concurrency but not make CPU-bound code faster?
- Why do concurrency bugs almost always **only appear in production**?

This article answers all four questions. We will go from the basics (what a thread actually is), through thread pools and their failure modes, to the most common concurrency bugs, and finally to Virtual Threads — what they solve, what they do **not** solve, and how to decide when to use what.

## 1. What Is a Thread?

### 1.1. Process vs Thread

A **process** is a running program: its own memory space, its own file descriptors, its own address space. Two processes cannot read each other's memory directly; they communicate through pipes, sockets, files, or shared memory — all with explicit coordination.

A **thread** is a unit of execution *inside* a process. Threads of the same process share the process memory (heap, static fields, class metadata), which is why they can communicate trivially — and also why they corrupt each other's state so easily.

```
+-------------------------------------------------------+
|  PROCESS                                               |
|  +-----------------+  +-----------------+             |
|  | Thread 1        |  | Thread 2        |             |
|  | own stack       |  | own stack       |             |
|  +-----------------+  +-----------------+             |
|                                                       |
|  SHARED MEMORY: heap, static fields, classes          |
+-------------------------------------------------------+
```

Each thread has its **own stack** (local variables, call frames) but **shares** the heap. That split explains almost everything about multithreading: sharing is what makes it useful, and sharing is what makes it dangerous.

### 1.2. Concurrency vs Parallelism

These two words are constantly confused, and the distinction is the foundation of the whole article.

- **Concurrency** is about *structure*: multiple tasks making progress in overlapping time periods, interleaved on the same CPU.
- **Parallelism** is about *execution*: multiple tasks running at the exact same instant, on different CPU cores.

```
Concurrency (interleaved on 1 core):
  Thread A:  |--A1--|        |--A2--|        |--A3--|
  Thread B:        |--B1--|        |--B2--|        |--B3--|

Parallelism (simultaneous on 2 cores):
  Core 1:    |------A1------|------A2------|
  Core 2:    |------B1------|------B2------|
```

Concurrency does not require multiple cores. Parallelism requires them. If your machine has 4 cores and you create 1000 threads, you still get **at most 4 tasks running at the same instant** — the other 996 are waiting, sleeping, or being context-switched. Creating threads does not create cores.

### 1.3. CPU-bound vs I/O-bound Workloads

The single most important question to ask about any task is: *what is it waiting for?*

- **CPU-bound**: the task spends its time computing — parsing JSON, hashing, image processing, cryptography, compression. Speed is limited by CPU cores, not by thread count.
- **I/O-bound**: the task spends most of its time *waiting* — for a database, an HTTP response, a file read, a message from Kafka. Speed is limited by latency and concurrency, and more parallel tasks directly help.

```
CPU-bound task:   [=====compute=====][=====compute=====][=====compute=====]
                  ↑ CPU is the bottleneck → only #cores matters

I/O-bound task:   [wait for DB 95ms][wait for DB 95ms][wait for DB 95ms]
                  [ 5ms work ][ 5ms work ][ 5ms work ]
                  ↑ 95% of time is waiting → more concurrency helps
```

A typical DB call in production: 5 ms of actual work, 95 ms of waiting. That is a 5% CPU utilization. You can run ~20 such tasks per core before you saturate the CPU — the other 19 are effectively free while waiting.

### 1.4. Context Switching

When the CPU switches from executing one thread to another, the OS must save the entire state of the current thread (registers, program counter, stack pointer) and load the state of the next one. This is a **context switch**, and it is not free:

- It costs CPU time (microseconds per switch, thousands of switches per second add up).
- It destroys CPU caches and TLB entries — the new thread's data is cold, so memory latency spikes right after every switch.
- The more threads you have, the more switching happens, and the more of the CPU's time goes to *switching* instead of *working*.

This is the direct answer to the first question: **adding more threads than the machine can run simultaneously does not add work capacity — it adds switching overhead.**

### 1.5. Blocking

A thread **blocks** when it cannot continue without an external event: waiting for a lock, a `sleep()`, a DB query, an HTTP response. A blocked thread:

- Is removed from the CPU (it consumes **zero** CPU while blocked).
- Still holds its memory (stack, ~1 MB reserved).
- Still counts as a thread for the OS scheduler.

Blocking is exactly what makes I/O-bound work scalable with threads: while thread A waits for the DB, the CPU can run thread B. The whole game of thread pools — and later of Virtual Threads — is about having enough runnable work to keep the CPU busy while most threads are blocked.

## 2. How to Create and Use Threads in Java

### 2.1. Thread and Runnable

The lowest-level way is to create a `Thread` with a `Runnable`:

```java
Runnable task = () -> System.out.println("Hello from " + Thread.currentThread().getName());

Thread t = new Thread(task, "worker-1");
t.start();
```

Since Java 8 you can also use `Callable` when you need a result:

```java
Callable<Integer> callable = () -> {
    // ... work ...
    return 42;
};
```

### 2.2. start() vs run()

This is a classic interview question with a real production meaning:

```java
Thread t = new Thread(() -> System.out.println("running in " + Thread.currentThread().getName()));

t.start();  // ✅ schedules a NEW OS thread; the task runs there
t.run();    // ❌ just calls run() in the CURRENT thread — no concurrency at all!
```

`run()` does not create any thread. It is an ordinary method call, executed by the caller. If you see `run()` in production code, someone is calling a "thread" that never became a thread — the code runs, but with zero parallelism, and the bug is invisible because it still produces correct results.

### 2.3. Why `new Thread()` Per Task Is Dangerous

The naive approach — one thread per task:

```java
for (int i = 0; i < 100_000; i++) {
    new Thread(() -> {
        // fetch something over HTTP
    }).start();
}
```

This code will likely crash or freeze your application. Why?

- **Memory**: each platform thread reserves ~1 MB of stack. 100,000 threads ≈ 100 GB of virtual memory. The JVM will die with `OutOfMemoryError: unable to create native thread` long before.
- **Creation cost**: creating a thread requires a kernel call and native stack allocation — milliseconds each, not nanoseconds.
- **Scheduling chaos**: 100,000 threads on 8 cores means ~12,500 context switches per thread just to cycle through everything once.
- **No lifecycle control**: you cannot wait for all of them, bound the number, or handle failures.

The JVM does not limit how many threads you create — the **OS and the RAM** do. Every production thread-count limit you have ever seen (Tomcat's `maxThreads`, HikariCP's `maximumPoolSize`) exists because of this hard reality.

## 3. Thread Lifecycle

Every `Thread` moves through six states. `Thread.getState()` and thread dumps expose them, and each state means something specific in production:

```
        ┌──────────────────────────────────────────┐
        ▼                                          │
   ┌─────────┐  start()   ┌────────────┐           │
   │  NEW    │───────────▶│ RUNNABLE   │───────────┼──▶  running on a core
   └─────────┘            └────────────┘           │
                            │  ▲                   │
       blocked on a lock    │  │  lock acquired    │
                            ▼  │                   │
                        ┌─────────┐                │
                        │ BLOCKED │                │
                        └─────────┘                │
                            │  ▲                   │
       wait()/join()/park   │  │  notified         │
                            ▼  │                   │
                        ┌─────────┐                │
                        │ WAITING │                │
                        └─────────┘                │
                            │  ▲                   │
       sleep()/await(ms)    │  │  timeout/notify   │
                            ▼  │                   │
                        ┌──────────────┐           │
                        │TIMED_WAITING │           │
                        └──────────────┘           │
                            │                      │
   run() returns/exits      │                      │
                            ▼                      │
                        ┌───────────┐              │
                        │TERMINATED │──────────────┘
                        └───────────┘
```

- **NEW**: constructed, `start()` not yet called. The thread does not exist as an OS thread yet.
- **RUNNABLE**: the thread is ready to run, or is running on a core. Note: Java does not distinguish "running" from "ready-to-run" — both are RUNNABLE.
- **BLOCKED**: waiting to acquire a `synchronized` monitor that another thread holds. This is the state you see when threads pile up on a hot lock.
- **WAITING**: parked indefinitely via `Object.wait()`, `Thread.join()`, or `LockSupport.park()`. Waiting for another thread to wake it.
- **TIMED_WAITING**: `Thread.sleep()`, `join(millis)`, `await(timeout, unit)` — waiting with a deadline.
- **TERMINATED**: `run()` returned or threw. The thread is dead; it cannot be restarted.

**Where you see these states in real applications:**

- A `jstack` dump full of `BLOCKED` threads → synchronized lock contention: some shared object (often a database connection or a static map) is the bottleneck.
- Many `WAITING` on `park` with threads piled up → the task queue of an `ExecutorService` is full, or `CompletableFuture` chains are waiting on each other.
- Many `TIMED_WAITING` on `sleep` → periodic jobs; if hundreds are sleeping, something is misconfigured.
- Many `RUNNABLE` → the machine is likely CPU-saturated: `top` will confirm it.

## 4. Thread Pools and ExecutorService

### 4.1. Why Thread Pools Exist

The conclusion of section 2: threads are expensive, and unbounded thread creation kills applications. The fix is to **reuse a fixed number of threads**. A thread pool is exactly that: a set of worker threads that stay alive and pull tasks from a queue.

```java
ExecutorService pool = Executors.newFixedThreadPool(10);

for (int i = 0; i < 10_000; i++) {
    pool.submit(() -> processRequest(i));   // 10 threads execute 10,000 tasks
}

pool.shutdown();
// pool.awaitTermination(30, TimeUnit.SECONDS);
```

### 4.2. How a ThreadPoolExecutor Actually Works

The full configurable version is `ThreadPoolExecutor`. It has four knobs, and **their interaction is subtle**:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        10,                                  // corePoolSize
        100,                                 // maximumPoolSize
        60, TimeUnit.SECONDS,                // keepAliveTime (for threads above core)
        new ArrayBlockingQueue<>(10_000),    // work queue
        new ThreadPoolExecutor.CallerRunsPolicy()  // rejection policy
);
```

The task-acceptance algorithm, step by step:

```
submit(task):
  1. if worker threads < corePoolSize      → create a new worker, run the task
  2. else if the queue is not full         → enqueue the task
  3. else if worker threads < maximumPoolSize → create a new worker (up to max)
  4. else                                  → apply the rejection policy
```

The critical insight: **the queue is used *before* the pool grows beyond the core size.** With `newFixedThreadPool(10)`, the internal queue is unbounded, so step 3 is never reached — a "fixed" pool of 10 will **never** grow past 10 threads, no matter how many tasks are submitted. Thousands of queued tasks will simply wait.

### 4.3. Core Size, Max Size, and the Queue

- **corePoolSize**: the steady-state number of threads the pool keeps alive.
- **maximumPoolSize**: the absolute cap, only reachable if the queue is *full*.
- **work queue**: the buffer between producers and workers.
- **keepAliveTime**: how long an idle thread *above* core size survives before being destroyed (default behavior; `allowCoreThreadTimeOut(true)` extends this to core threads).

This means the same `ThreadPoolExecutor` config behaves completely differently depending on the queue:

```java
// ❌ unbounded queue: tasks pile up forever, memory grows until OOM
new ThreadPoolExecutor(10, 100, 60, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(),            // unbounded!
        ...);

// ✅ bounded queue: excess tasks overflow to extra threads, then are rejected
new ThreadPoolExecutor(10, 100, 60, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(1_000),        // bounded
        ...);
```

With an unbounded queue, `maximumPoolSize` is dead config — the pool never reaches it.

### 4.4. Rejection Policies

When the pool is saturated (all workers busy, queue full), the rejection policy decides:

| Policy | Behavior | Use when |
| ------ | -------- | -------- |
| `AbortPolicy` (default) | Throws `RejectedExecutionException` | Fail fast; caller must handle it |
| `CallerRunsPolicy` | The task runs **in the caller's thread** | Natural backpressure: the producer slows down |
| `DiscardPolicy` | Silently drops the task | Never — silent data loss |
| `DiscardOldestPolicy` | Drops the oldest queued task | Only for stale/windowed work |

`CallerRunsPolicy` is the production favorite for backpressure: the submitting code itself has to execute the task, so it blocks, so the producer automatically slows down to the consumer's speed.

### 4.5. Worker Lifecycle and Pool Shutdown

Workers are created lazily (when tasks arrive), not upfront. When the pool is shut down:

```java
pool.shutdown();                    // stop accepting new tasks, finish queued ones
pool.shutdownNow();                 // interrupt running workers, return queued tasks

boolean done = pool.awaitTermination(30, TimeUnit.SECONDS);
if (!done) pool.shutdownNow();
```

A pool that is never shut down keeps its threads alive forever — and in a Spring/application-server context, that is intentional (the pool lives for the app's lifetime).

### 4.6. Backpressure

**Backpressure** is the principle that a fast producer must be forced to slow down when the consumer cannot keep up — instead of allowing tasks, memory, or connections to pile up without bound.

In the thread pool world, backpressure comes from three layers:

1. A **bounded queue** — the producer can only push so far ahead.
2. A **rejection policy** — what happens when the buffer is full (`CallerRunsPolicy` slows the producer; `AbortPolicy` fails the request).
3. **Circuit breakers at the API layer** — reject requests before they even reach the pool when the system is saturated.

A production example: a request handler submits work to a pool:

```java
@Service
public class RequestService {

    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(
            20, 40, 60, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(5_000),
            new ThreadPoolExecutor.CallerRunsPolicy());

    public void handle(Request request) {
        try {
            executor.execute(() -> process(request));
        } catch (RejectedExecutionException e) {
            throw new TooBusyException("system at capacity, try again later");
        }
    }
}
```

Queue full → `CallerRunsPolicy` runs the task in the request thread (producer slows down). If even the caller cannot run it, the exception is turned into a clean `503`-style failure instead of a silent pile-up.

## 5. Thread Performance: The Truth About Thread Count

The most expensive myth in Java concurrency is: *more threads = faster*.

### 5.1. The Core Bound for CPU-bound Work

A CPU-bound workload can only execute as many tasks simultaneously as there are cores. The optimal pool size is roughly **#cores** (sometimes `cores + 1` to cover the occasional page fault).

```
8 cores, CPU-bound, 200 threads:

Core 1-8: [working][working][working][working][working][working][working][working]
Other 192: --------------- context switching traffic jam ---------------
```

The 192 extra threads do nothing except burn CPU on context switches. **The application gets slower**, not faster, because switching overhead grows with the number of threads.

### 5.2. The Formula for I/O-bound Work

For I/O-bound workloads, the classic formula is:

```
optimal threads ≈ cores × (1 + wait_time / compute_time)
```

A task that spends 95 ms waiting for a database and 5 ms computing has `wait/compute = 19`, so a 8-core machine can usefully run ~160 threads. The waiting threads cost almost nothing — they are blocked, using no CPU.

### 5.3. What This Means in Practice

- Thread count must be derived from the **workload type** and the **available resources**, never from guesswork or "bigger is better".
- For CPU-bound: pool size ≈ number of cores. More threads = overhead.
- For I/O-bound: pool size ≈ cores × (1 + wait/compute). More concurrency = better latency/throughput, up to the limit of whatever resource tasks wait on.
- The resources tasks wait on (DB connections, HTTP clients, files) are also limited — the pool is not the only cap.

## 6. Common Concurrency Bugs and Mistakes

This section covers the bugs that pass code review and fail in production. Every bug has the same shape: an example, why it happens, the consequence, and the fix.

### 6.1. Race Conditions

```java
public class Counter {
    private int count;

    public void increment() {
        count++;                    // ❌ not atomic
    }
}
```

**Why it happens:** `count++` is three operations: read the field, add 1, write the field. Thread A can read `count = 5`, then thread B also reads `5`, both write `6` — one increment is lost.

**Consequence:** incorrect totals that appear only under load. The bug is a classic production-only bug: it needs a specific interleaving of two threads at the exact same instruction.

**Fix:**

```java
public class Counter {
    private final AtomicInteger count = new AtomicInteger();

    public void increment() {
        count.incrementAndGet();    // ✅ atomic read-modify-write
    }
}
```

### 6.2. Atomicity, Visibility, and Ordering

These are the three pillars of the Java Memory Model (JMM), and all Java concurrency bugs are a violation of one of them:

- **Atomicity**: an operation runs as an indivisible unit (no other thread sees it half-done). Broken by `count++`; fixed by `synchronized`, `Atomic*`, or locks.
- **Visibility**: a write by thread A may never be seen by thread B, because each thread can cache values in registers or CPU caches. Writes are not automatically flushed to main memory.
- **Ordering**: the JIT compiler and CPU may reorder instructions as long as single-thread semantics hold — which can produce behavior that looks impossible in a single-threaded world.

```java
public class VisibilityBug {
    private boolean running = true;     // ❌ no volatile

    public void stop() {
        running = false;
    }

    public void work() {
        while (running) {               // may loop forever — the write is never seen
            // ...
        }
    }
}
```

**Fix:** make the field `volatile`, or guard it with `synchronized` — both create a **happens-before** relationship that publishes the write to other threads.

### 6.3. synchronized

```java
public class Counter {
    private int count;

    public synchronized void increment() {
        count++;                        // ✅ atomic AND visible
    }
}
```

`synchronized` gives you mutual exclusion (atomicity) *and* memory visibility, by acquiring the intrinsic monitor. It is reentrant (the same thread can re-enter), and it blocks waiting threads. Its weaknesses: no timeout (a stuck lock holder blocks everyone forever), no fairness (default is non-fair), and a coarse granularity invites contention.

### 6.4. volatile and Why It Does NOT Make count++ Atomic

`volatile` guarantees **visibility and ordering** only. It guarantees that reads always see the latest write, and it prevents reordering. It does **not** provide atomicity:

```java
private volatile int count;

count++;        // ❌ STILL broken: read-modify-write is still three steps
```

`incrementAndGet()` on `AtomicInteger` is atomic because it uses hardware-level CAS (compare-and-swap) under the hood. `volatile` cannot do that. Rule of thumb: **`volatile` is for flags and status, `AtomicInteger`/`AtomicLong`/`AtomicReference` for counters and state objects.**

### 6.5. Locks

`ReentrantLock` is the programmatic sibling of `synchronized`, with more tools:

```java
ReentrantLock lock = new ReentrantLock();

lock.lock();
try {
    // critical section
} finally {
    lock.unlock();          // ✅ always in finally, or the lock is never released
}
```

What `synchronized` cannot do, `ReentrantLock` can:

```java
boolean acquired = lock.tryLock(2, TimeUnit.SECONDS);   // ✅ give up after 2s
// -> avoids waiting forever on a stuck holder

Lock readLock = rwLock.readLock();   // ✅ many readers / one writer
Lock writeLock = rwLock.writeLock();

Condition notEmpty = lock.newCondition();  // ✅ precise waiting: await()/signal()
```

`tryLock(timeout)` is your first defense against deadlocks and indefinite blocking.

### 6.6. Deadlocks

```java
// Thread 1                        // Thread 2
synchronized (lockA) {             synchronized (lockB) {
    synchronized (lockB) {             synchronized (lockA) {
        // ...                            // ...
    }                                }
}                                }
```

**Why it happens:** each thread holds a lock and waits for a lock the other thread holds. Circular wait: A→B→A.

**Consequence:** threads are stuck forever in `BLOCKED`. The whole system degrades silently — no error, no exception, just threads piling up in dumps and latency climbing until someone takes a thread dump.

**Fixes:**

1. **Lock ordering**: always acquire locks in the same global order (e.g., sort by ID), so the cycle cannot form.
2. **`tryLock(timeout)`**: don't wait forever; retry or fail with a timeout.
3. **One lock**: hold at most one lock at a time.
4. **Detect it**: take a thread dump — a deadlock shows up immediately as circular `BLOCKED`/`WAITING` states.

### 6.7. Thread Starvation

Starvation is when some threads *never* get to make progress while others do. Three common production forms:

1. **Lock starvation**: `synchronized` is non-fair by default — under constant contention, one thread may wait indefinitely while newer arrivals keep grabbing the lock.
2. **Task starvation**: a long task at the head of the pool queue delays every task behind it.
3. **Resource starvation**: some tasks hold connections/permits while waiting for others — in the extreme this becomes a deadlock.

**Mitigation:** fair locks (`new ReentrantLock(true)`) when latency distribution matters, timeouts everywhere, bounded tasks (chunk long jobs), and watching thread dumps for threads stuck in `WAITING`/`BLOCKED` for a long time.

### 6.8. Thread Pool Exhaustion

```java
// ❌ the classic production incident
ExecutorService pool = Executors.newFixedThreadPool(10);   // 10 threads
// a burst of slow DB calls queues up 50,000 tasks
// → every request waits 10,000% longer; queue grows; memory grows; OOM soon
```

**Why it happens:** producers submit tasks faster than the pool can drain them. With an unbounded queue the pool never rejects — it just degrades: queue grows → latency grows → requests pile up → OOM or total unresponsiveness.

**Fix:** bounded queue + rejection policy + monitoring of queue depth (alert when it grows), as shown in section 4.6.

### 6.9. Blocking Operations Inside Shared Thread Pools

The classic disaster: a shared pool for all services, and someone adds a task that does a slow synchronous HTTP call, a DB query, or a `Thread.sleep()`:

```java
// ❌ one slow task blocks a shared pool
executor.execute(() -> {
    String response = externalApi.call();   // 5 seconds of blocking
    // ... meanwhile the other 49 queued tasks wait
});
```

A pool of 10 threads where 8 are stuck on slow external calls leaves 2 threads to handle *everything* — including fast, latency-critical requests. **Consequence:** one slow dependency takes down unrelated functionality.

**Fix:** never mix workloads in one pool. Dedicated pools per workload class: one pool for DB work, one for HTTP calls, one for CPU-bound compute. Size each for its own wait/compute ratio.

### 6.10. Unbounded Queues

Covered above but worth its own callout: `new LinkedBlockingQueue<>()` without a size or `Executors.newCachedThreadPool()` (which uses a `SynchronousQueue` that *creates a thread for every task* — unbounded threads) are the two most common ways to convert a slow consumer into an OOM. Always bound your queues.

### 6.11. Missing Backpressure

Without backpressure, a fast producer (a Kafka consumer batch, a webhook flood) pours tasks into a pool without limit. The queue grows, latency explodes, and at some point the system falls over — and the producer is *still* producing. The fix is the three-layer defense from 4.6: bounded queue, rejection policy, circuit breaker. **Backpressure is not optional; it is the difference between degradation and collapse.**

### 6.12. ThreadLocal Leaks with Thread Pools

`ThreadLocal` stores a value per thread. With a plain thread, the value dies with the thread. With a **pool, threads are reused for years** — so a `ThreadLocal` that is never removed leaks memory, *and* the next task that reuses the thread sees **stale data**:

```java
// ❌ leaks: the thread keeps the user context forever
public void process(Request r) {
    ThreadLocal<SecurityContext> ctx = ThreadLocal.withInitial(SecurityContext::new);
    ctx.set(loadContext(r));
    // ... work ...
    // never removed → next task on this thread sees ANOTHER user's context!
}
```

**Fix:** always clean up in `finally`:

```java
ThreadLocal<SecurityContext> ctx = new ThreadLocal<>();

public void process(Request r) {
    try {
        ctx.set(loadContext(r));
        // ... work ...
    } finally {
        ctx.remove();       // ✅ prevents both the memory leak and the cross-request leak
    }
}
```

Security-sensitive variant: stale authentication context leaking between requests is a data leak, not just a memory leak.

### 6.13. Exceptions Silently Lost with ExecutorService

This is the most common invisible bug in Java concurrency:

```java
// ❌ the exception disappears
executor.submit(() -> {
    throw new RuntimeException("boom");
});
// nobody calls future.get() → the failure is swallowed silently
```

`submit()` captures the exception in the `Future` — it is never printed, never logged, never seen. The task "fails" and the system looks healthy. **This is why concurrency bugs only appear in production: the errors never surface anywhere.**

```java
// ✅ option 1: always handle the Future
Future<?> future = executor.submit(task);
try {
    future.get(10, TimeUnit.SECONDS);     // surfaces the exception (with timeout)
} catch (Exception e) {
    log.error("task failed", e);
}

// ✅ option 2: wrap the task with its own try/catch
executor.execute(() -> {
    try {
        doWork();
    } catch (Exception e) {
        log.error("task failed", e);      // never silently swallowed
    }
});
```

Note the difference: `execute()` routes exceptions to the thread's `UncaughtExceptionHandler`; `submit()` routes them into the `Future`. If you use `submit()` and ignore the `Future`, the error goes nowhere.

## 7. Platform Threads vs Virtual Threads

### 7.1. What Platform Threads Are

Everything before this section was about **platform threads**: the classic Java `Thread`, which wraps an OS thread 1:1. The JVM creates a native thread, the OS schedules it, and the Java stack lives on top of a native stack.

```
Platform thread model:

  Java thread ──1:1──▶ OS thread ──▶ core
        ▲
        │ ~1 MB stack, kernel-created, kernel-scheduled
        │ creation: milliseconds; count: thousands, not millions
```

The constraints are the OS's constraints: creation cost, stack memory, scheduler overhead. This is why 10,000 platform threads are a lot, and 100,000 are usually impossible.

### 7.2. What Virtual Threads Are

A **virtual thread** is a JVM-managed lightweight thread (Java 21, JEP 444). It is not an OS thread. It is a `Thread` object with its own stack and state, but it is *scheduled by the JVM* onto a small pool of platform threads called **carrier threads**.

```
Virtual thread model (many : few):

  100,000 virtual threads
        │   JVM scheduler
        ▼
   ( 8 carrier threads — platform threads — OS threads )
        │
        ▼
        CPU cores
```

The key mechanism: when a virtual thread **blocks** (DB call, HTTP call, `sleep()`), the JVM **unmounts** it from the carrier — saves its state, detaches it — and mounts another ready virtual thread onto the freed carrier. To the OS, nothing happened; the carrier never blocked.

```java
// virtual thread that blocks
Thread.startVirtualThread(() -> {
    String body = restClient.get(URI).getBody();   // blocks -> JVM parks the VT
    System.out.println(body);                      // resumes later on any carrier
});
```

### 7.3. How the JVM Parks an Unmounted Virtual Thread

Under the hood this is **continuations**: the execution state of the virtual thread (call stack, locals, program counter) can be frozen and resumed. A blocking call in virtual-thread-friendly code (socket I/O, `LockSupport.park`, `sleep`, queue operations) triggers a jump into the JVM scheduler: save the continuation, return control to the scheduler, pick the next runnable virtual thread. When the blocked operation completes (e.g., an I/O completion event), the continuation is made runnable again and re-mounted on a carrier.

The important caveat — **pinning**: if a virtual thread blocks while inside a `synchronized` block (or native code), it can *pin* the carrier thread, i.e., the carrier cannot be reused. The JVM keeps the platform thread alive and blocks it for real. JDK 21 limits pinning to specific cases (class initialization, native frames, `synchronized` inside native or foreign code); still, production guidance is: **avoid long blocking calls inside `synchronized` blocks when using virtual threads** — that is the modern equivalent of blocking a pool thread.

### 7.4. Practical Examples

```java
// ✅ 1. one-off virtual thread
Thread vt = Thread.startVirtualThread(() -> {
    // blocking I/O is fine — the JVM parks, not the OS
});

// ✅ 2. per-task executor: one virtual thread per task
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 10_000).forEach(i ->
        executor.submit(() -> fetchOrder(i))    // 10,000 blocking tasks
    );
}
// close() waits for all tasks to finish
```

Compare: 10,000 such tasks with platform threads would need 10,000 OS threads (~10 GB of stacks) or a hand-tuned pool with complex batching. With virtual threads, this is an ordinary program.

### 7.5. When Do They Help? Blocking I/O Workloads

Virtual threads shine exactly where the wait/compute ratio is high — the I/O-bound workloads from section 5.2:

- **HTTP calls**: a service fanning out to many external APIs.
- **Database calls**: JDBC calls block on the socket; each blocked virtual thread costs ~nothing.
- **File I/O**: reads/writes on network filesystems.
- **Many concurrent blocking tasks**: web servers (Tomcat with `maxThreads` configured to a virtual thread executor), batch jobs calling many services in parallel.

```java
// 100,000 blocking HTTP calls, sequential-looking code:
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = urls.stream()
            .map(url -> executor.submit(() -> httpClient.get(url)))
            .toList();
    for (var f : futures) f.get();              // wait for all
}
```

One virtual thread per task means no shared pool sizing, no queue tuning, no backpressure knobs at the thread layer — the JVM handles the bookkeeping. This is the real win of Virtual Threads: **you write blocking code, and the scaling story disappears.**

## 8. When Virtual Threads Do NOT Help

This is the section most articles skip, and the one that prevents production incidents.

### 8.1. They Do Not Make CPU-bound Tasks Faster

A virtual thread still needs a CPU to run on. CPU-bound work (JSON parsing, crypto, compression, image processing) is limited by cores — the exact same bound as platform threads. Running a CPU-bound task on virtual threads changes nothing except adding scheduler overhead:

```java
// ❌ 100,000 virtual threads parsing JSON will NOT be 100,000x faster
// it will be exactly as fast as cores allow — with extra switching overhead
```

**Rule: CPU-bound → use cores; I/O-bound → use virtual threads.**

### 8.2. They Do Not Create More CPU Cores

Virtual threads do not multiply hardware. If the machine has 8 cores, at most 8 virtual threads compute at any instant — same as before.

### 8.3. They Do Not Solve Race Conditions

```java
// ❌ still broken on virtual threads
public void increment() {
    count++;    // three instructions, still racy on virtual threads
}
```

Virtual threads interleave exactly like platform threads. Shared mutable state, unsynchronized access, and lost updates all remain bugs. **Thread-safety is a property of your code, not of the threading model.**

### 8.4. They Do Not Remove Resource Limits

This is the critical insight, stated plainly:

> **Virtual Threads remove the cost of waiting threads — not the cost of the resources they are waiting for.**

Consider 100,000 virtual threads each doing a database query. The JDBC pool has 20 connections:

```
100,000 virtual threads
        │  each one wants a DB connection
        ▼
   DB connection pool (20 connections)
        ▼
        database (can take ~20 queries at once)
```

Before Virtual Threads: "we only have 100 threads, so at most 100 queries wait." False comfort — the pool was already the bottleneck, threads just hid it.

After Virtual Threads: 100,000 threads wait on a semaphore inside the connection pool. **The database still receives exactly 20 concurrent queries.** Latency, throughput, and database load are byte-for-byte the same. What changed? The 100,000 waiters now cost almost no memory or CPU — which is good — but the *bottleneck* (the 20 connections) is untouched. If you now flood it with requests, the pool still blocks, queueing now happens at a different layer, and the 20 connections can still become a hot resource.

The same logic applies to everything tasks wait on:

- Database connection pools (HikariCP `maximumPoolSize`).
- HTTP client connection pools (keep-alive connections).
- External API rate limits and quotas.
- File handles, Kafka partitions, locks.

### 8.5. They Do Not Remove the Need for Backpressure

Unbounded virtual thread creation is as dangerous as unbounded task submission: 10 million waiting virtual threads do not crash the JVM, but the resources they pile onto (DB pool, external API, disk) still saturate, and the queueing just moves into those resources. You still need bounded queues, semaphores, and rejection at the API layer — Virtual Threads only make waiting cheap, not infinite.

## 9. Common Mistakes When Using Virtual Threads

### 9.1. Unlimited Concurrency

```java
// ❌ every request spawns a virtual thread, no cap anywhere
Executors.newVirtualThreadPerTaskExecutor();
// 50k concurrent requests -> 50k concurrent DB calls -> pool saturation -> timeouts
```

Because virtual threads are cheap, teams stop thinking about limits. But the resources they wait on are still limited. **Cap the concurrent work with a `Semaphore` (or an `Executor` with bounded virtual threads):**

```java
// ✅ limit concurrency to what the DB pool can actually serve
Semaphore dbSlots = new Semaphore(20);                 // HikariCP maximumPoolSize = 20

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request r : requests) {
        executor.submit(() -> {
            try {
                dbSlots.acquire();
                orderRepository.save(r);               // only 20 at a time hit the DB
            } finally {
                dbSlots.release();
            }
        });
    }
}
```

### 9.2. CPU-heavy Workloads on Virtual Threads

Virtual threads do not speed up computation; they add scheduling overhead to it. Use a classic fixed pool sized to cores for CPU-bound work.

### 9.3. Shared Mutable State

```java
// ❌ "virtual threads" are not thread-safe by magic
static int totalRequests;          // racy, exactly as with platform threads
```

### 9.4. Forgetting Resource Limits

20 DB connections, a 30 RPS API quota, a 10-file FD limit — none of these change with virtual threads. Size the semaphores and pools to the *downstream* limits, not to how many threads you *can* create.

### 9.5. Assuming Virtual Threads Make the Application Thread-safe

They do not. All of section 6 applies unchanged. The lifecycle and visibility semantics are identical to platform threads.

### 9.6. Assuming Virtual Threads Eliminate Concurrency Limits

They eliminate *thread count* as the limiting factor. They do not eliminate: connection pools, API quotas, CPU cores, memory of the heap, and — importantly — they keep `synchronized` pinning caveats. The discipline (bounded concurrency, timeouts, backpressure) stays.

## 10. Practical Decision Guide

| Need | Tool | Why / when |
| ---- | ---- | ---------- |
| One-off background task, test, script | Raw `Thread` | Simple, ephemeral; never in production request paths |
| General task execution with lifecycle control | `ExecutorService` | submit/await/shutdown, reuse of workers |
| CPU-bound workload | Fixed pool ≈ `#cores` | More threads only add switching overhead |
| I/O-bound workload, moderate concurrency | Fixed/bounded pool, sized by wait/compute | Classic, well-understood; bounded queue mandatory |
| Massive blocking concurrency (HTTP fan-out, many DB calls) | Virtual Threads (`newVirtualThreadPerTaskExecutor`) | Cheap blocked threads; simple blocking code; no pool tuning |
| Counters, flags, simple state | `AtomicInteger` / `AtomicLong` / `AtomicReference`, `volatile` | Atomicity (counters) or visibility (flags) |
| Complex critical sections, multi-conditional waits | `synchronized` / `ReentrantLock` / `Condition` | Mutual exclusion; prefer `tryLock(timeout)` for safety |
| Limit concurrency to a scarce resource (DB pool, API quota) | `Semaphore` | Backpressure at the resource layer — works with virtual threads too |
| Rate limiting / circuit breaking | `RateLimiter`, `Resilience4j`, `Bucket4j` | Reject upstream before internal saturation |
| Big CPU-parallel computation | Parallel streams, `ForkJoinPool`, `CompletableFuture` with custom pool | Explicit parallelism, sized to cores |

## 11. Production Debugging: Investigating Thread Problems

When something is slow or stuck, the first step is always the same: **take a thread dump and look at the states.**

### 11.1. Thread Dumps

```bash
jcmd <pid> Thread.print            # or: jstack <pid>  or: kill -3 <pid>
```

What to look for:

- Many threads in `BLOCKED` → synchronized contention; find the monitor in the stack trace, find who holds it.
- Threads in `WAITING`/`TIMED_WAITING` on `park` → waiting on `CompletableFuture`, pool queues, or pool threads idle.
- A **deadlock**: `jstack` prints a `Found one Java-level deadlock` section with the cycle.
- All pool threads busy on the same slow call → that dependency is the bottleneck.

### 11.2. JVM Monitoring and Metrics

- **CPU utilization**: `top`/`htop` per-thread (`top -H`), plus `jstat`. 100% on all cores with many RUNNABLE threads → CPU-bound saturation; low CPU with long latency → blocked waiting on something.
- **JFR** (`jfr start --filename app.jfr`, `jfr view`): thread allocations, lock contention (`jdk.JavaMonitorEnter`), CPU sampling, without restarting the app.
- **Micrometer/JMX** for `ThreadPoolExecutor`:
  - `executor_active_threads`, `executor_pool_size`, `executor_queue_size` — the queue growth is the earliest warning of pool exhaustion.
  - `executor_completed_task_count` — flat line means work is stuck.
- **HikariCP metrics**: `hikaricp_connections_pending` (waiters), `hikaricp_connections_active`, `hikaricp_connections_timeout_total` — connection starvation shows up here *before* request latency explodes.

### 11.3. The Investigation Loop

```
1. Latency spike?            → check request latency percentiles (p95/p99)
2. CPU saturated?            → no: waiting on something (dumps, DB metrics)
                              → yes: CPU-bound bottleneck (profiler, cores)
3. Thread states in dumps:
   - BLOCKED piles           → lock contention (find the monitor)
   - WAITING piles           → queue/pool exhaustion (queue size metric)
   - all busy on same call   → one slow dependency (add timeouts/circuit breaker)
4. DB pool: pending > 0?     → connection starvation (size up, optimize queries, or limit concurrency)
5. Queue size growing?       → producers outrunning consumers (backpressure!)
```

The signals always triangulate: latency + thread states + pool metrics + DB metrics. Never tune blindly — the thread dump tells you *where* the system is stuck; the metrics tell you *how long* it has been stuck.

## 12. Final Mental Model

After all the mechanics, five sentences capture the whole article:

1. **A thread does not automatically make code faster.** It only gives work a chance to run in parallel — and if the machine cannot run it in parallel, the thread is pure overhead.
2. **Concurrency is not parallelism.** Concurrency is structure (interleaving); parallelism is execution (simultaneous cores). Threads give you concurrency; only hardware gives you parallelism.
3. **More threads do not mean more CPU power.** CPU-bound work is bounded by cores. Threads beyond that bound buy you context switches.
4. **Virtual Threads improve scalability for blocking concurrency, not CPU performance.** They make waiting cheap. They do not make computing fast, and they do not change the limits of the resources everyone is waiting for.
5. **The difficult part of multithreading is managing shared state, resource limits, backpressure, lifecycle, and failures.** The threading API is easy. The discipline — visibility of shared state, bounded everything, explicit error handling, monitoring — is what separates applications that scale from applications that fail at 4 AM.

When in doubt, ask the question this whole article is built on: *what is this work actually waiting for?* The answer tells you which tool to use, how many threads you need, and what will break first.
