---
title: "Senior Java Interview: Spring Boot"
description: "Spring Boot is where Java backend seniors live. IoC/DI, the bean lifecycle, transaction management, and the auto-configuration magic interviewers expect you to see through."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Most senior Java backend roles are Spring Boot roles. Interviewers expect you to understand the framework, not just use it.

## 1. IoC and DI

- **Inversion of Control:** the container owns object creation and wiring; you declare dependencies, it provides them.
- **DI styles:** constructor injection (preferred — immutable, testable) over field injection (harder to test, hides dependencies).
- **Bean scopes:** singleton (default), prototype, request, session, and how they interact with state.

```java
// Constructor injection — testable, explicit
@Service
public class OrderService {
    private final PaymentGateway gateway;
    public OrderService(PaymentGateway gateway) { this.gateway = gateway; }
}
```

## 2. Bean lifecycle

Know the phases: instantiation → population (DI) → `Aware` callbacks → `BeanPostProcessor` (before/after init) → `@PostConstruct` → custom `init` → ready → `@PreDestroy` on shutdown. Interviewers love "what runs when" questions.

## 3. Auto-configuration

- **`@SpringBootApplication`** bundles `@Configuration`, `@ComponentScan`, `@EnableAutoConfiguration`.
- Auto-config works via `spring.factories` / `AutoConfiguration.imports` + `@ConditionalOnClass` / `@ConditionalOnMissingBean`. A senior can explain _why_ a starter activates only when a class is on the classpath, and how to override it.
- **Trap:** letting auto-config hide what's actually running. Know your actuator endpoints and what beans exist.

## 4. Transaction management

- **`@Transactional`** is proxy-based — it does **not** work on self-invocation (calling another `@Transactional` method on `this`). Know why.
- **Propagation:** REQUIRED (join/existing), REQUIRES_NEW (suspend), NESTED.
- **Isolation** maps to DB levels; default is usually DB default (READ_COMMITTED for many).
- **Rollback rules:** defaults rollback on RuntimeException, not checked exceptions — a classic trap.

## 5. Common production pitfalls

- Blocking I/O inside a web request without a thread pool; N+1 from lazy loading; unbounded in-memory caches; missing timeouts on `RestTemplate`/`WebClient` calls; acting on stale `@Cacheable` data.

## 6. Self-check

- [ ] Constructor vs field injection, and why constructor wins.
- [ ] Why `@Transactional` fails on self-invocation.
- [ ] How auto-configuration decides to activate.
- [ ] One Spring Boot production incident you debugged.

That's the Spring Boot bar.
