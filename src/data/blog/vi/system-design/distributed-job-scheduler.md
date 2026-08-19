---
title: "Thiết kế Bộ Lập lịch Công việc Phân tán (Distributed Job Scheduler)"
description: "Thiết kế vận hành cho cron có nhận biết múi giờ, công việc một lần và workflow DAG với thực thi ít nhất một lần và khả năng khôi phục có kiểm toán."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Bài toán

Cần xây dựng một bộ lập lịch đa tenant cho pipeline dữ liệu, tác vụ tính cước, thông báo và bảo trì. Người dùng có thể định nghĩa lịch cron, yêu cầu một run một lần hoặc ghép các task thành đồ thị có hướng không chu kỳ (DAG). Bộ lập lịch xác định khi nào một run đến hạn và điều phối việc dispatch đến các cụm worker. Nó không trực tiếp thực thi business logic.

Yêu cầu chức năng:

- Hỗ trợ biểu thức cron, timestamp một lần và dependency của DAG.
- Cung cấp cơ chế thực thi ít nhất một lần. Worker có thể nhận lại cùng một run sau timeout hoặc failover.
- Retry bằng exponential backoff có giới hạn và jitter. Khi vượt giới hạn của policy, chuyển run sang trạng thái dead-letter.
- Quy định rõ hành vi catch-up. Sau downtime, các occurrence bị lỡ có thể được replay, coalesce hoặc bỏ qua theo policy của schedule.
- Áp dụng bộ quy tắc múi giờ IANA, bao gồm các thời điểm chuyển giờ mùa hè. Một giờ địa phương xuất hiện hai lần phải giữ offset tương ứng; một giờ không tồn tại phải tuân theo policy skip đã khai báo.

Yêu cầu phi chức năng:

- Tránh duplicate execution âm thầm. Nền tảng ngăn các logical dispatch trùng nhau, nhưng mã job vẫn phải idempotent: delivery ít nhất một lần không thể ngăn worker cũ hoàn tất sau timeout.
- Phát hiện task bị lỡ, lưu audit history, scale ngang, cô lập tenant và hỗ trợ khôi phục thảm họa theo vùng.
- Mục tiêu availability là 99.95% cho việc đánh giá schedule và control API, cùng mục tiêu 99.9% cho dispatch latency trong tải bình thường. Ở p99, run đến hạn nên được đưa vào queue trong vòng 30 giây kể từ due instant.

Người dùng là các team nền tảng và service owner. Họ cần bản ghi bền vững về run dự kiến, từng lần dispatch, attempt đã thực thi và lý do run bị bỏ qua hoặc trì hoãn.

## 2. Ước tính quy mô

Giả định có 2.000 tenant và 10.000 schedule đang hoạt động. Đây là quy mô khởi đầu có chủ ý ở mức vừa phải: đủ tạo áp lực vận hành nhưng vẫn cho phép database chính làm nguồn chuẩn cho trạng thái scheduler. Giả định mỗi tenant trung bình có 25 thao tác API mỗi ngày, gồm sửa schedule, truy vấn run và trigger thủ công.

- Lưu lượng API = `2,000 DAU x 25 requests/day = 50,000 requests/day`.
- Tốc độ API trung bình = `50,000 / 86,400 = 0.58 RPS`. Thiết kế cho đỉnh `10x = 5.8 RPS`, làm tròn thành 10 RPS để hấp thụ burst.
- Nếu mỗi schedule tạo 100 occurrence/ngày, số occurrence là `10,000 x 100 = 1,000,000 occurrences/day`, hay trung bình `11.6` occurrence/giây. Burst theo thời gian 10x tạo ra 116 due event/giây.
- Nếu 2% occurrence cần retry, tổng dispatch-attempt event là `1,000,000 x 1.02 = 1.02 million/day`. Với 1,5 KB mỗi event, event log khoảng `1.53 GB/day`, hay `1.67 TB` trong ba năm trước compression và replica.
- Một authoritative run row trung bình 1 KB. Với 1,02 triệu attempt cộng metadata, hot storage trong 30 ngày xấp xỉ `1.02M x 1 KB x 30 = 30.6 GB`, chưa tính index và replica. Dự phòng 3x, tức 92 GB.
- Nếu 5% run tạo 20 KB log và lưu trong 30 ngày, log ingress là `1.02M x 0.05 x 20 KB = 1.02 GB/day`. Log nên nằm trong object storage, không phải transactional database.
- Ở đỉnh 116 event/giây, dispatch event 1,5 KB chỉ tạo ra `174 KB/s`, tương đương 1,4 Mbps, trước replication. Cấp 10 Mbps cho mỗi hướng broker để có dư địa cho metadata workflow và burst.
- Tỷ lệ đọc control so với attempt trong điều kiện bình thường gần 20:1.
