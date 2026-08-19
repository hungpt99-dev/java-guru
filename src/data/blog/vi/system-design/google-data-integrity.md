---
title: "Toàn vẹn Dữ liệu và Tính Đúng đắn Giao dịch: Nguyên tắc của Google SRE"
description: "Phân tích thiết kế hệ thống dựa trên nguồn về giao dịch, khôi phục, loại bỏ tải và điều tiết phía máy khách."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

[SOURCE FACT] Google SRE định nghĩa toàn vẹn dữ liệu theo góc nhìn người dùng: độ chính xác và khả năng truy cập của các datastore cần thiết để cung cấp dịch vụ phù hợp. Chương này nhấn mạnh rằng người dùng thường không thể phân biệt mất dữ liệu, dữ liệu hỏng và tình trạng không khả dụng kéo dài. Một hệ thống cuối cùng vẫn giữ được dữ liệu nhưng không thể cung cấp dữ liệu trong khoảng thời gian chấp nhận được vẫn đã thất bại đối với người dùng. Nguồn: https://sre.google/sre-book/data-integrity/

[SOURCE FACT] Bài toán toàn vẹn dữ liệu nghiêm ngặt hơn những gì một tỷ lệ uptime thể hiện. Một phần nhỏ byte bị hỏng có thể khiến tài liệu, executable hoặc database không sử dụng được, trong khi một phần thời gian ngừng hoạt động tương đương có thể chấp nhận được. Vì vậy, nguồn xem toàn vẹn và khả năng sẵn sàng là các yêu cầu riêng biệt hướng tới người dùng. Nguồn: https://sre.google/sre-book/data-integrity/

[ANALYSIS] Với một dịch vụ giao dịch, “đúng” không chỉ có nghĩa là ghi thành công. Một order đã commit phải có trạng thái thanh toán, reservation tồn kho và audit trail hợp lệ; retry không được tạo order thứ hai; và một lần đọc không được lộ ra trạng thái mới chỉ áp dụng một phần. Thách thức thiết kế là duy trì các bất biến này trong khi lưu lượng, dependency, deployment và hoạt động khôi phục đều thay đổi.

[SOURCE FACT] Chương về overload bắt đầu từ một thực tế vận hành: cuối cùng một phần nào đó của mọi serving system cũng sẽ quá tải, nên xử lý overload một cách uyển chuyển là nền tảng của hệ thống đáng tin cậy. Nguồn đề xuất response suy giảm, chuyển hướng, tín hiệu capacity dựa trên tài nguyên, quota, criticality và việc reject đủ nhanh để không tiêu thụ phần capacity còn lại của backend. Nguồn: https://sre.google/sre-book/handling-overload/

[ANALYSIS] Các vấn đề này liên kết với nhau. Retry storm có thể biến một giao dịch bị reject thành nhiều attempt, làm cạn connection của database và tạo side effect trùng lặp nếu ranh giới giao dịch không có tính idempotent. Ngược lại, hệ thống quá tải nhưng vẫn nhận mọi write có thể giữ availability bằng cái giá là mất integrity.

## 2. What the Original System Did

[SOURCE FACT] Tài liệu Google là tập hợp các nguyên tắc và thực hành SRE, không phải kiến trúc hoàn chỉnh của một sản phẩm order hay payment. Tài liệu mô tả defense in depth cho dữ liệu bền vững: soft deletion, backup và phương thức recovery, validation sớm, và replication khi phù hợp. Tài liệu cảnh báo rõ rằng replication không đồng nghĩa với recoverability vì một update hoặc delete sai có thể lan tới mọi replica. Nguồn: https://sre.google/sre-book/data-integrity/

[SOURCE FACT] Backup chỉ có giá trị khi có thể restore. Yêu cầu recovery phải quyết định phương thức backup, tần suất tạo restore point, vị trí lưu và retention. Nguồn phân biệt backup có thể restore nhanh với archive, đồng thời bàn về bản sao theo tầng, phương pháp incremental hoặc streaming, và point-in-time recovery như một mục tiêu khó khi chạy trên các datastore ACID và BASE hỗn hợp. Nguồn: https://sre.google/sre-book/data-integrity/

[SOURCE FACT] Nguồn cũng khuyến nghị phát hiện chủ động và repair nhanh. Validator ngoài luồng nên kiểm tra những invariant gây hậu quả nghiêm trọng cho người dùng, thay vì cố validation mọi thuộc tính có thể có. Nguồn: https://sre.google/sre-book/data-integrity/

[SOURCE FACT] Đối với overload, Google mô tả quota tài nguyên theo từng customer, criticality của request, tín hiệu utilization cục bộ, retry có giới hạn và adaptive throttling phía client. Trong cách adaptive, client theo dõi số request đã thử và số request backend chấp nhận trong lịch sử gần đây; khi tỷ lệ reject quá cao, request được reject cục bộ trước khi đi qua network. Nguồn: https://sre.google/sre-book/handling-overload/

[ANALYSIS] Bài học có thể chuyển giao không phải là sao chép một datastore, RPC stack hay quota service nội bộ cụ thể của Google. Đó là việc biến correctness và overload thành các control loop rõ ràng: định nghĩa invariant, đo tài nguyên, reject công việc tại điểm an toàn và rẻ nhất, rồi chứng minh khả năng recovery bằng diễn tập.

## 3. Architecture Diagram

[PROPOSED DESIGN] Sơ đồ sau là phần mở rộng theo kiểu phỏng vấn system design, không phải tuyên bố về kiến trúc chính xác của Google. Nó kết hợp write path giao dịch với các cơ chế reliability được nguồn hỗ trợ.

```mermaid
flowchart LR
    C[Client]
    CT[Client throttler\n[Source-backed component]]
    G[API gateway\n[Proposed component]]
    Q[Quota and criticality\n[Source-backed component]]
    O[Overload gate / load shedding\n[Source-backed component]]
    T[Transaction coordinator\n[Proposed component]]
    DB[(ACID primary database\n[Proposed component])]
    E[(Outbox events\n[Proposed component])]
    W[Workers / downstream effects\n[Proposed component]]
    B[(Tiered backups\n[Source-backed component]]
    V[Integrity validators\n[Source-backed component]]
    R[Restore orchestrator\n[Proposed component]]

    C --> CT --> G --> Q --> O --> T
    T --> DB
    T --> E --> W
    DB --> B
    DB --> V
    B --> R --> DB
    V -. repair signal .-> R
```

[ANALYSIS] ACID database là source of truth của trạng thái giao dịch nguyên tử. Outbox đưa việc phát hành downstream vào cùng commit mà không giả định external payment provider tham gia database transaction. Throttler và overload gate giảm áp lực trước phần xử lý tốn kém; validator và restore orchestration xử lý corruption mà replication thông thường không ngăn được.

## 4. System Design Analysis

[SOURCE FACT] Google mô tả việc phối hợp API ACID và BASE là một pattern cloud phổ biến. ACID cung cấp semantics giao dịch mạnh hơn; BASE có thể cung cấp availability cao hơn với hội tụ eventual sau khi các update dừng lại. Nguồn nêu bật các vấn đề referential integrity khi metadata, blob và cache phía client nằm ở các hệ thống riêng. Nguồn: https://sre.google/sre-book/data-integrity/

[ANALYSIS] Dùng ACID ở nơi invariant nghiệp vụ phải thay đổi nguyên tử: tạo order, reservation tồn kho và bản ghi idempotency của order. Dùng ranh giới bất đồng bộ cho effect có thể retry hoặc reconcile: email, lập chỉ mục tìm kiếm, analytics và notification. Không gọi external side effect bên trong database transaction rồi giả định rollback có thể hoàn tác nó.

[PROPOSED DESIGN] Mỗi write mang một idempotency key có scope theo customer đã xác thực và operation. Database lưu key cùng resource identifier kết quả và request fingerprint. Cùng key với cùng fingerprint sẽ trả về kết quả ban đầu; fingerprint khác sẽ bị reject. Như vậy, retry ở transport trở thành việc đọc lại một quyết định đã tồn tại.

[PROPOSED DESIGN] Transaction ghi order, line item, inventory reservation và một outbox row trong cùng ACID transaction. Worker claim outbox row bằng lease, phát hành command idempotent và ghi nhận completion. Consumer cũng deduplicate theo event ID. Cơ chế này cung cấp at-least-once delivery với effect idempotent, thay vì tuyên bố exactly-once không có cơ sở.

[SOURCE FACT] Nguồn về data integrity nói dữ liệu xấu lan qua reference và dependent transaction, khiến recovery về sau khó hơn. Nguồn khuyến nghị kiểm tra quan hệ giữa các datastore và phát hiện corruption mức thấp sớm. Nguồn: https://sre.google/sre-book/data-integrity/

[ANALYSIS] Validator nên so sánh các invariant như “reserved quantity không âm”, “mỗi order line tham chiếu tới product snapshot tồn tại” và “outbox status khớp với aggregate đã commit”. Chỉ quarantine hoặc repair thông qua quy trình có audit. Validator âm thầm rewrite business data có thể trở thành nguồn corruption thứ hai.

[SOURCE FACT] Nguồn về overload nói capacity nên được mô hình hóa bằng tài nguyên đã tiêu thụ, thay vì dùng mù quáng queries per second, vì các request có thể có cost rất khác nhau. CPU thường là một tín hiệu hữu ích; các tài nguyên khác cần được đưa vào khi chúng là giới hạn độc lập. Nguồn: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] Gateway gán cost class cho từng operation, nhưng database gate cuối cùng vẫn bảo vệ các tín hiệu thực tế: mức sử dụng connection pool, CPU, memory pressure, lock wait time và transaction latency. Khi có áp lực, hệ thống shed optional read trước, sau đó low-criticality write, đồng thời giữ capacity giới hạn cho operation quan trọng. Write bị reject phải rõ ràng và chỉ retryable khi semantics idempotency khiến việc đó an toàn.

## 5. Data Model

[PROPOSED DESIGN] Một relational model tối thiểu là:

```sql
CREATE TABLE orders (
  order_id UUID PRIMARY KEY,
  customer_id UUID NOT NULL,
  status TEXT NOT NULL,
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  version BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE idempotency_keys (
  customer_id UUID NOT NULL,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash BYTEA NOT NULL,
  response_code INTEGER NOT NULL,
  resource_id UUID,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (customer_id, operation, key)
);

CREATE TABLE inventory_reservations (
  reservation_id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(order_id),
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL
);

CREATE TABLE outbox (
  event_id UUID PRIMARY KEY,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL
);
```

[ANALYSIS] Unique constraint trên idempotency key là tuyến phòng thủ đầu tiên trước các request trùng đồng thời. Foreign key bảo vệ referential integrity cục bộ, nhưng không validation cache, external provider hoặc blob lưu riêng. Các quan hệ đó cần validator và reconciliation.

[SOURCE FACT] Nguồn Google phân biệt backup với archive: backup có thể được nạp trở lại application, còn archive chủ yếu phục vụ audit, discovery hoặc compliance dài hạn. Nguồn: https://sre.google/sre-book/data-integrity/

[PROPOSED DESIGN] Backup primary database và outbox ở dạng nhất quán theo transaction, giữ restore point bất biến, đồng thời archive riêng audit record khi policy yêu cầu. Restore manifest phải xác định database version, schema version, event position và kết quả validation. Đây là đề xuất thiết kế, không phải mô tả implementation của Google.

## 6. API Design

[PROPOSED DESIGN] Write API biến hành vi retry thành một phần contract:

```http
POST /v1/orders
Idempotency-Key: 7f7d...
X-Criticality: CRITICAL
Content-Type: application/json

{"items":[{"sku":"A-17","quantity":2}]}
```

```http
201 Created
Location: /v1/orders/8b2...

{"order_id":"8b2...","status":"RESERVED"}
```

[PROPOSED DESIGN] Response phân biệt `409` cho business conflict, `429` cho quota hoặc client throttling, và `503` kèm overload classification retryable cho việc bảo vệ capacity tạm thời. Body nên có error code ổn định và request ID, không phải chỉ dẫn retry mọi failure.

[SOURCE FACT] Nguồn về overload mô tả retry budget, gồm giới hạn ba attempt cho mỗi request và mục tiêu retry ratio 10% cho mỗi client trong thiết kế được thảo luận. Nguồn cũng cảnh báo retry nên diễn ra ở layer ngay phía trên dependency reject request để tránh combinatorial retry explosion. Nguồn: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] Dùng retry metadata có giới hạn như `attempt`, `retry_after` và `overload_scope`. Chỉ retry operation idempotent hoặc operation có idempotency key hợp lệ. Client phải dừng khi hết budget hoặc response nói `overloaded; don't retry`. Các tên HTTP cụ thể này là convention được đề xuất.

## 7. Scaling Strategy

[SOURCE FACT] Chương overload của Google mô tả quota theo customer, criticality level và cơ chế bảo vệ utilization cục bộ. Traffic có criticality cao được bảo vệ lâu hơn; traffic sheddable hoặc batch có thể chịu partial unavailability. Nguồn: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] Phân vùng capacity theo customer và criticality, với quyết định admission dựa trên resource cost thay vì request count. Giữ pool dành riêng cho operation `CRITICAL_PLUS`, pool thường cho interactive write và pool có thể shed cho repair scan cùng batch export. Kích thước pool là policy vận hành, không phải source fact.

[SOURCE FACT] Nguồn nói về adaptive throttling dựa trên request gần đây của client và số request backend accept, đồng thời cho biết multiplier thường được ưu tiên là 2x trong cách tiếp cận được mô tả. Nguồn cũng lưu ý client gửi request thưa có góc nhìn yếu hơn về trạng thái backend. Nguồn: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] Triển khai cùng dạng control cho SDK client: đếm request đã thử và request được accept trong rolling window, reject cục bộ với xác suất tăng dần khi backend reject tăng, và xuất metric local rejection. Dùng thời điểm retry do server cung cấp để tránh retry đồng bộ. Với client ít lưu lượng, dùng token bucket tường minh và server quota vì lịch sử cục bộ quá ít.

[SOURCE FACT] Đối với data integrity, Google mô tả backup theo tầng: restore point cục bộ, thường xuyên và nhanh; bản sao ít thường xuyên hơn trên storage khác; và bản sao nearline hoặc offline giữ lâu hơn cho failure cấp site. Nguồn nhấn mạnh rằng tốc độ recovery, độ mới và retention cạnh tranh với nhau. Nguồn: https://sre.google/sre-book/data-integrity/

[ANALYSIS] Scale recovery path độc lập với serving path. Chia validation và restore theo customer hoặc time partition độc lập, giới hạn số restore job đồng thời và test partial restore. Backup pipeline làm database live quá tải là rủi ro availability dù artifact cuối cùng đúng.

## 8. Failure Scenarios

[PROPOSED DESIGN] **Client retry trùng.** Request đầu tiên commit nhưng response bị mất. Retry tìm thấy idempotency record và trả về order ban đầu. Nếu transaction đầu tiên rollback, retry có thể tạo order an toàn.

[PROPOSED DESIGN] **Xung đột tồn kho.** Hai transaction tranh chấp unit cuối cùng. Row lock hoặc atomic conditional update cho phép một reservation; transaction còn lại nhận business conflict, không phải server error mơ hồ.

[PROPOSED DESIGN] **Worker outbox crash.** Worker phát hành event rồi crash trước khi đánh dấu complete. Lease hết hạn, event được phát hành lại, và deduplication theo event ID của consumer ngăn external effect trùng lặp.

[SOURCE FACT] Replication một mình không bảo vệ trước delete sai hoặc update hỏng vì lỗi có thể được replicate trước khi phát hiện. Nguồn: https://sre.google/sre-book/data-integrity/

[PROPOSED DESIGN] **Corruption phát hiện muộn.** Validator phát hiện invariant violation vài ngày sau khi lỗi bắt đầu. Operator đóng băng mutation bị ảnh hưởng, xác định restore point cuối cùng còn đúng, restore partition bị ảnh hưởng vào workspace cô lập, reconcile các thay đổi hợp lệ mới hơn và ghi nhận repair. Không overwrite production từ một backup chưa validation.

[SOURCE FACT] Nguồn overload nói một nhóm nhỏ task quá tải có thể phù hợp với immediate retry, trong khi overload diện rộng nên trả error thay vì tạo thêm traffic. Nguồn cũng cảnh báo retry ở nhiều dependency layer gây explosion. Nguồn: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] **Database saturation.** Service reject low-criticality request cục bộ tại gateway, client back off, và chỉ caller gần nhất retry số lần giới hạn. Critical write chỉ tiếp tục khi transaction và connection budget còn an toàn.

[SOURCE FACT] Nguồn data integrity khuyến nghị thực hành khả năng đạt data-availability SLO, tập trung vào restore thay vì chỉ tạo backup. Nguồn: https://sre.google/sre-book/data-integrity/

[PROPOSED DESIGN] **Site recovery.** Promote một recovery environment đã test từ immutable backup, chỉ replay change record đã validation, chạy integrity check và chuyển traffic sau khi đạt restore SLO đã công bố. Restore drill là test chất lượng release, không phải script chỉ dùng trong emergency.

## 9. Capacity Estimation

[PROPOSED DESIGN] Các con số sau là illustrative assumptions, không phải fact từ Google hay nguồn được cung cấp. Giả sử có 2.000 order attempt mỗi giây, tỷ lệ duplicate/retry 20% trong peak và 6 database operation cho mỗi order được accept. Nếu admission thành công cho 1.600 order mới mỗi giây, database nhận khoảng 9.600 logical operation mỗi giây trước background work:

`1,600 orders/s * 6 operations/order = 9,600 operations/s`

[PROPOSED DESIGN] Giả sử một transaction tiêu thụ trung bình 12 ms database CPU time. CPU demand logic là:

`1,600 orders/s * 0.012 s = 19.2 CPU-seconds/s`

Đây là illustrative assumption; sizing thực tế phải dùng CPU, lock wait, I/O, connection occupancy và tail latency đã đo. Nếu duplicate attempt thực thi toàn bộ business logic, tỷ lệ retry 20% tạo thêm áp lực mà không thêm business value, vì vậy idempotency lookup và client throttling phải nằm trước phần xử lý tốn kém.

[SOURCE FACT] Bài overload được cung cấp có ví dụ 100 backend task, mỗi task 500 request mỗi giây, tạo giới hạn 50.000 query mỗi giây cho datacenter theo model của ví dụ đó. Bài cũng đưa ví dụ quota CPU theo customer, gồm 4.000 CPU-second mỗi giây cho Gmail và 3.000 cho Android trong ví dụ phân bổ 10.000 CPU toàn cầu. Đây là các ví dụ trong nguồn, không phải khuyến nghị sizing cho service được đề xuất. Nguồn: https://sre.google/sre-book/handling-overload/

[ANALYSIS] Đơn vị ước lượng quan trọng là resource demand trên mỗi request, không chỉ QPS. Hãy ước lượng riêng tải bình thường, retry amplification, chi phí validation, backup I/O và restore throughput. Thiết kế đạt QPS steady-state nhưng không có headroom cho rejected work hoặc recovery work thì chưa hoàn chỉnh về vận hành.

## 10. Trade-offs

[ANALYSIS] ACID boundary mạnh làm giảm ambiguity nhưng có thể giới hạn write latency, geographic scale và availability khi coordination failure xảy ra. Đẩy nhiều công việc hơn sang BASE cải thiện decoupling và throughput nhưng cần reconciliation, trạng thái pending hiển thị cho user và kỷ luật idempotency chặt hơn.

[SOURCE FACT] Nguồn giải thích full backup thường xuyên tạo gánh nặng cho datastore live, còn backup tier sâu hơn hoặc bền hơn thì chậm và kém fresh hơn. Nguồn cũng nói replication và redundancy không phải recoverability. Nguồn: https://sre.google/sre-book/data-integrity/

[ANALYSIS] Local snapshot cải thiện restore time nhưng chia sẻ nhiều failure surface hơn với production. Bản sao offline hoặc isolated cải thiện bảo vệ trước disaster nhưng tăng restore latency và chi phí vận hành. Retention phải phản ánh thời gian phát hiện creeping corruption, không chỉ thời gian nhận ra một outage hoàn toàn.

[SOURCE FACT] Nguồn overload nói throttling mạnh tiết kiệm tài nguyên backend nhưng làm chậm propagation của quota state sau khi hệ thống hồi phục; multiplier 2x được thảo luận đánh đổi một phần capacity bị reject lãng phí để state được nhìn thấy nhanh hơn. Nguồn: https://sre.google/sre-book/handling-overload/

[ANALYSIS] Client-side throttling không thay thế server admission control. Client độc hại hoặc lỗi thời có thể bỏ qua nó, còn client ít lưu lượng không có đủ bằng chứng cục bộ. Server quota, bảo vệ từng task và overload error rõ ràng vẫn bắt buộc.

## 11. What We Can Learn From This Architecture

[SOURCE FACT] Hai chương Google SRE cùng quy về defense in depth. Data integrity dùng nhiều lớp bảo vệ độc lập và phát hiện sớm; overload handling kết hợp load balancing, quota, criticality, giới hạn utilization cục bộ và hành vi client. Không chương nào xem một cơ chế là bảo đảm đầy đủ. Nguồn: https://sre.google/sre-book/data-integrity/ và https://sre.google/sre-book/handling-overload/

[ANALYSIS] Biến correctness thành thứ có thể thực thi. Encode invariant về uniqueness, foreign key, version và state transition nơi database có thể enforce; validation cross-system invariant ngoài luồng; và làm mọi repair có thể quan sát.

[ANALYSIS] Biến overload thành hành vi có chủ đích. Gán criticality trước khi request fan-out, đo resource đã tiêu thụ, shed công việc ít giá trị trước và bảo đảm retry không thể nhân lên qua nhiều layer.

[ANALYSIS] Định nghĩa recovery như một SLO hướng tới người dùng. Backup chưa từng restore là dependency chưa được chứng minh. Recovery test phải bao gồm corruption phát hiện muộn, chọn một phần dữ liệu, tương thích schema và reconciliation của external side effect.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN] **Requirements.** Chấp nhận một order đúng một lần theo góc nhìn người dùng, reservation tồn kho nguyên tử, phát hành downstream work đáng tin cậy, chịu được retry và overload từng phần của dependency, đồng thời recovery corruption mà không mù quáng restore mọi record hiện tại. Availability và recovery target là illustrative assumptions, cần product owner thống nhất.

[PROPOSED DESIGN] **Write path.** Client gửi idempotency key và criticality. Gateway thực hiện authentication, quota và local throttling. Transaction service kiểm tra key, lock hoặc conditional update inventory, ghi order cùng outbox event rồi commit. Service chỉ trả response sau durable commit.

[PROPOSED DESIGN] **Asynchronous path.** Worker lease outbox event và gọi hệ thống downstream bằng event ID. Mỗi external effect phải idempotent hoặc được reconcile bằng compensating workflow. Poison event được quarantine thay vì retry vô hạn.

[PROPOSED DESIGN] **Overload path.** Resource-aware gate reject công việc có thể shed trước. Client nhận typed overload error và chỉ retry ở immediate caller, trong request budget và client budget. Adaptive local throttling ngăn rejected request tiêu thụ network và backend capacity.

[PROPOSED DESIGN] **Integrity path.** Validator scan invariant cục bộ và cross-store. Soft deletion bảo vệ việc xóa nhầm khi privacy policy cho phép. Immutable backup theo tầng hỗ trợ restore point; restore thực hiện trong môi trường cô lập, được validation và reconcile trước cutover.

[PROPOSED DESIGN] **Observability and tests.** Theo dõi commit latency, tỷ lệ idempotency hit, reservation conflict, outbox age, consumer deduplication, resource utilization theo criticality, local throttle rate, overload rejection rate, retry amplification, validator finding, backup freshness và restore duration. Test từng failure scenario bằng traffic có kiểm soát và corruption tổng hợp.

[ANALYSIS] Thiết kế này cố ý không tuyên bố global serializability, exactly-once messaging hoặc zero data loss. Nó đưa ra các guarantee hẹp hơn nhưng có thể enforce và đo được: local invariant nguyên tử, retry idempotent, event at-least-once kèm deduplication, overload có giới hạn và recovery được diễn tập.

## Original Sources

- Company: Google
  Exact Article Title: Data Integrity: Principles and Best Practices
  URL: https://sre.google/sre-book/data-integrity/
  What information from the source was used: Định nghĩa toàn vẹn và availability theo góc nhìn người dùng; trade-off ACID và BASE; soft deletion; backup so với archive; chiến lược backup và restore theo tầng; giới hạn của replication; validation chủ động; và thực hành recovery.

- Company: Google
  Exact Article Title: Handling Overload
  URL: https://sre.google/sre-book/handling-overload/
  What information from the source was used: Đo capacity theo tài nguyên; response suy giảm; quota theo customer; criticality của request; adaptive throttling phía client; bảo vệ theo utilization; retry budget; và containment retry giữa các dependency layer.
