---
title: "Kiro: Từ AI Coding Agent đến Spec-Driven Development"
description: "Nếu bạn đã dùng Cursor, Windsurf, Claude Code hay OpenCode, có thể bạn sẽ thắc mắc: Kiro có gì khác?"
slug: "kiro-tu-ai-coding-agent-den-spec-driven-development"
locale: "vi"
translationKey: "kiro-tu-ai-coding-agent-den-spec-driven-development"
pubDate: 2026-10-02T15:43:26+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
featured: false
draft: false
readingTime: 15
series: null
coverImage: "./cover.png"
---


Nếu bạn đã dùng Cursor, Windsurf, Claude Code hay OpenCode, có thể bạn sẽ thắc mắc: **Kiro có gì khác?**

AI IDE giúp developer code với AI. AI Coding Agent cho phép developer giao task để AI tự thực hiện. Kiro cũng có những khả năng đó, nhưng đưa thêm một lớp structure vào quá trình development: **Requirement → Specification → Design → Tasks → Agent → Implementation**.

Đây chính là **Spec-Driven Development**, và cũng là điểm quan trọng nhất để hiểu Kiro.

![image.png](/images/articles/kiro-tu-ai-coding-agent-den-spec-driven-development/figure-1.png)

## 1. Từ AI Coding Assistant đến AI Coding Agent

Ban đầu, AI coding chủ yếu đóng vai trò như một **Coding Assistant**. Developer viết code, hỏi AI cách implement một function, giải thích error hoặc refactor một đoạn code. AI hỗ trợ, còn developer vẫn trực tiếp điều khiển quá trình development.

Các AI IDE như Cursor hay Windsurf đã đưa mô hình này đi xa hơn bằng cách cho AI hiểu nhiều hơn về codebase và thực hiện những thay đổi trên nhiều file. Sau đó, AI Coding Agent như Claude Code hay OpenCode tiếp tục thay đổi cách làm việc: thay vì yêu cầu AI viết từng đoạn code, developer có thể giao cho agent cả một task.

Ví dụ, thay vì nói “Create a login API”, developer có thể giao một công việc hoàn chỉnh như implement authentication, thêm login và refresh token, cập nhật database, viết test và chạy test. Agent sẽ tự đọc repository, tìm các file liên quan, chỉnh sửa code, chạy command và kiểm tra kết quả.

Đây là một bước tiến lớn vì AI bắt đầu **thực hiện công việc**, thay vì chỉ hỗ trợ developer trong từng bước.

Nhưng khi agent trở nên mạnh và autonomous hơn, một vấn đề mới xuất hiện: **agent cần biết chính xác developer muốn xây dựng cái gì và project yêu cầu nó phải làm như thế nào.**

Một prompt đơn giản có thể đủ cho một function. Nhưng với một feature lớn, prompt rất dễ thiếu requirement, thiếu context hoặc chứa những assumption mà developer và AI hiểu khác nhau. Đây là vấn đề mà Kiro tập trung giải quyết.

## 2. Spec-Driven Development: Xương sống của Kiro

Điểm quan trọng nhất của Kiro là **Spec-Driven Development**.

Thay vì bắt đầu trực tiếp bằng prompt rồi để agent tự suy luận mọi thứ, Kiro đưa requirement qua một quá trình có cấu trúc hơn: **Requirements → Design → Tasks → Implementation**.

Requirements xác định hệ thống cần làm gì. Design mô tả cách giải quyết về mặt kỹ thuật. Tasks chia công việc thành những bước cụ thể để agent có thể thực hiện.

Ví dụ, thay vì chỉ có requirement:

> “Add payment integration.”

Specification có thể làm rõ payment provider, API contract, error handling, retry, idempotency, database changes và acceptance criteria. Sau đó design xác định cách implement và tasks chia feature thành những công việc cụ thể.

Điều này giải quyết một pain point rất lớn của AI Coding Agent: **AI có thể code rất nhanh nhưng nếu đầu vào không rõ, nó vẫn có thể xây sai thứ chúng ta muốn.**

Spec tạo ra một lớp trung gian giữa requirement và code. Developer có thể review requirement, xem design, kiểm tra tasks rồi mới để agent bắt đầu implementation.

Vì vậy, Spec-Driven Development không đơn giản là “viết thêm documentation”. Nó thay đổi cách chúng ta giao việc cho AI. Specification trở thành một input có cấu trúc để cả developer và agent cùng dựa vào trong quá trình development.

## 3. Steering: Giữ context và rules của project

Specification trả lời câu hỏi **feature cần làm gì**, nhưng vẫn còn một câu hỏi khác: **agent phải xây nó theo cách nào?**

Mỗi project đều có những rules riêng. Project có thể sử dụng Hexagonal Architecture, một naming convention cụ thể, một cách tổ chức repository riêng hoặc yêu cầu tất cả API phải có test. Nếu mỗi lần giao task developer đều phải nhắc lại những điều này, prompt sẽ ngày càng dài.

Đây là nơi **Steering** trở nên hữu ích.

Steering cho phép đưa project rules, conventions và context vào một lớp instruction lâu dài để agent sử dụng trong quá trình làm việc. Thay vì liên tục nói với AI “hãy follow architecture này” hoặc “đừng thay đổi module đó”, những thông tin này có thể trở thành một phần của project context.

Điều này đặc biệt hữu ích với những project lớn hoặc team nhiều người. AI không chỉ biết task hiện tại mà còn có thêm context về **cách project được xây dựng**.

Nếu Spec trả lời “chúng ta đang xây cái gì”, Steering giúp trả lời “project này được xây dựng theo những nguyên tắc nào”.

## 4. Hooks: Đưa automation vào workflow

Khi AI bắt đầu thực hiện nhiều công việc hơn, developer cũng phải xử lý nhiều workflow hơn. Có những bước lặp đi lặp lại như chạy test, formatter, command hoặc một số validation sau khi code thay đổi.

**Hooks** cho phép những hành động như vậy được trigger dựa trên các sự kiện cụ thể thay vì developer phải nhớ và thực hiện thủ công.

Ý tưởng này không mới và không phải riêng Kiro mới có event-driven automation. Điểm đáng chú ý là Hooks được đặt cùng với specification, project context và agent workflow.

Điều đó giúp automation trở thành một phần của quá trình làm việc với AI thay vì chỉ là một script nằm bên ngoài.

Ví dụ, một thay đổi code có thể trigger một action kiểm tra, hoặc một bước trong workflow có thể tự động thực hiện command cần thiết. Khi agent làm việc ngày càng autonomous, việc giảm những bước thủ công và lặp lại này giúp workflow ổn định hơn.

## 5. Skills và Custom Agents: Chuyên biệt hóa AI

Một software project không chỉ có một loại công việc. Requirement analysis, implementation, testing, code review hay security review đều cần những context và cách tiếp cận khác nhau.

Nếu một agent phải làm tất cả mọi thứ, nó sẽ phải mang theo rất nhiều instruction và capability.

Kiro hỗ trợ **Skills** và **Custom Agents** để chuyên biệt hóa cách AI thực hiện từng loại công việc.

Skills có thể cung cấp capability hoặc knowledge cần thiết cho một task. Custom Agents cho phép định nghĩa agent với role và instruction phù hợp hơn.

Ví dụ, một agent có thể tập trung vào backend implementation, trong khi agent khác chuyên về testing hoặc code review.

Điều này mở ra một cách tiếp cận gần với cách software team thực tế hoạt động: thay vì một AI làm mọi thứ, có thể có những AI capability khác nhau cho những phần khác nhau của workflow.

Điểm quan trọng vẫn là những capability này không nên được nhìn riêng lẻ. Giá trị của chúng nằm ở việc chúng có thể hoạt động trong context của specification và project rules.

## 6. Kiro Crew: Từ AI Agent đến AI Worker

Nếu AI Coding Agent chủ yếu được sử dụng theo kiểu developer giao task rồi theo dõi agent, **Kiro Crew** đưa ý tưởng này thêm một bước: AI có thể trở thành worker cho những công việc dài hơn.

Đây là sự khác biệt giữa một interactive agent và một long-running worker.

Với interactive agent, developer thường làm việc theo vòng lặp: giao task, agent thực hiện, developer review rồi tiếp tục. Với worker, developer có thể giao công việc và để AI tiếp tục xử lý mà không cần phải liên tục ngồi trước IDE.

Điều này phù hợp với những task không cần developer theo dõi từng bước. AI có thể tiếp tục thực hiện công việc trong thời gian dài hơn và developer quay lại để review kết quả.

Crew vì vậy mở rộng vai trò của AI từ **assistant** sang **worker**.

Đây cũng là một bước quan trọng nếu nhìn Kiro trong bối cảnh AI-native development. Khi AI không chỉ hỗ trợ developer mà có thể trở thành một worker trong team, cách chúng ta thiết kế workflow cũng bắt đầu thay đổi.

## 7. Điểm khác biệt của Kiro nằm ở workflow

Nếu nhìn từng feature riêng lẻ, không có quá nhiều thứ có thể gọi là hoàn toàn mới. AI IDE khác cũng có agent. Coding agent khác cũng hỗ trợ MCP. Nhiều framework có skills, custom agents và automation.

Vì vậy, điểm đáng chú ý của Kiro không nằm ở một feature riêng lẻ mà ở **cách các thành phần được kết nối thành một workflow**.

Có thể hình dung:

**Requirement → Specification → Design → Tasks → Agent → Context → Implementation → Verification → Automation → Long-running Work**

Specification giúp requirement trở nên có cấu trúc. Steering cung cấp context và rules. Tasks chia nhỏ công việc. Agent thực hiện implementation. Skills và Custom Agents cung cấp capability phù hợp. Hooks hỗ trợ automation. Crew mở rộng agent thành worker có thể xử lý những công việc dài hơn.

Nhìn theo cách này, Kiro không chỉ cố gắng làm cho AI **code tốt hơn**. Nó cố gắng làm cho quá trình **AI tham gia vào software development có cấu trúc hơn**.

Đây là điểm quan trọng khi so sánh Kiro với các AI coding tools khác. Thay vì chỉ hỏi “AI nào code tốt hơn?”, một câu hỏi khác đáng quan tâm là: **AI được đặt ở đâu trong development workflow?**

## 8. Khi AI bắt đầu tham gia vào software development workflow

AI coding đang dần mở rộng phạm vi.

Ban đầu AI giúp viết code. Sau đó AI hiểu repository. Tiếp theo AI có thể tự thực hiện task. Và bước tiếp theo là AI bắt đầu tham gia vào **workflow**.

Khi đó, vấn đề không còn chỉ là code generation.

Một agent có thể viết Java code rất tốt nhưng vẫn không biết business requirement có đúng hay không. Nó có thể implement một feature nhưng không biết project có rule nào cần tuân thủ. Nó có thể hoàn thành task nhưng developer vẫn phải tự chạy những bước verification và quản lý toàn bộ context.

Để AI thực sự tham gia sâu hơn vào software development, chúng ta cần những artifact và cơ chế giúp agent hiểu công việc trong context lớn hơn.

Specification định nghĩa requirement. Design định nghĩa solution. Steering cung cấp project context. Tasks định nghĩa execution. Skills và Agents cung cấp capability. Hooks hỗ trợ automation. Crew mở rộng execution thành long-running work.

Khi các thành phần này kết nối với nhau, AI bắt đầu trở thành một phần của **development process**, thay vì chỉ là một công cụ viết code.

## 9. Từ Prompt-Driven Coding đến Spec-Driven Development

Nhìn rộng hơn, Kiro đại diện cho một xu hướng chuyển từ **Prompt-Driven Coding** sang **Spec-Driven Development**.

Trong mô hình đơn giản, developer viết prompt, AI tạo code và developer review. Khi AI trở thành coding agent, developer bắt đầu giao task. Nhưng khi task ngày càng lớn, prompt và task description đơn giản không còn đủ để chứa toàn bộ context.

Một yêu cầu như “Build a notification service” có thể kéo theo rất nhiều câu hỏi: dùng email hay push notification, retry thế nào, có queue hay không, idempotency ra sao, API contract thế nào, database thay đổi gì và acceptance criteria là gì.

Nếu tất cả nằm trong một prompt dài, việc quản lý context trở nên khó khăn.

Spec-Driven Development đưa những thông tin này thành những artifact rõ ràng hơn. Developer có thể review requirement và design trước khi agent code. Tasks giúp agent biết cần thực hiện những gì. Project context giúp agent biết phải tuân thủ những rules nào.

Điểm quan trọng là specification tạo ra một lớp trung gian giữa **what we want** và **how AI implements it**.

Khi AI ngày càng có khả năng tự thực hiện công việc, lớp trung gian này trở nên quan trọng hơn. Chúng ta không chỉ cần một AI biết code. Chúng ta cần một AI hiểu **mục tiêu, context và cách công việc phải được thực hiện**.

## 10. Kết luận

Kiro không chỉ là câu chuyện về một AI IDE hay một AI Coding Agent mạnh hơn. Điều đáng chú ý là cách Kiro đưa **Spec-Driven Development** vào trung tâm của quá trình làm việc với AI.

Từ Requirement đến Specification, Design, Tasks rồi Agent Implementation, Kiro bổ sung thêm những thành phần như Steering để giữ context, Hooks để automation, Skills và Custom Agents để chuyên biệt hóa capability, và Kiro Crew để mở rộng agent thành những worker có thể thực hiện công việc dài hơn.

Từng thành phần riêng lẻ không nhất thiết mới. Nhưng khi chúng được kết nối thành một workflow, cách developer làm việc với AI bắt đầu thay đổi.

AI không còn chỉ được dùng để trả lời prompt hoặc generate code. AI bắt đầu nhận requirement, hiểu project context, thực hiện task, chạy workflow và tham gia vào quá trình xây dựng software.

Đó chính là điều khiến Spec-Driven Development trở nên đáng chú ý trong thời đại AI Coding Agent.

**Từ Prompt-Driven Coding, chúng ta đang tiến tới một mô hình trong đó specification trở thành cách con người định nghĩa công việc và AI trở thành hệ thống thực thi công việc đó.**
