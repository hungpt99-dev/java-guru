---
title: "Senior Java Interview: OOP and Design Principles"
description: "OOP at the senior level is about applied SOLID, composition over inheritance, and interface design at scale — not reciting definitions."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

Object-oriented programming is the entry ticket. A junior recites "a class is a blueprint" and "SOLID is five letters." A senior treats design as **structural engineering**: every decision has a load path, a failure mode, and a price, and the interview is about whether you can justify the walls you'd leave standing.

> Mindset: when the interviewer says "your team needs a new feature," the senior response is never "add a branch." It's "which axis of change is this — and what do I build that I won't have to edit tomorrow?" Definitions pass juniors; **decisions under constraints** clear the senior bar.

## Interview question ladder (Junior → Mid → Senior)

> Drill these out loud. Junior = "do you know the concept"; Mid = "do you know the tradeoffs"; Senior = "can you defend a decision under pressure, with a number and a postmortem."

### Junior — foundations

- **Q: What does each SOLID letter stand for?**
  A: S — Single Responsibility, O — Open/Closed, L — Liskov Substitution, I — Interface Segregation, D — Dependency Inversion. A junior can recite them; a senior can point at the code that violates one and the cost of fixing it.

- **Q: What's the difference between an interface and an abstract class?**
  A: An interface is a pure contract (no state, multiple inheritance); an abstract class can hold state and provide partial implementation (single inheritance). Use an interface to define a role; an abstract class to share code among close relatives.

- **Q: What's the difference between inheritance and composition?**
  A: Inheritance = "is-a" (shares the parent's implementation); composition = "has-a" (holds an instance and delegates). Composition is usually favored because it's more flexible and less coupled.

- **Q: What is polymorphism, in one sentence?**
  A: One interface, many implementations — the caller writes against the abstraction and the runtime picks the concrete behavior (method override, or interface dispatch).

- **Q: What are the four pillars of OOP again — and which one does `private` belong to?**
  A: Encapsulation, abstraction, inheritance, polymorphism. `private`/`protected` are encapsulation — hiding state behind a controlled surface so change stays local.

### Mid — tradeoffs & pitfalls

- **Q: Why is "favor composition over inheritance" more than a slogan?**
  A: Inheritance couples you to the parent's implementation and breaks when requirements cross-cut (a class needs two behaviors from two parents — but Java has single inheritance). Composition lets you swap a behavior at runtime via an injected dependency. The trap: a deep hierarchy where every change ripples up and down the tree.

- **Q: Tell me a concrete Open/Closed violation and the fix.**
  A: A `InvoiceCalculator` with `if (type == PDF) … else if (type == XLSX)` — every new format edits the class (not closed for modification). Fix: a `Renderer` interface + one class per format, selected by a map. Now adding a format means adding a class, not editing existing code.

- **Q: What's the Liskov violation people actually ship?**
  A: A subclass that strengthens a precondition or weakens a postcondition — e.g. `Square extends Rectangle` but `setWidth` must also set height, breaking the rectangle contract callers rely on. The fix is usually "don't force the IS-A" — model them as siblings under a common abstraction instead.

- **Q: Why is a "fat interface" a problem, and what's the fix?**
  A: An interface with 12 methods forces every implementer to stub behavior it doesn't need (the `RemoteControl` with `startCar` on a `ToyCar`). Fix: split into role interfaces (`Printable`, `Scannable`) so clients depend only on what they use — Interface Segregation.

- **Q: Dependency Inversion — what's the difference between it and "depend on abstractions"?**
  A: DIP says high-level modules shouldn't depend on low-level ones; both depend on abstractions, and the binding happens at the edge (constructor injection). The win: you can swap the Postgres repo for an in-memory one in a test without touching the service. Without it, business logic is welded to the DB driver.

### Senior — design & defense

- **Q: "Add CSV export to the report." Where does the code go, and what do you refuse to do?**
  A: Refuse the `if/else` in the existing class (OCP violation). Add a `ReportExporter` interface, a `CsvExporter` implementation, register it, and inject/select by format. The senior tell: I know _which axis of change_ this is (output format) and I isolate it so the next format is additive, not invasive.

- **Q: You inherited a 6-level inheritance tree that nobody understands. What do you do — rewrite it or leave it?**
  A: Don't rewrite on day one. First, characterize behavior with characterization tests so I can refactor without silent breakage. Then flatten the risky parts to composition incrementally, behind those tests, one subclass at a time. A big-bang rewrite of working code is how you create a worse incident.

- **Q: When is inheritance actually the right call over composition?**
  A: When there's a genuine "is-a" with shared _implementation_ that won't diverge — e.g. `BaseEntity` with id/version/audit fields, or a `Template Method` where the skeleton is stable and only steps vary. Forgive the coupling because the abstraction is stable. Name the case where composition would be ceremony.

- **Q: Defend "interface for every dependency" — and where it becomes cargo-cult.**
  A: An interface per dependency is great when there are two implementations or you test against a fake. It's cargo-cult when a class has one caller and zero alternate implementations — you've added a layer of indirection for no benefit. Senior judgment: introduce the seam when the second implementation (or the test) actually appears, not preemptively.

- **Q: Walk me through a design that "followed SOLID" but was awful to work in.**
  A: A `UserService` split into 14 tiny classes behind 14 interfaces — every change touched six files, and the "abstractions" had one implementation each (ceremony, not engineering). The lesson: SOLID serves changeability and testability, not file count. I'd collapse the single-impl interfaces and keep only the seams that earn their keep.

#### Self-check

- [ ] Junior: SOLID letters, interface vs abstract class, inheritance vs composition, polymorphism, what `private` belongs to.
- [ ] Mid: why composition-over-inheritance, a real OCP violation + fix, a shipped LSP break, fat-interface fix, DIP vs "depend on abstractions."
- [ ] Senior: where new code goes without violating OCP, how to safely refactor a deep hierarchy, when inheritance is right, interface-cargo-cult, a SOLID-but-awful design postmortem.

## 1. SOLID — the applied version, with the traps

"Define SOLID" is a screen for juniors. Seniors get asked to apply it, then to defend the places where applying it naively is wrong. Walk all five, but be ready to go deeper on the three that actually bite in production: Open/Closed, Dependency Inversion, and Liskov.

### Open/Closed — the axis of change

The textbook says "open for extension, closed for modification." The real question is **which axis changes fastest** — OCP is a strategy for the unstable part of your system, not a global law. Apply it first where you add a new case every sprint:

```java
// WRONG — every new payment method is another branch in this if/else tower.
// Adding Apple Pay means editing pay() — an edit to working code, a merge
// conflict on the same lines every sprint, a regression surface that grows
// with every feature.
PaymentResult pay(Order order) {
    if (order.method() == PaymentMethod.CARD)        return cardGateway.charge(order);
    else if (order.method() == PaymentMethod.BANK)   return bankGateway.transfer(order);
    else if (order.method() == PaymentMethod.WALLET) return walletGateway.pay(order);
    throw new UnsupportedOperationException(order.method().name());
}

// RIGHT — the registry is the extension point. A new method = one new class
// plus one registration line. The dispatch table is stable; the set of
// strategies grows.
Map<PaymentMethod, PaymentHandler> handlers = Map.of(
    PaymentMethod.CARD,   new CardHandler(cardGateway),
    PaymentMethod.BANK,   new BankHandler(bankGateway),
    PaymentMethod.WALLET, new WalletHandler(walletGateway)
);
PaymentResult pay(Order order) {
    return handlers.get(order.method()).handle(order);
}
```

> What interviewers actually probe: "we're adding a 4th payment method — walk me through the change." "Add an `else if`" fails the OCP check. "The registry gets one entry; the new class implements the contract" passes it — and then they immediately ask the counter-question below.

**The counter-trap — OCP is not free.** A registry of one-method strategies is ceremony if the set never grows. And pattern matching changed the calculus: with a **sealed enum**, an exhaustive `switch` is _also_ closed for modification — adding a value without handling it breaks the build instead of breaking the runtime:

```java
// RIGHT (alternative) — sealed domain: the compiler enforces coverage.
// Adding PaymentMethod.BITCOIN fails the build until every switch handles it.
PaymentResult pay(Order order) {
    return switch (order.method()) {
        case CARD   -> cardGateway.charge(order);
        case BANK   -> bankGateway.transfer(order);
        case WALLET -> walletGateway.pay(order);
    };
}
```

The senior tell is naming the two modes and picking deliberately. **Closed world** (sealed + exhaustive switch): the domain changes rarely and all-at-once, and you want compile-time proof you missed a case. **Open world** (strategy registry, `ServiceLoader`, plugin classes): third parties or runtime add variants independently, and compile-time exhaustiveness would be a lie. Building a plugin framework for a two-case enum is the over-engineering interviewers watch for.

### Dependency Inversion — who owns the interface

Dependency **Injection** is passing a dependency in. Dependency **Inversion** is deciding who writes the contract. They are not the same, and conflating them is the most common mid-level answer.

The plug-and-socket framing: a wall socket is a standard **owned by the building**, and every appliance conforms to it — the lamp doesn't get to invent its own socket and demand the wall change. DIP is the same. Your `OrderService` (the consumer, the building) declares `PaymentGateway` (the socket). Stripe's SDK is the appliance — an **adapter** that implements your port. That's why it's called _inversion_: the high-level module defines the abstraction the low-level module implements, not the reverse.

```java
// WRONG — the consumer reached into the world and grabbed a concrete thing.
// The order domain now depends on Stripe's SDK — at compile time, at test
// time, and forever.
class OrderService {
    private final StripeGateway gateway = new StripeGateway();
    PaymentResult pay(Order order) { return gateway.charge(order); }
}

// RIGHT — the consumer owns the port; the adapter conforms to it.
// Stripe could vanish tonight and the domain wouldn't recompile.
class OrderService {
    private final PaymentGateway gateway;
    OrderService(PaymentGateway gateway) { this.gateway = gateway; }
    PaymentResult pay(Order order) { return gateway.charge(order); }
}

interface PaymentGateway { PaymentResult charge(Order order); }
class StripeGatewayAdapter implements PaymentGateway { /* delegate to the SDK */ }
```

This is _why_ Spring exists — not to "make DI easy," but to wire adapters to ports so the domain stays clean. But the real payoff isn't the framework, it's the **test seam**:

> Production story: `OrderService` news up `StripeGateway` in its constructor, so the retry-on-timeout path can't be unit-tested — every test either hits Stripe's sandbox or patches a static. That's not a testing problem, it's a DIP violation that shows up as a testing problem. The moment the dependency became injectable, the flaky integration test became a three-line unit test with a fake.

**The trap on the other side — interface explosion.** DIP does not mean "extract an interface for every class." A `UserService` interface with exactly one implementation, one consumer, and no test double is ceremony with a tax: every change touches two files, and the interface is a lie waiting to drift from the impl. The honest rule: an abstraction must earn its keep — a second implementation, a test double, or a contract boundary with an external system. Otherwise write the concrete class and inject its dependencies.

### Liskov — the one that actually breaks in production

LSP is where definitions die, because the violation is invisible in code review and detonates at runtime inside a `HashMap`. The contract: a subtype must be usable wherever its supertype is promised — **preconditions not strengthened, postconditions not weakened, invariants preserved.** Two production-grade examples.

**The equals-symmetry trap.** Add state to a subclass and `equals` silently becomes asymmetric, corrupting `Set`/`Map` behavior:

```java
class Point {
    final int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
    @Override public boolean equals(Object o) {
        return o instanceof Point p && p.x == x && p.y == y;
    }
    @Override public int hashCode() { return 31 * x + y; }
}

class ColoredPoint extends Point {
    final Color color;
    ColoredPoint(int x, int y, Color c) { super(x, y); this.color = c; }
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint)) return false;   // ← asymmetry
        return super.equals(o) && ((ColoredPoint) o).color == color;
    }
}

Point p = new Point(1, 2);
ColoredPoint cp = new ColoredPoint(1, 2, Color.RED);
p.equals(cp);   // true — Point ignores color
cp.equals(p);   // false — ColoredPoint demands color → symmetry broken
```

```java
// RIGHT — composition instead of inheritance: ColoredPoint is NOT a Point,
// it HAS a Point. No subtype, no broken contract, no surprise in a HashSet.
record ColoredPoint(Point point, Color color) {}
```

**Covariance and contravariance.** LSP leaks into the type system. Arrays are **covariant and reified** — `Object[]` can hold a `String[]`, and the error shows up at runtime:

```java
Object[] objs = new String[10];
objs[0] = 42;                 // compile: fine → runtime: ArrayStoreException
```

Generics are **invariant** — the compiler stops the same bug before it ships:

```java
List<String> words = new ArrayList<>();
List<Object> objects = words;               // compile error — invariant
List<? extends Object> any = words;         // covariance via bounded wildcard (read-only)
List<? super String> sink = new ArrayList<Object>();  // contravariance (write-only)
```

Remember **PECS** — producer `extends`, consumer `super` — and say out loud that a `List<Dog>` is not a `List<Animal>` even though `Dog` is an `Animal`: "is-a" on types does not carry over to generic containers, because a mutable container's contract ("you may add any `Animal`") would be weakened by the subtype.

**The throwing subtype.** A subclass that overrides a method to throw — "I'll just make `add()` throw for this special collection" — violates LSP by strengthening the precondition. The right shape is a **decorator** (`Collections.unmodifiableList`) that fails fast and loudly, not a subtype that pretends to be mutable. Interviewers probe this with: "how do you make an immutable list without breaking the contract?"

### Single Responsibility and Interface Segregation — the God object's obituary

These two are one idea at different granularities: **SRP is about classes, ISP about interfaces, and both are about "one axis of change."** A 500-line `OrderService` that is repository, validator, orchestrator, and mapper changes for four reasons and is impossible to reason about. A 40-method `UserService` interface forces every implementer to stub 35 methods — and worse, forces every _caller_ to see 40 capabilities it must not use.

```java
// WRONG — a single fat interface. Every implementer stubs 35 methods;
// every caller depends on 40 capabilities.
interface UserService {
    User findById(long id);
    void update(User u);
    byte[] exportAuditReport(Period p);      // why is this here?
    void sendWelcomeEmail(long id);          // or this?
    List<User> search(String q, Page p);
    // ... 35 more
}

// RIGHT — role interfaces. A caller depends on the slice it needs; a class
// implements several roles and no method is dead weight.
interface UserReader   { User findById(long id); }
interface UserWriter   { void update(User u); }
interface AuditExporter { byte[] exportAuditReport(Period p); }

class UserServiceImpl implements UserReader, UserWriter, AuditExporter { ... }
```

> What interviewers actually probe: "here's a 400-line service — how do you know it's wrong before you read line 300?" The senior answer isn't the interface; it's naming the **three axes of change** in it. If you can list them, SRP is not a slogan.

## 2. Composition over inheritance — the fragile base class, in the wild

"Why favor composition?" The junior answer is "inheritance is bad." The senior answer is one incident: a change to the parent silently broke fifty subclasses that assumed things about `super` the parent never promised.

The fragile base class problem is structural, not stylistic. Inheritance couples you to the parent's **implementation**, not its contract: you inherit `protected` fields, you call `super`, and the parent's methods invoke hooks (`afterPut`) in an order the subclass didn't write. The base class can't change its internals without risking every subclass, and the subclass can't reason about its own behavior without reading the parent. They are welded at the ribs.

```java
// WRONG — a base class full of hidden coupling. MetricsCounter trusts that
// afterPut is called exactly once per put, in order. The next release of
// AbstractCache adds a second hook, reorders the calls, or skips afterPut on
// dedup — and MetricsCounter silently counts wrong. Nobody's code "changed."
abstract class AbstractCache {
    private final Map<String, byte[]> store = new HashMap<>();
    public final void put(String k, byte[] v) {
        store.put(k, v);
        afterPut(k, v);
    }
    protected void afterPut(String k, byte[] v) {}
}

class MetricsCounter extends AbstractCache {
    @Override protected void afterPut(String k, byte[] v) { metrics.increment("puts"); }
}

// RIGHT — behavior is assembled, not inherited. The decorator wraps the
// delegate and the caller picks the stack. No subclass depends on another
// class's internals; every behavior is testable in isolation.
interface Cache { void put(String k, byte[] v); }

class MetricCache implements Cache {
    private final Cache delegate;
    MetricCache(Cache delegate) { this.delegate = delegate; }
    public void put(String k, byte[] v) {
        long start = System.nanoTime();
        delegate.put(k, v);
        metrics.record("cache.put.ns", System.nanoTime() - start);
    }
}

Cache cache = new MetricCache(new TtlCache(new MemCache()));
```

Inheritance also breaks at the contract level: `ColoredPoint extends Point` (section 1) is an inheritance problem hiding as an equals problem — adding state to a subclass is the single most common way to violate LSP without noticing. And the `Stack extends Vector` fiasco is the textbook case: a stack is _not_ a vector, and inheriting `add(int, E)` lets callers insert into the middle of a stack. "Is-a" must hold in the real world, not just in the UML diagram.

**When inheritance is right** — say this out loud, it's the differentiator. Inheritance is a tool, not a sin. Use it when the subclass is a genuine specialization that provides **hooks, not behavior**: Template Method. `JdbcTemplate` letting you supply a `RowMapper`, Spring's `AbstractMessageConverter` letting subclasses fill in `supports`/`writeInternal`, `HttpServlet` overriding `doGet`. The parent owns the flow (the skeleton) and the subclass fills the slots, and the parent's contract is explicit. The failure mode is the opposite: a subclass that _overrides whole methods_ and then calls `super` on them is fighting the parent, and that's the smell.

**The honest cost of composition.** Don't oversell it: wrapping means delegation boilerplate, deeper stack traces, and a runtime graph that's hard to trace ("which of these five decorators dropped my cache line?"). The senior tradeoff is granularity — compose where the axis changes, delegate where the flow is fixed, and never decorate for decoration's sake.

## 3. Interface design at scale — polymorphism beyond the textbook

A junior sees an interface as "a class template." A senior sees an interface as a **contract with an owner** — and modern Java changed what that contract can express.

### Sealed types — the closed world, enforced by the compiler

Before Java 17, polymorphism was open by default: anyone could add a `Shape`, and the `instanceof` chain (or `if/else` tower) kept growing. **Sealed interfaces** (Java 17) close the world deliberately, and **pattern matching** (Java 21) makes dispatch exhaustive and checked at compile time:

```java
sealed interface OrderEvent permits OrderPlaced, OrderPaid, OrderCancelled {}
record OrderPlaced(Long orderId, Instant at) implements OrderEvent {}
record OrderPaid(Long orderId, Money amount) implements OrderEvent {}
record OrderCancelled(Long orderId, String reason) implements OrderEvent {}

String label(OrderEvent e) {
    return switch (e) {
        case OrderPlaced p    -> "placed at " + p.at();
        case OrderPaid p      -> "paid " + p.amount();
        case OrderCancelled c -> "cancelled: " + c.reason();
        // no default needed — the compiler proves the switch is exhaustive
    };
}
```

`label` dispatches on **shape** (which record it is), not on a `type` field — and the compiler eliminates the "missed a case" bug that a `type` enum plus `if/else` always carried. Sealed hierarchy + records + pattern matching is Java's answer to algebraic data types, and it beats both the stringly-typed dispatch and the strategy-registry-as-ceremony in the common case.

The senior distinction (echoing section 1): **sealed = closed world, stable algebra, compile-time exhaustiveness.** Strategy/plugin/`ServiceLoader` = **open world, pluggable variants, runtime registration.** When an interviewer says "design the event handling," the differentiator is _who_ gets to add a variant and _when_ it must be caught — compile time or deploy time.

### Records, value objects, and the equality contract

A `record` (Java 16+) is a class whose identity contract is **all components** — `equals`/`hashCode`/`toString`/accessors derived from the component list, `final` by construction. That makes records the natural home for value objects, and value objects with _pure_ behavior are exactly right:

```java
record Money(long cents) {
    Money { if (cents < 0) throw new IllegalArgumentException("negative money"); }  // invariant in the constructor
    Money add(Money o)  { return new Money(cents + o.cents); }
    boolean isNegative() { return cents < 0; }
    @Override public String toString() { return "%d.%02d".formatted(cents / 100, cents % 100); }
}
```

The senior nuance on "records carrying logic": the real smell is a record coordinating **stateful** or cross-object business rules. A `Money` that validates its invariant and defines its arithmetic is a _good_ record; an `OrderPlaced` event that reaches out to a repository is a _bad_ one. Keep coordination in services; keep values in values.

And the tradeoff people miss: a record's equality is by **all fields**, which is the right default for value semantics and the wrong default for entities. An `Order` that is "the same order" by `id` even when fields changed must **not** be a record — its equality must be hand-written over the business key, or it will corrupt `Set`s and `Map`s. Same LSP lesson as `ColoredPoint`, mirrored.

## 4. Tell, don't ask — encapsulation has a database bill

"Tell, don't ask" sounds like style advice. At senior level it's a **performance and correctness** principle, because a getter is not free — it can be a lazy-loaded proxy that fires a query.

Feature envy is the symptom: a caller that reaches through an aggregate, pulls its collections, and computes with them. That is both a design smell and an N+1 query factory.

```java
// WRONG — the caller reached INTO the order and computed with its innards.
// order.getItems() is a lazy-loaded collection: this fires one SELECT per
// order. 1,000 orders → 1,001 queries. Fine with 5 rows in tests; dies in
// prod with a million — and no single query looks slow, so it survives every
// slow-query log.
long totalItems = 0;
for (Order order : orders) {
    totalItems += order.getItems().size();
}

// RIGHT — the aggregate answers the question. One intent, no reach-in.
long totalItems = 0;
for (Order order : orders) {
    totalItems += order.getLineItemCount();
}
```

But "tell, don't ask" alone is not enough — a naive `getLineItemCount()` may still lazy-load the whole collection. The senior fix is deciding **which layer answers the question**. The database counts faster than the JVM can load:

```sql
-- the same question, answered by the database in one round trip.
-- A point lookup is a B+tree walk: 3–4 page fetches, ~100 ns each when the
-- pages are hot in the buffer pool → sub-millisecond. The N+1 version above
-- was 1,001 network round trips × ~1 ms each ≈ a full second of latency
-- that never appears in any single slow-query log.
SELECT o.id, COUNT(li.id)
FROM orders o
LEFT JOIN line_items li ON li.order_id = o.id
GROUP BY o.id;
```

```java
// RIGHT — project the DTO you actually need; don't load the entity graph.
@Query("select new OrderSummary(o.id, o.customerName, size(o.items)) from Order o")
List<OrderSummary> findAllSummaries();
```

> What interviewers actually probe: they hand you a `for` loop calling `getItems()` and ask "how many queries does this make, and where does the time go?" The senior answer connects the design smell (feature envy, Law of Demeter) to a concrete number (1,001 queries, ~1 s extra) and then fixes the _layer_, not the loop.

### The resource behind the method call

Every `repository.findById` is a claim on a bounded resource — a connection-pool slot and a worker thread — so interface design has a concurrency bill too. Size the pool with Little's law, the same way you size a thread pool: `pool_size = throughput × per-call time`. At 2,000 req/s with 25 ms average DB time, that's 50 connections — not "200 because the box has 64 cores." A design that chases getters across aggregates spends that pool ten times faster than a design that answers one aggregate question per call. The N+1 above isn't just slow — it's a connection-pool burnout vector, because each lazy load holds a connection while it re-queries. The bounded resource is the real subject; the getter chain is just how you overspend it.

## 5. The functional-Java trap — when OOP, when functional, and what it costs

"OOP is dead, long live functional programming" is a red flag. So is "OOP forever, streams are unreadable." The senior position: **they are different tools for different invariants.**

- **Streams / functional composition** for data **transforms** — pipelines over collections, mapping/filtering/reducing — where the data is transient and there is no state to protect.
- **OOP / encapsulation** for **behavior-rich state** — aggregates, money, orders, caches — where the invariant ("an order can't be paid twice," "a connection is either open or closed") lives behind methods, not exposed fields.

The anti-pattern to name is the **anemic domain model**: entities reduced to getters/setters with all logic hoisted into `*Service` classes. It's convenient for JPA and comfortable for beginners, but the invariants stop living anywhere — `setStatus(CANCELLED)` works on a shipped order, `balance` can go negative, and the "rules" are scattered across twelve services. The senior move isn't "make everything rich" (persistence mapping fights you); it's **guarding the state transitions that matter**:

```java
// WRONG — the invariant lives in nobody's code. Any caller can do this:
order.setStatus(OrderStatus.CANCELLED);
order.setPaidAt(null);

// RIGHT — the transition is a method that enforces the rule.
order.cancel("out of stock");   // throws if already shipped, sets cancelledAt
order.pay(amount);              // throws if already paid
```

### What the functional style actually costs — the numbers

It's fashionable to say "streams are free." Almost true — and here is why, with the numbers interviewers respect:

```
The pipeline allocates: a Stream, lambdas, a Spliterator, an accumulator
ArrayList. That sounds wasteful — but allocation on a modern JVM is a TLAB
pointer bump (no lock, no system call), so the JVM happily does tens of
millions of throwaway allocations per second. Escape analysis lets the JIT
scalar-replace the short-lived objects, and young-gen GC copies only the
surviving ~10%, so the pause is dominated by live bytes copied, not by the
transforms. Net: a clean stream chain is effectively free against the pause
budget. The GC tax you actually fear comes from objects that escape into
long-lived collections — i.e., a design that *retains* what a transform
produced.
```

The real cost of abstraction isn't GC — it's **dispatch**. A monomorphic call site (one concrete receiver type) is inlined by the JIT, and the "interface call" costs nothing. A **megamorphic** site (a hot loop dispatching over many implementers — say, the strategy registry from section 1) costs ~3–5 ns per call **and blocks inlining of the body**, which can cost 10× more than the dispatch itself. That's why an interface with 40 implementers is also a JIT problem, not just a design smell. `-XX:+PrintInlining` is the tool that proves it. "How expensive is an interface call?" → "inline-able: ~free; megamorphic: a few ns plus a missed optimization — and the missed optimization is the real bill."

And one API-design trap to name: `Optional`/`Stream` as a substitute for a clear contract. `Optional<List<T>>` is a type-level lie — an empty list already encodes "none" — and `null` returns hide bugs. The return type _is_ part of your API; design it the way you design the interface. Make the empty case explicit, never ambiguous.

## 6. Production failure modes of "clean code"

The deepest senior trap is applying design principles so zealously that they become the incident. Interviewers love this section because everyone has seen the aftermath.

- **Premature abstraction.** The three-layer tower for a lookup: `Controller → Service interface → Service impl → Mapper interface → Mapper impl → Repository`, where the service has one method and one caller. Every change now touches five files, and the interfaces are lies. The rule of thumb: **an abstraction earns its keep** — one consumer, zero test doubles, and no second impl on the roadmap means delete the interface, not add a sixth layer. Adding abstraction is debt you take on, not a virtue you apply.

- **Circular dependency as an architecture smell.** Two packages that import each other — `orders` needs `payments`, `payments` needs `orders` — is not a Spring config problem, it's a missing boundary. The fix is DIP at the _module_ level: the higher-level concept (the domain) declares a port, and the other implements it. If you find yourself describing "we fixed the cycle with Spring `@Lazy`," the cycle is still there — you just stopped noticing.

- **Unguarded invariants.** The flip side of the anemic model: a "rich" aggregate whose setters are `public` so the ORM can hydrate it — which means every caller can also mutate it. The senior move is explicit transitions (section 5) and/or making the state immutable once constructed. An invariant nobody enforces is not a design; it's a bug farm.

- **The flexible API that's unconstrainable.** "Let's be flexible: a generic `process(Map<String, Object> params)`." Now every caller invents its own keys, typos pass silently, and there is no compile-time contract at all. Type-safety is a feature of an interface; the moment you accept `Map<String,Object>`, you've traded the compiler's help for a runtime `ClassCastException` farm. A senior _narrows_ interfaces; it never widens them.

- **Interfaces that drift from the code.** The `UserService` interface whose impl gained ten methods that were never added to the interface — callers end up casting or using reflection. If the interface isn't the only entry point, the abstraction is decorative. Delete it or make it real.

## 7. Self-check

- [ ] Apply OCP to a feature request without editing the old class — and name when OCP is the wrong tool.
- [ ] Explain DIP with the "who owns the contract" framing, a Spring example, and the interface-explosion counter-trap.
- [ ] Show the `ColoredPoint` equals trap, and why `List<Dog>` is not a `List<Animal>`.
- [ ] Give a real case where inheritance bit you (fragile base class) and the composition fix.
- [ ] Contrast sealed + pattern matching vs a strategy registry — when is each right, and who adds the 4th variant?
- [ ] When is a record the right value object, and when does it violate the equality contract?
- [ ] Count the queries in a `getItems()` loop, and fix it at the right layer (SQL vs DTO projection).
- [ ] Explain what a megamorphic call site costs, and how to prove it with `-XX:+PrintInlining`.
- [ ] Find the anemic domain model in a snippet and guard the invariant that matters.
- [ ] Name three ways "clean code" turns into a production incident.

## 8. Interviewer follow-ups

When your first answer lands, they start drilling. Be ready for these:

- "We add a 5th payment method next sprint. Walk me through the exact files you touch — and why that design was the right axis."
- "You injected `PaymentGateway`. Who wrote that interface, and what happens when Stripe changes their SDK?"
- "`ColoredPoint extends Point` — find the bug in 30 seconds. Now fix it without breaking `HashSet<Point>`."
- "Is `Stack` a bad `Vector` subclass? What's the general rule that catches it?"
- "Sealed interface with three records, or a strategy map with three handlers — which do you build, and who adds the 4th variant?"
- "Your `record Money` has `add`. Why is that a good record, if 'records with logic are a smell' is too simple?"
- "This loop calls `order.getItems()` a thousand times. Count the queries, and tell me where the second is actually spent."
- "You claim abstraction is nearly free at runtime. Prove it — what does the JIT do to a monomorphic call site, and what breaks inlining?"
- "Your `OrderService` is 400 lines with five responsibilities. What do you extract first, and why does the order matter?"
- "Every change to `BaseRepository` breaks three subclasses. Rebuild it — but don't tell me inheritance is evil."

That's the OOP bar for senior.
