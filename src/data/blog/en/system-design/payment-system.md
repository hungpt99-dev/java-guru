---
title: "Designing a Payment System Around a Double-Entry Ledger"
description: "A strongly consistent design for charges, refunds, payouts, disputes, and auditable money movement."
pubDatetime: 2026-08-15T10:00:00+07:00
tags: ["system-design", "architecture"]
draft: false
featured: false
---

## 1. Problem and scope

We need a payment platform for merchants and customers. It accepts card and bank-payment intents, records what the platform owes each party, refunds captured charges, pays merchants, and tracks disputes. The merchant portal and internal operations team need a durable history that can explain every amount without relying on mutable balance fields.

This article covers the command API, idempotency, a double-entry ledger, provider integration, reconciliation, and the main consistency and failure-handling decisions. The numerical capacity model is a labeled sizing assumption, not a statement about a real system.

### Requirements

The functional requirements are:

- Create and capture a charge, including the provider authorization reference.
- Refund all or part of a captured charge.
- Create and execute a payout from a merchant payable balance.
- Make every client command idempotent, including a retry after the client loses the response.
- Post every money movement as balanced double-entry journal lines.
- Reconcile internal records with provider reports and bank statements.
- Freeze or reverse funds when a card dispute arrives, with an auditable case.

The non-functional requirements are stricter than ordinary CRUD:

- From the ledger's perspective, an accepted command has exactly one business effect. The system must not post it twice.
- Ledger commits use strong consistency.
- Journal history is append-only and tamper-evident.
- Payment details are tokenized by a hosted provider to reduce PCI scope.
- **[SOURCE FACT]** The target is 99.99% monthly availability for ledger commands, p99 command latency below 400 ms when the provider responds, and zero unbalanced journal transactions.

“Exactly once” describes the ledger invariant, not network delivery. Requests and provider calls can be delivered at least once. A unique command key, an immutable transaction, provider idempotency keys, and reconciliation together prevent duplicate financial effects and resolve outcomes that were initially ambiguous.

## 2. Capacity model

**[ASSUMPTION]** The following figures are illustrative sizing assumptions:

- 200,000 daily active customers and merchants combined.
- Each active user creates or checks out with 2 payment-related commands per day.
- Ten times the average shopping traffic is used as the modeled peak.
- Capacity is provisioned for 100 command requests per second to leave room for retries and a promotion.
- A charge creates 1 payment row, 1 ledger transaction, and 4 journal lines on average. A refund or payout creates approximately 4 lines.
- The model uses 500,000 ledger transactions per day.

The arithmetic is:

- `200,000 x 2 = 400,000 commands/day`.
- `400,000 / 86,400 = 4.63 average requests/second`.
- A ten-times peak is 46.3 requests/second; the 100 requests/second provision is the planning capacity.
- `500,000 x 4 = 2,000,000 journal-line writes/day`, or 23 lines/second on average and 230 lines/second at the modeled peak.

**[ANALYSIS]** The model reserves 25% more commands than customer actions for merchant automation. Reads are modeled at an 8:1 ratio over writes because dashboards, receipts, and reconciliation queries repeatedly read history. At the planning peak, that is approximately 800 read requests/second if every read reaches the service.

**[ASSUMPTION]** A payment or journal-line row, including indexes and metadata, averages 700 bytes:

- `2,000,000 x 700 bytes x 7 years = 3.58 TB` of primary journal-line data before replicas, WAL, and headroom.
- `400,000 x 500 bytes x 7 years = 0.51 TB` for 1 payment row per command.
- Applying a 2x factor for replicas, WAL, and headroom gives approximately 8.2 TB of database storage.
- Provider events and audit records add approximately 1 TB over 7 years.

At 100 commands/second with 3 KB requests, peak ingress is 2.4 Mb/s. At 800 reads/second with 10 KB responses, peak egress is 64 Mb/s. These figures exclude provider webhooks and exports; the sizing assumption therefore calls for at least 1 Gb/s per production zone.

**[ASSUMPTION]** Growth is modeled at 30% year over year. Under that assumption, year-three volume is `400,000 x 1.3^3 = 878,800/day`; a ten-times peak is approximately 102 commands/second after rounding. **[SOURCE FACT]** The stated SLOs are 99.99% monthly availability, about 4.38 minutes of unavailable time, p99 below 400 ms for local acceptance, and reconciliation completion within 30 minutes of receiving a provider file.

## 3. API design

All endpoints use TLS and OAuth2 authorization for users or services. `Idempotency-Key` is mandatory on commands and is scoped to the merchant and endpoint. The server stores the request hash, status, response body, and resource ID for 30 days. Reusing a key with a different request body returns `409`.

The examples use illustrative identifiers and amounts.

### Create and capture a charge

```http
POST /v1/charges
Authorization: Bearer <token>
Idempotency-Key: ch_merchant_20260815_001
Content-Type: application/json

{"amount":12500,"currency":"USD","merchant_id":"m_42","payment_method_token":"pm_tok_9","capture":true}
```

```json
{"id":"ch_901","status":"succeeded","amount":12500,"currency":"USD","ledger_transaction_id":"ltx_7001","provider_payment_id":"pp_88"}
```

The amount is an integer in the currency's minor unit. The service validates merchant ownership, currency, and tokenization. It records the local effect only after the provider result has been safely correlated. If a timeout leaves the provider outcome unknown, the service returns `202` with `status: "pending"`; the client polls `GET /v1/charges/{id}`.

### Refund

```http
POST /v1/charges/ch_901/refunds
Idempotency-Key: rf_merchant_20260815_001
Content-Type: application/json

{"amount":3000,"reason":"customer_request"}
```

```json
{"id":"rf_301","status":"succeeded","amount":3000,"charge_id":"ch_901","ledger_transaction_id":"ltx_7010"}
```

The service verifies that the charge was captured, that the cumulative refund does not exceed the captured amount, and that the command key has not already produced a refund.

### Payout

```http
POST /v1/merchants/m_42/payouts
Idempotency-Key: po_merchant_20260815_001
Content-Type: application/json

{"amount":8000,"currency":"USD","destination_token":"bank_tok_2"}
```

```json
{"id":"po_501","status":"processing","amount":8000,"currency":"USD","ledger_transaction_id":"ltx_7020"}
```

Payout authorization checks the available balance and a risk or velocity limit in the same database transaction. Provider execution can remain `processing`; a webhook or settlement file changes the state to `paid` or `failed`.

Other endpoints include `GET /v1/ledger/accounts/{id}/entries?cursor=...`, `POST /v1/provider-events` for signed webhook ingestion, `POST /v1/reconciliation/runs`, and `POST /v1/disputes/{id}/accept` or `/contest`. Webhook ingestion verifies the provider signature and deduplicates by provider event ID.

## 4. Data model

The following PostgreSQL-style schema shows the critical invariants. Amounts are integers in minor units; floating-point values are not used for money.

```sql
CREATE TABLE idempotency_keys (
  merchant_id bigint NOT NULL,
  endpoint text NOT NULL,
  idem_key text NOT NULL,
  request_hash bytea NOT NULL,
  status text NOT NULL,
  response_json jsonb,
  resource_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, endpoint, idem_key)
);

CREATE TABLE ledger_accounts (
  account_id bigint PRIMARY KEY,
  owner_type text NOT NULL,
  owner_id bigint NOT NULL,
  currency char(3) NOT NULL,
  account_type text NOT NULL,
  UNIQUE (owner_type, owner_id, currency, account_type)
);

CREATE TABLE ledger_transactions (
  transaction_id bigint PRIMARY KEY,
  command_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_lines (
  line_id bigint PRIMARY KEY,
  transaction_id bigint NOT NULL REFERENCES ledger_transactions,
  account_id bigint NOT NULL REFERENCES ledger_accounts,
  amount_minor bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**[PROPOSED DESIGN]** The database transaction inserts the business record, idempotency record, ledger transaction, and its lines together. A deferred constraint or transaction-time check must enforce that debits equal credits for each transaction. The unique `command_id` prevents a second ledger transaction for the same accepted command. Available-balance checks use a row lock on the relevant account or a serializable transaction; the choice is an implementation decision, not a claim about a particular database deployment.

**[PROPOSED DESIGN]** Balances may be maintained as projections for fast reads, but they are not the source of truth. Rebuilding a balance from journal lines must produce the same result. Journal rows are never updated or deleted by the business path. An audit record can store the actor, request hash, provider reference, and reason for operational actions.

## 5. Ledger postings

**[PROPOSED DESIGN]** Each business event maps to balanced postings. The account names below are not a description of an existing company system.

- A captured charge debits a provider-clearing or cash account and credits the merchant payable account, with fee lines where applicable.
- A refund debits the merchant payable account and credits the provider-clearing or cash account.
- A payout debits the merchant payable account and credits a payout-in-transit account. Settlement later moves the amount from transit to cash or records a failure reversal.
- A dispute debits the merchant payable or dispute-reserve account and credits a dispute or provider-receivable account. A favorable resolution posts a compensating transaction.

The exact accounts and fee treatment depend on the business contract and provider settlement model. The invariant is simpler: every committed transaction has at least one debit and one credit, all in the same currency, and the signed amounts sum to zero.

## 6. Provider calls and failure handling

**[PROPOSED DESIGN]** Do not hold a database transaction open while waiting on a provider. A command first creates a local pending record, then an asynchronous worker performs the provider call. The worker sends the same provider idempotency key on retries and stores the provider request and response references.

If the provider responds successfully, the worker posts the ledger transaction and marks the resource succeeded in one local database transaction. If the call times out, the result is unknown: retry with the same provider key, query the provider if supported, and wait for a webhook or reconciliation file. Do not assume timeout means failure.

Timeouts need bounded retries with backoff and jitter. A circuit breaker can stop new provider calls during a sustained failure, while a queue provides backpressure (giới hạn tốc độ nhận việc để hệ thống không bị quá tải). These controls protect the service; they do not decide the financial outcome. A dead-letter queue is appropriate for messages that need manual investigation, but replay must remain idempotent.

The API should expose `pending` rather than manufacture a success or failure when the provider result is unknown. Clients can poll or consume a resource event. The provider webhook endpoint must authenticate signatures, persist the raw event before processing, deduplicate event IDs, and tolerate out-of-order delivery.

## 7. Reconciliation and disputes

**[PROPOSED DESIGN]** Reconciliation compares internal charges, refunds, payouts, fees, and provider events with provider reports and bank statements. It should produce explicit matched, missing-internal, missing-provider, amount-mismatch, and status-mismatch records. A mismatch becomes an operational case; it is not silently repaired by changing a balance.

The reconciliation job is safe to rerun. It records the source file or event identifier, comparison version, timestamps, and the journal transaction used for any correction. Corrections are compensating ledger transactions, never edits to historical lines.

A dispute is a case with its own status, evidence, deadlines, provider reference, and linked ledger transactions. **[PROPOSED DESIGN]** Reserve or reverse the disputed amount, notify operations, and post a compensating transaction when the case is resolved. The case state and ledger posting must be linked, so an operator cannot mark the case resolved without an auditable financial effect.

## 8. Consistency boundaries and operations

**[ANALYSIS]** The local database is the consistency boundary for the business record, idempotency key, and ledger posting. The provider is an external system with separate state. The two systems cannot be made one atomic transaction without a distributed transaction, so the design uses a state machine, idempotent provider operations, webhooks, and reconciliation.

Metrics should distinguish local acceptance latency from provider completion latency. Useful signals include pending age, retry count, provider error rate, webhook lag, reconciliation mismatches, ledger-balance violations, and payout failures. Alerts should be tied to the stated SLOs and to financial invariants, not only to HTTP error rate.

The resulting design does not promise that every network call succeeds immediately. It makes uncertainty visible, prevents duplicate postings, keeps the ledger auditable, and gives operations a controlled path to resolve provider disagreement.
