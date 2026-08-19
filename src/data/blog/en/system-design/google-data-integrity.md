---
title: "Data Integrity and Transactional Correctness: Google SRE's Principles"
description: "A source-backed system-design treatment of transactions, recovery, load shedding, and client-side throttling."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

[SOURCE FACT] Google SRE defines data integrity in user terms: the accuracy and accessibility of the datastores needed to provide an adequate service. The chapter stresses that users often cannot distinguish data loss, corruption, and extended unavailability. A system that eventually preserves data but cannot make it available within an acceptable period has still failed its users. Source: https://sre.google/sre-book/data-integrity/

[SOURCE FACT] The data-integrity problem is stricter than an uptime percentage suggests. A small fraction of corrupted bytes can make a document, executable, or database unusable, whereas an equivalent fraction of downtime may be tolerable. The source therefore treats integrity and availability as separate user-facing requirements. Source: https://sre.google/sre-book/data-integrity/

[ANALYSIS] For a transactional service, “correct” means more than a successful write. A committed order must have a valid payment state, inventory reservation, and audit trail; a retry must not create a second order; and a read must not expose a half-applied state. The design challenge is to preserve these invariants while traffic, dependencies, deploys, and recovery operations are all changing.

[SOURCE FACT] The overload chapter starts from an operational fact: eventually some part of every serving system becomes overloaded, so graceful overload handling is fundamental. It recommends degraded responses, redirection, resource-aware capacity signals, quotas, criticality, and rejection that is fast enough not to consume the backend’s remaining capacity. Source: https://sre.google/sre-book/handling-overload/

[ANALYSIS] These concerns are coupled. A retry storm can turn one rejected transaction into many attempts, exhaust database connections, and create duplicate side effects unless the transaction boundary is idempotent. Conversely, an overloaded system that accepts writes indiscriminately can preserve availability at the cost of integrity.

## 2. What the Original System Did

[SOURCE FACT] The Google material is a set of SRE principles and practices, not a complete product architecture for an order or payment system. It describes defense in depth for persistent data: soft deletion, backups and recovery methods, early validation, and, where useful, replication. It explicitly warns that replication is not the same as recoverability because a bad update or delete can propagate to every replica. Source: https://sre.google/sre-book/data-integrity/

[SOURCE FACT] Backups are valuable only insofar as they can be restored. Recovery requirements should determine backup method, restore-point frequency, location, and retention. The source distinguishes quickly restorable backups from archives, and discusses tiered copies, incremental or streaming approaches, and point-in-time recovery as a difficult goal across mixed ACID and BASE datastores. Source: https://sre.google/sre-book/data-integrity/

[SOURCE FACT] The source also recommends proactive detection and rapid repair. Out-of-band validators should check invariants that are catastrophic to users, rather than attempting to validate every possible property. Source: https://sre.google/sre-book/data-integrity/

[SOURCE FACT] For overload, Google describes per-customer resource quotas, request criticality, local utilization signals, bounded retries, and adaptive client-side throttling. In the adaptive approach, a client tracks attempted requests and backend accepts over a recent history; when rejects make the ratio too high, requests are rejected locally before reaching the network. Source: https://sre.google/sre-book/handling-overload/

[ANALYSIS] The transferable lesson is not that a particular Google datastore, RPC stack, or internal quota service should be copied. It is that correctness and overload need explicit control loops: define the invariant, measure the resource, reject work at the cheapest safe point, and prove recovery with exercises.

## 3. Architecture Diagram

[PROPOSED DESIGN] The following is an interview-style extension, not a claim about Google’s exact architecture. It combines a transactional write path with the source-backed reliability controls.

```mermaid
flowchart LR
    C[Client]
    CT[Client throttler\n[Source-backed component]]
    G[API gateway\n[Proposed component]]
    Q[Quota and criticality\n[Source-backed component]]
    O[Overload gate / load shedding\n[Source-backed component]]
    T[Transaction coordinator\n[Proposed component]]
    DB[(ACID primary database\n[Proposed component])]
    E[(Outbox events\n[Proposed component])]
    W[Workers / downstream effects\n[Proposed component]]
    B[(Tiered backups\n[Source-backed component]]
    V[Integrity validators\n[Source-backed component]]
    R[Restore orchestrator\n[Proposed component]]

    C --> CT --> G --> Q --> O --> T
    T --> DB
    T --> E --> W
    DB --> B
    DB --> V
    B --> R --> DB
    V -. repair signal .-> R
```

[ANALYSIS] The ACID database is the source of truth for the transaction’s atomic state. The outbox makes downstream publication part of the same commit without pretending that an external payment provider participates in the database transaction. The throttler and overload gate reduce pressure before expensive work; validators and restore orchestration address corruption that ordinary replication cannot.

## 4. System Design Analysis

[SOURCE FACT] Google describes a mixture of ACID and BASE APIs as a common cloud pattern. ACID offers stronger transactional semantics; BASE can offer higher availability with eventual convergence after updates stop. The source highlights referential-integrity problems when metadata, blobs, and client caches live in separate systems. Source: https://sre.google/sre-book/data-integrity/

[ANALYSIS] Use ACID where a business invariant must change atomically: order creation, inventory reservation, and the order’s idempotency record. Use asynchronous boundaries for effects that can be retried or reconciled: email, search indexing, analytics, and notifications. Do not call an external side effect inside a database transaction and assume rollback can undo it.

[PROPOSED DESIGN] Each write carries an idempotency key scoped to the authenticated customer and operation. The database stores that key with the resulting resource identifier and a request fingerprint. A repeated key with the same fingerprint returns the original result; a different fingerprint is rejected. This converts transport retries into a safe read of an existing decision.

[PROPOSED DESIGN] The transaction writes an order, its line items, an inventory reservation, and an outbox row in one ACID transaction. A worker claims outbox rows with leases, publishes idempotent commands, and records completion. Consumers also deduplicate by event ID. This provides at-least-once delivery with idempotent effects, rather than making an unsupported exactly-once claim.

[SOURCE FACT] The data-integrity source says bad data propagates through references and dependent transactions, making later recovery harder. It recommends checking relationships between datastores and detecting low-grade corruption early. Source: https://sre.google/sre-book/data-integrity/

[ANALYSIS] A validator should compare invariants such as “reserved quantity is nonnegative,” “each order line references an existing product snapshot,” and “outbox status matches a committed aggregate.” It should quarantine or repair only with an auditable procedure. A validator that silently rewrites business data can become a second corruption source.

[SOURCE FACT] The overload source says capacity should be modeled using consumed resources rather than blindly using queries per second, because requests can have very different costs. CPU is often a useful signal, with other resources included when they are independently constraining. Source: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] The gateway assigns a cost class to each operation, but the database gate ultimately protects actual signals: connection pool occupancy, CPU, memory pressure, lock wait time, and transaction latency. Under pressure it sheds optional reads first, then low-criticality writes, while preserving bounded capacity for critical operations. A rejected write must be explicit and retryable only when its idempotency semantics make that safe.

## 5. Data Model

[PROPOSED DESIGN] A minimal relational model is:

```sql
CREATE TABLE orders (
  order_id UUID PRIMARY KEY,
  customer_id UUID NOT NULL,
  status TEXT NOT NULL,
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  version BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE idempotency_keys (
  customer_id UUID NOT NULL,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash BYTEA NOT NULL,
  response_code INTEGER NOT NULL,
  resource_id UUID,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (customer_id, operation, key)
);

CREATE TABLE inventory_reservations (
  reservation_id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(order_id),
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL
);

CREATE TABLE outbox (
  event_id UUID PRIMARY KEY,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL
);
```

[ANALYSIS] The uniqueness constraint on the idempotency key is the first line of defense against concurrent duplicate requests. Foreign keys protect local referential integrity, but they do not validate a cache, an external provider, or a separately stored blob. Those relationships need validators and reconciliation.

[SOURCE FACT] Google’s source distinguishes backups from archives: a backup can be loaded back into an application, while an archive is primarily for long-term audit, discovery, or compliance. Source: https://sre.google/sre-book/data-integrity/

[PROPOSED DESIGN] Back up the primary database and outbox in a transactionally coherent form, retain immutable restore points, and separately archive audit records when policy requires it. A restore manifest should identify the database version, schema version, event position, and validation results. This is a design proposal, not a description of Google’s implementation.

## 6. API Design

[PROPOSED DESIGN] The write API makes retry behavior part of its contract:

```http
POST /v1/orders
Idempotency-Key: 7f7d...
X-Criticality: CRITICAL
Content-Type: application/json

{"items":[{"sku":"A-17","quantity":2}]}
```

```http
201 Created
Location: /v1/orders/8b2...

{"order_id":"8b2...","status":"RESERVED"}
```

[PROPOSED DESIGN] Responses distinguish `409` for a business conflict, `429` for quota or client throttling, and `503` with a retryable overload classification for temporary capacity protection. The body should include a stable error code and request ID, not an instruction to retry every failure.

[SOURCE FACT] The overload source describes retry budgets, including a per-request cap of three attempts and a per-client retry ratio target of 10% in the discussed design. It also warns that retries should occur at the layer immediately above the rejecting dependency to avoid combinatorial retry explosions. Source: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] Adopt bounded retry metadata such as `attempt`, `retry_after`, and `overload_scope`. Retry only idempotent operations or operations carrying a valid idempotency key. The client should stop when the budget is exhausted or the response says `overloaded; don't retry`. These exact HTTP names are proposed conventions.

## 7. Scaling Strategy

[SOURCE FACT] Google’s overload chapter describes per-customer quotas, criticality levels, and local utilization protection. Higher-criticality traffic is protected longer; sheddable or batch traffic can tolerate partial unavailability. Source: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] Partition capacity by customer and criticality, with admission decisions based on resource cost rather than request count. Keep a reserved pool for `CRITICAL_PLUS` operations, a normal pool for interactive writes, and a shed pool for repair scans and batch exports. The pool sizes are operational policy, not source facts.

[SOURCE FACT] The source reports adaptive throttling based on recent client-side requests and backend accepts, and says the commonly preferred multiplier is 2x in the described approach. It also notes that sporadic clients have a weaker view of backend state. Source: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] Implement the same control shape for SDK clients: count attempted and accepted requests over a rolling window, reject locally with increasing probability when backend rejection rises, and expose the local rejection metric. Use server-provided retry timing to avoid synchronized retries. For low-volume clients, use explicit token buckets and server quotas because local history is sparse.

[SOURCE FACT] For data integrity, Google describes tiered backups: frequent, quick local restore points; less frequent copies on different storage; and longer-lived nearline or offline copies for site-level failures. The source emphasizes that recovery speed, freshness, and retention are competing goals. Source: https://sre.google/sre-book/data-integrity/

[ANALYSIS] Scale the recovery path independently from the serving path. Shard validation and restore work by independent customer or time partitions, limit concurrent restore jobs, and test partial restores. A backup pipeline that saturates the live database is an availability risk even when its final artifact is correct.

## 8. Failure Scenarios

[PROPOSED DESIGN] **Duplicate client retry.** The first request commits, but the response is lost. A retry finds the idempotency record and returns the original order. If the first transaction rolled back, the retry may safely create it.

[PROPOSED DESIGN] **Inventory conflict.** Two transactions compete for the last unit. A row lock or atomic conditional update permits one reservation; the other receives a business conflict, not an ambiguous server error.

[PROPOSED DESIGN] **Outbox worker crash.** The worker publishes an event and crashes before marking it complete. The lease expires, the event is published again, and the consumer’s event ID deduplication prevents a duplicate external effect.

[SOURCE FACT] Replication alone does not protect against an erroneous delete or corrupt update because the error may be replicated before detection. Source: https://sre.google/sre-book/data-integrity/

[PROPOSED DESIGN] **Delayed corruption.** A validator detects an invariant violation days after introduction. The operator freezes affected mutations, identifies the last known-good restore point, restores the affected partition into an isolated workspace, reconciles newer valid changes, and records the repair. Do not overwrite production from an unverified backup.

[SOURCE FACT] The overload source says that a small subset of overloaded tasks may justify an immediate retry, while broad overload should surface an error rather than trigger more traffic. It also warns that retries at multiple dependency layers cause an explosion. Source: https://sre.google/sre-book/handling-overload/

[PROPOSED DESIGN] **Database saturation.** The service rejects low-criticality requests locally at the gateway, clients back off, and only the nearest caller retries a bounded number of times. Critical writes continue only while their transaction and connection budgets remain safe.

[SOURCE FACT] Google’s data-integrity source recommends practicing the ability to meet data-availability SLOs, focusing on restores rather than merely taking backups. Source: https://sre.google/sre-book/data-integrity/

[PROPOSED DESIGN] **Site recovery.** Promote a tested recovery environment from an immutable backup, replay only validated change records, run integrity checks, and switch traffic after a declared restore SLO is met. The restore drill is a release-quality test, not an emergency-only script.

## 9. Capacity Estimation

[PROPOSED DESIGN] The following figures are illustrative assumptions, not facts from Google or the supplied sources. Assume 2,000 incoming order attempts per second, a 20% duplicate/retry fraction during a peak, and 6 database operations per accepted order. If admission succeeds for 1,600 new orders per second, the database sees approximately 9,600 logical operations per second before background work:

`1,600 orders/s * 6 operations/order = 9,600 operations/s`

[PROPOSED DESIGN] Assume one transaction consumes 12 ms of database CPU time on average. The logical CPU demand is:

`1,600 orders/s * 0.012 s = 19.2 CPU-seconds/s`

This is an illustrative assumption; real sizing must use measured CPU, lock waits, I/O, connection occupancy, and tail latency. If duplicate attempts execute full business logic, the 20% retry fraction adds pressure without adding business value, which is why idempotency lookup and client throttling belong before expensive work.

[SOURCE FACT] The supplied overload article includes an example of 100 backend tasks at 500 requests per second each, yielding a 50,000-queries-per-second datacenter limit under that example’s model. It also gives examples of customer CPU quotas, including 4,000 CPU-seconds per second for Gmail and 3,000 for Android, in a 10,000-CPU worldwide allocation example. These are source examples, not sizing recommendations for this proposed service. Source: https://sre.google/sre-book/handling-overload/

[ANALYSIS] The important estimation unit is resource demand per request, not QPS alone. Estimate normal load, retry amplification, validation overhead, backup I/O, and restore throughput separately. A design that meets steady-state QPS but has no headroom for rejected work or recovery work is not operationally complete.

## 10. Trade-offs

[ANALYSIS] Strong ACID boundaries reduce ambiguity but can constrain write latency, geographic scale, and availability during coordination failures. Moving more work to BASE improves decoupling and throughput but requires reconciliation, user-visible pending states, and stronger idempotency discipline.

[SOURCE FACT] The source explains that frequent full backups burden live datastores, while deeper or more durable backup tiers are slower and less fresh. It also says replication and redundancy are not recoverability. Source: https://sre.google/sre-book/data-integrity/

[ANALYSIS] Local snapshots improve restore time but share more failure surface with production. Offline or isolated copies improve disaster protection but increase restore latency and operational cost. Retention must reflect the time it takes to discover creeping corruption, not just the time to notice a total outage.

[SOURCE FACT] The overload source says aggressive throttling saves backend resources but slows propagation of a recovered quota state; the discussed 2x multiplier trades some wasted rejection capacity for faster state visibility. Source: https://sre.google/sre-book/handling-overload/

[ANALYSIS] Client-side throttling is not a substitute for server admission control. A malicious or outdated client can ignore it, and a low-volume client has insufficient local evidence. Server-side quotas, per-task protection, and clear overload errors remain mandatory.

## 11. What We Can Learn From This Architecture

[SOURCE FACT] The two Google SRE chapters converge on defense in depth. Data integrity uses multiple independent protections and early detection; overload handling combines load balancing, quotas, criticality, local utilization limits, and client behavior. Neither chapter presents a single mechanism as a complete guarantee. Sources: https://sre.google/sre-book/data-integrity/ and https://sre.google/sre-book/handling-overload/

[ANALYSIS] Make correctness executable. Encode uniqueness, foreign-key, version, and state-transition invariants where the database can enforce them; validate cross-system invariants out of band; and make every repair observable.

[ANALYSIS] Make overload intentional. Assign criticality before a request fans out, measure consumed resources, shed the least valuable work first, and ensure that retry behavior cannot multiply across layers.

[ANALYSIS] Define recovery as a user-facing SLO. A backup that has never been restored is an unproven dependency. Recovery tests should include delayed corruption, partial data selection, schema compatibility, and external side-effect reconciliation.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN] **Requirements.** Accept an order exactly once from the user’s perspective, reserve inventory atomically, publish downstream work reliably, tolerate retries and partial dependency overload, and recover from corruption without blindly restoring every current record. Availability and recovery targets are illustrative assumptions and must be negotiated with product owners.

[PROPOSED DESIGN] **Write path.** The client sends an idempotency key and criticality. The gateway applies authentication, quota, and local throttling. The transaction service checks the key, locks or conditionally updates inventory, writes the order and outbox event, and commits. It returns only after the durable commit.

[PROPOSED DESIGN] **Asynchronous path.** Workers lease outbox events and call downstream systems with event IDs. Each downstream effect is idempotent or reconciled by a compensating workflow. A poison event is quarantined rather than retried forever.

[PROPOSED DESIGN] **Overload path.** Resource-aware gates reject shed-able work first. A client receives a typed overload error and retries only at the immediate caller, within request and client budgets. Adaptive local throttling prevents rejected requests from consuming the network and backend capacity.

[PROPOSED DESIGN] **Integrity path.** Validators scan local and cross-store invariants. Soft deletion protects accidental removal where privacy policy permits it. Tiered immutable backups support restore points; restore is performed into an isolated environment, validated, and reconciled before cutover.

[PROPOSED DESIGN] **Observability and tests.** Track commit latency, idempotency-hit rate, reservation conflicts, outbox age, consumer deduplication, resource utilization by criticality, local throttle rate, overload rejection rate, retry amplification, validator findings, backup freshness, and restore duration. Test each failure scenario with controlled traffic and synthetic corruption.

[ANALYSIS] This design intentionally does not claim global serializability, exactly-once messaging, or zero data loss. It makes narrower guarantees that can be enforced and measured: atomic local invariants, idempotent retries, at-least-once events with deduplication, bounded overload behavior, and rehearsed recovery.

## Original Sources

- Company: Google
  Exact Article Title: Data Integrity: Principles and Best Practices
  URL: https://sre.google/sre-book/data-integrity/
  What information from the source was used: User-facing definitions of data integrity and availability; ACID and BASE trade-offs; soft deletion; backups versus archives; tiered backup and restore strategy; replication limits; proactive validation; and recovery practice.

- Company: Google
  Exact Article Title: Handling Overload
  URL: https://sre.google/sre-book/handling-overload/
  What information from the source was used: Resource-based capacity measurement; degraded responses; per-customer quotas; request criticality; client-side adaptive throttling; utilization protection; retry budgets; and retry containment across dependency layers.
