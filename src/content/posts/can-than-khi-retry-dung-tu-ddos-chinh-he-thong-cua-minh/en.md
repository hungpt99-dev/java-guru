---
title: "Be Careful with Retry – Don't DDoS Your Own System"
description: "Retry isn't bad. But used the wrong way, you can unintentionally become the “DDoS hacker”... of your own system."
slug: "can-than-khi-retry-dung-tu-ddos-chinh-he-thong-cua-minh"
locale: "en"
translationKey: "can-than-khi-retry-dung-tu-ddos-chinh-he-thong-cua-minh"
pubDate: 2025-06-22T23:02:04+07:00
category: "Distributed Systems"
tags: ["microservice", "distributed architecture", "scalability", "Fault Tolerance", "best practice"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 5
---

Retry isn't bad. But used the wrong way, you can unintentionally become the “DDoS hacker”... of your own system.

Retry – the mechanism that repeats a request when it fails – is an indispensable part of distributed system design. When a call from one API to another service fails because of a network error, a timeout or a transient failure, we usually add retry to increase the chance of success.

> **What starts out as a supporting mechanism easily becomes the culprit behind a domino effect when it lacks control.**

---

## 1. When retry is a double-edged sword

Imagine a simple situation:

* Service A calls Service B.
* Service B is congested and returns a 503 (Service Unavailable) error.
* Service A retries 3 times with a 100ms delay between attempts.

Now suppose 1000 requests hit Service A at the same time:

* Each request makes 4 calls to Service B (1 original + 3 retries).
* In total: **1000 × 4 = 4000 requests** to Service B.
* While Service B is already overloaded, this volume of retries leaves it **completely gasping**, leading to **cascading failure**.

Uncontrolled retry = shooting yourself in the foot.

![image.png](/images/articles/can-than-khi-retry-dung-tu-ddos-chinh-he-thong-cua-minh/figure-1.png)

---

## 2. Dangerous forms of retry

**Retry with no delay**
→ Causes a rush of back-to-back hits when errors occur.

**Retry from many instances at once**
→ Many instances retrying at the same moment → a huge traffic spike → the target service collapses.

**Infinite retry**
→ Can cause memory leaks, congested queues and an endless storm of requests.

---

## 3.5 When to retry and when not to

Not every error should be retried.

**Retry when:**

* Transient errors: timeout, connection reset
* System errors: HTTP 5xx such as 500, 502, 503, 504
* When the downstream system is restarting

**Do not retry when:**

* Client errors: 400, 401, 403, 404
* Business errors: the user doesn't exist, insufficient funds, failed validation
* The 422 error – Unprocessable Entity

> ✅ **Only retry if the error has a chance of recovering on its own.**

---

## 3.6 How should retry be done?

* **Limit the number of retries**
  Never retry indefinitely. 2–3 times at most, depending on the context.

* **Use delay and jitter**
  Add a delay between attempts (exponential/linear) and combine it with jitter so they don't all fire at once.

* **Only retry idempotent actions**
  For example: GET and PUT are safer than POST, avoiding duplicate orders and double money transfers.

* **Use a circuit breaker**
  Cut off temporarily while the downstream service keeps failing, then try again later.

* **Deferred Retry – smart retry via a job**
  Instead of retrying immediately, put the work into a queue or the DB and process it with a background job once the system is stable. This avoids adding more load while the system is already in trouble.

* **Log everything**
  Record the cause of the error, the number of retries and when they happened, to make debugging and alerting easier.

---

## 3.7 How do you know when it's safe to retry again?

* **Use a circuit breaker**
  Temporarily cut the connection if the target service keeps failing. Then open it up again gradually (half-open).

* **Watch health checks or metrics**
  Check `/health` or the numbers from Prometheus and Grafana to see whether the system has recovered.

* **Rely on the `Retry-After` header**
  Some standards-compliant APIs return a suggested wait time before trying again.

* **Rate limit the retries**
  So a burst of retries doesn't overload the service all over again.

---

## 4. Tools that help you implement retry effectively

### Java / Spring ecosystem:

* **Spring Retry**
  Supports the `@Retryable` annotation, with delay, backoff and fallback configured via `@Recover`.

* **Resilience4j**
  Puts retry, circuit breaker, rate limiter and bulkhead in one library. Integrates well with Spring Boot and Micrometer.

* **Kafka Retry Topic**
  Moves retries into a separate topic with a delay, so the main consumer isn't blocked. Pair it with a dead-letter topic so no data is lost.

* **Quartz / Spring Task**
  Used to schedule retries as deferred background jobs.

### Other languages/platforms:

* **Python**:

  * `tenacity`: a powerful retry decorator
  * `celery`: has a built-in retry policy for async tasks

* **Node.js**:

  * `retry`, `bull`, `agenda`: support retry by time and by attempt count

* **Go**:

  * `go-retryablehttp`, `backoff`: simple and effective

### Cloud-native:

* **AWS**:

  * SQS + Lambda + DLQ
  * Step Functions with retry/catch blocks

* **GCP**:

  * Cloud Tasks, Pub/Sub retry + DLQ
  * Workflows with retry logic

* **Azure**:

  * Service Bus with a preconfigured retry policy
  * Azure Durable Functions with built-in retry support

---

## 5. A real case: saving the system during peak season thanks to a retry strategy

**Context:**
At the end of the year the system comes under heavy load from a promotion campaign. A service handling payments is overloaded and keeps returning timeouts. Meanwhile an automated batch job is firing thousands of requests per minute, with 5 retries, no delay and no jitter.

**Consequences:**
The burst of retries completely clogs the payment service → knock-on effects across other systems → 15 minutes of downtime during peak hours.

**How it was handled:**

* Reduced the number of retries to 2
* Added exponential backoff and jitter
* Applied a circuit breaker to the job
* Moved the retries into a queue and processed them via a background job

**Result:**
The system stabilised in less than 10 minutes. Retries no longer leave the backend "gasping".

**Lesson:**

> Retry isn't about "trying harder and hoping", it's about helping the system recover in a controlled way.

---

## 6. Conclusion

Retry is a powerful tool when used properly. But implemented without control, it can break a system faster than the original error.

Remember:

* **Only retry transient errors that can recover on their own**
* **Limit retries, add delay + jitter, and always have a circuit breaker**
* **Effective retry isn't about "how many times you call again", it's about "knowing when to stop and wait"**

> **Retry is medicine – used right it heals, used wrong it poisons your own system.**
