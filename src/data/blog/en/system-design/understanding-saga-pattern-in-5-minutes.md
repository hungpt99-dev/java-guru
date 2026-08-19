---
title: "Saga Pattern: Coordinating Distributed Workflows"
description: "A practical introduction to Saga transactions in microservices, including event-driven and orchestration-based designs, compensation, and eventual consistency."
pubDatetime: 2025-09-02T11:59:00+07:00
featured: false
draft: false
tags:
  - saga-pattern
  - system-design
  - microservices
---

In a monolith, several data changes can usually share one database transaction. In a microservice system, the same business operation often crosses service boundaries and databases. A failure after one service commits cannot be handled with a single local rollback.

This article explains the Saga pattern, the difference between event-driven and orchestration-based Sagas, and the trade-offs around compensation, partial failure, and eventual consistency. The order flow below is an illustrative example, not a claim about a particular company or production system.

## The problem: one workflow, several local transactions

**[SOURCE FACT]** A traditional transaction provides ACID properties: Atomicity, Consistency, Isolation, and Durability. In a monolithic ordering flow, the application might deduct payment, reserve inventory, and record the order within one database transaction. If a step fails before commit, the transaction can roll back.

With microservices, those responsibilities commonly belong to separate services, each with its own database:

- Payment Service charges the customer.
- Inventory Service reserves or deducts stock.
- Notification Service sends a confirmation.

**[ANALYSIS]** These are separate local transactions. Payment may commit before Inventory reports that stock is unavailable. A database rollback in Inventory cannot undo a committed payment, and a message retry cannot safely repeat a charge unless the operation is idempotent (safe to repeat with the same result).

## What a Saga does

**[SOURCE FACT]** A Saga breaks a distributed business transaction into a sequence of local transactions. Each step commits independently. For steps that have a meaningful reversal, the service also exposes a compensation action. If a later step fails, the workflow runs the compensations required for the earlier completed steps.

Compensation is a new business operation, not a distributed database rollback. A refund, for example, may be asynchronous, fail temporarily, or require reconciliation. The system therefore aims for a valid final state over time rather than atomic visibility across all services.

**[ANALYSIS]** Consider this illustrative order flow:

1. Payment Service charges the customer: success.
2. Inventory Service attempts to reserve stock: out of stock.
3. Notification Service is not started.

Without a Saga, the payment can remain committed even though the order cannot be fulfilled. With a Saga, the failed inventory step causes the workflow to request a payment refund. The notification step is skipped. The result is not instantaneous atomic consistency; it is a controlled recovery path with an explicit business outcome.

## Two implementation styles

### Event-driven Saga

**[SOURCE FACT]** In an event-driven Saga, a service publishes an event after a local transaction completes. Other services consume the event and start their own work. A simplified flow is:

1. Payment Service charges the customer and publishes `PaymentSuccess`.
2. Inventory Service consumes the event and attempts to reserve stock.
3. If reservation fails, Inventory Service publishes `InventoryFailed`.
4. Payment Service consumes that event and starts a refund.

**[ANALYSIS]** This style avoids a dedicated central orchestrator and lets services react to events. It can be a reasonable fit when the workflow is naturally event-oriented. The trade-off is distributed workflow state: events can be delayed, delivered more than once, or processed out of order. Consumers need idempotency, durable event handling, and an operational way to inspect the workflow.

### Orchestration Saga

**[SOURCE FACT]** In an orchestration Saga, an orchestrator owns the workflow state and sends commands to participating services. A simplified flow is:

1. The orchestrator commands Payment Service to charge the customer: success.
2. It commands Inventory Service to reserve stock: failure.
3. It commands Payment Service to refund the charge.
4. It does not command Notification Service to send the confirmation.

**[ANALYSIS]** Centralized workflow state makes complex paths, status tracking, and compensation ordering easier to reason about. The orchestrator is also another component to operate. If it is unavailable or becomes a bottleneck, workflow progress is affected. This is an availability and capacity concern, not proof that the pattern is inherently unsafe.

## Design considerations

**[PROPOSED DESIGN]** For either style, define the following before implementing the workflow:

- The local transaction owned by each service.
- The compensation, if one exists, and whether it is safe to retry.
- An idempotency key for commands and events that may be delivered more than once.
- Timeout and retry behavior, including a fallback when a dependency remains unavailable.
- The terminal business states, such as `RefundPending` or `OrderCancelled`, instead of assuming every failure can be hidden.
- Monitoring for stuck workflows, failed compensations, and messages that exceed their expected processing time.

Do not use compensation as a generic undo button. Some actions cannot be reversed exactly, and a notification failure does not necessarily justify reversing a successful payment. The business policy should decide which failures trigger compensation.

## Key terms

- **Transaction:** A sequence of data operations governed by transactional guarantees such as ACID. A bank transfer is a common example: if debiting one account succeeds but crediting the other fails, the transaction should not leave a half-applied result.
- **Distributed transaction:** A business transaction that spans multiple services or databases. A Saga is one way to coordinate it without requiring one database transaction across all participants.
- **Saga:** A sequence of local transactions with coordination and, where needed, compensating actions.
- **Compensation:** A new operation intended to counteract a previously committed business action, such as issuing a refund.
- **Event:** An asynchronous message that records something that happened, such as `PaymentSuccess`.
- **Command:** A message asking a service to perform an action, such as `ReserveInventory`.
- **Orchestrator:** A component that coordinates Saga steps and tracks workflow state in the orchestration style.
- **Partial failure:** A condition where one step fails while another step has already committed.
- **Consistency:** Compliance with the system's data constraints and business rules. It does not always mean that every service observes the same state at the same instant.
- **Eventual consistency:** A model in which independently committed services converge toward a valid state over time.
- **Idempotency:** The property that repeating the same request does not create an additional business effect. For example, processing the same payment command twice should not charge the customer twice.

## Summary

The Saga pattern replaces one cross-service transaction with coordinated local transactions and explicit recovery. Event-driven Sagas distribute coordination through events; orchestration Sagas centralize workflow state in an orchestrator. Neither approach removes partial failure. The design must make retries, idempotency, timeouts, compensation, and terminal business states explicit.
