---
title: "Những lưu ý về bảo mật khi tham gia phát triển dự án phần mềm"
description: "Tổng hợp best practices về bảo mật cho developer, DevOps, QA và quản lý dự án: từ secure coding, secret management đến threat modeling và SDL."
pubDatetime: 2025-11-09T02:55:00+07:00
featured: false
draft: false
tags:
  - security
  - career
  - backend
---

"Security is everyone's responsibility." – Một câu nói quen thuộc, nhưng trong thực tế dự án, lại là điều thường bị quên đi.

Trong các dự án phần mềm hiện nay, bảo mật không chỉ là trách nhiệm của đội Security mà là trách nhiệm của toàn bộ team phát triển, từ Developer, DevOps, QA, quản lý dự án, đến tổ chức.

## 1. Developer – Trách nhiệm bảo mật trong code

- Không để lộ thông tin nhạy cảm: Sử dụng .gitignore, environment variables, secret manager (AWS Secrets Manager, HashiCorp Vault)
- Validate dữ liệu đầu vào: Prepared Statements chống SQL Injection, escape dữ liệu chống XSS
- Sử dụng thư viện an toàn: Quét dependency định kỳ bằng OWASP Dependency Check, Snyk
- Logging đúng cách: Tuyệt đối không log mật khẩu, token JWT, thông tin PII
- Code review và security review: Mọi Pull Request nên được review với checklist bảo mật

## 2. DevOps / Infrastructure – Trách nhiệm bảo mật hạ tầng

- Bảo mật pipeline (CI/CD): Sử dụng secret storage tích hợp sẵn
- Phân quyền môi trường (Principle of Least Privilege): Developer chỉ có quyền với môi trường Dev
- Container và hạ tầng an toàn: Quét image container với Trivy, không chạy container bằng user root
- Giám sát và phản ứng sự cố: Prometheus, Datadog, ELK Stack

## 3. Quản lý dự án – Trách nhiệm bảo mật quy trình

- Thiết lập quy trình bảo mật: "Security Review" là bắt buộc trong Definition of Done
- Quản lý nhân sự và quyền truy cập: SSO, thu hồi quyền truy cập ngay khi nhân viên rời công ty
- Đào tạo và tạo nhận thức: OWASP Top 10, nhận diện email phishing

## 4. QA / Tester – Trách nhiệm bảo mật kiểm thử

- Kiểm thử bảo mật cơ bản: Thử nhập script XSS, SQL injection vào form
- Kiểm thử theo vai trò người dùng: Đảm bảo User A không thể xem thông tin của User B (IDOR)
- Kiểm thử môi trường: Tuyệt đối không dùng dữ liệu thật ở môi trường Staging/Test

## 5. Threat Modeling – Phân tích rủi ro từ đầu

Sử dụng khung STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) để có cái nhìn toàn diện về các mối đe dọa.

## 6. Secure Development Lifecycle (SDL)

- Giai đoạn 1: Lập kế hoạch và Thiết kế – "Security by Design"
- Giai đoạn 2: Triển khai – Secure Coding, SAST, SCA
- Giai đoạn 3: Kiểm thử – DAST, Penetration Testing
- Giai đoạn 4: Triển khai – Pipeline an toàn, hạ tầng hardened
- Giai đoạn 5: Vận hành và Bảo trì – Giám sát liên tục, quản lý lỗ hổng

## 7. AI-assisted Coding – Lưu ý bảo mật

- Review kỹ code do AI gợi ý
- Không để lộ thông tin nhạy cảm khi dùng AI public
- Audit code AI-generated bằng SAST, dependency scan
- Thiết lập chính sách sử dụng AI trong team

## 8. Kết luận

Bảo mật là hành trình liên tục, không phải là đích đến. Nó không thể được "thêm vào" ở cuối dự án mà phải được "dệt" vào từng sợi chỉ của quá trình phát triển. Security isn't something you build once. It's something you maintain every single day.
