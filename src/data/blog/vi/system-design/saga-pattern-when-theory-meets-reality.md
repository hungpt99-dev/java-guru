---
title: "Saga Pattern: Các dạng lỗi, đánh đổi và lựa chọn thiết kế"
description: "Phân tích thực tế về Saga transaction: partial failure, compensation, duplicate event, eventual consistency và đánh đổi giữa orchestration và choreography."
pubDatetime: 2025-09-02T09:02:00+07:00
featured: true
draft: false
tags:
  - saga-pattern
  - system-design
  - microservices
---

Saga Pattern thường được giới thiệu như một lời giải đơn giản cho distributed transaction: mỗi service commit local transaction của mình, rồi khi có lỗi thì chạy các compensation action. Mô tả đó hữu ích nhưng chưa đầy đủ. Saga không cung cấp distributed rollback. Nó điều phối một chuỗi local commit và định nghĩa cách hệ thống phục hồi khi chuỗi đó không thể hoàn tất.

Hãy xét một order flow:

- Order Service tạo order.
- Payment Service charge tiền của khách hàng.
- Inventory Service reserve hoặc giảm tồn kho.
- Shipping Service tạo shipment.

Phần khó không nằm ở happy path. Vấn đề nằm ở timeout, duplicate delivery, các service phục hồi ở những thời điểm khác nhau và các side effect không thể undo. Bài viết này phân tích các dạng lỗi đó, giới hạn của compensation, eventual consistency, orchestration so với choreography, và những trường hợp Saga không phải công cụ phù hợp.

## 1. Partial Failure Là Dạng Lỗi Bình Thường

**[SOURCE FACT]** Một distributed workflow có thể hoàn tất local transaction ở một service trong khi service khác không nhận được event tương ứng. Ví dụ, Payment Service có thể đã charge tiền nhưng Order Service không nhận được message do network timeout.

Hệ thống lúc này rơi vào trạng thái không rõ ràng. Khoản charge có thể đã thành công dù caller nhận timeout. Nếu retry mà không có định danh rõ ràng cho operation, khách hàng có thể bị charge lần nữa. Cùng loại vấn đề này cũng có thể tạo ra thay đổi tồn kho hoặc shipment bị duplicate.

**[ANALYSIS]** Timeout không cho caller biết operation đã thất bại hay chưa. Nó chỉ cho biết kết quả chưa được xác nhận trong khoảng timeout. Vì vậy workflow cần phân biệt operation mới với retry của một operation có thể đã thành công.

**[PROPOSED DESIGN]** Gán cho mỗi business operation một idempotency key ổn định (key dùng để nhận diện request lặp lại). Mỗi consumer nên lưu key và kết quả đã xử lý, sau đó trả lại kết quả đã lưu khi cùng operation được deliver lần nữa. Retry policy cũng cần giới hạn rõ ràng và có đường chuyển sang retry queue hoặc manual review. Khi message hoặc request có thể bị retry, idempotency là bắt buộc.

## 2. Compensation Không Phải Rollback

**[SOURCE FACT]** Database rollback có thể undo công việc bên trong một local transaction. Nó không thể đáng tin cậy undo một external side effect đã xảy ra.

Ví dụ:

- SMS hoặc email đã được gửi.
- Shipping label đã được tạo.
- Third-party booking đã được chấp nhận.

Compensating action tương ứng có thể là cancellation message, refund, credit hoặc request hủy booking ở hệ thống bên ngoài. Những action này thay đổi business state; chúng không đưa thế giới về chính xác trạng thái trước đó.

**[ANALYSIS]** Compensation vì vậy là một application-level recovery action. Nó có thể không đầy đủ, bị trì hoãn, bị dependency từ chối hoặc cần quyết định của con người. Saga nên biểu diễn rõ các kết quả này thay vì xem compensation là một cam kết tự động về correctness.

**[PROPOSED DESIGN]** Định nghĩa compensation policy cho mọi step có external side effect. Lưu Saga state và outcome của từng step. Làm cho compensation có thể retry và idempotent nếu có thể, đồng thời đưa các trường hợp chưa xử lý xong cho đội vận hành. Ví dụ, payment confirmation không thể thu hồi có thể cần cancellation notice hoặc credit thay vì cố recall message ban đầu.

## 3. Eventual Consistency Có Chi Phí Đối Với Sản Phẩm

**[SOURCE FACT]** Trong Saga, các service commit độc lập. Vì vậy view của chúng về workflow có thể khác nhau trong một khoảng thời gian. Khách hàng có thể thấy `Processing` sau khi payment đã được chấp nhận nhưng trước khi order được tạo hoặc event tiếp theo được xử lý.

**[ANALYSIS]** Eventual consistency không chỉ là thuộc tính của storage. Nó ảnh hưởng đến user experience, customer support và vận hành. Status page hiển thị `Completed` trước khi tất cả step bắt buộc hoàn tất là gây hiểu nhầm. Nhưng chỉ hiển thị `Processing` mà không có recovery path cũng chưa đủ.

**[PROPOSED DESIGN]** Xem intermediate state là một phần của product contract. Hiển thị status trung thực, định nghĩa điều gì xảy ra khi một step bị trì hoãn, và đưa ra kết quả rõ ràng khi Saga thất bại hoặc cần review. Monitor event age, failed step, compensation attempt và Saga chưa được giải quyết. Reconciliation nên so sánh state ở các service tham gia và xác định các trường hợp cần sửa.

## 4. Orchestration Và Choreography

Orchestration dùng một coordinator để gửi command và theo dõi workflow. Choreography để các service phản ứng với event và tự quyết định action tiếp theo. Không mô hình nào loại bỏ các dạng lỗi nền tảng.

| Tiêu chí | Orchestration | Choreography |
| --- | --- | --- |
| Debugging và monitoring | Saga state tập trung, dễ kiểm tra hơn | Cần correlation và event logging nhất quán ở nhiều service |
| Tập trung rủi ro lỗi | Orchestrator là một dependency bổ sung, cần được đảm bảo high availability | Không có coordinator trung tâm, nhưng trách nhiệm được phân tán giữa các service |
| Duplicate event | Có thể tập trung retry và state transition tại coordinator | Mỗi consumer phải tự xử lý idempotency và failure handling |
| Quản lý thay đổi | Workflow rõ ràng, nhưng coordinator thay đổi khi flow thay đổi | Có thể thêm event consumer vào service, nhưng event contract và interaction khó phân tích hơn |
| Scaling | Cần lập kế hoạch capacity và availability riêng cho coordinator | Có thể scale độc lập từng consumer |

**[ANALYSIS]** Nói choreography "không có single point of failure" là quá rộng. Nó loại bỏ một coordinator trung tâm, chứ không loại bỏ nhu cầu về broker, consumer, observability hoặc recovery procedure đáng tin cậy. Tương tự, orchestration không tự làm workflow đúng; nó chỉ khiến control flow rõ ràng hơn.

Giả sử business thêm một service cấp promotional voucher sau khi order hoàn tất. Trong thiết kế orchestrated, coordinator được cập nhật để thêm step hoặc branch mới. Trong thiết kế choreographed, voucher service consume event `order-completed`. Cách thứ hai có thể giảm thay đổi ở các service hiện có, nhưng consumer vẫn cần idempotency, retry policy và behavior rõ ràng cho event bị trì hoãn hoặc duplicate.

**[PROPOSED DESIGN]** Chọn mô hình dựa trên ownership, độ phức tạp của workflow, observability và failure handling. Dù chọn mô hình nào, hãy truyền correlation identifier, làm cho state transition có thể kiểm tra, đồng thời document event contract và retry behavior.

## 5. Khi Saga Không Phải Công Cụ Phù Hợp

**[SOURCE FACT]** Một số business operation cần strong consistency boundary. Chuyển tiền giữa hai account là ví dụ điển hình: debit một account và credit account còn lại không được để balance ở trạng thái không rõ ràng.

**[ANALYSIS]** Saga có thể định nghĩa một credit để bù sau khi debit, nhưng khoảng thời gian giữa hai action là một rủi ro nghiệp vụ thực sự. Nếu credit event bị mất, bị trì hoãn hoặc bị từ chối, hệ thống cần phát hiện và phục hồi. Điều đó có thể chấp nhận được với một số workflow, nhưng không phải lựa chọn mặc định tốt cho operation có invariant yêu cầu một quyết định atomic.

Two-Phase Commit (2PC) là một alternative có thể dùng khi các resource tham gia hỗ trợ nó và chi phí coordination, availability là chấp nhận được. 2PC điều phối prepare và commit phase để các participant thống nhất transaction outcome. Đây không phải lời giải cho mọi trường hợp: nó có các đánh đổi riêng về vận hành và hiệu năng, đồng thời không phải service hoặc external dependency nào cũng tham gia được.

**[PROPOSED DESIGN]** Bắt đầu từ business invariant, không bắt đầu từ pattern. Nếu temporary inconsistency và compensation có thể chấp nhận, Saga có thể phù hợp. Nếu operation cần atomic boundary, hãy ưu tiên thiết kế cung cấp boundary đó, chẳng hạn local transaction, synchronous coordination hoặc 2PC khi phù hợp. Không nên đưa Saga vào chỉ vì hệ thống dùng microservices.

## 6. Yêu Cầu Vận Hành

Độ tin cậy của pattern chỉ cao bằng failure handling của nó. Trước khi áp dụng, cần quyết định rõ:

- Định nghĩa idempotency key và cách deduplicate cho mỗi command và event có thể retry.
- Đặc tả timeout, retry và backoff behavior. Retry loop không kiểm soát có thể khuếch đại một outage.
- Persist Saga state và step outcome để operator kiểm tra được chuyện gì đã xảy ra.
- Định nghĩa compensation cho từng step, bao gồm cả step không thể reverse.
- Chuyển retry đã hết giới hạn và compensation chưa giải quyết sang một recovery process có kiểm soát.
- Hiển thị intermediate status cho user mà không ngụ ý workflow đã hoàn tất.
- Implement monitoring và reconciliation cho state bị trì hoãn, thất bại hoặc divergent.

Đây là design requirement, không phải implementation detail có thể bổ sung sau incident đầu tiên. Workflow chỉ mô tả happy path thì chưa phải một Saga design hoàn chỉnh.

## Kết Luận

Saga là coordination pattern cho workflow trải qua các local transaction độc lập. Nó xử lý partial failure bằng cách kết hợp forward action với compensating action, nhưng không cung cấp rollback hoàn hảo và cũng không loại bỏ inconsistency.

Hãy dùng Saga khi business chấp nhận intermediate state và có recovery model đáng tin cậy. Làm retry idempotent, làm state observable, thiết kế compensation như một business action rõ ràng và luôn có reconciliation. Dùng orchestration khi explicit central control hữu ích, hoặc choreography khi các service phản ứng độc lập phù hợp hơn, đồng thời chấp nhận chi phí observability và coordination của mỗi lựa chọn.

Với operation cần atomic consistency boundary, hãy chọn cơ chế được thiết kế cho yêu cầu đó. Câu hỏi hữu ích không phải Saga có đang phổ biến hay không, mà là failure model của nó có phù hợp với business invariant hay không.
