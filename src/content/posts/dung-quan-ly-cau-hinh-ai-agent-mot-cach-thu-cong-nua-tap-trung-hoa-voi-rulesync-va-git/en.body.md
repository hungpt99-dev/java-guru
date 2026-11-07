

*A single repository to manage Skills, Hooks, MCP, Rules and the entire AI Agent configuration.*

## 1. The problem with using multiple AI Agents

AI Coding Agents are gradually becoming a familiar part of the software development process.

Today, a developer might use Claude Code to analyze and handle complex problems, OpenAI Codex to implement code, Gemini CLI to experiment, or OpenCode for everyday coding tasks.

Each tool has its own strengths and ecosystem.

However, once you use multiple AI Agents, you'll soon run into a problem: **Fragmented configuration.**

For example:

- Claude Code has its own system of Rules, Skills, Hooks and MCP.
- Codex has `AGENTS.md`, Skills and its own configuration.
- OpenCode has its own system of Agents, Plugins and configuration.
- Gemini CLI also has its own Settings and extension mechanism.

Now imagine you want to create a Skill called `security-audit`.

You want every AI Agent to understand the same set of security standards, follow the same code review process, and use the same set of necessary tools.

But instead of defining it once, you have to maintain a different configuration version for each agent.

The same problem applies to:

- Coding standards.
- Security guidelines.
- MCP server definitions.
- Hooks.
- Custom commands.
- Subagents.
- Permissions.

Over time, the configurations start to diverge. A change on Claude Code is not automatically propagated to Codex or OpenCode.

Not to mention, when you set up a new machine or VPS, you have to go through the entire configuration process from scratch.

This isn't really an AI problem.

It's a **Configuration Management** problem.

## 2. What if managing AI Agents were like managing Infrastructure?

In DevOps, we've been solving similar problems for a long time.

Instead of configuring each server by hand, we use:

- Ansible to manage configuration.
- Terraform to declare infrastructure.
- Git for version control.
- Docker to create reproducible environments.

The general principle is very simple:

**Declare configuration once, manage it with Git, and be able to reproduce it across environments.**

So why not apply the same principle to AI Agents?

Imagine you have a Git repository containing your entire AI Agent configuration.

```text
ai-agent-config/
├── .rulesync/
│   ├── rules/
│   ├── skills/
│   ├── commands/
│   ├── subagents/
│   ├── hooks.jsonc
│   ├── mcp.jsonc
│   └── permissions.jsonc
│
├── rulesync.jsonc
└── README.md
```

This repository becomes the single source of truth for configuration.

Instead of maintaining multiple configuration versions for each AI Agent, we manage one shared configuration source and generate it into the format corresponding to each supported tool.

This is exactly the idea behind Rulesync.

## 3. What is Rulesync?

[Rulesync](https://github.com/dyoshikawa/rulesync) is an open-source CLI tool built to synchronize configuration across multiple AI Coding Agents.

Rulesync's core idea is to provide a common configuration management workflow for many different AI tools.

Instead of maintaining multiple configuration formats yourself, developers can use Rulesync to generate the corresponding configuration for the supported agents.

The components that can be managed or generated, depending on each agent's level of compatibility:

| Component | Function |
|---|---|
| Rules | Coding guidelines and standards |
| Skills | Reusable capabilities |
| Hooks | Automation on lifecycle events |
| MCP | External tool and integration definitions |
| Commands | Reusable prompts and workflows |
| Subagents | Specialized AI agents |
| Permissions | Tool access and execution permissions |

An important distinction: Rulesync is not an AI Agent Runtime.

It doesn't run AI Agents directly, doesn't host MCP Servers, and doesn't orchestrate conversations.

It focuses on standardizing, synchronizing and generating configuration.

You can think of Rulesync as a Configuration Compiler for AI Coding Agents.

## 4. How does Rulesync work?

The architecture is relatively simple:

```text
              Private Git Repository
                  ai-agent-config
                         |
                         |
                    .rulesync/
                         |
          +--------------+--------------+
          |              |              |
        Rules          Skills           MCP
          |              |              |
          +--------------+--------------+
                         |
                    Rulesync CLI
                         |
                  Generate Config
                         |
          +--------------+--------------+
          |              |              |
      Claude Code      Codex         OpenCode
          |              |              |
      Native Config  Native Config  Native Config
```

The workflow has three main steps.

### Step 1: Declare the configuration

Create Rules, Skills, Hooks and MCP definitions in the repository.

For example, a Skill for security audits:

```text
security-audit/
├── SKILL.md
└── references/
    ├── owasp.md
    └── secure-coding.md
```

This Skill defines how AI Agents inspect code to detect security vulnerabilities.

### Step 2: Generate the configuration

Run the command:

```bash
rulesync generate
```

Rulesync will generate the configuration files corresponding to the agents that have been declared.

### Step 3: Use the native configuration

The supported AI Agents read the configuration in their own format.

Developers don't need to copy and maintain the same set of Rules on each tool themselves.

However, not every agent supports every feature. You need to check the compatibility matrix and the generated output before using it in practice.

## 5. Git-Native: Managing one configuration across multiple machines

This is probably the most interesting part of this architecture.

We don't need to deploy a configuration management server.

No database needed.

No dashboard needed.

No need to maintain an additional backend service.

Only Git.

For example, you have three development environments:

```text
                Private GitHub Repository
                   ai-agent-config
                          |
           +--------------+--------------+
           |              |              |
        MacBook        Ubuntu VPS     Workstation
           |              |              |
        Rulesync       Rulesync       Rulesync
           |              |              |
        Claude          Codex         OpenCode
        Codex           Hermes*       Claude
        OpenCode
```

Each machine clones the same repository.

When you update a Skill on your MacBook:

```bash
git add .
git commit -m "Add Java security audit skill"
git push
```

On the VPS:

```bash
git pull
rulesync generate
```

The supported AI Agents can use the new configuration.

No additional centralized service required.

*Note: Hermes and other agents need to be checked separately for native configuration compatibility. You shouldn't assume that Rulesync fully supports all of their features.*

### Why is this useful?

Imagine you've just created a new Ubuntu VPS.

Instead of installing and configuring each AI Agent from scratch, you just need to:

1. Clone the configuration repository.
2. Install Rulesync.
3. Generate the configuration for the corresponding agents.
4. Verify and start using it.

Your working environment can be reproduced more consistently.

This is also a suitable approach when you use multiple computers or frequently change development environments.

## 6. Global Configuration and Project Configuration

One thing worth considering when designing an AI Agent management system is the scope the configuration applies to.

Not every configuration should apply to every project.

For example:

**Global Configuration**

Applies to the entire development environment:

- General security rules.
- Coding standards.
- Git usage rules.
- Shared Skills.
- Shared MCP servers.

**Project Configuration**

Applies only to one specific repository:

- The project's architecture.
- Project-specific coding conventions.
- Business rules.
- Project-specific MCP servers.
- Skills dedicated to the project.

For example:

```text
Global Configuration
        |
        +-- Java Development
        +-- Security Audit
        +-- Git Workflow
        +-- General Coding Rules

Project: Payment Service
        |
        +-- Payment Domain Rules
        +-- Transaction Skills
        +-- Payment MCP
        +-- Architecture Guidelines
```

This split helps avoid pushing too much irrelevant context into every AI Agent.

Note that Rulesync has a Global Mode, but managing separate profiles per environment and per project needs to be designed according to the tool's actual supported mechanisms.

## 7. Things Rulesync doesn't solve

You shouldn't see Rulesync as a solution for managing the entire AI Agent ecosystem.

It has limitations you need to understand clearly:

- It doesn't run or manage the AI Agent lifecycle.
- It doesn't host MCP servers.
- It doesn't automatically sync Git across machines.
- It doesn't manage API keys or OAuth tokens for you.
- It doesn't guarantee that every agent supports all features the same way.
- It doesn't replace an AI Agent Orchestrator.

Rulesync's role lies mainly in Configuration Management and Synchronization.

If you want to automate syncing across multiple machines, we still need a Git workflow or a separate script.

In particular, you shouldn't commit API keys, OAuth tokens, authentication files or `.env` into the repository, even a private repository.

## 8. Conclusion

As the number of AI Coding Agents grows, manually managing configuration will become increasingly inconvenient.

Each tool has its own ecosystem, its own configuration format and its own way of organizing things.

Instead of accepting the maintenance of multiple independent configuration sets, we can approach this problem the way we manage Infrastructure:

- Git as the Single Source of Truth.
- Rulesync handles generating and synchronizing configuration.
- Each AI Agent uses its corresponding native configuration.
- Each machine can reproduce the environment from the same repository.

This is not a solution that turns all AI Agents into a single tool.

The goal is to help them share the same set of rules, skills and configuration without having to maintain everything by hand.

**When you can already manage Infrastructure as Code, why not manage AI Agent Configuration with Git?**

---

### References

- [Rulesync – GitHub](https://github.com/dyoshikawa/rulesync)
- [Rulesync – Documentation](https://rulesync.dyoshikawa.com/)
- [Rulesync – Supported Tools](https://rulesync.dyoshikawa.com/reference/supported-tools.html)
