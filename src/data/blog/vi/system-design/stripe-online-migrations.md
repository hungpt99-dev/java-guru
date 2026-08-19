---
title: "Online database migration không downtime"
description: "Phân tích dựa trên nguồn về dual-write, backfill, shadow read, cutover và tính đúng đắn khi lưu lượng production liên tục."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

Thay đổi một data model lớn trong khi production vẫn nhận traffic không chủ yếu là bài toán sao chép dữ liệu. Phần khó là giữ cho các lần đọc và ghi nhất quán trong lúc biểu diễn cũ và mới cùng tồn tại.

Bài viết này xem xét pattern online migration được Stripe mô tả, sau đó tách riêng nội dung từ nguồn, phần phân tích kỹ thuật và phần proposed design cho một hệ thống generic. Nội dung bao gồm dual-write, backfill, shadow read, cutover, retry và retirement.

## 1. Bài toán migration

**[SOURCE FACT]** Stripe mô tả một migration liên quan đến hàng trăm triệu Subscription object trong khi API vẫn phải duy trì tính sẵn sàng và nhất quán. Model cũ lưu subscription cùng Customer; model được thiết kế lại lưu các active subscription trong một bảng riêng. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Model cũ tốn kém khi cần phát triển. Một thay đổi trên subscription buộc phải cập nhật toàn bộ Customer record, còn truy vấn subscription phải quét các Customer object. Nguồn: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Phần khó là duy trì một trạng thái subscription nhất quán trong thời gian hai biểu diễn chồng lấn. Maintenance window loại bỏ giai đoạn chồng lấn đó, nhưng online migration phải xử lý nó trong khi vẫn phục vụ traffic bình thường.

Các rủi ro chính khá rõ ràng:

- Công việc migration cạnh tranh tài nguyên với production.
- Bỏ sót một write path sẽ tạo divergence giữa hai biểu diễn.
- Read cutover có thể trả về các row stale hoặc chưa được copy.

**[ANALYSIS]** Vì vậy, migration an toàn cần có các phase riêng cho truyền dữ liệu, quan sát, thay đổi authority và cleanup. Không nhất thiết phải triển khai các phase này bằng một control-plane component cụ thể, nhưng trách nhiệm của từng phase phải rõ ràng.

## 2. Pattern được nguồn mô tả

**[SOURCE FACT]** Stripe trình bày pattern dual-writing gồm bốn bước: ghi vào bảng cũ và mới; chuyển toàn bộ read path sang bảng mới; chuyển toàn bộ write path chỉ sang bảng mới; sau đó xóa dữ liệu cũ và code phụ thuộc model cũ. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Trong ví dụ Subscription, write mới ban đầu được ghi vào cả bảng Customers và Subscriptions. Các object hiện có được copy lazy khi được cập nhật, sau đó backfill phần subscription còn lại. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Để xác định các object bị thiếu mà không liên tục query live database, Stripe dùng database snapshot trong Hadoop và MapReduce, được quản lý bằng Scalding. Một job xuất ra các ID cần copy; một fleet đa luồng copy chúng; job chạy lại để kiểm tra omission. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Stripe dùng Scientist để chạy cả hai read path và so sánh kết quả trong production. Mismatch tạo alert và metric, còn lỗi ở experimental path không ảnh hưởng main application path. Khi kết quả khớp, read được chuyển sang bảng mới. Nguồn: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Với write, Stripe đảo thứ tự: ghi vào new store trước, sau đó archive dữ liệu ở old store. Họ refactor từng subscription operation và bổ sung các phép so sánh. Về sau, họ dừng ghi biểu diễn cũ, xóa field cũ và xử lý deletion theo cách lazy. Nguồn: https://stripe.com/blog/online-migrations

## 3. Kiến trúc

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

**[SOURCE FACT]** Các phần được nguồn hỗ trợ là old và new store, distributed backfill dựa trên snapshot, so sánh read trong production và lazy retirement. Nguồn: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** Feature flag, phase controller và verifier là các control-plane component được đưa vào sơ đồ để làm rõ. Chúng giúp quyết định rollout, pause và rollback có thể quan sát được. Sơ đồ không khẳng định Stripe dùng đúng các component này.

## 4. Tính đúng đắn trong giai đoạn chuyển tiếp

**[ANALYSIS]** Dual-write là một transitional invariant, không phải transaction boundary. Nếu hai store độc lập được cập nhật trong các transaction riêng, process failure có thể khiến một write bị thiếu. Design phải làm cho retry idempotent, ghi nhận migration version và liên tục phát hiện divergence.

**[ANALYSIS]** Chỉ có thể dùng một transaction bao phủ cả hai biểu diễn khi chúng cùng nằm trong một transaction boundary. Nếu không, hệ thống cần durable retry mechanism, reconciliation pass hoặc cả hai. Không lựa chọn nào biến hai store thành một database atomic; chúng chỉ giảm thời gian và phạm vi divergence.

**[SOURCE FACT]** Stripe giảm tác động hiệu năng của các write bổ sung bằng cách tăng dần tỷ lệ object được duplicate và theo dõi operational metric. Nguồn: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Shadow read kiểm tra semantic equivalence, không chỉ row count. Comparator nên quy định cách normalize ordering, giá trị absent so với empty và các field được model mới thay đổi có chủ ý. So sánh raw object có thể tạo false alarm; normalize quá mức có thể che giấu correctness bug.

**[ANALYSIS]** Cutover là một proof obligation. Trước khi bảng mới trở thành authority, migration cần chứng minh coverage của các object hiện có, kết quả khớp trên các read đại diện và mọi mutation path đã được chuyển. Sau cutover, nên giữ biểu diễn cũ như archive hoặc safety net cho đến khi có đủ bằng chứng để xóa.

**[PROPOSED DESIGN]** Một hệ thống generic có thể duy trì state theo object như `dual`, `new_primary` và `retired`. Gate việc chuyển state bằng một thay đổi atomic ở control plane. Route read và write theo state đó, đồng thời bảo đảm retry dùng cùng state và operation idempotency key. Đây là phần mở rộng được đề xuất, không phải khẳng định về implementation của Stripe.

## 5. Data model minh họa

**[SOURCE FACT]** Thay đổi khái niệm trong ví dụ Subscription là từ một field `subscription` trên Customer, sau đó là một array `subscriptions`, sang việc lưu active subscription trong bảng riêng. Nguồn: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** Schema relational generic dưới đây làm rõ ownership, migration state và version check. Đây là ví dụ minh họa, không phải schema của Stripe.

```sql
CREATE TABLE customers (
  customer_id     BIGINT PRIMARY KEY,
  legacy_payload  JSONB,
  migration_state TEXT NOT NULL,
  version         BIGINT NOT NULL
);

CREATE TABLE subscriptions (
  customer_id     BIGINT NOT NULL,
  subscription_id BIGINT NOT NULL,
  status          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  source_version  BIGINT NOT NULL,
  updated_at      TIMESTAMP NOT NULL,
  PRIMARY KEY (customer_id, subscription_id)
);
```

**[PROPOSED DESIGN]** `source_version` ngăn một backfill hoặc retry cũ ghi đè mutation mới hơn. Schema production cũng phải quy định cách biểu diễn delete, null, ordering và concurrent update. Các quy tắc này thuộc về comparator và write contract, không chỉ thuộc về định nghĩa table.

## 6. Rollout và retirement

**[PROPOSED DESIGN]** Nên xem mỗi phase là một thay đổi vận hành có thể đảo ngược khi khả thi:

- Bật dual-write cho một phần traffic hoặc object được kiểm soát.
- Chạy backfill theo batch có giới hạn và bảo đảm có thể retry an toàn.
- Chạy shadow read comparison nhưng không để lỗi của comparator đi vào primary request path.
- Promote new store chỉ sau khi coverage và mismatch check đạt yêu cầu.
- Dừng old write, giữ biểu diễn cũ trong thời gian còn cần cho recovery, rồi xóa bằng lazy cleanup.

Các threshold và batch size cụ thể phụ thuộc deployment; đó là assumption theo môi trường, không phải fact được nguồn xác lập.

**[ANALYSIS]** Migration chỉ hoàn tất khi biểu diễn cũ không còn là input của correctness. Điều đó đòi hỏi mọi read, write, asynchronous consumer, repair job và deletion path đều dùng contract mới. Nếu bất kỳ path nào vẫn ghi model cũ, retirement có thể tạo divergence trở lại.

## 7. Kết luận kỹ thuật

- Tách tính đầy đủ của dữ liệu đã copy khỏi correctness của read. Backfill kiểm tra coverage; shadow read kiểm tra behavior.
- Làm cho mọi migration write idempotent và có version.
- Cô lập experimental read khỏi primary request path.
- Xem read cutover và write cutover là hai lần thay đổi authority riêng biệt.
- Instrument mismatch, retry failure, lag và tiến độ cleanup trước rollout.
- Gắn nhãn các lựa chọn generic về control plane và schema là proposal, thay vì gán chúng cho hệ thống nguồn.

Pattern có thể áp dụng lâu dài không phải là “copy table rồi bật một flag”. Đó là một quá trình chuyển đổi có kiểm soát, trong đó truyền dữ liệu, verification, authority và retirement đều có điều kiện đúng đắn rõ ràng.
