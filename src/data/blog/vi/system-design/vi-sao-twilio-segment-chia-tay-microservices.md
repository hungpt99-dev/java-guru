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

## 1. Khởi đầu đầy hoài bão

Segment ra đời trong thời kỳ "mọi thứ đều nên là microservices."

Họ xây dựng một hệ thống ingest data để thu thập hàng trăm nghìn events mỗi giây từ web, mobile và backend apps, rồi phân phối chúng tới hàng trăm destinations như Google Analytics, Mixpanel, Facebook Ads, hay webhooks tùy chỉnh.

Kiến trúc ban đầu rất straightforward:

- API service nhận event, đẩy vào queue.
- Khi dequeue, hệ thống check user config để quyết định gửi tới những destinations nào.
- Mỗi request được gửi tuần tự; nếu failure thì retry, nếu lỗi không thể retry (invalid credential, thiếu field) thì drop.

Thời điểm đó, microservices có vẻ là con đường sáng: mỗi phần tách riêng, dễ debug, dễ scale. Nhưng mọi thứ không duy trì lâu.

## 2. Khi mọi thứ bắt đầu rối tung

### Head-of-line blocking

Problem đầu tiên xuất hiện: head-of-line blocking.

Tất cả events mới và retry cùng nằm trong một queue lớn. Nếu một destination external bị timeout hoặc rate limit, retry events quay lại queue → backlog kéo dài. Kết quả: latency tăng cho tất cả destinations, kể cả những cái chạy bình thường.

### Tách queue và service cho từng destination

Để giảm blocking, Segment tạo một queue + service riêng cho mỗi destination. Router mới xuất hiện: nó nhận event, clone và gửi tới từng queue destination.

Điều này giúp isolate tốt hơn: một destination có lỗi thì chỉ ảnh hưởng tới queue của nó, không kéo cả hệ thống chậm lại. Nhưng mặt trái bắt đầu lộ rõ.

### Shared library và dependency hell

Ban đầu, tất cả destinations nằm trong một repo lớn. Kết quả: một test fail có thể làm hỏng test toàn bộ system. Để tách biệt, họ move mỗi destination sang một repo riêng.

Nhưng vấn đề là: code trùng lặp khắp nơi. Họ xây shared library để xử lý logic chung như transform events, HTTP handling. Tuy nhiên:

- Update shared library đòi hỏi nâng version ở nhiều repo.
- Không có strict versioning → mỗi destination dùng một version khác nhau.
- Một số destinations có traffic thấp → auto-scaling không hiệu quả, hoặc phải scale thủ công khi spike.

Cứ thế, số lượng repos, queues, versions, và test suites bùng nổ. Operational overhead trở thành ác mộng.

## 3. Khi microservices trở thành gánh nặng

Một vài số liệu cho thấy Microservices ăn mòn productivity:

- Số lượng destinations tăng từ vài chục lên hơn 100+.
- Trung bình mỗi tháng, team phải build thêm 3 destinations mới → đồng nghĩa queue, repo, service mới.
- Có lúc cần 3 engineers full-time chỉ để "giữ cho hệ thống sống sót."
- Shared library cải tiến rất ít: chỉ 32 lần trong vài năm vì mỗi lần update là cả cơn ác mộng release.

Microservices giờ đây không còn là động cơ tăng trưởng, mà trở thành rào cản cho product velocity.

## 4. Quyết định ngược dòng: về lại Monolith

Segment quyết định: gom tất cả lại. Nhưng không phải quay lại "Big Ball of Mud," mà là một modular monolith.

### Centrifuge – router trung tâm

Họ xây Centrifuge, một router thay thế hệ thống cũ. Centrifuge nhận event và phân phối tới một delivery service duy nhất, thay cho hàng chục queue + service riêng biệt.

### Monorepo

Họ merge toàn bộ code vào monorepo. Tất cả dependencies hợp nhất về một version duy nhất (khoảng 120 unique libraries). Nếu destination nào incompatible thì fix ngay, thay vì để mỗi repo trôi theo một version riêng.

Kết quả: build & test nhất quán, không còn "version zoo."

### Traffic Recorder

Testing cũng được overhaul. Thay vì mỗi lần run test phải gọi ra external API (flaky, timeout, credential error), họ dùng traffic recorder dựa trên yakbak:

- Lần đầu run test → ghi lại HTTP request + response.
- Lần sau → replay lại, không cần gọi ra ngoài.

Nhờ vậy, test suite cho 140+ destinations chạy nhanh chóng, reliable, mất vài mili-giây thay vì vài phút hoặc thậm chí fail ngẫu nhiên.

## 5. Kết quả: productivity bật lên

Khi monolith lên sóng:

- Developer productivity tăng: chỉ trong một năm họ thực hiện 46 cải tiến shared library, so với 32 trong nhiều năm khi còn microservices.
- Ops load giảm mạnh: thay vì monitor hàng trăm queues & services, giờ chỉ cần monitor một system chính. Worker pool lớn phục vụ mixed traffic tốt hơn, scaling hiệu quả hơn.
- Deploy đơn giản: một thay đổi nhỏ trong shared library giờ chỉ cần deploy một service duy nhất.
- Stability tăng: ít on-call, ít sự cố lúc nửa đêm.

## 6. Trade-offs cần chấp nhận

Monolith không hoàn hảo. Segment thừa nhận một số nhược điểm:

| Issue              | Detail                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fault isolation    | Bug trong một destination có thể crash toàn bộ service vì tất cả chạy chung.                                                                                 |
| Warm cache         | Với microservices nhỏ, in-memory cache dễ warm, cache hit rate cao. Monolith nhiều process hơn → cache phân tán, khó warm đồng đều, cache hit rate thấp hơn. |
| Dependency updates | Khi update một shared library, ảnh hưởng đồng loạt đến tất cả destinations. Nếu test chưa đủ, rủi ro lan rộng.                                               |

Họ chấp nhận trade-offs vì lợi ích về velocity và simplicity lớn hơn.

## 7. Bài học rút ra

Câu chuyện của Segment mang nhiều ý nghĩa cho dev, tech lead, và CTO:

- Architecture là công cụ, không phải giáo điều. Microservices nghe sexy, nhưng không phải lúc nào cũng phù hợp.
- Modular monolith là lựa chọn hợp lý. Nó cho phép codebase lớn nhưng vẫn tách module, testable và maintainable.
- Tooling quan trọng hơn hype. Traffic recorder, monorepo build, CI/CD pipeline… quyết định thành bại.
- Trade-off là tất yếu. Không có kiến trúc hoàn hảo. Quan trọng là chọn cái phù hợp với stage và team capability.

## 8. Kết luận

Twilio Segment từng "ôm mộng" microservices: mỗi destination một service, mỗi service một queue, mỗi repo một thế giới riêng. Nhưng khi scale lên hàng trăm services, microservices trở thành "cơn ác mộng nhỏ": overhead, chậm chạp, fragile.

Họ chọn một bước đi táo bạo: gom tất cả vào một modular monolith, với Centrifuge, monorepo, và traffic recorder. Kết quả: velocity tăng, stability cao, ops nhẹ hơn.

Bài học lớn nhất:

👉 Đừng chọn kiến trúc vì hype. Chọn kiến trúc vì team bạn có thể sống được với nó.

Nguồn tham khảo

Twilio Segment – Goodbye Microservices: https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices
