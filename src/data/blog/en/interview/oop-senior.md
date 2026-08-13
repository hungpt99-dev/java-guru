---
title: "Java Interview Prep #2: OOP & Design Principles — Junior to Senior"
description: "OOP at the senior level is applied SOLID, composition over inheritance, and interface design at scale — not reciting definitions. 50 interview-grade questions from the four pillars to 'here is the refactor that saved us a 12-class change'."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

OOP is where interviewers stop asking "what" and start asking "why". Anyone can name the four pillars; a senior can show the code where inheritance bit them and the refactor that fixed it. This post climbs from the textbook to the trade-off table — 50 questions, with compilable examples.

> Mindset: junior implements the interface; senior decides whether the interface should exist at all, and what it costs the next five years of the codebase.

## Junior — foundations

**Q1. What are the four pillars of OOP?**
Encapsulation (hide state behind behavior), Abstraction (expose intent, not mechanism), Inheritance (reuse by specialization), Polymorphism (one interface, many implementations). Naming them is free; applying them without a brittle hierarchy is the skill.

**Q2. Abstract class vs interface?**
An abstract class can hold state and implement methods; a class extends only one. An interface is a contract — pre-Java 8 only signatures, now with `default`/`static` methods but no instance fields. Prefer interfaces for the _type_, abstract classes only for shared state/behavior.

```java
// WRONG: forcing a single inheritance axis for something that's really a role
abstract class Worker { abstract void doWork(); }
class Programmer extends Worker { void doWork() { /* ... */ } }
// can't also be a Reviewer without another axis
// RIGHT: roles as interfaces, composed freely
interface Worker { void doWork(); }
interface Reviewer { void review(Change c); }
class Programmer implements Worker, Reviewer { /* both */ }
```

**Q3. What is polymorphism and how does it work?**
Subtype polymorphism: a supertype variable refers to any subtype, and the JVM dispatches the overridden method at runtime. Overloading is _not_ polymorphism (resolved at compile time by signature).

```java
Animal a = new Dog();   // compile type Animal, runtime Dog
a.speak();              // calls Dog.speak() — virtual dispatch
```

**Q4. Overriding vs overloading?**
Overriding: same signature in a subclass, runtime-dispatched. Overloading: same name, different parameter types, compile-time. An ambiguous overload fails to compile:

```java
void log(Object o) { }
void log(String s) { }
log(null);   // compile ERROR: ambiguous between Object and String
```

**Q5. What does the `equals`/`hashCode` contract require?**
If `a.equals(b)` then `a.hashCode() == b.hashCode()`. Override both or maps break:

```java
class User { String id; public boolean equals(Object o){...} }  // no hashCode
Map<User,String> m = new HashMap<>();
m.put(new User("42"), "x");
m.get(new User("42"));   // returns null — different bucket!
// RIGHT: both override, consistent
```

**Q6. `abstract` vs interface `default` methods?**
An abstract class method has a body the subclass may override. An interface `default` provides behavior a class inherits without implementing — used for backward-compatible API evolution. Override a `default` to change it.

**Q7. Can a constructor be overridden or overloaded?**
Overloaded yes (multiple constructors with different params); overridden no (constructors aren't inherited, they're per-class). A subclass constructor must call a parent constructor (`super(...)`) as its first statement.

**Q8. What is `super` used for in a constructor?**
To invoke the parent's constructor or method. Forgetting `super()` when the parent has no no-arg constructor is a compile error — common with `SQLException(String)`-style parent classes.

**Q9. What is method hiding vs overriding?**
A `static` method in a subclass with the same signature as a parent `static` method _hides_ it (resolved by reference type at compile time), unlike instance method overriding (runtime dispatch by object type). A frequent interview trap:

```java
Parent p = new Child(); p.staticMethod(); // calls Parent.staticMethod (hiding)
```

**Q10. What is the difference between an object reference and a primitive?**
A reference is a pointer to a heap object (~4–8 bytes); a primitive holds the value directly (4 bytes for `int`). Passing a primitive copies the value; passing an object reference copies the pointer (both point to the same object). Mutating through the reference mutates the shared object.

**Q11. What is a `record` (Java 16+) and when to use it?**
An immutable data carrier with auto-generated `equals`/`hashCode`/`toString`/accessors. Use for DTOs and value objects. Don't use for mutable state or inheritance. `record Point(int x, int y)` beats a hand-written 40-line class.

**Q12. What is the difference between `null` and an empty object?**
`null` means "no object" — dereferencing it throws `NullPointerException`. An empty object (e.g. `List.of()`, `""`) is a valid object with no contents. Prefer returning empty collections over `null` to avoid NPEs (the Null Object / empty-collection idiom).

**Q13. What is a `static` method — can it access instance fields?**
A `static` method belongs to the class, not an instance; it cannot access instance (non-static) fields or call instance methods directly — there's no `this`. It can only use other `static` members or its parameters.

**Q14. What is the difference between `String.length()` and array `.length`?**
`String.length()` is a method (returns char count, where a char is a UTF-16 code unit — so a string with supplementary characters reports more than the grapheme count). `array.length` is a `final` field. A classic off-by-one: `str.length()` is a call, `arr.length` is not.

**Q15. What is upcasting and downcasting?**
Upcasting (`Animal a = new Dog()`) is implicit and always safe. Downcasting (`Dog d = (Dog) a`) is explicit and throws `ClassCastException` at runtime if `a` isn't actually a `Dog`. Use `instanceof` before downcasting.

## Mid — tradeoffs & pitfalls

**Q1. When is inheritance the wrong tool?**
When the relationship isn't a true "is-a" with stable shared behavior. Inheritance couples the subclass to the parent's implementation forever — the "fragile base class" problem. Reach for **composition**:

```java
// WRONG: a ReportGenerator is not really an ExcelWriter; coupling + untestable
class ReportGenerator extends ExcelWriter { void generate() { /* tangled */ } }
// RIGHT: hold a Writer, delegate; inject a FakeWriter in tests
class ReportGenerator {
  private final Writer writer;
  ReportGenerator(Writer writer) { this.writer = writer; }
  void generate() { writer.write(render()); }
}
```

**Q2. Explain SOLID, briefly, with a real misuse of each.**

- **S**: a `UserService` that also sends email and writes audit logs changes for 3 reasons. Split them out.
- **O**: a `switch(type)` you edit every time a new type appears — replace with polymorphism.
- **L**: `Square extends Rectangle` where `setWidth` breaks the rectangle invariant.
- **I**: a `Worker` interface forcing `cleanToilet()` on a `Programmer` — split it.
- **D**: `new MySQLRepository()` hardcoded — depend on `Repository` (interface) instead.

**Q3. `Comparator` vs `Comparable`?**
`Comparable` is the natural ordering (`compareTo`); `Comparator` is an external strategy (many can exist). Use `Comparable` for the default, `Comparator` for context-dependent sorts.

```java
List<User> byName = users.stream().sorted(Comparator.comparing(User::name)).toList();
```

**Q4. Why are getters/setters not real encapsulation?**
A public getter/setter pair with no invariant is a public field with extra steps. Real encapsulation exposes behavior:

```java
class Account { public BigDecimal balance; }          // WRONG: no invariant guard
account.balance = account.balance.subtract(fee);        // could go negative!
class Account {                                          // RIGHT
  private BigDecimal balance;
  void withdraw(BigDecimal amt) {
    if (amt.signum() <= 0 || amt.compareTo(balance) > 0) throw new IllegalArgumentException();
    balance = balance.subtract(amt);
  }
}
```

**Q5. `==` on boxed types — a latent bug?**
`Integer.valueOf(42) == Integer.valueOf(42)` is `true` (cached -128..127) but `Integer.valueOf(200) == Integer.valueOf(200)` is `false`. Always `equals` for wrappers.

**Q6. When would you use a `record` — and its limits?**
For immutable data carriers — auto `equals`/`hashCode`/`toString`. Limits: no inheritance (can't extend a record), all fields final, canonical constructor only (you can add static/non-canonical constructors). Don't use it where you need mutable state or a mutable collection field (the reference is final but the collection isn't).

**Q7. What is the difference between `equals` and `==` for `record`?**
Records generate `equals` by all components, so two records with equal components are `equals`-equal; `==` still compares identity. `var r1 = new Point(1,2); var r2 = new Point(1,2); r1.equals(r2)` is `true`, `r1 == r2` is `false`.

**Q8. What is the difference between `final` class and `final` method — and why the JVM cares?**
A `final` class can't be subclassed; a `final` method can't be overridden. The JIT uses this for devirtualization — it can inline the call directly because it knows there's only one implementation, removing the vtable lookup (~nanoseconds saved per call, compounding in hot loops).

**Q9. What is the Template Method pattern and a pitfall?**
A base class defines a `final` skeleton calling abstract steps the subclass fills:

```java
abstract class Report {
  final void produce() { fetch(); render(); save(); }   // skeleton
  abstract void render();
}
```

Pitfall: the base class's `produce()` flow is locked; subclasses can't reorder steps, and a change to the skeleton ripples to all subclasses (fragile base class again).

**Q10. What is the Strategy pattern and when over if/else?**
Encapsulate a varying algorithm behind an interface; swap implementations at runtime. Use it instead of a `switch` on type that you keep editing:

```java
interface Discount { BigDecimal apply(Order o); }
class VipDiscount implements Discount { /* 20% off */ }
class SeasonalDiscount implements Discount { /* 10% off */ }
// adding a discount = new class, no edit to callers
```

**Q11. What is the difference between an interface and an abstract class for shared behavior?**
Interface: no state, multiple implementation, `default` methods for optional behavior. Abstract class: shared state + partial implementation, single inheritance. If you need shared _fields_ (e.g. an `id`, an `auditStamp`), abstract class; if only a _contract_, interface.

**Q12. What is `Optional` and a misuse?**
`Optional<T>` signals "may be absent" in return types, replacing `null`. Misuse: using it as a field/parameter type (just use `null` or a real object), or calling `get()` without `isPresent()` (throws `NoSuchElementException` — use `orElse`/`orElseThrow`).

**Q13. What is the difference between `Integer.parseInt` and `Integer.valueOf`?**
`parseInt` returns a primitive `int`; `valueOf` returns an `Integer` (cached for -128..127). Use `parseInt` when you want the primitive; `valueOf` when you need an object. Mixing leads to the boxing/== traps above.

**Q14. What is a `static` initializer block vs instance initializer?**
`static {}` runs once at class load; `{}` (instance initializer) runs on every `new`, before the constructor body. Useful for shared init logic across multiple constructors, but rarely needed — a constructor or factory is clearer.

**Q15. What is covariance/contravariance of return/param types in overriding?**
Java allows covariant return types (overriding method can return a subtype of the parent's return type). Parameters are _not_ covariant — a method with a subclass parameter is an overload, not an override, and won't be dispatched virtually. A common "why isn't my override called?" bug.

**Q16. What is the difference between `clone()` and copy constructor?**
`Object.clone()` is a shallow copy (and `Cloneable` is a broken, checked-exception-throwing marker). A copy constructor (`new User(other)`) is explicit, deep when you make it so, and type-safe. Prefer copy constructors or static factories over `clone()`.

**Q17. What is the cost of excessive layering (anemic classes)?**
Each extra wrapper class adds a vtable hop and indirection; an architecture of `XController → XService → XManager → XRepository → XEntity` with no logic in the middle layers is pure overhead (more files, more test surface, more diffs for the same change). Collapse layers that only delegate.

## Senior — design & defense

**Q1. Defend composition over inheritance with a concrete refactor.**
"I'd take `ReportGenerator extends ExcelWriter` and flip it: `ReportGenerator` holds a `Writer` interface it delegates to. Reason: the Excel coupling meant any formatting change risked the report logic, and we couldn't unit-test the report without a real spreadsheet. Composition lets us inject a `FakeWriter` and add `PdfWriter` with zero changes to `ReportGenerator`. Cost: one interface + a constructor arg — cheap insurance against the fragile base class. Measured win: test setup went from 'spin up a workbook' to 'pass a stub'."

**Q2. A team wants `BaseEntity` with 30 fields, every JPA entity extends it. What do you say?**
"I'd split it. A true `BaseEntity` (id, version, createdAt, updatedAt, auditing) is a genuine 'is-a' with stable shared state. The other 26 fields are a grab-bag — subtypes inherit columns they don't use, queries get wider, changes ripple everywhere. I'd push the 26 down into the entities that own them. Measured win: narrower tables (~30% fewer bytes/row on the hot table), clearer ownership."

**Q3. Design an interface that survives 5 years of new requirements.**
"I keep it small and behavioral. For a closed set of subtypes I use `sealed` (Java 17+) so the compiler forces handling every case — adding a subtype is a compile error until you've dealt with it everywhere:"

```java
sealed interface PaymentMethod permits Card, BankTransfer, Wallet { }
// adding 'Crypto' breaks every switch(PaymentMethod) until handled — safe evolution
```

"I expose narrow capabilities (`Readable`, `Flushable`) rather than one `MegaService`, and use `default` only for genuinely optional behavior."

**Q4. Liskov Substitution — a real violation and its fix.**
"`Square extends Rectangle`: setting width must also set height to stay a square, but that breaks `Rectangle`'s contract that width/height are independent. Code doing `r.setWidth(5); r.setHeight(10); assert r.area()==50` lies. Fix: don't model square as a rectangle subtype — extract `Shape` with `area()` and implement both independently. Subtyping is a promise; if you can't keep it, don't make it."

**Q5. An interface with 12 methods but callers use 2. Redesign it.**
"Interface Segregation violation. Split into `Reader`, `Writer`, `Lifecycle`; a concrete class implements all three if it needs to, but a read-only consumer depends only on `Reader` — so a change to `Writer` never recompiles it. The implementing class is behaviorally unchanged; only the _types_ it's exposed through narrow. Bonus: mocking in tests becomes `when(reader.read()).thenReturn(...)` instead of stubbing 12 methods."

**Q6. How do you prove your OOD is good, not just 'clean'?**
"I point at the change I just made and the cost of the alternative: count the reasons each class changes, the call sites that break when a requirement shifts, the test surface. Good OOD means a new feature touches one class, not twelve. I'd sketch the dependency graph — a DAG with stable abstractions on top, volatile details at the bottom (dependency inversion) — and say 'here is the diff when the requirement changed, and it was small.' Not 'I used SOLID'; a number: 1 class changed vs 12."

**Q7. `record` in a public API — versioning concern?**
"Records couple the component list to the `equals`/`hashCode` contract, so adding a component is a breaking change for equality and serialization. For a stable API I either keep records internal (DTOs mapped at the boundary) or accept that the component list is the contract. I version the API explicitly rather than relying on field addition being safe."

**Q8. When would you use a `sealed` hierarchy vs an `enum`?**
"Enum when the set is fixed and has no per-instance state beyond a few constants; `sealed` when each subtype needs its own data and behavior but the set is closed (compiler-enforced exhaustiveness). For a payment pipeline where each method carries different fields, `sealed` beats a giant enum-with-fields. If it's just 'status = A|B|C', an enum is simpler."

**Q9. Design a plugin system without `instanceof` chains.**
"Define a `Plugin` interface with a `handle(Event)` and a capability marker; register plugins in a `List` and dispatch by predicate rather than `if (p instanceof X)`. The `Visitor` pattern is the typed alternative — the acceptor calls back into the visitor, keeping the dispatch in one place and the compiler checking coverage for a `sealed` hierarchy."

**Q10. How do you keep a domain model free of framework annotations?**
"Put JPA/Jackson/`@Valid` annotations on _persistence_ or _API_ DTOs, not on the domain `Order`/`Account` types. Map between them at the boundary. Benefit: the domain compiles and unit-tests with zero Spring/Jakarta imports (~30% faster test startup, no container needed), and the framework version can change without touching business logic. Rule: `com.finpay.order.domain` has no `jakarta.*` imports."

**Q11. A base class method does too much (400 lines). Refactor safely.**
"I extract method-objects per cohesive step, then push the invariant skeleton into a `final` template method and the steps into `abstract`/`default` methods, or replace the hierarchy with a composition of strategy objects. I do it behind tests: first characterize current behavior with golden-output tests, then extract, then verify the outputs are byte-identical. A 400-line method is a bug magnet; the refactor is justified by the test surface it removes."

**Q12. Defend dependency inversion with a concrete seam.**
"High-level `Checkout` shouldn't import `StripeClient` (a detail). It depends on `PaymentGateway` (abstraction); the Stripe impl lives at the edge and is injected. Now `Checkout` is testable with a `FakeGateway` (no network, ~0 ms) and swappable to `PaypalGateway` without touching `Checkout`. Measured: unit tests for `Checkout` run in ~50 ms instead of needing a payment sandbox. The seam is the win."

**Q13. When is immutability worth the allocation cost?**
"For values passed across threads or stored in caches, immutability removes the entire class of shared-mutation bugs and lets you skip defensive copies (saving ~16 bytes + GC per copy). The allocation cost (~10 ns) is negligible next to the bug cost. For hot inner-loop temporaries mutated in place, a mutable object is fine. I default to immutable for anything that leaves a method boundary."

**Q14. How do you choose between inheritance and delegation for cross-cutting behavior (logging, metrics)?**
"Never inherit for cross-cutting concerns — that's what aspects or decorators are for. A `MetricsDecorator` wrapping a `Repository` adds timing without the repository knowing, and you compose several (logging → metrics → cache) without a deep hierarchy. Inheritance would force every class to extend `LoggedThing`, which doesn't compose. Decorator = O(n) wrappers for n concerns; inheritance = O(2^n) combinatorially."

**Q15. What is the cost of over-abstracting (speculative generality)??**
"An abstraction with one implementation is dead weight: it names a concept nobody uses, adds indirection, and makes the reader hunt for the single concrete class. Rule of thumb: don't extract an interface until you have two implementations or a real seam (testing). YAGNI: a plain class today beats an interface-impl pair you 'might' need. I delete speculative abstractions in review."

**Q16. How do you evolve a public interface without breaking callers?**
"Add `default` methods (binary-compatible) rather than changing signatures; mark deprecated methods `@Deprecated` and keep them for one release. Never remove a method in a minor version. For a breaking change, release a `v2` interface and keep `v1` delegating to it for a migration window. I treat the interface surface as a contract with a deprecation policy, not a playground."

**Q17. A subclass overrides a method but calls `super` incorrectly (or not at all). How do you guard?**
"If the parent's behavior must run, make the parent method `final` and expose an extension point (`protected` hook) the subclass fills, so the subclass can't skip the invariant. If the subclass must fully replace behavior, document it and add a test asserting the contract. The Template Method + `final` skeleton is the guard against 'forgot to call super' bugs."

**Q18. How do you represent a state machine without a tangle of booleans?**
"Model states as an `enum`/`sealed` type with explicit legal transitions, not `boolean active, boolean paused, boolean locked` (which allows invalid combos like all-three-true). A transition method rejects illegal moves:"

```java
enum State { DRAFT, ACTIVE, LOCKED;
  boolean canTransitionTo(State next) { return switch(this){ case DRAFT -> next==ACTIVE; case ACTIVE -> next==LOCKED||next==DRAFT; case LOCKED -> next==DRAFT; }; }
}
```

"Illegal state becomes impossible by construction, not a runtime `if` you forgot."

#### Self-check

- [ ] Junior: I can name the four pillars, abstract class vs interface, override vs overload (with the `null` ambiguity and static hiding), the `equals`/`hashCode` contract, and when `record` fits — with code.
- [ ] Mid: I can spot fragile-base-class, misuse of each SOLID letter, anemic models, wrapper `==` bugs, Template/Strategy patterns, and `Optional` misuse — with code.
- [ ] Senior: I can refactor inheritance→composition with a cost/benefit, apply LSP to a real violation, design a 5-year interface with `sealed`, split a fat interface, defend OOD by the size of the change (1 class vs 12), and model state machines that make illegal states unrepresentable.
