---
title: "Thiết kế bảng tin xếp hạng với hybrid fan-out"
description: "Thiết kế thực tế cho bảng tin được xếp hạng, thiên về đọc, cân bằng độ mới, phân trang có thể dự đoán và chi phí fan-out."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Bài toán và yêu cầu

Ta cần một bảng tin chính cho sản phẩm mạng xã hội. Người dùng theo dõi các tác giả, mở màn hình chính và nhận một luồng bài đăng từ những tác giả đó theo thứ hạng. Một bài đăng thường phải hiển thị trong vòng 30 giây. Trang đầu tiên phải có p95 latency dưới 300 ms. Khi refresh hoặc phân trang, hệ thống không được cố ý tạo bản sao hoặc làm mất mục chỉ vì thứ hạng thay đổi giữa các request.

Đối tượng sử dụng là độc giả, tác giả và các service nội bộ về ranking và chống lạm dụng. Yêu cầu chức năng gồm:

- tạo, xóa và lấy bài đăng;
- follow và unfollow tác giả;
- tập hợp bài đăng của các tác giả được theo dõi rồi xếp hạng cho từng độc giả;
- phân trang bằng cursor opaque;
- thêm bài mới đủ điều kiện vào bảng tin đang mở mà không làm mất page boundary;
- ẩn nội dung đã xóa, bị chặn hoặc bị gỡ theo chính sách.

**[SOURCE FACT]** Workload thiên về đọc: khoảng 1.000 lần đọc bảng tin cho mỗi lần ghi bài. Độ mới và read latency đều quan trọng, nhưng chấp nhận trễ vài giây. Ranking được cá nhân hóa và có thể thay đổi khi feature đến.

**[ANALYSIS]** Vì vậy, cam kết một thứ tự toàn cục giống hệt nhau không có nhiều giá trị. Các guarantee hữu ích là page boundary ổn định, không cố ý trùng lặp và khả năng hiển thị đơn điệu của nội dung đã commit trong snapshot do độc giả chọn.

Quyết định chính là thực hiện việc aggregate ở đâu. Fan-out-on-write sao chép bài đăng vào inbox của từng follower, làm cho việc đọc rẻ hơn nhưng có thể tạo hàng triệu lần ghi đối với tác giả có nhiều follower. Fan-out-on-read tránh write amplification, nhưng độc giả phải trả chi phí merge trong mỗi request. Thiết kế đề xuất dùng cả hai đường đi.

## 2. Ước tính quy mô

Các mục dưới đây là giả định rõ ràng, không phải dự báo. Có thể thay chúng bằng số đo thực tế của sản phẩm để tính lại capacity.

| Đại lượng | Giả định | Phép tính / kết quả |
|---|---:|---:|
| Người dùng hoạt động hằng ngày | 50 triệu | Mục tiêu sản phẩm |
| Feed request mỗi người hoạt động/ngày | 20 | 50M x 20 = 1 tỷ request/ngày |
| Feed RPS trung bình | 1B / 86.400 | 11.574 RPS |
| Hệ số đỉnh | 10x trung bình | 115.740 RPS; provision cho 150k RPS |
| Bài đăng mới/ngày | 1 triệu | Một bài trên 50 DAU mỗi ngày là baseline ghi thận trọng cho feed thiên về đọc |
| Post write RPS | 1M / 86.400 | Trung bình 11,6, khoảng 116 ở đỉnh |
| Tỷ lệ đọc:ghi | 1B / 1M | 1.000 feed read cho mỗi bài đăng |
| Bản ghi bài đăng lưu giữ | 2 KiB | 1M x 2 KiB x 365 = 0,73 TB/năm trước replica và index |
| Bản ghi feed edge | 32 byte | Tập fan-out minh họa có trung bình 5 follower/bài: 5M edge/ngày x 32 byte x 30 ngày = 4,8 GB dữ liệu inbox nóng logic |
| Feed response | 20 mục x 1,5 KiB | 30 KiB; 115.740 x 30 KiB x 8 = 27,8 Gbit/s egress đỉnh trước nén |
| Mục tiêu availability | 99,95% theo tháng | Khoảng 22 phút không khả dụng/tháng cho feed read; write có thể suy giảm thành fan-out trễ |

Trung bình 5 follower là **[SOURCE FACT / ASSUMPTION]** cho tập bài được chọn để fan-out, không phải giả định chung về social graph. Tác giả có degree cao dùng read path. Ở mức tăng trưởng 10x, giả định trên cho ra 500M bài/ngày và feed traffic trung bình 115.740 RPS. Ranh giới hybrid nên thay đổi theo fan-out amplification đo được, không theo một ngưỡng follower cố định.

Storage thực tế sẽ lớn hơn. Ba replica, index, tombstone, metadata moderation và con trỏ media có thể làm ước tính 0,73 TB/năm thành khoảng 3 TB/năm. Media thuộc object storage và không nằm trong phép tính feed database. Inbox edge có TTL ngắn vì chỉ tăng tốc truy xuất, không phải nguồn sự thật.

## 3. Thiết kế API

Mọi endpoint dùng HTTPS và danh tính đã xác thực từ access token. `X-Request-ID` được client gửi hoặc service tự sinh, sau đó truyền qua log và trace. Cursor là opaque và được ký; nó chứa feed version cùng biên `(rank_key, post_id)` cuối cùng.

### Đọc bảng tin

```http
GET /v1/feed?limit=20&cursor=eyJ2Ijox...
Authorization: Bearer <token>
X-Request-ID: 7f2c...
```

```json
{
  "items": [{"post_id":"p91", "author_id":"u7", "text":"...", "created_at":"2026-08-15T02:00:00Z", "rank":0.984}],
  "next_cursor":"eyJ2IjoxLCJsYXN0IjpbMC45ODQsInA5MSJdfQ",
  "feed_version":"v-20260815-020001",
  "generated_at":"2026-08-15T02:00:03Z"
}
```

`limit` bị giới hạn ở 100. Cursor giữ cùng ranking snapshot trong một session có thời hạn, để bài mới có thể xuất hiện ở đầu mà không đẩy lệch trang hiện tại. Nếu snapshot hết hạn, service trả cursor mới và cảnh báo `snapshot_expired`, thay vì âm thầm lặp dòng.

### Tạo bài đăng

```http
POST /v1/posts
Authorization: Bearer <token>
Idempotency-Key: 01J...
Content-Type: application/json

{"text":"hello", "media_ids":["m1"]}
```

Response là `201 Created` cùng `post_id` bền vững. Idempotency key duy nhất theo tác giả trong 24 giờ và lưu response ban đầu. Do đó, timeout sau khi database commit có thể được retry mà không tạo bài thứ hai.

### Follow và unfollow

```http
PUT    /v1/users/{author_id}/follow
DELETE /v1/users/{author_id}/follow
```

Cả hai thao tác đều idempotent. Bản ghi follow lưu `following_since`; feed reader dùng nó làm lower bound để bài cũ không bị backfill bất ngờ. `DELETE` cũng phát invalidation event. Các row đã materialize được filter lúc đọc cho đến khi asynchronous cleanup hoàn tất.

### Chèn theo thời gian thực

Client mở `GET /v1/feed/stream` qua kết nối WebSocket hoặc server-sent event. Server chỉ gửi `{event:"new_item", post_id, feed_version}` sau authorization và một eligibility check nhẹ. Client prepend item bên ngoài danh sách phân trang rồi deduplicate theo `post_id`; HTTP page tiếp theo vẫn dùng cursor.

## 4. Mô hình dữ liệu

**[PROPOSED DESIGN]** Dùng SQL được shard làm source of truth. Tạo bài, trạng thái follow, trạng thái moderation và idempotency đều cần constraint và transaction. Inbox denormalized chỉ là retrieval accelerator, có thể rebuild hoặc để hết hạn.

```sql
CREATE TABLE posts (
  post_id        BIGINT PRIMARY KEY,
  author_id      BIGINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  text           TEXT NOT NULL,
  rank_features  JSONB NOT NULL,
  visibility     SMALLINT NOT NULL DEFAULT 1,
  deleted_at     TIMESTAMPTZ NULL
);
CREATE INDEX posts_author_time ON posts (author_id, created_at DESC, post_id DESC);

CREATE TABLE follows (
  follower_id       BIGINT NOT NULL,
  followed_id       BIGINT NOT NULL,
  following_since   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (follower_id, followed_id)
);
CREATE INDEX follows_reverse ON follows (followed_id, follower_id);

CREATE TABLE feed_inbox (
  reader_id      BIGINT NOT NULL,
  rank_key       DOUBLE PRECISION NOT NULL,
  post_id        BIGINT NOT NULL,
  author_id      BIGINT NOT NULL,
  inserted_at    TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (reader_id, rank_key, post_id)
);
CREATE INDEX feed_inbox_expiry ON feed_inbox (expires_at);

CREATE TABLE outbox_events (
  event_id       BIGSERIAL PRIMARY KEY,
  aggregate_id   BIGINT NOT NULL,
  event_type     TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  published_at   TIMESTAMPTZ NULL
);
```

Post, follow và outbox row nên được commit atomically khi cùng nằm trên một database shard. Publisher đọc các outbox row chưa publish rồi gửi chúng vào fan-out và ranking pipeline. Consumer phải idempotent: retry có thể giao cùng event nhiều lần, nên việc insert inbox dùng uniqueness key và upsert an toàn.

## 5. Hybrid fan-out

**[PROPOSED DESIGN]** Publish path ghi post và outbox event trước. Nó không chờ ghi inbox cho mọi follower rồi mới trả success. Fan-out consumer đọc event, kiểm tra degree của tác giả và trạng thái policy, rồi chọn path:

- tác giả thông thường: lấy danh sách follower và insert một inbox row cho từng reader;
- tác giả có degree cao: không enumerate toàn bộ follower; giữ bài trong kho theo thứ tự thời gian của tác giả và merge khi đọc feed;
- bài không đạt visibility hoặc policy check: không materialize.

Read service lấy candidate set từ inbox của reader, sau đó query các bài gần đây của những tác giả có degree cao mà reader đang follow. Nó merge candidate theo `rank_key` và `post_id`, filter follow state và visibility, rồi lấy post body theo batch. Cache có thể giữ post body hoặc ranking feature, nhưng không được là bản duy nhất của dữ liệu đã commit.

Phân chia này làm rõ trade-off. Fan-out-on-write dùng storage và write capacity bất đồng bộ để giảm read work. Fan-out-on-read dùng CPU và backend query lúc đọc để tránh write amplification. Ranh giới là policy vận hành dựa trên cost và latency đo được, không phải hằng số phổ quát.

## 6. Ranking và phân trang

Ranking có thể thay đổi khi feature đến, nội dung bị xóa hoặc người dùng follow/unfollow. Re-rank một page đang mở làm offset pagination không còn an toàn.

**[PROPOSED DESIGN]** Ở request đầu tiên, tạo feed version xác định ranking snapshot và thời điểm hết hạn. Lưu cặp `(rank_key, post_id)` cuối cùng trong signed cursor. Request tiếp theo lấy các mục strictly after cặp đó trong cùng snapshot. `post_id` là tie-breaker xác định khi hai mục có cùng rank.

Item realtime mới nằm ngoài cursor sequence. Client có thể hiển thị chúng phía trên danh sách hiện tại, còn sequence phân trang tiếp tục từ boundary ban đầu. Client deduplicate theo `post_id` vì delivery và HTTP retrieval có thể bị chồng lấn.

Nếu item bị xóa hoặc block sau khi cursor được cấp, read service filter item đó rồi tiếp tục scan. Nếu chính snapshot hết hạn, trả `snapshot_expired` an toàn hơn là giả vờ boundary cũ vẫn có cùng ý nghĩa.

## 7. Freshness, moderation và failure

Mục tiêu hiển thị trong 30 giây là operating target thông thường, không phải transaction guarantee. Outbox lag, consumer retry, backpressure (giới hạn tốc độ để bảo vệ downstream) và latency của ranking service có thể làm materialization chậm. Khi phù hợp, read path vẫn có thể tìm bài gần đây từ các tác giả mà reader follow, nên fan-out trễ không làm bài đã commit mất khỏi hệ thống vĩnh viễn.

Deletion và blocking là correctness path, không chỉ là cleanup job. Visibility check chạy trong lúc đọc, còn invalidation event xóa hoặc làm hết hạn row đã materialize một cách bất đồng bộ. Nhờ đó, khoảng thời gian inbox row trỏ tới nội dung không còn đủ điều kiện được giới hạn.

**[PROPOSED DESIGN]** Mỗi downstream call nên có timeout (giới hạn thời gian chờ), retry có giới hạn kèm jitter và fallback phù hợp với dependency. Khi ranking timeout, có thể dùng rank đã tính trước hoặc candidate theo recency; khi cache miss của post body, bỏ item bị ảnh hưởng thay vì làm hỏng cả feed. Circuit breaker ngăn dependency lỗi chiếm toàn bộ capacity của feed worker. Queue depth và outbox age cho thấy freshness đang suy giảm trước khi user báo lỗi.

Feed read vẫn có thể available khi fan-out trễ. Tạo bài phải trả failure nếu source-of-truth transaction thất bại, nhưng có thể trả success trước khi asynchronous fan-out hoàn tất. Idempotency record bảo vệ retry quanh ranh giới này.

## 8. Guarantee và trade-off

Thiết kế cung cấp các guarantee thực tế sau:

- post đã commit thuộc trách nhiệm của source-of-truth store;
- bài thông thường thường tới materialized inbox trong mục tiêu 30 giây đã nêu;
- tác giả có degree cao không tạo một đợt ghi theo từng follower;
- cursor giữ ranking snapshot có thời hạn và page boundary;
- nội dung đã xóa, bị block hoặc bị gỡ theo policy vẫn bị filter trước khi cleanup hoàn tất;
- giao event trùng không tạo inbox row trùng.

Thiết kế không hứa ranking ổn định toàn cục, không có staleness, hoặc không bao giờ trùng giữa realtime stream và HTTP page. Đó là các guarantee khác và tốn kém hơn. Hybrid approach phù hợp vì đặt từng loại chi phí vào nơi workload này chịu được: asynchronous write cho fan-out thông thường, merge có giới hạn lúc đọc cho tác giả nhiều follower, và snapshot semantics rõ ràng cho phân trang.
