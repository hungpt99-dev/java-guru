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

## The Smallest Useful AI Feature

FinPay already has a payment core. It validates a payment, records the authoritative state in the ledger, and decides which notifications are required. The proposed AI feature is deliberately smaller than an “AI notification platform”: an LLM may draft the words for a notification that the domain has already decided to send.

That distinction matters when a payment event says `2,431,876 VND`, but the model writes “about 2.4M VND.” A human may call that friendly wording. A financial system must call it an unsupported transformation of a fact. The model also must not decide that a fraud alert is unnecessary, change a recipient, or turn a failed payment into a successful one.

The central rule is:

```text
canonical payment facts -> AI draft -> claim validator -> domain policy -> delivery
                                          (untrusted)       (authority)
```

The LLM proposes copy only. Facts and the decision to send belong to deterministic FinPay code.

This is a reference design, not a claim about a deployed FinPay system. Numbers below are illustrative assumptions for capacity reasoning.

## What Failed First

The obvious implementation is attractive because it is tiny:

```java
// WRONG: deliberately unsafe; do not ship
public String copyFor(NotificationEvent event) {
    return llm.complete("Write a friendly notification: " + event.rawPayload());
}
```

It passes the raw event to the model and treats a string as the result. Three contracts are hidden in that one call:

- The model is allowed to see fields that it does not need, including PII or malicious text in a description.
- The caller cannot distinguish a payment fact from an invented sentence.
- There is no timeout, output limit, fallback, audit record, or protection against a repeated send.

The failure is not limited to hallucination. A free-form response can omit a required title, exceed an SMS limit, include an unapproved link, or repeat an instruction embedded in merchant-controlled text. A model provider can also rate-limit or time out. If the event consumer waits indefinitely, its in-flight work grows as `concurrency = throughput x latency`. At an illustrative 200 notifications/second, a 4-second provider response creates 800 in-flight model calls before retries are counted. The consumer, connection pool, and provider quota then fail together.

Finally, a timeout does not prove that the provider did not complete the request. Retrying a generation-and-send operation can therefore produce two external sends. A database check such as `exists()` does not close that race either.

## Constraints Before Components

For this feature, the constraints are more useful than a technology list:

1. The ledger and payment state machine remain the source of truth. The model cannot mutate balance, authorization, settlement, or ledger state.
2. A required notification must still be delivered when AI is unavailable. For an exact fraud alert, policy selects a deterministic template rather than blocking delivery. For a marketing message, policy may suppress or defer it.
3. Generated text must use only a minimal canonical fact object. It must not infer amount, currency, status, recipient, or a payment identifier.
4. Processing must tolerate at-least-once event delivery, while the external SEND side effect needs its own deduplication strategy.
5. A reviewer must be able to reconstruct the decision after a prompt, model, policy, or template changes.
6. Provider calls need bounded latency, bounded retries, tenant isolation, and an explicit cost budget.

These constraints leave room for design choices. They do not justify giving the LLM more authority.

## The Authority Boundary

The first design decision is to split facts from language. The payment event is mapped into a canonical object owned by the domain:

```text
PaymentFacts {
  paymentId, amount, currency, status, recipient, requiredReason
}
```

The model receives a minimal view and returns structured output, for example:

```json
{
  "title": "Payment completed",
  "body": "Your payment of 2,431,876 VND was completed.",
  "tone": "concise",
  "claims": ["amount=2431876", "currency=VND", "status=COMPLETED"]
}
```

The shape does not make the output trustworthy. A schema validator checks types and required fields; a claim validator checks every claim against `PaymentFacts`; channel policy checks length, encoding, links, and locale. The system never parses facts back out of the generated body. If the body says a different amount, validation fails even if the JSON is syntactically correct.

That validation step introduces a new problem: a stricter validator can reject drafts that are merely awkward, increasing fallback volume. That is an acceptable trade-off for financial accuracy. Fallback rate is measured as a product and operational signal, and copy quality can improve without weakening the fact boundary.

The domain then evaluates the result:

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

`authorize` is not an LLM call. It applies deterministic rules to payment status, notification purpose, recipient consent, legal requirements, and channel availability. A confident draft cannot enable a prohibited message. Conversely, AI failure cannot prevent a required alert from using its safe template.

## Async Processing and Its New Failure

Generation does not belong on the payment authorization request. If an illustrative model path takes 400 ms, adding it to a 200 ms payment request consumes the payment latency budget and couples money movement to an external service. Synchronous generation is reasonable only for a non-critical preview where the user explicitly accepts that dependency.

For required notifications, FinPay can persist the notification intent after the payment state transition and process copy generation asynchronously:

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

This isolates payment latency and makes pending, fallback, and uncertain delivery states visible. The cost is durable state and eventual notification delivery. A user may see the payment completed before the message is sent.

At-least-once consumption is chosen because losing a required notification is worse than reprocessing an event. It creates duplicate work, so an inbox record uses an atomic unique insert on `(tenant_id, payment_id, purpose, channel)`. A consumer acknowledges the event only after the durable record is committed. The outbox then publishes delivery work from that record; Kafka is useful for replay, the database is the record of notification state, and OpenSearch is only a searchable read model.

The unique insert protects storage, not the SEND call. Two workers can still reach the provider after a crash between provider acceptance and local acknowledgement. The delivery adapter therefore uses a stable key such as `notification/{tenant}/{payment}/{purpose}/{channel}` when the provider supports idempotency. If it does not, an uncertain result is recorded and reconciled; blindly retrying may send twice. This is the uncomfortable trade-off: without provider deduplication, the system cannot always prove whether a timed-out send happened.

## Provider Failure Is a Capacity Problem

Consider an illustrative incident at 14:03: model latency rises from 300 ms to 4 seconds. The consumer's deadline expires, bounded retries with jitter start, and the retry budget is consumed quickly. If consumption continues at 200 notifications/second, the pending queue grows by roughly 200 items each second that completed work cannot keep up. More threads do not fix the provider; they consume connections and increase pressure.

The adapter needs a per-tenant and global concurrency limit, a rate limiter, a short timeout, and a circuit breaker. Retry only transient errors such as selected timeouts or 5xx responses; do not retry malformed output, authentication failures, or policy rejection. Backoff with jitter prevents all workers from retrying together. Once the budget is exhausted, required messages use the template and optional messages enter a deferred state.

The trade-off is visible: fail-closed for AI quality would protect wording but lose a required alert. FinPay instead fails closed on generated copy and fails open to a deterministic template for required delivery. For a high-risk operation, policy may choose step-up or manual review, but that is a domain decision, not a generic exception handler.

An AI outage should not become a database outage. The notification worker should not hold a database transaction open while waiting for the model. Claim work atomically, call the provider outside the transaction, then commit the result with a version check. Keep connection pools sized for database work rather than the maximum number of model calls.

## Security and Auditability

The canonical fact mapper is also a privacy boundary. It removes unnecessary account identifiers, free-form descriptions, and internal metadata before an external call. Event fields remain untrusted data: prompt injection in a merchant description must not override system instructions or policy. Output is escaped for its channel, and links are allowlisted rather than copied from model text.

Tenant authorization is checked before creating notification work. Tenant provider credentials are fetched by a scoped adapter from a secret manager; they never enter prompts, generated content, traces, or ordinary logs. Audit and search access is authorized separately, with retention and deletion rules for generated content and PII.

An audit record should make a decision reproducible without pretending model output is deterministic. Store `payment_id`, `event_id`, purpose, channel, `model_version`, `prompt_version`, `policy_version`, decision, reason, timestamps, output hash, and provider outcome. Store the actual generated content only when retention and access policy permit it. The versions explain why a later replay may produce a different draft.

Before changing a model or prompt, evaluate a versioned set of redacted canonical facts. Check claim accuracy, required-field coverage, channel length, unsafe-link rejection, fallback rate, and cost. A passing offline score is not permission to bypass runtime validation. Production monitoring should look for drift in rejection and fallback reasons, because a provider model change can alter style or behavior without changing FinPay code. Roll out changes by tenant or channel, with a quick way to disable AI and retain deterministic templates.

## Operational Reality

At 3 AM, an on-call engineer needs to tell whether notifications are late because of Kafka, the database, the model, or the delivery provider. Useful metrics include:

- Consumer lag, notification processing latency, inbox conflict rate, and outbox age.
- Model latency, timeout and rate-limit counts, retry attempts, circuit state, token usage, and fallback rate.
- Validation failures by reason, provider latency, provider errors, uncertain deliveries, and duplicate-send attempts prevented.
- Business counts for required notifications sent, template fallbacks, optional notifications deferred, and policy suppressions.

Do not use `payment_id`, `account_id`, `event_id`, or `trace_id` as Prometheus labels. Put those identifiers in protected structured logs or trace context. A trace should connect the request or payment ID, notification work, AI inference ID, model and prompt versions, policy evaluation, outbox record, and provider call. Alerts should be based on bounded dimensions such as tenant, channel, provider, and status.

When a provider timeout leaves delivery uncertain, the runbook must say how reconciliation works and when manual review is required. When validation failures spike after a prompt change, operators need the prompt version and representative redacted samples. When lag grows, pause optional work before required alerts and protect the database connection pool. A dead-letter queue is for poison events that need inspection, not a place where required notifications disappear silently.

## The Result

The final architecture is intentionally modest. Payment state and notification eligibility stay in FinPay's deterministic domain. An asynchronous worker consumes durable notification intents, optionally asks an LLM for constrained copy, validates claims against canonical facts, and chooses a template when the draft is unavailable or unsafe. An outbox carries work to a delivery adapter with a stable idempotency key. Audit storage records the reasoning, while OpenSearch supports investigation without becoming a source of truth.

The important boundary is not “AI versus templates.” It is authority. The LLM can make a required message clearer, but it cannot make a payment true, authorize a send, or turn an uncertain provider response into a known outcome.

## What This Teaches the Larger FinPay Design

1. Start with the irreversible side effect. A SEND needs stronger guarantees than storing a draft.
2. Keep the AI contract narrow: structured output plus claim validation, never fact extraction from prose.
3. Separate inbox idempotency from provider-side send idempotency; one does not imply the other.
4. Make degraded behavior a policy choice. Required alerts use deterministic templates; optional messages may defer or suppress.
5. Treat model, prompt, policy, template, and provider behavior as versioned operational contracts.
6. Let the payment ledger remain authoritative while AI evolves as an advisory layer around it.
