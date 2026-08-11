---
title: "Phỏng vấn Senior Java: OOP và nguyên lý thiết kế"
description: "OOP cấp senior là áp dụng SOLID, composition over inheritance, và thiết kế interface khi scale — không phải đọc định nghĩa."
pubDatetime: 2026-08-12T10:05:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - oop
  - design-principles
---

OOP là vé vào cửa. Ở cấp senior, phỏng vấn viên muốn thấy nó **được áp dụng dưới ràng buộc**, không đọc thuộc.

## 1. SOLID không phải để đọc định nghĩa

Hai cái bị soi kỹ:

- **Open/Closed.** Thêm tính năng bằng type mới, không sửa class đang chạy. Strategy / Plugin.
- **Dependency Inversion.** Phụ thuộc vào abstraction — _lý do_ Spring tồn tại. Inject `PaymentGateway`, không bao giờ `StripeGateway`.

```java
// Vi phạm DIP: dependency cụ thể gắn cứng
class OrderService {
    private final StripeGateway gateway = new StripeGateway();
}

// Senior: phụ thuộc abstraction, inject
class OrderService {
    private final PaymentGateway gateway;
    OrderService(PaymentGateway gateway) { this.gateway = gateway; }
}
```

Cũng sẵn sàng về Single Responsibility, Liskov, Interface Segregation.

## 2. Composition over inheritance

"Tại sao favor composition over inheritance?" Inheritance gắn bạn vào implementation của cha và phá encapsulation — fragile base class. Hãy delegate behavior thay extend.

## 3. Polymorphism & interface khi scale

Interface segregation quan trọng khi codebase lớn: interface `UserService` 40 method bắt mọi implementer stub 35 method là smell. Tách theo role.

## 4. Bẫy functional Java

Đừng nói "OOP lỗi thời vì functional Java." Senior: cả hai. Streams cho data transform, OOP cho domain giàu behavior. Record (Java 16+) tuyệt cho DTO immutable, nhưng Record chứa business logic là smell — đặt behavior vào service hoặc rich domain type.

## 5. Tự kiểm tra

- [ ] Áp dụng OCP cho một tính năng mà không sửa class cũ.
- [ ] Giải thích DIP bằng ví dụ Spring cụ thể.
- [ ] Một case thật inheritance từng cắn bạn.
- [ ] Khi dùng Record vs class có behavior.

Đó là bar OOP cho senior.
