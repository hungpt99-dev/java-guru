---
title: "Designing a Durable Real-Time Chat System"
description: "A scoped design for ordered, multi-device chat with durable history and large-scale concurrent connections."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Problem and boundaries

We need chat for a consumer product used by people, support agents, and automated clients. A user can create a direct or group conversation, send text and media, see presence, receive typing indicators, search recent history, and catch up after a device has been offline. One account can have several phones, browsers, and desktop clients.

The difficult part is not opening a WebSocket. It is combining durable writes, per-conversation ordering, retries, reconnects, and multi-device delivery without making transient state as expensive or reliable as message history.

### [SOURCE FACT] Required guarantees

- Every accepted message is durable and has one position within its conversation.
- The send response is returned after durable commit, not merely after an in-memory enqueue.
- Delivery is at-least-once. Clients deduplicate by `message_id` and resume from a cursor.
- Presence and typing are ephemeral and may be stale. Message history is durable.
- The target is p99 send acknowledgement below 200 ms in-region, millions of concurrent WebSocket connections, durable history, and multi-device synchronization.

This is not a global total-order broadcast system. Ordering is per conversation. Media bytes are stored outside the message database. Those boundaries keep the strongest guarantees limited to the data that needs them.

## 2. Scale model

### [ANALYSIS] Planning assumptions

These values are planning inputs, not product facts. They must be replaced with measured traffic before capacity is committed.

| Quantity | Assumption | Rationale |
|---|---:|---|
| DAU | 50 million | Large consumer deployment, for planning |
| Active senders/day | 20% of DAU | Some users read without sending |
| Messages/sender/day | 20 | Includes text and media-metadata messages |
| Average message envelope | 1 KB | Text, IDs, timestamps, and a few attributes |
| Media attachment average | 2 MB, 5% of messages | Media is stored outside hot message rows |
| Retention | 3 years | Durable product history |
| Peak multiplier | 10x average | Regional time-zone and event spikes |

The resulting illustration is:

```text
Messages/day = 50,000,000 x 20% x 20 = 200,000,000
Average writes = 200,000,000 / 86,400 = 2,315 writes/s
Planning peak = 2,315 x 10 = 23,150 writes/s
```

Each message also creates an outbox event. Before replication, the durable write path therefore handles about 46,300 row or event writes/s. At-least-once delivery and retries are not counted as new user messages.

Raw message storage for three years is `200,000,000 x 1 KB x 1,095 days = 219 TB` decimal. With two replicas, indexes, tombstones, and 30% headroom, the estimate is `219 x 2 x 1.3 = 569 TB`.

Media storage is `200,000,000 x 5% x 2 MB x 1,095 = 21.9 PB` before lifecycle compression or deletion. Media belongs in object storage, served through a CDN where appropriate; it does not belong in the hot message table.

At the planning peak, message ingress is about `23,150 x 1 KB = 23 MB/s` or `184 Mb/s`. If the same peak factor applies to media, upload traffic is approximately `1,158 x 2 MB = 2.3 GB/s`. Clients should therefore upload multipart data directly to object storage rather than proxying the bytes through the chat service.

The model assumes a typical active user makes 12 conversation reads/day: 600 million reads/day, 6,944 average read requests/s, and about 69,440 at peak. Excluding WebSocket frames, the read-to-write request ratio is approximately 3:1.

For 10 million concurrently connected clients, assuming 20% are connected in each region, four regions would hold 2 million sockets each. At an assumed average outbound rate of 4 KB/s per connected client for presence, typing, and messages, that is 8 GB/s of egress per region at that occupancy.

The availability objectives in this model are 99.99% for message acceptance and history reads, and 99.9% for presence. Presence can have the lower objective because it is recoverable; history cannot be reconstructed from a stale presence signal.

Capacity is provisioned for 2x the forecast peak. A 100% annual growth review is a planning trigger to add shards rather than stretch one cluster beyond its failure domain. These are design assumptions, not guarantees.

## 3. API contract

### [PROPOSED DESIGN] HTTP

HTTP APIs authenticate with a short-lived access token. The WebSocket upgrade uses the same token. Every mutating request accepts an idempotency key scoped to the authenticated user, so a client retry does not create a second resource or message.

The following payloads are illustrative examples; their IDs and timestamps are not production facts.

```http
POST /v1/conversations
Authorization: Bearer <token>
Idempotency-Key: 7d2e...
Content-Type: application/json

{"type":"group","member_ids":["u2","u3"],"title":"Project"}
```

```json
{"conversation_id":"c_91","created_at":"2026-08-15T03:00:00Z","last_seq":0}
```

```http
POST /v1/conversations/{conversation_id}/messages
Authorization: Bearer <token>
Idempotency-Key: client-device-42:local-881
Content-Type: application/json

{"client_message_id":"local-881","text":"hello","attachments":[]}
```

```json
{"message_id":"m_7","conversation_id":"c_91","seq":1842,"sender_id":"u1","text":"hello","created_at":"2026-08-15T03:00:01Z"}
```

`POST /v1/media/upload-sessions` returns a bounded, authenticated object-storage upload URL. The client uploads the bytes and sends the resulting object ID in the message request.

`GET /v1/conversations/{id}/messages?after_seq=1830&limit=50` returns messages and `next_after_seq`; the server caps `limit` at 100. `POST /v1/conversations/{id}/read-cursors` stores a device cursor. `GET /v1/conversations?cursor=...` lists memberships and last-read state.

### [PROPOSED DESIGN] WebSocket

The endpoint is `GET /v1/realtime` with subprotocol `chat.v1`. Frames include `message.new`, `message.ack`, `typing.start/stop`, `presence.update`, and `sync.required`.

On reconnect, a client sends:

```json
{"type":"resume","conversation_cursors":{"c_91":1840}}
```

The server replays history after each cursor, then switches that conversation to live delivery. Clients acknowledge delivery with `message.received`, but must not treat that acknowledgement as durable send acknowledgement. A send is complete only when the message write and its associated outbox record have committed.

## 4. Data model

### [PROPOSED DESIGN]

Use a distributed SQL database as the authoritative store. Conversation membership and message metadata need transactions and predictable conditional writes. Object storage holds media.

```sql
CREATE TABLE conversations (
  conversation_id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  created_at TIMESTAMPTZ NOT NULL,
  next_seq BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE conversation_members (
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX members_by_user ON conversation_members (user_id, conversation_id);

CREATE TABLE messages (
  conversation_id UUID NOT NULL,
  seq BIGINT NOT NULL,
  message_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  client_message_id TEXT NOT NULL,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (conversation_id, seq),
  UNIQUE (sender_id, client_message_id)
);
CREATE INDEX messages_by_id ON messages (message_id);

CREATE TABLE outbox (
  event_id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  seq BIGINT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ NULL,
  UNIQUE (conversation_id, seq)
);
```

`(conversation_id, seq)` makes history scans ordered and local to a conversation. `members_by_user` supports login fan-out and membership checks; the primary key supports the query “who belongs to this group?”

The unique `(sender_id, client_message_id)` constraint makes an HTTP retry return the original message instead of allocating another sequence. `messages_by_id` supports lookup by the public message identifier. The outbox unique key prevents publishing two durable events for the same conversation sequence.

The schema is a proposed starting point. Partitioning, replication topology, retention deletion, search indexing, and the exact transaction used to allocate `next_seq` require workload and database-specific validation; they are not implied by this example.
