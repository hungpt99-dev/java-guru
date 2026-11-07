---
title: "Ralph Loop: Biến AI Agent Thành Long-Running Agent"
description: "AI Agent đang thay đổi cách chúng ta xây dựng phần mềm. Những coding agent hiện nay không còn đơn giản là công cụ autocomplete hay chatbot trả lời câu hỏi về code."
slug: "ralph-loop-bien-ai-agent-thanh-long-running-agent"
locale: "vi"
translationKey: "ralph-loop-bien-ai-agent-thanh-long-running-agent"
pubDate: 2026-10-01T21:36:12+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
featured: false
draft: false
readingTime: 12
series: null
coverImage: "./cover.png"
---


AI Agent đang thay đổi cách chúng ta xây dựng phần mềm. Những coding agent hiện nay không còn đơn giản là công cụ autocomplete hay chatbot trả lời câu hỏi về code. Chúng có thể đọc cả repository, phân tích yêu cầu, chỉnh sửa nhiều file, chạy command, viết test, debug và thực hiện một chuỗi hành động để hoàn thành một task.

Nhưng khi bắt đầu giao cho AI những công việc lớn hơn, một vấn đề nhanh chóng xuất hiện: **một AI agent thường được thiết kế để hoàn thành một phiên làm việc, trong khi software development lại là một quá trình kéo dài qua rất nhiều bước.**

Bạn có thể yêu cầu agent xây dựng một feature lớn. Nó sẽ bắt đầu phân tích, viết code, chạy test và sửa lỗi. Nhưng đến một thời điểm nào đó, session kết thúc, context trở nên quá lớn hoặc agent quyết định rằng công việc đã đủ hoàn chỉnh. Bạn lại phải mở một session mới và giải thích cho nó những gì đã xảy ra trước đó.

Đây là một trong những vấn đề mà **Ralph Loop**, hay còn gọi là **Ralph Wiggum technique**, cố gắng giải quyết.

Điều thú vị là ý tưởng này không hề phức tạp. Theo Geoffrey Huntley, người phổ biến kỹ thuật này, Ralph về bản chất chỉ là một vòng lặp chạy AI agent nhiều lần. Phiên bản đơn giản nhất có thể được hình dung như một shell loop: đưa cùng một prompt cho agent, để agent thực hiện công việc, khi agent kết thúc thì chạy lại một instance mới.

```text
while not done:
    run AI agent
```

Nhìn qua, nó gần như quá đơn giản. Nhưng chính sự đơn giản này lại tạo ra một thay đổi quan trọng trong cách chúng ta sử dụng AI Agent.

## Từ One-Shot Agent đến Long-Running Agent

Hãy tưởng tượng một project có 30 task:

```text
Authentication
User Management
Product Management
Shopping Cart
Order Management
Payment
Notification
Admin
Testing
Documentation
...
```

Cách sử dụng AI Agent thông thường thường giống như:

```text
Human
  ↓
Prompt
  ↓
AI Agent
  ↓
Code
  ↓
Human
```

Developer phải liên tục điều khiển agent:

```text
Implement authentication.

→ Done

Now implement product management.

→ Done

Continue with order management.

→ Done

Fix the failing tests.

→ Done
```

AI vẫn rất hữu ích, nhưng con người vẫn đóng vai trò như một người điều phối thủ công.

Ralph Loop thay đổi mô hình này thành:

```text
                Goal
                 ↓
             AI Agent
                 ↓
              Work
                 ↓
              Verify
                 ↓
          Is it complete?
            /          \
          No            Yes
          ↓              ↓
     New iteration      Done
          │
          └──────────────→
```

Agent không cần phải hoàn thành toàn bộ project trong một lần chạy. Nó chỉ cần tạo ra progress trong iteration hiện tại.

Iteration tiếp theo sẽ nhìn vào trạng thái mới của project và tiếp tục.

Đây chính là điểm quan trọng: **Ralph không cố kéo dài một AI session. Nó kéo dài quá trình làm việc bằng cách tạo ra nhiều AI session.**

## Fresh Context: Quên Conversation, Không Quên Project

Một trong những đặc điểm quan trọng nhất của Ralph Loop là mỗi iteration có thể bắt đầu với một context mới.

Điều này thoạt nghe có vẻ như một nhược điểm.

Nếu agent đã mất thời gian để hiểu project, tại sao lại reset context?

Bởi vì context dài không phải lúc nào cũng tốt.

Trong một session kéo dài, context có thể chứa requirement, conversation history, tool output, logs, code snippets, debugging attempts và rất nhiều thông tin trung gian. Khi lượng thông tin tăng lên, agent phải xử lý ngày càng nhiều dữ liệu để xác định đâu là thông tin thực sự quan trọng.

Ralph Loop chọn một cách tiếp cận khác: **đừng cố biến conversation thành memory dài hạn.**

Thay vào đó, trạng thái của project được lưu ở bên ngoài conversation.

Ví dụ:

```text
Project
├── source code
├── tests
├── README
├── task list
├── progress.md
└── git history
```

Iteration đầu tiên có thể implement authentication.

Khi agent kết thúc, code đã thay đổi và progress được lưu lại.

Iteration thứ hai bắt đầu với context mới. Nó đọc repository, kiểm tra git diff, chạy test hoặc đọc task list và phát hiện authentication đã hoàn thành. Nó không cần nhớ toàn bộ conversation trước đó để tiếp tục.

Nói cách khác:

> **Conversation không phải memory. Project state mới là memory.**

Đây là một ý tưởng rất quan trọng khi xây dựng long-running AI agents. Một số implementation Ralph hiện nay cũng sử dụng git, files, tests và progress files để duy trì trạng thái giữa các iteration.

## Ralph Loop Thực Chất Là Feedback Loop

Ralph Loop không làm model thông minh hơn.

Nó không thay thế reasoning của AI.

Nó cũng không đảm bảo rằng AI sẽ luôn viết code đúng.

Giá trị của Ralph nằm ở feedback loop.

Một iteration có thể diễn ra như sau:

```text
Read requirement
      ↓
Implement feature
      ↓
Run tests
      ↓
Tests fail
      ↓
Inspect failure
      ↓
Fix code
      ↓
Run tests again
      ↓
Commit
      ↓
Next iteration
```

Nếu iteration đầu tiên chưa hoàn thành feature thì iteration tiếp theo tiếp tục.

Nếu code có bug thì test cung cấp feedback.

Nếu requirement chưa được đáp ứng thì verification phát hiện vấn đề.

Nếu tất cả điều kiện hoàn thành đã đạt thì loop dừng.

Vì vậy, Ralph Loop hoạt động tốt nhất khi project có **definition of done rõ ràng và feedback có thể kiểm chứng**.

Automated tests, linting, type checking, build validation và acceptance criteria đều trở nên quan trọng.

Một agent có thể chạy 100 iteration, nhưng nếu không có feedback tốt thì 100 iteration không đồng nghĩa với 100 lần cải thiện.

## Ralph Loop Không Phải Một Tool Cụ Thể

Một hiểu lầm khá phổ biến là Ralph Loop là tên của một CLI cụ thể.

Thực tế, **Ralph Loop trước hết là một technique/pattern**, còn có rất nhiều implementation khác nhau.

Agent bên dưới cũng không nhất thiết phải là một model hoặc một sản phẩm cụ thể.

Bạn có thể hình dung kiến trúc như sau:

```text
                Ralph Loop
                     │
          ┌──────────┼──────────┐
          ↓          ↓          ↓
     Claude Code   Codex    OpenCode
          │          │          │
          └──────────┼──────────┘
                     ↓
                 Project
```

Các implementation hiện nay hỗ trợ hoặc hướng tới nhiều coding agent khác nhau, bao gồm Claude Code, OpenAI Codex, OpenCode và những CLI agent khác.

Điều này khá quan trọng vì nó cho thấy Ralph Loop không phải câu chuyện về việc **“nên dùng OpenCode hay Claude Code”**.

Câu hỏi lớn hơn là:

> **Làm thế nào để một AI agent có thể tiếp tục thực hiện một software engineering task qua nhiều context và nhiều iteration?**

Đó mới là vấn đề mà Ralph Loop đang giải quyết.

## Một Prompt Có Thể Chạy Nhiều Lần

Một đặc điểm khá thú vị của Ralph là prompt không nhất thiết phải thay đổi sau mỗi iteration.

Ví dụ, chúng ta có thể có một prompt như:

```text
Work on the project until the defined requirements are complete.

For each iteration:

1. Inspect the current project state.
2. Identify the highest-priority incomplete task.
3. Implement it.
4. Run relevant tests.
5. Fix failures.
6. Review the implementation.
7. Persist useful progress.
8. Continue with the remaining work.

Do not assume previous work is correct.
Use the repository as the source of truth.

Stop only when all requirements are satisfied
and the verification criteria pass.
```

Điều thú vị là prompt này có thể giống nhau ở nhiều iteration.

Agent thứ nhất đọc project và thực hiện task đầu tiên.

Agent thứ hai đọc **project đã thay đổi** và thực hiện task tiếp theo.

Agent thứ ba tiếp tục từ trạng thái đó.

Prompt không cần chứa toàn bộ lịch sử conversation.

Đây chính là nguyên lý:

```text
Same Goal
   +
New Context
   +
Changed Project State
   =
Continuous Progress
```

## Nhưng Ralph Không Có Nghĩa Là “Chạy AI Vô Hạn”

Đây là phần rất quan trọng.

Một Ralph Loop không nên đơn giản là:

```text
while true:
    run AI
```

và hy vọng cuối cùng AI sẽ tự nhiên hoàn thành project.

Nếu requirement không rõ ràng, agent có thể đi sai hướng.

Nếu test không đủ, agent có thể đánh giá sai trạng thái.

Nếu task quá lớn, agent có thể thực hiện những thay đổi không liên quan.

Nếu feedback bị hỏng, agent có thể lặp lại cùng một lỗi.

Thậm chí agent có thể rơi vào một vòng lặp:

```text
Fix
→ Test fail
→ Fix
→ Test fail
→ Rewrite
→ Test fail
→ Rewrite
→ ...
```

Vì vậy một Ralph Loop production-ready thường cần thêm các cơ chế như iteration limit, completion criteria, progress tracking, retry handling và verification. Một số implementation hiện nay còn tổ chức workflow thành các phase như plan, implement, test, verify và review thay vì chỉ chạy một vòng lặp không có cấu trúc.

Ralph đơn giản ở tầng concept, nhưng một hệ thống sử dụng Ralph tốt vẫn cần engineering discipline.

## Ralph Loop Phù Hợp Với Loại Task Nào?

Ralph Loop đặc biệt phù hợp với những công việc có outcome tương đối rõ ràng.

Ví dụ:

```text
Implement REST API
Add CRUD functionality
Add test coverage
Refactor a module
Migrate an API
Implement a well-defined feature
Fix a collection of known bugs
Build a greenfield application from a specification
```

Ngược lại, những task mang tính exploratory cao sẽ khó hơn.

Ví dụ:

```text
Find a completely new architecture.
Research an unknown problem.
Design the next generation of the platform.
```

Trong những trường hợp này, nếu chưa biết chính xác "done" nghĩa là gì thì việc để agent tự lặp có thể tạo ra rất nhiều work nhưng không nhất thiết tạo ra progress có giá trị.

**Ralph càng hiệu quả khi objective càng rõ và feedback càng đáng tin cậy.**

## Ralph Loop Và Tương Lai Của AI Coding

Điều mình thấy thú vị nhất ở Ralph Loop không phải là shell script hay một CLI cụ thể.

Điều đáng chú ý là nó đại diện cho một cách suy nghĩ khác về AI Agent.

Chúng ta thường hỏi:

> "Model này có context window bao nhiêu?"

> "Model này reasoning tốt đến đâu?"

> "Agent này code tốt đến mức nào?"

Những câu hỏi đó vẫn quan trọng. Nhưng khi muốn xây dựng một agent có thể làm việc trong nhiều giờ hoặc nhiều ngày, một câu hỏi khác cũng trở nên quan trọng:

> **Agent sẽ tiếp tục công việc như thế nào sau khi context hiện tại kết thúc?**

Ralph đưa ra một câu trả lời rất đơn giản:

**Start again.**

Đừng cố bắt một agent duy nhất nhớ mọi thứ.

Hãy để mỗi iteration bắt đầu với một context mới, đọc trạng thái hiện tại của project, thực hiện một phần công việc và lưu lại những gì cần thiết cho iteration tiếp theo.

Từ góc nhìn này, Ralph Loop không chỉ là một trick để chạy coding agent lâu hơn. Nó là một pattern cho **long-running agentic workflows**.

```text
Human
  ↓
Goal
  ↓
Agent
  ↓
Action
  ↓
Feedback
  ↓
Persist State
  ↓
Fresh Agent
  ↓
Action
  ↓
Feedback
  ↓
...
  ↓
Goal Achieved
```

Con người vẫn xác định mục tiêu, constraint và tiêu chuẩn hoàn thành. AI chịu trách nhiệm thực hiện nhiều iteration để tiến gần tới mục tiêu đó.

Đây cũng là lý do mình nghĩ Ralph Loop đáng chú ý dù bản thân ý tưởng cực kỳ đơn giản. Nó không cố giải quyết mọi vấn đề của AI Agent bằng một framework phức tạp. Nó bắt đầu từ một observation rất thực tế:

**AI agent có context hữu hạn, nhưng software project thì có thể kéo dài vô hạn.**

Thay vì chống lại giới hạn đó, Ralph Loop chấp nhận nó.

Context kết thúc?

Không sao.

Iteration mới bắt đầu.

Agent quên conversation?

Không sao.

Repository, tests, git và progress vẫn còn đó.

Task chưa hoàn thành?

Chạy iteration tiếp theo.

Và có lẽ đây mới là ý tưởng quan trọng nhất phía sau Ralph Loop:

> **Long-running AI không nhất thiết cần một conversation dài. Nó cần một feedback loop đủ tốt để có thể bắt đầu lại nhiều lần mà vẫn tiếp tục tiến về cùng một mục tiêu.**

Ralph Loop, xét cho cùng, rất đơn giản.

Nhưng đôi khi một ý tưởng đơn giản lại thay đổi cách chúng ta sử dụng một công nghệ phức tạp.

**AI accelerates execution. Humans own decisions.**
