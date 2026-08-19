---
title: "Dropbox Magic Pocket: Thiết kế Kho lưu trữ Blob quy mô Exabyte"
description: "Phân tích thiết kế hệ thống dựa trên nguồn về blob bất biến, mã hóa xóa, lưu trữ phân tầng và độ bền ở quy mô exabyte."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

[SOURCE FACT] Trang Dropbox Infrastructure được cung cấp liệt kê các bài kỹ thuật có tiêu đề “Scaling to exabytes and beyond”, “Inside the Magic Pocket”, “How we optimized Magic Pocket for cold storage” và “Pocket watch: Verifying exabytes of data”. Trang này cũng liệt kê các bài về lưu trữ SMR, loại bỏ đĩa cache SSD và hiệu quả lưu trữ trong Magic Pocket. Nguồn: https://dropbox.tech/infrastructure/

[ANALYSIS] Các tiêu đề đó cho thấy một bài toán lưu trữ có ba yêu cầu cạnh tranh: giữ lại lượng nội dung người dùng rất lớn, duy trì bản sao bền vững với chi phí hợp lý, và xác minh dữ liệu vẫn có thể khôi phục khi phần cứng hoặc địa điểm gặp sự cố. Blob store không phải là filesystem với một ổ đĩa lớn hơn. Nó phải quản lý placement, sửa chữa, toàn vẹn, vòng đời và vận hành như một bài toán điều khiển thống nhất.

[ANALYSIS] Workload có thể chủ yếu gồm các object bất biến hoặc chỉ ghi nối tiếp: nội dung tệp đã tải lên được định danh bằng object ID, còn tên, thư mục, quyền và revision thuộc về hệ metadata. Việc tách này cho phép data plane của blob tối ưu cho media tuần tự và sửa chữa mà không biến mọi thao tác thư mục thành thao tác lưu trữ. Đây là mô hình kỹ thuật, không phải khẳng định về triển khai riêng tư của Dropbox.

## 2. What the Original System Did

[SOURCE FACT] Index này xác định Magic Pocket là một chủ đề hạ tầng và nêu rõ tiêu đề “Scaling to exabytes and beyond”. Nó cũng xác định một bài tối ưu lưu trữ lạnh cho Magic Pocket và một bài về xác minh exabyte dữ liệu. Nguồn: https://dropbox.tech/infrastructure/

[ANALYSIS] Index công khai chỉ cho phép kết luận thận trọng: Dropbox đã công khai thảo luận Magic Pocket trong bối cảnh tăng trưởng quy mô exabyte, lưu trữ lạnh và xác minh. Với tài liệu được cung cấp, không thể xác định một cấu hình cụ thể về số fragment dữ liệu/parity, hệ số replication, thuật toán placement, hợp đồng API, thời gian repair hay phần trăm durability.

[ANALYSIS] Vì vậy, bài này không gán các cơ chế đó cho Dropbox. Phần còn lại là diễn giải kỹ thuật về những gì một hệ thống có các mối quan tâm nêu trên cần làm: tách dữ liệu bất biến khỏi metadata, mã hóa dữ liệu trên các failure domain, duy trì manifest để tái dựng, chuyển object giữa các tier lưu trữ và liên tục kiểm tra toàn vẹn. Mỗi cơ chế được phát triển như một thiết kế đề xuất bên dưới.

## 3. Architecture Diagram

[ANALYSIS] Sơ đồ tách chủ đề được nguồn hỗ trợ khỏi các thành phần được đề xuất cho một thiết kế dùng trong phỏng vấn. Nhãn source-backed chỉ có nghĩa index Dropbox gọi tên hệ thống hoặc mối quan tâm tương ứng; index không xác nhận các nội bộ được vẽ.

```mermaid
flowchart LR
    C[Client / Dropbox service] --> API[Object API\n[Proposed component]]
    API --> META[Metadata and manifest store\n[Proposed component]]
    API --> ING[Ingest and chunker\n[Proposed component]]
    ING --> ENC[Erasure encoder\n[Proposed component]]
    ENC --> PL[Placement service\n[Proposed component]]
    PL --> HOT[Hot tier: SSD or fast disk\n[Proposed component]]
    PL --> COLD[Cold tier: dense / SMR media\n[Proposed component]]
    META --> READ[Read planner and decoder\n[Proposed component]]
    HOT --> READ
    COLD --> READ
    READ --> API
    AUDIT[Verifier / repair scheduler\n[Proposed component]] --> META
    AUDIT --> HOT
    AUDIT --> COLD
    TOPIC[Magic Pocket, exabyte scale, cold storage, verification\n[Source-backed component]] -.-> API
```

[PROPOSED DESIGN] Luồng ghi tạo các chunk bất biến, tính checksum, mã hóa dữ liệu và parity, đặt fragment vào các failure domain độc lập, rồi chỉ commit manifest sau khi số fragment bắt buộc đã durable. Luồng đọc lấy manifest, chọn các fragment khỏe, xác minh checksum và tái dựng fragment bị thiếu khi cần.

## 4. System Design Analysis

[SOURCE FACT] Index nguồn gọi tên cold storage, lưu trữ SMR, loại bỏ SSD cache và xác minh dữ liệu như các chủ đề hạ tầng Dropbox riêng biệt. Nguồn: https://dropbox.tech/infrastructure/

[ANALYSIS] Các mối quan tâm này liên kết với nhau. Media lạnh giảm chi phí nhưng thường tăng latency truy cập và khiến ghi random nhỏ trở nên đắt. Erasure coding giảm overhead lưu trữ durable so với nhiều full replica, nhưng phải ghi parity, đọc nhiều fragment và khiến repair tiêu tốn network. Verification dùng bandwidth và I/O, nhưng nếu không có nó, lỗi bit im lặng có thể không bị phát hiện cho tới khi lỗi thứ hai loại bỏ bản tốt cuối cùng.

[PROPOSED DESIGN] Dùng một lớp blob content-addressed với các chunk bất biến. Giữ một record metadata nhỏ bên ngoài blob layer: object identity, danh sách chunk theo thứ tự, logical length, checksum root, coding profile, tier và placement epoch. Không ghi đè chunk đã commit. Revision mới của tệp ghi các chunk mới và manifest mới; garbage collection sau đó xóa các chunk không còn được tham chiếu sau một khoảng an toàn.

[PROPOSED DESIGN] Mô hình hóa failure domain một cách tường minh: placement của fragment không được dùng chung drive, host, rack, power domain hoặc site khi chính sách durability yêu cầu độc lập. Placement service phải từ chối plan tuy đủ số fragment nhưng vi phạm tính đa dạng domain. Repair job trước hết khôi phục ngưỡng recoverability tối thiểu, sau đó khôi phục phân bố ưu tiên.

[ANALYSIS] Control plane khó hơn data path. Nó phải quyết định placement từ inventory không hoàn hảo và luôn thay đổi, đồng thời tránh repair storm trong lúc site hoặc network outage. Rate limit, ngân sách theo domain và mức ưu tiên repair là tính năng durability, không chỉ là tinh chỉnh vận hành.

## 5. Data Model

[PROPOSED DESIGN] Một biểu diễn relational tối thiểu cho control plane là:

```sql
CREATE TABLE blob_manifest (
  blob_id            VARBINARY(32) PRIMARY KEY,
  revision_id        VARBINARY(32) NOT NULL,
  logical_size       BIGINT NOT NULL,
  chunk_count        BIGINT NOT NULL,
  coding_profile     VARCHAR(32) NOT NULL,
  checksum_root      VARBINARY(32) NOT NULL,
  tier               VARCHAR(16) NOT NULL,
  state              VARCHAR(16) NOT NULL,
  placement_epoch    BIGINT NOT NULL,
  created_at         TIMESTAMP NOT NULL
);

CREATE TABLE fragment (
  blob_id            VARBINARY(32) NOT NULL,
  chunk_index        BIGINT NOT NULL,
  fragment_index     INT NOT NULL,
  fragment_id        VARBINARY(32) NOT NULL,
  domain_id          VARCHAR(128) NOT NULL,
  device_id          VARCHAR(128) NOT NULL,
  checksum           VARBINARY(32) NOT NULL,
  state              VARCHAR(16) NOT NULL,
  PRIMARY KEY (blob_id, chunk_index, fragment_index)
);
```

[PROPOSED DESIGN] `blob_manifest` là record commit; `fragment` là chỉ mục placement và integrity. Trong production, các bảng này sẽ được shard theo `blob_id` và được hệ metadata replicate. State machine của manifest có thể phân biệt `STAGING`, `COMMITTED`, `DELETING` và `DELETED`; reader chỉ phục vụ manifest `COMMITTED`.

## 6. API Design

[PROPOSED DESIGN] Một API nội bộ có thể cung cấp các operation idempotent:

```text
CreateUpload(idempotency_key, expected_size, policy) -> upload_id
PutChunk(upload_id, chunk_index, bytes, checksum) -> accepted
CommitUpload(upload_id, checksum_root) -> blob_id
GetManifest(blob_id) -> manifest
ReadRange(blob_id, offset, length) -> byte stream
DeleteBlob(blob_id, deletion_token) -> accepted
```

[PROPOSED DESIGN] `PutChunk` có thể retry vì idempotency key và chunk index xác định write dự kiến. `CommitUpload` phải có điều kiện manifest đầy đủ và trạng thái durability đã được xác minh. `ReadRange` nên trả về stream thay vì materialize toàn bộ object; read planner chỉ cần lấy các chunk giao với range. Xóa trước hết là logical, sau đó mới physical, để reader đang chạy không tranh chấp với việc reclaim ngay.

[ANALYSIS] API không nên để caller thông thường thấy vị trí fragment. Vị trí là chi tiết triển khai và là security boundary. Repair worker có thể dùng privileged internal API để đọc fragment đã verify và ghi fragment thay thế dưới placement epoch mới.

## 7. Scaling Strategy

[PROPOSED DESIGN] Shard metadata theo hash ổn định của `blob_id`, và tách manifest lớn khỏi đường lookup nóng khi object có nhiều chunk. Route mỗi data request theo placement epoch được ghi trong manifest; cách này tránh global lock trong lúc rebalance.

[PROPOSED DESIGN] Phân vùng data plane theo storage cell. Một cell sở hữu inventory thiết bị và failure domain có giới hạn, cùng scheduler cục bộ cho ingest, read, scrub và repair. Global allocator cấp cell mới và điều khiển việc di chuyển liên cell. Cell có giới hạn giúp quan sát blast radius và queue; nó cũng ngăn một repair queue toàn cục trở thành bottleneck ẩn của hệ thống.

[ANALYSIS] Rebalance nên nhận biết nhu cầu. Di chuyển dữ liệu lạnh chỉ để cân bằng số byte có thể tạo rủi ro và tải network không cần thiết. Ưu tiên migration từ từ, dành bandwidth cho foreground read, và khiến mọi lần di chuyển có thể resume. Phần cứng mới nên nhận dữ liệu qua ramp có kiểm soát thay vì nạp đầy ngay.

[PROPOSED DESIGN] Chuyển tier nên do policy quyết định: tuổi, lịch sử truy cập, legal hold và recovery priority có thể quyết định blob ở hot hay chuyển cold. Transition là thao tác copy-and-verify rồi atomic update manifest. Nếu verification thất bại, giữ tier cũ và retry; không để việc chuyển tier tự trở thành sự kiện mất dữ liệu.

## 8. Failure Scenarios

[PROPOSED DESIGN] Drive failure: đánh dấu fragment unavailable, chọn fragment còn sống, tái dựng fragment thiếu, checksum rồi đặt nó vào domain khác. Giới hạn số repair đồng thời mỗi cell và ưu tiên blob gần ngưỡng recoverability.

[PROPOSED DESIGN] Host hoặc rack failure: placement policy vốn phải phân tán fragment trên các domain đó. Read dùng bất kỳ tập fragment đã verify nào đủ điều kiện. Repair planner chờ bằng chứng domain unavailable trước khi tạo công việc trùng lặp, trừ khi margin còn lại không an toàn.

[PROPOSED DESIGN] Site isolation: dừng placement vào site bị ảnh hưởng, chuyển read sang site khác và giữ manifest làm nguồn sự thật. Không yêu cầu đồng bộ mọi write phải đi qua site đang hỏng. Khi kết nối trở lại, reconcile placement epoch và chạy repair có giới hạn.

[PROPOSED DESIGN] Corruption im lặng: checksum mismatch loại fragment khỏi tập ứng viên đọc. Tái dựng từ các fragment khác đã verify, ghi bản thay thế và giữ bằng chứng để phân tích sức khỏe thiết bị và media. Scrub phải được lập lịch để không chiếm toàn bộ bandwidth dành cho traffic khách hàng.

[PROPOSED DESIGN] Metadata outage: phục vụ read cần manifest được cache và kiểm tra chặt chẽ hoặc metadata quorum khỏe mạnh. Nếu không có cả hai, fail closed thay vì đoán vị trí fragment. Điều này khiến metadata availability là một phần của blob availability và đòi hỏi replication cùng backup độc lập.

[ANALYSIS] Failure mode sâu nhất là lỗi tương quan: coding chịu được từng disk riêng lẻ vẫn có thể thất bại khi rack, site, thao tác vận hành hoặc software release lỗi ảnh hưởng nhiều fragment cùng lúc. Placement theo fault domain, rollout theo giai đoạn, deletion hold và diễn tập thảm họa xử lý các tương quan mà parity mathematics không thể tự xử lý.

## 9. Capacity Estimation

[PROPOSED DESIGN] Sau đây là illustrative assumption, không phải số đo của Dropbox: logical corpus `10 EB`, với profile erasure coding `k=10` data fragment và `m=4` parity fragment. Bỏ qua metadata và không gian repair tạm thời, capacity durable thô là:

```text
raw_capacity = logical_capacity * (k + m) / k
             = 10 EB * 14 / 10
             = 14 EB
```

[PROPOSED DESIGN] Thêm các illustrative assumption riêng là `15%` cho free space và repair headroom, và `5%` cho metadata, checksum cùng operational overhead:

```text
planned_capacity = 14 EB * (1 + 0.15 + 0.05)
                 = 16.8 EB
```

[ANALYSIS] Phép tính cho thấy “exabyte scale” là bài toán kế toán cũng nhiều như bài toán số lượng disk. Mô hình thật phải gồm phân bố chunk size, compression, dữ liệu đã xóa nhưng còn hold, repair amplification, hỗn hợp tier, site reservation và tốc độ đỉnh mà repair tiêu thụ network cùng I/O thiết bị. Không có con số capacity nào của Dropbox được khẳng định ở đây vì tài liệu nguồn cung cấp không có số đó.

## 10. Trade-offs

[ANALYSIS] Erasure coding so với replication: coding thường hiệu quả hơn về không gian, còn replication cho read và repair đơn giản, latency thấp hơn. Thiết kế thực tế có thể dùng replication cho object nhỏ hoặc nóng và coding cho object đủ lớn, lạnh hơn, nhưng mỗi policy bổ sung đều tăng độ phức tạp vận hành.

[ANALYSIS] Media nóng so với lạnh: placement nóng bảo vệ latency và khả năng vận hành; placement lạnh cải thiện hiệu quả chi phí cho dữ liệu ít được đọc. Ranh giới tier chỉ dựa trên tuổi sẽ phân loại sai nội dung được truy cập định kỳ, vì vậy access signal và hysteresis quan trọng.

[ANALYSIS] Verification so với foreground traffic: scrub mạnh phát hiện hỏng sớm hơn nhưng cạnh tranh I/O và network. Mục tiêu an toàn không phải kiểm tra tối đa; đó là một detection window đo được trong ngân sách tài nguyên có giới hạn.

[PROPOSED DESIGN] Dữ liệu bất biến đơn giản hóa concurrency và auditability nhưng khiến garbage collection trở nên bắt buộc. Giữ tombstone và legal hold trong metadata, dùng mark-and-sweep, và yêu cầu delayed deletion window trước khi reclaim fragment không còn được tham chiếu.

## 11. What We Can Learn From This Architecture

[SOURCE FACT] Index hạ tầng của Dropbox đặt Magic Pocket cạnh các chủ đề exabyte scaling, tối ưu cold storage, tiến hóa storage media và xác minh exabyte dữ liệu. Nguồn: https://dropbox.tech/infrastructure/

[ANALYSIS] Bài học hữu ích không phải là một coding constant thần kỳ. Đó là economics của storage, durability, verification và vòng đời phần cứng phải được thiết kế cùng nhau. Một byte rẻ nhưng không thể verify không phải byte durable; một byte durable nhưng không thể repair trong failure budget cũng không phải dịch vụ đáng tin.

[ANALYSIS] Bài học thứ hai là coi vận hành như kiến trúc. Placement epoch, repair throttle, scheduling theo domain, integrity evidence và migration có kiểm soát là quyết định về data model và protocol. Chúng phải test được trong failure simulator, không thể để runbook xử lý sau khi storage engine đã xây xong.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN] Requirements: lưu blob bất biến; hỗ trợ upload resumable và range read; chịu được lỗi device, rack và site; phát hiện corruption im lặng; đặt dữ liệu ít truy cập lên tier rẻ hơn; và cung cấp semantics xóa có thể dự đoán. Các con số trong thiết kế này là illustrative assumptions, không phải dữ kiện Dropbox.

[PROPOSED DESIGN] Bắt đầu với manifest service và blob service. Manifest service sở hữu object state, thứ tự chunk, coding profile, checksum và placement epoch. Blob service sở hữu byte và không quyết định object visibility. Upload vào staging, verify fragment, rồi atomic publish manifest.

[PROPOSED DESIGN] Dùng coding profile có thể cấu hình và đặt mỗi fragment vào một failure domain khác theo yêu cầu. Khi read, lấy tập verified tối thiểu, retry fragment khác nếu checksum fail và chỉ reconstruct dữ liệu thiếu. Khi repair, khôi phục threshold trước rồi mới khôi phục distribution. Giữ queue repair theo cell và dành bandwidth cho read/write người dùng.

[PROPOSED DESIGN] Thêm verifier thực hiện scrub theo lịch và check theo sự kiện sau lỗi thiết bị, migration và read. Kết quả phải là bằng chứng bền vững gắn với fragment identity và device identity. Tier manager phải copy, verify và atomic switch manifest, rollback về tier cũ khi verification thất bại.

[ANALYSIS] Các invariant quan trọng trong phỏng vấn là: manifest đã commit chỉ trỏ tới dữ liệu có thể reconstruct; checksum fail không bao giờ trở thành read hợp lệ; deletion không reclaim dữ liệu còn chịu legal hold; và repair không vi phạm tính đa dạng failure domain. Chỉ chọn mục tiêu capacity, latency và durability sau khi interviewer cung cấp workload cùng giả định failure.

## Original Sources

- Company: Dropbox
- Exact Article Title: Infrastructure
- URL: https://dropbox.tech/infrastructure/
- What information from the source was used: Index hạ tầng của trang liệt kê các chủ đề Magic Pocket gồm “Scaling to exabytes and beyond”, “Inside the Magic Pocket”, “How we optimized Magic Pocket for cold storage”, “Pocket watch: Verifying exabytes of data”, các chủ đề storage media và bài kiểm tra disaster readiness của data center. Không có chi tiết triển khai riêng tư hay con số capacity nào ngoài các tiêu đề được liệt kê được suy diễn thành source fact.
