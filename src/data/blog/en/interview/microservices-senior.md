---
title: "Java Interview Prep #6: Microservices Design and Trade-offs"
description: "A practical interview guide to microservice boundaries, communication, resilience, and distributed transactions in Spring."
pubDatetime: 2026-08-10T10:10:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - microservices
  - resilience
---

Microservices are not a default architecture. They are a way to buy independent deployment, scaling, and ownership by accepting network failures, distributed data, and more operational work. The difficult part is deciding whether those benefits justify the cost.

This guide moves from basic service communication to Saga, observability, capacity, and architecture review. The code is illustrative Spring code, not a complete application. Where a number appears in an example, it is marked as an illustrative assumption rather than a universal recommendation.

> Senior signal: name the cost of a design, the condition that justifies it, and how you will detect when the trade-off is no longer acceptable.

## Junior: foundations

**Q1. What is a microservice, and how does it differ from a monolith?**

A microservice is an independently deployable service organized around a business capability. It should own its data and expose an explicit contract. A monolith is one deployable unit containing multiple capabilities. Microservices can provide independent scaling, failure isolation, and team ownership, but they introduce network calls, distributed consistency, and operational overhead.

```java
@SpringBootApplication
public class OrderService {
    public static void main(String[] args) {
        SpringApplication.run(OrderService.class, args);
    }
}
```

**[ANALYSIS]** A modular monolith is often the better starting point. Split only when independent ownership, deployment, or scaling solves a demonstrated problem.

**Q2. What is synchronous versus asynchronous communication?**

In synchronous communication, the caller waits for a response, commonly over HTTP or RPC. A slow callee consumes caller resources and adds coupling. In asynchronous communication, the producer publishes a message or event and continues. This reduces temporal coupling, but introduces eventual consistency and makes tracing harder.

```java
// Synchronous: the caller needs the result.
OrderSummary summary = restClient.get()
    .uri("http://order-service/api/orders/{id}", id)
    .retrieve()
    .body(OrderSummary.class);

// Asynchronous: publish a fact and continue.
kafkaTemplate.send("order.placed", new OrderPlaced(orderId));
```

**[ANALYSIS]** Use synchronous communication when the response is part of the current user-visible decision. Use asynchronous communication for work that can complete later, such as notifications.

**Q3. What is an API gateway?**

An API gateway is an entry point that can route requests, authenticate clients, apply rate limits, and aggregate responses. It can hide internal topology and centralize edge policies. It is not a replacement for authorization inside each service.

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

**Q4. What is service discovery, and why avoid hardcoded instance URLs?**

Instances are created, removed, and rescheduled. A fixed instance address therefore becomes stale. Service discovery maps a logical service name to available instances. The mechanism may be a registry or platform DNS; the important property is that callers do not own instance placement.

```java
@Bean
@LoadBalanced
public RestClient.Builder loadBalancedRestClientBuilder() {
    return RestClient.builder();
}

OrderSummary order = restClient.get()
    .uri("http://ORDER-SERVICE/api/orders/{id}", id)
    .retrieve().body(OrderSummary.class);
```

**Q5. What is a circuit breaker?**

A circuit breaker stops sending calls to a dependency that is failing. It fails fast while open, then permits limited probes in half-open state. This prevents repeated timeouts and protects the caller's threads. A breaker does not repair the dependency; it limits the failure's propagation.

```java
@CircuitBreaker(name = "inventory", fallbackMethod = "fallback")
public InventoryStatus check(String sku) {
    return restClient.get().uri("http://inventory-service/api/stock/{sku}", sku)
        .retrieve().body(InventoryStatus.class);
}

public InventoryStatus fallback(String sku, Throwable error) {
    return new InventoryStatus(sku, 0, "unavailable");
}
```

**Q6. What is the difference between an API and an event?**

An API is a request for an operation and a response. An event is a record that something happened. APIs couple a caller to a callee at request time; events allow multiple consumers to react independently. Do not use an event when the producer needs an immediate business decision.

```java
@RestController
class OrderController {
    @PostMapping("/api/orders")
    public Order create(@RequestBody CreateOrder command) { ... }
}

@Component
class OrderEvents {
    @KafkaListener(topics = "order.placed")
    public void onOrderPlaced(OrderPlaced event) { ... }
}
```

**Q7. Which Spring REST client should you use?**

`RestTemplate` is the older blocking client. `WebClient` is suitable for a reactive pipeline. `RestClient`, available since Spring Framework 6.1, is the modern synchronous fluent client. Choose based on the execution model, not on the age of the project.

```java
var factory = new JdkClientHttpRequestFactory();
factory.setReadTimeout(Duration.ofSeconds(3)); // illustrative assumption

RestClient client = RestClient.builder()
    .baseUrl("http://order-service/api")
    .requestFactory(factory)
    .build();
```

**[ANALYSIS]** A blocking service gains little by introducing Reactor only for one outbound call. Use `WebClient` when the surrounding path is already reactive.

**Q8. What does `@RestController` do?**

It combines `@Controller` and `@ResponseBody`. Return values are written to the HTTP response through message converters, commonly as JSON, rather than treated as view names. It also participates in content negotiation and exception handling.

```java
@RestController
@RequestMapping("/api/orders")
class OrderController {
    @GetMapping("/{id}")
    ResponseEntity<OrderSummary> get(@PathVariable Long id) {
        return ResponseEntity.ok(orderService.getSummary(id));
    }
}
```

Return a DTO as the contract. Do not expose a JPA entity as the wire model.

**Q9. What is idempotency?**

An idempotent operation has the same business effect when repeated. This matters because a timeout does not prove that the server failed; a client may retry a request that already committed. An idempotency key lets the service return the first result instead of performing the operation again.

```java
public Payment charge(String key, PayRequest request) {
    Payment existing = paymentRepo.findByKey(key);
    if (existing != null) return existing;
    return paymentRepo.save(new Payment(key, request.amount()));
}
```

The lookup and insert need a database uniqueness guarantee or equivalent concurrency control.

**Q10. How does client-side load balancing work?**

Discovery supplies eligible instances; a client-side load balancer selects one for each request. Selection may be round-robin, weighted, or another policy. Health checks should remove unhealthy instances from the candidate set.

```java
@Bean
public ServiceInstanceListSupplier instanceSupplier(
        ConfigurableApplicationContext context) {
    return ServiceInstanceListSupplier.builder()
        .withDiscoveryClient()
        .withHealthChecks()
        .build(context);
}
```

**Q11. How should configuration be managed?**

Keep environment-specific values out of business code. Central configuration or a platform configuration mechanism can manage URLs, timeouts, and feature flags. Bind values to typed properties so invalid configuration is detected during startup.

```java
@ConfigurationProperties(prefix = "inventory.client")
public record InventoryClientProps(
    String baseUrl,
    Duration connectTimeout,
    Duration readTimeout,
    int maxConnections
) {}
```

**Q12. What is a message broker, and when should you add one?**

A broker such as Kafka or RabbitMQ separates producers from consumers, buffers work, and commonly supports at-least-once delivery. Introduce one for a concrete need such as fan-out, buffering, or replay. It also adds operations, delivery semantics, and failure modes.

```java
public void publish(Order order) {
    kafka.send("order.placed", order.id().toString(),
        new OrderPlaced(order.id(), order.userId(), order.total()));
}
```

**Q13. What is the difference between liveness and readiness?**

Liveness asks whether the process should be restarted. Readiness asks whether it should receive traffic. A process may be alive but not ready while it starts, drains, or loses a required capability. Expose the two states separately, for example through Spring Boot Actuator.

**Q14. What is a fallback?**

A fallback is a defined response when a dependency is unavailable: cached data, a default, an empty result, or an explicit degraded state. It is appropriate only when the fallback is safe for the business operation. Never hide a failed payment behind a successful-looking default.

```java
@CircuitBreaker(name = "catalog", fallbackMethod = "staleCatalog")
public CatalogResponse catalog(String category) {
    return catalogClient.fetch(category);
}
```

**Q15. What is a timeout, and why is it mandatory?**

A timeout bounds waiting. Without one, a hung dependency can retain a connection, thread, or queue slot indefinitely. Set connect and read timeouts for every outbound call, and make the total budget compatible with the caller's own SLO.

```java
factory.setConnectTimeout(Duration.ofSeconds(2)); // illustrative assumption
factory.setReadTimeout(Duration.ofSeconds(3));    // illustrative assumption
```

**Q16. What is a retry, and when should you not retry?**

A retry repeats a failed operation, usually with exponential backoff and jitter. Retry only failures likely to be transient, and only when repeating the operation is safe. Do not retry invalid `4xx` requests or non-idempotent operations without an idempotency mechanism.

```yaml
resilience4j.retry:
  instances:
    inventory:
      maxAttempts: 3 # illustrative assumption: original call plus two retries
      enableExponentialBackoff: true
      enableRandomizedWait: true
```

**Q17. What is a DTO, and how does it stabilize a contract?**

A DTO is the data shape sent over the wire. It separates the public contract from database entities, allowing storage changes without exposing schema changes to consumers.

```java
public record OrderSummary(Long id, String status,
                           BigDecimal total, OffsetDateTime placedAt) {
    static OrderSummary from(OrderEntity entity) { ... }
}
```

## Mid-level: trade-offs and failure modes

**Q18. Why is a shared database usually a service-boundary smell?**

If two services read and write the same schema, a schema change in one can break the other and deployment independence is lost. Prefer private data ownership with APIs or events. If the same table must be shared, first question whether the two components are actually one bounded context.

**Q19. How do 2PC and Saga differ?**

Two-phase commit coordinates a transaction across resources and can hold locks while the coordinator decides. A Saga uses local transactions and compensating actions. 2PC offers stronger atomicity at the cost of availability and operational coupling; a Saga accepts eventual consistency.

```java
@Transactional
public void reserve() { inventory.reserve(sku, quantity); }

@Transactional
public void charge() { payment.charge(orderId, amount); }
// Compensation might be release(...) or refund(...).
```

**Q20. How would you implement an orchestration Saga?**

One coordinator records progress, invokes local operations, and invokes compensation when a later step fails. Each remote operation needs a timeout and an idempotent contract. Persist progress if the workflow must resume after a process restart.

```java
public OrderResult place(Order order) {
    inventory.reserve(order.sku(), order.quantity());
    try {
        payments.charge(order.id(), order.total());
        return OrderResult.confirmed(order.id());
    } catch (RuntimeException error) {
        inventory.release(order.sku(), order.quantity());
        return OrderResult.failed(order.id());
    }
}
```

**Q21. What is eventual consistency?**

After a write, replicas and derived views may converge later rather than at the same instant. User-visible effects include reading an older profile or a stale stock view. Options include read-your-writes, reading from the source of truth for critical paths, and defining an explicit staleness budget.

**[PROPOSED DESIGN]** The acceptable staleness window is a product decision. Do not present a particular duration as a system fact without a requirement or measurement.

**Q22. Why prefer idempotent consumers over “exactly once”?**

At-least-once delivery means a consumer can receive a message more than once. End-to-end exactly-once behavior across a producer, broker, consumer, and side effects is not something to assume. Make the consumer idempotent using a conditional update, a unique key, or a processed-message record.

```java
@KafkaListener(topics = "payment.confirmed")
public void onPayment(PaymentConfirmed event) {
    int changed = orderRepo.markPaidIfNotAlready(event.orderId());
    if (changed == 1) notifyUser(event);
}
```

**Q23. What is the outbox pattern?**

The database commit and broker publish are separate operations. A process can commit the row and fail before publishing, or publish before the row commits. The outbox writes the business row and event record in one local transaction; a relay publishes pending records and retries safely.

```java
@Transactional
public void placeOrder(Order order) {
    orderRepo.save(order);
    outboxRepo.save(new OutboxEvent("order.placed", serialize(order)));
}
```

**Q24. Why does `@Transactional` not span services?**

Spring's `@Transactional` normally binds a local transaction to a data source. An HTTP call does not automatically extend that transaction to another service. Holding a database transaction open across network calls also retains connections and row locks unnecessarily.

```java
// Keep the local transaction short; coordinate remote work separately.
public void placeOrder(Order order) {
    saveOrderLocal(order);
    payments.charge(order.id(), order.total());
}
```

**Q25. What is a retry storm?**

A retry storm occurs when many callers retry a failing dependency at once, increasing its load and prolonging the outage. Use bounded retries, exponential backoff, jitter, concurrency limits, and a circuit breaker. Retries are a load multiplier, not free reliability.

**Q26. OpenFeign versus `RestClient` versus `WebClient`?**

OpenFeign provides a declarative typed interface and fits stable service dependencies. `RestClient` is direct and synchronous, useful for a small number of calls. `WebClient` fits a reactive pipeline. Compare generated behavior, error handling, observability, and retry configuration before choosing.

```java
@FeignClient(name = "inventory-service")
interface InventoryClient {
    @GetMapping("/api/stock/{sku}")
    InventoryStatus stock(@PathVariable String sku);
}
```

**Q27. What is bulkhead isolation?**

A bulkhead limits the resources a dependency can consume, using a semaphore or a separate pool. A slow dependency then fills its own compartment instead of exhausting resources used by unrelated endpoints.

```java
@Bulkhead(name = "inventory", type = Bulkhead.Type.SEMAPHORE)
@CircuitBreaker(name = "inventory")
public InventoryStatus stock(String sku) { ... }
```

**Q28. How do you trace a request across services?**

Distributed tracing propagates a trace context across service boundaries. Each service creates spans for meaningful work and emits trace and span identifiers in logs. Spring Boot, Micrometer Tracing, and OpenTelemetry can provide the instrumentation, but propagation and sampling still need verification.

**Q29. How do you version an API or event?**

Treat published wire formats as contracts. Add fields in a backward-compatible way, avoid changing the meaning of an existing field, and remove old fields only after consumers have migrated. For incompatible HTTP changes, expose an explicit version or content negotiation policy.

```java
public record OrderSummaryV1(Long id, String status, BigDecimal total) {}
public record OrderSummaryV2(Long id, String status,
                             BigDecimal total, OffsetDateTime placedAt) {}
```

**Q30. Why are chatty calls a problem?**

Each sequential network hop adds latency and another failure opportunity. Parallelize independent calls, aggregate them behind a service boundary, or build a read model. Bound the parallelism and total wait; otherwise fan-out simply moves the overload.

```java
CompletableFuture<Order> order = supplyAsync(() -> orderClient.get(id), pool);
CompletableFuture<User> user = order.thenCompose(o ->
    supplyAsync(() -> userClient.get(o.userId()), pool));
```

**Q31. How do you choose circuit-breaker thresholds?**

Start with measured failure rate, slow-call rate, request volume, and recovery behavior. A small window may react to noise; a large window may react too slowly. The open duration and half-open probes should be tested against the dependency's recovery characteristics.

```java
CircuitBreakerConfig config = CircuitBreakerConfig.custom()
    .slidingWindowSize(10) // illustrative assumption
    .failureRateThreshold(50) // illustrative assumption
    .waitDurationInOpenState(Duration.ofSeconds(30)) // illustrative assumption
    .build();
```

**Q32. How do services maintain derived data?**

The owning service publishes domain events. A consumer builds its own projection, such as a search index or read model. The projection is eventually consistent, so consumers need a policy for missing or stale data.

```java
@KafkaListener(topics = "order.placed", groupId = "search-index")
public void onPlaced(OrderPlaced event) {
    indexService.index(new OrderDoc(event.orderId(), event.total()));
}
```

**Q33. How should secrets be handled?**

Do not commit production credentials or log them. Use a secret manager or platform secret facility, inject values at runtime, rotate them, and audit access. Configuration and secret distribution are separate concerns even when the same platform provides both.

```yaml
payments:
  base-url: ${PAYMENTS_URL}
  api-key: ${PAYMENTS_API_KEY}
```

**Q34. JSON versus protobuf or Avro?**

JSON is widely supported and easy to inspect. Protobuf and Avro provide schemas and can reduce payload size or parsing work, depending on the data and implementation. Use schema-based formats when measured throughput, compatibility, or payload constraints justify the tooling. Do not claim a fixed speedup without a benchmark for the actual messages.

## Senior: design and defense

**Q35. A team wants to split a monolith into 20 services. What do you say?**

**[ANALYSIS]** Ask what problem the split solves. If the issue is unclear modules or slow builds, first create a modular monolith with enforced boundaries. Extract a service only along a proven bounded context with distinct ownership, scaling, or deployment needs. Migrate incrementally, for example with a strangler approach, not as a single rewrite.

**Q36. Design payment across Order, Inventory, and Payment without 2PC.**

**[PROPOSED DESIGN]** Let Order coordinate a Saga: reserve inventory, charge payment, and compensate with release if charging fails. Persist the Saga state and make reserve, charge, release, and refund idempotent. The exact order depends on business risk; payment authorization and inventory reservation may have different compensation semantics.

**Q37. An HTTP dependency is flaky. What resilience layer do you design?**

**[PROPOSED DESIGN]** Start with a timeout, then a bounded retry with backoff and jitter for safe transient failures, a circuit breaker, and a bulkhead. Add a fallback only when stale or degraded data is semantically safe. Tune each layer from traffic and dependency measurements, not copied defaults.

**Q38. When is a monolith the better choice?**

**[ANALYSIS]** A modular monolith is often preferable for a small team, an early product, or a domain without independent scaling needs. Enforce module boundaries with architecture tests and package rules.

```java
@ArchTest
static final ArchRule orders_are_isolated =
    classes().that().resideInAPackage("..orders..")
        .should().onlyDependOnClassesThat()
        .resideInAnyPackage("..orders..", "..shared..");
```

**Q39. How do you choose sync or async between two concrete services?**

Ask whether the caller needs the result to complete the current operation and whether delay is acceptable. Stock reservation is often synchronous when confirmation depends on it. Notification is often asynchronous because the order response need not wait for delivery. These are design assumptions that must match product semantics.

**Q40. How do you defend a service boundary?**

A useful boundary has a clear reason to change, an owning team, private data, and independent deployment and scaling. A practical test is whether a schema change in A requires B to deploy. If yes, investigate whether the boundary is real or whether the system is a distributed monolith.

```java
@KafkaListener(topics = "order.placed", groupId = "billing")
public void on(OrderPlaced event) {
    invoiceService.create(event.orderId(), event.total());
}
```

**Q41. How do you defend 2PC versus Saga with numbers?**

Do not invent latency or availability figures. State the business tolerance first. If the operation requires atomic cross-resource commit and the platform supports it acceptably, 2PC may be justified. If the business can reconcile and compensate, a Saga avoids a global transaction at the cost of an inconsistency window.

**Q42. A service has a long p99 tail. How do you diagnose it?**

Separate the problem into application pauses, lock contention, queueing, downstream latency, and retries. Use traces, runtime metrics, database wait data, and request histograms. A p50/p99 comparison identifies a tail but does not identify its cause.

```java
@Timed(name = "orders.get", histogram = true,
       percentiles = {0.50, 0.95, 0.99})
public OrderSummary get(Long id) { ... }
```

**Q43. How do you size an outbound thread pool?**

Start with measured concurrency, latency, CPU, connection limits, and the caller's SLO. Apply Little's Law carefully: concurrency is approximately throughput multiplied by latency for a stable system. Bound the queue and define overload behavior.

```java
new ThreadPoolExecutor(
    50, 200, 60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000), // illustrative assumptions
    new ThreadPoolExecutor.CallerRunsPolicy());
```

**Q44. A Saga crashes partway through. How is it resumable?**

Persist the Saga state and step transitions. On restart, find in-progress instances and either retry the next idempotent step or compensate from the last durable state. The state record must not claim a step completed before the step's effect is durable.

```java
@Entity
class SagaInstance {
    @Id String sagaId;
    String status;
    int lastStep;
}
```

**Q45. How do you set SLOs across a service chain?**

Start with the user-visible SLO, then allocate latency and error budgets across dependencies. Multiplying independent availability figures is only an approximation; shared failures and retries violate independence. Measure the real chain and reserve budget for retries, queues, and operational work.

**Q46. How do you rate-limit and apply backpressure?**

Rate-limit at the edge to protect the service and on outbound calls to protect dependencies. Bound queues, reject excess work clearly, and expose `429` or another explicit overload response where appropriate. Backpressure is a policy for refusing or delaying work, not merely a queue implementation.

```java
@RateLimiter(name = "payments-outbound", fallbackMethod = "quotaExceeded")
public PaymentResult charge(PaymentRequest request) {
    return paymentsClient.charge(request);
}
```

**Q47. How do you prove resilience?**

Inject realistic failures in a safe environment: dependency errors, delays, broker unavailability, and database failures. Assert bounded latency, correct degradation, no uncontrolled retry growth, and recovery. Run these tests after resilience changes and compare results with the service's SLO.

**Q48. How do you rename an event field consumed by multiple services?**

Use an additive migration. Add the new field while retaining the old one, deploy consumers that understand the new field, then remove the old field only after the compatibility window and schema checks are complete. A schema registry can enforce compatibility, but it cannot replace consumer inventory.

**Q49. How do you handle authentication and authorization across services?**

Use a consistent identity domain. A gateway or identity provider can issue a signed token; services validate it and enforce authorization for their own resources. Local signature validation avoids a mandatory authorization network hop, but key rotation, audience checks, expiry, and claim validation remain necessary.

```java
Jwt jwt = decoder.decode(extractToken(request));
if (!allowed(request, jwt)) {
    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
    return;
}
```

**Q50. What can kill this system in production?**

Three recurring risks are unbounded retries without timeouts or a breaker, shared schemas or distributed transactions that erase service independence, and missing observability. The answer is not a fixed configuration. It is bounded calls, idempotent operations, local transactions, explicit ownership, tracing, metrics, and failure tests.

```java
// Every outbound call needs an explicit, reviewed timeout.
factory.setReadTimeout(Duration.ofSeconds(3)); // illustrative assumption
```

**[SOURCE FACT]** The strongest senior answer is a design that states its assumptions, measures its behavior, and has a rollback or compensation path. Microservices are one option; a well-structured monolith is another.

#### Self-check

- [ ] Junior: I can explain service boundaries, sync versus async communication, gateways, discovery, circuit breakers, clients, timeouts, retries, idempotency, and DTO contracts.
- [ ] Mid-level: I can explain private data, Saga, outbox, local transactions, retry storms, bulkheads, tracing, versioning, projections, and backpressure.
- [ ] Senior: I can justify a split, quantify or measure its trade-offs, design recovery, and say when not to use microservices.
