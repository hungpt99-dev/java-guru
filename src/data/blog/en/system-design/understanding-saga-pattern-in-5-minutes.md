---
title: "Understanding Saga Pattern in 5 Minutes"
description: "Explaining Saga Pattern: distributed transactions in microservices, Event-Driven vs Orchestration, compensation, and eventual consistency."
pubDatetime: 2025-09-02T11:59:00+07:00
featured: false
draft: false
tags:
  - saga-pattern
  - system-design
  - microservices
---

If you're new to microservices, you've probably heard of Saga Pattern — a design pattern for managing distributed transactions in microservices. It helps services coordinate smoothly, keep data synchronized, and maintain eventual consistency even when a service encounters issues. This article will help you understand Saga Pattern quickly, with intuitive examples and basic technical concepts.

## 1. Context and Problem

In traditional (monolithic) systems, you can use transactions to ensure data is always consistent:

If all steps succeed → commit
If any step fails → rollback

Example of ordering in a monolithic system:

1. Deduct customer's money
2. Deduct product inventory
3. Send confirmation email

Everything is within one transaction, so if any step fails → rollback everything, data remains consistent.

However, with microservices, each step is typically managed by a separate service with its own database:

- Payment Service: deduct money
- Inventory Service: deduct inventory
- Notification Service: send email

If one step fails, previous steps may have already committed, leading to inconsistent data.

Example: customer's money is deducted but the product is out of stock, or confirmation email hasn't been sent.

This is the problem Saga Pattern solves: helping services in microservices coordinate smoothly and maintain data consistency even when errors occur.

## 2. What is Saga Pattern?

Saga Pattern is a design pattern for managing distributed transactions in microservices.

Instead of using traditional transactions (rollback everything if one step fails), each service manages its own transaction, and if a subsequent step fails, the system performs compensation for previous steps.

Example of online ordering:

1. Payment Service: deduct money → success
2. Inventory Service: deduct inventory → error (out of stock)
3. Notification Service: send email → not yet executed

- Without Saga Pattern: Payment Service has deducted money → customer loses money but gets no product
- With Saga Pattern: Inventory Service error → Payment Service refunds, Email not sent → avoids confusion

Core idea: Each step takes responsibility and has a compensation mechanism, allowing operations in distributed transactions to coordinate without breaking the entire system.

## 3. Two Ways to Implement Saga Pattern

### 3.1 Event-Driven Saga

- Each step sends a message (event) when completed or failed
- The next step listens for events to decide whether to execute or compensate

Example:

- Payment Service deducts money → sends "PaymentSuccess" event
- Inventory Service listens for event → proceeds to deduct inventory
- If Inventory Service fails → sends "InventoryFailed" event
- Payment Service listens for event → performs refund

Advantages:

- No centralized orchestrator needed, services self-manage and coordinate flexibly
- Easy to extend when adding new services to the workflow

Disadvantages:

- Difficult to track overall transaction status
- Prone to duplicate events or delayed events, requiring idempotency mechanisms

### 3.2 Orchestration Saga

- A central orchestrator coordinates the steps
- When a step fails, the orchestrator commands rollback of previous steps

Example:

- Orchestrator commands Payment Service to deduct money → success
- Orchestrator commands Inventory Service to deduct inventory → failure
- Orchestrator commands Payment Service to refund
- Notification Service does not send email

Advantages:

- Easy to manage complex workflows, centralized state control
- Easy tracking and reduced risk of duplicate or missing events

Disadvantages:

- Orchestrator becomes a central point; if it fails or bottlenecks → affects the entire transaction
- Requires additional central component → increases implementation complexity

## 4. Illustrative Example: Online Ordering

Suppose the ordering process has 3 steps:

1. Payment Service: deduct customer's money → success
2. Inventory Service: deduct inventory → error (out of stock)
3. Notification Service: send email → not yet executed

Without Saga Pattern:

- Payment Service has deducted money → customer loses money but gets no product
- Inventory Service error → data is inconsistent

With Saga Pattern (Event-Driven or Orchestration):

- Inventory Service error → Payment Service refunds
- Email not sent → avoids confusion
- Consistent process, good customer experience

Saga Pattern allows each operation in a distributed transaction to be independent while still coordinating effectively, ensuring data consistency and good user experience.

## 5. Technical Terms

- Transaction: A sequence of data operations ensuring ACID (Atomicity, Consistency, Isolation, Durability).
  Example: Transferring money from account A to B in banking; if deducting A succeeds but crediting B fails → rollback.

- Distributed Transaction: A transaction occurring across multiple services or separate databases, requiring compensation or eventual consistency.
  Example: Online ordering: Payment Service deducts money, Inventory Service deducts stock, Notification Service sends email.

- Saga Pattern: A design pattern managing distributed transactions by performing compensation when a subsequent step fails.
  Example: Inventory Service reports out of stock → Payment Service refunds.

- Compensation: Undoing a committed step if another step fails.
  Example: Payment Service has deducted money but Inventory Service errors → Payment Service refunds.

- Event: An asynchronous message between services, reporting transaction status.
  Example: Payment Service sends "PaymentSuccess", Inventory Service listens and deducts stock.

- Orchestrator: The central component in Orchestration Saga, coordinating steps and rollback when needed.
  Example: Orchestrator sends command to deduct money → deduct stock → rollback if needed.

- Partial Failure: One step in a distributed transaction fails while others have committed.
  Example: Payment Service deducts money successfully but Inventory Service reports out of stock.

- Consistency: Data always satisfies constraints and business rules after a transaction.
  Example: After ordering, total deducted amount = total order value, inventory decreases by the correct quantity.

- Eventual Consistency: The system will become consistent over time, not necessarily immediately.
  Example: Payment Service commits first, Inventory Service commits later, eventually the overall state is correct.

- Idempotency: Performing an operation multiple times without causing data corruption, preventing duplicate events.
  Example: "PaymentSuccess" event sent twice → Payment Service only deducts money once.

- Orchestration Saga: Implementing Saga Pattern with a central orchestrator coordinating steps.
  Example: Orchestrator commands Payment → Inventory → Notification; rollback if Inventory fails.

- Event-Driven Saga: Implementing Saga Pattern where each service self-manages its transaction, publishes/listens to events, no central component needed.
  Example: Payment sends "PaymentSuccess" → Inventory deducts stock → Inventory sends "InventoryFailed" → Payment refunds.

## 6. Conclusion

Saga Pattern is a design pattern for managing distributed transactions in microservices, helping:

- Each service self-manages its own transaction and has compensation capability when errors occur
- Independent services coordinate smoothly to ensure the overall process operates stably
- Risk mitigation: data is synchronized, user experience is guaranteed, operational processes are continuous

Saga Pattern is an important design pattern that helps complex systems operate efficiently, reliably, and more manageably.
