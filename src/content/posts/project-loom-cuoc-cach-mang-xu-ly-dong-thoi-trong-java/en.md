---
title: "Project Loom: The Concurrency Revolution in Java"
description: "For decades, Java has been famous for its multithreading. From desktop applications to distributed systems, from web applications to big data, Java relies on threads to handle…"
slug: "project-loom-cuoc-cach-mang-xu-ly-dong-thoi-trong-java"
locale: "en"
translationKey: "project-loom-cuoc-cach-mang-xu-ly-dong-thoi-trong-java"
pubDate: 2025-09-13T09:59:55+07:00
category: "Java & JVM"
tags: ["Java"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 5
---

For decades, Java has been famous for its multithreading. From desktop applications to distributed systems, from web applications to big data, Java relies on threads to handle many tasks at once. However, as systems grew more complex and the number of concurrent connections climbed, Java's traditional thread model gradually showed its limitations.

To solve this problem, Oracle introduced **Project Loom** – an effort to reshape the way Java handles concurrency, making parallel programming **easier, more efficient and less resource-hungry**.

---

## 1. Background: the problem with traditional threads

In Java, a `Thread` is tied to an operating system thread (OS thread). This brings advantages: simple, intuitive, easy to manage. But when a system needs to handle tens of thousands or even millions of concurrent connections (for example a web server, a chat system, a streaming application), this model shows its limitations:

* **Large memory cost**: Each thread needs its own stack (usually 1MB), so creating 100k threads would consume hundreds of GB of RAM.
* **Context switching overhead**: The operating system has to constantly switch between threads, burning CPU.
* **Inconvenient programming**: To avoid burning threads, developers are forced to use callbacks, reactive programming or complex async APIs.

These limitations cost Java its edge over newer languages such as Go (with goroutines) or JavaScript (async/await).

---

## 2. What is Project Loom?

**Project Loom** is a project in OpenJDK that adds **Virtual Threads** to Java. It is an abstraction layer far lighter than a traditional thread, managed by the JVM instead of the operating system.

* **Virtual Threads** are much like goroutines in Go: you can create millions of threads without worrying about exhausting resources.
* Each virtual thread is scheduled onto a small pool of OS threads (carrier threads).
* When a virtual thread blocks (for example waiting on I/O), the JVM automatically “parks” it and frees the carrier thread for other virtual threads.

The important part: **the programming API stays the same as with traditional threads**. You can write code with `Thread`, `sleep`, `join`, `synchronized`... without switching to reactive or callback-based style.

---

## 3. How do Virtual Threads work?

Loom's core mechanism is based on:

1. **Continuation**: A way of representing a function's execution state that can be paused and resumed later.
2. **Scheduler**: The JVM manages the assignment of virtual threads to carrier threads.
3. **Non-blocking under the hood**: Although the developer writes blocking code (for example `socket.read()`), the JVM turns it into non-blocking.

For example:

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

* We create **100,000 virtual threads** in just a few lines.
* Each thread still uses the familiar `Thread.sleep`.
* The JVM optimises so that it does not occupy 100,000 OS threads.

Written with traditional threads, that program would be almost impossible to run.

---

## 4. Benefits of Project Loom

### 4.1. Simplifying concurrent programming

No need for a complex reactive framework (such as WebFlux, RxJava). Developers just write sequential code that is easy to understand and easy to debug.

### 4.2. Massive scalability

You can create millions of virtual threads and handle millions of concurrent connections while still saving resources.

### 4.3. Backward compatibility

Old code using `Thread` can run directly on virtual threads with few changes.

### 4.4. High performance

Less context switching cost, a smaller memory footprint, higher throughput for I/O-bound systems.

---

## 5. Challenges and limits

* **Doesn't replace everything**: Virtual threads suit I/O-bound tasks (lots of waiting on I/O). With CPU-bound work (heavy computation), the difference in effectiveness is not significant.
* **Debugging and profiling**: Current tooling needs updating to support virtual threads.
* **Library integration**: Some older libraries assume `ThreadLocal` or the traditional concurrency model and need checking when running on Loom.

---

## 6. Project Loom in the Java ecosystem

### 6.1. Java SE

Since Java 21, Virtual Threads have been officially released (JEP 444). Developers can use them without adding any external library.

### 6.2. Spring Framework

Spring 6 and Spring Boot 3 have started supporting Loom. Instead of WebFlux, you can write controllers in blocking style and still handle tens of thousands of requests in parallel.

For example:

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

Previously, this style did not scale well. But with Loom, it can serve tens of thousands of requests and still be efficient.

### 6.3. Other frameworks

* **Quarkus, Micronaut**: Have experimented with Loom support.
* **Tomcat, Jetty**: Are also integrating virtual threads.

---

## 7. Comparing Loom with other models

| Technology                 | Description                      | Programming complexity | Scalability                |
| -------------------------- | -------------------------------- | --------------------- | -------------------------- |
| Traditional threads        | OS thread 1-1                    | Simple                | Limited (a few thousand threads) |
| Reactive (WebFlux, RxJava) | Non-blocking, async              | Hard, lots of callbacks | Very high                |
| Loom (Virtual Threads)     | Blocking API on virtual threads  | As simple as threads  | Very high                  |

So Loom brings a balance: **as simple as threads, as efficient as reactive**.

---

## 8. The future of Java with Loom

Project Loom opens up many new possibilities for the Java ecosystem:

* **Web server**: Handling millions of connections with traditional blocking code.
* **Microservices**: Lean, easy to maintain, no need for complex reactive machinery.
* **Data processing**: Running many I/O tasks in parallel without worrying about a bottleneck.
* **Cloud-native**: Combined with containers, Kubernetes and GraalVM, Loom helps Java compete strongly with Go and Node.js.

In the future, once the community and frameworks have fully caught up with Loom, writing concurrent applications in Java will be easier than ever.

---

## 9. Conclusion

**Project Loom** is a turning point for Java. It solves the concurrency problem by adding **Virtual Threads** – light, easy to program, highly efficient. With Loom, Java developers can write familiar blocking code and still achieve performance on par with reactive.

In the era of cloud-native, microservices and distributed systems, Loom is the key for Java to hold its leading position while competing on equal terms with younger languages.
