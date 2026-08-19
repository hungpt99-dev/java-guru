---
title: "Thiết kế hệ thống tải cao: Kiểm soát đột biến lưu lượng từ đầu đến cuối"
description: "Hướng dẫn thực tế về giảm tải ở các lớp frontend, cache, cơ sở dữ liệu, backend, luồng request, monitoring và autoscaling."
pubDatetime: 2025-09-21T04:32:00+07:00
featured: true
draft: false
tags:
  - system-design
  - microservices
  - backend
---

## 1. Bối cảnh và thách thức

Các hệ thống như sàn thương mại điện tử, sản phẩm fintech, ứng dụng SaaS, mạng xã hội và dịch vụ streaming đều có thể gặp đột biến lưu lượng. Ví dụ gồm flash sale, mùa mua sắm cuối năm, thời điểm lập báo cáo tài chính cuối tháng, hoặc một sự kiện bất ngờ khiến nhiều người dùng truy cập cùng lúc.

**[PHÂN TÍCH]** Nếu không chuẩn bị, các dạng lỗi thường gặp là latency tăng, CPU hoặc memory cạn kiệt, và dịch vụ không khả dụng. Tác động đến người dùng và hoạt động kinh doanh khiến bài toán tải cao phải được xử lý trên nhiều lớp, không chỉ bằng một quyết định về hạ tầng.

Bài viết này trình bày các kỹ thuật trên toàn bộ request path: hành vi của frontend, caching, precomputation, tối ưu query và xử lý dữ liệu, kiến trúc backend, quản lý request, cùng các biện pháp vận hành như monitoring và autoscaling. Không có một giải pháp duy nhất xử lý mọi bottleneck. Cần kết hợp các kỹ thuật giải quyết những nguồn tải khác nhau.

## 2. Tối ưu frontend để giảm tải backend

Có thể bắt đầu giảm tải từ frontend. UI chỉ request dữ liệu cần cho tương tác hiện tại sẽ tránh được công việc không cần thiết ở backend.

### 2.1 UX/UI ưu tiên hiệu năng

- **Ưu tiên thông tin quan trọng.** Render trước các trường người dùng cần. Trên trang sản phẩm thương mại điện tử, đó có thể là tên, giá và hình ảnh. Thông tin ít cần hơn, chẳng hạn review chi tiết hoặc lịch sử bán hàng, có thể đặt trong tab riêng.
- **Dùng lazy loading và skeleton UI.** Render cấu trúc giao diện trước rồi fetch dữ liệu khi cần. Cách này cải thiện cảm nhận về độ phản hồi và có thể giảm số request đồng thời.
- **Dùng pagination hoặc infinite scroll.** Không tải toàn bộ collection trong một lần. **[GIẢ ĐỊNH MINH HỌA]** Một danh sách sản phẩm có thể request 20 item đầu tiên rồi fetch trang tiếp theo khi người dùng scroll.
- **Trì hoãn dữ liệu phụ.** Các thống kê ít được xem có thể đặt trong accordion hoặc modal và chỉ fetch khi người dùng mở.

**[GIẢ ĐỊNH MINH HỌA]** Với dashboard quản trị hiển thị 1.000 đơn hàng mỗi ngày, request ban đầu có thể chỉ trả về 20 đơn hàng đầu tiên. Các đơn hàng tiếp theo được fetch khi người dùng scroll hoặc áp dụng bộ lọc. Nhờ đó, mỗi lần tải trang không phải chạy query cho toàn bộ tập kết quả.

### 2.2 Frontend cache

- **LocalStorage hoặc SessionStorage:** Lưu dữ liệu ít thay đổi, chẳng hạn danh mục sản phẩm hoặc cấu hình dashboard.
- **Service Worker hoặc PWA cache:** Tái sử dụng resource đã cache khi reload và hỗ trợ offline cho các resource, flow đã được cache rõ ràng.
- **Cache API response:** Giữ bản sao phía client cho dữ liệu có thể tái sử dụng an toàn, như banner, menu hoặc một phần dữ liệu profile. Chính sách invalidation và freshness phải phù hợp với yêu cầu consistency của dữ liệu.

Client-side caching có thể giảm request lặp lại đến backend và cải thiện response time. Nó không thay thế các cơ chế kiểm soát phía server: dữ liệu cache vẫn cần thời gian sống và chính sách truy cập phù hợp.

## 3. Caching và precomputation

Tính toán real-time là một nguồn gây tải phổ biến. Các report, statistic và aggregate không nhất thiết phải tính lại ở mỗi request có thể được chuẩn bị trước.

### 3.1 Precomputation

- Precompute kết quả quan trọng thay vì tính trong request path.
- Lưu kết quả vào intermediate table hoặc materialized view trong database.
- Refresh theo lịch hoặc để các event liên quan kích hoạt việc refresh.

### 3.2 Cache pre-warming

Trước một thời điểm đã biết là có peak, preload dữ liệu hot vào cache. **[THIẾT KẾ ĐỀ XUẤT]** Trước một flash sale, hệ thống có thể load dữ liệu của các sản phẩm thường được truy cập. Điều này giảm khả năng nhiều request cùng cache miss rồi truy vấn database đồng thời.

Pre-warming chỉ hữu ích khi đã hiểu hot set và yêu cầu freshness. Không nên xem nó là phương án thay thế cho việc xử lý cache miss an toàn.

### 3.3 Multi-layer caching

- **Edge cache (CDN):** Phân phối static asset như hình ảnh, video, CSS và JavaScript.
- **Application cache (ví dụ Redis):** Cache dữ liệu động, session hoặc token khi mô hình bảo mật và invalidation cho phép.
- **Database cache:** Cache query result phù hợp với yêu cầu consistency của database và application.

Nhiều lớp cache có thể hấp thụ các phần khác nhau của request volume, nhưng mỗi lớp cần TTL, chiến lược invalidation và chính sách capacity rõ ràng.

### 3.4 Promise cache / single-flight

Trong ngữ cảnh này, promise cache lưu kết quả đang được xử lý của một request. Nếu request tương đương đến trong lúc request đầu tiên chưa hoàn tất, nó sẽ chờ kết quả đó thay vì tạo thêm request đến backend hoặc database. Pattern này cũng thường được gọi là request coalescing hoặc single-flight.

**[THIẾT KẾ ĐỀ XUẤT]** Nếu nhiều người dùng cùng request chi tiết của một sản phẩm hot, một request có thể truy vấn database còn các request khác await promise dùng chung. Implementation cũng phải xử lý rejection và expiry để request lỗi hoặc bị bỏ dở không bị giữ vô thời hạn.

## 4. Tối ưu query và xử lý dữ liệu

Query nhiều dữ liệu hơn nhu cầu của request và thực hiện tác vụ nặng theo cách synchronous đều làm tăng tải. Batch processing, Bloom filter và request coalescing có thể giảm công việc không cần thiết ở database, nhưng mỗi kỹ thuật giải quyết một vấn đề khác nhau.

### 4.1 Chỉ query dữ liệu cần thiết

- Chỉ select field cần dùng thay vì dùng `SELECT *`.
- Dùng pagination với `LIMIT`/`OFFSET` hoặc cursor-based pagination, tùy access pattern.
- Tránh join nhiều table phức tạp trong request nhạy latency nếu có thể thực hiện công việc đó offline bằng batch job.
- Thêm index phù hợp với query pattern thực tế và kiểm tra tác động bằng query plan của database.

Ví dụ:

- Kết quả sản phẩm bán chạy có thể chỉ cần `product_id`, `category_id` và `sold_quantity`.
- Transaction report có thể cần `user_id`, `amount` và `status`, không cần các field text dài.

Chọn ít dữ liệu hơn giúp giảm I/O và memory use, từ đó có thể cải thiện throughput và giảm nguy cơ out-of-memory. Tuy vậy, index và pagination vẫn phải được chọn theo workload cụ thể; không kỹ thuật nào mặc nhiên có lợi cho mọi query.

### 4.2 Batch processing

Batch processing gom nhiều operation nhỏ thành một operation lớn hơn. Nó có thể giảm overhead mỗi lần gọi API hoặc database. Có thể dùng queue cùng với batching để điều tiết tốc độ xử lý và tạo backpressure.

**[GIẢ ĐỊNH MINH HỌA]** Để cập nhật status của 1.000 đơn hàng, application có thể gửi một batch update thay vì thực hiện một database update cho từng đơn, nếu yêu cầu về transaction, error handling và locking cho phép.

### 4.3 Bloom filter

Bloom filter là một probabilistic data structure dùng để kiểm tra một phần tử có thể tồn tại trong set hay không. Nó trả về “chắc chắn không có” hoặc “có thể có”. Bloom filter được cấu hình đúng không có false negative, nhưng có thể có false positive; vì vậy kết quả dương tính vẫn phải được kiểm tra lại bằng source of truth.

Các cách dùng có thể gồm:

- Từ chối coupon code chắc chắn không tồn tại trước khi query database.
- Giảm cache penetration, tức các request lặp lại nhằm vào những key không tồn tại.
- Lọc một phần bot hoặc request không mong muốn trước các bước xử lý tốn kém hơn.

**[THIẾT KẾ ĐỀ XUẤT]** Khi nhập coupon, kết quả âm tính từ Bloom filter có thể từ chối request mà không cần lookup database. Kết quả dương tính phải tiếp tục qua bước validation thông thường vì có thể là false positive.

### 4.4 Request coalescing

Khi các request tương đương đến gần nhau, backend có thể gộp chúng thành một operation và chia sẻ kết quả cho các request đang chờ. Cách này giảm query trùng lặp đến database và làm phẳng các đợt tăng tải ngắn. Thiết kế cần định nghĩa request tương đương, thời gian chờ tối đa và cách xử lý lỗi.

**[GIẢ ĐỊNH MINH HỌA]** Nếu 500 người dùng cùng request 10 sản phẩm bán chạy nhất, request coalescing có thể biến các lookup tương đương thành một query rồi trả kết quả cho các caller đang chờ.

## 5. Kiến trúc backend

Kiến trúc backend quyết định cách cô lập và scale read, write và các tác vụ nặng. Lựa chọn phù hợp phụ thuộc vào consistency, query pattern và ràng buộc vận hành; các pattern dưới đây là các lựa chọn thiết kế, không phải yêu cầu áp dụng cho mọi hệ thống.

### 5.1 CQRS và search engine

CQRS (Command Query Responsibility Segregation) tách write model và read model:

- Write model được tối ưu cho transactional update.
- Read model được tối ưu cho query và retrieval pattern.

**[THIẾT KẾ ĐỀ XUẤT]** Một search engine như Elasticsearch hoặc OpenSearch có thể phục vụ các query phức tạp phù hợp, thay vì gửi mọi query đến transactional database. Materialized view là một representation khác được tối ưu cho read, phù hợp với aggregate và query định trước. Read model phải được cập nhật từ write side, và độ trễ consistency phát sinh phải chấp nhận được theo yêu cầu sản phẩm.
