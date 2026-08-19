---
title: "Thiết kế hệ thống thanh toán với sổ cái kép"
description: "Thiết kế nhất quán mạnh cho charge, refund, payout, dispute và việc ghi nhận dòng tiền có thể kiểm toán."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Bài toán và phạm vi

Ta cần một nền tảng thanh toán cho merchant và khách hàng. Nền tảng nhận payment intent từ thẻ và ngân hàng, ghi nhận nghĩa vụ của nền tảng với từng bên, refund charge đã capture, payout cho merchant và theo dõi dispute. Merchant portal cùng đội vận hành nội bộ cần lịch sử bền vững, có thể giải thích mọi khoản tiền mà không phụ thuộc vào các trường số dư có thể bị thay đổi.

Bài viết này bao quát command API, idempotency, sổ cái kép, tích hợp provider, reconciliation và các quyết định chính về consistency cũng như xử lý lỗi. Mô hình capacity có số liệu bên dưới là **giả định minh họa**, không phải tuyên bố về một hệ thống thực tế.

### Yêu cầu

Yêu cầu chức năng gồm:

- Tạo và capture charge, bao gồm authorization reference từ provider.
- Refund toàn bộ hoặc một phần charge đã capture.
- Tạo và thực thi payout từ số dư phải trả cho merchant.
- Mọi client command đều idempotent, kể cả khi client retry sau khi mất response.
- Ghi nhận mọi chuyển động tiền bằng các journal line double-entry cân bằng.
- Reconcile bản ghi nội bộ với báo cáo provider và sao kê ngân hàng.
- Đóng băng hoặc đảo tiền khi có card dispute, kèm một case có audit.

Yêu cầu phi chức năng nghiêm ngặt hơn CRUD thông thường:

- Từ góc nhìn sổ cái, một command được chấp nhận chỉ có đúng một business effect. Hệ thống không được post hai lần.
- Commit của sổ cái dùng strong consistency.
- Lịch sử journal chỉ append và có thể phát hiện sửa đổi.
- Thông tin thanh toán được provider hosted token hóa để giảm PCI scope.
- **[SOURCE FACT]** Mục tiêu là availability 99.99% mỗi tháng cho ledger command, p99 command latency dưới 400 ms khi provider phản hồi, và không có journal transaction mất cân bằng.

“Exactly once” mô tả invariant của sổ cái, không mô tả việc giao request trên mạng. Request và lời gọi provider có thể được giao at-least-once. Unique command key, immutable transaction, provider idempotency key và reconciliation phối hợp để ngăn financial effect trùng lặp và xử lý các kết quả ban đầu chưa rõ.

## 2. Mô hình capacity

Các số liệu sau là **[ASSUMPTION: giả định minh họa]**:

- Tổng cộng 200.000 customer và merchant active mỗi ngày.
- Mỗi active user trung bình tạo hoặc checkout bằng 2 payment-related command mỗi ngày.
- Peak được mô hình hóa bằng 10 lần traffic mua sắm trung bình.
- Provision capacity 100 command request/giây để dành chỗ cho retry và một đợt khuyến mãi.
- Một charge trung bình tạo 1 payment row, 1 ledger transaction và 4 journal line. Một refund hoặc payout tạo khoảng 4 line.
- Mô hình dùng 500.000 ledger transaction mỗi ngày.

Phép tính:

- `200,000 x 2 = 400,000 commands/day`.
- `400,000 / 86,400 = 4.63 average requests/second`.
- Peak gấp 10 lần là 46.3 request/giây; 100 request/giây là planning capacity.
- `500,000 x 4 = 2,000,000 journal-line writes/day`, trung bình 23 line/giây và 230 line/giây ở peak mô hình.

Mô hình dành thêm 25% command so với customer action cho merchant automation. Read được mô hình hóa ở tỷ lệ 8:1 so với write vì dashboard, receipt và truy vấn reconciliation đọc lại lịch sử nhiều lần. Ở planning peak, đó là khoảng 800 read request/giây nếu mọi read đều đi qua service.

Storage cũng là giả định minh họa. Một payment row hoặc journal-line row, gồm index và metadata, trung bình 700 byte:

- `2,000,000 x 700 bytes x 7 years = 3.58 TB` dữ liệu journal-line chính, chưa tính replica, WAL và headroom.
- `400,000 x 500 bytes x 7 years = 0.51 TB` cho 1 payment row trên mỗi command.
- Áp dụng hệ số 2x cho replica, WAL và headroom cho khoảng 8.2 TB database storage.
- Provider event và audit record thêm khoảng 1 TB trong 7 năm.

Ở 100 command/giây với request 3 KB, peak ingress là 2.4 Mb/s. Ở 800 read/giây với response 10 KB, peak egress là 64 Mb/s. Các số này chưa gồm provider webhook và export; theo giả định sizing, cần tối thiểu 1 Gb/s cho mỗi production zone.


## 3. Thiết kế API

Mọi endpoint dùng TLS và OAuth2 authorization cho user hoặc service. `Idempotency-Key` bắt buộc với command và được scope theo merchant cùng endpoint. Server lưu request hash, status, response body và resource ID trong 30 ngày. Dùng lại key với request body khác sẽ trả `409`.

Các ví dụ dùng identifier và amount mang tính minh họa.

### Tạo và capture charge

```http
POST /v1/charges
Authorization: Bearer <token>
Idempotency-Key: ch_merchant_20260815_001
Content-Type: application/json

{"amount":12500,"currency":"USD","merchant_id":"m_42","payment_method_token":"pm_tok_9","capture":true}
```

```json
{"id":"ch_901","status":"succeeded","amount":12500,"currency":"USD","ledger_transaction_id":"ltx_7001","provider_payment_id":"pp_88"}
```

Amount là integer theo minor unit của currency. Service kiểm tra merchant ownership, currency và tokenization, rồi chỉ ghi local effect sau khi đã correlate an toàn kết quả từ provider. Nếu timeout khiến outcome của provider chưa rõ, service trả `202` với `status: "pending"`; client poll `GET /v1/charges/{id}`.

### Refund

```http
POST /v1/charges/ch_901/refunds
Idempotency-Key: rf_merchant_20260815_001
Content-Type: application/json

{"amount":3000,"reason":"customer_request"}
```

```json
{"id":"rf_301","status":"succeeded","amount":3000,"charge_id":"ch_901","ledger_transaction_id":"ltx_7010"}
```

Service xác minh charge đã capture, tổng refund không vượt quá amount đã capture và command key chưa tạo refund trước đó.

### Payout

```http
POST /v1/merchants/m_42/payouts
Idempotency-Key: po_merchant_20260815_001
Content-Type: application/json

{"amount":8000,"currency":"USD","destination_token":"bank_tok_2"}
```

```json
{"id":"po_501","status":"processing","amount":8000,"currency":"USD","ledger_transaction_id":"ltx_7020"}
```

Payout authorization kiểm tra available balance và giới hạn risk hoặc velocity trong cùng database transaction. Provider execution có thể giữ trạng thái `processing`; webhook hoặc settlement file chuyển trạng thái thành `paid` hoặc `failed`.

Các endpoint khác gồm `GET /v1/ledger/accounts/{id}/entries?cursor=...`, `POST /v1/provider-events` để nhận signed webhook, `POST /v1/reconciliation/runs` và `POST /v1/disputes/{id}/accept` hoặc `/contest`. Webhook ingestion xác thực chữ ký provider và deduplicate theo provider event ID.

## 4. Data model

Schema kiểu PostgreSQL dưới đây thể hiện các invariant quan trọng. Amount là integer theo minor unit; không dùng floating point cho tiền.

```sql
CREATE TABLE idempotency_keys (
  merchant_id bigint NOT NULL,
  endpoint text NOT NULL,
  idem_key text NOT NULL,
  request_hash bytea NOT NULL,
  status text NOT NULL,
  response_json jsonb,
  resource_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, endpoint, idem_key)
);

CREATE TABLE ledger_accounts (
  account_id bigint PRIMARY KEY,
  owner_type text NOT NULL,
  owner_id bigint NOT NULL,
  currency char(3) NOT NULL,
  account_type text NOT NULL,
  UNIQUE (owner_type, owner_id, currency, account_type)
);

CREATE TABLE ledger_transactions (
  transaction_id bigint PRIMARY KEY,
  command_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_lines (
  line_id bigint PRIMARY KEY,
  transaction_id bigint NOT NULL REFERENCES ledger_transactions,
  account_id bigint NOT NULL REFERENCES ledger_accounts,
  amount_minor bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**[PROPOSED DESIGN]** Database transaction insert business record, idempotency record, ledger transaction và các line cùng nhau. Deferred constraint hoặc check tại thời điểm transaction phải đảm bảo debit bằng credit trong từng transaction. Unique `command_id` ngăn việc tạo ledger transaction thứ hai cho cùng accepted command. Available-balance check dùng row lock trên account liên quan hoặc serializable transaction; đây là lựa chọn triển khai, không phải tuyên bố về một database deployment cụ thể.

**[PROPOSED DESIGN]** Balance có thể được duy trì dưới dạng projection để đọc nhanh, nhưng không phải source of truth. Rebuild balance từ journal line phải cho cùng kết quả. Business path không update hoặc delete journal row. Audit record có thể lưu actor, request hash, provider reference và lý do của operational action.

## 5. Ledger posting

**[PROPOSED DESIGN]** Mỗi business event ánh xạ thành các posting cân bằng. Tên account dưới đây không mô tả hệ thống của một công ty cụ thể.

- Captured charge debit provider-clearing hoặc cash account và credit merchant payable account, thêm fee line nếu có.
- Refund debit merchant payable account và credit provider-clearing hoặc cash account.
- Payout debit merchant payable account và credit payout-in-transit account. Khi settlement hoàn tất, chuyển amount từ transit sang cash hoặc ghi nhận failure reversal.
- Dispute debit merchant payable hoặc dispute-reserve account và credit dispute hoặc provider-receivable account. Khi case có kết quả thuận lợi, post một compensating transaction.

Account cụ thể và cách xử lý fee phụ thuộc vào hợp đồng kinh doanh và settlement model của provider. Invariant cốt lõi đơn giản hơn: mỗi transaction đã commit có ít nhất một debit và một credit, tất cả cùng currency, và tổng signed amount bằng 0.

## 6. Provider call và xử lý lỗi

**[PROPOSED DESIGN]** Không giữ database transaction mở trong lúc chờ provider. Command trước hết tạo local pending record, sau đó async worker thực hiện provider call. Worker gửi cùng provider idempotency key khi retry và lưu request cũng như response reference của provider.

Nếu provider trả thành công, worker post ledger transaction và đánh dấu resource là succeeded trong một local database transaction. Nếu call timeout, outcome là unknown: retry với cùng provider key, query provider nếu provider hỗ trợ, rồi chờ webhook hoặc reconciliation file. Không được mặc định timeout nghĩa là failure.

Timeout cần retry có giới hạn, kèm backoff và jitter. Circuit breaker có thể ngừng các provider call mới khi lỗi kéo dài; queue tạo backpressure (giới hạn tốc độ nhận việc để hệ thống không quá tải). Các cơ chế này bảo vệ service, nhưng không quyết định financial outcome. Dead-letter queue phù hợp cho message cần điều tra thủ công, nhưng replay vẫn phải idempotent.

API nên trả `pending` thay vì tự tạo success hoặc failure khi outcome của provider chưa rõ. Client có thể poll hoặc consume resource event. Provider webhook endpoint phải xác thực signature, persist raw event trước khi xử lý, deduplicate event ID và chịu được việc event đến không đúng thứ tự.

## 7. Reconciliation và dispute

**[PROPOSED DESIGN]** Reconciliation so sánh charge, refund, payout, fee và provider event nội bộ với provider report và bank statement. Kết quả nên phân biệt rõ matched, missing-internal, missing-provider, amount-mismatch và status-mismatch. Mismatch trở thành operational case; không được âm thầm sửa bằng cách thay đổi balance.

Reconciliation job phải chạy lại an toàn. Job lưu source file hoặc event identifier, comparison version, timestamp và ledger transaction dùng cho correction nếu có. Correction là compensating ledger transaction, không phải chỉnh sửa historical line.

Dispute là một case có status, evidence, deadline, provider reference và các ledger transaction liên kết. **[PROPOSED DESIGN]** Reserve hoặc reverse amount đang tranh chấp, thông báo cho operations và post compensating transaction khi case được giải quyết. Case state và ledger posting phải liên kết để operator không thể đánh dấu resolved mà không có financial effect có audit.

## 8. Ranh giới consistency và vận hành

**[ANALYSIS]** Local database là consistency boundary cho business record, idempotency key và ledger posting. Provider là external system có state riêng. Hai hệ thống không thể trở thành một atomic transaction nếu không dùng distributed transaction, vì vậy thiết kế dùng state machine, provider operation idempotent, webhook và reconciliation.

Metrics nên tách local acceptance latency khỏi provider completion latency. Các tín hiệu hữu ích gồm pending age, retry count, provider error rate, webhook lag, reconciliation mismatch, ledger-balance violation và payout failure. Alert nên gắn với SLO đã nêu và financial invariant, không chỉ với HTTP error rate.

Thiết kế này không hứa mọi network call đều thành công ngay. Nó làm cho uncertainty hiển thị rõ, ngăn posting trùng, giữ ledger có thể kiểm toán và cung cấp quy trình có kiểm soát để operations xử lý bất đồng với provider.
