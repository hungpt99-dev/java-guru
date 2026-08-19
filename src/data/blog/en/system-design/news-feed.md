---
title: "Designing a Ranked News Feed with Hybrid Fan-out"
description: "A practical design for a read-heavy, ranked news feed that balances freshness, predictable pagination, and fan-out cost."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Problem and requirements

We need a home feed for a social product. A user follows authors, opens the home screen, and receives a ranked stream of their posts. A post should normally become visible within 30 seconds. The first page should load with p95 latency below 300 ms. Refreshing or paginating must not intentionally duplicate items or lose items merely because ranking changed between requests.

The users of this system are readers, authors, and internal ranking and abuse-prevention services. The functional requirements are:

- create, delete, and retrieve posts;
- follow and unfollow authors;
- collect followed authors' posts and rank them for each reader;
- paginate with an opaque cursor;
- add newly eligible posts to an active feed without invalidating its page boundary;
- hide deleted, blocked, or policy-removed content.

**[SOURCE FACT]** The workload is read-heavy: approximately 1,000 feed reads per post write. Freshness and read latency both matter, but a few seconds of staleness is acceptable. Ranking is personalized and can change as features arrive.

**[ANALYSIS]** A globally identical order is therefore not a useful promise. The useful guarantees are a stable page boundary, no intentional duplicates, and monotonic visibility of committed content within the reader's selected snapshot.

The central design choice is where aggregation occurs. Fan-out-on-write copies a post into each follower's inbox, making reads cheaper but potentially creating millions of writes for a high-degree author. Fan-out-on-read avoids that write amplification, but the reader pays the merge cost on every request. The proposed design uses both paths.

## 2. Scale estimation

The following are explicit assumptions, not forecasts. They make the capacity calculation easy to replace with product measurements.

| Quantity | Assumption | Calculation / result |
|---|---:|---:|
| Daily active users | 50 million | Product target |
| Feed requests per active user/day | 20 | 50M x 20 = 1 billion requests/day |
| Average feed RPS | 1B / 86,400 | 11,574 RPS |
| Peak factor | 10x average | 115,740 RPS; provision for 150k RPS |
| New posts/day | 1 million | One post per 50 DAU per day is a conservative write baseline for a read-heavy feed |
| Post write RPS | 1M / 86,400 | 11.6 average, about 116 peak |
| Read:write ratio | 1B / 1M | 1,000 feed reads per post |
| Retained post record | 2 KiB | 1M x 2 KiB x 365 = 0.73 TB/year before replicas and indexes |
| Feed-edge record | 32 bytes | The illustrative fan-out subset averages 5 followers/post: 5M edges/day x 32 bytes x 30 days = 4.8 GB logical hot-inbox data |
| Feed response | 20 items x 1.5 KiB | 30 KiB; 115,740 x 30 KiB x 8 = 27.8 Gbit/s peak egress before compression |
| Availability target | 99.95% monthly | About 22 minutes of unavailability/month for feed reads; writes may degrade to delayed fan-out |

The average of 5 followers is a **[SOURCE FACT / ASSUMPTION]** for the subset selected for fan-out, not a universal social-graph assumption. High-degree authors use the read path. At 10x growth, the stated assumption yields 500M posts/day and average feed traffic of 115,740 RPS. The hybrid boundary should then move according to measured fan-out amplification, rather than a fixed follower-count threshold.

In practice, storage is larger. Three replicas, indexes, tombstones, moderation metadata, and media pointers can turn the 0.73 TB/year post estimate into approximately 3 TB/year. Media belongs in object storage and is excluded from the feed-database calculation. Inbox edges have a short TTL because they accelerate retrieval; they are not the source of truth.

## 3. API design

All endpoints use HTTPS and an authenticated user identity from the access token. `X-Request-ID` is accepted or generated and propagated to logs and traces. Cursors are opaque and signed. They contain a feed version and the last `(rank_key, post_id)` boundary.

### Read the feed

```http
GET /v1/feed?limit=20&cursor=eyJ2Ijox...
Authorization: Bearer <token>
X-Request-ID: 7f2c...
```

```json
{
  "items": [{"post_id":"p91", "author_id":"u7", "text":"...", "created_at":"2026-08-15T02:00:00Z", "rank":0.984}],
  "next_cursor":"eyJ2IjoxLCJsYXN0IjpbMC45ODQsInA5MSJdfQ",
  "feed_version":"v-20260815-020001",
  "generated_at":"2026-08-15T02:00:03Z"
}
```

`limit` is capped at 100. The cursor keeps the same ranking snapshot for a bounded session, so a new post can appear at the top without shifting the current page. If the snapshot expires, the service returns a new cursor and a `snapshot_expired` warning instead of silently repeating rows.

### Create a post

```http
POST /v1/posts
Authorization: Bearer <token>
Idempotency-Key: 01J...
Content-Type: application/json

{"text":"hello", "media_ids":["m1"]}
```

The response is `201 Created` with the durable `post_id`. The idempotency key is unique per author for 24 hours and stores the original response. A timeout after the database commit can therefore be retried without creating a second post.

### Follow and unfollow

```http
PUT    /v1/users/{author_id}/follow
DELETE /v1/users/{author_id}/follow
```

Both operations are idempotent. The follow record stores `following_since`; the feed reader uses it as a lower bound so old posts are not unexpectedly backfilled. `DELETE` also emits an invalidation event. Materialized rows are filtered at read time until asynchronous cleanup completes.

### Real-time insertion

The client opens `GET /v1/feed/stream` over a WebSocket or server-sent-event connection. The server sends `{event:"new_item", post_id, feed_version}` only after authorization and a lightweight eligibility check. The client prepends the item outside the paginated list and deduplicates by `post_id`; the next HTTP page remains cursor-based.

## 4. Data model

**[PROPOSED DESIGN]** Use sharded SQL as the source of truth. Post creation, follow state, moderation state, and idempotency all need constraints and transactions. The denormalized inbox is a retrieval accelerator and can be rebuilt or allowed to expire.

```sql
CREATE TABLE posts (
  post_id        BIGINT PRIMARY KEY,
  author_id      BIGINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  text           TEXT NOT NULL,
  rank_features  JSONB NOT NULL,
  visibility     SMALLINT NOT NULL DEFAULT 1,
  deleted_at     TIMESTAMPTZ NULL
);
CREATE INDEX posts_author_time ON posts (author_id, created_at DESC, post_id DESC);

CREATE TABLE follows (
  follower_id       BIGINT NOT NULL,
  followed_id       BIGINT NOT NULL,
  following_since   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (follower_id, followed_id)
);
CREATE INDEX follows_reverse ON follows (followed_id, follower_id);

CREATE TABLE feed_inbox (
  reader_id      BIGINT NOT NULL,
  rank_key       DOUBLE PRECISION NOT NULL,
  post_id        BIGINT NOT NULL,
  author_id      BIGINT NOT NULL,
  inserted_at    TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (reader_id, rank_key, post_id)
);
CREATE INDEX feed_inbox_expiry ON feed_inbox (expires_at);

CREATE TABLE outbox_events (
  event_id       BIGSERIAL PRIMARY KEY,
  aggregate_id   BIGINT NOT NULL,
  event_type     TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  published_at   TIMESTAMPTZ NULL
);
```

The post, follow, and outbox rows should be committed atomically where they share a database shard. A publisher reads unpublished outbox rows and sends them to the fan-out and ranking pipelines. Consumers must be idempotent: retries can deliver the same event more than once, so inbox insertion uses a uniqueness key and safe upsert semantics.

## 5. Hybrid fan-out

**[PROPOSED DESIGN]** The publish path writes the post and its outbox event first. It does not wait for every follower inbox write before returning success. A fan-out consumer reads the event, checks the author's degree and policy state, and chooses a path:

- ordinary authors: enumerate followers and insert an inbox row for each reader;
- high-degree authors: do not enumerate the full follower set; retain the post in the author's time-ordered store and merge it during feed reads;
- posts that fail visibility or policy checks: do not materialize them.

The read service obtains a candidate set from the reader's inbox, then queries recent posts from high-degree followed authors. It merges candidates by `rank_key` and `post_id`, filters follow state and visibility, and fetches post bodies in batches. A cache may hold post bodies or ranking features, but it must not become the only copy of committed data.

This split makes the trade-off explicit. Fan-out-on-write spends storage and asynchronous write capacity to reduce read work. Fan-out-on-read spends read CPU and backend queries to avoid write amplification. The boundary is an operational policy derived from measured cost and latency, not a universal constant.

## 6. Ranking and pagination

Ranking can change when features arrive, content is deleted, or a user follows or unfollows an author. Re-ranking an already open page would make ordinary offset pagination unsafe.

**[PROPOSED DESIGN]** At the first request, create a feed version that identifies the ranking snapshot and its expiry. Store the last `(rank_key, post_id)` pair in the signed cursor. The next request asks for items strictly after that pair in the same snapshot. `post_id` is the deterministic tie-breaker when two items have the same rank.

New real-time items are separate from the cursor sequence. The client can show them above the current list, while the paginated sequence continues from its original boundary. The client deduplicates by `post_id` because delivery and HTTP retrieval can overlap.

If an item is deleted or blocked after a cursor was issued, the read service filters it and continues scanning. If the snapshot itself has expired, returning `snapshot_expired` is safer than pretending that the old boundary still has the same meaning.

## 7. Freshness, moderation, and failures

The 30-second visibility target is a normal operating target, not a transaction guarantee. Outbox lag, consumer retries, backpressure (giới hạn tốc độ để bảo vệ downstream), and ranking-service latency can delay materialization. The read path can still discover recent posts from followed authors when appropriate, so delayed fan-out does not make a committed post permanently unavailable.

Deletion and blocking are correctness paths, not just cleanup jobs. The visibility check runs while reading, and invalidation events remove or expire materialized rows asynchronously. This closes the window in which an inbox row refers to content that is no longer eligible.

**[PROPOSED DESIGN]** Each downstream call should have a timeout (giới hạn thời gian chờ), bounded retry with jitter, and a fallback appropriate to the dependency. A ranking timeout can use a previously computed rank or a recency-ordered candidate set; a post-body cache miss should fail the affected item rather than fail the whole feed. A circuit breaker prevents a failing dependency from consuming all feed worker capacity. Queue depth and outbox age expose freshness degradation before users report it.

Feed reads can remain available when fan-out is delayed. Post creation should return failure if the source-of-truth transaction fails, but it can return success before asynchronous fan-out finishes. The idempotency record protects retries around that boundary.

## 8. Guarantees and trade-offs

The design provides these practical guarantees:

- committed posts are the responsibility of the source-of-truth store;
- ordinary posts usually reach materialized inboxes within the stated 30-second target;
- high-degree authors avoid a follower-by-follower write burst;
- cursors preserve a bounded ranking snapshot and page boundary;
- deleted, blocked, and policy-removed content is filtered even before cleanup finishes;
- duplicate event delivery does not create duplicate inbox rows.

It does not promise a globally stable ranking, zero staleness, or zero duplicates across a real-time stream and an HTTP page. Those would be different, more expensive guarantees. The hybrid approach is useful because it places each cost where this workload can afford it: asynchronous writes for ordinary fan-out, bounded read-time merging for high-degree authors, and explicit snapshot semantics for pagination.
