---
title: "Laya – Một lựa chọn thay thế Jev cho AI Decision Making"
description: "Khi xây dựng một ứng dụng có sử dụng AI, lựa chọn phổ biến hiện nay gần như luôn là một LLM."
pubDatetime: 2026-10-01T15:34:35+07:00
modDatetime: null
category: "AI & AI Agents"
tags: ["AI", "OpenSource", "Machine Learning", "LLM"]
lang: "vi"
featured: false
draft: false
readingTime: 10
coverImage: "../../assets/articles/laya-mot-lua-chon-thay-the-jev-cho-ai-decision-making/cover.png"
series: null
sourceUrl: "https://viblo.asia/p/laya-mot-lua-chon-thay-the-jev-cho-ai-decision-making-oKLnqr5WJQO"
sourceReleasedAt: "2026-10-01T08:34:35.000000Z"
sourceUpdatedAt: "2026-11-05T11:00:07.000000Z"
sourceTags: ["AI", "OpenSource", "Machine Learning", "LLM"]
---

Khi xây dựng một ứng dụng có sử dụng AI, lựa chọn phổ biến hiện nay gần như luôn là một LLM.

Application gửi prompt:

```text
Context + Instruction
        ↓
       LLM
        ↓
Generated response
```

Chúng ta dùng GPT, Claude, Gemini hoặc các model khác để chat, summarize, generate content, viết code, phân tích document...

Nhưng có một câu hỏi khá thú vị:

> **Nếu application không cần AI generate text thì sao?**

Ví dụ application chỉ cần AI trả lời:

* Ticket này thuộc category nào?
* Request này nên được chuyển cho team nào?
* Document này có liên quan đến hồ sơ không?
* Transaction này có suspicious không?
* Workflow nên đi theo nhánh nào?
* User này có thuộc nhóm A hay B không?

Trong những trường hợp này, application không thực sự cần một câu trả lời dài.

Nó chỉ cần:

```text
Input
  ↓
Decision
```

Đây là nơi khái niệm **AI Decision Model** trở nên đáng chú ý.

Một trong những ví dụ nổi bật là **Jev**. Và nếu bạn đang tìm một hướng tiếp cận open-source/self-hostable cho loại workload này, **Laya** là một dự án đáng để tìm hiểu.

---

# 1. Jev là gì?

Jev là một AI decision model của TypeSafe AI.

Điểm khác biệt cơ bản giữa Jev và một LLM thông thường là mục tiêu sử dụng.

LLM được thiết kế để xử lý và sinh ra ngôn ngữ.

Ví dụ:

```text
User:
I cannot login to my account.

LLM:
It looks like you're having trouble accessing
your account. Please try resetting your password...
```

Trong khi decision model quan tâm đến một câu hỏi khác:

```text
User message
     ↓
Which category?
     ↓
ACCOUNT
```

Thay vì yêu cầu model generate một câu trả lời tự do, application định nghĩa trước một **decision space**.

Ví dụ:

```text
BILLING
TECHNICAL
ACCOUNT
SALES
```

Sau đó model chọn một kết quả trong những lựa chọn này.

Có thể hình dung:

```text
Input
  ↓
Decision Model
  ↓
┌───────────────┐
│ BILLING       │
│ TECHNICAL     │
│ ACCOUNT       │
│ SALES         │
└───────────────┘
```

Kết quả có thể chứa decision và probability, chẳng hạn:

```json
{
  "decision": "ACCOUNT",
  "probability": 0.94
}
```

Đây là một abstraction khá thú vị cho software system:

> **AI không phải lúc nào cũng cần nói chuyện với user. Đôi khi AI chỉ cần cung cấp một decision cho application.**

---

# 2. Tại sao không dùng LLM cho việc này?

Câu hỏi này hoàn toàn hợp lý.

Chúng ta có thể bảo LLM:

```text
Classify this support ticket.

Possible categories:
- BILLING
- TECHNICAL
- ACCOUNT
- SALES

Return JSON only.
```

Sau đó nhận:

```json
{
  "category": "ACCOUNT"
}
```

Vậy cần gì một decision model riêng?

Không phải vì LLM không làm được.

LLM làm rất tốt việc này.

Vấn đề nằm ở **fit giữa model và workload**.

Khi sử dụng LLM, flow vẫn là:

```text
Prompt
   ↓
Understand context
   ↓
Reason
   ↓
Generate tokens
   ↓
Produce JSON
   ↓
Parse response
```

Trong khi application chỉ cần:

```text
Input
  ↓
Classification
  ↓
Result
```

Nếu workload của bạn chủ yếu là classification, routing, scoring hoặc yes/no decision, một model được thiết kế cho decision task có thể là một hướng tiếp cận hợp lý hơn.

Đây không phải câu chuyện:

> Decision Model tốt hơn LLM.

Mà là:

> **Chọn loại model phù hợp với loại workload.**

---

# 3. Laya là gì?

Laya đi theo hướng **AI Decision Model** tương tự.

Điểm khiến Laya đáng chú ý là hướng tiếp cận **open-source/open-weight và self-hostable**.

Thay vì application phải phụ thuộc hoàn toàn vào một external decision API, developer có thể triển khai model trong infrastructure của mình.

Về mặt architecture:

### Hosted approach

```text
Application
     │
     ▼
External AI API
     │
     ▼
Decision
```

### Self-hosted approach

```text
Application
     │
     ▼
Laya Server
     │
     ▼
Decision Model
     │
     ▼
Decision
```

Điều này tạo ra một lựa chọn khác cho những team muốn kiểm soát nhiều hơn về:

* Data
* Network
* Deployment
* Infrastructure
* Cost
* Model lifecycle

Đặc biệt với enterprise application, việc có thể chạy model trong internal infrastructure đôi khi rất quan trọng.

---

# 4. Laya có thể thay thế Jev như thế nào?

Đây có lẽ là phần quan trọng nhất.

Nếu Jev đại diện cho hướng tiếp cận:

> **AI as a Decision API**

thì Laya có thể được xem như một lựa chọn khác cho cùng nhóm workload.

Ví dụ application cần phân loại ticket:

```text
Incoming Ticket
       │
       ▼
Decision Model
       │
       ├── BILLING
       ├── ACCOUNT
       ├── TECHNICAL
       └── SALES
```

Nếu sử dụng Jev, decision được thực hiện thông qua Jev service.

Nếu sử dụng Laya, developer có thể triển khai decision model trong infrastructure của mình.

Tuy nhiên, "thay thế" ở đây không nên hiểu là:

> Laya là một drop-in replacement cho Jev trong mọi trường hợp.

Hai hệ thống có thể khác nhau về:

* Model
* API
* Performance
* Capability
* Deployment
* Ecosystem

Ý nghĩa chính là:

> **Nếu workload của bạn phù hợp với AI Decision Model, Laya có thể là một phương án để cân nhắc bên cạnh Jev.**

Đặc biệt nếu requirement của bạn có thêm:

```text
Decision Model
+
Self-hosting
+
Open-source/open-weight
```

thì Laya trở nên thú vị hơn.

---

# 5. Laya khác LLM như thế nào?

Có thể nhìn đơn giản như sau:

```text
              AI Models
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
      LLM             Decision Model
        │                   │
        ▼                   ▼
Generate content       Make decision
```

LLM phù hợp với:

```text
"Write an email."
"Summarize this document."
"Explain this code."
"Generate a report."
"Answer this question."
```

Decision Model phù hợp hơn với:

```text
"Which category?"
"Which route?"
"Yes or No?"
"Which option?"
"What score?"
```

Một điểm quan trọng là **Decision Model không nhất thiết phải thay thế LLM**.

Chúng có thể được sử dụng cùng nhau.

---

# 6. Kết hợp Laya và LLM

Đây mới là architecture thú vị trong production.

Ví dụ xây dựng hệ thống Customer Support.

User gửi:

```text
"I was charged twice for the same transaction."
```

Bước đầu tiên có thể dùng Laya:

```text
User Message
      ↓
    Laya
      ↓
    BILLING
```

Sau đó application route request đến billing flow:

```text
BILLING
   ↓
LLM
   ↓
Generate response
```

Architecture:

```text
                  User Message
                       │
                       ▼
                  ┌─────────┐
                  │  Laya   │
                  └────┬────┘
                       │
                       ▼
                  Classification
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
          Billing   Account   Technical
             │
             ▼
            LLM
             │
             ▼
      Generate Response
```

Ở đây mỗi model có một responsibility rõ ràng.

**Laya:**

> Request này nên đi đâu?

**LLM:**

> Sau khi biết request thuộc flow nào, hãy tạo response.

Đây là cách AI có thể trở thành một phần của software architecture thay vì chỉ là một chatbot được gọi ở một chỗ nào đó.

---

# 7. Một use case khác: Workflow

Hãy tưởng tượng một workflow xử lý document.

```text
Upload Document
       ↓
Extract Information
       ↓
Decision
       ↓
┌───────────────┐
│ APPROVE       │
│ REVIEW        │
│ REJECT        │
└───────────────┘
```

Decision model có thể đóng vai trò tạo ra decision signal:

```json
{
  "decision": "REVIEW",
  "probability": 0.81
}
```

Sau đó business application quyết định phải làm gì:

```text
probability >= 0.90
        ↓
    automatic flow

0.60 - 0.90
        ↓
    human review

< 0.60
        ↓
      fallback
```

Điểm quan trọng ở đây là:

**AI không nhất thiết phải có quyền quyết định toàn bộ workflow.**

AI có thể chỉ cung cấp một signal.

Business application vẫn kiểm soát:

* Business rules
* Authorization
* Validation
* Workflow
* Audit
* Final action

Đây là một cách thiết kế rất đáng cân nhắc khi đưa AI vào hệ thống enterprise.

---

# 8. Những bài toán phù hợp với Laya

Laya đặc biệt đáng thử nghiệm với những bài toán có decision space tương đối rõ ràng.

### Classification

```text
Document
   ↓
INVOICE
CONTRACT
ID_DOCUMENT
OTHER
```

### Routing

```text
Request
   ↓
TEAM_A
TEAM_B
TEAM_C
```

### Binary decision

```text
Request
   ↓
YES / NO
```

### Scoring

```text
Input
   ↓
Risk Score
0.0 ───────── 1.0
```

### Workflow decision

```text
Application
      ↓
Decision
      ↓
Next Step
```

### Intent detection

```text
User message
      ↓
LOGIN
PAYMENT
REFUND
ACCOUNT
```

Đây đều là những operation rất phổ biến trong backend system.

---

# 9. Self-hosting: tại sao nó quan trọng?

Một trong những lý do developer có thể quan tâm đến Laya là khả năng self-hosting.

Với external AI service:

```text
Your System
    ↓
Internet
    ↓
AI Provider
```

Với self-hosted model:

```text
Your System
    ↓
Internal Network
    ↓
Laya
    ↓
Model
```

Điều này có thể phù hợp với những hệ thống cần kiểm soát dữ liệu hoặc infrastructure chặt chẽ.

Nhưng self-hosting không miễn phí theo nghĩa operational.

Bạn sẽ phải quan tâm đến:

* CPU/GPU
* Memory
* Deployment
* Monitoring
* Scaling
* Availability
* Model update
* Security
* Operational cost

Vì vậy, câu hỏi không nên chỉ là:

> "Laya có open-source không?"

Mà nên là:

> **"Self-hosting có thực sự phù hợp với workload và infrastructure của mình không?"**

---

# 10. Laya vs Jev

Nếu nhìn ở mức architecture, có thể đặt hai hướng tiếp cận cạnh nhau:

```text
                 Decision AI
                     │
          ┌──────────┴──────────┐
          │                     │
         Jev                   Laya
          │                     │
   Hosted Decision        Self-hostable
       Service             Decision Model
```

Điểm khác biệt cần quan tâm không chỉ là model accuracy.

Khi đánh giá một giải pháp thực tế, developer nên xem:

* API compatibility
* Model capability
* Latency
* Throughput
* Accuracy trên dữ liệu thực tế
* Hardware requirement
* Deployment complexity
* Monitoring
* Cost
* Data privacy
* Licensing
* Ecosystem

Đặc biệt, không nên chỉ benchmark bằng một vài example đơn giản.

Một model có thể hoạt động rất tốt trên demo nhưng cho kết quả khác khi chạy trên dữ liệu production.

---

# 11. Khi nào không nên dùng Laya?

Không phải application nào cũng cần Decision Model.

Nếu bài toán là:

```text
Generate a 2,000-word report
```

thì LLM phù hợp hơn.

Nếu cần:

```text
Have a conversation with user
```

thì LLM vẫn là lựa chọn tự nhiên.

Nếu cần:

```text
Analyze a large document
and explain the reasoning
```

thì generative model cũng phù hợp hơn.

Decision Model phù hợp nhất khi:

```text
Input
   ↓
Defined decision space
   ↓
Structured result
```

Nếu decision space quá mở hoặc application cần generated content, bạn có thể đang dùng sai abstraction.

---

# 12. Một cách nhìn khác về AI Architecture

Điều mình thấy thú vị nhất ở Laya không phải là câu chuyện:

> "Laya có thay thế được LLM không?"

Mà là nó đặt ra một câu hỏi khác:

> **Có nhất thiết phải dùng một LLM cho mọi bài toán AI không?**

Trong software engineering, chúng ta không dùng cùng một technology cho mọi workload.

Database có nhiều loại.

Message broker có nhiều loại.

Storage có nhiều loại.

Programming language cũng có nhiều loại.

AI cũng có thể đi theo hướng tương tự.

Thay vì:

```text
Everything
    ↓
LLM
```

Chúng ta có thể có:

```text
                    AI Layer
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
        LLM       Decision Model   Embedding
          │            │            │
          ▼            ▼            ▼
      Generation    Decisions     Retrieval
```

Khi đó AI trở thành một collection of capabilities thay vì chỉ là một LLM duy nhất.

---

# 13. Kết luận

Laya là một dự án đáng chú ý nếu bạn đang quan tâm đến **AI Decision Model** và muốn tìm một lựa chọn open-source/self-hostable bên cạnh các decision service như Jev.

Điểm quan trọng không phải là xem Laya như một "LLM mới".

Nó giải quyết một loại bài toán khác:

```text
Input
  ↓
Understand
  ↓
Decision
  ↓
Application takes action
```

Thay vì:

```text
Input
  ↓
LLM
  ↓
Generate everything
```

Điều này mở ra một cách thiết kế AI application khá thú vị.

LLM có thể đảm nhiệm phần **generation**.

Decision Model có thể đảm nhiệm phần **decision**.

Application vẫn giữ quyền kiểm soát **business logic và final action**.

Vì vậy, nếu bạn đang xây dựng một AI-powered application, có lẽ câu hỏi đầu tiên không nên là:

> "Nên dùng model nào?"

Mà nên là:

> **"Application của mình thực sự cần AI làm gì?"**

Nếu cần generate → dùng generative model.

Nếu cần retrieve → dùng embedding/retrieval.

Nếu cần decision → một Decision Model như Laya có thể là một lựa chọn đáng để thử.

Và đó chính là điều làm Laya thú vị:

> **AI không nhất thiết phải generate everything. Đôi khi, AI chỉ cần giúp software đưa ra một decision có cấu trúc.**
