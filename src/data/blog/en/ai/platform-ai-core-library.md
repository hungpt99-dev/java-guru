---
title: "AI-8 Shared ai-core Library (BYOK, retry, audit)"
description: "FinPay platform AI integration: platform-ai-core-library."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/platform>

## Why a shared AI library

Every FinPay team was rolling its own LLM integration: one team called OpenAI directly from a controller, another baked the API key into `application.yml`, a third retried failures by throwing the event back into the dead-letter queue with no timeout. Three services, three different `JsonObject` parsings, zero shared telemetry, and an audit trail that was basically `logger.info("done")`.

We shipped `platform-ai-core-library` to make AI usage boring, safe, and observable across the platform. It is a Spring Boot module built around hexagonal architecture — `domain/` holds the ports and use cases, `infrastructure/` holds the adapters (Kafka, model providers, OpenSearch, Vault). The repository link is at the bottom too: <https://github.com/finpay-lab/platform>.

## Guardrails, non-negotiable

Before any code, the rules that shape everything:

1. **AI is not a money decider.** An LLM output can *enrich* a decision — a fraud score, a suggested limit, a risk label — but the decision to move or block money is taken by deterministic rules and humans. The library never returns "approve/reject"; it returns a scored, labeled, auditable observation.
2. **Idempotent by `eventId`.** Every AI call is keyed by a caller-supplied `eventId`. Redelivery, retry, double-click — one event produces exactly one decision.
3. **Timeout, retry, circuit breaker.** No unbounded blocking on an HTTP call. TimeLimit, bounded retries with backoff, and a circuit breaker that degrades gracefully instead of hammering a failing provider.
4. **BYOK — the key never lives in our code or logs.** Each tenant brings its own key (`BYOK`), held in Vault/secret manager, resolved by reference, rotated, and *never* serialized into logs, traces, or audit records.
5. **Audit every decision.** Prompt hash, model, latency, cost, key id, verdict — persisted to OpenSearch for queryable forensics.

## Architecture in one picture

```
                 ┌────────────────────────── domain/ (ports) ──────────────────────────┐
  Kafka ──► Consumer ──► AiUseCase ──► AiClassifier      OutcomeStore     DecisionAudit
  tx.risk      │            │              ▲                   ▲                ▲
               │            │              │ adapters          │ adapters       │ adapter
               ▼            ▼              │                   │                │
          infrastructure/ ─┼───────────────┴───────────────────┴────────────────┘
                 │
                 ├── ModelProviderAdapter (OpenAI / Anthropic / Bedrock)
                 ├── RedisOutcomeStore            (dedup + short TTL)
                 ├── OpenSearchDecisionAudit      (long-term forensics)
                 └── VaultCredentialResolver      (BYOK by reference)
```

The use case in `domain/` depends only on ports. Swapping OpenAI for Bedrock is a one-file adapter change.

## WRONG then RIGHT: credentials (BYOK)

### WRONG

```java
// Hardcoded key — committed to git, copied into tickets, forever.
public class MoneyFairyService {
    private static final String OPENAI_KEY = "sk-proj-abc123...";

    public String label(String text) {
        OpenAIClient client = new OpenAIClient(OPENAI_KEY);
        // Worse: logging the key so "debugging is easier"
        log.info("Calling provider with key={}", OPENAI_KEY);
        return client.complete(systemPrompt + text);
    }
}
```

What's wrong: the key is in the repo, in classpath scans, in every log line, impossible to rotate without a deploy, and appears in GitHub's secret scanner output for the whole internet.

### RIGHT

```java
// application.yml  (only a reference, never a secret)
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
// domain/ — the port. The use case never sees a key.
public interface CredentialResolver {
    KeyCredentials resolve(String keyRef);
}

public record KeyCredentials(String id, char[] secret) { }
```

```java
// infrastructure/ — the adapter talks to Vault.
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
// infrastructure/ — provider adapter resolves the key in-memory per call and
// never exposes it. char[] and toString() masking keep it out of logs.
@Component
public class AnthropicModelAdapter implements ModelProvider {
    private final CredentialResolver credentials;
    private final AiProperties props;

    public ModelResult complete(AiRequest request) {
        KeyCredentials creds = credentials.resolve(props.keyRef());
        try (AnthropicClient client = new AnthropicClient(creds)) {
            return client.complete(props.model(), request);
        } finally {
            Arrays.fill(creds.secret(), 'x');  // scrub from memory
        }
    }
}
```

The key exists only inside the adapter's scope, as a `char[]` that is scrubbed after the call. Nothing logs it, nothing persists it.

## WRONG then RIGHT: timeout, retry, circuit breaker

### WRONG

```java
public String callLlm(String prompt) throws IOException, InterruptedException {
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofMinutes(30))   // effectively unbounded
            .POST(...)
            .build();
    HttpResponse<String> res = client.send(req, BodyHandlers.ofString());
    if (res.statusCode() == 500) {
        // "retry": just block again, hope it passes
        return callLlm(prompt);
    }
    return res.body();
}
```

What's wrong: a 30-minute thread hold per call, a recursive retry that doubles latency on every failure, no circuit state — when the provider is down we burn the whole thread pool waiting on a dead endpoint.

### RIGHT

```java
@Component
public class ResilientModelPort {
    private final Retry retry;
    private final CircuitBreaker circuitBreaker;
    private final TimeLimiter timeLimiter;

    // Resilience4j: 4s cap, 3 retries with backoff, trip at 50% failures / 10 calls
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

When the breaker is open, the library returns a structured `ModelResult.unavailable()` instead of hanging — the caller can degrade (fall back to a simpler heuristic) because the timeout, not the thread, is what bounds the request.

## WRONG then RIGHT: idempotency by `eventId`

### WRONG

```java
@KafkaListener(topics = "tx.risk", groupId = "ai-classifier")
public void on(TxEvent event) {
    // Redelivery ⇒ duplicate LLM calls, duplicate cost, duplicate audit rows.
    Verdict verdict = ai.classify(event);          // called again on redelivery
    outcomeRepository.save(verdict);               // duplicate rows, no dedup
    audit.log("classified", event.id(), verdict);  // noisy, non-idempotent
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

`OutcomeStore` keeps the pair `eventId → verdict` in Redis with a TTL that covers the Kafka redelivery window; `DecisionAudit` writes the long-term record to OpenSearch once, keyed by `eventId` as `_id` so a duplicated write is a no-op on the same shard.

## WRONG then RIGHT: auditing the decision

### WRONG

```java
log.info("AI said: " + prompt + " -> " + rawResponse);
```

Raw prompts (PII) and unredacted responses in stdout, unsearchable, no key id, no model version, no cost.

### RIGHT

```java
public record AuditRecord(
        String eventId,
        Instant decidedAt,
        String tenantId,
        String model,
        String promptSha256,     // hash, never the prompt itself
        String verdict,
        String providerKeyId,    // id only — the BYOK reference, never the secret
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
        // eventId as _id ⇒ writes are idempotent on redelivery
        IndexRequest req = new IndexRequest("ai-decisions").id(r.eventId())
                .source(toJson(r), XContentType.JSON);
        opensearchClient.index(req, RequestOptions.DEFAULT);
    }
}
```

Every decision is queryable: "all calls using tenant-42's key on model `claude-sonnet-4-5` between two timestamps", latency p95, cost per provider. If a customer disputes a block, we can replay the exact model + prompt hash + verdict that produced it.

## The Kafka flow end to end

1. `tx.risk` emits a `TxEvent` with a platform-generated `eventId`.
2. The consumer (in `infrastructure/kafka`) passes it into the `AiUseCase` in `domain/`.
3. `AiUseCase` checks `OutcomeStore` for the `eventId` (dedup) and calls `AiClassifier` through the resilient port.
4. The `AnthropicModelAdapter` (or OpenAI/Bedrock — swapped by `AiProperties.provider`) resolves the BYOK key from Vault for that tenant.
5. The verdict is stored in `OutcomeStore` (short TTL) and `OpenSearchDecisionAudit` (long term).
6. The enriched result goes to `tx.decisions` where deterministic rules and human review — *not the model* — decide the money action.

## What's still hard

- **Pinning prompt templates.** Small prompt drift changes verdicts; we version prompts and record the hash in the audit row so a verdict is reproducible.
- **Cost explosion.** Long-context calls and retries multiply token spend; the library caps `maxTokens` and tracks cost per `eventId` in OpenSearch.
- **BYOK rotation.** Tenants rotate keys via Vault; because keys are references, rotation never triggers a deploy or a code change.

The library is part of <https://github.com/finpay-lab/platform> — both the domain ports and the infrastructure adapters live there, so the guardrails are one dependency away from any service.

Repo: <https://github.com/finpay-lab/platform>
