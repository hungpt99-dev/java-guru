---
title: "OOP, SOLID & Design Patterns: Engineering Judgment for Real Java Code"
description: "A problem-first guide to OOP, SOLID and Design Patterns in Java. Learn how to recognize design pressure in real code, refactor toward better structure, and — just as importantly — know exactly when NOT to apply a principle or pattern."
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

Your `PaymentService` starts as 50 lines of code. It reads a payment type,
charges the customer, saves the receipt. Clean. Simple.

Then the business adds credit cards. Then bank transfers. Then e-wallets.
Then crypto. Then refunds. Then retry logic. Then notifications. Then audit
logging. Then a second payment provider. Then a third.

Eighteen months later, `PaymentService` is 1,500 lines. Every deployment
touches it. Every bug report lands in it. The pull request that added PayPal
broke card payments, because both branches lived in the same method and the
new `else if` was placed before the one that handled `CARD` in a way nobody
noticed.

Nobody decided to make this class bad. Every single change was reasonable
at the time it was made. That is the uncomfortable truth this article is
built around:

> **Bad design is almost never a single bad decision. It is the accumulated
> result of many individually reasonable decisions made under pressure.**

This is not another SOLID tutorial. You already know the vocabulary — "SOLID
means Single Responsibility, Open/Closed..." — and the generic examples that
come with it (`Animal`, `Dog`, `Cat`, `Shape`, `Circle`). That knowledge is
not what is missing.

What is missing is **engineering judgment**: the ability to look at a real
codebase, feel where the design pressure is, choose the right technique —
and refuse the techniques that would make things worse. So this article
follows one learning flow, over and over:

```text
Problem
   ↓
Bad Design
   ↓
Why It Is Bad
   ↓
Principle / Pattern
   ↓
Refactoring
   ↓
Trade-offs
   ↓
Special Cases (when NOT to do it)
```

Every concept is introduced because a concrete scenario breaks without it —
not because the concept exists in a textbook. The domain stays consistent
throughout: payments, orders, notifications, repositories. You will see bad
code first, then the pressure it creates, then the refactoring, then the
price of the refactoring.

Here is the whole article in one question:

> **Every time you add an interface, a class, or a pattern, you are spending
> something (indirection, indirection, indirection). What problem is the
> spending solving?**

---

## 1. The Problem That Starts Everything

Go back to the opening story. Let us watch `PaymentService` grow, because
every principle in this article exists to answer the question: _where did
this go wrong?_

**Month 1.** One payment method. The service is a straight line:

```java
public class PaymentService {
    public void pay(Order order, CardDetails card) {
        validateCard(card);
        chargeCard(card, order.getTotal());
        saveReceipt(order, "PAID");
        sendConfirmationEmail(order);
    }
}
```

**Month 4.** The business adds bank transfers and e-wallets. Reasonable
reactions, one by one:

- "A new payment type means a new branch — that's fine, it's just two more
  lines."
- "Refunds? Add a `refund()` method with a `switch` on the type."
- "Retry? Wrap the call in a loop. Keep it simple."
- "Email? The same `sendConfirmationEmail` logic is needed by both payment
  paths — move it to a private method."
- "Audit logging? It's just `logger.info(...)` on every entry and exit."
- "A second provider? Inline the new SDK calls next to the old ones — we
  can extract that later."

**Month 18.** The class looks like this:

```java
public class PaymentService {
    public void pay(Order order, PaymentRequest request) {
        // 40 lines of validation for 6 payment types
        // 90 lines of branch logic (CARD, BANK_TRANSFER, E_WALLET, CRYPTO)
        // 30 lines of retry logic duplicated for 2 providers
        // 50 lines of email logic
        // 25 lines of audit logging
        // 20 lines of receipt persistence
        // 15 lines of exception translation
        // ...
    }

    public void refund(Payment payment, BigDecimal amount) {
        // another 200 lines, half of it copied from pay()
    }

    // 900 more lines: private helpers, provider-specific quirks,
    // special cases for crypto confirmations, error codes, ...
}
```

1500 lines. Here is the question you must learn to ask — because it is the
question that separates knowing about SOLID from being able to use it:

> **What actually went wrong?**

Not "what should we have done instead" — what _went wrong_? Which concrete
symptoms tell you this class has a design problem, as opposed to just being
long?

Look closely at the list of symptoms:

| Symptom                                         | What it tells you                                  |
| ----------------------------------------------- | -------------------------------------------------- |
| One class changes for many different reasons    | Several responsibilities share one file            |
| Adding a payment type means editing `pay()`     | The variation point is inside an `if/else` chain   |
| Duplicated retry/email/audit code               | Cross-cutting behavior is woven into business code |
| A change to provider A breaks provider B        | Branches are coupled through shared mutable state  |
| Testing `pay()` needs a real DB, email, SDK     | Dependencies are hardwired, not injected           |
| You can't say what `pay()` does in one sentence | Too many things are happening per method call      |

Each symptom maps to a principle in this article. The table will fill in as
we go — keep it in mind, because the refactoring case study in Part VI walks
through fixing this exact class, one symptom at a time.

But before the principles, we need the raw material: the four OOP concepts
that everything else is built on. Not as definitions — as mechanisms that
either protect your system or betray it.

---

## 2. Part I — OOP: More Than Classes and Objects

You know the syntax of classes, objects, inheritance, interfaces. What this
part is really about is what those mechanisms _do_ — the protections they
provide, the failure modes they create, and the judgment involved in using
them. Four concepts, four engineering questions:

| Concept       | The engineering question                     |
| ------------- | -------------------------------------------- |
| Encapsulation | Who is allowed to touch this state, and how? |
| Abstraction   | What should callers know about the inside?   |
| Inheritance   | Is this really an "is-a" relationship?       |
| Polymorphism  | Who decides which behavior runs?             |

### 2.1 Encapsulation: Protecting Invariants, Not Hiding Fields

Most Java developers believe encapsulation means `private` fields plus
getters and setters. It does not. `private` is the _mechanism_; encapsulation
is the _outcome_. The outcome is that an object's state always satisfies its
rules — no matter what code touches it.

**Bad design first.** Here is a `BankAccount` that compiles, is "encapsulated"
by the letter of the rule, and is completely broken:

```java
public class BankAccount {
    public BigDecimal balance;
    public BigDecimal creditLimit;

    public BankAccount(BigDecimal balance, BigDecimal creditLimit) {
        this.balance = balance;
        this.creditLimit = creditLimit;
    }
}
```

The fields are public, so any caller can do this:

```java
BankAccount account = new BankAccount(BigDecimal.ZERO, BigDecimal.valueOf(100));

// no check, no error — the account is now 50 in the red past its limit
account.balance = account.balance.subtract(BigDecimal.valueOf(150));

// negative deposit — the "balance" can be manipulated arbitrarily
account.balance = account.balance.negate();

// and now the invariant "balance respects credit limit" is destroyed
account.creditLimit = null;   // the next check, wherever it is, will NPE
```

**Why it is bad.** The moment `balance` and `creditLimit` are exposed as
mutable fields, the class has no way to enforce its own business rules. The
invariant _"the balance may never go below the negative credit limit"_ is no
longer a property of the account — it is a hope. Every caller must remember
to check it, and the first caller who forgets corrupts the state for
everyone.

**The principle.** An object is a guardian of its own rules. The fields
exist, but every mutation goes through a method that enforces the
invariants — the conditions that must always be true for the object to be
valid:

```java
public class BankAccount {
    private BigDecimal balance;                    // never null, >= -creditLimit
    private final BigDecimal creditLimit;          // immutable once set

    public BankAccount(BigDecimal balance, BigDecimal creditLimit) {
        if (balance == null || creditLimit == null) {
            throw new IllegalArgumentException("balance and creditLimit are required");
        }
        if (creditLimit.signum() < 0) {
            throw new IllegalArgumentException("credit limit cannot be negative");
        }
        this.balance = balance;
        this.creditLimit = creditLimit;
    }

    public void withdraw(BigDecimal amount) {
        requirePositive(amount, "withdrawal amount");
        BigDecimal newBalance = balance.subtract(amount);
        if (newBalance.compareTo(creditLimit.negate()) < 0) {
            throw new InsufficientFundsException(
                "withdrawal exceeds available credit: " + amount);
        }
        balance = newBalance;
    }

    public void deposit(BigDecimal amount) {
        requirePositive(amount, "deposit amount");
        balance = balance.add(amount);
    }

    public BigDecimal getBalance() {
        return balance;
    }

    public BigDecimal getCreditLimit() {
        return creditLimit;
    }

    private static void requirePositive(BigDecimal value, String what) {
        if (value == null || value.signum() <= 0) {
            throw new IllegalArgumentException(what + " must be positive: " + value);
        }
    }
}
```

Now the invariants are _enforced by the only object that can change the
state_. Notice two important details:

- `creditLimit` is `final` and has no setter. There is no business rule that
  changes it, so the class does not allow it to change.
- The methods validate _before_ mutating. `withdraw()` checks the result
  against the invariant _before_ assigning it.

This is what encapsulation actually means:

> **Encapsulation is about protecting invariants, not simply hiding fields.
> `private` gives you the ability to protect them; it does not do the
> protecting itself.**

**Encapsulation leaks: the getter trap.** Here is the most common way
encapsulation fails even in disciplined code. The class keeps its fields
private, but its getter hands out the internal object:

```java
public class BankAccount {
    private final List<Transaction> transactions = new ArrayList<>();

    public List<Transaction> getTransactions() {   // the leak
        return transactions;
    }
}
```

Any caller can now do `account.getTransactions().clear()` or add a forged
transaction — the internal state is mutated behind the class's back, and
nothing the class does can prevent it. The class _looks_ encapsulated and is
not. Two fixes, with different trade-offs:

```java
// Fix A: return an unmodifiable view — cheap, but callers can still
// see the contents and callers can still hold the reference
public List<Transaction> getTransactions() {
    return Collections.unmodifiableList(transactions);
}

// Fix B: return a copy — expensive for large lists, but the caller
// can never observe or affect future changes
public List<Transaction> getTransactions() {
    return new ArrayList<>(transactions);
}
```

**Defensive copying goes both ways.** The same leak exists in the other
direction: a constructor that stores the _caller's_ mutable object. If you
hold a reference to an object the caller can still mutate, the caller can
change your object's state through the back door:

```java
public class BankAccount {
    private final Address billingAddress;   // Address has setters

    public BankAccount(Address billingAddress) {
        this.billingAddress = billingAddress;   // LEAK: caller still holds it
    }
}
```

The fix is to copy on the way in:

```java
public BankAccount(Address billingAddress) {
    this.billingAddress = new Address(billingAddress);   // defensive copy
}
```

**Mutable objects vs immutable objects.** Notice a pattern in everything
above: the problems come from _mutability_. If `Address`, `Transaction`, and
`BigDecimal` were immutable — their fields `final`, no setters, no way to
change after construction — most leaks and defensive copies disappear.

There is a reason `BigDecimal` (and not `double`) was used throughout this
example: money must never lose precision, and a value type that cannot
change protects every invariant that depends on it. The general rule:

> **Make objects immutable unless you have a demonstrated reason to mutate
> them.** Every setter you remove is a class of bugs you can no longer write.

**When defensive copying and immutability are not worth it.** Performance
criticism of immutable objects is mostly theoretical until it is not:
copying a 10,000-element list on every getter call is real cost. If the
collection is huge and read in hot paths, an unmodifiable _view_ (Fix A)
gives most of the safety at zero copy cost. Similarly, immutable "value
objects" built from many fields become constructor soup — that problem has
its own solution, and you will meet it in the Builder section (Part III).

**Summary of the trade-off.** Encapsulation spends a little ceremony
(validation methods, copies, immutability) to buy state integrity. The
special case is simple: the smaller and more local the state, the less
encapsulation machinery you need — a `private` field inside a 20-line
`public` method's own class rarely needs defensive copies.

### 2.2 Abstraction: What Should Callers Know About the Inside?

Encapsulation is about _state_; abstraction is about _behavior_. The
question is: what contract do you expose to callers, and what do you hide?

**The right question about abstraction.** An interface in Java is a promise
about _behavior_, not about _structure_: "any object that implements this
can do X." The design question is what `X` should be. Get it wrong in one
direction and callers are coupled to your implementation details; get it
wrong in the other and the abstraction costs more than it returns.

**Leaky abstraction.** Consider the classic backend boundary: paying through
a third-party gateway. Here is an interface that _looks_ abstract and is
leaking details from underneath:

```java
public interface PaymentGateway {
    // "token" is a card-specific concept; "brand" too
    PaymentResult chargeWithToken(String token, String brand, BigDecimal amountCents);
    void refundViaChargeId(String chargeId);
    String getProviderName();          // who needs this?
}
```

Why is this leaky?

- `token` is a credit-card concept. A bank-transfer implementation has no
  token; an e-wallet has a user id. Every implementation must pretend its
  world fits the card-shaped hole.
- `amountCents` is a provider convention (many SDKs count cents). The domain
  deals in `BigDecimal` amounts; the conversion belongs _inside_ the
  adapter, not in every caller.
- `getProviderName()` exposes provider identity — which invites callers to
  write `if (gateway.getProviderName().equals("STRIPE"))`, and then the
  interface is decoration and the real logic is back in the callers.

The interface has failed: it abstracts _one implementation's vocabulary_ and
calls it a contract. The telltale sign of a leaky abstraction is the
`if (implementation == concreteOne)` in client code, or a parameter that
only one implementation can meaningfully fill.

**A cleaner abstraction.** The interface should speak the domain's language
and hide everything else:

```java
public interface PaymentGateway {
    PaymentResult pay(PaymentRequest request);
}
```

with domain types:

```java
public class PaymentRequest {
    private final String orderId;
    private final BigDecimal amount;
    private final String currency;
    private final PaymentMethod method;   // card token, bank account, wallet id...

    // constructor + getters
}

public class PaymentResult {
    private final String providerReference;   // provider-specific id, hidden here
    private final boolean success;

    public static PaymentResult success(String providerReference) { ... }
    public static PaymentResult failure(String reason) { ... }
    // getters
}
```

Now `CardGatewayImpl`, `BankGatewayImpl`, and `WalletGatewayImpl` are all
free to interpret `PaymentMethod` their own way, and every caller — the
payment service, the refund service, the reporting job — only ever sees
`PaymentRequest` and `PaymentResult`. The provider vocabulary (tokens,
charges, transfers, settlements) stays inside the implementations. This is
the shape of the **Adapter pattern**, which gets its own section in Part
III, and the **Dependency Inversion principle**, in Part II — abstraction
and dependency direction are two sides of the same decision.

**What should be abstracted, and what should not.** Here is the judgment:

```text
SHOULD be abstracted:
  - Variation points (you expect multiple implementations)
  - External boundaries (SDKs, databases, files, queues, time, random)
  - Volatile details (things that change faster than their callers)

SHOULD NOT be abstracted:
  - Internal helpers with a single implementation
  - Things that change together with their callers
  - Hypothetical futures you have not seen yet
```

The word to internalize is _volatility_: abstraction is a bet that the
hidden part will change more often — or have more variants — than the
visible part. If both sides change at the same rate for the same reason,
the interface between them is bureaucracy, not architecture.

**Premature abstraction.** The clearest symptom of premature abstraction is
an interface with exactly one implementation, created because "we might need
another one someday," plus a factory that exists only to look up the one
implementation:

```java
public interface EmailSender {
    void send(Email email);
}

public class SmtpEmailSender implements EmailSender { ... }

public class EmailSenderFactory {
    public EmailSender create() {
        return new SmtpEmailSender();       // the factory has nothing to decide
    }
}
```

Nothing here is _wrong_ — but nothing here is _earned_ either. The callers
could use `SmtpEmailSender` directly. The `EmailSender` interface and its
factory add two indirections that solve zero problems. When the second
sender actually appears (a transactional API provider, a queue-based
sender), adding the interface is a small, mechanical refactoring that takes
minutes. The wasted months of indirection you pay now are not recovered
later. The judgment rule:

> **Abstract in response to a real variation, not in anticipation of one.
> The first implementation of anything is concrete; the interface appears
> when the second one exists — or is certain enough to be a requirement,
> not a guess.**

**The trade-off, summarized:**

```text
Too little abstraction → tight coupling; every change to an internal
                         detail ripples through all callers
Too much abstraction   → indirection with no payoff; callers must
                         navigate layers to find one implementation
```

The sweet spot is where the abstraction sits _at the boundary_ — between
modules that change independently — and nowhere else.

### 2.3 Inheritance: When "is-a" Is a Trap

Java gives you `extends` and `implements`. This section is about the one
that causes the trouble: class inheritance. The trouble is not syntax. It
is that inheritance forces a _taxonomy_ onto your code, and real-world
business rules do not usually form clean taxonomies.

**Bad design first.** A notification system. It starts simple:

```java
public class Notification {
    private final String recipient;
    private final String message;

    public Notification(String recipient, String message) { ... }

    public void send() {
        System.out.println("Sending email to " + recipient + ": " + message);
    }
}

public class EmailNotification extends Notification {
    private final String subject;

    public EmailNotification(String recipient, String message, String subject) {
        super(recipient, message);
        this.subject = subject;
    }

    @Override
    public void send() {
        System.out.println("Sending email [" + subject + "] to " + recipient);
    }
}
```

Looks reasonable. "An email notification _is a_ notification." Then the
business adds SMS:

```java
public class SmsNotification extends Notification {
    public SmsNotification(String recipient, String message) {
        super(recipient, message);
    }

    @Override
    public void send() {
        System.out.println("Sending SMS to " + recipient + " (truncated to 160 chars)");
    }
}
```

Then push notifications, then WhatsApp, then Slack. Each new channel is a
subclass. And then the problems start:

1. **The base class accumulates channel-specific cruft.** SMS has a
   160-character limit, WhatsApp needs a template id, Slack needs a channel
   name. Where do those fields live? The base `Notification` starts gaining
   optional fields (`templateId`, `channelName`, `attachment`) that only
   some subclasses use. The base class becomes the intersection of all
   channels — useless fields everywhere.

2. **Shared behavior is duplicated or misinherited.** "Retry failed sends"
   sounds like a base-class concern, so it goes into `Notification.send()`
   as a template. But SMS retry limits differ from email retry limits, and
   now overriding the retry logic means overriding `send()` — the thing the
   base class was supposed to centralize.

3. **Fragile base class.** Any change to `Notification` ripples into every
   subclass. One day someone adds a `getDeliveryStatus()` check into the
   base `send()` that assumes a synchronous channel — and the WhatsApp
   subclass, which is asynchronous, starts failing in production for reasons
   buried three levels up the hierarchy.

4. **The taxonomy collapses under LSP pressure.** The base class promises
   "sends a message." An `EmailNotification` can attach a file; an SMS
   cannot. A caller with a `List<Notification>` that calls `attachFile()`
   must `instanceof`-check every element — the polymorphic illusion is over.

**Why this happens.** The relationship looked like "is-a" but was really
"has-a / can-be-delivered-by." `EmailNotification` does not _become_
delivery — it _uses_ a delivery channel. The safe shape is composition:

```java
public class Notification {
    private final String recipient;
    private final String message;
    private final NotificationSender sender;   // has-a, not is-a

    public Notification(String recipient, String message, NotificationSender sender) {
        this.recipient = recipient;
        this.message = message;
        this.sender = sender;
    }

    public void send() {
        sender.send(recipient, message);
    }
}
```

Now `SmsSender`, `EmailSender`, `WhatsAppSender` implement the single small
interface `NotificationSender`. Adding a channel means adding a class and
composing it — the `Notification` class itself does not change, and the
channel-specific rules (SMS truncation, WhatsApp templates) live in the
classes that own them. The taxonomy is gone; the variations are data and
strategy, not subclasses.

**is-a vs has-a: the decision rule.** The distinction is not grammar — it
is _behavioral substitutability_. `X extends Y` claims: "any code that works
with a `Y` will work with an `X`." That is the Liskov Substitution
Principle, and it gets a full section in Part II. The practical test:

```text
Ask: does the subclass genuinely "work anywhere the parent works"?
  - An EmailNotification used where a Notification is expected: fine.
  - A NotificationSender used BY a Notification: also fine — but it is
    has-a, not is-a.
  - An SmsNotification where an EmailNotification is expected: NOT fine —
    the relationship was never a taxonomy.
```

**Why composition is usually safer.** Composition gives you four things
inheritance does not:

| Concern              | Inheritance                              | Composition                    |
| -------------------- | ---------------------------------------- | ------------------------------ |
| Reuse                | Inherited — reuse by ancestry            | Delegated — reuse by reference |
| Change ripple        | A base-class change hits all subclasses  | Only the composing class       |
| Runtime flexibility  | Fixed at compile time (which superclass) | Swappable at runtime           |
| Contract enforcement | Weak — subclasses can weaken behavior    | Strong — interface contract    |

**When inheritance is genuinely reasonable.** "Favor composition over
inheritance" is a rule of thumb, not a law. Inheritance earns its keep when:

- The hierarchy is **small, stable, and sealed** — Java's `sealed` keyword
  (Part VII) makes this explicit and safe.
- Subclasses **add behavior without weakening** the parent's contract —
  e.g., `ArrayList` style extensions, template-method skeletons where the
  steps are stable.
- The relationship is a **real taxonomy** — `RuntimeException extends
Exception`, `IOException extends Exception`: every catch site that handles
  `Exception` genuinely handles `IOException`, and the hierarchy has not
  grown for years.

The point is not "never inherit." The point is: **before you write
`extends`, you must be able to defend the substitutability claim** — because
that is what you are committing to.

### 2.4 Polymorphism: From `if/else` Chains to Dispatch — and Back

Polymorphism is the ability of different objects to respond to the same
message differently. Java gives you three mechanisms: interface/class
dispatch, overriding, and — modern Java — switch pattern matching and
lambdas. The question is when each is the right tool.

**Bad design first.** The payment dispatcher, grown organically:

```java
public class PaymentService {
    public PaymentResult pay(Payment payment) {
        if (payment.getType() == PaymentType.CARD) {
            return cardGateway.charge(payment.getReference(), payment.getAmount());
        } else if (payment.getType() == PaymentType.BANK_TRANSFER) {
            return bankGateway.transfer(payment.getReference(), payment.getAmount());
        } else if (payment.getType() == PaymentType.E_WALLET) {
            return walletGateway.pay(payment.getReference(), payment.getAmount());
        } else if (payment.getType() == PaymentType.CRYPTO) {
            return cryptoGateway.broadcast(payment.getReference(), payment.getAmount());
        } else {
            throw new UnsupportedPaymentTypeException(payment.getType());
        }
    }
}
```

**Why it becomes painful.** Every payment type added means editing this
method. The chain grows; branch order matters (`else if` placement bugs are
real — remember the PayPal story from the introduction); every caller of
`pay()` recompiles and retests; and the method becomes a switchboard where
all the _real_ logic is still inside the branches. The chain does not
_grow_ — it _deteriorates_.

**Refactoring toward polymorphism.** The shape of the fix: define the
behavior as a contract, let each variant implement it, and let the caller
ask for the right variant by type. The `PaymentStrategy` interface (full
treatment in Part III) is the vehicle:

```java
public interface PaymentStrategy {
    PaymentResult pay(Payment payment);
}
```

```java
public class CardPaymentStrategy implements PaymentStrategy {
    private final CardGateway cardGateway;

    public CardPaymentStrategy(CardGateway cardGateway) {
        this.cardGateway = cardGateway;
    }

    @Override
    public PaymentResult pay(Payment payment) {
        return cardGateway.charge(payment.getReference(), payment.getAmount());
    }
}
```

…and likewise `BankTransferPaymentStrategy`, `WalletPaymentStrategy`,
`CryptoPaymentStrategy`. The service becomes:

```java
public class PaymentService {
    private final Map<PaymentType, PaymentStrategy> strategies;

    public PaymentService(Map<PaymentType, PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentResult pay(Payment payment) {
        PaymentStrategy strategy = strategies.get(payment.getType());
        if (strategy == null) {
            throw new UnsupportedPaymentTypeException(payment.getType());
        }
        return strategy.pay(payment);
    }
}
```

What changed, concretely?

- **Adding a payment type = adding a class + registering it in a map.** The
  service and all existing strategies are untouched. This is the Open/Closed
  Principle (Part II) and it is why polymorphism exists in this story: the
  dispatch decision moved _out of_ the business flow into a structure
  (`Map` lookup) that cannot be mis-ordered or mis-placed.
- **Each variant owns its logic and can be tested alone.** A change to
  crypto settlement does not recompile — or re-risk — the card path.

**The middle ground: switch expressions and enum dispatch.** Before you
build a full strategy map, consider whether Java's own dispatch is enough.
If the per-type behavior is small and the types are stable, a switch
expression is honest, exhaustive, and much less machinery:

```java
public PaymentResult pay(Payment payment) {
    return switch (payment.getType()) {
        case CARD -> cardGateway.charge(payment.getReference(), payment.getAmount());
        case BANK_TRANSFER -> bankGateway.transfer(payment.getReference(), payment.getAmount());
        case E_WALLET -> walletGateway.pay(payment.getReference(), payment.getAmount());
        case CRYPTO -> cryptoGateway.broadcast(payment.getReference(), payment.getAmount());
    };
}
```

This is not "less pure polymorphism" — it is a _decision about the variation
point_. The switch is safe to the extent that the enum is sealed (it cannot
grow without your editing this method, which the compiler then reminds you
of via exhaustiveness). The strategy map is better when the branches are
_heavy_ — each with its own dependencies, its own lifecycle, its own
testing — or when strategies must be configurable/swappable at runtime.

**The special case: when a simple `if` is better than polymorphism.** This
is the section that most tutorials never teach. Consider:

```java
public class OrderPersistenceService {
    private final OrderRepository orderRepository;
    private final AuditLogger auditLog;

    public OrderPersistenceService(OrderRepository orderRepository, AuditLogger auditLog) {
        this.orderRepository = orderRepository;
        this.auditLog = auditLog;
    }

    public void persist(Order order) {
        if (order.getStatus() == OrderStatus.CANCELLED) {
            auditLog.record("cancelled-order-skip", order.getId());
            return;
        }
        orderRepository.save(order);
    }
}
```

Should this be a `CancelledOrderPersistenceStrategy` and a
`NormalOrderPersistenceStrategy` behind a `PersistenceStrategy` interface?
**No.** And not because it's small — because the two branches are not a
_family of interchangeable algorithms_. One is a guard clause; the other is
the actual operation. The variation here is a business rule ("cancelled
orders are not persisted"), and expressing it as a dispatch table would
make the code _harder_ to read by hiding the rule.

Polymorphism earns its cost when all of these hold:

1. The branches are **variants of one behavior** (ways of doing the same
   thing), not different things.
2. New variants are **expected** — the variation point is real, not
   hypothetical.
3. The branches are **big enough** that isolating them pays for the
   indirection (a one-line branch does not).

A two-branch, stable, small `if` is not a design debt. It is a design
decision. The debt is the _unbounded_ chain that grows with every business
request — and the skill is telling the two apart.

**The OOP part in one paragraph.** Encapsulation protects state and rules;
abstraction picks the contract at the boundaries; inheritance is only
warranted by substitutability; polymorphism moves dispatch out of the
business flow. Now take these four mechanisms and apply them to the five
principles that govern how classes and modules relate — SOLID.

## 3. Part II — SOLID: The Engineering Reasoning

SOLID is not a checklist. It is five answers to five different questions
about _change_:

| Principle | The question it answers                        |
| --------- | ---------------------------------------------- |
| S         | How many reasons may one class have to change? |
| O         | Which changes should not modify existing code? |
| L         | When may a subclass replace its parent?        |
| I         | Who should an interface serve?                 |
| D         | Which direction should dependencies point?     |

Every one of them is a judgment call about _volatility_ — what is likely to
change, how often, and who should absorb the change. None of them is an
absolute law. This part treats them one at a time, always in the same shape:
a real problem, the bad code, the pain, the principle, the refactoring, the
trade-offs, and when NOT to apply it.

### 3.1 S — Single Responsibility Principle: One Reason to Change

**The real problem.** Go back to the opening story. Here is the classic
`OrderService` — the class that does everything, and therefore changes for
everything:

```java
public class OrderService {
    private final OrderRepository orderRepository;
    private final EmailService emailService;
    private final PaymentService paymentService;

    public OrderService(OrderRepository orderRepository,
                        EmailService emailService,
                        PaymentService paymentService) {
        this.orderRepository = orderRepository;
        this.emailService = emailService;
        this.paymentService = paymentService;
    }

    public void placeOrder(Order order) {
        // 1. validation
        if (order.getItems().isEmpty()) {
            throw new IllegalArgumentException("order has no items");
        }
        if (order.getCustomer() == null || order.getCustomer().getEmail() == null) {
            throw new IllegalArgumentException("customer email is required");
        }

        // 2. pricing
        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.getItems()) {
            total = total.add(item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
        }
        if (total.compareTo(BigDecimal.valueOf(500)) > 0) {
            total = total.multiply(BigDecimal.valueOf(0.9));   // 10% discount over 500
        }
        order.setTotal(total);

        // 3. persistence
        orderRepository.save(order);

        // 4. payment
        paymentService.pay(order);

        // 5. email
        emailService.sendOrderConfirmation(order);

        // 6. logging
        logger.info("Order {} placed with total {}", order.getId(), order.getTotal());
    }
}
```

**Why it is painful.** Count the reasons this class can change:

- New validation rule ("customers with a blocked flag cannot order") — edit
  here.
- New pricing rule (member tiers, coupon codes) — edit here.
- The database schema or repository changes — edit here.
- The payment flow changes (refund-on-cancel, partial payments) — edit here.
- New email template or email service replacement — edit here.
- Logging/observability changes — edit here.

Six independent business decisions, one file. The consequences compound:

- **Every change retests everything.** A pricing fix must re-verify
  validation, persistence, payment, and email — because they share a method.
- **The class cannot be reused or understood partially.** No caller can
  say "validate this order" without the whole machinery being present.
- **Testing needs the whole world.** A unit test of `placeOrder` must mock
  repository, payment, and email — even to test pricing alone.
- **Bugs cross boundaries.** The classic example: an email outage takes down
  order placement, because email is not separable from the flow.

**The principle.** The real SRP is not "a class should do one thing" (every
useful class does many things) and definitely not "a class should have one
method." It is:

> **A class should have one reason to change.** A reason to change is a
> single actor or business function that can demand a change — the pricing
> rules, the payment providers, the email templates, the persistence
> schema. Each such reason deserves its own class.

**Refactoring.** Split along the _reasons to change_ — not along method
boundaries:

```java
public class OrderValidator {
    public void validate(Order order) {
        if (order.getItems().isEmpty()) {
            throw new IllegalArgumentException("order has no items");
        }
        if (order.getCustomer() == null || order.getCustomer().getEmail() == null) {
            throw new IllegalArgumentException("customer email is required");
        }
    }
}
```

```java
public class OrderPricing {
    public BigDecimal calculateTotal(Order order) {
        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.getItems()) {
            total = total.add(item.getPrice()
                .multiply(BigDecimal.valueOf(item.getQuantity())));
        }
        if (total.compareTo(BigDecimal.valueOf(500)) > 0) {
            total = total.multiply(BigDecimal.valueOf(0.9));
        }
        return total;
    }
}
```

```java
public class OrderService {
    private final OrderValidator validator;
    private final OrderPricing pricing;
    private final OrderRepository orderRepository;
    private final PaymentService paymentService;
    private final EmailService emailService;

    // constructor injection...

    public void placeOrder(Order order) {
        validator.validate(order);
        order.setTotal(pricing.calculateTotal(order));
        orderRepository.save(order);
        paymentService.pay(order);
        emailService.sendOrderConfirmation(order);
    }
}
```

Each class now has exactly one reason to change, can be tested in
isolation, and can be reused (the validator and pricer are usable by the
order-edit flow and the refund flow too). Notice what _did not_ happen: the
`OrderService` still orchestrates the flow — that is its job. SRP did not
turn it into an empty shell; it turned it into a _coordinator whose only
reason to change is the flow itself_.

**The difficult question: when are two responsibilities actually
different?** This is where SRP gets misused, and it deserves precision.
Responsibilities are different when they change **at different rates, for
different reasons, or by different actors**. The test:

```text
Ask: "If I change X, will I also want to change Y?"
  - Pricing rule changes and email template changes: different actors,
    different rates → different classes.
  - "Save order" and "load order by id": same actor, same rate, same data
    schema → same class (a repository), always.
  - Validation of an order before payment and before editing: same rule,
    same actor → do NOT split into OrderValidationService and
    OrderEditValidationService.
```

**Over-fragmentation: when splitting hurts.** The flip side of SRP is the
org-chart refactoring, where every responsibility gets not just a class but
a ceremony:

```java
OrderValidator
OrderValidatorImpl
OrderValidationService
OrderPricingCalculator
OrderPricingService
OrderPersistenceManager
OrderRepository
OrderRepositoryImpl
OrderPersistenceService
OrderProcessor
OrderCoordinator
OrderService
```

Ten classes, each two lines, linked by dependencies, with nothing to test
per class beyond "calls the next class." This is not SRP — it is **file
splitting**. The original `OrderService` was easier to understand because
the flow was visible in one place; the fragmentated version hides the flow
behind a dependency chain. The SRP test applies symmetrically:

> **A class has one reason to change — but it must also be a class that
> deserves to exist. If a "responsibility" has no rules, no state, and no
> behavior beyond forwarding, it is not a responsibility; it is a
> forwarding station.** Split when each piece carries real logic; coordinate
> when the pieces are trivial.

The judgment: SRP is about _change isolation_, not _class count_. Five
classes each with one genuine responsibility beat one class with five — and
beat twenty classes with none.

### 3.2 O — Open/Closed Principle: Protect the Variation Point

**The real problem.** Back to the payment dispatcher, but now the pain is
specific: adding a payment type is a _modification_ of shared code. Here is
the scenario everyone recognizes:

```java
public class PaymentService {
    public void pay(Payment payment) {
        if (payment.getType().equals("CARD")) {
            cardGateway.charge(payment.getReference(), payment.getAmount());
        } else if (payment.getType().equals("BANK_TRANSFER")) {
            bankGateway.transfer(payment.getReference(), payment.getAmount());
        } else if (payment.getType().equals("E_WALLET")) {
            walletGateway.pay(payment.getReference(), payment.getAmount());
        } else {
            throw new UnsupportedPaymentTypeException(payment.getType());
        }
    }
}
```

The business says: "Add PayPal." The change is:

```java
        } else if (payment.getType().equals("PAYPAL")) {
            paypalGateway.pay(payment.getReference(), payment.getAmount());
        }
```

Why is this tiny change risky? Because the file being edited is _shared_ —
it holds the card path that runs real money. Any mis-placement, any merge
conflict, any half-finished refactor in that file risks every payment type,
not just the new one. The change is _one line_ and the blast radius is
_the whole class_. Over months, this method accumulates ten types, and its
risk profile is now ten payment products pinned to one file.

**The principle.** The Open/Closed Principle says: a module should be
**open for extension** (you can add behavior) and **closed for modification**
(adding behavior does not require editing the existing module). The
important correction, because this principle is quoted wrongly constantly:

> **OCP does NOT mean "never modify existing code."** It means: protect the
> _variation point_ — the place where you know new variants will arrive —
> with an abstraction, so that adding a variant is an _addition_ (a new
> class, a new registration) instead of a _modification_ (an edit to shared
> code). You are not avoiding change; you are routing it.

The kind of change OCP protects against is _one-dimensional_: a new member
of a known family (payment types, notification channels, report formats,
export destinations). For that family, you want the "add" cost to be small
and isolated, and the "modify" cost to be zero.

**Refactoring with polymorphism + registration (Strategy).** Using the
strategy map from Section 2.4:

```java
public class PaymentService {
    private final Map<PaymentType, PaymentStrategy> strategies;

    public PaymentService(Map<PaymentType, PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentResult pay(Payment payment) {
        PaymentStrategy strategy = strategies.get(payment.getType());
        if (strategy == null) {
            throw new UnsupportedPaymentTypeException(payment.getType());
        }
        return strategy.pay(payment);
    }
}
```

Adding PayPal is now: a new `PayPalPaymentStrategy` class, and one entry in
the map (usually a Spring `@Bean` registration or a config file — often
zero edits to Java). `PaymentService` never changes again for a new payment
type. The shared file — the one that runs real money — is closed.

**Trade-offs.** What did this buy, and what did it cost?

| Bought                                            | Cost                                                    |
| ------------------------------------------------- | ------------------------------------------------------- |
| New variants do not touch shared code             | A new abstraction (interface + registry)                |
| Each variant is independently testable            | Dispatching is now indirect                             |
| Variant logic is co-located with its dependencies | The "one method shows all branches" readability is gone |

**Special cases — when NOT to apply OCP.**

1. **The variation point is unknown.** You cannot "protect" a variation you
   have not seen. Building a strategy registry for the _first_ payment
   method is speculative. The honest sequence: write the `if`, feel the
   second branch arrive, _then_ introduce the abstraction. Refactoring to
   OCP is cheap when the branches are small; guessing the variation point
   is expensive when it is wrong.

2. **The change is not one-dimensional.** If the "new payment type" also
   changes how orders flow, how refunds work, and what the receipt looks
   like, no dispatch table will contain the change — the variation is
   cross-cutting and the interface will leak (Section 2.2's "family that
   is not a family").

3. **The family is closed by nature.** `sealed` enums (Part VII) or sealed
   class hierarchies deliberately fix the family. Then "closed for
   modification" is _desired_: the exhaustive `switch` the compiler
   verifies beats a registration map you can forget to update.

The recurring judgment is: OCP is a bet on _which dimension will grow_.
Make the bet only when the growth is visible.

### 3.3 L — Liskov Substitution Principle: Behavioral Compatibility

The LSP is the one SOLID principle that is _not_ about change management —
it is about **correctness of the type system**. It answers: when is a
subclass allowed to replace its parent?

**The real problem.** Forget `Bird` and `Penguin`. Here is a backend
version, and it fails in production, not in a zoo.

```java
public class VoucherDiscount {
    private final BigDecimal percentage;

    public VoucherDiscount(BigDecimal percentage) {
        this.percentage = percentage;
    }

    public BigDecimal apply(BigDecimal total) {
        return total.multiply(BigDecimal.ONE.subtract(percentage));
    }
}
```

The checkout flow uses `VoucherDiscount` polymorphically — it is stored in
a `List<VoucherDiscount>` and applied to every order:

```java
public BigDecimal applyAll(List<VoucherDiscount> vouchers, BigDecimal total) {
    BigDecimal result = total;
    for (VoucherDiscount voucher : vouchers) {
        result = voucher.apply(result);
    }
    return result;
}
```

Now the business adds a "minimum spend" voucher: only orders over 200
qualify. The developer writes:

```java
public class MinimumSpendVoucher extends VoucherDiscount {
    private final BigDecimal minimumSpend;

    public MinimumSpendVoucher(BigDecimal percentage, BigDecimal minimumSpend) {
        super(percentage);
        this.minimumSpend = minimumSpend;
    }

    @Override
    public BigDecimal apply(BigDecimal total) {
        if (total.compareTo(minimumSpend) < 0) {
            throw new IllegalArgumentException("order below minimum spend");
        }
        return super.apply(total);
    }
}
```

It compiles. It passes its own tests. And it breaks checkout in
production, because `applyAll` has no idea a `VoucherDiscount.apply()` can
throw. The parent contract said: "returns the discounted total." The
subclass's stronger precondition ("caller must not pass totals under 200")
violates it.

**The principle.** LSP says: if `S` is a subtype of `T`, then any property
that holds for objects of type `T` must also hold for objects of type `S` —
a subclass must be usable _anywhere_ its parent is used, without the caller
knowing. Concretely, it is about three kinds of contract clauses:

| Clause        | What it means                                 | Subtype rule                                 |
| ------------- | --------------------------------------------- | -------------------------------------------- |
| Precondition  | What the caller must guarantee before calling | May only be **weakened**, never strengthened |
| Postcondition | What the call guarantees after returning      | May only be **strengthened**, never weakened |
| Invariant     | What is true before and after every call      | Must be preserved                            |
| Exceptions    | The failure vocabulary of the method          | Must remain within the parent's vocabulary   |

`MinimumSpendVoucher` **strengthened a precondition** ("total must be >=
200") and **added a new exception** the callers did not handle. `@Override`
compiled fine — LSP is a behavioral contract, and the compiler checks
_signatures_, not behavior.

**More violation patterns to recognize.** These are the shapes you meet in
real code, with the telltale symptom:

```java
// Pattern 1: subclass throws what the parent explicitly allows
public class ReadOnlyAccount extends BankAccount {
    @Override
    public void withdraw(BigDecimal amount) {
        throw new UnsupportedOperationException("read-only account");
    }
}
// Caller: account.withdraw(...) — compiled fine, blows up at runtime
// because the caller could not know this subtype forbids the operation.

// Pattern 2: subclass returns weaker results
public class CacheOrderRepository extends OrderRepository {
    @Override
    public Order findById(String id) {
        Order cached = cache.get(id);
        return cached != null ? cached : null;   // parent never returns null
    }
}
// Caller relies on non-null; gets NPE two frames later, far from the cause.

// Pattern 3: the caller defends with instanceof
public void refund(Payment payment) {
    if (payment instanceof CryptoPayment) {
        // crypto can't be refunded the same way — special-case it
    }
    ...
}
// The moment client code has to know which subclass it holds,
// polymorphism is dead and the LSP is violated.
```

Every one of these is a _behavioral_ mismatch that compiles. That is the
whole point of the section:

> **Compile-time compatibility is about signatures. Behavioral compatibility
> is about contracts. `@Override` proves the first; only design discipline
> gives you the second.**

**Why does this happen?** Because "is-a" was decided on structure ("a
read-only account _is_ an account") instead of behavior ("can this subclass
honor everything the parent promises?"). The fix is rarely "fix the
subclass" — usually the hierarchy was wrong:

- **Read-only account** is not a subtype of a _mutable_ `BankAccount`; it is
  a different kind of object. Fix: extract an interface (`AccountView` or a
  `BalanceProvider`) that both honor, or a `FrozenAccount` whose
  `withdraw()` _is_ an empty operation on the account's state — model the
  freeze as state, not as type.
- **Cache repository returning null** should return `Optional<Order>` — the
  contract then _honestly_ allows absence, and both implementations satisfy
  it.
- **Minimum-spend voucher** should be _composed_: a voucher with an
  eligibility predicate that filters before `apply()` — the base contract
  never learns about the restriction.

**The rule of thumb:** before writing `extends`, ask: _can every caller of
the parent behave exactly the same with this subclass, without knowing it
is there?_ If the answer needs a caveat, the hierarchy is wrong.

**Trade-offs and special cases.** LSP strictness is about _where the
hierarchy is real_. For deep library hierarchies (`Exception`,
`InputStream`) the contract matters enormously. For tiny internal
hierarchies with one caller, a pragmatic shortcut (e.g., a subclass that
special-cases one method) may be cheaper than redesigning — but you are
borrowing from correctness to pay for speed, and you should know it.
Sealed classes (Part VII) give Java a built-in tool to limit who can
subclass what, which turns "everyone may extend" into "only these known
variants" — the cleanest LSP protection Java offers.

### 3.4 I — Interface Segregation Principle: Interfaces Sized for Their Clients

**The real problem.** A `ReportService` interface, grown by accretion:

```java
public interface ReportService {
    byte[] generateCsv(ReportQuery query);
    byte[] generatePdf(ReportQuery query);
    byte[] generateXlsx(ReportQuery query);
    void sendByEmail(byte[] report, String recipient);
    void uploadToS3(byte[] report, String path);
}
```

Three concrete implementations exist: `CsvReportService`, `PdfReportService`,
`XlsxReportService`. Each implements the interface, and each must provide
all five methods. `CsvReportService` cannot generate PDFs and has no reason
to upload to S3 — so it contains:

```java
public class CsvReportService implements ReportService {
    @Override
    public byte[] generateCsv(ReportQuery query) { /* real logic */ }

    @Override
    public byte[] generatePdf(ReportQuery query) {
        throw new UnsupportedOperationException("CSV service cannot generate PDFs");
    }

    @Override
    public byte[] generateXlsx(ReportQuery query) {
        throw new UnsupportedOperationException("CSV service cannot generate XLSX");
    }

    @Override
    public void sendByEmail(byte[] report, String recipient) {
        throw new UnsupportedOperationException("email not supported");
    }

    @Override
    public void uploadToS3(byte[] report, String path) {
        throw new UnsupportedOperationException("upload not supported");
    }
}
```

**Why it is painful.** The interface forces every client of `ReportService`
to know about methods it will never call, and every implementation to carry
dead code. The signature `sendByEmail(byte[] report, String recipient)` is
also a _leak_ — "byte[]" is a PDF-ish concept; the CSV client doesn't think
in byte arrays. Clients depend on the interface, the interface depends on
the union of all clients' needs, so every client conceptually depends on
every other client's requirements. A change to the PDF flow touches the
interface, which forces recompilation and retesting of the CSV flow — the
same shared-file risk as OCP, but at the interface level.

**The principle.** Interface Segregation says: **no client should be forced
to depend on methods it does not use.** Split the fat interface along
client boundaries — each interface expresses one coherent capability:

```java
public interface CsvReportGenerator {
    byte[] generateCsv(ReportQuery query);
}

public interface PdfReportGenerator {
    byte[] generatePdf(ReportQuery query);
}

public interface ReportDeliverable {
    void sendByEmail(byte[] report, String recipient);
}
```

Now `CsvReportService implements CsvReportGenerator` (and, if the CSV flow
does email, also `ReportDeliverable`). Clients take exactly the interface
they need:

```java
public class ReportBatchJob {
    private final CsvReportGenerator csvGenerator;   // only what it uses
    private final ReportDeliverable deliverable;

    public ReportBatchJob(CsvReportGenerator csvGenerator, ReportDeliverable deliverable) {
        this.csvGenerator = csvGenerator;
        this.deliverable = deliverable;
    }
}
```

**Default methods and the Adapter as mitigations.** Real-world libraries
(JDK interfaces, third-party SDKs) are fat and you cannot change them. Two
tools:

- **Default methods** let a fat interface grow without breaking existing
  implementors (`Collection.removeIf` is the classic: added in Java 8 as a
  default so `ArrayList` and every custom collection kept compiling). Use
  them when _the interface is stable and the growth is one method_; do not
  use them to _hide_ that an interface is fat.
- **The Adapter pattern** (Part III) can translate a third-party fat API
  into several narrow domain interfaces, keeping the SDK's shape out of
  your business code.

**The opposite problem: interface fragmentation.** Segregation can be
over-applied. Consider:

```java
public interface Identifiable { String getId(); }
public interface Timestamped { Instant getCreatedAt(); }
public interface Auditable extends Timestamped { String getCreatedBy(); }
public interface HasName { String getName(); }
public interface HasEmail { String getEmail(); }
public interface Validatable { void validate(); }
public interface Serializable { ... }   // already exists, but you get the idea

public class User implements Identifiable, Timestamped, HasName, HasEmail, Validatable { ... }
```

**When does this become over-engineering?** When the interfaces are _data
markers_ rather than _behavioral capabilities_: every client that uses a
`User` uses all its fields; nothing depends on `HasEmail` alone; and the
codebase now has seven names to navigate to find one class. Segregation
pays when **clients differ in what they need** — a `ReportBatchJob` that
only needs CSV generation is a real, separate client. If every client
needs everything, the interface is cohesive as-is, and splitting it is
ceremony. The test:

> **A split interface is justified when a real client exists that needs
> only the split part.** Hypothetical clients do not count — the same
> volatility rule as every other principle.

### 3.5 D — Dependency Inversion Principle: High-Level Policy Owns the Abstraction

This is the deepest of the five, and the most abused — because it is
constantly confused with its cousin, Dependency Injection. They are not the
same thing:

|                         | Dependency Inversion (DIP)                    | Dependency Injection (DI)                |
| ----------------------- | --------------------------------------------- | ---------------------------------------- |
| What it is              | A rule about _direction_ of dependencies      | A _mechanism_ for supplying dependencies |
| The question it answers | Which module should own the abstraction?      | How does an object get its dependencies? |
| Where it lives          | In the architecture (package/component shape) | In the construction of objects           |
| The relationship        | DI is one way to _implement_ DIP              | DIP is one _reason_ to use DI            |

**The real problem.** A high-level business flow that depends on a
low-level implementation:

```java
public class OrderService {
    private final MySqlOrderRepository repository;

    public OrderService(MySqlOrderRepository repository) {
        this.repository = repository;
    }

    public void save(Order order) {
        repository.insert(order);
    }

    public Order find(String id) {
        return repository.selectById(id);
    }
}
```

`OrderService` — the module that encodes business policy — is pinned to
`MySqlOrderRepository` — a module that encodes SQL, connections, and a
specific vendor. Every policy decision now depends on a storage decision:
switching to PostgreSQL, adding a cache in front, or introducing an in-memory
implementation for tests means _editing the policy class_ or faking a
concrete class with a specific vendor's details in its methods. The
dependency arrow points _up_: policy → vendor.

**The principle.** Dependency Inversion inverts that arrow:

> **A. High-level modules should not depend on low-level modules. Both
> should depend on abstractions.**
> **B. Abstractions should not depend on details. Details should depend on
> abstractions.**

The key insight — the one tutorials skip — is the second sentence of A:
**the abstraction is owned by the high-level module**. It expresses what
the policy _needs_, not what the vendor _offers_:

```java
public interface OrderRepository {          // owned by the policy layer
    void save(Order order);
    Order findById(String id);
}
```

```java
public class OrderService {
    private final OrderRepository repository;   // depends on the abstraction

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }

    public void save(Order order) {
        repository.save(order);
    }

    public Order find(String id) {
        return repository.findById(id);
    }
}
```

```java
public class MySqlOrderRepository implements OrderRepository {
    // SQL, connections, vendor specifics — a detail, implementing the policy
    // layer's contract
    @Override
    public void save(Order order) { /* INSERT INTO orders ... */ }

    @Override
    public Order findById(String id) { /* SELECT * FROM orders WHERE id = ? */ }
}
```

Now the dependency graph is:

```text
                OrderService (policy)
                      │
                      ▼
              OrderRepository (abstraction)      ← owned by policy layer
                      ▲
                      │
              MySqlOrderRepository (detail)      ← implements the contract
```

Both modules depend on the abstraction; the abstraction expresses the
policy's needs; the detail conforms. This is the **Ports and Adapters**
style: the interface is the _port_ (the policy's requirement), the
implementation is the _adapter_ (the detail that fulfills it).

**What this buys.** The high-level module is now reusable and testable
independent of storage: an `InMemoryOrderRepository` for tests, a
`CachedOrderRepository` for production hot paths, a PostgreSQL
implementation swapped in without touching policy. The change that used to
threaten `OrderService` (storage replacement) now produces a new adapter —
the classic OCP effect at the dependency level.

**Dependency Injection and Spring.** DIP is the _what_; DI is the _how_.
Construction of the graph — who creates what and hands it where — is
Dependency Injection, and the standard Java tool is a container. Spring
Boot's version:

```java
@Service
public class OrderService {
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) {   // constructor injection
        this.repository = repository;
    }
}
```

What Spring actually does here:

1. **Component scanning** discovers `@Service`, `@Repository`, `@Component`
   classes on startup.
2. **Bean instantiation** creates one singleton instance per component
   (lazily, and in dependency order).
3. **Constructor injection** resolves `OrderService`'s constructor
   parameter — finds _the single_ `OrderRepository` bean in the container —
   and passes it in.

Crucially, Spring did not need to know _which_ implementation to choose —
that decision was made either by type (one implementation) or by explicit
`@Primary`/`@Qualifier`/`@Configuration` beans when several exist:

```java
@Configuration
public class RepositoryConfig {
    @Bean
    @Primary
    public OrderRepository orderRepository(DataSource dataSource) {
        return new MySqlOrderRepository(dataSource);
    }

    @Bean
    public OrderRepository cacheableOrderRepository(OrderRepository delegate) {
        return new CachedOrderRepository(delegate);
    }
}
```

The container is only ever a _composition root_ — the single place where
the dependency graph is assembled. The `OrderService` above knows nothing
about `MySqlOrderRepository` or `CachedOrderRepository`; it knows only the
port.

**When introducing interfaces purely for DI is unnecessary.** This is the
abuse case, and it is everywhere. The anti-pattern:

```java
// One implementation. Ever. And the interface expresses nothing the
// policy layer needs beyond what the class already offers.
public interface UserRepository { ... }

public class UserRepositoryImpl implements UserRepository {
    // the ONLY implementation
}
```

When is this interface pointless? When:

1. There is **exactly one implementation** and no real second one in
   sight.
2. The interface **mirrors the class's methods** instead of expressing a
   policy requirement — it is a clone, not a contract.
3. The only consumer that "needs" it is the test suite — and your mocking
   framework (Mockito can mock concrete classes) can handle that without an
   interface.

In that case the interface is not doing DIP work; it is naming ceremony.
Spring does not require interfaces — `@Service` on the concrete class,
constructor injection of the concrete class, is perfectly idiomatic for a
single implementation. The interface earns its existence the same way every
abstraction does in this article: **a real second variant, or a real
policy contract the concrete class cannot express.**

**The DIP summary.** Point the dependency arrows at abstractions owned by
the high-level module; use constructor injection to assemble the graph; and
refuse interfaces that serve only convention. DIP is about which direction
change travels — policy should never change because storage did.

---

## 4. Part III — Design Patterns: Problems They Solve, Prices They Charge

The 23 GoF patterns are not a catalog to memorize; they are 23 _proven
solutions to recurring problems_, and each one has a price. This part
covers the six that a Java backend actually meets constantly — organized by
the problem they solve, not by name. For each: the problem, the bad shape,
the pattern, the trade-offs, and when it is overkill.

| Pattern   | Problem it solves                              |
| --------- | ---------------------------------------------- |
| Strategy  | A family of interchangeable behaviors          |
| Factory   | Object creation with selection logic           |
| Builder   | Constructing objects with many parameters      |
| Adapter   | An external API that does not match your model |
| Decorator | Adding behavior without touching the core      |
| Observer  | One event, many interested parties             |

### 4.1 Strategy: A Family of Interchangeable Behaviors

**The problem.** You have already seen it twice — the payment dispatcher
(Section 2.4) is the canonical Strategy scenario:

```java
if (payment.getType() == PaymentType.CARD) {
    cardGateway.charge(...);
} else if (payment.getType() == PaymentType.BANK_TRANSFER) {
    bankGateway.transfer(...);
} else if (payment.getType() == PaymentType.E_WALLET) {
    walletGateway.pay(...);
}
```

The pain, precisely: the _decision_ (which type → which behavior) and the
_behaviors_ are fused in one method; adding a type edits the fusion.

**The pattern.** Extract the behaviors behind one interface and let the
caller hold a strategy — either injected directly or looked up by type:

```java
public interface PaymentStrategy {
    PaymentResult pay(Payment payment);
}
```

```java
public class CardPaymentStrategy implements PaymentStrategy {
    private final CardGateway cardGateway;

    public CardPaymentStrategy(CardGateway cardGateway) {
        this.cardGateway = cardGateway;
    }

    @Override
    public PaymentResult pay(Payment payment) {
        return cardGateway.charge(payment.getReference(), payment.getAmount());
    }
}
```

Selection via a registry (constructed once, in the composition root):

```java
public class PaymentStrategyFactory {
    private final Map<PaymentType, PaymentStrategy> strategies;

    public PaymentStrategyFactory(Map<PaymentType, PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentStrategy forType(PaymentType type) {
        PaymentStrategy strategy = strategies.get(type);
        if (strategy == null) {
            throw new UnsupportedPaymentTypeException(type);
        }
        return strategy;
    }
}
```

```java
PaymentStrategy strategy = factory.forType(payment.getType());
PaymentResult result = strategy.pay(payment);
```

**Why Strategy works.** It is three ideas you have already met, in one
place:

- **Polymorphism** does the dispatch (each strategy implements the
  contract).
- **OCP** is the payoff (new type = new strategy + registration, no edits
  to the flow).
- **SRP** is the byproduct (each strategy owns its logic and dependencies;
  the flow owns only selection).

**Trade-offs.** The chain becomes a class per variant plus a registry. The
flow is now read through indirection: `strategy.pay(...)` does not tell you
what happens — you must know which strategies exist. For three stable
branches, the indirection may be pure cost. Strategy is _also_ the modern
poster child for simplification, because Java 8 turned it into a
one-liner: the interface has one method, so it is a **functional interface**
and callers can pass lambdas instead of classes (Part VII).

**When Strategy is overkill.** The decision rule from Section 2.4, stated
as a checklist:

- Only two branches, stable for years → a plain `if` is better. (A
  "CANCELLED order" guard is not a strategy; it is a rule.)
- The "variants" are not interchangeable — one is synchronous, one needs
  user interaction, one cannot be retried → they are not one family; a
  common interface forces them to pretend (leaky abstraction).
- The variation is _across_ dimensions (type + country + currency) → one
  strategy interface cannot contain it; you will need a matrix of
  strategies, and at that point a rule engine or configuration data beats
  classes.

### 4.2 Factory: Object Creation That Has Decisions in It

**The problem.** `new` is the simplest way to create an object, and it is
the wrong tool exactly when creation _involves a decision_. Where does
decision-laden creation happen in a real backend? Selecting a strategy by
type (seen above), building a provider for a given country, choosing a
discount policy from config, or constructing a domain object whose wiring
depends on context.

**Simple Factory.** The payment example, formalized:

```java
public class PaymentProcessorFactory {
    private final Map<PaymentType, PaymentStrategy> strategies;

    public PaymentProcessorFactory(Map<PaymentType, PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentStrategy create(PaymentType type) {
        PaymentStrategy strategy = strategies.get(type);
        if (strategy == null) {
            throw new UnsupportedPaymentTypeException(type);
        }
        return strategy;
    }
}
```

That's it — the entire pattern. (Note: this "Simple Factory" is not one of
the 23 GoF patterns; it is the pragmatic helper that everyone uses, and the
GoF Factory Method / Abstract Factory are its more rigorous cousins. Start
here.) The caller's creation logic disappears:

```java
// before: the caller knew the map, the fallback, the error type
// after:  the caller asks; the factory owns the decision
PaymentStrategy strategy = processorFactory.create(payment.getType());
```

**Factory Method.** When the _subclass_ should decide which object a
template flow creates. Classic backend shape: a base flow with a
creation hook:

```java
public abstract class RefundFlow {
    public final void execute(RefundRequest request) {
        PaymentRefundHandler handler = createRefundHandler();   // hook
        handler.refund(request);
        notifyCustomer(request);
    }

    protected abstract PaymentRefundHandler createRefundHandler();
}
```

```java
public class CardRefundFlow extends RefundFlow {
    @Override
    protected PaymentRefundHandler createRefundHandler() {
        return new CardRefundHandler(cardGateway);
    }
}
```

The template (refund → notify) is fixed; the created object is the
variation. Factory Method is appropriate when the _flow itself_ is stable
and the _created thing_ varies per subclass. If only the created thing
varies and the flow is trivial, the Simple Factory above is enough — the
Factory Method's inheritance tax is not earned.

**Abstract Factory.** When you need a _family_ of related objects that must
stay consistent. One provider is not just a gateway — it is a gateway, a
refund handler, a receipt generator, and a currency validator, and they
must all come from the same vendor:

```java
public interface PaymentProviderFactory {
    PaymentGateway createGateway();
    RefundHandler createRefundHandler();
    ReceiptGenerator createReceiptGenerator();
}
```

```java
public class StripeProviderFactory implements PaymentProviderFactory {
    private final StripeSdk stripe;

    public StripeProviderFactory(StripeSdk stripe) {
        this.stripe = stripe;
    }

    @Override
    public PaymentGateway createGateway() { return new StripeGatewayAdapter(stripe); }

    @Override
    public RefundHandler createRefundHandler() { return new StripeRefundHandler(stripe); }

    @Override
    public ReceiptGenerator createReceiptGenerator() { return new StripeReceiptGenerator(stripe); }
}
```

The guarantee: code that builds a payment flow through a factory never
mixes Stripe's gateway with Adyen's refund handler. In Spring, the factory
is often implicit — each `@Bean` factory method produces one member of the
family, and the container enforces consistency by construction. Abstract
Factory is the pattern you reach for when the family is real (mixing
vendors would be a bug); it is pure ceremony when there is only one vendor
and one member per family.

**The special case: a factory that just wraps `new`.** This is the pattern
that deserves the most suspicion:

```java
public class CarFactory {
    public Car createCar() {
        return new Car();          // the factory adds nothing
    }
}
```

A factory's value is the _decision it hides_ — the map lookup, the config
check, the family consistency. A factory that unconditionally calls `new`
hides nothing and adds an indirection; the caller should write `new Car()`
(or, in Spring, declare a `@Bean`). **The test: would the factory ever
return something different given different input or context?** If no — no
factory.

### 4.3 Builder: When Constructors Can No Longer Communicate

**The problem.** Positional constructors stop scaling at about three or
four arguments, and the failure is silent:

```java
User user = new User(
    "Hung",
    "hung@example.com",
    28,
    "12 Nguyen Hue, Ho Chi Minh City",
    "0901234567",
    "ACCOUNTANT",
    true,          // isActive — or was that isVerified?
    "VN"
);
```

Which `boolean` was that? Is the phone before the address or after? Swap
two arguments and the code still compiles — the bug is a _semantic_ one,
undetectable by the compiler, sometimes invisible for months. Then the
business adds `referralCode` and `marketingOptIn`, and every call site
must be updated to pass two more positional arguments, most of them null.

**The pattern.** A nested builder, fluent, validating at `build()`:

```java
public final class User {
    private final String name;
    private final String email;
    private final int age;
    private final String address;
    private final String phone;
    private final boolean active;

    private User(UserBuilder builder) {
        this.name = builder.name;
        this.email = builder.email;
        this.age = builder.age;
        this.address = builder.address;
        this.phone = builder.phone;
        this.active = builder.active;
    }

    public static UserBuilder builder() {
        return new UserBuilder();
    }

    public static final class UserBuilder {
        private String name;
        private String email;
        private int age;
        private String address;
        private String phone;
        private boolean active = true;

        public UserBuilder name(String name) { this.name = name; return this; }
        public UserBuilder email(String email) { this.email = email; return this; }
        public UserBuilder age(int age) { this.age = age; return this; }
        public UserBuilder address(String address) { this.address = address; return this; }
        public UserBuilder phone(String phone) { this.phone = phone; return this; }
        public UserBuilder active(boolean active) { this.active = active; return this; }

        public User build() {
            if (name == null || name.isBlank()) {
                throw new IllegalArgumentException("name is required");
            }
            if (email == null || !email.contains("@")) {
                throw new IllegalArgumentException("email is invalid");
            }
            if (age < 0) {
                throw new IllegalArgumentException("age cannot be negative");
            }
            return new User(this);
        }
    }
}
```

The call site reads like a specification:

```java
User user = User.builder()
        .name("Hung")
        .email("hung@example.com")
        .age(28)
        .address("12 Nguyen Hue, Ho Chi Minh City")
        .active(true)
        .build();
```

**Why Builder earns its keep here.** It gives: **readability** (every
argument is labeled), **immutability** (the class has no setters; the
builder is the only construction path), **optional parameters** (you simply
omit steps, and sensible defaults hold), and **validation in one place**
(`build()` checks, so no half-built `User` can exist).

**Special cases — when Builder is the wrong tool.**

1. **Small objects.** Three or four parameters, all mandatory: a plain
   constructor is better — a builder for `Address(street, city, country)`
   is noise. `new Address(...)` with three args is readable.
2. **Java records.** A record (Part VII) gives immutability, equals/hashCode,
   and a canonical constructor in one declaration — for typical value
   objects, the record _is_ the improvement, with no builder needed. A
   record plus a compact constructor validating its args replaces the
   builder's `build()` check.
3. **Static factory methods.** When the variations are _named concepts_
   rather than _field combinations_ — `User.createCustomer(...)` vs
   `User.createAdmin(...)` — a static factory communicates the concept;
   a builder communicates the fields. Use the one that matches the
   meaning.
4. **The "builder with defaults" trap.** Builders with hidden defaults
   (is `active` true or false if not set?) can silently construct objects
   with the wrong business meaning. Prefer explicit required fields —
   make the builder _fail_ on omissions the domain treats as mandatory.

The judgment: Builder solves _argument readability_ and _immutability_.
The moment records and static factories cover those, the Builder's
boilerplate (a dozen lines per field) is a cost to justify — for 8+ args
with mixed optionality it still wins; for 3 args it loses.

### 4.4 Adapter: When the External API Does Not Speak Your Language

**The problem.** Your domain speaks `PaymentRequest`, `PaymentResult`,
`orderId`, `BigDecimal`. The payment provider SDK speaks Stripe's
vocabulary — `StripeCharge`, `amountInCents`, `token`, `StripeException`.
The naive integration writes provider code straight into the business
flow:

```java
public class PaymentService {
    private final StripeSdk stripe;

    public void pay(Order order, String cardToken) {
        try {
            StripeCharge charge = stripe.charge(cardToken, toCents(order.getTotal()), "USD");
            // business logic now knows about StripeCharge, StripeException,
            // cents conversion, charge ids...
            order.setStatus(charge.getPaid() ? OrderStatus.PAID : OrderStatus.FAILED);
        } catch (StripeDeclinedException e) {
            // translate exceptions inline — in every call site
            order.setStatus(OrderStatus.PAYMENT_DECLINED);
        } catch (StripeNetworkException e) {
            throw new RuntimeException("stripe down", e);
        }
    }
}
```

**Why it is bad.** Three failure modes, compounding:

1. **The SDK's types leak everywhere.** `StripeCharge`, `StripeException`,
   and `toCents()` appear in the service, the controller, the refund flow.
   The domain model is colonized by the vendor.
2. **Every call site re-implements the translation.** The try/catch
   translation above will be copy-pasted into refund, retry, and
   reconciliation flows — and each copy will drift.
3. **The vendor owns your architecture.** Changing providers means editing
   every business class that touches Stripe types — the exact coupling DIP
   (Section 3.5) exists to prevent.

**The pattern.** The Adapter sits at the boundary. Your domain defines the
interface (`PaymentGateway`); an adapter class translates domain calls into
SDK calls and SDK responses back into domain results:

```java
public class StripeGatewayAdapter implements PaymentGateway {
    private final StripeSdk stripe;

    public StripeGatewayAdapter(StripeSdk stripe) {
        this.stripe = stripe;
    }

    @Override
    public PaymentResult pay(PaymentRequest request) {
        try {
            StripeCharge charge = stripe.charge(
                request.getMethod().getToken(),
                toCents(request.getAmount()),
                request.getCurrency());
            return PaymentResult.success(charge.getId());
        } catch (StripeDeclinedException e) {
            return PaymentResult.failure("declined: " + e.getMessage());
        } catch (StripeNetworkException e) {
            throw new PaymentUnavailableException("stripe unreachable", e);
        }
    }

    private static long toCents(BigDecimal amount) {
        return amount.movePointRight(2).longValueExact();
    }
}
```

The flow is now vendor-free:

```java
public class PaymentService {
    private final PaymentGateway gateway;

    public void pay(Order order, PaymentRequest request) {
        PaymentResult result = gateway.pay(request);
        order.setStatus(result.isSuccess() ? OrderStatus.PAID : OrderStatus.FAILED);
        // nothing here knows about Stripe, cents, or tokens
    }
}
```

**The consequences.** The domain boundary is restored: business logic knows
only `PaymentGateway`; SDK types live inside the adapter; provider
swapping, SDK upgrades, and exception translation happen in exactly one
place per provider. This is also the DIP in its purest practical form — the
adapter is the "adapter" of Ports & Adapters (Section 3.5).

**Trade-offs and special cases.**

- The adapter must be honest about what it cannot map. If the SDK's
  failure vocabulary is richer than your domain's (`payment_intent_requires_`
  action states), a two-value `PaymentResult` will force the adapter to
  flatten information — decide whether the business flow actually needs
  the detail, and widen the domain type only for real needs, not for the
  SDK's completeness.
- **Adapter vs Facade.** A Facade (not covered in detail here) is a
  simplified _entry point to your own subsystem_; an Adapter is a
  _translation of one interface to another_. In practice, integration
  adapters often do both — exposing one clean method that internally
  coordinates several SDK calls. The name matters less than the boundary
  being real.
- When the SDK already matches your domain (some modern APIs are close
  enough), a wrapper is still usually worth it for _one_ reason alone:
  the try/catch translation and the upgrade path. But a thin adapter that
  only forwards calls, with no translation, no error mapping, and no
  testability gain, is ceremony — if the SDK is stable and domain-shaped,
  use it directly and revisit when it hurts.

### 4.5 Decorator: Adding Behavior Without Touching the Core

**The problem.** The payment flow needs, in addition to paying: retry on
transient failures, audit logging of every attempt, and metrics for
latency. The naive approach — edit the implementation — has a compounding
cost: the retry logic written into `StripeGatewayAdapter` must be
re-written for every future provider; the metrics are interleaved with the
business logic; and testing "retry" requires a real provider.

The naive alternative — inheritance — is worse. To give two providers
(retry, logging, metrics), you need:

```text
RetryingStripeAdapter   LoggingStripeAdapter     MetricsStripeAdapter
RetryingBankAdapter     LoggingBankAdapter       MetricsBankAdapter
RetryingLoggingStripeAdapter   LoggingMetricsBankAdapter  ...
```

Every new behavior × every new provider = a new class. The combinatorial
explosion is the smell that says "inheritance is the wrong mechanism."

**The pattern.** Decorator composes behavior _recursively through the same
interface_: each decorator implements `PaymentGateway`, holds another
`PaymentGateway`, does its thing, and delegates:

```java
public class RetryDecorator implements PaymentGateway {
    private final PaymentGateway delegate;
    private final int maxAttempts;
    private final Duration backoff;

    public RetryDecorator(PaymentGateway delegate, int maxAttempts, Duration backoff) {
        this.delegate = delegate;
        this.maxAttempts = maxAttempts;
        this.backoff = backoff;
    }

    @Override
    public PaymentResult pay(PaymentRequest request) {
        PaymentResult result = delegate.pay(request);
        for (int attempt = 1; !result.isSuccess() && attempt < maxAttempts; attempt++) {
            sleepQuietly(backoff.multipliedBy(attempt));
            result = delegate.pay(request);
        }
        return result;
    }

    private static void sleepQuietly(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

```java
public class LoggingDecorator implements PaymentGateway {
    private final PaymentGateway delegate;
    private final AuditLogger auditLog;

    public LoggingDecorator(PaymentGateway delegate, AuditLogger auditLog) {
        this.delegate = delegate;
        this.auditLog = auditLog;
    }

    @Override
    public PaymentResult pay(PaymentRequest request) {
        long started = System.nanoTime();
        PaymentResult result = delegate.pay(request);
        auditLog.log("payment", request.getOrderId(), result, elapsedMillis(started));
        return result;
    }

    private static long elapsedMillis(long startedNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }
}
```

Composition at the wiring point — the flow, the core, and the provider
stay untouched:

```java
PaymentGateway gateway = new RetryDecorator(
        new LoggingDecorator(
                new MetricsDecorator(
                        new StripeGatewayAdapter(stripe))),
        3, Duration.ofMillis(200));
```

```text
PaymentService
     ↓
RetryDecorator        ← behavior, independent of provider
     ↓
LoggingDecorator      ← behavior, independent of provider
     ↓
MetricsDecorator      ← behavior, independent of provider
     ↓
StripeGatewayAdapter  ← provider, independent of behavior
```

**Why it works.** Adding a behavior = adding a class + one wiring change;
combining N behaviors with M providers takes N + M classes instead of
N × M. The core implementation is never edited. The pipeline is visible at
the composition point — you can read the whole execution order in one
place. And each decorator is testable alone (wrap a fake delegate).

**Trade-offs — and the ordering trap.** Decorators are order-sensitive,
and the order is _semantic_:

- Retry _outside_ logging means a failure is logged once per attempt —
  good for debugging; retry _inside_ logging logs the final state once —
  good for monitoring. Different orders, different guarantees.
- Retry _outside_ metrics counts every attempt; _inside_ counts only
  successes. Both are defensible; the point is that wrapping order is a
  design decision, not an accident — write it where the pipeline is
  visible, and document the guarantee each layer provides.
- Stack traces get deeper and debugging gets indirect: "which layer threw
  this?" becomes a question.
- Decorators cannot easily _add state visible to other layers_ — a retry
  decorator cannot, without extra interfaces, expose "how many attempts
  happened" to the caller. If that data is business-required, the decorator
  is the wrong tool; put it in the result instead.

**When Decorator is overkill.** If the extra behavior is a _permanent,
single, unconditional_ aspect of the operation (every payment always gets
audit-logged), it can live inside the implementation — the decorator buys
flexibility you do not need. Decorator earns its layers when behaviors
**combine, vary, or switch off** (retry in production but not in tests;
metrics for some channels only). Note also the modern Java shortcut
(Part VII): with a functional interface, decorators become one-liners —
`gateway = withRetry(gateway, 3)` via static factory or lambda
composition.

### 4.6 Observer / Event-Driven: One Event, Many Interested Parties

**The problem.** `placeOrder` grows a notification list:

```java
public void placeOrder(Order order) {
    orderRepository.save(order);

    emailService.sendOrderConfirmation(order);     // party 1
    inventoryService.reserveStock(order);          // party 2
    analyticsService.trackOrderPlaced(order);      // party 3
    notificationService.pushToCustomer(order);     // party 4
    fraudService.screenOrder(order);               // party 5 — added this sprint
}
```

**Why it is bad.** The order flow now _knows_ about email, inventory,
analytics, push, and fraud — and must change whenever a party joins or
leaves. A failure in any one of them (email down?) takes down order
placement — the parties' failure modes are the flow's failure modes. Each
party's latency is the flow's latency. This is the Observer problem: _many
independent consequences of one event_, hardwired into the source.

**The pattern, in-process: Spring events.** The publisher owns the event;
interested parties subscribe; the publisher does not know them:

```java
public record OrderCreatedEvent(String orderId, BigDecimal total, String customerId) {
}
```

```java
@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final ApplicationEventPublisher events;

    public OrderService(OrderRepository orderRepository, ApplicationEventPublisher events) {
        this.orderRepository = orderRepository;
        this.events = events;
    }

    @Transactional
    public void placeOrder(Order order) {
        orderRepository.save(order);
        events.publishEvent(new OrderCreatedEvent(order.getId(), order.getTotal(), order.getCustomerId()));
    }
}
```

```java
@Component
public class EmailOnOrderPlaced {
    @EventListener
    public void onOrderCreated(OrderCreatedEvent event) {
        emailService.sendOrderConfirmation(event.orderId());
    }
}
```

`OrderService` no longer knows email, inventory, analytics, or fraud
exist. Adding a party = adding a `@EventListener` class; removing one =
deleting it; a party failing no longer breaks order placement (unless you
_want_ transactional semantics — see below).

**The architecture scale-up: from Observer to Kafka.** This is where the
confusion lives, and it must be said plainly:

> **Observer pattern and Kafka are not the same thing. Observer is an
> in-process programming construct; Kafka is a cross-process
> infrastructure. Kafka is to Observer roughly what a database is to
> `ArrayList` — a distant cousin that solves a different scale of problem.**

| Aspect               | Observer (in-process events)              | Kafka (distributed event stream)                 |
| -------------------- | ----------------------------------------- | ------------------------------------------------ |
| Process boundary     | Same JVM, same memory                     | Multiple services, multiple machines             |
| Delivery             | Direct method call (or async executor)    | Network, brokers, partitions                     |
| Durability           | None — event dies with the JVM            | Retained on disk, replayable                     |
| Guarantees           | Best-effort; failure visible to publisher | At-least-once by default; per-partition ordering |
| Consistency model    | Synchronous — often within one DB txn     | Asynchronous — eventual consistency              |
| How consumers arrive | Registry of listeners at startup          | Consumer groups, independent lifecycle           |

The _conceptual relationship_ is real: both are "publishers emit events,
subscribers react, publisher doesn't know subscribers." But the
architectural differences are enormous:

- **Coupling.** Observer listeners share the publisher's process, lifecycle,
  and failure domain. Kafka consumers are independent deployments — they
  can be down, slow, or being deployed while the producer runs.
- **Synchronous vs asynchronous.** Spring `@EventListener` is synchronous
  by default: the event is dispatched on the publisher's thread, inside
  the same transaction. With `@Async` it moves to an executor — but still
  in-process. Kafka is inherently asynchronous and cross-process: the
  producer gets an ack when the broker accepts, not when consumers react.
- **Eventual consistency.** With Kafka, "the customer's email was sent"
  can lag "the order was placed" by seconds or minutes — and the email
  might never arrive (at-least-once means duplicates are _expected_, and
  consumers must be idempotent). In-process listeners, especially inside
  the transaction, give near-atomicity: the email listener fires only if
  the transaction commits.

**Failure handling — the decision that matters.** The first question with
events is _what should happen when a consumer fails?_:

```text
Synchronous, in-transaction listener (default @EventListener):
  - failure rolls back the order AND the consequence together
  - guarantee: no order without confirmation email
  - price: an email outage blocks order placement (same coupling as before,
    minus the code coupling)

Async in-process listener (@Async + @EnableAsync):
  - publisher succeeds, listener runs later on a pool thread
  - price: listener failure is invisible to the publisher; events can be
    lost on restart unless you add an outbox table

Kafka:
  - consumer reads from its own offset; failures are retried, offsets lag
  - price: duplicates (idempotency required), eventual consistency,
    observable lag, and — critically — order placement does NOT wait
```

The rule of thumb: **use the strongest consistency you can afford, and
push consequences to Kafka only when the consequence's failure must not
affect the flow** — email and analytics are the classic Kafka candidates;
inventory reservation and payment are usually _not_, because the flow
must not complete without them. The email after payment is the second
Kafka-era lesson: `OrderCreated` → `EmailService` → `Kafka` is a pattern
many teams migrate _from_, back to synchronous — once they realize the
confirmation email is a business requirement, not a side effect. (The
saga-pattern articles on this blog are the deeper treatment of this exact
trade-off in distributed systems.)

## 5. Part IV — Pattern Combinations: The Real Payment System

Real systems never use one pattern in isolation. Here is the payoff
section: the complete picture of what the payment service from the
introduction actually becomes when the design pressure is handled honestly —
five patterns, each solving the problem it was introduced for, composed at
a single point.

**The full shape:**

```text
PaymentService (business flow)
      │  depends only on abstractions (DIP)
      ▼
PaymentStrategy interface ────────────── Strategy (the family)
      ▲
      │  chosen by type
PaymentStrategyFactory ────────────────── Factory (selection logic)
      │
      └──► CardPaymentStrategy     ──► PaymentGateway (DIP port)
      └──► BankTransferStrategy    ──► PaymentGateway
      └──► WalletPaymentStrategy   ──► PaymentGateway
                                         │
                    Decorator stack       ▼
      ┌───────────────────────────────► RetryDecorator
      │  composed once, at wiring time   LoggingDecorator
      │                                  MetricsDecorator
      │                                  ▼
      │                          StripeGatewayAdapter ──► StripeSdk (Adapter)
      │                          AdyenGatewayAdapter  ──► AdyenSdk
```

**The code.** The strategies and the gateway interface you have already
seen. What remains is the composition point — in Spring, one configuration
class — because that is where patterns become a system:

```java
@Configuration
public class PaymentConfig {

    @Bean
    public PaymentGateway stripeGateway(StripeSdk stripe) {
        return new StripeGatewayAdapter(stripe);          // Adapter
    }

    @Bean
    public PaymentGateway adyenGateway(AdyenSdk adyen) {
        return new AdyenGatewayAdapter(adyen);            // Adapter
    }

    @Bean
    public PaymentGateway paymentGateway(PaymentGateway stripeGateway,
                                         PaymentGateway adyenGateway) {
        return new RetryDecorator(                        // Decorator: retry
                new LoggingDecorator(                     // Decorator: audit
                        new MetricsDecorator(             // Decorator: metrics
                                new RoutingGateway(stripeGateway, adyenGateway))),
                3, Duration.ofMillis(200));
    }

    @Bean
    public PaymentStrategyFactory paymentStrategyFactory(
            PaymentGateway gateway, CardGateway card, BankGateway bank, WalletGateway wallet) {
        Map<PaymentType, PaymentStrategy> strategies = new EnumMap<>(PaymentType.class);
        strategies.put(PaymentType.CARD, new CardPaymentStrategy(gateway, card));
        strategies.put(PaymentType.BANK_TRANSFER, new BankTransferStrategy(gateway, bank));
        strategies.put(PaymentType.E_WALLET, new WalletStrategy(gateway, wallet));
        return new PaymentStrategyFactory(strategies);    // Factory + Strategy
    }

    @Bean
    public PaymentService paymentService(PaymentStrategyFactory factory) {
        return new PaymentService(factory);               // DI everywhere
    }
}
```

**Why each piece exists — and who pays for what:**

| Piece                             | Problem it solves                            | Price                         |
| --------------------------------- | -------------------------------------------- | ----------------------------- |
| `PaymentStrategy` + factory       | Adding a payment type must not edit the flow | Indirection + registry        |
| `PaymentGateway` interface        | The flow must not depend on providers (DIP)  | One abstraction               |
| `StripeGatewayAdapter`/Adyen      | SDK types must not leak into business logic  | Translation layer per vendor  |
| `Retry/Logging/MetricsDecorator`  | Cross-cutting behavior without editing core  | Wrapping-order decisions      |
| `@Bean` wiring (composition root) | The graph is assembled in exactly one place  | Configuration lives centrally |

**How you should read this code.** The `PaymentService` — the business
flow — is ~15 lines and depends on nothing concrete. The complexity lives
in the composition root, in one file, where it is _visible_. That is the
entire argument for doing this: not fewer lines, but _fewer places where
change hurts_.

**What happens when developers overuse patterns in the same system.** Here
is the failure mode to recognize — the pattern-driven version of the same
service:

```java
// a real (compressed) example of pattern excess
public class PaymentProcessingCoordinatorService {
    private final PaymentStrategySelectorFactory providerFactory;
    private final PaymentGatewayRouterFacade gatewayRouter;
    private final PaymentRequestBuilderFactory requestBuilderFactory;
    private final PaymentAuditDecoratorFactory auditDecoratorFactory;
    ...
}
```

Twenty classes, each with a factory, each delegating to the next. A
developer tracing "how does a card payment work" must navigate: service →
selector → factory → strategy → router → facade → decorator → adapter →
SDK, six indirections deep, before seeing a single line of business logic.
Every class has a unit test that asserts "it calls the next class." The
architecture has become its own debugging tax.

The difference between the good version and the bad version is **not the
number of patterns** — both use the same five. It is:

1. **Each abstraction is a _boundary_** — it separates code that changes
   for different reasons. In the bad version, the boundaries are between
   code that changes for the same reason (they are decorators and routers
   of the _same_ flow, split for the sake of names).
2. **The composition is _visible and central_**. In the bad version, wiring
   is scattered (factories of factories); in the good version, one config
   class shows the whole system.
3. **The business flow is _short_**. If your orchestration class still
   needs five layers to do its job, the patterns were added _around_ it,
   not _for_ it.

The check that keeps pattern usage honest:

> **For every layer in your system, ask: does this layer make some change
> cheaper than it would otherwise be? If the layer only adds a name,
> delete the name.**

---

## 6. Part V — When SOLID and Design Patterns Make Your Code Worse

SOLID and the patterns are tools, and like all tools, they can be applied
to the wrong material. This part is the mirror image of everything above:
seven real failure modes, each with the recognition pattern and the
correction. Read this part as the checklist you apply _before_ applying
anything from Parts II and III.

### Case 1 — Interface for every class

```java
public interface UserService {
    void register(RegisterRequest request);
    void changePassword(String userId, String oldPassword, String newPassword);
}

public class UserServiceImpl implements UserService {
    // the ONLY implementation, and the interface adds nothing beyond
    // what the class already expresses
}
```

**When this adds little value:** one implementation, no second one on the
horizon, interface methods identical to the class's — and the only client
is Spring, which does not need the interface. This is the naming ceremony
from Section 3.5. The correction: delete the interface; `@Service` on the
concrete class; add the interface when a second implementation exists or
a real contract must be stated.

### Case 2 — Pattern-driven development

A developer who learned Strategy, Factory, Builder, Adapter, Facade this
week, and a small problem arrives:

```java
// the problem: send an email to the customer after checkout
public class EmailNotificationFactory {
    public NotificationSender create() { ... }
}

public class EmailNotificationStrategy implements NotificationSender {
    // one implementation, one strategy, no family
}

public class NotificationBuilder {
    public EmailNotificationBuilder withRecipient(...) { ... }
    public NotificationBuilder withMessage(...) { ... }
}

public class NotificationFacade {
    // forwards to the strategy, which wraps the builder, which wraps...
}
```

**Why it is wrong:** the patterns were chosen because they are patterns —
_"we use Strategy because Strategy is a good pattern"_ — not because a
family of algorithms exists. The single email send is buried under five
layers that each add nothing. **Correction:** `notificationService.send(new
Email(...))` — one class, one call. If a second channel arrives later,
_then_ the Strategy interface earns its existence.

### Case 3 — Over-abstraction of a single implementation

```java
OrderRepository          // interface
OrderRepositoryImpl      // the only implementation
OrderRepositoryFactory   // returns OrderRepositoryImpl
OrderRepositoryProvider  // provides the factory
OrderRepositoryManager   // manages the provider
OrderRepositoryResolver  // resolves the manager
```

**When this happens:** teams that believe "abstraction = architecture."
Every level is a synonym for the previous one. **Correction:** stop at the
first level. One interface (or none, see Case 1) is the boundary; the
remaining five names are navigation tax. The naming cascade is a
conversation you should be able to have out loud: _"which one does the
service depend on?"_ — if the answer requires a flowchart, the design
failed, not the reader.

### Case 4 — SRP fragmentation

```java
public class OrderValidationService {
    private final OrderItemsValidator itemsValidator;
    private final CustomerValidator customerValidator;
    private final PaymentMethodValidator paymentMethodValidator;
    private final ShippingAddressValidator shippingAddressValidator;
    private final OrderValidationAudit audit;

    public void validate(Order order) {
        itemsValidator.validate(order);
        customerValidator.validate(order);
        ...
    }
}
```

The original `OrderValidator.validate(order)` was 20 lines — readable in
one screen, changeable in one place. Now a change to validation requires
editing five classes, and the _order_ of validations is implicit in the
calling sequence. **The correction test:** split when the parts change at
different rates or for different actors (Section 3.1); do not split when
you are only reorganizing lines. A 20-line method is not a design problem;
the class that owns it is not a god class.

### Case 5 — OCP obsession

```java
public interface PriceProvider {
    BigDecimal getPrice(Order order);
}

public interface PriceProviderFactory {
    PriceProvider create(OrderType type);
}

public class StandardPriceProvider implements PriceProvider { ... }
public class PremiumPriceProvider implements PriceProvider { ... }
```

…for a pricing rule that has not changed in three years and has two
branches. Every rule in the system was interface-ified "so we never modify
existing code again." The result: every small rule change now touches an
interface, a factory, and a registration — the indirection is _more_
fragile than the original `if`. **The correction:** OCP protects a _real_
variation point; the interface exists to absorb a _known_ family of
changes, not every conceivable one. Constant, low-volatility logic can be
a plain `if` — and "we might need this later" is not a variation point, it
is a guess.

### Case 6 — Composition everywhere

Composition is powerful — this article has argued for it repeatedly. But
"favor composition" does not mean "never inherit." A legitimate
inheritance case:

```java
// all subclasses DO satisfy the parent's contract, are sealed, and are
// pure extensions — this hierarchy has been stable for years
public sealed class DomainException extends RuntimeException
        permits OrderNotFoundException, PaymentDeclinedException, InventoryUnavailableException {
    private final String code;

    public DomainException(String message, String code) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Exceptions are one of the few places where inheritance is _the right
mechanism_: every catch site that handles `DomainException` genuinely
handles all three subtypes, the hierarchy adds no new contract clauses, and
sealing prevents surprise subclasses. Forcing composition here ("each
exception _has a_ cause object"…) would make the code worse, not better.
**The correction:** the decision is about _substitutability_ (Section 2.3),
not fashion. If every caller of the parent can accept the subclass
unchanged — inheritance is a valid choice.

### Case 7 — Design pattern as cargo cult

The wrong reasoning, stated plainly:

> "We use Strategy because Strategy is a good pattern."

The right reasoning:

> "We have a family of interchangeable algorithms and expect new variants
> — Strategy gives us a place for each variant and keeps the dispatcher
> closed."

The difference is not cosmetic — the wrong reasoning _starts_ from the
pattern and _looks for_ a problem; the right reasoning _starts_ from the
problem and _checks_ whether the pattern addresses it. Every pattern in
this article was introduced problem-first for exactly this reason. When
you see a pattern in a codebase, the review question is never "is this a
correct Strategy?" — it is **"what problem is this solving, and is the
price proportional?"**

**The one-sentence summary of this whole part:** patterns and principles
are solutions in search of problems; the engineer's job is to keep them
honest by demanding the problem first.

## 7. Part VI — The Refactoring Case Study: OrderService, Step by Step

Everything so far, applied to one class in front of you. This is the most
important part of the article, so we go slowly: intentionally bad code,
then seven small steps — each one justified, each one priced. We do not
jump from bad to perfect in one leap, because real refactoring never does.
At every step, four questions are answered:

```text
What problem are we solving?
Why is this abstraction justified?
What complexity did we introduce?
Was the change worth it?
```

**The starting point.** The `OrderService` you saw in Section 3.1, with the
payment logic inlined to make the journey complete:

```java
public class OrderService {
    public void processOrder(Order order) {
        // 1. validation
        if (order.getItems().isEmpty()) {
            throw new IllegalArgumentException("order has no items");
        }
        if (order.getCustomer() == null || order.getCustomer().getEmail() == null) {
            throw new IllegalArgumentException("customer email is required");
        }

        // 2. pricing
        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.getItems()) {
            total = total.add(item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
        }
        if (total.compareTo(BigDecimal.valueOf(500)) > 0) {
            total = total.multiply(BigDecimal.valueOf(0.9));
        }
        order.setTotal(total);

        // 3. persistence
        // ... JDBC code: INSERT INTO orders ...

        // 4. payment
        if (order.getPayment().getType().equals("CARD")) {
            // ... 40 lines of card SDK calls ...
        } else if (order.getPayment().getType().equals("BANK_TRANSFER")) {
            // ... 40 lines of bank SDK calls ...
        } else {
            throw new UnsupportedOperationException("unknown payment type");
        }

        // 5. email
        // ... SMTP code: build and send confirmation ...

        // 6. logging
        System.out.println("Order processed: " + order.getId());
    }
}
```

About 90 lines, six responsibilities, four external systems hardwired, and
the SDK types from step 4 are leaking into every line around them. Now we
walk the seven steps. After each step you get the verdict — most steps are
worth it, one of them is a judgment call, and the final step is the one
you could honestly skip.

### Step 1 — Identify the responsibilities

**What we did:** nothing but read the class and write down the change
drivers.

| #   | Responsibility | Reason it changes                 | Changes at its own rate? |
| --- | -------------- | --------------------------------- | ------------------------ |
| 1   | Validation     | Business rules for who may order  | Yes                      |
| 2   | Pricing        | Discounts, tiers, taxes           | Yes                      |
| 3   | Persistence    | Schema, vendor, query tuning      | Yes                      |
| 4   | Payment        | Providers, payment types, retries | Yes — fastest            |
| 5   | Email          | Templates, providers              | Yes                      |
| 6   | Logging        | Observability requirements        | Yes                      |

Six responsibilities, six change drivers — one class. That is the diagnosis
(SRP, Section 3.1), and the cost-benefit is already visible: every one of
the six changes demands a modification to the same 90 lines.

**Worth it?** This step costs nothing and tells you exactly where to cut.

### Step 2 — Apply SRP: one class per responsibility

**The problem we solve:** the six drivers must stop sharing one file.

```java
public class OrderValidator {
    public void validate(Order order) {
        if (order.getItems().isEmpty()) {
            throw new IllegalArgumentException("order has no items");
        }
        if (order.getCustomer() == null || order.getCustomer().getEmail() == null) {
            throw new IllegalArgumentException("customer email is required");
        }
    }
}

public class OrderPricing {
    public BigDecimal calculateTotal(Order order) {
        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.getItems()) {
            total = total.add(item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
        }
        if (total.compareTo(BigDecimal.valueOf(500)) > 0) {
            total = total.multiply(BigDecimal.valueOf(0.9));
        }
        return total;
    }
}

public class OrderService {
    private final OrderValidator validator;
    private final OrderPricing pricing;
    private final OrderRepository repository;
    private final PaymentService paymentService;
    private final NotificationService notificationService;

    public OrderService(OrderValidator validator, OrderPricing pricing,
                        OrderRepository repository, PaymentService paymentService,
                        NotificationService notificationService) {
        this.validator = validator;
        this.pricing = pricing;
        this.repository = repository;
        this.paymentService = paymentService;
        this.notificationService = notificationService;
    }

    public void processOrder(Order order) {
        validator.validate(order);
        order.setTotal(pricing.calculateTotal(order));
        repository.save(order);
        paymentService.charge(order);
        notificationService.sendConfirmation(order);
    }
}
```

**What we introduced:** five new classes, five constructor parameters, and
the flow is now a sequence of calls. **What we bought:** each responsibility
is independently testable; a pricing change touches only `OrderPricing`;
an email outage no longer lives in the order flow's class.

**Worth it?** Yes — and it was cheap. This step alone would already have
stopped the opening story's `PaymentService` from reaching 1,500 lines.

### Step 3 — Introduce abstractions where variation exists

**The problem we solve:** step 2 still leaves the _payment_ variation
buried — `PaymentService.charge()` is a switchboard. Look at what varies:
payment types, providers, retry behavior. That is a _family_, and the
abstraction belongs where the family is.

```java
public interface PaymentGateway {
    PaymentResult pay(PaymentRequest request);
}
```

**Why this abstraction is justified:** a real, observed variation exists
(CARD / BANK_TRANSFER today; the business has already announced crypto for
next quarter). The abstraction sits at the boundary between the order flow
(which should not know payment mechanics) and the providers (which should
not be dictated by the order flow).

**What we introduced:** an interface and domain types (`PaymentRequest`,
`PaymentResult`) that replace SDK vocabulary in the flow.

**Worth it?** Yes — but note what did NOT happen: we did not create
interfaces for `OrderValidator` or `OrderPricing`. They have no variation.
The abstraction was introduced _only_ where variation is real — that is the
judgment call working (OCP, Section 3.2).

### Step 4 — Apply Strategy: the family gets a place to live

**The problem we solve:** "add a payment type" must stop being "edit the
switchboard."

```java
public interface PaymentStrategy {
    PaymentResult pay(Payment payment);
}

public class CardPaymentStrategy implements PaymentStrategy {
    private final PaymentGateway gateway;
    private final CardGateway cardGateway;

    public CardPaymentStrategy(PaymentGateway gateway, CardGateway cardGateway) {
        this.gateway = gateway;
        this.cardGateway = cardGateway;
    }

    @Override
    public PaymentResult pay(Payment payment) {
        return gateway.pay(PaymentRequest.from(payment, cardGateway));
    }
}
```

…plus `BankTransferPaymentStrategy`, plus a factory that owns the
`Map<PaymentType, PaymentStrategy>` (Section 4.1). The payment flow is now:

```java
PaymentStrategy strategy = strategyFactory.forType(order.getPayment().getType());
strategy.pay(order.getPayment());
```

**What we introduced:** one interface, N implementations, one registry —
and the _dispatch decision_ moved out of business flow into data
(EnumMap). **Was it worth it?** Yes, measured against the actual business
roadmap (a new type per quarter). If the roadmap had said "never," step 4
would be the step to skip — a two-branch `if` in `PaymentService` would be
simpler (Section 2.4's special case).

### Step 5 — Apply Dependency Inversion: point the arrows

**The problem we solve:** the classes now depend on _each other_ (concrete
types), not on contracts. Testability and replacement are coupled to
construction.

**Before** — the flow depends on concrete classes, and swapping storage
means editing the flow:

```java
private final OrderRepository repository;      // concrete — see step 6
private final PaymentService paymentService;   // concrete
```

**After** — everything the flow needs is behind an interface it owns:

```java
public interface OrderRepository {
    void save(Order order);
    Order findById(String id);
}

public interface PaymentService {               // the policy's requirement
    void charge(Order order);
}
```

```java
public class OrderService {
    private final OrderValidator validator;
    private final OrderPricing pricing;
    private final OrderRepository repository;    // now an interface
    private final PaymentService paymentService; // now an interface
    private final NotificationService notificationService;
    ...
}
```

Construction happens in the composition root (a Spring `@Configuration`
class or `main()`):

```java
OrderService service = new OrderService(
        new OrderValidator(),
        new OrderPricing(),
        new MySqlOrderRepository(dataSource),    // detail, chosen at the root
        new PaymentService(paymentStrategyFactory),
        new SmtpNotificationService());
```

**Why this abstraction is justified:** the storage and payment details
change at their own rates; the policy must not change when they do. **What
we introduced:** two interfaces and a composition root — but note the
_absence_: no interfaces for `OrderValidator` and `OrderPricing`, again.
**Worth it?** Yes — this is what makes the whole system testable with
in-memory fakes and swappable in production.

### Step 6 — Introduce the Adapter for the external payment provider

**The problem we solve:** the SDK types are still leaking. Somewhere inside
the strategies, the code calls `stripe.charge(...)` and catches
`StripeDeclinedException` — in the business flow. One provider's vocabulary
is in the flow; the second provider is coming, and each will try to bring
its own vocabulary.

**Before** (inside a strategy):

```java
public class CardPaymentStrategy implements PaymentStrategy {
    private final StripeSdk stripe;

    @Override
    public PaymentResult pay(Payment payment) {
        try {
            StripeCharge charge = stripe.charge(payment.getToken(), toCents(...), "USD");
            return PaymentResult.success(charge.getId());
        } catch (StripeDeclinedException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }
}
```

**After** — the SDK call moves behind the adapter (Section 4.4), and the
strategy talks to the domain boundary:

```java
public class CardPaymentStrategy implements PaymentStrategy {
    private final PaymentGateway gateway;

    @Override
    public PaymentResult pay(Payment payment) {
        return gateway.pay(PaymentRequest.from(payment));
    }
}
```

**Why this abstraction is justified:** the provider boundary is the single
most volatile place in the system — new vendors, SDK upgrades, exception
vocabularies. The adapter absorbs all of it. **What we introduced:** one
adapter per provider, with a small translation ceremony. **Worth it?**
Yes — this is the cheapest insurance in the whole article: when Stripe
releases SDK v2, exactly one class changes.

### Step 7 — Add the Decorator for retry, logging, metrics

**The problem we solve:** retry/audit/metrics are cross-cutting — every
payment, every provider, and they must combine. Hardwiring them into
strategies or the adapter duplicates them per provider (Section 4.5).

```java
PaymentGateway gateway = new RetryDecorator(
        new LoggingDecorator(
                new MetricsDecorator(
                        new StripeGatewayAdapter(stripe))),
        3, Duration.ofMillis(200));
```

**Why this abstraction is justified:** the behaviors combine with the
providers multiplicatively — decorators keep that N + M instead of N × M.
**What we introduced:** three small classes and a wrapping order that must
be deliberate. **Worth it?** Yes when behaviors vary or are
configurable; this is also the step to _skip_ when retry is a simple,
unconditional loop inside the adapter — the decorator's flexibility would
be unused (the "when overkill" case in Section 4.5).

### The final state — and the honest accounting

```java
public class OrderService {
    // 5 injected collaborators, all interfaces except the validators
    // processOrder: 6 lines — validation, pricing, save, pay, notify, log

    public void processOrder(Order order) {
        validator.validate(order);
        order.setTotal(pricing.calculateTotal(order));
        repository.save(order);
        paymentService.charge(order);
        notificationService.sendConfirmation(order);
        logger.info("Order {} processed", order.getId());
    }
}
```

| Step | Complexity added                     | Risk removed                                  | Verdict                    |
| ---- | ------------------------------------ | --------------------------------------------- | -------------------------- |
| 1    | none                                 | none (diagnosis)                              | always                     |
| 2    | 5 classes + 5 ctor params            | Six change drivers stop sharing a file        | cheap win                  |
| 3    | 1 interface + domain types           | SDK vocabulary out of the flow                | cheap win                  |
| 4    | strategy interface + N classes + map | New payment types no longer edit the flow     | win only if types grow     |
| 5    | 2 interfaces + composition root      | Policy decoupled from storage/payment details | win                        |
| 6    | 1 adapter per provider               | Provider swaps/SDK upgrades isolated          | win                        |
| 7    | 3 decorator classes + wrapping order | Retry/audit/metrics composable per provider   | win only if behaviors vary |

The original 90-line class became ~25 lines of orchestration plus
well-placed collaborators. **The class did not get smaller — the system
did.** That is the only metric that matters: the number of places where a
given change can hurt.

**And what we deliberately did NOT do** — the discipline is as important as
the pattern:

- No interfaces for `OrderValidator`/`OrderPricing` (no variation).
- No factory for the validators (nothing to decide).
- No repository hierarchy beyond `OrderRepository` (one implementation).
- No event bus for the notification (a synchronous email is a requirement,
  not a side effect — Section 4.6's rule of thumb).

## 8. Part VII — Java-Specific Considerations: What Modern Java Changes

Every principle and pattern in this article was designed for a Java that
did not have records, sealed classes, lambdas, or pattern matching. Modern
Java does not invalidate the principles — but it _relocates the
boilerplate_ and, in several places, makes a pattern unnecessary. This
part goes through the features that matter and what each one does to the
decision-making above.

### 8.1 Records: The Value Object With No Boilerplate

The immutable domain types that Parts II–III built by hand (`PaymentRequest`,
`PaymentResult`, `OrderCreatedEvent`, the `User` from the Builder section)
are exactly what records were created for:

```java
public record PaymentRequest(
        String orderId,
        BigDecimal amount,
        String currency,
        PaymentMethod method) {

    public PaymentRequest {                          // compact constructor
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("invalid currency: " + currency);
        }
    }
}
```

One declaration gives: immutable fields, canonical constructor, `equals`/
`hashCode`/`toString`, and the validation that `BankAccount`'s constructor
and the Builder's `build()` performed by hand. The encapsulation lesson
(Section 2.1) still applies — records are only as good as their invariant
checks — but the ceremony is gone.

**Records vs Builder — the head-to-head the intro promised:**

| Concern         | Builder (Section 4.3)            | record + static factory                    |
| --------------- | -------------------------------- | ------------------------------------------ |
| Boilerplate     | ~10 lines per field              | 1 line per field                           |
| Readability     | Fluent, labeled steps            | `new` with positional args                 |
| Validation      | In `build()`                     | In compact constructor                     |
| Optional fields | Omitting a step, naturally       | Every field required (by design)           |
| Best for        | 8+ fields with mixed optionality | ≤ 6 fields, all mandatory                  |
| Custom variants | —                                | Static factory: `User.createCustomer(...)` |

The rule: **a record is now the default for value objects; the Builder
remains for the genuinely large, partly-optional construction** — and even
then, a record can be the built product. The Builder's remaining virtue is
argument labeling; if records and static factories cover your cases, the
Builder is the pattern modern Java made optional.

### 8.2 Sealed Classes: Making the Family Explicit

The recurring theme of this article — _the variation point is real, the
family is known_ — is precisely what `sealed` formalizes:

```java
public sealed interface PaymentMethod permits Card, BankTransfer, Wallet {
}

public record Card(String token, String brand) implements PaymentMethod { }
public record BankTransfer(String iban, String accountName) implements PaymentMethod { }
public record Wallet(String walletId) implements PaymentMethod { }
```

The compiler now _enforces_ the family: no unknown subclass can exist, and
a switch over `PaymentMethod` can be **exhaustive** — the compiler proves
you handled every variant:

```java
public PaymentResult pay(PaymentMethod method, PaymentGateway gateway) {
    return switch (method) {
        case Card card -> gateway.pay(cardPaymentRequest(card));
        case BankTransfer bank -> gateway.pay(bankPaymentRequest(bank));
        case Wallet wallet -> gateway.pay(walletPaymentRequest(wallet));
    };
}
```

What sealed changes for this article:

- **LSP (Section 3.3)** becomes enforceable: the compiler limits who may
  subclass, and the sealed hierarchy _is_ the design documentation — the
  family is closed by contract, not by convention.
- **OCP (Section 3.2)** gets its flip side: for a _sealed_ family, "closed
  for modification" is desired. Adding a variant requires editing the
  sealed declaration — which forces you to revisit every exhaustive
  `switch` — instead of silently missing the registration map entry.
  Sealed hierarchies say: _this variation is complete; handle it
  everywhere or nowhere_.
- **Strategy (Section 4.1)** with a sealed family often reduces to a
  sealed enum or sealed interface + exhaustive switch — the strategy
  classes are needed only when variants carry _heavy_ state and
  dependencies.

### 8.3 Enums: Strategy in Disguise

For behavior that varies by a _fixed, known_ set, the enum is the classic
Java trick that predates all of this:

```java
public enum ShippingMethod {
    STANDARD {
        @Override
        public Duration estimateDelivery() {
            return Duration.ofDays(5);
        }
    },
    EXPRESS {
        @Override
        public Duration estimateDelivery() {
            return Duration.ofDays(1);
        }
    };

    public abstract Duration estimateDelivery();
}
```

…or, cleaner in modern Java, an interface field:

```java
public enum ShippingMethod {
    STANDARD(shipping -> shipping.getWeight().multiply(BigDecimal.valueOf(2))),
    EXPRESS(shipping -> shipping.getWeight().multiply(BigDecimal.valueOf(8)));

    private final Function<Shipping, BigDecimal> price;
    ShippingMethod(Function<Shipping, BigDecimal> price) {
        this.price = price;
    }

    public BigDecimal priceFor(Shipping shipping) {
        return price.apply(shipping);
    }
}
```

Enum-based behavior is the _simplest_ Strategy: no classes, no registry,
dispatch by the enum constant itself. It is the right call when the family
is **closed** (sealed by nature: shipping methods, order statuses, report
formats) and the behavior is small. It is the wrong call when variants
carry their own dependencies (a strategy needing a gateway, a repository)
— an enum cannot be constructed per-dependency.

### 8.4 Lambdas and Functional Interfaces: Strategy Without Classes

The single-method interfaces from Parts II–IV are all functional
interfaces. A `PaymentStrategy` can be a lambda; decorators can be
composed functions. The classic comparison:

```java
// the Strategy pattern, classically
public class CardPaymentStrategy implements PaymentStrategy { ... }
strategies.put(CARD, new CardPaymentStrategy(cardGateway));

// the same strategy as a lambda
strategies.put(CARD, payment -> cardGateway.charge(payment.getReference(), payment.getAmount()));
```

And the decorator as function composition:

```java
static PaymentGateway withRetry(PaymentGateway delegate, int attempts, Duration backoff) {
    return request -> {
        PaymentResult result = delegate.pay(request);
        for (int i = 1; !result.isSuccess() && i < attempts; i++) {
            sleepQuietly(backoff.multipliedBy(i));
            result = delegate.pay(request);
        }
        return result;
    };
}

private static void sleepQuietly(Duration duration) {
    try {
        Thread.sleep(duration);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}

PaymentGateway gateway = withRetry(stripeAdapter, 3, Duration.ofMillis(200));
```

**What lambdas change:** the _family_ still exists (the problem is real),
but the _classes_ often do not need to. When the variant is stateless or
small, a lambda is the whole Strategy; when it accumulates state and
dependencies, upgrade to a class. **The caution:** lambdas make
over-abstraction cheaper to write, not more justified — a two-branch `if`
is still better than a two-entry lambda map (Section 2.4's special case
applies unchanged).

### 8.5 Pattern Matching: The `if/else` Replacement That Is Not Polymorphism

```java
// before: instanceof chain
if (payment instanceof CardPayment cardPayment) {
    ...
} else if (payment instanceof BankTransferPayment bankPayment) {
    ...
}

// after: exhaustive sealed switch (Section 8.2)
```

Pattern matching does not _replace_ polymorphism — it replaces the
`instanceof`/cast idiom, and it changes where the dispatch lives. Use the
sealed switch when the family is closed and the handling is local; use
polymorphism when each variant must _own_ its behavior and be extended
independently. The distinction is the same one from Section 2.4: who owns
the behavior — the caller or the variant?

### 8.6 `Optional`: Honest Absence

`Optional<T>` is the modern answer to the LSP problem from Section 3.3 —
the repository that "returns null sometimes":

```java
public interface OrderRepository {
    Optional<Order> findById(String id);   // the contract says absence is possible
}
```

Used at the boundary, `Optional` makes the _contract_ honest, so
implementations cannot silently weaken it. The special cases matter:

- **Return type only** — `Optional` is for return values and `Stream`
  operations; it is not a field type, not a parameter type, not a
  collection element. An `Optional<Order> order` field is a code smell —
  it cannot be serialized sensibly, invites `get()`-without-check, and
  signals that the model is not sure what it holds.
- **Not a substitute for validation** — `Optional.ofNullable` does not
  replace the invariant checks in Section 2.1; it complements them.

### 8.7 Immutability: The Language Finally Helps

`List.copyOf`, `Set.copyOf`, `Map.copyOf`, `Stream.toList()`,
unmodifiable collection views, `String`/`BigDecimal`/`LocalDate` already
immutable, records for value objects — modern Java makes the immutable
default cheap. This directly reinforces Section 2.1: the defensive copies
are often still needed (constructors taking mutable collections), but the
_mutability surface_ you must defend has shrunk dramatically.

### 8.8 What modern Java does NOT change

Nothing above removes the _judgment_: which variation point is real, which
abstraction earns its indirection, whether the family is closed or open.
Records do not make Builder-thinking obsolete for large objects; sealed
does not make Strategy obsolete for heavy variants; lambdas do not make
the "when NOT to" cases from Part V disappear. The tools got sharper —
the engineering judgment is still yours.

---

## 9. Part VIII — Mental Models: Questions to Ask in Code Review

An article cannot hand you judgment; it can hand you questions. Here are
the questions that force the judgment — the ones to run through when a
class, a design, or a pull request needs evaluation. They map one-to-one
onto the sections above; each question has a "signal" — the answer that
means a problem.

### OOP

| Question                                     | Signal of trouble                                                  |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Who owns this state?                         | Several classes mutate the same object                             |
| Who is allowed to modify it?                 | Fields or internal collections escape                              |
| What invariant must be protected?            | No method enforces it — callers must remember                      |
| Is this really an "is-a" relationship?       | `instanceof` checks in callers; `extends` without substitutability |
| What does this abstraction hide?             | SDK types, provider names, or config in callers                    |
| Does this abstraction hide a real variation? | One implementation, no second in sight                             |

### SOLID

| Question                                                   | Signal of trouble                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| What is likely to change here?                             | The class changes for many different reasons                                            |
| What dependency is causing the coupling?                   | A change in X forces changes in Y                                                       |
| Are we adding this interface because we need it?           | The interface mirrors the class; no second variant                                      |
| Are we splitting responsibilities or just splitting files? | 10 classes, each forwarding to the next                                                 |
| Could a subclass weaken the parent's contract?             | Subclasses throw `UnsupportedOperationException`, return null, strengthen preconditions |
| Who does this interface serve?                             | Clients depend on methods they never call                                               |
| Which direction do the dependencies point?                 | Policy classes reference vendor/SDK classes                                             |
| Is Spring doing DI or is the code doing DIP?               | Interfaces exist only because Spring "requires" them (it does not)                      |

### Design Patterns

| Question                                 | Signal of trouble                                 |
| ---------------------------------------- | ------------------------------------------------- |
| What problem does this pattern solve?    | No problem stated before the pattern              |
| What complexity does it introduce?       | Layers that only add names                        |
| What happens if we don't use it?         | "We'll add it later" is easy → don't build it now |
| Is the variation real or hypothetical?   | "We might need..." with no roadmap                |
| Where is the composition/wiring visible? | Factories-of-factories, wiring scattered          |
| Would a `switch` or an `if` be simpler?  | One-line branches behind interfaces               |

**How to use these:** code review is not pattern-spotting ("that's a
Strategy, approved!"). It is question-asking with evidence. When a review
comment says "why not use X pattern here?", the honest reply is either a
problem statement — or the deletion of the pattern.

---

## 10. Part IX — The Final Decision Framework

Put it all together. When you face a design decision in real code, the
flow is a tree — and the branches are about _what is changing_, not about
pattern names:

```text
Do I have a design problem? (symptoms: Section 1)
        |
        +-- No  → stop. Don't decorate working code.
        |
        v
What is changing?
        |
        +--> Behavior/algorithm varies by type
        |        → Strategy / polymorphism / sealed switch
        |
        +--> New variants keep appearing
        |        → Strategy + registry (OCP)
        |
        +--> Object creation involves decisions
        |        → Simple Factory
        |        → Factory Method (flow fixed, object varies)
        |        → Abstract Factory (families must stay consistent)
        |
        +--> Constructing an object is unreadable
        |        → Builder (many optional fields)
        |        → record + static factory (most value objects)
        |
        +--> External API does not match my model
        |        → Adapter (keep SDK types out of the domain)
        |
        +--> Need behavior added without touching core
        |        → Decorator (N + M, not N × M)
        |
        +--> One event, many consequences
        |        → Spring events (in-process, sync/async)
        |        → Kafka (cross-process, async, eventual)
        |
        +--> High-level code depends on implementation
        |        → Dependency Inversion (own the abstraction)
        |        → constructor injection + composition root
        |
        +--> Multiple responsibilities, multiple change drivers
                 → SRP (split by rate/actor of change — not by lines)

After choosing, ask three times:
  1. What complexity did I just add?
  2. What happens if I don't add it?
  3. Is the variation real, or hypothetical?
If answer 3 is "hypothetical" — remove it.
```

And the sentence that should survive every design discussion:

> **Patterns are tools, not goals.** A Strategy that solves no variation,
> a Factory that only wraps `new`, an interface with one implementation,
> an SRP split that fragments without isolating — these are the cargo
> cults of Section 6, and they outnumber the genuine designs in most
> codebases. The goal is never "use the right pattern." The goal is
> "make the change that is coming cheap, and everything else simple."

---

## Conclusion

You started with a `PaymentService` that grew to 1,500 lines — six
responsibilities, hardwired dependencies, and SDK vocabulary leaking into
the business flow. Then you followed the whole arc: what encapsulation
actually protects (invariants, not fields), what abstraction should and
should not hide (real variation, not structure), when inheritance is a
trap (whenever substitutability fails), and when polymorphism is overkill
(when the branches are rules, not algorithms). The SOLID principles were
each priced, not praised: one reason to change, protect the variation
point, honor the behavioral contract, size interfaces for clients, and
point dependencies at abstractions you own. The patterns were introduced
as problem solutions with stated costs — Strategy, Factory, Builder,
Adapter, Decorator, Observer — and the combinations section showed what a
real payment system looks like when each abstraction is a genuine
boundary. Then the mirror: seven ways SOLID and patterns make code worse,
and the seven-step refactoring where each step had to justify itself.
Finally, modern Java's features — records, sealed classes, enums,
lambdas, pattern matching, `Optional` — relocated the boilerplate but not
the judgment.

The whole article reduces to four sentences:

1. **Every design decision is a bet on what will change.**
2. **Abstractions are boundaries between things that change at different
   rates — nothing else justifies them.**
3. **A principle or pattern is a solution to a problem; if you cannot
   state the problem, the solution is cargo cult.**
4. **The skill is not knowing the patterns — it is looking at a real
   codebase, identifying the design pressure, choosing the smallest
   technique that relieves it, and refusing the ones that would add
   complexity without removing risk.**

That is the difference between knowing what SOLID is and being able to
use it. Next time a `PaymentService` lands in your review, don't ask
"which pattern should this use?" — ask _what is changing, and who should
pay for it_.

---
