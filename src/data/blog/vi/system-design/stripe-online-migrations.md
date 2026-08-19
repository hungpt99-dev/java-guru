---
title: "Di chuyển Cơ sở dữ liệu không Downtime ở Quy mô Lớn: Mẫu Online Migration của Stripe"
description: "Phân tích dựa trên nguồn về dual-write, backfill, shadow read, cutover và tính đúng đắn khi lưu lượng production liên tục."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

**[SOURCE FACT]** Stripe mô tả một cuộc di chuyển liên quan đến hàng trăm triệu đối tượng Subscription, trong khi API phải duy trì tính sẵn sàng và nhất quán. Mô hình cũ lưu subscription cùng Customer; mô hình mới lưu các subscription đang hoạt động trong một bảng riêng. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Mô hình cũ trở nên tốn kém khi phát triển: thay đổi subscription buộc phải cập nhật toàn bộ bản ghi Customer, còn các truy vấn subscription phải quét các đối tượng Customer. Nguồn: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Bài toán khó không phải là sao chép các dòng dữ liệu. Đó là duy trì invariant rằng mọi lần đọc và mutation đều thấy một trạng thái subscription nhất quán trong lúc hai biểu diễn cũ và mới cùng tồn tại. Maintenance window có thể tránh giai đoạn chồng lấn này, nhưng ràng buộc vận hành ở đây không cho phép lựa chọn đó.

**[ANALYSIS]** Có ba rủi ro chính: công việc migration cạnh tranh tài nguyên với production; một write path bị bỏ sót tạo ra divergence; và read cutover có thể để lộ các dòng còn thiếu hoặc stale. Vì vậy kế hoạch an toàn cần có giai đoạn truyền dữ liệu, quan sát, đổi authority có kiểm soát và dọn dẹp.

## 2. What the Original System Did

**[SOURCE FACT]** Stripe trình bày một pattern dual-writing gồm bốn bước: ghi vào bảng cũ và mới; chuyển toàn bộ read path sang bảng mới; chuyển toàn bộ write path chỉ ghi vào bảng mới; sau đó xóa dữ liệu cũ và code phụ thuộc mô hình lỗi thời. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Trong ví dụ Subscription, write mới ban đầu được ghi vào cả bảng Customers và Subscriptions. Các object hiện có được sao chép lazy khi được cập nhật, sau đó backfill các subscription còn lại. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Để tìm các object thiếu mà không liên tục query live database, Stripe dùng database snapshot trong Hadoop và MapReduce, được quản lý bằng Scalding. Một job xuất ra các ID cần copy; một fleet đa luồng sao chép chúng; job được chạy lần nữa để kiểm tra thiếu sót. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Stripe dùng Scientist để chạy cả hai read path và so sánh kết quả trong production. Mismatch tạo alert và metric, còn lỗi trong experimental path không ảnh hưởng main application path. Sau khi kết quả khớp, reads được chuyển sang bảng mới. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Với writes, Stripe đảo thứ tự: ghi new store trước, rồi archive dữ liệu ở old store. Họ refactor các subscription operation theo từng bước và dùng thêm các phép so sánh. Sau đó họ dừng ghi biểu diễn cũ, xóa field cũ và xử lý deletion theo cách lazy. Nguồn: https://stripe.com/blog/online-migrations

## 3. Architecture Diagram

```mermaid
flowchart LR
    C[Client]
    A[Application/API]
    F[Feature flag / phase controller\n[Proposed component]]
    O[(Old Customers store)]
    N[(New Subscriptions store)]
    B[Snapshot + MapReduce backfill\n[Source-backed component]]
    S[Shadow read comparator\n[Source-backed component]]
    V[Verifier and metrics\n[Proposed component]]
    R[Retirement and lazy cleanup\n[Source-backed component]]

    C --> A
    A --> F
    F -->|dual write| O
    F -->|dual write| N
    B --> N
    A -->|primary read| N
    A -.->|shadow read| O
    A -.-> S
    S --> V
    A -->|new-primary write| N
    N --> R
    O --> R
```

**[SOURCE FACT]** Các component được source hỗ trợ là old/new store, distributed backfill dựa trên snapshot, so sánh read trong production và retirement lazy. Nguồn: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** Feature flag, phase controller và verifier là các control-plane addition rõ ràng trong sơ đồ này. Chúng giúp rollout, pause và quyết định rollback có thể quan sát được; sơ đồ không khẳng định Stripe dùng chính xác các component này.

## 4. System Design Analysis

**[ANALYSIS]** Dual-write là invariant chuyển tiếp, không phải transaction boundary. Nếu hai database độc lập được cập nhật trong các transaction riêng, crash có thể khiến một write bị thiếu. Design phải làm cho retry idempotent, ghi nhận migration version và liên tục phát hiện divergence. Transaction cục bộ bao phủ cả hai biểu diễn chỉ khả thi khi chúng cùng transaction boundary; nếu không, cần cơ chế retry bền vững hoặc reconciliation.

**[SOURCE FACT]** Stripe giảm tác động hiệu năng của write bổ sung bằng cách tăng dần tỷ lệ object được duplicate, đồng thời theo dõi cẩn thận các operational metric. Nguồn: https://stripe.com/blog/online-migrations

**[ANALYSIS]** “Shadow read” hữu ích vì kiểm tra semantic equivalence, không chỉ số lượng dòng. Comparator nên normalize ordering, giá trị absent-versus-empty và các field được mô hình mới thay đổi có chủ ý. So sánh object thô có thể tạo false alarm; normalize quá mức có thể che giấu bug correctness.

**[ANALYSIS]** Cutover nên được xem là một proof obligation. Trước khi biến bảng mới thành authority, cần chứng minh coverage của object hiện có, so sánh các read đại diện và chứng minh mọi mutation path đã được chuyển. Sau cutover, giữ biểu diễn cũ như archive hoặc safety net cho đến khi có đủ bằng chứng để xóa.

**[PROPOSED DESIGN]** Dùng migration state theo object như `dual`, `new_primary` và `retired`, đồng thời gate transition bằng một thay đổi atomic ở control plane. Route reads và writes theo state đó, nhưng bảo đảm retry nhìn thấy cùng state và operation idempotency key. Đây là phần mở rộng cho một hệ thống generic, không phải khẳng định về implementation của Stripe.

## 5. Data Model

**[SOURCE FACT]** Thay đổi khái niệm ban đầu là từ field `subscription` đơn trên Customer, sau đó là array `subscriptions`, sang việc lưu active subscription trong bảng riêng. Nguồn: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** Một target relational generic có thể làm ownership và idempotency rõ ràng:

```sql
CREATE TABLE customers (
  customer_id    BIGINT PRIMARY KEY,
  legacy_payload JSONB,
  migration_state TEXT NOT NULL,
  version        BIGINT NOT NULL
);

CREATE TABLE subscriptions (
  subscription_id BIGINT PRIMARY KEY,
  customer_id     BIGINT NOT NULL,
  status          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  source_version  BIGINT NOT NULL,
  updated_at      TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX subscriptions_customer_id_id
  ON subscriptions(customer_id, subscription_id);
```

**[PROPOSED DESIGN]** `source_version` ngăn backfill hoặc retry cũ ghi đè mutation mới hơn. Trong schema thực tế, comparator cũng phải định nghĩa cách biểu diễn delete, null, ordering và concurrent update. Các column và constraint này là lựa chọn design mang tính minh họa, không phải source fact.

## 6. API Design

**[PROPOSED DESIGN]** Giữ public API ổn định trong khi storage authority thay đổi. Các operation nội bộ có thể thể hiện migration semantics:

```text
GET  /customers/{customer_id}/subscriptions
POST /customers/{customer_id}/subscriptions
PUT  /subscriptions/{subscription_id}
```

**[PROPOSED DESIGN]** Mỗi mutation nhận một idempotency key và được xử lý như sau:

1. Đọc migration state và version hiện tại.
2. Apply biểu diễn mới với conditional version check.
3. Apply hoặc enqueue legacy projection với cùng operation identity.
4. Chỉ trả về sau khi durability policy đã cấu hình thành công.

**[ANALYSIS]** “Write new, rồi archive old” làm giảm phụ thuộc vào mô hình cũ, nhưng tự nó không bảo đảm atomicity. Nếu bước 3 thất bại, new store vẫn là authority và repair queue phải hội tụ archive. API không được âm thầm báo success khi new-primary write bị mất.

**[PROPOSED DESIGN]** Các endpoint nội bộ cho `backfill`, `compare`, `pause` và `resume` nên được bảo vệ quyền, rate-limit và audit. Đây là operational interface, không phải customer-facing API.

## 7. Scaling Strategy

**[SOURCE FACT]** Stripe dùng offline snapshot và distributed MapReduce để xác định work, sau đó dùng nhiều process chạy song song để duplicate subscription. Cách này tránh buộc live database thực hiện global discovery tốn kém. Nguồn: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Tách discovery khỏi mutation. Discovery tạo worklist ổn định; worker thực hiện copy idempotent có giới hạn; pass discovery thứ hai kiểm tra invariant completeness. Điều này hạn chế full-table scan trên serving path và tạo điều kiện dừng có thể đo được.

**[PROPOSED DESIGN]** Partition work theo object ID hoặc shard ổn định, dùng lease có expiry và giới hạn concurrency trên từng database shard. Tạo backpressure khi write latency, lock wait, replication lag hoặc error rate vượt ngưỡng. Ưu tiên batch nhỏ và checkpoint tiến độ để worker restart có thể lặp lại an toàn.

**[SOURCE FACT]** Stripe cũng dùng lazy copy khi object được update, qua đó chuyển dần các record hot trước final backfill. Nguồn: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Lazy copy hiệu quả với record active nhưng không thể chứng minh completeness cho record cold. Vì thế nó bổ trợ cho, chứ không thay thế, full reconciliation pass.

## 8. Failure Scenarios

**[PROPOSED DESIGN]** Nếu old write thành công nhưng new write thất bại, retry new write bằng operation key rồi so sánh version. Không cho backfill stale về sau ghi đè row đã được sửa.

**[PROPOSED DESIGN]** Nếu new write thành công nhưng old archive thất bại, tiếp tục serve từ new store, enqueue reconciliation và alert theo archive lag. Rollback không nên đồng nghĩa với việc mù quáng chuyển reads về một old representation chưa đầy đủ.

**[ANALYSIS]** Nếu shadow reads bất đồng, giữ nguyên primary path, ghi lại object ID và normalized diff, phân loại mismatch và dừng promotion. Experimental read phải fail-open đối với customer traffic, phù hợp mô tả của source về Scientist experiment.

**[PROPOSED DESIGN]** Nếu backfill làm production quá tải, giảm concurrency của worker hoặc pause. Nếu worklist chưa đầy đủ, chạy lại discovery từ snapshot mới và so sánh với các ID đã quan sát ở target. Nếu delete chạy đua với backfill, dùng tombstone hoặc version check để object đã xóa không bị resurrect.

**[ANALYSIS]** Failure nguy hiểm nhất là writer không được biết đến. Chỉ một mutation path bị bỏ quên cũng có thể liên tục tạo divergence. Instrument việc truy cập legacy field và fail rõ ràng ở non-production; ở production, chọn policy block hoặc route minh bạch thay vì âm thầm chấp nhận.

## 9. Capacity Estimation

**[SOURCE FACT]** Stripe nói họ có hàng trăm triệu Subscription object và rằng nếu migrate một trăm triệu object với tốc độ một object mỗi giây theo tuần tự thì sẽ mất hơn ba năm. Nguồn: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** Giả định minh họa: migration có 100.000.000 object, 500 worker và mỗi worker hoàn thành 20 object/giây. Throughput copy lý tưởng là 10.000 object/giây, nên phase copy mất khoảng 10.000 giây, tức 2,8 giờ. Thời gian thực tế dài hơn vì retry, throttling, validation và contention. Đây là giả định minh họa, không phải phép đo của Stripe.

**[PROPOSED DESIGN]** Giả định minh họa: nếu dual-write thêm một target write cho mỗi API mutation, target write volume xấp xỉ mutation volume trong giai đoạn chuyển tiếp. Hãy size target database, connection pool, index và replication path cho mức tăng tạm thời đó, rồi kiểm chứng bằng load test. Không có request rate được source hỗ trợ, nên bài này không khẳng định con số đó.

**[ANALYSIS]** Metric capacity hữu ích không chỉ là object/giây. Hãy theo dõi backlog, tuổi của object chưa xử lý lâu nhất, mismatch rate, target write latency và production resource headroom. Backfill nhanh hơn nhưng làm tăng customer-facing latency là một migration thất bại.

## 10. Trade-offs

**[ANALYSIS]** Dual-write cộng reconciliation bảo toàn availability nhưng làm tăng write amplification, độ phức tạp code và operational surface area. Nó phù hợp khi maintenance window không thể chấp nhận và tổ chức có thể vận hành tooling so sánh, sửa lỗi.

**[ANALYSIS]** Offline discovery giảm áp lực lên serving database, nhưng snapshot có thể trễ so với live state. Design phải xử lý khoảng thời gian từ lúc tạo snapshot đến khi worker chạy qua live dual-write, lazy copy hoặc final verification pass.

**[ANALYSIS]** Shadow read tạo thêm read load và có thể sinh difference nhiễu, nhưng phơi bày semantic incompatibility trước cutover. Sampling giảm chi phí nhưng giảm coverage; full comparison tăng confidence với chi phí tài nguyên cao hơn.

**[SOURCE FACT]** Stripe nhấn mạnh các thay đổi incremental, nói rằng họ không thay đổi quá vài trăm dòng code mỗi lần, và mô tả việc observability minh bạch thông qua alert của Scientist. Nguồn: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Giữ mô hình cũ tạm thời giúp rollback dễ hơn, nhưng trì hoãn việc loại bỏ duplicate write và legacy assumption. Chỉ xóa sau bằng chứng, không xóa vì áp lực lịch trình.

## 11. What We Can Learn From This Architecture

**[SOURCE FACT]** Các bài học được source nêu là chiến lược bốn phase, xử lý song song offline, thay đổi incremental và so sánh có observability trong khi production vẫn online. Nguồn: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Correctness là một thuộc tính theo giai đoạn. Trước hết chứng minh row coverage, sau đó semantic read equivalence, rồi tính đầy đủ của write path và cuối cùng là retirement an toàn. Hãy coi mỗi giai đoạn là observable độc lập thay vì tuyên bố thành công ngay khi copy job kết thúc.

**[ANALYSIS]** Migration cũng là migration của codebase. Data có thể đúng trong khi một accessor cũ vẫn ghi old shape. Access guard có thể search được, ownership của mutation logic và phase gate rõ ràng quan trọng không kém database tooling.

**[ANALYSIS]** Pattern thực tế này áp dụng ngoài subscription: đưa target vào, giữ các biểu diễn hội tụ, so sánh behavior, chuyển authority và chỉ xóa compatibility code khi dependency cuối cùng biến mất.

## 12. Proposed Interview-Style System Design

**[PROPOSED DESIGN]** Requirements: migrate một tập entity relational lớn khi hệ thống online; giữ API availability; giữ read semantics; chịu được lỗi worker và database; hỗ trợ pause, resume, verification và cleanup cuối cùng. Các con số dưới đây là giả định minh họa.

**[PROPOSED DESIGN]** Components:

- API service với migration phase flag.
- Old và new store với record có version.
- Dual-write adapter với idempotency key.
- Backfill planner đọc offline snapshot và worker fleet ghi batch có giới hạn.
- Shadow comparator với normalized diff và alerting.
- Reconciliation queue cho projection thất bại.
- Control plane cho promotion, pause, rollback policy và retirement.

**[PROPOSED DESIGN]** Rollout:

1. Tạo schema mới và deploy read/write code phía sau phase đang tắt.
2. Bật dual-write cho cohort nhỏ; đo latency, error và divergence.
3. Bật lazy copy khi update và chạy snapshot-based backfill.
4. Chạy shadow read và chặn promotion khi có mismatch chưa giải thích.
5. Chuyển reads sang new store, tiếp tục giữ comparison và old data.
6. Chuyển mutation path sang new-primary, rồi repair old projection bất đồng bộ.
7. Chứng minh không còn legacy access, dừng old write và xóa old data theo cách lazy.

**[PROPOSED DESIGN]** Correctness invariants:

- Mọi object trong migration scope đều có mặt ở target hoặc có tombstone tường minh.
- Với một version nhất định, normalized old và new read tương đương.
- Retry không thể apply version cũ lên version mới hơn.
- Mọi mutation thành công đều bền vững trong new source of truth.
- Retirement bị chặn khi còn legacy access hoặc mismatch chưa được xử lý.

**[ANALYSIS]** Câu trả lời phỏng vấn nên dành nhiều thời gian cho invariant và failure handling hơn là cho sơ đồ. “Dual-write” chỉ là cơ chế khởi đầu; verification, idempotency, backfill có giới hạn và authority transition có thể đảo ngược mới quyết định design an toàn.

## Original Sources

- Company: Stripe. Exact Article Title: “Online migrations at scale”. URL: https://stripe.com/blog/online-migrations. What information from the source was used: thay đổi data model Subscription, các ràng buộc availability và consistency, pattern migration bốn phase, dual-write tăng dần, lazy copy, backfill bằng snapshot/Hadoop/MapReduce, so sánh shadow read với Scientist, refactor write path incremental và lazy removal của dữ liệu cũ.
