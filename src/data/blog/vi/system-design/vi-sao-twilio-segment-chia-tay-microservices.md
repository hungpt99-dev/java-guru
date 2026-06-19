---
title: "Vì sao Twilio Segment nói lời chia tay Microservices và quay về Monolith"
description: "Phân tích case study Twilio Segment: từ kiến trúc microservices với hàng trăm service đến quyết định quay về modular monolith."
pubDatetime: 2025-09-20T04:31:00+07:00
featured: false
draft: false
tags:
  - microservices
  - system-design
---

Segment ra đời trong thời kỳ "mọi thứ đều nên là microservices." Họ xây dựng một hệ thống ingest data để thu thập hàng trăm nghìn events mỗi giây từ web, mobile và backend apps, rồi phân phối chúng tới hàng trăm destinations như Google Analytics, Mixpanel, Facebook Ads.

Kiến trúc ban đầu rất straightforward: API service nhận event, đẩy vào queue. Khi dequeue, hệ thống check user config để quyết định gửi tới những destinations nào.

## 2. Khi mọi thứ bắt đầu rối tung

### Head-of-line blocking

Tất cả events mới và retry cùng nằm trong một queue lớn. Nếu một destination external bị timeout hoặc rate limit, retry events quay lại queue → backlog kéo dài. Kết quả: latency tăng cho tất cả destinations.

### Tách queue và service cho từng destination

Để giảm blocking, Segment tạo một queue + service riêng cho mỗi destination. Router mới xuất hiện: nó nhận event, clone và gửi tới từng queue destination. Điều này giúp isolate tốt hơn.

### Shared library và dependency hell

Ban đầu, tất cả destinations nằm trong một repo lớn. Kết quả: một test fail có thể làm hỏng test toàn bộ system. Để tách biệt, họ move mỗi destination sang một repo riêng. Nhưng code trùng lặp khắp nơi. Họ xây shared library để xử lý logic chung. Tuy nhiên update shared library đòi hỏi nâng version ở nhiều repo. Không có strict versioning → mỗi destination dùng một version khác nhau.

## 3. Khi microservices trở thành gánh nặng

- Số lượng destinations tăng từ vài chục lên hơn 100+
- Trung bình mỗi tháng, team phải build thêm 3 destinations mới
- Có lúc cần 3 engineers full-time chỉ để "giữ cho hệ thống sống sót"
- Shared library cải tiến rất ít: chỉ 32 lần trong vài năm

## 4. Quyết định ngược dòng: về lại Monolith

Segment quyết định gom tất cả lại. Nhưng không phải quay lại "Big Ball of Mud," mà là một modular monolith.

### Centrifuge – router trung tâm

Họ xây Centrifuge, một router thay thế hệ thống cũ. Centrifuge nhận event và phân phối tới một delivery service duy nhất.

### Monorepo

Họ merge toàn bộ code vào monorepo. Tất cả dependencies hợp nhất về một version duy nhất (khoảng 120 unique libraries).

### Traffic Recorder

Testing cũng được overhaul. Thay vì mỗi lần run test phải gọi ra external API, họ dùng traffic recorder dựa trên yakbak: lần đầu run test → ghi lại HTTP request + response. Lần sau → replay lại.

## 5. Kết quả

- Developer productivity tăng: 46 cải tiến shared library trong một năm
- Ops load giảm mạnh: thay vì monitor hàng trăm queues & services, giờ chỉ cần monitor một system chính
- Deploy đơn giản: một thay đổi nhỏ trong shared library giờ chỉ cần deploy một service duy nhất

## 6. Trade-offs

- Fault isolation: Bug trong một destination có thể crash toàn bộ service
- Warm cache: Monolith nhiều process hơn → cache phân tán, khó warm đồng đều
- Dependency updates: Khi update shared library, ảnh hưởng đồng loạt

## 7. Bài học rút ra

1. Architecture là công cụ, không phải giáo điều
2. Modular monolith là lựa chọn hợp lý
3. Tooling quan trọng hơn hype
4. Trade-off là tất yếu

## 8. Kết luận

Đừng chọn kiến trúc vì hype. Chọn kiến trúc vì team bạn có thể sống được với nó.
