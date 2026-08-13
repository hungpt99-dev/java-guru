---
title: "Ôn thi Java #2: OOP & Nguyên lý Thiết kế — Junior đến Senior"
description: "OOP ở mức senior là áp dụng SOLID, composition over inheritance, và thiết kế interface quy mô lớn — không phải đọc thuộc định nghĩa. Junior gọi tên nguyên lý; senior chỉ được chỗ mỗi nguyên lý làm bạn tốn gì, bằng code."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

OOP là phần phỏng vấn nơi interviewer ngừng hỏi "cái gì" và bắt đầu hỏi "tại sao". Ai cũng gọi được bốn trụ cột; một senior show được code nơi kế thừa làm họ đau và refactor sửa nó. Bài này leo từ sách giáo khoa lên bảng trade-off — với example compilable.

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
// WRONG: chỉ override equals -> hai key bằng rơi vào bucket khác
class User { String id; public boolean equals(Object o){...} }  // không hashCode
Map<User,String> m = new HashMap<>();
m.put(new User("42"), "x");
m.get(new User("42"));   // trả null — bucket khác!

// RIGHT
class User {
  String id;
  public boolean equals(Object o){ return o instanceof User u && u.id.equals(id); }
  public int hashCode(){ return id.hashCode(); }   // consistent với equals
}
```

**Q6. `abstract` vs `default` method của interface?**
Abstract class method có thân subclass có thể override. Interface `default` cung cấp behavior class kế thừa không cần implement — dùng cho tiến hóa API tương thích ngược. Override `default` để đổi nó.

## Mid — tradeoff & điểm mù

**Q1. Khi nào inheritance là công cụ sai?**
Khi quan hệ không phải "is-a" với behavior chia sẻ ổn định. Inheritance ghép subclass vào implementation của parent mãi mãi — "fragile base class". Hãy với tới **composition**:

```java
// WRONG: ReportGenerator không thực sự là ExcelWriter; coupling + untestable
class ReportGenerator extends ExcelWriter {
  void generate() { /* logic report rối với formatting spreadsheet */ }
}
// RIGHT: giữ một Writer, delegate; inject FakeWriter trong test
class ReportGenerator {
  private final Writer writer;            // interface
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
// WRONG (anemic): state mở toang, invariant không ép
class Account { public BigDecimal balance; }
account.balance = account.balance.subtract(fee);  // có thể âm!

// RIGHT: behavior guard invariant
class Account {
  private BigDecimal balance;
  void withdraw(BigDecimal amt) {
    if (amt.signum() <= 0 || amt.compareTo(balance) > 0) throw new IllegalArgumentException();
    balance = balance.subtract(amt);
  }
}
```

**Q5. `==` trên boxed type — bug tiềm ẩn?**
`Integer.valueOf(42) == Integer.valueOf(42)` là `true` (cache -128..127) nhưng `Integer.valueOf(200) == Integer.valueOf(200)` là `false`. Luôn `equals` cho wrapper:

```java
Integer a = 200, b = 200;
System.out.println(a == b);       // false — object khác nhau
System.out.println(a.equals(b));   // true
```

**Q6. Khi nào dùng `record` (Java 16+)?**
Cho data carrier immutable — `equals`/`hashCode`/`toString` tự sinh. Đừng dùng cho mutable state hoặc inheritance. `record Point(int x, int y)` hơn hẳn class viết tay 40 dòng.

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

#### Self-check

- [ ] Junior: Tôi gọi được bốn trụ cột, abstract class vs interface, override vs overload (với `null` ambiguity), và hợp đồng `equals`/`hashCode` — bằng code.
- [ ] Mid: Tôi bắt được fragile-base-class, misuse mỗi chữ SOLID, anemic model, wrapper `==` bug, và khi nào `record` hợp — bằng code.
- [ ] Senior: Tôi refactor inheritance→composition có cost/benefit, áp dụng LSP vào violation thật, thiết kế interface 5 năm với `sealed`, tách fat interface, và phòng thủ OOD bằng độ lớn của change (1 class vs 12).
