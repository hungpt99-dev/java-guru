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

Sổ cái (ledger) là nơi cuối cùng bạn muốn để một LLM ra quyết định. Bài viết này nói về cách `ledger-service` của FinPay tích hợp AI mà không trao cho nó chìa khóa của "phòng tiền": chúng tôi đưa các sự kiện ledger từ Kafka vào một bộ chấm điểm bất thường (anomaly scorer), xuất các phán quyết ra Prometheus, và giữ mọi điểm chạm AI phía sau guardrail, cổng (port) và một dấu vết giấy tờ (paper trail) đầy đủ.

## 1. Vấn đề

`ledger-service` là một dịch vụ Spring Boot ghi kép (double-entry) mọi giao dịch thanh toán (`debit`/`credit`) trong một transaction duy nhất của DB, stream các sự kiện đó ra Kafka (`ledger.events`), và phục vụ tìm kiếm qua OpenSearch. Nghiệp vụ yêu cầu một hệ thống cảnh báo sớm: *"hãy gắn cờ các pattern ledger đáng ngờ ngay khi chúng xuất hiện, trước khi đối soát, trước khi batch job lúc 2 giờ sáng."*

Chúng tôi đã đánh giá vài nguồn tín hiệu — trước tiên là luật xác định (deterministic rules), sau đó là một baseline thống kê, và cuối cùng là một bộ chấm điểm LLM nằm trên cùng. Quyết định sản phẩm là:

> AI không bao giờ được quyết định kết quả về tiền. AI tạo ra *tín hiệu*; con người và chính sách xác định mới ra *quyết định*.

Tất cả những gì bên dưới là kiến trúc khiến câu nói đó trở thành sự thật trong sản xuất.

## 2. Luồng tiền là thiêng liêng

Bất biến cốt lõi của dịch vụ:

```java
// application/PostingService.java — luồng tiền, 3-15ms, một transaction DB.
@Transactional
public void post(LedgerCommand cmd) {
    ledger.entry(new Entry(cmd.eventId(), DEBIT,  cmd.partyId(), cmd.amount()));
    ledger.entry(new Entry(cmd.eventId(), CREDIT, cmd.counterparty(), cmd.amount()));
}
```

Bất kỳ công việc nào chúng ta thêm lên luồng này đều tranh giành cùng một transaction DB, cùng một connection, cùng các row lock. Bản tích hợp AI đầu tiên (ngây thơ) mà chúng tôi viết — hiển thị bên dưới, chỉ để minh họa điều *không nên* làm — đã vi phạm mọi ràng buộc đó.

## 3. WRONG: tích hợp đồng bộ ngây thơ

```java
// WRONG — đừng bao giờ làm thế này. AI nằm ngay trên luồng tiền, key hardcode, không guardrail.
public class PaymentProcessor {

    private static final String OPENAI_API_KEY = "sk-proj-..."; // !! bí mật hardcode

    private static final String PROMPT = """
        You are a payments fraud expert.
        Amount %.2f, party %s, counterparty %s.
        Answer exactly YES or NO: is this suspicious?
        """;

    @Transactional
    public void postLedger(PaymentEvent event) {
        ledger.post(debit(event), credit(event)); // 1. luồng tiền trước — nhưng rồi ta block

        // 2. !! gọi LLM đồng bộ NGAY TRONG transaction DB, không timeout, không breaker
        String answer = openAiClient.ask(String.format(PROMPT,
                event.amount(), event.partyId(), event.counterparty()), OPENAI_API_KEY);

        // 3. !! LLM ngầm trở thành người quyết định tiền — nó đóng băng quỹ
        if ("YES".equals(answer)) {
            fundsService.hold(event.eventId());
        }

        // 4. !! retry đồng bộ: 5 lần x 3s = 15s giữ nguyên row lock
        auditRepo.save(new AuditRow(event.eventId(), answer)); // và audit bị ghép vào transaction tiền
    }
}
```

Vấn đề ở đây là gì, theo thứ tự mức độ nghiêm trọng:

- **LLM nằm trên luồng tiền.** Transaction DB vẫn mở trong khi chúng ta chờ một API bên thứ ba. Một p95 của LLM là 2 giây trở thành 2 giây giữ nguyên row lock, cạn kiệt connection pool, và một ledger chậm hơn cho tất cả mọi người.
- **Không timeout, không circuit breaker, không suy giảm (degradation).** Khi OpenAI sập, ledger cũng sập theo. Một AI giám sát không bao giờ được trở thành điểm lỗi thứ hai.
- **Key bị hardcode.** Nó sẽ bị commit, bị quét bởi secret scanner, bị rotate, và bị lộ. Nó cũng có nghĩa mọi lần deploy đều mang theo cùng một credential tĩnh — ngược hẳn với BYOK (Bring Your Own Key).
- **AI âm thầm quyết định tiền.** `fundsService.hold(...)` được gọi mà không có override xác định và không có bước con người. Không có sự tách biệt giữa "tín hiệu" và "quyết định".
- **Không idempotent.** Kafka là at-least-once; một lần gửi lại sẽ ghi entry hai lần và gọi `hold` hai lần. Replay trở thành lỗi tài chính.
- **Audit bám theo transaction tiền.** Nếu LLM treo, audit không bao giờ được ghi. Dấu vết giấy tờ biến mất đúng lúc có sự cố.

## 4. Các guardrail chúng tôi cam kết

Trước khi viết bất kỳ code "RIGHT" nào, chúng tôi viết ra các quy tắc định hình nó. Đây là quy tắc cấp sản phẩm, không phải cấp code:

1. **AI không phải là người quyết định tiền.** AI phát ra tín hiệu; một chính sách xác định riêng và một luồng duyệt của con người sở hữu kết quả về tiền.
2. **Idempotent theo `eventId`.** Mọi consumer, mọi store, mọi side effect bên ngoài phải an toàn khi replay.
3. **Timeout -> retry -> circuit breaker**, theo đúng thứ tự đó, kèm một fallback xác định để khi AI sập thì hệ thống suy giảm, không bao giờ block.
4. **BYOK, key không bao giờ hardcode hay bị log.** Key được tiêm vào lúc chạy từ một secret store; mọi output log tình cờ đều bị redact.
5. **Audit mọi quyết định.** Mỗi điểm số là một bản ghi bất biến, chỉ ghi thêm (append-only), kèm bằng chứng đầu vào, model, phán quyết và timestamp.
6. **Đường AI được đo đạc đầy đủ.** Độ trễ, lỗi và tỷ lệ bất thường được đưa lên Prometheus để chúng ta có thể alert chính kẻ giám sát.

## 5. RIGHT: các cổng hexagonal, adapter nằm trong infrastructure

Chúng tôi tách codebase theo ranh giới hexagonal. `domain/` sở hữu các model và **ports** (interface). `infrastructure/` sở hữu các **adapters** (Kafka, OpenAI, OpenSearch, Micrometer). Lõi domain không biết gì về HTTP, JSON, Kafka hay AI SDK — chính điều đó khiến chuyện fallback, test và thay thế trở nên tầm thường.

```
com.finpay.ledger
├── domain/
│   ├── model/              # LedgerEvent, AnomalyScore, AnomalyRecord
│   └── port/               # AnomalyScorer, AnomalyStore, AuditTrail   <- ports (thuần)
├── application/            # orchestration: PostingService, DetectAnomalyService
└── infrastructure/
    ├── kafka/              # LedgerEventListener (adapter)
    ├── ai/                 # OpenAiAnomalyScorer, RuleBasedScorer (adapter)
    ├── opensearch/         # OpenSearchAnomalyStore (adapter)
    ├── audit/              # AuditTrailImpl (adapter)
    └── metrics/            # Prometheus registration (adapter)
```

Các port:

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

Và các model mà domain trả về — chú ý `UNKNOWN` là một phán quyết hạng nhất:

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

## 6. RIGHT: consume Kafka, tránh xa luồng tiền

Tính năng AI không bao giờ nằm trong transaction của `PostingService`. Một consumer group riêng đọc `ledger.events`, chấm điểm bất đồng bộ, và chỉ chạm vào các sink *metric và audit*. Luồng tiền vẫn giữ 3-15 ms và không biết gì về AI.

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
        // Guardrail #2: idempotent theo eventId — delivery at-least-once an toàn khi replay.
        if (store.exists(event.eventId())) {
            log.info("skipped duplicate event {}", event.eventId());
            return;
        }

        var sample = Timer.start(registry);
        AnomalyScore score = scorer.score(event);
        sample.stop(registry.timer("ledger_anomaly_score_duration_seconds"));

        // Guardrail #5: audit mọi quyết định, kèm bằng chứng.
        audit.record("SCORE", event.eventId(), score);

        // Guardrail #1: AI KHÔNG phải người quyết định tiền. Chúng ta chỉ phát tín hiệu.
        if ("SUSPICIOUS".equals(score.verdict())) {
            Counter.builder("ledger_anomaly_detected_total")
                    .tag("reason", score.reason())
                    .tag("provider", score.provider())
                    .register(registry)
                    .increment();
        }

        // Guardrail #6: canh chừng kẻ giám sát — một AI scorer không khỏe cũng là một sự cố.
        if ("UNKNOWN".equals(score.verdict())) {
            Counter.builder("ledger_anomaly_scorer_failures_total")
                    .tag("reason", score.reason())
                    .register(registry)
                    .increment();
        }

        // Lưu tín hiệu cho analyst; OpenSearch cũng là replay log của chúng ta.
        store.save(AnomalyRecord.of(event, score));
    }
}
```

Consumer nằm trong một consumer group, nên ta mở rộng theo chiều ngang được. Vì Kafka đảm bảo at-least-once, việc kiểm tra `eventId` là bắt buộc, không thể tùy chọn.

## 7. Idempotency theo eventId

Idempotency được áp đặt ở ba nơi: bước kiểm tra trùng lặp, một document id xác định trong store, và một Kafka dead-letter topic cho các sự kiện độc (poison).

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
            return false; // fail-open: giữ pipeline chạy; audit sẽ lộ trùng lặp
        }
    }

    @Override
    public void save(AnomalyRecord record) {
        client.index(i -> i.index("ledger-anomalies")
                .id(record.eventId())            // document id xác định = replay ghi đè
                .document(record));
    }
}
```

Khi xử lý thất bại lặp lại, bản ghi được chuyển sang dead-letter topic thay vì chặn cả group:

```java
// infrastructure/kafka/LedgerEventListener.java (phần mở rộng)
@DltHandler
public void onDlt(LedgerEvent event, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
    log.error("poison event {} forwarded to DLT from {}", event.eventId(), topic);
    audit.record("DLT", event.eventId(), AnomalyScore.unknown("poison_event"));
}
```

## 8. Timeout, retry, circuit breaker

Resilience4j cho chúng ta chuỗi timeout -> retry -> circuit-breaker, cấu hình khai báo và giữ ngoài code domain.

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

Adapter kết hợp chúng và khi lỗi, suy giảm xuống một rule scorer xác định — không bao giờ ném exception lên thread consumer, không bao giờ chặn pipeline:

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

    private static final String KEY_ENV = "AI_PROVIDER_API_KEY"; // BYOK: tiêm vào lúc chạy

    private final RestClient openAi;
    private final AnomalyScorer fallback;      // rule scorer xác định
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
            // Thứ tự kết hợp quan trọng: TimeLimiter trong CircuitBreaker trong Retry.
            var timed = TimeLimiter.decorateFutureSupplier(timeLimiter,
                    () -> CompletableFuture.supplyAsync(() -> callOpenAi(event), aiExecutor));
            var cb = CircuitBreaker.decorateSupplier(circuitBreaker, timed::get);
            var withRetry = Retry.decorateSupplier(retry, cb);
            String body = withRetry.get();
            return AnomalyScore.fromJson(body);
        } catch (Exception e) {
            // Guardrail #3: suy giảm, không bao giờ block. AI sập không được làm vỡ ledger.
            log.warn("openai scorer degraded for {}: {}", event.eventId(), e.getMessage());
            return fallback.score(event);
        }
    }

    private String callOpenAi(LedgerEvent event) {
        String key = apiKey();
        // eventId và model an toàn để log; key thì không (Guardrail #4).
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

Guard timeout là quan trọng nhất: nếu thiếu `TimeLimiter`, một socket OpenAI bị treo sẽ khóa thread consumer vô hạn định và làm tăng Kafka consumer lag.

## 9. BYOK — key không bao giờ hardcode, không bao giờ bị log

Key do *người vận hành mang tới*, không phải do chúng tôi đóng gói:

- Đặt lúc chạy qua `AI_PROVIDER_API_KEY` (từ Vault / AWS Secrets Manager / K8s Secret), không bao giờ trong `application.yml`, không bao giờ trong git.
- Đọc theo nhu cầu trong adapter (xem `apiKey()` ở trên); không bao giờ lưu trên field nơi stack trace có thể in ra nó.
- Được redact trong log. Mọi câu in ra tình cờ đều đi qua một redactor:

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

Và một regression test chứng minh key không bao giờ rơi vào file log:

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

## 10. Audit mọi quyết định

Mọi điểm số — gồm cả mọi lần suy giảm và mọi lần bỏ qua trùng lặp — là một bản ghi append-only, kèm bằng chứng trong OpenSearch (`ledger-ai-audit`). Audit **không** tùy chọn và **không** gắn với transaction tiền:

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
            throw e; // audit là append-only và không thể thương lượng
        }
    }
}
```

Audit entry mang đầu vào, model và phán quyết để một con người có thể trả lời "tại sao hệ thống gắn cờ cái này?" nhiều tuần sau:

```java
public record AuditEntry(
        String action,            // SCORE | DLT | DECISION_OVERRIDE
        String eventId,
        AnomalyScore score,       // gồm provider + reason + timestamp
        long writtenAtEpochMs
) {}
```

## 11. AI không phải là người quyết định tiền

Pipeline phát hiện chỉ *phát tín hiệu*. Kết quả về tiền (hold, block, reject) thuộc về một dịch vụ chính sách xác định riêng biệt với bước duyệt của con người. Chúng tôi nói rõ điều này trong code để không ai "giúp một tay sau này":

```java
// application/DetectAnomalyService.java — kết quả của AI là tín hiệu, không bao giờ là hành động.
public AnomalySignal analyze(LedgerEvent event) {
    AnomalyScore score = scorer.score(event);
    if (!"SUSPICIOUS".equals(score.verdict())) {
        return AnomalySignal.pass(event.eventId());
    }
    // Một luật xác định + người duyệt quyết định tiền có chuyển động hay không.
    return AnomalySignal.refer(event.eventId(), score.reason(),
            DecisionStatus.PENDING_HUMAN_REVIEW);
}
```

## 12. Prometheus và cảnh báo

Micrometer + Spring Boot Actuator phơi bày mọi thứ ra Prometheus:

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

Chúng tôi giám sát gì, và vì sao:

| Metric | Loại | Cho biết |
|---|---|---|
| `ledger_anomaly_detected_total{reason,provider}` | Counter | Tỷ lệ bất thường theo reason/provider |
| `ledger_anomaly_scorer_failures_total{reason}` | Counter | Sức khỏe AI scorer (SLO) |
| `ledger_anomaly_score_duration_seconds` | Timer | Độ trễ LLM p50/p95/p99 |
| `kafka_consumer_lag` (Kafka exporter) | Gauge | Sức khỏe consumer group |

Các rule alert kích hoạt khi chính *kẻ giám sát* không khỏe:

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

Nếu `AIScorerDegraded` bùng lên, rule scorer dự phòng đang gánh việc — đúng như guardrails thiết kế, và đúng thứ người trực cần biết.

## 13. Các test giữ chúng tôi ngay thẳng

Nhờ trừu tượng hóa port, "AI" chỉ là một implementation cắm vào được, nên test không bao giờ chạm vào model thật:

```java
// application/DetectAnomalyServiceTest.java
@Test
void replayIsIdempotentByEventId() {
    AnomalyStore store = new InMemoryAnomalyStore();
    AnomalyScorer fake = event -> AnomalyScore.suspicious("amount_spike", 0.97);
    LedgerEventListener listener = new LedgerEventListener(fake, store, audit, registry);

    listener.onLedgerEvent(event("evt-1"));
    listener.onLedgerEvent(event("evt-1")); // replay từ Kafka redelivery

    assertThat(store.calls()).isEqualTo(1); // lần giao thứ hai là no-op
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

## 14. Những gì chúng tôi đã ship

Hình dạng sản xuất là: sự kiện Kafka -> async consumer (hexagonal, có guardrail) -> OpenAI scorer với timeout/retry/circuit breaker -> fallback xác định -> tín hiệu OpenSearch + audit append-only -> counter/timer Prometheus -> alert trên chính kẻ giám sát. Luồng tiền không bao giờ chờ AI, quyết định không bao giờ do AI đưa ra, và mọi quyết định đều có thể replay và kiểm toán.

Nếu bạn đang nối một LLM vào sổ cái, hãy bắt đầu từ guardrails, chứ không phải từ prompt.

> **Repository:** https://github.com/finpay-lab/ledger-service
