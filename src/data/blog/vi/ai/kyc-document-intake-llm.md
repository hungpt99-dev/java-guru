---
title: "Từ tài liệu mơ hồ đến quyết định KYC có thể audit"
description: "Thiết kế thực tế để trích xuất trường KYC từ giấy tờ định danh, kiểm tra bằng các rule xác định và chuyển các trường hợp không chắc chắn sang người duyệt."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## Câu hỏi khó đầu tiên

Hãy giả sử một khách hàng tải lên giấy tờ định danh trong lúc mở tài khoản FinPay. Sản phẩm muốn có câu trả lời nhanh: chấp nhận, từ chối, hoặc yêu cầu nhân viên kiểm tra. “Đọc tên và ngày sinh” nghe giống một tính năng xử lý ảnh. Thực tế, đây là một quy trình ra quyết định dựa trên bằng chứng.

Ảnh có thể bị xoay, cắt, mờ, hoặc có bố cục khác với loại giấy tờ trước đó. Model có thể đọc sai một ngày tháng nhưng vẫn tạo ra giá trị có vẻ hợp lý. Cùng một event upload có thể được giao hai lần. Provider có thể phản hồi sau vài giây hoặc không hoạt động. Tuy vậy, quyết định KYC cuối cùng phải giải thích được về sau: đã dùng giấy tờ nào, đã chạy các kiểm tra nào, kết quả đến từ phiên bản model và policy nào, và vì sao cần con người can thiệp.

FinPay là một hệ thống tham chiếu hư cấu, không phải báo cáo về một sự cố đã triển khai. Bài toán thiết kế hữu ích là bắt đầu từ các ràng buộc đó. Payment core hiện đã coi database và ledger là nguồn sự thật cho trạng thái tài chính. Workflow tài liệu phải tuân theo hệ thống ấy: AI có thể tạo signal trích xuất hoặc rủi ro, nhưng không được thay đổi account, authorize payment, hay thay đổi trạng thái ledger hoặc settlement.

Phân biệt cốt lõi rất đơn giản nhưng dễ bị bỏ qua:

```text
document -> extraction signal -> deterministic policy -> KYC decision
              fields + confidence    rules + thresholds    accept/reject/review
```

Confidence score mô tả mức không chắc chắn của model về việc trích xuất. Nó không phải quyết định nghiệp vụ.

## Thiết kế trông có vẻ hợp lý

Đề xuất đầu tiên thường là xử lý đồng bộ. Endpoint upload lưu multipart file, gọi vision-language model (VLM), hỏi model xem giấy tờ có vẻ hợp lệ hay không, rồi ghi kết quả trước khi trả HTTP 200:

```java
DocumentResult result = vlm.extract(file);
if (result.confidence() > 0.8) accept(result);
else reject(result);
```

Đoạn code này chứa hai quyết định ẩn. Nó đưa latency của provider vào latency đối diện khách hàng, đồng thời biến một ngưỡng confidence tùy ý thành policy. Tệ hơn, nó cho phép response của model trở thành hành động nghiệp vụ không thể đảo ngược. Đây không phải ranh giới an toàn cho FinPay.

Chỉ để tính capacity, giả sử một workload ví dụ đạt 20 tài liệu mỗi giây và một lần gọi VLM mất 3 giây. Stage đó tạo khoảng `20 x 3 = 60` lời gọi provider đồng thời. Nếu toàn workflow mất 12 giây, khoảng `20 x 12 = 240` case đang xử lý. Đây là giả định thiết kế, không phải số đo production của FinPay.

Hãy hình dung latency provider tăng từ 300 ms lên 4 giây lúc 14:03. Thread HTTP hoặc virtual thread bị giữ lâu hơn, client bắt đầu timeout rồi retry. Các lời gọi đầu tiên có thể vẫn đang chạy khi retry đến. Connection pool và quota provider phải chịu tải nhân lên. Retry storm khiến việc phục hồi khó hơn, trong khi gateway vẫn không có biểu diễn bền vững cho công việc đã nhận nhưng chưa hoàn tất.

Tăng timeout của endpoint không giải quyết được vấn đề. Nó làm timeout budget và sự khó chịu của khách hàng tăng lên. Từ chối mọi request an toàn hơn đoán bừa, nhưng lại từ chối không cần thiết khi nhân viên có thể xử lý case. Gọi ngay model thứ hai chỉ tăng availability bằng cách tăng chi phí, và có thể lặp lại cùng một cách hiểu sai. Quyết định quan trọng là đưa thao tác chậm, không ổn định ra khỏi request upload nhưng vẫn giữ một kết quả nghiệp vụ rõ ràng.

## Ràng buộc trước khi có component

Trong ví dụ này, thiết kế có các ràng buộc sau:

- Response upload phải có giới hạn rõ ràng và không phụ thuộc vào toàn bộ workflow VLM.
- Một document intake phải có thể xử lý lại an toàn vì trên thực tế delivery là at-least-once.
- Quyết định về danh tính cần các audit fact bất biến, không chỉ một row mới nhất.
- Extraction cần field có type và confidence theo từng field, không phải một score tổng mơ hồ.
- Kiểm tra xác định sở hữu việc chấp nhận và từ chối. Khi AI không hoạt động phải có degraded mode được định nghĩa.
- Tài liệu gốc là PII. Access, retention, reprocessing và việc chia sẻ cho provider bên ngoài cần kiểm soát rõ ràng.
- Human review là một kết quả hợp lệ, không phải một lỗi được che bằng trạng thái từ chối.

Đây cũng là các ranh giới từ series FinPay rộng hơn. AI core cung cấp port, cơ chế resilience và audit field dùng chung. Mô hình idempotency phân biệt deduplication ở storage với deduplication của side effect. Bài này áp dụng các contract đó cho document intake, không tạo một kiến trúc AI riêng.

## Từ extraction đến quyết định

VLM nên trả lời một câu hỏi hẹp, có type: “Có thể đọc được field nào từ tài liệu này, và độ chắc chắn của từng field là bao nhiêu?” Response có thể gồm tên đã chuẩn hóa, số giấy tờ, ngày sinh, ngày hết hạn, loại giấy tờ, confidence theo từng field, metadata provider/model, và extraction status như `SUCCEEDED`, `PARTIAL`, hoặc `UNREADABLE`.

Phải validate schema trước khi đánh giá policy. JSON sai cấu trúc, ngày không tồn tại, hoặc field sai type là lỗi extraction, không phải lý do để tự bịa giá trị. Prompt cũng không phải security boundary: text in trên tài liệu hoặc nằm trong ảnh là dữ liệu không đáng tin, không phải instruction cho application.

Rules sau đó đánh giá những fact mà chúng sở hữu: field bắt buộc, loại giấy tờ, ngày hết hạn, checksum, format theo quốc gia, và tính nhất quán với dữ liệu khách hàng đã gửi. Một lần gọi judge-model có phạm vi giới hạn có thể tạo thêm signal cho câu hỏi mà rule xác định không giải quyết được, nhưng nó vẫn chỉ là signal.

Policy kết hợp các đầu vào này:

```text
VLM fields + per-field confidence + deterministic checks + optional judge signal
                                      |
                              policy_version
                                      v
                         ACCEPT / REJECT / MANUAL_REVIEW
```

Ví dụ, thiếu ngày hết hạn có thể cần review; tài liệu đã hết hạn có thể bị từ chối; provider timeout có thể chuyển sang review thay vì từ chối khách hàng khi chưa có bằng chứng. Mapping chính xác là quyết định của sản phẩm và compliance. Invariant quan trọng là không response nào của model được trực tiếp cập nhật financial state hoặc KYC state bên ngoài state machine xác định.

## Vì sao xử lý bất đồng bộ đáng trả giá

Upload endpoint có thể lưu intake với status `RECEIVED` và trả về status resource. Worker về sau tải object, thực hiện extraction, đánh giá policy và ghi quyết định. Xử lý đồng bộ đơn giản hơn khi triển khai và cho kết quả ngay, nên vẫn phù hợp với một kiểm tra nội bộ nhanh, có availability cao. Ở đây, latency biến động của provider, retry behavior và nhánh human review khiến nó không phù hợp với request của khách hàng.

Lựa chọn async tạo ra vấn đề mới: message có thể được giao hai lần và worker có thể chết ở bất kỳ thời điểm nào. At-least-once hữu ích vì mất một KYC intake tệ hơn retry nó, nhưng “handler chạy một lần” không phải bảo đảm correctness.

Kiểm tra này không an toàn:

```java
if (!repository.exists(event.eventId())) { // WRONG: two consumers can both see false
    repository.save(event);
}
```

Hai worker có thể cùng thấy chưa có row trước khi một worker insert. Hãy dùng uniqueness constraint atomic cho business key và để insert quyết định:

```sql
CREATE UNIQUE INDEX one_intake_per_key ON intake(event_id, idempotency_key);

INSERT INTO intake(event_id, idempotency_key, status)
VALUES (:event_id, :key, 'RECEIVED')
ON CONFLICT (event_id, idempotency_key) DO NOTHING;
```

Key cần có ý nghĩa rõ ràng. `event_id` định danh một lần delivery; `idempotency_key` định danh ý định intake; transaction hoặc case identifier liên kết các attempt với cùng một business case. Unique insert làm cho database write idempotent. Nó không làm email, screening request hoặc provider call idempotent nếu side effect đã xảy ra trước crash. Các call đó cần stable key do provider hỗ trợ nếu có, hoặc durable attempt record kèm reconciliation policy.

Lập luận tương tự dẫn đến outbox. Nếu worker commit decision rồi chết trước khi publish `KycDecisionRecorded`, database có sự thật nhưng consumer downstream không biết. Một outbox row được commit trong cùng database transaction có thể được publish sau. Publisher cũng có thể publish lặp, nên consumer vẫn cần inbox hoặc unique event constraint. Giải pháp cho một vấn đề duplicate lại tạo ra một boundary khác cần làm rõ.

## AI failure là một workflow state

Retry hữu ích với timeout tạm thời, nhưng retry không giới hạn sẽ biến sự cố provider thành sự cố của FinPay. Mỗi external call cần deadline nằm trong workflow timeout tổng, retry có giới hạn với exponential backoff và jitter, concurrency limit, rate limiter và retry budget. Circuit breaker ngăn lỗi provider đã biết tiêu thụ toàn bộ slot. Dead-letter path giữ lại event và nguyên nhân lỗi khi hết budget.

Degraded outcome phụ thuộc vào risk của operation. Với tài liệu thông thường khi model không hoạt động, chuyển sang `MANUAL_REVIEW` nếu policy và nhân sự cho phép. Với tài liệu rủi ro cao, policy có thể giữ case đến khi một kiểm tra bổ sung thành công. Không có “accept on error” hay “reject on error” nào luôn đúng. Điều không được xảy ra là biến lỗi hạ tầng thành việc từ chối khách hàng mà không có lý do audit.

Mỗi attempt phụ thuộc AI ghi `model_version`, `prompt_version`, input hash, extraction status và timestamp. Decision ghi `policy_version`, các kiểm tra, outcome và reason. Replay decision cũ dùng các version đã ghi khi cần tái lập. Re-evaluation có chủ đích tạo attempt mới và không ghi đè audit fact cũ. Model update có thể làm output thay đổi, vì vậy “re-run” là business event mới, không phải sửa lịch sử.

Retention raw document cũng là một đánh đổi. Giữ encrypted object giúp điều tra và reprocessing, nhưng tăng PII exposure và chi phí lưu trữ. Chỉ giữ field chuẩn hóa giảm exposure nhưng hạn chế bằng chứng. Thiết kế hướng production nên chọn thời hạn retention, dùng access có scope và thời gian ngắn, log mọi lần reviewer truy cập, giới hạn quyền reprocessing và xóa theo lịch. Chỉ gửi vùng ảnh và câu hỏi cần thiết cho provider bên ngoài; account history không liên quan không thuộc về KYC prompt.

## Kiến trúc sau khi đã suy luận

Đến đây các boundary mới trở nên có ý nghĩa:

```text
Upload API -> object storage + DB intake -> work event -> intake worker
                  DB = business truth       replayable       |
                                                           V
                                                VLM extraction port
                                                           |
                                                typed signal + audit
                                                           |
                                            deterministic policy engine
                                                           |
                                  ACCEPT / REJECT / MANUAL_REVIEW
                                             |             |
                                      DB + outbox      review queue
                                             |
                                  decision event -> projection
                                                   OpenSearch
```

Upload event mang theo object reference, chẳng hạn S3 key, thay vì multipart object. Adapter chuyển nó thành `IntakeCommand` và document snapshot. Database là nguồn authoritative cho intake status, attempt, decision và audit fact. Event stream hữu ích cho work bền vững, replay và notification. OpenSearch là read model vận hành có thể rebuild, không phải nơi lưu decision authoritative. Nếu cluster không hoạt động, decision vẫn lấy được từ database và projection lag có thể quan sát.

Review task cũng phải idempotent. Replay một decision event không được tạo năm task cho một case. Việc claim task cần atomic state transition như `OPEN -> CLAIMED`, owner, và expiry hoặc recovery path nếu reviewer biến mất. Reviewer chỉ resolve task một lần; callback thứ hai thấy terminal state và trở thành no-op. Con người làm thay đổi latency và staffing model, nhưng không loại bỏ nhu cầu state transition xác định.

## Một đường lan truyền lỗi cụ thể

Hãy xét worker commit extraction lúc 14:03:10 rồi chết trước khi publish outbox. Intake row và audit attempt đã commit, nên worker không cần gọi lại VLM chỉ vì publish thất bại. Outbox publisher phát decision sau khi phục hồi. Nếu publisher phát hai lần, inbox constraint của projection chỉ nhận một bản. Nếu OpenSearch down, lag của nó tăng trong khi database vẫn authoritative.

Giờ xét provider timeout. Worker ghi attempt thất bại, chỉ retry trong budget và giải phóng capacity giữa các lần retry. Khi hết budget, policy chọn manual review hoặc controlled failure state. Review queue hiển thị lý do `AI_UNAVAILABLE`; nó không hiển thị confidence giả. Replay có thể kiểm tra event gốc và metadata của attempt. Đây là giá trị vận hành của việc tách signal, decision và side effect.

## Capacity và backpressure

Với arrival rate `lambda` và latency stage `W`, Little’s Law cho một xấp xỉ hữu ích:

```text
in_flight_concurrency = throughput x latency = lambda x W
```

Với ví dụ minh họa 20 tài liệu mỗi giây và workflow 12 giây, khoảng 240 case đang xử lý trước khi cộng headroom. Nếu stage VLM giữ một call slot trong 3 giây, stage đó cần khoảng 60 slot đồng thời ở arrival rate này. Giới hạn thực tế có thể thấp hơn do quota provider, connection database, memory hoặc ngân sách chi phí.

Hãy đo queue depth và tuổi event cũ nhất, không chỉ CPU. Cần theo dõi thêm provider latency và rate-limit response, retry volume, worker concurrency, database connection utilization, outbox lag, review backlog age và dead-letter rate. Khi provider chậm, worker phải ngừng claim vô hạn work mới. Queue có giới hạn và admission control cho phép FinPay trả `PROCESSING` hoặc trì hoãn work thay vì làm database và provider quá tải. Backpressure là một phần của correctness vì recovery path quá tải có thể tạo thêm attempt trùng và thêm bản sao PII.

## Điều on-call cần thấy lúc 3 giờ sáng

Metrics nên hiển thị upload throughput, queue depth, oldest event age, processing latency theo stage, provider timeout và error rate, circuit-breaker state, rate-limit response, database uniqueness conflict, outbox lag, projection lag, review backlog, và duplicate delivery rate. AI quality signal gồm schema-validation failure, extraction status, phân bố confidence theo field, fallback rate, cùng các dimension model/prompt có cardinality giới hạn. Token và cost estimate giúp phát hiện regression do prompt hoặc kích thước ảnh.

Business dashboard nên tách `ACCEPT`, `REJECT` và `MANUAL_REVIEW` theo reason code có giới hạn. Việc `AI_UNAVAILABLE` tăng đột ngột, hoặc thay đổi mạnh sau khi rollout model version, hữu ích hơn một con số confidence trung bình.

Tracing nối request ID, intake/case ID, provider attempt, database transaction, outbox record và projection. Đưa model và policy version vào structured data. Không dùng document number, account ID, transaction ID, event ID hoặc trace ID làm Prometheus label; giữ chúng trong log bảo vệ và trace context có redaction. Audit record cần decision, reason, version, hash, timestamp và correlation identifier, nhưng mặc định không chứa raw document.

Security đi theo luồng dữ liệu. Authenticate uploader và authorize theo tenant/case. Dùng object URL có scope và thời hạn ngắn, mã hóa khi truyền và khi lưu, secret management, access log, retention/deletion control và least privilege cho worker, reviewer. Coi text trong ảnh và model output là dữ liệu không đáng tin. Validate structured output, giới hạn những field policy được đọc, và không thực thi instruction tìm thấy trong document hoặc prompt. Raw document phải nằm ngoài các AI call không liên quan và log ứng dụng thông thường.

## Bài học

Phần khó không phải chọn VLM. Phần khó là không đánh đồng “model trích xuất field với confidence 0.86” với “FinPay nên chấp nhận khách hàng này.” Khi phân biệt đó được làm rõ, các quyết định còn lại xuất hiện từ failure: async giới hạn latency provider, at-least-once đòi hỏi idempotency atomic, outbox bảo vệ decision đã commit, và sự không chắc chắn trở thành review queue thay vì một lần từ chối bị che giấu.

Đây là một use case có boundary rõ ràng trong AI layer dùng chung của FinPay. Payment core và ledger vẫn là nguồn sự thật cho money movement. Document workflow đóng góp các signal có version và một KYC decision có audit thông qua deterministic policy. AI có thể chậm, không khả dụng, không ổn định hoặc sai; hệ thống xung quanh phải làm cho từng trạng thái đó trở nên nhìn thấy được và an toàn.
