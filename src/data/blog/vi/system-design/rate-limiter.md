---
title: "Rate Limiter Phân tán: Thiết kế và xử lý lỗi"
description: "Thiết kế thực tế cho giới hạn request độ trễ thấp, xử lý burst, policy theo route và hành vi lỗi rõ ràng."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Bài toán

API gateway cần có một quyết định trước khi gọi application code: **principal này có được phép tiêu thụ một đơn vị quota ngay bây giờ không?** Principal có thể là user, source IP, API key hoặc OAuth token. Policy áp dụng có thể khác theo route, HTTP method, gói tenant và region.

Limiter phải hỗ trợ token bucket để kiểm soát tốc độ refill và cho phép burst có giới hạn, cùng sliding window khi sản phẩm cần một số đếm cứng trong một khoảng thời gian. Request bị từ chối trả về HTTP `429 Too Many Requests` với giá trị `Retry-After` hữu ích. Thay đổi policy phải đến được gateway mà không cần restart.

Caller của dịch vụ là API gateway và các service nội bộ. Platform team và product team vận hành dịch vụ. Vì limiter nằm trên synchronous request path, các ràng buộc chính là latency, availability, ngữ nghĩa counter, khả năng scale, hành vi của clock và an toàn khi lỗi.

### Yêu cầu [SOURCE FACT]

| Yêu cầu | Mục tiêu |
|---|---|
| Độ trễ quyết định | p99 dưới 1 ms tại gateway, không tính thời gian mạng đến origin |
| Availability của quyết định | 99.99% mỗi tháng cho limiter path |
| Ngữ nghĩa counter | Một logical counter toàn cục cho mỗi key và policy, với staleness chéo region có giới hạn và được ghi rõ |
| Khả năng scale | Không có hotspot trung tâm cố định; shard ownership theo chiều ngang |
| Hành vi của clock | Tính đúng không được phụ thuộc vào wall clock đã đồng bộ |
| An toàn | Limiter outage không được âm thầm biến thành traffic đắt tiền không giới hạn |

### Hướng thiết kế [ANALYSIS]

Tách decision plane nhanh khỏi control plane chậm hơn. Xem `fail-open` và `fail-closed` là lựa chọn policy rõ ràng, không phải hệ quả ngẫu nhiên của timeout. Lựa chọn phù hợp có thể khác theo endpoint: thao tác đắt tiền có thể fail-closed, còn read ít rủi ro có thể có đường fail-open được giới hạn.

## 2. Ước tính capacity

Phần dưới là mô hình capacity minh họa, không phải số đo production. Cần thay các giả định bằng telemetry của dịch vụ trước khi provision.

### Giả định minh họa [ANALYSIS]

- 10 triệu daily active user (DAU).
- 100 API request mỗi active user mỗi ngày.
- Hệ số peak 10x cho traffic lúc launch và mức tập trung theo ngày.
- 30% capacity headroom.
- 20% decision đến từ API key hoặc service token, không được biểu diễn bởi user session. Traffic này đã nằm trong estimate, không cộng thêm lần nữa.
- Tỷ lệ allow/reject tại peak là 90:10.
- 500 triệu key đang hoạt động, hai replica và 40 byte token-bucket state cho mỗi key trước index và memory overhead.
- Memory overhead 2.5x, idle bucket expiry sau 24 giờ và compact audit/event record 100 byte cho mỗi decision.
- Retention event trong bảy ngày, dữ liệu nén còn 30% kích thước thô.
- 100.000 policy, mỗi policy 1 KB, và key tăng 5% mỗi ngày.

### Tính toán [ANALYSIS]

Các giả định trên cho `10,000,000 x 100 = 1,000,000,000` decision mỗi ngày. Chia cho 86.400 giây cho `11,574` decision mỗi giây ở mức trung bình. Áp dụng peak 10x minh họa cho `115,740` decision mỗi giây; cộng 30% headroom cho mục tiêu lập kế hoạch khoảng `150,000` decision mỗi giây.

Ở peak đó, tỷ lệ allow/reject 90:10 tương đương khoảng `135,000` allow mỗi giây và `15,000` reject mỗi giây. Mỗi decision đọc counter và thường thực hiện một atomic update nhỏ, nên read-to-write ratio của decision plane xấp xỉ `1:1`. Cached policy read nằm ngoài path này.

Với token bucket, `500,000,000 x 40 x 2 = 40 GB` là hot state trước index và memory overhead. Áp dụng overhead minh họa 2.5x cho reservation 100 GB usable in-memory capacity. Expire bucket idle sau 24 giờ là activity TTL, không phải clock dùng để đảm bảo correctness.

Ở peak, `150,000 x 100 = 15 MB/s` event data chưa nén, tương đương khoảng `1.296 TB/ngày`. Giữ detailed decision event ở dạng sampled, nhưng giữ counter và toàn bộ reject. Với kích thước nén minh họa 30%, retention bảy ngày là khoảng `1.296 TB x 7 x 0.3 = 2.72 TB`.

Policy configuration khoảng 100 MB trước replication và cache overhead (`100,000 x 1 KB`). Với key tăng 5% mỗi ngày, active state sẽ tăng từ 500 triệu lên khoảng 525 triệu key sau một ngày nếu expiry không bù lại mức tăng. Mục tiêu availability 99.99% mỗi tháng tương đương khoảng 4,4 phút trong tháng 30 ngày. p99 latency target phải chặt hơn nhiều so với availability budget này: limiter chậm có thể làm cạn connection hoặc thread ở origin trước khi được xem là unavailable.

## 3. API Design

### Decision endpoint [PROPOSED DESIGN]

Gateway gửi một request identity ổn định. Dùng mTLS để xác thực traffic giữa gateway và limiter. Không tin tenant identifier do caller gửi nếu chưa validate gateway identity và quyền của identity đó.

```http
POST /v1/decisions
Authorization: mTLS
Content-Type: application/json
X-Request-Id: 01J...
Idempotency-Key: gateway-01J...-attempt-1

{
  "principal_type": "api_key",
  "principal_id": "key_7f3",
  "route": "POST:/v1/payments",
  "region": "sg",
  "cost": 1
}
```

Response cho phép:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"allowed":true,"remaining":39,"limit":40,"reset_at":"2026-08-15T03:01:00Z","policy_version":812}
```

Response bị từ chối:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2
Content-Type: application/json

{"allowed":false,"remaining":0,"limit":40,"retry_after_ms":1840,"policy_version":812}
```

`cost` cho phép thao tác đắt tiền tiêu thụ nhiều hơn một token. Gateway chuyển tiếp cùng `X-Request-Id`; retry dùng lại cùng `Idempotency-Key`. Deduplicate decision record trong một horizon ngắn được ghi rõ để response timeout không tiêu quota hai lần. Key này không thay thế idempotency key của business operation: tạo payment vẫn cần contract idempotency durable riêng.

### Quản trị policy [PROPOSED DESIGN]

```http
PUT /v1/policies/{policy_id}
If-Match: "policy-version-811"

{"match":{"route":"POST:/v1/payments","plan":"standard"},"algorithm":"token_bucket","rate_per_second":20,"burst":40,"scope":"api_key"}
```

`PUT` là idempotent và `If-Match` ngăn lost update. Chỉ operator có quyền mới được thay đổi policy. Lưu policy dưới dạng các version bất biến. Trong thời gian propagation, gateway có thể tạm thời dùng version trước; hãy xuất propagation delay tối đa thành metric.

## 4. Data Model

### Control plane [PROPOSED DESIGN]

Dùng relational control database làm source of truth cho policy configuration. Giữ mutable bucket state trong sharded in-memory decision store. Định kỳ summarize state này; không copy đồng bộ mọi mutation vào SQL.

```sql
CREATE TABLE rate_policy (
  policy_id        BIGINT PRIMARY KEY,
  version          BIGINT NOT NULL,
  route_pattern    TEXT NOT NULL,
  method           TEXT NOT NULL,
  principal_scope  TEXT NOT NULL,
  algorithm        TEXT NOT NULL CHECK (algorithm IN ('token_bucket', 'sliding_window')),
  rate_per_second  NUMERIC,
  burst            INTEGER,
  window_seconds   INTEGER,
  limit_count      INTEGER,
  state            TEXT NOT NULL CHECK (state IN ('active', 'disabled')),
  updated_at       TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX rate_policy_version
  ON rate_policy (policy_id, version);

CREATE INDEX rate_policy_match
  ON rate_policy (method, route_pattern, principal_scope, state);

CREATE TABLE policy_audit (
  policy_id BIGINT NOT NULL,
  version BIGINT NOT NULL,
  actor TEXT NOT NULL,
  change_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (policy_id, version)
);
```

### Decision state [PROPOSED DESIGN]

Dùng key `hash(tenant_id | principal_type | principal_id | route | policy_id)`. Hash partitioning phân phối traffic customer tùy ý và tránh range hotspot do ID tuần tự. Token-bucket value chứa `{tokens, last_elapsed_ns, policy_version, dedupe_entries}`.

Dùng elapsed time từ monotonic source cho phép tính refill. Wall-clock timestamp có thể trả về trong các field hướng đến client như `reset_at`, nhưng clock synchronization không được quyết định request có được phép hay không. Policy version trong value giúp quan sát thay đổi cấu hình và hỗ trợ cache invalidation an toàn.
