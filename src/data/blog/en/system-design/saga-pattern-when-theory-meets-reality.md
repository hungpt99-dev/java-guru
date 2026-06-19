---
title: "Saga Pattern: When Theory Meets Reality"
description: "Real-world lessons from implementing Saga Pattern: partial failure, imperfect compensation, duplicate events, and the trade-off between Orchestration and Choreography."
pubDatetime: 2025-09-02T09:02:00+07:00
featured: true
draft: false
tags:
  - saga-pattern
  - system-design
  - microservices
---

You open your machine, open your IDE, ready to implement an ordering flow in microservices. In your head, you still picture what you've read about Saga Pattern:

"Oh, easy. Each service handles its own transaction, on error, rollback with compensate. Eventual consistency? No big deal, Saga handles it all."

Sounds great, sounds neat… but when coding for real, you realize things aren't that smooth.

You imagine the ideal flow in your head:

- Order Service creates order.
- Payment Service deducts money.
- Inventory Service reduces stock.
- Shipping Service creates shipment.

In the books, if any step fails → compensate → everything returns to the initial state, a perfect system. In your head, it's a smooth dance.

But reality… is a different dance. A network timeout, a duplicate event, or an imperfect compensation, and that dance quickly becomes… an operational nightmare.

## 1. Partial Failure – The First Shock

You imagine: Payment Service deducts money successfully, but Order Service hasn't received the event due to network timeout.

Result? Customer loses money, order not created. You try retrying, but things get worse: duplicate event → money deducted twice, stock reduced incorrectly, duplicate shipment.

Partial failure and duplicate events are not exceptions, they are the reality of microservices.

You realize: if partial failure is already complex, can rollback and compensation save the situation?

## 2. Compensation – When Rollback Is Never Perfect

Textbooks teach: rollback just needs to call the compensate function → everything returns to the initial state.

Reality:

- Email already sent → cannot undo.
- Shipment label already created → cannot reverse.
- Third-party booking → rollback nearly impossible.

Example: a service sends an SMS confirming payment. If the transaction fails, you can't "recall" the sent SMS. Compensation only makes up with another action, like sending a cancellation notice or creating credit.

Saga is not magic. Compensation is only approximately correct, sometimes requiring manual intervention.

But the story doesn't end here. If the state isn't synchronized, what will the customer see? This is when you need to think about Eventual Consistency.

## 3. Eventual Consistency – An Unavoidable Trade-Off

Data will eventually synchronize, but customers may see: "Processing", while money has been deducted, order not yet created.

You realize:

- UX must hide temporary states.
- The system needs monitoring, retry, reconciliation.
- Alerts must be clear.

Eventual consistency isn't free. It requires you to accept temporary risk. Otherwise, you'll receive a flood of support tickets from customers.

As you're calculating UX, a question flashes: should you manage the flow with a "central director" or let services handle it themselves? This is when Orchestration and Choreography appear.

## 4. Orchestration or Choreography – A Painful Choice

You have to choose:

| Criteria                | Orchestration                      | Choreography                                    |
| ----------------------- | ---------------------------------- | ----------------------------------------------- |
| Debug & Monitoring      | Easy to track Saga state           | Hard to debug, needs detailed logging           |
| Single Point of Failure | Has orchestrator                   | No SPoF, distributed                            |
| Duplicate Event         | Easy to control                    | Prone to occur, needs idempotency & retry queue |
| Flexibility             | Standard flow, less flexible       | Flexible when adding/removing services          |
| Deployment & Scaling    | Orchestrator needs special scaling | Easy to scale individual services               |

An example: you want to add a service that sends promotional vouchers after an order is completed.

- Orchestration: update orchestrator flow, easy to control.
- Choreography: add listener for event, but must ensure idempotency and retry queue, prone to errors if events are delayed or duplicated.

You realize: there's no perfect choice. Easy debugging or avoid SPoF? Accept temporary inconsistency or strict consistency? Saga is not just technique — it's continuous trade-offs.

And as you weigh options, a red warning appears: Saga can't always save the day, especially for systems requiring strong consistency.

## 5. Saga Is Not the Solution for Every Problem

Imagine: banking, transferring money between two accounts. You decide to use Saga: deduct from A, credit to B, log the transaction.

Initially you're confident: any step fails → compensate → everything's fine.

Then disaster strikes. Payment Service has deducted money, but Ledger Service hasn't received the event. Customer panics, support team is busy. Compensate? Can't save it. Only manual intervention remains.

At this point, you understand: Saga is not suitable for banking transactions. A safer solution: 2-Phase Commit (2PC).

- 2PC ensures strong consistency: synchronous commit, fail → immediate rollback.
- Avoids dangerous partial failure: customers don't see temporarily incorrect balances.
- Absolute integrity: critical transactions are always accurate.

Lesson: choose the wrong tool, and microservices can become an operational nightmare, even if you just wanted to "apply techniques for show."

## 6. Real-World Lessons When Applying Saga

After all the shocks from partial failure, approximate compensation, duplicate events, and model choices, you begin to draw "deep" lessons.

You remember the first time you deployed Saga: events were delayed, compensation was called in the wrong order, customers called support continuously. At that point, you understood:

- Uncontrolled retry = disaster. Idempotency is mandatory.
- Compensation doesn't save everything. It only reduces risk; sometimes you still need manual intervention.
- Customers see temporarily unsynchronized states? UX must be clever, alerts must be clear, reconciliation always ready.
- Implementation models have no perfect choice. Orchestration is easy to debug but has SPoF; Choreography is distributed but hard to trace. Choose the right flow, not based on emotion.
- Saga is not for every system. If the business requires strong consistency — e.g., banking — 2PC or synchronous transactions are still safer choices.

Looking back, you realize: Saga is not magic, but a refined tool. Applied correctly → reduces risk, flexible. Applied wrong → operational nightmare.

The most important thing: don't apply it because it's "cool", apply it because it truly fits your business.

## Conclusion

Saga Pattern is an excellent tool for complex distributed transactions, but not the solution for every problem.

Key points to remember:

- Understand trade-offs and edge cases.
- Prepare monitoring, alerts, retry, reconciliation, and even manual intervention.
- Choose between Orchestration and Choreography based on flow, debugging, SPoF.
- Evaluate system characteristics before implementing Saga, avoiding environments requiring strong consistency where 2PC or other synchronous transactions would be more appropriate.

After reading this, you'll ask yourself:

"Does this business really need Saga, or am I just creating complexity for myself?"

Understanding this clearly, you'll implement Saga safely, flexibly, and effectively, rather than being drawn into an entirely avoidable operational nightmare.
