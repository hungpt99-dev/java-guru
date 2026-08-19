---
title: "Designing an LLM Service for Distributed Trace Summaries"
description: "A practical design for turning an OpenTelemetry traceId into a bounded, auditable incident summary without giving an LLM authority over financial actions."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: [java, ai, fintech, architecture]
draft: false
featured: false
---

An LLM can make a distributed trace easier to read, but it does not make the trace more trustworthy. The engineering problem is to reduce a large set of spans to useful context while preserving evidence, controlling cost and latency, and keeping the model outside the financial decision path.

This article presents an illustrative Spring Boot design for `trace-summarization-llm`. It covers the boundary between domain code and provider-specific code, span selection, prompt construction, resilience, secret handling, idempotency, and auditability. The code and component names are a proposed design, not a claim about a particular company's production system.

## Scope and guarantees

> **[SOURCE FACT]** The input is an OpenTelemetry `traceId`, and the desired output is a human-readable explanation of the trace: what happened, which operation was slow, where an error occurred, and which operations were retried.

> **[ANALYSIS]** A trace summary is an observability aid. It is not a source of truth and must not authorize a refund, release, reversal, or any other financial action. Those decisions require deterministic business rules and an appropriate control path.

> **[PROPOSED DESIGN]** Before implementing the model adapter, define these guarantees:

1. **No financial authority.** The model may describe observed evidence and state uncertainty. It must not return an operational decision that the application treats as authoritative.
2. **Idempotency by `eventId`.** Producers and consumers commonly operate with at-least-once delivery. The consumer therefore records the event before performing work that must not be repeated. Exactly-once business behavior is an application-level outcome, not a property to assume from the broker.
3. **Timeout, retry, and circuit breaker.** A model provider is an external dependency. A timeout limits how long a call occupies resources; a retry handles selected transient failures; a circuit breaker stops sending traffic while the dependency is unhealthy.
4. **Bring your own key (BYOK).** A customer supplies the provider credential. The service uses a secret-manager reference and never hardcodes or logs the credential.
5. **Auditability.** Store the input identity, selected evidence, prompt and provider result according to the applicable retention and privacy policy. Redact sensitive data before it enters prompts or logs. Human review and correction should also be recorded.

These guarantees distinguish a summarizer from an autonomous agent. They also make the design testable without a live model provider.

## The tempting implementation

The following example is intentionally wrong. It illustrates the failure modes that appear when provider integration, domain behavior, and logging are placed in one class.

```java
// WRONG: illustrative anti-pattern; do not ship
@Service
public class TraceSummarizer {
    private static final String API_KEY = "redacted"; // secret in source
    private final RestTemplate rest = new RestTemplate();
    private final SpanRepo spans;

    public String summarize(String traceId) {
        List<Span> all = spans.findAllByTraceId(traceId); // unbounded input
        String prompt = "Summarize this trace:\n" + all
            + "\nDecide if the user should be refunded.";
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(API_KEY);
        return rest.postForObject("https://api.llm.example/v1/chat",
            new HttpEntity<>(prompt, headers), String.class);
    }
}
```

The problems are concrete:

- **Secret exposure:** a credential in source can reach Git history, build artifacts, dumps, or logs. BYOK is not meaningful if the credential is a compile-time constant.
- **Unbounded context:** loading every span can exceed the model context window, increase token usage, and hide the relevant evidence. The repository query needs explicit limits and a selection strategy.
- **Authority in the prompt:** asking the model whether to refund turns a probabilistic text generator into an accidental financial control.
- **Prompt injection:** span attributes may be written by an attacker or by an untrusted upstream system. An attribute containing an instruction must remain data, not become a higher-priority instruction.
- **Missing resilience:** without connect and response timeouts, the HTTP call can occupy a consumer indefinitely. Retrying every failure can amplify an outage, so retries need bounded attempts and failure classification.
- **Sensitive logging:** the raw response may repeat prompt data or personally identifiable information (PII). It should not be written to ordinary application logs.
- **Infrastructure leakage:** the domain logic is coupled to `RestTemplate`, HTTP headers, the endpoint, and the wire format. Tests need a network mock, and changing providers requires changing business code.

## Proposed architecture

> **[PROPOSED DESIGN]** Use a hexagonal architecture. The domain defines the use cases and ports; adapters implement Kafka, the span store, the LLM client, secret retrieval, resilience, and audit persistence.

```text
trace-summarization-llm/
├── domain/
│   ├── model/TraceId.java, EventId.java, Span.java, TraceSummary.java
│   ├── port/in/SummarizeTraceUseCase.java
│   ├── port/in/HandleTraceEventUseCase.java
│   ├── port/out/SpanRepository.java, SummaryStore.java
│   ├── port/out/LlmPort.java, AuditLog.java
│   └── service/TraceSummarizerService.java, TraceEventProcessor.java
├── infrastructure/
│   ├── kafka/TraceEventConsumer.java
│   ├── opensearch/SpanOpenSearchRepository.java, SummaryOpenSearchStore.java
│   ├── llm/LlmAdapter.java, LlmRequest.java, LlmConfig.java
│   ├── resilience/ResilienceConfig.java
│   ├── secrets/SecretManager.java
│   └── audit/AuditLogAdapter.java
└── application/
    ├── TraceSummarizationApplication.java
    └── config/AppConfig.java
```

The domain port does not know which provider is used:

```java
public interface LlmPort {
    LlmResult complete(LlmRequest request);
}
```

The application service can now be tested with a fake `LlmPort`. The adapter owns request serialization, authentication, provider-specific error mapping, and the resilience policy.

## Select evidence before calling the model

> **[ANALYSIS]** The trace store should not be treated as a prompt builder. A useful summary starts with a bounded evidence set.

> **[PROPOSED DESIGN]** The repository query should select spans using an explicit policy, for example:

- retain the root span and its direct causal path;
- retain spans with error status, exception events, or failed downstream calls;
- retain slow spans according to a configured service policy rather than an arbitrary global claim;
- retain retry attempts and their outcome;
- retain timestamps, duration, service, operation, status, and carefully selected attributes;
- drop or redact secrets, tokens, payment data, and unnecessary PII;
- impose limits on span count, attribute size, and total serialized input.

The selector should return structured evidence, not a preformatted paragraph. The prompt builder can then mark the evidence as untrusted data and request a fixed output shape such as:

```text
Summary:
Evidence:
Uncertainty:
```

The model must not be asked to infer facts that are absent from the selected spans. A summary should link statements to span identifiers where the user interface supports that, so an operator can inspect the source evidence.

## Provider boundary and resilience

The LLM adapter should receive a typed request containing the selected evidence, an instruction that the evidence is untrusted, and the requested output schema. It should return a typed result or a typed failure. Provider JSON, HTTP status codes, and authentication headers should remain inside the adapter.

Apply resilience at that boundary:

- set connect, response, and total operation timeouts;
- retry only failures classified as transient, with bounded attempts and backoff;
- do not retry validation errors, authentication failures, or prompt-size failures;
- open the circuit after a configured failure policy is reached;
- return a safe fallback when summarization is unavailable: show the selected structured evidence and mark the summary as unavailable;
- apply backpressure (limiting work accepted by the consumer) so provider slowness does not exhaust threads, memory, or connections.

The fallback is not a fabricated explanation. It is an explicit degraded mode that lets an operator inspect the trace without treating generated text as evidence.

## Idempotency and audit

The event consumer should pass an `eventId` and `traceId` to the domain service. Before invoking the provider, it should perform an atomic idempotency check or use a unique constraint in the summary store. The stored state should distinguish at least `PROCESSING`, `COMPLETED`, and `FAILED` outcomes, with a retry policy for recoverable failures.

Do not claim that a distributed workflow is exactly-once merely because a message broker or database offers a transaction. The useful guarantee is that repeated delivery of the same `eventId` does not create multiple effective summaries or duplicate side effects. This needs a failure-mode test around crashes between the provider call and the store update.

Audit records should include correlation identifiers, configuration or model version, redaction status, selected evidence identifiers, result status, and human corrections. Store prompt and response content only when the privacy policy permits it; otherwise store hashes, references, or a redacted representation. Keep credentials, raw authorization headers, and unnecessary trace payloads out of the audit record.

## Testing the boundary

Test the domain without Spring or a network connection:

- a trace with an error selects the error path and produces no financial action;
- untrusted span text is rendered as data and cannot alter the requested task;
- repeated `eventId` delivery is idempotent;
- provider timeout, transient failure, permanent failure, and circuit-open states map to the expected fallback;
- sensitive attributes are redacted before request construction and logging;
- malformed provider output is rejected rather than silently treated as a decision.

Adapter tests should separately verify HTTP serialization, secret-manager lookup, timeout configuration, provider error mapping, and audit persistence. Contract tests can verify that a provider adapter satisfies `LlmPort` without putting provider details into the domain.

## Closing view

An LLM trace summarizer is best implemented as a bounded, read-only interpretation layer. The trace store remains the evidence source, deterministic services remain responsible for financial actions, and the model is isolated behind typed ports, redaction, resilience, idempotency, and audit controls.

That separation is the main design decision. The generated paragraph is only one presentation of the trace; it must never become the system of record or the control that moves money.
