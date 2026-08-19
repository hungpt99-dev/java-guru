---
title: "How Java Runs: From Source Code to the JVM and Garbage Collector"
description: "A practical tour of Java execution: bytecode, class loading, stack frames, object allocation, JIT compilation, and garbage collection."
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

Java code looks direct:

```java
public static void main(String[] args) {
    User user = new User("Hung");
    process(user);
}
```

The source does not run directly on the CPU. A Java compiler turns it into bytecode. The JVM then loads and checks the classes, executes the bytecode, and may compile frequently executed code into native instructions. Along the way it manages method state, object memory, threads, exceptions, and garbage collection.

That sequence is easy to summarize and harder to reason about precisely. The JVM specification defines observable behavior, but it does not require one particular memory layout, garbage collector, or JIT strategy. This article separates specification-level facts from implementation-dependent behavior so that the model remains useful across JDKs and JVMs.

**[SOURCE FACT]** The companion repository [`java-lab`](https://github.com/hungpt99-dev/java-lab/tree/lab/jvm), on branch `lab/jvm`, is a framework-free Maven project with sixteen small experiments covering bytecode, class loading, stack frames, references, reachability, escape analysis, and boxed types. Those examples are useful for checking the model against a running JVM; their output is not a substitute for the specification.

## 1. The Execution Pipeline

**[SOURCE FACT]** A typical run has these stages:

```text
  .java source
       |
       | javac
       v
  .class file: JVM bytecode and metadata
       |
       | java Main
       v
  JVM: load -> link -> initialize -> execute
       |                         |
       |                         +-> interpreter
       |                         +-> JIT-compiled native code
       v
  operating system and CPU
```

`javac` targets the JVM instruction set rather than a particular CPU. A `.class` file contains bytecode and a constant pool with symbolic information used by the runtime. The JVM implementation is responsible for executing that contract on its host platform.

**[ANALYSIS]** “Write once, run anywhere” is therefore a runtime boundary, not a promise that every program behaves identically in every environment. The bytecode can be reused, while the JVM, operating system, CPU, available memory, and runtime configuration can differ.

## 2. Bytecode and the Constant Pool

**[SOURCE FACT]** JVM bytecode is a defined instruction set. Common instructions include:

- `new`: create an object of a referenced class
- `invokespecial`: invoke a constructor or another special method
- `invokestatic`: invoke a static method
- `aload_1`: load a reference from local-variable slot one
- `iadd`: add integer values from the operand stack

The exact instructions for a method depend on the source, compiler, and target class-file version. Inspect a compiled class with:

```bash
javap -c -p Main
```

For the example above, the important point is not a particular instruction sequence. The compiler emits instructions that construct a `User`, store the resulting reference in a local slot, and pass that reference to `process`.

The constant pool supplies symbolic references such as a class name, method name, and descriptor. Resolution of those references is part of linking and can occur when the JVM needs them, rather than all at one fixed moment.

**[ANALYSIS]** Bytecode is not “slow machine code.” It is an intermediate representation with its own execution model. The interpreter can execute it directly, and a JIT compiler can use execution data to produce optimized native code later.

## 3. Loading, Linking, and Initialization

**[SOURCE FACT]** Before a class can be used, the JVM may load its class file through a class loader. In a typical modern JDK, the built-in loader arrangement includes:

```text
Bootstrap loader   -> core platform classes
       |
Platform loader   -> platform modules
       |
Application loader -> application class path and modules
```

The bootstrap loader is implemented by the JVM rather than as an ordinary Java object. Custom class loaders can participate in the process.

The parent-delegation pattern is common: a loader asks its parent first, then attempts to find the class itself. This helps prevent application code from replacing core platform classes. It is a loading convention, not a rule that every custom loader must follow.

The lifecycle is usually described as:

1. **Loading:** obtain the binary representation and create the runtime class representation.
2. **Linking:** verify the class, prepare static storage, and resolve symbolic references as required.
3. **Initialization:** execute class initialization code when the class is first actively used.

**[SOURCE FACT]** Verification checks that the class file conforms to the JVM’s constraints. Initialization is distinct from loading: a class can be loaded before its static initialization runs.

**[ANALYSIS]** This distinction matters when diagnosing startup failures. A missing class, an incompatible method, and an exception from a static initializer are different failure points even if they all appear during application startup.

## 4. Method Calls and Stack Frames

**[SOURCE FACT]** Each method invocation has a JVM frame. A frame contains the method’s local variables, operand stack, and other information needed to execute that invocation. The JVM specification describes this logical structure; it does not require that every frame be represented by a simple native stack allocation.

For the sample:

```text
main frame
  args -> reference to the argument array
  user -> reference to a User instance
  operand stack -> temporary values for bytecode instructions

process frame
  parameter -> the same User reference value
```

Passing `user` to `process` passes a copy of the reference value. Java is always pass-by-value. If the method mutates the `User`, both frames can observe that mutation through references to the same object. Reassigning the parameter changes only the parameter in `process`.

```java
static void process(User value) {
    value.setName("Other"); // changes the shared object
    value = new User("New"); // changes only this local variable
}
```

**[ANALYSIS]** “Reference” is the useful Java-level term. It should not be treated as a portable promise about a raw address, pointer arithmetic, or object placement. A JVM may move objects during garbage collection while preserving valid references.

## 5. Object Allocation

**[SOURCE FACT]** `new User("Hung")` creates an object and invokes its constructor before the reference is assigned to `user`. The object’s fields are initialized according to Java’s initialization rules, and the constructor then performs its work.

The JVM specification does not prescribe one allocation algorithm or require every object to live in one global heap region. A production JVM can use thread-local allocation areas, free lists, regions, or other techniques. These are implementation details, not Java language guarantees.

**[ANALYSIS]** The practical consequence is that “allocation is always expensive” and “allocation is always cheap” are both poor rules. Allocation cost depends on the JVM, object lifetime, contention, object size, and whether the JIT can remove or replace the allocation.

## 6. Interpretation and JIT Compilation

**[SOURCE FACT]** A JVM can interpret bytecode and can compile frequently executed code into native machine code at runtime. The compiled code may be optimized using information collected from actual execution, such as observed types and branch behavior. The details vary by JVM and runtime options.

Possible optimizations include inlining a method, eliminating checks that can be proven unnecessary, and simplifying object-related work. Optimized code must preserve Java’s required behavior. If an assumption becomes invalid, the runtime can stop using that compiled version and continue with another execution path.

**[ANALYSIS]** This is why a short benchmark can mislead. The first executions may include class loading, initialization, compilation, and other warm-up work. A result also depends on workload, JVM version, flags, hardware, and measurement method. No performance number belongs in a general explanation unless it is measured under stated conditions.

## 7. Reachability and Garbage Collection

**[SOURCE FACT]** Garbage collection reclaims objects that are no longer reachable through the roots defined by the runtime. Typical roots include live thread state and runtime-managed references. An object becomes eligible for collection when no valid root path reaches it.

```java
User user = new User("Hung");
user = null;
```

After the assignment, the object may be unreachable if no other reference points to it. It is eligible for collection, not guaranteed to be collected immediately. Garbage collection timing is deliberately not controlled by ordinary Java code.

Collectors differ in how they identify reachable objects, organize memory, pause application threads, and perform concurrent work. Some can move objects. The application should therefore rely on reachability and managed-lifetime rules, not on an object’s address or an expected collection time.

`System.gc()` is only a request to the runtime and is not a reliable way to force collection. Finalization should not be used for resource management. Files, sockets, and other external resources need explicit lifecycle handling, such as `try`-with-resources.

## 8. Escape Analysis and Boxed Values

**[SOURCE FACT]** A JIT compiler can perform escape analysis: it determines whether an object is visible outside a method or thread. If the runtime can prove that an allocation does not need object identity or heap visibility, it may replace or eliminate parts of that allocation. This is an optimization opportunity, not a guarantee exposed by the Java language.

Boxing introduces another layer. An `Integer` is an object, while `int` is a primitive value. Comparing boxed values with `==` compares references, not numeric values:

```java
Integer a = Integer.valueOf(args.length);
Integer b = Integer.valueOf(args.length);

boolean sameValue = a.equals(b);
boolean sameReference = a == b;
```

The first comparison expresses value equality. The second expresses reference identity and should not be used to compare boxed numbers. Unboxing can also throw when the reference is `null`.

## 9. A Useful Mental Model

Use this model when reading Java performance or runtime behavior:

1. Source code is compiled to class files containing JVM bytecode.
2. Class loaders obtain classes; linking verifies and prepares them; initialization runs when required.
3. Method invocations create logical frames with locals and an operand stack.
4. Variables hold primitive values or reference values. A reference is not a portable raw address.
5. The JVM may interpret bytecode or compile hot code to native instructions.
6. Objects remain live while reachable. Collection is nondeterministic and implementation-dependent.
7. Allocation and optimization behavior must be measured on the target JVM and workload.

**[PROPOSED DESIGN]** When investigating a real application, start with observable evidence: a minimal reproducer, the JDK and JVM version, runtime flags, a representative workload, and a profiler or flight recording. Treat heap layout, JIT decisions, collector behavior, and timing as hypotheses to verify rather than assumptions to bake into application code.

The JVM is not a single pipeline with one fixed implementation. It is a specification-backed runtime that is free to change its internal strategy while preserving the behavior Java programs are entitled to observe. That boundary is the key to understanding both Java’s portability and its performance characteristics.
