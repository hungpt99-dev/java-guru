---
title: "Java Interview Prep #1: Java Core and Concurrency"
description: "A practical Java Core interview guide covering JVM memory, garbage collection, the Java Memory Model, and concurrency, from foundational questions to production trade-offs."
pubDatetime: 2026-08-10T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

Java Core interviews are difficult for a specific reason: knowing the vocabulary is not enough. You need to explain what the runtime guarantees, where an abstraction leaks, and how you would investigate a failure. This article starts with JVM and language fundamentals, then moves toward garbage-collection trade-offs. The questions are grouped by difficulty; prepare for the level you need, then read one section further.

The distinction is practical: a junior answer defines a collector, while a senior answer connects collector behavior to allocation rate, object lifetime, pause time, and the evidence they would collect before changing configuration.

## Junior: Foundations

**Q1. What are the main memory areas of the JVM?**

[SOURCE FACT] The JVM specification describes the **heap** for object instances, **method-area metadata** (implemented as metaspace in HotSpot, which replaced PermGen), a **stack** for each thread, a per-thread **PC register**, and **native method stacks**. Stack frames contain data such as local variables and operand stacks. In the usual Java programming model, objects created with `new` are allocated on the heap, and a method invocation creates a frame on the calling thread's stack. The exact memory layout is implementation-dependent.

**Q2. What is the difference between `==` and `equals()`?**

For object references, `==` checks identity: whether both references point to the same object. `equals()` is a method for logical equality, but its behavior depends on the class. A value type that overrides `equals()` should also override `hashCode()` consistently. Two equal-looking strings are not necessarily identical; a string literal and a separately constructed string are different objects:

```java
String a = "java";
String b = new String("java");
System.out.println(a == b);      // false: different objects
System.out.println(a.equals(b)); // true: same characters
```

**Q3. What are the primitive types, and are they objects?**

Java has eight primitive types: `byte`, `short`, `int`, `long`, `float`, `double`, `char`, and `boolean`. A primitive value is not an object. A variable of a reference type refers to an object, which is normally managed on the heap. Autoboxing converts between a primitive and its wrapper, such as `int` and `Integer`.

The wrapper caches are an implementation detail except where the Java specification requires the behavior. For `Integer`, values from `-128` through `127` are cached by `valueOf`, so identity comparisons can appear to work for those values. Do not use `==` to compare wrapper values:

```java
Integer a = Integer.valueOf(42);
Integer b = Integer.valueOf(42);
System.out.println(a == b); // true for the required cache range

Integer c = Integer.valueOf(200);
Integer d = Integer.valueOf(200);
System.out.println(c == d); // do not rely on this being true
```

**Q4. How do `String`, `StringBuilder`, and `StringBuffer` differ?**

`String` is immutable. An operation that appears to modify it produces another string. `StringBuilder` is mutable and is not thread-safe, so it is the normal choice for assembling text within one thread. `StringBuffer` provides synchronized methods and is usually unnecessary unless that specific synchronization contract is required.

Repeated concatenation with `String` inside a loop can create many intermediate objects. Use `StringBuilder` when the construction pattern is incremental and performance or allocation matters.

**Q5. What do `final`, `finally`, and `finalize()` mean?**

`final` prevents reassignment of a variable, overriding of a method, or subclassing of a class, depending on where it is applied. `finally` is a control-flow block that normally runs after `try` and any matching `catch`, including when an exception is thrown. It is not a substitute for structured resource management.

`finalize()` is a deprecated, unreliable cleanup hook that the runtime is not required to invoke promptly. Do not use it for resource management. Prefer `try-with-resources`; `Cleaner` is a fallback for limited cleanup cases, not deterministic resource ownership.

**Q6. What is the difference between checked and unchecked exceptions?**

Checked exceptions must be caught or declared. Unchecked throwables include `RuntimeException` and `Error`, and do not have that compile-time requirement. The useful distinction is not simply "recoverable" versus "unrecoverable": an API should make callers handle a condition when recovery is part of the contract, and should not force exception handling that cannot produce a meaningful response. Programming errors are generally represented by unchecked exceptions.

**Q7. What is autoboxing, and what trap does it introduce?**

Autoboxing converts a primitive to its wrapper type, such as `int` to `Integer`; unboxing performs the reverse conversion. The wrapper is an object and may be `null`, so an implicit unboxing operation can throw `NullPointerException`:

```java
Integer i = null;
int x = i; // NullPointerException during unboxing
```

The same issue can appear in arithmetic, comparisons, or method calls where the compiler inserts unboxing. Make nullable values explicit at API boundaries.

**Q8. What is the practical difference between `int` and `Integer` in a collection?**

Java collections store references, not primitive values. A `List<Integer>` therefore boxes each value, which adds object and reference overhead and can increase GC work. The cost depends on the JVM, object layout, collection implementation, and value reuse; it should not be reduced to a universal byte count. If memory or throughput is important, consider `int[]` or a primitive-oriented collection rather than assuming boxing is free.

**Q9. How does `switch` on `String` work?**

For a `String` switch, the compiler generates code that uses string hash values and equality checks to select a branch. The generated form is an implementation detail and can vary, so the source-level guarantee is only the switch behavior, not a particular data structure or constant-time cost. `String.hashCode()` and `equals()` still matter, especially for large or frequently evaluated switches. Choose an `enum` or another domain-specific representation when it expresses the domain better, not because of an unsupported nanosecond comparison.

**Q10. What is a `static` initializer, and when does it run?**

A `static {}` block runs as part of class initialization, at most once per class loader, before the class is actively used. Class loading and class initialization are separate concepts; loading alone does not mean that every static initializer has run. A failure during initialization can prevent subsequent use of that class and surface as `ExceptionInInitializerError` or a related initialization failure. Keep static initialization small and deterministic.

**Q11. What is the difference between `this` and `super`?**

`this` refers to the current object. `super` selects members from the superclass, which is useful when a subclass overrides a method but needs the parent implementation. `super()` invokes a superclass constructor and, when written explicitly, must be the first statement in the constructor. If no constructor invocation is written, Java inserts a call to the accessible no-argument superclass constructor when one exists.

**Q12. How is method overloading resolved?**

Overloading is resolved by the compiler using the declared types at the call site. It selects the most specific applicable overload; runtime types do not change that selection. For example, if both `log(Object)` and `log(String)` exist, `log(null)` selects `log(String)`. If the candidates are unrelated, the call is ambiguous at compile time.

**Q13. What is the default value of an uninitialized field, and how does that differ from a local variable?**

Fields receive type-specific default values such as `0`, `false`, and `null` before explicit initialization. Local variables do not receive an implicit default that the compiler lets you use; definite-assignment analysis requires a value before a read. Therefore this does not compile:

```java
int x;
System.out.println(x);
```

**Q14. What is the difference between `>>` and `>>>`?**

`>>` is an arithmetic right shift: it preserves the sign bit. `>>>` is a logical right shift: it fills from the left with zeroes. For example, `-8 >> 1` is `-4`, while `-8 >>> 1` produces a large positive `int` because the sign bit is cleared. Use `>>>` when the value is being treated as an unsigned bit pattern.

**Q15. What is the difference between `Math.round()`, `ceil()`, and `floor()`?**

`Math.round()` returns the nearest integral result according to its specified tie behavior. `Math.ceil()` returns the smallest `double` greater than or equal to the argument, while `Math.floor()` returns the largest `double` less than or equal to it. Negative values are the common trap: `Math.round(-2.5)` returns `-2`, toward positive infinity rather than away from zero.

## Mid: Trade-offs and pitfalls

**Q1. How does generational garbage collection work, and what can go wrong in production?**

[SOURCE FACT] A generational collector separates objects by age. In the traditional model, the young generation contains Eden and Survivor spaces, while longer-lived objects are promoted to the old generation. A young-collection cycle reclaims unreachable objects in the young generation and may copy or promote surviving objects. Collection of older regions can involve more work and may contribute to longer pauses, depending on the collector and its configuration.

[ANALYSIS] The model is a useful starting point, not a production diagnosis. Allocation rate, object lifetime, live-set size, reference patterns, collector choice, heap sizing, and application behavior all affect pause time and throughput. A service can suffer from allocation bursts, promotion pressure, a large live set, or an actual leak. Before changing GC flags, inspect GC logs and correlate pauses with allocation, heap occupancy, CPU, request latency, and application events. Any claim about a particular pause reduction or heap size belongs to a measured case study and should not be presented as a general result.
