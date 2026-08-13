---
title: "Ôn thi Java #2: OOP & Nguyên lý Thiết kế — Junior đến Senior"
description: "OOP ở mức senior là áp dụng SOLID, composition over inheritance, và thiết kế interface quy mô lớn — không phải đọc thuộc định nghĩa. Junior gọi tên nguyên lý; senior chỉ được chỗ mỗi nguyên lý làm bạn tốn gì."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

OOP là phần phỏng vấn nơi interviewer ngừng hỏi "cái gì" và bắt đầu hỏi "tại sao". Ai cũng gọi được bốn trụ cột; một senior kể được lần kế thừa làm họ đau gần nhất và tại sao họ refactor sang composition. Bài này leo từ sách giáo khoa lên bảng trade-off.

> Mindset: junior implement interface; senior quyết định interface đó có nên tồn tại không, và nó tốn gì cho 5 năm tiếp theo của codebase.

## Junior — nền tảng

**Q1. Bốn trụ cột của OOP là gì?**
Encapsulation (che giấu state sau hành vi), Abstraction (bộc lộ ý định, không phải cơ chế), Inheritance (tái dùng bằng chuyên biệt hóa), Polymorphism (một interface, nhiều implement). Bẫy: gọi tên chúng chẳng tốn gì; áp dụng mà không tạo ra hierarchy giòn mới là kỹ năng thật.

**Q2. Khác nhau giữa abstract class và interface?**
Abstract class giữ được state và implement method; một class chỉ extend một class. Interface là hợp đồng — trước Java 8 chỉ có signature, nay có thể chứa `default` và `static` method nhưng không có field (trừ hằng `public static final`). Từ Java 8 bạn `implement` nhiều interface nhưng chỉ extend một class. Ưu tiên interface cho _type_, abstract class chỉ khi cần state/behavior chung.

**Q3. Polymorphism là gì và hoạt động ra sao trong Java?**
Subtype polymorphism: biến kiểu supertype trỏ đến mọi subtype, runtime dispatch method bị override. Dispatch là virtual mặc định — `Animal a = new Dog(); a.speak()` gọi `Dog.speak()`. Overloading _không_ phải polymorphism (giải quyết tại compile bởi signature).

**Q4. Khác nhau giữa override và overload?**
Overriding: cùng signature ở subclass, runtime-dispatched (`@Override`). Overloading: cùng tên, tham số khác kiểu, giải quyết tại compile. Bẫy kinh điển: overload với tham số `Object` vs `String` — `foo(null)` bất định và không compile nếu cả hai tồn tại.

**Q5. Hợp đồng `equals`/`hashCode` đòi gì?**
Nếu `a.equals(b)` thì `a.hashCode() == b.hashCode()`. Chiều ngược không bắt buộc nhưng hashCode bằng nhau nên hiếm. Override `equals` thì PHẢI override `hashCode`, nếu không object hỏng trong `HashMap`/`HashSet` (hai key bằng rơi vào bucket khác).

**Q6. Khác nhau giữa `abstract` và `default` method của interface?**
Abstract class method có thân, subclass có thể override hoặc không. Interface `default` cung cấp behavior class kế thừa mà không cần implement — dùng cho tiến hóa API tương thích ngược (vd `Collection.removeIf`). Override `default` ở class implement để đổi nó.

## Mid — tradeoff & điểm mù

**Q1. Khi nào inheritance là công cụ sai?**
Khi quan hệ không phải "is-a" với behavior chia sẻ ổn định. Inheritance ghép subclass vào implementation của parent mãi mãi — đổi superclass thì mọi subclass vỡ. "Fragile base class": thay đổi có vẻ an toàn ở superclass âm thầm đổi behavior subclass. Hãy với tới **composition** (wrap dependency, delegate) khi code chia sẻ là "has-a" thay vì "is-a".

**Q2. Giải thích SOLID ngắn gọn và một misuse thật của mỗi cái.**

- **S**ingle Responsibility: class đổi vì một lý do. Misuse: `UserService` vừa send email vừa ghi audit log — ba lý do để đổi.
- **O**pen/Closed: mở cho mở rộng, đóng cho sửa đổi. Misuse: `switch(type)` bạn sửa mỗi khi có type mới.
- **L**iskov: subtype phải thay thế được. Misuse: `Square extends Rectangle` rồi `setWidth` phá invariant của rectangle.
- **I**nterface Segregation: nhiều interface nhỏ hơn một interface béo. Misuse: interface `Worker` ép `cleanToilet()` lên `Programmer`.
- **D**ependency Inversion: phụ thuộc abstraction, không phải concretion. Misuse: `new MySQLRepository()` hardcode trong service.

**Q3. Khác nhau giữa `Comparator` và `Comparable`?**
`Comparable` định nghĩa thứ tự _tự nhiên_ của type (`compareTo`, một định nghĩa). `Comparator` là chiến lược sắp xếp _bên ngoài_ (truyền vào `sort`, nhiều cái tồn tại). Dùng `Comparable` cho mặc định hiển nhiên; `Comparator` khi sort tùy ngữ cảnh (theo tên, theo ngày, giảm dần).

**Q4. Tại sao getter/setter không phải encapsulation thật?**
Cặp getter/setter public không có invariant chỉ là public field với thêm bước — state vẫn mở toang. Encapsulation thật bộc lộ _hành vi_: `account.withdraw(amount)` thay vì `account.setBalance(x)`. Object bảo vệ invariant; caller yêu cầu kết quả, không mutate field trực tiếp. Anemic domain model (entity chỉ có getter/setter) là code smell.

**Q5. `==` trên object — identity vs equality, và boxed type?**
Góc OOP: hai `Integer` từ `valueOf` trong cache -128..127 so `==` true; ngoài ra false. Dựa vào `==` cho boxed type là bug tiềm ẩn. Luôn `equals` cho so sánh giá trị wrapper, và cẩn thận autoboxing allocation trong hot loop.

**Q6. Khi nào dùng `record` (Java 16+)?**
Khi type là _data carrier_: immutable, `equals`/`hashCode`/`toString` tự sinh, mọi field final. Hoàn hảo cho DTO, API response, value object. Đừng dùng `record` khi cần mutable state, inheritance, hay behavior phức tạp — đó là class. `record Point(int x, int y)` là đủ cho tọa độ; `BankAccount` không phải record.

## Senior — thiết kế & phòng thủ

**Q1. Phòng thủ composition over inheritance bằng một refactor cụ thể bạn sẽ làm.**
"Tôi lấy `ReportGenerator extends ExcelWriter` và lật nó: `ReportGenerator` giữ một `Writer` (interface) để delegate. Lý do: coupling Excel nghĩa mọi đổi định dạng spreadsheet rủi ro logic report, và ta không test đc report không có spreadsheet thật. Composition cho phép inject `FakeWriter` trong test và thêm `PdfWriter` không sửa gì `ReportGenerator`. Cái giá: một interface thêm và một constructor arg — bảo hiểm rẻ trước fragile base class."

**Q2. Một team muốn base `BaseEntity` 30 field và mọi JPA entity extend nó. Bạn nói sao?**
"Tôi sẽ tách. `BaseEntity` thật (id, version, createdAt, updatedAt, auditing) thì ổn — đó là 'is-a' với state chia sẻ ổn định. Nhưng 30 field nghĩa nó là mớ hỗn độn; subtype thừa kế column không dùng, query rộng hơn, và đổi một chỗ dội khắp nơi. Tôi đẩy 26 field domain-specific xuống entity sở hữu chúng, giữ `BaseEntity` chỉ 4 field audit. Thắng được đo: table hẹp hơn, ownership rõ hơn, coupling tình cờ ít hơn."

**Q3. Bạn thiết kế interface sao để sống sót 5 năm yêu cầu mới?**
"Tôi giữ nó nhỏ và behavioral, không phải CRUD dump. Tôi ưu tiên hierarchy `sealed` (Java 17+) khi tập subtype đóng — compiler ép xử lý mọi case trong `switch`, nên thêm subtype là compile error đến khi bạn lo xong mọi chỗ. Tôi bộc lộ capability qua interface hẹp (`Readable`, `Flushable`) thay vì một `MegaService`. Và tôi chỉ dùng `default` cho behavior thực sự tùy chọn, không bao giờ lén chèn state."

**Q4. Liskov Substitution — đi qua một violation thật và cách fix.**
"Kinh điển `Square extends Rectangle`: set width phải cũng set height để giữ hình vuông, nhưng phá hợp đồng `Rectangle` rằng width/height độc lập. Mọi code `r.setWidth(5); r.setHeight(10); assert r.area()==50` giờ nói dối. Fix: đừng model square là subtype của rectangle — trích `Shape` với `area()` và implement cả hai độc lập, hoặc dùng một `Rectangle` cấm zero/negative và biểu diễn vuông bằng w==h. Subtyping là lời hứa; giữ không được thì đừng hứa."

**Q5. Bạn có interface 12 method nhưng hầu hết caller dùng 2. Thiết kế lại?**
"Đó là vi phạm Interface Segregation. Tôi tách thành role tập trung: `Reader` (read), `Writer` (write), `Lifecycle` (start/stop), và class cụ thể implement cả ba nếu cần. Caller chỉ phụ thuộc thứ họ dùng, nên đổi `Writer` không bao giờ recompile consumer read-only. Class implement không đổi behavior; chỉ các _type_ nó bộc lộ ra mới hẹp lại. Việc này cũng làm mock trong test tầm thường — bạn stub 2 method mình quan tâm."

**Q6. Làm sao chứng minh OOD của bạn tốt, không chỉ 'sạch' trong interview?**
"Tôi chỉ vào change vừa làm và cái giá của alternative: đếm lý do mỗi class đổi, số call site vỡ khi requirement shift, và test surface. OOD tốt nghĩa feature mới chạm một class, không phải mười hai. Tôi phác dependency graph — nếu nó là DAG với abstraction ổn định ở trên và detail volatile ở dưới (dependency inversion), đó là bằng chứng. Không phải 'tôi dùng SOLID', mà 'đây là diff khi requirement đổi, và nó nhỏ'."

#### Self-check

- [ ] Junior: Tôi gọi được bốn trụ cột, abstract class vs interface, override vs overload, và hợp đồng `equals`/`hashCode`.
- [ ] Mid: Tôi bắt được fragile-base-class, misuse mỗi chữ SOLID, anemic model, và khi nào `record` hợp.
- [ ] Senior: Tôi refactor inheritance→composition có cost/benefit, áp dụng LSP vào violation thật, và phòng thủ thiết kế interface bằng độ lớn của change khi requirement shift.
