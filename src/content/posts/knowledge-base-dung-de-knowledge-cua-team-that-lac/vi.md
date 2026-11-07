---
title: "Knowledge Base: Đừng Để Knowledge Của Team “Thất Lạc”"
description: "Bạn có bao giờ nghĩ điều gì sẽ xảy ra nếu một ngày Senior Engineer nghỉ việc?"
slug: "knowledge-base-dung-de-knowledge-cua-team-that-lac"
locale: "vi"
translationKey: "knowledge-base-dung-de-knowledge-cua-team-that-lac"
pubDate: 2026-09-24T16:13:32+07:00
category: "Engineering Practices"
tags: ["AI Agent", "Knowleage Base"]
featured: false
draft: false
readingTime: 28
series: null
coverImage: "./cover.png"
---


Bạn có bao giờ nghĩ điều gì sẽ xảy ra nếu một ngày **Senior Engineer nghỉ việc**?

Không phải laptop biến mất.

Không phải source code bị xóa.

Không phải server sập.

Mà là...

**người duy nhất biết tại sao hệ thống lại được thiết kế như vậy không còn ở đó nữa.** 😅

Một developer mới tham gia vào project đã chạy được vài năm. Source code có hàng trăm nghìn dòng, hàng chục service, nhiều database, Kafka, Redis và một loạt integration với các hệ thống khác.

Developer bắt đầu bằng việc đọc code.

Nhưng càng đọc càng có nhiều câu hỏi.

Service này chịu trách nhiệm gì? Tại sao API này lại xử lý như vậy? Tại sao ở đây lại cần Redis lock? Tại sao không gọi service kia trực tiếp? Business rule này được quyết định từ bao giờ? Có incident nào liên quan đến phần code này trước đây không?

Developer bắt đầu tìm documentation.

Một phần nằm trên Confluence, một phần trong Google Drive, API document nằm trong repository, task history nằm trên Jira hoặc Linear. Một số câu trả lời lại nằm trong những cuộc trao đổi cũ trên Slack hoặc Teams.

Cuối cùng, developer nhận ra một sự thật hơi đau:

> **Documentation có rất nhiều, nhưng câu trả lời thì vẫn phải đi hỏi người.**

Và nếu người đó vừa nghỉ việc thì sao?

Có thể team vẫn còn source code.

Vẫn còn Jira.

Vẫn còn Confluence.

Vẫn còn Git history.

Nhưng phần **“Tại sao?”** thì có thể đã nghỉ việc cùng Senior. 😄

Đây không phải là vấn đề của một project cụ thể. Khi project lớn dần, knowledge gần như luôn có xu hướng bị phân tán.

Team có thể có rất nhiều information nhưng lại không có một cách tốt để biến information đó thành knowledge có thể tìm kiếm, kết nối và sử dụng lại.

Và khi AI Agent bắt đầu tham gia vào software engineering, vấn đề này càng trở nên rõ ràng hơn.

Một AI Agent có thể đọc code, phân tích một repository và viết implementation. Nhưng nó không tự nhiên biết được những quyết định mà team đã đưa ra trong quá khứ, những business rule không được viết rõ trong code hay những incident từng xảy ra cách đây vài năm.

Con người có thể hỏi:

> "Anh ơi, tại sao chỗ này lại làm như vậy?"

AI Agent thì không có một Senior Developer để hỏi.

Nó cần một nguồn context khác.

**Đó là lúc Knowledge Base trở nên hữu ích.**

---

# 1. Knowledge Base là gì?

Nếu nói đơn giản, **Knowledge Base là nơi lưu trữ knowledge để con người hoặc hệ thống có thể tìm kiếm và sử dụng khi cần.**

Nhưng đối với Engineering Team, định nghĩa này vẫn còn hơi đơn giản.

Một project không chỉ có documentation.

Project còn có:

* Architecture
* Business rules
* API
* Database
* Technical decisions
* Code
* Incident history
* Runbook
* Deployment knowledge
* Dependencies
* Historical context

Vì vậy, có thể xem Knowledge Base là một **knowledge layer của project**, có nhiệm vụ tập hợp, tổ chức và cung cấp context từ nhiều nguồn khác nhau.

```text
                    Project Knowledge
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   Documentation         Code              History
        │                  │                  │
      ADRs               APIs             Incidents
        │                  │                  │
 Business Rules       Database           Decisions
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                    Knowledge Base
                           │
                 ┌─────────┴─────────┐
                 │                   │
              Human              AI Agent
```

Điểm quan trọng là:

**Knowledge Base không nhất thiết phải thay thế những hệ thống hiện tại.**

GitHub vẫn có thể là nơi chứa source code.

Jira hoặc Linear vẫn quản lý task.

Confluence hoặc Notion vẫn có thể chứa documentation.

Google Drive vẫn có thể chứa những tài liệu của business.

Knowledge Base đóng vai trò kết nối những nguồn này lại để knowledge của project có thể được truy cập một cách thống nhất.

Nói cách khác, mục tiêu không phải là:

> "Đưa tất cả mọi thứ vào một database."

Mà là:

> **"Khi cần hiểu một vấn đề, chúng ta có thể tìm được đúng context từ những nguồn liên quan."**

---

# 2. Information, Documentation và Knowledge khác nhau như thế nào?

Đây là một distinction khá quan trọng.

Giả sử trong code có:

```java
paymentService.processPayment();
```

Đây là information về implementation.

Documentation có thể nói:

> Payment Service chịu trách nhiệm xử lý payment.

Nhưng knowledge có thể là:

> Payment Service sử dụng asynchronous processing vì Transaction Service không được phép trở thành synchronous dependency trong payment flow.

Và historical knowledge có thể nói:

> Architecture này được thay đổi sau một incident liên quan đến downstream timeout.

Như vậy, ba thứ này không hoàn toàn giống nhau.

```text
Information
    ↓
Documentation
    ↓
Knowledge
    ↓
Context
```

Documentation thường giúp trả lời:

> **What?**

Knowledge còn có thể trả lời:

> **Why?**

Và historical knowledge có thể trả lời:

> **What happened before?**

Đây chính là lý do Knowledge Base cho Engineering Team cần rộng hơn một documentation repository.

---

# 3. Tại sao Engineering Team cần Knowledge Base?

## 3.1 Knowledge bị phân tán

Một project thực tế có thể có architecture ở Confluence, code ở GitHub, task ở Linear, incident ở một hệ thống khác và business document ở Google Drive.

Ví dụ một developer muốn hiểu payment flow.

Họ có thể phải đi qua:

```text
Confluence
   ↓
GitHub
   ↓
Jira / Linear
   ↓
Slack
   ↓
Google Drive
   ↓
Ask Senior Developer
```

Mỗi hệ thống chỉ chứa một phần của câu trả lời.

Developer phải tự kết nối các mảnh information đó lại.

Vấn đề không phải thiếu data.

Vấn đề là **context bị phân mảnh**.

Và đôi khi thứ mất nhiều thời gian nhất không phải là đọc tài liệu.

Mà là tìm ra **tài liệu nào mới là tài liệu mình cần đọc**.

---

# 4. Knowledge nằm trong đầu của một vài người

Đây là vấn đề nguy hiểm hơn.

Trong một project lâu năm, thường có những senior developer biết rất nhiều historical context.

Ví dụ:

> "Không nên thay đổi logic này."

Nếu hỏi tại sao:

> "Vì trước đây đã từng có production issue."

Nhưng incident đó có thể xảy ra từ hai năm trước.

PR đã nằm sâu trong Git history.

Ticket đã đóng.

Documentation có thể chưa bao giờ được update.

Knowledge vẫn tồn tại, nhưng chỉ tồn tại trong memory của một vài người.

Điều này tạo ra một loại **knowledge bottleneck**.

Khi những người đó không available, tốc độ xử lý vấn đề của team giảm xuống.

Đây cũng là lý do câu:

> "Cái này hỏi anh A nhé."

xuất hiện khá thường xuyên trong những project lớn. 😄

Vấn đề không phải senior không muốn chia sẻ knowledge.

Vấn đề là team chưa có một cách tốt để biến knowledge cá nhân thành **knowledge dùng chung**.

---

# 5. Developer onboarding cũng trở nên khó hơn

Một developer mới không chỉ cần học programming language hoặc framework.

Họ phải học:

```text
Business
   +
Architecture
   +
Codebase
   +
Infrastructure
   +
Team conventions
   +
Historical decisions
```

Nếu những knowledge này nằm rải rác, onboarding rất dễ trở thành:

> "Đi hỏi từng người."

Một Knowledge Base tốt có thể giúp biến onboarding từ:

```text
Ask people
   ↓
Search manually
   ↓
Read random documents
   ↓
Guess
```

thành:

```text
Search project knowledge
   ↓
Understand architecture
   ↓
Read relevant decisions
   ↓
Explore related code
   ↓
Ask humans only when necessary
```

Con người vẫn cần trao đổi với nhau.

Nhưng những câu hỏi có thể trả lời bằng existing knowledge không nên liên tục trở thành interruption cho senior developers.

---

# 6. Và đây là lúc AI Agent xuất hiện

AI Coding Agent hiện nay có thể làm được rất nhiều việc:

* Đọc repository
* Tìm code
* Phân tích dependency
* Viết code
* Tạo test
* Refactor
* Debug

Nhưng có một vấn đề:

**AI không tự nhiên biết project context.**

Một AI Agent có thể nhìn thấy:

```text
PaymentService
TransactionService
Redis
Kafka
PostgreSQL
```

Nhưng nó không nhất thiết biết:

> Tại sao architecture lại như vậy?

Nó cũng không biết:

> Có business rule nào không được thể hiện rõ trong code?

Hoặc:

> Tại sao một đoạn code trông có vẻ redundant nhưng thực tế không được xóa?

Con người có thể hỏi senior developer.

AI Agent thì cần một nguồn context có thể truy cập được.

Đó chính là một trong những lý do Knowledge Base trở nên quan trọng trong thời đại AI Agent.

---

# 7. Knowledge Base nên chứa những gì?

Không nên bắt đầu bằng câu hỏi:

> "Chúng ta có bao nhiêu documents?"

Nên bắt đầu bằng:

> **"Project có những loại knowledge nào?"**

Có thể chia thành một số nhóm chính.

## 7.1 Architecture Knowledge

Ví dụ:

```text
System Architecture
Service Architecture
Data Flow
Integration
Infrastructure
Dependencies
```

Một architecture document tốt không chỉ nói service nào tồn tại mà còn giải thích relationship giữa chúng.

```text
Order Service
      │
      ├── PostgreSQL
      │
      ├── Redis
      │
      └── Kafka
             │
             ├── Payment Service
             └── Notification Service
```

Developer hoặc AI Agent không chỉ cần biết:

> "Order Service có Kafka."

Mà còn cần biết:

> "Order Service publish event gì, consumer nào sử dụng event đó và tại sao flow lại được thiết kế như vậy."

---

# 8. Business Knowledge

Đây là phần mà code thường không thể mô tả đầy đủ.

Ví dụ:

* Payment state
* Cancellation rules
* Refund rules
* Eligibility
* Validation rules
* Domain terminology
* State transitions

AI có thể đọc:

```text
if (status == COMPLETED)
```

nhưng không nhất thiết biết:

> Tại sao `COMPLETED` không thể chuyển ngược về `PROCESSING`?

Hoặc:

> Tại sao user A được phép thực hiện operation này nhưng user B thì không?

Business knowledge giúp bổ sung phần context mà source code thường chỉ thể hiện một phần.

---

# 9. Decision Knowledge

Đây là lý do ADR rất quan trọng.

Ví dụ code cho thấy:

```text
Service A → Kafka → Service B
```

Nhưng code không nói:

> Tại sao không gọi REST trực tiếp?

ADR có thể ghi:

```text
Decision:
Use asynchronous communication through Kafka.

Context:
Service B may be temporarily unavailable.

Alternatives:
- REST synchronous call
- Message queue

Trade-off:
Higher operational complexity,
but better decoupling.
```

Có một nguyên tắc rất hữu ích:

> **Code tells us what the system does. ADR tells us why the system was designed that way.**

Nếu muốn AI Agent hiểu project tốt hơn, phần **"why"** này rất quan trọng.

Nếu chỉ đưa source code cho AI, AI có thể phân tích implementation hiện tại.

Nếu có thêm ADR, AI có thêm context để hiểu những constraint và trade-off phía sau implementation đó.

---

# 10. Operational Knowledge

Project còn có knowledge liên quan đến vận hành:

* Deployment
* Rollback
* Monitoring
* Troubleshooting
* Configuration
* Runbook
* Production procedures

Ví dụ:

```text
Payment Service is unhealthy

1. Check pod status
2. Check application logs
3. Check Kafka consumer lag
4. Check database connection
5. Check downstream service
6. Follow rollback procedure
```

Knowledge này có giá trị lớn khi debugging hoặc xử lý incident.

Đặc biệt, với AI Agent có khả năng hỗ trợ production troubleshooting, operational knowledge giúp agent hiểu được những bước kiểm tra nào là phù hợp thay vì tự suy đoán.

---

# 11. Historical Knowledge

Một project có history rất dài:

```text
Issue
   ↓
PR
   ↓
Deployment
   ↓
Incident
   ↓
Fix
   ↓
Postmortem
```

Nếu chỉ nhìn code hiện tại, chúng ta mất rất nhiều context.

Ví dụ:

> "Why was this workaround introduced?"

Có thể câu trả lời nằm trong một PR từ hai năm trước.

Hoặc:

> "Has this problem happened before?"

Câu trả lời có thể nằm trong incident history.

Historical knowledge giúp team và AI Agent không phải liên tục "phát minh lại" những bài học mà project đã trả giá để có được.

---

# 12. Generated Knowledge

Không phải knowledge nào cũng cần developer viết bằng tay.

Một số knowledge có thể được generate từ source code và infrastructure.

Ví dụ:

```text
Service Inventory
API Inventory
Database Schema
Kafka Topics
Service Dependencies
Repository Dependencies
Configuration Inventory
```

Từ source code có thể tạo ra:

```text
Payment Service
 ├── REST APIs
 ├── Kafka Producers
 ├── Kafka Consumers
 ├── Database Tables
 ├── External Dependencies
 └── Internal Dependencies
```

Đây là loại knowledge đặc biệt hữu ích cho AI vì nó có cấu trúc rõ ràng và có thể được cập nhật tự động.

---

# 13. Ba loại Knowledge nên được phân biệt

Một cách tổ chức khá hữu ích là phân biệt knowledge thành:

```text
Curated Knowledge
        │
        ├── Architecture
        ├── ADR
        ├── Business Rules
        └── Runbook

Imported Knowledge
        │
        ├── GitHub
        ├── Jira
        ├── Confluence
        └── Slack

Generated Knowledge
        │
        ├── Services
        ├── APIs
        ├── Database
        └── Dependencies
```

Ba loại này không có cùng mức độ authority.

Ví dụ:

Một ADR đã được approve không nên được coi giống một đoạn Slack conversation.

Một service inventory được generate từ source code cũng khác với một document được viết thủ công.

Do đó Knowledge Base nên giữ lại **provenance** và metadata của knowledge thay vì biến tất cả thành những đoạn text giống nhau.

---

# 14. Cách implement Knowledge Base

Sau khi xác định knowledge cần quản lý, chúng ta mới bắt đầu nói đến implementation.

Một kiến trúc đơn giản có thể là:

```text
                 Knowledge Sources
                        │
        ┌───────────────┼────────────────┐
        │               │                │
       Git            Jira          Confluence
        │               │                │
      Drive           Slack            Notion
        │               │                │
        └───────────────┼────────────────┘
                        │
                        ▼
                   Ingestion
                        │
                        ▼
                  Normalization
                        │
                        ▼
                    Metadata
                        │
                        ▼
                     Index
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
          Keyword    Semantic   Structured
           Search     Search      Lookup
             │          │          │
             └──────────┼──────────┘
                        ▼
                    Retrieval
                        │
                        ▼
                 Context / Answer
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
           Human                AI Agent
```

Có thể chia implementation thành các bước.

---

# 15. Bước 1: Xác định phạm vi

Đừng bắt đầu bằng việc đưa toàn bộ company vào Knowledge Base.

Hãy bắt đầu từ một project hoặc service.

Ví dụ:

```text
Payment Service
```

Sau đó tập trung vào:

```text
Architecture
API
Database
Business Rules
ADR
Runbook
Incidents
Code
```

Làm cho một phạm vi nhỏ hoạt động tốt trước.

Sau đó mới mở rộng.

Điều này giúp tránh một hệ thống rất lớn nhưng không ai biết nó thực sự có hữu ích hay không.

Một nguyên tắc khá thực tế:

> **Start with a question, not with a vector database.**

Hãy xác định trước:

> "Developer hoặc AI Agent đang gặp câu hỏi nào?"

Sau đó mới thiết kế hệ thống để trả lời câu hỏi đó.

---

# 16. Bước 2: Kết nối các nguồn dữ liệu

Knowledge có thể đến từ nhiều nguồn:

```text
GitHub / GitLab
Jira / Linear
Confluence / Notion
Google Drive
Slack / Teams
Internal documentation
Incident systems
```

Mỗi nguồn có format khác nhau.

Git chứa code và commit history.

Jira chứa issue và workflow.

Confluence chứa documentation.

Slack chứa conversation.

Vì vậy cần một ingestion layer để đưa chúng vào một knowledge model chung.

Ví dụ:

```text
GitHub
   ↓
Repository Connector
   ↓
Normalize
   ↓
Knowledge Model
```

và:

```text
Jira
   ↓
Jira Connector
   ↓
Normalize
   ↓
Knowledge Model
```

Cuối cùng các nguồn khác nhau cùng được đưa vào một lớp knowledge thống nhất.

---

# 17. Bước 3: Normalize Knowledge

Không nên index raw data một cách mù quáng.

Ví dụ một Slack conversation có thể chứa:

```text
A: Should we use Kafka?
B: I think so.
C: Let's use REST.
D: Maybe Kafka.
```

Đây không phải authoritative knowledge.

Nó chỉ là conversation.

Nếu đưa toàn bộ vào retrieval mà không có context, AI có thể hiểu nhầm discussion thành decision.

Do đó knowledge cần được normalize và phân loại:

```text
Discussion
Decision
Documentation
Incident
Code
Task
```

Đồng thời nên giữ source và context để có thể trace ngược về nguồn gốc.

Đây cũng là lý do Knowledge Base không nên chỉ là:

> "Chunk tất cả text → embedding → vector database."

Phần khó hơn nằm ở việc **hiểu knowledge đó là gì và đáng tin đến đâu**.

---

# 18. Bước 4: Metadata

Metadata là một phần rất quan trọng.

Ví dụ:

```yaml
title: Payment Service Architecture
type: architecture
service: payment-service
owner: payment-team
status: active
source_of_truth: github
created_at: 2026-01-10
updated_at: 2026-09-20
review_at: 2026-12-20
```

Nhờ metadata, hệ thống có thể biết:

* Knowledge này thuộc service nào?
* Loại gì?
* Ai chịu trách nhiệm?
* Còn active không?
* Cập nhật lần cuối khi nào?
* Source of truth ở đâu?

Metadata cũng giúp retrieval tốt hơn.

Ví dụ query:

> "Who owns the payment API?"

thì service metadata có thể giúp hệ thống tìm đúng service owner thay vì phải semantic search qua hàng nghìn documents.

---

# 19. Bước 5: Search và Retrieval

Đây là nơi RAG thường xuất hiện.

Một pipeline phổ biến:

```text
Document
   ↓
Chunking
   ↓
Embedding
   ↓
Vector Index
   ↓
Semantic Search
   ↓
Relevant Context
   ↓
LLM
```

Nhưng engineering Knowledge Base không nên chỉ phụ thuộc vào vector search.

Có ít nhất ba kiểu retrieval hữu ích.

### Keyword Search

Phù hợp khi tìm:

```text
PaymentService
/api/v1/payment
ADR-023
INC-182
```

### Semantic Search

Phù hợp với những câu hỏi như:

> "Why does payment processing use asynchronous communication?"

### Structured Lookup

Phù hợp với:

> "Which service owns this API?"

hoặc:

> "What database does Payment Service use?"

Do đó một hệ thống thực tế có thể kết hợp:

```text
Keyword
   +
Semantic
   +
Structured
```

sau đó ranking kết quả trước khi đưa context cho AI.

RAG là một kỹ thuật trong retrieval pipeline.

**Knowledge Base không đồng nghĩa với RAG.**

RAG giúp lấy context.

Knowledge Base quyết định **context đó đến từ đâu, thuộc loại gì, có đáng tin không và được quản lý như thế nào.**

---

# 20. Bước 6: Expose Knowledge cho AI Agent

Khi Knowledge Layer đã hoạt động, AI Agent cần một interface để truy cập.

Có thể sử dụng API hoặc MCP.

Ví dụ một Project Knowledge MCP có thể expose:

```text
search_project_knowledge()
get_project_overview()
get_service_info()
get_architecture()
get_api_info()
get_database_info()
get_business_rule()
search_decisions()
search_incidents()
find_related_code()
get_implementation_context()
```

AI Agent không cần biết:

> "Knowledge đang nằm trong Confluence hay GitHub?"

Nó chỉ cần yêu cầu:

> "Find the relevant project knowledge."

Knowledge Layer xử lý phần còn lại.

Một điểm cần phân biệt rõ:

> **MCP không phải Knowledge Base.**

MCP chỉ là **interface** để AI Agent truy cập knowledge.

Knowledge Base mới là nơi knowledge được tổ chức, quản lý và retrieval.

---

# 21. Một workflow thực tế với AI Agent

Giả sử AI Agent nhận task:

> Implement payment retry.

Nếu không có Knowledge Base, workflow có thể là:

```text
Task
 ↓
Read repository
 ↓
Find PaymentService
 ↓
Guess architecture
 ↓
Implement
 ↓
Test
```

Nếu có Knowledge Base:

```text
Task
 ↓
Search project knowledge
 ↓
Read Payment architecture
 ↓
Read business rules
 ↓
Find related ADR
 ↓
Find existing retry implementation
 ↓
Find previous incidents
 ↓
Inspect relevant code
 ↓
Create implementation plan
 ↓
Implement
 ↓
Test
```

AI Agent lúc này không chỉ đọc code.

Nó đọc **context trước khi code**.

Đây là một trong những giá trị lớn nhất của Knowledge Base đối với AI-assisted development.

---

# 22. Best Practices: Điều gì quyết định Knowledge Base có tốt hay không?

Có Knowledge Base chưa chắc project sẽ tốt hơn.

Một Knowledge Base có thể nhanh chóng trở thành một **"bãi rác documentation"** nếu không có governance.

Một hệ thống chứa 100.000 documents không có nghĩa là nó hữu ích hơn hệ thống chỉ có 10.000 documents.

Quan trọng hơn là:

```text
Can we find it?
Can we trust it?
Is it still valid?
Do we know where it came from?
Can we understand its context?
```

---

# 23. Source of Truth phải rõ ràng

Một trong những vấn đề nguy hiểm nhất là conflicting knowledge.

Ví dụ:

```text
Document A:
Timeout = 30 seconds

Document B:
Timeout = 60 seconds

Current code:
Timeout = 45 seconds
```

Nếu AI retrieve cả ba, nó phải đoán.

Thay vào đó cần xác định source of truth.

Ví dụ:

```text
Source Code
    ↓
Implementation truth

ADR
    ↓
Architecture decision truth

Jira / Linear
    ↓
Task truth

Business specification
    ↓
Business requirement truth

Incident / Postmortem
    ↓
Historical / operational truth
```

Knowledge Base có thể aggregate information, nhưng không nên làm mất đi nguồn gốc và authority của information đó.

Nếu có conflict, hệ thống nên ưu tiên knowledge có authority cao hơn hoặc ít nhất thông báo cho người dùng rằng đang có conflict.

---

# 24. Knowledge phải có Owner

Không nên có tư duy:

> "Documentation là trách nhiệm của tất cả mọi người."

Trong thực tế, điều đó rất dễ biến thành:

> "Ai đó sẽ update."

Và cuối cùng không ai update. 😄

Tốt hơn là xác định owner cho từng nhóm knowledge:

```text
Architecture
    → Backend / Architecture Team

Business Rules
    → Domain / Product Team

Deployment
    → Platform Team

API
    → Service Owner

Runbook
    → Operations / Service Owner
```

Owner không nhất thiết phải tự viết mọi thứ.

Họ chịu trách nhiệm đảm bảo knowledge đó có người duy trì.

---

# 25. Knowledge phải có Lifecycle

Một document không nên được coi là đúng mãi mãi.

Có thể có lifecycle:

```text
Draft
  ↓
Active
  ↓
Needs Review
  ↓
Deprecated
  ↓
Archived
```

Metadata có thể chứa:

```yaml
owner: payment-team
status: active
last_updated: 2026-09-20
review_at: 2026-12-20
```

Khi architecture thay đổi, document liên quan cần được đánh dấu review.

Nếu một service đã thay đổi rất nhiều nhưng documentation không được update trong một thời gian dài, đó là một signal đáng chú ý.

Knowledge Base tốt không chỉ biết:

> "Knowledge này tồn tại."

Nó còn phải biết:

> **"Knowledge này còn đáng tin không?"**

---

# 26. Đừng chỉ lưu "What", hãy lưu "Why"

Đây là lý do ADR và incident history có giá trị cao.

Ví dụ:

```text
What:
Use Redis distributed lock.

Why:
Multiple operations can access the same business entity concurrently.

Problem avoided:
Duplicate processing.

Trade-off:
Additional infrastructure dependency.
```

Nếu sau này developer hỏi:

> "Có thể bỏ Redis lock không?"

AI không nên chỉ trả lời:

> "Code currently uses Redis."

Nó cần biết **tại sao lock tồn tại**.

Knowledge về "why" giúp team tránh những thay đổi tưởng như hợp lý nhưng phá vỡ những assumption cũ.

Đây cũng là phần knowledge thường khó nhất để generate tự động.

Source code có thể giúp chúng ta biết **what**.

Nhưng để biết **why**, đôi khi vẫn cần ADR, PR discussion, incident hoặc con người xác nhận.

---

# 27. Đừng đưa mọi thứ vào Knowledge Base

Đây là một anti-pattern rất phổ biến.

```text
Google Drive
Confluence
Slack
GitHub
Jira
Notion
PDF
Excel
        ↓
Import everything
        ↓
Knowledge Base
```

Sau một thời gian:

```text
10,000 documents
50,000 chunks
1,000 duplicates
300 outdated documents
100 conflicting documents
```

Data tăng nhưng chất lượng knowledge không tăng.

Vì vậy:

> **More data does not automatically mean better knowledge.**

Cần quan tâm đến:

* Relevance
* Freshness
* Authority
* Ownership
* Duplication
* Quality

Đặc biệt với AI Agent, đưa quá nhiều context không đồng nghĩa với việc AI hiểu project tốt hơn.

**Context tốt quan trọng hơn context nhiều.**

---

# 28. Incident phải trở thành Knowledge

Một incident không nên kết thúc đơn giản bằng:

```text
Incident resolved
       ↓
Ticket closed
```

Nếu incident có bài học lâu dài, nên biến nó thành knowledge:

```text
Incident
   ↓
Root Cause
   ↓
Fix
   ↓
Postmortem
   ↓
Runbook / ADR
   ↓
Knowledge Base
```

Ví dụ:

```text
Incident:
Payment requests timeout during high traffic.

Root Cause:
Database connection pool exhaustion.

Fix:
Connection pool tuning + query optimization.

Knowledge:
- Detection signal
- Root cause
- Troubleshooting
- Correct configuration
- Preventive measures
```

Lần sau khi developer hoặc AI gặp một vấn đề tương tự, historical knowledge này có thể được retrieve.

Một incident không chỉ là một sự cố đã được xử lý.

Nó là **một bài học mà team đã trả tiền để có được**.

Đừng để bài học đó biến mất cùng ticket đóng. 😄

---

# 29. Knowledge Base phải có Feedback Loop

Đây là điểm quan trọng nhất để Knowledge Base không bị chết theo thời gian.

Hãy coi mỗi query là một cơ hội để kiểm tra chất lượng knowledge.

```text
Developer / AI Agent
        ↓
      Query
        ↓
 Knowledge Base
        ↓
 Answer / Context
        ↓
     Feedback
        ↓
 ┌──────┼─────────┐
 │      │         │
Wrong  Missing  Outdated
 │      │         │
 └──────┼─────────┘
        ↓
 Update Knowledge
        ↓
 Re-index
        ↓
 Better Retrieval
```

Có ba loại signal rất quan trọng.

### Missing Knowledge

AI hỏi:

> "Why is this lock required?"

Không tìm thấy câu trả lời.

→ Có thể cần tạo ADR.

### Wrong Knowledge

AI retrieve một document đã không còn đúng.

→ Cần sửa hoặc deprecate document.

### Outdated Knowledge

Architecture đã thay đổi nhưng documentation chưa update.

→ Cần tạo review/update task.

Như vậy Knowledge Base trở thành một hệ thống có khả năng **cải thiện từ chính quá trình sử dụng**.

---

# 30. Query của AI cũng có thể trở thành nguồn cải thiện

Giả sử trong một tháng AI Agent liên tục hỏi:

```text
What service owns this API?
```

Có thể đó là dấu hiệu rằng service ownership chưa được document tốt.

Nếu AI liên tục hỏi:

```text
Why does this business rule exist?
```

có thể project đang thiếu business knowledge hoặc ADR.

Nếu AI liên tục retrieve sai documentation, có thể retrieval hoặc metadata đang có vấn đề.

Do đó có thể theo dõi:

```text
Most searched knowledge
Most failed queries
Most missing knowledge
Most outdated documents
Most retrieved documents
```

Từ đó team biết nên cải thiện Knowledge Base ở đâu.

Nói cách khác:

> **Những câu hỏi AI không trả lời được cũng chính là một dạng technical feedback.**

---

# 31. Knowledge Quality nên được đo như thế nào?

Không nên chỉ đo:

> "Knowledge Base có bao nhiêu documents?"

Một Knowledge Base có 100.000 documents nhưng AI thường xuyên lấy sai context thì không có nhiều giá trị.

Có thể quan tâm đến những metric như:

### Retrieval Quality

Query có tìm đúng knowledge không?

### Freshness

Knowledge có còn mới không?

### Coverage

Các loại knowledge quan trọng đã được cover chưa?

### Authority

Có biết source nào là authoritative không?

### Usage

Developer và AI Agent có thực sự sử dụng knowledge không?

### Failure Rate

Bao nhiêu query không tìm được câu trả lời?

Ví dụ:

```text
100 queries
   ↓
70 correct retrieval
20 partially useful
10 failed
```

10 failed queries chính là nguồn để cải thiện hệ thống.

Quan trọng là không chỉ đo:

> "Knowledge Base chứa bao nhiêu data?"

mà phải đo:

> **"Knowledge Base giúp developer và AI làm việc tốt hơn đến đâu?"**

---

# 32. Security và Permission cũng phải được tính đến

Khi Knowledge Base kết nối với nhiều nguồn, một vấn đề khác xuất hiện:

> **Ai được phép xem knowledge nào?**

Ví dụ:

```text
Public documentation
Internal engineering docs
Private business documents
Security incidents
Production information
```

Không thể vì AI Agent có quyền truy cập Knowledge Base mà mặc nhiên cho phép nó đọc tất cả dữ liệu.

Knowledge Base nên tôn trọng permission của source.

Một nguyên tắc đơn giản có thể là:

```text
AI permissions
    ≤
User permissions
    ≤
Source permissions
```

Nếu developer không có quyền xem một tài liệu trong hệ thống gốc, AI Agent cũng không nên dùng Knowledge Base để "lách" quyền đó.

Đây là phần đặc biệt quan trọng khi Knowledge Base được mở rộng từ một project thành knowledge platform của cả organization.

---

# 33. Knowledge Base không nên là một project "setup once"

Một mindset quan trọng là:

> **Knowledge Base không phải một database.**

Nó là một **living system**.

Project thay đổi:

```text
New Service
New API
New Business Rule
New ADR
New Incident
New Infrastructure
```

Knowledge cũng phải thay đổi.

Có thể hình dung:

```text
Software Lifecycle

Design
  ↓
Develop
  ↓
Deploy
  ↓
Operate
  ↓
Incident
  ↓
Learn
  ↓
Update Knowledge
  ↓
Next Development
```

Knowledge trở thành một phần của software development lifecycle.

Khi một service mới được tạo, knowledge được tạo.

Khi architecture thay đổi, knowledge được cập nhật.

Khi incident xảy ra, knowledge mới được sinh ra.

Khi một decision được đưa ra, ADR trở thành knowledge.

Đây là cách Knowledge Base không trở thành một thư mục documentation bị bỏ quên sau vài tháng.

---

# 34. Knowledge Base và AI Agent tạo thành một vòng lặp mới

Khi AI Agent tham gia vào development, flow có thể trở thành:

```text
                    Project
                       │
                       ▼
                   Knowledge
                       │
                       ▼
                   AI Agent
                       │
                       ▼
                  Development
                       │
                       ▼
                  Production
                       │
              ┌────────┴────────┐
              ▼                 ▼
           Changes           Incidents
              │                 │
              └────────┬────────┘
                       ▼
                 New Knowledge
                       │
                       └──────────► Knowledge Base
```

AI Agent sử dụng knowledge để làm việc.

Trong quá trình làm việc, project lại tạo ra knowledge mới.

Knowledge mới quay trở lại Knowledge Base.

Vòng lặp tiếp tục.

Điều này tạo ra một mô hình khá thú vị:

```text
Human
  ↓
Engineering Work
  ↓
Project Changes
  ↓
New Knowledge
  ↓
Knowledge Base
  ↓
AI Agent
  ↓
Better Engineering Work
```

Knowledge không còn chỉ là thứ được viết ra để đọc.

Nó trở thành một phần của **engineering infrastructure**.

---

# 35. Một Knowledge Base tốt trông như thế nào?

Cuối cùng, một Knowledge Base tốt không phải là nơi có nhiều documents nhất.

Nó là nơi mà khi một developer hoặc AI hỏi:

> **"Tôi cần biết gì để thực hiện task này?"**

hệ thống có thể cung cấp đúng context:

```text
Task
 ↓
Relevant Architecture
 ↓
Business Rules
 ↓
Technical Decisions
 ↓
Related Code
 ↓
Historical Issues
 ↓
Operational Constraints
 ↓
Implementation Context
```

Và quan trọng hơn, người dùng có thể biết:

* Information này đến từ đâu?
* Có còn active không?
* Ai chịu trách nhiệm?
* Đây là decision hay chỉ là discussion?
* Source of truth là gì?
* Có historical context nào liên quan không?

Đó mới là một Knowledge Base thực sự hữu ích.

---

# 36. Kết luận

Một Engineering Team có thể có hàng nghìn documents, hàng triệu dòng code và rất nhiều hệ thống lưu trữ information.

Nhưng điều đó không có nghĩa là team đã có một Knowledge Base tốt.

Knowledge chỉ thực sự có giá trị khi nó có thể được:

**tìm thấy → hiểu được → tin cậy → sử dụng → cập nhật.**

Với developer, Knowledge Base giúp giảm thời gian tìm kiếm và onboarding, đồng thời giảm sự phụ thuộc vào knowledge nằm trong đầu của một vài người.

Với AI Agent, Knowledge Base cung cấp thứ mà source code đơn thuần không thể cung cấp đầy đủ:

**project-specific context.**

Và để Knowledge Base không trở thành một kho documentation lỗi thời, nó cần được xem như một hệ thống sống: có source of truth, owner, lifecycle, feedback và liên tục được cải thiện từ những gì developer và AI gặp phải trong quá trình làm việc.

Cuối cùng, mục tiêu không phải là có một hệ thống chứa thật nhiều knowledge.

Mục tiêu là khi cần hiểu một phần của project, cả **developer và AI Agent đều có thể tìm được đúng context vào đúng thời điểm**.

Khi đó, knowledge của team không còn chỉ nằm trong những document rải rác, những cuộc trò chuyện cũ hay trong đầu của một vài senior developer.

Nó trở thành một phần có thể truy cập và sử dụng lại của chính hệ thống engineering.

**Và nếu một ngày Senior Engineer nghỉ việc...**

thì ít nhất team vẫn còn biết:

> **"Anh ấy đã để lại knowledge ở đâu."** 😄
