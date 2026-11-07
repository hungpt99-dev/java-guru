---
title: "Tomcat, Jetty or Undertow? A Guide to Choosing a High-Performance Java Web Server"
description: "When developing Java applications, choosing the right web server is a key factor in ensuring performance, scalability and maintainability."
slug: "tomcat-jetty-hay-undertow-huong-dan-chon-java-web-server-hieu-nang-cao"
locale: "en"
translationKey: "tomcat-jetty-hay-undertow-huong-dan-chon-java-web-server-hieu-nang-cao"
pubDate: 2025-09-13T18:17:19+07:00
category: "Java & JVM"
tags: ["Java"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 3
---

When developing **Java** applications, choosing the right **web server** is a key factor in ensuring **performance, scalability and maintainability**. The three most popular options today are **Apache Tomcat**, **Jetty** and **Undertow**. Each server has its own strengths and weaknesses and suits different kinds of applications. In this article we will analyse them in detail to help you make the right decision.

---

## 1. Apache Tomcat

### Introduction

Tomcat is one of the **most popular web servers in the Java ecosystem**, developed by the **Apache Software Foundation**. It fully supports **Servlet** and **JSP**, and is usually bundled in Spring Boot through the `spring-boot-starter-web` dependency.

### Strengths

* **Stable and popular**: Tomcat has existed for more than 20 years, with a large community and abundant documentation.
* **Easy integration with Spring Boot**: automatic configuration, fast deployment.
* **Full Servlet and JSP support**: suitable for traditional web applications.

### Weaknesses

* **Performance is not optimised for extremely large numbers of connections**: each HTTP connection occupies a thread.
* **Configuring it to use Virtual Threads (Project Loom) is complicated**.

### Suitable applications

* Enterprise web applications (MVC), small and medium REST APIs.
* When you need **long-term stability** and do not require extremely high concurrency.

---

## 2. Jetty

### Introduction

Jetty is a **lightweight web server** and **servlet container**, developed by the Eclipse Foundation. It stands out for being **light, fast and flexible**, and suits **microservices** and **embedded applications**.

### Strengths

* **Light and fast to start**.
* **Supports non-blocking I/O and asynchronous servlets**.
* **Easy to embed in a Java application** without an external server.
* **Good HTTP/2 and WebSocket support**.

### Weaknesses

* **Less popular than Tomcat**, with a smaller community.
* **Thread and connection pool management is more complex**.

### Suitable applications

* REST APIs, microservices, embedded applications.
* When you need **good performance with many concurrent connections**.
* When you want to take advantage of **WebSocket or HTTP/2**.

---

## 3. Undertow

### Introduction

Undertow is an **extremely light and fast web server**, developed by RedHat, and is the default server in **WildFly**. It supports **embedded** deployment, **non-blocking I/O** and the **reactive** model, which makes it a strong fit for **microservices and cloud-native**.

### Strengths

* **Extremely high performance**: handles tens of thousands of concurrent connections with a low memory footprint.
* **Reactive and non-blocking support**, integrating well with Spring WebFlux.
* **Easy embedded server**, fast startup.

### Weaknesses

* **Less popular than Tomcat and Jetty**, with limited documentation.
* **No JSP support**, so it is not suitable for traditional web applications.

### Suitable applications

* REST APIs, microservices, reactive applications.
* **Cloud-native** or serverless applications.

---

## 4. Overview comparison

| Criterion          | Tomcat             | Jetty                             | Undertow                |
| ------------------ | ------------------ | --------------------------------- | ----------------------- |
| Thread model       | Thread-per-request | Thread-per-request / Non-blocking | Non-blocking / Reactive |
| Memory footprint   | Medium             | Low                               | Very low                |
| Startup            | Medium             | Fast                              | Very fast               |
| HTTP/2 support     | Yes, but limited   | Good                              | Good                    |
| Embedded           | Yes                | Very easy                         | Very easy               |
| JSP support        | Yes                | Yes                               | No                      |
| Reactive / WebFlux | Limited            | Good                              | Excellent               |

---

## 5. Choosing a server based on the type of application

* **REST API / Microservices**: Undertow or Jetty handle concurrency better with a lower footprint. Tomcat still works but needs tuning if traffic is high.
* **Traditional web applications (MVC / JSP)**: Tomcat is the safe choice; Jetty works but needs an extra dependency for JSP.
* **Reactive / Cloud-native**: Undertow is the most optimal, Jetty is also good, Tomcat is limited.

---

## 6. Conclusion

* **Tomcat**: stable, popular, suitable for traditional web applications.
* **Jetty**: light, fast, good async support, suitable for microservices or embedding.
* **Undertow**: high performance, reactive, suitable for REST APIs and cloud-native applications.

Choosing a server depends not only on **performance** but also on **application architecture, the technologies in use and the deployment environment**. Understanding the strengths and weaknesses of Tomcat, Jetty and Undertow will help you optimise performance and the user experience.
