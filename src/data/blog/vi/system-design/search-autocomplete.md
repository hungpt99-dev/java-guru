---
title: "Thiết kế Dịch vụ Gợi ý Tìm kiếm"
description: "Thiết kế thực tế cho gợi ý tìm kiếm độ trễ thấp, có cá nhân hóa và chịu lỗi chính tả ở QPS cao."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Bài toán và phạm vi

[SOURCE FACT] Ô tìm kiếm cần trả gợi ý ngay khi người dùng còn đang nhập. Với tiền tố như `phot`, dịch vụ trả về danh sách ngắn, có thứ tự, chẳng hạn “photo printer”, “photo editor” và “photography”. Web, mobile và client hỗ trợ giọng nói đều dùng cùng dịch vụ này.

Luồng request phải phục vụ khách truy cập ẩn danh, khách hàng đã đăng nhập và các job ingestion nội bộ. Dịch vụ cần hỗ trợ:

- Match theo tiền tố từ catalog toàn cục.
- Cá nhân hóa dựa trên tìm kiếm gần đây và tùy chọn của người dùng.
- Gợi ý thịnh hành phản ứng với nhu cầu gần đây nhưng không để một event nhiễu chi phối.
- Chịu được các lỗi chính tả phổ biến có edit distance bằng một.
- Xếp hạng theo category cho sản phẩm, người, địa điểm và bài trợ giúp.
- Trả partial result khi personalization, dữ liệu trending hoặc một replica của index không khả dụng.

[SOURCE FACT] SLO hướng tới người dùng là p99 dưới 50 ms tại biên dịch vụ, không tính mạng client. Core prefix path có mục tiêu availability 99.99% theo tháng. Kết quả cũ nhưng an toàn tốt hơn lỗi. Gợi ý không được làm lộ query riêng tư, blocked term hoặc dữ liệu của tenant khác. Click hoặc search event có thể mất trong thời gian ngắn, nhưng request ingestion đã được chấp nhận phải idempotent và cuối cùng được lập index.

[ANALYSIS] Prefix lookup tự nó không phải phần khó nhất. Vấn đề là kết hợp nhiều nguồn dữ liệu mà không để dependency tùy chọn kéo dài latency của critical path. Vì vậy serving index được tối ưu riêng cho đọc, event ingestion được tách riêng, còn personalization và trending là các input có giới hạn và có thể suy giảm có kiểm soát.

## 2. Giả định về capacity

[ASSUMPTIONS] Đây là các input để lập kế hoạch, không phải số đo từ một hệ thống production cụ thể. Trước khi cam kết capacity, cần thay chúng bằng telemetry production.

- 50 triệu daily active user (DAU). Đây là một sản phẩm tiêu dùng lớn, không phải global web index.
- Mỗi user tạo 20 autocomplete request mỗi ngày. Con số này tính các phím đi qua client debounce, không tính mọi lần nhấn phím.
- `50,000,000 x 20 = 1,000,000,000 requests/day`.
- Tốc độ trung bình: `1,000,000,000 / 86,400 = 11,574 RPS`.
- Traffic tăng mạnh quanh các đợt ra mắt và buổi tối. Peak 10x tương đương khoảng `116,000 RPS`; thêm headroom 30% cho công suất đọc `151,000 RPS`.
- Response trung bình có 10 gợi ý, mỗi gợi ý 80 byte, cộng JSON overhead, tức khoảng 2 KB. Egress ở peak là `116,000 x 2 KB = 232 MB/s`, khoảng 1.86 Gbit/s trước protocol overhead.
- Giả định mỗi ngày có 10 triệu query hoặc event write được chấp nhận. Tỷ lệ read:write là `100:1`.
- Một event được chấp nhận có kích thước khoảng 500 byte. Raw storage trong 30 ngày là `10,000,000 x 500 x 30 = 150 GB`. Với ba durable replica, index và overhead 40%, cần dự phòng khoảng 630 GB. Giữ event log trong 30 ngày, sau đó compact hoặc xóa.
- Serving vocabulary có 200 triệu phrase duy nhất. Một entry trie/FST nén, category metadata, counter và ranking feature trung bình 120 byte, tương đương 24 GB raw. Năm replica theo region cộng temporary build space cần khoảng 150 GB.
- Availability 99.99% cho phép khoảng 4 phút 23 giây không khả dụng trong một tháng 30 ngày. Mục tiêu p99 50 ms áp dụng cho core response thành công; khi dependency suy giảm, hệ thống phải trả partial response có giới hạn thay vì chờ timeout.
- Phrase tăng 5% mỗi tháng. Event tăng theo DAU và mức sử dụng, nên event pipeline cần chịu được ít nhất 2x peak hiện tại trước khi lên lịch mở rộng.

[ANALYSIS] Các giả định này dẫn tới một serving index tối ưu cho đọc và nằm trong memory, một event pipeline có thể scale độc lập, cùng fan-out có giới hạn. Hot path không nên query relational database một lần cho mỗi keystroke.

## 3. API contract

[PROPOSED DESIGN] Public endpoint:

```http
GET /v1/suggestions?q=phot&limit=8&category=all&locale=en-US
Authorization: Bearer <token>       # optional for personalization
X-Request-Id: 7f2c...
```

```json
{
  "query": "phot",
  "suggestions": [
    {"text": "photo printer", "category": "product", "score": 0.94},
    {"text": "photo editor", "category": "app", "score": 0.89}
  ],
  "complete": true,
  "sources": ["global", "trending"],
  "index_version": "2026-08-15T09:59:40Z",
  "request_id": "7f2c..."
}
```

Giới hạn `limit` ở 10. Trước khi lookup, chuẩn hóa query bằng Unicode normalization, case folding và giới hạn độ dài. Trả `200` với `complete: false` khi một source tùy chọn timeout. Trả `400` cho locale hoặc dạng query không hợp lệ, chỉ trả `401` khi một tính năng được yêu cầu rõ ràng cần identity đã xác thực, và trả `429` khi caller vượt quota. Nếu core index không khả dụng, trả cached result khi có; nếu không, trả `503` kèm `Retry-After`.

Ingestion dùng endpoint riêng:

```http
POST /v1/query-events
Idempotency-Key: 6b5d6b9e-...
Authorization: Bearer <token>
Content-Type: application/json

{"query":"photo printer","selected_suggestion":"photo printer","locale":"en-US","occurred_at":"2026-08-15T03:00:02Z"}
```

Trả `202 Accepted` sau khi durable queue nhận event. Phạm vi của idempotency key là tenant và endpoint; giữ key trong 48 giờ. Client không được retry `4xx`, ngoại trừ `429`; có thể retry khi mất response bằng cùng key. Server cấp producer timestamp. Không dùng các field của event làm nguồn xác thực authorization hoặc tenant identity.

## 4. Dữ liệu nguồn và serving representation

[SOURCE FACT] Metadata relational là source of truth vì ownership của phrase, moderation và versioned publication cần constraint và transaction.

```sql
CREATE TABLE phrases (
  tenant_id       BIGINT NOT NULL,
  phrase_id       BIGINT NOT NULL,
  normalized_text  TEXT NOT NULL,
  locale           TEXT NOT NULL,
  category         TEXT NOT NULL,
  status           TEXT NOT NULL,
  base_score       DOUBLE PRECISION NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, phrase_id),
  UNIQUE (tenant_id, locale, normalized_text)
);

CREATE INDEX phrases_lookup
  ON phrases (tenant_id, locale, status, normalized_text);

CREATE TABLE query_events (
  tenant_id       BIGINT NOT NULL,
  event_id        UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  user_id         BIGINT,
  normalized_text TEXT NOT NULL,
  category        TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX events_time ON query_events (tenant_id, occurred_at);
```

Unique constraint của phrase ngăn catalog entry trùng trong cùng tenant và locale. `phrases_lookup` phục vụ tool moderation và rebuild, không phục vụ hot suggestion path. `(tenant_id, event_id)` cung cấp durable deduplication; time index phục vụ windowed aggregation. Partition các bảng event lớn theo ngày để retention 30 ngày có thể thực hiện bằng cách drop partition thay vì xóa một tỷ row.

[PROPOSED DESIGN] Phục vụ từ snapshot FST/trie immutable được memory-map. Mỗi terminal lưu phrase ID, category, base score và các tham chiếu compact tới ranking feature. Giữ một danh sách riêng theo user, key bằng `(tenant_id, user_id, locale)`, với TTL ngắn.

Partition event stream theo `hash(tenant_id, normalized_text)`. Normalized phrase là ordering key cho window aggregation xác định. Tenant-specific salt có thể ngăn pattern placement dễ đoán giữa các tenant; salt không được làm suy yếu tenant isolation hoặc authorization.

## 5. Read path

[PROPOSED DESIGN] Request handler thực hiện một chuỗi có giới hạn:

1. Authenticate khi request yêu cầu personalization hoặc feature phụ thuộc identity, sau đó validate tenant, locale và dạng query.
2. Chuẩn hóa query và kiểm tra response cache nhỏ; cache key phải gồm tenant, locale, category và prefix đã chuẩn hóa.
3. Đọc local global index để lấy prefix match. Một side index chịu typo có thể cung cấp candidate cho các biến thể edit-distance-one phổ biến.
4. Fetch per-user list và trending candidate song song, mỗi nguồn có timeout ngắn và result set bị giới hạn.
5. Loại candidate bị block, private, trùng hoặc thuộc tenant khác trước khi rank.
6. Merge candidate bằng category, base score, trend, recency và personalization feature, sau đó trả tối đa số lượng được yêu cầu.

Response ghi rõ source nào đã đóng góp. Nếu fetch tùy chọn thất bại, trả global result với `complete: false`; client không phải suy đoán completeness từ một list rỗng. Nếu core index thất bại, dùng cache fallback có giới hạn. Circuit breaker (cơ chế ngắt mạch) ngăn gọi lặp tới dependency không lành mạnh; backpressure (kiểm soát áp lực ngược) giới hạn công việc khi traffic vượt khả năng xử lý.

## 6. Ingestion và index build

[PROPOSED DESIGN] Ingestion endpoint validate tenant đã xác thực và payload, xử lý idempotency rồi append event vào durable queue. Consumer cập nhật aggregate và ghi relational event store bất đồng bộ. `202` hoàn tất nghĩa là queue đã nhận request, không có nghĩa phrase đã xuất hiện trong serving index.

Consumer phải chịu được duplicate và delivery không đúng thứ tự. Vì vậy aggregate update cần idempotent key và chính sách event-time rõ ràng. Mất một click có thể làm ranking chậm cập nhật; retry của client không được tạo ra event accepted thứ hai.

Build snapshot FST/trie mới từ relational metadata đã được duyệt và các feature đã tính. Validate snapshot trước khi publish, sau đó publish version một cách atomic. Serving process có thể giữ snapshot cũ trong lúc load snapshot mới. `index_version` trong response giúp đối chiếu hành vi với snapshot cụ thể.

## 7. Ranking, privacy và moderation

[ANALYSIS] Ranking cần minh bạch về nguồn của feature. Global popularity và editorial score là tín hiệu cấp catalog. Trending lấy từ aggregate gần đây và cần smoothing hoặc cap để một event nhiễu không chi phối. Personalization có phạm vi tenant và user, nên là thành phần tùy chọn trên latency-critical path.

[PROPOSED DESIGN] Áp dụng privacy và moderation filter trước khi trả candidate, không chỉ trong offline indexing. Không đưa raw private query vào global index dùng chung. Blocked term phải bị loại khỏi cả serving snapshot và fallback cache. Cache key và dữ liệu theo user phải có tenant scope; cache hit vẫn không thay thế bước authorization.

## 8. Failure handling và vận hành

[PROPOSED DESIGN] Đặt timeout độc lập cho cache, global index, personalization và trending dependency. Aggregate timeout phải chừa thời gian serialize và gửi response trong mục tiêu p99 50 ms. Chỉ retry operation có thể retry an toàn, đồng thời giới hạn retry budget để tránh retry storm.

Theo dõi latency theo source và theo result completeness, cùng cache hit rate, index version, queue lag, consumer failure, event bị reject, deduplication conflict và số candidate bị moderation filter. Alerting cần phân biệt core index unavailable với optional source degraded.

Dùng rate limit và quota theo tenant. Bảo vệ event endpoint bằng authentication, payload validation, giới hạn durable queue và backpressure. Redact query text khỏi log thông thường, trừ khi cần theo privacy policy đã được phê duyệt.

## 9. Trade-off

- FST/trie trong memory cho prefix lookup có latency dễ dự đoán, nhưng cần snapshot build, kế hoạch memory và atomic publication.
- Relational source of truth giúp enforce moderation và versioned publication, nhưng không phù hợp cho đọc mỗi keystroke ở peak giả định.
- Tách global, trending và personalized source cho phép scale độc lập và trả partial response, nhưng ranking và debug phức tạp hơn.
- Eventual indexing chấp nhận visibility lag ngắn và khả năng mất event giá trị thấp để giữ interactive path nhanh.
- Typo tolerance cải thiện recall nhưng có thể tăng candidate work và tạo match ngoài dự kiến; nên giới hạn trong các trường hợp edit-distance-one được hỗ trợ.

## 10. Tóm tắt

[ANALYSIS] Thiết kế giữ interactive path nhỏ: chuẩn hóa prefix, đọc immutable index cục bộ, merge các source tùy chọn có giới hạn, filter an toàn rồi trả partial result khi source tùy chọn lỗi. Ingestion, aggregation và index publication chạy bất đồng bộ, scale độc lập. Các ranh giới vận hành được xác định rõ: durable queue xác định ingestion đã được nhận, immutable snapshot xác định dữ liệu đang được phục vụ, còn tenant-aware filter được áp dụng trước khi result đến client.
