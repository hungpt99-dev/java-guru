---
title: "How to Set Up an AI Agent"
description: "Khi bắt đầu một project mới và muốn sử dụng AI Agent để hỗ trợ coding, nhiều người thường làm ngay một việc:"
slug: "how-to-set-up-an-ai-agent"
locale: "vi"
translationKey: "how-to-set-up-an-ai-agent"
pubDate: 2026-10-01T20:31:16+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
featured: false
draft: false
readingTime: 10
series: null
coverImage: "./cover.png"
---


Khi bắt đầu một project mới và muốn sử dụng AI Agent để hỗ trợ coding, nhiều người thường làm ngay một việc:

```text
Install AI coding agent
        ↓
Open project
        ↓
"Implement this feature"
```

Cách này có thể hoạt động với những task đơn giản. Nhưng khi project lớn hơn, Agent sẽ nhanh chóng gặp những vấn đề quen thuộc:

* Không hiểu architecture của project.
* Không biết coding convention.
* Không biết command nào dùng để build và test.
* Không có context về business rule.
* Không biết documentation của library đang dùng version nào.
* Không thể truy cập GitHub, Notion hoặc browser.
* Làm xong code nhưng không tự verify.
* Task dài bị dừng giữa chừng.

Vì vậy, trước khi giao task đầu tiên cho AI Agent, nên chuẩn bị một số thành phần cơ bản.

Mục tiêu của bài viết này không phải xây dựng một AI Agent platform. Đây chỉ là **practical setup checklist cho một coding project**.

Một setup tương đối đầy đủ có thể là:

```text
Project
│
├── Agent Runtime
├── Model / Provider
├── AGENTS.md
├── Skills
├── MCP
├── Project Knowledge
├── Git / GitHub
├── Task Management
├── Build / Test
├── Quality Rules
├── Long-running Workflow
└── Permissions
```

Không phải project nào cũng cần tất cả. Hãy bắt đầu từ những thành phần thực sự cần thiết.

---

## 1. Chọn Agent Runtime

Đầu tiên cần chọn công cụ mà Agent sẽ sử dụng để làm việc với repository.

Một số lựa chọn phổ biến:

* OpenCode
* Claude Code
* OpenHands
* Aider
* Codex
* GitHub Copilot coding agent

Agent Runtime thường chịu trách nhiệm:

* đọc file
* chỉnh sửa code
* gọi model
* sử dụng tools
* chạy command
* nhận kết quả từ tools
* tiếp tục task qua nhiều bước

Với coding agent, điều quan trọng không chỉ là model mà còn là **environment mà Agent được phép thao tác**.

Ví dụ:

```text
Agent
  ↓
Read repository
  ↓
Edit files
  ↓
Run command
  ↓
Read result
  ↓
Edit again
```

OpenAI cũng mô tả các thành phần như shell, file editing, MCP, skills và `AGENTS.md` là những primitive quan trọng khi xây coding-agent workflow.

Sau khi chọn runtime, hãy kiểm tra:

```bash
<agent> --version
```

và đọc help của CLI:

```bash
<agent> --help
```

Không nên copy command setup từ một bài viết cũ nếu CLI của bạn đã thay đổi.

---

# 2. Configure Model / Provider

Agent cần một model để reasoning và generate code.

Tùy runtime, bạn có thể dùng:

* OpenAI
* Anthropic
* Google Gemini
* DeepSeek
* hoặc provider được runtime hỗ trợ.

Thông thường sẽ cần API key hoặc authentication.

Ví dụ dạng environment variable:

```bash
export OPENAI_API_KEY="..."
```

Trên PowerShell:

```powershell
$env:OPENAI_API_KEY="..."
```

Không commit API key vào repository.

Nên kiểm tra Agent có thể gọi model trước khi setup những thành phần khác:

```text
Start Agent
    ↓
Ask simple question
    ↓
Agent responds
```

Nếu bước này chưa hoạt động thì chưa nên tiếp tục cấu hình MCP, Skills hoặc workflow.

---

# 3. Tạo `AGENTS.md`

Đây là một trong những thứ nên setup đầu tiên.

`AGENTS.md` là nơi lưu những instruction mà Agent cần tuân thủ khi làm việc trong repository.

Ví dụ:

```text
project/
├── AGENTS.md
├── src/
├── tests/
├── docs/
└── README.md
```

Một file đơn giản:

```markdown
# Project Instructions

## Project

This is a Java Spring Boot application.

## Architecture

- Follow the existing architecture.
- Do not introduce a new architectural pattern without justification.
- Keep business logic out of controllers.

## Development

- Use the existing dependency versions.
- Follow existing naming conventions.
- Reuse existing utilities before creating new ones.

## Testing

- Add tests for new business logic.
- Run the relevant test suite after changes.

## Git

- Do not commit secrets.
- Keep commits focused.
- Do not modify unrelated files.
```

`AGENTS.md` hiện được nhiều coding-agent tools hỗ trợ. GitHub Copilot, chẳng hạn, hỗ trợ `AGENTS.md` như agent instructions và có thể áp dụng instruction theo vị trí trong repository.

Một nguyên tắc quan trọng là **đừng biến `AGENTS.md` thành một cuốn documentation khổng lồ**.

Nó nên chứa những rule mà Agent cần biết thường xuyên.

---

# 4. Setup Skills

Sau Rules là Skills.

Nếu `AGENTS.md` trả lời:

> "Agent phải tuân thủ rule nào?"

thì Skill trả lời:

> "Khi thực hiện loại task này, Agent nên làm theo workflow nào?"

Ví dụ:

```text
skills/
├── debugging/
├── code-review/
├── testing/
├── api-design/
└── database-migration/
```

Một Skill cho debugging có thể hướng dẫn:

```text
1. Reproduce the issue.
2. Inspect logs.
3. Identify the failing component.
4. Find the root cause.
5. Implement the smallest fix.
6. Add or update tests.
7. Run regression tests.
```

Skills đặc biệt hữu ích cho những workflow được sử dụng nhiều lần.

OpenAI hiện mô tả Skills là các instruction có thể được lưu dưới dạng Markdown, có thể kèm resources và scripts, và phù hợp với workflow cụ thể.

Không cần tạo hàng chục Skill ngay từ đầu.

Một project có thể bắt đầu với:

```text
code-review
debugging
testing
```

Sau đó bổ sung khi xuất hiện workflow lặp lại.

---

# 5. Setup MCP

Sau khi Agent đã có Rules và Skills, bước tiếp theo là cho Agent truy cập những hệ thống mà nó cần.

MCP có thể được sử dụng để kết nối Agent với external tools.

Ví dụ:

```text
Agent
 │
 ├── GitHub MCP
 ├── Notion MCP
 ├── Playwright MCP
 └── Other MCP servers
```

MCP không thay thế Agent Runtime. Nó cung cấp một chuẩn để client/Agent kết nối với tools và các capability được MCP server expose.

### GitHub

Nếu Agent thường xuyên làm việc với GitHub, có thể sử dụng GitHub MCP Server hoặc GitHub CLI.

Song song với MCP, `gh` CLI vẫn rất hữu ích:

```bash
gh auth login
```

Kiểm tra authentication:

```bash
gh auth status
```

GitHub CLI chính thức hỗ trợ `gh auth login` để authenticate và `gh auth status` để kiểm tra trạng thái.

### Context7

Context7 là một MCP/CLI dành cho việc lấy documentation cập nhật của libraries trực tiếp vào coding workflow. Context7 hiện hỗ trợ setup cho nhiều coding agents, bao gồm OpenCode.

Ví dụ setup tự động:

```bash
npx ctx7 setup --mcp
```

Hoặc setup cho OpenCode:

```bash
npx ctx7 setup --opencode
```

Context7 cũng cung cấp MCP endpoint:

```text
https://mcp.context7.com/mcp
```

và hỗ trợ OAuth hoặc API key tùy cách client được cấu hình.

Sau khi setup, có thể yêu cầu Agent:

```text
Use Context7 to check the documentation for the exact version
of the Spring Boot library used by this project.
```

Điều này hữu ích khi Agent cần làm việc với API hoặc framework version cụ thể.

### Playwright

Nếu project có frontend hoặc web application, Playwright MCP có thể giúp Agent tương tác với browser.

Official setup sử dụng:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

Playwright MCP yêu cầu Node.js 20 trở lên và cung cấp browser automation thông qua MCP.

Sau khi setup, Agent có thể thực hiện workflow như:

```text
Start application
      ↓
Open browser
      ↓
Navigate to page
      ↓
Perform action
      ↓
Observe result
      ↓
Fix code
```

Không nên cài Playwright MCP nếu project chỉ có backend và Agent không cần browser.

---

# 6. Chuẩn bị Project Knowledge

Agent cần biết project trước khi bắt đầu thay đổi code.

Ít nhất nên có:

```text
README.md
Architecture documentation
API documentation
Database documentation
Development guide
```

Ví dụ:

```text
docs/
├── architecture.md
├── api.md
├── database.md
└── development.md
```

Một README tốt nên trả lời:

```text
What is this project?
How do I run it?
How do I build it?
How do I test it?
What are the major components?
Where are the important directories?
```

Đây thường có giá trị hơn việc ngay lập tức xây một hệ thống RAG phức tạp.

Nếu documentation nằm ở Notion, có thể kết nối Notion MCP để Agent truy cập chúng thay vì copy toàn bộ documentation vào prompt.

---

# 7. Chuẩn bị Git và GitHub

AI Agent sẽ thay đổi source code. Vì vậy Git là lớp bảo vệ rất quan trọng.

Trước khi giao task:

```bash
git status
```

Đảm bảo working tree ở trạng thái mà bạn hiểu được.

Sau đó kiểm tra:

```bash
git remote -v
```

Nếu sử dụng GitHub CLI:

```bash
gh auth status
```

Một workflow an toàn:

```text
Clean working tree
       ↓
Create branch
       ↓
Agent modifies code
       ↓
Review diff
       ↓
Run tests
       ↓
Commit
       ↓
Pull Request
```

Không nên để Agent trực tiếp làm việc trên production branch nếu workflow của team không cho phép.

---

# 8. Chuẩn bị Build và Test

Đây là bước rất quan trọng nhưng thường bị bỏ qua.

Agent cần biết **làm thế nào để kiểm tra code**.

Ví dụ Java:

```bash
./mvnw test
```

Node.js:

```bash
npm test
```

Go:

```bash
go test ./...
```

Python:

```bash
pytest
```

Không chỉ cần có test. Agent cần biết command chính xác.

Có thể ghi trong `AGENTS.md`:

```markdown
## Verification

Build:

./mvnw clean package

Unit tests:

./mvnw test

Integration tests:

./mvnw verify
```

GitHub cũng khuyến nghị custom instructions cho coding agents nên mô tả project structure, cách build, format, lint, test và các yêu cầu trước khi merge Pull Request.

Khi Agent sửa code:

```text
Change
  ↓
Build
  ↓
Test
  ↓
Failure?
 ├── Yes → Analyze → Fix → Test again
 └── No  → Continue
```

Đây là một trong những điều kiện quan trọng để Agent có thể tự kiểm chứng kết quả.

---

# 9. Setup Task Management

Nếu chỉ dùng prompt:

```text
"Implement payment retry."
```

Agent rất khó biết task nằm trong context nào.

Tốt hơn là task có:

```text
Title
Description
Acceptance Criteria
Technical Context
Dependencies
Expected Result
```

Có thể sử dụng:

* GitHub Issues
* Linear
* Jira

Ví dụ:

```text
Issue #123

Implement payment retry

Acceptance Criteria:
- Retry failed payments up to 3 times.
- Use exponential backoff.
- Do not duplicate successful payments.
- Add unit tests.
```

Agent có thể lấy issue làm source of truth thay vì nhận một prompt quá ngắn.

---

# 10. Setup Long-running Workflow

Một số task không thể hoàn thành trong một model response.

Ví dụ:

```text
Analyze
 ↓
Implement
 ↓
Test
 ↓
Failure
 ↓
Debug
 ↓
Fix
 ↓
Test
 ↓
Review
```

Nếu Agent Runtime hỗ trợ long-running/background execution thì sử dụng capability đó.

Nếu không, có thể dùng một Ralph-style loop hoặc worker để tiếp tục task qua nhiều iteration.

Điều quan trọng là task phải có **state và completion criteria**.

Ví dụ:

```text
Task is DONE when:

- Implementation completed
- Tests pass
- Build passes
- No unresolved errors
- Diff reviewed
```

Không nên dùng:

```text
while true
```

mà không có điều kiện dừng.

Long-running agent không có nghĩa là Agent chạy vô hạn. Nó có nghĩa là Agent có thể tiếp tục một task qua nhiều bước hoặc nhiều execution cycles.

---

# 11. Setup Permissions

Trước khi cho Agent quyền chạy command, cần kiểm tra nó được phép làm gì.

Ví dụ:

```text
Read source       → Allowed
Edit source       → Allowed
Run tests         → Allowed
Git commit        → Maybe allowed
Push              → Review
Delete files      → Restricted
Production deploy → Human approval
```

Đặc biệt cẩn thận với:

```text
rm
database commands
cloud CLI
production credentials
deployment commands
secret files
```

Nếu Agent có shell access, nên sử dụng permission controls hoặc sandbox phù hợp với runtime.

Với coding agent, nguyên tắc đơn giản là:

> **Cho Agent đủ quyền để hoàn thành task, nhưng không cho nhiều quyền hơn mức cần thiết.**

---

# 12. Cuối cùng: chạy một “setup check”

Sau khi hoàn thành các bước trên, đừng ngay lập tức giao feature lớn.

Hãy giao cho Agent một task nhỏ để kiểm tra environment.

Ví dụ:

```text
Before making any code changes:

1. Read AGENTS.md.
2. Inspect the repository structure.
3. Identify the main application entry point.
4. Identify the build command.
5. Identify the test command.
6. Check the current Git status.
7. Identify available MCP tools.
8. Identify relevant Skills.
9. Identify the main project documentation.
10. Do not modify any files yet.

Report:
- Project structure
- Technology stack
- Build command
- Test command
- Important rules
- Available tools
- Missing information
```

Đây là bước rất hữu ích vì nó cho thấy Agent đã thực sự hiểu environment hay chưa.

Nếu Agent trả lời:

```text
Build: ./mvnw clean package
Test: ./mvnw test
Architecture: Hexagonal
Main module: payment-service
Rules: AGENTS.md
```

thì mới bắt đầu giao task implementation.

---

# 13. Setup tối thiểu nên là gì?

Không phải project nào cũng cần toàn bộ stack.

Nếu chỉ muốn bắt đầu nhanh, tôi sẽ setup theo thứ tự:

```text
1. Agent Runtime
       ↓
2. Model / Provider
       ↓
3. AGENTS.md
       ↓
4. Git
       ↓
5. Build / Test
       ↓
6. Skills
       ↓
7. MCP
```

Sau đó mới thêm những thứ thực sự cần:

```text
Notion
Context7
GitHub MCP
Playwright
Task Management
Long-running workflow
```

Ví dụ một backend project:

```text
Agent Runtime
+
Model
+
AGENTS.md
+
Skills
+
Git
+
Tests
+
GitHub
+
Context7
```

Một web project:

```text
Backend stack
+
Playwright MCP
```

Một project có documentation lớn:

```text
Project
+
Notion
+
Knowledge / RAG
```

Một task cần nhiều giờ để hoàn thành:

```text
Project
+
Long-running execution
```

Không nên cài một tool chỉ vì nó đang phổ biến.

---

# Final Checklist

Trước khi giao task đầu tiên cho AI Agent, có thể kiểm tra:

```text
[ ] Agent Runtime installed
[ ] Model / Provider configured
[ ] AGENTS.md created
[ ] Skills configured
[ ] Required MCP servers connected
[ ] Project documentation available
[ ] Git configured
[ ] GitHub authenticated
[ ] Build command verified
[ ] Test command verified
[ ] Task source defined
[ ] Long-running workflow configured if needed
[ ] Agent permissions reviewed
```

Sau đó mới:

```text
Task
 ↓
Agent
 ↓
Understand
 ↓
Plan
 ↓
Implement
 ↓
Test
 ↓
Review
 ↓
Done
```

Điểm quan trọng nhất không phải là có bao nhiêu MCP hay bao nhiêu Skills.

Một Agent được setup tốt là Agent **biết project là gì, phải tuân thủ rule nào, có những tools nào, lấy context ở đâu, chạy test bằng cách nào và khi nào một task thực sự được xem là hoàn thành**.

Khi những thứ đó đã được chuẩn bị trước, prompt cho từng task có thể đơn giản hơn rất nhiều:

```text
Implement issue #123.

Follow the project rules,
use the relevant skills and tools,
run the required tests,
and do not consider the task complete
until the acceptance criteria are satisfied.
```

Đó mới là bước setup quan trọng trước khi bắt đầu dùng AI Agent để code.
