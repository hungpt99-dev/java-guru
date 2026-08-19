---
title: "Dropbox Magic Pocket: Designing Exabyte-Scale Blob Storage"
description: "A source-disciplined system-design analysis of immutable blobs, erasure coding, tiered storage, and durability at exabyte scale."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

[SOURCE FACT] The supplied Dropbox Infrastructure page lists Dropbox engineering posts titled “Scaling to exabytes and beyond,” “Inside the Magic Pocket,” “How we optimized Magic Pocket for cold storage,” and “Pocket watch: Verifying exabytes of data.” It also lists posts about SMR storage, removing SSD cache disks, and storage efficiency in Magic Pocket. Source: https://dropbox.tech/infrastructure/

[ANALYSIS] Those titles describe a storage problem with three competing requirements: retain a very large amount of user content, keep the durable copy economically viable, and verify that data remains recoverable as hardware and sites fail. A blob store is not a filesystem with a larger disk. It must manage placement, repair, integrity, lifecycle, and operations as one control problem.

[ANALYSIS] The workload is plausibly dominated by immutable or append-only objects: uploaded file content is addressed by an object identifier, while names, folders, permissions, and revisions belong in a metadata system. This separation lets the blob plane optimize sequential media and repair without making every directory operation a storage operation. That is an engineering model, not a claim about Dropbox’s private implementation.

## 2. What the Original System Did

[SOURCE FACT] The index identifies Magic Pocket as an infrastructure topic and explicitly includes the title “Scaling to exabytes and beyond.” It separately identifies a Magic Pocket cold-storage optimization post and a post on verifying exabytes of data. Source: https://dropbox.tech/infrastructure/

[ANALYSIS] The public index supports a narrow conclusion: Dropbox has publicly discussed Magic Pocket in the context of exabyte-scale growth, cold storage, and verification. It does not, in the supplied material, specify a particular erasure-code width, replication factor, placement algorithm, API contract, repair window, or durability percentage.

[ANALYSIS] Consequently, this article does not attribute those mechanisms to Dropbox. The rest of this section is an engineering interpretation of what a system with those stated concerns must do: isolate immutable data from metadata, encode data across failure domains, maintain a manifest for reconstruction, move objects between storage tiers, and continuously check integrity. Each mechanism is developed as a design proposal below.

## 3. Architecture Diagram

[ANALYSIS] The diagram separates the source-backed subject area from components proposed for an interview-ready design. The source-backed label means only that the Dropbox index names the relevant system or concern; it does not mean the index confirms the depicted internals.

```mermaid
flowchart LR
    C[Client / Dropbox service] --> API[Object API\n[Proposed component]]
    API --> META[Metadata and manifest store\n[Proposed component]]
    API --> ING[Ingest and chunker\n[Proposed component]]
    ING --> ENC[Erasure encoder\n[Proposed component]]
    ENC --> PL[Placement service\n[Proposed component]]
    PL --> HOT[Hot tier: SSD or fast disk\n[Proposed component]]
    PL --> COLD[Cold tier: dense / SMR media\n[Proposed component]]
    META --> READ[Read planner and decoder\n[Proposed component]]
    HOT --> READ
    COLD --> READ
    READ --> API
    AUDIT[Verifier / repair scheduler\n[Proposed component]] --> META
    AUDIT --> HOT
    AUDIT --> COLD
    TOPIC[Magic Pocket, exabyte scale, cold storage, verification\n[Source-backed component]] -.-> API
```

[PROPOSED DESIGN] The write path creates immutable chunks, calculates checksums, encodes data and parity, places fragments in independent failure domains, and commits a manifest only after the required fragments are durable. The read path gets the manifest, selects healthy fragments, verifies checksums, and reconstructs missing fragments when necessary.

## 4. System Design Analysis

[SOURCE FACT] The source index names cold storage, SMR storage, SSD-cache removal, and data verification as separate Dropbox infrastructure topics. Source: https://dropbox.tech/infrastructure/

[ANALYSIS] These concerns interact. Cold media lowers cost but usually increases access latency and makes small random writes expensive. Erasure coding lowers durable-storage overhead compared with many full replicas, but writes parity, reads multiple fragments, and makes repair network-intensive. Verification consumes bandwidth and I/O, but without it a silent bit error can remain invisible until a second failure removes the last good copy.

[PROPOSED DESIGN] Use a content-addressed blob layer with immutable chunks. Keep a small metadata record outside the blob layer: object identity, ordered chunk IDs, logical length, checksum root, coding profile, tier, and placement epoch. Never overwrite a committed chunk. A new file revision writes new chunks and a new manifest; garbage collection later removes unreachable chunks after a safety interval.

[PROPOSED DESIGN] Model failure domains explicitly: fragment placements must not share the same drive, host, rack, power domain, or site when the durability policy requires independence. The placement service should reject a plan that satisfies the fragment count but violates domain diversity. A repair job should first restore the minimum recoverability threshold, then restore the preferred distribution.

[ANALYSIS] The control plane is more difficult than the data path. It must make placement decisions from imperfect, changing inventories, while avoiding a repair storm during a site or network outage. Rate limits, per-domain budgets, and repair priorities are durability features, not merely operational tuning.

## 5. Data Model

[PROPOSED DESIGN] A minimal relational representation for the control plane is:

```sql
CREATE TABLE blob_manifest (
  blob_id            VARBINARY(32) PRIMARY KEY,
  revision_id        VARBINARY(32) NOT NULL,
  logical_size       BIGINT NOT NULL,
  chunk_count        BIGINT NOT NULL,
  coding_profile     VARCHAR(32) NOT NULL,
  checksum_root      VARBINARY(32) NOT NULL,
  tier               VARCHAR(16) NOT NULL,
  state              VARCHAR(16) NOT NULL,
  placement_epoch    BIGINT NOT NULL,
  created_at         TIMESTAMP NOT NULL
);

CREATE TABLE fragment (
  blob_id            VARBINARY(32) NOT NULL,
  chunk_index        BIGINT NOT NULL,
  fragment_index     INT NOT NULL,
  fragment_id        VARBINARY(32) NOT NULL,
  domain_id          VARCHAR(128) NOT NULL,
  device_id          VARCHAR(128) NOT NULL,
  checksum           VARBINARY(32) NOT NULL,
  state              VARCHAR(16) NOT NULL,
  PRIMARY KEY (blob_id, chunk_index, fragment_index)
);
```

[PROPOSED DESIGN] `blob_manifest` is the commit record; `fragment` is the placement and integrity index. In production, these tables would be sharded by `blob_id` and replicated by the metadata subsystem. A manifest state machine can distinguish `STAGING`, `COMMITTED`, `DELETING`, and `DELETED`; readers serve only `COMMITTED` manifests.

## 6. API Design

[PROPOSED DESIGN] An internal API can expose idempotent operations:

```text
CreateUpload(idempotency_key, expected_size, policy) -> upload_id
PutChunk(upload_id, chunk_index, bytes, checksum) -> accepted
CommitUpload(upload_id, checksum_root) -> blob_id
GetManifest(blob_id) -> manifest
ReadRange(blob_id, offset, length) -> byte stream
DeleteBlob(blob_id, deletion_token) -> accepted
```

[PROPOSED DESIGN] `PutChunk` is retriable because the idempotency key and chunk index identify the intended write. `CommitUpload` must be conditional on a complete manifest and a verified durability state. `ReadRange` should return a stream rather than materialize a full object; the read planner can fetch only the chunks intersecting the range. Deletion is logical first, physical later, so an in-flight reader does not race immediate reclamation.

[ANALYSIS] The API should not expose fragment locations to ordinary callers. Locations are an implementation detail and a security boundary. A repair worker may use a privileged internal API that reads verified fragments and writes replacement fragments under a new placement epoch.

## 7. Scaling Strategy

[PROPOSED DESIGN] Shard metadata by a stable hash of `blob_id`, and split large manifests from the hot lookup path when objects contain many chunks. Route each data request to the placement epoch recorded in the manifest; this avoids a global lock while rebalancing.

[PROPOSED DESIGN] Partition the data plane by storage cell. A cell owns a bounded inventory of devices and failure domains, with a local scheduler for ingest, reads, scrubbing, and repair. A global allocator assigns new cells and controls cross-cell movement. Bounded cells make blast radius and queue behavior observable; they also prevent one global repair queue from becoming the system’s hidden bottleneck.

[ANALYSIS] Rebalancing should be demand-aware. Moving cold data merely to equalize bytes can create unnecessary risk and network load. Prefer gradual migration, reserve bandwidth for foreground reads, and make every movement resumable. New hardware should receive data through a controlled ramp rather than an immediate full load.

[PROPOSED DESIGN] Tier transitions should be policy-driven: age, access history, legal hold, and recovery priority can determine whether a blob stays hot or moves cold. A transition is a copy-and-verify operation followed by an atomic manifest update. If verification fails, retain the old tier and retry; do not make tier movement itself a data-loss event.

## 8. Failure Scenarios

[PROPOSED DESIGN] Drive failure: mark fragments unavailable, select surviving fragments, reconstruct the missing fragment, checksum it, and place it in a distinct domain. Limit concurrent repairs per cell and prioritize blobs closest to their recoverability threshold.

[PROPOSED DESIGN] Host or rack failure: the placement policy should already have spread fragments across those domains. Reads use any sufficient verified set. The repair planner waits for evidence that the domain is unavailable before creating duplicate work, unless the remaining margin is unsafe.

[PROPOSED DESIGN] Site isolation: stop placement into the affected site, fail reads to other sites, and preserve the manifest as the source of truth. Do not synchronously require every write to traverse a failed site. Once connectivity returns, reconcile placement epochs and run bounded repairs.

[PROPOSED DESIGN] Silent corruption: a checksum mismatch removes the fragment from the read candidate set. Reconstruct from other verified fragments, write a replacement, and retain the evidence for device and media health analysis. Scrubbing must be scheduled so it cannot consume all bandwidth needed by customer traffic.

[PROPOSED DESIGN] Metadata outage: serving reads requires a cached, strongly validated manifest or a healthy metadata quorum. If neither is available, fail closed rather than guessing fragment locations. This makes metadata availability part of blob availability and warrants independent replication and backups.

[ANALYSIS] The deepest failure mode is correlated failure: a coding scheme that tolerates individual disks may still fail when a rack, site, operator action, or bad software release affects many fragments together. Fault-domain placement, staged rollouts, deletion holds, and disaster exercises address correlations that parity mathematics alone cannot.

## 9. Capacity Estimation

[PROPOSED DESIGN] The following is an illustrative assumption, not a Dropbox measurement: a logical corpus of `10 EB`, with an erasure-coding profile of `k=10` data fragments and `m=4` parity fragments. Ignoring metadata and temporary repair space, raw durable capacity is:

```text
raw_capacity = logical_capacity * (k + m) / k
             = 10 EB * 14 / 10
             = 14 EB
```

[PROPOSED DESIGN] Add separate illustrative assumptions of `15%` for free space and repair headroom and `5%` for metadata, checksums, and operational overhead:

```text
planned_capacity = 14 EB * (1 + 0.15 + 0.05)
                 = 16.8 EB
```

[ANALYSIS] The calculation demonstrates why “exabyte scale” is an accounting problem as much as a disk-count problem. The real model must include chunk-size distribution, compression, deleted-but-held data, rebuild amplification, tier mix, site reservations, and the peak rate at which repairs consume network and device I/O. No Dropbox capacity figure is asserted here because none is present in the supplied source.

## 10. Trade-offs

[ANALYSIS] Erasure coding versus replication: coding generally improves space efficiency, while replication gives simpler low-latency reads and repairs. A practical design can use replication for small or hot objects and coding for sufficiently large, colder objects, but every extra policy increases operational complexity.

[ANALYSIS] Hot versus cold media: hot placement protects latency and operational agility; cold placement improves cost efficiency for infrequently read data. A tier boundary based only on age will misclassify periodically accessed content, so access signals and hysteresis matter.

[ANALYSIS] Verification versus foreground traffic: aggressive scrubbing detects damage sooner but competes for I/O and network. The safe target is not maximum checking; it is a measurable detection window under a bounded resource budget.

[PROPOSED DESIGN] Immutable data simplifies concurrency and auditability but makes garbage collection essential. Keep tombstones and legal holds in metadata, use a mark-and-sweep process, and require a delayed deletion window before reclaiming unreferenced fragments.

## 11. What We Can Learn From This Architecture

[SOURCE FACT] Dropbox’s infrastructure index presents Magic Pocket alongside exabyte scaling, cold-storage optimization, storage-media evolution, and exabyte verification topics. Source: https://dropbox.tech/infrastructure/

[ANALYSIS] The useful lesson is not a magic coding constant. It is that storage economics, durability, verification, and hardware lifecycle must be designed together. A cheap byte that cannot be verified is not durable; a durable byte that cannot be repaired within the failure budget is not a reliable service.

[ANALYSIS] A second lesson is to treat operations as architecture. Placement epochs, repair throttles, domain-aware scheduling, integrity evidence, and controlled migrations are data-model and protocol decisions. They should be testable in a failure simulator, not left to runbooks after the storage engine is built.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN] Requirements: store immutable blobs; support resumable uploads and range reads; survive device, rack, and site failures; detect silent corruption; place infrequently accessed data on a cheaper tier; and expose predictable deletion semantics. The numbers in this design are illustrative assumptions, not Dropbox facts.

[PROPOSED DESIGN] Start with a manifest service and a blob service. The manifest service owns object state, chunk ordering, coding profile, checksums, and placement epochs. The blob service owns bytes and never decides object visibility. Upload into staging, verify fragments, then atomically publish the manifest.

[PROPOSED DESIGN] Use a configurable erasure-code profile and place each fragment in a different required failure domain. On reads, fetch the minimum verified set, retry another fragment on checksum failure, and reconstruct only the missing data. On repair, restore threshold first, then distribution. Keep repair queues per cell and reserve bandwidth for user reads and writes.

[PROPOSED DESIGN] Add a verifier that performs scheduled scrubbing and event-driven checks after device errors, migrations, and reads. Its output should be durable evidence tied to fragment identity and device identity. A tier manager should copy, verify, and atomically switch the manifest, with rollback to the old tier when verification fails.

[ANALYSIS] The interview’s key invariants are: a committed manifest points only to reconstructable data; a checksum failure never becomes a valid read; deletion cannot reclaim data still protected by a hold; and repair cannot violate failure-domain diversity. Capacity, latency, and durability targets should be selected only after the interviewer supplies workload and failure assumptions.

## Original Sources

- Company: Dropbox
- Exact Article Title: Infrastructure
- URL: https://dropbox.tech/infrastructure/
- What information from the source was used: The page’s infrastructure index lists Magic Pocket topics including “Scaling to exabytes and beyond,” “Inside the Magic Pocket,” “How we optimized Magic Pocket for cold storage,” “Pocket watch: Verifying exabytes of data,” storage-media topics, and a data-center disaster-readiness test. No private implementation detail or capacity figure beyond those listed titles was inferred as a source fact.
