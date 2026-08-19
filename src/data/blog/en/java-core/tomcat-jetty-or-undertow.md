---
title: "Tomcat, Jetty, or Undertow: Choosing a Java Web Server"
description: "A practical comparison of Tomcat, Jetty, and Undertow, covering request handling, embedding, protocol support, and application fit."
pubDatetime: 2025-09-13T11:17:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Choosing a Java web server is rarely a matter of finding the fastest name on a benchmark. The relevant questions are usually more concrete: which APIs the application needs, whether request handling is blocking or asynchronous, how the server is embedded and configured, and what the deployment environment already standardizes.

Tomcat, Jetty, and Undertow can all serve HTTP traffic and can be embedded in a Java application. They differ in defaults, integration details, and the trade-offs around servlet compatibility, non-blocking I/O, operational familiarity, and application architecture. This article compares those trade-offs without treating a server choice as a universal performance ranking.

## 1. Apache Tomcat

### What it is

**[SOURCE FACT]** Tomcat is a widely used servlet container from the Apache Software Foundation. It supports the Servlet API and JSP, and is a common default in Spring Boot applications that use `spring-boot-starter-web`.

**[ANALYSIS]** Tomcat is a conservative default when the application is built around the servlet programming model, conventional MVC, or existing operational knowledge of Tomcat configuration. Its connector is not inherently “one thread per connection”: with a non-blocking connector, a small set of threads can manage connections while worker threads process requests. The actual behavior depends on the connector and executor configuration.

### Strengths

- Mature servlet and JSP support for traditional server-side applications.
- Broad ecosystem adoption and a large body of operational documentation.
- Straightforward Spring Boot integration and deployment.
- Multiple connector and executor options, including non-blocking I/O.

### Constraints

- Blocking application code still consumes request-processing capacity while it waits on a database, downstream service, or other I/O.
- High concurrency does not disappear when the connector is non-blocking. The application still needs sensible timeouts, connection pools, backpressure, and limits on work submitted to executors.
- Virtual-thread adoption requires checking the framework, connector, and executor configuration rather than assuming it is a server-only switch.

### Good fit

Tomcat is a sensible choice for servlet-based MVC applications, JSP applications, and small-to-medium REST services when compatibility and operational familiarity matter more than changing the programming model.

## 2. Jetty

### What it is

**[SOURCE FACT]** Jetty is a lightweight HTTP server and servlet container associated with the Eclipse Foundation. It supports non-blocking I/O, asynchronous servlet APIs, embedded deployment, and protocols such as HTTP/2 and WebSocket when configured and supported by the relevant stack.

**[ANALYSIS]** Jetty is attractive when the server is part of the application rather than a separately managed runtime. Its flexibility is useful, but it also means that thread pools, connection limits, queues, and protocol settings need to be reviewed as one system. “Lightweight” does not remove the cost of blocking work in the application.

### Strengths

- Small, embeddable runtime with fast startup in many deployments.
- Strong support for asynchronous request handling and non-blocking I/O.
- Flexible configuration for embedded services and custom HTTP stacks.
- HTTP/2 and WebSocket support, subject to version and deployment configuration.

### Constraints

- The configuration surface can be less familiar to teams standardized on Tomcat.
- Correct tuning requires understanding the relationship between connection limits, worker threads, queues, and downstream resources.
- Servlet features and optional integrations may require additional dependencies or explicit configuration.

### Good fit

Jetty fits REST services, microservices, embedded applications, and systems that need asynchronous handling or WebSocket/HTTP/2 support without adopting a different server architecture by default.

## 3. Undertow

### What it is

**[SOURCE FACT]** Undertow is a lightweight HTTP server designed for embedded use and non-blocking I/O. It is associated with the WildFly/JBoss ecosystem and can serve servlet-based applications as well as lower-level HTTP handlers.

**[ANALYSIS]** Undertow’s handler model makes it a good option for applications that want explicit control over non-blocking request processing. It is not automatically a reactive framework, and it does not make blocking application code non-blocking. Spring WebFlux compatibility, if needed, must be checked for the chosen Spring Boot and Undertow versions; a server choice alone does not establish a reactive architecture.

### Strengths

- Embeddable server with a non-blocking handler model.
- Useful for services that need low-level control over HTTP handling and fast startup characteristics.
- Servlet support is available, while applications can also use Undertow handlers directly.
- Suitable for high-concurrency designs when the application and downstream dependencies are also designed for asynchronous or bounded work.

### Constraints

- It does not provide JSP support, so it is not a direct fit for JSP-based applications.
- Teams may have less existing operational knowledge or documentation for Undertow than for Tomcat.
- Performance and memory use are workload-dependent; “very low” overhead or a fixed connection count should not be assumed without a representative test.

### Good fit

Undertow is a candidate for embedded services, REST APIs, and applications using non-blocking handlers. It is a poor fit when JSP compatibility is a requirement. For reactive applications, evaluate the complete framework and dependency stack rather than selecting Undertow on the label “reactive.”

## 4. Comparison

The table describes general tendencies, not guarantees. Defaults and available features vary by server version, connector, framework, and deployment configuration.

| Criterion | Tomcat | Jetty | Undertow |
| --- | --- | --- | --- |
| Request handling | Servlet worker model; non-blocking connectors are available | Servlet worker model plus asynchronous and non-blocking APIs | Non-blocking handlers plus servlet support |
| Memory footprint | Moderate in a typical servlet deployment; measure the application | Often compact in embedded deployments; measure the application | Often compact in embedded deployments; measure the application |
| Startup | Depends on application and configuration | Often fast in embedded deployments | Often fast in embedded deployments |
| HTTP/2 | Available with the appropriate connector and configuration | Available with the appropriate configuration | Available with the appropriate configuration |
| Embedding | Supported | A strong use case | A strong use case |
| JSP | Supported | Available with the required JSP integration | Not supported |
| Reactive framework fit | Depends on the framework and adapter | Depends on the framework and adapter | Depends on the framework and adapter |

## 5. How to choose

**[PROPOSED DESIGN]** Use the following decision process rather than starting with a generic performance claim:

- **Servlet MVC or JSP:** Start with Tomcat. Jetty is also viable, but verify the servlet/JSP dependencies and team operating model.
- **Embedded service or custom HTTP handling:** Compare Jetty and Undertow first. Choose based on the handler APIs, configuration model, and existing support skills.
- **Many concurrent connections:** First make the application non-blocking where appropriate, bound queues and connection pools, and set timeouts. Then benchmark the candidate servers using the real request mix. A non-blocking server cannot compensate for unbounded blocking work.
- **Reactive stack:** Select the framework and its supported server integration as a unit. Do not infer that Undertow, Jetty, or Tomcat alone makes the application reactive.
- **Existing platform standard:** Prefer the server your organization already monitors, patches, and debugs well unless there is a measured requirement to change.

## 6. Conclusion

Tomcat is usually the least surprising choice for servlet and JSP applications. Jetty is a flexible embedded server with strong asynchronous capabilities. Undertow provides an embeddable non-blocking handler model and is a reasonable candidate for services that need that level of control.

None of these servers is universally fastest. The outcome depends on blocking behavior, executor and connection-pool limits, downstream latency, protocol configuration, and the framework around the server. Establish the application requirements first, then validate the shortlist with production-like load and operational checks.
