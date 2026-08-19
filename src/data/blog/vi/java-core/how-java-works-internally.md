---
title: "Java Chạy Như Thế Nào: Từ Mã Nguồn Đến JVM Và Garbage Collector"
description: "Khảo sát cách Java được thực thi: bytecode, class loading, stack frame, cấp phát object, biên dịch JIT và garbage collection."
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

Mã Java nhìn có vẻ rất trực tiếp:

```java
public static void main(String[] args) {
    User user = new User("Hung");
    process(user);
}
```

Source code không chạy trực tiếp trên CPU. Compiler của Java chuyển nó thành bytecode. Sau đó JVM load và kiểm tra các class, thực thi bytecode, rồi có thể biên dịch những đoạn được chạy thường xuyên thành native instruction. Trong quá trình này, JVM quản lý trạng thái method, bộ nhớ object, thread, exception và garbage collection.

Tóm tắt chuỗi này thì dễ, nhưng suy luận chính xác về nó khó hơn. JVM Specification quy định những hành vi có thể quan sát được, không bắt buộc một layout bộ nhớ, garbage collector hay chiến lược JIT cụ thể. Bài viết tách các sự thật ở cấp specification khỏi những hành vi phụ thuộc implementation để mô hình này vẫn hữu ích trên các JDK và JVM khác nhau.

**[SOURCE FACT]** Repository đi kèm [`java-lab`](https://github.com/hungpt99-dev/java-lab/tree/lab/jvm), trên branch `lab/jvm`, là một Maven project không dùng framework với mười sáu experiment nhỏ về bytecode, class loading, stack frame, reference, reachability, escape analysis và boxed type. Các ví dụ này hữu ích để kiểm tra mô hình trên một JVM đang chạy; output của chúng không thay thế cho specification.

## 1. Pipeline Thực Thi

**[SOURCE FACT]** Một lần chạy điển hình có các bước sau:

```text
  .java source
       |
       | javac
       v
  .class file: JVM bytecode và metadata
       |
       | java Main
       v
  JVM: load -> link -> initialize -> execute
       |                         |
       |                         +-> interpreter
       |                         +-> native code do JIT biên dịch
       v
  operating system và CPU
```

`javac` nhắm tới instruction set của JVM, không nhắm tới một CPU cụ thể. File `.class` chứa bytecode và constant pool với các thông tin symbolic mà runtime sử dụng. JVM implementation chịu trách nhiệm thực thi contract đó trên platform hiện tại.

**[ANALYSIS]** “Write once, run anywhere” vì vậy là một ranh giới runtime, không phải lời hứa rằng mọi chương trình sẽ hoạt động giống hệt trong mọi môi trường. Bytecode có thể được dùng lại, còn JVM, operating system, CPU, bộ nhớ khả dụng và cấu hình runtime có thể khác nhau.

## 2. Bytecode Và Constant Pool

**[SOURCE FACT]** JVM bytecode là một instruction set được định nghĩa rõ. Một số instruction thường gặp:

- `new`: tạo object thuộc một class được tham chiếu
- `invokespecial`: gọi constructor hoặc special method khác
- `invokestatic`: gọi static method
- `aload_1`: nạp reference từ local-variable slot số một
- `iadd`: cộng các giá trị integer trên operand stack

Instruction cụ thể của một method phụ thuộc vào source, compiler và class-file version. Có thể xem bytecode của class đã compile bằng:

```bash
javap -c -p Main
```

Với ví dụ trên, điểm quan trọng không phải một chuỗi instruction cố định. Compiler sinh ra các instruction để tạo `User`, lưu reference kết quả vào local slot và truyền reference đó cho `process`.

Constant pool cung cấp các symbolic reference như tên class, tên method và descriptor. Việc resolve các reference đó thuộc quá trình linking và có thể diễn ra khi JVM cần chúng, thay vì tại một thời điểm cố định duy nhất.

**[ANALYSIS]** Bytecode không đơn giản là “machine code chậm”. Nó là một intermediate representation có execution model riêng. Interpreter có thể thực thi trực tiếp, còn JIT compiler có thể dùng dữ liệu từ quá trình chạy để tạo native code được tối ưu sau đó.

## 3. Loading, Linking Và Initialization

**[SOURCE FACT]** Trước khi được sử dụng, một class có thể được JVM load thông qua class loader. Trong một JDK hiện đại điển hình, nhóm built-in loader gồm:

```text
Bootstrap loader    -> core platform classes
       |
Platform loader     -> platform modules
       |
Application loader  -> application class path và modules
```

Bootstrap loader do JVM triển khai, không phải một Java object thông thường. Custom class loader cũng có thể tham gia quá trình này.

Mô hình parent-delegation khá phổ biến: loader hỏi parent trước, sau đó mới tự tìm class. Cách này giúp ngăn application code thay thế các core platform class. Đây là quy ước loading phổ biến, không phải quy tắc mà mọi custom loader bắt buộc phải tuân theo.

Vòng đời thường được mô tả như sau:

1. **Loading:** lấy binary representation và tạo runtime representation của class.
2. **Linking:** verify class, chuẩn bị vùng lưu static và resolve symbolic reference khi cần.
3. **Initialization:** chạy code khởi tạo class khi class được active use lần đầu.

**[SOURCE FACT]** Verification kiểm tra class file có tuân thủ các ràng buộc của JVM hay không. Initialization khác với loading: class có thể đã được load trước khi static initialization chạy.

**[ANALYSIS]** Phân biệt này hữu ích khi chẩn đoán lỗi startup. Không tìm thấy class, method không tương thích và exception phát sinh từ static initializer là các điểm lỗi khác nhau, dù đều có thể xuất hiện lúc ứng dụng khởi động.

## 4. Method Call Và Stack Frame

**[SOURCE FACT]** Mỗi lần gọi method có một JVM frame. Frame chứa local variable, operand stack và các thông tin khác cần cho invocation đó. JVM Specification mô tả cấu trúc logic này; specification không yêu cầu mọi frame phải được biểu diễn bằng một vùng native stack đơn giản.

Với ví dụ trên:

```text
main frame
  args -> reference tới argument array
  user -> reference tới User instance
  operand stack -> giá trị tạm cho các bytecode instruction

process frame
  parameter -> cùng giá trị User reference
```

Truyền `user` cho `process` là truyền một bản sao của reference value. Java luôn pass-by-value. Nếu method mutate `User`, cả hai frame có thể quan sát mutation đó thông qua reference tới cùng object. Nếu gán lại parameter, chỉ local variable trong `process` thay đổi.

```java
static void process(User value) {
    value.setName("Other"); // thay đổi object dùng chung
    value = new User("New"); // chỉ thay đổi local variable này
}
```

**[ANALYSIS]** “Reference” là thuật ngữ đúng ở cấp Java. Không nên coi nó là cam kết portable về raw address, pointer arithmetic hay vị trí object. JVM có thể di chuyển object trong lúc garbage collection mà vẫn giữ các reference hợp lệ.

## 5. Object Allocation

**[SOURCE FACT]** `new User("Hung")` tạo một object và gọi constructor trước khi reference được gán cho `user`. Field của object được khởi tạo theo các quy tắc của Java, sau đó constructor thực hiện phần việc của nó.

JVM Specification không quy định một allocation algorithm duy nhất và cũng không yêu cầu mọi object phải nằm trong một vùng heap toàn cục. JVM production có thể dùng thread-local allocation area, free list, region hoặc kỹ thuật khác. Đây là implementation detail, không phải guarantee của Java language.

**[ANALYSIS]** Vì vậy, cả “allocation luôn đắt” lẫn “allocation luôn rẻ” đều là quy tắc kém chính xác. Chi phí phụ thuộc vào JVM, lifetime của object, contention, kích thước object và việc JIT có thể loại bỏ hoặc thay thế allocation hay không.

## 6. Interpretation Và JIT Compilation

**[SOURCE FACT]** JVM có thể interpret bytecode và compile code được thực thi thường xuyên thành native machine code trong runtime. Compiled code có thể được tối ưu bằng dữ liệu thu thập từ execution thực tế, chẳng hạn type đã quan sát và branch behavior. Chi tiết phụ thuộc vào JVM và runtime options.

Các tối ưu có thể gồm inline method, loại bỏ check được chứng minh là không cần thiết và đơn giản hóa một số công việc liên quan đến object. Code tối ưu vẫn phải giữ đúng behavior mà Java yêu cầu. Nếu assumption bị mất hiệu lực, runtime có thể ngừng dùng compiled version đó và chuyển sang execution path khác.

**[ANALYSIS]** Đây là lý do benchmark ngắn có thể gây hiểu nhầm. Những lần chạy đầu có thể bao gồm class loading, initialization, compilation và các công việc warm-up khác. Kết quả còn phụ thuộc workload, JVM version, flags, hardware và phương pháp đo. Không nên đưa một con số performance vào phần giải thích chung nếu chưa nêu điều kiện đo.

## 7. Reachability Và Garbage Collection

**[SOURCE FACT]** Garbage collection thu hồi những object không còn reachable từ các root do runtime quản lý. Root thường gồm trạng thái của thread đang sống và các reference do runtime quản lý. Object đủ điều kiện để thu hồi khi không còn root path hợp lệ nào trỏ tới nó.

```java
User user = new User("Hung");
user = null;
```

Sau phép gán, object có thể unreachable nếu không còn reference nào khác trỏ tới nó. Nó đủ điều kiện để được thu hồi, nhưng không có nghĩa sẽ được thu hồi ngay. Thời điểm garbage collection không được code Java thông thường kiểm soát một cách trực tiếp.

Các collector khác nhau về cách xác định object reachable, tổ chức bộ nhớ, pause application thread và thực hiện công việc concurrent. Một số collector có thể di chuyển object. Vì vậy application nên dựa vào reachability và quy tắc managed lifetime, không dựa vào địa chỉ object hay thời điểm collection dự kiến.

`System.gc()` chỉ là request gửi tới runtime, không phải cách đáng tin cậy để ép collection. Không nên dùng finalization để quản lý resource. File, socket và resource bên ngoài khác cần lifecycle tường minh, chẳng hạn `try`-with-resources.

## 8. Escape Analysis Và Boxed Value

**[SOURCE FACT]** JIT compiler có thể thực hiện escape analysis: xác định object có visible bên ngoài method hoặc thread hay không. Nếu runtime chứng minh được allocation không cần object identity hoặc heap visibility, nó có thể thay thế hoặc loại bỏ một phần allocation. Đây là cơ hội tối ưu, không phải guarantee mà Java language cung cấp.

Boxing tạo thêm một lớp cần chú ý. `Integer` là object, còn `int` là primitive value. So sánh boxed value bằng `==` sẽ so sánh reference, không phải giá trị số:

```java
Integer a = Integer.valueOf(args.length);
Integer b = Integer.valueOf(args.length);

boolean sameValue = a.equals(b);
boolean sameReference = a == b;
```

So sánh đầu diễn đạt value equality. So sánh sau diễn đạt reference identity và không nên dùng để so sánh boxed number. Unboxing cũng có thể ném exception nếu reference là `null`.

## 9. Mental Model Thực Dụng

Hãy dùng mô hình sau khi đọc về performance hoặc runtime behavior của Java:

1. Source code được compile thành class file chứa JVM bytecode.
2. Class loader lấy class; linking verify và prepare class; initialization chạy khi cần.
3. Method invocation tạo logical frame với local variable và operand stack.
4. Variable chứa primitive value hoặc reference value. Reference không phải raw address portable.
5. JVM có thể interpret bytecode hoặc compile hot code thành native instruction.
6. Object còn sống khi reachable. Collection là nondeterministic và phụ thuộc implementation.
7. Allocation và optimization phải được đo trên JVM và workload mục tiêu.

**[PROPOSED DESIGN]** Khi điều tra một ứng dụng thực tế, hãy bắt đầu bằng bằng chứng quan sát được: reproducer tối thiểu, JDK và JVM version, runtime flags, workload đại diện và profiler hoặc flight recording. Coi heap layout, JIT decision, collector behavior và timing là hypothesis cần kiểm chứng, không phải assumption để đưa cứng vào application code.

JVM không phải một pipeline duy nhất với implementation cố định. Đây là runtime dựa trên specification, có thể thay đổi chiến lược nội bộ nhưng vẫn phải giữ behavior mà Java program được phép quan sát. Ranh giới đó là nền tảng để hiểu cả tính portable lẫn đặc tính performance của Java.
