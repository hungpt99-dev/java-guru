---
title: "Zero-Downtime Database Migrations at Scale: Stripe's Online Migration Pattern"
description: "A source-backed analysis of dual-write migrations, backfill, shadow reads, cutover, and correctness under continuous production traffic."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

**[SOURCE FACT]** Stripe describes a migration involving hundreds of millions of Subscription objects while its API had to remain available and consistent. The old model stored a subscription alongside a Customer; the redesigned model stored active subscriptions in a separate table. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** The old shape became expensive to evolve: changing subscriptions required updating the entire Customer record, and subscription queries scanned Customer objects. Source: https://stripe.com/blog/online-migrations

**[ANALYSIS]** The hard problem is not copying rows. It is preserving the invariant that every read and mutation observes one coherent subscription state while old and new representations coexist. A maintenance window avoids this overlap, but the stated operating constraint disallows that option.

**[ANALYSIS]** Three risks dominate: migration work competes with production work; an unhandled write path creates divergence; and a read cutover can expose stale or incomplete rows. A safe plan therefore needs a data-transfer phase, an observation phase, a controlled authority change, and a cleanup phase.

## 2. What the Original System Did

**[SOURCE FACT]** Stripe presents a four-step dual-writing pattern: write to old and new tables; change all read paths to the new table; change all write paths to only the new table; then remove old data and code that depends on the outdated model. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** In the Subscription example, new writes first went to both the Customers and Subscriptions tables. Existing objects were copied lazily when updated, followed by a backfill of remaining subscriptions. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** To find missing objects without repeatedly querying the live database, Stripe used database snapshots in Hadoop and MapReduce, managed with Scalding. A job emitted IDs to copy; a multi-threaded fleet copied them; the job ran again to check for omissions. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** Stripe used Scientist to execute both read paths and compare results in production. Mismatches generated alerts and metrics, while an error in the experimental path did not affect the main application path. After results matched, reads moved to the new table. Source: https://stripe.com/blog/online-migrations

**[SOURCE FACT]** For writes, Stripe reversed the order: write the new store first, then archive the data in the old store. It refactored subscription operations incrementally and used additional comparisons. It later stopped writing the old representation, removed the old field, and processed deletions lazily. Source: https://stripe.com/blog/online-migrations

## 3. Architecture Diagram

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

**[SOURCE FACT]** The source-backed components are the old/new stores, snapshot-based distributed backfill, production read comparison, and lazy retirement. Source: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** The feature flag, phase controller, and verifier are explicit control-plane additions in this diagram. They make rollout, pause, and rollback decisions operationally visible; the diagram does not claim that Stripe used these exact components.

## 4. System Design Analysis

**[ANALYSIS]** Dual-write is a transitional invariant, not a transaction boundary. If two independent databases are updated in separate transactions, a crash can leave one write missing. The design must make retries idempotent, record a migration version, and continuously detect divergence. A local transaction covering both representations is possible only when they share a transactional boundary; otherwise, a durable retry mechanism or reconciliation pass is required.

**[SOURCE FACT]** Stripe mitigated the performance impact of extra writes by slowly ramping the percentage of duplicated objects while watching operational metrics. Source: https://stripe.com/blog/online-migrations

**[ANALYSIS]** “Shadow reads” are valuable because they test semantic equivalence, not merely row counts. The comparator should normalize ordering, absent-versus-empty values, and fields intentionally changed by the new model. Raw object equality can create false alarms; over-normalization can hide correctness bugs.

**[ANALYSIS]** Cutover should be treated as a proof obligation. Before making the new table authoritative, prove coverage for existing objects, compare representative reads, and demonstrate that every mutation path has been migrated. After cutover, keep the old representation as an archive or safety net until evidence supports deletion.

**[PROPOSED DESIGN]** Use a per-object migration state such as `dual`, `new_primary`, and `retired`, and gate transitions by an atomic control-plane change. Route reads and writes by that state, but ensure a retry sees the same state and operation idempotency key. This is an extension for a generic system, not a claim about Stripe’s implementation.

## 5. Data Model

**[SOURCE FACT]** The original conceptual change was from one `subscription` field on Customer, then an array `subscriptions`, to active subscriptions in their own table. Source: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** A generic relational target can make ownership and idempotency explicit:

```sql
CREATE TABLE customers (
  customer_id    BIGINT PRIMARY KEY,
  legacy_payload JSONB,
  migration_state TEXT NOT NULL,
  version        BIGINT NOT NULL
);

CREATE TABLE subscriptions (
  subscription_id BIGINT PRIMARY KEY,
  customer_id     BIGINT NOT NULL,
  status          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  source_version  BIGINT NOT NULL,
  updated_at      TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX subscriptions_customer_id_id
  ON subscriptions(customer_id, subscription_id);
```

**[PROPOSED DESIGN]** `source_version` prevents an older backfill or retry from overwriting a newer mutation. In a real schema, the comparison must also define how deletes, nulls, ordering, and concurrent updates are represented. These columns and constraints are illustrative design choices, not source facts.

## 6. API Design

**[PROPOSED DESIGN]** Keep the public API stable while the storage authority changes. Internal operations can expose the migration semantics:

```text
GET  /customers/{customer_id}/subscriptions
POST /customers/{customer_id}/subscriptions
PUT  /subscriptions/{subscription_id}
```

**[PROPOSED DESIGN]** Each mutation accepts an idempotency key and is handled as follows:

1. Read the migration state and current version.
2. Apply the new representation with a conditional version check.
3. Apply or enqueue the legacy projection with the same operation identity.
4. Return only after the configured durability policy succeeds.

**[ANALYSIS]** “Write new, then archive old” reduces dependence on the old model, but it does not by itself guarantee atomicity. If step 3 fails, the new store remains authoritative and a repair queue must converge the archive. The API must not silently report success while losing the new-primary write.

**[PROPOSED DESIGN]** Internal endpoints for `backfill`, `compare`, `pause`, and `resume` should be privileged, rate-limited, and auditable. They are operational interfaces, not customer-facing APIs.

## 7. Scaling Strategy

**[SOURCE FACT]** Stripe used offline snapshots and distributed MapReduce to identify work, then used many processes in parallel to duplicate subscriptions. This avoided making the live database perform the expensive global discovery. Source: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Separate discovery from mutation. Discovery produces a stable worklist; workers perform bounded, idempotent copies; a second discovery pass checks the completeness invariant. This limits full-table scans on the serving path and gives operators a measurable stopping condition.

**[PROPOSED DESIGN]** Partition work by stable object ID or shard, use leases with expiry, and cap concurrency per database shard. Apply backpressure when write latency, lock waits, replication lag, or error rate crosses a threshold. Prefer small batches and checkpoint progress so a worker restart repeats work safely.

**[SOURCE FACT]** Stripe also used lazy copying on object updates, which incrementally transferred hot objects before the final backfill. Source: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Lazy copy is efficient for active records but cannot establish completeness for cold records. It is therefore a complement to, not a replacement for, a full reconciliation pass.

## 8. Failure Scenarios

**[PROPOSED DESIGN]** If the old write succeeds and the new write fails, retry the new write using the operation key, then compare versions. Do not allow a later stale backfill to overwrite the repaired row.

**[PROPOSED DESIGN]** If the new write succeeds and the old archive fails, keep serving from the new store, enqueue reconciliation, and alert on archive lag. Rollback should not mean blindly switching reads to an incomplete old representation.

**[ANALYSIS]** If shadow reads disagree, keep the primary path unchanged, capture object ID and normalized diff, classify the mismatch, and stop promotion. The experimental read must be fail-open with respect to customer traffic, as in the source’s description of Scientist experiments.

**[PROPOSED DESIGN]** If backfill overloads production, reduce worker concurrency or pause it. If the worklist is incomplete, rerun discovery from a fresh snapshot and compare against the target’s observed IDs. If a delete races with backfill, use tombstones or version checks so the deleted object cannot be resurrected.

**[ANALYSIS]** The dangerous failure is an unknown writer. A single forgotten mutation path can continually reintroduce divergence. Instrument legacy-field access and fail loudly in non-production; in production, choose an explicit policy for blocking or routing rather than silently accepting it.

## 9. Capacity Estimation

**[SOURCE FACT]** Stripe states that it had hundreds of millions of Subscription objects and that migrating one hundred million objects at one object per second sequentially would take over three years. Source: https://stripe.com/blog/online-migrations

**[PROPOSED DESIGN]** Illustrative assumption: a migration has 100,000,000 objects, 500 workers, and each worker completes 20 objects per second. Ideal copy throughput is 10,000 objects/second, so the copy phase is roughly 10,000 seconds, or 2.8 hours. Real duration is longer because of retries, throttling, validation, and contention. This is an illustrative assumption, not a Stripe measurement.

**[PROPOSED DESIGN]** Illustrative assumption: if dual-write adds one target write per API mutation, target write volume is approximately equal to mutation volume during the transition. Size the target database, connection pools, indexes, and replication path for that temporary increase, then validate with load tests. No source-backed request rate is available, so none is asserted here.

**[ANALYSIS]** The useful capacity metric is not only objects per second. Track backlog, oldest unprocessed object age, mismatch rate, target write latency, and production resource headroom. A faster backfill that causes customer-facing latency is a failed migration.

## 10. Trade-offs

**[ANALYSIS]** Dual-write plus reconciliation preserves availability but increases write amplification, code complexity, and operational surface area. It is appropriate when a maintenance window is unacceptable and the organization can operate comparison and repair tooling.

**[ANALYSIS]** Offline discovery reduces pressure on the serving database, but snapshots can lag live state. The design must reconcile the interval between snapshot creation and worker execution through live dual-writes, lazy copy, or a final verification pass.

**[ANALYSIS]** Shadow reads add read load and can produce noisy differences, but they expose semantic incompatibilities before cutover. Sampling reduces cost but weakens coverage; full comparison improves confidence at higher resource cost.

**[SOURCE FACT]** Stripe emphasizes incremental changes, saying it did not change more than a few hundred lines of code at one time, and describes transparent observability through Scientist alerts. Source: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Keeping the old model temporarily simplifies rollback, but delays the removal of duplicated writes and legacy assumptions. Deletion should follow evidence, not schedule pressure.

## 11. What We Can Learn From This Architecture

**[SOURCE FACT]** The source’s reported lessons are a four-phase strategy, offline parallel processing, incremental changes, and observable comparisons while production remains online. Source: https://stripe.com/blog/online-migrations

**[ANALYSIS]** Correctness is a staged property. First establish row coverage, then semantic read equivalence, then write-path completeness, then safe retirement. Treat each stage as independently observable rather than declaring success after the copy job finishes.

**[ANALYSIS]** The migration is also a codebase migration. Data can be correct while an old accessor still writes the old shape. Searchable access guards, ownership of mutation logic, and explicit phase gates are as important as database tooling.

**[ANALYSIS]** The practical pattern generalizes beyond subscriptions: introduce the target, keep representations convergent, compare behavior, move authority, and remove compatibility code only after the last dependency is gone.

## 12. Proposed Interview-Style System Design

**[PROPOSED DESIGN]** Requirements: migrate a large relational entity set online; preserve API availability; preserve read semantics; tolerate worker and database failures; provide pause, resume, verification, and eventual cleanup. The numbers below are illustrative assumptions.

**[PROPOSED DESIGN]** Components:

- API service with a migration phase flag.
- Old and new stores with versioned records.
- Dual-write adapter with idempotency keys.
- Backfill planner reading an offline snapshot and a worker fleet writing bounded batches.
- Shadow comparator with normalized diffs and alerting.
- Reconciliation queue for failed projections.
- Control plane for promotion, pause, rollback policy, and retirement.

**[PROPOSED DESIGN]** Rollout:

1. Create the new schema and deploy read/write code behind a disabled phase.
2. Enable dual-write for a small cohort; measure latency, errors, and divergence.
3. Enable lazy copy on updates and run snapshot-based backfill.
4. Run shadow reads and block promotion on unexplained mismatches.
5. Switch reads to the new store, retaining comparisons and old data.
6. Change mutation paths to new-primary, then repair the old projection asynchronously.
7. Prove no legacy access remains, stop old writes, and lazily remove old data.

**[PROPOSED DESIGN]** Correctness invariants:

- Every object in the migration scope is present in the target or has an explicit tombstone.
- For a given version, normalized old and new reads are equivalent.
- A retry cannot apply an older version over a newer version.
- Every successful mutation is durable in the new source of truth.
- Retirement is blocked while legacy access or unresolved mismatches exist.

**[ANALYSIS]** The interview answer should spend more time on invariants and failure handling than on the diagram. “Dual-write” is only the starting mechanism; verification, idempotency, bounded backfill, and a reversible authority transition determine whether the design is safe.

## Original Sources

- Company: Stripe. Exact Article Title: “Online migrations at scale”. URL: https://stripe.com/blog/online-migrations. What information from the source was used: the Subscription data-model change, availability and consistency constraints, four-phase migration pattern, gradual dual-writing, lazy copy, snapshot/Hadoop/MapReduce backfill, Scientist shadow-read comparisons, incremental write-path refactoring, and lazy removal of old data.
