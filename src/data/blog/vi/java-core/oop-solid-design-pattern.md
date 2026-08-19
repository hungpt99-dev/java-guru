---
title: "OOP, SOLID và Design Patterns trong Code Java Thực Tế"
description: "Hướng dẫn tiếp cận theo vấn đề để sử dụng OOP, SOLID và các design pattern phổ biến trong Java mà không tạo thêm abstraction không cần thiết."
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

## Mở đầu

Một payment service thường bắt đầu như một application service nhỏ: validate
request, gọi provider để charge, lưu receipt rồi thông báo cho khách hàng.
Khi requirement tăng lên, cùng class đó có thể phải xử lý thêm refund, retry,
lỗi riêng của từng provider, audit event và notification.

Điểm khó không phải là biết interface hay design pattern tồn tại. Điểm khó
là quyết định thay đổi nào cần một boundary mới, code nào nên giữ cùng nhau,
và abstraction nào chỉ làm tăng indirection.

Bài viết dùng domain payment, order, notification và repository để làm rõ
cách đưa ra quyết định. Mỗi ý tưởng bắt đầu từ một design pressure, đi qua
một refactoring nhỏ, rồi nêu trade-off. Các ví dụ là minh họa; chúng không
phải tuyên bố về hệ thống của bất kỳ công ty cụ thể nào.

## Một design pressure cụ thể

**[PROPOSED SCENARIO]** Giả sử một service phát triển từ flow thanh toán thẻ
đơn giản thành service hỗ trợ nhiều payment method và provider:

```java
public class PaymentService {
    public void pay(Order order, PaymentRequest request) {
        validate(request);
        if (request.type() == PaymentType.CARD) {
            cardProvider.charge(request, order.total());
        } else if (request.type() == PaymentType.BANK_TRANSFER) {
            bankProvider.charge(request, order.total());
        } else {
            throw new UnsupportedPaymentType(request.type());
        }
        receiptRepository.save(order.id(), "PAID");
        notificationSender.sendPaymentConfirmation(order);
    }
}
```

Vấn đề không nằm ở số dòng code. Các tín hiệu đáng xem xét là:

| Tín hiệu | Design pressure có thể tồn tại |
| --- | --- |
| Một class thay đổi vì payment rule, persistence và notification | Nhiều responsibility dùng chung một boundary |
| Thêm payment method phải sửa method điều phối | Variation được mã hóa bằng conditional logic |
| Chi tiết provider xuất hiện trong application code | External API đã rò qua domain boundary |
| Test cần database, mail system hoặc provider SDK | Dependency được tạo hoặc hardwire quá gần use case |
| Retry có thể charge hai lần | Operation chưa có chiến lược idempotency rõ ràng |

**[ANALYSIS]** Đây là lý do để điều tra thiết kế, không phải bằng chứng rằng
mọi class đều cần interface hay mọi conditional đều sai. Một conditional nhỏ,
cục bộ trong code ổn định đôi khi dễ hiểu hơn một hierarchy strategy được
tạo ra để dự đoán tương lai.

## OOP như các boundary

OOP hữu ích trong trường hợp này vì nó cung cấp boundary cho state và behavior.
Bốn khái niệm dưới đây là các câu hỏi kỹ thuật, không chỉ là từ vựng.

### Encapsulation: bảo vệ invariant

Encapsulation nghĩa là object kiểm soát các thay đổi state phải tuân theo rule.
`BankAccount` không nên expose balance có thể thay đổi rồi yêu cầu mọi caller
tự nhớ rule overdraft. `Payment` có thể expose các operation như
`markCaptured()` hoặc `markRefunded()` để bảo đảm state transition hợp lệ.

```java
public final class Payment {
    private PaymentStatus status = PaymentStatus.AUTHORIZED;

    public void markCaptured() {
        if (status != PaymentStatus.AUTHORIZED) {
            throw new IllegalStateException("Payment is not authorized");
        }
        status = PaymentStatus.CAPTURED;
    }

    public PaymentStatus status() {
        return status;
    }
}
```

**[ANALYSIS]** Field `private` và getter không tự động tạo ra encapsulation.
Class có public setter có thể ẩn representation nhưng vẫn không bảo vệ
invariant. Ưu tiên command thể hiện domain operation hợp lệ. Không cần ép mọi
dữ liệu thành rich object nếu nó thực sự chỉ là dữ liệu đi qua một boundary.

### Abstraction: expose một capability ổn định

Abstraction nên ẩn detail caller không cần và expose capability caller cần.
Application service có thể phụ thuộc vào một payment port:

```java
public interface PaymentProcessor {
    ChargeResult charge(PaymentRequest request, Money amount);
}
```

Provider adapter chuyển port này thành lời gọi provider SDK. Application code
không cần biết request object hay exception type của SDK.

**[ANALYSIS]** Abstraction có giá trị khi detail bị ẩn thay đổi, tạo ra ranh
giới test, hoặc có reason to change riêng. Interface chỉ có một implementation
không mặc nhiên là sai, nhưng nó cần một boundary rõ ràng thay vì chỉ tồn tại
để đáp ứng một quy tắc.

### Inheritance: reuse không đồng nghĩa substitutability

Inheritance thể hiện quan hệ `is-a` và tạo ra kỳ vọng substitutability: code
dùng base type vẫn phải hoạt động khi nhận subtype. Chỉ dùng inheritance để
tái sử dụng helper thường tạo ra fragile base class.

Nếu card processor và bank-transfer processor chỉ dùng chung validation, hãy
ưu tiên collaborator nhỏ hoặc helper theo composition, trừ khi chúng thực sự
có contract ổn định chung. Composition cho phép mỗi processor chọn dependency
và policy mà không kế thừa behavior không liên quan.

### Polymorphism: đặt variation sau một contract

Polymorphism cho phép caller dùng contract ổn định trong khi object được chọn
cung cấp behavior. Registry có thể chọn processor mà không đưa chi tiết
provider vào code điều phối:

```java
public final class PaymentProcessors {
    private final Map<PaymentType, PaymentProcessor> processors;

    public PaymentProcessors(Map<PaymentType, PaymentProcessor> processors) {
        this.processors = Map.copyOf(processors);
    }

    public PaymentProcessor forType(PaymentType type) {
        var processor = processors.get(type);
        if (processor == null) {
            throw new UnsupportedPaymentType(type);
        }
        return processor;
    }
}
```

**[ANALYSIS]** Cách này phù hợp khi payment type thay đổi độc lập hoặc có
behavior khác biệt đáng kể. Với tập case nhỏ và cố định, `switch` vẫn có thể
là lựa chọn rõ ràng hơn.

## SOLID như tiêu chí quyết định

SOLID hữu ích nhất như vocabulary để gọi tên design pressure. Nó không phải
requirement phải tối đa hóa số lượng class.

### Single Responsibility Principle

**[SOURCE FACT]** Nguyên tắc này thường được phát biểu là một class chỉ có
một reason to change. Cách hiểu thực tế là gom behavior quanh một
responsibility và stakeholder nhất quán.

**[ANALYSIS]** `PaymentService` có thể chịu trách nhiệm điều phối payment use
case, còn giao tiếp provider, lưu receipt và gửi notification có reason to
change riêng. Hãy tách chúng khi coupling gây ra thay đổi thật hoặc khiến test
khó, không chỉ vì một method dài.

### Open/Closed Principle

**[SOURCE FACT]** Nguyên tắc nói rằng software entity nên open for extension
và closed for modification.

**[ANALYSIS]** Điều này không có nghĩa file hiện có không bao giờ được sửa.
Ý là variation point đã biết có thể được mở rộng qua contract ổn định.
`PaymentProcessor` và provider adapter là boundary hợp lý nếu dự kiến có
processor mới. Tạo contract trước khi có variation thường là suy đoán.

### Liskov Substitution Principle

**[SOURCE FACT]** Subtype phải dùng được ở mọi nơi base type được kỳ vọng mà
không phá vỡ behavioral contract của base type.

**[ANALYSIS]** Nếu `PaymentProcessor` hứa `charge` nhưng một subtype âm thầm
bỏ qua amount, từ chối input hợp lệ hoặc thay đổi failure semantic, contract
đang sai hoặc subtype không nên đứng sau contract đó. Return type và exception
cũng là một phần contract, không phải implementation detail.

### Interface Segregation Principle

Client không nên phụ thuộc vào method mà nó không dùng. Một provider interface
lớn gộp charge, refund, quản lý token và settlement sẽ buộc mọi adapter và
test implement operation không liên quan.

```java
public interface PaymentCharger {
    ChargeResult charge(PaymentRequest request, Money amount);
}

public interface PaymentRefunder {
    RefundResult refund(Payment payment, Money amount);
}
```

**[ANALYSIS]** Tách interface theo nhu cầu của client và capability nhất quán.
Đừng tách từng method thành một interface nếu chưa có consumer hưởng lợi từ
việc tách đó.

### Dependency Inversion Principle

Policy cấp cao không nên phụ thuộc trực tiếp vào detail cấp thấp; cả hai nên
phụ thuộc vào abstraction. Application service có thể nhận `PaymentProcessor`,
`ReceiptRepository` và `NotificationSender` qua constructor injection. Một
composition root sẽ wire các adapter cụ thể.

```java
public final class PaymentService {
    private final PaymentProcessors processors;
    private final ReceiptRepository receipts;
    private final NotificationSender notifications;

    public PaymentService(PaymentProcessors processors,
                          ReceiptRepository receipts,
                          NotificationSender notifications) {
        this.processors = processors;
        this.receipts = receipts;
        this.notifications = notifications;
    }
}
```

**[ANALYSIS]** Dependency injection là cách kiểm soát coupling và test setup.
Service locator hoặc global mutable registry có thể che giấu chính các
dependency đó và khiến behavior khó suy luận hơn.

## Pattern giải quyết vấn đề cụ thể

Pattern là tên gọi cho các cấu trúc lặp lại. Chỉ dùng khi các force tương ứng
thực sự xuất hiện, không dùng máy móc như một danh mục phải hoàn thành.

### Strategy cho policy có thể thay thế

Strategy đặt một nhóm algorithm có thể thay thế sau một contract. Trong flow
payment, `PaymentProcessor` là strategy khi flow chọn một processor cho mỗi
request. Nó phù hợp khi implementation khác nhau về policy, dependency hoặc
cách xử lý failure.

### Adapter cho external API

Adapter chuyển một interface thành interface khác. Provider adapter map
contract nội bộ `PaymentProcessor` sang SDK và chuyển SDK error thành failure
ở cấp application. Giữ type riêng của provider ở edge khi có thể.

### Decorator cho behavior độc lập

Decorator bọc một object bằng behavior như metrics, logging hoặc retry. Nó giúp
giữ cross-cutting concern ngoài payment rule:

```java
PaymentProcessor processor = new RetryingPaymentProcessor(
    new AuditingPaymentProcessor(provider, auditLog), retryPolicy);
```

**[ANALYSIS]** Retry không phải lúc nào cũng an toàn. Retry cần timeout policy
rõ ràng, phân loại failure có thể retry và idempotency. Với operation charge,
có thể cần idempotency key hoặc cơ chế deduplication do provider hỗ trợ để
tránh charge lần thứ hai. Nếu không có bảo đảm đó, fallback hoặc flow
reconciliation có thể an toàn hơn blind retry.

### Factory cho quyết định khởi tạo

Dùng Factory khi việc khởi tạo có logic chọn implementation hoặc setup đáng
kể. Nếu constructor đơn giản và dependency injection đã quản lý composition,
factory có thể không mang lại giá trị.

### Repository cho persistence boundary

Repository có thể expose operation theo ngôn ngữ domain và giữ SQL,
transaction cùng chi tiết row lock trong infrastructure adapter. Nó không nên
trở thành object store tổng quát chỉ sao chép mọi operation của database.

## Refactor payment flow

**[PROPOSED DESIGN]** Giữ application service là orchestrator, đồng thời đưa
behavior biến đổi hoặc phụ thuộc infrastructure vào collaborator:

```java
public final class PaymentService {
    public PaymentReceipt pay(Order order, PaymentRequest request) {
        var processor = processors.forType(request.type());
        var result = processor.charge(request, order.total());
        var receipt = receipts.save(order.id(), result);
        notifications.sendPaymentConfirmation(order, receipt);
        return receipt;
    }
}
```

Thiết kế này không xóa complexity. Nó tạo boundary rõ hơn cho từng
dependency. Use case vẫn cần quyết định rõ về transaction scope, timeout,
retry, failure mapping, thời điểm gửi notification và idempotency. Các quyết
định đó nên nằm trong use case và policy của nó, không nằm trong các nhánh
provider hình thành một cách ngẫu nhiên.

## Khi không nên refactor

Giữ implementation đơn giản khi behavior ổn định, conditional cục bộ và test
dễ viết. Đừng tạo interface chỉ để mock value object hoặc class không có
implementation thay thế có ý nghĩa. Đừng dùng inheritance cho tiện. Đừng dùng
pattern khi vocabulary của pattern khó hiểu hơn code mà nó thay thế.

Hãy refactor khi có thể gọi tên pressure: thay đổi độc lập, policy bị lặp,
infrastructure bị hardwire, state transition không hợp lệ, hoặc boundary làm
failure behavior không rõ. Thực hiện từng thay đổi cấu trúc một và dùng test
để giữ nguyên behavior.

## Kết luận

OOP, SOLID và design pattern không đưa ra số class mục tiêu hay một
architecture đúng cho mọi hệ thống. Chúng giúp trả lời các câu hỏi thực tế:
state nào cần được bảo vệ, detail nào thay đổi, dependency nào cần đảo chiều,
và behavior nào phải nhất quán giữa các implementation.

Cách làm của một senior engineer không phải là áp dụng nhiều pattern hơn. Đó
là xác định coupling đang khiến thay đổi tiếp theo trở nên đắt đỏ, tạo
boundary nhỏ nhất giải quyết được pressure đó, rồi để phần code còn lại yên.
