---
title: "Designing Safe LLM-Generated Payment Notifications"
description: "A practical design for using an LLM to write notification copy without letting it change payment facts, block delivery, or leak credentials."
pubDatetime: 2026-08-15T10:00:00+07:00
tags:
  - java
  - ai
  - fintech
  - architecture
draft: false
featured: false
---

> Repository: <https://github.com/finpay-lab/notification-service>

## The problem

Payment notifications have two different requirements. They must state the transaction accurately, and they must be readable in SMS, email, or push form. A fixed template is reliable but tends to multiply as product and legal requirements diverge. An LLM can vary the wording, but it introduces a more serious risk: the model may change a fact while trying to make the message sound natural.

This article separates those responsibilities. The domain owns validated payment facts and delivery decisions. The LLM may propose wording only. The design also covers event idempotency, structured output, timeout and retry behavior, fallback templates, tenant-supplied provider keys, and audit records.

> **[SOURCE FACT]** The supplied example uses `notification-service`, a Kafka consumer, Spring Boot, a hexagonal layout, an LLM adapter, an OpenSearch adapter, and a repository at the URL above. The diagrams and code below describe that shape; configuration values are examples from the source article, not universal defaults.

## Start with the unsafe design

Passing a raw event payload to a model and returning an untyped string leaves every important boundary implicit:

```java
// PROPOSED DESIGN: deliberately unsafe example; do not ship it
@Service
public class CopyService {
    private final LlmClient llm;

    public String copyFor(NotificationEvent event) {
        String prompt = """
            Write a friendly Vietnamese push notification about this event:
            %s
            """.formatted(event.rawPayload());
        return llm.complete(prompt); // no timeout, retry policy, or schema
    }
}
```

There are five independent failures:

1. **Facts are not protected.** Nothing requires the output to preserve the exact amount. The source example uses `2,431,876 VND`; changing that to `2.4M` would be a correctness and potentially a compliance problem.
2. **The output has no contract.** A push sender may require `{ title, body, tone }`, but this method returns an arbitrary string.
3. **The dependency has no failure policy.** Without a timeout, a slow provider can hold a request. Without bounded retry and a circuit breaker (a mechanism that temporarily stops calls to a failing dependency), provider degradation can spread to notification delivery.
4. **The model is given too much authority.** It could introduce an amount due, refund, or charge that is absent from the event.
5. **The operation is not idempotent.** Reprocessing one event can create different copy and duplicate delivery unless the pipeline has a stable event key and a deduplication policy.

These are design failures, not prompt-quality problems. They need enforcement at the application boundaries.

## Proposed architecture

```text
                     +-------------------------------------------+
Kafka topic -------->|          notification-service              |
 event.payment       |                                             |
                     |  +-----------+       +------------------+   |
                     |  | domain/   |<----->| infrastructure/  |   |
                     |  | (ports)   |       | (adapters)       |   |
                     |  +-----+-----+       +--------+---------+   |
                     |        |                     |             |
                     | idempotency store            | LLM provider |
                     | (eventId dedupe)              | (BYOK client)|
                     |                               | OpenSearch   |
                     +-------------------------------------------+
```

Spring Boot consumes the Kafka topic. In the proposed hexagonal architecture, domain code exposes ports (interfaces), while Kafka, the LLM provider, OpenSearch, and persistence are infrastructure adapters. The domain does not import a provider SDK. That keeps payment rules testable without network access.

```text
src/main/java/dev/finpay/notifications/
|- domain/
|  |- port/
|  |  |- CopyGenerator.java
|  |  |- DedupStore.java
|  |  `- AuditLog.java
|  |- model/
|  |  |- NotificationEvent.java
|  |  |- GeneratedCopy.java
|  |  `- Decision.java
|  `- service/
|     `- CopyPipeline.java
`- infrastructure/
   |- kafka/
   |- llm/
   |- opensearch/
   `- store/
```

The pipeline should be deterministic about facts and delivery state. Only the wording is allowed to vary.

## Step 1: canonicalize the event

> **[PROPOSED DESIGN]** Convert the wire event into a typed, validated fact set before calling the model. This object is the contract that generated copy cannot override.

```java
public record PaymentSettled(
    String eventId,
    String userId,
    BigDecimal amountPaid,
    String currency,
    LocalDateTime settledAt
) {
    public PaymentSettled {
        Objects.requireNonNull(eventId, "eventId is required");
        if (amountPaid == null || amountPaid.signum() <= 0)
            throw new IllegalArgumentException("amountPaid must be positive");
        if (currency == null || currency.isBlank())
            throw new IllegalArgumentException("currency is required");
    }
}
```

The Kafka adapter maps wire JSON to `PaymentSettled` in `infrastructure/kafka/`. The domain pipeline sees only the domain record. If the topic schema changes, the adapter changes; the domain does not have to know about that wire format.

## Step 2: claim the event once

Kafka delivery is at least once, so a consumer must be prepared to see the same event again. The pipeline should claim `eventId` before making an external call and release the claim when processing fails.

```java
@Transactional
public Decision decide(PaymentSettled event) {
    if (dedupStore.alreadyProcessed(event.eventId()))
        return Decision.replay(event.eventId());

    dedupStore.claim(event.eventId(), leaseTtlMinutes);
    try {
        GeneratedCopy copy = copyGenerator.generate(event);
        Decision decision = Decision.accepted(event.eventId(), copy, now());
        auditLog.record(decision);
        return decision;
    } catch (Throwable t) {
        dedupStore.release(event.eventId());
        Decision decision = Decision.failed(event.eventId(), reason(t), now());
        auditLog.record(decision);
        return decision;
    }
}
```

The important properties are:

- The claim is keyed by `eventId`, and replay detection happens before the external call.
- A failed attempt releases the claim so the Kafka consumer can redeliver it. Retry count and backoff belong at the consumer boundary, not in a second loop inside this pipeline.
- Accepted, failed, and replay decisions are all auditable.

## Step 3: use an idempotency key for the provider request

Event deduplication does not cover a network ambiguity. A request can time out locally after the provider has completed it. A stable provider request key lets a retry refer to the same operation, when the provider supports request idempotency.

```java
String idempotencyKey = "copy:" + event.eventId();

var request = CopyRequest.builder()
    .idempotencyKey(idempotencyKey)
    .model(providerModel)
    .messages(List.of(systemPrompt(), userMessage(event)))
    .responseFormat(JSON_OBJECT)
    .build();
```

The same event produces the same key. Together with the deduplication store, this makes the copy-generation path idempotent end to end. The provider's exact idempotency behavior remains an adapter concern and must be verified against its API contract.

## Step 4: facts in, JSON out

> **[PROPOSED DESIGN]** Treat the system prompt as part of the application contract, not as a request for good intentions. Supply the exact facts, prohibit invented values, and make clear that the model cannot decide money.

```java
String systemPrompt = """
    You write notification copy for a fintech app. The recipient is the customer.

    HARD RULES:
    1. Use only facts in the user message. Never invent, round, or correct numbers.
       Never imply a balance, refund, or charge that is not in the facts.
    2. Reproduce monetary values exactly.
    3. Return valid JSON matching the schema. Do not return markdown.
    4. Tone: warm and concise, in Vietnamese. Body limit: 160 characters.
    5. If the facts are insufficient, return {"error":"unsatisfiable"}.
    """;
```

The adapter validates the response before it can reach a sender:

```java
public record GeneratedCopy(
    String title,
    String body,
    Tone tone,
    String model,
    String rawModelOutput
) {
    public enum Tone { NEUTRAL, URGENT, CELEBRATORY }
}
```

Jackson can deserialize this contract in `infrastructure/`. A schema or enum violation fails at the adapter boundary. `rawModelOutput` is retained for audit and is never shown to the customer.

## Step 5: timeout, retry, circuit breaker, fallback

An LLM is a downstream dependency. Give it an explicit timeout and isolate it with a circuit breaker. The values below are source values from the original article; in a real service they belong in configuration and must be chosen from latency and delivery requirements.

```java
@Bean
public RestClient llmClient(LlmProperties props) {
    return RestClient.builder()
        .baseUrl(props.baseUrl())
        .requestFactory(ClientHttpRequestFactories.get(
            ClientHttpRequestFactorySettings.defaults()
                .withConnectTimeout(props.connectTimeout()) // source: 2s
                .withReadTimeout(props.readTimeout())))     // source: 10s
        .build();
}

@Bean
public CircuitBreaker llmBreaker(CircuitBreakerConfigProps props) {
    return CircuitBreaker.of("llm", props.toConfig()); // source example: 60%
}
```

```java
public Optional<GeneratedCopy> generate(PaymentSettled event) {
    return Try.ofSupplier(() ->
        circuitBreaker.executeSupplier(() ->
            llmClient.post()
                .uri("/chat/completions")
                .body(requestFor(event))
                .retrieve()
                .body(LlmResponse.class)
                .toGeneratedCopy()))
        .recover(TimeoutException.class, e -> fallbackCopy(event))
        .recover(CallNotPermittedException.class, e -> fallbackCopy(event))
        .recover(e -> {
            auditLog.record(Decision.failed(event.eventId(), describe(e), now()));
            return null;
        })
        .toJavaOptional();
}
```

The responsibilities are intentionally separate:

- **Timeout:** the sender thread is not held indefinitely by the provider.
- **Retry:** the Kafka consumer applies bounded attempts and backoff. The copy pipeline does not loop.
- **Circuit breaker:** when the provider is failing, use a human-approved template populated from the same validated facts.

The fallback is not a second source of payment truth. It is a lower-variance presentation path. If no safe copy can be produced, record the failure and let the consumer's delivery policy handle it.

## Step 6: BYOK without credential leakage

> **[PROPOSED DESIGN]** A tenant-supplied provider key should arrive encrypted, be decrypted at the adapter boundary, and never be hardcoded, logged, or placed in a stack trace.

```java
@Service
public class ByokVault {
    public SecretKey keyFor(String tenantId) {
        return vault.readSecret(Path.of("byok", tenantId));
    }
}
```

The adapter attaches the key to the authorization header for the request and discards it afterward. Request logging must remove credential fields through a filter for the LLM DTOs. Tests should assert that keys do not appear in prompts, logs, or exceptions. Logging even a partial key is unnecessary; log a tenant identifier or request identifier instead.

## Step 7: audit every decision

The `AuditLog` port can write accepted, failed, and replay decisions to OpenSearch through an infrastructure adapter.

```java
public record AuditRecord(
    String eventId,
    String userId,
    String decision,       // ACCEPTED | FAILED | REPLAY
    String copyTitle,
    String copyBody,
    String model,
    String rawModelOutput,
    Instant occurredAt
) {}
```

> **[SOURCE FACT]** The original article specifies OpenSearch, `search_after` pagination, per-index date rollover, and 90 days of hot retention followed by cold storage. Those are implementation choices, not general requirements. They support forensic queries such as finding generated copy for a given time range and amount range, together with the verbatim model output.

Audit data also needs access control, retention controls, and a decision about whether raw output may contain personal data. The audit trail is useful only if it is searchable and safe to inspect.

## Guardrails at a glance

| Guardrail | Mechanism |
| --- | --- |
| The model does not decide money | Validated facts, constrained prompt, schema validation, fallback templates |
| Idempotency by `eventId` | Dedup store, claim/release, provider request key |
| Bounded downstream failure | Connect/read timeout, consumer retry, circuit breaker |
| BYOK key is not exposed | Secret store, adapter-only access, credential filtering |
| Every decision is auditable | OpenSearch `AuditRecord` or an equivalent search-oriented store |

## Engineering takeaways

1. **Treat the prompt as code.** Version it, review it, and test the `unsatisfiable` path and the no-invented-numbers rule.
2. **Make facts deterministic.** Customer-facing wording may vary; every monetary digit comes from the domain.
3. **Keep a real fallback.** A human-approved template is a reliability mechanism, not an embarrassing concession.
4. **Audit behavior instead of predicting it.** Recorded output supports investigation when model behavior or prompts change.
5. **Use one stable event key.** `eventId` connects consumer deduplication, provider request idempotency, and audit records.

The repository is <https://github.com/finpay-lab/notification-service>. The central design rule is simple: the LLM may choose words, but it does not own facts, money, delivery state, or credentials.
