---
title: "How Java Actually Works: Inside the JVM from Bytecode to Garbage Collection"
description: "Follow the journey of a Java program from source code into the JVM — method calls, object allocation, JIT optimization, and garbage collection explained at a deeper level than typical stack-vs-heap tutorials."
pubDatetime: 2026-08-10T10:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - jvm
  - garbage-collection
  - performance
---

You probably write code like this every day:

```java
public static void main(String[] args) {
    User user = new User("Hung");
    process(user);
}
```

At first glance, this looks simple. Create an object. Pass it to a method. Done.

But here is where the JVM becomes interesting. Between the moment you press Enter and the moment this code actually executes on your CPU, an entire machinery comes to life: a compiler produces intermediate instructions, a runtime environment verifies, loads, and links classes, a machine interprets your code while secretly profiling it, a just-in-time compiler rewrites it into native instructions, memory is allocated from arenas you never see, and eventually, a garbage collector decides — according to its own schedule — when the `User` object is allowed to die.

This article is a field trip inside that machinery. We are going to follow one tiny program from source code to CPU, answering one question at every step:

> What really happens from the moment Java code starts running until objects are created, used, and eventually garbage collected?

You already know Java syntax. This article is about what runs underneath it.

## 1. The Big Picture — What Happens When You Run a Java Program?

### The journey in one diagram

```
  .java source
      │
      │  javac (the compiler)
      ▼
  .class file  ────  bytecode: platform-independent instructions
      │
      │  java <Main>  (the launcher starts the JVM)
      ▼
  ┌────────────────────────── JVM ──────────────────────────┐
  │  Class loading  →  Bytecode verification  →  Linking   │
  │                                                         │
  │  Execution engine:                                      │
  │    Interpreter ──(hot method detected)──► JIT compiler  │
  │        │                                   │            │
  │        └─────────► native machine code ◄────┘            │
  │                                                         │
  │  Runtime services: GC  ·  Threads  ·  Exceptions  · ... │
  └──────────────────────────┬──────────────────────────────┘
                             │
                             ▼
                           CPU
```

### What Java bytecode actually is

When you run `javac Main.java`, the compiler does **not** produce machine code for your laptop's x86 or ARM processor. It produces a `.class` file containing **bytecode** — an instruction set defined by the Java Virtual Machine Specification, not by any real hardware.

Each bytecode instruction is one byte long (hence the name), and there are only a few hundred of them. Instructions like:

- `new` — allocate an object
- `invokespecial` — call a constructor or private method
- `invokestatic` — call a static method
- `aload_1` — load a reference from a local variable slot
- `iadd` — add two integers from the operand stack

You can see the bytecode of any compiled class with a tool you already have:

```bash
javap -c Main
```

Later in this article we will literally read the bytecode of our example program. This is the first reason Java "runs everywhere": the compiler targets a fictional machine, and it is the job of each platform's JVM to make that fictional machine real.

### Why Java can run on different operating systems

"Write once, run anywhere" is not magic — it is an act of delegation. Java code is compiled once, to bytecode. The **JVM is the execution environment** that interprets or compiles that bytecode into the native instructions of whatever OS and CPU it happens to be running on: macOS needs one JVM build, Linux another, Windows another — but they all run the identical `.class` file.

In other words, the JVM is the compatibility layer. Your program never talks to the operating system directly for memory, threads, or code execution; it talks to the JVM, and the JVM talks to the OS. The portable unit is not the program — it is the runtime contract.

### Class loading at a high level

Before any code executes, the JVM must find and load the classes it needs. This is done by **class loaders**, organized in a hierarchy:

```
                     ┌──────────────────────────────┐
                     │  Bootstrap class loader      │  JDK core classes
                     │  (java.base, java.lang, ...) │  (java/lang/String, ...)
                     └──────────────┬───────────────┘
                                    │  parent
                     ┌──────────────▼───────────────┐
                     │  Platform class loader        │  JDK modules
                     └──────────────┬───────────────┘
                                    │  parent
                     ┌──────────────▼───────────────┐
                     │  Application class loader     │  your classes on the
                     │  (classpath)                  │  classpath
                     └──────────────────────────────┘
```

When a class is needed, the JVM's loading process asks its class loader, which normally first **delegates to its parent** — a model that ensures, for example, that `java.lang.String` always comes from the JDK and can never be replaced by a classpath copy.

Once a class file is found, it is **verified** (the JVM checks the bytecode is well-formed and type-safe — this is why garbage bytecode cannot crash a conforming JVM the way garbage machine code can crash your OS), then **linked**, then — only when first actively used — **initialized** (static initializers run). Classes are loaded **lazily**: at startup, the JVM loads only what it needs.

### Interpreter vs JIT compiler — and why warm-up matters

Now the loaded `main` method is ready to execute. But execute _how_? Two strategies exist:

- **Interpretation:** the JVM walks through the bytecode instruction by instruction and executes each one. Simple, correct, and slow.
- **Compilation:** a **JIT (Just-In-Time) compiler** translates a method's bytecode into native machine code once, then runs the native version directly.

Modern HotSpot does both, in tiers. A method starts interpreted. While interpreting, the JVM silently **profiles** it: how often is it called, which branch is taken, which types actually arrive at those arguments? Then the profile is used to make better-inlining and optimization decisions, and the method is progressively compiled to native code — first by C1 (the "client" compiler, quick compilation, modest optimizations), then, if it stays hot, by C2 (the "server" compiler, slow compilation, aggressive optimizations).

This is why long-running Java applications can become **faster after warm-up**: the first requests are interpreted, the millionth request is running highly optimized native code, guided by data collected from your actual workload. It is also why micro-benchmarks that don't warm up are meaningless, and why you should never judge a Java API's performance by a single cold call.

## 2. A Method Is Called — What Actually Happens?

Time to trace `process(user)`.

When the JVM starts `main`, it creates a thread for it. **Every thread in a JVM has its own private JVM stack** — a LIFO structure where each method invocation lives as one **stack frame**. When `main` calls `process`, the JVM pushes a new frame on the stack. When `process` returns, the frame is popped.

```
    Thread "main"
┌─────────────────────────────────────┐
│  JVM stack                         │
│  ┌───────────────────────────────┐  │
│  │ frame for process(...)        │  │  ← pushed when process is called
│  │   local variables             │  │
│  │   operand stack (empty)       │  │
│  │   return address / frame data │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ frame for main(...)           │  │  ← already there
│  │   args        (slot 0)        │  │
│  │   user        (slot 1)        │  │  ← holds a reference to the User
│  │   operand stack               │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

Conceptually, a frame holds three things (the exact layout is an implementation detail):

- **Local variables** — an array of slots. Slot 0 in `main` is `args`; the reference to `user` lives in slot 1. Each slot holds one value: a primitive, or a reference (an "address-like" handle to an object). `long` and `double` occupy two slots.
- **Operand stack** — a LIFO stack where bytecode instructions compute: `iadd` pops two ints and pushes their sum.
- **Frame data** — the constant pool reference for the class, and for the HotSpot implementation, the reference to the runtime constant pool, the method's exception handler table, and the PC (program counter) pointing at the currently executing bytecode instruction.

Calling `process` for the frame on top:

1. The caller pushes the arguments onto its operand stack.
2. The JVM spots `invokestatic process` and creates a new frame for `process`, copying the arguments into the callee's local slots.
3. The method body runs — same alignment, each of its instructions operating on its own operand stack.
4. On `return`, the return value is pushed onto the **caller's** operand stack, and the callee's frame is discarded.

### Recursion and `StackOverflowError`

Because each invocation needs a frame, deep recursion grows the thread's stack frame by frame — the frames do not "reuse" anything. Thread stacks have a fixed size (in HotSpot, typically 512 KB to 1 MB per thread; configurable with `-Xss`). When a recursion exhausts it, the JVM throws `StackOverflowError` — not because you ran out of heap, but because you ran out of **stack**. This is also why recursive algorithms over large inputs (deep trees, large lists) fail where an explicitly managed heap-based stack would succeed.

### The oversimplification you must unlearn

Textbooks often teach:

> "Primitives live on the stack. Objects live on the heap."

This is a **useful mental model, but incomplete** — and in some cases, plainly wrong.

What is true:

- Local primitive variables _conceptually_ live in the frame's local variable slots — on the stack.
- A local variable holding an object does not contain the object; it contains a **reference** to an object that lives _somewhere else_ (conceptually, the heap).
- Object fields, array elements, and static fields always point into heap-like storage.

What is false, or at least not guaranteed:

- The JVM is **not required** to place any specific variable on the stack. The JVM Specification carefully avoids prescribing physical placement; it defines behavior, not layout. The interpreter may keep stack slots, but a JIT-compiled method often keeps local values in **CPU registers** — which arguably "exists" on neither stack nor heap.
- **Escape analysis** (Section 9) can make the JVM realize that a locally created object never "escapes" the method — and then the object may be _scalar-replaced_: its fields become plain local values, and **no heap object is ever created at all**.

So the model "primitive = stack, object = heap" explains the _conceptual_ runtime but not the _actual_ execution, which is permitted — and frequently does — something cleverer.

## 3. What Really Happens When You Write `new User("Hung")`?

This line deserves its own investigation. Let's look at the bytecode first — `javap -c` on a compiled class containing that line reveals:

```
 0: new           #2     // class User
 3: dup
 4: ldc           #3     // String "Hung"
 6: invokespecial #4     // Method User."<init>":(Ljava/lang/String;)V
 9: astore_1             // store reference into local variable slot 1
```

Reading this backward from the language level:

1. **`new`** — allocate memory for the object. Nothing in the object is initialized yet; the JVM just reserves space and prepares it (in HotSpot this typically means: fetch a region: zeroed memory from the thread-local allocation buffer — the **TLAB**, where hot allocation threads bump a pointer instead of contending globally — and attach an **object header**).
2. **`dup`** — duplicate the reference, because the constructor call will _consume_ one copy, but we need the other copy afterwards to store into the local variable.
3. **`ldc "Hung"`** — load the string constant onto the operand stack.
4. **`invokespecial User.<init>`** — call the constructor, which consumes the reference and the argument.
5. **`astore_1`** — store the remaining reference into local variable slot 1: `user = ...;`.

So the complete object lifecycle becomes visible in six bytecode instructions.

### Step by step: what the machine does

**Step 1 — `new`: memory is allocated.** "The heap" is a concept; the implementation allocates from a region controlled by the garbage collector. HotSpot gives each thread a **TLAB** — a private slice of young-generation memory. Allocating means nudging a pointer forward, which is so cheap it rivals stack allocation (and it effectively becomes exactly that after escape analysis, see Section 9).

**Step 2 — Memory is initialized to default values.** The freshly allocated area is zeroed. Consequently, `int` fields read `0`, references read `null`, booleans read `false` — _before_ any constructor runs. This is part of the language guarantee: fields always have default values, even if no constructor ever assigns them.

**Step 3 — The object header is placed.** In HotSpot, every object begins with an **object header**, which stores (conceptually, not necessarily in this physical form): a **mark word** (identity hash code, GC age, lock state — this is how `synchronized` and biased/small locks reuse the header) and a **klass pointer** linking the object to its class metadata so the JVM knows what type it is when dispatching virtual calls or casting. Fields then follow at offsets _calculated at runtime_ (HotSpot lays fields out to minimize padding; the layout is an implementation detail, and can be compressed with **compressed oops**, where object references are stored as 32-bit offsets into a base instead of full 64-bit pointers).

**Step 4 — Fields are initialized.** First the heap-zeroed defaults (step 2), then the _explicit field initializers_ (`private String name = "default"`), and then — for a `User` — `super()` is called implicitly, and finally the body of the constructor you wrote runs: `this.name = "Hung";`.

**Step 5 — The reference is assigned to `user`.** The local variable `user` — slot 1 of `main`'s frame — now holds a reference to the object.

### The diagram that resolves most confusion

```
   Thread "main" — JVM stack                    Heap
┌──────────────────────────────┐     ┌──────────────────────────────────────┐
│  main frame                  │     │                                      │
│  ┌────────────────────────┐  │     │   ┌───────────────────────────┐      │
│  │ args      (slot 0)     │  │     │   │  User object              │      │
│  │ user ──────────────────┼──┼─────┼──►│  ┌─────────────────────┐  │      │
│  └────────────────────────┘  │     │   │  │ object header       │  │      │
│                             │     │   │  │  mark word           │  │      │
│  The slot holds a REFERENCE │     │   │  │  klass pointer ──────┼──┼───┐  │
│  to an object on the heap.  │     │   │  ├─────────────────────┤  │   │  │
└──────────────────────────────┘     │   │  │ name  ──────────────┼──┼─┐ │  │
                                     │   │  └─────────────────────┘  │ │ │  │
                                     │   └───────────────────────────┘ │ │  │
                                     │                    ┌────────────┘ │  │
                                     │                    │  ┌───────────┘  │
                                     │   ┌─────────────────▼──▼──────────┐  │
                                     │   │  String "Hung" object         │  │
                                     │   │  (char[] value, ...)          │  │
                                     │   └───────────────────────────────┘  │
                                     └──────────────────────────────────────┘
```

The essential insight: **the local variable and the object are different things.** `user` is a small slot in a thread-local stack frame. The `User` object is a region in shared, GC-managed memory, reachable _through_ `user`. That single distinction explains references, GC reachability, and most "is an object still alive?" confusion that follows.

## 4. When Does an Object Actually Die?

Now the programmer's next move:

```java
User user = new User("Hung");
user = null;
```

**Is the object deleted immediately?**

No. Setting a reference to `null` does nothing to the object. It merely removes _one_ path that pointed to it — the `user` slot. The object itself is still sitting in heap memory, fully intact, ignored. Nothing scans it, nothing frees it, nothing breaks its reference to the `"Hung"` string.

Java has no `delete`. Java does not free memory on assignment. Java's memory is reclaimed by a garbage collector that runs **on its own schedule, later, and in bulk** — not at the moment you stop caring about an object.

### Reachability — the real concept

The GC does not ask "is this variable set to null?" It asks: **"Is this object reachable?"**

The graph works like this:

```
GC Roots                                       Heap
─────────                                      ─────────────────────
(stack local variables,          ┌───────┐
 static fields,                  │  objA │ ◄──── still reachable
 JNI references, ...)            └───────┘
      │         │                     ▲
      │         └─────────────────────┘
      │
      ▼
┌───────────┐      ┌───────────┐
│  objB     │───►  │  objC     │   reachable — through objB
└───────────┘      └───────────┘
      ▲
      │
┌───────────┐      ┌───────────┐
│  objD     │◄─────│  objE     │   both UNREACHABLE — no path
└───────────┘      └───────────┘   from any GC Root
```

**GC Roots** are the fixed anchors of the object graph — the places where liveness starts within a garbage collector's view: local variables in active stack frames, static fields of loaded classes, registers holding references in compiled code, JNI handles, and a few others.

Starting from every root, the collector walks references transitively. Every object touched is **reachable** — alive, keeps its memory. Every object never reached is **unreachable** — and unreachable is Java's definition of dead.

Our `user = null` made the `User` unreachable: previously `user` (a root) pointed to it; now no root path exists. But "unreachable" only means _eligible_. The collector may reclaim it during the next cycle — or during a distant one.

### Why garbage collection is nondeterministic

- The GC decides **when** to run based on allocation pressure, available memory, pause targets, and collector-specific policies — not on your assignments. The exact moment is not part of any specification.
- Which objects die in which cycle varies; a "dead" object can survive several collections (in generational collectors, unreachable young objects are usually swept soon, but nothing commits to it).
- `System.gc()` is a _request_, not a command — it asks the JVM to run a full collection "at your convenience," and modern collectors may ignore it entirely.

Conclusion: never write code that depends on the timing of destruction. Java has no destructor guarantees (it has `finalize` and `Cleaner`, neither of which you should rely on for lifecycle logic). If you need deterministic cleanup — close the file, release the connection — do it _explicitly_ with `try-with-resources`, and let memory management stay in the GC's hands.

## 5. How Garbage Collection Actually Thinks

Before looking at any specific collector, understand the **three abstract operations** every tracing collector performs:

1. **Mark** — walk from the GC Roots, transitively, and mark every reachable object. This explicitly finds the live set; everything else is garbage by definition.
2. **Sweep** — walk memory and reclaim the unmarked objects, linking free blocks back into a free list.
3. **Compact** — slide surviving objects together to eliminate fragmentation: dead space between live objects collapses. (Alternatively, **copying collection** copies survivors to a fresh region, leaving the old one entirely empty — this both compacts and collects in one move.)

Marking is _tracing_: it reasons about the whole object graph, irrelevant of what references point at _you_. This single property — tracing from roots — is what makes Java's GC fundamentally different from reference counting (we will see why in Section 6).

### Generational collection — why young objects matter

Empirically, most objects die young: a temporary `StringBuilder`, a loop's `BigDecimal`, a request-scoped DTO. This is so reliably true it is called the **weak generational hypothesis**. Generational collectors exploit it by splitting the managed space into regions with very different workload:

```
   Young generation (high churn)                  Old generation (long-lived)

┌─────────┬─────────┬─────────┐          ┌────────────────────────────┐
│  Eden   │ Surv 0  │ Surv 1  │          │      Old generation        │
│ (new    │ (age 1) │ (ages   │          │  survivors that outlived   │
│ objects)│         │ 2+)     │          │  the young cycles get      │
│         │         │         │          │  promoted here             │
└─────────┴─────────┴─────────┘          └────────────────────────────┘
     │                                        ▲
     └── minor cycles copy survivors ─────────┘
```

Objects are born in **Eden**. When Eden fills up, a **young-only GC** (often called a _minor_ GC) runs: it copies survivors into a **survivor space** (with an age counter — the account how many cycles they've survived), and eventually promotes the oldest survivors into the **old generation**. Young collections are cheap _because_ most of Eden is dead — copying a few survivors and discarding the rest is far cheaper than scanning the whole heap.

The old generation grows more slowly, so it is collected less often, but each such collection is heavier. Be careful with terminology here: **"full GC" vs "major GC" mean different things in different collectors.** In G1, for instance, you get _young-only_ cycles, _mixed_ cycles (young + some old regions), and an explicit _full GC_ (usually a symptom that other strategies failed); ZGC and Shenandoah made old-generation collections concurrent precisely to reduce these stop-the-world events. When reading a GC log, always map the terms to the collector's own documentation.

### Modern collectors — trade-offs, not magic

| Collector                                   | Core idea                                                                                                       | Dominant trade-off                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **G1** (default since Java 9)               | Heap as regions; meet _pause-time goals_ by collecting incrementally, in small fixed-pause slices               | Predictable pauses on large heaps, but more CPU and header overhead |
| **ZGC** (since JDK 15/16, old-gen since 21) | Nearly proportional-to-_size-of-live-set_, mostly concurrent collection; pause times barely grow with heap size | Complexity — reads pay a small color/barrier cost, larger footprint |
| **Shenandoah**                              | Fully concurrent evacuation — even _moving_ happens while application threads run                               | Similar to ZGC: barrier and CPU overhead for latency wins           |

The point is not to memorize algorithms. The point: every collector is an engineering compromise between **pause time**, **throughput**, **footprint**, and **complexity**. Picking one is a system-level decision informed by your heap size, your latency targets, and your CPU budget — not a flag you flip because a blog post said so.

### Diagram — the young/old funnel

```
 Alloc ──► Eden ──► young-only GC ──► Survivor spaces (age++) ──► Old gen
 (TLAB)      │            │                                   │
             └─► dead     └─► dead                            └─► mixed/big collections
            (most objects die here)                  (long-lived objects stay here)
```

Why should you care about this when writing code? Because the young generation _expects_ you to churn objects and punishes you only mildly; it is the **old generation** where expensive collections happen. Mistreating old-gen (allocating huge long-lived structures repeatedly, leaking into it, or filling it with short-lived overflow) is how applications end up in a loop of expensive full GCs — the classic "GC thrashing" production incident.

## 6. Special Case: Circular References Are Not Memory Leaks

Consider the classic "impossible" case:

```java
class A { B b; }
class B { A a; }

void leakCheck() {
    A a = new A();
    B b = new B();
    a.b = b;
    b.a = a;          // A ↔ B now reference each other
    a = null;
    b = null;         // no roots point to either... or do they?
}
```

The persistent folklore says: _two objects referencing each other can never be garbage collected._

That is false. Both objects die.

```
Before a = null, b = null:            After:

ROOT ──► A ──► B              ROOT      A ◄──► B
          ▲   │                          (unreachable)
          └───┘
```

Both objects _were_ reachable from the root through the local variables. The moment both locals are cleared, no path exists from any GC Root to `A` or `B`. `A → B` and `B → A` are just edges _between_ garbage — neither points anywhere the collector cares about. The mark phase simply never reaches them, and both are collected, cycle or not.

### Why reference counting gets this wrong — and tracing doesn't

Languages like the earlier eras of Python and Objective-C used **reference counting**: each object holds a counter of references to it; when the count hits zero, it is freed _immediately_. Now consider `A ↔ B`: decrement `a`'s count and it goes from 2 to 1, not to 0 — because `B` still references it. Neither count ever reaches zero. The pair leaks forever, unless elaborate cycle detection is bolted on.

Java's collector does not count references at all. **Tracing**: start from roots, walk the graph, reclaim everything not visited. "Who references me?" is never asked; only "Am I reachable from a root?" matters. That is precisely why cycles are _automatically_ collectable — including much more realistic cycles like a parent collection referencing its children and being referenced by them, which appears in real domain models all the time.

This is also why weaker reference types (`WeakReference`, `WeakHashMap`) exist and behave sensibly: reachability — not counting — is the language of Java's memory model.

## 7. Java Has GC, So Why Can It Still Have Memory Leaks?

If the GC reclaims everything unreachable, how can a Java program grow its heap until it dies?

Because there is a profound difference between:

- **The object is not needed anymore** (the programmer's judgment), and
- **The object is unreachable** (the GC's judgment).

Garbage collection is a _reachability_ detector, not a _neediness_ detector. Anything you accidentally keep reachable will never be collected — no matter how obviously useless it is. A Java memory leak usually means the program is **unintentionally keeping objects reachable**.

### The collector's view of a classic leak

```java
public class UserCache {
    private static final Map<String, User> USERS = new HashMap<>();

    public static void remember(User user) {
        USERS.put(user.getId(), user);      // every requested user, forever
    }
}
```

Objectively: the map is `static` — a GC Root. Every `User` put into it is reachable _by construction_. If the cache has no eviction policy, the heap grows until `OutOfMemoryError`. The GC is working perfectly: each stored user was, at some point, possibly justified. The bug is that nothing ever decides they're done.

Realistic variants of the same disease:

**1. Unbounded caches / maps keyed by request data**

```java
Map<String, Result> resultsByRequestId = new HashMap<>();
// each incoming request adds an entry; entries are never removed
```

**2. Event listeners that are never removed**

```java
someService.addListener(myListener);   // caller forgets removeListener(...)
```

If `someService` is long-lived (a singleton), it keeps a strongly referenced listener forever — along with whatever _that_ listener references (often the whole enclosing object graph, e.g. a controller or consumer that used to be request-scoped).

**3. `ThreadLocal` misuse with thread pools**

```java
private static final ThreadLocal<BigData> PER_THREAD = new ThreadLocal<>();

void handle(Request r) {
    PER_THREAD.set(expensiveData());
    // ... never PER_THREAD.remove()
}
```

In a web server, "threads" are pooled and long-lived. Each pooled thread's `ThreadLocal` value counts as _reachable from a GC Root_ (thread objects are referenced by the pool, and `ThreadLocal` values hang off their thread). Drop this in a 200-thread pool without `remove()` and you retain up to 200 copies of `expensiveData` — permanently. (Worse: even after you null your `ThreadLocal` reference, the _entry_ can linger with its value until the entry's weak key is cleared.)

**4. Long-lived references that outlive their use**

```java
private Model model;   // set from a large request, used once, kept for the
                       // life of this long-lived bean
```

One field, seemingly innocent, can pin an entire object graph.

### The pattern, in one line

> A Java memory leak is almost never the GC's fault — it's the program accidentally keeping objects **reachable**.

If the retained objects must legitimately outlive the source of their data, use the right tool: `WeakHashMap`, `WeakReference`/`ReferenceQueue`, caches with eviction (`CacheBuilder`, `Caffeine`) — anything that converts an accidental strong pin into a cancellable one. And when a heap dump shows gigabytes of "one big `HashMap`," the solution is _eviction policy_ and _ownership discipline_, not a bigger `-Xmx`.

## 8. Special Case: `OutOfMemoryError` Does Not Always Mean the Heap Is Full

`OutOfMemoryError` is a hat that fits many different heads. It is thrown — in different flavors of the same `Error` — whenever some resource the JVM needs **cannot be obtained**. Only some flavors relate to the heap you raised with `-Xmx`. Blindly increasing `-Xmx` for every OOME is the classic reflex that solves one problem and masks others.

| Exception message                    | What is actually exhausted                                                                                         | Typical causes                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `Java heap space`                    | The heap (bounded by `-Xmx`)                                                                                       | Object leak, huge collections, honest over-allocation                                                |
| `Metaspace`                          | Class metadata area — _native memory, bounded by `-XX:MaxMetaspaceSize`_                                           | Unbounded dynamic class generation: reflection, proxies, bytecode generation, JSP/scripting compiles |
| `Direct buffer memory`               | **Direct** (off-heap) buffers, charged to `-XX:MaxDirectMemorySize`                                                | `ByteBuffer.allocateDirect` consumers (NIO, netty, compression) that are never released              |
| `Unable to create new native thread` | **OS-level** threads — process limits, `ulimit -u`, cgroup/cgroup2 pids limits, or the process's own address space | Thread created per task (no pooling), runaway virtual-thread pinning, OS limits                      |

Notice the pattern: of the four, only the first lives in the heap. The rest are outside it entirely:

- **Metaspace** stores class metadata, not objects. Huge because classes are generated (and never unloaded, because class loaders are retained).
- **Direct buffers** are `malloc`-ed native memory handed to Java via a small `DirectByteBuffer` _object_; the object is small, the native block is huge. GC can recycle them only via a cleaner, which runs asynchronously — a classic "heap looks fine, memory keeps climbing" incident on non-heap graphs.
- **Native threads** consume native memory _and_ stack space, and may hit the OS long before the heap has any idea what happened.

### The practical troubleshooting mindset

When an OOME hits, resist the reflex. Walk this ladder instead:

1. **Identify which memory area is exhausted** — read the _message_ (`Java heap space` vs `Metaspace` vs `Direct buffer memory` vs `Unable to create new native thread`). Each names a different subsystem and a different `-XX` knob; one `-Xmx` does not move any of the others.
2. **Understand what is allocating that memory.** Follow the allocation site with a profiler: heap — object dumps; metaspace — class loading logs (`-Xlog:class+load`); direct — buffer allocation stacks; threads — thread counts (`jstack` / `jcmd Thread.print`).
3. **Check whether objects are retained rather than just allocated.** Capture a **heap dump** (`jmap -dump:live`, or `-XX:+HeapDumpOnOutOfMemoryError`) and inspect the _retained_ set: is a `HashMap` holding megabytes of one-time data? A `ThreadLocal` per pooled thread? Instruments: `jcmd GC.heap_dump`, `jvisualvm`/`jconsole`, Eclipse MAT or the built-in leak suspects.
4. **Inspect native side when the heap is fine.** If RSS keeps growing while the heap is stable: direct buffers, class loader leaks (`Metaspace`), JNI, or threads. HotSpot has **Native Memory Tracking** (`-XX:NativeMemoryTracking=summary`, `jcmd VM.native_memory`) precisely for this.
5. **Only then consider configuration.** Raising `-Xmx` is a _capacity_ move. If you're retaining data you shouldn't, the correct move is to stop retaining it; if you're generating classes, the correct move is to unload or reuse them; if you're creating threads per task, the correct move is a pool (and on JDK 21+, virtual threads for I/O-bound work, without a native thread per task).

In one sentence: the OOME message tells you _which_ memory system failed; the right fix fixes _that system_, not the one you already tuned.

## 9. When the JVM Is Smarter Than You Think

Go back to Section 2's forbidden topic — stack vs heap — because now the JVM does something genuinely surprising:

```java
public int calculate() {
    Point point = new Point(10, 20);
    return point.x + point.y;
}
```

**Does this `Point` always need to exist as a real heap object?**

At first glance, "of course": `new` allocates. But this is where the JVM becomes interesting.

HotSpot's C2 compiler performs **escape analysis**: it analyzes whether `point` can possibly "escape" the method — is its reference stored into a field? passed to another method? returned? published to another thread? If _none_ of those happen, the object is **non-escaping** — invisible to the rest of the world, and thus its identity is only an illusion the language forces on us.

Once the JVM knows `point` cannot escape, it may apply:

- **Scalar replacement** — split the object into its fields: `point` becomes two local variables, `x` and `y`, each living in registers or stack slots. The object's _storage_ never exists.
- **Allocation elimination / stack allocation** — for non-escaping objects that must still exist, **stack allocation** or in-place memory that never touches the GC-managed heap can be used. The object dies with the frame; no GC interaction at all.
- **Lock elision** — a closely related optimization: a monitor held only by its creator can be eliminated.

The rewritten `calculate()` effectively becomes something like:

```java
public int calculate() {
    int x = 10, y = 20;        // fields promoted to locals
    return x + y;              // no allocation at all
}
```

So: _sometimes_ — when the JVM can prove the object never escapes — the `new Point(10, 20)` results in **no heap allocation whatsoever**, no object header, no TLAB bump, nothing visible to any collector. The language semantics remain identical, because nobody could ever observe the difference (no identity escapes, no synchronization, no identity-hash observation).

### The important caveats

- These are **optimizations, not guarantees**. They depend on the compiler tier, the JIT configuration, the JVM implementation, and even runtime profiling state. The JVM Specification does **not** promise that any object is or is not allocated — it promises _observable behavior_.
- Optimization decisions can be **revoked at any time** (deoptimization): if a compiled method's assumptions break, the JVM reverts to the interpreter, and allocation behavior can change _while your program runs_.
- Escape analysis has limits: objects that escape (stored, published, returned, captured in lambdas/closures) are _not_ eliminated. Your _long-lived_ objects still pay real allocation cost.

This is the deep resolution of the Section 2 puzzle: the conceptual model says "objects live on the heap," and the _engine may legally replace the heap with registers_ whenever the semantics allow it. Do not write code that _depends_ on allocation happening ("I can detect allocation in a loop by..."), and do not be surprised that a micro-benchmark shows zero allocations for code that looks like it allocates.

This also explains why adding a _reachable escape_ — e.g. storing `point` into a field "just in case it's useful for debugging" — can measurably change allocation behavior: you have pushed a non-escaping object into the escaping world.

## 10. Java Special Cases That Surprise Developers

The JVM hides its machinery behind language semantics — and occasionally the machinery casts a shadow that surprises people. Here are four spots where developers famously trip.

### 10.1 The Integer cache

```java
Integer a = 100;
Integer b = 100;
System.out.println(a == b);      // prints ?

Integer c = 200;
Integer d = 200;
System.out.println(c == d);      // prints ?
```

Most developers predict `true` / `false`, and get reversed at both ends — the actual output is `true` and `true`... no. The actual output is **`true`** for `100` and **`false`** for `200`.

Mechanics: `Integer a = 100` is autoboxing — shorthand for `Integer.valueOf(100)`. And `valueOf` is _cached_: the JDK caches `Integer` instances for a small range (default `-128..127`), returning the _same object_ for repeated calls within it. So `a == b` compares two references to one shared cached instance — `true`. At `200`, the cache misses, two distinct `Integer` objects are created, and `==` compares references — `false`. (The range is tunable: `-XX:AutoBoxCacheMax=...` extends it.)

The lesson is doubly practical: `==` on boxed types compares _identity_, never value; and the cache makes the boxes' behavior _value-dependent in a way that violates intuition_. Always compare numbers with `equals` (or `intValue()`), always unbox before `==` — and remember the same trick exists for `Boolean` and (smaller caches) other boxed types.

### 10.2 The null unboxing NPE

```java
Integer value = null;
int result = value;        // what happens?
```

`int result = value` is unboxing — compiled as `value.intValue()`. Calling a method on `null` throws `NullPointerException`. So this line **always throws NPE**, no matter how "obviously 0 it should be." Modern JDKs even name the culprit: _"Cannot invoke 'java.lang.Integer.intValue()' because 'value' is null"_ (JDK 14+ helpful messages). The takeaway: any data flowing into a primitive-typed API through an autoboxing boundary carries a hidden method call that can fail — validate before unboxing, never assume nullability lands at the parse from the persistence layer.

### 10.3 The two lives of `"hello"`

```java
String a = "hello";
String b = "hello";
System.out.println(a == b);        // true

String c = new String("hello");
System.out.println(a == c);        // false
```

`"hello"` as a _literal_ is a **compile-time constant**: `javac` interns it — resolves it to the **string pool**, a per-JVM registry of legendary objects that all classes share. `a` and `b` load the _same_ pooled instance, so `==` is `true`. `new String("hello")` has nothing to do with pooling: in general it creates a _fresh_ object (and here the pool's copy becomes redundant). Hence `==` is `false`.

The subtlety deepens when strings are built:

- **Compile-time constants** — `"hel" + "lo"` is folded by `javac` into the single literal `"hello"` → pooled. If both `String x = "hel" + "lo"` and your literal are compile-time constants, `==` can be `true`!
- **Runtime concatenation** — `String name = firstName + "Hung"` produces a _new_ object at runtime (`invokedynamic` with `StringConcatFactory` in modern javac), never the pooled one. `==` is `false` even when `firstName` is `"Pham "`.
- **`intern()`** — calls the pool explicitly: `c.intern()` returns the canonical pooled instance, making `a == c.intern()` true. This is almost always a code smell unless you genuinely need canonicalization (e.g., keys in a parser).

Rules of thumb, one line each: use `equals` for content, always; literals are pooled, `new` is not; never assume `==` on strings except when you're deliberately relying on pooling of intern'd/compile-time strings; and remember the pool lives in the heap (since Java 7) — thousands of unique `intern()`ed strings _do_ consume heap.

### 10.4 `finally` can change the result

```java
static int probe() {
    try {
        return 1;
    } finally {
        return 2;
    }
}
// probe() returns ...?
```

The answer — **2** — catches people in code reviews every year. The JVM compiles a `finally` block into _every exit path_ of the `try`: the normal path, and each exception-handler path. The `return` in `finally` executes _after_ the `return 1` expression has been evaluated but _before_ the method actually returns — and a return that executes is a return that wins, silently discarding the pending value 1.

The practical damage: a function that _appears_ to return its intended value instead returns whatever the cleanup block decides; worse, a `return` inside `finally` **swallows exceptions** thrown in `try` (the same mechanics apply to `catch` too). Cleanup belongs in `finally`, but returning from `finally` deserves the same suspicion as `catch (Exception e) {}` on an empty line.

Each of these four traps is not "Java being stupid" — each is the runtime faithfully executing a contract that the source syntax makes easy to misread (caching identity, hidden method calls, interned canonical instances, control-flow compilation). Which is exactly the theme of this whole article: the code you write is a _description_, and the machine's reading of that description is the reality that runs.

## The Mental Model That Actually Helps You

Java code may look simple, but every method call, object allocation, reference, and optimization happens inside a complex runtime system. Understanding that system helps developers debug production issues, investigate memory leaks, understand performance problems, and write better Java code.

The mental model, in one picture:

```
 Your .java source                       The JVM's reality
 ────────────────                        ─────────────────
 javac ──► bytecode ──► loader ──► interpreter ──► JIT native code
                            │   v   │           ──────────────
                         frames / TLAB / mark-sweep / inlining /
                         escape analysis / generations / barriers
                                              │
                                        observable behavior:
                                        correct results, faster warm
                                        code, reclaimed garbage
```

Nothing here is magic. Every piece is _an engineering decision_ made by real compilers and runtimes — and every piece can be inspected, measured, and tuned (`javap`, `jcmd`, GC logs, heap dumps, `-XX` flags you understand before flipping). When production grows, or a heap dump shows gigabytes of one `HashMap`, or a benchmark suddenly allocates zero bytes, you now know which layer to ask questions of.

### Key Takeaways

- Java code compiles to **bytecode** — a platform-independent instruction set — and the JVM translates that to native code on your specific OS/CPU; that is why Java "runs anywhere."
- **Each thread has its own stack**; each method call pushes a **stack frame** (locals + operand stack + frame data), and return pops it. Unbounded recursion exhausts the fixed-size stack: `StackOverflowError`.
- "Primitives live on the stack, objects on the heap" is a **conceptual model, not a physical law** — references are handles, and the JIT may put objects in registers, eliminate them, or keep them entirely off the heap.
- A local variable holds a **reference**; the object lives in GC-managed memory, with an object header and runtime-computed field offsets.
- **`user = null` deletes nothing.** Only the GC deletes, and only when an object becomes **unreachable from GC Roots** — on its own schedule.
- Garbage collection is **tracing**: mark what's reachable from roots, reclaim the rest. That's why **circular references are collectable**, unlike reference-counted systems.
- A memory leak in Java usually means the program **accidentally keeps objects reachable** — static caches without eviction, listeners never removed, `ThreadLocal` values in pools, long-held references.
- `OutOfMemoryError` has many flavors — heap, **Metaspace**, **direct buffers**, **native threads** — and the right fix depends on _which_ one hit; raising `-Xmx` fixes exactly one of them.
- The JIT warms long-running applications: interpretation → profiling → tiered compilation, with trade-offs between pause time, throughput, and footprint that differ per collector (G1, ZGC, Shenandoah).
- Escape analysis can legally **eliminate allocations the language seems to require** — so never let code depend on allocation actually happening.

### Common Misconceptions

| Misconception                                        | Reality                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Objects are always simply "stored on the heap"       | The conceptual model is useful, but real JVM behavior can involve optimizations |
| `user = null` immediately frees memory               | GC runs independently and later                                                 |
| Circular references always leak memory               | Tracing GC can collect unreachable cycles                                       |
| GC prevents memory leaks                             | Reachable-but-unused objects can still leak                                     |
| `OutOfMemoryError` always means increase `-Xmx`      | Different JVM/native memory areas can fail                                      |
| Local object creation always means a heap allocation | JVM optimizations may eliminate or transform allocations                        |

The next time you write `User user = new User("Hung")`, remember: that's not one step — it's a handshake between your code, a fictional machine, and a very real, very clever runtime that has been optimizing programs like this since 1995.
