---
title: "Java Concurrency: Thread Pools and Virtual Threads"
description: "A production-oriented guide to Java concurrency: shared state, thread pools, backpressure, CPU and I/O-bound work, and what Virtual Threads change."
pubDatetime: 2026-08-09T00:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

## Introduction

Consider this **illustrative scenario**: a service receives 10,000 requests at
once. Some requests parse JSON, hash data, or compress a response. Others wait
for a database query or an external HTTP API that takes 300 ms to respond.

Should the service create 10,000 threads? If not, why not? And if Java Virtual
Threads make it practical to represent very large numbers of concurrent tasks,
why does that not make an application infinitely concurrent?

This article answers those questions by following the layers that determine
where concurrency helps and where it does not:

```text
Application code
       ↓
Java threads
       ↓
JVM
       ↓
Operating-system scheduler
       ↓
CPU cores
       ↓
External resources (databases, APIs, files)
```

> **[ANALYSIS]** The central question is simple: **what is the actual bottleneck?** It might be
CPU, database connections, an external API rate limit, network capacity,
memory, lock contention, a thread pool, or queue capacity. More concurrency is
useful only when it addresses that constraint. Otherwise it moves the
bottleneck or adds overhead.

The article focuses on four questions:

- Why can adding threads make an application slower?
- Why does a thread pool with hundreds of threads not necessarily improve CPU
  utilization?
- Why can Virtual Threads support very large concurrency without making
  CPU-bound code faster?
- Why do concurrency bugs often appear only under production conditions?

The supplied `java-lab` repository accompanies this article:
[`java-lab`](https://github.com/hungpt99-dev/java-lab/tree/lab/thread). It is a
plain Maven project with 31 small, independent examples using JDK concurrency
APIs and no framework dependency. Each section connects a concept to a class,
the code to run, and the behavior to observe.

> **[SOURCE FACT]** The examples target Java 21 or later. The repository's
> `pom.xml` sets `maven.compiler.release` to `21`, and Virtual Threads require
> Java 21.

> **[SOURCE FACT]** The recorded measurements in the original examples were
> produced on a 12-core machine with JDK 21. They are sample observations, not
> portable benchmark results.

Read each section by starting with the problem, checking the code, and then
comparing your observation with the recorded output. The important part is not
the exact timing. It is understanding which resource limits progress.

## 1. The Real Problem: Many Requests, Different States

A sequential program handles one operation after another:

```text
Task A
  ↓
Task B
  ↓
Task C
```

A backend usually has requests in different states at the same time:

```text
Request A ───── waiting for database
Request B ───── calculating
Request C ───── waiting for HTTP API
Request D ───── processing file
```

While Request A waits for the database, the program could use the CPU for
Request B. A sequential design cannot do that until A completes, so it leaves
available execution time unused while waiting on external resources.

**[ANALYSIS]** That is the basic reason concurrency is useful. A thread can block on a slow
operation while another task makes progress. This does not make the database,
HTTP service, or file system faster. It changes what the application does with
the waiting time.

Threads also have costs and failure modes. Creating and scheduling platform
threads consumes resources. Threads share the process's memory, so unsafely
shared state can be corrupted or produce inconsistent results. Threads provide
no additional CPU cores. The rest of the design is therefore a trade-off
between useful overlap, resource limits, and coordination overhead.

## 2. Concurrency and Parallelism

These terms describe different properties and should not be used
interchangeably.

### 2.1. Structure versus execution

- **Concurrency** means that multiple tasks can make progress during
  overlapping time periods, including by being interleaved on one CPU. It is a
  way to structure a program that contains waiting.
- **Parallelism** means that multiple tasks execute at the same instant on
  different CPU cores. It depends on available execution resources.

An analogy is useful as long as its limits are clear. One chef can switch
between dishes while each dish waits on the stove: that is concurrency. Several
chefs cooking at the same time on separate stoves is parallelism.

```text
Concurrency (interleaved on 1 core):
  Thread A:  |--A1--|        |--A2--|        |--A3--|
  Thread B:        |--B1--|        |--B2--|        |--B3--|

Parallelism (simultaneous on 2 cores):
  Core 1:    |------A1------|------A2------|
  Core 2:    |------B1------|------B2------|
```

**[ANALYSIS]** Concurrency is often the right tool for workloads that spend time waiting.
Parallelism is the mechanism that uses multiple cores for computation. A task
that is continuously CPU-bound does not become faster merely because it is
represented by more concurrent threads; the available cores remain the limit.

Concurrency does not require multiple cores. Parallel execution does. In the
following **illustrative assumption**, a machine has 4 cores and the process
has 1,000 threads. At most 4 tasks can execute on those cores at one instant;
the remaining 996 tasks must wait, sleep, or be switched by the scheduler.
**Creating threads does not create cores.**

### 2.2. Workload type determines the useful limit

For any task, ask what occupies most of its time:

- **CPU-bound**: the task spends its time computing, for example parsing,
  hashing, cryptography, or compression. Throughput is primarily limited by
  CPU capacity, not by an arbitrarily larger thread count.
- **I/O-bound**: the task spends much of its time waiting for a database, an
  HTTP response, or a file operation. Useful throughput is constrained by the
  latency and capacity of those resources, along with the application's own
  concurrency limits.

The distinction is not a choice between “threads are good” and “threads are
bad.” It is a way to identify what should be bounded, where backpressure
(`backpressure`, or a mechanism that slows producers when consumers or a
resource are full) belongs, and whether a thread pool or Virtual Threads is an
appropriate execution model.
