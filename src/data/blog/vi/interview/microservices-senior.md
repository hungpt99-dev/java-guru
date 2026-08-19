---
title: "Ôn thi Java #6: Thiết kế và đánh đổi trong Microservices"
description: "Hướng dẫn phỏng vấn thực tế về service boundary, giao tiếp, resilience và distributed transaction trong Spring."
pubDatetime: 2026-08-10T10:10:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - microservices
  - resilience
---

Microservices không phải kiến trúc mặc định. Đây là cách để có deployment, scaling và ownership độc lập hơn, đổi lại phải xử lý network failure, distributed data và nhiều công việc vận hành hơn. Phần khó là quyết định lợi ích đó có đáng với chi phí hay không.

Bài này đi từ giao tiếp cơ bản giữa các service đến Saga, observability, capacity và architecture review. Code chỉ là ví dụ Spring, không phải ứng dụng hoàn chỉnh. Khi một con số xuất hiện trong ví dụ, nó được ghi rõ là giả định minh họa, không phải khuyến nghị chung.

> Dấu hiệu của senior: nêu được chi phí của thiết kế, điều kiện biện minh cho chi phí đó và cách phát hiện khi trade-off không còn phù hợp.

## Junior: nền tảng

**Q1. Microservice là gì và khác monolith thế nào?**

Microservice là một service có thể deploy độc lập, tổ chức quanh một business capability. Service nên sở hữu data của mình và expose một contract rõ ràng. Monolith là một đơn vị deploy chứa nhiều capability. Microservices có thể đem lại khả năng scale độc lập, cô lập lỗi và ownership theo team, nhưng thêm network call, distributed consistency và operational overhead.

```java
@SpringBootApplication
public class OrderService {
    public static void main(String[] args) {
        SpringApplication.run(OrderService.class, args);
    }
}
```

**[ANALYSIS]** Modular monolith thường là điểm bắt đầu tốt hơn. Chỉ tách khi ownership, deployment hoặc scaling độc lập giải quyết một vấn đề đã được chứng minh.

**Q2. Synchronous và asynchronous communication khác nhau thế nào?**

Trong synchronous communication, caller chờ response, thường qua HTTP hoặc RPC. Callee chậm sẽ tiêu tốn resource của caller và tăng coupling. Trong asynchronous communication, producer publish message hoặc event rồi tiếp tục. Cách này giảm temporal coupling nhưng tạo eventual consistency và khiến tracing khó hơn.

```java
// Synchronous: caller cần kết quả.
OrderSummary summary = restClient.get()
    .uri("http://order-service/api/orders/{id}", id)
    .retrieve()
    .body(OrderSummary.class);

// Asynchronous: publish một fact rồi tiếp tục.
kafkaTemplate.send("order.placed", new OrderPlaced(orderId));
```

**[ANALYSIS]** Dùng synchronous khi response là một phần của quyết định mà user đang chờ. Dùng asynchronous cho công việc có thể hoàn thành sau, như notification.

**Q3. API gateway là gì?**

API gateway là entry point có thể route request, authenticate client, áp dụng rate limit và aggregate response. Nó có thể che giấu topology nội bộ và tập trung policy ở edge. Nó không thay thế authorization bên trong từng service.

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

**Q4. Service discovery là gì và vì sao tránh URL của instance được hardcode?**

Instance được tạo, xóa và reschedule. Vì vậy địa chỉ cố định sẽ trở nên lỗi thời. Service discovery ánh xạ logical service name tới các instance hiện có. Cơ chế có thể là registry hoặc platform DNS; thuộc tính quan trọng là caller không phải quản lý việc đặt instance.

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

**Q5. Circuit breaker là gì?**

Circuit breaker ngừng gửi call tới dependency đang lỗi. Khi open, nó fail fast; khi half-open, nó cho phép một số probe để kiểm tra recovery. Nhờ vậy caller không liên tục chờ timeout và thread được bảo vệ. Breaker không sửa dependency; nó giới hạn việc lỗi lan truyền.

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

**Q6. API và event khác nhau thế nào?**

API là yêu cầu một operation và response. Event là bản ghi về việc đã xảy ra. API tạo coupling giữa caller và callee tại thời điểm request; event cho phép nhiều consumer phản ứng độc lập. Không nên dùng event khi producer cần một quyết định nghiệp vụ ngay lập tức.

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

**Q7. Nên dùng REST client nào trong Spring?**

`RestTemplate` là blocking client cũ. `WebClient` phù hợp với reactive pipeline. `RestClient`, có từ Spring Framework 6.1, là fluent client hiện đại cho synchronous call. Hãy chọn theo execution model, không chỉ theo tuổi của project.

```java
var factory = new JdkClientHttpRequestFactory();
factory.setReadTimeout(Duration.ofSeconds(3)); // giả định minh họa

RestClient client = RestClient.builder()
    .baseUrl("http://order-service/api")
    .requestFactory(factory)
    .build();
```

**[ANALYSIS]** Một service blocking thường không được lợi nhiều khi chỉ thêm Reactor cho một outbound call. Dùng `WebClient` khi toàn bộ flow đã reactive.

**Q8. `@RestController` thực sự làm gì?**

Annotation này kết hợp `@Controller` và `@ResponseBody`. Return value được ghi vào HTTP response qua message converter, thường là JSON, thay vì được coi là view name. Nó cũng tham gia vào content negotiation và exception handling.

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

Hãy trả DTO làm contract. Không expose JPA entity làm wire model.

**Q9. Idempotency là gì?**

Một operation là idempotent nếu thực hiện lại vẫn có cùng business effect. Điều này quan trọng vì timeout không chứng minh server đã fail; client có thể retry một request đã commit. Idempotency key cho phép service trả về kết quả đầu tiên thay vì thực hiện lại operation.

```java
public Payment charge(String key, PayRequest request) {
    Payment existing = paymentRepo.findByKey(key);
    if (existing != null) return existing;
    return paymentRepo.save(new Payment(key, request.amount()));
}
```

Lookup và insert cần database uniqueness guarantee hoặc concurrency control tương đương.

**Q10. Client-side load balancing hoạt động thế nào?**

Discovery cung cấp các instance đủ điều kiện; client-side load balancer chọn một instance cho mỗi request. Cách chọn có thể là round-robin, weighted hoặc policy khác. Health check nên loại instance không khỏe khỏi tập ứng viên.

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

**Q11. Nên quản lý configuration thế nào?**

Để các giá trị theo môi trường nằm ngoài business code. Central configuration hoặc cơ chế của platform có thể quản lý URL, timeout và feature flag. Bind chúng vào typed properties để phát hiện configuration sai lúc startup.

```java
@ConfigurationProperties(prefix = "inventory.client")
public record InventoryClientProps(
    String baseUrl,
    Duration connectTimeout,
    Duration readTimeout,
    int maxConnections
) {}
```

**Q12. Message broker là gì và khi nào nên thêm?**

Broker như Kafka hoặc RabbitMQ tách producer khỏi consumer, buffer work và thường hỗ trợ at-least-once delivery. Thêm broker khi có nhu cầu cụ thể như fan-out, buffering hoặc replay. Broker cũng thêm công việc vận hành, delivery semantics và failure mode.

```java
public void publish(Order order) {
    kafka.send("order.placed", order.id().toString(),
        new OrderPlaced(order.id(), order.userId(), order.total()));
}
```

**Q13. Liveness và readiness khác nhau thế nào?**

Liveness hỏi process có nên được restart không. Readiness hỏi process đã nhận traffic được chưa. Process có thể còn sống nhưng chưa ready trong lúc khởi động, draining hoặc mất capability bắt buộc. Hãy expose hai trạng thái riêng, chẳng hạn qua Spring Boot Actuator.

**Q14. Fallback là gì?**

Fallback là response được xác định trước khi dependency unavailable: dữ liệu cache, default, kết quả rỗng hoặc trạng thái degraded rõ ràng. Chỉ dùng fallback khi an toàn về mặt nghiệp vụ. Không được che một payment thất bại bằng một response trông như thành công.

```java
@CircuitBreaker(name = "catalog", fallbackMethod = "staleCatalog")
public CatalogResponse catalog(String category) {
    return catalogClient.fetch(category);
}
```

**Q15. Timeout là gì và vì sao bắt buộc phải có?**

Timeout giới hạn thời gian chờ. Không có timeout, dependency bị treo có thể giữ connection, thread hoặc queue slot vô thời hạn. Hãy đặt connect timeout và read timeout cho mọi outbound call, đồng thời bảo đảm tổng ngân sách phù hợp với SLO của caller.

```java
factory.setConnectTimeout(Duration.ofSeconds(2)); // giả định minh họa
factory.setReadTimeout(Duration.ofSeconds(3));    // giả định minh họa
```

**Q16. Retry là gì và khi nào không nên retry?**

Retry thực hiện lại một operation đã fail, thường với exponential backoff và jitter. Chỉ retry lỗi có khả năng transient và khi việc lặp lại là an toàn. Không retry request `4xx` không hợp lệ hoặc operation non-idempotent nếu chưa có cơ chế idempotency.

```yaml
resilience4j.retry:
  instances:
    inventory:
      maxAttempts: 3 # giả định minh họa: call gốc cộng hai retry
      enableExponentialBackoff: true
      enableRandomizedWait: true
```

**Q17. DTO là gì và giúp ổn định contract thế nào?**

DTO là data shape truyền qua wire. Nó tách public contract khỏi database entity, cho phép đổi storage mà không expose thay đổi schema cho consumer.

```java
public record OrderSummary(Long id, String status,
                           BigDecimal total, OffsetDateTime placedAt) {
    static OrderSummary from(OrderEntity entity) { ... }
}
```

## Mid-level: trade-off và failure mode

**Q18. Vì sao shared database thường là dấu hiệu boundary có vấn đề?**

Nếu hai service đọc và ghi cùng schema, thay đổi schema ở một bên có thể làm hỏng bên kia và mất deployment independence. Hãy ưu tiên private data ownership qua API hoặc event. Nếu bắt buộc share cùng bảng, trước hết cần hỏi hai phần đó có thực sự là một bounded context không.

**Q19. 2PC và Saga khác nhau thế nào?**

Two-phase commit điều phối transaction qua nhiều resource và có thể giữ lock trong lúc coordinator quyết định. Saga dùng local transaction và compensating action. 2PC có atomicity mạnh hơn nhưng đánh đổi availability và operational coupling; Saga chấp nhận eventual consistency.

```java
@Transactional
public void reserve() { inventory.reserve(sku, quantity); }

@Transactional
public void charge() { payment.charge(orderId, amount); }
// Compensation có thể là release(...) hoặc refund(...).
```

**Q20. Implement orchestration Saga thế nào?**

Một coordinator ghi progress, gọi các local operation và chạy compensation khi bước sau fail. Mỗi remote operation cần timeout và contract idempotent. Nếu workflow phải resume sau khi process restart, hãy persist progress.

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

**Q21. Eventual consistency là gì?**

Sau một write, replica và derived view có thể hội tụ sau đó thay vì cùng một thời điểm. User có thể đọc profile cũ hoặc stock view bị stale. Các lựa chọn gồm read-your-writes, đọc source of truth ở critical path và xác định staleness budget rõ ràng.

**[PROPOSED DESIGN]** Staleness window chấp nhận được là quyết định của product. Không trình bày một khoảng thời gian cụ thể như system fact nếu không có requirement hoặc measurement.

**Q22. Vì sao nên dùng idempotent consumer thay vì “exactly once”?**

At-least-once delivery nghĩa là consumer có thể nhận cùng message nhiều lần. Không nên giả định exactly-once end to end qua producer, broker, consumer và side effect. Hãy làm consumer idempotent bằng conditional update, unique key hoặc processed-message record.

```java
@KafkaListener(topics = "payment.confirmed")
public void onPayment(PaymentConfirmed event) {
    int changed = orderRepo.markPaidIfNotAlready(event.orderId());
    if (changed == 1) notifyUser(event);
}
```

**Q23. Outbox pattern là gì?**

Database commit và broker publish là hai operation riêng. Process có thể commit row rồi fail trước khi publish, hoặc publish trước khi row commit. Outbox ghi business row và event record trong cùng local transaction; relay publish các record đang chờ và retry an toàn.

```java
@Transactional
public void placeOrder(Order order) {
    orderRepo.save(order);
    outboxRepo.save(new OutboxEvent("order.placed", serialize(order)));
}
```

**Q24. Vì sao `@Transactional` không chạy xuyên service?**

`@Transactional` của Spring thường bind local transaction vào một data source. HTTP call không tự động mở rộng transaction đó sang service khác. Giữ database transaction mở qua network call còn giữ connection và row lock lâu hơn cần thiết.

```java
// Giữ local transaction ngắn; điều phối remote work riêng.
public void placeOrder(Order order) {
    saveOrderLocal(order);
    payments.charge(order.id(), order.total());
}
```

**Q25. Retry storm là gì?**

Retry storm xảy ra khi nhiều caller retry một dependency đang lỗi cùng lúc, làm tải tăng và outage kéo dài. Dùng retry có giới hạn, exponential backoff, jitter, giới hạn concurrency và circuit breaker. Retry là load multiplier, không phải reliability miễn phí.

**Q26. OpenFeign, `RestClient` và `WebClient` khác nhau thế nào?**

OpenFeign cung cấp typed interface khai báo và phù hợp với dependency ổn định. `RestClient` trực tiếp và synchronous, phù hợp với ít call. `WebClient` phù hợp với reactive pipeline. Khi chọn, hãy so sánh generated behavior, error handling, observability và retry configuration.

```java
@FeignClient(name = "inventory-service")
interface InventoryClient {
    @GetMapping("/api/stock/{sku}")
    InventoryStatus stock(@PathVariable String sku);
}
```

**Q27. Bulkhead isolation là gì?**

Bulkhead giới hạn resource mà một dependency được phép dùng, bằng semaphore hoặc pool riêng. Dependency chậm chỉ làm đầy compartment của nó thay vì lấy hết resource của endpoint không liên quan.

```java
@Bulkhead(name = "inventory", type = Bulkhead.Type.SEMAPHORE)
@CircuitBreaker(name = "inventory")
public InventoryStatus stock(String sku) { ... }
```

**Q28. Trace request xuyên các service thế nào?**

Distributed tracing truyền trace context qua boundary của các service. Mỗi service tạo span cho phần việc có ý nghĩa và ghi trace ID cùng span ID vào log. Spring Boot, Micrometer Tracing và OpenTelemetry có thể cung cấp instrumentation, nhưng propagation và sampling vẫn phải được kiểm chứng.

**Q29. Version API hoặc event thế nào?**

Hãy coi wire format đã publish là contract. Thêm field theo cách backward-compatible, không đổi ý nghĩa field cũ và chỉ xóa field sau khi consumer migrate xong. Với thay đổi không tương thích của HTTP, dùng version rõ ràng hoặc content negotiation policy.

```java
public record OrderSummaryV1(Long id, String status, BigDecimal total) {}
public record OrderSummaryV2(Long id, String status,
                             BigDecimal total, OffsetDateTime placedAt) {}
```

**Q30. Vì sao chatty call là vấn đề?**

Mỗi network hop tuần tự thêm latency và một cơ hội failure. Hãy chạy song song các call độc lập, aggregate ở một service boundary hoặc xây read model. Cần giới hạn parallelism và tổng thời gian chờ; nếu không fan-out chỉ chuyển overload sang chỗ khác.

```java
CompletableFuture<Order> order = supplyAsync(() -> orderClient.get(id), pool);
CompletableFuture<User> user = order.thenCompose(o ->
    supplyAsync(() -> userClient.get(o.userId()), pool));
```

**Q31. Chọn threshold cho circuit breaker thế nào?**

Bắt đầu từ failure rate, slow-call rate, request volume và recovery behavior đã đo được. Window nhỏ có thể phản ứng với noise; window lớn có thể phản ứng quá chậm. Open duration và half-open probe nên được test theo đặc điểm recovery của dependency.

```java
CircuitBreakerConfig config = CircuitBreakerConfig.custom()
    .slidingWindowSize(10) // giả định minh họa
    .failureRateThreshold(50) // giả định minh họa
    .waitDurationInOpenState(Duration.ofSeconds(30)) // giả định minh họa
    .build();
```

**Q32. Service duy trì derived data thế nào?**

Service sở hữu data phát hành domain event. Consumer xây projection riêng, như search index hoặc read model. Projection là eventually consistent nên consumer cần policy cho dữ liệu thiếu hoặc stale.

```java
@KafkaListener(topics = "order.placed", groupId = "search-index")
public void onPlaced(OrderPlaced event) {
    indexService.index(new OrderDoc(event.orderId(), event.total()));
}
```

**Q33. Xử lý secrets thế nào?**

Không commit credential production và không log chúng. Dùng secret manager hoặc platform secret facility, inject lúc runtime, rotate và audit quyền truy cập. Configuration và secret distribution là hai concern riêng, dù cùng một platform có thể cung cấp cả hai.

```yaml
payments:
  base-url: ${PAYMENTS_URL}
  api-key: ${PAYMENTS_API_KEY}
```

**Q34. JSON so với protobuf hoặc Avro?**

JSON được hỗ trợ rộng và dễ inspect. Protobuf và Avro có schema, có thể giảm payload hoặc parsing work tùy data và implementation. Dùng schema-based format khi throughput, compatibility hoặc giới hạn payload được đo lường và biện minh cho tooling. Không khẳng định speedup cố định nếu chưa benchmark message thực tế.

## Senior: thiết kế và bảo vệ lựa chọn

**Q35. Team muốn tách monolith thành 20 service. Bạn nói gì?**

**[ANALYSIS]** Hỏi việc tách giải quyết vấn đề gì. Nếu vấn đề là module chưa rõ hoặc build chậm, trước hết xây modular monolith với boundary được enforce. Chỉ extract service theo bounded context đã được chứng minh có nhu cầu ownership, scaling hoặc deployment khác biệt. Migrate dần, chẳng hạn bằng strangler approach, không rewrite một lần.

**Q36. Thiết kế payment qua Order, Inventory và Payment không dùng 2PC.**

**[PROPOSED DESIGN]** Để Order điều phối một Saga: reserve inventory, charge payment và compensate bằng release nếu charge fail. Persist Saga state và làm reserve, charge, release, refund idempotent. Thứ tự chính xác phụ thuộc business risk; inventory reservation và payment authorization có thể có compensation khác nhau.

**Q37. HTTP dependency flaky. Thiết kế resilience layer thế nào?**

**[PROPOSED DESIGN]** Bắt đầu bằng timeout, sau đó bounded retry với backoff và jitter cho transient failure an toàn, circuit breaker và bulkhead. Chỉ thêm fallback khi dữ liệu stale hoặc degraded vẫn đúng nghĩa nghiệp vụ. Tune từng lớp theo traffic và số liệu dependency, không copy default một cách máy móc.

**Q38. Khi nào monolith là lựa chọn tốt hơn?**

**[ANALYSIS]** Modular monolith thường phù hợp với team nhỏ, product còn sớm hoặc domain không cần scaling độc lập. Enforce boundary bằng architecture test và package rule.

```java
@ArchTest
static final ArchRule orders_are_isolated =
    classes().that().resideInAPackage("..orders..")
        .should().onlyDependOnClassesThat()
        .resideInAnyPackage("..orders..", "..shared..");
```

**Q39. Chọn sync hay async giữa hai service cụ thể thế nào?**

Hỏi caller có cần kết quả để hoàn thành operation hiện tại không và có chấp nhận delay không. Reserve stock thường là synchronous khi confirmation phụ thuộc vào nó. Notification thường là asynchronous vì response của order không cần chờ delivery. Đây là assumption thiết kế và phải khớp product semantics.

**Q40. Bảo vệ service boundary thế nào?**

Boundary hữu ích có lý do thay đổi rõ, team sở hữu, data riêng và deployment cùng scaling độc lập. Một test thực tế là schema change ở A có bắt B deploy không. Nếu có, hãy xem boundary có thật không hay hệ thống đang là distributed monolith.

```java
@KafkaListener(topics = "order.placed", groupId = "billing")
public void on(OrderPlaced event) {
    invoiceService.create(event.orderId(), event.total());
}
```

**Q41. Bảo vệ lựa chọn 2PC hay Saga bằng con số thế nào?**

Không tự tạo số liệu latency hoặc availability. Trước hết hãy nêu business tolerance. Nếu operation cần atomic cross-resource commit và platform hỗ trợ chấp nhận được, 2PC có thể hợp lý. Nếu nghiệp vụ chấp nhận reconcile và compensate, Saga tránh global transaction nhưng phải trả inconsistency window.

**Q42. Service có p99 tail dài. Chẩn đoán thế nào?**

Tách vấn đề thành application pause, lock contention, queueing, downstream latency và retry. Dùng trace, runtime metric, database wait data và request histogram. So sánh p50/p99 cho thấy tail nhưng không tự cho biết nguyên nhân.

```java
@Timed(name = "orders.get", histogram = true,
       percentiles = {0.50, 0.95, 0.99})
public OrderSummary get(Long id) { ... }
```

**Q43. Size outbound thread pool thế nào?**

Bắt đầu từ concurrency, latency, CPU, connection limit và SLO đã đo được. Áp dụng Little's Law cẩn thận: trong hệ thống ổn định, concurrency xấp xỉ throughput nhân latency. Queue phải có giới hạn và overload behavior phải rõ.

```java
new ThreadPoolExecutor(
    50, 200, 60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000), // giả định minh họa
    new ThreadPoolExecutor.CallerRunsPolicy());
```

**Q44. Saga crash giữa chừng thì resume thế nào?**

Persist Saga state và các bước chuyển trạng thái. Khi restart, tìm các instance đang chạy rồi retry bước tiếp theo nếu idempotent hoặc compensate từ state durable cuối cùng. State record không được ghi là hoàn tất trước khi effect của bước đã durable.

```java
@Entity
class SagaInstance {
    @Id String sagaId;
    String status;
    int lastStep;
}
```

**Q45. Đặt SLO xuyên service chain thế nào?**

Bắt đầu từ SLO user nhìn thấy, sau đó phân bổ latency và error budget cho dependency. Nhân các availability figure độc lập chỉ là xấp xỉ; shared failure và retry phá vỡ giả định độc lập. Hãy đo chain thật và chừa budget cho retry, queue và vận hành.

**Q46. Rate-limit và backpressure thế nào?**

Rate-limit ở edge để bảo vệ service và trên outbound call để bảo vệ dependency. Giới hạn queue, từ chối excess work một cách rõ ràng và expose `429` hoặc response overload phù hợp. Backpressure là policy từ chối hoặc trì hoãn work, không chỉ là implementation của queue.

```java
@RateLimiter(name = "payments-outbound", fallbackMethod = "quotaExceeded")
public PaymentResult charge(PaymentRequest request) {
    return paymentsClient.charge(request);
}
```

**Q47. Chứng minh resilience thế nào?**

Inject failure thực tế trong môi trường an toàn: dependency error, delay, broker unavailable và database failure. Assert latency có giới hạn, degradation đúng, retry không tăng mất kiểm soát và recovery hoạt động. Chạy lại sau mỗi thay đổi resilience và so sánh với SLO.

**Q48. Đổi tên field của event có nhiều consumer thế nào?**

Dùng additive migration. Thêm field mới nhưng giữ field cũ, deploy consumer hiểu field mới, rồi chỉ xóa field cũ sau compatibility window và schema check. Schema registry có thể enforce compatibility nhưng không thay thế việc inventory consumer.

**Q49. Xử lý authentication và authorization giữa các service thế nào?**

Dùng một identity domain nhất quán. Gateway hoặc identity provider có thể phát signed token; service tự validate token và enforce authorization cho resource của mình. Local signature validation tránh một network hop bắt buộc, nhưng vẫn phải xử lý key rotation, audience, expiry và claim validation.

```java
Jwt jwt = decoder.decode(extractToken(request));
if (!allowed(request, jwt)) {
    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
    return;
}
```

**Q50. Điều gì có thể làm hệ thống này hỏng trong production?**

Ba rủi ro thường gặp là retry không giới hạn khi thiếu timeout hoặc breaker, shared schema hoặc distributed transaction làm mất service independence, và thiếu observability. Câu trả lời không phải một configuration cố định. Cần bounded call, operation idempotent, local transaction, ownership rõ, tracing, metric và failure test.

```java
// Mọi outbound call cần timeout rõ ràng và được review.
factory.setReadTimeout(Duration.ofSeconds(3)); // giả định minh họa
```

**[SOURCE FACT]** Câu trả lời senior tốt nhất là một thiết kế nêu rõ assumption, đo được behavior và có rollback hoặc compensation path. Microservices chỉ là một lựa chọn; monolith được tổ chức tốt cũng là một lựa chọn.

#### Tự kiểm tra

- [ ] Junior: Tôi giải thích được service boundary, sync và async communication, gateway, discovery, circuit breaker, client, timeout, retry, idempotency và DTO contract.
- [ ] Mid-level: Tôi giải thích được private data, Saga, outbox, local transaction, retry storm, bulkhead, tracing, versioning, projection và backpressure.
- [ ] Senior: Tôi biện minh được việc tách service, đo hoặc định lượng trade-off, thiết kế recovery và nói được khi nào không nên dùng microservices.
