---
title: "What Is UTCP? Understanding the Universal Tool Calling Protocol — A New Approach to AI Agent Tool Calling"
description: "While MCP is becoming a popular standard for connecting AI Agents to external tools, another protocol has appeared with a different approach: UTCP – calling tools directly through native endpoints without building an additional intermediary server."
slug: "utcp-la-gi-tim-hieu-universal-tool-calling-protocol-mot-huong-tiep-can-moi-cho-ai-agent-tool-calling"
locale: "en"
translationKey: "utcp-la-gi-tim-hieu-universal-tool-calling-protocol-mot-huong-tiep-can-moi-cho-ai-agent-tool-calling"
pubDate: 2026-11-08T11:56:10+07:00
category: "AI & AI Agents"
tags: ["AI", "AI Agent", "MCP"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 7
---

*While MCP is becoming a popular standard for connecting AI Agents to external tools, another protocol has appeared with a different approach: UTCP – calling tools directly through native endpoints without building an additional intermediary server.*

## 1. What is UTCP?

**UTCP (Universal Tool Calling Protocol)** is an open standard designed to standardize how AI applications, especially AI Agents, discover and call tools through many different communication protocols.

Instead of requiring every tool to be wrapped in its own server so that an AI Agent can use it, UTCP lets tools be described with metadata and provides the information needed for the client to call the corresponding endpoint directly.

The protocols that can be used include:

- HTTP / REST API
- WebSocket
- gRPC
- CLI
- Other transports through a plugin system.

The core philosophy of UTCP:

**If humans can interact with an API, AI should be able to do the same.**

In other words, if a system already provides an API for humans or other applications to use, we should be able to let AI Agents use that very API without building an extra wrapper layer dedicated to AI.

![image.png](/images/articles/utcp-la-gi-tim-hieu-universal-tool-calling-protocol-mot-huong-tiep-can-moi-cho-ai-agent-tool-calling/figure-1.png)

## 2. When did UTCP appear? Who develops it?

UTCP was introduced publicly in July 2025, in the context of a rapidly growing AI Agent ecosystem and an increasing need to integrate external tools.

### Timeline

| Time | Event |
| --- | --- |
| 15/07/2025 | The article introducing UTCP was published |
| 17/07/2025 | UTCP launched on Product Hunt |
| 2025 | The ecosystem began to expand with implementations and integrations |
| 2026 | Continued development of the specification, SDKs and integrations |

### The people behind UTCP

According to the official About page, some members of the team that develops and maintains the project include:

- **Razvan-Ion Radulescu:** Author of RFC UTCP 1.0.0, UTCP Admin, contact at Bevel Software.
- **Andrei-Stefan Ghiurtu:** UTCP Admin.
- **Ulugbek Isroilov:** UTCP Admin.
- **Juan Viera Garcia:** Distribution Team, Bevel Software.
- **Ali Raza:** Distribution Team, Bevel Software.
- **Kamil Mościszko:** Maintainer of the Go implementation.

UTCP is developed under an open-source model with community participation.

Project information:

- Website: [https://utcp.io/](https://utcp.io/)
- GitHub: [https://github.com/universal-tool-calling-protocol](https://github.com/universal-tool-calling-protocol)
- License: MPL-2.0

## 3. Why was UTCP created?

To understand why UTCP appeared, look at how tools are traditionally integrated in the AI Agent ecosystem.

Suppose you want to build an Agent capable of working with GitHub.

GitHub already provides a REST API:

```http
POST https://api.github.com/repos/{owner}/{repo}/issues
```

However, for an MCP Client to use this API, we usually have to deploy an MCP Server that acts as an adapter.

Architecture:

```text
AI Agent
    |
    v
MCP Client
    |
    v
MCP Server
    |
    v
GitHub REST API
```

The MCP Server is responsible for:

- Declaring the tools.
- Receiving requests from the MCP Client.
- Translating the request into a GitHub API request.
- Handling authentication.
- Returning the result to the client.

This approach is very useful in many cases. However, it also creates a new component that has to be developed and operated.

If there are 50 different systems, building and maintaining the corresponding adapters can produce a considerable amount of integration code.

UTCP proposes a different approach:

Instead of building an additional server for each system, describe how to call the tools in a standardized format, then let the client call the native endpoint directly.

That is the idea behind the concept UTCP calls the **Wrapper Tax**.

## 4. Overview of the UTCP architecture

UTCP has several important components:

### 4.1. Tool Manual

A Tool Manual is a document that describes the tools a provider offers.

It contains the information the client needs to discover and call a tool, such as:

- Tool name.
- Description.
- Input schema.
- Output schema.
- Provider / transport.
- Call template.
- Authentication configuration.

You can think of a Tool Manual as a description of the communication contract between the AI Agent and the tools.

### 4.2. UTCP Client

The UTCP Client is responsible for:

- Discovering the tools.
- Reading and managing the Tool Manual.
- Searching for suitable tools.
- Preparing the input parameters.
- Choosing the corresponding transport.
- Performing the tool invocation.
- Handling the returned results.

The important point is that the client does not need to use a single transport for all tools.

### 4.3. Provider / Transport

Each tool can be called through a communication method that suits the system providing it.

For example:

| Tool | Transport |
| --- | --- |
| GitHub API | HTTP |
| Internal service | gRPC |
| Browser automation | WebSocket |
| Local utility | CLI |

This lets UTCP integrate many kinds of systems without forcing them to change their current protocol.

### 4.4. Authentication

UTCP supports describing authentication information so that the client can use the appropriate authentication mechanism when calling tools.

However, describing authentication does not mean UTCP automatically guarantees the entire authorization and security of the system. Access rights still need to be controlled at the client, the provider and the native endpoint.

## 5. How does UTCP work?

Suppose the user requests:

"Create a GitHub issue with title Bug in payment service."

Overview of the flow:

**Step 1 – Discovery**

The UTCP Client fetches the Tool Manual from the provider.

**Step 2 – Tool Selection**

The AI Agent finds the tool:

```text
github.create_issue
```

**Step 3 – Parameter Generation**

The Agent generates the input:

```json
{
  "owner": "my-company",
  "repo": "payment-service",
  "title": "Bug in payment service",
  "body": "..."
}
```

**Step 4 – Invocation**

The UTCP Client uses the information in the Tool Manual to call the GitHub REST API directly.

```http
POST /repos/my-company/payment-service/issues
```

**Step 5 – Response**

GitHub returns the result to the UTCP Client, and the result is then passed to the AI Agent.

The difference is that no separate MCP Server needs to sit in between to proxy requests in this architecture.

## 6. How do UTCP and MCP differ?

Both aim to help AI Applications use external tools, but they take different architectural approaches.

| Criterion | MCP | UTCP |
| --- | --- | --- |
| Model | Client – Server | Client – Native endpoint |
| Tool discovery | MCP Server provides tools | Tool Manual |
| Tool invocation | Send requests through the MCP Server | Call the native endpoint |
| Transport | stdio, Streamable HTTP | HTTP, gRPC, WebSocket, CLI... |
| Wrapper | Usually requires an adapter server | Not mandatory |
| Extension | MCP Server and ecosystem | Provider / transport plugins |
| Goal | Standardize how AI communicates with tools | Standardize how tools are described and called |

Note: MCP also supports multiple transports, and not every MCP Server needs to be deployed as a standalone HTTP service. The comparison above focuses on the common integration architecture and the design philosophy of the two protocols.

UTCP does not necessarily have to replace MCP. The two approaches can coexist depending on system requirements.

## 7. The current UTCP ecosystem

UTCP does not stop at the specification; it already has implementations and integrations for many different development ecosystems.

Some notable projects:

| Project | Purpose |
| --- | --- |
| python-utcp | Official Python implementation |
| typescript-utcp | Official TypeScript implementation |
| go-utcp | Official Go implementation |
| langchain-utcp-adapters | Integration of UTCP with LangChain |
| pydantic-ai-utcp | Integration of UTCP with Pydantic AI |
| utcp-agent | An Agent that uses UTCP |

The projects can be found at the official GitHub Organization.

## 8. When should you use UTCP?

UTCP is worth considering in the following cases:

**Case 1: The system already has a REST API**

You want to let AI Agents use the existing APIs without writing an additional adapter server for each system.

**Case 2: There are many kinds of protocols**

The system needs to connect many tools that use HTTP, gRPC, WebSocket or CLI.

**Case 3: You want to reduce integration overhead**

You want to reduce the number of wrappers, middleware and components that have to be operated.

**Case 4: You want to build an AI Agent that can scale**

You want to add tools by declaring metadata instead of rewriting the integration logic for each tool.

However, if you need a central control layer, lifecycle or session management, or your own security policy, an MCP Server architecture or an intermediary gateway may still be more suitable.

## 9. Issues to consider when using UTCP

Calling native endpoints directly does not mean every integration problem disappears.

A production system still needs to solve:

- Credential management.
- Permission and authorization.
- Rate limiting.
- Timeout and retry.
- Audit logging.
- Network isolation.
- Tool discovery and metadata management.
- Version management of the Tool Manual.

In particular, when an AI Agent is allowed to execute CLI commands or call APIs capable of changing data, there needs to be a mechanism to control permissions and confirm sensitive operations.

## 10. Conclusion

UTCP arrives with a noteworthy perspective on the architecture of AI Agent Tool Calling.

Instead of requiring every integration to have an intermediary server layer, UTCP focuses on describing how to call the tools and directly taking advantage of the protocols that existing systems already support.

This is not a story of one protocol being better than the other, but of two different approaches to the problem of connecting AI with the outside world.

A question worth thinking about:

**In the future, will we keep building thousands of wrappers dedicated to AI, or will we let AI Agents use the APIs that systems already provide?**

---

## References

1. [UTCP Official Website](https://utcp.io/)
2. [Introducing UTCP – July 15, 2025](https://www.utcp.io/blog/introducing-utcp)
3. [UTCP Specification](https://github.com/universal-tool-calling-protocol/utcp-specification)
4. [UTCP RFC 1.0.0](https://www.utcp.io/about/RFC)
5. [UTCP About Us](https://www.utcp.io/about/about-us)
6. [UTCP GitHub Organization](https://github.com/universal-tool-calling-protocol)
7. [UTCP Product Hunt Launch](https://www.producthunt.com/products/utcp)
