---
title: "Hiểu Saga Pattern trong 5 phút"
description: "Nếu bạn mới tìm hiểu microservices, chắc hẳn bạn đã nghe đến Saga Pattern – một design pattern quản lý distributed transaction trong microservices."
pubDatetime: 2025-09-02T18:59:56+07:00
modDatetime: null
category: "Microservices"
tags: ["saga pattern", "System Design"]
lang: "vi"
featured: true
draft: false
readingTime: 9
coverImage: "../../assets/articles/hieu-saga-pattern-trong-5-phut/cover.png"
series: null
sourceUrl: "https://viblo.asia/p/hieu-saga-pattern-trong-5-phut-XRJ8RlG8VGq"
sourceReleasedAt: "2025-09-02T11:59:56.000000Z"
sourceUpdatedAt: "2026-11-07T05:34:01.000000Z"
sourceTags: ["saga pattern", "System Design"]
---

Nếu bạn mới tìm hiểu **microservices**, chắc hẳn bạn đã nghe đến **Saga Pattern** – một **design pattern quản lý distributed transaction trong microservices**. Nó giúp các service phối hợp nhịp nhàng, giữ dữ liệu đồng bộ và duy trì **tính nhất quán cuối cùng (eventual consistency)** ngay cả khi một service gặp sự cố. Bài viết này sẽ giúp bạn **hiểu Saga Pattern nhanh chóng**, với ví dụ trực quan và các khái niệm kỹ thuật cơ bản.

---

## **1. Bối cảnh và vấn đề**

Trong các hệ thống **truyền thống (monolithic)**, bạn có thể dùng **transaction** để đảm bảo dữ liệu luôn nhất quán:

* Nếu tất cả các bước thành công → **commit**
* Nếu có bước nào thất bại → **rollback**

**Ví dụ đặt hàng trong hệ thống monolithic:**

1. Trừ tiền khách hàng
2. Trừ tồn kho sản phẩm
3. Gửi email xác nhận

Tất cả nằm trong **một transaction**, nên nếu bước nào lỗi → rollback toàn bộ, dữ liệu vẫn **nhất quán**.

Tuy nhiên, với **microservices**, mỗi bước thường do **service riêng** quản lý, với **cơ sở dữ liệu riêng**:

* **Payment Service:** trừ tiền
* **Inventory Service:** trừ tồn kho
* **Notification Service:** gửi email

Nếu một bước thất bại, các bước trước có thể đã **commit**, dẫn đến **dữ liệu không đồng bộ**.

Ví dụ: khách hàng bị trừ tiền nhưng **hàng không còn**, hoặc email xác nhận chưa gửi.

Đây là **vấn đề mà Saga Pattern giải quyết**: giúp các service trong microservices **phối hợp nhịp nhàng** và **duy trì dữ liệu đồng bộ ngay cả khi có lỗi xảy ra**.

---

## **2. Saga Pattern là gì?**

**Saga Pattern** là **một design pattern quản lý distributed transaction trong microservices**.

Thay vì dùng **transaction truyền thống** (rollback toàn bộ nếu một bước lỗi), **mỗi service tự quản lý transaction riêng**, và nếu bước sau thất bại, hệ thống sẽ thực hiện **bù đắp (compensation)** cho các bước trước.

**Ví dụ đặt hàng online:**

1. **Payment Service:** trừ tiền → thành công
2. **Inventory Service:** trừ tồn kho → lỗi (hết hàng)
3. **Notification Service:** gửi email → chưa thực hiện

* **Không dùng Saga Pattern:** Payment Service đã trừ tiền → khách hàng mất tiền nhưng không có hàng
* **Dùng Saga Pattern:** Inventory Service lỗi → Payment Service **hoàn tiền**, Email chưa gửi → tránh nhầm lẫn

> Ý tưởng cốt lõi: Mỗi bước **tự chịu trách nhiệm** và có cơ chế **compensation**, giúp các thao tác trong **distributed transaction** phối hợp mà không phá vỡ toàn bộ hệ thống.

---

## **3. Hai cách triển khai Saga Pattern**

### **3.1 Event-Driven Saga (Dựa trên sự kiện)**

* Mỗi bước **gửi thông điệp (event)** khi hoàn thành hoặc thất bại
* Bước tiếp theo **lắng nghe event** để quyết định thực hiện hay bù đắp

**Ví dụ:**

1. Payment Service trừ tiền → gửi event "PaymentSuccess"
2. Inventory Service nghe event → tiến hành trừ tồn kho
3. Nếu Inventory Service thất bại → gửi event "InventoryFailed"
4. Payment Service nghe event → thực hiện **hoàn tiền**

**Ưu điểm:**

* Không cần orchestrator tập trung, các service **tự quản lý và phối hợp linh hoạt**
* Dễ mở rộng khi thêm service mới vào quy trình

**Nhược điểm:**

* Khó theo dõi trạng thái tổng thể của transaction
* Dễ xảy ra **duplicate event** hoặc **trễ event**, cần cơ chế **idempotency**

---

### **3.2 Orchestration Saga (Điều phối tập trung)**

* Một **orchestrator** trung tâm **điều phối các bước**
* Khi bước nào thất bại, orchestrator ra lệnh **rollback các bước trước đó**

**Ví dụ:**

1. Orchestrator ra lệnh Payment Service trừ tiền → thành công
2. Orchestrator ra lệnh Inventory Service trừ tồn kho → thất bại
3. Orchestrator ra lệnh Payment Service **hoàn tiền**
4. Notification Service không thực hiện gửi email

**Ưu điểm:**

* Dễ quản lý các quy trình phức tạp, kiểm soát trạng thái tập trung
* Theo dõi dễ dàng và giảm rủi ro **duplicate hoặc missing event**

**Nhược điểm:**

* Orchestrator trở thành **điểm tập trung**, nếu lỗi hoặc nghẽn → ảnh hưởng toàn bộ transaction
* Cần thêm thành phần trung tâm → tăng độ phức tạp triển khai

---

## **4. Ví dụ minh họa: đặt hàng online**

Giả sử quy trình đặt hàng gồm 3 bước:

1. **Payment Service:** trừ tiền khách hàng → thành công
2. **Inventory Service:** trừ tồn kho → lỗi (hết hàng)
3. **Notification Service:** gửi email → chưa thực hiện

**Không dùng Saga Pattern:**

* Payment Service đã trừ tiền → khách hàng mất tiền nhưng không có hàng
* Inventory Service lỗi → dữ liệu không đồng bộ

**Dùng Saga Pattern (Event-Driven hoặc Orchestration):**

* Inventory Service lỗi → Payment Service **hoàn tiền**
* Email chưa gửi → tránh nhầm lẫn
* Quy trình **nhất quán**, trải nghiệm khách hàng tốt

> Saga Pattern giúp **từng thao tác trong distributed transaction độc lập** nhưng vẫn phối hợp hiệu quả, đảm bảo **dữ liệu đồng bộ và trải nghiệm người dùng tốt**.

---

## **5. Các thuật ngữ kỹ thuật**

1. **Transaction:** Chuỗi thao tác trên dữ liệu, đảm bảo **ACID** (Atomicity, Consistency, Isolation, Durability).
   *Ví dụ:* Chuyển tiền từ tài khoản A sang B trong ngân hàng; nếu trừ A thành công nhưng cộng B lỗi → rollback.

2. **Distributed Transaction:** Transaction diễn ra trên nhiều service hoặc cơ sở dữ liệu riêng biệt, cần **compensation hoặc eventual consistency**.
   *Ví dụ:* Đặt hàng online: Payment Service trừ tiền, Inventory Service trừ tồn kho, Notification Service gửi email.

3. **Saga Pattern:** Design pattern quản lý **distributed transaction** bằng cách thực hiện **compensation** khi bước tiếp theo thất bại.
   *Ví dụ:* Inventory Service báo hết hàng → Payment Service hoàn tiền.

4. **Compensation (Bù đắp):** Hoàn tác một bước đã commit nếu bước khác thất bại.
   *Ví dụ:* Payment Service đã trừ tiền nhưng Inventory Service lỗi → Payment Service hoàn tiền.

5. **Event (Sự kiện):** Thông điệp bất đồng bộ giữa các service, báo trạng thái transaction.
   *Ví dụ:* Payment Service gửi “PaymentSuccess”, Inventory Service lắng nghe và trừ tồn kho.

6. **Orchestrator:** Thành phần trung tâm trong **Orchestration Saga**, điều phối các bước và rollback khi cần.
   *Ví dụ:* Orchestrator gửi lệnh trừ tiền → trừ tồn kho → rollback nếu cần.

7. **Partial Failure (Lỗi một phần):** Một bước trong distributed transaction thất bại, các bước khác đã commit.
   *Ví dụ:* Payment Service trừ tiền thành công nhưng Inventory Service báo hết hàng.

8. **Consistency (Tính nhất quán):** Dữ liệu luôn thỏa mãn ràng buộc và quy tắc nghiệp vụ sau transaction.
   *Ví dụ:* Sau khi đặt hàng, tổng tiền khách trừ = tổng giá đơn, tồn kho giảm đúng số lượng.

9. **Eventual Consistency (Nhất quán cuối cùng):** Hệ thống sẽ trở nên nhất quán theo thời gian, không cần ngay lập tức.
   *Ví dụ:* Payment Service commit trước, Inventory Service commit sau, cuối cùng trạng thái tổng thể đúng.

10. **Idempotency (Tính lặp lại an toàn):** Thực hiện thao tác nhiều lần mà **không gây sai lệch dữ liệu**, tránh duplicate event.
    *Ví dụ:* Event “PaymentSuccess” gửi 2 lần → Payment Service chỉ trừ tiền 1 lần.

11. **Orchestration Saga:** Triển khai Saga Pattern với **orchestrator trung tâm** điều phối các bước.
    *Ví dụ:* Orchestrator ra lệnh Payment → Inventory → Notification; rollback nếu Inventory lỗi.

12. **Event-Driven Saga:** Triển khai Saga Pattern, **mỗi service tự quản lý transaction**, phát/lắng nghe event, không cần trung tâm.
    *Ví dụ:* Payment gửi “PaymentSuccess” → Inventory trừ tồn kho → Inventory gửi “InventoryFailed” → Payment hoàn tiền.

---

## **6. Kết luận**

Saga Pattern là **một design pattern quản lý distributed transaction trong microservices**, giúp:

* Mỗi service **tự quản lý transaction riêng** và có khả năng **bù đắp (compensation)** khi xảy ra lỗi
* Các service **độc lập nhưng phối hợp nhịp nhàng** để đảm bảo **quy trình tổng thể hoạt động ổn định**

* Hạn chế rủi ro: **dữ liệu đồng bộ**, **trải nghiệm người dùng được bảo đảm**, **quy trình vận hành liên tục**

Saga Pattern là **design pattern quan trọng** giúp hệ thống phức tạp hoạt động **hiệu quả, đáng tin cậy và dễ quản lý hơn**.
