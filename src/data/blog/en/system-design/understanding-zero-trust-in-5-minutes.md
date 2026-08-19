---
title: "Zero Trust: Principles and Practical Examples"
description: "A practical introduction to Zero Trust, including its principles, how it differs from perimeter security, and example access flows."
pubDatetime: 2025-09-03T10:12:00+07:00
featured: false
draft: false
tags:
  - system-design
  - security
---

Zero Trust is a security approach for systems where users, devices, services, and data may be distributed across corporate networks, cloud environments, and the public internet. The difficult part is not naming the principle; it is deciding what should be verified for each request, how access should be limited, and how the system should respond when context changes.

This article explains the difference between perimeter-based security and Zero Trust, introduces the main principles, and applies them to common access scenarios.

## 1. Perimeter-Based Security and Implicit Trust

**[SOURCE FACT]** A traditional enterprise design often treats the internal network as a more trusted zone than the public internet. A firewall protects the network perimeter, and a user or device that has entered the network may receive access based largely on its network location.

This is commonly described as a castle-and-moat model:

- The internal network is the area inside the perimeter.
- The firewall is the boundary that filters external traffic.
- Network access can become a proxy for trust.

**[ANALYSIS]** This model makes lateral movement easier after an account is compromised or a device inside the network is infected. Passing the perimeter does not prove that the request is legitimate, that the device is healthy, or that the user needs access to every reachable resource.

## 2. What Zero Trust Means

**[SOURCE FACT]** Zero Trust is commonly summarized as "never trust, always verify." It does not treat network location as sufficient evidence of trust. An access request is evaluated using identity, authorization policy, device and request context, and the security controls required for the resource.

In practice:

- There is no permanently trusted internal zone.
- Each resource must enforce authentication and authorization.
- Encryption protects communication where appropriate.
- Access follows least privilege and should be limited in scope and duration when possible.

Zero Trust is not the same as asking for a password on every request. Verification can use an existing session, a service identity, device posture, risk signals, and step-up authentication such as MFA when policy requires it.

## 3. Core Principles

**[SOURCE FACT]** The following three principles are a concise, commonly used summary of Zero Trust guidance:

1. **Verify explicitly.** Authenticate and authorize using the available signals, such as user identity, device state, location, requested service, and request context.
2. **Use least privilege.** Grant only the permissions required for the task. Limit the scope and lifetime of access where the system supports it, including Just-In-Time access.
3. **Assume breach.** Design as though an attacker may already have obtained access to part of the environment. Use micro-segmentation, encryption, logging, and continuous monitoring to reduce lateral movement and the blast radius of an incident.

These principles are design constraints, not a single product. Identity providers, policy engines, endpoint controls, service-to-service authentication, network controls, and monitoring may all contribute to an implementation.

## 4. Access Scenarios

### 4.1 Company Email

**[ANALYSIS]** In a perimeter-based design, being on the internal network may be enough to reach email or may reduce the amount of additional verification required.

**[PROPOSED DESIGN]** An email service can evaluate the user's SSO session, device posture, request context, and resource sensitivity. It can require MFA when policy detects an elevated risk and can limit access when the device does not meet the required security state.

### 4.2 Internal Servers

**[ANALYSIS]** A network login that exposes a broad server segment creates unnecessary lateral-movement paths. Network reachability is not equivalent to authorization.

**[PROPOSED DESIGN]** Treat each server or service as a separately protected resource. An identity provider and policy enforcement point can authorize a specific user, workload, or automation client for a specific operation. Micro-segmentation reduces which resources are reachable even if one credential is compromised.

### 4.3 Remote Workers

**[ANALYSIS]** A traditional VPN can provide a user with network-level connectivity, but connectivity alone does not express which applications or actions the user actually needs.

**[PROPOSED DESIGN]** Zero Trust Network Access (ZTNA) can expose individual applications through security proxies rather than placing the user directly on the internal network. Policies can evaluate location, device state, and behavior, and can deny or step up verification after authentication if the context becomes anomalous.

## 5. Zero Trust and Perimeter Security

| Criterion | Perimeter-based security | Zero Trust |
| --- | --- | --- |
| Trust model | Network location provides an initial trust signal | Each request is evaluated explicitly |
| Trust boundary | Primarily the network perimeter | The individual resource and its access policy |
| Authentication | Often emphasized at network entry | Based on the identity, context, and session for the requested resource |
| Authorization | May be broad within a network zone | Least privilege, with Just-In-Time access where appropriate |
| Containment | Perimeter controls limit external entry | Segmentation, encryption, and monitoring limit movement and impact |
| Security assumption | The internal network is more trusted | Assume that part of the environment may be compromised |

This comparison describes design tendencies, not a claim that every legacy or modern system implements the model in exactly this way.

## 6. Conclusion

Zero Trust is a security strategy and set of design principles, not a product. Its central change is to stop using network location as a default authorization decision. Instead, each resource evaluates identity, context, policy, and the minimum permissions required for the operation.

The approach is useful for remote access, cloud services, internal applications, and service-to-service communication. It does not eliminate breaches. It is intended to reduce the chance that one compromised account or device leads to broad access, and to make access decisions and security events easier to observe and control.
