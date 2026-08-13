---
title: "Ôn thi Java #3: Spring Boot — Junior đến Senior"
description: "Spring Boot là nơi các senior Java backend sinh sống. IoC/DI, bean lifecycle, quản lý transaction, và phép thuật auto-configuration mà interviewer mong bạn nhìn thấu — bằng code, không chỉ annotation."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Spring Boot là nơi "tôi biết Java" gặp "tôi chạy được backend". Junior autowire và cầu nguyện; senior hiểu container, proxy, và transaction boundary — và show được code chính xác nơi `@Transactional` thầm fail. Bài này đi từ `@Autowired` đến "tại sao transaction của tôi không rollback", với example runnable.

> Mindset: junior dùng annotation; senior vẽ được bean lifecycle và giải thích chính xác khi nào proxy bọc method của họ — và khi nào không.

## Junior — nền tảng

**Q1. IoC và DI trong Spring là gì?**
Inversion of Control: framework sở hữu việc tạo và nối object. Dependency Injection đẩy dependency vào (constructor, setter, field). Constructor injection được ưu tiên — immutable, testable, fail nhanh khi thiếu dependency.

```java
// WRONG: field injection — không test được không có Spring, che giấu required dep
@Autowired private UserRepository repo;

// RIGHT: constructor injection — final, testable, explicit
@Service
public class UserService {
  private final UserRepository repo;
  public UserService(UserRepository repo) { this.repo = repo; }
}
```

**Q2. `@Component` vs `@Service` vs `@Repository` vs `@Controller`?**
Tất cả là stereotype của `@Component` auto-scan thành bean. `@Repository` thêm persistence exception translation; `@Service`/`@Controller` là marker ngữ nghĩa cho reader và AOP.

**Q3. Scope mặc định của bean?**
**Singleton** — một instance chia sẻ mỗi container. Bug phổ biến: inject `prototype` vào `singleton` capture một instance tại wiring, không phải mới mỗi call. Dùng `ObjectProvider` cho per-call thật:

```java
@Service
public class OrderService {
  private final ObjectProvider<PriceCalculator> calculators;
  public PriceCalculator current() { return calculators.getObject(); } // fresh mỗi call
}
```

**Q4. `@SpringBootApplication` làm gì?**
Nó composes `@Configuration` + `@EnableAutoConfiguration` (nối bean từ classpath) + `@ComponentScan` (scan package và dưới). Đó là lý do main class phải ở root package trên component.

**Q5. `@RequestParam` vs `@PathVariable` vs `@RequestBody`?**
`?q=5` → `@RequestParam`; `/users/5` → `@PathVariable`; JSON body → `@RequestBody`. Trộn lẫn là bug 400/405 thường gặp.

**Q6. `@Bean` vs `@Component`?**
`@Component` ở mức class, auto-detect. `@Bean` ở mức method trong `@Configuration` — dùng để wrap third-party object không sở hữu:

```java
@Configuration
public class AppConfig {
  @Bean
  public RestTemplate restTemplate() { return new RestTemplateBuilder().setConnectTimeout(Duration.ofSeconds(3)).build(); }
}
```

## Mid — tradeoff & điểm mù

**Q1. Tại sao `@Transactional` không rollback?**
Ba nguyên nhân kinh điển — và code sửa mỗi cái:

```java
// 1) bạn nuốt exception -> Spring không thấy
@Transactional
public void transfer() {
  try { debit(); credit(); }
  catch (Exception e) { log.error(e); }   // WRONG: nuốt -> commit!
}
// FIX: để nó propagate (hoặc @Transactional(rollbackFor=...))

// 2) self-invocation bypass proxy -> không transaction
public void outer() { this.inner(); }     // WRONG: direct call, không proxy
@Transactional public void inner() { ... }
// FIX: chuyển inner() sang @Service bean khác

// 3) private/final -> proxy không intercept
@Transactional private void foo() { }      // WRONG: không bao giờ proxied
```

**Q2. `@Transactional` thực sự hoạt động ra sao — proxy?**
Spring bọc bean trong proxy. Method `@Transactional` proxied mở qua proxy bắt đầu connection/transaction trước method và commit/rollback sau. Call không qua proxy (self-call cùng class, hoặc `new`) không có transaction. Đó là lý do `private`/`final` thầm bỏ qua nó.

**Q3. `CrudRepository` vs `JpaRepository` vs `EntityManager`?**
`CrudRepository` → CRUD cơ bản; `JpaRepository` thêm pagination + batch. Cả hai là Spring Data trên JPA. Cho control thô xuống `EntityManager`. Lạm dụng `save()` trong loop không flush/clear có thể thổi persistence context — batch bằng `saveAllAndFlush`:

```java
// WRONG: 10k entity tích trong PC trước một flush
for (Order o : orders) repo.save(o);
// RIGHT: flush + clear mỗi 500
int i = 0;
for (Order o : orders) { repo.save(o); if (++i % 500 == 0) { repo.flush(); entityManager.clear(); } }
```

**Q4. Auto-configuration hoạt động ra sao, và debug bean thiếu?**
Auto-config class có điều kiện trên classpath + `@ConditionalOnMissingBean`. Nếu bean thiếu, điều kiện fail. Debug bằng `--debug` startup (in positive/negative auto-config match) hoặc `spring.autoconfigure.exclude`.

**Q5. `@ControllerAdvice` vs `Filter`?**
`@ExceptionHandler` trong `@ControllerAdvice` catch exception từ controller (trong DispatcherServlet) và trả body có cấu trúc — nhưng không catch pre-controller failure (filter/auth). `Filter` nằm sớm hơn và catch mọi thứ:

```java
@ControllerAdvice
public class ApiErrors {
  @ExceptionHandler(NotFound.class)
  public ResponseEntity<ErrorBody> handle(NotFound e) {
    return ResponseEntity.status(404).body(new ErrorBody(e.getMessage()));
  }
}
```

**Q6. Externalize config xuyên môi trường thế nào?**
Profile file (`application-prod.yml`) kích hoạt bởi `spring.profiles.active`; env var override (`SPRING_DATASOURCE_URL` override `spring.datasource.url`). Đừng hardcode credential — inject từ env/secret store. `@ConfigurationProperties` bind typed object (tốt hơn `@Value` cho config có cấu trúc).

## Senior — thiết kế & phòng thủ

**Q1. `@Transactional` service chậm dưới tải — nghi long-lived transaction. Chẩn đoán và fix.**
"Tôi xác nhận transaction trải quá rộng: bật `spring.jpa.show-sql` và trace connection bị giữ ở đâu. Thường method làm slow external call (HTTP, DB khác) _trong_ transaction — giữ connection vài giây cạn pool (`HikariPool` chờ, rồi `ConnectionTimeoutException` sau mặc định 30 s). Fix: đẩy external call _ra ngoài_ transaction, giữ TX chỉ write tối thiểu, và set `@Transactional(timeout=3)` để runaway TX fail nhanh. Tôi đo pool wait time trước/sau — mục tiêu gần zero."

**Q2. Thiết kế layered architecture sạch không leak persistence layer.**
"Controller → Service (`@Transactional`) → Repository. Service trả DTO, không bao giờ JPA entity, cho controller — không thì lazy collection throw `LazyInitializationException` trong serializer. Map entity→DTO ở service boundary (MapStruct hoặc thủ công). Repository nằm sau service; controller không chạm. Việc này giữ transaction boundary trong service và serialization ở ngoài — bẫy `OpenEntityManagerInView` biến mất."

```java
// WRONG: trả entity -> lazy collection nổ trong JSON serialization
public UserEntity get(Long id) { return repo.findById(id).orElseThrow(); }
// RIGHT: map sang DTO tại boundary
public UserDto get(Long id) { return repo.findById(id).map(UserDto::from).orElseThrow(); }
```

**Q3. Cần hai bean cùng type — nối unambiguously.**
"Qualify: `@Qualifier("stripe")` trên bean và điểm inject, hoặc cho type riêng biệt qua interface. Pattern sạch hơn là inject `List<Handler>` và dispatch theo key thay vì chọn một bean:"

```java
@Bean @Qualifier("stripe") public PaymentGateway stripe() { return new StripeGateway(); }
@Bean @Qualifier("paypal") public PaymentGateway paypal() { return new PaypalGateway(); }

@Autowired @Qualifier("stripe") PaymentGateway gateway;  // explicit
```

**Q4. Giải thích bean lifecycle và AOP weaves ở đâu.**
"Instantiation → populate → aware callbacks → `BeanPostProcessor.before` → `@PostConstruct` → `InitializingBean.afterPropertiesSet` → `BeanPostProcessor.after` → ready. Proxy creation và AOP weaving xảy ra trong `BeanPostProcessor` phase — chỉ chỗ đó Spring wrap được bean. Tôi dùng `@PostConstruct` cho init, tránh `InitializingBean` (couple với Spring)."

**Q5. Khi nào KHÔNG dùng Spring Boot?**
"Cho CLI nhỏ hoặc latency-critical path nơi footprint ~hàng trăm MB và startup dựa reflection (giây) đau, tôi cân nhắc Micronaut/Quarkus với build-time DI (sub-second startup, memory thấp) hoặc Java thuần. Spring Boot thắng về ecosystem và hiring; cho serverless nhạy cold-start hoặc workload tí hon, compile-time DI framework là trade tốt hơn. Tôi quyết trên startup budget và memory ceiling, không phải thói quen."

**Q6. Phòng thủ config strategy ở 50 service.**
"Một `spring-cloud-config` (Git-backed) với per-service override; connection string và secret từ platform (K8s ConfigMap/Secret), không bao giờ commit. Tôi dùng `@ConfigurationProperties` cho typed binding và fail-fast trên missing required key (`@Validated`). Ở 50 service, consistency của naming và single source of truth quan trọng hơn tiện lợi — tôi enforce qua shared starter module, không phải copy-paste. Lợi ích đo được: secret rotation chạm một chỗ, không phải 50 repo."

#### Self-check

- [ ] Junior: Tôi giải thích được IoC/DI (với constructor injection), stereotype, singleton scope, `@SpringBootApplication`, và `@RequestBody` vs `@PathVariable` — bằng code.
- [ ] Mid: Tôi show được tại sao `@Transactional` thầm fail (swallow/self-invoke/private) bằng code, auto-config condition hoạt động ra sao, và `@ControllerAdvice` vs `Filter`.
- [ ] Senior: Tôi chẩn đoán được pool exhaustion do long-lived transaction (default 30 s timeout), thiết kế layered architecture với DTO mapping, nối hai bean unambiguously, giải thích lifecycle + AOP weave point, và phòng thủ Spring Boot vs compile-time-DI bằng startup/memory budget.
