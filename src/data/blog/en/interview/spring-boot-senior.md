---
title: "Java Interview Prep #3: Spring Boot — Junior to Senior"
description: "Spring Boot is where Java backend seniors live. IoC/DI, the bean lifecycle, transaction management, and the auto-configuration magic interviewers expect you to see through — 50 questions with code, not just annotations."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Spring Boot is where "I know Java" meets "I can run a backend". Junior developers autowire and hope; seniors understand the container, the proxy, and the transaction boundary — and can show the exact code where `@Transactional` silently fails. 50 questions, from `@Autowired` to "why is my transaction not rolling back", with runnable examples.

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
All are `@Component` stereotypes auto-scanned into beans. `@Repository` adds persistence exception translation; `@Service`/`@Controller` are semantic markers. A class can carry multiple stereotypes but one is conventional.

**Q3. What is the default bean scope?**
**Singleton** — one shared instance per container. A common bug: injecting a `prototype` into a `singleton` captures one instance at wiring time, not a fresh one per call. Use `ObjectProvider` for true per-call:

```java
@Service
public class OrderService {
  private final ObjectProvider<PriceCalculator> calculators;
  public PriceCalculator current() { return calculators.getObject(); }
}
```

**Q4. What does `@SpringBootApplication` do?**
It composes `@Configuration` + `@EnableAutoConfiguration` (wires beans from the classpath) + `@ComponentScan` (scans the package and below). The main class must sit in a root package above your components.

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

**Q7. What is `@Autowired` on a constructor — needed or not?**
Since Spring 4.3, a single-constructor class is autowired implicitly; you can drop `@Autowired`. With multiple constructors you must mark the one Spring should use. Prefer the implicit single-constructor form — less noise.

**Q8. What is the difference between `@Value` and `@ConfigurationProperties`?**
`@Value("${db.url}")` injects a single property (stringly-typed, easy to typo). `@ConfigurationProperties("db")` binds a typed object (`db.url`, `db.pool-size`) — better for structured config, with relaxed binding and validation via `@Validated`.

**Q9. What does `@PostConstruct` do, and when does it run?**
It marks a method to run once after dependency injection completes, before the bean is used. Use it for init that needs other beans. Avoid heavy work there (it blocks startup). For cleanup, `@PreDestroy`.

**Q10. What is the difference between `@Controller` and `@RestController`?**
`@Controller` returns a view name (server-rendered templates); `@RestController` is `@Controller` + `@ResponseBody` — returns the serialized body (JSON) directly. For an API, always `@RestController`.

**Q11. How do you inject a `List` of all beans of a type?**
Spring auto-collects them: `public MyService(List<Handler> handlers)`. Useful for strategy dispatch. Order with `@Order` or `Ordered`. This is how Spring itself wires multiple `Filter`s/`HandlerMethodArgumentResolver`s.

**Q12. What is `application.properties` vs `application.yml`?**
Both configure the app; `yml` supports nested hierarchical structure (easier for deep config), `properties` is flat key=value. They're interchangeable; choose for readability. Wrong YAML indentation is a silent misconfiguration — a top failure mode.

**Q13. What is a stereotype annotation vs a meta-annotation?**
`@Service` is itself `@Component` — a _meta-annotation_. Creating your own `@OrderService` meta-annotated with `@Service` + `@Transactional` composes behavior. This is how Spring's own annotations stack.

**Q14. What does `spring.profiles.active` do?**
It selects active profile(s), loading `application-{profile}.yml` and `@Profile("prod")` beans. Default profile is always active. Use it to swap config per environment without code changes.

**Q15. What is the difference between `@Import` and `@ComponentScan`?**
`@ComponentScan` finds annotated classes on the classpath within a package. `@Import` explicitly registers specific config/beans (including auto-config classes). Use `@Import` for precise wiring of third-party configs.

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
Auto-config classes are conditioned on classpath + `@ConditionalOnMissingBean`. If a bean is missing, a condition failed. Debug with `--debug` startup (prints positive/negative matches) or `spring.autoconfigure.exclude`.

**Q5. `@ControllerAdvice` vs `Filter`?**
`@ExceptionHandler` in `@ControllerAdvice` catches exceptions from a controller (inside DispatcherServlet) and returns a structured body — but not pre-controller failures (filter/auth). A `Filter` sits earlier:

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

**Q7. What is the difference between `@Transactional(readOnly=true)` and a normal transaction?**
`readOnly=true` hints the persistence provider to skip dirty checking and flush (a ~10–20% read-path speedup) and lets some databases use read replicas. It's a hint, not enforced — writes can still happen, but it optimizes the common case. Use it on query-only methods.

**Q8. What is `LazyInitializationException` and why does it happen?**
An entity's lazy collection (`@OneToMany(fetch=LAZY)`) is accessed after the session/transaction closed → exception. Common when returning entities to the controller (session already closed). Fix: fetch eagerly where needed (`JOIN FETCH`), or use DTOs mapped inside the transaction.

**Q9. What is the difference between `@Query` and derived method names?**
`findByUsername(String)` is derived by naming convention (Spring parses it). `@Query("select u from User u where u.username=:u")` is explicit JPQL. Derived names break silently on typo; `@Query` is explicit and supports joins/complex logic. Prefer `@Query` for anything non-trivial.

**Q10. What does `spring.jpa.open-in-view` do, and why disable it?**
It keeps the JPA `EntityManager` open for the whole request (so lazy loads work in the view), but holds a DB connection for the entire request — including after your business logic finished. Disable it (`false`) to release connections earlier; then fetch everything you need inside the transaction. Default is `true` — a common prod culprit for pool exhaustion.

**Q11. What is the difference between `@MockBean` and `@Mock`?**
`@MockBean` registers a mock as a Spring bean (replacing the real one in the context) — for `@SpringBootTest`. `@Mock` (Mockito) is a standalone mock for plain unit tests. Mixing them up means your mock isn't wired into the context.

**Q12. How do you handle a `@Scheduled` method that overlaps?**
`@Scheduled(fixedRate=5s)` starts every 5s even if the previous run hasn't finished → overlapping executions. Use `fixedDelay=5s` (waits for completion) or a `@Scheduled` + `@Transactional` + a leader-lock (ShedLock) so only one node runs in a cluster. Without it, two pods double-execute.

**Q13. What is the difference between `@RequestMapping` and the specific verbs?**
`@GetMapping`, `@PostMapping`, etc. are shortcuts for `@RequestMapping(method=GET)`. They're clearer and reduce the chance of a wrong-method bug. Use the specific verbs.

**Q14. What is a `BeanPostProcessor`?**
A hook that runs on every bean after instantiation (and before/after init). AOP proxies, `@Autowired` resolution, and `@PostConstruct` all happen here. It's the seam where Spring weaves in cross-cutting behavior. Writing one is advanced; recognizing one explains half of Spring's magic.

**Q15. What is the difference between `@Transactional` propagation REQUIRED vs REQUIRES_NEW?**
`REQUIRED` (default) joins the existing transaction or creates one. `REQUIRES_NEW` always suspends the current and starts a fresh one — the inner commit/rollback is independent. Use `REQUIRES_NEW` for audit logging that must persist even if the outer rolls back (e.g. logging a failed payment).

**Q16. What is the difference between `@Cacheable` and manual caching?**
`@Cacheable` (with `@EnableCaching`) caches method return values keyed by arguments, transparently. Pitfall: caching a method whose result depends on non-argument state (stale cache), or caching `null`/mutable objects. Invalidate with `@CacheEvict`. It's ~microseconds to fetch from a local cache vs ~ms for a DB call.

**Q17. What is the difference between `@Async` and a thread pool?**
`@Async` runs a method on a separate thread from a `TaskExecutor` (default `SimpleAsyncTaskExecutor`, unbounded — dangerous). Configure a bounded `ThreadPoolTaskExecutor` and set `@Async("myExecutor")`. Without a bounded pool, `@Async` can spawn unlimited threads.

## Senior — design & defense

**Q1. A `@Transactional` service is slow under load — you suspect long-lived transactions. Diagnose and fix.**
"I'd confirm the transaction spans too much: enable `spring.jpa.show-sql` and trace where the connection is held. Often the method does a slow external call (HTTP, another DB) inside the transaction — holding a DB connection for seconds exhausts the pool (`HikariPool` waits, then `ConnectionTimeoutException` after the default 30 s). Fix: move the external call _outside_ the transaction, keep the TX to minimal DB writes, and set `@Transactional(timeout=3)`. I measure pool wait time before/after — target near zero."

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
"Instantiation → populate → aware callbacks → `BeanPostProcessor.before` → `@PostConstruct` → `InitializingBean.afterPropertiesSet` → `BeanPostProcessor.after` → ready. Proxy creation and AOP weaving happen in the `BeanPostProcessor` phases — the only place Spring can wrap your bean. I use `@PostConstruct` for init, avoid `InitializingBean` (couples to Spring)."

**Q5. When would you NOT use Spring Boot?**
"For a tiny CLI or a latency-critical path where the ~hundreds of MB footprint and reflection-based startup (seconds) hurt, I'd consider Micronaut/Quarkus with build-time DI (sub-second startup, low memory) or plain Java. Spring Boot wins on ecosystem and hiring; for serverless cold-start-sensitive or tiny workloads, compile-time DI frameworks are the better trade. I'd decide on startup budget and memory ceiling, not habit."

**Q6. Defend a config strategy at 50 services.**
"One `spring-cloud-config` (Git-backed) with per-service overrides; connection strings and secrets come from the platform (K8s ConfigMap/Secret), never committed. I use `@ConfigurationProperties` for typed binding and fail-fast on missing required keys (`@Validated`). At 50 services, consistency of naming and a single source of truth matter more than convenience — I enforce it via a shared starter module, not copy-paste. Measured benefit: a secret rotation touches one place, not 50 repos."

**Q7. `@Transactional` on a public method called from another `@Transactional` — what happens with NESTED/REQUIRED?**
"With default `REQUIRED`, the inner call joins the outer transaction (one shared connection) — they commit/rollback together. `NESTED` (if the DB supports savepoints, e.g. PostgreSQL/JDBC) creates a savepoint so the inner can roll back independently while the outer continues. `REQUIRES_NEW` fully suspends the outer. I pick based on whether a partial failure should abort the whole operation or just a step."

**Q8. How do you test a `@Transactional` service without a real DB?**
"Use `@DataJpaTest` (an in-memory H2 by default, ~1 s) for repository layer, and `@SpringBootTest` with `spring.test.context.cache` + Testcontainers Postgres for integration parity. For the service, mock the repository with `@MockBean` and assert the transactional method delegates correctly. I avoid booting the full context for unit tests (~20–30 s each) — that's what slows a suite to minutes."

**Q9. A custom `@RestControllerAdvice` isn't catching an exception. Why?**
"It only catches exceptions thrown _within_ a controller's request mapping (inside DispatcherServlet). Exceptions from filters, Spring Security, or argument resolvers happen earlier and aren't caught. Also, if you have multiple `@ControllerAdvice` with overlapping `@ExceptionHandler`, the most specific wins. For pre-controller failures, use a `Filter` or Spring Security's entry point."

**Q10. How do you size and monitor the HikariCP connection pool?**
"`maximumPoolSize` from Little's Law (~10–30 for typical services, not 200); `connectionTimeout` 30 s; `idleTimeout` and `maxLifetime` set below the DB's `wait_timeout` (e.g. maxLifetime 28 min vs MySQL 30 min, to avoid 'connection closed' mid-use). I expose Hikari's `HikariPoolMXBean` metrics (active/idle/awaiting) and alert on `awaiting > 0` sustained — that's pool exhaustion before it becomes a 30 s timeout storm."

**Q11. `@Async` method swallows exceptions silently. How do you catch them?**
"`@Async` runs on another thread, so exceptions don't propagate to the caller — they're logged and lost. Fix: provide an `AsyncUncaughtExceptionHandler` via `AsyncConfigurer`, or return `CompletableFuture` and handle its exception. I always return `CompletableFuture` from `@Async` methods so callers can observe failure."

**Q12. How do you prevent `@Cacheable` from serving stale data across deploys?**
"Cache entries survive a restart only if backed by a distributed store (Redis); an in-memory cache is empty after deploy (cold, then repopulates — a brief stampede). For correctness across deploys, use a shared Redis cache with a TTL shorter than the data's staleness tolerance, and `@CacheEvict` on writes. I set TTLs so the worst case is 'serve up-to-TTL-old data', never indefinite staleness."

**Q13. A scheduled job runs twice in production (two pods). Fix it.**
"Plain `@Scheduled` runs on every instance. In a cluster you need a leader lock. Use ShedLock (`@SchedulerLock`) which takes a DB/Redis lock so only one node executes. Or run the job in a single dedicated cron pod. Without it, every pod runs it → double emails, double charges. I treat scheduling as a distributed concern, not a per-instance one."

**Q14. How do you make a Spring Boot app start fast (sub-second)?**
"Lazy initialization (`spring.main.lazy-initialization=true`) defers bean creation until first use (cuts startup but adds first-request latency). Compile-time DI (Micronaut/Quarkus) beats Spring's reflection-based startup. Trim auto-config (exclude unused via `spring.autoconfigure.exclude`). For serverless, consider a GraalVM native image (startup ~10–50 ms, but build is ~minutes and not all libs are compatible). I measure startup and pick the cheapest that meets the cold-start SLA."

**Q15. What is the difference between `@MockBean` in `@SpringBootTest` and a slice test?**
"A full `@SpringBootTest` boots the entire context (~20–30 s). Slice tests (`@WebMvcTest`, `@DataJpaTest`, `@JsonTest`) boot only the relevant layer (~1–3 s). Using full-context tests for everything makes a suite take minutes. I use slices for 90% of tests and full-context only for true integration points. Measured: 200 slice tests run in ~30 s vs ~10 min for the equivalent full-context suite."

**Q16. How do you debug a `NoSuchBeanDefinitionException`?**
"The bean isn't in the context — causes: component not scanned (wrong package, no `@Component`), conditional exclusion (`@Profile`/`@ConditionalOn...` false), or it's abstract/interface without an impl. Run with `--debug` to see the auto-config report, grep for the bean name, and check which condition failed (`Negative matches`). 9/10 times it's a package outside `@ComponentScan`."

**Q17. Design for zero-downtime config changes at 50 services.**
"Config via `spring-cloud-config` with `@RefreshScope` beans; `/actuator/refresh` (or a bus event) reloads them without restart. But `@RefreshScope` re-creates beans — connections in a `@RefreshScope` `@Bean` get closed/reopened, so scope connection pools carefully or you'll drop in-flight requests. I scope only the config-bearing beans, not the pools, and test refresh under load to confirm no connection churn."

**Q18. How do you defend `@Transactional` boundaries when the service calls 3 other services?**
"You usually should NOT wrap 3 remote calls in one DB transaction — the transaction holds a DB connection for the duration of all 3 network calls (seconds), exhausting the pool. Options: (1) do the local DB write first, commit, then call the services (saga-style with compensation); (2) use an outbox to publish events after commit. I keep the transaction to the DB-only work and treat cross-service calls as a separate, compensatable step. Holding a TX across network calls is the #1 cause of pool exhaustion I see."

#### Self-check

- [ ] Junior: I can explain IoC/DI (with constructor injection), the stereotypes, singleton scope, `@SpringBootApplication`, and `@RequestBody` vs `@PathVariable` — with code.
- [ ] Mid: I can show why `@Transactional` silently fails (swallow/self-invoke/private) with code, how auto-config conditions work, `@ControllerAdvice` vs `Filter`, and OpenEntityManagerInView.
- [ ] Senior: I can diagnose long-lived-transaction pool exhaustion (default 30 s timeout), design a layered architecture with DTO mapping, wire two beans unambiguously, explain the lifecycle + AOP weave point, size/monitor HikariCP, and defend transaction boundaries across service calls.
