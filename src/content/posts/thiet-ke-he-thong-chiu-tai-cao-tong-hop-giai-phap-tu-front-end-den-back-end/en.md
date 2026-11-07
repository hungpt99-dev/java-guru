---
title: "Designing High-Load Systems: A Roundup of Solutions from Front-end to Back-end"
description: "Modern software systems – from e-commerce, fintech, SaaS and social networks to streaming – all have to deal with sudden spikes in traffic."
slug: "thiet-ke-he-thong-chiu-tai-cao-tong-hop-giai-phap-tu-front-end-den-back-end"
locale: "en"
translationKey: "thiet-ke-he-thong-chiu-tai-cao-tong-hop-giai-phap-tu-front-end-den-back-end"
pubDate: 2025-09-21T11:32:14+07:00
category: "System Design"
tags: ["System Design", "microservices"]
featured: true
draft: false
series: null
coverImage: "./cover.png"
readingTime: 8
---

## 1. Context and challenges

Modern software systems – from e-commerce, fintech, SaaS and social networks to streaming – all have to deal with **sudden spikes in traffic**. This could be a flash sale, a shopping holiday, the end of the month when financial reports need to be run, or an unexpected event that brings millions of users online at the same time.

Without careful preparation, the system easily falls into a state of **slow responses, CPU/memory overload, or even going down**. That leads to lost revenue, damaged brand reputation and a poor user experience. For this reason, designing a system that is **resilient under high load (high-load, high-traffic resilient)** is one of the most important requirements for a system architect.

To achieve this, you need to combine many layers of solutions – from **frontend, caching, query optimisation, backend patterns, request management and data architecture through to monitoring and autoscaling**. There is no single "silver bullet"; it has to be a combination of many techniques, each one solving part of the problem.

---

## 2. Optimising the frontend to reduce backend load

An important principle that is often overlooked: **reduce load right at the frontend**. If the interface is designed intelligently, the system can avoid a whole series of unnecessary requests to the backend.

### 2.1 Performance-oriented UX/UI

* **Prioritise showing the important information:** Users usually only care about a few main parts. For example, in eCommerce, the product page should show the name, price and images first; less important information such as detailed reviews or sales history can go in another tab.
* **Lazy loading & skeleton UI:** Show the interface first, and fetch data only when needed. This not only increases the perception of speed but also reduces simultaneous requests.
* **Pagination & infinite scroll:** Do not load all the data at once. For example, the product list only needs the first 20 items, and more is fetched as the user scrolls.
* **Hide secondary data:** Statistics that are rarely needed can go in an accordion or modal, fetched only when the user opens them.

**Example:** An admin dashboard displays 1,000 orders per day. Instead of loading everything, the frontend only calls an API that returns the first 20 orders. As the user scrolls or filters, it makes further calls. Thanks to this, the backend does not have to process unnecessarily heavy queries.

### 2.2 Frontend cache

* **LocalStorage/SessionStorage:** Store data that rarely changes, for example: product categories, dashboard configuration information.
* **Service Worker / PWA cache:** Allows fast reloads without hitting the server, and even supports offline.
* **Cache API response:** For data that rarely changes (for example banners, menus, user profile information), the frontend can keep a cached copy for reuse.

**Benefits:** The backend is significantly offloaded, the system responds faster and users get a smoother experience.

---

## 3. Caching and pre-computation

One of the reasons a system becomes overloaded is **heavy computation in real time**. Reports, statistics or aggregate calculations should be processed **before** the user requests them.

### 3.1 Precompute

* Perform **precomputation** for important data instead of processing it directly when the user queries.
* Store the results in an intermediate table or a materialized view in the database.
* Schedule or trigger periodic or event-driven refreshes of the data.

### 3.2 Pre-warming cache

Before entering peak hours, the system can **preload hot data** into the cache. For example: before a flash sale, preload information about hot products. That avoids the situation where millions of requests query the DB at the same time, leading to a simultaneous cache miss.

### 3.3 Cache multi-layer

* **Edge cache (CDN):** Distribute static content (images, video, CSS, JS).
* **Application cache (Redis):** Cache dynamic data, sessions, tokens.
* **Database cache:** Query result cache.

Combining multiple cache layers helps the system withstand peak traffic better.

### 3.4 Cache Promise

* **Principle:** When a request is in progress, the promise stores the pending result. If a similar request arrives, the system **waits for the promise's result instead of sending a new request**.
* **Benefits:** Avoids many duplicate requests at the same time, reducing load on the backend and the DB.
* **Example:** Many users request the details of a hot product at the same time → the promise cache holds the one in-flight request, the other requests "wait" for the result, and the DB is not hit many times.

---

## 4. Query and data processing optimisation

A common mistake is **querying far more data than necessary** and performing heavy tasks directly in real time. Combined with techniques such as **batch processing, Bloom Filter, Request Coalescing**, the system can be significantly offloaded.

### 4.1 Query only the data you need

* Select only the necessary fields, avoid `SELECT *`.
* Use pagination (`LIMIT`, `OFFSET` or `cursor-based pagination`).
* Avoid joins across many complex tables; if needed, handle it offline via a batch job.
* Use appropriate indexes.

**Example:**

* Statistics on top-selling products: you only need `product_id`, `category_id`, `sold_quantity`.
* Transaction reports: query only `user_id`, `amount`, `status`, no need for long text fields.

**Benefits:** Less IO, smaller memory footprint, higher throughput, no OOM.

### 4.2 Batch Processing

* Group many small tasks into a batch to process them together.
* Reduce the overhead of calling the API or DB many times.
* Combine with a queue to regulate the rate.

**Example:** Updating the status of 1,000 orders → group it into a single batch update instead of updating each order.

### 4.3 Bloom Filter

* A probabilistic data structure used to check whether an element exists.
* Returns "definitely not present" or "possibly present".
* No false negatives, only false positives.

**Applications:**

* Check a coupon code before querying the DB.
* Prevent cache penetration (requests for keys that do not exist).
* Filter bot requests.

**Example:** A user enters a coupon. Bloom filter check → if it does not exist, reject immediately without hitting the DB.

### 4.4 Request Coalescing

* When many identical requests reach the backend in a short time, **merge them into a single request**.
* The backend returns the result, and the remaining requests use that result.
* Fewer DB queries, lower peak load.

**Example:** 500 users query the top 10 best-selling products at the same time → request coalescing merges them into a single query, then returns the result to all users.

---

## 5. Backend architecture

Architectural patterns and techniques play an important role in making the system scalable and able to withstand load.

### 5.1 CQRS + Search Engine

* **CQRS (Command Query Responsibility Segregation):** Separate the read and write models.

  * The write model is optimised for transactions.
  * The read model is optimised for queries.
* Use a search engine (ElasticSearch, OpenSearch) to serve complex queries, instead of querying the DB directly.
* Materialized view / pre-computed table to return results quickly.

**Example:** In eCommerce, searching products by price, category or keyword → use ElasticSearch. Updating stock goes through the transactional DB.

### 5.2 Bulkhead

* Separate components into their own "compartments".
* If one compartment is overloaded, the others keep working.
* Commonly applied in microservices or queues.

**Example:** A separate payment queue, a separate email sending queue. If the email service is overloaded, payments still run normally.

---

## 6. Request management and flow control

During peak traffic, the backend is not the only thing that matters; you also need **request control** to stop the system from collapsing.

### 6.1 Backpressure

* A mechanism that signals back from the consumer to the producer when it cannot keep up.
* Prevents the producer from sending too fast, filling the queue and causing OOM.
* Commonly used in streaming (Kafka, gRPC streaming, reactive systems).

### 6.2 Admission Control

* Control requests from the outset, rejecting unimportant requests early.
* Apply quotas and priority.
* Example: checkout requests take priority over statistics requests.

### 6.3 Load Shedding

* When the system is overloaded, proactively drop less important requests.
* Example: reduce the refresh frequency of the real-time dashboard to keep checkout running stably.

### 6.4 Async Processing

* Move tasks that do not need to be real-time to the background.
* Example: sending an order confirmation email → push it to a queue, without blocking the payment request.

### 6.5 Circuit Breaker

* Temporarily cut the connection to a failing service.
* Prevent a single downstream service from hanging the entire system.

---

## 7. Data management

Large data volumes are also a cause of bottlenecks. Some commonly used techniques:

### 7.1 Hot vs Cold Data Separation

* Separate frequently accessed data (hot) from rarely accessed data (cold).
* Hot data is stored in a fast DB (Redis, in-memory, SSD).
* Cold data is stored in a slower DB (HDD, archive storage).

### 7.2 Sharding / Partitioning

* Split data into multiple shards/partitions for parallel processing.
* Example: user\_id % 4 → store in 4 different shard DBs.
* Increases horizontal scalability.

### 7.3 Read Replicas

* Create multiple DB replicas used only for reads.
* Complex queries can be moved to read replicas.
* The master focuses only on writes.

---

## 8. Monitoring & Autoscaling

### 8.1 Monitoring

* Track CPU, memory, request latency, error rate.
* Use Prometheus, Grafana, ELK stack.
* Alert when thresholds are exceeded.

### 8.2 Autoscaling

* Add/remove instances according to demand.
* Horizontal Pod Autoscaler in Kubernetes.
* Scale on CPU/memory or custom metrics (request count/queue length).

### 8.3 Chaos Testing

* Simulate failures to test load resilience.
* Example: use Chaos Monkey to randomly kill a service.

---

## 9. Anti-patterns to avoid

* **SELECT \*** in large queries.
* **No cache invalidation:** stale data causes errors.
* **Too much synchronisation:** every request is sync → easily bottlenecks.
* **No rate limiting:** a bot flood easily takes the system down.
* **Tight coupling between services:** one service dying drags the whole system down.

---

## 10. Conclusion

There is no fixed formula for designing a system that withstands high load; it is **a collection of many techniques** combined together. From an intelligent frontend, caching, pre-computation (Cache Promise, pre-warming), optimised queries, backend patterns (CQRS, Bulkhead, Batch processing, Bloom filter), request management (backpressure, admission control, load shedding, Request Coalescing) and data management (hot/cold, sharding, replicas) through to monitoring and autoscaling.

Every solution has **trade-offs** in cost, complexity and effectiveness. What matters is **choosing the right technique for the right context**: eCommerce may focus on caching & search engines, fintech emphasises transaction consistency, SaaS needs autoscaling and multi-tenant isolation, streaming prioritises backpressure and sharding.

By applying these techniques, the system will:

* **Withstand load better during peak hours.**
* **Avoid downtime and keep the user experience stable.**
* **Optimise operating costs.**
