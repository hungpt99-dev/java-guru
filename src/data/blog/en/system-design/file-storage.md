---
title: "Designing a Multi-Tenant Object Store"
description: "A practical design for durable, versioned object storage with multipart transfer, tenant-local deduplication, temporary sharing, metadata search, and CDN delivery."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## Problem

We need a multi-tenant object store for product users, internal services, and automation. A client should be able to upload a 4 GB video over an unreliable mobile connection, resume after a process restart, retrieve an older version, and create a link that expires tomorrow. A service should be able to search tenant-owned metadata without scanning blob bytes.

This is not just an upload API. The design must define which bytes are committed, how retries behave, how versions become visible, and how metadata remains isolated from the data path. This article covers the requirements, capacity assumptions, API, storage model, transfer path, consistency, reliability, and security boundaries.

### Requirements

Functional requirements:

- Multipart upload and download, including resumable ranges and parallel parts.
- Immutable object versions. A logical key such as `reports/2026.pdf` may point to a new version while older versions remain addressable.
- Content deduplication within a tenant, without allowing one tenant to infer another tenant's data.
- Authenticated reads and short-lived sharing links with a TTL (time to live) and optional download limits.
- Search over explicitly indexed metadata: tenant, key prefix, content type, tags, size, and creation time.
- Delete, restore, lifecycle expiration, and audit events.

The non-functional contract matters more than a convenient upload endpoint:

- **[SOURCE FACT]** At least 99.999999999% annual durability for committed bytes. This is a durability objective, not a promise that every request remains available during a regional disaster.
- **[SOURCE FACT]** 99.99% monthly availability for metadata APIs and 99.9% for data transfer, with a documented degraded mode.
- Objects range from kilobytes to 5 TB. The metadata plane must not carry object payloads.
- Capacity must grow horizontally, public or shared reads should be cacheable at a CDN edge, checksums must be verified at every storage boundary, and tenants must remain isolated.
- A successful retry must not create a second logical version or charge a client twice.

**[ANALYSIS]** The clean boundary is between a transactional metadata/control plane and an immutable blob/data plane. The control plane defines what an object means and which version is visible. The data plane stores and transfers bytes without putting payloads through the metadata database.

## Scale assumptions

**[ASSUMPTION]** These values are planning inputs, not observed measurements. They should be replaced with product telemetry.

| Quantity | Assumption | Reason |
|---|---:|---|
| Daily active users | 10 million | A large consumer/work collaboration product |
| Object API operations per active user/day | 20 | 8 reads, 2 writes, 10 metadata/list/link actions |
| New logical objects/day | 5 million | Not every API operation creates an object |
| Average new object size | 20 MB | Mix of documents, photos, and short media; large files are a minority |
| Read:write object-byte ratio | 5:1 | Shared assets are downloaded repeatedly |
| Peak multiplier | 10x average | Workday and launch-event concentration |
| Retention | 3 years | Versioning and recovery policy |
| Multipart part size | 64 MiB | Retry granularity without excessive manifest rows |

The request estimate is:

```text
10,000,000 DAU x 20 operations/day = 200,000,000 operations/day
200,000,000 / 86,400 = 2,315 average API requests/second
2,315 x 10 = 23,150 peak API requests/second
```

Writes create `5,000,000 x 20 MB = 100 TB/day` of logical payload. With the stated retention:

```text
100 TB/day x 365 x 3 = 109,500 TB = 109.5 PB logical bytes
```

If tenant-local deduplication removes 25% of repeated content, primary physical bytes are 82.1 PB. Three independently stored copies, or an erasure-coded equivalent with an average 1.5x overhead, require about 123.1 PB in the primary region. A second region with the same durability policy brings the total to approximately 246 PB.

Metadata is smaller but material: `5 million` object versions/day at an average row footprint of `1.2 KB` is `6 GB/day` before indexes, or about `6.6 TB` over `3 years` with `1.2x` row and index overhead. Multipart manifests and part records add roughly 10%.

The 5:1 byte ratio implies about `500 TB/day` of origin egress before CDN caching:

```text
500 TB x 8 / 86,400 = 46.3 Gbit/s average origin egress
46.3 x 10 = 463 Gbit/s peak origin egress
```

With a 70% CDN hit rate, peak origin transfer falls to about 139 Gbit/s, while the edge still serves the full 463 Gbit/s. **[ANALYSIS]** The sizing target is therefore CDN bandwidth and origin protection as well as application request rate. At 99.99% monthly availability, the error budget is about 4.32 minutes/month. Durability is measured separately through repair, checksum, and loss-budget telemetry.

## API contract

All endpoints use HTTPS and require a tenant-scoped bearer token, except for a share URL. `Idempotency-Key` is mandatory on mutating operations. The server binds the key to the tenant, endpoint, request hash, and result for 24 hours. Reusing it with a different request returns `409`.

### Create an upload

```http
POST /v1/tenants/{tenant_id}/uploads
Authorization: Bearer <token>
Idempotency-Key: 01J...
Content-Type: application/json

{
  "key": "videos/demo.mp4",
  "size": 4294967296,
  "content_type": "video/mp4",
  "content_sha256": "optional-final-sha256",
  "metadata": {"project": "demo", "classification": "internal"},
  "dedup_scope": "tenant"
}
```

```json
{
  "upload_id": "upl_7f3",
  "object_id": "obj_91a",
  "version_id": "ver_2b1",
  "part_size": 67108864,
  "expires_at": "2026-08-16T10:00:00Z"
}
```

The control plane reserves a version but does not make it visible. The client uploads each part directly to a signed data-plane URL:

```http
PUT /v1/uploads/upl_7f3/parts/42
Content-Length: 67108864
Content-Digest: sha-256=:...:
```

The response includes the server-observed checksum and an opaque `ETag`. A part number is unique within an upload, so retrying the same part is safe. Reusing it with a different checksum returns `409`.

### Complete or abort

```http
POST /v1/uploads/upl_7f3/complete
Idempotency-Key: 01J...

{"parts":[{"number":1,"sha256":"..."},{"number":2,"sha256":"..."}]}
```

The service verifies part membership, checksums, declared size, and final digest, then atomically transitions the version from `UPLOADING` to `COMMITTED`. A repeated completion returns the original result. `DELETE /v1/uploads/{upload_id}` aborts an upload; a sweeper also expires abandoned uploads.

### Read, list, and share

```http
GET /v1/tenants/{tenant_id}/objects/{key}?version_id=ver_2b1
Range: bytes=0-67108863
```

The API either redirects to a signed, range-capable data URL or streams through a gateway for policy enforcement. Listing is cursor-based and bounded:

```http
GET /v1/tenants/{tenant_id}/objects?prefix=videos/&limit=100&cursor=...
```

It lists committed versions and does not promise an unbounded directory.

```http
POST /v1/tenants/{tenant_id}/shares
Idempotency-Key: 01J...

{"version_id":"ver_2b1","ttl_seconds":86400,"max_downloads":3}
```

The response contains a random, non-enumerable token. `GET /s/{token}` checks revocation, expiry, and download count before issuing a short-lived CDN URL. The share token is not an object key and is stored as a hash.

### Search and lifecycle

```http
POST /v1/tenants/{tenant_id}/search

{"filters":{"content_type":"video/mp4","tags":{"project":"demo"},"size_gte":1000000},"sort":"created_at_desc","limit":50,"cursor":"..."}
```

Search runs only over indexed metadata. The write path records the committed version and publishes an indexing event. **[ANALYSIS]** Search can be eventually consistent: the authoritative object read and list APIs use the metadata database, while search may briefly lag it. A result must still be rechecked against the current tenant and version state before download.

Lifecycle policy evaluates committed versions and writes a deletion tombstone or a restore marker rather than mutating blob bytes in place. Audit events record who requested the operation, which tenant and version it affected, and the result.

## Storage model

**[PROPOSED DESIGN]** Keep object identity, logical keys, versions, upload sessions, parts, deduplication references, shares, and lifecycle state in the metadata store. A simplified model is:

- `objects`: tenant, logical key, current version, and deletion state.
- `versions`: immutable version identity, size, content type, metadata, digest, state, and blob manifest.
- `uploads`: upload identity, reserved version, expected size/digest, expiry, and state.
- `parts`: upload identity, part number, size, checksum, and data-plane location.
- `chunks`: tenant-scoped content digest, physical location, reference count, and verification state.
- `shares`: token hash, version, expiry, download limit, and revocation state.

The blob store is addressed by opaque internal identifiers, not user keys. A manifest maps a committed version to ordered parts or chunks. User-visible key changes update metadata only; they do not copy bytes.

### Deduplication

**[PROPOSED DESIGN]** Calculate a content digest at the data boundary and deduplicate only within the tenant. The metadata transaction must atomically create or reference the tenant-scoped chunk record and increment its reference count. A digest match is not sufficient by itself: the service must verify size and checksum policy, and authorization must be evaluated before revealing that a matching object exists.

Reference counts are useful for reclamation but should not be the only safety mechanism. A mark-and-sweep repair job can find chunks still referenced by committed manifests and recover from missed decrements. Uncommitted uploads are garbage-collected after expiry.

### Visibility and consistency

Only `COMMITTED` versions are readable. Completion commits the manifest and the version state in one metadata transaction. Reads that name an explicit version remain stable; reads by logical key resolve the current version recorded for that key. Delete creates a tombstone and blocks new reads according to policy, while restore selects an existing immutable version.

The data plane may acknowledge a part before the version is committed. That is safe because the part is unreachable from normal reads until the control plane publishes a valid manifest.

## Transfer path and reliability

Uploads go from the client to the data plane, not through the metadata service. The data plane validates the signed upload scope, part number, length, and checksum, then writes to durable storage. Completion is an explicit barrier: it verifies the manifest and final digest before publication.

Downloads resolve authorization and version state first, then use a signed URL or gateway stream. Range requests map to manifest parts or chunks. CDN caching is allowed only when the cache key includes the immutable version or a safe share authorization boundary. Revocation cannot reliably remove an already cached public response, so sensitive shares should use short URL lifetimes and a gateway policy when immediate revocation is required.

**[ANALYSIS]** Retry handling must distinguish transport failure from operation outcome. Idempotency records make create and complete safe to retry. Part numbers make part replacement deterministic. Timeouts should not trigger an unbounded retry storm; clients and services need bounded retries with backoff, jitter, and a circuit breaker (a mechanism that temporarily stops calls to a failing dependency). Queues between completion, indexing, replication, and audit consumers provide backpressure (slowing producers when consumers cannot keep up).

Checksum verification belongs at client input, part upload, manifest completion, replication, and repair. Repair workers read data, verify it, and rewrite a known-good copy or reconstruct an erasure-coded fragment. Failures are observable through checksum errors, replication lag, repair backlog, abandoned uploads, and unexpected reference-count changes.

## Security and operations

Tenant authorization is enforced in every metadata query and every signed data-plane capability. Object keys are treated as names, not authorization; a key or digest must never be enough to read bytes. Share tokens are random, hashed at rest, scoped to one version, and checked for expiry, revocation, and download count.

Metadata and audit records should be encrypted in transit and at rest according to the platform's security policy. Logs must avoid raw share tokens and sensitive metadata. Rate limits apply separately to metadata requests, upload creation, part traffic, share creation, and downloads so one tenant cannot exhaust a shared pool.

**[PROPOSED DESIGN]** Operate the planes independently. Metadata failures should stop new commits and authorization changes without corrupting already stored bytes; data-plane failures should produce explicit degraded reads or writes rather than falsely committing metadata. Regional replication, storage placement, and repair policy must be selected against the durability objective and tested with restore exercises. The important invariant is simple: bytes become user-visible only after the metadata plane has a verified, durable manifest.
