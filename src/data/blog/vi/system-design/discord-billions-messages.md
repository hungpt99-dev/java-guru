---
title: "Discord Lưu Trữ Hàng Tỷ Tin Nhắn: Bài học từ việc chuyển từ Cassandra sang ScyllaDB"
description: "Phân tích có dẫn nguồn về quá trình lưu trữ tin nhắn của Discord, mô hình hóa dữ liệu Cassandra và thiết kế di trú sang ScyllaDB được tách biệt rõ ràng."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

Tiêu đề đặt ra một câu hỏi kỹ thuật thú vị, nhưng nguồn lịch sử hiện có có một giới hạn quan trọng: nguồn này không nói rằng Discord đã hoàn tất việc chuyển đổi từ Cassandra sang ScyllaDB. Nguồn mô tả Cassandra đang chạy trong production và đề cập Scylla như một lựa chọn có thể cân nhắc về dài hạn.

Bài viết giữ rõ sự phân biệt này. Mục tiêu không phải khẳng định Discord đã thực hiện một migration mà nguồn không đề cập, mà là dùng kinh nghiệm kỹ thuật thực tế của Discord làm cơ sở để hiểu thiết kế lưu trữ, sau đó mở rộng thành một kịch bản migration được đề xuất.

## 1. Bài toán kỹ thuật ban đầu

[SOURCE FACT] Discord muốn lưu giữ lịch sử chat trong thời gian dài trong khi số lượng tin nhắn tiếp tục tăng rất nhanh. Dữ liệu đồng thời phải luôn sẵn sàng và hỗ trợ đọc/ghi với hiệu năng có thể dự đoán được. Theo bài viết nguồn, lưu lượng tăng từ 40 triệu tin nhắn mỗi ngày vào tháng 7 lên 100 triệu vào tháng 12 và hơn 120 triệu vào tháng 1/2017. Discord, “How Discord Stores Billions of Messages”

[SOURCE FACT] Ban đầu Discord lưu tin nhắn trong một MongoDB replica set với compound index trên channel_id và created_at. Khi hệ thống đạt khoảng 100 triệu tin nhắn, dữ liệu và index không còn vừa trong RAM. Kết quả là latency của query trở nên khó dự đoán. Source

[ANALYSIS] Vấn đề cốt lõi liên quan chặt chẽ đến cách ứng dụng truy cập tin nhắn. Phần lớn request cần lấy một khoảng tin nhắn trong một channel cụ thể, thay vì thực hiện các truy vấn quan hệ tùy ý.

Điều này khiến data model của hệ thống lưu trữ trở thành một yếu tố rất quan trọng.

Có một số thách thức chính:

- Các channel ít hoạt động có thể yêu cầu random disk reads.
- Các public channel có lưu lượng rất cao có thể tạo ra những vùng dữ liệu gần nhất bị truy cập rất nhiều.
- Tin nhắn bị xóa có thể để lại một lượng lớn tombstone.
- Khi lượng dữ liệu tăng lên, việc giữ partition ở kích thước hợp lý ngày càng trở nên quan trọng.

Bài học quan trọng là ở quy mô này, chọn database mới chỉ là một phần của bài toán. Data model và access pattern phải phù hợp với nhau.

## 2. Hệ thống ban đầu đã làm gì

[SOURCE FACT] Discord chuyển từ MongoDB sang Cassandra vì Cassandra phù hợp với các yêu cầu mà họ xác định tại thời điểm đó. Các yêu cầu này bao gồm khả năng scale bằng cách thêm node, automatic failover, chi phí vận hành thấp, hiệu năng có thể dự đoán, không cần một message cache riêng, data model không dựa trên các blob lớn và khả năng sử dụng mã nguồn mở. Source

[SOURCE FACT] Discord sử dụng dark launch trong quá trình migration. Ứng dụng tạm thời đọc và ghi vào cả MongoDB và Cassandra trước khi Cassandra trở thành primary store. Trong một tuần kiểm thử, latency đọc của Cassandra được ghi nhận dưới 5 ms và ghi dưới 1 ms. Sau đó Discord báo cáo một cluster 12 node với replication factor bằng 3. Đây là các số liệu và cấu hình trong lịch sử, không phải khuyến nghị capacity hiện tại. Source

Key đầu tiên của Cassandra là:

```text
(channel_id, message_id)
```

[SOURCE FACT] message_id là Snowflake ID, cung cấp thứ tự theo thời gian.

Thiết kế này hoạt động tốt trong giai đoạn đầu, nhưng các channel lớn cuối cùng vẫn tạo ra những partition rất lớn.

Discord vì vậy đã đưa vào time bucket và đổi key thành:

```text
((channel_id, bucket), message_id)
```

[SOURCE FACT] Với các channel lớn nhất, nguồn cho biết Discord sử dụng bucket khoảng 10 ngày để giữ partition ở mức thấp hơn đáng kể so với 100 MB. Source

Đây là một thay đổi quan trọng trong thiết kế.

Thay vì để toàn bộ tin nhắn của một channel nằm trong một partition liên tục tăng kích thước, dữ liệu được chia thành các khoảng thời gian nhỏ hơn.

Ví dụ:

```text
Channel A
│
├── Bucket 1: Jan 1 - Jan 10
├── Bucket 2: Jan 11 - Jan 20
├── Bucket 3: Jan 21 - Jan 30
└── Bucket 4: Jan 31 - Feb 9
```

Ứng dụng sau đó có thể xác định bucket nào chứa các tin nhắn cần tìm thay vì phải scan một partition có thể rất lớn.

### Vấn đề Edit/Delete

[SOURCE FACT] Cơ chế upsert và semantics last-write-wins của Cassandra tạo ra race condition giữa edit và delete. Discord sử dụng field bắt buộc author_id để phát hiện các row bị lỗi, xóa các message đó và thay đổi cách ghi để chỉ ghi những field không-null. Delete tạo ra tombstone. Sau một sự cố production liên quan đến hàng triệu message đã bị xóa, Discord giảm thời gian tồn tại của tombstone từ 10 ngày xuống 2 ngày và theo dõi các bucket rỗng để tránh scan lặp lại chúng. Source

Điều này cho thấy một điểm quan trọng về distributed database:

> Một write thành công không đồng nghĩa với việc dữ liệu cuối cùng chắc chắn đúng về mặt nghiệp vụ.

Ứng dụng vẫn cần hiểu rõ cách các edit, delete, retry và dữ liệu chưa đầy đủ tương tác với nhau khi xảy ra đồng thời.

### Cassandra và ScyllaDB

[SOURCE FACT] Nguồn đề cập Scylla như một ý tưởng dài hạn vì quá trình repair của Cassandra trở nên ngốn CPU và mất nhiều thời gian hơn khi lượng dữ liệu tích lũy và số lượng write tăng lên. Nguồn không nói rằng Discord đã hoàn tất migration từ Cassandra sang ScyllaDB. Source

Bài viết Discord thứ hai được sử dụng nói về việc chuyển từ Redis sang relational database. Nó không cung cấp bằng chứng về một migration từ Cassandra sang ScyllaDB. Source

Vì vậy, migration sang ScyllaDB được thảo luận ở phần sau là một bài tập thiết kế được đề xuất, không phải một khẳng định lịch sử về Discord.

## 3. Sơ đồ kiến trúc

Kiến trúc bên dưới phân biệt rõ phần nào được nguồn lịch sử hỗ trợ và phần nào được bổ sung cho thiết kế migration được đề xuất.

```text
flowchart LR
    C[Client]
    API[Message API\n[Source-backed component]]
    MONGO[(MongoDB replica set\n[Source-backed historical component])]
    CAS[(Cassandra cluster\n[Source-backed component])]
    B[Time bucket: channel_id + bucket\n[Source-backed component]]
    REP[Replication and repair\n[Source-backed component]]
    IDX[Empty-bucket tracking\n[Source-backed component]]
    SCY[(ScyllaDB cluster\n[Proposed component])]
    MIG[Migration controller\n[Proposed component]]

    C --> API
    API -. dark launch .-> MONGO
    API --> CAS
    CAS --> B
    CAS --> REP
    API --> IDX
    API -. proposed migration .-> MIG
    MIG --> SCY
    MIG -. validation .-> CAS
```

[SOURCE FACT] Việc dual read/write với MongoDB, Cassandra, time bucket, replication, repair và empty-bucket tracking đều được mô tả trong nguồn.

[PROPOSED DESIGN] ScyllaDB cluster và migration controller là các thành phần được bổ sung cho thiết kế theo kiểu system-design interview trong bài viết này. Không nên hiểu chúng là kiến trúc production mà Discord đã công bố.

## 4. Phân tích System Design

[ANALYSIS] Partition theo (channel_id, bucket) giải quyết hai vấn đề liên quan với nhau.

Thứ nhất, channel_id giữ các message của cùng một channel lại với nhau, phù hợp với access pattern chính.

Thứ hai, bucket giới hạn lượng dữ liệu có thể tích lũy trong một partition.

Điều này quan trọng vì một partition của channel không có giới hạn có thể trở nên tốn kém không chỉ vì chứa nhiều dữ liệu, mà còn vì compaction, delete và read phải xử lý một lượng dữ liệu ngày càng lớn.

### Data Modeling dựa trên Query

Thiết kế được xây dựng có chủ đích xoay quanh những query mà ứng dụng cần thực hiện.

Một request lấy các message gần đây trong một channel có thể:

- Xác định bucket liên quan.
- Đọc một range message_id bên trong partition đó.
- Chuyển sang bucket cũ hơn nếu cần.
- Dừng khi đã lấy đủ số message hợp lệ.

Hệ thống không cần secondary index để tìm xem message nằm ở đâu.

Với một channel ít hoạt động, điều này có thể đồng nghĩa với việc phải kiểm tra nhiều bucket trước khi tìm đủ message.

Với một channel hoạt động mạnh, bucket mới nhất thường đã chứa đủ message gần đây để đáp ứng request.

Đây là một trade-off hợp lý vì common case vẫn hiệu quả trong khi kích thước partition được giới hạn.

### Cassandra vs. ScyllaDB

[ANALYSIS] Cassandra và ScyllaDB có cách tiếp cận data model tương tự nhau, vì vậy có thể sử dụng cùng chiến lược partitioning làm điểm bắt đầu.

Tuy nhiên, data model tương tự không có nghĩa hai hệ thống sẽ hoạt động giống hệt nhau trong production.

Một migration thực tế vẫn cần kiểm chứng:

- Cách repair hoạt động.
- Cách compaction hoạt động.
- Database driver.
- Consistency setting.
- Metrics và monitoring.
- Failure handling.
- Workload isolation.
- Quy trình vận hành.

Vì vậy, chỉ nói rằng ScyllaDB repair nhanh hơn là chưa đủ để biện minh cho một migration. Mức cải thiện kỳ vọng cần được đo trên workload thực tế.

## 5. Data Model

[SOURCE FACT] Nguồn mô tả Cassandra là một data store dựa trên partition key và clustering key. Partition key xác định dữ liệu thuộc về đâu, còn clustering key xác định và sắp xếp các row bên trong partition. Production message key trở thành:

```text
((channel_id, bucket), message_id)
```

Source

[PROPOSED DESIGN] Một table tối thiểu cho cùng access pattern có thể như sau:

```sql
CREATE TABLE messages_by_channel_bucket (
    channel_id bigint,
    bucket date,
    message_id bigint,
    author_id bigint,
    content text,
    created_at timestamp,
    edited_at timestamp,
    PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

Phần quan trọng là primary key:

```text
((channel_id, bucket), message_id)
```

Trong đó:

- channel_id xác định channel.
- bucket giới hạn kích thước của mỗi partition.
- message_id cung cấp thứ tự bên trong partition.

[PROPOSED DESIGN] Bucket phải được tính toán một cách deterministic từ thời gian hoặc ID của message.

Service cũng nên duy trì một lượng metadata nhỏ về các bucket được biết là rỗng. Điều này giúp read path không phải query lặp lại những bucket đã biết chắc là không có message.

Vì edit và delete có thể xảy ra đồng thời, write model cũng cần xử lý vấn đề ordering.

Các hướng tiếp cận có thể gồm:

- Lưu đầy đủ các version của message.
- Cẩn thận khi thực hiện field-aware update.
- Gắn version number hoặc event timestamp.
- Validate các field bắt buộc khi đọc.

Lựa chọn cụ thể phụ thuộc vào consistency và update semantics mà ứng dụng yêu cầu.

## 6. Thiết kế API

[PROPOSED DESIGN] API nên bám sát các operation mà database có thể xử lý hiệu quả:

```text
POST   /channels/{channel_id}/messages
GET    /channels/{channel_id}/messages?before={message_id}&limit={limit}
GET    /channels/{channel_id}/messages?after={message_id}&limit={limit}
PATCH  /channels/{channel_id}/messages/{message_id}
DELETE /channels/{channel_id}/messages/{message_id}
```

Read API sử dụng before và after thay vì numeric offset.

Ví dụ:

```text
GET /channels/123/messages?before=847362918273&limit=50
```

Điều này có nghĩa là:

> Trả về tối đa 50 message cũ hơn message ID được chỉ định.

### Tại sao không dùng Offset Pagination?

Offset pagination không phù hợp với một message table rất lớn và liên tục thay đổi.

Ví dụ:

```text
?page=10000
```

yêu cầu database về mặt logic phải bỏ qua một lượng lớn row trước khi trả về page được yêu cầu.

Cursor dựa trên message ID phù hợp với access pattern này hơn.

[ANALYSIS] Read service có thể tính các bucket candidate liên quan từ cursor, bỏ qua các bucket đã biết là rỗng, query từng partition theo thứ tự và dừng khi đã lấy đủ số row hợp lệ.

Ứng dụng cũng nên đặt giới hạn cho số bucket mà một request được phép kiểm tra. Nếu không, một request bất thường có thể biến thành một unbounded scan.

### Các Query khác cần Model khác

Message theo channel chỉ là một access pattern.

Các request như:

- Tìm tất cả message nhắc đến một user.
- Search nội dung message.
- Tìm message được ghim.
- Xây dựng analytics.
- Tìm message trên nhiều channel.

không phù hợp một cách tự nhiên với primary message table.

Cố gắng hỗ trợ mọi query bằng cùng một table sẽ tạo lại vấn đề random-read mà thiết kế ban đầu muốn tránh.

Cách tốt hơn là tạo các read model riêng cho những use case đó.

### Hành vi API trong Migration

[PROPOSED DESIGN] Trong quá trình migration, ứng dụng có thể đọc từ cả hai store với một sample traffic được kiểm soát và so sánh kết quả.

Write cũng nên mang theo operation ID hoặc idempotency key để một retry không tạo ra các version khác nhau của cùng một message ở hai database.

## 7. Chiến lược Scale

[SOURCE FACT] Chiến lược của Discord là thêm node thay vì thực hiện re-shard thủ công. Replication và repair được sử dụng để tăng khả năng chịu lỗi. Nguồn báo cáo một Cassandra cluster 12 node với replication factor bằng 3 tại thời điểm đó. Source

Thêm node làm tăng tổng capacity của cluster, nhưng không tự động giải quyết mọi hotspot.

Hãy xét một channel có lưu lượng rất cao:

```text
Channel A
│
├── Bucket 1
├── Bucket 2
├── Bucket 3
└── Current Bucket  ← very high traffic
```

Toàn bộ cluster có thể vẫn còn rất nhiều capacity trong khi partition hiện tại của một channel phổ biến lại nhận lượng traffic không cân xứng.

Vì vậy, chỉ monitoring các giá trị trung bình của toàn cluster là chưa đủ.

[ANALYSIS] Các metric hữu ích gồm:

- Latency theo partition hoặc channel.
- Latency theo từng node.
- Phân bố kích thước partition.
- Tombstone scan.
- Compaction backlog.
- Thời gian repair.
- Read/write throughput.
- Phân bố hot channel.

### Migration ScyllaDB được đề xuất

[PROPOSED DESIGN] Migration nên được thực hiện từng bước thay vì chuyển toàn bộ hệ thống cùng lúc.

Một quy trình có thể là:

```text
1. Shadow reads
       ↓
2. Dual writes
       ↓
3. Compare data
       ↓
4. Small production cohort
       ↓
5. Expand rollout
       ↓
6. Full cutover
```

Trong giai đoạn đầu, giữ nguyên schema và cách tính bucket.

Điều này quan trọng vì nếu đồng thời thay đổi cả database engine lẫn partitioning strategy thì sẽ khó xác định nguyên nhân của data mismatch hoặc performance regression.

Repair, compaction, backfill và failover cũng nên được kiểm thử độc lập thay vì giả định rằng một migration test thành công đã bao phủ tất cả các trường hợp này.

## 8. Các kịch bản Failure

[SOURCE FACT] Discord từng gặp một vấn đề production liên quan đến hàng triệu tombstone được tạo ra bởi lịch sử channel đã bị xóa. Khi load channel bị ảnh hưởng, Cassandra phải scan các tombstone và dẫn đến các lần stop-the-world garbage-collection pause kéo dài khoảng 10 giây. Discord giảm thời gian tồn tại của tombstone và thêm empty-bucket tracking để tránh scan lặp lại những range đã biết là rỗng. Source

Điều này cho thấy delete cần được xem là một phần của storage design, thay vì chỉ đơn giản là thao tác ngược lại với insert.

### Race giữa Edit/Delete

[ANALYSIS] Một failure mode khác nằm ở semantics chứ không chỉ ở cơ chế kỹ thuật.

Giả sử một edit và một delete xảy ra gần như cùng lúc:

```text
Edit message
     │
     ├─────────────┐
     │             │
     ▼             ▼
Write content    Delete fields
     │             │
     └──────┬──────┘
            ▼
       Final row
```

Với cơ chế column-level last-write-wins, row cuối cùng có thể chỉ còn một phần các field đáng lẽ phải có.

Vì vậy:

> Một database write thành công không nhất thiết có nghĩa message cuối cùng là hợp lệ.

Validation các field bắt buộc và quy tắc ordering rõ ràng là một phần của correctness model của ứng dụng.

### Migration Failure

[PROPOSED DESIGN] Database migration tạo ra thêm một nhóm failure khác.

Ví dụ:

```text
Cassandra write → SUCCESS
Scylla write   → TIMEOUT
```

hoặc:

```text
Cassandra write → TIMEOUT
Scylla write   → SUCCESS
```

Hai database lúc này có thể tạm thời không đồng nhất.

Vì vậy, migration layer nên ghi nhận operation ID và đảm bảo retry là idempotent.

Data mismatch có thể được phát hiện bất đồng bộ:

```text
Write
 │
 ├── Cassandra
 │
 └── Scylla
       │
       ▼
  Async comparison
       │
       ├── Match
       │
       └── Divergence → Repair Queue
```

Hệ thống không nên chuyển sang giai đoạn migration tiếp theo cho đến khi mức divergence có thể đo được và nằm trong giới hạn chấp nhận được.

Nếu hai database không đồng nhất, giá trị được chọn làm nguồn đúng nên được quyết định bằng version hoặc event-ordering policy rõ ràng, thay vì đơn giản chọn write đến sau theo wall-clock time.

## 9. Ước tính Capacity

[SOURCE FACT] Các số liệu lịch sử trong nguồn gồm hơn 120 triệu message mỗi ngày, cluster 12 node, replication factor 3, gần 1 TB compressed data trên mỗi node và khả năng được đề cập là tăng lên 2 TB mỗi node. Nguồn cũng báo cáo read dưới 5 ms và write dưới 1 ms trong quá trình kiểm thử. Source

Những con số này hữu ích như các mốc tham khảo lịch sử, nhưng không nên được copy trực tiếp vào một production capacity plan mới.

[PROPOSED DESIGN] Để minh họa, giả sử payload và metadata trung bình của một message có kích thước 200 byte trước replication.

Với 120 triệu message mỗi ngày:

```text
120,000,000 messages/day * 200 bytes/message
= 24,000,000,000 bytes/day
≈ 24 GB/day
```

Đây chỉ là phép tính minh họa.

Với replication factor bằng 3:

```text
24 GB/day * 3
≈ 72 GB/day
```

Đây là replicated payload gần đúng trước khi tính đến:

- Compaction overhead.
- Tombstone.
- Internal metadata.
- Backup.
- Temporary repair space.
- Operational headroom.

Capacity planning thực tế nên thay kích thước row giả định 200 byte bằng số liệu đo từ phân bố message thực tế.

Nó cũng cần xét đến phân bố traffic thay vì chỉ nhìn vào average theo ngày.

Ví dụ, 120 triệu message phân bố đều trong 24 giờ rất khác với cùng số lượng đó nhưng tập trung vào một vài giờ peak.

## 10. Trade-off

[SOURCE FACT] Cassandra cung cấp availability, khả năng scale bằng cách thêm node, latency có thể dự đoán và locality cho dữ liệu liên quan. Đồng thời, eventual-consistency model và cách tombstone hoạt động tạo ra các vấn đề về correctness và vận hành mà Discord phải xử lý một cách rõ ràng. Source

### Kích thước Bucket

[ANALYSIS] Time bucket tạo ra một trade-off.

Bucket nhỏ:

- Giữ partition nhỏ hơn.
- Giảm lượng dữ liệu bị ảnh hưởng bởi compaction.
- Giảm phạm vi tombstone trong trường hợp xấu nhất.
- Tăng số lượng bucket mà một read có thể phải kiểm tra.

Bucket lớn:

- Giảm số lần lookup bucket.
- Giảm metadata overhead.
- Tăng kích thước partition.
- Tăng lượng dữ liệu bị ảnh hưởng bởi compaction.
- Tăng rủi ro hotspot.

Không có một bucket size đúng cho mọi hệ thống.

Giá trị phù hợp phụ thuộc vào phân bố message thực tế và các channel lớn nhất trong workload.

### Chi phí Migration sang ScyllaDB

[PROPOSED DESIGN] ScyllaDB có thể hấp dẫn nếu CPU usage của database repair và thời gian repair là các bottleneck quan trọng.

Tuy nhiên, chuyển database có chi phí engineering thực tế:

- Vận hành cả hai hệ thống trong thời gian migration.
- Validate dữ liệu.
- Test driver.
- Đồng bộ observability.
- Test failure behavior.
- Xây dựng rollback procedure.
- Quản lý backfill.
- Tạm thời vận hành hai hệ thống song song.

Vì vậy:

> Thay database không tự động giải quyết bài toán scale.

Partition key, data distribution, deletion strategy, compaction behavior và operational process vẫn quyết định hệ thống có hoạt động tốt hay không.

## 11. Chúng ta có thể học gì từ kiến trúc này

### 1. Bắt đầu từ Query

[ANALYSIS] Trước khi chọn database, hãy hiểu dominant query.

Access pattern chính của Discord đối với message là:

```text
Give me messages from this channel around this point in time.
```

Điều đó dẫn đến một key structure tự nhiên dựa trên:

```text
(channel_id, bucket, message_id)
```

Database vì vậy không bị yêu cầu thực hiện một general search. Nó được cung cấp một location và range rất cụ thể để đọc.

### 2. Đặt giới hạn cho kích thước Partition

[ANALYSIS] Partition nên có một giới hạn kích thước thực tế dựa trên workload.

Nguồn có đề cập đến các giới hạn partition size được Cassandra document, nhưng không nên hiểu các giới hạn đó là production target lành mạnh.

Một partition có thể trở nên tốn kém về mặt vận hành từ rất lâu trước khi database đạt đến giới hạn lý thuyết.

Câu hỏi phù hợp là:

> Partition này có thể lớn đến mức nào trước khi read, compaction, repair và failure recovery bắt đầu trở nên khó kiểm soát?

### 3. Xem Delete như một loại Workload

[ANALYSIS] Delete cũng tạo ra workload cho storage.

Tombstone ảnh hưởng đến:

- Read.
- Compaction.
- Repair.
- Garbage collection.
- Storage usage.

Vì vậy, metric liên quan đến delete nên là một phần của operational dashboard bình thường.

### 4. Migration phải đo lường được

[SOURCE FACT] Dark launch, đo latency và migration từng bước là những phần quan trọng trong nỗ lực ban đầu của Discord. Nguồn cũng mô tả một team engineering nhỏ vận hành hệ thống mà tại thời điểm đó không có DevOps engineer chuyên trách. Source

Bài học rộng hơn là các migration lớn không nên dựa vào những giả định như:

```text
"The new database should be faster."
```

Thay vào đó, hãy định nghĩa rõ success nghĩa là gì:

- p95 latency
- p99 latency
- error rate
- data divergence
- repair duration
- compaction backlog
- storage growth
- failure recovery time

Sau đó đo hệ thống mới dựa trên các tiêu chí đó.

## 12. System Design theo kiểu Interview được đề xuất

[PROPOSED DESIGN]

### Requirements

Hệ thống cần:

- Lưu message trong thời gian dài.
- Đọc một page có giới hạn của các message quanh channel cursor.
- Hỗ trợ edit và delete.
- Chịu được node failure.
- Scale bằng cách thêm node.
- Giữ search và analytics bên ngoài primary message store.

### Storage

Sử dụng:

```text
((channel_id, bucket), message_id)
```

với descending clustering order.

Chọn bucket duration dựa trên mức tăng trưởng được đo của các channel lớn nhất thay vì dùng một giá trị cố định cho mọi hệ thống.

Duy trì metadata cho các bucket được biết là rỗng và repair queue cho các data mismatch.

### Write Path

Write flow có thể là:

```text
Client
  │
  ▼
Message API
  │
  ├── Authenticate
  ├── Validate
  ├── Generate message ID
  ├── Write message
  └── Return result
```

Write nên bao gồm idempotency key hoặc operation ID để retry không tạo ra một logical operation thứ hai.

Đối với edit và delete, gắn một version hoặc event timestamp rõ ràng.

Khi đọc, validate các field bắt buộc để một row ghi chưa đầy đủ hoặc bị lỗi không bị trả về một cách im lặng như một message hợp lệ.

### Read Path

Read flow có thể là:

```text
Client
  │
  ▼
Message API
  │
  ▼
Calculate bucket candidates
  │
  ▼
Skip known empty buckets
  │
  ▼
Read partition-local ranges
  │
  ▼
Merge by message ID
  │
  ▼
Return requested page
```

Service nên dừng khi đã có đủ số message hợp lệ.

Nó cũng nên giới hạn số bucket mà một request được phép scan.

Nếu request cần đọc quá nhiều bucket, API nên trả về một retryable error có kiểm soát thay vì thực hiện một unbounded scan.

### Migration Path

Một migration từ Cassandra sang ScyllaDB được đề xuất có thể theo sequence sau:

```text
1. Keep Cassandra as the compatibility baseline
             ↓
2. Shadow-read Scylla
             ↓
3. Dual-write with operation IDs
             ↓
4. Compare IDs, versions, and required fields
             ↓
5. Roll out by channel cohorts
             ↓
6. Monitor production behavior
             ↓
7. Increase rollout gradually
             ↓
8. Keep rollback available
```

Các metric quan trọng gồm:

- p95 latency.
- p99 latency.
- Read divergence.
- Write divergence.
- Repair duration.
- Tombstone density.
- Compaction backlog.
- Error rate.
- Recovery time.

### Capacity

Sử dụng các số liệu lịch sử của Discord làm context, không phải current capacity target.

Với một hệ thống mới, hãy tính capacity dựa trên:

- Row-size percentile thực tế.
- Peak message rate.
- Phân bố message giữa các channel.
- Replication factor.
- Repair bandwidth.
- Compaction requirement.
- Failure headroom.
- Storage growth.

Bất kỳ con số nào không được trích trực tiếp từ source nên được xem là assumption và phải được validate bằng measurement.

## Nguồn gốc

Công ty: Discord. Tên bài viết: “How Discord Stores Billions of Messages.” URL: https://discord.com/blog/how-discord-stores-billions-of-messages.

Thông tin sử dụng từ source: mục tiêu lưu trữ message, giới hạn của MongoDB, yêu cầu và data model của Cassandra, time bucket, dark launch, eventual-consistency behavior, tombstone, các quan sát về performance, cấu hình cluster trong lịch sử và ScyllaDB như một khả năng trong tương lai thay vì một migration đã hoàn tất.

Công ty: Discord. Tên bài viết: “Why Discord is switching from Redis to relational databases and what’s next.” URL: https://discord.com/blog/why-discord-is-switching-from-redis-to-relational-databases-and-whats-next.

Thông tin sử dụng từ source: chỉ để phân biệt phạm vi rằng bài viết này nói về Redis và relational database, không phải migration từ Cassandra sang ScyllaDB.
