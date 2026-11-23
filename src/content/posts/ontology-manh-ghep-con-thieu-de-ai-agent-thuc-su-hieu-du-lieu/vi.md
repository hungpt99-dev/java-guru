---
title: "Ontology: Mảnh ghép còn thiếu để AI Agent thực sự hiểu dữ liệu?"
description: "Trong những năm gần đây, chúng ta đã chứng kiến nhiều làn sóng công nghệ trong lĩnh vực AI: Vector Database, RAG, Knowledge Graph và gần đây là AI Agents."
slug: "ontology-manh-ghep-con-thieu-de-ai-agent-thuc-su-hieu-du-lieu"
locale: "vi"
translationKey: "ontology-manh-ghep-con-thieu-de-ai-agent-thuc-su-hieu-du-lieu"
pubDate: 2026-11-22T14:38:38+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
featured: false
draft: false
readingTime: 11
series: null
coverImage: "./cover.png"
---

Trong những năm gần đây, chúng ta đã chứng kiến nhiều làn sóng công nghệ trong lĩnh vực AI: Vector Database, RAG, Knowledge Graph và gần đây là AI Agents.

Mỗi công nghệ giải quyết một vấn đề khác nhau. RAG giúp AI tìm kiếm thông tin, Knowledge Graph giúp biểu diễn các mối quan hệ, còn AI Agents cho phép mô hình thực hiện những công việc phức tạp.

Nhưng có một vấn đề vẫn chưa được giải quyết triệt để:

**AI có thể tìm thấy dữ liệu, nhưng liệu nó có thực sự hiểu dữ liệu đó có ý nghĩa gì?**

Hãy tưởng tượng bạn hỏi một AI Agent:

"Doanh thu quý này của công ty là bao nhiêu?"

Trong hệ thống có nhiều nguồn dữ liệu:
- Revenue từ bảng giao dịch.
- Bookings từ hệ thống bán hàng.
- Recognized Revenue từ hệ thống kế toán.
- ARR từ hệ thống phân tích kinh doanh.

Tất cả đều liên quan đến doanh thu, nhưng chúng không có cùng ý nghĩa.

Một hệ thống RAG có thể tìm thấy tất cả những nguồn này. Tuy nhiên, việc xác định đâu là định nghĩa đúng trong ngữ cảnh cụ thể lại là một vấn đề khác.

Đây chính là lúc Ontology trở nên quan trọng.

## 1. Ontology là gì?

Trong lĩnh vực công nghệ, Ontology là cách mô hình hóa một lĩnh vực thông qua các khái niệm, thuộc tính, mối quan hệ và quy tắc giữa chúng.

Thay vì chỉ lưu trữ dữ liệu, Ontology mô tả ý nghĩa của dữ liệu và cách các thành phần liên kết với nhau.

Ví dụ, trong hệ thống thương mại điện tử:

- Customer có thể đặt nhiều Orders.
- Order chứa nhiều Order Items.
- Order Item tham chiếu đến Product.
- Payment được liên kết với Order.
- Revenue được tính dựa trên những quy tắc nghiệp vụ cụ thể.

Những mối quan hệ này không chỉ giúp hệ thống biết dữ liệu nằm ở đâu, mà còn hiểu cấu trúc nghiệp vụ phía sau.

Có thể hình dung Ontology như một bản đồ ngữ nghĩa của toàn bộ domain.

Điểm quan trọng là Ontology không đơn thuần là database schema. Database schema mô tả cách dữ liệu được tổ chức và lưu trữ, trong khi Ontology mô tả ý nghĩa của các khái niệm và mối quan hệ trong một lĩnh vực.

## 2. Tại sao AI Agent cần Ontology?

Khi làm việc với doanh nghiệp, AI Agent không chỉ cần truy cập dữ liệu mà còn phải hiểu ngữ cảnh nghiệp vụ.

Ví dụ, cùng một thuật ngữ Customer có thể mang nhiều ý nghĩa:

- Marketing xem Customer là người đăng ký hoặc tương tác.
- Sales xem Customer là một tài khoản có cơ hội kinh doanh.
- Finance xem Customer là đối tượng phát sinh doanh thu.
- Customer Support xem Customer là người cần hỗ trợ.

Nếu mỗi Agent tự diễn giải theo cách riêng, kết quả có thể không nhất quán.

Ontology giúp định nghĩa những khái niệm này, chỉ ra mối quan hệ và quy tắc sử dụng chúng.

Thay vì để Agent tự suy luận mọi thứ từ những tài liệu rời rạc, hệ thống có thể cung cấp một mô hình ngữ nghĩa thống nhất.

Đây là lý do Ontology đang được quan tâm trở lại trong kiến trúc Enterprise AI.

## 3. Ontology khác gì Knowledge Graph và RAG?

Đây là ba khái niệm thường xuất hiện cùng nhau nhưng có vai trò khác nhau.

| Công nghệ | Vai trò |
|---|---|
| RAG | Tìm kiếm và truy xuất thông tin |
| Knowledge Graph | Biểu diễn các thực thể và mối quan hệ |
| Ontology | Định nghĩa khái niệm, kiểu quan hệ và quy tắc |

Ví dụ trong domain ngân hàng:

Ontology định nghĩa:
- Customer là gì?
- Loan có những loại nào?
- Customer có thể sở hữu những loại Account nào?
- Quan hệ giữa Loan, Payment và Customer ra sao?

Knowledge Graph chứa các dữ liệu cụ thể:
- Customer A sở hữu Account B.
- Account B có Loan C.
- Loan C có trạng thái ACTIVE.

RAG giúp Agent tìm kiếm những tài liệu liên quan đến quy trình cho vay, chính sách hoặc hướng dẫn nghiệp vụ.

Ba thành phần có thể kết hợp với nhau để giúp Agent vừa tìm kiếm thông tin, vừa hiểu mối quan hệ và quy tắc của domain.

## 4. Tại sao Ontology lại trở thành xu hướng?

Ontology thực ra không phải công nghệ mới. Nó đã tồn tại nhiều năm trong Semantic Web, Knowledge Engineering và Enterprise Data Management.

Điều thay đổi gần đây là sự xuất hiện của AI Agents.

Trước đây, con người có thể tự hiểu những thuật ngữ mơ hồ thông qua kinh nghiệm và kiến thức nghiệp vụ.

Nhưng khi Agent bắt đầu tự truy vấn dữ liệu, phân tích báo cáo và thực hiện hành động, việc thiếu định nghĩa thống nhất trở thành một vấn đề lớn.

Một Agent có thể tìm đúng bảng dữ liệu nhưng chọn sai metric. Nó có thể hiểu đúng câu hỏi nhưng sử dụng sai business rule.

Ontology giúp giải quyết khoảng cách giữa dữ liệu và ý nghĩa nghiệp vụ.

Một số tín hiệu đáng chú ý trong năm 2026:

**Databricks Genie Ontology**

Databricks đưa Genie Ontology lên General Availability vào tháng 11/2026. Hướng tiếp cận của họ là xây dựng một ontology có thể học từ hoạt động thực tế của doanh nghiệp, được Agent sử dụng và con người quản lý, kiểm chứng.

Điểm đáng chú ý là ontology không chỉ được xây dựng thủ công mà còn có thể được hình thành từ những dữ liệu và hoạt động hiện có của tổ chức.

**Neo4j Ontology Graph Specification**

Neo4j công bố một specification mở vào tháng 11/2026 nhằm chuẩn hóa cách biểu diễn domain knowledge dưới dạng có thể đọc và xử lý bằng máy.

Mục tiêu là giúp ontology có thể được chia sẻ và sử dụng giữa các hệ thống dữ liệu, ứng dụng và AI.

**Ontology và AI Grounding**

Một hướng tiếp cận khác là sử dụng Ontology để grounding AI Agent vào những định nghĩa nghiệp vụ đáng tin cậy.

Thay vì chỉ tìm kiếm nội dung tương tự, Agent có thể xác định khái niệm nào đang được đề cập, quan hệ nào áp dụng và nguồn dữ liệu nào được doanh nghiệp công nhận.

## 5. Ontology có thể thay thế RAG không?

Không.

RAG và Ontology giải quyết những vấn đề khác nhau.

RAG rất hữu ích khi Agent cần tìm kiếm thông tin trong lượng lớn tài liệu không có cấu trúc.

Ontology hữu ích khi Agent cần hiểu các khái niệm, mối quan hệ và quy tắc trong một domain.

Ví dụ:

Khi hỏi về chính sách hoàn tiền, RAG có thể tìm tài liệu chính sách liên quan.

Khi hỏi một đơn hàng có đủ điều kiện hoàn tiền không, Ontology có thể cung cấp cấu trúc nghiệp vụ về Order, Payment, Refund và các quy tắc liên quan.

Trong một hệ thống thực tế, hai công nghệ này nên bổ trợ cho nhau thay vì cạnh tranh.

## 6. Một kiến trúc AI Agent có Ontology

Có thể hình dung một kiến trúc tham khảo như sau:

- **LLM:** Xử lý ngôn ngữ và suy luận.
- **MCP:** Kết nối với database, API và các hệ thống bên ngoài.
- **RAG:** Truy xuất tài liệu và thông tin liên quan.
- **Ontology:** Cung cấp định nghĩa, quan hệ và business rules.
- **Knowledge Graph:** Lưu trữ các thực thể và mối quan hệ cụ thể.

Khi nhận một câu hỏi, Agent có thể sử dụng Ontology để xác định các khái niệm liên quan, sau đó sử dụng RAG hoặc MCP để lấy dữ liệu từ nguồn tương ứng.

Ví dụ, khi người dùng hỏi về doanh thu của một nhóm khách hàng, Agent cần hiểu Customer Segment là gì, Revenue được định nghĩa như thế nào, những giao dịch nào được tính và nguồn dữ liệu nào cần truy vấn.

Thay vì để LLM tự suy đoán toàn bộ, hệ thống cung cấp một lớp ngữ nghĩa có cấu trúc để Agent dựa vào.

Tất nhiên, Ontology không tự đảm bảo câu trả lời luôn chính xác. Chất lượng dữ liệu, quyền truy cập, business rules và cơ chế kiểm chứng vẫn rất quan trọng.

## 7. Tương lai: AI không chỉ cần dữ liệu mà cần hiểu biết

Chúng ta đã dành rất nhiều thời gian để cải thiện khả năng tìm kiếm dữ liệu cho AI.

Nhưng khi Agent ngày càng đảm nhận nhiều công việc phức tạp, việc tìm thấy thông tin không còn đủ.

Agent cần hiểu:
- Một khái niệm thực sự có ý nghĩa gì?
- Những thực thể nào có liên quan?
- Quy tắc nghiệp vụ nào cần được áp dụng?
- Nguồn dữ liệu nào đáng tin cậy?
- Những thay đổi trong một domain ảnh hưởng đến những thành phần nào?

Ontology mang đến một cách tiếp cận để giải quyết những vấn đề này.

Theo mình, Ontology có thể trở thành một thành phần quan trọng trong Knowledge Infrastructure dành cho AI Agents, đặc biệt trong những hệ thống doanh nghiệp có nhiều domain, nhiều nguồn dữ liệu và nhiều Agent cùng hoạt động.

**RAG giúp AI tìm thấy thông tin. Knowledge Graph giúp AI nhìn thấy mối quan hệ. Ontology giúp AI hiểu ý nghĩa đằng sau những mối quan hệ đó.**

Và có lẽ bước tiến tiếp theo của AI không chỉ là giúp mô hình biết nhiều hơn, mà là giúp nó hiểu thế giới mà nó đang làm việc một cách có cấu trúc hơn.

---

**Tài liệu tham khảo**

- [Databricks – Announcing GA of Genie Ontology](https://www.databricks.com/blog/announcing-ga-genie-ontology)
- [Neo4j – The Ontology Graph Specification](https://neo4j.com/blog/developer/the-neo4j-ontology-graph-specification-a-pragmatic-open-ai-first-approach/)
- [Atlan – Why AI Grounding Is Driving Ontology Demand](https://atlan.com/know/ai-agent/ontology/ontology-ai-grounding/)
- [Neo4j – Context Engine](https://neo4j.com/press-releases/neo4j-context-engine/)
