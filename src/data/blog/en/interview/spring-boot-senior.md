---
title: "Java Interview Prep #3: Spring Boot — Junior to Senior"
description: "Spring Boot is where senior Java backend developers work. IoC/DI, the bean lifecycle, transaction management, and the auto-configuration magic that interviewers expect you to see through — 50 questions with code, not just annotations."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Spring Boot is where "I know Java" meets "I can run a backend." Junior developers autowire and hope; seniors understand the container, proxies, and transaction boundaries, and can show the exact code in which `@Transactional` silently fails. These 50 questions range from `@Autowired` to "why isn't my transaction rolling back?" and include runnable examples.

> Mindset: a junior uses annotations; a senior can draw the bean lifecycle and explain exactly when a proxy wraps a method, and when it does not.

## Junior — foundations

**Q1. What is IoC and DI in Spring?**
Inversion of Control means the framework owns object creation and wiring. Dependency Injection supplies dependencies through a constructor, setter, or field. Constructor injection is preferred because it supports immutability and testing and fails fast when a dependency is missing.

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
All are `@Component` stereotypes that are automatically scanned into beans. `@Repository` adds persistence-exception translation, while `@Service` and `@Controller` are semantic markers. A class can carry multiple stereotypes, but using one is the convention.

**Q3. What is the default bean scope?**
**Singleton** means one shared instance per container. A common bug is injecting a `prototype` into a `singleton`, which captures one instance at wiring time rather than creating a fresh one for each call. Use `ObjectProvider` for true per-call instances:

```java
@Service
public class OrderService {
  private final ObjectProvider<PriceCalculator> calculators;
  public PriceCalculator current() { return calculators.getObject(); }
}
```

**Q4. What does `@SpringBootApplication` do?**
It combines `@Configuration`, `@EnableAutoConfiguration` (which wires beans from the classpath), and `@ComponentScan` (which scans the package and its subpackages). The main class must be in a root package above your components.

**Q5. `@RequestParam` vs `@PathVariable` vs `@RequestBody`?**
`?q=5` → `@RequestParam`; `/users/5` → `@PathVariable`; JSON body → `@RequestBody`. Confusing them is a frequent cause of 400/405 errors.

**Q6. `@Bean` vs `@Component`?**
`@Component` is a class-level annotation and is detected automatically. `@Bean` is a method-level annotation used in a `@Configuration` class; use it to wrap a third-party object you do not own:

```java
@Configuration
public class AppConfig {
  @Bean
  public RestTemplate restTemplate() { return new RestTemplateBuilder().setConnectTimeout(Duration.ofSeconds(3)).build(); }
}
```

**Q7. What is `@Autowired` on a constructor — needed or not?**
Since Spring 4.3, a class with a single constructor is autowired implicitly, so you can omit `@Autowired`. With multiple constructors, you must mark the one Spring should use. Prefer the implicit single-constructor form to reduce noise.

**Q8. What is the difference between `@Value` and `@ConfigurationProperties`?**
`@Value("${db.url}")` injects a single property; it is stringly typed and easy to mistype. `@ConfigurationProperties("db")` binds a typed object (`db.url`, `db.pool-size`), making it better for structured configuration, with relaxed binding and validation through `@Validated`.

**Q9. What does `@PostConstruct` do, and when does it run?**
It marks a method to run once after dependency injection completes and before the bean is used. Use it for initialization that depends on other beans. Avoid heavy work there because it blocks startup. For cleanup, use `@PreDestroy`.

**Q10. What is the difference between `@Controller` and `@RestController`?**
`@Controller` returns a view name for server-rendered templates; `@RestController` combines `@Controller` and `@ResponseBody` and returns the serialized body, such as JSON, directly. For an API, use `@RestController`.

**Q11. How do you inject a `List` of all beans of a type?**
Spring collects them automatically: `public MyService(List<Handler> handlers)`. This is useful for strategy dispatch. Set their order with `@Order` or `Ordered`. This is how Spring itself wires multiple `Filter`s and `HandlerMethodArgumentResolver`s.

**Q12. What is `application.properties` vs `application.yml`?**
Both configure the application. `yml` supports nested, hierarchical structures, which are easier for deeply nested configuration, while `properties` uses flat `key=value` pairs. They are interchangeable; choose the format that is more readable. Incorrect YAML indentation causes silent misconfiguration and is a common failure mode.

**Q13. What is a stereotype annotation vs a meta-annotation?**
`@Service` is itself meta-annotated with `@Component`. Creating your own `@OrderService` meta-annotated with `@Service` and `@Transactional` lets you compose behavior. This is how Spring's own annotations are layered.

**Q14. What does `spring.profiles.active` do?**
It selects the active profiles, loading `application-{profile}.yml` and `@Profile("prod")` beans. The default profile is always active. Use profiles to switch configuration between environments without changing code.

**Q15. What is the difference between `@Import` and `@ComponentScan`?**
`@ComponentScan` finds annotated classes on the classpath within a package. `@Import` explicitly registers specific configurations or beans, including auto-configuration classes. Use `@Import` for precise wiring of third-party configurations.

## Mid — tradeoffs & pitfalls

**Q1. Why is my `@Transactional` not rolling back?**
There are three classic causes, each with a corresponding fix:

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
Spring wraps your bean in a proxy. A proxied `@Transactional` method invoked through that proxy starts a connection and transaction before the method runs, then commits or rolls back afterward. A call that does not go through the proxy, such as a same-class self-call or a call on an object created with `new`, has no transaction. That is why `private` and `final` methods silently bypass transactional behavior.

**Q3. `CrudRepository` vs `JpaRepository` vs `EntityManager`?**
`CrudRepository` provides basic CRUD; `JpaRepository` adds pagination and batch operations. Both are Spring Data abstractions over JPA. For lower-level control, use `EntityManager`. Overusing `save()` in a loop without flushing and clearing can overwhelm the persistence context; batch with `saveAllAndFlush`:

```java
// WRONG: 10k entities accumulate in the PC before one flush
for (Order o : orders) repo.save(o);
// RIGHT: flush + clear every 500
int i = 0;
for (Order o : orders) { repo.save(o); if (++i % 500 == 0) { repo.flush(); entityManager.clear(); } }
```

**Q4. How does auto-configuration work, and how do you debug a missing bean?**
Auto-configuration classes are conditional on the classpath and annotations such as `@ConditionalOnMissingBean`. If a bean is missing, one of those conditions failed. Debug startup with `--debug`, which prints positive and negative matches, or use `spring.autoconfigure.exclude`.

**Q5. `@ControllerAdvice` vs `Filter`?**
`@ExceptionHandler` in `@ControllerAdvice` catches exceptions from a controller inside `DispatcherServlet` and returns a structured body, but it does not catch failures that occur before the controller, such as filter or authentication failures. A `Filter` runs earlier:

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
Use profile files such as `application-prod.yml`, activated by `spring.profiles.active`. Environment variables override properties (`SPRING_DATASOURCE_URL` overrides `spring.datasource.url`). Never hardcode credentials; inject them from the environment or a secret store. `@ConfigurationProperties` binds a typed object and is better than `@Value` for structured configuration.

**Q7. What is the difference between `@Transactional(readOnly=true)` and a normal transaction?**
`readOnly=true` hints that the persistence provider can skip dirty checking and flushing, which can speed up read paths by roughly 10–20%, and allows some databases to use read replicas. It is only a hint, not an enforced restriction: writes can still occur, but the common case is optimized. Use it on query-only methods.

**Q8. What is `LazyInitializationException` and why does it happen?**
An entity's lazy collection (`@OneToMany(fetch=LAZY)`) is accessed after the session or transaction has closed, causing the exception. This commonly happens when entities are returned to the controller. Fix it by fetching the data eagerly where needed with `JOIN FETCH`, or by mapping the entities to DTOs inside the transaction.

**Q9. What is the difference between `@Query` and derived method names?**
`findByUsername(String)` is derived from a naming convention that Spring parses. `@Query("select u from User u where u.username=:u")` uses explicit JPQL. Derived names can fail because of a typo, while `@Query` is explicit and supports joins and complex logic. Prefer `@Query` for anything non-trivial.

**Q10. What does `spring.jpa.open-in-view` do, and why disable it?**
It keeps the JPA `EntityManager` open for the entire request so that lazy loads work in the view, but it also holds a database connection for the entire request, including after the business logic has finished. Disable it (`false`) to release connections earlier, then fetch everything you need inside the transaction. The default is `true`, which is a common production cause of pool exhaustion.

**Q11. What is the difference between `@MockBean` and `@Mock`?**
`@MockBean` registers a mock as a Spring bean, replacing the real bean in the application context; use it with `@SpringBootTest`. `@Mock` from Mockito is a standalone mock for plain unit tests. Confusing them means your mock will not be wired into the context.

**Q12. How do you handle a `@Scheduled` method that overlaps?**
`@Scheduled(fixedRate=5s)` starts every five seconds even if the previous run has not finished, causing overlapping executions. Use `fixedDelay=5s`, which waits for completion, or combine `@Scheduled` and `@Transactional` with a leader lock such as ShedLock so that only one node runs in a cluster. Without a lock, two pods can execute the job twice.

**Q13. What is the difference between `@RequestMapping` and the specific verbs?**
`@GetMapping`, `@PostMapping`, and the other verb-specific annotations are shortcuts for `@RequestMapping(method=GET)`. They are clearer and reduce the chance of a wrong-method bug. Use the specific verbs.

**Q14. What is a `BeanPostProcessor`?**
A hook that runs for every bean after instantiation and around initialization. AOP proxies, `@Autowired` resolution, and `@PostConstruct` all take place here. It is the seam where Spring weaves in cross-cutting behavior. Writing one is advanced; recognizing one explains much of Spring's magic.

**Q15. What is the difference between `@Transactional` propagation REQUIRED vs REQUIRES_NEW?**
`REQUIRED` (the default) joins the existing transaction or creates one. `REQUIRES_NEW` always suspends the current transaction and starts a fresh one, so the inner commit or rollback is independent. Use `REQUIRES_NEW` for audit logging that must persist even if the outer transaction rolls back, such as logging a failed payment.

**Q16. What is the difference between `@Cacheable` and manual caching?**
`@Cacheable` (with `@EnableCaching`) transparently caches method return values keyed by their arguments. Pitfalls include caching a method whose result depends on non-argument state, which can produce stale data, and caching `null` or mutable objects. Invalidate entries with `@CacheEvict`. Fetching from a local cache takes roughly microseconds versus milliseconds for a database call.

**Q17. What is the difference between `@Async` and a thread pool?**
`@Async` runs a method on a separate thread provided by a `TaskExecutor`. The default, `SimpleAsyncTaskExecutor`, is unbounded and therefore dangerous. Configure a bounded `ThreadPoolTaskExecutor` and set `@Async("myExecutor")`. Without a bounded pool, `@Async` can spawn unlimited threads.

## Senior — design & defense

**Q1. A `@Transactional` service is slow under load — you suspect long-lived transactions. Diagnose and fix.**
"I'd confirm that the transaction is too broad: enable `spring.jpa.show-sql` and trace where the connection is held. The method often makes a slow external call, such as an HTTP request or another database call, inside the transaction. Holding a database connection for seconds exhausts the pool (`HikariPool` waits, then `ConnectionTimeoutException` occurs after the default 30 s). I'd move the external call _outside_ the transaction, limit the transaction to the minimum database writes, and set `@Transactional(timeout=3)`. I'd measure pool wait time before and after, targeting nearly zero."

**Q2. Design a clean layered architecture without leaking the persistence layer.**
"Controller → Service (`@Transactional`) → Repository. The service returns DTOs, never JPA entities, to the controller; otherwise, lazily loaded collections can throw `LazyInitializationException` during serialization. Map entities to DTOs at the service boundary, using MapStruct or manual mapping. Keep repositories behind the service so controllers never access them directly. This keeps the transaction boundary inside the service and serialization outside it, eliminating the `OpenEntityManagerInView` trap."

```java
// WRONG: returns the entity -> lazy collections blow up in JSON serialization
public UserEntity get(Long id) { return repo.findById(id).orElseThrow(); }
// RIGHT: map to a DTO at the boundary
public UserDto get(Long id) { return repo.findById(id).map(UserDto::from).orElseThrow(); }
```

**Q3. You need two beans of the same type — wire them unambiguously.**
"Qualify them with `@Qualifier("primary")` on both the bean and the injection point, or give them distinct types through interfaces. A cleaner pattern is to inject a `List<Handler>` and dispatch by key rather than choosing one bean:"

```java
@Bean @Qualifier("stripe") public PaymentGateway stripe() { return new StripeGateway(); }
@Bean @Qualifier("paypal") public PaymentGateway paypal() { return new PaypalGateway(); }
@Autowired @Qualifier("stripe") PaymentGateway gateway;  // explicit
```

**Q4. Explain the bean lifecycle and where AOP weaves in.**
"Instantiation → population → aware callbacks → `BeanPostProcessor.before` → `@PostConstruct` → `InitializingBean.afterPropertiesSet` → `BeanPostProcessor.after` → ready. Proxy creation and AOP weaving occur during the `BeanPostProcessor` phases, which are where Spring can wrap your bean. I use `@PostConstruct` for initialization and avoid `InitializingBean` because it couples the code to Spring."

**Q5. When would you NOT use Spring Boot?**
"For a tiny CLI or a latency-critical path where a footprint of hundreds of megabytes and reflection-based startup taking seconds are costly, I'd consider Micronaut or Quarkus with build-time DI, which offer sub-second startup and low memory usage, or plain Java. Spring Boot wins on ecosystem and hiring; for serverless workloads sensitive to cold starts or for tiny workloads, compile-time DI frameworks may be the better trade-off. I'd decide based on the startup budget and memory ceiling, not habit."

**Q6. Defend a config strategy at 50 services.**
"I'd use one Git-backed `spring-cloud-config` with per-service overrides. Connection strings and secrets would come from the platform through a Kubernetes ConfigMap or Secret, never from committed files. I use `@ConfigurationProperties` for typed binding and fail fast on missing required keys with `@Validated`. At 50 services, consistent naming and a single source of truth matter more than convenience, so I enforce them through a shared starter module rather than copy-paste. The measurable benefit is that rotating a secret affects one place, not 50 repositories."

**Q7. `@Transactional` on a public method called from another `@Transactional` — what happens with NESTED/REQUIRED?**
"With the default `REQUIRED`, the inner call joins the outer transaction, using one shared connection, so they commit or roll back together. `NESTED`, if the database supports savepoints such as PostgreSQL/JDBC, creates a savepoint so the inner operation can roll back independently while the outer transaction continues. `REQUIRES_NEW` fully suspends the outer transaction. I choose based on whether a partial failure should abort the entire operation or only one step."

**Q8. How do you test a `@Transactional` service without a real DB?**
"Use `@DataJpaTest`, which uses an in-memory H2 database by default and takes roughly one second, for the repository layer. Use `@SpringBootTest` with `spring.test.context.cache` and Testcontainers Postgres for integration parity. For the service layer, mock the repository with `@MockBean` and assert that the transactional method delegates correctly. I avoid booting the full context for unit tests, which can take 20–30 seconds each and slow a suite to minutes."

**Q9. A custom `@RestControllerAdvice` isn't catching an exception. Why?**
"It catches only exceptions thrown _within_ a controller's request mapping, inside `DispatcherServlet`. Exceptions from filters, Spring Security, or argument resolvers occur earlier and are not caught. Also, if multiple `@ControllerAdvice` classes have overlapping `@ExceptionHandler` methods, the most specific handler wins. For pre-controller failures, use a `Filter` or Spring Security's entry point."

**Q10. How do you size and monitor the HikariCP connection pool?**
"I size `maximumPoolSize` using Little's Law, typically around 10–30 for ordinary services rather than 200. I set `connectionTimeout` to 30 s, and set `idleTimeout` and `maxLifetime` below the database's `wait_timeout` (for example, a 28-minute `maxLifetime` for MySQL's 30-minute timeout) to avoid a connection closing during use. I expose Hikari's `HikariPoolMXBean` metrics for active, idle, and waiting connections, and alert when `awaiting > 0` persists. That signals pool exhaustion before it becomes a 30-second timeout storm."

**Q11. `@Async` method swallows exceptions silently. How do you catch them?**
"`@Async` runs on another thread, so exceptions do not propagate to the caller; they are logged and lost. Fix this by providing an `AsyncUncaughtExceptionHandler` through `AsyncConfigurer`, or by returning a `CompletableFuture` and handling its exception. I always return `CompletableFuture` from `@Async` methods so callers can observe failures."

**Q12. How do you prevent `@Cacheable` from serving stale data across deploys?**
"Cache entries survive a restart only when backed by a distributed store such as Redis; an in-memory cache is empty after deployment, then repopulates, which can cause a brief stampede. For correctness across deployments, use a shared Redis cache with a TTL shorter than the data's staleness tolerance, and use `@CacheEvict` on writes. I set TTLs so the worst case is serving data that is at most one TTL old, never indefinitely stale data."

**Q13. A scheduled job runs twice in production (two pods). Fix it.**
"Plain `@Scheduled` runs on every instance. In a cluster, you need a leader lock. Use ShedLock (`@SchedulerLock`), which acquires a database or Redis lock so that only one node executes the job. Alternatively, run it in a single dedicated cron pod. Without a lock, every pod runs it, resulting in duplicate emails and charges. I treat scheduling as a distributed concern, not a per-instance concern."

**Q14. How do you make a Spring Boot app start fast (sub-second)?**
"Lazy initialization (`spring.main.lazy-initialization=true`) defers bean creation until first use, reducing startup time but adding first-request latency. Compile-time DI through Micronaut or Quarkus is faster than Spring's reflection-based startup. Trim auto-configuration by excluding unused features with `spring.autoconfigure.exclude`. For serverless workloads, consider a GraalVM native image, which can start in roughly 10–50 ms, although the build takes minutes and not all libraries are compatible. I measure startup time and choose the least costly option that meets the cold-start SLA."

**Q15. What is the difference between `@MockBean` in `@SpringBootTest` and a slice test?**
"A full `@SpringBootTest` boots the entire context and takes roughly 20–30 seconds. Slice tests (`@WebMvcTest`, `@DataJpaTest`, `@JsonTest`) boot only the relevant layer and take roughly 1–3 seconds. Using full-context tests for everything can make a suite take minutes. I use slices for 90% of tests and full-context tests only for true integration points. In one measurement, 200 slice tests ran in about 30 seconds versus about 10 minutes for the equivalent full-context suite."

**Q16. How do you debug a `NoSuchBeanDefinitionException`?**
"The bean is not in the context. Possible causes include a component that was not scanned (the wrong package or no `@Component`), a false conditional exclusion (`@Profile` or `@ConditionalOn...`), or an abstract/interface type without an implementation. Run with `--debug` to see the auto-configuration report, search for the bean name, and check which condition failed (`Negative matches`). Nine times out of ten, the package is outside `@ComponentScan`."

**Q17. Design for zero-downtime config changes at 50 services.**
"Use `spring-cloud-config` with `@RefreshScope` beans; `/actuator/refresh` or a bus event reloads them without a restart. However, `@RefreshScope` recreates beans. Connections in a `@RefreshScope` `@Bean` are closed and reopened, so scope connection pools carefully or risk dropping in-flight requests. I scope only the beans that hold configuration, not the pools, and test refresh under load to confirm that connections are not churned."

**Q18. How do you defend `@Transactional` boundaries when the service calls 3 other services?**
"You usually should not wrap three remote calls in one database transaction. The transaction holds a database connection for the duration of all three network calls, potentially exhausting the pool. Options include (1) performing the local database write, committing, and then calling the services in a saga-style flow with compensation, or (2) using an outbox to publish events after the commit. I keep the transaction limited to database work and treat cross-service calls as a separate, compensatable step. Holding a transaction across network calls is the leading cause of pool exhaustion I see."

#### Self-check

- [ ] Junior: I can explain IoC/DI (with constructor injection), stereotypes, singleton scope, `@SpringBootApplication`, and `@RequestBody` versus `@PathVariable`, with code.
- [ ] Mid: I can show with code why `@Transactional` silently fails (swallowed exceptions, self-invocation, and private methods), explain auto-configuration conditions, distinguish `@ControllerAdvice` from `Filter`, and explain OpenEntityManagerInView.
- [ ] Senior: I can diagnose pool exhaustion caused by long-lived transactions (default 30 s timeout), design a layered architecture with DTO mapping, wire two beans unambiguously, explain the lifecycle and AOP weaving point, size and monitor HikariCP, and defend transaction boundaries across service calls.
