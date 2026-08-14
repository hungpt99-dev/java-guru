---
title: "Ôn thi Java #6: Microservices — Junior đến Senior"
description: "Microservices ở mức senior chủ yếu là biết khi NÀO KHÔNG dùng chúng — resilience pattern, service communication, và distributed transaction."
pubDatetime: 2026-08-10T10:10:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - microservices
  - resilience
---

Microservices là chủ đề nơi khả năng phán đoán của senior quan trọng nhất, vì câu trả lời sai là "chia monolith ra đi". Junior vẽ các ô service; senior giải thích tại sao monolith là quyết định đúng suốt nhiều năm và điều gì cụ thể buộc phải chia. Bài này đi từ service boundary đến cái bẫy distributed-transaction — 50 câu hỏi, mỗi câu trả lời code-first với Spring thật, chọn cấp độ bạn đang phỏng vấn và đọc thêm một cấp trên nó.

> Mindset: junior liệt kê lợi ích microservices; senior gọi được ba cái giá cụ thể chúng tạo ra và trigger chính xác biện minh cho việc trả cái giá đó.

## Junior — nền tảng

**Q1. Microservice là gì và khác monolith thế nào?**
Một microservice là một service nhỏ, deploy độc lập, sở hữu một business capability và data của riêng nó. Monolith là một đơn vị deploy duy nhất phục vụ mọi capability. Microservices mua sự scale độc lập, lỗi cô lập, và team autonomy; chúng trả bằng network call, distributed data, và độ phức tạp vận hành. Hình thức rẻ nhất của một microservice là một Spring Boot app làm đúng một việc:

```java
@SpringBootApplication
public class OrderService {
    public static void main(String[] args) {
        SpringApplication.run(OrderService.class, args);   // một capability, một khối deploy được
    }
}
```

Một khối deploy được nghĩa là một build, một rollout, một rollback. Hai mươi service nghĩa là hai mươi thứ như vậy — cái giá đó chỉ đáng trả khi sự độc lập là thật.

**Q2. Khác nhau giữa synchronous và asynchronous communication là gì?**
Sync (HTTP/RPC): caller block cho tới khi nhận được câu trả lời — coupling chặt, một callee chậm làm thread của bạn đứng hình. Async (events): caller publish rồi đi tiếp — loose coupling và resilience, nhưng eventual consistency và debug khó hơn. Chọn sync khi user đang bị chặn bởi câu trả lời, async cho fire-and-forget side effect:

```java
// Sync — caller chờ
OrderSummary summary = restClient.get()
    .uri("http://order-service/api/orders/{id}", id)
    .retrieve()
    .body(OrderSummary.class);        // block tới khi có response hoặc timeout 3s

// Async — publish và tiếp tục
kafkaTemplate.send("order.placed", new OrderPlaced(orderId));   // không ai chờ
```

Rule of thumb: request happy-path mà user đợi là sync; bất cứ thứ gì chịu được độ trễ là async.

**Q3. API gateway là gì và nó làm gì?**
Một entry point duy nhất để route, xác thực, rate-limit, và thường là aggregate. Nó giấu service topology để client chỉ nói chuyện với một host thay vì hai mươi, và policy cắt ngang (cross-cutting) nằm gọn một chỗ. Spring Cloud Gateway là một proxy reactive; route chỉ là các hàm:

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

Không có nó, client hardcode mọi địa chỉ service, mọi team tự viết lại auth, và không ai rate-limit được gì một cách tập trung.

**Q4. Service discovery là gì và vì sao không thể hardcode URL?**
Instance scale, crash, và bị reschedule; một IP hardcode cũ trong vòng vài phút. Service đăng ký với một registry (Eureka, Consul, K8s DNS) và phân giải nhau theo tên logic. Trong Spring, `@LoadBalanced` biến tên thành một instance thật, chọn theo từng request:

```java
@Bean
@LoadBalanced
public RestClient.Builder loadBalancedRestClientBuilder() {
    return RestClient.builder();               // phân giải lb://ORDER-SERVICE → IP:port của instance
}

// Gọi theo tên service, không phải theo IP:
OrderSummary o = restClient.get().uri("http://ORDER-SERVICE/api/orders/{id}", id)
    .retrieve().body(OrderSummary.class);
```

Hostname hardcode gãy ngay khi một pod reschedule; registry khiến việc scale và restart trở nên vô hình với caller.

**Q5. Circuit breaker là gì và vì sao bạn cần nó?**
Retry ngây thơ vào một dependency đang hấp hối chất đống và cạn thread — một service chết kéo cả chuỗi xuống. Một breaker trip sau N lần lỗi, fail fast trong cooldown, rồi half-open để dò phục hồi:

```java
@CircuitBreaker(name = "inventory", fallbackMethod = "fallback")
public InventoryStatus check(String sku) {
    return restClient.get().uri("http://inventory-service/api/stock/{sku}", sku)
            .retrieve().body(InventoryStatus.class);
}

public InventoryStatus fallback(String sku, Throwable t) {
    return new InventoryStatus(sku, 0, "unavailable");   // degraded, không phải chết
}
```

Nó chứa blast radius: fail fast ngay tại breaker thay vì chờ hết từng timeout.

**Q6. Khác nhau giữa API và event là gì?**
API là một yêu cầu — "làm cái này, trả kết quả cho tôi". Event là một sự thật — "order placed", phát sóng cho bất kỳ ai quan tâm. API couple caller với callee; event decouple producer khỏi consumer. Cùng một hành động nghiệp vụ được thể hiện cả hai cách:

```java
@RestController
class OrderController {
    @PostMapping("/api/orders")                       // API: yêu cầu mệnh lệnh
    public Order create(@RequestBody CreateOrder cmd) { ... }
}

@Component
class OrderEvents {
    @KafkaListener(topics = "order.placed")           // Event: sự thật phát sóng
    public void onOrderPlaced(OrderPlaced e) { ... }
}
```

Nhầm lẫn hai thứ này sinh ra đồ thị synchronous chatty, giòn nơi mà event sẽ sạch hơn nhiều.

**Q7. Viết REST client trong Spring thế nào và chọn cái nào?**
Ba thời đại: `RestTemplate` (blocking, legacy, không khuyến khích), `WebClient` (reactive, kéo theo Reactor), và `RestClient` (Spring 6.1+) — client synchronous hiện đại với cùng fluent API. Cho 95% service request/response, `RestClient`:

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

Chọn `RestClient` cho sync, `WebClient` chỉ khi bạn đã reactive từ đầu đến cuối — trộn Reactor vào một service blocking chỉ mua thêm độ phức tạp.

**Q8. `@RestController` thực sự làm gì?**
Nó là `@Controller` + `@ResponseBody`: giá trị trả về được serialize thẳng vào HTTP body (JSON qua Jackson) thay vì được phân giải thành tên view. Nó cũng nối message conversion, exception handling, và content negotiation:

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {
    @GetMapping("/{id}")
    public ResponseEntity<OrderSummary> get(@PathVariable Long id) {
        return ResponseEntity.ok()
            .header("Cache-Control", "max-age=5")
            .body(orderService.getSummary(id));     // serialize thành JSON, không bao giờ là view
    }
}
```

Một service, một REST contract có giới hạn — shape của response CHÍNH LÀ contract, nên hãy trả DTO, không bao giờ trả JPA entity.

**Q9. Idempotency là gì và vì sao services quan tâm?**
Một phép toán idempotent nếu làm hai lần có cùng tác dụng như làm một lần. Service phải như vậy, vì network giao duplicates: một client timeout lúc 3 s, retry, và request đầu thực ra đã thành công. Không có idempotency bạn tính phí hai lần:

```java
@PostMapping("/api/payments")
public Payment create(@RequestBody @Valid PayRequest req,
                      @RequestHeader("Idempotency-Key") String key) {
    return paymentService.charge(key, req);   // key → cùng payment khi replay
}

public Payment charge(String key, PayRequest req) {
    Payment existing = paymentRepo.findByKey(key);
    if (existing != null) return existing;    // replay: trả về kết quả đầu tiên
    return paymentRepo.save(new Payment(key, req.amount()));
}
```

Idempotency key là bảo hiểm rẻ; thay thế nó là một khoản thanh toán trùng mà bạn phải đi giải thích với khách hàng.

**Q10. Client-side load balancing hoạt động thế nào?**
Discovery cho bạn mọi instance khỏe mạnh; load balancer chọn một cái cho mỗi request — round-robin theo mặc định, weighted khi instance khác nhau, sticky chỉ khi bắt buộc. Spring Cloud LoadBalancer chạy ngay trong caller, nên không có hop thừa:

```java
@Bean
public ServiceInstanceListSupplier instanceSupplier(ConfigurableApplicationContext ctx) {
    return ServiceInstanceListSupplier.builder()
        .withDiscoveryClient()      // instance từ Eureka/Consul
        .withHealthChecks()         // bỏ qua instance trượt health check
        .build(ctx);
}
```

Cân bằng phía client là thứ cho phép 200 thread trải đều qua 5 instance thay vì đập vào một, và nó định tuyến lại ngay khi một instance chết.

**Q11. Quản lý configuration xuyên các service thế nào?**
Mọi service cần config theo môi trường — URL, timeout, feature flag. `application.yml` theo profile trôi dạt ngay khi bạn có ba môi trường. Tập trung với Spring Cloud Config hoặc secrets store, và bind config vào typed properties thay vì `@Value` rải rác:

```java
@ConfigurationProperties(prefix = "inventory.client")
public record InventoryClientProps(
    String baseUrl,               // http://inventory-service
    Duration connectTimeout,      // 2s
    Duration readTimeout,         // 3s
    int maxConnections            // 200
) {}
```

Config có kiểu fail lúc startup, không phải lúc runtime: một typo trong `readTimeout` thành một lần deploy hỏng, không phải một outage 3 giờ.

**Q12. Message broker là gì và khi nào nên đưa vào?**
Broker (Kafka, RabbitMQ) decouple producer khỏi consumer, đệm các cú burst, và cho at-least-once delivery. Đưa nó vào khi bạn cần fan-out, buffering, hoặc replay — không phải vì "events nghe hay". Một producer trong Kafka chỉ bốn dòng:

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

Một broker xử lý 100k+ msg/s mỗi bộ partition nơi mà fan-out synchronous tới 5 service sẽ sụp dưới latency và partial failure.

**Q13. Health checks là gì và vì sao readiness vs liveness quan trọng?**
Liveness: process còn sống không — không thì giết và restart. Readiness: nó sẵn sàng nhận traffic chưa — không thì kéo ra khỏi load balancer. Spring Boot actuator phơi cả hai:

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

Config: liveness tại `/actuator/health/liveness`, readiness tại `/actuator/health/readiness`. Một process sống nhưng chưa sẵn sàng không được nhận traffic — sự phân biệt đó chính là thứ ngăn rolling deploy nuốt chửng request.

**Q14. Fallback là gì và làm sao degrade một cách duyên dáng?**
Fallback trả về thứ gì đó hữu ích khi dependency fail — một giá trị cache, một default, một danh sách rỗng — để user nhận degraded-but-working thay vì một cái 500:

```java
@Cacheable("catalog")
public CatalogResponse getCatalog(String category) { ... }

@CircuitBreaker(name = "catalog", fallbackMethod = "cachedCatalog")
public CatalogResponse catalogOrStale(String category) {
    try { return getCatalog(category); }
    catch (Exception e) { return staleCatalog(category); }   // last known good
}
```

Không có fallback, một dependency chập chờn biến p99 của bạn từ 80 ms thành các timeout 3 s và một đống 500s; có nó, p99 giảm về ~100 ms phục vụ từ cache cũ.

**Q15. Timeout là gì và điều gì xảy ra nếu bạn không bao giờ đặt?**
Timeout chặn một call có thể kéo dài bao lâu; không có nó, một dependency treo giữ thread của bạn vĩnh viễn. Với 200 thread, một callee không bao giờ trả lời gục cả service trong vài phút — mọi thread đỗ trong một read không bao giờ trả về:

```java
var requestFactory = new JdkClientHttpRequestFactory();
requestFactory.setConnectTimeout(Duration.ofSeconds(2));
requestFactory.setReadTimeout(Duration.ofSeconds(3));     // câu trả lời phải đến trong 3s

RestClient client = RestClient.builder()
    .baseUrl("http://inventory-service")
    .requestFactory(requestFactory)
    .build();
```

Rule: mọi outbound call có timeout, và nó ngắn hơn SLA của chính bạn — lỗi hiện ra ở giây thứ 3 như một lỗi hữu hình, có giới hạn, debug được, thay vì một cú treo vô hình.

**Q16. Retry là gì và khi nào KHÔNG nên retry?**
Retry thực thi lại một call đã fail, thường có backoff. Retry lỗi transient (connection reset, 503) — không bao giờ retry 4xx (request của bạn sai; retry không sửa được) và không bao giờ retry call không idempotent (bạn tạo duplicate):

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
      maxAttempts: 3 # lần gốc + 2 retry
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

Con số: failure rate 5% với 3 lần thử hạ lỗi user thấy được xuống ~0,0125%; retry 4xx sẽ cho bạn một dãy 400s và một client vô cùng bối rối.

**Q17. DTO là gì và làm sao giữ service contract ổn định?**
DTO là shape đi qua wire của API — tách khỏi database entity để bạn đổi storage không làm vỡ consumer, và version nó không cần migrate code của họ. Phơi một JPA entity rò rỉ schema của bạn vào mọi consumer:

```java
// SAI: entity trên wire — mọi đổi cột làm vỡ consumer
public OrderEntity getEntity(Long id) { return orderRepo.findById(id).orElseThrow(); }

// ĐÚNG: DTO tường minh = contract
public record OrderSummary(Long id, String status, BigDecimal total,
                           OffsetDateTime placedAt) {
    public static OrderSummary from(OrderEntity e) { ... }
}
```

Contract-first: DTO là interface; consumer phụ thuộc vào nó, không bao giờ phụ thuộc vào bảng của bạn.

## Mid — đánh đổi & cạm bẫy

**Q18. Database-per-service — vì sao shared DB là anti-pattern?**
Khi hai service query cùng một schema bạn có một distributed monolith với hop thừa: một đổi schema ở A làm vỡ query của B, transaction vắt ngang service, và không gì scale độc lập. Cách sửa là data riêng mỗi service, chỉ phơi qua API và event:

```java
// SAI: OrderService chui vào schema của inventory
@Repository
public interface OrderRepo extends JpaRepository<OrderEntity, Long> {
    @Query(value = "SELECT stock FROM inventory.sku WHERE sku = :sku", nativeQuery = true)
    int stockOnHand(@Param("sku") String sku);   // coupling hai schema vĩnh viễn
}

// ĐÚNG: hỏi InventoryService qua network
InventoryStatus s = inventoryClient.stockOf(sku);
```

Tín hiệu: nếu hai service phải share một bảng, chúng là một bounded context giả vờ thành hai — hãy merge.

**Q19. Distributed transaction xuyên hai service — 2PC hay Saga?**
2PC (two-phase commit qua JTA) khóa resource ở cả hai database trong khi coordinator quyết định — nó không scale và fail tệ dưới partial failure: một coordinator chết để mọi người kẹt trên lock hàng phút. Saga thay global lock bằng local transaction cộng compensating action:

```java
// SAI: distributed lock — một coordinator, hai DB, cả hai bị khóa suốt quyết định
@Transactional
public void pay() {
    orderDb.updateStatus(id, "PAID");      // lock giữ ở DB A ...
    paymentDb.charge(id, amount);          // ... trong khi DB B quyết định — hàng phút dưới lỗi
}

// ĐÚNG: saga — local txn, compensation khi fail
@Transactional
public void reserve() { inventoryDb.reserve(sku, qty); }      // + compensate: release()
@Transactional
public void charge()  { paymentDb.charge(id, amount); }       // + compensate: refund()
```

2PC đánh đổi availability lấy atomicity và chẳng được cái nào trong thế giới phân tán; Saga chấp nhận eventual consistency và giữ hệ thống available. Đánh đổi đó là toàn bộ câu chuyện của distributed transaction.

**Q20. Implement một orchestration saga cho order → inventory → payment.**
Orchestration saga có một coordinator (OrderService) lái các bước và chạy compensating action khi fail. Mỗi bước là một `@Transactional` local; coordinator bắt lỗi và đi lùi:

```java
public class OrderSaga {
    private final InventoryClient inventory;
    private final PaymentClient payments;

    public OrderResult place(Order order) {
        try {
            inventory.reserve(order.sku(), order.qty());      // bước 1 (timeout 3s)
            try {
                payments.charge(order.id(), order.total());   // bước 2 (timeout 3s)
            } catch (Exception e) {
                inventory.release(order.sku(), order.qty());  // compensate bước 1
                throw e;
            }
            return new OrderResult(order.id(), "CONFIRMED");
        } catch (Exception e) {
            return new OrderResult(order.id(), "FAILED");     // không trạng thái một phần nào sống sót
        }
    }
}
```

Mỗi call downstream có timeout 3 s; saga fail fast và compensate thay vì giữ lock. Orchestration thắng choreography ở đây vì flow có thứ tự rõ và một chủ sở hữu — choreography không đọc nổi quá ba bước.

**Q21. Eventual consistency là gì và điều gì vỡ cho user?**
Sau một write, replica và derived data hội tụ theo thời gian, không atomic. Điều vỡ: user sửa profile, refresh, và thấy bản cũ; một replica phục vụ stock count cũ và user đặt quá tay. Các cách giảm nhẹ — read-your-writes và phục vụ giá trị vừa ghi:

```java
@PostMapping("/api/users/{id}/profile")
public UserProfile update(@PathVariable Long id, @RequestBody ProfileDto dto) {
    userService.save(id, dto);
    // read-your-writes: trả về giá trị vừa ghi, từ source of truth
    return new UserProfile(id, dto.displayName(), "updated");
}
```

Hệ thống eventual consistent phải quyết định ngân sách stale của mình: đọc 1 s, ghi 5 s, báo cáo 5 phút — mỗi cái là một quyết định sản phẩm, không phải một sự cố tình cờ.

**Q22. Idempotency vs exactly-once — vì sao exactly-once là một lời nói dối?**
Delivery là at-least-once: một retry có thể giao cùng một message hai lần. Exactly-once thật sự end-to-end (producer, broker, và consumer) không đạt được trong thực tế. Nên bạn xây consumer idempotent và dedupe ở biên — cùng tác dụng như exactly-once, bền bỉ hơn nhiều:

```java
@KafkaListener(topics = "payment.confirmed")
public void onPayment(PaymentConfirmed e) {
    int updated = orderRepo.markPaidIfNotAlready(e.orderId());
    // UPDATE orders SET status='PAID' WHERE id=? AND status != 'PAID'
    if (updated == 1) { notifyUser(e); }   // side effect chỉ ở lần giao đầu tiên
}
```

Con số: một retry storm 3× trên stream 1k msg/s nghĩa là 2k duplicate cần hấp thụ; một conditional update hoặc unique constraint nuốt chúng, một insert ngây thơ thì không.

**Q23. Outbox pattern là gì và khi nào bạn cần nó?**
Vấn đề dual-write: commit dòng DB và gửi Kafka, và một trong hai có thể fail — một event mất, hoặc một event không có dòng. Outbox biến DB thành source of truth: ghi event trong cùng local transaction, rồi một relay publish nó:

```java
@Transactional
public void placeOrder(Order o) {
    orderRepo.save(o);
    outboxRepo.save(new OutboxEvent("order.placed", objectMapper.writeValueAsBytes(o)));
    // cùng local txn — hoặc cả hai xảy ra, hoặc không cái nào
}

@Component
public class OutboxRelay {
    @Scheduled(fixedDelay = 200)
    public void publish() {
        for (OutboxEvent e : outboxRepo.findTop100ByPublishedFalse()) {
            kafka.send(e.topic(), e.payload());   // retry cho tới khi được ack
            e.published(true);
        }
    }
}
```

Cái giá: ~200 ms–1 s latency thêm và một relay phải vận hành. Lợi ích: không event nào mất, không bug dual-write — pattern quan trọng nhất trong event-driven services.

**Q24. Vì sao `@Transactional` không hoạt động xuyên hai service?**
`@Transactional` là một DB transaction local gắn với một datasource và một thread. Nó không thể vắt ngang một HTTP call — proxy chỉ commit hoặc rollback connection local. Tệ hơn: giữ một DB transaction mở xuyên một network call 3 s khóa chặt một connection và các dòng:

```java
// SAI: txn giữ xuyên network — connection + row lock suốt HTTP call
@Transactional
public void placeOrder(Order o) {
    orderRepo.save(o);
    payments.charge(o.id(), o.total());        // network call 3s BÊN TRONG txn
    inventory.reserve(o.sku(), o.qty());       // thêm một cái nữa — lock giữ 6s+
}

// ĐÚNG: chỉ txn local, network call ở ngoài, saga/compensation lo phần còn lại
public void placeOrder(Order o) {
    saveOrderLocal(o);                          // txn riêng, commit nhanh
    try { payments.charge(o.id(), o.total()); }
    catch (Exception e) { markOrderFailed(o.id()); }
}
```

Một cửa sổ khóa 6 s với 200 đơn hàng đồng thời là 1.200 lock-giây tranh chấp; giữ transaction local và ngắn, để saga lo phần orchestration.

**Q25. Retry storm là gì và retry khuếch đại outage thế nào?**
Mọi người retry cùng lúc: dependency fail, và 100 client × 3 retry = 400 request đập vào một service vốn đã hấp hối — một lỗi chập chờn 5% thành một DDoS tự gây. Cách sửa: exponential backoff có jitter để retry dãn ra, một giới hạn toàn cục, và một circuit breaker để dòng stream ngừng hẳn:

```java
// SAI: retry tức thì đồng bộ — 200 thread × 3 retry ngay lập tức = 600 rps đập
@Retry(name = "inventory", maxAttempts = 3)      // không backoff — thundering herd

// ĐÚNG: backoff + jitter + breaker để retry dãn ra, rồi dừng
```

```yaml
resilience4j.retry:
  instances:
    inventory:
      maxAttempts: 3
      waitDuration: 100ms
      exponentialBackoffMultiplier: 2.0
      enableExponentialBackoff: true
      enableRandomizedWait: true # jitter: 100ms ± 50% — đàn bò thành mưa phùn
resilience4j.circuitbreaker:
  instances:
    inventory:
      slidingWindowSize: 10
      failureRateThreshold: 50 # >50% của 10 call fail → mở
```

Không có jitter, 200 thread retry khép chân khép tay và breaker không bao giờ có cửa sổ yên tĩnh để dò phục hồi; có nó, service hấp hối thấy một dòng nhỏ giọt và half-open sạch sẽ.

**Q26. OpenFeign vs RestClient vs WebClient — dùng cái nào khi nào?**
Feign cho bạn một interface có kiểu — contract là một Java type, retry và decoding miễn phí. RestClient là lựa chọn synchronous nhẹ cho các call ad-hoc. WebClient dành cho reactive stack. Chọn Feign khi một service là dependency chính thức với contract ổn định:

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

Cái giá của Feign: một dynamic proxy sinh ra cho mỗi interface và một lớp phép màu. Cho một call đơn lẻ tới service nội bộ, RestClient trung thực và debug được; tôi mặc định RestClient và dùng Feign từ 3+ endpoint.

**Q27. Bulkhead isolation là gì và cấu hình nó thế nào?**
Bulkhead giới hạn một dependency có thể tiêu thụ bao nhiêu resource của bạn — thread pool hoặc semaphore riêng — để một dependency treo chỉ đầy ngăn của nó, không phải pool dùng chung phục vụ mọi thứ khác. Không có nó, một callee chậm bỏ đói cả service:

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
      maxConcurrentCalls: 20 # chỉ 20 thread được chờ inventory
      maxWaitDuration: 500ms # cái thứ 21 fail fast thay vì xếp hàng
    payments:
      maxConcurrentCalls: 30
```

Con số: một pool chung 200 thread với một dependency timeout 3 s ở 200 rps cạn sạch trong ~1 s; tách 20/30/50 với 100 dự phòng, payments có thể treo mà orders vẫn được phục vụ.

**Q28. Trace một request xuyên 8 service thế nào?**
Distributed tracing lan truyền một trace ID qua mọi chặng, nên bạn thấy cả waterfall và thời gian đi đâu. Spring Boot 3 + Micrometer Tracing + OpenTelemetry nối điều này tự động; cùng trace ID đáp xuống mọi dòng log:

```java
@Configuration
public class TraceConfig {
    @Bean
    public ObservationRegistryCustomizer<ObservationRegistry> customizer() {
        return registry -> registry.observationConfig()
            .observationHandler(new LoggingObservationHandler());  // traceId/spanId trong log
    }
}
```

```yaml
management:
  tracing:
    sampling:
      probability: 0.1 # lấy mẫu 10% ở 10k rps = 1k trace — quá đủ
  zipkin:
    tracing:
      endpoint: http://tracing:9411/api/v2/spans
```

Không có tracing bạn mù — log của mỗi service là một puzzle riêng không có đường nối. Chi phí là microsecond mỗi call; phần thưởng là tìm ra timeout 3 s chôn trong service thứ 6 thay vì đoán mò.

**Q29. Version một API hoặc event thế nào mà không làm vỡ consumer?**
Mọi contract đã publish sẽ tiến hóa; consumer không được vỡ khi nó đổi. Version wire format, không phải code: `v1/orders` tiếp tục phục vụ client cũ trong khi `v2` lên sóng; với event, thêm field không xóa field cũ (JSON tương thích hai chiều):

```java
// v1 của DTO đóng băng; v2 thêm một field mà payload cũ đơn giản là không có
public record OrderSummaryV1(Long id, String status, BigDecimal total) {}

public record OrderSummaryV2(Long id, String status, BigDecimal total,
                             OffsetDateTime placedAt) {}

@GetMapping(value = "/api/orders/{id}", headers = "Accept-version=v1")
public OrderSummaryV1 getV1(@PathVariable Long id) { return toV1(service.get(id)); }

@GetMapping(value = "/api/orders/{id}", headers = "Accept-version=v2")
public OrderSummaryV2 getV2(@PathVariable Long id) { return toV2(service.get(id)); }
```

Con số thật: làm vỡ contract mà không version hạ ~30% consumer qua một đêm; version tốn vài DTO thừa và trả về zero breakage.

**Q30. Chatty calls — vì sao 8 HTTP call tuần tự là vấn đề?**
Mỗi hop thêm latency và chúng chồng lên: 8 call tuần tự × 50 ms = tối thiểu 400 ms, và hành vi tail p99 làm con số thật tệ hơn. Các call độc lập chạy song song; các call phụ thuộc được gộp phía server:

```java
// SAI: 8 round-trip tuần tự — 8 × 50ms = 400ms latency nối tiếp
Order o = orderClient.get(id);
User u = userClient.get(o.userId());
Address a = addressClient.get(o.shippingAddressId());
// ... năm cái nữa, hết cái này đến cái kia

// ĐÚNG: fan-out song song, giới hạn bởi call chậm nhất
CompletableFuture<Order> of = supplyAsync(() -> orderClient.get(id), pool);
CompletableFuture<User> uf = of.thenCompose(o ->
    supplyAsync(() -> userClient.get(o.userId()), pool));
CompletableFuture.allOf(of, uf).join(3, TimeUnit.SECONDS);   // chờ tối đa 3s
```

Fan-out song song 8 call hạ p99 từ ~1,2 s xuống ~200 ms; mỗi hop tuần tự bạn song song hóa được là latency trả về miễn phí.

**Q31. Chọn circuit breaker threshold thế nào — và chuyện gì xảy ra khi tune sai?**
Quá nhạy: một cửa sổ 10 call trip chỉ vì một timeout 3 s và bạn fail fast trong khi dependency vẫn ổn. Quá lơi: breaker không bao giờ trip và bạn cứ xếp hàng trên một dependency chết. Tune từ số thật — failure rate, slow-call threshold, cooldown:

```java
CircuitBreakerConfig cfg = CircuitBreakerConfig.custom()
    .slidingWindow(10, 10, COUNT_BASED)            // quyết định trên 10 call gần nhất
    .failureRateThreshold(50)                      // trip khi >50% fail
    .slowCallDurationThreshold(Duration.ofSeconds(3))   // một call 3s tính là failure
    .slowCallRateThreshold(60)
    .permittedNumberOfCallsInHalfOpenState(3)      // dò bằng 3 call trước khi đóng
    .waitDurationInOpenState(Duration.ofSeconds(30))   // mở 30s, rồi half-open
    .build();
```

Ở p99 80 ms với ngưỡng 3 s, slow-call rate trên 60% thật sự nghĩa là dependency đang bệnh; cooldown 30 s cho nó thở, và 3 probe half-open xác minh phục hồi trước khi full traffic quay lại.

**Q32. Các service giữ derived/denormalized data nhất quán thế nào?**
Khi service A sở hữu source of truth và service B phục vụ một read model (search index, order list), B phản ứng với event của A và xây projection riêng. Cách thay thế — query A synchronous mỗi request — trói latency và availability của B vào A:

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

Cái giá: projection trễ source khoảng ~100 ms–1 s và consumer phải chấp nhận stale. Lợi ích: read local, nhanh, và available ngay cả khi source service chết.

**Q33. Xử lý secrets và environment configuration thế nào?**
Secrets trong `application.yml` hoặc env file đã commit là một vụ lộ chờ một log leak. Credential production sống trong một vault (HashiCorp Vault, AWS Secrets Manager, K8s Secrets); app lấy chúng lúc deploy và không bao giờ log chúng:

```java
@ConfigurationProperties(prefix = "payments")
public record PaymentProps(String apiKey, String baseUrl) {}
```

```yaml
# application.yml — không có secrets
payments:
  base-url: ${PAYMENTS_URL:http://payments:8080}
  api-key: ${PAYMENTS_API_KEY} # được inject từ vault lúc deploy
```

Key rotation, override theo env, và audit đều thuộc về vault. Một key lộ tốn một incident; một vault tốn một config change.

**Q34. JSON vs binary serialization (protobuf/Avro) giữa các service — tradeoff là gì?**
JSON debug được và phổ dụng; protobuf/Avro có schema, nhỏ hơn ~5–10× và parse nhanh hơn, và cho schema evolution qua một registry. Cho stream high-throughput nội bộ, binary format tự trả phí; cho public API, JSON thắng ở developer experience:

```java
// JSON: đọc được, linh hoạt — payload ~120 bytes, parse ~1-2 µs
record OrderEvent(Long id, String sku, int qty) {}

// Protobuf: có schema, gọn — payload ~30 bytes, parse ~200 ns
message OrderEvent {
  int64 id = 1;
  string sku = 2;
  int32 qty = 3;
}
```

Con số: ở 50k events/s riêng khác biệt parse-time là ~50–90 ms CPU mỗi giây, và khác biệt wire-size cộng dồn trên consumer bị giới hạn bởi network. Bắt đầu với JSON; chuyển sang binary có schema khi volume hoặc schema evolution làm đau.

## Senior — thiết kế & bảo vệ

**Q35. Một team muốn chia monolith 3 năm tuổi thành 20 microservice. Bạn nói gì?**
"Tôi sẽ push back mạnh và hỏi vấn đề mà việc chia giải quyết là gì. Nếu nỗi đau là module boundary lộn xộn hoặc một deployment pipeline chậm, cách sửa là modular monolith — cùng codebase, package boundary nghiêm ngặt — không phải 20 service. Tôi chỉ chia dọc theo một bounded context _đã chứng minh_ có nhu cầu scaling hoặc team-ownership khác biệt, incremental qua strangler fig, không bao giờ big-bang:"

```java
// Modular monolith trước: dependency rule nghiêm ngặt, một khối deploy được
module com.shop.orders {
    exports com.shop.orders.api;
    requires com.shop.shared.kernel;   // orders KHÔNG ĐƯỢC import internals của inventory
}
```

"Mỗi service trong 20 nghĩa là build, deploy, rollback, on-call rotation, và failure mode riêng. Nếu hai service không deploy hoặc scale độc lập, bạn trả thuế microservice mà chẳng được gì — đó là lập luận thắng phỏng vấn."

**Q36. Thiết kế payment flow qua Order, Inventory, và Payment service không dùng 2PC.**
"Một orchestration saga với OrderService làm coordinator. Các bước: reserve inventory (local txn + compensation `release`), rồi charge payment (local txn + compensation `refund`). Nếu payment fail, coordinator kích hoạt `release`. Một saga log ghi mỗi bước để một crash resume saga thay vì thực thi lại nó:"

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
                inventory.release(o.sku(), o.qty());             // undo bước 1
                return OrderResult.failed(o.id());
            }
        } finally {
            log.record(sagaId, "complete");
        }
    }
}
```

"Mỗi bước fail fast ở 3 s; worst case ~6 s, không global lock, và log trả lời 'saga này chết ở đâu?' sau một crash."

**Q37. Một downstream HTTP call flaky (5% timeout ở 3 s). Thiết kế resilience layer.**
"Bốn lớp, theo thứ tự: **timeout** (3 s, ngắn hơn SLA của tôi), **retry** với exponential backoff + jitter (3 lần, chỉ idempotent), **circuit breaker** (mở sau 50% lỗi trong cửa sổ 10 call, cooldown 30 s), và **bulkhead** (tối đa 20 call đồng thời tới dependency này). Cộng một fallback tới giá trị cache để user thấy degraded-but-working:"

```java
@Bean
public Resilience4JCircuitBreakerFactory cbFactory() {
    var cfg = new Resilience4JConfigBuilder("inventory")
        .timeLimiterConfig(TimeLimiterConfig.custom()
            .timeoutDuration(Duration.ofSeconds(3)).build())        // fail ở 3s
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
            .maxConcurrentCalls(20).build())                       // ngăn riêng của nó
        .build();
    var factory = new Resilience4JCircuitBreakerFactory();
    factory.configureDefault(cbFactory, cfg);
    return factory;
}
```

"Với 5% timeout, 3 lần thử hạ lỗi user thấy được xuống ~0,0125%; breaker giới hạn thiệt hại trong một outage thật ở 20 call đồng thời thay vì 200; p99 vẫn trong ngân sách vì không gì chờ quá 3 s."

**Q38. Khi nào monolith thực sự là lựa chọn tốt hơn, và giữ nó sạch thế nào?**
"Cho một team nhỏ, một sản phẩm trẻ, hoặc một domain không có nhu cầu scale độc lập, modular monolith nhanh build, debug, deploy hơn — không có distributed failure mode nào cả. Giữ nó sạch bằng module boundary tường minh được ép buộc bởi test, không phải cảm hứng:"

```java
@ArchTest
static final ArchRule modules_must_not_depend_on_each_other =
    classes().that().resideInAPackage("..orders..")
        .should().onlyDependOnClassesThat()
        .resideInAnyPackage("..orders..", "..shared..");
```

"ArchUnit làm build fail khi `orders` import internals của `inventory`, nên boundary thật sự đứng vững cho tới khi một lý do đã chứng minh để chia xuất hiện. Migrate sang service chỉ khi nhu cầu scaling hoặc team-ownership của một boundary thật sự phân kỳ; premature splitting là sai lầm đắt nhất trong lĩnh vực này."

**Q39. Chọn sync vs async giữa hai service cụ thể thế nào?**
"Hỏi hai câu: caller có bị chặn bởi câu trả lời này không, và hệ thống có chịu được độ trễ không? Order→Inventory 'reserve stock' — sync: user đang chờ xác nhận và một timeout là lỗi rõ ràng, hiện được. Order→Notification — async: không ai chặn nó, và tôi muốn nó sống sót khi notifier chết:"

```java
// Order → Inventory: sync — user đang chờ, timeout 3s = lỗi hiện được
InventoryStatus s = inventoryClient.reserve(req);

// Order → Notification: async — decouple, sống sót qua outage
orderEvents.publish(new OrderPlaced(o));    // broker đệm, retry sau
```

"Trộn chúng sai — sync-call năm service nối tiếp — tạo một chuỗi latency gãy theo tốc độ của link chậm nhất, và mỗi cái dính một retry storm khi link yếu nhất chết."

**Q40. Phòng thủ service boundary — làm sao biết một lần chia là đúng?**
"Một boundary đúng là một bounded context: một lý do để thay đổi, một team sở hữu, deploy và scale một mình được, data riêng. Test: 'Nếu tôi đổi schema của service A, B có phải redeploy không?' Nếu có, chúng là một context giả vờ thành hai. Bằng chứng là operational — tần suất deploy độc lập và failure isolation:"

```java
// Orders context publish sự thật; Billing tiêu thụ — không shared code, không shared schema
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

"Boundary được kiểm chứng bằng deploy/scale/failure independence, không phải bằng vẽ ô. Nếu A và B luôn ship cùng nhau và share schema, tôi đã xây một distributed monolith và nên merge chúng."

**Q41. 2PC vs Saga — bảo vệ lựa chọn bằng con số.**
"2PC giữ một global lock: ở 1k orders/phút, một coordinator crash ở pha prepare chặn transaction hàng phút — availability chết, không chỉ latency. Saga giữ mỗi bước là một local transaction ngắn: p50 ~10 ms, p99 ~200 ms, với vài giây đến vài phút bất nhất mà compensation đóng lại:"

```java
// 2PC: atomic nhưng giòn — coordinator crash = lock bị chặn = hàng phút mất availability
// Saga: không global lock, eventual consistency, compensation đóng khoảng trống
public void shipAndBill(Shipment s) {
    try {
        inventory.ship(s);                    // local txn, ~10ms
        billing.invoice(s);                   // local txn, ~10ms
    } catch (Exception e) {
        inventory.unship(s);                  // compensate — đóng khoảng trống
    }
}
```

"Nếu nghiệp vụ chấp nhận một cửa sổ đối soát 5 phút, Saga cho bạn p99 < 200 ms và 99,99% availability; 2PC cho bạn atomicity mà không ai thực sự quan sát được và bắt p99 của bạn làm con tin. Hệ thống thật chọn Saga và audit sau."

**Q42. p99 của một service gấp 5 lần p50. Dẫn chẩn đoán.**
"p50 80 ms, p99 1,2 s nghĩa là một phân bố đuôi. Ba nghi phạm theo thứ tự: GC pause (một full GC 1 s hiện ra như một vách đá), lock contention, và downstream timeout/retry. Tracing cho biết cái nào; percentile cho biết hình dạng:"

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

"Nếu vách đá p99 trùng với một full GC trên đồ thị heap, là JVM; nếu trùng với timeout 3 s downstream, là config retry/breaker; nếu rải rác, thường là lock contention. Tôi sửa cái sở hữu lát lớn nhất của cái đuôi — đo được, không phải đoán."

**Q43. Size outbound thread pool thế nào — và chuyện gì xảy ra khi size sai?**
"Little's Law: để duy trì N request đồng thời với latency L bạn cần pool ≥ N. Với pool 200 và timeout 3 s downstream, service gánh tối đa ~200 in-flight call đồng thời — nếu cả 200 thread đỗ trên một timeout 3 s, throughput sụp còn ~66 rps. Size từ concurrency đo được, chặn queue, fail fast ở biên:"

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    50,                       // core
    200,                      // max — 200 outbound call đồng thời, mãi mãi
    60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),            // queue có giới hạn
    new ThreadPoolExecutor.CallerRunsPolicy()  // backpressure, không drop thầm lặng
);
```

"Thiếu: queue phình và latency vượt SLA. Thừa: mỗi thread tốn ~1 MB stack cộng overhead context-switch. Con số đến từ concurrency đo được × headroom, không phải cảm hứng — và queue phải có giới hạn để overload hiện ra, không bị hấp thụ cho tới OOM."

**Q44. Một saga crash ở bước 3 của 5. Làm nó resumable thế nào?**
"Một saga trong bộ nhớ chết cùng process, để lại các bước áp dụng dở. Persist saga state: mỗi chuyển bước ghi vào saga table trong cùng local transaction với effect của bước. Khi restart, quét các saga in-progress và tiếp tục hoặc compensate từ bước cuối đã ghi:"

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

"Effect của mỗi bước được ghi cùng entry saga-log của nó trong một transaction, nên log luôn trung thực. Recovery chạy trong 30 s sau restart; cái giá là một bảng và một lần quét lúc startup."

**Q45. Đặt SLO và ngân sách error budget xuyên một chuỗi service thế nào?**
"Mỗi hop ăn độ tin cậy: ba service ở 99,9% cho 99,7% end-to-end — 3 request hỏng mỗi 1.000. Ngân sách lùi từ SLO user thấy được: user p99 < 1 s nghĩa là order p99 < 900 ms, nghĩa là inventory + payment cùng < 700 ms. Mỗi dependency có ngân sách riêng và một breaker tune để enforce nó:"

```java
// Ngân sách: user SLO 99,9% → mỗi service trong 3 đốt tối đa 0,033%
// Ở 1M request/tháng, một service có thể fail 333 lần trước khi page
public class SloBudget {
    public static final double CHAIN_SLO = 0.999;
    public static final double PER_SERVICE = 1 - (1 - CHAIN_SLO) / 3;   // 0.99967
}
```

```yaml
prometheus:
  alerts:
    - expr: rate(http_server_requests_seconds_count{status=~"5.."}[5m]) > 0.001
      for: 15m # đốt 0,1% ngân sách trong 15 phút → page
```

"Con số quan trọng: chuỗi 3 service ở 99,9% mỗi cái là 99,7% user thấy được. Nếu sản phẩm cần 99,95%, ai đó nhận SLO 99,99% với timeout chặt hơn, hoặc chuỗi ngắn lại."

**Q46. Rate-limit và enforce backpressure xuyên chuỗi thế nào?**
"Phía server, một 429 cho client vượt quota bảo vệ bạn khỏi burst 10×. Phía client, một rate limiter trên outbound call bảo vệ dependency của bạn. Resilience4j cho cả hai phía:"

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
      limitForPeriod: 50 # 50 call mỗi cửa sổ
      limitRefreshPeriod: 1s # = 50 rps với payment provider
      timeoutDuration: 500ms # chờ tối đa 500ms lấy permit, rồi fail fast
```

"Khi provider chậm lại, limiter phía client trải đều 50 rps của bạn thay vì burst 200 và ăn một đống 429s; kết hợp với chờ 500 ms, caller nhận một lỗi sạch trong nửa giây, không phải một timeout 3 s."

**Q47. Chứng minh hệ thống thực sự phục hồi — và giữ nguyên phục hồi?**
"Resilience là một giả thuyết cho tới khi một test giết dependency. Fault injection ở staging — giết inventory, giết Kafka, giết một database — và assert SLO vẫn đứng. Tự động hóa nó: chaos chạy theo lịch, metrics được so với error budget:"

```java
@Test
@SpringBootTest(webEnvironment = RANDOM_PORT)
class ResilienceChaosTest {
    @Test
    void order_survives_inventory_outage() {
        wireMock.stubFor(post("/api/stock/reserve").willReturn(aResponse()
            .withFixedDelay(5_000).withStatus(503)));   // inventory chết VÀ chậm

        List<CompletableFuture<OrderResult>> calls = IntStream.range(0, 100)
            .mapToObj(i -> supplyAsync(() -> orderSaga.place(order(i)), pool))
            .toList();

        assertThat(calls).allSatisfy(f ->
            assertThat(f.join(5, SECONDS).status()).isIn("FAILED", "DEGRADED"));
        // breaker đã mở, không gì treo, không thread rò rỉ — được assert, không phải giả định
    }
}
```

"Chạy cùng test đó sau mọi thay đổi resilience; nếu một thay đổi tương lai lặng lẽ gỡ breaker, chaos test page team trước khi khách hàng làm điều đó."

**Q48. Bạn cần đổi tên một field trong event được 10 service tiêu thụ. Làm sao?**
"Không bao giờ là một rename gây vỡ. Thêm field mới, ship consumer đọc nó, rồi bỏ field cũ — ba lần deploy, mỗi lần an toàn độc lập. Một schema registry (Avro/JSON schema) làm sự tiến hóa tường minh và chặn thay đổi không tương thích ngay tại producer:"

```java
// release 1: thêm field mới, giữ field cũ
record OrderPlaced(Long orderId, String customerId, String customerRef /* mới */) {
    public String legacyRef() { return customerRef != null ? customerRef : customerId; }
}

// release 2: consumer đọc customerRef
// release 3: xóa customerId, bump schema version
```

"Với 10 consumer, một rename gây vỡ nghĩa là 10 lần deploy phối hợp hoặc ~10 incident page; migration ba bước chậm hơn nhưng không bao giờ cần cutover phối hợp — và schema registry biến 'tôi quên' thành một CI build fail thay vì một production outage."

**Q49. AuthN/authZ xuyên các service thế nào?**
"Một identity domain duy nhất: gateway (hoặc một auth service) phát JWT một lần, và các service downstream validate chữ ký local — không bao giờ một call tới auth service trung tâm cho mỗi request, thứ trở thành điểm chết chung. Mỗi service vẫn enforce authorization claims riêng của nó:"

```java
@Component
public class JwtAuthFilter extends OncePerRequestFilter {
    private final JwtDecoder decoder;   // shared public key — không network call mỗi request

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res,
                                    FilterChain chain) throws IOException, ServletException {
        Jwt jwt = decoder.decode(extract(req));     // verify chữ ký local (~100 µs)
        String role = jwt.getClaimAsString("role");
        if (!allowed(req, role)) { res.setStatus(403); return; }
        chain.doFilter(req, res);
    }
}
```

"JWT validation local ~100 µs; introspection mỗi request tới auth service trung tâm là 1–5 ms cộng một dependency availability. Tin chữ ký, phân phối public key, giữ authorization local."

**Q50. Architecture review của bạn: kể ba thứ sẽ giết hệ thống microservices này trong production.**
"Thứ nhất, không circuit breaker và retry hiếu chiến ở khắp nơi — một dependency chập chờn thành một retry storm kéo cả chuỗi xuống (200 thread × 3 retry ngay lập tức biến một outage 5% thành DDoS toàn phần trong một incident tôi từng sống qua). Thứ hai, distributed transaction và shared schema giả vờ là 2PC — distributed monolith không bao giờ deploy độc lập được. Thứ ba, không timeout: mọi call chờ vĩnh viễn và p99 trở thành 'đợi tới khi ai đó restart':"

```java
// Ba kẻ giết người, trong code:
// 1. Retry không backoff hay breaker — thundering herd
@Retry(name = "x", maxAttempts = 10)              // 10 × đồng bộ = 10× tải
// 2. Shared schema / 2PC xuyên service — distributed monolith
@Transactional
public void place(Order o) { orderRepo.save(o); paymentsDb.charge(...); }   // SAI
// 3. Không timeout — một dependency treo sở hữu thread của bạn
RestClient.builder().build();     // default: không read timeout — treo vĩnh viễn
```

"Câu trả lời của senior là điều ngược lại: mọi call có timeout (3 s), retry có giới hạn với backoff và jitter sau một breaker, transaction local, và boundary test — 'cái này deploy một mình được không?' — được chạy trong mọi review. Nếu rời phỏng vấn này chỉ nhớ một câu: resilience là configuration trước khi nó là code."

#### Self-check

- [ ] Junior: Tôi giải thích được microservice vs monolith, sync vs async, gateway, discovery, circuit breaker, REST client, timeout, retry, và DTO contract — mỗi cái với một snippet Spring chạy được trong đầu.
- [ ] Mid: Tôi giải thích được database-per-service, 2PC vs Saga, outbox, vì sao `@Transactional` không vắt ngang service, retry storm, bulkhead, tracing, versioning, và song song hóa chatty call.
- [ ] Senior: Tôi argument được chống premature splitting với modular monolith, thiết kế payment saga resume được sau crash, size pool 200 thread từ Little's Law, ngân sách SLO xuyên chuỗi, và kể được ba thứ giết một hệ thống microservices.
- [ ] Phòng thủ: Tôi bảo vệ mọi lựa chọn bằng con số — timeout 3 s, retry 3× có backoff, ngân sách p99, và chi phí lock của 2PC so với cửa sổ compensation của Saga.
- [ ] Bằng chứng: Tôi chứng minh phục hồi bằng fault-injection test và enforce boundary bằng ArchUnit — resilience là configuration trước khi nó là code.
