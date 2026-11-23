---
title: "Knowledge Factory: Hạ tầng còn thiếu cho AI Agent?"
description: "Trong cuộc đua phát triển AI Agent, chúng ta đang tập trung rất nhiều vào model mạnh hơn, context window lớn hơn, nhiều tools hơn và những workflow phức tạp hơn."
slug: "knowledge-factory-ha-tang-con-thieu-cho-ai-agent"
locale: "vi"
translationKey: "knowledge-factory-ha-tang-con-thieu-cho-ai-agent"
pubDate: 2026-11-22T14:28:21+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
featured: false
draft: false
readingTime: 18
series: null
coverImage: "./cover.png"
---

Trong cuộc đua phát triển AI Agent, chúng ta đang tập trung rất nhiều vào model mạnh hơn, context window lớn hơn, nhiều tools hơn và những workflow phức tạp hơn.

Nhưng có một vấn đề ít được chú ý: **Làm thế nào để AI Agent hiểu cách một doanh nghiệp thực sự vận hành, tích lũy kiến thức và tái sử dụng những hiểu biết đó trong công việc?**

Hãy tưởng tượng một nhân viên lâu năm trong công ty. Họ biết quy trình làm việc, hiểu các quy tắc nghiệp vụ, biết dữ liệu nằm ở đâu, nguồn nào đáng tin cậy và cần liên hệ với ai khi gặp vấn đề.

Những kiến thức này không phải lúc nào cũng tồn tại trong documentation. Một phần nằm trong Slack, Notion, GitHub, một phần nằm trong những cuộc trao đổi nội bộ, và một phần chỉ tồn tại trong kinh nghiệm của nhân viên.

AI Agent cũng cần những kiến thức tương tự để thực sự làm việc hiệu quả trong doanh nghiệp.

Trong bài viết *How to Build a Knowledge Factory* ngày 21/11/2026, Harrison Chase – CEO của LangChain – đưa ra một cách tiếp cận đáng chú ý: thay vì chỉ cải thiện model hoặc cung cấp thêm context, doanh nghiệp cần xây dựng một hệ thống để thu thập, tổ chức và duy trì knowledge cho Agent.

Hệ thống đó được gọi là **Knowledge Factory**.

## 1. Từ Software Factory đến Knowledge Factory

Trong khoảng thời gian gần đây, khái niệm Software Factory ngày càng được quan tâm.

Thay vì để những kỹ sư giỏi nhất dành toàn bộ thời gian trực tiếp viết phần mềm, doanh nghiệp có thể đầu tư xây dựng hệ thống, công cụ và quy trình giúp mọi người phát triển phần mềm hiệu quả hơn. Khi đó, AI Agent có thể đảm nhận ngày càng nhiều công việc triển khai thực tế.

Harrison Chase cho rằng công việc tri thức (knowledge work) cũng đang đi theo hướng tương tự.

AI Agent ngày nay đã có thể tạo presentation, sản xuất video marketing, thực hiện outbound sales và xử lý nhiều công việc văn phòng khác.

Tuy nhiên, để hoàn thành những công việc này theo đúng tiêu chuẩn của một doanh nghiệp, Agent cần hiểu rất nhiều thứ:

- Công ty hoạt động như thế nào?
- Quy trình thực hiện công việc ra sao?
- Những tiêu chuẩn nào cần tuân thủ?
- Dữ liệu nằm ở đâu và truy cập như thế nào?
- Tại sao doanh nghiệp lại áp dụng một quy trình cụ thể?

Những thông tin này thường phân tán và không được ghi chép đầy đủ.

Vì vậy, thay vì chỉ đầu tư vào khả năng thực thi của Agent, doanh nghiệp cần đầu tư vào hệ thống giúp thu thập, tổ chức và duy trì knowledge.

Đó chính là sự chuyển dịch từ Software Factory sang Knowledge Factory.

## 2. Context và Knowledge không giống nhau

Đây là một trong những điểm quan trọng nhất trong bài viết của LangChain.

**Context** là những thông tin mà Agent có sẵn trong quá trình thực hiện một task.

**Knowledge** là những hiểu biết có thể tái sử dụng, giúp Agent thực hiện công việc chính xác hơn.

Ví dụ, một Agent được giao nhiệm vụ tạo báo cáo doanh thu.

Context mà Agent cần có:
- Số liệu doanh thu hiện tại.
- Dữ liệu khách hàng.
- Thông tin giao dịch.

Knowledge mà Agent cần:
- Doanh nghiệp tính ARR như thế nào?
- Nguồn dữ liệu nào được xem là đáng tin cậy?
- Báo cáo cần tuân theo quy chuẩn nào?
- Cách truy cập dữ liệu doanh thu.

Knowledge có thể được cung cấp dưới dạng context cho Agent, nhưng không phải tất cả context đều cần được chuyển thành knowledge.

Đặc biệt, những dữ liệu thay đổi thường xuyên như doanh thu, trạng thái giao dịch hay thông tin khách hàng nên được truy xuất trực tiếp từ nguồn dữ liệu đáng tin cậy thay vì liên tục sao chép vào knowledge store.

Nói cách khác, Knowledge Factory không phải hệ thống lưu trữ mọi thứ mà Agent từng biết. Nó tập trung vào những hiểu biết có giá trị tái sử dụng.

## 3. Ba loại knowledge mà doanh nghiệp cần duy trì

LangChain chia knowledge thành ba nhóm chính.

### Skills – Cách thực hiện công việc

Skills chứa các quy trình, hướng dẫn và scripts giúp Agent thực hiện công việc theo cách mà doanh nghiệp mong muốn.

Ví dụ:
- Quy trình tạo báo cáo tài chính.
- Hướng dẫn review Pull Request.
- Quy trình triển khai phần mềm.
- Quy chuẩn viết tài liệu.
- Các bước xử lý một incident.

Điểm đáng chú ý là nhiều quy trình thực tế chưa từng được ghi thành tài liệu chính thức. Chúng thường được truyền đạt từ nhân viên này sang nhân viên khác.

Khi đưa AI Agent vào doanh nghiệp, những quy trình này cần được hệ thống hóa thành các hướng dẫn có thể tái sử dụng.

### Domain Knowledge – Kiến thức về doanh nghiệp

Domain Knowledge chứa những thông tin tương đối ổn định về tổ chức, sản phẩm, khách hàng, đối thủ và các quy tắc nghiệp vụ.

Ví dụ:
- Định nghĩa các chỉ số kinh doanh.
- Cách tính ARR.
- Thông tin về sản phẩm.
- Chính sách của doanh nghiệp.
- Các khái niệm và quy tắc nghiệp vụ.

Những thông tin này có thể đã tồn tại trong documentation, nhưng thường không đầy đủ hoặc không chính xác hoàn toàn.

Knowledge Factory giúp tập hợp và duy trì chúng để Agent có thể hiểu đúng bối cảnh doanh nghiệp.

### Data Access Guidance – Hướng dẫn truy cập dữ liệu

Nhóm này giúp Agent biết dữ liệu nằm ở đâu, nguồn nào cần được sử dụng và cách truy vấn chúng.

Ví dụ:
- Dữ liệu doanh thu nằm trong BigQuery.
- Thông tin khách hàng nằm trong Salesforce.
- Cách truy vấn những bảng dữ liệu liên quan.
- Nguồn dữ liệu nào được xem là nguồn chuẩn.

LangChain nhấn mạnh rằng nếu doanh nghiệp đã có chiến lược quản lý dữ liệu tốt với Snowflake, Databricks hoặc những hệ thống tương tự, không cần tạo thêm một bản sao dữ liệu chỉ để phục vụ Agent.

Thứ cần duy trì là hướng dẫn rõ ràng để Agent biết dữ liệu nào nằm ở đâu và cách truy cập chúng.

## 4. Kiến trúc của một Knowledge Factory

Một điểm quan trọng trong bài viết là LangChain không khuyến khích việc duy trì knowledge hoàn toàn bằng phương pháp thủ công.

Thay vào đó, họ đề xuất xây dựng một hệ thống gồm ba thành phần chính.

### Agent có khả năng báo cáo knowledge bị thiếu hoặc sai

Trong quá trình thực hiện công việc, Agent có thể phát hiện:
- Không tìm thấy thông tin cần thiết.
- Documentation không còn chính xác.
- Một nguồn dữ liệu đã thay đổi.
- Hướng dẫn hiện tại không phù hợp với tình huống thực tế.

Thay vì tự ý thay đổi knowledge dùng chung, Agent cần có một tool để báo cáo vấn đề và có thể đề xuất nội dung cần cập nhật.

Điều này giúp những vấn đề được phát hiện trong quá trình làm việc không bị bỏ qua.

### Curator Agent – Thành phần quản lý knowledge

Đây là thành phần chịu trách nhiệm cập nhật và duy trì knowledge.

Theo LangChain, Curator Agent nên hoạt động trong background theo một lịch trình nhất định.

Nó cần có quyền truy cập vào:

- Các nguồn dữ liệu gốc như Notion và Slack.
- Execution traces để hiểu cách Agent thực hiện công việc.
- Những vấn đề mà các Agent đã báo cáo.

Từ những thông tin này, Curator Agent có thể xác định knowledge nào cần bổ sung hoặc điều chỉnh.

Tại sao không để chính Agent sử dụng knowledge tự cập nhật?

Bởi vì Agent thực hiện công việc thường tập trung vào mục tiêu riêng của nó. Nó có thể phát hiện rất tốt những gì còn thiếu hoặc sai, nhưng việc cập nhật knowledge dùng chung đòi hỏi phải hiểu sâu hơn về nguồn dữ liệu và các thông tin liên quan.

Nếu mọi Agent đều tự do sửa đổi knowledge, hệ thống có thể nhanh chóng xuất hiện những nội dung mâu thuẫn và thiếu nhất quán.

### Knowledge Storage – Nơi lưu trữ knowledge

LangChain cho rằng storage thực tế không phải thành phần quan trọng nhất của Knowledge Factory.

Knowledge có thể được lưu ở nhiều nơi:

- GitHub với định dạng Skills.
- Notion dưới dạng tài liệu.
- LangSmith Context Hub với định dạng OKF.
- Neo4j dưới dạng Knowledge Graph.

Điều quan trọng là Curator Agent có thể tương tác với những định dạng lưu trữ này.

Đối với procedural memory (kiến thức về cách thực hiện công việc), ngành công nghiệp đã dần hội tụ vào định dạng Skills.

Tuy nhiên, với semantic memory (kiến thức về ý nghĩa, sự kiện và các mối quan hệ), vẫn chưa có một tiêu chuẩn thống nhất. LangChain đề cập OKF như một hướng có thể được quan tâm, nhưng cũng nhấn mạnh rằng lĩnh vực này vẫn còn ở giai đoạn đầu.

Do đó, không nên vội xây dựng một hệ thống lưu trữ quá phức tạp hoặc cố định vào một định dạng duy nhất.

## 5. Ví dụ thực tế: Agent tạo báo cáo doanh thu

Để hiểu cách Knowledge Factory hoạt động, Harrison Chase đưa ra một ví dụ về Agent tạo báo cáo doanh thu.

Đầu tiên, Agent cần dữ liệu doanh thu từ BigQuery và Salesforce.

Ngoài dữ liệu, Agent còn cần ba loại knowledge:

- **Skills:** Hướng dẫn cách tạo báo cáo theo tiêu chuẩn của LangChain, được lưu trong GitHub.
- **Domain Knowledge:** Cách tính ARR, được lưu trong company wiki.
- **Data Access Guidance:** Hướng dẫn truy cập dữ liệu BigQuery và Salesforce, được lưu dưới dạng Skills trong Context Hub.

Sau khi được cung cấp đầy đủ thông tin, Agent bắt đầu tạo báo cáo.

Trong quá trình thực hiện, Agent phát hiện một column trong BigQuery đã được đổi tên. Nó tự tìm được column chính xác để tiếp tục công việc, đồng thời sử dụng tool để báo cáo vấn đề và đề xuất tên column mới.

Sau khi báo cáo được tạo, Finance Lead tiếp tục làm việc với Agent để điều chỉnh một số vấn đề về định dạng, bao gồm yêu cầu sử dụng một header mới cho tất cả tài liệu của LangChain.

Đến buổi tối, Curator Agent kiểm tra những vấn đề đã được báo cáo và xem lại execution traces.

Nó phát hiện hai thay đổi cần được cập nhật:
- Tên column mới trong BigQuery.
- Quy chuẩn header mới cho tài liệu.

Curator Agent cập nhật những Skills liên quan để các lần tạo báo cáo tiếp theo sử dụng đúng hướng dẫn.

Điểm đáng chú ý ở đây là knowledge không cần được hoàn thiện trước khi Agent bắt đầu làm việc. Chính quá trình thực thi đã giúp phát hiện những thông tin cần bổ sung.

## 6. Knowledge Factory khác gì RAG và Knowledge Graph?

Knowledge Factory có liên quan đến nhiều công nghệ đang phổ biến trong hệ sinh thái AI, nhưng không đồng nghĩa với chúng.

| Công nghệ | Vai trò chính |
|---|---|
| RAG | Truy xuất thông tin liên quan để cung cấp context |
| Knowledge Graph | Biểu diễn thực thể và mối quan hệ |
| Ontology | Định nghĩa các khái niệm và cấu trúc ngữ nghĩa |
| Skills | Hướng dẫn Agent cách thực hiện công việc |
| Knowledge Factory | Thu thập, duy trì và cải thiện knowledge cho Agent |

RAG có thể giúp Agent tìm kiếm tài liệu, Knowledge Graph có thể biểu diễn những mối quan hệ phức tạp, còn Skills giúp Agent thực hiện công việc theo quy trình.

Knowledge Factory nằm ở một lớp quản lý rộng hơn: đảm bảo những knowledge này được hình thành, duy trì và cập nhật để Agent có thể sử dụng lâu dài.

Đây là cách phân biệt về mặt kiến trúc, không phải các thành phần bắt buộc phải có trong mọi triển khai Knowledge Factory.

## 7. Bắt đầu xây dựng Knowledge Factory từ đâu?

Một trong những thông điệp đáng chú ý nhất ở cuối bài viết của Harrison Chase là không cần document mọi thứ trước khi đưa Agent vào hoạt động.

Thay vào đó, hãy bắt đầu với một workflow có tính lặp lại.

Ví dụ:
- Tạo báo cáo doanh thu hàng tuần.
- Review Pull Request.
- Tổng hợp báo cáo khách hàng.
- Phân tích dữ liệu kinh doanh.

Sau đó, quan sát những khó khăn mà Agent gặp phải trong quá trình thực hiện.

Agent thường xuyên hỏi lại thông tin nào? Documentation nào đã lỗi thời? Quy trình nào chưa được ghi chép? Dữ liệu nào khó truy cập?

Những vấn đề này chính là nguồn đầu vào để cải thiện knowledge.

Khi workflow hoạt động ổn định, có thể tiếp tục mở rộng sang những quy trình khác và từng bước xây dựng knowledge infrastructure cho toàn bộ tổ chức.

## 8. Tương lai của AI Agent có cần một Knowledge Infrastructure riêng?

Hiện nay, chúng ta thường đánh giá AI Agent dựa trên model nào tốt hơn, có bao nhiêu tools, hỗ trợ MCP nào và khả năng tự động hóa được bao nhiêu công việc.

Nhưng khi các công nghệ này ngày càng phổ biến, một câu hỏi khác bắt đầu trở nên quan trọng:

**Làm thế nào để hàng trăm AI Agents có thể sử dụng chung knowledge của một tổ chức mà không phải liên tục khám phá lại từ đầu?**

Đây không đơn thuần là bài toán lưu trữ tài liệu hay xây dựng một hệ thống RAG lớn hơn.

Nó liên quan đến cách knowledge được hình thành, kiểm chứng, quản lý phiên bản và phân phối đến đúng Agent.

Theo mình, Knowledge Factory mở ra một hướng phát triển đáng chú ý: thay vì chỉ xây dựng những Agent có khả năng thực thi tốt hơn, chúng ta cần đầu tư vào hạ tầng giúp Agent tận dụng tri thức của cả tổ chức.

Model cung cấp khả năng suy luận. Tools cung cấp khả năng hành động. Nhưng knowledge giúp Agent hiểu cách thực hiện công việc trong một môi trường cụ thể.

**Có lẽ lợi thế cạnh tranh của những hệ thống AI Agent trong tương lai không chỉ nằm ở model hay số lượng tools, mà còn nằm ở chất lượng knowledge infrastructure phía sau chúng.**

---

**Tài liệu tham khảo**

- Harrison Chase – [How to Build a Knowledge Factory](https://www.langchain.com/blog/knowledge-factory), LangChain, November 21, 2026.
- [LangChain Documentation](https://docs.langchain.com/)
