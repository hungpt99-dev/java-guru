---
title: "Kiro: From AI Coding Agent to Spec-Driven Development"
description: "If you've used Cursor, Windsurf, Claude Code or OpenCode, you may be wondering what Kiro does differently."
slug: "kiro-tu-ai-coding-agent-den-spec-driven-development"
locale: "en"
translationKey: "kiro-tu-ai-coding-agent-den-spec-driven-development"
pubDate: 2026-10-02T15:43:26+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 9
---

If you've already used Cursor, Windsurf, Claude Code or OpenCode, you may be wondering: **what does Kiro do differently?**

An AI IDE helps developers write code with AI. An AI Coding Agent lets developers hand off a task so the AI can carry it out itself. Kiro has those capabilities too, but it adds another layer of structure to the development process: **Requirement → Specification → Design → Tasks → Agent → Implementation**.

This is **Spec-Driven Development**, and it's also the most important thing to understand about Kiro.

![image.png](/images/articles/kiro-tu-ai-coding-agent-den-spec-driven-development/figure-1.png)

## 1. From AI Coding Assistant to AI Coding Agent

At first, AI coding mostly played the role of a **Coding Assistant**. The developer writes code, asks the AI how to implement a function, explain an error or refactor a piece of code. The AI assists, while the developer still directly drives the development process.

AI IDEs like Cursor or Windsurf took this model further by letting the AI understand more about the codebase and make changes across multiple files. Then AI Coding Agents like Claude Code or OpenCode changed the way of working again: instead of asking the AI to write each piece of code, the developer can hand an entire task to the agent.

For example, instead of saying “Create a login API”, the developer can hand off a complete piece of work such as implementing authentication, adding login and refresh token, updating the database, writing tests and running them. The agent will read the repository itself, find the relevant files, edit the code, run commands and check the results.

This is a big step forward because the AI starts **doing the work**, instead of only assisting the developer step by step.

But as agents become more powerful and autonomous, a new problem appears: **the agent needs to know exactly what the developer wants to build and how the project requires it to be done.**

A simple prompt may be enough for a function. But for a large feature, a prompt very easily lacks requirements, lacks context or contains assumptions that the developer and the AI understand differently. This is the problem Kiro focuses on solving.

## 2. Spec-Driven Development: the Backbone of Kiro

The most important point about Kiro is **Spec-Driven Development**.

Instead of starting directly with a prompt and then letting the agent reason about everything, Kiro takes requirements through a more structured process: **Requirements → Design → Tasks → Implementation**.

Requirements define what the system needs to do. Design describes how to solve it technically. Tasks break the work into concrete steps the agent can carry out.

For example, instead of only having a requirement:

> “Add payment integration.”

The specification can clarify the payment provider, the API contract, error handling, retry, idempotency, database changes and acceptance criteria. Then the design determines how to implement it and the tasks break the feature into concrete pieces of work.

This solves a very big pain point of AI Coding Agents: **AI can write code very fast, but if the input isn't clear, it can still build the wrong thing.**

The spec creates an intermediate layer between the requirement and the code. The developer can review the requirements, look at the design, check the tasks and only then let the agent start implementation.

So Spec-Driven Development isn't simply “writing more documentation”. It changes how we hand work to AI. The specification becomes a structured input that both the developer and the agent rely on during development.

## 3. Steering: keeping the project's context and rules

The specification answers the question **what the feature needs to do**, but there's still another question: **how must the agent build it?**

Every project has its own rules. A project may use Hexagonal Architecture, a specific naming convention, its own way of organizing the repository, or require that all APIs have tests. If the developer had to repeat these things every time they hand off a task, the prompt would grow longer and longer.

This is where **Steering** becomes useful.

Steering lets project rules, conventions and context be put into a long-lived instruction layer that the agent uses while working. Instead of continuously telling the AI “follow this architecture” or “don't change that module”, this information can become part of the project context.

This is especially useful for large projects or teams with many people. The AI doesn't only know the current task, it also has more context about **how the project is built**.

If the Spec answers “what are we building”, Steering helps answer “by what principles is this project built”.

## 4. Hooks: bringing automation into the workflow

When AI starts doing more work, developers also have to deal with more workflow. There are steps that repeat over and over, like running tests, formatters, commands or some validation after code changes.

**Hooks** let actions like these be triggered based on specific events instead of the developer having to remember and do them manually.

The idea isn't new, and Kiro isn't the only one with event-driven automation. What's worth noting is that Hooks are placed together with the specification, the project context and the agent workflow.

That makes automation part of the process of working with AI instead of just a script sitting outside it.

For example, a code change can trigger a check action, or a step in the workflow can automatically run the necessary command. As the agent works more and more autonomously, reducing these manual and repetitive steps makes the workflow more stable.

## 5. Skills and Custom Agents: specializing the AI

A software project doesn't have just one kind of work. Requirement analysis, implementation, testing, code review or security review all need different contexts and approaches.

If one agent has to do everything, it will have to carry a lot of instructions and capabilities.

Kiro supports **Skills** and **Custom Agents** to specialize how the AI performs each kind of work.

Skills can provide the capability or knowledge a task needs. Custom Agents let you define agents with a more suitable role and instructions.

For example, one agent can focus on backend implementation, while another specializes in testing or code review.

This opens up an approach close to how a real software team operates: instead of one AI doing everything, there can be different AI capabilities for different parts of the workflow.

The important point remains that these capabilities shouldn't be looked at in isolation. Their value lies in being able to operate in the context of the specification and the project rules.

## 6. Kiro Crew: from AI Agent to AI Worker

If AI Coding Agents are mainly used in the style of the developer handing off a task and then following the agent, **Kiro Crew** takes the idea one step further: AI can become a worker for longer-running work.

This is the difference between an interactive agent and a long-running worker.

With an interactive agent, the developer usually works in a loop: hand off the task, the agent does it, the developer reviews and then continues. With a worker, the developer can hand off the work and let the AI keep processing without having to sit in front of the IDE continuously.

This suits tasks that don't need the developer to watch every step. The AI can keep doing the work over a longer period of time and the developer comes back to review the result.

Crew therefore extends the AI's role from **assistant** to **worker**.

This is also an important step when looking at Kiro in the context of AI-native development. When AI doesn't just assist the developer but can become a worker on the team, the way we design workflows also starts to change.

## 7. Kiro's difference lies in the workflow

Looking at each feature individually, there isn't that much that could be called completely new. Other AI IDEs have agents too. Other coding agents support MCP too. Many frameworks have skills, custom agents and automation.

So Kiro's notable point isn't a single feature but **how the components are connected into a workflow**.

You can picture it like this:

**Requirement → Specification → Design → Tasks → Agent → Context → Implementation → Verification → Automation → Long-running Work**

The specification makes the requirement structured. Steering provides context and rules. Tasks break the work down. The agent carries out the implementation. Skills and Custom Agents provide the right capability. Hooks support automation. Crew extends the agent into a worker that can handle longer-running work.

Seen this way, Kiro isn't just trying to make AI **code better**. It's trying to make **the process of AI taking part in software development more structured**.

This is the important point when comparing Kiro with other AI coding tools. Instead of only asking “which AI codes better?”, another question worth caring about is: **where is the AI placed in the development workflow?**

## 8. When AI starts taking part in the software development workflow

AI coding is gradually expanding its scope.

At first AI helped write code. Then AI understood the repository. Next AI could carry out tasks itself. And the next step is AI starting to take part in the **workflow**.

At that point, the problem is no longer only code generation.

An agent can write Java code very well but still not know whether the business requirement is correct. It can implement a feature but not know which project rules need to be followed. It can complete a task but the developer still has to run the verification steps and manage the whole context themselves.

For AI to genuinely take part more deeply in software development, we need artifacts and mechanisms that help the agent understand the work in a larger context.

The specification defines the requirement. The design defines the solution. Steering provides project context. Tasks define execution. Skills and Agents provide capability. Hooks support automation. Crew extends execution into long-running work.

When these components connect with each other, AI starts to become part of the **development process**, instead of just a tool for writing code.

## 9. From Prompt-Driven Coding to Spec-Driven Development

Broadly, Kiro represents a trend of shifting from **Prompt-Driven Coding** to **Spec-Driven Development**.

In the simple model, the developer writes a prompt, the AI generates code and the developer reviews. When AI becomes a coding agent, the developer starts handing off tasks. But as the tasks grow larger, simple prompts and task descriptions are no longer enough to hold the entire context.

A request like “Build a notification service” can pull in a lot of questions: email or push notification, how to retry, whether there's a queue, what about idempotency, what the API contract looks like, what changes in the database and what the acceptance criteria are.

If all of it sits in one long prompt, managing context becomes difficult.

Spec-Driven Development turns this information into clearer artifacts. The developer can review the requirement and the design before the agent writes code. Tasks help the agent know what needs to be done. Project context helps the agent know which rules must be followed.

The important point is that the specification creates an intermediate layer between **what we want** and **how AI implements it**.

As AI becomes more and more capable of doing the work itself, this intermediate layer becomes more important. We don't just need an AI that knows how to code. We need an AI that understands **the goal, the context and how the work must be done**.

## 10. Conclusion

Kiro isn't just a story about an AI IDE or a more powerful AI Coding Agent. What's worth noting is how Kiro puts **Spec-Driven Development** at the center of the process of working with AI.

From Requirement to Specification, Design, Tasks and then Agent Implementation, Kiro adds components like Steering to hold context, Hooks for automation, Skills and Custom Agents to specialize capability, and Kiro Crew to extend the agent into workers that can carry out longer-running work.

The individual components aren't necessarily new. But when they're connected into a workflow, the way developers work with AI starts to change.

AI is no longer only used to answer prompts or generate code. AI starts receiving requirements, understanding project context, carrying out tasks, running workflows and taking part in the process of building software.

That's exactly what makes Spec-Driven Development worth paying attention to in the age of AI Coding Agents.

**From Prompt-Driven Coding, we're moving toward a model in which the specification becomes how humans define the work and AI becomes the system that executes that work.**
