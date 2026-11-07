---
title: "Java Threads and Concurrency: From CPU and Thread Pools to Virtual Threads"
description: "Some requests need CPU to parse JSON, hash or compress data. Some are waiting on a database. Some are waiting on an external HTTP API that answers a few hundred milliseconds later."
slug: "java-threads-va-concurrency-tu-cpu-thread-pool-den-virtual-threads"
locale: "en"
translationKey: "java-threads-va-concurrency-tu-cpu-thread-pool-den-virtual-threads"
pubDate: 2026-08-10T15:38:12+07:00
category: "Java & JVM"
tags: ["Java", "programming language", "thread", "concurrency"]
featured: true
draft: false
series: null
coverImage: "./cover.png"
readingTime: 21
---

Imagine a service receiving **10,000 requests at the same time**.

Some requests need CPU to parse JSON, hash or compress data. Some are waiting on a database. Some are waiting on an external HTTP API that answers a few hundred milliseconds later.

The first question is:

> **Should we create 10,000 threads?**

If not, why? And if Java Virtual Threads let you create hundreds of thousands or even millions of threads, why can't concurrency still grow without bound?

To answer that, look at the whole stack:

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
External Resources
(Database, API, Network, Files...)
```

Most concurrency problems are really one question:

> **Where is the real bottleneck?**

CPU? Database connection? HTTP API? Memory? Lock contention? Thread pool? Queue?

Adding threads only helps when it addresses the right bottleneck. Otherwise you just move the bottleneck somewhere else.

This article goes from fundamentals to production:

1. How do concurrency and parallelism differ?
2. What is a platform thread really?
3. Why isn't `count++` thread-safe?
4. How do `synchronized`, `Atomic*`, `Lock` and `volatile` differ?
5. How does a thread pool behave under overload?
6. Why do more threads sometimes make an application slower?
7. Common concurrency bugs in production.
8. What do Virtual Threads change?
9. Why do Virtual Threads still need concurrency limits?

The examples accompany the `java-lab` repository and run on Java 21+. The numbers in this article are sample results from those examples, not absolute benchmarks.

---

## Source Code & Examples

You can read the full article at:

https://java-guru.pages.dev/en/posts/java-core/java-threads-from-thread-pools-to-virtual-threads/

All examples in the article are implemented in the repository:

[java-lab — Thread Examples](https://github.com/hungpt99-dev/java-lab/tree/lab/thread?utm_source=chatgpt.com)

The repository contains practical examples of:

* Creating and managing `Thread`, `Runnable`, `Callable`, `join()`
* Thread lifecycle
* Race conditions and shared state
* `synchronized`, `AtomicInteger`, `ReentrantLock`, `volatile`
* `ThreadPoolExecutor`, bounded queues and rejection policies
* CPU-bound vs I/O-bound workloads
* Deadlock, starvation, thread pool exhaustion and `ThreadLocal` leaks
* Virtual Threads
* Limiting concurrency with `Semaphore`
* Producer–Consumer and backpressure
* Graceful shutdown

You can read the article alongside the source code to see each concept working in practice.

# 1. Why Do We Need Threads?

A sequential program runs like this:

```text
Task A
  ↓
Task B
  ↓
Task C
```

But a real backend usually has many requests in different states:

```text
Request A ── chờ database
Request B ── đang tính toán
Request C ── chờ HTTP API
Request D ── đọc file
```

If the program is fully sequential, the CPU can sit idle while one request waits on the database.

That is why threads exist:

> **To let other work continue while one piece of work is waiting.**

A CPU can execute billions of instructions per second, while a database or HTTP request can take a few milliseconds or a few seconds.

Threads help overlap that waiting time.

But threads are not free. They cost memory, scheduler work, context switching and, above all, shared mutable state.

So concurrency is always a trade-off:

```text
Nhiều concurrency hơn
        ↓
CPU ít bị bỏ phí hơn
        ↓
Nhưng nhiều shared state, scheduling và resource contention hơn
```

---

# 2. Concurrency and Parallelism

These two concepts are often used interchangeably.

## Concurrency

Multiple tasks **making progress in overlapping time windows**.

On a single CPU:

```text
Thread A: |--A1--|        |--A2--|        |--A3--|
Thread B:        |--B1--|        |--B2--|
```

The CPU does not necessarily run two tasks at the same time. It switches back and forth between them.

Concurrency is especially useful when tasks frequently wait on I/O.

## Parallelism

Multiple tasks genuinely running at the same moment on multiple CPU cores:

```text
Core 1: |------Task A------|
Core 2: |------Task B------|
```

The key point:

> **Concurrency hides waiting time. Parallelism exploits multiple CPU cores.**

Creating 1,000 threads on a 4-core machine does not create 1,000 units of parallel computation.

At most, only about 4 threads are actually running on the CPU at any moment. The rest are:

* waiting on I/O;
* waiting on a lock;
* sleeping;
* or waiting for the scheduler.

**Creating threads does not create more CPU cores.**

---

## 2.1 CPU-bound and I/O-bound

This is the first question to ask before designing concurrency.

### CPU-bound

The task spends most of its time computing:

* hashing;
* compression;
* encryption;
* image processing;
* heavy computation.

```text
[===== compute =====][===== compute =====]
```

The bottleneck is the CPU.

Adding threads only helps up to around the number of CPU cores.

### I/O-bound

The task spends most of its time waiting:

* database;
* HTTP API;
* file;
* network.

```text
[wait 95ms]
[work  5ms]
```

While Task A waits, the CPU can run Task B.

This is where concurrency pays off most.

A simple model:

```text
CPU-bound → giới hạn bởi số core
I/O-bound → giới hạn bởi latency và số tài nguyên bên ngoài
```

---

# 3. What Is a Platform Thread Really?

A Java platform thread is not just an object.

Conceptually:

```text
Java Platform Thread
        ↓
       JVM
        ↓
Native / OS Thread
        ↓
Operating System Scheduler
        ↓
CPU Core
```

A platform thread usually has an almost 1:1 relationship with an OS thread.

A thread needs:

* stack;
* program counter;
* register state;
* scheduling metadata;
* kernel resources.

So creating a great many platform threads is expensive:

```text
More threads
     ↓
More memory
     ↓
More scheduler work
     ↓
More context switches
     ↓
More cache disruption
```

That is why the following pattern does not scale well:

```java
new Thread(task).start();
```

for every request.

Three threads are no problem.

Three thousand or ten thousand threads can become a memory and scheduling problem.

---

## Runnable and Callable

`Runnable`:

```java
void run()
```

* returns no result;
* does not throw checked exceptions.

`Callable<V>`:

```java
V call() throws Exception
```

* returns a value;
* can throw exceptions.

Example:

```java
Callable<Integer> task = () -> {
    Thread.sleep(100);
    return 42;
};

ExecutorService executor = Executors.newSingleThreadExecutor();

try {
    Future<Integer> future = executor.submit(task);
    System.out.println(future.get());
} finally {
    executor.shutdown();
}
```

`Future.get()` blocks the caller until the result is ready.

One important detail:

> An exception inside the task can be stored in the `Future`.

If you submit a task but never check the `Future`, the failure can be silently dropped.

---

# 4. `start()` and `run()` Are Not the Same

```java
Thread thread = new Thread(task, "worker");

thread.run();
thread.start();
```

Those two lines mean completely different things.

## `run()`

It is just a normal method call:

```text
main
 ↓
run()
 ↓
task chạy trên main
```

## `start()`

It asks the JVM to create a new execution thread:

```text
main
 ↓
start()
 ↓
new thread
 ↓
JVM gọi run() trên thread mới
```

Example:

```java
Runnable task = () ->
    System.out.println(Thread.currentThread().getName());

Thread thread = new Thread(task, "new-thread");

thread.run();    // main
thread.start();  // new-thread
```

After `start()`, execution order becomes nondeterministic.

You cannot assume:

```text
A luôn chạy trước B
```

The scheduler decides that.

This is one of the reasons concurrency bugs are hard to reproduce:

> Code that is correct in one run is not necessarily correct under every interleaving.

---

# 5. Thread Lifecycle

Thread states matter a lot when reading a thread dump:

```text
NEW
 ↓ start()
RUNNABLE
 ├── BLOCKED
 ├── WAITING
 ├── TIMED_WAITING
 ↓
TERMINATED
```

## `NEW`

The thread has been created but `start()` has not been called.

## `RUNNABLE`

The thread is running or ready to run.

Important:

> `RUNNABLE` does not mean it is definitely running on a CPU.

It may be waiting for the scheduler to grant CPU time.

## `BLOCKED`

Waiting for a `synchronized` monitor.

```text
Thread A giữ lock
        ↓
Thread B cần lock đó
        ↓
Thread B → BLOCKED
```

## `WAITING`

Waiting for an event, with no timeout.

Example:

* `Object.wait()`;
* `Thread.join()`;
* `LockSupport.park()`.

## `TIMED_WAITING`

Waiting with a timeout:

* `Thread.sleep()`;
* `join(timeout)`;
* `await(timeout)`.

## `TERMINATED`

`run()` has finished, or the thread was terminated by an exception.

---

## Reading a thread dump

Thread state usually shows you where to debug:

```text
Nhiều BLOCKED
→ lock contention

Nhiều RUNNABLE
→ có thể CPU saturation

Nhiều WAITING/TIMED_WAITING
→ đang chờ queue, future hoặc external event
```

Thread states are not just theory.

They are one of the first tools you reach for when production hangs.

---

# 6. Race Condition: Why Is `count++` Wrong?

Suppose:

```java
private int count;

public void increment() {
    count++;
}
```

Many developers see a single statement.

The CPU sees:

```text
Read count
    ↓
Add 1
    ↓
Write count
```

Two threads can interleave:

```text
Thread A đọc 0
Thread B đọc 0

Thread A tính 1
Thread B tính 1

Thread A ghi 1
Thread B ghi 1
```

Expected:

```text
2
```

Actual:

```text
1
```

One increment was lost.

This is a **race condition**.

The dangerous part is that the bug does not happen every time.

One run may be correct.

The next may be wrong.

Production has more CPUs, more requests and more interleavings, so the bug surfaces more easily.

---

## 6.1 Three Different Problems in Concurrency

Thread safety is not a single problem.

There are at least three guarantees to distinguish:

### Atomicity

An operation is not broken into pieces that another thread can interleave with.

`count++` is not atomic.

### Visibility

Thread A writes data, but thread B may not see it in time without appropriate synchronisation.

### Ordering

The CPU and the JIT can reorder some operations as long as single-thread semantics still hold.

Therefore:

> A solution for visibility does not necessarily solve atomicity.

That is why you need to understand how `volatile`, `Atomic*` and locks differ.

---

# 7. Java Memory Model and Synchronization

The Java Memory Model defines when a change made by one thread becomes visible to another.

You do not need to memorise the entire specification.

A practical mental model is:

```text
Thread A view of memory
        ↕
Synchronization
        ↕
Thread B view of memory
```

Mechanisms such as:

* `synchronized`;
* `volatile`;
* `Atomic*`;
* `Lock`;

establish specific visibility and ordering rules.

The central concept is **happens-before**.

A simple example:

> Actions that happen before thread A releases a lock become visible to thread B after B acquires the same lock.

---

## 7.1 `synchronized`

```java
public synchronized void increment() {
    count++;
}
```

`synchronized` provides:

1. **Mutual exclusion** — only one thread enters the critical section.
2. **Visibility** — changes are synchronised between threads.

```text
Thread A
  ↓ acquire lock
modify shared state
  ↓ release lock
  ↓
Thread B
  ↓ acquire same lock
sees synchronized state
```

Drawbacks:

* lock contention;
* threads must wait;
* no timeout;
* no fairness guarantee.

The larger the critical section, the higher the contention.

So:

> Lock only the smallest region needed to protect the invariant.

---

## 7.2 `AtomicInteger`

```java
private final AtomicInteger count = new AtomicInteger();

public void increment() {
    count.incrementAndGet();
}
```

Conceptually it uses CAS:

```text
Read current value
      ↓
Compute new value
      ↓
Compare-And-Swap
      ↓
Failed? Retry
```

Example:

```text
A: CAS(5 → 6) → success
B: CAS(5 → 6) → failed
B: retry
B: CAS(6 → 7) → success
```

Advantages:

* suits simple state;
* no need for a large critical section;
* usually efficient under light contention.

But `AtomicInteger` is no substitute for a lock when you need to protect an invariant across multiple fields.

Example:

```text
Check account A
Check account B
Transfer money
Update A
Update B
```

This is a logical operation larger than a single atomic variable.

---

## 7.3 `ReentrantLock`

Use it when you need more control:

```java
lock.lock();
try {
    // critical section
} finally {
    lock.unlock();
}
```

`ReentrantLock` supports:

* `tryLock()`;
* timeout;
* fairness;
* conditions;
* explicit lock control.

Example:

```java
if (lock.tryLock(1, TimeUnit.SECONDS)) {
    try {
        // work
    } finally {
        lock.unlock();
    }
}
```

The most important point:

> Always `unlock()` in `finally`.

If an exception occurs and the lock is never released, other threads can wait forever.

Use `ReentrantLock` when you need a timeout or special control. For a simple critical section, `synchronized` is usually less error-prone.

---

## 7.4 `volatile`: Visibility, Not Atomicity

```java
private volatile int count;
```

This does **not** make:

```java
count++;
```

atomic.

It is still:

```text
read
add
write
```

`volatile` fits cases such as:

```java
private volatile boolean running = true;
```

One thread:

```java
while (running) {
    // work
}
```

Another thread:

```java
running = false;
```

Here the main issue is visibility.

A pragmatic rule:

```text
volatile
→ flags / visibility

Atomic*
→ atomic read-modify-write trên state đơn giản

synchronized / Lock
→ critical section và invariant phức tạp
```

---

# 8. Thread Pool: More Than Just Reusing Threads

A simple way to handle tasks is:

```java
new Thread(task).start();
```

But with 10,000 requests:

```text
10,000 tasks
    ↓
10,000 OS threads
```

This causes:

* thread creation cost;
* stack memory;
* scheduler overhead;
* context switching;
* risk of running out of native threads.

A thread pool solves it like this:

```text
Tasks
  ↓
Queue
  ↓
Worker Pool
```

A pool does four things:

1. Reuses worker threads.
2. Bounds concurrency.
3. Bounds resource consumption.
4. Defines behaviour under overload.

This is the important idea:

> **A thread pool is a resource management mechanism.**

Not just a convenience for running things asynchronously.

---

# 9. `ThreadPoolExecutor`: Core → Queue → Max → Reject

`ThreadPoolExecutor` handles a new task in this order:

```text
New Task
   │
   ├─ workers < corePoolSize?
   │      → create worker
   │
   ├─ queue has space?
   │      → enqueue
   │
   ├─ workers < maximumPoolSize?
   │      → create more workers
   │
   └─ otherwise
          → reject
```

This order matters enormously.

**The queue is checked before the pool grows from core to max.**

Example:

```java
new ThreadPoolExecutor(
    2,
    4,
    30,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(2),
    threadFactory,
    new ThreadPoolExecutor.AbortPolicy()
);
```

Tasks might flow like this:

```text
Task 1 → worker 1
Task 2 → worker 2
Task 3 → queue
Task 4 → queue
Task 5 → worker 3
Task 6 → worker 4
Task 7 → rejected
```

That is:

```text
core
  ↓
queue
  ↓
max
  ↓
rejection
```

---

## 9.1 An Unbounded Queue Is a Trap

With an unbounded queue:

```text
Tasks keep coming
      ↓
Queue keeps growing
      ↓
Memory increases
      ↓
Latency increases
      ↓
GC pressure
      ↓
Possible failure
```

A queue does not eliminate overload.

> **It just stores overload in memory.**

With an unbounded `LinkedBlockingQueue`, `maximumPoolSize` may almost never be used.

Tasks just keep going into the queue.

So production needs to think explicitly about:

* queue capacity;
* max threads;
* rejection policy;
* upstream backpressure.

---

## 9.2 Rejection Policy

When both the pool and the queue are full, the system has to decide what to tell the new task.

### `AbortPolicy`

```text
Reject
→ RejectedExecutionException
```

Suits a fail-fast approach.

### `CallerRunsPolicy`

The task runs on the submitting thread:

```text
Producer submits task
       ↓
Pool full
       ↓
Producer runs task itself
       ↓
Producer becomes slower
```

This is a form of natural backpressure.

### `DiscardPolicy`

Drops the task silently.

Usually dangerous, because data is lost and nobody knows.

---

## 9.3 Shutdown

An executor must have an explicit lifecycle:

```java
executor.shutdown();

if (!executor.awaitTermination(800, TimeUnit.MILLISECONDS)) {
    executor.shutdownNow();
}
```

What they mean:

```text
shutdown()
→ stop accepting new tasks

awaitTermination()
→ give current work time to finish

shutdownNow()
→ interrupt running tasks and return queued tasks
```

Interruption only works well if the task respects interruption.

A production shutdown is not just a "kill process".

Tasks need a chance to:

* close sockets;
* cleanup;
* rollback;
* release resources.

---

# 10. Performance: When More Threads Make the System Slower

A context switch is not free.

When the CPU switches from Thread A to Thread B:

```text
Save A state
   ↓
Scheduler bookkeeping
   ↓
Cache/TLB disruption
   ↓
Restore B state
   ↓
Continue B
```

If there are too many runnable threads:

```text
More threads
    ↓
More scheduling
    ↓
More context switches
    ↓
Less useful work
```

So:

> **The right number of threads is not the largest number. It is the number that keeps useful resources busy.**

---

## 10.1 CPU-bound

For a purely computational workload:

```text
1 thread
   ↓
slow

≈ number of cores
   ↓
maximum useful parallelism

far above cores
   ↓
little improvement or degradation
```

A pragmatic rule:

```text
CPU-bound pool ≈ number of CPU cores
```

Or sometimes `cores + 1`.

Adding 100 threads to a 12-core machine does not create 88 more cores.

---

## 10.2 I/O-bound

For a workload of:

```text
Compute: 5 ms
Wait:   95 ms
```

The thread spends most of its time not using the CPU.

So more threads than cores can be useful.

A common heuristic formula:

```text
threads ≈ cores × (1 + wait / compute)
```

But this is only a starting point.

If the external service's latency changes, the right number changes too.

So:

> Measuring the real workload matters more than trusting a formula absolutely.

---

## 10.3 Oversubscription

Too many runnable threads cause:

* scheduler overhead;
* context switching;
* cache disruption.

The shape of it:

```text
Too few threads
→ CPU idle

Enough threads
→ good utilization

Too many threads
→ scheduler becomes the bottleneck
```

This is why "increase the pool size to increase performance" sometimes makes things worse.

---

# 11. Common Concurrency Bugs in Production

## 11.1 Deadlock

The classic example:

```text
Thread A holds Lock 1
Thread A waits for Lock 2

Thread B holds Lock 2
Thread B waits for Lock 1
```

No exception.

No crash.

Just a hang.

Deadlock occurs when the four Coffman conditions hold at the same time:

1. Mutual Exclusion.
2. Hold and Wait.
3. No Preemption.
4. Circular Wait.

The most important defence:

> **Always acquire locks in the same global order.**

Example:

```text
Luôn Lock A trước
sau đó Lock B
```

Never:

```text
Code path 1: A → B
Code path 2: B → A
```

When debugging production, a thread dump is usually the most important tool.

---

## 11.2 Starvation

Deadlock means nobody makes progress.

Starvation means some threads still make progress, while others can be starved out.

Example:

```text
Greedy thread
→ repeatedly acquires lock

Other threads
→ repeatedly lose
```

`synchronized` does not guarantee fairness.

If fairness matters:

```java
new ReentrantLock(true)
```

may be appropriate, at a cost in throughput.

---

## 11.3 Thread Pool Exhaustion

A small pool with one long-blocking task:

```text
Slow task occupies worker
        ↓
Other tasks queue
        ↓
Latency increases
        ↓
More requests arrive
        ↓
Queue grows
        ↓
Memory pressure
        ↓
Timeouts
        ↓
Retries
        ↓
Cascading failure
```

This is why every external call should have a timeout.

No timeout means a thread can be occupied indefinitely.

Defences:

* timeout;
* bounded queue;
* rejection;
* bulkhead;
* concurrency limits.

---

## 11.4 `ThreadLocal` Leaks in a Pool

`ThreadLocal` is tied to the thread, not to the task.

In a pool:

```text
Worker runs Task A
→ ThreadLocal = A data

Worker reused for Task B
→ A data can still exist
```

Because workers live long, the data can:

* cause a memory leak;
* be seen by a later task;
* cause cross-request contamination.

The safe pattern:

```java
try {
    threadLocal.set(value);
    // work
} finally {
    threadLocal.remove();
}
```

Rule:

> A pooled thread gets reused, so ThreadLocal needs explicit cleanup.

---

## 11.5 Lost Exceptions

```java
executor.submit(() -> {
    throw new RuntimeException("failed");
});
```

The exception may be stored in the `Future`.

If you never call:

```java
future.get();
```

the failure may not be handled the way you expect.

Options:

* check the `Future`;
* handle exceptions in `CompletableFuture`;
* a wrapper with logging;
* use `execute()` when the semantics fit.

Don't assume that:

```text
task throws
→ chắc chắn có log
```

---

## 11.6 One Shared Pool for Everything

Suppose one pool handles:

* fast requests;
* background jobs;
* slow external API calls.

```text
All tasks
    ↓
Shared Pool
    ↓
Slow tasks occupy workers
    ↓
Fast tasks wait behind them
```

A task that should take 5 ms can take seconds simply because it is queued behind a slow dependency.

A better approach:

```text
Fast workload → Pool A
Slow external calls → Pool B
```

This is **bulkhead isolation**.

Don't let one slow dependency take over the system's entire execution capacity.

---

# 12. Virtual Threads: Making Blocking Cheap

A platform thread is expensive because it is tied to an OS thread.

Virtual threads change that.

The model:

```text
Platform Thread
Java Thread ↔ OS Thread
```

Whereas a virtual thread:

```text
Many Virtual Threads
        ↓
Scheduled on fewer Carrier Threads
        ↓
OS Threads
```

When a virtual thread blocks on a supported blocking operation:

```text
Virtual Thread
    ↓
I/O blocks
    ↓
Virtual Thread is unmounted
    ↓
Carrier becomes available
    ↓
Another Virtual Thread runs
```

When the I/O completes:

```text
Virtual Thread
    ↓
Scheduled again
    ↓
Mounted on a carrier
    ↓
Continue
```

The key idea:

> **Virtual Threads do not make the CPU faster. They make waiting cheap.**

---

## 12.1 Creating a Virtual Thread

```java
Thread.startVirtualThread(() -> {
    // task
});
```

Or:

```java
Thread.Builder builder = Thread.ofVirtual();
```

Or:

```java
try (ExecutorService executor =
         Executors.newVirtualThreadPerTaskExecutor()) {

    executor.submit(task);
}
```

`newVirtualThreadPerTaskExecutor()` creates one virtual thread per task.

The new mental model for I/O:

```text
Platform threads:
limited execution slots
→ pool them

Virtual threads:
cheap task carriers
→ one task per thread
```

---

## 12.2 Virtual Thread vs Platform Thread

With many tasks that mostly `sleep()` or wait on I/O:

```text
Platform thread pool
→ limited workers
→ remaining tasks wait in queue

Virtual threads
→ one thread per task
→ tasks can all wait concurrently
```

That is why Virtual Threads are especially strong for:

* HTTP calls;
* database access;
* blocking network I/O;
* file I/O;
* RPC;
* request-per-task workloads.

---

# 13. Virtual Threads Do Not Make CPU-bound Work Faster

This is a common misunderstanding.

A virtual thread still needs CPU to run.

If the machine has 12 cores:

```text
12 CPU-bound tasks
→ can use ~12 cores

1,000 CPU-bound virtual threads
→ still share those same cores
```

Virtual Threads do not add parallelism.

For CPU-bound workloads, a fixed-size platform-thread executor sized near the core count is usually a better fit.

Rule:

```text
I/O-bound
→ Virtual Threads are often a strong default

CPU-bound
→ limit parallelism around available cores
```

---

# 14. Do Virtual Threads Remove the Limits?

No.

They only remove or reduce the **thread bottleneck**.

The bottleneck can still be:

```text
100,000 virtual threads
        ↓
20 database connections
        ↓
Only 20 requests can use DB at once
```

100,000 tasks can still exist.

But database throughput is still capped by those 20 connections.

So:

> **Unlimited threads do not mean unlimited throughput.**

The bottleneck just moves from:

```text
Number of threads
```

to:

```text
External resource capacity
```

---

## 14.1 Limiting Concurrency with a Semaphore

```java
Semaphore semaphore = new Semaphore(20);

semaphore.acquire();
try {
    // access limited resource
} finally {
    semaphore.release();
}
```

The model:

```text
1000 virtual tasks
       ↓
Semaphore(20)
       ↓
20 access resource
980 wait cheaply
```

This is a very powerful combination:

```text
Virtual Threads
→ cheap waiting

Semaphore / connection pool
→ resource protection
```

Use the mechanism that matches the resource:

| Mechanism        | Limits                |
| ---------------- | --------------------- |
| `Semaphore`      | number of concurrent tasks |
| Connection pool  | DB/socket connections |
| Rate limiter     | requests per second   |
| Bulkhead         | failure isolation     |
| Bounded queue    | overload buffering    |
| Rejection policy | overload response     |

---

# 15. Producer–Consumer and Backpressure

Once creating tasks becomes very cheap, the problem can shift to the queue and the consumer.

```text
Fast Producers
      ↓
Bounded Queue
      ↓
Consumers
```

If the producer is faster than the consumer:

```text
Without bounds
→ queue grows

With bounds
→ producer must slow down or wait
```

Backpressure does not make the system faster.

It stops the system from destroying itself when demand exceeds capacity.

A bounded queue says:

> "I can only absorb this much overload."

That is a better property than a queue that grows without bound.

---

# 16. A Mental Model for Production

The whole article can be reduced to one sentence:

> **A thread is a resource; but the real bottleneck is usually what the thread is waiting on.**

When designing concurrency, work through this order:

## Step 1: Identify the workload

```text
CPU-bound?
I/O-bound?
Mixed?
```

## Step 2: Find the bottleneck

```text
CPU?
DB connections?
External API?
Lock?
Memory?
Queue?
```

## Step 3: Choose the execution model

```text
CPU-bound
→ limit parallelism around cores

I/O-bound
→ consider Virtual Threads
```

## Step 4: Protect shared state

```text
Simple atomic state
→ Atomic*

Visibility flag
→ volatile

Complex invariant
→ synchronized / Lock
```

## Step 5: Protect external resources

```text
Semaphore
Connection pool
Rate limit
Timeout
```

## Step 6: Prepare for overload

```text
Bounded queue
Rejection policy
Backpressure
Bulkhead isolation
```

## Step 7: Prepare for failure

```text
Timeout
Interrupt handling
Exception handling
Graceful shutdown
Thread dumps
```

---

# 17. Decision Checklist

| Question                               | Approach                               |
| -------------------------------------- | -------------------------------------- |
| Is the task mostly I/O-bound?          | Consider one Virtual Thread per task   |
| Is the task CPU-bound?                 | Limit parallelism near the core count  |
| Does an external resource have finite capacity? | Semaphore / pool / rate limit  |
| Can it be overloaded?                  | Bounded queue + rejection/backpressure |
| Is there shared mutable state?         | Atomic / synchronized / Lock           |
| Are there multiple locks?              | Agree on a lock ordering               |
| Using ThreadLocal in a pool?           | `remove()` in `finally`                |
| Any external call?                     | Always set a timeout                   |
| Workloads with different latency?      | Separate executor/bulkhead             |
| Does the pool have its own lifecycle?  | Shut it down properly                  |

---

# Conclusion

Java concurrency does not start with:

> "How many threads should I create?"

The better question is:

> **"What is my task waiting on, and which resource actually limits the system?"**

Platform threads are a relatively expensive resource, which is why thread pools exist to manage them. But a pool brings queueing, rejection, sizing, exhaustion and tail latency along with it.

Virtual Threads change the game by making blocking cheap. With I/O-bound workloads, you can move to the model:

```text
One task
   ↓
One virtual thread
```

But Virtual Threads do not create more CPU cores, do not add database connections and do not bypass rate limits.

So the final model is:

```text
Your Code
   │
   ├── CPU-bound
   │     → limited parallelism
   │
   ├── I/O-bound
   │     → Virtual Threads
   │
   ├── Shared state
   │     → Atomic / synchronized / Lock
   │
   ├── External resources
   │     → Semaphore / connection pool / rate limit
   │
   └── Overload
         → bounded queues / backpressure / rejection
```

**The most important thing to remember:**

> **Don't start by choosing a thread count. Start with the bottleneck.**
>
> Threads are only the means by which work is executed or waits. The real limit of the system is usually the CPU, a lock, a queue, or an external resource that the threads are competing for.
