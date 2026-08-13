---
title: "Ôn thi Java #6: Microservices — Junior đến Senior"
description: "Microservices ở mức senior chủ yếu là biết khi NÀO KHÔNG dùng chúng — resilience pattern, service communication, và distributed transaction."
pubDatetime: 2026-08-10T10:10:00+07:00
featured: false
draft: false
tags:
  - java
  - interview
  - microservices
  - resilience
---

Microservices là chủ đề nơi senior judgment quan trọng nhất, vì câu trả lời sai là "chia monolith ra đi". Junior vẽ các ô service; senior giải thích tại sao monolith đúng suốt nhiều năm và điều gì cụ thể ép phải chia. Bài này đi từ service boundary đến cái bẫy distributed-transaction.

> Mindset: junior liệt kê lợi ích microservices; senior gọi được ba cái giá cụ thể chúng tạo ra và trigger chính xác biện minh việc trả giá đó.

## Junior — nền tảng

**Q1. Microservice là gì và khác monolith thế nào?**
Microservice là một service nhỏ, deploy độc lập, sở hữu một business capability, với datastore riêng. Monolith là một unit deploy duy nhất. Microservices mua được independent scaling, isolated failure, và team autonomy; chúng trả bằng network call, distributed data, và operational complexity.

**Q2. Khác nhau giữa synchronous và asynchronous communication?**
Synchronous (HTTP/RPC): caller block chờ response — coupling chặt, outage của callee block bạn. Asynchronous (message/event bus): caller publish và tiếp tục — loose coupling, resilience tốt hơn, nhưng eventual consistency và debug khó hơn. Chọn sync cho request/response cần answer ngay; async cho fire-and-forget hoặc decoupling.

**Q3. API gateway là gì và nó làm gì?**
Một entry point duy nhất cho client xử lý routing, auth, rate limiting, và thường aggregation. Nó che topology internal service nên client không cần biết address mọi service. Không có nó, client couple với nhiều service và bạn không enforce cross-cutting policy ở một chỗ.

**Q4. Service discovery là gì?**
Thay vì hardcode service address (thay đổi khi pod scale/move), service register với registry (Consul, Eureka, K8s DNS) và look up nhau. Enable dynamic scaling và resilience với restart. Hardcode hostname gãy ngay khi pod reschedule.

**Q5. Circuit breaker là gì và tại sao cần?**
Khi downstream slow/fail, retry ngây thơ chất đống và cạn thread — một dependency chết cascade gục whole service. Circuit breaker trip sau N failure, fail fast trong cooldown window thay vì chờ timeout, rồi half-open để test recovery. Nó chứa blast radius.

**Q6. Khác nhau giữa API và event?**
API call là request trực tiếp cho action/response (imperative: "làm cái này"). Event là fact đã xảy ("order placed"), broadcast cho ai quan tâm (declarative). API couple caller→callee; event decouple producer khỏi consumer. Nhầm lẫn hai cái dẫn đến synchronous graph chatty, giòn nơi event sẽ sạch hơn.

## Mid — tradeoff & điểm mù

**Q1. Database-per-service rule là gì và tại sao shared DB là anti-pattern?**
Mỗi service nên sở hữu data của nó; shared database couple service ở storage layer — schema change ở một service phá service khác, và transaction span service. Anti-pattern (shared DB) thầm biến "microservices" thành distributed monolith. Nếu hai service phải share table, đó là tín hiệu chúng là một bounded context.

**Q2. Xử lý distributed transaction qua hai service thế nào?**
Thường bạn **không** dùng 2PC (two-phase commit) — nó là distributed lock không scale và fail tệ dưới partial failure. Thay vào đó dùng **Saga** pattern: chuỗi local transaction, mỗi cái có compensating action để undo khi fail (vd "reserve → nếu ship fail, release"). Saga trade atomicity lấy availability; bạn chấp nhận eventual consistency và build compensation logic.

**Q3. Eventual consistency là gì và gì gãy cho user?**
Sau một write, không phải mọi reader thấy ngay — replica/derived data converge theo thời gian. Gãy: user update profile và refresh thấy bản cũ (rối), hoặc đọc own write từ replica chưa kịp. Mitigation: read-your-writes (đọc từ primary ngay sau write), hoặc serve giá trị vừa viết từ client.

**Q4. Khác nhau giữa idempotency và exactly-once, và tại sao quan trọng cho retry?**
Retry có thể deliver message hai lần. **Idempotency** nghĩa process hai lần có cùng effect một lần (vd dedupe key, hoặc `UPDATE ... WHERE version = x`). **Exactly-once** (thực sự, end-to-end) gần như impossible xuyên service. Nên bạn build idempotent handler và chấp nhận at-least-once delivery — robust hơn nhiều so với đuổi exactly-once.

**Q5. Bulkhead isolation là gì?**
Bulkhead pattern giới hạn bao nhiêu resource một dependency có thể tiêu thụ (separate thread pool / connection pool per downstream). Nếu service B hang, nó chỉ fill bulkhead riêng, không phải pool shared với C và D — chứa failure. Không có nó, một slow dependency cạn shared pool và mọi thứ chết cùng nhau.

**Q6. Debug một request span 8 service thế nào?**
Distributed tracing (OpenTelemetry/W3C trace context) propagate trace ID xuyên service call, nên bạn thấy full waterfall và time được tiêu ở đâu. Không tracing bạn mù — log per service không nói path. Ghép với centralized structured logging keyed by trace ID. Senior đòi tracing _trước_ khi system lớn, không phải sau.

## Senior — thiết kế & phòng thủ

**Q1. Một team muốn chia monolith 3 năm tuổi thành 20 microservice. Bạn nói sao?**
"Tôi push back mạnh. Microservices là quyết định org và ops, không phải silver bullet kỹ thuật. Vấn đề của monolith có khi là thiếu module boundary hoặc deploy bottleneck — sửa那些 trước (modular monolith). Tôi chỉ chia dọc theo một bounded context _đã chứng minh_ có scaling hoặc team-ownership khác biệt, và làm incremental (strangler fig), không phải big-bang 20-service rewrite nhân failure mode qua một đêm. Cái giá của 20 service (network, distributed data, on-call) chỉ đáng nếu independence là thật."

**Q2. Thiết kế payment flow qua Order, Inventory, Payment service không dùng 2PC.**
"Saga. Order start: `reserve inventory` (local txn + compensate `release`), rồi `charge payment` (local txn + compensate `refund`). Nếu payment fail, saga orchestrator trigger `release inventory`. Mỗi bước là local transaction với compensating action; saga log cho phép resume sau crash. Tôi dùng orchestration saga (coordinator) hơn choreography (event) ở đây, vì flow có thứ tự rõ và failure handling — choreography khó reason ở 3+ bước. Trade: không global lock, nhưng tôi phải xử lý partial failure và eventual consistency tường minh."

**Q3. Một downstream HTTP call flaky (5% timeout). Thiết kế resilience layer.**
"Ba lớp: (1) **timeout** ngắn hơn SLA để fail fast, không hang; (2) **circuit breaker** ngừng bắn dependency đang chết và fail fast trong outage; (3) **retry with backoff + jitter** cho transient blip, nhưng chỉ idempotent call. Cộng **bulkhead** để dependency này không ăn whole thread pool. Và fallback (cached/stale value, hoặc queue để sau) để user nhận response degraded-but-working. Tôi đo downstream timeout rate và breaker open ratio để tune threshold từ thực tế."

**Q4. Khi nào monolith thực sự là lựa chọn tốt hơn, và giữ nó sạch thế nào?**
"Cho small team, young product, hoặc domain không có independent scaling need — modular monolith nhanh build, debug, deploy hơn, không có distributed failure mode. Giữ sạch bằng explicit module boundary (package không import internal của nhau), một deploy, và một database với clear schema ownership. Chỉ migrate sang service khi boundary's scaling/team need diverge. Premature splitting là microservice mistake phổ biến nhất tôi thấy."

**Q5. Chọn sync vs async giữa hai service cụ thể, với ví dụ.**
"Order → Inventory cho 'reserve stock': nếu user đang chờ confirmation, sync (cần answer ngay, và timeout là failure rõ để show). Order → Notification/Analytics: async event ('order placed'), vì không ai block nó và muốn resilience nếu service đó down. Rule of thumb: sync cho happy-path request user blocked; async cho side-effect và fan-out. Nhầm (sync tới 5 service nối nhau) tạo latency chain fail ở link chậm nhất."

**Q6. Phòng thủ service boundary — làm sao biết split đúng?**
"Boundary đúng là bounded context: một lý do để đổi, một team sở hữu, deploy và scale một mình được, và data private. Tôi test split bằng câu hỏi: 'Nếu đổi schema service A, B có cần redeploy?' Nếu có, chúng là một context giả làm hai. Bằng chứng là operational: independent deploy frequency và failure isolation. Nếu A và B luôn deploy cùng và share DB, tôi đã build distributed monolith và nên merge. Boundary được validate bởi deploy/scale/failure independence, không phải vẽ ô."

#### Self-check

- [ ] Junior: Tôi giải thích được microservice vs monolith, sync vs async, API gateway, service discovery, circuit breaker, và API vs event.
- [ ] Mid: Tôi giải thích được database-per-service, Saga pattern, eventual consistency, idempotency vs exactly-once, bulkhead, và distributed tracing.
- [ ] Senior: Tôi argument được chống premature splitting với modular-monolith alternative, thiết kế payment saga không 2PC, build resilient HTTP layer (timeout+breaker+retry+bulkhead), và phòng thủ service boundary bằng deploy/scale/failure independence.
