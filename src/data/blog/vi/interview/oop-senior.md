---
title: "Ôn thi Java #2: OOP và Nguyên lý Thiết kế"
description: "50 câu hỏi phỏng vấn Java thực tế về nền tảng OOP, trade-off của SOLID, composition, thiết kế interface và các quyết định refactor ở cấp senior."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

Phỏng vấn về object-oriented design không chủ yếu kiểm tra vốn từ vựng. Phần khó là chọn boundary, giữ invariant và chấp nhận chi phí của lựa chọn đó. Bài viết đi từ nền tảng Java đến các câu hỏi trong design review: 50 câu hỏi, kèm ví dụ ngắn khi code giúp làm rõ trade-off.

Các nhãn dưới đây phân biệt behavior của Java với nhận định thiết kế:

- **[SOURCE FACT]**: quy tắc của ngôn ngữ hoặc API.
- **[ANALYSIS]**: diễn giải hoặc trade-off về thiết kế.
- **[PROPOSED DESIGN]**: một thiết kế hợp lý cho scenario đã nêu, không phải tuyên bố về một hệ thống có sẵn.

## Junior: Nền tảng

**Q1. Bốn trụ cột của OOP là gì?**

**[SOURCE FACT]** Encapsulation giữ state phía sau behavior được kiểm soát. Abstraction bộc lộ ý định thay vì implementation. Inheritance mô hình hóa chuyên biệt hóa và tái sử dụng behavior. Polymorphism cho phép một contract có nhiều implementation. **[ANALYSIS]** Gọi tên bốn khái niệm là phần dễ; bài kiểm tra thiết kế là hierarchy có còn hợp lệ khi requirement thay đổi hay không.

**Q2. Abstract class hay interface?**

**[SOURCE FACT]** Abstract class có thể chứa instance state và method đã triển khai; một class chỉ có thể `extend` một class. Interface định nghĩa contract; từ Java 8, interface có thể có method `default` và `static`, nhưng không có instance field. **[ANALYSIS]** Dùng interface cho capability hoặc type. Dùng abstract class khi shared state hoặc partial implementation ổn định là một phần của model.

```java
interface Worker { void doWork(); }
interface Reviewer { void review(Change change); }
final class Programmer implements Worker, Reviewer { /* cả hai role */ }
```

**Q3. Polymorphism là gì?**

**[SOURCE FACT]** Với subtype polymorphism, biến có kiểu supertype có thể tham chiếu đến subtype. Instance method bị override được chọn tại runtime dựa trên kiểu của object. Ngược lại, overload được quyết định tại compile time dựa trên kiểu được khai báo của argument.

```java
Animal animal = new Dog();
animal.speak(); // Dog.speak()
```

**Q4. Overriding khác overloading thế nào?**

Overriding dùng cùng method signature trong subtype và tham gia runtime dispatch. Overloading dùng cùng tên với các kiểu parameter khác nhau và được quyết định tại compile time. Ví dụ, `log(null)` là ambiguous khi cùng có `log(Object)` và `log(String)`.

```java
void log(Object value) { }
void log(String value) { }
// log(null); // compile-time error: ambiguous
```

**Q5. Contract của `equals`/`hashCode` yêu cầu gì?**

**[SOURCE FACT]** Nếu `a.equals(b)` là `true`, hai object phải trả về cùng hash code. Hãy override hai method một cách nhất quán. Nếu không, một key bằng nhau về mặt logic có thể không được tìm thấy trong `HashMap` hoặc `HashSet`.

```java
final class User {
  private final String id;
  // equals và hashCode phải dùng cùng các field identity
}
```

**Q6. Abstract method khác interface `default` method thế nào?**

Method abstract trong abstract class không có implementation để subclass kế thừa. Interface `default` method có implementation mà class triển khai có thể kế thừa hoặc override. **[ANALYSIS]** `default` method có thể giúp evolve interface mà chưa buộc mọi implementation hiện tại phải thêm method ngay; nhưng behavior đó vẫn phải thực sự là tùy chọn.

**Q7. Constructor có thể override hoặc overload không?**

**[SOURCE FACT]** Constructor có thể overload với các parameter list khác nhau. Constructor không thể override vì không được kế thừa. Constructor của subclass phải gọi constructor của parent, tường minh hoặc ngầm định, trước khi chạy body của chính nó.

**Q8. `super` làm gì trong constructor?**

Nó gọi parent constructor; `super.method()` cũng có thể chọn implementation của parent. Nếu parent không có no-argument constructor khả dụng, subclass phải gọi tường minh một constructor phù hợp, nếu không code sẽ không biên dịch.

**Q9. Method hiding khác overriding thế nào?**

**[SOURCE FACT]** Method `static` ở subclass có cùng signature sẽ hide method của parent. Method static được chọn theo reference type tại compile time. Instance method có thể override và được chọn qua runtime dispatch.

```java
Parent value = new Child();
value.staticMethod(); // Parent.staticMethod()
```

**Q10. Object reference khác primitive thế nào?**

**[SOURCE FACT]** Primitive variable lưu một giá trị; object variable lưu một reference trỏ đến object. Java truyền argument bằng value: truyền reference là copy reference, không copy object. Vì vậy hai reference được copy có thể cùng quan sát mutation trên một mutable object. Kích thước reference phụ thuộc JVM implementation; không nên coi một số byte cụ thể là bảo đảm của ngôn ngữ.

**Q11. `record` (Java 16+) là gì?**

**[SOURCE FACT]** Record là một class data-carrier ngắn gọn. Compiler tự sinh accessor cho component cùng `equals`, `hashCode` và `toString` theo giá trị. Component là final, nhưng vẫn có thể trỏ đến một object mutable. **[ANALYSIS]** Record phù hợp với DTO và value object, không phù hợp với model cần mutable identity hoặc class inheritance.

```java
record Point(int x, int y) { }
```

**Q12. `null` khác empty object thế nào?**

`null` nghĩa là không có object reference; dereference nó sẽ ném `NullPointerException`. `List.of()` và `""` là object hợp lệ nhưng không có element hoặc character. **[ANALYSIS]** Trả về empty collection thường là contract rõ ràng hơn trả về `null`; chỉ dùng Null Object khi có một no-op object có ý nghĩa.

**Q13. `static` method có thể access instance field không?**

**[SOURCE FACT]** Static method thuộc về class và không có `this`, nên không thể trực tiếp truy cập instance field hoặc gọi instance method. Nó có thể dùng static member và parameter của mình.

**Q14. `String.length()` khác array `.length` thế nào?**

**[SOURCE FACT]** `String.length()` là method và trả về số UTF-16 `char` code unit. Con số này có thể khác số Unicode code point hoặc số grapheme mà người dùng cảm nhận. `array.length` là final field. Một cái dùng dấu ngoặc; cái kia thì không.

**Q15. Upcasting và downcasting là gì?**

Upcasting, như `Animal a = new Dog()`, là implicit và an toàn khi quan hệ subtype hợp lệ. Downcasting, như `Dog d = (Dog) a`, là explicit và ném `ClassCastException` nếu object không phải `Dog`. Ưu tiên method polymorphic; chỉ downcast khi thực sự cần và nên dùng `instanceof` để kiểm tra.

## Mid: Trade-off và cạm bẫy

**Q1. Khi nào inheritance là công cụ sai?**

**[ANALYSIS]** Inheritance không phù hợp khi quan hệ không phải “is-a” ổn định hoặc subclass phải phụ thuộc vào implementation detail của base class. Đây là fragile base class problem. **[PROPOSED DESIGN]** Đặt collaborator thay đổi phía sau interface và delegate cho nó:

```java
class ReportGenerator {
  private final Writer writer;
  ReportGenerator(Writer writer) { this.writer = writer; }
  void generate() { writer.write(render()); }
}
```

Dependency này có thể là spreadsheet writer, PDF writer hoặc test double mà không cần sửa logic của report.

**Q2. Giải thích SOLID, kèm một misuse cho từng nguyên tắc.**

- **S, Single Responsibility**: `UserService` vừa gửi email vừa ghi audit log nên có nhiều lý do thay đổi. Hãy tách các trách nhiệm đó.
- **O, Open/Closed**: `switch(type)` phải sửa mỗi khi có type mới; polymorphic implementation có thể phù hợp hơn.
- **L, Liskov Substitution**: `Square extends Rectangle` có thể phá contract nếu caller kỳ vọng width và height thay đổi độc lập.
- **I, Interface Segregation**: không nên ép programmer triển khai `cleanToilet()` chỉ vì interface `Worker` có method đó.
- **D, Dependency Inversion**: `new MySQLRepository()` trong business logic gắn high-level code với detail. Hãy phụ thuộc vào abstraction `Repository`.

**Q3. `Comparator` khác `Comparable` thế nào?**

**[SOURCE FACT]** `Comparable` định nghĩa natural ordering của type qua `compareTo`. `Comparator` là một strategy ordering bên ngoài và một type có thể có nhiều strategy. Dùng `Comparable` cho thứ tự mặc định và `Comparator` cho sort theo context.

```java
List<User> byName = users.stream()
    .sorted(Comparator.comparing(User::name))
    .toList();
```

**Q4. Vì sao getter và setter chưa phải encapsulation đầy đủ?**

Getter/setter không hạn chế chỉ làm lộ state mà không bảo vệ invariant. Encapsulation nên expose operation giữ object hợp lệ:

```java
final class Account {
  private BigDecimal balance;
  void withdraw(BigDecimal amount) {
    if (amount.signum() <= 0 || amount.compareTo(balance) > 0)
      throw new IllegalArgumentException();
    balance = balance.subtract(amount);
  }
}
```

**Q5. Vì sao `==` trên boxed value là bug tiềm ẩn?**

**[SOURCE FACT]** `Integer.valueOf` phải cache ít nhất khoảng `-128` đến `127`; implementation có thể cache thêm. Vì vậy so sánh identity có thể tình cờ đúng với giá trị này nhưng sai với giá trị khác. Với wrapper, dùng `equals`, hoặc chủ động unbox để so sánh primitive.

**Q6. Khi nào dùng record, và giới hạn là gì?**

Dùng record cho immutable data carrier hoặc value object. Record không thể extend class khác, component của nó là final và có canonical constructor, dù vẫn có thể thêm constructor khác hoặc static factory. Final reference không làm collection mà nó trỏ tới trở thành immutable.

**Q7. `equals` khác `==` với record thế nào?**

`equals` của record so sánh mọi component. `==` vẫn so sánh object identity:

```java
record Point(int x, int y) { }
var first = new Point(1, 2);
var second = new Point(1, 2);
first.equals(second); // true
first == second;      // false
```

**Q8. Final class khác final method thế nào?**

**[SOURCE FACT]** Final class không thể bị subclass; final method không thể bị override. JIT có thể dùng thông tin này cho devirtualization và inlining, nhưng performance phụ thuộc implementation. Đừng thêm `final` chỉ để tuyên bố một benchmark improvement.

**Q9. Template Method là gì và pitfall ở đâu?**

Pattern này đặt algorithm skeleton cố định trong base class và để subclass cung cấp một số step:

```java
abstract class Report {
  final void produce() { fetch(); render(); save(); }
  abstract void render();
}
```

Flow cố định hữu ích khi invariant là thật. Chi phí là dependency mạnh hơn vào base class: subclass không thể đổi thứ tự step và thay đổi skeleton sẽ ảnh hưởng mọi subclass.

**Q10. Strategy là gì, khi nào tốt hơn `if/else`?**

Strategy đặt algorithm thay đổi phía sau interface để có thể chọn implementation tại runtime. Nó phù hợp khi một nhánh theo type liên tục phình to hoặc thay đổi:

```java
interface Discount { BigDecimal apply(Order order); }
final class VipDiscount implements Discount { /* ... */ }
final class SeasonalDiscount implements Discount { /* ... */ }
```

Đừng thêm pattern này cho một nhánh nhỏ, ổn định và dễ đọc khi viết inline.

**Q11. Dùng interface hay abstract class cho shared behavior?**

Chọn interface khi consumer cần contract hoặc capability và các implementation nên độc lập. Chọn abstract class khi shared field và partial implementation là một phần ổn định của abstraction. Abstract class chiếm slot single inheritance.

**Q12. `Optional` là gì và misuse ra sao?**

`Optional<T>` làm cho khả năng không có giá trị trở nên rõ ràng, chủ yếu ở return boundary. Dùng nó làm field hoặc parameter thường làm API phức tạp mà không thêm thông tin hữu ích. Gọi `get()` mà chưa xử lý absence sẽ ném `NoSuchElementException`; hãy dùng `orElse`, `orElseGet` hoặc `orElseThrow` với contract rõ ràng.

**Q13. `Integer.parseInt` khác `Integer.valueOf` thế nào?**

**[SOURCE FACT]** `parseInt` trả về primitive `int`; `valueOf` trả về `Integer`. Chọn kiểu trả về phù hợp với boundary và tránh boxing không cần thiết. Không dùng `==` để kiểm tra identity của wrapper.

**Q14. Static initializer khác instance initializer thế nào?**

`static {}` chạy khi class được initialize, còn instance initializer `{}` chạy ở mỗi lần tạo object, trước body của constructor. Cả hai đều hợp lệ, nhưng named factory hoặc constructor thường dễ hiểu và dễ test hơn.

**Q15. Covariant return type và parameter trong method override?**

Method override được phép trả về subtype của return type ở parent. Parameter không có tính contravariant trong Java overriding: đổi parameter thành subtype sẽ tạo overload, không phải override. Thêm `@Override` để compiler bắt lỗi này.

**Q16. `clone()` khác copy constructor thế nào?**

`Object.clone()` tạo shallow copy, còn `Cloneable` không mô tả một contract copy hữu ích. Copy constructor hoặc static factory rõ ràng, type-safe và có thể tạo deep copy nếu model yêu cầu. Hãy ưu tiên các lựa chọn đó.

**Q17. Phân tầng quá mức có chi phí gì?**

Chuỗi `XController -> XService -> XManager -> XRepository` mà các layer giữa chỉ delegate sẽ thêm indirection, file, test và change surface nhưng không thêm boundary. **[ANALYSIS]** Giữ layer nếu nó sở hữu policy, transaction boundary hoặc adapter có ý nghĩa; gộp layer pass-through.

## Senior: Thiết kế và bảo vệ quyết định

**Q1. Bảo vệ composition over inheritance bằng một refactor cụ thể.**

**[PROPOSED DESIGN]** Thay `ReportGenerator extends ExcelWriter` bằng `ReportGenerator` chứa một `Writer`. Thay đổi formatting nằm trong writer; test có thể inject fake writer thay vì tạo workbook. Chi phí là một interface và constructor dependency; lợi ích là boundary coupling nhỏ hơn và có thể thêm PDF implementation độc lập.

**Q2. Team muốn `BaseEntity` có 30 field cho mọi JPA entity. Bạn nói gì?**

**[PROPOSED DESIGN]** Chỉ giữ trong base type những state dùng chung và ổn định như identity, version, timestamp hoặc auditing. Đưa field không liên quan xuống entity sở hữu chúng. Nếu không, entity sẽ kế thừa column không dùng và thay đổi không liên quan sẽ lan qua mapping. Ảnh hưởng chính xác đến kích thước table phụ thuộc workload, nên phải đo thay vì hứa trước.

**Q3. Thiết kế interface cho năm năm thay đổi thế nào?**

**[PROPOSED DESIGN]** Giữ contract nhỏ và tập trung vào behavior. Với tập subtype đóng, `sealed` (Java 17+) giúp compiler chỉ ra các case chưa xử lý:

```java
sealed interface PaymentMethod
    permits Card, BankTransfer, Wallet { }
```

Bộc lộ capability hẹp như `Readable` và `Flushable`, không tạo `MegaService`. Chỉ dùng `default` cho behavior thực sự tùy chọn.

**Q4. Nêu một violation của Liskov Substitution và cách sửa.**

`Square extends Rectangle` không an toàn nếu caller của rectangle kỳ vọng width và height thay đổi độc lập. Square không thể vừa giữ invariant của mình vừa đáp ứng kỳ vọng đó. Hãy model cả hai là implementation riêng của contract nhỏ hơn, chẳng hạn `Shape` có `area()`. Subtyping là một behavioral promise, không chỉ là tái sử dụng code.

**Q5. Interface có 12 method nhưng caller chỉ dùng 2. Thiết kế lại thế nào?**

Tách thành các interface tập trung như `Reader`, `Writer` và `Lifecycle`. Một class có thể implement cả ba, còn read-only caller chỉ phụ thuộc `Reader`. Dependency được thu hẹp, test setup cũng đơn giản hơn mà behavior của class không đổi.

**Q6. Làm sao chứng minh OOD tốt chứ không chỉ “clean”?**

**[ANALYSIS]** Truy vết một requirement change thực tế. Đếm class và call site phải thay đổi, xác định invariant mỗi class sở hữu và xem test surface. Dependency graph tách abstraction ổn định khỏi detail dễ thay đổi là hữu ích, nhưng “đã dùng SOLID” không phải bằng chứng. Diff và failure mode mới là bằng chứng.

**Q7. Dùng record trong public API có vấn đề versioning gì?**

Record component là một phần của contract `equals` sinh tự động và thường là một phần của serialization. Vì vậy thêm component có thể là breaking change với consumer phụ thuộc vào một trong hai. Giữ record ở internal và map tại boundary, hoặc coi component list là public contract phải version rõ ràng.

**Q8. Khi nào dùng sealed hierarchy, khi nào dùng enum?**

Dùng enum cho tập constant đơn giản và cố định. Dùng sealed hierarchy khi mỗi case cần state hoặc behavior khác nhau và tập đó phải đóng. Nếu model chỉ là `A | B | C`, enum đơn giản hơn.

**Q9. Thiết kế plugin system không dùng chuỗi `instanceof` thế nào?**

Định nghĩa contract `Plugin` như `handle(Event)`, register các implementation và dispatch qua capability hoặc predicate tường minh. Visitor có thể cung cấp double dispatch có type. Với sealed event hierarchy, giữ logic xử lý đủ tập trung để compiler kiểm tra coverage.

**Q10. Làm sao giữ domain model không phụ thuộc framework annotation?**

**[PROPOSED DESIGN]** Đặt annotation JPA, Jackson và validation trên persistence hoặc API DTO. Map chúng sang domain object ở boundary. Domain khi đó phụ thuộc business type thay vì framework package, giúp thay framework và unit-test thuần dễ hơn. Đây là lựa chọn thiết kế, không phải quy tắc tuyệt đối; phải cân nhắc chi phí mapping.

**Q11. Base-class method dài 400 dòng. Refactor an toàn thế nào?**

Trước tiên dùng test ghi nhận behavior hiện tại, nhất là output và error case. Sau đó extract các step có tính kết dính, giữ invariant skeleton trong final template method, hoặc thay hierarchy bằng strategy object. Xác minh behavior sau từng bước. Số dòng là tín hiệu cảnh báo; test mới xác định thứ phải giữ ổn định.

**Q12. Bảo vệ dependency inversion bằng một seam cụ thể.**

**[PROPOSED DESIGN]** `Checkout` phụ thuộc `PaymentGateway`, còn Stripe implementation được lắp ở edge và inject vào. Test có thể dùng fake gateway không cần network; gateway khác cũng có thể được chọn mà không sửa `Checkout`. Seam có giá trị vì cô lập policy khỏi external detail.

**Q13. Khi nào immutability đáng với chi phí allocation?**

Ưu tiên immutable value khi đi qua thread boundary, được lưu trong cache hoặc đại diện cho một fact ổn định ở method boundary. Cách này giảm bug do shared mutation và nhu cầu defensive copy. Trong hot loop đã đo đạc, mutable local có thể phù hợp. Chi phí allocation và garbage collection phụ thuộc workload; hãy benchmark trước khi tối ưu.

**Q14. Chọn inheritance hay delegation cho cross-cutting behavior?**

Dùng decorator, interceptor hoặc aspect cho logging và metrics thay vì base class `LoggedThing`. `MetricsDecorator` có thể bọc `Repository`, rồi compose thêm logging, metrics và caching. Delegation giữ các concern độc lập; inheritance tạo ra các tổ hợp khó bảo trì.

**Q15. Over-abstracting có chi phí gì?**

Abstraction chỉ có một implementation có thể thêm tên gọi và indirection mà không cô lập một seam thật. **[ANALYSIS]** Introduce interface khi có nhiều implementation có ý nghĩa hoặc có boundary testing/integration cụ thể. YAGNI là một ràng buộc thiết kế: đừng biến requirement giả định thành architecture.

**Q16. Evolve public interface mà không break caller thế nào?**

Thêm behavior tùy chọn bằng `default` method khi semantics và binary compatibility cho phép. Deprecate method cũ kèm migration path rõ ràng. Với contract không tương thích, publish version mới và định nghĩa cách version cũ delegate hoặc được retire. Chính sách phụ thuộc compatibility promise của API; minor release không mặc nhiên an toàn với mọi consumer.

**Q17. Subclass override method nhưng gọi `super` sai. Guard thế nào?**

Nếu behavior của parent là invariant, đặt algorithm method là `final` và expose protected hook cho step thay đổi. Nếu thay thế hoàn toàn là chủ ý, document contract và viết test. Final template method ngăn subclass âm thầm bỏ qua setup hoặc cleanup bắt buộc.

**Q18. Model state machine mà không bị rối bởi boolean thế nào?**

Biểu diễn state bằng enum hoặc sealed type và định nghĩa tường minh các transition hợp lệ. Nhiều boolean có thể tạo tổ hợp không hợp lệ; transition method có thể từ chối move sai:

```java
enum State {
  DRAFT, ACTIVE, LOCKED;
  boolean canTransitionTo(State next) {
    return switch (this) {
      case DRAFT -> next == ACTIVE;
      case ACTIVE -> next == LOCKED || next == DRAFT;
      case LOCKED -> next == DRAFT;
    };
  }
}
```

Model làm cho transition không hợp lệ trở nên rõ ràng thay vì rải các check ở nhiều caller.

#### Tự kiểm tra

- [ ] Junior: Tôi giải thích được bốn trụ cột, abstract class và interface, overriding và overloading, static hiding, contract `equals`/`hashCode` và khi nào record phù hợp.
- [ ] Mid: Tôi nhận ra coupling kiểu fragile-base-class, misuse của SOLID, anemic model, bug `==` trên boxed value, trade-off của Template và Strategy, cùng misuse của `Optional`.
- [ ] Senior: Tôi có thể refactor inheritance sang composition, áp dụng Liskov Substitution, thiết kế sealed interface hẹp, tách fat interface, bảo vệ change boundary bằng bằng chứng và model legal state transition.
