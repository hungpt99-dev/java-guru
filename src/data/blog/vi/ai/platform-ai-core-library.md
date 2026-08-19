---
title: "AI-8 Shared ai-core Library (BYOK, retry, audit)"
description: "Tích hợp AI nền tảng FinPay: platform-ai-core-library."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/platform>

## Vì sao cần một thư viện AI dùng chung

Mỗi team của FinPay đang tự xây tích hợp LLM riêng: team này gọi OpenAI trực tiếp từ controller, team kia nhét API key vào `application.yml`, team nọ retry khi lỗi bằng cách ném event trở lại dead-letter queue mà không có timeout. Ba service, ba cách parse `JsonObject` khác nhau, không có telemetry dùng chung, và audit trail gần như chỉ là `logger.info("done")`.

Chúng tôi đã phát hành `platform-ai-core-library` để việc dùng AI trở nên nhàm chán, an toàn và có thể quan sát được trên toàn nền tảng. Đây là một module Spring Boot xây theo kiến trúc hexagonal — `domain/` chứa các port và use case, `infrastructure/` chứa các adapter (Kafka, nhà cung cấp model, OpenSearch, Vault). Link repo cũng nằm ở cuối bài: <https://github.com/finpay-lab/platform>.

## Guardrails, bất khả thương lượng

Trước mọi code, những quy tắc định hình tất cả:

1. **AI không phải người quyết định tiền.** Output của LLM chỉ *làm giàu* một quyết định — một điểm số gian lận, một hạn mức gợi ý, một nhãn rủi ro — nhưng quyết định chuyển hoặc chặn tiền do các luật xác định (deterministic rules) và con người đưa ra. Thư viện không bao giờ trả về "approve/reject"; nó trả về một quan sát có điểm số, nhãn và có thể audit được.
2. **Idempotent theo `eventId`.** Mọi lời gọi AI đều được định danh bằng `eventId` do caller cung cấp. Giao lại (redelivery), retry, double-click — một event sinh ra đúng một quyết định.
3. **Timeout, retry, circuit breaker.** Không block vô hạn trên một lời gọi HTTP. TimeLimit, retry có giới hạn kèm backoff, và circuit breaker hạ cấp duyên dáng thay vì đập vào một provider đang chết.
4. **BYOK — key không bao giờ nằm trong code hay log của chúng ta.** Mỗi tenant mang key riêng của mình (BYOK), được giữ trong Vault/secret manager, giải quyết bằng reference, xoay vòng được, và *không bao giờ* bị serialize vào log, trace hay bản ghi audit.
5. **Audit mọi quyết định.** Hash của prompt, model, latency, chi phí, id của key, verdict — lưu vào OpenSearch để phục vụ điều tra truy vấn được.

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

Use case trong `domain/` chỉ phụ thuộc vào các port. Đổi OpenAI sang Bedrock chỉ là thay đổi một adapter trong một file.

## WRONG rồi RIGHT: credentials (BYOK)

### WRONG

```java
// Key cứng trong code — commit vào git, rò rỉ khắp nơi, tồn tại mãi mãi.
public class MoneyFairyService {
    private static final String OPENAI_KEY = "sk-proj-abc123...";

    public String label(String text) {
        OpenAIClient client = new OpenAIClient(OPENAI_KEY);
        // Tệ hơn: log cả key "để debug cho dễ"
        log.info("Calling provider with key={}", OPENAI_KEY);
        return client.complete(systemPrompt + text);
    }
}
```

Sai ở đâu: key nằm trong repo, trong classpath scans, trong từng dòng log, không thể xoay vòng mà không deploy, và xuất hiện trong kết quả secret scanner của GitHub trước mặt cả internet.

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

## WRONG rồi RIGHT: timeout, retry, circuit breaker

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

Sai ở đâu: mỗi lời gọi giữ một thread tới 30 phút, retry đệ quy khiến latency tăng gấp đôi sau mỗi lần lỗi, không có trạng thái circuit — khi provider chết ta đốt cả thread pool chờ một endpoint đã chết.

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

Khi breaker mở, thư viện trả về một `ModelResult.unavailable()` có cấu trúc thay vì treo — caller có thể hạ cấp (fallback về một heuristic đơn giản hơn) vì timeout, chứ không phải thread, mới là thứ giới hạn lời gọi.

## WRONG rồi RIGHT: idempotency theo `eventId`

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

`OutcomeStore` giữ cặp `eventId → verdict` trong Redis với TTL đủ để phủ cửa sổ redelivery của Kafka; `DecisionAudit` ghi bản ghi dài hạn vào OpenSearch đúng một lần, dùng `eventId` làm `_id` nên một lần ghi trùng chỉ là no-op trên cùng một shard.

## WRONG rồi RIGHT: audit quyết định

### WRONG

```java
log.info("AI said: " + prompt + " -> " + rawResponse);
```

Prompt thô (PII) và response không làm đỏ (unredacted) trong stdout, không truy vấn được, không có key id, không có phiên bản model, không có chi phí.

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

Mọi quyết định đều truy vấn được: "toàn bộ lời gọi dùng key của tenant-42 trên model `claude-sonnet-4-5` giữa hai mốc thời gian", latency p95, chi phí mỗi provider. Nếu khách hàng khiếu nại một lệnh chặn, ta có thể replay đúng model + hash prompt + verdict đã tạo ra nó.

## Luồng Kafka từ đầu đến cuối

1. `tx.risk` phát ra `TxEvent` với `eventId` do platform sinh.
2. Consumer (trong `infrastructure/kafka`) chuyển nó vào `AiUseCase` trong `domain/`.
3. `AiUseCase` kiểm tra `OutcomeStore` theo `eventId` (dedup) và gọi `AiClassifier` qua resilient port.
4. `AnthropicModelAdapter` (hoặc OpenAI/Bedrock — đổi theo `AiProperties.provider`) resolve key BYOK từ Vault cho tenant đó.
5. Verdict được lưu trong `OutcomeStore` (TTL ngắn) và `OpenSearchDecisionAudit` (dài hạn).
6. Kết quả đã làm giàu đi tới `tx.decisions`, nơi các luật xác định và sự duyệt của con người — *không phải model* — quyết định hành động tiền.

## Vẫn còn những gì khó

- **Khóa chặt prompt templates.** Prompt drift nhỏ cũng đổi verdict; chúng tôi đánh phiên bản prompt và ghi hash vào dòng audit để verdict có thể tái hiện được.
- **Chi phí bùng nổ.** Prompt ngữ cảnh dài và retry nhân số token; thư viện giới hạn `maxTokens` và theo dõi chi phí theo `eventId` trong OpenSearch.
- **Xoay vòng BYOK.** Tenant xoay key qua Vault; vì key chỉ là reference, việc xoay vòng không bao giờ gây deploy hay thay đổi code.

Thư viện nằm trong <https://github.com/finpay-lab/platform> — cả các port ở domain và các adapter ở infrastructure đều nằm đó, nên guardrails chỉ cách bất kỳ service nào một dependency.

Repo: <https://github.com/finpay-lab/platform>
