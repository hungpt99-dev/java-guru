When building an application that uses AI, the popular choice these days is almost always an LLM.

The application sends a prompt:

```text
Context + Instruction
        ↓
       LLM
        ↓
Generated response
```

We use GPT, Claude, Gemini or other models to chat, summarize, generate content, write code, analyze documents...

But there is a rather interesting question:

> **What if the application doesn't need AI to generate text?**

For example, the application only needs AI to answer:

* Which category does this ticket belong to?
* Which team should this request be routed to?
* Is this document related to the case file?
* Is this transaction suspicious?
* Which branch should the workflow take?
* Does this user belong to group A or group B?

In these cases, the application doesn't really need a long answer.

It only needs:

```text
Input
  ↓
Decision
```

This is where the concept of an **AI Decision Model** becomes worth paying attention to.

One of the most notable examples is **Jev**. And if you are looking for an open-source/self-hostable approach for this kind of workload, **Laya** is a project worth looking into.

---

# 1. What is Jev?

Jev is an AI decision model from TypeSafe AI.

The fundamental difference between Jev and an ordinary LLM is the intended use.

An LLM is designed to process and generate language.

For example:

```text
User:
I cannot login to my account.

LLM:
It looks like you're having trouble accessing
your account. Please try resetting your password...
```

While a decision model cares about a different question:

```text
User message
     ↓
Which category?
     ↓
ACCOUNT
```

Instead of asking the model to generate a free-form answer, the application defines a **decision space** up front.

For example:

```text
BILLING
TECHNICAL
ACCOUNT
SALES
```

Then the model picks one outcome from those options.

You can picture it like this:

```text
Input
  ↓
Decision Model
  ↓
┌───────────────┐
│ BILLING       │
│ TECHNICAL     │
│ ACCOUNT       │
│ SALES         │
└───────────────┘
```

The result can contain the decision and a probability, for example:

```json
{
  "decision": "ACCOUNT",
  "probability": 0.94
}
```

This is a rather interesting abstraction for a software system:

> **AI doesn't always need to talk to the user. Sometimes AI only needs to provide a decision to the application.**

---

# 2. Why not use an LLM for this?

This question is entirely reasonable.

We can tell the LLM:

```text
Classify this support ticket.

Possible categories:
- BILLING
- TECHNICAL
- ACCOUNT
- SALES

Return JSON only.
```

And get back:

```json
{
  "category": "ACCOUNT"
}
```

So why do we need a separate decision model?

Not because an LLM can't do it.

An LLM does this very well.

The issue is the **fit between the model and the workload**.

When you use an LLM, the flow is still:

```text
Prompt
   ↓
Understand context
   ↓
Reason
   ↓
Generate tokens
   ↓
Produce JSON
   ↓
Parse response
```

While the application only needs:

```text
Input
  ↓
Classification
  ↓
Result
```

If your workload is mostly classification, routing, scoring or yes/no decisions, a model designed for decision tasks may be a more reasonable approach.

This is not a story about:

> A Decision Model is better than an LLM.

It is about:

> **Choosing the right type of model for the type of workload.**

---

# 3. What is Laya?

Laya follows the same **AI Decision Model** direction.

What makes Laya notable is its **open-source/open-weight and self-hostable** approach.

Instead of the application being completely dependent on an external decision API, developers can deploy the model in their own infrastructure.

Architecturally:

### Hosted approach

```text
Application
     │
     ▼
External AI API
     │
     ▼
Decision
```

### Self-hosted approach

```text
Application
     │
     ▼
Laya Server
     │
     ▼
Decision Model
     │
     ▼
Decision
```

This creates another option for teams that want more control over:

* Data
* Network
* Deployment
* Infrastructure
* Cost
* Model lifecycle

Especially for enterprise applications, being able to run the model inside internal infrastructure is sometimes very important.

---

# 4. How can Laya replace Jev?

This is probably the most important part.

If Jev represents the approach:

> **AI as a Decision API**

then Laya can be seen as another option for the same group of workloads.

For example, an application needs to classify tickets:

```text
Incoming Ticket
       │
       ▼
Decision Model
       │
       ├── BILLING
       ├── ACCOUNT
       ├── TECHNICAL
       └── SALES
```

With Jev, the decision is made through the Jev service.

With Laya, developers can deploy the decision model in their own infrastructure.

However, "replacement" here should not be understood as:

> Laya is a drop-in replacement for Jev in every case.

The two systems may differ in:

* Model
* API
* Performance
* Capability
* Deployment
* Ecosystem

The main point is:

> **If your workload fits the AI Decision Model, Laya may be an option to consider alongside Jev.**

Especially if your requirements also include:

```text
Decision Model
+
Self-hosting
+
Open-source/open-weight
```

then Laya becomes more interesting.

---

# 5. How is Laya different from an LLM?

You can look at it simply like this:

```text
              AI Models
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
      LLM             Decision Model
        │                   │
        ▼                   ▼
Generate content       Make decision
```

An LLM is suited to:

```text
"Write an email."
"Summarize this document."
"Explain this code."
"Generate a report."
"Answer this question."
```

A Decision Model is better suited to:

```text
"Which category?"
"Which route?"
"Yes or No?"
"Which option?"
"What score?"
```

One important point is that **a Decision Model does not necessarily replace an LLM**.

They can be used together.

---

# 6. Combining Laya and an LLM

This is where the interesting architecture shows up in production.

For example, building a Customer Support system.

The user sends:

```text
"I was charged twice for the same transaction."
```

The first step can use Laya:

```text
User Message
      ↓
    Laya
      ↓
    BILLING
```

Then the application routes the request to the billing flow:

```text
BILLING
   ↓
LLM
   ↓
Generate response
```

Architecture:

```text
                  User Message
                       │
                       ▼
                  ┌─────────┐
                  │  Laya   │
                  └────┬────┘
                       │
                       ▼
                  Classification
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
          Billing   Account   Technical
             │
             ▼
            LLM
             │
             ▼
      Generate Response
```

Here each model has a clear responsibility.

**Laya:**

> Where should this request go?

**LLM:**

> Now that we know which flow the request belongs to, generate the response.

This is how AI can become part of the software architecture instead of just being a chatbot called from somewhere.

---

# 7. Another use case: Workflow

Imagine a workflow that processes documents.

```text
Upload Document
       ↓
Extract Information
       ↓
Decision
       ↓
┌───────────────┐
│ APPROVE       │
│ REVIEW        │
│ REJECT        │
└───────────────┘
```

The decision model can play the role of producing a decision signal:

```json
{
  "decision": "REVIEW",
  "probability": 0.81
}
```

Then the business application decides what to do:

```text
probability >= 0.90
        ↓
    automatic flow

0.60 - 0.90
        ↓
    human review

< 0.60
        ↓
      fallback
```

The important point here is:

**AI does not necessarily need the authority to decide the entire workflow.**

AI can just provide a signal.

The business application still controls:

* Business rules
* Authorization
* Validation
* Workflow
* Audit
* Final action

This is a design approach very much worth considering when bringing AI into enterprise systems.

---

# 8. Problems that suit Laya

Laya is especially worth experimenting with on problems that have a relatively clear decision space.

### Classification

```text
Document
   ↓
INVOICE
CONTRACT
ID_DOCUMENT
OTHER
```

### Routing

```text
Request
   ↓
TEAM_A
TEAM_B
TEAM_C
```

### Binary decision

```text
Request
   ↓
YES / NO
```

### Scoring

```text
Input
   ↓
Risk Score
0.0 ───────── 1.0
```

### Workflow decision

```text
Application
      ↓
Decision
      ↓
Next Step
```

### Intent detection

```text
User message
      ↓
LOGIN
PAYMENT
REFUND
ACCOUNT
```

These are all very common operations in a backend system.

---

# 9. Self-hosting: why does it matter?

One of the reasons developers may be interested in Laya is the ability to self-host.

With an external AI service:

```text
Your System
    ↓
Internet
    ↓
AI Provider
```

With a self-hosted model:

```text
Your System
    ↓
Internal Network
    ↓
Laya
    ↓
Model
```

This can suit systems that need strict control over data or infrastructure.

But self-hosting is not free in the operational sense.

You will have to care about:

* CPU/GPU
* Memory
* Deployment
* Monitoring
* Scaling
* Availability
* Model update
* Security
* Operational cost

So the question should not just be:

> "Is Laya open-source?"

It should be:

> **"Does self-hosting actually fit my workload and infrastructure?"**

---

# 10. Laya vs Jev

At the architecture level, the two approaches can be placed side by side:

```text
                 Decision AI
                     │
          ┌──────────┴──────────┐
          │                     │
         Jev                   Laya
          │                     │
   Hosted Decision        Self-hostable
       Service             Decision Model
```

The difference to care about is not just model accuracy.

When evaluating a real solution, developers should look at:

* API compatibility
* Model capability
* Latency
* Throughput
* Accuracy on real data
* Hardware requirement
* Deployment complexity
* Monitoring
* Cost
* Data privacy
* Licensing
* Ecosystem

In particular, don't benchmark with just a few simple examples.

A model can perform very well on a demo yet produce different results when run on production data.

---

# 11. When should you not use Laya?

Not every application needs a Decision Model.

If the problem is:

```text
Generate a 2,000-word report
```

then an LLM is a better fit.

If you need:

```text
Have a conversation with user
```

then an LLM is still the natural choice.

If you need:

```text
Analyze a large document
and explain the reasoning
```

then a generative model is also a better fit.

A Decision Model fits best when:

```text
Input
   ↓
Defined decision space
   ↓
Structured result
```

If the decision space is too open, or the application needs generated content, you may be using the wrong abstraction.

---

# 12. Another way of looking at AI Architecture

What I find most interesting about Laya is not the question:

> "Can Laya replace an LLM?"

It is that it raises a different question:

> **Do you necessarily have to use an LLM for every AI problem?**

In software engineering, we don't use the same technology for every workload.

There are many kinds of databases.

There are many kinds of message brokers.

There are many kinds of storage.

Programming languages come in many kinds too.

AI can follow a similar path.

Instead of:

```text
Everything
    ↓
LLM
```

We could have:

```text
                    AI Layer
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
        LLM       Decision Model   Embedding
          │            │            │
          ▼            ▼            ▼
      Generation    Decisions     Retrieval
```

At that point AI becomes a collection of capabilities rather than a single LLM.

---

# 13. Conclusion

Laya is a notable project if you are interested in **AI Decision Models** and want an open-source/self-hostable option alongside decision services such as Jev.

The important point is not to see Laya as a "new LLM".

It solves a different kind of problem:

```text
Input
  ↓
Understand
  ↓
Decision
  ↓
Application takes action
```

Instead of:

```text
Input
  ↓
LLM
  ↓
Generate everything
```

This opens up a rather interesting way to design AI applications.

The LLM can handle the **generation** part.

The Decision Model can handle the **decision** part.

The application keeps control of the **business logic and the final action**.

So if you are building an AI-powered application, perhaps the first question should not be:

> "Which model should I use?"

It should be:

> **"What does my application actually need AI to do?"**

If you need to generate → use a generative model.

If you need to retrieve → use embeddings/retrieval.

If you need a decision → a Decision Model like Laya may be an option worth trying.

And that is exactly what makes Laya interesting:

> **AI doesn't necessarily have to generate everything. Sometimes AI only needs to help the software make a structured decision.**
