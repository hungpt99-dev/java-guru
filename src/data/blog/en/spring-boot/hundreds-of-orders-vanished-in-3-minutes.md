---
title: "Hundreds of Orders Vanished in Just 3 Minutes – All Because of One Forgotten Config Line"
description: "A real case study on the consequences of forgetting graceful shutdown configuration in Spring Boot: lost orders, Kafka messages, and lessons learned."
pubDatetime: 2025-06-18T15:13:00+07:00
featured: true
draft: false
tags:
  - spring-boot
  - microservices
  - devops
  - case-study
---

## Opening: A Seemingly Normal Evening

It was Friday, 8:00 PM, and my team was preparing to deploy an update for the order-service — the most critical microservice in the company's order processing chain.

Everything was smooth. Tests passed. CI/CD was all green. I pressed the Deploy button to production with a terrifying level of confidence.

"Just a small rollout, should be fine..."

5 minutes later, Slack was screaming. The #alert, #ops, #order-system channels were burning red.

Grafana showed a strange spike: failed orders skyrocketed.

There were chilling log lines:

```
java.net.SocketException: Connection reset
org.apache.kafka.common.errors.TimeoutException
Connection refused: no further information
```

I froze. In just a few minutes, nearly a hundred orders vanished without a trace. They all stopped mid-process as if someone pressed "pause" then "delete".

## Investigation: Something's Not Right

We held an emergency meeting. No code errors. No Kafka errors. No DB errors.

Only one thing matched perfectly: the failed orders all occurred at the exact moment the new version was deployed.

Someone on the team suddenly asked:

"Has anyone set up graceful shutdown for this service?"

I was speechless. Everything became clear:

The old pod had just received requests that weren't finished processing when K8s sent the SIGTERM signal.

Spring Boot hadn't been configured for graceful shutdown, so it killed everything, clean kill. Kafka hadn't sent messages yet. DB hadn't committed yet. Incomplete data was wiped clean.

## Consequences: Production Collapsed Because of One Forgotten Config

No one thought forgetting one configuration line could create such consequences.

Nearly a hundred orders were lost, each had to be manually recovered.

4 hours of OT, a DevOps colleague and I sat restoring logs from Kafka to trace back requests.

An apology email to customers, along with compensation vouchers.

At that moment I just thought: "I wish I had known about this sooner."

## Awakening: How a Service Shuts Down Is as Important as How It Starts

I began researching graceful shutdown — a concept I had only skimmed before.

### Lesson One: Enable "Conscientious" Shutdown

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

This lets Spring wait for in-progress requests to complete before shutting down.

### Lesson Two: Say Goodbye to Kafka Properly

```java
@PreDestroy
public void cleanUp() {
    kafkaProducer.flush();
    kafkaProducer.close(Duration.ofSeconds(10));
    log.info("Kafka producer closed.");
}
```

If you don't close the producer properly, you're sending messages into… the void.

### Lesson Three: Don't Forget Your Thread Pool

```java
@Bean
public Executor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);
    return executor;
}
```

### Final Lesson: Readiness Probe Is a Lifesaver

```java
@EventListener
public void onAppShutdown(ContextClosedEvent event) {
    isReady.set(false); // readiness = false => K8s won't send new requests
}
```

If a Pod is shutting down but still receiving new requests, it's like… a dying patient being called to work.

## Conclusion

That incident was a painful but valuable lesson. It taught me that a system doesn't just need to be designed to run well, but also needs to be carefully prepared to stop properly.

In the world of microservices, where everything is tightly coupled and real-time, a service dying suddenly can create a domino effect, impacting data, user experience, and the reputation of the entire system.

Lessons learned:

1. Graceful shutdown is not optional — it's mandatory.
   Especially for services handling requests, communicating with Kafka, RabbitMQ, databases, or third parties.

2. Always configure server.shutdown: graceful and appropriate timeout-per-shutdown-phase.

3. Ensure critical resources are properly closed:
   - Kafka producer
   - Thread pool
   - DB connection
   - External clients

4. Use readiness probes to prevent a shutting-down Pod from receiving new requests.

5. Thoroughly test shutdown scenarios in staging — don't just test startup.

6. And finally: Avoid deploying on weekends if possible.
   Systems can fail, but production on-call staff also need time to live.

Writing good code is one thing. But operating systems safely and responsibly is another story — and one that's often less talked about.

I hope this article helps you avoid experiencing a "dark Friday" like mine.
