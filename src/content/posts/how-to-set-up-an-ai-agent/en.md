---
title: "How to Set Up an AI Agent"
description: "When starting a new project and wanting to use an AI Agent to support coding, many people immediately jump to installing an agent and asking it to implement a feature. Before handing over the first task, it is worth preparing a few basic components: a runtime, model configuration, AGENTS.md, Skills, MCP, project knowledge, Git, build and test commands, task management and permissions."
slug: "how-to-set-up-an-ai-agent"
locale: "en"
translationKey: "how-to-set-up-an-ai-agent"
pubDate: 2026-10-01T20:31:16+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 11
---

When starting a new project and wanting to use an AI Agent to help with coding, many people immediately do one thing:

```text
Install AI coding agent
        ↓
Open project
        ↓
"Implement this feature"
```

This can work for simple tasks. But as the project grows, the Agent quickly runs into familiar problems:

* It doesn't understand the project's architecture.
* It doesn't know the coding convention.
* It doesn't know which command to use to build and test.
* It has no context about business rules.
* It doesn't know which version of the library documentation is in use.
* It can't access GitHub, Notion or the browser.
* It finishes the code but doesn't verify it itself.
* Long tasks get cut off halfway.

So before handing over the first task to an AI Agent, it's worth preparing a few basic components.

The goal of this article is not to build an AI Agent platform. This is just a **practical setup checklist for a coding project**.

A relatively complete setup might look like:

```text
Project
│
├── Agent Runtime
├── Model / Provider
├── AGENTS.md
├── Skills
├── MCP
├── Project Knowledge
├── Git / GitHub
├── Task Management
├── Build / Test
├── Quality Rules
├── Long-running Workflow
└── Permissions
```

Not every project needs all of it. Start with the components you actually need.

---

## 1. Choose an Agent Runtime

First you need to choose the tool the Agent will use to work with the repository.

Some common options:

* OpenCode
* Claude Code
* OpenHands
* Aider
* Codex
* GitHub Copilot coding agent

The Agent Runtime is usually responsible for:

* reading files
* editing code
* calling the model
* using tools
* running commands
* receiving results from tools
* continuing a task across multiple steps

With a coding agent, what matters isn't only the model but also the **environment the Agent is allowed to act in**.

For example:

```text
Agent
  ↓
Read repository
  ↓
Edit files
  ↓
Run command
  ↓
Read result
  ↓
Edit again
```

OpenAI also describes components like shell, file editing, MCP, skills and `AGENTS.md` as the important primitives when building a coding-agent workflow.

After choosing a runtime, check:

```bash
<agent> --version
```

and read the CLI help:

```bash
<agent> --help
```

Don't copy setup commands from an old article if your CLI has changed.

---

# 2. Configure Model / Provider

The Agent needs a model to reason and generate code.

Depending on the runtime, you can use:

* OpenAI
* Anthropic
* Google Gemini
* DeepSeek
* or whatever provider the runtime supports.

You'll usually need an API key or authentication.

For example, as an environment variable:

```bash
export OPENAI_API_KEY="..."
```

On PowerShell:

```powershell
$env:OPENAI_API_KEY="..."
```

Don't commit the API key to the repository.

It's worth checking that the Agent can call the model before setting up the other components:

```text
Start Agent
    ↓
Ask simple question
    ↓
Agent responds
```

If this step doesn't work yet, don't move on to configuring MCP, Skills or workflows.

---

# 3. Create `AGENTS.md`

This is one of the first things you should set up.

`AGENTS.md` is where you keep the instructions the Agent must follow when working in the repository.

For example:

```text
project/
├── AGENTS.md
├── src/
├── tests/
├── docs/
└── README.md
```

A simple file:

```markdown
# Project Instructions

## Project

This is a Java Spring Boot application.

## Architecture

- Follow the existing architecture.
- Do not introduce a new architectural pattern without justification.
- Keep business logic out of controllers.

## Development

- Use the existing dependency versions.
- Follow existing naming conventions.
- Reuse existing utilities before creating new ones.

## Testing

- Add tests for new business logic.
- Run the relevant test suite after changes.

## Git

- Do not commit secrets.
- Keep commits focused.
- Do not modify unrelated files.
```

`AGENTS.md` is now supported by many coding-agent tools. GitHub Copilot, for instance, supports `AGENTS.md` as agent instructions and can apply instructions based on their location in the repository.

An important principle is **don't turn `AGENTS.md` into a giant documentation book**.

It should contain the rules the Agent needs to know regularly.

---

# 4. Set Up Skills

After Rules come Skills.

If `AGENTS.md` answers:

> "Which rules must the Agent follow?"

then a Skill answers:

> "When doing this kind of task, which workflow should the Agent follow?"

For example:

```text
skills/
├── debugging/
├── code-review/
├── testing/
├── api-design/
└── database-migration/
```

A Skill for debugging might instruct:

```text
1. Reproduce the issue.
2. Inspect logs.
3. Identify the failing component.
4. Find the root cause.
5. Implement the smallest fix.
6. Add or update tests.
7. Run regression tests.
```

Skills are especially useful for workflows that get used repeatedly.

OpenAI now describes Skills as instructions that can be stored as Markdown, optionally with resources and scripts, and that suit a specific workflow.

You don't need to create dozens of Skills from the start.

A project can begin with:

```text
code-review
debugging
testing
```

Then add more as recurring workflows show up.

---

# 5. Set Up MCP

Once the Agent has Rules and Skills, the next step is giving it access to the systems it needs.

MCP can be used to connect the Agent with external tools.

For example:

```text
Agent
 │
 ├── GitHub MCP
 ├── Notion MCP
 ├── Playwright MCP
 └── Other MCP servers
```

MCP doesn't replace the Agent Runtime. It provides a standard for clients/Agents to connect to tools and the capabilities exposed by an MCP server.

### GitHub

If the Agent works with GitHub often, you can use the GitHub MCP Server or the GitHub CLI.

Alongside MCP, the `gh` CLI is still very useful:

```bash
gh auth login
```

Check authentication:

```bash
gh auth status
```

The GitHub CLI officially supports `gh auth login` for authenticating and `gh auth status` for checking status.

### Context7

Context7 is an MCP/CLI for pulling up-to-date library documentation directly into the coding workflow. Context7 now supports setup for many coding agents, including OpenCode.

Example of automatic setup:

```bash
npx ctx7 setup --mcp
```

Or setup for OpenCode:

```bash
npx ctx7 setup --opencode
```

Context7 also provides an MCP endpoint:

```text
https://mcp.context7.com/mcp
```

and supports OAuth or an API key depending on how the client is configured.

After setup, you can ask the Agent:

```text
Use Context7 to check the documentation for the exact version
of the Spring Boot library used by this project.
```

This is useful when the Agent needs to work with a specific API or framework version.

### Playwright

If the project has a frontend or a web application, Playwright MCP can help the Agent interact with the browser.

The official setup uses:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

Playwright MCP requires Node.js 20 or higher and provides browser automation through MCP.

After setup, the Agent can carry out a workflow like:

```text
Start application
      ↓
Open browser
      ↓
Navigate to page
      ↓
Perform action
      ↓
Observe result
      ↓
Fix code
```

Don't install Playwright MCP if the project is backend-only and the Agent doesn't need a browser.

---

# 6. Prepare Project Knowledge

The Agent needs to know the project before it starts changing code.

At minimum you should have:

```text
README.md
Architecture documentation
API documentation
Database documentation
Development guide
```

For example:

```text
docs/
├── architecture.md
├── api.md
├── database.md
└── development.md
```

A good README should answer:

```text
What is this project?
How do I run it?
How do I build it?
How do I test it?
What are the major components?
Where are the important directories?
```

This is usually worth more than immediately building a complex RAG system.

If the documentation lives in Notion, you can connect Notion MCP so the Agent can access it instead of copying all the documentation into the prompt.

---

# 7. Prepare Git and GitHub

The AI Agent will change source code. So Git is a very important layer of protection.

Before handing over a task:

```bash
git status
```

Make sure the working tree is in a state you understand.

Then check:

```bash
git remote -v
```

If you use the GitHub CLI:

```bash
gh auth status
```

A safe workflow:

```text
Clean working tree
       ↓
Create branch
       ↓
Agent modifies code
       ↓
Review diff
       ↓
Run tests
       ↓
Commit
       ↓
Pull Request
```

Don't let the Agent work directly on the production branch if your team's workflow doesn't allow it.

---

# 8. Prepare Build and Test

This is a very important step that often gets skipped.

The Agent needs to know **how to verify the code**.

For example, Java:

```bash
./mvnw test
```

Node.js:

```bash
npm test
```

Go:

```bash
go test ./...
```

Python:

```bash
pytest
```

It's not enough to have tests. The Agent needs the exact command.

You can write it in `AGENTS.md`:

```markdown
## Verification

Build:

./mvnw clean package

Unit tests:

./mvnw test

Integration tests:

./mvnw verify
```

GitHub also recommends that custom instructions for coding agents describe the project structure, how to build, format, lint, test, and the requirements before merging a Pull Request.

When the Agent changes code:

```text
Change
  ↓
Build
  ↓
Test
  ↓
Failure?
 ├── Yes → Analyze → Fix → Test again
 └── No  → Continue
```

This is one of the key conditions for the Agent to be able to verify its own results.

---

# 9. Set Up Task Management

If you only use a prompt:

```text
"Implement payment retry."
```

it's very hard for the Agent to know what context the task sits in.

Better for the task to have:

```text
Title
Description
Acceptance Criteria
Technical Context
Dependencies
Expected Result
```

You can use:

* GitHub Issues
* Linear
* Jira

Example:

```text
Issue #123

Implement payment retry

Acceptance Criteria:
- Retry failed payments up to 3 times.
- Use exponential backoff.
- Do not duplicate successful payments.
- Add unit tests.
```

The Agent can take the issue as the source of truth instead of receiving a prompt that's too short.

---

# 10. Set Up a Long-running Workflow

Some tasks can't be completed in a single model response.

For example:

```text
Analyze
 ↓
Implement
 ↓
Test
 ↓
Failure
 ↓
Debug
 ↓
Fix
 ↓
Test
 ↓
Review
```

If your Agent Runtime supports long-running/background execution, use that capability.

If not, you can use a Ralph-style loop or a worker to carry the task across multiple iterations.

What matters is that the task has **state and completion criteria**.

For example:

```text
Task is DONE when:

- Implementation completed
- Tests pass
- Build passes
- No unresolved errors
- Diff reviewed
```

Don't use:

```text
while true
```

without a stopping condition.

A long-running agent doesn't mean the Agent runs forever. It means the Agent can continue a task across multiple steps or multiple execution cycles.

---

# 11. Set Up Permissions

Before giving the Agent permission to run commands, you need to check what it's allowed to do.

For example:

```text
Read source       → Allowed
Edit source       → Allowed
Run tests         → Allowed
Git commit        → Maybe allowed
Push              → Review
Delete files      → Restricted
Production deploy → Human approval
```

Be especially careful with:

```text
rm
database commands
cloud CLI
production credentials
deployment commands
secret files
```

If the Agent has shell access, use permission controls or a sandbox that fits the runtime.

With a coding agent, the simple principle is:

> **Give the Agent enough permission to complete the task, but not more permission than it needs.**

---

# 12. Finally: run a "setup check"

After finishing the steps above, don't immediately hand over a big feature.

Give the Agent a small task to check the environment.

For example:

```text
Before making any code changes:

1. Read AGENTS.md.
2. Inspect the repository structure.
3. Identify the main application entry point.
4. Identify the build command.
5. Identify the test command.
6. Check the current Git status.
7. Identify available MCP tools.
8. Identify relevant Skills.
9. Identify the main project documentation.
10. Do not modify any files yet.

Report:
- Project structure
- Technology stack
- Build command
- Test command
- Important rules
- Available tools
- Missing information
```

This is a very useful step because it shows whether the Agent has actually understood the environment.

If the Agent answers:

```text
Build: ./mvnw clean package
Test: ./mvnw test
Architecture: Hexagonal
Main module: payment-service
Rules: AGENTS.md
```

then you can start handing over implementation tasks.

---

# 13. What should the minimum setup be?

Not every project needs the whole stack.

If I just want to get started quickly, I'd set things up in this order:

```text
1. Agent Runtime
       ↓
2. Model / Provider
       ↓
3. AGENTS.md
       ↓
4. Git
       ↓
5. Build / Test
       ↓
6. Skills
       ↓
7. MCP
```

Only then add the things you actually need:

```text
Notion
Context7
GitHub MCP
Playwright
Task Management
Long-running workflow
```

Example of a backend project:

```text
Agent Runtime
+
Model
+
AGENTS.md
+
Skills
+
Git
+
Tests
+
GitHub
+
Context7
```

A web project:

```text
Backend stack
+
Playwright MCP
```

A project with large documentation:

```text
Project
+
Notion
+
Knowledge / RAG
```

A task that takes many hours to complete:

```text
Project
+
Long-running execution
```

Don't install a tool just because it's popular.

---

# Final Checklist

Before handing over the first task to an AI Agent, you can check:

```text
[ ] Agent Runtime installed
[ ] Model / Provider configured
[ ] AGENTS.md created
[ ] Skills configured
[ ] Required MCP servers connected
[ ] Project documentation available
[ ] Git configured
[ ] GitHub authenticated
[ ] Build command verified
[ ] Test command verified
[ ] Task source defined
[ ] Long-running workflow configured if needed
[ ] Agent permissions reviewed
```

Only then:

```text
Task
 ↓
Agent
 ↓
Understand
 ↓
Plan
 ↓
Implement
 ↓
Test
 ↓
Review
 ↓
Done
```

The most important point isn't how many MCPs or how many Skills you have.

A well-set-up Agent is one that **knows what the project is, which rules it must follow, which tools are available, where to get context, how to run tests, and when a task is genuinely considered complete**.

When those things are prepared in advance, the prompt for each task can be much simpler:

```text
Implement issue #123.

Follow the project rules,
use the relevant skills and tools,
run the required tests,
and do not consider the task complete
until the acceptance criteria are satisfied.
```

That's the setup step that really matters before you start using AI Agents to code.
