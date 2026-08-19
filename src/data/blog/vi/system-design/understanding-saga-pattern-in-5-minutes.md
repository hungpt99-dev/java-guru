---
title: "Saga Pattern: Điều phối workflow phân tán"
description: "Giới thiệu thực tế về Saga transaction trong microservices: thiết kế hướng sự kiện và điều phối, compensation, cùng eventual consistency."
pubDatetime: 2025-09-02T11:59:00+07:00
featured: false
draft: false
tags:
  - saga-pattern
  - system-design
  - microservices
---

Trong monolith, nhiều thay đổi dữ liệu thường có thể dùng chung một database transaction. Trong hệ thống microservices, cùng một nghiệp vụ thường đi qua nhiều service và database. Nếu một service đã commit rồi service khác mới lỗi, không thể xử lý bằng một lần rollback cục bộ duy nhất.

Bài viết này giải thích Saga pattern, sự khác nhau giữa Saga hướng sự kiện và Saga dùng orchestration, cùng các trade-off liên quan đến compensation, partial failure và eventual consistency. Workflow đặt hàng bên dưới là ví dụ minh họa, không phải tuyên bố về một công ty hay hệ thống production cụ thể.

## Bài toán: một workflow, nhiều local transaction

**[SOURCE FACT]** Transaction truyền thống cung cấp các thuộc tính ACID: Atomicity, Consistency, Isolation và Durability. Trong workflow đặt hàng của một monolith, ứng dụng có thể trừ tiền, giữ hoặc trừ tồn kho, và ghi nhận đơn hàng trong cùng một database transaction. Nếu một bước lỗi trước khi commit, transaction có thể rollback.

Với microservices, các trách nhiệm này thường thuộc về những service riêng, mỗi service có database riêng:

- Payment Service charge tiền của khách hàng.
- Inventory Service giữ hoặc trừ tồn kho.
- Notification Service gửi thông báo xác nhận.

**[ANALYSIS]** Đây là các local transaction độc lập. Payment có thể commit trước khi Inventory báo hết hàng. Database rollback ở Inventory không thể hoàn tác payment đã commit, còn retry message không thể lặp lại việc charge một cách an toàn nếu operation không có idempotency, tức là có thể chạy lại với cùng một kết quả.

## Saga giải quyết vấn đề này như thế nào

**[SOURCE FACT]** Saga chia một distributed business transaction thành chuỗi các local transaction. Mỗi bước commit độc lập. Với những bước có thể đảo ngược một cách có ý nghĩa, service cũng cung cấp một compensation action. Nếu bước sau thất bại, workflow chạy các compensation cần thiết cho những bước trước đó đã hoàn tất.

Compensation là một business operation mới, không phải distributed database rollback. Chẳng hạn, refund có thể chạy bất đồng bộ, tạm thời thất bại hoặc cần reconciliation. Vì vậy, mục tiêu của hệ thống là đạt trạng thái hợp lệ theo thời gian, thay vì bảo đảm mọi service cùng thấy một trạng thái nguyên tử ngay lập tức.

**[ANALYSIS]** Xét workflow đặt hàng minh họa sau:

1. Payment Service charge tiền khách hàng: thành công.
2. Inventory Service cố gắng giữ tồn kho: hết hàng.
3. Notification Service chưa được gọi.

Nếu không dùng Saga, payment có thể vẫn ở trạng thái committed dù đơn hàng không thể hoàn tất. Với Saga, lỗi ở bước inventory khiến workflow yêu cầu Payment Service refund. Bước notification được bỏ qua. Kết quả không phải atomic consistency tức thời; đó là một recovery path có kiểm soát, với business outcome rõ ràng.

## Hai cách triển khai

### Event-driven Saga

**[SOURCE FACT]** Trong event-driven Saga, service publish một event sau khi local transaction hoàn tất. Các service khác consume event và bắt đầu công việc của mình. Flow rút gọn:

1. Payment Service charge tiền và publish `PaymentSuccess`.
2. Inventory Service consume event và cố gắng giữ tồn kho.
3. Nếu việc giữ tồn kho thất bại, Inventory Service publish `InventoryFailed`.
4. Payment Service consume event đó và bắt đầu refund.

**[ANALYSIS]** Cách này không cần dedicated central orchestrator và cho phép các service phản ứng với event. Nó phù hợp khi workflow vốn tự nhiên xoay quanh event. Đổi lại, trạng thái workflow bị phân tán: event có thể đến trễ, được giao nhiều lần hoặc được xử lý không đúng thứ tự. Consumer cần idempotency, durable event handling và cách vận hành để kiểm tra workflow.

### Orchestration Saga

**[SOURCE FACT]** Trong orchestration Saga, một orchestrator sở hữu trạng thái workflow và gửi command đến các service tham gia. Flow rút gọn:

1. Orchestrator gửi command cho Payment Service charge tiền: thành công.
2. Orchestrator gửi command cho Inventory Service giữ tồn kho: thất bại.
3. Orchestrator gửi command cho Payment Service refund khoản charge.
4. Orchestrator không gửi command cho Notification Service để gửi xác nhận.

**[ANALYSIS]** Trạng thái workflow tập trung giúp dễ suy luận hơn về các nhánh phức tạp, theo dõi status và thứ tự compensation. Orchestrator cũng là một component mới cần vận hành. Nếu nó unavailable hoặc trở thành bottleneck, tiến độ workflow sẽ bị ảnh hưởng. Đây là vấn đề về availability và capacity, không phải bằng chứng rằng pattern này vốn không an toàn.

## Các điểm cần quyết định khi thiết kế

**[PROPOSED DESIGN]** Với cả hai cách, hãy xác định trước khi triển khai workflow:

- Local transaction do từng service sở hữu.
- Compensation, nếu có, và việc retry compensation có an toàn hay không.
- Idempotency key cho command và event có thể được giao nhiều lần.
- Timeout và retry, gồm cả fallback khi dependency tiếp tục unavailable.
- Các terminal business state như `RefundPending` hoặc `OrderCancelled`, thay vì mặc định rằng mọi lỗi đều có thể che giấu.
- Monitoring cho workflow bị kẹt, compensation thất bại và message mất nhiều thời gian hơn dự kiến để xử lý.

Không nên xem compensation như một nút undo dùng cho mọi trường hợp. Một số action không thể đảo ngược hoàn toàn, và lỗi notification không nhất thiết phải dẫn đến việc hoàn tác payment thành công. Business policy phải quyết định lỗi nào sẽ kích hoạt compensation.

## Các thuật ngữ chính

- **Transaction:** Chuỗi thao tác dữ liệu được bảo vệ bởi các guarantee như ACID. Chuyển tiền ngân hàng là ví dụ phổ biến: nếu debit một tài khoản thành công nhưng credit tài khoản kia thất bại, transaction không nên để lại kết quả dở dang.
- **Distributed transaction:** Business transaction đi qua nhiều service hoặc database. Saga là một cách điều phối transaction đó mà không cần một database transaction duy nhất bao phủ tất cả participant.
- **Saga:** Chuỗi local transaction có cơ chế điều phối và, khi cần, có các compensation action.
- **Compensation:** Operation mới nhằm counteract một business action đã commit, chẳng hạn phát hành refund.
- **Event:** Asynchronous message ghi nhận một việc đã xảy ra, chẳng hạn `PaymentSuccess`.
- **Command:** Message yêu cầu service thực hiện một action, chẳng hạn `ReserveInventory`.
- **Orchestrator:** Component điều phối các bước Saga và theo dõi trạng thái workflow trong kiểu orchestration.
- **Partial failure:** Tình huống một bước thất bại trong khi một bước khác đã commit.
- **Consistency:** Trạng thái tuân thủ các ràng buộc dữ liệu và business rule của hệ thống. Điều này không có nghĩa mọi service luôn quan sát cùng một state tại đúng một thời điểm.
- **Eventual consistency:** Mô hình trong đó các service đã commit độc lập sẽ hội tụ về trạng thái hợp lệ theo thời gian.
- **Idempotency:** Tính chất mà việc lặp lại cùng một request không tạo thêm business effect. Ví dụ, xử lý cùng một payment command hai lần không được charge khách hàng hai lần.

## Tóm tắt

Saga thay một transaction xuyên service bằng các local transaction được điều phối và cơ chế recovery rõ ràng. Event-driven Saga phân tán việc điều phối qua event; orchestration Saga tập trung trạng thái workflow trong orchestrator. Không cách nào loại bỏ partial failure. Thiết kế phải làm rõ retry, idempotency, timeout, compensation và các terminal business state.
