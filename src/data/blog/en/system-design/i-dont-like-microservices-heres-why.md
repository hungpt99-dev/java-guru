---
title: "When Microservices Are the Wrong Default"
description: "A practical comparison of microservices and monoliths, with decision criteria for choosing an architecture that matches the team, domain, and operational maturity."
pubDatetime: 2025-06-01T13:52:00+07:00
featured: true
draft: false
tags:
  - microservices
  - system-design
  - backend
  - career
---

Microservices solve real problems, but they also introduce a distributed system. That means network failures, independent deployments, operational overhead, and more complicated data flows. For a small team or an early product, those costs can outweigh the benefits.

This article is based on the author’s experience implementing and maintaining services. It compares the operational trade-offs with a monolith and proposes criteria for deciding when the additional complexity is justified.

## What Changed When the Application Was Split

**[SOURCE FACT]** The author initially treated microservices as the standard architecture, then worked on team projects with a small team of 4–5 developers. That experience showed that splitting code into services is not the same as creating independent, low-cost components.

The main costs were:

- **Network failure modes.** A request that crosses several services can encounter latency, timeouts, retries, partial failure, or an unavailable dependency. A timeout policy and retry policy must be designed for each call; retries without limits can increase load and make an incident worse.
- **Deployment coordination.** Each service may have its own build, configuration, version, deployment, and rollback process. A small code change can therefore require coordination across repositories or services.
- **Data consistency.** A transaction spanning one database is straightforward. The same workflow across service-owned data usually requires asynchronous events, idempotent consumers, and an explicit consistency model. A Saga can coordinate a multi-step workflow, but it does not make distributed transactions equivalent to a local database transaction.
- **Debugging and observability.** A production incident may require correlating logs and traces across services. Without consistent request IDs, useful metrics, and service-level alerts, the system is difficult to diagnose.

These are not arguments that microservices are inherently bad. They are the baseline costs of moving from an in-process call to a network call.

## What a Small Team Gives Up

**[ANALYSIS]** For a small team, a monolith often keeps more work in one place:

- **Focus.** One repository and one deployable unit make it easier to understand the whole product and discuss changes together. Separate services can create ownership silos when people learn only one part of the system.
- **Development and release speed.** A monolith can often be built, deployed, and rolled back as one unit. With services, configuration, compatibility, deployment order, and rollback may need to be coordinated.
- **Feedback time.** A feature that crosses service boundaries cannot be considered complete when only one service is deployed. API compatibility and the behavior of dependent consumers also need to be checked.

This is a trade-off, not a universal rule. A monolith can also become difficult to change, and microservices can improve team autonomy when the boundaries are real and the platform supports them.

## What Microservices Do Well

**[SOURCE FACT]** The original experience did not eliminate the legitimate benefits of microservices. In the right context, they can provide:

- **Independent scaling.** A component with a different load profile can be scaled without scaling every component.
- **Team autonomy.** Teams organized around stable business boundaries can own their services, releases, and operational responsibilities with fewer cross-team dependencies.
- **Independent replacement.** A well-defined service boundary can make it easier to replace one implementation without changing unrelated parts of the system.

These benefits depend on boundaries that are actually independent. Splitting a tightly coupled workflow into services usually moves complexity into APIs, queues, deployment pipelines, and failure handling.

## When the Complexity Is Justified

**[PROPOSED DESIGN]** Consider microservices when most of the following are true:

- The team is large enough to own multiple services without leaving each service under-supported. There is no universal developer-count threshold; the relevant question is whether ownership and on-call responsibilities are sustainable.
- The delivery platform already supports automated CI/CD, configuration management, rollback, logging, metrics, and distributed tracing.
- The domains have meaningful boundaries. Payments, user management, and logistics may be separate domains, but they should be separated only when their data and change patterns are sufficiently independent.
- A component has a materially different scaling or availability requirement, and independent operation justifies the added cost.
- The organization is prepared to operate asynchronous workflows, retries, timeouts, backpressure, and idempotency (safe repeated processing), rather than treating them as implementation details.

High traffic alone is not enough. If the system is still tightly coupled, service boundaries will not automatically improve performance or reduce cost.

## When a Monolith Is the Better Choice

**[PROPOSED DESIGN]** A modular monolith is usually the safer starting point when:

- The team is small. **[SOURCE FACT]** The original example involved 3–5 developers with a large backlog.
- The product has a few main modules and no clear need for independent scaling.
- The team is still building its CI/CD and operational practices. Adding services before these foundations exist increases the number of things that can fail.
- The deadline is short. **[SOURCE FACT]** The original example contrasts shipping a product in one month with developing it over one year. These are examples from the source, not general planning guidance.

A modular monolith is not a commitment to keep one deployable forever. It can enforce module boundaries, keep local transactions simple, and provide a path to extract a service later when a boundary and a concrete operational need have been demonstrated.

## A Practical Decision Rule

Do not choose microservices because they are fashionable, or because another company uses them. Start with the problem the architecture must solve:

- Which parts need independent scaling or deployment?
- Which teams can own those parts end to end?
- Which data must remain consistent in one transaction?
- Can the platform observe, deploy, roll back, and operate a distributed system?
- Is the expected benefit larger than the cost of network calls, operational tooling, and coordination?

**[ANALYSIS]** For a small team with a small initial scope and a tight deadline, a modular monolith is often the lower-risk default. For independent domains with sustainable ownership and mature operations, microservices may be the better fit. Neither statement is a law; both are decisions that should be revisited as the system changes.

## Closing

The useful conclusion is not that microservices are bad. It is that architecture should follow the problem, the team, the domain boundaries, and the operational capability.

If you have operated either a monolith or a microservices system, the valuable discussion is not which label is best. It is which constraints shaped the decision, and whether the resulting complexity was worth paying for.
