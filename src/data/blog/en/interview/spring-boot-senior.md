---
title: "Java Interview Prep #3: Spring Boot — Junior to Senior"
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

Spring Boot is where "I know Java" meets "I can run a backend". Junior developers autowire and hope; seniors understand the container, the proxy, and the transaction boundary. This post walks from `@Autowired` to "why is my `@Transactional` silently not working".

> Mindset: junior uses the annotations; senior can draw the bean lifecycle and explain exactly when a proxy wraps their method — and when it doesn't.

## Junior — foundations

**Q1. What is IoC and DI in Spring?**
Inversion of Control: the framework, not your code, owns object creation and wiring. Dependency Injection is the mechanism — dependencies are pushed in (constructor, setter, or field) rather than fetched. Net effect: classes declare what they need, Spring supplies it. Constructor injection is preferred (immutable, testable, fails fast on missing deps).

**Q2. What is the difference between `@Component`, `@Service`, `@Repository`, `@Controller`?**
They are all stereotypes of `@Component` (so they're scanned and registered as beans). The subtypes are semantic markers: `@Repository` adds persistence exception translation (turns JDBC/ORM exceptions into Spring's `DataAccessException`), `@Service` marks business logic, `@Controller`/`@RestController` handle HTTP. Functionally they create beans; the labels guide readers and AOP.

**Q3. What is the bean scope default, and what scopes exist?**
Default is **singleton** — one shared instance per container. Others: `prototype` (new instance per request), `request`/`session` (per HTTP request/session, web only), `application`. A common bug: injecting a `prototype` bean into a `singleton` gives you one instance captured at wiring time — not a fresh one per call. Use `ObjectProvider` or lookup methods for true per-call semantics.

**Q4. What does `@SpringBootApplication` do?**
It is a composite of `@Configuration` (bean definitions), `@EnableAutoConfiguration` (magically wires beans based on classpath — see `spring.factories`/auto-config imports), and `@ComponentScan` (scans the package and below). That is why your main class must sit in a root package above your components.

**Q5. What is the difference between `@RequestParam`, `@PathVariable`, `@RequestBody`?**
`@RequestParam` binds a query/form parameter (`?id=5`), `@PathVariable` binds a URI template segment (`/users/{id}`), `@RequestBody` deserializes the HTTP body (JSON) into an object. Mixing them up is a frequent 400/405 bug.

**Q6. What is the difference between `@Bean` and `@Component`?**
`@Component` (and friends) is class-level, auto-detected by scanning. `@Bean` is method-level, inside a `@Configuration` class, giving you explicit control over construction (e.g. wrapping a third-party object you don't own). Use `@Bean` for objects whose source you don't control; `@Component` for your own classes.

## Mid — tradeoffs & pitfalls

**Q1. Why is my `@Transactional` method not rolling back?**
Three classic causes: (1) you caught the exception and swallowed it — Spring only rolls back on a thrown `RuntimeException` (or explicitly `rollbackFor`); (2) you called the method **from within the same class** — self-invocation bypasses the proxy, so no transaction is opened; (3) the method is `private`/`final` — the proxy can't intercept it. The fix: throw, move the call to another bean, or use `TransactionTemplate` for self-calls.

**Q2. How does `@Transactional` actually work — what is the proxy?**
Spring wraps your bean in a proxy. When a proxied `@Transactional` method is called _through the proxy_, it opens a connection/transaction before invoking your method and commits/rolls back after. If the call doesn't go through the proxy (same-class self-call, or you instantiated the object yourself with `new`), there is no transaction. That is why final/private methods silently skip it.

**Q3. What is the difference between `CrudRepository`, `JpaRepository`, and a plain `EntityManager`?**
`CrudRepository` gives basic CRUD; `JpaRepository` extends it with pagination, flushing, and batch ops. Both are Spring Data abstractions over JPA. For raw control (native SQL, fine-grained flush) you drop to `EntityManager`. Overusing `JpaRepository.save()` in a loop without `flush`/`clear` can blow the persistence context — batch with `saveAllAndFlush` and consider `EntityManager.clear()` between chunks.

**Q4. What does auto-configuration do, and how do you debug "why is this bean missing"?**
Auto-config classes are conditioned on classpath + absence of your own bean (`@ConditionalOnMissingBean`, `@ConditionalOnClass`). If a bean isn't created, something on the classpath is missing or a condition failed. Debug with `--debug` startup logs (prints all auto-config report: positive/negative matches) or `spring.autoconfigure.exclude`. Don't fight it by `@ComponentScan`-ing randomly — read the report.

**Q5. What is the difference between `@ControllerAdvice` and a `Filter`?**
A `@ControllerAdvice` with `@ExceptionHandler` catches exceptions thrown _from a controller_ and returns a structured response — but it runs inside the DispatcherServlet, so it won't catch errors before that (e.g. filter/auth failures, or exceptions in a `Filter`). A `Filter`/`HandlerInterceptor` sits earlier in the chain and can catch/auth everything including non-controller paths. Use the advice for uniform API error shapes; use a filter for cross-cutting pre-controller concerns.

**Q6. How do you externalize config and handle multiple environments?**
`application.yml`/`properties` with profile-specific files (`application-prod.yml`), activated by `spring.profiles.active`. Values come from env vars / secrets manager overriding the file (Spring's relaxed binding: `SPRING_DATASOURCE_URL` overrides `spring.datasource.url`). Never hardcode credentials — inject from env or a secret store. `@ConfigurationProperties` binds a typed object from the tree, better than `@Value` for structured config.

## Senior — design & defense

**Q1. A `@Transactional` service is slow under load — you suspect long-lived transactions. Diagnose and fix.**
"I'd first confirm the transaction spans too much: enable `spring.jpa.show-sql` / actutator and trace where the connection is held. Often the method does a slow external call (HTTP, another DB) inside the transaction — that holds a DB connection for seconds and exhausts the pool (`HikariPool` waits, then `ConnectionTimeoutException`). Fix: move the external call _outside_ the transaction, keep the TX to the minimal DB writes, and set `@Transactional(timeout=3)` so a runaway TX fails fast instead of pinning a connection. I'd measure pool wait time before/after — target near zero."

**Q2. Design a clean layered architecture with Spring without leaking the persistence layer.**
"Controller → Service (`@Transactional`) → Repository. The service returns domain objects or DTOs, never JPA entities, to the controller — otherwise lazily-loaded collections throw `LazyInitializationException` in the serializer. I map entities→DTOs at the service boundary (MapStruct or manual). Repositories stay behind the service; controllers never touch them. This keeps the transaction boundary inside the service and the serialization outside it — the classic `OpenEntityManagerInView` trap disappears."

**Q3. You need two beans of the same type — how do you wire them without ambiguity?**
"I qualify them: `@Qualifier("primary")` on the bean and the injection point, or better, give the beans distinct types via interfaces so there's no ambiguity at all. A cleaner pattern is `@Bean` methods returning the interface with named methods, then inject by the specific subtype. Avoid `@Primary` as a silent default — it hides intent. If it's truly a strategy, pass a `List<Handler>` and dispatch by a key rather than picking one bean."

**Q4. Explain the bean lifecycle and where you'd hook in custom logic.**
"Instantiation → populate properties → aware callbacks (`BeanNameAware`, etc.) → `BeanPostProcessor.before` → `@PostConstruct` → `InitializingBean.afterPropertiesSet` → `BeanPostProcessor.after` → ready → on shutdown `@PreDestroy`/`DisposableBean`. For cross-cutting setup I use a `BeanPostProcessor` or `@PostConstruct`; for one bean's init, `@PostConstruct`. I avoid `InitializingBean` (couples to Spring) in favor of `@PostConstruct`. A senior knows the order because it's where proxy creation and AOP weaving actually happen."

**Q5. When would you NOT use Spring Boot, and what would you reach for?**
"For a tiny CLI or a latency-critical path where the ~hundreds of MB footprint and reflection-based startup (seconds) hurt, I'd consider a framework like Micronaut or Quarkus with build-time DI (sub-second startup, low memory) or even plain Java. Spring Boot wins on ecosystem and hiring; for serverless cold-start-sensitive or resource-tiny workloads, compile-time DI frameworks are the better trade. I'd decide on startup budget and memory ceiling, not habit."

**Q6. Defend a microservice's Spring config strategy at scale (50 services).**
"One shared `spring-cloud-config` or a Git-backed config server, with per-service overrides and env-specific values injected from the platform (K8s ConfigMap/Secret). I keep `application.yml` minimal — connection strings and secrets come from the environment, never committed. I use `@ConfigurationProperties` for typed binding and fail-fast on missing required keys (`@Validated`). At 50 services, consistency of naming and a single source of truth for shared settings matters more than convenience — I'd enforce it via a shared starter module rather than copy-paste."

#### Self-check

- [ ] Junior: I can explain IoC/DI, the stereotype annotations, default singleton scope, and `@RequestBody` vs `@PathVariable`.
- [ ] Mid: I can explain why `@Transactional` silently fails (proxy/self-invoke/catch), how auto-config conditions work, and `@ControllerAdvice` vs `Filter`.
- [ ] Senior: I can diagnose long-lived-transaction pool exhaustion, design a clean layered architecture with DTO mapping, wire multiple beans unambiguously, and defend Spring Boot vs compile-time-DI frameworks by startup/memory budget.
