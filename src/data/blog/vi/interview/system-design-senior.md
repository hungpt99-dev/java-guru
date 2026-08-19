---
title: "Ôn thi Java #7: System Design — Junior đến Senior"
description: "System design là phần tổng kết dành cho senior: một bài kiểm tra khả năng phán đoán trong 45 phút. Quy trình, ước lượng capacity, caching, CAP, scalability và observability."
pubDatetime: 2026-08-10T10:25:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - system-design
  - scalability
---

System design là buổi phỏng vấn không có đáp án duy nhất — chỉ có những trade-off có thể bảo vệ được. Junior gọi tên các component; senior đưa một bài toán từ yêu cầu mơ hồ đến thiết kế dựa trên số liệu và chỉ ra nơi nó sẽ gãy. Bài này đi từ "vẽ diagram" đến "đây là latency budget và failure tôi đang theo dõi" — gồm 50 câu hỏi; hãy chọn đúng level bạn đang phỏng vấn và đọc thêm một level cao hơn.

> Mindset: junior tạo ra một diagram; senior tạo ra một diagram _và_ latency budget, capacity estimate, cùng failure mode duy nhất có khả năng page họ lúc 2 giờ sáng cao nhất.

## Junior — Nền tảng

**Q1. Các building block chính của một web system là gì?**
Một stack điển hình là một pipeline, trong đó mỗi layer bổ sung một khả năng: LB dàn đều tải, cache hấp thụ các read, queue tách rời công việc chậm, còn DB nắm dữ liệu chuẩn. Hãy hiểu vai trò của từng block trước khi tranh luận về bất kỳ block nào:

```
Client ──> DNS ──> Load Balancer ──> App Servers ──> Cache (Redis)
                         │               │  │            │
                         │               │  └──> Message Queue ──> Workers
                         │               └──────> Database (primary ──> replicas)
                         └───────────────> CDN (tài nguyên tĩnh)
```

**Q2. Chuyện gì xảy ra khi bạn gõ một URL và nhấn Enter?**
DNS lookup → bắt tay TCP → bắt tay TLS → HTTP request → logic app → response. Mỗi bước đều tốn một khoảng thời gian đo được — DNS ~10–50 ms (nếu đã cache thì ~0 ms), RTT ~1–50 ms, TLS ~10–100 ms. Đây là latency budget đầu tiên của bạn: một request "nhanh" chủ yếu là chờ mạng, không phải chờ code:

```text
browser ──> DNS (10–50 ms) ──> bắt tay TCP (1 RTT) ──> TLS (1–2 RTT, ~10–100 ms)
        ──> HTTP req (RTT) ──> logic app (10–200 ms) ──> HTTP resp (RTT)
budget 200 ms: mạng ngốn ~60–80% trước khi code của bạn chạy
```

**Q3. Khác nhau giữa load balancing L4 và L7 là gì?**
L4 route theo port TCP/UDP — nhanh (~µs), không soi gói tin, không route theo URL. L7 route theo HTTP — chậm hơn (phải parse header, ~vài chục µs), nhưng route theo path, retry, và sticky session được:

```
L4:  Client ── TCP:443 ──> LB ──> bất kỳ node khỏe mạnh nào
L7:  Client ──> LB ── /api/*    ──> node api
                  └─ /static/*  ──> CDN origin
```

**Q4. Khác nhau giữa horizontal và vertical scaling là gì?**
Vertical = máy to hơn (nhiều CPU/RAM) — đơn giản nhưng bị chặn ở instance cloud lớn nhất và là SPOF. Horizontal = thêm node sau LB — không giới hạn cứng, nhưng đòi hỏi statelessness. Nếu một node làm ~500 RPS và bạn cần 10k QPS, vertical cần một máy 20× mà không tồn tại; horizontal cần ~20–25 node (có headroom):

```text
needed_nodes = target_rps / per_node_rps × (1 + headroom)
             = 10_000 / 500 × 1.25 ≈ 25 nodes
```

**Q5. Stateless nghĩa là gì, và tại sao nó quan trọng cho scaling?**
Server stateless không giữ bộ nhớ theo từng request — mỗi request tự mang đủ thứ nó cần, nên node nào cũng phục vụ được request nào. Session trong memory là vi phạm kinh điển; chuyển chúng sang shared store (Redis) hoặc client token là cách sửa:

```java
// SAI — trạng thái nằm trong instance, phải sticky session
session.put("cart", cart);

// ĐÚNG — trạng thái nằm ngoài instance; node nào cũng xử lý được request nào
String cartId = redis.set(cartJson);   // TTL 24h
```

**Q6. Cache-aside là gì, và khi nào nó vỡ?**
App kiểm tra cache trước; miss thì đọc DB, đổ vào cache, rồi trả về. Đơn giản và resilient (cache hỏng thì fallback về DB) nhưng bạn trả giá bằng cửa sổ stale và rủi ro stampede khi hot-key miss:

```java
String v = redis.get(key);
if (v == null) {
    v = db.query(key);              // miss: gọi DB
    redis.set(key, v, 60s);         // populate với TTL
}
return v;                           // hit rate ~95% trên hot key
```

**Q7. CDN là gì và khi nào bạn dùng nó?**
CDN cache tài nguyên tĩnh tại edge gần người dùng, cắt cả latency lẫn tải origin. Dùng cho mọi thứ tĩnh và read-heavy. Response động, theo từng user thì không cache được — đó là ranh giới:

```
user ở Hà Nội ──> edge node SG (5 ms) ──> cache hit, xong
origin ở Frankfurt (200 ms) chỉ bị đụng khi cache miss
```

**Q8. Khác nhau giữa SQL và NoSQL, trong một phút?**
SQL cho ACID, join, và schema mạnh — tốt nhất cho dữ liệu quan hệ mang tính giao dịch (tiền, đơn hàng). NoSQL đánh đổi guarantee lấy scale và schema linh hoạt — tốt nhất cho dữ liệu khối lượng lớn hoặc lỏng lẻo (session, time-series, graph). Chọn theo hình dạng dữ liệu và nhu cầu consistency, không theo mốt:

```text
order + tiền + join → SQL (ACID xuyên các dòng)
session, feed, metric, doc → NoSQL (scale-out, schema linh hoạt)
hybrid thắng cuộc: Redis cache + Postgres làm sự thật + column store cho analytics
```

**Q9. Database index là gì, và tại sao query chậm khi không có nó?**
Index là cấu trúc đã sắp xếp (B-tree) ánh xạ key → vị trí dòng, biến full table scan thành lookup log-time. Không có index, quét bảng 10M dòng mất ~1–5 s và đọc từng dòng; có index, lookup ~1–10 ms và chỉ đọc vài page. Index có giá — mỗi lần ghi phải cập nhật nó:

```text
không index:  SELECT * FROM orders WHERE user_id = 42 → quét toàn bộ 10M dòng ~1–5 s
có index: tra B-tree → ~1–10 ms (đọc vài page, không phải 10M dòng)
chi phí: mỗi INSERT/UPDATE giờ cũng phải ghi B-tree của index
```

**Q10. Message queue là gì, và nó giải quyết vấn đề gì?**
Queue đệm công việc giữa producer và consumer không theo kịp pace, tách rời chúng để consumer chậm hoặc crash không chặn producer — và nó làm phẳng spike: queue hấp thụ burst, consumer rút nước theo tốc độ của mình:

```
Producer (burst 10k req/s) ──> Queue ──> Consumer (rút 2k req/s)
                                     └──> retry + không drop, rút nốt sau spike
```

**Q11. CAP bằng lời đơn giản là gì?**
Bạn không thể có cả ba Consistency, Availability, và Partition tolerance — và partition (mạng bị chia cắt) là điều không tránh khỏi, nên thực tế bạn chọn giữa **CP** (tạm dừng ghi để giữ nhất quán) và **AP** (vẫn sống, chấp nhận đọc stale). Sổ cái thanh toán là CP; social feed là AP. Bẫy phỏng vấn là nói "chúng tôi có cả ba":

```text
         Consistency
            /\
           /  \
          /    \
         /  BẠN \
        /  chọn  \
       /   MỘT    \
Consistency─CP───AP─Availability
   (dừng ghi)  (đọc stale)
   ZooKeeper    Cassandra
   sổ cái       like-count
```

**Q12. Monolith vs microservices — cái nào tốt hơn?**
Monolith là một deployable; microservices là nhiều deployable nhỏ với các cuộc gọi mạng giữa chúng. Monolith thắng ở sự đơn giản và transaction; microservices thắng ở scale và deploy độc lập. Một team 3 người với monolith ở 10k QPS đánh bại team 20 người với 12 service ở 2k QPS. Senior thành thật nói: bắt đầu từ monolith, tách khi team và tải đủ lớn để biện minh:

```text
monolith:       một deployable, một DB → transaction cục bộ, deploy đơn giản
microservices:  nhiều deployable → scale/deploy độc lập, nhưng gọi mạng,
                transaction phân tán, và bề mặt vận hành gấp 3
rule of thumb: giữ monolith đến khi ranh giới team hoặc trục scale đòi tách
```

**Q13. Idempotency trong HTTP là gì, và tại sao `POST` cần được giúp đỡ?**
Một phép toán idempotent cho cùng kết quả dù gọi một lần hay mười lần — thiết yếu vì client retry khi timeout. `PUT` và `DELETE` vốn idempotent; `POST` thì không, nên nó cần idempotency key do client cung cấp:

```
Client ── POST /orders (key=abc-123) ──> Server
Retry  ── POST /orders (key=abc-123) ──> Server trả kết quả đã lưu, không trừ tiền 2 lần
```

**Q14. Reverse proxy là gì, và nó khác forward proxy thế nào?**
Forward proxy đứng trước client (che chúng); reverse proxy đứng trước server (che chúng) — nó kết thúc TLS, cân bằng tải, và phơi ra một endpoint duy nhất:

```
Forward:  client ──> proxy ──> internet
Reverse:  internet ──> LB/proxy ──> app1, app2, app3 (client không bao giờ thấy fleet)
```

**Q15. WebSocket vs HTTP long polling — khi nào chọn cái nào?**
HTTP request/response nghĩa là client phải poll để nhận cập nhật; WebSocket giữ một kết nối hai chiều, đẩy cập nhật tức thì. Long polling đơn giản và chạy được mọi nơi nhưng tốn một request cho mỗi event — dashboard cập nhật 1×/s từ 1k client là ~1k RPS polling. WebSocket giữ một kết nối mỗi client — tốt hơn cho chat, giá live, dashboard:

```
long polling: client ──req──> server (giữ mở tới khi có event) ──resp──> lặp lại
websocket:    client ══ một kết nối hai chiều ══> server (đẩy tức thì)
```

**Q16. Replication là gì, và nó cho bạn những gì?**
Replication copy các write từ primary sang replica, cho bạn scale đọc và failover. Với **3 replica** bạn sống sót khi mất một node mà vẫn phục vụ đọc; bạn trả giá bằng replication lag (điển hình <1 s trong cùng region) và đọc stale nếu đọc từ replica:

```
Primary (ghi) ──async──> Replica 1
                 └──────> Replica 2
                 └──────> Replica 3
ghi: 1 primary. đọc: dàn đều trên 3 replica (gấp 3× capacity đọc)
```

**Q17. Sharding là gì, và nó tốn của bạn những gì?**
Sharding chia dữ liệu qua các node theo một key, nhân write capacity — nhưng nó phá join, transaction, và global query. Chia **256 shard** cho ~256× headroom ghi, nhưng mỗi shard giờ là một database riêng với backup và capacity planning riêng. Shard muộn, shard có chủ đích, và chọn key trước khi bạn cần nó:

```text
hash(user_id) % 256 → shard 0..255, mỗi shard giữ 1/256 số dòng
mọi dòng của một order nằm trên cùng một shard → đọc luôn single-shard
```

## Mid — đánh đổi & cạm bẫy

**Q18. Cache invalidation — TTL vs write-through vs write-back, và race?**
**TTL** (tự hết hạn) đơn giản và cho phép stale ngắn. **Write-through** cập nhật cache và DB cùng lúc — luôn nhất quán, nhưng tăng gấp đôi write latency. **Write-back** ghi cache, flush sau — ghi nhanh nhất, nhưng crash thì mất dữ liệu chưa flush. Race: một read đang nạp dữ liệu cũ có thể xen vào một write, để cache sai tới khi TTL. Hầu hết team chấp nhận stale với TTL ngắn:

```java
db.save(order); redis.del(key);        // write-through: +1 round trip mỗi lần ghi
redis.set(key, order, 60);            // TTL: stale tối đa 60s, không cần phối hợp
// race: read miss → DB trả dòng cũ → write commit → cache giữ giá trị cũ
```

**Q19. Cache stampede là gì, và tại sao riêng TTL không cứu bạn?**
Khi một hot key hết hạn, 1k request đồng thời đều miss và đều đập vào DB — DB chịu tải 1k× cho cùng một giá trị duy nhất. TTL làm tệ hơn (mọi key hết hạn cùng lúc). Cách sửa: jitter TTL, single-flight từng key, hoặc refresh trước khi hết hạn. Một stampede trên một hot key ở 10k QPS có thể đưa DB từ p99 200 ms lên 2 s trong vài giây:

```java
// jitter: dàn lệch thời điểm hết hạn để cả đàn không hết hạn cùng lúc
redis.set(key, v, baseTtl + ThreadLocalRandom.current().nextInt(30));
```

**Q20. Ước lượng capacity cho 10k QPS thế nào?**
Back-of-envelope, layer yếu nhất trước. Một app node stateless xử lý ~500 RPS ở p99 < 200 ms (đo được, không đoán) → ~20 node + headroom → 25–30. Rồi kiểm tra DB: mỗi request có thể làm 2–3 query, và connection pool chặn throughput hiệu dụng:

```text
app nodes  = 10_000 / 500 × 1.25         ≈ 25
db queries = 10_000 × 2 mỗi request      = 20k QPS → 95% cache hit → ~1k QPS tới DB
cache      = hot set ~5% dữ liệu → hit rate ~95% → Redis 5–10 GB
```

**Q21. Khi nào SQL là đáp án sai, và khi nào NoSQL là bẫy?**
SQL sai khi bạn cần horizontal write scale với schema linh hoạt — clickstream 100k writes/s so với một Postgres primary ~5–10k writes/s. NoSQL là bẫy khi bạn có join thật và multi-row transaction — bạn sẽ tái hiện chúng một cách tệ hại. Chọn theo hình dạng dữ liệu: quan hệ + tiền → SQL; khối lượng lớn + lỏng lẻo + truy cập single-doc → NoSQL. Cả hai cùng lúc là hợp lệ — cache trong Redis, sự thật trong Postgres, analytics trong column store:

```text
clickstream 100k writes/s: SQL primary chặn ~5–10k writes/s → NoSQL/column store
order + invoice có join: NoSQL tái hiện join một cách tệ → giữ SQL
quyết định: shape + consistency trước, scale sau
```

**Q22. CAP trong thực tế — hệ thống nào là CP, hệ thống nào là AP?**
ZooKeeper/etcd là CP (chúng dừng ghi trong lúc split); Cassandra/Dynamo là AP (nhận ghi, reconcile sau, và bạn có thể đọc stale). Sổ cái là CP; "like count" là AP. Câu trả lời senior thêm phần chi phí: trong lúc partition, CP mất khả dụng (ngân hàng tạm dừng vài giây thì ổn, vài phút thì không), AP mất đảm bảo đúng đắn (like counter chính xác 99.5% là vô hình; số dư 99.5% thì không):

```text
system          | trong lúc partition       | giá của việc sai
ZooKeeper, etcd | CP: ghi bị tạm dừng       | vài giây mất khả dụng
Cassandra       | AP: ghi vẫn được nhận     | đọc stale, reconcile sau
sổ cái          | CP                        | tiền không bao giờ double-spend
like counter    | AP                        | chính xác 99.5% là vô hình
```

**Q23. Tại sao không shard theo `hash(key) % N`?**
Modulo sharding nghĩa là thêm một node là rehash gần như mọi thứ — đi từ 3 → 4 node re-map ~75% số key, và trong lúc migration, lookup miss. **Consistent hashing** ánh xạ key và node lên một vòng tròn nên thêm node chỉ di chuyển ~1/N số key (1/4 khi đi 3 → 4). Với **virtual node** (mỗi node vật lý sở hữu ~100–200 vị trí trên vòng) tải cũng được làm phẳng:

```
ring: [n1] [n2] [n3] [n1] [n3] [n2] ...   (virtual node)
thêm n4 → chỉ key có hash rơi vào slot của n4 di chuyển (~1/4 số key)
modulo 4 → 75% số key di chuyển
```

**Q24. At-least-once vs at-most-once vs exactly-once — cái nào bạn thực sự có được?**
Queue cho **at-least-once** mặc định (retry khi mất ack → trùng lặp). At-most-once loại trùng lặp nhưng có thể mất message. Exactly-once là marketing — bạn có được nó bằng cách làm consumer **idempotent** (dedupe theo message ID), không phải bằng phép màu. At-least-once + consumer idempotent là tổ hợp duy nhất lành mạnh trong production:

```text
producer ──> queue (retry) ──> consumer xử lý message hai lần
consumer dedupe theo msgId trong DB → hiệu ứng exactly-once, không side-effect kép
```

**Q25. Implement idempotency trong một API thật thế nào?**
Client gửi header `Idempotency-Key`; server lưu response đầu tiên key theo nó và trả kết quả đã lưu khi retry. Phần atomic mới quan trọng — check-then-insert phải là một write có unique-constraint duy nhất, nếu không hai request đồng thời sẽ cùng thực thi:

```java
String key = req.getHeader("Idempotency-Key");
Order existing = orders.findByKey(key);
if (existing != null) return existing;        // replay: trả kết quả đã lưu
Order order = orderService.create(cart);       // lần chạy đầu
orders.insertWithKey(order, key);              // UNIQUE(key) → insert lần 2 ném exception
```

**Q26. Size connection pool của database thế nào?**
Kích thước pool đi theo concurrency, không theo request rate: `pool ≈ desired_concurrency × (avg_query_ms / target_latency_ms)`. Ở 10k QPS với query trung bình 5 ms và budget 200 ms, ~50 query đang in-flight trên mỗi node — pool 10–20 mỗi node là thừa đủ. Nhiều connection hơn không phải nhanh hơn: mỗi Postgres connection tốn ~1–10 MB và CPU, và vượt ~cores×2 thì chỉ thêm tranh chấp:

```text
in-flight queries = 10_000 req/s × 0.005 s = 50 trên toàn fleet
pool mỗi node     = 50 / 25 nodes ≈ 2–4 tối thiểu, 10–20 cho headroom
```

**Q27. N+1 query problem là gì, và sửa nó thế nào?**
Loop qua N dòng cha và fetch con từng dòng phát sinh 1 + N query — 1k order thành 1.001 query và p99 nổ tung. Sửa bằng một query `IN`/join duy nhất hoặc batch fetching:

```java
// SAI: 1 + N query
for (Order o : orders) { customers.get(o.customerId); }   // 1_001 query

// ĐÚNG: tổng cộng 2 query
Map<Long, Customer> byId = customers.getByIds(orders.stream()
        .map(Order::customerId).toList());                 // 2 query
```

**Q28. Khi nào index gây hại nhiều hơn lợi?**
Mỗi index nhân chi phí ghi — một insert phải cập nhật table cộng mọi index (mỗi cái là một B-tree write). Trên table nặng ghi, 5 index thêm có thể cắt write throughput một nửa, và một table 1 GB với index nặng có thể chiếm 2–3 GB đĩa. Luật: index những gì read của bạn filter, kiểm chứng bằng `EXPLAIN`, và bỏ index không dùng:

```text
tối ưu đọc:  1 index → lookup 1 ms vs quét toàn bộ 2 s (gấp 2.000×)
tối ưu ghi:  5 index → mỗi insert trả 6 lần ghi B-tree, không phải 1
```

**Q29. Read replica — điều gì vỡ khi bạn thêm chúng?**
Replica scale đọc nhưng mang theo replication lag (bất đồng bộ; điển hình <1 s, vài giây khi tải nặng). User vừa ghi vừa đọc có thể đập vào replica chưa thấy write — "read-your-writes" vỡ. Cách sửa: route các read của chính user về primary (hoặc thêm read-after-write delay), và chấp nhận lag cho mọi thứ còn lại:

```
ghi ──> primary ──async (lag 100 ms–2 s)──> replica
user đọc order của chính mình từ replica → stale/404 trong khoảng lag
fix: đọc của chính mình → primary; đọc của người khác → replica
```

**Q30. Timeout, retry, backoff — làm sao không giết chết service của bạn?**
Mọi downstream call cần timeout (timeout mặc định 10 s trên SLA 5 s là một bug), retry với exponential backoff + jitter, và một cap ngân sách retry. Không có jitter, các retry đồng bộ hóa thành một cơn bão retry quật ngã downstream mà bạn đang cố cứu:

```java
int attempts = 0;
while (attempts < 3) {
    try { return client.call(req); }
    catch (TimeoutException e) {
        long wait = Math.min(1000L << attempts, 4000L);              // 1s, 2s, 4s
        Thread.sleep(wait + ThreadLocalRandom.current().nextLong(200)); // +jitter
        attempts++;
    }
}
```

**Q31. Token-bucket rate limiter hoạt động thế nào, và nó sống ở đâu?**
Token nạp lại với tốc độ cố định (vd 100 token/s) và mỗi request tiêu một token; burst tới mức bucket size thì qua, sustained rate thì bị chặn. Đặt nó ở edge (API gateway/LB) để bảo vệ cả fleet, và thêm một tầng per-tenant để một khách ồn ào không bỏ đói mọi người. Thuật toán O(1) mỗi request:

```java
class TokenBucket {
    private final double rate;                   // token mỗi giây
    private final long capacity;
    private double tokens;
    private long lastRefill = nowNanos();

    boolean tryAcquire() {
        tokens = Math.min(capacity, tokens + (nowNanos() - lastRefill) / 1e9 * rate);
        lastRefill = nowNanos();
        if (tokens < 1) return false;
        tokens -= 1;
        return true;
    }
}
```

**Q32. Backpressure là gì, và điều gì xảy ra nếu không có nó?**
Backpressure là hệ thống bảo producer "chậm lại" — không thì queue phình, memory phình, và JVM chết vì OOM, hoặc consumer liên tục bị quá tải và cascade failure. Lựa chọn: bounded queue với rejection, chặn producer, hoặc drop cái cũ nhất. Một unbounded queue ở 10k req/s với consumer 2k req/s phình ~8k message/s cho tới khi heap chết:

```java
new ThreadPoolExecutor(core, max, keepAlive, SECONDS,
        new ArrayBlockingQueue<>(1000),           // GIỚI HẠN: backpressure
        new AbortPolicy());                       // reject → 503, không OOM
```

**Q33. Distributed transaction — tại sao 2PC là bẫy, và dùng gì thay thế?**
Two-phase commit khóa tài nguyên xuyên các service trong suốt quá trình — coordinator thành SPOF và một participant chậm kẹt cả hệ thống. Thay thế là **saga pattern**: một chuỗi transaction cục bộ kèm hành động bù trừ. Câu trả lời senior: đừng thực hiện giao dịch tiền xuyên service trong một transaction — thiết kế lại đường cắt hoặc chấp nhận eventual consistency:

```text
2PC:  order ──prepare──> payment ──prepare──> inventory (tất cả commit hoặc tất cả abort, bị khóa)
saga: createOrder ✓ → chargePayment ✓ → reserveInventory ✗ → refundPayment (bù trừ)
```

**Q34. Eventual consistency — nó thực sự nghĩa gì cho user của bạn?**
Sau khi một write dừng, mọi replica hội tụ — nhưng ở giữa, read có thể stale. Hợp đồng thực dụng là read-your-writes (write của chính bạn thì thấy), monotonic read, và "hội tụ trong vài giây". Eventual consistency không phải "đôi khi sai mãi mãi" — nó là "stale ngắn, rồi đúng, và đây là cách reconcile":

```text
ghi ──> primary ──> replicas (cuối cùng hội tụ, điển hình <1 s)
user đọc stale trong ~lag, rồi đúng — không bao giờ lệch vĩnh viễn
```

## Senior — thiết kế & bảo vệ

**Q35. Thiết kế một URL shortener cho 100M URL và 1B redirect/ngày. Đi qua.**
"Yêu cầu trước: redirect <50 ms và highly available; read lấn write ~100:1. 1B redirect / 86400 s ≈ **11.5k RPS** trung bình với spike tới ~30k. Base62-encode một counter hoặc hash thành key 7 ký tự. Hot key nằm trong Redis — hầu hết traffic chạm ~5% số link, nên **cache hit ~95%** — tầng app stateless sau LB, và DB shard theo key prefix. Failure tôi canh: một link bỗng viral làm stampede cache → single-flight từng key khi miss:

```text
Client ──> LB ──> redirect service (stateless ×N)
├──> Redis (hit ~95%, ~1 ms)
└──> DB shard khi miss (shard theo key, 3 replica)
1B/86400 ≈ 11.5k RPS → ~25 node @ ~500 RPS, Redis cluster ~5–10 GB
```

**Q36. p99 latency của một service gấp ba sau một deploy. Tìm nguyên nhân với budget.**
"Tôi tách budget: LB → TLS → app → cache (1–2 ms) → DB (5–15 ms) → downstream. Tôi so sánh waterfall trace mới với baseline và tìm span đã phình — p99 gấp ba gần như luôn nghĩa là một dependency đồng bộ mới hoặc một N+1 query (50 DB call thay vì 1). Fix: batch các call, đẩy dependency ra khỏi critical path, hoặc cache. Tôi chứng minh bằng p99 từng span trước/sau — span phạm lỗi là span phình ra, không phải "hệ thống chậm":

```text
span budget: LB 5 ms → TLS 20 ms → app 80 ms → cache 2 ms → DB 10 ms
sau deploy: span DB 10 ms → 60 ms (6×) ← một query thiếu index, thấy ngay trong một trace
```

**Q37. Implement consistent hashing với virtual node.**
"Mỗi node vật lý sở hữu ~100–200 vị trí ảo trên vòng 2^32; một key đi tới node đầu tiên theo chiều kim đồng hồ. Thêm node chỉ di dời các key rơi vào slot mới của nó (~1/N số key), so với ~75% của modulo. Với **256 shard vật lý** tôi bỏ qua virtual node (độ mịn đã đủ); với 8 node dưới tải không đều, virtual node giúp cân bằng lại:

```java
class ConsistentHash {
    private final TreeMap<Integer, String> ring = new TreeMap<>();

    void addNode(String node, int vnodes) {
        for (int i = 0; i < vnodes; i++) {
            int h = hash(node + "#" + i);        // vị trí ảo trên ring
            ring.put(h, node);
        }
    }
    String get(String key) {
        var e = ring.ceilingEntry(hash(key));     // node tiếp theo theo chiều kim đồng hồ
        return (e != null ? e : ring.firstEntry()).getValue();
    }
}
```

**Q38. Phòng thủ cache stampede với single-flight thế nào?**
"Khi một hot key miss, chỉ một request nên đập vào DB; số còn lại chờ request đầu. Một `ConcurrentHashMap<String, CompletableFuture>` từng key cho bạn điều đó — khi miss, tạo future; mọi người khác await nó. Kết hợp TTL 60 s, DB chỉ thấy ~1 query mỗi key mỗi cửa sổ TTL thay vì 10k:

```java
CompletableFuture<V> f = inflight.computeIfAbsent(key,
        k -> supplyAsync(() -> db.query(key))        // MỘT lần gọi DB
                .whenComplete((v, t) -> inflight.remove(key)));
return f.get(200, MILLISECONDS);                     // 9.999 request còn lại chờ nó
```

**Q39. Thiết kế cho SLA 99.95% — con số đó thực sự đòi hỏi gì?**
"99.95% cho phép **26 phút downtime một năm** — khoảng 4 phút một tháng. Một region đơn lẻ thường cho 99.9–99.99% mỗi component, và chuỗi nhân với nhau: 0.999 × 0.999 × 0.999 ≈ 99.7%. Vậy con số quyết định kiến trúc: 99.95% buộc redundancy ở mọi layer — **3 replica** DB, ≥2 app node mỗi AZ, kế hoạch failover cross-region — và game day chứng minh nó:

```text
single server:      99.9%  → 8.8 h/năm downtime
app + DB pair:      99.99% → 52 phút/năm
+ cross-region:     99.95% → 26 phút/năm ← budget mục tiêu
```

**Q40. Active-active vs active-passive xuyên region — và rủi ro split-brain?**
"Active-passive đơn giản: một region phục vụ, region kia failover — bạn trả thời gian failover và mất write trong khoảng trống. Active-active phục vụ cả hai nhưng rủi ro split-brain khi ghi — hai region cùng nhận write cho cùng một key. Pattern an toàn: mỗi region sở hữu một dải shard rời nhau, và read eventual xuyên region. Tôi bắt đầu active-passive và chỉ active-active cho read path:

```text
active-passive: region A phục vụ (99.95%), B standby (RTO ~phút)
active-active:  A sở hữu key 0–127, B sở hữu 128–255 → không xung đột ghi
cả hai: replication bất đồng bộ; failure tôi canh: lag + đọc stale
```

**Q41. Thiết kế circuit breaker cho một dependency đang hỏng.**
"Đếm failure gần đây; vượt ngưỡng (vd **>50% failure trong cửa sổ 10 s**), mở circuit — request fail nhanh (hoặc trả fallback) mà không chạm dependency, cho nó thời gian hồi phục. Half-open sau cooldown để thử bằng một request. `Resilience4j` hoặc state machine tự viết — state machine mới là câu trả lời phỏng vấn:

```text
CLOSED (bình thường) ── failure > 50% trong 10 s ──> OPEN (fail nhanh, ~30 s)
OPEN ── hết cooldown ──> HALF_OPEN (1 lần thử)
HALF_OPEN ── thử thành công ──> CLOSED    |    thử thất bại ──> OPEN
```

**Q42. Observability nào là non-negotiable cho một hệ thống bạn giao cho on-call?**
"Ba trụ cột, nhưng phần non-negotiable: mọi external call được đo thời gian và gắn tag, mọi error đếm được, và alert trên _symptom_ (error rate/latency nhìn từ user), không phải cause (CPU). RED metrics — rate, errors, duration — với SLO và burn-rate alerting. Nếu p99 > 200 ms trên 2% traffic đốt error budget nhanh hơn 14× so với dự trù trong 5 phút, hãy page tôi. Phép tính alert là burn, không phải threshold:

```text
SLO: 99.9% request với p99 < 200 ms trong 30 ngày
alert khi: budget cháy ở tốc độ 14× trong 5 phút → page
logs: structured, key theo traceId; metrics: RED từng endpoint; traces: mọi span
```

**Q43. Distributed tracing hoạt động end-to-end thế nào?**
"Một trace ID được sinh ra ở edge và lan qua mọi hop — header trên HTTP, key trên message. Mỗi service phát span (name, start, duration, parent); collector gom chúng theo trace ID, và công cụ tìm kiếm dựng lại waterfall. Không có nó, một request 2 s là một bức tường "ai mà biết" — có nó, span chậm chỉ một cú click:

```java
MDC.put("traceId", request.getHeader("X-Trace-Id"));
// mọi dòng log giờ mang traceId, nối được với span
response.setHeader("X-Trace-Id", traceId);   // user dán nó vào bug report
```

**Q44. Interviewer nói 'giờ làm nó lớn gấp 100 lần.' Cái gì gãy trước?**
"DB quan hệ — connection pool cạn và write throughput bị chặn; 10k → 1M QPS không thể ngồi trên một primary. Nên: shard theo tenant/user key qua **256 shard**, đẩy read sang replica, chuyển analytics ra khỏi primary. Tầng app scale ngang — nó stateless. Thứ _thực sự_ gãy là coordination: cross-shard transaction, global query, và hot shard (một tenant chiếm 40% traffic). Những thứ đó buộc thiết kế lại data model — denormalize, pre-aggregate, chấp nhận eventual consistency từng shard:

```text
10k QPS: Postgres primary + replicas + Redis
1M QPS:  256 shard (≈3.9k QPS mỗi shard) + tầng cache + analytics pre-aggregated
gãy đầu tiên: primary đơn lẻ; thứ hai: giả định join/global-query
```

**Q45. Chọn shard key thế nào, và điều gì xảy ra khi chọn sai?**
"Key tồi tạo hot shard — một tenant đập shard 7 trong khi 254 cái ngồi không. Luật: cardinality cao, phân bố đều, và xếp chung các dòng bạn đọc cùng nhau (shard order theo `customer_id` để dữ liệu một khách nằm trên một shard). Với **256 shard** ở 10k QPS, tải mỗi shard ~39 QPS — cho tới khi một tenant nóng đập 5k QPS vào shard duy nhất của nó. Giảm nhẹ: tách hot key (`tenant_1a/1b/1c`) hoặc cấp shard riêng cho tenant:

```text
shard = hash(customer_id) % 256        // đều với tenant bình thường
tenant nóng: 5k QPS → shard 7 bão hòa → tách key: c_7_a, c_7_b, c_7_c
đánh đổi: query theo tenant giờ fan-out sang 3 shard
```

**Q46. Thiết kế một notification system gửi 1M message/ngày.**
"Write path: service phát event vào queue; dispatcher fan-out theo từng recipient và lưu trạng thái từng user. Read path: app kiểm tra inbox trong app (DB) và push qua WebSocket/APNs. 1M message/ngày ≈ **11.6 msg/s** trung bình, đỉnh ~100/s — nhẹ nhàng với Kafka. Con số thú vị nằm ở provider: APNs/FCM bóp ~2k–5k msg/s mỗi connection, nên rate-limit từng provider và gộp device token:

```text
service ──> Kafka (burst 100k msg/phút) ──> dispatcher ──> inbox trong app (DB)
                                        └──────> APNs/FCM (rate-limited, retried)
dedupe theo messageId; lưu trạng thái gửi; dead-letter cái không gửi được
```

**Q47. Thiết kế chat system cho 10M user với 1M concurrent.**
"Tầng kết nối: WebSocket server giữ ~50k–100k kết nối mỗi cái → ~10–20 node cho 1M concurrent. Message đi tới broker (Redis pub/sub hoặc Kafka) fan-out tới các connection server của thành viên mỗi phòng; history nằm trong store đã shard key theo `conversation_id`. 1M concurrent × 1 msg/10 s ≈ **100k msg/s** — broker phải partition theo conversation để không partition nào vượt ~10k msg/s:

```text
1M kết nối / 50k mỗi node ≈ 20 node
user ──> conn node ──> broker (partition theo conversation_id)
                    └──> mọi conn node đang giữ thành viên phòng
history: shard theo conversation_id; unread count: Redis + flush định kỳ
```

**Q48. Implement một saga — giữ tiền nhất quán xuyên các service thế nào?**
"Mỗi bước là một transaction cục bộ kèm hành động bù trừ; failure kích hoạt rollback theo thứ tự ngược. Bù trừ phải idempotent và durable — một saga thất bại retry qua recovery table, không phải bằng hy vọng. Với tiền tôi không bao giờ dùng 2PC xuyên service; compensation log của saga là nguồn sự thật:

```java
try {
    orderService.create(order);        // bước 1
    paymentService.charge(order);      // bước 2
    inventoryService.reserve(order);   // bước 3
} catch (ReservationFailed e) {
    paymentService.refund(order);      // bù trừ bước 2 (idempotent)
    orderService.cancel(order);        // bù trừ bước 1
}
// mỗi bù trừ được ghi vào saga log trước khi chạy → retry an toàn khi crash
```

**Q49. Size Kafka partition cho 100k msg/s thế nào?**
"Throughput mỗi partition bị chặn bởi consumer chậm nhất trong group của nó — một consumer xử lý JSON có lẽ làm 5–20k msg/s mỗi instance. 100k msg/s với 10k msg/s mỗi partition → ≥10 partition, và tôi nhân đôi cho headroom và rebalancing. Luật: partitions ≥ peak_rate / per-partition_throughput, và một partition cho mỗi processing in-flight:

```text
needed = 100_000 msg/s ÷ 10_000 msg/s mỗi partition = 10 partition → chạy 20
replication: 3 bản sao mỗi partition (2 broker hỏng, không mất dữ liệu)
ordering: chỉ trong một partition — order theo key = user_id, không phải toàn cục
```

**Q50. Thiết kế một hệ thống bạn đang vận hành — điều gì page bạn lúc 2 giờ sáng, và bạn phòng thủ nó thế nào?**
"Phòng thủ là một danh sách đánh số các failure mode đã biết, mỗi cái kèm detection và response: (1) cache stampede trên key viral → single-flight + jitter, alert theo miss-rate; (2) DB connection pool cạn → bounded pool + read replica, alert theo thời gian chờ pool; (3) mất region → failover <5 phút trong budget 99.95%, đã game-day test; (4) consumer chậm làm đầy queue → backpressure + dead-letter, alert theo lag; (5) deploy hỏng → canary + rollback trong vài phút. Nếu tôi không nói được failure nào sẽ page tôi, thiết kế chưa xong:

```text
failure → detection (metric) → alert (burn) → response (runbook) → recovery
p99 > 200 ms trong 5 phút → page on-call → trace tới span → rollback/fix cache
con số tôi bảo vệ: SLO 99.95%, error budget 26 phút/năm, burn-rate paging
```

#### Self-check

- [ ] Junior: Tôi vẽ được các building block, giải thích L4 vs L7, horizontal vs vertical scaling, statelessness, cache-aside, CDN, replication, và sharding — mỗi cái kèm con số làm nó đáng nói.
- [ ] Mid: Tôi lý luận được cache invalidation và stampede, size capacity từ 10k QPS back-of-envelope, giải thích consistent hashing vs modulo, implement idempotency và rate limiting, và xử lý backpressure, retry, và replication lag.
- [ ] Senior: Tôi thiết kế được URL shortener end-to-end với latency budget và phòng thủ stampede, chẩn đoán p99 regression từ trace, đạt SLA 99.95% với 3 replica và failover, chọn shard key xuyên 256 shard, và chọn saga thay vì 2PC.
- [ ] Senior: Tôi nêu được cái gãy đầu tiên ở scale 100×, size Kafka partition từ RPS, và phòng thủ năm failure mode page tôi lúc 2 giờ sáng kèm metric kích hoạt từng cái.
- [ ] Verification: Tôi trả lời được bất kỳ câu nào trong 50 câu với diagram hoặc code block và ít nhất một con số cụ thể — QPS, p99, hit rate, số shard, hoặc SLA.
