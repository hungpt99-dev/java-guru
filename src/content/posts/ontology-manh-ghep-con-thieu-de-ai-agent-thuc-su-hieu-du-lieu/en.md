---
title: "Ontology: The Missing Piece for AI Agents to Truly Understand Data?"
description: "In recent years, we have seen many waves of technology in AI: Vector Databases, RAG, Knowledge Graphs and, more recently, AI Agents."
slug: "ontology-manh-ghep-con-thieu-de-ai-agent-thuc-su-hieu-du-lieu"
locale: "en"
translationKey: "ontology-manh-ghep-con-thieu-de-ai-agent-thuc-su-hieu-du-lieu"
pubDate: 2026-11-22T14:38:38+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 6
---

In recent years, we have witnessed many waves of technology in the field of AI: Vector Database, RAG, Knowledge Graph and, more recently, AI Agents.

Each technology solves a different problem. RAG helps AI search for information, Knowledge Graph helps represent relationships, while AI Agents allow the model to perform complex tasks.

But there is one problem that has still not been fully resolved:

**AI can find data, but does it really understand what that data means?**

Imagine you ask an AI Agent:

"What is the company's revenue this quarter?"

The system has many data sources:
- Revenue from the transactions table.
- Bookings from the sales system.
- Recognized Revenue from the accounting system.
- ARR from the business analytics system.

All of them relate to revenue, but they do not have the same meaning.

A RAG system can find all of these sources. However, determining which definition is correct in a specific context is a different matter.

This is when Ontology becomes important.

## 1. What is Ontology?

In technology, Ontology is a way of modelling a domain through concepts, attributes, relationships and the rules between them.

Rather than merely storing data, Ontology describes the meaning of the data and how the components are linked together.

For example, in an e-commerce system:

- A Customer can place multiple Orders.
- An Order contains multiple Order Items.
- An Order Item references a Product.
- A Payment is linked to an Order.
- Revenue is calculated based on specific business rules.

These relationships not only help the system know where the data resides, but also understand the business structure behind it.

You can think of Ontology as a semantic map of the entire domain.

The important point is that Ontology is not simply a database schema. A database schema describes how data is organised and stored, while Ontology describes the meaning of the concepts and relationships in a domain.

## 2. Why do AI Agents need Ontology?

When working with a business, an AI Agent not only needs access to data but must also understand the business context.

For example, the same term Customer can carry many meanings:

- Marketing sees a Customer as someone who signed up or engaged.
- Sales sees a Customer as an account with a business opportunity.
- Finance sees a Customer as an entity that generates revenue.
- Customer Support sees a Customer as someone who needs help.

If each Agent interprets things in its own way, the results may be inconsistent.

Ontology helps define these concepts, point out the relationships and the rules for using them.

Instead of letting the Agent infer everything from scattered documents, the system can provide a unified semantic model.

This is why Ontology is drawing attention again in Enterprise AI architecture.

## 3. How is Ontology different from Knowledge Graph and RAG?

These are three concepts that often appear together but have different roles.

| Technology | Role |
|---|---|
| RAG | Searching and retrieving information |
| Knowledge Graph | Representing entities and relationships |
| Ontology | Defining concepts, relationship types and rules |

For example, in the banking domain:

Ontology defines:
- What is a Customer?
- What types of Loan are there?
- What types of Account can a Customer own?
- What is the relationship between Loan, Payment and Customer?

The Knowledge Graph contains the specific data:
- Customer A owns Account B.
- Account B has Loan C.
- Loan C has the status ACTIVE.

RAG helps the Agent search for documents related to the lending process, policies or business guidelines.

The three components can be combined to help the Agent both search for information and understand the relationships and rules of the domain.

## 4. Why has Ontology become a trend?

Ontology is actually not a new technology. It has existed for many years in Semantic Web, Knowledge Engineering and Enterprise Data Management.

What has changed recently is the emergence of AI Agents.

In the past, people could understand ambiguous terms on their own through experience and business knowledge.

But when Agents begin to query data, analyse reports and take actions on their own, the lack of a unified definition becomes a big problem.

An Agent may find the right data table but choose the wrong metric. It may understand the question correctly but use the wrong business rule.

Ontology helps bridge the gap between data and business meaning.

Some notable signals in 2026:

**Databricks Genie Ontology**

Databricks brought Genie Ontology to General Availability in November 2026. Their approach is to build an ontology that can learn from a business's real-world activity, used by Agents and managed and verified by humans.

The notable point is that an ontology is not only built manually but can also be formed from the organisation's existing data and activities.

**Neo4j Ontology Graph Specification**

Neo4j published an open specification in November 2026 to standardise the way domain knowledge is represented in a form that can be read and processed by machines.

The goal is to help ontologies be shared and used across data systems, applications and AI.

**Ontology and AI Grounding**

Another approach is to use Ontology to ground AI Agents in trustworthy business definitions.

Instead of merely searching for similar content, the Agent can identify which concept is being referred to, which relationship applies and which data source the business recognises.

## 5. Can Ontology replace RAG?

No.

RAG and Ontology solve different problems.

RAG is very useful when the Agent needs to search for information in a large volume of unstructured documents.

Ontology is useful when the Agent needs to understand the concepts, relationships and rules in a domain.

For example:

When asked about the refund policy, RAG can find the relevant policy documents.

When asked whether an order is eligible for a refund, Ontology can provide the business structure around Order, Payment, Refund and the related rules.

In a real system, these two technologies should complement each other rather than compete.

## 6. An AI Agent architecture with Ontology

You can imagine a reference architecture as follows:

- **LLM:** Processes language and reasoning.
- **MCP:** Connects to databases, APIs and external systems.
- **RAG:** Retrieves relevant documents and information.
- **Ontology:** Provides definitions, relationships and business rules.
- **Knowledge Graph:** Stores specific entities and relationships.

When receiving a question, the Agent can use Ontology to identify the relevant concepts, then use RAG or MCP to fetch data from the corresponding source.

For example, when a user asks about the revenue of a customer group, the Agent needs to understand what a Customer Segment is, how Revenue is defined, which transactions are counted and which data source to query.

Instead of letting the LLM guess everything on its own, the system provides a structured semantic layer for the Agent to rely on.

Of course, Ontology does not automatically guarantee that answers are always correct. Data quality, access permissions, business rules and verification mechanisms still matter a great deal.

## 7. The future: AI needs not just data but understanding

We have spent a great deal of time improving AI's ability to search for data.

But as Agents take on increasingly complex tasks, finding information is no longer enough.

Agents need to understand:
- What does a concept really mean?
- Which entities are related?
- Which business rules need to be applied?
- Which data source is trustworthy?
- Which components are affected by changes in a domain?

Ontology offers an approach to solving these problems.

In my view, Ontology can become an important component of the Knowledge Infrastructure for AI Agents, especially in enterprise systems with many domains, many data sources and many Agents operating together.

**RAG helps AI find information. Knowledge Graph helps AI see relationships. Ontology helps AI understand the meaning behind those relationships.**

And perhaps the next step for AI is not just helping the model know more, but helping it understand the world it works in more structurally.

---

**References**

- [Databricks – Announcing GA of Genie Ontology](https://www.databricks.com/blog/announcing-ga-genie-ontology)
- [Neo4j – The Ontology Graph Specification](https://neo4j.com/blog/developer/the-neo4j-ontology-graph-specification-a-pragmatic-open-ai-first-approach/)
- [Atlan – Why AI Grounding Is Driving Ontology Demand](https://atlan.com/know/ai-agent/ontology/ontology-ai-grounding/)
- [Neo4j – Context Engine](https://neo4j.com/press-releases/neo4j-context-engine/)
