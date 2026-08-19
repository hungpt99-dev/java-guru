---
title: "Designing a Distributed Job Scheduler"
description: "An operational design for timezone-aware cron, one-off jobs, and DAG workflows with at-least-once execution and auditable recovery."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Problem

We need a multi-tenant scheduler for data pipelines, billing tasks, notifications, and maintenance jobs. A user can define a cron schedule, request a one-off run, or compose tasks into a directed acyclic graph (DAG). The scheduler determines when a run is due and coordinates dispatch to worker fleets. It does not execute the business logic itself.

Functional requirements:

- Support cron expressions, one-off timestamps, and DAG dependencies.
- Provide at-least-once execution. A worker may receive the same run again after a timeout or failover.
- Retry with bounded exponential backoff and jitter. After the policy limit, move the run to a dead-letter state.
- Make catch-up explicit. After downtime, missed occurrences can be replayed, coalesced, or skipped according to the schedule policy.
- Apply IANA time-zone rules, including daylight-saving transitions. A local time that occurs twice must retain its distinct offset; a nonexistent local time must follow the declared skip policy.

Non-functional requirements:

- Avoid silent duplicate execution. The platform prevents duplicate logical dispatches, but job code must remain idempotent: at-least-once delivery cannot prevent an old worker from completing after a timeout.
- Detect missed tasks, retain an audit history, scale horizontally, isolate tenants, and support regional disaster recovery.
- Target 99.95% availability for schedule evaluation and control APIs, and a 99.9% objective for dispatch latency under normal load. At p99, a due run should be enqueued within 30 seconds of its due instant.

The users are platform teams and service owners. They need a durable record of the intended run, each dispatch, the attempt that executed, and the reason a run was skipped or delayed.

## 2. Scale Estimation

Assume 2,000 tenants and 10,000 active schedules. This is a deliberately moderate starting point: it creates meaningful operational pressure while keeping the primary database useful as the authority for scheduler state. Assume each tenant averages 25 API actions per day, including schedule edits, run queries, and manual triggers.

- API volume = `2,000 DAU x 25 requests/day = 50,000 requests/day`.
- Average API rate = `50,000 / 86,400 = 0.58 RPS`. Design for `10x = 5.8 RPS` at peak, rounded to 10 RPS to absorb bursts.
- If each schedule produces 100 occurrences/day, occurrence creation is `10,000 x 100 = 1,000,000 occurrences/day`, or `11.6` per second on average. A 10x temporal burst produces 116 due events/second.
- If 2% of occurrences require a retry, dispatch-attempt events total `1,000,000 x 1.02 = 1.02 million/day`. At 1.5 KB per event, the event log is about `1.53 GB/day`, or `1.67 TB` over three years before compression and replicas.
- An authoritative run row averages 1 KB. With 1.02 million attempts plus metadata, 30-day hot storage is approximately `1.02M x 1 KB x 30 = 30.6 GB`, excluding indexes and replicas. Budget 3x, or 92 GB.
- If 5% of runs produce 20 KB of logs retained for 30 days, log ingress is `1.02M x 0.05 x 20 KB = 1.02 GB/day`. Logs belong in object storage, not the transactional database.
- At the 116 events/second peak, a 1.5 KB dispatch event is only `174 KB/s`, or 1.4 Mbps, before replication. Provision 10 Mbps per broker direction to leave room for workflow metadata and bursts.
- The normal control-read to attempt ratio is close to 20:1.
