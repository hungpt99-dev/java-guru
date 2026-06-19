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

Khi phát triển ứng dụng Java, việc chọn web server phù hợp là một yếu tố then chốt để đảm bảo hiệu năng, khả năng mở rộng và dễ bảo trì. Ba lựa chọn phổ biến nhất hiện nay là Apache Tomcat, Jetty, và Undertow.

## 1. Apache Tomcat

Tomcat là một trong những web server phổ biến nhất trong hệ sinh thái Java, được phát triển bởi Apache Software Foundation.

**Ưu điểm:**

- Ổn định và phổ biến: Tomcat tồn tại hơn 20 năm, cộng đồng rộng lớn
- Tích hợp dễ dàng với Spring Boot
- Hỗ trợ đầy đủ Servlet và JSP

**Nhược điểm:**

- Hiệu năng chưa tối ưu cho số lượng kết nối cực lớn
- Cấu hình để sử dụng Virtual Threads (Project Loom) phức tạp

**Ứng dụng phù hợp:** Ứng dụng web doanh nghiệp (MVC), REST API vừa và nhỏ.

## 2. Jetty

Jetty là lightweight web server và servlet container, được phát triển bởi Eclipse Foundation.

**Ưu điểm:**

- Nhẹ và tốc độ khởi động nhanh
- Hỗ trợ non-blocking I/O và asynchronous servlet
- Dễ nhúng vào ứng dụng Java
- Hỗ trợ HTTP/2 và WebSocket tốt

**Nhược điểm:**

- Ít phổ biến hơn Tomcat, cộng đồng nhỏ hơn
- Quản lý thread và connection pool phức tạp hơn

**Ứng dụng phù hợp:** REST API, microservices, ứng dụng nhúng.

## 3. Undertow

Undertow là web server cực nhẹ và nhanh, được phát triển bởi RedHat, là default server trong WildFly.

**Ưu điểm:**

- Hiệu năng cực cao: Xử lý hàng chục nghìn kết nối đồng thời với memory footprint thấp
- Hỗ trợ reactive và non-blocking, tích hợp tốt với Spring WebFlux
- Embedded server dễ dàng, khởi động nhanh

**Nhược điểm:**

- Ít phổ biến hơn Tomcat và Jetty, tài liệu hạn chế
- Không hỗ trợ JSP

**Ứng dụng phù hợp:** REST API, microservices, reactive application, cloud-native.

## 4. So sánh tổng quan

| Tiêu chí           | Tomcat             | Jetty                             | Undertow                |
| ------------------ | ------------------ | --------------------------------- | ----------------------- |
| Thread model       | Thread-per-request | Thread-per-request / Non-blocking | Non-blocking / Reactive |
| Memory footprint   | Trung bình         | Thấp                              | Rất thấp                |
| Khởi động          | Trung bình         | Nhanh                             | Rất nhanh               |
| HTTP/2 support     | Có nhưng hạn chế   | Tốt                               | Tốt                     |
| Reactive / WebFlux | Hạn chế            | Tốt                               | Xuất sắc                |

## 5. Kết luận

- Tomcat: Ổn định, phổ biến, phù hợp ứng dụng web truyền thống
- Jetty: Nhẹ, nhanh, hỗ trợ async tốt, phù hợp microservices hoặc nhúng
- Undertow: Hiệu năng cao, reactive, phù hợp REST API và ứng dụng cloud-native
