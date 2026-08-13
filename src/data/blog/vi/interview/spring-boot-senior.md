---
title: "Ôn thi Java #3: Spring Boot — Junior đến Senior"
description: "Spring Boot là nơi các senior Java backend sinh sống. IoC/DI, bean lifecycle, quản lý transaction, và phép thuật auto-configuration mà interviewer mong bạn nhìn thấu — 50 câu hỏi với code, không chỉ annotation."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Spring Boot là nơi "tôi biết Java" gặp "tôi chạy được backend". Junior autowire và cầu nguyện; senior hiểu container, proxy, và transaction boundary — và show được code chính xác nơi `@Transactional` thầm fail. 50 câu hỏi, từ `@Autowired` đến "tại sao transaction của tôi không rollback", với example runnable.

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
Tất cả là stereotype của `@Component` auto-scan thành bean. `@Repository` thêm persistence exception translation; `@Service`/`@Controller` là marker ngữ nghĩa. Một class có thể mang nhiều stereotype nhưng một là quy ước.

**Q3. Scope mặc định của bean?**
**Singleton** — một instance chia sẻ mỗi container. Bug phổ biến: inject `prototype` vào `singleton` capture một instance tại wiring, không phải mới mỗi call. Dùng `ObjectProvider` cho per-call thật:

```java
@Service
public class OrderService {
  private final ObjectProvider<PriceCalculator> calculators;
  public PriceCalculator current() { return calculators.getObject(); }
}
```

**Q4. `@SpringBootApplication` làm gì?**
Nó composes `@Configuration` + `@EnableAutoConfiguration` (nối bean từ classpath) + `@ComponentScan` (scan package và dưới). Main class phải ở root package trên component.

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

**Q7. `@Autowired` trên constructor — cần không?**
Từ Spring 4.3, class single-constructor được autowire implicit; bạn bỏ `@Autowired`. Với nhiều constructor bạn phải mark cái Spring dùng. Ưu tiên implicit single-constructor — ít noise.

**Q8. Khác nhau `@Value` và `@ConfigurationProperties`?**
`@Value("${db.url}")` inject một property (stringly-typed, dễ typo). `@ConfigurationProperties("db")` bind typed object (`db.url`, `db.pool-size`) — tốt hơn cho structured config, với relaxed binding và validation qua `@Validated`.

**Q9. `@PostConstruct` làm gì, chạy khi nào?**
Nó mark method chạy một lần sau khi dependency injection xong, trước khi bean được dùng. Dùng cho init cần bean khác. Tránh work nặng ở đó (nó block startup). Cho cleanup, `@PreDestroy`.

**Q10. Khác nhau `@Controller` và `@RestController`?**
`@Controller` trả view name (server-rendered template); `@RestController` là `@Controller` + `@ResponseBody` — trả serialized body (JSON) trực tiếp. Cho API, luôn `@RestController`.

**Q11. Inject `List` của mọi bean cùng type thế nào?**
Spring auto-collect: `public MyService(List<Handler> handlers)`. Hữu ích cho strategy dispatch. Order với `@Order` hoặc `Ordered`. Đây là cách Spring tự wire nhiều `Filter`/`HandlerMethodArgumentResolver`.

**Q12. `application.properties` vs `application.yml`?**
Cả hai config app; `yml` hỗ trợ nested hierarchical structure (dễ cho deep config), `properties` flat key=value. Chúng interchangeable; chọn cho readability. Sai YAML indentation là silent misconfiguration — top failure mode.

**Q13. Stereotype annotation vs meta-annotation?**
`@Service` bản thân là `@Component` — một _meta-type_. Tạo `@OrderService` meta-annotate với `@Service` + `@Transactional` compose behavior. Đây là cách Spring's own annotation stack.

**Q14. `spring.profiles.active` làm gì?**
Nó chọn active profile(s), load `application-{profile}.yml` và `@Profile("prod")` bean. Default profile luôn active. Dùng để swap config per environment không đổi code.

**Q15. Khác nhau `@Import` và `@ComponentScan`?**
`@ComponentScan` tìm annotated class trên classpath trong package. `@Import` explicitly register specific config/bean (kể cả auto-config class). Dùng `@Import` cho precise wiring của third-party config.

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
Auto-config class có điều kiện trên classpath + `@ConditionalOnMissingBean`. Nếu bean thiếu, điều kiện fail. Debug bằng `--debug` startup (in positive/negative match) hoặc `spring.autoconfigure.exclude`.

**Q5. `@ControllerAdvice` vs `Filter`?**
`@ExceptionHandler` trong `@ControllerAdvice` catch exception từ controller (trong DispatcherServlet) và trả body có cấu trúc — nhưng không catch pre-controller failure (filter/auth). `Filter` nằm sớm hơn:

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
Profile file (`application-prod.yml`) kích hoạt bởi `spring.profiles.active`; env var override (`SPRING_DATASOURCE_URL` override `spring.datasource.url`). Đừng hardcode credential — inject từ env/secret store. `@ConfigurationProperties` bind typed object (tốt hơn `@Value` cho structured config).

**Q7. Khác nhau `@Transactional(readOnly=true)` và transaction thường?**
`readOnly=true` hint persistence provider skip dirty checking và flush (~10–20% read-path speedup) và cho phép một số DB dùng read replica. Nó là hint, không enforced — write vẫn có thể xảy ra, nhưng optimize common case. Dùng cho query-only method.

**Q8. `LazyInitializationException` là gì và tại sao xảy ra?**
Lazy collection của entity (`@OneToMany(fetch=LAZY)`) được access sau khi session/transaction đóng → exception. Thường khi trả entity cho controller (session đã đóng). Fix: fetch eagerly nơi cần (`JOIN FETCH`), hoặc dùng DTO mapped inside transaction.

**Q9. Khác nhau `@Query` và derived method name?**
`findByUsername(String)` derived bằng naming convention (Spring parse). `@Query("select u from User u where u.username=:u")` explicit JPQL. Derived name break silently trên typo; `@Query` explicit và hỗ trợ join/complex logic. Ưu tiên `@Query` cho thứ non-trivial.

**Q10. `spring.jpa.open-in-view` làm gì, và tại sao disable?**
Nó giữ JPA `EntityManager` mở cho toàn request (nên lazy load work trong view), nhưng giữ DB connection cho toàn request — kể cả sau business logic xong. Disable (`false`) để release connection sớm hơn; rồi fetch mọi thứ bạn cần inside transaction. Default là `true` — common prod culprit cho pool exhaustion.

**Q11. Khác nhau `@MockBean` và `@Mock`?**
`@MockBean` register một mock như Spring bean (thay real one trong context) — cho `@SpringBootTest`. `@Mock` (Mockito) là standalone mock cho plain unit test. Mix chúng nghĩa mock của bạn không được wire vào context.

**Q12. Handle `@Scheduled` method overlap thế nào?**
`@Scheduled(fixedRate=5s)` start mỗi 5s kể cả run trước chưa xong → overlapping execution. Dùng `fixedDelay=5s` (chờ completion) hoặc `@Scheduled` + `@Transactional` + leader-lock (ShedLock) để chỉ một node chạy trong cluster. Không có nó, hai pod double-execute.

**Q13. Khác nhau `@RequestMapping` và specific verb?**
`@GetMapping`, `@PostMapping`, v.v. là shortcut cho `@RequestMapping(method=GET)`. Chúng rõ hơn và giảm chance sai-method bug. Dùng specific verb.

**Q14. `BeanPostProcessor` là gì?**
Hook chạy trên mọi bean sau instantiation (và before/after init). AOP proxy, `@Autowired` resolution, và `@PostConstruct` đều xảy ra ở đây. Đây là seam nơi Spring weave cross-cutting behavior. Viết một cái là advanced; nhận ra một cái giải thích nửa magic của Spring.

**Q15. Khác nhau `@Transactional` propagation REQUIRED vs REQUIRES_NEW?**
`REQUIRED` (default) join existing transaction hoặc tạo mới. `REQUIRES_NEW` luôn suspend current và start fresh — inner commit/rollback độc lập. Dùng `REQUIRES_NEW` cho audit log phải persist ngay cả outer rollback (vd log failed payment).

**Q16. Khác nhau `@Cacheable` và manual caching?**
`@Cacheable` (với `@EnableCaching`) cache method return value keyed bởi argument, transparently. Pitfall: cache method có result phụ thuộc non-argument state (stale cache), hoặc cache `null`/mutable object. Invalidate với `@CacheEvict`. Nó ~microsecond để fetch từ local cache vs ~ms cho DB call.

**Q17. Khác nhau `@Async` và thread pool?**
`@Async` chạy method trên thread riêng từ `TaskExecutor` (default `SimpleAsyncTaskExecutor`, unbounded — nguy hiểm). Configure bounded `ThreadPoolTaskExecutor` và set `@Async("myExecutor")`. Không có bounded pool, `@Async` có thể spawn unlimited thread.

## Senior — thiết kế & phòng thủ

**Q1. `@Transactional` service chậm dưới tải — nghi long-lived transaction. Chẩn đoán và fix.**
"Tôi xác nhận transaction trải quá rộng: bật `spring.jpa.show-sql` và trace connection bị giữ ở đâu. Thường method làm slow external call (HTTP, DB khác) _trong_ transaction — giữ connection vài giây cạn pool (`HikariPool` chờ, rồi `ConnectionTimeoutException` sau mặc định 30 s). Fix: đẩy external call _ra ngoài_ transaction, giữ TX chỉ write tối thiểu, và set `@Transactional(timeout=3)`. Tôi đo pool wait time trước/sau — mục tiêu gần zero."

**Q2. Thiết kế layered architecture sạch không leak persistence layer.**
"Controller → Service (`@Transactional`) → Repository. Service trả DTO, không bao giờ JPA entity, cho controller — không thì lazy collection throw `LazyInitializationException` trong serializer. Map entity→DTO ở service boundary (MapStruct hoặc thủ công). Repository nằm sau service; controller không chạm. Việc này giữ transaction boundary trong service và serialization ở ngoài — bẫy `OpenEntityManagerInView` biến mất."

```java
// WRONG: trả entity -> lazy collection nổ trong JSON serialization
public UserEntity get(Long id) { return repo.findById(id).orElseThrow(); }
// RIGHT: map sang DTO tại boundary
public UserDto get(Long id) { return repo.findById(id).map(UserDto::from).orElseThrow(); }
```

**Q3. Cần hai bean cùng type — nối unambiguously.**
"Qualify: `@Qualifier("primary")` trên bean và điểm inject, hoặc cho type riêng biệt qua interface. Pattern sạch hơn là inject `List<Handler>` và dispatch theo key thay vì chọn một bean:"

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

**Q7. `@Transactional` trên public method gọi từ `@Transactional` khác — NESTED/REQUIRED thế nào?**
"Với `REQUIRED` mặc định, inner call join outer transaction (một shared connection) — chúng commit/rollback cùng nhau. `NESTED` (nếu DB hỗ trợ savepoint, vd PostgreSQL/JDBC) tạo savepoint nên inner rollback độc lập trong khi outer tiếp tục. `REQUIRES_NEW` fully suspend outer. Tôi chọn dựa trên whether partial failure nên abort whole operation hay chỉ một step."

**Q8. Test `@Transactional` service không có real DB thế nào?**
"Dùng `@DataJpaTest` (in-memory H2 mặc định, ~1 s) cho repository layer, và `@SpringBootTest` với `spring.test.context.cache` + Testcontainers Postgres cho integration parity. Cho service, mock repository với `@MockBean` và assert transactional method delegate đúng. Tôi tránh boot full context cho unit test (~20–30 s mỗi cái) — đó là thứ làm suite thành minutes."

**Q9. Custom `@RestControllerAdvice` không catch exception. Tại sao?**
"Nó chỉ catch exception throw _trong_ controller's request mapping (trong DispatcherServlet). Exception từ filter, Spring Security, hoặc argument resolver xảy ra sớm hơn và không được catch. Cũng, nếu bạn có nhiều `@ControllerAdvice` với overlapping `@ExceptionHandler`, most specific thắng. Cho pre-controller failure, dùng `Filter` hoặc Spring Security's entry point."

**Q10. Size và monitor HikariCP connection pool thế nào?**
"`maximumPoolSize` từ Little's Law (~10–30 cho typical service, không 200); `connectionTimeout` 30 s; `idleTimeout` và `maxLifetime` set dưới DB's `wait_timeout` (vd maxLifetime 28 min vs MySQL 30 min, để tránh 'connection closed' mid-use). Tôi expose Hikari's `HikariPoolMXBean` metric (active/idle/awaiting) và alert trên `awaiting > 0` sustained — đó là pool exhaustion trước khi thành 30 s timeout storm."

**Q11. `@Async` method nuốt exception silently. Catch thế nào?**
"`@Async` chạy trên thread khác, nên exception không propagate cho caller — chúng được log và mất. Fix: cung cấp `AsyncUncaughtExceptionHandler` qua `AsyncConfigurer`, hoặc trả `CompletableFuture` và handle exception của nó. Tôi luôn trả `CompletableFuture` từ `@Async` method để caller observe failure."

**Q12. Ngăn `@Cacheable` phục vụ stale data xuyên deploy thế nào?**
"Cache entry survive restart chỉ nếu backed bởi distributed store (Redis); in-memory cache rỗng sau deploy (cold, rồi repopulate — brief stampede). Cho correctness xuyên deploy, dùng shared Redis cache với TTL ngắn hơn staleness tolerance của data, và `@CacheEvict` trên write. Tôi set TTL sao worst case là 'serve up-to-TTL-old data', không bao giờ indefinite staleness."

**Q13. Scheduled job chạy hai lần trong prod (hai pod). Fix.**
"Plain `@Scheduled` chạy trên mọi instance. Trong cluster bạn cần leader lock. Dùng ShedLock (`@SchedulerLock`) take DB/Redis lock nên chỉ một node execute. Hoặc chạy job trong single dedicated cron pod. Không có nó, mọi pod chạy nó → double email, double charge. Tôi treat scheduling như distributed concern, không phải per-instance."

**Q14. Làm Spring Boot app start fast (sub-second) thế nào?**
"Lazy initialization (`spring.main.lazy-initialization=true`) defer bean creation đến first use (cut startup nhưng add first-request latency). Compile-time DI (Micronaut/Quarkus) beat Spring's reflection-based startup. Trim auto-config (exclude unused qua `spring.autoconfigure.exclude`). Cho serverless, cân nhắc GraalVM native image (startup ~10–50 ms, nhưng build ~minutes và không mọi lib compatible). Tôi đo startup và pick cheapest meet cold-start SLA."

**Q15. Khác nhau `@MockBean` trong `@SpringBootTest` và slice test?**
"Full `@SpringBootTest` boot entire context (~20–30 s). Slice test (`@WebMvcTest`, `@DataJpaTest`, `@JsonTest`) boot chỉ relevant layer (~1–3 s). Dùng full-context test cho mọi thứ làm suite take minutes. Tôi dùng slice cho 90% test và full-context chỉ cho true integration point. Đo được: 200 slice test chạy ~30 s vs ~10 min cho equivalent full-context suite."

**Q16. Debug `NoSuchBeanDefinitionException` thế nào?**
"Bean không trong context — nguyên nhân: component không scanned (sai package, không `@Component`), conditional exclusion (`@Profile`/`@ConditionalOn...` false), hoặc nó abstract/interface không có impl. Chạy `--debug` để thấy auto-config report, grep tên bean, và check điều kiện nào fail (`Negative matches`). 9/10 lần là package ngoài `@ComponentScan`."

**Q17. Thiết kế cho zero-downtime config change ở 50 service.**
"Config qua `spring-cloud-config` với `@RefreshScope` bean; `/actuator/refresh` (hoặc bus event) reload chúng không restart. Nhưng `@RefreshScope` re-create bean — connection trong `@RefreshScope` `@Bean` get closed/reopened, nên scope connection pool carefully hoặc bạn drop in-flight request. Tôi scope chỉ config-bearing bean, không phải pool, và test refresh under load để confirm không connection churn."

**Q18. Phòng thủ `@Transactional` boundary khi service gọi 3 service khác thế nào?**
"Bạn thường KHÔNG nên wrap 3 remote call trong một DB transaction — transaction giữ DB connection cho duration của cả 3 network call (giây), cạn pool. Lựa chọn: (1) làm local DB write trước, commit, rồi gọi service (saga-style với compensation); (2) dùng outbox để publish event sau commit. Tôi giữ transaction cho DB-only work và treat cross-service call như separate, compensatable step. Giữ TX xuyên network call là #1 cause của pool exhaustion tôi thấy."

#### Self-check

- [ ] Junior: Tôi giải thích được IoC/DI (với constructor injection), stereotype, singleton scope, `@SpringBootApplication`, và `@RequestBody` vs `@PathVariable` — bằng code.
- [ ] Mid: Tôi show được tại sao `@Transactional` thầm fail (swallow/self-invoke/private) bằng code, auto-config condition hoạt động ra sao, `@ControllerAdvice` vs `Filter`, và OpenEntityManagerInView.
- [ ] Senior: Tôi chẩn đoán được pool exhaustion do long-lived transaction (default 30 s timeout), thiết kế layered architecture với DTO mapping, nối hai bean unambiguously, giải thích lifecycle + AOP weave point, size/monitor HikariCP, và phòng thủ transaction boundary xuyên service call.
