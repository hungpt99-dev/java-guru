---
title: "Saga Pattern: When Theory Collides With Reality"
description: "You open your machine, open the IDE, ready to implement the order flow in microservices. In your head, you're still picturing what you read about the Saga Pattern:"
slug: "saga-pattern-khi-ly-thuyet-va-cham-thuc-te"
locale: "en"
translationKey: "saga-pattern-khi-ly-thuyet-va-cham-thuc-te"
pubDate: 2025-09-02T16:02:12+07:00
category: "Microservices"
tags: ["saga pattern", "microservice", "System Design"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 6
---

You open your machine, open the IDE, ready to implement the order flow in microservices. In your head, you're still picturing what you read about the **Saga Pattern**:

> “Oh, easy. Each service handles its own transaction, and on failure you roll back with compensate. Eventual consistency? No big deal, Saga takes care of everything.”
> 

Sounds good, sounds tidy… but when you actually code it, you realize nothing is smooth at all.

You imagine the ideal flow in your head:

1. **Order Service** creates the order.
2. **Payment Service** deducts the money.
3. **Inventory Service** reduces the stock.
4. **Shipping Service** creates the shipment.

In the book, if any step fails → compensate → everything returns to its initial state, and the system is perfect. In your head, that's **a smooth dance**.

But reality… is **a completely different dance**. One network timeout, one duplicate event, or one imperfect compensate, and that dance quickly turns into… **an operational nightmare**.

![image.png](/images/articles/saga-pattern-khi-ly-thuyet-va-cham-thuc-te/figure-1.png)

---

## 1. Partial Failure – The First Shock

You imagine: **Payment Service deducts the money successfully**, but **Order Service hasn't received the event** because of a network timeout.

The result? **The customer loses money, the order is never created.** You try to retry, but everything gets worse: duplicate event → the money is deducted twice, stock is reduced by mistake, double shipment.

Partial failure and duplicate events **aren't exceptions**, they're the reality of microservices.

You realize: if partial failure is already this complicated, can **rollback and compensate** really save the situation?

---

## 2. Compensate – When Rollback Is Never Perfect

The books teach: rollback just needs to call a compensate function → everything returns to its initial state.

Reality:

- **Email already sent** → can't be undone.
- **Shipment label already created** → can't be reverted.
- **Third-party booking** → rollback is nearly impossible.

For example, a service sends an SMS confirming payment. If the transaction fails, you can't “recall” an SMS that has already been sent. Compensate only **makes up for it with another action**, like sending a cancellation notice or creating a credit.

Saga **is not magic**. Compensate is only **approximately right**, and sometimes it has to rely on **manual intervention**.

But the story doesn't stop here. If the state isn't in sync, what will the customer see? This is when you have to think about **Eventual Consistency**.

---

## 3. Eventual Consistency – The Unavoidable Trade-Off

The data will eventually be in sync, but the customer may see: “Processing”, while **the money has been deducted and the order isn't created**.

You realize:

- UX has to hide the temporary state.
- The system needs monitoring, retry, reconcile.
- Alerts have to be clear.

Eventual consistency **isn't free**. It requires you to accept **temporary risk**. If you don't, you'll get **a flood of support tickets** from customers.

While you're working out the UX, a question flashes up: **should the flow be managed by a “central director” or left for the services to handle themselves?** This is exactly where **Orchestration and Choreography** come in.

---

## 4. Orchestration or Choreography – The Headache of a Choice

You have to choose:

| Criterion | Orchestration | Choreography |
| --- | --- | --- |
| Debug & Monitoring | Easy to track Saga state | Hard to debug, needs detailed logging |
| Single Point of Failure | There is an orchestrator | No SPoF, decentralized |
| Duplicate Event | Easy to control | Easy to happen, needs idempotency & retry queue |
| Flexibility | Standard flow, less flexible | Flexible when adding/removing services |
| Deployment & Scaling | Orchestrator needs special scaling | Easy to scale each service |

One example: you want to add a service that sends a promotional voucher after the order is completed.

- Orchestration: update the orchestrator flow, easy to control.
- Choreography: add a listener for the event, but you have to guarantee idempotency and a retry queue, and it breaks easily if events arrive late or are duplicated.

You realize: **there's no perfect choice**. Easy debugging or avoiding SPoF? Accept temporary inconsistency or strict consistency? Saga isn't just technique – it's **a continuous trade-off**.

And as you weigh it up, a red warning appears: **Saga can't always save the day**, especially for systems that require **strong consistency**.

---

## 5. Saga Isn't a Solution for Every Problem

Picture this: **a bank**, transferring money between two accounts. You decide to use Saga: deduct from A, add to B, write the transaction log.

At first you're confident: whichever step fails → compensate → everything's fine.

Then disaster strikes. Payment Service has deducted the money, but Ledger Service hasn't received the event. The customer panics, the support team is busy. Compensate? It can't save you. All that's left is **manual intervention**.

Only then do you understand: **Saga isn't suited to banking transactions**. A safer solution: **2-Phase Commit (2PC)**.

- **2PC guarantees strong consistency**: synchronous commit, fail → immediate rollback.
- **Avoids dangerous partial failure**: customers don't see temporarily incorrect balances.
- **Absolute integrity**: important transactions are always accurate.

The lesson: choose the wrong tool and microservices can turn into **an operational nightmare**, even when all you wanted was to “apply the technique for looks”.

---

## 6. Practical Lessons When Applying Saga

After all the shocks from **partial failure, approximate compensate, duplicate events** and the choice of model, you start drawing out “hard-won” lessons.

You remember the first time you deployed Saga: events arrived late, compensate was called in the wrong order, customers kept calling support. Only then did you understand:

- Uncontrolled retry = disaster. Idempotency is mandatory.
- Compensate doesn't save everything. It only reduces risk, and sometimes you still need manual intervention.
- Customers see a temporary state that isn't in sync? UX has to be careful, alerts have to be clear, reconcile always ready.
- There's no perfect choice of deployment model. Orchestration is easier to debug but has a SPoF; Choreography is decentralized but hard to trace. Choose the flow that fits, not the one you feel inspired by.
- Saga isn't for every system. If the business demands strong consistency – banking, for example – 2PC or synchronous transactions are still the safer choice.

Looking back, you realize: Saga isn't magic, it's **a delicate tool**. Apply it in the right place → less risk, more flexibility. Apply it in the wrong place → operational nightmare.

Most importantly: **don't apply it because it's “cool”, apply it because it genuinely fits your business**.

---

## Conclusion

Saga Pattern is **a great tool** for **complex distributed transactions**, but **not a solution for every problem**.

Points to remember:

- Understand the **trade-offs and edge cases**.
- Prepare **monitoring, alerting, retry, reconcile**, and also **manual intervention**.
- Choose between **Orchestration and Choreography** based on flow, debugging and SPoF.
- Evaluate **the specifics of your system before implementing Saga**, and avoid environments that require strong consistency, where **2PC or another synchronous transaction** will be more suitable.

After reading, you'll ask yourself:

> “Does this business really need Saga, or am I just adding more complexity for myself?”
> 

Once you understand this clearly, you'll implement Saga **safely, flexibly and effectively**, instead of being dragged into **an operational nightmare that was entirely avoidable**.
