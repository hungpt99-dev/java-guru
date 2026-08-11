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

Most senior Java backend roles are Spring Boot roles. Interviewers expect you to understand the framework, not just use it — and the difference is audible in the first answer. A junior recites annotations. A senior narrates the call chain: how the proxy intercepts a `@Transactional` method, why self-invocation slips past it, why the bean lifecycle has two kinds of post-processors, and the night the connection pool emptied because a transaction held a connection while it called a slow partner API.

> Mindset: name the annotation and you're mid-level. Walk through the proxy internals with a production failure mode and the numbers, and you've cleared the bar. Every section below ends with the drill an interviewer actually runs.

## 1. IoC and DI — the container is a contract, not a drawer

Inversion of Control is _who owns `new`_. Dependency Injection is _how the wiring gets delivered_. Together they answer "who constructs this object and when" — the container owns the graph, you declare dependencies, it satisfies them. The depth lives in the two decisions that fall out: how you accept a dependency, and what you hand to a bean that outlives its scope.

### Why constructor injection is a contract

`@Autowired` field injection works. It also lets a `PaymentGateway` object be constructed _incomplete_ — the field stays `null` until a container touches it. Unit tests can't build the object honestly, nothing can be `final`, and the reader has to scan the class body to learn what the bean actually needs. Constructor injection turns the dependency into a parameter:

```java
// WRONG: field injection — the dependency is a rumor
@Service
public class OrderService {
    @Autowired
    private PaymentGateway gateway; // null outside a container; only Spring/reflection can set it
}

// RIGHT: constructor injection — the bean is honest about what it needs
@Service
public class OrderService {
    private final PaymentGateway gateway;

    public OrderService(PaymentGateway gateway) {
        this.gateway = gateway; // fully constructed, immutable, unit-testable with a mock
    }
}
```

The follow-up that separates candidates: "what breaks when constructor injection meets a circular dependency?" Constructor injection is all-or-nothing — A's constructor can't complete until B's does, so the container can't hand out a partial reference. Setter/field injection survives because singleton creation happens in three phases (bare instantiate → populate → post-process), and the container can hand a raw, still-forming reference into the cycle. That's why the fix for a constructor cycle is a proxy, not a reorder:

```java
@Service
public class A {
    private final B b;
    public A(@Lazy B b) { this.b = b; } // inject a lazy proxy; real B resolved on first use
}

// or defer the choice entirely:
@Service
public class A {
    private final ObjectProvider<B> b; // getIfAvailable(), getIfUnique(), getObject()
}
```

A senior also names the smell: two singletons that need each other usually mean a missing third component, not a missing annotation.

### Scopes — the prototype trap

A `prototype` bean injected into a `singleton` is resolved once, at the singleton's construction, and that single instance is then captured forever:

```java
// WRONG: the prototype is fetched once and cached in the singleton — scope violated
@Service
public class OrderService {
    private final DiscountCalculator calc; // same instance for every request, forever
}

// RIGHT: ask the container for a fresh one per use
@Service
public class OrderService {
    private final ObjectProvider<DiscountCalculator> calcProvider;

    public OrderService(ObjectProvider<DiscountCalculator> calcProvider) {
        this.calcProvider = calcProvider;
    }

    public BigDecimal price(Order o) {
        return calcProvider.getObject().apply(o); // fresh prototype each call
    }
}
```

The web scopes add a layer of indirection. A singleton can't hold a `request`-scoped bean directly, so Spring injects a **scoped proxy** (`@Scope(value = "request", proxyMode = ScopedProxyMode.TARGET_CLASS)`): a stand-in that resolves against the current request context on every call. Cost: an extra hop per access, and the proxy hides which instance you're actually talking to. "Why not scoped proxies everywhere?" — because you've traded a visible dependency for a magic object.

### JDK proxy vs CGLIB — why an annotation can silently do nothing

Spring Boot 2+ proxies by subclassing (CGLIB) even for interfaces. That means a `final` method — or a `final` bean class — cannot be overridden, and any `@Transactional`/`@Async` on it **silently does nothing**. Same for `private` methods: a call to a private method is a direct call on the target, and the proxy never sees it. "If a call doesn't leave the object, the annotation is a comment." When a method is annotated but clearly running without the behavior, the first suspects are `private`, `final`, and self-invocation (section 4).

## 2. Bean lifecycle — narrate it cold

Every singleton is built in a fixed order at context startup. "Walk me through the lifecycle" wants the sequence, not the annotations:

1. **Instantiate** — the constructor runs.
2. **Populate** — field and setter dependencies are injected.
3. **`Aware` callbacks** — `BeanNameAware`, `BeanClassLoaderAware`, `BeanFactoryAware`, `ApplicationContextAware`.
4. **`BeanPostProcessor.postProcessBeforeInitialization`** — where listeners wire themselves up.
5. **`@PostConstruct`** — dependencies exist; setup that needs them goes here.
6. **`InitializingBean.afterPropertiesSet()`**.
7. **Custom `init-method`** (`initMethod` on `@Bean`).
8. **`BeanPostProcessor.postProcessAfterInitialization`** — _this is where AOP auto-proxying wraps the bean in its proxy._
9. On context close: **`@PreDestroy`** → `DisposableBean.destroy()` → custom `destroy-method`.

Two consequences interviewers probe. First, the order among the three init callbacks: `@PostConstruct` → `afterPropertiesSet` → `init-method` (and `@PostConstruct` is `CommonAnnotationBeanPostProcessor` running _before_ init). Second — the one that wins the room — step 8: **a call to a `@Transactional` method from inside `@PostConstruct` runs outside any transaction**, because the proxy doesn't exist yet. The annotation is enforced only by a proxy created _after_ initialization.

### `BeanPostProcessor` vs `BeanFactoryPostProcessor`

The first sees **instances** during creation; the second sees **definitions** before any bean is instantiated. That's why `PropertySourcesPlaceholderConfigurer` is a `BeanFactoryPostProcessor` — `${...}` placeholders have to be rewritten in definitions before the objects exist. And it's why `@ConfigurationProperties` binding is a `BeanPostProcessor` job (`ConfigurationPropertiesBindingPostProcessor`): the target object must be a bean first, then it gets bound.

The failure mode that sends juniors to the docs: `@Value("${app.name}")` comes back literally as the string `${app.name}`. Root cause: the property source was registered after placeholder resolution. A senior says "if `${...}` stays literal, the definitions were resolved before the source existed," and fixes the ordering, not the string.

### Failing fast is a feature

Singletons are pre-instantiated **eagerly** at `refresh()`. A broken `@PostConstruct` aborts startup — the app refuses to boot. That's a feature: a misconfigured bean fails at deploy time, not at 3 a.m. when the first request touches it. `@Lazy` moves that failure to first use; sometimes that's the right call (a slow cold start you can tolerate), but name the tradeoff you're buying. If a "fixed" incident involved a bean that "worked in dev but not prod," the first question is whether it was lazily initialized and simply never exercised.

### Full vs lite `@Bean` mode

`@Bean` methods inside a `@Configuration` class are proxied (**full mode**), so an internal call to `b()` returns the container's singleton. Move the same `@Bean` methods into a `@Component` (**lite mode**) and each internal call constructs a brand-new instance — silently. Same annotation, different semantics depending on what's on the enclosing class. "I moved my config into a `@Component` and now there are 40 DataSources" is a real incident.

## 3. Auto-configuration — the chef who reads the fridge

`@SpringBootApplication` is three annotations in a trench coat: `@SpringBootConfiguration`, `@EnableAutoConfiguration`, and `@ComponentScan`. The component scan only sees your base package's subtree — which is exactly why your `@Service`s are found but a JPA provider or an H2 driver never will be. That gap is what starters fill: they ship both the dependency _and_ a class that knows how to configure it.

### The machinery

Boot reads `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (Boot 2.7+; `spring.factories` before that) and loads every listed class as a candidate `@Configuration`. Then each candidate has to pass a set of `@Conditional*` questions before it's kept:

- `@ConditionalOnClass` — is the type on the classpath? (A DataSource auto-config activates only when a driver is present.)
- `@ConditionalOnMissingBean` — did the developer define their own? (The override contract.)
- `@ConditionalOnProperty` — is the switch on?
- `@ConditionalOnWebApplication` / `@ConditionalOnBean` — the context kind, and beans already present.

Ordering is controlled with `@AutoConfigureBefore` / `@AutoConfigureAfter` / `@Order`. The result: a Boot 3 app evaluates **on the order of a thousand condition checks at startup**, most of them negative. That's why adding an innocent-looking dependency can change behavior globally — the conditions are evaluated against the whole classpath.

### How a bean override actually works

The contract is `@ConditionalOnMissingBean`: Boot's `DataSourceAutoConfiguration` backs off _unless_ you already defined a `DataSource`. Your override isn't "extra config" — it's the condition turning itself off:

```java
@Configuration
public class DbConfig {
    @Bean
    public DataSource dataSource() {
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl("jdbc:postgresql://" + url);
        ds.setUsername(user);
        ds.setMaximumPoolSize(20);
        return ds;
    }
}
```

If your bean isn't winning, the first move is the **conditions report**, not a guess. Set `debug=true` (or hit the actuator `conditions` endpoint) and read the _Negative matches_ section — it prints exactly which condition failed and why. The classic find: "your `@ConditionalOnMissingBean` was satisfied by a bean your own component scan registered." A senior reads _Positive matches_ first to see what's actually running, then looks for their own bean in the list.

### The scan-twice trap

Auto-config classes are themselves `@Configuration` classes. Put one inside your component-scan base package and `@ComponentScan` picks it up as a normal config _in addition to_ the auto-config pass — its `@Conditional` logic then runs twice against different context states and quietly misbehaves. Boot avoids this by living in `org.springframework.boot.autoconfigure.*`, outside any app's scan root. Your custom starters must do the same: `AutoConfiguration.imports` classes should never be reachable by the app's component scan. If a condition "flips" between the report and reality, suspect double registration first.

### Property binding

`@ConfigurationProperties` decouples your config from `@Value` strings: relaxed kebab-case binding (`my-app.timeout-ms` → `timeoutMs`), typed fields, and `@Validated` at bind time. The senior detail: binding happens through a `BeanPostProcessor`, so the class **must be registered as a bean** (`@ConfigurationPropertiesScan` or `@EnableConfigurationProperties`) — otherwise the binding silently doesn't happen and you get defaults instead of your values. "I set `my-app.timeout-ms` and the bean ignored it" is a bean-registration question, not a YAML question.

## 4. Transaction management — the proxy and its failure modes

As with `@Cacheable` and `@Async`, `@Transactional` is a proxy concern. The proxy delegates to `TransactionInterceptor`, which drives a `PlatformTransactionManager` (`DataSourceTransactionManager` for plain JDBC/MyBatis, `JpaTransactionManager` for JPA): acquire a connection, `setAutoCommit(false)`, run the method, commit or roll back, restore. Everything that follows is a consequence of that single sentence.

### Self-invocation — the classic

`this.method()` is a direct call on the raw target. The proxy only intercepts calls that arrive from the _outside_:

```java
// WRONG: audit() is @Transactional, but this.audit() never crosses the proxy
@Service
public class OrderService {
    public void ship(Order order) {
        deductStock(order);
        this.audit(order); // plain method call — NO transaction, NO rollback guarantee
    }

    @Transactional
    public void audit(Order order) { /* runs with no transaction context */ }
}
```

Fixes, in senior order of preference:

```java
// 1) self-injection: Boot can inject the bean's own proxy
@Service
public class OrderService {
    private final OrderService self;

    public OrderService(OrderService self) {
        this.self = self;
    }

    public void ship(Order order) {
        deductStock(order);
        self.audit(order); // now through the proxy — transactional
    }
}

// 2) expose the proxy explicitly
@EnableAspectJAutoProxy(exposeProxy = true)
// ((OrderService) AopContext.currentProxy()).audit(order);

// 3) the architecture answer: calling your own transactional method usually
//    means the logic belongs in a separate collaborator — extract it
```

Why the fix is a proxy and not a flag: the annotation is metadata on the bean _definition_; enforcement lives in the proxy. `private` and `final` methods fail the same way (section 1) — the call never exits the target.

### Propagation — and the `REQUIRES_NEW` pool killer

- `REQUIRED` (default) — join the existing transaction or create one.
- `REQUIRES_NEW` — suspend the outer, start a new transaction on a **new connection**. The outer's locks stay held while the inner commits.
- `NESTED` — savepoint semantics: roll back to the savepoint, not the whole outer. **JDBC only** — JPA throws "nested transactions are not supported" at runtime. Claiming "we used `NESTED`" in an interview confesses the JPA stack.
- `MANDATORY`, `NOT_SUPPORTED`, `NEVER`, `SUPPORTS` — the discipline of "must have / must not have" a transaction.

The failure mode with teeth: `REQUIRES_NEW` inside a loop grabs a fresh connection per call:

```java
// WRONG: each item starts its own transaction on its own connection
@Transactional
public void importAll(List<Item> items) {
    for (Item item : items) {
        importOne(item); // REQUIRES_NEW → new connection per item
    }
}
// 1,000 items, Hikari pool of 10 → the pool is empty at item ~10 and the outer
// transaction waits on a connection it can't get → timeout under load

// RIGHT: batch inside the outer transaction — one transaction, one connection
@Transactional
public void importAll(List<Item> items) {
    for (Item item : items) {
        save(item); // joins the outer tx
    }
}
// If each item genuinely needs its own commit unit: drop the outer @Transactional,
// use a bounded TaskExecutor, and size the pool to the concurrency you allow.
```

Little's law applies to transactions as much as requests: `connections ≈ concurrent units of work`, not `count(items)`.

### Isolation and the rollback default

`@Transactional(isolation = Isolation.REPEATABLE_READ)` sets `connection.setTransactionIsolation(...)` on checkout; the default `Isolation.DEFAULT` means _the database's_ default — InnoDB REPEATABLE READ, Postgres READ COMMITTED. The tradeoff is the one from the database interview: every level above READ COMMITTED buys fewer anomalies with more and longer locks. It's a latency dial, not a safety checkbox.

Rollback defaults: **only `RuntimeException` and `Error` roll back.** Checked exceptions — the ones you declare with `throws` — are treated as expected business outcomes and commit:

```java
// WRONG: InsufficientFundsException is checked → the "failure" COMMITS the transfer
@Transactional
public void transfer(long from, long to, BigDecimal amt) throws InsufficientFundsException {
    debit(from, amt);
    credit(to, amt);
    if (overdrawn(from)) throw new InsufficientFundsException();
}

// RIGHT: declare that this checked exception must abort
@Transactional(rollbackFor = InsufficientFundsException.class)
public void transfer(long from, long to, BigDecimal amt) throws InsufficientFundsException {
    ...
}
```

The mirror trap is `noRollbackFor` on a `RuntimeException` you actually handled. State the decision rule out loud: _roll back by default, then enumerate the exceptions that mean "this is a real failure"_ — not "roll back nothing and hope."

Two more details that earn points:

- `readOnly = true` is **not a database-level guarantee**. For JPA it switches the flush to manual (no dirty-checking flush at commit — a real speedup on read-heavy paths); for the JDBC manager it's a `Connection` read-only hint. It does not prevent an `INSERT` from slipping through. If you need enforcement, that's the DB's job (roles/grants), not the annotation's.
- `timeout = 5` is advisory at the JDBC layer: it becomes a driver statement timeout where supported, and a long-running statement can outlive it. The DB side still needs its own `lock_wait_timeout` / `statement_timeout`. "The annotation timed out but the query ran for 30 seconds" is a real production sentence.

### Transactions don't cross thread boundaries

`@Transactional` binds to the current thread via `TransactionSynchronizationManager` (a ThreadLocal). Split the work across threads and each branch gets its own connection and its own (or no) transaction:

```java
// WRONG: async work runs outside the transaction this method's caller expects
@Async
@Transactional
public void process(Order order) { ... } // async proxy wraps the tx proxy: the tx starts on a worker thread

// WRONG: the send fires even when the transaction rolls back
@Transactional
public void createOrder(Order order) {
    orderRepository.save(order);
    kafkaTemplate.send("orders", order); // ghost event if anything below throws
}

// RIGHT: publish only after a successful commit
@Transactional
public void createOrder(Order order) {
    orderRepository.save(order);
    applicationEventPublisher.publishEvent(new OrderCreated(order));
}

@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onOrderCreated(OrderCreated ev) {
    kafkaTemplate.send("orders", ev.order());
}
```

The follow-up that separates seniors: _what if the broker is down after the commit?_ The in-memory listener is not durable — it runs, the send fails, and the event is gone. That's the argument for the **outbox pattern**: write the event to an `outbox` table _in the same transaction_ as the state change, and let a relay publish committed rows with retries. "Send Kafka inside the `@Transactional` method" is the wrong shape at every scale; the real question is whether an after-commit listener is enough or you need the outbox table for durability.

### Distributed transactions — default to the outbox, not to XA

Interviewers love the bait: "a DB write and a Kafka publish must be atomic — use XA?" The senior answer walks the cost of two-phase commit before saying no: the prepare phase roughly doubles the lock hold, a coordinator crash leaves transactions in doubt (heuristic decisions), and every driver and broker must implement XA. The realistic tools:

- **Best-effort 1PC** — commit the DB, publish; on failure, compensate.
- **Outbox pattern** — atomic in the one place you can be atomic (the DB), then an idempotent relay.
- **Kafka transactions** — atomic across the consume–process–produce cycle _inside one broker_; not a magic bullet across systems.

Name the tradeoff: true 2PC buys cross-resource atomicity with availability and complexity; the outbox gives durable ordering with eventual delivery and a retry mechanism that's inspectable.

## 5. The web layer and pool sizing — where throughput actually dies

Spring Boot's request pipeline is one thread per in-flight request, and by default **Tomcat has 200 of them** (`server.tomcat.threads.max`). The thread does the work _synchronously_ — it blocks on the DB, on partner calls, on anything. That single fact decides your ceiling:

```
Little's law:  throughput  =  threads  ÷  average request time

200 threads / 0.05 s  →  4,000 req/s ceiling  (50 ms requests)
200 threads / 0.5 s   →    400 req/s ceiling  (500 ms requests)
200 threads / 2.0 s   →    100 req/s ceiling  (2 s requests)
```

Raise the thread count and you buy context-switch thrash beyond a few times the core count — the box has 32 cores, not 32,000. The lever that actually moves the ceiling is _request latency_, which is why the senior answers to "how do I handle 10× traffic" are: cut the average request time, move slow work off the request thread, and stop letting one slow dependency hold the pool hostage. (And if a full GC pauses all 200 threads at once, the concurrency and JVM posts cover the pause math — here the point is that the request threads are where it lands.)

### The blocking client with no timeouts

`RestTemplate` created the naive way has **no connect or read timeout by default**. A dead peer holds a Tomcat thread for minutes, and at enough traffic the 200 threads all park in `SocketRead`:

```java
// WRONG: no timeouts, called from a request thread
RestTemplate rt = new RestTemplate(); // connectTimeout = 0, readTimeout = 0 → hang forever

// RIGHT: bound every stage
var factory = new HttpComponentsClientHttpRequestFactory();
factory.setConnectTimeout(1_000);           // ms — time to establish the connection
factory.setConnectionRequestTimeout(1_000); // time waiting for a pooled connection
factory.setReadTimeout(2_000);              // time waiting for the response body
new RestTemplate(factory);
```

The senior variant is bigger: if the call is slow, _don't sit on a request thread at all_ — return `202 Accepted`, hand the work to a bounded executor, or use `WebClient` with explicit `HttpClient` timeouts. But the non-blocking answer has its own failure mode, below.

### Virtual threads (Java 21, Boot 3.2+)

Set `spring.threads.virtual.enabled=true` and every request gets a virtual thread: blocking I/O no longer pins a platform thread, and `server.tomcat.threads.max` stops being the ceiling. The interview, though, is about the tradeoffs:

- **Pinning.** `synchronized` blocks and native calls pin a carrier thread — a hot `synchronized` method that used to hide behind thread count now caps throughput.
- **`ThreadLocal` assumptions break.** Thread pools reuse threads, so libraries that stash state in `ThreadLocal` relied on that reuse. Virtual threads are created per task — cached ThreadLocal state is _gone_, and ORM/connection bookkeeping that assumed reuse changes behavior.
- **The pool is still the bottleneck.** Virtual threads are cheap; **database connections are not.** With the default Hikari pool of 10 and 500 concurrent requests, 490 virtual threads sit blocked on `getConnection()` — the DB looks dead, the pool is the queue. "Virtual threads fixed my thread pool but the Hikari pool became the new ceiling" is a real production sentence.

### Hold time, not query time

A request thread holds its connection for the _whole transaction_, including the business logic between queries — and OSIV (section 6) makes it worse. The pool must cover the full hold, not the query:

```java
// WRONG: the connection is checked out, then held hostage by partner latency
@Transactional
public OrderResponse create(Order order) {
    orderRepository.save(order);               // connection checked out here
    OrderResponse r = partnerApi.place(order); // 800 ms of partner latency, connection held
    return r;                                  // commit after the call → pool pressure
}

// RIGHT: do the slow I/O before opening the transaction, or after it commits
OrderResponse r = partnerApi.place(order);
orderService.create(order, r.id);
```

A fleet of 40 pods, each with 200 threads and a 20-connection pool, holding connections across an 800 ms partner call, will queue at the pool long before the partner is the problem. The database interview covers the sizing math (`connections ≈ throughput × hold time`); the Spring part is _where the hold happens_ — and the answer is: never inside a transaction across external I/O.

## 6. Production failure modes — the checklist that becomes a war story

Interviewers ask about incidents because the anecdotes are the signal. Have one story ready per item, and the fix attached to each:

- **OSIV default true.** `spring.jpa.open-in-view` defaults to **true**, and Boot logs a warning at every startup. The `EntityManager` and its JDBC connection stay open for the entire HTTP request — lazy loads work anywhere (hiding the N+1) _and_ your pool is held for the full request. Turn it off and the first thing you hit is `LazyInitializationException` in a serializer — which is the framework finally pointing at the N+1. (Full hunt in the database guide.)
- **`@Cacheable` stampede and staleness.** `sync=true` collapses the thundering herd (one thread loads, the rest wait). A TTL is a staleness dial, not a correctness tool — and multi-node invalidation needs an explicit mechanism (Redis + delete/evict), not hope. "We cached for 5 minutes and the writes never showed up" is a TTL design question.
- **`@Scheduled` overlaps.** The default scheduler is a **single thread**. A run longer than the interval just delays the next tick — and with two pods, both run the job. Fix the pool size (`spring.task.scheduling.pool.size`) and, for multi-node, add ShedLock or a DB advisory lock so exactly one instance owns the run.
- **Unbounded `@Async`.** The default executor's `queue-capacity` is `Integer.MAX_VALUE`. A burst enqueues forever → latency climbs → then OOM. Replace it with an explicit `TaskExecutor`, a bounded queue, and a rejection policy:

```java
@Bean("opsExecutor")
public TaskExecutor opsExecutor() {
    ThreadPoolTaskExecutor e = new ThreadPoolTaskExecutor();
    e.setCorePoolSize(8);
    e.setMaxPoolSize(24);
    e.setQueueCapacity(200);              // bounded — fail fast instead of unbounded growth
    e.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    return e;
}
```

- **Graceful shutdown.** `server.shutdown=graceful` plus `spring.lifecycle.timeout-per-shutdown-phase` (default 30 s) lets a K8s SIGTERM drain in-flight requests before the pod dies. The incident: "we deploy, and 2% of requests fail with connection reset" — because the pod was killed mid-request. If you've ever seen that, name the two settings immediately.
- **`@SpringBootTest` for everything.** A test that boots the whole context to test one `@Service` takes seconds and flakes on infra beans. Slice tests (`@WebMvcTest`, `@DataJpaTest`) boot a sliver. "Why are your tests 8 minutes?" is a test-design question wearing a performance costume.
- **Two `@Bean`s of the same type.** `NoUniqueBeanDefinitionException` — or the wrong one silently winning. `@Primary` is the override, `@Qualifier` is the selector, and the conditions report shows which bean is actually registered. "It worked on my machine because my machine's classpath was missing the second bean" is the honest sentence.
- **Actuator exposed too wide.** `management.endpoints.web.exposure.include=health,info` — not `env`, `shutdown`, or `heapdump` on a public path. The endpoint that "just helps debugging" in prod is the endpoint that leaks config and secrets.

## 7. Self-check

- [ ] Explain why constructor injection is a contract, and the exact three-phase mechanism that lets setter injection survive a circular dependency while constructor injection can't.
- [ ] Narrate the singleton lifecycle in order — and name the phase where AOP proxying happens (and why a `@Transactional` call inside `@PostConstruct` runs untransacted).
- [ ] Full vs lite `@Bean` mode: what changes when the `@Bean` methods move from `@Configuration` to `@Component`.
- [ ] Walk auto-configuration: where `AutoConfiguration.imports` lives, how `@ConditionalOnMissingBean` lets your bean back off the starter's, and where to read the Negative matches report.
- [ ] Why `this.audit()` bypasses `@Transactional`, and the three fixes in senior order of preference.
- [ ] The `REQUIRES_NEW` loop that empties the pool — and the correct shape for per-item commit units.
- [ ] Why the Kafka send inside a transaction is a ghost event, and the after-commit listener vs outbox tradeoff.
- [ ] Size the request-thread ceiling with Little's law, and state the two things virtual threads don't change.
- [ ] List the failure modes for `@Async`, `@Scheduled`, `@Cacheable`, OSIV, and graceful shutdown — with the fix for each.

## 8. Interviewer follow-ups

When your first answer lands, they start drilling. Be ready for these:

- "Why does constructor injection fail on a circular dependency — and what is `@Lazy` actually injecting?"
- "Walk me through the bean lifecycle — and where in it would an AOP proxy first intercept a call?"
- "Your `@Transactional` method calls itself and nothing rolls back. Walk me through the call path."
- "When does `REQUIRES_NEW` turn into a production incident?"
- "The Kafka message was sent but the DB rolled back. What happened, and what are the fixes?"
- "Would you use XA here? If not, why, and what's the outbox?"
- "Boot 3.2, Java 21, you enable virtual threads. What breaks next?"
- "A report request holds a connection for 45 seconds and the pool is 20. What do you change first?"
- "Your `@Async` executor OOMs under load. What's the default queue capacity, and what do you set it to?"
- "How do you find out which auto-configurations actually ran on a machine you can't attach to?"
- "Why does OSIV keep your connection hostage, and what's the first error you'll see after turning it off?"

That's the Spring Boot bar.
