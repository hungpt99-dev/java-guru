---
title: "Java Interview Prep #6: Microservices — Junior to Senior"
description: "Microservices at senior level is mostly about knowing when NOT to use them — resilience patterns, service communication, and distributed transactions."
pubDatetime: 2026-08-10T10:10:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - microservices
  - resilience
---

Microservices are the topic where senior judgment matters most, because the wrong answer is "let's split the monolith". Junior developers draw service boxes; seniors explain why a monolith was the right call for years and what specifically forced the split. This post walks from service boundaries to the distributed-transaction trap.

> Mindset: junior lists the benefits of microservices; senior can name three concrete costs they introduce and the exact trigger that justifies paying them.

## Junior — foundations

**Q1. What is a microservice and how does it differ from a monolith?**
A microservice is a small, independently deployable service owning one business capability, with its own data store. A monolith is one deployable unit. Microservices buy independent scaling, isolated failures, and team autonomy; they pay with network calls, distributed data, and operational complexity.

**Q2. What is the difference between synchronous and asynchronous communication?**
Synchronous (HTTP/RPC): caller blocks waiting for a response — tight coupling, the callee's outage blocks you. Asynchronous (message/event bus): caller publishes and continues — loose coupling, better resilience, but eventual consistency and harder debugging. Choose sync for request/response needing the answer now; async for fire-and-forget or decoupling.

**Q3. What is an API gateway and what does it do?**
A single entry point for clients that handles routing, auth, rate limiting, and often aggregation. It hides the internal service topology so clients don't need to know every service's address. Without it, clients couple to many services and you can't enforce cross-cutting policies in one place.

**Q4. What is service discovery?**
Instead of hardcoding service addresses (which change as pods scale/move), services register themselves with a registry (Consul, Eureka, K8s DNS) and look each other up. Enables dynamic scaling and resilience to restarts. Hardcoded hostnames break the moment a pod reschedules.

**Q5. What is a circuit breaker and why do you need one?**
When a downstream service is slow/failing, naive retries pile up and exhaust your threads — one dead dependency cascades to take down your whole service. A circuit breaker trips after N failures, failing fast for a cooldown window instead of waiting on timeouts, then half-opens to test recovery. It contains the blast radius.

**Q6. What is the difference between an API and an event?**
An API call is a direct request for an action/response (imperative: "do this"). An event is a fact that happened ("order placed"), broadcast to anyone interested (declarative). APIs couple caller→callee; events decouple producer from consumers. Confusing the two leads to chatty, fragile synchronous graphs where events would have been cleaner.

## Mid — tradeoffs & pitfalls

**Q1. What is the database-per-service rule and why is shared DB an anti-pattern?**
Each service should own its data; a shared database couples services at the storage layer — a schema change in one service breaks another, and transactions span services. The anti-pattern (shared DB) quietly turns your "microservices" into a distributed monolith. If two services must share a table, that's a signal they're one bounded context.

**Q2. How do you handle a distributed transaction across two services?**
You usually **don't** use a 2PC (two-phase commit) — it's a distributed lock that doesn't scale and fails badly under partial failure. Instead use the **Saga** pattern: a sequence of local transactions, each with a compensating action to undo on failure (e.g. "reserve → if ship fails, release"). Sagas trade atomicity for availability; you accept eventual consistency and build compensation logic.

**Q3. What is eventual consistency and what breaks for users?**
After a write, not all readers see it immediately — replicas/derived data converge over time. What breaks: a user updates their profile and refreshes to the old version (confusing), or reads their own write from a replica that hasn't caught up. Mitigation: read-your-writes (read from primary right after a write), or serve the just-written value from the client.

**Q4. What is the difference between idempotency and exactly-once, and why does it matter for retries?**
A retry can deliver a message twice. **Idempotency** means processing it twice has the same effect as once (e.g. a dedupe key, or `UPDATE ... WHERE version = x`). **Exactly-once** (true, end-to-end) is nearly impossible across services. So you build idempotent handlers and accept at-least-once delivery — far more robust than chasing exactly-once.

**Q5. What is bulkhead isolation?**
The bulkhead pattern limits how much of your resources one dependency can consume (separate thread pools / connection pools per downstream). If service B hangs, it can only fill its own bulkhead, not the pool shared with C and D — containing the failure. Without it, one slow dependency exhausts the shared pool and everything dies together.

**Q6. How do you debug a request that spans 8 services?**
Distributed tracing (OpenTelemetry/W3C trace context) propagates a trace ID across service calls, so you see the full waterfall and where time was spent. Without tracing you're blind — logs per service don't tell you the path. Pair it with centralized structured logging keyed by trace ID. A senior insists on tracing _before_ the system gets big, not after.

## Senior — design & defense

**Q1. A team wants to split a 3-year-old monolith into 20 microservices. What do you say?**
"I'd push back hard. Microservices are an org and ops decision, not a technical silver bullet. The monolith's problem is probably a missing module boundary or a deployment bottleneck — fix those first (modular monolith). I'd split only along a _proven_ bounded context that has different scaling or team-ownership needs, and do it incrementally (strangler fig), not a big-bang 20-service rewrite that multiplies failure modes overnight. The cost of 20 services (network, distributed data, on-call) only pays off if the independence is real."

**Q2. Design a payment flow across Order, Inventory, and Payment services without 2PC.**
"Saga. Order service starts: `reserve inventory` (local txn + compensate `release`), then `charge payment` (local txn + compensate `refund`). If payment fails, the saga orchestrator triggers `release inventory`. Each step is a local transaction with a compensating action; the saga log lets us resume after a crash. I'd use an orchestration saga (a coordinator) over choreography (events) here, because the flow has clear order and failure handling — choreography gets hard to reason about at 3+ steps. The trade: no global lock, but I must handle partial failure and eventual consistency explicitly."

**Q3. A downstream HTTP call is flaky (5% timeouts). Design the resilience layer.**
"Three layers: (1) **timeout** shorter than my SLA so I fail fast, not hang; (2) **circuit breaker** to stop hammering a dying dependency and fail fast during its outage; (3) **retry with backoff + jitter** for transient blips, but only idempotent calls. Plus **bulkhead** so this dependency can't eat my whole thread pool. And a fallback (cached/stale value, or queued for later) so the user gets a degraded-but-working response. I measure the downstream's timeout rate and the breaker's open ratio to tune thresholds from reality."

**Q4. When is a monolith actually the better choice, and how do you keep it clean?**
"For a small team, a young product, or a domain without independent scaling needs — a modular monolith is faster to build, debug, and deploy, with no distributed failure modes. Keep it clean with explicit module boundaries (packages that don't import each other's internals), a single deploy, and one database with clear schema ownership. Migrate to services only when a boundary's scaling/team needs diverge. Premature splitting is the most common microservice mistake I see."

**Q5. How do you choose sync vs async between two specific services, with a concrete example?**
"Order → Inventory for 'reserve stock': if the user is waiting on the confirmation, sync (I need the answer now, and a timeout is a clear failure to show). Order → Notification/Analytics: async event ('order placed'), because nobody's blocking on it and I want resilience if those services are down. Rule of thumb: sync for the happy-path request the user is blocked on; async for side-effects and fan-out. Mixing them wrongly (sync to 5 services in a row) creates a latency chain that fails as the slowest link."

**Q6. Defend your service boundaries — how do you know a split is right?**
"A correct boundary is a bounded context: one reason to change, one team owns it, it can be deployed and scaled alone, and its data is private. I'd test the split by asking: 'If I change service A's schema, does B need to redeploy?' If yes, they're one context pretending to be two. The proof is operational: independent deploy frequency and failure isolation. If A and B always deploy together and share a DB, I've built a distributed monolith and should merge them. Boundaries are validated by deploy/scale/failure independence, not by drawing boxes."

#### Self-check

- [ ] Junior: I can explain microservice vs monolith, sync vs async, API gateway, service discovery, circuit breaker, and API vs event.
- [ ] Mid: I can explain database-per-service, the Saga pattern, eventual consistency, idempotency vs exactly-once, bulkhead, and distributed tracing.
- [ ] Senior: I can argue against premature splitting with a modular-monolith alternative, design a 2PC-free payment saga, build a resilient HTTP layer (timeout+breaker+retry+bulkhead), and defend service boundaries by deploy/scale/failure independence.
