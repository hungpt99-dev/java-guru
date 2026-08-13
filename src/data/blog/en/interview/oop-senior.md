---
title: "Java Interview Prep #2: OOP & Design Principles — Junior to Senior"
description: "OOP at the senior level is applied SOLID, composition over inheritance, and interface design at scale — not reciting definitions. Junior names the principles; senior shows where each one costs you, with code."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

OOP is where interviewers stop asking "what" and start asking "why". Anyone can name the four pillars; a senior can show the code where inheritance bit them and the refactor that fixed it. This post climbs from the textbook to the trade-off table — with compilable examples.

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
// WRONG: only equals overridden -> two equal keys land in different buckets
class User { String id; public boolean equals(Object o){...} }  // no hashCode
Map<User,String> m = new HashMap<>();
m.put(new User("42"), "x");
m.get(new User("42"));   // returns null — different bucket!

// RIGHT
class User {
  String id;
  public boolean equals(Object o){ return o instanceof User u && u.id.equals(id); }
  public int hashCode(){ return id.hashCode(); }   // consistent with equals
}
```

**Q6. `abstract` vs interface `default` methods?**
An abstract class method has a body the subclass may override. An interface `default` provides behavior a class inherits without implementing — used for backward-compatible API evolution. Override a `default` to change it.

## Mid — tradeoffs & pitfalls

**Q1. When is inheritance the wrong tool?**
When the relationship isn't a true "is-a" with stable shared behavior. Inheritance couples the subclass to the parent's implementation forever — the "fragile base class" problem. Reach for **composition**:

```java
// WRONG: a ReportGenerator is not really an ExcelWriter; coupling + untestable
class ReportGenerator extends ExcelWriter {
  void generate() { /* report logic tangled with spreadsheet formatting */ }
}
// RIGHT: hold a Writer, delegate; inject a FakeWriter in tests
class ReportGenerator {
  private final Writer writer;            // interface
  ReportGenerator(Writer writer) { this.writer = writer; }
  void generate() { writer.write(render()); }
}
```

**Q2. Explain SOLID, briefly, with a real misuse of each.**

- **S**: a `UserService` that also sends email and writes audit logs changes for 3 reasons. Split those out.
- **O**: a `switch(type)` you edit every time a new type appears — replace with polymorphism.
- **L**: `Square extends Rectangle` where `setWidth` breaks the rectangle invariant.
- **I**: a `Worker` interface forcing `cleanToilet()` on a `Programmer` — split it.
- **D**: `new MySQLRepository()` hardcoded — depend on `Repository` (interface) instead.

**Q3. `Comparator` vs `Comparable`?**
`Comparable` is the natural ordering (`compareTo`); `Comparator` is an external strategy (many can exist). Use `Comparable` for the default, `Comparator` for context-dependent sorts:

```java
List<User> byName = users.stream().sorted(Comparator.comparing(User::name)).toList();
```

**Q4. Why are getters/setters not real encapsulation?**
A public getter/setter pair with no invariant is a public field with extra steps. Real encapsulation exposes behavior:

```java
// WRONG (anemic): state wide open, invariants unenforced
class Account { public BigDecimal balance; }
account.balance = account.balance.subtract(fee);  // could go negative!

// RIGHT: behavior guards the invariant
class Account {
  private BigDecimal balance;
  void withdraw(BigDecimal amt) {
    if (amt.signum() <= 0 || amt.compareTo(balance) > 0) throw new IllegalArgumentException();
    balance = balance.subtract(amt);
  }
}
```

**Q5. `==` on boxed types — a latent bug?**
`Integer.valueOf(42) == Integer.valueOf(42)` is `true` (cached -128..127) but `Integer.valueOf(200) == Integer.valueOf(200)` is `false`. Always `equals` for wrappers:

```java
Integer a = 200, b = 200;
System.out.println(a == b);       // false — different objects
System.out.println(a.equals(b));   // true
```

**Q6. When would you use a `record` (Java 16+)?**
For immutable data carriers — `equals`/`hashCode`/`toString` auto-generated. Don't use it for mutable state or inheritance. `record Point(int x, int y)` beats a hand-written 40-line class.

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

#### Self-check

- [ ] Junior: I can name the four pillars, abstract class vs interface, override vs overload (with the `null` ambiguity), and the `equals`/`hashCode` contract — with code.
- [ ] Mid: I can spot fragile-base-class, misuse of each SOLID letter, anemic models, wrapper `==` bugs, and when `record` fits — with code.
- [ ] Senior: I can refactor inheritance→composition with a cost/benefit, apply LSP to a real violation, design a 5-year interface with `sealed`, split a fat interface, and defend OOD by the size of the change (1 class vs 12).
