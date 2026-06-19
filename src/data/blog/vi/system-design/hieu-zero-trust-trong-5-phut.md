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

Nếu bạn làm việc trong lĩnh vực công nghệ, chắc hẳn đã nghe về Zero Trust – một mô hình bảo mật hiện đại, giúp ngăn chặn hacker và bảo vệ dữ liệu quan trọng. Bài viết này sẽ giúp bạn hiểu Zero Trust nhanh chóng, kèm ví dụ minh họa, ưu nhược điểm và khác biệt với bảo mật truyền thống.

## 1. Bảo mật truyền thống là gì? (Mô hình "Tin cậy ngầm định")

Truyền thống, hầu hết doanh nghiệp dùng mô hình bảo mật kiểu "Lâu đài và Hào nước" (Castle-and-Moat):

- Mạng nội bộ (internal network) được coi là "bên trong lâu đài" - an toàn.
- Hào nước (tường lửa - firewall) được xây dựng ở rìa mạng để ngăn chặn mối đe dọa từ bên ngoài.
- Một khi bạn đã vượt qua được hào nước (kết nối vào mạng nội bộ), bạn được tin tưởng mặc định và có thể truy cập rộng rãi vào nhiều tài nguyên.

Vấn đề: Nếu hacker đánh cắp được thông tin đăng nhập hoặc lây nhiễm mã độc vào một thiết bị bên trong mạng, họ có thể di chuyển ngang (lateral movement) và truy cập toàn bộ hệ thống.

## 2. Zero Trust là gì? (Mô hình "Không tin cậy mặc định")

Định nghĩa đơn giản:

Zero Trust là mô hình bảo mật "Không bao giờ tin tưởng, Luôn luôn xác minh" (Never Trust, Always Verify). Mọi yêu cầu truy cập, dù đến từ bên trong hay bên ngoài mạng, đều được coi là đáng ngờ và phải trải qua quá trình xác minh danh tính, ủy quyền và mã hóa chặt chẽ.

Điều này có nghĩa là:

- Không có "vùng an toàn" mặc định. Ranh giới mạng nội bộ không còn được coi là ranh giới tin cậy.
- Mỗi lần truy cập vào một tài nguyên đều phải được xác thực (authentication), ủy quyền (authorization) và mã hóa.
- Quyền truy cập được cấp theo nguyên tắc tối thiểu (least privilege) và chỉ trong thời gian cần thiết (Just-In-Time).

## 3. Các nguyên tắc cốt lõi của Zero Trust

Theo các khuôn khổ tiêu chuẩn (như của NIST), Zero Trust dựa trên ba trụ cột chính:

1. Xác minh rõ ràng (Verify Explicitly): Luôn xác thực và ủy quyền dựa trên tất cả các điểm dữ liệu có sẵn (danh tính người dùng, vị trí, trạng thái thiết bị, dịch vụ đang truy cập,...).
2. Áp dụng quyền truy cập ít đặc quyền nhất (Use Least Privilege Access): Chỉ cấp quyền truy cập vừa đủ cho người dùng để thực hiện nhiệm vụ của họ và trong thời gian ngắn nhất có thể.
3. Giả định vi phạm (Assume Breach): Thiết kế hệ thống với giả định kẻ tấn công đã ở trong mạng. Từ đó, thực hiện phân đoạn mạng vi mô (micro-segmentation) để ngăn chặn di chuyển ngang, mã hóa dữ liệu và giám sát liên tục để giảm thiểu phạm vi ảnh hưởng của một vụ vi phạm.

## 4. Ví dụ cụ thể

### 4.1 Truy cập email công ty

- Bảo mật truyền thống: Nhân viên trong mạng nội bộ truy cập email mà không cần xác thực thêm.
- Zero Trust: Dù nhân viên đang trong mạng công ty, khi mở email chứa dữ liệu nhạy cảm, hệ thống kiểm tra danh tính (đã đăng nhập SSO chưa), trạng thái thiết bị (đã cài đủ bản vá bảo mật chưa) và có thể yêu cầu xác thực đa yếu tố (MFA) nếu phát hiện ngữ cảnh bất thường.

### 4.2 Truy cập server nội bộ

- Bảo mật truyền thống: Một lần đăng nhập vào mạng là có thể truy cập toàn bộ server trong cùng segment mạng đó.
- Zero Trust: Mỗi server được bảo vệ như một "lâu đài" riêng biệt nhờ phân đoạn mạng vi mô. Truy cập vào server cần được ủy quyền bởi một cổng xác thực tập trung (Identity Provider) và chỉ được cấp nếu người dùng/thuật toán đáp ứng đúng chính sách.

### 4.3 Nhân viên làm việc từ xa

- Bảo mật truyền thống: Dùng VPN để "chui" vào mạng nội bộ, sau đó được tin tưởng và có quyền truy cập rộng.
- Zero Trust: Thay vì VPN truyền thống, nhân viên kết nối trực tiếp đến từng ứng dụng thông qua các proxy bảo mật (VD: ZTNA - Zero Trust Network Access). Hệ thống liên tục đánh giá rủi ro (địa điểm đăng nhập, hành vi) và có thể chặn truy cập nếu phát hiện bất thường, ngay cả khi đã xác thực thành công.

## 5. Zero Trust vs Bảo mật truyền thống

| Tiêu chí          | Bảo mật truyền thống (Castle-and-Moat)  | Zero Trust                                                |
| ----------------- | --------------------------------------- | --------------------------------------------------------- |
| Triết lý          | "Tin tưởng, sau đó kiểm tra"            | "Không bao giờ tin tưởng, Luôn luôn xác minh"             |
| Ranh giới tin cậy | Tại rìa mạng (network perimeter)        | Tại từng tài nguyên (user, device, app, data)             |
| Xác thực          | Một lần khi vào mạng                    | Xác minh liên tục và theo ngữ cảnh cho mỗi phiên truy cập |
| Quyền truy cập    | Thường được cấp rộng rãi theo vùng mạng | Nguyên tắc tối thiểu (Least Privilege) và Just-In-Time    |
| Bảo vệ dữ liệu    | Tập trung vào phòng thủ rìa             | Phân đoạn vi mô (Micro-segmentation) và mã hóa mọi nơi    |
| Giả định          | Mối đe dọa đến từ bên ngoài             | Giả định vi phạm (Assume Breach)                          |

## 6. Kết luận

Zero Trust không phải là một sản phẩm, mà là một chiến lược và khuôn khổ bảo mật. Nó là lựa chọn tất yếu cho kỷ nguyên làm việc từ xa, điện toán đám mây và các mối đe dọa tinh vi hiện nay.

Mô hình này yêu cầu một sự thay đổi tư duy từ "Tin tưởng mặc định" sang "Xác minh liên tục", giúp các tổ chức bảo vệ dữ liệu và ứng dụng của mình một cách linh hoạt và hiệu quả hơn, bất kể chúng nằm ở đâu.

Nói một cách vui vẻ: Zero Trust là kiểu "luôn cảnh giác với tất cả mọi người, kể cả chính mình", nhưng đổi lại, nó tạo ra một hệ thống phòng thủ có khả năng phát hiện và ngăn chặn đe dọa vượt trội.
