---
title: "Thiết kế hệ thống chat thời gian thực bền vững"
description: "Thiết kế có phạm vi rõ ràng cho chat có thứ tự, đa thiết bị, lịch sử bền vững và nhiều kết nối đồng thời."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Bài toán và phạm vi

Ta cần tính năng chat cho một sản phẩm người dùng cuối, phục vụ người dùng, nhân viên hỗ trợ và client tự động. Người dùng có thể tạo conversation trực tiếp hoặc conversation nhóm, gửi text và media, xem presence, nhận typing indicator, tìm kiếm lịch sử gần đây và đọc bù tin nhắn sau khi một thiết bị offline. Một tài khoản có thể dùng nhiều điện thoại, trình duyệt và client desktop.

Phần khó không phải là mở một WebSocket. Vấn đề là kết hợp ghi bền vững, thứ tự theo conversation, retry, reconnect và delivery đa thiết bị mà không buộc dữ liệu tạm thời phải có chi phí và độ tin cậy như message history.

### [SOURCE FACT] Các đảm bảo cần có

- Mỗi message được chấp nhận đều bền vững và có một vị trí trong conversation của nó.
- Send response chỉ được trả về sau durable commit, không phải chỉ sau khi enqueue vào memory.
- Delivery là at-least-once. Client khử trùng lặp bằng `message_id` và resume từ cursor.
- Presence và typing là dữ liệu tạm thời, có thể bị cũ. Message history là dữ liệu bền vững.
- Mục tiêu là p99 send acknowledgement dưới 200 ms trong cùng region, hàng triệu WebSocket đồng thời, lịch sử bền vững và đồng bộ đa thiết bị.

Đây không phải hệ thống broadcast có total order toàn cục. Thứ tự chỉ được đảm bảo theo conversation. Byte media được lưu ngoài message database. Các ranh giới này giới hạn những đảm bảo mạnh ở đúng phần dữ liệu cần chúng.

## 2. Mô hình tải

### [ANALYSIS] Các giả định lập kế hoạch

Các giá trị dưới đây là đầu vào để lập kế hoạch, không phải dữ kiện sản phẩm. Trước khi chốt capacity, cần thay chúng bằng traffic đo được.

| Đại lượng | Giả định | Lý do |
|---|---:|---|
| DAU | 50 million | Mô hình minh họa cho deployment consumer lớn |
| Active senders/ngày | 20% DAU | Một phần người dùng chỉ đọc |
| Messages/sender/ngày | 20 | Gồm message text và message chứa metadata của media |
| Message envelope trung bình | 1 KB | Text, ID, timestamp và một vài thuộc tính |
| Media attachment trung bình | 2 MB, 5% messages | Media được lưu ngoài hot message row |
| Retention | 3 years | Lịch sử sản phẩm bền vững |
| Peak multiplier | 10x trung bình | Múi giờ và các đợt tăng tải theo sự kiện |

Kết quả minh họa:

```text
Messages/day = 50,000,000 x 20% x 20 = 200,000,000
Average writes = 200,000,000 / 86,400 = 2,315 writes/s
Planning peak = 2,315 x 10 = 23,150 writes/s
```

Mỗi message cũng tạo một outbox event. Vì vậy, trước replication, durable write path xử lý khoảng 46,300 row hoặc event writes/s. At-least-once delivery và retry không được tính là user message mới.

Raw message storage trong ba năm là `200,000,000 x 1 KB x 1,095 days = 219 TB` theo hệ thập phân. Với hai replica, index, tombstone và 30% headroom, ước tính là `219 x 2 x 1.3 = 569 TB`.

Media storage là `200,000,000 x 5% x 2 MB x 1,095 = 21.9 PB` trước lifecycle compression hoặc xóa. Media nên nằm trong object storage và có thể được phân phối qua CDN khi phù hợp; không nên nằm trong hot message table.

Ở planning peak, message ingress khoảng `23,150 x 1 KB = 23 MB/s`, tương đương `184 Mb/s`. Nếu media chịu cùng peak factor, upload traffic xấp xỉ `1,158 x 2 MB = 2.3 GB/s`. Vì vậy client nên upload multipart trực tiếp tới object storage thay vì chuyển toàn bộ byte qua chat service.

Mô hình giả định một active user điển hình thực hiện 12 conversation reads/ngày: 600 triệu reads/ngày, trung bình 6,944 read requests/s và khoảng 69,440 ở peak. Không tính WebSocket frame, tỷ lệ read/write request xấp xỉ 3:1.

Với 10 triệu client kết nối đồng thời, giả sử 20% client kết nối ở mỗi region, bốn region sẽ chứa 2 triệu socket mỗi region. Với outbound trung bình giả định là 4 KB/s cho mỗi client kết nối, bao gồm presence, typing và message, egress ở mức occupancy đó là 8 GB/s mỗi region.

Availability objective trong mô hình này là 99.99% cho message acceptance và history read, và 99.9% cho presence. Presence có thể dùng objective thấp hơn vì có thể khôi phục; history không thể được dựng lại từ một presence đã cũ.

Capacity được cấp cho 2x forecast peak. Một đợt review tăng trưởng 100% mỗi năm là planning trigger để thêm shard thay vì kéo một cluster vượt qua failure domain. Đây là giả định thiết kế, không phải cam kết.

## 3. API contract

### [PROPOSED DESIGN] HTTP

HTTP API xác thực bằng access token có thời hạn ngắn. WebSocket upgrade dùng cùng token. Mọi mutating request nhận một idempotency key trong phạm vi authenticated user, để retry của client không tạo resource hoặc message thứ hai.

Các payload dưới đây chỉ là ví dụ minh họa; ID và timestamp trong ví dụ không phải dữ kiện production.

```http
POST /v1/conversations
Authorization: Bearer <token>
Idempotency-Key: 7d2e...
Content-Type: application/json

{"type":"group","member_ids":["u2","u3"],"title":"Project"}
```

```json
{"conversation_id":"c_91","created_at":"2026-08-15T03:00:00Z","last_seq":0}
```

```http
POST /v1/conversations/{conversation_id}/messages
Authorization: Bearer <token>
Idempotency-Key: client-device-42:local-881
Content-Type: application/json

{"client_message_id":"local-881","text":"hello","attachments":[]}
```

```json
{"message_id":"m_7","conversation_id":"c_91","seq":1842,"sender_id":"u1","text":"hello","created_at":"2026-08-15T03:00:01Z"}
```

`POST /v1/media/upload-sessions` trả về một authenticated, bounded upload URL tới object storage. Client upload byte rồi gửi object ID trong message request.

`GET /v1/conversations/{id}/messages?after_seq=1830&limit=50` trả về messages và `next_after_seq`; server giới hạn `limit` ở 100. `POST /v1/conversations/{id}/read-cursors` lưu device cursor. `GET /v1/conversations?cursor=...` liệt kê membership và last-read state.

### [PROPOSED DESIGN] WebSocket

Endpoint là `GET /v1/realtime` với subprotocol `chat.v1`. Các frame gồm `message.new`, `message.ack`, `typing.start/stop`, `presence.update` và `sync.required`.

Khi reconnect, client gửi:

```json
{"type":"resume","conversation_cursors":{"c_91":1840}}
```

Server replay history sau từng cursor, sau đó chuyển conversation đó sang live delivery. Client acknowledge delivery bằng `message.received`, nhưng không được xem acknowledgement này là durable send acknowledgement. Send chỉ hoàn tất khi message write và outbox record tương ứng đã commit.

## 4. Data model

### [PROPOSED DESIGN]

Dùng distributed SQL database làm authoritative store. Conversation membership và message metadata cần transaction cùng các conditional write có hành vi dễ dự đoán. Object storage giữ media.

```sql
CREATE TABLE conversations (
  conversation_id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  created_at TIMESTAMPTZ NOT NULL,
  next_seq BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE conversation_members (
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX members_by_user ON conversation_members (user_id, conversation_id);

CREATE TABLE messages (
  conversation_id UUID NOT NULL,
  seq BIGINT NOT NULL,
  message_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  client_message_id TEXT NOT NULL,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (conversation_id, seq),
  UNIQUE (sender_id, client_message_id)
);
CREATE INDEX messages_by_id ON messages (message_id);

CREATE TABLE outbox (
  event_id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  seq BIGINT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ NULL,
  UNIQUE (conversation_id, seq)
);
```

`(conversation_id, seq)` giúp history scan có thứ tự và nằm cục bộ theo conversation. `members_by_user` phục vụ fan-out khi login và kiểm tra membership; primary key phục vụ truy vấn “ai thuộc group này?”.

Unique constraint `(sender_id, client_message_id)` khiến HTTP retry trả về message ban đầu thay vì cấp một sequence khác. `messages_by_id` phục vụ lookup theo public message identifier. Unique key của outbox ngăn việc publish hai durable event cho cùng một conversation sequence.

Schema này chỉ là điểm bắt đầu được đề xuất. Partitioning, topology replication, xóa theo retention, search index và transaction cụ thể để cấp `next_seq` cần được kiểm chứng theo workload và đặc tính của database; các chi tiết đó không tự động được suy ra từ ví dụ này.
