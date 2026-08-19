---
title: "A Shared AI Core Library for Microservices"
description: "A practical design for shared LLM integration with BYOK credentials, resilience controls, idempotency, and auditable outcomes."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

Repo referenced by the source material: <https://github.com/finpay-lab/platform>

## The problem

Adding an LLM call to one service is straightforward. Operating that call consistently across a microservice fleet is not. The integration needs credential isolation, bounded failure handling, duplicate-event protection, and an audit record that is useful after the fact.

**[SOURCE FACT]** The source article describes three services with three different integration patterns: direct provider calls from a controller, an API key in `application.yml`, and a retry strategy that sends a failed event back to a dead-letter queue without a timeout. It also describes inconsistent `JsonObject` parsing, no shared telemetry, and an audit trail reduced to a `logger.info("done")` message.

**[ANALYSIS]** Those are not separate LLM problems. They are platform concerns. A shared Spring Boot module can provide one contract for provider calls, credential lookup, resilience, deduplication, and decision auditing while leaving business-specific policy in the calling service.

This article covers that boundary. It does not treat an LLM as a money-movement authority, and it does not claim that the implementation below is a complete production library.

## Guardrails

These are the non-negotiable rules in the proposed design:

1. **AI is not the money decision-maker.** An LLM may enrich a deterministic or human decision with a fraud score, a suggested limit, or a risk label. The rule engine or an authorized person decides whether money is moved or blocked. The library therefore returns a scored, labeled, auditable observation rather than an `approve`/`reject` command.
2. **Use caller-supplied `eventId` for idempotency.** Redelivery, a retry, or a double-click must not create another outcome for the same event. The library should make this an explicit contract, backed by an atomic claim in the outcome store.
3. **Bound every provider call.** A timeout, bounded retries with backoff, and a circuit breaker prevent a failing provider from consuming the caller's resources indefinitely. These controls are complementary: a timeout bounds one attempt, retry handles selected transient failures, and the circuit breaker stops calls when failure is persistent.
4. **Use BYOK without exposing secrets.** Each tenant supplies its own key. The key is kept in Vault or another secret manager, resolved by reference, rotated there, and excluded from logs, traces, and audit records.
5. **Audit the result, not the secret.** Persist the prompt hash, model, latency, cost, key ID, and verdict to OpenSearch so the result can be queried for forensic analysis without storing the prompt or API key itself.

## Architecture

**[PROPOSED DESIGN]** Keep the use case in `domain/` dependent on ports only. Put Kafka, model providers, Redis, OpenSearch, and Vault integrations in `infrastructure/` adapters.

```text
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

The use case knows only the ports. Replacing one model provider with another should therefore be an adapter change, not a change to domain policy. That is a design goal, not a claim about a particular repository implementation.

## Credentials: wrong and right

### Wrong

```java
// Hardcoded key: it can be committed, copied into tickets, and logged.
public class MoneyFairyService {
    private static final String OPENAI_KEY = "«redacted:sk-…»...";

    public String label(String text) {
        OpenAIClient client = new OpenAIClient(OPENAI_KEY);
        log.info("Calling provider with key={}", OPENAI_KEY);
        return client.complete(systemPrompt + text);
    }
}
```

The key is now part of the repository and process configuration, cannot be rotated independently of deployment, and is exposed by the log statement. Secret scanners can also retain a finding after the key has been removed from the working tree. The practical response is rotation and removal from history, not merely deleting the line.

### Right

**[PROPOSED DESIGN]** Store a reference in configuration. Resolve the secret only at the provider boundary.

```yaml
# application.yml: a reference, never the secret itself
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
// domain/: the use case never receives a key.
public interface CredentialResolver {
    KeyCredentials resolve(String keyRef);
}

public record KeyCredentials(String id, char[] secret) { }
```

```java
// infrastructure/: the adapter talks to Vault.
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
// infrastructure/: resolve in memory for one call and never expose the key.
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

The example keeps the secret inside the adapter's scope as a `char[]` and scrubs that array after the call. This reduces accidental exposure; it is not a guarantee against every memory-disclosure mechanism. The key ID may be audited, but the key material must not be.

## Resilience: wrong and right

### Wrong

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

This holds a thread for up to 30 minutes, retries recursively without a bound, and has no circuit state. If the provider remains unavailable, callers keep spending resources on the same failing endpoint.

### Right

**[PROPOSED DESIGN]** Apply resilience at the provider port. The exact library configuration is implementation-specific, but the behavior should be explicit:

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

Configure the HTTP client with a finite timeout such as the `4s` value shown above. Retry only failures that are safe and likely to be transient, cap the retry count, and use backoff. Do not retry validation errors, authentication failures, or a request whose side effects cannot be made idempotent. A circuit breaker should fail fast while the provider is unhealthy; the caller can then choose a fallback, defer the event, or record an unavailable outcome.

The fallback is part of the use-case contract, not an excuse to invent an AI result. A safe fallback can preserve the event for later processing or return an explicit `UNAVAILABLE` status to deterministic business logic.

## Idempotency and audit boundary

**[PROPOSED DESIGN]** The consumer passes `eventId` into the use case. The use case attempts an atomic claim in `RedisOutcomeStore` before calling the provider. If the event was already completed, return the stored outcome. If it is in progress, apply the consumer's defined redelivery behavior rather than starting a second provider call.

Redis is shown for deduplication with a short TTL. The long-term record belongs in `OpenSearchDecisionAudit`. The audit document should contain fields such as:

```text
eventId, promptHash, model, latency, cost, keyId, verdict
```

These fields are the audit contract described by the source material. Retention, index mappings, cost calculation, and the exact verdict vocabulary still need to be defined by the owning platform team. In particular, `eventId` uniqueness must be scoped deliberately if multiple tenants or event domains can reuse the same value.

## What this buys you

The value of a shared core library is a narrow, enforceable boundary:

- business services submit an AI request through a stable use-case API;
- provider credentials stay behind a resolver and adapter;
- timeouts and bounded retries are applied consistently;
- duplicate events can be recognized before another provider call;
- audit records describe what happened without containing the secret.

That boundary makes AI integration less dependent on individual service conventions. It does not remove the need for provider-specific testing, access controls, retention policy, or a deterministic decision process outside the library.
