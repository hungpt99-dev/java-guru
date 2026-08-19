---
title: "Designing Retries for Distributed Systems"
description: "How bounded retries, backoff, jitter, circuit breakers, and deferred processing reduce cascading failures."
pubDatetime: 2025-06-22T16:02:00+07:00
featured: false
draft: false
tags:
  - system-design
  - microservices
  - backend
---

[SOURCE FACT] Retry repeats an operation after a failure. It is useful when a failure is transient, such as a network interruption, timeout, or temporary downstream error. It is not a general answer to every failed request.

The hard part is that a retry adds load precisely when a dependency may already be unhealthy. A sound policy therefore has to answer four questions: which failures are retryable, how much additional work is allowed, when should work move out of the request path, and when should the caller stop sending traffic? This article covers those decisions, plus common implementation options.

## 1. Why retries can amplify an incident

[ANALYSIS] Consider this illustrative calculation:

- Service A calls Service B.
- Service B is overloaded and returns HTTP 503 (Service Unavailable).
- Service A makes 3 retries, each after a 100 ms delay.
- 1,000 requests reach Service A at roughly the same time.

Each request can produce 4 calls to Service B: the original call plus 3 retries. That is up to 4,000 calls, assuming every attempt reaches the dependency. The retry traffic can consume the remaining capacity of Service B and propagate the failure to other callers.

The calculation is an illustrative assumption, not a production measurement. Its point is the multiplier: a retry policy must be evaluated against aggregate traffic across all callers and instances, not only against one request.

## 2. Failure patterns to avoid

[ANALYSIS] These policies commonly turn a transient problem into a larger outage:

- Retrying without a delay sends another request while the dependency is still processing the first failure.
- Retrying from many instances on the same schedule creates a synchronized traffic spike. Jitter, or a small random delay, reduces this synchronization.
- Retrying indefinitely keeps work in flight, consumes connection and worker capacity, and can congest queues. It also makes completion and failure behavior difficult to reason about.

## 3. Decide whether a failure is retryable

[PROPOSED DESIGN] Retry only when the operation has a reasonable chance of succeeding without a change to its input.

Usually retryable, depending on the API contract:

- Timeouts and connection resets
- HTTP 5xx responses such as 500, 502, 503, and 504
- A downstream service that is restarting or temporarily unavailable

Usually not retryable:

- Client errors such as 400, 401, 403, and 404
- Business errors such as an unknown user, insufficient funds, or failed validation
- HTTP 422 (Unprocessable Entity)

Status codes alone are not enough. A timeout does not prove that the server did not process a write. For non-idempotent operations, use an idempotency key and server-side deduplication before considering a retry.

## 4. A bounded retry policy

[PROPOSED DESIGN] A practical policy should make each limit explicit:

1. Bound attempts. Never retry forever. The appropriate maximum depends on the request deadline and dependency, but the source example uses 2–3 retries as an illustrative range.
2. Add backoff and jitter. Exponential backoff increases the wait after successive failures; linear backoff is another option. Add jitter so independent callers do not retry together.
3. Retry only safe operations. GET is normally idempotent and PUT is commonly designed to be idempotent, but the API contract is authoritative. POST may be retried only when the operation supports idempotency, for example through an idempotency key.
4. Enforce a total deadline. Per-attempt timeouts and the overall request deadline should prevent retries from consuming unbounded caller capacity.
5. Log the decision. Record the failure reason, attempt count, timestamps, selected delay, and final outcome. Avoid logging sensitive request data.

## 5. Circuit breakers and deferred retry

[PROPOSED DESIGN] A circuit breaker stops sending calls after a dependency has failed repeatedly. In the open state, calls fail fast. After a configured wait, the breaker enters half-open and permits a limited probe. It closes again only when the dependency shows sufficient success. This is a traffic-control mechanism, not a replacement for timeouts or a retry limit.

For work that does not need an immediate response, use deferred retry. Persist the work in a queue or database and process it with a background consumer when the dependency has recovered. Bound the queue, apply backpressure, and define a dead-letter path for items that exceed their retry policy. This keeps the request path from adding load during an incident.

Retry rate also needs a limit. A circuit breaker can stop one caller, but a fleet of callers can still produce substantial retry traffic. Apply per-client, per-operation, or global rate limits where appropriate.

## 6. Decide when to try again

[PROPOSED DESIGN] Use signals that describe the dependency and the request:

- Honor `Retry-After` when the API provides it and the value fits within the request deadline.
- Use health checks and service metrics as operational signals, not as a guarantee that the next request will succeed. Metrics systems such as Prometheus and Grafana can help expose recovery, latency, and error trends.
- Let the circuit breaker control gradual recovery through its half-open probes.
- Keep retry traffic rate-limited while the dependency recovers.

## 7. Implementation options

[SOURCE FACT] Common options include:

Java and Spring:

- Spring Retry provides `@Retryable`, configurable backoff, and recovery through `@Recover`.
- Resilience4j provides retry, circuit breaker, rate limiter, and bulkhead components, with Spring Boot and Micrometer integrations.
- Kafka retry topics move failed records to a dedicated topic so the main consumer is not blocked. A dead-letter topic handles records that exceed the policy.
- Quartz and Spring Task can schedule deferred background work.

Other platforms:

- Python: Tenacity for retry decorators and Celery for asynchronous task retry policies.
- Node.js: `retry`, Bull, and Agenda support retry policies based on time or attempt count.
- Go: `go-retryablehttp` and `backoff` provide retry and backoff building blocks.

Cloud services:

- AWS: SQS with Lambda and a dead-letter queue (DLQ), or Step Functions retry and catch states.
- GCP: Cloud Tasks, Pub/Sub retry with a DLQ, or Workflows retry logic.
- Azure: Service Bus retry policies or Azure Durable Functions retry support.

These are implementation options, not a recommendation to add every mechanism. Select the smallest set that matches the delivery guarantee, latency requirement, and failure mode of the operation.

## 8. Illustrative scenario

[ANALYSIS; ILLUSTRATIVE ASSUMPTION] During a promotional peak, a payment dependency is timing out while a batch job continues sending requests. Assume the job is configured with 5 retries, no delay, and no jitter, and that the resulting retry traffic contributes to overload. The exact impact depends on capacity, concurrency, and the dependency's behavior; the following numbers are not an observed incident.

A safer redesign would:

- Reduce the retry budget to 2 retries for the operation.
- Add exponential backoff and jitter.
- Put a circuit breaker around the batch job's dependency calls.
- Move non-interactive work to a queue and process it with a background consumer.
- Monitor timeout rate, latency, queue depth, and final failure rate.

The intended result is controlled recovery rather than additional synchronous load. Any claim such as stabilization within 10 minutes would require measurements from a real system and should not be inferred from this example.

## 9. Conclusion

Retry is a capacity and correctness decision, not merely a client-side convenience. Use it for failures that may recover, bound both attempts and total time, spread attempts with backoff and jitter, and protect dependencies with circuit breakers and rate limits. Move durable work to deferred processing when an immediate response is unnecessary.

The key question is not only “how many times should this request run?” It is also “what load can the dependency accept, and when should this caller stop and wait?”
