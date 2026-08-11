---
title: "Senior Java Interview: OOP and Design Principles"
description: "OOP at the senior level is about applied SOLID, composition over inheritance, and interface design at scale — not reciting definitions."
pubDatetime: 2026-08-12T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

Object-oriented programming is the entry ticket. At senior level, interviewers want to see it **applied under constraints**, not defined from memory.

## 1. SOLID without reciting definitions

The two most-probed:

- **Open/Closed.** Add features via new types, not by editing working classes. Strategy / Plugin patterns.
- **Dependency Inversion.** Depend on abstractions — this is _why_ Spring exists. You inject `PaymentGateway`, never `StripeGateway`.

```java
// Violates DIP: concrete dependency baked in
class OrderService {
    private final StripeGateway gateway = new StripeGateway();
}

// Senior: depends on abstraction, injected
class OrderService {
    private final PaymentGateway gateway;
    OrderService(PaymentGateway gateway) { this.gateway = gateway; }
}
```

Also be ready on Single Responsibility (one reason to change), Liskov (subtypes usable as base types without surprises), and Interface Segregation.

## 2. Composition over inheritance

Expect "why favor composition over inheritance?" Inheritance couples you to a parent's implementation and breaks encapsulation — the fragile base class problem. Delegate behavior instead of extending.

## 3. Polymorphism & interfaces at scale

Interface segregation matters when the codebase is large: a 40-method `UserService` interface that forces every implementer to stub 35 methods is a design smell. Split by role.

## 4. The functional-Java trap

Don't say "OOP is outdated because of functional Java." A senior says: both. Streams for data transforms, OOP for behavior-rich domain objects. Records (Java 16+) are great for immutable DTOs, but a `Record` carrying business logic is a code smell — put behavior in services or rich domain types.

## 5. Self-check

- [ ] Apply OCP to a feature request without editing the old class.
- [ ] Explain DIP with a concrete Spring example.
- [ ] Give a real case where inheritance bit you (fragile base class).
- [ ] When to use a Record vs a class with behavior.

That's the OOP bar for senior.
