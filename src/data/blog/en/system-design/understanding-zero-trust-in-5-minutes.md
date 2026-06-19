---
title: "Understanding Zero Trust in 5 Minutes"
description: "Explaining the Zero Trust security model: core principles, comparison with traditional security, and practical examples."
pubDatetime: 2025-09-03T10:12:00+07:00
featured: false
draft: false
tags:
  - system-design
  - security
---

If you work in technology, you've probably heard of Zero Trust — a modern security model that helps prevent hackers and protect important data. This article will help you understand Zero Trust quickly, with illustrative examples, pros and cons, and differences from traditional security.

## 1. What is Traditional Security? (The "Implicit Trust" Model)

Traditionally, most enterprises use a "Castle-and-Moat" security model:

- The internal network is considered "inside the castle" — safe.
- The moat (firewall) is built at the network perimeter to block threats from outside.
- Once you've crossed the moat (connected to the internal network), you are trusted by default and can broadly access many resources.

Problem: If a hacker steals login credentials or infects a device inside the network with malware, they can move laterally and access the entire system.

## 2. What is Zero Trust? (The "Never Trust by Default" Model)

Simple definition:

Zero Trust is a "Never Trust, Always Verify" security model. Every access request, whether from inside or outside the network, is considered suspicious and must go through rigorous identity verification, authorization, and encryption processes.

This means:

- There is no default "safe zone". The internal network perimeter is no longer considered a trust boundary.
- Every access to a resource must be authenticated, authorized, and encrypted.
- Access is granted on the principle of least privilege and only for the necessary duration (Just-In-Time).

## 3. Core Principles of Zero Trust

According to standard frameworks (such as NIST), Zero Trust is based on three main pillars:

1. Verify Explicitly: Always authenticate and authorize based on all available data points (user identity, location, device status, service being accessed, etc.).
2. Use Least Privilege Access: Only grant the minimum access needed for users to perform their tasks and for the shortest possible time.
3. Assume Breach: Design systems with the assumption that attackers are already inside the network. From there, implement micro-segmentation to prevent lateral movement, encrypt data, and continuously monitor to minimize the blast radius of a breach.

## 4. Specific Examples

### 4.1 Accessing Company Email

- Traditional security: Employees on the internal network access email without additional authentication.
- Zero Trust: Even if an employee is on the company network, when opening email containing sensitive data, the system checks identity (SSO login status), device status (security patches installed), and may require Multi-Factor Authentication (MFA) if abnormal context is detected.

### 4.2 Accessing Internal Servers

- Traditional security: One network login grants access to all servers in the same network segment.
- Zero Trust: Each server is protected as a separate "castle" through micro-segmentation. Server access requires authorization by a centralized Identity Provider and is only granted if the user/algorithm meets the correct policy.

### 4.3 Remote Workers

- Traditional security: Use VPN to "tunnel" into the internal network, then be trusted with broad access.
- Zero Trust: Instead of traditional VPN, employees connect directly to each application through security proxies (e.g., ZTNA - Zero Trust Network Access). The system continuously assesses risk (login location, behavior) and can block access if anomalies are detected, even after successful authentication.

## 5. Zero Trust vs Traditional Security

| Criteria        | Traditional Security (Castle-and-Moat) | Zero Trust                                                     |
| --------------- | -------------------------------------- | -------------------------------------------------------------- |
| Philosophy      | "Trust, then verify"                   | "Never Trust, Always Verify"                                   |
| Trust boundary  | At the network perimeter               | At each resource (user, device, app, data)                     |
| Authentication  | Once when entering the network         | Continuous and contextual verification for each access session |
| Access rights   | Often broadly granted by network zone  | Principle of Least Privilege and Just-In-Time                  |
| Data protection | Focused on perimeter defense           | Micro-segmentation and encryption everywhere                   |
| Assumption      | Threats come from outside              | Assume Breach                                                  |

## 6. Conclusion

Zero Trust is not a product, but a security strategy and framework. It is the inevitable choice for the era of remote work, cloud computing, and today's sophisticated threats.

This model requires a mindset shift from "Trust by default" to "Continuous verification", helping organizations protect their data and applications more flexibly and effectively, regardless of where they reside.

To put it humorously: Zero Trust is like "always being suspicious of everyone, including yourself", but in return, it creates a defense system with superior threat detection and prevention capabilities.
