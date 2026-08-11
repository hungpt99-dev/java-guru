---
title: "Java Hoạt Động Thực Sự Như Thế Nào: Bên Trong JVM Từ Bytecode Đến Garbage Collection"
description: "Đi theo hành trình của một chương trình Java từ mã nguồn vào bên trong JVM — lời gọi phương thức, cấp phát đối tượng, tối ưu hóa JIT và garbage collection được giải thích ở mức sâu hơn các tutorial stack-vs-heap thông thường."
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

Có lẽ ngày nào bạn cũng viết những dòng code như thế này:

```java
public static void main(String[] args) {
    User user = new User("Hung");
    process(user);
}
```

Thoạt nhìn, mọi thứ trông thật đơn giản. Tạo một đối tượng. Truyền nó vào một phương thức. Xong.

Nhưng đây chính là nơi JVM trở nên thú vị. Giữa lúc bạn nhấn Enter và lúc đoạn code này thực sự chạy trên CPU, cả một cỗ máy bắt đầu hoạt động: một trình biên dịch sinh ra các chỉ thị trung gian, một runtime environment xác minh, nạp và liên kết các class, một interpreter âm thầm chạy code của bạn trong khi profiling nó, một just-in-time compiler viết lại code thành chỉ thị native, bộ nhớ được cấp phát từ những vùng bạn không bao giờ nhìn thấy, và cuối cùng, một garbage collector quyết định — theo lịch trình riêng của nó — khi nào đối tượng `User` được phép chết.

Bài viết này là một chuyến đi thực địa vào bên trong cỗ máy đó. Chúng ta sẽ theo dõi một chương trình nhỏ từ mã nguồn đến CPU, trả lời một câu hỏi ở mỗi bước:

> Điều gì thực sự xảy ra từ lúc Java code bắt đầu chạy cho đến khi các đối tượng được tạo, sử dụng, và cuối cùng được dọn dẹp?

Bạn đã biết cú pháp Java. Bài viết này bàn về thứ đang chạy bên dưới nó.

Mọi khẳng định trong bài đều có thể kiểm chứng bằng cách chạy thật. Bài viết
được thiết kế để đọc cùng repository đồng hành
[`java-lab`](https://github.com/hungpt99-dev/java-lab/tree/lab/jvm) (nhánh
`lab/jvm`) — một dự án Maven thuần, không framework, với **16 thí nghiệm nhỏ,
độc lập** về bytecode, class loading, stack frame, reference, GC reachability,
escape analysis và các bẫy kiểu boxed. Mỗi phần dưới đây gắn một khái niệm với
một class cụ thể: theo link xanh tới file ví dụ, chạy nó bằng lệnh bên cạnh,
rồi so sánh quan sát của bạn với kết quả ghi trong bài.

## 1. Bức Tranh Lớn — Điều Gì Xảy Ra Khi Bạn Chạy Một Chương Trình Java?

### Hành trình trong một sơ đồ

```
  .java source
      │
      │  javac (trình biên dịch)
      ▼
  .class file  ────  bytecode: các chỉ thị độc lập với nền tảng
      │
      │  java <Main>  (launcher khởi động JVM)
      ▼
  ┌────────────────────────── JVM ──────────────────────────┐
  │  Class loading  →  Bytecode verification  →  Linking   │
  │                                                         │
  │  Execution engine:                                      │
  │    Interpreter ──(phát hiện hot method)──► JIT compiler │
  │        │                                   │            │
  │        └─────────► native machine code ◄────┘            │
  │                                                         │
  │  Runtime services: GC  ·  Threads  ·  Exceptions  · ... │
  └──────────────────────────┬──────────────────────────────┘
                             │
                             ▼
                           CPU
```

### Java bytecode thực chất là gì

Khi bạn chạy `javac Main.java`, trình biên dịch **không** tạo ra machine code cho bộ xử lý x86 hay ARM của laptop bạn. Nó tạo ra một file `.class` chứa **bytecode** — một tập lệnh được định nghĩa bởi Java Virtual Machine Specification, không phải bởi bất kỳ phần cứng thật nào.

Mỗi chỉ thị bytecode dài đúng một byte (do đó có tên gọi), và chỉ có vài trăm chỉ thị. Những chỉ thị điển hình:

- `new` — cấp phát một đối tượng
- `invokespecial` — gọi constructor hoặc phương thức private
- `invokestatic` — gọi một phương thức static
- `aload_1` — nạp một tham chiếu từ ô local variable
- `iadd` — cộng hai số nguyên từ operand stack

Bạn có thể xem bytecode của bất kỳ class nào đã biên dịch bằng một công cụ bạn đã có sẵn:

```bash
javap -c Main
```

> 🧪 **Thử nghiệm:** File [`BytecodeExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/BytecodeExample.java) trong `java-lab` (nhánh `lab/jvm`) chứa đúng dòng `User user = new User("Hung")`; sau khi `mvn clean compile`, lệnh `javap -c -p target/classes/com/example/javalab/jvminternals/BytecodeExample.class` hiện ra đúng dãy `new dup ldc invokespecial astore_1` — cùng cấu trúc mà Phần 3 sẽ đọc từng chỉ thị.

Phần sau của bài viết này chúng ta sẽ đọc đúng bytecode của chương trình ví dụ. Đây là lý do đầu tiên Java "chạy ở mọi nơi": trình biên dịch nhắm đến một cỗ máy hư cấu, và nhiệm vụ của JVM trên mỗi nền tảng là biến cỗ máy hư cấu đó thành hiện thực.

### Vì sao Java có thể chạy trên nhiều hệ điều hành khác nhau

"Write once, run anywhere" không phải phép màu — đó là một sự ủy quyền. Java code được biên dịch một lần, thành bytecode. **JVM là môi trường thực thi** chuyển bytecode đó thành chỉ thị native của hệ điều hành và CPU mà nó đang chạy: macOS cần một bản dựng JVM, Linux một bản khác, Windows một bản khác nữa — nhưng tất cả đều chạy đúng một file `.class` giống hệt nhau.

Nói cách khác, JVM là lớp tương thích. Chương trình của bạn không bao giờ nói chuyện trực tiếp với hệ điều hành về bộ nhớ, thread hay thực thi code; nó nói chuyện với JVM, và JVM nói chuyện với hệ điều hành. Thứ có tính di động không phải là chương trình — mà là hợp đồng runtime.

### Class loading ở mức tổng quan

Trước khi bất kỳ code nào chạy, JVM phải tìm và nạp các class cần thiết. Việc này do các **class loader** đảm nhiệm, được tổ chức theo thứ bậc:

```
                     ┌──────────────────────────────┐
                     │  Bootstrap class loader      │  các class lõi của JDK
                     │  (java.base, java.lang, ...) │  (java/lang/String, ...)
                     └──────────────┬───────────────┘
                                    │  parent
                     ┌──────────────▼───────────────┐
                     │  Platform class loader        │  các module JDK
                     └──────────────┬───────────────┘
                                    │  parent
                     ┌──────────────▼───────────────┐
                     │  Application class loader     │  các class của bạn trên
                     │  (classpath)                  │  classpath
                     └──────────────────────────────┘
```

Khi cần một class, quá trình nạp của JVM yêu cầu class loader của nó, và class loader bình thường sẽ **ủy quyền lên parent** trước — một mô hình đảm bảo chẳng hạn `java.lang.String` luôn đến từ JDK và không bao giờ bị class trên classpath thay thế.

Khi tìm thấy file class, nó được **verify** (JVM kiểm tra bytecode có đúng cấu trúc và type-safe — đó là lý do bytecode rác không thể làm sập JVM theo cách machine code rác có thể làm sập hệ điều hành), sau đó **link**, rồi — chỉ khi được dùng thực sự lần đầu — được **initialize** (các đoạn static initializer chạy). Class được nạp **một cách lười biếng**: lúc khởi động, JVM chỉ nạp những gì cần.

> 🧪 **Thử nghiệm:** [`ClassLoaderHierarchyExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/ClassLoaderHierarchyExample.java) in loader của từng class (`null` = bootstrap, `platform`, `app`) và chứng minh lazy initialization: chạy `java -Xlog:class+load -cp target/classes com.example.javalab.jvminternals.ClassLoaderHierarchyExample` để thấy class entry point được nạp ngay lập tức còn `Lazy` chỉ được nạp đúng lúc dùng lần đầu.

### Interpreter vs JIT compiler — và vì sao warm-up lại quan trọng

Giờ phương thức `main` đã được nạp và sẵn sàng thực thi. Nhưng thực thi _bằng cách nào_? Có hai chiến lược:

- **Interpretation:** JVM duyệt bytecode từng chỉ thị một và thực thi từng chỉ thị. Đơn giản, đúng đắn, nhưng chậm.
- **Compilation:** một trình biên dịch **JIT (Just-In-Time)** dịch bytecode của một phương thức sang native machine code một lần, rồi chạy bản native trực tiếp.

HotSpot hiện đại làm cả hai, theo từng bậc. Một phương thức bắt đầu được interpret. Trong lúc interpret, JVM âm thầm **profiling** nó: nó được gọi bao nhiêu lần, nhánh nào được rẽ, kiểu dữ liệu nào thực sự truyền vào tham số? Sau đó profile được dùng để tối ưu hóa và inline tốt hơn, rồi phương thức được biên dịch dần sang native code — đầu tiên bởi C1 (trình biên dịch "client": biên dịch nhanh, tối ưu khiêm tốn), và nếu vẫn còn hot, bởi C2 (trình biên dịch "server": biên dịch chậm, tối ưu mạnh tay).

Đây là lý do các ứng dụng Java chạy lâu có thể **nhanh dần sau warm-up**: request đầu tiên bị interpret, request thứ triệu đang chạy native code được tối ưu rất sâu, dựa trên dữ liệu thu thập từ chính workload thật của bạn. Đây cũng là lý do micro-benchmark không có bước warm-up vô nghĩa, và bạn không bao giờ nên đánh giá hiệu năng của một API Java chỉ bằng một lần gọi lạnh.

> 🧪 **Thử nghiệm:** [`WarmUpExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/WarmUpExample.java) đo cùng một phương thức theo từng epoch — các epoch sau thường in ra ns/call thấp hơn hẳn. Chạy kèm `-Xlog:jit+compilation` (JDK 24+; JDK 21–23 dùng `-Xlog:compilation`) để thấy sự kiện biên dịch phương thức xuất hiện ngay giữa lúc chạy.

## 2. Một Phương Thức Được Gọi — Điều Gì Thực Sự Xảy Ra?

Đến lúc lần theo `process(user)`.

Khi JVM khởi động `main`, nó tạo một thread cho `main`. **Mỗi thread trong JVM có một JVM stack riêng** — cấu trúc LIFO nơi mỗi lần gọi phương thức chiếm một **stack frame**. Khi `main` gọi `process`, JVM đẩy một frame mới lên stack. Khi `process` trả về, frame bị pop ra.

```
    Thread "main"
┌─────────────────────────────────────┐
│  JVM stack                         │
│  ┌───────────────────────────────┐  │
│  │ frame của process(...)        │  │  ← được đẩy lên khi gọi process
│  │   local variables             │  │
│  │   operand stack (rỗng)        │  │
│  │   return address / frame data │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ frame của main(...)           │  │  ← đã có sẵn
│  │   args        (ô 0)           │  │
│  │   user        (ô 1)           │  │  ← chứa tham chiếu đến User
│  │   operand stack               │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

Về mặt khái niệm, một frame chứa ba thứ (bố cục chính xác là chi tiết triển khai):

- **Local variables** — một mảng các ô. Ô 0 của `main` là `args`; tham chiếu đến `user` nằm ở ô 1. Mỗi ô chứa một giá trị: một primitive, hoặc một reference (một "handle" kiểu địa chỉ trỏ tới đối tượng). `long` và `double` chiếm hai ô.
- **Operand stack** — một stack LIFO nơi các chỉ thị bytecode tính toán: `iadd` pop hai số int và push tổng của chúng.
- **Frame data** — tham chiếu constant pool của class, và trong HotSpot, còn có tham chiếu đến runtime constant pool, bảng exception handler của phương thức, và PC (program counter) trỏ tới chỉ thị bytecode đang thực thi.

Gọi `process` với frame đang nằm trên cùng:

1. Caller push các tham số lên operand stack của nó.
2. JVM nhận ra `invokestatic process`, tạo một frame mới cho `process`, và copy các tham số vào các ô local của callee.
3. Thân phương thức chạy — cũng theo cách đó, mỗi chỉ thị tác động lên operand stack riêng của frame.
4. Khi gặp `return`, giá trị trả về được push lên operand stack của **caller**, và frame của callee bị vứt đi.

### Đệ quy và `StackOverflowError`

Vì mỗi lần gọi cần một frame, đệ quy sâu làm stack của thread phình ra hết frame này đến frame khác — các frame không "tái sử dụng" gì cả. Stack của thread có kích thước cố định (trong HotSpot, thường 512 KB đến 1 MB cho mỗi thread; cấu hình bằng `-Xss`). Khi đệ quy làm cạn kiệt nó, JVM ném `StackOverflowError` — không phải vì bạn hết heap, mà vì bạn hết **stack**. Đây cũng là lý do thuật toán đệ quy trên đầu vào lớn (cây sâu, danh sách lớn) thất bại ở chỗ một ngăn xếp tường minh trên heap lại thành công.

> 🧪 **Thử nghiệm:** [`StackOverflowExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/StackOverflowExample.java) đệ quy không điểm dừng và in số frame đã dùng khi `StackOverflowError` xảy ra. So sánh `java -Xss256k -cp target/classes com.example.javalab.jvminternals.StackOverflowExample` với bản `-Xss4m`: độ sâu frame tỷ lệ thuận với kích thước stack, và heap không hề liên quan.

### Sự đơn giản hóa quá mức bạn cần gỡ bỏ

Giáo trình thường dạy:

> "Primitive nằm trên stack. Đối tượng nằm trên heap."

Đây là một **mô hình tinh thần hữu ích, nhưng không đầy đủ** — và trong một số trường hợp, sai rõ ràng.

Điều đúng:

- Biến primitive cục bộ _về mặt khái niệm_ nằm trong các ô của frame — trên stack.
- Một biến cục bộ giữ một đối tượng không chứa đối tượng; nó chứa một **reference** trỏ tới một đối tượng nằm _ở nơi khác_ (về mặt khái niệm, là heap).
- Field của đối tượng, phần tử mảng, và static field luôn trỏ vào vùng lưu trữ kiểu heap.

Điều sai, hoặc ít nhất là không được đảm bảo:

- JVM **không bắt buộc** đặt bất kỳ biến cụ thể nào lên stack. JVM Specification cẩn thận không quy định vị trí vật lý; nó định nghĩa hành vi, không phải bố cục. Interpreter có thể giữ các ô stack, nhưng một phương thức được JIT biên dịch thường giữ giá trị cục bộ trong **CPU register** — thứ có thể nói là không "trên stack" cũng không "trên heap".
- **Escape analysis** (Phần 9) có thể giúp JVM nhận ra một đối tượng tạo cục bộ không bao giờ "thoát" khỏi phương thức — và khi đó đối tượng có thể bị _scalar-replace_: các field của nó trở thành các giá trị cục bộ đơn thuần, và **không có đối tượng heap nào được tạo ra**.

Vậy mô hình "primitive = stack, object = heap" giải thích runtime _khái niệm_ chứ không phải thực thi _thật_, và thực thi thật được phép — và thường xuyên — làm một điều gì đó thông minh hơn.

> 🧪 **Thử nghiệm:** [`ObjectReferenceExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/ObjectReferenceExample.java) khiến sự phân biệt "biến cục bộ giữ reference, đối tượng sống ở nơi khác" trở nên hữu hình: hai biến trỏ cùng một object (cùng `System.identityHashCode`), mutate qua biến này thấy qua biến kia, và gán `null` cho một biến không đụng chạm gì tới đối tượng.

## 3. Điều Gì Thực Sự Xảy Ra Khi Bạn Viết `new User("Hung")`?

Dòng này xứng đáng được điều tra riêng. Xem bytecode trước — `javap -c` trên một class đã biên dịch chứa dòng đó sẽ hiện:

```
 0: new           #2     // class User
 3: dup
 4: ldc           #3     // String "Hung"
 6: invokespecial #4     // Method User."<init>":(Ljava/lang/String;)V
 9: astore_1             // lưu tham chiếu vào ô local variable 1
```

Đọc ngược lại từ ngôn ngữ bậc cao:

1. **`new`** — cấp phát bộ nhớ cho đối tượng. Chưa có gì trong đối tượng được khởi tạo; JVM chỉ dành chỗ và chuẩn bị nó (trong HotSpot điều này thường là: lấy một vùng bộ nhớ đã zero từ thread-local allocation buffer — **TLAB**, nơi các thread cấp phát nóng chỉ cần nudge con trỏ thay vì tranh chấp toàn cục — và gắn một **object header**).
2. **`dup`** — nhân đôi tham chiếu, vì lời gọi constructor sẽ _tiêu thụ_ một bản, nhưng chúng ta cần bản còn lại để lưu vào biến cục bộ sau đó.
3. **`ldc "Hung"`** — nạp hằng số string lên operand stack.
4. **`invokespecial User.<init>`** — gọi constructor, tiêu thụ tham chiếu và tham số.
5. **`astore_1`** — lưu tham chiếu còn lại vào ô local variable 1: `user = ...;`.

Toàn bộ vòng đời của đối tượng hiện ra trong sáu chỉ thị bytecode.

> 🧪 **Thử nghiệm:** [`BytecodeExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/BytecodeExample.java) chứa chính xác dòng này; chạy `javap -c -p target/classes/com/example/javalab/jvminternals/BytecodeExample.class` và bạn sẽ thấy đúng dãy `new → dup → ldc "Hung" → invokespecial User.<init> → astore_1` trong `main`, và `iload / iadd` trong phương thức `sum`.

### Từng bước: máy làm gì

**Bước 1 — `new`: bộ nhớ được cấp phát.** "Heap" là một khái niệm; cách triển khai cấp phát từ một vùng do garbage collector quản lý. HotSpot cấp cho mỗi thread một **TLAB** — một lát riêng của vùng young generation. Cấp phát chỉ là đẩy con trỏ về phía trước, rẻ đến mức sánh ngang stack allocation (và thực tế nó trở thành y hệt stack allocation sau escape analysis, xem Phần 9).

**Bước 2 — Bộ nhớ được khởi tạo về giá trị mặc định.** Vùng vừa cấp phát được zero hóa. Do đó, field `int` đọc ra `0`, reference đọc ra `null`, boolean đọc ra `false` — _trước khi_ bất kỳ constructor nào chạy. Đây là một phần của ngôn ngữ đảm bảo: field luôn có giá trị mặc định, ngay cả khi không có constructor nào gán cho chúng.

**Bước 3 — Object header được đặt vào.** Trong HotSpot, mọi đối tượng bắt đầu bằng một **object header**, nơi lưu (về mặt khái niệm, không nhất thiết đúng dạng vật lý này): một **mark word** (hash code nhận dạng, tuổi GC, trạng thái khóa — đây là cách `synchronized` và các khóa nhỏ tái sử dụng header) và một **klass pointer** liên kết đối tượng với metadata của class để JVM biết kiểu của nó khi dispatch virtual call hay cast. Các field nằm sau đó ở các offset _được tính ở runtime_ (HotSpot sắp xếp field để giảm padding; bố cục là chi tiết triển khai, và có thể được nén với **compressed oops**, nơi reference được lưu dưới dạng offset 32-bit vào một địa chỉ cơ sở thay vì con trỏ 64-bit đầy đủ).

**Bước 4 — Field được khởi tạo.** Vùng nhớ đã được zero hóa ở bước 2, nên mọi field đã mang giá trị mặc định sẵn. Constructor bắt đầu chạy với lời gọi ngầm `super()` — bước đầu tiên của mọi constructor (đối với `User`, nhánh đó chỉ dựng `Object`, rỗng), kế đến là các _field initializer tường minh_ (`private String name = "default"`) chạy theo thứ tự khai báo, và cuối cùng thân constructor bạn viết chạy: `this.name = "Hung";`. Thứ tự thực sự là: zero hóa → `super()` → field initializer → thân constructor.

> 🧪 **Thử nghiệm:** [`FieldInitializationExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/FieldInitializationExample.java) in ra thứ tự `super() → field initializer → constructor body` cùng các field chưa bao giờ được gán — chúng vẫn đọc ra `0`, `false`, `null` nhờ zero hóa, đúng như bảo đảm của ngôn ngữ.

**Bước 5 — Tham chiếu được gán cho `user`.** Biến cục bộ `user` — ô 1 của frame `main` — giờ giữ một tham chiếu đến đối tượng.

### Sơ đồ giải tỏa hầu hết những nhầm lẫn

```
   Thread "main" — JVM stack                    Heap
┌──────────────────────────────┐     ┌──────────────────────────────────────┐
│  main frame                  │     │                                      │
│  ┌────────────────────────┐  │     │   ┌───────────────────────────┐      │
│  │ args      (ô 0)        │  │     │   │  User object              │      │
│  │ user ──────────────────┼──┼─────┼──►│  ┌─────────────────────┐  │      │
│  └────────────────────────┘  │     │   │  │ object header       │  │      │
│                             │     │   │  │  mark word           │  │      │
│  Ô này chứa một REFERENCE   │     │   │  │  klass pointer ──────┼──┼───┐  │
│  trỏ tới một đối tượng      │     │   │  ├─────────────────────┤  │   │  │
│  trên heap.                 │     │   │  │ name  ──────────────┼──┼─┐ │  │
└──────────────────────────────┘     │   └───────────────────────┘  │ │ │  │
                                     │                     ┌────────┘ │ │  │
                                     │                     │ ┌─────────┘ │  │
                                     │   ┌─────────────────▼─▼──────────┐  │
                                     │   │  String "Hung" object        │  │
                                     │   │  (char[] value, ...)         │  │
                                     │   └──────────────────────────────┘  │
                                     └──────────────────────────────────────┘
```

Điểm mấu chốt: **biến cục bộ và đối tượng là hai thứ khác nhau.** `user` là một ô nhỏ trong frame trên stack của thread. Đối tượng `User` là một vùng trong bộ nhớ dùng chung do GC quản lý, có thể tiếp cận _thông qua_ `user`. Chính sự phân biệt đó giải thích reference, tính reachability của GC, và hầu hết các nhầm lẫn "đối tượng còn sống hay không" ngay sau đây.

> 🧪 **Thử nghiệm:** [`ObjectReferenceExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/ObjectReferenceExample.java) minh họa đúng sơ đồ trên: `u2 = u1` sao chép reference chứ không phải đối tượng, và `u2 = null` chỉ gỡ một đường dẫn.

## 4. Khi Nào Một Đối Tượng Thực Sự Chết?

Bây giờ đến động tác tiếp theo của lập trình viên:

```java
User user = new User("Hung");
user = null;
```

**Đối tượng có bị xóa ngay lập tức không?**

Không. Gán `null` cho một reference không làm gì với đối tượng cả. Nó chỉ gỡ _một_ đường dẫn trỏ tới đối tượng — ô `user`. Bản thân đối tượng vẫn nằm nguyên trong heap memory, nguyên vẹn, bị phớt lờ. Không gì quét nó, không gì giải phóng nó, không gì phá vỡ tham chiếu của nó tới string `"Hung"`.

Java không có `delete`. Java không giải phóng bộ nhớ khi gán. Bộ nhớ của Java được thu hồi bởi một garbage collector chạy **theo lịch riêng, về sau, và hàng loạt** — chứ không phải vào lúc bạn ngừng quan tâm đến một đối tượng.

### Reachability — khái niệm thực sự

GC không hỏi "biến này có được gán null không?" Nó hỏi: **"Đối tượng này có reachable không?"**

Đồ thị hoạt động như sau:

```
GC Roots                                       Heap
─────────                                      ─────────────────────
(biến cục bộ trên stack,          ┌───────┐
 static field,                    │  objA │ ◄──── vẫn reachable
 JNI reference, ...)              └───────┘
      │         │                     ▲
      │         └─────────────────────┘
      │
      ▼
┌───────────┐      ┌───────────┐
│  objB     │───►  │  objC     │   reachable — qua objB
└───────────┘      └───────────┘
      ▲
      │
┌───────────┐      ┌───────────┐
│  objD     │◄─────│  objE     │   cả hai UNREACHABLE — không có
└───────────┘      └───────────┘   đường nào từ GC Root
```

**GC Roots** là những điểm neo cố định của đồ thị đối tượng — nơi tính sống bắt đầu trong góc nhìn của garbage collector: biến cục bộ trong các frame đang hoạt động, static field của các class đã nạp, register giữ reference trong code đã biên dịch, JNI handle, và vài loại khác.

Bắt đầu từ mọi root, collector đi theo reference một cách bắc cầu (transitively). Mọi đối tượng chạm tới được gọi là **reachable** — còn sống, giữ bộ nhớ. Mọi đối tượng không bao giờ được chạm tới là **unreachable** — và unreachable chính là định nghĩa của "chết" trong Java.

`user = null` của chúng ta làm cho `User` trở nên unreachable: trước đó `user` (một root) trỏ tới nó; giờ không còn đường nào từ root tới nó. Nhưng "unreachable" chỉ có nghĩa là _đủ điều kiện_. Collector có thể thu hồi nó trong chu kỳ tiếp theo — hoặc một chu kỳ xa xôi hơn.

> 🧪 **Thử nghiệm:** [`ReachabilityExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/ReachabilityExample.java) quan sát collector từ bên ngoài bằng `WeakReference`: ngay sau `big = null`, đối tượng vẫn còn nguyên vẹn (gán null xóa không gì cả) — phải tới khi GC chạy và chứng minh nó unreachable, reference yếu mới bị dọn.

### Vì sao garbage collection mang tính bất định

- GC tự quyết **khi nào** chạy dựa trên áp lực cấp phát, heap hiện có, mục tiêu pause, và chính sách riêng của từng collector — chứ không phải dựa trên các phép gán của bạn. Thời điểm chính xác không nằm trong bất kỳ thông số kỹ thuật nào.
- Đối tượng nào chết trong chu kỳ nào cũng khác nhau; một đối tượng "đã chết" có thể sống sót qua vài lần thu gom (trong generational collector, các đối tượng trẻ unreachable thường bị quét sạch sớm, nhưng không có cam kết nào).
- `System.gc()` là một _yêu cầu_, không phải lệnh — nó nhờ JVM chạy một đợt full collection "tùy lúc thuận tiện", và các collector hiện đại có thể phớt lờ nó hoàn toàn.

Kết luận: đừng bao giờ viết code phụ thuộc vào thời điểm hủy diệt. Java không có bảo đảm destructor (nó có `finalize` và `Cleaner`, nhưng cả hai đều không nên được dùng cho logic vòng đời). Nếu bạn cần dọn dẹp xác định — đóng file, giải phóng kết nối — hãy làm _tường minh_ bằng `try-with-resources`, và để việc quản lý bộ nhớ nằm trong tay GC.

## 5. Garbage Collection Thực Sự Suy Nghĩ Như Thế Nào

Trước khi nhìn vào các collector cụ thể, hãy hiểu **ba thao tác trừu tượng** mà mọi tracing collector thực hiện:

1. **Mark** — đi từ GC Roots, bắc cầu, và đánh dấu mọi đối tượng reachable. Việc này xác định một cách tường minh tập hợp còn sống; mọi thứ khác mặc nhiên là rác.
2. **Sweep** — đi qua bộ nhớ và thu hồi các đối tượng chưa được đánh dấu, nối các khối trống lại thành một free list.
3. **Compact** — trượt các đối tượng còn sống sát lại nhau để loại bỏ phân mảnh: khoảng chết giữa các đối tượng sống sụp đổ. (Biến thể: **copying collection** copy các đối tượng sống sang một vùng mới, để lại vùng cũ hoàn toàn trống — vừa thu gom vừa compact trong một động tác.)

Marking là _tracing_: nó suy luận về toàn bộ đồ thị đối tượng, không quan tâm tham chiếu nào đang trỏ vào _bạn_. Đúng đặc tính này — tracing từ gốc — khiến GC của Java về bản chất khác với reference counting (chúng ta sẽ thấy vì sao trong Phần 6).

### Generational collection — vì sao đối tượng trẻ quan trọng

Kinh nghiệm cho thấy hầu hết đối tượng chết trẻ: một `StringBuilder` tạm thời, một `BigDecimal` trong vòng lặp, một DTO theo request. Điều này đúng đến mức nó có tên gọi: **weak generational hypothesis**. Các generational collector khai thác điều đó bằng cách chia không gian quản lý thành các vùng với workload rất khác nhau:

```
   Young generation (thay máu liên tục)         Old generation (sống lâu)

┌─────────┬─────────┬─────────┐          ┌────────────────────────────┐
│  Eden   │ Surv 0  │ Surv 1  │          │      Old generation        │
│ (mới    │ (tuổi 1)│ (tuổi   │          │  những đối tượng sống sót   │
│  sinh)  │         │ 2+)     │          │  qua các chu kỳ trẻ được   │
│         │         │         │          │  promoted lên đây          │
└─────────┴─────────┴─────────┘          └────────────────────────────┘
     │                                        ▲
     └── minor cycle copy survivor ───────────┘
```

Đối tượng được sinh ra trong **Eden**. Khi Eden đầy, một chu kỳ **young-only GC** (thường gọi là _minor_ GC) chạy: nó copy những đối tượng sống sót vào một **survivor space** (kèm bộ đếm tuổi — ghi chú chúng đã sống sót qua bao nhiêu chu kỳ), và cuối cùng promoted những survivor già nhất lên **old generation**. Young collection rẻ _vì_ hầu hết Eden đã chết — copy vài survivor rồi vứt phần còn lại rẻ hơn nhiều so với quét toàn bộ heap.

Old generation phình chậm hơn, nên bị thu gom ít hơn, nhưng mỗi lần thu gom lại nặng nề hơn. Cẩn thận với thuật ngữ ở đây: **"full GC" và "major GC" có nghĩa khác nhau ở từng collector.** Trong G1 chẳng hạn, bạn có _young-only_ cycle, _mixed_ cycle (young + một phần old region), và một _full GC_ tường minh (thường là triệu chứng các chiến lược khác đã thất bại); ZGC và Shenandoah làm cho collection của old generation chạy concurrent chính là để giảm các sự kiện stop-the-world này. Khi đọc GC log, luôn tra cứu các thuật ngữ theo tài liệu của chính collector đó.

> 🧪 **Thử nghiệm:** [`GenerationalGcExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/GenerationalGcExample.java) in số lần thu gom của young và old generation trước/sau một workload gồm 64 MB object sống lâu cộng rác ngắn ngày: young tăng, old gần như đứng yên. Chạy với `-Xmx256m -Xlog:gc` để thấy từng `Pause Young (Normal)` trong log.

### Collector hiện đại — đánh đổi, không phải phép màu

| Collector                             | Ý tưởng cốt lõi                                                                                                                | Đánh đổi chủ đạo                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **G1** (mặc định từ Java 9)           | Heap theo region; đáp ứng _mục tiêu pause time_ bằng cách thu gom tăng dần trong các lát pause nhỏ cố định                     | Pause dự đoán được trên heap lớn, nhưng tốn nhiều CPU và header hơn               |
| **ZGC** (từ JDK 15/16, old-gen từ 21) | Gần như tỷ lệ thuận với _kích thước tập hợp sống_, collection mostly concurrent; pause hầu như không tăng theo kích thước heap | Phức tạp — mỗi lần đọc phải trả một chút chi phí color/barrier, footprint lớn hơn |
| **Shenandoah**                        | Hoàn toàn concurrent evacuation — ngay cả _di chuyển_ cũng chạy song song với thread ứng dụng                                  | Tương tự ZGC: chi phí barrier và CPU để đổi lấy latency                           |

Vấn đề không phải là học thuộc thuật toán. Vấn đề là: mọi collector là một phép dung hòa kỹ thuật giữa **pause time**, **throughput**, **footprint** và **độ phức tạp**. Chọn một cái là quyết định ở cấp hệ thống, dựa vào kích thước heap, mục tiêu latency và ngân sách CPU của bạn — chứ không phải một flag bạn bật vì một bài blog nói vậy.

### Sơ đồ — phễu young/old

```
 Cấp phát ──► Eden ──► young-only GC ──► Survivor space (tuổi++) ──► Old gen
 (TLAB)        │            │                                    │
               └─► chết     └─► chết                             └─► mixed/big collection
              (đa số đối tượng chết ở đây)      (đối tượng sống lâu nằm ở đây)
```

Vì sao bạn nên quan tâm khi viết code? Bởi vì young generation _kỳ vọng_ bạn tạo rác và chỉ phạt bạn một cách nhẹ nhàng; nơi đắt đỏ là **old generation**. Ngược đãi old-gen (tạo liên tục các cấu trúc dài hơi khổng lồ, làm rò rỉ vào đó, hoặc nhồi những đối tượng chết non vào đó) chính là cách các ứng dụng rơi vào vòng lặp full GC tốn kém — sự cố production kinh điển mang tên "GC thrashing".

## 6. Trường Hợp Đặc Biệt: Tham Chiếu Vòng Không Phải Là Memory Leak

Hãy xem trường hợp "bất khả thi" kinh điển:

```java
class A { B b; }
class B { A a; }

void leakCheck() {
    A a = new A();
    B b = new B();
    a.b = b;
    b.a = a;          // A ↔ B giờ trỏ vào nhau
    a = null;
    b = null;         // không root nào trỏ tới... hay là vẫn có?
}
```

Truyền thuyết dai dẳng: _hai đối tượng trỏ vào nhau thì không bao giờ được GC thu hồi._

Điều đó sai. Cả hai đối tượng đều chết.

```
Trước a = null, b = null:            Sau:

ROOT ──► A ──► B              ROOT      A ◄──► B
          ▲   │                          (unreachable)
          └───┘
```

Cả hai đối tượng _từng_ reachable từ root qua các biến cục bộ. Khoảnh khắc cả hai biến cục bộ bị xóa, không còn đường nào từ bất kỳ GC Root nào tới `A` hoặc `B`. `A → B` và `B → A` chỉ là các cạnh _giữa những mảnh rác_ — không cái nào trỏ tới nơi collector quan tâm. Pha mark đơn giản là không bao giờ chạm tới chúng, và cả hai được thu hồi, dù có vòng hay không.

### Vì sao reference counting sai ở chỗ này — và tracing thì không

Các ngôn ngữ như Python thời kỳ đầu hay Objective-C dùng **reference counting**: mỗi đối tượng giữ một bộ đếm số tham chiếu tới nó; khi bộ đếm về 0, nó bị giải phóng _ngay lập tức_. Giờ xét `A ↔ B`: giảm bộ đếm của `A` xuống, nó đi từ 2 xuống 1 chứ không phải 0 — vì `B` vẫn tham chiếu nó. Không cái nào chạm mốc 0. Cặp đôi đó rò rỉ vĩnh viễn, trừ khi gắn thêm cơ chế phát hiện vòng phức tạp.

Collector của Java không đếm tham chiếu. Nó **tracing**: bắt đầu từ root, đi qua đồ thị, thu hồi mọi thứ không được ghé thăm. Câu hỏi "Ai đang tham chiếu tôi?" không bao giờ được hỏi; chỉ có "Tôi có reachable từ root không?" mới có ý nghĩa. Đó chính xác là lý do vòng tham chiếu được thu hồi _tự động_ — kể cả các vòng thực tế hơn nhiều như một collection cha tham chiếu đến phần tử con và bị chính phần tử con tham chiếu ngược, xuất hiện trong mọi domain model thật.

> 🧪 **Thử nghiệm:** [`CircularReferenceExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/CircularReferenceExample.java) dựng một vòng cha ↔ con, rồi gỡ mọi root: vòng đó biến mất ở chu kỳ GC đầu tiên — dùng `WeakReference` để quan sát, vì một collector tracing thăm đồ thị chứ không hỏi "ai đang trỏ vào tôi?".

Đây cũng là lý do các kiểu reference yếu (`WeakReference`, `WeakHashMap`) tồn tại và hoạt động hợp lý: reachability — chứ không phải đếm — mới là ngôn ngữ của mô hình bộ nhớ Java.

## 7. Java Có GC, Vậy Vì Sao Vẫn Có Memory Leak?

Nếu GC thu hồi mọi thứ unreachable, làm sao một chương trình Java có thể phình heap cho đến khi chết?

Bởi vì có một khác biệt sâu sắc giữa:

- **Đối tượng không còn cần nữa** (đánh giá của lập trình viên), và
- **Đối tượng unreachable** (đánh giá của GC).

Garbage collection là một _máy dò reachability_, không phải máy dò _sự cần thiết_. Bất cứ thứ gì bạn vô tình giữ reachable sẽ không bao giờ bị thu hồi — dù nó rõ ràng vô dụng đến đâu. Một memory leak trong Java thường có nghĩa là chương trình **vô tình giữ các đối tượng reachable**.

### Góc nhìn của collector về một leak kinh điển

```java
public class UserCache {
    private static final Map<String, User> USERS = new HashMap<>();

    public static void remember(User user) {
        USERS.put(user.getId(), user);      // mọi user được yêu cầu, mãi mãi
    }
}
```

Nhìn khách quan: map là `static` — một GC Root. Mọi `User` đưa vào đó là reachable _ngay từ bản chất_. Nếu cache không có chính sách eviction, heap phình to cho đến `OutOfMemoryError`. GC đang làm việc hoàn hảo: mỗi user được lưu, ở một thời điểm nào đó, có thể là chính đáng. Bug nằm ở chỗ không có gì quyết định rằng chúng đã xong việc.

Các biến thể thực tế của cùng một căn bệnh:

**1. Cache không có giới hạn / map key theo dữ liệu request**

```java
Map<String, Result> resultsByRequestId = new HashMap<>();
// mỗi request đến thêm một entry; entry không bao giờ bị xóa
```

**2. Event listener không bao giờ được gỡ**

```java
someService.addListener(myListener);   // caller quên removeListener(...)
```

Nếu `someService` sống lâu (một singleton), nó giữ một listener được tham chiếu mạnh mãi mãi — cùng với _mọi thứ_ mà listener đó tham chiếu (thường là toàn bộ đồ thị đối tượng bao quanh: một controller hay consumer từng có scope request).

**3. Dùng sai `ThreadLocal` với thread pool**

```java
private static final ThreadLocal<BigData> PER_THREAD = new ThreadLocal<>();

void handle(Request r) {
    PER_THREAD.set(expensiveData());
    // ... không bao giờ PER_THREAD.remove()
}
```

Trong một web server, "thread" là có pool và sống lâu. Giá trị `ThreadLocal` của mỗi pool thread tính là _reachable từ một GC Root_ (các thread được pool tham chiếu, và giá trị `ThreadLocal` treo trên thread của chúng). Đặt cái này vào pool 200 thread mà không `remove()` và bạn giữ tới 200 bản `expensiveData` — vĩnh viễn. (Tệ hơn: ngay cả khi bạn gán `ThreadLocal` của mình về null, cái _entry_ vẫn có thể tồn tại cùng giá trị của nó cho đến khi cái key yếu của entry bị xóa.)

**4. Reference sống lâu, sống quá cả nhu cầu sử dụng**

```java
private Model model;   // được gán từ một request lớn, dùng một lần, rồi giữ
                       // đến hết đời của bean sống lâu này
```

Một field, tưởng vô hại, có thể ghim cả một đồ thị đối tượng khổng lồ.

### Cái mô hình, trong một dòng

> Một memory leak của Java hầu như không bao giờ là lỗi của GC — đó là khi chương trình **vô tình giữ các đối tượng reachable**.

Nếu các đối tượng bị giữ phải sống sót hợp pháp hơn nguồn dữ liệu của chúng, hãy dùng đúng công cụ: `WeakHashMap`, `WeakReference`/`ReferenceQueue`, cache có eviction (`CacheBuilder`, `Caffeine`) — bất cứ thứ gì biến một cái ghim strong không thể hủy thành một cái có thể hủy. Và khi một heap dump cho thấy hàng gigabyte "một `HashMap` to đùng", giải pháp là _chính sách eviction_ và _kỷ luật sở hữu_, chứ không phải một `-Xmx` to hơn.

> 🧪 **Thử nghiệm:** [`MemoryLeakExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/MemoryLeakExample.java) so sánh hai cache giữ key tới đối tượng đã chết: `HashMap` giữ các key strong — sau hai vòng GC, 2000 mục vẫn nằm đó; `WeakHashMap` để các key bị GC dọn khi không ai dùng — về 0. Cũng xem thêm [`ThreadLocalLeakExample`](https://github.com/hungpt99-dev/java-lab/blob/lab/thread/src/main/java/com/example/javalab/threads/ThreadLocalLeakExample.java) (nhánh `lab/thread`) — phiên bản thread-pool của cùng cái bẫy.

## 8. Trường Hợp Đặc Biệt: `OutOfMemoryError` Không Phải Lúc Nào Cũng Là Heap Đầy

`OutOfMemoryError` là một chiếc mũ đội vừa nhiều cái đầu. Nó được ném — ở nhiều phiên bản của cùng một `Error` — mỗi khi một tài nguyên nào đó JVM cần **không thể lấy được**. Chỉ một số phiên bản liên quan đến heap bạn đã nâng bằng `-Xmx`. Tăng `-Xmx` mù quáng cho mọi OOME là phản xạ kinh điển: giải quyết một vấn đề và che giấu những vấn đề khác.

| Thông điệp ngoại lệ                  | Cái gì thực sự cạn kiệt                                                                                                             | Nguyên nhân điển hình                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Java heap space`                    | Heap (giới hạn bởi `-Xmx`)                                                                                                          | Rò rỉ đối tượng, collection khổng lồ, cấp phát quá sức thật sự                                              |
| `Metaspace`                          | Vùng class metadata — _native memory, giới hạn bởi `-XX:MaxMetaspaceSize`_                                                          | Sinh class động không kiểm soát: reflection, proxy, bytecode generation, biên dịch JSP/scripting            |
| `Direct buffer memory`               | Các **direct** (off-heap) buffer, tính vào `-XX:MaxDirectMemorySize`                                                                | Các consumer `ByteBuffer.allocateDirect` (NIO, netty, compression) không bao giờ release                    |
| `Unable to create new native thread` | Thread **ở cấp hệ điều hành** — giới hạn tiến trình, `ulimit -u`, giới hạn pid cgroup, hoặc chính không gian địa chỉ của tiến trình | Tạo thread cho từng tác vụ (không có pool), virtual thread pinning mất kiểm soát, giới hạn của hệ điều hành |

Chú ý cái mô hình: trong bốn cái, chỉ cái đầu tiên sống trong heap. Các cái còn lại nằm hoàn toàn bên ngoài:

- **Metaspace** lưu metadata của class, không phải đối tượng. Phình to vì class được sinh ra (và không bao giờ được unload, vì class loader bị giữ).
- **Direct buffer** là native memory được `malloc` rồi giao cho Java qua một đối tượng `DirectByteBuffer` _nhỏ xíu_; đối tượng thì nhỏ, khối native thì khổng lồ. GC chỉ tái chế chúng qua một cleaner chạy bất đồng bộ — sự cố "heap trông vẫn ổn mà bộ nhớ cứ tăng" kinh điển trên các đồ thị ngoài heap.
- **Native thread** tiêu thụ native memory _và_ stack space, và có thể chạm giới hạn hệ điều hành từ rất lâu trước khi heap biết chuyện gì đang xảy ra.

### Tư duy gỡ rối thực dụng

Khi OOME ập đến, hãy cưỡng lại phản xạ. Đi theo bậc thang này:

1. **Xác định vùng bộ nhớ nào cạn kiệt** — đọc _thông điệp_ (`Java heap space` so với `Metaspace` so với `Direct buffer memory` so với `Unable to create new native thread`). Mỗi cái chỉ một hệ thống con và một núm `-XX` khác nhau; một `-Xmx` không dịch chuyển được cái nào khác.
2. **Hiểu cái gì đang cấp phát vùng bộ nhớ đó.** Theo dấu nơi cấp phát bằng profiler: heap — object dump; metaspace — log nạp class (`-Xlog:class+load`); direct — stack cấp phát buffer; thread — đếm thread (`jstack` / `jcmd Thread.print`).
3. **Kiểm tra xem đối tượng bị _giữ_ chứ không chỉ bị cấp phát.** Chụp một **heap dump** (`jmap -dump:live`, hoặc `-XX:+HeapDumpOnOutOfMemoryError`) và kiểm tra tập hợp bị _giữ_: có phải một `HashMap` đang ôm mấy megabyte dữ liệu dùng một lần? Một `ThreadLocal` cho mỗi pool thread? Công cụ: `jcmd GC.heap_dump`, `jvisualvm`/`jconsole`, Eclipse MAT hoặc tính năng leak suspect tích hợp.
4. **Kiểm tra phía native khi heap vẫn ổn.** Nếu RSS cứ tăng mà heap ổn định: direct buffer, rò rỉ class loader (`Metaspace`), JNI, hoặc thread. HotSpot có **Native Memory Tracking** (`-XX:NativeMemoryTracking=summary`, `jcmd VM.native_memory`) chính xác cho việc này.
5. **Chỉ sau đó mới cân nhắc cấu hình.** Tăng `-Xmx` là một nước đi về _dung lượng_. Nếu bạn đang giữ dữ liệu đáng lẽ không nên giữ, nước đi đúng là dừng giữ nó; nếu bạn đang sinh class, nước đi đúng là unload hoặc tái sử dụng; nếu bạn tạo thread cho từng tác vụ, nước đi đúng là dùng pool (và trên JDK 21+, virtual thread cho công việc I/O-bound, không tốn một native thread cho mỗi tác vụ).

Tóm một câu: thông điệp OOME cho bạn biết _hệ thống bộ nhớ nào_ thất bại; cách sửa đúng là sửa _hệ thống đó_, chứ không phải cái mà bạn đã tinh chỉnh.

> 🧪 **Thử nghiệm:** [`OutOfMemoryAreasExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/OutOfMemoryAreasExample.java) nhận một tham số để chọn vùng bộ nhớ — `java -Xmx32m -cp target/classes com.example.javalab.jvminternals.OutOfMemoryAreasExample heap` làm tràn heap (`Java heap space`), còn `-XX:MaxDirectMemorySize=8m ... direct` làm tràn direct buffer (`Direct buffer memory`) — cùng một ngoại lệ `OutOfMemoryError`, hai hệ thống bộ nhớ khác nhau.

## 9. Khi JVM Thông Minh Hơn Bạn Nghĩ

Quay lại chủ đề cấm kỵ của Phần 2 — stack vs heap — vì bây giờ JVM làm một điều thực sự bất ngờ:

```java
public int calculate() {
    Point point = new Point(10, 20);
    return point.x + point.y;
}
```

**Đối tượng `Point` này có luôn luôn cần tồn tại như một đối tượng heap thật không?**

Thoạt nhìn, "tất nhiên": `new` là cấp phát. Nhưng đây chính là nơi JVM trở nên thú vị.

Trình biên dịch C2 của HotSpot thực hiện **escape analysis**: nó phân tích liệu `point` có thể "thoát" khỏi phương thức — tham chiếu của nó có được lưu vào field không? có được truyền cho phương thức khác không? có được trả về không? có được công bố cho thread khác không? Nếu _không có_ điều nào xảy ra, đối tượng là **non-escaping** — vô hình với mọi thứ khác, và do đó _danh tính_ của nó chỉ là một ảo ảnh mà ngôn ngữ ép chúng ta phải tin.

Một khi JVM biết `point` không thể thoát, nó có thể áp dụng:

- **Scalar replacement** — tách đối tượng thành các field: `point` trở thành hai biến cục bộ, `x` và `y`, mỗi cái sống trong register hoặc ô stack. _Nơi lưu trữ_ của đối tượng không bao giờ tồn tại.
- **Allocation elimination / stack allocation** — với đối tượng non-escaping vẫn phải tồn tại, có thể dùng **stack allocation** hoặc bộ nhớ không bao giờ chạm vào heap do GC quản lý. Đối tượng chết cùng frame; không tương tác với GC nào cả.
- **Lock elision** — một tối ưu hóa gần gũi: một monitor chỉ được giữ bởi kẻ tạo ra nó có thể bị loại bỏ.

`calculate()` sau khi viết lại có hiệu quả trở thành:

```java
public int calculate() {
    int x = 10, y = 20;        // field được nâng lên thành biến cục bộ
    return x + y;              // không còn cấp phát nào cả
}
```

Vậy: _đôi khi_ — khi JVM chứng minh được đối tượng không bao giờ thoát — `new Point(10, 20)` **không tạo ra bất kỳ heap allocation nào**, không object header, không TLAB bump, không gì hiện ra trước mắt collector nào. Ngữ nghĩa ngôn ngữ vẫn nguyên vẹn, bởi vì không ai có thể quan sát được sự khác biệt (không identity thoát ra, không đồng bộ hóa, không quan sát identity-hash).

### Những cảnh báo quan trọng

- Đây là các **tối ưu hóa, không phải bảo đảm**. Chúng phụ thuộc vào bậc compiler, cấu hình JIT, bản triển khai JVM, và thậm chí trạng thái profiling ở runtime. JVM Specification **không hứa** bất kỳ đối tượng nào được hay không được cấp phát — nó hứa _hành vi quan sát được_.
- Quyết định tối ưu hóa có thể bị **thu hồi bất cứ lúc nào** (deoptimization): nếu giả định của một phương thức đã biên dịch bị phá vỡ, JVM trở về interpreter, và hành vi cấp phát có thể thay đổi _ngay giữa lúc chương trình chạy_.
- Escape analysis có giới hạn: những đối tượng thoát ra (được lưu trữ, công bố, trả về, bị bắt trong lambda/closure) thì _không_ bị loại bỏ. Các đối tượng _sống lâu_ của bạn vẫn trả chi phí cấp phát thật.

Đây là lời giải sâu cho câu đố ở Phần 2: mô hình khái niệm nói "đối tượng sống trên heap", và _cỗ máy có thể hợp pháp thay heap bằng register_ mỗi khi ngữ nghĩa cho phép. Đừng viết code _phụ thuộc_ vào việc cấp phát xảy ra ("tôi có thể phát hiện cấp phát trong một vòng lặp bằng cách..."), và đừng ngạc nhiên khi một micro-benchmark báo zero allocation với code trông như đang cấp phát.

> 🧪 **Thử nghiệm:** [`EscapeAnalysisExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/EscapeAnalysisExample.java) tạo 10 triệu điểm trong một phương thức không để chúng thoát ra ngoài: chạy `-Xmx32m -Xlog:gc -cp target/classes com.example.javalab.jvminternals.EscapeAnalysisExample` với escape analysis bật — không một `Pause Young` nào; thêm `-XX:-DoEscapeAnalysis` — hàng chục pause và một lần `OutOfMemoryError`.

Điều này cũng giải thích vì sao thêm một _escape hữu hình_ — ví dụ lưu `point` vào một field "phòng khi cần debug" — có thể làm thay đổi đo lường được hành vi cấp phát: bạn vừa đẩy một đối tượng non-escaping vào thế giới escaping.

## 10. Các Trường Hợp Đặc Biệt Của Java Khiến Lập Trình Viên Bất Ngờ

JVM giấu cỗ máy của nó sau ngữ nghĩa ngôn ngữ — và thỉnh thoảng cỗ máy đó tung ra một cái bóng khiến người ta vấp ngã. Đây là bốn chỗ nổi tiếng nhất.

### 10.1 Integer cache

```java
Integer a = 100;
Integer b = 100;
System.out.println(a == b);      // in ra ?

Integer c = 200;
Integer d = 200;
System.out.println(c == d);      // in ra ?
```

Hầu hết lập trình viên dự đoán `true` / `false`, và nhầm ngược ở cả hai đầu — kết quả thật là `true` cho `100` và **`false`** cho `200`.

Cơ chế: `Integer a = 100` là autoboxing — viết tắt của `Integer.valueOf(100)`. Và `valueOf` thì _có cache_: JDK cache các instance `Integer` cho một khoảng nhỏ (mặc định `-128..127`), trả về _cùng một đối tượng_ cho các lần gọi lặp lại trong khoảng đó. Vậy `a == b` so hai reference trỏ đến một instance được cache dùng chung — `true`. Ở `200`, cache trượt, hai đối tượng `Integer` riêng biệt được tạo ra, và `==` so reference — `false`. (Khoảng này có thể tinh chỉnh: `-XX:AutoBoxCacheMax=...` mở rộng nó.)

Bài học kép ở đây: `==` trên kiểu boxed so _identity_, không bao giờ so giá trị; và cache khiến hành vi của chúng _phụ thuộc vào giá trị theo cách trái ngược trực giác_. Luôn so số bằng `equals` (hoặc `intValue()`), luôn unbox trước khi `==` — và nhớ rằng thủ thuật tương tự tồn tại cho `Boolean` và (cache nhỏ hơn) các kiểu boxed khác.

> 🧪 **Thử nghiệm:** [`IntegerCacheExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/IntegerCacheExample.java) in ra kết quả `==` cho 100, 200 và 1000: `100` — `true` (cùng instance cache); `200`, `1000` — `false`. Chạy với `-XX:AutoBoxCacheMax=2000` và `1000` lật sang `true` — cache trượt hay trúng là một flag JVM, không phải ngữ nghĩa ngôn ngữ.

### 10.2 NPE khi unbox null

```java
Integer value = null;
int result = value;        // điều gì xảy ra?
```

`int result = value` là unboxing — được biên dịch thành `value.intValue()`. Gọi một phương thức trên `null` ném `NullPointerException`. Vậy dòng này **luôn ném NPE**, dù trông "hiển nhiên là 0". JDK hiện đại thậm chí nêu tên thủ phạm: _"Cannot invoke 'java.lang.Integer.intValue()' because 'value' is null"_ (thông điệp hữu ích từ JDK 14+). Kết bài: bất kỳ dữ liệu nào truyền vào API kiểu primitive qua ranh giới autoboxing đều mang theo một lời gọi phương thức ẩn có thể thất bại — hãy validate trước khi unbox, đừng bao giờ cho rằng nullability biến mất tại lớp parse từ tầng lưu trữ.

> 🧪 **Thử nghiệm:** [`UnboxingNpeExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/UnboxingNpeExample.java) chứng minh điều đó trong bốn dòng: `Integer value = null;` rồi `int result = value;` — NPE ngay lập tức, và trên JDK 14+ thông điệp chỉ đích danh lời gọi `intValue()` bị chặn bởi null.

### 10.3 Hai cuộc đời của `"hello"`

```java
String a = "hello";
String b = "hello";
System.out.println(a == b);        // true

String c = new String("hello");
System.out.println(a == c);        // false
```

`"hello"` với tư cách _literal_ là một **compile-time constant**: `javac` intern nó — đưa nó vào **string pool**, một sổ bộ của JVM mà mọi class đều chia sẻ. `a` và `b` nạp _cùng một_ instance được pool hóa, nên `==` là `true`. `new String("hello")` chẳng dính dáng gì đến pooling: thông thường nó tạo ra một đối tượng _mới_ (và bản copy trong pool trở nên thừa). Nên `==` là `false`.

Sự tinh tế sâu hơn khi string được _dựng lên_:

- **Compile-time constant** — `"hel" + "lo"` được `javac` gấp lại thành literal duy nhất `"hello"` → pool hóa. Nếu cả `String x = "hel" + "lo"` lẫn literal của bạn đều là compile-time constant, `==` _có thể_ là `true`!
- **Runtime concatenation** — `String name = firstName + "Hung"` tạo ra một đối tượng _mới_ tại runtime (`invokedynamic` với `StringConcatFactory` trong javac hiện đại), không bao giờ là cái được pool hóa. `==` là `false` kể cả khi `firstName` là `"Pham "`.
- **`intern()`** — gọi tường minh vào pool: `c.intern()` trả về instance chính tắc được pool hóa, làm `a == c.intern()` thành `true`. Đây gần như luôn là code smell trừ khi bạn thực sự cần canonicalization (ví dụ làm key trong một parser).

Quy tắc ngón tay cái, mỗi cái một dòng: so nội dung bằng `equals`, luôn luôn; literal được pool hóa, `new` thì không; không bao giờ tin `==` trên string trừ khi bạn cố ý dựa vào pooling của string intern'd/compile-time; và nhớ pool nằm trong heap (từ Java 7) — hàng nghìn chuỗi `intern()` độc nhất _cũng_ ngốn heap.

> 🧪 **Thử nghiệm:** [`StringPoolExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/StringPoolExample.java) so `==` trên bốn cách tạo "hello": literal — `true` (cùng phần tử pool); hằng số ghép `"hel" + "lo"` — `true` (tối ưu compile-time); `new String("hello")` — `false` (đối tượng heap mới); nối runtime `"hel" + s` — `false`. Chạy với `-Xlog:stringtable` để thấy pool được đổ đầy.

### 10.4 `finally` có thể thay đổi kết quả

```java
static int probe() {
    try {
        return 1;
    } finally {
        return 2;
    }
}
// probe() trả về ...?
```

Câu trả lời — **2** — khiến người ta vỗ trán trong code review mỗi năm. JVM biên dịch một khối `finally` vào _mọi đường thoát_ của `try`: đường bình thường, và từng đường exception handler. Lệnh `return` trong `finally` thực thi _sau khi_ biểu thức `return 1` đã được tính nhưng _trước khi_ phương thức thực sự trả về — và một `return` được thực thi là một `return` thắng cuộc, âm thầm vứt bỏ giá trị 1 đang chờ sẵn.

Thiệt hại thực tế: một hàm _trông như_ trả về giá trị dự định lại trả về thứ khối dọn dẹp quyết định; tệ hơn, `return` trong `finally` **nuốt chửng exception** ném ra trong `try` (cơ chế tương tự cũng áp dụng cho `catch`). Dọn dẹp thuộc về `finally`, nhưng _return_ từ `finally` xứng đáng sự nghi ngờ như một dòng `catch (Exception e) {}` trống trơn.

> 🧪 **Thử nghiệm:** [`FinallyReturnExample.java`](https://github.com/hungpt99-dev/java-lab/blob/lab/jvm/src/main/java/com/example/javalab/jvminternals/FinallyReturnExample.java) cho thấy cả hai kết cục: `return` trong `try` sau một `return` trong `finally` trả về giá trị từ `finally` (kết quả của `try` bị bỏ đi), và một exception ném trong `try` biến mất không dấu vết khi `finally` return — javap cho thấy code của `finally` được nhân bản ra mọi đường thoát.

Mỗi cái bẫy trong bốn cái bẫy này không phải "Java ngu ngốc" — mỗi cái là runtime trung thành thực thi một hợp đồng mà cú pháp nguồn khiến bạn dễ đọc sai (identity được cache, lời gọi phương thức ẩn, các instance chính tắc được intern, cách điều khiển luồng được biên dịch). Đúng như chủ đề của cả bài viết này: code bạn viết là một _bản mô tả_, và cách cỗ máy đọc bản mô tả đó mới là thực tại đang chạy.

## Mô Hình Tinh Thần Thực Sự Giúp Ích Cho Bạn

Java code có vẻ đơn giản, nhưng mỗi lời gọi phương thức, cấp phát đối tượng, tham chiếu và tối ưu hóa đều xảy ra bên trong một hệ thống runtime phức tạp. Hiểu hệ thống đó giúp lập trình viên gỡ lỗi sự cố production, điều tra memory leak, tìm hiểu vấn đề hiệu năng, và viết Java hay hơn.

Mô hình tinh thần, trong một bức ảnh:

```
 Java source của bạn                        Thực tại của JVM
 ────────────────                           ─────────────────
 javac ──► bytecode ──► loader ──► interpreter ──► JIT native code
                            │   v   │           ──────────────
                         frames / TLAB / mark-sweep / inlining /
                         escape analysis / generations / barriers
                                              │
                                        hành vi quan sát được:
                                        kết quả đúng, code nóng dần,
                                        rác được thu hồi
```

Không có gì là phép màu ở đây. Mỗi mảnh là _một quyết định kỹ thuật_ do các compiler và runtime thật đưa ra — và mỗi mảnh đều có thể kiểm tra, đo lường và tinh chỉnh (`javap`, `jcmd`, GC log, heap dump, các flag `-XX` mà bạn hiểu trước khi bật). Khi production phình to, hay một heap dump cho thấy gigabyte của một `HashMap`, hay một benchmark bỗng cấp phát 0 byte, bạn giờ đã biết nên hỏi câu hỏi ở tầng nào.

### Key Takeaways

- Java code được biên dịch thành **bytecode** — một tập lệnh độc lập nền tảng — và JVM dịch thứ đó thành native code trên OS/CPU cụ thể của bạn; đó là lý do Java "chạy ở mọi nơi".
- **Mỗi thread có một stack riêng**; mỗi lần gọi phương thức đẩy một **stack frame** (locals + operand stack + frame data), và return pop nó ra. Đệ quy không giới hạn làm cạn kiệt stack kích thước cố định: `StackOverflowError`.
- "Primitive sống trên stack, đối tượng sống trên heap" là một **mô hình khái niệm, không phải quy luật vật lý** — reference chỉ là handle, và JIT có thể đặt đối tượng vào register, loại bỏ chúng, hoặc giữ chúng hoàn toàn ngoài heap.
- Một biến cục bộ giữ một **reference**; đối tượng sống trong bộ nhớ do GC quản lý, với object header và field offset tính ở runtime.
- **`user = null` không xóa gì cả.** Chỉ GC mới xóa, và chỉ khi đối tượng trở nên **unreachable từ GC Roots** — theo lịch riêng của nó.
- Garbage collection là **tracing**: đánh dấu thứ reachable từ root, thu hồi phần còn lại. Đó là lý do **vòng tham chiếu được thu hồi được**, khác với các hệ reference counting.
- Memory leak trong Java thường nghĩa là chương trình **vô tình giữ các đối tượng reachable** — cache static không eviction, listener không bao giờ gỡ, giá trị `ThreadLocal` trong pool, reference giữ quá lâu.
- `OutOfMemoryError` có nhiều loại — heap, **Metaspace**, **direct buffer**, **native thread** — và cách sửa đúng phụ thuộc vào _loại nào_ trúng; tăng `-Xmx` sửa đúng một loại.
- JIT làm cho ứng dụng chạy lâu ngày càng nhanh: interpretation → profiling → tiered compilation, với sự đánh đổi giữa pause time, throughput và footprint khác nhau ở từng collector (G1, ZGC, Shenandoah).
- Escape analysis có thể **hợp pháp loại bỏ các cấp phát mà ngôn ngữ tưởng như bắt buộc** — nên đừng bao giờ để code phụ thuộc vào việc cấp phát có thật sự xảy ra hay không.

### Các Quan Niệm Sai Phổ Biến

| Quan niệm sai                                        | Thực tế                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Đối tượng luôn luôn đơn giản là "được lưu trên heap" | Mô hình khái niệm hữu ích, nhưng hành vi JVM thật có thể bao gồm các tối ưu hóa |
| `user = null` giải phóng bộ nhớ ngay lập tức         | GC chạy độc lập và về sau                                                       |
| Vòng tham chiếu luôn rò rỉ bộ nhớ                    | Tracing GC có thể thu hồi các vòng unreachable                                  |
| GC ngăn chặn memory leak                             | Các đối tượng reachable-nhưng-không-dùng vẫn có thể rò rỉ                       |
| `OutOfMemoryError` luôn nghĩa là tăng `-Xmx`         | Các vùng bộ nhớ JVM/native khác nhau có thể cạn kiệt                            |
| Tạo đối tượng cục bộ luôn luôn là heap allocation    | JVM tối ưu hóa có thể loại bỏ hoặc biến đổi cấp phát                            |

Lần tới khi bạn viết `User user = new User("Hung")`, hãy nhớ: đó không phải một bước — đó là một cái bắt tay giữa code của bạn, một cỗ máy hư cấu, và một runtime rất thật, rất thông minh đã tối ưu hóa những chương trình như thế này từ năm 1995.
