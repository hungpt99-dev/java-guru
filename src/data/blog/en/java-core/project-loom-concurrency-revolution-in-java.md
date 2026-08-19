---
title: "Project Loom and Virtual Threads in Java"
description: "A practical explanation of Project Loom, virtual threads, their trade-offs, and when they fit Java applications."
pubDatetime: 2025-09-13T02:59:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Java applications have traditionally represented concurrency with platform threads. That model is straightforward, but it becomes expensive when a service must keep many operations waiting on network, file, or database I/O. Reactive programming can reduce the number of blocked platform threads, but it changes the programming model and often makes control flow harder to follow.

Project Loom addresses this trade-off with virtual threads. The goal is not to make every workload faster or to remove the need for capacity planning. It is to make high-concurrency, I/O-bound code possible with a familiar thread-per-task style. This article explains the model, shows a small example, compares it with reactive programming, and describes the limitations that still matter in production.

## 1. The Constraint: Platform Threads

A traditional Java thread is backed by an operating-system thread. Platform threads are useful for CPU-bound work and are easy to reason about, but each one carries operating-system and JVM resources, including a stack. The exact memory cost depends on the JVM, operating system, and configuration; it should not be treated as a fixed value such as one megabyte.

When a platform thread waits for I/O, it is generally unavailable to do other application work. A service that needs many simultaneous waits therefore has to choose between allocating many platform threads and introducing an asynchronous programming model. Both choices have operational and maintenance costs.

**[ANALYSIS]** The important limitation is not simply the number of requests. It is the relationship between the number of concurrent waits, the available platform threads, memory, scheduler overhead, and downstream capacity. A larger thread count cannot compensate for a database or remote service that is already saturated.

## 2. What Project Loom Adds

Project Loom is the OpenJDK effort that introduced virtual threads and related concurrency work. Virtual threads are scheduled by the JVM and run on a smaller set of platform threads, often called carrier threads. They are intended for tasks that spend a meaningful part of their lifetime waiting, especially on I/O.

The programming model remains familiar. A virtual thread can use `Thread`, `sleep`, `join`, and ordinary sequential control flow. When a supported blocking operation waits, the JVM can suspend, or park, the virtual thread and let its carrier thread run another virtual thread. This is why blocking-style application code can support more concurrent waiting tasks without creating one operating-system thread for each task.

This behavior is not magic non-blocking execution for every library. Native code, some synchronization patterns, and operations that pin a virtual thread can keep a carrier thread occupied. Libraries also need to cooperate with the JDK's virtual-thread implementation.

## 3. A Small Example

The following example uses 100,000 tasks. **[ASSUMPTION: illustrative example]** The one-second delay represents an I/O wait; it is not a benchmark or a capacity claim.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 100_000).forEach(i ->
        executor.submit(() -> {
            Thread.sleep(1_000); // [ASSUMPTION: illustrative wait]
            System.out.println("Task " + i);
            return i;
        })
    );
}
```

The executor creates a virtual thread for each submitted task. The code still expresses a blocking wait directly. During a compatible wait, the virtual thread can be parked instead of occupying a dedicated platform thread.

This example demonstrates the API, not production scalability. Real throughput depends on the executor lifecycle, CPU, memory, logging, connection pools, downstream services, timeouts, and the behavior of the libraries involved.

## 4. What Virtual Threads Improve

### 4.1. Sequential Code for I/O-Bound Work

Code that performs a request, waits for a response, and then processes it can remain sequential and readable. Teams do not have to introduce callbacks or reactive types solely to avoid blocking platform threads.

### 4.2. Lower Thread-Management Cost

Virtual threads are much lighter than platform threads, so applications can represent many waiting tasks without allocating the same number of operating-system threads. The actual limit still comes from memory, CPU, queues, connection pools, and downstream systems.

### 4.3. A Smaller Migration Step

Many APIs based on `Runnable`, `Callable`, `Future`, and `Thread` can be used with virtual threads. That does not guarantee that every existing component behaves well: thread pools, `ThreadLocal` usage, synchronization, native calls, and blocking drivers still need review.

### 4.4. Better Fit for Thread-Per-Task Designs

Virtual threads make it reasonable to model each request or unit of work as a separate task. They do not make CPU-bound work cheaper. CPU-heavy tasks still compete for processor time and should be bounded by an appropriate executor or other concurrency limit.

## 5. Limits and Operational Concerns

- **I/O-bound does not mean unlimited.** A virtual thread can wait cheaply, but a database still has a finite connection pool and a remote service still has a finite capacity.
- **Use backpressure and limits.** Bound admission to expensive downstream operations. A virtual-thread-per-task executor is not a replacement for connection-pool limits, request limits, or queue design.
- **Avoid accidental pinning.** Long blocking operations inside `synchronized` sections or native code can prevent a carrier thread from being released. Inspect such paths and test the libraries used by the application.
- **Preserve timeout and retry discipline.** Virtual threads do not remove the need for timeouts, cancellation, idempotency, bounded retries, and circuit breakers (cơ chế ngắt mạch).
- **Review context propagation.** `ThreadLocal` state and diagnostic context need deliberate handling when tasks are created in large numbers.
- **Measure the real bottleneck.** Monitor latency, CPU, heap, carrier-thread behavior, connection-pool usage, and downstream errors. Do not infer performance from the number of virtual threads alone.

## 6. Java and Framework Support

**[SOURCE FACT]** Virtual threads were delivered as a final feature in Java 21 through JEP 444. They are part of Java SE and do not require an external virtual-thread library.

Framework support is a separate question from language support. Spring Framework and Spring Boot have added support for running applications with virtual threads, but an application still depends on its web server, database driver, HTTP client, observability stack, and deployment configuration. The supported configuration should be checked against the versions in use.

Tomcat, Jetty, Quarkus, and Micronaut have also worked on virtual-thread support or integration. The relevant question is not whether a framework has a switch for virtual threads; it is whether the complete request path handles blocking, cancellation, timeouts, thread-local context, and resource limits correctly.

**[PROPOSED DESIGN]** For a service with mostly blocking I/O, evaluate virtual threads as an alternative to introducing reactive APIs. Start with a bounded workload, instrument the downstream calls, verify driver and client behavior, and compare failure handling as well as latency. Keep reactive programming where its streaming, event composition, or explicit non-blocking behavior is a better fit.

## 7. Comparing Concurrency Models

| Model | Execution style | Main trade-off |
| --- | --- | --- |
| Platform threads | One Java thread backed by one OS thread | Familiar, but each waiting task consumes more resources |
| Reactive programming | Non-blocking APIs and asynchronous composition | Efficient for suitable workloads, but a different and more complex control-flow model |
| Virtual threads | Thread-per-task API scheduled over carrier threads | Familiar blocking-style code, with library and pinning constraints |

There is no universal winner. Virtual threads reduce the cost of representing concurrent waiting; they do not remove application-level bottlenecks. Reactive programming remains useful when explicit event streams, fine-grained backpressure, or end-to-end non-blocking behavior is central to the design.

## 8. A Practical Adoption Checklist

1. Identify whether the workload is I/O-bound, CPU-bound, or mixed.
2. Inventory blocking libraries, native calls, synchronization, and `ThreadLocal` state.
3. Keep connection pools and downstream concurrency bounded.
4. Define timeouts, cancellation, retry, idempotency, and fallback behavior before increasing concurrency.
5. Load-test representative traffic and observe the downstream systems, not only the JVM.
6. Compare the operational complexity of virtual-thread and reactive implementations for the same use case.

## 9. Conclusion

Project Loom changes the cost model for Java concurrency by making virtual threads available as a standard Java feature. For I/O-bound applications, they can preserve the clarity of blocking-style code while allowing many waiting tasks to share a smaller set of platform threads.

They are not a general performance switch. Correct limits, compatible libraries, timeout and retry policies, observability, and downstream capacity remain essential. The sound engineering choice is to select virtual threads, platform threads, reactive programming, or a combination based on the workload and the complete system—not on a thread-count target.
