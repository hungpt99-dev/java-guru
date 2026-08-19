---
title: 'AI-3 Ledger and Kafka Anomaly Detection to Prometheus'
description: 'FinPay ledger-service AI integration: ledger-anomaly-detection.'
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

> **Repository:** https://github.com/finpay-lab/ledger-service

# AI-3: Ledger and Kafka Anomaly Detection to Prometheus

A ledger is the last place you want an LLM to make decisions. This post is about how FinPay's `ledger-service` integrates AI without giving it the keys to the money room: we feed Kafka ledger events to an anomaly scorer, export the verdicts to Prometheus, and keep every AI touchpoint behind guardrails, ports, and a paper trail.

## 1. The problem

`ledger-service` is a Spring Boot service that double-posts every payment (`debit`/`credit`) in a single database transaction, streams those events to Kafka (`ledger.events`), and exposes them for search in OpenSearch. The business asked for an early-warning system: *"flag suspicious ledger patterns the moment they land, before reconciliation, before the batch job at 2 AM."*

We evaluated a few signal sources — deterministic rules first, then a statistical baseline, and finally an LLM scorer on top. The product decision was:

> AI should never decide a money outcome. It produces a *signal*; humans and deterministic policy make the *decision*.

Everything below is the architecture that makes that sentence true in production.

## 2. The money path is sacred

The core invariant of the service:

```java
// application/PostingService.java — money path, 3-15ms, one DB transaction.
@Transactional
public void post(LedgerCommand cmd) {
    ledger.entry(new Entry(cmd.eventId(), DEBIT,  cmd.partyId(), cmd.amount()));
    ledger.entry(new Entry(cmd.eventId(), CREDIT, cmd.counterparty(), cmd.amount()));
}
```

Any work we add on top of this path competes for the same DB transaction, the same connection, the same row locks. The first (naive) AI integration we wrote — shown below, and only to illustrate what *not* to do — violated every one of those constraints.

## 3. WRONG: the naive synchronous integration

```java
// WRONG — never do this. AI inline on the money path, key hardcoded, no guardrails.
public class PaymentProcessor {

    private static final String OPENAI_API_KEY = "sk-proj-..."; // !! hardcoded secret

    private static final String PROMPT = """
        You are a payments fraud expert.
        Amount %.2f, party %s, counterparty %s.
        Answer exactly YES or NO: is this suspicious?
        """;

    @Transactional
    public void postLedger(PaymentEvent event) {
        ledger.post(debit(event), credit(event)); // 1. money path first — but then we block

        // 2. !! synchronous LLM call INSIDE the DB transaction, no timeout, no breaker
        String answer = openAiClient.ask(String.format(PROMPT,
                event.amount(), event.partyId(), event.counterparty()), OPENAI_API_KEY);

        // 3. !! the LLM implicitly becomes a money decider — it freezes funds
        if ("YES".equals(answer)) {
            fundsService.hold(event.eventId());
        }

        // 4. !! retries happen synchronously: 5 attempts x 3s = 15s of held row locks
        auditRepo.save(new AuditRow(event.eventId(), answer)); // and audit rides the money tx
    }
}
```

What's wrong here, in order of severity:

- **The LLM is on the money path.** The DB transaction stays open while we wait on a third-party API. A 2-second LLM p95 becomes 2 seconds of held row locks, connection-pool exhaustion, and a slower ledger for everyone.
- **No timeout, no circuit breaker, no degradation.** When OpenAI is down, the ledger is down with it. A monitoring AI must never become a second point of failure.
- **The key is hardcoded.** It will be committed, scanned by secret scanners, rotated, and leaked. It also means every deploy ships the same static credential — the opposite of BYOK (Bring Your Own Key).
- **AI silently decides money.** `fundsService.hold(...)` fires with no deterministic override and no human step. There is no separation between "signal" and "decision".
- **No idempotency.** Kafka is at-least-once; a redelivery posts the entry twice and calls `hold` twice. Replays become financial bugs.
- **Audit rides the money transaction.** If the LLM hangs, the audit never writes. The paper trail disappears exactly when something goes wrong.

## 4. The guardrails we commit to

Before writing any "RIGHT" code, we wrote down the rules that shape it. These are product-level, not code-level:

1. **AI is not a money decider.** It emits a signal; a separate deterministic policy and a human approval flow own the money outcome.
2. **Idempotent by `eventId`.** Every consumer, every store, every external side effect must be safe to replay.
3. **Timeout -> retry -> circuit breaker**, in that order, and a deterministic fallback so an AI outage degrades, never blocks.
4. **BYOK, key never hardcoded or logged.** The key is injected at runtime from a secret store; any accidental log output is redacted.
5. **Audit every decision.** Each score is a versioned, append-only record with the input evidence, model, verdict, and timestamp.
6. **The AI path is fully instrumented.** Latency, failures, and anomaly rate go to Prometheus so we can alert on the monitor itself.

## 5. RIGHT: hexagonal ports, adapters live in infrastructure

We split the codebase along hexagonal boundaries. The `domain/` owns models and **ports** (interfaces). `infrastructure/` owns **adapters** (Kafka, OpenAI, OpenSearch, Micrometer). The domain core knows nothing about HTTP, JSON, Kafka, or AI SDKs — which is what makes the fallback, the tests, and the replacement story trivial.

```
com.finpay.ledger
├── domain/
│   ├── model/              # LedgerEvent, AnomalyScore, AnomalyRecord
│   └── port/               # AnomalyScorer, AnomalyStore, AuditTrail   <- ports (pure)
├── application/            # orchestration: PostingService, DetectAnomalyService
└── infrastructure/
    ├── kafka/              # LedgerEventListener (adapter)
    ├── ai/                 # OpenAiAnomalyScorer, RuleBasedScorer (adapters)
    ├── opensearch/         # OpenSearchAnomalyStore (adapter)
    ├── audit/              # AuditTrailImpl (adapter)
    └── metrics/            # Prometheus registration (adapter)
```

The ports:

```java
// domain/port/AnomalyScorer.java
package com.finpay.ledger.domain.port;

import com.finpay.ledger.domain.model.AnomalyScore;
import com.finpay.ledger.domain.model.LedgerEvent;

public interface AnomalyScorer {
    AnomalyScore score(LedgerEvent event);
}

// domain/port/AnomalyStore.java
package com.finpay.ledger.domain.port;

import com.finpay.ledger.domain.model.AnomalyRecord;

public interface AnomalyStore {
    boolean exists(String eventId);
    void save(AnomalyRecord record);
}

// domain/port/AuditTrail.java
package com.finpay.ledger.domain.port;

import com.finpay.ledger.domain.model.AnomalyScore;

public interface AuditTrail {
    void record(String action, String eventId, AnomalyScore score);
}
```

And the models the domain returns — notice `UNKNOWN` is a first-class verdict:

```java
// domain/model/AnomalyScore.java
package com.finpay.ledger.domain.model;

public record AnomalyScore(
        double value,                 // 0.0 .. 1.0
        String verdict,               // OK | SUSPICIOUS | UNKNOWN
        String reason,                // "amount_spike" | "velocity" | ...
        String provider,              // "openai" | "rule-based" | "fallback"
        long decidedAtEpochMs
) {
    public static AnomalyScore unknown(String reason) {
        return new AnomalyScore(0.5, "UNKNOWN", reason, "fallback", System.currentTimeMillis());
    }
}

// domain/model/AnomalyRecord.java
package com.finpay.ledger.domain.model;

public record AnomalyRecord(String eventId, LedgerEvent event, AnomalyScore score) {
    public static AnomalyRecord of(LedgerEvent event, AnomalyScore score) {
        return new AnomalyRecord(event.eventId(), event, score);
    }
}
```

## 6. RIGHT: consume Kafka, stay off the money path

The AI feature never sits on the `PostingService` transaction. A dedicated consumer group reads `ledger.events`, scores asynchronously, and only touches *metric and audit* sinks. The money path stays 3-15 ms and knows nothing about AI.

```java
// infrastructure/kafka/LedgerEventListener.java
package com.finpay.ledger.infrastructure.kafka;

import com.finpay.ledger.domain.model.AnomalyScore;
import com.finpay.ledger.domain.model.LedgerEvent;
import com.finpay.ledger.domain.port.AnomalyScorer;
import com.finpay.ledger.domain.port.AnomalyStore;
import com.finpay.ledger.domain.port.AuditTrail;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Slf4j
@Component
public class LedgerEventListener {

    private final AnomalyScorer scorer;
    private final AnomalyStore store;
    private final AuditTrail audit;
    private final MeterRegistry registry;

    public LedgerEventListener(AnomalyScorer scorer, AnomalyStore store,
                               AuditTrail audit, MeterRegistry registry) {
        this.scorer = scorer;
        this.store = store;
        this.audit = audit;
        this.registry = registry;
    }

    @KafkaListener(topics = "ledger.events", groupId = "ai-anomaly-detection")
    public void onLedgerEvent(LedgerEvent event) {
        // Guardrail #2: idempotent by eventId — at-least-once delivery is replay-safe.
        if (store.exists(event.eventId())) {
            log.info("skipped duplicate event {}", event.eventId());
            return;
        }

        var sample = Timer.start(registry);
        AnomalyScore score = scorer.score(event);
        sample.stop(registry.timer("ledger_anomaly_score_duration_seconds"));

        // Guardrail #5: audit every decision, evidence included.
        audit.record("SCORE", event.eventId(), score);

        // Guardrail #1: AI is NOT a money decider. We only emit a signal.
        if ("SUSPICIOUS".equals(score.verdict())) {
            Counter.builder("ledger_anomaly_detected_total")
                    .tag("reason", score.reason())
                    .tag("provider", score.provider())
                    .register(registry)
                    .increment();
        }

        // Guardrail #6: watch the monitor — an unhealthy AI scorer is itself an incident.
        if ("UNKNOWN".equals(score.verdict())) {
            Counter.builder("ledger_anomaly_scorer_failures_total")
                    .tag("reason", score.reason())
                    .register(registry)
                    .increment();
        }

        // Persist signal for analysts; OpenSearch is also our replay log.
        store.save(AnomalyRecord.of(event, score));
    }
}
```

The consumer is in a consumer group, so we scale horizontally. Because Kafka gives at-least-once, the `eventId` check is not optional.

## 7. Idempotency by eventId

Idempotency is enforced in three places: the dedup check, a deterministic document id in the store, and a Kafka dead-letter topic for poison events.

```java
// infrastructure/opensearch/OpenSearchAnomalyStore.java
package com.finpay.ledger.infrastructure.opensearch;

import com.finpay.ledger.domain.model.AnomalyRecord;
import com.finpay.ledger.domain.port.AnomalyStore;
import lombok.extern.slf4j.Slf4j;
import org.opensearch.client.opensearch.OpenSearchClient;
import org.springframework.stereotype.Component;

@Slf4j
@Component
public class OpenSearchAnomalyStore implements AnomalyStore {

    private final OpenSearchClient client;

    public OpenSearchAnomalyStore(OpenSearchClient client) {
        this.client = client;
    }

    @Override
    public boolean exists(String eventId) {
        try {
            return client.exists(r -> r.index("ledger-anomalies").id(eventId)).value();
        } catch (Exception e) {
            log.warn("exists() failed for {} -> fail-open", eventId, e);
            return false; // fail-open: keep the pipeline moving; audit reveals duplicates
        }
    }

    @Override
    public void save(AnomalyRecord record) {
        client.index(i -> i.index("ledger-anomalies")
                .id(record.eventId())            // deterministic doc id = replays overwrite
                .document(record));
    }
}
```

On repeated processing failure, the record goes to a dead-letter topic instead of blocking the group:

```java
// infrastructure/kafka/LedgerEventListener.java (extension)
@DltHandler
public void onDlt(LedgerEvent event, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
    log.error("poison event {} forwarded to DLT from {}", event.eventId(), topic);
    audit.record("DLT", event.eventId(), AnomalyScore.unknown("poison_event"));
}
```

## 8. Timeout, retry, circuit breaker

Resilience4j gives us the timeout -> retry -> circuit-breaker chain, configured declaratively and kept out of domain code.

```yaml
# application.yml
resilience4j:
  timelimiter:
    instances:
      openai:
        timeout-duration: 2s
  retry:
    instances:
      openai:
        max-attempts: 2
        wait-duration: 500ms
  circuitbreaker:
    instances:
      openai:
        sliding-window-size: 20
        minimum-number-of-calls: 10
        failure-rate-threshold: 50
        wait-duration-in-open-state: 10s
```

The adapter composes them and, on failure, degrades to a deterministic rule scorer — never throws onto the consumer thread, never blocks the pipeline:

```java
// infrastructure/ai/OpenAiAnomalyScorer.java
package com.finpay.ledger.infrastructure.ai;

import com.finpay.ledger.domain.model.AnomalyScore;
import com.finpay.ledger.domain.model.LedgerEvent;
import com.finpay.ledger.domain.port.AnomalyScorer;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryRegistry;
import io.github.resilience4j.timelimiter.TimeLimiter;
import io.github.resilience4j.timelimiter.TimeLimiterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Slf4j
@Component
public class OpenAiAnomalyScorer implements AnomalyScorer {

    private static final String KEY_ENV = "AI_PROVIDER_API_KEY"; // BYOK: injected at runtime

    private final RestClient openAi;
    private final AnomalyScorer fallback;      // deterministic rule scorer
    private final CircuitBreaker circuitBreaker;
    private final Retry retry;
    private final TimeLimiter timeLimiter;
    private final ExecutorService aiExecutor = Executors.newFixedThreadPool(4);

    public OpenAiAnomalyScorer(RestClient.Builder builder,
                               AnomalyScorer fallback,
                               CircuitBreakerRegistry cbRegistry,
                               RetryRegistry retryRegistry,
                               TimeLimiterRegistry tlRegistry) {
        this.openAi = builder.baseUrl("https://api.openai.com/v1").build();
        this.fallback = fallback;
        this.circuitBreaker = cbRegistry.circuitBreaker("openai");
        this.retry = retryRegistry.retry("openai");
        this.timeLimiter = tlRegistry.timeLimiter("openai");
    }

    @Override
    public AnomalyScore score(LedgerEvent event) {
        try {
            // Composition order matters: TimeLimiter inside CircuitBreaker inside Retry.
            var timed = TimeLimiter.decorateFutureSupplier(timeLimiter,
                    () -> CompletableFuture.supplyAsync(() -> callOpenAi(event), aiExecutor));
            var cb = CircuitBreaker.decorateSupplier(circuitBreaker, timed::get);
            var withRetry = Retry.decorateSupplier(retry, cb);
            String body = withRetry.get();
            return AnomalyScore.fromJson(body);
        } catch (Exception e) {
            // Guardrail #3: degrade, never block. An AI outage must not break the ledger.
            log.warn("openai scorer degraded for {}: {}", event.eventId(), e.getMessage());
            return fallback.score(event);
        }
    }

    private String callOpenAi(LedgerEvent event) {
        String key = apiKey();
        // The eventId and model are safe to log; the key is not (Guardrail #4).
        log.info("scoring event {} provider=openai model=gpt-4o-mini", event.eventId());
        return openAi.post()
                .uri("/chat/completions")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + key)
                .body(chatRequest(event))
                .retrieve()
                .body(String.class);
    }

    private String apiKey() {
        String key = System.getenv(KEY_ENV);
        if (key == null || key.isBlank()) {
            throw new IllegalStateException("BYOK env " + KEY_ENV + " not set");
        }
        return key;
    }
}
```

The timeout guard is the most important: without the `TimeLimiter`, a hung OpenAI socket would pin consumer threads indefinitely and inflate Kafka consumer lag.

## 9. BYOK — key never hardcoded, never logged

The key is *brought by the operator*, not shipped by us:

- Set at runtime via `AI_PROVIDER_API_KEY` (from Vault / AWS Secrets Manager / K8s Secret), never in `application.yml`, never in git.
- Read on demand in the adapter (see `apiKey()` above); never stored on a field where a stack trace could print it.
- Redacted in logs. Any accidental print goes through a redactor:

```java
// infrastructure/util/Redactor.java
package com.finpay.ledger.infrastructure.util;

public final class Redactor {
    private Redactor() {}

    public static String key(String raw) {
        if (raw == null || raw.length() < 8) return "***";
        return raw.substring(0, 4) + "..." + raw.substring(raw.length() - 4);
    }
}
```

And a regression test proving the key never hits the log file:

```java
// infrastructure/ai/OpenAiAnomalyScorerTest.java
@Test
void apiKeyIsNeverLogged() {
    String key = "sk-proj-TOP-SECRET-1234";
    OpenAiAnomalyScorer scorer = new OpenAiAnomalyScorer(/* mocks */);

    scorer.score(sampleEvent());

    assertThat(captureLogs())
        .extracting(message -> message)
        .noneMatch(m -> m.contains("sk-proj-"))
        .noneMatch(m -> m.contains(key));
}
```

## 10. Audit every decision

Every score — including every degradation and every duplicate skip — is an append-only, evidence-bearing record in OpenSearch (`ledger-ai-audit`). The audit is **not** optional and **not** coupled to the money transaction:

```java
// infrastructure/audit/AuditTrailImpl.java
package com.finpay.ledger.infrastructure.audit;

import com.finpay.ledger.domain.model.AnomalyScore;
import com.finpay.ledger.domain.port.AuditTrail;
import lombok.extern.slf4j.Slf4j;
import org.opensearch.client.opensearch.OpenSearchClient;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Slf4j
@Component
public class AuditTrailImpl implements AuditTrail {

    private final OpenSearchClient client;

    public AuditTrailImpl(OpenSearchClient client) {
        this.client = client;
    }

    @Override
    public void record(String action, String eventId, AnomalyScore score) {
        AuditEntry entry = new AuditEntry(action, eventId, score, System.currentTimeMillis());
        try {
            client.index(i -> i.index("ledger-ai-audit")
                    .id(UUID.randomUUID().toString())
                    .document(entry));
        } catch (Exception e) {
            log.error("audit write FAILED for {} — failing loudly", eventId, e);
            throw e; // audits are append-only and non-negotiable
        }
    }
}
```

The audit entry carries the input, the model, and the verdict so a human can answer "why did the system flag this?" weeks later:

```java
public record AuditEntry(
        String action,            // SCORE | DLT | DECISION_OVERRIDE
        String eventId,
        AnomalyScore score,       // includes provider + reason + timestamp
        long writtenAtEpochMs
) {}
```

## 11. AI is not a money decider

The detection pipeline only *signals*. The money outcome (hold, block, reject) is owned by a separate, deterministic policy service with a human-approval step. We state it explicitly in code so nobody "helps later":

```java
// application/DetectAnomalyService.java — outcome of AI is a signal, never an action.
public AnomalySignal analyze(LedgerEvent event) {
    AnomalyScore score = scorer.score(event);
    if (!"SUSPICIOUS".equals(score.verdict())) {
        return AnomalySignal.pass(event.eventId());
    }
    // A deterministic rule + human reviewer decides whether money moves.
    return AnomalySignal.refer(event.eventId(), score.reason(),
            DecisionStatus.PENDING_HUMAN_REVIEW);
}
```

## 12. Prometheus and alerting

Micrometer + Spring Boot Actuator expose everything to Prometheus:

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: prometheus,health,info
  prometheus:
    metrics:
      export:
        enabled: true
```

What we monitor, and why:

| Metric | Type | Tells us |
|---|---|---|
| `ledger_anomaly_detected_total{reason,provider}` | Counter | Anomaly rate by reason/provider |
| `ledger_anomaly_scorer_failures_total{reason}` | Counter | AI scorer health (SLO) |
| `ledger_anomaly_score_duration_seconds` | Timer | LLM latency p50/p95/p99 |
| `kafka_consumer_lag` (Kafka exporter) | Gauge | Consumer group health |

Alert rules that fire when the *monitor* itself is unhealthy:

```yaml
# prometheus/alerts/ledger-anomaly.yml
groups:
  - name: ledger-anomaly
    rules:
      - alert: LedgerAnomalySurge
        expr: sum(rate(ledger_anomaly_detected_total[5m])) > 50
        labels: { severity: warning, team: finpay-core }
      - alert: AIScorerDegraded
        expr: sum(rate(ledger_anomaly_scorer_failures_total[5m])) > 0
        for: 10m
        labels: { severity: critical }
```

If `AIScorerDegraded` fires, the fallback rule scorer is carrying the load — exactly what the guardrails designed, and exactly what the on-call needs to know.

## 13. Tests that keep us honest

With the port abstraction, the "AI" is just a pluggable implementation, so tests never touch a real model:

```java
// application/DetectAnomalyServiceTest.java
@Test
void replayIsIdempotentByEventId() {
    AnomalyStore store = new InMemoryAnomalyStore();
    AnomalyScorer fake = event -> AnomalyScore.suspicious("amount_spike", 0.97);
    LedgerEventListener listener = new LedgerEventListener(fake, store, audit, registry);

    listener.onLedgerEvent(event("evt-1"));
    listener.onLedgerEvent(event("evt-1")); // replay from Kafka redelivery

    assertThat(store.calls()).isEqualTo(1); // second delivery is a no-op
}

@Test
void openAiOutageDegradesToRuleScorer() {
    AnomalyScorer flaky = event -> { throw new IllegalStateException("timeout"); };
    AnomalyScorer rule = event -> AnomalyScore.suspicious("velocity", 0.8);

    OpenAiAnomalyScorer scorer = new OpenAiAnomalyScorer(/* flaky upstream */);

    AnomalyScore score = scorer.score(event("evt-2"));

    assertThat(score.provider()).isEqualTo("rule-based");
    assertThat(score.verdict()).isEqualTo("SUSPICIOUS");
}
```

## 14. What we shipped

The production shape is: Kafka events -> async consumer (hexagonal, guarded) -> OpenAI scorer with timeout/retry/circuit breaker -> deterministic fallback -> OpenSearch signal + append-only audit -> Prometheus counters/timers -> alerts on the monitor itself. The money path never waits on AI, a decision is never made by AI, and every decision can be replayed and audited.

If you are wiring an LLM into a ledger, start from the guardrails, not the prompt.

> **Repository:** https://github.com/finpay-lab/ledger-service
