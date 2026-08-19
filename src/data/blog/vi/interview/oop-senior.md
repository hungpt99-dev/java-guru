---
title: "Ôn thi Java #2: OOP & Nguyên lý Thiết kế — Junior đến Senior"
description: "OOP ở cấp độ senior là biết áp dụng SOLID, ưu tiên composition thay vì inheritance và thiết kế interface ở quy mô lớn — không phải học thuộc các định nghĩa. 50 câu hỏi phỏng vấn, từ bốn trụ cột đến 'đây là refactor đã giúp chúng tôi tránh phải thay đổi 12 class'."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

OOP là phần phỏng vấn mà interviewer ngừng hỏi "cái gì" và bắt đầu hỏi "tại sao". Ai cũng có thể gọi tên bốn trụ cột; một senior có thể chỉ ra đoạn code nơi inheritance gây rắc rối và bản refactor đã sửa nó. Bài viết này đi từ kiến thức trong sách giáo khoa đến bảng trade-off — 50 câu hỏi kèm các ví dụ có thể biên dịch.

> Tư duy: junior triển khai interface; senior quyết định liệu interface đó có nên tồn tại hay không và nó sẽ khiến codebase phải trả giá thế nào trong năm năm tiếp theo.

## Junior — nền tảng

**Q1. Bốn trụ cột của OOP?**
Encapsulation (che giấu state phía sau behavior), Abstraction (bộc lộ ý định thay vì cơ chế), Inheritance (tái sử dụng thông qua chuyên biệt hóa), Polymorphism (một interface, nhiều implementation). Gọi tên chúng chẳng tốn gì; kỹ năng nằm ở việc áp dụng chúng mà không tạo ra một hierarchy mong manh.

**Q2. Abstract class vs interface?**
Abstract class có thể giữ state và triển khai method; một class chỉ có thể kế thừa một class khác. Interface là một hợp đồng — trước Java 8 chỉ chứa các signature, còn nay có thể có method `default`/`static` nhưng không có instance field. Ưu tiên interface để biểu diễn _type_, và chỉ dùng abstract class cho state hoặc behavior dùng chung.

```java
// WRONG: ép một trục inheritance cho thứ thực là một role
abstract class Worker { abstract void doWork(); }
class Programmer extends Worker { void doWork() { /* ... */ } }
// không thể vừa là Reviewer không có trục khác
// RIGHT: role là interface, compose tự do
interface Worker { void doWork(); }
interface Reviewer { void review(Change c); }
class Programmer implements Worker, Reviewer { /* cả hai */ }
```

**Q3. Polymorphism là gì và hoạt động ra sao?**
Subtype polymorphism nghĩa là một biến supertype có thể tham chiếu đến bất kỳ subtype nào, còn JVM sẽ dispatch method bị override tại runtime. Overloading _không_ phải là polymorphism; nó được quyết định tại compile time dựa trên signature.

```java
Animal a = new Dog();   // compile type Animal, runtime Dog
a.speak();              // gọi Dog.speak() — virtual dispatch
```

**Q4. Overriding vs overloading?**
Overriding là dùng cùng signature ở subclass và được dispatch tại runtime. Overloading là dùng cùng tên với các kiểu tham số khác nhau và được quyết định tại compile time. Overload mơ hồ sẽ khiến code không biên dịch được:

```java
void log(Object o) { }
void log(String s) { }
log(null);   // compile ERROR: ambiguous giữa Object và String
```

**Q5. Hợp đồng `equals`/`hashCode` đòi gì?**
Nếu `a.equals(b)` thì `a.hashCode() == b.hashCode()`. Phải override cả hai, nếu không map sẽ hoạt động sai:

```java
class User { String id; public boolean equals(Object o){...} }  // không hashCode
Map<User,String> m = new HashMap<>();
m.put(new User("42"), "x");
m.get(new User("42"));   // trả null — bucket khác!
// RIGHT: cả hai override, consistent
```

**Q6. `abstract` vs `default` method của interface?**
Method của abstract class có phần thân mà subclass có thể override. Method `default` của interface cung cấp behavior để class kế thừa mà không cần triển khai — được dùng để tiến hóa API mà vẫn tương thích ngược. Override method `default` nếu muốn thay đổi behavior đó.

**Q7. Constructor có thể override hay overload?**
Constructor có thể overload (nhiều constructor với các tham số khác nhau), nhưng không thể override (constructor không được kế thừa mà thuộc riêng về từng class). Constructor của subclass phải gọi constructor của parent (`super(...)`) bằng câu lệnh đầu tiên.

**Q8. `super` dùng gì trong constructor?**
Để gọi constructor hoặc method của parent. Quên `super()` khi parent không có no-argument constructor sẽ khiến code không biên dịch được — đây là lỗi thường gặp với các parent kiểu `SQLException(String)`.

**Q9. Method hiding vs overriding?**
Method `static` ở subclass có cùng signature với method `static` của parent sẽ _hide_ method đó (được quyết định bởi reference type tại compile time), khác với instance method overriding (được dispatch tại runtime theo object type). Đây là một bẫy phỏng vấn thường gặp:

```java
Parent p = new Child(); p.staticMethod(); // gọi Parent.staticMethod (hiding)
```

**Q10. Khác nhau object reference và primitive?**
Reference trỏ đến một heap object (~4–8 bytes); primitive giữ trực tiếp giá trị (4 bytes với `int`). Truyền primitive sẽ sao chép giá trị; truyền object reference sẽ sao chép pointer, nên cả hai cùng trỏ đến một object. Mutate object thông qua reference sẽ làm thay đổi object dùng chung.

**Q11. `record` (Java 16+) là gì và khi dùng?**
Record là một immutable data carrier với `equals`/`hashCode`/`toString` và accessor được tự động sinh ra. Dùng record cho DTO và value object. Đừng dùng cho mutable state hoặc inheritance. `record Point(int x, int y)` gọn hơn nhiều so với một class 40 dòng viết thủ công.

**Q12. Khác nhau `null` và empty object?**
`null` nghĩa là "không có object" — dereference nó sẽ ném `NullPointerException`. Empty object (ví dụ `List.of()`, `""`) là một object hợp lệ nhưng không có nội dung. Ưu tiên trả về empty collection thay vì `null` để tránh NPE (idiom Null Object / empty collection).

**Q13. `static` method — có access instance field không?**
Method `static` thuộc về class, không thuộc về instance; nó không thể truy cập instance field (non-static) hoặc gọi trực tiếp instance method vì không có `this`. Nó chỉ có thể dùng các `static` member khác hoặc các parameter của mình.

**Q14. Khác nhau `String.length()` và array `.length`?**
`String.length()` là method (trả về số lượng `char`, trong đó một `char` là một UTF-16 code unit — vì vậy string có supplementary character có thể cho số lượng lớn hơn grapheme count). `array.length` là một `final` field. Một nhầm lẫn kinh điển: `str.length()` là một lời gọi, còn `arr.length` thì không.

**Q15. Upcasting và downcasting?**
Upcasting (`Animal a = new Dog()`) là implicit và luôn an toàn. Downcasting (`Dog d = (Dog) a`) là explicit và sẽ ném `ClassCastException` tại runtime nếu `a` thực sự không phải là `Dog`. Hãy dùng `instanceof` trước khi downcast.

## Mid — trade-off và cạm bẫy

**Q1. Khi nào inheritance là công cụ sai?**
Khi quan hệ không thực sự là "is-a" với behavior dùng chung ổn định. Inheritance gắn chặt subclass với implementation của parent mãi mãi — đây là vấn đề "fragile base class". Hãy ưu tiên **composition**:

```java
// WRONG: ReportGenerator không thực sự là ExcelWriter; coupling + untestable
class ReportGenerator extends ExcelWriter { void generate() { /* tangled */ } }
// RIGHT: giữ một Writer, delegate; inject FakeWriter trong test
class ReportGenerator {
  private final Writer writer;
  ReportGenerator(Writer writer) { this.writer = writer; }
  void generate() { writer.write(render()); }
}
```

**Q2. Giải thích ngắn gọn SOLID, kèm một ví dụ misuse thực tế cho từng nguyên tắc.**

- **S**: `UserService` vừa gửi email vừa ghi audit log nên thay đổi vì 3 lý do. Hãy tách chúng ra.
- **O**: `switch(type)` bạn sửa mỗi khi có type mới — thay bằng polymorphism.
- **L**: `Square extends Rectangle` nơi `setWidth` phá invariant của rectangle.
- **I**: interface `Worker` ép `cleanToilet()` lên `Programmer` — tách nó.
- **D**: hardcode `new MySQLRepository()` — thay vào đó, hãy phụ thuộc vào `Repository` (interface).

**Q3. `Comparator` vs `Comparable`?**
`Comparable` định nghĩa thứ tự tự nhiên (`compareTo`); `Comparator` là strategy bên ngoài và có thể có nhiều strategy. Dùng `Comparable` cho thứ tự mặc định, còn `Comparator` cho việc sort tùy theo ngữ cảnh:

```java
List<User> byName = users.stream().sorted(Comparator.comparing(User::name)).toList();
```

**Q4. Tại sao getter/setter không phải encapsulation thật?**
Cặp getter/setter public không bảo vệ invariant thực chất chỉ là public field với thêm một bước. Encapsulation đúng nghĩa phải bộc lộ behavior:

```java
class Account { public BigDecimal balance; }          // WRONG: không guard invariant
account.balance = account.balance.subtract(fee);        // có thể âm!
class Account {                                          // RIGHT
  private BigDecimal balance;
  void withdraw(BigDecimal amt) {
    if (amt.signum() <= 0 || amt.compareTo(balance) > 0) throw new IllegalArgumentException();
    balance = balance.subtract(amt);
  }
}
```

**Q5. `==` trên boxed type — bug tiềm ẩn?**
`Integer.valueOf(42) == Integer.valueOf(42)` là `true` (được cache từ -128 đến 127), nhưng `Integer.valueOf(200) == Integer.valueOf(200)` là `false`. Với wrapper, luôn dùng `equals`.

**Q6. Khi nào dùng `record` — và giới hạn?**
Dùng cho immutable data carrier, với `equals`/`hashCode`/`toString` được tự động sinh ra. Giới hạn: không có inheritance (record không thể extend một class khác), mọi field đều final và chỉ có canonical constructor (bạn vẫn có thể thêm static constructor hoặc non-canonical constructor). Đừng dùng khi cần mutable state hoặc mutable collection field; reference là final nhưng collection thì không.

**Q7. Khác nhau `equals` và `==` cho `record`?**
Record sinh `equals` dựa trên mọi component, nên hai record có các component bằng nhau sẽ bằng nhau theo `equals`; `==` vẫn so sánh identity. `var r1 = new Point(1,2); var r2 = new Point(1,2); r1.equals(r2)` là `true`, còn `r1 == r2` là `false`.

**Q8. Khác nhau `final` class và `final` method — và tại sao JVM quan tâm?**
`final` class không thể được subclass; `final` method không thể được override. JIT dùng điều này cho devirtualization — nó có thể inline call trực tiếp vì biết chỉ có một implementation, loại bỏ vtable lookup (tiết kiệm khoảng vài nanosecond mỗi call và hiệu quả cộng dồn trong hot loop).

**Q9. Template Method pattern và pitfall?**
Base class định nghĩa một `final` skeleton gọi các abstract step do subclass cung cấp:

```java
abstract class Report {
  final void produce() { fetch(); render(); save(); }   // skeleton
  abstract void render();
}
```

Pitfall: flow `produce()` của base bị khóa; subclass không thể sắp xếp lại các step, và thay đổi skeleton sẽ lan sang tất cả subclass (lại là vấn đề fragile base class).

**Q10. Strategy pattern và khi nào hơn if/else?**
Đóng gói algorithm biến thiên phía sau một interface và thay đổi implementation tại runtime. Dùng nó thay cho `switch` trên type mà bạn phải liên tục chỉnh sửa:

```java
interface Discount { BigDecimal apply(Order o); }
class VipDiscount implements Discount { /* 20% off */ }
class SeasonalDiscount implements Discount { /* 10% off */ }
// thêm discount = class mới, không sửa caller
```

**Q11. Khác nhau interface và abstract class cho shared behavior?**
Interface: không có state, có thể có nhiều implementation, và có `default` method cho behavior tùy chọn. Abstract class: có shared state và partial implementation, nhưng chỉ được single inheritance. Nếu cần shared _field_ (ví dụ `id`, `auditStamp`) thì dùng abstract class; nếu chỉ cần _contract_ thì dùng interface.

**Q12. `Optional` và misuse?**
`Optional<T>` báo hiệu rằng giá trị trả về "có thể không tồn tại", thay cho `null`. Misuse gồm dùng nó làm field hoặc parameter type (hãy dùng `null` hoặc một object thực sự) hay gọi `get()` mà không kiểm tra `isPresent()` (sẽ ném `NoSuchElementException` — hãy dùng `orElse`/`orElseThrow`).

**Q13. Khác nhau `Integer.parseInt` và `Integer.valueOf`?**
`parseInt` trả về primitive `int`; `valueOf` trả về `Integer` (được cache từ -128 đến 127). Dùng `parseInt` khi cần primitive, còn `valueOf` khi cần object. Trộn lẫn hai cách này có thể dẫn đến các bẫy boxing/`==` nói trên.

**Q14. `static` initializer block vs instance initializer?**
`static {}` chạy một lần khi class được load; `{}` (instance initializer) chạy mỗi lần `new`, trước phần thân constructor. Nó hữu ích cho logic khởi tạo dùng chung giữa nhiều constructor, nhưng hiếm khi cần — constructor hoặc factory thường rõ ràng hơn.

**Q15. Covariance/contravariance của return/param type trong overriding?**
Java cho phép covariant return type: overriding method có thể trả về subtype của kiểu trả về từ parent. Parameter _không_ covariant — method có parameter là subclass sẽ là overload, không phải override, và không được dispatch theo cơ chế virtual. Đây là nguyên nhân của bug quen thuộc: "tại sao override của tôi không được gọi?".

**Q16. Khác nhau `clone()` và copy constructor?**
`Object.clone()` là shallow copy (còn `Cloneable` là một marker interface thiết kế không tốt và có thể dẫn đến checked exception). Copy constructor (`new User(other)`) rõ ràng, có thể tạo deep copy nếu được thiết kế như vậy và type-safe. Ưu tiên copy constructor hoặc static factory hơn `clone()`.

**Q17. Chi phí của việc phân tầng quá mức (anemic class) là gì?**
Mỗi wrapper class thêm một vtable hop và indirection; architecture `XController → XService → XManager → XRepository → XEntity` không có logic ở các middle layer chỉ là overhead (nhiều file hơn, test surface lớn hơn và diff lớn hơn cho cùng một thay đổi). Hãy gộp các layer chỉ làm nhiệm vụ delegate.

## Senior — thiết kế và bảo vệ quyết định

**Q1. Phòng thủ composition over inheritance bằng refactor cụ thể.**
"Tôi sẽ chuyển `ReportGenerator extends ExcelWriter` thành thiết kế ngược lại: `ReportGenerator` giữ một interface `Writer` và delegate cho nó. Lý do là coupling với Excel khiến mọi thay đổi về formatting đều có thể ảnh hưởng đến logic report, đồng thời chúng ta không thể unit-test report nếu không có spreadsheet thật. Composition cho phép inject `FakeWriter` và thêm `PdfWriter` mà không cần sửa `ReportGenerator`. Cái giá: một interface và một constructor argument — khoản bảo hiểm rẻ để tránh fragile base class. Kết quả đo được: test setup chuyển từ 'spin up workbook' thành 'pass một stub'."

**Q2. Team muốn `BaseEntity` 30 field, mọi JPA entity extend. Bạn nói sao?**
"Tôi sẽ tách nó ra. Một `BaseEntity` đúng nghĩa (id, version, createdAt, updatedAt, auditing) có quan hệ 'is-a' và state dùng chung ổn định. 26 field còn lại chỉ là một mớ hỗn tạp — subtype kế thừa các column không dùng, query rộng hơn và thay đổi lan ra khắp nơi. Tôi sẽ đưa 26 field đó xuống các entity thực sự sở hữu chúng. Kết quả đo được: table hẹp hơn (~30% ít bytes/row hơn trên hot table), ownership rõ ràng hơn."

**Q3. Thiết kế interface sống sót 5 năm yêu cầu mới.**
"Tôi giữ nó nhỏ và tập trung vào behavior. Với một tập subtype đóng, tôi dùng `sealed` (Java 17+) để compiler buộc phải xử lý mọi case — thêm một subtype sẽ gây compile error cho đến khi bạn xử lý nó ở mọi nơi cần thiết:"

```java
sealed interface PaymentMethod permits Card, BankTransfer, Wallet { }
// thêm 'Crypto' break mọi switch(PaymentMethod) đến khi handled — evolution an toàn
```

"Tôi bộc lộ các capability hẹp (`Readable`, `Flushable`) thay vì một `MegaService`, và chỉ dùng `default` cho behavior thực sự tùy chọn."

**Q4. Liskov Substitution — một violation thực tế và cách sửa.**
"`Square extends Rectangle`: set width cũng phải set height để giữ hình vuông, nhưng điều đó phá vỡ hợp đồng của `Rectangle` rằng width và height độc lập. Code `r.setWidth(5); r.setHeight(10); assert r.area()==50` sẽ không còn đúng. Cách sửa: đừng model square là subtype của rectangle — hãy trích xuất `Shape` với `area()` và triển khai cả hai một cách độc lập. Subtyping là một lời hứa; nếu không giữ được thì đừng đưa ra lời hứa đó."

**Q5. Interface 12 method nhưng caller dùng 2. Thiết kế lại?**
"Đây là vi phạm Interface Segregation. Tách thành `Reader`, `Writer` và `Lifecycle`; class cụ thể có thể implement cả ba nếu cần, nhưng read-only consumer chỉ phụ thuộc vào `Reader`, nên thay đổi ở `Writer` sẽ không buộc nó recompile. Behavior của class implement không đổi; chỉ các _type_ mà nó được expose qua trở nên hẹp hơn. Bonus: mock trong test sẽ là `when(reader.read()).thenReturn(...)` thay vì phải stub 12 method."

**Q6. Làm sao chứng minh OOD tốt, không chỉ 'sạch'?**
"Tôi chỉ ra thay đổi vừa thực hiện và cái giá của phương án thay thế: đếm số lý do khiến mỗi class phải thay đổi, số call site bị hỏng khi requirement thay đổi và test surface. OOD tốt nghĩa là một feature mới chỉ chạm vào một class, không phải mười hai. Tôi phác thảo dependency graph — một DAG với abstraction ổn định ở trên và detail dễ thay đổi ở dưới (dependency inversion) — rồi nói: 'Đây là diff khi requirement thay đổi, và nó nhỏ.' Không nói 'tôi đã dùng SOLID'; tôi đưa ra một con số: 1 class thay đổi so với 12."

**Q7. `record` trong public API — versioning concern?**
"Record gắn component list với hợp đồng `equals`/`hashCode`, nên thêm một component là breaking change đối với equality và serialization. Với API ổn định, tôi giữ record ở internal (map DTO tại boundary) hoặc chấp nhận rằng component list chính là contract. Tôi version API một cách rõ ràng thay vì giả định rằng việc thêm field luôn an toàn."

**Q8. Khi nào dùng `sealed` hierarchy vs `enum`?**
"Dùng enum khi tập giá trị cố định và không có per-instance state ngoài một vài constant; dùng `sealed` khi mỗi subtype cần data và behavior riêng nhưng tập đó vẫn đóng (compiler-enforced exhaustiveness). Với payment pipeline nơi mỗi method mang các field khác nhau, `sealed` phù hợp hơn một enum-with-fields khổng lồ. Nếu chỉ là 'status = A|B|C', enum đơn giản hơn."

**Q9. Thiết kế plugin system không `instanceof` chain.**
"Định nghĩa interface `Plugin` với `handle(Event)` và một capability marker; register các plugin trong `List` rồi dispatch bằng predicate thay vì `if (p instanceof X)`. Pattern `Visitor` là một typed alternative — acceptor callback vào visitor, giữ dispatch ở một chỗ và để compiler kiểm tra coverage cho sealed hierarchy."

**Q10. Giữ domain model free of framework annotation thế nào?**
"Đặt annotation JPA/Jackson/`@Valid` trên các DTO _persistence_ hoặc _API_, không đặt trên domain type `Order`/`Account`. Map giữa chúng tại boundary. Lợi ích: domain compile và unit-test mà không cần import Spring/Jakarta nào (~30% nhanh hơn khi test startup, không cần container), đồng thời thay đổi version của framework không ảnh hưởng business logic. Quy tắc: `com.finpay.order.domain` không có import `jakarta.*`."

**Q11. Base class method làm quá nhiều (400 dòng). Refactor an toàn.**
"Tôi extract method-object cho từng bước có tính kết dính, rồi đưa invariant skeleton vào một `final` template method và các step vào các method `abstract`/`default`, hoặc thay hierarchy bằng composition của các strategy object. Tôi thực hiện phía sau test: đầu tiên ghi nhận current behavior bằng golden-output test, sau đó extract và xác minh output giống hệt ở cấp byte. Method 400 dòng là bug magnet; refactor này đáng làm vì nó thu hẹp test surface cần duy trì."

**Q12. Phòng thủ dependency inversion với seam cụ thể.**
"High-level `Checkout` không nên import `StripeClient` (detail). Nó phụ thuộc vào `PaymentGateway` (abstraction); implementation của Stripe nằm ở edge và được inject vào. Khi đó `Checkout` có thể test với `FakeGateway` (không network, ~0 ms) và chuyển sang `PaypalGateway` mà không cần chạm vào `Checkout`. Kết quả đo được: unit test cho `Checkout` chạy trong ~50 ms thay vì cần payment sandbox. Seam chính là lợi ích."

**Q13. Khi nào immutability đáng allocation cost?**
"Với value được truyền qua các thread hoặc lưu trong cache, immutability loại bỏ cả một nhóm bug do shared mutation và cho phép bỏ qua defensive copy (tiết kiệm khoảng 16 bytes cùng chi phí GC cho mỗi copy). Allocation cost (~10 ns) không đáng kể so với bug cost. Với temporary trong hot inner loop được mutate tại chỗ, mutable object vẫn phù hợp. Mặc định, tôi dùng immutable cho mọi thứ rời khỏi method boundary."

**Q14. Chọn giữa inheritance và delegation cho cross-cutting behavior (logging, metrics)?**
"Không bao giờ dùng inheritance cho cross-cutting concern — đó là việc của aspect hoặc decorator. Một `MetricsDecorator` bọc `Repository` có thể thêm timing mà repository không cần biết, và bạn có thể compose nhiều decorator (logging → metrics → cache) mà không tạo deep hierarchy. Inheritance sẽ buộc mọi class extend `LoggedThing`, vốn không compose được. Decorator = O(n) wrapper cho n concern; inheritance = O(2^n) theo cấp số nhân."

**Q15. Cost của over-abstracting (speculative generality)?**
"Một abstraction chỉ có một implementation là dead weight: nó đặt tên cho một concept không ai dùng, thêm indirection và khiến người đọc phải tìm class cụ thể duy nhất. Rule of thumb: đừng extract interface cho đến khi có hai implementation hoặc một seam thực sự (chẳng hạn để testing). YAGNI: một plain class hôm nay tốt hơn một cặp interface-implementation mà bạn 'có thể' sẽ cần. Tôi xóa các speculative abstraction trong review."

**Q16. Làm thế nào để evolve public interface mà không break caller?**
"Thêm method `default` (binary-compatible) thay vì thay đổi signature; đánh dấu method cũ bằng `@Deprecated` và giữ nó trong một release. Không bao giờ remove method trong minor version. Với breaking change, phát hành interface `v2` và giữ `v1` delegate đến nó trong migration window. Tôi xem interface surface là một contract có deprecation policy, không phải playground."

**Q17. Subclass override method nhưng gọi `super` sai (hoặc không gọi). Guard thế nào?**
"Nếu behavior của parent bắt buộc phải chạy, hãy đặt method của parent là `final` và expose một extension point (`protected` hook) để subclass triển khai; như vậy subclass không thể bỏ qua invariant. Nếu subclass phải thay thế hoàn toàn behavior, hãy document điều đó và thêm test để assert contract. Template Method cùng `final` skeleton là cách ngăn bug 'quên gọi super'."

**Q18. Represent state machine không tangle boolean thế nào?**
"Model state bằng kiểu `enum`/`sealed` với các legal transition rõ ràng, thay vì `boolean active, boolean paused, boolean locked` (cho phép các tổ hợp không hợp lệ như cả ba cùng là true). Transition method sẽ từ chối những chuyển trạng thái không hợp lệ:"

```java
enum State { DRAFT, ACTIVE, LOCKED;
  boolean canTransitionTo(State next) { return switch(this){ case DRAFT -> next==ACTIVE; case ACTIVE -> next==LOCKED||next==DRAFT; case LOCKED -> next==DRAFT; }; }
}
```

"Illegal state trở nên impossible by construction, thay vì phụ thuộc vào một `if` tại runtime mà bạn có thể quên."

#### Self-check

- [ ] Junior: Tôi có thể gọi tên bốn trụ cột, phân biệt abstract class và interface, override và overload (kèm `null` ambiguity và static hiding), nêu hợp đồng `equals`/`hashCode` và biết khi nào `record` phù hợp — bằng code.
- [ ] Mid: Tôi có thể nhận ra fragile-base-class, misuse của từng chữ SOLID, anemic model, bug `==` trên wrapper, Template/Strategy pattern và misuse của `Optional` — bằng code.
- [ ] Senior: Tôi có thể refactor inheritance → composition với cost/benefit, áp dụng LSP vào một violation thực tế, thiết kế interface cho 5 năm với `sealed`, tách fat interface, bảo vệ OOD bằng độ lớn của thay đổi (1 class so với 12) và model state machine để illegal state trở nên unrepresentable.
