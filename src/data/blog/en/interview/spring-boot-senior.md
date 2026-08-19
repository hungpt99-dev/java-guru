---
title: "Java Interview Prep #3: Spring Boot Fundamentals and Pitfalls"
description: "A practical Spring Boot interview guide covering IoC and DI, bean scopes, configuration, web annotations, and the transaction proxy pitfalls that cause production bugs."
pubDatetime: 2026-08-10T10:30:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - spring-boot
  - backend
---

Spring Boot is not difficult because of its annotations. It is difficult because framework behavior is often indirect: the container creates and wires objects, proxies may intercept a call, and configuration determines which beans exist. The useful interview answer is therefore not just “use `@Autowired`”; it is knowing what Spring does, where the boundary is, and which assumptions can fail.

This guide covers the fundamentals first, then the tradeoffs and failure modes that matter in real services. Framework behavior is marked **[SOURCE FACT]**. Engineering interpretation is marked **[ANALYSIS]**. A concrete implementation choice is marked **[PROPOSED DESIGN]**.

## Junior: foundations

**Q1. What are IoC and DI in Spring?**

**[SOURCE FACT]** Inversion of Control means the framework owns object creation and wiring. Dependency Injection supplies an object’s dependencies through a constructor, setter, or field.

**[ANALYSIS]** Constructor injection is usually the best default. Required dependencies are explicit, fields can be `final`, unit tests do not need a Spring container, and a missing dependency fails during construction rather than later.

```java
// Avoid: required dependency is hidden and needs reflection or Spring in many tests
@Autowired private UserRepository repo;

@Service
public class UserService {
  private final UserRepository repo;

  public UserService(UserRepository repo) {
    this.repo = repo;
  }
}
```

**Q2. How do `@Component`, `@Service`, `@Repository`, and `@Controller` differ?**

**[SOURCE FACT]** They are component stereotypes that can be discovered by component scanning. `@Repository` also participates in persistence-exception translation. `@Service` and `@Controller` primarily communicate the role of the class.

**[ANALYSIS]** Use the stereotype that matches the class’s boundary. A class can technically carry multiple stereotypes, but that usually makes the design harder to read.

**Q3. What is the default bean scope?**

**[SOURCE FACT]** The default scope is **singleton**: one shared instance per Spring container. A `prototype` bean requests a new instance when the container resolves it, but injecting it directly into a singleton does not create a new instance for every method call.

**[PROPOSED DESIGN]** Use `ObjectProvider` when a singleton needs a fresh prototype instance per request:

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

**Q4. What does `@SpringBootApplication` do?**

**[SOURCE FACT]** It combines `@Configuration`, `@EnableAutoConfiguration`, and `@ComponentScan`. Auto-configuration uses the application’s classpath and configuration to register applicable beans; component scanning looks in the package of the application class and its subpackages.

**[ANALYSIS]** Put the application class in a root package that contains the components you expect to scan. Otherwise, a correct component may simply never become a bean.

**Q5. When do you use `@RequestParam`, `@PathVariable`, and `@RequestBody`?**

**[SOURCE FACT]** Use `@RequestParam` for a query parameter such as `?q=5`, `@PathVariable` for a URI segment such as `/users/5`, and `@RequestBody` for the request body, commonly JSON.

**[ANALYSIS]** These annotations describe different parts of an HTTP request. Mapping the wrong part is a common cause of client errors such as 400 or 405 responses, though the exact response depends on the mapping and request.

**Q6. What is the difference between `@Bean` and `@Component`?**

**[SOURCE FACT]** `@Component` is placed on a class and discovered by component scanning. `@Bean` is placed on a method, usually in a `@Configuration` class, and registers that method’s return value as a bean.

**[PROPOSED DESIGN]** Use `@Bean` when configuring a library type or another object whose class you do not own:

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

**Q7. Is `@Autowired` required on a constructor?**

**[SOURCE FACT]** Since Spring 4.3, a class with a single constructor can have that constructor autowired implicitly. With multiple constructors, mark the constructor Spring should use.

**[ANALYSIS]** Prefer the implicit single-constructor form. It states the dependency contract without adding an annotation whose only purpose would be to repeat Spring’s default behavior.

**Q8. How do `@Value` and `@ConfigurationProperties` differ?**

**[SOURCE FACT]** `@Value("${db.url}")` injects one property. `@ConfigurationProperties("db")` binds a group such as `db.url` and `db.pool-size` to a typed object. Configuration properties support relaxed binding and can be validated with `@Validated`.

**[ANALYSIS]** Use `@Value` for an isolated value and `@ConfigurationProperties` for related settings. A typed configuration object makes naming and validation errors easier to find than scattered string expressions.

**Q9. What does `@PostConstruct` do, and when does it run?**

**[SOURCE FACT]** It marks a method that runs once after dependency injection has completed and before the bean is ready for normal use. `@PreDestroy` is used for cleanup.

**[ANALYSIS]** Keep startup initialization there small and deterministic. Heavy work delays application startup; use an explicit lifecycle or background mechanism when initialization does not need to block readiness.

**Q10. What is the difference between `@Controller` and `@RestController`?**

**[SOURCE FACT]** `@Controller` commonly returns a view name for server-rendered templates. `@RestController` combines `@Controller` and `@ResponseBody`, so return values are written to the response body and serialized, for example as JSON.

**[PROPOSED DESIGN]** Use `@RestController` for an HTTP API and `@Controller` when the endpoint selects a server-rendered view.

**Q11. How do you inject all beans of a type?**

**[SOURCE FACT]** Declare a collection dependency, for example `List<Handler> handlers`; Spring supplies the matching beans. Use `@Order` or `Ordered` when their order matters.

**[ANALYSIS]** This is a straightforward strategy-dispatch pattern. Make the ordering contract explicit rather than relying on registration order.

**Q12. `application.properties` or `application.yml`?**

**[SOURCE FACT]** Both configure the application. YAML represents nested configuration naturally; properties files use flat `key=value` entries. Spring Boot supports both formats.

**[ANALYSIS]** Choose the format that makes the configuration easiest to review. YAML indentation is significant, so an indentation error can produce configuration that is structurally valid but not what you intended.

**Q13. What is a stereotype annotation, and what is a meta-annotation?**

**[SOURCE FACT]** `@Service` is itself meta-annotated with `@Component`. A meta-annotation is an annotation used to compose or describe another annotation.

**[PROPOSED DESIGN]** A project can define a composed annotation, such as one carrying `@Service` and `@Transactional`, when that combination is a stable, well-named application convention. Do not create one merely to hide behavior.

**Q14. What does `spring.profiles.active` do?**

**[SOURCE FACT]** It selects active profiles. Spring then considers profile-specific configuration such as `application-{profile}.yml` and beans guarded by `@Profile("prod")` when that profile is active. The default profile is used when no profile is active.

**[ANALYSIS]** Profiles are useful for environment-specific configuration and bean selection. They should not become a second, uncontrolled feature-flag system.

**Q15. What is the difference between `@Import` and `@ComponentScan`?**

**[SOURCE FACT]** `@ComponentScan` discovers annotated classes in configured packages. `@Import` registers explicitly named configuration classes or components.

**[PROPOSED DESIGN]** Prefer `@Import` when a module has a small, deliberate set of configuration entry points. Prefer scanning when package discovery is the intended boundary.

## Mid-level: tradeoffs and failure modes

**Q1. Why does `@Transactional` sometimes not roll back?**

**[SOURCE FACT]** Three common causes are swallowing the exception, bypassing the proxy through self-invocation, and placing the annotation on a method the proxy cannot intercept.

```java
// The exception is swallowed, so the transaction interceptor does not see it.
@Transactional
public void transfer() {
  try {
    debit();
    credit();
  } catch (Exception e) {
    log.error("Transfer failed", e);
  }
}

// A direct call on this object does not pass through the Spring proxy.
public void outer() {
  this.inner();
}

@Transactional
public void inner() { }

// Private methods cannot be intercepted as transactional entry points.
@Transactional
private void reconcile() { }
```

**[ANALYSIS]** Let the exception propagate when rollback is required, or configure rollback rules deliberately with `rollbackFor`. Move the transactional operation to another Spring bean when a call must cross the proxy. Keep transactional entry points interceptable; also account for the proxying rules of the Spring version and proxy mechanism in use.

**Q2. How does `@Transactional` work?**

**[SOURCE FACT]** Spring typically wraps the bean in a proxy. A call that enters through that proxy can run transaction advice before the target method and complete or roll back the transaction afterward. The transaction manager uses the configured resource, such as a database connection, and binds transaction state to the current execution context.

**[ANALYSIS]** The annotation is not a property of arbitrary Java control flow. It is effective at a proxy boundary. That is why self-invocation, calls made before proxy creation, and methods that the proxy cannot intercept require particular attention.

**[PROPOSED DESIGN]** Put the transaction boundary on a service method that represents one business operation. Keep remote calls and slow, unrelated work outside that boundary unless the consistency requirement justifies holding the transaction open.
