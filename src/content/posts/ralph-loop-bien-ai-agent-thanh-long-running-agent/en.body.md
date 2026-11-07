

AI Agents are changing the way we build software. Today's coding agents are no longer just autocomplete tools or chatbots that answer questions about code. They can read an entire repository, analyze requirements, edit multiple files, run commands, write tests, debug, and carry out a chain of actions to complete a task.

But when you start handing AI larger jobs, a problem quickly appears: **an AI agent is usually designed to complete a single work session, while software development is a process that stretches across many steps.**

You can ask the agent to build a large feature. It will start analyzing, writing code, running tests and fixing errors. But at some point the session ends, the context becomes too large, or the agent decides the work is complete enough. You have to open a new session and explain what happened before.

This is one of the problems that **Ralph Loop**, also known as the **Ralph Wiggum technique**, tries to solve.

The interesting thing is that the idea isn't complex at all. According to Geoffrey Huntley, who popularized the technique, Ralph is essentially just a loop that runs an AI agent many times. The simplest version can be pictured as a shell loop: give the same prompt to the agent, let the agent do the work, and when the agent finishes, run a new instance.

```text
while not done:
    run AI agent
```

At a glance it's almost too simple. But that simplicity is exactly what creates an important shift in how we use AI Agents.

## From One-Shot Agent to Long-Running Agent

Imagine a project with 30 tasks:

```text
Authentication
User Management
Product Management
Shopping Cart
Order Management
Payment
Notification
Admin
Testing
Documentation
...
```

The usual way of using an AI Agent tends to look like:

```text
Human
  ↓
Prompt
  ↓
AI Agent
  ↓
Code
  ↓
Human
```

The developer has to keep steering the agent:

```text
Implement authentication.

→ Done

Now implement product management.

→ Done

Continue with order management.

→ Done

Fix the failing tests.

→ Done
```

AI is still very useful, but the human remains a manual coordinator.

Ralph Loop changes this model into:

```text
                Goal
                 ↓
             AI Agent
                 ↓
              Work
                 ↓
              Verify
                 ↓
          Is it complete?
            /          \
          No            Yes
          ↓              ↓
     New iteration      Done
          │
          └──────────────→
```

The agent doesn't need to finish the whole project in a single run. It only needs to make progress in the current iteration.

The next iteration looks at the project's new state and continues.

This is the key point: **Ralph doesn't try to stretch a single AI session. It stretches the work by creating many AI sessions.**

## Fresh Context: Forget the Conversation, Don't Forget the Project

One of the most important characteristics of Ralph Loop is that each iteration can begin with a fresh context.

At first hearing, that sounds like a drawback.

If the agent has already spent time understanding the project, why reset the context?

Because a long context isn't always a good thing.

In a long session, the context can hold requirements, conversation history, tool output, logs, code snippets, debugging attempts and a lot of intermediate information. As the amount of information grows, the agent has to process more and more data to determine what actually matters.

Ralph Loop takes a different approach: **don't try to turn the conversation into long-term memory.**

Instead, the project's state is stored outside the conversation.

For example:

```text
Project
├── source code
├── tests
├── README
├── task list
├── progress.md
└── git history
```

The first iteration might implement authentication.

When the agent finishes, the code has changed and progress has been saved.

The second iteration starts with a fresh context. It reads the repository, checks the git diff, runs tests or reads the task list, and discovers that authentication is done. It doesn't need to remember the entire previous conversation in order to continue.

In other words:

> **The conversation is not memory. Project state is memory.**

This is a very important idea when building long-running AI agents. Some current Ralph implementations also use git, files, tests and progress files to maintain state between iterations.

## Ralph Loop Is Essentially a Feedback Loop

Ralph Loop doesn't make the model smarter.

It doesn't replace the AI's reasoning.

It also doesn't guarantee that the AI will always write correct code.

Ralph's value lies in the feedback loop.

An iteration can play out like this:

```text
Read requirement
      ↓
Implement feature
      ↓
Run tests
      ↓
Tests fail
      ↓
Inspect failure
      ↓
Fix code
      ↓
Run tests again
      ↓
Commit
      ↓
Next iteration
```

If the first iteration didn't finish the feature, the next iteration continues.

If the code has a bug, tests provide feedback.

If the requirement isn't met, verification detects the problem.

If all completion conditions are satisfied, the loop stops.

So Ralph Loop works best when the project has a **clear definition of done and verifiable feedback**.

Automated tests, linting, type checking, build validation and acceptance criteria all become important.

An agent can run 100 iterations, but without good feedback, 100 iterations don't mean 100 improvements.

## Ralph Loop Is Not a Specific Tool

A fairly common misunderstanding is that Ralph Loop is the name of a particular CLI.

In reality, **Ralph Loop is first of all a technique/pattern**, and there are many different implementations.

The agent underneath doesn't have to be a specific model or a specific product either.

You can picture the architecture like this:

```text
                Ralph Loop
                     │
          ┌──────────┼──────────┐
          ↓          ↓          ↓
     Claude Code   Codex    OpenCode
          │          │          │
          └──────────┼──────────┘
                     ↓
                 Project
```

Current implementations support or aim at various coding agents, including Claude Code, OpenAI Codex, OpenCode and other CLI agents.

This matters because it shows that Ralph Loop isn't a story about **"should I use OpenCode or Claude Code"**.

The bigger question is:

> **How can an AI agent keep executing a software engineering task across many contexts and many iterations?**

That's the problem Ralph Loop is solving.

## One Prompt That Can Run Many Times

A fairly interesting characteristic of Ralph is that the prompt doesn't necessarily have to change after each iteration.

For example, we might have a prompt like:

```text
Work on the project until the defined requirements are complete.

For each iteration:

1. Inspect the current project state.
2. Identify the highest-priority incomplete task.
3. Implement it.
4. Run relevant tests.
5. Fix failures.
6. Review the implementation.
7. Persist useful progress.
8. Continue with the remaining work.

Do not assume previous work is correct.
Use the repository as the source of truth.

Stop only when all requirements are satisfied
and the verification criteria pass.
```

The interesting part is that this prompt can be the same across many iterations.

The first agent reads the project and does the first task.

The second agent reads the **changed project** and does the next task.

The third agent continues from that state.

The prompt doesn't need to contain the entire conversation history.

This is the principle:

```text
Same Goal
   +
New Context
   +
Changed Project State
   =
Continuous Progress
```

## But Ralph Doesn't Mean "Run AI Infinitely"

This part is very important.

A Ralph Loop shouldn't simply be:

```text
while true:
    run AI
```

and hope the AI will eventually finish the project on its own.

If requirements are unclear, the agent can go in the wrong direction.

If tests aren't sufficient, the agent can misjudge the state.

If the task is too large, the agent can make unrelated changes.

If feedback is broken, the agent can repeat the same mistake.

The agent can even fall into a loop:

```text
Fix
→ Test fail
→ Fix
→ Test fail
→ Rewrite
→ Test fail
→ Rewrite
→ ...
```

So a production-ready Ralph Loop usually needs additional mechanisms such as iteration limits, completion criteria, progress tracking, retry handling and verification. Some current implementations also organize the workflow into phases like plan, implement, test, verify and review instead of just running an unstructured loop.

Ralph is simple at the concept level, but a system that uses Ralph well still needs engineering discipline.

## What Kind of Tasks Does Ralph Loop Suit?

Ralph Loop is especially suited to work with a relatively clear outcome.

For example:

```text
Implement REST API
Add CRUD functionality
Add test coverage
Refactor a module
Migrate an API
Implement a well-defined feature
Fix a collection of known bugs
Build a greenfield application from a specification
```

Conversely, highly exploratory tasks are harder.

For example:

```text
Find a completely new architecture.
Research an unknown problem.
Design the next generation of the platform.
```

In those cases, if you don't yet know exactly what "done" means, letting the agent loop on its own can produce a lot of work but not necessarily valuable progress.

**Ralph is more effective the clearer the objective and the more reliable the feedback.**

## Ralph Loop and the Future of AI Coding

What I find most interesting about Ralph Loop isn't the shell script or a specific CLI.

What's notable is that it represents a different way of thinking about AI Agents.

We usually ask:

> "How large is this model's context window?"

> "How well does this model reason?"

> "How good is this agent at coding?"

Those questions still matter. But when you want to build an agent that can work for many hours or many days, another question becomes just as important:

> **How will the agent continue the work once the current context ends?**

Ralph gives a very simple answer:

**Start again.**

Don't try to force a single agent to remember everything.

Let each iteration start with a fresh context, read the project's current state, do part of the work, and save what the next iteration needs.

From this angle, Ralph Loop isn't just a trick for running a coding agent longer. It's a pattern for **long-running agentic workflows**.

```text
Human
  ↓
Goal
  ↓
Agent
  ↓
Action
  ↓
Feedback
  ↓
Persist State
  ↓
Fresh Agent
  ↓
Action
  ↓
Feedback
  ↓
...
  ↓
Goal Achieved
```

Humans still define the goal, the constraints and the completion criteria. AI is responsible for doing many iterations to get closer to that goal.

This is also why I think Ralph Loop is worth noting despite the idea itself being extremely simple. It doesn't try to solve every AI Agent problem with a complex framework. It starts from a very practical observation:

**AI agents have finite context, but software projects can stretch on indefinitely.**

Instead of fighting that limit, Ralph Loop accepts it.

Context ends?

Fine.

A new iteration begins.

The agent forgets the conversation?

Fine.

The repository, tests, git and progress are still there.

The task isn't finished?

Run the next iteration.

And perhaps this is the most important idea behind Ralph Loop:

> **Long-running AI doesn't necessarily need a long conversation. It needs a feedback loop good enough to start over many times while still moving toward the same goal.**

Ralph Loop, after all, is very simple.

But sometimes a simple idea changes how we use a complex technology.

**AI accelerates execution. Humans own decisions.**
