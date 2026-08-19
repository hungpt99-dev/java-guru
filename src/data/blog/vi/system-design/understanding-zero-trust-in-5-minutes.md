---
title: "Zero Trust: Nguyên tắc và ví dụ thực tế"
description: "Giới thiệu thực tế về Zero Trust, gồm các nguyên tắc chính, khác biệt với bảo mật dựa trên vành đai mạng, và các tình huống truy cập điển hình."
pubDatetime: 2025-09-03T10:12:00+07:00
featured: false
draft: false
tags:
  - system-design
  - security
---

Zero Trust là cách tiếp cận bảo mật dành cho các hệ thống có user, device, service và data phân tán trên mạng doanh nghiệp, cloud và Internet công cộng. Phần khó không nằm ở việc nhắc lại nguyên tắc; vấn đề là xác định cần kiểm tra gì cho từng request, giới hạn quyền truy cập ra sao và hệ thống phải phản ứng thế nào khi context thay đổi.

Bài viết này giải thích sự khác nhau giữa bảo mật dựa trên vành đai mạng và Zero Trust, giới thiệu các nguyên tắc chính, rồi áp dụng chúng vào một số tình huống truy cập phổ biến.

## 1. Bảo mật dựa trên vành đai và implicit trust

**[SOURCE FACT]** Trong thiết kế enterprise truyền thống, internal network thường được xem là vùng đáng tin cậy hơn public Internet. Firewall bảo vệ vành đai mạng, còn user hoặc device đã vào được mạng có thể được cấp quyền chủ yếu dựa trên vị trí mạng.

Mô hình này thường được mô tả là castle-and-moat:

- Internal network là khu vực bên trong vành đai.
- Firewall là boundary lọc traffic từ bên ngoài.
- Quyền truy cập mạng có thể trở thành proxy cho trust.

**[ANALYSIS]** Sau khi một account bị chiếm hoặc một device bên trong bị nhiễm mã độc, mô hình này làm lateral movement dễ hơn. Vượt qua vành đai không chứng minh request là hợp lệ, device an toàn hay user cần truy cập mọi resource có thể kết nối.

## 2. Zero Trust là gì?

**[SOURCE FACT]** Zero Trust thường được tóm tắt bằng nguyên tắc "never trust, always verify". Mô hình này không xem vị trí mạng là bằng chứng đủ để tin cậy. Mỗi access request được đánh giá dựa trên identity, authorization policy, context của device và request, cùng các security control cần thiết cho resource.

Trong thực tế:

- Không có internal zone được tin cậy vĩnh viễn.
- Mỗi resource phải tự thực thi authentication và authorization.
- Encryption bảo vệ communication khi phù hợp.
- Quyền truy cập tuân theo least privilege và nên được giới hạn về phạm vi, thời lượng khi hệ thống hỗ trợ.

Zero Trust không có nghĩa là yêu cầu nhập password cho mọi request. Việc verify có thể sử dụng session hiện có, service identity, device posture, risk signal và step-up authentication như MFA khi policy yêu cầu.

## 3. Các nguyên tắc chính

**[SOURCE FACT]** Ba nguyên tắc dưới đây là cách tóm tắt ngắn gọn và phổ biến về hướng dẫn Zero Trust:

1. **Verify explicitly.** Authentication và authorization dựa trên các signal sẵn có, chẳng hạn user identity, device state, location, service được yêu cầu và request context.
2. **Use least privilege.** Chỉ cấp permission cần cho task. Giới hạn scope và lifetime của quyền khi hệ thống hỗ trợ, bao gồm Just-In-Time access.
3. **Assume breach.** Thiết kế với giả định attacker có thể đã chiếm quyền truy cập vào một phần environment. Dùng micro-segmentation, encryption, logging và continuous monitoring để giảm lateral movement và blast radius của incident.

Các nguyên tắc này là design constraint, không phải một product duy nhất. Identity provider, policy engine, endpoint control, service-to-service authentication, network control và monitoring đều có thể là một phần của implementation.

## 4. Các tình huống truy cập

### 4.1 Email công ty

**[ANALYSIS]** Trong thiết kế dựa trên vành đai, việc ở trong internal network có thể đã đủ để truy cập email hoặc làm giảm mức verification bổ sung cần thiết.

**[PROPOSED DESIGN]** Email service có thể đánh giá SSO session của user, device posture, request context và độ nhạy của resource. Service có thể yêu cầu MFA khi policy phát hiện risk tăng cao, đồng thời hạn chế truy cập nếu device không đạt security state yêu cầu.

### 4.2 Internal server

**[ANALYSIS]** Một network login làm lộ rộng cả server segment sẽ tạo thêm các đường lateral movement không cần thiết. Network reachability không tương đương với authorization.

**[PROPOSED DESIGN]** Xem mỗi server hoặc service là một resource được bảo vệ riêng. Identity provider và policy enforcement point có thể authorize một user, workload hoặc automation client cụ thể cho một operation cụ thể. Micro-segmentation giảm số resource có thể reachable ngay cả khi một credential bị compromise.

### 4.3 Nhân sự làm việc từ xa

**[ANALYSIS]** VPN truyền thống có thể cấp cho user network-level connectivity, nhưng connectivity không cho biết chính xác user cần application hoặc action nào.

**[PROPOSED DESIGN]** Zero Trust Network Access (ZTNA) có thể expose từng application qua security proxy thay vì đưa user trực tiếp vào internal network. Policy có thể đánh giá location, device state và behavior; đồng thời deny hoặc yêu cầu step-up verification sau authentication nếu context trở nên bất thường.

## 5. Zero Trust và bảo mật dựa trên vành đai

| Tiêu chí | Bảo mật dựa trên vành đai | Zero Trust |
| --- | --- | --- |
| Trust model | Vị trí mạng cung cấp signal trust ban đầu | Mỗi request được đánh giá explicitly |
| Trust boundary | Chủ yếu là vành đai mạng | Resource cụ thể và access policy của resource đó |
| Authentication | Thường tập trung ở thời điểm vào mạng | Dựa trên identity, context và session của resource được yêu cầu |
| Authorization | Có thể cấp rộng trong một network zone | Least privilege, có Just-In-Time access khi phù hợp |
| Containment | Perimeter control giới hạn việc xâm nhập từ bên ngoài | Segmentation, encryption và monitoring giới hạn movement và impact |
| Security assumption | Internal network đáng tin cậy hơn | Giả định một phần environment có thể đã bị compromise |

Bảng này mô tả các khuynh hướng thiết kế, không khẳng định mọi hệ thống legacy hay modern đều triển khai hai mô hình theo đúng cách này.

## 6. Kết luận

Zero Trust là một security strategy và tập hợp design principle, không phải một product. Thay đổi cốt lõi là không còn dùng network location làm quyết định authorization mặc định. Thay vào đó, mỗi resource đánh giá identity, context, policy và mức permission tối thiểu cần cho operation.

Cách tiếp cận này phù hợp với remote access, cloud service, internal application và service-to-service communication. Nó không loại bỏ breach. Mục tiêu là giảm khả năng một account hoặc device bị compromise dẫn đến quyền truy cập quá rộng, đồng thời giúp tổ chức quan sát và kiểm soát access decision cũng như security event tốt hơn.
