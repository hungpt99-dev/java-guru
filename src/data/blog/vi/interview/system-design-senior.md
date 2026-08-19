---
title: "Ôn thi Java #7: Nền tảng và đánh đổi trong System Design"
description: "Hướng dẫn phỏng vấn system design về yêu cầu, capacity, dữ liệu, xử lý lỗi, khả năng mở rộng và observability."
pubDatetime: 2026-08-10T10:25:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - system-design
  - scalability
---

System design không phải là bài thi gọi tên component. Phần khó là chuyển các yêu cầu chưa đầy đủ thành những quyết định rõ ràng về latency, consistency, capacity, failure handling và vận hành. Bài này đi từ nền tảng, qua các trade-off, rồi đến các thiết kế end-to-end.

**Cách đọc các con số.** Trừ khi là thuộc tính của protocol, mọi con số bên dưới đều là **giả định minh họa**. Khi thiết kế thật, hãy thay chúng bằng số đo từ workload, dependency và region cụ thể. Nhãn cho biết loại phát biểu: **[SOURCE FACT]** mô tả hành vi của protocol hoặc kiến thức kỹ thuật phổ biến; **[ANALYSIS]** giải thích trade-off; **[PROPOSED DESIGN]** là một thiết kế có thể bảo vệ được, không phải đáp án duy nhất.

## Junior: Nền tảng

**Q1. Các building block chính của web system là gì?**
**[ANALYSIS]** Một request path phổ biến gồm DNS, load balancer, stateless application server, cache, database, và khi cần thì queue cùng worker. CDN phục vụ static asset có thể cache. Mỗi block có ranh giới: database là system of record, cache là tối ưu hóa, còn queue tách phần việc không cần hoàn tất trong request:

```text
Client -> DNS -> Load Balancer -> App -> Cache
                         |          |       |
                         |          +-> Queue -> Workers
                         +-> CDN    +-> Database primary -> replicas
```

**Q2. Điều gì xảy ra sau khi nhập URL?**
**[SOURCE FACT]** Trình tự thường là DNS lookup, tạo kết nối TCP, TLS negotiation, HTTP request, xử lý ở application và response. **[ANALYSIS]** Hãy xem mỗi phần là một latency budget có thể đo. DNS đã cache có thể gần như không thêm network work; round trip xa và TLS negotiation có thể chiếm phần lớn budget nhỏ. Đừng kết luận application code là bottleneck trước khi xem trace.

**Q3. L4 khác L7 load balancing thế nào?**
**[SOURCE FACT]** L4 route bằng thông tin transport như TCP hoặc UDP, không hiểu URL HTTP. L7 parse HTTP nên có thể route theo path, áp dụng policy theo HTTP và đôi khi retry. **[ANALYSIS]** L7 thêm chi phí xử lý và độ phức tạp; dùng khi khả năng quan sát đó đáng với chi phí:

```text
L4: Client -> TCP:443 -> LB -> healthy node
L7: Client -> LB -> /api/* -> API nodes
                 +-> /static/* -> CDN origin
```

**Q4. Horizontal và vertical scaling khác nhau thế nào?**
**[SOURCE FACT]** Vertical scaling là dùng máy lớn hơn. Horizontal scaling là thêm máy, thường đặt sau load balancer. **[ANALYSIS]** Vertical đơn giản hơn nhưng có giới hạn và có thể tạo một failure domain duy nhất. Horizontal đòi hỏi application instance stateless và state dùng chung hoặc ở bên ngoài. **[GIẢ ĐỊNH MINH HỌA]** Nếu một node phục vụ 500 RPS và mục tiêu là 10.000 RPS, 20 node chỉ đủ cho mức trung bình; thêm headroom 25% cho ra 25 node:

```text
nodes = target_rps / node_rps * (1 + headroom)
      = 10,000 / 500 * 1.25 = 25
```

**Q5. Stateless nghĩa là gì?**
**[SOURCE FACT]** Stateless instance không giữ request-specific state mà request sau bắt buộc phải tìm đúng instance đó. **[ANALYSIS]** Session trong memory tạo ra phụ thuộc vào routing. Hãy lưu session ở shared store hoặc dùng client token:

```java
// Tránh state chỉ nằm trong một instance.
session.put("cart", cart);

// State bên ngoài giúp mọi instance xử lý request.
String cartId = redis.set(cartJson); // TTL minh họa: 24h
```

**Q6. Cache-aside là gì, và hỏng ở đâu?**
**[SOURCE FACT]** Application đọc cache, khi miss thì đọc database rồi populate cache. **[ANALYSIS]** Cách này giữ database làm nguồn chuẩn và có thể fallback khi cache không khả dụng, nhưng cho phép dữ liệu stale và có thể gây stampede. **[GIẢ ĐỊNH MINH HỌA]** TTL 60 giây và hit rate 95% là giả định workload, không phải đặc tính của cache-aside:

```java
String value = redis.get(key);
if (value == null) {
    value = db.query(key);
    redis.set(key, value, 60); // TTL minh họa, tính theo giây
}
return value;
```

**Q7. CDN là gì?**
**[SOURCE FACT]** CDN cache content tại edge, giảm request tới origin và thường giảm latency cho user. **[ANALYSIS]** CDN phù hợp với static asset có version và response được phép cache. Response động theo user cần cache key và kiểm soát privacy phù hợp; nếu không thì không cache.

**Q8. SQL và NoSQL khác nhau thế nào?**
**[SOURCE FACT]** SQL database cung cấp relational query, schema và các transactional guarantee như ACID. NoSQL là nhóm đa dạng, thường tối ưu cho access pattern, mô hình scale-out hoặc cách biểu diễn cụ thể. **[ANALYSIS]** Chọn theo data shape, query pattern, consistency và ràng buộc vận hành, không theo nhãn. Hybrid như Redis làm cache, PostgreSQL làm transactional truth và column store làm analytics có thể hợp lý.

**Q9. Index là gì?**
**[SOURCE FACT]** B-tree index có thể tránh quét toàn bộ row khi predicate phù hợp, đổi lại tốn storage và write work. **[ANALYSIS]** Câu trả lời phải được đo bằng `EXPLAIN` và dữ liệu đại diện. **[GIẢ ĐỊNH MINH HỌA]** Scan 10 triệu row mất vài giây còn indexed lookup mất vài mili-giây chỉ là ví dụ, không phải guarantee.

**Q10. Message queue giải quyết vấn đề gì?**
**[SOURCE FACT]** Queue đệm công việc giữa producer và consumer, cho phép xử lý async và retry. **[ANALYSIS]** Queue chỉ hấp thụ burst trong giới hạn retention và capacity; nó không loại bỏ overload. Hãy theo dõi lag và quy định cách xử lý poison message.

**Q11. Giải thích CAP.**
**[SOURCE FACT]** Trong network partition, distributed system không thể vừa đảm bảo availability vừa đảm bảo strong consistency cho cùng một operation. **[ANALYSIS]** CP reject hoặc pause một số operation để giữ consistency; AP tiếp tục phục vụ nhưng chấp nhận observation stale hoặc conflict. Ledger và like count có yêu cầu correctness khác nhau. Không nói hệ thống có cả ba trong lúc partition.

**Q12. Monolith hay microservices?**
**[ANALYSIS]** Monolith thường có ít network và deployment boundary hơn, transaction cục bộ cũng đơn giản hơn. Microservices có thể độc lập về ownership, deployment và scaling, nhưng thêm network failure, distributed data và overhead vận hành. **[PROPOSED DESIGN]** Bắt đầu với monolith được tách module rõ ràng, trừ khi team boundary, yêu cầu isolation hoặc scaling axis độc lập biện minh cho việc tách. Mọi so sánh throughput phải đo trên workload thật.

**Q13. HTTP idempotency là gì?**
**[SOURCE FACT]** Operation idempotent có cùng intended effect khi lặp lại. `PUT` và `DELETE` được định nghĩa là idempotent ở semantics của HTTP; business operation dùng `POST` thường không như vậy. **[PROPOSED DESIGN]** Với create có thể retry, dùng idempotency key do client gửi và lưu kết quả dưới unique constraint.

**Q14. Reverse proxy khác forward proxy thế nào?**
**[SOURCE FACT]** Forward proxy đại diện client khi gọi server bên ngoài. Reverse proxy đại diện server khi client gọi vào. **[ANALYSIS]** Reverse proxy có thể terminate TLS, route traffic, enforce policy và che fleet application:

```text
Forward: client -> proxy -> internet
Reverse: internet -> proxy/LB -> app instances
```

**Q15. WebSocket hay long polling?**
**[SOURCE FACT]** Long polling giữ HTTP request tới khi có event hoặc timeout rồi lặp lại. WebSocket giữ một kết nối hai chiều. **[ANALYSIS]** Long polling dễ triển khai hơn khi không có WebSocket; WebSocket thường phù hợp hơn với server push thường xuyên và yêu cầu latency thấp. Hãy tính connection, heartbeat và reconnect storm trước khi chọn.

**Q16. Replication đem lại gì?**
**[SOURCE FACT]** Replication copy dữ liệu từ primary sang replica. Nó có thể cung cấp read capacity và failover, tùy database và topology. **[ANALYSIS]** Async replication tạo lag và stale read. Mô hình ba replica chỉ là topology minh họa, không phải guarantee availability chung.

**Q17. Sharding là gì?**
**[SOURCE FACT]** Sharding partition dữ liệu qua nhiều node bằng shard key. **[ANALYSIS]** Nó có thể tăng write capacity nhưng làm join, transaction, backup, rebalance và global query khó hơn. Chọn key từ access pattern và failure isolation; đừng shard chỉ vì diagram trông có vẻ scale hơn.

## Mid: Trade-off và failure mode

**Q18. TTL, write-through hay write-back?**
**[SOURCE FACT]** TTL làm entry hết hạn. Write-through cập nhật cache trong write path. Write-back ghi cache rồi persist sau. **[ANALYSIS]** TTL chấp nhận stale có giới hạn; write-through thêm coordination và latency; write-back có nguy cơ mất dữ liệu chưa flush. Read miss chạy đua với write có thể nạp lại dữ liệu cũ, nên thứ tự invalidation phải rõ ràng.

**Q19. Cache stampede là gì?**
**[SOURCE FACT]** Nhiều request có thể miss cùng lúc khi hot entry hết hạn. **[PROPOSED DESIGN]** Dùng TTL jitter, single-flight theo key hoặc refresh trước expiry. Giới hạn thời gian chờ và có fallback; nếu không, một hot key có thể làm quá tải database.

**Q20. Ước lượng capacity thế nào?**
**[ANALYSIS]** Bắt đầu từ layer yếu nhất và trình bày phép tính. **[GIẢ ĐỊNH MINH HỌA]** Ở 10.000 QPS, nếu một app node đã đo được 500 RPS tại p99 mục tiêu, 25 node là ước tính có 25% headroom. Nếu mỗi request có hai database query và cache hit 95%, database nhận khoảng 1.000 QPS. Mọi giả định phải được kiểm tra bằng load test và telemetry.

**Q21. Khi nào SQL là đáp án sai?**
**[ANALYSIS]** SQL không phù hợp khi access pattern cần write scale hoặc distribution mà topology relational đã chọn không đáp ứng. NoSQL không phù hợp khi domain cần join và multi-row transaction mà store không thể biểu diễn an toàn. **[GIẢ ĐỊNH MINH HỌA]** Clickstream 100.000 writes/s so với primary đo được 5.000 writes/s là mismatch về capacity, không phải giới hạn chung của SQL.

**Q22. CP và AP trong thực tế?**
**[SOURCE FACT]** Coordination store thường ưu tiên consistency trong partition; nhiều eventually consistent store ưu tiên availability. **[ANALYSIS]** Hãy nói rõ cái giá với user: ledger có thể reject write, còn like count có thể stale tạm thời. Không suy ra guarantee chỉ từ tên sản phẩm; cần kiểm tra consistency mode và configuration.

**Q23. Tại sao không dùng `hash(key) % N`?**
**[SOURCE FACT]** Modulo sharding remap nhiều key khi `N` thay đổi. Consistent hashing giới hạn số key di chuyển vào range của node mới; virtual node làm đều ownership. **[ANALYSIS]** Tỷ lệ chính xác phụ thuộc hash và cách migration. **[GIẢ ĐỊNH MINH HỌA]** Từ ba lên bốn node bằng modulo đơn giản có thể remap khoảng ba phần tư key.

**Q24. Delivery semantics là gì?**
**[SOURCE FACT]** At-least-once có thể tạo duplicate khi mất acknowledgement. At-most-once có thể làm mất message. **[ANALYSIS]** “Exactly once” trong production thường là exactly-once effect: consumer at-least-once deduplicate theo message ID và làm side effect idempotent.

**Q25. Implement API idempotency thế nào?**
**[PROPOSED DESIGN]** Nhận `Idempotency-Key`, reserve key bằng unique constraint, thực thi operation, rồi lưu response và status. Check rồi insert mà không có constraint là race:

```java
// Key phải unique trong database.
Order existing = orders.findByKey(key);
if (existing != null) return existing;
Order order = orderService.create(cart);
orders.insertWithKey(order, key); // insert đồng thời không tạo order thứ hai
```

**Q26. Size database connection pool thế nào?**
**[ANALYSIS]** Pool phụ thuộc concurrency và capacity của database, không chỉ request rate. Dùng query time đo được, latency mục tiêu, transaction behavior và CPU database. Nhiều connection hơn có thể tăng contention. Quan hệ gần đúng `in_flight = rate * service_time` chỉ là điểm bắt đầu; hãy benchmark pool đã chọn.

**Q27. N+1 là gì?**
**[SOURCE FACT]** Load child một lần cho mỗi parent tạo ra một query cộng N child query. **[PROPOSED DESIGN]** Batch theo ID hoặc dùng join, sau đó kiểm tra query plan. Fix phải giữ đúng pagination và tránh tạo `IN` list quá lớn.

**Q28. Khi nào index gây hại?**
**[SOURCE FACT]** Write phải cập nhật index liên quan; index tốn storage và cache space. **[ANALYSIS]** Index thừa có thể giảm write throughput, nhất là ở table nặng ghi. Giữ index phục vụ query thật, kiểm chứng bằng `EXPLAIN`, và bỏ index không dùng sau khi quan sát workload.

**Q29. Điều gì vỡ khi thêm read replica?**
**[SOURCE FACT]** Async replica có thể lag primary. **[PROPOSED DESIGN]** Route read-after-write về primary, dùng session consistency token, hoặc chấp nhận stale read một cách rõ ràng:

```text
write -> primary -> async replica
own read -> primary; read khác có thể -> replica
```

**Q30. Timeout và retry nên làm thế nào?**
**[PROPOSED DESIGN]** Đặt deadline nhỏ hơn deadline của caller, chỉ retry operation an toàn hoặc idempotent, dùng exponential backoff có jitter, và giới hạn bằng retry budget. Retry không có budget sẽ biến sự cố dependency thành retry storm.

```java
for (int attempt = 0; attempt < maxAttempts; attempt++) {
    try { return client.call(request); }
    catch (TimeoutException e) { backoffWithJitter(attempt); }
}
return fallbackOrError();
```

**Q31. Token bucket hoạt động thế nào?**
**[SOURCE FACT]** Token được nạp theo rate và mỗi request tiêu một token. Bucket cho phép burst có giới hạn và giới hạn sustained rate. **[PROPOSED DESIGN]** Enforce global limit ở edge và tenant limit gần business operation. Nếu request tới nhiều node, state của limiter phải được phân phối.

**Q32. Backpressure là gì?**
**[SOURCE FACT]** Backpressure làm producer chậm lại hoặc reject work khi consumer không theo kịp. **[PROPOSED DESIGN]** Dùng bounded queue, rejection rõ ràng, blocking khi phù hợp hoặc dropping có tài liệu. **[GIẢ ĐỊNH MINH HỌA]** Producer 10.000 message/s và consumer 2.000 message/s sẽ tích lũy 8.000 message/s cho tới khi hết capacity hoặc retention.

**Q33. Vì sao 2PC thường là service boundary kém?**
**[SOURCE FACT]** Two-phase commit giữ resource ở trạng thái prepared trong khi coordinator và participant thống nhất, làm tăng coupling và rủi ro blocking. **[PROPOSED DESIGN]** Ưu tiên local transaction cộng saga và compensation, hoặc giữ dữ liệu trong một transactional boundary. Compensation phải durable và idempotent.

**Q34. Eventual consistency nghĩa gì với user?**
**[SOURCE FACT]** Replica có thể trả dữ liệu stale tạm thời và hội tụ sau khi write lan truyền. **[ANALYSIS]** Hãy nêu contract: read-your-writes, monotonic reads hoặc convergence window được tài liệu hóa. Eventual consistency là behavior user nhìn thấy, không đồng nghĩa với “sai”.

## Senior: Thiết kế và bảo vệ

**Q35. Thiết kế URL shortener.**
**[PROPOSED DESIGN]** Làm rõ redirect latency, availability, retention, abuse control và tỷ lệ read/write. Tạo key không collision, giữ app stateless, cache mapping nóng, chỉ shard durable store khi growth đo được yêu cầu. **[GIẢ ĐỊNH MINH HỌA]** 1 tỷ redirect/ngày tương đương khoảng 11,6k RPS trung bình; peak 30k RPS và cache hit 95% là giả định workload. Failure mode chính là hot-key miss, xử lý bằng single-flight và fallback có giới hạn.

**Q36. p99 tăng gấp ba sau deploy. Làm gì?**
**[ANALYSIS]** Tách request budget theo span, so sánh trace waterfall mới với baseline và tìm span có tail tăng. Kiểm tra synchronous dependency mới, query plan và N+1. Sửa đúng path rồi xác minh p99 từng span, thay vì kết luận chung là “hệ thống chậm”.

**Q37. Implement consistent hashing thế nào?**
**[PROPOSED DESIGN]** Hash physical node và virtual node lên một ring. Route key tới vị trí đầu tiên theo chiều kim đồng hồ và chỉ di chuyển range bị ảnh hưởng khi thêm node. Production design còn cần membership change, collision handling, migration và observability; lookup trên ring chưa đủ.

**Q38. Single-flight chống stampede thế nào?**
**[PROPOSED DESIGN]** Giữ một future đang chạy cho mỗi key. Miss đầu tiên load database; các miss đồng thời await cùng future. Xóa future khi hoàn thành, giới hạn wait và không cache failure như success. Kết hợp với TTL jitter.

**Q39. SLA 99,95% đòi hỏi gì?**
**[SOURCE FACT]** Availability 99,95% cho phép khoảng 26 phút unavailable trong một năm 365 ngày. **[ANALYSIS]** Phải phân bổ budget cho các dependency; nhân availability của component có thể cho composite thấp hơn. **[PROPOSED DESIGN]** Dùng redundancy, failover đã test và error budget. “Ba replica” hay “hai node mỗi zone” chỉ là lựa chọn minh họa, không phải guarantee.

**Q40. Active-active hay active-passive?**
**[ANALYSIS]** Active-passive đơn giản hóa quyền ghi nhưng có failover time và có thể mất write trong khoảng trống. Active-active tận dụng tốt hơn nhưng cần xử lý conflict. **[PROPOSED DESIGN]** Bắt đầu active-passive cho write-heavy path; nếu cần active-active, chia ownership không giao nhau hoặc định nghĩa conflict model và reconciliation.

**Q41. Thiết kế circuit breaker thế nào?**
**[PROPOSED DESIGN]** Theo dõi failure và latency trong một window, mở circuit khi vượt threshold, fail fast hoặc fallback an toàn, rồi cho phép probe giới hạn ở trạng thái half-open. Threshold và cooldown phụ thuộc workload. Cần thêm timeout và bulkhead; circuit breaker không tự tạo capacity.

```text
CLOSED -> OPEN -> HALF_OPEN -> CLOSED
             \--------failure--------/
```

**Q42. Observability nào là bắt buộc?**
**[PROPOSED DESIGN]** Instrument external call, error, queue lag, saturation và latency nhìn từ user. Dùng RED metrics theo endpoint, structured log có trace ID, trace xuyên service và alert theo symptom. **[GIẢ ĐỊNH MINH HỌA]** SLO 99,9% với target 200 ms và alert burn-rate 14x chỉ là ví dụ policy, không phải threshold chung.

**Q43. Distributed tracing hoạt động thế nào?**
**[SOURCE FACT]** Trace ID liên kết các span qua service và message boundary. **[PROPOSED DESIGN]** Propagate ID trong HTTP header và message metadata, ghi parentage cùng timing và sampling có chủ đích. Không tin trace ID do client gửi mà chưa validate:

```java
String traceId = tracer.startOrContinue(request.header("traceparent"));
MDC.put("traceId", traceId);
```

**Q44. Điều gì gãy trước ở scale 100x?**
**[ANALYSIS]** Giới hạn cứng đầu tiên thường là shared stateful dependency: write capacity của primary, connection pool, coordination hoặc hot partition. **[PROPOSED DESIGN]** Shard bằng key có chủ đích, đưa analytics khỏi transaction path, pre-aggregate khi hợp lệ và thiết kế lại cross-shard query. **[GIẢ ĐỊNH MINH HỌA]** Chuyển từ 10k lên 1M QPS và dùng 256 shard chỉ minh họa phép tính, không phải sizing recommendation.

**Q45. Chọn shard key thế nào?**
**[ANALYSIS]** Ưu tiên cardinality cao, phân bố đều và locality cho dữ liệu thường đọc cùng nhau. Kiểm tra hot tenant và resharding. Key đều trên toàn hệ thống vẫn có thể tạo hot shard cho một customer; có thể split key hoặc cấp capacity riêng, đổi lại query phải fan-out.

**Q46. Thiết kế notification system.**
**[PROPOSED DESIGN]** Phát event vào durable queue, fan-out theo recipient, lưu delivery state và gửi qua WebSocket hoặc push provider với rate limit, retry, dedupe và dead-letter path. **[GIẢ ĐỊNH MINH HỌA]** 1 triệu message/ngày khoảng 11,6 message/s trung bình; peak và provider limit phải được đo.

**Q47. Thiết kế chat với 1 triệu kết nối đồng thời.**
**[PROPOSED DESIGN]** Dùng connection tier cho WebSocket, broker partition theo `conversation_id` và history store có key theo cùng access pattern. **[GIẢ ĐỊNH MINH HỌA]** Một message mỗi 10 giây trên mỗi user concurrent tạo khoảng 100k message/s. Connection density, fan-out, broker limit và reconnect behavior cần load test.

**Q48. Implement money-moving saga thế nào?**
**[PROPOSED DESIGN]** Mỗi bước là local transaction, ghi state durable trước khi tiến hành và làm mọi compensation idempotent. Retry từ recovery table hoặc log. Nếu business không chấp nhận inconsistency tạm thời, giữ operation trong một transactional boundary thay vì che vấn đề bằng saga.

```text
create order -> charge payment -> reserve inventory
                                      failure -> refund -> cancel order
```

**Q49. Size Kafka partition thế nào?**
**[ANALYSIS]** Đo producer rate, message size, consumer processing rate, replication và recovery time. Ước lượng đầu tiên là `partitions >= peak rate / sustainable rate per partition`, sau đó thêm headroom vận hành. **[GIẢ ĐỊNH MINH HỌA]** 100k message/s ở mức 10k mỗi partition cần ít nhất 10 partition trước headroom. Ordering chỉ có trong một partition, không phải toàn cục.

**Q50. Bảo vệ design trước on-call thế nào?**
**[PROPOSED DESIGN]** Liệt kê failure mode có khả năng xảy ra, signal phát hiện, chính sách alert, runbook và recovery test. Các mục thường gồm cache stampede, pool exhaustion, mất region, consumer lag và deploy lỗi. Câu trả lời chưa đủ nếu chỉ gọi tên component mà không nói được điều gì page team và hành động nào an toàn:

```text
failure -> metric -> alert -> runbook -> recovery test
```

#### Tự kiểm tra

- [ ] Junior: Tôi giải thích được request path, scaling, state, cache, data store, queue, replication và sharding.
- [ ] Mid: Tôi lý luận được invalidation, stampede, capacity, idempotency, pool limit, retry, backpressure và lag.
- [ ] Senior: Tôi đề xuất được design end-to-end, nêu giả định, tìm bottleneck đầu tiên và bảo vệ failure handling bằng telemetry.
- [ ] Verification: Với mỗi câu, tôi nêu được requirement, trade-off và phép đo dùng để kiểm chứng design.
