---
title: "Phỏng vấn Senior Java: Microservices"
description: "Microservices cấp senior chủ yếu là biết khi nào KHÔNG dùng — resilience patterns, service communication, và distributed transactions."
pubDatetime: 2026-08-10T10:10:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - microservices
  - resilience
---

Phỏng vấn microservices test tư duy nhiều hơn kiến thức. Câu trả lời senior nhất cho "thiết kế microservice" đôi khi là "chưa, đừng."

## 1. Bẫy distributed-monolith

Chia nhỏ sớm quá mang lại **network call thay method call**, distributed transaction, và 10× chi phí vận hành không có lợi. Biết trigger tách: deploy độc lập, profile scaling khác, team khác, failure domain khác.

## 2. Service communication

- **Đồng bộ (REST/gRPC):** đơn giản, nhưng mỗi hop thêm latency và điểm chết. Timeout + retry with backoff + circuit breaker (Resilience4j). Không retry thiếu idempotency.
- **Bất đồng bộ (event):** decouple producer/consumer, hấp thụ spike, replay. Giá: eventual consistency, khó debug.

## 3. Resilience patterns (vẽ được)

- **Circuit breaker:** mở sau N fail, half-open thăm dò. Ngăn cascading failure.
- **Bulkhead:** cô lập failure (tách pool) để một dependency chậm không cạn kiệt tất cả.
- **Retry + backoff + jitter:** retry `for(i<3)` ngây thơ lúc outage là **tự DDoS**. Thêm jitter.

```java
Supplier<String> decorated = Decorators.ofSupplier(() -> callDownstream())
    .withTimeout(Timeout.of(Duration.ofMillis(800)))
    .withRetry(Retry.ofDefaults("svc"))
    .withCircuitBreaker(CircuitBreaker.ofDefaults("svc"))
    .decorate();
```

## 4. Discovery, config, gateway

Vai trò: discovery (Consul/Eureka/K8s DNS), centralized config (Spring Cloud Config / K8s ConfigMap), API gateway (routing, auth, rate limit), observability (OpenTelemetry, Micrometer/Prometheus).

## 5. Distributed data & transactions

- **Saga:** chuỗi local transaction + compensating action. Orchestration (coordinator) vs choreography (event). Orchestration dễ suy luận; choreography tránh bottleneck nhưng khó trace.
- **2PC:** tránh — giữ lock, không sống sót nếu coordinator chết.

## 6. Tự kiểm tra

- [ ] Hai lý do KHÔNG tách monolith.
- [ ] Giải thích circuit breaker + bulkhead với ví dụ thật.
- [ ] Trade-off orchestration vs choreography.
- [ ] Tại sao retry ngây thơ lúc outage nguy hiểm.

Đó là bar microservices.
