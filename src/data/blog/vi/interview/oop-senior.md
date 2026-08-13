---
title: "Ôn thi Java #2: OOP & Nguyên lý Thiết kế — Junior đến Senior"
description: "OOP ở mức senior là áp dụng SOLID, composition over inheritance, và thiết kế interface quy mô lớn — không phải đọc thuộc định nghĩa. 50 câu hỏi phỏng vấn từ bốn trụ cột đến 'đây là refactor cứu chúng tôi change 12 class'."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

OOP là phần phỏng vấn nơi interviewer ngừng hỏi "cái gì" và bắt đầu hỏi "tại sao". Ai cũng gọi được bốn trụ cột; một senior show được code nơi kế thừa làm họ đau và refactor sửa nó. Bài này leo từ sách giáo khoa lên bảng trade-off — 50 câu hỏi, với example compilable.

> Mindset: junior implement interface; senior quyết định interface đó có nên tồn tại không, và nó tốn gì cho 5 năm tiếp theo của codebase.

## Junior — nền tảng

**Q1. Bốn trụ cột của OOP?**
Encapsulation (che giấu state sau behavior), Abstraction (bộc lộ ý định, không phải cơ chế), Inheritance (tái dùng bằng chuyên biệt hóa), Polymorphism (một interface, nhiều implement). Gọi tên chúng chẳng tốn gì; áp dụng không tạo hierarchy giòn mới là kỹ năng.

**Q2. Abstract class vs interface?**
Abstract class giữ được state và implement method; một class chỉ extend một class. Interface là hợp đồng — trước Java 8 chỉ signature, nay có `default`/`static` nhưng không có instance field. Ưu tiên interface cho _type_, abstract class chỉ cho shared state/behavior.

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
Subtype polymorphism: biến supertype trỏ đến mọi subtype, JVM dispatch method bị override tại runtime. Overloading _không_ phải polymorphism (giải quyết tại compile bởi signature).

```java
Animal a = new Dog();   // compile type Animal, runtime Dog
a.speak();              // gọi Dog.speak() — virtual dispatch
```

**Q4. Overriding vs overloading?**
Overriding: cùng signature ở subclass, runtime-dispatched. Overloading: cùng tên, tham số khác kiểu, compile-time. Một overload ambiguous fail compile:

```java
void log(Object o) { }
void log(String s) { }
log(null);   // compile ERROR: ambiguous giữa Object và String
```

**Q5. Hợp đồng `equals`/`hashCode` đòi gì?**
Nếu `a.equals(b)` thì `a.hashCode() == b.hashCode()`. Override cả hai nếu không map hỏng:

```java
class User { String id; public boolean equals(Object o){...} }  // không hashCode
Map<User,String> m = new HashMap<>();
m.put(new User("42"), "x");
m.get(new User("42"));   // trả null — bucket khác!
// RIGHT: cả hai override, consistent
```

**Q6. `abstract` vs `default` method của interface?**
Abstract class method có thân subclass có thể override. Interface `default` cung cấp behavior class kế thừa không cần implement — dùng cho tiến hóa API tương thích ngược. Override `default` để đổi nó.

**Q7. Constructor có thể override hay overload?**
Overload được (nhiều constructor tham số khác nhau); override không (constructor không thừa kế, nó per-class). Subclass constructor phải gọi parent constructor (`super(...)`) là câu lệnh đầu.

**Q8. `super` dùng gì trong constructor?**
Để gọi parent's constructor hoặc method. Quên `super()` khi parent không có no-arg constructor là compile error — thường gặp với parent kiểu `SQLException(String)`.

**Q9. Method hiding vs overriding?**
`static` method ở subclass cùng signature với parent `static` method _hide_ nó (giải quyết bởi reference type tại compile), không như instance method overriding (runtime dispatch bởi object type). Trap phỏng vấn thường gặp:

```java
Parent p = new Child(); p.staticMethod(); // gọi Parent.staticMethod (hiding)
```

**Q10. Khác nhau object reference và primitive?**
Reference là pointer đến heap object (~4–8 bytes); primitive giữ value trực tiếp (4 bytes cho `int`). Pass primitive copy value; pass object reference copy pointer (cùng trỏ object). Mutate qua reference mutate shared object.

**Q11. `record` (Java 16+) là gì và khi dùng?**
Immutable data carrier với auto `equals`/`hashCode`/`toString`/accessor. Dùng cho DTO và value object. Đừng dùng cho mutable state hoặc inheritance. `record Point(int x, int y)` hơn hẳn class viết tay 40 dòng.

**Q12. Khác nhau `null` và empty object?**
`null` nghĩa "không object" — dereference throw `NullPointerException`. Empty object (vd `List.of()`, `""`) là object hợp lệ không có content. Ưu tiên trả empty collection hơn `null` để tránh NPE (Null Object / empty-collection idiom).

**Q13. `static` method — có access instance field không?**
`static` method thuộc class, không instance; không thể access instance (non-static) field hoặc gọi instance method trực tiếp — không có `this`. Chỉ dùng `static` member khác hoặc parameter.

**Q14. Khác nhau `String.length()` và array `.length`?**
`String.length()` là method (trả char count, char là UTF-16 code unit — string có supplementary char báo nhiều hơn grapheme count). `array.length` là `final` field. Off-by-one kinh điển: `str.length()` là call, `arr.length` không.

**Q15. Upcasting và downcasting?**
Upcasting (`Animal a = new Dog()`) implicit và luôn safe. Downcasting (`Dog d = (Dog) a`) explicit và throw `ClassCastException` tại runtime nếu `a` thực không phải `Dog`. Dùng `instanceof` trước downcast.

## Mid — tradeoff & điểm mù

**Q1. Khi nào inheritance là công cụ sai?**
Khi quan hệ không phải "is-a" với behavior chia sẻ ổn định. Inheritance ghép subclass vào implementation của parent mãi mãi — "fragile base class". Hãy với tới **composition**:

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

**Q2. Giải thích SOLID ngắn gọn, với misuse thật của mỗi cái.**

- **S**: `UserService` vừa send email vừa ghi audit log đổi vì 3 lý do. Tách chúng ra.
- **O**: `switch(type)` bạn sửa mỗi khi có type mới — thay bằng polymorphism.
- **L**: `Square extends Rectangle` nơi `setWidth` phá invariant của rectangle.
- **I**: interface `Worker` ép `cleanToilet()` lên `Programmer` — tách nó.
- **D**: `new MySQLRepository()` hardcode — phụ thuộc `Repository` (interface) thay vì.

**Q3. `Comparator` vs `Comparable`?**
`Comparable` là thứ tự tự nhiên (`compareTo`); `Comparator` là strategy bên ngoài (nhiều cái tồn tại). Dùng `Comparable` cho mặc định, `Comparator` cho sort tùy ngữ cảnh:

```java
List<User> byName = users.stream().sorted(Comparator.comparing(User::name)).toList();
```

**Q4. Tại sao getter/setter không phải encapsulation thật?**
Cặp getter/setter public không invariant chỉ là public field với thêm bước. Encapsulation thật bộc lộ hành vi:

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
`Integer.valueOf(42) == Integer.valueOf(42)` là `true` (cache -128..127) nhưng `Integer.valueOf(200) == Integer.valueOf(200)` là `false`. Luôn `equals` cho wrapper.

**Q6. Khi nào dùng `record` — và giới hạn?**
Cho immutable data carrier — auto `equals`/`hashCode`/`toString`. Giới hạn: không inheritance (không extend record), mọi field final, chỉ canonical constructor (bạn thêm static/non-canonical constructor). Đừng dùng nơi cần mutable state hoặc mutable collection field (reference final nhưng collection không).

**Q7. Khác nhau `equals` và `==` cho `record`?**
Record sinh `equals` bởi mọi component, nên hai record component bằng nhau là `equals`-equal; `==` vẫn so identity. `var r1 = new Point(1,2); var r2 = new Point(1,2); r1.equals(r2)` là `true`, `r1 == r2` là `false`.

**Q8. Khác nhau `final` class và `final` method — và tại sao JVM quan tâm?**
`final` class không thể subclass; `final` method không thể override. JIT dùng điều này cho devirtualization — nó inline call trực tiếp vì biết chỉ có một implement, remove vtable lookup (~nanosecond save mỗi call, compound trong hot loop).

**Q9. Template Method pattern và pitfall?**
Base class định `final` skeleton gọi các abstract step subclass fill:

```java
abstract class Report {
  final void produce() { fetch(); render(); save(); }   // skeleton
  abstract void render();
}
```

Pitfall: flow `produce()` của base bị lock; subclass không reorder được step, và đổi skeleton dội khắp subclass (fragile base class lần nữa).

**Q10. Strategy pattern và khi nào hơn if/else?**
Encapsulate algorithm biến thiên sau interface; swap implement tại runtime. Dùng thay `switch` trên type bạn liên tục sửa:

```java
interface Discount { BigDecimal apply(Order o); }
class VipDiscount implements Discount { /* 20% off */ }
class SeasonalDiscount implements Discount { /* 10% off */ }
// thêm discount = class mới, không sửa caller
```

**Q11. Khác nhau interface và abstract class cho shared behavior?**
Interface: không state, nhiều implement, `default` method cho optional behavior. Abstract class: shared state + partial implementation, single inheritance. Cần shared _field_ (vd `id`, `auditStamp`) → abstract class; chỉ _contract_ → interface.

**Q12. `Optional` và misuse?**
`Optional<T>` báo "có thể vắng" ở return type, thay `null`. Misuse: dùng làm field/parameter type (dùng `null` hoặc object thật), hoặc gọi `get()` không `isPresent()` (throw `NoSuchElementException` — dùng `orElse`/`orElseThrow`).

**Q13. Khác nhau `Integer.parseInt` và `Integer.valueOf`?**
`parseInt` trả primitive `int`; `valueOf` trả `Integer` (cache -128..127). Dùng `parseInt` khi muốn primitive; `valueOf` khi cần object. Trộn lẫn dẫn vào boxing/== trap trên.

**Q14. `static` initializer block vs instance initializer?**
`static {}` chạy một lần tại class load; `{}` (instance initializer) chạy mỗi `new`, trước constructor body. Hữu ích cho shared init logic xuyên nhiều constructor, nhưng hiếm cần — constructor hoặc factory rõ hơn.

**Q15. Covariance/contravariance của return/param type trong overriding?**
Java cho phép covariant return type (overriding method có thể trả subtype của parent's return). Parameter _không_ covariant — method với subclass parameter là overload, không phải override, và không dispatch virtually. Bug thường "tại sao override tôi không được gọi?".

**Q16. Khác nhau `clone()` và copy constructor?**
`Object.clone()` là shallow copy (và `Cloneable` là broken, checked-exception-throwing marker). Copy constructor (`new User(other)`) explicit, deep khi bạn làm, và type-safe. Ưu tiên copy constructor hoặc static factory hơn `clone()`.

**Q17. Cost của excessive layering (anemic class)?**
Mỗi wrapper class thêm vtable hop và indirection; architecture `XController → XService → XManager → XRepository → XEntity` không logic ở middle layer là pure overhead (nhiều file hơn, test surface lớn hơn, diff lớn hơn cho cùng change). Collapse layer chỉ delegate.

## Senior — thiết kế & phòng thủ

**Q1. Phòng thủ composition over inheritance bằng refactor cụ thể.**
"Tôi lấy `ReportGenerator extends ExcelWriter` và lật: `ReportGenerator` giữ interface `Writer` để delegate. Lý do: coupling Excel nghĩa mọi đổi formatting rủi ro logic report, và không test được report không có spreadsheet thật. Composition cho phép inject `FakeWriter` và thêm `PdfWriter` không sửa gì `ReportGenerator`. Cái giá: một interface + một constructor arg — bảo hiểm rẻ trước fragile base class. Thắng đo được: test setup từ 'spin up workbook' thành 'pass một stub'."

**Q2. Team muốn `BaseEntity` 30 field, mọi JPA entity extend. Bạn nói sao?**
"Tôi tách. `BaseEntity` thật (id, version, createdAt, updatedAt, auditing) là 'is-a' với state chia sẻ ổn định. 26 field còn lại là grab-bag — subtype thừa kế column không dùng, query rộng hơn, đổi một chỗ dội khắp nơi. Tôi đẩy 26 field đó xuống entity sở hữu chúng. Thắng đo được: table hẹp hơn (~30% ít bytes/row trên hot table), ownership rõ hơn."

**Q3. Thiết kế interface sống sót 5 năm yêu cầu mới.**
"Tôi giữ nó nhỏ và behavioral. Cho tập subtype đóng tôi dùng `sealed` (Java 17+) để compiler ép xử lý mọi case — thêm subtype là compile error đến khi bạn lo xong:"

```java
sealed interface PaymentMethod permits Card, BankTransfer, Wallet { }
// thêm 'Crypto' break mọi switch(PaymentMethod) đến khi handled — evolution an toàn
```

"Tôi bộc lộ capability hẹp (`Readable`, `Flushable`) thay vì một `MegaService`, và dùng `default` chỉ cho behavior thực sự tùy chọn."

**Q4. Liskov Substitution — violation thật và fix.**
"`Square extends Rectangle`: set width phải cũng set height để giữ hình vuông, nhưng phá hợp đồng `Rectangle` rằng width/height độc lập. Code `r.setWidth(5); r.setHeight(10); assert r.area()==50` nói dối. Fix: đừng model square là subtype của rectangle — trích `Shape` với `area()` và implement cả hai độc lập. Subtyping là lời hứa; giữ không được thì đừng hứa."

**Q5. Interface 12 method nhưng caller dùng 2. Thiết kế lại?**
"Vi phạm Interface Segregation. Tách thành `Reader`, `Writer`, `Lifecycle`; class cụ thể implement cả ba nếu cần, nhưng consumer read-only chỉ phụ thuộc `Reader` — nên đổi `Writer` không bao giờ recompile nó. Class implement không đổi behavior; chỉ các _type_ nó bộc lộ ra mới hẹp. Bonus: mock trong test thành `when(reader.read()).thenReturn(...)` thay vì stub 12 method."

**Q6. Làm sao chứng minh OOD tốt, không chỉ 'sạch'?**
"Tôi chỉ vào change vừa làm và cái giá của alternative: đếm lý do mỗi class đổi, call site vỡ khi requirement shift, test surface. OOD tốt nghĩa feature mới chạm một class, không phải mười hai. Tôi phác dependency graph — DAG với abstraction ổn định ở trên, detail volatile ở dưới (dependency inversion) — và nói 'đây là diff khi requirement đổi, và nó nhỏ.' Không phải 'tôi dùng SOLID'; một số: 1 class đổi vs 12."

**Q7. `record` trong public API — versioning concern?**
"Record coupling component list với hợp đồng `equals`/`hashCode`, nên thêm component là breaking change cho equality và serialization. Cho API ổn định tôi giữ record internal (DTO mapped tại boundary) hoặc chấp nhận component list là contract. Tôi version API explicit thay vì dựa vào field addition an toàn."

**Q8. Khi nào dùng `sealed` hierarchy vs `enum`?**
"Enum khi tập cố định và không có per-instance state ngoài vài constant; `sealed` khi mỗi subtype cần data và behavior riêng nhưng tập đóng (compiler-enforced exhaustiveness). Cho payment pipeline nơi mỗi method mang field khác, `sealed` hơn enum-with-fields khổng lồ. Nếu chỉ 'status = A|B|C', enum đơn giản hơn."

**Q9. Thiết kế plugin system không `instanceof` chain.**
"Định nghĩa `Plugin` interface với `handle(Event)` và capability marker; register plugin trong `List` và dispatch by predicate thay vì `if (p instanceof X)`. `Visitor` pattern là typed alternative — acceptor callback vào visitor, giữ dispatch ở một chỗ và compiler check coverage cho `sealed` hierarchy."

**Q10. Giữ domain model free of framework annotation thế nào?**
"Đặt JPA/Jackson/`@Valid` annotation trên _persistence_ hoặc _API_ DTO, không trên domain `Order`/`Account` type. Map giữa chúng tại boundary. Lợi ích: domain compile và unit-test với zero Spring/Jakarta import (~30% nhanh test startup, không cần container), và framework version đổi không chạm business logic. Rule: `com.finpay.order.domain` không có `jakarta.*` import."

**Q11. Base class method làm quá nhiều (400 dòng). Refactor an toàn.**
"Tôi extract method-object per cohesive step, rồi push invariant skeleton vào `final` template method và step vào `abstract`/`default` method, hoặc thay hierarchy bằng composition của strategy object. Tôi làm sau test: đầu tiên characterize current behavior với golden-output test, rồi extract, rồi verify output byte-identical. Method 400 dòng là bug magnet; refactor justify bằng test surface nó remove."

**Q12. Phòng thủ dependency inversion với seam cụ thể.**
"High-level `Checkout` không nên import `StripeClient` (detail). Nó phụ thuộc `PaymentGateway` (abstraction); Stripe impl nằm ở edge và inject. Giờ `Checkout` testable với `FakeGateway` (không network, ~0 ms) và swappable sang `PaypalGateway` không chạm `Checkout`. Đo được: unit test `Checkout` chạy ~50 ms thay vì cần payment sandbox. Seam là win."

**Q13. Khi nào immutability đáng allocation cost?**
"Cho value pass xuyên thread hoặc store trong cache, immutability remove toàn bộ class của shared-mutation bug và cho phép skip defensive copy (save ~16 bytes + GC mỗi copy). Allocation cost (~10 ns) negligible bên cạnh bug cost. Cho hot inner-loop temporary mutate in place, mutable object ổn. Tôi default immutable cho thứ rời method boundary."

**Q14. Chọn giữa inheritance và delegation cho cross-cutting behavior (logging, metrics)?**
"Không bao giờ inherit cho cross-cutting concern — đó là chỗ aspect hoặc decorator. `MetricsDecorator` wrap `Repository` thêm timing không repository biết, và bạn compose nhiều cái (logging → metrics → cache) không deep hierarchy. Inheritance ép mọi class extend `LoggedThing`, không compose. Decorator = O(n) wrapper cho n concern; inheritance = O(2^n) combinatorially."

**Q15. Cost của over-abstracting (speculative generality)?**
"Abstraction với một implement là dead weight: nó đặt tên concept không ai dùng, thêm indirection, và làm reader hunt cho single concrete class. Rule of thumb: đừng extract interface đến khi có hai implement hoặc real seam (testing). YAGNI: plain class hôm nay hơn interface-impl pair bạn 'có thể' cần. Tôi xóa speculative abstraction trong review."

**Q16. Evolve public interface không break caller thế nào?**
"Thêm `default` method (binary-compatible) thay vì đổi signature; mark deprecated method `@Deprecated` và giữ nó một release. Không bao giờ remove method trong minor version. Cho breaking change, release `v2` interface và giữ `v1` delegate đến nó cho migration window. Tôi treat interface surface như contract với deprecation policy, không phải playground."

**Q17. Subclass override method nhưng gọi `super` sai (hoặc không gọi). Guard thế nào?**
"Nếu parent's behavior phải chạy, make parent method `final` và expose extension point (`protected` hook) subclass fill, nên subclass không thể skip invariant. Nếu subclass phải fully replace behavior, document nó và thêm test assert contract. Template Method + `final` skeleton là guard chống 'quên gọi super' bug."

**Q18. Represent state machine không tangle boolean thế nào?**
"Model state như `enum`/`sealed` type với explicit legal transition, không `boolean active, boolean paused, boolean locked` (cho phép combo invalid như cả ba true). Transition method reject illegal move:"

```java
enum State { DRAFT, ACTIVE, LOCKED;
  boolean canTransitionTo(State next) { return switch(this){ case DRAFT -> next==ACTIVE; case ACTIVE -> next==LOCKED||next==DRAFT; case LOCKED -> next==DRAFT; }; }
}
```

"Illegal state trở nên impossible by construction, không phải runtime `if` bạn quên."

#### Self-check

- [ ] Junior: Tôi gọi được bốn trụ cột, abstract class vs interface, override vs overload (với `null` ambiguity và static hiding), hợp đồng `equals`/`hashCode`, và khi nào `record` hợp — bằng code.
- [ ] Mid: Tôi bắt được fragile-base-class, misuse mỗi chữ SOLID, anemic model, wrapper `==` bug, Template/Strategy pattern, và `Optional` misuse — bằng code.
- [ ] Senior: Tôi refactor inheritance→composition có cost/benefit, áp dụng LSP vào violation thật, thiết kế interface 5 năm với `sealed`, tách fat interface, phòng thủ OOD bằng độ lớn của change (1 class vs 12), và model state machine làm illegal state unrepresentable.
