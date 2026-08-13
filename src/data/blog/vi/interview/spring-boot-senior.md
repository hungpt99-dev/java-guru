---
title: "Ôn thi Java #3: Spring Boot — Junior đến Senior"
description: "Spring Boot là nơi các senior Java backend sinh sống. IoC/DI, bean lifecycle, quản lý transaction, và phép thuật auto-configuration mà interviewer mong bạn nhìn thấu."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Spring Boot là nơi "tôi biết Java" gặp "tôi chạy được backend". Junior autowire và cầu nguyện; senior hiểu container, proxy, và transaction boundary. Bài này đi từ `@Autowired` đến "tại sao `@Transactional` của tôi thầm không chạy".

> Mindset: junior dùng annotation; senior vẽ được bean lifecycle và giải thích chính xác khi nào proxy bọc method của họ — và khi nào không.

## Junior — nền tảng

**Q1. IoC và DI trong Spring là gì?**
Inversion of Control: framework, không phải code của bạn, sở hữu việc tạo và nối object. Dependency Injection là cơ chế — dependency được đẩy vào (constructor, setter, hay field) thay vì tự fetch. Kết quả: class khai báo thứ nó cần, Spring cung cấp. Constructor injection được ưu tiên (immutable, testable, fail nhanh khi thiếu dep).

**Q2. Khác nhau giữa `@Component`, `@Service`, `@Repository`, `@Controller`?**
Chúng đều là stereotype của `@Component` (nên được scan và đăng ký thành bean). Subtype là marker ngữ nghĩa: `@Repository` thêm persistence exception translation (đổi exception JDBC/ORM thành `DataAccessException` của Spring), `@Service` đánh dấu business logic, `@Controller`/`@RestController` xử lý HTTP. Về chức năng chúng tạo bean; label hướng người đọc và AOP.

**Q3. Scope mặc định của bean là gì, và có những scope nào?**
Mặc định là **singleton** — một instance chia sẻ mỗi container. Khác: `prototype` (instance mới mỗi request), `request`/`session` (mỗi HTTP request/session, chỉ web), `application`. Bug phổ biến: inject `prototype` bean vào `singleton` cho bạn một instance bị capture lúc wiring — không phải mới mỗi call. Dùng `ObjectProvider` hoặc lookup method cho semantics đúng per-call.

**Q4. `@SpringBootApplication` làm gì?**
Nó là tổ hợp của `@Configuration` (định nghĩa bean), `@EnableAutoConfiguration` (tự động nối bean theo classpath — xem `spring.factories`/auto-config imports), và `@ComponentScan` (scan package và dưới). Đó là lý do main class phải nằm ở root package trên các component.

**Q5. Khác nhau giữa `@RequestParam`, `@PathVariable`, `@RequestBody`?**
`@RequestParam` bind query/form param (`?id=5`), `@PathVariable` bind URI template segment (`/users/{id}`), `@RequestBody` deserialize HTTP body (JSON) thành object. Trộn lẫn chúng là bug 400/405 thường gặp.

**Q6. Khác nhau giữa `@Bean` và `@Component`?**
`@Component` (và anh em) ở mức class, tự động phát hiện qua scan. `@Bean` ở mức method, trong `@Configuration` class, cho bạn kiểm soát tường minh việc construct (vd wrap third-party object không sở hữu). Dùng `@Bean` cho object không control source; `@Component` cho class của mình.

## Mid — tradeoff & điểm mù

**Q1. Tại sao `@Transactional` của tôi không rollback?**
Ba nguyên nhân kinh điển: (1) bạn catch exception và nuốt nó — Spring chỉ rollback khi ném `RuntimeException` (hoặc `rollbackFor` tường minh); (2) bạn gọi method **từ trong cùng class** — self-invocation bypass proxy, nên không mở transaction; (3) method là `private`/`final` — proxy không intercept được. Fix: ném, chuyển call sang bean khác, hoặc dùng `TransactionTemplate` cho self-call.

**Q2. `@Transactional` thực sự hoạt động ra sao — proxy là gì?**
Spring bọc bean của bạn trong proxy. Khi method `@Transactional` proxied được gọi _qua proxy_, nó mở connection/transaction trước khi gọi method bạn và commit/rollback sau. Nếu call không qua proxy (self-call cùng class, hoặc bạn `new` object), không có transaction. Đó là lý do final/private method thầm bỏ qua nó.

**Q3. Khác nhau giữa `CrudRepository`, `JpaRepository`, và `EntityManager`?**
`CrudRepository` cho CRUD cơ bản; `JpaRepository` mở rộng thêm pagination, flush, batch. Cả hai là Spring Data abstraction trên JPA. Để kiểm soát thô (native SQL, flush chi tiết) bạn xuống `EntityManager`. Lạm dụng `JpaRepository.save()` trong loop không `flush`/`clear` có thể thổi persistence context — batch bằng `saveAllAndFlush` và cân nhắc `EntityManager.clear()` giữa các chunk.

**Q4. Auto-configuration làm gì, và debug "tại sao thiếu bean này" thế nào?**
Auto-config class có điều kiện trên classpath + vắng mặt bean tự định nghĩa (`@ConditionalOnMissingBean`, `@ConditionalOnClass`). Nếu bean không tạo, thiếu thứ gì trên classpath hoặc điều kiện fail. Debug bằng `--debug` startup log (in auto-config report: positive/negative matches) hoặc `spring.autoconfigure.exclude`. Đừng đánh nó bằng `@ComponentScan` ngẫu nhiên — hãy đọc report.

**Q5. Khác nhau giữa `@ControllerAdvice` và `Filter`?**
`@ControllerAdvice` với `@ExceptionHandler` catch exception ném _từ controller_ và trả response có cấu trúc — nhưng nó chạy trong DispatcherServlet, nên không catch lỗi trước đó (vd filter/auth failure, hay exception trong `Filter`). `Filter`/`HandlerInterceptor` nằm sớm hơn trong chain và catch/auth mọi thứ kể cả path không phải controller. Dùng advice cho shape lỗi API thống nhất; dùng filter cho cross-cutting pre-controller.

**Q6. Externalize config và xử lý nhiều môi trường thế nào?**
`application.yml`/`properties` với file per-profile (`application-prod.yml`), kích hoạt bởi `spring.profiles.active`. Giá trị từ env var / secret manager override file (Spring relaxed binding: `SPRING_DATASOURCE_URL` override `spring.datasource.url`). Đừng hardcode credential — inject từ env hay secret store. `@ConfigurationProperties` bind typed object từ tree, tốt hơn `@Value` cho config có cấu trúc.

## Senior — thiết kế & phòng thủ

**Q1. Một service `@Transactional` chậm dưới tải — bạn nghi transaction sống lâu. Chẩn đoán và fix.**
"Đầu tiên tôi xác nhận transaction trải quá rộng: bật `spring.jpa.show-sql` / actuator và trace connection bị giữ ở đâu. Thường method gọi external chậm (HTTP, DB khác) _trong_ transaction — giữ connection vài giây và cạn pool (`HikariPool` chờ, rồi `ConnectionTimeoutException`). Fix: đẩy external call _ra ngoài_ transaction, giữ TX chỉ cho DB write tối thiểu, và set `@Transactional(timeout=3)` để TX runaway fail nhanh thay vì pin connection. Tôi đo pool wait time trước/sau — mục tiêu gần zero."

**Q2. Thiết kế layered architecture sạch với Spring không leak persistence layer.**
"Controller → Service (`@Transactional`) → Repository. Service trả domain object hoặc DTO, không bao giờ JPA entity, cho controller — nếu không collection lazy-loaded ném `LazyInitializationException` trong serializer. Tôi map entity→DTO ở service boundary (MapStruct hoặc thủ công). Repository nằm sau service; controller không chạm nó. Việc này giữ transaction boundary trong service và serialization ở ngoài — bẫy `OpenEntityManagerInView` biến mất."

**Q3. Bạn cần hai bean cùng type — nối chúng không ambiguity thế nào?**
"Tôi qualify: `@Qualifier("primary")` trên bean và điểm inject, hoặc tốt hơn, cho bean type riêng biệt qua interface nên không ambiguity. Pattern sạch hơn là `@Bean` method trả interface với tên method riêng, rồi inject theo subtype cụ thể. Tránh `@Primary` làm default thầm — nó che intent. Nếu thực sự là strategy, truyền `List<Handler>` và dispatch theo key thay vì chọn một bean."

**Q4. Giải thích bean lifecycle và bạn hook logic tùy biến ở đâu.**
"Instantiation → populate properties → aware callbacks (`BeanNameAware`, ...) → `BeanPostProcessor.before` → `@PostConstruct` → `InitializingBean.afterPropertiesSet` → `BeanPostProcessor.after` → ready → shutdown `@PreDestroy`/`DisposableBean`. Cho setup cross-cutting tôi dùng `BeanPostProcessor` hoặc `@PostConstruct`; cho init một bean, `@PostConstruct`. Tôi tránh `InitializingBean` (couple với Spring) ưu tiên `@PostConstruct`. Senior biết thứ tự vì đó là nơi proxy creation và AOP weaving thực sự xảy ra."

**Q5. Khi nào bạn KHÔNG dùng Spring Boot, và thay bằng gì?**
"Cho CLI nhỏ hoặc path latency-critical nơi footprint ~hàng trăm MB và startup dựa reflection (giây) đau, tôi cân nhắc framework như Micronaut hay Quarkus với build-time DI (startup sub-second, memory thấp) hoặc thậm chí Java thuần. Spring Boot thắng về ecosystem và hiring; cho serverless nhạy cold-start hoặc workload tài nguyên tí hon, compile-time DI framework là trade tốt hơn. Tôi quyết trên startup budget và memory ceiling, không phải thói quen."

**Q6. Phòng thủ chiến lược config Spring ở quy mô (50 service).**
"Một `spring-cloud-config` chia sẻ hoặc config server backend Git, với per-service override và giá trị env-specific inject từ platform (K8s ConfigMap/Secret). Tôi giữ `application.yml` tối thiểu — connection string và secret từ environment, không bao giờ commit. Tôi dùng `@ConfigurationProperties` cho typed binding và fail-fast trên missing required key (`@Validated`). Ở 50 service, consistency của naming và single source of truth cho shared setting quan trọng hơn tiện lợi — tôi enforce qua shared starter module thay vì copy-paste."

#### Self-check

- [ ] Junior: Tôi giải thích được IoC/DI, stereotype annotation, singleton scope mặc định, và `@RequestBody` vs `@PathVariable`.
- [ ] Mid: Tôi giải thích được tại sao `@Transactional` thầm fail (proxy/self-invoke/catch), auto-config condition hoạt động ra sao, và `@ControllerAdvice` vs `Filter`.
- [ ] Senior: Tôi chẩn đoán được pool exhaustion do long-lived transaction, thiết kế layered architecture sạch với DTO mapping, nối nhiều bean không ambiguity, và phòng thủ Spring Boot vs compile-time-DI framework bằng startup/memory budget.
