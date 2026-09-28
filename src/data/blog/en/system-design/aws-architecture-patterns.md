---
title: "Production Order Processing with AWS Architecture Patterns"
description: "A source-disciplined design for a multi-AZ, queue-backed order-processing system, including its failure boundaries and delivery guarantees."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Problem and Scope

The source used for this article is the [**AWS Architecture Blog**](https://aws.amazon.com/blogs/architecture/). However, the provided source material does not describe a specific production system. It does not provide information about production traffic, database schemas, or detailed implementation of any particular system.

This distinction is important when reading and applying architecture articles. The AWS Architecture Blog provides architecture principles, patterns, and engineering practices, but we should not assume that a specific AWS production system uses a particular topology or implementation unless the source explicitly says so.

Therefore, instead of trying to reconstruct a production system that is not described in the source, this article uses those architecture principles to build an **order processing platform** as a concrete example.

The system has the following requirements:

- A client sends an order without having to wait for the entire fulfillment process to finish.
- Once the request has been safely recorded, the client can receive a response.
- The system must preserve the order even if downstream processing fails.
- If the client retries the request, the system must not create a duplicate order or duplicate side effect.
- Slow operations should be moved out of the request path so they do not directly increase API latency.
- The system should continue accepting and processing work when an Availability Zone or a group of workers has problems.
- The client should be able to check the order status while the fulfillment process is still running.

From these requirements, we can separate the system into several areas:

- **Request path**: receives the request, validates it, and stores the order.
- **Queue**: holds work that needs to be processed and absorbs traffic spikes.
- **Workers**: process fulfillment asynchronously.
- **Read path**: allows clients to check order status independently of fulfillment.

The most important part of this design is to clearly define **what each step guarantees and what happens when a component fails**.

For example, when the API returns `200 OK` after the order has been safely stored, this does not mean that the email has been sent, payment has completed, or fulfillment has finished.

In this design:

> **An accepted order only means that the platform has safely recorded the order. It does not mean that every downstream operation has completed.**

This contract is important because it prevents the user's request from becoming directly dependent on the performance or availability of every downstream service.

## 2. Source Boundary and Proposed System

The verified source for this article is the **AWS Architecture Blog**:

https://aws.amazon.com/blogs/architecture/

The source does not describe a specific runtime system for order processing with components such as a queue, database, retry policy, or multi-AZ topology.

Therefore, the components described in the design below **should not be interpreted as AWS's actual production architecture**.

Instead, this is a proposed design based on architecture principles such as:

- High availability
- Decoupling
- Asynchronous processing
- Queue-based architecture
- Fault isolation
- Retry
- Idempotency
- Multi-AZ deployment

In the proposed design, the Order API writes both the **order** and an **outbox event** in the same database transaction.

An **outbox relay** then reads unpublished events and publishes them to a durable queue.

Fulfillment workers consume messages from the queue and process the orders.

Notifications are separated into their own queue and worker so that sending emails or webhooks does not directly affect the fulfillment flow.

The overall flow looks like this:

```text
Client
  │
  ▼
Order API
  │
  ├── Order
  │
  └── Outbox Event
        │
        ▼
   Outbox Relay
        │
        ▼
   Order Queue
        │
        ▼
Fulfillment Worker
        │
        ├── External Fulfillment
        │
        └── Notification Queue
                  │
                  ▼
          Notification Worker
```

When the client sends an order, the API only needs to complete the critical part of the request:

1. Validate the request.
2. Check the idempotency key.
3. Store the order.
4. Store the outbox event.
5. Commit the transaction.
6. Return the response.

The API does not need to wait for the fulfillment provider or email provider to finish.

This reduces the dependency between different parts of the system.

For example, if the email provider takes 10 seconds to respond, the order creation request does not also need to take 10 seconds.

## 3. Architecture

Because the provided source does not describe specific runtime components, the architecture below is a **proposed design**, not a reconstruction of an actual AWS production system.

```text
┌──────────┐
│  Client  │
└────┬─────┘
     │
     ▼
┌─────────────────────┐
│ API Ingress         │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Order API           │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Orders + Outbox     │
│ Database            │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Outbox Relay        │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Durable Order Queue │
│ [Proposed]          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Fulfillment Workers │
│ [Proposed]          │
└──────┬──────────────┘
       │
       ├─────────────────────┐
       │                     │
       ▼                     ▼
┌───────────────┐    ┌────────────────────┐
│ External      │    │ Notification Queue │
│ Fulfillment   │    │ [Proposed]         │
└───────────────┘    └─────────┬──────────┘
                               │
                               ▼
                      ┌────────────────────┐
                      │ Notification       │
                      │ Workers            │
                      │ [Proposed]         │
                      └─────────┬──────────┘
                                │
                                ▼
                       Email/Webhook Provider
```

Order status can be exposed through a separate API:

```text
Client
  │
  ▼
Order Status API
  │
  ▼
Orders Database
```

The status API does not need to call the fulfillment provider or notification provider.

This allows the client to check the current order state even when downstream processing is slow.

### Multi-AZ Deployment

If deployed on AWS, stateless APIs and worker pools can be distributed across at least two Availability Zones.

For example:

```text
                 Load Balancer
                       │
          ┌────────────┴────────────┐
          │                         │
     Availability Zone A       Availability Zone B
          │                         │
      API / Worker              API / Worker
          │                         │
          └────────────┬────────────┘
                       │
                  Data Layer
```

However, **multi-AZ does not mean the system has an absolute availability guarantee**.

Many other failures can still happen:

- Database connection pool exhaustion.
- External dependency failures.
- Worker memory leaks.
- Bad deployments.
- Queue consumer failures.
- Database overload.
- Slow external providers.

Therefore, running across multiple Availability Zones only addresses one category of failure. The system still needs timeouts, retries, idempotency, monitoring, and failure handling at each layer.

## 4. Request Path and Delivery Guarantees

One important goal of this design is to separate **accepting an order** from **processing the order**.

When the client sends a request:

```text
Client
   │
   │ POST /orders
   │
   ▼
Order API
   │
   ├── Validate request
   │
   ├── Check idempotency key
   │
   ├── Insert order
   │
   └── Insert outbox event
          │
          ▼
      COMMIT
          │
          ▼
       Response
```

The API accepts an **idempotency key** from the client.

For example:

```text
Idempotency-Key: 8d3e2c...
```

Suppose the client sends a request but experiences a network timeout.

The client does not know whether the server successfully processed the request, so it retries.

Without idempotency:

```text
Request #1 → Create Order #123
Request #2 → Create Order #124
```

The client intended to create one order, but the system created two.

With an idempotency key, the server can recognize that both requests represent the same operation:

```text
Request #1
Idempotency-Key = ABC
       │
       ▼
Create Order #123

Request #2
Idempotency-Key = ABC
       │
       ▼
Return existing result
```

If the client retries with the same key and the same request data, the server can return the original result.

If the client reuses the same key with a different payload, the request should be rejected because it is likely a client-side error.

The database can enforce this rule with a unique constraint:

```text
(customer_id, idempotency_key)
```

### Why Do We Need an Outbox?

There is a common problem when an application needs to update a database and publish a message to a queue.

Suppose the code does this:

```text
1. Save order to database
2. Publish message to queue
```

The following can happen:

```text
Save order
    │
    ▼
Database commit OK
    │
    ▼
Application crash
    │
    X
Publish message
```

The result is:

```text
Database: Order exists
Queue:    No message
```

The order was created, but no worker knows that it needs to be processed.

The opposite can also happen:

```text
Publish message
    │
    ▼
Application crash
    │
    X
Database commit
```

Now the queue contains a message, but the corresponding order does not exist in the database.

The Outbox Pattern addresses this by storing the order and event in the **same database transaction**:

```text
BEGIN TRANSACTION

INSERT INTO orders ...

INSERT INTO outbox ...

COMMIT
```

If the transaction succeeds:

```text
Order exists
+
Outbox event exists
```

If the transaction fails:

```text
Order does not exist
+
Outbox event does not exist
```

The outbox relay then takes responsibility for publishing the event from the database to the queue.

### Do Not Assume Exactly-Once Delivery

An important detail is that the outbox relay can still publish the same event more than once.

For example:

```text
Relay
  │
  ├── Publish event
  │
  ▼
Queue
  │
  ▼
Success

Relay crashes before marking the event as published
```

When the relay restarts, it may publish the event again.

Therefore:

> **The system should not be designed around the assumption that a message will be delivered exactly once.**

Consumers should be able to safely process duplicate messages.

This is why idempotency is important not only at the API layer but also at the consumer and external side-effect layers.

## 5. Data Model

A relational database is a good fit for the order data because the order state and outbox event need to be written atomically.

For example:

```sql
CREATE TABLE orders (
  order_id          UUID PRIMARY KEY,
  customer_id       UUID NOT NULL,
  idempotency_key   TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  status            TEXT NOT NULL,
  result_json       JSONB,
  created_at        TIMESTAMP NOT NULL,
  updated_at        TIMESTAMP NOT NULL,

  UNIQUE (customer_id, idempotency_key)
);

CREATE TABLE outbox (
  event_id          UUID PRIMARY KEY,
  aggregate_id      UUID NOT NULL,
  event_type        TEXT NOT NULL,
  payload_json      JSONB NOT NULL,
  published_at      TIMESTAMP
);
```

The `request_hash` can be used to check whether a retry request is actually the same as the original request.

For example:

```text
Request #1
Key = ABC
Payload = Order A

Request #2
Key = ABC
Payload = Order A
```

The second request can safely return the result of the first request.

But:

```text
Request #1
Key = ABC
Payload = Order A

Request #2
Key = ABC
Payload = Order B
```

These should not be treated as the same request.

### Outbox Relay

The relay can find events that have not been published yet:

```sql
SELECT *
FROM outbox
WHERE published_at IS NULL;
```

It then publishes the event to the queue.

After successful publication, it updates:

```text
published_at = current_time
```

However, there is still a small gap between these two operations:

```text
Publish event
      │
      ▼
Queue receives event
      │
      X
Relay crashes
      │
      X
published_at has not been updated
```

When the relay runs again, the same event may be published again.

This is why consumers must handle duplicate messages safely.

An idempotency record can be used, or state transitions can be designed so that processing the same event multiple times does not create multiple side effects.

Outbox records do not necessarily need to be deleted immediately after publication.

They can be retained for an appropriate period to support:

- Debugging.
- Auditing.
- Recovery.
- Event replay.

The retention period is an operational decision and is not a fixed value that applies to every system.

## 6. Failure Handling

In a production system, dependencies will sometimes fail or respond slowly.

Therefore, calls to databases and external services should have **timeouts**.

For example:

```text
Worker
   │
   │ call external provider
   ▼
External Provider
   │
   │ no response
   │
   ▼
Timeout
```

Without a timeout, a worker can remain blocked for a long time.

If many workers become blocked:

```text
Worker 1 → waiting
Worker 2 → waiting
Worker 3 → waiting
...
Worker N → waiting
```

Eventually, the worker pool can be exhausted.

### Retry

Not every error should be retried.

For example:

```text
Network timeout       → May retry
Connection reset      → May retry
HTTP 503              → May retry
Invalid request       → Should not retry
Authentication error  → Should not retry continuously
Business validation   → Should not retry
```

For temporary failures, exponential backoff can be used.

For example:

```text
Retry 1 → 1 second
Retry 2 → 2 seconds
Retry 3 → 4 seconds
Retry 4 → 8 seconds
```

In practice, a small random delay, called **jitter**, should also be added so that many workers do not retry at exactly the same time.

Retry attempts should also be limited by:

- Maximum retry count.
- Maximum retry duration.
- Maximum concurrent work.

Unlimited retries can make an already unhealthy dependency even more overloaded.

### Dead-Letter Queue

A message may continue to fail because its data is invalid or because it triggers a permanent application error.

For example:

```text
Message A
   │
   ▼
Worker
   │
   X
Retry
   │
   X
Retry
   │
   X
Retry
```

If the message remains in the main queue and is retried indefinitely, it can consume worker capacity and affect other messages.

After reaching the configured retry policy, the message can be moved to a **dead-letter queue (DLQ)**.

```text
Main Queue
    │
    ▼
Worker
    │
    ├── Success → Done
    │
    └── Too many failures
                │
                ▼
               DLQ
```

An operator can inspect the message, fix the underlying problem, and replay it when appropriate.

The replay process must also be safe. If the operation has side effects, putting the message back into the queue must not create duplicate actions.

### Backpressure

When incoming traffic grows faster than the system can process it:

```text
Incoming work
      │
      ▼
    Queue
      │
      │ Queue grows
      ▼
   Workers
```

The queue prevents the system from having to process every request immediately.

But the queue does not make the underlying capacity problem disappear.

If the producer generates:

```text
10,000 messages / second
```

while workers can only process:

```text
5,000 messages / second
```

the queue will continue to grow.

Therefore, the system should monitor:

- Queue depth.
- Message age.
- Worker throughput.
- Worker failure rate.
- Retry rate.

We also should not increase concurrency without limits just to process the queue faster.

For example:

```text
More workers
     │
     ▼
More DB connections
     │
     ▼
Database overloaded
     │
     ▼
More failures
     │
     ▼
More retries
     │
     ▼
Even more load
```

Therefore, the system needs to control the amount of work processed concurrently and protect the database connection pool.

### Circuit Breaker

If an external provider is continuously failing:

```text
Worker → Provider → Error
Worker → Provider → Error
Worker → Provider → Error
...
```

Continuing to call the provider can make the situation worse.

A circuit breaker can temporarily stop requests to that dependency.

```text
Normal
   │
   ▼
Provider errors increase
   │
   ▼
Circuit OPEN
   │
   │ stop calling provider
   ▼
Wait
   │
   ▼
Test again
   │
   ├── Healthy → CLOSED
   │
   └── Still failing → OPEN
```

However, a circuit breaker does not replace timeouts, retries, or idempotency.

It is an additional protection mechanism.

Depending on the business requirements, when the circuit is open, the system may:

- Keep the message in the queue.
- Retry later.
- Return a failure.
- Switch to another processing path.

The right choice depends on the business contract.

## 7. Read Path and Operations

An important property of this architecture is that the **status API does not need to depend on the fulfillment provider**.

The client can call:

```text
GET /orders/{orderId}
```

and receive:

```json
{
  "orderId": "123",
  "status": "PROCESSING"
}
```

The API only needs to read the durable order state.

```text
Client
   │
   ▼
Status API
   │
   ▼
Orders Database
```

It does not need to do this:

```text
Status API
   │
   ├── Call fulfillment provider
   ├── Call payment provider
   └── Call notification provider
```

If the fulfillment provider is slow, the status request should not also become slow.

For example:

```text
GET /orders/123
       │
       ▼
Status API
       │
       ▼
Fulfillment Provider
       │
       X
     timeout
```

The order state is already stored in the database, so there is no reason for the read path to depend on an external fulfillment service.

If read traffic grows independently from write traffic, a separate read projection can be introduced.

However, when using a read projection, the system needs to accept that the projection may not be updated immediately.

For example:

```text
Primary DB
    │
    ▼
Event
    │
    ▼
Read Projection
```

The following state can temporarily exist:

```text
Primary DB:
status = FULFILLED

Read Projection:
status = PROCESSING
```

Therefore, the API should have a clear contract about how quickly the read model is expected to reflect the latest state.

### Monitoring

Important signals should directly represent the failure points of the system.

At the API layer:

- Request error rate.
- Request latency.
- Timeout rate.

At the queue:

- Queue depth.
- Message age.
- Retry count.
- DLQ message count.

At the worker layer:

- Processing success rate.
- Failure rate.
- Processing latency.
- Number of active workers.

At the database layer:

- Connection pool usage.
- Query latency.
- Connection exhaustion.
- Error rate.

At the outbox layer:

- Number of unpublished events.
- Outbox processing latency.
- Publication failure rate.

At the external provider:

- Request latency.
- Timeout rate.
- Error rate.
- Circuit breaker state.

These are not measurements taken from the AWS Architecture Blog. They are proposed operational signals based on the failure modes of this design.

### Failure Testing

The system should not only be tested when everything works normally.

If the architecture claims that it can recover from worker failures, we should actually test it.

For example:

```text
Worker is processing
       │
       ▼
Worker is killed
       │
       ▼
Message becomes available again
       │
       ▼
Another worker processes it
```

If the outbox relay is designed to recover from a crash:

```text
Publish event
       │
       ▼
Relay crashes
       │
       ▼
Relay restarts
       │
       ▼
Event may be published again
       │
       ▼
Consumer safely handles duplicate
```

Other failure scenarios can include:

- External provider responds slowly.
- External provider returns HTTP 5xx.
- Database connection pool is exhausted.
- Queue grows faster than worker throughput.
- One Availability Zone becomes unavailable.
- Workers continuously restart.
- A poison message appears.
- Notification provider becomes unavailable.

The goal is not to prove that the system will **never fail**.

The goal is to prove that when failures happen, the system still maintains the guarantees that we defined.

## 8. Interview Summary

When explaining this architecture in a system design interview, it is better not to start by listing a large number of AWS services.

For example:

```text
API Gateway
→ ECS
→ SQS
→ RDS
→ ElastiCache
→ Lambda
→ SNS
→ ...
```

A better approach is to start with the **requirements, guarantees, and failure scenarios**.

### 1. The order must be safely recorded

The order and outbox event are written in the same database transaction.

```text
Order + Outbox
      │
      ▼
   COMMIT
```

If the transaction succeeds, the system knows that both the order and the event have been stored.

### 2. A message may be delivered more than once

The outbox relay and queue should be designed around **at-least-once delivery**.

We should not assume that a message will appear exactly once.

Therefore, consumers must be idempotent.

### 3. Retrying a request must not create a duplicate order

The client uses an idempotency key.

```text
Same key
   │
   ├── First request → Create
   │
   └── Retry         → Return existing result
```

### 4. External side effects must also be idempotent

A local database transaction cannot make a call to an external system exactly-once.

For example:

```text
Worker
   │
   ▼
External Fulfillment
   │
   ▼
Success
   │
Worker crashes
   │
   ▼
Retry
```

If the external system does not support idempotency, the retry can create a duplicate side effect.

Therefore, an idempotency token should be passed to the external operation when the provider supports it.

### 5. The queue separates the request from processing

The client does not need to wait for fulfillment to finish.

```text
Client
  │
  ▼
API
  │
  ▼
Durable Storage
  │
  ▼
Response

          asynchronous
               │
               ▼
             Queue
               │
               ▼
             Worker
```

This keeps request latency independent from the speed of downstream processing.

### 6. Worker failures can be recovered

Workers can use a lease or visibility timeout so that a message becomes available again if a worker dies while processing it.

```text
Message
   │
   ▼
Worker A
   │
   X
  crash
   │
   ▼
Worker B
   │
   ▼
Retry
```

### 7. Retries must be bounded

Only retry failures that are likely to be temporary.

Use exponential backoff and jitter.

Limit the number of retries or the total retry duration.

If a message still cannot be processed, move it to a DLQ so it does not continuously affect other messages.

### 8. Multi-AZ reduces the impact of an AZ failure

APIs and workers can run across multiple Availability Zones.

However, multi-AZ does not solve every failure.

Database overload, bad deployments, connection pool exhaustion, or external dependency failures can still affect the system.

## Conclusion

The most important part of this architecture is not choosing as many AWS services as possible.

The important question is:

> **If one component fails, what can the system still guarantee?**

A production architecture should be able to answer questions such as:

- If the client retries, will it create a duplicate order?
- If the application crashes after the database commit, can the order be lost?
- If the relay crashes after publishing an event, can the duplicate message create a duplicate side effect?
- If a worker dies while processing an order, can another worker safely continue the work?
- If an external provider becomes slow, will the client's request also become slow?
- If a message continuously fails, can it affect unrelated messages?
- If the queue grows quickly, does the system have a way to control the load?
- If an Availability Zone becomes unavailable, can the system continue accepting requests?
- If read traffic increases significantly, can it affect the write path?

Only after these guarantees are clear should we decide which AWS services to use.

For example:

```text
API Ingress
     ↓
API Service
     ↓
Relational Database
     ↓
Outbox Relay
     ↓
Durable Queue
     ↓
Worker
     ↓
External Services
```

These components can be implemented using different AWS services depending on requirements around scale, operational overhead, consistency, cost, and team capabilities.

Therefore:

> **AWS services are implementation choices. Architecture guarantees are the foundation of the system design.**

The AWS Architecture Blog provides architecture topics and principles that can be used as references. The order processing platform presented in this article is a **proposed design** created to demonstrate how those principles can be applied to a realistic production problem.
