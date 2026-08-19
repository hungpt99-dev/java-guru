---
title: "Thiết kế hệ thống thông báo đa kênh, bền vững"
description: "Thiết kế vận hành cho hệ thống thông báo đa kênh, idempotent và bền vững ở quy mô một triệu channel message mỗi ngày."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Bài toán và phạm vi

Nền tảng nhận notification command từ các product service như billing, chat, security và marketing. Nền tảng render template có version, đánh giá preference của người nhận, tạo delivery cho từng channel email, SMS, push và in-app, đồng thời lưu audit trail bền vững.

Điểm khó không phải là gửi một message một lần. Điểm khó là giữ đúng state transition khi bất kỳ boundary nào cũng có thể lỗi: client có thể retry, worker có thể crash, hoặc provider có thể timeout sau khi đã nhận message. Thiết kế này bao phủ acceptance API, state bền vững, delivery bất đồng bộ, retry, cô lập provider, cancellation và audit.

**[SOURCE FACT]** Hợp đồng delivery là **at-least-once**. Notification đã được chấp nhận không được mất âm thầm. Không cam kết exactly-once delivery vì provider có thể timeout sau khi đã chấp nhận message.

**[PROPOSED DESIGN]** Dùng idempotency key ở mọi command boundary và delivery ID ổn định khi gọi provider nếu provider hỗ trợ deduplication. Response đồng bộ chỉ xác nhận durable acceptance, không xác nhận provider delivery. Nhờ đó provider SMS chậm không làm mọi product request chậm theo.

Yêu cầu chức năng:

- Nhận command từ nhiều product service đã xác thực.
- Render template theo locale và channel với variable được kiểm tra và giới hạn.
- Áp dụng preference, opt-out theo channel, quiet hours, consent và policy.
- Fan-out một logical notification thành các channel delivery có retry độc lập.
- Hỗ trợ notification lên lịch, cancellation trước dispatch và đọc inbox in-app.
- Lưu audit bất biến về acceptance, quyết định policy, attempt, kết quả provider và trạng thái cuối.

**[SOURCE FACT]** Yêu cầu phi chức năng:

- Trả response enqueue trong dưới 1 giây ở p99.
- Có xử lý at-least-once, producer submission idempotent, retry với exponential backoff và dead-letter queue (DLQ).
- Cô lập provider chậm hoặc lỗi và tạo backpressure thay vì làm cạn worker hoặc database connection pool.
- Mục tiêu availability hằng tháng 99.95% cho acceptance và 99.9% dispatch thành công trong retry window của channel.
- Lưu audit data trong 13 tháng và hỗ trợ xóa personal content theo privacy policy.

## 2. Mô hình capacity

**[SOURCE FACT]** Workload ban đầu là một triệu channel message mỗi ngày. Một logical notification có thể fan-out, vì vậy đơn vị sizing là channel message, không phải producer event.

| Đại lượng | Cơ sở | Kết quả |
|---|---|---:|
| Message mỗi ngày | Yêu cầu đã nêu | 1,000,000/ngày |
| Tốc độ enqueue/dispatch trung bình | 1,000,000 / 86,400 | 11.6 messages/s |
| Tốc độ peak | 10x trung bình cho launch và billing run | 116 messages/s |
| Growth headroom | 3x peak cho capacity và hấp thụ burst | 350 messages/s |
| Payload message trung bình | Rendered body 4 KB cộng metadata | 4 GB/ngày raw |
| Durable row footprint | Payload 4 KB cộng 2 KB index/overhead | 6 GB/ngày |
| Audit retention | 13 tháng, xấp xỉ 395 ngày | 2.37 TB trước compression |
| Delivery-attempt row | 1.5 attempt/message, mỗi row 2 KB | 1.19 TB/năm |
| In-app read | 20% message thành inbox item; 5 read/item | 1,000,000 read/ngày |

**[ANALYSIS]** Ước tính 6 GB/ngày là `1,000,000 x 6 KB`. Với 3x replica, lượng dữ liệu trong 395 ngày khoảng 7.1 TB. Cold audit storage có thể giảm chi phí; không nên bắt hot database giữ toàn bộ 13 tháng. Partition theo tháng làm retention và deletion đơn giản hơn về vận hành.

Ở envelope đã nêu, rendered payload bandwidth là `4 KB x 350 messages/s = 1.4 MB/s`, tương đương khoảng 11.2 Mb/s trước protocol overhead. Provider egress là phần riêng. SMS và email có thể thêm response từ provider, còn payload push thường nhỏ hơn. Với workload đã nêu, in-app có khoảng 5:1 read so với write; durable delivery path vẫn thiên về write.

**[ASSUMPTION]** Một product model có 2 triệu daily active user và 0.5 notification trên mỗi active user mỗi ngày sẽ tạo `2,000,000 x 0.5 = 1,000,000` notification. Đây là giả định minh họa cho product, không phải tuyên bố về mọi sản phẩm. Với volume tăng 15% mỗi năm, average năm đầu khoảng 1.08M/ngày; 350 messages/s là capacity envelope ban đầu.

**[ANALYSIS]** Availability 99.95% tương ứng khoảng 21.9 phút downtime mỗi tháng cho acceptance API. Trong một API outage ngắn, dispatch vẫn có thể tiếp tục từ queue; vì vậy acceptance và delivery nên có SLO riêng.

## 3. API contract

**[PROPOSED DESIGN]** Mọi endpoint dùng TLS, OAuth2/mTLS cho service-to-service và `X-Request-Id`. Server lấy `tenant_id` từ credential và kiểm tra quyền tenant trước khi đọc hoặc thay đổi dữ liệu.

### Submit notification

`POST /v1/notifications`

```json
{
  "idempotency_key": "billing:invoice:inv_928:due",
  "recipient": {"user_id": "usr_42"},
  "template": {"name": "invoice_due", "version": 3},
  "variables": {"amount": "125.00", "currency": "USD", "due_date": "2026-08-20"},
  "channels": ["email", "push", "in_app"],
  "send_at": "2026-08-19T04:00:00Z",
  "dedupe_window_seconds": 86400
}
```

Producer đã được xác thực. Variables được kiểm tra theo schema và giới hạn kích thước; mặc định từ chối HTML và URL tùy ý. Server trả `202 Accepted` sau khi ghi command bền vững:

```json
{"notification_id":"ntf_01J...", "status":"accepted", "channels":["email","push","in_app"]}
```

Unique key `(tenant_id, idempotency_key)` khiến retry trả về notification ID ban đầu. Vì vậy nếu response bị mất, client vẫn có thể retry an toàn. `409 Conflict` nghĩa là cùng key được dùng cho request fingerprint khác.

### Query status

`GET /v1/notifications/{notification_id}` trả logical state và state của từng channel. Kết quả eventually consistent tối đa vài giây trong lúc worker cập nhật attempt.

### Preferences

`GET /v1/users/{user_id}/notification-preferences` và `PUT /v1/users/{user_id}/notification-preferences` quản lý opt-out và quiet hours. `PUT` idempotent với version `If-Match`; version cũ trả `412 Precondition Failed`. Channel quan trọng với product có thể được policy bảo vệ, nhưng legal opt-out luôn được ưu tiên.

### In-app inbox

`GET /v1/users/{user_id}/inbox?cursor=...&limit=50` trả danh sách phân trang bằng cursor. `POST /v1/users/{user_id}/inbox/{message_id}/read` idempotent và ghi `read_at`.

Cancellation dùng `POST /v1/notifications/{id}/cancel` cùng idempotency key. Chỉ thành công khi channel delivery còn `pending` hoặc `scheduled`. Provider call đã bắt đầu có thể vẫn hoàn tất, nên không quảng bá cancellation như một cơ chế retraction.

## 4. Durable state

**[PROPOSED DESIGN]** PostgreSQL là source of truth cho command, preference và state transition. Kafka chỉ vận chuyển work, không phải audit database. Command và idempotency record phải được commit trước khi API trả `202`.

```sql
CREATE TABLE notifications (
  tenant_id        bigint NOT NULL,
  notification_id  uuid NOT NULL,
  idempotency_key  text NOT NULL,
  request_hash     bytea NOT NULL,
  user_id          bigint NOT NULL,
  template_name    text NOT NULL,
  template_version int NOT NULL,
  variables_json   jsonb NOT NULL,
  created_at       timestamptz NOT NULL,
  send_at          timestamptz NOT NULL,
  status           text NOT NULL,
  PRIMARY KEY (tenant_id, notification_id),
  UNIQUE (tenant_id, idempotency_key)
) PARTITION BY RANGE (created_at);

CREATE TABLE deliveries (
  tenant_id        bigint NOT NULL,
  delivery_id      uuid NOT NULL,
  notification_id  uuid NOT NULL,
  channel          text NOT NULL,
  status            text NOT NULL,
  attempt_count    int NOT NULL,
  next_attempt_at  timestamptz,
  provider_id      text,
  last_error       text,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, delivery_id)
);
```

`request_hash` ngăn việc dùng lại idempotency key cho request khác. Mỗi delivery có status và retry schedule riêng, nên SMS provider lỗi không chặn email đang hoạt động bình thường.

Preference và inbox row phải có tenant scope. Audit record nên append-only và có event type, actor hoặc service, timestamp, delivery ID nếu có và outcome. Personal content nên tách khỏi operational metadata để privacy deletion không phải rewrite toàn bộ lịch sử vận hành.

## 5. Processing flow

**[PROPOSED DESIGN]** Dùng transactional outbox:

1. API validate command, kiểm tra idempotency key, lưu notification và channel delivery, đồng thời ghi outbox event trong một PostgreSQL transaction.
2. Outbox publisher đọc các row đã commit và publish work lên Kafka. Chỉ đánh dấu outbox row là published sau khi broker acknowledge.
3. Channel consumer claim work, kiểm tra lại cancellation và policy state, render hoặc load template đã được duyệt, rồi gọi provider qua channel adapter.
4. Consumer lưu attempt và state kế tiếp. Crash có thể gây redelivery, nên state transition và attempt record phải an toàn khi lặp lại.

Outbox xử lý khoảng trống giữa database và broker. Nó không biến provider delivery thành exactly once; stable delivery ID, khả năng deduplication của provider và xử lý state idempotent ở local mới giúp giảm duplicate effect.

Scheduled work có thể nằm trong PostgreSQL đến `send_at`, hoặc đặt trong queue hỗ trợ delay. Invariant cần giữ là item scheduled không được dispatch trước due time và cancellation phải lấy row lock trước khi dispatch claim.

## 6. Retry và cô lập provider

Provider call dùng timeout có giới hạn. Failure có thể retry gồm timeout, lỗi connection và response của provider được phân loại rõ là transient. Lỗi validation hoặc policy là permanent, không retry. Exponential backoff có jitter và retry window tối đa; delivery hết retry được đưa vào DLQ cùng error và delivery ID.

**[PROPOSED DESIGN]** Giữ concurrency limit và connection pool riêng cho từng provider và channel. Circuit breaker mở sau một failure threshold đã cấu hình, chặn call mới trong recovery interval, sau đó cho phép một số probe nhỏ. Consumer tạo backpressure khi provider limit hoặc local pool đầy, thay vì nhận vô hạn work trong memory.

Provider adapter nên phân biệt `accepted`, `rejected`, `rate_limited`, `transient_error` và `permanent_error`. Nếu timeout khiến kết quả chưa biết, ghi `unknown` và retry với cùng delivery ID. Không đánh dấu message failed chỉ vì client-side timeout đã hết.

## 7. Consistency, cancellation và inbox read

Notification có thể đã được accept trong khi policy evaluation hoặc delivery còn pending. Preference nên được đọc tại policy decision point. Sau khi delivery đã handed off cho provider, opt-out mới không thể reliably recall message; hệ thống chỉ có thể dừng attempt tiếp theo và ghi lại quyết định.

Cancellation lấy row lock hoặc dùng compare-and-set transition từ `scheduled` hoặc `pending` sang `cancelled`. Dispatch dùng cùng transition boundary. Nếu dispatch đã chuyển sang `sending`, cancellation trả outcome không thành công vì provider call có thể hoàn tất.

Inbox read độc lập với trạng thái delivery bên ngoài. Tạo in-app item như một channel delivery riêng, phân trang bằng cursor ổn định `(created_at, message_id)`, và để read endpoint thực hiện idempotent update. Cách này tránh offset pagination bị dịch khi message mới đến.

## 8. Vận hành và kiểm chứng

Theo dõi acceptance latency, queue lag, delivery latency theo channel, số retry, DLQ depth, nhóm lỗi provider, trạng thái circuit breaker, mức sử dụng database pool và tuổi outbox row. Alert khi lag kéo dài hoặc DLQ tăng liên tục, không chỉ khi API báo lỗi.

Audit state transition thay vì chỉ dựa vào status column có thể thay đổi. Một audit record hữu ích phải trả lời: command được accept lúc nào, policy decision là gì, attempt nào đã chạy, provider trả gì và vì sao chọn final state.

Test trực tiếp các failure boundary: submit trùng, mất response, consumer crash sau provider call, provider timeout với outcome chưa biết, outbox retry, preference version cũ, cancellation race với dispatch và DLQ replay. Công cụ replay phải giữ nguyên delivery ID, đồng thời không bypass tenant authorization hoặc policy check.

## 9. Tóm tắt

Thiết kế tách durable acceptance khỏi provider delivery bất đồng bộ. PostgreSQL quản lý command và state, outbox publish work đã commit, Kafka buffer work, còn channel consumer xử lý retry độc lập. Idempotency key, stable delivery ID, timeout có giới hạn, backpressure, circuit breaker và append-only audit trail xử lý các failure mode chính. Các con số capacity là envelope sizing ban đầu; giới hạn production cần được kiểm chứng bằng payload thực tế, quota của provider và failure testing.
