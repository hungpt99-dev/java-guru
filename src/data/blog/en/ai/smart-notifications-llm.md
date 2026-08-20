---
title: "Designing Safe LLM-Assisted Payment Notifications"
description: "A practical design for using an LLM to write notification copy without letting it change payment facts, block delivery, or leak credentials."
pubDatetime: 2026-08-15T10:00:00+07:00
tags:
  - java
  - ai
  - fintech
  - architecture
draft: false
featured: false
---

## The Incident That Changed the Design

FinPay's payment core already has the hard part of a payment system: it validates a payment, advances the payment state machine, and records the authoritative result in the ledger. Notification eligibility is also a domain decision. If a payment completes, a receipt may be required; if a payment is rejected, the customer may need an exact failure message.

The proposed AI feature sounds harmless. Let an LLM make those messages clearer and more natural.

Then consider a completed payment whose canonical event contains `2,431,876 VND`. The model writes, “Your payment of about 2.4M VND was completed.” That is not merely a style problem. The system has changed a financial fact. A different draft could omit a required fraud alert, copy a recipient from attacker-controlled text, or describe a failed payment as successful.

That gives us the central design question: **where may an unreliable language service participate, and where must deterministic FinPay code remain in control?**

The answer is deliberately narrow:

```text
canonical payment facts -> AI draft -> claim validator -> domain policy -> delivery
                                          (untrusted)       (authority)
```

The LLM may suggest language. It cannot authorize a notification, alter payment state, mutate the ledger, or decide an irreversible send. This is a proposed production-oriented design, not a claim about a deployed FinPay system. Capacity figures below are illustrative assumptions.

## Start With the Smallest Possible Change

The first implementation often looks like this:

```java
// WRONG: deliberately unsafe; do not ship
public String copyFor(NotificationEvent event) {
    return llm.complete("Write a friendly notification: " + event.rawPayload());
}
```

It appears to add only one dependency. In practice, it smuggles three decisions into one string:

- The model sees the raw event, including fields it does not need, PII, and possibly merchant-controlled instructions.
- The caller cannot tell which words are payment facts and which are inventions.
- The call has no bounded timeout, output contract, fallback, audit record, or protection against repeated delivery.

Suppose, as an illustrative assumption, that traffic reaches 200 notifications per second and the provider takes 4 seconds to respond. Little's Law gives roughly `200 x 4 = 800` model calls in flight before retries. Adding threads increases local pressure on connection pools without increasing provider capacity. If the consumer waits synchronously, model latency now delays notification processing; if it runs on the payment request, the external provider is coupled to money movement.

The more dangerous race appears after generation. A worker can generate copy, call the delivery provider, time out while the provider is accepting the request, and retry. A database `exists()` check cannot prove whether the first external send happened. The result can be two customer messages even though the payment event was processed once.

So the problem is not “how do we prompt better?” It is how to keep an advisory component away from facts and irreversible side effects while accepting duplicate events and uncertain providers.

## Constraints Before Infrastructure

The constraints determine the design more reliably than a preferred technology stack:

1. The ledger and payment state machine are the source of truth. AI cannot mutate balance, authorization, settlement, or ledger state.
2. AI downtime must not block a required notification. A required alert can use a deterministic template; an optional message can be deferred or suppressed according to policy.
3. The prompt receives a minimal canonical fact object. The model must not infer amount, currency, status, recipient, or payment ID from prose.
4. Event processing must tolerate at-least-once delivery. The external SEND side effect needs a separate idempotency strategy.
5. A reviewer must reconstruct which facts, versions, policy decision, and provider outcome produced a notification.
6. Provider work needs deadlines, bounded retries, per-tenant isolation, concurrency limits, and a cost budget.

These constraints do not require Kafka, a search cluster, or an LLM. They require durable state, an authority boundary, and explicit behavior when a dependency fails.

## Alternatives: Where Should Generation Happen?

**Synchronous generation on the payment request** gives immediate copy and a simple control flow. It also spends the payment latency budget on a non-authoritative provider. A model timeout can make a successful payment request fail, or force the payment service to carry work that does not affect the ledger. That is unacceptable for a required notification path.

**Synchronous generation in the notification consumer** removes the dependency from payment authorization but still holds a worker while waiting for the provider. It can be adequate at low volume with strict deadlines, but a provider slowdown turns directly into consumer backlog and connection pressure.

**Asynchronous generation after durable notification intent** adds eventual delivery and more state, but isolates payment latency and makes pending, fallback, and uncertain delivery explicit. It also allows the system to prioritize required work over optional copy.

We choose the asynchronous boundary because notification wording is useful but not authoritative. The payment transition must finish independently. This is a trade-off, not a universal rule: a user-facing preview can reasonably be synchronous when the caller accepts stale or unavailable copy.

## The Authority Boundary

The event is first mapped to a domain-owned object rather than passed through unchanged:

```text
PaymentFacts {
  paymentId, amount, currency, status, recipient, requiredReason
}
```

The LLM receives only the minimal view and must return structured output:

```json
{
  "title": "Payment completed",
  "body": "Your payment of 2,431,876 VND was completed.",
  "tone": "concise",
  "claims": ["amount=2431876", "currency=VND", "status=COMPLETED"]
}
```

Structured output is not trusted output. A schema validator checks types and required fields. A claim validator checks every declared claim against `PaymentFacts`. Channel policy checks length, encoding, locale, and links. The system never extracts payment facts back from the prose. If the body says a different amount, the draft is rejected even when the JSON is valid.

The stricter boundary creates a new failure: harmless but awkward drafts are rejected, so template fallback increases. We accept that cost because a false financial statement is worse than less personalized wording. Rejections are measured by reason so prompts and templates can improve without weakening validation.

```java
// RIGHT: facts and delivery authority stay outside the model
NotificationDecision decide(PaymentFacts facts, Policy policy) {
    AiDraft draft = policy.aiEnabled()
        ? llm.generate(facts.minimalView(), policy.promptVersion(), policy.deadline())
        : null;
    ValidatedCopy copy = policy.validateOrFallback(draft, facts);
    return policy.authorize(facts, copy); // send, suppress, or retry
}
```

`authorize` is deterministic. It applies payment status, notification purpose, recipient consent, legal requirements, and channel availability. A persuasive draft cannot enable a prohibited message. AI failure cannot prevent a required alert from using its safe template.

## The New Failure: Async Work Can Still Duplicate a Send

The asynchronous design needs a durable notification intent after the payment state transition:

```text
Kafka event -> consumer -> inbox/unique insert -> fact mapper
                                      |
                         policy -> LLM adapter (optional)
                                      |
                         validator -> template fallback
                                      |
                         outbox -> delivery adapter -> provider
                                      |
                         audit + OpenSearch read model
```

Every box has a reason. The event carries work across process boundaries; the inbox makes event handling idempotent; the fact mapper creates the authority boundary; the optional adapter isolates the unreliable provider; validation and fallback protect content; the outbox makes delivery work durable; audit explains the decision; OpenSearch supports investigation without becoming a source of truth.

At-least-once consumption is chosen because silently losing a required notification is worse than reprocessing it. The inbox uses an atomic unique insert on `(tenant_id, payment_id, purpose, channel)`, and the consumer acknowledges only after the durable record commits. The database is the notification-state record; Kafka is useful for transport and replay; the search index is only a read model.

That solves duplicate processing, not duplicate external sends. A worker can crash after provider acceptance and before local acknowledgement. The delivery adapter therefore sends a stable key such as `notification/{tenant}/{payment}/{purpose}/{channel}` when the provider supports idempotency. Without provider deduplication, the outcome after a timeout is genuinely uncertain. Record that state and reconcile it; do not blindly retry and call the result “exactly once.”

The outbox also introduces operational work: an outbox row can be published twice, remain stuck, or be delivered while the notification record has changed. Publishing and claiming require version checks and idempotent consumers. Each additional guarantee protects a different boundary; no single inbox or transaction protects the entire chain.

## Provider Failure Is a Capacity Problem

Consider another illustrative incident. At 14:03, model latency rises from 300 ms to 4 seconds. Deadlines expire, bounded retries with jitter begin, and the retry budget is consumed. At 200 notifications per second, backlog grows by about 200 items per second if completed work cannot keep pace. More worker threads only consume more connections and provider quota.

The LLM adapter therefore needs a short timeout, a global and per-tenant concurrency limit, rate limiting, and a circuit breaker. Retry only selected transient timeouts and 5xx responses. Do not retry malformed output, authentication failures, or policy rejection. Backoff with jitter avoids synchronized retries. When the retry budget is exhausted, required messages use templates and optional messages become deferred.

This is the important degraded-mode choice: fail closed on AI-generated copy, but fall back to deterministic content for required delivery. For a high-risk notification, policy may select step-up or manual review. That is a domain decision, not an exception handler hidden in the LLM client.

The worker must not keep a database transaction open while waiting for the model. Claim work atomically, call the provider outside the transaction, then commit the result with a version check. Size the database connection pool for database work, not for the maximum possible number of model calls.

## Security and Auditability Are Part of the Boundary

The canonical mapper is a privacy boundary. It removes unnecessary account identifiers, free-form descriptions, and internal metadata before an external call. Merchant text remains untrusted input: prompt injection must not override system instructions or policy. Escape output for its channel and allowlist links instead of copying URLs from model text.

Check tenant authorization before creating notification work. A scoped adapter retrieves tenant credentials from a secret manager; credentials never enter prompts, generated content, traces, or ordinary logs. Audit and search access have separate authorization, retention, and deletion rules for generated content and PII.

An audit record should reconstruct a decision without pretending that model output is deterministic. Store `payment_id`, `event_id`, purpose, channel, `model_version`, `prompt_version`, `policy_version`, decision, reason, timestamps, output hash, and provider outcome. Store generated content only when retention and access policy permits. Versioning explains why a later replay may produce different copy.

Before changing a model or prompt, evaluate a versioned set of redacted canonical facts. Check claim accuracy, required-field coverage, channel length, unsafe-link rejection, fallback rate, and cost. Offline quality does not replace runtime validation. Roll out by tenant or channel and keep a fast kill switch that disables AI while deterministic templates continue to work.

## Operational Reality

At 3 AM, an on-call engineer must distinguish Kafka lag from database contention, model failure, and delivery-provider failure. Useful metrics include:

- Consumer lag, processing latency, inbox conflict rate, and outbox age.
- Model latency, timeouts, rate limits, retry attempts, circuit state, token usage, and fallback rate.
- Validation failures by reason, provider latency and errors, uncertain deliveries, and duplicate sends prevented.
- Required notifications sent, template fallbacks, optional notifications deferred, and policy suppressions.

Do not use `payment_id`, `account_id`, `event_id`, or `trace_id` as Prometheus labels. Put identifiers in protected structured logs or trace context. A trace should connect payment work, notification work, AI inference ID, model and prompt versions, policy evaluation, outbox record, and provider call.

The runbook must explain reconciliation for uncertain delivery and the threshold for manual review. It must identify prompt versions when validation failures rise after a change. When backlog grows, pause optional work before required alerts and protect the database connection pool. A dead-letter queue is for poison events needing inspection, not a silent graveyard for required notifications.

## What the Architecture Became

The final design is modest because the problem does not require AI authority:

```text
Payment state machine + ledger
             |
     durable notification intent
             |
     async worker and policy
        /             \
 constrained LLM       deterministic template
        \             /
      claim/channel validation
             |
       outbox + delivery adapter
             |
        external provider
```

Payment state and notification eligibility remain deterministic. The worker optionally asks the LLM for constrained copy, validates it against canonical facts, and falls back when it cannot prove safety. The outbox carries delivery work with a stable idempotency key. Audit records the reasoning; search helps investigation but never becomes the source of truth.

The memorable boundary is not “AI versus templates.” It is authority. The LLM can make a required message clearer, but it cannot make a payment true, authorize a send, or turn an uncertain provider response into a known outcome.

## Lessons for the Larger FinPay System

1. Start at the irreversible side effect. Sending a message needs stronger reasoning than storing a draft.
2. Keep the AI contract narrow: structured output and claim validation, never fact extraction from prose.
3. Inbox idempotency and provider-side send idempotency solve different failures.
4. Make degraded behavior a policy choice. Required alerts use deterministic templates; optional messages may defer or suppress.
5. Version the model, prompt, policy, template, and provider outcome as operational contracts.
6. Let the payment ledger remain authoritative while AI evolves around it as an advisory layer.

<!-- finpay-repo-link -->

## FinPay Reference Implementation

This article is part of the FinPay reference series. The related service implementation lives in the [finpay-lab/notification-service](https://github.com/finpay-lab/notification-service) repository.
