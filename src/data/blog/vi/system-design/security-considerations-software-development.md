---
title: "Trách nhiệm bảo mật trong toàn bộ vòng đời phát triển phần mềm"
description: "Các trách nhiệm bảo mật thực tế dành cho developer, DevOps, QA, quản lý dự án và tổ chức, từ secure coding và quản lý secret đến kiểm thử theo mối đe dọa và ứng phó sự cố."
pubDatetime: 2025-11-09T02:55:00+07:00
featured: false
draft: false
tags:
  - security
  - career
  - backend
---

Bảo mật là trách nhiệm chung của đội ngũ kỹ thuật. Ai cũng có thể đồng ý với câu này nhưng trên thực tế vẫn giao toàn bộ vấn đề cho một nhóm chuyên trách. Rủi ro có thể xuất hiện ở mọi giai đoạn: developer commit nhầm credential, pipeline làm lộ secret, tester sao chép dữ liệu production vào môi trường test, hoặc operator để quên một port không cần thiết đang mở.

Điểm khó không phải là ghi nhớ một danh sách công cụ. Vấn đề là áp dụng đúng biện pháp kiểm soát xuyên suốt Software Development Lifecycle (SDLC), thay vì xem security như một cổng kiểm tra cuối cùng. Bài viết này phân chia trách nhiệm giữa developer, DevOps và hạ tầng, quản lý dự án, QA và tổ chức. Những phần phù hợp được tách thành thông tin nguồn, phân tích và thiết kế đề xuất.

## 1. Developer: Bảo mật trong code

> **[SOURCE FACT]** Tài liệu nguồn xác định các rủi ro thường gặp ở cấp developer gồm lộ credential, không validate input, dependency có lỗ hổng, logging không an toàn và review không đầy đủ.

### Bảo vệ secret

Không commit `.env`, `appsettings.json`, `config.yml`, mật khẩu database, API key hoặc secret key vào repository. Repository public không phải mối lo duy nhất: credential còn có thể bị lộ qua build log, chat, email hoặc artifact.

Dùng `.gitignore` để loại các file cấu hình local khỏi repository, nhưng không xem nó là hệ thống quản lý secret. Dùng environment variable trên máy local và trong pipeline CI/CD. Với secret dùng chung hoặc secret production, dùng secret manager chuyên dụng như AWS Secrets Manager, HashiCorp Vault hoặc Azure Key Vault. Các công cụ scan repository như GitGuardian và TruffleHog có thể hỗ trợ phát hiện credential bị commit nhầm.

**[ANALYSIS]** Một secret đã bị phát hiện nên được xem là đã lộ. Xóa dòng đó khỏi commit mới nhất không nhất thiết xóa nó khỏi lịch sử repository hoặc khỏi những bản sao đã được tạo. Cách xử lý phù hợp là revoke hoặc rotate credential, sau đó kiểm tra các nơi credential có thể đã được sử dụng.

### Validate input và output

Không bao giờ tin tưởng input từ client. Validate ở server theo một schema rõ ràng, đồng thời áp dụng ràng buộc về type, format, length và range.

- Dùng Prepared Statement, còn gọi là parameterized query, hoặc ORM được sử dụng đúng cách như Hibernate hay Eloquent để giảm rủi ro SQL injection.
- Escape dữ liệu theo context đầu ra trước khi render HTML để giảm rủi ro Cross-Site Scripting (XSS). React, Vue và Angular có các mặc định hữu ích, nhưng những mặc định đó không làm mọi đường render đều an toàn.
- Validate request body của API bằng schema library như Joi, Yup hoặc Pydantic.

Validation và output encoding giải quyết hai vấn đề khác nhau. Validation giới hạn dữ liệu ứng dụng chấp nhận; encoding ngăn dữ liệu đã được chấp nhận bị diễn giải thành markup hoặc code trong một output context cụ thể.

### Quản lý dependency

Ứng dụng cũng kế thừa rủi ro từ dependency. Một package open-source độc hại hoặc có lỗ hổng có thể trở thành vector cho supply-chain attack.

Định kỳ scan dependency bằng OWASP Dependency-Check, Snyk hoặc GitHub Dependabot. Ưu tiên các library được duy trì và có cộng đồng đã hình thành, đồng thời áp dụng security patch khi có. Vẫn cần review thay đổi thay vì update một cách mù quáng; compatibility và transitive dependency phải được kiểm tra.

### Logging có chủ đích

Không log password, số thẻ thanh toán, Personally Identifiable Information (PII), access token hoặc JWT. Log là dữ liệu vận hành và phải được xử lý tương ứng.

Trong production, trả về lỗi tổng quát cho người dùng và không đưa stack trace chi tiết vào response. Dữ liệu chẩn đoán chi tiết có thể làm lộ cấu trúc code, thông tin database hoặc chi tiết triển khai khác. Khi cần điều tra, giữ dữ liệu đó trong server-side log được bảo vệ.

### Code review và security review

Mỗi Pull Request hoặc Merge Request nên được một người khác review, sử dụng checklist bảo mật phù hợp với thay đổi. Công cụ Static Application Security Testing (SAST) như SonarQube và Checkmarx có thể tự động phát hiện vấn đề tiềm ẩn, nhưng không thay thế human review hoặc runtime testing.

## 2. DevOps và hạ tầng: Bảo mật trong delivery và vận hành

> **[SOURCE FACT]** Tài liệu nguồn khuyến nghị bảo vệ biến CI/CD, áp dụng least privilege, chạy container không phải root, scan lỗ hổng, mã hóa kết nối, giới hạn network access, monitoring, centralized logging và incident response plan.

### Bảo vệ pipeline CI/CD

Không hardcode secret trong pipeline script hoặc cấu hình đã commit vào repository. Dùng secret storage của nền tảng CI/CD, chẳng hạn GitHub Secrets, GitLab CI Variables hoặc Azure DevOps Secret Variables.

**[PROPOSED DESIGN]** Yêu cầu approval trước khi deploy production nếu mức rủi ro và operating model của dự án phù hợp với bước này. Giới hạn deployment credential theo đúng action và environment mà pipeline cần.

### Áp dụng least privilege



### Hardening container và network path

Scan container image trước khi deploy bằng các công cụ như Trivy hoặc Grype. Cấu hình container chạy bằng một user non-root cụ thể nếu ứng dụng cho phép.

Dùng TLS cho các kết nối cần mã hóa khi truyền. Cấu hình security group và firewall chỉ cho phép traffic từ source cần thiết, trên path cần thiết. Mã hóa và giới hạn network là hai lớp kiểm soát bổ sung; lớp này không thay thế lớp kia.

### Monitoring và ứng phó

Dùng hệ thống monitoring như Prometheus hoặc Datadog và centralized logging như ELK Stack khi phù hợp với môi trường. Đặt alert cho các tín hiệu như nhiều lần đăng nhập thất bại lặp lại hoặc traffic tăng đột biến ngoài dự kiến.

**[PROPOSED DESIGN]** Duy trì Incident Response Plan, trong đó quy định cách đội ngũ phát hiện, cô lập, điều tra, truyền thông và khôi phục sau sự cố. Xác định trước trách nhiệm và đường escalation, thay vì chờ đến khi sự cố xảy ra.

## 3. Quản lý dự án: Bảo mật trong quy trình và quyền truy cập

> **[SOURCE FACT]** Tài liệu nguồn đặt security review, quản lý quyền truy cập của nhân sự và security awareness trong trách nhiệm của dự án và tổ chức.

### Đưa security vào Definition of Done

Đưa security review vào Definition of Done (DoD) cho mỗi user story khi thay đổi có ảnh hưởng đến security. Một checklist ngắn hữu ích hơn một quy trình chỉ tồn tại trong tài liệu policy. Checklist có thể bao quát authentication và authorization, xử lý input, secret, logging, data exposure, dependency và thay đổi vận hành.

### Quản lý quyền truy cập của nhân sự

Dùng Single Sign-On (SSO) khi có thể. Revoke quyền sớm khi một người chuyển team hoặc rời công ty. Review quyền truy cập theo quý, đúng như tài liệu nguồn nêu, và xóa các quyền không còn có lý do hợp lệ.

### Đào tạo và khuyến khích báo cáo

Tổ chức các buổi chia sẻ nội bộ về những chủ đề như OWASP Top 10 và nhận diện phishing. Tạo môi trường an toàn để báo cáo vulnerability và sai sót. Báo cáo sớm giúp đội ngũ rotate credential, giới hạn phạm vi lộ lọt và sửa vấn đề trước khi nó trở thành sự cố lớn hơn.

## 4. QA và testing: Bảo mật trong verification và test data

> **[SOURCE FACT]** Tài liệu nguồn khuyến nghị các kiểm tra theo hướng tấn công cơ bản, kiểm thử authorization, scan bằng OWASP ZAP và dùng dữ liệu tổng hợp trong staging và test.

### Test các dạng tấn công input phổ biến

Test form và API bằng các case tập trung vào security. Ví dụ, chuỗi test XSS là `<script>alert('XSS')</script>`, còn chuỗi test SQL injection là `' OR '1'='1`. Đây là input để kiểm thử, không phải bằng chứng hệ thống có vulnerability. Dùng OWASP ZAP để tự động scan khi phù hợp và kiểm tra thủ công các phát hiện.

### Test authorization, không chỉ authentication

Xác minh một user không thể truy cập dữ liệu của user khác bằng cách đổi identifier trong URL hoặc request. Trường hợp này thường được gọi là Insecure Direct Object Reference (IDOR). Test cả quyền của regular user và administrator, bao gồm việc gọi trực tiếp endpoint thay vì chỉ thao tác qua giao diện.

### Giữ test data an toàn

Không dùng dữ liệu customer thật trong staging hoặc test. Thay vào đó, tạo dữ liệu giả. Nếu dự án có nhu cầu cụ thể phải dùng dữ liệu dẫn xuất, cần định nghĩa và review quy trình de-identification phù hợp; khuyến nghị trực tiếp của tài liệu nguồn là dùng dữ liệu được tạo mới.

## 5. Tổ chức: Văn hóa và policy bảo mật

> **[SOURCE FACT]** Tài liệu nguồn yêu cầu policy và procedure bảo mật rõ ràng, bao gồm yêu cầu về password, xử lý dữ liệu và incident response, cùng với đánh giá độc lập định kỳ.

### Định nghĩa policy và procedure

Duy trì security policy giải thích yêu cầu về password, nguyên tắc xử lý dữ liệu và quy trình incident response. Policy phải dễ hiểu với những người cần tuân thủ và phải liên kết được với các control được dùng trong development và operations.

### Đánh giá hệ thống định kỳ

Dùng audit và assessment định kỳ để kiểm tra các control được viết trong tài liệu có hoạt động thực tế hay không. Tài liệu nguồn đề xuất thuê bên thứ ba độc lập thực hiện penetration testing. Phạm vi và thời điểm kiểm thử nên dựa trên rủi ro của hệ thống và yêu cầu áp dụng; ở đây không khẳng định một lịch chung cho mọi hệ thống.

## Baseline bảo mật thực tế

Các trách nhiệm trên khác nhau nhưng bổ trợ cho nhau:

- Developer bảo vệ secret, validate input, quản lý dependency, tránh log dữ liệu nhạy cảm và tham gia review.
- Đội DevOps và hạ tầng bảo vệ credential của delivery, giới hạn quyền, hardening runtime environment và chuẩn bị monitoring cùng response.
- Quản lý dự án đưa security vào tiêu chí delivery và quy trình quản lý quyền.
- QA kiểm thử authorization và các attack path phổ biến, đồng thời giữ test data ở dạng tổng hợp.
- Tổ chức cung cấp policy, đào tạo, kênh báo cáo và đánh giá độc lập.

**[ANALYSIS]** Không một scanner, checklist hoặc vai trò security riêng lẻ nào có thể bù cho khoảng trống ở các giai đoạn khác của lifecycle. Mục tiêu thực tế không phải cam kết một dự án an toàn tuyệt đối, mà là làm cho rủi ro có thể phát hiện, quyền được cấp có chủ đích, dữ liệu nhạy cảm được kiểm soát và việc xử lý sự cố có thể lặp lại.
