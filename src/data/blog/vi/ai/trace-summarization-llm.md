---
title: "Thiết kế service dùng LLM để tóm tắt distributed trace"
description: "Thiết kế thực tế để chuyển một traceId của OpenTelemetry thành bản tóm tắt sự cố có giới hạn và có thể audit, nhưng không trao quyền quyết định tài chính cho LLM."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

LLM có thể giúp đọc distributed trace dễ hơn, nhưng không làm cho trace đáng tin cậy hơn. Bài toán kỹ thuật là rút gọn một tập span lớn thành context hữu ích, đồng thời giữ lại bằng chứng, kiểm soát chi phí và độ trễ, và giữ model nằm ngoài luồng quyết định tài chính.

Bài viết này trình bày một thiết kế minh họa dùng Spring Boot cho `trace-summarization-llm`. Nội dung bao phủ ranh giới giữa domain code và provider-specific code, chọn span, xây dựng prompt, resilience, quản lý secret, idempotency và auditability. Code và tên component là thiết kế đề xuất, không phải tuyên bố về hệ thống production của một công ty cụ thể.

## Phạm vi và các đảm bảo

> **[SOURCE FACT]** Input là `traceId` của OpenTelemetry; output mong muốn là phần giải thích trace bằng ngôn ngữ dễ đọc: chuyện gì đã xảy ra, thao tác nào chậm, lỗi ở đâu và thao tác nào đã được retry.

> **[ANALYSIS]** Bản tóm tắt trace là công cụ hỗ trợ observability. Nó không phải nguồn sự thật và không được cấp phép cho refund, release, reversal hay bất kỳ hành động tài chính nào. Các quyết định đó cần business rule xác định và control path phù hợp.

> **[PROPOSED DESIGN]** Trước khi viết adapter cho model, hãy xác định các đảm bảo sau:

1. **Không có quyền quyết định tài chính.** Model có thể mô tả bằng chứng quan sát được và nêu mức độ không chắc chắn. Model không được trả về một operational decision mà ứng dụng coi là có thẩm quyền.
2. **Idempotency theo `eventId`.** Producer và consumer thường hoạt động với delivery at-least-once. Vì vậy consumer phải ghi nhận event trước khi thực hiện công việc không được lặp. Exactly-once trong nghiệp vụ là kết quả ở tầng ứng dụng, không phải thuộc tính có thể mặc định từ broker.
3. **Timeout, retry và circuit breaker.** Model provider là dependency bên ngoài. Timeout giới hạn thời gian một request chiếm tài nguyên; retry xử lý một số lỗi tạm thời; circuit breaker ngừng gửi request khi dependency không khỏe.
4. **Bring your own key (BYOK).** Khách hàng cung cấp credential của provider. Service dùng reference tới secret manager và không hardcode hoặc ghi log credential.
5. **Auditability.** Lưu identity của input, bằng chứng đã chọn, prompt và kết quả provider theo retention policy và privacy policy áp dụng. Redact dữ liệu nhạy cảm trước khi đưa vào prompt hoặc log. Việc human review và correction cũng nên được ghi nhận.

Các đảm bảo này phân biệt summarizer với một autonomous agent. Chúng cũng giúp kiểm thử thiết kế mà không cần gọi model provider thật.

## Bản triển khai dễ mắc phải

Ví dụ sau cố ý sai. Nó minh họa các lỗi thường xuất hiện khi provider integration, domain behavior và logging được đặt trong cùng một class.

```java
// WRONG: anti-pattern minh họa; không được ship
@Service
public class TraceSummarizer {
    private static final String API_KEY = "redacted"; // secret trong source
    private final RestTemplate rest = new RestTemplate();
    private final SpanRepo spans;

    public String summarize(String traceId) {
        List<Span> all = spans.findAllByTraceId(traceId); // input không giới hạn
        String prompt = "Summarize this trace:\n" + all
            + "\nDecide if the user should be refunded.";
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(API_KEY);
        return rest.postForObject("https://api.llm.example/v1/chat",
            new HttpEntity<>(prompt, headers), String.class);
    }
}
```

Các vấn đề ở đây đều cụ thể:

- **Lộ secret:** credential trong source có thể đi vào lịch sử Git, build artifact, dump hoặc log. BYOK không có ý nghĩa nếu credential là compile-time constant.
- **Context không giới hạn:** tải mọi span có thể vượt model context window, làm tăng token usage và che khuất bằng chứng liên quan. Query của repository cần có limit rõ ràng và chiến lược chọn span.
- **Trao quyền trong prompt:** hỏi model có nên refund hay không biến một trình sinh văn bản xác suất thành financial control ngoài ý muốn.
- **Prompt injection:** span attribute có thể do attacker hoặc upstream không đáng tin cậy ghi vào. Attribute chứa instruction phải vẫn là data, không được trở thành instruction có độ ưu tiên cao hơn.
- **Thiếu resilience:** không có connect timeout và response timeout thì HTTP call có thể giữ consumer vô thời hạn. Retry mọi lỗi có thể khuếch đại outage, nên retry cần số lần giới hạn và phân loại lỗi.
- **Log dữ liệu nhạy cảm:** raw response có thể lặp lại dữ liệu trong prompt hoặc PII. Không nên ghi nó vào application log thông thường.
- **Lộ infrastructure vào domain:** domain logic bị ghép với `RestTemplate`, HTTP header, endpoint và wire format. Test phải dùng network mock, và đổi provider sẽ buộc phải sửa business code.

## Kiến trúc đề xuất

> **[PROPOSED DESIGN]** Dùng hexagonal architecture. Domain định nghĩa use case và port; adapter triển khai Kafka, span store, LLM client, secret retrieval, resilience và audit persistence.

```text
trace-summarization-llm/
├── domain/
│   ├── model/TraceId.java, EventId.java, Span.java, TraceSummary.java
│   ├── port/in/SummarizeTraceUseCase.java
│   ├── port/in/HandleTraceEventUseCase.java
│   ├── port/out/SpanRepository.java, SummaryStore.java
│   ├── port/out/LlmPort.java, AuditLog.java
│   └── service/TraceSummarizerService.java, TraceEventProcessor.java
├── infrastructure/
│   ├── kafka/TraceEventConsumer.java
│   ├── opensearch/SpanOpenSearchRepository.java, SummaryOpenSearchStore.java
│   ├── llm/LlmAdapter.java, LlmRequest.java, LlmConfig.java
│   ├── resilience/ResilienceConfig.java
│   ├── secrets/SecretManager.java
│   └── audit/AuditLogAdapter.java
└── application/
    ├── TraceSummarizationApplication.java
    └── config/AppConfig.java
```

Domain port không biết đang dùng provider nào:

```java
public interface LlmPort {
    LlmResult complete(LlmRequest request);
}
```

Application service giờ có thể được test với một `LlmPort` giả. Adapter chịu trách nhiệm serialize request, authentication, mapping lỗi riêng của provider và resilience policy.

## Chọn bằng chứng trước khi gọi model

> **[ANALYSIS]** Span store không nên bị xem như prompt builder. Một bản tóm tắt hữu ích bắt đầu từ một tập bằng chứng có giới hạn.

> **[PROPOSED DESIGN]** Repository query nên chọn span theo policy rõ ràng, chẳng hạn:

- giữ root span và causal path trực tiếp của nó;
- giữ span có error status, exception event hoặc downstream call thất bại;
- giữ span chậm theo policy của service, thay vì áp một ngưỡng toàn cục không có cơ sở;
- giữ các retry attempt và kết quả của chúng;
- giữ timestamp, duration, service, operation, status và các attribute đã được chọn cẩn thận;
- loại bỏ hoặc redact secret, token, dữ liệu thanh toán và PII không cần thiết;
- đặt giới hạn cho số span, kích thước attribute và tổng input sau serialize.

Selector nên trả về structured evidence, không phải một đoạn văn đã format sẵn. Sau đó prompt builder có thể đánh dấu evidence là untrusted data và yêu cầu một output shape cố định, chẳng hạn:

```text
Summary:
Evidence:
Uncertainty:
```

Không được yêu cầu model suy ra những fact không có trong các span đã chọn. Khi UI hỗ trợ, summary nên liên kết các nhận định với span identifier để operator có thể kiểm tra bằng chứng nguồn.

## Ranh giới provider và resilience

LLM adapter nên nhận một typed request gồm evidence đã chọn, instruction rằng evidence là untrusted và output schema cần dùng. Adapter trả về typed result hoặc typed failure. Provider JSON, HTTP status code và authentication header phải nằm bên trong adapter.

Áp dụng resilience tại ranh giới này:

- đặt connect timeout, response timeout và total operation timeout;
- chỉ retry các lỗi được phân loại là transient, với số lần giới hạn và backoff;
- không retry validation error, authentication failure hoặc prompt-size failure;
- mở circuit khi đạt failure policy đã cấu hình;
- trả về fallback an toàn khi summarization không khả dụng: hiển thị structured evidence đã chọn và đánh dấu summary là unavailable;
- áp dụng backpressure, tức giới hạn lượng công việc consumer nhận, để provider chậm không làm cạn thread, memory hoặc connection.

Fallback không phải là một lời giải thích bịa ra. Đây là degraded mode rõ ràng, cho phép operator kiểm tra trace mà không coi generated text là bằng chứng.

## Idempotency và audit

Event consumer nên truyền `eventId` và `traceId` cho domain service. Trước khi gọi provider, consumer cần thực hiện atomic idempotency check hoặc dùng unique constraint trong summary store. State được lưu nên phân biệt ít nhất `PROCESSING`, `COMPLETED` và `FAILED`, kèm retry policy cho lỗi có thể khôi phục.

Không nên khẳng định một distributed workflow là exactly-once chỉ vì message broker hoặc database có transaction. Đảm bảo hữu ích là việc giao lại cùng `eventId` không tạo nhiều summary có hiệu lực hoặc duplicate side effect. Cần có failure-mode test cho crash xảy ra giữa provider call và store update.

Audit record nên có correlation identifier, configuration hoặc model version, trạng thái redaction, identifier của evidence đã chọn, result status và các human correction. Chỉ lưu prompt và response khi privacy policy cho phép; nếu không, lưu hash, reference hoặc bản đã redact. Không đưa credential, raw authorization header hoặc trace payload không cần thiết vào audit record.

## Kiểm thử các ranh giới

Test domain mà không cần Spring hoặc network connection thật:

- trace có lỗi chọn đúng error path và không tạo financial action;
- text không đáng tin trong span được render như data và không thể thay đổi task được yêu cầu;
- giao lại cùng `eventId` vẫn idempotent;
- provider timeout, transient failure, permanent failure và circuit-open được map thành fallback đúng;
- attribute nhạy cảm được redact trước khi dựng request và ghi log;
- provider output sai format bị reject, không âm thầm được coi là decision.

Adapter test nên kiểm tra riêng HTTP serialization, secret-manager lookup, timeout configuration, provider error mapping và audit persistence. Contract test có thể xác nhận provider adapter tuân thủ `LlmPort` mà không đưa chi tiết provider vào domain.

## Kết luận

LLM trace summarizer phù hợp nhất với vai trò một lớp diễn giải có giới hạn và chỉ đọc. Trace store vẫn là nguồn bằng chứng, service xác định vẫn chịu trách nhiệm cho hành động tài chính, còn model được cô lập sau typed port, redaction, resilience, idempotency và audit control.

Đó là quyết định kiến trúc chính. Đoạn văn được sinh ra chỉ là một cách trình bày trace; nó không được trở thành system of record hoặc control có khả năng di chuyển tiền.
