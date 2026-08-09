---
title: "Java Threads: From Thread Pools to Virtual Threads"
description: "A hands-on guide to Java concurrency with 31 runnable examples: threads, race conditions, thread pools, backpressure, common production failures, and what Virtual Threads really can and cannot do."
pubDatetime: 2026-08-09T00:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Every Java backend developer eventually asks the same four questions:

- Why can adding more threads make an application **slower**?
- Why does a thread pool with hundreds of threads not improve CPU utilization?
- Why can Virtual Threads handle massive concurrency but not make CPU-bound code faster?
- Why do concurrency bugs almost always **only appear in production**?

This article answers all four — and unlike most articles on the topic, every
claim here is backed by a real, runnable example. The article is designed to be
read next to the companion repository [`java-lab`](https://github.com/hungpt99-dev/java-lab),
a plain Maven project with **31 small, independent examples**, zero frameworks,
and pure JDK concurrency APIs. Each section below maps a concept to an actual class in that repository,
shows the real code, and tells you exactly what to run and what to observe.

All examples compile with Java 21+ (`maven.compiler.release` is set to `21` in
the `pom.xml`; Virtual Threads require Java 21). Every measurement quoted in
this article was produced by running the examples on a 12-core machine with
JDK 21 — treat them as sample data, not universal benchmark results.

---

## 1. Introduction

If you have ever operated a Java backend, you know the warning signs by heart:
a burst of slow database calls, a thread dump full of `BLOCKED` threads, a
queue that grows without bound, latency that climbs while CPU idles. All of
these come from a small set of mechanical facts:

- A thread is expensive: ~1 MB of stack, kernel-created, kernel-scheduled.
- A thread can execute on only one core at a time — and a machine has a fixed
  number of cores.
- Shared memory is fast *because* it is shared — which is exactly why it
  corrupts under unsynchronized access.
- Blocked threads cost no CPU, but the resources they wait on (connections,
  quotas, sockets) are still finite.

This article walks through those facts mechanically, in the same order the
`java-lab` repository teaches them: what a thread is (Section 2), how to
create one (Section 3), its lifecycle (Section 4), why shared state breaks
(Sections 5–6), how thread pools really work (Section 7), what thread count
buys you (Section 8), the failure modes that bite in production (Section 9),
and finally what Virtual Threads change — and, just as important, what they do
not (Sections 10–13). Sections 14–16 give you the debugging loop, a decision
guide, and the mental model to take away.

**How to read this article:** every concept names its repository class; run it
with the commands in the "Try It Yourself" boxes and compare your observation
with the recorded outputs shown here.

---

## 2. What Is a Thread?

### 2.1. Process vs Thread

A **process** is a running program with its own memory space, its own file
descriptors, its own address space. A **thread** is a unit of execution
*inside* a process. Threads of the same process share the process memory
(heap, static fields, class metadata), which is why they can communicate
trivially — and also why they corrupt each other's state so easily.

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

Each thread has its **own stack** but **shares** the heap. That split explains
almost everything about multithreading: sharing is what makes it useful, and
sharing is what makes it dangerous.

### 2.2. Concurrency vs Parallelism

- **Concurrency** is about *structure*: multiple tasks making progress in
  overlapping time periods, interleaved on the same CPU.
- **Parallelism** is about *execution*: multiple tasks running at the exact
  same instant, on different CPU cores.

```
Concurrency (interleaved on 1 core):
  Thread A:  |--A1--|        |--A2--|        |--A3--|
  Thread B:        |--B1--|        |--B2--|        |--B3--|

Parallelism (simultaneous on 2 cores):
  Core 1:    |------A1------|------A2------|
  Core 2:    |------B1------|------B2------|
```

Concurrency does not require multiple cores. Parallelism requires them. If your
machine has 4 cores and you create 1000 threads, at most **4 tasks run at the
same instant** — the other 996 are waiting, sleeping, or being context-switched.
Creating threads does not create cores.

### 2.3. CPU-bound vs I/O-bound Workloads

The single most important question about any task: *what is it waiting for?*

- **CPU-bound**: the task spends its time computing — parsing, hashing, crypto,
  compression. Speed is limited by CPU cores, not by thread count.
- **I/O-bound**: the task spends most of its time *waiting* — for a database,
  an HTTP response, a file read. Speed is limited by latency and concurrency.

```
CPU-bound task:   [=====compute=====][=====compute=====][=====compute=====]
                  ↑ CPU is the bottleneck → only #cores matters

I/O-bound task:   [wait 95ms][wait 95ms][wait 95ms]
                  [ 5ms work ][ 5ms work ][ 5ms work ]
                  ↑ 95% of time is waiting → more concurrency helps
```

This distinction is the backbone of the whole article — the repository has
dedicated experiments for both workload types (Section 8).

### 2.4. Context Switching

When the CPU switches from one thread to another, the OS must save the whole
state of the current thread and load the state of the next one. This is a
**context switch**, and it is not free: it costs CPU time, it destroys CPU
caches (the new thread's data is "cold"), and the more threads you have, the
more of the CPU's time goes to *switching* instead of *working*. This is the
direct answer to the first question: **adding more threads than the machine can
run simultaneously does not add work capacity — it adds switching overhead.**

### 2.5. Blocking

A thread **blocks** when it cannot continue without an external event (a lock,
a `sleep()`, a DB query, an HTTP response). A blocked thread consumes **zero**
CPU but still holds its memory and still counts as a thread for the OS
scheduler. The whole game of thread pools — and later of Virtual Threads — is
about having enough runnable work to keep the CPU busy while most threads are
blocked.

---

## 3. Creating and Running Threads

The repository's `basics` package contains four examples. Let's look at what
they actually demonstrate.

### Example: Creating a Thread

**Repository example:** `src/main/java/com/example/javalab/basics/CreateThreadExample.java`

This example shows the three ways to create a thread — an anonymous `Runnable`,
a lambda `Runnable`, and a `Thread` subclass — all started with `start()` and
joined with `join()`:

```java
Thread t1 = new Thread(new Runnable() {
    @Override
    public void run() {
        System.out.println("[" + Thread.currentThread().getName() + "] anonymous Runnable");
    }
}, "thread-1");

Thread t2 = new Thread(
        () -> System.out.println("[" + Thread.currentThread().getName() + "] lambda Runnable"),
        "thread-2");

Thread t3 = new MyWorkerThread("thread-3");

t1.start();
t2.start();
t3.start();

t1.join();
t2.join();
t3.join();
```

**What to observe:** the three lines print from three different thread names in
a *different order on every run*. That nondeterministic order *is* concurrency.

### Example: Runnable vs Callable

**Repository example:** `src/main/java/com/example/javalab/basics/RunnableExample.java`

`Runnable` has `void run()` — no result, no checked exceptions. `Callable` has
`V call()` — it returns a value and may throw. The example runs a `Callable`
through an `ExecutorService` and retrieves the result via `Future.get()`:

```java
Callable<Integer> callable = () -> {
    Thread.sleep(100);
    return 42;                           // Callable produces a value
};

ExecutorService pool = Executors.newSingleThreadExecutor();
try {
    Future<Integer> future = pool.submit(callable);
    System.out.println("Callable result: " + future.get());   // blocks until ready
} finally {
    pool.shutdown();                     // ALWAYS shut down executors
}
```

### Example: start() vs run()

**Repository example:** `src/main/java/com/example/javalab/basics/StartVsRunExample.java`

The most important beginner distinction in Java concurrency:

```java
Runnable task = () -> System.out.println("  task executed in thread: "
        + Thread.currentThread().getName());

Thread t = new Thread(task, "new-thread");

t.run();    // runs in the CALLER thread (here: 'main')
t.start();  // runs in a NEW thread (here: 'new-thread')
```

**Actual output of the example:**

```
1) t.run()   -> runs in the CALLER thread:
  task executed in thread: main
2) t.start() -> runs in a NEW thread:
  task executed in thread: new-thread
```

`run()` is just an ordinary method call — calling it gives you zero
concurrency, and the bug is invisible because the code still produces correct
results. `start()` asks the JVM to create a real new thread.

> **Also covered by these examples:** `join()` (waiting for a thread to finish)
> and `sleep()` (used throughout as simulated work). Thread names make logs
> readable — every pool example in the repository names its threads with a
> custom `ThreadFactory`.

## Try It Yourself

```bash
cd java-lab
mvn clean compile
java -cp target/classes com.example.javalab.basics.StartVsRunExample
java -cp target/classes com.example.javalab.basics.CreateThreadExample
java -cp target/classes com.example.javalab.basics.RunnableExample
```

Expected observation: `run()` always prints the caller's thread name (`main`);
`start()` prints the new thread's name; the three threads in
`CreateThreadExample` print in a different order each run.

---

## 4. Thread Lifecycle

**Repository example:** `src/main/java/com/example/javalab/basics/ThreadLifecycleExample.java`

This example walks a single thread through all six states and samples
`thread.getState()` from the main thread at each point:

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

The code manufactures each state on demand: a second thread blocks on a
`synchronized` monitor held by `main` (→ `BLOCKED`), the worker calls
`LOCK.wait(300)` (→ `TIMED_WAITING`) then `LOCK.wait()` (→ `WAITING`), and
finally `join()` reveals `TERMINATED`. Because exact timing is nondeterministic,
the example *polls* until each expected state appears (with a timeout) instead
of relying on sleeps.

**Actual output (abridged):**

```
1) NEW         state = NEW
2) RUNNABLE    state = RUNNABLE  (running or ready - Java does not distinguish)
3) BLOCKED     state = BLOCKED  (waiting for synchronized monitor held by main)
4) TIMED_WAITING state = TIMED_WAITING  (LOCK.wait(300) / Thread.sleep)
5) WAITING     state = WAITING  (LOCK.wait() - parked until notify)
6) TERMINATED  state = TERMINATED
```

**Where you see these states in production:** a `jstack`/`jcmd Thread.print`
dump full of `BLOCKED` threads means synchronized lock contention; piles of
`WAITING`/`TIMED_WAITING` on `park` mean pool queues or futures; floods of
`RUNNABLE` mean CPU saturation.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.basics.ThreadLifecycleExample
```

Expected observation: all six states printed in order. Note that the exact
`RUNNABLE` sample point varies per run — the state machine itself is fixed,
the *timing* is not.

---

## 5. Race Conditions and Shared State

**Repository example:** `src/main/java/com/example/javalab/synchronization/RaceConditionExample.java`

The repository starts with a deliberately broken counter:

```java
public class RaceConditionExample {

    private int count;                    // shared mutable state, NO synchronization

    public void increment() {
        count++;                          // read-modify-write: NOT atomic
    }
    // ...
}
```

Eight threads call `increment()` 50,000 times each — the expected result is
400,000. The example runs five trials and prints the actual results.

**Actual output of the example:**

```
Trial 1: expected=400000 actual=84596 (<-- WRONG: increments lost)
Trial 2: expected=400000 actual=136178 (<-- WRONG: increments lost)
Trial 3: expected=400000 actual=98973 (<-- WRONG: increments lost)
Trial 4: expected=400000 actual=60526 (<-- WRONG: increments lost)
Trial 5: expected=400000 actual=400000 (correct this time)
```

**Why the result can be incorrect:** `count++` is three operations — READ the
field, ADD 1, WRITE it back. Two threads can both READ `5`, both compute `6`,
and both WRITE `6` — one increment is lost.

**Why it is nondeterministic:** whether the interleaving collides depends on
scheduling, JIT state, and machine load. Trial 5 happened to be correct —
which is exactly why these bugs pass code review and explode in production.
The code compiles, runs, and *sometimes* produces the right answer.

This is a violation of the three pillars of the Java Memory Model (JMM):

- **Atomicity**: an operation runs as an indivisible unit. Broken by
  `count++`; fixed by `synchronized`, `Atomic*`, locks.
- **Visibility**: a write by thread A may never be seen by thread B (values
  can be cached in registers/CPU caches).
- **Ordering**: the JIT and CPU may reorder instructions as long as
  single-thread semantics hold.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.synchronization.RaceConditionExample
```

Expected observation: most trials show an actual count far below 400,000; an
occasional trial is correct. Never trust a single run.

---

## 6. Synchronization Strategies

The `synchronization` package contains the four fixes plus the `volatile`
truth-teller.

### Example: synchronized

**Repository example:** `src/main/java/com/example/javalab/synchronization/SynchronizedExample.java`

```java
public class SynchronizedExample {

    private int count;

    public synchronized void increment() {
        count++;
    }
}
```

The `synchronized` monitor makes the read-modify-write one indivisible unit and
also publishes the write (happens-before). The same 8×50,000 workload is now
always correct: all three trials print `actual=400000 (correct)`. The cost:
contending threads **block**, and heavy contention on one monitor turns the
code effectively single-threaded. `synchronized` is reentrant, non-fair by
default, and cannot time out.

### Example: AtomicInteger

**Repository example:** `src/main/java/com/example/javalab/synchronization/AtomicIntegerExample.java`

```java
public class AtomicIntegerExample {

    private final AtomicInteger count = new AtomicInteger();

    public void increment() {
        count.incrementAndGet();
    }
}
```

`AtomicInteger` is correct *and* non-blocking: it uses hardware-level CAS
(compare-and-swap), retrying the update if another thread changed the value in
between. The example also prints the other useful operations
(`get()`, `getAndIncrement()`, `addAndGet(n)`, `compareAndSet(exp, upd)`).

### Example: ReentrantLock

**Repository example:** `src/main/java/com/example/javalab/synchronization/LockExample.java`

`ReentrantLock` adds what `synchronized` cannot do — timeouts, fairness,
conditions. The example demonstrates a lock-protected counter (always correct)
and the key trick, `tryLock(timeout)`:

```java
boolean acquired = held.tryLock(1, TimeUnit.SECONDS);
// thread B holds the lock for 3 s: main gives up after 1 s instead of blocking
```

**Actual output:** `tryLock = false (main did NOT wait for the holder - it moved on)`.
With `synchronized`, the same situation would block until the holder releases.
`tryLock(timeout)` is the first defense against deadlocks.

### Example: volatile — visibility, NOT atomicity

**Repository example:** `src/main/java/com/example/javalab/synchronization/VolatileExample.java`

This example makes two points with hard numbers.

**Part A — `volatile int count; count++` is still NOT atomic:**

```java
private volatile int count;     // volatile: visible, but STILL not atomic

public void increment() {
    count++;                    // still READ+ADD+WRITE: racy despite volatile
}
```

**Actual output:**

```
Part A - volatile int count++; does it stay atomic?

expected=400000 actual=191212 (<-- WRONG)
```

`volatile` guarantees visibility and ordering only. The three-step
read-modify-write can still interleave between threads. **Do not believe that
`volatile` makes increments thread-safe — it does not.**

**Part B — a non-volatile flag may never be seen.** A worker loops on a plain
`boolean keepRunning` while `main` sets it to `false` after 200 ms. The JIT can
hoist the field out of the loop, so the write is never observed. This part is
deliberately nondeterministic — in the recorded run it reproduced 0 out of 3
trials, while the escape hatch (a `volatile boolean forceStop`) stopped the
worker immediately every time. The example always terminates, and its printed
takeaway is the rule of thumb:

> `volatile` for flags and status; `AtomicInteger`/`AtomicLong` for counters
> and shared state; `synchronized`/locks for complex critical sections.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.synchronization.RaceConditionExample
java -cp target/classes com.example.javalab.synchronization.SynchronizedExample
java -cp target/classes com.example.javalab.synchronization.AtomicIntegerExample
java -cp target/classes com.example.javalab.synchronization.LockExample
java -cp target/classes com.example.javalab.synchronization.VolatileExample
```

Expected observation: the broken counter loses increments; all three fixes are
always correct; `VolatileExample` Part A loses increments even on a `volatile`
field, and Part B's visibility bug may or may not reproduce in your runs.

---

## 7. Thread Pools and Task Execution

The `threadpool` package is the heart of the article — it shows how
`ThreadPoolExecutor` *really* works, not just the `Executors` shortcuts.

### Example: Fixed Thread Pool

**Repository example:** `src/main/java/com/example/javalab/threadpool/FixedThreadPoolExample.java`

`Executors.newFixedThreadPool(3)` with a named `ThreadFactory` runs 10 tasks.
The example's printed "inside the box" section states the crucial fact:

```
newFixedThreadPool(3) == ThreadPoolExecutor(3, 3, 0L,
    TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>())
Because the queue is UNBOUNDED, the pool can never grow
beyond 3 threads and can never reject a task - tasks just
pile up in memory.
```

**Actual output:** tasks 1–10 all run on `fixed-worker-1..3` — workers are
reused. A "fixed" pool is fixed precisely because its unbounded queue never
forces the pool to grow.

### Example: ThreadPoolExecutor — the full pipeline

**Repository example:** `src/main/java/com/example/javalab/threadpool/ThreadPoolExecutorExample.java`

This example configures every knob — core=2, max=4, bounded queue of capacity
2, `AbortPolicy` — and logs `poolSize`/`queueSize` after every submit:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        2,                                    // corePoolSize
        4,                                    // maximumPoolSize
        30, TimeUnit.SECONDS,                 // keepAliveTime
        new ArrayBlockingQueue<>(2),          // BOUNDED work queue
        runnable -> new Thread(runnable, "pool-thread-" + threadCounter.getAndIncrement()),
        new ThreadPoolExecutor.AbortPolicy());
```

The task-acceptance algorithm it demonstrates:

```
Task
 ↓
1. core threads free?       -> run on a core thread
2. no, queue not full?      -> enqueue
3. no, workers < max?       -> spawn an extra thread (up to max)
4. no                        -> rejection policy
```

**Actual output (the demonstration in action):**

```
submitted 1 -> poolSize=1 queueSize=0
submitted 2 -> poolSize=2 queueSize=0
submitted 3 -> poolSize=2 queueSize=1
submitted 4 -> poolSize=2 queueSize=2
submitted 5 -> poolSize=3 queueSize=2
submitted 6 -> poolSize=4 queueSize=2
submitted 7 -> REJECTED (pool full, queue full): RejectedExecutionException
submitted 8 -> REJECTED (pool full, queue full): RejectedExecutionException
submitted 9 -> REJECTED (pool full, queue full): RejectedExecutionException
```

Observe the order: tasks 1–2 hit the core threads; tasks 3–4 go into the queue;
the pool only grows past core size **after** the queue is full (tasks 5–6);
once the queue is full *and* max is reached, `AbortPolicy` throws.

### Example: Bounded vs Unbounded Queue

**Repository example:** `src/main/java/com/example/javalab/threadpool/BoundedQueueExample.java`

Two pools with identical core=2/max=4 settings and 6 sleeping tasks — the only
difference is the queue type. **Actual output:**

```
A) UNBOUNDED queue (LinkedBlockingQueue) - what newFixedThreadPool uses
   -> poolSize=2 queueSize=4 (max=4 was NEVER reached!)

B) BOUNDED queue (ArrayBlockingQueue capacity=2)
   -> poolSize=4 queueSize=2 (pool grew to 4)
```

With an unbounded queue, `maximumPoolSize` is dead configuration — the queue
*is* the real limit, and tasks pile up in memory forever. A bounded queue
forces the pool to engage extra threads, then the rejection policy.

### Example: Rejection Policies

**Repository example:** `src/main/java/com/example/javalab/threadpool/RejectedExecutionExample.java`

With core=1, max=2, queue capacity=1, four submissions fit exactly three tasks;
the fourth exercises the rejection path. The example runs the same sequence
with `AbortPolicy` and `CallerRunsPolicy`:

**Actual output:**

```
1) AbortPolicy (default):
   -> submit 4: REJECTED: RejectedExecutionException
   tasks actually executed: 2

2) CallerRunsPolicy:
   -> submit 4: accepted
   tasks actually executed: 4
```

| Policy | Behavior | Use when |
| ------ | -------- | -------- |
| `AbortPolicy` (default) | Throws `RejectedExecutionException` | Fail fast; caller handles it |
| `CallerRunsPolicy` | Task runs **in the caller's thread** | Natural backpressure: producer slows down |
| `DiscardPolicy` | Silently drops the task | Never — silent data loss |
| `DiscardOldestPolicy` | Drops the oldest queued task | Only for stale/windowed work |

`CallerRunsPolicy` is the production favorite for backpressure: the submitting
thread itself has to execute the task, so the producer automatically slows
down to the consumer's speed.

### Example: Thread Pool Exhaustion

**Repository example:** `src/main/java/com/example/javalab/threadpool/ThreadPoolExhaustionExample.java`

A pool of 2 threads receives 6 tasks that block on a `CountDownLatch` — the
simulated downstream outage. Both workers get stuck. Then a "fast" task
arrives and must wait in the queue:

**Actual output (abridged):**

```
Both workers are now blocked on the slow downstream.
A FAST task arrives (an unrelated quick request)...
  200ms later: fast task has NOT started yet -> it sits in the queue
  ...
Total wait for the fast task: ~211 ms (it should have been < 1 ms).
```

**Why all workers become unavailable:** every worker blocks inside the task on
the latch. The fast task cannot start because both workers are occupied and the
(unbounded) queue just absorbs tasks — memory grows, latency climbs, and **no
exception is ever thrown**. Production fixes: bounded queue + rejection policy,
separate pools per workload, timeouts and circuit breakers on the downstream,
and monitoring of `executor_queue_size`.

### Example: Graceful Shutdown

**Repository example:** `src/main/java/com/example/javalab/practical/GracefulShutdownExample.java`

The correct way to stop a pool, demonstrated with 8 tasks × 2 s on 3 threads
and an 800 ms deadline:

```java
pool.shutdown();                 // 1) stop accepting new tasks
boolean finished = pool.awaitTermination(800, TimeUnit.MILLISECONDS);  // 2) deadline
if (!finished) {
    List<Runnable> dropped = pool.shutdownNow();   // 3) interrupt + drop queue
    System.out.println("dropped " + dropped.size() + " queued task(s).");
}
pool.awaitTermination(5, TimeUnit.SECONDS);        // 4) wait for cleanup
```

**Actual output:** `shutdownNow()` dropped 5 queued tasks and interrupted 3
running workers (`started=3 interrupted=3`). Well-behaved tasks catch
`InterruptedException` and clean up before exiting.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.threadpool.FixedThreadPoolExample
java -cp target/classes com.example.javalab.threadpool.ThreadPoolExecutorExample
java -cp target/classes com.example.javalab.threadpool.BoundedQueueExample
java -cp target/classes com.example.javalab.threadpool.RejectedExecutionExample
java -cp target/classes com.example.javalab.threadpool.ThreadPoolExhaustionExample
java -cp target/classes com.example.javalab.practical.GracefulShutdownExample
```

Expected observations: submissions 7–9 are rejected in
`ThreadPoolExecutorExample` (that is deterministic — the workers are still
busy); the unbounded queue never grows the pool; the "fast" task in
`ThreadPoolExhaustionExample` always waits; `GracefulShutdownExample` prints
the same 3/3/5 split.

---

## 8. Performance: More Threads ≠ Faster

The `performance` package turns the article's thesis into experiments. All
three use a fixed amount of total work and vary only the thread count.
**Results are machine-specific — watch the trend, not the numbers.**

### CPU-bound Workloads

**Repository example:** `src/main/java/com/example/javalab/performance/CpuBoundThreadExample.java`

32 tasks, each counting primes up to 150,000 with the naive O(n·√n) method —
deterministic CPU work. **Actual output on a 12-core machine:**

```
threads                tasks      wall time    note
-------                -----      ---------    ----
1                      32         262          baseline
12                     32         49           up to cores: helps
48                     32         52           beyond cores
192                    32         49           excessive
```

**Why CPU cores limit true parallel execution:** only 12 tasks can compute at
once on 12 cores. Going from 1 → 12 threads gives a near-linear speedup (262 →
49 ms); beyond that the gains flatten out (49 → 52 → 49 ms), and with enough
threads context-switching overhead can push the time back up. **Excessive
threads cause context-switching overhead, not more CPU power.**

### I/O-bound Workloads

**Repository example:** `src/main/java/com/example/javalab/performance/IoBoundThreadExample.java`

Each task simulates a 40 ms remote call (`LockSupport.parkNanos` — no external
network dependency) plus 1 ms of compute. 120 tasks total. **Actual output:**

```
threads    tasks      wall time    throughput
-------    -----      ---------    ----------
1          120        5991         20
12         120        503          239
96         120        101          1188
120        120        67           1791
```

**Why waiting tasks benefit from higher concurrency:** a blocked thread costs
no CPU, so while one task waits, others run. Throughput scales with concurrency
— 20 → 1791 tasks/sec in this run. The classic sizing formula the example
prints: `threads ≈ cores × (1 + wait/compute)`. And the honest caveat it
states: beyond saturation, more threads add overhead — and in real systems the
limit is whatever the tasks wait on (DB connections, API quotas), not the
thread count. **This does not mean unlimited concurrency is always good.**

### Too Many Threads

**Repository example:** `src/main/java/com/example/javalab/performance/TooManyThreadsExample.java`

The same 400 mixed tasks (~10 ms each) run with 4, 64, 400 and 800 threads.
The workload size and thread counts are configurable:

```bash
java -cp target/classes com.example.javalab.performance.TooManyThreadsExample 400 4 64 400 800
```

**Actual output:**

```
threads      tasks      wall time (ms)
-------      -----      --------------
4            400        1089
64           400        167
400          400        212
800          400        205
```

**What to look for:** increasing threads first *helps* (4 → 64 threads: 1089 →
167 ms), then gains flatten out, and with excessive threads the time can go
*up* again (64 → 400 threads: 167 → 212 ms) — context switching and cache
thrashing eat the CPU. The example also warns that creating 10,000+ platform
threads can fail with `OutOfMemoryError: unable to create native thread`
(~1 MB stack per thread).

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.performance.CpuBoundThreadExample
java -cp target/classes com.example.javalab.performance.IoBoundThreadExample
java -cp target/classes com.example.javalab.performance.TooManyThreadsExample
```

Expected observation: the CPU-bound table saturates at ~#cores; the I/O-bound
table keeps improving until every core is busy; the too-many-threads table
gets *worse* at the high end. Your absolute numbers will differ — the *shape*
of the curves is the lesson.

---

## 9. Common Concurrency Failures

The `problems` package reproduces the incidents that happen in production —
each one controlled, deterministic where possible, and always terminating.

### Deadlock

**Repository example:** `src/main/java/com/example/javalab/problems/DeadlockExample.java`

Two locks, two threads, opposite acquisition order:

```java
Thread t1 = new Thread(() -> {
    synchronized (LOCK_A) {
        sleep(100);                       // make the interleaving deterministic
        synchronized (LOCK_B) { /* never reached */ }
    }
}, "deadlock-thread-1");

Thread t2 = new Thread(() -> {
    synchronized (LOCK_B) {
        sleep(100);
        synchronized (LOCK_A) { /* never reached */ }
    }
}, "deadlock-thread-2");
```

Thread-1 holds `LOCK_A` and wants `LOCK_B`; thread-2 holds `LOCK_B` and wants
`LOCK_A` — circular wait. Both threads are **daemon** threads, so the JVM can
still exit after `main` finishes (in a real application they would hang the
process forever). After a 2 s sleep the example asks the JVM itself to detect
the problem:

```java
ThreadMXBean mxBean = ManagementFactory.getThreadMXBean();
long[] deadlockedIds = mxBean.findDeadlockedThreads();
```

**Actual output:**

```
  [thread-1] holds LOCK_A, wants LOCK_B...
  [thread-2] holds LOCK_B, wants LOCK_A...

JVM deadlock detector (findDeadlockedThreads):
  DEADLOCKED: deadlock-thread-1 state=BLOCKED
  DEADLOCKED: deadlock-thread-2 state=BLOCKED
```

**Inspecting with a thread dump:** the comments in the file explain how to run
it with `Thread.sleep(30_000)` and attach `jcmd <pid> Thread.print` — the dump
then contains a `Found one Java-level deadlock` section with the exact cycle.
Prevention rules printed by the example: consistent lock ordering, `tryLock`
with timeouts, at most one lock at a time.

### Thread Starvation

**Repository example:** `src/main/java/com/example/javalab/problems/StarvationExample.java`

A pool of 2 threads; two long tasks (2 s) arrive first and occupy *both*
workers; ten short tasks arrive 100 ms later and wait in the queue. Every
short task records how long it waited.

**Actual output (abridged):**

```
  [short-01] ran after waiting ~1902 ms (work itself: <1 ms)
  [short-02] ran after waiting ~1902 ms (work itself: <1 ms)
  ...
Results:
  short tasks executed : 10/10
  worst delay for a short task: ~1909 ms
```

**Why some tasks cannot execute promptly:** long tasks at the head of the queue
starve everything behind them — head-of-line blocking. The example notes the
related variant, *lock starvation* (the default non-fair `synchronized` monitor
can starve a waiter indefinitely under constant contention), and the fixes:
separate pools per workload type, chunked long jobs, timeouts on downstream
calls.

### Thread Pool Exhaustion

Already covered in Section 7 with `ThreadPoolExhaustionExample` — all workers
blocked on a slow downstream, a fast task stuck in the queue, no exception
thrown.

### ThreadLocal Leak

**Repository example:** `src/main/java/com/example/javalab/problems/ThreadLocalLeakExample.java`

Pool threads live for *years*; a `ThreadLocal` value that is never removed
leaks both memory and **data** — the next task reusing the thread sees the
previous task's value. Phase 1 of the example is broken (no `remove()`),
Phase 2 is the fix:

```java
try {
    CURRENT_USER.set(user);
    // ... work ...
} finally {
    CURRENT_USER.remove();      // the fix: never leak across tasks
}
```

**Actual output:**

```
PHASE 1 - BROKEN: tasks never call remove()
  reader-1 sees user=user-3 on leaky-worker  <-- STALE value set by an EARLIER task!
  reader-2 sees user=user-1 on leaky-worker  <-- STALE value set by an EARLIER task!
  ...
PHASE 2 - FIXED: tasks call remove() in finally
  reader-2 sees user=null  <-- clean (nothing leaked between tasks)
```

The readers are submitted only *after* a latch confirms all setters finished,
so every non-null value is provably stale. In a real application this is how
one request ends up with **another user's security context** — a data leak,
not just a memory leak.

### Lost Exceptions

**Repository example:** `src/main/java/com/example/javalab/problems/LostExceptionExample.java`

The difference between `execute()` and `submit()` in one program:

1. `submit()` a task that throws, never call `future.get()` → the exception is
   captured inside the `Future` and vanishes: no log, no error, the system
   looks healthy.
2. `execute()` the same task with an `UncaughtExceptionHandler` → the failure
   is visible.
3. `submit()` + `future.get()` → `ExecutionException` surfaces the cause.

**Actual output:**

```
1) submit() and NEVER call future.get():
   ...the task threw, but nothing printed, nothing logged.
   The exception sits inside the Future - invisible.
2) execute() -> UncaughtExceptionHandler caught: kaboom (via execute)
3) submit() + future.get() surfaced the failure:
   ExecutionException cause = kapow (via submit + get)
```

This is one of the main reasons concurrency bugs "only appear in production":
the errors are produced, caught by the machinery, and hidden. Fixes: always
handle `Future`s, or wrap task bodies in `try/catch` and log.

### Blocking Shared Thread Pool

**Repository example:** `src/main/java/com/example/javalab/problems/BlockingSharedPoolExample.java`

One shared pool of 4 threads serves both "slow external call" tasks (2 s) and
"fast local" tasks (5 ms). Then the same program runs the fast tasks on a
**dedicated** pool.

**Actual output:**

```
BAD DESIGN - one shared pool for everything:
   fast task latencies: [1904, 1908, 1914, 1917] ms

GOOD DESIGN - dedicated pools per workload type:
   fast task latencies: [6, 5, 5, 5] ms
```

**How blocking tasks affect unrelated work:** the 4 slow calls occupy every
worker, so the 4 fast tasks queue behind them and their latency explodes from
~5 ms to ~2 s — one slow dependency takes down unrelated functionality.
**The fix:** never mix workloads in one pool; size each pool for its own
wait/compute ratio.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.problems.DeadlockExample
java -cp target/classes com.example.javalab.problems.StarvationExample
java -cp target/classes com.example.javalab.problems.ThreadLocalLeakExample
java -cp target/classes com.example.javalab.problems.LostExceptionExample
java -cp target/classes com.example.javalab.problems.BlockingSharedPoolExample
```

Expected observations: the deadlock is detected by the JVM itself; short tasks
wait ~2 s in the starvation example; phase 1 readers see stale users; the
`submit()` exception prints nothing until `get()` is called; fast-task latency
drops from ~1900 ms to ~5 ms with dedicated pools.

---

## 10. Platform Threads vs Virtual Threads

### Platform Threads

Everything so far used **platform threads**: the classic Java `Thread`, which
wraps an OS thread 1:1 — the kernel creates it, schedules it, and gives it a
~1 MB stack. The constraints are the OS's constraints: creation cost in
milliseconds, memory per thread, scheduler overhead. This is why 10,000
platform threads are a lot and 100,000 are usually impossible.

### Virtual Threads

A **virtual thread** is a JVM-managed lightweight thread (Java 21, JEP 444).
It is not an OS thread: it is scheduled by the JVM onto a small pool of
platform threads called **carrier threads**. When a virtual thread blocks, the
JVM **unmounts** it from the carrier (saving its continuation) and mounts
another runnable virtual thread in its place. To the OS, nothing happened —
the carrier never blocked. The one caveat to remember: if a virtual thread
blocks *inside* a `synchronized` block (or native code), it can **pin** the
carrier; avoid long blocking calls inside `synchronized` when using virtual
threads.

```
Virtual thread model (many : few):

  100,000 virtual threads
        │   JVM scheduler
        ▼
   ( carrier threads - platform threads )
        │
        ▼
        CPU cores
```

### Example: Basic Virtual Thread Creation

**Repository example:** `src/main/java/com/example/javalab/virtualthread/BasicVirtualThreadExample.java`

```java
Thread vt1 = Thread.startVirtualThread(() -> { /* blocking code is fine here */ });

Thread vt2 = Thread.ofVirtual()
        .name("my-named-vt")
        .start(() -> System.out.println(Thread.currentThread().isVirtual()));
```

**Actual output:** both virtual threads report `isVirtual=true`; a normal
`Thread` reports `false`. Facts the example prints: virtual threads are daemon
by default, share the heap (thread-safety rules unchanged), and park on
blocking calls at almost no cost.

### Example: Platform vs Virtual Threads

**Repository example:** `src/main/java/com/example/javalab/virtualthread/PlatformVsVirtualThreadExample.java`

1,000 tasks, each "blocking" for 30 ms. **Actual output:**

```
  platform pool (16 threads):  2108 ms
  virtual threads (1000):        54 ms
```

Then the scale check: creating **100,000 idle virtual threads took ~59 ms** —
while 100,000 platform threads (~1 MB stack each) would likely throw
`OutOfMemoryError: unable to create native thread`.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.BasicVirtualThreadExample
java -cp target/classes com.example.javalab.virtualthread.PlatformVsVirtualThreadExample
```

Expected observations: `isVirtual=true` for virtual threads; the platform pool
takes ~2 s where 1,000 virtual threads take ~50 ms on the same blocking
workload; 100,000 virtual threads are created in well under a second.

---

## 11. When Virtual Threads Help

### Example: One Virtual Thread per Task

**Repository example:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadExecutorExample.java`

10,000 tasks, each sleeping 10 ms, submitted to
`Executors.newVirtualThreadPerTaskExecutor()`. The try-with-resources block
closes the executor, which waits for all tasks:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 10_000).forEach(i -> executor.submit(() -> {
        // ... blocking work ...
    }));
}   // close() == shutdown() + awaitTermination: waits for all tasks
```

**Actual output:**

```
All 10,000 tasks completed.
Wall time: 541 ms
Max concurrently running: 9809 (near 10,000 - they all run at once)
```

Sequentially the same work would take 100 seconds. With virtual threads, all
10,000 block cheaply at once — **zero pool sizing, zero queue tuning**.

### Example: Blocking I/O Latency

**Repository example:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadIoExample.java`

600 simulated remote calls of 50 ms each, run two ways. **Actual output:**

```
platform pool (8 threads): wall  4269 ms, p95 latency 4070 ms
virtual threads (600):     wall    67 ms, p95 latency  58 ms
```

**What is being simulated:** each task parks for 50 ms (`LockSupport.parkNanos`)
representing an HTTP call, JDBC query, or file read. With a small platform pool,
most of the latency is **queueing** — waiting for a free thread; the p95 of
~4 s is ~80× the actual call time. With virtual threads, every call starts
immediately and the p95 (~58 ms) *is* the call time. This is the sweet spot
for HTTP calls, database calls, file I/O and any high-concurrency blocking
workload.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadExecutorExample
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadIoExample
```

Expected observations: the 10,000-task batch finishes in well under a second
with near-10,000 max concurrency; the I/O example shows p95 latency collapse
from ~4 s to ~60 ms on the same workload.

---

## 12. When Virtual Threads Do NOT Help

### Example: CPU-bound Work on Virtual Threads

**Repository example:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadCpuBoundExample.java`

The same prime-counting workload as `CpuBoundThreadExample`, run on a platform
pool of #cores, a pool of 4×#cores, and on virtual threads. **Actual output:**

```
  platform pool  12 threads:    75 ms
  platform pool  48 threads:    27 ms
  virtual threads          :    29 ms
```

**Observation:** virtual threads run the *same* CPU work at roughly the *same*
speed as a correctly sized platform pool — no magic speedup, sometimes a hair
slower due to scheduling overhead. Virtual threads do not:

- make CPU-bound tasks faster (cores still bound them);
- create more CPU cores;
- solve race conditions (all the `synchronization` rules apply unchanged);
- remove database connection limits, API rate limits, or the need for
  backpressure.

> **Virtual Threads improve scalability for blocking concurrency. They do not
> automatically make CPU-bound code faster.**

Rule of thumb printed by the example: CPU-bound → fixed pool of ~#cores;
I/O-bound → virtual threads shine.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadCpuBoundExample
java -cp target/classes com.example.javalab.performance.CpuBoundThreadExample
```

Expected observation: the CPU-bound wall times are in the same ballpark on
virtual threads and on a pool of ~#cores — the difference is noise, not magic.

---

## 13. Resource Limits and Backpressure

This is the most production-relevant section of the article, and the repository
devotes its centerpiece example to it.

### Example: Virtual Threads and Resource Limits

**Repository example:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadResourceLimitExample.java`

The scenario: 400 requests, each needing a "database query". A `Semaphore`
with 10 permits simulates a connection pool of 10. The example runs three
phases:

```java
Semaphore connections = new Semaphore(POOL_LIMIT);   // POOL_LIMIT = 10

Thread.startVirtualThread(() -> {
    try {
        connections.acquire();        // wait for a "connection"
        // ... simulated query (50 ms) ...
    } finally {
        connections.release();
    }
});
```

**Actual output:**

```
   max parallel queries observed: 10
A) 400 virtual threads + semaphore(10): 2304 ms, max parallel = 10

   max parallel queries observed: 10
B) 10 platform threads (pool=10):       2320 ms, max parallel = 10

   max parallel queries observed: 400
C) 400 virtual threads, NO limit:         62 ms, max parallel = 400
```

The complete flow being demonstrated:

```
Many Virtual Threads
        ↓
Attempt to access resource
        ↓
Concurrency limit (Semaphore)
        ↓
Only limited tasks proceed (max 10)
        ↓
Others wait (cheaply)
```

**What the numbers prove:** phases A and B take the *same* time (~2.3 s) — the
bottleneck is the 10 connections, not the threading model. Virtual threads only
made the 390 waiting threads nearly free. Phase C "wins" the timing but would
overload a real database: 400 simultaneous queries against a 10-connection
pool means timeouts and queueing inside the pool driver.

> **Virtual Threads remove the cost of waiting threads — not the cost of the
> resources they are waiting for.**

This applies to every backend resource:

- **Database connection pools** (HikariCP `maximumPoolSize`) — connections, not
  threads, bound DB throughput.
- **External HTTP APIs** — rate limits and quotas (429 responses).
- **Redis** — single-threaded command processing; a burst just queues up and
  latency explodes for everyone.
- **Any downstream service** — queueing happens in *their* infrastructure.

### Example: Semaphore Concurrency Limit

**Repository example:** `src/main/java/com/example/javalab/practical/SemaphoreConcurrencyLimitExample.java`

1,000 incoming tasks on virtual threads, a `Semaphore(10)`, a simulated
30 ms resource call. **Actual output:**

```
All 1000 tasks finished in 3389 ms.
Max simultaneous resource calls: 10 (never exceeds 10)
```

The example prints the "why": a 10-connection pool cannot serve 1,000
simultaneous queries; APIs have RPS/hour limits; Redis is single-threaded.
**Rule: size the `Semaphore` to the downstream capacity — not to how many
threads you can create.** This applies to virtual threads and platform threads
alike.

### Backpressure in Thread Pools

Backpressure is the principle that a fast producer must be forced to slow down
when the consumer cannot keep up. In the repository it appears as:

- the **bounded queue** (`BoundedQueueExample`) — the producer can only push so
  far ahead;
- the **rejection policy** (`RejectedExecutionExample`) — `CallerRunsPolicy`
  slows the producer by running the task in its own thread;
- the **producer/consumer pattern** (`ProducerConsumerExample`) — a bounded
  `ArrayBlockingQueue` of capacity 5 blocks producers when full. The example
  prints `produced=50 consumed=46` (items in flight) and terminates cleanly
  via poison pills — one per consumer, so all three consumers exit.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadResourceLimitExample
java -cp target/classes com.example.javalab.practical.SemaphoreConcurrencyLimitExample
java -cp target/classes com.example.javalab.practical.ProducerConsumerExample
```

Expected observations: phases A and B of the resource-limit example take nearly
the same time (max parallel = 10) while phase C finishes instantly with
max parallel = 400; the semaphore example never exceeds 10 simultaneous calls;
the producer/consumer example ends with all consumers exiting on poison pills.

---

## 14. Debugging Thread Problems in Production

The repository gives you the vocabulary for the debugging loop.

### Thread Dumps

```bash
jcmd <pid> Thread.print        # or: jstack <pid>
```

- Many threads `BLOCKED` → synchronized contention; find the monitor in the
  stack trace, find who holds it.
- Piles of `WAITING`/`TIMED_WAITING` on `park` → pool queues, futures, or idle
  pool threads.
- **Deadlock**: the dump contains a `Found one Java-level deadlock` section —
  exactly what `DeadlockExample` reproduces (and its `findDeadlockedThreads()`
  call shows the same result programmatically).

### JVM Monitoring and Metrics

- **CPU utilization**: `top -H` shows per-thread CPU; 100% on all cores with
  many `RUNNABLE` threads → CPU saturation; low CPU with long latency → waiting
  on something.
- **JFR** (`jfr start --filename app.jfr`): lock contention events
  (`jdk.JavaMonitorEnter`), thread allocations, CPU sampling — no restart
  needed.
- **Executor metrics** (Micrometer/JMX): `executor_active_threads`,
  `executor_queue_size`, `executor_completed_task_count`. A growing queue is
  the earliest warning of pool exhaustion — the state
  `ThreadPoolExhaustionExample` simulates.
- **Connection pool metrics** (e.g. HikariCP): `connections_pending`,
  `connections_active`, `connections_timeout_total` — connection starvation
  shows up here before request latency explodes.

### The Investigation Loop

```
1. Latency spike?            → check p95/p99 percentiles
2. CPU saturated?            → no: waiting on something (dumps, DB metrics)
                              → yes: CPU-bound bottleneck (profiler)
3. Thread states in dumps:
   - BLOCKED piles           → lock contention (find the monitor)
   - WAITING piles           → queue/pool exhaustion (queue-size metric)
   - all busy on same call   → one slow dependency (timeouts, circuit breaker)
4. Pool metrics growing?     → producers outrunning consumers (backpressure!)
```

---

## 15. Practical Decision Guide

| Need | Tool | Why / when |
| ---- | ---- | ---------- |
| One-off background task, test, script | Raw `Thread` (`CreateThreadExample`) | Simple, ephemeral; never in production request paths |
| General task execution with lifecycle control | `ExecutorService` (`RunnableExample`) | submit/await/shutdown, worker reuse |
| CPU-bound workload | Fixed pool ≈ `#cores` (`CpuBoundThreadExample`) | More threads only add switching overhead |
| I/O-bound workload, moderate concurrency | Bounded fixed pool sized by wait/compute (`IoBoundThreadExample`) | Bounded queue mandatory (`BoundedQueueExample`) |
| Massive blocking concurrency | Virtual Threads (`VirtualThreadExecutorExample`) | Cheap blocked threads; simple blocking code |
| Counters, flags, simple state | `AtomicInteger` / `volatile` (`AtomicIntegerExample`, `VolatileExample`) | Atomicity for counters, visibility for flags |
| Complex critical sections, timeouts | `synchronized` / `ReentrantLock` (`SynchronizedExample`, `LockExample`) | `tryLock(timeout)` against deadlocks |
| Cap concurrency to a scarce resource | `Semaphore` (`SemaphoreConcurrencyLimitExample`) | Size to downstream capacity — works with virtual threads |
| Rate limiting / circuit breaking | `RateLimiter`, `Resilience4j`, `Bucket4j` | Reject upstream before internal saturation |
| Big CPU-parallel computation | Parallel streams, `ForkJoinPool` | Sized to cores |

---

## 16. Final Mental Model

Five sentences capture the whole article — each backed by a repository example:

1. **A thread does not automatically make code faster.** It only gives work a
   chance to run in parallel (`CpuBoundThreadExample`).
2. **Concurrency is not parallelism.** Concurrency is structure; parallelism is
   execution on multiple cores. Threads give you the first; only hardware gives
   you the second.
3. **More threads do not mean more CPU power.** Beyond the core count, threads
   buy context switches (`TooManyThreadsExample`).
4. **Virtual Threads improve scalability for blocking concurrency, not CPU
   performance.** They make waiting cheap (`VirtualThreadIoExample`) but do not
   speed up computation (`VirtualThreadCpuBoundExample`).
5. **The difficult part of multithreading is managing shared state, resource
   limits, backpressure, lifecycle, and failures** — exactly the failures the
   `problems` package reproduces, and exactly what the `practical` package
   fixes.

The central message, printed by the resource-limit example:

> Virtual Threads remove the cost of waiting threads — not the cost of the
> resources they are waiting for.

---

## Code Examples in This Repository

Every example is a standalone class with a `main` method, runnable after
`mvn clean compile` via `java -cp target/classes <fully.qualified.ClassName>`.
The full runnable list (31 examples) lives in the repository
[`README.md`](https://github.com/hungpt99-dev/java-lab/blob/main/README.md); the
table below maps each one to the article sections and its lesson.

| Blog Section | Repository Example | What It Demonstrates |
| ------------ | ------------------ | -------------------- |
| Creating and Running Threads | `basics.CreateThreadExample` | Three ways to create a thread; concurrent, unordered output |
| Creating and Running Threads | `basics.RunnableExample` | Runnable vs Callable, `join()`, `sleep()`, `Future.get()` |
| Creating and Running Threads | `basics.StartVsRunExample` | `run()` runs in the caller; `start()` creates a new thread |
| Thread Lifecycle | `basics.ThreadLifecycleExample` | All six states, manufactured and observed |
| Race Conditions | `synchronization.RaceConditionExample` | Broken counter: `count++` loses increments (nondeterministic) |
| Synchronization | `synchronization.SynchronizedExample` | The same counter, always correct with a monitor |
| Synchronization | `synchronization.VolatileExample` | `volatile` ≠ atomicity; visibility of shared flags |
| Synchronization | `synchronization.AtomicIntegerExample` | Lock-free CAS counter, always correct |
| Synchronization | `synchronization.LockExample` | `ReentrantLock`, reentrancy, `tryLock(timeout)` |
| Thread Pools | `threadpool.FixedThreadPoolExample` | Fixed pool = unbounded queue; worker reuse |
| Thread Pools | `threadpool.ThreadPoolExecutorExample` | Core → queue → max → rejection pipeline |
| Thread Pools | `threadpool.BoundedQueueExample` | Unbounded queue never engages `maximumPoolSize` |
| Thread Pools | `threadpool.RejectedExecutionExample` | `AbortPolicy` vs `CallerRunsPolicy` in practice |
| Thread Pools | `threadpool.ThreadPoolExhaustionExample` | All workers blocked; fast tasks wait; no exception |
| Thread Pools | `practical.GracefulShutdownExample` | `shutdown()` → `awaitTermination()` → `shutdownNow()` |
| Common Failures | `problems.DeadlockExample` | Circular wait; JVM detection; thread-dump inspection |
| Common Failures | `problems.StarvationExample` | Long tasks starve short tasks (head-of-line blocking) |
| Common Failures | `problems.ThreadLocalLeakExample` | Stale data + memory leak; `remove()` fix |
| Common Failures | `problems.LostExceptionExample` | `execute()` vs `submit()`; swallowed exceptions |
| Common Failures | `problems.BlockingSharedPoolExample` | Slow calls destroy fast-task latency; separate pools fix it |
| Performance | `performance.CpuBoundThreadExample` | CPU-bound: bounded by cores, not threads |
| Performance | `performance.IoBoundThreadExample` | I/O-bound: concurrency scales throughput |
| Performance | `performance.TooManyThreadsExample` | Small → reasonable → excessive thread counts |
| Virtual Threads | `virtualthread.BasicVirtualThreadExample` | `startVirtualThread`, `ofVirtual()`, `isVirtual` |
| Virtual Threads | `virtualthread.VirtualThreadExecutorExample` | Per-task executor; 10,000 tasks run at once |
| Virtual Threads | `virtualthread.PlatformVsVirtualThreadExample` | 16 platform threads vs 1,000 VTs; 100k VTs created |
| Virtual Threads | `virtualthread.VirtualThreadIoExample` | p95 latency: queueing vs call time |
| Virtual Threads | `virtualthread.VirtualThreadCpuBoundExample` | VTs do NOT speed up CPU-bound work |
| Virtual Threads | `virtualthread.VirtualThreadResourceLimitExample` | Semaphore-bound resource: VTs don't lift the limit |
| Resource Limits | `practical.SemaphoreConcurrencyLimitExample` | Capping concurrency to downstream capacity |
| Practical Patterns | `practical.ProducerConsumerExample` | Bounded queue, backpressure, poison-pill shutdown |

**How to run everything at once:** `powershell -File scripts/run-all.ps1`
compiles if needed and runs all 31 examples in sequence (it also caught a real
bug while this article was being written: a forgotten `executor.shutdown()`
kept the JVM alive — the kind of leak the `LostExceptionExample` warns about).
Every example terminates cleanly; dangerous ones (deadlock) use daemon threads;
all timings are machine-dependent and deliberately marked as such in their
output.
