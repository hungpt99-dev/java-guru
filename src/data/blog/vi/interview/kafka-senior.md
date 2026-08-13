---
title: "Ôn thi Java #5: Apache Kafka — Junior đến Senior"
description: "Hệ thống event-driven trên Kafka — delivery semantics, replication, partitioning cho thứ tự, consumer lag, và dead-letter queue mọi consumer production đều cần."
pubDatetime: 2026-08-10T10:20:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - kafka
  - event-driven
---

Kafka là chủ đề phỏng vấn tách biệt "tôi đã gửi một message" và "tôi hiểu một distributed log". Junior produce và consume; senior lập luận về ordering, exactly-once, và chuyện gì khi consumer tụt hậu. Bài này đi từ topic đến delivery guarantee đến consumer lag ở scale.

> Mindset: junior gửi một record và cầu nó tới; senior kể được semantics chính xác của "tới" và họ xây gì để một poison message không bao giờ gục pipeline.

## Junior — nền tảng

**Q1. Topic, partition, và offset là gì?**
**Topic** là một log có tên (một stream của events). Nó chia thành **partition** — ordered, immutable, append-only log. Mỗi record trong một partition có một **offset** tuần tự. Consumer track offset để biết vị trí. Nhiều partition = nhiều parallelism, nhưng cũng nhiều open file và election overhead.

**Q2. Producer và consumer là gì?**
Producer append record vào topic (chọn partition bằng key hoặc round-robin). Consumer đọc record; consumer trong cùng một **consumer group** chia partition cho nhau, nên mỗi partition được đúng một member của group consume. Thêm consumer vượt số partition thì thừa (idle).

**Q3. Consumer group là gì?**
Consumer group là một tập consumer cùng xử lý một topic — Kafka assign mỗi partition cho một member. Nếu một member chết, partition của nó được reassigned (rebalance) cho những người sống sót. Các group khác nhau mỗi cái có view độc lập của toàn bộ topic.

**Q4. Khác nhau giữa queue và Kafka topic (log)?**
Queue truyền thống xóa message một khi consumed; nhiều consumer tranh cùng message. Kafka topic là **append-only log** — mọi consumer đọc whole history tại offset riêng; message không bị xóa khi đọc (chúng expire theo retention). Đó là gì enable replay và nhiều consumer độc lập.

**Q5. `acks` trong producer là gì, và tại sao quan trọng?**
`acks=0`: fire-and-forget (không guarantee). `acks=1`: leader acknowledge khi đã viết record (mất nếu leader chết trước replicate). `acks=all`: leader chờ đến khi **in-sync replica** có nó — durability mạnh nhất, throughput thấp hơn. Durability và latency trade trực tiếp.

**Q6. Keyed message là gì và tại sao dùng?**
Khi set key, Kafka route tất cả record cùng key vào **cùng partition** (qua hash). Điều đó cho bạn **per-key ordering** — thiết yếu cho "mọi event của user 42 theo thứ tự". Record không key bị round-robin, không guarantee ordering.

## Mid — tradeoff & điểm mù

**Q1. Giải thích delivery semantics: at-most-once, at-least-once, exactly-once.**

- **At-most-once**: producer có thể mất message (acks=0); consumer có thể skip (commit offset trước khi process). Không duplicate, có thể mất.
- **At-least-once**: producer retry đến khi acked (acks=all); consumer process rồi commit. Không mất, nhưng duplicate có thể (crash sau process, trước commit → reprocess).
- **Exactly-once**: cần idempotent producer + transactional write + consumer idempotency, hoặc Kafka transaction. Khó hơn; thường người ta chốt at-least-once + idempotent processing.

**Q2. Làm sao có per-key ordering, và gì phá nó?**
Set key → cùng partition → in-order trong partition đó. Phá nó: đổi partition count (rehash chuyển key sang partition mới, phá order trong cửa sổ), hoặc partition reassignment giữa stream. Cũng, nếu bạn process concurrent trong một partition bạn có thể reorder ở mức _effect_. Ordering là per-partition, không bao giờ global, trừ khi một partition (không parallelism).

**Q3. Consumer lag là gì và tại sao monitor nó?**
**Consumer lag** = số record produced nhưng chưa consumed (high-water-mark offset trừ committed offset). Lag tăng nghĩa consumer không kịp — downstream stale, và nếu consumer tụt xa, rebalance hoặc retention-based data loss có thể xảy ra. Monitor lag per partition; alert trước khi cạn retention.

**Q4. Idempotent production là gì và hoạt động ra sao?**
Idempotent producer (`enable.idempotence=true`) có producer ID và sequence number; broker deduplicate retry trong một session, nên `send` retry không tạo duplicate. Nó là at-least-once không duplicate từ retry. Ghép với keyed partition cho ordered retry an toàn.

**Q5. Rebalance là gì và làm nó rẻ thế nào?**
Rebalance redistribute partition khi consumer join/leave (crash, deploy, timeout). Trong rebalance, **mọi** consumer trong group ngừng consume (stop-the-world cho group), commit offset, và resume. Rebalance thường xuyên (vd từ slow poll heartbeat timeout) gây throughput cliff. Giảm nhẹ bằng tune `max.poll.interval.ms` và incremental cooperative rebalancing.

**Q6. Chuyện gì khi broker chết — replication và ISR?**
Mỗi partition có một leader (trên một broker) và follower (replica trên broker khác). Tập **in-sync replica (ISR)** là follower bắt kịp trong `replica.lag.time`. Nếu leader chết, một ISR follower được bầu. Nếu bạn set `acks=all` và `min.insync.replicas=2`, một write cần 2 ISR — bạn sống sót mất một broker không data loss. Mất quá nhiều broker có thể làm partition unavailable (durability over availability trade).

## Senior — thiết kế & phòng thủ

**Q1. Một consumer liên tục crash trên một message xấu (poison pill). Thiết kế xử lý.**
"Tôi không bao giờ để một record gục pipeline. Tôi wrap processing trong try/catch; trên non-retryable error tôi publish record lỗi sang **dead-letter topic** (với error context) và `ack` original để consumer tiến lên. Một monitor/alert riêng watch DLQ. Cho retryable error tôi dùng retry topic với backoff (hoặc Spring Kafka `SeekToCurrentErrorHandler`). Nguyên tắc thiết kế chính: poison message phải tiến pipeline lên, không dừng nó."

**Q2. Bạn cần global ordering của 1M events/sec. Làm gì?**
"Global ordering nghĩa một partition — giới hạn tôi ở một consumer và giết throughput. Nên tôi thách thức requirement: bạn thực sự cần order _global_, hay _per-entity_? Gần như luôn là per-entity (per-order, per-user), keying cho bạn ở full parallelism. Nếu global order thực sự cần, tôi chấp nhận single-partition throughput ceiling và scale bằng partitioning the _problem_ (vd shard stream theo time window) hoặc xem lại Kafka có đúng tool không — total-order requirement chống lại thiết kế Kafka."

**Q3. Consumer lag vọt lên 2M trên một partition trong deploy. Chẩn đoán.**
"Đầu tiên, spike tương quan với rebalance từ rolling deploy — consumer dừng, lag tích, rồi resume. Nếu lag không drain sau đó, consumer giờ chậm hơn produce rate (có thể một synchronous call mới trong handler). Tôi check: per-partition lag (có một hot partition? — key skew), consumer CPU, và `max.poll.records` / processing time per batch có quá cao gây poll-timeout rebalance không. Fix: tăng partition cho hot key, parallelize handling, nâng `max.poll.interval.ms`. Tôi đo drain rate vs produce rate để confirm recovery."

**Q4. Thiết kế exactly-once cho flow 'consume DB update + produce event'.**
"Naive at-least-once double-write trên crash. Lựa chọn: (1) Kafka **transaction** (`read_committed` consumer isolation) — consume+produce+offset-commit xảy ra nguyên tử; crash hoặc fully commit hoặc fully rollback. (2) Idempotent sink: viết vào DB với offset là unique key, nên reprocessing là no-op. Tôi thích idempotent-sink pattern khi khả thi (đơn giản, không transaction overhead); dùng Kafka transaction khi event phải atomic với offset commit. Dù cách nào, consumer phải idempotent — exactly-once là property của _toàn bộ_ pipeline, không phải producer flag."

**Q5. Bạn size partition cho topic expecting 50k msg/s với 10 consumer thế nào?**
"Throughput per partition bị giới hạn (~tens of MB/s, nhưng thực tế giới hạn bởi processing của một consumer). Tôi size partition ≈ `target_consumer_parallelism / single_consumer_throughput × safety`. Với 10 consumer mỗi cái xử lý ~10k msg/s, tôi set ~20–30 partition (2–3× consumer) để rebalance và skewed key vẫn còn headroom. Quá ít = consumer idle; quá nhiều = file-handle và metadata overhead, và rebalance dài hơn. Tôi validate bằng load-test max consume rate của một partition, rồi chia."

**Q6. Phòng thủ retention policy và 'data loss' thực sự nghĩa gì trong Kafka.**
"Retention (vd 7 ngày) nghĩa record cũ hơn bị xóa bất kể consumption — nên nếu consumer down >7 ngày, record đó _mất_, không replay được. 'Data loss' trong Kafka thường là retention-based, không phải broker failure (với RF≥3 và min.insync.replicas=2, broker loss survivable). Tôi set retention theo longest plausible reprocessing window + buffer, và cho stream critical thực sự durable dùng tiered storage hoặc mirror sang cold store. Tôi phòng thủ retention bằng reprocessing SLA, không phải đoán."

#### Self-check

- [ ] Junior: Tôi giải thích được topic/partition/offset, producer vs consumer, consumer group, log vs queue, `acks`, và keyed message.
- [ ] Mid: Tôi giải thích được ba delivery semantics, per-key ordering và gì phá nó, consumer lag, idempotent production, rebalance, và ISR/replication.
- [ ] Senior: Tôi thiết kế được poison-message handling với DLQ, thách thức false global-ordering need, chẩn đoán lag spike trong deploy, thiết kế exactly-once qua idempotent sink hoặc transaction, size partition từ load, và phòng thủ retention bằng reprocessing SLA.
