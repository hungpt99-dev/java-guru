---
title: "Discord Lưu Trữ Hàng Tỷ Tin Nhắn: Bài học từ việc chuyển từ Cassandra sang ScyllaDB"
description: "Phân tích có dẫn nguồn về quá trình lưu trữ tin nhắn của Discord, mô hình hóa dữ liệu Cassandra và thiết kế di trú sang ScyllaDB được tách biệt rõ ràng."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

Tiêu đề đặt ra một câu hỏi kỹ thuật hữu ích, nhưng nguồn lịch sử được phép sử dụng không báo cáo một cuộc di trú Cassandra sang ScyllaDB đã hoàn tất. Nguồn này nói Cassandra đang chạy production và Scylla là một lựa chọn dài hạn. Bài viết giữ ranh giới đó một cách rõ ràng.

## 1. Original Engineering Problem

**[SOURCE FACT]** Discord muốn giữ lịch sử trò chuyện vĩnh viễn, trong khi dữ liệu tin nhắn tiếp tục tăng về tốc độ và kích thước, đồng thời phải luôn khả dụng. Trong bài nguồn, lưu lượng đã tăng từ 40 triệu tin nhắn mỗi ngày vào tháng 7, lên 100 triệu vào tháng 12, và hơn 120 triệu vào tháng 1 năm 2017. [Discord, “How Discord Stores Billions of Messages”](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** Replica set MongoDB ban đầu dùng một compound index trên `channel_id` và `created_at`. Khi đạt 100 triệu tin nhắn được lưu, dữ liệu và index không còn vừa trong RAM, còn độ trễ trở nên không dự đoán được. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[ANALYSIS]** Đây là bài toán truy cập chuỗi thời gian với phân phối khóa không đồng đều. Truy vấn tự nhiên là “các tin nhắn quanh một vị trí trong một kênh”, chứ không phải một phép join quan hệ tùy ý. Tuy nhiên, kênh không hoạt động gây ra các lần seek đĩa ngẫu nhiên, kênh công khai bận rộn tạo ra các vùng gần đây nóng, và lịch sử bị xóa có thể để lại các lần quét tombstone tốn kém.

## 2. What the Original System Did

**[SOURCE FACT]** Discord chuyển từ MongoDB sang Cassandra vì Cassandra đáp ứng các yêu cầu đã nêu: mở rộng tuyến tính bằng cách thêm node, failover tự động, ít bảo trì, đã được chứng minh, hiệu năng có thể dự đoán, không cần cache tin nhắn, mô hình dữ liệu không phải blob và mã nguồn mở. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** Quá trình di trú dùng dark launch: mã ứng dụng đọc kép và ghi kép vào MongoDB và Cassandra trước khi Cassandra trở thành cơ sở dữ liệu chính. Trong một tuần kiểm thử, read được quan sát dưới 5 mili-giây và write dưới 1 mili-giây. Sau đó Discord báo cáo một cluster 12 node với replication factor bằng 3. Đây là các quan sát và cấu hình lịch sử, không phải mục tiêu capacity hiện tại. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** Khóa Cassandra đầu tiên là `(channel_id, message_id)`, trong đó Snowflake `message_id` cung cấp thứ tự thời gian. Sau khi xuất hiện các partition lớn, Discord thêm time bucket và đổi khóa thành `((channel_id, bucket), message_id)`. Bài nguồn nói bucket được chọn khoảng 10 ngày cho các kênh lớn nhất để giữ kích thước dưới 100 MB một cách an toàn. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** Cassandra upsert và last-write-wins đã làm lộ race giữa edit và delete. Discord phát hiện row hỏng bằng trường bắt buộc `author_id`, xóa tin nhắn hỏng và thay đổi write để chỉ bao gồm các giá trị non-null. Delete tạo tombstone; sau một sự cố production liên quan đến hàng triệu tin nhắn bị xóa, Discord giảm thời gian sống của tombstone từ 10 ngày xuống 2 ngày và theo dõi các bucket rỗng để tránh quét lại chúng. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[SOURCE FACT]** Bài viết nói Scylla là ý tưởng dài hạn vì repair của Cassandra bị giới hạn bởi CPU và thời lượng tăng theo lượng write tích lũy; bài viết không nói Discord đã hoàn tất di trú. Bài viết được phép thứ hai nói về việc chuyển từ Redis sang cơ sở dữ liệu quan hệ và không chứng minh một cuộc di trú Cassandra sang Scylla. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages) [Nguồn](https://discord.com/blog/why-discord-is-switching-from-redis-to-relational-databases-and-whats-next)

## 3. Architecture Diagram

```mermaid
flowchart LR
    C[Client]
    API[Message API\n[Source-backed component]]
    MONGO[(MongoDB replica set\n[Source-backed historical component])]
    CAS[(Cassandra cluster\n[Source-backed component])]
    B[Time bucket: channel_id + bucket\n[Source-backed component]]
    REP[Replication and repair\n[Source-backed component]]
    IDX[Empty-bucket tracking\n[Source-backed component]]
    SCY[(ScyllaDB cluster\n[Proposed component])]
    MIG[Dual-read / dual-write migration controller\n[Proposed component]]

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

**[SOURCE FACT]** MongoDB đọc/ghi kép, Cassandra, time bucket, replication, repair và theo dõi bucket rỗng được mô tả trong nguồn. **[PROPOSED DESIGN]** Cluster ScyllaDB và migration controller là phần mở rộng cho thiết kế phỏng vấn; không được hiểu đây là kiến trúc production được Discord báo cáo.

## 4. System Design Analysis

**[ANALYSIS]** Partition theo `(channel_id, bucket)` xử lý hai rủi ro độc lập. `channel_id` giữ locality của truy cập chính, còn `bucket` giới hạn lượng dữ liệu và tombstone mà một thao tác đọc hoặc compaction có thể chạm tới. Một partition kênh không giới hạn là hotspot trong storage, không chỉ là hotspot định tuyến.

**[ANALYSIS]** Thiết kế này cố ý bám theo hình dạng truy vấn. Request lịch sử gần đây tính các bucket cần xét rồi range-scan theo `message_id`; nó không yêu cầu Cassandra tự tìm row qua secondary index. Chi phí của kênh yên ắng là thêm các lần thăm dò bucket, còn trường hợp kênh hoạt động thường tìm đủ row trong bucket mới nhất.

**[ANALYSIS]** Cassandra và ScyllaDB tương thích ở cấp mô hình dữ liệu, nhưng tương thích không chứng minh tương đương về vận hành. Cách repair, compaction, driver, metric, thiết lập consistency và cô lập workload vẫn cần kiểm thử di trú. “Repair nhanh hơn” là giả thuyết cần xác nhận, không phải bảo đảm di trú.

## 5. Data Model

**[SOURCE FACT]** Nguồn mô tả Cassandra là một kho key gồm partition và clustering: partition key định vị dữ liệu, còn clustering key nhận diện và sắp xếp row trong partition. Khóa tin nhắn production trở thành `((channel_id, bucket), message_id)`. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[PROPOSED DESIGN]** Một bảng tối thiểu cho cùng access pattern có thể là:

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

**[PROPOSED DESIGN]** `bucket` phải được suy ra xác định từ thời gian hoặc ID của tin nhắn, và service nên duy trì một record metadata nhỏ của kênh chứa các bucket rỗng đã biết. Nếu edit và delete có thể race, write nên là toàn bộ tin nhắn hoặc có nhận biết field, còn read nên loại row thiếu trường bắt buộc thay vì âm thầm trả về dữ liệu một phần.

## 6. API Design

**[PROPOSED DESIGN]** Giữ API phù hợp với các thao tác trong một partition:

```text
POST   /channels/{channel_id}/messages
GET    /channels/{channel_id}/messages?before={message_id}&limit={limit}
GET    /channels/{channel_id}/messages?after={message_id}&limit={limit}
PATCH  /channels/{channel_id}/messages/{message_id}
DELETE /channels/{channel_id}/messages/{message_id}
```

**[ANALYSIS]** `before` và `after` là cursor opaque được xây dựng từ thứ tự giống Snowflake, không phải offset. Service đọc suy ra các bucket ứng viên, bỏ qua bucket rỗng đã ghi nhận, truy vấn theo thứ tự và dừng sau `limit` row hợp lệ. Request mention, pin hoặc full-text search cần read model riêng; ép chúng vào bảng tin nhắn sẽ tái tạo vấn đề đọc ngẫu nhiên.

**[PROPOSED DESIGN]** Trong quá trình di trú, read có thể được lấy mẫu từ cả hai store và so sánh theo message ID cùng tính hợp lệ của trường bắt buộc. Write cần idempotency key và chính sách retry xác định để timeout không tạo ra các version khác nhau.

## 7. Scaling Strategy

**[SOURCE FACT]** Chiến lược của Discord là thêm node thay vì re-shard thủ công, trong đó replication và repair cung cấp khả năng chống lỗi. Nguồn báo cáo cluster Cassandra 12 node với replication factor bằng 3 tại thời điểm đó. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[ANALYSIS]** Thêm node giải quyết capacity tổng thể nhưng không giải quyết mọi hotspot. Một kênh cực kỳ hoạt động vẫn ánh xạ vào một chuỗi bucket hữu hạn, và bucket mới nhất có thể nóng không cân xứng. Hãy theo dõi latency theo partition và node, compaction debt, lần quét tombstone và phân phối kích thước bucket, không chỉ trung bình của cluster.

**[PROPOSED DESIGN]** Với di trú sang Scylla, dùng lộ trình theo giai đoạn: shadow read, dual write, so sánh consistency, rollout theo cohort giới hạn rồi rollback bằng cách định tuyến read trở lại Cassandra. Trước tiên giữ schema và cách suy ra bucket giống nhau; thay storage engine và semantics partition cùng lúc khiến sai lệch khó chẩn đoán. Xem repair, compaction, backfill và failover là các load test riêng.

## 8. Failure Scenarios

**[SOURCE FACT]** Lịch sử của một kênh bị xóa để lại hàng triệu tombstone. Khi tải kênh, Cassandra phải quét chúng và liên tục gặp stop-the-world garbage collection kéo dài 10 giây. Discord giảm thời gian sống tombstone và tránh các bucket rỗng đã biết. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[ANALYSIS]** Nhóm lỗi thứ hai mang tính ngữ nghĩa thay vì cơ học: edit đồng thời với delete có thể để lại row không đầy đủ dưới cơ chế upsert last-write-wins theo từng column. “Write thành công” vì thế không đồng nghĩa với “tin nhắn hợp lệ.” Kiểm tra trường bắt buộc và thứ tự edit/delete là một phần của correctness.

**[PROPOSED DESIGN]** Di trú còn phải xử lý thành công bất đối xứng: Cassandra nhận write trong khi Scylla timeout, hoặc ngược lại. Ghi operation ID, retry idempotent, so sánh bất đồng bộ và cung cấp repair queue. Không cutover trước khi độ lệch có thể đo lường và được giới hạn. Nếu hai store bất đồng, ưu tiên version được chọn bởi timestamp sự kiện hoặc chính sách version rõ ràng, không phải thời điểm request đến API.

## 9. Capacity Estimation

**[SOURCE FACT]** Các số liệu lịch sử của nguồn gồm hơn 120 triệu tin nhắn mỗi ngày, cluster 12 node, replication factor bằng 3, gần 1 TB dữ liệu nén trên mỗi node và khả năng được nêu là tăng lên 2 TB mỗi node. Nguồn cũng báo cáo read dưới 5 mili-giây và write dưới 1 mili-giây trong kiểm thử. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[PROPOSED DESIGN]** Sau đây là một giả định minh họa, không phải phép đo của Discord: giả sử 200 byte payload và metadata lưu trữ cho mỗi tin nhắn trước replication. Với 120 triệu tin nhắn mỗi ngày, storage logic thô là:

```text
120,000,000 messages/day * 200 bytes/message
= 24,000,000,000 bytes/day
≈ 24 GB/day (illustrative assumption)
```

**[PROPOSED DESIGN]** Với replication factor bằng 3, payload vật lý theo giả định minh họa khoảng 72 GB mỗi ngày, trước overhead của compaction, index, backup và tombstone. Việc sizing thực tế phải thay kích thước row giả định bằng phân phối đã đo, rồi dành headroom cho repair và compaction. Bài viết không khẳng định mục tiêu throughput mới nào.

## 10. Trade-offs

**[SOURCE FACT]** Cassandra cung cấp availability, scale theo node, latency có thể dự đoán và locality cho dữ liệu liên quan, nhưng eventual consistency và tombstone tạo ra các vấn đề correctness và vận hành mà Discord phải xử lý rõ ràng. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

**[ANALYSIS]** Time bucket đánh đổi sự đơn giản của write lấy fan-out read trên các kênh yên ắng. Bucket nhỏ giảm chi phí partition và tombstone tệ nhất nhưng tăng metadata và số lần probe. Bucket lớn giảm số lần probe nhưng tăng mức phơi nhiễm với compaction và hotspot.

**[PROPOSED DESIGN]** Scylla có thể hấp dẫn khi CPU và thời lượng repair là bottleneck, nhưng di trú có chi phí thực: vận hành kép, kiểm chứng dữ liệu, hành vi driver, tương đương observability và rollback. Tên database không phải chiến lược scale; partition key, chính sách delete và bằng chứng vận hành mới là nền tảng.

## 11. What We Can Learn From This Architecture

**[ANALYSIS]** Hãy mô hình hóa truy vấn chi phối trước khi chọn database. Discord chuyển từ một collection có index đa dụng sang layout khóa cho phép database biết chính xác range của kênh cần quét.

**[ANALYSIS]** Chủ động giới hạn partition. Giới hạn 2 GB được quảng bá trong nguồn không phải mục tiêu vận hành an toàn; partition lớn quan sát được gây áp lực lên GC và việc phân phối. Giới hạn trong tài liệu không tự động là giới hạn cho workload production khỏe mạnh.

**[ANALYSIS]** Delete là một workload storage. Tombstone, repair, compaction và metadata về range rỗng cần dashboard và test hạng nhất.

**[SOURCE FACT]** Dark launch, latency đo được và đường di trú là trọng tâm của nỗ lực ban đầu. Bài viết cũng mô tả một đội kỹ sư nhỏ vận hành hệ thống khi đó mà không có kỹ sư DevOps chuyên trách. [Nguồn](https://discord.com/blog/how-discord-stores-billions-of-messages)

## 12. Proposed Interview-Style System Design

**[PROPOSED DESIGN]** Yêu cầu: giữ tin nhắn, đọc một page giới hạn quanh cursor của kênh, hỗ trợ edit và delete, chịu được mất node và scale bằng cách thêm node. Search và analytics là các hệ thống riêng.

**[PROPOSED DESIGN]** Storage: dùng `((channel_id, bucket), message_id)` với thứ tự clustering giảm dần. Chọn thời lượng bucket từ tốc độ tăng trưởng đo được của các kênh lớn nhất, không dùng một hằng số chung. Duy trì empty-bucket index và repair queue.

**[PROPOSED DESIGN]** Write path: xác thực, cấp message ID đơn điệu, chỉ ghi các field có giá trị và làm retry thành idempotent. Với edit/delete, gắn version hoặc event timestamp và kiểm tra trường bắt buộc khi read.

**[PROPOSED DESIGN]** Read path: tính các bucket ứng viên từ cursor, bỏ qua bucket rỗng đã biết, thực hiện range read trong partition, merge theo thứ tự message ID và dừng ở kích thước page yêu cầu. Giới hạn số bucket probe và trả lỗi có thể retry thay vì scan không giới hạn.

**[PROPOSED DESIGN]** Lộ trình di trú: giữ schema Cassandra làm baseline tương thích; shadow-read Scylla; dual-write với operation ID; so sánh ID, version và trường bắt buộc; rollout theo cohort kênh; theo dõi p95/p99 latency, read divergence, thời lượng repair, mật độ tombstone và compaction backlog; giữ một công tắc rollback đã kiểm thử.

**[PROPOSED DESIGN]** Capacity: dùng số liệu nguồn làm mốc lịch sử, nhưng sizing hệ thống đề xuất từ percentile kích thước row quan sát được, phân phối message rate, replication, băng thông repair và headroom khi lỗi. Mọi mục tiêu số không được trích từ nguồn đều là giả định minh họa và phải được gắn nhãn tương ứng.

## Original Sources

1. Company: Discord. Exact Article Title: “How Discord Stores Billions of Messages.” URL: https://discord.com/blog/how-discord-stores-billions-of-messages. What information from the source was used: mục tiêu giữ tin nhắn, giới hạn MongoDB, yêu cầu và mô hình Cassandra, time bucket, dark launch, eventual consistency, tombstone, quan sát hiệu năng, cấu hình cluster lịch sử và Scylla như hướng khám phá tương lai chứ không phải một cuộc di trú đã được báo cáo hoàn tất.
2. Company: Discord. Exact Article Title: “Why Discord is switching from Redis to relational databases and what’s next.” URL: https://discord.com/blog/why-discord-is-switching-from-redis-to-relational-databases-and-whats-next. What information from the source was used: chỉ dùng để phân biệt phạm vi rằng bài được phép này nói về Redis và cơ sở dữ liệu quan hệ, không nói về di trú Cassandra sang ScyllaDB.
