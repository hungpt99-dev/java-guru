---
title: "Thiết kế dịch vụ giải thích giao dịch đáng tin cậy bằng LLM và RAG"
description: "Thiết kế thực tế để giải thích giao dịch của khách hàng bằng retrieval-augmented generation trên các sự kiện ledger và transfer."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["java", "ai", "fintech", "architecture"]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/customer-service>

## Bài toán

Khi khách hàng hỏi “Khoản phí này từ đâu ra?”, họ cần câu trả lời chính xác, có bằng chứng, thay vì một phản hồi chatbot chung chung. Câu trả lời có thể phải đối chiếu một biến động số dư với vòng đời của giao dịch chuyển tiền, rồi chuyển các bản ghi kỹ thuật thành ngôn ngữ khách hàng hiểu được.

Đây là thiết kế tham khảo cho FinPay, không phải báo cáo về một hệ thống đã triển khai.

Mô tả dự án được cung cấp nêu hai Kafka topic là `finpay.ledger` và `finpay.transfer`, dùng `customerId` làm key:

- `finpay.ledger` chứa các khoản ghi nợ, ghi có, phí và hoàn tiền.
- `finpay.transfer` chứa vòng đời như `CREATED`, `SETTLED`, `FAILED` và `REFUNDED`.

Kafka hữu ích như nguồn để replay, nhưng database vẫn là system of record cho góc nhìn giao dịch hiển thị cho khách hàng. OpenSearch có thể là read model phục vụ retrieval, không phải nguồn quyết định về tiền.

## Vì sao khó

Bằng chứng nằm trên nhiều stream, có thể đến không đúng thứ tự và được điều chỉnh bởi các event đến sau. Một khách hàng có thể có nhiều giao dịch cùng số tiền và thời điểm gần nhau. Dùng chung key `customerId` giúp tổ chức dữ liệu; nó không chứng minh hai bản ghi thuộc cùng giao dịch và cũng không cấp quyền truy cập.

Event thô có thể chứa PII, mã nội bộ, dữ liệu định tuyến hoặc chi tiết triển khai. LLM cũng có thể tạo văn bản trôi chảy nhưng không có bằng chứng, nhầm hai event tương tự, hoặc biến trạng thái chưa chắc chắn thành khẳng định chắc chắn. Vì vậy cần một luồng xác định bao quanh thành phần xác suất.

## Thiết kế ngây thơ

Ý tưởng đầu tiên là tải toàn bộ lịch sử rồi đưa JSON nội bộ vào prompt.

```java
// WRONG: lịch sử không giới hạn và trường nội bộ đi vào prompt
List<JsonNode> events = ledgerRepo.findAllForCustomer(customerId);
events.addAll(transferRepo.findAllForCustomer(customerId));
String prompt = "Explain this transaction:\n" + events;
return llm.complete(prompt);
```

Một cách dễ nghĩ khác là ghi lời giải thích mỗi khi có request:

```java
// WRONG: exists() chỉ là bước kiểm tra trước
if (!explanationRepo.exists(transactionId)) {
    explanationRepo.insert(transactionId, llm.complete(prompt));
}
```

Cách sửa là để database claim một cách nguyên tử và tách việc phát thông báo:

```java
// RIGHT: unique(transaction_id, explanation_version) phân xử race
Explanation result = explanationRepo.insertIfAbsent(
        transactionId, explanationVersion, explanation);
outbox.enqueueIfAbsent(result.id(), "EXPLANATION_READY");
```

## Vì sao hỏng

Prompt không giới hạn sẽ vượt context, tăng latency và chi phí, đồng thời có thể lấy nhầm khoảng thời gian. Trường nội bộ có thể bị lộ. Các request retry hoặc chạy đồng thời đều có thể cùng vượt qua `exists()`, tạo bản ghi hoặc thông báo trùng. Nếu model trả lời xong nhưng request timeout trước khi commit, hệ thống rơi vào trạng thái không rõ ràng. Model có thể outage, bị rate limit, trả output sai schema; index có thể cũ, và prompt injection trong event có thể biến đường đi tiện lợi thành đường đi không an toàn.

Model không được quyết định số dư, hoàn tiền, điều kiện đủ hay bất kỳ thao tác tiền nào. Ranh giới đáng tin cậy là:

```text
bằng chứng đã truy xuất -> tín hiệu AI -> policy xác định -> quyết định nghiệp vụ
```

## Những bài toán khó

**Tương quan và thứ tự.** Ưu tiên `transaction_id` hoặc correlation ID có thẩm quyền từ hệ thống nguồn. Chỉ dùng loại event, thời gian, số tiền và phạm vi tài khoản theo quy tắc tương quan đã định nghĩa; nếu khớp mơ hồ thì đánh dấu chưa xác định. Consumer Kafka phải hỗ trợ replay và chịu được event đến muộn; không suy ra trạng thái cuối chỉ từ thứ tự nhận.

**Idempotency.** Storage idempotent không đồng nghĩa side effect idempotent. Unique constraint trên `(transaction_id, explanation_version)` cùng atomic insert ngăn bản ghi trùng. Với request phân tán, `SETNX` có expiry hoặc bảng idempotency-key có thể dùng để claim công việc. Outbox ghi quyết định đã commit trước khi phát thông báo; inbox khử trùng message ID khi consume. Retry có thể đọc lại kết quả đã lưu, nhưng email hoặc webhook vẫn cần idempotency key riêng.

**Bất định của AI.** Model có thể tạo false positive, false negative, giải thích không được chứng minh hoặc câu chữ không xác định giữa các lần chạy. Hãy lưu `model_version`, `prompt_version` và `policy_version`. Validate output có cấu trúc, bắt buộc dẫn các `event_id`, giới hạn prompt vào bằng chứng được cung cấp, và chỉ dùng confidence hoặc coverage như đầu vào cho policy. Nếu thiếu bằng chứng hoặc tín hiệu dưới ngưỡng, trả template dựa trên dữ kiện hoặc chuyển cho bộ phận hỗ trợ.

**Ranh giới vận hành.** Đặt deadline, retry có giới hạn và jitter, circuit breaker, rate limit của provider, cùng queue cho việc tạo bất đồng bộ. Không retry mù các side effect không idempotent. Fallback phải nói rõ giải thích đang chờ hoặc chưa khả dụng, tuyệt đối không tự bịa.

## Đánh đổi

Tạo đồng bộ cho trải nghiệm đơn giản nhưng buộc latency request phụ thuộc model. Tạo bất đồng bộ tăng khả năng chịu lỗi và kiểm soát chi phí, nhưng cần trạng thái pending cùng notification hoặc polling. OpenSearch cho retrieval linh hoạt và độ trễ thấp, nhưng eventual consistency và phải được dựng lại từ Kafka hoặc database. Query trực tiếp database có tính authoritative nhưng có thể chậm hơn và không phù hợp bằng cho full-text retrieval.

RAG giảm kích thước context và neo câu trả lời vào bằng chứng, nhưng không sửa được dữ liệu nguồn thiếu hoặc tương quan sai. Model nhỏ, rẻ có thể đủ cho giải thích theo template; model mạnh hơn có thể viết tốt hơn nhưng tăng chi phí và latency. Policy nên ưu tiên tính đúng hơn độ trôi chảy.

## Thiết kế tốt hơn

Tiếp nhận event ledger và transfer, validate schema, rồi lưu bản ghi đã chuẩn hóa vào database. Dựng read model OpenSearch chỉ với các trường được phép tìm kiếm và an toàn cho khách hàng. Khi có request, xác thực quyền khách hàng, resolve giao dịch từ database, truy xuất tập bằng chứng có giới hạn, rồi redact trước khi gọi model.

```text
Kafka (nguồn replay) -> DB chuẩn hóa (system of record) -> OpenSearch (read model)
                                                        \-> bằng chứng giới hạn
bằng chứng giới hạn -> tín hiệu LLM -> policy -> quyết định -> DB + outbox
```

LLM nhận yêu cầu như “tóm tắt các bản ghi bằng chứng này” và trả dữ liệu có cấu trúc: giải thích ngắn, các `event_id` được dẫn, mức không chắc chắn và trạng thái gợi ý. Policy kiểm tra authorization, độ bao phủ bằng chứng, tính nhất quán trạng thái, schema và câu chữ được phép. Chỉ sau đó business layer mới chọn `EXPLAIN`, `PENDING`, `UNRESOLVED` hoặc `ESCALATE`. Output của model không được phép làm thay đổi tiền.

Lưu audit record tối thiểu gồm `transaction_id`, `event_id` (hoặc tập ID được dẫn), `model_version`, `prompt_version`, `policy_version`, `decision` và `reason`. Khi cần, lưu thêm request key, idempotency key, timestamp và revision của nguồn. Không đưa payload nhạy cảm thô vào prompt hay log.

## Các kịch bản lỗi

- **Giao trùng hoặc request đồng thời:** unique insert, inbox và idempotency key trả về một kết quả; việc gửi thông báo dùng outbox key riêng.
- **Model timeout, outage hoặc rate limit:** retry có giới hạn khi an toàn, sau đó trả `PENDING` hoặc giải thích xác định từ các trường đã kiểm chứng.
- **Event đến muộn hoặc mâu thuẫn:** đánh dấu read model cũ, reprocess từ Kafka và hiển thị chưa xác định thay vì chọn bản ghi thuận tiện.
- **OpenSearch outage hoặc index cũ:** query database cho giao dịch và bằng chứng, hoặc fail closed bằng phản hồi pending.
- **Prompt injection hoặc text độc hại trong event:** coi nội dung event là dữ liệu, dùng prompt contract chặt, redact trường, và từ chối output yêu cầu tool hoặc hành động không được hỗ trợ.
- **Commit một phần sau khi trả lời:** outbox và consumer idempotent giúp phát lại an toàn; reconciliation phát hiện phía còn thiếu.

## Năng lực tải

Ước lượng từng tầng riêng. Quan hệ cơ bản là:

```text
Concurrency = Throughput x Latency
```

Ví dụ, 20 request/giây với latency model 2 giây cần khoảng 40 lệnh gọi model đang chạy, chưa tính headroom. Nếu mỗi request lấy 30 event, mỗi event 2 KB, retrieval truyền khoảng `20 x 30 x 2 KB = 1.2 MB/s`, chưa tính index và replica. Hãy sizing Kafka partition theo peak event rate và thời gian replay, database theo số lần ghi event chuẩn hóa, OpenSearch shard theo read model, và model queue theo quota provider. Áp dụng rate limit theo khách hàng và toàn cục, giới hạn kích thước bằng chứng, backpressure và autoscaling. Đây là ước lượng thiết kế, không phải claim production.

## Bảo mật/riêng tư

Xác thực khách hàng và quyền sở hữu giao dịch trước khi retrieval. Enforce ranh giới tenant/account trong mọi query; `customerId` là Kafka key không phải authorization. Tối thiểu hóa dữ liệu gửi cho model: chỉ dùng mã giao dịch và event, thời gian ở mức cần thiết, currency, amount, status và mô tả đã được duyệt. Không tùy tiện gửi toàn bộ giao dịch, số tài khoản, địa chỉ, token hoặc dữ liệu counterparty thô tới AI bên ngoài.

Mã hóa khi truyền và khi lưu, giới hạn quyền operator, định nghĩa retention và xóa dữ liệu, đồng thời redact PII khỏi prompt, trace và application log. Chỉ dùng provider model/prompt như data processor khi có hợp đồng được phê duyệt về riêng tư và retention. Ghi access và audit decision nhưng không đưa `account_id` hay PII thô vào metric label.

## Khả năng quan sát

System metrics nên gồm request rate, latency theo từng tầng, số timeout và retry, queue depth, Kafka consumer lag, lỗi database, độ mới OpenSearch, phản hồi rate-limit của provider, token usage và chi phí. Business metrics nên gồm tỷ lệ request được giải thích, pending, unresolved, escalated và bị từ chối vì thiếu bằng chứng, cùng tỷ lệ bất đồng hoặc correction.

Không dùng `transaction_id`, `customerId` hoặc `account_id` làm Prometheus label: cardinality không bị giới hạn và có thể chứa dữ liệu nhạy cảm. Đưa correlation ID vào trace được sampling và log được bảo vệ. Mọi quyết định phải truy ngược được về bằng chứng và version: `transaction_id`, `event_id`, `model_version`, `prompt_version`, `policy_version`, `decision` và `reason`.

## Bài học

- Bắt đầu từ bài toán đúng của khách hàng; chỉ chọn component sau khi xác định bằng chứng và ranh giới lỗi.
- Coi Kafka là input có thể replay, database là system of record và OpenSearch là read model có thể dựng lại.
- Giữ output AI ở vai trò tín hiệu; policy xác định mới tạo quyết định nghiệp vụ.
- `exists()` không phải idempotency; dùng uniqueness nguyên tử và làm từng side effect retry-safe độc lập.
- Giới hạn latency, chi phí, context, retry và mức lộ dữ liệu; đồng thời đo cả kết quả nghiệp vụ lẫn sức khỏe hệ thống.
