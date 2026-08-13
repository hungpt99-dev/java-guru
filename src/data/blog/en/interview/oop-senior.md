---
title: "Java Interview Prep #2: OOP & Design Principles — Junior to Senior"
description: "OOP at the senior level is applied SOLID, composition over inheritance, and interface design at scale — not reciting definitions. Junior names the principles; senior shows where each one costs you."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

OOP is the part of the interview where interviewers stop asking "what" and start asking "why". Anyone can name the four pillars; a senior can tell you the last time inheritance bit them and why they refactored to composition. This post climbs from the textbook to the trade-off table.

> Mindset: junior implements the interface; senior decides whether the interface should exist at all, and what it costs the next five years of the codebase.

## Junior — foundations

**Q1. What are the four pillars of OOP?**
Encapsulation (hide state behind behavior), Abstraction (expose intent, not mechanism), Inheritance (reuse by specialization), Polymorphism (one interface, many implementations). The trap: naming them is free; applying them without creating a brittle hierarchy is the actual skill.

**Q2. What is the difference between an abstract class and an interface?**
An abstract class can hold state and implement methods; a class extends only one. An interface is a contract — pre-Java 8 only method signatures, now it can carry `default` and `static` methods but no fields (except `public static final` constants). Since Java 8 you can `implement` many interfaces but extend one class. Prefer interfaces for the _type_ and abstract classes only when you need shared state/behavior.

**Q3. What is polymorphism and how does it work in Java?**
Subtype polymorphism: a variable of a supertype refers to any subtype, and the runtime dispatches the overridden method. Method dispatch is virtual by default — `Animal a = new Dog(); a.speak()` calls `Dog.speak()`. Overloading is _not_ polymorphism (it is resolved at compile time by signature).

**Q4. What is the difference between method overriding and overloading?**
Overriding: same signature in a subclass, runtime-dispatched (`@Override`). Overloading: same name, different parameter types, resolved at compile time. A classic pitfall: overloaded methods with `Object` vs `String` args — `foo(null)` is ambiguous and fails to compile if both exist.

**Q5. What does `equals`/`hashCode` contract require?**
If `a.equals(b)` then `a.hashCode() == b.hashCode()`. The converse is not required but equal hashCodes should be rare (good distribution). If you override `equals` you MUST override `hashCode`, or objects break in `HashMap`/`HashSet` (two equal keys land in different buckets).

**Q6. What is the difference between `abstract` and `interface` default methods?**
An abstract class method has a body the subclass may or may not override. An interface `default` method provides behavior a class inherits without implementing — used for backward-compatible API evolution (e.g. `Collection.removeIf`). Override a `default` in the implementing class to change it.

## Mid — tradeoffs & pitfalls

**Q1. When is inheritance the wrong tool?**
When the relationship is not a true "is-a" with stable shared behavior. Inheritance couples the subclass to the parent's implementation forever — change the superclass and every subclass breaks. The "fragile base class" problem: a seemingly safe change to a superclass silently alters subclass behavior. Reach for **composition** (wrap the dependency, delegate) when the shared code is "has-a" rather than "is-a".

**Q2. Explain SOLID, briefly, and give one real misuse of each.**

- **S**ingle Responsibility: a class changes for one reason. Misuse: a `UserService` that also sends email and writes audit logs — three reasons to change.
- **O**pen/Closed: open for extension, closed for modification. Misuse: a `switch(type)` that you edit every time a new type appears.
- **L**iskov: subtypes must be substitutable. Misuse: `Square extends Rectangle` then `setWidth` breaks the rectangle invariant.
- **I**nterface Segregation: many small interfaces beat one fat one. Misuse: a `Worker` interface forcing `cleanToilet()` on a `Programmer`.
- **D**ependency Inversion: depend on abstractions, not concretions. Misuse: `new MySQLRepository()` hardcoded in a service.

**Q3. What is the difference between `Comparator` and `Comparable`?**
`Comparable` defines the _natural_ ordering of a type (`compareTo`, one definition). `Comparator` is an _external_ ordering strategy (pass to `sort`, many can exist). Use `Comparable` for the obvious default; `Comparator` when the sort depends on context (by name, by date, descending).

**Q4. Why are getters/setters not real encapsulation?**
A public getter/setter pair with no invariant is just a public field with extra steps — state is still wide open. Real encapsulation exposes _behavior_: `account.withdraw(amount)` instead of `account.setBalance(x)`. The object protects its invariants; callers ask for outcomes, not mutate fields directly. Anemic domain models (entities with only getters/setters) are a code smell.

**Q5. What is the difference between `==` on objects and identity vs equality — and boxed types?**
Covered in core, but the OOP angle: two `Integer` from `valueOf` in the -128..127 cache compare `==` true; outside it false. Relying on `==` for boxed types is a latent bug. Always `equals` for value comparison of wrappers, and beware autoboxing allocations in hot loops.

**Q6. When would you use a `record` (Java 16+)?**
When the type is _data carrier_: immutable, `equals`/`hashCode`/`toString` auto-generated, all fields final. Perfect for DTOs, API responses, value objects. Don't use a `record` when you need mutable state, inheritance, or behavioral richness — that's a class. `record Point(int x, int y)` is all you need for a coordinate; a `BankAccount` is not a record.

## Senior — design & defense

**Q1. Defend composition over inheritance with a concrete refactor you'd make.**
"I'd take a `ReportGenerator extends ExcelWriter` and flip it: `ReportGenerator` holds a `Writer` (interface) it delegates to. Reason: the Excel coupling meant any change to spreadsheet formatting risked the report logic, and we couldn't unit-test the report without a real spreadsheet. Composition let us inject a `FakeWriter` in tests and add `PdfWriter` with zero changes to `ReportGenerator`. Cost: one extra interface and a constructor arg — cheap insurance against the fragile base class."

**Q2. A team wants a base `BaseEntity` with 30 fields and every JPA entity extends it. What do you say?**
"I'd split it. A true `BaseEntity` (id, version, createdAt, updatedAt, auditing) is fine — that's a genuine 'is-a' with stable shared state. But 30 fields means it's actually a grab-bag; subtypes inherit columns they don't use, queries get wider, and a change ripples everywhere. I'd push the 26 domain-specific fields down into the entities that own them and keep `BaseEntity` to the 4 audit fields. Measured win: narrower tables, clearer ownership, fewer accidental couplings."

**Q3. How do you design an interface so it survives five years of new requirements?**
"I keep it small and behavioral, not a CRUD dump. I favor `sealed` hierarchies (Java 17+) when the set of subtypes is closed — the compiler forces you to handle every case in `switch`, so adding a subtype is a compile error until you've dealt with it everywhere. I expose capabilities as narrow interfaces (`Readable`, `Flushable`) rather than one `MegaService`. And I use `default` methods only for genuinely optional behavior, never to sneak in state."

**Q4. Liskov Substitution — walk a real violation and its fix.**
"The classic `Square extends Rectangle`: setting width must also set height to stay a square, but that breaks `Rectangle`'s contract that width and height are independent. Any code doing `r.setWidth(5); r.setHeight(10); assert r.area()==50` now lies. Fix: don't model square as a rectangle subtype — extract a `Shape` with `area()` and implement both independently, or use a single `Rectangle` that forbids zero/negative and represents a square as w==h. Subtyping is a promise; if you can't keep it, don't make it."

**Q5. You have an interface with 12 methods but most callers use 2. Redesign it.**
"That's Interface Segregation violation. I'd split into focused roles: `Reader` (read), `Writer` (write), `Lifecycle` (start/stop), and let a concrete class implement all three if it needs to. Callers depend only on what they use, so a change to `Writer` never recompiles a read-only consumer. The implementing class is unchanged in behavior; only the _types_ it's exposed through get narrower. This also makes mocking in tests trivial — you stub the 2 methods you care about."

**Q6. How do you prove your OOD is good, not just 'clean' in the interview?**
"I'd point at the change I just made and the cost of the alternative: count the reasons each class changes, the number of call sites that break when a requirement shifts, and the test surface. Good OOD means a new feature touches one class, not twelve. I'd sketch the dependency graph — if it's a DAG with stable abstractions at the top and volatile details at the bottom (dependency inversion), that's the proof. Not 'I used SOLID', but 'here is the diff when the requirement changed, and it was small'."

#### Self-check

- [ ] Junior: I can name the four pillars, abstract class vs interface, override vs overload, and the `equals`/`hashCode` contract.
- [ ] Mid: I can spot fragile-base-class, misuse of each SOLID letter, anemic models, and when `record` fits.
- [ ] Senior: I can refactor inheritance→composition with a cost/benefit, apply LSP to a real violation, and defend an interface design by the size of the change when requirements shift.
