---
title: "Thiết kế AI Core dùng chung cho FinPay: Từ failure mode đến guardrail"
description: "Thiết kế thực tế cho tích hợp LLM dùng chung với credential BYOK, cơ chế chống lỗi, idempotency và kết quả có audit."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo được nhắc đến trong tài liệu nguồn: <https://github.com/finpay-lab/platform>

## Bài toán

Thêm một lời gọi LLM vào một service khá đơn giản. Vận hành lời gọi đó nhất quán trên cả fleet microservice thì không. Các service có thể gọi provider trực tiếp, để key trong `application.yml`, parse response khác nhau, retry không có timeout, hoặc chỉ ghi `logger.info("done")`. Kết quả là security, failure behavior, xử lý trùng và bằng chứng điều tra đều không nhất quán.

**[THÔNG TIN NGUỒN]** Tài liệu nguồn mô tả các pattern đó ở ba service. **[PHÂN TÍCH]** Bài viết này xem chúng là vấn đề platform, không phải bằng chứng về một triển khai FinPay production. FinPay là reference design; một thiết kế hướng production cần kiểm chứng mọi giả định theo yêu cầu compliance, dữ liệu và lưu lượng thực tế.

## Vì Sao Khó

Kết quả AI mang tính xác suất, trong khi workflow thanh toán cần kiểm soát xác định. False positive có thể trì hoãn giao dịch hợp lệ; false negative có thể bỏ sót gian lận. Cùng một prompt có thể cho hành vi khác sau khi model đổi, còn provider có thể chậm, bị rate-limit, unavailable hoặc tốn kém. Retry cũng có thể biến một lần giao thành nhiều side effect nếu storage và effect không được thiết kế riêng.

Contract hữu ích là:

```text
AI signal -> policy evaluation -> business decision
```

AI component phát ra observation có giới hạn như score, label, confidence, model version và reason code. Policy xác định hoặc người có thẩm quyền quyết định hold, review hay tiếp tục thanh toán. AI không bao giờ có quyền chuyển tiền.

## Thiết Kế Ngây Thơ

Implement đầu tiên thường đặt provider code trong controller:

```java
// SAI: secret, lời gọi không giới hạn và quyền nghiệp vụ trộn vào một request
String answer = llm.chat(apiKey, request.toJson());
return answer.contains("approve") ? APPROVE : REJECT;
```

Lần thử thứ hai có thể thêm `exists()` trước khi lưu outcome:

```java
// SAI: hai consumer có thể cùng thấy false
if (!outcomeRepository.exists(eventId)) {
    outcomeRepository.save(new Outcome(eventId, signal));
}
```

Cả hai ví dụ đều có vẻ chạy trong happy-path test. Nhưng chúng không định nghĩa hành vi khi có concurrency, provider failure, redelivery hoặc model response không rõ ràng.

## Vì Sao Hỏng

`exists()` rồi `save()` là race condition: hai worker có thể cùng thấy bản ghi chưa tồn tại và cùng insert. Retry không có timeout có thể giữ thread vô hạn, khuếch đại tải provider và redeliver cùng event. Key trong config có thể lộ qua config dump, log hoặc tool hỗ trợ. Parse text tự do khiến schema drift trở thành incident nghiệp vụ. Xem model label như approval biến signal xác suất thành lệnh tài chính một cách âm thầm.

Layout ngây thơ cũng không có source of truth duy nhất. Search index không phải transaction ledger, dead-letter queue không phải audit record, và log line không phải lịch sử quyết định có thể replay.

## Những Bài Toán Khó

### Idempotency là hai bài toán

Storage idempotency nghĩa là cùng một logical event chỉ tạo một outcome được lưu. Nó không làm cho external side effect idempotent. Notification, tạo case hay payment command cần idempotency key riêng hoặc delivery qua outbox.

Các cơ chế thực tế gồm:

- Unique constraint trong database trên `(tenant_id, event_id)` với atomic insert; bên thua đọc outcome đã có.
- `SETNX` kèm expiry cho claim ngắn hạn, sau đó lưu outcome bền vững; Redis không phải system of record.
- Inbox table claim event ID một cách transactional.
- Outbox row được ghi cùng transaction với outcome, sau đó delivery bằng effect idempotency key ổn định.

```java
// ĐÚNG: database phân xử race
try {
    outcomeRepository.insertUnique(tenantId, eventId, signal);
    outboxRepository.insert(tenantId, eventId, "RISK_SIGNAL_RECORDED");
} catch (DuplicateKeyException alreadyProcessed) {
    return outcomeRepository.get(tenantId, eventId);
}
```

Provider call vẫn có thể bị lặp. Thiết kế phải chịu được điều đó bằng cách coi outcome lưu cuối là authoritative, hoặc dùng provider request idempotency key nếu provider hỗ trợ.

### Bất định và tiến hóa của AI

Response phải được validate theo schema có version. JSON lỗi, thiếu field, label mâu thuẫn, confidence thấp và timeout là các outcome rõ ràng, không phải lý do để đoán. Lưu `model_version` và `prompt_version`; prompt đổi nghĩa là input quyết định đổi. Policy cần có `policy_version`, và threshold phải có thể test trên dữ liệu lịch sử.

### Resilience và chi phí

Đặt timeout cho từng attempt, total deadline, retry có giới hạn với exponential backoff và jitter, cùng circuit breaker. Chỉ retry lỗi tạm thời như một số response 429/5xx; không retry lỗi validation. Rate limit cần admission control và backpressure. Fallback có thể dùng rule xác định hoặc chuyển manual review, nhưng phải gắn nhãn fallback và không được tự tạo AI signal.

## Trade-off

Shared library chuẩn hóa contract và instrumentation, nhưng không thể buộc service nào cũng dùng nó hoặc xóa khác biệt semantics giữa các provider. Sidecar hay gateway tập trung policy và rotation nhưng thêm network hop và availability boundary. Scoring đồng bộ đơn giản cho user request nhưng buộc latency thanh toán phụ thuộc AI; scoring bất đồng bộ cô lập tốt hơn nhưng cần trạng thái pending và eventual consistency.

BYOK tăng tenant isolation và cost attribution, đồng thời tăng số lần gọi secret manager và độ phức tạp rotation. Lưu hash và metadata hỗ trợ điều tra với ít exposure hơn, nhưng hạn chế debug prompt về sau. Đây là các ranh giới có chủ đích, không phải khẳng định một lựa chọn luôn tốt nhất.

## Thiết Kế Tốt Hơn

Module dùng chung nên expose một typed port hẹp: `assess(signalRequest) -> aiSignal`. Nó tra key của tenant bằng Vault reference, tạo request trung lập với provider, validate structured response và áp dụng resilience controls. Caller sở hữu business policy; module sở hữu technical safety và evidence.

```text
Kafka (nguồn replay) -> consumer -> AI core -> signal store + outbox
                                      |              |
                                      v              v
                               policy service   notification/effect

DB = system of record
OpenSearch = read model cho điều tra và dashboard
Vault = nguồn secret
```

Transaction ghi outcome nên gồm `transaction_id`, `event_id`, `tenant_id`, signal data, `model_version`, `prompt_version`, `policy_version`, `decision`, `reason`, timestamp và correlation reference. Audit record tuyệt đối không chứa raw API key. Nếu policy decision được ghi riêng, hãy link nó với cùng event và transaction thay vì ghi đè signal gốc.

## Kịch Bản Thất Bại

- **Provider timeout:** dừng ở deadline, ghi `AI_TIMEOUT`, rồi chuyển deterministic fallback hoặc manual review.
- **429 hoặc 5xx:** chỉ retry trong request budget, tôn trọng rate limit và mở circuit khi lỗi kéo dài.
- **Response malformed hoặc nondeterministic:** từ chối response, ghi model và prompt version, không suy ra approval.
- **Consumer crash sau insert:** unique outcome và outbox làm redelivery an toàn; inbox có thể đánh dấu consumption trong cùng transaction.
- **Outbox delivery retry:** dùng effect idempotency key; storage idempotency một mình không ngăn duplicate email, case hay payment call.
- **OpenSearch outage:** tiếp tục business path nếu DB audit bền vững đã thành công; index lại sau. Search index không được làm authoritative.
- **Vault outage hoặc race khi rotate key:** fail closed khi credential unavailable, chỉ cache trong TTL ngắn được định nghĩa rõ, và không fallback sang hard-coded key.

## Capacity

Với synchronous path, quan hệ cơ bản là:

```text
Concurrency = Throughput x Latency
```

Ở 200 request/second và latency end-to-end 750 ms, path cần khoảng 150 request đang in-flight trước khi cộng safety headroom. Hãy sizing độc lập consumer concurrency, connection pool, provider quota và circuit-breaker limit. Retry làm tăng attempted provider throughput; nếu 10% call retry một lần thì provider attempts xấp xỉ `200 x 1.10 = 220/second`, không phải 200.

Kafka là nguồn replay, không phải business ledger. DB là system of record cho outcome và idempotency. OpenSearch là read model denormalized, có thể lag hoặc rebuild. Capacity planning phải tính peak partitions, consumer lag, DB unique-index contention, Vault QPS, OpenSearch indexing rate, token cost và retry storm khi provider phục hồi.

## Security và Privacy

Minimize dữ liệu trước khi gửi tới external AI provider: ưu tiên derived features, redaction, tokenization và allowlist nghiêm ngặt thay vì full transaction payload. Không tùy tiện gửi tên, account number, địa chỉ, free-form note hay regulated identifier. Mã hóa in transit và at rest, isolate tenant, giới hạn quyền Vault, rotate key, và redact secret cùng PII khỏi log, trace, prompt và exception message.

Audit trail cần least privilege và retention rule. Hash prompt không phải anonymization nếu có thể dựng lại input từ một không gian nhỏ. Xác định retention, residency, việc dùng dữ liệu để training và điều khoản xóa của provider trước khi bật BYOK routing. Thiết kế hướng production cũng cần threat modeling, access review và compliance approval.

## Observability

Đo cả system behavior và business quality. System metrics hữu ích gồm request count, latency percentile, timeout/retry count, circuit state, rate-limit response, token usage, cost estimate, Vault failure, DB conflict count, outbox age, consumer lag và OpenSearch indexing lag. Business metrics gồm fallback rate, manual-review rate, policy outcome, mẫu false-positive/false-negative từ case đã review, và drift theo model/policy version.

Không dùng `transaction_id`, `account_id`, prompt text hoặc event ID làm Prometheus label: cardinality và sensitivity của chúng không an toàn. Đưa correlation ID vào structured log hoặc trace context có access control, và chỉ dùng aggregate label như service, provider, model version, policy version và outcome class. Audit query khi đó có thể dựng lại transaction, event, signal, version, decision và reason mà không lộ payload.

## Bài Học

1. Bắt đầu từ failure mode và quyền quyết định, rồi mới chọn architecture.
2. Xem AI là signal có version và có thể sai; policy chuyển nó thành business decision.
3. Dùng atomic uniqueness, inbox/outbox và effect key thay cho kiểm tra `exists()`.
4. Định nghĩa rõ latency, retry, rate limit, cost và fallback có giới hạn.
5. Giữ Kafka cho replay, DB làm source of truth, OpenSearch làm read model có thể rebuild.
6. Tối thiểu hóa dữ liệu nhạy cảm và làm audit, observability hữu ích mà không biến identifier thành metric label.
