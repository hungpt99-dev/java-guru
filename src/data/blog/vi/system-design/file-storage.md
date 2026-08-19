---
title: "Thiết kế Object Store đa tenant"
description: "Thiết kế thực tế cho object storage có durability cao, version bất biến, multipart transfer, deduplication theo tenant, chia sẻ tạm thời, tìm kiếm metadata và phân phối CDN."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## Bài toán

Ta cần một object store đa tenant cho người dùng sản phẩm, service nội bộ và hệ thống tự động hóa. Client phải có thể upload video 4 GB qua kết nối di động không ổn định, tiếp tục sau khi process khởi động lại, lấy một version cũ và tạo link hết hạn vào ngày mai. Service phải tìm được metadata thuộc tenant mà không quét các byte của blob.

Đây không chỉ là bài toán thiết kế API upload. Hệ thống phải xác định byte nào đã được commit, retry hoạt động thế nào, khi nào version trở nên visible và làm sao giữ metadata tách khỏi data path. Bài viết này đi qua yêu cầu, giả định capacity, API, mô hình lưu trữ, đường truyền, consistency, reliability và các ranh giới security.

### Yêu cầu

Yêu cầu chức năng:

- Multipart upload và download, gồm range có thể tiếp tục và các part chạy song song.
- Object version bất biến. Một logical key như `reports/2026.pdf` có thể trỏ tới version mới trong khi version cũ vẫn truy cập được.
- Deduplication trong phạm vi tenant, không cho tenant này suy ra dữ liệu của tenant khác.
- Read có xác thực và share link ngắn hạn với TTL (thời gian sống), tùy chọn giới hạn số lần tải.
- Tìm kiếm trên metadata được chỉ mục rõ ràng: tenant, key prefix, content type, tag, size và thời điểm tạo.
- Delete, restore, lifecycle expiration và audit event.

Hợp đồng phi chức năng quan trọng hơn một endpoint upload tiện lợi:

- **[SOURCE FACT]** Durability tối thiểu 99.999999999% mỗi năm cho các byte đã commit. Đây là mục tiêu durability, không phải cam kết mọi request luôn available trong thảm họa vùng.
- **[SOURCE FACT]** Availability hàng tháng 99.99% cho metadata API và 99.9% cho data transfer, kèm degraded mode được mô tả rõ.
- Object có kích thước từ kilobyte tới 5 TB. Metadata plane không được mang payload object.
- Capacity phải tăng theo chiều ngang; read public hoặc shared nên cache được ở CDN edge; checksum phải được xác minh tại mọi storage boundary và tenant phải được cô lập.
- Retry thành công không được tạo logical version thứ hai hoặc tính phí client hai lần.

**[ANALYSIS]** Ranh giới phù hợp là giữa transactional metadata/control plane và immutable blob/data plane. Control plane xác định object có ý nghĩa gì và version nào visible. Data plane lưu và truyền byte mà không đưa payload qua metadata database.

## Giả định về quy mô

**[ASSUMPTION]** Các giá trị sau là input để lập kế hoạch, không phải số liệu quan sát được. Khi triển khai cần thay bằng telemetry của sản phẩm.

| Đại lượng | Giả định | Lý do |
|---|---:|---|
| Daily active users | 10 triệu | Sản phẩm consumer/work collaboration quy mô lớn |
| Object API operation trên mỗi active user/ngày | 20 | 8 read, 2 write, 10 thao tác metadata/list/link |
| Logical object mới/ngày | 5 triệu | Không phải API operation nào cũng tạo object |
| Kích thước object mới trung bình | 20 MB | Hỗn hợp document, ảnh và media ngắn; file lớn là thiểu số |
| Tỷ lệ byte read:write | 5:1 | Asset shared được download nhiều lần |
| Hệ số peak | 10x trung bình | Tập trung trong giờ làm việc và các sự kiện ra mắt |
| Retention | 3 năm | Chính sách versioning và recovery |
| Kích thước multipart part | 64 MiB | Retry đủ nhỏ mà không tạo quá nhiều manifest row |

Ước lượng request:

```text
10,000,000 DAU x 20 operations/day = 200,000,000 operations/day
200,000,000 / 86,400 = 2,315 average API requests/second
2,315 x 10 = 23,150 peak API requests/second
```

Write tạo `5,000,000 x 20 MB = 100 TB/day` payload logic. Với retention đã nêu:

```text
100 TB/day x 365 x 3 = 109,500 TB = 109.5 PB logical bytes
```

Nếu tenant-local deduplication loại bỏ 25% content lặp, primary physical bytes là 82.1 PB. Ba bản lưu độc lập, hoặc mức tương đương bằng erasure coding với overhead trung bình 1.5x, cần khoảng 123.1 PB ở primary region. Region thứ hai với chính sách durability tương tự đưa tổng capacity lên khoảng 246 PB.

Metadata nhỏ hơn nhưng vẫn đáng kể: `5 triệu` object version/ngày với row footprint trung bình `1.2 KB` là `6 GB/ngày` trước index, hoặc khoảng `6.6 TB` trong `3 năm` với overhead row và index `1.2x`. Multipart manifest và part record thêm khoảng 10%.

Tỷ lệ byte 5:1 tương đương khoảng `500 TB/day` origin egress trước CDN:

```text
500 TB x 8 / 86,400 = 46.3 Gbit/s average origin egress
46.3 x 10 = 463 Gbit/s peak origin egress
```

CDN hit rate 70% giảm peak origin transfer còn khoảng 139 Gbit/s, nhưng edge vẫn phải phục vụ đủ 463 Gbit/s. **[ANALYSIS]** Vì vậy capacity target phải tính cả băng thông CDN và khả năng bảo vệ origin, không chỉ application request rate. Với availability 99.99% mỗi tháng, error budget khoảng 4.32 phút/tháng. Durability được đo độc lập qua telemetry về repair, checksum và loss budget.

## Hợp đồng API

Mọi endpoint dùng HTTPS và yêu cầu bearer token theo tenant, ngoại trừ share URL. `Idempotency-Key` bắt buộc với mutation. Server bind key với tenant, endpoint, request hash và result trong 24 giờ. Dùng lại key cho request khác trả `409`.

### Tạo upload

```http
POST /v1/tenants/{tenant_id}/uploads
Authorization: Bearer <token>
Idempotency-Key: 01J...
Content-Type: application/json

{
  "key": "videos/demo.mp4",
  "size": 4294967296,
  "content_type": "video/mp4",
  "content_sha256": "optional-final-sha256",
  "metadata": {"project": "demo", "classification": "internal"},
  "dedup_scope": "tenant"
}
```

```json
{
  "upload_id": "upl_7f3",
  "object_id": "obj_91a",
  "version_id": "ver_2b1",
  "part_size": 67108864,
  "expires_at": "2026-08-16T10:00:00Z"
}
```

Control plane reserve một version nhưng chưa làm version đó visible. Client upload từng part trực tiếp tới signed data-plane URL:

```http
PUT /v1/uploads/upl_7f3/parts/42
Content-Length: 67108864
Content-Digest: sha-256=:...:
```

Response gồm checksum server quan sát và `ETag` opaque. Part number duy nhất trong một upload nên retry cùng part là an toàn. Dùng lại part number với checksum khác trả `409`.

### Hoàn tất hoặc hủy

```http
POST /v1/uploads/upl_7f3/complete
Idempotency-Key: 01J...

{"parts":[{"number":1,"sha256":"..."},{"number":2,"sha256":"..."}]}
```

Service xác minh part membership, checksum, kích thước khai báo và digest cuối, rồi atomically chuyển version từ `UPLOADING` sang `COMMITTED`. Completion lặp lại trả kết quả ban đầu. `DELETE /v1/uploads/{upload_id}` hủy upload; sweeper cũng expire các upload bị bỏ quên.

### Đọc, list và share

```http
GET /v1/tenants/{tenant_id}/objects/{key}?version_id=ver_2b1
Range: bytes=0-67108863
```

API hoặc redirect tới signed data URL hỗ trợ range, hoặc stream qua gateway để enforcement policy. Listing dùng cursor và có giới hạn:

```http
GET /v1/tenants/{tenant_id}/objects?prefix=videos/&limit=100&cursor=...
```

API này list các version đã commit và không hứa hẹn một directory không giới hạn.

```http
POST /v1/tenants/{tenant_id}/shares
Idempotency-Key: 01J...

{"version_id":"ver_2b1","ttl_seconds":86400,"max_downloads":3}
```

Response chứa token ngẫu nhiên, không thể enumerate. `GET /s/{token}` kiểm tra revocation, expiry và download count trước khi cấp CDN URL ngắn hạn. Share token không phải object key và được lưu dưới dạng hash.

### Tìm kiếm và lifecycle

```http
POST /v1/tenants/{tenant_id}/search

{"filters":{"content_type":"video/mp4","tags":{"project":"demo"},"size_gte":1000000},"sort":"created_at_desc","limit":50,"cursor":"..."}
```

Search chỉ chạy trên metadata đã được index. Write path ghi version đã commit và publish indexing event. **[ANALYSIS]** Search có thể eventually consistent: read object và list API dùng metadata database làm nguồn authoritative, còn search có thể chậm hơn trong một khoảng ngắn. Trước khi cho download, kết quả vẫn phải được kiểm tra lại theo tenant và trạng thái version hiện tại.

Lifecycle policy áp dụng cho các version đã commit và ghi deletion tombstone hoặc restore marker thay vì sửa blob bytes tại chỗ. Audit event ghi lại ai yêu cầu thao tác, tenant và version bị ảnh hưởng, cùng kết quả.

## Mô hình lưu trữ

**[PROPOSED DESIGN]** Giữ object identity, logical key, version, upload session, part, deduplication reference, share và lifecycle state trong metadata store. Mô hình rút gọn:

- `objects`: tenant, logical key, current version và deletion state.
- `versions`: immutable version identity, size, content type, metadata, digest, state và blob manifest.
- `uploads`: upload identity, version đã reserve, expected size/digest, expiry và state.
- `parts`: upload identity, part number, size, checksum và data-plane location.
- `chunks`: content digest theo tenant, physical location, reference count và verification state.
- `shares`: token hash, version, expiry, download limit và revocation state.

Blob store được address bằng opaque internal identifier, không dùng user key. Manifest ánh xạ một version đã commit tới các part hoặc chunk theo thứ tự. Khi user đổi key, chỉ metadata thay đổi; byte không bị copy.

### Deduplication

**[PROPOSED DESIGN]** Tính content digest ở data boundary và chỉ deduplicate trong tenant. Metadata transaction phải atomically tạo hoặc reference chunk record theo tenant và tăng reference count. Digest match chưa đủ: service vẫn phải kiểm tra size và checksum policy, đồng thời phải authorize trước khi tiết lộ có object trùng hay không.

Reference count hữu ích cho reclamation nhưng không nên là cơ chế an toàn duy nhất. Mark-and-sweep repair job có thể tìm các chunk còn được manifest đã commit tham chiếu và xử lý các decrement bị bỏ sót. Upload chưa commit được garbage-collect sau khi hết hạn.

### Visibility và consistency

Chỉ version ở trạng thái `COMMITTED` được đọc. Completion commit manifest và version state trong cùng một metadata transaction. Read theo explicit version giữ tính ổn định; read theo logical key resolve current version được ghi cho key đó. Delete tạo tombstone và chặn read mới theo policy, còn restore chọn lại một immutable version đã tồn tại.

Data plane có thể acknowledge một part trước khi version được commit. Điều này an toàn vì part chưa thể được normal read truy cập cho tới khi control plane publish manifest hợp lệ.

## Đường truyền và reliability

Upload đi từ client tới data plane, không đi qua metadata service. Data plane validate upload scope trong signed capability, part number, length và checksum, rồi ghi vào durable storage. Completion là một barrier rõ ràng: hệ thống kiểm tra manifest và digest cuối trước khi publish.

Download resolve authorization và version state trước, sau đó dùng signed URL hoặc gateway stream. Range request được ánh xạ tới part hoặc chunk trong manifest. CDN caching chỉ được bật khi cache key chứa immutable version hoặc một authorization boundary an toàn. Revocation không thể đảm bảo xóa response public đã nằm trong cache, nên share nhạy cảm cần URL lifetime ngắn và gateway policy nếu yêu cầu revoke ngay lập tức.

**[ANALYSIS]** Retry phải phân biệt transport failure với kết quả của operation. Idempotency record làm cho create và complete an toàn khi retry. Part number làm cho việc thay part có tính xác định. Timeout không được dẫn tới retry storm không giới hạn; client và service cần retry có giới hạn, backoff, jitter và circuit breaker (cơ chế tạm ngừng gọi dependency đang lỗi). Queue giữa completion, indexing, replication và audit consumer tạo backpressure (làm chậm producer khi consumer không theo kịp).

Checksum cần được verify ở client input, part upload, manifest completion, replication và repair. Repair worker đọc và verify dữ liệu, sau đó ghi lại bản copy đúng hoặc reconstruct fragment của erasure coding. Cần theo dõi checksum error, replication lag, repair backlog, abandoned upload và thay đổi reference count bất thường.

## Security và vận hành

Tenant authorization phải được enforce trong mọi metadata query và mọi signed data-plane capability. Object key chỉ là tên, không phải authorization; key hoặc digest không bao giờ được đủ để đọc byte. Share token phải ngẫu nhiên, được hash khi lưu, scope vào một version và được kiểm tra expiry, revocation, download count.

Metadata và audit record nên được mã hóa khi truyền và khi lưu theo security policy của platform. Log không được chứa raw share token hoặc metadata nhạy cảm. Rate limit nên tách theo metadata request, upload creation, part traffic, share creation và download để một tenant không chiếm hết pool dùng chung.

**[PROPOSED DESIGN]** Vận hành hai plane độc lập. Metadata failure nên dừng commit mới và thay đổi authorization mà không làm hỏng byte đã lưu; data-plane failure nên trả degraded read/write rõ ràng thay vì ghi metadata như thể đã commit. Regional replication, storage placement và repair policy phải được chọn theo durability objective và kiểm thử bằng các đợt restore. Invariant quan trọng là: byte chỉ trở nên visible sau khi metadata plane có manifest đã được verify và lưu bền vững.
