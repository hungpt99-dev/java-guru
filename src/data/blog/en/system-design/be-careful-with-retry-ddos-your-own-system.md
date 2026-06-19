---
title: "Be Careful with Retry – Don't DDoS Your Own System"
description: "Uncontrolled retries can cause cascading failures. A guide to proper retry with exponential backoff, jitter, circuit breaker, and deferred retry."
pubDatetime: 2025-06-22T16:02:00+07:00
featured: false
draft: false
tags:
  - system-design
  - microservices
  - backend
---

Retry isn't bad. But if used incorrectly, you might accidentally become a "DDoS hacker"... against your own system.

Retry — the mechanism of repeating requests on failure — is an indispensable part of distributed system design. When an API call to another service fails due to network errors, timeouts, or temporary errors, we typically implement retry to increase the chance of success.

From a supporting mechanism, retry easily becomes the culprit causing a domino effect if uncontrolled.

## 1. When Retry Is a Double-Edged Sword

Imagine a simple scenario:

- Service A calls Service B.
- Service B is congested, returns 503 (Service Unavailable).
- Service A has 3 retries, each with a 100ms delay.

Now if 1000 requests arrive at Service A simultaneously:

- Each request makes 4 calls to Service B (1 original + 3 retries).
- Total: 1000 × 4 = 4000 requests to Service B.
- While Service B is already overloaded, this retry volume suffocates it completely, leading to cascading failure.

Uncontrolled retry = shooting yourself in the foot.

## 2. Dangerous Retry Patterns

- Retry without delay → Causes flooding, consecutive attacks on error.
- Simultaneous retry from multiple instances → Multiple instances retrying at the same time → large traffic spike → target service crashes.
- Infinite retry → Can cause memory leaks, queue congestion, unstoppable request storms.

## 3.5 When to Retry and When Not To

Not all errors should be retried.

Should retry when:

- Temporary errors: timeout, connection reset
- System errors: HTTP 5xx like 500, 502, 503, 504
- Downstream system is restarting

Should NOT retry when:

- Client errors: 400, 401, 403, 404
- Business errors: user doesn't exist, insufficient funds, validation errors
- Error 422 – Unprocessable Entity

✅ Only retry if the error has a chance of self-recovery.

## 3.6 How to Retry Correctly?

1. Limit the number of retries
   Never retry infinitely. Maximum 2–3 times depending on context.

2. Use delay and jitter
   Add delays between retries (exponential/linear), combined with jitter to avoid simultaneous retries.

3. Only retry idempotent actions
   Example: GET, PUT are safer than POST, avoid creating multiple orders or duplicate transfers.

4. Use circuit breaker
   Temporarily disconnect when downstream service fails continuously, retry later.

5. Deferred Retry – Smart retry via jobs
   Instead of retrying immediately, put into queue or DB and process via background job when the system stabilizes. Avoid adding more load when the system is already in trouble.

6. Log thoroughly
   Record error causes, retry count, retry timestamps for easy debugging and alerting.

## 3.7 How to Know When to Retry Again?

1. Use circuit breaker
   Temporarily disconnect if target service fails continuously. Then gradually reopen (half-open).

2. Observe health checks or metrics
   Check /health or data from Prometheus, Grafana to know if the system has recovered.

3. Based on Retry-After header
   Some standard APIs return suggested retry timing.

4. Rate limit retries
   Avoid flooding retries that overload the service again.

## 4. Tools Supporting Effective Retry Implementation

Java / Spring ecosystem:

- Spring Retry: Supports @Retryable annotation, configurable delay, backoff, fallback with @Recover.
- Resilience4j: Combines retry, circuit breaker, rate limiter, bulkhead in one library. Integrates well with Spring Boot and Micrometer.
- Kafka Retry Topic: Separate retry into a dedicated topic with delay, avoiding blocking the main consumer. Combine with dead-letter topic to prevent data loss.
- Quartz / Spring Task: Used to schedule deferred background job retries.

Other languages/platforms:

- Python: tenacity: powerful retry decorator; celery: built-in retry policy for async tasks
- Node.js: retry, bull, agenda: support time-based and count-based retry
- Go: go-retryablehttp, backoff: simple, effective

Cloud-native:

- AWS: SQS + Lambda + DLQ; Step Functions with retry/catch blocks
- GCP: Cloud Tasks, Pub/Sub retry + DLQ; Workflows with retry logic
- Azure: Service Bus with pre-configured retry policy; Azure Durable Functions with built-in retry support

## 5. Real Case: Saving the System During Peak Season with Strategic Retry

Context:
Year-end, the system is under heavy load due to a promotional campaign. A payment processing service is overloaded, continuously returning timeout errors. Meanwhile, an automated batch job is running thousands of requests per minute, with 5 retries, no delay, no jitter.

Consequences:
Flooding retries cause the payment service to completely congest → cascading impact on other systems → 15 minutes of downtime during peak hours.

Resolution:

- Reduced retries to 2
- Added exponential backoff and jitter
- Applied circuit breaker to the job
- Moved retries to queues and processed via background jobs

Result:
System stabilized in under 10 minutes. Retries no longer "suffocated" the backend.

Lesson:

Retry is not about "forcing it through", but about helping the system recover in a controlled manner.

## 6. Conclusion

Retry is a powerful tool when used correctly. But if implemented without control, it can break the system faster than the original error.

Remember:

- Retry only for temporary errors with self-recovery potential
- Limit retries, add delay + jitter, and always have a circuit breaker
- Effective retry isn't about "how many times to call again", but about "knowing when to stop and wait"

Retry is medicine — used correctly, it heals; used incorrectly, it poisons your own system.
