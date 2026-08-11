---
title: "Phỏng vấn Senior Java: Microservices"
description: "Microservices cấp senior chủ yếu là biết khi nào KHÔNG dùng — resilience patterns, service communication, và distributed transactions."
pubDatetime: 2026-08-10T10:10:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - microservices
  - resilience
---

Phỏng vấn microservices test **phán đoán** nhiều hơn kiến thức. Câu trả lời senior nhất cho "thiết kế một microservice" đôi khi là "chưa, đừng." Câu senior thứ nhì bắt đầu bằng "phần nào của monolith mình khoét ra trước, và làm sao vẫn ship trong lúc khoét?" Không ai được điểm vì vẽ thêm mấy cái hộp.

> Tư duy: junior liệt kê patterns; senior kể lại failure modes. Khi bạn trả lời bằng một con số, một câu chuyện postmortem, hay một câu "đây là đánh đổi và lúc nào tôi lật ngược nó" — bạn đã qua vạch.

## 1. Bẫy distributed-monolith

Chia nhỏ sớm quá mang lại **network call thay cho method call**, distributed transaction, và **10× chi phí vận hành** mà không được lợi gì. Mọi monolith bạn tách đều nộp một khoản thuế trả trước: cái network. Một round trip HTTP cùng datacenter là **~0,1–0,5 ms**; một method call trong process là **~1 ns**. Bạn đang tự nguyện chậm hơn 2–3 bậc độ lớn và gọi đó là kiến trúc.

Các trigger thực sự biện minh cho việc tách:

- **Independent deployability.** Một team ship hằng ngày mà không cần đoàn tàu release chung. Đây là lý do #1 trong thực tế.
- **Profile scaling khác nhau.** Một job-queue consumer và một API phục vụ traffic người dùng không nên chung một heap — nhưng để ý: một worker pool riêng trong cùng một process cũng thường giải quyết được cái này.
- **Failure domain khác nhau.** Cô lập crash hoặc GC của một subsystem nóng (xem bulkhead bên dưới — đó là cách rẻ hơn trước).
- **Team/quyền sở hữu khác nhau.** Định luật Conway: kiến trúc chạy theo sơ đồ tổ chức. Tách để khớp ranh giới team là thành thật; tách "vì microservices" là cargo cult.

Câu phản vấn của senior trước khi tách: **"Một modular monolith có cho chúng ta cái này không?"** Ranh giới ở cấp _module_ — mỗi module có package riêng, schema/bảng riêng, scope transaction riêng, API riêng — cho bạn gần hết tính enforce mà không cần network. Khi tách thật, bạn **bắt buộc** thêm một **anti-corruption layer**: service mới phơi ra model riêng của nó và không bao giờ để lộ bảng nội bộ cho consumer, nếu không cú split tự khắc cứng vào mọi caller.

Dữ liệu mới là cú split thật, không phải code. "Chúng ta chuyển code qua và giữ nguyên cái database dùng chung" chính là cách bạn có một **distributed monolith** — network call _và_ coupling dùng chung, cái tệ nhất của cả hai. Một split thật nghĩa là split database, nghĩa là mọi read xuyên service trở thành một join xuyên network — đó là nơi phát sinh toàn bộ machinery saga/outbox bên dưới. Nếu caller của bạn không chịu nổi eventual consistency cho dữ liệu đó, thì bạn chưa hề tách nó.

## 2. Service communication — và cái ngân sách latency quyết định pattern

Câu hỏi đầu tiên không phải "REST hay gRPC", mà là **"request này chịu nổi bao nhiêu hop đồng bộ?"** Trình bày nó như một ngân sách, vì đó là điều phỏng vấn viên thăm dò:

```
User → API gateway → Service A → Service B → DB

Một hop qua gateway:           ~1–5 ms  (routing + authn)
Một hop service cùng DC:       ~0,1–1 ms trên dây, nhưng cái *call* còn hơn thế:
                               serialize + deserialize + scheduling thread + thời gian
                               DB của downstream + queueing của nó → P99 10–100 ms.
Ngân sách: 500 ms P99 → tối đa 3 hop đồng bộ, mỗi hop có ~100 ms trước khi
timeout của caller bắn và cả chuỗi xuống cấp.
```

Vượt quá 3 hop đồng bộ là bạn đang chơi trò ghế âm nhạc với timeout. Đó là lý do thật async thắng trong chuỗi dài: **bạn loại hẳn số hạng latency-của-hop ra khỏi request của người dùng.**

### REST vs gRPC — nói đánh đổi, không nói sở thích

- **REST/HTTP:** phổ biến, debug được trong mọi trình duyệt, load-balance tầm thường, payload đọc được. Giá: JSON parse/serialize trên mỗi hop, HTTP/1.1 head-of-line blocking trên mỗi connection (giảm bớt bằng connection pool), không có chuyện streaming đáng nói, type yếu giữa các team.
- **gRPC:** HTTP/2 multiplex nhiều call đang chạy trên **một connection** — hết head-of-line blocking, giảm ~nửa overhead framing — và protobuf là binary: payload nhỏ hơn, chi phí parse gần như bằng không. Streaming request/response miễn phí. Giá: tooling cọ xát, khó đọc mắt thường bằng `curl`, thay đổi schema là một **hợp đồng deploy** (luật additive-field của protobuf là một spec bạn phải thực sự tuân theo), và binding async-server là chỗ người của Spring WebFlux kiếm tiền.

Câu trả lời senior: "hot path nội bộ, QPS cao, cần streaming → gRPC. API public, bề mặt debug, consumer đủ loại → REST." Và gotcha thật của cả hai là **timeouts, không phải protocol** — xem phần retry trước khi bạn đụng vào bất kỳ cái nào.

### Idempotency trước retry, luôn luôn

Retry mà không idempotency là duplicate side effect có thêm bước. Cách sửa là một **idempotency key** caller sinh ra và callee dedupe — và nó phải được enforce ở **storage**, không phải "chúng ta check một cái map":

```sql
-- SAI — check-then-insert bị race: hai lần retry đều qua SELECT,
-- đều insert, và bạn đã tính phí khách hai lần.
SELECT 1 FROM payments WHERE idempotency_key = 'CUST-42-RETRY-9';

-- ĐÚNG — unique index là trọng tài, câu insert là atomic.
CREATE UNIQUE INDEX uq_payments_idem ON payments(idempotency_key);

INSERT INTO payments (id, idempotency_key, amount, status)
VALUES (nextval('payments_id_seq'), 'CUST-42-RETRY-9', 19.90, 'PENDING')
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

Không có row trả về → đó là duplicate → trả về kết quả đã lưu trước đó. "Chúng tôi dedupe phía app bằng `ConcurrentHashMap`" chính là cách bạn mất tiền lúc 3 giờ sáng.

## 3. Resilience patterns — vẽ các state, rồi đến các con số

### Circuit breaker

Closed → mở khi chạm `failureRateThreshold` của sliding window → **half-open sau `waitDurationInOpenState`** để thăm dò bằng vài call thử → đóng lại hoặc mở lại. Các mặc định chính là câu trả lời: Resilience4j ship `failureRateThreshold=50%`, `slidingWindowSize=100`, `minimumNumberOfCalls=10`, `waitDurationInOpenState=60s`. Nêu được nó và bạn trông như người từng cấu hình, bởi vì bạn thật sự đã cấu hình.

Sắc thái quan trọng mà phỏng vấn viên khoan: **một breaker mở từ chối nhanh (bạn cứu được công việc đang in-flight), nhưng nó cũng giấu traffic thật khỏi cú probe hồi phục.** Ngưỡng quá gắt khiến một cú rớt giật cục mở breaker và đưa cả dependency offline. `permittedNumberOfCallsInHalfOpenState` (mặc định 10) là đòn bẩy — nó là số call được phép _thử_ hồi phục. Để probe half-open sai và bạn đã thay "dependency chậm" bằng "dependency cộng thêm cold start 5 giây mỗi lần hồi phục."

### Bulkhead — cô lập bằng một con số

```java
// SAI — một pool duy nhất cho tất cả: một endpoint 'reporting' chậm
// từ từ nuốt hết 200 thread, và payments cũng timeout theo.
ExecutorService everything = Executors.newFixedThreadPool(200);

// ĐÚNG — pool theo từng dependency, size bằng Little's law:
//   pool_size = throughput × time_in_pool
//   50 req/s × 250 ms = ~13 thread cho 'reporting';
//   cho nó 15, chặn trần, và payments không bao giờ thấy nó chậm.
ExecutorService reporting = new ThreadPoolExecutor(
    15, 15, 0, MILLISECONDS, new ArrayBlockingQueue<>(50), new CallerRunsPolicy());
ExecutorService payments = new ThreadPoolExecutor(
    10, 10, 0, MILLISECONDS, new ArrayBlockingQueue<>(30), new CallerRunsPolicy());
```

Little's law là cùng một phép toán như thread pool (xem guide Java core) — bản microservices là: **mỗi dependency ngoài có pool giới hạn riêng và circuit breaker riêng**, nên một dependency sụp đổ bị cách ly. Bulkhead kiểu semaphore rẻ hơn (`SemaphoreBulkhead`) đúng khi bạn không cần offload công việc — một permit, không queue — và gần như không tốn gì.

### Retry + backoff + jitter — cú DDoS tự gây

`for (i < 3) retry` ngây thơ lúc outage là cú self-DoS phổ biến nhất trên production. Làm phép tính:

```
10.000 instance mỗi cái retry 3× không backoff = 30.000 request
đập vào một service đã sập → nó không bao giờ hồi phục.
Kể cả CÓ backoff: chờ cố định 1s nghĩa là ai cũng retry trên cùng
một nhịp — thundering herd đồng bộ. Jitter là thứ làm mất đồng bộ nó.
```

Mặc định của senior là **exponential backoff với full jitter** — ngẫu nhiên hóa thời gian chờ tới cái cap đã tính:

```java
// SAI — chờ cố định 1s, mọi instance đồng bộ, và cú retry
// đập đúng vào endpoint đang ngã gục.
for (int attempt = 0; attempt < 3; attempt++) {
    try { return call(); } catch (IOException e) { Thread.sleep(1000); }
}

// ĐÚNG — exponential backoff với full jitter (Resilience4j):
// chờ cỡ 50–100, 100–200, 200–400 ms, ngẫu nhiên hóa mỗi lần.
Retry retry = Retry.custom("payments")
    .maxAttempts(3)
    .intervalFunction(IntervalFunction.ofExponentialBackoff(
        Duration.ofMillis(100),   // initial
        2.0,                      // multiplier
        Duration.ofSeconds(2)))   // cap
    .build();

// và full jitter, nếu bạn muốn desync mạnh:
Retry jittery = Retry.custom("payments")
    .intervalFunction(IntervalFunction.ofRandomized(
        Duration.ofSeconds(1), Duration.ofSeconds(5)))
    .build();
```

Các luật kết thúc cuộc cãi: **chỉ retry trên call idempotent** (hoặc có idempotency key), **chỉ retry lỗi transient** (timeout, `5xx`, connection reset — không phải `400`), **chặn tổng attempt và tổng thời gian**, và **để circuit breaker có quyền phủ quyết retry** — một cú retry chạy trong lúc breaker đang mở chỉ là amplification.

```java
// Toàn bộ stack, theo đúng thứ tự:
// timeout(800ms) → retry(3, backoff+jitter) → circuit breaker
Supplier<String> decorated = Decorators.ofSupplier(() -> callDownstream())
    .withTimeout(Timeout.of(Duration.ofMillis(800)))
    .withRetry(retry)
    .withCircuitBreaker(CircuitBreaker.ofDefaults("payments"))
    .decorate();
```

### Ngân sách timeout & deadline — truyền ngân sách đi, đừng làm nó phình ra

Mỗi service trong chuỗi nên lấy một **phần** của tổng ngân sách của caller, và ngân sách phải **thu hẹp lại khi qua dây** (deadline propagation — gRPC mang nó tự nhiên qua metadata; REST thì truyền qua header). Failure mode kinh điển: A gọi B với 5s, B gọi C với 5s, C gọi D với 5s → người dùng xin 5s tổng nhưng chuỗi hợp pháp có thể mất 20s. Rồi mỗi cú retry trung gian lại _nhân đôi_ cái đuôi. Nêu nó thành câu: "một timeout phải luôn nhỏ hơn cái timeout ở phía trên nó."

## 4. Service discovery, config, gateway

### Discovery

Eureka/Consul đăng ký instance và đưa client một địa chỉ; K8s DNS chỉ resolve tên service thành một tập IP. Góc senior là **hành vi cache**: nếu client cache địa chỉ đã discovery và cache bị stale trong lúc instance churn (rolling deploy, một node chết), request đập vào endpoint chết — và _đó_ là thứ retry của bạn giờ khuếch đại. Cache TTL của discovery và failure mode "endpoint stale" là chuyện thật trên production. Biết rằng Consul dùng gossip và một server quorum; Eureka có self-preservation mode giữ dữ liệu registry stale khi network bị partition — cả hai đều là quirk phỏng vấn viên có thể đào.

### Config

Centralized config (Spring Cloud Config / K8s ConfigMap) cho bạn một bản audit thay đổi và một chỗ duy nhất để push secrets — nhưng mẹo phân loại senior là **"một cú push config restart service của tôi hay hot-reload nó?"** Hot reload (Spring Cloud Bus / `@RefreshScope`) hay ho cho tới khi ai đó refresh một vòng _secret rotation_ giữa request. Không bao giờ cache config mà không có TTL và một đường invalidation, và không bao giờ cho credentials vào git — hãy dùng Vault hoặc một external secrets backend, và rotate chúng.

### Gateway — single point of failure mới

Gateway gom authn, rate limiting, routing, và canary routing vào một hop. Đánh đổi cần nêu tên: **nó giờ là hộp chịu tải nặng nhất hệ thống**, và một cú outage của gateway kéo sập mọi thứ — đúng cái failure domain mà bạn đáng lẽ đã nói một microservice nên tránh. Mitigation đáng nói to: gateway stateless scale ngang sau một load balancer, client-side discovery làm fallback, và BFF (backend-for-frontend) như lựa chọn thay thế khi các client khác nhau cần aggregation khác nhau. Còn về rate limiting: token-bucket trước gateway + kiểm tra quota trong các service phía sau — riêng gateway thì bị bypass bởi bất kỳ client nào gọi thẳng service.

## 5. Distributed data & transactions — phần thật sự khó

### Saga: orchestration vs choreography

Một saga là một chuỗi local transaction với các compensating action. Bản orchestrated (coordinator trung tâm) dễ suy luận hơn — một state machine bạn vẽ được — nhưng nó là một bottleneck và một single point of failure mới. Choreography (các service phản ứng theo event) tránh coordinator nhưng rải state machine khắp mọi service và là một cơn ác mộng tracing: "ai khởi động order này và vì sao nó ở state X?" là một cuộc khai quật xuyên service.

```java
// Saga orchestrated: coordinator là nơi duy nhất tồn tại cái flow.
// Mỗi bước chạy trong local transaction riêng; mỗi bước có một
// compensate() gỡ nó đi trong local transaction riêng của chính nó.
@Component
public class OrderSaga {
    // start → pay → reserveInventory → ship
    //         ↑ khi fail: compensate() từng bước đã hoàn tất, thứ tự ngược
    public void run(CreateOrderCommand cmd) {
        Order order = orderRepo.save(cmd.toOrder());        // local tx
        try {
            paymentClient.authorize(order.getPaymentId());  // RPC
            inventoryClient.reserve(order.getItems());      // RPC
            shipmentClient.schedule(order.getId());         // RPC
            order.complete(); orderRepo.save(order);
        } catch (SagaStepException e) {
            // gỡ từng bước đã commit — mỗi cái trong tx riêng của nó
            compensate(order, cmd, e);
            order.fail(e); orderRepo.save(order);
        }
    }
}
```

Các compensating action là phần junior quên: **một compensation không phải là rollback** — nó là một local transaction mới sửa lại cái mà một transaction trước đã làm (hoàn tiền, nhả reservation). "Compensation = undo" là câu lọc senior chuẩn. Và nếu bản thân compensation fail, bạn có một **stuck saga** — đó là lý do một thiết kế thật log từng bước saga vào một persistent state table mà operator (hoặc một sweeper job) có thể đẩy về hoàn tất. Chẳng ai nói ra, nhưng cái state table đó chính là transaction log của saga, và nó là thứ khiến toàn bộ thứ này audit được.

### 2PC — chỉ nêu ra để giải thích vì sao bạn không dùng

Two-phase commit giữ lock trên tất cả participant trong lúc coordinator hỏi "sẵn sàng chưa?" — trong phase prepare, dữ liệu bị khóa, và nếu coordinator chết hoặc network bị partition, các lock vẫn bị giữ. Trên một business flow dài, điều đó nghĩa là những transaction có thể treo hàng phút trong khi tài nguyên vẫn bị khóa. Câu kinh điển: "2PC cho bạn atomic commit _chỉ khi_ mọi participant và coordinator cùng sống — đúng cái điều mà một distributed system không hứa." Đó là câu trả lời. Rồi quay sang outbox.

### Bài toán dual-write và transactional outbox

Bất cứ khi nào một service ghi vào DB **và** publish một event lên Kafka, hai cú ghi không atomic — crash giữa chúng và bạn mất một event, hoặc gửi trùng. Transactional outbox sửa cả hai: **ghi event vào cùng transaction database với thay đổi business**, rồi một relay publish nó.

```sql
-- một local transaction:
INSERT INTO order (id, state) VALUES (?, 'CREATED');
INSERT INTO outbox (aggregate_id, event_type, payload, published_at)
VALUES (?, 'order.created', jsonb_build_object('id', ?), NULL);
```

```java
@Transactional
public Order createOrder(CreateOrderCommand cmd) {
    Order order = orderRepo.save(cmd.toOrder());
    outboxRepo.save(OutboxEvent.of("order.created", order.getId())); // cùng tx
    return order;  // commit chưa publish gì — relay làm
}
```

```java
// relay: poll các row chưa published, publish, đánh dấu đã publish.
// FOR UPDATE SKIP LOCKED = nhiều instance relay mà không tranh nhau.
List<OutboxEvent> pending = outboxRepo.findUnpublished(100); // ... SKIP LOCKED
for (OutboxEvent evt : pending) {
    kafkaTemplate.send("orders", evt.getPayload());
    evt.markPublished();
}
```

Lúc này đảm bảo là at-least-once (relay có thể crash sau publish trước khi mark) — điều đó ổn **vì consumer là idempotent** (phần 2). Bộ idempotency + outbox đó là thứ gần nhất với một distributed transaction sống sót qua production, và tự nêu ra nó không được ai nhắc là một dấu hiệu senior mạnh.

### Event ordering và biến thể poison-message

Ordering chỉ được đảm bảo theo từng partition; hãy key mọi event của một aggregate theo id của nó để chúng rơi vào một partition (guide Kafka nói chuyện này). Và bất kỳ consumer nào xử lý "chúng tôi nhận được duplicate" bằng cách _tín dụng gấp đôi_ chính là lý do idempotency là một chuyện của storage, không phải một niềm tin.

### Distributed locking — khi bạn thực sự cần

Cho cái critical section xuyên service hiếm hoi (phối hợp job, counter theo tenant), một DB-based lock có lease đánh bại Redis SETNX viết vội:

```sql
-- ĐÚNG — lease-backed: row CHÍNH LÀ cái lock, hết hạn nếu holder chết,
-- và holder phải kiểm tra mình vẫn giữ nó trước khi làm việc (fencing).
INSERT INTO job_lock (name, holder, lease_expires_at)
VALUES ('reindex', 'node-7', now() + interval '30 seconds')
ON CONFLICT (name)
DO UPDATE SET holder = 'node-7', lease_expires_at = now() + interval '30 seconds'
WHERE job_lock.holder = 'node-7' OR job_lock.lease_expires_at < now()
RETURNING holder;
```

Cái bẫy ai cũng dính: một lock với TTL cố định và một holder chậm (GC pause) — lease hết hạn, holder thứ hai lấy lock, và giờ có hai "holder" chạy. Cách sửa là một **fencing token**: lock phát ra một token tăng đơn điệu và resource được bảo vệ từ chối write với token cũ hơn (như một version column của DB). Nhắc tới fencing token đáng một cái gật đầu; đó là câu trả lời senior.

## 6. Observability — khác biệt giữa senior và bản demo

Một senior thiết kế tracing từ ngày một, không phải sau incident. Nói ba điều cụ thể:

- **Distributed tracing với correlation IDs.** Mỗi request mang một `trace-id`/`span-id` (W3C Trace Context), được truyền qua mọi hop và vào cả đường async — nếu không, một saga điều khiển bằng event không trace được. OpenTelemetry + một collector.
- **RED metrics, không phải "uptime" mơ hồ.** Rate, Errors, Duration theo từng service — và theo từng _dependency_, để sức khỏe của circuit breaker nhìn được từ bên ngoài. "Chúng tôi monitor service của mình" nghĩa là bạn trỏ được vào một dashboard hiện cả _chuỗi_, không phải một hộp.
- **Structured logs với correlation ID trong mọi dòng**, cộng log aggregation. "Request fail ở đâu đó trong chuỗi" trở thành "đây chính xác là span 15 ms."

Bài test failure-mode trên production: "P99 của chúng tôi đi 80 ms → 3 s sau một deploy." Mẫu trả lời là symptom → tool → finding → fix, giống hệt guide Java core: kéo trace, xem hop nào nuốt thời gian, check state của breaker ở service đó và pool của dependency của nó, rồi sửa _nguyên nhân_ — thường là một dependency chậm với queue vô hạn hoặc thiếu timeout, không phải "thêm instance."

## 7. Tự kiểm tra

- [ ] Kể tên hai lý do KHÔNG tách monolith, và vì sao dữ liệu mới là cú split thật.
- [ ] Viết ngân sách timeout cho một chuỗi đồng bộ 3 hop và giải thích deadline propagation.
- [ ] Giải thích circuit breaker + bulkhead với một ví dụ thật và cách size theo Little's law.
- [ ] Vì sao retry ngây thơ lúc outage nguy hiểm — kèm con số?
- [ ] Transactional outbox giải quyết điều gì mà 2PC không thể, và vì sao nó là at-least-once?
- [ ] Giải thích vì sao idempotency key phải được enforce ở storage layer.
- [ ] Orchestration vs choreography — đánh đổi, và chỗ mỗi cái fail.
- [ ] "Một compensation không phải rollback" nghĩa là gì, và khi compensation fail thì chuyện gì xảy ra?
- [ ] Bạn trace một saga điều khiển bằng event từ đầu tới cuối thế nào?

## 8. Follow-ups từ phỏng vấn viên

Khi câu trả lời đầu tiên của bạn đáp xuống, họ bắt đầu khoan. Sẵn sàng cho những câu này:

- "Bạn tách monolith và giờ checkout là 4 hop đồng bộ. Đi qua ngân sách latency — thời gian đi vào đâu, và bạn đổi gì?"
- "Một cơn retry storm vừa đập vào payment service. Đòn bẩy đầu tiên của bạn là gì — config retry, breaker, hay queue — và vì sao?"
- "Outbox relay publish một event hai lần vì nó crash sau `send`. Consumer của bạn tín dụng gấp đôi một user. Bug thật sự là gì, và cách sửa?"
- "Discovery cache của bạn stale và client đang đập vào instance chết. Cái gì vỡ trước, và resilience patterns của bạn giấu nó thế nào?"
- "Gateway sập và mọi thứ offline. Chuyện đó có chấp nhận được không, và bạn đã thiết kế gì để sống sót qua nó?"
- "Một saga compensation fail giữa chừng và order kẹt ở PENDING. Ai sửa nó, và cái gì trong DB làm cho điều đó khả thi?"
- "gRPC hay REST cho một payments API nội bộ 10k QPS có streaming? Cho tôi đánh đổi, không phải khẩu hiệu."
- "Vì sao retry backoff cố định tệ hơn retry có jitter — chỉ tôi sự khác biệt về phân bố."
- "Consumer của bạn đọc event lệch thứ tự cho một order id. Những đảm bảo nào bị vi phạm, và bạn khôi phục thứ tự theo aggregate thế nào?"
- "Bạn sắp gọi một service mới không timeout, không breaker, không giới hạn pool. Cái đầu tiên duy nhất bạn thêm vào trước khi enable nó là gì?"

Đó là bar microservices.
