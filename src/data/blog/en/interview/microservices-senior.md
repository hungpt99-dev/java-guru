---
title: "Java Interview Prep #6: Microservices — Junior to Senior"
description: "Microservices at senior level is mostly about knowing when NOT to use them — resilience patterns, service communication, and distributed transactions."
pubDatetime: 2026-08-10T10:10:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - microservices
  - resilience
---

Microservices are the topic where senior judgment matters most, because the wrong answer is "let's split the monolith". Junior developers draw service boxes; seniors explain why a monolith was the right call for years and what specifically forced the split. This post walks from service boundaries to the distributed-transaction trap — 50 questions, every answer code-first with real Spring, pick the level you are interviewing at and read one above it.

> Mindset: junior lists the benefits of microservices; senior can name three concrete costs they introduce and the exact trigger that justifies paying them.

## Junior — foundations

**Q1. What is a microservice and how does it differ from a monolith?**
A microservice is a small, independently deployable service owning one business capability and its own data. A monolith is one deployable unit serving every capability. Microservices buy independent scaling, isolated failures, and team autonomy; they pay in network calls, distributed data, and operational complexity. The cheapest form of a microservice is a Spring Boot app that does exactly one job:

```java
@SpringBootApplication
public class OrderService {
    public static void main(String[] args) {
        SpringApplication.run(OrderService.class, args);   // one capability, one deployable
    }
}
```

One deployable means one build, one rollout, one rollback. Twenty services mean twenty of each — that cost only pays off when the independence is real.

**Q2. What is the difference between synchronous and asynchronous communication?**
Sync (HTTP/RPC): the caller blocks until it gets an answer — tight coupling, a slow callee stalls your thread. Async (events): the caller publishes and moves on — loose coupling and resilience, but eventual consistency and harder debugging. Choose sync when the user is blocked on the answer, async for fire-and-forget side effects:

```java
// Sync — the caller waits
OrderSummary summary = restClient.get()
    .uri("http://order-service/api/orders/{id}", id)
    .retrieve()
    .body(OrderSummary.class);        // blocks until response or 3s timeout

// Async — publish and continue
kafkaTemplate.send("order.placed", new OrderPlaced(orderId));   // nobody waits
```

Rule of thumb: the happy-path request the user waits on is sync; anything that can afford a delay is async.

**Q3. What is an API gateway and what does it do?**
One entry point that routes, authenticates, rate-limits, and often aggregates. It hides the service topology so clients talk to one host instead of twenty, and cross-cutting policy lives in one place. Spring Cloud Gateway is a reactive proxy; routes are just functions:

```java
@Bean
public RouteLocator routes(RouteLocatorBuilder b) {
    return b.routes()
        .route("orders", r -> r.path("/api/orders/**")
            .filters(f -> f.circuitBreaker(c -> c.setName("gatewayCB")
                    .setFallbackUri("forward:/fallback/orders")))
            .uri("lb://ORDER-SERVICE"))
        .build();
}
```

Without it, clients hardcode every service address, every team re-implements auth, and nobody can rate-limit anything centrally.

**Q4. What is service discovery and why can't you hardcode URLs?**
Instances scale, crash, and reschedule; a hardcoded IP is stale within minutes. Services register with a registry (Eureka, Consul, K8s DNS) and resolve each other by logical name. In Spring, `@LoadBalanced` turns the name into a real instance, picked per request:

```java
@Bean
@LoadBalanced
public RestClient.Builder loadBalancedRestClientBuilder() {
    return RestClient.builder();               // resolve lb://ORDER-SERVICE → instance IP:port
}

// Call by service name, not by IP:
OrderSummary o = restClient.get().uri("http://ORDER-SERVICE/api/orders/{id}", id)
    .retrieve().body(OrderSummary.class);
```

Hardcoded hostnames break the moment a pod reschedules; a registry makes scaling and restarts invisible to callers.

**Q5. What is a circuit breaker and why do you need one?**
Naive retries against a dying dependency pile up and exhaust your threads — one dead service takes down the whole chain. A breaker trips after N failures, fails fast during the cooldown, then half-opens to test recovery:

```java
@CircuitBreaker(name = "inventory", fallbackMethod = "fallback")
public InventoryStatus check(String sku) {
    return restClient.get().uri("http://inventory-service/api/stock/{sku}", sku)
            .retrieve().body(InventoryStatus.class);
}

public InventoryStatus fallback(String sku, Throwable t) {
    return new InventoryStatus(sku, 0, "unavailable");   // degraded, not dead
}
```

It contains the blast radius: fail fast at the breaker instead of waiting out every timeout.

**Q6. What is the difference between an API and an event?**
An API is a request — "do this, give me the result". An event is a fact — "order placed", broadcast to whoever cares. APIs couple caller to callee; events decouple producer from consumers. The same business action expressed both ways:

```java
@RestController
class OrderController {
    @PostMapping("/api/orders")                       // API: imperative request
    public Order create(@RequestBody CreateOrder cmd) { ... }
}

@Component
class OrderEvents {
    @KafkaListener(topics = "order.placed")           // Event: broadcast fact
    public void onOrderPlaced(OrderPlaced e) { ... }
}
```

Confusing the two produces chatty, fragile synchronous graphs where events would have been cleaner.

**Q7. How do you write a REST client in Spring and which one do you pick?**
Three eras: `RestTemplate` (blocking, legacy, discouraged), `WebClient` (reactive, drags in Reactor), and `RestClient` (Spring 6.1+) — the modern synchronous client with the same fluent API. For 95% of request/response services, `RestClient`:

```java
var requestFactory = new JdkClientHttpRequestFactory();
requestFactory.setReadTimeout(Duration.ofSeconds(3));

RestClient client = RestClient.builder()
    .baseUrl("http://order-service/api")
    .requestFactory(requestFactory)
    .build();

OrderSummary order = client.get().uri("/orders/{id}", id)
    .retrieve()
    .onStatus(HttpStatusCode::is5xxServerError,
        (req, res) -> { throw new DownstreamException(res.getStatusCode()); })
    .body(OrderSummary.class);
```

Pick `RestClient` for sync, `WebClient` only when you are already reactive end-to-end — mixing Reactor into a blocking service buys nothing but complexity.

**Q8. What does `@RestController` actually do?**
It is `@Controller` + `@ResponseBody`: the return value is serialized straight to the HTTP body (JSON via Jackson) instead of being resolved to a view name. It also wires message conversion, exception handling, and content negotiation:

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {
    @GetMapping("/{id}")
    public ResponseEntity<OrderSummary> get(@PathVariable Long id) {
        return ResponseEntity.ok()
            .header("Cache-Control", "max-age=5")
            .body(orderService.getSummary(id));     // serialized to JSON, never a view
    }
}
```

One service, one bounded REST contract — the response shape IS the contract, so return a DTO, never a JPA entity.

**Q9. What is idempotency and why do services care?**
An operation is idempotent if doing it twice has the same effect as doing it once. Services must be, because the network delivers duplicates: a client times out at 3 s, retries, and the first request actually succeeded. Without idempotency you double-charge:

```java
@PostMapping("/api/payments")
public Payment create(@RequestBody @Valid PayRequest req,
                      @RequestHeader("Idempotency-Key") String key) {
    return paymentService.charge(key, req);   // key → same payment on replay
}

public Payment charge(String key, PayRequest req) {
    Payment existing = paymentRepo.findByKey(key);
    if (existing != null) return existing;    // replay: return the first result
    return paymentRepo.save(new Payment(key, req.amount()));
}
```

Idempotency keys are cheap insurance; the alternative is a duplicate payment you explain to a customer.

**Q10. How does client-side load balancing work?**
Discovery gives you all healthy instances; the load balancer picks one per request — round-robin by default, weighted when instances differ, sticky only when you must. Spring Cloud LoadBalancer runs inside the caller, so there is no extra hop:

```java
@Bean
public ServiceInstanceListSupplier instanceSupplier(ConfigurableApplicationContext ctx) {
    return ServiceInstanceListSupplier.builder()
        .withDiscoveryClient()      // instances from Eureka/Consul
        .withHealthChecks()         // skip instances failing health checks
        .build(ctx);
}
```

Client-side balancing is what lets 200 threads spread across 5 instances instead of hammering one, and it re-routes the instant an instance dies.

**Q11. How do you manage configuration across services?**
Every service needs environment-specific config — URLs, timeouts, feature flags. `application.yml` per profile drifts the moment you have three environments. Centralize with Spring Cloud Config or a secrets store, and bind config to typed properties instead of scattered `@Value`:

```java
@ConfigurationProperties(prefix = "inventory.client")
public record InventoryClientProps(
    String baseUrl,               // http://inventory-service
    Duration connectTimeout,      // 2s
    Duration readTimeout,         // 3s
    int maxConnections            // 200
) {}
```

Typed config fails at startup, not at runtime: a typo in `readTimeout` becomes a failed deploy, not a 3-hour outage.

**Q12. What is a message broker and when do you introduce one?**
A broker (Kafka, RabbitMQ) decouples producers from consumers, buffers bursts, and gives at-least-once delivery. Introduce it when you need fan-out, buffering, or replay — not because "events sound cool". A producer in Kafka is four lines:

```java
@Service
public class OrderPublisher {
    private final KafkaTemplate<String, OrderPlaced> kafka;

    public void publish(Order o) {
        kafka.send("order.placed", o.id().toString(),
                   new OrderPlaced(o.id(), o.userId(), o.total()));
    }
}
```

A broker handles 100k+ msg/s per partition set where a synchronous fan-out to 5 services would collapse under latency and partial failures.

**Q13. What are health checks and why do readiness vs liveness matter?**
Liveness: is the process alive — kill and restart it if not. Readiness: is it ready to receive traffic — take it out of the load balancer if not. Spring Boot actuator exposes both:

```java
@Component
public class InventoryHealthIndicator implements HealthIndicator {
    @Override
    public Health health() {
        boolean ok = restClient.get()
            .uri("http://inventory-service/actuator/health")
            .retrieve().toBodilessEntity().getStatusCode().is2xxSuccessful();
        return ok ? Health.up().build()
                  : Health.down().withDetail("inventory", "unreachable").build();
    }
}
```

Config: liveness at `/actuator/health/liveness`, readiness at `/actuator/health/readiness`. A process that is alive but not ready must not receive traffic — that distinction is what stops rolling deploys from black-holing requests.

**Q14. What is a fallback and how do you degrade gracefully?**
A fallback returns something useful when the dependency fails — a cached value, a default, an empty list — so the user gets degraded-but-working instead of a 500:

```java
@Cacheable("catalog")
public CatalogResponse getCatalog(String category) { ... }

@CircuitBreaker(name = "catalog", fallbackMethod = "cachedCatalog")
public CatalogResponse catalogOrStale(String category) {
    try { return getCatalog(category); }
    catch (Exception e) { return staleCatalog(category); }   // last known good
}
```

Without fallbacks, one flaky dependency turns your p99 from 80 ms into 3 s timeouts and a heap of 500s; with them, p99 degrades to ~100 ms served from a stale cache.

**Q15. What is a timeout and what happens if you never set one?**
A timeout bounds how long a call may take; without one, a hung dependency holds your thread forever. At 200 threads, a callee that never responds takes the whole service down in minutes — every thread parked in a read that never returns:

```java
var requestFactory = new JdkClientHttpRequestFactory();
requestFactory.setConnectTimeout(Duration.ofSeconds(2));
requestFactory.setReadTimeout(Duration.ofSeconds(3));     // the answer must come in 3s

RestClient client = RestClient.builder()
    .baseUrl("http://inventory-service")
    .requestFactory(requestFactory)
    .build();
```

Rule: every outbound call has a timeout, and it is shorter than your own SLA — the failure surfaces at 3 s as a visible, bounded, debuggable error instead of an invisible hang.

**Q16. What is a retry and when should you NOT retry?**
A retry re-executes a failed call, usually with backoff. Retry transient failures (connection reset, 503) — never retry 4xx (your request is wrong; retrying won't fix it) and never retry non-idempotent calls (you create duplicates):

```java
@Retry(name = "inventory", fallbackMethod = "fallback")
public InventoryStatus check(String sku) {
    return client.get().uri("/api/stock/{sku}", sku).retrieve().body(InventoryStatus.class);
}
```

```yaml
resilience4j.retry:
  instances:
    inventory:
      maxAttempts: 3 # original + 2 retries
      waitDuration: 100ms
      exponentialBackoffMultiplier: 3.0 # 100ms → 300ms → 900ms
      retryExceptions:
        [
          java.net.ConnectException,
          org.springframework.web.client.HttpServerErrorException,
        ]
      ignoreExceptions:
        [org.springframework.web.client.HttpClientErrorException]
```

Numbers: a 5% failure rate with 3 attempts drops the user-visible failure to ~0.0125%; retrying 4xx gets you 400s in a row and a very confused client.

**Q17. What is a DTO and how do you keep a service contract stable?**
A DTO is the wire shape of your API — decoupled from your database entity so you can change storage without breaking consumers, and version it without migrating their code. Exposing a JPA entity leaks your schema into every consumer:

```java
// WRONG: entity on the wire — every column change breaks consumers
public OrderEntity getEntity(Long id) { return orderRepo.findById(id).orElseThrow(); }

// RIGHT: explicit DTO = the contract
public record OrderSummary(Long id, String status, BigDecimal total,
                           OffsetDateTime placedAt) {
    public static OrderSummary from(OrderEntity e) { ... }
}
```

Contract-first: the DTO is the interface; consumers depend on it, never on your tables.

## Mid — tradeoffs & pitfalls

**Q18. Database-per-service — why is a shared DB an anti-pattern?**
When two services query the same schema you have a distributed monolith with extra hops: a schema change in A breaks B's queries, transactions span services, and nothing scales independently. The fix is private data per service, exposed only through APIs and events:

```java
// WRONG: OrderService reaches into the inventory schema
@Repository
public interface OrderRepo extends JpaRepository<OrderEntity, Long> {
    @Query(value = "SELECT stock FROM inventory.sku WHERE sku = :sku", nativeQuery = true)
    int stockOnHand(@Param("sku") String sku);   // couples two schemas forever
}

// RIGHT: ask InventoryService over the network
InventoryStatus s = inventoryClient.stockOf(sku);
```

Signal: if two services must share a table, they are one bounded context pretending to be two — merge them.

**Q19. Distributed transaction across two services — 2PC or Saga?**
2PC (two-phase commit via JTA) locks resources in both databases while the coordinator decides — it does not scale and fails badly under partial failure: a dead coordinator leaves everyone blocked on locks for minutes. Saga replaces the global lock with local transactions plus compensating actions:

```java
// WRONG: distributed lock — one coordinator, two DBs, both locked for the whole decision
@Transactional
public void pay() {
    orderDb.updateStatus(id, "PAID");      // lock held in DB A ...
    paymentDb.charge(id, amount);          // ... while DB B decides — minutes under failure
}

// RIGHT: saga — local txns, compensation on failure
@Transactional
public void reserve() { inventoryDb.reserve(sku, qty); }      // + compensate: release()
@Transactional
public void charge()  { paymentDb.charge(id, amount); }       // + compensate: refund()
```

2PC trades availability for atomicity and gets neither in the distributed world; Saga accepts eventual consistency and keeps the system available. That trade is the whole story of distributed transactions.

**Q20. Implement an orchestration saga for order → inventory → payment.**
An orchestration saga has one coordinator (OrderService) that drives the steps and runs compensating actions on failure. Each step is a local `@Transactional`; the coordinator catches failures and walks back:

```java
public class OrderSaga {
    private final InventoryClient inventory;
    private final PaymentClient payments;

    public OrderResult place(Order order) {
        try {
            inventory.reserve(order.sku(), order.qty());      // step 1 (3s timeout)
            try {
                payments.charge(order.id(), order.total());   // step 2 (3s timeout)
            } catch (Exception e) {
                inventory.release(order.sku(), order.qty());  // compensate step 1
                throw e;
            }
            return new OrderResult(order.id(), "CONFIRMED");
        } catch (Exception e) {
            return new OrderResult(order.id(), "FAILED");     // no partial state survives
        }
    }
}
```

Each downstream call has a 3 s timeout; the saga fails fast and compensates rather than holding locks. Orchestration beats choreography here because the flow has clear order and one owner — choreography gets unreadable past three steps.

**Q21. What is eventual consistency and what breaks for users?**
After a write, replicas and derived data converge over time, not atomically. What breaks: a user updates their profile, refreshes, and sees the old version; a replica serves a stale stock count and the user over-orders. Mitigations — read-your-writes and serving the just-written value:

```java
@PostMapping("/api/users/{id}/profile")
public UserProfile update(@PathVariable Long id, @RequestBody ProfileDto dto) {
    userService.save(id, dto);
    // read-your-writes: return the value just written, from the source of truth
    return new UserProfile(id, dto.displayName(), "updated");
}
```

Eventually consistent systems must decide their staleness budget: 1 s reads, 5 s writes, 5 minutes of reporting — each is a product decision, not an accident.

**Q22. Idempotency vs exactly-once — why is exactly-once a lie?**
Delivery is at-least-once: a retry can deliver the same message twice. True exactly-once end-to-end (producer, broker, and consumer) is not achievable in practice. So you build idempotent consumers and dedupe at the edge — the same effect as exactly-once, far more robust:

```java
@KafkaListener(topics = "payment.confirmed")
public void onPayment(PaymentConfirmed e) {
    int updated = orderRepo.markPaidIfNotAlready(e.orderId());
    // UPDATE orders SET status='PAID' WHERE id=? AND status != 'PAID'
    if (updated == 1) { notifyUser(e); }   // side effect only on first delivery
}
```

Numbers: a 3× retry storm on a 1k msg/s stream means 2k duplicates to absorb; a conditional update or unique constraint eats them, a naive insert does not.

**Q23. What is the outbox pattern and when do you need it?**
The dual-write problem: commit the DB row and send to Kafka, and one of the two can fail — a lost event, or an event without the row. The outbox makes the DB the source of truth: write the event in the same local transaction, then a relay publishes it:

```java
@Transactional
public void placeOrder(Order o) {
    orderRepo.save(o);
    outboxRepo.save(new OutboxEvent("order.placed", objectMapper.writeValueAsBytes(o)));
    // same local txn — either both happen or neither
}

@Component
public class OutboxRelay {
    @Scheduled(fixedDelay = 200)
    public void publish() {
        for (OutboxEvent e : outboxRepo.findTop100ByPublishedFalse()) {
            kafka.send(e.topic(), e.payload());   // retried until acked
            e.published(true);
        }
    }
}
```

Cost: ~200 ms–1 s of extra latency and a relay to operate. Benefit: no lost events, no dual-write bugs — the most important pattern in event-driven services.

**Q24. Why does `@Transactional` not work across two services?**
`@Transactional` is a local DB transaction bound to one datasource and one thread. It cannot span an HTTP call — the proxy commits or rolls back only the local connection. Worse: holding a DB transaction open across a 3 s network call pins a connection and locks rows:

```java
// WRONG: txn held across the network — connection + row locks for the whole HTTP call
@Transactional
public void placeOrder(Order o) {
    orderRepo.save(o);
    payments.charge(o.id(), o.total());        // 3s network call INSIDE the txn
    inventory.reserve(o.sku(), o.qty());       // another one — locks held for 6s+
}

// RIGHT: local txn only, network calls outside, saga/compensation for the rest
public void placeOrder(Order o) {
    saveOrderLocal(o);                          // own txn, fast commit
    try { payments.charge(o.id(), o.total()); }
    catch (Exception e) { markOrderFailed(o.id()); }
}
```

A 6 s lock window at 200 concurrent orders is 1,200 lock-seconds of contention; keep transactions local and short, and let the saga do the orchestration.

**Q25. What is a retry storm and how do retries amplify an outage?**
Everyone retries at once: the dependency fails, and 100 clients × 3 retries = 400 requests slamming a service that was already dying — a 5% flake becomes a self-inflicted DDoS. The fixes: exponential backoff with jitter so retries spread out, a global cap, and a circuit breaker so the stream stops entirely:

```java
// WRONG: immediate synchronized retries — 200 threads × 3 instant retries = 600 rps of hammering
@Retry(name = "inventory", maxAttempts = 3)      // no backoff — thundering herd

// RIGHT: backoff + jitter + breaker so retries fan out, then stop
```

```yaml
resilience4j.retry:
  instances:
    inventory:
      maxAttempts: 3
      waitDuration: 100ms
      exponentialBackoffMultiplier: 2.0
      enableExponentialBackoff: true
      enableRandomizedWait: true # jitter: 100ms ± 50% — the herd becomes a drizzle
resilience4j.circuitbreaker:
  instances:
    inventory:
      slidingWindowSize: 10
      failureRateThreshold: 50 # >50% of 10 calls failing → open
```

Without jitter, 200 threads retry in lockstep and the breaker never gets a quiet window to test recovery; with it, the dying service sees a trickle and half-opens cleanly.

**Q26. OpenFeign vs RestClient vs WebClient — when which?**
Feign gives you a typed interface — the contract is a Java type, retries and decoding come free. RestClient is the lightweight synchronous option for ad-hoc calls. WebClient is for reactive stacks. Pick Feign when a service is a formal dependency with a stable contract:

```java
@FeignClient(name = "inventory-service", url = "${inventory.base-url}",
             configuration = InventoryClientConfig.class)
public interface InventoryClient {
    @GetMapping("/api/stock/{sku}")
    InventoryStatus stock(@PathVariable String sku);

    @PostMapping("/api/stock/reserve")
    Reservation reserve(@RequestBody ReserveRequest req);
}
```

Feign's cost: a generated dynamic proxy per interface and a layer of magic. For a single call to an internal service, RestClient is honest and debuggable; I default to RestClient and reach for Feign at 3+ endpoints.

**Q27. What is bulkhead isolation and how do you configure it?**
A bulkhead limits how much of your own resources one dependency may consume — its own thread pool or semaphore — so a hung dependency fills its own compartment, not the shared pool that serves everything else. Without it, one slow callee starves the whole service:

```java
@Bulkhead(name = "inventory", type = Bulkhead.Type.THREADPOOL)
@CircuitBreaker(name = "inventory")
public InventoryStatus stock(String sku) {
    return client.get().uri("/api/stock/{sku}", sku).retrieve().body(InventoryStatus.class);
}
```

```yaml
resilience4j.bulkhead:
  instances:
    inventory:
      maxConcurrentCalls: 20 # only 20 threads may wait on inventory
      maxWaitDuration: 500ms # the 21st fails fast instead of queueing
    payments:
      maxConcurrentCalls: 30
```

Numbers: a shared pool of 200 threads with one 3 s-timeout dependency at 200 rps exhausts everything in ~1 s; split 20/30/50 with 100 spare, and payments can hang while orders still get served.

**Q28. How do you trace a request across 8 services?**
Distributed tracing propagates one trace ID across every hop, so you see the full waterfall and where time went. Spring Boot 3 + Micrometer Tracing + OpenTelemetry wires this automatically; the same trace ID lands in every log line:

```java
@Configuration
public class TraceConfig {
    @Bean
    public ObservationRegistryCustomizer<ObservationRegistry> customizer() {
        return registry -> registry.observationConfig()
            .observationHandler(new LoggingObservationHandler());  // traceId/spanId in logs
    }
}
```

```yaml
management:
  tracing:
    sampling:
      probability: 0.1 # 10% sampled at 10k rps = 1k traces — plenty
  zipkin:
    tracing:
      endpoint: http://tracing:9411/api/v2/spans
```

Without tracing you are blind — each service's logs are a separate puzzle with no path. Cost is microseconds per call; the payoff is finding the 3 s timeout buried in service 6 instead of guessing.

**Q29. How do you version an API or an event without breaking consumers?**
Any published contract will evolve; consumers must not break when it does. Version the wire format, not the code: `v1/orders` keeps serving old clients while `v2` ships; for events, add fields without removing old ones (forward/backward-compatible JSON):

```java
// v1 of the DTO stays frozen; v2 adds a field the old payload simply lacks
public record OrderSummaryV1(Long id, String status, BigDecimal total) {}

public record OrderSummaryV2(Long id, String status, BigDecimal total,
                             OffsetDateTime placedAt) {}

@GetMapping(value = "/api/orders/{id}", headers = "Accept-version=v1")
public OrderSummaryV1 getV1(@PathVariable Long id) { return toV1(service.get(id)); }

@GetMapping(value = "/api/orders/{id}", headers = "Accept-version=v2")
public OrderSummaryV2 getV2(@PathVariable Long id) { return toV2(service.get(id)); }
```

Real numbers: breaking a contract without versioning takes down ~30% of consumers overnight; versioning costs a few extra DTOs and pays off in zero breakage.

**Q30. Chatty calls — why is 8 sequential HTTP calls a problem?**
Each hop adds latency and they stack: 8 sequential calls × 50 ms = 400 ms minimum, and p99 tail behavior makes the real number worse. Independent calls run in parallel; dependent ones get aggregated server-side:

```java
// WRONG: 8 sequential round-trips — 8 × 50ms = 400ms of serial latency
Order o = orderClient.get(id);
User u = userClient.get(o.userId());
Address a = addressClient.get(o.shippingAddressId());
// ... five more, one after another

// RIGHT: parallel fan-out, bounded by the slowest call
CompletableFuture<Order> of = supplyAsync(() -> orderClient.get(id), pool);
CompletableFuture<User> uf = of.thenCompose(o ->
    supplyAsync(() -> userClient.get(o.userId()), pool));
CompletableFuture.allOf(of, uf).join(3, TimeUnit.SECONDS);   // wait at most 3s
```

Parallel fan-out of 8 calls takes p99 from ~1.2 s to ~200 ms; every sequential hop you can parallelize is free latency back.

**Q31. How do you pick circuit breaker thresholds — and what happens when you tune them wrong?**
Too sensitive: a 10-call window trips on a single 3 s timeout and you fail fast while the dependency is fine. Too lenient: the breaker never trips and you keep queueing on a dead dependency. Tune from real numbers — failure rate, slow-call threshold, cooldown:

```java
CircuitBreakerConfig cfg = CircuitBreakerConfig.custom()
    .slidingWindow(10, 10, COUNT_BASED)            // decide on the last 10 calls
    .failureRateThreshold(50)                      // trip when >50% fail
    .slowCallDurationThreshold(Duration.ofSeconds(3))   // a 3s call counts as a failure
    .slowCallRateThreshold(60)
    .permittedNumberOfCallsInHalfOpenState(3)      // probe with 3 calls before closing
    .waitDurationInOpenState(Duration.ofSeconds(30))   // stay open 30s, then half-open
    .build();
```

At p99 80 ms and a 3 s threshold, a slow-call rate above 60% genuinely means the dependency is sick; the 30 s cooldown lets it breathe, and the 3 half-open probes verify recovery before full traffic returns.

**Q32. How do services keep derived or denormalized data consistent?**
When service A owns the source of truth and service B serves a read model (search index, order list), B reacts to A's events and builds its own projection. The alternative — querying A synchronously per request — couples B's latency and availability to A:

```java
@Component
public class OrderProjection {
    @KafkaListener(topics = "order.placed", groupId = "search-index")
    public void onPlaced(OrderPlaced e) {
        indexService.index(new OrderDoc(e.orderId(), e.userId(), e.total()));
    }

    @KafkaListener(topics = "order.cancelled", groupId = "search-index")
    public void onCancelled(OrderCancelled e) {
        indexService.remove(e.orderId());
    }
}
```

Cost: the projection lags the source by ~100 ms–1 s and consumers must tolerate staleness. Benefit: reads are local, fast, and available even when the source service is down.

**Q33. How do you handle secrets and environment configuration?**
Secrets in `application.yml` or committed env files are a breach waiting for a log leak. Production credentials live in a vault (HashiCorp Vault, AWS Secrets Manager, K8s Secrets); the app fetches them at deploy time and never logs them:

```java
@ConfigurationProperties(prefix = "payments")
public record PaymentProps(String apiKey, String baseUrl) {}
```

```yaml
# application.yml — no secrets
payments:
  base-url: ${PAYMENTS_URL:http://payments:8080}
  api-key: ${PAYMENTS_API_KEY} # injected from the vault at deploy time
```

Key rotation, per-env overrides, and audit all belong to the vault. A leaked key costs an incident; a vault costs a config change.

**Q34. JSON vs binary serialization (protobuf/Avro) between services — what's the tradeoff?**
JSON is debuggable and universal; protobuf/Avro is schema'd, ~5–10× smaller and faster to parse, and gives schema evolution via a registry. For internal high-throughput streams the binary format pays for itself; for public APIs, JSON wins on developer experience:

```java
// JSON: readable, flexible — payload ~120 bytes, parse ~1-2 µs
record OrderEvent(Long id, String sku, int qty) {}

// Protobuf: schema'd, compact — payload ~30 bytes, parse ~200 ns
message OrderEvent {
  int64 id = 1;
  string sku = 2;
  int32 qty = 3;
}
```

Numbers: at 50k events/s the parse-time difference alone is ~50–90 ms of CPU per second, and the wire-size difference compounds on network-bound consumers. Start with JSON; move to schema'd binary when volume or schema evolution hurts.

## Senior — design & defense

**Q35. A team wants to split a 3-year-old monolith into 20 microservices. What do you say?**
"I'd push back hard and ask what problem the split solves. If the pain is a messy module boundary or a slow deployment pipeline, the fix is a modular monolith — same codebase, strict package boundaries — not 20 services. I'd split only along a _proven_ bounded context with different scaling or team-ownership needs, incrementally via strangler fig, never big-bang:"

```java
// Modular monolith first: strict dependency rules, one deployable
module com.shop.orders {
    exports com.shop.orders.api;
    requires com.shop.shared.kernel;   // orders may NOT import inventory internals
}
```

"Each of 20 services means its own build, deploy, rollback, on-call rotation, and failure mode. If two services can't deploy or scale independently, you paid the microservice tax for nothing — that's the argument that wins interviews."

**Q36. Design a payment flow across Order, Inventory, and Payment services without 2PC.**
"An orchestration saga with OrderService as coordinator. Steps: reserve inventory (local txn + `release` compensation), then charge payment (local txn + `refund` compensation). If payment fails, the coordinator triggers `release`. A saga log records each step so a crash resumes the saga instead of re-executing it:"

```java
@Service
public class OrderSaga {
    private final SagaLog log;
    private final InventoryClient inventory;
    private final PaymentClient payments;

    public OrderResult place(Order o) {
        String sagaId = log.start("order-placement", o.id());
        try {
            log.record(sagaId, "reserve");
            inventory.reserve(o.sku(), o.qty());                 // timeout 3s
            try {
                log.record(sagaId, "charge");
                payments.charge(o.id(), o.total());              // timeout 3s
                log.record(sagaId, "done");
                return OrderResult.confirmed(o.id());
            } catch (Exception e) {
                log.record(sagaId, "compensate:release");
                inventory.release(o.sku(), o.qty());             // undo step 1
                return OrderResult.failed(o.id());
            }
        } finally {
            log.record(sagaId, "complete");
        }
    }
}
```

"Each step fails fast at 3 s; worst case ~6 s, no global locks, and the log answers 'where did this saga die?' after a crash."

**Q37. A downstream HTTP call is flaky (5% timeouts at 3 s). Design the resilience layer.**
"Four layers, in order: **timeout** (3 s, shorter than my own SLA), **retry** with exponential backoff + jitter (3 attempts, idempotent only), **circuit breaker** (open after 50% failures in a 10-call window, 30 s cooldown), and **bulkhead** (max 20 concurrent calls to this dependency). Plus a fallback to a cached value so users see degraded-but-working:"

```java
@Bean
public Resilience4JCircuitBreakerFactory cbFactory() {
    var cfg = new Resilience4JConfigBuilder("inventory")
        .timeLimiterConfig(TimeLimiterConfig.custom()
            .timeoutDuration(Duration.ofSeconds(3)).build())        // fail at 3s
        .circuitBreakerConfig(CircuitBreakerConfig.custom()
            .slidingWindowSize(10)
            .failureRateThreshold(50)
            .waitDurationInOpenState(Duration.ofSeconds(30))
            .build())
        .retryConfig(RetryConfig.custom()
            .maxAttempts(3)
            .waitDuration(Duration.ofMillis(100))
            .enableExponentialBackoff()
            .enableRandomizedWait()
            .build())
        .bulkheadConfig(BulkheadConfig.custom()
            .maxConcurrentCalls(20).build())                       // own compartment
        .build();
    var factory = new Resilience4JCircuitBreakerFactory();
    factory.configureDefault(cbFactory, cfg);
    return factory;
}
```

"With 5% timeouts, 3 attempts cut user-visible failure to ~0.0125%; the breaker caps damage during a real outage at 20 concurrent calls instead of 200; p99 stays under budget because nothing waits more than 3 s."

**Q38. When is a monolith actually the better choice, and how do you keep it clean?**
"For a small team, a young product, or a domain without independent scaling needs, the modular monolith is faster to build, debug, and deploy — no distributed failure modes at all. Keep it clean with explicit module boundaries enforced by tests, not vibes:"

```java
@ArchTest
static final ArchRule modules_must_not_depend_on_each_other =
    classes().that().resideInAPackage("..orders..")
        .should().onlyDependOnClassesThat()
        .resideInAnyPackage("..orders..", "..shared..");
```

"ArchUnit fails the build when `orders` imports `inventory` internals, so boundaries stay real until a proven reason to split appears. Migrate to services only when a boundary's scaling or team-ownership needs genuinely diverge; premature splitting is the most expensive mistake in this space."

**Q39. How do you choose sync vs async between two specific services?**
"Ask two questions: is the caller blocked on this answer, and can the system tolerate a delay? Order→Inventory 'reserve stock' — sync: the user is waiting on confirmation and a timeout is a clear, showable failure. Order→Notification — async: nobody blocks on it, and I want it to survive the notifier being down:"

```java
// Order → Inventory: sync — user is waiting, 3s timeout = visible failure
InventoryStatus s = inventoryClient.reserve(req);

// Order → Notification: async — decouple, survive outages
orderEvents.publish(new OrderPlaced(o));    // broker buffers, retries later
```

"Mixing them wrongly — sync-calling five services in a row — creates a latency chain that fails at the speed of the slowest link, and each one gets a retry storm when the weakest dies."

**Q40. Defend your service boundaries — how do you know a split is right?**
"A correct boundary is a bounded context: one reason to change, one owning team, deployable and scalable alone, private data. The test: 'If I change service A's schema, must B redeploy?' If yes, they are one context pretending to be two. The proof is operational — independent deploy frequency and failure isolation:"

```java
// Orders context publishes facts; Billing consumes them — no shared code, no shared schema
@Component
public class OrderPublisher {
    public void placed(Order o) { events.publish(new OrderPlaced(o.id(), o.total())); }
}

@Component
public class BillingConsumer {
    @KafkaListener(topics = "order.placed", groupId = "billing")
    public void on(OrderPlaced e) { invoiceService.create(e.orderId(), e.total()); }
}
```

"Boundaries are validated by deploy/scale/failure independence, not by drawing boxes. If A and B always ship together and share a schema, I've built a distributed monolith and should merge them."

**Q41. 2PC vs Saga — defend the choice with numbers.**
"2PC holds a global lock: at 1k orders/min, a coordinator crash at the prepare phase blocks transactions for minutes — availability dies, not just latency. Saga keeps every step a short local transaction: p50 ~10 ms, p99 ~200 ms, with seconds-to-minutes of inconsistency that compensation closes:"

```java
// 2PC: atomic but fragile — coordinator crash = blocked locks = minutes of unavailability
// Saga: no global lock, eventual consistency, compensation closes the gap
public void shipAndBill(Shipment s) {
    try {
        inventory.ship(s);                    // local txn, ~10ms
        billing.invoice(s);                   // local txn, ~10ms
    } catch (Exception e) {
        inventory.unship(s);                  // compensate — closes the gap
    }
}
```

"If the business can accept a 5-minute reconciliation window, Saga gives you p99 < 200 ms and 99.99% availability; 2PC gives you atomicity nobody can actually observe and takes your p99 hostage. Real systems choose Saga and audit later."

**Q42. A service's p99 is 5× its p50. Walk the diagnosis.**
"p50 80 ms, p99 1.2 s means a tail distribution. Three suspects in order: GC pauses (a 1 s full GC shows up as a cliff), lock contention, and downstream timeouts/retries. Tracing shows which; percentiles show the shape:"

```java
@Timed(name = "orders.get", histogram = true,
       percentiles = {0.50, 0.95, 0.99})
public OrderSummary get(Long id) { ... }
```

```yaml
management:
  metrics:
    distribution:
      percentiles-histogram:
        orders.get: true
```

"If the p99 cliff aligns with a full GC on the heap graph, it's the JVM; if it aligns with 3 s downstream timeouts, it's the retry/breaker config; if it's scattered, usually lock contention. I fix the one that owns the biggest slice of the tail — measured, not guessed."

**Q43. How do you size the outbound thread pool — and what happens when you get it wrong?**
"Little's Law: to sustain N concurrent requests of latency L you need pool ≥ N. With a pool of 200 and a 3 s downstream timeout, the service carries at most ~200 concurrent in-flight calls — if all 200 threads park on a 3 s timeout, throughput collapses to ~66 rps. Size from measured concurrency, bound the queue, fail fast at the edge:"

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    50,                       // core
    200,                      // max — 200 concurrent outbound calls, ever
    60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),            // bounded queue
    new ThreadPoolExecutor.CallerRunsPolicy()  // backpressure, not silent drops
);
```

"Under-provision: the queue grows and latency blows past the SLA. Over-provision: each thread costs ~1 MB of stack plus context-switch overhead. The number comes from measured concurrency × headroom, not vibes — and the queue must be bounded so overload is visible, not absorbed until OOM."

**Q44. A saga crashes at step 3 of 5. How do you make it resumable?**
"An in-memory saga dies with the process, leaving half-applied steps. Persist the saga state: every step transition writes to the saga table in the same local transaction as the step's effect. On restart, scan for in-progress sagas and continue or compensate from the last recorded step:"

```java
@Entity
public class SagaInstance {
    @Id String sagaId;
    String status;       // STARTED / IN_PROGRESS / DONE / COMPENSATING
    int lastStep;        // 1=reserve, 2=charge, 3=ship, ...
}

@Component
public class SagaRecovery {
    @EventListener(ApplicationReadyEvent.class)
    public void resume() {
        sagaRepo.findByStatusIn(List.of("STARTED", "IN_PROGRESS")).forEach(s -> {
            switch (s.lastStep()) {
                case 1 -> compensateFrom(s, "reserve");
                case 2 -> compensateFrom(s, "charge");
                default -> retryForward(s);
            }
        });
    }
}
```

"Each step's effect is written together with its saga-log entry in one transaction, so the log is always truthful. Recovery runs within 30 s of restart; the cost is one table and a startup scan."

**Q45. How do you set SLOs and budget error budgets across a chain of services?**
"Each hop eats reliability: three services at 99.9% give 99.7% end-to-end — 3 failed requests per 1,000. Budget backward from the user-visible SLO: user p99 < 1 s means order p99 < 900 ms, meaning inventory + payment together < 700 ms. Every dependency gets its own budget and a breaker tuned to enforce it:"

```java
// Budget: user SLO 99.9% → each of 3 services burns at most 0.033%
// At 1M requests/month, a service may fail 333 times before paging
public class SloBudget {
    public static final double CHAIN_SLO = 0.999;
    public static final double PER_SERVICE = 1 - (1 - CHAIN_SLO) / 3;   // 0.99967
}
```

```yaml
prometheus:
  alerts:
    - expr: rate(http_server_requests_seconds_count{status=~"5.."}[5m]) > 0.001
      for: 15m # burning 0.1% of budget in 15 minutes → page
```

"Numbers that matter: a 3-service chain at 99.9% each is 99.7% user-visible. If the product needs 99.95%, someone gets a 99.99% SLO with a tighter timeout, or the chain gets shorter."

**Q46. How do you rate-limit and enforce backpressure across the chain?**
"Server-side, a 429 for clients that exceed their quota protects you from a 10× burst. Client-side, a rate limiter on outbound calls protects your dependency. Resilience4j gives both sides:"

```java
@RateLimiter(name = "payments-outbound", fallbackMethod = "quotaExceeded")
public PaymentResult charge(PaymentRequest req) {
    return paymentsClient.charge(req);
}
```

```yaml
resilience4j.ratelimiter:
  instances:
    payments-outbound:
      limitForPeriod: 50 # 50 calls per window
      limitRefreshPeriod: 1s # = 50 rps against the payment provider
      timeoutDuration: 500ms # wait up to 500ms for a permit, then fail fast
```

"When the provider slows, a client-side limiter spreads your 50 rps evenly instead of bursting 200 and eating 429s; combined with a 500 ms wait, the caller gets a clean failure in half a second, not a 3 s timeout."

**Q47. How do you prove the system actually recovers — and stays recovered?**
"Resilience is a hypothesis until a test kills the dependency. Fault injection in staging — kill inventory, kill Kafka, kill a database — and assert the SLOs still hold. Automate it: chaos runs on a schedule, metrics are compared to the error budget:"

```java
@Test
@SpringBootTest(webEnvironment = RANDOM_PORT)
class ResilienceChaosTest {
    @Test
    void order_survives_inventory_outage() {
        wireMock.stubFor(post("/api/stock/reserve").willReturn(aResponse()
            .withFixedDelay(5_000).withStatus(503)));   // inventory dead AND slow

        List<CompletableFuture<OrderResult>> calls = IntStream.range(0, 100)
            .mapToObj(i -> supplyAsync(() -> orderSaga.place(order(i)), pool))
            .toList();

        assertThat(calls).allSatisfy(f ->
            assertThat(f.join(5, SECONDS).status()).isIn("FAILED", "DEGRADED"));
        // breaker opened, nothing hung, no thread leaked — asserted, not assumed
    }
}
```

"Run the same test after every resilience change; if a future change silently removes the breaker, the chaos test pages the team before the customers do."

**Q48. You need to rename a field in an event consumed by 10 services. How?**
"Never a breaking rename. Add the new field, ship consumers to read it, then drop the old one — three deployments, each independently safe. A schema registry (Avro/JSON schema) makes the evolution explicit and blocks incompatible changes at the producer:"

```java
// release 1: add the new field, keep the old
record OrderPlaced(Long orderId, String customerId, String customerRef /* new */) {
    public String legacyRef() { return customerRef != null ? customerRef : customerId; }
}

// release 2: consumers read customerRef
// release 3: delete customerId, bump schema version
```

"With 10 consumers, a breaking rename means 10 coordinated deploys or ~10 incident pages; the three-step migration is slower but never requires a coordinated cutover — and the schema registry turns 'I forgot' into a failed CI build instead of a production outage."

**Q49. How do you do authN/authZ across services?**
"One identity domain: the gateway (or an auth service) issues the JWT once, and downstream services validate the signature locally — never a per-request call to a central auth service, which becomes a shared point of failure. Each service still enforces its own authorization claims:"

```java
@Component
public class JwtAuthFilter extends OncePerRequestFilter {
    private final JwtDecoder decoder;   // shared public key — no per-request network call

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res,
                                    FilterChain chain) throws IOException, ServletException {
        Jwt jwt = decoder.decode(extract(req));     // verify signature locally (~100 µs)
        String role = jwt.getClaimAsString("role");
        if (!allowed(req, role)) { res.setStatus(403); return; }
        chain.doFilter(req, res);
    }
}
```

"Local JWT validation is ~100 µs; per-request introspection to a central auth service is 1–5 ms plus an availability dependency. Trust the signature, distribute the public key, keep authorization local."

**Q50. Your architecture review: name the three things that will kill this microservices system in production.**
"First, no circuit breakers and aggressive retries everywhere — one flaky dependency becomes a retry storm that takes the whole chain down (200 threads × 3 immediate retries turned a 5% outage into a full DDoS in one incident I lived through). Second, distributed transactions and shared schemas pretending to be 2PC — the distributed monolith that can never deploy independently. Third, no timeouts: every call waits forever and p99 becomes 'until someone restarts it':"

```java
// The three killers, in code:
// 1. Retry without backoff or breaker — the thundering herd
@Retry(name = "x", maxAttempts = 10)              // 10 × synchronized = 10× the load
// 2. Shared schema / 2PC across services — the distributed monolith
@Transactional
public void place(Order o) { orderRepo.save(o); paymentsDb.charge(...); }   // WRONG
// 3. No timeout — a hung dependency owns your threads
RestClient.builder().build();     // default: no read timeout — hangs forever
```

"The senior answer is the inverse: every call has a timeout (3 s), retries are bounded with backoff and jitter behind a breaker, transactions are local, and the boundary test — 'can this deploy alone?' — is run in every review. If you leave this interview remembering one sentence: resilience is configuration before it is code."

#### Self-check

- [ ] Junior: I can explain microservice vs monolith, sync vs async, gateway, discovery, circuit breaker, REST clients, timeouts, retries, and DTO contracts — each with a working Spring snippet in my head.
- [ ] Mid: I can explain database-per-service, 2PC vs Saga, the outbox, why `@Transactional` can't span services, retry storms, bulkhead, tracing, versioning, and chatty-call parallelization.
- [ ] Senior: I can argue against premature splitting with a modular monolith, design a crash-resumable payment saga, size a 200-thread pool from Little's Law, budget SLOs across a chain, and name the three things that kill a microservices system.
- [ ] Defense: I can defend every choice with numbers — 3 s timeouts, 3× retry with backoff, p99 budgets, and 2PC's lock cost versus Saga's compensation window.
- [ ] Proof: I can demonstrate recovery with fault-injection tests and enforce boundaries with ArchUnit — resilience is configuration before it is code.
