---
title: "Why Twilio Segment Said Goodbye to Microservices and Returned to Monolith"
description: "Analyzing the Twilio Segment case study: from a microservices architecture with hundreds of services to the decision to return to a modular monolith."
pubDatetime: 2025-09-20T04:31:00+07:00
featured: false
draft: false
tags:
  - microservices
  - system-design
---

## 1. An Ambitious Beginning

Segment was born in the era of "everything should be microservices."

They built a data ingestion system to collect hundreds of thousands of events per second from web, mobile, and backend apps, then distribute them to hundreds of destinations like Google Analytics, Mixpanel, Facebook Ads, or custom webhooks.

The initial architecture was very straightforward:

- API service receives events, pushes to queue.
- On dequeue, the system checks user config to decide which destinations to send to.
- Each request is sent sequentially; on failure, retry; on non-retryable errors (invalid credentials, missing fields), drop.

At that time, microservices seemed like the bright path: each part separated, easy to debug, easy to scale. But things didn't last long.

## 2. When Everything Started Falling Apart

### Head-of-line Blocking

The first problem appeared: head-of-line blocking.

All new events and retries sat in one large queue. If one external destination timed out or was rate-limited, retry events returned to the queue → backlog grew. Result: latency increased for all destinations, even those running normally.

### Separate Queue and Service for Each Destination

To reduce blocking, Segment created a separate queue + service for each destination. A new router emerged: it received events, cloned them, and sent them to each destination queue.

This helped isolate better: if one destination had errors, it only affected its queue, not slowing down the entire system. But the downsides began to show.

### Shared Library and Dependency Hell

Initially, all destinations lived in one large repo. Result: one test failure could break tests for the entire system. To separate, they moved each destination to its own repo.

But the problem was: code duplication everywhere. They built a shared library to handle common logic like event transformation, HTTP handling. However:

- Updating the shared library required version bumps across many repos.
- No strict versioning → each destination used a different version.
- Some destinations had low traffic → auto-scaling was inefficient, or required manual scaling during spikes.

And so, the number of repos, queues, versions, and test suites exploded. Operational overhead became a nightmare.

## 3. When Microservices Became a Burden

Some numbers showing how Microservices eroded productivity:

- Number of destinations grew from dozens to over 100+.
- On average each month, the team had to build 3 new destinations → meaning new queues, repos, services.
- At one point, 3 full-time engineers were needed just to "keep the system alive."
- Shared library improvements were minimal: only 32 times in several years because each update was a release nightmare.

Microservices were no longer an engine of growth, but a barrier to product velocity.

## 4. The Counter-Current Decision: Back to Monolith

Segment decided: bring everything back together. But not back to a "Big Ball of Mud," rather a modular monolith.

### Centrifuge — Central Router

They built Centrifuge, a router replacing the old system. Centrifuge receives events and distributes them to a single delivery service, instead of dozens of separate queues + services.

### Monorepo

They merged all code into a monorepo. All dependencies consolidated to a single version (about 120 unique libraries). If a destination was incompatible, they fixed it immediately, rather than letting each repo drift with its own version.

Result: consistent build & test, no more "version zoo."

### Traffic Recorder

Testing was also overhauled. Instead of each test run having to call external APIs (flaky, timeout, credential errors), they used a traffic recorder based on yakbak:

- First test run → record HTTP request + response.
- Subsequent runs → replay, no need to call externally.

Thanks to this, the test suite for 140+ destinations ran quickly, reliably, taking milliseconds instead of minutes or even random failures.

## 5. Results: Productivity Skyrocketed

When the monolith went live:

- Developer productivity increased: in just one year they made 46 shared library improvements, compared to 32 over several years with microservices.
- Ops load dropped significantly: instead of monitoring hundreds of queues & services, now only one main system to monitor. A large worker pool serving mixed traffic performed better, scaling more efficiently.
- Simple deploys: a small change in the shared library now only required deploying one service.
- Stability increased: less on-call, fewer middle-of-the-night incidents.

## 6. Trade-offs to Accept

Monolith isn't perfect. Segment acknowledged some drawbacks:

| Issue              | Detail                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fault isolation    | A bug in one destination could crash the entire service since everything runs together.                                                                                             |
| Warm cache         | With small microservices, in-memory cache was easy to warm, cache hit rate was high. Monolith with more processes → distributed cache, harder to warm evenly, lower cache hit rate. |
| Dependency updates | When updating a shared library, it affects all destinations simultaneously. If tests aren't sufficient, risk spreads widely.                                                        |

They accepted these trade-offs because the benefits in velocity and simplicity were greater.

## 7. Lessons Learned

Segment's story carries many meanings for devs, tech leads, and CTOs:

- Architecture is a tool, not dogma. Microservices sound sexy, but aren't always appropriate.
- Modular monolith is a reasonable choice. It allows a large codebase while still separating modules, testable and maintainable.
- Tooling matters more than hype. Traffic recorder, monorepo build, CI/CD pipeline… determine success or failure.
- Trade-offs are inevitable. There's no perfect architecture. What matters is choosing what fits your stage and team capability.

## 8. Conclusion

Twilio Segment once "dreamed" of microservices: each destination a service, each service a queue, each repo its own world. But when scaling to hundreds of services, microservices became a "small nightmare": overhead, slowness, fragility.

They made a bold move: bring everything into a modular monolith, with Centrifuge, monorepo, and traffic recorder. Result: velocity up, stability high, ops lighter.

The biggest lesson:

👉 Don't choose architecture because of hype. Choose architecture because your team can live with it.

References

Twilio Segment – Goodbye Microservices: https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices
