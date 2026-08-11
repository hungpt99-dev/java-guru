---
title: "Phỏng vấn Senior Java: Tư duy và Behavioral"
description: "Phỏng vấn senior test tư duy và giao tiếp ngang với code. Cách trình bày trade-off, thừa nhận không chắc chắn, và kể chuyện chứng tỏ ownership cấp cao."
pubDatetime: 2026-08-10T10:35:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - career
  - behavioral
---

Bar senior không chỉ kỹ thuật. Phỏng vấn viên tuyển người sở hữu sự mơ hồ, giao tiếp trade-off, và nâng tầm team. Đây là phần behavioral.

## 1. Narrate trade-off

Senior không trả lời "cái nào hơn?" bằng một cái tên. Họ nói: "tùy thuộc — đây là trade-off, và với X tôi chọn Y vì…"

- "Dùng at-least-once + idempotent consumer vì exactly-once nặng và hiếm cần."
- "Giữ module, chưa tách service, đến khi deployability hay scaling ép buộc."

## 2. Thừa nhận không chắc chắn trung thực

"Tôi sẽ đo trước khi chốt RF=5; 3 thường đủ" đánh bại một con số sai tự tin. Senior là calibration, không phải bravado.

## 3. Gắn với experience thật

"Trên prod chúng tôi từng thấy rebalance storm khi…" đánh bại đọc thuộc. Dùng dáng STAR (Situation, Task, Action, Result) mà đừng như kịch bản.

## 4. Phản biện nhẹ nhàng

Nếu design là microservices sớm quá, nói và giải thích cái giá. Bất đồng có bằng chứng là tín hiệu senior; đồng ý để né xung đột thì không.

## 5. Giao tiếp cho team

- Viết design doc junior theo được.
- Giải thích incident prod không đổ lỗi.
- Chuyển ngữ giữa business goal và ràng buộc kỹ thuật.

## 6. Câu hỏi behavioral hay gặp

- Kể về lúc bạn quyết định sai. (Own nó, chỉ bài học.)
- Xử lý sev-1 lúc 2h sáng thế nào? (Triage, communicate, mitigate, postmortem.)
- Mentor junior ra sao? (Ví dụ cụ thể, không "tôi hay giúp".)
- Tại sao bạn tìm việc? (Trung thực, nhìn tới, không cay cú.)

## 7. Tự kiểm tra

- [ ] Hai câu chuyện có impact đo đếm được.
- [ ] Một câu chuyện quyết định sai có bài học thật.
- [ ] Một lần bạn bất đồng với senior và kết quả.
- [ ] Câu trả lời rõ cho "bạn sẽ làm khác thế nào ở đây?"

Đó là bar tư duy senior — và thường là khác biệt giữa offer và trượt.
