---
title: "Đừng quản lý cấu hình AI Agent một cách thủ công nữa: Tập trung hóa với Rulesync và Git"
description: "Một repository duy nhất để quản lý Skills, Hooks, MCP, Rules và toàn bộ cấu hình AI Agent."
pubDatetime: 2026-11-07T12:30:32+07:00
modDatetime: null
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
lang: "vi"
featured: false
draft: false
readingTime: 11
coverImage: "../../assets/articles/dung-quan-ly-cau-hinh-ai-agent-mot-cach-thu-cong-nua-tap-trung-hoa-voi-rulesync-va-git/cover.png"
series: null
sourceUrl: "https://viblo.asia/p/dung-quan-ly-cau-hinh-ai-agent-mot-cach-thu-cong-nua-tap-trung-hoa-voi-rulesync-va-git-bNVQGpn0JvR"
sourceReleasedAt: "2026-11-07T05:30:32.000000Z"
sourceUpdatedAt: "2026-11-07T05:58:02.000000Z"
sourceTags: ["AI", "AI Agent"]
---

*Một repository duy nhất để quản lý Skills, Hooks, MCP, Rules và toàn bộ cấu hình AI Agent.*

## 1. Vấn đề khi sử dụng nhiều AI Agent

AI Coding Agent đang dần trở thành một phần quen thuộc trong quy trình phát triển phần mềm.

Hiện nay, một developer có thể sử dụng Claude Code để phân tích và xử lý những bài toán phức tạp, OpenAI Codex để triển khai code, Gemini CLI để thử nghiệm hoặc OpenCode cho các tác vụ lập trình hằng ngày.

Mỗi công cụ đều có những thế mạnh và hệ sinh thái riêng.

Tuy nhiên, khi sử dụng nhiều AI Agent, chúng ta sẽ sớm gặp phải một vấn đề: **Cấu hình bị phân mảnh.**

Ví dụ:

- Claude Code có hệ thống Rules, Skills, Hooks và MCP riêng.
- Codex có `AGENTS.md`, Skills và cấu hình riêng.
- OpenCode có hệ thống Agent, Plugin và cấu hình riêng.
- Gemini CLI cũng có Settings và cơ chế mở rộng riêng.

Bây giờ, hãy tưởng tượng bạn muốn tạo một Skill có tên `security-audit`.

Bạn muốn tất cả AI Agent đều hiểu cùng một bộ tiêu chuẩn bảo mật, tuân theo cùng một quy trình review code và sử dụng cùng những công cụ cần thiết.

Nhưng thay vì định nghĩa một lần, bạn phải duy trì nhiều phiên bản cấu hình khác nhau cho từng agent.

Vấn đề tương tự cũng xảy ra với:

- Coding standards.
- Security guidelines.
- MCP server definitions.
- Hooks.
- Custom commands.
- Subagents.
- Permissions.

Theo thời gian, các cấu hình bắt đầu không đồng nhất. Một thay đổi trên Claude Code không tự động được cập nhật sang Codex hay OpenCode.

Chưa kể, khi thiết lập một máy tính hoặc VPS mới, bạn lại phải thực hiện toàn bộ quy trình cấu hình từ đầu.

Đây không hẳn là vấn đề của AI.

Đây là một bài toán **Configuration Management**.

## 2. Nếu quản lý AI Agent giống như quản lý Infrastructure thì sao?

Trong lĩnh vực DevOps, chúng ta đã giải quyết những bài toán tương tự từ lâu.

Thay vì cấu hình từng server một cách thủ công, chúng ta sử dụng:

- Ansible để quản lý cấu hình.
- Terraform để khai báo hạ tầng.
- Git để quản lý phiên bản.
- Docker để tạo môi trường có thể tái lập.

Nguyên tắc chung rất đơn giản:

**Khai báo cấu hình một lần, quản lý bằng Git và có khả năng tái tạo trên nhiều môi trường.**

Vậy tại sao không áp dụng nguyên tắc tương tự cho AI Agent?

Hãy tưởng tượng bạn có một Git repository chứa toàn bộ cấu hình AI Agent.

```text
ai-agent-config/
├── .rulesync/
│   ├── rules/
│   ├── skills/
│   ├── commands/
│   ├── subagents/
│   ├── hooks.jsonc
│   ├── mcp.jsonc
│   └── permissions.jsonc
│
├── rulesync.jsonc
└── README.md
```

Repository này trở thành nguồn dữ liệu cấu hình duy nhất (Single Source of Truth).

Thay vì duy trì nhiều phiên bản cấu hình cho từng AI Agent, chúng ta quản lý một nguồn cấu hình chung và generate sang định dạng tương ứng với từng công cụ được hỗ trợ.

Đây chính là ý tưởng của Rulesync.

## 3. Rulesync là gì?

[Rulesync](https://github.com/dyoshikawa/rulesync) là một công cụ CLI mã nguồn mở, được xây dựng nhằm đồng bộ cấu hình giữa nhiều AI Coding Agent.

Ý tưởng chính của Rulesync là cung cấp một quy trình quản lý cấu hình chung cho nhiều công cụ AI khác nhau.

Thay vì phải tự duy trì nhiều định dạng cấu hình, developer có thể sử dụng Rulesync để generate cấu hình tương ứng cho các agent được hỗ trợ.

Các thành phần có thể quản lý hoặc generate tùy theo mức độ tương thích của từng agent:

| Thành phần | Chức năng |
|---|---|
| Rules | Hướng dẫn và tiêu chuẩn lập trình |
| Skills | Các khả năng có thể tái sử dụng |
| Hooks | Tự động hóa theo lifecycle events |
| MCP | Định nghĩa công cụ và tích hợp bên ngoài |
| Commands | Prompt và workflow tái sử dụng |
| Subagents | Các AI agent chuyên biệt |
| Permissions | Quyền truy cập và thực thi công cụ |

Điểm quan trọng cần phân biệt: Rulesync không phải AI Agent Runtime.

Nó không trực tiếp chạy AI Agent, không host MCP Server và cũng không điều phối các cuộc hội thoại.

Nó tập trung vào việc chuẩn hóa, đồng bộ và generate cấu hình.

Có thể hình dung Rulesync giống như một Configuration Compiler dành cho AI Coding Agent.

## 4. Rulesync hoạt động như thế nào?

Kiến trúc tương đối đơn giản:

```text
              Private Git Repository
                  ai-agent-config
                         |
                         |
                    .rulesync/
                         |
          +--------------+--------------+
          |              |              |
        Rules          Skills           MCP
          |              |              |
          +--------------+--------------+
                         |
                    Rulesync CLI
                         |
                  Generate Config
                         |
          +--------------+--------------+
          |              |              |
      Claude Code      Codex         OpenCode
          |              |              |
      Native Config  Native Config  Native Config
```

Quy trình gồm ba bước chính.

### Bước 1: Khai báo cấu hình

Tạo Rules, Skills, Hooks và MCP definitions trong repository.

Ví dụ, một Skill phục vụ việc security audit:

```text
security-audit/
├── SKILL.md
└── references/
    ├── owasp.md
    └── secure-coding.md
```

Skill này định nghĩa cách AI Agent kiểm tra code để phát hiện các lỗ hổng bảo mật.

### Bước 2: Generate cấu hình

Chạy lệnh:

```bash
rulesync generate
```

Rulesync sẽ generate các file cấu hình tương ứng với những agent đã được khai báo.

### Bước 3: Sử dụng cấu hình native

Các AI Agent được hỗ trợ sẽ đọc cấu hình theo định dạng riêng của chúng.

Developer không cần tự copy và duy trì cùng một bộ Rules trên từng công cụ.

Tuy nhiên, không phải agent nào cũng hỗ trợ tất cả tính năng. Cần kiểm tra compatibility matrix và kết quả generate trước khi sử dụng thực tế.

## 5. Git-Native: Quản lý một cấu hình trên nhiều máy

Đây có lẽ là phần thú vị nhất của kiến trúc này.

Chúng ta không cần triển khai một configuration management server.

Không cần database.

Không cần dashboard.

Không cần duy trì thêm một backend service.

Chỉ cần Git.

Ví dụ, bạn có ba môi trường phát triển:

```text
                Private GitHub Repository
                   ai-agent-config
                          |
           +--------------+--------------+
           |              |              |
        MacBook        Ubuntu VPS     Workstation
           |              |              |
        Rulesync       Rulesync       Rulesync
           |              |              |
        Claude          Codex         OpenCode
        Codex           Hermes*       Claude
        OpenCode
```

Mỗi máy clone cùng một repository.

Khi bạn cập nhật một Skill trên MacBook:

```bash
git add .
git commit -m "Add Java security audit skill"
git push
```

Trên VPS:

```bash
git pull
rulesync generate
```

Các AI Agent được hỗ trợ có thể sử dụng cấu hình mới.

Không cần thêm bất kỳ service tập trung nào.

*Lưu ý: Hermes và những agent khác cần được kiểm tra riêng về khả năng tương thích cấu hình native. Không nên mặc định Rulesync hỗ trợ đầy đủ mọi tính năng của chúng.*

### Tại sao điều này hữu ích?

Hãy tưởng tượng bạn vừa tạo một Ubuntu VPS mới.

Thay vì phải cài đặt và cấu hình từng AI Agent từ đầu, bạn chỉ cần:

1. Clone repository cấu hình.
2. Cài Rulesync.
3. Generate cấu hình cho các agent tương ứng.
4. Kiểm tra và sử dụng.

Môi trường làm việc có thể được tái tạo một cách nhất quán hơn.

Đây cũng là một cách tiếp cận phù hợp khi bạn sử dụng nhiều máy tính hoặc thường xuyên thay đổi môi trường phát triển.

## 6. Global Configuration và Project Configuration

Một điểm cần quan tâm khi thiết kế hệ thống quản lý AI Agent là phạm vi áp dụng cấu hình.

Không phải cấu hình nào cũng nên áp dụng cho tất cả project.

Ví dụ:

**Global Configuration**

Áp dụng trên toàn bộ môi trường phát triển:

- Quy tắc bảo mật chung.
- Coding standards.
- Quy tắc sử dụng Git.
- Các Skills dùng chung.
- MCP servers dùng chung.

**Project Configuration**

Chỉ áp dụng cho một repository cụ thể:

- Kiến trúc của project.
- Coding conventions riêng.
- Quy tắc nghiệp vụ.
- MCP servers đặc thù.
- Skills dành riêng cho project.

Ví dụ:

```text
Global Configuration
        |
        +-- Java Development
        +-- Security Audit
        +-- Git Workflow
        +-- General Coding Rules

Project: Payment Service
        |
        +-- Payment Domain Rules
        +-- Transaction Skills
        +-- Payment MCP
        +-- Architecture Guidelines
```

Cách phân chia này giúp tránh việc đưa quá nhiều context không liên quan vào mọi AI Agent.

Lưu ý rằng Rulesync có Global Mode, nhưng việc quản lý riêng các profile theo môi trường và project cần được thiết kế phù hợp với cơ chế hỗ trợ thực tế của công cụ.

## 7. Những điều Rulesync không giải quyết

Không nên xem Rulesync là một giải pháp quản lý toàn bộ hệ sinh thái AI Agent.

Nó có những giới hạn cần hiểu rõ:

- Không chạy hoặc quản lý lifecycle của AI Agent.
- Không host MCP servers.
- Không tự động đồng bộ Git giữa các máy.
- Không quản lý API keys hay OAuth tokens thay bạn.
- Không đảm bảo mọi agent hỗ trợ tất cả tính năng giống nhau.
- Không thay thế một AI Agent Orchestrator.

Vai trò của Rulesync chủ yếu nằm ở Configuration Management và Synchronization.

Nếu muốn tự động hóa việc đồng bộ nhiều máy, chúng ta vẫn cần Git workflow hoặc script riêng.

Đặc biệt, không nên commit API keys, OAuth tokens, authentication files hoặc `.env` vào repository, kể cả private repository.

## 8. Kết luận

Khi số lượng AI Coding Agent tăng lên, việc quản lý cấu hình thủ công sẽ ngày càng trở nên bất tiện.

Mỗi công cụ có một hệ sinh thái riêng, một định dạng cấu hình riêng và cách tổ chức riêng.

Thay vì chấp nhận việc maintain nhiều bộ cấu hình độc lập, chúng ta có thể tiếp cận bài toán này giống như cách quản lý Infrastructure:

- Git làm Single Source of Truth.
- Rulesync đảm nhiệm việc generate và đồng bộ cấu hình.
- Mỗi AI Agent sử dụng cấu hình native tương ứng.
- Mỗi máy có thể tái tạo môi trường từ cùng một repository.

Đây không phải là giải pháp biến tất cả AI Agent thành một công cụ duy nhất.

Mục tiêu là giúp chúng chia sẻ cùng một bộ quy tắc, kỹ năng và cấu hình mà không phải duy trì mọi thứ một cách thủ công.

**Khi đã có thể quản lý Infrastructure bằng Code, tại sao không quản lý AI Agent Configuration bằng Git?**

---

### Tài liệu tham khảo

- [Rulesync – GitHub](https://github.com/dyoshikawa/rulesync)
- [Rulesync – Documentation](https://rulesync.dyoshikawa.com/)
- [Rulesync – Supported Tools](https://rulesync.dyoshikawa.com/reference/supported-tools.html)
