---
title: "Senior Java Interview: Microservices"
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

Microservices interviews test judgment more than knowledge. The most senior answer to "design a microservice" is sometimes "don't, yet." The second-most senior answer starts with "which part of the monolith can we carve out first, and how do we keep shipping during the carve?" Nobody gets points for drawing more boxes.

> Mindset: a junior lists patterns; a senior narrates failure modes. When you answer with a number, a postmortem, or "here's the tradeoff and when I'd flip it," you've cleared the bar.

## Interview question ladder (Junior → Mid → Senior)

> Drill these out loud. Junior = "do you know the concept"; Mid = "do you know the tradeoffs"; Senior = "can you defend a decision under pressure, with a number and a postmortem."

### Junior — foundations

- **Q: What's the difference between a monolith and microservices?**
  A: A monolith is one deployable handling all domains; microservices are independently deployable services split by business capability, each with its own data. The tradeoff is team autonomy + independent scaling vs distributed complexity.

- **Q: What is the single most important rule about service databases?**
  A: Each service owns its data and exposes it only through its API — no shared database. Shared DBs quietly couple services and turn a "micro" architecture into a distributed monolith.

- **Q: What's an API gateway for?**
  A: It's the front door: routing, auth, rate limiting, and aggregation in one place, so individual services don't each reimplement cross-cutting concerns. (Though over-centralizing logic in the gateway is its own trap.)

- **Q: What's service discovery?**
  A: How services find each other's network locations at runtime (registry like Consul/Eureka, or DNS-based). Without it, you hardcode addresses and can't scale or relocate instances.

- **Q: Synchronous vs asynchronous communication — what's the difference?**
  A: Sync (HTTP/gRPC) waits for a response; the caller is blocked. Async (message/event) fires and moves on; the consumer processes later. Async decouples and absorbs spikes, but adds eventual-consistency reasoning.

### Mid — tradeoffs & pitfalls

- **Q: What is a distributed transaction and why is 2PC usually rejected?**
  A: 2PC (two-phase commit) tries to make a cross-service write atomic, but it holds locks across services and fails badly under partial failure — the classic "distributed transaction is a latency and availability bomb." The senior answer is SAGA + outbox + eventual consistency.

- **Q: What's the SAGA pattern and when do you use it?**
  A: A SAGA is a sequence of local transactions, each with a compensating action to undo the previous step on failure. Use it when you must keep multiple services consistent without 2PC. Tradeoff: you accept _eventual_ consistency and must handle compensations and out-of-order events.

- **Q: What's the outbox pattern and why do you need it?**
  A: Write the business change and the event to publish in the _same_ local DB transaction (an "outbox" table), then a relay publishes the event. It solves the dual-write problem (DB committed, but the message broker call failed → lost event, or vice versa → duplicate). The relay makes the event eventually consistent.

- **Q: What's the circuit breaker, and what are its states?**
  A: It wraps a failing downstream call and trips open after a threshold of errors, failing fast instead of piling up threads. States: closed → open (reject) → half-open (probe one call). Without it, one slow dependency cascades into a full outage (the "all my dependencies are healthy but I'm down" incident).

- **Q: What's a distributed monolith and how do you recognize it?**
  A: Services that can't be deployed or scaled independently because they share a DB, call each other synchronously in request paths, or block on each other's deploys. Tell: you can't ship one service without coordinating a release train. The cure is real bounded contexts + async where possible, not more boxes.

### Senior — design & defense

- **Q: "Design a microservice." What's the most senior first sentence?**
  A: Often "don't, yet" — or "which slice of the monolith do we carve first, and how do we keep shipping during the carve?" Nobody gets points for drawing boxes. The senior move is sequencing the extraction so each step is independently deployable and rollback-safe.

- **Q: A downstream payment service is slow and now YOUR service is timing out and OOMing. Walk the incident.**
  A: No timeout + no circuit breaker → your threads block on the slow call, the pool fills, requests queue, the heap fills with waiting contexts → cascade. Fix: per-call deadline (`tryLock`/HTTP timeout), circuit breaker to fail fast, bulkheads so one dependency can't consume all threads, and backpressure. Name the exact knob.

- **Q: You need cross-service consistency for "reserve seat + charge card." Design it without 2PC.**
  A: SAGA: reserve seat (local txn + event) → charge card (local txn + event) → if charge fails, compensate by releasing the seat. Outbox on each step so events are reliable. Idempotent handlers (events can redeliver). State the consistency window and what the user sees during it.

- **Q: How do you keep a rolling deploy safe when services depend on each other's new APIs?**
  A: Backward-compatible changes first (add, don't break), consumer-tolerant parsing, and contract tests in CI. Deploy the _provider_'s compatible change, then the _consumer_'s new call. Blue-green or canary so a bad deploy affects a slice, not everyone. DB migrations are forward/backward compatible (additive columns, no destructive rename until unused).

- **Q: When would you deliberately NOT split a service?**
  A: When the cost of the distributed system (network, consistency, ops, tracing) outweighs the benefit — a cohesive domain that changes together should stay one deployable. Splitting for "scalability" a service that's CPU-light is a fake win that multiplies failure modes. Judgment > dogma.

#### Self-check

- [ ] Junior: monolith vs microservices, database-per-service, what a gateway/discovery is, sync vs async.
- [ ] Mid: why 2PC is rejected, SAGA + compensation, the outbox pattern, circuit-breaker states, recognize a distributed monolith.
- [ ] Senior: "don't, yet" as the first answer, narrate a cascade incident with the exact fix, design a SAGA for a real flow, safe rolling-deploy sequencing, argue when NOT to split.

## 1. The distributed-monolith trap

Premature decomposition gives you **network calls instead of method calls**, distributed transactions, and 10× operational cost with none of the benefit. Every monolith you split pays an upfront tax: the network. A same-DC HTTP round trip is **~0.1–0.5 ms**; an in-process method call is **~1 ns**. You are voluntarily moving 2–3 orders of magnitude slower and calling it architecture.

The triggers that actually justify a split:

- **Independent deployability.** One team can ship daily without a joint release train. This is the #1 reason in practice.
- **Different scaling profiles.** A job-queue consumer and an API serving user traffic shouldn't share a heap — but note a separate worker pool inside one process often fixes this too.
- **Different failure domains.** Crash- or GC-isolation of one hot subsystem (see bulkheads below — the cheaper fix first).
- **Different teams/ownership.** Conway's law: the architecture follows the org chart. Splitting to match a team boundary is honest; splitting "because microservices" is cargo cult.

The senior counter-question before splitting: **"Can a modular monolith give us this?"** Boundaries at the _module_ level — each with its own package, own DB schema/table prefixes, own transaction scope, own API — buy you most of the enforceability with none of the network. When you split for real, you must introduce an **anti-corruption layer**: the new service exposes its own model and never leaks its internal tables to consumers, or the split hard-codes itself into every caller.

The data is the real split, not the code. "We'll move the code and keep the shared database" is how you get a **distributed monolith** — network calls _and_ shared coupling, the worst of both. A genuine split means a split database, which means every cross-service read becomes a join-across-network, which is where the saga/outbox machinery below comes from. If your callers can't tolerate eventual consistency for that data, you haven't actually split it.

## 2. Service communication — and the latency budget that decides the pattern

The first question isn't "REST or gRPC," it's **"how many synchronous hops can this request afford?"** Lay it out as a budget, because that's what interviewers probe:

```
User → API gateway → Service A → Service B → DB

A gateway hop:           ~1–5 ms  (routing + authn)
A same-DC service hop:   ~0.1–1 ms on the wire, but the *call* is more:
                         serialize + deserialize + thread scheduling + the
                         downstream's DB time + its queueing → P99 10–100 ms.
Budget: 500 ms P99 → 3 sync hops max, and each hop gets ~100 ms before
its caller's timeout fires and the whole chain degrades.
```

Go beyond 3 hops synchronously and you are playing musical chairs with timeouts. That's the real reason async wins in chains: **you cut the hop-latency terms out of the user request entirely.**

### REST vs gRPC — say the tradeoff, not the favorite

- **REST/HTTP:** ubiquitous, debuggable in any browser, trivially load-balanced, human-readable payloads. Costs: JSON parse/serialize on every hop, HTTP/1.1 head-of-line blocking per connection (mitigated by connection pools), no streaming story worth discussing, weak typing between teams.
- **gRPC:** HTTP/2 multiplexes many in-flight calls over **one connection** — no head-of-line blocking, ~half the framing overhead — and protobuf is binary: smaller payloads and near-zero parse cost. Streaming request/response for free. Costs: tooling friction, hard to eyeball in `curl`, schema changes are a **deploy contract** (protobuf's additive-field rules are a spec you must actually follow), and the async-server binding is where Spring WebFlux people earn their money.

The senior answer: "internal hot path, high QPS, I want streaming → gRPC. Public API, debugging surface, mixed consumers → REST." And the real gotcha either way is **timeouts, not protocol** — see the retry section before you touch any of this.

### Idempotency before retry, always

A retry without idempotency is a duplicate side effect with extra steps. The fix is an **idempotency key** the caller generates and the callee dedupes on — and it must be enforced in the _storage_, not in "we check a map":

```sql
-- WRONG — check-then-insert races: two retries both pass the SELECT,
-- both insert, you've charged the customer twice.
SELECT 1 FROM payments WHERE idempotency_key = 'CUST-42-RETRY-9';

-- RIGHT — the unique index is the arbiter, the insert is atomic.
CREATE UNIQUE INDEX uq_payments_idem ON payments(idempotency_key);

INSERT INTO payments (id, idempotency_key, amount, status)
VALUES (nextval('payments_id_seq'), 'CUST-42-RETRY-9', 19.90, 'PENDING')
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

No row returned → it was a duplicate → return the previously stored result. "We dedupe on the app side with `ConcurrentHashMap`" is how you lose money at 3 AM.

## 3. Resilience patterns — draw the states, then the numbers

### Circuit breaker

Closed → open on `failureRateThreshold` of the sliding window → **half-open after `waitDurationInOpenState`** to probe with a few trial calls → closed again or open again. The defaults are the answer: Resilience4j ships `failureRateThreshold=50%`, `slidingWindowSize=100`, `minimumNumberOfCalls=10`, `waitDurationInOpenState=60s`. State it and you sound like you've configured one, because you have.

The critical nuance interviewers probe: **an open breaker rejects fast (you save the in-flight work), but it also hides real traffic from the recovery probe.** Too aggressive a threshold and a momentary blip opens the breaker and takes the whole dependency offline. The half-open `permittedNumberOfCallsInHalfOpenState` (default 10) is the lever — it's how many calls get to _test_ recovery. Get the half-open probe wrong and you've replaced "slow dependency" with "dependency plus permanent 5-second cold starts on recovery."

### Bulkhead — isolation with a number

```java
// WRONG — one pool, one threadpool for everything: a slow 'reporting'
// endpoint slowly eats all 200 threads, and payments time out too.
ExecutorService everything = Executors.newFixedThreadPool(200);

// RIGHT — per-dependency pools, sized by Little's law:
//   pool_size = throughput × time_in_pool
//   50 req/s × 250 ms = ~13 threads for 'reporting';
//   give it 15, cap it, and payments never see its slowness.
ExecutorService reporting = new ThreadPoolExecutor(
    15, 15, 0, MILLISECONDS, new ArrayBlockingQueue<>(50), new CallerRunsPolicy());
ExecutorService payments = new ThreadPoolExecutor(
    10, 10, 0, MILLISECONDS, new ArrayBlockingQueue<>(30), new CallerRunsPolicy());
```

Little's law is the same math as thread pools (see the Java-core guide) — the microservices version is: **each external dependency gets its own bounded pool and its own circuit breaker**, so one dependency's collapse is quarantined. The cheaper semaphore bulkhead (`SemaphoreBulkhead`) is right when you don't need to offload work — a permit, no queue — and costs almost nothing.

### Retry + backoff + jitter — the self-inflicted DDoS

Naive `for (i < 3) retry` during an outage is the single most common self-DoS in production. Do the math:

```
10,000 instances each retrying 3× with no backoff = 30,000 requests
hitting a service that is already down → it never recovers.
Even WITH backoff: fixed 1s waits mean everyone retries on the same
tick — synchronized thundering herd. Jitter is what desynchronizes it.
```

The senior default is **exponential backoff with full jitter** — randomize the wait up to the computed cap:

```java
// WRONG — fixed 1s wait, all instances synchronized, and the retry
// hammers the same endpoint that is already falling over.
for (int attempt = 0; attempt < 3; attempt++) {
    try { return call(); } catch (IOException e) { Thread.sleep(1000); }
}

// RIGHT — exponential backoff with full jitter (Resilience4j):
// waits like 50–100, 100–200, 200–400 ms, randomized each attempt.
Retry retry = Retry.custom("payments")
    .maxAttempts(3)
    .intervalFunction(IntervalFunction.ofExponentialBackoff(
        Duration.ofMillis(100),   // initial
        2.0,                      // multiplier
        Duration.ofSeconds(2)))   // cap
    .build();

// and full jitter, if you want it desynchronized hard:
Retry jittery = Retry.custom("payments")
    .intervalFunction(IntervalFunction.ofRandomized(
        Duration.ofSeconds(1), Duration.ofSeconds(5)))
    .build();
```

Rules that end the argument: **retry only on idempotent calls** (or idempotency keys), **retry only on transient errors** (timeouts, `5xx`, connection resets — not `400s`), **cap total attempts and total time**, and **let the circuit breaker veto the retry** — a retry that runs while the breaker is open is just amplification.

```java
// The whole stack, in the right order:
// timeout(800ms) → retry(3, backoff+jitter) → circuit breaker
Supplier<String> decorated = Decorators.ofSupplier(() -> callDownstream())
    .withTimeout(Timeout.of(Duration.ofMillis(800)))
    .withRetry(retry)
    .withCircuitBreaker(CircuitBreaker.ofDefaults("payments"))
    .decorate();
```

### Timeout budget & deadlines — propagate the budget, don't grow it

Every service in a chain should take a **fraction** of the caller's total budget, and the budget must **shrink as it crosses the wire** (deadline propagation — gRPC carries it natively via metadata; in REST you pass it in a header). The classic failure: A calls B with 5s, B calls C with 5s, C calls D with 5s → the user asked for 5s total but the chain can legally take 20s. Then every intermediate retry _doubles_ the tail. State it as "a timeout must always be smaller than the one above it."

## 4. Service discovery, config, gateway

### Discovery

Eureka/Consul register instances and hand clients an address; K8s DNS just resolves a service name to a set of IPs. The senior angle is the **caching behavior**: if the client caches discovered addresses and the cache is stale while instances churn (deploy rolling, a node dies), requests hit dead endpoints and _that's_ what your retries now amplify. The discovery cache TTL and the "stale endpoint" failure mode are production real. Know that Consul uses gossip and a server quorum; Eureka has a self-preservation mode that keeps stale registry data when the network partitions — both are quirks an interviewer can probe.

### Config

Centralized config (Spring Cloud Config / K8s ConfigMap) gives you a change audit and a single place to push secrets — but the trick that separates senior engineers is **"does a config push restart my service or hot-reload it?"** Hot reload (Spring Cloud Bus / `@RefreshScope`) is great until someone refreshes a _secret rotation_ mid-request. Never cache config without a TTL and an invalidation path, and never put credentials in git — Vault or an external secrets backend, and rotate them.

### Gateway — the new single point of failure

The gateway concentrates authn, rate limiting, routing, and canary routing in one hop. The tradeoff to name: **it is now the most load-bearing box in the system**, and a gateway outage takes everything down — which is exactly the failure domain you'd have said a microservice should avoid. Mitigations worth saying out loud: stateless gateways scaled horizontally behind a load balancer, client-side discovery as a fallback, and BFF (backend-for-frontend) as the alternative when different clients need different aggregation. And for rate limiting, token-bucket in front of the gateway + quota checks in the services behind it — the gateway alone is bypassed by any client that calls services directly.

## 5. Distributed data & transactions — the part that's actually hard

### Saga: orchestration vs choreography

A saga is a sequence of local transactions with compensating actions. The orchestrated (central coordinator) version is easier to reason about — one state machine you can draw — but it's a bottleneck and a new single point of failure. Choreography (services react to events) avoids the coordinator but scatters the state machine across every service and is a tracing nightmare: "who started this order and why is it in state X?" is a cross-service archaeology dig.

```java
// Orchestrated saga: the coordinator is the only place the flow exists.
// Each step runs in its own local transaction; every step has a
// compensate() that undoes it in its own local transaction.
@Component
public class OrderSaga {
    // start → pay → reserveInventory → ship
    //         ↑ on failure: compensate() each completed step, reverse order
    public void run(CreateOrderCommand cmd) {
        Order order = orderRepo.save(cmd.toOrder());        // local tx
        try {
            paymentClient.authorize(order.getPaymentId());  // RPC
            inventoryClient.reserve(order.getItems());      // RPC
            shipmentClient.schedule(order.getId());         // RPC
            order.complete(); orderRepo.save(order);
        } catch (SagaStepException e) {
            // reverse every step that already committed — each in its own tx
            compensate(order, cmd, e);
            order.fail(e); orderRepo.save(order);
        }
    }
}
```

The compensating actions are the part juniors forget: **a compensation is not a rollback** — it's a new local transaction that fixes up what a previous one did (refund the charge, release the reservation). "Compensation = undo" is the standard senior-filter question. And if a compensation itself fails, you have a **stuck saga** — that's why a real design logs every saga step to a persistent state table the operator (or a sweeper job) can drive to completion. Nobody says this, but that state table is the saga's transaction log, and it's what makes the whole thing auditable.

### 2PC — mention it only to explain why you don't use it

Two-phase commit holds locks across all participants while the coordinator asks "ready?" — during the prepare phase the data is locked, and if the coordinator dies or the network partitions, the locks stay held. On a long-running business flow that means transactions that could hang for minutes while resources stay locked. The classic line: "2PC gives you atomic commit _only if_ every participant and the coordinator stay up — the one thing a distributed system doesn't promise." That's the answer. Then move on to the outbox.

### The dual-write problem and the transactional outbox

Whenever a service writes to its DB **and** publishes an event to Kafka, the two writes are not atomic — crash between them and you've lost an event, or double-sent it. The transactional outbox fixes both: **write the event into the same database transaction as the business change**, then a relay publishes it.

```sql
-- one local transaction:
INSERT INTO order (id, state) VALUES (?, 'CREATED');
INSERT INTO outbox (aggregate_id, event_type, payload, published_at)
VALUES (?, 'order.created', jsonb_build_object('id', ?), NULL);
```

```java
@Transactional
public Order createOrder(CreateOrderCommand cmd) {
    Order order = orderRepo.save(cmd.toOrder());
    outboxRepo.save(OutboxEvent.of("order.created", order.getId())); // same tx
    return order;  // commit publishes nothing yet — the relay does
}
```

```java
// relay: poll for unpublished rows, publish, mark published.
// FOR UPDATE SKIP LOCKED = many relay instances without fighting.
List<OutboxEvent> pending = outboxRepo.findUnpublished(100); // ... SKIP LOCKED
for (OutboxEvent evt : pending) {
    kafkaTemplate.send("orders", evt.getPayload());
    evt.markPublished();
}
```

Now the guarantee is at-least-once (relay may crash after publish before marking) — which is fine **because consumers are idempotent** (section 2). That idempotency + outbox combo is the closest thing to a distributed transaction that survives production, and naming it unprompted is a strong senior tell.

### Event ordering and the poison-message variant

Ordering is only guaranteed per-partition; key all events for one aggregate by its id so they land on one partition (Kafka guide covers this). And any consumer that processes "we received a duplicate" by _double-crediting_ is the reason idempotency is a storage concern, not a hope.

### Distributed locking — when you actually need it

For the rare genuinely critical section across services (job coordination, per-tenant counters), a DB-based lock with a lease beats Redis SETNX with a bug:

```sql
-- RIGHT — lease-backed: the row IS the lock, expires if the holder dies,
-- and the holder must check it still holds before doing the work (fencing).
INSERT INTO job_lock (name, holder, lease_expires_at)
VALUES ('reindex', 'node-7', now() + interval '30 seconds')
ON CONFLICT (name)
DO UPDATE SET holder = 'node-7', lease_expires_at = now() + interval '30 seconds'
WHERE job_lock.holder = 'node-7' OR job_lock.lease_expires_at < now()
RETURNING holder;
```

The pitfall everyone hits: a lock with a fixed TTL and a holder that's slow (GC pause) — the lease expires, a second holder takes the lock, and now two "holders" run. The fix is a **fencing token**: the lock hands out a monotonically increasing token and the protected resource refuses writes with an older token (like a DB version column). Mentioning fencing tokens is worth a nod; that's a senior answer.

## 6. Observability — the difference between a senior and a demo

A senior designs the tracing from day one, not after the incident. Say these three concrete things:

- **Distributed tracing with correlation IDs.** Every request carries a `trace-id`/`span-id` (W3C Trace Context), propagated across every hop and into the async path — otherwise an event-driven saga is untraceable. OpenTelemetry + a collector.
- **RED metrics, not vague "uptime."** Rate, Errors, Duration per service — and per _dependency_, so the circuit breaker's health is visible from outside. "We monitor our services" means you can point at a dashboard that shows the _chain_, not just one box.
- **Structured logs with the correlation ID in every line**, plus log aggregation. "The request failed somewhere in the chain" becomes "here is the exact 15ms span."

The production failure-mode test: "our P99 went 80 ms → 3 s after a deploy." The answer pattern is symptom → tool → finding → fix, exactly like the Java-core guide: pull the trace, see which hop ate the time, check that service's breaker state and its dependency's pool, and fix the _cause_ — usually a slow dependency with an unbounded queue or a missing timeout, not "add more instances."

## 7. Self-check

- [ ] Name two reasons NOT to split a monolith, and why the data is the real split.
- [ ] Write the timeout budget for a 3-hop synchronous chain and explain deadline propagation.
- [ ] Explain circuit breaker + bulkhead with a real example and the Little's-law sizing.
- [ ] Why are naive retries during an outage dangerous — with the numbers?
- [ ] What does the transactional outbox solve that 2PC cannot, and why is it at-least-once?
- [ ] Explain why an idempotency key must be enforced at the storage layer.
- [ ] Orchestration vs choreography — the tradeoff, and where each fails.
- [ ] What does "a compensation is not a rollback" mean, and what happens when a compensation fails?
- [ ] How do you trace an event-driven saga end to end?

## 8. Interviewer follow-ups

- "You split the monolith and now the checkout is 4 synchronous hops. Walk me through the latency budget — where does the time go, and what do you change?"
- "A retry storm just hit your payment service. What's your first lever — the retry config, the breaker, or the queue — and why?"
- "The outbox relay published an event twice because it crashed after `send`. Your consumer double-credited a user. What was the actual bug, and what's the fix?"
- "Your discovery cache is stale and clients are hitting dead instances. What breaks first, and how do your resilience patterns hide it?"
- "The gateway is down and everything is offline. Is that acceptable, and what did you design to survive it?"
- "A saga compensation fails mid-way and the order is stuck in PENDING. Who fixes it, and what's in the DB to make that possible?"
- "gRPC or REST for an internal payments API at 10k QPS with streaming? Give me the tradeoff, not the slogan."
- "Why is a fixed-backoff retry worse than a jittered one — show me the distribution difference."
- "Your consumer reads events out of order for one order id. What guarantees were violated, and how do you restore per-aggregate order?"
- "You're about to call a new service that has no timeouts, no breaker, and no pool bounds. What's the single first thing you add before enabling it?"

That's the microservices bar.
