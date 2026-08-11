---
title: "OOP, SOLID & Design Patterns: Tư Duy Kỹ Thuật Cho Code Java Thực Tế"
description: "Cẩm nang theo hướng vấn đề trước về OOP, SOLID và Design Patterns trong Java. Học cách nhận ra áp lực thiết kế trong code thực tế, refactor về cấu trúc tốt hơn — và quan trọng không kém — biết chính xác khi nào KHÔNG nên áp dụng một nguyên tắc hay pattern."
pubDatetime: 2026-08-11T10:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
  - oop
  - solid
  - design-patterns
  - clean-code
---

`PaymentService` của bạn bắt đầu với 50 dòng code. Nó đọc loại thanh toán,
trừ tiền khách hàng, lưu biên lai. Sạch. Đơn giản.

Rồi business thêm thẻ tín dụng. Rồi chuyển khoản ngân hàng. Rồi e-wallet.
Rồi crypto. Rồi refund. Rồi logic retry. Rồi thông báo. Rồi audit logging.
Rồi provider thanh toán thứ hai. Rồi thứ ba.

Mười tám tháng sau, `PaymentService` dài 1.500 dòng. Mọi lần deploy đều đụng
vào nó. Mọi bug report đều rơi vào nó. Pull request thêm PayPal làm hỏng cả
thanh toán thẻ, vì cả hai nhánh sống trong cùng một method và cái `else if`
mới được đặt trước nhánh xử lý `CARD` theo cách không ai để ý.

Không ai quyết định làm class này thành tồi. Từng thay đổi đều hợp lý tại
thời điểm nó được thực hiện. Đó là sự thật khó chịu mà bài viết này xây
dựng trên đó:

> **Thiết kế tồi hầu như không bao giờ là một quyết định tồi duy nhất. Nó là
> kết quả tích lũy của rất nhiều quyết định hợp lý từng cái một, được thực
> hiện dưới áp lực.**

Đây không phải một tutorial SOLID khác. Bạn đã biết từ vựng — "SOLID nghĩa
là Single Responsibility, Open/Closed..." — và các ví dụ chung chung đi kèm
(`Animal`, `Dog`, `Cat`, `Shape`, `Circle`). Kiến thức đó không phải thứ
đang thiếu.

Thứ đang thiếu là **tư duy kỹ thuật (engineering judgment)**: khả năng nhìn
vào một codebase thực tế, cảm nhận áp lực thiết kế đang đè ở đâu, chọn đúng
kỹ thuật — và từ chối những kỹ thuật sẽ khiến mọi thứ tệ hơn. Vì vậy bài
viết này lặp đi lặp lại một luồng học duy nhất:

```text
Vấn đề (Problem)
   ↓
Thiết kế tồi (Bad Design)
   ↓
Vì sao nó tồi (Why It Is Bad)
   ↓
Nguyên tắc / Pattern
   ↓
Refactoring
   ↓
Đánh đổi (Trade-offs)
   ↓
Trường hợp đặc biệt (khi nào KHÔNG làm điều đó)
```

Mỗi khái niệm được giới thiệu vì một tình huống cụ thể sụp đổ nếu thiếu nó —
không phải vì khái niệm đó tồn tại trong sách giáo khoa. Domain được giữ
nhất quán suốt bài: thanh toán, đơn hàng, thông báo, repository. Bạn sẽ thấy
code tồi trước, rồi áp lực nó tạo ra, rồi refactoring, rồi cái giá của
refactoring đó.

Đây là toàn bộ bài viết trong một câu hỏi:

> **Mỗi lần bạn thêm một interface, một class, hay một pattern, bạn đang
> trả tiền cho thứ gì đó (indirection, indirection, indirection). Vấn đề mà
> khoản chi này đang giải quyết là gì?**

---

## 1. Vấn Đề Khởi Đầu Tất Cả

Quay lại câu chuyện mở đầu. Hãy nhìn `PaymentService` lớn dần lên, vì mọi
nguyên tắc trong bài viết này tồn tại để trả lời câu hỏi: _điều gì đã sai ở
đây?_

**Tháng 1.** Một phương thức thanh toán. Service là một đường thẳng:

```java
public class PaymentService {
    public void pay(Order order, CardDetails card) {
        validateCard(card);
        chargeCard(card, order.getTotal());
        saveReceipt(order, "PAID");
        sendConfirmationEmail(order);
    }
}
```

**Tháng 4.** Business thêm chuyển khoản ngân hàng và e-wallet. Những phản
ứng hợp lý, từng cái một:

- "Thêm một loại thanh toán nghĩa là thêm một nhánh — ổn thôi, chỉ là thêm
  vài dòng."
- "Refund? Thêm method `refund()` với `switch` theo loại."
- "Retry? Bọc lời gọi trong vòng lặp. Giữ đơn giản."
- "Email? Logic `sendConfirmationEmail` giống nhau mà cả hai nhánh thanh
  toán đều cần — chuyển nó thành private method."
- "Audit logging? Chỉ là `logger.info(...)` ở mọi điểm vào ra."
- "Provider thứ hai? Chèn các lời gọi SDK mới cạnh những cái cũ — sau này
  rút ra cũng được."

**Tháng 18.** Class trông như thế này:

```java
public class PaymentService {
    public void pay(Order order, PaymentRequest request) {
        // 40 dòng validation cho 6 loại thanh toán
        // 90 dòng logic rẽ nhánh (CARD, BANK_TRANSFER, E_WALLET, CRYPTO)
        // 30 dòng logic retry lặp lại cho 2 provider
        // 50 dòng logic email
        // 25 dòng audit logging
        // 20 dòng lưu biên lai
        // 15 dòng chuyển đổi exception
        // ...
    }

    public void refund(Payment payment, BigDecimal amount) {
        // thêm 200 dòng nữa, nửa số đó copy từ pay()
    }

    // 900 dòng nữa: private helper, quirk riêng của từng provider,
    // ngoại lệ riêng của crypto, error code, ...
}
```

1.500 dòng. Đây là câu hỏi bạn phải học cách đặt ra — vì nó là thứ phân
biệt "biết về SOLID" với "dùng được SOLID":

> **Điều gì thực sự đã sai?**

Không phải "đáng lẽ nên làm gì khác" — điều _gì_ đã sai? Những triệu chứng
cụ thể nào cho bạn biết class này có vấn đề thiết kế, thay vì chỉ là dài?

Nhìn kỹ danh sách triệu chứng:

| Triệu chứng                                    | Nó nói cho bạn điều gì                       |
| ---------------------------------------------- | -------------------------------------------- |
| Một class thay đổi vì nhiều lý do khác nhau    | Nhiều responsibility chung một file          |
| Thêm loại thanh toán nghĩa là sửa `pay()`      | Điểm biến thiên nằm trong chuỗi `if/else`    |
| Code retry/email/audit bị lặp                  | Hành vi cắt ngang đan xen code nghiệp vụ     |
| Thay đổi provider A làm hỏng provider B        | Các nhánh ghép chặt qua shared mutable state |
| Test `pay()` cần DB thật, email thật, SDK thật | Dependency hardwire, không được inject       |
| Không thể tóm tắt `pay()` làm gì trong một câu | Quá nhiều thứ xảy ra trong một method call   |

Mỗi triệu chứng ánh xạ tới một nguyên tắc trong bài viết này. Bảng này sẽ
được điền dần — hãy ghi nhớ nó, vì case study refactoring ở Phần VI dẫn dắt
bạn sửa chính class này, hết triệu chứng này đến triệu chứng khác.

Nhưng trước các nguyên tắc, chúng ta cần vật liệu thô: bốn khái niệm OOP mà
mọi thứ khác xây dựng trên đó. Không phải như định nghĩa — mà như cơ chế:
chúng bảo vệ hệ thống của bạn hoặc phản bội nó.

---

## 2. Phần I — OOP: Không Chỉ Là Class và Object

Bạn biết cú pháp của class, object, inheritance, interface. Điều phần này
thực sự bàn là những cơ chế đó _làm gì_ — các sự bảo vệ chúng cung cấp, các
kiểu thất bại chúng tạo ra, và sự phán đoán khi dùng chúng. Bốn khái niệm,
bốn câu hỏi kỹ thuật:

| Khái niệm     | Câu hỏi kỹ thuật                                   |
| ------------- | -------------------------------------------------- |
| Encapsulation | Ai được phép đụng vào state này, và bằng cách nào? |
| Abstraction   | Caller nên biết gì về bên trong?                   |
| Inheritance   | Đây có thực sự là quan hệ "is-a"?                  |
| Polymorphism  | Ai quyết định hành vi nào chạy?                    |

### 2.1 Encapsulation: Bảo Vệ Invariant, Không Phải Ẩn Field

Hầu hết lập trình viên Java tin rằng encapsulation nghĩa là `private` field
cộng getter/setter. Không phải. `private` là _cơ chế_; encapsulation là _kết
quả_. Kết quả là: state của một object luôn thỏa mãn các quy tắc của nó —
bất kể code nào chạm vào.

**Thiết kế tồi trước.** Đây là một `BankAccount` biên dịch được,
"encapsulated" theo đúng nghĩa đen của quy tắc, và hoàn toàn hỏng:

```java
public class BankAccount {
    public BigDecimal balance;
    public BigDecimal creditLimit;

    public BankAccount(BigDecimal balance, BigDecimal creditLimit) {
        this.balance = balance;
        this.creditLimit = creditLimit;
    }
}
```

Field public, nên bất kỳ caller nào cũng có thể làm thế này:

```java
BankAccount account = new BankAccount(BigDecimal.ZERO, BigDecimal.valueOf(100));

// không kiểm tra, không lỗi — tài khoản giờ đang âm 50 vượt hạn mức
account.balance = account.balance.subtract(BigDecimal.valueOf(150));

// deposit âm — "balance" có thể bị thao túng tùy ý
account.balance = account.balance.negate();

// và giờ invariant "balance tôn trọng credit limit" đã bị phá hủy
account.creditLimit = null;   // lần kiểm tra tiếp theo, ở đâu đó, sẽ NPE
```

**Vì sao nó tồi.** Ngay khi `balance` và `creditLimit` bị phơi ra thành
mutable field, class không còn cách nào thực thi quy tắc nghiệp vụ của
chính mình. Invariant _"số dư không bao giờ được thấp hơn âm của hạn mức tín
dụng"_ không còn là thuộc tính của tài khoản — nó là hy vọng. Mọi caller
phải tự nhớ kiểm tra, và caller đầu tiên quên sẽ làm hỏng state cho tất cả
những người còn lại.

**Nguyên tắc.** Một object là người bảo vệ các quy tắc của chính nó. Field
vẫn tồn tại, nhưng mọi thay đổi đều đi qua một method thực thi các
invariant — những điều kiện phải luôn đúng để object hợp lệ:

```java
public class BankAccount {
    private BigDecimal balance;                    // không bao giờ null, >= -creditLimit
    private final BigDecimal creditLimit;          // bất biến sau khi đặt

    public BankAccount(BigDecimal balance, BigDecimal creditLimit) {
        if (balance == null || creditLimit == null) {
            throw new IllegalArgumentException("balance and creditLimit are required");
        }
        if (creditLimit.signum() < 0) {
            throw new IllegalArgumentException("credit limit cannot be negative");
        }
        this.balance = balance;
        this.creditLimit = creditLimit;
    }

    public void withdraw(BigDecimal amount) {
        requirePositive(amount, "withdrawal amount");
        BigDecimal newBalance = balance.subtract(amount);
        if (newBalance.compareTo(creditLimit.negate()) < 0) {
            throw new InsufficientFundsException(
                "withdrawal exceeds available credit: " + amount);
        }
        balance = newBalance;
    }

    public void deposit(BigDecimal amount) {
        requirePositive(amount, "deposit amount");
        balance = balance.add(amount);
    }

    public BigDecimal getBalance() {
        return balance;
    }

    public BigDecimal getCreditLimit() {
        return creditLimit;
    }

    private static void requirePositive(BigDecimal value, String what) {
        if (value == null || value.signum() <= 0) {
            throw new IllegalArgumentException(what + " must be positive: " + value);
        }
    }
}
```

Giờ các invariant được _thực thi bởi chính object duy nhất có thể thay đổi
state_. Chú ý hai chi tiết quan trọng:

- `creditLimit` là `final` và không có setter. Không có quy tắc nghiệp vụ nào
  thay đổi nó, nên class không cho phép thay đổi nó.
- Các method kiểm tra _trước khi_ đột biến. `withdraw()` kiểm tra kết quả
  so với invariant _trước khi_ gán.

Đây mới là ý nghĩa thực sự của encapsulation:

> **Encapsulation là bảo vệ invariant, không phải đơn giản là ẩn field.
> `private` cho bạn khả năng bảo vệ chúng; nó không tự động bảo vệ.**

**Rò rỉ encapsulation: cái bẫy getter.** Đây là cách encapsulation thất bại
phổ biến nhất ngay cả trong code kỷ luật. Class giữ field private, nhưng
getter đưa ra tay object nội bộ:

```java
public class BankAccount {
    private final List<Transaction> transactions = new ArrayList<>();

    public List<Transaction> getTransactions() {   // chỗ rò rỉ
        return transactions;
    }
}
```

Bất kỳ caller nào giờ có thể `account.getTransactions().clear()` hoặc thêm
một giao dịch giả mạo — state nội bộ bị thay đổi sau lưng class, và không gì
class làm có thể ngăn được. Class _trông có vẻ_ được encapsulate và thực tế
thì không. Hai cách sửa, với trade-off khác nhau:

```java
// Cách A: trả về một unmodifiable view — rẻ, nhưng caller vẫn nhìn thấy
// nội dung và vẫn giữ được tham chiếu
public List<Transaction> getTransactions() {
    return Collections.unmodifiableList(transactions);
}

// Cách B: trả về một bản copy — đắt cho list lớn, nhưng caller không bao
// giờ quan sát hay ảnh hưởng được các thay đổi sau này
public List<Transaction> getTransactions() {
    return new ArrayList<>(transactions);
}
```

**Defensive copying chạy theo cả hai chiều.** Rò rỉ tương tự tồn tại theo
hướng ngược lại: constructor lưu _object mutable của caller_. Nếu bạn giữ
một tham chiếu tới một object mà caller vẫn còn có thể thay đổi, caller có
thể thay đổi state của object bạn qua đường cửa sau:

```java
public class BankAccount {
    private final Address billingAddress;   // Address có setter

    public BankAccount(Address billingAddress) {
        this.billingAddress = billingAddress;   // RÒ RỈ: caller vẫn giữ nó
    }
}
```

Cách sửa là copy ngay khi vào:

```java
public BankAccount(Address billingAddress) {
    this.billingAddress = new Address(billingAddress);   // defensive copy
}
```

**Mutable object vs immutable object.** Chú ý một mẫu chung trong mọi thứ ở
trên: vấn đề đến từ _mutability_. Nếu `Address`, `Transaction` và
`BigDecimal` là immutable — field `final`, không setter, không cách nào thay
đổi sau khi tạo — thì hầu hết các rò rỉ và defensive copy biến mất.

Có lý do `BigDecimal` (chứ không phải `double`) được dùng xuyên suốt ví dụ
này: tiền không bao giờ được phép mất độ chính xác, và một value type không
thể thay đổi sẽ bảo vệ mọi invariant phụ thuộc vào nó. Quy tắc chung:

> **Hãy làm object immutable trừ khi bạn có lý do đã được chứng minh để đột
> biến nó.** Mỗi setter bạn gỡ bỏ là một lớp bug bạn không thể viết ra nữa.

**Khi nào defensive copying và immutability không đáng giá.** Chỉ trích hiệu
năng đối với immutable object hầu hết chỉ mang tính lý thuyết cho tới khi nó
không còn: copy một list 10.000 phần tử trong mỗi lần gọi getter là chi phí
thật. Nếu collection rất lớn và được đọc ở hot path, một unmodifiable _view_
(Cách A) cho hầu hết sự an toàn mà không tốn chi phí copy. Tương tự, value
object immutable với nhiều field sẽ thành constructor soup — vấn đề đó có
giải pháp riêng, và bạn sẽ gặp nó ở phần Builder (Phần III).

**Tóm tắt trade-off.** Encapsulation tốn chút nghi thức (method validation,
copy, immutability) để đổi lấy tính toàn vẹn của state. Trường hợp đặc biệt
đơn giản: state càng nhỏ và càng cục bộ, thì càng cần ít máy móc
encapsulation — một `private` field trong class của chính một method public
20 dòng hiếm khi cần defensive copy.

### 2.2 Abstraction: Caller Nên Biết Gì Về Bên Trong?

Encapsulation nói về _state_; abstraction nói về _hành vi_. Câu hỏi là: bạn
phơi ra contract gì cho caller, và bạn giấu điều gì?

**Câu hỏi đúng về abstraction.** Một interface trong Java là một lời hứa về
_hành vi_, không phải về _cấu trúc_: "mọi object implement interface này
đều làm được X." Câu hỏi thiết kế là `X` nên là gì. Sai một hướng thì caller
bị ghép chặt vào chi tiết implementation; sai hướng kia thì abstraction tốn
nhiều hơn lợi.

**Abstraction rò rỉ (leaky).** Hãy xem boundary cổ điển của backend: thanh
toán qua một cổng của bên thứ ba. Đây là interface _trông có vẻ_ abstract
nhưng đang rò rỉ chi tiết từ bên dưới:

```java
public interface PaymentGateway {
    // "token" là khái niệm riêng của thẻ; "brand" cũng vậy
    PaymentResult chargeWithToken(String token, String brand, BigDecimal amountCents);
    void refundViaChargeId(String chargeId);
    String getProviderName();          // ai cần cái này?
}
```

Vì sao nó rò rỉ?

- `token` là khái niệm của thẻ tín dụng. Một implementation chuyển khoản
  ngân hàng không có token; e-wallet có user id. Mỗi implementation phải
  giả vờ thế giới của nó khớp cái lỗ hình thẻ.
- `amountCents` là quy ước của provider (nhiều SDK đếm theo cents). Domain
  làm việc với `BigDecimal`; việc chuyển đổi thuộc về _bên trong_ adapter,
  không phải ở mọi caller.
- `getProviderName()` phơi danh tính provider — mời gọi caller viết
  `if (gateway.getProviderName().equals("STRIPE"))`, và thế là interface chỉ
  còn là trang trí, logic thật lại nằm trong caller.

Interface đã thất bại: nó trừu tượng hóa _từ vựng của một implementation_ rồi
gọi đó là contract. Dấu hiệu nhận biết của leaky abstraction là `if
(implementation == concreteOne)` trong code client, hoặc một tham số mà chỉ
một implementation mới điền có nghĩa.

**Một abstraction sạch hơn.** Interface nên nói ngôn ngữ của domain và giấu
mọi thứ còn lại:

```java
public interface PaymentGateway {
    PaymentResult pay(PaymentRequest request);
}
```

với các domain type:

```java
public class PaymentRequest {
    private final String orderId;
    private final BigDecimal amount;
    private final String currency;
    private final PaymentMethod method;   // card token, bank account, wallet id...

    // constructor + getters
}

public class PaymentResult {
    private final String providerReference;   // id riêng của provider, giấu ở đây
    private final boolean success;

    public static PaymentResult success(String providerReference) { ... }
    public static PaymentResult failure(String reason) { ... }
    // getters
}
```

Giờ `CardGatewayImpl`, `BankGatewayImpl` và `WalletGatewayImpl` tự do diễn
giải `PaymentMethod` theo cách riêng, và mọi caller — payment service, refund
service, batch job báo cáo — chỉ thấy `PaymentRequest` và `PaymentResult`.
Từ vựng của provider (token, charge, transfer, settlement) nằm gọn trong các
implementation. Đây chính là hình dạng của **Adapter pattern** (có phần
riêng ở Phần III) và **Dependency Inversion principle** (Phần II) —
abstraction và hướng của dependency là hai mặt của cùng một quyết định.

**Nên trừu tượng hóa gì, và không nên trừu tượng hóa gì.** Đây là sự phán
đoán:

```text
NÊN trừu tượng hóa:
  - Điểm biến thiên (bạn kỳ vọng nhiều implementation)
  - Ranh giới bên ngoài (SDK, database, file, queue, thời gian, random)
  - Chi tiết hay thay đổi (thứ thay đổi nhanh hơn caller của nó)

KHÔNG NÊN trừu tượng hóa:
  - Helper nội bộ chỉ có một implementation
  - Thứ thay đổi cùng tốc độ với caller của nó
  - Tương lai giả định bạn chưa từng thấy
```

Từ cần thấm là _volatility_: abstraction là một ván cược rằng phần bị giấu
sẽ thay đổi thường xuyên hơn — hoặc có nhiều biến thể hơn — phần được nhìn
thấy. Nếu cả hai bên thay đổi cùng tốc độ vì cùng lý do, interface giữa
chúng là thủ tục giấy tờ, không phải kiến trúc.

**Premature abstraction.** Triệu chứng rõ nhất của premature abstraction là
một interface có đúng một implementation, được tạo vì "biết đâu sau này cần
cái khác", cộng một factory tồn tại chỉ để tra cứu cái implementation duy
nhất đó:

```java
public interface EmailSender {
    void send(Email email);
}

public class SmtpEmailSender implements EmailSender { ... }

public class EmailSenderFactory {
    public EmailSender create() {
        return new SmtpEmailSender();       // factory chẳng có gì để quyết định
    }
}
```

Không gì ở đây _sai_ — nhưng cũng không gì _xứng đáng_ cả. Caller hoàn toàn
có thể dùng `SmtpEmailSender` trực tiếp. Interface `EmailSender` và factory
của nó thêm hai tầng indirection mà chẳng giải quyết vấn đề nào. Khi sender
thứ hai thực sự xuất hiện (provider API giao dịch, sender dựa trên queue),
việc thêm interface là một refactoring nhỏ, cơ học, mất vài phút. Số tháng
indirection lãng phí bạn trả ngay bây giờ không được hoàn lại sau này. Quy
tắc phán đoán:

> **Hãy trừu tượng hóa để phản ứng với một biến thiên thực, không phải để
> phòng xa.** Implementation đầu tiên của bất cứ thứ gì đều là concrete;
> interface xuất hiện khi cái thứ hai tồn tại — hoặc chắc chắn đến mức nó
> là yêu cầu, không phải phỏng đoán.

**Tóm tắt trade-off:**

```text
Quá ít abstraction → ghép chặt (tight coupling); mọi thay đổi chi tiết nội
                    bộ lan ra mọi caller
Quá nhiều abstraction → indirection không có lợi ích; caller phải băng qua
                    nhiều tầng để tìm một implementation
```

Điểm ngọt nằm ở chỗ abstraction đứng _tại ranh giới_ — giữa các module thay
đổi độc lập — và không ở đâu khác.

### 2.3 Inheritance: Khi "is-a" Là Cái Bẫy

Java cho bạn `extends` và `implements`. Phần này bàn về cái gây rắc rối:
class inheritance. Rắc rối không phải cú pháp. Nó là việc inheritance ép một
_taxonomy_ lên code của bạn, và quy tắc nghiệp vụ thực tế hiếm khi tạo thành
taxonomy sạch.

**Thiết kế tồi trước.** Một hệ thống thông báo. Khởi đầu đơn giản:

```java
public class Notification {
    private final String recipient;
    private final String message;

    public Notification(String recipient, String message) { ... }

    public void send() {
        System.out.println("Sending email to " + recipient + ": " + message);
    }
}

public class EmailNotification extends Notification {
    private final String subject;

    public EmailNotification(String recipient, String message, String subject) {
        super(recipient, message);
        this.subject = subject;
    }

    @Override
    public void send() {
        System.out.println("Sending email [" + subject + "] to " + recipient);
    }
}
```

Trông hợp lý. "Email notification _is a_ notification." Rồi business thêm SMS:

```java
public class SmsNotification extends Notification {
    public SmsNotification(String recipient, String message) {
        super(recipient, message);
    }

    @Override
    public void send() {
        System.out.println("Sending SMS to " + recipient + " (truncated to 160 chars)");
    }
}
```

Rồi push, rồi WhatsApp, rồi Slack. Mỗi kênh mới là một subclass. Và rồi vấn
đề bắt đầu:

1. **Base class tích tụ rác của từng kênh.** SMS có giới hạn 160 ký tự,
   WhatsApp cần template id, Slack cần channel name. Những field đó sống ở
   đâu? `Notification` base bắt đầu có thêm field tùy chọn (`templateId`,
   `channelName`, `attachment`) mà chỉ một số subclass dùng. Base class trở
   thành giao của mọi kênh — field vô dụng khắp nơi.

2. **Hành vi dùng chung bị lặp hoặc thừa kế sai chỗ.** "Retry khi gửi thất
   bại" nghe như việc của base class, nên nó vào `Notification.send()` như
   một template. Nhưng giới hạn retry của SMS khác email, và giờ muốn ghi
   đè logic retry nghĩa là ghi đè `send()` — cái thứ base class vốn định
   tập trung.

3. **Fragile base class.** Mọi thay đổi trong `Notification` lan vào mọi
   subclass. Một ngày ai đó thêm check `getDeliveryStatus()` vào `send()`
   của base với giả định kênh đồng bộ — và subclass WhatsApp, vốn bất đồng
   bộ, bắt đầu fail ở production vì lý do nằm ba tầng trong cây thừa kế.

4. **Taxonomy sụp đổ dưới áp lực LSP.** Base class hứa "gửi một tin nhắn."
   `EmailNotification` đính kèm file được; SMS thì không. Một caller với
   `List<Notification>` muốn gọi `attachFile()` phải `instanceof` từng phần
   tử — ảo tưởng polymorphic chấm hết.

**Vì sao điều này xảy ra.** Quan hệ trông giống "is-a" nhưng thực ra là
"has-a / can-be-delivered-by." `EmailNotification` không _trở thành_ việc
gửi — nó _dùng_ một kênh gửi. Hình dạng an toàn là composition:

```java
public class Notification {
    private final String recipient;
    private final String message;
    private final NotificationSender sender;   // has-a, không phải is-a

    public Notification(String recipient, String message, NotificationSender sender) {
        this.recipient = recipient;
        this.message = message;
        this.sender = sender;
    }

    public void send() {
        sender.send(recipient, message);
    }
}
```

Giờ `SmsSender`, `EmailSender`, `WhatsAppSender` implement một interface nhỏ
duy nhất `NotificationSender`. Thêm kênh = thêm class + compose — class
`Notification` không đổi, và quy tắc riêng của kênh (SMS truncate, WhatsApp
template) sống trong class sở hữu chúng. Taxonomy biến mất; biến thiên là dữ
liệu và strategy, không phải subclass.

**is-a vs has-a: quy tắc quyết định.** Khác biệt không phải ngữ pháp — nó là
_tính thay thế về hành vi_ (behavioral substitutability). `X extends Y` tuyên
bố: "mọi code làm việc với `Y` sẽ làm việc được với `X`." Đó chính là Liskov
Substitution Principle, có phần riêng ở Phần II. Kiểm tra thực tế:

```text
Tự hỏi: subclass có thực sự "chạy được ở mọi nơi parent chạy được" không?
  - EmailNotification dùng ở chỗ kỳ vọng Notification: ổn.
  - Một NotificationSender được dùng BỞI Notification: cũng ổn — nhưng đây
    là has-a, không phải is-a.
  - SmsNotification dùng ở chỗ kỳ vọng EmailNotification: KHÔNG ổn — quan
    hệ chưa bao giờ là taxonomy.
```

**Vì sao composition thường an toàn hơn.** Composition cho bạn bốn thứ mà
inheritance không cho:

| Mối quan tâm          | Inheritance                               | Composition                         |
| --------------------- | ----------------------------------------- | ----------------------------------- |
| Tái sử dụng           | Thừa kế — dùng lại theo dòng máu          | Ủy quyền — dùng lại theo tham chiếu |
| Sóng lan khi thay đổi | Thay đổi base class đánh vào mọi subclass | Chỉ class compose                   |
| Linh hoạt lúc chạy    | Cố định lúc compile (superclass nào)      | Có thể hoán đổi lúc chạy            |
| Thực thi contract     | Yếu — subclass có thể làm yếu hành vi     | Mạnh — contract của interface       |

**Khi nào inheritance thực sự hợp lý.** "Favor composition over inheritance"
là quy tắc ngón tay cái, không phải luật. Inheritance xứng đáng khi:

- Hệ thống phân cấp **nhỏ, ổn định và sealed** — từ khóa `sealed` của Java
  (Phần VII) làm điều này tường minh và an toàn.
- Subclass **thêm hành vi mà không làm yếu** contract của parent — ví dụ
  extension kiểu `ArrayList`, template-method skeleton với các bước ổn định.
- Quan hệ là **taxonomy thật** — `RuntimeException extends Exception`,
  `IOException extends Exception`: mọi catch site xử lý `Exception` đều thực
  sự xử lý được `IOException`, và cây thừa kế đã lâu không mọc thêm.

Vấn đề không phải "không bao giờ inherit." Vấn đề là: **trước khi viết
`extends`, bạn phải bảo vệ được tuyên bố substitutability** — vì đó chính là
thứ bạn đang cam kết.

### 2.4 Polymorphism: Từ Chuỗi `if/else` Đến Dispatch — Và Quay Lại

Polymorphism là khả năng các object khác nhau trả lời cùng một thông điệp
theo những cách khác nhau. Java cho bạn ba cơ chế: dispatch qua
interface/class, overriding, và — Java hiện đại — switch pattern matching
và lambda. Câu hỏi là khi nào dùng cái nào.

**Thiết kế tồi trước.** Payment dispatcher, lớn lên một cách tự nhiên:

```java
public class PaymentService {
    public PaymentResult pay(Payment payment) {
        if (payment.getType() == PaymentType.CARD) {
            return cardGateway.charge(payment.getReference(), payment.getAmount());
        } else if (payment.getType() == PaymentType.BANK_TRANSFER) {
            return bankGateway.transfer(payment.getReference(), payment.getAmount());
        } else if (payment.getType() == PaymentType.E_WALLET) {
            return walletGateway.pay(payment.getReference(), payment.getAmount());
        } else if (payment.getType() == PaymentType.CRYPTO) {
            return cryptoGateway.broadcast(payment.getReference(), payment.getAmount());
        } else {
            throw new UnsupportedPaymentTypeException(payment.getType());
        }
    }
}
```

**Vì sao nó trở nên đau đớn.** Thêm mỗi loại thanh toán nghĩa là sửa method
này. Chuỗi dài ra; thứ tự nhánh trở nên quan trọng (bug do đặt `else if` sai
chỗ là thật — nhớ lại câu chuyện PayPal ở phần mở đầu); mọi caller của
`pay()` phải biên dịch lại và test lại; và method trở thành tổng đài nơi mọi
logic _thật_ vẫn nằm bên trong các nhánh. Chuỗi không _lớn lên_ — nó _mục
nát_.

**Refactoring về phía polymorphism.** Hình dạng của cách sửa: định nghĩa
hành vi như một contract, để mỗi biến thể implement nó, và để caller yêu cầu
đúng biến thể theo loại. Interface `PaymentStrategy` (xử lý đầy đủ ở Phần
III) là phương tiện:

```java
public interface PaymentStrategy {
    PaymentResult pay(Payment payment);
}
```

```java
public class CardPaymentStrategy implements PaymentStrategy {
    private final CardGateway cardGateway;

    public CardPaymentStrategy(CardGateway cardGateway) {
        this.cardGateway = cardGateway;
    }

    @Override
    public PaymentResult pay(Payment payment) {
        return cardGateway.charge(payment.getReference(), payment.getAmount());
    }
}
```

…và tương tự `BankTransferPaymentStrategy`, `WalletPaymentStrategy`,
`CryptoPaymentStrategy`. Service trở thành:

```java
public class PaymentService {
    private final Map<PaymentType, PaymentStrategy> strategies;

    public PaymentService(Map<PaymentType, PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentResult pay(Payment payment) {
        PaymentStrategy strategy = strategies.get(payment.getType());
        if (strategy == null) {
            throw new UnsupportedPaymentTypeException(payment.getType());
        }
        return strategy.pay(payment);
    }
}
```

Điều gì thay đổi, cụ thể?

- **Thêm loại thanh toán = thêm một class + đăng ký vào một map.** Service
  và mọi strategy hiện có không bị đụng tới. Đây là Open/Closed Principle
  (Phần II) và là lý do polymorphism tồn tại trong câu chuyện này: quyết
  định dispatch dời _ra khỏi_ luồng nghiệp vụ vào một cấu trúc (`Map`) không
  thể bị đặt sai thứ tự hay đặt sai chỗ.
- **Mỗi biến thể tự sở hữu logic và có thể test độc lập.** Thay đổi
  settlement của crypto không làm biên dịch lại — hay đặt lại rủi ro lên —
  đường thanh toán thẻ.

**Điểm giữa: switch expression và enum dispatch.** Trước khi xây một map
strategy đầy đủ, hãy cân nhắc dispatch sẵn có của Java. Nếu hành vi theo
loại nhỏ và các loại ổn định, một switch expression trung thực, đầy đủ, và
ít máy móc hơn nhiều:

```java
public PaymentResult pay(Payment payment) {
    return switch (payment.getType()) {
        case CARD -> cardGateway.charge(payment.getReference(), payment.getAmount());
        case BANK_TRANSFER -> bankGateway.transfer(payment.getReference(), payment.getAmount());
        case E_WALLET -> walletGateway.pay(payment.getReference(), payment.getAmount());
        case CRYPTO -> cryptoGateway.broadcast(payment.getReference(), payment.getAmount());
    };
}
```

Đây không phải "polymorphism kém thuần" — nó là một _quyết định về điểm
biến thiên_. Switch an toàn ở mức enum bị sealed (nó không thể lớn lên mà
không đụng tới method này, và compiler nhắc bạn qua tính exhaustiveness).
Map strategy tốt hơn khi các nhánh _nặng_ — mỗi nhánh có dependency riêng,
vòng đời riêng, test riêng — hoặc khi strategy phải có thể cấu hình/hoán đổi
lúc chạy.

**Trường hợp đặc biệt: khi `if` đơn giản tốt hơn polymorphism.** Đây là phần
mà hầu hết tutorial không dạy. Hãy xem:

```java
public class OrderPersistenceService {
    private final OrderRepository orderRepository;
    private final AuditLogger auditLog;

    public OrderPersistenceService(OrderRepository orderRepository, AuditLogger auditLog) {
        this.orderRepository = orderRepository;
        this.auditLog = auditLog;
    }

    public void persist(Order order) {
        if (order.getStatus() == OrderStatus.CANCELLED) {
            auditLog.record("cancelled-order-skip", order.getId());
            return;
        }
        orderRepository.save(order);
    }
}
```

Có nên biến đây thành `CancelledOrderPersistenceStrategy` và
`NormalOrderPersistenceStrategy` đằng sau interface `PersistenceStrategy`?
**Không.** Và không phải vì nó nhỏ — mà vì hai nhánh không phải một _gia
đình thuật toán thay thế lẫn nhau_. Một bên là guard clause; bên kia là thao
tác thật. Biến thiên ở đây là một quy tắc nghiệp vụ ("đơn bị hủy không được
lưu"), và diễn đạt nó thành bảng dispatch sẽ khiến code _khó đọc hơn_ bằng
cách giấu quy tắc đi.

Polymorphism xứng đáng chi phí khi tất cả những điều này đúng:

1. Các nhánh là **biến thể của một hành vi** (những cách làm cùng một việc),
   không phải những việc khác nhau.
2. Biến thể mới được **kỳ vọng** — điểm biến thiên thật, không phải giả
   định.
3. Các nhánh **đủ lớn** để việc tách biệt trả được indirection (một nhánh
   một dòng thì không).

Một `if` hai nhánh, ổn định, nhỏ không phải là nợ thiết kế. Nó là một quyết
định thiết kế. Nợ nằm ở chuỗi _không giới hạn_ lớn dần theo từng yêu cầu
nghiệp vụ — và kỹ năng nằm ở việc phân biệt hai thứ đó.

**OOP trong một đoạn văn.** Encapsulation bảo vệ state và quy tắc; abstraction
chọn contract ở ranh giới; inheritance chỉ xứng đáng khi có substitutability;
polymorphism đưa dispatch ra khỏi luồng nghiệp vụ. Giờ hãy mang bốn cơ chế
này áp vào năm nguyên tắc quản lý quan hệ giữa các class và module — SOLID.

## 3. Phần II — SOLID: Tư Duy Kỹ Thuật Đằng Sau

SOLID không phải checklist. Nó là năm câu trả lời cho năm câu hỏi khác nhau
về _thay đổi_:

| Nguyên tắc | Câu hỏi nó trả lời                              |
| ---------- | ----------------------------------------------- |
| S          | Một class được có bao nhiêu lý do để thay đổi?  |
| O          | Thay đổi nào không nên đụng tới code hiện có?   |
| L          | Khi nào một subclass được phép thay thế parent? |
| I          | Interface nên phục vụ ai?                       |
| D          | Dependency nên trỏ theo hướng nào?              |

Mỗi nguyên tắc đều là một phán đoán về _volatility_ — thứ gì có thể thay
đổi, thường xuyên ra sao, và ai nên hứng chịu thay đổi đó. Không nguyên tắc
nào là luật tuyệt đối. Phần này xử lý từng nguyên tắc một, luôn theo cùng
một hình dạng: vấn đề thực, code tồi, nỗi đau, nguyên tắc, refactoring,
trade-offs, và khi nào KHÔNG áp dụng.

### 3.1 S — Single Responsibility Principle: Một Lý Do Để Thay Đổi

**Vấn đề thực.** Quay lại câu chuyện mở đầu. Đây là `OrderService` cổ điển —
class làm mọi thứ, và vì vậy thay đổi vì mọi thứ:

```java
public class OrderService {
    private final OrderRepository orderRepository;
    private final EmailService emailService;
    private final PaymentService paymentService;

    public OrderService(OrderRepository orderRepository,
                        EmailService emailService,
                        PaymentService paymentService) {
        this.orderRepository = orderRepository;
        this.emailService = emailService;
        this.paymentService = paymentService;
    }

    public void placeOrder(Order order) {
        // 1. validation
        if (order.getItems().isEmpty()) {
            throw new IllegalArgumentException("order has no items");
        }
        if (order.getCustomer() == null || order.getCustomer().getEmail() == null) {
            throw new IllegalArgumentException("customer email is required");
        }

        // 2. pricing
        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.getItems()) {
            total = total.add(item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
        }
        if (total.compareTo(BigDecimal.valueOf(500)) > 0) {
            total = total.multiply(BigDecimal.valueOf(0.9));   // 10% discount over 500
        }
        order.setTotal(total);

        // 3. persistence
        orderRepository.save(order);

        // 4. payment
        paymentService.pay(order);

        // 5. email
        emailService.sendOrderConfirmation(order);

        // 6. logging
        logger.info("Order {} placed with total {}", order.getId(), order.getTotal());
    }
}
```

**Vì sao nó đau đớn.** Đếm các lý do class này có thể thay đổi:

- Quy tắc validation mới ("khách bị chặn không được đặt hàng") — sửa ở đây.
- Quy tắc pricing mới (hạng thành viên, mã giảm giá) — sửa ở đây.
- Schema database hoặc repository thay đổi — sửa ở đây.
- Luồng thanh toán thay đổi (refund khi hủy, thanh toán từng phần) — sửa ở đây.
- Template email mới hoặc thay email service — sửa ở đây.
- Thay đổi logging/observability — sửa ở đây.

Sáu quyết định nghiệp vụ độc lập, một file. Hậu quả cộng dồn:

- **Mọi thay đổi đều phải test lại mọi thứ.** Một sửa pricing phải kiểm lại
  validation, persistence, payment, email — vì chúng chung một method.
- **Class không thể được tái sử dụng hay hiểu một phần.** Không caller nào
  có thể nói "validate đơn này" mà không có toàn bộ cỗ máy hiện diện.
- **Test cần cả thế giới.** Unit test của `placeOrder` phải mock repository,
  payment, email — ngay cả khi chỉ muốn test riêng pricing.
- **Bug vượt ranh giới.** Ví dụ kinh điển: email outage kéo sập cả việc đặt
  hàng, vì email không thể tách khỏi luồng.

**Nguyên tắc.** SRP thực sự không phải "một class chỉ làm một việc" (mọi
class hữu dụng đều làm nhiều việc) và chắc chắn không phải "một class một
method". Nó là:

> **Một class nên có một lý do để thay đổi.** Một lý do để thay đổi là một
> actor hay chức năng nghiệp vụ duy nhất có thể đòi hỏi một thay đổi — quy
> tắc pricing, các payment provider, template email, schema persistence. Mỗi
> lý do như vậy xứng đáng có class riêng.

**Refactoring.** Tách theo _lý do thay đổi_ — không phải theo ranh giới
method:

```java
public class OrderValidator {
    public void validate(Order order) {
        if (order.getItems().isEmpty()) {
            throw new IllegalArgumentException("order has no items");
        }
        if (order.getCustomer() == null || order.getCustomer().getEmail() == null) {
            throw new IllegalArgumentException("customer email is required");
        }
    }
}
```

```java
public class OrderPricing {
    public BigDecimal calculateTotal(Order order) {
        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.getItems()) {
            total = total.add(item.getPrice()
                .multiply(BigDecimal.valueOf(item.getQuantity())));
        }
        if (total.compareTo(BigDecimal.valueOf(500)) > 0) {
            total = total.multiply(BigDecimal.valueOf(0.9));
        }
        return total;
    }
}
```

```java
public class OrderService {
    private final OrderValidator validator;
    private final OrderPricing pricing;
    private final OrderRepository orderRepository;
    private final PaymentService paymentService;
    private final EmailService emailService;

    // constructor injection...

    public void placeOrder(Order order) {
        validator.validate(order);
        order.setTotal(pricing.calculateTotal(order));
        orderRepository.save(order);
        paymentService.pay(order);
        emailService.sendOrderConfirmation(order);
    }
}
```

Mỗi class giờ có đúng một lý do thay đổi, có thể test độc lập, và có thể tái
sử dụng (validator và pricer dùng được cho cả luồng sửa đơn lẫn luồng
refund). Chú ý điều _không_ xảy ra: `OrderService` vẫn orchestrate luồng —
đó là việc của nó. SRP không biến nó thành vỏ rỗng; nó biến nó thành một
_điều phối viên có lý do thay đổi duy nhất là chính luồng_.

**Câu hỏi khó: khi nào hai responsibility thực sự khác nhau?** Đây là chỗ
SRP bị dùng sai, và nó xứng đáng được nói chính xác. Hai responsibility khác
nhau khi chúng thay đổi **với tốc độ khác nhau, vì lý do khác nhau, hoặc bởi
các actor khác nhau**. Kiểm tra:

```text
Tự hỏi: "Nếu tôi đổi X, tôi có muốn đổi Y luôn không?"
  - Thay đổi quy tắc pricing và thay đổi template email: actor khác nhau,
    tốc độ khác nhau → class khác nhau.
  - "Lưu đơn" và "tải đơn theo id": cùng actor, cùng tốc độ, cùng schema →
    cùng class (một repository), luôn luôn.
  - Validation đơn trước khi thanh toán và trước khi sửa: cùng quy tắc,
    cùng actor → ĐỪNG tách thành OrderValidationService và
    OrderEditValidationService.
```

**Over-fragmentation: khi tách gây hại.** Mặt trái của SRP là refactoring
kiểu sơ đồ tổ chức, nơi mỗi responsibility không chỉ có một class mà còn cả
một nghi lễ:

```java
OrderValidator
OrderValidatorImpl
OrderValidationService
OrderPricingCalculator
OrderPricingService
OrderPersistenceManager
OrderRepository
OrderRepositoryImpl
OrderPersistenceService
OrderProcessor
OrderCoordinator
OrderService
```

Mười class, mỗi class hai dòng, nối nhau bằng dependency, chẳng có gì để test
mỗi class ngoài "gọi class tiếp theo". Đây không phải SRP — đây là **tách
file**. `OrderService` gốc dễ hiểu hơn vì luồng nhìn thấy được ở một chỗ;
phiên bản vụn vỡ giấu luồng sau một chuỗi dependency. Kiểm tra SRP áp dụng
đối xứng:

> **Một class có một lý do để thay đổi — nhưng nó cũng phải là một class
> xứng đáng tồn tại. Nếu một "responsibility" không có quy tắc, không có
> state, không có hành vi ngoài việc chuyển tiếp, nó không phải
> responsibility — nó là trạm chuyển phát.** Tách khi mỗi phần mang logic
> thật; điều phối khi các phần tầm thường.

Phán đoán: SRP nói về _cô lập thay đổi_, không phải _số lượng class_. Năm
class mỗi class một responsibility thật tốt hơn một class mang năm
responsibility — và tốt hơn hai mươi class không mang gì.

### 3.2 O — Open/Closed Principle: Bảo Vệ Điểm Biến Thiên

**Vấn đề thực.** Lại là payment dispatcher, nhưng giờ nỗi đau cụ thể: thêm
một loại thanh toán là một _sửa đổi_ vào code dùng chung. Tình huống ai cũng
nhận ra:

```java
public class PaymentService {
    public void pay(Payment payment) {
        if (payment.getType().equals("CARD")) {
            cardGateway.charge(payment.getReference(), payment.getAmount());
        } else if (payment.getType().equals("BANK_TRANSFER")) {
            bankGateway.transfer(payment.getReference(), payment.getAmount());
        } else if (payment.getType().equals("E_WALLET")) {
            walletGateway.pay(payment.getReference(), payment.getAmount());
        } else {
            throw new UnsupportedPaymentTypeException(payment.getType());
        }
    }
}
```

Business nói: "Thêm PayPal." Thay đổi là:

```java
        } else if (payment.getType().equals("PAYPAL")) {
            paypalGateway.pay(payment.getReference(), payment.getAmount());
        }
```

Vì sao thay đổi nhỏ này rủi ro? Vì file bị sửa là file _dùng chung_ — nó
chứa đường thanh toán thẻ đang chạy tiền thật. Bất kỳ đặt sai chỗ, merge
conflict, refactor dở dang nào trong file đó đều đe dọa mọi loại thanh toán,
không chỉ loại mới. Thay đổi là _một dòng_ và bán kính nổ là _cả class_. Qua
nhiều tháng, method này tích mười loại, và hồ sơ rủi ro của nó giờ là mười
sản phẩm thanh toán cắm vào một file.

**Nguyên tắc.** Open/Closed Principle nói: một module nên **mở cho việc mở
rộng** (bạn có thể thêm hành vi) và **đóng với việc sửa đổi** (thêm hành vi
không đòi hỏi sửa module hiện có). Sự đính chính quan trọng, vì nguyên tắc
này bị trích dẫn sai liên tục:

> **OCP KHÔNG có nghĩa là "không bao giờ sửa code hiện có."** Nó có nghĩa:
> hãy bảo vệ _điểm biến thiên_ — nơi bạn biết các biến thể mới sẽ tới — bằng
> một abstraction, để thêm một biến thể là một _phép cộng_ (class mới, đăng
> ký mới) thay vì một _phép sửa_ (sửa code dùng chung). Bạn không né tránh
> thay đổi; bạn đang định tuyến nó.

Loại thay đổi OCP bảo vệ là _một chiều_: một thành viên mới của một gia đình
đã biết (loại thanh toán, kênh thông báo, định dạng báo cáo, điểm đích
export). Với gia đình đó, bạn muốn chi phí "thêm" nhỏ và cô lập, và chi phí
"sửa" bằng không.

**Refactoring với polymorphism + đăng ký (Strategy).** Dùng map strategy từ
Phần 2.4:

```java
public class PaymentService {
    private final Map<PaymentType, PaymentStrategy> strategies;

    public PaymentService(Map<PaymentType, PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentResult pay(Payment payment) {
        PaymentStrategy strategy = strategies.get(payment.getType());
        if (strategy == null) {
            throw new UnsupportedPaymentTypeException(payment.getType());
        }
        return strategy.pay(payment);
    }
}
```

Thêm PayPal giờ là: một class `PayPalPaymentStrategy` mới, và một entry trong
map (thường là một `@Bean` Spring hoặc dòng config — thường zero sửa đổi
Java). `PaymentService` không bao giờ đổi nữa vì một loại thanh toán mới.
File dùng chung — cái file chạy tiền thật — đã đóng.

**Trade-offs.** Cái này mua được gì, và tốn gì?

| Mua được                                   | Tốn                                          |
| ------------------------------------------ | -------------------------------------------- |
| Biến thể mới không đụng code dùng chung    | Một abstraction mới (interface + registry)   |
| Mỗi biến thể test độc lập được             | Dispatch giờ gián tiếp                       |
| Logic biến thể sống cạnh dependency của nó | Độ dễ đọc "một method hiện mọi nhánh" mất đi |

**Trường hợp đặc biệt — khi nào KHÔNG áp dụng OCP.**

1. **Điểm biến thiên chưa biết.** Bạn không thể "bảo vệ" một biến thiên
   chưa từng thấy. Xây registry strategy cho _loại thanh toán đầu tiên_ là
   đầu cơ. Chuỗi trung thực: viết `if`, cảm thấy nhánh thứ hai tới, _rồi_
   mới giới thiệu abstraction. Refactoring về OCP rẻ khi các nhánh nhỏ; đoán
   sai điểm biến thiên thì đắt.

2. **Thay đổi không một chiều.** Nếu "loại thanh toán mới" cũng thay đổi
   cách đơn hàng chảy, cách refund hoạt động, biên lai trông ra sao — không
   bảng dispatch nào chứa được thay đổi; biến thiên là cắt ngang và interface
   sẽ rò rỉ (gia đình "không phải gia đình" ở Phần 2.2).

3. **Gia đình đóng sẵn theo bản chất.** `sealed` enum (Phần VII) hoặc sealed
   class hierarchy cố ý khóa gia đình lại. Khi đó "đóng với sửa đổi" là _điều
   mong muốn_: switch exhaustiveness mà compiler kiểm tra tốt hơn một map
   đăng ký bạn có thể quên cập nhật.

Phán đoán lặp lại: OCP là một ván cược về _chiều nào sẽ lớn lên_. Chỉ đặt
cược khi sự lớn lên đó nhìn thấy được.

### 3.3 L — Liskov Substitution Principle: Tương Thích Về Hành Vi

LSP là nguyên tắc SOLID duy nhất _không_ về quản lý thay đổi — nó về **tính
đúng đắn của hệ thống kiểu**. Nó trả lời: khi nào một subclass được phép
thay thế parent?

**Vấn đề thực.** Quên `Bird` và `Penguin` đi. Đây là phiên bản backend, và
nó fail ở production, không phải ở sở thú.

```java
public class VoucherDiscount {
    private final BigDecimal percentage;

    public VoucherDiscount(BigDecimal percentage) {
        this.percentage = percentage;
    }

    public BigDecimal apply(BigDecimal total) {
        return total.multiply(BigDecimal.ONE.subtract(percentage));
    }
}
```

Luồng checkout dùng `VoucherDiscount` đa hình — nó nằm trong một
`List<VoucherDiscount>` và được áp cho mọi đơn hàng:

```java
public BigDecimal applyAll(List<VoucherDiscount> vouchers, BigDecimal total) {
    BigDecimal result = total;
    for (VoucherDiscount voucher : vouchers) {
        result = voucher.apply(result);
    }
    return result;
}
```

Giờ business thêm voucher "chi tiêu tối thiểu": chỉ đơn trên 200 mới được
giảm. Developer viết:

```java
public class MinimumSpendVoucher extends VoucherDiscount {
    private final BigDecimal minimumSpend;

    public MinimumSpendVoucher(BigDecimal percentage, BigDecimal minimumSpend) {
        super(percentage);
        this.minimumSpend = minimumSpend;
    }

    @Override
    public BigDecimal apply(BigDecimal total) {
        if (total.compareTo(minimumSpend) < 0) {
            throw new IllegalArgumentException("order below minimum spend");
        }
        return super.apply(total);
    }
}
```

Nó biên dịch. Nó vượt test của chính nó. Và nó làm sập checkout ở production,
vì `applyAll` không hề biết `VoucherDiscount.apply()` có thể ném exception.
Contract của parent nói: "trả về tổng đã giảm giá." Precondition mạnh hơn
của subclass ("caller không được truyền tổng dưới 200") vi phạm nó.

**Nguyên tắc.** LSP nói: nếu `S` là subtype của `T`, thì mọi tính chất đúng
với object kiểu `T` cũng phải đúng với object kiểu `S` — một subclass phải
dùng được _ở mọi nơi_ parent dùng được, mà caller không cần biết. Cụ thể, nó
nói về ba loại điều khoản contract:

| Điều khoản    | Ý nghĩa                               | Quy tắc của subtype                         |
| ------------- | ------------------------------------- | ------------------------------------------- |
| Precondition  | Caller phải đảm bảo gì trước khi gọi  | Chỉ được **nới lỏng**, không được thắt chặt |
| Postcondition | Lời gọi đảm bảo gì sau khi trả về     | Chỉ được **mạnh lên**, không được yếu đi    |
| Invariant     | Điều gì đúng trước và sau mọi lời gọi | Phải được giữ nguyên                        |
| Exception     | Từ vựng thất bại của method           | Phải nằm trong từ vựng của parent           |

`MinimumSpendVoucher` **thắt chặt precondition** ("total phải >= 200") và
**thêm exception mới** mà caller không xử lý. `@Override` biên dịch sạch —
LSP là contract hành vi, và compiler kiểm tra _signature_, không kiểm tra
_hành vi_.

**Thêm các mẫu vi phạm để nhận diện.** Đây là những hình dạng bạn gặp trong
code thật, kèm triệu chứng:

```java
// Mẫu 1: subclass ném thứ parent cho phép tường minh
public class ReadOnlyAccount extends BankAccount {
    @Override
    public void withdraw(BigDecimal amount) {
        throw new UnsupportedOperationException("read-only account");
    }
}
// Caller: account.withdraw(...) — biên dịch sạch, nổ lúc chạy vì caller
// không thể biết subtype này cấm thao tác.

// Mẫu 2: subclass trả về kết quả yếu hơn
public class CacheOrderRepository extends OrderRepository {
    @Override
    public Order findById(String id) {
        Order cached = cache.get(id);
        return cached != null ? cached : null;   // parent không bao giờ trả null
    }
}
// Caller tin vào non-null; NPE hai frame sau, cách xa nguyên nhân.

// Mẫu 3: caller tự vệ bằng instanceof
public void refund(Payment payment) {
    if (payment instanceof CryptoPayment) {
        // crypto không refund được như các loại khác — special-case nó
    }
    ...
}
// Ngay khi code client phải biết nó đang giữ subclass nào,
// polymorphism chết và LSP bị vi phạm.
```

Mỗi mẫu là một _lệch hành vi_ mà vẫn biên dịch. Đó chính là điểm của phần
này:

> **Tương thích lúc compile nói về signature. Tương thích về hành vi nói về
> contract. `@Override` chứng minh điều thứ nhất; chỉ kỷ luật thiết kế mới
> cho bạn điều thứ hai.**

**Vì sao điều này xảy ra?** Vì "is-a" được quyết định trên cấu trúc ("tài
khoản chỉ đọc _là_ một tài khoản") thay vì trên hành vi ("subclass này có
tôn trọng mọi thứ parent hứa không?"). Cách sửa hiếm khi là "sửa subclass" —
thường cây phân cấp đã sai:

- **Read-only account** không phải subtype của một `BankAccount` _mutable_;
  nó là một loại object khác. Cách sửa: trích một interface (`AccountView`
  hay `BalanceProvider`) mà cả hai đều tôn trọng, hoặc `FrozenAccount` có
  `withdraw()` _là_ một thao tác rỗng trên state tài khoản — mô hình hóa
  freeze là state, không phải là type.
- **Cache repository trả null** nên trả `Optional<Order>` — contract khi đó
  _trung thực_ thừa nhận sự vắng mặt, và cả hai implementation đều thỏa mãn.
- **Voucher chi tiêu tối thiểu** nên được _compose_: một voucher với
  eligibility predicate lọc trước khi `apply()` — contract gốc không bao giờ
  biết đến giới hạn.

**Quy tắc ngón tay cái:** trước khi viết `extends`, tự hỏi: _mọi caller của
parent có thể cư xử y hệt với subclass này, mà không cần biết nó có mặt
không?_ Nếu câu trả lời cần một điều kiện kèm theo, cây phân cấp sai.

**Trade-offs và trường hợp đặc biệt.** Tính nghiêm ngặt của LSP nói về _nơi
cây phân cấp là thật_. Với hệ thống phân cấp thư viện sâu (`Exception`,
`InputStream`), contract cực kỳ quan trọng. Với cây phân cấp nội bộ nhỏ, một
caller, một shortcut thực dụng (subclass special-case một method) có thể rẻ
hơn thiết kế lại — nhưng bạn đang vay từ tính đúng đắn để trả cho tốc độ, và
bạn nên biết điều đó. Sealed classes (Phần VII) cho Java một công cụ sẵn có
để giới hạn ai được subclass cái gì, biến "ai cũng được extends" thành "chỉ
những biến thể đã biết này" — sự bảo vệ LSP sạch nhất Java có.

### 3.4 I — Interface Segregation Principle: Interface Được Định Cỡ Cho Client

**Vấn đề thực.** Một interface `ReportService`, lớn lên theo kiểu tích lũy:

```java
public interface ReportService {
    byte[] generateCsv(ReportQuery query);
    byte[] generatePdf(ReportQuery query);
    byte[] generateXlsx(ReportQuery query);
    void sendByEmail(byte[] report, String recipient);
    void uploadToS3(byte[] report, String path);
}
```

Ba implementation cụ thể tồn tại: `CsvReportService`, `PdfReportService`,
`XlsxReportService`. Mỗi cái implement interface, và mỗi cái phải cung cấp
cả năm method. `CsvReportService` không thể tạo PDF và chẳng có lý do gì để
upload S3 — nên nó chứa:

```java
public class CsvReportService implements ReportService {
    @Override
    public byte[] generateCsv(ReportQuery query) { /* logic thật */ }

    @Override
    public byte[] generatePdf(ReportQuery query) {
        throw new UnsupportedOperationException("CSV service cannot generate PDFs");
    }

    @Override
    public byte[] generateXlsx(ReportQuery query) {
        throw new UnsupportedOperationException("CSV service cannot generate XLSX");
    }

    @Override
    public void sendByEmail(byte[] report, String recipient) {
        throw new UnsupportedOperationException("email not supported");
    }

    @Override
    public void uploadToS3(byte[] report, String path) {
        throw new UnsupportedOperationException("upload not supported");
    }
}
```

**Vì sao nó đau đớn.** Interface ép mọi client của `ReportService` biết về
các method nó sẽ không bao giờ gọi, và ép mọi implementation mang code chết.
Signature `sendByEmail(byte[] report, String recipient)` cũng là một _rò rỉ_
— "byte[]" là khái niệm kiểu PDF; client CSV không nghĩ theo byte array.
Client phụ thuộc interface, interface phụ thuộc hợp của nhu cầu mọi client,
nên mọi client về mặt khái niệm phụ thuộc yêu cầu của mọi client khác. Một
thay đổi trong luồng PDF đụng interface, buộc biên dịch lại và test lại luồng
CSV — cùng rủi ro file dùng chung như OCP, nhưng ở cấp interface.

**Nguyên tắc.** Interface Segregation nói: **không client nào bị buộc phụ
thuộc vào các method nó không dùng.** Tách interface béo theo ranh giới
client — mỗi interface diễn đạt một năng lực mạch lạc:

```java
public interface CsvReportGenerator {
    byte[] generateCsv(ReportQuery query);
}

public interface PdfReportGenerator {
    byte[] generatePdf(ReportQuery query);
}

public interface ReportDeliverable {
    void sendByEmail(byte[] report, String recipient);
}
```

Giờ `CsvReportService implements CsvReportGenerator` (và, nếu luồng CSV có
gửi email, thêm `ReportDeliverable`). Client nhận đúng interface nó cần:

```java
public class ReportBatchJob {
    private final CsvReportGenerator csvGenerator;   // chỉ thứ nó dùng
    private final ReportDeliverable deliverable;

    public ReportBatchJob(CsvReportGenerator csvGenerator, ReportDeliverable deliverable) {
        this.csvGenerator = csvGenerator;
        this.deliverable = deliverable;
    }
}
```

**Default methods và Adapter như những biện pháp giảm nhẹ.** Thư viện thật
(interface JDK, SDK bên thứ ba) béo sẵn và bạn không sửa được. Hai công cụ:

- **Default methods** cho phép một interface béo lớn lên mà không phá vỡ
  những implementor hiện có (`Collection.removeIf` là ví dụ kinh điển: thêm
  vào Java 8 như một default để `ArrayList` và mọi custom collection vẫn
  compile). Dùng khi _interface ổn định và sự lớn lên là một method_; đừng
  dùng để _che giấu_ rằng interface đang béo.
- **Adapter pattern** (Phần III) có thể dịch một API béo của bên thứ ba thành
  nhiều interface domain hẹp, giữ hình dạng SDK khỏi code nghiệp vụ.

**Vấn đề ngược: interface vỡ vụn.** Segregation có thể bị áp quá tay. Hãy
xem:

```java
public interface Identifiable { String getId(); }
public interface Timestamped { Instant getCreatedAt(); }
public interface Auditable extends Timestamped { String getCreatedBy(); }
public interface HasName { String getName(); }
public interface HasEmail { String getEmail(); }
public interface Validatable { void validate(); }
public interface Serializable { ... }   // đã tồn tại, nhưng bạn hiểu ý

public class User implements Identifiable, Timestamped, HasName, HasEmail, Validatable { ... }
```

**Khi nào đây là over-engineering?** Khi các interface là _marker dữ liệu_
thay vì _năng lực hành vi_: mọi client dùng `User` đều dùng mọi field của
nó; không gì phụ thuộc riêng `HasEmail`; và codebase giờ có bảy cái tên để
điều hướng tìm một class. Segregation có lợi khi **các client khác nhau ở
chỗ chúng cần gì** — một `ReportBatchJob` chỉ cần generate CSV là một client
thật, riêng biệt. Nếu mọi client cần mọi thứ, interface vốn đã mạch lạc, và
tách nó là nghi thức. Kiểm tra:

> **Một interface tách ra được biện minh khi tồn tại một client thật chỉ
> cần phần được tách.** Client giả định không tính — cùng quy tắc volatility
> như mọi nguyên tắc khác.

### 3.5 D — Dependency Inversion Principle: Chính Sách Cao Cấp Sở Hữu Abstraction

Đây là phần sâu nhất trong năm, và bị lạm dụng nhiều nhất — vì nó liên tục
bị nhầm với người anh em Dependency Injection. Chúng không phải một thứ:

|                    | Dependency Inversion (DIP)                    | Dependency Injection (DI)            |
| ------------------ | --------------------------------------------- | ------------------------------------ |
| Nó là gì           | Quy tắc về _hướng_ của dependency             | _Cơ chế_ cung cấp dependency         |
| Câu hỏi nó trả lời | Module nào sở hữu abstraction?                | Object lấy dependency bằng cách nào? |
| Nó sống ở đâu      | Trong kiến trúc (hình dạng package/component) | Trong việc xây dựng object           |
| Quan hệ            | DI là một cách _implement_ DIP                | DIP là một _lý do_ dùng DI           |

**Vấn đề thực.** Một luồng nghiệp vụ cao cấp phụ thuộc implementation cấp
thấp:

```java
public class OrderService {
    private final MySqlOrderRepository repository;

    public OrderService(MySqlOrderRepository repository) {
        this.repository = repository;
    }

    public void save(Order order) {
        repository.insert(order);
    }

    public Order find(String id) {
        return repository.selectById(id);
    }
}
```

`OrderService` — module mã hóa chính sách nghiệp vụ — bị ghim vào
`MySqlOrderRepository` — module mã hóa SQL, connection, và một vendor cụ
thể. Mọi quyết định chính sách giờ phụ thuộc quyết định lưu trữ: chuyển
PostgreSQL, thêm cache phía trước, hay dùng implementation in-memory cho test
nghĩa là _sửa class chính sách_ hoặc fake một class concrete với chi tiết
vendor trong method của nó. Mũi tên dependency trỏ _lên_: chính sách → vendor.

**Nguyên tắc.** Dependency Inversion đảo ngược mũi tên đó:

> **A. Module cấp cao không nên phụ thuộc module cấp thấp. Cả hai nên phụ
> thuộc abstraction.**
> **B. Abstraction không nên phụ thuộc chi tiết. Chi tiết nên phụ thuộc
> abstraction.**

Insight chủ chốt — thứ các tutorial hay bỏ qua — là câu thứ hai của A:
**abstraction được sở hữu bởi module cấp cao**. Nó diễn đạt _nhu cầu_ của
chính sách, không phải _thứ vendor cung cấp_:

```java
public interface OrderRepository {          // thuộc về lớp chính sách
    void save(Order order);
    Order findById(String id);
}
```

```java
public class OrderService {
    private final OrderRepository repository;   // phụ thuộc abstraction

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }

    public void save(Order order) {
        repository.save(order);
    }

    public Order find(String id) {
        return repository.findById(id);
    }
}
```

```java
public class MySqlOrderRepository implements OrderRepository {
    // SQL, connection, chi tiết vendor — một chi tiết, implement contract
    // của lớp chính sách
    @Override
    public void save(Order order) { /* INSERT INTO orders ... */ }

    @Override
    public Order findById(String id) { /* SELECT * FROM orders WHERE id = ? */ }
}
```

Giờ đồ thị dependency là:

```text
                OrderService (chính sách)
                      │
                      ▼
              OrderRepository (abstraction)      ← thuộc về lớp chính sách
                      ▲
                      │
              MySqlOrderRepository (chi tiết)    ← implement contract
```

Cả hai module đều phụ thuộc abstraction; abstraction diễn đạt nhu cầu của
chính sách; chi tiết tuân thủ. Đây chính là phong cách **Ports and
Adapters**: interface là _port_ (yêu cầu của chính sách), implementation là
_adapter_ (chi tiết thực hiện yêu cầu).

**Cái này mua được gì.** Module cấp cao giờ tái sử dụng và test được độc lập
với lưu trữ: một `InMemoryOrderRepository` cho test, một
`CachedOrderRepository` cho hot path production, một implementation
PostgreSQL hoán đổi mà không đụng chính sách. Thay đổi từng đe dọa
`OrderService` (thay lưu trữ) giờ sinh ra một adapter mới — hiệu ứng OCP
kinh điển ở cấp dependency.

**Dependency Injection và Spring.** DIP là _cái gì_; DI là _bằng cách nào_.
Việc xây dựng đồ thị — ai tạo gì và đưa cho ai — là Dependency Injection, và
công cụ chuẩn của Java là một container. Phiên bản Spring Boot:

```java
@Service
public class OrderService {
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) {   // constructor injection
        this.repository = repository;
    }
}
```

Spring thực sự làm gì ở đây:

1. **Component scanning** phát hiện các class `@Service`, `@Repository`,
   `@Component` lúc khởi động.
2. **Bean instantiation** tạo một singleton instance cho mỗi component
   (lười biếng, và theo thứ tự dependency).
3. **Constructor injection** giải quyết tham số constructor của
   `OrderService` — tìm _bean duy nhất_ kiểu `OrderRepository` trong
   container — và truyền vào.

Quan trọng: Spring không cần biết chọn implementation _nào_ — quyết định đó
được đưa ra hoặc theo kiểu (một implementation), hoặc tường minh qua
`@Primary`/`@Qualifier`/`@Configuration` khi có nhiều:

```java
@Configuration
public class RepositoryConfig {
    @Bean
    @Primary
    public OrderRepository orderRepository(DataSource dataSource) {
        return new MySqlOrderRepository(dataSource);
    }

    @Bean
    public OrderRepository cacheableOrderRepository(OrderRepository delegate) {
        return new CachedOrderRepository(delegate);
    }
}
```

Container chỉ luôn luôn là một _composition root_ — nơi duy nhất đồ thị
dependency được lắp ráp. `OrderService` ở trên không biết gì về
`MySqlOrderRepository` hay `CachedOrderRepository`; nó chỉ biết port.

**Khi nào giới thiệu interface thuần để phục vụ DI là không cần thiết.**
Đây là trường hợp lạm dụng, và nó có ở khắp nơi. Anti-pattern:

```java
// Một implementation. Mãi mãi. Và interface không diễn đạt gì mà lớp
// chính sách cần ngoài những gì class đã có.
public interface UserRepository { ... }

public class UserRepositoryImpl implements UserRepository {
    // implementation DUY NHẤT
}
```

Khi nào interface này vô nghĩa? Khi:

1. Có **đúng một implementation** và không thấy implementation thứ hai thật
   sự.
2. Interface **soi gương method của class** thay vì diễn đạt một yêu cầu
   chính sách — nó là bản sao, không phải contract.
3. Người tiêu dùng duy nhất "cần" nó là test suite — và framework mock của
   bạn (Mockito mock được concrete class) xử lý được việc đó không cần
   interface.

Trong trường hợp đó interface không làm việc của DIP; nó là nghi thức đặt
tên. Spring không yêu cầu interface — `@Service` trên class concrete, inject
constructor class concrete, hoàn toàn idiomatic với một implementation.
Interface xứng đáng tồn tại theo cùng cách mọi abstraction trong bài này
xứng đáng: **một biến thể thứ hai thật, hoặc một contract chính sách thật mà
class concrete không diễn đạt được.**

**Tóm tắt DIP.** Trỏ mũi tên dependency vào abstraction do module cấp cao sở
hữu; dùng constructor injection để lắp đồ thị; và từ chối interface chỉ phục
vụ quy ước. DIP nói về hướng thay đổi đi — chính sách không bao giờ nên thay
đổi chỉ vì lưu trữ đổi.

---

## 4. Phần III — Design Patterns: Vấn Đề Chúng Giải Quyết, Cái Giá Chúng Trả

23 pattern GoF không phải một catalog để học thuộc; chúng là 23 _giải pháp
đã được chứng minh cho những vấn đề tái diễn_, và mỗi cái có một cái giá.
Phần này bao phủ sáu pattern mà một backend Java thực tế gặp liên tục — được
sắp theo vấn đề chúng giải quyết, không theo tên. Với mỗi cái: vấn đề, hình
dạng tồi, pattern, trade-offs, và khi nào nó là thừa.

| Pattern   | Vấn đề nó giải quyết                     |
| --------- | ---------------------------------------- |
| Strategy  | Một gia đình hành vi thay thế lẫn nhau   |
| Factory   | Tạo object có logic lựa chọn             |
| Builder   | Xây dựng object nhiều tham số            |
| Adapter   | API bên ngoài không khớp mô hình của bạn |
| Decorator | Thêm hành vi mà không đụng lõi           |
| Observer  | Một sự kiện, nhiều bên quan tâm          |

### 4.1 Strategy: Một Gia Đình Hành Vi Thay Thế Lẫn Nhau

**Vấn đề.** Bạn đã thấy nó hai lần — payment dispatcher (Phần 2.4) là kịch
bản Strategy chuẩn:

```java
if (payment.getType() == PaymentType.CARD) {
    cardGateway.charge(...);
} else if (payment.getType() == PaymentType.BANK_TRANSFER) {
    bankGateway.transfer(...);
} else if (payment.getType() == PaymentType.E_WALLET) {
    walletGateway.pay(...);
}
```

Nỗi đau, chính xác: _quyết định_ (loại nào → hành vi nào) và _các hành vi_
bị hợp nhất trong một method; thêm một loại là sửa sự hợp nhất đó.

**Pattern.** Trích các hành vi đằng sau một interface và để caller giữ một
strategy — hoặc inject trực tiếp hoặc tra theo loại:

```java
public interface PaymentStrategy {
    PaymentResult pay(Payment payment);
}
```

```java
public class CardPaymentStrategy implements PaymentStrategy {
    private final CardGateway cardGateway;

    public CardPaymentStrategy(CardGateway cardGateway) {
        this.cardGateway = cardGateway;
    }

    @Override
    public PaymentResult pay(Payment payment) {
        return cardGateway.charge(payment.getReference(), payment.getAmount());
    }
}
```

Lựa chọn qua một registry (xây một lần, tại composition root):

```java
public class PaymentStrategyFactory {
    private final Map<PaymentType, PaymentStrategy> strategies;

    public PaymentStrategyFactory(Map<PaymentType, PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentStrategy forType(PaymentType type) {
        PaymentStrategy strategy = strategies.get(type);
        if (strategy == null) {
            throw new UnsupportedPaymentTypeException(type);
        }
        return strategy;
    }
}
```

```java
PaymentStrategy strategy = factory.forType(payment.getType());
PaymentResult result = strategy.pay(payment);
```

**Vì sao Strategy có tác dụng.** Nó là ba ý tưởng bạn đã gặp, gộp vào một
chỗ:

- **Polymorphism** lo việc dispatch (mỗi strategy implement contract).
- **OCP** là phần thưởng (loại mới = strategy mới + đăng ký, không sửa luồng).
- **SRP** là sản phẩm phụ (mỗi strategy sở hữu logic và dependency của nó;
  luồng chỉ sở hữu việc lựa chọn).

**Trade-offs.** Chuỗi trở thành một class mỗi biến thể cộng một registry.
Luồng giờ được đọc qua indirection: `strategy.pay(...)` không nói cho bạn
biết chuyện gì xảy ra — bạn phải biết những strategy nào tồn tại. Với ba
nhánh ổn định, indirection có thể là chi phí thuần. Strategy cũng là poster
child hiện đại của sự đơn giản hóa, vì Java 8 biến nó thành một dòng:
interface có một method, nên nó là một **functional interface** và caller có
thể truyền lambda thay vì class (Phần VII).

**Khi nào Strategy là thừa.** Quy tắc quyết định từ Phần 2.4, viết thành
checklist:

- Chỉ hai nhánh, ổn định nhiều năm → một `if` thường tốt hơn. (Guard
  "CANCELLED order" không phải strategy; nó là một quy tắc.)
- Các "biến thể" không thay thế lẫn nhau — một cái đồng bộ, một cái cần
  tương tác người dùng, một cái không retry được → chúng không phải một gia
  đình; interface chung buộc chúng giả vờ (leaky abstraction).
- Biến thiên _chéo chiều_ (loại + quốc gia + tiền tệ) → một interface
  strategy không chứa được; bạn sẽ cần ma trận strategy, và lúc đó rule
  engine hoặc dữ liệu cấu hình thắng class.

### 4.2 Factory: Tạo Object Có Quyết Định Bên Trong

**Vấn đề.** `new` là cách tạo object đơn giản nhất, và nó là công cụ sai
đúng khi việc tạo _liên quan một quyết định_. Quyết định-trong-tạo-object
xuất hiện ở đâu trong backend thật? Chọn strategy theo loại (thấy ở trên),
xây provider cho một quốc gia, chọn discount policy từ config, hay xây một
domain object có wiring phụ thuộc ngữ cảnh.

**Simple Factory.** Ví dụ thanh toán, được chính thức hóa:

```java
public class PaymentProcessorFactory {
    private final Map<PaymentType, PaymentStrategy> strategies;

    public PaymentProcessorFactory(Map<PaymentType, PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentStrategy create(PaymentType type) {
        PaymentStrategy strategy = strategies.get(type);
        if (strategy == null) {
            throw new UnsupportedPaymentTypeException(type);
        }
        return strategy;
    }
}
```

Chỉ vậy — toàn bộ pattern. (Chú ý: "Simple Factory" này không nằm trong 23
pattern GoF; nó là helper thực dụng ai cũng dùng, và Factory Method /
Abstract Factory của GoF là những người anh em chặt chẽ hơn của nó. Bắt đầu
từ đây.) Logic tạo của caller biến mất:

```java
// trước: caller biết map, fallback, kiểu lỗi
// sau:  caller hỏi; factory sở hữu quyết định
PaymentStrategy strategy = processorFactory.create(payment.getType());
```

**Factory Method.** Khi _subclass_ nên quyết định luồng template tạo object
nào. Hình dạng backend kinh điển: một luồng base với một creation hook:

```java
public abstract class RefundFlow {
    public final void execute(RefundRequest request) {
        PaymentRefundHandler handler = createRefundHandler();   // hook
        handler.refund(request);
        notifyCustomer(request);
    }

    protected abstract PaymentRefundHandler createRefundHandler();
}
```

```java
public class CardRefundFlow extends RefundFlow {
    @Override
    protected PaymentRefundHandler createRefundHandler() {
        return new CardRefundHandler(cardGateway);
    }
}
```

Template (refund → notify) cố định; object được tạo là biến thiên. Factory
Method phù hợp khi _luồng ổn định_ và _vật được tạo biến thiên theo
subclass_. Nếu chỉ vật được tạo biến thiên và luồng tầm thường, Simple
Factory ở trên đủ — thuế inheritance của Factory Method không xứng đáng.

**Abstract Factory.** Khi bạn cần một _gia đình_ object liên quan phải giữ
tính nhất quán. Một provider không chỉ là gateway — nó là gateway, refund
handler, receipt generator, và currency validator, và chúng phải cùng một
vendor:

```java
public interface PaymentProviderFactory {
    PaymentGateway createGateway();
    RefundHandler createRefundHandler();
    ReceiptGenerator createReceiptGenerator();
}
```

```java
public class StripeProviderFactory implements PaymentProviderFactory {
    private final StripeSdk stripe;

    public StripeProviderFactory(StripeSdk stripe) {
        this.stripe = stripe;
    }

    @Override
    public PaymentGateway createGateway() { return new StripeGatewayAdapter(stripe); }

    @Override
    public RefundHandler createRefundHandler() { return new StripeRefundHandler(stripe); }

    @Override
    public ReceiptGenerator createReceiptGenerator() { return new StripeReceiptGenerator(stripe); }
}
```

Bảo đảm: code xây luồng thanh toán qua một factory không bao giờ trộn gateway
của Stripe với refund handler của Adyen. Trong Spring, factory thường là ẩn
— mỗi method factory `@Bean` tạo một thành viên của gia đình, và container
thực thi tính nhất quán bằng chính việc xây dựng. Abstract Factory là pattern
bạn với tới khi gia đình là thật (trộn vendor là một bug); nó là nghi thức
thuần khi chỉ có một vendor và mỗi gia đình một thành viên.

**Trường hợp đặc biệt: factory chỉ bọc `new`.** Đây là pattern xứng đáng bị
nghi ngờ nhất:

```java
public class CarFactory {
    public Car createCar() {
        return new Car();          // factory chẳng thêm gì
    }
}
```

Giá trị của factory là _quyết định nó giấu_ — map lookup, check config, tính
nhất quán gia đình. Một factory vô điều kiện gọi `new` không giấu gì và thêm
một indirection; caller nên tự viết `new Car()` (hoặc, trong Spring, khai báo
một `@Bean`). **Kiểm tra: factory có bao giờ trả về thứ khác với input hay
ngữ cảnh khác không?** Nếu không — không có factory.

### 4.3 Builder: Khi Constructor Không Còn Truyền Đạt Được Nữa

**Vấn đề.** Constructor với tham số theo vị trí ngừng mở rộng ở khoảng ba
hoặc bốn tham số, và thất bại là thất bại im lặng:

```java
User user = new User(
    "Hung",
    "hung@example.com",
    28,
    "12 Nguyen Hue, Ho Chi Minh City",
    "0901234567",
    "ACCOUNTANT",
    true,          // isActive — hay là isVerified?
    "VN"
);
```

Cái `boolean` đó là gì? Phone đứng trước address hay sau? Đổi chỗ hai tham số
và code vẫn biên dịch — bug là _ngữ nghĩa_, compiler không phát hiện được,
đôi khi vô hình trong nhiều tháng. Rồi business thêm `referralCode` và
`marketingOptIn`, và mọi call site phải cập nhật để truyền thêm hai tham số
theo vị trí, hầu hết là null.

**Pattern.** Một builder lồng, fluent, validation tại `build()`:

```java
public final class User {
    private final String name;
    private final String email;
    private final int age;
    private final String address;
    private final String phone;
    private final boolean active;

    private User(UserBuilder builder) {
        this.name = builder.name;
        this.email = builder.email;
        this.age = builder.age;
        this.address = builder.address;
        this.phone = builder.phone;
        this.active = builder.active;
    }

    public static UserBuilder builder() {
        return new UserBuilder();
    }

    public static final class UserBuilder {
        private String name;
        private String email;
        private int age;
        private String address;
        private String phone;
        private boolean active = true;

        public UserBuilder name(String name) { this.name = name; return this; }
        public UserBuilder email(String email) { this.email = email; return this; }
        public UserBuilder age(int age) { this.age = age; return this; }
        public UserBuilder address(String address) { this.address = address; return this; }
        public UserBuilder phone(String phone) { this.phone = phone; return this; }
        public UserBuilder active(boolean active) { this.active = active; return this; }

        public User build() {
            if (name == null || name.isBlank()) {
                throw new IllegalArgumentException("name is required");
            }
            if (email == null || !email.contains("@")) {
                throw new IllegalArgumentException("email is invalid");
            }
            if (age < 0) {
                throw new IllegalArgumentException("age cannot be negative");
            }
            return new User(this);
        }
    }
}
```

Call site đọc như một bản đặc tả:

```java
User user = User.builder()
        .name("Hung")
        .email("hung@example.com")
        .age(28)
        .address("12 Nguyen Hue, Ho Chi Minh City")
        .active(true)
        .build();
```

**Vì sao Builder xứng đáng ở đây.** Nó cho: **readability** (mọi tham số
được gắn nhãn), **immutability** (class không setter; builder là đường tạo
duy nhất), **tham số tùy chọn** (đơn giản bỏ bước, default hợp lý giữ
nguyên), và **validation ở một chỗ** (`build()` kiểm tra, nên không `User`
nửa vời nào tồn tại được).

**Trường hợp đặc biệt — khi Builder là công cụ sai.**

1. **Object nhỏ.** Ba bốn tham số, tất cả bắt buộc: constructor thường tốt
   hơn — builder cho `Address(street, city, country)` là tiếng ồn.
2. **Java records.** Một record (Phần VII) cho immutability, equals/hashCode,
   và canonical constructor trong một khai báo — với value object điển
   hình, record _chính là_ sự cải thiện, không cần builder. Record cộng
   compact constructor kiểm tra tham số thay thế check `build()` của builder.
3. **Static factory methods.** Khi các biến thể là _khái niệm có tên_ thay vì
   _tổ hợp field_ — `User.createCustomer(...)` vs `User.createAdmin(...)` —
   static factory truyền đạt khái niệm; builder truyền đạt field. Dùng cái
   khớp với ý nghĩa.
4. **Cái bẫy "builder với default".** Builder với default ẩn (không set thì
   `active` là true hay false?) có thể lặng lẽ tạo object sai ý nghĩa nghiệp
   vụ. Ưu tiên required field tường minh — làm builder _fail_ khi thiếu thứ
   domain coi là bắt buộc.

Phán đoán: Builder giải quyết _độ đọc của tham số_ và _immutability_. Khoảnh
khắc records và static factories bao phủ được những thứ đó, boilerplate của
Builder (một chục dòng mỗi field) là chi phí phải biện minh — với 8+ tham số
trộn tùy chọn nó vẫn thắng; với 3 tham số nó thua.

### 4.4 Adapter: Khi API Bên Ngoài Không Nói Ngôn Ngữ Của Bạn

**Vấn đề.** Domain của bạn nói `PaymentRequest`, `PaymentResult`, `orderId`,
`BigDecimal`. SDK của provider thanh toán nói từ vựng của Stripe —
`StripeCharge`, `amountInCents`, `token`, `StripeException`. Cách tích hợp
ngây thơ viết code provider thẳng vào luồng nghiệp vụ:

```java
public class PaymentService {
    private final StripeSdk stripe;

    public void pay(Order order, String cardToken) {
        try {
            StripeCharge charge = stripe.charge(cardToken, toCents(order.getTotal()), "USD");
            // business logic giờ biết về StripeCharge, StripeException,
            // chuyển đổi cents, charge ids...
            order.setStatus(charge.getPaid() ? OrderStatus.PAID : OrderStatus.FAILED);
        } catch (StripeDeclinedException e) {
            // dịch exception inline — ở mọi call site
            order.setStatus(OrderStatus.PAYMENT_DECLINED);
        } catch (StripeNetworkException e) {
            throw new RuntimeException("stripe down", e);
        }
    }
}
```

**Vì sao nó tồi.** Ba kiểu thất bại, cộng dồn:

1. **Type của SDK rò rỉ khắp nơi.** `StripeCharge`, `StripeException`, và
   `toCents()` xuất hiện trong service, controller, luồng refund. Mô hình
   domain bị chiếm đóng bởi vendor.
2. **Mỗi call site tự implement lại phép dịch.** Try/catch dịch exception
   trên sẽ bị copy-paste vào refund, retry, reconciliation — và mỗi bản sao
   sẽ trôi dạt.
3. **Vendor sở hữu kiến trúc của bạn.** Đổi provider nghĩa là sửa mọi class
   nghiệp vụ chạm type Stripe — đúng cái coupling mà DIP (Phần 3.5) tồn tại
   để ngăn.

**Pattern.** Adapter đứng tại ranh giới. Domain của bạn định nghĩa interface
(`PaymentGateway`); một class adapter dịch lời gọi domain thành lời gọi SDK
và phản hồi SDK trở thành kết quả domain:

```java
public class StripeGatewayAdapter implements PaymentGateway {
    private final StripeSdk stripe;

    public StripeGatewayAdapter(StripeSdk stripe) {
        this.stripe = stripe;
    }

    @Override
    public PaymentResult pay(PaymentRequest request) {
        try {
            StripeCharge charge = stripe.charge(
                request.getMethod().getToken(),
                toCents(request.getAmount()),
                request.getCurrency());
            return PaymentResult.success(charge.getId());
        } catch (StripeDeclinedException e) {
            return PaymentResult.failure("declined: " + e.getMessage());
        } catch (StripeNetworkException e) {
            throw new PaymentUnavailableException("stripe unreachable", e);
        }
    }

    private static long toCents(BigDecimal amount) {
        return amount.movePointRight(2).longValueExact();
    }
}
```

Luồng giờ không còn vendor:

```java
public class PaymentService {
    private final PaymentGateway gateway;

    public void pay(Order order, PaymentRequest request) {
        PaymentResult result = gateway.pay(request);
        order.setStatus(result.isSuccess() ? OrderStatus.PAID : OrderStatus.FAILED);
        // không gì ở đây biết về Stripe, cents, hay token
    }
}
```

**Hệ quả.** Ranh giới domain được khôi phục: logic nghiệp vụ chỉ biết
`PaymentGateway`; type SDK sống trong adapter; việc đổi provider, nâng cấp
SDK, và dịch exception xảy ra ở đúng một chỗ mỗi provider. Đây cũng là DIP
ở dạng thực dụng nhất — adapter chính là "adapter" của Ports & Adapters
(Phần 3.5).

**Trade-offs và trường hợp đặc biệt.**

- Adapter phải trung thực về thứ nó không map được. Nếu từ vựng thất bại của
  SDK phong phú hơn domain của bạn (`payment_intent_requires_action`...), một
  `PaymentResult` hai giá trị sẽ buộc adapter làm phẳng thông tin — hãy quyết
  định liệu luồng nghiệp vụ có thực sự cần chi tiết đó, và nới domain type
  chỉ cho nhu cầu thật, không phải cho sự đầy đủ của SDK.
- **Adapter vs Facade.** Facade (không trình bày chi tiết ở đây) là _điểm
  vào được đơn giản hóa cho subsystem của chính bạn_; Adapter là _phép dịch
  một interface sang interface khác_. Trong thực tế, integration adapter
  thường làm cả hai — phơi một method sạch duy nhất mà bên trong phối hợp
  vài lời gọi SDK. Tên ít quan trọng hơn ranh giới có thật hay không.
- Khi SDK đã khớp domain (một số API hiện đại khá gần), wrapper vẫn thường
  đáng giá vì _một_ lý do thôi: try/catch dịch exception và đường nâng cấp.
  Nhưng một adapter mỏng chỉ chuyển tiếp lời gọi, không dịch gì, không map
  lỗi, không tăng testability, là nghi thức — nếu SDK ổn định và có hình dạng
  domain, dùng thẳng và quay lại khi nó đau.

### 4.5 Decorator: Thêm Hành Vi Mà Không Đụng Lõi

**Vấn đề.** Luồng thanh toán cần, ngoài việc trả tiền: retry trên lỗi thoáng
qua, audit logging mỗi lần thử, và metrics cho latency. Cách ngây thơ — sửa
implementation — có chi phí cộng dồn: logic retry viết trong
`StripeGatewayAdapter` phải viết lại cho mọi provider tương lai; metrics đan
xen với logic nghiệp vụ; và test "retry" cần một provider thật.

Cách ngây thơ thay thế — inheritance — còn tệ hơn. Để phủ hai provider với
ba hành vi (retry, logging, metrics), bạn cần:

```text
RetryingStripeAdapter   LoggingStripeAdapter     MetricsStripeAdapter
RetryingBankAdapter     LoggingBankAdapter       MetricsBankAdapter
RetryingLoggingStripeAdapter   LoggingMetricsBankAdapter  ...
```

Mỗi hành vi mới × mỗi provider mới = một class mới. Sự bùng nổ tổ hợp là
mùi cho biết "inheritance là cơ chế sai."

**Pattern.** Decorator compose hành vi _đệ quy qua cùng một interface_: mỗi
decorator implement `PaymentGateway`, giữ một `PaymentGateway` khác, làm
việc của nó, và ủy quyền:

```java
public class RetryDecorator implements PaymentGateway {
    private final PaymentGateway delegate;
    private final int maxAttempts;
    private final Duration backoff;

    public RetryDecorator(PaymentGateway delegate, int maxAttempts, Duration backoff) {
        this.delegate = delegate;
        this.maxAttempts = maxAttempts;
        this.backoff = backoff;
    }

    @Override
    public PaymentResult pay(PaymentRequest request) {
        PaymentResult result = delegate.pay(request);
        for (int attempt = 1; !result.isSuccess() && attempt < maxAttempts; attempt++) {
            sleepQuietly(backoff.multipliedBy(attempt));
            result = delegate.pay(request);
        }
        return result;
    }

    private static void sleepQuietly(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

```java
public class LoggingDecorator implements PaymentGateway {
    private final PaymentGateway delegate;
    private final AuditLogger auditLog;

    public LoggingDecorator(PaymentGateway delegate, AuditLogger auditLog) {
        this.delegate = delegate;
        this.auditLog = auditLog;
    }

    @Override
    public PaymentResult pay(PaymentRequest request) {
        long started = System.nanoTime();
        PaymentResult result = delegate.pay(request);
        auditLog.log("payment", request.getOrderId(), result, elapsedMillis(started));
        return result;
    }

    private static long elapsedMillis(long startedNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }
}
```

Composition tại điểm wiring — luồng, lõi, và provider không bị đụng tới:

```java
PaymentGateway gateway = new RetryDecorator(
        new LoggingDecorator(
                new MetricsDecorator(
                        new StripeGatewayAdapter(stripe))),
        3, Duration.ofMillis(200));
```

```text
PaymentService
     ↓
RetryDecorator        ← hành vi, độc lập với provider
     ↓
LoggingDecorator      ← hành vi, độc lập với provider
     ↓
MetricsDecorator      ← hành vi, độc lập với provider
     ↓
StripeGatewayAdapter  ← provider, độc lập với hành vi
```

**Vì sao nó có tác dụng.** Thêm một hành vi = thêm một class + một thay đổi
wiring; kết hợp N hành vi với M provider cần N + M class thay vì N × M.
Implementation lõi không bao giờ bị sửa. Pipeline nhìn thấy được tại điểm
composition — bạn đọc được toàn bộ thứ tự thực thi ở một chỗ. Và mỗi
decorator test độc lập được (bọc một fake delegate).

**Trade-offs — và cái bẫy thứ tự.** Decorator nhạy cảm với thứ tự, và thứ tự
là _ngữ nghĩa_:

- Retry _ngoài_ logging nghĩa là một lần thất bại được log mỗi attempt — tốt
  cho debug; retry _trong_ logging log trạng thái cuối một lần — tốt cho
  monitoring. Thứ tự khác nhau, bảo đảm khác nhau.
- Retry _ngoài_ metrics đếm mọi attempt; _trong_ chỉ đếm thành công. Cả hai
  đều bảo vệ được; vấn đề là thứ tự bọc là một quyết định thiết kế, không
  phải tai nạn — hãy viết nó nơi pipeline nhìn thấy được, và ghi chú bảo đảm
  mỗi tầng cung cấp.
- Stack trace sâu hơn và debug gián tiếp hơn: "tầng nào ném cái này?" thành
  một câu hỏi.
- Decorator khó thêm _state nhìn thấy được cho các tầng khác_ — một retry
  decorator không thể, nếu không có interface phụ, phơi "đã thử bao nhiêu
  lần" cho caller. Nếu dữ liệu đó là yêu cầu nghiệp vụ, decorator là công cụ
  sai; đưa nó vào result.

**Khi nào Decorator là thừa.** Nếu hành vi thêm là _thường trực, đơn lẻ, vô
điều kiện_ (mọi lần thanh toán luôn được audit-log), nó có thể sống trong
implementation — decorator mua sự linh hoạt bạn không cần. Decorator xứng
đáng các tầng của nó khi hành vi **kết hợp, biến thiên, hoặc tắt mở được**
(retry ở production nhưng không ở test; metrics cho vài kênh). Chú ý cả
shortcut Java hiện đại (Phần VII): với một functional interface, decorator
thành một dòng — `gateway = withRetry(gateway, 3)` qua static factory hoặc
lambda composition.

### 4.6 Observer / Event-Driven: Một Sự Kiện, Nhiều Bên Quan Tâm

**Vấn đề.** `placeOrder` lớn thêm một danh sách thông báo:

```java
public void placeOrder(Order order) {
    orderRepository.save(order);

    emailService.sendOrderConfirmation(order);     // bên 1
    inventoryService.reserveStock(order);          // bên 2
    analyticsService.trackOrderPlaced(order);      // bên 3
    notificationService.pushToCustomer(order);     // bên 4
    fraudService.screenOrder(order);               // bên 5 — sprint này mới thêm
}
```

**Vì sao nó tồi.** Luồng đơn hàng giờ _biết_ về email, inventory, analytics,
push, và fraud — và phải thay đổi mỗi khi một bên tham gia hay rời đi. Một
bên nào đó fail (email down?) sẽ kéo sập việc đặt hàng — kiểu thất bại của
các bên là kiểu thất bại của luồng. Latency của mỗi bên là latency của luồng.
Đây là vấn đề Observer: _nhiều hậu quả độc lập của một sự kiện_, hardwire
vào nguồn.

**Pattern, trong tiến trình: Spring events.** Publisher sở hữu sự kiện; các
bên quan tâm đăng ký; publisher không biết chúng:

```java
public record OrderCreatedEvent(String orderId, BigDecimal total, String customerId) {
}
```

```java
@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final ApplicationEventPublisher events;

    public OrderService(OrderRepository orderRepository, ApplicationEventPublisher events) {
        this.orderRepository = orderRepository;
        this.events = events;
    }

    @Transactional
    public void placeOrder(Order order) {
        orderRepository.save(order);
        events.publishEvent(new OrderCreatedEvent(order.getId(), order.getTotal(), order.getCustomerId()));
    }
}
```

```java
@Component
public class EmailOnOrderPlaced {
    @EventListener
    public void onOrderCreated(OrderCreatedEvent event) {
        emailService.sendOrderConfirmation(event.orderId());
    }
}
```

`OrderService` không còn biết email, inventory, analytics, hay fraud tồn
tại. Thêm một bên = thêm một class `@EventListener`; gỡ một bên = xóa nó;
một bên fail không còn phá vỡ việc đặt hàng (trừ khi bạn _muốn_ ngữ nghĩa
transactional — xem dưới).

**Leo thang kiến trúc: từ Observer đến Kafka.** Đây là nơi sự nhầm lẫn sống,
và nó phải được nói thẳng:

> **Observer pattern và Kafka không phải một thứ. Observer là một cấu trúc
> lập trình trong tiến trình; Kafka là hạ tầng xuyên tiến trình. Kafka so
> với Observer gần giống database so với `ArrayList` — người họ hàng xa giải
> quyết một quy mô vấn đề khác.**

| Khía cạnh            | Observer (event trong tiến trình)              | Kafka (event stream phân tán)                 |
| -------------------- | ---------------------------------------------- | --------------------------------------------- |
| Ranh giới tiến trình | Cùng JVM, cùng bộ nhớ                          | Nhiều service, nhiều máy                      |
| Giao hàng            | Lời gọi method trực tiếp (hoặc executor async) | Mạng, broker, partition                       |
| Độ bền               | Không — event chết cùng JVM                    | Giữ trên đĩa, replay được                     |
| Bảo đảm              | Best-effort; thất bại nhìn thấy ở publisher    | At-least-once mặc định; thứ tự theo partition |
| Mô hình nhất quán    | Đồng bộ — thường trong một DB transaction      | Bất đồng bộ — eventual consistency            |
| Consumer đến thế nào | Registry listener lúc khởi động                | Consumer group, vòng đời độc lập              |

_Quan hệ khái niệm_ là thật: cả hai đều là "publisher phát event, subscriber
phản ứng, publisher không biết subscriber." Nhưng khác biệt kiến trúc là rất
lớn:

- **Coupling.** Listener Observer chia sẻ tiến trình, vòng đời, và vùng thất
  bại của publisher. Consumer Kafka là deployment độc lập — chúng có thể
  down, chậm, hoặc đang deploy trong khi producer chạy.
- **Đồng bộ vs bất đồng bộ.** `@EventListener` Spring đồng bộ mặc định: sự
  kiện được dispatch trên thread của publisher, trong cùng transaction. Với
  `@Async` nó chuyển sang một executor — nhưng vẫn trong tiến trình. Kafka
  bản chất bất đồng bộ và xuyên tiến trình: producer nhận ack khi broker
  chấp nhận, không phải khi consumer phản ứng.
- **Eventual consistency.** Với Kafka, "email khách hàng đã gửi" có thể
  trễ "đơn đã đặt" vài giây hoặc vài phút — và email có thể không bao giờ
  tới (at-least-once nghĩa là duplicate là _điều kỳ vọng_, và consumer phải
  idempotent). Listener trong tiến trình, đặc biệt trong transaction, cho
  gần như atomicity: email listener chỉ chạy nếu transaction commit.

**Xử lý thất bại — quyết định quan trọng nhất.** Câu hỏi đầu tiên với event
là _chuyện gì xảy ra khi một consumer thất bại?_:

```text
Listener đồng bộ, trong transaction (@EventListener mặc định):
  - thất bại rollback cả đơn hàng lẫn hậu quả cùng nhau
  - bảo đảm: không có đơn mà không có email xác nhận
  - giá: email outage chặn việc đặt hàng (cùng coupling như trước, trừ
    coupling code)

Listener async trong tiến trình (@Async + @EnableAsync):
  - publisher thành công, listener chạy sau trên pool thread
  - giá: thất bại listener vô hình với publisher; event có thể mất khi
    restart trừ khi bạn thêm outbox table

Kafka:
  - consumer đọc từ offset riêng; thất bại được retry, offset lag
  - giá: duplicate (cần idempotency), eventual consistency, lag quan sát
    được, và — quan trọng — việc đặt hàng KHÔNG chờ
```

Quy tắc ngón tay cái: **dùng sự nhất quán mạnh nhất bạn có thể trả, và đẩy
hậu quả lên Kafka chỉ khi thất bại của hậu quả đó không được phép ảnh hưởng
luồng** — email và analytics là ứng viên Kafka kinh điển; reserve inventory
và payment thường _không phải_, vì luồng không được phép hoàn thành mà thiếu
chúng. Email sau thanh toán là bài học thứ hai thời Kafka: `OrderCreated` →
`EmailService` → `Kafka` là pattern nhiều team di cư _ra khỏi_, quay về đồng
bộ — sau khi họ nhận ra email xác nhận là một yêu cầu nghiệp vụ, không phải
side effect. (Các bài về saga pattern trên blog này là xử lý sâu hơn cho
đúng trade-off này trong hệ phân tán.)

## 5. Phần IV — Kết Hợp Pattern: Hệ Thống Thanh Toán Thực Tế

Hệ thống thật hiếm khi dùng một pattern đơn lẻ. Đây là phần đền đáp: bức
tranh đầy đủ về việc payment service từ phần mở đầu thực sự trở thành gì khi
áp lực thiết kế được xử lý trung thực — năm pattern, mỗi cái giải quyết đúng
vấn đề nó được giới thiệu vì, compose tại một điểm duy nhất.

**Hình dạng đầy đủ:**

```text
PaymentService (luồng nghiệp vụ)
      │  chỉ phụ thuộc abstraction (DIP)
      ▼
PaymentStrategy interface ────────────── Strategy (gia đình)
      ▲
      │  chọn theo loại
PaymentStrategyFactory ────────────────── Factory (logic lựa chọn)
      │
      └──► CardPaymentStrategy     ──► PaymentGateway (port của DIP)
      └──► BankTransferStrategy    ──► PaymentGateway
      └──► WalletPaymentStrategy   ──► PaymentGateway
                                         │
                    Decorator stack       ▼
      ┌───────────────────────────────► RetryDecorator
      │  compose một lần, tại lúc wiring  LoggingDecorator
      │                                  MetricsDecorator
      │                                  ▼
      │                          StripeGatewayAdapter ──► StripeSdk (Adapter)
      │                          AdyenGatewayAdapter  ──► AdyenSdk
```

**Code.** Các strategy và gateway interface bạn đã thấy. Thứ còn lại là điểm
composition — trong Spring, một class configuration — vì đó là nơi các
pattern trở thành một hệ thống:

```java
@Configuration
public class PaymentConfig {

    @Bean
    public PaymentGateway stripeGateway(StripeSdk stripe) {
        return new StripeGatewayAdapter(stripe);          // Adapter
    }

    @Bean
    public PaymentGateway adyenGateway(AdyenSdk adyen) {
        return new AdyenGatewayAdapter(adyen);            // Adapter
    }

    @Bean
    public PaymentGateway paymentGateway(PaymentGateway stripeGateway,
                                         PaymentGateway adyenGateway) {
        return new RetryDecorator(                        // Decorator: retry
                new LoggingDecorator(                     // Decorator: audit
                        new MetricsDecorator(             // Decorator: metrics
                                new RoutingGateway(stripeGateway, adyenGateway))),
                3, Duration.ofMillis(200));
    }

    @Bean
    public PaymentStrategyFactory paymentStrategyFactory(
            PaymentGateway gateway, CardGateway card, BankGateway bank, WalletGateway wallet) {
        Map<PaymentType, PaymentStrategy> strategies = new EnumMap<>(PaymentType.class);
        strategies.put(PaymentType.CARD, new CardPaymentStrategy(gateway, card));
        strategies.put(PaymentType.BANK_TRANSFER, new BankTransferStrategy(gateway, bank));
        strategies.put(PaymentType.E_WALLET, new WalletStrategy(gateway, wallet));
        return new PaymentStrategyFactory(strategies);    // Factory + Strategy
    }

    @Bean
    public PaymentService paymentService(PaymentStrategyFactory factory) {
        return new PaymentService(factory);               // DI khắp nơi
    }
}
```

**Vì sao mỗi mảnh tồn tại — và ai trả cho mảnh nào:**

| Mảnh                              | Vấn đề nó giải quyết                          | Giá                    |
| --------------------------------- | --------------------------------------------- | ---------------------- |
| `PaymentStrategy` + factory       | Thêm loại thanh toán không được sửa luồng     | Indirection + registry |
| Interface `PaymentGateway`        | Luồng không được phụ thuộc provider (DIP)     | Một abstraction        |
| `StripeGatewayAdapter`/Adyen      | Type SDK không được rò rỉ vào logic nghiệp vụ | Lớp dịch mỗi vendor    |
| `Retry/Logging/MetricsDecorator`  | Hành vi cắt ngang không sửa lõi               | Quyết định thứ tự bọc  |
| Wiring `@Bean` (composition root) | Đồ thị được lắp ở đúng một chỗ                | Config nằm tập trung   |

**Cách bạn nên đọc code này.** `PaymentService` — luồng nghiệp vụ — là ~15
dòng và không phụ thuộc gì concrete. Sự phức tạp sống trong composition
root, trong một file, nơi nó _nhìn thấy được_. Đó là toàn bộ lập luận cho
việc làm này: không phải ít dòng hơn, mà _ít nơi hơn nơi thay đổi gây đau_.

**Điều gì xảy ra khi developer lạm dụng pattern trong cùng hệ thống.** Đây
là kiểu thất bại để nhận diện — phiên bản pattern-driven của cùng service:

```java
// một ví dụ (nén) thật về pattern quá đà
public class PaymentProcessingCoordinatorService {
    private final PaymentStrategySelectorFactory providerFactory;
    private final PaymentGatewayRouterFacade gatewayRouter;
    private final PaymentRequestBuilderFactory requestBuilderFactory;
    private final PaymentAuditDecoratorFactory auditDecoratorFactory;
    ...
}
```

Hai mươi class, mỗi cái một factory, mỗi cái ủy quyền cho cái kế tiếp. Một
developer trace "thanh toán thẻ hoạt động thế nào" phải đi qua: service →
selector → factory → strategy → router → facade → decorator → adapter →
SDK, sáu tầng indirection, trước khi thấy một dòng logic nghiệp vụ. Mỗi
class có unit test khẳng định "nó gọi class tiếp theo." Kiến trúc đã trở
thành thuế debug của chính nó.

Khác biệt giữa bản tốt và bản tồi **không phải số lượng pattern** — cả hai
dùng cùng năm cái. Nó là:

1. **Mỗi abstraction là một _ranh giới_** — nó tách code thay đổi vì những
   lý do khác nhau. Ở bản tồi, các ranh giới nằm giữa code thay đổi vì cùng
   một lý do (chúng là decorator và router của _cùng một_ luồng, tách để có
   tên).
2. **Composition _nhìn thấy được và tập trung_**. Ở bản tồi, wiring nằm rải
   rác (factory của factory); ở bản tốt, một class config phô bày cả hệ
   thống.
3. **Luồng nghiệp vụ _ngắn_**. Nếu class orchestration của bạn vẫn cần năm
   tầng để làm việc của nó, các pattern được thêm _quanh_ nó, không phải
   _cho_ nó.

Check giữ cho việc dùng pattern trung thực:

> **Với mỗi tầng trong hệ thống, tự hỏi: tầng này có làm một thay đổi nào
> đó rẻ hơn so với khi không có nó không? Nếu tầng chỉ thêm một cái tên,
> hãy xóa cái tên.**

---

## 6. Phần V — Khi SOLID và Design Patterns Khiến Code Tệ Hơn

SOLID và các pattern là công cụ, và như mọi công cụ, chúng có thể được áp
vào sai vật liệu. Phần này là tấm gương phản chiếu của mọi thứ trên: bảy
kiểu thất bại thực, mỗi kiểu kèm mẫu nhận diện và cách chỉnh sửa. Hãy đọc
phần này như checklist bạn áp _trước khi_ áp bất cứ thứ gì từ Phần II và
III.

### Case 1 — Interface cho mọi class

```java
public interface UserService {
    void register(RegisterRequest request);
    void changePassword(String userId, String oldPassword, String newPassword);
}

public class UserServiceImpl implements UserService {
    // implementation DUY NHẤT, và interface chẳng thêm gì ngoài
    // những gì class đã diễn đạt
}
```

**Khi nào cái này chẳng thêm giá trị:** một implementation, không thấy cái
thứ hai trên chân trời, method của interface y hệt class — và client duy
nhất là Spring, mà Spring không cần interface. Đây là nghi thức đặt tên từ
Phần 3.5. Cách chỉnh sửa: xóa interface; `@Service` trên class concrete;
thêm interface khi implementation thứ hai tồn tại hoặc một contract thật
phải được tuyên bố.

### Case 2 — Pattern-driven development

Một developer vừa học Strategy, Factory, Builder, Adapter, Facade tuần này,
và một vấn đề nhỏ xuất hiện:

```java
// vấn đề: gửi email cho khách sau khi checkout
public class EmailNotificationFactory {
    public NotificationSender create() { ... }
}

public class EmailNotificationStrategy implements NotificationSender {
    // một implementation, một strategy, không có gia đình
}

public class NotificationBuilder {
    public EmailNotificationBuilder withRecipient(...) { ... }
    public NotificationBuilder withMessage(...) { ... }
}

public class NotificationFacade {
    // chuyển tiếp cho strategy, strategy bọc builder, builder bọc...
}
```

**Vì sao nó sai:** các pattern được chọn vì chúng là pattern — _"chúng tôi
dùng Strategy vì Strategy là pattern tốt"_ — chứ không phải vì một gia đình
thuật toán tồn tại. Việc gửi email đơn lẻ bị chôn dưới năm tầng, tầng nào
cũng chẳng thêm gì. **Cách chỉnh sửa:** `notificationService.send(new
Email(...))` — một class, một lời gọi. Nếu kênh thứ hai xuất hiện sau này,
_lúc đó_ interface Strategy mới xứng đáng tồn tại.

### Case 3 — Over-abstraction của một implementation đơn lẻ

```java
OrderRepository          // interface
OrderRepositoryImpl      // implementation duy nhất
OrderRepositoryFactory   // trả về OrderRepositoryImpl
OrderRepositoryProvider  // cung cấp factory
OrderRepositoryManager   // quản lý provider
OrderRepositoryResolver  // resolve manager
```

**Khi nào điều này xảy ra:** các team tin "abstraction = kiến trúc." Mỗi
tầng là một từ đồng nghĩa của tầng trước. **Cách chỉnh sửa:** dừng ở tầng
đầu tiên. Một interface (hoặc không, xem Case 1) là ranh giới; năm cái tên
còn lại là thuế điều hướng. Cái cascade đặt tên là một cuộc trò chuyện bạn
phải nói to được: _"service phụ thuộc vào cái nào?"_ — nếu câu trả lời cần
một flowchart, thiết kế hỏng, không phải người đọc.

### Case 4 — SRP fragmentation

```java
public class OrderValidationService {
    private final OrderItemsValidator itemsValidator;
    private final CustomerValidator customerValidator;
    private final PaymentMethodValidator paymentMethodValidator;
    private final ShippingAddressValidator shippingAddressValidator;
    private final OrderValidationAudit audit;

    public void validate(Order order) {
        itemsValidator.validate(order);
        customerValidator.validate(order);
        ...
    }
}
```

`OrderValidator.validate(order)` gốc là 20 dòng — đọc hết trong một màn
hình, sửa trong một chỗ. Giờ một thay đổi validation đòi sửa năm class, và
_thứ tự_ các validation bị ẩn trong chuỗi lời gọi. **Kiểm tra chỉnh sửa:**
tách khi các phần thay đổi khác tốc độ hoặc vì các actor khác nhau (Phần
3.1); đừng tách khi bạn chỉ đang sắp xếp lại dòng. Một method 20 dòng không
phải vấn đề thiết kế; class sở hữu nó không phải god class.

### Case 5 — Ám ảnh OCP

```java
public interface PriceProvider {
    BigDecimal getPrice(Order order);
}

public interface PriceProviderFactory {
    PriceProvider create(OrderType type);
}

public class StandardPriceProvider implements PriceProvider { ... }
public class PremiumPriceProvider implements PriceProvider { ... }
```

…cho một quy tắc pricing ba năm không đổi và có hai nhánh. Mọi quy tắc
trong hệ thống đều được interface hóa "để không bao giờ phải sửa code hiện
có nữa." Kết quả: mỗi thay đổi nhỏ của quy tắc giờ đụng một interface, một
factory, và một đăng ký — indirection _mỏng manh hơn_ cái `if` gốc. **Cách
chỉnh sửa:** OCP bảo vệ một _điểm biến thiên thật_; interface tồn tại để
hấp thụ một _gia đình thay đổi đã biết_, không phải mọi thay đổi có thể
tưởng tượng. Logic hằng số, ít biến thiên có thể là một `if` thường — và
"biết đâu sau này cần" không phải điểm biến thiên, nó là phỏng đoán.

### Case 6 — Composition khắp nơi

Composition mạnh — bài viết này đã tranh luận điều đó nhiều lần. Nhưng
"favor composition" không có nghĩa "không bao giờ inherit." Một trường hợp
inheritance chính đáng:

```java
// mọi subclass ĐỀU thỏa contract của parent, sealed, và là extension
// thuần — cây phân cấp này ổn định nhiều năm
public sealed class DomainException extends RuntimeException
        permits OrderNotFoundException, PaymentDeclinedException, InventoryUnavailableException {
    private final String code;

    public DomainException(String message, String code) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Exception là một trong số ít nơi inheritance _là cơ chế đúng_: mọi catch
site xử lý `DomainException` thực sự xử lý cả ba subtype, cây phân cấp
không thêm điều khoản contract nào, và sealing ngăn subclass bất ngờ. Ép
composition vào đây ("mỗi exception _có một_ cause object"…) sẽ khiến code
tệ hơn, không tốt hơn. **Cách chỉnh sửa:** quyết định nói về _substitutability_
(Phần 2.3), không phải thời trang. Nếu mọi caller của parent chấp nhận được
subclass không đổi — inheritance là lựa chọn hợp lệ.

### Case 7 — Design pattern như cargo cult

Lý luận sai, nói thẳng:

> "Chúng tôi dùng Strategy vì Strategy là pattern tốt."

Lý luận đúng:

> "Chúng tôi có một gia đình thuật toán thay thế lẫn nhau và kỳ vọng biến
> thể mới — Strategy cho chúng tôi một chỗ cho mỗi biến thể và giữ dispatcher
> đóng."

Khác biệt không phải trang trí — lý luận sai _bắt đầu từ_ pattern và _tìm_
một vấn đề; lý luận đúng _bắt đầu từ_ vấn đề và _kiểm tra_ pattern có giải
quyết nó không. Mọi pattern trong bài này được giới thiệu vấn đề-trước chính
vì lý do đó. Khi bạn thấy một pattern trong codebase, câu hỏi review không
bao giờ là "đây có phải Strategy đúng không?" — nó là **"vấn đề này giải
quyết cái gì, và cái giá có tương xứng không?"**

**Tóm tắt một câu cho cả phần:** patterns và principles là những giải pháp
đi tìm vấn đề; công việc của kỹ sư là giữ chúng trung thực bằng cách đòi
vấn đề trước.

## 7. Phần VI — Case Study Refactoring: OrderService, Từng Bước Một

Mọi thứ trên, áp vào một class trước mặt bạn. Đây là phần quan trọng nhất
của bài viết, nên chúng ta đi chậm: code tồi có chủ đích, rồi bảy bước nhỏ —
mỗi bước được biện minh, mỗi bước được định giá. Chúng ta không nhảy từ tồi
đến hoàn hảo trong một bước nhảy, vì refactoring thật không bao giờ như vậy.
Ở mỗi bước, bốn câu hỏi được trả lời:

```text
Chúng ta đang giải quyết vấn đề gì?
Vì sao abstraction này được biện minh?
Chúng ta đã giới thiệu độ phức tạp gì?
Thay đổi này có đáng giá không?
```

**Điểm xuất phát.** `OrderService` bạn thấy ở Phần 3.1, với logic thanh
toán được nhúng thẳng để hành trình trọn vẹn:

```java
public class OrderService {
    public void processOrder(Order order) {
        // 1. validation
        if (order.getItems().isEmpty()) {
            throw new IllegalArgumentException("order has no items");
        }
        if (order.getCustomer() == null || order.getCustomer().getEmail() == null) {
            throw new IllegalArgumentException("customer email is required");
        }

        // 2. pricing
        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.getItems()) {
            total = total.add(item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
        }
        if (total.compareTo(BigDecimal.valueOf(500)) > 0) {
            total = total.multiply(BigDecimal.valueOf(0.9));
        }
        order.setTotal(total);

        // 3. persistence
        // ... code JDBC: INSERT INTO orders ...

        // 4. payment
        if (order.getPayment().getType().equals("CARD")) {
            // ... 40 dòng lời gọi SDK thẻ ...
        } else if (order.getPayment().getType().equals("BANK_TRANSFER")) {
            // ... 40 dòng lời gọi SDK ngân hàng ...
        } else {
            throw new UnsupportedOperationException("unknown payment type");
        }

        // 5. email
        // ... code SMTP: dựng và gửi xác nhận ...

        // 6. logging
        System.out.println("Order processed: " + order.getId());
    }
}
```

Khoảng 90 dòng, sáu responsibility, bốn hệ thống ngoài hardwire, và type SDK
từ bước 4 rò rỉ vào mọi dòng quanh nó. Giờ chúng ta đi bảy bước. Sau mỗi
bước bạn nhận phán quyết — hầu hết các bước đáng giá, một bước là quyết
định cần cân nhắc, và bước cuối là bước bạn có thể trung thực bỏ qua.

### Bước 1 — Nhận diện các responsibility

**Chúng ta đã làm gì:** không làm gì ngoài đọc class và ghi ra các tác nhân
thay đổi.

| #   | Responsibility | Lý do nó thay đổi                  | Tự thay đổi theo tốc độ riêng? |
| --- | -------------- | ---------------------------------- | ------------------------------ |
| 1   | Validation     | Quy tắc nghiệp vụ ai được đặt hàng | Có                             |
| 2   | Pricing        | Giảm giá, hạng, thuế               | Có                             |
| 3   | Persistence    | Schema, vendor, tinh chỉnh query   | Có                             |
| 4   | Payment        | Provider, loại thanh toán, retry   | Có — nhanh nhất                |
| 5   | Email          | Template, provider                 | Có                             |
| 6   | Logging        | Yêu cầu observability              | Có                             |

Sáu responsibility, sáu tác nhân thay đổi — một class. Đó là chẩn đoán (SRP,
Phần 3.1), và lợi ích-chi phí đã nhìn thấy: mỗi một trong sáu thay đổi đòi
một sửa đổi trên cùng 90 dòng.

**Đáng giá chứ?** Bước này không tốn gì và nói chính xác cho bạn biết cắt
ở đâu.

### Bước 2 — Áp SRP: một class mỗi responsibility

**Vấn đề chúng ta giải quyết:** sáu tác nhân phải ngừng chia sẻ một file.

```java
public class OrderValidator {
    public void validate(Order order) {
        if (order.getItems().isEmpty()) {
            throw new IllegalArgumentException("order has no items");
        }
        if (order.getCustomer() == null || order.getCustomer().getEmail() == null) {
            throw new IllegalArgumentException("customer email is required");
        }
    }
}

public class OrderPricing {
    public BigDecimal calculateTotal(Order order) {
        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.getItems()) {
            total = total.add(item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
        }
        if (total.compareTo(BigDecimal.valueOf(500)) > 0) {
            total = total.multiply(BigDecimal.valueOf(0.9));
        }
        return total;
    }
}

public class OrderService {
    private final OrderValidator validator;
    private final OrderPricing pricing;
    private final OrderRepository repository;
    private final PaymentService paymentService;
    private final NotificationService notificationService;

    public OrderService(OrderValidator validator, OrderPricing pricing,
                        OrderRepository repository, PaymentService paymentService,
                        NotificationService notificationService) {
        this.validator = validator;
        this.pricing = pricing;
        this.repository = repository;
        this.paymentService = paymentService;
        this.notificationService = notificationService;
    }

    public void processOrder(Order order) {
        validator.validate(order);
        order.setTotal(pricing.calculateTotal(order));
        repository.save(order);
        paymentService.charge(order);
        notificationService.sendConfirmation(order);
    }
}
```

**Chúng ta đã giới thiệu gì:** năm class mới, năm tham số constructor, và
luồng giờ là một chuỗi lời gọi. **Chúng ta mua được gì:** mỗi responsibility
test độc lập được; một thay đổi pricing chỉ đụng `OrderPricing`; email
outage không còn sống trong class của luồng đơn hàng.

**Đáng giá chứ?** Có — và nó rẻ. Riêng bước này đã đủ ngăn `PaymentService`
trong câu chuyện mở đầu chạm 1.500 dòng.

### Bước 3 — Giới thiệu abstraction nơi có biến thiên

**Vấn đề chúng ta giải quyết:** bước 2 vẫn để biến thiên _thanh toán_ chôn
trong — `PaymentService.charge()` là một tổng đài. Nhìn vào thứ biến thiên:
loại thanh toán, provider, hành vi retry. Đó là một _gia đình_, và
abstraction thuộc về nơi có gia đình.

```java
public interface PaymentGateway {
    PaymentResult pay(PaymentRequest request);
}
```

**Vì sao abstraction này được biện minh:** một biến thiên thực, đã quan sát
được tồn tại (CARD / BANK_TRANSFER hôm nay; business đã công bố crypto cho
quý sau). Abstraction nằm tại ranh giới giữa luồng đơn hàng (không nên biết
cơ chế thanh toán) và các provider (không nên bị luồng đơn hàng sai khiến).

**Chúng ta đã giới thiệu gì:** một interface và domain types (`PaymentRequest`,
`PaymentResult`) thay thế từ vựng SDK trong luồng.

**Đáng giá chứ?** Có — nhưng chú ý điều KHÔNG xảy ra: chúng ta không tạo
interface cho `OrderValidator` hay `OrderPricing`. Chúng không có biến
thiên. Abstraction chỉ được giới thiệu _nơi biến thiên là thật_ — đó là
phán đoán đang vận hành (OCP, Phần 3.2).

### Bước 4 — Áp Strategy: gia đình có chỗ sống

**Vấn đề chúng ta giải quyết:** "thêm loại thanh toán" phải ngừng là "sửa
tổng đài."

```java
public interface PaymentStrategy {
    PaymentResult pay(Payment payment);
}

public class CardPaymentStrategy implements PaymentStrategy {
    private final PaymentGateway gateway;
    private final CardGateway cardGateway;

    public CardPaymentStrategy(PaymentGateway gateway, CardGateway cardGateway) {
        this.gateway = gateway;
        this.cardGateway = cardGateway;
    }

    @Override
    public PaymentResult pay(Payment payment) {
        return gateway.pay(PaymentRequest.from(payment, cardGateway));
    }
}
```

…cộng `BankTransferPaymentStrategy`, cộng một factory sở hữu
`Map<PaymentType, PaymentStrategy>` (Phần 4.1). Luồng thanh toán giờ là:

```java
PaymentStrategy strategy = strategyFactory.forType(order.getPayment().getType());
strategy.pay(order.getPayment());
```

**Chúng ta đã giới thiệu gì:** một interface, N implementation, một registry
— và _quyết định dispatch_ dời khỏi luồng nghiệp vụ vào dữ liệu (EnumMap).
**Có đáng không?** Có, đo theo roadmap nghiệp vụ thật (một loại mới mỗi
quý). Nếu roadmap nói "không bao giờ", bước 4 là bước để bỏ qua — một `if`
hai nhánh trong `PaymentService` sẽ đơn giản hơn (trường hợp đặc biệt ở
Phần 2.4).

### Bước 5 — Áp Dependency Inversion: trỏ các mũi tên

**Vấn đề chúng ta giải quyết:** các class giờ phụ thuộc _lẫn nhau_ (concrete
type), không phải contract. Khả năng test và thay thế bị ghép vào việc xây
dựng.

**Trước** — luồng phụ thuộc class concrete, và đổi lưu trữ nghĩa là sửa
luồng:

```java
private final OrderRepository repository;      // concrete — xem bước 6
private final PaymentService paymentService;   // concrete
```

**Sau** — mọi thứ luồng cần đều nằm sau một interface nó sở hữu:

```java
public interface OrderRepository {
    void save(Order order);
    Order findById(String id);
}

public interface PaymentService {               // yêu cầu của chính sách
    void charge(Order order);
}
```

```java
public class OrderService {
    private final OrderValidator validator;
    private final OrderPricing pricing;
    private final OrderRepository repository;    // giờ là interface
    private final PaymentService paymentService; // giờ là interface
    private final NotificationService notificationService;
    ...
}
```

Việc xây dựng xảy ra tại composition root (một class `@Configuration`
Spring hoặc `main()`):

```java
OrderService service = new OrderService(
        new OrderValidator(),
        new OrderPricing(),
        new MySqlOrderRepository(dataSource),    // chi tiết, chọn tại root
        new PaymentService(paymentStrategyFactory),
        new SmtpNotificationService());
```

**Vì sao abstraction này được biện minh:** chi tiết lưu trữ và thanh toán
thay đổi theo tốc độ riêng; chính sách không được thay đổi khi chúng đổi.
**Chúng ta đã giới thiệu gì:** hai interface và một composition root — nhưng
chú ý sự _vắng mặt_: không interface cho `OrderValidator` và `OrderPricing`,
một lần nữa. **Đáng giá chứ?** Có — đây là thứ làm cả hệ thống test được
bằng in-memory fake và hoán đổi được ở production.

### Bước 6 — Giới thiệu Adapter cho payment provider bên ngoài

**Vấn đề chúng ta giải quyết:** type SDK vẫn đang rò rỉ. Đâu đó trong các
strategy, code gọi `stripe.charge(...)` và catch `StripeDeclinedException` —
trong luồng nghiệp vụ. Từ vựng của một provider nằm trong luồng; provider
thứ hai sắp tới, và mỗi provider sẽ cố mang từ vựng riêng của nó vào.

**Trước** (bên trong một strategy):

```java
public class CardPaymentStrategy implements PaymentStrategy {
    private final StripeSdk stripe;

    @Override
    public PaymentResult pay(Payment payment) {
        try {
            StripeCharge charge = stripe.charge(payment.getToken(), toCents(...), "USD");
            return PaymentResult.success(charge.getId());
        } catch (StripeDeclinedException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }
}
```

**Sau** — lời gọi SDK dời ra sau adapter (Phần 4.4), và strategy nói chuyện
với ranh giới domain:

```java
public class CardPaymentStrategy implements PaymentStrategy {
    private final PaymentGateway gateway;

    @Override
    public PaymentResult pay(Payment payment) {
        return gateway.pay(PaymentRequest.from(payment));
    }
}
```

**Vì sao abstraction này được biện minh:** ranh giới provider là nơi biến
động nhất trong hệ thống — vendor mới, nâng cấp SDK, từ vựng exception.
Adapter hấp thụ toàn bộ. **Chúng ta đã giới thiệu gì:** một adapter mỗi
provider, với một chút nghi thức dịch. **Đáng giá chứ?** Có — đây là bảo
hiểm rẻ nhất cả bài: khi Stripe ra SDK v2, đúng một class thay đổi.

### Bước 7 — Thêm Decorator cho retry, logging, metrics

**Vấn đề chúng ta giải quyết:** retry/audit/metrics là cắt ngang — mọi lần
thanh toán, mọi provider, và chúng phải kết hợp. Hardwire vào strategy hay
adapter sẽ nhân chúng lên mỗi provider (Phần 4.5).

```java
PaymentGateway gateway = new RetryDecorator(
        new LoggingDecorator(
                new MetricsDecorator(
                        new StripeGatewayAdapter(stripe))),
        3, Duration.ofMillis(200));
```

**Vì sao abstraction này được biện minh:** các hành vi kết hợp với các
provider theo phép nhân — decorator giữ nó là N + M thay vì N × M. **Chúng
ta đã giới thiệu gì:** ba class nhỏ và một thứ tự bọc phải có chủ đích.
**Đáng giá chứ?** Có khi hành vi biến thiên hoặc cấu hình được; đây cũng là
bước để _bỏ qua_ khi retry là một vòng lặp đơn giản, vô điều kiện bên trong
adapter — sự linh hoạt của decorator sẽ không được dùng tới (trường hợp
"quá thừa" ở Phần 4.5).

### Trạng thái cuối — và bảng kế toán trung thực

```java
public class OrderService {
    // 5 collaborator được inject, mọi thứ là interface trừ validator
    // processOrder: 6 dòng — validate, pricing, save, pay, notify, log

    public void processOrder(Order order) {
        validator.validate(order);
        order.setTotal(pricing.calculateTotal(order));
        repository.save(order);
        paymentService.charge(order);
        notificationService.sendConfirmation(order);
        logger.info("Order {} processed", order.getId());
    }
}
```

| Bước | Độ phức tạp thêm                   | Rủi ro được gỡ bỏ                                | Phán quyết                       |
| ---- | ---------------------------------- | ------------------------------------------------ | -------------------------------- |
| 1    | không                              | không (chẩn đoán)                                | luôn luôn                        |
| 2    | 5 class + 5 tham số constructor    | Sáu tác nhân thay đổi ngừng chung một file       | thắng rẻ                         |
| 3    | 1 interface + domain types         | Từ vựng SDK ra khỏi luồng                        | thắng rẻ                         |
| 4    | interface strategy + N class + map | Loại thanh toán mới không sửa luồng              | chỉ thắng nếu loại lớn dần       |
| 5    | 2 interface + composition root     | Chính sách tách khỏi chi tiết lưu trữ/thanh toán | thắng                            |
| 6    | 1 adapter mỗi provider             | Đổi provider/nâng cấp SDK được cô lập            | thắng                            |
| 7    | 3 decorator class + thứ tự bọc     | Retry/audit/metrics compose được mỗi provider    | chỉ thắng nếu hành vi biến thiên |

Class 90 dòng gốc thành ~25 dòng orchestration cộng các collaborator được
đặt đúng chỗ. **Class không nhỏ đi — hệ thống nhỏ đi.** Đó là metric duy
nhất đáng quan tâm: số nơi mà một thay đổi nhất định có thể gây đau.

**Và những gì chúng ta cố ý KHÔNG làm** — kỷ luật cũng quan trọng như
pattern:

- Không interface cho `OrderValidator`/`OrderPricing` (không biến thiên).
- Không factory cho validator (không gì để quyết định).
- Không cây repository ngoài `OrderRepository` (một implementation).
- Không event bus cho notification (email đồng bộ là một yêu cầu, không
  phải side effect — quy tắc ngón tay cái ở Phần 4.6).

## 8. Phần VII — Đặc Thù Của Java Hiện Đại: Điều Gì Thay Đổi

Mọi nguyên tắc và pattern trong bài này được thiết kế cho một Java không có
records, sealed classes, lambda, hay pattern matching. Java hiện đại không
vô hiệu hóa các nguyên tắc — nhưng nó _dời chỗ boilerplate_ và, ở vài nơi,
khiến một pattern trở nên không cần thiết. Phần này đi qua những tính năng
quan trọng và việc mỗi tính năng làm gì với các quyết định ở trên.

### 8.1 Records: Value Object Không Boilerplate

Các domain type immutable mà Phần II–III xây bằng tay (`PaymentRequest`,
`PaymentResult`, `OrderCreatedEvent`, `User` ở phần Builder) chính xác là
thứ records được tạo ra để làm:

```java
public record PaymentRequest(
        String orderId,
        BigDecimal amount,
        String currency,
        PaymentMethod method) {

    public PaymentRequest {                          // compact constructor
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("invalid currency: " + currency);
        }
    }
}
```

Một khai báo cho: field immutable, canonical constructor, `equals`/
`hashCode`/`toString`, và phần validation mà constructor của `BankAccount`
và `build()` của Builder làm bằng tay. Bài học encapsulation (Phần 2.1) vẫn
áp dụng — records chỉ tốt bằng các check invariant của nó — nhưng nghi thức
đã biến mất.

**Records vs Builder — cuộc đối đầu đã hứa ở phần mở đầu:**

| Mối quan tâm   | Builder (Phần 4.3)     | record + static factory                    |
| -------------- | ---------------------- | ------------------------------------------ |
| Boilerplate    | ~10 dòng mỗi field     | 1 dòng mỗi field                           |
| Readability    | Fluent, bước có nhãn   | `new` với tham số theo vị trí              |
| Validation     | Trong `build()`        | Trong compact constructor                  |
| Field tùy chọn | Bỏ một bước, tự nhiên  | Mọi field bắt buộc (theo thiết kế)         |
| Tốt nhất cho   | 8+ field trộn tùy chọn | ≤ 6 field, tất cả bắt buộc                 |
| Biến thể riêng | —                      | Static factory: `User.createCustomer(...)` |

Quy tắc: **record giờ là default cho value object; Builder chỉ còn lại cho
việc xây dựng thực sự lớn, một phần tùy chọn** — và ngay cả khi đó, record
có thể là sản phẩm được build. Đức tính còn lại của Builder là nhãn tham số;
nếu records và static factories bao phủ được các trường hợp của bạn, Builder
là pattern mà Java hiện đại biến thành không bắt buộc.

### 8.2 Sealed Classes: Làm Gia Đình Thành Tường Minh

Chủ đề lặp lại của bài viết — _điểm biến thiên là thật, gia đình đã biết_ —
chính xác là thứ `sealed` chính thức hóa:

```java
public sealed interface PaymentMethod permits Card, BankTransfer, Wallet {
}

public record Card(String token, String brand) implements PaymentMethod { }
public record BankTransfer(String iban, String accountName) implements PaymentMethod { }
public record Wallet(String walletId) implements PaymentMethod { }
```

Compiler giờ _ép_ gia đình: không subclass lạ nào tồn tại được, và một
switch trên `PaymentMethod` có thể **exhaustive** — compiler chứng minh bạn
đã xử lý mọi biến thể:

```java
public PaymentResult pay(PaymentMethod method, PaymentGateway gateway) {
    return switch (method) {
        case Card card -> gateway.pay(cardPaymentRequest(card));
        case BankTransfer bank -> gateway.pay(bankPaymentRequest(bank));
        case Wallet wallet -> gateway.pay(walletPaymentRequest(wallet));
    };
}
```

Sealed thay đổi gì cho bài viết này:

- **LSP (Phần 3.3)** trở nên ép buộc được: compiler giới hạn ai được
  subclass, và cây sealed _chính là_ tài liệu thiết kế — gia đình đóng theo
  contract, không theo quy ước.
- **OCP (Phần 3.2)** có mặt trái: với một gia đình _sealed_, "đóng với sửa
  đổi" là điều mong muốn. Thêm một biến thể đòi sửa khai báo sealed — ép bạn
  xem lại mọi `switch` exhaustive — thay vì lặng lẽ thiếu entry trong map
  đăng ký. Cây sealed nói: _biến thiên này đã đủ; xử lý nó ở mọi nơi hoặc
  không nơi nào_.
- **Strategy (Phần 4.1)** với gia đình sealed thường rút gọn thành sealed
  enum hoặc sealed interface + switch exhaustive — các class strategy chỉ
  cần khi biến thể mang _state và dependency nặng_.

### 8.3 Enums: Strategy Cải Trang

Với hành vi biến thiên theo một tập _cố định, đã biết_, enum là mẹo Java
kinh điển có trước tất cả những thứ này:

```java
public enum ShippingMethod {
    STANDARD {
        @Override
        public Duration estimateDelivery() {
            return Duration.ofDays(5);
        }
    },
    EXPRESS {
        @Override
        public Duration estimateDelivery() {
            return Duration.ofDays(1);
        }
    };

    public abstract Duration estimateDelivery();
}
```

…hoặc, sạch hơn trong Java hiện đại, một field interface:

```java
public enum ShippingMethod {
    STANDARD(shipping -> shipping.getWeight().multiply(BigDecimal.valueOf(2))),
    EXPRESS(shipping -> shipping.getWeight().multiply(BigDecimal.valueOf(8)));

    private final Function<Shipping, BigDecimal> price;
    ShippingMethod(Function<Shipping, BigDecimal> price) {
        this.price = price;
    }

    public BigDecimal priceFor(Shipping shipping) {
        return price.apply(shipping);
    }
}
```

Hành vi trong enum là Strategy _đơn giản nhất_: không class, không registry,
dispatch bằng chính hằng số enum. Nó là lựa chọn đúng khi gia đình **đóng**
(sealed theo bản chất: shipping method, order status, định dạng báo cáo) và
hành vi nhỏ. Nó sai khi biến thể mang dependency riêng (strategy cần
gateway, cần repository) — enum không được xây theo dependency.

### 8.4 Lambda và Functional Interface: Strategy Không Cần Class

Các interface một method từ Phần II–IV đều là functional interface. Một
`PaymentStrategy` có thể là lambda; decorator có thể là hàm compose. So
sánh kinh điển:

```java
// Strategy pattern, kiểu cổ điển
public class CardPaymentStrategy implements PaymentStrategy { ... }
strategies.put(CARD, new CardPaymentStrategy(cardGateway));

// cùng strategy dạng lambda
strategies.put(CARD, payment -> cardGateway.charge(payment.getReference(), payment.getAmount()));
```

Và decorator như composition hàm:

```java
static PaymentGateway withRetry(PaymentGateway delegate, int attempts, Duration backoff) {
    return request -> {
        PaymentResult result = delegate.pay(request);
        for (int i = 1; !result.isSuccess() && i < attempts; i++) {
            sleepQuietly(backoff.multipliedBy(i));
            result = delegate.pay(request);
        }
        return result;
    };
}

private static void sleepQuietly(Duration duration) {
    try {
        Thread.sleep(duration);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}

PaymentGateway gateway = withRetry(stripeAdapter, 3, Duration.ofMillis(200));
```

**Lambda thay đổi gì:** _gia đình_ vẫn tồn tại (vấn đề là thật), nhưng các
_class_ thường không cần. Khi biến thể không state hoặc nhỏ, một lambda là
toàn bộ Strategy; khi nó tích state và dependency, nâng cấp thành class.
**Lời cảnh báo:** lambda làm việc over-abstraction rẻ hơn để viết, không
làm nó chính đáng hơn — một `if` hai nhánh vẫn tốt hơn một lambda map hai
entry (trường hợp đặc biệt Phần 2.4 áp dụng không đổi).

### 8.5 Pattern Matching: Thứ Thay Thế `if/else` Nhưng Không Phải Polymorphism

```java
// trước: chuỗi instanceof
if (payment instanceof CardPayment cardPayment) {
    ...
} else if (payment instanceof BankTransferPayment bankPayment) {
    ...
}

// sau: sealed switch exhaustive (Phần 8.2)
```

Pattern matching không _thay thế_ polymorphism — nó thay thế idiom
`instanceof`/cast, và nó đổi nơi dispatch sống. Dùng sealed switch khi gia
đình đóng và việc xử lý cục bộ; dùng polymorphism khi mỗi biến thể phải _sở
hữu_ hành vi của nó và được mở rộng độc lập. Khác biệt là cùng thứ từ Phần
2.4: ai sở hữu hành vi — caller hay biến thể?

### 8.6 `Optional`: Sự Vắng Mặt Trung Thực

`Optional<T>` là câu trả lời hiện đại cho vấn đề LSP ở Phần 3.3 — repository
"thi thoảng trả null":

```java
public interface OrderRepository {
    Optional<Order> findById(String id);   // contract nói sự vắng mặt là có thể
}
```

Dùng tại ranh giới, `Optional` làm _contract_ trung thực, nên implementation
không thể lặng lẽ làm yếu nó. Các trường hợp đặc biệt quan trọng:

- **Chỉ kiểu trả về** — `Optional` dành cho giá trị trả về và thao tác
  `Stream`; nó không phải field type, không phải parameter type, không phải
  phần tử collection. Một field `Optional<Order>` là code smell — không
  serialize hợp lý, mời gọi `get()`-không-check, và báo hiệu model không
  chắc nó giữ gì.
- **Không thay thế validation** — `Optional.ofNullable` không thay các
  check invariant ở Phần 2.1; nó bổ trợ.

### 8.7 Immutability: Ngôn Ngữ Cuối Cùng Đã Giúp

`List.copyOf`, `Set.copyOf`, `Map.copyOf`, `Stream.toList()`, unmodifiable
collection view, `String`/`BigDecimal`/`LocalDate` vốn immutable, records
cho value object — Java hiện đại làm default immutable trở nên rẻ. Điều này
trực tiếp củng cố Phần 2.1: các defensive copy vẫn cần (constructor nhận
mutable collection), nhưng _bề mặt mutability_ bạn phải phòng thủ đã thu
nhỏ đáng kể.

### 8.8 Điều Java hiện đại KHÔNG thay đổi

Không gì ở trên gỡ bỏ _phán đoán_: điểm biến thiên nào là thật, abstraction
nào xứng indirection của nó, gia đình đóng hay mở. Records không làm tư duy
Builder lỗi thời với object lớn; sealed không làm Strategy lỗi thời với
biến thể nặng; lambda không làm các case "khi nào KHÔNG" ở Phần V biến mất.
Công cụ sắc hơn — tư duy kỹ thuật vẫn là của bạn.

---

## 9. Phần VIII — Mô Hình Tư Duy: Câu Hỏi Cho Code Review

Một bài viết không thể trao phán đoán; nó có thể trao câu hỏi. Đây là những
câu hỏi buộc phán đoán phải lộ ra — những câu chạy qua khi một class, một
thiết kế, hay một pull request cần đánh giá. Chúng ánh xạ một-một lên các
phần trên; mỗi câu có một "tín hiệu" — câu trả lời nghĩa là có vấn đề.

### OOP

| Câu hỏi                                         | Tín hiệu rắc rối                                            |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Ai sở hữu state này?                            | Nhiều class cùng mutate một object                          |
| Ai được phép sửa nó?                            | Field hay collection nội bộ lọt ra ngoài                    |
| Invariant nào phải được bảo vệ?                 | Không method nào ép buộc — caller phải tự nhớ               |
| Đây có thực sự là quan hệ "is-a"?               | `instanceof` trong caller; `extends` không substitutability |
| Abstraction này giấu gì?                        | Type SDK, tên provider, hay config trong caller             |
| Abstraction này giấu một biến thiên thật không? | Một implementation, không thấy cái thứ hai                  |

### SOLID

| Câu hỏi                                                | Tín hiệu rắc rối                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Thứ gì có khả năng thay đổi ở đây?                     | Class thay đổi vì nhiều lý do khác nhau                                    |
| Dependency nào gây ra coupling?                        | Một thay đổi ở X buộc thay đổi ở Y                                         |
| Ta thêm interface này vì cần nó chứ?                   | Interface soi gương class; không biến thể thứ hai                          |
| Ta đang tách responsibility hay đang tách file?        | 10 class, mỗi cái chuyển tiếp cho cái kế tiếp                              |
| Một subclass có thể làm yếu contract của parent không? | Subclass ném `UnsupportedOperationException`, trả null, thắt preconditions |
| Interface này phục vụ ai?                              | Client phụ thuộc method chúng không bao giờ gọi                            |
| Dependency trỏ hướng nào?                              | Class chính sách tham chiếu class vendor/SDK                               |
| Là Spring đang DI hay code đang DIP?                   | Interface tồn tại chỉ vì Spring "yêu cầu" (nó không yêu cầu)               |

### Design Patterns

| Câu hỏi                                  | Tín hiệu rắc rối                           |
| ---------------------------------------- | ------------------------------------------ |
| Pattern này giải quyết vấn đề gì?        | Không vấn đề nào được nêu trước pattern    |
| Nó giới thiệu độ phức tạp gì?            | Tầng chỉ thêm tên                          |
| Điều gì xảy ra nếu không dùng nó?        | "Thêm sau cũng được" dễ → đừng xây bây giờ |
| Biến thiên là thật hay giả định?         | "Biết đâu cần..." không có roadmap         |
| Composition/wiring nhìn thấy ở đâu?      | Factory-của-factory, wiring rải rác        |
| `switch` hay `if` có đơn giản hơn không? | Nhánh một dòng đằng sau interface          |

**Cách dùng những câu này:** code review không phải nhận diện pattern
("đó là Strategy, duyệt!"). Nó là hỏi-câu-với-bằng-chứng. Khi một comment
review hỏi "sao không dùng pattern X ở đây?", câu trả lời trung thực là một
câu nêu vấn đề — hoặc là việc xóa pattern đó đi.

---

## 10. Phần IX — Khung Quyết Định Cuối Cùng

Gộp mọi thứ lại. Khi bạn đối mặt một quyết định thiết kế trong code thật,
luồng là một cái cây — và các nhánh nói về _thứ đang thay đổi_, không phải
tên pattern:

```text
Tôi có vấn đề thiết kế không? (triệu chứng: Phần 1)
        |
        +-- Không  → dừng. Đừng trang trí code đang chạy tốt.
        |
        v
Điều gì đang thay đổi?
        |
        +--> Hành vi/thuật toán biến thiên theo loại
        |        → Strategy / polymorphism / sealed switch
        |
        +--> Biến thể mới cứ xuất hiện
        |        → Strategy + registry (OCP)
        |
        +--> Việc tạo object liên quan quyết định
        |        → Simple Factory
        |        → Factory Method (luồng cố định, object biến thiên)
        |        → Abstract Factory (gia đình phải nhất quán)
        |
        +--> Xây dựng object không đọc nổi
        |        → Builder (nhiều field tùy chọn)
        |        → record + static factory (hầu hết value object)
        |
        +--> API bên ngoài không khớp mô hình của tôi
        |        → Adapter (giữ type SDK khỏi domain)
        |
        +--> Cần thêm hành vi mà không đụng lõi
        |        → Decorator (N + M, không phải N × M)
        |
        +--> Một sự kiện, nhiều hậu quả
        |        → Spring events (trong tiến trình, sync/async)
        |        → Kafka (xuyên tiến trình, async, eventual)
        |
        +--> Code cấp cao phụ thuộc implementation
        |        → Dependency Inversion (sở hữu abstraction)
        |        → constructor injection + composition root
        |
        +--> Nhiều responsibility, nhiều tác nhân thay đổi
                 → SRP (tách theo tốc độ/actor của thay đổi — không theo dòng)

Sau khi chọn, hỏi ba lần:
  1. Tôi vừa thêm độ phức tạp gì?
  2. Điều gì xảy ra nếu tôi không thêm nó?
  3. Biến thiên là thật, hay giả định?
Nếu câu 3 là "giả định" — hãy gỡ nó ra.
```

Và câu nên sống sót qua mọi cuộc thảo luận thiết kế:

> **Patterns là công cụ, không phải mục tiêu.** Một Strategy không giải
> quyết biến thiên nào, một Factory chỉ bọc `new`, một interface với một
> implementation, một phép tách SRP vỡ vụn mà không cô lập gì — đó là các
> cargo cult của Phần 6, và chúng đông hơn những thiết kế thật trong hầu hết
> codebase. Mục tiêu không bao giờ là "dùng đúng pattern." Mục tiêu là
> "làm cho thay đổi sắp tới trở nên rẻ, và mọi thứ khác đơn giản."

---

## Kết Luận

Bạn bắt đầu với một `PaymentService` lớn tới 1.500 dòng — sáu
responsibility, dependency hardwire, và từ vựng SDK rò rỉ vào luồng nghiệp
vụ. Rồi bạn đi trọn vòng cung: encapsulation thực sự bảo vệ gì (invariant,
không phải field), abstraction nên và không nên giấu gì (biến thiên thật,
không phải cấu trúc), khi nào inheritance là cái bẫy (mỗi khi
substitutability thất bại), và khi nào polymorphism là thừa (khi các nhánh
là quy tắc, không phải thuật toán). Năm nguyên tắc SOLID được định giá, không
được tâng bốc: một lý do để thay đổi, bảo vệ điểm biến thiên, tôn trọng
contract hành vi, định cỡ interface cho client, và trỏ dependency vào
abstraction bạn sở hữu. Các pattern được giới thiệu như giải pháp cho vấn đề
với chi phí được nêu — Strategy, Factory, Builder, Adapter, Decorator,
Observer — và phần kết hợp cho thấy một hệ thống thanh toán thật trông ra
sao khi mỗi abstraction là một ranh giới chân chính. Rồi tấm gương: bảy cách
SOLID và pattern khiến code tệ hơn, và refactoring bảy bước nơi mỗi bước
phải tự biện minh. Cuối cùng, các tính năng Java hiện đại — records, sealed
classes, enums, lambda, pattern matching, `Optional` — đã dời boilerplate
nhưng không dời phán đoán.

Toàn bộ bài viết rút gọn thành bốn câu:

1. **Mọi quyết định thiết kế là một ván cược về thứ sẽ thay đổi.**
2. **Abstraction là ranh giới giữa những thứ thay đổi với tốc độ khác
   nhau — không gì khác biện minh cho chúng.**
3. **Một nguyên tắc hay pattern là giải pháp cho một vấn đề; nếu bạn không
   nêu được vấn đề, giải pháp là cargo cult.**
4. **Kỹ năng không phải là biết các pattern — mà là nhìn vào một codebase
   thật, xác định áp lực thiết kế, chọn kỹ thuật nhỏ nhất giảm nhẹ được nó,
   và từ chối những thứ thêm phức tạp mà không gỡ rủi ro.**

Đó là khác biệt giữa biết SOLID là gì và dùng được SOLID. Lần tới khi một
`PaymentService` rơi vào review của bạn, đừng hỏi "nên dùng pattern nào?" —
hãy hỏi _thứ gì đang thay đổi, và ai nên trả tiền cho nó_.

---
