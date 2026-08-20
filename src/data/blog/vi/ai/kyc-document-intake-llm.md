---
title: "Từ tài liệu mơ hồ đến quyết định KYC có thể audit"
description: "Thiết kế thực tế để trích xuất trường KYC từ giấy tờ định danh, kiểm tra bằng các rule xác định và chuyển các trường hợp không chắc chắn sang người duyệt."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

## Bài toán nghiệp vụ không phải OCR

Hãy xét một khách hàng mở tài khoản FinPay. Họ tải lên giấy tờ định danh và chờ một kết quả: được chấp nhận, bị từ chối, hoặc chờ review. Yêu cầu ban đầu có vẻ nhỏ: đọc tên, số giấy tờ và ngày sinh.

Nhưng bài toán nghiệp vụ thực sự là ra quyết định từ bằng chứng không hoàn hảo, rồi giải thích được quyết định đó về sau. Ảnh có thể mờ, bị cắt, bị xoay hoặc có bố cục chưa từng gặp. Model có thể trả về một ngày tháng trông hợp lý nhưng sai. Cùng một upload có thể được giao hai lần. Provider có thể timeout sau khi request của khách hàng đã được tiếp nhận.

Payment core đã có một ranh giới quan trọng: database và ledger là nguồn sự thật cho financial state. Document workflow phải tuân theo ranh giới đó. AI có thể tạo field được trích xuất, confidence, classification hoặc risk signal. AI không được authorize payment, cập nhật balance, thay đổi ledger hoặc tự ý quyết định trạng thái KYC.

Insight trung tâm là:

> Không nên che giấu sự không chắc chắn như một exception. Hãy lưu nó như một workflow state để giải thích và xử lý.

Từ đó, hướng thiết kế là:

```text
document -> AI signal -> deterministic policy -> KYC state -> financial boundary
            fields +       rules +             accept/reject/
            confidence     thresholds          manual review
```

Confidence score mô tả sự không chắc chắn của model khi trích xuất. Nó không phải quyền thực hiện hành động nghiệp vụ.

## Thiết kế hiển nhiên và failure nó tạo ra

Đề xuất đầu tiên thường là xử lý đồng bộ:

```java
DocumentResult result = vlm.extract(file);
if (result.confidence() > 0.8) {
    accept(result);
} else {
    reject(result);
}
```

Thiết kế này hấp dẫn vì response upload có ngay câu trả lời. Nhưng nó ẩn ba giả định nguy hiểm:

- Provider latency đủ ổn định để nằm trong customer request.
- Một aggregate score đủ làm policy KYC.
- Model response an toàn để chuyển thành quyết định không thể đảo ngược.

Không giả định nào an toàn. Model có thể chắc chắn về tên nhưng không chắc chắn về ngày hết hạn. Một score duy nhất làm mất khác biệt đó. Quan trọng hơn, external AI call là dependency không đáng tin, không phải participant trong transaction của ledger FinPay.

Chỉ để tính capacity, giả sử minh họa arrival rate là 20 tài liệu mỗi giây, một lần gọi VLM mất 3 giây và toàn workflow mất 12 giây. Stage VLM sẽ giữ khoảng `20 x 3 = 60` call đồng thời; toàn workflow có khoảng `20 x 12 = 240` case đang xử lý. Đây là giả định minh họa, không phải số đo production của FinPay.

Giả sử latency provider tăng từ 300 ms lên 4 giây lúc 14:03. HTTP thread hoặc virtual thread bị giữ lâu hơn. Client timeout rồi retry. Call ban đầu có thể vẫn chạy khi retry đến, khiến quota provider, connection pool và worker capacity cùng chịu tải tăng thêm. Gateway cũng không có record bền vững để phân biệt “chưa nhận” với “đã nhận nhưng đang xử lý”.

Tăng HTTP timeout chỉ giữ failure trong request path lâu hơn. Từ chối mọi timeout bảo vệ khỏi việc chấp nhận bằng chứng sai, nhưng biến lỗi hạ tầng thành một lần từ chối khách hàng không có giải thích. Gọi model thứ hai làm availability tốt hơn bằng cách tăng traffic và chi phí, đồng thời có thể lặp lại cùng một lỗi diễn giải.

Vì vậy quyết định đầu tiên không phải “dùng model nào?” mà là “phần nào được phép chạy đồng bộ?”

## Ràng buộc trước khi có component

Trong thiết kế minh họa này, các ràng buộc là:

- Upload acknowledgement phải có giới hạn và không chờ toàn bộ VLM workflow.
- Delivery có thể là at-least-once, nên duplicate intake event phải an toàn.
- Extraction phải trả về field có type và confidence theo field, không phải một score mơ hồ.
- Schema error và giá trị không thể tồn tại phải làm extraction fail, không được sinh dữ liệu đoán.
- Deterministic rule sở hữu việc accept và reject. AI không hoạt động phải có degraded path rõ ràng.
- `MANUAL_REVIEW` là business state hợp lệ, không phải error được che bằng reject.
- Raw document là PII. Storage, provider access, reprocessing, retention và deletion cần control.
- Intake status, decision và audit fact phải khôi phục được từ storage authoritative.

Các ràng buộc này nối với mental model chung của FinPay. Payment core và ledger vẫn là nguồn sự thật cho money movement. AI layer dùng chung có thể cung cấp port, timeout, retry budget, concurrency limit và audit field chung. Workflow này áp dụng các contract đó, không tạo financial authority thứ hai.

## Để model tạo bằng chứng, không tạo verdict

VLM nhận một câu hỏi hẹp: có thể đọc field nào, với confidence bao nhiêu? Response có type có thể gồm name đã chuẩn hóa, document number, date of birth, expiry date, document type, confidence theo field, metadata provider/model và status `SUCCEEDED`, `PARTIAL` hoặc `UNREADABLE`.

Phải validate schema trước khi đánh giá policy. JSON sai cấu trúc, ngày không tồn tại hoặc field sai type là extraction failure, không phải lý do điền một giá trị có vẻ đúng. Text in trên ảnh là dữ liệu không đáng tin, không phải instruction cho application; prompt không phải security boundary.

Policy engine đánh giá những fact mà nó sở hữu: field bắt buộc, document type, expiry, checksum, format theo quốc gia và tính nhất quán với dữ liệu khách hàng gửi. Một lần gọi model phụ trong phạm vi giới hạn có thể bổ sung signal cho câu hỏi mà deterministic check không xử lý được, nhưng signal vẫn chỉ có tính tư vấn.

```text
typed AI fields + deterministic checks + optional signal
                         |
                   policy_version
                         v
              ACCEPT / REJECT / MANUAL_REVIEW
```

Document hết hạn có thể bị reject. Thiếu expiry date có thể chuyển review. Provider timeout có thể chuyển review nếu policy và nhân sự cho phép. Mapping cụ thể là quyết định của product và compliance. Invariant quan trọng hơn: không AI response nào được trực tiếp mutate KYC state bên ngoài deterministic state machine, và không KYC result nào được trực tiếp mutate financial state.

## Chọn async, rồi chấp nhận chi phí của nó

Upload API có thể lưu object reference cùng intake row ở trạng thái `RECEIVED`, commit work event và trả về status resource. Worker sau đó tải document, gọi extraction port, validate signal, đánh giá policy và ghi outcome.

Sync đơn giản hơn và có thể hợp lý cho một internal check nhanh với dependency tin cậy. Ở đây, provider latency biến động và human review không có upper bound hữu ích cho HTTP request, nên sync không phù hợp. Async đưa latency đối diện khách hàng thành workflow latency, nhưng duplicate delivery và crash recovery trở thành bài toán correctness mới.

Kiểm tra này không an toàn:

```java
if (!repository.exists(event.eventId())) { // WRONG: cả hai worker đều có thể thấy false
    repository.save(event);
}
```

Hai worker có thể cùng thấy chưa có row trước khi một worker insert. Hãy để atomic uniqueness constraint quyết định:

```sql
CREATE UNIQUE INDEX one_intake_per_key ON intake(event_id, idempotency_key);

INSERT INTO intake(event_id, idempotency_key, status)
VALUES (:event_id, :key, 'RECEIVED')
ON CONFLICT (event_id, idempotency_key) DO NOTHING;
```

`event_id` định danh một lần delivery. `idempotency_key` định danh ý định intake. Case identifier nối các attempt với cùng business case. Unique insert bảo vệ database write; nó không hoàn tác provider call đã xảy ra trước crash. External side effect cần stable key do provider hỗ trợ nếu có, hoặc durable attempt record cùng reconciliation policy.

Cùng crash window giải thích vì sao cần outbox. Nếu worker commit decision rồi chết trước khi publish `KycDecisionRecorded`, database có sự thật nhưng downstream consumer không biết. Outbox row được commit trong cùng transaction có thể publish sau. Vì publisher có thể publish lặp, consumer vẫn cần inbox hoặc unique event constraint. Giải quyết duplicate intake lại tạo ra duplicate boundary thứ hai cần thiết kế.

## Failure mới: AI outage biến thành queue pressure

Async loại provider latency khỏi upload request, nhưng không loại provider failure. Nếu worker retry không giới hạn, sự cố provider làm đầy queue, tiêu thụ database connection và trì hoãn cả work khỏe mạnh. Hệ thống đã đổi request timeout lấy backlog tăng.

Mỗi external call cần deadline nằm trong workflow deadline, retry có giới hạn với exponential backoff và jitter, concurrency limit, rate limiter và retry budget. Circuit breaker ngăn provider đang lỗi tiêu thụ mọi slot. Khi hết budget, dead-letter path giữ lại event và reason để recovery có kiểm soát.

Degraded state phải rõ ràng. Document thông thường có thể vào `MANUAL_REVIEW` với reason `AI_UNAVAILABLE`. Case rủi ro cao có thể được hold đến khi một check khác thành công. “Accept on error” và “reject on error” đều là policy choice, không phải default luôn đúng. Không được gắn lỗi hạ tầng vào bằng chứng của khách hàng một cách âm thầm.

Mỗi attempt phụ thuộc AI ghi `model_version`, `prompt_version`, input hash, extraction status và timestamp. Decision ghi `policy_version`, các check, outcome và reason. Re-evaluation tạo attempt mới và giữ audit fact cũ. Model update làm evidence thay đổi; replay là business event mới, không phải sửa lịch sử.

Giữ raw document đã mã hóa giúp điều tra và reprocessing nhưng tăng PII exposure và storage cost. Chỉ giữ field chuẩn hóa giảm exposure nhưng mất bằng chứng. Thiết kế hướng production sẽ chọn retention period, dùng access có scope và thời hạn ngắn, log reviewer access, giới hạn reprocessing và xóa theo lịch. Chỉ gửi vùng ảnh và câu hỏi cần thiết cho provider bên ngoài.

## Kiến trúc xuất hiện từ các failure

```text
Upload API -> object storage + DB intake -> work event -> intake worker
                  DB = business truth       replayable       |
                                                           v
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

Mỗi box tồn tại vì một lý do. Object storage tránh đưa PII payload lớn vào work event. Database sở hữu intake status, attempt, decision và audit fact. Work event cung cấp scheduling bền vững và replay. Extraction port cô lập provider-specific behavior và resilience control. Policy engine là authority của KYC state. Review queue biến uncertainty thành việc có thể xử lý. OpenSearch là operational read model có thể rebuild, không bao giờ là nơi lưu decision authoritative.

Tạo review task cũng phải tuân theo state machine. Replay decision không được tạo năm task. Claim dùng atomic transition `OPEN -> CLAIMED`, owner và expiry hoặc recovery path. Callback resolve lần thứ hai thấy terminal state và trở thành no-op.

## Theo một failure xuyên suốt hệ thống

Lúc 14:03:10, worker commit extraction attempt và decision rồi chết trước khi publish outbox. Intake row và audit đã tồn tại, nên recovery phải publish outbox, không gọi lại VLM. Nếu publish hai lần, projection inbox chỉ nhận một bản. Nếu OpenSearch không hoạt động, projection lag tăng nhưng database vẫn authoritative.

Trong incident khác, provider timeout. Worker ghi failed attempt, retry trong budget và giải phóng capacity giữa các lần retry. Khi hết budget, policy chọn `MANUAL_REVIEW` hoặc controlled failure state. Review queue hiển thị `AI_UNAVAILABLE`, không hiển thị confidence được bịa. Operator có thể replay event gốc cùng attempt metadata.

## Capacity, backpressure và tín hiệu on-call

Với arrival rate `lambda` và stage latency `W`, Little’s Law cho một xấp xỉ hữu ích:

```text
in_flight_concurrency = throughput x latency = lambda x W
```

Với ví dụ minh họa 20 tài liệu mỗi giây và workflow 12 giây, khoảng 240 case đang xử lý trước headroom. Stage VLM 3 giây cần khoảng 60 call slot đồng thời ở arrival rate đó. Giới hạn thật có thể thấp hơn do provider quota, database connection, memory hoặc cost budget.

Đo queue depth và oldest-event age, không chỉ CPU. Theo dõi provider latency và rate-limit response, retry volume, worker concurrency, database connection utilization, outbox lag, projection lag, review backlog age và dead-letter rate. Khi provider chậm, admission control phải ngăn worker claim work vô hạn. Trả `PROCESSING` hoặc trì hoãn work an toàn hơn làm recovery path quá tải rồi tạo thêm duplicate PII copy.

Tracing nên nối request ID, case ID, provider attempt, database transaction, outbox record và projection. Đưa model và policy version vào structured field. Không dùng document number, account ID, event ID hoặc trace ID làm Prometheus label. Audit record nên có decision, reason, version, hash, timestamp và correlation identifier, nhưng mặc định không chứa raw document.

Security đi theo data flow: authenticate uploader, authorize theo tenant và case, dùng object access có scope và thời hạn ngắn, mã hóa dữ liệu, log access, enforce retention và cấp least privilege. Coi text trong ảnh và model output là dữ liệu không đáng tin. Validate structured output, giới hạn field mà policy được đọc và không thực thi instruction trong document hoặc model response.

## Bài học

Lựa chọn khó không phải là VLM. Đó là từ chối biến “model trích xuất field với confidence 0.86” thành “FinPay nên accept khách hàng này.” Khi uncertainty trở thành workflow state được lưu, kiến trúc xuất hiện từ các failure cụ thể: async giới hạn provider latency, atomic idempotency xử lý duplicate delivery, outbox bảo vệ decision đã commit, và manual review cho uncertainty một nơi đến có kiểm soát.

Đây là một use case có boundary rõ ràng trong AI layer dùng chung của FinPay. Payment core và ledger vẫn là nguồn sự thật cho money movement. Document workflow đóng góp signal có version và KYC decision có audit thông qua deterministic policy. AI có thể chậm, không khả dụng, không ổn định hoặc sai; hệ thống xung quanh phải làm từng trạng thái đó nhìn thấy được mà không cho nó vượt qua financial side-effect boundary.

<!-- finpay-repo-link -->

## Triển khai tham khảo FinPay

Bài viết này thuộc series tham khảo FinPay. Mã nguồn dịch vụ liên quan nằm trong repo [finpay-lab/identity-service](https://github.com/finpay-lab/identity-service).
