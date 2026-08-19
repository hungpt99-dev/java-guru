---
title: "Thiết kế hệ thống xử lý và phát video"
description: "Thiết kế hướng production cho việc tiếp nhận, chuyển mã, đóng gói, bảo vệ và phân phối video với độ trễ và chi phí có thể dự đoán."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Bài toán và ranh giới

Ta cần một nền tảng video multi-tenant cho nhà sáng tạo, đơn vị giáo dục và các đội ngũ truyền thông nội bộ. Người dùng tải file nguồn lên, theo dõi tiến độ xử lý, nhận thumbnail rồi xuất bản asset kết quả. Người xem phát các asset đã xuất bản trên điện thoại, trình duyệt và TV kết nối.

> **[SOURCE FACT]** Yêu cầu sản phẩm được nêu gồm upload video có thể tiếp tục sau gián đoạn, phụ đề tùy chọn, các rendition adaptive-bitrate (ABR) ở 240p, 360p, 480p, 720p, 1080p và 4K khi nguồn hỗ trợ; poster và contact sheet; đóng gói HLS và DASH; mã hóa theo từng title; thực thi quyền qua DRM/license; progress bền vững; kiểm tra asset hoàn chỉnh; cùng ba chế độ playback private, theo tenant và public.

> **[SOURCE FACT]** Mục tiêu vận hành được nêu là xử lý ít nhất 25.000 giờ nguồn mỗi giờ trong khung peak thông thường, time to first playable frame dưới 8 giây trên đường CDN warm và dưới 30 giây sau khi upload mới được xuất bản, availability hàng tháng 99,95% cho control plane và 99,99% cho manifest/segment delivery. Source và media dẫn xuất phải bền vững, tăng trưởng storage và chi phí egress phải được giới hạn, worker phải scale theo chiều ngang, và lỗi ở worker, queue, database, cache hoặc region không được gây tính phí hay xuất bản trùng.

> **[ANALYSIS]** API nên sở hữu authorization, metadata, workflow state và progress. Object storage nên lưu các media object lớn, bất biến; CDN phân phối chúng. Request upload và publish phải chỉ enqueue công việc, không chờ transcoding.

Ranh giới này cũng làm rõ retry. Các thao tác control plane có thể idempotent và transactional, còn processing có thể chạy lại từ input và intermediate output bền vững.

## 2. Mô hình capacity

> **[ANALYSIS]** Đây là mục tiêu capacity, không phải tuyên bố về một sản phẩm hiện hữu. Các con số là giả định và phép tính đã nêu, dùng để làm lộ các ràng buộc thiết kế.

| Đại lượng | Giả định và phép tính | Kết quả |
|---|---|---:|
| Người dùng hoạt động hằng ngày | Mục tiêu sản phẩm cho trước | 5.000.000 DAU |
| API request | 5.000.000 người dùng x 20 request/ngày | 100.000.000 request/ngày |
| API RPS trung bình | 100.000.000 / 86.400 | 1.157 RPS |
| API RPS peak | 1.157 x 10 cho launch và giờ xem buổi tối | 11.570 RPS |
| Upload | 300.000/ngày x trung bình 20 phút | 100.000 giờ nguồn/ngày |
| Processing peak | Mục tiêu processing được nêu | 25.000 giờ nguồn/giờ |
| Source storage/ngày | 300.000 x trung bình 1,5 GB source | 450 TB/ngày |
| Derived storage/ngày | 450 TB x 0,9 cho ladder, manifest và thumbnail | 405 TB/ngày |
| Hot storage lưu giữ | (450 + 405) TB x 30 ngày | 25,65 PB hot |
| Viewer egress | 5.000.000 x 2 giờ/ngày x trung bình 1,5 Mbps | 6,75 PB/ngày |
| Tỷ lệ read:write | 100.000.000 API request / 300.000 upload session | khoảng 333:1 |

Giả định source 1,5 GB đại diện cho upload hỗn hợp chất lượng trong 20 phút, ở khoảng 10 Mbps gồm container overhead. Tốc độ xem 1,5 Mbps là trung bình của toàn bộ population trên mobile và broadband, không phải ABR rung cao nhất. Vì egress lớn hơn ingest nhiều, CDN cache hit ratio và origin shielding là các biện pháp kiểm soát chi phí quan trọng.

Ở mức 25.000 giờ nguồn/giờ, một source 20 phút tạo ra 75.000 job/giờ. Nếu một normalized transcode job tiêu thụ 12 worker-phút, trong đó các rendition chạy song song được gom vào cùng job, compute ổn định là 15.000 worker-giờ/giờ, tương đương 15.000 worker equivalent đồng thời. Với headroom 30%, fleet cần 19.500 equivalent. Đây là input cho capacity planning, không phải kết quả benchmark. Estimate thực tế phải đo theo codec, độ phân giải và loại hardware.

Ingest 450 TB/ngày tạo ra 13,5 PB/tháng trước replication. Nếu object-storage service cung cấp durability ba bản, ứng dụng vẫn nên lập ngân sách logical bytes tách khỏi physical copies. Hot retention là 25,65 PB; sau 30 ngày, original và derivative ít được xem có thể chuyển sang storage rẻ hơn, nhưng phải tuân theo legal hold và policy của tenant.

Các availability target tương đương error budget khoảng 21,9 phút/tháng cho control plane 99,95% và 4,4 phút cho playback delivery 99,99%. Thiết kế synchronous một region không thể đáng tin cậy đạt mục tiêu playback trong regional outage. Media nên được replicate cross-region, và CDN nên có origin ở ít nhất hai region.

## 3. API contract

> **[PROPOSED DESIGN]** Dùng bearer token ngắn hạn, tenant authorization và idempotency key trên mọi endpoint mutation. Byte upload đi thẳng tới object storage qua multipart session; application server không proxy chúng.

### Tạo upload

`POST /v1/uploads`

Request:

```json
{
  "filename": "lecture-01.mov",
  "size_bytes": 2147483648,
  "content_sha256": "optional-full-file-hash",
  "visibility": "private"
}
```

Response `201`:

```json
{
  "upload_id": "upl_01J...",
  "asset_id": "ast_01J...",
  "part_size_bytes": 67108864,
  "parts": [{"part_number": 1, "url": "https://object.example/..."}],
  "expires_at": "2026-08-15T04:00:00Z"
}
```

Client gửi `Idempotency-Key: <tenant-id>/<client-upload-id>`. Gọi lại request trả về các ID ban đầu và không tạo asset khác. Kiểm tra checksum của từng part rồi thực hiện compose cuối để upload thiếu hoặc sai thứ tự không đi vào processing.

### Hoàn tất upload

`POST /v1/uploads/{upload_id}/complete`

Request:

```json
{"parts":[{"part_number":1,"etag":"..."},{"part_number":2,"etag":"..."}]}
```

Response `202`:

```json
{"upload_id":"upl_01J...","asset_id":"ast_01J...","state":"INSPECTING"}
```

Endpoint xác minh object manifest, ghi outbox event trong cùng database transaction với việc ghi state `UPLOADED`, rồi trả `202`. Nếu response bị mất, client có thể đọc lại idempotency record và state hiện tại. Outbox ngăn state change đã commit nhưng queue event tương ứng bị mất.

### Đọc trạng thái

`GET /v1/assets/{asset_id}` trả state, phần trăm, các rendition đã hoàn tất, lỗi và version. Khi đang processing, client poll với `If-None-Match` mỗi 2 giây rồi back off. API không được báo `PUBLISHED` trước khi manifest validation, encryption và authorization metadata hoàn tất.

### Xuất bản và phát

`POST /v1/assets/{asset_id}/publish` chuyển asset đã validate sang `PUBLISHED` sau entitlement check. `GET /v1/assets/{asset_id}/playback` trả signed manifest URL ngắn hạn và cấu hình DRM license; không trả media bytes. Playback token chứa tenant, asset, expiry và policy claims. License request được authenticate riêng và rate limit theo viewer và device.

### Hợp đồng vận hành

Mutation trả `request_id` ổn định. `409` nghĩa là state transition được yêu cầu không hợp lệ; `429` có `Retry-After`; `503` có thể retry. Client chỉ retry operation idempotent, dùng exponential backoff và jitter. Mỗi upload URL chỉ có scope cho một object prefix, part, checksum và expiry.

## 4. Data model

> **[PROPOSED DESIGN]** PostgreSQL-compatible SQL là source of truth của control plane. Media bytes nằm trong object storage, dưới các immutable key tạo từ asset ID và rendition ID.

```sql
CREATE TABLE assets (
  tenant_id     BIGINT NOT NULL,
  asset_id      UUID NOT NULL,
  source_object TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN
    ('UPLOADING','INSPECTING','PROCESSING','READY','PUBLISHED','FAILED')),
  visibility    TEXT NOT NULL CHECK (visibility IN ('PRIVATE','TENANT','PUBLIC')),
  progress      NUMERIC NOT NULL DEFAULT 0,
  version       BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, asset_id)
);

CREATE TABLE renditions (
  tenant_id   BIGINT NOT NULL,
  asset_id    UUID NOT NULL,
  rendition   TEXT NOT NULL,
  object_root TEXT NOT NULL,
  state       TEXT NOT NULL,
  PRIMARY KEY (tenant_id, asset_id, rendition)
);

CREATE TABLE outbox_events (
  event_id    UUID PRIMARY KEY,
  tenant_id   BIGINT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  published_at TIMESTAMPTZ
);
```

Lưu idempotency record với tenant và key là một cặp unique, cùng request result và expiry. Worker dùng row lock hoặc atomic state transition khi claim job. Worker crash khi đó chỉ để lại work có thể retry, không cho phép hai worker cùng publish một rendition.

Một rendition chỉ complete sau khi segment, manifest, encryption metadata và validation result đã bền vững. Publication nên là conditional transition từ `READY` sang `PUBLISHED`, để retry không thể publish asset chưa hoàn chỉnh.

## 5. Processing workflow

> **[PROPOSED DESIGN]** Dùng durable queue cho workflow event và tách queue cho inspection, transcoding, thumbnail, packaging và validation. Source object là immutable; mỗi stage ghi output có version vào object prefix mới.

Workflow gồm các bước:

1. Hoàn tất multipart upload, đồng thời ghi `UPLOADED` và outbox event một cách atomic.
2. Inspect container, codec, duration, kích thước, caption và integrity. Input không hỗ trợ hoặc hỏng bị từ chối, nhưng source không bị xóa.
3. Lập lịch ABR ladder và thumbnail. Job ghi input version, output cần có, số lần thử và lease expiry.
4. Transcode các rendition độc lập khi phù hợp. Worker gia hạn lease, báo cáo progress bền vững và ghi output vào temporary prefix.
5. Đóng gói HLS và DASH, mã hóa media, rồi đăng ký key ID và DRM metadata với license service.
6. Validate manifest, tham chiếu tới segment, encryption metadata và các rendition bắt buộc. Promote output đã validate sang immutable serving prefix.
7. Ghi `READY`; chỉ publish sau entitlement check và publish request rõ ràng.

Progress là tổng hợp theo trọng số của các stage, không phải khẳng định rằng phần trăm byte tương đương progress người dùng nhìn thấy. Retry dùng exponential backoff. Lỗi validation vĩnh viễn chuyển asset sang `FAILED` cùng error code ổn định; lỗi provider tạm thời vẫn retry được.

## 6. Delivery và resilience

> **[PROPOSED DESIGN]** Đặt CDN trước các manifest và segment immutable. Dùng origin shielding, signed URL hoặc cookie, và cache key không phụ thuộc authorization header; authorization vẫn được thực hiện khi cấp token và tại license service.

Playback service kiểm tra visibility của tenant và entitlement trước khi cấp manifest URL ngắn hạn. CDN chỉ phục vụ object nằm trong phạm vi token đó. DRM license authorization vẫn là request riêng, nhờ vậy license policy có thể thay đổi mà không phải expose credential của object storage.

Control plane đặt timeout cho mọi dependency call, chỉ retry có giới hạn với operation an toàn khi retry, và dùng circuit breaker (ngắt mạch) để dependency lỗi không chiếm hết connection-pool slot. Queue tạo backpressure (áp lực ngược) giữa upload volume và worker capacity. Dead-letter queue giữ lại event cần operator hoặc policy review.

Failure policy phải rõ ràng:

- Worker lỗi làm lease hết hạn; worker khác retry job từ input bền vững hoặc intermediate output đã verify.
- Queue lỗi tạm dừng scheduling mới, trong khi outbox event đã commit vẫn sẵn sàng để replay.
- Database lỗi thì dừng state transition thay vì đoán kết quả. Idempotency record ngăn client retry tạo asset khác.
- Cache lỗi thì bypass tới database hoặc origin trong giới hạn timeout; cache không được thay đổi quyết định authorization.
- Region lỗi được xử lý bằng control plane recovery cross-region và media origin đã replicate. CDN có thể chọn origin khác.

Không dùng distributed transaction giữa database, object storage, queue và DRM service. Thay vào đó dùng local transaction, outbox, idempotent consumer và reconciliation job. Reconciliation đối chiếu database state với object manifest và record từ provider, sau đó sửa event bị thiếu hoặc đánh dấu asset không nhất quán để review.

## 7. Chi phí và vận hành

Các khoản chi phí chính dự kiến là source và derived storage, transcoding compute và viewer egress. Capacity model cho thấy vì sao cần CDN caching và origin shielding để kiểm soát egress. Lifecycle policy có thể chuyển original cũ và derivative ít được xem sang storage rẻ hơn, nhưng phải ưu tiên legal hold và retention policy của tenant.

Theo dõi, theo tenant và asset, logical source bytes, derived bytes, transcode worker time, storage class, CDN request, cache hit ratio, origin egress và license request. Các dimension này hỗ trợ chargeback mà không tính phí hai lần khi job retry.

Monitor workflow lag, queue age, job lease expiry, retry count, validation failure, time to first playable frame, manifest error rate, segment origin error rate và playback authorization failure. Alert theo mức tiêu thụ error budget thay vì chỉ theo host utilization.

## 8. Invariant và trade-off

Thiết kế dựa trên một số invariant:

- Asset chỉ được publish từ `READY`, sau validation và entitlement check.
- Upload hoàn tất có một immutable source object và một asset identity idempotent.
- Rendition chỉ được serve từ immutable prefix đã validate.
- Mọi state transition nhìn thấy từ bên ngoài phải bền vững trước khi event được acknowledge.
- Retry có thể lặp lại work, nhưng không được lặp lại billing hoặc publication.
- Authorization do control plane và license service quyết định, không chỉ dựa vào object-storage URL.

Đổi lại, hệ thống cần thêm metadata, reconciliation và lifecycle machinery để có processing bất đồng bộ an toàn và semantics publication bền vững. Các con số capacity là giả định cần kiểm chứng, không phải cam kết hiệu năng. Trước khi chọn worker type, storage class hoặc regional topology, cần benchmark codec, diễn tập failure và test playback với dữ liệu đại diện.
