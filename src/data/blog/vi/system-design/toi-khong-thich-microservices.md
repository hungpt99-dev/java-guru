---
title: "Tôi không thích microservices, và đây là lý do"
description: "Chia sẻ thực tế từ một backend developer: khi nào nên và không nên dùng microservices, trade-off với monolith và bài học cho team nhỏ."
pubDatetime: 2025-06-01T13:52:00+07:00
featured: true
draft: false
tags:
  - microservices
  - system-design
  - backend
  - career
---

Chào mọi người! Tôi là Hưng Phạm, một lập trình viên backend đã từng nghĩ rằng microservices là tiêu chuẩn cho mọi hệ thống – cho đến khi chính tay mình triển khai và duy trì nó. Và bây giờ, sau nhiều đêm "vật lộn" với hàng tá logs của 4–5 service khác nhau, tôi nhận ra một điều: microservices không phải là giải pháp phù hợp cho mọi hệ thống.

## 1. Hồi đầu – microservices là "chén thánh" công nghệ

Ngày đầu tiên tôi biết đến microservices, cảm giác thực sự rất "đã". Những lời quảng cáo, những case study từ các ông lớn như Netflix, Amazon, Uber, Google… khiến tôi gần như mê mẩn.

Tôi lập tức lao vào học Docker, Kubernetes, Service Mesh, CI/CD pipeline tự động, API Gateway… danh sách các kiến thức phải học dài dằng dặc.

## 2. Nhưng thực tế lại không như mơ

Khi chính thức "micro hoá" mấy dự án của team – một team nhỏ chỉ có 4–5 dev, tôi mới "ngấm" rằng microservices không đơn giản chỉ là chia nhỏ code:

- Network latency và timeout: Chỉ cần một service chậm, cả hệ thống như domino bị đổ theo
- Quản lý triển khai phức tạp: Mỗi service có pipeline CI/CD riêng
- Bài toán nhất quán dữ liệu đau đầu: Phải nghĩ tới eventual consistency, Saga, Orchestrator
- Debug logs rối như tơ vò: Phải lục tung logs của nhiều service

## 3. Những thứ microservices "cướp mất" của team nhỏ

1. Tính tập trung: Monolith một repo, một codebase. Microservices mỗi người "cắm trại" trong một service
2. Tốc độ phát triển ban đầu: Monolith deploy một lần. Microservices deploy rải rác
3. Niềm vui khi release features: Monolith có feature là bung ra ngay

## 4. Nhưng microservices không hẳn là "ác quỷ"

- Scale độc lập: Service nào "hot" có thể scale riêng
- Team to tự chủ: Mỗi nhóm dev có thể làm việc trên service riêng biệt
- Dễ dàng phát triển và thay thế từng module

## 5. Vậy khi nào nên dùng microservices?

- Dự án có đội ngũ backend đủ lớn (từ 10 dev trở lên)
- Hạ tầng đã đủ mạnh, có CI/CD tự động, observability tốt
- Ứng dụng có nhiều domain độc lập rõ ràng
- Volume traffic rất lớn, cần scale từng thành phần

## 6. Và khi nào không nên "chơi sang"?

- Team nhỏ (3–5 dev)
- Ứng dụng đơn giản, chỉ có vài module chính
- Team chưa có kinh nghiệm CI/CD, DevOps
- Deadline gấp rút

## 7. Kết luận

Microservices không phải là cái gì đó xấu xa, cũng không phải là "cứ có thì hay". Điều quan trọng nhất vẫn là: Hiểu rõ bài toán thực tế. Chọn kiến trúc phù hợp với quy mô team, tính chất ứng dụng, và mức độ phức tạp thật sự cần thiết.

Team nhỏ, feature ít, deadline gấp: Monolith là vua. Team to, domain phức tạp, traffic lớn: Microservices là cứu tinh.
