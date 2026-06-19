---
title: "Hiểu Saga Pattern trong 5 phút"
description: "Giải thích Saga Pattern: distributed transaction trong microservices, Event-Driven vs Orchestration, compensation và eventual consistency."
pubDatetime: 2025-09-02T11:59:00+07:00
featured: false
draft: false
tags:
  - saga-pattern
  - system-design
  - microservices
---

Nếu bạn mới tìm hiểu microservices, chắc hẳn bạn đã nghe đến Saga Pattern – một design pattern quản lý distributed transaction trong microservices. Nó giúp các service phối hợp nhịp nhàng, giữ dữ liệu đồng bộ và duy trì tính nhất quán cuối cùng (eventual consistency) ngay cả khi một service gặp sự cố.

## 1. Bối cảnh và vấn đề

Trong các hệ thống truyền thống (monolithic), bạn có thể dùng transaction để đảm bảo dữ liệu luôn nhất quán. Tuy nhiên, với microservices, mỗi bước thường do service riêng quản lý, với cơ sở dữ liệu riêng. Nếu một bước thất bại, các bước trước có thể đã commit, dẫn đến dữ liệu không đồng bộ.

## 2. Saga Pattern là gì?

Saga Pattern là một design pattern quản lý distributed transaction trong microservices. Thay vì dùng transaction truyền thống (rollback toàn bộ nếu một bước lỗi), mỗi service tự quản lý transaction riêng, và nếu bước sau thất bại, hệ thống sẽ thực hiện bù đắp (compensation) cho các bước trước.

Ví dụ đặt hàng online:

1. Payment Service: trừ tiền → thành công
2. Inventory Service: trừ tồn kho → lỗi (hết hàng)
3. Dùng Saga Pattern: Inventory Service lỗi → Payment Service hoàn tiền

## 3. Hai cách triển khai Saga Pattern

### 3.1 Event-Driven Saga (Dựa trên sự kiện)

- Mỗi bước gửi thông điệp (event) khi hoàn thành hoặc thất bại
- Bước tiếp theo lắng nghe event để quyết định thực hiện hay bù đắp
- Ưu điểm: Không cần orchestrator tập trung, dễ mở rộng
- Nhược điểm: Khó theo dõi trạng thái tổng thể, dễ xảy ra duplicate event

### 3.2 Orchestration Saga (Điều phối tập trung)

- Một orchestrator trung tâm điều phối các bước
- Khi bước nào thất bại, orchestrator ra lệnh rollback các bước trước đó
- Ưu điểm: Dễ quản lý quy trình phức tạp, kiểm soát trạng thái tập trung
- Nhược điểm: Orchestrator trở thành điểm tập trung (SPoF)

## 4. Các thuật ngữ kỹ thuật

- Transaction: Chuỗi thao tác trên dữ liệu, đảm bảo ACID
- Distributed Transaction: Transaction diễn ra trên nhiều service hoặc cơ sở dữ liệu riêng biệt
- Compensation (Bù đắp): Hoàn tác một bước đã commit nếu bước khác thất bại
- Eventual Consistency: Hệ thống sẽ trở nên nhất quán theo thời gian
- Idempotency: Thực hiện thao tác nhiều lần mà không gây sai lệch dữ liệu

## 5. Kết luận

Saga Pattern là design pattern quan trọng giúp hệ thống phức tạp hoạt động hiệu quả, đáng tin cậy và dễ quản lý hơn.
