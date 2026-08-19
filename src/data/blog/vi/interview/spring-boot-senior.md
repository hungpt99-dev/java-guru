---
title: "Ôn phỏng vấn Java #3: Nền tảng và lỗi thường gặp trong Spring Boot"
description: "Hướng dẫn phỏng vấn Spring Boot tập trung vào IoC và DI, scope của bean, cấu hình, annotation cho web và các lỗi proxy của transaction thường gây ra lỗi trong production."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Spring Boot không khó vì có nhiều annotation. Điểm khó là hành vi của framework thường diễn ra gián tiếp: container tạo và nối các object, proxy có thể intercept một lời gọi, còn cấu hình quyết định bean nào tồn tại. Vì vậy, câu trả lời tốt trong phỏng vấn không chỉ là “dùng `@Autowired`”, mà phải giải thích được Spring làm gì, boundary nằm ở đâu và giả định nào có thể sai.

Bài này đi từ nền tảng đến các tradeoff và failure mode quan trọng trong service thực tế. Hành vi của framework được đánh dấu **[SOURCE FACT]**. Diễn giải kỹ thuật được đánh dấu **[ANALYSIS]**. Lựa chọn triển khai cụ thể được đánh dấu **[PROPOSED DESIGN]**.

## Junior: nền tảng

**Q1. IoC và DI trong Spring là gì?**

**[SOURCE FACT]** Inversion of Control nghĩa là framework chịu trách nhiệm tạo object và wiring dependency. Dependency Injection cung cấp dependency cho object thông qua constructor, setter hoặc field.

**[ANALYSIS]** Constructor injection thường là lựa chọn mặc định phù hợp nhất. Các dependency bắt buộc được thể hiện rõ, field có thể là `final`, unit test không cần Spring container, và dependency bị thiếu sẽ được phát hiện khi khởi tạo thay vì đến một thời điểm muộn hơn.

```java
// Tránh: dependency bắt buộc bị che giấu, test thường phải dùng reflection hoặc Spring
@Autowired private UserRepository repo;

@Service
public class UserService {
  private final UserRepository repo;

  public UserService(UserRepository repo) {
    this.repo = repo;
  }
}
```

**Q2. `@Component`, `@Service`, `@Repository` và `@Controller` khác nhau thế nào?**

**[SOURCE FACT]** Đây là các component stereotype có thể được phát hiện bằng component scanning. `@Repository` còn tham gia cơ chế chuyển đổi persistence exception. `@Service` và `@Controller` chủ yếu diễn đạt vai trò của class.

**[ANALYSIS]** Dùng stereotype phù hợp với boundary của class. Về mặt kỹ thuật một class có thể mang nhiều stereotype, nhưng cách đó thường làm thiết kế khó đọc hơn.

**Q3. Scope mặc định của bean là gì?**

**[SOURCE FACT]** Scope mặc định là **singleton**: một instance dùng chung trong mỗi Spring container. Bean `prototype` được tạo instance mới khi container resolve nó, nhưng inject trực tiếp prototype vào singleton không tạo instance mới cho mỗi lần gọi method.

**[PROPOSED DESIGN]** Dùng `ObjectProvider` khi singleton cần một prototype instance mới cho mỗi lần sử dụng:

```java
@Service
public class OrderService {
  private final ObjectProvider<PriceCalculator> calculators;

  public OrderService(ObjectProvider<PriceCalculator> calculators) {
    this.calculators = calculators;
  }

  public PriceCalculator current() {
    return calculators.getObject();
  }
}
```

**Q4. `@SpringBootApplication` làm gì?**

**[SOURCE FACT]** Annotation này kết hợp `@Configuration`, `@EnableAutoConfiguration` và `@ComponentScan`. Auto-configuration dùng classpath và cấu hình của ứng dụng để đăng ký các bean phù hợp; component scanning tìm trong package của application class và các subpackage.

**[ANALYSIS]** Đặt application class ở root package chứa các component cần scan. Nếu không, component có thể hoàn toàn đúng nhưng không bao giờ trở thành bean.

**Q5. Khi nào dùng `@RequestParam`, `@PathVariable` và `@RequestBody`?**

**[SOURCE FACT]** Dùng `@RequestParam` cho query parameter như `?q=5`, `@PathVariable` cho một đoạn URI như `/users/5`, và `@RequestBody` cho request body, thường là JSON.

**[ANALYSIS]** Các annotation này mô tả những phần khác nhau của HTTP request. Gắn nhầm annotation là nguyên nhân thường gặp của lỗi phía client như response 400 hoặc 405, dù response cụ thể còn phụ thuộc mapping và request.

**Q6. `@Bean` và `@Component` khác nhau thế nào?**

**[SOURCE FACT]** `@Component` đặt trên class và được phát hiện qua component scanning. `@Bean` đặt trên method, thường trong class `@Configuration`, và đăng ký giá trị trả về của method thành một bean.

**[PROPOSED DESIGN]** Dùng `@Bean` khi cấu hình một type từ library hoặc object mà bạn không sở hữu source:

```java
@Configuration
public class AppConfig {
  @Bean
  public RestTemplate restTemplate() {
    return new RestTemplateBuilder()
        .setConnectTimeout(Duration.ofSeconds(3))
        .build();
  }
}
```

**Q7. Có bắt buộc đặt `@Autowired` trên constructor không?**

**[SOURCE FACT]** Từ Spring 4.3, class chỉ có một constructor sẽ được autowire ngầm. Nếu có nhiều constructor, cần đánh dấu constructor mà Spring phải sử dụng.

**[ANALYSIS]** Nên dùng dạng single-constructor ngầm định. Cách này thể hiện dependency contract mà không thêm annotation chỉ để lặp lại hành vi mặc định của Spring.

**Q8. `@Value` và `@ConfigurationProperties` khác nhau thế nào?**

**[SOURCE FACT]** `@Value("${db.url}")` inject một property. `@ConfigurationProperties("db")` bind một nhóm như `db.url` và `db.pool-size` vào object có type. Configuration properties hỗ trợ relaxed binding và có thể được validation bằng `@Validated`.

**[ANALYSIS]** Dùng `@Value` cho một giá trị riêng lẻ và `@ConfigurationProperties` cho các setting liên quan. Object cấu hình có type giúp phát hiện lỗi tên và validation dễ hơn các expression dạng chuỗi rải rác.

**Q9. `@PostConstruct` làm gì và chạy khi nào?**

**[SOURCE FACT]** Annotation này đánh dấu method chạy một lần sau khi dependency injection hoàn tất và trước khi bean sẵn sàng cho việc sử dụng bình thường. Dùng `@PreDestroy` cho cleanup.

**[ANALYSIS]** Giữ phần khởi tạo trong đó nhỏ và deterministic. Công việc nặng sẽ kéo dài thời gian startup; nếu initialization không cần chặn readiness, dùng lifecycle rõ ràng hoặc cơ chế background.

**Q10. `@Controller` và `@RestController` khác nhau thế nào?**

**[SOURCE FACT]** `@Controller` thường trả về tên view để server render template. `@RestController` kết hợp `@Controller` và `@ResponseBody`, nên giá trị trả về được ghi vào response body và serialize, chẳng hạn thành JSON.

**[PROPOSED DESIGN]** Dùng `@RestController` cho HTTP API và `@Controller` khi endpoint chọn một server-rendered view.

**Q11. Inject tất cả bean cùng một type thế nào?**

**[SOURCE FACT]** Khai báo dependency dạng collection, chẳng hạn `List<Handler> handlers`; Spring sẽ cung cấp các bean phù hợp. Dùng `@Order` hoặc `Ordered` khi thứ tự có ý nghĩa.

**[ANALYSIS]** Đây là một strategy-dispatch pattern trực tiếp. Hãy khai báo rõ contract về thứ tự thay vì phụ thuộc vào thứ tự đăng ký bean.

**Q12. Dùng `application.properties` hay `application.yml`?**

**[SOURCE FACT]** Cả hai đều dùng để cấu hình ứng dụng. YAML biểu diễn cấu hình lồng nhau tự nhiên hơn; properties dùng các entry phẳng dạng `key=value`. Spring Boot hỗ trợ cả hai định dạng.

**[ANALYSIS]** Chọn định dạng dễ review nhất trong project. Indentation có ý nghĩa trong YAML, vì vậy lỗi thụt lề có thể tạo ra cấu hình hợp lệ về cú pháp nhưng khác với ý định.

**Q13. Stereotype annotation và meta-annotation là gì?**

**[SOURCE FACT]** `@Service` bản thân được meta-annotate bằng `@Component`. Meta-annotation là annotation được dùng để kết hợp hoặc mô tả một annotation khác.

**[PROPOSED DESIGN]** Project có thể định nghĩa composed annotation, chẳng hạn annotation chứa `@Service` và `@Transactional`, nếu đây là convention ổn định và có tên rõ nghĩa. Không nên tạo annotation như vậy chỉ để che giấu behavior.

**Q14. `spring.profiles.active` làm gì?**

**[SOURCE FACT]** Nó chọn các profile đang active. Spring sau đó xem xét cấu hình theo profile như `application-{profile}.yml` và các bean được bảo vệ bởi `@Profile("prod")` khi profile đó active. Khi không có profile nào active, Spring dùng default profile.

**[ANALYSIS]** Profile phù hợp cho cấu hình và lựa chọn bean theo môi trường. Không nên biến chúng thành một hệ thống feature flag thứ hai thiếu kiểm soát.

**Q15. `@Import` và `@ComponentScan` khác nhau thế nào?**

**[SOURCE FACT]** `@ComponentScan` tìm các class có annotation trong những package được cấu hình. `@Import` đăng ký rõ ràng các configuration class hoặc component được chỉ định.

**[PROPOSED DESIGN]** Dùng `@Import` khi module có một tập configuration entry point nhỏ và có chủ đích. Dùng scanning khi discovery theo package là boundary mong muốn.

## Mid-level: tradeoff và failure mode

**Q1. Vì sao `@Transactional` đôi khi không rollback?**

**[SOURCE FACT]** Ba nguyên nhân thường gặp là nuốt exception, bypass proxy qua self-invocation và đặt annotation trên method mà proxy không thể intercept.

```java
// Exception bị nuốt nên transaction interceptor không nhìn thấy nó.
@Transactional
public void transfer() {
  try {
    debit();
    credit();
  } catch (Exception e) {
    log.error("Transfer failed", e);
  }
}

// Lời gọi trực tiếp trên object này không đi qua Spring proxy.
public void outer() {
  this.inner();
}

@Transactional
public void inner() { }

// Private method không thể được intercept như một transactional entry point.
@Transactional
private void reconcile() { }
```

**[ANALYSIS]** Nếu cần rollback, hãy để exception propagate hoặc cấu hình rollback rule một cách có chủ đích bằng `rollbackFor`. Nếu lời gọi cần đi qua proxy, chuyển operation có transaction sang Spring bean khác. Giữ transactional entry point ở dạng proxy có thể intercept; đồng thời phải xét proxy mechanism và rule của phiên bản Spring đang dùng.

**Q2. `@Transactional` thực sự hoạt động thế nào?**

**[SOURCE FACT]** Spring thường bọc bean bằng proxy. Lời gọi đi vào qua proxy có thể chạy transaction advice trước target method, rồi hoàn tất hoặc rollback transaction sau đó. Transaction manager sử dụng resource đã cấu hình, chẳng hạn database connection, và bind transaction state vào execution context hiện tại.

**[ANALYSIS]** Annotation không tự biến mọi luồng Java thành transaction. Nó có hiệu lực tại proxy boundary. Vì vậy self-invocation, lời gọi xảy ra trước khi proxy được tạo và method proxy không thể intercept đều cần được xem xét riêng.

**[PROPOSED DESIGN]** Đặt transaction boundary trên service method đại diện cho một business operation. Giữ remote call và công việc chậm, không liên quan ở ngoài boundary đó, trừ khi yêu cầu consistency biện minh cho việc giữ transaction mở lâu hơn.
