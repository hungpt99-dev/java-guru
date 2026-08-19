---
title: "Thiết kế phát hiện bất thường trong ledger với Kafka và Prometheus"
description: "Thiết kế có guardrail để chấm điểm sự kiện ledger bất đồng bộ mà không đưa AI vào luồng xử lý tiền."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> **Repository:** https://github.com/finpay-lab/ledger-service


Phát hiện bất thường chỉ có ích khi nó không làm giảm độ tin cậy của việc ghi ledger. Khó khăn không nằm ở việc gọi một model, mà ở việc giữ latency của model, lỗi từ provider, message trùng lặp, secret và yêu cầu audit ra khỏi transaction đang di chuyển tiền.

Bài viết này mô tả thiết kế `ledger-service` được cung cấp và một ranh giới tích hợp an toàn hơn: ghi ledger trước, publish event, chấm điểm bất đồng bộ, rồi xuất trạng thái của luồng chấm điểm qua Prometheus. AI tạo ra một tín hiệu. Chính sách xác định và, khi cần, quy trình phê duyệt của con người mới đưa ra quyết định tài chính.

## Phân biệt dữ kiện và thiết kế

**[SOURCE FACT]** Mô tả service được cung cấp xác định `ledger-service` là một Spring Boot service. Service ghi mỗi payment thành một cặp `debit`/`credit` theo mô hình double-entry trong một database transaction, publish ledger event lên Kafka với topic `ledger.events`, và cung cấp dữ liệu để tìm kiếm trong OpenSearch. Mục tiêu nghiệp vụ được nêu là gắn cờ các mẫu ledger đáng ngờ trước khi đối soát và trước batch job lúc 2 giờ sáng.

**[SOURCE FACT]** Tài liệu được cung cấp gắn repository với FinPay. Link repository được giữ ở đầu bài; bài viết không thêm tuyên bố cụ thể nào khác về công ty hoặc nền tảng.

**[ANALYSIS]** Model phải quan sát luồng tiền, không phải là dependency của luồng tiền. Các phần còn lại là ranh giới được đề xuất để đáp ứng yêu cầu đó. Những đoạn được đánh dấu là thiết kế đề xuất chỉ mang tính minh họa và cần được điều chỉnh theo service thực tế.

## 1. Giữ luồng tiền nhỏ

Bất biến cốt lõi là một database transaction chứa hai ledger entry:

```java
// application/PostingService.java
@Transactional
public void post(LedgerCommand cmd) {
    ledger.entry(new Entry(cmd.eventId(), DEBIT, cmd.partyId(), cmd.amount()));
    ledger.entry(new Entry(cmd.eventId(), CREDIT, cmd.counterparty(), cmd.amount()));
}
```

**[ANALYSIS]** Mọi công việc thêm vào method này đều tranh chấp cùng database transaction, connection và row lock. Một remote model call đặc biệt không phù hợp ở đây vì timeout và retry của nó nằm ngoài quyền kiểm soát của ledger.

## 2. Những điều không nên làm

Ví dụ dưới đây cố ý không an toàn. Nó cho thấy các failure mode mà thiết kế phải loại trừ.

```java
// WRONG: gọi AI trên luồng tiền, hardcode secret, không có guardrail.
public class PaymentProcessor {
    private static final String OPENAI_API_KEY = "sk-proj-...";

    @Transactional
    public void postLedger(PaymentEvent event) {
        ledger.post(debit(event), credit(event));
        String answer = openAiClient.ask(prompt(event), OPENAI_API_KEY);
        if ("YES".equals(answer)) {
            fundsService.hold(event.eventId());
        }
        auditRepo.save(new AuditRow(event.eventId(), answer));
    }
}
```

**[ANALYSIS]** Đoạn code có nhiều vấn đề độc lập:

- Database transaction vẫn mở trong khi service chờ third-party API. Theo giả định minh họa, một model có p95 là 2 giây sẽ giữ lock trong thời gian chờ đó, chiếm một connection và làm tăng latency của các lần ghi ledger không liên quan.
- Không có timeout, retry policy, circuit breaker hay fallback. Vì vậy, provider outage có thể biến thành ledger outage.
- Credential bị hardcode và có thể bị commit, secret scanner phát hiện, rotate hoặc làm lộ. Cách này cũng khiến deploy phụ thuộc vào một credential tĩnh thay vì inject secret lúc runtime.
- `fundsService.hold(...)` biến response chưa được kiểm chứng của model thành hành động về tiền. Không có ranh giới cho deterministic policy hay human approval.
- Kafka có delivery semantics at-least-once. Khi message được gửi lại, service có thể ghi entry lần nữa và gọi `hold` lần nữa nếu consumer và các side effect không idempotent.
- Ghi audit dùng chung transaction tiền. Nếu remote call bị treo hoặc transaction rollback, bản ghi quyết định có thể biến mất đúng lúc cần nó nhất.

## 3. Guardrail

**[PROPOSED DESIGN]** Hãy coi các điểm sau là yêu cầu ở cấp sản phẩm và reliability, không phải chi tiết triển khai:

1. AI chỉ phát ra tín hiệu; không bao giờ trực tiếp quyết định kết quả về tiền.
2. Dùng `eventId` làm idempotency key. Consumer, store và external side effect phải chịu được replay.
3. Áp dụng `timeout -> retry -> circuit breaker` theo đúng thứ tự. Khi lỗi, dùng fallback xác định, ghi nhận lỗi và không block việc ghi ledger.
4. Dùng BYOK (Bring Your Own Key) thông qua runtime secret injection. Không hardcode hoặc ghi log key; redaction các secret vô tình xuất hiện.
5. Ghi audit thành record có version, append-only, gồm bằng chứng đầu vào, định danh model, verdict và timestamp.
6. Instrument đầy đủ luồng AI. Latency, lỗi, việc dùng fallback và tỷ lệ bất thường cần được đưa lên Prometheus để có thể giám sát chính bộ giám sát.

## 4. Port và adapter

**[PROPOSED DESIGN]** Giữ domain độc lập với Kafka, HTTP, JSON, OpenSearch và model SDK. Domain sở hữu model và port (interface). Infrastructure sở hữu adapter (implementation).

```text
com.finpay.ledger
├── domain/
│   ├── model/              # LedgerEvent, AnomalyScore, AnomalyRecord
│   └── port/               # AnomalyScorer, AnomalyStore, AuditTrail
├── application/            # PostingService, DetectAnomalyService
└── infrastructure/
    ├── kafka/              # LedgerEventListener
    ├── ai/                 # OpenAiAnomalyScorer, RuleBasedScorer
    ├── opensearch/         # OpenSearchAnomalyStore
    ├── audit/              # AuditTrailImpl
    └── metrics/            # Prometheus/Micrometer adapter
```

Các port có thể giữ ở mức nhỏ:

```java
public interface AnomalyScorer {
    AnomalyScore score(LedgerEvent event);
}

public interface AnomalyStore {
    boolean exists(String eventId);
    void save(AnomalyRecord record);
}

public interface AuditTrail {
    void append(AnomalyRecord record);
}
```

`OpenAiAnomalyScorer` và `RuleBasedScorer` là các adapter phía sau `AnomalyScorer`. Application layer chọn scorer được cấu hình và fallback; domain không import AI client.

## 5. Luồng bất đồng bộ được đề xuất

**[PROPOSED DESIGN]** Tách việc publish event và chấm điểm khỏi posting transaction:

```text
PostingService
    -> database transaction: debit + credit
    -> publish LedgerEvent(eventId)

LedgerEventListener
    -> kiểm tra idempotency theo eventId
    -> chấm điểm với timeout, retry và circuit breaker
    -> dùng deterministic rules khi có lỗi
    -> lưu AnomalyRecord
    -> append audit record
    -> cập nhật Prometheus metrics
```

Listener không được gọi `fundsService.hold(...)` chỉ vì scorer trả về verdict bất thường. Một deterministic policy riêng phải đánh giá tín hiệu cùng bằng chứng hiện có. Nếu nghiệp vụ cần hold, hành động đó nên có idempotency key và audit entry riêng. Model vẫn chỉ mang tính tham khảo.

Cơ chế delivery chính xác giữa database và Kafka là một lựa chọn triển khai. Nếu service cần phối hợp chặt hơn giữa ledger commit và event publication, outbox là một đề xuất khả thi; bài viết không khẳng định đó là fact của repository hiện tại.

## 6. Idempotency và audit

**[PROPOSED DESIGN]** Dùng event identifier làm ranh giới xử lý replay. Consumer nên kiểm tra event đã được xử lý hay chưa trước khi tạo anomaly record. Check và durable write cần một uniqueness guarantee, không chỉ một check trong memory, vì nhiều delivery có thể được xử lý đồng thời.

Scorer có thể bị gọi lại sau timeout hoặc redelivery, nên không được coi là thao tác chỉ chạy một lần. Lưu kết quả với event identifier, metadata về model/version, reference tới evidence, verdict và timestamp. Giữ record ở dạng append-only; correction nên là record mới liên kết với event gốc thay vì update phá hủy dữ liệu cũ.

Audit là concern riêng với money transaction. Nếu không chấm điểm được, hệ thống phải tạo fallback hoặc trạng thái failure có thể audit. Việc đó không được ngăn money transaction hoàn tất.

## 7. Secret và resilience

**[PROPOSED DESIGN]** Inject credential của model lúc runtime từ secret store hoặc cơ chế tương đương của deployment. Chỉ truyền credential cho adapter cần nó. Không đưa credential, full prompt hay các trường ledger nhạy cảm vào application log. Redaction trong logging path là lớp bảo vệ bổ sung, không thay thế access control.

Thứ tự resilience có ý nghĩa:

- `timeout` giới hạn thời gian một provider call chiếm worker.
- `retry` xử lý lỗi tạm thời với policy có giới hạn, phù hợp với provider và workload.
- `circuit breaker` ngừng gửi request khi dependency liên tục không khỏe.
- `fallback` áp dụng deterministic rules hoặc ghi nhận unknown result để pipeline giám sát tiếp tục chạy.

Các cơ chế này bảo vệ anomaly detector. Chúng không biến provider failure thành một quyết định tài chính.

## 8. Prometheus metrics

**[PROPOSED DESIGN]** Expose metric cho chính detector, không chỉ cho các anomaly mà nó báo cáo. Dimension hữu ích gồm kết quả scorer, việc dùng fallback và trạng thái dependency. Giữ label có cardinality thấp: không dùng `eventId`, định danh party, prompt hay dữ liệu ledger có cardinality cao làm metric label.

Operator tối thiểu cần phân biệt được:

- scoring latency và timeout rate;
- provider failure và circuit-breaker state;
- fallback count;
- số event đã xử lý, trùng lặp và thất bại;
- anomaly verdict rate.

Prometheus có thể được dùng để alert khi detector im lặng, failure rate tăng hoặc anomaly volume thay đổi. Grafana là một bề mặt visualization và alerting phù hợp nếu đã có trong deployment; detector vẫn phải hoạt động khi hệ thống monitoring không khả dụng.

## Kết luận

Tích hợp an toàn không cần phức tạp: commit ledger entry mà không gọi remote model, publish event, chấm điểm bất đồng bộ, xử lý replay, ghi lại mọi kết quả và đo sức khỏe của detector. Model có thể giúp ưu tiên điều tra, nhưng deterministic policy và human review vẫn chịu trách nhiệm cho quyết định về tiền.
