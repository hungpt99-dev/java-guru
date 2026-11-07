Have you ever wondered what would happen if one day your **Senior Engineer quits**?

It's not that the laptop disappears.

It's not that the source code gets deleted.

It's not that a server goes down.

It's that...

**the only person who knows why the system was designed this way is no longer there.** 😅

A new developer joins a project that has been running for a few years. The source code is hundreds of thousands of lines long, with dozens of services, multiple databases, Kafka, Redis and a whole set of integrations with other systems.

The developer starts by reading the code.

But the more they read, the more questions they have.

What is this service responsible for? Why does this API handle things this way? Why is a Redis lock needed here? Why not call that other service directly? When was this business rule decided? Have there been any incidents involving this part of the code before?

The developer starts looking for documentation.

Some of it is on Confluence, some in Google Drive, the API docs are in the repository, task history is in Jira or Linear. Some answers sit in old threads on Slack or Teams.

Eventually the developer runs into a slightly painful truth:

> **There is plenty of documentation, but the answers still have to come from asking a person.**

And what if that person just quit?

The team may still have the source code.

Jira is still there.

Confluence is still there.

The Git history is still there.

But the **“Why?”** part may have quit along with the Senior. 😄

This isn't a problem of one particular project. As a project grows, knowledge almost always tends to become fragmented.

A team can have plenty of information but no good way to turn that information into knowledge that can be searched, connected and reused.

And once AI Agents start taking part in software engineering, this problem becomes even more obvious.

An AI Agent can read code, analyse a repository and write an implementation. But it doesn't automatically know the decisions the team made in the past, the business rules that aren't clearly expressed in the code, or the incidents that happened a few years ago.

A human can ask:

> "Hey, why is this part done this way?"

An AI Agent has no Senior Developer to ask.

It needs a different source of context.

**That's when a Knowledge Base becomes useful.**

---

# 1. What is a Knowledge Base?

Put simply, **a Knowledge Base is where knowledge is stored so that humans or systems can search it and use it when needed.**

But for an Engineering Team, that definition is still a bit too simple.

A project doesn't only have documentation.

A project also has:

* Architecture
* Business rules
* API
* Database
* Technical decisions
* Code
* Incident history
* Runbook
* Deployment knowledge
* Dependencies
* Historical context

So a Knowledge Base can be seen as a **knowledge layer of the project**, whose job is to gather, organise and provide context from many different sources.

```text
                    Project Knowledge
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   Documentation         Code              History
        │                  │                  │
      ADRs               APIs             Incidents
        │                  │                  │
 Business Rules       Database           Decisions
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                    Knowledge Base
                           │
                 ┌─────────┴─────────┐
                 │                   │
              Human              AI Agent
```

The important point is:

**A Knowledge Base does not necessarily have to replace the existing systems.**

GitHub can still be where the source code lives.

Jira or Linear can still manage tasks.

Confluence or Notion can still hold documentation.

Google Drive can still hold the business documents.

The Knowledge Base plays the role of connecting these sources so that the project's knowledge can be accessed in a consistent way.

In other words, the goal is not:

> "Put everything into one database."

It is:

> **"When we need to understand a problem, we can find the right context from the relevant sources."**

---

# 2. How do information, documentation and knowledge differ?

This is a fairly important distinction.

Suppose the code contains:

```java
paymentService.processPayment();
```

That is information about the implementation.

Documentation might say:

> Payment Service is responsible for processing payment.

But knowledge might be:

> Payment Service uses asynchronous processing because Transaction Service is not allowed to become a synchronous dependency in the payment flow.

And historical knowledge might say:

> This architecture was changed after an incident involving a downstream timeout.

So these three things are not quite the same.

```text
Information
    ↓
Documentation
    ↓
Knowledge
    ↓
Context
```

Documentation usually helps answer:

> **What?**

Knowledge can also answer:

> **Why?**

And historical knowledge can answer:

> **What happened before?**

This is exactly why a Knowledge Base for an Engineering Team needs to be broader than a documentation repository.

---

# 3. Why does an Engineering Team need a Knowledge Base?

## 3.1 Knowledge is fragmented

A real project might have the architecture on Confluence, the code on GitHub, tasks in Linear, incidents in another system and business documents in Google Drive.

Say a developer wants to understand the payment flow.

They might have to go through:

```text
Confluence
   ↓
GitHub
   ↓
Jira / Linear
   ↓
Slack
   ↓
Google Drive
   ↓
Ask Senior Developer
```

Each system holds only part of the answer.

The developer has to connect those pieces of information themselves.

The problem isn't missing data.

The problem is **fragmented context**.

And sometimes the thing that takes the most time isn't reading the documents.

It's working out **which document is the one I actually need to read**.

---

# 4. Knowledge lives in a few people's heads

This is the more dangerous problem.

In a long-running project there are usually senior developers who know a great deal of historical context.

For example:

> "You shouldn't change this logic."

If you ask why:

> "Because we've had a production issue before."

But that incident may have happened two years ago.

The PR is buried deep in the Git history.

The ticket is closed.

The documentation may never have been updated.

The knowledge still exists, but only in the memory of a few people.

This creates a kind of **knowledge bottleneck**.

When those people aren't available, the team's problem-solving speed drops.

This is also why the sentence:

> "Ask A about this one."

turns up fairly often in large projects. 😄

The problem isn't that seniors don't want to share knowledge.

The problem is that the team has no good way to turn individual knowledge into **shared knowledge**.

---

# 5. Developer onboarding gets harder too

A new developer doesn't only need to learn a programming language or a framework.

They have to learn:

```text
Business
   +
Architecture
   +
Codebase
   +
Infrastructure
   +
Team conventions
   +
Historical decisions
```

If that knowledge is scattered around, onboarding very easily turns into:

> "Go ask each person one by one."

A good Knowledge Base can help turn onboarding from:

```text
Ask people
   ↓
Search manually
   ↓
Read random documents
   ↓
Guess
```

into:

```text
Search project knowledge
   ↓
Understand architecture
   ↓
Read relevant decisions
   ↓
Explore related code
   ↓
Ask humans only when necessary
```

People still need to talk to each other.

But questions that existing knowledge can answer shouldn't keep turning into interruptions for senior developers.

---

# 6. And this is where AI Agents come in

AI Coding Agents today can do a lot of things:

* Read a repository
* Find code
* Analyse dependencies
* Write code
* Create tests
* Refactor
* Debug

But there's a problem:

**AI doesn't automatically know the project context.**

An AI Agent can see:

```text
PaymentService
TransactionService
Redis
Kafka
PostgreSQL
```

But it doesn't necessarily know:

> Why is the architecture like this?

It also doesn't know:

> Are there business rules that aren't clearly expressed in the code?

Or:

> Why is a piece of code that looks redundant actually not deleted?

A human can ask a senior developer.

An AI Agent needs a source of context it can access.

That is precisely one of the reasons a Knowledge Base becomes important in the age of AI Agents.

---

# 7. What should a Knowledge Base contain?

You shouldn't start with the question:

> "How many documents do we have?"

You should start with:

> **"What kinds of knowledge does the project have?"**

It can be split into a few main groups.

## 7.1 Architecture Knowledge

For example:

```text
System Architecture
Service Architecture
Data Flow
Integration
Infrastructure
Dependencies
```

A good architecture document doesn't just say which services exist, it also explains the relationships between them.

```text
Order Service
      │
      ├── PostgreSQL
      │
      ├── Redis
      │
      └── Kafka
             │
             ├── Payment Service
             └── Notification Service
```

A developer or an AI Agent doesn't only need to know:

> "Order Service has Kafka."

They also need to know:

> "Which events Order Service publishes, which consumers use those events, and why the flow was designed that way."

---

# 8. Business Knowledge

This is the part that code usually cannot describe fully.

For example:

* Payment state
* Cancellation rules
* Refund rules
* Eligibility
* Validation rules
* Domain terminology
* State transitions

AI can read:

```text
if (status == COMPLETED)
```

but it doesn't necessarily know:

> Why `COMPLETED` cannot transition back to `PROCESSING`?

Or:

> Why is user A allowed to perform this operation but user B isn't?

Business knowledge helps fill in the context that source code usually only partially expresses.

---

# 9. Decision Knowledge

This is why ADRs matter so much.

For example, the code shows:

```text
Service A → Kafka → Service B
```

But the code doesn't say:

> Why not call REST directly?

An ADR can record:

```text
Decision:
Use asynchronous communication through Kafka.

Context:
Service B may be temporarily unavailable.

Alternatives:
- REST synchronous call
- Message queue

Trade-off:
Higher operational complexity,
but better decoupling.
```

There is a very useful principle:

> **Code tells us what the system does. ADR tells us why the system was designed that way.**

If you want an AI Agent to understand the project better, this **"why"** part matters a lot.

If you only give AI the source code, AI can analyse the current implementation.

If you add the ADRs, AI gets extra context to understand the constraints and trade-offs behind that implementation.

---

# 10. Operational Knowledge

A project also has knowledge related to operations:

* Deployment
* Rollback
* Monitoring
* Troubleshooting
* Configuration
* Runbook
* Production procedures

For example:

```text
Payment Service is unhealthy

1. Check pod status
2. Check application logs
3. Check Kafka consumer lag
4. Check database connection
5. Check downstream service
6. Follow rollback procedure
```

This knowledge is extremely valuable when debugging or handling an incident.

In particular, for AI Agents capable of supporting production troubleshooting, operational knowledge helps the agent understand which checks are appropriate instead of guessing on its own.

---

# 11. Historical Knowledge

A project has a very long history:

```text
Issue
   ↓
PR
   ↓
Deployment
   ↓
Incident
   ↓
Fix
   ↓
Postmortem
```

If we only look at the current code, we lose a lot of context.

For example:

> "Why was this workaround introduced?"

The answer may be in a PR from two years ago.

Or:

> "Has this problem happened before?"

The answer may be in the incident history.

Historical knowledge keeps the team and the AI Agent from constantly "reinventing" the lessons the project already paid for.

---

# 12. Generated Knowledge

Not all knowledge needs to be written by hand by a developer.

Some knowledge can be generated from source code and infrastructure.

For example:

```text
Service Inventory
API Inventory
Database Schema
Kafka Topics
Service Dependencies
Repository Dependencies
Configuration Inventory
```

From source code you can generate:

```text
Payment Service
 ├── REST APIs
 ├── Kafka Producers
 ├── Kafka Consumers
 ├── Database Tables
 ├── External Dependencies
 └── Internal Dependencies
```

This kind of knowledge is especially useful for AI because it has a clear structure and can be updated automatically.

---

# 13. Three kinds of knowledge worth distinguishing

A fairly useful way to organise things is to distinguish knowledge into:

```text
Curated Knowledge
        │
        ├── Architecture
        ├── ADR
        ├── Business Rules
        └── Runbook

Imported Knowledge
        │
        ├── GitHub
        ├── Jira
        ├── Confluence
        └── Slack

Generated Knowledge
        │
        ├── Services
        ├── APIs
        ├── Database
        └── Dependencies
```

These three kinds don't carry the same level of authority.

For example:

An approved ADR shouldn't be treated the same as a snippet of Slack conversation.

A service inventory generated from source code is also different from a hand-written document.

So a Knowledge Base should preserve **provenance** and metadata instead of turning everything into identical blocks of text.

---

# 14. How to implement a Knowledge Base

Only after defining what knowledge needs managing do we start talking about implementation.

A simple architecture might be:

```text
                 Knowledge Sources
                        │
        ┌───────────────┼────────────────┐
        │               │                │
       Git            Jira          Confluence
        │               │                │
      Drive           Slack            Notion
        │               │                │
        └───────────────┼────────────────┘
                        │
                        ▼
                   Ingestion
                        │
                        ▼
                  Normalization
                        │
                        ▼
                    Metadata
                        │
                        ▼
                     Index
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
          Keyword    Semantic   Structured
           Search     Search      Lookup
             │          │          │
             └──────────┼──────────┘
                        ▼
                    Retrieval
                        │
                        ▼
                 Context / Answer
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
           Human                AI Agent
```

The implementation can be split into steps.

---

# 15. Step 1: Define the scope

Don't start by putting the whole company into the Knowledge Base.

Start with one project or service.

For example:

```text
Payment Service
```

Then focus on:

```text
Architecture
API
Database
Business Rules
ADR
Runbook
Incidents
Code
```

Make a small scope work well first.

Only then expand.

This helps avoid a very large system that nobody knows is actually useful.

A fairly practical principle:

> **Start with a question, not with a vector database.**

Work out first:

> "What question is the developer or the AI Agent dealing with?"

Then design the system to answer that question.

---

# 16. Step 2: Connect the data sources

Knowledge can come from many sources:

```text
GitHub / GitLab
Jira / Linear
Confluence / Notion
Google Drive
Slack / Teams
Internal documentation
Incident systems
```

Each source has a different format.

Git holds code and commit history.

Jira holds issues and workflow.

Confluence holds documentation.

Slack holds conversations.

So you need an ingestion layer to bring them into a common knowledge model.

For example:

```text
GitHub
   ↓
Repository Connector
   ↓
Normalize
   ↓
Knowledge Model
```

and:

```text
Jira
   ↓
Jira Connector
   ↓
Normalize
   ↓
Knowledge Model
```

In the end the different sources all land in one unified knowledge layer.

---

# 17. Step 3: Normalize Knowledge

You shouldn't index raw data blindly.

For example, a Slack conversation might contain:

```text
A: Should we use Kafka?
B: I think so.
C: Let's use REST.
D: Maybe Kafka.
```

This is not authoritative knowledge.

It is just a conversation.

If you put all of it into retrieval without context, AI can mistake a discussion for a decision.

So knowledge needs to be normalised and classified:

```text
Discussion
Decision
Documentation
Incident
Code
Task
```

At the same time, keep the source and context so you can trace back to the origin.

This is also why a Knowledge Base shouldn't just be:

> "Chunk all the text → embedding → vector database."

The harder part lies in **understanding what that knowledge is and how far it can be trusted**.

---

# 18. Step 4: Metadata

Metadata is a very important part.

For example:

```yaml
title: Payment Service Architecture
type: architecture
service: payment-service
owner: payment-team
status: active
source_of_truth: github
created_at: 2026-01-10
updated_at: 2026-09-20
review_at: 2026-12-20
```

Thanks to metadata, the system can know:

* Which service does this knowledge belong to?
* What type is it?
* Who is responsible for it?
* Is it still active?
* When was it last updated?
* Where is the source of truth?

Metadata also makes retrieval better.

For example, with the query:

> "Who owns the payment API?"

the service metadata can help the system find the right service owner instead of having to run a semantic search over thousands of documents.

---

# 19. Step 5: Search and Retrieval

This is where RAG usually shows up.

A common pipeline:

```text
Document
   ↓
Chunking
   ↓
Embedding
   ↓
Vector Index
   ↓
Semantic Search
   ↓
Relevant Context
   ↓
LLM
```

But an engineering Knowledge Base shouldn't rely on vector search alone.

There are at least three useful kinds of retrieval.

### Keyword Search

Suited to finding:

```text
PaymentService
/api/v1/payment
ADR-023
INC-182
```

### Semantic Search

Suited to questions like:

> "Why does payment processing use asynchronous communication?"

### Structured Lookup

Suited to:

> "Which service owns this API?"

or:

> "What database does Payment Service use?"

So a real system can combine:

```text
Keyword
   +
Semantic
   +
Structured
```

and then rank the results before handing context to AI.

RAG is one technique inside the retrieval pipeline.

**A Knowledge Base is not the same thing as RAG.**

RAG fetches context.

The Knowledge Base decides **where that context comes from, what kind it is, whether it can be trusted and how it is managed.**

---

# 20. Step 6: Expose Knowledge to the AI Agent

Once the Knowledge Layer is working, the AI Agent needs an interface to access it.

You can use an API or MCP.

For example, a Project Knowledge MCP could expose:

```text
search_project_knowledge()
get_project_overview()
get_service_info()
get_architecture()
get_api_info()
get_database_info()
get_business_rule()
search_decisions()
search_incidents()
find_related_code()
get_implementation_context()
```

The AI Agent doesn't need to know:

> "Is this knowledge in Confluence or GitHub?"

It only needs to ask:

> "Find the relevant project knowledge."

The Knowledge Layer handles the rest.

One point worth distinguishing clearly:

> **MCP is not a Knowledge Base.**

MCP is only an **interface** for the AI Agent to access knowledge.

The Knowledge Base is where knowledge is organised, managed and retrieved.

---

# 21. A real workflow with an AI Agent

Suppose the AI Agent is given the task:

> Implement payment retry.

Without a Knowledge Base, the workflow might be:

```text
Task
 ↓
Read repository
 ↓
Find PaymentService
 ↓
Guess architecture
 ↓
Implement
 ↓
Test
```

With a Knowledge Base:

```text
Task
 ↓
Search project knowledge
 ↓
Read Payment architecture
 ↓
Read business rules
 ↓
Find related ADR
 ↓
Find existing retry implementation
 ↓
Find previous incidents
 ↓
Inspect relevant code
 ↓
Create implementation plan
 ↓
Implement
 ↓
Test
```

At this point the AI Agent isn't only reading code.

It reads **context before coding**.

This is one of the greatest values of a Knowledge Base for AI-assisted development.

---

# 22. Best Practices: what makes a Knowledge Base good or not?

Having a Knowledge Base doesn't guarantee a better project.

A Knowledge Base can quickly become a **"documentation dump"** without governance.

A system holding 100,000 documents doesn't mean it is more useful than a system with only 10,000 documents.

What matters more is:

```text
Can we find it?
Can we trust it?
Is it still valid?
Do we know where it came from?
Can we understand its context?
```

---

# 23. The source of truth must be clear

One of the most dangerous problems is conflicting knowledge.

For example:

```text
Document A:
Timeout = 30 seconds

Document B:
Timeout = 60 seconds

Current code:
Timeout = 45 seconds
```

If AI retrieves all three, it has to guess.

Instead you need to define the source of truth.

For example:

```text
Source Code
    ↓
Implementation truth

ADR
    ↓
Architecture decision truth

Jira / Linear
    ↓
Task truth

Business specification
    ↓
Business requirement truth

Incident / Postmortem
    ↓
Historical / operational truth
```

A Knowledge Base can aggregate information, but it shouldn't erase where that information came from or its authority.

If there is a conflict, the system should prefer the knowledge with higher authority, or at least tell the user that a conflict exists.

---

# 24. Knowledge must have an Owner

You shouldn't have the mindset:

> "Documentation is everyone's responsibility."

In practice that very easily turns into:

> "Someone will update it."

And in the end nobody updates it. 😄

It's better to define an owner for each group of knowledge:

```text
Architecture
    → Backend / Architecture Team

Business Rules
    → Domain / Product Team

Deployment
    → Platform Team

API
    → Service Owner

Runbook
    → Operations / Service Owner
```

An owner doesn't necessarily have to write everything themselves.

They are responsible for making sure that knowledge has someone maintaining it.

---

# 25. Knowledge must have a Lifecycle

A document shouldn't be treated as correct forever.

There can be a lifecycle:

```text
Draft
  ↓
Active
  ↓
Needs Review
  ↓
Deprecated
  ↓
Archived
```

Metadata might contain:

```yaml
owner: payment-team
status: active
last_updated: 2026-09-20
review_at: 2026-12-20
```

When the architecture changes, the related documents need to be marked for review.

If a service has changed a great deal but the documentation hasn't been updated for a long time, that is a signal worth noticing.

A good Knowledge Base doesn't only know:

> "This knowledge exists."

It also has to know:

> **"Is this knowledge still trustworthy?"**

---

# 26. Don't just store "What", store "Why"

This is why ADRs and incident history are so valuable.

For example:

```text
What:
Use Redis distributed lock.

Why:
Multiple operations can access the same business entity concurrently.

Problem avoided:
Duplicate processing.

Trade-off:
Additional infrastructure dependency.
```

If a developer later asks:

> "Can we remove the Redis lock?"

AI shouldn't just answer:

> "Code currently uses Redis."

It needs to know **why the lock exists**.

Knowledge about "why" helps the team avoid changes that look reasonable but break old assumptions.

This is also the part of knowledge that is usually hardest to generate automatically.

Source code can tell us the **what**.

But to know the **why**, sometimes you still need an ADR, a PR discussion, an incident or a human to confirm it.

---

# 27. Don't put everything into the Knowledge Base

This is a very common anti-pattern.

```text
Google Drive
Confluence
Slack
GitHub
Jira
Notion
PDF
Excel
        ↓
Import everything
        ↓
Knowledge Base
```

After a while:

```text
10,000 documents
50,000 chunks
1,000 duplicates
300 outdated documents
100 conflicting documents
```

The data grows but the quality of knowledge doesn't.

So:

> **More data does not automatically mean better knowledge.**

You need to care about:

* Relevance
* Freshness
* Authority
* Ownership
* Duplication
* Quality

Especially with AI Agents, feeding too much context doesn't mean the AI understands the project better.

**Good context matters more than lots of context.**

---

# 28. Incidents must become Knowledge

An incident shouldn't simply end with:

```text
Incident resolved
       ↓
Ticket closed
```

If the incident carries a long-term lesson, turn it into knowledge:

```text
Incident
   ↓
Root Cause
   ↓
Fix
   ↓
Postmortem
   ↓
Runbook / ADR
   ↓
Knowledge Base
```

For example:

```text
Incident:
Payment requests timeout during high traffic.

Root Cause:
Database connection pool exhaustion.

Fix:
Connection pool tuning + query optimization.

Knowledge:
- Detection signal
- Root cause
- Troubleshooting
- Correct configuration
- Preventive measures
```

Next time a developer or AI hits a similar problem, this historical knowledge can be retrieved.

An incident isn't just an outage that got handled.

It is **a lesson the team paid money to learn**.

Don't let that lesson disappear along with the closed ticket. 😄

---

# 29. A Knowledge Base must have a Feedback Loop

This is the most important point if a Knowledge Base is not to die over time.

Treat every query as an opportunity to check the quality of the knowledge.

```text
Developer / AI Agent
        ↓
      Query
        ↓
 Knowledge Base
        ↓
 Answer / Context
        ↓
     Feedback
        ↓
 ┌──────┼─────────┐
 │      │         │
Wrong  Missing  Outdated
 │      │         │
 └──────┼─────────┘
        ↓
 Update Knowledge
        ↓
 Re-index
        ↓
 Better Retrieval
```

There are three very important kinds of signal.

### Missing Knowledge

AI asks:

> "Why is this lock required?"

No answer is found.

→ You may need to create an ADR.

### Wrong Knowledge

AI retrieves a document that is no longer correct.

→ The document needs to be fixed or deprecated.

### Outdated Knowledge

The architecture has changed but the documentation hasn't been updated.

→ A review/update task is needed.

That way the Knowledge Base becomes a system capable of **improving from its own usage**.

---

# 30. AI queries can also become a source of improvement

Suppose that over one month the AI Agent keeps asking:

```text
What service owns this API?
```

That may be a sign that service ownership isn't well documented.

If AI keeps asking:

```text
Why does this business rule exist?
```

the project may be missing business knowledge or ADRs.

If AI keeps retrieving the wrong documentation, the retrieval or the metadata may have a problem.

So you can track:

```text
Most searched knowledge
Most failed queries
Most missing knowledge
Most outdated documents
Most retrieved documents
```

From there the team knows where the Knowledge Base should be improved.

In other words:

> **The questions AI can't answer are themselves a form of technical feedback.**

---

# 31. How should Knowledge Quality be measured?

You shouldn't only measure:

> "How many documents does the Knowledge Base have?"

A Knowledge Base with 100,000 documents where AI regularly pulls the wrong context isn't worth much.

You might care about metrics such as:

### Retrieval Quality

Does a query find the right knowledge?

### Freshness

Is the knowledge still fresh?

### Coverage

Are the important kinds of knowledge covered?

### Authority

Do we know which source is authoritative?

### Usage

Do developers and AI Agents actually use the knowledge?

### Failure Rate

How many queries find no answer?

For example:

```text
100 queries
   ↓
70 correct retrieval
20 partially useful
10 failed
```

Those 10 failed queries are exactly the source for improving the system.

What matters is not only measuring:

> "How much data does the Knowledge Base hold?"

but measuring:

> **"How much better does the Knowledge Base make developers and AI at their work?"**

---

# 32. Security and Permission also have to be taken into account

When a Knowledge Base connects to many sources, another problem appears:

> **Who is allowed to see which knowledge?**

For example:

```text
Public documentation
Internal engineering docs
Private business documents
Security incidents
Production information
```

You can't let an AI Agent read all the data just because it has access to the Knowledge Base.

A Knowledge Base should respect the permissions of the source.

A simple principle might be:

```text
AI permissions
    ≤
User permissions
    ≤
Source permissions
```

If a developer doesn't have permission to view a document in the original system, the AI Agent shouldn't use the Knowledge Base to "get around" that permission either.

This part is especially important when a Knowledge Base expands from one project into a knowledge platform for the whole organization.

---

# 33. A Knowledge Base shouldn't be a "setup once" project

An important mindset is:

> **A Knowledge Base is not a database.**

It is a **living system**.

The project changes:

```text
New Service
New API
New Business Rule
New ADR
New Incident
New Infrastructure
```

Knowledge has to change too.

You can picture it like this:

```text
Software Lifecycle

Design
  ↓
Develop
  ↓
Deploy
  ↓
Operate
  ↓
Incident
  ↓
Learn
  ↓
Update Knowledge
  ↓
Next Development
```

Knowledge becomes part of the software development lifecycle.

When a new service is created, knowledge is created.

When the architecture changes, knowledge is updated.

When an incident happens, new knowledge is born.

When a decision is made, the ADR becomes knowledge.

This is how a Knowledge Base avoids becoming a documentation folder forgotten after a few months.

---

# 34. The Knowledge Base and the AI Agent form a new loop

When AI Agents take part in development, the flow can become:

```text
                    Project
                       │
                       ▼
                   Knowledge
                       │
                       ▼
                   AI Agent
                       │
                       ▼
                  Development
                       │
                       ▼
                  Production
                       │
              ┌────────┴────────┐
              ▼                 ▼
           Changes           Incidents
              │                 │
              └────────┬────────┘
                       ▼
                 New Knowledge
                       │
                       └──────────► Knowledge Base
```

The AI Agent uses knowledge to do its work.

While doing that work, the project produces new knowledge.

The new knowledge flows back into the Knowledge Base.

The loop continues.

This creates a fairly interesting model:

```text
Human
  ↓
Engineering Work
  ↓
Project Changes
  ↓
New Knowledge
  ↓
Knowledge Base
  ↓
AI Agent
  ↓
Better Engineering Work
```

Knowledge is no longer just something written down to be read.

It becomes part of the **engineering infrastructure**.

---

# 35. What does a good Knowledge Base look like?

In the end, a good Knowledge Base isn't the one with the most documents.

It is the one where, when a developer or AI asks:

> **"What do I need to know to do this task?"**

the system can supply the right context:

```text
Task
 ↓
Relevant Architecture
 ↓
Business Rules
 ↓
Technical Decisions
 ↓
Related Code
 ↓
Historical Issues
 ↓
Operational Constraints
 ↓
Implementation Context
```

And more importantly, the user can know:

* Where does this information come from?
* Is it still active?
* Who is responsible for it?
* Is this a decision or just a discussion?
* What is the source of truth?
* Is there any related historical context?

That is what a genuinely useful Knowledge Base looks like.

---

# 36. Conclusion

An Engineering Team can have thousands of documents, millions of lines of code and plenty of systems storing information.

But that doesn't mean the team has a good Knowledge Base.

Knowledge is only truly valuable when it can be:

**found → understood → trusted → used → updated.**

For developers, a Knowledge Base cuts search and onboarding time while reducing dependence on knowledge held in a few people's heads.

For AI Agents, a Knowledge Base provides the thing source code alone cannot fully provide:

**project-specific context.**

And for a Knowledge Base not to become a warehouse of outdated documentation, it needs to be treated as a living system: with a source of truth, owners, a lifecycle, feedback, and continuous improvement from what developers and AI run into while working.

In the end, the goal isn't to have a system holding a huge amount of knowledge.

The goal is that when someone needs to understand part of the project, **both the developer and the AI Agent can find the right context at the right moment**.

At that point, the team's knowledge no longer lives only in scattered documents, old conversations or the heads of a few senior developers.

It becomes an accessible, reusable part of the engineering system itself.

**And if one day the Senior Engineer quits...**

then at least the team still knows:

> **"Where he left the knowledge."** 😄
