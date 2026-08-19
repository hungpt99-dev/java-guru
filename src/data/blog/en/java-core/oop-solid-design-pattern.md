---
title: "OOP, SOLID, and Design Patterns in Real Java Code"
description: "A problem-first guide to using OOP, SOLID, and common design patterns in Java without adding abstraction that the code does not need."
pubDatetime: 2026-08-11T10:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - oop
  - solid
  - design-patterns
  - clean-code
---

## Introduction

A payment service often starts as a small application service: validate a
request, charge a provider, persist a receipt, and notify the customer. As
requirements accumulate, the same class may also handle refunds, retries,
provider-specific errors, audit events, and notifications.

The difficulty is not knowing that an interface or a design pattern exists.
The difficulty is deciding which change deserves a new boundary, which code
should remain together, and which abstraction would only add indirection.

This article uses payments, orders, notifications, and repositories to make
that judgment explicit. It introduces each idea through a design pressure,
shows a small refactoring, and states the trade-off. The examples are
illustrative; they are not claims about any particular company's system.

## A concrete design pressure

**[PROPOSED SCENARIO]** Assume a service has grown from a direct card-payment
flow into a service supporting several payment methods and providers:

```java
public class PaymentService {
    public void pay(Order order, PaymentRequest request) {
        validate(request);
        if (request.type() == PaymentType.CARD) {
            cardProvider.charge(request, order.total());
        } else if (request.type() == PaymentType.BANK_TRANSFER) {
            bankProvider.charge(request, order.total());
        } else {
            throw new UnsupportedPaymentType(request.type());
        }
        receiptRepository.save(order.id(), "PAID");
        notificationSender.sendPaymentConfirmation(order);
    }
}
```

The problem is not the line count by itself. The useful signals are:

| Signal | Likely design pressure |
| --- | --- |
| One class changes for payment rules, persistence, and notifications | Multiple responsibilities share a boundary |
| Adding a payment method requires editing the orchestration method | Variation is encoded in conditional logic |
| Provider details appear in application code | An external API is leaking through the domain boundary |
| Tests need a database, mail system, or provider SDK | Dependencies are constructed or hardwired too close to the use case |
| A retry can charge twice | The operation lacks a clear idempotency strategy |

**[ANALYSIS]** These are reasons to investigate a design change. They are not
proof that every class needs an interface or that every conditional is wrong.
Stable code with a small, local conditional can be easier to understand than
a hierarchy of speculative strategies.

## OOP as a set of boundaries

Object-oriented programming is useful here because it gives us boundaries for
state and behavior. The four concepts below are engineering questions, not
just vocabulary.

### Encapsulation: protect invariants

Encapsulation means that an object controls state changes that must obey a
rule. A `BankAccount` should not expose a mutable balance and ask every caller
to remember overdraft rules. A `Payment` can expose operations such as
`markCaptured()` or `markRefunded()` that enforce valid state transitions.

```java
public final class Payment {
    private PaymentStatus status = PaymentStatus.AUTHORIZED;

    public void markCaptured() {
        if (status != PaymentStatus.AUTHORIZED) {
            throw new IllegalStateException("Payment is not authorized");
        }
        status = PaymentStatus.CAPTURED;
    }

    public PaymentStatus status() {
        return status;
    }
}
```

**[ANALYSIS]** `private` fields and getters do not automatically provide
encapsulation. A class with public setters may hide representation while
leaving invariants unprotected. Prefer commands that express valid domain
operations. Do not force every piece of data into a rich object if it is
truly just data crossing a boundary.

### Abstraction: expose a stable capability

An abstraction should hide details that callers do not need and expose the
capability they do need. An application service can depend on a payment port:

```java
public interface PaymentProcessor {
    ChargeResult charge(PaymentRequest request, Money amount);
}
```

The provider adapter translates that port to a provider SDK. The application
code does not need to know the SDK's request objects or exception types.

**[ANALYSIS]** An abstraction is valuable when the hidden detail varies,
creates a testing boundary, or has a separate reason to change. An interface
with one implementation is not automatically wrong, but it should have a
clear boundary rather than exist only to satisfy a rule.

### Inheritance: reuse is not substitutability

Inheritance communicates an `is-a` relationship and creates a substitutability
expectation: code using the base type should continue to work with the subtype.
Using inheritance only to reuse a helper often produces a fragile base class.

If card and bank-transfer processors share request validation, prefer a small
collaborator or a composition-based helper unless they genuinely share a
stable contract. Composition lets each processor choose its dependencies and
policy without inheriting unrelated behavior.

### Polymorphism: move variation behind a contract

Polymorphism lets the caller use a stable contract while the selected object
provides the behavior. A registry can select a processor without putting
provider details in the orchestration code:

```java
public final class PaymentProcessors {
    private final Map<PaymentType, PaymentProcessor> processors;

    public PaymentProcessors(Map<PaymentType, PaymentProcessor> processors) {
        this.processors = Map.copyOf(processors);
    }

    public PaymentProcessor forType(PaymentType type) {
        var processor = processors.get(type);
        if (processor == null) {
            throw new UnsupportedPaymentType(type);
        }
        return processor;
    }
}
```

**[ANALYSIS]** This is useful when payment types change independently or have
meaningfully different behavior. For a fixed, tiny set of cases, a `switch`
may remain the clearer choice.

## SOLID as decision criteria

SOLID is most useful as a vocabulary for design pressure. It is not a
requirement to maximize the number of classes.

### Single Responsibility Principle

**[SOURCE FACT]** The principle is commonly stated as a class having one
reason to change. The practical interpretation is to group behavior around a
coherent responsibility and stakeholder.

**[ANALYSIS]** `PaymentService` may be responsible for coordinating a payment
use case, while provider communication, receipt persistence, and notification
delivery have separate reasons to change. Extract them when the coupling is
causing real changes or making tests difficult, not merely because a method is
long.

### Open/Closed Principle

**[SOURCE FACT]** The principle says software entities should be open for
extension and closed for modification.

**[ANALYSIS]** This does not mean that existing files can never change. It
means that a known variation point can be extended through a stable contract.
`PaymentProcessor` and a provider adapter are a reasonable boundary if new
processors are expected. Adding a contract before variation exists is often
speculation.

### Liskov Substitution Principle

**[SOURCE FACT]** Subtypes should be usable wherever their base type is
expected without breaking the base type's behavioral contract.

**[ANALYSIS]** If a `PaymentProcessor` promises `charge` but one subtype
silently ignores the amount, rejects valid inputs, or changes failure
semantics, the contract is wrong or the subtype does not belong behind it.
Return types and exceptions are part of the contract, not implementation
details.

### Interface Segregation Principle

Clients should not depend on methods they do not use. A large provider
interface that combines charging, refunding, token management, and settlement
forces every adapter and test to implement irrelevant operations.

```java
public interface PaymentCharger {
    ChargeResult charge(PaymentRequest request, Money amount);
}

public interface PaymentRefunder {
    RefundResult refund(Payment payment, Money amount);
}
```

**[ANALYSIS]** Split interfaces around client needs and coherent capabilities.
Do not split every method into its own interface without a consumer that
benefits from the separation.

### Dependency Inversion Principle

High-level policy should not depend directly on low-level details; both should
depend on an abstraction. The application service can receive a
`PaymentProcessor`, `ReceiptRepository`, and `NotificationSender` through
constructor injection. A composition root wires concrete adapters.

```java
public final class PaymentService {
    private final PaymentProcessors processors;
    private final ReceiptRepository receipts;
    private final NotificationSender notifications;

    public PaymentService(PaymentProcessors processors,
                          ReceiptRepository receipts,
                          NotificationSender notifications) {
        this.processors = processors;
        this.receipts = receipts;
        this.notifications = notifications;
    }
}
```

**[ANALYSIS]** Dependency injection is a means of controlling coupling and
test setup. A service locator or a global mutable registry may hide the same
dependencies and make behavior harder to reason about.

## Patterns that solve specific problems

Patterns are names for recurring structures. Use one when its forces are
present, not as a catalog to apply mechanically.

### Strategy for replaceable policies

The Strategy pattern puts a family of interchangeable algorithms behind a
contract. `PaymentProcessor` is a strategy when the payment flow selects one
processor per request. It is a good fit when implementations vary in policy,
dependencies, or failure handling.

### Adapter for external APIs

The Adapter pattern translates one interface into another. A provider adapter
maps the internal `PaymentProcessor` contract to an SDK and translates SDK
errors into application-level failures. Keep provider-specific types at the
edge where possible.

### Decorator for orthogonal behavior

The Decorator pattern wraps an object with behavior such as metrics, logging,
or retry. It can keep cross-cutting concerns out of payment rules:

```java
PaymentProcessor processor = new RetryingPaymentProcessor(
    new AuditingPaymentProcessor(provider, auditLog), retryPolicy);
```

**[ANALYSIS]** Retry is not universally safe. A retry requires an explicit
timeout policy, classification of retryable failures, and idempotency. For a
charge operation, an idempotency key or provider-supported deduplication may
be required to avoid a second charge. If those guarantees are absent, a
fallback or reconciliation flow may be safer than blind retry.

### Factory for construction decisions

Use a Factory when construction has meaningful selection or setup logic. If
constructors are simple and dependency injection already owns composition, a
factory may add no value.

### Repository for persistence boundaries

A Repository can expose persistence operations in domain terms and keep SQL,
transactions, and row-lock details in an infrastructure adapter. It should
not become a generic object store that mirrors every database operation.

## Refactoring the payment flow

**[PROPOSED DESIGN]** Keep the application service as an orchestrator and
move variable or infrastructure-specific behavior behind collaborators:

```java
public final class PaymentService {
    public PaymentReceipt pay(Order order, PaymentRequest request) {
        var processor = processors.forType(request.type());
        var result = processor.charge(request, order.total());
        var receipt = receipts.save(order.id(), result);
        notifications.sendPaymentConfirmation(order, receipt);
        return receipt;
    }
}
```

This design does not eliminate complexity. It gives each dependency a clearer
boundary. The service still needs explicit decisions about transaction
scope, timeout, retry, failure mapping, notification timing, and idempotency.
Those decisions belong in the use case and its policies, not in accidental
provider branches.

## When not to refactor

Keep a straightforward implementation when the behavior is stable, the
conditional is local, and the test is easy to write. Avoid introducing an
interface solely for mocking a value object or a class that has no meaningful
alternate implementation. Avoid inheritance for convenience. Avoid a
pattern when the pattern's vocabulary is harder to understand than the code
it replaces.

Refactor when you can name the pressure: independent change, duplicated
policy, hardwired infrastructure, invalid state transitions, or a boundary
that makes failure behavior unclear. Make one structural change at a time and
use tests to preserve behavior.

## Closing perspective

OOP, SOLID, and design patterns do not provide a target class count or a
universal architecture. They help answer practical questions: which state
must be protected, which detail varies, which dependency should be inverted,
and which behavior must remain consistent across implementations.

The senior-engineering move is not to apply more patterns. It is to identify
the coupling that is making the next change expensive, introduce the smallest
boundary that addresses it, and leave the rest of the code alone.
