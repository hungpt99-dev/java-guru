---
title: "Tomcat, Jetty hay Undertow: Cách chọn web server cho Java"
description: "So sánh thực tế giữa Tomcat, Jetty và Undertow về cách xử lý request, khả năng nhúng, hỗ trợ protocol và mức độ phù hợp với từng loại ứng dụng."
pubDatetime: 2025-09-13T11:17:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Chọn web server cho ứng dụng Java hiếm khi chỉ là tìm cái tên có benchmark cao nhất. Các câu hỏi thực tế hơn là: ứng dụng cần API nào, request được xử lý theo mô hình blocking hay async, server được nhúng và cấu hình ra sao, và môi trường triển khai hiện đã chuẩn hóa thành phần nào.

Tomcat, Jetty và Undertow đều có thể phục vụ HTTP và đều có thể được nhúng vào ứng dụng Java. Điểm khác nhau nằm ở mặc định, chi tiết tích hợp và các đánh đổi giữa khả năng tương thích với servlet, non-blocking I/O, mức độ quen thuộc khi vận hành và kiến trúc ứng dụng. Bài viết này so sánh các đánh đổi đó, không coi lựa chọn server là một bảng xếp hạng hiệu năng áp dụng cho mọi trường hợp.

## 1. Apache Tomcat

### Tomcat là gì

**[SOURCE FACT]** Tomcat là servlet container được sử dụng rộng rãi, do Apache Software Foundation phát triển. Tomcat hỗ trợ Servlet API và JSP, đồng thời thường là lựa chọn mặc định trong ứng dụng Spring Boot dùng `spring-boot-starter-web`.

**[ANALYSIS]** Tomcat là lựa chọn an toàn khi ứng dụng dựa trên mô hình servlet, MVC thông thường hoặc đội ngũ đã quen vận hành Tomcat. Connector của Tomcat không mặc định đồng nghĩa với “mỗi connection một thread”: với non-blocking connector, một nhóm thread có thể quản lý connection, còn worker thread xử lý request. Hành vi thực tế phụ thuộc vào connector và cấu hình executor.

### Điểm mạnh

- Hỗ trợ servlet và JSP trưởng thành cho các ứng dụng server-side truyền thống.
- Được sử dụng rộng rãi, có hệ sinh thái và tài liệu vận hành lớn.
- Tích hợp và triển khai với Spring Boot tương đối đơn giản.
- Có nhiều lựa chọn connector và executor, bao gồm non-blocking I/O.

### Giới hạn

- Code blocking vẫn chiếm năng lực xử lý request trong lúc chờ database, downstream service hoặc I/O khác.
- Non-blocking connector không tự giải quyết bài toán concurrency cao. Ứng dụng vẫn cần timeout hợp lý, connection pool, backpressure và giới hạn lượng việc đưa vào executor.
- Việc áp dụng virtual thread cần kiểm tra framework, connector và cấu hình executor, không nên xem đó là công tắc chỉ thuộc về server.

### Phù hợp với

Tomcat phù hợp với ứng dụng MVC dựa trên servlet, ứng dụng JSP và REST service quy mô nhỏ đến vừa, khi tính tương thích và mức độ quen thuộc khi vận hành quan trọng hơn việc thay đổi programming model.

## 2. Jetty

### Jetty là gì

**[SOURCE FACT]** Jetty là HTTP server và servlet container nhẹ, gắn với Eclipse Foundation. Jetty hỗ trợ non-blocking I/O, Servlet API dạng async, triển khai embedded và các protocol như HTTP/2, WebSocket khi stack liên quan được cấu hình và hỗ trợ.

**[ANALYSIS]** Jetty phù hợp khi server là một phần của ứng dụng thay vì một runtime được quản lý tách biệt. Tính linh hoạt hữu ích, nhưng cũng khiến thread pool, giới hạn connection, queue và thiết lập protocol cần được xem xét như một hệ thống. “Nhẹ” không loại bỏ chi phí của blocking work trong ứng dụng.

### Điểm mạnh

- Runtime nhỏ, dễ nhúng và thường khởi động nhanh trong các mô hình triển khai embedded.
- Hỗ trợ tốt async request handling và non-blocking I/O.
- Cấu hình linh hoạt cho embedded service và HTTP stack tùy biến.
- Hỗ trợ HTTP/2 và WebSocket, tùy version và cấu hình triển khai.

### Giới hạn

- Đội ngũ đã chuẩn hóa trên Tomcat có thể ít quen với cách cấu hình Jetty hơn.
- Tuning đúng đòi hỏi hiểu quan hệ giữa connection limit, worker thread, queue và tài nguyên downstream.
- Một số servlet feature và integration tùy chọn có thể cần dependency bổ sung hoặc cấu hình rõ ràng.

### Phù hợp với

Jetty phù hợp với REST service, microservice, ứng dụng embedded và hệ thống cần async handling hoặc WebSocket/HTTP/2 mà không nhất thiết phải đổi sang một kiến trúc server khác.

## 3. Undertow

### Undertow là gì

**[SOURCE FACT]** Undertow là HTTP server được thiết kế cho embedded use và non-blocking I/O. Undertow gắn với hệ sinh thái WildFly/JBoss và có thể phục vụ ứng dụng dựa trên servlet cũng như các HTTP handler ở mức thấp hơn.

**[ANALYSIS]** Handler model của Undertow phù hợp với ứng dụng cần kiểm soát rõ cách xử lý request non-blocking. Undertow tự nó không phải reactive framework và không biến blocking code thành non-blocking. Nếu cần tương thích với Spring WebFlux, phải kiểm tra Spring Boot version và Undertow version được chọn; chỉ chọn server không tạo ra reactive architecture.

### Điểm mạnh

- Server có thể nhúng, với handler model theo hướng non-blocking.
- Hữu ích cho service cần kiểm soát ở mức thấp cách xử lý HTTP và đặc tính khởi động nhanh.
- Có servlet support, đồng thời ứng dụng có thể dùng trực tiếp Undertow handler.
- Phù hợp với thiết kế high-concurrency khi ứng dụng và các dependency downstream cũng được thiết kế cho async hoặc work có giới hạn.

### Giới hạn

- Không hỗ trợ JSP, nên không phù hợp trực tiếp với ứng dụng dựa trên JSP.
- Đội ngũ có thể có ít kinh nghiệm vận hành hoặc tài liệu nội bộ cho Undertow hơn Tomcat.
- Hiệu năng và mức dùng memory phụ thuộc workload; không nên mặc định rằng overhead luôn “rất thấp” hoặc server xử lý được một số connection cố định nếu chưa test với workload đại diện.

### Phù hợp với

Undertow là một ứng viên cho embedded service, REST API và ứng dụng dùng non-blocking handler. Đây không phải lựa chọn phù hợp khi cần tương thích JSP. Với reactive application, hãy đánh giá toàn bộ framework và dependency stack thay vì chọn Undertow chỉ vì nhãn “reactive”.

## 4. So sánh

Bảng dưới đây mô tả xu hướng chung, không phải cam kết. Default và feature khả dụng thay đổi theo version server, connector, framework và cấu hình triển khai.

| Tiêu chí | Tomcat | Jetty | Undertow |
| --- | --- | --- | --- |
| Request handling | Servlet worker model; có non-blocking connector | Servlet worker model cùng async và non-blocking API | Non-blocking handler cùng servlet support |
| Memory footprint | Trung bình trong servlet deployment điển hình; cần đo trên ứng dụng thực tế | Thường gọn trong embedded deployment; cần đo trên ứng dụng thực tế | Thường gọn trong embedded deployment; cần đo trên ứng dụng thực tế |
| Startup | Phụ thuộc ứng dụng và cấu hình | Thường nhanh trong embedded deployment | Thường nhanh trong embedded deployment |
| HTTP/2 | Có với connector và cấu hình phù hợp | Có với cấu hình phù hợp | Có với cấu hình phù hợp |
| Embedding | Có hỗ trợ | Là use case nổi bật | Là use case nổi bật |
| JSP | Có hỗ trợ | Có với JSP integration cần thiết | Không hỗ trợ |
| Reactive framework fit | Phụ thuộc framework và adapter | Phụ thuộc framework và adapter | Phụ thuộc framework và adapter |

## 5. Cách lựa chọn

**[PROPOSED DESIGN]** Hãy dùng quy trình sau thay vì bắt đầu từ một khẳng định hiệu năng chung:

- **Servlet MVC hoặc JSP:** Bắt đầu với Tomcat. Jetty cũng khả thi, nhưng cần kiểm tra servlet/JSP dependency và mô hình vận hành của đội ngũ.
- **Embedded service hoặc HTTP handling tùy biến:** So sánh Jetty và Undertow trước. Lựa chọn dựa trên handler API, mô hình cấu hình và kỹ năng hỗ trợ hiện có.
- **Nhiều connection đồng thời:** Trước hết, làm cho phần phù hợp của ứng dụng trở thành non-blocking, giới hạn queue và connection pool, đồng thời đặt timeout. Sau đó benchmark các server ứng viên bằng request mix thực tế. Non-blocking server không thể bù cho blocking work không có giới hạn.
- **Reactive stack:** Chọn framework và server integration được hỗ trợ như một bộ thống nhất. Không nên suy ra rằng riêng Undertow, Jetty hoặc Tomcat có thể làm ứng dụng trở thành reactive.
- **Platform hiện có:** Ưu tiên server mà tổ chức đã có khả năng monitor, patch và debug tốt, trừ khi có yêu cầu đo được buộc phải thay đổi.

## 6. Kết luận

Tomcat thường là lựa chọn ít bất ngờ nhất cho ứng dụng servlet và JSP. Jetty là embedded server linh hoạt, có khả năng async tốt. Undertow cung cấp non-blocking handler model có thể nhúng và là ứng viên hợp lý cho service cần mức kiểm soát đó.

Không có server nào trong ba lựa chọn luôn nhanh nhất. Kết quả phụ thuộc vào blocking behavior, giới hạn executor và connection pool, latency của downstream, cấu hình protocol và framework bao quanh server. Hãy xác định yêu cầu ứng dụng trước, sau đó kiểm chứng shortlist bằng load test gần với production và các kiểm tra vận hành.
