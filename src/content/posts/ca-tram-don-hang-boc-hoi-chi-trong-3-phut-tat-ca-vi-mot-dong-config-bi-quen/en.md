---
title: "A Hundred Orders Vanished in 3 Minutes – All Because of One Forgotten Config Line"
description: "A Friday evening deploy of order-service caused nearly a hundred orders to disappear in minutes: the old pods received SIGTERM while requests were still in flight, and Spring Boot had no graceful shutdown configured. The article covers what went wrong, the four fixes – graceful shutdown, closing the Kafka producer, waiting on the thread pool and flipping the readiness probe – and the lessons that followed."
slug: "ca-tram-don-hang-boc-hoi-chi-trong-3-phut-tat-ca-vi-mot-dong-config-bi-quen"
locale: "en"
translationKey: "ca-tram-don-hang-boc-hoi-chi-trong-3-phut-tat-ca-vi-mot-dong-config-bi-quen"
pubDate: 2025-06-18T22:13:35+07:00
category: "Backend Engineering"
tags: ["graceful shutdown", "microservice", "DevOps", "springboot", "case study"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 3
---

**Opening: A seemingly ordinary evening**

It was Friday, 8:00 PM, and my team was getting ready to roll out an update to order-service – the most important microservice in the company's order processing chain.

Everything went smoothly. Tests passed. CI/CD was bright green. I hit the Deploy button to the production environment with a confidence that was almost frightening.

"Just a small rollout, it'll be fine..."

Five minutes later, Slack started screaming. The `#alert`, `#ops`, `#order-system` channels lit up red.
Grafana showed a strange spike: the number of failed orders jumped.
There were chilling log lines:

```
java.net.SocketException: Connection reset
org.apache.kafka.common.errors.TimeoutException
Connection refused: no further information
```

I froze. Within minutes, nearly a hundred orders vanished without a trace. All of them stopped halfway, as if someone had pressed "pause" and then "delete".

![image.png](/images/articles/ca-tram-don-hang-boc-hoi-chi-trong-3-phut-tat-ca-vi-mot-dong-config-bi-quen/figure-1.png)

**Investigation: Something isn't right**

We held an emergency war room. No code bug. No Kafka bug. No DB bug.
There was only one thing that matched: the failed orders all fell exactly at the moment the new version was deployed.

Someone on the team suddenly asked:

"Has anyone set up graceful shutdown for this service?"

I was speechless. Everything started to become clear:
The old pod had just received a request it hadn't finished processing when K8s fired a `SIGTERM` at it.
Spring Boot hadn't been configured for graceful shutdown, so it just killed everything, cleanly. Kafka hadn't had time to send the message. The DB hadn't had time to commit. Half-finished data was wiped out.

**The fallout: Production fell over because of one forgotten config**

Nobody thinks forgetting a single line of configuration can cause consequences like that.

Nearly a hundred orders were lost and had to be restored one by one by hand.
4 hours of overtime, with me and a DevOps engineer sitting there restoring logs from Kafka to trace the requests back.
An apology email to customers, along with vouchers to make up for it.

At that moment I could only think: "I wish I'd known about this sooner."

**The realization: How a service shuts down matters as much as how it starts**

I started reading up on graceful shutdown – a concept I had only skimmed before.

**First lesson: Turn on "conscientious" shutdown mode**

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

This makes Spring wait for in-flight requests to finish before shutting down.

**Second lesson: Say goodbye to Kafka properly**

```java
@PreDestroy
public void cleanUp() {
    kafkaProducer.flush();
    kafkaProducer.close(Duration.ofSeconds(10));
    log.info("Kafka producer closed.");
}
```

If you don't close the producer properly, you're sending messages into... the void.

**Third lesson: Don't forget your thread pool**

```java
@Bean
public Executor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);
    return executor;
}
```

**Final lesson: The readiness probe is a lifeline**

```java
@EventListener
public void onAppShutdown(ContextClosedEvent event) {
    isReady.set(false); // readiness = false => K8s không gửi thêm request mới
}
```

If a pod is shutting down but still receives new requests, that's no different from... waking a dying patient up to go to work.

**Conclusion**

That incident was a painful but valuable lesson. It made me understand that a system doesn't just need to be designed to run well; it also has to be carefully prepared to stop the right way.

In the world of microservices, where everything is tightly coupled and real-time, a service dying abruptly can set off a domino effect that affects data, user experience and the credibility of the whole system.

**Lessons learned:**

1. Graceful shutdown is not optional – it's mandatory.
   Especially for services that handle requests, talk to Kafka, RabbitMQ, databases or third parties.

2. Always configure `server.shutdown: graceful` and an appropriate `timeout-per-shutdown-phase`.

3. Make sure important resources are closed properly:

   * Kafka producer
   * Thread pool
   * DB connection
   * External clients

4. Use a readiness probe to stop a pod that's about to shut down from receiving more requests.

5. Test shutdown scenarios thoroughly in staging – don't only test startup.

6. And finally: avoid deploying at the end of the week if you can.
   Systems can break, but the people on production duty also need time to live.

Writing good code is one thing. But running a system safely and responsibly is a different story – and one that gets talked about far less.
I hope this article helps you avoid going through a "dark Friday" like mine.
