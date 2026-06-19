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

Bạn mở máy, mở IDE, chuẩn bị triển khai flow đặt hàng trong microservices. Trong đầu, bạn vẫn còn hình dung những gì đã đọc về Saga Pattern: "Ồ, dễ thôi. Mỗi service tự xử lý transaction, lỗi thì rollback bằng compensate."

Nghe thì hay, nghe thì gọn gàng… nhưng khi code thực tế, bạn mới nhận ra mọi thứ không hề trơn tru.

## 1. Partial Failure – Cú Sốc Đầu Tiên

Bạn tưởng tượng: Payment Service trừ tiền thành công, nhưng Order Service chưa nhận event vì network timeout. Kết quả? Khách hàng mất tiền, đơn hàng chưa tạo. Bạn thử retry, nhưng mọi thứ tệ hơn: duplicate event → tiền bị trừ hai lần.

Partial failure và duplicate event không phải ngoại lệ, mà là thực tế microservices.

## 2. Compensate – Khi Rollback Không Bao Giờ Hoàn Hảo

Sách vở dạy: rollback chỉ cần gọi function compensate → mọi thứ về trạng thái ban đầu. Thực tế:

- Email đã gửi → không undo được
- Shipment label đã tạo → không thể hoàn tác
- Booking bên thứ ba → rollback gần như bất khả

Saga không phải phép màu. Compensate chỉ gần đúng, đôi khi phải nhờ manual intervention.

## 3. Eventual Consistency – Trade-Off Không Thể Tránh

Dữ liệu cuối cùng sẽ đồng bộ, nhưng khách hàng có thể thấy: "Đang xử lý", nhưng tiền đã trừ, đơn chưa tạo. UX phải che giấu trạng thái tạm thời. Hệ thống cần giám sát, retry, reconcile.

## 4. Orchestration hay Choreography – Lựa Chọn Đau Đầu

| Tiêu chí                | Orchestration            | Choreography |
| ----------------------- | ------------------------ | ------------ |
| Debug & Monitoring      | Dễ track trạng thái      | Khó debug    |
| Single Point of Failure | Có orchestrator          | Không SPoF   |
| Duplicate Event         | Dễ kiểm soát             | Dễ xảy ra    |
| Flexibility             | Flow chuẩn, ít linh hoạt | Linh hoạt    |

## 5. Saga Không Phải Giải Pháp Cho Mọi Bài Toán

Hãy tưởng tượng: ngân hàng, chuyển tiền giữa hai tài khoản. Bạn quyết định dùng Saga. Payment Service đã trừ tiền, nhưng Ledger Service chưa nhận event. Khách hàng hoảng, support team bận rộn. Saga không phù hợp với giao dịch ngân hàng. Một giải pháp an toàn hơn: 2-Phase Commit (2PC).

## 6. Bài Học Thực Tế

- Retry không kiểm soát = thảm họa. Idempotency là bắt buộc
- Compensate không cứu tất cả. Nó chỉ giảm rủi ro
- Khách hàng nhìn thấy trạng thái tạm thời chưa đồng bộ? UX phải khéo
- Saga không dành cho mọi hệ thống. Nếu nghiệp vụ đòi hỏi strong consistency, 2PC vẫn là lựa chọn an toàn hơn

## Kết Luận

Saga Pattern là công cụ tuyệt vời cho distributed transaction phức tạp, nhưng không phải giải pháp cho mọi bài toán. Đừng áp dụng vì nó "ngầu", hãy áp dụng vì nó thực sự phù hợp với nghiệp vụ của bạn.
