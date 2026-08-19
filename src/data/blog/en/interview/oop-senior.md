---
title: "Java Interview Prep #2: OOP and Design Principles"
description: "A practical set of 50 Java interview questions covering OOP foundations, SOLID trade-offs, composition, interface design, and senior-level refactoring decisions."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

Object-oriented design interviews are not mainly tests of vocabulary. The difficult part is choosing a boundary, preserving an invariant, and accepting the cost of that choice. This article moves from Java fundamentals to design review questions: 50 prompts, with small examples where the code makes the trade-off clearer.

The labels distinguish Java behavior from engineering judgment:

- **[SOURCE FACT]**: a language or API rule.
- **[ANALYSIS]**: a design interpretation or trade-off.
- **[PROPOSED DESIGN]**: one reasonable design for the stated scenario, not a claim about an existing system.

## Junior: Foundations

**Q1. What are the four pillars of OOP?**

**[SOURCE FACT]** Encapsulation keeps state behind controlled behavior. Abstraction exposes intent rather than implementation. Inheritance models specialization and reuses behavior. Polymorphism lets one contract have multiple implementations. **[ANALYSIS]** Naming the four is the easy part; the design test is whether the resulting hierarchy remains valid as requirements change.

**Q2. Abstract class or interface?**

**[SOURCE FACT]** An abstract class can contain instance state and implemented methods, and a class can extend only one class. An interface defines a contract; since Java 8 it may also contain `default` and `static` methods, but it has no instance fields. **[ANALYSIS]** Use an interface for a capability or type. Use an abstract class when shared state or a stable partial implementation is part of the model.

```java
interface Worker { void doWork(); }
interface Reviewer { void review(Change change); }
final class Programmer implements Worker, Reviewer { /* both roles */ }
```

**Q3. What is polymorphism?**

**[SOURCE FACT]** With subtype polymorphism, a variable of a supertype can refer to a subtype. An overridden instance method is selected at runtime from the object's type. Overload resolution, by contrast, happens at compile time from the declared argument types.

```java
Animal animal = new Dog();
animal.speak(); // Dog.speak()
```

**Q4. Overriding versus overloading?**

Overriding uses the same method signature in a subtype and participates in runtime dispatch. Overloading uses the same name with different parameter types and is resolved at compile time. For example, `log(null)` is ambiguous when both `log(Object)` and `log(String)` are available.

```java
void log(Object value) { }
void log(String value) { }
// log(null); // compile-time error: ambiguous
```

**Q5. What is the `equals`/`hashCode` contract?**

**[SOURCE FACT]** If `a.equals(b)` is `true`, both objects must return the same hash code. Override the methods consistently. Otherwise, a logically equal key may not be found in a `HashMap` or `HashSet`.

```java
final class User {
  private final String id;
  // equals and hashCode must use the same identity fields
}
```

**Q6. Abstract method versus interface `default` method?**

An abstract-class method has no implementation for the subclass to inherit. An interface `default` method has an implementation that implementing classes may inherit or override. **[ANALYSIS]** A `default` method can evolve an interface without forcing every existing implementation to add a method immediately; it should still represent genuinely optional behavior.

**Q7. Can constructors be overridden or overloaded?**

**[SOURCE FACT]** Constructors can be overloaded with different parameter lists. They are not overridden because constructors are not inherited. A subclass constructor must invoke a parent constructor, explicitly or implicitly, before its own body runs.

**Q8. What does `super` do in a constructor?**

It invokes a parent constructor; `super.method()` can also select a parent implementation. If the parent has no accessible no-argument constructor, the subclass must call an available constructor explicitly or compilation fails.

**Q9. Method hiding versus overriding?**

**[SOURCE FACT]** A subclass `static` method with the same signature hides the parent method. The selected static method is based on the reference type at compile time. Instance methods can be overridden and are selected through runtime dispatch.

```java
Parent value = new Child();
value.staticMethod(); // Parent.staticMethod()
```

**Q10. Object reference versus primitive?**

**[SOURCE FACT]** A primitive variable stores a value; an object variable stores a reference to an object. Java passes arguments by value: passing a reference copies the reference, not the object. Two copied references can therefore observe mutations to the same mutable object. The size of a reference is JVM-implementation dependent; do not treat a particular byte count as a language guarantee.

**Q11. What is a `record` (Java 16+)?**

**[SOURCE FACT]** A record is a concise data-carrier class. The compiler supplies component accessors and value-based `equals`, `hashCode`, and `toString`. Its components are final, but a component can still refer to a mutable object. **[ANALYSIS]** It fits DTOs and value objects, not a model that needs mutable identity or class inheritance.

```java
record Point(int x, int y) { }
```

**Q12. `null` versus an empty object?**

`null` means there is no object reference; dereferencing it throws `NullPointerException`. `List.of()` and `""` are valid objects with no elements or characters. **[ANALYSIS]** Returning an empty collection is often a clearer contract than returning `null`; use a Null Object only when a meaningful no-op object exists.

**Q13. Can a `static` method access instance fields?**

**[SOURCE FACT]** A static method belongs to the class and has no `this`, so it cannot directly access instance fields or invoke instance methods. It can use static members and its parameters.

**Q14. `String.length()` versus array `.length`?**

**[SOURCE FACT]** `String.length()` is a method and returns the number of UTF-16 `char` code units. That can differ from the number of Unicode code points or user-perceived graphemes. `array.length` is a final field. One uses parentheses; the other does not.

**Q15. What are upcasting and downcasting?**

Upcasting, such as `Animal a = new Dog()`, is implicit and safe when the subtype relationship is valid. Downcasting, such as `Dog d = (Dog) a`, is explicit and throws `ClassCastException` if the object is not a `Dog`. Prefer polymorphic methods; use `instanceof` when a downcast is genuinely required.

## Mid: Trade-offs and Pitfalls

**Q1. When is inheritance the wrong tool?**

**[ANALYSIS]** It is the wrong tool when the relationship is not a stable “is-a” relationship or when subclasses must depend on implementation details of the base class. This is the fragile base class problem. **[PROPOSED DESIGN]** Put the varying collaborator behind an interface and delegate to it:

```java
class ReportGenerator {
  private final Writer writer;
  ReportGenerator(Writer writer) { this.writer = writer; }
  void generate() { writer.write(render()); }
}
```

The dependency can be a spreadsheet writer, PDF writer, or test double without changing report logic.

**Q2. Explain SOLID with one misuse of each principle.**

- **S, Single Responsibility**: a `UserService` that sends email and writes audit logs has multiple reasons to change. Split those responsibilities.
- **O, Open/Closed**: a `switch(type)` edited for every new type is a sign that polymorphic implementations may fit better.
- **L, Liskov Substitution**: `Square extends Rectangle` can violate a rectangle contract if width and height are independently mutable.
- **I, Interface Segregation**: a `Worker` interface requiring `cleanToilet()` should not be forced on a programmer that cannot perform that role.
- **D, Dependency Inversion**: `new MySQLRepository()` inside business logic couples the high-level code to a detail. Depend on a `Repository` abstraction instead.

**Q3. `Comparator` versus `Comparable`?**

**[SOURCE FACT]** `Comparable` defines a type's natural ordering through `compareTo`. `Comparator` is an external ordering strategy, and several can exist for one type. Use the former for the default order and the latter for context-specific sorting.

```java
List<User> byName = users.stream()
    .sorted(Comparator.comparing(User::name))
    .toList();
```

**Q4. Why are getters and setters not sufficient encapsulation?**

An unrestricted getter/setter pair exposes state without protecting invariants. Encapsulation exposes operations that keep the object valid:

```java
final class Account {
  private BigDecimal balance;
  void withdraw(BigDecimal amount) {
    if (amount.signum() <= 0 || amount.compareTo(balance) > 0)
      throw new IllegalArgumentException();
    balance = balance.subtract(amount);
  }
}
```

**Q5. Why is `==` on boxed values a latent bug?**

**[SOURCE FACT]** `Integer.valueOf` must cache at least `-128` through `127`; implementations may cache more. Consequently, identity comparisons can appear to work for one value and fail for another. Use `equals` for wrapper values, or compare primitives deliberately.

**Q6. When would you use a record, and what are its limits?**

Use it for an immutable data carrier or value object. A record cannot extend another class, its components are final, and it has a canonical constructor, though additional constructors and static factories are possible. Final references do not make referenced collections immutable.

**Q7. `equals` versus `==` for records?**

Record `equals` compares all components. `==` still compares object identity:

```java
record Point(int x, int y) { }
var first = new Point(1, 2);
var second = new Point(1, 2);
first.equals(second); // true
first == second;      // false
```

**Q8. Final class versus final method?**

**[SOURCE FACT]** A final class cannot be subclassed; a final method cannot be overridden. The JIT may use that knowledge for devirtualization and inlining, but performance is an implementation concern. Do not add `final` solely to claim a benchmark improvement.

**Q9. What is Template Method, and what is the pitfall?**

The pattern puts a fixed algorithm skeleton in a base class and lets subclasses provide selected steps:

```java
abstract class Report {
  final void produce() { fetch(); render(); save(); }
  abstract void render();
}
```

The fixed flow is useful when the invariant is real. The cost is a stronger base-class dependency: subclasses cannot reorder steps, and skeleton changes affect every subclass.

**Q10. What is Strategy, and when is it better than `if/else`?**

Strategy puts a varying algorithm behind an interface so an implementation can be selected at runtime. It is useful when a type-based branch keeps growing or changing:

```java
interface Discount { BigDecimal apply(Order order); }
final class VipDiscount implements Discount { /* ... */ }
final class SeasonalDiscount implements Discount { /* ... */ }
```

Do not introduce it for a branch that is small, stable, and easier to read inline.

**Q11. Interface or abstract class for shared behavior?**

Choose an interface when consumers need a contract or capability and implementations should remain independent. Choose an abstract class when shared fields and partial implementation are part of a stable abstraction. The class option consumes the single class-inheritance slot.

**Q12. What is `Optional`, and how is it misused?**

`Optional<T>` makes possible absence explicit, mainly at a return boundary. Using it as a field or parameter often complicates APIs without adding useful information. Calling `get()` without handling absence throws `NoSuchElementException`; prefer `orElse`, `orElseGet`, or `orElseThrow` with a clear contract.

**Q13. `Integer.parseInt` versus `Integer.valueOf`?**

**[SOURCE FACT]** `parseInt` returns primitive `int`; `valueOf` returns an `Integer`. Use the return type that matches the boundary and avoid accidental boxing when it is not needed. Wrapper identity must not be tested with `==`.

**Q14. Static initializer versus instance initializer?**

`static {}` runs when the class is initialized, while an instance initializer `{}` runs for each object construction before the constructor body. Both are legal, but a named factory or constructor is usually easier to understand and test.

**Q15. Covariant return types and method parameters?**

An overriding method may return a subtype of the parent method's return type. Parameter types are not contravariant in Java overriding: changing a parameter to a subtype creates an overload, not an override. Add `@Override` so the compiler catches this mistake.

**Q16. `clone()` versus a copy constructor?**

`Object.clone()` is a shallow copy, and `Cloneable` does not describe a useful copying contract. A copy constructor or static factory is explicit, type-safe, and can perform a deep copy when required by the model. Prefer those options.

**Q17. What does excessive layering cost?**

An `XController -> XService -> XManager -> XRepository` chain where middle layers only delegate adds indirection, files, tests, and change surface without adding a boundary. **[ANALYSIS]** Keep a layer when it owns a policy, transaction boundary, or meaningful adapter; collapse pass-through layers.

## Senior: Design and Defense

**Q1. Defend composition over inheritance with a concrete refactor.**

**[PROPOSED DESIGN]** Replace `ReportGenerator extends ExcelWriter` with `ReportGenerator` holding a `Writer`. Formatting changes stay in the writer, and tests can inject a fake writer instead of constructing a workbook. The cost is an interface and constructor dependency; the benefit is a smaller coupling boundary and an independent PDF implementation.

**Q2. A team wants a `BaseEntity` with 30 fields for every JPA entity. What do you say?**

**[PROPOSED DESIGN]** Keep only genuinely shared, stable state such as identity, version, timestamps, or auditing in the base type. Move unrelated fields to the entities that own them. Otherwise entities inherit unused columns and unrelated changes spread through mappings. The exact table-size effect is workload-dependent, so it should be measured rather than promised.

**Q3. How do you design an interface for five years of change?**

**[PROPOSED DESIGN]** Keep the contract small and behavioral. For a closed set of subtypes, `sealed` (Java 17+) lets the compiler identify unhandled cases:

```java
sealed interface PaymentMethod
    permits Card, BankTransfer, Wallet { }
```

Expose narrow capabilities such as `Readable` and `Flushable`, not a `MegaService`. Use `default` only for behavior that is genuinely optional.

**Q4. Give a real Liskov Substitution violation and fix.**

`Square extends Rectangle` is unsafe if rectangle callers expect width and height to change independently. A square cannot honor both that expectation and its own invariant. Model both as separate implementations of a smaller `Shape` contract, such as `area()`. Subtyping is a behavioral promise, not just code reuse.

**Q5. An interface has 12 methods, but callers use 2. Redesign it.**

Split it into focused interfaces such as `Reader`, `Writer`, and `Lifecycle`. A class may implement all three, while a read-only caller depends only on `Reader`. This narrows the dependency and reduces test setup without changing the class's behavior.

**Q6. How do you show that OOD is good, not merely “clean”?**

**[ANALYSIS]** Trace a real requirement change. Count the classes and call sites that change, identify which invariants each class owns, and inspect the test surface. A dependency graph with stable abstractions separated from volatile details is useful, but “we used SOLID” is not evidence. The diff and its failure modes are evidence.

**Q7. What is the versioning concern with a record in a public API?**

Record components are part of the generated equality contract and commonly part of serialization. Adding one can therefore be a breaking change for consumers that depend on either. Keep records internal and map at the boundary, or treat the component list as an explicitly versioned public contract.

**Q8. Sealed hierarchy or enum?**

Use an enum for a fixed set of simple constants. Use a sealed hierarchy when each case needs different state or behavior and the set should remain closed. If the model is only `A | B | C`, an enum is simpler.

**Q9. How do you design a plugin system without `instanceof` chains?**

Define a `Plugin` contract such as `handle(Event)`, register implementations, and dispatch through explicit capabilities or predicates. A Visitor can provide typed double dispatch. For a sealed event hierarchy, keep handling centralized enough that the compiler can check coverage.

**Q10. How do you keep a domain model free of framework annotations?**

**[PROPOSED DESIGN]** Put JPA, Jackson, and validation annotations on persistence or API DTOs. Map them to domain objects at the boundary. The domain then depends on business types rather than framework packages, making framework replacement and plain unit tests easier. This is a design choice, not a universal rule; the mapping cost must be justified at the boundary.

**Q11. A base-class method is 400 lines. How do you refactor safely?**

First characterize current behavior with tests, especially outputs and error cases. Then extract cohesive steps, preserve the invariant skeleton in a final template method, or replace the hierarchy with strategy objects. Verify behavior after each step. The line count is a warning sign; the tests define what must remain stable.

**Q12. Defend dependency inversion with a concrete seam.**

**[PROPOSED DESIGN]** `Checkout` depends on a `PaymentGateway` abstraction, while a Stripe implementation is assembled at the edge and injected. Tests can use a fake gateway without network access, and another gateway can be selected without editing `Checkout`. The seam is valuable because it isolates policy from an external detail.

**Q13. When is immutability worth the allocation cost?**

Prefer immutable values across thread boundaries, in caches, and at method boundaries when the value represents a stable fact. This reduces shared-mutation bugs and defensive-copy requirements. In a measured hot loop, a mutable local may be appropriate. Allocation and garbage-collection costs are workload-dependent; benchmark before optimizing.

**Q14. Inheritance or delegation for cross-cutting behavior?**

Use decorators, interceptors, or aspects for logging and metrics rather than a `LoggedThing` base class. A `MetricsDecorator` can wrap a `Repository`, and decorators can be composed for logging, metrics, and caching. Delegation keeps concerns orthogonal; inheritance creates combinations that become difficult to maintain.

**Q15. What is the cost of over-abstracting?**

An abstraction with one implementation can add names and indirection without isolating a real seam. **[ANALYSIS]** Introduce an interface when there are multiple meaningful implementations or a concrete testing/integration boundary. YAGNI is a design constraint: do not encode hypothetical requirements as architecture.

**Q16. How do you evolve a public interface without breaking callers?**

Add optional behavior as a `default` method when binary compatibility and semantics allow it. Deprecate old methods with a documented migration path. For an incompatible contract, publish a new version and define how the old version delegates or is retired. The policy depends on the API's compatibility promise; a minor release is not automatically safe for every consumer.

**Q17. A subclass overrides a method but calls `super` incorrectly. How do you guard it?**

If parent behavior is an invariant, make the algorithm method `final` and expose a protected hook for the variable step. If replacement is intentional, document the contract and test it. A final template method prevents a subclass from silently skipping required setup or cleanup.

**Q18. How do you model a state machine without tangled booleans?**

Represent states with an enum or sealed type and define legal transitions explicitly. Several booleans can describe impossible combinations; a transition method can reject illegal moves:

```java
enum State {
  DRAFT, ACTIVE, LOCKED;
  boolean canTransitionTo(State next) {
    return switch (this) {
      case DRAFT -> next == ACTIVE;
      case ACTIVE -> next == LOCKED || next == DRAFT;
      case LOCKED -> next == DRAFT;
    };
  }
}
```

The model makes invalid transitions explicit instead of distributing checks across callers.

#### Self-check

- [ ] Junior: I can explain the four pillars, abstract class versus interface, overriding versus overloading, static hiding, the `equals`/`hashCode` contract, and when a record fits.
- [ ] Mid: I can identify fragile-base-class coupling, SOLID misuse, anemic models, boxed-value `==` bugs, Template and Strategy trade-offs, and `Optional` misuse.
- [ ] Senior: I can refactor inheritance to composition, apply Liskov Substitution, design a narrow sealed interface, split a fat interface, defend a change boundary with evidence, and model legal state transitions.
