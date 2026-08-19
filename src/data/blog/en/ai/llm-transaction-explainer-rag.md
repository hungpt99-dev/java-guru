---
title: "Designing a Reliable Transaction Explainer with LLM and RAG"
description: "A practical design for explaining customer transactions with retrieval-augmented generation over ledger and transfer events."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["java", "ai", "fintech", "architecture"]
draft: false
featured: false
---

Repo: <https://github.com/finpay-lab/customer-service>

## Problem

When a customer asks, “Where did this charge come from?”, they need a precise, evidence-backed answer rather than a generic chatbot reply. The answer may require correlating a balance mutation with the lifecycle of a transfer, then translating technical records into customer language.

This is a reference design for FinPay, not a report of a deployed production system.

The supplied project description names two Kafka topics, `finpay.ledger` and `finpay.transfer`, keyed by `customerId`:

- `finpay.ledger` contains debits, credits, fees, and refunds.
- `finpay.transfer` contains lifecycle events such as `CREATED`, `SETTLED`, `FAILED`, and `REFUNDED`.

Kafka is useful as a replay source, but the database remains the system of record for a customer-visible transaction view. OpenSearch can be a read model for retrieval, not the authority for money.

## Why Hard

The evidence is split across streams, arrives out of order, and may be corrected by later events. The same customer can have several transactions with similar amounts and timestamps. A shared `customerId` key helps organize data; it does not prove that two records belong to the same transaction or authorize access to them.

Raw events can contain PII, internal identifiers, routing data, or implementation details. An LLM can also produce fluent text without evidence, confuse two similar events, or turn an uncertain status into a confident claim. We therefore need a deterministic path around a probabilistic component.

## Naive Design

The first idea is to load all history and put its internal JSON in a prompt.

```java
// WRONG: unbounded history and internal fields enter the prompt
List<JsonNode> events = ledgerRepo.findAllForCustomer(customerId);
events.addAll(transferRepo.findAllForCustomer(customerId));
String prompt = "Explain this transaction:\n" + events;
return llm.complete(prompt);
```

Another tempting implementation writes a generated explanation whenever a request arrives:

```java
// WRONG: exists() is only a pre-check
if (!explanationRepo.exists(transactionId)) {
    explanationRepo.insert(transactionId, llm.complete(prompt));
}
```

The correction is to make the database claim atomic and keep publication separate:

```java
// RIGHT: unique(transaction_id, explanation_version) arbitrates the race
Explanation result = explanationRepo.insertIfAbsent(
        transactionId, explanationVersion, explanation);
outbox.enqueueIfAbsent(result.id(), "EXPLANATION_READY");
```

## Why It Breaks

Unbounded prompts exceed context limits, increase latency and cost, and may retrieve the wrong time period. Internal fields can leak. Retries and concurrent requests pass `exists()` at the same time, causing duplicate rows or duplicate notifications. A timeout after the model responds but before the write commits creates ambiguity. A model outage, rate limit, malformed output, stale index, or prompt injection in an event can turn a convenient path into an unsafe one.

The model must not decide balances, refunds, eligibility, or any other money operation. The reliable boundary is:

```text
retrieved evidence -> AI signal -> deterministic policy -> business decision
```

## Hard Problems

**Correlation and ordering.** Prefer an authoritative `transaction_id` or source correlation ID. Use event type, timestamps, amounts, and account scope only as defined correlation rules, and mark ambiguous matches as unresolved. Consume Kafka with replay support and tolerate late events; do not infer finality from arrival order.

**Idempotency.** Idempotent storage is not idempotent side effects. A unique constraint on `(transaction_id, explanation_version)` plus an atomic insert prevents duplicate records. For a distributed request key, `SETNX` with an expiry or an idempotency-key table can claim work. An outbox records a committed decision before publishing a notification; an inbox deduplicates consumed message IDs. A retry can safely re-read the stored result, but an email or webhook still needs its own idempotency key.

**AI uncertainty.** The model may return false positives, false negatives, unsupported explanations, or nondeterministic wording. Store model, prompt, and policy versions. Validate structured output, require cited evidence IDs, constrain the prompt to supplied evidence, and use a confidence or coverage signal only as an input to policy. If evidence is missing or the signal is below threshold, return a factual template or route to support.

**Operational boundaries.** Enforce request deadlines, bounded retries with jitter, circuit breaking, provider rate limits, and a queue for asynchronous generation. Do not retry non-idempotent side effects blindly. A fallback must say that an explanation is unavailable or pending; it must never invent one.

## Trade-offs

Synchronous generation gives a simple user experience but couples request latency to the model. Asynchronous generation improves resilience and cost control but requires a pending state and notification or polling. OpenSearch provides flexible, low-latency retrieval but is eventually consistent and must be rebuilt from Kafka or the database. Direct database queries are authoritative but can be slower and less suitable for full-text retrieval.

RAG reduces context size and grounds the response, but it cannot repair missing or incorrectly correlated source data. A smaller, cheaper model may handle templated explanations; a stronger model may improve language quality while increasing cost and latency. The policy should prefer correctness over fluency.

## Better Design

Ingest ledger and transfer events, validate their schema, and persist normalized records in the database. Build an OpenSearch read model containing only searchable, customer-safe fields. On request, authorize the customer, resolve the transaction from the database, retrieve a bounded evidence set, and redact it before calling the model.

```text
Kafka (replay source) -> normalized DB (system of record) -> OpenSearch (read model)
                                                        \-> bounded evidence
bounded evidence -> LLM signal -> policy -> decision -> DB + outbox
```

The LLM receives a task such as “summarize these evidence records” and returns structured data: a short explanation, referenced `event_id`s, uncertainty, and a suggested status. The policy checks authorization, evidence coverage, status consistency, schema validity, and allowed wording. Only then does the business layer choose `EXPLAIN`, `PENDING`, `UNRESOLVED`, or `ESCALATE`. It does not let model output mutate money.

Persist an audit record containing at least `transaction_id`, `event_id` (or the set of cited IDs), `model_version`, `prompt_version`, `policy_version`, `decision`, and `reason`. Store request and idempotency keys, timestamps, and source revisions where needed. Keep raw sensitive payloads out of prompts and logs.

## Failure Scenarios

- **Duplicate delivery or concurrent requests:** unique insert, inbox, and idempotency key return one result; notification delivery uses a separate outbox key.
- **Model timeout, outage, or rate limit:** bounded retry where safe, then `PENDING` or a deterministic explanation from verified fields.
- **Late or contradictory events:** mark the read model stale, reprocess from Kafka, and show an unresolved status rather than selecting a convenient record.
- **OpenSearch outage or stale index:** query the database for the transaction and evidence, or fail closed with a pending response.
- **Prompt injection or malicious text in an event:** treat event content as data, use a strict prompt contract, redact fields, and reject output that requests tools or unsupported actions.
- **Partial commit after a response:** the outbox and idempotent consumer make publication retryable; reconciliation detects records missing either side.

## Capacity

Estimate each stage separately. The basic relationship is:

```text
Concurrency = Throughput x Latency
```

For example, 20 requests/second at a 2-second model latency requires about 40 in-flight model calls before headroom. If one request retrieves 30 events at 2 KB each, retrieval transfers about `20 x 30 x 2 KB = 1.2 MB/s` before indexes and replicas. Size Kafka partitions for peak event rate and replay time, database writes for normalized events, OpenSearch shards for the read model, and the model queue for provider quotas. Apply per-customer and global rate limits, bounded evidence size, backpressure, and autoscaling. Capacity estimates are design inputs, not production claims.

## Security/Privacy

Authorize by authenticated customer and transaction ownership before retrieval. Enforce tenant/account boundaries in every query; `customerId` as a Kafka key is not authorization. Minimize data sent to the model: use transaction and event references, coarse timestamps, currency, amount, status, and approved descriptions. Do not casually send full transactions, account numbers, addresses, tokens, or raw counterparty data to an external AI provider.

Encrypt data in transit and at rest, restrict operator access, define retention and deletion rules, and redact PII from prompts, traces, and application logs. Treat model and prompt providers as data processors only under an approved privacy and retention contract. Log access and audit decisions without putting `account_id` or raw PII into metric labels.

## Observability

System metrics should include request rate, latency by stage, timeout and retry counts, queue depth, Kafka consumer lag, database errors, OpenSearch freshness, provider rate-limit responses, token usage, and cost. Business metrics should include the percentage of requests resolved, pending, unresolved, escalated, and rejected for insufficient evidence, plus disagreement or correction rates.

Do not use `transaction_id`, `customerId`, or `account_id` as Prometheus labels: their cardinality is unbounded and they may contain sensitive information. Put a correlation ID in sampled traces and protected logs instead. Every decision should be traceable to its evidence and versions: `transaction_id`, `event_id`, `model_version`, `prompt_version`, `policy_version`, `decision`, and `reason`.

## Lessons

- Start with the customer-visible correctness problem; choose components only after identifying the evidence and failure boundaries.
- Treat Kafka as replayable input, the database as the system of record, and OpenSearch as a rebuildable read model.
- Keep AI output as a signal. A deterministic policy makes the business decision.
- `exists()` is not idempotency; use atomic uniqueness and make every side effect independently retry-safe.
- Bound latency, cost, context, retries, and data exposure, then measure both business outcomes and system health.
