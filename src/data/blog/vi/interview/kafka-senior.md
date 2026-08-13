---
title: "Phỏng vấn Senior Java: Apache Kafka"
description: "Hệ thống event-driven trên Kafka — delivery semantics, replication, partitioning cho order, consumer lag, và dead-letter queue mọi consumer production cần."
pubDatetime: 2026-08-10T10:20:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - kafka
  - event-driven
---

Câu hỏi Kafka phân biệt người từng chạy prod và người chỉ đọc docs — và khoảng cách đó rộng hơn gần như với mọi công cụ khác, vì Kafka trông có vẻ đơn giản một cách đánh lừa: một cái log chỉ-append, một producer bên này, một consumer bên kia — cho tới lúc 2 giờ sáng một cơn rebalance storm đóng băng toàn bộ queue của bạn, hoặc một record rác âm thầm làm kẹt một partition suốt nhiều giờ trong khi mọi dashboard xung quanh vẫn xanh.

Junior thuộc lòng ba delivery semantics. Senior kể được chính xác khoảnh khắc một record trở thành "committed", biện hộ số partition bằng phép toán throughput thay vì đoán mò, giải thích vì sao `enable.idempotence=true` vẫn không bảo vệ được cú ghi Postgres nằm ở phía bên kia của consumer, và chỉ ra được _một_ metric chứng minh rằng consumer — chứ không phải broker — mới là nút thắt của tháng trước.

> Tư duy: nhả thuật ngữ thì bạn chỉ ở tầm mid-level. Đi qua một tradeoff bằng số thật và một failure mode trong production thì bạn chạm nốt "senior". Mỗi phần dưới đây đều kết bằng bài tập phỏng vấn viên thực sự hay chạy.

## Thang câu hỏi phỏng vấn (Junior → Mid → Senior)

> Tự drill to tiếng. Junior = "bạn có biết khái niệm"; Mid = "bạn có biết tradeoff"; Senior = "bạn có thể bảo vệ quyết định dưới áp lực, kèm một con số và một postmortem."

### Junior — nền tảng

- **Q: Ba delivery semantics trong Kafka là gì?**
  A: At-most-once (có thể mất), at-least-once (có thể trùng), exactly-once (không mất, không trùng). Producer mặc định at-least-once; consumer phải dedupe hoặc làm processing idempotent để tiệm cận exactly-once.

- **Q: Topic, partition, và consumer group là gì?**
  A: Topic là một log; nó chia thành các partition (mỗi cái là một chuỗi immutable có thứ tự). Consumer group là tập consumer chia sẻ công việc — mỗi partition được tiêu thụ bởi đúng một thành viên của group.

- **Q: Consumer offset đại diện cho gì?**
  A: Vị trí của record tiếp theo cần đọc trong một partition. Offset đã commit cho consumer resume sau restart hoặc rebalance. `auto-commit` commit định kỳ; manual commit cho bạn kiểm soát biên consume-process-commit.

- **Q: Khác nhau giữa queue và topic?**
  A: Queue truyền thống giao mỗi message cho một consumer; topic broadcast cho mọi consumer group subscribe. Đó là lý do một topic có thể nuôi analytics, audit, và service chính cùng lúc.

- **Q: `acks=all` nghĩa là gì?**
  A: Producer chờ leader _và_ mọi in-sync replica acknowledge write mới coi là thành công — bền vững hơn, đổi bằng latency. `acks=1` chỉ chờ leader; `acks=0` bắn và quên.

### Mid — tradeoff & bẫy

- **Q: `enable.idempotence=true` — nó có bảo vệ cú ghi Postgres nằm ở phía bên kia consumer không?**
  A: Không. Idempotence chỉ dedupe retry producer→broker trong nội bộ Kafka. Khi consumer ghi Postgres, một redelivery (crash trước khi commit offset) ghi lại. Exactly-once end-to-end cần một _sink_ idempotent (upsert by key) hoặc transactional outbox.

- **Q: Một poison record âm thầm làm kẹt một partition suốt vài giờ trong khi dashboard vẫn xanh. Tại sao, và sửa?**
  A: Consumer throw trên record đó, không bao giờ commit offset, Kafka redeliver nó mãi mãi — một record độc chặn cả partition. Sửa: dead-letter queue (route record xấu sau N retry) và alert trên consumer lag — metric thực sự cho thấy sự kẹt.

- **Q: Chọn số partition thế nào?**
  A: Bằng throughput và parallelism của consumer, không đoán mò: `partitions ≈ max(target_producer_MBps / per_partition_MBps, target_consumer_instances)`. Nhiều partition = parallelism hơn nhưng cũng nhiều file mở, nhiều rebalance, và election lâu hơn nếu broker chết.

- **Q: Rebalance storm là gì, tại sao nó đóng băng queue?**
  A: Consumer join/leave group liên tục (poll chậm, GC pause dài, heartbeat timeout), kích rebalance thu hồi mọi partition, tạm dừng tiêu thụ, rồi assign lại. Sửa: tune `session.timeout.ms`/`heartbeat.interval.ms`, giữ poll loop nhanh, và dùng cooperative rebalancing (incremental) nếu được.

- **Q: Consumer lag tăng — nhìn đâu trước?**
  A: Đây là bài toán _throughput_ (consumer không kịp — thêm instance/partition) hay _processing_ (mỗi record chậm — một downstream call chậm). Lag per-partition cho biết là một partition nóng hay toàn cục. Metric chứng minh _consumer_, không phải broker, là nút thắt là consumer lag vs broker CPU.

### Senior — thiết kế & bảo vệ

- **Q: Cần exactly-once cho "Kafka → consume → ghi Postgres". Thiết kế.**
  A: Hoặc (a) transactional outbox trong Postgres + một relay publish sang Kafka nguyên tử với business write (DB là source of truth), hoặc (b) idempotent sink: consumer upsert by key deterministic và commit offset trong cùng một local transaction. `enable.idempotence` + `ack=all` cover producer; sink cover consumer. Nêu bạn chọn cái nào và tại sao.

- **Q: Một cuộc leader election partition mất 30 s mà mọi dashboard xung quanh vẫn xanh. Giải thích.**
  A: Broker chết kích election leader cho replica của partition đó; cho tới khi một ISR leader mới được bầu, partition không available cho write — nhưng partition khác và service khác vẫn ổn, nên dashboard toàn cục vẫn xanh. Dấu hiệu là per-partition unavailability + producer timeout, không phải đỏ toàn hệ thống. Sửa: thêm replica, `election.timeout` nhanh hơn, và producer retry với backoff.

- **Q: Chọn size cluster cho 50 MB/s ingest, retention 3 ngày, record 1 KB. Bao nhiêu broker?**
  A: 50 MB/s × 3 ngày ≈ 13 TB raw; ×replication factor 3 ≈ 39 TB, ÷usable-per-broker (vd 5 TB) ≈ 8 broker tối thiểu, cộng headroom rebalancing. Throughput mỗi broker ~hàng trăm MB/s, nên broker bị bound bởi disk/retention ở đây, không phải CPU. Nêu giả định và knob bạn sẽ canh (disk, không phải core).

- **Q: Đi qua một vụ duplicate-payment do rebalance và bạn đóng nó thế nào.**
  A: Consumer xử lý xong một payment, crash trước khi commit offset, rebalance assign lại partition, redelivery xử lý lại. Đóng bằng idempotent processing (dedupe by `paymentId` trong một unique DB constraint) để redelivery thành no-op. Postmortem: timing commit offset, không phải Kafka, là bug.

- **Q: Khi nào bạn KHÔNG dùng Kafka cho việc này?**
  A: Với request/response hoặc RPC latency thấp, queue/topic thêm một hop và at-least-once semantics bạn phải thiết kế xung quanh. Với single-producer/single-consumer latency chặt, một call trực tiếp hoặc broker nhẹ hơn có thể đơn giản hơn. Kafka tỏa sáng với fan-out, replay, và decoupling ở scale — hãy chỉ mặt trường hợp nó bị overkill.

#### Tự kiểm tra

- [ ] Junior: 3 semantics, topic/partition/consumer-group, offset là gì, queue vs topic, `acks=all`.
- [ ] Mid: vì sao idempotence không bảo vệ sink, poison-record+DLQ, bài toán size partition, nguyên nhân rebalance-storm, lag-là-metric.
- [ ] Senior: thiết kế exactly-once end-to-end, giải thích leader election 30 s, size cluster bằng retention, trace vụ duplicate-payment do rebalance, chỉ mặt khi Kafka là sai công cụ.

## 1. Cái log chính là sản phẩm — partitions, offsets, và thứ tự

Kafka không phải một message queue "tình cờ nhanh". Nó là một **distributed, immutable, append-only commit log**. Cái khung đó chính là câu trả lời senior: mọi thứ khác — consumer group, retention, kể cả "exactly once" — là hệ quả của cái log, không phải một feature gắn thêm lên trên.

Hãy nghĩ tới cái thanh ticket của nhà bếp. **Topic** là thanh ticket. Một **partition** là một làn của thanh ticket — và đây là chỗ người ta vấp: partition vừa là đơn vị của _ordering_ vừa là đơn vị của _parallelism_, và bạn không thể có nhiều hơn cái này hơn cái kia. Order được đảm bảo _trong_ một partition và tuyệt đối không đảm bảo across chúng. Khoảnh khắc các event của một entity rơi vào hai partition, mọi hi vọng về trình tự đều tan.

**Offset** là số thứ tự của ticket. Nó là một vị trí tăng đơn điệu trong một partition, và nó là checkpoint duy nhất một consumer có. Khi consumer của bạn "commit offset", nó đang nói với cả nhóm: _Tôi đã xử lý xong mọi thứ tới đây — nếu tôi crash, hãy cho tôi bắt đầu lại từ đây._ Chọn sai điểm này là bạn vừa tự quyết định delivery semantics của mình (phần 2) — hầu hết sự cố "Kafka mất message của tôi" thực ra là "consumer của tôi commit trước khi xử lý".

**Consumer group** là ca của đội phục vụ. Nhóm chia các partition cho các member, nên mỗi partition có đúng một consumer active tại một thời điểm. Hệ quả phân biệt người từng tinh chỉnh: **thêm consumer vượt quá số partition chẳng làm được gì**. Mười hai consumer, bốn partition — bốn con làm việc, tám con ngồi không, và cả nhóm chỉ rebalance thêm nhiều để "vinh dự" ngồi chơi.

Và phần khiến Kafka nhanh trên phần cứng tầm thường: broker ghi vào một **segment file** thông qua OS **page cache**, và phục vụ đọc bằng `sendfile()` (zero-copy — kernel memcpy page cache thẳng tới NIC, không đi qua JVM heap). Một topic hot gần như được phục vụ từ RAM. Đó là lý do một nhúm broker đạt hàng trăm MB/s mà không cần storage đặc biệt — disk chỉ phục vụ phần đuôi mà cache đã không chứa nổi.

> Bài tập: "Topic của tôi nên có bao nhiêu partition?" Câu trả lời senior không bao giờ là "nhiều bằng số consumer tôi có" hay "một partition mỗi core". Nó là một phép tính throughput kèm theo một lưu ý về tăng trưởng — và cái lưu ý đó chính là cái bẫy.

## 2. Delivery semantics — nơi "exactly once" xuống mồ

Ba mức đó là từ vựng, không phải câu trả lời. Câu trả lời là có thể dựng chính xác interleaving khiến một record bị mất hay bị trùng, rồi thành thật về việc cluster thực sự cho bạn cái gì.

- **At most once.** Commit offset _trước_ khi xử lý. Crash giữa commit và process → record không bao giờ được xử lý. Bạn đổi sự mất mát để lấy cái đảm bảo không bao giờ phải làm lại việc.
- **At least once.** Xử lý _rồi_ mới commit. Crash sau khi xử lý nhưng trước khi commit kịp ghi → record bị xử lý lại. Bạn đổi duplicate để lấy đảm bảo không gì bị mất. Đây là default thực tế của hầu hết hệ thống, và cái giá của nó là **consumer idempotent**.
- **Exactly once.** Trọng tâm của cả phần này: trong Kafka, EOS là một đảm bảo _thế giới khép kín_ (closed-world), và nó không mở rộng tới database của bạn.

### "Exactly once" của cluster thực sự làm gì

Hai cơ chế, và biết ranh giới giữa chúng là dấu hiệu senior:

1. **Idempotent producer** (`enable.idempotence=true`). Broker gán cho producer một `PID` và mỗi record một sequence number. Broker loại bỏ duplicate cho một cặp (PID, partition, sequence). Cơ chế này giết cái lỗi "retry tạo double write trong Kafka" — cho _một_ producer session.
2. **Kafka transactions** (`transactional.id`, `initTransactions()`, `beginTransaction()` / `commitTransaction()`). Cơ chế này cho một producer commit atomic các record trải khắp nhiều partition cộng với **consumer offsets** của nó — được phối hợp bởi transaction coordinator, chỉ nhìn thấy với consumer `read_committed`. Đây là exactly-once _trong nội bộ cluster_: một app Kafka Streams có thể đọc, xử lý, ghi sao cho crash-and-restart không replay gì cả.

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);      // PID + sequence numbers
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "orders-pipeline");   // bật transactions
```

Và đây là ranh giới thắng buổi phỏng vấn: **khoảnh khắc consumer của bạn ghi vào Postgres, transaction của Kafka trở nên vô nghĩa.** Kafka không thể đưa cú ghi DB và offset commit của nó vào một đơn vị atomic — không có distributed transaction nào kéo căng qua cả Kafka lẫn Postgres, XA trên Kafka không phải thứ bạn nên thử. Khoảnh khắc kiến trúc của bạn có một cái sink, bạn quay về at-least-once cộng idempotency, hết chuyện.

### Idempotency phía consumer thực sự cứu bạn

```java
// WRONG: auto-commit bắn TRƯỚC khi processing xong → at-most-once, mất âm thầm
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, true);

// RIGHT: at-least-once — chỉ commit sau khi batch được xử lý; làm việc idempotent
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
while (true) {
    ConsumerRecords<String, byte[]> batch = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, byte[]> r : batch) {
        applyIdempotently(r);   // unique constraint trên (event_id) trong DB của bạn
    }
    consumer.commitSync();      // crash trước dòng này → xử lý lại, và duplicate là vô hại
}
```

Chìa khóa idempotency thuộc về sink của bạn, và nó phải nằm trong database — không phải trong một `Set` trên memory chết theo lần restart:

```sql
INSERT INTO payments(id, order_id, event_id, amount) VALUES (?, ?, ?, ?)
ON CONFLICT (event_id) DO NOTHING;   -- event_id là dedupe key, unique constraint do DB enforce
```

Sự thật về chi phí: idempotent producer gần như miễn phí (vài byte mỗi batch). Transaction tốn một control record, một commit marker kiểu two-phase, và một round-trip tới coordinator mỗi transaction — latency cao hơn rõ rệt, throughput thấp hơn, và đó chính là lý do bạn không bọc từng event trong một transaction riêng.

> Bài tập: "Tôi bật `enable.idempotence=true`. Payment của tôi giờ exactly-once, đúng chứ?" Senior giết câu đó trong một hơi và đi qua cú ghi DB. Rồi họ được hỏi về outbox (phần 7).

## 3. Phía producer — batching, acks, và phép toán throughput

Producer đầu tiên của hầu hết mọi người là một cơn ác mộng latency mà họ không bao giờ biết, vì nó "chạy ngon" ở mức 200 event một ngày.

```java
// WRONG: flush() cho từng record — mỗi message một vòng round-trip trọn vẹn
for (OrderEvent e : events) {
    producer.send(new ProducerRecord<>("orders", e.orderId(), e.payload()));
    producer.flush();   // RTT-bound: một nhúm message mỗi giây, không phải hàng nghìn
}

// RIGHT: để batch đầy lên và network được trải đều
for (OrderEvent e : events) {
    producer.send(new ProducerRecord<>("orders", e.orderId(), e.payload()));
}
producer.flush();
```

`send()` là bất đồng bộ; các record xếp hàng trong buffer phía client và được ship thành một **batch**. Không có cái đó, mỗi record là một TCP round-trip riêng: ở RTT 5 ms bạn bị chặn cứng quanh vài trăm message mỗi giây. Với batch 1 MB, `linger.ms=10`, và nén `zstd`, một thread producer đơn lẻ đẩy cỡ **100k+ record nhỏ mỗi giây** — riêng zstd thường cắt 3–10× số byte trên dây cho payload dạng text, và đó thường là khoảng cách giữa "network là nút thắt" và "batch drain tức thì".

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
props.put(ProducerConfig.LINGER_MS_CONFIG, 10);
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 1_048_576);
```

Ba giá trị `acks` là một núm chỉnh durability, không phải cài tốc độ:

- `acks=0` — fire and forget. Mất dữ liệu ở bất kỳ cú trục trặc nào. Ổn cho metrics, điên rồ cho ledger.
- `acks=1` — leader ack sau khi ghi vào log cục bộ của nó. **Nguy hiểm trong prod:** leader có thể ack, rồi crash trước khi các follower kịp replicate, và record "đã gửi thành công" của bạn biến mất. Bạn đã nói với nghiệp vụ nó durable mà nó thì không.
- `acks=all` — ack chỉ sau khi mọi in-sync replica đã append (với `min.insync.replicas` bảo vệ _bao nhiêu_ cái đó — phần 4).

Và cái gotcha về ordering: với retries bật, `max.in.flight.requests.per.connection > 1` có thể làm đảo thứ tự message khi retry — batch A fail, batch B thành công, A retry sau B. Cách sửa cũ (in-flight = 1) giết throughput. Cách sửa hiện đại là `enable.idempotence=true`, giữ nguyên ordering nhờ sequence numbers trong khi vẫn cho in-flight > 1. Idempotence không chỉ là cái khiên chống duplicate; nó còn là đảm bảo ordering của bạn.

> Bài tập: "Throughput producer của tôi đứng ở 2k msg/s trên RTT 1 ms. Tôi đổi gì trước?" — batching và nén, không bao giờ `acks=0`. Rồi: "điều đó có giúp gì nếu nút thắt là một hot partition?" — câu hỏi của phần 5.

## 4. Replication & durability — ISR, `min.insync.replicas`, và cái bẫy availability

Write path là: leader append vào segment của nó (page cache), các follower fetch và append, và leader ack một khi **ISR** — tập in-sync replica — đã có nó. Durability trong Kafka là một thuộc tính _replication_, không phải thuộc tính fsync; `acks=all` + RF≥3 là cụm từ phỏng vấn viên muốn nghe, nhưng câu đầy đủ phải gồm cả `min.insync.replicas`.

- **RF (replication factor)** — bao nhiêu bản sao của mỗi partition tồn tại trải khắp các broker.
- **ISR** — tập con của các bản sao đó thực sự bắt kịp (in-sync với leader, được theo dõi qua lag của high-watermark).
- **`min.insync.replicas`** — cái sàn leader yêu cầu trước khi nó chịu ack một cú ghi `acks=all`.

Nên điểm ngọt production là `RF=3`, `min.insync.replicas=2`, `acks=all`: leader chỉ ack khi **hai** replica giữ record. Mất một broker là chuyện không đáng bàn. Và cái bẫy xuất hiện trong phỏng vấn: `acks=all` với `min.insync.replicas=1` **không** durable hơn `acks=1` — leader một mình là cả ISR, nên leader có thể ack rồi chết trước khi bất kỳ ai khác kịp nhìn thấy record. "All" nghĩa là tất cả _in-sync_ replica; `min.insync.replicas` mới là con số thật.

Tradeoff availability là câu follow-up: với `min.insync.replicas=2` trên cluster 3 broker, mất **hai** broker thì partition ngừng nhận ghi — bạn gặp `NotEnoughReplicasException` và một hàng đợi request fail. Đó không phải bug; đó là bạn chọn durability thay vì availability. Lựa chọn còn lại là `min.insync.replicas=1`, nơi một leader cô độc luôn nhận được ghi nhưng một broker chết duy nhất có thể làm mất dữ liệu đã ack. Không có cài đặt nào cho bạn cả hai.

**Unclean leader election** là góc tối nhất của phần này. Nếu mọi replica trong ISR đều chết và bạn bật `unclean.leader.election.enable=true`, controller có thể nâng một replica out-of-sync lên làm leader — partition vẫn _available_ nhưng âm thầm **phục vụ read và ack write cho dữ liệu chưa bao giờ được replicate**. Còn với nó false, partition rơi vào unavailable tới khi một thành viên ISR quay lại. Availability hay data integrity; chọn một và nói rõ cho nghiệp vụ cái nào.

Và điểm page-cache ở phần 1 trả cổ tức ở đây: mỗi follower replica về bản chất là một vòng đọc liên tục từ page cache của leader. Một topic replicate với RF=3 tốn leader ~2× write I/O cộng network tới các follower — cái fan-out replication đó thường là lý do "write của tôi chậm" thực ra là "RF của tôi là 3 và NIC của tôi đang bão hòa".

> Bài tập: "Một broker của tôi chết và tôi không mất dữ liệu. Chứng minh điều đó xảy ra như thế nào — và chuyện gì xảy ra khi broker thứ hai chết?" Câu trả lời senior nêu tên ISR, high-watermark, và exception nào producer thấy, rồi nói thẳng: write sẽ block tới khi một thành viên ISR quay lại, hoặc bạn lật `unclean.leader.election.enable` và chấp nhận rủi ro mất dữ liệu.

## 5. Partitioning & ordering — hot key, grow-only sizing, và parallelism theo key

Ordering cho một entity trong Kafka thì đơn giản và bị vi phạm bằng một nghìn cách tinh vi. Nếu order quan trọng với `order-123`, mọi event của nó phải rơi vào **cùng một partition**, nên bạn key theo entity id:

```java
producer.send(new ProducerRecord<>("orders", e.orderId(), e.payload()));   // key = orderId
```

Cái giá là **hot key**. Một entity khổng lồ — tài khoản celebrity, top seller, khách hàng bận rộn nhất của ngân hàng — rơi vào một partition, làm bão hòa leader của partition đó, và hệ thống "đã scale" của bạn có một cái trần một-partition trong khi 99 partition còn lại ngồi chơi. Các cách sửa, theo thứ tự senior:

1. **Composite key: `shard + entityId`**, với `shard = hash(entityId) % N`. Mỗi entity trải đều qua N shard, nên leader có thể parallelize. Cái giá: event của một entity mất thứ tự global giữa các shard — thường chấp nhận được nếu consumer của bạn sắp xếp lại theo một timestamp đơn điệu hoặc bạn chỉ cần ordering theo từng shard.
2. **Partition theo một hạt thô hơn** (ví dụ `customerId` khi entity hot là một sản phẩm) và chấp nhận rằng khách hàng hot nhất là cái trần. Trung thực, đơn giản, và thường là quyết định đúng.
3. **Buffering / rate-limit phía producer** cho ca bệnh lý, để một key không thể bỏ đói phần còn lại.

### Số partition: grow-only, nên cỡ cho tương lai

Hai sự thật cứng khiến đây trở thành câu hỏi senior:

- **Bạn chỉ có thể thêm partition, không bao giờ xóa.** Kafka cố tình cấm thu nhỏ. Nên con số bạn chọn hôm nay là một cái sàn mãi mãi, và size sai nghĩa là một cuộc migration chạm vào mọi consumer, mọi metric, mọi dashboard.
- **Thêm partition âm thầm phá vỡ ordering theo entity.** Khi số partition đổi, ánh xạ key→partition đổi theo (partitioner mặc định hash key). Các event mới của `order-123` rơi vào một partition khác với các event cũ, nên bất kỳ thứ gì đọc lịch sử-cộng-tin-mới cho một entity giờ thấy phần đuôi tới lệch thứ tự. "Tôi thêm partition khi cần là được" là một quyết định hỏng dữ liệu đội lốt scale.

Phép toán sizing: một partition đơn lẻ trên broker hiện đại chịu cỡ **10–30 MB/s write (khoảng vài chục nghìn record nhỏ mỗi giây)**. Nên:

```
partitions ≈ (peak throughput bạn phải hấp thụ) / (throughput mỗi partition) × headroom
            ÷ số consumer tối đa dự kiến mỗi group (mỗi consumer cần một partition để có ích)
```

Nếu bạn kỳ vọng peak 300 MB/s, đó là ~15–30 partitions — và bạn lấy headroom _trước khi_ nhân với số consumer, vì consumer nhiều hơn partition là capacity rỗi (phần 1). Mỗi partition cũng tốn những thứ thật: file descriptors, metadata controller/`KRaft`, và **thời gian rebalance** — mỗi full rebalance tăng theo số partition, và đó là cách một cluster 50k partition biến một cú deploy 5 phút thành 10 phút.

### Order theo key kèm parallelism — định luật Little trong consumer

Cách ngây thơ "tăng tốc consumer của tôi bằng một thread pool" chính là cách bạn đánh mất ordering theo key:

```java
// WRONG: một pool thô phá vỡ order theo key ngay khi hai event của cùng key đua nhau
ExecutorService pool = Executors.newFixedThreadPool(32);
for (ConsumerRecord<String, byte[]> r : batch) {
    pool.submit(() -> process(r));   // event của order-123 giờ có thể chạy lệch trình tự
}

// RIGHT: shard theo key — mỗi key luôn được xử lý bởi cùng một worker đơn thread
class KeyedExecutor {
    final ExecutorService[] workers = IntStream.range(0, 32)
        .mapToObj(i -> Executors.newSingleThreadExecutor())
        .toArray(ExecutorService[]::new);

    CompletableFuture<Void> submit(String key, Runnable task) {
        int slot = Math.floorMod(key.hashCode(), workers.length);
        return CompletableFuture.runAsync(task, workers[slot]);
    }
}
```

Size nó lại là định luật Little — cùng công thức size connection pool:

```
concurrency cần  =  messages/second  ×  giây mỗi message
vd: 10.000 msg/s × 0.01 s  =  100 worker đang in-flight
```

Nhưng có một cái trần chẳng ai nhắc: **worker không thể vượt quá partition mà vẫn có ích.** Nhiều worker hơn partition nghĩa là một số worker rỗi (shard của chúng không có partition để kéo); ít worker hơn partition nghĩa là một số partition xếp hàng sau pool. Quy tắc vàng: parallelize tới _số partition_, không phải tới số CPU, nếu bạn cần order theo key — rồi để mắt tới queue depth của từng worker, vì một worker đơn thread đầy ắp chính là một hot key đội lốt.

> Bài tập: "Topic `orders` của tôi xử lý 200 MB/s. Size nó và biện hộ." Câu trả lời senior đưa ra một con số, rồi thêm "và tôi không thể thu nhỏ nó, và nếu tôi thêm partition sau này tôi phá vỡ order theo key" một cách không cần nhắc.

## 6. Consumer loop, lag, rebalance, và poison message

Cái poll loop trông như một `while(true)` và một `poll()`. Mọi thứ cắn bạn trong production đều ẩn trong các núm chỉnh quanh nó:

```java
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 500);
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, 300_000);   // default 5 phút
props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, 10_000);      // default lỏng hơn; 10s là phổ biến
props.put(ConsumerConfig.HEARTBEAT_INTERVAL_MS_CONFIG, 3_000);    // phải ≤ session.timeout / 3
```

Trong lúc bạn ở trong poll loop, client không gửi heartbeat được. Hai cái timer quyết định số phận bạn:

- **`session.timeout.ms`** — nếu coordinator lỡ heartbeat của bạn quá lâu, bạn chết → **rebalance**.
- **`max.poll.interval.ms`** — nếu bạn mất lâu hơn thế giữa các lần `poll()`, coordinator _mặc định_ bạn bị kẹt và đá bạn ra → **rebalance**, dù heartbeat của bạn vẫn ổn.

Con số quan trọng: 500 record mỗi poll, mỗi cái tốn 700 ms xử lý → **5,8 phút mỗi poll**, vượt qua default 5 phút → consumer bị đá khỏi chính group của nó mỗi vòng, mãi mãi. Đây là sự cố kinh điển "consumer của tôi cứ rebalance", và cách sửa là: ít record hơn mỗi poll, xử lý nhanh hơn (async), hoặc một con số interval lớn hơn có căn cứ — không bao giờ lười "cứ bump lên".

### Rebalance: hai protocol và cơn bão

- **Eager (default cũ):** stop-the-world. Mọi member vứt partition của mình, coordinator gán lại hết, mọi người tham gia lại. Trên một group hàng nghìn partition, cú tạm dừng đó tính bằng giây — và mỗi giây đó là một partition không có consumer.
- **Cooperative-sticky (KIP-429, default hiện đại):** chỉ các member bị ảnh hưởng revoke, và chỉ những cái đó tham gia lại. Rebalance đi từ "mọi consumer đóng băng vài giây" tới "một nhúm partition dịch chuyển trong dưới một giây".

**Rebalance storm** là sự churn — consumer rời đi và quay lại trong một vòng lặp, mỗi vòng đóng băng cả group. Nguyên nhân gốc theo thứ tự production: một cú full GC pause đủ lâu để chạm `session.timeout.ms` (một STW pause 6 giây so với timeout 10 giây là một lần rebalance), xử lý thổi bay `max.poll.interval.ms`, hoặc code subscribe/unsubscribe theo từng request. Cách sửa senior là instrumentation, không phải lời cầu nguyện: **theo dõi rebalance time và rebalance rate** như những metric hạng nhất, và chỉnh timeout sao cho thứ _chậm nhất_ bạn làm vẫn vừa.

### Consumer lag — tín hiệu đầu tiên, và đọc nó cho đúng

**Lag = log-end-offset − consumer-offset** cho một partition. Nó là triệu chứng đầu tiên của gần như mọi vấn đề consumer, nhưng nó là triệu chứng, không phải chẩn đoán. Cách đọc của senior:

- **Lag phẳng trên mọi partition, drain theo từng đợt spike** → producer bursty, consumer khỏe. Bình thường.
- **Lag tăng trên _mọi_ partition trong khi consumer ngồi ở ~100% CPU** → vấn đề capacity: bạn cần nhiều partition/consumer hơn hoặc xử lý nhanh hơn, và định luật Little ở phần 5 cho bạn biết bao nhiêu.
- **Lag tăng trên _một_ partition trong khi phần còn lại drain** → một hot key (phần 5), không phải vấn đề capacity. Ném thêm consumer vào chẳng đổi gì — một partition, một consumer, theo cấu trúc.
- **Lag tăng trong khi CPU consumer rỗi** → một sink chậm: DB của bạn, một API ngoài, hay bảng dedupe mới là nút thắt thật. Consumer đang xếp hàng trên I/O, không phải chết đói.

> Bài tập: "Lag đang leo nhưng CPU consumer ở 30%. Bạn làm gì?" — và câu trả lời sai là "thêm consumer". Câu trả lời đúng gọi tên sink, rồi hot key, rồi capacity — theo đúng thứ tự đó.

### Poison messages và DLQ — lời hứa trong tiêu đề phần

Một **poison message** là một record luôn luôn ném exception — JSON hỏng, một schema version consumer của bạn không biết, một business rule bác bỏ nó. Và đây là cơ chế khiến nó thành thảm họa: một consumer **đọc, fail, đọc lại**. Không xử lý, cái record đó bị xử lý lại trong mọi lần poll, consumer không bao giờ commit qua được nó, và **toàn bộ partition kẹt vĩnh viễn** trong khi lag tăng không giới hạn. Một record hỏng trong một triệu record có thể đóng băng một pipeline order suốt một cuối tuần.

```java
// WRONG: để record rác loop mãi → partition kẹt, lag tăng không giới hạn
while (true) {
    for (ConsumerRecord<String, byte[]> r : consumer.poll(Duration.ofMillis(100))) {
        process(r);    // ném exception → poll kế tiếp trả cùng record → mãi mãi
    }
}

// RIGHT: retry trong process có chặn trên cho lỗi transient, rồi cách ly record rác
while (true) {
    for (ConsumerRecord<String, byte[]> r : consumer.poll(Duration.ofMillis(100))) {
        int attempt = 0;
        while (true) {
            try {
                process(r);
                break;
            } catch (PoisonException e) {
                sendToDlq(r, e);          // giữ key + partition + offset trong headers
                dlqCount.increment();
                break;
            } catch (TransientException e) {
                if (++attempt >= 3) { sendToDlq(r, e); break; }
                Thread.sleep(200L * attempt);   // backoff 200ms, 400ms, 600ms
            }
        }
    }
    consumer.commitSync();
}
```

Các chi tiết thiết kế DLQ mà phỏng vấn viên khoan:

- **Giữ provenance.** Ghi partition gốc, offset, timestamp, và exception vào headers của record DLQ, để kỹ sư ops tìm thấy record rác trong năm phút, không phải năm ngày.
- **Không bao giờ block partition.** DLQ _chính là_ cơ chế cho phép consumer commit và đi tiếp. Một DLQ không có commit-on-success chỉ là một vòng poison chậm hơn.
- **Một topic DLQ là một vấn đề production, không phải một cách sửa.** Phải có người consume nó — replay với code đã _sửa_, hoặc bỏ đi có chủ đích. Một DLQ không ai đọc chỉ là một poison topic thứ hai mà bạn không đọc.
- **Retry topic vs retry trong process.** Một pipeline retry-topic đầy đủ (fail → retry topic có delay → đọc lại) sống sót qua restart process, khác với `Thread.sleep` ở trên, cái chết chung với JVM. Chọn theo việc "xử lý lại sau crash" có quan trọng hay không.

> Bài tập: "Lag của một partition đang spike và log consumer hiện cùng một record mỗi hai giây." Câu trả lời senior gọi tên poison message, phác DLQ với headers provenance, và — phần thắng điểm — trả lời "ai consume DLQ, và khi nào?"

## 7. Kafka → database của bạn — outbox và cái bẫy exactly-once

Phần 2 đã xác lập rằng transaction của Kafka dừng ở ranh giới cluster. Vậy hệ thống senior thực sự làm thế nào để "state nghiệp vụ và event nhất quán"? **Transactional outbox** — pattern khiến database của bạn là source of truth cho cả hai.

Ghi row nghiệp vụ và event đi ra trong **cùng một transaction database**:

```sql
BEGIN;
UPDATE orders SET status = 'PAID' WHERE id = :orderId;
INSERT INTO outbox (id, aggregate_id, event_type, payload, created_at)
VALUES (:eventId, :orderId, 'ORDER_PAID', :payload, NOW());
COMMIT;
```

Giờ bước "publish lên Kafka" được tách rời và an toàn: hoặc toàn bộ transaction commit (state **và** event), hoặc nó rollback (không cái nào). Rồi một relay drain outbox và publish:

- **Một poller** — `SELECT ... FROM outbox WHERE published_at IS NULL`, publish, đánh dấu đã publish. Đơn giản, nhưng double-publish nếu crash trừ khi bạn đánh dấu idempotent.
- **CDC (Debezium)** — binlog/WAL của DB _chính là_ nguồn; một Debezium connector biến mỗi outbox insert thành một Kafka record. Không vòng poll, không cửa sổ delivery 5 giây, không thêm read traffic.

Khung trung thực phỏng vấn viên muốn: outbox cho bạn **atomicity** giữa commit DB và publish Kafka, và đó là thứ gần nhất ngành có được với "exactly once" kéo căng qua một database và một broker. Cái nó **không** cho bạn là exactly-once _delivery_ tới một consumer downstream — relay có thể crash sau publish hoặc consumer có thể crash giữa chừng, nên consumer downstream vẫn bắt buộc idempotent (phần 2). Outbox đóng cái lỗ atomicity; nó không bao giờ gỡ bỏ nhu cầu idempotency.

Hai anti-pattern nó giết: **publish-then-write** (event đã gửi, write DB fail → cả thế giới biết về một order chưa từng tồn tại) và **write-then-publish** không có outbox (DB đã commit, producer fail → event mất âm thầm, và không ai chứng minh được cái lỗ vừa xảy ra vì chẳng có bản ghi về event dự định).

> Bài tập: "Làm thế nào tôi có exactly-once delivery từ Kafka tới Postgres?" Câu trả lời sai là một câu tự tin "Kafka transactions". Câu trả lời senior là "bạn không có — bạn có atomicity bằng outbox, và idempotency bằng một unique key, và đây là chỗ mỗi cái dừng lại."

## 8. Tự kiểm tra

- [ ] Kể tên ba delivery semantics và dựng chính xác interleaving khi at-least-once làm trùng một record.
- [ ] Giải thích `enable.idempotence` và Kafka transactions thực sự làm gì — PID, sequence numbers, coordinator — và vì sao không cái nào bảo vệ cú ghi database của bạn.
- [ ] Size số partition của một topic từ phép toán throughput và biện hộ vì sao nó grow-only — kể cả chuyện gì xảy ra với order theo entity nếu bạn thêm partition.
- [ ] Biện hộ `acks=all` + `min.insync.replicas=2` + RF=3, và nêu chính xác chuyện gì xảy ra khi hai trong ba broker chết.
- [ ] Giải thích vì sao `acks=all` với `min.insync.replicas=1` barely durable hơn `acks=1`.
- [ ] Chẩn đoán "lag tăng trên một partition" vs "lag tăng khắp nơi với CPU rỗi" và gọi tên các cách sửa khác nhau.
- [ ] Viết handler poison-message với retry có chặn trên và một DLQ giữ partition, offset, và exception.
- [ ] Thiết kế transactional outbox bằng SQL và giải thích nó đảm bảo gì và không đảm bảo gì.
- [ ] Size worker pool của consumer sao cho order theo key được giữ, dùng cả định luật Little lẫn số partition làm cái trần.

## 9. Interviewer follow-ups

Khi câu trả lời đầu tiên của bạn chạm đúng, họ bắt đầu khoan. Sẵn sàng cho những câu này:

- "Bạn có 12 consumer trong một group và 4 partition. Chuyện gì xảy ra, và cách sửa là gì?"
- "`acks=all` với `min.insync.replicas=1` — có durable không? Vì sao?"
- "Consumer lag của tôi đang tăng, CPU rỗi, và DB ở 40%. Nút thắt ở đâu?"
- "Bạn thêm 4 partition vào một topic mà consumer phụ thuộc vào order theo key. Cái gì vỡ, và bạn phát hiện nó thế nào?"
- "`enable.idempotence=true` — nó bảo vệ bạn khỏi gì, và không bảo vệ khỏi gì?"
- "Làm thế nào bạn có exactly-once delivery từ Kafka tới Postgres?" (bẫy: bạn không có — outbox cộng idempotency.)
- "Một record trong một triệu luôn ném exception. Chuyện gì xảy ra với partition, và bạn giữ pipeline chạy thế nào?"
- "Consumer của tôi bị đá khỏi group vài phút một lần. Hai cái timer nào bạn kiểm tra, và con số nào là manh mối?"
- "Khác biệt giữa retention và compaction — và khi nào compaction cắn bạn trong production?"
- "Bạn parallelize một consumer thế nào mà vẫn giữ order theo key, và cái trần của parallelism của bạn là gì?"
- "Một full GC dừng consumer của bạn 6 giây. Config nào giờ đã sai, và group làm gì?"

Đó là bar Kafka.
