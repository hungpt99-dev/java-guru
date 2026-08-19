---
title: "Ôn phỏng vấn Java #1: Java Core và Concurrency"
description: "Tài liệu thực tế để ôn phỏng vấn Java Core, gồm bộ nhớ JVM, garbage collection, Java Memory Model và concurrency, từ nền tảng đến các trade-off trong production."
pubDatetime: 2026-08-10T10:00:00+07:00
featured: true
draft: false
tags:
  - java
  - interview
  - java-core
  - concurrency
---

Phỏng vấn Java Core khó vì biết thuật ngữ là chưa đủ. Bạn cần giải thích runtime đảm bảo điều gì, abstraction (lớp trừu tượng) lộ ra ở đâu, và sẽ điều tra một lỗi như thế nào. Bài viết bắt đầu với nền tảng về JVM và ngôn ngữ, sau đó chuyển sang các trade-off của garbage collection. Các câu hỏi được nhóm theo mức độ; hãy ôn phần phù hợp với buổi phỏng vấn, rồi đọc thêm một phần kế tiếp.

Điểm khác biệt nằm ở cách trả lời: junior định nghĩa được một collector, còn senior liên hệ được hành vi của collector với allocation rate, object lifetime, pause time và bằng chứng cần thu thập trước khi đổi cấu hình.

## Junior: Nền tảng

**Q1. Các vùng nhớ chính của JVM là gì?**

[SOURCE FACT] JVM specification mô tả **heap** để chứa các object instance, **method area metadata** (trong HotSpot được hiện thực bằng metaspace, thay thế PermGen), **stack** cho từng thread, **PC register** cho từng thread và **native method stack**. Stack frame chứa các dữ liệu như local variable và operand stack. Trong mô hình lập trình Java thông thường, object tạo bằng `new` được cấp phát trên heap, còn mỗi lần gọi method sẽ tạo một frame trên stack của thread gọi. Layout bộ nhớ cụ thể phụ thuộc vào implementation.

**Q2. `==` và `equals()` khác nhau như thế nào?**

Với object reference, `==` kiểm tra identity: hai reference có trỏ đến cùng một object hay không. `equals()` dùng để kiểm tra logical equality, nhưng hành vi cụ thể phụ thuộc vào class. Một kiểu giá trị override `equals()` cũng phải override `hashCode()` cho nhất quán. Hai string trông giống nhau chưa chắc là cùng một object; string literal và string được tạo riêng là hai object khác nhau:

```java
String a = "java";
String b = new String("java");
System.out.println(a == b);      // false: hai object khác nhau
System.out.println(a.equals(b)); // true: cùng các ký tự
```

**Q3. Primitive type là gì, và chúng có phải object không?**

Java có tám primitive type: `byte`, `short`, `int`, `long`, `float`, `double`, `char` và `boolean`. Primitive value không phải object. Biến có reference type trỏ đến một object, thường được quản lý trên heap. Autoboxing chuyển đổi giữa primitive và wrapper tương ứng, chẳng hạn `int` và `Integer`.

Wrapper cache là implementation detail, ngoại trừ những hành vi được Java specification yêu cầu. Với `Integer`, các giá trị từ `-128` đến `127` được `valueOf` cache, nên so sánh identity có thể có vẻ đúng trong khoảng này. Không dùng `==` để so sánh wrapper value:

```java
Integer a = Integer.valueOf(42);
Integer b = Integer.valueOf(42);
System.out.println(a == b); // true trong khoảng cache bắt buộc

Integer c = Integer.valueOf(200);
Integer d = Integer.valueOf(200);
System.out.println(c == d); // không được dựa vào việc kết quả là true
```

**Q4. `String`, `StringBuilder` và `StringBuffer` khác nhau như thế nào?**

`String` là immutable. Thao tác tưởng như sửa string thực chất tạo ra một string khác. `StringBuilder` mutable và không thread-safe, nên là lựa chọn thông thường khi ghép text trong một thread. `StringBuffer` cung cấp các method có `synchronized` và thường không cần dùng, trừ khi cần đúng contract đồng bộ đó.

Nối `String` lặp đi lặp lại trong loop có thể tạo nhiều object trung gian. Dùng `StringBuilder` khi việc xây dựng text diễn ra từng bước và allocation hoặc hiệu năng là vấn đề.

**Q5. `final`, `finally` và `finalize()` có nghĩa là gì?**

`final` ngăn việc gán lại variable, override method hoặc subclass một class, tùy vị trí áp dụng. `finally` là block điều khiển luồng thường chạy sau `try` và `catch` phù hợp, kể cả khi có exception. Nó không thay thế cho cơ chế quản lý resource có cấu trúc.

`finalize()` là cleanup hook đã deprecated và không đáng tin cậy; runtime không đảm bảo sẽ gọi nó đúng lúc. Không dùng nó để quản lý resource. Ưu tiên `try-with-resources`; `Cleaner` chỉ nên là fallback cho một số trường hợp cleanup hạn chế, không phải cơ chế sở hữu resource có tính quyết định.

**Q6. Checked và unchecked exception khác nhau như thế nào?**

Checked exception phải được catch hoặc declare. Unchecked throwable gồm `RuntimeException` và `Error`, không có yêu cầu compile-time đó. Phân biệt này không đơn giản chỉ là "có thể khôi phục" và "không thể khôi phục": API nên buộc caller xử lý khi recovery là một phần của contract, và không nên ép xử lý nếu việc đó không tạo ra response có ý nghĩa. Programming error thường được biểu diễn bằng unchecked exception.

**Q7. Autoboxing là gì, và nó có bẫy nào?**

Autoboxing chuyển primitive thành wrapper tương ứng, chẳng hạn `int` thành `Integer`; unboxing làm chiều ngược lại. Wrapper là object và có thể là `null`, vì vậy thao tác unboxing ngầm có thể ném `NullPointerException`:

```java
Integer i = null;
int x = i; // NullPointerException trong lúc unbox
```

Vấn đề tương tự có thể xuất hiện trong phép tính, phép so sánh hoặc lời gọi method khi compiler chèn thao tác unbox. Hãy xử lý rõ giá trị có thể `null` tại ranh giới API.

**Q8. `int` và `Integer` khác nhau thế nào khi dùng trong collection?**

Java collection lưu reference, không lưu primitive value. Vì vậy `List<Integer>` phải box từng giá trị, tạo thêm overhead của object và reference, đồng thời có thể làm tăng công việc cho GC. Chi phí phụ thuộc JVM, object layout, implementation của collection và việc tái sử dụng value; không nên quy về một con số byte cố định. Khi memory hoặc throughput quan trọng, hãy cân nhắc `int[]` hoặc collection hướng tới primitive thay vì giả định boxing là miễn phí.

**Q9. `switch` trên `String` hoạt động như thế nào?**

Với `switch` trên `String`, compiler sinh code dùng hash value của string và các phép kiểm tra equality để chọn nhánh. Dạng code được sinh là implementation detail và có thể thay đổi, nên source-level guarantee chỉ là hành vi của switch, không phải một data structure hay chi phí constant-time cụ thể. `String.hashCode()` và `equals()` vẫn có ý nghĩa, nhất là với switch lớn hoặc được đánh giá thường xuyên. Chọn `enum` hoặc representation phù hợp với domain khi nó diễn đạt domain tốt hơn, không phải vì một so sánh nanosecond không có nguồn.

**Q10. `static` initializer là gì và chạy khi nào?**

Block `static {}` chạy trong quá trình class initialization, nhiều nhất một lần cho mỗi class loader, trước khi class được actively used. Class loading và class initialization là hai khái niệm khác nhau; việc load class không có nghĩa mọi static initializer đã chạy. Failure trong quá trình initialization có thể khiến class không thể được dùng ở các lần sau và xuất hiện dưới dạng `ExceptionInInitializerError` hoặc lỗi initialization liên quan. Giữ static initialization nhỏ và có hành vi xác định.

**Q11. `this` và `super` khác nhau như thế nào?**

`this` trỏ đến object hiện tại. `super` chọn member từ superclass, hữu ích khi subclass override một method nhưng vẫn cần implementation của parent. `super()` gọi constructor của superclass và, nếu viết tường minh, phải là câu lệnh đầu tiên trong constructor. Nếu không viết lời gọi constructor, Java sẽ chèn lời gọi đến constructor không tham số có thể truy cập của superclass, nếu constructor đó tồn tại.

**Q12. Method overloading được phân giải như thế nào?**

Overloading được compiler phân giải dựa trên declared type tại call site. Compiler chọn overload cụ thể nhất trong các overload áp dụng được; runtime type không thay đổi lựa chọn đó. Ví dụ, nếu có `log(Object)` và `log(String)`, `log(null)` chọn `log(String)`. Nếu các candidate không có quan hệ cụ thể hóa, lời gọi sẽ ambiguous ở compile time.

**Q13. Field chưa khởi tạo có giá trị mặc định gì, và khác local variable ra sao?**

Field nhận giá trị mặc định theo type như `0`, `false` và `null` trước khi được khởi tạo tường minh. Local variable không nhận một giá trị mặc định mà compiler cho phép đọc; cơ chế definite-assignment yêu cầu variable có giá trị trước khi đọc. Vì vậy đoạn sau không compile:

```java
int x;
System.out.println(x);
```

**Q14. `>>` và `>>>` khác nhau như thế nào?**

`>>` là arithmetic right shift: giữ lại sign bit. `>>>` là logical right shift: điền zero từ bên trái. Ví dụ, `-8 >> 1` bằng `-4`, còn `-8 >>> 1` tạo ra một `int` dương lớn vì sign bit bị xóa. Dùng `>>>` khi coi value là một unsigned bit pattern.

**Q15. `Math.round()`, `ceil()` và `floor()` khác nhau như thế nào?**

`Math.round()` trả về kết quả nguyên gần nhất theo quy tắc xử lý tie được quy định. `Math.ceil()` trả về `double` nhỏ nhất lớn hơn hoặc bằng argument, còn `Math.floor()` trả về `double` lớn nhất nhỏ hơn hoặc bằng argument. Giá trị âm là bẫy thường gặp: `Math.round(-2.5)` trả về `-2`, theo hướng dương chứ không phải xa số 0.

## Mid: Trade-off và điểm cần lưu ý

**Q1. Generational garbage collection hoạt động ra sao, và production có thể gặp vấn đề gì?**

[SOURCE FACT] Generational collector phân loại object theo tuổi. Trong mô hình truyền thống, young generation gồm Eden và các Survivor space, còn object sống lâu hơn được promote sang old generation. Một chu kỳ young collection thu hồi object không còn reachable trong young generation và có thể copy hoặc promote các object còn sống. Việc collection các region cũ có thể cần nhiều công việc hơn và góp phần tạo pause dài hơn, tùy collector và cấu hình.

[ANALYSIS] Đây là mô hình để bắt đầu phân tích, không phải chẩn đoán production. Allocation rate, object lifetime, live-set size, reference pattern, collector, heap sizing và hành vi ứng dụng đều ảnh hưởng đến pause time và throughput. Service có thể gặp allocation burst, promotion pressure, live set lớn hoặc memory leak thực sự. Trước khi đổi GC flag, hãy xem GC log và đối chiếu pause với allocation, heap occupancy, CPU, request latency và event của ứng dụng. Mọi tuyên bố về việc giảm pause ở một mức cụ thể hoặc với một heap size cụ thể phải thuộc về một case study đã đo, không nên trình bày như kết quả tổng quát.
