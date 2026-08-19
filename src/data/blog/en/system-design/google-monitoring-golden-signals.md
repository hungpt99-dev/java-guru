---
title: "Monitoring Distributed Systems: Google's Four Golden Signals"
description: "A source-backed guide to monitoring latency, traffic, errors, saturation, and turning SLO evidence into actionable alerts."
pubDatetime: 2026-08-16T10:00:00+07:00
tags: ["system-design", "big-tech", "architecture"]
draft: false
featured: false
---

## 1. Original Engineering Problem

[SOURCE FACT] Monitoring a distributed service means collecting, processing, aggregating, and displaying real-time quantitative data such as query counts, error counts, processing times, and server lifetimes. The engineering problem is not to collect every possible signal; it is to identify what is broken, help explain why, and interrupt a human only when action is urgent and user-visible. [Source: Google, “Monitoring Distributed Systems,” https://sre.google/sre-book/monitoring-distributed-systems/]

[SOURCE FACT] A page is expensive: frequent pages cause people to skim or ignore alerts, and noise can mask a real incident. The source therefore describes effective alerting as high signal with very low noise, and says every page should be actionable. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] Distributed systems make this harder because a frontend symptom may be a backend cause, while retries can hide failures at one layer. A monitoring design must preserve both the user’s experience and enough internal evidence to debug the dependency chain without making the paging path depend on a fragile causal model.

## 2. What the Original System Did

[SOURCE FACT] The article describes Google SRE’s monitoring principles, not a complete named production architecture. It distinguishes white-box monitoring, based on internals such as logs and instrumented HTTP endpoints, from black-box monitoring, which tests externally visible behavior as a user would see it. Google SRE uses heavy white-box monitoring and modest but critical black-box monitoring. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[SOURCE FACT] The four golden signals are latency, traffic, errors, and saturation. If only four metrics can be measured for a user-facing system, the source recommends focusing on these. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

- [SOURCE FACT] **Latency** is request service time. Successful and failed request latency should be distinguished; a fast HTTP 500 is still a failure, while a slow error is worse than a fast error.
- [SOURCE FACT] **Traffic** measures demand using a system-specific high-level metric, such as requests per second, concurrent sessions, or transactions per second.
- [SOURCE FACT] **Errors** include explicit failures, implicit wrong results, and policy failures such as exceeding a committed response-time objective.
- [SOURCE FACT] **Saturation** measures how full the service is, emphasizing its most constrained resource. Systems can degrade before 100% utilization, so a utilization target matters.

[SOURCE FACT] The source recommends histograms or latency buckets rather than relying on a mean. It also recommends simple, predictable, robust rules for paging, with dashboards and post hoc analysis supporting diagnosis. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] The transferable design is a separation of concerns: user-facing symptoms drive paging; white-box causes enrich investigation; dashboards expose ongoing subcritical conditions; longer-horizon data supports capacity planning.

## 3. Architecture Diagram

[ANALYSIS] The diagram separates the source-backed monitoring concepts from an implementation proposed for an interview or a new service. The source does not claim this exact component topology is used by Google.

```mermaid
flowchart LR
    U[Users] --> S[Distributed service]
    S --> B[Black-box probes\n[Source-backed component]]
    S --> W[White-box instrumentation\n[Source-backed component]]
    B --> C[Metric collection and aggregation\n[Source-backed component]]
    W --> C
    C --> H[Latency histogram + golden-signal series\n[Proposed component]]
    H --> D[Dashboards and retrospective analysis\n[Source-backed component]]
    H --> R[Simple alert rules\n[Source-backed component]]
    R --> P[Pager / ticket / email\n[Source-backed component]]
    H --> E[SLO/error-budget evaluator\n[Proposed component]]
    E --> R
    W --> X[Logs and dependency evidence\n[Source-backed component]]
    X --> D
```

[SOURCE FACT] The source defines dashboards as summary views of core service metrics and classifies human notifications as pages, tickets, or email alerts. It also says basic collection, aggregation, alerting, and dashboards work well as a relatively standalone system. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[PROPOSED DESIGN] The SLO/error-budget evaluator is an explicit component here so that policy errors and user-visible availability can be computed consistently. It is an extension of the source’s SLO-oriented alerting discussion, not a claim about Google’s internal binaries.

## 4. System Design Analysis

[SOURCE FACT] Monitoring must answer two questions: “what’s broken?” and “why?” The source calls the first a symptom and the second a cause. It warns that dependency-based alerting hierarchies are difficult to maintain in systems that are continuously refactored. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] A practical pipeline should therefore have two paths:

- A low-complexity symptom path for paging: end-to-end probe success, request latency, and user-visible error rate.
- A rich diagnostic path for dashboards: dependency latency, retry counts, queue depth, resource utilization, logs, and deploy markers.

[SOURCE FACT] Black-box monitoring is useful for active user symptoms but is weak for imminent problems; white-box monitoring can expose imminent failures and failures masked by retries. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[PROPOSED DESIGN] Attach a stable service, route, status-class, and region identity to each metric, but control cardinality. Keep request IDs and detailed payload context in logs or traces rather than metric labels. A page should identify the affected service and symptom, link to the relevant dashboard, and state the first safe action.

[PROPOSED DESIGN] Define an SLI as the measured indicator, such as the proportion of eligible requests that complete successfully within a latency objective. Define the SLO as the target over a stated window. Keep the SLI computation reproducible from the same request classification used by dashboards and alerts; otherwise, an SLO report can disagree with the page that caused the investigation.

## 5. Data Model

[PROPOSED DESIGN] A minimal time-series record can be represented as:

```sql
CREATE TABLE metric_sample (
  observed_at TIMESTAMP NOT NULL,
  service TEXT NOT NULL,
  signal TEXT NOT NULL,          -- latency, traffic, errors, saturation
  metric TEXT NOT NULL,
  value DOUBLE PRECISION,
  bucket_le_ms INTEGER,
  region TEXT,
  route TEXT,
  status_class TEXT
);
```

[PROPOSED DESIGN] For latency, store cumulative histogram buckets plus request counts and sums. This supports quantiles and distinguishes successful from failed requests. For traffic and errors, store counters or rates. For saturation, store the constrained-resource utilization and a target; store forecast observations separately so a four-hour disk prediction is not confused with current fullness.

[SOURCE FACT] The source’s example of internal sampling records CPU utilization each second, increments a bucket with 5% granularity, and aggregates those values every minute. It presents this as a way to observe brief hotspots while reducing collection and retention cost. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] Retention should match purpose: high-resolution data for incident diagnosis, downsampled data for trends, and durable SLO aggregates for compliance and review. The exact retention periods are service-specific and are not specified by the source.

## 6. API Design

[PROPOSED DESIGN] Expose a small read API and keep writes internal to collectors:

```http
GET /v1/services/{service}/signals?start=...&end=...&region=...
GET /v1/services/{service}/slo?window=...
GET /v1/services/{service}/alerts?state=firing
```

[PROPOSED DESIGN] Return aligned time buckets, histogram boundaries, counts, and alert metadata. Require callers to request an explicit time range and bounded label filters. The API should provide a stable summary contract while logs, profiling, and detailed debugging remain separate systems.

[SOURCE FACT] The source recommends keeping basic monitoring distinct from profiling, single-process debugging, load testing, log analysis, and traffic inspection, with clear loosely coupled integration points such as web APIs for summary data. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

## 7. Scaling Strategy

[SOURCE FACT] The source notes that a Google SRE team with 10–12 members typically had one, sometimes two, people primarily assigned to monitoring; it also says common infrastructure has become more centralized over time. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[PROPOSED DESIGN] Scale the proposed system in these dimensions:

- Partition collectors by service and region, then aggregate by fixed time bucket.
- Use local aggregation for histograms and counters before transmission.
- Bound label cardinality and reject unapproved dimensions at ingestion.
- Separate hot recent data from cheaper historical storage.
- Make alert evaluation horizontally scalable, but keep each rule deterministic and independently explainable.
- Replicate the alert path so a telemetry-storage outage does not silently remove all paging; expose collector health as its own signal.

[SOURCE FACT] The article says per-second measurements can be expensive and recommends internal sampling plus aggregation when high resolution is needed without extremely low detection latency. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] Aggregation reduces cost but can hide short spikes if the bucket or histogram design is poor. Preserve enough distribution information for tail latency, and test alert behavior against bursty traffic rather than only smooth load.

## 8. Failure Scenarios

[PROPOSED DESIGN] **Fast failures:** A dependency outage returns immediate 500s. Count errors separately from latency so a low latency average cannot make the service look healthy.

[PROPOSED DESIGN] **Slow failures:** Queue growth causes tail latency to rise before total failure. Alert on the user-visible latency signal and use queue, CPU, or I/O telemetry for diagnosis.

[PROPOSED DESIGN] **Masked failures:** Retries convert backend errors into eventual successes while consuming capacity. Preserve retry and dependency metrics in white-box telemetry; do not page only on the first backend error unless it is independently user-visible.

[PROPOSED DESIGN] **Telemetry failure:** A collector or evaluator stops reporting. Treat missing monitoring data as a separate monitoring-health condition and provide a fallback probe path.

[SOURCE FACT] The source says latency increases can be a leading indicator of saturation, and that a short-window 99th-percentile response time can provide an early saturation signal. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[SOURCE FACT] The source’s alert review asks whether a condition is urgent, actionable, and user-visible; whether it can be benign; whether users are actually affected; and whether another alert already covers it. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

## 9. Capacity Estimation

[SOURCE FACT] The article gives an illustrative service example of 1,000 requests per second with 100 ms average latency, where 1% of requests might take 5 seconds. It uses this to show why the mean hides the tail. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[ANALYSIS] That example implies an average arrival rate of 1,000 requests per second, but it does not specify event size, number of series, storage layout, or collector capacity. Those values must not be presented as Google production capacity.

[PROPOSED DESIGN] **Illustrative assumption:** for a new service, assume 2,000 requests per second, 20 approved route-region-status series, and 60-second aggregation at the central store. That yields 40,000 series observations per minute before histogram bucket expansion. This is a planning input, not a source fact. Validate it with a load test and actual label distributions.

[PROPOSED DESIGN] **Illustrative assumption:** if each series emits 20 histogram buckets plus count and sum, one minute of aggregation produces roughly 22 values per series per minute. The storage estimate must then include encoding, indexes, replication, and retention; none of those factors are specified by the source.

[SOURCE FACT] For a service targeting 99.9% annual uptime, the source says probing for success more than once or twice a minute is probably unnecessarily frequent, and checking disk fullness more often than every 1–2 minutes is probably unnecessary. It also says the appropriate resolution depends on the monitoring goal. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

## 10. Trade-offs

[ANALYSIS] **Symptoms versus causes:** Paging on symptoms is easier to reason about and more directly tied to users, but it may delay diagnosis. Cause metrics accelerate debugging, but dependency graphs create fragile alert logic.

[ANALYSIS] **Mean versus tail:** Means are compact and cheap, but hide uneven latency and overloaded shards. Histograms cost more and require bucket choices, but expose the tail that users experience.

[ANALYSIS] **Resolution versus cost:** Fine-grained samples catch spikes and increase storage, network, and query cost. Aggregation lowers cost but risks erasing short incidents.

[SOURCE FACT] The source favors simpler, faster monitoring and better post hoc analysis over “magic” threshold or causality systems. It says rules that page humans should be simple and robust. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

[PROPOSED DESIGN] Start with four signal dashboards and a small page policy. Add a diagnostic metric only when it answers a recurring incident question or supports a documented action; remove data that is neither exposed nor used.

## 11. What We Can Learn From This Architecture

- [SOURCE FACT] Measure latency, traffic, errors, and saturation first for a user-facing service. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]
- [SOURCE FACT] Treat SLOs as user-facing objectives and ensure policy failures, such as exceeding a committed response time, are represented as errors where appropriate. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]
- [SOURCE FACT] Keep pages urgent, actionable, and low-noise; use dashboards for subcritical conditions. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]
- [ANALYSIS] Instrument distributions, not only averages, because distributed fan-out turns backend tail latency into frontend experience.
- [ANALYSIS] Separate detection from diagnosis. A page can be simple while its linked dashboard is detailed.
- [PROPOSED DESIGN] Make monitoring configuration reviewable like code: every page rule needs an owner, user-impact rationale, runbook action, and a test for benign conditions.

## 12. Proposed Interview-Style System Design

[PROPOSED DESIGN] **Problem:** design a monitoring platform for a multi-region API that detects user-visible incidents, supports SLO reporting, and helps engineers find causes without paging on every internal anomaly.

[PROPOSED DESIGN] **Requirements:** ingest the four signals; separate successful and failed latency; preserve tail distributions; support black-box probes and white-box metrics; evaluate SLOs; provide dashboards; page only for urgent actionable conditions; tolerate partial telemetry loss.

[PROPOSED DESIGN] **Write path:** service instrumentation emits counters, histograms, and resource gauges to a regional collector. The collector validates labels, aggregates locally, and forwards batches to a durable regional buffer. A central aggregator produces queryable time series and SLO windows. A separate evaluator consumes the same normalized series and emits deduplicated alert events.

[PROPOSED DESIGN] **Read path:** dashboards query recent and historical aggregates. An alert links to a fixed view containing latency distribution, traffic, error classification, saturation, deploy markers, probe results, and dependency evidence. Logs and traces are queried separately by request or incident identifiers.

[PROPOSED DESIGN] **Alert policy:** page on an otherwise undetected, urgent, actionable, user-visible symptom. Ticket or dashboard-only treatment is appropriate for non-urgent capacity trends and diagnostic causes. Suppress only with explicit context such as drained traffic, and preserve an audit trail for suppression.

[PROPOSED DESIGN] **Failure handling:** buffer during central-store outages, mark data freshness, deduplicate regional pages, and keep a low-dependency black-box path. If automation performs a rote mitigation, record it as automation debt and require a long-term owner rather than allowing the workaround to become invisible.

[ANALYSIS] The design is intentionally less clever than a causal inference engine. The source’s central lesson is operational: a monitoring system is useful when its critical path remains simple and comprehensible during an incident. [Source: https://sre.google/sre-book/monitoring-distributed-systems/]

## Original Sources

- Company: Google
- Exact Article Title: Monitoring Distributed Systems
- URL: https://sre.google/sre-book/monitoring-distributed-systems/
- What information from the source was used: Definitions of monitoring, white-box and black-box monitoring, reasons to monitor, the four golden signals, tail-latency histograms, measurement resolution, SLO and alerting principles, and the requirement for simple, actionable, low-noise pages.
