---
title: "Phỏng vấn Senior Java: Spring Boot"
description: "Spring Boot là nơi senior Java backend sống. IoC/DI, bean lifecycle, quản lý transaction, và auto-configuration magic mà phỏng vấn viên mong bạn nhìn thấu."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Đa số vị trí senior Java backend là Spring Boot. Phỏng vấn viên mong bạn hiểu framework, không chỉ dùng — và sự khác biệt nghe ra ngay ở câu trả lời đầu tiên. Junior đọc thuộc annotation. Senior kể lại chuỗi gọi: proxy chặn một method `@Transactional` như thế nào, vì sao self-invocation lọt qua nó, vì sao bean lifecycle có hai loại post-processor, và cái đêm connection pool cạn kiệt vì một transaction giữ connection trong khi gọi một partner API chậm rì.

> Tư duy: nêu được tên annotation thì bạn ở tầm mid-level. Đi qua nội tại proxy với một failure mode production và con số thật, bạn đã vượt bar. Mỗi phần dưới đây đều kết bằng bài tập phỏng vấn viên thực sự hay chạy.

## 1. IoC và DI — container là một hợp đồng, không phải cái ngăn kéo

Inversion of Control là _ai sở hữu `new`_. Dependency Injection là _wiring được chuyển tới bằng cách nào_. Cùng nhau chúng trả lời "ai tạo object này và khi nào" — container sở hữu đồ thị, bạn khai báo dependency, nó thỏa mãn. Chiều sâu nằm ở hai quyết định phát sinh: bạn nhận dependency theo cách nào, và bạn trao gì cho một bean sống lâu hơn scope của nó.

### Vì sao constructor injection là một hợp đồng

`@Autowired` field injection vẫn chạy. Nó cũng cho phép một `PaymentGateway` được dựng _dang dở_ — field đứng `null` cho tới khi container chạm vào. Unit test không dựng được object một cách trung thực, không gì có thể là `final`, và người đọc phải rà khắp class body mới biết bean thực sự cần gì. Constructor injection biến dependency thành một tham số:

```java
// WRONG: field injection — dependency chỉ là một lời đồn
@Service
public class OrderService {
    @Autowired
    private PaymentGateway gateway; // null bên ngoài container; chỉ Spring/reflection đặt được
}

// RIGHT: constructor injection — bean trung thực về những gì nó cần
@Service
public class OrderService {
    private final PaymentGateway gateway;

    public OrderService(PaymentGateway gateway) {
        this.gateway = gateway; // dựng đầy đủ, immutable, unit-test được bằng mock
    }
}
```

Câu hỏi follow-up phân loại ứng viên: "điều gì vỡ khi constructor injection gặp một circular dependency?" Constructor injection là all-or-nothing — constructor của A không hoàn tất được trước khi constructor của B hoàn tất, nên container không thể trao một reference nửa vời. Setter/field injection sống sót vì việc tạo singleton diễn ra qua ba pha (instantiate trần → populate → post-process), và container có thể trao một reference thô, đang còn định hình vào trong vòng lặp. Đó là lý do cách sửa một vòng constructor là một proxy, không phải đổi thứ tự:

```java
@Service
public class A {
    private final B b;
    public A(@Lazy B b) { this.b = b; } // inject một lazy proxy; B thật được resolve ở lần dùng đầu
}

// hoặc hoãn quyết định hoàn toàn:
@Service
public class A {
    private final ObjectProvider<B> b; // getIfAvailable(), getIfUnique(), getObject()
}
```

Senior cũng nêu được dấu hiệu: hai singleton cần nhau thường báo hiệu thiếu một thành phần thứ ba, không phải thiếu một annotation.

### Scopes — cái bẫy prototype

Một bean `prototype` được inject vào một `singleton` thì được resolve đúng một lần, tại thời điểm singleton được dựng, và instance đó bị giữ vĩnh viễn:

```java
// WRONG: prototype được fetch một lần và cache trong singleton — scope bị vi phạm
@Service
public class OrderService {
    private final DiscountCalculator calc; // cùng một instance cho mọi request, mãi mãi
}

// RIGHT: hỏi container một instance mới cho mỗi lần dùng
@Service
public class OrderService {
    private final ObjectProvider<DiscountCalculator> calcProvider;

    public OrderService(ObjectProvider<DiscountCalculator> calcProvider) {
        this.calcProvider = calcProvider;
    }

    public BigDecimal price(Order o) {
        return calcProvider.getObject().apply(o); // prototype mới mỗi lần gọi
    }
}
```

Các web scope thêm một lớp gián tiếp. Một singleton không thể giữ trực tiếp một bean `request`-scoped, nên Spring inject một **scoped proxy** (`@Scope(value = "request", proxyMode = ScopedProxyMode.TARGET_CLASS)`): một người đóng thế resolve vào request context hiện tại ở mỗi lần gọi. Cái giá: thêm một hop mỗi lần truy cập, và proxy giấu bạn instance mình thực sự đang nói chuyện cùng. "Vì sao không dùng scoped proxy khắp nơi?" — vì bạn đã đổi một dependency nhìn thấy được lấy một object ma thuật.

### JDK proxy vs CGLIB — vì sao một annotation có thể âm thầm không làm gì

Spring Boot 2+ proxy bằng subclass (CGLIB) kể cả cho interface. Nghĩa là một method `final` — hoặc một class bean `final` — không thể bị override, và bất kỳ `@Transactional`/`@Async` nào trên nó **âm thầm chẳng làm gì**. Tương tự với method `private`: gọi một method private là một lời gọi trực tiếp lên target, proxy không bao giờ thấy. "Nếu một lời gọi không rời khỏi object thì annotation chỉ là một comment." Khi một method có annotation nhưng rõ ràng chạy không có hành vi đó, ba nghi phạm đầu tiên là `private`, `final`, và self-invocation (phần 4).

## 2. Bean lifecycle — kể nó trơn tru như hơi thở

Mỗi singleton được dựng theo một thứ tự cố định lúc context startup. "Đi qua bean lifecycle cho tôi nghe" muốn chuỗi trình tự, không phải danh sách annotation:

1. **Instantiate** — constructor chạy.
2. **Populate** — field và setter dependency được inject.
3. **`Aware` callbacks** — `BeanNameAware`, `BeanClassLoaderAware`, `BeanFactoryAware`, `ApplicationContextAware`.
4. **`BeanPostProcessor.postProcessBeforeInitialization`** — nơi listener tự gắn mình vào.
5. **`@PostConstruct`** — dependency đã tồn tại; setup cần chúng thì để ở đây.
6. **`InitializingBean.afterPropertiesSet()`**.
7. **Custom `init-method`** (`initMethod` trên `@Bean`).
8. **`BeanPostProcessor.postProcessAfterInitialization`** — _đây là nơi AOP auto-proxying bọc bean vào trong proxy của nó._
9. Lúc context đóng: **`@PreDestroy`** → `DisposableBean.destroy()` → custom `destroy-method`.

Hai hệ quả phỏng vấn viên hay khoan. Thứ nhất, thứ tự giữa ba init callback: `@PostConstruct` → `afterPropertiesSet` → `init-method` (và `@PostConstruct` do `CommonAnnotationBeanPostProcessor` chạy _trước_ init). Thứ hai — thứ thắng cả phòng — bước 8: **một lời gọi tới method `@Transactional` từ bên trong `@PostConstruct` chạy ngoài mọi transaction**, vì proxy chưa tồn tại. Annotation chỉ được thực thi bởi một proxy được tạo _sau_ khi initialization.

### `BeanPostProcessor` vs `BeanFactoryPostProcessor`

Cái thứ nhất nhìn các **instance** trong lúc chúng được tạo; cái thứ hai nhìn các **definition** trước khi bất kỳ bean nào được instantiate. Đó là lý do `PropertySourcesPlaceholderConfigurer` là một `BeanFactoryPostProcessor` — placeholder `${...}` phải được viết lại trong các definition trước khi object tồn tại. Và cũng là lý do binding `@ConfigurationProperties` là việc của một `BeanPostProcessor` (`ConfigurationPropertiesBindingPostProcessor`): object đích phải là một bean trước, rồi mới được bind.

Failure mode đưa junior về đọc docs: `@Value("${app.name}")` trả về đúng chuỗi `${app.name}`. Nguyên nhân gốc: property source được đăng ký sau lúc placeholder resolution. Senior nói "nếu `${...}` vẫn là literal, nghĩa là các definition đã được resolve trước khi source tồn tại," và sửa thứ tự, không sửa chuỗi.

### Fail-fast là một tính năng

Singleton được pre-instantiate **eagerly** lúc `refresh()`. Một `@PostConstruct` hỏng sẽ abort startup — app từ chối boot. Đó là một tính năng: một bean cấu hình sai sẽ fail lúc deploy, không phải lúc 3 giờ sáng khi request đầu tiên chạm tới. `@Lazy` đẩy cái fail đó tới lần dùng đầu tiên; đôi khi đó là quyết định đúng (một cold start chậm bạn chấp nhận được), nhưng hãy nêu tên tradeoff bạn đang mua. Nếu một incident "đã sửa" liên quan tới một bean "chạy ở dev nhưng không ở prod", câu hỏi đầu tiên là liệu nó có bị lazy-initialize và đơn giản là chưa bao giờ được thực thi.

### Full vs lite `@Bean` mode

`@Bean` method bên trong một class `@Configuration` bị proxy (**full mode**), nên một lời gọi nội bộ `b()` trả về singleton của container. Chuyển cùng các `@Bean` method vào một `@Component` (**lite mode**) và mỗi lời gọi nội bộ dựng một instance hoàn toàn mới — âm thầm. Cùng một annotation, ngữ nghĩa khác nhau tùy vào class bao quanh. "Tôi chuyển config vào một `@Component` và giờ có 40 DataSources" là một incident có thật.

## 3. Auto-configuration — đầu bếp đọc tủ lạnh

`@SpringBootApplication` là ba annotation mặc một cái áo trench: `@SpringBootConfiguration`, `@EnableAutoConfiguration`, và `@ComponentScan`. Component scan chỉ nhìn thấy cây con của base package bạn — chính xác là vì sao `@Service` của bạn được tìm thấy nhưng một JPA provider hay một H2 driver thì không bao giờ. Cái hố đó là thứ starter lấp đầy: chúng ship cả dependency _lẫn_ một class biết cách cấu hình nó.

### Cỗ máy

Boot đọc `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (Boot 2.7+; `spring.factories` trước đó) và nạp mỗi class trong đó như một `@Configuration` ứng viên. Rồi mỗi ứng viên phải vượt một loạt câu hỏi `@Conditional*` trước khi được giữ lại:

- `@ConditionalOnClass` — type có trên classpath không? (Auto-config DataSource chỉ kích hoạt khi có driver.)
- `@ConditionalOnMissingBean` — developer đã tự định nghĩa bean chưa? (Hợp đồng override.)
- `@ConditionalOnProperty` — công tắc có bật không?
- `@ConditionalOnWebApplication` / `@ConditionalOnBean` — loại context, và các bean đã có mặt.

Thứ tự được điều khiển bằng `@AutoConfigureBefore` / `@AutoConfigureAfter` / `@Order`. Kết quả: một app Boot 3 startup đánh giá **cỡ một nghìn lần kiểm tra condition**, đa số là negative. Đó là lý do thêm một dependency trông vô hại có thể thay đổi hành vi toàn cục — các condition được đánh giá trên toàn bộ classpath.

### Bean override thực sự hoạt động thế nào

Hợp đồng là `@ConditionalOnMissingBean`: `DataSourceAutoConfiguration` của Boot nhường lại _trừ khi_ bạn đã tự định nghĩa một `DataSource`. Override của bạn không phải "config thêm" — nó là cái condition tự tắt chính nó:

```java
@Configuration
public class DbConfig {
    @Bean
    public DataSource dataSource() {
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl("jdbc:postgresql://" + url);
        ds.setUsername(user);
        ds.setMaximumPoolSize(20);
        return ds;
    }
}
```

Nếu bean của bạn không thắng, nước đi đầu tiên là **conditions report**, không phải đoán mò. Bật `debug=true` (hoặc gõ actuator `conditions` endpoint) và đọc mục _Negative matches_ — nó in chính xác condition nào fail và vì sao. Phát hiện kinh điển: "`@ConditionalOnMissingBean` của bạn được thỏa mãn bởi một bean mà chính component scan của bạn đăng ký." Senior đọc _Positive matches_ trước để xem thứ gì đang thực sự chạy, rồi mới tìm bean của mình trong danh sách.

### Bẫy quét hai lần

Các auto-config class bản thân là các class `@Configuration`. Đặt một cái vào trong base package component-scan của bạn và `@ComponentScan` nhặt nó như một config thường _bên cạnh_ lần auto-config — logic `@Conditional` của nó chạy hai lần trên các context state khác nhau và lặng lẽ cư xử sai. Boot né chuyện này bằng cách sống trong `org.springframework.boot.autoconfigure.*`, ngoài mọi scan root của app. Custom starter của bạn cũng phải làm vậy: các class trong `AutoConfiguration.imports` không bao giờ được component scan của app chạm tới. Nếu một condition "lật" giữa report và thực tế, nghi đăng ký hai lần trước tiên.

### Property binding

`@ConfigurationProperties` tách config của bạn khỏi các chuỗi `@Value`: relaxed kebab-case binding (`my-app.timeout-ms` → `timeoutMs`), field có type, và `@Validated` ngay lúc bind. Chi tiết senior: binding diễn ra qua một `BeanPostProcessor`, nên class **bắt buộc phải được đăng ký như một bean** (`@ConfigurationPropertiesScan` hoặc `@EnableConfigurationProperties`) — nếu không binding lặng lẽ không xảy ra và bạn nhận defaults thay vì giá trị của mình. "Tôi set `my-app.timeout-ms` mà bean phớt lờ" là câu hỏi về bean-registration, không phải về YAML.

## 4. Transaction management — proxy và các failure mode của nó

Giống `@Cacheable` và `@Async`, `@Transactional` là một chuyện của proxy. Proxy ủy quyền cho `TransactionInterceptor`, cái này lái một `PlatformTransactionManager` (`DataSourceTransactionManager` cho JDBC/MyBatis thuần, `JpaTransactionManager` cho JPA): lấy một connection, `setAutoCommit(false)`, chạy method, commit hoặc rollback, khôi phục. Mọi thứ sau đây là hệ quả của một câu đó.

### Self-invocation — kinh điển

`this.method()` là một lời gọi trực tiếp lên target thô. Proxy chỉ chặn các lời gọi đến từ _bên ngoài_:

```java
// WRONG: audit() có @Transactional, nhưng this.audit() không bao giờ băng qua proxy
@Service
public class OrderService {
    public void ship(Order order) {
        deductStock(order);
        this.audit(order); // lời gọi method thuần — KHÔNG transaction, KHÔNG đảm bảo rollback
    }

    @Transactional
    public void audit(Order order) { /* chạy không có transaction context */ }
}
```

Các cách sửa, theo thứ tự ưu tiên của senior:

```java
// 1) self-injection: Boot inject được proxy của chính bean đó
@Service
public class OrderService {
    private final OrderService self;

    public OrderService(OrderService self) {
        this.self = self;
    }

    public void ship(Order order) {
        deductStock(order);
        self.audit(order); // giờ đi qua proxy — có transaction
    }
}

// 2) phơi proxy ra tường minh
@EnableAspectJAutoProxy(exposeProxy = true)
// ((OrderService) AopContext.currentProxy()).audit(order);

// 3) câu trả lời về kiến trúc: gọi method transactional của chính mình thường
//    nghĩa là logic đó thuộc về một collaborator riêng — hãy tách nó ra
```

Vì sao cách sửa là một proxy chứ không phải một cờ: annotation là metadata trên bean _definition_; việc thực thi nằm trong proxy. Method `private` và `final` fail theo cùng cách (phần 1) — lời gọi không bao giờ ra khỏi target.

### Propagation — và `REQUIRES_NEW` kẻ giết pool

- `REQUIRED` (default) — join transaction đang tồn tại hoặc tạo một cái mới.
- `REQUIRES_NEW` — suspend cái ngoài, bắt đầu một transaction mới trên một **connection mới**. Lock của transaction ngoài vẫn bị giữ trong khi transaction trong commit.
- `NESTED` — ngữ nghĩa savepoint: rollback về savepoint, không phải toàn bộ transaction ngoài. **JDBC only** — JPA ném "nested transactions are not supported" lúc runtime. Nói "chúng tôi dùng `NESTED`" trong phỏng vấn tức là tự khai rằng bạn đang ở stack JPA.
- `MANDATORY`, `NOT_SUPPORTED`, `NEVER`, `SUPPORTS` — kỷ luật của "bắt buộc có / bắt buộc không có" transaction.

Failure mode có răng: `REQUIRES_NEW` trong một vòng lặp vớ một connection mới cho mỗi lần gọi:

```java
// WRONG: mỗi item tự bắt đầu một transaction trên connection riêng
@Transactional
public void importAll(List<Item> items) {
    for (Item item : items) {
        importOne(item); // REQUIRES_NEW → connection mới mỗi item
    }
}
// 1.000 item, Hikari pool 10 → pool cạn ở khoảng item thứ 10 và transaction ngoài
// chờ một connection nó không thể có → timeout dưới tải

// RIGHT: batch bên trong transaction ngoài — một transaction, một connection
@Transactional
public void importAll(List<Item> items) {
    for (Item item : items) {
        save(item); // join transaction ngoài
    }
}
// Nếu mỗi item thực sự cần đơn vị commit riêng: bỏ @Transactional ngoài,
// dùng một TaskExecutor có giới hạn, và định cỡ pool theo concurrency bạn cho phép.
```

Định luật Little áp dụng cho transaction cũng như request: `connections ≈ số đơn vị công việc đồng thời`, không phải `count(items)`.

### Isolation và rollback default

`@Transactional(isolation = Isolation.REPEATABLE_READ)` gọi `connection.setTransactionIsolation(...)` lúc checkout; default `Isolation.DEFAULT` nghĩa là _default của database_ — InnoDB REPEATABLE READ, Postgres READ COMMITTED. Tradeoff giống ở bài phỏng vấn database: mỗi mức trên READ COMMITTED mua lại ít anomaly hơn với nhiều lock dài hơn. Đây là một nút chỉnh latency, không phải ô checkbox an toàn.

Rollback default: **chỉ `RuntimeException` và `Error` rollback.** Checked exception — những cái bạn khai bằng `throws` — được coi là kết cục kinh doanh đã định và commit:

```java
// WRONG: InsufficientFundsException là checked → cái "failure" COMMIT luôn cả transfer
@Transactional
public void transfer(long from, long to, BigDecimal amt) throws InsufficientFundsException {
    debit(from, amt);
    credit(to, amt);
    if (overdrawn(from)) throw new InsufficientFundsException();
}

// RIGHT: khai báo rằng checked exception này phải abort
@Transactional(rollbackFor = InsufficientFundsException.class)
public void transfer(long from, long to, BigDecimal amt) throws InsufficientFundsException {
    ...
}
```

Bẫy gương là `noRollbackFor` trên một `RuntimeException` mà bạn thực ra đã xử lý. Nói quy tắc quyết định thành tiếng: _rollback theo mặc định, rồi liệt kê các exception nghĩa là "đây là một failure thật"_ — không phải "không rollback gì và hy vọng."

Thêm hai chi tiết ghi điểm:

- `readOnly = true` **không phải một đảm bảo cấp database**. Với JPA nó chuyển flush sang manual (không có dirty-checking flush lúc commit — một cú tăng tốc thật trên các đường đọc-heavy); với JDBC manager nó là một hint read-only trên `Connection`. Nó không ngăn một `INSERT` lọt qua. Nếu cần enforcement, đó là việc của DB (roles/grants), không phải của annotation.
- `timeout = 5` là advisory ở lớp JDBC: nó trở thành driver statement timeout ở nơi được hỗ trợ, và một statement chạy lâu có thể sống lâu hơn nó. Phía DB vẫn cần `lock_wait_timeout` / `statement_timeout` riêng. "Annotation timeout rồi mà query vẫn chạy 30 giây" là một câu production có thật.

### Transaction không băng qua ranh giới thread

`@Transactional` gắn vào thread hiện tại qua `TransactionSynchronizationManager` (một ThreadLocal). Chia việc cho nhiều thread thì mỗi nhánh lấy connection riêng và transaction riêng (hoặc không có):

```java
// WRONG: async work chạy ngoài transaction mà caller của method này mong đợi
@Async
@Transactional
public void process(Order order) { ... } // async proxy bọc ngoài tx proxy: tx bắt đầu trên một worker thread

// WRONG: cái send bắn đi ngay cả khi transaction rollback
@Transactional
public void createOrder(Order order) {
    orderRepository.save(order);
    kafkaTemplate.send("orders", order); // event ma nếu bất cứ thứ gì bên dưới ném ra
}

// RIGHT: chỉ publish sau khi commit thành công
@Transactional
public void createOrder(Order order) {
    orderRepository.save(order);
    applicationEventPublisher.publishEvent(new OrderCreated(order));
}

@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onOrderCreated(OrderCreated ev) {
    kafkaTemplate.send("orders", ev.order());
}
```

Câu hỏi follow-up tách senior: _nếu broker chết sau khi commit thì sao?_ Listener trong memory không durable — nó chạy, send fail, và event biến mất. Đó chính là luận cứ cho **outbox pattern**: ghi event vào một bảng `outbox` _trong cùng transaction_ với sự thay đổi state, và để một relay publish các row đã commit kèm retry. "Send Kafka bên trong method `@Transactional`" sai hình thái ở mọi scale; câu hỏi thật là một after-commit listener có đủ hay bạn cần bảng outbox cho durability.

### Distributed transaction — mặc định theo outbox, không theo XA

Phỏng vấn viên thích câu mồi: "một DB write và một Kafka publish phải atomic — dùng XA?" Câu trả lời senior đi qua chi phí của two-phase commit trước khi nói không: pha prepare gần như nhân đôi thời gian giữ lock, một coordinator crash để lại transaction ở trạng thái doubt (heuristic decision), và mọi driver lẫn broker đều phải implement XA. Các công cụ thực tế:

- **Best-effort 1PC** — commit DB, publish; khi fail thì compensate.
- **Outbox pattern** — atomic ở đúng nơi duy nhất bạn có thể atomic (DB), rồi một relay idempotent.
- **Kafka transactions** — atomic trọn chu kỳ consume–process–produce _bên trong một broker_; không phải đũa thần xuyên hệ thống.

Nêu tên tradeoff: 2PC thật mua atomicity xuyên tài nguyên với cái giá availability và độ phức tạp; outbox cho durable ordering với eventual delivery và một cơ chế retry có thể kiểm tra được.

## 5. Web layer và pool sizing — nơi throughput thực sự chết

Pipeline request của Spring Boot là một thread cho mỗi in-flight request, và mặc định **Tomcat có 200 thread** (`server.tomcat.threads.max`). Thread làm việc _đồng bộ_ — nó block trên DB, trên partner call, trên mọi thứ. Một sự thật đó quyết định trần của bạn:

```
Định luật Little:  throughput  =  threads  ÷  thời gian request trung bình

200 threads / 0.05 s  →  trần 4.000 req/s  (request 50 ms)
200 threads / 0.5 s   →  trần   400 req/s  (request 500 ms)
200 threads / 2.0 s   →  trần   100 req/s  (request 2 s)
```

Nâng số thread thì bạn mua context-switch thrash khi vượt vài lần số core — máy có 32 core, không phải 32.000. Đòn bẩy thực sự dịch chuyển trần là _request latency_, đó là lý do câu trả lời senior cho "làm sao chịu được traffic gấp 10×" là: cắt thời gian request trung bình, đẩy việc chậm ra khỏi request thread, và ngừng để một dependency chậm bắt cả pool làm con tin. (Và nếu một full GC đóng băng cả 200 thread cùng lúc, bài concurrency và JVM đã lo phần phép toán pause — ở đây điểm chính là các request thread chính là nơi nó đáp xuống.)

### Blocking client không có timeout

`RestTemplate` tạo theo cách ngây thơ **không có connect hay read timeout theo mặc định**. Một peer chết giữ một Tomcat thread hàng phút, và với đủ traffic cả 200 thread đỗ xe trong `SocketRead`:

```java
// WRONG: không timeout, được gọi từ một request thread
RestTemplate rt = new RestTemplate(); // connectTimeout = 0, readTimeout = 0 → treo vĩnh viễn

// RIGHT: giới hạn từng chặng
var factory = new HttpComponentsClientHttpRequestFactory();
factory.setConnectTimeout(1_000);           // ms — thời gian thiết lập connection
factory.setConnectionRequestTimeout(1_000); // thời gian chờ một pooled connection
factory.setReadTimeout(2_000);              // thời gian chờ response body
new RestTemplate(factory);
```

Biến thể senior lớn hơn: nếu lời gọi chậm, _đừng ngồi trên một request thread chút nào_ — trả `202 Accepted`, giao việc cho một executor có giới hạn, hoặc dùng `WebClient` với timeout `HttpClient` tường minh. Nhưng câu trả lời non-blocking có failure mode riêng của nó, bên dưới.

### Virtual threads (Java 21, Boot 3.2+)

Bật `spring.threads.virtual.enabled=true` và mỗi request có một virtual thread: blocking I/O không còn đóng đinh một platform thread, và `server.tomcat.threads.max` không còn là trần. Nhưng phần phỏng vấn nằm ở các tradeoff:

- **Pinning.** Khối `synchronized` và native call đóng đinh một carrier thread — một method `synchronized` nóng mà trước đây giấu sau số thread giờ chặn throughput.
- **Giả định `ThreadLocal` vỡ.** Thread pool tái sử dụng thread, nên các thư viện nhét state vào `ThreadLocal` trông cậy vào sự tái sử dụng đó. Virtual thread được tạo theo từng task — ThreadLocal state bị cache là _mất_, và các thao tác sổ sách ORM/connection từng giả định tái sử dụng sẽ đổi hành vi.
- **Pool vẫn là nút thắt.** Virtual thread rẻ; **database connection thì không.** Với Hikari pool mặc định 10 và 500 request đồng thời, 490 virtual thread ngồi block trên `getConnection()` — DB trông như chết, pool chính là hàng đợi. "Virtual thread sửa thread pool của tôi nhưng Hikari pool thành trần mới" là một câu production có thật.

### Hold time, không phải query time

Một request thread giữ connection của nó suốt _cả transaction_, kể cả business logic giữa các query — và OSIV (phần 6) làm tệ hơn. Pool phải đủ cho toàn bộ thời gian giữ, không phải mỗi query:

```java
// WRONG: connection được checkout, rồi bị bắt làm con tin bởi partner latency
@Transactional
public OrderResponse create(Order order) {
    orderRepository.save(order);               // connection checkout ở đây
    OrderResponse r = partnerApi.place(order); // 800 ms latency partner, connection bị giữ
    return r;                                  // commit sau lời gọi → áp lực pool
}

// RIGHT: làm I/O chậm TRƯỚC khi mở transaction, hoặc SAU khi nó commit
OrderResponse r = partnerApi.place(order);
orderService.create(order, r.id);
```

Một đội 40 pods, mỗi pod 200 thread và pool 20 connection, giữ connection ngang một partner call 800 ms, sẽ xếp hàng tại pool từ rất lâu trước khi partner thành vấn đề. Bài database đã lo phép toán sizing (`connections ≈ throughput × hold time`); phần Spring là _nơi hold xảy ra_ — và câu trả lời là: không bao giờ để nó xảy ra bên trong một transaction ngang qua external I/O.

## 6. Failure mode production — checklist biến thành war story

Phỏng vấn viên hỏi về incident vì các giai thoại chính là tín hiệu. Chuẩn bị sẵn một câu chuyện cho mỗi mục, và kèm cách sửa:

- **OSIV mặc định true.** `spring.jpa.open-in-view` mặc định **true**, và Boot log cảnh báo ở mỗi lần khởi động. `EntityManager` và connection JDBC của nó ở mở **trọn HTTP request** — lazy load chạy ở bất kỳ đâu (che giấu N+1) _và_ pool của bạn bị giữ suốt request. Tắt nó đi thì thứ đầu tiên bạn gặp là `LazyInitializationException` trong serializer — đó là lúc framework cuối cùng chỉ ra N+1. (Hành trình đầy đủ trong bài database.)
- **`@Cacheable` stampede và staleness.** `sync=true` dẹp thundering herd (một thread load, số còn lại chờ). TTL là một nút chỉnh staleness, không phải công cụ đúng đắn — và invalidation đa node cần một cơ chế tường minh (Redis + delete/evict), không phải hy vọng. "Chúng tôi cache 5 phút mà write không bao giờ hiện ra" là một câu hỏi thiết kế TTL.
- **`@Scheduled` chồng nhau.** Scheduler mặc định chỉ có **một thread**. Một run dài hơn interval chỉ làm trễ tick kế tiếp — và với hai pods, cả hai đều chạy job. Sửa pool size (`spring.task.scheduling.pool.size`) và, cho đa node, thêm ShedLock hoặc một DB advisory lock để đúng một instance sở hữu run đó.
- **`@Async` không giới hạn.** `queue-capacity` của executor mặc định là `Integer.MAX_VALUE`. Một burst enqueue mãi mãi → latency leo → rồi OOM. Thay nó bằng một `TaskExecutor` tường minh, queue có giới hạn, và một rejection policy:

```java
@Bean("opsExecutor")
public TaskExecutor opsExecutor() {
    ThreadPoolTaskExecutor e = new ThreadPoolTaskExecutor();
    e.setCorePoolSize(8);
    e.setMaxPoolSize(24);
    e.setQueueCapacity(200);              // có giới hạn — fail fast thay vì tăng không kiểm soát
    e.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    return e;
}
```

- **Graceful shutdown.** `server.shutdown=graceful` cộng `spring.lifecycle.timeout-per-shutdown-phase` (mặc định 30 s) cho phép một SIGTERM của K8s drain các in-flight request trước khi pod chết. Incident: "chúng tôi deploy, và 2% request fail với connection reset" — vì pod bị giết giữa chừng request. Nếu bạn từng thấy nó, nêu ngay hai cài đặt đó.
- **`@SpringBootTest` cho mọi thứ.** Một test boot cả context để test một `@Service` mất vài giây và flaky trên các infra bean. Slice test (`@WebMvcTest`, `@DataJpaTest`) boot một lát mỏng. "Vì sao test của bạn mất 8 phút?" là một câu hỏi thiết kế test đội lốt performance.
- **Hai `@Bean` cùng type.** `NoUniqueBeanDefinitionException` — hoặc cái sai âm thầm thắng. `@Primary` là override, `@Qualifier` là selector, và conditions report cho thấy bean nào thực sự được đăng ký. "Ở máy tôi chạy vì classpath máy tôi thiếu bean thứ hai" là câu trung thực.
- **Actuator phơi quá rộng.** `management.endpoints.web.exposure.include=health,info` — không phải `env`, `shutdown`, hay `heapdump` trên một đường public. Endpoint "chỉ để debug" trong prod chính là endpoint làm rò rỉ config và secret.

## 7. Tự kiểm tra

- [ ] Giải thích vì sao constructor injection là một hợp đồng, và cơ chế ba pha chính xác khiến setter injection sống sót qua circular dependency còn constructor injection thì không.
- [ ] Kể bean lifecycle singleton theo đúng thứ tự — và nêu pha AOP proxying xảy ra (và vì sao một lời gọi `@Transactional` bên trong `@PostConstruct` chạy không có transaction).
- [ ] Full vs lite `@Bean` mode: điều gì đổi khi các `@Bean` method chuyển từ `@Configuration` sang `@Component`.
- [ ] Đi qua auto-configuration: `AutoConfiguration.imports` nằm ở đâu, `@ConditionalOnMissingBean` cho bean của bạn nhường lại starter như thế nào, và đọc báo cáo Negative matches ở đâu.
- [ ] Vì sao `this.audit()` né được `@Transactional`, và ba cách sửa theo thứ tự ưu tiên của senior.
- [ ] Vòng lặp `REQUIRES_NEW` làm cạn pool — và hình dạng đúng cho đơn vị commit theo item.
- [ ] Vì sao Kafka send bên trong transaction là một event ma, và tradeoff after-commit listener vs outbox.
- [ ] Định cỡ trần request-thread bằng định luật Little, và nêu hai thứ virtual threads không thay đổi.
- [ ] Liệt kê các failure mode của `@Async`, `@Scheduled`, `@Cacheable`, OSIV, và graceful shutdown — kèm cách sửa cho từng cái.

## 8. Interviewer follow-ups

Khi câu trả lời đầu tiên của bạn chạm đúng, họ bắt đầu khoan. Sẵn sàng cho những câu này:

- "Vì sao constructor injection fail trên circular dependency — và `@Lazy` thực sự inject cái gì?"
- "Đi qua bean lifecycle — và trong nó thì AOP proxy lần đầu tiên chặn một lời gọi ở đâu?"
- "Method `@Transactional` của bạn gọi chính nó và chẳng gì rollback. Đi qua đường gọi cho tôi nghe."
- "Khi nào `REQUIRES_NEW` trở thành một incident production?"
- "Kafka message được gửi nhưng DB rollback. Chuyện gì đã xảy ra, và các cách sửa là gì?"
- "Ở đây bạn có dùng XA không? Nếu không, vì sao, và outbox là gì?"
- "Boot 3.2, Java 21, bạn bật virtual threads. Thứ gì vỡ tiếp theo?"
- "Một request báo cáo giữ connection 45 giây và pool là 20. Bạn đổi cái gì đầu tiên?"
- "`@Async` executor của bạn OOM dưới tải. Queue capacity mặc định là bao nhiêu, và bạn set nó bằng bao nhiêu?"
- "Làm sao biết auto-configuration nào thực sự đã chạy trên một máy bạn không attach được?"
- "Vì sao OSIV giữ connection làm con tin, và lỗi đầu tiên bạn sẽ gặp sau khi tắt nó?"

Đó là bar Spring Boot.
