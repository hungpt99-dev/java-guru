---
title: "Building a Shared AI Core Library for a Microservice Fleet"
description: "Đội ngũ platform của FinPay phát hành thư viện AI dùng chung với client BYOK, cơ chế retry và circuit breaker, cùng tính năng ghi audit được mọi tính năng AI sử dụng."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/platform>

## Vì Sao Cần Một Thư Viện AI Dùng Chung

Mỗi đội ngũ của FinPay đều tự xây dựng một cách tích hợp LLM riêng: đội này gọi OpenAI trực tiếp từ controller, đội kia nhét API key vào `application.yml`, còn đội nọ xử lý lỗi bằng cách gửi event trở lại dead-letter queue mà không có timeout. Ba service, ba cách parse `JsonObject` khác nhau, không có telemetry dùng chung, và audit trail gần như chỉ là một dòng `logger.info("done")`.

Chúng tôi đã phát hành `platform-ai-core-library` để việc sử dụng AI trở nên nhàm chán, an toàn và có thể quan sát trên toàn nền tảng. Đây là một module Spring Boot được xây dựng theo kiến trúc hexagonal: `domain/` chứa các port và use case, còn `infrastructure/` chứa các adapter (Kafka, nhà cung cấp model, OpenSearch và Vault). Link repository cũng xuất hiện ở cuối bài: <https://github.com/finpay-lab/platform>.

## Guardrails Không Thể Thỏa Hiệp

Trước khi viết bất kỳ dòng code nào, đây là những quy tắc định hình mọi thứ:

1. **AI không phải là bên quyết định việc chuyển tiền.** Output của LLM chỉ *bổ sung thông tin* cho một quyết định — điểm số gian lận, hạn mức đề xuất hoặc nhãn rủi ro — nhưng quyết định chuyển hoặc chặn tiền do các luật xác định (deterministic rules) và con người đưa ra. Thư viện không bao giờ trả về "approve/reject"; nó trả về một kết quả có điểm số, nhãn và có thể audit.
2. **Idempotent theo `eventId`.** Mọi lời gọi AI đều được định danh bằng `eventId` do bên gọi cung cấp. Dù event được gửi lại (redelivery), retry hay người dùng nhấp đúp, một event vẫn chỉ tạo ra đúng một quyết định.
3. **Timeout, retry, circuit breaker.** Không lời gọi HTTP nào được phép chờ vô hạn. Timeout, retry có giới hạn kèm backoff và circuit breaker giúp hệ thống hạ cấp một cách êm thấm thay vì liên tục gọi một provider đang gặp sự cố.
4. **BYOK — key không bao giờ nằm trong code hay log của chúng ta.** Mỗi tenant mang key riêng của mình (BYOK), được giữ trong Vault/secret manager, được tra cứu theo reference, có thể xoay vòng, và *không bao giờ* bị serialize vào log, trace hay bản ghi audit.
5. **Audit mọi quyết định.** Hash của prompt, model, latency, chi phí, ID của key và verdict được lưu vào OpenSearch để có thể truy vấn phục vụ điều tra.

## Kiến trúc trong một hình

```
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

Use case trong `domain/` chỉ phụ thuộc vào các port. Đổi OpenAI sang Bedrock chỉ cần thay đổi một file adapter.

## WRONG, rồi RIGHT: credentials (BYOK)

### WRONG

```java
// Key cứng trong code — commit vào git, rò rỉ khắp nơi, tồn tại mãi mãi.
public class MoneyFairyService {
    private static final String OPENAI_KEY = "«redacted:sk-…»...";

    public String label(String text) {
        OpenAIClient client = new OpenAIClient(OPENAI_KEY);
        // Tệ hơn: log cả key "để debug cho dễ"
        log.info("Calling provider with key={}", OPENAI_KEY);
        return client.complete(systemPrompt + text);
    }
}
```

Sai ở đâu: key nằm trong repository, xuất hiện trong quá trình quét classpath và trong từng dòng log, không thể xoay vòng nếu không deploy, đồng thời xuất hiện trong kết quả secret scanner của GitHub để cả Internet nhìn thấy.

### RIGHT

```java
// application.yml  (chỉ là một reference, không bao giờ là secret)
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
// domain/ — port. Use case không bao giờ thấy key.
public interface CredentialResolver {
    KeyCredentials resolve(String keyRef);
}

public record KeyCredentials(String id, char[] secret) { }
```

```java
// infrastructure/ — adapter nói chuyện với Vault.
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
// infrastructure/ — adapter provider resolve key trong bộ nhớ theo từng lần gọi
// và không bao giờ để lộ. char[] và masking toString() giữ key khỏi log.
@Component
public class AnthropicModelAdapter implements ModelProvider {
    private final CredentialResolver credentials;
    private final AiProperties props;

    public ModelResult complete(AiRequest request) {
        KeyCredentials creds = credentials.resolve(props.keyRef());
        try (AnthropicClient client = new AnthropicClient(creds)) {
            return client.complete(props.model(), request);
        } finally {
            Arrays.fill(creds.secret(), 'x');  // xoá sạch khỏi bộ nhớ
        }
    }
}
```

Key chỉ tồn tại trong phạm vi của adapter, dưới dạng `char[]` được xoá sạch sau lời gọi. Không gì log nó, không gì lưu trữ nó.

## WRONG, rồi RIGHT: timeout, retry, circuit breaker

### WRONG

```java
public String callLlm(String prompt) throws IOException, InterruptedException {
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofMinutes(30))   // thực chất là vô hạn
            .POST(...)
            .build();
    HttpResponse<String> res = client.send(req, BodyHandlers.ofString());
    if (res.statusCode() == 500) {
        // "retry": chỉ block tiếp, hy vọng nó qua
        return callLlm(prompt);
    }
    return res.body();
}
```

Sai ở đâu: mỗi lời gọi chiếm giữ một thread tới 30 phút, retry đệ quy khiến latency tăng gấp đôi sau mỗi lần lỗi, và không có trạng thái circuit. Khi provider ngừng hoạt động, toàn bộ thread pool bị tiêu tốn để chờ một endpoint đã chết.

### RIGHT

```java
@Component
public class ResilientModelPort {
    private final Retry retry;
    private final CircuitBreaker circuitBreaker;
    private final TimeLimiter timeLimiter;

    // Resilience4j: cap 4s, 3 lần retry kèm backoff, ngắt ở 50% lỗi / 10 cuộc gọi
    public ResilientModelPort() {
        this.retry = Retry.ofDefaults("ai-retry");
        this.circuitBreaker = CircuitBreaker.ofDefaults("ai-cb");
        this.timeLimiter = TimeLimiter.of(Duration.ofSeconds(4));
    }

    public ModelResult call(AiRequest request, Supplier<ModelResult> delegate) {
        Supplier<ModelResult> guarded =
                timeLimiter.decorateFutureSupplier(() ->
                        CompletableFuture.supplyAsync(() -> delegate.get()));
        return circuitBreaker.decorateSupplier(
                retry.decorateSupplier(guarded::get)).get();
    }
}
```

```java
// resilience4j.yml
ai-retry:
  maxAttempts: 3
  waitDuration: 500ms
  exponentialBackoffMultiplier: 2.0
ai-cb:
  slidingWindowSize: 10
  failureRateThreshold: 50
  waitDurationInOpenState: 30s
```

Khi breaker mở, thư viện trả về một `ModelResult.unavailable()` có cấu trúc thay vì treo. Bên gọi có thể hạ cấp (fallback về một heuristic đơn giản hơn) vì chính timeout, chứ không phải thread, mới giới hạn lời gọi.

## WRONG, rồi RIGHT: idempotency theo `eventId`

### WRONG

```java
@KafkaListener(topics = "tx.risk", groupId = "ai-classifier")
public void on(TxEvent event) {
    // Redelivery ⇒ lời gọi LLM trùng lặp, chi phí trùng lặp, audit trùng lặp.
    Verdict verdict = ai.classify(event);          // bị gọi lại khi redelivery
    outcomeRepository.save(verdict);               // dòng trùng lặp, không dedup
    audit.log("classified", event.id(), verdict);  // ồn ào, không idempotent
}
```

### RIGHT

```java
@KafkaListener(topics = "tx.risk", groupId = "ai-classifier")
public void on(TxEvent event) {
    if (outcomeStore.exists(event.eventId())) {
        log.info("Duplicate event, skipping. eventId={}", event.eventId());
        return;
    }
    Verdict verdict = resilientAi.classify(event.eventId(), event.toPrompt());
    outcomeStore.save(new Outcome(event.eventId(), verdict));
    decisionAudit.record(AuditRecord.from(event.eventId(), verdict, aiContext));
}
```

`OutcomeStore` giữ cặp `eventId → verdict` trong Redis với TTL đủ bao phủ cửa sổ redelivery của Kafka. `DecisionAudit` ghi bản ghi dài hạn vào OpenSearch một lần, dùng `eventId` làm `_id`, nên một lần ghi trùng chỉ là no-op trên cùng một shard.

## WRONG, rồi RIGHT: audit quyết định

### WRONG

```java
log.info("AI said: " + prompt + " -> " + rawResponse);
```

Prompt thô (PII) và response chưa được che nằm trong stdout, không thể truy vấn, đồng thời không có ID key, phiên bản model hay thông tin chi phí.

### RIGHT

```java
public record AuditRecord(
        String eventId,
        Instant decidedAt,
        String tenantId,
        String model,
        String promptSha256,     // hash — không bao giờ là chính prompt
        String verdict,
        String providerKeyId,    // chỉ id — reference BYOK, không bao giờ là secret
        long latencyMillis,
        BigDecimal costUsd,
        String correlationId) {

    public static AuditRecord from(String eventId, Verdict v, AiContext ctx) {
        return new AuditRecord(eventId, Instant.now(), ctx.tenantId(), ctx.model(),
                sha256(v.prompt()), v.label(), ctx.keyId(), v.latencyMillis(),
                v.costUsd(), ctx.correlationId());
    }
}
```

```java
@Component
public class OpenSearchDecisionAudit implements DecisionAudit {
    @Override
    public void record(AuditRecord r) {
        // eventId làm _id ⇒ các lần ghi khi redelivery là idempotent
        IndexRequest req = new IndexRequest("ai-decisions").id(r.eventId())
                .source(toJson(r), XContentType.JSON);
        opensearchClient.index(req, RequestOptions.DEFAULT);
    }
}
```

Mọi quyết định đều có thể truy vấn: "toàn bộ lời gọi dùng key của tenant-42 trên model `claude-sonnet-4-5` trong khoảng thời gian giữa hai mốc", cùng với latency p95 và chi phí theo từng provider. Nếu khách hàng khiếu nại một lệnh chặn, ta có thể replay chính xác model, hash prompt và verdict đã tạo ra quyết định đó.

## Luồng Kafka từ đầu đến cuối

1. `tx.risk` phát ra `TxEvent` với `eventId` do platform sinh ra.
2. Consumer (trong `infrastructure/kafka`) chuyển nó vào `AiUseCase` trong `domain/`.
3. `AiUseCase` kiểm tra `OutcomeStore` theo `eventId` (dedup) và gọi `AiClassifier` qua resilient port.
4. `AnthropicModelAdapter` (hoặc OpenAI/Bedrock — thay đổi theo `AiProperties.provider`) lấy key BYOK từ Vault cho tenant đó.
5. Verdict được lưu trong `OutcomeStore` (TTL ngắn) và `OpenSearchDecisionAudit` (dài hạn).
6. Kết quả đã làm giàu đi tới `tx.decisions`, nơi các luật xác định và sự rà soát của con người — *không phải model* — quyết định hành động liên quan đến tiền.

## Những Phần Vẫn Còn Khó

- **Cố định prompt template.** Chỉ một chút prompt drift cũng có thể làm thay đổi verdict; chúng tôi quản lý phiên bản prompt và ghi hash vào bản ghi audit để có thể tái hiện verdict.
- **Chi phí bùng nổ.** Các lời gọi ngữ cảnh dài và retry khiến số token tăng vọt; thư viện giới hạn `maxTokens` và theo dõi chi phí theo từng `eventId` trong OpenSearch.
- **Xoay vòng BYOK.** Tenant xoay key qua Vault; vì key chỉ là reference, việc xoay vòng không bao giờ đòi hỏi deploy hay thay đổi code.

Thư viện nằm trong <https://github.com/finpay-lab/platform> — cả các port ở domain lẫn các adapter ở infrastructure đều nằm đó, nên mọi service đều có thể sử dụng các guardrails này chỉ với một dependency.

Repo: <https://github.com/finpay-lab/platform>
