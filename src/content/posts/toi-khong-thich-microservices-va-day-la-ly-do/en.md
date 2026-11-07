---
title: "I Don't Like Microservices, and Here's Why"
description: "Hi everyone! I'm Hưng Phạm, a backend developer who used to think microservices were the standard for every system – until I deployed and maintained them myself."
slug: "toi-khong-thich-microservices-va-day-la-ly-do"
locale: "en"
translationKey: "toi-khong-thich-microservices-va-day-la-ly-do"
pubDate: 2025-06-01T20:52:15+07:00
category: "Microservices"
tags: ["Backend", "Build System", "microservice"]
featured: true
draft: false
series: null
coverImage: "./cover.png"
readingTime: 5
---

Hi everyone! I'm Hưng Phạm, a backend developer who once believed microservices were the standard for every system – until I deployed and maintained them with my own hands. And now, after many nights "wrestling" with piles of logs from 4–5 different services, I've realized one thing: microservices are not the right solution for every system. Why? Let me tell you my story in detail, hoping it helps you get a more realistic view of microservices.

---

### 1️. In the beginning – microservices were the technological "holy grail"

The first day I learned about microservices, it genuinely felt "great". The marketing pitches, the case studies from giants like Netflix, Amazon, Uber, Google… left me almost mesmerized:

* "Split your application up, each part can be developed and deployed independently, flexible as you like!"
* "Scale each service separately, avoid having to scale the whole bloated application!"
* "If you don't follow microservices, you're falling behind; this technology is the future of software development!"

I immediately dove into Docker, Kubernetes, Service Mesh, automated CI/CD pipelines, API Gateway… the list of things to learn was endless, to the point where the project deadline was shorter than the list of knowledge I needed to grasp. I thought I was opening a new horizon for my backend career.

![image.png](/images/articles/toi-khong-thich-microservices-va-day-la-ly-do/figure-1.png)
---

### 2️. But reality is not like the dream

Once I actually "microfied" a few of my team's projects – a small team of only 4–5 devs – I truly "absorbed" that microservices aren't simply about splitting code. It's a complex web that nearly drove me insane:

* **Network latency and timeout:** One slow service and the whole system falls like dominoes. A seemingly simple request runs through a dozen services, and it's very easy to hit a timeout or fail midway.
* **Complex deployment management:** Each service has its own CI/CD pipeline, its own config, its own versioning. Deploying is no longer a simple button press but turns into a campaign.
* **The headache of data consistency:** No more simple transactions. You have to think about eventual consistency, complex patterns like Saga, Orchestrator (Camunda, Temporal…) – hearing that much makes you want to "surrender" on the spot.
* **Debug logs tangled like a ball of yarn:** When production has problems, you have to dig through the logs of many services, tracing requests from one service to another. Sometimes it feels like I'm Sherlock Holmes groping around in the dark.

---

### 3️. The things microservices "steal" from a small team

For a small team, I realized microservices were "stealing" a lot of valuable things from us:

1. **Focus:**

   * Monolith: One repo, one codebase, the whole team "shaping" it together, easy to communicate, easy to grasp the big picture.
   * Microservices: Each person "camps" inside one service, communicating via API, the cohesion is gone, easily creating "silos" (factions) in the team.

2. **Initial development speed:**

   * Monolith: Deploy once, roll back once, small changes ship quickly.
   * Microservices: Scattered deploys, you have to align config in many places, rollback is also complex, far more time-consuming.

3. **The joy of releasing features:**

   * Monolith: Any feature gets shipped right away, fast release, user feedback almost instant.
   * Microservices: Release service by service, you have to make sure nothing collides, nothing breaks the API, stress because you have to coordinate many services at once.

---

### 4️. But microservices aren't exactly "evil"

I don't deny that microservices have very valuable strengths:

* **Independent scaling:** Whichever service is "hot" can be scaled separately, saving resources.
* **Autonomous large teams:** Each dev group can work on one or a few separate services, reducing dependency, speeding up development in the long run.
* **Easy to develop and replace each module:** If you want to change one part, you don't need to touch the whole bloated monolith.

---

### 5️. So when should you use microservices?

I think microservices only really pay off when:

* The project has a **sufficiently large backend team** (10 devs or more), able to split teams clearly by domain.
* The infrastructure is strong enough, with **automated CI/CD**, **good observability** (logging, tracing, metrics…), and deployments are no longer unfamiliar.
* The application has many clearly independent domains, for example: payments, user management, warehouse operations – each domain operates almost independently.
* Traffic volume is very large, and you need to **scale each component** efficiently to save cost and increase performance.

---

### 6️. And when should you not "live large"?

If you fall into the following cases, I advise you to think carefully before "jumping" into microservices:

* Small team (3–5 devs), still "swimming" in a backlog with dozens of features to build.
* Simple application with only a few main modules, not yet at the point of needing complex scaling.
* The team has no CI/CD or DevOps experience; microservices will "force" you to become proficient in DevOps first.
* Tight deadline, for example 1 month to ship a product instead of 1 year to develop sustainably.

---

### 7️. Conclusion: I don't hate microservices, I just don't like meaningless "trend chasing"

Microservices are not something evil, nor are they "good just because you have them". I just don't like the fact that small teams get "peer-pressured" into a trend simply because it's loud, and then make themselves miserable with an unnecessarily complex system.

The most important thing, in my view, is still:

* **Understand the real problem clearly.**
* **Choose an architecture that fits the team size, the nature of the application, and the level of complexity actually needed.**

In short:

* Small team, few features, tight deadline: **Monolith is king.**
* Large team, complex domains, heavy traffic: **Microservices are the savior.**

---

### 8️. And what about you?

Do you have a brilliantly successful microservices story? Or one that failed so badly it "smashed your face in"? I'd really love to hear your story, so we can learn together, share experience, and avoid wasting time taking the "detours" I once went through.
