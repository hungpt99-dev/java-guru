---
title: "Knowledge Factory: The Missing Infrastructure for AI Agents?"
description: "In the race to build AI Agents, we are focusing a lot on stronger models, larger context windows, more tools and more complex workflows."
slug: "knowledge-factory-ha-tang-con-thieu-cho-ai-agent"
locale: "en"
translationKey: "knowledge-factory-ha-tang-con-thieu-cho-ai-agent"
pubDate: 2026-11-22T14:28:21+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 9
---

In the race to develop AI Agents, we're focusing a lot on stronger models, larger context windows, more tools and more complex workflows.

But there's one problem that gets little attention: **How can an AI Agent understand how a business actually operates, accumulate knowledge and reuse those insights in its work?**

Imagine a long-time employee at the company. They know the workflows, understand the business rules, know where the data lives, which sources are trustworthy and who to contact when something goes wrong.

This knowledge doesn't always exist in documentation. Some of it sits in Slack, Notion and GitHub, some in internal conversations, and some exists only in employees' experience.

AI Agents need the same kind of knowledge to truly work effectively in a business.

In the article *How to Build a Knowledge Factory* dated November 21, 2026, Harrison Chase – CEO of LangChain – offers a notable approach: instead of just improving the model or supplying more context, businesses need to build a system that collects, organizes and maintains knowledge for the Agent.

That system is called a **Knowledge Factory**.

## 1. From Software Factory to Knowledge Factory

In recent times, the concept of a Software Factory has been attracting more and more attention.

Rather than letting the best engineers spend all their time writing software directly, a business can invest in building systems, tools and processes that help everyone develop software more effectively. When that happens, AI Agents can take on more and more of the actual implementation work.

Harrison Chase argues that knowledge work is heading in the same direction.

AI Agents today can already create presentations, produce marketing videos, handle outbound sales and take care of many other office tasks.

However, to complete these tasks to a business's standards, the Agent needs to understand a lot of things:

- How does the company operate?
- How are tasks carried out?
- Which standards need to be followed?
- Where does the data live and how is it accessed?
- Why does the business use a particular process?

This information is often scattered and not fully documented.

So instead of investing only in the Agent's ability to execute, a business needs to invest in a system that collects, organizes and maintains knowledge.

That's the shift from Software Factory to Knowledge Factory.

## 2. Context and Knowledge aren't the same thing

This is one of the most important points in LangChain's article.

**Context** is the information the Agent has available while carrying out a task.

**Knowledge** is reusable understanding that helps the Agent do its work more accurately.

For example, an Agent is given the task of creating a revenue report.

The context the Agent needs:
- Current revenue figures.
- Customer data.
- Transaction information.

The knowledge the Agent needs:
- How does the business calculate ARR?
- Which data sources are considered trustworthy?
- What standards should the report follow?
- How to access revenue data.

Knowledge can be provided to the Agent as context, but not all context needs to be turned into knowledge.

In particular, data that changes frequently – such as revenue, transaction status or customer information – should be fetched directly from the authoritative data source rather than continually copied into the knowledge store.

In other words, a Knowledge Factory isn't a system that stores everything the Agent has ever known. It focuses on insights that have reuse value.

## 3. Three kinds of knowledge a business needs to maintain

LangChain divides knowledge into three main groups.

### Skills – How to get work done

Skills contain the processes, instructions and scripts that help the Agent do work the way the business wants it done.

For example:
- The process for creating a financial report.
- A guide to reviewing a Pull Request.
- The process for deploying software.
- Documentation writing standards.
- The steps for handling an incident.

The notable thing is that many real-world processes have never been written down as official documentation. They're usually passed from one employee to another.

When you bring AI Agents into a business, these processes need to be systematized into reusable instructions.

### Domain Knowledge – Knowledge about the business

Domain Knowledge contains relatively stable information about the organization, products, customers, competitors and business rules.

For example:
- Definitions of business metrics.
- How ARR is calculated.
- Information about the product.
- Company policies.
- Business concepts and rules.

This information may already exist in documentation, but it's often incomplete or not entirely accurate.

A Knowledge Factory helps gather and maintain it so the Agent can understand the business context correctly.

### Data Access Guidance – Guidance on accessing data

This group helps the Agent know where data lives, which sources to use and how to query them.

For example:
- Revenue data lives in BigQuery.
- Customer information lives in Salesforce.
- How to query the relevant tables.
- Which data source is considered the canonical one.

LangChain emphasizes that if a business already has a good data management strategy with Snowflake, Databricks or similar systems, there's no need to create another copy of the data just to serve the Agent.

What needs to be maintained is clear guidance so the Agent knows which data lives where and how to access it.

## 4. The architecture of a Knowledge Factory

An important point in the article is that LangChain doesn't encourage maintaining knowledge entirely by hand.

Instead, they propose building a system with three main components.

### An Agent that can report missing or incorrect knowledge

While doing its work, the Agent may notice:
- It can't find the information it needs.
- Documentation is no longer accurate.
- A data source has changed.
- The current instructions don't fit the actual situation.

Rather than changing shared knowledge on its own, the Agent needs a tool to report the issue and can suggest what needs to be updated.

This helps ensure that problems discovered during the work aren't ignored.

### Curator Agent – The component that manages knowledge

This is the component responsible for updating and maintaining knowledge.

According to LangChain, the Curator Agent should run in the background on a set schedule.

It needs access to:

- Source data systems such as Notion and Slack.
- Execution traces to understand how the Agent does its work.
- Issues reported by the Agents.

From this information, the Curator Agent can determine which knowledge needs to be added or adjusted.

Why not let the Agent using the knowledge update it itself?

Because the Agent doing the work usually focuses on its own goal. It can be very good at spotting what's missing or wrong, but updating shared knowledge requires a deeper understanding of the data sources and the related information.

If every Agent freely modifies knowledge, the system can quickly end up with contradictory and inconsistent content.

### Knowledge Storage – Where knowledge is stored

LangChain argues that the actual storage isn't the most important component of a Knowledge Factory.

Knowledge can be stored in many places:

- GitHub in the Skills format.
- Notion as documents.
- LangSmith Context Hub in the OKF format.
- Neo4j as a Knowledge Graph.

What matters is that the Curator Agent can interact with these storage formats.

For procedural memory (knowledge about how to do work), the industry has gradually converged on the Skills format.

However, for semantic memory (knowledge about meaning, events and relationships), there's still no single agreed standard. LangChain mentions OKF as a direction worth watching, but also stresses that the field is still in its early stages.

So you shouldn't rush to build an overly complex storage system or lock yourself into a single format.

## 5. A real example: an Agent creating a revenue report

To show how a Knowledge Factory works, Harrison Chase gives an example of an Agent creating a revenue report.

First, the Agent needs revenue data from BigQuery and Salesforce.

Besides the data, the Agent also needs three kinds of knowledge:

- **Skills:** Instructions for creating a report to LangChain's standards, stored in GitHub.
- **Domain Knowledge:** How ARR is calculated, stored in the company wiki.
- **Data Access Guidance:** Instructions for accessing BigQuery and Salesforce data, stored as Skills in the Context Hub.

Once it has all the information, the Agent starts creating the report.

During the process, the Agent discovers that a column in BigQuery has been renamed. It finds the correct column on its own to continue the work, and at the same time uses a tool to report the issue and suggest the new column name.

After the report is created, the Finance Lead continues working with the Agent to adjust some formatting issues, including a request to use a new header for all LangChain documents.

By the evening, the Curator Agent checks the reported issues and reviews the execution traces.

It finds two changes that need to be updated:
- The new column name in BigQuery.
- The new header standard for documents.

The Curator Agent updates the relevant Skills so future report creation uses the correct instructions.

The notable thing here is that knowledge doesn't need to be perfected before the Agent starts working. The execution process itself helps surface what needs to be added.

## 6. How is a Knowledge Factory different from RAG and a Knowledge Graph?

A Knowledge Factory is related to many technologies that are popular in the AI ecosystem, but it isn't the same as them.

| Technology | Main role |
|---|---|
| RAG | Retrieves relevant information to provide context |
| Knowledge Graph | Represents entities and relationships |
| Ontology | Defines concepts and semantic structures |
| Skills | Instructs the Agent on how to do work |
| Knowledge Factory | Collects, maintains and improves knowledge for the Agent |

RAG can help the Agent search documents, a Knowledge Graph can represent complex relationships, and Skills help the Agent follow a process.

A Knowledge Factory sits at a broader management layer: it ensures this knowledge is formed, maintained and updated so the Agent can use it over the long term.

This is an architectural distinction, not a set of components that must be present in every Knowledge Factory implementation.

## 7. Where should you start building a Knowledge Factory?

One of the most notable messages at the end of Harrison Chase's article is that you don't need to document everything before putting an Agent to work.

Instead, start with a workflow that repeats.

For example:
- Creating a weekly revenue report.
- Reviewing a Pull Request.
- Summarizing customer reports.
- Analyzing business data.

Then observe the difficulties the Agent runs into while doing it.

What information does the Agent keep asking about again and again? Which documentation is out of date? Which processes aren't written down? Which data is hard to access?

These problems are exactly the input for improving knowledge.

Once the workflow runs smoothly, you can expand to other processes and gradually build knowledge infrastructure for the whole organization.

## 8. Does the future of AI Agents need its own Knowledge Infrastructure?

Today we tend to evaluate AI Agents by which model is better, how many tools they have, which MCPs they support and how much work they can automate.

But as these technologies become more widespread, another question starts to become important:

**How can hundreds of AI Agents share an organization's knowledge without constantly rediscovering it from scratch?**

This isn't simply a matter of storing documents or building a bigger RAG system.

It's about how knowledge is formed, verified, versioned and delivered to the right Agent.

In my view, the Knowledge Factory opens up a direction worth noting: instead of just building Agents that execute better, we need to invest in infrastructure that lets Agents draw on the whole organization's knowledge.

Models provide reasoning. Tools provide the ability to act. But knowledge helps the Agent understand how to do work in a specific environment.

**Perhaps the competitive advantage of future AI Agent systems won't lie only in the model or the number of tools, but also in the quality of the knowledge infrastructure behind them.**

---

**References**

- Harrison Chase – [How to Build a Knowledge Factory](https://www.langchain.com/blog/knowledge-factory), LangChain, November 21, 2026.
- [LangChain Documentation](https://docs.langchain.com/)
