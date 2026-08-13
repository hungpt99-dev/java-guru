---
title: "Phỏng vấn Senior Java: System Design"
description: "System design là bài capstone của senior — test tư duy 45 phút. Quy trình, ước lượng capacity, caching, CAP, scalability, và observability."
pubDatetime: 2026-08-10T10:25:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - system-design
  - scalability
---

System design là phần phỏng vấn duy nhất mà code bạn từng viết không còn ý nghĩa — thứ được đem ra soi là phán đoán bạn tích lũy được. Đó là một dự án xây dựng kéo dài 45–60 phút trình diễn trước khán giả trực tiếp: yêu cầu mơ hồ, con số mù mờ, và mỗi quyết định đều có giá phải trả. Phỏng vấn viên không tìm "kiến trúc đúng" — không có kiến trúc đúng. Họ tìm cách bạn nghĩ khi căn phòng đầy bất định.

Junior vẽ ô vuông. Senior kể chuyện tradeoff: "Tôi cache 1% key nóng trong Redis vì chúng phục vụ 99% số reads, và tôi chấp nhận stale tới 60 giây trên write path vì business chịu được — và đây là incident dạy tôi rằng cache ngây thơ chính là nơi ẩn náu của outage." Vế cuối cùng đó là toàn bộ trò chơi. Mỗi phần dưới đây kết thúc bằng bài drill phỏng vấn viên thực sự chạy.

> Tư duy: nhả ra một diagram thì bạn chỉ ở tầm mid-level. Đi qua một tradeoff bằng số thật và một failure mode ngoài production, và bạn chạm được ô "senior". Bạn không cần thiết kế Twitter — bạn cần thiết kế đúng phần của Twitter sẽ gãy đầu tiên, và nói to điều đó ra.

## Thang câu hỏi phỏng vấn (Junior → Mid → Senior)

> Tự drill to tiếng. Junior = "bạn có biết khái niệm"; Mid = "bạn có biết tradeoff"; Senior = "bạn có thể bảo vệ quyết định dưới áp lực, kèm một con số và một postmortem."

### Junior — nền tảng

- **Q: Các bước của một câu trả lời system-design?**
  A: Làm rõ yêu cầu (functional + non-functional: scale, latency, consistency) → ước lượng capacity → phác họa component cấp cao → đào sâu 1-2 phần khó nhất → nêu failure mode. Interviewer chấm _hình dạng_ tư duy, không phải diagram "đúng".

- **Q: Khác nhau giữa latency và throughput?**
  A: Latency = thời gian cho một request (ms); throughput = bao nhiêu request mỗi giây (req/s). Một hệ có thể latency thấp nhưng throughput thấp (single-threaded) hoặc throughput cao nhưng tail latency cao (một queue). Bạn tối ưu chúng bằng các đòn bẩy khác nhau.

- **Q: Cache là gì và tại sao dùng?**
  A: Một store nhanh (RAM) giữ kết quả của việc tính toán đắt đỏ (DB query, compute) nên read lặp rẻ. Điểm: hầu hết read traffic đánh vào một hot set nhỏ, nên cache biến một path bound-DB thành path memory (micro-giây vs milli-giây).

- **Q: SQL vs NoSQL — khi nào chọn cái nào?**
  A: Relational khi cần ACID + join + query linh hoạt trên data có cấu trúc. NoSQL (document/columnar/KV) khi cần horizontal scale trên một access pattern đơn giản (single-key lookup, write volume lớn). Chọn bằng _access pattern_, không phải hype.

- **Q: Khác nhau giữa horizontal và vertical scaling?**
  A: Vertical = box to hơn (thêm CPU/RAM, gặp trần, downtime để resize). Horizontal = nhiều box sau một load balancer (gần không giới hạn, cần statelessness + shared storage). Mặc định senior cho service stateless là horizontal.

### Mid — tradeoff & bẫy

- **Q: Cache aside vs write-through — khi nào dùng cái nào?**
  A: Cache-aside (app read cache, miss thì load DB và populate): đơn giản, xử lý cold cache đẹp, nhưng một miss có thể stampede. Write-through (write đi vào cache + DB cùng lúc): read luôn nhanh, nhưng mọi write trả giá cache cost. Bẫy: chọn một cái mà không nêu write/read ratio của workload.

- **Q: "Stale 60 giây là ổn." Giờ thiết kế cache invalidation.**
  A: TTL-based (expire sau 60 s) đơn giản nhất; event-based invalidation (khi write, purge key) tươi hơn nhưng cần một event tin cậy. Senior nêu _stale-read window_ business chấp nhận và thiết kế tới nó — và biết "cache invalidation" là bài toán khó kinh điển vì delete đua với write.

- **Q: CAP theorem — chọn hai, và thực sự nghĩa là gì?**
  A: Dưới một network partition bạn đánh đổi Consistency (mọi node thấy cùng data) lấy Availability (mọi request có response). CP systems (vd strongly-consistent DBs) reject trong partition; AP systems (vd Dynamo-style) phục vụ stale-but-present. "Chọn hai" thực sự là "bạn hy sinh gì _trong lúc partition_".

- **Q: Bạn sẽ shard một bảng user 10 TB thế nào?**
  A: Bằng một shard key (hash user_id) để mỗi shard sở hữu một range key và query nằm single-shard. Bẫy: một key tệ (signup-date) tạo hot shard; một join cross-shard thành scatter-gather. Nêu key, kế hoạch reshard, và cross-shard query bạn sẽ tránh.

- **Q: Gì gãy đầu tiên ở 10× traffic — và biết trước khi xảy ra thế nào?**
  A: Thường là một shared resource duy nhất: một DB, một cache, một downstream. Bạn không đoán — bạn load-test để tìm cái knee, và thêm circuit breaker + backpressure để một dependency chậm degrade nhẹ thay vì cascade. Nêu _một_ resource bạn sẽ canh.

### Senior — thiết kế & bảo vệ

- **Q: Thiết kế một URL shortener cho 100M link mới/ngày, 1B read/ngày. Size nó.**
  A: Writes ~1,2k/s, reads ~11,5k/s. Một key 7-char base62 = ~3,5 nghìn tỷ combo — dư sức. Storage: 1B link × ~500 B = 500 GB + replica. Reads áp đảo, nên cache 1% nóng trong Redis (phục vụ ~99% reads). Cách của senior là nêu bottleneck (read path) và giải quyết _cái đó_, không over-build.

- **Q: Một cache stampede vừa làm đổ DB của bạn trên một hot key. Đi vụ đó và cách sửa.**
  A: Một hot key expire; 10k request cùng miss, cùng đánh DB, nó ngã. Sửa: request coalescing (single-flight — một request load, những cái khác chờ), jittered TTL (key không cùng expire một lúc), và một hot-key local cache. Postmortem: miss path, không phải cache, là nguy hiểm.

- **Q: Thiết kế cho "99,99% available" — thực sự tốn gì?**
  A: 99,99% = ~52 phút downtime/năm. Nó ép multi-AZ (một AZ chết, bạn sống), không single point of failure, và automated failover. Trade-off: 99,99% tốn nhiều hơn 99,9% (redundancy, runbook, game-day). Judgment senior: price cái SLA và để business chọn, đừng gold-plate mặc định.

- **Q: Bạn cần strongly-consistent cross-region writes. Bảo vệ thiết kế.**
  A: Đắt: synchronous replication xuyên region thêm inter-region latency (hàng chục ms) vào mọi write, và một partition nghĩa là unavailability. Câu trả lời senior thường là "đừng" — giữ authoritative write ở một region, replicate async cho read, và chỉ trả giá consistency cho những record cụ thể cần nó (vd balance), không phải whole system.

- **Q: "Cache ngây thơ là nơi ẩn náu của outage." Cho một ví dụ cụ thể.**
  A: Một cache cache cả _error_ hoặc _empty result_ — một DB hiccup ngắn giờ phục vụ "not found" 60 s, nên user thấy data thiếu ngay cả khi DB đã hồi phục. Hoặc một cache trả giá stale trong flash sale và oversell. Thiết kế senior coi cache như một _bản copy có freshness contract_, không phải source of truth, và test stale window rõ ràng.

#### Tự kiểm tra

- [ ] Junior: các bước của một câu trả lời design, latency vs throughput, cache là gì, SQL vs NoSQL, horizontal vs vertical scaling.
- [ ] Mid: cache-aside vs write-through, thiết kế invalidation tới một staleness SLA, CAP dưới partition, chọn shard-key + reshard, tìm resource gãy đầu tiên.
- [ ] Senior: size một URL shortener end-to-end, kể + sửa một cache stampede, price một SLA 99,99%, bảo vệ cross-region consistency (thường "đừng"), chỉ mặt chỗ ẩn náu của cache-outage.

## 1. Vòng lặp phỏng vấn — họ thực sự chấm điểm cái gì

Vòng lặp trông như năm bước tuần tự. Đúng vậy, nhưng thứ tự đó chỉ là ngụy trang — bảng điểm được điền trong mười giây đầu của mỗi bước.

1. **Làm rõ yêu cầu & scope.** QPS? read vs write? latency budget? data size? consistency vs availability? Dấu hiệu của senior: bạn không hỏi "bao nhiêu user" — đó là dân số, không phải tải. Bạn hỏi những câu _lộ ra_ tải: "bao nhiêu request mỗi giây, tỷ lệ peak-to-average là bao nhiêu, tỷ lệ read/write ra sao, và chuyện gì xảy ra khi một read bị stale?" "10M user" không nói cho bạn biết service cần một node hay năm mươi node.
2. **Ước lượng capacity tầm bậy.** "10M user × 100 read/user/ngày = 1B read/ngày ≈ 11.5k QPS." Con số chấm dứt việc vung tay. Senior làm tròn mạnh tay, kiểm tra chéo với một mốc biết trước (một instance đơn phục vụ ~1–10k JSON request đơn giản/s; một Postgres single-writer ghi vài nghìn writes/s), và nói "trong một bậc độ lớn" thay vì giả vờ chính xác.
3. **Component cao cấp.** Clients → CDN → load balancer → API gateway → services → cache → DB → async workers/queues. Thứ tự ít quan trọng hơn câu chuyện bạn kể về từng hop: nó làm gì, tốn bao nhiêu, để làm gì.
4. **Đào sâu một hoặc hai chỗ.** Đây là nơi cuộc phỏng vấn thực sự diễn ra. Chọn hai quyết định có hậu quả thật — hợp đồng consistency của cache, sharding key, độ sâu queue — rồi đi sâu vào nội tại.
5. **Xử lý failure.** Cái gì gãy trước? Làm sao degrade? Senior tự nguyện nêu điều này mà không cần được hỏi, vì "nó chạy cho đến khi nó không chạy nữa" chính là định nghĩa của một hệ thống production.

Bảng điểm, theo thứ tự phỏng vấn viên điền: Họ có hỏi câu làm rõ trước khi thiết kế không? Họ có làm toán, hay bỏ qua? Họ có nêu tên tradeoff, hay đọc thuộc "best practice"? Họ có nhắc tới failure mode mà không được hỏi? Họ có biết lúc nào nên dừng thiết kế?

> Drill: "Design Twitter." Phỏng vấn không bắt đầu khi bạn vẽ ô vuông. Nó bắt đầu khi bạn hỏi "timeline này nặng read hay nặng write?" — và sự im lặng trước câu hỏi đầu tiên của bạn là một datapoint. Senior bắt đầu đặt câu hỏi ngay lập tức, vì câu hỏi đầu tiên chính là câu quyết định 40 phút còn lại là một buổi thiết kế hay một bài độc thoại.

## 2. Ước lượng capacity — phép toán tách kỹ sư khỏi kẻ vẽ diagram

Toán tầm bậy là bộ lọc chống-bullshit của phỏng vấn. Không ai mong một con số chính xác; ai cũng mong một con số _có mốc neo_ — một con số bạn biện hộ được từ nguyên lý cơ bản thay vì từ cảm giác.

Những mốc neo senior đội đầu:

```
1 JSON response nhỏ          ≈ 1 KB
1 HTML page + assets         ≈ 100 KB
1 image / thumbnail          ≈ 100 KB–1 MB
1 user/ngày                  ≈ 10 request (nhẹ) / 100 (app nặng) / 1000 (ad-tech)
1 Gbps NIC                   ≈ 125 MB/s ≈ ~100k response nhỏ (1 KB)/s
1 app instance stateless     ≈ 1k–10k JSON request đơn giản/s
1 Postgres single-writer     ≈ vài nghìn writes/s, ~10x cho reads
1 network round trip trong DC ≈ 0.1–0.5 ms
```

Đường đi chuẩn cho một service nặng read:

```
10M user, 50 read/user/ngày, response ~1 KB

→ 10M × 50 = 500M read/ngày
→ 500M / 86.400 s ≈ 5.800 read/s trung bình
→ 5.800 × 1 KB ≈ 5.8 MB/s ≈ 46 Mbps trên đường truyền   (một NIC còn dư sức)
→ peak ≈ 3× trung bình ≈ 17.400 r/s ≈ 140 Mbps
→ hai ba instance stateless, một Redis cache cho tập nóng,
  một tầng DB — đó là toàn bộ kiến trúc, và con số chứng minh điều đó
```

Cái bẫy senior nào cũng tự nêu ra: **tỷ lệ peak-to-average**. Average là con số dễ; peak mới là nơi hệ thống chết. 5.8k QPS trung bình chẳng nghĩa lý gì khi một flash sale hay một sự kiện tin nóng đẩy bạn lên 50k trong bốn mươi phút. Hãy thiết kế cho flash sale, không phải cho chiều thứ Ba nhàn rỗi. Và hãy thành thật về tỷ lệ bạn chọn — "3×" là một con số đoán, và nó phải là con số đoán bạn biện hộ được từ dashboard của chính mình.

Toán storage có cái bẫy riêng: dữ liệu ứng dụng thường là con số nhỏ, còn log mới là con số lớn.

```
100M URL × 500 bytes raw ≈ 50 GB/năm        (không đáng kể)
× replication factor 3   ≈ 150 GB/năm        (vẫn là không)
1B redirect × 100 byte mỗi dòng log ≈ 100 GB/ngày  (một phần ba TB mỗi NGÀY)
```

Cái "một phần ba TB mỗi ngày" đó buộc quyết định thiết kế thật — retention, sampling, aggregation — từ rất lâu trước khi bảng URL đặt ra vấn đề. Và câu sanity-check phỏng vấn viên yêu thích: lấy một con số throughput rồi quy đổi sang con số network hoặc disk, sau đó nói xem nút thắt là CPU, NIC hay storage. Câu "5.8k req/s với response 1 KB là 46 Mbps" kết thúc mọi sự vung tay.

> Drill: "10M user, 5 post/user/ngày, mỗi post được đọc 100 lần. Định cỡ nó." Câu trả lời senior cho ra reads/s, writes/s, bandwidth, và một năm storage — rồi nói to tỷ lệ: "đó là workload 100:1 read:write, nên tôi thiết kế một cache, không phải một write engine." Tỷ lệ chính là đáp án phỏng vấn viên câu cá; số học chỉ là biên lai.

## 3. Cache strategy — nơi senior kiếm cơm

Câu trả lời của người mới là "dùng Redis". Câu trả lời của senior là hợp đồng consistency, chính sách eviction, bảo vệ stampede, phân tầng L1/L2, và một kiến trúc cache đã làm sập một hệ thống production mà họ từng thấy hoặc từng gây ra.

### Bốn chiến lược đặt cache và giá của từng cái

| Chiến lược                    | Cache làm gì                                                       | Chi phí / rủi ro                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cache-aside (lazy)**        | App kiểm tra cache, miss thì query DB, điền cache                  | Đơn giản; app sở hữu invalidation; một miss dưới sự cạnh tranh chính là stampede                                                                                                                  |
| **Read-through**              | Bản thân cache load từ DB khi miss (Caffeine loader, CacheManager) | Ít code app hơn; khó suy luận ai thực sự đang load                                                                                                                                                |
| **Write-through**             | App ghi cache, cache ghi DB đồng bộ                                | Reads luôn tươi-gần-đúng; mỗi write trả giá một hop cache, và cache không được mất dữ liệu                                                                                                        |
| **Write-behind (write-back)** | App ghi cache, cache gom lô ghi DB bất đồng bộ                     | Write throughput cao nhất — hấp thụ được spike 10× mà đường đồng bộ không chịu nổi — nhưng một crash giữa cache và DB là dữ liệu mất. DB luôn chậm đúng bằng batch_size × batch_interval, mãi mãi |

Cache-aside là mặc định vì một lý do: nó là chiến lược duy nhất mà lỗi cache degrade nhẹ nhàng thay vì làm hỏng dữ liệu. Các chiến lược kia mua tốc độ ghi hoặc sự đơn giản của read bằng giá một failure mode mới — và senior nói rõ họ đang mua cái nào.

### Stampede — cú sập production kinh điển

**Cache stampede / thundering herd**: một hot key hết hạn, và 10.000 request đồng thời cùng miss. Cái cache miss đơn lẻ đó đáng giá 10.000 query database rơi vào đúng cùng một millisecond — đủ để biến một DB khỏe mạnh thành một đống query chậm, khiến cache lại miss trên lần repopulate chậm chạp, và mọi thứ càng tệ hơn.

```java
// WRONG: mỗi miss là một DB call độc lập → 10.000 miss = 10.000 DB query
Order o = cache.get(key);
if (o == null) {
    o = db.find(key);          // cả 10.000 request đổ tới đây cùng lúc
    cache.put(key, o, Duration.ofMinutes(5));
}

// RIGHT: single-flight — đúng MỘT request nói chuyện với DB, số còn lại chờ nó
CompletableFuture<Order> inflight = inflight.computeIfAbsent(key, k ->
    CompletableFuture.supplyAsync(() -> db.find(k))
        .whenComplete((v, e) -> inflight.remove(k)));
Order o = inflight.get(2, TimeUnit.SECONDS);
```

Và người bạn thầm lặng của stampede: **synchronized expiry**. Một nghìn key ghi cùng một TTL sẽ hết hạn ở đúng cùng một khoảnh khắc, nên stampede không phải một key — mà là một nghìn key cùng lúc. Cách sửa là một lớp bôi trơn:

```java
Duration ttl = Duration.ofSeconds(60 + ThreadLocalRandom.current().nextInt(20));
```

Với base 60s và jitter ±10s, những key sinh cùng lúc sẽ hết hạn dải ra trong cửa sổ 20 giây thay vì một khoảnh khắc đồng bộ. Cái jitter đó là mười dòng code bảo hiểm latency rẻ nhất trong distributed systems.

### Invalidation — hai bài toán khó

"Trong khoa học máy tính chỉ có hai thứ khó: cache invalidation và naming things." Bản senior của cache invalidation:

- **TTL-only** — bạn chấp nhận stale tới hết TTL như một hợp đồng kinh doanh. Ổn khi "feed vài giây tuổi là chấp nhận được"; chí mạng cho một balance hay một inventory count.
- **Invalidate on write, không bao giờ update on write.** Ghi DB, rồi xóa cache key. Xóa không atomic với ghi, nên một xóa thất bại để lại entry stale — và đó là lúc TTL đóng vai backstop. Biến thể thảm họa là write-through-update: app ghi DB rồi ghi giá trị mới vào cache, hai lần ghi race nhau, và cache có thể giữ một giá trị cũ hơn DB mãi mãi, không TTL nào cứu được, vì "mãi mãi" chính là mục đích của tai nạn.
- **Versioned keys.** `user:123:v41` → sau mỗi write, nhảy lên `v42`. Một reader đã chộp `:v41` không bao giờ thấy được `:v42` đang ghi dở; key cũ chết theo TTL. Đây là cơ chế giết chết race read-during-write, và là câu trả lời trung thực cho "làm sao giữ cache và DB không lệch nhau giữa chừng write."

### Phân tầng L1/L2 — nơi thiết kế cache thành kiến trúc

Con số phân tách bản vẽ khỏi triển khai:

```
Caffeine hit trong JVM    → ~10–50 ns      (gần như miễn phí)
Redis round trip          → ~0.5–1 ms      (chậm gấp 50.000× L1 — vẫn "nhanh")
DB query, pool nóng       → ~1–10 ms
```

Một read path nóng trong production hiếm khi chỉ là "Redis". Nó là một **L1 cache cục bộ** (Caffeine) trong từng instance app giữ những key thực sự nóng, với Redis làm L2 phía sau. Tradeoff mới là phần thú vị:

- L1 là per-instance. Một fleet 100 instance, mỗi cái giữ bản sao riêng, nên hai instance có thể bất đồng tới hết TTL — ổn cho reads, chí mạng nếu bạn đặt một "balance" vào L1.
- **Cold-start stampede.** Mỗi instance repopulate L1 sau một deploy đồng loạt phóng 100 × miss-rate của nó về phía Redis. Nếu L1 lặng lẽ hấp thụ 99% traffic, Redis được định cỡ cho 1% — và cái deploy bây giờ chính là outage.
- Senior theo dõi **L1 hit ratio**, không phải Redis hit ratio. Redis hit ratio có thể trông khỏe trong khi L1 đang làm toàn bộ việc, và ngược lại — sự phân tầng vô hình cho đến khi nó không còn vô hình nữa.

### Redis làm cache, Redis làm store, và nút xoay eviction

Nói "Redis nhanh" là tầm mid-level. Khung hình của senior là hợp đồng durability:

- **Làm cache** — eviction LRU/LFU thuần, chấp nhận mất dữ liệu. `maxmemory` và một chính sách eviction (`allkeys-lru` vs `volatile-lru`) là hoạch định capacity, không phải điều nghĩ sau. Ở chế độ `noeviction`, một Redis đầy **từ chối writes** — với một cache điều đó có nghĩa DB đột nhiên hứng trọn toàn bộ tải mà không một cảnh báo nào. Chính sách eviction là một nút xoay load-shedding, và bạn đặt nó có chủ đích.
- **Làm store** — AOF + fsync mỗi lần ghi là vài nghìn ops/s; fsync mỗi giây mất tới một giây dữ liệu khi crash; RDB snapshot mất những gì bạn ghi từ sau snapshot cuối. Senior nói "Redis là source of truth" và lập tức biện hộ cho cài đặt durability, vì câu "source of truth" và "có lẽ tôi vừa mất giây cuối cùng" không được ở chung một câu.

Và hot key — điểm lỗi đơn lẻ của chính cache. Một key celeb, một URL virus, một counter dùng chung 100.000 user cùng dập: một Redis key đơn với value khổng lồ serialize trên core đơn-threaded, và node của nó thành trần nhà. Cách sửa: tách key (`hot:user:123:0..31`), hoặc phục vụ nó từ L1 nơi nó thực sự nóng, hoặc — cho ca bệnh lý thật sự — chấp nhận trần nhà và instrument nó.

> Drill: "Một flash sale bắt đầu lúc nửa đêm, và mọi item giảm giá được cache với TTL hết hạn đúng lúc nửa đêm." Câu trả lời senior nêu tên stampede, single-flight, jittered TTL, L1 fallback — rồi phần thắng cuộc: một đòn **pre-warm** có chủ đích các hot key mười phút trước nửa đêm, để DB không bao giờ thấy đường cong cold-start.

## 4. Consistency — CAP, PACELC, và vì sao "eventual" cần một quyết định, không phải một hy vọng

Câu trả lời của người mới là "bạn chọn hai trong ba." Câu trả lời của senior bắt đầu bằng cách sửa lại khung hình: **partition không phải một failure mode hiếm — chúng là điều kiện giả định của mạng.** Mọi distributed system vận hành trên giả định một partition sẽ xảy ra, nên câu hỏi thật là bạn hy sinh gì _trong lúc_ partition, và chuyện gì xảy ra _khi nó lành_.

Dưới một partition bạn chọn CP hoặc AP:

- **CP** (Raft, single-leader, quorum): phía thiểu số trả lỗi hoặc chờ, nhưng hai phía không bao giờ phân kỳ. Khi partition lành, chẳng có gì để reconcile.
- **AP** (kiểu Dynamo): cả hai phía đều nhận write, nên khi partition lành bạn cầm **hai giá trị xung đột cho cùng một key**, và ai đó phải quyết xem giá trị nào thắng. "Eventual consistency" không phải dữ liệu tự nhiên sắp xếp ổn thỏa bằng phép màu — nó là việc _bạn_ có một chiến lược merge được viết ra giấy.

**PACELC** là phần mở rộng khiến senior tỏa sáng: ngay cả khi **không** có partition (phần "ELC"), bạn vẫn chọn giữa **Latency và Consistency** trên mỗi thao tác. Đó là giá trung thực của strong consistency — một write quorum đồng bộ phải trả số round trip để chạm được quorum, và latency là cái giá của sự đảm bảo. Senior tự nguyện nêu PACELC mà không cần được hỏi vì nó biến một cuộc tranh luận triết học thành một latency budget.

### R + W > N — phép toán bên dưới chữ "eventual"

```
N = số replica, R = read quorum, W = write quorum
R + W > N   →   mỗi read chạm một node chứa write mới nhất
```

N=3, W=2, R=2: một write đáp xuống hai node, một read đọc hai node, hai tập giao nhau ít nhất một node — nên một read không bao giờ bỏ lỡ một write đã hoàn tất. Sự giao nhau đó là toàn bộ cơ chế đằng sau "quorum reads/writes", và là nghĩa cụ thể của "eventual" — cái eventual bị chặn bởi bao lâu cho đến khi một read phủ quorum, không phải bởi cảm giác.

Hai lưu ý senior đặt lên trên phép toán:

1. **R + W > N cho bạn biết một read thấy _một_ node có write — không phải _cái nào_ mới nhất.** Bạn vẫn cần versioning: vector clock, hoặc một logical clock (Lamport/HLC). Và **last-write-wins với wall-clock timestamp chính là cách bạn mất dữ liệu**: hai client trên hai đồng hồ khác nhau, một lần chỉnh NTP, một lần rollback, và LWW lặng lẽ chọn "mới nhất" sai.
2. **Availability của quorum là một vách đá, không phải một dốc.** Với N=3, W=2, mất một node là chuyện thường, nhưng mất hai node làm writes bất khả thi. "Ba replica" nghe như nhân ba dự phòng và cư xử như: một lỗi thì không sao, hai lỗi là một outage.

### Thực tế leader-based của phần lớn hệ thống Java

Đây là punchline trung thực phỏng vấn viên muốn nghe: với một service Java điển hình, bạn không thực sự chọn giữa CP và AP. Bạn chọn một **single leader** — Postgres primary, một Redis master, Raft trong ZooKeeper/etcd — tức là CP với một writer, và chấp nhận trần availability đi kèm. Bạn vươn tới AP kiểu Dynamo chỉ khi yêu cầu availability thực sự không thể đáp bằng một leader: scale toàn cầu, luôn ghi được, hoạt động offline — giỏ hàng, messaging, collaboration. Senior nói "tôi muốn một source of truth" ra tiếng và chỉ chạm tới ngân sách độ phức tạp khi yêu cầu đòi hỏi nó. Câu đắt nhất trong system design là "nhưng nếu leader chết thì sao?" — senior biết câu trả lời là "thì writes chết theo", và quyết xem điều đó có chấp nhận được không trước khi xây kiến trúc, không phải sau.

### Những failure mode phỏng vấn viên khoan

- **Read-your-writes.** User post, refresh, và post không thấy đâu. Dưới eventual consistency điều này có thật và business thấy rõ. Cách sửa: read-after-write affinity (route reads của phiên đó về replica vừa nhận write), hoặc một tầng session-stickiness.
- **Split-brain.** Hai node cùng nhận write vì đều tin mình là leader. Phòng thủ là quorum (W=2 khiến hai leader đồng thời bất khả thi với N=3) cộng **fencing tokens / epoch numbers** để một leader bị phế truất không thể tiếp tục ghi sau khi thua bầu cử. "Leader cũ, leader mới, thằng cũ vẫn ghi" chính là trace senior kể lại.
- **Bài toán hai vị tướng.** Hai tiến trình qua một kênh không đáng tin không bao giờ có thể _đảm bảo_ thống nhất một thông điệp. Không có giao thức nào làm distributed commit miễn phí — chỉ có giao thức làm cửa sổ lỗi nhỏ hơn, và bạn trả tiền cho độ nhỏ của cửa sổ. Đó là lý do transactional outbox (ghi row và event trong một DB transaction, để một relay phát lên) tồn tại: nó đổi một distributed transaction lấy một local transaction cộng một relay retryable.

> Drill: "Service order của bạn chạy hai Postgres primary để 'availability'. Auditor tìm thấy order tồn tại trên một con mà không có trên con kia." Câu trả lời senior: đó là split-brain, và cách sửa là bầu cử leader cộng fencing — hoặc một quorum — và nếu yêu cầu thật sự là availability-first, bạn thiết kế AP với một chính sách giải quyết xung đột có thể biện hộ trước cơ quan quản lý, và bạn nói to câu "hai primary không phải một distributed system, nó là một bug với high availability."

## 5. Scalability patterns — cơ chế đằng sau những cái ô vuông

Câu trả lời của người mới là "thêm server." Câu trả lời của senior là ba trục, tiền đề statelessness, phép toán sharding, hợp đồng backpressure, và các tầng load balancer — vì mỗi thứ đó là một nơi mà "thêm server" lặng lẽ ngừng có tác dụng.

### Statelessness — tiền đề ai cũng đồng ý nhưng ai cũng vi phạm

Bạn không thể scale ngang một service giữ session state trong local memory. Session thuộc về Redis (hoặc một session store); `HttpSession` trong local memory nghĩa là một node chết đuổi mọi session nó đang giữ, và scale out không phân tán tải mà chỉ xáo bài. Điểm bổ sung của senior: statelessness không chỉ là session — nó là bất kỳ **local cache bạn coi như đồ vứt được** và bất kỳ **background thread nào giả định mình là duy nhất**. Một job `@Scheduled` chạy trên mọi instance là một bug bạn cố tình deploy:

```java
// WRONG: năm instance, năm đợt purge đồng thời — double work, race, không ai là chủ
@Component
class NightlyPurge {
    @Scheduled(cron = "0 0 2 * * *")
    void purge() { /* ai cũng chạy cái này */ }
}

// RIGHT: ShedLock (hoặc một DB row lease) — đúng MỘT leader chạy job
@SchedulerLock(name = "nightlyPurge", lockAtMostFor = "PT1H")
@Scheduled(cron = "0 0 2 * * *")
void purge() { /* một instance giữ lease */ }
```

### Sharding — phép toán, hot key, và cái bẫy tăng trưởng

Sharding chia dữ liệu theo một key để không node nào giữ mọi thứ. Ba chiến lược, kèm failure mode:

- **Range** — `user_id < 1M` ở shard 1. Tuyệt cho range scan; chí mạng cho range nóng — user mới nhất, timestamp mới nhất, tất cả rơi vào một shard, và shard đó thành trần nhà trong khi số còn lại nhàn rỗi.
- **Hash** — `hash(key) % N`. Phân phối đều, nhưng không có locality range, và **thêm một shard remap gần như mọi key**. Consistent hashing giảm việc xáo trộn xuống còn ~1/N số key khi một node vào hoặc ra — với 10 node, ~10% key di chuyển thay vì ~90%.
- **Directory** — một bảng lookup ánh xạ key → shard. Linh hoạt nhất; nhưng bản thân directory là một store nóng, strongly-consistent, tức là nút thắt đội một chiếc mũ khác.

Hot key cắn trong sharding đúng y cách nó cắn trong Kafka: một celeb, một best-seller, một khách hàng bận rộn nhất — hash ném chúng vào một shard, và trần nhà của shard đó là trần nhà của cả hệ thống. Cách sửa cùng một gia đình: composite key, shard-trong-shard, hoặc instrument và chấp nhận. Và câu làm rõ phỏng vấn viên câu cá: **replication cho bạn khả năng chịu lỗi, không cho bạn scale.** Một shard replica 3× vẫn có trần ghi của một node — bản sao không song song hóa writes.

### Async + backpressure — quyết định "xả tải"

Một queue giữa request path và công việc chậm là thiết kế kinh điển. Phần ứng viên hay bỏ qua là **backpressure** — chuyện gì xảy ra khi queue đầy nhanh hơn tốc độ workers xả. Định luật Little, một lần nữa:

```
queue depth  =  arrival rate  ×  processing time
10k msg/s × 1 s xử lý  =  10.000 message in flight ở trạng thái ổn định
```

Một queue không biên và không scale chỉ là một cái đệm cho một outage trì hoãn: workers tụt sau, queue lớn lên, storage của queue lớn lên, rồi queue chết và producers chất đống thay vào. Sổ tay senior:

- **Giới hạn queue** và reject hoặc drop khi đầy — một lỗi nhanh, sạch sẽ thắng một lỗi chậm, dây chuyền.
- **Scale workers theo backlog** (KEDA theo Kafka lag, SQS autoscaling theo queue depth) để queue là tín hiệu tải, không phải một vòng xoáy chết.
- **Degrade có chủ đích.** Phục vụ từ cache, xả bớt các write không thiết yếu, trả về một `503` thân thiện thay vì queue chờ mãi mãi.
- **Circuit breaker** (Resilience4j): sau N lần lỗi, trip breaker và fail nhanh. Con số làm điều này cụ thể: một dependency latency 2 s với client timeout 500 ms không "chậm lại" — mọi caller trở thành một thread bị treo, và ở 10k req/s đó là 20.000 thread chờ một dependency đã chết. Đó là mô hình outage: không phải "dependency hỏng", mà là "lỗi lan truyền và kéo cả fleet xuống cùng." Breaker đổi một bữa tiệc timeout 2 phút thành một lời từ chối 50 ms.

### Load balancing — các tầng, và chi tiết deploy

L4 cân bằng TCP connection (nhanh, mờ đục, biết node khỏe); L7 cân bằng HTTP (route theo path, endpoint health check, sticky session). Chi tiết senior mà phỏng vấn viên hay khoan là **connection draining**: khi rolling deploy, LB ngừng đưa traffic mới vào node cũ và chờ các request đang bay xong. Một `kill -9` vào node đang phục vụ traffic chính là cách "deploy" thành "outage". Cùng một gia đình với Kafka rebalance và GC pause: graceful degradation là một tính năng thiết kế, không phải sự lịch sự.

> Drill: "Service order của tôi có 40 instance mà vẫn thấy chậm. Phỏng vấn viên chỉ vào cái Postgres đơn. Vì sao nó là nút thắt?" Câu trả lời senior nêu tên write path: một writer đơn nghĩa là throughput ghi của một node, và 40 instance đọc không giúp gì cho writes. Rồi follow-up trung thực — "nên hoặc chúng ta shard write path, hoặc, vì write QPS thực ra vừa khít một node, chúng ta chấp nhận trần và tinh chỉnh reads." Nói câu "chúng ta không cần shard" là một câu senior.

## 6. Ví dụ mini: URL shortener, đào tới độ sâu senior

Câu hỏi system-design kinh điển, và là nơi hầu hết blog prep tính sai toán. Bản senior:

### Phép toán encoding, với birthday bound không ai nhắc tới

Câu chuẩn là "62^7 ≈ 3,5 nghìn tỷ — dư sức chứa." Đúng và là một cái bẫy, vì nó nhầm lẫn **không gian** với **xác suất collision**. Một mã 7-ký tự ngẫu nhiên rút từ không gian đó đâm nhau nhanh tới kinh ngạc:

```
62^7  ≈ 3,5 × 10^12   → ở 100M insert, collision kỳ vọng ≈ N²/2M ≈ 1.400
62^10 ≈ 8,4 × 10^17   → ở 100M insert, collision kỳ vọng ≈ 0,006
```

Một trăm triệu mã 7-ký tự ngẫu nhiên đâm nhau cỡ một nghìn bốn trăm lần. Vòng lặp ngây thơ ("trong khi key tồn tại, thử lại") biến thành một cơn bão retry ở scale. Cách sửa của senior là ngừng _sinh_ key và bắt đầu _mã hóa_ chúng:

```java
// WRONG: mã 7-ký tự ngẫu nhiên — "không gian 3,5T" bỏ qua birthday bound
String key = randomBase62(7);                 // ~1.400 collision mỗi 100M insert
while (keyExists(key)) key = randomBase62(7);

// RIGHT: mã hóa song ánh một id duy nhất — zero collision do cấu tạo
long id = idService.nextId();                 // snowflake hoặc DB sequence
String key = encodeBase62(id);                // 7 ký tự phủ 3,5T id tuần tự

// RIGHT cho key không đoán được: hash URL, lấy 10 ký tự base62 (an toàn birthday)
String key = encodeBase62(sha256(url), 10);
```

### Những con số định cỡ cả thứ này

```
100M URL mới/ngày → ~1.200 writes/s bền vững, peak 3–5×
1B redirect/ngày  → ~11,5k reads/s, ~35k peak
tỷ lệ read:write  → ~10:1 → hồ sơ cache chuẩn: reads nóng, writes lạnh
```

```
Storage: 100M URL × 500 bytes ≈ 50 GB/năm, RF3 ≈ 150 GB → tầm thường
Logs:    1B redirect × ~100 bytes ≈ 100 GB/ngày → ~3 TB/tháng
```

Log mới là bài toán storage, không phải URL. Retention và aggregation quyết chi phí hạ tầng thật, và nói ra điều đó mà không cần hỏi là dấu hiệu senior.

### Tầng cache, với latency budget

Một redirect có latency budget ~10 ms. Trong budget đó: một DB hit là 1–10 ms (ăn gần hết budget), một Redis hit là ~0,5 ms, một CDN edge redirect là ~1–5 ms từ PoP gần nhất. Phần lớn redirect đánh vào một tập nhỏ URL — 1% key phục vụ 99% traffic — nên thiết kế là:

1. **CDN edge cache** cho những URL virus thật sự (một redirect phục vụ từ edge không bao giờ chạm hạ tầng của bạn).
2. **Redis với LRU** cho tập nóng, với `R + W` chỉnh như một cache, không phải một store.
3. **DB** cho mọi thứ còn lại, được bảo vệ bằng single-flight để một cache eviction không bao giờ thành stampede.

Cache ở đây không phải "nice to have" — nó là thiết kế. Thiếu nó, DB là redirect path, và budget 10 ms chết ngay trong cú spike độ phổ biến đầu tiên.

### Những quyết định có hậu quả

- **301 vs 302.** Một `301` được browser và mọi proxy trung gian cache — một redirect được phục vụ và không bao giờ chạm bạn nữa. Rẻ, và bạn trả giá bằng: không đổi được target cho key đó trong suốt vòng đời cache, analytics bị mù, và một redirect sai sống sót qua cả lần sửa của bạn trong cache của mọi client. Một `302` đánh vào service (hoặc CDN) của bạn mỗi lần — tải hơn, nhưng bạn kiểm soát target và đo được mọi cú click. Câu trả lời senior: `302` + CDN, và chỉ `301` cho những key bạn sẽ không bao giờ đổi.
- **Enumeration.** Key base62 tuần tự có thể bị crawl — mọi short URL theo thứ tự, miễn phí. Key ngẫu nhiên thì không. Nếu service public, rate-limit lookup và nghĩ xem key có cần không đoán được.
- **URL virus.** Một URL làm 1M redirect trong hai phút: hot key làm bão hòa Redis (core đơn-threaded, một node), nên câu trả lời là CDN-first cộng thủ thuật split-key, và instrument danh sách top-K để bạn thấy nó tới.

> Drill: "Design một URL shortener." Câu trả lời senior giao hàng trong khoảng mười phút: tỷ lệ read:write (~10:1), hiệu chỉnh birthday-bound (mã 7-ký tự ngẫu nhiên đâm nhau ~1.400 lần mỗi 100M; mã hóa một ID thay vào đó), toán storage log (~3 TB/tháng log raw), quyết định 301/302, và câu trả lời hot-key CDN-first. Trình tự đó, không cần được hỏi, là toàn bộ phần này.

## 7. Observability — thiết kế chưa xong cho tới khi bạn nhìn thấy nó hỏng

"We'll add monitoring later" là một red flag vì nó là câu duy nhất làm mọi quyết định thiết kế khác trở nên không thể gỡ lỗi. Observability không phải một dashboard thêm ở cuối; nó là khoảng cách giữa một senior bước vào incident và một senior bị page vào một bí ẩn.

- **Metrics.** RED cho service xử lý request (Rate, Errors, Duration); USE cho tài nguyên (Utilization, Saturation, Errors). Nước đi senior là nêu tên metric ánh xạ tới SLO — p99 latency, error rate, queue depth — thay vì "CPU". CPU là metric tài nguyên; người dùng cảm nhận latency.
- **Logs.** Structured JSON, một dòng mỗi event, và mỗi dòng mang `traceId`/`spanId`. Ở 10k req/s, log mọi thành công là 10k dòng/s tiếng ồn — mặc định log ở warn/error và sample happy path. Correlation ID là sợi chỉ xuyên request qua các service, và header W3C `traceparent` là cách nó di chuyển.
- **Tracing.** Distributed trace (Micrometer Tracing / OpenTelemetry) cho thấy span chậm đầu tiên trong chuỗi. Chúng không miễn phí: mỗi span được serialize và export, ~0,1–1% latency request và một khoản thuế CPU thật ở scale — nên head-based sampling (10% hoặc 1% ở QPS cao) là một phần của thiết kế, không phải một sự thỏa hiệp.
- **SLI / SLO / error budget.** Một SLO 99,9% là ~43 phút downtime được phép mỗi tháng. Error budget biến câu "shipping được không?" từ cảm giác thành số học: budget cháy → ngừng ship thay đổi rủi ro. Alert trên SLO — theo symptom (latency, errors), không theo cause (một dòng log cụ thể) — vì symptom là thứ người dùng cảm nhận và cause là thứ on-call của bạn sẽ tự tìm ra dù sao.

> Drill: "p95 latency tăng gấp đôi lúc 3 giờ sáng. Dẫn tôi qua mười phút đầu của bạn." Câu trả lời senior: kiểm tra SLO burn rate trước (đang đi theo trend hay chỉ một blip?), chộp correlation ID của một request đang lỗi, bám theo trace của nó tới span chậm đầu tiên, rồi đặt câu hỏi rẽ nhánh — là dependency (trip circuit breaker) hay DB (buffer-pool hit ratio, slow-query log, connection-pool saturation)? — và phần thắng cuộc: "Tôi làm được hết vì tôi instrument trước lúc deploy, nên dữ liệu đã ở đó sẵn."

## 8. Tự kiểm tra

- [ ] Hỏi những câu làm rõ lộ ra tải (QPS, peak-to-average, tỷ lệ read/write) trước khi vẽ một ô vuông nào.
- [ ] Định cỡ một service nặng read từ các mốc neo: users → requests/ngày → QPS → bandwidth, với một hệ số peak biện hộ được.
- [ ] Giải thích vì sao key base62 7-ký tự ngẫu nhiên đâm nhau ~1.400 lần mỗi 100M insert và vì sao mã hóa một ID sửa được điều đó.
- [ ] Thiết kế cache-aside với single-flight chống stampede, jittered TTL, và invalidate-on-write — và nói mỗi sửa chữa ngăn failure nào.
- [ ] Nêu tradeoff L1/L2 và stampede cold-start sau một deploy.
- [ ] Phát biểu CAP đúng (hy sinh gì _trong lúc_ partition) và thêm PACELC mà không cần hỏi.
- [ ] Chứng minh `R + W > N` và giải thích vì sao LWW với wall-clock timestamp mất dữ liệu.
- [ ] Biện hộ một sharding key — và nói hot key làm gì với trần nhà của hệ thống.
- [ ] Đưa hợp đồng backpressure: giới hạn queue, scale workers theo backlog, circuit-break dependency đã chết.
- [ ] Trả lời "cái gì gãy trước và bạn degrade thế nào?" mà không cần được hỏi.

## 9. Interviewer follow-ups

Khi câu trả lời đầu tiên của bạn chạm đúng, họ bắt đầu khoan. Sẵn sàng cho những câu này:

- "10M user là một dân số, không phải một tải. Bạn thực sự cần những con số nào, và vì sao?"
- "Cache hit ratio của bạn là 90%. Vậy có tốt không? Con số bạn thực sự nên theo dõi là gì?"
- "Một hot key hết hạn và 10.000 request cùng dập vào DB. Dẫn tôi qua cách sửa, rồi nói tôi biết trong ba failure mode bạn vừa xử lý là cái nào."
- "Khi write, nên cache giá trị hay invalidate key? Trong từng trường hợp, TTL bảo vệ bạn khỏi cái gì?"
- "Redis restart lúc 3 giờ sáng. Service của bạn ra sao, và bạn làm gì trước deploy kế tiếp?"
- "Phát biểu CAP cho tôi — và kể tôi nghe chuyện gì xảy ra _khi partition lành_, không chỉ trong lúc nó."
- "Vì sao last-write-wins với timestamp mất dữ liệu? Bạn dùng cái gì thay thế?"
- "Queue depth đang leo, workers 100% CPU, DB ở 40%. Nút thắt ở đâu, và bạn đổi gì trước tiên?"
- "Thêm một shard vào một store hash-sharded. Điều gì vỡ, và consistent hashing thay đổi gì?"
- "301 vs 302 cho redirect — bạn chọn cái nào, và bạn mất gì dù chọn cách nào?"
- "p95 của bạn vừa nhân đôi. SLO là 99,9%. Error budget của bạn là bao nhiêu, và bạn kiểm tra gì đầu tiên?"
- "Vì sao 'hai Postgres primary' không phải high availability — và thiết kế thực sự là gì?"

Đó là bar system design.
