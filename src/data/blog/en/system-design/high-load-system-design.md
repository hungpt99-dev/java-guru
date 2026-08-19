---
title: "High-Load System Design: Managing Traffic Spikes End to End"
description: "A practical guide to reducing load across the frontend, cache, database, backend, request path, monitoring, and autoscaling layers."
pubDatetime: 2025-09-21T04:32:00+07:00
featured: true
draft: false
tags:
  - system-design
  - microservices
  - backend
---

## 1. Context and Challenges

Systems such as e-commerce platforms, fintech products, SaaS applications, social networks, and streaming services can all experience sudden traffic spikes. Examples include flash sales, holiday shopping periods, end-of-month financial reporting, and unexpected events that cause many users to access the system at the same time.

**[ANALYSIS]** Without preparation, the usual failure modes are increased latency, CPU or memory exhaustion, and service unavailability. The resulting user and business impact makes high-load design a cross-layer problem rather than a single infrastructure decision.

This article covers techniques across the request path: frontend behavior, caching, precomputation, query and data processing, backend architecture, request management, and operational controls such as monitoring and autoscaling. There is no single solution that handles every bottleneck. The design has to combine techniques that address different sources of load.

## 2. Frontend Optimization to Reduce Backend Load

Load reduction can start in the frontend. A UI that requests only the data needed for the current interaction avoids unnecessary work in the backend.

### 2.1 Performance-Oriented UX/UI

- **Prioritize important information.** Render the fields users need first. On an e-commerce product page, that might be the name, price, and image. Less frequently needed information, such as detailed reviews or sales history, can be placed in a separate tab.
- **Use lazy loading and skeleton UI.** Render the structure first and fetch data when it is needed. This improves perceived responsiveness and can reduce the number of simultaneous requests.
- **Use pagination or infinite scroll.** Do not load an entire collection at once. **[ILLUSTRATIVE ASSUMPTION]** A product list may request the first 20 items and fetch another page as the user scrolls.
- **Defer secondary data.** Statistics that are rarely viewed can be placed in an accordion or modal and fetched only when opened.

**[ILLUSTRATIVE ASSUMPTION]** For an admin dashboard that displays 1,000 orders per day, the initial request could return only the first 20 orders. Additional orders would be fetched when the user scrolls or applies a filter. This prevents every page load from triggering a query for the full result set.

### 2.2 Frontend Cache

- **LocalStorage or SessionStorage:** Store data that changes infrequently, such as product categories or dashboard configuration.
- **Service Worker or PWA cache:** Reuse cached resources on reload and support offline behavior for the resources and flows that have been explicitly cached.
- **Cached API responses:** Keep a client-side copy of data that is safe to reuse, such as banners, menus, or selected profile data. The invalidation and freshness policy must match the data's consistency requirements.

Client-side caching can reduce repeated backend requests and improve response time. It does not replace server-side controls: cached data must still have an appropriate lifetime and access policy.

## 3. Caching and Precomputation

Real-time computation is a common source of load. Reports, statistics, and aggregates that do not need to be calculated for every request can be prepared before they are requested.

### 3.1 Precomputation

- Precompute important results instead of calculating them in the request path.
- Store the results in intermediate tables or database materialized views.
- Refresh them on a schedule or in response to relevant events.

### 3.2 Cache Pre-Warming

Before a known peak, preload hot data into the cache. **[PROPOSED DESIGN]** Before a flash sale, for example, the system could load frequently accessed product data. This reduces the chance that many requests miss the cache and query the database at the same time.

Pre-warming is useful only when the hot set and freshness requirements are understood. It should not be treated as a substitute for handling cache misses safely.

### 3.3 Multi-Layer Caching

- **Edge cache (CDN):** Distribute static assets such as images, video, CSS, and JavaScript.
- **Application cache (for example, Redis):** Cache dynamic data, sessions, or tokens where the security and invalidation model permits it.
- **Database cache:** Cache eligible query results according to the database and application consistency requirements.

Multiple cache layers can absorb different parts of the request volume, but each layer needs an explicit TTL, invalidation strategy, and capacity policy.

### 3.4 Promise Cache / Single-Flight

In this context, a promise cache stores the in-progress result for a request. If an equivalent request arrives while the first one is still running, it waits for that result instead of starting another backend or database request. This pattern is also commonly called request coalescing or single-flight.

**[PROPOSED DESIGN]** If several users request the details of the same hot product at once, one request can query the database while the other requests await the shared promise. The implementation must also handle rejection and expiry so a failed or abandoned request is not retained indefinitely.

## 4. Query Optimization and Data Processing

Querying more data than the request needs and doing expensive work synchronously both increase load. Batch processing, Bloom filters, and request coalescing can reduce unnecessary database work, but they solve different problems.

### 4.1 Query Only What Is Needed

- Select only required fields instead of using `SELECT *`.
- Use pagination with `LIMIT`/`OFFSET` or cursor-based pagination, depending on the access pattern.
- Avoid complex multi-table joins in latency-sensitive requests when the work can be performed offline by a batch job.
- Add indexes that match the actual query patterns and verify their effect with the database's query plans.

Examples:

- A top-selling-products result may need only `product_id`, `category_id`, and `sold_quantity`.
- A transaction report may need `user_id`, `amount`, and `status`, not long text fields.

Selecting less data reduces I/O and memory use, which can improve throughput and reduce the risk of out-of-memory failures. Indexes and pagination still need to be chosen for the specific workload; neither is automatically beneficial for every query.

### 4.2 Batch Processing

Batch processing groups many small operations into a larger operation. It can reduce per-call overhead when interacting with APIs or databases. A queue can be used alongside batching to regulate processing speed and provide backpressure.

**[ILLUSTRATIVE ASSUMPTION]** To update the status of 1,000 orders, the application could send one batch update rather than issue one database update per order, provided the transaction, error-handling, and locking requirements allow it.

### 4.3 Bloom Filter

A Bloom filter is a probabilistic data structure for testing whether an element may exist in a set. It returns either “definitely not present” or “possibly present.” A correctly configured Bloom filter has no false negatives, but it can have false positives, so a positive result still requires verification by the source of truth.

Possible uses include:

- Rejecting coupon codes that are definitely absent before querying the database.
- Reducing cache penetration, where requests repeatedly target keys that do not exist.
- Filtering some bot or unwanted requests before more expensive processing.

**[PROPOSED DESIGN]** For a coupon entry, a negative Bloom-filter result can reject the request without a database lookup. A positive result must continue to normal validation because it may be a false positive.

### 4.4 Request Coalescing

When equivalent requests arrive close together, the backend can merge them into one operation and share the result with the waiting requests. This reduces duplicate database queries and smooths short-lived load spikes. The design needs a definition of request equivalence, a maximum wait time, and behavior for failures.

**[ILLUSTRATIVE ASSUMPTION]** If 500 users request the top 10 best-selling products at the same time, request coalescing can turn those equivalent lookups into one query whose result is returned to the waiting callers.

## 5. Backend Architecture

Backend architecture determines how reads, writes, and expensive work are isolated and scaled. The right choice depends on consistency, query patterns, and operational constraints; the patterns below are design options, not universal requirements.

### 5.1 CQRS and a Search Engine

CQRS (Command Query Responsibility Segregation) separates write and read models:

- The write model is optimized for transactional updates.
- The read model is optimized for query and retrieval patterns.

**[PROPOSED DESIGN]** A search engine such as Elasticsearch or OpenSearch can serve suitable complex queries instead of sending every query to the transactional database. Materialized views can provide another read-optimized representation for aggregates and predefined queries. The read model must be updated from the write side, and the resulting consistency delay must be acceptable for the product requirement.
