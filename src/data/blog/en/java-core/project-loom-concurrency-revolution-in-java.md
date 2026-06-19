---
title: "Project Loom: The Concurrency Revolution in Java"
description: "Understanding Project Loom and Virtual Threads in Java: how they work, benefits, comparison with reactive programming, and the future of Java."
pubDatetime: 2025-09-13T02:59:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

For decades, Java has been renowned for its multithreading capabilities. From desktop applications to distributed systems, from web applications to big data, Java has relied on threads to handle multiple tasks simultaneously. However, as systems become increasingly complex and concurrent connection counts grow, Java's traditional thread model has gradually revealed its limitations.

To address this problem, Oracle introduced Project Loom — an effort to reshape how Java handles concurrency, making parallel programming easier, more efficient, and more resource-friendly.

## 1. Context: The Problem with Traditional Threads

In Java, a Thread is tied to an operating system thread (OS thread). This brings advantages: simple, intuitive, easy to manage. But when systems need to handle tens of thousands, even millions of concurrent connections (e.g., web servers, chat systems, streaming applications), this model reveals limitations:

- High memory cost: Each thread needs its own stack (typically 1MB), so creating 100k threads would consume hundreds of GB of RAM.
- Context switching overhead: The operating system must continuously switch between threads, consuming CPU.
- Inconvenient programming: To avoid wasting threads, developers are forced to use callbacks, reactive programming, or complex async APIs.

These limitations cause Java to lose advantages compared to newer languages like Go (with goroutines) or JavaScript (async/await).

## 2. What is Project Loom?

Project Loom is an OpenJDK project aimed at adding Virtual Threads to Java. This is a much lighter abstraction layer compared to traditional threads, managed by the JVM instead of the operating system.

- Virtual Threads are similar to goroutines in Go: you can create millions of threads without worrying about resource exhaustion.
- Each virtual thread is scheduled on a small pool of OS threads (carrier threads).
- When a virtual thread blocks (e.g., waiting for I/O), the JVM automatically "parks" it and frees the carrier thread for another virtual thread.

The important thing: the programming API remains the same as traditional threads. You can write code with Thread, sleep, join, synchronized... without switching to reactive or callback-based approaches.

## 3. How Virtual Threads Work

Loom's main mechanism is based on:

- Continuation: A way to represent the execution state of a function, which can be paused and resumed later.
- Scheduler: The JVM manages assigning virtual threads to carrier threads.
- Non-blocking under the hood: Although developers write blocking code (e.g., socket.read()), the JVM converts it to non-blocking.

Example:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 100_000).forEach(i ->
        executor.submit(() -> {
            Thread.sleep(1000); // blocking code
            System.out.println("Task " + i);
            return i;
        })
    );
}
```

In the code above:

- We create 100,000 virtual threads with just a few lines.
- Each thread still uses the familiar Thread.sleep.
- The JVM optimizes to not occupy 100,000 OS threads.

If written with traditional threads, the above program would be nearly impossible to run.

## 4. Benefits of Project Loom

### 4.1. Simplifies Concurrent Programming

No need for complex reactive frameworks (like WebFlux, RxJava). Developers just write sequential code that's easy to understand and debug.

### 4.2. Massive Scalability

Can create millions of virtual threads, handling millions of concurrent connections while saving resources.

### 4.3. Backward Compatibility

Old code using Thread can run directly on virtual threads with minimal changes.

### 4.4. High Performance

Reduces context switching costs, reduces memory footprint, increases throughput for I/O-bound systems.

## 5. Challenges and Limitations

- Doesn't replace everything: Virtual threads are suitable for I/O-bound tasks (lots of I/O waiting). For CPU-bound (heavy computation), the difference isn't significant.
- Debugging and profiling: Current tools need updates to support virtual threads.
- Library integration: Some older libraries assume ThreadLocal or traditional concurrency models, need checking when running on Loom.

## 6. Project Loom in the Java Ecosystem

### 6.1. Java SE

Since Java 21, Virtual Threads have been officially released (JEP 444). Developers can use them without additional external libraries.

### 6.2. Spring Framework

Spring 6 and Spring Boot 3 have begun supporting Loom. Instead of WebFlux, you can write blocking-style controllers while still handling tens of thousands of concurrent requests.

Example:

```java
@RestController
public class HelloController {
    @GetMapping("/hello")
    public String hello() throws InterruptedException {
        Thread.sleep(100); // blocking
        return "Hello, Loom!";
    }
}
```

Previously, this approach didn't scale well. But with Loom, it can serve tens of thousands of requests while remaining efficient.

### 6.3. Other Frameworks

- Quarkus, Micronaut: Have been testing Loom support.
- Tomcat, Jetty: Are also integrating virtual threads.

## 7. Comparing Loom with Other Models

| Technology                 | Description                     | Programming Complexity    | Scalability                    |
| -------------------------- | ------------------------------- | ------------------------- | ------------------------------ |
| Traditional Threads        | OS thread 1-1                   | Simple                    | Limited (few thousand threads) |
| Reactive (WebFlux, RxJava) | Non-blocking, async             | Difficult, many callbacks | Very high                      |
| Loom (Virtual Threads)     | Blocking API on virtual threads | Simple like threads       | Very high                      |

Thus, Loom brings balance: simple like threads, efficient like reactive.

## 8. The Future of Java with Loom

Project Loom opens up many new possibilities for the Java ecosystem:

- Web servers: Handle millions of connections with traditional blocking code.
- Microservices: Lightweight, easy to maintain, no need for complex reactive.
- Data processing: Run many I/O tasks in parallel without bottleneck concerns.
- Cloud-native: Combined with containers, Kubernetes, and GraalVM, Loom helps Java compete strongly with Go and Node.js.

In the future, as the community and frameworks fully update for Loom, writing concurrent applications in Java will be easier than ever.

## 9. Conclusion

Project Loom is a turning point for Java. It solves the concurrency problem by adding Virtual Threads — lightweight, easy to program, highly efficient. With Loom, Java developers can write familiar blocking code while achieving performance on par with reactive.

In the era of cloud-native, microservices, and distributed systems, Loom is the key for Java to maintain its leading position while competing head-to-head with younger languages.
