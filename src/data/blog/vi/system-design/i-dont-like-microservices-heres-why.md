---
title: "Khi Microservices Không Nên Là Lựa Chọn Mặc Định"
description: "So sánh thực tế giữa microservices và monolith, cùng các tiêu chí để chọn kiến trúc phù hợp với đội ngũ, domain và mức độ trưởng thành vận hành."
pubDatetime: 2025-06-01T13:52:00+07:00
featured: true
draft: false
tags:
  - microservices
  - system-design
  - backend
  - career
---

Microservices giải quyết những vấn đề có thật, nhưng đồng thời cũng biến ứng dụng thành một distributed system (hệ thống phân tán). Điều đó kéo theo network failure, các lần deploy độc lập, chi phí vận hành và luồng dữ liệu phức tạp hơn. Với một đội ngũ nhỏ hoặc một sản phẩm còn ở giai đoạn đầu, các chi phí này có thể lớn hơn lợi ích.

Bài viết dựa trên trải nghiệm của tác giả khi triển khai và vận hành các service. Mục tiêu là so sánh trade-off vận hành với monolith và đề xuất tiêu chí để quyết định khi nào mức độ phức tạp bổ sung là hợp lý.

## Điều Gì Thay Đổi Khi Tách Ứng Dụng

**[SOURCE FACT]** Ban đầu, tác giả xem microservices là kiến trúc mặc định, sau đó làm việc với các team có quy mô nhỏ, gồm 4–5 developer. Trải nghiệm đó cho thấy tách code thành nhiều service không đồng nghĩa với việc tạo ra các component độc lập và ít tốn kém.

Các chi phí chính gồm:

- **Các dạng lỗi của network.** Một request đi qua nhiều service có thể gặp latency, timeout, retry, partial failure hoặc dependency không khả dụng. Mỗi lời gọi cần có timeout policy và retry policy; retry không giới hạn có thể làm tải tăng và khiến incident nghiêm trọng hơn.
- **Điều phối việc deploy.** Mỗi service có thể có quy trình build, configuration, version, deploy và rollback riêng. Vì vậy, một thay đổi nhỏ có thể cần điều phối giữa nhiều repository hoặc service.
- **Tính nhất quán dữ liệu.** Transaction trong một database tương đối trực tiếp. Cùng workflow đó nhưng chạy trên dữ liệu do nhiều service sở hữu thường cần asynchronous event, consumer có tính idempotency (xử lý lặp lại an toàn) và consistency model rõ ràng. Saga có thể điều phối workflow nhiều bước, nhưng không biến distributed transaction thành transaction cục bộ của database.
- **Debugging và observability.** Một incident trên production có thể cần đối chiếu log và trace giữa nhiều service. Nếu không có request ID thống nhất, metrics hữu ích và alert theo từng service, việc chẩn đoán sẽ khó.

Đây không phải lập luận rằng microservices vốn dĩ không tốt. Đó là các chi phí cơ bản khi chuyển từ lời gọi trong cùng process sang lời gọi qua network.

## Đội Ngũ Nhỏ Phải Đánh Đổi Điều Gì

**[ANALYSIS]** Với một đội ngũ nhỏ, monolith thường giữ nhiều công việc ở cùng một nơi:

- **Sự tập trung.** Một repository và một deployable unit giúp cả team dễ hiểu toàn bộ sản phẩm và cùng thảo luận thay đổi. Các service riêng biệt có thể tạo ra ownership silo khi mỗi người chỉ hiểu một phần hệ thống.
- **Tốc độ phát triển và release.** Monolith thường có thể được build, deploy và rollback như một unit. Với nhiều service, configuration, compatibility, thứ tự deploy và rollback có thể cần được điều phối.
- **Thời gian nhận feedback.** Một feature đi qua ranh giới service chưa hoàn tất chỉ vì một service đã được deploy. Cần kiểm tra API compatibility và hành vi của các consumer phụ thuộc.

Đây là một trade-off, không phải quy luật tuyệt đối. Monolith cũng có thể khó thay đổi, còn microservices có thể tăng autonomy của team khi các boundary là thực chất và platform đủ hỗ trợ.

## Microservices Làm Tốt Điều Gì

**[SOURCE FACT]** Trải nghiệm nói trên không phủ nhận các lợi ích hợp lệ của microservices. Trong bối cảnh phù hợp, microservices có thể cung cấp:

- **Independent scaling.** Component có load profile khác biệt có thể được scale mà không cần scale toàn bộ component còn lại.
- **Team autonomy.** Các team được tổ chức quanh business boundary ổn định có thể tự sở hữu service, release và trách nhiệm vận hành, với ít dependency giữa các team hơn.
- **Thay thế độc lập.** Một service có boundary rõ ràng sẽ dễ thay thế implementation hơn mà không phải thay đổi các phần không liên quan.

Các lợi ích này phụ thuộc vào việc boundary có thực sự độc lập hay không. Tách một workflow vốn tightly coupled thành nhiều service thường chỉ chuyển complexity sang API, queue, deployment pipeline và xử lý failure.

## Khi Nào Mức Độ Phức Tạp Là Hợp Lý

**[PROPOSED DESIGN]** Cân nhắc microservices khi phần lớn điều kiện sau đúng:

- Team đủ lớn để sở hữu nhiều service mà không để từng service thiếu người hỗ trợ. Không có ngưỡng số developer áp dụng cho mọi nơi; câu hỏi quan trọng là ownership và trách nhiệm on-call có bền vững không.
- Delivery platform đã hỗ trợ CI/CD tự động, configuration management, rollback, logging, metrics và distributed tracing.
- Các domain có boundary có ý nghĩa. Payments, user management và logistics có thể là các domain riêng, nhưng chỉ nên tách khi dữ liệu và cách thay đổi của chúng đủ độc lập.
- Một component có yêu cầu scaling hoặc availability khác biệt đáng kể, và việc vận hành độc lập xứng đáng với chi phí bổ sung.
- Tổ chức sẵn sàng vận hành asynchronous workflow, retry, timeout, backpressure và idempotency (xử lý lặp lại an toàn), thay vì xem chúng là chi tiết implementation.

Chỉ có traffic lớn là chưa đủ. Nếu hệ thống vẫn tightly coupled, các service boundary sẽ không tự động cải thiện performance hoặc giảm cost.

## Khi Monolith Là Lựa Chọn Tốt Hơn

**[PROPOSED DESIGN]** Modular monolith thường là điểm bắt đầu an toàn hơn khi:

- Team nhỏ. **[SOURCE FACT]** Ví dụ gốc có 3–5 developer và một backlog lớn.
- Sản phẩm có vài module chính và chưa có nhu cầu scale độc lập rõ ràng.
- Team vẫn đang xây dựng CI/CD và thói quen vận hành. Thêm service trước khi có nền tảng này sẽ làm tăng số lượng điểm có thể hỏng.
- Deadline ngắn. **[SOURCE FACT]** Ví dụ gốc đối chiếu việc ship sản phẩm trong một tháng với việc phát triển trong một năm. Đây là các ví dụ từ source, không phải hướng dẫn lập kế hoạch chung.

Modular monolith không có nghĩa là phải giữ mãi một deployable. Nó có thể áp dụng module boundary, giữ transaction cục bộ đơn giản và tạo đường lui để tách service sau này, khi boundary cùng một nhu cầu vận hành cụ thể đã được chứng minh.

## Một Quy Tắc Ra Quyết Định Thực Tế

Đừng chọn microservices chỉ vì đó là xu hướng hoặc vì một công ty khác đang sử dụng. Hãy bắt đầu từ vấn đề mà kiến trúc cần giải quyết:

- Phần nào cần scaling hoặc deployment độc lập?
- Team nào có thể sở hữu phần đó từ đầu đến cuối?
- Dữ liệu nào phải nhất quán trong cùng một transaction?
- Platform có thể observe, deploy, rollback và vận hành distributed system không?
- Lợi ích dự kiến có lớn hơn chi phí của network call, operational tooling và coordination không?

**[ANALYSIS]** Với team nhỏ, scope ban đầu nhỏ và deadline gấp, modular monolith thường là lựa chọn mặc định có rủi ro thấp hơn. Với các domain độc lập, ownership bền vững và năng lực vận hành trưởng thành, microservices có thể phù hợp hơn. Không nhận định nào là luật; cả hai đều cần được xem xét lại khi hệ thống thay đổi.

## Kết Luận

Kết luận hữu ích không phải là microservices tệ. Kiến trúc nên xuất phát từ vấn đề, đội ngũ, ranh giới domain và năng lực vận hành.

Nếu bạn từng vận hành monolith hoặc microservices, câu hỏi có giá trị không phải là nhãn nào tốt hơn. Điều đáng bàn là những constraint nào đã định hình quyết định, và complexity tạo ra có đáng để trả hay không.
