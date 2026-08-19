---
title: "Order Loss During a Spring Boot Deployment: Why Graceful Shutdown Matters"
description: "A production incident involving interrupted order processing, Kafka delivery, and a missing graceful-shutdown configuration."
pubDatetime: 2025-06-18T15:13:00+07:00
featured: true
draft: false
tags:
  - spring-boot
  - microservices
  - devops
  - case-study
---

## The incident

This is a post-incident account of an order-service deployment. The hard part was not starting the new version. It was stopping the old version without interrupting work already in progress.

### [SOURCE FACT] What happened

The deployment took place on a Friday at 8:00 PM. Tests had passed and the CI/CD pipeline was green. About five minutes after the production deployment began, monitoring showed a sharp increase in failed orders. Relevant log messages included:

```text
java.net.SocketException: Connection reset
org.apache.kafka.common.errors.TimeoutException
Connection refused: no further information
```

Nearly a hundred orders were not completed. The failures lined up with the deployment window. The team found no corresponding application, Kafka, or database errors before the deployment.

The old Pod had received requests that were still being processed when Kubernetes sent `SIGTERM`. The service did not have Spring Boot graceful shutdown enabled. Processes were terminated before some Kafka messages had been sent and before some database transactions had committed.

The operational response took four hours of overtime. A DevOps colleague and I used Kafka logs to trace and manually recover the affected requests. Customers received an apology and compensation vouchers.

These details describe this incident; they are not a claim that every deployment without graceful shutdown loses orders. The outcome depends on request duration, transaction boundaries, message-delivery behavior, termination timing, and the surrounding retry and recovery design.

## [ANALYSIS] Why shutdown interrupted the workflow

An order workflow often spans several resources: an HTTP request, application threads, a database transaction, and a message producer. Completion in one resource does not imply completion in the others.

When a Pod begins termination, traffic can still be in flight while the application is stopping. A request may be interrupted before its database commit, or the application may exit before a producer has delivered a record. A client or upstream consumer may then observe a reset or timeout and retry. Without idempotency, the retry can also create a duplicate rather than recover the original operation.

Graceful shutdown addresses one part of this problem: it gives the application a controlled shutdown phase and a chance to finish accepted work. It does not make a multi-resource workflow atomic, and it does not replace durable retries, idempotency, reconciliation, or a tested recovery procedure.

Readiness is also part of the handoff. A terminating Pod should stop accepting new traffic as early as possible. Changing readiness during application shutdown helps, but it does not remove the brief race between endpoint updates, load balancing, and in-flight requests. The application still needs to tolerate requests that were accepted before readiness changed.

## [PROPOSED DESIGN] A safer shutdown path

The following settings are a proposed baseline for a Spring Boot service. The `30s` value is an example from this incident’s configuration guidance, not a universal requirement. It should be longer than the expected drain time and aligned with the container’s termination grace period.

### 1. Enable Spring Boot graceful shutdown

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

This asks Spring to stop accepting new work and wait for active lifecycle components during shutdown. Verify the behavior for the actual server, request types, and Spring Boot version in use.

### 2. Close producer resources deliberately

If the service owns a Kafka producer directly, its shutdown hook should flush pending records and close the producer within a bounded timeout:

```java
@PreDestroy
public void cleanUp() {
    kafkaProducer.flush();
    kafkaProducer.close(Duration.ofSeconds(10));
    log.info("Kafka producer closed.");
}
```

The `10s` timeout is an illustrative value from the original design, not a guarantee that delivery will succeed. Services using a framework-managed producer should follow that framework’s lifecycle instead of closing the same resource twice.

### 3. Drain application executors

Background work also needs a defined shutdown policy. For a Spring-managed executor, waiting for submitted tasks is one possible configuration:

```java
@Bean
public Executor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);
    return executor;
}
```

The `30`-second value is the same illustrative timeout and should be chosen from the workload and deployment limits. Waiting is only useful if tasks are bounded and can finish; a stuck task still needs a timeout or cancellation policy.

### 4. Stop routing new traffic

Readiness (the signal that a Pod may receive traffic) should become false during shutdown. One application-level pattern is:

```java
@EventListener
public void onAppShutdown(ContextClosedEvent event) {
    isReady.set(false);
}
```

The readiness endpoint must actually expose `isReady`, and the deployment must use that endpoint. Kubernetes will then remove the Pod from eligible traffic as endpoint changes propagate. This is a drain signal, not proof that no request can arrive.

### 5. Make the workflow recoverable

Shutdown settings reduce interrupted work; they do not eliminate failure windows. The order workflow should also define:

- A database transaction boundary and a way to identify incomplete orders.
- Idempotency keys for client requests and message consumers.
- Retry policies with timeouts, backoff, and a circuit breaker where appropriate.
- Durable message handling and a reconciliation path for an order whose database and Kafka state disagree.
- Metrics and alerts for interrupted requests, consumer lag, producer failures, and recovery volume.

## Verification

Shutdown deserves tests, not only startup tests. In a staging environment, send requests that take long enough to overlap termination, then verify the readiness transition, request completion, database commit behavior, Kafka delivery or retry behavior, executor draining, and recovery of incomplete work.

Also test the failure cases: a dependency timeout, a stuck task, a producer close that exceeds its budget, and a request that arrives during endpoint propagation. The goal is not to assume that shutdown is clean. The goal is to make the remaining failure modes visible and recoverable.

## Conclusion

The incident exposed a missing operational control, not a mysterious failure in Spring Boot or Kafka. A service needs a defined path for starting, serving, draining, and stopping. Graceful shutdown, readiness management, bounded resource cleanup, idempotency, and reconciliation address different parts of that path.

The practical checklist is:

1. Configure `server.shutdown: graceful` and choose a shutdown timeout based on measured workload and deployment limits.
2. Stop new traffic through readiness, while still handling requests already accepted.
3. Drain thread pools and close externally managed clients, including Kafka producers and database or HTTP clients.
4. Use timeout, retry, fallback, circuit-breaker, and backpressure policies where the workflow requires them.
5. Make requests and consumers idempotent, and provide reconciliation for partial completion.
6. Test termination and recovery in staging, not just startup and steady-state traffic.
7. Avoid scheduling high-risk deployments when on-call coverage is constrained, if the release process allows it.

The deployment was the trigger. The underlying lesson was that safe operation includes the shutdown path and the recovery path, not just the code that runs when everything is healthy.
