---
title: "Phỏng vấn Senior Java: Spring Boot"
description: "Spring Boot là nơi senior Java backend sống. IoC/DI, bean lifecycle, quản lý transaction, và auto-configuration magic mà phỏng vấn viên mong bạn nhìn thấu."
pubDatetime: 2026-08-12T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Đa số vị trí senior Java backend là Spring Boot. Phỏng vấn viên mong bạn hiểu framework, không chỉ dùng.

## 1. IoC và DI

- **Inversion of Control:** container sở hữu tạo và wiring object; bạn khai báo dependency, nó cung cấp.
- **DI styles:** constructor injection (ưu tiên — immutable, testable) hơn field injection (khó test, giấu dependency).
- **Bean scopes:** singleton (default), prototype, request, session, và tương tác với state.

```java
// Constructor injection — testable, explicit
@Service
public class OrderService {
    private final PaymentGateway gateway;
    public OrderService(PaymentGateway gateway) { this.gateway = gateway; }
}
```

## 2. Bean lifecycle

Các pha: instantiation → population (DI) → `Aware` callbacks → `BeanPostProcessor` (trước/sau init) → `@PostConstruct` → custom `init` → ready → `@PreDestroy` lúc shutdown. Phỏng vấn viên thích "cái gì chạy khi nào."

## 3. Auto-configuration

- **`@SpringBootApplication`** gộp `@Configuration`, `@ComponentScan`, `@EnableAutoConfiguration`.
- Auto-config qua `spring.factories`/`AutoConfiguration.imports` + `@ConditionalOnClass`/`@ConditionalOnMissingBean`. Senior giải thích _tại sao_ starter chỉ kích hoạt khi class có trên classpath, và cách override.
- **Bẫy:** để auto-config giấu thứ đang chạy. Biết actuator endpoints và beans tồn tại.

## 4. Transaction management

- **`@Transactional`** dựa trên proxy — **không** chạy trên self-invocation (gọi `@Transactional` khác trên `this`). Biết tại sao.
- **Propagation:** REQUIRED (join/có sẵn), REQUIRES_NEW (suspend), NESTED.
- **Isolation** map sang DB level; default thường là DB default (READ_COMMITTED).
- **Rollback:** mặc định rollback với RuntimeException, không phải checked — bẫy kinh điển.

## 5. Pitfalls production

- Blocking I/O trong web request thiếu thread pool; N+1 từ lazy loading; unbounded in-memory cache; thiếu timeout cho `RestTemplate`/`WebClient`; act trên `@Cacheable` stale.

## 6. Tự kiểm tra

- [ ] Constructor vs field injection, và tại sao constructor thắng.
- [ ] Tại sao `@Transactional` fail trên self-invocation.
- [ ] Auto-config quyết định kích hoạt thế nào.
- [ ] Một incident Spring Boot bạn debug.

Đó là bar Spring Boot.
