---
title: "Saga Pattern: Khi Lý Thuyết Va Chạm Thực Tế"
description: "Những bài học thực tế khi triển khai Saga Pattern: partial failure, compensate không hoàn hảo, duplicate event và trade-off giữa Orchestration và Choreography."
pubDatetime: 2025-09-02T09:02:00+07:00
featured: true
draft: false
tags:
  - saga-pattern
  - system-design
  - microservices
---

Bạn mở máy, mở IDE, chuẩn bị triển khai flow đặt hàng trong microservices. Trong đầu, bạn vẫn còn hình dung những gì đã đọc về Saga Pattern:

"Ồ, dễ thôi. Mỗi service tự xử lý transaction, lỗi thì rollback bằng compensate. Eventual consistency? Chuyện nhỏ, Saga lo hết."

Nghe thì hay, nghe thì gọn gàng… nhưng khi code thực tế, bạn mới nhận ra mọi thứ không hề trơn tru.

Bạn tưởng tượng flow lý tưởng trong đầu:

- Order Service tạo đơn.
- Payment Service trừ tiền.
- Inventory Service giảm stock.
- Shipping Service tạo shipment.

Trong sách, nếu bước nào fail → compensate → mọi thứ trở về trạng thái ban đầu, hệ thống hoàn hảo. Trong đầu bạn, đó là một vũ điệu trơn tru.

Nhưng thực tế… là một vũ điệu khác hẳn. Một cú network timeout, một duplicate event hay một compensate không hoàn hảo, và vũ điệu ấy nhanh chóng trở thành… cơn ác mộng vận hành.

## 1. Partial Failure – Cú Sốc Đầu Tiên

Bạn tưởng tượng: Payment Service trừ tiền thành công, nhưng Order Service chưa nhận event vì network timeout.

Kết quả? Khách hàng mất tiền, đơn hàng chưa tạo. Bạn thử retry, nhưng mọi thứ tệ hơn: duplicate event → tiền bị trừ hai lần, stock giảm nhầm, shipment đôi.

Partial failure và duplicate event không phải ngoại lệ, mà là thực tế microservices.

Bạn nhận ra: nếu partial failure đã phức tạp, thì rollback và compensate liệu có cứu được tình hình?

## 2. Compensate – Khi Rollback Không Bao Giờ Hoàn Hảo

Sách vở dạy: rollback chỉ cần gọi function compensate → mọi thứ về trạng thái ban đầu.

Thực tế:

- Email đã gửi → không undo được.
- Shipment label đã tạo → không thể hoàn tác.
- Booking bên thứ ba → rollback gần như bất khả.

Ví dụ: một service gửi SMS xác nhận thanh toán. Nếu transaction fail, bạn không thể "thu hồi" SMS đã gửi. Compensate chỉ bù đắp bằng hành động khác, như gửi thông báo hủy hoặc tạo credit.

Saga không phải phép màu. Compensate chỉ gần đúng, đôi khi phải nhờ manual intervention.

Nhưng câu chuyện chưa dừng ở đây. Nếu trạng thái chưa đồng bộ, khách hàng sẽ thấy gì? Đây là lúc bạn phải nghĩ đến Eventual Consistency.

## 3. Eventual Consistency – Trade-Off Không Thể Tránh

Dữ liệu cuối cùng sẽ đồng bộ, nhưng khách hàng có thể thấy: "Đang xử lý", nhưng tiền đã trừ, đơn chưa tạo.

Bạn nhận ra:

- UX phải che giấu trạng thái tạm thời.
- Hệ thống cần giám sát, retry, reconcile.
- Alert phải rõ ràng.

Eventual consistency không miễn phí. Nó yêu cầu bạn chấp nhận rủi ro tạm thời. Nếu không, bạn sẽ nhận hàng loạt support ticket từ khách hàng.

Khi bạn đang tính toán UX, câu hỏi lóe lên: nên quản lý flow bằng một "đạo diễn trung tâm" hay để các service tự xử lý? Đây chính là lúc Orchestration và Choreography xuất hiện.

## 4. Orchestration hay Choreography – Lựa Chọn Đau Đầu

Bạn phải chọn:

| Tiêu chí                | Orchestration                   | Choreography                             |
| ----------------------- | ------------------------------- | ---------------------------------------- |
| Debug & Monitoring      | Dễ track trạng thái Saga        | Khó debug, cần logging chi tiết          |
| Single Point of Failure | Có orchestrator                 | Không SPoF, phân tán                     |
| Duplicate Event         | Dễ kiểm soát                    | Dễ xảy ra, cần idempotency & retry queue |
| Flexibility             | Flow chuẩn, ít linh hoạt        | Linh hoạt khi add/remove service         |
| Deployment & Scaling    | Orchestrator cần scale đặc biệt | Dễ scale từng service                    |

Một ví dụ: bạn muốn thêm service gửi voucher khuyến mãi sau khi đơn hàng hoàn tất.

- Orchestration: update orchestrator flow, dễ kiểm soát.
- Choreography: thêm listener cho event, nhưng phải đảm bảo idempotency và retry queue, dễ lỗi nếu event trễ hoặc duplicate.

Bạn nhận ra: không có lựa chọn hoàn hảo. Debug dễ hay tránh SPoF? Chấp nhận inconsistent tạm thời hay strict consistency? Saga không chỉ là kỹ thuật – là trade-off liên tục.

Và khi bạn cân nhắc, cảnh báo đỏ xuất hiện: không phải lúc nào Saga cũng cứu được tình thế, đặc biệt với các hệ thống yêu cầu strong consistency.

## 5. Saga Không Phải Giải Pháp Cho Mọi Bài Toán

Hãy tưởng tượng: ngân hàng, chuyển tiền giữa hai tài khoản. Bạn quyết định dùng Saga: trừ tiền từ A, cộng tiền vào B, ghi log giao dịch.

Ban đầu bạn tự tin: bước nào fail → compensate → mọi thứ ổn.

Rồi thảm họa xảy ra. Payment Service đã trừ tiền, nhưng Ledger Service chưa nhận event. Khách hàng hoảng, support team bận rộn. Compensate? Không cứu nổi. Chỉ còn manual intervention.

Lúc này, bạn mới hiểu: Saga không phù hợp với giao dịch ngân hàng. Một giải pháp an toàn hơn: 2-Phase Commit (2PC).

- 2PC đảm bảo strong consistency: commit đồng bộ, fail → rollback ngay.
- Tránh partial failure nguy hiểm: khách hàng không thấy số dư tạm thời sai lệch.
- Integrity tuyệt đối: giao dịch quan trọng luôn chính xác.

Bài học: chọn công cụ sai, microservices có thể biến thành cơn ác mộng vận hành, dù bạn chỉ muốn "áp dụng kỹ thuật cho đẹp mắt".

## 6. Bài Học Thực Tế Khi Áp Dụng Saga

Sau tất cả cú sốc từ partial failure, compensate gần đúng, duplicate event và lựa chọn mô hình, bạn bắt đầu rút ra những bài học "thấm thía".

Bạn nhớ lại lần đầu deploy Saga: event bị trễ, compensate gọi sai thứ tự, khách hàng gọi support liên tục. Khi đó, bạn mới hiểu:

- Retry không kiểm soát = thảm họa. Idempotency là bắt buộc.
- Compensate không cứu tất cả. Nó chỉ giảm rủi ro, đôi khi bạn vẫn cần can thiệp tay.
- Khách hàng nhìn thấy trạng thái tạm thời chưa đồng bộ? UX phải khéo, alert phải rõ ràng, reconcile luôn sẵn sàng.
- Mô hình triển khai không có lựa chọn hoàn hảo. Orchestration dễ debug nhưng SPoF; Choreography phân tán nhưng khó trace. Chọn flow phù hợp, không phải chọn theo cảm hứng.
- Saga không dành cho mọi hệ thống. Nếu nghiệp vụ đòi hỏi strong consistency – ví dụ ngân hàng – 2PC hay transaction đồng bộ vẫn là lựa chọn an toàn hơn.

Nhìn lại, bạn nhận ra: Saga không phải phép màu, mà là công cụ tinh tế. Áp dụng đúng chỗ → giảm rủi ro, linh hoạt. Áp dụng sai → cơn ác mộng vận hành.

Điều quan trọng nhất: đừng áp dụng vì nó "ngầu", hãy áp dụng vì nó thực sự phù hợp với nghiệp vụ của bạn.

## Kết Luận

Saga Pattern là công cụ tuyệt vời cho distributed transaction phức tạp, nhưng không phải giải pháp cho mọi bài toán.

Điểm cần nhớ:

- Hiểu trade-off và edge case.
- Chuẩn bị monitoring, alert, retry, reconcile, và cả manual intervention.
- Lựa chọn giữa Orchestration và Choreography dựa trên flow, debug, SPoF.
- Đánh giá đặc thù hệ thống trước khi triển khai Saga, tránh môi trường đòi hỏi strong consistency, nơi 2PC hoặc transaction đồng bộ khác sẽ phù hợp hơn.

Sau khi đọc xong, bạn sẽ tự hỏi:

"Liệu nghiệp vụ này có thực sự cần Saga, hay tôi chỉ tạo thêm phức tạp cho bản thân?"

Hiểu rõ điều này, bạn sẽ triển khai Saga an toàn, linh hoạt, hiệu quả, thay vì bị cuốn vào cơn ác mộng vận hành hoàn toàn có thể tránh được.
