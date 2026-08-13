---
title: "Java Interview Prep #3: Spring Boot — Junior to Senior"
description: "Spring Boot is where Java backend seniors live. IoC/DI, the bean lifecycle, transaction management, and the auto-configuration magic interviewers expect you to see through — with code, not just annotations."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Spring Boot is where "I know Java" meets "I can run a backend". Junior developers autowire and hope; seniors understand the container, the proxy, and the transaction boundary — and can show the exact code where `@Transactional` silently fails. This post walks from `@Autowired` to "why is my transaction not rolling back", with runnable examples.

> Mindset: junior uses the annotations; senior can draw the bean lifecycle and explain exactly when a proxy wraps their method — and when it doesn't.

## Junior — foundations

**Q1. What is IoC and DI in Spring?**
Inversion of Control: the framework owns object creation and wiring. Dependency Injection pushes dependencies in (constructor, setter, field). Constructor injection is preferred — immutable, testable, fails fast on a missing dependency.

```java
// WRONG: field injection — not testable without Spring, hides required deps
@Autowired private UserRepository repo;

// RIGHT: constructor injection — final, testable, explicit
@Service
public class UserService {
  private final UserRepository repo;
  public UserService(UserRepository repo) { this.repo = repo; }
}
```

**Q2. `@Component` vs `@Service` vs `@Repository` vs `@Controller`?**
All are `@Component` stereotypes auto-scanned into beans. `@Repository` adds persistence exception translation; `@Service`/`@Controller` are semantic markers for readers and AOP.

**Q3. What is the default bean scope?**
**Singleton** — one shared instance per container. A common bug: injecting a `prototype` into a `singleton` captures one instance at wiring time, not a fresh one per call. Use `ObjectProvider` for true per-call:

```java
@Service
public class OrderService {
  private final ObjectProvider<PriceCalculator> calculators;
  public PriceCalculator current() { return calculators.getObject(); } // fresh each call
}
```

**Q4. What does `@SpringBootApplication` do?**
It composes `@Configuration` + `@EnableAutoConfiguration` (wires beans from the classpath) + `@ComponentScan` (scans the package and below). That's why the main class must sit in a root package above your components.

**Q5. `@RequestParam` vs `@PathVariable` vs `@RequestBody`?**
`?q=5` → `@RequestParam`; `/users/5` → `@PathVariable`; JSON body → `@RequestBody`. Mixing them is a frequent 400/405 bug.

**Q6. `@Bean` vs `@Component`?**
`@Component` is class-level, auto-detected. `@Bean` is method-level in a `@Configuration` class — use it to wrap a third-party object you don't own:

```java
@Configuration
public class AppConfig {
  @Bean
  public RestTemplate restTemplate() { return new RestTemplateBuilder().setConnectTimeout(Duration.ofSeconds(3)).build(); }
}
```

## Mid — tradeoffs & pitfalls

**Q1. Why is my `@Transactional` not rolling back?**
Three classic causes — and the code that fixes each:

```java
// 1) you swallowed the exception -> Spring never sees it
@Transactional
public void transfer() {
  try { debit(); credit(); }
  catch (Exception e) { log.error(e); }   // WRONG: swallowed -> commits!
}
// FIX: let it propagate (or @Transactional(rollbackFor=...))

// 2) self-invocation bypasses the proxy -> no transaction
public void outer() { this.inner(); }     // WRONG: direct call, no proxy
@Transactional public void inner() { ... }
// FIX: move inner() to another @Service bean

// 3) private/final -> proxy can't intercept
@Transactional private void foo() { }      // WRONG: never proxied
```

**Q2. How does `@Transactional` actually work — the proxy?**
Spring wraps your bean in a proxy. A proxied `@Transactional` method opened through the proxy starts a connection/transaction before your method and commits/rolls back after. A call that doesn't go through the proxy (same-class self-call, or `new`) has no transaction. That's why `private`/`final` silently skip it.

**Q3. `CrudRepository` vs `JpaRepository` vs `EntityManager`?**
`CrudRepository` → basic CRUD; `JpaRepository` adds pagination + batch ops. Both are Spring Data over JPA. For raw control drop to `EntityManager`. Overusing `save()` in a loop without flush/clear can blow the persistence context — batch with `saveAllAndFlush`:

```java
// WRONG: 10k entities accumulate in the PC before one flush
for (Order o : orders) repo.save(o);
// RIGHT: flush + clear every 500
int i = 0;
for (Order o : orders) { repo.save(o); if (++i % 500 == 0) { repo.flush(); entityManager.clear(); } }
```

**Q4. How does auto-configuration work, and how do you debug a missing bean?**
Auto-config classes are conditioned on classpath + `@ConditionalOnMissingBean`. If a bean is missing, a condition failed. Debug with `--debug` startup (prints positive/negative auto-config matches) or `spring.autoconfigure.exclude`.

**Q5. `@ControllerAdvice` vs `Filter`?**
`@ExceptionHandler` in `@ControllerAdvice` catches exceptions from a controller (inside DispatcherServlet) and returns a structured body — but not pre-controller failures (filter/auth). A `Filter` sits earlier and catches everything:

```java
@ControllerAdvice
public class ApiErrors {
  @ExceptionHandler(NotFound.class)
  public ResponseEntity<ErrorBody> handle(NotFound e) {
    return ResponseEntity.status(404).body(new ErrorBody(e.getMessage()));
  }
}
```

**Q6. How do you externalize config across environments?**
Profile files (`application-prod.yml`) activated by `spring.profiles.active`; env vars override (`SPRING_DATASOURCE_URL` overrides `spring.datasource.url`). Never hardcode credentials — inject from env/secret store. `@ConfigurationProperties` binds a typed object (better than `@Value` for structured config).

## Senior — design & defense

**Q1. A `@Transactional` service is slow under load — you suspect long-lived transactions. Diagnose and fix.**
"I'd confirm the transaction spans too much: enable `spring.jpa.show-sql` and trace where the connection is held. Often the method does a slow external call (HTTP, another DB) inside the transaction — holding a DB connection for seconds exhausts the pool (`HikariPool` waits, then `ConnectionTimeoutException` after the default 30 s). Fix: move the external call _outside_ the transaction, keep the TX to minimal DB writes, and set `@Transactional(timeout=3)` so a runaway TX fails fast. I measure pool wait time before/after — target near zero."

**Q2. Design a clean layered architecture without leaking the persistence layer.**
"Controller → Service (`@Transactional`) → Repository. The service returns DTOs, never JPA entities, to the controller — otherwise lazily-loaded collections throw `LazyInitializationException` in the serializer. Map entities→DTOs at the service boundary (MapStruct or manual). Repositories stay behind the service; controllers never touch them. This keeps the transaction boundary inside the service and serialization outside it — the `OpenEntityManagerInView` trap disappears."

```java
// WRONG: returns the entity -> lazy collections blow up in JSON serialization
public UserEntity get(Long id) { return repo.findById(id).orElseThrow(); }
// RIGHT: map to a DTO at the boundary
public UserDto get(Long id) { return repo.findById(id).map(UserDto::from).orElseThrow(); }
```

**Q3. You need two beans of the same type — wire them unambiguously.**
"Qualify them: `@Qualifier("primary")` on the bean and the injection point, or give distinct types via interfaces. A cleaner pattern is injecting a `List<Handler>` and dispatching by a key rather than picking one bean:"

```java
@Bean @Qualifier("stripe") public PaymentGateway stripe() { return new StripeGateway(); }
@Bean @Qualifier("paypal") public PaymentGateway paypal() { return new PaypalGateway(); }

@Autowired @Qualifier("stripe") PaymentGateway gateway;  // explicit
```

**Q4. Explain the bean lifecycle and where AOP weaves in.**
"Instantiation → populate → aware callbacks → `BeanPostProcessor.before` → `@PostConstruct` → `InitializingBean.afterPropertiesSet` → `BeanPostProcessor.after` → ready. Proxy creation and AOP weaving happen in the `BeanPostProcessor` phases — that's the only place Spring can wrap your bean. I use `@PostConstruct` for init, avoid `InitializingBean` (couples to Spring)."

**Q5. When would you NOT use Spring Boot?**
"For a tiny CLI or a latency-critical path where the ~hundreds of MB footprint and reflection-based startup (seconds) hurt, I'd consider Micronaut/Quarkus with build-time DI (sub-second startup, low memory) or plain Java. Spring Boot wins on ecosystem and hiring; for serverless cold-start-sensitive or tiny workloads, compile-time DI frameworks are the better trade. I'd decide on startup budget and memory ceiling, not habit."

**Q6. Defend a config strategy at 50 services.**
"One `spring-cloud-config` (Git-backed) with per-service overrides; connection strings and secrets come from the platform (K8s ConfigMap/Secret), never committed. I use `@ConfigurationProperties` for typed binding and fail-fast on missing required keys (`@Validated`). At 50 services, consistency of naming and a single source of truth matter more than convenience — I enforce it via a shared starter module, not copy-paste. Measured benefit: a secret rotation touches one place, not 50 repos."

#### Self-check

- [ ] Junior: I can explain IoC/DI (with constructor injection), the stereotypes, singleton scope, `@SpringBootApplication`, and `@RequestBody` vs `@PathVariable` — with code.
- [ ] Mid: I can show why `@Transactional` silently fails (swallow/self-invoke/private) with code, how auto-config conditions work, and `@ControllerAdvice` vs `Filter`.
- [ ] Senior: I can diagnose long-lived-transaction pool exhaustion (default 30 s timeout), design a layered architecture with DTO mapping, wire two beans unambiguously, explain the lifecycle + AOP weave point, and defend Spring Boot vs compile-time-DI by startup/memory budget.
