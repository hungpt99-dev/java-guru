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

Chào mọi người! Tôi là Hưng Phạm, một lập trình viên backend đã từng nghĩ rằng microservices là tiêu chuẩn cho mọi hệ thống – cho đến khi chính tay mình triển khai và duy trì nó. Và bây giờ, sau nhiều đêm "vật lộn" với hàng tá logs của 4–5 service khác nhau, tôi nhận ra một điều: microservices không phải là giải pháp phù hợp cho mọi hệ thống. Tại sao ư? Hãy để tôi chia sẻ thật chi tiết câu chuyện của mình, hi vọng sẽ giúp các bạn có cái nhìn thực tế hơn về microservices.

## 1️. Hồi đầu – microservices là "chén thánh" công nghệ

Ngày đầu tiên tôi biết đến microservices, cảm giác thực sự rất "đã". Những lời quảng cáo, những case study từ các ông lớn như Netflix, Amazon, Uber, Google… khiến tôi gần như mê mẩn:

- "Chia nhỏ ứng dụng ra, mỗi phần có thể phát triển và deploy độc lập, linh hoạt như ý muốn!"
- "Scale từng service riêng biệt, tránh phải scale toàn bộ ứng dụng cồng kềnh!"
- "Nếu bạn không theo microservices thì coi như tụt hậu, công nghệ này là tương lai của phát triển phần mềm!"

Tôi lập tức lao vào học Docker, Kubernetes, Service Mesh, CI/CD pipeline tự động, API Gateway… danh sách các kiến thức phải học dài dằng dặc, đến mức deadline dự án còn không bằng độ dài kiến thức cần nắm. Tôi tưởng mình đang mở một chân trời mới cho sự nghiệp backend.

## 2️. Nhưng thực tế lại không như mơ

Khi chính thức "micro hoá" mấy dự án của team – một team nhỏ chỉ có 4–5 dev, tôi mới "ngấm" rằng microservices không đơn giản chỉ là chia nhỏ code. Đó là một mạng lưới phức tạp khiến tôi gần như phát điên:

- Network latency và timeout: Chỉ cần một service chậm, cả hệ thống như domino bị đổ theo. Một request tưởng đơn giản lại chạy qua cả chục service, rất dễ xảy ra timeout hoặc thất bại giữa chừng.
- Quản lý triển khai phức tạp: Mỗi service có pipeline CI/CD riêng, cấu hình riêng, versioning riêng. Việc deploy không còn chỉ là một nút bấm đơn giản mà biến thành một chiến dịch.
- Bài toán nhất quán dữ liệu đau đầu: Không còn chuyện transaction đơn giản nữa. Phải nghĩ tới eventual consistency, các pattern phức tạp như Saga, Orchestrator (Camunda, Temporal…) – nghe đến đây là muốn "đầu hàng" luôn.
- Debug logs rối như tơ vò: Khi production có vấn đề, phải lục tung logs của nhiều service, trace request từ service này sang service khác. Nhiều khi cảm giác mình như thám tử Sherlock Holmes mò mẫm trong bóng tối.

## 3️. Những thứ microservices "cướp mất" của team nhỏ

Với một team nhỏ, tôi nhận ra microservices đang "cướp" đi của chúng tôi nhiều thứ quý giá:

1. Tính tập trung:
   - Monolith: Một repo, một codebase, cả team cùng "nhào nặn" chung, dễ trao đổi, dễ hiểu tổng quan.
   - Microservices: Mỗi người "cắm trại" trong một service, giao tiếp qua API, mất đi sự gắn kết, dễ gây ra "silos" (chia phe) trong team.

2. Tốc độ phát triển ban đầu:
   - Monolith: Deploy một lần, rollback một lần, thay đổi nhỏ được đưa lên nhanh chóng.
   - Microservices: Deploy rải rác, phải canh chỉnh config nhiều nơi, rollback cũng phức tạp, tốn thời gian hơn rất nhiều.

3. Niềm vui khi release features:
   - Monolith: Cứ có feature là bung ra ngay, release nhanh, feedback người dùng gần như tức thì.
   - Microservices: Release từng service, phải đảm bảo không đụng chạm, không phá vỡ API, căng thẳng vì phải phối hợp nhiều service cùng lúc.

## 4️. Nhưng microservices không hẳn là "ác quỷ"

Tôi không phủ nhận microservices có những điểm mạnh rất đáng giá:

- Scale độc lập: Service nào "hot" có thể scale riêng, tiết kiệm tài nguyên hơn.
- Team to tự chủ: Mỗi nhóm dev có thể làm việc trên một hoặc vài service riêng biệt, giảm sự phụ thuộc, tăng tốc độ phát triển lâu dài.
- Dễ dàng phát triển và thay thế từng module: Nếu muốn thay đổi một phần, không cần phải đụng chạm toàn bộ hệ thống monolith cồng kềnh.

## 5️. Vậy khi nào nên dùng microservices?

Tôi nghĩ microservices chỉ thực sự phát huy hiệu quả khi:

- Dự án có đội ngũ backend đủ lớn (từ 10 dev trở lên), có thể chia team theo domain rõ ràng.
- Hạ tầng đã đủ mạnh, có CI/CD tự động, observability tốt (logging, tracing, metrics…), không còn bỡ ngỡ trong deploy.
- Ứng dụng có nhiều domain độc lập rõ ràng, ví dụ: thanh toán, quản lý người dùng, kho vận, mỗi domain hoạt động gần như độc lập.
- Volume traffic rất lớn, cần scale từng thành phần một cách hiệu quả để tiết kiệm chi phí và tăng hiệu năng.

## 6️. Và khi nào không nên "chơi sang"?

Nếu bạn thuộc những trường hợp sau, tôi khuyên bạn hãy suy nghĩ kỹ trước khi "nhảy" vào microservices:

- Team nhỏ (3–5 dev), còn đang "bơi" trong backlog với hàng tá feature cần làm.
- Ứng dụng đơn giản, chỉ có vài module chính, chưa đến mức phải scale phức tạp.
- Team chưa có kinh nghiệm CI/CD, DevOps, microservices sẽ "bắt" bạn phải thành thạo DevOps trước.
- Deadline gấp rút, ví dụ 1 tháng để ra sản phẩm, thay vì 1 năm để phát triển bền vững.

## 7️. Kết luận: Tôi không ghét microservices, tôi chỉ không thích "đu trend" vô nghĩa

Microservices không phải là cái gì đó xấu xa, cũng không phải là "cứ có thì hay". Tôi chỉ không thích việc các team nhỏ bị "bắt chước" xu hướng chỉ vì thấy kêu, rồi tự làm khổ mình bằng một hệ thống phức tạp không cần thiết.

Điều quan trọng nhất, theo tôi, vẫn là:

- Hiểu rõ bài toán thực tế.
- Chọn kiến trúc phù hợp với quy mô team, tính chất ứng dụng, và mức độ phức tạp thật sự cần thiết.

Tóm lại:

- Team nhỏ, feature ít, deadline gấp: Monolith là vua.
- Team to, domain phức tạp, traffic lớn: Microservices là cứu tinh.

## 8️. Và bạn thì sao?

Bạn có câu chuyện microservices thành công rực rỡ? Hay thất bại đến "vỡ mặt"? Tôi rất muốn nghe câu chuyện của bạn, để có thể cùng nhau học hỏi, chia sẻ kinh nghiệm và không phải mất thời gian "đi đường vòng" như tôi từng trải qua.
