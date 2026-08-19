---
title: "Designing a Video Processing and Streaming System"
description: "A production-oriented design for ingesting, transcoding, packaging, protecting, and delivering video with predictable latency and cost."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Problem and Boundaries

We need a multi-tenant video platform for creators, education providers, and internal media teams. A user uploads a source file, can observe processing progress, receives thumbnails, and publishes the resulting asset. Viewers play published assets on phones, browsers, and connected TVs.

> **[SOURCE FACT]** The stated product requirements are resumable video uploads, optional captions, adaptive-bitrate (ABR) renditions at 240p, 360p, 480p, 720p, 1080p, and 4K when supported by the source; a poster and contact sheet; HLS and DASH packaging; per-title encryption; DRM/license enforcement; durable progress; complete-asset validation; and private, tenant-visible, and public playback.

> **[SOURCE FACT]** The stated operating targets are at least 25,000 source hours processed per hour during the normal peak window, time to first playable frame under 8 seconds on a warm CDN path and under 30 seconds after a new upload is published, 99.95% monthly control-plane availability, and 99.99% manifest/segment delivery availability. Source and derived media must be durable, storage growth and egress cost must be bounded, workers must scale horizontally, and failures of a worker, queue, database, cache, or region must not cause duplicate billing or publication.

> **[ANALYSIS]** The API should own authorization, metadata, workflow state, and progress. Object storage should hold large immutable media objects, and the CDN should deliver them. Upload and publish requests must enqueue work; they must not wait for transcoding.

This separation also makes retry behavior clearer. Control-plane operations can be idempotent and transactional, while media processing can be retried from durable inputs and intermediate outputs.

## 2. Capacity Model

> **[ANALYSIS]** The following is a capacity target, not a claim about an existing product. The numbers are the stated assumptions and calculations used to expose design constraints.

| Quantity | Assumption and calculation | Result |
|---|---|---:|
| Daily active users | Given product target | 5,000,000 DAU |
| API requests | 5,000,000 users x 20 requests/day | 100,000,000 requests/day |
| Average API RPS | 100,000,000 / 86,400 | 1,157 RPS |
| Peak API RPS | 1,157 x 10 for launches and evening viewing | 11,570 RPS |
| Uploads | 300,000/day x 20 minutes average | 100,000 source hours/day |
| Processing peak | Given processing target | 25,000 source hours/hour |
| Source storage/day | 300,000 x 1.5 GB average source | 450 TB/day |
| Derived storage/day | 450 TB x 0.9 for the ladder, manifests, and thumbnails | 405 TB/day |
| Hot storage retained | (450 + 405) TB x 30 days | 25.65 PB hot |
| Viewer egress | 5,000,000 x 2 hours/day x 1.5 Mbps average | 6.75 PB/day |
| Read:write ratio | 100,000,000 API requests / 300,000 upload sessions | about 333:1 |

The 1.5 GB source assumption is intended to represent a 20-minute, mixed-quality upload at roughly 10 Mbps including container overhead. The 1.5 Mbps viewing rate is a population average across mobile and broadband, not the top ABR rung. Egress is therefore much larger than ingest; CDN cache hit ratio and origin shielding are major cost controls.

At 25,000 source hours/hour, a 20-minute source produces 75,000 jobs/hour. If one normalized transcode job consumes 12 worker-minutes, with parallel renditions grouped into that job, steady compute is 15,000 worker-hours/hour, or 15,000 concurrent worker equivalents. A 30% headroom target gives a fleet size of 19,500 equivalents. These are planning inputs, not benchmark results. A real estimate must measure the codec, resolution, and hardware mix.

Ingesting 450 TB/day produces 13.5 PB/month before replication. If the object-storage service provides three-way durability, the application should budget logical bytes separately from physical copies. Hot retention is 25.65 PB; after 30 days, originals and rarely watched derivatives can move to cheaper storage, subject to legal hold and tenant policy.

The availability targets imply monthly error budgets of about 21.9 minutes for the 99.95% control plane and 4.4 minutes for 99.99% playback delivery. A synchronous single-region design cannot credibly meet the playback target during a regional outage. Media should be replicated across regions, with CDN origins in at least two regions.

## 3. API Contracts

> **[PROPOSED DESIGN]** Use short-lived bearer tokens, tenant authorization, and an idempotency key on every mutating endpoint. Upload bytes go directly to object storage through a multipart session; application servers never proxy them.

### Create an upload

`POST /v1/uploads`

Request:

```json
{
  "filename": "lecture-01.mov",
  "size_bytes": 2147483648,
  "content_sha256": "optional-full-file-hash",
  "visibility": "private"
}
```

Response `201`:

```json
{
  "upload_id": "upl_01J...",
  "asset_id": "ast_01J...",
  "part_size_bytes": 67108864,
  "parts": [{"part_number": 1, "url": "https://object.example/..."}],
  "expires_at": "2026-08-15T04:00:00Z"
}
```

The client sends `Idempotency-Key: <tenant-id>/<client-upload-id>`. Repeating the request returns the original IDs and does not create another asset. Validate each part checksum and perform a final compose operation so an incomplete or reordered upload cannot enter processing.

### Complete an upload

`POST /v1/uploads/{upload_id}/complete`

Request:

```json
{"parts":[{"part_number":1,"etag":"..."},{"part_number":2,"etag":"..."}]}
```

Response `202`:

```json
{"upload_id":"upl_01J...","asset_id":"ast_01J...","state":"INSPECTING"}
```

The endpoint verifies the object manifest, writes an outbox event in the same database transaction that records state `UPLOADED`, and returns `202`. If the response is lost, the client can read the idempotency record and current state. The outbox prevents a committed state change from losing its corresponding queue event.

### Read status

`GET /v1/assets/{asset_id}` returns state, percentage, completed renditions, errors, and a version. While processing, clients poll with `If-None-Match` every 2 seconds and then back off. The API must not report `PUBLISHED` until manifest validation, encryption, and authorization metadata are complete.

### Publish and play

`POST /v1/assets/{asset_id}/publish` moves a validated asset to `PUBLISHED` after an entitlement check. `GET /v1/assets/{asset_id}/playback` returns a short-lived signed manifest URL and DRM license configuration; it never returns media bytes. The playback token contains tenant, asset, expiry, and policy claims. License requests are authenticated separately and rate-limited by viewer and device.

### Operational contract

Mutations return a stable `request_id`. `409` means the requested state transition is not legal; `429` includes `Retry-After`; `503` is retryable. Clients retry only idempotent operations, using exponential backoff and jitter. Each upload URL is scoped to one object prefix, part, checksum, and expiry.

## 4. Data Model

> **[PROPOSED DESIGN]** PostgreSQL-compatible SQL is the control-plane source of truth. Media bytes live in object storage under immutable keys derived from the asset and rendition IDs.

```sql
CREATE TABLE assets (
  tenant_id     BIGINT NOT NULL,
  asset_id      UUID NOT NULL,
  source_object TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN
    ('UPLOADING','INSPECTING','PROCESSING','READY','PUBLISHED','FAILED')),
  visibility    TEXT NOT NULL CHECK (visibility IN ('PRIVATE','TENANT','PUBLIC')),
  progress      NUMERIC NOT NULL DEFAULT 0,
  version       BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, asset_id)
);

CREATE TABLE renditions (
  tenant_id   BIGINT NOT NULL,
  asset_id    UUID NOT NULL,
  rendition   TEXT NOT NULL,
  object_root TEXT NOT NULL,
  state       TEXT NOT NULL,
  PRIMARY KEY (tenant_id, asset_id, rendition)
);

CREATE TABLE outbox_events (
  event_id    UUID PRIMARY KEY,
  tenant_id   BIGINT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  published_at TIMESTAMPTZ
);
```

Store idempotency records with the tenant and key as a unique pair, plus the request result and expiry. Workers use a row lock or an atomic state transition when claiming a job. A worker crash can then leave work retryable without allowing two workers to publish the same rendition.

A rendition is complete only after its segments, manifest, encryption metadata, and validation result are durable. Publication should be a conditional transition from `READY` to `PUBLISHED`, so a retry cannot publish an incomplete asset.

## 5. Processing Workflow

> **[PROPOSED DESIGN]** Use a durable queue for workflow events and separate queues for inspection, transcoding, thumbnails, packaging, and validation. The source object is immutable; each stage writes versioned output to a new object prefix.

The workflow is:

1. Complete the multipart upload and atomically record `UPLOADED` plus an outbox event.
2. Inspect the container, codecs, duration, dimensions, captions, and integrity. Reject unsupported or corrupt input without deleting the source.
3. Schedule the ABR ladder and thumbnail work. A job records its input version, expected outputs, attempt count, and lease expiry.
4. Transcode renditions independently where useful. Workers renew leases, report durable progress, and write outputs to temporary prefixes.
5. Package HLS and DASH, encrypt the media, and register the key IDs and DRM metadata with the license service.
6. Validate manifests, segment references, encryption metadata, and required renditions. Promote validated outputs to their immutable serving prefix.
7. Record `READY`; publish only after the entitlement check and an explicit publish request.

Progress is an aggregate of stage weights, not a claim that a byte percentage equals user-visible progress. Retries use exponential backoff. Permanent validation errors move the asset to `FAILED` with a stable error code; transient provider failures remain retryable.

## 6. Delivery and Resilience

> **[PROPOSED DESIGN]** Put the CDN in front of immutable manifests and segments. Use origin shielding, signed URLs or cookies, and cache keys that exclude authorization headers while keeping authorization at token issuance and license services.

The playback service checks tenant visibility and entitlement before issuing a short-lived manifest URL. The CDN serves only objects covered by that token. DRM license authorization remains a separate request, which lets license policy change without exposing object-storage credentials.

The control plane uses timeouts on every dependency call, bounded retries only for retry-safe operations, and circuit breakers (ngắt mạch) to stop an unhealthy dependency from consuming all connection-pool slots. Queues provide backpressure (áp lực ngược) between upload volume and worker capacity. Dead-letter queues retain events that need operator or policy review.

The failure policy is explicit:

- A worker failure expires its lease; another worker retries the job from durable input or a verified intermediate output.
- A queue failure pauses new scheduling while committed outbox events remain available for replay.
- A database failure stops state transitions rather than guessing their outcome. Idempotency records prevent a client retry from creating another asset.
- A cache failure bypasses to the database or origin within bounded limits; it must not change authorization decisions.
- A regional failure is handled by cross-region control-plane recovery and replicated media origins. The CDN can select another origin.

Do not use a distributed transaction across the database, object storage, queue, and DRM service. Use local transactions, an outbox, idempotent consumers, and reconciliation jobs instead. Reconciliation compares database state with object manifests and provider records, then either repairs a missing event or marks an inconsistent asset for review.

## 7. Cost and Operations

The dominant costs are expected to be source and derived storage, transcoding compute, and viewer egress. The capacity model already shows why egress requires CDN caching and origin shielding. Lifecycle policies can move old originals and rarely watched derivatives to cheaper storage, but legal hold and tenant retention policy must take precedence.

Track, per tenant and asset, logical source bytes, derived bytes, transcode worker time, storage class, CDN requests, cache hit ratio, origin egress, and license requests. These dimensions support chargeback without charging twice when a job is retried.

Monitor workflow lag, queue age, job lease expiries, retry counts, validation failures, time to first playable frame, manifest error rate, segment origin error rate, and playback authorization failures. Alert on error-budget burn rather than only on host utilization.

## 8. Invariants and Trade-offs

The design depends on a small set of invariants:

- An asset is published only from `READY`, after validation and entitlement checks.
- A completed upload has one immutable source object and one idempotent asset identity.
- A rendition is served only from a validated immutable prefix.
- Every externally visible state transition is durable before its event is acknowledged.
- Retries may repeat work, but they cannot repeat billing or publication.
- Authorization is decided by the control plane and license service, not by an object-storage URL alone.

The trade-off is additional metadata, reconciliation, and lifecycle machinery in exchange for safe asynchronous processing and durable publication semantics. The capacity figures are assumptions to test, not promises of performance. Codec benchmarks, failure drills, and representative playback tests are required before selecting worker types, storage classes, or regional topology.
