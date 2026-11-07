---
title: "Understanding Saga Pattern in 5 Minutes"
description: "If you are just getting into microservices, you have probably heard of Saga Pattern – a design pattern for managing distributed transactions in microservices."
slug: "hieu-saga-pattern-trong-5-phut"
locale: "en"
translationKey: "hieu-saga-pattern-trong-5-phut"
pubDate: 2025-09-02T18:59:56+07:00
category: "Microservices"
tags: ["saga pattern", "System Design"]
featured: true
draft: false
series: null
coverImage: "./cover.png"
readingTime: 6
---

If you are just getting into **microservices**, you have probably heard of **Saga Pattern** – a **design pattern for managing distributed transactions in microservices**. It helps services coordinate smoothly, keep data in sync and maintain **eventual consistency** even when one service fails. This article will help you **understand Saga Pattern quickly**, with an intuitive example and the basic technical concepts.

---

## **1. Context and the problem**

In **traditional (monolithic)** systems, you can use a **transaction** to guarantee that data is always consistent:

* If every step succeeds → **commit**
* If any step fails → **rollback**

**Example of placing an order in a monolithic system:**

1. Debit the customer
2. Deduct the product stock
3. Send a confirmation email

All of it sits inside **a single transaction**, so if any step fails → everything rolls back and the data stays **consistent**.

With **microservices**, however, each step is usually owned by a **separate service**, with its **own database**:

* **Payment Service:** debit the money
* **Inventory Service:** deduct the stock
* **Notification Service:** send the email

If one step fails, the earlier steps may already have **committed**, which leaves the **data inconsistent**.

For example: the customer is charged but **the item is out of stock**, or the confirmation email never goes out.

This is **the problem Saga Pattern solves**: it helps the services in a microservices system **coordinate smoothly** and **keep data in sync even when errors occur**.

---

## **2. What is Saga Pattern?**

**Saga Pattern** is **a design pattern for managing distributed transactions in microservices**.

Instead of a **traditional transaction** (roll everything back if one step fails), **each service manages its own transaction**, and if a later step fails, the system performs **compensation** for the earlier steps.

**Example: an online order:**

1. **Payment Service:** debit the money → success
2. **Inventory Service:** deduct the stock → failure (out of stock)
3. **Notification Service:** send the email → not executed

* **Without Saga Pattern:** Payment Service has already charged the customer → the customer loses money and gets no goods
* **With Saga Pattern:** Inventory Service fails → Payment Service **refunds**, the email is not sent → no confusion

> Core idea: each step is **responsible for itself** and has a **compensation** mechanism, so the operations inside a **distributed transaction** coordinate without breaking the whole system.

---

## **3. Two ways to implement Saga Pattern**

### **3.1 Event-Driven Saga**

* Each step **publishes a message (event)** when it completes or fails
* The next step **listens for the event** to decide whether to proceed or compensate

**Example:**

1. Payment Service debits the money → publishes the event "PaymentSuccess"
2. Inventory Service hears the event → deducts the stock
3. If Inventory Service fails → publishes the event "InventoryFailed"
4. Payment Service hears the event → performs the **refund**

**Pros:**

* No central orchestrator needed; services **manage themselves and coordinate flexibly**
* Easy to extend when a new service is added to the flow

**Cons:**

* Hard to track the overall state of the transaction
* Prone to **duplicate events** or **delayed events**, which requires an **idempotency** mechanism

---

### **3.2 Orchestration Saga (centralized coordination)**

* A central **orchestrator coordinates the steps**
* When a step fails, the orchestrator commands a **rollback of the previous steps**

**Example:**

1. The orchestrator commands Payment Service to debit the money → success
2. The orchestrator commands Inventory Service to deduct the stock → failure
3. The orchestrator commands Payment Service to **refund**
4. Notification Service does not send the email

**Pros:**

* Easier to manage complex flows, with state controlled centrally
* Easy to trace and reduces the risk of **duplicate or missing events**

**Cons:**

* The orchestrator becomes a **single central point**; if it fails or gets congested → the whole transaction is affected
* Requires an extra central component → more deployment complexity

---

## **4. Worked example: an online order**

Assume the order flow has 3 steps:

1. **Payment Service:** debit the customer → success
2. **Inventory Service:** deduct the stock → failure (out of stock)
3. **Notification Service:** send the email → not executed

**Without Saga Pattern:**

* Payment Service has already charged the customer → the customer loses money and gets no goods
* Inventory Service fails → data is not in sync

**With Saga Pattern (Event-Driven or Orchestration):**

* Inventory Service fails → Payment Service **refunds**
* The email is not sent → no confusion
* The flow is **consistent**, the customer experience is good

> Saga Pattern makes **each operation in a distributed transaction independent** while still coordinating effectively, ensuring **the data is in sync and the user experience is good**.

---

## **5. Technical terms**

1. **Transaction:** A sequence of operations on data that guarantees **ACID** (Atomicity, Consistency, Isolation, Durability).
   *Example:* Transferring money from account A to B at a bank; if debiting A succeeds but crediting B fails → rollback.

2. **Distributed Transaction:** A transaction that spans multiple services or separate databases and requires **compensation or eventual consistency**.
   *Example:* Online order: Payment Service debits the money, Inventory Service deducts the stock, Notification Service sends the email.

3. **Saga Pattern:** A design pattern that manages a **distributed transaction** by performing **compensation** when the next step fails.
   *Example:* Inventory Service reports out of stock → Payment Service refunds.

4. **Compensation:** Undoing a step that has already committed when another step fails.
   *Example:* Payment Service already charged the customer but Inventory Service fails → Payment Service refunds.

5. **Event:** An asynchronous message between services that reports the state of a transaction.
   *Example:* Payment Service publishes "PaymentSuccess", Inventory Service listens and deducts the stock.

6. **Orchestrator:** The central component in an **Orchestration Saga** that coordinates the steps and rolls back when needed.
   *Example:* The orchestrator sends the command to debit the money → deduct the stock → roll back if needed.

7. **Partial Failure:** One step in a distributed transaction fails while the other steps have already committed.
   *Example:* Payment Service successfully charges the customer but Inventory Service reports out of stock.

8. **Consistency:** Data always satisfies the constraints and business rules after a transaction.
   *Example:* After an order is placed, the total amount charged equals the order total, and the stock decreases by exactly the right quantity.

9. **Eventual Consistency:** The system becomes consistent over time, without needing to be consistent immediately.
   *Example:* Payment Service commits first, Inventory Service commits later, and in the end the overall state is correct.

10. **Idempotency:** Performing an operation multiple times **without corrupting the data**, avoiding duplicate events.
    *Example:* The "PaymentSuccess" event is sent twice → Payment Service only charges once.

11. **Orchestration Saga:** An implementation of Saga Pattern with a **central orchestrator** coordinating the steps.
    *Example:* The orchestrator commands Payment → Inventory → Notification; rolls back if Inventory fails.

12. **Event-Driven Saga:** An implementation of Saga Pattern where **each service manages its own transaction**, publishing and listening for events, with no central component.
    *Example:* Payment publishes "PaymentSuccess" → Inventory deducts the stock → Inventory publishes "InventoryFailed" → Payment refunds.

---

## **6. Conclusion**

Saga Pattern is **a design pattern for managing distributed transactions in microservices** that helps:

* Each service **manage its own transaction** and be able to **compensate** when an error occurs
* Services stay **independent yet coordinate smoothly** so that **the overall flow runs reliably**

* Limit the risks: **data stays in sync**, **the user experience is protected**, **the process keeps running**

Saga Pattern is an **important design pattern** that helps complex systems run **more efficiently, more reliably and more manageably**.
