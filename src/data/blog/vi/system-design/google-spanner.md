---
title: "Spanner: Phân tán toàn cầu, external consistency và TrueTime"
description: "Phân tích thiết kế hệ thống có kỷ luật nguồn về external consistency, bất định thời gian, nhân bản kiểu Paxos, phân mảnh và vận hành đa khu vực."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Bài toán kỹ thuật

[SOURCE FACT] Trang Google Research được phép sử dụng có tiêu đề *Spanner: Google's Globally Distributed Database* và xác định công trình là một ấn phẩm trên ACM Transactions on Computer Systems. [Nguồn: https://research.google/pubs/spanner-googles-globally-distributed-database/]

[ANALYSIS] Bài toán không chỉ là lưu các hàng dữ liệu ở nhiều hơn một trung tâm dữ liệu. Một cơ sở dữ liệu phân tán toàn cầu phải kết hợp giao dịch trên nhiều máy, khả năng chịu lỗi khu vực, phân mảnh ngang và một thứ tự mà client có thể tin cậy. Độ trễ mạng, clock skew (lệch đồng hồ), network partition (phân hoạch mạng), mất replica và hot key khiến các yêu cầu này tác động lẫn nhau.

[SOURCE FACT] Nguồn bổ trợ *Tail at Scale* nói rằng các dịch vụ trực tuyến lớn có thể truy vấn các tập dữ liệu nhiều terabyte trải trên hàng nghìn máy chủ. Nguồn cũng lưu ý rằng việc giữ tail latency (độ trễ đuôi) thấp trở nên khó hơn khi quy mô hoặc mức sử dụng tăng. Mục tiêu được nêu là tạo ra một dịch vụ có khả năng phản hồi dự đoán được từ các thành phần kém dự đoán hơn. [Nguồn: https://research.google/pubs/the-tail-at-scale/]

[ANALYSIS] Trong cơ sở dữ liệu giao dịch phân tán toàn cầu, tail latency ảnh hưởng đến nhiều hơn các lượt đọc mà người dùng nhìn thấy. Commit liên khu vực cần phối hợp, bất định của đồng hồ có thể trì hoãn thời điểm an toàn để công bố kết quả, còn replica lỗi có thể buộc hệ thống đi theo đường quorum chậm hơn. Vì vậy, thiết kế cần quy tắc đúng đắn rõ ràng và các biện pháp ngăn một thành phần chậm biến thành vấn đề độ trễ toàn hệ thống.

## 2. Phần có cơ sở từ nguồn

[SOURCE FACT] Nguồn Spanner và phạm vi nghiên cứu được cung cấp đề cập đến phân tán toàn cầu, TrueTime, external consistency, Paxos, sharding và vận hành đa khu vực. Bài viết xem đây là các chủ đề từ nguồn. Bài viết không suy ra topology triển khai không được nêu, cũng không khẳng định ranh giới module đề xuất trùng với cách Google triển khai. [Nguồn: https://research.google/pubs/spanner-googles-globally-distributed-database/]

[ANALYSIS] Ý tưởng thiết kế cốt lõi là đưa bất định thời gian vào xử lý giao dịch. Một lần đọc thời gian được biểu diễn bằng cận sớm nhất và cận muộn nhất, thay vì một thời điểm chính xác duy nhất. Giao dịch chỉ nhận commit timestamp khi hệ thống có thể xác lập rằng timestamp đó được sắp thứ tự an toàn so với các giao dịch liên quan. Cơ sở dữ liệu chấp nhận một khoảng chờ có giới hạn để đạt được bảo đảm thứ tự mạnh hơn.

[ANALYSIS] Paxos là primitive nhân bản phù hợp với mô hình này: một shard có thể duy trì replicated log, trong đó quorum chọn trạng thái bền vững tiếp theo. Sharding giữ các dải khóa không liên quan độc lập. Giao dịch đi qua nhiều dải cần phối hợp giữa các shard leader hoặc replica group liên quan. Đặt replica ở nhiều khu vực có thể cải thiện khả năng chịu lỗi và tính địa phương, nhưng phối hợp liên khu vực vẫn có chi phí về độ trễ và tính sẵn sàng.

[ANALYSIS] External consistency mạnh hơn eventual convergence (hội tụ cuối cùng). Nếu giao dịch A commit trước khi giao dịch B bắt đầu, cơ sở dữ liệu không được về sau công bố thứ tự trong đó B đứng trước A. Bảo đảm này nói về thứ tự serialization mà client quan sát; retry, kết quả không xác định và thay đổi leader vẫn là các vấn đề triển khai phải xử lý.

## 3. Sơ đồ kiến trúc

Sơ đồ dưới đây tách các khái niệm có cơ sở từ nguồn khỏi cách phân rã được đề xuất để thảo luận. Đây không phải khẳng định Google dùng đúng các tên component hoặc interface này.

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

[SOURCE FACT] Các nhãn “TrueTime,” “Paxos,” sharding và vận hành đa khu vực dựa trên mô tả nguồn Spanner được cung cấp. [Nguồn: https://research.google/pubs/spanner-googles-globally-distributed-database/]

[PROPOSED DESIGN] Gateway, shard directory, transaction coordinator và các biện pháp observability (quan sát hệ thống) là cách phân rã thực tế để thảo luận ownership và failure boundary. Chúng không được trình bày như tên module chính xác của bài báo gốc.

## 4. Đường đi của giao dịch

[ANALYSIS] Giao dịch trước hết ánh xạ các key tới shard. Một thao tác trên một shard có thể nằm trong một replica group. Giao dịch nhiều shard cần participant preparation (chuẩn bị participant), commit timestamp an toàn trên toàn cục và decision record bền vững. Decision phải khôi phục được: sau khi coordinator lỗi, participant cần có cách xác định nên commit, abort hay chờ kết quả giải quyết.

[ANALYSIS] TrueTime thay đổi đường đi commit theo cách cụ thể. Gọi khoảng bất định là `[earliest, latest]`. Timestamp được chọn tại `latest` chưa tự động an toàn chỉ vì clock cục bộ trả về giá trị đó. Coordinator phải chờ đến khi khoảng bất định đã trôi qua trước khi công bố kết quả mà thứ tự theo thời gian thực có ý nghĩa. Việc chờ bảo vệ external consistency, nhưng chỉ nên tính vào chi phí ở nơi cần bảo đảm đó.

[ANALYSIS] Paxos replication và time ordering giải quyết hai vấn đề khác nhau. Paxos xác lập giá trị nào bền vững trong một replica group; tự nó không định nghĩa thứ tự thời gian thực toàn cục của giao dịch. Time API không nhân bản dữ liệu. Khi kết hợp, replicated log cung cấp durable agreement (đồng thuận bền vững), còn bất định thời gian có giới hạn cung cấp quy tắc sắp thứ tự commit.

[SOURCE FACT] Nguồn *Tail at Scale* mô tả các đợt độ trễ cao tạm thời ngày càng quan trọng ở quy mô lớn và bàn về các kỹ thuật giảm tác động của chúng, trong đó có việc tận dụng tài nguyên vốn đã được triển khai cho khả năng chịu lỗi. [Nguồn: https://research.google/pubs/the-tail-at-scale/]

[ANALYSIS] Trong bối cảnh này, có thể cân nhắc hedged read (đọc dự phòng) tới các replica an toàn, deadline propagation (truyền deadline), admission control và cô lập shard quá tải. Hedging không được nhân đôi một write không idempotent. Read có thể dùng response chấp nhận được đầu tiên; write phải nằm trong transaction protocol và dùng retry token hoặc cơ chế idempotency tương đương.

## 5. Data model đề xuất

[PROPOSED DESIGN] Dùng schema quan hệ với key tenant và entity rõ ràng. Đặt các cột key đầu tiên theo thứ tự phù hợp với access path chính. Nếu các row liên quan phải tham gia cùng một thao tác atomic, hãy chọn key và locality có chủ đích; schema cụ thể phụ thuộc workload và không được các nguồn trích dẫn quy định.

```sql
CREATE TABLE Accounts (
  TenantId   STRING(MAX) NOT NULL,
  AccountId  STRING(MAX) NOT NULL,
  Balance    INT64 NOT NULL
) PRIMARY KEY (TenantId, AccountId);
```

[ANALYSIS] Key bắt đầu bằng tenant có thể giúp các row của một tenant được truy cập như một range, nhưng cũng có thể dồn tải khi một tenant hoạt động bất thường. Đây là trade-off theo workload, không phải quy tắc luôn đúng. Schema quan hệ không loại bỏ nhu cầu xử lý partition size, hot key hay transaction scope.

## 6. Xử lý lỗi

[ANALYSIS] Các trường hợp chính gồm timeout phối hợp, mất leader, replica không khả dụng, network partition và client retry sau response không xác định. Timeout không chứng minh transaction đã abort. Client phải retry với idempotency key hoặc truy vấn transaction status, thay vì mù quáng phát hành một logical write thứ hai.

[PROPOSED DESIGN] Xác định hành vi rõ ràng ở từng ranh giới:

- **Timeout:** dừng chờ khi hết deadline và trả về kết quả phân biệt timeout với abort đã được xác nhận.
- **Retry:** chỉ retry thao tác có hiệu ứng được bảo vệ bởi transaction identity hoặc idempotency.
- **Fallback:** chỉ route read tới replica được phép khi consistency contract cho phép; không âm thầm hạ mức consistency.
- **Circuit breaker:** ngừng gửi traffic tới dependency rõ ràng không lành mạnh, đồng thời tách recovery probe khỏi traffic thông thường.
- **Backpressure:** giới hạn queue và từ chối hoặc trì hoãn công việc trước khi shard quá tải chiếm hết capacity của connection pool hoặc worker.

[ANALYSIS] Các biện pháp này giúp cô lập lỗi, nhưng không thay thế quorum agreement hay transaction recovery. Đặc biệt, fallback trả về dữ liệu cũ là thay đổi về semantics và phải được thể hiện trong API contract.

## 7. Consistency, độ trễ và tính sẵn sàng

[ANALYSIS] Thứ tự mạnh hơn có chi phí. Công việc liên shard và liên khu vực cần phối hợp; chờ hết bất định thời gian làm tăng commit latency; mất quorum có thể ngăn hệ thống tiến triển dù vẫn còn một số replica truy cập được. Khi review thiết kế, cần nói rõ thao tác nào yêu cầu external consistency và thao tác nào có thể dùng read contract yếu hơn.

[PROPOSED DESIGN] Làm contract rõ ngay tại API boundary:

- Read khai báo consistency cần thiết và deadline.
- Write mang idempotency token và transaction identity.
- Retry giữ nguyên identity đó thay vì tạo logical write mới.
- Metric tách storage latency, coordination latency, time-wait latency, retry rate và tail latency.

[ANALYSIS] Cách tách này giúp đo trade-off mà không giả định timeout, retry hay đọc từ replica là cơ chế bảo đảm đúng đắn. Tính đúng đắn đến từ transaction protocol và replication protocol; các biện pháp vận hành giới hạn chi phí của lỗi và quá tải.

## 8. Checklist review

[PROPOSED DESIGN] Khi triển khai hoặc trình bày system design, hãy hỏi:

- Key nào được ánh xạ tới shard nào, và điều gì ngăn hot key áp đảo một shard?
- Transaction nào là single-shard, transaction nào cần phối hợp?
- Client làm gì sau timeout khi chưa biết kết quả commit?
- Replica read nào được phép, với consistency contract nào?
- Điều gì xảy ra khi leader hoặc quorum không khả dụng?
- Deadline, retry, queue limit và connection pool được giới hạn ra sao?
- Metric nào cho thấy coordination hoặc time uncertainty, thay vì storage, đang chi phối latency?

## 9. Kết luận

[ANALYSIS] Bài học hữu ích là tách các trách nhiệm:

- Sharding phân chia dữ liệu và traffic.
- Paxos-style replication cung cấp durable agreement trong một replica group.
- Time uncertainty hỗ trợ quy tắc sắp thứ tự commit.
- Transaction coordination kết nối công việc trên nhiều shard.
- Đặt replica đa khu vực cải thiện resilience và locality nhưng tạo thêm chi phí phối hợp.
- Timeout, retry, fallback, circuit breaker và backpressure giới hạn tác động vận hành của lỗi; chúng không định nghĩa consistency.

[SOURCE FACT] Các nguồn được trích dẫn hỗ trợ phạm vi bài viết về Spanner phân tán toàn cầu, TrueTime, external consistency, Paxos, sharding, vận hành đa khu vực và tail latency. [Nguồn: https://research.google/pubs/spanner-googles-globally-distributed-database/] [Nguồn: https://research.google/pubs/the-tail-at-scale/]

[ANALYSIS] Cách phân rã component và ví dụ data model là đề xuất để suy luận về hệ thống. Không nên đọc chúng như các khẳng định không có nguồn về deployment nội bộ của Google.
