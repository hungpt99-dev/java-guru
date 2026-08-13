---
title: "Phỏng vấn Senior Java: OOP và nguyên lý thiết kế"
description: "OOP cấp senior là áp dụng SOLID, composition over inheritance, và thiết kế interface khi scale — không phải đọc định nghĩa."
pubDatetime: 2026-08-10T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

Lập trình hướng đối tượng là chiếc vé vào cửa. Junior đọc thuộc "class là một bản thiết kế" và "SOLID là năm chữ cái." Senior coi thiết kế như **kỹ thuật kết cấu**: mọi quyết định đều có đường truyền tải lực, một kiểu hỏng hóc, và một cái giá phải trả — và buổi phỏng vấn là bài kiểm tra xem bạn có biện minh được cho những bức tường mà bạn chọn để lại không.

> Tư duy: khi phỏng vấn viên nói "team của anh cần một tính năng mới," câu trả lời senior không bao giờ là "thêm một nhánh `if`." Nó là "trục thay đổi này nằm ở đâu — và tôi dựng thứ gì mà mai tôi không phải sửa?" Định nghĩa thì qua cửa junior; **quyết định dưới ràng buộc** mới qua vạch senior.

## Thang câu hỏi phỏng vấn (Junior → Mid → Senior)

> Tự drill to tiếng. Junior = "bạn có biết khái niệm"; Mid = "bạn có biết tradeoff"; Senior = "bạn có thể bảo vệ quyết định dưới áp lực, kèm một con số và một postmortem."

### Junior — nền tảng

- **Q: Mỗi chữ cái SOLID nghĩa là gì?**
  A: S — Single Responsibility, O — Open/Closed, L — Liskov Substitution, I — Interface Segregation, D — Dependency Inversion. Junior đọc thuộc; senior chỉ được chỗ code vi phạm một cái và cái giá sửa nó.

- **Q: Khác nhau giữa interface và abstract class?**
  A: Interface là một hợp đồng thuần túy (không state, đa kế thừa); abstract class giữ được state và cung cấp implementation một phần (đơn kế thừa). Dùng interface để định nghĩa một vai trò; abstract class để share code giữa anh em gần nhau.

- **Q: Khác nhau giữa inheritance và composition?**
  A: Inheritance = "is-a" (share implementation của parent); composition = "has-a" (giữ một instance và delegate). Composition thường được ưu tiên vì linh hoạt và ít coupled hơn.

- **Q: Polymorphism trong một câu?**
  A: Một interface, nhiều implementation — caller viết against abstraction và runtime chọn behavior cụ thể (method override, hoặc interface dispatch).

- **Q: Bốn trụ cột OOP lại — và `private` thuộc về cái nào?**
  A: Encapsulation, abstraction, inheritance, polymorphism. `private`/`protected` là encapsulation — giấu state sau một mặt điều khiển để thay đổi nằm local.

### Mid — tradeoff & bẫy

- **Q: Tại sao "favor composition over inheritance" hơn một khẩu hiệu?**
  A: Inheritance coupling bạn vào implementation của parent và gãy khi requirement cross-cut (một class cần hai behavior từ hai parent — nhưng Java chỉ đơn kế thừa). Composition cho bạn swap behavior lúc runtime qua dependency inject. Bẫy: một cây kế thừa sâu nơi mỗi thay đổi lan cả lên lẫn xuống.

- **Q: Nêu một Open/Closed violation cụ thể và cách sửa.**
  A: Một `InvoiceCalculator` với `if (type == PDF) … else if (type == XLSX)` — mỗi format mới lại sửa class (không đóng cho modification). Sửa: một interface `Renderer` + một class mỗi format, chọn bằng một map. Thêm format giờ là thêm class, không sửa code cũ.

- **Q: Liskov violation người ta thực sự ship là gì?**
  A: Một subclass tăng cường precondition hoặc yếu đi postcondition — vd `Square extends Rectangle` nhưng `setWidth` cũng phải set height, phá contract rectangle caller依赖. Sửa thường là "đừng ép IS-A" — model chúng như sibling dưới một abstraction chung.

- **Q: "Fat interface" có vấn đề gì, sửa thế nào?**
  A: Một interface 12 method ép mọi implementer stub behavior nó không cần (cái `RemoteControl` có `startCar` trên `ToyCar`). Sửa: tách thành role interface (`Printable`, `Scannable`) để client chỉ dependency thứ nó dùng — Interface Segregation.

- **Q: Dependency Inversion — khác gì "depend on abstractions"?**
  A: DIP nói module cao không nên dependency module thấp; cả hai dependency abstraction, và binding xảy ra ở rìa (constructor injection). Lợi: bạn swap repo Postgres thành in-memory trong test mà không động service. Thiếu nó, business logic hàn chết vào DB driver.

### Senior — thiết kế & bảo vệ

- **Q: "Thêm CSV export cho report." Code đi đâu, và gì bạn từ chối làm?**
  A: Từ chối cái `if/else` trong class cũ (phạm OCP). Thêm interface `ReportExporter`, implementation `CsvExporter`, register nó, rồi inject/select by format. Dấu hiệu senior: tôi biết _trục thay đổi_ này là gì (output format) và cô lập nó để format sau là additive, không xâm lấn.

- **Q: Bạn kế thừa một cây kế thừa 6 tầng không ai hiểu. Làm gì — viết lại hay để đó?**
  A: Đừng viết lại ngày một. Đầu tiên, characterize behavior bằng characterization test để refactor không break ngầm. Rồi flatten dần phần rủi ro thành composition, sau các test đó, từng subclass một. Big-bang rewrite code đang chạy là cách bạn tạo ra một incident tệ hơn.

- **Q: Khi nào inheritance thực sự đúng hơn composition?**
  A: Khi có một "is-a" thực sự với implementation shared _không_ phân kỳ — vd `BaseEntity` với id/version/audit field, hoặc Template Method mà skeleton ổn định và chỉ các bước thay đổi. Tha thứ coupling vì abstraction ổn định. Nêu trường hợp composition sẽ thành ceremony.

- **Q: Bảo vệ "interface cho mọi dependency" — và đâu nó thành cargo-cult.**
  A: Một interface mỗi dependency tuyệt vời khi có hai implementation hoặc bạn test against một fake. Nó thành cargo-cult khi một class có một caller và zero alternate implementation — bạn thêm một lớp indirection vô ích. Judgment senior: introduce seam khi implementation thứ hai (hoặc test) thực sự xuất hiện, không phải phòng trước.

- **Q: Đi qua một thiết kế "follow SOLID" nhưng kinh khủng khi làm việc.**
  A: Một `UserService` bị xé thành 14 class nhỏ sau 14 interface — mỗi thay đổi động 6 file, và các "abstraction" chỉ có một implementation (ceremony, không phải engineering). Bài học: SOLID phục vụ changeability và testability, không phải số lượng file. Tôi sẽ collapse các single-impl interface và giữ chỉ những seam thực sự đáng.

#### Tự kiểm tra

- [ ] Junior: chữ cái SOLID, interface vs abstract class, inheritance vs composition, polymorphism, `private` thuộc về đâu.
- [ ] Mid: vì sao composition-over-inheritance, một OCP violation thật + sửa, một LSP break đã ship, sửa fat-interface, DIP vs "depend on abstractions".
- [ ] Senior: code mới đi đâu không phạm OCP, refactor an toàn một cây sâu, khi nào inheritance đúng, interface-cargo-cult, postmortem một thiết kế SOLID-mà-awful.

## 1. SOLID — bản áp dụng thực tế, và các cái bẫy

"Nêu định nghĩa SOLID" chỉ là màn sàng lọc junior. Senior thì bị hỏi cách **áp dụng**, rồi bị ép bảo vệ những chỗ mà áp dụng theo sách vở là sai. Đi qua cả năm, nhưng hãy sẵn sàng đào sâu ba cái thực sự cắn trên production: Open/Closed, Dependency Inversion, và Liskov.

### Open/Closed — trục thay đổi nằm ở đâu

Sách giáo khoa nói "mở cho extension, đóng cho modification." Câu hỏi thật là **trục nào thay đổi nhanh nhất** — OCP là một chiến lược cho phần không ổn định của hệ thống, không phải đạo luật toàn cục. Áp nó trước tiên ở nơi bạn thêm case mới mỗi sprint:

```java
// SAI — mỗi phương thức thanh toán mới là một nhánh nữa trong tháp if/else này.
// Thêm Apple Pay đồng nghĩa với sửa pay() — sửa vào code đang chạy tốt, một
// cuộc xung đột merge trên cùng mấy dòng code mỗi sprint, một mặt diện tích
// regression lớn dần theo từng tính năng.
PaymentResult pay(Order order) {
    if (order.method() == PaymentMethod.CARD)        return cardGateway.charge(order);
    else if (order.method() == PaymentMethod.BANK)   return bankGateway.transfer(order);
    else if (order.method() == PaymentMethod.WALLET) return walletGateway.pay(order);
    throw new UnsupportedOperationException(order.method().name());
}

// ĐÚNG — cái registry chính là điểm mở rộng. Một phương thức mới = một class
// mới cộng một dòng đăng ký. Bảng phân phối thì ổn định; tập các strategy
// thì lớn dần.
Map<PaymentMethod, PaymentHandler> handlers = Map.of(
    PaymentMethod.CARD,   new CardHandler(cardGateway),
    PaymentMethod.BANK,   new BankHandler(bankGateway),
    PaymentMethod.WALLET, new WalletHandler(walletGateway)
);
PaymentResult pay(Order order) {
    return handlers.get(order.method()).handle(order);
}
```

> Phỏng vấn viên thực sự câu gì: "bọn anh sắp thêm phương thức thanh toán thứ 4 — dẫn tôi qua từng bước thay đổi." "Thêm một `else if`" thì trượt phép thử OCP. "Registry thêm một entry; class mới implement cái contract" thì qua — rồi họ lập tức hỏi câu phản pháo bên dưới.

**Bẫy ngược — OCP không miễn phí.** Một registry gồm toàn strategy một-method chỉ là nghi thức rỗng nếu tập này không bao giờ lớn lên. Và pattern matching đã đổi cả bài toán: với một **sealed enum**, một `switch` đầy đủ cũng _đóng_ cho modification — thêm một giá trị mà không xử lý nó thì build vỡ thay vì runtime vỡ:

```java
// ĐÚNG (phương án thay thế) — sealed domain: compiler buộc phủ kín mọi case.
// Thêm PaymentMethod.BITCOIN làm build fail cho tới khi mọi switch xử lý nó.
PaymentResult pay(Order order) {
    return switch (order.method()) {
        case CARD   -> cardGateway.charge(order);
        case BANK   -> bankGateway.transfer(order);
        case WALLET -> walletGateway.pay(order);
    };
}
```

Dấu hiệu senior là gọi tên hai chế độ và chọn một cách có chủ đích. **Closed world** (sealed + exhaustive switch): domain hiếm khi đổi và đổi toàn bộ cùng lúc, và bạn muốn bằng chứng ở mức compile-time rằng mình không sót case nào. **Open world** (strategy registry, `ServiceLoader`, plugin class): bên thứ ba hoặc runtime thêm biến thể một cách độc lập, và exhaustiveness ở mức compile-time chỉ là một lời nói dối. Dựng cả một framework plugin cho một enum hai case chính là cái over-engineering mà phỏng vấn viên chăm chăm săn.

### Dependency Inversion — ai là chủ của cái interface

Dependency **Injection** là đưa một dependency vào. Dependency **Inversion** là quyết định **ai viết ra cái hợp đồng**. Hai thứ không giống nhau, và gộp chúng làm một là câu trả lời trung bình phổ biến nhất.

Cái khung ổ-cắm: ổ cắm trên tường là một chuẩn **thuộc về tòa nhà**, và mọi thiết bị phải vừa với nó — cái đèn không được tự phát minh ra loại ổ riêng rồi bắt tường đổi theo. DIP cũng vậy. `OrderService` (bên tiêu thụ, tức tòa nhà) khai báo `PaymentGateway` (cái ổ). SDK của Stripe là thiết bị — một **adapter** implement cái port của bạn. Đó là lý do nó được gọi là _inversion_: module cấp cao định nghĩa abstraction mà module cấp thấp phải implement, chứ không phải ngược lại.

```java
// SAI — bên tiêu thụ vươn tay ra thế giới và chộp một thứ cụ thể.
// Domain đơn hàng giờ phụ thuộc SDK của Stripe — lúc compile, lúc test,
// và mãi mãi.
class OrderService {
    private final StripeGateway gateway = new StripeGateway();
    PaymentResult pay(Order order) { return gateway.charge(order); }
}

// ĐÚNG — bên tiêu thụ sở hữu port; adapter tuân theo nó.
// Stripe có thể biến mất ngay tối nay mà domain không phải recompile.
class OrderService {
    private final PaymentGateway gateway;
    OrderService(PaymentGateway gateway) { this.gateway = gateway; }
    PaymentResult pay(Order order) { return gateway.charge(order); }
}

interface PaymentGateway { PaymentResult charge(Order order); }
class StripeGatewayAdapter implements PaymentGateway { /* delegate sang SDK */ }
```

Đây là _lý do_ Spring tồn tại — không phải để "làm DI cho dễ," mà để nối adapter với port sao cho domain được sạch. Nhưng phần thưởng thật không nằm ở framework, mà nằm ở **khe hở cho test**:

> Chuyện production: `OrderService` tự `new StripeGateway()` trong constructor, nên nhánh retry-khi-timeout không unit-test được — test nào cũng phải đập vào sandbox của Stripe hoặc patch tĩnh một chỗ nào đó. Đó không phải bài toán testing, đó là một vi phạm DIP đang hiện hình thành bài toán testing. Ngày dependency trở nên injectable, cái integration test rởm kia thành một unit test ba dòng với một fake.

**Bẫy phía bên kia — bùng nổ interface.** DIP không có nghĩa "móc interface ra cho mọi class." Một interface `UserService` với đúng một implementation, một bên tiêu thụ, và không có test double chỉ là nghi thức có thuế: mỗi thay đổi đụng hai file, và cái interface là một lời nói dối chờ ngày lệch pha với impl. Quy tắc thật lòng: một abstraction phải **tự nuôi sống mình** — một implementation thứ hai, một test double, hoặc một ranh giới hợp đồng với hệ thống bên ngoài. Không có thứ đó thì viết class cụ thể và inject dependency của nó.

### Liskov — cái thực sự nổ trên production

LSP là nơi định nghĩa chết, vì vi phạm vô hình trong code review và phát nổ lúc runtime bên trong một `HashMap`. Hợp đồng: một subtype phải dùng được ở mọi nơi mà supertype được hứa hẹn — **precondition không được tăng thêm, postcondition không được nới lỏng, invariant phải được giữ.** Hai ví dụ đúng chuẩn production.

**Bẫy đối xứng của `equals`.** Thêm state vào subclass và `equals` lặng lẽ trở nên bất đối xứng, làm hỏng hành vi `Set`/`Map`:

```java
class Point {
    final int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
    @Override public boolean equals(Object o) {
        return o instanceof Point p && p.x == x && p.y == y;
    }
    @Override public int hashCode() { return 31 * x + y; }
}

class ColoredPoint extends Point {
    final Color color;
    ColoredPoint(int x, int y, Color c) { super(x, y); this.color = c; }
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint)) return false;   // ← bất đối xứng
        return super.equals(o) && ((ColoredPoint) o).color == color;
    }
}

Point p = new Point(1, 2);
ColoredPoint cp = new ColoredPoint(1, 2, Color.RED);
p.equals(cp);   // true — Point bỏ qua màu
cp.equals(p);   // false — ColoredPoint đòi màu → đối xứng vỡ
```

```java
// ĐÚNG — composition thay vì inheritance: ColoredPoint KHÔNG phải là một
// Point, nó CÓ một Point. Không có subtype, không vỡ hợp đồng, không bất
// ngờ trong một HashSet.
record ColoredPoint(Point point, Color color) {}
```

**Covariance và contravariance.** LSP rò rỉ vào cả hệ thống type. Mảng **covariant và reified** — `Object[]` có thể chứa một `String[]`, và lỗi chỉ hiện lúc runtime:

```java
Object[] objs = new String[10];
objs[0] = 42;                 // compile: ngon → runtime: ArrayStoreException
```

Generics thì **invariant** — compiler chặn cùng một bug trước khi nó ra mắt:

```java
List<String> words = new ArrayList<>();
List<Object> objects = words;               // compile error — invariant
List<? extends Object> any = words;         // covariance qua bounded wildcard (chỉ đọc)
List<? super String> sink = new ArrayList<Object>();  // contravariance (chỉ ghi)
```

Nhớ **PECS** — producer `extends`, consumer `super` — và nói thẳng ra rằng `List<Dog>` không phải là `List<Animal>` dù `Dog` là một `Animal`: quan hệ "is-a" trên type không truyền sang các generic container, vì hợp đồng của một container có thể biến đổi ("mày có thể thêm bất kỳ `Animal` nào") sẽ bị subtype làm cho yếu đi.

**Subtype ném exception.** Một subclass override method chỉ để ném — "tôi chỉ để `add()` ném cho cái collection đặc biệt này" — là vi phạm LSP vì nó thắt chặt precondition. Hình dạng đúng là một **decorator** (`Collections.unmodifiableList`) mà fail nhanh và to tiếng, không phải một subtype giả vờ có thể biến đổi. Phỏng vấn viên câu bằng: "làm sao anh có một list bất biến mà không vỡ hợp đồng?"

### Single Responsibility và Interface Segregation — cáo phó của God object

Hai cái này là một ý ở hai mức hạt khác nhau: **SRP nói về class, ISP nói về interface, và cả hai đều xoay quanh "một trục thay đổi duy nhất."** Một `OrderService` 500 dòng vừa là repository, vừa là validator, vừa là orchestrator, vừa là mapper thì đổi vì bốn lý do khác nhau và không thể suy luận nổi. Một interface `UserService` 40 method buộc mọi implementer phải stub 35 method — và tệ hơn, buộc mọi _caller_ phải nhìn thấy 40 khả năng mà nó không được phép dùng.

```java
// SAI — một interface béo ú. Mọi implementer stub 35 method;
// mọi caller phụ thuộc 40 khả năng.
interface UserService {
    User findById(long id);
    void update(User u);
    byte[] exportAuditReport(Period p);      // thứ này ở đây làm gì?
    void sendWelcomeEmail(long id);          // hay cái này?
    List<User> search(String q, Page p);
    // ... thêm 35 cái nữa
}

// ĐÚNG — role interface. Một caller phụ thuộc đúng lát cắt nó cần; một class
// implement nhiều role và không method nào là gánh nặng chết.
interface UserReader   { User findById(long id); }
interface UserWriter   { void update(User u); }
interface AuditExporter { byte[] exportAuditReport(Period p); }

class UserServiceImpl implements UserReader, UserWriter, AuditExporter { ... }
```

> Phỏng vấn viên thực sự câu gì: "đây là một service 400 dòng — làm sao anh biết nó sai trước khi đọc tới dòng 300?" Câu trả lời senior không phải cái interface; mà là gọi tên **ba trục thay đổi** trong nó. Nếu kể ra được thì SRP không chỉ là khẩu hiệu.

## 2. Composition over inheritance — fragile base class ngoài đời thực

"Vì sao favor composition?" Câu trả lời junior là "inheritance xấu." Câu trả lời senior là một vụ việc cụ thể: một thay đổi ở class cha lặng lẽ làm vỡ năm mươi subclass vốn đã đặt giả định về `super` mà class cha chưa bao giờ hứa hẹn.

Vấn đề fragile base class là cấu trúc, không phải phong cách. Inheritance gắn bạn vào **implementation** của cha, không phải hợp đồng của nó: bạn thừa kế các field `protected`, bạn gọi `super`, và method của cha gọi các hook (`afterPut`) theo một thứ tự mà subclass không hề viết ra. Class cha không thể đổi nội bộ mà không đặt rủi ro lên mọi subclass, và subclass không thể suy luận về hành vi của chính mình mà không đọc code cha. Chúng bị hàn dính vào nhau.

```java
// SAI — một base class đầy rẫy coupling ẩn. MetricsCounter tin rằng afterPut
// được gọi đúng một lần mỗi put, đúng thứ tự. Bản phát hành tới của
// AbstractCache thêm hook thứ hai, đảo thứ tự gọi, hoặc bỏ qua afterPut khi
// dedup — và MetricsCounter lặng lẽ đếm sai. Chẳng code của ai "bị đổi" cả.
abstract class AbstractCache {
    private final Map<String, byte[]> store = new HashMap<>();
    public final void put(String k, byte[] v) {
        store.put(k, v);
        afterPut(k, v);
    }
    protected void afterPut(String k, byte[] v) {}
}

class MetricsCounter extends AbstractCache {
    @Override protected void afterPut(String k, byte[] v) { metrics.increment("puts"); }
}

// ĐÚNG — hành vi được lắp ráp, không được thừa kế. Decorator bọc delegate
// và caller tự chọn chồng lớp. Không subclass nào phụ thuộc nội bộ của
// class khác; mỗi hành vi test độc lập được.
interface Cache { void put(String k, byte[] v); }

class MetricCache implements Cache {
    private final Cache delegate;
    MetricCache(Cache delegate) { this.delegate = delegate; }
    public void put(String k, byte[] v) {
        long start = System.nanoTime();
        delegate.put(k, v);
        metrics.record("cache.put.ns", System.nanoTime() - start);
    }
}

Cache cache = new MetricCache(new TtlCache(new MemCache()));
```

Inheritance còn vỡ ở cấp hợp đồng: `ColoredPoint extends Point` (mục 1) là một bài toán inheritance đang đội lốt bài toán `equals` — thêm state vào subclass là con đường phổ biến nhất để vi phạm LSP mà không hề hay biết. Và vụ `Stack extends Vector` là case kinh điển trong sách giáo khoa: một stack _không phải_ là một vector, và thừa kế `add(int, E)` cho phép caller chèn vào giữa stack. "Is-a" phải đứng vững ở thế giới thật, chứ không chỉ ở sơ đồ UML.

**Khi nào inheritance là đúng** — nói to ra, đây là điểm khác biệt. Inheritance là công cụ, không phải tội lỗi. Dùng nó khi subclass là một chuyên biệt hóa thật sự cung cấp **hook, không phải hành vi**: Template Method. `JdbcTemplate` để bạn nạp `RowMapper`, `AbstractMessageConverter` của Spring để subclass điền `supports`/`writeInternal`, `HttpServlet` để override `doGet`. Class cha nắm luồng chảy (bộ xương) và subclass lấp các khe, và hợp đồng của cha được phát biểu rõ ràng. Failure mode nằm ở chiều ngược lại: một subclass _override cả method_ rồi gọi `super` lên nó là đang đánh nhau với cha, và đó chính là mùi hôi.

**Cái giá thật của composition.** Đừng bán quá tay: wrapping đồng nghĩa với boilerplate delegation, stack trace sâu hơn, và một đồ thị runtime khó lần theo ("trong năm cái decorator này, đứa nào làm rớt cache line của tôi?"). Đánh đổi của senior là chọn mức hạt — compose ở chỗ trục thay đổi, delegate ở chỗ luồng chảy cố định, và không bao giờ decorate chỉ để cho có.

## 3. Thiết kế interface khi scale — polymorphism ra ngoài sách giáo khoa

Junior thấy interface là "một khuôn mẫu class." Senior thấy interface là một **hợp đồng có chủ** — và Java hiện đại đã đổi thứ mà hợp đồng ấy có thể diễn đạt.

### Sealed types — closed world, được compiler ép buộc

Trước Java 17, polymorphism mở theo mặc định: bất cứ ai cũng thêm được một `Shape`, và chuỗi `instanceof` (hoặc tháp `if/else`) cứ lớn dần. **Sealed interface** (Java 17) khóa thế giới lại một cách có chủ đích, và **pattern matching** (Java 21) khiến việc phân phối trở nên đầy đủ và được kiểm tra lúc compile:

```java
sealed interface OrderEvent permits OrderPlaced, OrderPaid, OrderCancelled {}
record OrderPlaced(Long orderId, Instant at) implements OrderEvent {}
record OrderPaid(Long orderId, Money amount) implements OrderEvent {}
record OrderCancelled(Long orderId, String reason) implements OrderEvent {}

String label(OrderEvent e) {
    return switch (e) {
        case OrderPlaced p    -> "placed at " + p.at();
        case OrderPaid p      -> "paid " + p.amount();
        case OrderCancelled c -> "cancelled: " + c.reason();
        // không cần default — compiler chứng minh switch đã đầy đủ
    };
}
```

`label` phân phối theo **hình dạng** (nó là record nào), chứ không theo một field `type` — và compiler loại bỏ bug "sót mất một case" mà một enum `type` cộng `if/else` luôn mang theo. Sealed hierarchy + records + pattern matching là câu trả lời của Java cho algebraic data types, và nó đánh bại cả kiểu phân phối stringly-typed lẫn cái registry strategy-như-nghi-thức trong phần lớn trường hợp.

Sự phân biệt của senior (lặp lại mục 1): **sealed = closed world, đại số ổn định, exhaustiveness ở compile-time.** Strategy/plugin/`ServiceLoader` = **open world, biến thể cắm được, đăng ký lúc runtime.** Khi phỏng vấn viên nói "thiết kế phần xử lý event," điểm khác biệt nằm ở _ai_ được phép thêm biến thể và _khi nào_ phải bắt được lỗi — lúc compile hay lúc deploy.

### Records, value objects, và hợp đồng equality

Một `record` (Java 16+) là class mà hợp đồng danh tính là **toàn bộ các component** — `equals`/`hashCode`/`toString`/accessor được suy ra từ danh sách component, `final` ngay từ lúc dựng. Điều đó khiến record trở thành ngôi nhà tự nhiên cho value objects, và value objects có hành vi _thuần khiết_ thì hoàn toàn đúng:

```java
record Money(long cents) {
    Money { if (cents < 0) throw new IllegalArgumentException("negative money"); }  // invariant ở ngay constructor
    Money add(Money o)  { return new Money(cents + o.cents); }
    boolean isNegative() { return cents < 0; }
    @Override public String toString() { return "%d.%02d".formatted(cents / 100, cents % 100); }
}
```

Sắc thái senior về "record mang logic": cái smell thật là một record điều phối các quy tắc nghiệp vụ **có trạng thái** hoặc xuyên đối tượng. Một `Money` tự kiểm tra invariant và tự định nghĩa số học của mình là record _tốt_; một event `OrderPlaced` vươn tay vào repository là record _xấu_. Giữ việc điều phối trong service; giữ giá trị nằm trong value.

Và cái đánh đổi người ta hay bỏ sót: equality của record theo **mọi field**, đó là mặc định đúng cho ngữ nghĩa value và mặc định sai cho entity. Một `Order` "là cùng một order" theo `id` dù field có đổi **không được** làm record — equality của nó phải viết tay theo business key, nếu không nó sẽ làm hỏng `Set` và `Map`. Cùng bài học LSP như `ColoredPoint`, nhìn từ chiều ngược lại.

## 4. Tell, don't ask — encapsulation có hóa đơn database

"Tell, don't ask" nghe như lời khuyên phong cách. Ở cấp senior nó là một nguyên tắc **hiệu năng và đúng đắn**, vì một getter không miễn phí — nó có thể là một lazy-loaded proxy phát một câu query.

Feature envy là triệu chứng: một caller thò tay xuyên qua aggregate, kéo collection ra, rồi bụng nó tính toán bằng những thứ đó. Đó vừa là smell thiết kế, vừa là một nhà máy sản xuất N+1 query.

```java
// SAI — caller thò tay VÀO order và tính toán bằng nội tạng của nó.
// order.getItems() là một collection lazy-loaded: nó bắn một SELECT mỗi
// order. 1.000 order → 1.001 query. Với 5 dòng trong test thì ngon; ngoài
// prod với một triệu dòng thì chết — và không một query nào trông chậm,
// nên nó sống sót qua mọi slow-query log.
long totalItems = 0;
for (Order order : orders) {
    totalItems += order.getItems().size();
}

// ĐÚNG — aggregate tự trả lời câu hỏi. Một ý định, không thò tay vào trong.
long totalItems = 0;
for (Order order : orders) {
    totalItems += order.getLineItemCount();
}
```

Nhưng "tell, don't ask" một mình là chưa đủ — một `getLineItemCount()` ngây thơ vẫn có thể lazy-load cả collection. Cách sửa của senior là quyết định **tầng nào trả lời câu hỏi**. Database đếm nhanh hơn JVM load:

```sql
-- cùng câu hỏi, được database trả lời trong một round trip.
-- Một point lookup là một cú đi dọc B+tree: 3–4 lần đọc page, ~100 ns mỗi
-- lần khi các page đang nóng trong buffer pool → dưới một mili-giây. Bản
-- N+1 phía trên là 1.001 round trip mạng × ~1 ms mỗi trip ≈ một giây latency
-- trọn vẹn mà không hề xuất hiện trong bất kỳ slow-query log đơn lẻ nào.
SELECT o.id, COUNT(li.id)
FROM orders o
LEFT JOIN line_items li ON li.order_id = o.id
GROUP BY o.id;
```

```java
// ĐÚNG — project đúng cái DTO bạn cần; đừng load graph entity.
@Query("select new OrderSummary(o.id, o.customerName, size(o.items)) from Order o")
List<OrderSummary> findAllSummaries();
```

> Phỏng vấn viên thực sự câu gì: họ đưa bạn một vòng `for` gọi `getItems()` và hỏi "cái này bắn bao nhiêu query, và thời gian đi vào đâu?" Câu trả lời senior nối smell thiết kế (feature envy, Law of Demeter) với một con số cụ thể (1.001 query, ~1 s thêm vào) rồi sửa ở _tầng_, chứ không sửa vòng lặp.

### Tài nguyên đứng sau mỗi method call

Mỗi `repository.findById` là một khoản đòi trên một tài nguyên có hạn — một slot connection-pool và một worker thread — nên thiết kế interface cũng có hóa đơn concurrency. Cân pool theo định luật Little, giống hệt cách bạn cân thread pool: `pool_size = throughput × per-call time`. Ở 2.000 req/s với thời gian DB trung bình 25 ms, đó là 50 connection — không phải "200 vì máy có 64 core." Một thiết kế chạy theo getter xuyên qua các aggregate tiêu pool nhanh gấp mười lần một thiết kế trả lời một câu hỏi aggregate mỗi call. Cái N+1 phía trên không chỉ chậm — nó là một vector đốt cháy connection-pool, vì mỗi lazy load giữ một connection trong lúc nó query lại. Tài nguyên có hạn mới là chủ thể thật; chuỗi getter chỉ là cách bạn tiêu nó quá tay.

## 5. Bẫy functional Java — khi nào OOP, khi nào functional, và nó tốn bao nhiêu

"OOP chết rồi, functional programming muôn năm" là một lá cờ đỏ. "OOP muôn đời, stream khó đọc" cũng vậy. Lập trường senior: **chúng là công cụ khác nhau cho các invariant khác nhau.**

- **Stream / composition functional** cho **transform** dữ liệu — pipeline trên collection, map/filter/reduce — nơi dữ liệu chỉ tồn tại tạm và không có trạng thái nào cần bảo vệ.
- **OOP / encapsulation** cho **trạng thái giàu hành vi** — aggregate, tiền, đơn hàng, cache — nơi invariant ("một order không thể được trả tiền hai lần," "một connection thì hoặc mở hoặc đóng") sống sau các method, chứ không phơi ra field.

Anti-pattern phải gọi tên là **anemic domain model**: entity bị rút xuống còn getter/setter và mọi logic bị bốc lên các class `*Service`. Nó tiện cho JPA và dễ chịu cho người mới, nhưng các invariant hết nơi cư trú — `setStatus(CANCELLED)` chạy ngon lành trên một order đã ship, `balance` có thể âm, và các "luật" rải rác mười hai service. Nước đi senior không phải "làm mọi thứ giàu lên" (persistence mapping sẽ chống lại bạn); mà là **bảo vệ những chuyển tiếp trạng thái quan trọng**:

```java
// SAI — invariant không sống trong code của ai. Caller nào cũng làm được:
order.setStatus(OrderStatus.CANCELLED);
order.setPaidAt(null);

// ĐÚNG — chuyển tiếp là một method biết ép luật.
order.cancel("out of stock");   // ném nếu đã ship, set cancelledAt
order.pay(amount);              // ném nếu đã trả
```

### Phong cách functional thực sự tốn bao nhiêu — những con số

Thời thượng là nói "stream là miễn phí." Gần đúng — và đây là lý do, kèm các con số phỏng vấn viên nể:

```
Pipeline này cấp phát: một Stream, các lambda, một Spliterator, một
ArrayList accumulator. Nghe thì phí phạm — nhưng cấp phát trên JVM hiện đại
là một cú bump con trỏ TLAB (không khóa, không system call), nên JVM thoải
mái cấp phát hàng chục triệu object dùng một lần mỗi giây. Escape analysis
cho JIT scalar-replace các object sống ngắn, và young-gen GC chỉ copy phần
~10% sống sót, nên pause bị chi phối bởi số live byte được copy, không phải
bởi các phép transform. Kết luận: một chuỗi stream sạch gần như miễn phí so
với ngân sách pause. Cái thuế GC bạn thực sự sợ đến từ những object escape
vào các collection sống lâu — tức là một thiết kế *giữ lại* thứ mà một
transform đã sinh ra.
```

Cái giá thật của abstraction không phải GC — mà là **dispatch**. Một call site monomorphic (một kiểu receiver cụ thể) được JIT inline, và "interface call" chẳng tốn gì. Một site **megamorphic** (một hot loop phân phối qua nhiều implementer — ví dụ cái strategy registry ở mục 1) tốn ~3–5 ns mỗi call **và chặn việc inline phần thân**, có thể tốn gấp 10 lần chính cái dispatch. Đó là lý do một interface 40 implementer cũng là bài toán JIT, chứ không chỉ là smell thiết kế. `-XX:+PrintInlining` là công cụ chứng minh điều đó. "Interface call tốn bao nhiêu?" → "inline được: ~miễn phí; megamorphic: vài ns cộng một cơ hội tối ưu hóa bị bỏ lỡ — và cái cơ hội bị bỏ lỡ mới là hóa đơn thật."

Và một bẫy thiết kế API phải nêu: `Optional`/`Stream` thay thế cho một hợp đồng rõ ràng. `Optional<List<T>>` là một lời nói dối ở mức type — một list rỗng đã mã hóa "không có" rồi — và `null` trả về là nơi giấu bug. Kiểu trả về _là_ một phần của API; thiết kế nó như cách bạn thiết kế interface. Làm cho trường hợp rỗng trở nên hiển hiện, không bao giờ mập mờ.

## 6. Các failure mode của "clean code" trên production

Cái bẫy senior sâu nhất là áp dụng nguyên lý thiết kế quá hăng hái đến mức chính chúng trở thành sự cố. Phỏng vấn viên mê phần này vì ai cũng từng chứng kiến hậu quả.

- **Premature abstraction.** Cái tháp ba tầng cho một phép tra cứu: `Controller → Service interface → Service impl → Mapper interface → Mapper impl → Repository`, mà cái service có một method và một caller. Mỗi thay đổi giờ đụng năm file, và các interface là những lời nói dối. Quy tắc nhớ nhanh: **một abstraction phải tự nuôi sống mình** — một consumer, không test double, không implementation thứ hai trong lộ trình thì xóa interface, chứ đừng thêm tầng thứ sáu. Thêm abstraction là khoản nợ bạn vay, không phải đức hạnh bạn ban phát.

- **Vòng phụ thuộc như một smell kiến trúc.** Hai package import lẫn nhau — `orders` cần `payments`, `payments` cần `orders` — không phải bài toán cấu hình Spring, mà là một ranh giới bị thiếu. Cách sửa là DIP ở cấp _module_: khái niệm cấp cao hơn (domain) khai báo một port, và cái còn lại implement nó. Nếu bạn nghe ai đó mô tả "bọn em chữa vòng phụ thuộc bằng Spring `@Lazy`," vòng lặp vẫn còn đó — bạn chỉ không nhìn thấy nó nữa.

- **Invariant không được canh giữ.** Mặt ngược của anemic model: một aggregate "giàu" mà setters để `public` cho ORM hydrate — đồng nghĩa mọi caller cũng mutate được nó. Nước đi senior là chuyển tiếp tường minh (mục 5) và/hoặc làm trạng thái bất biến ngay sau khi dựng. Một invariant không ai ép thi hành không phải là thiết kế; nó là một trang trại nuôi bug.

- **API linh hoạt đến mức không thể ràng buộc.** "Cứ linh hoạt đi: một `process(Map<String, Object> params)` chung chung." Giờ mọi caller tự phát minh key riêng, typo lặng lẽ lọt qua, và chẳng còn bất kỳ hợp đồng nào ở mức compile. Type-safety là một tính năng của interface; khoảnh khắc bạn nhận `Map<String,Object>`, bạn đã đổi sự giúp đỡ của compiler lấy một trang trại `ClassCastException` lúc runtime. Một senior _thu hẹp_ interface; không bao giờ _nới_ nó ra.

- **Interface lệch pha với code.** Interface `UserService` mà impl của nó thêm mười method chưa bao giờ được thêm vào interface — caller cuối cùng phải cast hoặc dùng reflection. Nếu interface không phải là lối vào duy nhất, thì abstraction chỉ để trang trí. Xóa nó đi hoặc làm cho nó thành thật.

## 7. Tự kiểm tra

- [ ] Áp dụng OCP cho một yêu cầu tính năng mà không sửa class cũ — và gọi tên khi OCP là công cụ sai.
- [ ] Giải thích DIP bằng khung "ai là chủ của hợp đồng," một ví dụ Spring, và bẫy ngược bùng nổ interface.
- [ ] Chỉ ra bẫy `equals` của `ColoredPoint`, và vì sao `List<Dog>` không phải là `List<Animal>`.
- [ ] Kể một case thật mà inheritance cắn bạn (fragile base class) và cách composition sửa nó.
- [ ] Đối chiếu sealed + pattern matching với strategy registry — mỗi cái đúng khi nào, và ai thêm biến thể thứ 4?
- [ ] Khi nào record là value object đúng, và khi nào nó vi phạm hợp đồng equality?
- [ ] Đếm số query trong một vòng lặp `getItems()`, và sửa ở đúng tầng (SQL vs DTO projection).
- [ ] Giải thích một call site megamorphic tốn bao nhiêu, và chứng minh bằng `-XX:+PrintInlining`.
- [ ] Tìm anemic domain model trong một đoạn code và canh giữ invariant quan trọng.
- [ ] Kể ba cách "clean code" biến thành sự cố production.

## 8. Câu hỏi vặn vẹo tiếp theo của phỏng vấn viên

Khi câu trả lời đầu của bạn đáp trúng, họ bắt đầu khoan sâu. Sẵn sàng cho những câu này:

- "Sprint tới bọn anh thêm phương thức thanh toán thứ 5. Dẫn tôi qua từng file anh chạm vào — và vì sao thiết kế đó là trục đúng."
- "Anh inject `PaymentGateway`. Ai viết cái interface đó, và chuyện gì xảy ra khi Stripe đổi SDK?"
- "`ColoredPoint extends Point` — tìm bug trong 30 giây. Giờ sửa nó mà không làm vỡ `HashSet<Point>`."
- "`Stack` có phải là một subclass `Vector` tồi? Quy tắc chung nào bắt được nó?"
- "Sealed interface ba records, hay strategy map ba handlers — anh dựng cái nào, và ai thêm biến thể thứ 4?"
- "`record Money` của anh có `add`. Vì sao đó là record tốt, nếu 'record mang logic là smell' nghe quá đơn giản?"
- "Vòng lặp này gọi `order.getItems()` cả nghìn lần. Đếm số query, và chỉ tôi chỗ cái thứ hai thực sự được tiêu vào đâu."
- "Anh bảo abstraction gần như miễn phí lúc runtime. Chứng minh đi — JIT làm gì với một call site monomorphic, và thứ gì phá vỡ inline?"
- "`OrderService` của anh 400 dòng với năm trách nhiệm. Anh tách cái gì trước, và vì sao thứ tự lại quan trọng?"
- "Mọi thay đổi vào `BaseRepository` làm vỡ ba subclass. Xây lại nó — nhưng đừng có nói với tôi là inheritance là xấu."

Đó là bar OOP cho senior.
