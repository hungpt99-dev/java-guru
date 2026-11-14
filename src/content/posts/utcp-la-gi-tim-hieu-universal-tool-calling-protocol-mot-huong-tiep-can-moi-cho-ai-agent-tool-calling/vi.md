---
title: "UTCP là gì? Tìm hiểu Universal Tool Calling Protocol – Một hướng tiếp cận mới cho AI Agent Tool Calling"
description: "Trong khi MCP đang trở thành một tiêu chuẩn phổ biến để kết nối AI Agent với các công cụ bên ngoài, một giao thức khác xuất hiện với cách tiếp cận khác: UTCP – gọi trực tiếp các công cụ thông qua native endpoints mà không cần xây dựng thêm server trung gian."
slug: "utcp-la-gi-tim-hieu-universal-tool-calling-protocol-mot-huong-tiep-can-moi-cho-ai-agent-tool-calling"
locale: "vi"
translationKey: "utcp-la-gi-tim-hieu-universal-tool-calling-protocol-mot-huong-tiep-can-moi-cho-ai-agent-tool-calling"
pubDate: 2026-11-08T11:56:10+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent", "MCP"]
featured: false
draft: false
readingTime: 10
series: null
coverImage: "./cover.png"
---

*Trong khi MCP đang trở thành một tiêu chuẩn phổ biến để kết nối AI Agent với các công cụ bên ngoài, một giao thức khác xuất hiện với cách tiếp cận khác: UTCP – gọi trực tiếp các công cụ thông qua native endpoints mà không cần xây dựng thêm server trung gian.*

## 1. UTCP là gì?

**UTCP (Universal Tool Calling Protocol)** là một open standard được thiết kế để chuẩn hóa cách các ứng dụng AI, đặc biệt là AI Agent, khám phá và gọi các công cụ (tools) thông qua nhiều giao thức giao tiếp khác nhau.

Thay vì yêu cầu mỗi công cụ phải được đóng gói trong một server riêng để AI Agent có thể sử dụng, UTCP cho phép mô tả công cụ bằng metadata và cung cấp thông tin cần thiết để client gọi trực tiếp endpoint tương ứng.

Các giao thức có thể được sử dụng bao gồm:

- HTTP / REST API
- WebSocket
- gRPC
- CLI
- Các transport khác thông qua hệ thống plugin.

Triết lý cốt lõi của UTCP:

**If humans can interact with an API, AI should be able to do the same.**

Nói cách khác, nếu một hệ thống đã cung cấp API để con người hoặc ứng dụng khác sử dụng, chúng ta nên có khả năng cho AI Agent sử dụng chính API đó mà không cần xây dựng thêm một lớp wrapper chỉ dành riêng cho AI.

![image.png](/images/articles/utcp-la-gi-tim-hieu-universal-tool-calling-protocol-mot-huong-tiep-can-moi-cho-ai-agent-tool-calling/figure-1.png)

## 2. UTCP ra đời khi nào? Ai phát triển?

UTCP được giới thiệu công khai vào tháng 7/2025, trong bối cảnh hệ sinh thái AI Agent đang phát triển nhanh chóng và nhu cầu tích hợp các công cụ bên ngoài ngày càng tăng.

### Timeline

| Thời gian | Sự kiện |
| --- | --- |
| 15/07/2025 | Bài viết giới thiệu UTCP được công bố |
| 17/07/2025 | UTCP ra mắt trên Product Hunt |
| 2025 | Hệ sinh thái bắt đầu mở rộng với các implementation và integrations |
| 2026 | Tiếp tục phát triển specification, SDK và các integration |

### Những người đứng sau UTCP

Theo trang About chính thức, một số thành viên trong đội ngũ phát triển và duy trì dự án gồm:

- **Razvan-Ion Radulescu:** Tác giả RFC UTCP 1.0.0, UTCP Admin, liên hệ với Bevel Software.
- **Andrei-Stefan Ghiurtu:** UTCP Admin.
- **Ulugbek Isroilov:** UTCP Admin.
- **Juan Viera Garcia:** Distribution Team, Bevel Software.
- **Ali Raza:** Distribution Team, Bevel Software.
- **Kamil Mościszko:** Maintainer của Go implementation.

UTCP được phát triển theo mô hình open-source với sự tham gia của cộng đồng.

Thông tin dự án:

- Website: [https://utcp.io/](https://utcp.io/)
- GitHub: [https://github.com/universal-tool-calling-protocol](https://github.com/universal-tool-calling-protocol)
- License: MPL-2.0

## 3. Tại sao UTCP được tạo ra?

Để hiểu lý do UTCP xuất hiện, hãy nhìn vào cách tích hợp tools truyền thống trong hệ sinh thái AI Agent.

Giả sử bạn muốn xây dựng một Agent có khả năng thao tác với GitHub.

GitHub đã cung cấp REST API:

```http
POST https://api.github.com/repos/{owner}/{repo}/issues
```

Tuy nhiên, để một MCP Client sử dụng API này, chúng ta thường phải triển khai một MCP Server đóng vai trò adapter.

Kiến trúc:

```text
AI Agent
    |
    v
MCP Client
    |
    v
MCP Server
    |
    v
GitHub REST API
```

MCP Server sẽ chịu trách nhiệm:

- Khai báo các tools.
- Nhận request từ MCP Client.
- Chuyển đổi request thành GitHub API request.
- Xử lý authentication.
- Trả kết quả về cho client.

Cách tiếp cận này rất hữu ích trong nhiều trường hợp. Tuy nhiên, nó cũng tạo ra một thành phần mới cần phát triển và vận hành.

Nếu có 50 hệ thống khác nhau, việc xây dựng và duy trì các adapter tương ứng có thể tạo ra một lượng integration code đáng kể.

UTCP đưa ra một hướng tiếp cận khác:

Thay vì xây dựng thêm server cho từng hệ thống, hãy mô tả cách gọi các công cụ bằng một định dạng chuẩn hóa, sau đó để client gọi trực tiếp native endpoint.

Đó là ý tưởng đằng sau khái niệm mà UTCP gọi là **Wrapper Tax**.

## 4. Kiến trúc tổng quan của UTCP

UTCP có một số thành phần quan trọng:

### 4.1. Tool Manual

Tool Manual là tài liệu mô tả các công cụ mà một provider cung cấp.

Nó chứa thông tin để client có thể khám phá và gọi tool, chẳng hạn:

- Tool name.
- Description.
- Input schema.
- Output schema.
- Provider / transport.
- Call template.
- Authentication configuration.

Có thể xem Tool Manual như một bản mô tả hợp đồng giao tiếp giữa AI Agent và các công cụ.

### 4.2. UTCP Client

UTCP Client chịu trách nhiệm:

- Khám phá các tools.
- Đọc và quản lý Tool Manual.
- Tìm kiếm tools phù hợp.
- Chuẩn bị tham số đầu vào.
- Chọn transport tương ứng.
- Thực hiện tool invocation.
- Xử lý kết quả trả về.

Điểm quan trọng là client không cần sử dụng một transport duy nhất cho tất cả các tools.

### 4.3. Provider / Transport

Mỗi tool có thể được gọi thông qua một phương thức giao tiếp phù hợp với hệ thống cung cấp nó.

Ví dụ:

| Tool | Transport |
| --- | --- |
| GitHub API | HTTP |
| Internal service | gRPC |
| Browser automation | WebSocket |
| Local utility | CLI |

Điều này giúp UTCP có thể tích hợp nhiều loại hệ thống mà không buộc chúng phải thay đổi giao thức hiện tại.

### 4.4. Authentication

UTCP hỗ trợ mô tả thông tin authentication để client có thể sử dụng cơ chế xác thực phù hợp khi gọi tools.

Tuy nhiên, việc mô tả authentication không đồng nghĩa với việc UTCP tự động bảo đảm toàn bộ authorization và security của hệ thống. Các quyền truy cập vẫn cần được kiểm soát tại client, provider và native endpoint.

## 5. UTCP hoạt động như thế nào?

Giả sử người dùng yêu cầu:

"Create a GitHub issue with title Bug in payment service."

Quy trình tổng quan:

**Step 1 – Discovery**

UTCP Client lấy Tool Manual từ provider.

**Step 2 – Tool Selection**

AI Agent tìm thấy tool:

```text
github.create_issue
```

**Step 3 – Parameter Generation**

Agent tạo input:

```json
{
  "owner": "my-company",
  "repo": "payment-service",
  "title": "Bug in payment service",
  "body": "..."
}
```

**Step 4 – Invocation**

UTCP Client sử dụng thông tin trong Tool Manual để gọi GitHub REST API trực tiếp.

```http
POST /repos/my-company/payment-service/issues
```

**Step 5 – Response**

GitHub trả kết quả về UTCP Client, sau đó kết quả được chuyển cho AI Agent.

Điểm khác biệt là không cần một MCP Server riêng đứng giữa để proxy request trong kiến trúc này.

## 6. UTCP và MCP khác nhau như thế nào?

Cả hai đều hướng đến việc giúp AI Application sử dụng các công cụ bên ngoài, nhưng có cách tiếp cận kiến trúc khác nhau.

| Tiêu chí | MCP | UTCP |
| --- | --- | --- |
| Mô hình | Client – Server | Client – Native endpoint |
| Tool discovery | MCP Server cung cấp tools | Tool Manual |
| Tool invocation | Gửi request qua MCP Server | Gọi native endpoint |
| Transport | stdio, Streamable HTTP | HTTP, gRPC, WebSocket, CLI... |
| Wrapper | Thường cần server adapter | Không bắt buộc |
| Mở rộng | MCP Server và ecosystem | Provider / transport plugins |
| Mục tiêu | Chuẩn hóa giao tiếp AI với tools | Chuẩn hóa mô tả và cách gọi tools |

Lưu ý: MCP cũng hỗ trợ nhiều transport và không phải mọi MCP Server đều cần triển khai như một dịch vụ HTTP độc lập. So sánh trên tập trung vào kiến trúc tích hợp phổ biến và triết lý thiết kế của hai giao thức.

UTCP không nhất thiết phải thay thế MCP. Hai cách tiếp cận có thể cùng tồn tại tùy thuộc vào yêu cầu hệ thống.

## 7. Hệ sinh thái UTCP hiện tại

UTCP không chỉ dừng lại ở specification mà đã có các implementation và integration dành cho nhiều hệ sinh thái phát triển khác nhau.

Một số dự án đáng chú ý:

| Project | Mục đích |
| --- | --- |
| python-utcp | Official Python implementation |
| typescript-utcp | Official TypeScript implementation |
| go-utcp | Official Go implementation |
| langchain-utcp-adapters | Tích hợp UTCP với LangChain |
| pydantic-ai-utcp | Tích hợp UTCP với Pydantic AI |
| utcp-agent | Agent sử dụng UTCP |

Các dự án có thể tìm thấy tại GitHub Organization chính thức.

## 8. Khi nào nên sử dụng UTCP?

UTCP đáng cân nhắc trong những trường hợp sau:

**Trường hợp 1: Hệ thống đã có REST API**

Bạn muốn cho AI Agent sử dụng các API hiện có mà không muốn viết thêm một adapter server cho từng hệ thống.

**Trường hợp 2: Có nhiều loại giao thức**

Hệ thống cần kết nối nhiều công cụ sử dụng HTTP, gRPC, WebSocket hoặc CLI.

**Trường hợp 3: Muốn giảm integration overhead**

Bạn muốn giảm số lượng wrapper, middleware và các thành phần phải vận hành.

**Trường hợp 4: Muốn xây dựng AI Agent có khả năng mở rộng**

Bạn muốn bổ sung tools bằng cách khai báo metadata thay vì viết lại logic tích hợp cho từng tool.

Tuy nhiên, nếu cần một lớp kiểm soát tập trung, quản lý lifecycle, session hoặc chính sách bảo mật riêng, kiến trúc MCP Server hoặc một gateway trung gian vẫn có thể phù hợp hơn.

## 9. Những vấn đề cần quan tâm khi sử dụng UTCP

Việc gọi trực tiếp native endpoint không đồng nghĩa với việc mọi vấn đề tích hợp đều biến mất.

Một hệ thống production vẫn cần giải quyết:

- Credential management.
- Permission và authorization.
- Rate limiting.
- Timeout và retry.
- Audit logging.
- Network isolation.
- Tool discovery và metadata management.
- Quản lý version của Tool Manual.

Đặc biệt, khi AI Agent được quyền thực thi CLI hoặc gọi API có khả năng thay đổi dữ liệu, cần có cơ chế kiểm soát quyền và xác nhận các thao tác nhạy cảm.

## 10. Kết luận

UTCP xuất hiện với một góc nhìn đáng chú ý về kiến trúc AI Agent Tool Calling.

Thay vì yêu cầu mỗi integration phải có một lớp server trung gian, UTCP tập trung vào việc mô tả cách gọi các công cụ và tận dụng trực tiếp những giao thức mà hệ thống hiện tại đang hỗ trợ.

Đây không phải là câu chuyện một giao thức tốt hơn giao thức còn lại, mà là hai cách tiếp cận khác nhau đối với bài toán kết nối AI với thế giới bên ngoài.

Một câu hỏi đáng để suy nghĩ:

**Trong tương lai, liệu chúng ta sẽ tiếp tục xây dựng hàng nghìn wrapper dành riêng cho AI, hay sẽ để AI Agent sử dụng trực tiếp những API mà hệ thống đã cung cấp?**

---

## References

1. [UTCP Official Website](https://utcp.io/)
2. [Introducing UTCP – July 15, 2025](https://www.utcp.io/blog/introducing-utcp)
3. [UTCP Specification](https://github.com/universal-tool-calling-protocol/utcp-specification)
4. [UTCP RFC 1.0.0](https://www.utcp.io/about/RFC)
5. [UTCP About Us](https://www.utcp.io/about/about-us)
6. [UTCP GitHub Organization](https://github.com/universal-tool-calling-protocol)
7. [UTCP Product Hunt Launch](https://www.producthunt.com/products/utcp)
