---
title: "Tomcat, Jetty, or Undertow? A Guide to Choosing a High-Performance Java Web Server"
description: "A detailed comparison of Tomcat, Jetty, and Undertow: thread model, memory footprint, performance, and suitable use cases for each type of Java application."
pubDatetime: 2025-09-13T11:17:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

When developing Java applications, choosing the right web server is a key factor in ensuring performance, scalability, and maintainability. The three most popular choices today are Apache Tomcat, Jetty, and Undertow. Each server has its own pros and cons and suits different types of applications. In this article, we'll analyze them in detail to help you make the right decision.

## 1. Apache Tomcat

### Introduction

Tomcat is one of the most popular web servers in the Java ecosystem, developed by the Apache Software Foundation. It fully supports Servlet and JSP, and is often bundled with Spring Boot via the spring-boot-starter-web dependency.

### Advantages

- Stable and popular: Tomcat has existed for over 20 years, with a large community and extensive documentation.
- Easy integration with Spring Boot: Auto-configuration, quick deployment.
- Full Servlet and JSP support: Suitable for traditional web applications.

### Disadvantages

- Performance not optimal for extremely high connection counts: Each HTTP connection occupies one thread.
- Complex configuration for using Virtual Threads (Project Loom).

### Suitable Applications

- Enterprise web applications (MVC), small to medium REST APIs.
- When long-term stability is needed without extremely high concurrency requirements.

## 2. Jetty

### Introduction

Jetty is a lightweight web server and servlet container, developed by the Eclipse Foundation. It stands out for being lightweight, fast, and flexible, suitable for microservices and embedded applications.

### Advantages

- Lightweight and fast startup time.
- Supports non-blocking I/O and asynchronous servlets.
- Easy to embed into Java applications without an external server.
- Good HTTP/2 and WebSocket support.

### Disadvantages

- Less popular than Tomcat, smaller community.
- More complex thread and connection pool management.

### Suitable Applications

- REST APIs, microservices, embedded applications.
- When good performance with many concurrent connections is needed.
- When wanting to leverage WebSocket or HTTP/2.

## 3. Undertow

### Introduction

Undertow is an extremely lightweight and fast web server, developed by RedHat, and is the default server in WildFly. It supports embedded, non-blocking I/O, and reactive models, making it very suitable for microservices and cloud-native.

### Advantages

- Extremely high performance: Handles tens of thousands of concurrent connections with low memory footprint.
- Supports reactive and non-blocking, integrates well with Spring WebFlux.
- Easy embedded server, fast startup.

### Disadvantages

- Less popular than Tomcat and Jetty, limited documentation.
- No JSP support, so not suitable for traditional web applications.

### Suitable Applications

- REST APIs, microservices, reactive applications.
- Cloud-native or serverless applications.

## 4. Overall Comparison

| Criteria           | Tomcat             | Jetty                             | Undertow                |
| ------------------ | ------------------ | --------------------------------- | ----------------------- |
| Thread model       | Thread-per-request | Thread-per-request / Non-blocking | Non-blocking / Reactive |
| Memory footprint   | Medium             | Low                               | Very low                |
| Startup            | Medium             | Fast                              | Very fast               |
| HTTP/2 support     | Limited            | Good                              | Good                    |
| Embedded           | Yes                | Very easy                         | Very easy               |
| JSP support        | Yes                | Yes                               | No                      |
| Reactive / WebFlux | Limited            | Good                              | Excellent               |

## 5. Server Selection Based on Application Type

- REST API / Microservices: Undertow or Jetty will handle concurrency better, with lower footprint. Tomcat still works but needs tuning for high traffic.
- Traditional web applications (MVC / JSP): Tomcat is the safe choice, Jetty works but needs additional JSP dependencies.
- Reactive / Cloud-native: Undertow is most optimal, Jetty is also good, Tomcat is limited.

## 6. Conclusion

- Tomcat: Stable, popular, suitable for traditional web applications.
- Jetty: Lightweight, fast, good async support, suitable for microservices or embedded.
- Undertow: High performance, reactive, suitable for REST APIs and cloud-native applications.

Choosing a server isn't just about performance, but also depends on application architecture, technology used, and deployment environment. Understanding the pros and cons of Tomcat, Jetty, and Undertow will help you optimize performance and user experience.
