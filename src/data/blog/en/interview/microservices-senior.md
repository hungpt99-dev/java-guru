---
title: "Senior Java Interview: Microservices"
description: "Microservices at senior level is mostly about knowing when NOT to use them — resilience patterns, service communication, and distributed transactions."
pubDatetime: 2026-08-10T10:10:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - microservices
  - resilience
---

Microservices interviews test judgment more than knowledge. The most senior answer to "design a microservice" is sometimes "don't, yet."

## 1. The distributed-monolith trap

Premature decomposition gives you **network calls instead of method calls**, distributed transactions, and 10× operational cost with none of the benefit. Know the triggers to split: independent deployability, different scaling profiles, different teams, different failure domains.

## 2. Service communication

- **Synchronous (REST/gRPC):** simplest, but every hop adds latency and a failure point. Use timeouts + retries with backoff + circuit breakers (Resilience4j). Never retry without idempotency.
- **Asynchronous (events/messages):** decouples producer/consumer, absorbs spikes, enables replay. Cost: eventual consistency and harder debugging.

## 3. Resilience patterns (be able to draw these)

- **Circuit breaker:** open after N failures, half-open to probe recovery. Prevents cascading failure.
- **Bulkhead:** isolate failures (separate thread/connection pools) so one slow dependency can't exhaust everything.
- **Retry + backoff + jitter:** naive `for (i<3) retry` during an outage is a **self-inflicted DDoS**. Add jitter.

```java
Supplier<String> decorated = Decorators.ofSupplier(() -> callDownstream())
    .withTimeout(Timeout.of(Duration.ofMillis(800)))
    .withRetry(Retry.ofDefaults("svc"))
    .withCircuitBreaker(CircuitBreaker.ofDefaults("svc"))
    .decorate();
```

## 4. Service discovery, config, gateway

Roles: discovery (Consul/Eureka/K8s DNS), centralized config (Spring Cloud Config / K8s ConfigMap), API gateway (routing, auth, rate limiting), observability (OpenTelemetry traces, Micrometer/Prometheus metrics).

## 5. Distributed data & transactions

- **Saga pattern:** a sequence of local transactions with compensating actions. Orchestration (coordinator) vs choreography (events). Orchestration is easier to reason about; choreography avoids a central bottleneck but is harder to trace.
- **2PC:** avoid it — holds locks and doesn't survive coordinator failure. Mention only to explain why you don't use it.

## 6. Self-check

- [ ] Name two reasons NOT to split a monolith.
- [ ] Explain circuit breaker + bulkhead with a real example.
- [ ] Saga orchestration vs choreography trade-off.
- [ ] Why naive retries during an outage are dangerous.

That's the microservices bar.
