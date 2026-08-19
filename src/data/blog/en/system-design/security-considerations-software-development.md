---
title: "Security Responsibilities Across the Software Development Lifecycle"
description: "Practical security responsibilities for developers, DevOps, QA, project managers, and organizations, from secure coding and secret management to threat-aware testing and incident response."
pubDatetime: 2025-11-09T02:55:00+07:00
featured: false
draft: false
tags:
  - security
  - career
  - backend
---

Security is a shared engineering responsibility. It is easy to agree with that statement and still leave security to a specialist team. In practice, risk is introduced at every stage of a project: a developer can commit a credential, a pipeline can expose one, a tester can copy production data into a test environment, or an operator can leave an unnecessary port open.

The difficult part is not memorizing a list of tools. It is applying the right controls throughout the Software Development Lifecycle (SDLC), without treating security as a final gate. This article maps common responsibilities to developers, DevOps and infrastructure, project management, QA, and the organization. It also distinguishes the supplied source facts from analysis and proposed process controls.

## 1. Developer: Security in the Code

> **[SOURCE FACT]** The supplied material identifies exposed credentials, unvalidated input, vulnerable dependencies, unsafe logging, and insufficient review as recurring developer-level risks.

### Protect Secrets

Do not commit `.env`, `appsettings.json`, `config.yml`, database passwords, API keys, or secret keys to a repository. A public repository is not the only concern: credentials can also leak through build logs, chat, email, or artifacts.

Use `.gitignore` to exclude local configuration files, but do not treat it as a secret-management system. Use environment variables on local machines and in CI/CD pipelines. For shared or production secrets, use a dedicated secret manager such as AWS Secrets Manager, HashiCorp Vault, or Azure Key Vault. Repository scanners such as GitGuardian and TruffleHog can help detect credentials that were committed accidentally.

**[ANALYSIS]** A detected secret should be considered exposed. Removing the line from the latest commit does not necessarily remove it from repository history or from copies already made. The appropriate response is to revoke or rotate the credential, then investigate where it may have been used.

### Validate Input and Output

Never trust client input. Validate it on the server against an explicit schema, and apply the expected type, format, length, and range constraints.

- Use Prepared Statements, also called parameterized queries, or a correctly used ORM such as Hibernate or Eloquent to reduce SQL injection risk.
- Escape data for its output context before rendering HTML to reduce Cross-Site Scripting (XSS) risk. React, Vue, and Angular provide useful defaults, but those defaults do not make every rendering path safe.
- Validate API request bodies with a schema library such as Joi, Yup, or Pydantic.

Validation and output encoding solve different problems. Validation limits what an application accepts; encoding prevents accepted data from being interpreted as markup or code in a particular output context.

### Manage Dependencies

An application also inherits risk from its dependencies. A malicious or vulnerable open-source package can become a supply-chain attack vector.

Scan dependencies periodically with OWASP Dependency-Check, Snyk, or GitHub Dependabot. Prefer libraries that are maintained and have an established community, and apply security patches when they are available. Review the proposed change rather than updating blindly; compatibility and transitive dependencies still need to be checked.

### Log Deliberately

Do not log passwords, payment-card numbers, Personally Identifiable Information (PII), access tokens, or JWTs. Logs are operational data and must be handled accordingly.

In production, return a generic error to the user and keep detailed stack traces out of the response. Detailed diagnostic data can disclose code structure, database information, or other implementation details. Keep that information in protected server-side logs when it is needed for investigation.

### Review Code and Security

Every Pull Request or Merge Request should receive review from another person, using a security checklist appropriate to the change. Static Application Security Testing (SAST) tools such as SonarQube and Checkmarx can identify potential issues automatically, but they do not replace human review or runtime testing.

## 2. DevOps and Infrastructure: Security in Delivery and Operations

> **[SOURCE FACT]** The supplied material recommends protected CI/CD variables, least-privilege access, non-root containers, vulnerability scanning, encrypted connections, restricted network access, monitoring, centralized logging, and an incident response plan.

### Secure the CI/CD Pipeline

Do not hardcode secrets in pipeline scripts or configuration committed to the repository. Use the CI/CD platform's secret storage, such as GitHub Secrets, GitLab CI Variables, or Azure DevOps Secret Variables.

**[PROPOSED DESIGN]** Require an approval step before production deployment when the project's risk and operating model justify it. Keep deployment credentials scoped to the actions and environments that the pipeline needs.

### Apply Least Privilege

Access should be granted according to the Principle of Least Privilege: each user, service, and pipeline receives only the permissions required for its job.

The supplied baseline is that developers have read/write access to development environments, while production deployment rights are limited to the CI/CD system and a small number of authorized people. Avoid shared root or broadly privileged service accounts. Use Role-Based Access Control (RBAC), meaning permissions are assigned through defined roles rather than ad hoc user grants.

### Harden Containers and Network Paths

Scan container images before deployment with tools such as Trivy or Grype. Configure containers to run as a specific non-root user where the application permits it.

Use TLS for connections that require transport encryption. Configure security groups and firewalls to allow traffic only from necessary sources and on necessary paths. Encryption and network restriction are complementary controls; one does not replace the other.

### Monitor and Respond

Use monitoring such as Prometheus or Datadog and centralized logging such as an ELK Stack when those systems fit the environment. Alert on signals including repeated failed logins and unexpected traffic spikes.

**[PROPOSED DESIGN]** Maintain an Incident Response Plan that defines how the team detects, contains, investigates, communicates, and recovers from an incident. The plan should identify responsibilities and escalation paths before an incident occurs.

## 3. Project Management: Security in Process and Access

> **[SOURCE FACT]** The supplied material places security review, personnel access management, and security awareness within project and organizational responsibilities.

### Put Security in the Definition of Done

Make a security review part of the Definition of Done (DoD) for each user story when the change has security impact. A short checklist is more useful than a process that exists only in a policy document. It can cover authentication and authorization, input handling, secrets, logging, data exposure, dependencies, and operational changes.

### Manage Workforce Access

Use Single Sign-On (SSO) where available. Revoke access promptly when someone changes teams or leaves the company. Review access rights quarterly, as specified in the supplied material, and remove permissions that are no longer justified.

### Train and Encourage Reporting

Run internal sessions on topics such as the OWASP Top 10 and phishing detection. Make it safe to report suspected vulnerabilities and mistakes. Early reporting gives the team a chance to rotate credentials, contain exposure, and correct the issue before it becomes a larger incident.

## 4. QA and Testing: Security in Verification and Test Data

> **[SOURCE FACT]** The supplied material recommends basic attack-oriented checks, authorization testing, OWASP ZAP scanning, and synthetic data in staging and test environments.

### Test Common Input Attacks

Test forms and APIs with security-focused cases. For example, an XSS test string is `<script>alert('XSS')</script>`, and a SQL injection test string is `' OR '1'='1`. These are test inputs, not proof that a system is vulnerable. Use OWASP ZAP to automate vulnerability scanning where appropriate, and verify findings manually.

### Test Authorization, Not Only Authentication

Verify that one user cannot access another user's data by changing an identifier in a URL or request. This is commonly called Insecure Direct Object Reference (IDOR). Test both regular-user and administrator permissions, including attempts to call endpoints directly rather than through the user interface.

### Keep Test Data Safe

Do not use real customer data in staging or test environments. Generate fake data instead. If a project has a concrete need to use derived data, define and review a suitable de-identification process; the supplied material's direct recommendation is to use generated data.

## 5. Organization: Security Culture and Policy

> **[SOURCE FACT]** The supplied material calls for clear security policies and procedures, including password requirements, data handling, and incident response, together with periodic independent assessment.

### Define Policies and Procedures

Maintain a security policy that explains password requirements, data handling expectations, and the incident response process. The policy should be understandable to the people expected to follow it and should connect to the controls used in development and operations.

### Assess the System Periodically

Use periodic audits and assessments to check whether the documented controls work in practice. The supplied material specifically recommends engaging an independent third party for penetration testing. The scope and timing of such testing should be determined by the system's risk and applicable requirements; no universal schedule is asserted here.

## A Practical Security Baseline

The responsibilities above are different, but they reinforce one another:

- Developers protect secrets, validate input, manage dependencies, avoid sensitive logs, and participate in review.
- DevOps and infrastructure teams protect delivery credentials, restrict access, harden runtime environments, and prepare monitoring and response.
- Project managers make security visible in delivery criteria and access processes.
- QA tests authorization and common attack paths and keeps test data synthetic.
- The organization provides policies, training, reporting channels, and independent assessment.

**[ANALYSIS]** No single scanner, checklist, or security role can compensate for gaps across the lifecycle. The useful goal is not to promise that a project is perfectly secure; it is to make risks discoverable, permissions deliberate, sensitive data controlled, and incident handling repeatable.
