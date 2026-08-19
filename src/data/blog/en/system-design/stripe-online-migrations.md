---
title: "Online Database Migrations Without Downtime"
description: "A source-backed analysis of dual-write migrations, backfill, shadow reads, cutover, and correctness under continuous production traffic."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

Moving a large data model while production traffic continues is not primarily a data-copying problem. The difficult part is keeping reads and writes coherent while the old and new representations coexist.

This article examines the online migration pattern described by Stripe, then separates that source material from the engineering analysis and from a generic proposed design. It covers dual writes, backfill, shadow reads, cutover, retries, and retirement.

## 1. The Migration Problem

**[SOURCE FACT]** Stripe describes a migration involving hundreds of millions of Subscription objects while its API remained available and consistent. The old model stored a subscription with a Customer; the redesigned model stored active subscriptions in a separate table. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** The old shape was expensive to evolve. A subscription change required updating the entire Customer record, and subscription queries scanned Customer objects. Source: https://stripe.com/blog/online-migrations

**[ANALYSIS]** The hard part is preserving one coherent subscription state during the overlap. A maintenance window removes that overlap, but an online migration must handle it while serving normal traffic.

The main risks are straightforward:

- Migration work competes with production work.
- A missed write path creates divergence between the representations.
- A read cutover can expose rows that are stale or not yet copied.

**[ANALYSIS]** A safe migration therefore needs distinct data-transfer, observation, authority-change, and cleanup phases. Those phases do not need to be implemented by one particular control-plane component, but their responsibilities must be explicit.

## 2. Pattern Described by the Source

**[SOURCE FACT]** Stripe presents a four-step dual-writing pattern: write to the old and new tables; move all read paths to the new table; move all write paths to the new table only; then remove old data and code that depends on the old model. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** In the Subscription example, new writes initially went to both the Customers and Subscriptions tables. Existing objects were copied lazily when updated, followed by a backfill of the remaining subscriptions. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** To identify missing objects without repeatedly querying the live database, Stripe used database snapshots in Hadoop and MapReduce, managed with Scalding. A job emitted IDs to copy; a multithreaded fleet copied them; the job ran again to check for omissions. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Stripe used Scientist to execute both read paths and compare their results in production. Mismatches produced alerts and metrics, while an error in the experimental path did not affect the main application path. Once the results matched, reads moved to the new table. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** For writes, Stripe reversed the order: it wrote to the new store first and then archived the data in the old store. It refactored subscription operations incrementally and added more comparisons. It later stopped writing the old representation, removed the old field, and processed deletions lazily. Source: https://stripe.com/blog/online-migrations

## 3. Architecture

```mermaid
flowchart LR
    C[Client]
    A[Application/API]
    F[Feature flag / phase controller\n[Proposed component]]
    O[(Old Customers store)]
    N[(New Subscriptions store)]
    B[Snapshot + MapReduce backfill\n[Source-backed component]]
    S[Shadow read comparator\n[Source-backed component]]
    V[Verifier and metrics\n[Proposed component]]
    R[Retirement and lazy cleanup\n[Source-backed component]]

    C --> A
    A --> F
    F -->|dual write| O
    F -->|dual write| N
    B --> N
    A -->|primary read| N
    A -.->|shadow read| O
    A -.-> S
    S --> V
    A -->|new-primary write| N
    N --> R
    O --> R
```

**[SOURCE FACT]** The source-backed parts are the old and new stores, snapshot-based distributed backfill, production read comparison, and lazy retirement. Source: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** The feature flag, phase controller, and verifier are explicit control-plane components in this diagram. They make rollout, pausing, and rollback decisions visible. The diagram does not claim that Stripe used these exact components.

## 4. Correctness During the Transition

**[ANALYSIS]** Dual-write is a transitional invariant, not a transaction boundary. If two independent stores are updated in separate transactions, a process failure can leave one write missing. A design must make retries idempotent, record a migration version, and detect divergence continuously.

**[ANALYSIS]** A transaction covering both representations is available only when they share a transaction boundary. Otherwise, the system needs a durable retry mechanism, a reconciliation pass, or both. Neither option makes the two stores a single atomic database; they reduce the time and scope of divergence.

**[SOURCE FACT]** Stripe reduced the performance impact of extra writes by slowly increasing the percentage of duplicated objects while monitoring operational metrics. Source: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Shadow reads test semantic equivalence, not just row counts. The comparator should define how to normalize ordering, absent versus empty values, and fields intentionally changed by the new model. Comparing raw objects can create false alarms; normalizing too much can hide correctness bugs.

**[ANALYSIS]** Cutover is a proof obligation. Before the new table becomes authoritative, the migration should demonstrate coverage of existing objects, matching results for representative reads, and migration of every mutation path. After cutover, the old representation should remain available as an archive or safety net until the evidence supports deletion.

**[PROPOSED DESIGN]** A generic system can maintain per-object states such as `dual`, `new_primary`, and `retired`. Gate state transitions through an atomic control-plane change. Route reads and writes using that state, and make retries use the same state and operation idempotency key. This is a proposed extension, not a claim about Stripe’s implementation.

## 5. Illustrative Data Model

**[SOURCE FACT]** The conceptual change described in the Subscription example was from one `subscription` field on Customer, then an array of `subscriptions`, to active subscriptions in a separate table. Source: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** The following generic relational schema makes ownership, migration state, and version checks explicit. It is illustrative; it is not presented as Stripe’s schema.

```sql
CREATE TABLE customers (
  customer_id     BIGINT PRIMARY KEY,
  legacy_payload  JSONB,
  migration_state TEXT NOT NULL,
  version         BIGINT NOT NULL
);

CREATE TABLE subscriptions (
  customer_id     BIGINT NOT NULL,
  subscription_id BIGINT NOT NULL,
  status          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  source_version  BIGINT NOT NULL,
  updated_at      TIMESTAMP NOT NULL,
  PRIMARY KEY (customer_id, subscription_id)
);
```

**[PROPOSED DESIGN]** `source_version` prevents an older backfill or retry from overwriting a newer mutation. The production schema must also define how to represent deletes, nulls, ordering, and concurrent updates. Those rules belong in the comparator and in the write contract, not only in the table definition.

## 6. Rollout and Retirement

**[PROPOSED DESIGN]** Treat each phase as a reversible operational change where possible:

- Enable dual writes for a controlled portion of traffic or objects.
- Run backfill in bounded batches and make it safe to retry.
- Compare shadow reads without allowing comparator failures onto the primary request path.
- Promote the new store only after coverage and mismatch checks pass.
- Stop old writes, retain the old representation while it is still needed for recovery, and then remove it through lazy cleanup.

The exact thresholds and batch sizes are deployment-specific assumptions, not facts established by the source.

**[ANALYSIS]** The migration is complete only when the old representation is no longer an input to correctness. That requires more than a successful backfill: all reads, writes, asynchronous consumers, repair jobs, and deletion paths must use the new contract. If any path still writes the old model, retirement can reintroduce divergence.

## 7. Engineering Takeaways

- Separate copied-data completeness from read correctness. Backfill proves coverage; shadow reads test behavior.
- Make every migration write idempotent and version-aware.
- Keep experimental reads isolated from the primary request path.
- Treat read cutover and write cutover as separate authority changes.
- Instrument mismatches, retry failures, lag, and cleanup progress before rollout.
- Label generic control-plane and schema choices as proposals rather than attributing them to a source system.

The durable pattern is not “copy the table and switch a flag.” It is a controlled transition in which data transfer, verification, authority, and retirement each have explicit correctness conditions.
