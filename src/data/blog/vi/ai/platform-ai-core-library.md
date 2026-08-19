---
title: "Thư viện AI core dùng chung cho hệ thống microservice"
description: "Thiết kế thực tế cho tích hợp LLM dùng chung với credential BYOK, cơ chế chống lỗi, idempotency và kết quả có audit."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo được nhắc đến trong tài liệu nguồn: <https://github.com/finpay-lab/platform>

## Bài toán

Thêm một lời gọi LLM vào một service khá đơn giản. Vận hành lời gọi đó nhất quán trên cả một fleet microservice thì không. Tích hợp cần cô lập credential, xử lý lỗi có giới hạn, chống xử lý trùng event và tạo audit record hữu ích khi cần điều tra.

**[THÔNG TIN NGUỒN]** Tài liệu nguồn mô tả ba service với ba cách tích hợp khác nhau: gọi trực tiếp provider từ controller, đặt API key trong `application.yml`, và xử lý lỗi bằng cách gửi event lỗi trở lại dead-letter queue mà không có timeout. Tài liệu cũng mô tả việc parse `JsonObject` không nhất quán, không có telemetry dùng chung, và audit trail chỉ còn một thông báo `logger.info("done")`.

**[PHÂN TÍCH]** Đây không phải là ba vấn đề LLM độc lập. Đây là các mối quan tâm của platform. Một module Spring Boot dùng chung có thể cung cấp cùng một contract cho việc gọi provider, tra credential, xử lý lỗi, deduplication và audit quyết định, trong khi policy nghiệp vụ vẫn nằm ở service gọi nó.

Bài viết này tập trung vào ranh giới đó. LLM không được xem là bên có quyền quyết định việc chuyển tiền, và phần code dưới đây không được trình bày như một thư viện production hoàn chỉnh.

## Guardrails

Đây là các quy tắc không thể bỏ qua trong thiết kế đề xuất:

1. **AI không quyết định việc chuyển tiền.** LLM có thể bổ sung thông tin cho quyết định của rule xác định (deterministic) hoặc con người, chẳng hạn fraud score, hạn mức đề xuất hoặc risk label. Rule engine hoặc người có thẩm quyền mới quyết định chuyển hay chặn tiền. Vì vậy thư viện trả về một observation có score, label và audit, thay vì một lệnh `approve`/`reject`.
2. **Dùng `eventId` do bên gọi cung cấp để bảo đảm idempotency.** Redelivery, retry hoặc double-click không được tạo thêm outcome cho cùng một event. Thư viện nên biến đây thành contract rõ ràng, được bảo vệ bằng thao tác claim atomic trong outcome store.
3. **Giới hạn mọi lời gọi provider.** Timeout, retry có giới hạn kèm backoff và circuit breaker ngăn provider lỗi chiếm tài nguyên của bên gọi vô thời hạn. Ba cơ chế có vai trò khác nhau: timeout giới hạn một attempt, retry xử lý một số lỗi tạm thời, còn circuit breaker ngắt lời gọi khi lỗi kéo dài.
4. **Dùng BYOK nhưng không để lộ secret.** Mỗi tenant cung cấp key riêng. Key được giữ trong Vault hoặc secret manager khác, được tra cứu bằng reference, xoay vòng tại đó, và không xuất hiện trong log, trace hay audit record.
5. **Audit kết quả, không audit secret.** Lưu prompt hash, model, latency, cost, key ID và verdict vào OpenSearch để truy vấn phục vụ forensic analysis, nhưng không lưu prompt hoặc API key.

## Kiến trúc

**[THIẾT KẾ ĐỀ XUẤT]** Giữ use case trong `domain/` và chỉ cho nó phụ thuộc vào các port. Đặt tích hợp Kafka, model provider, Redis, OpenSearch và Vault vào các adapter trong `infrastructure/`.

```text
                 ┌────────────────────────── domain/ (ports) ──────────────────────────┐
  Kafka ──► Consumer ──► AiUseCase ──► AiClassifier      OutcomeStore     DecisionAudit
  tx.risk      │            │              ▲                   ▲                ▲
               │            │              │ adapters          │ adapters       │ adapter
               ▼            ▼              │                   │                │
          infrastructure/ ─┼───────────────┴───────────────────┴────────────────┘
                 │
                 ├── ModelProviderAdapter (OpenAI / Anthropic / Bedrock)
                 ├── RedisOutcomeStore            (dedup + TTL ngắn)
                 ├── OpenSearchDecisionAudit      (forensics dài hạn)
                 └── VaultCredentialResolver      (BYOK theo reference)
```

Use case chỉ biết các port. Vì vậy, thay một model provider bằng provider khác nên chỉ cần thay adapter, không phải thay policy trong domain. Đây là mục tiêu thiết kế, không phải khẳng định về một implementation cụ thể trong repository.

## Credential: sai và đúng

### Sai

```java
// Key hardcode: có thể bị commit, copy vào ticket và ghi vào log.
public class MoneyFairyService {
    private static final String OPENAI_KEY = "«redacted:sk-…»...";

    public String label(String text) {
        OpenAIClient client = new OpenAIClient(OPENAI_KEY);
        log.info("Calling provider with key={}", OPENAI_KEY);
        return client.complete(systemPrompt + text);
    }
}
```

Key lúc này nằm trong repository và cấu hình của process, không thể xoay vòng độc lập với việc deploy, đồng thời bị lộ qua câu lệnh log. Secret scanner cũng có thể giữ lại finding sau khi key đã bị xóa khỏi working tree. Cách xử lý thực tế là xoay vòng key và loại bỏ khỏi history, không chỉ xóa một dòng code.

### Đúng

**[THIẾT KẾ ĐỀ XUẤT]** Lưu reference trong configuration. Chỉ resolve secret ở ranh giới provider.

```yaml
# application.yml: reference, không phải secret
ai:
  provider: anthropic
  key-ref: vault://finpay/ai/tenant-42/anthropic-key
  model: claude-sonnet-4-5
  timeout: 4s
  max-retries: 3
```

```java
@ConfigurationProperties(prefix = "ai")
@Validated
public record AiProperties(
        @NotBlank String provider,
        @NotBlank String keyRef,
        @NotBlank String model,
        @DurationMin(seconds = 1) Duration timeout,
        @Min(0) int maxRetries) {
}
```

```java
// domain/: use case không bao giờ nhận key.
public interface CredentialResolver {
    KeyCredentials resolve(String keyRef);
}

public record KeyCredentials(String id, char[] secret) { }
```

```java
// infrastructure/: adapter giao tiếp với Vault.
@Component
public class VaultCredentialResolver implements CredentialResolver {
    private final VaultTemplate vault;

    public KeyCredentials resolve(String keyRef) {
        VaultResponse response = vault.readSecret(keyRef);
        return new KeyCredentials(response.getKeyId(),
                response.getData().get("api_key").toCharArray());
    }
}
```

```java
// infrastructure/: resolve trong bộ nhớ cho một lần gọi và không để lộ key.
@Component
public class AnthropicModelAdapter implements ModelProvider {
    private final CredentialResolver credentials;
    private final AiProperties props;

    public ModelResult complete(AiRequest request) {
        KeyCredentials creds = credentials.resolve(props.keyRef());
        try (AnthropicClient client = new AnthropicClient(creds)) {
            return client.complete(props.model(), request);
        } finally {
            Arrays.fill(creds.secret(), 'x');
        }
    }
}
```

Ví dụ giữ secret trong phạm vi adapter dưới dạng `char[]` và xóa nội dung mảng sau lời gọi. Cách này giảm nguy cơ lộ do vô tình, nhưng không bảo đảm chống mọi cơ chế làm lộ memory. Có thể audit key ID, nhưng không được audit key material.

## Resilience: sai và đúng

### Sai

```java
public String callLlm(String prompt) throws IOException, InterruptedException {
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofMinutes(30))
            .POST(...)
            .build();
    HttpResponse<String> res = client.send(req, BodyHandlers.ofString());
    if (res.statusCode() == 500) {
        return callLlm(prompt);
    }
    return res.body();
}
```

Đoạn code giữ một thread tối đa 30 phút, retry đệ quy không giới hạn và không có circuit state. Khi provider tiếp tục không khả dụng, caller vẫn tiêu tốn tài nguyên cho cùng một endpoint đang lỗi.

### Đúng

**[THIẾT KẾ ĐỀ XUẤT]** Đặt resilience tại provider port. Cấu hình cụ thể phụ thuộc thư viện được chọn, nhưng behavior phải rõ ràng:

```java
@Component
public class ResilientModelPort {
    private final Retry retry;
    private final CircuitBreaker circuitBreaker;
    private final ModelProvider delegate;

    public ModelResult complete(AiRequest request) {
        return circuitBreaker.executeSupplier(() ->
                retry.executeSupplier(() -> delegate.complete(request)));
    }
}
```

Cấu hình HTTP client với timeout hữu hạn, chẳng hạn giá trị `4s` ở trên. Chỉ retry những lỗi an toàn và có khả năng là tạm thời; giới hạn số lần retry và dùng backoff. Không retry lỗi validation, lỗi authentication hoặc request có side effect nhưng không bảo đảm idempotency. Circuit breaker nên fail fast khi provider không khỏe; caller có thể chọn fallback, trì hoãn event hoặc ghi nhận outcome `UNAVAILABLE`.

Fallback là một phần của contract use case, không phải lý do để tự tạo ra kết quả AI. Fallback an toàn có thể giữ event để xử lý sau hoặc trả về trạng thái `UNAVAILABLE` rõ ràng cho business logic xác định.

## Idempotency và ranh giới audit

**[THIẾT KẾ ĐỀ XUẤT]** Consumer truyền `eventId` vào use case. Trước khi gọi provider, use case thử claim atomic trong `RedisOutcomeStore`. Nếu event đã hoàn tất, trả về outcome đã lưu. Nếu event đang được xử lý, áp dụng behavior redelivery đã định nghĩa cho consumer thay vì bắt đầu lời gọi provider thứ hai.

Redis được dùng để deduplication với TTL ngắn. Record dài hạn thuộc về `OpenSearchDecisionAudit`. Audit document có thể chứa các field:

```text
eventId, promptHash, model, latency, cost, keyId, verdict
```

Đây là audit contract được mô tả trong tài liệu nguồn. Retention, index mapping, cách tính cost và vocabulary chính xác của verdict vẫn phải do platform team quy định. Đặc biệt, cần xác định rõ phạm vi uniqueness của `eventId` nếu nhiều tenant hoặc event domain có thể dùng lại cùng giá trị.

## Kết quả đạt được

Giá trị của thư viện core dùng chung là tạo một ranh giới hẹp và có thể kiểm soát:

- business service gửi AI request qua một use-case API ổn định;
- credential của provider nằm sau resolver và adapter;
- timeout và retry có giới hạn được áp dụng nhất quán;
- event trùng có thể được nhận diện trước khi gọi provider lần nữa;
- audit record mô tả điều đã xảy ra mà không chứa secret.

Ranh giới này làm cho tích hợp AI ít phụ thuộc hơn vào quy ước riêng của từng service. Nó không loại bỏ nhu cầu test theo từng provider, access control, retention policy hoặc quy trình ra quyết định xác định ở bên ngoài thư viện.
