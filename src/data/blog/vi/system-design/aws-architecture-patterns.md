---
title: "Xử lý đơn hàng production với các mẫu kiến trúc AWS"
description: "Thiết kế có phân biệt nguồn cho một hệ thống xử lý đơn hàng đa AZ, dựa trên hàng đợi, kèm ranh giới lỗi và bảo đảm delivery."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Bài toán và phạm vi

Nguồn được sử dụng cho bài viết này là [**AWS Architecture Blog**](https://aws.amazon.com/blogs/architecture/). Tuy nhiên, tài liệu được cung cấp cùng bài viết không mô tả một hệ thống production cụ thể, cũng không cung cấp thông tin về traffic, database schema hay các chi tiết triển khai thực tế của một hệ thống nào.

Điều này rất quan trọng khi đọc và áp dụng các bài viết về kiến trúc. AWS Architecture Blog có thể cung cấp các nguyên tắc, pattern và kinh nghiệm thiết kế, nhưng không nên từ đó suy ra rằng một hệ thống production cụ thể của AWS chắc chắn được xây dựng theo đúng topology hay cách triển khai nào đó.

Vì vậy, thay vì cố gắng tái dựng một hệ thống production không có trong nguồn, bài viết này sử dụng các chủ đề kiến trúc đó để xây dựng một **order processing platform** làm ví dụ.

Bài toán là một hệ thống xử lý đơn hàng có các yêu cầu sau:

- Client gửi một order và không phải chờ toàn bộ quá trình fulfillment hoàn tất.
- Sau khi request được ghi nhận an toàn, client có thể nhận được response.
- Hệ thống phải giữ được thông tin về order ngay cả khi các bước xử lý phía sau gặp sự cố.
- Nếu client retry request, hệ thống không được tạo ra duplicate order hoặc duplicate side effect.
- Các tác vụ xử lý chậm phải được đưa ra khỏi request path để không làm tăng latency của API.
- Hệ thống vẫn có thể tiếp tục nhận và xử lý công việc khi một availability zone hoặc một nhóm worker gặp vấn đề.
- Client vẫn có thể kiểm tra trạng thái order trong khi quá trình xử lý phía sau đang diễn ra.

Từ đó, chúng ta có thể chia hệ thống thành một số phần rõ ràng:

- **Request path**: nhận request, validate và lưu order.
- **Queue**: lưu các công việc cần xử lý và hấp thụ traffic tăng đột biến.
- **Worker**: xử lý fulfillment ở phía sau.
- **Read path**: cho phép client xem trạng thái order độc lập với quá trình fulfillment.

Điểm quan trọng nhất của thiết kế này là phải xác định rõ **mỗi bước chịu trách nhiệm cho điều gì và chuyện gì xảy ra khi một thành phần bị lỗi**.

Ví dụ, việc API trả về `200 OK` sau khi order được ghi vào database không có nghĩa là email đã gửi thành công, payment đã hoàn tất hay fulfillment đã hoàn thành.

Trong thiết kế này:

> **Accepted order chỉ có nghĩa hệ thống đã ghi nhận order một cách an toàn. Nó không có nghĩa mọi bước xử lý phía sau đã hoàn tất.**

Đây là một contract rất quan trọng vì nó giúp request của người dùng không bị phụ thuộc trực tiếp vào tốc độ hoặc tình trạng của tất cả downstream service.

## 2. Ranh giới nguồn và hệ thống đề xuất

Nguồn được xác minh cho bài viết là landing page của **AWS Architecture Blog**:

https://aws.amazon.com/blogs/architecture/

Nguồn này không mô tả một runtime system cụ thể cho order processing với các thành phần như queue, database, retry policy hay multi-AZ topology.

Do đó, các thành phần trong phần thiết kế bên dưới **không nên được hiểu là kiến trúc production thực tế của AWS**.

Thay vào đó, đây là một thiết kế được xây dựng dựa trên các nguyên tắc kiến trúc liên quan đến:

- High availability
- Decoupling
- Asynchronous processing
- Queue-based architecture
- Fault isolation
- Retry
- Idempotency
- Multi-AZ deployment

Trong thiết kế đề xuất, Order API sẽ ghi cả **order** và **outbox event** vào cùng một database transaction.

Sau đó, một **outbox relay** sẽ đọc các event chưa được publish và đưa chúng vào durable queue.

Fulfillment worker lấy message từ queue và xử lý order.

Notification được tách thành một queue và worker riêng để việc gửi email hoặc webhook không ảnh hưởng trực tiếp đến fulfillment.

Luồng tổng quát sẽ là:

```text
Client
  │
  ▼
Order API
  │
  ├── Order
  │
  └── Outbox Event
        │
        ▼
   Outbox Relay
        │
        ▼
   Order Queue
        │
        ▼
Fulfillment Worker
        │
        ├── External Fulfillment
        │
        └── Notification Queue
                  │
                  ▼
          Notification Worker
```

Như vậy, khi client gửi order, API chỉ cần hoàn thành phần quan trọng nhất của request:

1. Validate request.
2. Kiểm tra idempotency key.
3. Ghi order.
4. Ghi outbox event.
5. Commit transaction.
6. Trả response.

API không cần phải chờ fulfillment provider hoặc email provider xử lý xong.

Điều này giúp giảm sự phụ thuộc giữa các thành phần.

Ví dụ, nếu email provider mất 10 giây để phản hồi, request tạo order vẫn không cần mất thêm 10 giây.

## 3. Kiến trúc

Vì nguồn được cung cấp không mô tả runtime component cụ thể, sơ đồ bên dưới là **proposed design**, không phải sơ đồ triển khai thực tế của AWS.

```text
┌──────────┐
│  Client  │
└────┬─────┘
     │
     ▼
┌─────────────────────┐
│ API Ingress         │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Order API           │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Orders + Outbox     │
│ Database            │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Outbox Relay        │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Durable Order Queue │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Fulfillment Workers │
│ [Proposed]          │
└──────┬──────────────┘
       │
       ├─────────────────────┐
       │                     │
       ▼                     ▼
┌───────────────┐    ┌────────────────────┐
│ External      │    │ Notification Queue │
│ Fulfillment   │    │ [Proposed]         │
└───────────────┘    └─────────┬──────────┘
                               │
                               ▼
                      ┌────────────────────┐
                      │ Notification       │
                      │ Workers            │
                      │ [Proposed]         │
                      └─────────┬──────────┘
                                │
                                ▼
                       Email/Webhook Provider
```

Order status có thể được đọc thông qua một API riêng:

```text
Client
  │
  ▼
Order Status API
  │
  ▼
Orders Database
```

API đọc trạng thái không cần gọi fulfillment provider hoặc notification provider.

Điều này cho phép client biết order đang ở trạng thái nào ngay cả khi quá trình xử lý phía sau đang chậm.

### Multi-AZ

Nếu triển khai trên AWS, stateless API và worker pool có thể được phân bố trên ít nhất hai Availability Zone.

Ví dụ:

```text
                 Load Balancer
                       │
          ┌────────────┴────────────┐
          │                         │
     Availability Zone A       Availability Zone B
          │                         │
      API / Worker              API / Worker
          │                         │
          └────────────┬────────────┘
                       │
                  Data Layer
```

Tuy nhiên, **multi-AZ không đồng nghĩa với availability guarantee tuyệt đối**.

Có nhiều failure khác vẫn có thể xảy ra:

- Database connection pool bị cạn.
- Một dependency bên ngoài bị lỗi.
- Worker bị memory leak.
- Deployment mới có bug.
- Queue consumer bị lỗi.
- Database trở nên quá tải.
- External provider phản hồi quá chậm.
- Một message bị lỗi liên tục.

Vì vậy, việc chạy ở nhiều Availability Zone chỉ giải quyết một nhóm failure cụ thể. Hệ thống vẫn cần timeout, retry, idempotency, monitoring và cơ chế xử lý failure ở từng layer.

## 4. Request path và delivery guarantee

Một mục tiêu quan trọng của thiết kế là tách **việc nhận order** khỏi **việc xử lý order**.

Khi client gửi request:

```text
Client
   │
   │ POST /orders
   │
   ▼
Order API
   │
   ├── Validate request
   │
   ├── Check idempotency key
   │
   ├── Insert order
   │
   └── Insert outbox event
          │
          ▼
      COMMIT
          │
          ▼
       Response
```

API nhận một **idempotency key** do client cung cấp.

Ví dụ:

```text
Idempotency-Key: 8d3e2c...
```

Giả sử client gửi request nhưng mạng bị timeout.

Client không biết server đã xử lý thành công hay chưa nên retry request.

Nếu không có idempotency:

```text
Request #1 → Create Order #123
Request #2 → Create Order #124
```

Client chỉ muốn tạo một order nhưng hệ thống lại tạo hai order.

Với idempotency key, server có thể nhận ra hai request thực chất là cùng một operation:

```text
Request #1
Idempotency-Key = ABC
       │
       ▼
Create Order #123

Request #2
Idempotency-Key = ABC
       │
       ▼
Return existing result
```

Nếu client retry cùng key và cùng request data, server có thể trả lại kết quả ban đầu.

Nếu client sử dụng cùng key nhưng payload khác, request nên bị từ chối vì đây có thể là lỗi phía client.

Database có thể enforce rule này bằng unique constraint:

```text
(customer_id, idempotency_key)
```

### Tại sao cần Outbox?

Có một vấn đề rất phổ biến khi vừa sử dụng database vừa publish message vào queue.

Giả sử code làm như sau:

```text
1. Save order to database
2. Publish message to queue
```

Có thể xảy ra:

```text
Save order
    │
    ▼
Database commit OK
    │
    ▼
Application crash
    │
    X
Publish message
```

Kết quả:

```text
Database: Order tồn tại
Queue:    Không có message
```

Order đã được tạo nhưng không có worker nào biết rằng cần xử lý nó.

Chiều ngược lại cũng có thể xảy ra:

```text
Publish message
    │
    ▼
Application crash
    │
    X
Database commit
```

Queue có message nhưng database không có order tương ứng.

Outbox pattern giải quyết vấn đề này bằng cách lưu order và event trong **cùng một database transaction**:

```text
BEGIN TRANSACTION

INSERT INTO orders ...

INSERT INTO outbox ...

COMMIT
```

Nếu transaction thành công:

```text
Order tồn tại
+
Outbox event tồn tại
```

Nếu transaction thất bại:

```text
Order không tồn tại
+
Outbox event cũng không tồn tại
```

Sau đó outbox relay chịu trách nhiệm đưa event từ database sang queue.

### Không giả định exactly-once

Một điểm rất quan trọng là outbox relay vẫn có thể publish cùng một event nhiều lần.

Ví dụ:

```text
Relay
  │
  ├── Publish event
  │
  ▼
Queue
  │
  ▼
Success

Relay crash trước khi đánh dấu event = published
```

Khi relay restart, nó có thể publish event đó lần nữa.

Vì vậy:

> **Không nên thiết kế hệ thống dựa trên giả định message chỉ được giao đúng một lần.**

Consumer phải có khả năng xử lý duplicate message một cách an toàn.

Đây là lý do idempotency không chỉ cần ở API mà còn rất quan trọng ở phía consumer.

## 5. Data model

Một relational database phù hợp với phần order vì order state và outbox event cần được ghi một cách atomic.

Ví dụ:

```sql
CREATE TABLE orders (
  order_id          UUID PRIMARY KEY,
  customer_id       UUID NOT NULL,
  idempotency_key   TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  status            TEXT NOT NULL,
  result_json       JSONB,
  created_at        TIMESTAMP NOT NULL,
  updated_at        TIMESTAMP NOT NULL,

  UNIQUE (customer_id, idempotency_key)
);

CREATE TABLE outbox (
  event_id          UUID PRIMARY KEY,
  aggregate_id      UUID NOT NULL,
  event_type        TEXT NOT NULL,
  payload_json      JSONB NOT NULL,
  published_at      TIMESTAMP
);
```

`request_hash` được dùng để kiểm tra request retry có thực sự giống request ban đầu hay không.

Ví dụ:

```text
Request #1
Key = ABC
Payload = Order A

Request #2
Key = ABC
Payload = Order A
```

→ Có thể trả lại kết quả của request đầu tiên.

Nhưng:

```text
Request #1
Key = ABC
Payload = Order A

Request #2
Key = ABC
Payload = Order B
```

→ Không nên coi đây là cùng một request.

### Outbox relay

Relay có thể tìm những event chưa publish:

```text
SELECT *
FROM outbox
WHERE published_at IS NULL
```

Sau đó publish event vào queue.

Khi publish thành công, relay cập nhật:

```text
published_at = current_time
```

Tuy nhiên, vẫn có một khoảng thời gian nhỏ giữa hai bước:

```text
Publish event
      │
      ▼
Queue nhận event
      │
      X
Relay crash
      │
      X
published_at chưa được update
```

Khi relay chạy lại, event có thể được publish thêm một lần.

Đây là lý do consumer phải xử lý duplicate message.

Có thể lưu một idempotency record hoặc xử lý state transition theo cách an toàn để cùng một event dù được xử lý nhiều lần cũng không tạo ra side effect nhiều lần.

Outbox record cũng không nhất thiết phải xóa ngay sau khi publish.

Có thể giữ lại trong một khoảng thời gian phù hợp với chính sách vận hành để hỗ trợ:

- Debug.
- Audit.
- Recovery.
- Replay event.

Retention bao lâu là một quyết định vận hành của hệ thống, không phải một giá trị cố định áp dụng cho mọi hệ thống.

## 6. Xử lý failure

Trong hệ thống production, việc một dependency thỉnh thoảng lỗi hoặc phản hồi chậm là điều có thể xảy ra.

Vì vậy, các request tới database hoặc external service nên có **timeout**.

Ví dụ:

```text
Worker
   │
   │ call external provider
   ▼
External Provider
   │
   │ không phản hồi
   │
   ▼
Timeout
```

Nếu không có timeout, worker có thể bị giữ rất lâu.

Khi nhiều worker cùng bị giữ:

```text
Worker 1 → waiting
Worker 2 → waiting
Worker 3 → waiting
...
Worker N → waiting
```

Cuối cùng worker pool có thể bị cạn.

### Retry

Không phải lỗi nào cũng nên retry.

Ví dụ:

```text
Network timeout       → Có thể retry
Connection reset      → Có thể retry
HTTP 503              → Có thể retry
Invalid request       → Không nên retry
Authentication error  → Không nên retry liên tục
Business validation   → Không nên retry
```

Với lỗi tạm thời, có thể sử dụng exponential backoff.

Ví dụ:

```text
Retry 1 → 1 second
Retry 2 → 2 seconds
Retry 3 → 4 seconds
Retry 4 → 8 seconds
```

Thực tế nên thêm **jitter**, tức một khoảng thời gian ngẫu nhiên nhỏ, để nhiều worker không cùng retry chính xác tại một thời điểm.

Ngoài ra cần giới hạn:

- Số lần retry.
- Thời gian retry.
- Số request đang xử lý đồng thời.

Nếu retry không có giới hạn, một dependency đang gặp vấn đề có thể bị hệ thống tiếp tục gửi thêm request và trở nên quá tải hơn.

### Dead-letter queue

Một message có thể bị lỗi nhiều lần vì chính dữ liệu của nó có vấn đề.

Ví dụ:

```text
Message A
   │
   ▼
Worker
   │
   X
Retry
   │
   X
Retry
   │
   X
Retry
```

Nếu message này cứ nằm trong main queue và được retry mãi, nó có thể chiếm worker và ảnh hưởng đến các message khác.

Vì vậy, sau khi đạt retry policy, message có thể được đưa sang **dead-letter queue (DLQ)**.

```text
Main Queue
    │
    ▼
Worker
    │
    ├── Success → Done
    │
    └── Too many failures
                │
                ▼
               DLQ
```

Operator có thể kiểm tra message trong DLQ, sửa nguyên nhân và sau đó replay message nếu cần.

Điểm quan trọng là replay cũng phải an toàn. Nếu operation có side effect, việc đưa message trở lại queue không được tạo ra duplicate action.

### Backpressure

Khi traffic tăng nhanh hơn khả năng xử lý:

```text
Incoming work
      │
      ▼
    Queue
      │
      │  Queue grows
      ▼
   Workers
```

Queue giúp hệ thống không cần xử lý tất cả request ngay lập tức.

Nhưng queue không làm cho vấn đề biến mất.

Nếu producer tạo:

```text
10,000 messages / second
```

trong khi worker chỉ xử lý:

```text
5,000 messages / second
```

thì queue sẽ tiếp tục tăng.

Do đó cần theo dõi:

- Queue depth.
- Message age.
- Worker throughput.
- Worker failure rate.
- Retry rate.

Đồng thời không nên tăng concurrency vô hạn để cố xử lý queue nhanh hơn.

Ví dụ:

```text
More workers
     │
     ▼
More DB connections
     │
     ▼
Database overloaded
     │
     ▼
More failures
     │
     ▼
More retries
     │
     ▼
Even more load
```

Vì vậy, cần kiểm soát số lượng work đang xử lý đồng thời và bảo vệ database connection pool.

### Circuit breaker

Nếu external provider liên tục lỗi:

```text
Worker → Provider → Error
Worker → Provider → Error
Worker → Provider → Error
...
```

Việc tiếp tục gọi provider có thể làm tình hình tệ hơn.

Circuit breaker có thể tạm thời ngừng gửi request tới dependency đó.

```text
Normal
   │
   ▼
Provider errors increase
   │
   ▼
Circuit OPEN
   │
   │ stop calling provider
   ▼
Wait
   │
   ▼
Test again
   │
   ├── Healthy → CLOSED
   │
   └── Still failing → OPEN
```

Tuy nhiên, circuit breaker không thay thế timeout, retry hay idempotency.

Nó chỉ là một lớp bảo vệ bổ sung.

Tùy business requirement, khi circuit mở, hệ thống có thể:

- Để message tiếp tục nằm trong queue.
- Retry sau.
- Trả failure.
- Chuyển sang một flow xử lý khác.

Quyết định nào phù hợp phụ thuộc vào business contract.

## 7. Read path và vận hành

Một điểm quan trọng của hệ thống là **status API không cần phụ thuộc vào fulfillment provider**.

Client có thể gọi:

```text
GET /orders/{orderId}
```

và nhận:

```json
{
  "orderId": "123",
  "status": "PROCESSING"
}
```

API chỉ cần đọc durable state của order.

```text
Client
   │
   ▼
Status API
   │
   ▼
Orders Database
```

Nó không cần làm:

```text
Status API
   │
   ├── Call fulfillment provider
   ├── Call payment provider
   └── Call notification provider
```

Nếu làm như vậy, read request cũng sẽ bị ảnh hưởng bởi các dependency bên ngoài.

Ví dụ fulfillment provider đang chậm:

```text
GET /orders/123
       │
       ▼
Status API
       │
       ▼
Fulfillment Provider
       │
       X
     timeout
```

Trong khi thông tin order đã có sẵn trong database.

Nếu read traffic tăng mạnh độc lập với write traffic, có thể xây dựng một read projection riêng.

Tuy nhiên, khi dùng projection, hệ thống phải chấp nhận rằng dữ liệu có thể không cập nhật ngay lập tức.

Ví dụ:

```text
Primary DB
    │
    ▼
Event
    │
    ▼
Read Projection
```

Có thể xảy ra:

```text
Primary DB:
status = FULFILLED

Read Projection:
status = PROCESSING
```

trong một khoảng thời gian ngắn.

Do đó API nên có contract rõ ràng về độ trễ cập nhật của read model.

### Monitoring

Các signal quan trọng nên phản ánh trực tiếp các failure point của hệ thống.

Ở API:

- Request error rate.
- Request latency.
- Timeout rate.

Ở queue:

- Queue depth.
- Message age.
- Retry count.
- DLQ message count.

Ở worker:

- Processing success rate.
- Failure rate.
- Processing latency.
- Number of active workers.

Ở database:

- Connection pool usage.
- Query latency.
- Connection exhaustion.
- Error rate.

Ở outbox:

- Số lượng event chưa publish.
- Outbox processing latency.
- Publish failure rate.

Ở external provider:

- Request latency.
- Timeout rate.
- Error rate.
- Circuit breaker state.

Các metric này không phải measurement lấy từ AWS Architecture Blog. Đây là những signal được đề xuất dựa trên failure modes của design.

### Failure testing

Không nên chỉ kiểm tra hệ thống trong điều kiện mọi thứ đều hoạt động bình thường.

Nếu kiến trúc tuyên bố có khả năng xử lý worker failure, cần thực sự test:

```text
Worker đang processing
       │
       ▼
Worker bị kill
       │
       ▼
Message được retry
       │
       ▼
Worker khác tiếp tục xử lý
```

Nếu outbox relay được thiết kế để phục hồi sau crash:

```text
Publish event
       │
       ▼
Relay crash
       │
       ▼
Relay restart
       │
       ▼
Event có thể được publish lại
       │
       ▼
Consumer xử lý duplicate an toàn
```

Có thể kiểm thử thêm:

- External provider phản hồi chậm.
- External provider trả HTTP 5xx.
- Database connection pool bị cạn.
- Queue tăng nhanh hơn worker throughput.
- Một Availability Zone bị mất.
- Worker restart liên tục.
- Poison message xuất hiện.
- Notification provider bị down.

Mục tiêu không phải chứng minh hệ thống **không bao giờ lỗi**.

Mục tiêu là chứng minh rằng khi lỗi xảy ra, hệ thống vẫn giữ được các guarantee đã định nghĩa.

## 8. Tóm tắt cho phỏng vấn

Khi giải thích kiến trúc này trong một buổi system design interview, không nên bắt đầu bằng việc liệt kê hàng loạt AWS service.

Ví dụ:

```text
API Gateway
→ ECS
→ SQS
→ RDS
→ ElastiCache
→ Lambda
→ SNS
→ ...
```

Cách tốt hơn là bắt đầu từ **requirement, guarantee và failure scenario**.

Có thể giải thích theo thứ tự:

### 1. Order phải được ghi nhận an toàn

Order và outbox event được ghi trong cùng một database transaction.

```text
Order + Outbox
      │
      ▼
   COMMIT
```

Nếu transaction thành công, hệ thống biết rằng order và event đã được lưu.

### 2. Message có thể được gửi nhiều lần

Outbox relay và queue nên được thiết kế theo hướng **at-least-once delivery**.

Không nên giả định message chỉ xuất hiện đúng một lần.

Vì vậy consumer phải idempotent.

### 3. Retry request không được tạo duplicate order

Client sử dụng idempotency key.

```text
Same key
   │
   ├── First request → Create
   │
   └── Retry         → Return existing result
```

### 4. External side effect cũng phải idempotent

Local database transaction không thể biến một call tới external system thành exactly-once.

Ví dụ:

```text
Worker
   │
   ▼
External Fulfillment
   │
   ▼
Success
   │
Worker crashes
   │
   ▼
Retry
```

Nếu external system không hỗ trợ idempotency, retry có thể tạo duplicate side effect.

Do đó nên truyền một idempotency token cho external operation nếu provider hỗ trợ.

### 5. Queue tách request khỏi processing

Client không phải chờ fulfillment hoàn tất.

```text
Client
  │
  ▼
API
  │
  ▼
Durable storage
  │
  ▼
Response

          asynchronous
               │
               ▼
             Queue
               │
               ▼
             Worker
```

Điều này giúp latency của request không phụ thuộc trực tiếp vào tốc độ của downstream processing.

### 6. Worker failure có thể được phục hồi

Worker sử dụng lease hoặc visibility timeout để message có thể được xử lý lại nếu worker chết giữa chừng.

```text
Message
   │
   ▼
Worker A
   │
   X
  crash
   │
   ▼
Worker B
   │
   ▼
Retry
```

### 7. Retry phải có giới hạn

Chỉ retry những lỗi có khả năng tạm thời.

Dùng exponential backoff và jitter.

Giới hạn số lần retry hoặc tổng thời gian retry.

Nếu message vẫn không xử lý được, chuyển sang DLQ để không ảnh hưởng các message khác.

### 8. Multi-AZ giảm ảnh hưởng của AZ failure

API và worker có thể chạy trên nhiều Availability Zone.

Nhưng multi-AZ không giải quyết tất cả vấn đề.

Database overload, bad deployment, connection pool exhaustion hay external dependency failure vẫn có thể làm hệ thống gặp sự cố.

## Kết luận

Điểm quan trọng của kiến trúc này không nằm ở việc chọn càng nhiều AWS service càng tốt.

Điểm quan trọng là xác định rõ:

> **Nếu một thành phần bị lỗi, hệ thống vẫn giữ được điều gì?**

Một thiết kế production tốt nên trả lời được các câu hỏi như:

- Nếu client retry thì có tạo duplicate order không?
- Nếu application crash sau khi database commit thì order có bị mất không?
- Nếu relay crash sau khi publish thì duplicate message có gây duplicate side effect không?
- Nếu worker chết giữa quá trình xử lý thì message có được xử lý lại không?
- Nếu external provider chậm thì request của client có bị chậm theo không?
- Nếu một message bị lỗi liên tục thì nó có ảnh hưởng đến các message khác không?
- Nếu queue tăng nhanh thì hệ thống có cơ chế kiểm soát tải không?
- Nếu một Availability Zone gặp sự cố thì hệ thống còn nhận request được không?
- Nếu read traffic tăng mạnh thì nó có ảnh hưởng đến write path không?

Từ các guarantee này mới quyết định nên dùng AWS service nào.

Ví dụ, sau khi xác định requirement, ta mới có thể map design sang các AWS service phù hợp:

```text
API Ingress
     ↓
API Service
     ↓
Relational Database
     ↓
Outbox Relay
     ↓
Durable Queue
     ↓
Worker
     ↓
External Services
```

Có thể triển khai các thành phần này bằng nhiều lựa chọn AWS khác nhau tùy requirement về scale, operational overhead, consistency, cost và team capability.

Vì vậy, **AWS service là implementation choice; architecture guarantee mới là phần quan trọng nhất của system design.**

Nguồn AWS Architecture Blog cung cấp các chủ đề và nguyên tắc kiến trúc để tham khảo. Còn order processing platform trong bài này là **proposed design**, được xây dựng để minh họa cách áp dụng những nguyên tắc đó vào một bài toán production thực tế.
