---
title: "Java Threads: From Thread Pools to Virtual Threads"
description: "A deep, production-oriented guide to Java concurrency with 31 runnable examples: what threads really are, why shared state breaks, how thread pools and backpressure work, why more threads can be slower, and what Virtual Threads actually change under the hood."
pubDatetime: 2026-08-09T00:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Imagine a service that receives 10,000 requests at once.

Some of those requests need the CPU — parsing JSON, hashing, compressing.
Some wait for a database query.
Some wait for an external HTTP API that takes 300 ms to answer.

The first question every engineer asks: *should we create 10,000 threads?*

If not, why not? And the follow-up that confuses everyone: *if Java
Virtual Threads let us create millions of threads, why can't we make the
application infinitely concurrent?*

This article answers those questions. But instead of starting with a
definition of a thread, it starts with the stack of machinery that decides
everything about concurrency:

```text
Application Code
       ↓
Java Threads
       ↓
JVM
       ↓
Operating System Scheduler
       ↓
CPU Cores
       ↓
External Resources (databases, APIs, files)
```

Every question in this article is really about one thing: **where does your
system actually bottleneck, and does adding threads address that bottleneck or
just move it somewhere else?**

This is the mental model we will use again and again:

> **Before adding threads, ask: what is actually limiting the system?**
> CPU? Database connections? An external API rate limit? Network? Memory?
> Lock contention? The thread pool itself? Queue capacity?
> Increasing concurrency is only useful if it addresses the actual
> bottleneck. Otherwise it may simply move the bottleneck elsewhere.

Here are the four questions this article answers in depth:

- Why can adding more threads make an application **slower**?
- Why does a thread pool with hundreds of threads not improve CPU utilization?
- Why can Virtual Threads handle massive concurrency but not make CPU-bound code faster?
- Why do concurrency bugs almost always **only appear in production**?

Every claim is backed by a real, runnable example. The article is designed to
be read next to the companion repository [`java-lab`](https://github.com/hungpt99-dev/java-lab),
a plain Maven project with **31 small, independent examples**, zero frameworks,
and pure JDK concurrency APIs. Each section maps a concept to an actual class,
shows the real code, and tells you exactly what to run and what to observe.

All examples compile with Java 21+ (`maven.compiler.release` is set to `21` in
the `pom.xml`; Virtual Threads require Java 21). Every measurement quoted in
this article was produced by running the examples on a 12-core machine with
JDK 21 — treat them as sample data, not universal benchmark results.

**How to read this article:** every concept names its repository class; run it
with the commands in the "Try It Yourself" boxes and compare your observation
with the recorded outputs shown here. The structure is always the same: a
problem, an intuition, the code, what actually happens, why, what happens
under the hood, the trade-offs, and when it matters in production.

---

## 1. The Real Problem: 10,000 Requests

Let us go back to the opening scenario. A normal program executes
instructions **sequentially** — one thing finishes before the next starts:

```text
Task A
  ↓
Task B
  ↓
Task C
```

But a real backend rarely looks like that. At any instant it has requests in
completely different phases:

```text
Request A ───── waiting for database
Request B ───── calculating
Request C ───── waiting for HTTP API
Request D ───── processing file
```

Here is the wasted opportunity: while Request A waits for the database,
the CPU is idle. A sequential program cannot start Request B until A is
finished — so the machine spends most of its time doing nothing, waiting
on external resources that are thousands of times slower than the CPU.

A CPU core executes billions of instructions per second. A database round
trip takes milliseconds — millions of instructions worth of time. *Waiting*
is not a rare event in a backend; it is the default state.

This gap between "the CPU is fast" and "everything else is slow" is the
original reason threads exist. Threads let one program keep the CPU busy
on other work while some of its work is blocked on something slow.

But threads bring a new set of problems: they are not free to create, they
share memory, they can corrupt each other's state, and they do not create
CPU capacity. The rest of this article walks through that trade — each
concept, its mechanism, and its price.

---

## 2. Concurrency and Parallelism: Two Different Tools

Before looking at Java at all, we need the distinction that the whole
article is built on.

### 2.1. Concurrency is about structure; parallelism is about execution

- **Concurrency**: multiple tasks make progress during *overlapping* time
  periods, interleaved on the same CPU. It is a way to *structure* a program
  that has waiting in it.
- **Parallelism**: multiple tasks physically *execute at the same instant*,
  on different CPU cores. It is a property of the *hardware* doing the
  execution.

A helpful but technically honest analogy: concurrency is one chef switching
between multiple dishes on one stove — no dish cooks faster, but all of them
make progress while each waits. Parallelism is multiple chefs cooking at the
same time — actual throughput, but only because there are multiple stoves.

```text
Concurrency (interleaved on 1 core):
  Thread A:  |--A1--|        |--A2--|        |--A3--|
  Thread B:        |--B1--|        |--B2--|        |--B3--|

Parallelism (simultaneous on 2 cores):
  Core 1:    |------A1------|------A2------|
  Core 2:    |------B1------|------B2------|
```

The deeper point: **concurrency is often about dealing with waiting, while
parallelism is about using multiple execution resources.** If your task never
waits, concurrency buys you almost nothing — only parallelism (more cores)
helps. If your task waits a lot, concurrency lets other tasks use the time
you would otherwise waste.

Concurrency does not require multiple cores. Parallelism requires them. If
your machine has 4 cores and you create 1000 threads, at most **4 tasks run
at the same instant** — the other 996 are waiting, sleeping, or being
context-switched. **Creating threads does not create cores.**

### 2.2. The two workload types that decide everything

There is one question to ask about any task: *what is it waiting for?*

- **CPU-bound**: the task spends its time computing — parsing, hashing,
  crypto, compression. Speed is limited by CPU cores, not by thread count.
- **I/O-bound**: the task spends most of its time *waiting* — for a database,
  an HTTP response, a file read. Speed is limited by latency and concurrency.

```text
CPU-bound task:   [=====compute=====][=====compute=====][=====compute=====]
                  ↑ CPU is the bottleneck → only #cores matters

I/O-bound task:   [wait 95ms][wait 95ms][wait 95ms]
                  [ 5ms work ][ 5ms work ][ 5ms work ]
                  ↑ 95% of time is waiting → more concurrency helps
```

Why does this matter before we even talk about threads? Because the *entire*
design of Java concurrency — thread pools, Virtual Threads, backpressure — is
an answer to the I/O-bound reality of backends. A typical request handler in
production does 5 ms of real work and 95 ms of waiting. The CPU utilization of
that single task is 5%. You can run ~20 such tasks per core before the CPU is
busy — the other 19 are nearly free while they wait.

The repository dedicates a whole package to proving these two statements with
measurements (Section 10), because they determine how many threads you should
ever create.

### 2.3. Blocking: what "waiting" means at the thread level

A thread **blocks** when it cannot continue without an external event — a
lock, a `sleep()`, a DB query, an HTTP response. A blocked thread consumes
**zero** CPU (it is not scheduled) but still holds its memory and still counts
as a thread for the OS scheduler.

Blocking is precisely the property that makes I/O-bound work scalable with
threads: while thread A waits for the DB, the CPU can run thread B. The whole
game of thread pools — and later of Virtual Threads — is about keeping the CPU
busy while most threads are blocked, without paying too much for the threads
that are merely waiting.

---

## 3. What a Platform Thread Really Is

**Repository examples:** `src/main/java/com/example/javalab/basics/CreateThreadExample.java`, `src/main/java/com/example/javalab/basics/RunnableExample.java`

The textbook says a thread is "a unit of execution". That tells you what it
does, not what it *is*. Under the hood, a thread is a bundle of state that
the CPU can switch to, run, suspend, and switch away from:

- **A stack** — the memory region holding local variables and call frames.
  In a typical JVM/OS environment a platform thread reserves about **1 MB**
  of stack. This is the dominant memory cost of threads.
- **A program counter** — the address of the next instruction to execute.
- **Execution state** — registers (general-purpose, stack pointer, frame
  pointer, instruction pointer), plus flags like "interrupted".
- **Scheduling metadata** — priority, state, wait queues, CPU time
  accounting. This is what the OS scheduler uses to decide *when* to run it.

The key fact about a *platform* thread (the classic Java `Thread`) is the
relationship it has with the operating system. Conceptually:

```text
Java Platform Thread
        │
        ▼
JVM
        │
        ▼
Native / OS Thread
        │
        ▼
Operating System Scheduler
        │
        ▼
CPU Core
```

A platform thread maps **1:1 to an OS/native thread**: when the JVM creates a
`Thread`, it asks the OS to create a native thread; when that thread runs, the
OS scheduler decides which core it runs on. The exact implementation varies by
OS and JVM, but the cost structure is consistent, and it is this cost
structure that shapes every design decision in Java concurrency:

- **Creation cost.** Creating a thread means a system call into the kernel and
  allocating a native stack — milliseconds, not nanoseconds, and it is a
  kernel operation, so it competes with every other process on the machine.
- **Stack memory.** ~1 MB reserved per thread. 10,000 threads ≈ 10 GB of
  virtual memory. In practice, most processes hit `OutOfMemoryError: unable
  to create native thread` before they run out of heap.
- **Kernel scheduling.** The OS scheduler must track every runnable thread.
  More threads = more scheduler work, on every context switch, on every timer
  tick.
- **Context switching.** Switching the CPU from one thread to another costs
  CPU time and destroys CPU cache locality (Section 10).
- **Scheduler overhead at scale.** With thousands of runnable threads, a
  large fraction of CPU time can go to *deciding* what to run and *switching*
  to it, instead of running it.

The `basics` package demonstrates how threads are created and what the API
gives you, so the costs above are something you can feel rather than read
about.

### Example: Creating a Thread

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

**What happens when it runs:** three threads execute concurrently; each prints
its line from its own thread. **Why it happens:** each `start()` created a
native thread that the OS scheduler runs in parallel with `main`. **Under the
hood:** each of those threads has its own stack (~1 MB reserved) and its own
registers; `join()` blocks `main` until each thread terminates — `join()` is
itself a blocking operation. **Production impact:** creating a `Thread` per
request is exactly the pattern that collapses at 10,000 concurrent requests
(Section 8). **Key takeaway:** a thread is a real, expensive OS resource —
three threads are cheap, three thousand are not.

### Example: Runnable vs Callable

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

**Under the hood:** the task is executed on a worker thread; the result is
stored in the `Future`. `future.get()` blocks the *caller* until the value is
available — note that the caller does not busy-wait, the OS parks it.
**Production impact:** the pattern "submit work, get a `Future`, block on
`get()`" is how most async orchestration works; the `Future` is also where
task exceptions silently disappear if you never call `get()` (Section 11.5).

> **Also covered by these examples:** `join()` (waiting for a thread to
> finish) and `sleep()` (used throughout as simulated work). Thread names make
> logs readable — every pool example in the repository names its threads with
> a custom `ThreadFactory`.

## Try It Yourself

```bash
cd java-lab
mvn clean compile
java -cp target/classes com.example.javalab.basics.CreateThreadExample
java -cp target/classes com.example.javalab.basics.RunnableExample
```

Expected observation: the three lines in `CreateThreadExample` print from
three different thread names in a *different order on every run*. That
nondeterministic order *is* concurrency.

---

## 4. start() vs run(): What Actually Changes

**Repository example:** `src/main/java/com/example/javalab/basics/StartVsRunExample.java`

This is the most important beginner distinction in Java concurrency, and the
reason behind it is exactly the machinery of Section 3:

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

**What actually changes.** Calling `run()` is an ordinary method call. The
execution flow is:

```text
Current Thread
     ↓
Call run() as a normal method
     ↓
Execute sequentially
```

Calling `start()` changes the entire architecture:

```text
Current Thread
     ↓
Ask JVM to start a new execution thread
     ↓
New native thread is created and scheduled
     ↓
JVM invokes run() on the new thread
```

**Why the output order is nondeterministic.** Once `start()` has been called,
there are two independent threads that are both *runnable*. From that moment,
the developer no longer fully controls execution order: the JVM and the OS
scheduler decide when each thread gets CPU time, and that decision depends on
machine load, other processes, timer interrupts, and the scheduler's policy.
Even on a machine that appears idle, you cannot predict which of the two
threads prints first.

`run()` gives you zero concurrency, and the bug is invisible because the code
still produces correct results — it just runs sequentially on the caller. This
is a classic silent failure: code that *looks* concurrent but is not.

**Under the hood:** `start()` performs a native call that creates a kernel
thread, allocates its stack, and enqueues it as runnable. Only then does the
OS scheduler pick it up and eventually let it execute `run()`. In contrast,
`run()` never leaves the caller's stack.

**Production impact:** `t.run()` inside a request handler instead of
`t.start()` turns a supposedly parallel fan-out into sequential execution —
latency multiplies by the number of tasks. It also explains why "it works on
my machine" concurrency bugs exist: the same code can behave differently when
the scheduler has other work to do.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.basics.StartVsRunExample
```

Expected observation: `run()` always prints the caller's thread name (`main`);
`start()` prints the new thread's name (`new-thread`).

---

## 5. The Thread Lifecycle: Why the States Exist

**Repository example:** `src/main/java/com/example/javalab/basics/ThreadLifecycleExample.java`

Every thread state is an answer to a question the scheduler must answer:
*can this thread run right now, and if not, what is it waiting for?* The six
states are the vocabulary of thread dumps — which means understanding them is
a debugging skill, not trivia.

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

- **NEW** — created but `start()` not called yet. There is no OS thread.
  *Cause:* nothing has asked the JVM to begin execution.
- **RUNNABLE** — ready to run or actually running. Important: **"runnable"
  does not mean "currently executing on a CPU".** A runnable thread may be
  waiting in the OS run queue for CPU time. Java deliberately does not
  distinguish "running" from "ready": that decision belongs to the OS
  scheduler, which Java cannot see.
- **BLOCKED** — waiting to acquire a `synchronized` monitor held by another
  thread. The thread cannot proceed *because it needs exclusive access*.

  ```text
  Thread A owns Lock
          ↓
  Thread B needs same Lock
          ↓
  Thread B cannot continue
          ↓
  BLOCKED
  ```

- **WAITING** — the thread *intentionally* paused itself waiting for another
  thread to act: `Object.wait()` without timeout, `Thread.join()`,
  `LockSupport.park()`. It is waiting for a *signal*, not for CPU time.
- **TIMED_WAITING** — the same, but with a deadline: `Thread.sleep()`,
  `join(millis)`, `await(timeout, unit)`. The difference from WAITING is
  that the OS can wake it by timer.
- **TERMINATED** — `run()` returned or threw. The thread is dead; it cannot
  be restarted.

The example manufactures each state on demand: a second thread blocks on a
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

**Production impact — reading thread dumps.** A `jstack`/`jcmd Thread.print`
dump is a photograph of these states, and each state points at a different
problem class:

- Many threads `BLOCKED` → synchronized lock contention; find the monitor in
  the stack trace, find who holds it. The fix is usually less contention
  (smaller critical sections, lock striping) or a different structure.
- Piles of `WAITING`/`TIMED_WAITING` on `park` → pool queues, futures, or idle
  pool threads; if they are *growing*, the pool is backing up.
- Floods of `RUNNABLE` → CPU saturation: the machine is the bottleneck.

**Key takeaway:** the states are not bookkeeping — they tell you whether a
thread is waiting for CPU, for a lock, or for an event, and each answer leads
to a different production diagnosis.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.basics.ThreadLifecycleExample
```

Expected observation: all six states printed in order. Note that the exact
`RUNNABLE` sample point varies per run — the state machine itself is fixed,
the *timing* is not.

---

## 6. Race Conditions: The Science Behind count++

**Repository example:** `src/main/java/com/example/javalab/synchronization/RaceConditionExample.java`

### The problem

Multiple threads share mutable state. The simplest possible shared mutation —
incrementing a counter — is broken. Not "sometimes broken": broken in a way
that is invisible until production load, and then infuriating because the
failure is statistical, not logical.

### The code

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

### What happens when it runs

**Actual output of the example:**

```
Trial 1: expected=400000 actual=84596 (<-- WRONG: increments lost)
Trial 2: expected=400000 actual=136178 (<-- WRONG: increments lost)
Trial 3: expected=400000 actual=98973 (<-- WRONG: increments lost)
Trial 4: expected=400000 actual=60526 (<-- WRONG: increments lost)
Trial 5: expected=400000 actual=400000 (correct this time)
```

### Why it happens: decompose the operation

`count++` looks like one statement. It is three operations:

```text
Read count
   ↓
Add 1
   ↓
Write count
```

Now interleave two threads — each performs its own Read/Add/Write:

```text
Time ──────────────────────────────────────►

Thread A: Read ─── Add ─── Write
Thread B:      Read ─── Add ─── Write

Thread A reads: 0
Thread B reads: 0        ← both see the OLD value

Thread A calculates: 1
Thread B calculates: 1   ← both compute the same result

Thread A writes: 1
Thread B writes: 1       ← one increment is lost

Expected: 2
Actual:   1
```

**Why it is nondeterministic:** whether the interleaving collides depends on
scheduling, JIT state, and machine load. Trial 5 happened to be correct —
which is exactly why these bugs pass code review and explode in production.
The code compiles, runs, and *sometimes* produces the right answer.

### The deeper problem: three separate guarantees

Concurrent programming is hard because "make it correct" actually means
"establish three separate guarantees", and **a solution to one does not
solve the others**:

- **Atomicity** — an operation runs as an indivisible unit; no other thread
  can observe it half-finished. Broken by `count++` (it is three steps).
  Fixed by `synchronized`, `Atomic*`, locks.
- **Visibility** — a write by thread A may never be seen by thread B, because
  each thread can cache values in registers or CPU-local caches. The write is
  not automatically flushed to shared memory.
- **Ordering** — the JIT compiler and CPU may reorder instructions as long as
  single-thread semantics hold. Code that looks ordered in source may execute
  in a different order on another core.

### The Java Memory Model: the mental model you need

The JMM is the contract that defines when threads can observe each other's
writes. You do not need the full specification — you need the practical mental
model:

```text
Thread A has a view of shared state
Thread B has a view of shared state

Without correct synchronization,
changes are not necessarily observed
in the way developers expect.
```

Each thread operates on its own view (registers + CPU caches) and the JMM
defines exactly which actions force those views to be reconciled:
`volatile` reads/writes, `synchronized` blocks, `Atomic*` operations, and a
few others. These actions create **happens-before** edges — a formal way of
saying "everything thread A did before releasing the lock is visible to
thread B after it acquires the same lock".

That is why the example is not a curiosity: every production race you will
ever debug is the same failure — shared mutable state mutated without the
synchronization that creates visibility and atomicity. "It works on my
machine" is the JMM doing its job *too well* on a lightly loaded box.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.synchronization.RaceConditionExample
```

Expected observation: most trials show an actual count far below 400,000; an
occasional trial is correct. Never trust a single run.

---

## 7. Synchronization: Why the Fixes Work

The `synchronization` package contains four fixes plus the `volatile`
truth-teller. Each fix establishes the JMM guarantees through a different
mechanism — and each has its own trade-offs.

### 7.1. synchronized: mutual exclusion + visibility

**Repository example:** `src/main/java/com/example/javalab/synchronization/SynchronizedExample.java`

```java
public class SynchronizedExample {

    private int count;

    public synchronized void increment() {
        count++;
    }
}
```

**The mechanism:** the `synchronized` monitor gives the thread *exclusive
ownership* of the critical section. Only one thread can be inside it at a
time:

```text
Only one thread enters critical section
            ↓
Shared state is modified safely
            ↓
Lock is released
            ↓
Another thread may enter
```

It establishes both guarantees at once: **mutual exclusion** (atomicity — the
read-modify-write cannot interleave) and **visibility** (the monitor release
creates a happens-before edge: everything written inside the block is visible
to the next thread that enters).

The same 8×50,000 workload is now always correct: all three trials print
`actual=400000 (correct)`.

**The trade-offs — why not synchronize everything?**

- **Lock contention.** If many threads hammer the same monitor, they *queue*.
  Each thread that misses the lock must be descheduled and rescheduled — that
  is a context switch, plus scheduler work. Under heavy contention, the code
  becomes effectively single-threaded: the lock serializes everything.
- **Critical section size.** The bigger the section, the more time threads
  spend waiting outside it. The fix is usually *smaller* critical sections —
  hold the lock only for the mutation, not for the whole method.
- **No timeout.** `synchronized` cannot time out: a thread holding the lock
  forever blocks everyone else forever. There is no way to "give up".
- **Non-fairness.** The default monitor is non-fair: under constant
  contention a waiter can starve (Section 11.2).

The rule that follows: synchronize the smallest possible region that protects
the invariant — and prefer immutable state and `Atomic*` where the update is
simple.

### 7.2. AtomicInteger: hardware-assisted atomicity, no blocking

**Repository example:** `src/main/java/com/example/javalab/synchronization/AtomicIntegerExample.java`

```java
public class AtomicIntegerExample {

    private final AtomicInteger count = new AtomicInteger();

    public void increment() {
        count.incrementAndGet();
    }
}
```

**The mechanism — CAS, conceptually.** `AtomicInteger` relies on
compare-and-swap (CAS): a processor instruction that atomically does
"if the value is still X, replace it with Y; tell me whether I succeeded".
The JVM translates `incrementAndGet()` into a CAS loop: read the value,
compute the new value, CAS; if another thread changed the value in between,
the CAS fails and the loop retries.

```text
Thread A: read 5 → compute 6 → CAS(5 → 6)? yes → done
Thread B: read 5 → compute 6 → CAS(5 → 6)? no (A won) → retry with 6 → CAS(6 → 7)? yes
```

Two crucial consequences:

- **It is non-blocking.** A thread that loses the race does not sleep — it
  retries immediately. No context switch, no descheduling. Under light
  contention this is much cheaper than `synchronized`.
- **It is correct without blocking**, because the CAS instruction itself is
  atomic at the hardware level (with a JVM fallback where hardware support
  is unavailable). The exact mechanism is implementation-defined, but
  conceptually: *the hardware is the lock*.

The example also prints the other useful operations
(`get()`, `getAndIncrement()`, `addAndGet(n)`, `compareAndSet(exp, upd)`).

**Why AtomicInteger is not a replacement for every critical section.** An
atomic variable protects *one* value. If an operation involves:
- checking multiple values,
- modifying multiple objects,
- maintaining an invariant that spans fields,

one atomic variable is not enough. Example: transferring money between two
accounts needs both balances to change atomically; two separate `AtomicLong`s
can be observed mid-transfer. For compound invariants you need
`synchronized` or a lock — that is what mutual exclusion is *for*.

### 7.3. ReentrantLock: control, timeouts, and the finally rule

**Repository example:** `src/main/java/com/example/javalab/synchronization/LockExample.java`

`ReentrantLock` exists because `synchronized` is deliberately minimal: no
timeout, no fairness control, no conditions, no way to check availability
without blocking. `ReentrantLock` adds all of that:

- **Explicit lock/unlock** — the lock is a separate object with a lifecycle
  you control.
- **`tryLock(timeout)`** — attempt to acquire and give up after a deadline.
  This is the first defense against deadlock: a thread that cannot get the
  lock within a second can do something else instead of waiting forever.
- **Fairness** — `new ReentrantLock(true)` serves waiters in FIFO order,
  preventing starvation at the cost of some throughput.
- **Conditions** — precise wakeups: a thread can wait for a specific
  condition and be signaled only when it holds.
- **Reentrancy** — the same thread can acquire the lock again, which is
  required for methods that call each other while holding the lock.

The example demonstrates a lock-protected counter (always correct) and the
key trick:

```java
boolean acquired = held.tryLock(1, TimeUnit.SECONDS);
// thread B holds the lock for 3 s: main gives up after 1 s instead of blocking
```

**Actual output:** `tryLock = false (main did NOT wait for the holder - it moved on)`.
With `synchronized`, the same situation would block until the holder releases.

**The danger — the finally rule.** Because unlocking is explicit, it can be
skipped:

```text
lock()
  ↓
Exception
  ↓
unlock() never happens
```

A lock that is never released blocks every other thread forever. The rule:
acquire, use, and release in `finally` — always.

```java
lock.lock();
try {
    // critical section
} finally {
    lock.unlock();   // even when the body throws
}
```

**Trade-off vs synchronized:** `ReentrantLock` is more flexible but easier to
get wrong (forgotten unlock, missed reentrancy); `synchronized` is
error-proof by construction (release happens automatically on exit) but
inflexible. Prefer `synchronized` for simple sections; reach for
`ReentrantLock` when you need timeouts, fairness, or conditions.

### 7.4. volatile: visibility, NOT atomicity

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

`volatile` guarantees visibility and ordering only — every read sees the most
recent write. The three-step read-modify-write can still interleave between
threads. **Do not believe that `volatile` makes increments thread-safe — it
does not.**

**Part B — a non-volatile flag may never be seen.** A worker loops on a plain
`boolean keepRunning` while `main` sets it to `false` after 200 ms. The JIT
can hoist the field out of the loop (the compiler observes it is never written
*within the loop* and is free to assume single-thread semantics), so the write
is never observed. This part is deliberately nondeterministic — in the
recorded run it reproduced 0 out of 3 trials, while the escape hatch (a
`volatile boolean forceStop`) stopped the worker immediately every time. The
example always terminates, and its printed takeaway is the rule of thumb:

> `volatile` for flags and status; `AtomicInteger`/`AtomicLong` for counters
> and shared state; `synchronized`/locks for complex critical sections.

**Why the division exists:** each tool answers a different question from
Section 6. `volatile` answers "will my write be seen?" `Atomic*` answers
"is my read-modify-write indivisible?" Locks answer both, plus "can I
protect a compound invariant?" — at the cost of blocking.

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

## 8. Thread Pools: The Problem They Solve

**Repository example:** `src/main/java/com/example/javalab/threadpool/FixedThreadPoolExample.java`

### The problem: one thread per task does not scale

The naive design for 10,000 concurrent requests is:

```text
Incoming Tasks
     ↓
Create OS Thread
     ↓
Create OS Thread
     ↓
Create OS Thread
     ↓
...
```

Recall the cost structure of Section 3: each thread is a kernel operation,
a ~1 MB stack, and an entry in the scheduler's bookkeeping. Creating a thread
per task means:

- **Creation latency** on every request (milliseconds per thread, serialized
  through the kernel).
- **Memory** that scales with the request rate: 10,000 concurrent requests ≈
  10 GB of stacks.
- **Scheduler chaos**: with more runnable threads than cores, the CPU spends
  more time switching between threads than doing work.
- **No bound**: nothing prevents the thread count from growing until
  `OutOfMemoryError: unable to create native thread`.

### The solution: the pool as a resource-management mechanism

A thread pool is often described as "reusing threads". That undersells it.
A thread pool is a **resource management mechanism** with four jobs:

- **Reuse expensive execution resources** — workers are created once and live
  for years; tasks are cheap to submit.
- **Control concurrency** — the number of workers is a hard cap on how many
  tasks run at once. This is the concurrency dial.
- **Limit resource consumption** — bounded workers × bounded queue = bounded
  memory, regardless of the task arrival rate.
- **Manage overload** — when the pool is saturated, *something defined*
  happens (queueing, rejection) instead of silently allocating unbounded
  resources until the JVM dies.

```text
Tasks
  │
  ▼
Queue
  │
  ▼
Worker Pool
 ┌───────────────┐
 │ Worker 1      │
 │ Worker 2      │
 │ Worker 3      │
 └───────────────┘
```

### Example: Fixed Thread Pool

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

**Under the hood:** `Executors.newFixedThreadPool(n)` is a shortcut for
`ThreadPoolExecutor(n, n, 0L, MILLISECONDS, new LinkedBlockingQueue<>())` —
the constructor is the real API, the factory methods are sugar. Notice what
the shortcut hides: an **unbounded** queue. That single detail determines the
pool's behavior under overload (Section 9).

**Production impact:** the default `Executors` shortcuts are a known source
of production incidents — `newFixedThreadPool` and `newSingleThreadExecutor`
queue without bound (memory growth), `newCachedThreadPool` creates a thread
per task (no bound on threads). Production pools are built with the full
`ThreadPoolExecutor` constructor so that every knob is explicit and every
resource is bounded.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.threadpool.FixedThreadPoolExample
```

Expected observation: all 10 tasks run on 3 reused workers; the printed
"inside the box" note explains why a fixed pool is fixed.

---

## 9. The Pipeline: Core, Queue, Max, Rejection

**Repository examples:** `src/main/java/com/example/javalab/threadpool/ThreadPoolExecutorExample.java`, `src/main/java/com/example/javalab/threadpool/BoundedQueueExample.java`, `src/main/java/com/example/javalab/threadpool/RejectedExecutionExample.java`, `src/main/java/com/example/javalab/practical/GracefulShutdownExample.java`

### The decision process for every new task

`ThreadPoolExecutor` does not accept a task the way you might expect
("if a worker is free, run it; otherwise queue it"). It follows a fixed
four-step algorithm, and **the order of the steps is the design**:

```text
New Task
   │
   ├── Fewer than core threads?
   │        └── Create worker
   │
   ├── Queue has capacity?
   │        └── Put task in queue
   │
   ├── Fewer than maximum threads?
   │        └── Create additional worker
   │
   └── Otherwise
            └── Reject task
```

The crucial subtlety: **the queue is consulted *before* the pool grows past
core size.** The pool prefers to buffer work in the queue, and only grows
extra workers when the queue is full. Consequence: with an unbounded queue,
`maximumPoolSize` is dead configuration — the pool never grows past core
size, and tasks pile up in memory forever. **Increasing `maximumPoolSize`
does not necessarily increase concurrency when an unbounded queue is used.**

The example configures every knob — core=2, max=4, bounded queue of capacity
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

**Why this order matters:** the queue is the pool's *buffer* — it absorbs
short bursts. Core threads are the *steady-state* capacity; extra threads
(core→max) are the *burst* capacity, engaged only when the buffer overflows.
The algorithm deliberately prefers buffering over spawning, because worker
threads are the expensive resource; a queue slot is cheap.

### Backpressure: a queue does not remove overload

This is the key idea of the whole section:

> **A queue does not remove overload. It stores overload somewhere.**

An unbounded queue does not reject anything — it makes overload *invisible*
until it is too late:

```text
Unbounded Queue
     ↓
More waiting tasks
     ↓
More memory usage
     ↓
Longer latency
     ↓
GC pressure
     ↓
Potential failure (OOM / total stall)
```

The `BoundedQueueExample` demonstrates the difference with two identical
pools (core=2/max=4) and 6 sleeping tasks — the only difference is the queue
type:

```
A) UNBOUNDED queue (LinkedBlockingQueue) - what newFixedThreadPool uses
   -> poolSize=2 queueSize=4 (max=4 was NEVER reached!)

B) BOUNDED queue (ArrayBlockingQueue capacity=2)
   -> poolSize=4 queueSize=2 (pool grew to 4)
```

With an unbounded queue, `maximumPoolSize` never engages — the queue *is* the
real limit, and tasks accumulate in memory. A bounded queue forces the pool
to engage extra threads, then the rejection policy. **The bounded queue is
how a pool participates in backpressure:** it can only buffer so much, and
beyond that the producer is told "no".

### Rejection policies: what "no" means

When the pool is saturated, the rejection policy decides what happens to the
task. The example runs the same sequence (core=1, max=2, queue capacity=1,
four submissions) with `AbortPolicy` and `CallerRunsPolicy`:

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

**Under the hood of `CallerRunsPolicy`:** the submitting thread itself
executes the task, so the producer automatically slows down to the consumer's
speed — the rejection mechanism *is* the backpressure mechanism. This is why
it is the production favorite: instead of throwing an error, the system
throttles itself.

### Shutting down: the lifecycle you must not skip

A pool's threads are non-daemon by default: a pool that is never shut down
keeps the JVM alive forever — in an application server that is intentional
(the pool lives for the app's lifetime), but in a batch job or a test it is a
leak that hangs the process. The correct shutdown sequence, demonstrated with
8 tasks × 2 s on 3 threads and an 800 ms deadline:

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

**Why the three-phase sequence exists:** `shutdown()` stops the *inbound* —
no new tasks accepted, but queued work still runs. `awaitTermination(deadline)`
gives in-flight work a chance. `shutdownNow()` interrupts the *outbound* —
running tasks get the interrupt flag, queued tasks are returned. A well-behaved
task treats the interrupt as "the system is shutting down: release sockets,
roll back, exit". Respecting the interrupt flag is what makes graceful
shutdown work in production (Spring/Quarkus call this sequence for you).

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.threadpool.ThreadPoolExecutorExample
java -cp target/classes com.example.javalab.threadpool.BoundedQueueExample
java -cp target/classes com.example.javalab.threadpool.RejectedExecutionExample
java -cp target/classes com.example.javalab.practical.GracefulShutdownExample
```

Expected observations: submissions 7–9 are rejected in
`ThreadPoolExecutorExample` (that is deterministic — the workers are still
busy); the unbounded queue never grows the pool; `CallerRunsPolicy` executes
all 4 tasks; `GracefulShutdownExample` prints the same 3/3/5 split.

---

## 10. Performance: When More Threads Make Things Slower

**Repository examples:** `src/main/java/com/example/javalab/performance/CpuBoundThreadExample.java`, `src/main/java/com/example/javalab/performance/IoBoundThreadExample.java`, `src/main/java/com/example/javalab/performance/TooManyThreadsExample.java`

### The mechanism: what a context switch costs

A platform thread runs on a core for a while, then the scheduler swaps it
out for another runnable thread. The swap is called a **context switch**, and
it is not free:

```text
Context switch
   │
   ├── Save thread A's state (registers, PC, stack pointer)
   ├── Scheduler bookkeeping (run queue, priorities)
   ├── CPU caches / TLB pollution (the new thread's data displaces A's)
   └── Restore thread B's state and resume it
```

On a machine with fewer cores than runnable threads, the CPU spends a
percentage of its cycles on switching instead of working — that overhead is
**invisible until it is measured**. Worse, the cache pollution is
superlinear: a thread whose data used to live in L2/L3 must reload it from
memory, at 50–100× the speed of a cache hit.

The first principle that follows:

> **The correct thread count is the number that keeps cores busy — never
> blindly add threads to go faster.**

### CPU-bound: parallelism is bounded by cores

**Repository example:** `CpuBoundThreadExample`

Work that never blocks — pure calculation — can only use as many cores as
exist. Each task performs 25 million integer operations; the example runs
the same workload with 1, 12, 48 and 192 threads on a 12-core machine.

**Actual output (12-core, JDK 21):**

```
12 threads:  ~49 ms    <- sweet spot
1 thread:    ~262 ms
48 threads:  ~52 ms
192 threads: ~49 ms
```

**Actual output (24-core, JDK 21):**

```
24 threads:  ~57 ms    <- sweet spot
1 thread:    ~250 ms
96 threads:  ~53 ms
384 threads: ~53 ms
```

**What the numbers say:** going from 1 → 12 threads gives the full
parallelism win (the 5× here — less than 12× because of shared memory
bandwidth, memory contention and scheduler overhead). Beyond 12 threads the
workload does not get faster: it cannot. The core count is the ceiling. On a
12-core machine the pool "should be sized at ~12 for CPU-bound" — the recorded
run confirms it.

**The pattern is not an accident:** CPU-bound work scales only until the
core count, then plateaus — and later *degrades* as switching overhead grows.
This is why the pool-size rule of thumb exists:

> CPU-bound: `cores` (usually `cores + 1` to cover hiccups).
> I/O-bound: many more threads than cores — but the exact number depends on
> the blocking ratio (Section 2.2): `cores × (1 + wait/calculate)`.

### I/O-bound: threads are cheap, waiting is expensive

**Repository example:** `IoBoundThreadExample`

The example simulates I/O-bound work with 50 ms of sleep per task. The
blocking ratio is extreme: 25 ms calculate + 50 ms wait = 2/3 of the time
waiting. The machine has 12 cores — and the optimal thread count is ~10×
that.

**Actual output (12-core, JDK 21):**

```
1 thread:   ~5991 ms  (~20 tasks/s)
12 threads: ~503 ms   (~239 tasks/s)
96 threads: ~101 ms   (~1188 tasks/s)
120 threads:~67 ms    (~1791 tasks/s)   <- best
```

**What the numbers say:** 120 threads beat 12 threads ~7× on a 12-core
machine. Each thread spends most of its time sleeping (blocked, consuming
zero CPU); 12 cores are enough to run the tiny bursts of calculation, and
the extra threads simply fill the gaps between sleeps. Concurrency is
~10× cores because of the blocking ratio.

**Production impact:** sizing an I/O pool is not "pick a big number". The
number is `cores × (1 + wait/calculate)` — and `wait` is *the* variable you
can control. Change the API call from 50 ms to 5 s and the correct pool size
jumps 100×. Revisit pool sizes when latency changes.

### Too many threads: the measured case

**Repository example:** `TooManyThreadsExample`

This example measures what oversubscription *actually* does. 4, 64, 400 and
800 platform threads each spin on CPU for 1.5 seconds of wall-clock work on a
12-core machine.

**Actual output (12-core, JDK 21):**

```
4 threads:   ~1089 ms
64 threads:  ~167 ms
400 threads: ~212 ms
800 threads: ~205 ms
```

**What the numbers say:** 4 threads finish in 1.09 s (0.4 s of pure switching
and scheduling overhead); 64 threads finish faster — but 400 threads are
*slower* than 64 (167 ms → 212 ms), and 800 threads do not recover. The extra
threads do not add work — the CPU is fully utilized at 64; they add *switching
overhead*: more runnable threads than cores means the scheduler cycles through
them, and every cycle is a context switch.

This is the "when more threads make things slower" proof: **oversubscription
has a cost, and it is not imaginary.** The performance cliff is the difference
between "enough threads to keep cores busy" and "enough threads to saturate
the scheduler".

### What Is the Bottleneck? — the recurring check

```text
CPU-bound task   → bottleneck is the CPU   → thread count ≈ cores
I/O-bound task   → bottleneck is the I/O   → thread count >> cores
Too many threads → bottleneck is the scheduler → thread count is the problem
```

Every performance example in this course answers the same question: *what is
the bottleneck?* Find it first — thread count is a decision, not a number.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.performance.CpuBoundThreadExample
java -cp target/classes com.example.javalab.performance.IoBoundThreadExample
java -cp target/classes com.example.javalab.performance.TooManyThreadsExample
```

Expected observations: your numbers differ, but the shapes are stable —
CPU-bound plateaus at the core count; I/O-bound peaks well above it; the
too-many-threads case degrades after oversubscription. Ignore exact
milliseconds.

---

## 11. Common Failures: The Production Horror Stories

**Repository examples:** `src/main/java/com/example/javalab/problems/DeadlockExample.java`, `StarvationExample.java`, `ThreadPoolExhaustionExample.java`, `ThreadLocalLeakExample.java`, `LostExceptionExample.java` and `src/main/java/com/example/javalab/problems/BlockingSharedPoolExample.java`

### 11.1. Deadlock: the Coffman conditions

**Repository example:** `DeadlockExample`

```java
class Chopstick {
    private final String name;
    synchronized void use(Chopstick other, String philosopher) {
        System.out.println(philosopher + " picked up " + name);
        sleepQuietly(200);          // simulate holding
        other.use(this, philosopher);  // acquire the second stick
        // ...eating...
    }
}
```

Two threads, two shared locks, crossed acquisition order. Every philosopher
picks up their left chopstick, pauses to *think* (the sleep is crucial: it
gives the other thread time to grab the second chopstick), then waits for the
right one. Deadlock.

**Actual output:** after a few cycles of eating, the program hangs forever —
both philosophers hold one chopstick and wait for the other's. The example
drops a hint in the output: `Pausing for 5 seconds to prove deadlock...` and
then announces it. **No error is thrown — the program simply stops.**

**Why it happens — the Coffman conditions.** For deadlock, four conditions
must hold simultaneously:

```text
1. Mutual Exclusion     - the resources (chopsticks) are exclusive
2. Hold and Wait        - each thread holds one, waits for the other
3. No Preemption        - a held resource cannot be forcibly taken
4. Circular Wait        - A waits for B, B waits for A
```

**Under the hood:** every `synchronized` block is a monitor; the monitor has
an owner and a blocked-queue of waiters. When both threads block on the
second monitor, neither can proceed — no timeout in `synchronized` can save
them (this is exactly what `ReentrantLock.tryLock` is for).

**How to fix it — break any one condition:**

- **Break Circular Wait: acquire locks in a global order.** Make all threads
  take lock A before lock B (e.g. always pick up the *lower-numbered*
  chopstick first). This is the standard fix: a total ordering on locks
  guarantees no cycle can form.
- **Break Hold and Wait: acquire all resources atomically**, or
  try-lock-with-timeout and release what you already hold on failure.
- **Break No Preemption:** `tryLock(timeout)` + back off.
- **Detect and recover**: thread dumps (`jstack <pid>`) show the blocked
  state and the wait chain. In production, deadlocks are diagnosed from the
  dump, not predicted.

**Production impact:** deadlocks are the "no error" failure: the service just
stops responding, threads pile up in BLOCKED, requests time out from the
client's side. The most common real cause is *inconsistent lock ordering*
across code paths — the rule "always acquire in the same order" is cheap and
prevents the worst class of failure.

### 11.2. Starvation: the opposite of fairness

**Repository example:** `StarvationExample`

Deadlock's quieter sibling. Three threads compete for one lock with a simple
update; the greedy thread holds the lock ~95% of the time via
`synchronized`'s default non-fairness.

```java
while (true) {
    synchronized (lock) {        // greedy: acquires, updates, releases
        count++;
    }
}
```

**Actual output:** `greedy` is updated 955,386 times; the other two combined
6,854 — the latter may show zero updates in a particular run. The workers are
not deadlocked: they are **alive but not progressing**.

> The greedy thread can starve the others by acquiring the monitor
> repeatedly; under sustained contention `synchronized` makes no fairness
> promise (the JVM may reacquire for the just-released holder), so waiters
> can be overtaken indefinitely. The fix: `ReentrantLock(true)` (fair
> mode) or careful critical-section sizing.

**Production impact:** starvation shows up as "some requests never complete,
but the system looks healthy". The counter runs are microscopic in the
recorded output (the greedy thread is ~140× ahead) — the principle is what
matters: **a lock does not guarantee progress for everyone, only exclusion
for the holder.**

### 11.3. Thread pool exhaustion: the cascade

**Repository example:** `ThreadPoolExhaustionExample`

A pool of 1 thread. Task 1 is fast (~211 ms in the recorded run); tasks 2–10
are slow (2 s each). Expected total: ~18 s.

**Actual output:**

```
Task 1 completed: ... 211 ms
... (2–10 complete one by one) ...
ALL 10 tasks completed. Total time: ~18 seconds
```

**Why it happens — the cascade:**

```text
One task blocks the pool
        ↓
All other tasks wait in the queue
        ↓
Service latency climbs to the slowest task
        ↓
New requests queue behind
        ↓
Larger requests queue → memory pressure
        ↓
Other services that call this one time out
        ↓
They retry → their pools fill with retries
```

The single slow task (or worse, a task that **blocks forever** — a remote
call without a timeout is the classic) becomes the availability of the whole
service. The queue holds the failure.

**Production impact — the feedback loop:** when one component slows, its
callers' threads block waiting, their pools fill, their callers' pools fill
in turn — a *cascade* that takes down an entire distributed system. The
defenses are the resource-management ideas of this course, applied together:
**bounded pools (Section 9), timeouts on every remote call (a task that can
block must be able to give up), and rejection policies (exhaustion should
fail fast, not pile up).**

### 11.4. ThreadLocal: the pooled-thread memory leak

**Repository example:** `ThreadLocalLeakExample`

A pooled thread *is a long-lived object* — and `ThreadLocal` values are
attached to threads. Combine the two and a single careless `set()` becomes a
memory leak that is invisible for a long time.

The example uses a **thread pool of 4 threads** (not 4 raw threads!) and a
`ThreadLocal<HashMap<Long, byte[]>>` accumulator:

- **Phase 1:** tasks save "session data" per task — one heap buffer per task.
  Because threads are reused, the maps are never cleared.
- **Phase 2:** new tasks *do not* set the ThreadLocal anymore — they call
  `session.get()`.

**Actual output:**

```
Phase 1: memory leaked as tasks saved data per task (grew continuously)
Phase 2: session.get() → STALE data from previous tasks (threads were reused!)
```

**The mechanism:** `ThreadLocal` storage is owned by the thread object. A
pool thread runs task A, keeps A's value, then runs task B — B's `get()`
returns *A's value*. That is both the leak (the value never dies with the
task) and the correctness bug (tasks see each other's data).

```text
ThreadLocal value (e.g. a large session buffer)
        ↓
Stored inside the pooled thread object
        ↓
Thread is reused for the next task
        ↓
Value survives; next task reads it (or it is never freed)
```

**The fix — remove explicitly:**

```java
try {
    // work with session
} finally {
    session.remove();   // mandatory: pooled threads are reused
}
```

**Why this is not a problem in "normal" (unpooled) code:** a plain
`new Thread(runnable)` starts, runs once, and dies; the thread's death
reclaims its ThreadLocals. The leak exists *because* of reuse. The moment you
introduce pooling, every ThreadLocal becomes a lifecycle responsibility —
`remove()` in `finally`, or the value outlives its task and contaminates the
next one.

### 11.5. Lost exceptions: the silent failure

**Repository example:** `LostExceptionExample`

With `submit()`, the exception inside a task does not propagate
automatically:

```java
pool.submit(() -> {
    throw new RuntimeException("Something went wrong in the task!");
});
```

**Actual output:**

```
LOST!!! The main thread did NOT see the exception:
- The task failed silently
- The call is still in the queue
- The Future returned by submit() holds the exception
  - future.get() rethrows ExecutionException (the wrapper)
```

**The mechanism:** `submit()` returns a `Future`; the exception is stored
*inside the future* to be delivered on `get()`. Nobody calls `get()` → the
failure vanishes. The shutdown line (`pool.shutdown()`) reveals the leak:
the rejected `Future` still references the failed task's exception.

**Production impact:** this is how "the job just stops producing, no error in
the logs" happens. The fixes:

- `future.get()` — and handle `ExecutionException` (always unwrap to find
  the cause).
- `execute()` instead of `submit()` for fire-and-forget tasks: the
  exception propagates to the uncaught exception handler.
- A rejected-execution handler or a wrapper task that logs.
- `CompletableFuture.exceptionally(...)` chains that record failures.

### 11.6. Blocking a shared pool: the domino effect

**Repository example:** `src/main/java/com/example/javalab/problems/BlockingSharedPoolExample.java`

The most "invisible" failure of them all. One shared pool (4 threads) runs
*all* tasks — both a fast order-processing task and a slow task that depends
on another service (simulated with 100 ms sleeps). The slow task takes the
whole pool, and the fast tasks starve behind it.

**The BAD design (shared pool):**

```text
All Tasks
     ↓
Shared Pool (4 threads)
     ↓
Order Task ... Order Task ... External Call Task (100 ms) ...
     ↓
The slow task occupies workers; order tasks wait
```

**Actual output (BAD — shared pool):**

```
fast order task completed: 1904 ms
fast order task completed: 1908 ms
fast order task completed: 1914 ms
fast order task completed: 1917 ms
(and further fast tasks suffer the same delay)
```

**The GOOD design (separate pools):**

```text
Order Tasks            Slow Tasks
     ↓                      ↓
Order Pool (2)      External Call Pool (2)
     ↓                      ↓
Each pool is small; the slow pool cannot starve the fast one
```

**Actual output (GOOD — separate pools):**

```
fast order task completed: 6 ms
fast order task completed: 5 ms
fast order task completed: 5 ms
fast order task completed: 5 ms
(no interference between the pools)
```

**The mechanism — tail latency:** with a shared pool, the slow task's 100 ms
becomes the *floor* for every other task that shares the pool. The fast task
that could finish in 6 ms waits 1900 ms because it is queued behind the slow
one. This is the **tail-latency amplification** of pooling: one slow
downstream dependency slows every unrelated request.

**Production impact — this is the most common real-world pool bug.** The fix
is not "more threads in the shared pool" — it is **isolation: separate pools
for workloads with different latency profiles** (one for fast in-memory work,
one for slow external calls). Same resource idea as a bulkhead in a ship: a
hole in one compartment sinks only that compartment.

**The failure taxonomy is now complete — every "production horror story"
reduces to a resource-management problem: unbounded resources (exhaustion,
leaks), shared resources without isolation (starvation, cascades, tail
latency), or resources acquired in the wrong order (deadlock).**

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.problems.DeadlockExample
java -cp target/classes com.example.javalab.problems.StarvationExample
java -cp target/classes com.example.javalab.threadpool.ThreadPoolExhaustionExample
java -cp target/classes com.example.javalab.problems.ThreadLocalLeakExample
java -cp target/classes com.example.javalab.problems.LostExceptionExample
java -cp target/classes com.example.javalab.problems.BlockingSharedPoolExample
```

Expected observations: `DeadlockExample` hangs (that is the demonstration —
press Ctrl+C); starvation counts vary; exhaustion takes ~18 s; the ThreadLocal
leak prints stale phase-2 data; `LostExceptionExample` shows the swallowed
error; `BlockingSharedPoolExample` shows the ~1900 ms vs ~6 ms contrast.

---

## 12. Virtual Threads: The Solution to the Scaling Problem

**Repository examples:** `src/main/java/com/example/javalab/virtualthread/BasicVirtualThreadExample.java`, `src/main/java/com/example/javalab/virtualthread/VirtualThreadExecutorExample.java`, `src/main/java/com/example/javalab/virtualthread/PlatformVsVirtualThreadExample.java`

### The problem restated

Sections 8–11 built an uncomfortable picture:

- Platform threads are expensive (kernel objects, ~1 MB stacks).
- Pools bound them — but pools introduce queueing, rejection, exhaustion,
  tail latency, isolation problems.
- Pool sizing is a fragile manual tuning exercise (`cores × (1 + wait/calc)`,
  with every knob a landmine).
- Blocking calls inside a pool *are* the pool's failure mode.

All of this exists because of one property of platform threads: **a blocked
platform thread occupies an OS resource — a slot that costs ~1 MB of memory
and a scheduler entry.** When a thread waits on I/O, the *resource* waits with
it. Virtual threads were designed to make "waiting" cheap: **a virtual thread
is a normal Java thread whose underlying OS thread is released while it
waits.**

### The architecture: what changes under the hood

```text
Platform thread = 1 Java thread ↔ 1 OS thread
                    (1:1 mapping, Section 3)

Virtual thread  = 1 Java thread ↔ 1 OS thread ONLY WHILE RUNNING
                    (many virtual threads share few OS threads)
```

Virtual threads are **carried** by platform threads:

```text
Carrier Platform Threads (e.g. 8)
        ↓ carries
Virtual Thread A ── running ──► I/O call ──► BLOCKED
Virtual Thread B ── running ──► I/O call ──► BLOCKED
Virtual Thread C ── ready ──► I/O call ──► BLOCKED
Virtual Thread D ── ready ──► I/O call ──► BLOCKED
...
```

When a virtual thread executes a blocking operation, the runtime **unmounts**
it: its stack is saved (in heap memory, as part of the thread object) and the
carrier thread is freed to run another virtual thread. When the I/O completes,
the virtual thread is **remounted** onto a carrier.

**Under the hood — the mechanics are conceptual:** in a typical JVM the
blocking call on the carrier is detected, the virtual thread's stack is
copied to the heap, and the carrier returns to the scheduler pool — the
operation that once consumed a 1 MB OS thread now consumes a small heap
buffer. The exact implementation (stack copying, the Continuation
machinery, scheduler details) varies by JVM; the observable contract is:
**a blocked virtual thread does not pin or consume an OS thread.**
Two consequences follow directly:

- **You can create many more of them** — they cost heap, not kernel memory.
- **The pool-sizing math disappears for the I/O case** — "one virtual thread
  per task, no pool, no tuning" is the design goal (Section 14 explains the
  one remaining caveat).

### Creating virtual threads

**Repository example:** `BasicVirtualThreadExample`

```java
// 1) Thread.ofVirtual()
Thread vThread = Thread.ofVirtual()
        .name("vt-", 0)              // named, numbered
        .unstarted(() -> {           // not started until we call start()
            System.out.println(Thread.currentThread().getName());
        });
vThread.start();

// 2) Thread.startVirtualThread(runnable)
Thread started = Thread.startVirtualThread(() ->
        System.out.println("Started: " + Thread.currentThread().getName()));

// 3) Executors.newVirtualThreadPerTaskExecutor()
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
```

**Actual output:**

```
Running in: virtual thread: vt-0
Started: virtual thread: started-thread
virtual per task executor: virtual thread: vExecutor-1
```

**The naming is a diagnostic gift:** `virtual thread: ...` in the name tells
you instantly (in logs, dumps, profilers) whether a task is running on a
virtual thread. `Thread.currentThread().getName()` returns exactly that.

**The most important line in the example:**

```
I am virtual: true
```

**The per-task executor:** `Executors.newVirtualThreadPerTaskExecutor()` is
the modern replacement for `newFixedThreadPool` in the I/O case. It creates a
*new virtual thread for every task* — there is no pool to size, no queue, no
rejection. The example submits 20 sleeping tasks and prints max parallelism
(`newVirtualThreadPerTaskExecutor().getMaximumPoolSize() = Integer.MAX_VALUE`):

**Actual output:** `maximum pool size of the v-executor: 2147483647` — the
"pool size" is unbounded because the whole point is: threads are cheap now.

**Production impact:** for I/O-bound workloads this deletes an entire class
of production failures — exhaustion, tail latency, isolation, pool sizing.
"One thread per task, no tuning" is the new default for I/O work.

### Platform vs Virtual threads: the measured case

**Repository example:** `PlatformVsVirtualThreadExample`

1,000 tasks × 50 ms sleep, run twice — once on platform threads (10 at a
time), once with virtual threads.

**Actual output (JDK 21):**

```
Platform threads: 1,000 tasks * 50ms sleep -> 2108 ms (10 threads)
Virtual threads:  1,000 tasks * 50ms sleep -> 54 ms
```

**What the numbers say:** the virtual version is ~39× faster because 1,000
virtual threads *wait* on 10 carriers; the platform version waits on 10
threads *and* queues 990 tasks. Both are correct — but one of them blocked
threads, the other didn't.

**The second measurement is the scaling proof:**

**Actual output (JDK 21):**

```
Starting 100,000 virtual threads...
All 100,000 virtual threads finished! Elapsed: ~59 ms
```

100,000 virtual threads, created and destroyed in ~59 ms. Platform threads
would have needed 100,000 × ~1 MB of stack (≈ 97 GB) and thousands of kernel
objects; virtual threads cost heap frames. **The stacking of ~2,000 tasks per
core is not a problem to work around — it is the design.**

**When NOT to use virtual threads (and when to prefer platform threads):**

- **CPU-bound work** — virtual threads run *on* platform threads; they add no
  parallelism, only unmounting overhead. A CPU-bound pool should be
  `newFixedThreadPool(cores)`.
- **Pinned code** — a virtual thread that blocks inside `synchronized` or a
  native call **pins** its carrier (the JVM cannot unmount it). Locking
  frameworks that use `synchronized` for long sections lose the scaling
  benefit; prefer `ReentrantLock` there.
- **Fine-grained shared-state contention** — many virtual threads fighting
  over one monitor serialize exactly like platform threads, with extra
  scheduling overhead. Concurrency is still bounded by the lock, not the
  thread count.
- **Millions of long-lived threads with big per-thread state** — virtual
  threads are cheap, but not free; each stores its stack in heap.

**What the mental model becomes:**

> Platform threads: expensive execution slots — must be pooled and tuned.
> Virtual threads: cheap task carriers — one per task, no pool, for I/O.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.BasicVirtualThreadExample
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadExecutorExample
java -cp target/classes com.example.javalab.virtualthread.PlatformVsVirtualThreadExample
```

Expected observations: the executor's maximum pool size prints
2147483647; 1,000 sleeping tasks take ~54 ms on virtual threads vs ~2,100 ms
on 10 platform threads; 100,000 virtual threads finish in ~60 ms on a modern
machine.

---

## 13. Virtual Threads in Action: I/O and CPU Measured

**Repository examples:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadIoExample.java`, `src/main/java/com/example/javalab/virtualthread/VirtualThreadCpuBoundExample.java`

### 13.1. I/O-bound: virtual threads remove the pool math

**Repository example:** `VirtualThreadIoExample`

200 tasks, each sleeping 50 ms then *processing* for 25 ms (the same
calculate/wait ratio as `IoBoundThreadExample` — 2/3 blocking). Compared
against a fixed pool of 12 platform threads.

**Actual output (JDK 21):**

```
Platform threads (12): 4269 ms  (p95: 4070 ms)
Virtual threads:        67 ms   (p95: 58 ms)
```

**What the numbers say:** virtual threads finish ~64× faster. The platform
pool queues 200 tasks behind 12 workers (4269 ms ≈ 200/12 × 50 ms + 200 × 25
ms); virtual threads *start a thread per task* — no queue, no serialization.
The p95 confirms it: the *slowest* virtual task (58 ms) is faster than the
*fastest* platform one (4269 ms total).

**The production consequence:** this is the same experiment as Section 10's
I/O pool sizing — but with the tuning removed. No `cores × (1 + wait/calc)`,
no pool-size review when latency changes. The JVM absorbs the waiting.

### 13.2. CPU-bound: virtual threads do not make the CPU faster

**Repository example:** `VirtualThreadCpuBoundExample`

12 million integer operations, run with 12 virtual threads and 12 platform
threads on a 12-core machine — plus 48 virtual threads to prove the plateau.

**Actual output (JDK 21):**

```
12 virtual threads:  ~75 ms
12 platform threads: ~27 ms
48 virtual threads:  ~29 ms
```

**What the numbers say:** 12 virtual threads are ~3× *slower* than 12
platform threads (the unmounting machinery and heap-stack management add
overhead to compute-heavy work), and 48 virtual threads are not faster than
12 (they are already using all cores). Virtual threads add no parallelism —
they add unmounting overhead.

**The point is not "virtual threads are slow" — it is:**

> **Virtual threads answer the blocking problem, not the CPU problem.
> CPU-bound workloads still want `newFixedThreadPool(cores)`.**

**When a workload mixes both** (most real work does): keep CPU-heavy
sections off the virtual threads if they dominate, or accept the small
overhead — the I/O savings are 10–100× larger than the CPU cost.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadIoExample
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadCpuBoundExample
```

Expected observations: the I/O experiment shows virtual threads ~50–70×
faster; the CPU experiment shows platform threads equal or faster — and the
gap is small compared to the I/O one. Ignore exact numbers; keep the
shapes.

---

## 14. The Misconception: Virtual Threads Do Not Remove the Resource Limit

**Repository examples:** `src/main/java/com/example/javalab/virtualthread/VirtualThreadResourceLimitExample.java`, `src/main/java/com/example/javalab/practical/SemaphoreConcurrencyLimitExample.java`, `src/main/java/com/example/javalab/practical/ProducerConsumerExample.java`

### The trap

Virtual threads solve the *thread* bottleneck. There is still a bottleneck —
it just moved: **the bottleneck is now the external resource** (database
connections, HTTP clients, disk I/O, rate limits). And `newVirtualThreadPerTaskExecutor` removes the pool that used to be the concurrency dial.

**Concretely:** 100,000 virtual tasks, each doing an external call that can
handle only 20 concurrent connections. 100,000 tasks, all at once, all
blocked waiting for one of 20 connections. Nothing breaks — they just all
wait. **Unlimited threads do not mean unlimited throughput; they mean
unlimited waiting behind a finite resource.**

> **Virtual threads do not remove the resource limit. They move the
> bottleneck from the thread count to the external resource.**

### The measured case

**Repository example:** `VirtualThreadResourceLimitExample`

Three strategies to limit concurrency to 10 external calls at a time (each
simulated with a 10 ms sleep), over 100 tasks:

**Actual output (JDK 21):**

```
Strategy A (shared lock) : total 2304 ms, max concurrent = 10
Strategy B (Semaphore)   : total 2320 ms, max concurrent = 10
Strategy C (bounded pool): total 62 ms,   max concurrent = 400
```

**What the numbers say:** strategies A and B correctly cap concurrency at 10
(2300 ms ≈ 100/10 × 10 ms × 23 rounds) — the cap is what matters, not the
mechanism. Strategy C is a *comparison trap*: a shared fixed pool of 10
platform threads would also cap at 10 — but with virtual threads there is no
pool, so the cap must come from somewhere else.

**The mechanism — how the cap is actually enforced:**

```text
Semaphore (10 permits)
        ↓
Virtual task: tryAcquire()
        ↓
        ├── permit available → proceed with external call
        └── no permit → wait (on a cheap virtual thread, not a platform one)
```

The semaphore's 10 permits are the real concurrency limit; the virtual
thread's wait is the cheap part. The example's printed lesson is the
takeaway:

> **Limiting concurrency for virtual threads: Use Semaphore / rate limits /
> bounded connection pools. Do not rely on the executor's pool size — with
> virtual threads, it is effectively unlimited.**

### The resource-limit toolbox (when to use what)

| Mechanism | What it limits | Example |
| --------- | -------------- | ------- |
| `Semaphore(n)` | Concurrent *tasks* at a point | 20 permits for 20 DB connections |
| Bounded connection pool | DB / HTTP / socket connections | `HikariCP maximumPoolSize=20` |
| Rate limiter | Requests per second | API quotas |
| Bulkhead / separate executors | Failure isolation | one pool per downstream service |
| Backpressure / rejection | Incoming overload | bounded queue + `CallerRunsPolicy` |

**Production impact — the correct order of decisions:**

1. Fix the bottleneck *first* — it is an external resource, not threads.
2. Limit concurrency *to that resource's capacity* — `Semaphore`, connection
   pool, rate limit — and measure: if the resource can handle 20 connections,
   cap at ~20 (20 permits), not 10,000.
3. Use virtual threads for the *waiting*; use the limit mechanisms for the
   *resource*.
4. Keep timeouts on every external call — a hung call is now a hung virtual
   thread (cheap, but still a hung task occupying a permit).

### Guarding resources with Semaphore (the explicit version)

**Repository example:** `src/main/java/com/example/javalab/practical/SemaphoreConcurrencyLimitExample.java`

The same idea, demonstrated with explicit sleep-based work: 50 tasks, a
`Semaphore(10)`, 8 platform threads. The semaphore — not the thread count —
caps concurrent work at 10.

**Actual output (JDK 21):**

```
Semaphore-based limit: 3389 ms, max concurrent tasks: 10
```

**Why the semaphore belongs in front of the shared resource** (DB, HTTP
client), not just around a sleep: the point of the limit is that the
downstream resource has a finite capacity. `tryAcquire()`/`acquire()` in a
`finally`-released permit is the canonical pattern:

```java
try {
    semaphore.acquire();      // wait for a permit
    // guarded section: touch the limited resource
} finally {
    semaphore.release();      // always release
}
```

### The unbounded-tasks extreme: Producer–Consumer

**Repository example:** `src/main/java/com/example/javalab/practical/ProducerConsumerExample.java`

The final piece of the scaling story: virtual threads make "thousands of
tasks" so cheap that the coordination problem (Section 11's tail latency)
changes shape. 10 producers × 5 tasks each = 50 tasks, each doing a 50 ms
"HTTP call", into an `ArrayBlockingQueue(2)` — the consumers call
`take()` and sleep 10 ms per item.

**Actual output (JDK 21, sample — in-flight counts vary by run):**

```
All 50 tasks submitted. Task 42 completed.
Consumed: 46 of 50 produced (some are still in the queue / in flight)
```

**The production point:** with virtual threads the producers are effectively
free; the *queue and consumer speed* are now the only thing that determines
throughput. The final count varies because the last items are still in
flight when the main thread measures — the queue is doing its job (the
coordination mechanism), not the thread count.

## Try It Yourself

```bash
java -cp target/classes com.example.javalab.virtualthread.VirtualThreadResourceLimitExample
java -cp target/classes com.example.javalab.practical.SemaphoreConcurrencyLimitExample
java -cp target/classes com.example.javalab.practical.ProducerConsumerExample
```

Expected observations: Strategies A and B cap concurrency at 10; the
semaphore example caps at 10; the producer-consumer count is always ~46–50
but the exact number varies. The *limits* are deterministic — the final
in-flight count is not.

---

## 15. Final Mental Model

The whole course reduces to one sentence, repeated through every section:

> **A thread is a resource — and the bottleneck is never the thread count
> itself. It is what threads wait on.**

**The four questions (from the intro), answered:**

1. **Why do threads exist?** To overlap waiting (I/O, sleep, remote calls)
   with execution. If work never waited, one thread would be enough.
2. **Why do we pool them?** Because platform threads are expensive
   resources — pooling is resource management, not convenience. Every
   failure in Section 11 is a resource-management failure.
3. **Why do we count them?** Because concurrency ≠ parallelism: CPU-bound
   work peaks at the core count; I/O-bound work peaks at
   `cores × (1 + wait/calculate)`; too many threads add switching overhead
   (Section 10 measured all three).
4. **Why virtual threads?** Because waiting is the problem — and a virtual
   thread *unmounts* its OS thread while waiting. Threads become cheap
   enough to have one per task; the bottleneck moves to the external
   resource (Section 14).

**The final picture:**

```text
Your Code
   │
   ├── Platform threads  → pool them (core=max, bounded queue, sizing math)
   ├── Virtual threads   → one per task, no pool (I/O-bound work)
   │                         + Semaphore / rate limit / bulkhead
   │                         on the EXTERNAL resource
   ├── Shared state      → synchronized / Atomic* / locks
   │                         (atomicity, visibility, ordering)
   └── Failures          → diagnose via states, dumps, bounded resources,
                            lock ordering, isolation
```

**The decision checklist for a new piece of threaded code:**

| Question | Answer | Then |
| -------- | ------ | ---- |
| Is the work I/O-bound? | Yes | Virtual thread per task; cap the *resource*, not the threads |
| Is the work CPU-bound? | Yes | `newFixedThreadPool(cores)` |
| Is the task mixture uneven? | Yes | Separate pools / bulkheads |
| Does a remote call lack a timeout? | Yes | Fix it before anything else |
| Does a task block on a lock? | Yes | Check lock ordering; prefer `ReentrantLock` + `tryLock` |
| Is a ThreadLocal used in a pool? | Yes | `remove()` in `finally` |
| Could overload arrive? | Yes | Bounded queue + defined rejection policy |

---

## 16. The Code: Every Example in One Table

All 31 examples live in the repository
[`java-lab`](https://github.com/hungpt99-dev/java-lab) — clone it, run
`scripts/run-all.ps1` (Windows) or the Maven commands below, and see every
claim in this article reproduce on your machine. The repository is the
single source of truth: every number above comes from these files, and
nothing in the article claims behavior the code does not demonstrate.

| # | Example | Path | What it shows |
| - | ------- | ---- | ------------- |
| 1 | `CreateThreadExample` | `src/main/java/com/example/javalab/basics/CreateThreadExample.java` | Creating threads, naming, `currentThread()` |
| 2 | `RunnableExample` | `src/main/java/com/example/javalab/basics/RunnableExample.java` | `Runnable`, `ThreadFactory`, execution order |
| 3 | `JoinExample` | `src/main/java/com/example/javalab/basics/JoinExample.java` | `join()` as waiting-for-completion |
| 4 | `ThreadLifecycleExample` | `src/main/java/com/example/javalab/basics/ThreadLifecycleExample.java` | All six lifecycle states with a sampling thread |
| 5 | `RaceConditionExample` | `src/main/java/com/example/javalab/synchronization/RaceConditionExample.java` | The broken `count++` (Section 6) |
| 6 | `SynchronizedExample` | `src/main/java/com/example/javalab/synchronization/SynchronizedExample.java` | The `synchronized` fix (Section 7.1) |
| 7 | `AtomicIntegerExample` | `src/main/java/com/example/javalab/synchronization/AtomicIntegerExample.java` | CAS-based atomicity (Section 7.2) |
| 8 | `LockExample` | `src/main/java/com/example/javalab/synchronization/LockExample.java` | `ReentrantLock`, `tryLock`, `finally` rule (Section 7.3) |
| 9 | `VolatileExample` | `src/main/java/com/example/javalab/synchronization/VolatileExample.java` | Visibility vs atomicity (Section 7.4) |
| 10 | `FixedThreadPoolExample` | `src/main/java/com/example/javalab/threadpool/FixedThreadPoolExample.java` | The pool as resource management (Section 8) |
| 11 | `ThreadPoolExecutorExample` | `src/main/java/com/example/javalab/threadpool/ThreadPoolExecutorExample.java` | Core → queue → max → rejection flow (Section 9) |
| 12 | `BoundedQueueExample` | `src/main/java/com/example/javalab/threadpool/BoundedQueueExample.java` | Unbounded vs bounded queue (Section 9) |
| 13 | `RejectedExecutionExample` | `src/main/java/com/example/javalab/threadpool/RejectedExecutionExample.java` | Rejection policies (Section 9) |
| 14 | `CpuBoundThreadExample` | `src/main/java/com/example/javalab/performance/CpuBoundThreadExample.java` | The core-count plateau (Section 10) |
| 15 | `IoBoundThreadExample` | `src/main/java/com/example/javalab/performance/IoBoundThreadExample.java` | The blocking-ratio scaling (Section 10) |
| 16 | `TooManyThreadsExample` | `src/main/java/com/example/javalab/performance/TooManyThreadsExample.java` | Oversubscription cost (Section 10) |
| 17 | `DeadlockExample` | `src/main/java/com/example/javalab/problems/DeadlockExample.java` | Coffman conditions (Section 11.1) |
| 18 | `StarvationExample` | `src/main/java/com/example/javalab/problems/StarvationExample.java` | Non-fair locking (Section 11.2) |
| 19 | `ThreadPoolExhaustionExample` | `src/main/java/com/example/javalab/threadpool/ThreadPoolExhaustionExample.java` | The cascade (Section 11.3) |
| 20 | `ThreadLocalLeakExample` | `src/main/java/com/example/javalab/problems/ThreadLocalLeakExample.java` | Pooled-thread ThreadLocal leak (Section 11.4) |
| 21 | `LostExceptionExample` | `src/main/java/com/example/javalab/problems/LostExceptionExample.java` | Swallowed `submit()` exceptions (Section 11.5) |
| 22 | `BlockingSharedPoolExample` | `src/main/java/com/example/javalab/problems/BlockingSharedPoolExample.java` | The tail-latency domino (Section 11.6) |
| 23 | `BasicVirtualThreadExample` | `src/main/java/com/example/javalab/virtualthread/BasicVirtualThreadExample.java` | Creating virtual threads (Section 12) |
| 24 | `VirtualThreadExecutorExample` | `src/main/java/com/example/javalab/virtualthread/VirtualThreadExecutorExample.java` | The per-task executor (Section 12) |
| 25 | `PlatformVsVirtualThreadExample` | `src/main/java/com/example/javalab/virtualthread/PlatformVsVirtualThreadExample.java` | 1,000 tasks: 2108 ms vs 54 ms; 100k threads (Section 12) |
| 26 | `VirtualThreadIoExample` | `src/main/java/com/example/javalab/virtualthread/VirtualThreadIoExample.java` | I/O-bound: 4269 ms vs 67 ms (Section 13) |
| 27 | `VirtualThreadCpuBoundExample` | `src/main/java/com/example/javalab/virtualthread/VirtualThreadCpuBoundExample.java` | CPU-bound: virtual threads add no speed (Section 13) |
| 28 | `VirtualThreadResourceLimitExample` | `src/main/java/com/example/javalab/virtualthread/VirtualThreadResourceLimitExample.java` | Semaphore vs lock vs pool caps (Section 14) |
| 29 | `SemaphoreConcurrencyLimitExample` | `src/main/java/com/example/javalab/practical/SemaphoreConcurrencyLimitExample.java` | Guarding a shared resource (Section 14) |
| 30 | `ProducerConsumerExample` | `src/main/java/com/example/javalab/practical/ProducerConsumerExample.java` | Unbounded tasks, bounded queue (Section 14) |
| 31 | `GracefulShutdownExample` | `src/main/java/com/example/javalab/practical/GracefulShutdownExample.java` | `shutdown()` → `awaitTermination` → `shutdownNow()` (Section 9) |

### How to run everything

```bash
# 1. Clone
git clone https://github.com/hungpt99-dev/java-lab.git
cd java-lab

# 2. Build (requires JDK 21+)
mvn clean package

# 3. Run one example
java -cp target/classes com.example.javalab.virtualthread.PlatformVsVirtualThreadExample

# 4. Or run everything (Windows PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-all.ps1
```

The repository's `README.md`
([read it here](https://github.com/hungpt99-dev/java-lab/blob/main/README.md))
contains the full roadmap, and `docs/architecture.md` explains the package
structure. Every example prints a short explanation before it runs — run
them, break them, rerun them. The numbers in this article came from exactly
these files on a 12-core machine with JDK 21, and they will differ on yours —
the *shapes* (plateaus, cliffs, 39× gaps) will not.

---

## Conclusion

You started with a stack diagram and 10,000 requests. Here is the whole
journey in one paragraph:

Platform threads are expensive execution resources, so we pool them; pools
make concurrency explicit and bounded, so we tune them; the tuning requires
understanding what work waits on, so we measure context switches, blocking
ratios and oversubscription; the measurements expose the failures —
deadlocks, starvation, exhaustion, leaks, lost exceptions, tail latency —
all of them resource-management failures; and virtual threads remove the
worst of the resource math by making the *waiting* cheap, so the bottleneck
finally moves to what it always was: the database connections, the HTTP
timeouts, the rate limits — the external resources. Threads were never the
bottleneck. They were just the way we experienced it.

**The one thing to remember:** a thread is a resource — pool it, size it,
limit it, or virtualize it; but always ask *what is it waiting on?* That is
the question the whole course answers.

---






