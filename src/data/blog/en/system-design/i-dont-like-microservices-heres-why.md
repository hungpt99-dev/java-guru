---
title: "I Don't Like Microservices, and Here's Why"
description: "A real-world perspective from a backend developer: when to and when not to use microservices, trade-offs with monoliths, and lessons for small teams."
pubDatetime: 2025-06-01T13:52:00+07:00
featured: true
draft: false
tags:
  - microservices
  - system-design
  - backend
  - career
---

Hello everyone! I'm Hưng Phạm, a backend developer who once thought microservices were the standard for every system — until I implemented and maintained them myself. And now, after many nights "wrestling" with dozens of logs from 4–5 different services, I've realized one thing: microservices are not the right solution for every system. Why? Let me share my story in detail, hoping it gives you a more realistic view of microservices.

## 1️. The Beginning — Microservices Were the "Holy Grail" of Tech

The first day I learned about microservices, the feeling was truly "awesome". The advertisements, the case studies from giants like Netflix, Amazon, Uber, Google… had me nearly mesmerized:

- "Break down the application, each part can be developed and deployed independently, as flexible as you want!"
- "Scale each service separately, avoiding having to scale the entire bulky application!"
- "If you don't follow microservices, you're falling behind — this technology is the future of software development!"

I immediately dove into learning Docker, Kubernetes, Service Mesh, automated CI/CD pipelines, API Gateway… the list of knowledge to learn was endless, to the point where project deadlines weren't as long as the knowledge needed to grasp. I thought I was opening a new horizon for my backend career.

## 2️. But Reality Wasn't Like the Dream

When I officially "microserviced" a few team projects — a small team of only 4–5 devs, I truly "absorbed" that microservices aren't simply about splitting code. It's a complex web that nearly drove me crazy:

- Network latency and timeouts: Just one slow service, and the entire system collapses like dominoes. A seemingly simple request runs through a dozen services, very prone to timeouts or mid-process failures.
- Complex deployment management: Each service has its own CI/CD pipeline, its own configuration, its own versioning. Deployment is no longer a simple button press but becomes a campaign.
- Painful data consistency problems: No more simple transactions. You have to think about eventual consistency, complex patterns like Saga, Orchestrator (Camunda, Temporal…) — just hearing this makes you want to "surrender".
- Debug logs tangled like a web: When production has issues, you have to dig through logs of multiple services, trace requests from one service to another. Sometimes it feels like being Sherlock Holmes groping in the dark.

## 3️. What Microservices "Steal" from Small Teams

With a small team, I realized microservices were "stealing" many valuable things from us:

1. Focus:
   - Monolith: One repo, one codebase, the whole team "kneading" together, easy to communicate, easy to understand the big picture.
   - Microservices: Each person "camps" in one service, communicating via API, losing cohesion, easily creating "silos" (factions) within the team.

2. Initial development speed:
   - Monolith: Deploy once, rollback once, small changes go up quickly.
   - Microservices: Scattered deploys, have to adjust configs in many places, rollback is also complex, much more time-consuming.

3. The joy of releasing features:
   - Monolith: When there's a feature, release it immediately, fast release, user feedback almost instant.
   - Microservices: Release each service, must ensure no conflicts, no API breakage, stressful because of coordinating multiple services simultaneously.

## 4️. But Microservices Aren't Exactly "Evil"

I don't deny that microservices have very valuable strengths:

- Independent scaling: "Hot" services can be scaled separately, saving more resources.
- Large autonomous teams: Each dev group can work on one or a few separate services, reducing dependencies, increasing long-term development speed.
- Easy to develop and replace individual modules: If you want to change one part, you don't need to touch the entire bulky monolith system.

## 5️. So When Should You Use Microservices?

I think microservices only truly shine when:

- The project has a large enough backend team (10+ devs), able to split teams by clear domains.
- Infrastructure is already strong, with automated CI/CD, good observability (logging, tracing, metrics…), no longer fumbling with deployments.
- The application has clearly independent domains, e.g.: payments, user management, logistics, each domain operating almost independently.
- Traffic volume is very large, needing to scale individual components efficiently to save costs and increase performance.

## 6️. And When Shouldn't You "Go Fancy"?

If you fall into these cases, I advise you to think carefully before "jumping" into microservices:

- Small team (3–5 devs), still "swimming" in backlog with tons of features to build.
- Simple application, only a few main modules, not yet at the level of needing complex scaling.
- Team lacks CI/CD and DevOps experience — microservices will "force" you to master DevOps first.
- Tight deadlines, e.g., 1 month to ship a product, instead of 1 year for sustainable development.

## 7️. Conclusion: I Don't Hate Microservices, I Just Don't Like "Trend-Chasing" Meaninglessly

Microservices aren't something evil, nor are they "good just because they exist". I just don't like small teams "copying" trends just because they sound cool, then making themselves miserable with an unnecessarily complex system.

The most important thing, in my opinion, is still:

- Understand the real problem.
- Choose architecture that fits team size, application nature, and the actual level of complexity needed.

In summary:

- Small team, few features, tight deadlines: Monolith is king.
- Large team, complex domains, high traffic: Microservices are the savior.

## 8️. And What About You?

Do you have a brilliant microservices success story? Or a failure that "shattered your face"? I'd really love to hear your story, so we can learn together, share experiences, and not waste time "taking detours" like I did.
