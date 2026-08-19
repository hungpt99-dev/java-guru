---
title: "Saga Pattern: Failure Modes, Trade-offs, and Design Choices"
description: "A practical review of Saga transactions: partial failure, compensation, duplicate events, eventual consistency, and the trade-offs between orchestration and choreography."
pubDatetime: 2025-09-02T09:02:00+07:00
featured: true
draft: false
tags:
  - saga-pattern
  - system-design
  - microservices
---

The Saga pattern is often introduced as a simple answer to distributed transactions: each service commits its local transaction, and a later failure triggers compensating actions. That description is useful, but incomplete. A Saga does not provide a distributed rollback. It coordinates a sequence of local commits and defines how the system should recover when the sequence cannot complete.

Consider an order flow:

- Order Service creates the order.
- Payment Service charges the customer.
- Inventory Service reserves or reduces stock.
- Shipping Service creates a shipment.

The difficult cases are not the successful path. They are timeouts, duplicate delivery, services that recover at different times, and side effects that cannot be undone. This article covers those failure modes, the limits of compensation, eventual consistency, orchestration versus choreography, and when a Saga is the wrong tool.

## 1. Partial Failure Is the Normal Failure Mode

**[SOURCE FACT]** A distributed workflow can complete a local transaction in one service while another service does not observe the resulting event. For example, Payment Service may charge the customer, while Order Service does not receive the corresponding message because of a network timeout.

The system now has an ambiguous state. The charge may have succeeded even though the caller received a timeout. Retrying without a clear identity for the operation can charge the customer again. The same class of problem can produce duplicate stock changes or duplicate shipments.

**[ANALYSIS]** A timeout does not tell the caller whether the operation failed. It only says that the result was not confirmed within the timeout window. The workflow therefore needs a way to distinguish a new operation from a retry of an operation that may already have succeeded.

**[PROPOSED DESIGN]** Give each business operation a stable idempotency key (a key used to recognize repeated requests). Each consumer should record the key and the result it applied, then return the recorded result when the same operation is delivered again. Retry policies should also have explicit limits and a path to a retry queue or manual review. Idempotency is not optional when messages or requests can be retried.

## 2. Compensation Is Not Rollback

**[SOURCE FACT]** A database rollback can undo work inside one local transaction. It cannot reliably undo an external side effect that has already happened.

Examples include:

- An SMS or email has already been sent.
- A shipping label has already been created.
- A third-party booking has already been accepted.

The corresponding compensating action may be a cancellation message, a refund, a credit, or a request to cancel the external booking. These actions change the business state; they do not restore the world to its exact previous state.

**[ANALYSIS]** Compensation is therefore an application-level recovery action. It can be incomplete, delayed, rejected by a dependency, or require a human decision. A Saga should model these outcomes explicitly instead of treating compensation as an automatic guarantee of correctness.

**[PROPOSED DESIGN]** Define a compensation policy for every step that has an externally visible side effect. Record the Saga state and each step's outcome. Make compensation retryable and idempotent where possible, and expose unresolved cases to operations. For example, a payment confirmation that cannot be withdrawn may require a cancellation notice or a credit rather than an attempt to recall the original message.

## 3. Eventual Consistency Has a Product Cost

**[SOURCE FACT]** In a Saga, services commit independently. Their views of the workflow can therefore be temporarily different. A customer may see `Processing` after the payment has been accepted but before the order has been created or the next event has been handled.

**[ANALYSIS]** Eventual consistency is not just a storage property. It affects user experience, customer support, and operations. A status page that implies `Completed` before all required steps finish is misleading. A status of `Processing` without a recovery path is also insufficient.

**[PROPOSED DESIGN]** Treat intermediate states as part of the product contract. Show an honest status, define what happens when a step is delayed, and provide a clear outcome when the Saga ends in failure or requires review. Monitor event age, failed steps, compensation attempts, and unresolved Sagas. Reconciliation should compare the state held by participating services and identify cases that need correction.

## 4. Orchestration and Choreography

Orchestration uses a coordinator to issue commands and track the workflow. Choreography lets services react to events and determine their own next action. Neither model removes the underlying failure modes.

| Criterion | Orchestration | Choreography |
| --- | --- | --- |
| Debugging and monitoring | Central Saga state is easier to inspect | Requires consistent correlation and event logging across services |
| Failure concentration | The orchestrator is an additional dependency that must be made highly available | No central coordinator, but responsibility is spread across services |
| Duplicate events | A coordinator can centralize retries and state transitions | Each consumer must implement idempotency and failure handling |
| Change management | The workflow is explicit, but the coordinator changes as the flow changes | Services can add event consumers, but event contracts and interactions become harder to reason about |
| Scaling | The coordinator needs its own capacity and availability planning | Individual consumers can scale independently |

**[ANALYSIS]** Calling choreography "free of a single point of failure" is too broad. It removes one central coordinator, not the need for reliable brokers, consumers, observability, or recovery procedures. Likewise, orchestration does not automatically make a workflow correct; it only makes the control flow more explicit.

Suppose the business adds a service that issues a promotional voucher after an order is completed. In an orchestrated design, the coordinator is updated to include the new step or branch. In a choreographed design, the voucher service consumes the order-completed event. The second option may reduce changes to existing services, but the consumer still needs idempotency, a retry policy, and a defined behavior for delayed or duplicate events.

**[PROPOSED DESIGN]** Choose the model based on ownership, workflow complexity, observability, and failure handling. Whichever model is selected, propagate a correlation identifier, make state transitions inspectable, and document event contracts and retry behavior.

## 5. When a Saga Is the Wrong Tool

**[SOURCE FACT]** Some business operations require a strong consistency boundary. A transfer between two accounts is a common example: debiting one account and crediting another must not leave balances in an ambiguous state.

**[ANALYSIS]** A Saga can define a compensating credit after a debit, but the interval between those actions is a real business risk. If the credit event is lost, delayed, or rejected, the system needs detection and recovery. That may be acceptable for some workflows, but it is a poor default for an operation whose invariant requires an atomic decision.

Two-Phase Commit (2PC) is one possible alternative when the participating resources support it and its coordination and availability costs are acceptable. It coordinates prepare and commit phases so participants agree on a transaction outcome. It is not a universal solution: it introduces its own operational and performance trade-offs, and not every service or external dependency can participate.

**[PROPOSED DESIGN]** Start with the business invariant, not the pattern. If temporary inconsistency and compensation are acceptable, a Saga may fit. If the operation requires an atomic boundary, prefer a design that provides that boundary, such as a local transaction, synchronous coordination, or 2PC where appropriate. Do not introduce a Saga merely because the system uses microservices.

## 6. Operational Requirements

The pattern is only as reliable as its failure handling. Before adopting it, make the following decisions explicit:

- Define an idempotency key and deduplication behavior for every retryable command and event.
- Specify timeout, retry, and backoff behavior. An uncontrolled retry loop can amplify an outage.
- Persist Saga state and step outcomes so operators can inspect what happened.
- Define compensation for each step, including steps that cannot be reversed.
- Route exhausted retries and unresolved compensation to a controlled recovery process.
- Expose intermediate status to users without implying that the workflow has completed.
- Implement monitoring and reconciliation for delayed, failed, and divergent state.

These are design requirements, not implementation details to add after the first incident. A workflow that only describes the happy path is not a complete Saga design.

## Conclusion

Saga is a coordination pattern for workflows that span independent local transactions. It manages partial failure by combining forward actions with compensating actions, but it does not provide a perfect rollback or eliminate inconsistency.

Use it when the business can tolerate intermediate states and has a credible recovery model. Make retries idempotent, make state observable, design compensation as an explicit business action, and keep reconciliation available. Use orchestration when explicit central control helps, or choreography when independently reacting services are a better fit, while accepting the observability and coordination costs of either choice.

For operations that require an atomic consistency boundary, choose a mechanism designed for that requirement instead. The useful question is not whether Saga is fashionable. It is whether its failure model matches the business invariant.
