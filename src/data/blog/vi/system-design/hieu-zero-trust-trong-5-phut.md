---
title: "Hiểu Zero Trust trong 5 phút"
description: "Giải thích Zero Trust security model: nguyên tắc cốt lõi, so sánh với bảo mật truyền thống và ví dụ thực tế."
pubDatetime: 2025-09-03T10:12:00+07:00
featured: false
draft: false
tags:
  - system-design
  - security
---

Nếu bạn làm việc trong lĩnh vực công nghệ, chắc hẳn đã nghe về Zero Trust – một mô hình bảo mật hiện đại, giúp ngăn chặn hacker và bảo vệ dữ liệu quan trọng.

## 1. Bảo mật truyền thống là gì? (Mô hình "Lâu đài và Hào nước")

Truyền thống, hầu hết doanh nghiệp dùng mô hình bảo mật kiểu "Castle-and-Moat":

- Mạng nội bộ được coi là "bên trong lâu đài" - an toàn
- Hào nước (tường lửa) được xây dựng ở rìa mạng
- Một khi bạn đã vượt qua được hào nước, bạn được tin tưởng mặc định

Vấn đề: Nếu hacker đánh cắp được thông tin đăng nhập, họ có thể di chuyển ngang (lateral movement) và truy cập toàn bộ hệ thống.

## 2. Zero Trust là gì?

Zero Trust là mô hình bảo mật "Không bao giờ tin tưởng, Luôn luôn xác minh" (Never Trust, Always Verify). Mọi yêu cầu truy cập, dù đến từ bên trong hay bên ngoài mạng, đều được coi là đáng ngờ và phải trải qua quá trình xác minh danh tính, ủy quyền và mã hóa chặt chẽ.

## 3. Các nguyên tắc cốt lõi

1. Xác minh rõ ràng (Verify Explicitly): Luôn xác thực và ủy quyền dựa trên tất cả các điểm dữ liệu có sẵn
2. Áp dụng quyền truy cập ít đặc quyền nhất (Use Least Privilege Access)
3. Giả định vi phạm (Assume Breach): Thiết kế hệ thống với giả định kẻ tấn công đã ở trong mạng

## 4. Ví dụ cụ thể

- Truy cập email công ty: Dù nhân viên đang trong mạng công ty, hệ thống vẫn kiểm tra danh tính, trạng thái thiết bị
- Nhân viên làm việc từ xa: Thay vì VPN truyền thống, kết nối trực tiếp đến từng ứng dụng thông qua ZTNA (Zero Trust Network Access)

## 5. So sánh Zero Trust vs Bảo mật truyền thống

| Tiêu chí          | Bảo mật truyền thống         | Zero Trust                                    |
| ----------------- | ---------------------------- | --------------------------------------------- |
| Triết lý          | "Tin tưởng, sau đó kiểm tra" | "Không bao giờ tin tưởng, Luôn luôn xác minh" |
| Ranh giới tin cậy | Tại rìa mạng                 | Tại từng tài nguyên                           |
| Xác thực          | Một lần khi vào mạng         | Xác minh liên tục và theo ngữ cảnh            |
| Quyền truy cập    | Cấp rộng rãi theo vùng mạng  | Nguyên tắc tối thiểu (Least Privilege)        |

## 6. Kết luận

Zero Trust không phải là một sản phẩm, mà là một chiến lược và khuôn khổ bảo mật. Nó là lựa chọn tất yếu cho kỷ nguyên làm việc từ xa, điện toán đám mây và các mối đe dọa tinh vi hiện nay.
