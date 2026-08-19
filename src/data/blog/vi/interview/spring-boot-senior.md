---
title: "Ôn thi Java #3: Spring Boot — Junior đến Senior"
description: "Spring Boot là môi trường làm việc của các senior Java backend. IoC/DI, vòng đời bean, quản lý transaction và phép thuật auto-configuration mà interviewer mong bạn nhìn thấu — 50 câu hỏi có code, không chỉ annotation."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Spring Boot là nơi "tôi biết Java" gặp "tôi có thể vận hành một backend". Junior thường chỉ autowire rồi cầu may; senior hiểu container, proxy và ranh giới transaction, đồng thời chỉ ra được chính xác đoạn code khiến `@Transactional` âm thầm thất bại. 50 câu hỏi, từ `@Autowired` đến "tại sao transaction của tôi không rollback?", kèm các ví dụ có thể chạy được.

> Tư duy: junior dùng annotation; senior có thể vẽ vòng đời bean và giải thích chính xác khi nào proxy bọc một method, cũng như khi nào nó không bọc.

## Junior — nền tảng

**Q1. IoC và DI trong Spring là gì?**
Inversion of Control nghĩa là framework chịu trách nhiệm tạo và kết nối các object. Dependency Injection cung cấp dependency thông qua constructor, setter hoặc field. Constructor injection được ưu tiên vì hỗ trợ tính bất biến, dễ kiểm thử và phát hiện sớm dependency bị thiếu.

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
Tất cả đều là stereotype của `@Component` và được tự động quét thành bean. `@Repository` bổ sung cơ chế chuyển đổi exception của tầng persistence; `@Service` và `@Controller` là các marker mang tính ngữ nghĩa. Một class có thể mang nhiều stereotype, nhưng thông thường chỉ dùng một loại.

**Q3. Scope mặc định của bean?**
**Singleton** nghĩa là mỗi container chỉ có một instance được dùng chung. Một lỗi phổ biến là inject `prototype` vào `singleton`, khiến một instance bị giữ lại ngay lúc wiring thay vì tạo instance mới cho mỗi lần gọi. Dùng `ObjectProvider` để tạo instance mới theo từng lần gọi:

```java
@Service
public class OrderService {
  private final ObjectProvider<PriceCalculator> calculators;
  public PriceCalculator current() { return calculators.getObject(); }
}
```

**Q4. `@SpringBootApplication` làm gì?**
Nó kết hợp `@Configuration`, `@EnableAutoConfiguration` (kết nối các bean từ classpath) và `@ComponentScan` (quét package cùng các subpackage). Main class phải nằm trong một root package bao trùm các component.

**Q5. `@RequestParam` vs `@PathVariable` vs `@RequestBody`?**
`?q=5` → `@RequestParam`; `/users/5` → `@PathVariable`; JSON body → `@RequestBody`. Nhầm lẫn giữa chúng là nguyên nhân thường gặp của lỗi 400/405.

**Q6. `@Bean` vs `@Component`?**
`@Component` là annotation ở cấp class và được tự động phát hiện. `@Bean` là annotation ở cấp method trong một class `@Configuration`; dùng nó để bọc một object bên thứ ba mà bạn không sở hữu:

```java
@Configuration
public class AppConfig {
  @Bean
  public RestTemplate restTemplate() { return new RestTemplateBuilder().setConnectTimeout(Duration.ofSeconds(3)).build(); }
}
```

**Q7. `@Autowired` trên constructor — cần không?**
Từ Spring 4.3, class chỉ có một constructor sẽ được autowire ngầm, nên có thể bỏ `@Autowired`. Nếu có nhiều constructor, bạn phải đánh dấu constructor mà Spring cần dùng. Nên ưu tiên dạng single-constructor ngầm định để giảm phần khai báo dư thừa.

**Q8. Khác nhau `@Value` và `@ConfigurationProperties`?**
`@Value("${db.url}")` inject một property đơn lẻ; giá trị có kiểu chuỗi nên dễ gõ sai. `@ConfigurationProperties("db")` bind vào một object có kiểu (`db.url`, `db.pool-size`), phù hợp hơn với cấu hình có cấu trúc, đồng thời hỗ trợ relaxed binding và validation thông qua `@Validated`.

**Q9. `@PostConstruct` làm gì, chạy khi nào?**
Nó đánh dấu một method được chạy một lần sau khi dependency injection hoàn tất và trước khi bean được sử dụng. Dùng nó cho phần khởi tạo cần các bean khác. Tránh thực hiện công việc nặng ở đó vì sẽ chặn quá trình khởi động. Dùng `@PreDestroy` cho việc dọn dẹp.

**Q10. Khác nhau `@Controller` và `@RestController`?**
`@Controller` trả về tên view cho template được render ở server; `@RestController` kết hợp `@Controller` và `@ResponseBody`, trả trực tiếp response body đã được serialize, chẳng hạn JSON. Với API, hãy dùng `@RestController`.

**Q11. Inject `List` của mọi bean cùng type thế nào?**
Spring tự động gom chúng lại: `public MyService(List<Handler> handlers)`. Cách này hữu ích khi dispatch theo strategy. Sắp xếp thứ tự bằng `@Order` hoặc `Ordered`. Đây cũng là cách Spring tự wire nhiều `Filter` và `HandlerMethodArgumentResolver`.

**Q12. `application.properties` vs `application.yml`?**
Cả hai đều dùng để cấu hình ứng dụng. `yml` hỗ trợ cấu trúc phân cấp lồng nhau, phù hợp hơn với cấu hình sâu, còn `properties` dùng các cặp `key=value` phẳng. Hai định dạng có thể thay thế cho nhau; hãy chọn định dạng dễ đọc hơn. Thụt lề YAML sai gây misconfiguration âm thầm và là một lỗi rất thường gặp.

**Q13. Stereotype annotation vs meta-annotation?**
`@Service` bản thân được meta-annotate bằng `@Component`. Tạo `@OrderService` với `@Service` và `@Transactional` cho phép kết hợp nhiều hành vi. Đây cũng là cách các annotation của Spring được xếp lớp.

**Q14. `spring.profiles.active` làm gì?**
Nó chọn các profile đang hoạt động, nạp `application-{profile}.yml` và các bean `@Profile("prod")`. Profile mặc định luôn hoạt động. Dùng profile để thay đổi cấu hình theo từng môi trường mà không cần sửa code.

**Q15. Khác nhau `@Import` và `@ComponentScan`?**
`@ComponentScan` tìm các class có annotation trên classpath trong một package. `@Import` đăng ký rõ ràng các configuration hoặc bean cụ thể, kể cả auto-configuration class. Dùng `@Import` để wiring chính xác các configuration bên thứ ba.

## Mid — tradeoff & điểm mù

**Q1. Tại sao `@Transactional` không rollback?**
Có ba nguyên nhân kinh điển, mỗi nguyên nhân có một cách sửa tương ứng:

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
Spring bọc bean trong một proxy. Method `@Transactional` được gọi thông qua proxy sẽ bắt đầu connection và transaction trước khi chạy, rồi commit hoặc rollback sau đó. Call không đi qua proxy, chẳng hạn self-call trong cùng class hoặc object được tạo bằng `new`, sẽ không có transaction. Vì vậy method `private` và `final` âm thầm bỏ qua cơ chế transaction.

**Q3. `CrudRepository` vs `JpaRepository` vs `EntityManager`?**
`CrudRepository` cung cấp CRUD cơ bản; `JpaRepository` bổ sung pagination và thao tác batch. Cả hai đều là abstraction của Spring Data trên JPA. Khi cần kiểm soát ở mức thấp hơn, dùng `EntityManager`. Lạm dụng `save()` trong loop mà không flush/clear có thể làm quá tải persistence context; hãy batch bằng `saveAllAndFlush`:

```java
// WRONG: 10k entity tích trong PC trước một flush
for (Order o : orders) repo.save(o);
// RIGHT: flush + clear mỗi 500
int i = 0;
for (Order o : orders) { repo.save(o); if (++i % 500 == 0) { repo.flush(); entityManager.clear(); } }
```

**Q4. Auto-configuration hoạt động ra sao, và debug bean thiếu?**
Các auto-configuration class phụ thuộc vào điều kiện trên classpath và các annotation như `@ConditionalOnMissingBean`. Nếu thiếu bean, nghĩa là một điều kiện đã không thỏa mãn. Debug lúc startup bằng `--debug` để xem positive/negative match, hoặc dùng `spring.autoconfigure.exclude`.

**Q5. `@ControllerAdvice` vs `Filter`?**
`@ExceptionHandler` trong `@ControllerAdvice` bắt exception từ controller bên trong `DispatcherServlet` và trả về body có cấu trúc, nhưng không bắt được lỗi xảy ra trước controller, chẳng hạn lỗi ở filter hoặc authentication. `Filter` chạy sớm hơn:

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
Dùng các profile file như `application-prod.yml`, được kích hoạt bởi `spring.profiles.active`. Environment variable có thể override property (`SPRING_DATASOURCE_URL` override `spring.datasource.url`). Không hardcode credential; hãy inject chúng từ environment hoặc secret store. `@ConfigurationProperties` bind vào object có kiểu và phù hợp hơn `@Value` cho cấu hình có cấu trúc.

**Q7. Khác nhau `@Transactional(readOnly=true)` và transaction thường?**
`readOnly=true` gợi ý persistence provider bỏ qua dirty checking và flush, có thể giúp read path nhanh hơn khoảng 10–20%, đồng thời cho phép một số database dùng read replica. Đây chỉ là một gợi ý, không phải ràng buộc bắt buộc: write vẫn có thể xảy ra, nhưng trường hợp đọc phổ biến sẽ được tối ưu. Dùng nó cho các method chỉ query.

**Q8. `LazyInitializationException` là gì và tại sao xảy ra?**
Lazy collection của entity (`@OneToMany(fetch=LAZY)`) bị truy cập sau khi session hoặc transaction đã đóng, dẫn đến exception. Lỗi này thường xảy ra khi trả entity cho controller. Khắc phục bằng cách fetch eagerly ở nơi cần thiết (`JOIN FETCH`), hoặc map sang DTO bên trong transaction.

**Q9. Khác nhau `@Query` và derived method name?**
`findByUsername(String)` được suy ra từ naming convention mà Spring phân tích. `@Query("select u from User u where u.username=:u")` dùng JPQL tường minh. Tên derived có thể gặp lỗi do typo, trong khi `@Query` rõ ràng và hỗ trợ join cùng logic phức tạp. Ưu tiên `@Query` cho mọi truy vấn không đơn giản.

**Q10. `spring.jpa.open-in-view` làm gì, và tại sao disable?**
Nó giữ JPA `EntityManager` mở trong suốt request để lazy load hoạt động trong view, nhưng cũng giữ DB connection trong toàn bộ request, kể cả sau khi business logic đã hoàn tất. Tắt (`false`) để giải phóng connection sớm hơn, rồi fetch mọi dữ liệu cần thiết bên trong transaction. Mặc định là `true`, một nguyên nhân phổ biến gây pool exhaustion trong production.

**Q11. Khác nhau `@MockBean` và `@Mock`?**
`@MockBean` đăng ký một mock như Spring bean, thay thế bean thật trong context; dùng nó với `@SpringBootTest`. `@Mock` của Mockito là mock độc lập dành cho unit test thông thường. Nhầm lẫn hai annotation này khiến mock không được wire vào context.

**Q12. Handle `@Scheduled` method overlap thế nào?**
`@Scheduled(fixedRate=5s)` bắt đầu mỗi 5 giây ngay cả khi lần chạy trước chưa xong, gây ra các lần thực thi chồng lấn. Dùng `fixedDelay=5s` để chờ lần chạy trước hoàn tất, hoặc kết hợp `@Scheduled` và `@Transactional` với leader lock như ShedLock để chỉ một node chạy trong cluster. Nếu không có lock, hai pod có thể thực thi công việc hai lần.

**Q13. Khác nhau `@RequestMapping` và specific verb?**
`@GetMapping`, `@PostMapping` và các annotation theo HTTP verb khác là shortcut cho `@RequestMapping(method=GET)`. Chúng rõ ràng hơn và giảm nguy cơ dùng sai method. Hãy dùng verb cụ thể.

**Q14. `BeanPostProcessor` là gì?**
Đây là hook chạy trên mọi bean sau khi khởi tạo và xung quanh quá trình initialization. AOP proxy, việc resolve `@Autowired` và `@PostConstruct` đều diễn ra ở đây. Đây là điểm Spring đan xen các hành vi cross-cutting. Tự viết một `BeanPostProcessor` là kỹ thuật nâng cao; nhận biết nó giúp giải thích phần lớn cơ chế "ma thuật" của Spring.

**Q15. Khác nhau `@Transactional` propagation REQUIRED vs REQUIRES_NEW?**
`REQUIRED` (mặc định) tham gia transaction hiện có hoặc tạo transaction mới. `REQUIRES_NEW` luôn tạm dừng transaction hiện tại và bắt đầu một transaction mới, nên commit/rollback bên trong là độc lập. Dùng `REQUIRES_NEW` cho audit log phải được lưu ngay cả khi transaction bên ngoài rollback, chẳng hạn log một giao dịch thanh toán thất bại.

**Q16. Khác nhau `@Cacheable` và manual caching?**
`@Cacheable` (với `@EnableCaching`) tự động cache giá trị trả về của method, dùng các argument làm key. Cạm bẫy là cache method có kết quả phụ thuộc vào state ngoài argument, dẫn đến dữ liệu cũ, hoặc cache `null`/mutable object. Invalidate bằng `@CacheEvict`. Lấy dữ liệu từ local cache thường mất khoảng microsecond, so với millisecond khi gọi database.

**Q17. Khác nhau `@Async` và thread pool?**
`@Async` chạy method trên một thread riêng do `TaskExecutor` cung cấp. Mặc định, `SimpleAsyncTaskExecutor` là unbounded nên nguy hiểm. Hãy cấu hình `ThreadPoolTaskExecutor` có giới hạn và đặt `@Async("myExecutor")`. Nếu không có bounded pool, `@Async` có thể tạo ra số lượng thread không giới hạn.

## Senior — thiết kế & phòng thủ

**Q1. `@Transactional` service chậm dưới tải — nghi long-lived transaction. Chẩn đoán và fix.**
"Tôi sẽ xác nhận transaction đang bao quá nhiều công việc: bật `spring.jpa.show-sql` và trace xem connection bị giữ ở đâu. Method thường thực hiện một external call chậm, như HTTP hoặc truy cập database khác, _bên trong_ transaction. Việc giữ connection trong vài giây sẽ làm cạn pool (`HikariPool` phải chờ, rồi `ConnectionTimeoutException` xảy ra sau mặc định 30 s). Tôi sẽ đưa external call _ra ngoài_ transaction, chỉ giữ các thao tác ghi database tối thiểu trong TX và đặt `@Transactional(timeout=3)`. Tôi đo pool wait time trước và sau khi sửa, với mục tiêu gần bằng zero."

**Q2. Thiết kế layered architecture sạch không leak persistence layer.**
"Controller → Service (`@Transactional`) → Repository. Service trả DTO, không trả JPA entity cho controller; nếu không, lazy collection có thể ném `LazyInitializationException` trong lúc serialize. Map entity sang DTO tại ranh giới service bằng MapStruct hoặc code thủ công. Repository nằm sau service và controller không truy cập trực tiếp vào repository. Nhờ vậy transaction boundary nằm trong service còn serialization nằm bên ngoài, loại bỏ bẫy `OpenEntityManagerInView`."

```java
// WRONG: trả entity -> lazy collection nổ trong JSON serialization
public UserEntity get(Long id) { return repo.findById(id).orElseThrow(); }
// RIGHT: map sang DTO tại boundary
public UserDto get(Long id) { return repo.findById(id).map(UserDto::from).orElseThrow(); }
```

**Q3. Cần hai bean cùng type — wiring thế nào cho rõ ràng?**
"Định danh chúng bằng `@Qualifier("primary")` trên cả bean và điểm injection, hoặc tạo các type riêng thông qua interface. Một pattern sạch hơn là inject `List<Handler>` và dispatch theo key thay vì chọn một bean cụ thể:"

```java
@Bean @Qualifier("stripe") public PaymentGateway stripe() { return new StripeGateway(); }
@Bean @Qualifier("paypal") public PaymentGateway paypal() { return new PaypalGateway(); }
@Autowired @Qualifier("stripe") PaymentGateway gateway;  // explicit
```

**Q4. Giải thích bean lifecycle và AOP đan xen ở đâu.**
"Instantiation → populate → aware callbacks → `BeanPostProcessor.before` → `@PostConstruct` → `InitializingBean.afterPropertiesSet` → `BeanPostProcessor.after` → ready. Việc tạo proxy và AOP weaving diễn ra trong các phase của `BeanPostProcessor`, là nơi Spring có thể bọc bean. Tôi dùng `@PostConstruct` cho initialization và tránh `InitializingBean` vì nó khiến code phụ thuộc vào Spring."

**Q5. Khi nào KHÔNG dùng Spring Boot?**
"Với một CLI nhỏ hoặc một path nhạy với latency, nơi footprint hàng trăm MB và thời gian startup tính bằng giây là quá lớn, tôi sẽ cân nhắc Micronaut hoặc Quarkus với build-time DI (startup dưới một giây, ít tốn memory), hoặc Java thuần. Spring Boot có lợi thế về ecosystem và tuyển dụng; với serverless nhạy cold-start hoặc workload rất nhỏ, compile-time DI framework có thể là lựa chọn phù hợp hơn. Tôi quyết định dựa trên startup budget và memory ceiling, không dựa trên thói quen."

**Q6. Phòng thủ config strategy ở 50 service.**
"Tôi sẽ dùng một `spring-cloud-config` lưu trên Git với override cho từng service. Connection string và secret lấy từ platform thông qua K8s ConfigMap/Secret, tuyệt đối không commit vào repository. Tôi dùng `@ConfigurationProperties` cho typed binding và fail-fast khi thiếu key bắt buộc (`@Validated`). Với 50 service, tính nhất quán trong naming và một single source of truth quan trọng hơn sự tiện lợi, nên tôi enforce bằng shared starter module thay vì copy-paste. Lợi ích đo được là việc rotate secret chỉ ảnh hưởng một nơi, không phải 50 repo."

**Q7. `@Transactional` trên public method gọi từ `@Transactional` khác — NESTED/REQUIRED thế nào?**
"Với `REQUIRED` mặc định, inner call tham gia outer transaction và dùng chung một connection, nên chúng commit hoặc rollback cùng nhau. `NESTED` (nếu database hỗ trợ savepoint, chẳng hạn PostgreSQL/JDBC) tạo savepoint để inner có thể rollback độc lập trong khi outer tiếp tục. `REQUIRES_NEW` tạm dừng hoàn toàn outer transaction. Tôi lựa chọn dựa trên việc partial failure có phải làm hủy toàn bộ operation hay chỉ một step."

**Q8. Test `@Transactional` service không có real DB thế nào?**
"Dùng `@DataJpaTest` (mặc định là H2 in-memory, khoảng 1 s) cho repository layer, và `@SpringBootTest` với `spring.test.context.cache` cùng Testcontainers Postgres để bảo đảm tương đồng khi integration test. Với service, mock repository bằng `@MockBean` và assert rằng transactional method delegate đúng. Tôi tránh khởi động full context cho unit test (khoảng 20–30 s mỗi test), vì đó là nguyên nhân khiến cả suite kéo dài hàng phút."

**Q9. Custom `@RestControllerAdvice` không catch exception. Tại sao?**
"Nó chỉ bắt exception được throw _bên trong_ request mapping của controller, tức là trong `DispatcherServlet`. Exception từ filter, Spring Security hoặc argument resolver xảy ra sớm hơn nên không bị bắt. Ngoài ra, nếu có nhiều `@ControllerAdvice` với các `@ExceptionHandler` chồng lấn, handler cụ thể nhất sẽ được ưu tiên. Với lỗi xảy ra trước controller, dùng `Filter` hoặc entry point của Spring Security."

**Q10. Size và monitor HikariCP connection pool thế nào?**
"Tôi sizing `maximumPoolSize` theo Little's Law, thường khoảng 10–30 với service thông thường chứ không phải 200. Đặt `connectionTimeout` là 30 s; đặt `idleTimeout` và `maxLifetime` thấp hơn `wait_timeout` của database (chẳng hạn `maxLifetime` 28 phút so với MySQL 30 phút) để tránh connection bị đóng giữa chừng. Tôi expose metric `HikariPoolMXBean` (active/idle/awaiting) và alert khi `awaiting > 0` kéo dài. Đây là dấu hiệu pool exhaustion trước khi biến thành một loạt timeout 30 s."

**Q11. `@Async` method nuốt exception silently. Catch thế nào?**
"`@Async` chạy trên thread khác nên exception không propagate tới caller; chúng chỉ được log rồi mất. Khắc phục bằng cách cung cấp `AsyncUncaughtExceptionHandler` thông qua `AsyncConfigurer`, hoặc trả về `CompletableFuture` và xử lý exception của nó. Tôi luôn trả `CompletableFuture` từ các `@Async` method để caller có thể quan sát failure."

**Q12. Ngăn `@Cacheable` phục vụ stale data xuyên deploy thế nào?**
"Cache entry chỉ tồn tại qua restart nếu được lưu trong distributed store như Redis; in-memory cache sẽ rỗng sau deploy rồi được repopulate, có thể gây ra một đợt stampede ngắn. Để bảo đảm tính đúng đắn khi deploy, dùng shared Redis cache với TTL ngắn hơn mức stale mà data cho phép, và dùng `@CacheEvict` khi ghi dữ liệu. Tôi đặt TTL sao cho worst case chỉ là phục vụ data cũ tối đa bằng một TTL, không bao giờ stale vô thời hạn."

**Q13. Scheduled job chạy hai lần trong prod (hai pod). Fix.**
"`@Scheduled` thông thường chạy trên mọi instance. Trong cluster cần có leader lock. Dùng ShedLock (`@SchedulerLock`) để lấy lock trên DB/Redis, bảo đảm chỉ một node execute. Hoặc chạy job trong một cron pod riêng duy nhất. Nếu không có lock, mọi pod đều chạy job, dẫn đến gửi email và tính phí hai lần. Tôi xem scheduling là một distributed concern, không phải concern của từng instance."

**Q14. Làm Spring Boot app start fast (sub-second) thế nào?**
"Lazy initialization (`spring.main.lazy-initialization=true`) trì hoãn việc tạo bean đến lần đầu sử dụng, giúp giảm startup nhưng làm tăng latency của request đầu tiên. Compile-time DI (Micronaut/Quarkus) nhanh hơn startup dựa trên reflection của Spring. Loại bỏ auto-config không dùng qua `spring.autoconfigure.exclude`. Với serverless, cân nhắc GraalVM native image (startup khoảng 10–50 ms, nhưng build mất vài phút và không phải mọi lib đều tương thích). Tôi đo startup rồi chọn phương án ít tốn kém nhất mà vẫn đáp ứng cold-start SLA."

**Q15. Khác nhau `@MockBean` trong `@SpringBootTest` và slice test?**
"`@SpringBootTest` đầy đủ khởi động toàn bộ context (khoảng 20–30 s). Slice test (`@WebMvcTest`, `@DataJpaTest`, `@JsonTest`) chỉ khởi động layer liên quan (khoảng 1–3 s). Dùng full-context test cho mọi thứ khiến suite kéo dài hàng phút. Tôi dùng slice cho 90% test và full-context chỉ cho các integration point thực sự. Một phép đo cho thấy 200 slice test chạy khoảng 30 s, so với khoảng 10 phút cho full-context suite tương đương."

**Q16. Debug `NoSuchBeanDefinitionException` thế nào?**
"Bean không nằm trong context. Nguyên nhân có thể là component không được scan (sai package hoặc thiếu `@Component`), conditional exclusion không thỏa mãn (`@Profile`/`@ConditionalOn...` là false), hoặc type là abstract/interface nhưng không có implementation. Chạy `--debug` để xem auto-config report, tìm tên bean và kiểm tra điều kiện nào thất bại (`Negative matches`). Chín trên mười lần, package nằm ngoài `@ComponentScan`."

**Q17. Thiết kế cho zero-downtime config change ở 50 service.**
"Dùng `spring-cloud-config` với các bean `@RefreshScope`; `/actuator/refresh` hoặc bus event sẽ reload chúng mà không cần restart. Tuy nhiên, `@RefreshScope` tạo lại bean. Connection trong `@RefreshScope` `@Bean` sẽ bị đóng rồi mở lại, vì vậy phải scope connection pool cẩn thận để không làm rớt request đang chạy. Tôi chỉ scope các bean chứa config, không scope pool, và test refresh dưới tải để xác nhận không xảy ra connection churn."

**Q18. Phòng thủ `@Transactional` boundary khi service gọi 3 service khác thế nào?**
"Thông thường KHÔNG nên bọc ba remote call trong một DB transaction, vì transaction giữ DB connection trong suốt thời gian của cả ba network call, có thể làm cạn pool. Các lựa chọn là: (1) thực hiện local DB write, commit, rồi gọi các service theo kiểu saga với compensation; hoặc (2) dùng outbox để publish event sau commit. Tôi giới hạn transaction ở DB-only work và xem cross-service call là một step riêng có thể compensation. Giữ TX xuyên network call là nguyên nhân số một gây pool exhaustion mà tôi thường gặp."

#### Self-check

- [ ] Junior: Tôi có thể giải thích IoC/DI (với constructor injection), các stereotype, singleton scope, `@SpringBootApplication` và `@RequestBody` so với `@PathVariable`, kèm code.
- [ ] Mid: Tôi có thể dùng code để chỉ ra vì sao `@Transactional` âm thầm thất bại (nuốt exception, self-invocation và method private), giải thích điều kiện auto-config, phân biệt `@ControllerAdvice` với `Filter` và giải thích OpenEntityManagerInView.
- [ ] Senior: Tôi có thể chẩn đoán pool exhaustion do long-lived transaction (timeout mặc định 30 s), thiết kế layered architecture với DTO mapping, wire rõ ràng hai bean, giải thích lifecycle và điểm AOP weaving, sizing/monitor HikariCP, cũng như bảo vệ transaction boundary khi gọi service khác.
