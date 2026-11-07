## 1. An ambitious beginning

Segment was born in the era when "everything should be microservices."
They built a data ingest system to collect hundreds of thousands of events per second from web, mobile and backend apps, then fan them out to hundreds of **destinations** such as Google Analytics, Mixpanel, Facebook Ads, or custom webhooks.

The initial architecture was very straightforward:

* An **API service** receives the event and pushes it into a queue.
* On dequeue, the system checks the user config to decide which destinations to send to.
* Each request is sent sequentially; on failure it retries, and if the error cannot be retried (invalid credential, missing field) the request is dropped.

At the time, microservices looked like the bright path: each piece separated, easy to debug, easy to scale. But it did not last.

---

## 2. When things started to get messy

### Head-of-line blocking

The first problem showed up: **head-of-line blocking**.

All new events and retries sat in one big queue. If an external destination timed out or got rate limited, the retry events went back into the queue → the backlog grew. The result: latency increased for every destination, including the ones that were running fine.

### Splitting queues and services per destination

To reduce blocking, Segment created **one queue + one service per destination**. A new router appeared: it received events, cloned them and sent them to each destination queue.

This gave better isolation: a failing destination only affected its own queue and did not drag the whole system down. But the downside started to show.

### Shared library and dependency hell

At first, all destinations lived in one large repo. The result: one failing test could break the test suite for the entire system. To separate things out, they moved each destination into its own repo.

But the problem was: code was duplicated everywhere. They built a **shared library** to handle common logic such as transforming events and HTTP handling. However:

* Updating the shared library required bumping the version across many repos.
* There was no strict versioning → each destination ran a different version.
* Some destinations had low traffic → auto-scaling was ineffective, or they had to scale manually during spikes.

As a result, the number of repos, queues, versions and test suites exploded. **Operational overhead** became a nightmare.

---

## 3. When microservices became a burden

A few numbers show how microservices were eating into productivity:

* The number of destinations grew from a few dozen to more than **100+**.
* On average, the team had to build 3 new destinations every month → meaning new queues, repos and services.
* At one point it took **3 full-time engineers** just to "keep the system alive."
* The shared library improved very little: only **32 times over several years**, because every update was a release nightmare.

Microservices were no longer the engine of growth; they had become a barrier to **product velocity**.

---

## 4. Going against the current: back to the Monolith

Segment decided to **consolidate everything**. But not back to a "Big Ball of Mud" — rather a **modular monolith**.

### Centrifuge – the central router

They built **Centrifuge**, a router to replace the old system. Centrifuge receives events and distributes them to a single **delivery service**, instead of dozens of separate queues + services.

### Monorepo

They merged all the code into a **monorepo**. All dependencies were consolidated onto a single version (around 120 unique libraries). If a destination was incompatible, they fixed it right away instead of letting each repo drift on its own version.

The result: consistent builds and tests, no more "version zoo."

### Traffic Recorder

Testing was overhauled too. Instead of calling out to external APIs on every test run (flaky, timeouts, credential errors), they used a **traffic recorder** based on yakbak:

* The first test run → record the HTTP request + response.
* Later runs → replay them, with no calls to the outside world.

Thanks to that, the test suite for **140+ destinations** ran fast and reliably, in a few milliseconds instead of a few minutes or even random failures.

---

## 5. The result: productivity took off

Once the monolith went live:

* **Developer productivity** went up: in a single year they shipped **46 shared library improvements**, versus 32 over several years while on microservices.
* **Ops load dropped sharply**: instead of monitoring hundreds of queues & services, they now monitor one main system. A large worker pool serves mixed traffic better and scales more efficiently.
* **Deployment became simple**: a small change in the shared library now requires deploying a single service.
* **Stability improved**: fewer on-call pages, fewer incidents in the middle of the night.

---

## 6. Trade-offs to accept

The monolith is not perfect. Segment admitted a few downsides:

| Issue                  | Detail                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fault isolation**    | A bug in one destination can crash the entire service because everything runs together.                                                                      |
| **Warm cache**         | With small microservices, in-memory caches are easy to **warm**, giving a high cache hit rate. A monolith has more processes → the cache is spread out, hard to warm evenly, and the cache hit rate is lower. |
| **Dependency updates** | Updating a **shared library** affects every destination at once. If the tests are not thorough enough, the risk spreads widely.                              |

They accepted the trade-offs because the benefits in **velocity** and **simplicity** were greater.

---

## 7. Lessons learned

Segment's story carries a lot of meaning for devs, tech leads and CTOs:

1. **Architecture is a tool, not dogma.** Microservices sound sexy, but they are not always a good fit.
2. **A modular monolith is a reasonable choice.** It allows a large codebase that is still split into modules, testable and maintainable.
3. **Tooling matters more than hype.** Traffic recorders, monorepo builds, CI/CD pipelines… decide success or failure.
4. **Trade-offs are inevitable.** There is no perfect architecture. What matters is picking the one that fits your stage and your team's capability.

---

## 8. Conclusion

Twilio Segment once "dreamed big" with microservices: one service per destination, one queue per service, one world per repo. But as they scaled to hundreds of services, microservices turned into a "tiny nightmare": overhead, slowness, fragility.

They chose a bold step: consolidate everything into a **modular monolith**, with Centrifuge, a monorepo, and a traffic recorder. The result: higher velocity, high stability, lighter ops.

The biggest lesson:

👉 **Don't pick an architecture because of hype. Pick an architecture your team can live with.**

---

### References

* Twilio Segment – *Goodbye Microservices*: [https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices](https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices)
