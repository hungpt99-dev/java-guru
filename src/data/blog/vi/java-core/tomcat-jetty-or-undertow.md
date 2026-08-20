---
title: "Tomcat, Jetty hay Undertow? Hướng dẫn chọn Java Web Server hiệu năng cao"
description: "So sánh chi tiết Tomcat, Jetty và Undertow: thread model, memory footprint, hiệu năng và use case phù hợp cho từng loại ứng dụng Java."
pubDatetime: 2025-09-13T11:17:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - backend
---

Khi phát triển ứng dụng Java, việc chọn web server phù hợp là một yếu tố then chốt để đảm bảo hiệu năng, khả năng mở rộng và dễ bảo trì. Ba lựa chọn phổ biến nhất hiện nay là Apache Tomcat, Jetty, và Undertow. Mỗi server có ưu nhược điểm riêng và phù hợp với những loại ứng dụng khác nhau. Trong bài viết này, chúng ta sẽ phân tích chi tiết để giúp bạn đưa ra quyết định chính xác.

## 1. Apache Tomcat

### Giới thiệu

Tomcat là một trong những web server phổ biến nhất trong hệ sinh thái Java, được phát triển bởi Apache Software Foundation. Nó hỗ trợ đầy đủ Servlet và JSP, và thường được tích hợp sẵn trong Spring Boot thông qua dependency spring-boot-starter-web.

### Ưu điểm

- Ổn định và phổ biến: Tomcat tồn tại hơn 20 năm, cộng đồng rộng lớn, tài liệu phong phú.
- Tích hợp dễ dàng với Spring Boot: Cấu hình tự động, triển khai nhanh.
- Hỗ trợ đầy đủ Servlet và JSP: Phù hợp ứng dụng web truyền thống.

### Nhược điểm

- Hiệu năng chưa tối ưu cho số lượng kết nối cực lớn: Mỗi kết nối HTTP chiếm một thread.
- Cấu hình để sử dụng Virtual Threads (Project Loom) phức tạp.

### Ứng dụng phù hợp

- Ứng dụng web doanh nghiệp (MVC), REST API vừa và nhỏ.
- Khi cần ổn định lâu dài và không yêu cầu concurrency cực cao.

## 2. Jetty

### Giới thiệu

Jetty là lightweight web server và servlet container, được phát triển bởi Eclipse Foundation. Nó nổi bật nhờ nhẹ, nhanh và linh hoạt, phù hợp với microservices và ứng dụng nhúng.

### Ưu điểm

- Nhẹ và tốc độ khởi động nhanh.
- Hỗ trợ non-blocking I/O và asynchronous servlet.
- Dễ nhúng vào ứng dụng Java mà không cần server ngoài.
- Hỗ trợ HTTP/2 và WebSocket tốt.

### Nhược điểm

- Ít phổ biến hơn Tomcat, cộng đồng nhỏ hơn.
- Quản lý thread và connection pool phức tạp hơn.

### Ứng dụng phù hợp

- REST API, microservices, ứng dụng nhúng.
- Khi cần hiệu năng tốt với nhiều kết nối đồng thời.
- Khi muốn tận dụng WebSocket hoặc HTTP/2.

## 3. Undertow

### Giới thiệu

Undertow là web server cực nhẹ và nhanh, được phát triển bởi RedHat, và là default server trong WildFly. Nó hỗ trợ embedded, non-blocking I/O và mô hình reactive, rất phù hợp với microservices và cloud-native.

### Ưu điểm

- Hiệu năng cực cao: Xử lý hàng chục nghìn kết nối đồng thời với memory footprint thấp.
- Hỗ trợ reactive và non-blocking, tích hợp tốt với Spring WebFlux.
- Embedded server dễ dàng, khởi động nhanh.

### Nhược điểm

- Ít phổ biến hơn Tomcat và Jetty, tài liệu hạn chế.
- Không hỗ trợ JSP, nên không phù hợp ứng dụng web truyền thống.

### Ứng dụng phù hợp

- REST API, microservices, reactive application.
- Ứng dụng cloud-native hoặc serverless.

## 4. So sánh tổng quan

| Tiêu chí           | Tomcat             | Jetty                             | Undertow                |
| ------------------ | ------------------ | --------------------------------- | ----------------------- |
| Thread model       | Thread-per-request | Thread-per-request / Non-blocking | Non-blocking / Reactive |
| Memory footprint   | Trung bình         | Thấp                              | Rất thấp                |
| Khởi động          | Trung bình         | Nhanh                             | Rất nhanh               |
| HTTP/2 support     | Có nhưng hạn chế   | Tốt                               | Tốt                     |
| Embedded           | Có                 | Rất dễ                            | Rất dễ                  |
| Hỗ trợ JSP         | Có                 | Có                                | Không                   |
| Reactive / WebFlux | Hạn chế            | Tốt                               | Xuất sắc                |

## 5. Lựa chọn server dựa trên loại ứng dụng

- REST API / Microservices: Undertow hoặc Jetty sẽ xử lý concurrency tốt hơn, footprint thấp hơn. Tomcat vẫn được nhưng cần tuning nếu traffic cao.
- Ứng dụng web truyền thống (MVC / JSP): Tomcat là lựa chọn an toàn, Jetty dùng được nhưng cần thêm dependency cho JSP.
- Reactive / Cloud-native: Undertow tối ưu nhất, Jetty cũng tốt, Tomcat hạn chế.

## 6. Kết luận

- Tomcat: Ổn định, phổ biến, phù hợp ứng dụng web truyền thống.
- Jetty: Nhẹ, nhanh, hỗ trợ async tốt, phù hợp microservices hoặc nhúng.
- Undertow: Hiệu năng cao, reactive, phù hợp REST API và ứng dụng cloud-native.

Lựa chọn server không chỉ dựa vào hiệu năng, mà còn phụ thuộc vào kiến trúc ứng dụng, công nghệ sử dụng và môi trường triển khai. Nắm vững ưu nhược điểm của Tomcat, Jetty và Undertow sẽ giúp bạn tối ưu hóa hiệu năng và trải nghiệm người dùng.
