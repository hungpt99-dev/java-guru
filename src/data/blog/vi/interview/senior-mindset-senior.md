---
title: "Ôn thi Java #8: Tư duy & Behavioral cấp Senior — Junior đến Senior"
description: "Phỏng vấn senior test phán đoán và giao tiếp ngang với code. Cách trình bày trade-off, thừa nhận không chắc chắn, và kể những câu chuyện chứng minh ownership mức senior."
pubDatetime: 2026-08-10T10:35:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - career
  - behavioral
---

Vòng behavioral là nơi các senior kỹ thuật bị lọc ra vì nghe như junior. Câu hỏi thì mềm ("kể về một xung đột") nhưng tín hiệu thì cứng: bạn tư duy theo trade-off, sở hữu outcome, và giao tiếp như người khác có thể theo không? Bài này leo từ "tôi đã làm gì" đến "phán đoán tôi sẽ áp lại".

> Mindset: junior mô tả task hoàn thành; senior giải thích quyết định dưới uncertainty, alternative bị reject, và gì họ làm khác với cùng thông tin.

## Junior — nền tảng

**Q1. "Tell me about yourself." Trả lời không lan man thế nào?**
Một arc 90 giây: bạn là engineer thế nào (stack + điều bạn care), một thứ cụ thể bạn vừa ship, và tại sao role này fit. Không life story, không "tôi sinh ra ở…". Senior signal: bạn frame chính mình quanh problem bạn thích solve, không phải technology bạn chạm.

**Q2. "Biggest weakness?" — trả lời trung thực thế nào?**
Chọn một cái thật, không chết người, và show _system_ bạn build để compensate. "Tôi từng underestimate migration risk; giờ tôi luôn prototype risky path trước." Tránh weak giả ("tôi làm việc quá sức") — interviewer nghe ra ngay. Honesty cộng mitigation đọc là self-aware, đó là senior trait.

**Q3. "Where do you see yourself in 5 years?"**
Answer quanh growth in scope và judgment, không phải title wish-list. "Tôi muốn là người một team tin tưởng với riskiest architectural call, và đã mentor vài engineer vào tầm đó." Nó show bạn nghĩ về leverage, không chỉ promotion.

**Q4. "Why do you want this job?"**
Gắn với thứ cụ thể: problem domain, scale, team's way of working. "Payments scale của bạn đúng distributed-systems problem tôi muốn đi sâu." Generic "great company" answer signal bạn không research — và research là senior baseline.

**Q5. "Describe a bug you fixed."**
Dùng một cái thật với arc rõ: symptom → reproduce → root cause → fix → gì bạn đổi để không tái diễn. Junior answer dừng ở "tôi sửa rồi." Senior answer kết ở "và đây là guard tôi thêm" (test, alert, invariant).

**Q6. "What do you do when you're stuck?"**
Show một method lặp lại, không panic: reproduce tối thiểu, isolate (bisect/remove variable), đọc actual error và source, rồi hỏi câu hỏi cụ thể thay vì vague "nó không chạy". Senior signal: bạn unblock chính mình bằng process trước khi escalate.

## Mid — tradeoff & điểm mù

**Q1. "Tell me about a disagreement with a colleague." Họ thực sự test gì?**
Không phải conflict — mà _collaboration texture_ của bạn: bạn có lắng, argue từ evidence, và đến một quyết định bạn commit không? Bẫy là "tôi đúng, họ sai" (arrogant) hoặc "chúng tôi đồng ý thôi" (không spine). Good answer: state position với data, acknowledge valid point của họ, và mô tả resolution và gì bạn làm same/differently.

**Q2. "Describe a project that failed." Frame nó thế nào?**
Own outcome không romanticize. "Chúng tôi ship X, nó miss adoption, đây là signal chúng tôi ignore (không validate user need trước khi build)." Senior move là show bạn extract một principle ("giờ tôi spike riskiest assumption trước") — failure như cheap tuition bạn thực học, không phải story bạn xấu hổ.

**Q3. "How do you prioritize when everything is urgent?"**
Show một framework, không phải list frantic: impact × user count × reversibility. "Production data-corruption bug beats cosmetic UI ticket; reversible config change beats irreversible data delete." Rồi communicate trade cho stakeholder nên priority được share, không secret. Senior = explicit, communicated prioritization.

**Q4. "Tell me about a time you mentored someone."**
Concrete, không "tôi giúp junior." Mô tả starting point của người đó, thứ cụ thể bạn dạy (debugging method, design pattern), và measurable outcome (họ ship feature solo, hoặc bắt đầu review PR). Mentoring là senior axis cốt lõi — show bạn grow capability của ai đó, không chỉ làm việc của họ.

**Q5. "How do you handle a vague or changing requirement?"**
Senior answer: bạn make ambiguity explicit và pick một slice ship được, rồi learn. "Tôi viết ra hai interpretation, chọn cái cheaper-to-reverse, ship một thin version, và get real feedback fast." Junior hoặc freeze chờ perfect spec hoặc build whole thing trên guess. Speed of learning beats completeness của guess.

**Q6. "What's a technical decision you regret?"**
Chọn một cái có lesson thật và show thinking giờ khác. "Tôi over-engineer một config system cho flexibility không bao giờ dùng — giờ tôi default vào simplest thing works và add seam chỉ khi requirement thật xuất hiện." Regret chứng minh bạn đã calibrate instinct, đúng nghĩa senior.

## Senior — thiết kế & phòng thủ

**Q1. "Bạn là senior — team muốn ship một risky feature Thứ Sáu. Bạn làm gì?"**
"Tôi tách 'risky' thành 'reversible' vs 'irreversible'. Nếu reversible (sau flag, dễ rollback), ship và watch metric — Thứ Sáu ổn với flag. Nếu irreversible (data migration, billing change), tôi push sang Thứ Hai và low-traffic window, với rollback plan viết _trước_ khi start. Tôi frame call quanh blast radius và recovery time, không phải calendar. Senior job là make risk explicit và recovery ready — không phải người nói không, hoặc có, trên vibes."

**Q2. "Tell me about a time you made a call with incomplete information."**
Đi một cái thật: bạn biết gì, không biết gì, options, và bet bạn đặt — cộng cách bạn de-risk (small rollout, monitoring, kill switch). Điểm không phải bạn đúng, mà bạn có _process_ cho uncertainty: decide dưới time box, make reversible, và instrument để reality correct bạn nhanh. Đó là khác biệt senior và gambler.

**Q3. "How do you raise the level of engineers around you?"**
Ngoài one-on-one mentoring: tôi chỉ cơ chế cụ thể — PR review dạy (hỏi câu hỏi, không chỉ fix), văn hóa written design doc, và post-incident review blame system không phải person. Force-multiplier của senior là habit của team. Tôi cho một example nơi review comment đổi cách một người approach cả một class problem.

**Q4. "Describe a production incident you led the response to."**
Cấu trúc: detection (ta biết thế nào), containment (10 phút đầu làm gì — thường: stop the bleed, rollback, shed load), root cause, và durable fix + guard thêm (alert, test, runbook). Senior signal: bạn bình tĩnh, communicate status cho stakeholder, và biến incident thành permanent improvement. Story chứng minh ownership dưới pressure.

**Q5. "How do you decide between two reasonable technical approaches?"**
"Tôi viết trade-off table: hai option, failure mode, cost tại 10x, và gì ta mất nếu chọn mỗi cái. Rồi tôi pick cái cheaper to reverse và instrument nó. Nếu cả hai reasonable và reversible, choice quan trọng ít hơn commit và learn. Tôi make reasoning visible để team override tôi với info mới — decision không ai hiểu là debt."

**Q6. "What does 'senior' mean to you, in one sentence?"**
"Senior nghĩa tôi được tin make call dưới uncertainty, own outcome tốt hay xấu, và làm người quanh tôi tốt hơn ở make call của họ." Rồi back nó bằng một story 30 giây. Câu đó — judgment + ownership + leverage — là whole behavioral interview trong một nutshell, và hầu hết candidate không bao giờ nói.

#### Self-check

- [ ] Junior: Tôi cho được intro gọn, answer weakness trung thực-có-mitigation, kể bug story với root cause + guard, và show process để unstuck.
- [ ] Mid: Tôi frame disagreement bằng evidence, own failure như tuition, prioritize bằng impact×reversibility, và show mentoring thật và xử lý vague requirement.
- [ ] Senior: Tôi quyết ship-vs-hold bằng blast radius/recovery, show process cho decision dưới uncertainty, raise team level qua mechanism, lead incident response, và định nghĩa senior là judgment + ownership + leverage.
