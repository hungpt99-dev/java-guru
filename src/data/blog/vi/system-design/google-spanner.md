---
title: "Spanner: Cơ sở dữ liệu Phân tán Toàn cầu của Google và TrueTime"
description: "Phân tích thiết kế hệ thống có kỷ luật nguồn về external consistency, bất định thời gian, nhân bản kiểu Paxos, phân mảnh và vận hành đa khu vực."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

[SOURCE FACT] Trang Google Research được phép sử dụng có tiêu đề *Spanner: Google's Globally Distributed Database*. Trang này xác định công trình là một ấn phẩm trên ACM Transactions on Computer Systems. [Nguồn: https://research.google/pubs/spanner-googles-globally-distributed-database/]

[ANALYSIS] Bài toán kỹ thuật được gợi ra từ tiêu đề không chỉ là lưu các hàng dữ liệu ở vài trung tâm dữ liệu. Một cơ sở dữ liệu toàn cầu hữu ích phải đồng thời đáp ứng bốn yêu cầu: giao dịch trên nhiều máy, sống sót trước lỗi khu vực, phân vùng theo chiều ngang và một thứ tự mà ứng dụng có thể tin cậy. Độ trễ mạng, lệch đồng hồ, phân hoạch mạng, mất bản sao và khóa nóng khiến các yêu cầu này tác động lẫn nhau.

[SOURCE FACT] Nguồn bổ trợ nói rằng các dịch vụ trực tuyến lớn có thể truy vấn các tập dữ liệu nhiều terabyte trải trên hàng nghìn máy chủ, và việc giữ đuôi độ trễ thấp trở nên khó hơn khi quy mô hoặc mức sử dụng tăng. Nguồn mô tả mục tiêu là tạo ra một tổng thể có khả năng phản hồi dự đoán được từ những thành phần kém dự đoán hơn. [Nguồn: https://research.google/pubs/the-tail-at-scale/]

[ANALYSIS] Với một cơ sở dữ liệu giao dịch phân tán toàn cầu, bài toán đuôi độ trễ không chỉ nằm ở các lượt đọc mà người dùng nhìn thấy. Commit liên khu vực phải chờ phối hợp; khoảng bất định của đồng hồ có thể trì hoãn thời điểm một kết quả an toàn để công bố; bản sao lỗi có thể buộc hệ thống đi theo đường quorum chậm hơn. Thiết kế phải nêu rõ tính đúng đắn nhưng không để mọi thành phần chậm biến thành lỗi độ trễ toàn hệ thống.

## 2. What the Original System Did

[SOURCE FACT] Tiêu đề nguồn mô tả Spanner là hệ thống phân tán toàn cầu, còn phạm vi nghiên cứu được cung cấp nêu TrueTime, external consistency, Paxos, sharding và vận hành đa khu vực. Đây là các chủ đề nguồn cho bài viết, không phải khẳng định về một cấu hình triển khai không được liệt kê. [Nguồn: https://research.google/pubs/spanner-googles-globally-distributed-database/]

[ANALYSIS] Bước chuyển đổi khái niệm cốt lõi là đưa sự bất định vào giao thức giao dịch. Một lần đọc thời gian không được xem là một thời điểm chính xác duy nhất; nó có cận sớm nhất và cận muộn nhất. Giao dịch chỉ được gán timestamp commit khi hệ thống chứng minh được timestamp đó được sắp thứ tự an toàn so với các giao dịch liên quan. Đây là vai trò thường gắn với TrueTime trong thiết kế Spanner: cơ sở dữ liệu chấp nhận một chi phí chờ có giới hạn để đạt được bảo đảm thứ tự mạnh hơn.

[ANALYSIS] Paxos là một primitive nhân bản tự nhiên cho kiến trúc này: mỗi shard có log được nhân bản, và quorum chọn trạng thái bền vững tiếp theo. Sharding giữ các dải khóa không liên quan độc lập, trong khi coordinator giao dịch có thể huy động nhiều leader shard khi giao dịch đi qua nhiều dải. Đặt bản sao ở nhiều khu vực cải thiện khả năng chịu lỗi và tính địa phương, nhưng phối hợp liên khu vực vẫn là chi phí về độ trễ và tính sẵn sàng, không phải tối ưu miễn phí.

[ANALYSIS] “External consistency” mạnh hơn hội tụ cuối cùng. Nếu giao dịch A commit trước khi giao dịch B bắt đầu, cơ sở dữ liệu không được về sau công bố thứ tự trong đó B đứng trước A. Bảo đảm này nói về thứ tự tuần tự hóa mà client quan sát; phần triển khai vẫn phải xử lý retry, kết quả không xác định và thay đổi leader.

## 3. Architecture Diagram

Sơ đồ tách giao diện và kiểm soát vận hành được đề xuất khỏi các chủ đề của nguồn. Đây không phải khẳng định Google dùng đúng cách phân rã thành phần này.

```mermaid
flowchart LR
    C[Client]
    G[Global SQL/API gateway\n[Proposed component]]
    R[Directory and shard map\n[Proposed component]]
    S1[Shard group A\nPaxos replicas\n[Source-backed component]]
    S2[Shard group B\nPaxos replicas\n[Source-backed component]]
    TT[TrueTime uncertainty API\n[Source-backed component]]
    TC[Commit coordinator\n[Proposed component]]
    REG[Multi-region replica placement\n[Source-backed component]]
    OBS[Tail-latency controls\n[Proposed component]]

    C --> G --> R
    R --> S1
    R --> S2
    G --> TC
    TC --> S1
    TC --> S2
    TC --> TT
    S1 --- REG
    S2 --- REG
    G --> OBS
```

[SOURCE FACT] Các nhãn “TrueTime,” “Paxos,” sharding và vận hành đa khu vực được neo vào mô tả nguồn Spanner được cung cấp. [Nguồn: https://research.google/pubs/spanner-googles-globally-distributed-database/]

[PROPOSED DESIGN] Gateway, directory shard, coordinator và các kiểm soát quan sát là cách phân rã phù hợp cho phỏng vấn. Chúng làm rõ ranh giới sở hữu và lỗi; chúng không khẳng định đây là tên module hay giao diện chính xác của bài báo gốc.

## 4. System Design Analysis

[ANALYSIS] Giao dịch trước hết ánh xạ các khóa tới shard. Lượt đọc hoặc ghi trên một shard có thể ở gần một nhóm bản sao. Giao dịch nhiều shard cần coordinator, chuẩn bị ở các participant, timestamp commit an toàn toàn cục và các bản ghi quyết định bền vững. Giao thức phải làm cho quyết định có thể khôi phục: sau khi coordinator sập, participant phải biết commit, abort hay chờ giải quyết.

[ANALYSIS] TrueTime thay đổi đường đi commit theo cách cụ thể. Gọi khoảng bất định là `[earliest, latest]`. Timestamp commit chọn tại `latest` chưa an toàn ngay chỉ vì đồng hồ cục bộ trả về nó. Coordinator phải chờ đến khi khoảng bất định đã trôi qua trước khi công bố kết quả mà thứ tự thời gian thực có ý nghĩa. Việc chờ này bảo vệ external consistency, nhưng chỉ nên tính vào chi phí nơi thực sự cần bảo đảm đó.

[ANALYSIS] Nhân bản quorum bằng Paxos và thứ tự thời gian giải quyết hai vấn đề khác nhau. Paxos quyết định giá trị nào bền vững trong một nhóm bản sao; tự nó không định nghĩa thứ tự thời gian thực toàn cục của giao dịch. Ngược lại, API thời gian không nhân bản dữ liệu. Kết hợp chúng hữu ích vì log tạo ra đồng thuận bền vững, còn bất định thời gian có giới hạn cung cấp quy tắc sắp thứ tự commit.

[SOURCE FACT] Nguồn Tail at Scale xác định các đợt độ trễ cao tạm thời ngày càng quan trọng ở quy mô lớn và bàn về các kỹ thuật giảm tác động của chúng, bao gồm việc tận dụng tài nguyên đã có cho khả năng chịu lỗi. [Nguồn: https://research.google/pubs/the-tail-at-scale/]

[ANALYSIS] Áp dụng vào đây, điều đó gợi ý đọc hedged tới các bản sao an toàn, truyền deadline, admission control và cô lập shard quá tải. Hedging không được nhân đôi một ghi không idempotent. Lượt đọc có thể dùng phản hồi chấp nhận được đầu tiên, còn lượt ghi phải đi qua giao thức giao dịch và retry token.

## 5. Data Model

[PROPOSED DESIGN] Dùng schema quan hệ với khóa tenant và entity rõ ràng. Các cột khóa đầu nên khớp đường truy cập chính để các hàng liên quan có thể được đặt gần nhau khi cần atomicity giữa nhiều hàng.

```sql
CREATE TABLE Accounts (
  TenantId   STRING NOT NULL,
  AccountId  STRING NOT NULL,
  Region     STRING NOT NULL,
  Balance    INT64 NOT NULL,
  Version    INT64 NOT NULL,
) PRIMARY KEY (TenantId, AccountId);

CREATE TABLE LedgerEntries (
  TenantId   STRING NOT NULL,
  AccountId  STRING NOT NULL,
  EntryId    STRING NOT NULL,
  Amount     INT64 NOT NULL,
  CreatedAt  TIMESTAMP NOT NULL,
) PRIMARY KEY (TenantId, AccountId, EntryId),
  INTERLEAVE IN PARENT Accounts ON DELETE CASCADE;
```

[ANALYSIS] `TenantId` ngăn một tenant trở thành chiều phân vùng duy nhất, còn `AccountId` giữ ledger của tài khoản gần balance cho giao dịch chuyển tiền. Thiết kế thực tế cũng phải định nghĩa quyền sở hữu secondary index, hành vi thay đổi schema và giới hạn cho tài khoản lớn. Các chi tiết đó không được xác lập bởi trang nguồn đã cung cấp.

## 6. API Design

[PROPOSED DESIGN] Expose ngữ nghĩa giao dịch rõ ràng thay vì buộc caller suy luận từ retry HTTP.

```text
BeginTransaction(mode, read_timestamp?) -> transaction_id
Read(transaction_id, table, key) -> row, read_timestamp
Write(transaction_id, mutations, idempotency_key) -> accepted
Commit(transaction_id, deadline) -> committed(commit_timestamp) | aborted(reason)
ReadAt(table, key, timestamp) -> row | not_found
```

[ANALYSIS] `Commit` phải phân biệt abort với kết quả không xác định. Client timeout sau khi gửi commit không thể an toàn phát mutation trùng tùy ý; nó nên truy vấn trạng thái giao dịch bằng transaction ID và idempotency key. `ReadAt` hữu ích cho snapshot nhất quán, nhưng nên từ chối timestamp ngoài retention và chính sách an toàn của replica.

[PROPOSED DESIGN] Trả về trạng thái có thể retry kèm gợi ý deadline phía server cho thay đổi leader tạm thời, quorum không khả dụng hoặc contention. Không hứa độ trễ toàn cầu thấp cho giao dịch đi qua các khu vực xa nhau; hãy công khai mode nhất quán và đánh đổi deadline cho caller.

## 7. Scaling Strategy

[ANALYSIS] Shard theo dải khóa có thứ tự hoặc khóa phân vùng do directory quản lý; tách dải khi dung lượng lưu trữ, tốc độ request hoặc lock contention trở nên không an toàn; di chuyển bản sao độc lập với API phục vụ. Hoạt động tách và di chuyển cần metadata epoch để request không ghi qua shard map cũ.

[ANALYSIS] Đặt bản sao trên các failure domain và bầu leader cho mỗi nhóm bản sao. Lượt đọc có thể dùng replica gần client chỉ khi trạng thái đã áp dụng đáp ứng timestamp và consistency mode được yêu cầu. Commit nhiều shard chịu chi phí phối hợp; workload một shard nên tránh gọi global coordinator.

[SOURCE FACT] Nguồn Tail at Scale mô tả các dịch vụ chạy trên hàng nghìn máy chủ và lập luận rằng kỹ thuật tail-tolerant có thể cho phép utilization cao hơn mà không kéo dài đuôi độ trễ, nhờ đó giảm over-provisioning lãng phí. [Nguồn: https://research.google/pubs/the-tail-at-scale/]

[PROPOSED DESIGN] Áp dụng bài học đó bằng giới hạn hàng đợi theo shard, lớp workload, retry có giới hạn và loại bỏ tải khi quá tải. Theo dõi p50, p95 và p99 theo khu vực, thao tác, shard và consistency mode. Các percentile này là quy ước quan sát được đề xuất, không phải số đo nguồn báo cáo.

## 8. Failure Scenarios

[ANALYSIS] **Mất khu vực:** nhóm bản sao chỉ tiếp tục nếu quorum và chính sách đặt bản sao còn sống sau sự cố. Giao dịch chưa đạt quyết định bền vững phải retry hoặc được resolve; client không được cho rằng timeout mạng đồng nghĩa abort.

[ANALYSIS] **Mất leader:** leader mới phát lại log nhân bản và từ chối epoch cũ. Request mang lease hoặc directory epoch cũ nhận lỗi có thể retry. Retry token ngăn client tạo một thao tác logic thứ hai.

[ANALYSIS] **Khoảng bất định đồng hồ tăng:** commit-wait tăng hoặc hệ thống từ chối thao tác mà deadline không đủ. Lượt đọc stale hoặc nhất quán yếu có thể vẫn thực hiện được, nhưng API phải nói rõ.

[ANALYSIS] **Khóa hoặc dải nóng:** tách nơi schema cho phép, rate-limit tác nhân và chuyển tải đọc sang replica đủ điều kiện. Khóa tăng đơn điệu có thể tập trung ghi; thiết kế khóa nên phân tán các entity độc lập thay vì dựa vào một global counter.

[SOURCE FACT] Nguồn Tail at Scale xem độ trễ cao tạm thời là vấn đề cấp hệ thống ở quy mô lớn, không chỉ là vấn đề của một máy riêng lẻ. [Nguồn: https://research.google/pubs/the-tail-at-scale/]

[PROPOSED DESIGN] Dùng deadline và truyền cancellation để participant chậm không giữ tài nguyên coordinator vô hạn. Ghi nhận nguyên nhân mỗi lần trì hoãn: quorum, lock conflict, commit wait, queueing hoặc retry mạng.

## 9. Capacity Estimation

[SOURCE FACT] Abstract Tail at Scale dùng “within 100 milliseconds” làm ví dụ về độ phản hồi mà người dùng cảm nhận là mượt, và mô tả tập dữ liệu nhiều terabyte trải trên hàng nghìn máy chủ. Các con số này thuộc thảo luận dịch vụ lớn nói chung của nguồn; không phải tuyên bố capacity của Spanner. [Nguồn: https://research.google/pubs/the-tail-at-scale/]

[PROPOSED DESIGN] Giả định minh họa: một deployment nhận 1,000,000 logical operation mỗi giây, gồm 70% đọc và 30% ghi. Giả định minh họa: mutation của một row mã hóa trung bình 2 KiB. Băng thông ghi xấp xỉ `300,000 * 2 KiB = 600,000 KiB/s`, hay khoảng `586 MiB/s`, trước replication, index, log và protocol overhead.

[PROPOSED DESIGN] Giả định minh họa: cần ba bản sao bền vững cho mỗi shard. Lưu lượng ghi nhân bản thô khi đó khoảng `1.76 GiB/s`, trước index và compaction. Đây là đầu vào sizing, không phải tuyên bố về hệ thống gốc. Thiết kế phải dự toán riêng quorum message, egress liên khu vực, bandwidth phục hồi và traffic tạm thời do tách hoặc di chuyển.

[ANALYSIS] Capacity bị giới hạn bởi shard liên quan chậm nhất và đường đi commit, không chỉ bởi tổng storage. Load test hữu ích phải thay đổi mức tập trung hot key, tỷ lệ giao dịch liên khu vực, khoảng bất định, tần suất failover leader và retry storm. Tiêu chí đạt phải gồm tail latency và tỷ lệ abort/kết quả không xác định, không chỉ throughput trung bình.

## 10. Trade-offs

[ANALYSIS] External consistency mạnh tạo contract client mạnh, nhưng thêm phối hợp và có thể thêm commit waiting. Mode đọc yếu hơn có thể giảm độ trễ, nhưng caller phải tự xử lý nhiều phức tạp thứ tự hơn.

[ANALYSIS] Nhiều replica tăng khả năng chịu lỗi và địa phương đọc, đồng thời tăng storage, replication traffic và quorum coordination. Đặt bản sao đa khu vực giảm phụ thuộc vào một khu vực nhưng khiến ghi thông thường nhạy với độ trễ diện rộng và hành vi khi phân hoạch.

[ANALYSIS] Tách tự động cải thiện cô lập khi dữ liệu tăng, nhưng làm phức tạp giao dịch, index, định tuyến metadata và debug vận hành. Schema quan hệ hiệu quả cho workload giao dịch, nhưng chọn khóa kém có thể tạo dải nóng mà không giao thức replication nào che giấu được.

[SOURCE FACT] Nguồn Tail at Scale trình bày tail-tolerance như cách giữ độ phản hồi từ các thành phần không đáng tin cậy và tránh over-provisioning lãng phí. [Nguồn: https://research.google/pubs/the-tail-at-scale/]

[PROPOSED DESIGN] Thỏa hiệp thực tế là cho phép chọn consistency và locality theo từng thao tác chỉ khi ngữ nghĩa sản phẩm cho phép, đồng thời giữ đường đi nghiêm ngặt cho chuyển tiền, uniqueness và workflow cần thứ tự nhân quả.

## 11. What We Can Learn From This Architecture

[SOURCE FACT] Hai nguồn được phép kết nối hành vi dịch vụ quy mô toàn cầu với độ trễ dự đoán được: một là ấn phẩm Spanner, nguồn kia giải thích vì sao đuôi độ trễ chi phối khi dịch vụ lớn lên. [Nguồn: https://research.google/pubs/spanner-googles-globally-distributed-database/ và https://research.google/pubs/the-tail-at-scale/]

[ANALYSIS] Bài học rộng hơn là mô hình hóa bất định thay vì che giấu nó. Bất định thời gian thuộc về chứng minh tính đúng; bất định replica thuộc về trạng thái quorum; bất định route thuộc về metadata epoch; và bất định độ trễ thuộc về deadline cùng tail metric.

[ANALYSIS] Bài học khác là tách các bảo đảm. Replication tạo đồng thuận bền vững, sharding tạo khả năng mở rộng, time bound hỗ trợ ordering và tail control bảo vệ độ trễ người dùng. Không cơ chế nào thay thế cơ chế khác.

[PROPOSED DESIGN] Trong phỏng vấn, hãy nêu invariant trước: “Một giao dịch đã commit không được quan sát trước một giao dịch đã commit sớm hơn trong thời gian thực.” Sau đó xác định chi phí của invariant, thiết kế phục hồi lỗi, rồi mới tối ưu đường đi phổ biến.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN] **Requirements:** hỗ trợ đọc và ghi giao dịch trên dataset quan hệ được phân vùng toàn cầu; cung cấp mode external consistency nghiêm ngặt; sống sót trước lỗi khu vực khi placement quorum cho phép; và có hành vi dự đoán được khi quá tải. Mục tiêu 100 millisecond không được giả định cho ghi; đó là ví dụ phản hồi chung của nguồn.

[PROPOSED DESIGN] **Write path:** định tuyến khóa qua directory có version, gửi mutation đến leader của các shard participant, nhân bản prepare record của từng participant qua consensus group, chọn timestamp từ khoảng bất định, chờ đến khi timestamp an toàn, rồi nhân bản và công bố quyết định commit. Chỉ trả commit timestamp sau khi quyết định bền vững.

[PROPOSED DESIGN] **Read path:** với đọc nghiêm ngặt, chọn replica phục vụ được snapshot yêu cầu và xác minh điều kiện safe-time. Trong giao dịch, cố định read timestamp và định tuyến mọi lượt đọc qua snapshot đó. Với đọc nới lỏng, cho phép replica gần hơn nhưng trả metadata về độ stale.

[PROPOSED DESIGN] **Correctness:** dùng idempotency key cho mutation, transaction ID để tra trạng thái, quyết định participant bền vững và fencing epoch cho leader cùng directory entry. Định nghĩa xử lý commit không rõ kết quả, không chỉ success và failure.

[PROPOSED DESIGN] **Operations:** cảnh báo khi uncertainty-bound tăng, quorum mất, range nóng, queue bão hòa và p99 theo shard/khu vực. Dùng retry có giới hạn, admission control và hedging an toàn cho lượt đọc idempotent. Các kiểm soát này mở rộng nguyên tắc tail-tolerance, không mô tả triển khai chính xác của Google.

[ANALYSIS] Thiết kế hấp dẫn khi nghiệp vụ cần một mô hình giao dịch duy nhất xuyên các khu vực. Nó không phải mặc định đúng khi workload chịu được hội tụ bất đồng bộ và phối hợp diện rộng sẽ chi phối ngân sách độ trễ hoặc tính sẵn sàng.

## Original Sources

- Google, *Spanner: Google's Globally Distributed Database*, https://research.google/pubs/spanner-googles-globally-distributed-database/. What information from the source was used: tiêu đề chính xác của ấn phẩm, framing cơ sở dữ liệu phân tán toàn cầu và focus được cung cấp về TrueTime, external consistency, Paxos, sharding và vận hành đa khu vực.
- Google, *The Tail at Scale*, https://research.google/pubs/the-tail-at-scale/. What information from the source was used: ví dụ phản hồi 100 millisecond, dataset nhiều terabyte trải trên hàng nghìn máy chủ, khó khăn kiểm soát tail latency ở quy mô lớn và tail-tolerance như cách giảm tác động và tránh over-provisioning lãng phí.
