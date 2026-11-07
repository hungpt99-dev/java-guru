## 1. A simple API, many problems behind it

Imagine you are building an e-commerce system. When a user opens a product detail page, the backend has to gather information from several services:

- **Product Service:** product name, description, images.
- **Inventory Service:** stock availability.
- **Pricing Service:** selling price and promotions.
- **Review Service:** rating score and number of reviews.

A single aggregation API can call those services and then assemble the data into one response.

At first, the system works reasonably well. But as traffic grows, the team starts caring about latency, throughput and load capacity. During that optimization work, one important question often gets skipped: **Does this request really need to read the latest data, or can it accept data that has not been updated yet?**

Consider two cases.

A user opens a product page and sees a rating of 4.5 stars, even though a review was just created and the average needs to be recalculated. If the rating updates a few seconds late, the experience may still be acceptable.

Conversely, a user just successfully updated their shipping address, but the next request returns the old address. Or the system uses stock information that has not been updated to decide whether to reserve an item. In those cases, data that does not reflect the new state can directly affect the business.

Both are problems about reading data, but their consistency requirements are completely different.

That shows the problem is not simply how many services an API calls, but **what consistency level each query needs and how much the system has to pay to meet that requirement**.

## 2. Consistency and Performance are not simply two extremes

When optimizing performance, we usually think of familiar solutions:

- Add a cache to reduce latency.
- Read from replicas to offload the database.
- Process asynchronously to reduce coupling between components.
- Build a dedicated read model for complex queries or queries with a large read volume.

All of them are useful, but each comes with its own trade-offs.

A cache can return results faster, but the data in the cache may not reflect recent updates. A read replica helps offload reads, but it may not have received the new data from the primary yet. A read model updated through events can serve a large volume of requests, but the information in it is not necessarily updated immediately after every write in the source service.

The important point is that wanting high performance does not mean you have to accept stale data, and needing consistency does not mean you have to use the slowest possible read path.

First you need to determine which kind of consistency the business requires. Only then do you choose the appropriate read mechanism.

From an API design perspective, read needs can be split into two groups.

### 2.1. Queries that need the latest data per business requirements (Consistency-critical queries)

These are queries where reading data that is not up to date can make the system reach the wrong decision or fail to meet the business requirement.

For example:

- Reading the status of a transaction right after a successful update.
- Checking account status before an important operation.
- Reading information the user just changed and needs to see immediately.
- Checking the conditions for an important state transition.

For this group, the system needs to pick a read mechanism that guarantees the appropriate level of consistency.

However, you need to distinguish reading the latest data from guaranteeing the business rule holds when multiple requests happen concurrently. A request may read the correct state at the moment it reads, but that state can still change before the request performs its write.

So if the business requires protecting a condition during an update, reading the latest data alone is not enough. The system may need a conditional update, a transaction, optimistic locking, or an equivalent mechanism.

### 2.2. Queries that can tolerate data not being updated immediately (Staleness-tolerant queries)

These are queries where not reflecting some recent updates does not make the business result wrong.

For example:

- The rating score and review count on a product page.
- View counts.
- Aggregated dashboards.
- Analytics reports that do not require real time.
- A product list personalized based on recent behavior.

For this group, the system can accept data that is not updated immediately in order to use read mechanisms with lower latency or lower cost.

For instance, instead of recalculating the rating from every review on each request, the system can store the aggregate result and update it when a new review arrives. If the business accepts a delay of a few seconds, this approach can substantially reduce the work that has to be done at read time.

However, stale data does not mean data is allowed to be arbitrarily wrong. If the business requires data to be updated within seconds, a delay of minutes is still a problem that needs to be handled.

**When the data needs to be updated must come from the business requirement, not from the backend deciding on its own because it is convenient for optimization.**

## 3. The cost of always demanding the latest data

Back to the product detail API. When a user opens the page, each data field may have a different consistency requirement.

Product description information that rarely changes can be cached. The rating can tolerate a few seconds of update delay. Meanwhile, pricing or stock information has to be handled according to the specific business requirement.

If every query demands reading the latest data from the authoritative source, the system may end up performing more synchronous operations than necessary.

That can lead to:

- Many read operations having to hit the primary data source.
- Database resources being spent on data whose result could be reused.
- Requests having to wait for synchronous read operations to finish.
- Read offloading being limited by the consistency requirement.
- Read cost rising under heavy workload.

That does not mean reading the latest data is always slow or that every request should avoid the primary database. The actual impact depends on the database, the workload, the consistency mechanism and the implementation.

The question is whether the request really needs that level of consistency.

For example, if every time a product page is opened the system recalculates the rating from thousands of reviews, index tuning can make the query faster but does not eliminate the repeated work.

If the rating only needs to be updated within seconds of a new review, the system can recalculate when the data changes and store the aggregate result.

Conversely, if a request needs to check the status of a transaction that was just updated, using stale data purely to reduce latency may fail the business requirement.

**Performance optimization is not just making a query run faster; it is also determining whether that query needs to run at its current level of consistency at all.**

## 4. Separate data for display from data used for business processing

One practical approach is not to apply the same consistency requirement to every read need.

### 4.1. For display data, an update delay can be acceptable

For data that is read often but does not need to be updated instantly, we can use a cache or a read model to serve the query.

For example, whenever a new review arrives, the Review Service emits an event. A consumer receives the event and updates the aggregate information:

```json
{
  "productId": "P001",
  "averageRating": 4.6,
  "reviewCount": 1280
}
```

The product display API only needs to read that aggregate result instead of calculating from every review on each request.

The processing flow can be organized as follows:

```text
Review Service
      |
      | ReviewCreated event
      v
Message Broker
      |
      v
Consumer / Projection Builder
      |
      v
Review Summary Read Model
      |
      v
Product Detail API
```

The read model can live in a database optimized for queries, a cache or OpenSearch, depending on the need.

When a new review arrives, the displayed rating or review count may not change immediately. If the business accepts that update window, the system gets faster reads in return and less work to do on each request.

This is an application of CQRS — separating the read model from the write model when the need genuinely calls for it.

However, you should not adopt CQRS just because the system happens to use microservices. If the data is small, traffic is low and queries are simple, reading directly from the database may be easier to deploy and operate.

### 4.2. For data used for business decisions, correctness must be protected

Now consider the inventory problem.

A dangerous approach is:

1. Read the stock quantity from the cache.
2. If there is stock left, create the order.
3. Decrease the stock quantity afterwards.

Suppose only one item is left. Two requests arrive at almost the same time and both read the value `1` from the cache. Both conclude that the order can be placed.

Even if both requests read the latest data at read time, a race condition can still occur. The problem is not only whether the data has been updated, but also the gap between the read operation and the write operation.

A simple solution at the database level is a conditional update:

```sql
UPDATE inventory
SET available_quantity = available_quantity - 1
WHERE product_id = :productId
  AND available_quantity >= 1;
```

Then check the number of updated rows:

- One row updated: the reservation succeeded.
- No row updated: the condition was not met.

When the database executes this statement atomically, the system can prevent two requests from together reducing the stock below the available quantity.

If the operation needs to update several tables, the system has to determine the appropriate transaction boundary. If Inventory belongs to its own service, reserving stock can be implemented as a standalone reservation business operation, combined with idempotency to handle retries and avoid duplicate reservations.

The key point is not to confuse reading the latest data with guaranteeing that a condition still holds at the moment of the update.

**The consistency of the read operation and the concurrency control on the write operation are two related problems, and one cannot substitute for the other.**

## 5. Cache, Read Replica and Read Model: picking the right tool

Cache, read replica and read model can all improve read performance, but they differ in how data is updated and what consistency level they can deliver.

| Solution | Good fit when | Main trade-off |
|---|---|---|
| Cache | The data is read often and the result can be reused | Cache invalidation, TTL, cache miss |
| Read replica | Reads need to be offloaded from the primary database | Replication lag, read-after-write |
| Read model / CQRS | There are complex queries or aggregate data that must be served fast | Synchronization delay, operating the projection |
| Conditional update / transaction | Business rules must be protected on write | Lock contention, transaction duration |

These techniques are not mutually exclusive. A system can use a read model, put a cache in front of the read model, and still use transactions on the write path.

For example:

- Product list page: cache or read model if a delay is acceptable.
- Dashboard: aggregate data updated periodically or per event.
- Product search: OpenSearch serving search and filtering.
- Reserving stock: an atomic operation on the authoritative data source.
- Transaction details: use the data source and read mechanism that meet the business requirement.

In particular, be careful with read replicas.

Suppose a user has just successfully updated their shipping address. The next request reads from a replica that has not received that change and may return the old address.

If the API requires the user to see the just-updated information immediately, the system needs an appropriate read-after-write strategy. It can route some requests to the primary, use data versions, or apply a conditional read mechanism, depending on the database and the system's requirements.

The important thing is not to choose a cache, replica or read model just because they can improve performance. You need to first determine how stale the data is allowed to be, and only then pick the right tool.

## 6. Eventual Consistency does not mean the data will automatically be correct

When using an event-driven architecture, a common mistake is assuming that simply emitting events through Kafka means the read model will update itself correctly.

In reality, consumers can lag, fail to process, receive events again, or apply updates out of the desired order.

Suppose the system receives two events updating the review count:

```text
ReviewCountUpdated: 100
ReviewCountUpdated: 101
```

If the older event is processed after the newer one and the consumer overwrites the value directly, the read model can go backwards from `101` to `100`.

Depending on the data model, this can be solved with versions, sequences, or by designing the update to be idempotent. A bare timestamp is not always enough to guarantee the correct order.

In addition, the consumer needs a retry mechanism, duplicate event handling, lag monitoring and failure recovery. If the read model is missing data or holds wrong data, the team also needs to know how to rebuild it from the authoritative data source or from a retained event log.

Suppose the system was designed to update the review count within seconds, but the consumer lags by 10 minutes. That is no longer a small deviation you can ignore; the system is failing the requirement it set for itself.

So when using eventual consistency, you need to make clear:

- Within what time window the data must be updated.
- How to detect that a consumer is lagging.
- How to handle duplicate events and errors.
- How to recover or rebuild the read model.
- How the API will respond if the data has not been updated as expected.

**Eventual consistency does not mean accepting wrong data. It means the system allows data to be updated after the source data, within limits that have been defined.**

## 7. Questions to answer before designing a read API

Before deciding to use a cache, a replica or a read model, make a few questions clear.

### How up to date does this data need to be?

A product rating can tolerate a few seconds of update delay. But for transaction status or data used to make important decisions, reading an old version may fail the business requirement.

Do not impose the same consistency requirement on all data just because it appears in the same response.

### Does the user need to see the change they just made immediately?

If the user just updated data and reads it back right away, do they need to see that change instantly?

If so, the read strategy has to account for the cache or replica possibly not being updated. If not, you can take advantage of read mechanisms that reduce cost and improve performance.

### Is the query result used to make a business decision?

If the result only serves display, data that is not updated immediately may be acceptable.

If the result decides a payment, a stock reservation or a transaction state transition, you need to determine the consistency guarantee and the appropriate mechanism to protect the business rules. You should not rely on the result of a single read and then assume the state is unchanged when the request performs its write.

### What happens when a service does not respond?

If the Review Service does not respond, the API can return the product information together with a previously stored rating, if the business accepts that.

But if the system cannot confirm a mandatory condition of a transaction, it may have to reject it or leave it unprocessed for the time being.

Fallbacks must be decided per type of data and per business flow; the same approach should not be applied to the entire API.

### How do you know the system is meeting its consistency requirement?

Some useful metrics include:

- P95/P99 latency of the API and its dependencies.
- Cache hit ratio and cache misses.
- The time from emitting an event to the read model being updated.
- Consumer lag and the number of events waiting to be processed.
- The proportion of data whose staleness exceeds the defined limit.
- The rate of reservations failing due to out of stock or concurrent contention.

Without tracking these metrics, the team can hardly tell whether the system is actually meeting the requirement or has simply not hit an obvious incident yet.

## Conclusion

In Microservices, optimizing queries is not simply about reducing the number of database calls or the SQL execution time.

A good design starts by understanding what the data is used for, which updates the request needs to see, and what happens if the system uses data that has not been fully updated.

For display or analytics data, cache, read replica and read model can improve throughput and reduce read cost if the business accepts an appropriate delay.

For queries that must reflect completed updates, the system needs a read mechanism that meets the corresponding consistency guarantee. For business flows with concurrent updates, it also needs a mechanism that protects correctness at the write layer.

**Don't assume every request needs the latest data. Determine the level of consistency the business actually requires, then choose the read strategy that balances correctness, performance and cost.**

### References

1. [Microsoft Learn — Data considerations for microservices](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations)
2. [Microsoft Learn — CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
3. [AWS Prescriptive Guidance — CQRS pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/cqrs-pattern.html)
4. [microservices.io — CQRS](https://microservices.io/patterns/data/cqrs.html)
