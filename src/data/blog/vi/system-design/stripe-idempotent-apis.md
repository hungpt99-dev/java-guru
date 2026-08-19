---
title: "Thiết kế API Độc lập Thứ tự (Idempotent): Mẫu Idempotency-Key của Stripe"
description: "Phân tích dựa trên nguồn về idempotency key, retry an toàn, replay, cạnh tranh và thiết kế thanh toán đề xuất."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

[SOURCE FACT] Mạng có thể thất bại theo nhiều cách khác nhau: kết nối có thể thất bại trước khi request đến server, cuộc gọi có thể thất bại trong lúc server đang thực hiện thao tác, hoặc thao tác có thể thành công nhưng response bị mất. Stripe mô tả trạng thái client sau đó là không chắc chắn: client có thể không biết retry có an toàn hay không. Nguồn: https://stripe.com/blog/idempotency

[ANALYSIS] Trường hợp nguy hiểm không phải là một response lỗi thông thường, mà là timeout không có câu trả lời có thẩm quyền. Client thanh toán coi mọi timeout là “chưa bị trừ tiền” có thể tạo khoản charge thứ hai; client không bao giờ retry có thể để đơn hàng ở trạng thái không thể giải quyết. Tính sẵn sàng và tính đúng đắn gắn với nhau tại ranh giới request.

[SOURCE FACT] Bài viết của Stripe xem ngay cả một API client và một server là một distributed system vì chúng trao đổi message qua mạng không đáng tin cậy. Nguồn: https://stripe.com/blog/idempotency

[ANALYSIS] Vì vậy, API contract phải định nghĩa retry nghĩa là gì. “Có lẽ server chưa nhận được” không phải là contract. Contract cần một định danh thao tác, một kết quả bền vững và quy tắc replay.

## 2. What the Original System Did

[SOURCE FACT] Bài viết khuyến nghị làm cho endpoint có tính idempotent khi có thể. Một thao tác idempotent có thể được gọi lặp lại mà side effect chỉ xảy ra một lần. Ví dụ là DNS `PUT`: request chứa bản ghi hoàn chỉnh, và bản sao có thể bị bỏ qua nhưng vẫn trả về success. Nguồn: https://stripe.com/blog/idempotency

[SOURCE FACT] Bài viết phân biệt điều này với các thao tác như charge tiền khách hàng, trong đó gọi hai lần không được dẫn đến double-charge. Client tạo một định danh duy nhất cho thao tác đó và gửi cùng payload thông thường. Server liên kết định danh đó với trạng thái request. Nguồn: https://stripe.com/blog/idempotency

[SOURCE FACT] API của Stripe hỗ trợ idempotency key trên các mutating endpoint thuộc `POST`, sử dụng header `Idempotency-Key`. Client có thể retry request thất bại với cùng key và chỉ charge khách hàng một lần. Nếu thao tác thành công nhưng response bị mất, server trả về kết quả thành công đã cache. Nguồn: https://stripe.com/blog/idempotency

[SOURCE FACT] Với lỗi xảy ra giữa chừng khi thực hiện thao tác, bài viết nói rằng hành vi phụ thuộc vào cách triển khai. Nếu thao tác trước đó đã được rollback bằng cơ sở dữ liệu ACID, retry toàn bộ là an toàn; nếu không, trạng thái được khôi phục và cuộc gọi được tiếp tục. Nguồn: https://stripe.com/blog/idempotency

[SOURCE FACT] Stripe khuyến nghị exponential backoff và random jitter. Backoff giảm áp lực lên server đang suy giảm, còn jitter phân tán các retry đồng bộ và giảm thundering herd. Bài viết cũng nói thư viện Stripe Ruby tự động retry khi có lỗi bằng idempotency key, backoff tăng dần và jitter. Nguồn: https://stripe.com/blog/idempotency

[ANALYSIS] Nguồn xác lập hành vi quan trọng ở bên ngoài, không phải một kiến trúc nội bộ hoàn chỉnh. Nguồn không nói rõ database của idempotency store, chính sách lưu giữ, cách lock, topology replication hay HTTP status khi key được dùng đồng thời. Không được trình bày các chi tiết đó như internals của Stripe.

## 3. Architecture Diagram

Sơ đồ tách những gì nguồn xác lập khỏi phần mở rộng theo kiểu phỏng vấn system design.

```mermaid
flowchart LR
    C[Client\n[Source-backed component]]
    R[Retry policy: exponential backoff + jitter\n[Source-backed component]]
    G[API endpoint\n[Source-backed component]]
    K[(Idempotency record store\n[Proposed component])]
    L[Per-key serialization\n[Proposed component]]
    P[Payment side effect\n[Proposed component]]
    O[Persist result for replay\n[Proposed component]]
    X[Response or cached replay\n[Source-backed behavior]]

    C -->|POST + Idempotency-Key| G
    C --> R
    R -->|same key on retry| G
    G --> K
    K --> L
    L --> P
    P --> O
    O --> K
    K --> X
    X --> C
```

[SOURCE FACT] Luồng được nguồn hỗ trợ là client gửi key duy nhất tới API mutating, retry với cùng key sau lỗi và nhận lại kết quả thành công trước đó khi response ban đầu bị mất. Nguồn: https://stripe.com/blog/idempotency

[PROPOSED DESIGN] Record store, serialization theo key, việc lưu kết quả nguyên tử và ranh giới side effect thanh toán là phần mở rộng để biến hành vi thành một triển khai cụ thể. Sơ đồ không khẳng định Stripe dùng đúng các component này.

## 4. System Design Analysis

[ANALYSIS] Key là định danh của một operation, không phải ID của một request attempt. Mọi retry của cùng một charge logic phải mang cùng key. Hai charge khác nhau phải mang key khác nhau ngay cả khi payload giống hệt nhau.

[PROPOSED DESIGN] Giới hạn identity theo account đã xác thực và API operation. Một lookup key có thể là `(account_id, endpoint, idempotency_key)`. Cách này ngăn tenant này replay kết quả của tenant khác và ngăn collision giữa các endpoint không liên quan.

[PROPOSED DESIGN] Gắn key với request fingerprint chuẩn hóa. Ở request đầu tiên, lưu hash của method, path và payload đã normalize. Nếu cùng key đến với payload khác, hãy từ chối vì sử dụng sai key thay vì replay operation đầu tiên. `409 Conflict` là response đề xuất hợp lý vì resource identity xung đột với representation mới; source không nêu đây là hành vi của Stripe.

[ANALYSIS] Replay an toàn cần nhiều hơn việc deduplicate ở HTTP edge. Idempotency record và business effect phải có quan hệ có thể khôi phục. Nếu process ghi “completed” trước khi charge, crash có thể làm bỏ qua charge. Nếu charge trước khi ghi completion, crash có thể gây duplicate trừ khi payment operation cũng được key hoặc cùng transaction boundary bao phủ cả hai.

[PROPOSED DESIGN] Với một relational database duy nhất, tạo idempotency row và payment intent trong cùng transaction, lock row cho key đang chạy và commit response cuối cùng cùng business state. Với external processor, truyền cùng logical key xuống processor nếu hỗ trợ, hoặc dùng outbox và trạng thái reconciliation. Không được nói rằng local database transaction một mình tạo ra exactly once cho external side effect.

[SOURCE FACT] Bài viết nói rõ hành vi khi lỗi giữa chừng phụ thuộc vào implementation và nêu ACID rollback là một cách an toàn. Nguồn: https://stripe.com/blog/idempotency

## 5. Data Model

[PROPOSED DESIGN] SQL sau là relational model mang tính minh họa, không phải schema của Stripe. Nó lưu đủ thông tin để serialize các attempt đồng thời và replay response cuối cùng.

```sql
CREATE TABLE idempotency_records (
    account_id       BIGINT       NOT NULL,
    endpoint         TEXT         NOT NULL,
    idempotency_key  TEXT         NOT NULL,
    request_hash     BYTEA        NOT NULL,
    status           TEXT         NOT NULL CHECK (status IN ('in_progress', 'succeeded', 'failed')),
    response_status  INTEGER,
    response_body    JSONB,
    created_at       TIMESTAMPTZ  NOT NULL,
    completed_at     TIMESTAMPTZ,
    PRIMARY KEY (account_id, endpoint, idempotency_key)
);
```

[PROPOSED DESIGN] Primary key khiến các first attempt đồng thời tranh chấp trên một logical operation. `request_hash` phát hiện việc dùng lại key với tham số đã thay đổi. `response_status` và `response_body` hỗ trợ replay, còn `in_progress` giúp API phân biệt công việc đang chạy với kết quả bền vững.

[ANALYSIS] Retention là quyết định về nghiệp vụ và tính đúng đắn. Xóa record quá sớm sẽ mở lại rủi ro duplicate charge khi retry đến muộn. Giữ record vĩnh viễn làm tăng chi phí lưu trữ và nghĩa vụ về privacy. Nguồn không nêu thời gian retention, nên bài viết này cố ý không đưa ra thời hạn.

## 6. API Design

[SOURCE FACT] Pattern được mô tả trong nguồn sử dụng header `Idempotency-Key` trên request charge `POST`. Nguồn: https://stripe.com/blog/idempotency

[PROPOSED DESIGN] Contract tương đương cho payment endpoint đề xuất là:

```http
POST /v1/payments
Idempotency-Key: order-8f2c-attempt-1
Content-Type: application/json

{"amount":2000,"currency":"usd","customer":"cus_example"}
```

[PROPOSED DESIGN] Quy tắc response:

- Request đầu tiên được chấp nhận: thực thi một lần và lưu status cùng body.
- Retry với cùng key và fingerprint giống nhau: trả response đã lưu, gồm cả status success hoặc failure terminal ban đầu.
- Cùng key nhưng fingerprint khác: trả `409 Conflict` với error code ổn định như `idempotency_key_reused`.
- Cùng key trong khi request khác đang sở hữu công việc: trả `409 Conflict` với `operation_in_progress`, hoặc chờ trong thời gian server giới hạn. Đây là contract đề xuất, không phải source fact.
- Thiếu key cho mutation không idempotent: từ chối, trừ khi endpoint công khai một cơ chế an toàn khác.

[ANALYSIS] Chỉ cache response thành công yếu hơn việc replay mọi terminal outcome. Client retry một validation failure xác định nên nhận cùng câu trả lời; nếu không, nó có thể thấy hành vi không nhất quán. Không nên cache transient failure như kết quả terminal trừ khi API contract quy định đó là terminal.

[SOURCE FACT] Nguồn nói client nên tiếp tục retry sau lỗi cho tới khi có thể xác minh thành công và nên dùng exponential backoff cùng random jitter. Nguồn: https://stripe.com/blog/idempotency

## 7. Scaling Strategy

[PROPOSED DESIGN] Phân vùng idempotency record theo account hoặc theo hash của `(account_id, idempotency_key)`. Giữ uniqueness check và state transition của một key trên một authoritative partition. Replica chỉ nên phục vụ completed replay nếu replication lag không thể khiến record đã commit ở primary bị nhìn như “missing”; nếu không, route lookup của key về primary.

[PROPOSED DESIGN] Dùng lease ngắn hạn hoặc row lock cho `in_progress`, cùng fencing hoặc attempt token để worker bị trễ không thể ghi đè owner mới. Lease không thay thế cho việc kiểm tra business state bền vững. Recovery phải kiểm tra trạng thái payment trước khi thực thi lại.

[ANALYSIS] Backoff và jitter định hình tải ở phía client, nhưng không loại bỏ hot key, client lạm dụng hay sự cố replay store. Rate limit nên theo account và endpoint; observability nên phân biệt first attempt, safe replay, conflict, key hết hạn và unknown outcome.

[SOURCE FACT] Nguồn khuyến nghị exponential backoff để client không liên tục đập vào server đang down, cùng random jitter để các client đồng thời không retry theo cùng nhịp. Nguồn: https://stripe.com/blog/idempotency

## 8. Failure Scenarios

[SOURCE FACT] Nếu kết nối ban đầu thất bại, retry có thể là lần đầu server thấy key và được xử lý bình thường. Nếu lỗi khi đang thực thi, server phải dựa vào rollback an toàn hoặc khôi phục và tiếp tục. Nếu thực thi thành công nhưng response thất bại, server có thể trả cached result. Nguồn: https://stripe.com/blog/idempotency

[PROPOSED DESIGN] Áp dụng các trường hợp đó như sau:

- Mất trước admission: chưa có idempotency row; retry sẽ insert operation.
- Mất sau admission: row là `in_progress`; retry đọc hoặc chờ owner và không được bắt đầu charge thứ hai không có key.
- Crash sau business commit nhưng trước response: completed row được replay.
- Duplicate đồng thời: một request thắng unique-key race; request kia nhận `409` đề xuất hoặc chờ có giới hạn.
- Payload thay đổi: fingerprint mismatch là `409` đề xuất; không âm thầm diễn giải lại key.
- Idempotency store không khả dụng: fail closed với charge thay vì thực thi khi không có deduplication.
- Client retry quá mạnh: exponential backoff và jitter giảm tải recovery nhưng không thể bảo đảm loại bỏ nó.

[ANALYSIS] “Exactly once” mô tả business effect quan sát được dưới các bảo đảm về identity và storage của API; nó không có nghĩa mạng gửi đúng một packet hay code nội bộ chạy một lần. Phân biệt này quan trọng khi reconciliation và xử lý incident.

## 9. Capacity Estimation

[PROPOSED DESIGN] Các số sau là giả định minh họa, không phải số đo của Stripe: 1,000 payment attempt mỗi giây ở peak, 5% retry, một idempotency record trung bình 2 KB gồm response, và retention 24 giờ.

[PROPOSED DESIGN] Peak request rate gồm retry xấp xỉ:

```text
1,000 * (1 + 0.05) = 1,050 requests/second
```

[PROPOSED DESIGN] Số logical attempt mỗi ngày là:

```text
1,000 * 86,400 = 86,400,000 records/day
```

Với 2 KB mỗi record, raw record volume xấp xỉ 173 GB mỗi ngày, chưa gồm index, replication và operational overhead. Đây là các giả định minh họa và phải được thay bằng traffic đo thực tế, kích thước payload, phân bố retry và yêu cầu retention.

[ANALYSIS] Biến số sizing quan trọng không chỉ là write throughput. Replay read, contention, kích thước response bền vững, partition skew và recovery scan có thể chi phối. Capacity test phải bao gồm concurrency cùng key, không chỉ traffic với key duy nhất.

## 10. Trade-offs

[ANALYSIS] Idempotency đánh đổi storage và độ phức tạp của protocol để lấy safety khi trạng thái còn mơ hồ. Client phải giữ key qua các retry, còn server phải giữ đủ state để nhận diện key.

[PROPOSED DESIGN] `409` nghiêm ngặt khi dùng đồng thời cho client tín hiệu rõ ràng nhưng buộc client poll hoặc retry. Chờ có thể dễ dùng hơn nhưng tiêu tốn tài nguyên server và tạo head-of-line blocking. Chờ có giới hạn rồi trả `409` là một thỏa hiệp hợp lý.

[PROPOSED DESIGN] Cache toàn bộ response body giúp replay deterministic nhưng tăng chi phí lưu trữ và có thể giữ dữ liệu nhạy cảm. Chỉ lưu resource ID giảm exposure nhưng đòi hỏi read path đáng tin cậy và có thể không tái tạo được response ban đầu.

[ANALYSIS] Transaction dựa trên database dễ suy luận hơn cho local state so với distributed lock. External payment processor vẫn là một failure boundary riêng, vì vậy cần downstream idempotency hoặc reconciliation. Không thiết kế nào có thể suy ra outcome bên ngoài chỉ từ timeout.

[SOURCE FACT] Nguồn trình bày idempotency, client retry, exponential backoff và jitter là các kỹ thuật bổ sung cho API robust và predictable. Nguồn: https://stripe.com/blog/idempotency

## 11. What We Can Learn From This Architecture

[SOURCE FACT] Bài viết nhấn mạnh phải xử lý failure một cách nhất quán, an toàn và có trách nhiệm: retry remote operation, dùng idempotency và idempotency key, đồng thời không làm server suy giảm quá tải bằng exponential backoff và jitter. Nguồn: https://stripe.com/blog/idempotency

[ANALYSIS] Bài học sâu hơn là phải thiết kế cho khoảng thời gian không chắc chắn giữa side effect và acknowledgement. Một business operation thành công nhưng response không đến nơi không phải nhiễu bất thường; đó là một protocol state thực sự.

[ANALYSIS] Idempotency cũng là kỷ luật ở boundary. Key phải định danh business intent, server phải giữ liên kết giữa intent và result, còn client phải dùng lại identity thay vì tạo attempt ID mới. Nếu bất kỳ layer nào thay đổi identity, retry mất thuộc tính an toàn.

[PROPOSED DESIGN] Với API production, hãy tài liệu hóa key scope, hành vi khi payload mismatch, hành vi khi đang xử lý, retention, các header được replay và tập failure có thể retry chính xác. Đây là các chi tiết vận hành biến một khẩu hiệu thành contract dùng được.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN] Requirements:

- Chấp nhận payment mutation mà không charge hai lần khi client retry.
- Trả cùng terminal result cho request lặp lại với cùng key và payload.
- Phát hiện việc sử dụng đồng thời và payload thay đổi.
- Khôi phục sau lỗi process, network và dependency.
- Nói rõ phần nào là đề xuất thay vì gán cho Stripe.

[PROPOSED DESIGN] Request flow:

1. Authenticate account và validate format của key.
2. Canonicalize request và tính fingerprint.
3. Insert idempotency record với `in_progress`; unique constraint chọn một owner.
4. Nếu record đã tồn tại, so sánh fingerprint. Replay terminal result hoặc trả về/chờ khi `in_progress`.
5. Thực thi payment bằng downstream idempotency identity nếu có hỗ trợ.
6. Commit payment state và response record một cách atomic khi có thể.
7. Trả response đã lưu. Retry sau đó đi qua cùng replay path.

[PROPOSED DESIGN] Invariant về tính đúng đắn: với một `(account, endpoint, key)`, mọi request được chấp nhận có một request fingerprint và nhiều nhất một business effect đã commit. Invariant phụ thuộc vào durable uniqueness và protocol downstream/reconciliation an toàn; chỉ header không tạo ra nó.

[PROPOSED DESIGN] Kiểm thử thiết kế bằng fault-injection matrix: drop request trước admission, kill worker trong side effect, drop response sau commit, race nhiều request giống nhau, dùng lại key với payload thay đổi và làm idempotency store không khả dụng. Thành công nghĩa là API đưa ra kết quả deterministic hoặc trạng thái unknown/in-progress rõ ràng, không bao giờ vô tình charge lần hai.

## Original Sources

- Company: Stripe
- Exact Article Title: Designing robust and predictable APIs with idempotency
- URL: https://stripe.com/blog/idempotency
- What information from the source was used: Các failure mode của network; HTTP operation idempotent; idempotency key theo operation; pattern `Idempotency-Key` của Stripe trên mutating `POST` endpoint; cached replay sau khi response mất; ACID rollback như một trường hợp triển khai; exponential backoff, random jitter và thundering-herd problem.
