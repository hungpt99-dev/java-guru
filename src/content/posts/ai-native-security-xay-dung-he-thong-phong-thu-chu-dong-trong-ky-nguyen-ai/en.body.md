## 1. When AI shifts the balance between attacker and defender

For years, software security has usually rested on a fairly familiar model: a developer writes code, the CI/CD system runs security scanning tools, the security team assesses the results, and the developer fixes whatever was flagged.

That model is still necessary, but it faces a major challenge: the speed at which vulnerabilities are discovered and exploited can outpace the security team's ability to handle them.

AI doesn't just help developers write code faster. It can also help analyze source code, trace the paths that lead to a vulnerability, study how a library behaves, build test cases, and assist in developing exploits. That creates opportunity for defenders and attackers alike.

A notable example appeared in October 2026: a coordinated disclosure campaign for PHP vulnerabilities found with AI assistance, including two critical vulnerabilities that allow remote code execution (Remote Code Execution — RCE). The security advisories asked organizations to quickly identify affected systems, update versions, and apply mitigations where patching immediately wasn't possible. [1][2]

What's worrying isn't only the vulnerability itself. The bigger problem is that a flaw in a runtime, a library, or a platform component can affect a great many applications whose development teams don't directly manage that component's source code.

An application can go six months without a code change and still become vulnerable the moment a new CVE is published in one of its dependencies.

If the security system only runs when there's a new commit, that vulnerability may not be caught in time.

This is why organizations need to move from **security per code change** to **continuous security across the entire software lifecycle**.

## 2. The limits of the traditional security model

### 2.1. Scanning only when code changes

Many CI/CD pipelines run SAST, SCA, or security check steps when a merge request is opened or the application is built.

This approach catches a lot of problems early, but it doesn't fully cover the following situations:

- A new CVE is published after the application has already been deployed to production.
- An old repository stops receiving commits, but the application is still running.
- A running container image uses a base image that contains an easily exploitable package.
- A library version is yanked, or a critical vulnerability in it is discovered after release.
- A service is deployed manually, outside the standard CI/CD process.

**A security scan at build time is not the same as security monitoring after deploy.**

Organizations need to inspect both the software being developed and what is actually running in production.

### 2.2. Plenty of alerts, but no idea what order to handle them in

A system with hundreds of repositories and many applications can accumulate thousands of findings from security tools.

Not every vulnerability carries the same level of risk, though.

A CVE with a high CVSS score that only shows up in a dependency never used at runtime may be less urgent than a lower-scored vulnerability that sits on a public endpoint and shows signs of exploitation.

If the team relies on CVSS alone, it can spend too much time on issues unlikely to have real impact while critical systems stay exposed.

### 2.3. No reliable inventory of assets and dependencies

To handle a new CVE, an organization needs to be able to answer a few basic questions:

- Which applications use the affected component?
- Which version is in use?
- Is that dependency inside an artifact running in production?
- Which applications are exposed to the public Internet?
- Which services handle sensitive data or hold significant AWS access?
- Can we patch right away, or do we need a temporary mitigation?

If that information is scattered across GitLab, config files, container registries, AWS, internal documentation, and Excel sheets, scoping the impact takes a long time.

### 2.4. Too much dependence on people

Even when a tool has already detected a vulnerability, remediation can still be slowed down by a string of manual steps:

1. Read the advisory and identify the affected version.
2. Find the relevant repository.
3. Determine the service and deployment environment.
4. Check whether it's exploitable.
5. Create a ticket and assign it to the owning team.
6. Upgrade the dependency or apply a mitigation.
7. Run regression tests.
8. Deploy and verify the patch.

When the number of CVEs climbs quickly, this process easily becomes a bottleneck.

The answer isn't to replace the security team entirely with AI, but to automate collecting information, analyzing blast radius, preparing remediation options, and verifying the outcome.

## 3. What is AI-Native Security?

AI-Native Security is a way of designing security systems in which AI is woven through the entire software development and operations lifecycle, rather than used only as a chatbot or a standalone code review tool.

The goal is to build a system that can:

- Continuously update its knowledge of vulnerabilities and threats.
- Identify the relevant assets, applications, and dependencies.
- Assess risk based on real-world context.
- Automatically propose or prepare remediation options.
- Check whether remediation actually worked.
- Track risks that remain unresolved.
- Learn from incidents and turn them into reusable security controls.

Two roles do need to be kept clearly distinct, though.

**AI is responsible for analysis and decision support. Predefined controls are responsible for enforcing mandatory rules.**

For example, AI can analyze a dependency to determine whether the application exercises the affected code path. But stopping an artifact that contains a vulnerability from passing the release policy has to be done with verifiable rules and gates.

An LLM's answer shouldn't be the only condition deciding whether a build is allowed to deploy.

## 4. The overall architecture of AI-Native Security

A practical architecture can be split into six layers.

### Layer 1 — Asset Inventory and Software Intelligence

Collect data on:

- Source code repositories.
- Dependency manifests and lockfiles.
- SBOM (Software Bill of Materials).
- Build artifacts and container images.
- Runtime, operating system, and package versions.
- Kubernetes, infrastructure-as-code, and cloud resources.
- API endpoints, domains, and services exposed to the public Internet.
- Service ownership, business criticality, and data classification.

The goal is to create a single source of data that can answer the question: what is the organization running, where, and with which components?

In particular, the inventory needs to reflect both the desired state in source code and the actual state in the running environment.

### Layer 2 — Continuous Security Intelligence

Continuously ingest information from:

- CVEs and vendor advisories.
- GitHub Security Advisories and dependency information.
- CISA Known Exploited Vulnerabilities (KEV).
- Threat intelligence and reports from security researchers.
- Scanner results from repositories, containers, and cloud.
- Signals from runtime, WAF, EDR, and monitoring systems.

When a new vulnerability is published, the system needs to kick off impact assessment even if there hasn't been a single commit.

### Layer 3 — AI Risk Analysis

AI combines vulnerability information with the internal inventory to help answer:

- Which systems are likely affected?
- Does the vulnerable component actually appear in a running artifact?
- Is there an external path to reach that component?
- Are there signs of exploitation in the real environment?
- Is there an official patch or a mitigation?
- Which systems should be handled first?

The results must come with evidence, references, a confidence level, and any unverified assumptions.

### Layer 4 — Security Workflow and Policy Engine

Turn analysis results into controlled actions:

- Create a security finding or incident.
- Assign a ticket to the right service owner.
- Create a pull request that upgrades the dependency.
- Require additional regression tests.
- Block a build or release when policy is violated.
- Require approval for high-risk actions.
- Track resolution deadlines and escalation.

The policy engine must operate independently of the AI's inference results.

### Layer 5 — Remediation and Verification

AI helps developers fix code, upgrade dependencies, write tests, and analyze the impact of the patch.

After that, the system runs predefined checks to verify:

- The vulnerability has been removed from the dependency or artifact.
- Security tests and regression tests have passed.
- The new artifact was built from a trusted source.
- Production is actually running the fixed version.
- Related exploitation signals have been checked if there's a risk of compromise.

Closing the ticket does not mean the risk has been handled.

### Layer 6 — Security Knowledge Base and Feedback Loop

Every verified finding, incident, patch, and post-incident lesson becomes structured data for improving the system.

For example, if AI keeps finding one kind of authorization bug across many services, the team can turn that detection into:

- A SAST rule.
- A shared security test.
- A safe implementation pattern.
- A merge request review rule.
- Guidance for AI coding agents.
- A mandatory control in the project template.

That way each incident isn't just resolved on its own — it also lowers the chance of a similar problem showing up in other projects.

## 5. Continuous defense: don't wait for a developer to commit code

This is one of the most important changes.

Instead of running security scans only in CI/CD, the system needs a continuous vulnerability management process.

Suppose a critical CVE shows up today in a widely used runtime.

An AI-Native Security process might work like this.

### Continuous Vulnerability Management Workflow

**Step 1 — New CVE / Security Advisory**

The system ingests information about the new vulnerability from CVE databases, vendor advisories, or threat intelligence sources.

**Step 2 — Normalize and Validate Advisory**

Normalize the advisory information, verify the source, and extract the affected versions.

**Step 3 — Correlate Assets and SBOM**

Match the CVE against the asset inventory, SBOM, dependency manifests, container registry, and runtime data.

**Step 4 — Identify Affected Applications and Artifacts**

Identify the repositories, applications, artifacts, and deployment environments that may be affected.

**Step 5 — AI-Assisted Risk Analysis**

AI analyzes severity, exploitability, exposure, and business impact. Important conclusions need evidence and references.

**Step 6 — Prioritize Remediation**

Rank priority based on CVSS, exploit intelligence, exposure, asset criticality, and reachability where there's enough data.

**Step 7 — Create Ticket and Propose Patch**

Create a ticket for the service owner and propose a remediation plan, including a dependency upgrade or a mitigation.

**Step 8 — Build, Test and Scan**

Create the patch, add regression tests, build the artifact, and run the necessary security checks.

**Step 9 — Evaluate Security Gates**

- If it fails: fix the issue, re-run the checks, or escalate when it can't be handled right away.
- If it passes: move to deployment through an approved pipeline.

**Step 10 — Deploy and Verify Runtime**

Deploy the patch and verify the version actually running, the state of the artifact, and exposure after deploy.

**Step 11 — Confirm Remediation**

- If the risk persists: keep remediating or apply a mitigation.
- If it's handled: close the finding with verification evidence.

**Step 12 — Update Security Knowledge Base**

Update the lessons, regression tests, and verified detection rules so they can be reused in other projects.

The whole process needs to work independently of whether a developer changes code.

### 5.1. Distinguishing detecting a vulnerability from detecting exploitability

Not every CVE is exploitable the same way in every application.

The system should combine at least four groups of information:

1. **Severity:** severity per CVSS or the vendor's assessment.
2. **Exploit intelligence:** whether there's evidence of real-world exploitation, a public exploit, or an urgent warning.
3. **Exposure:** whether the asset is on the public Internet, reachable through an API, or sitting inside the internal network.
4. **Asset criticality:** whether the application handles sensitive data, financial transactions, or significant access.

Reachability analysis can be added to determine whether the affected dependency lies on a relevant execution path.

Still, a finding shouldn't be discarded just because the tool couldn't determine that the dependency is reachable. Reachability results can be incomplete, especially when the system uses reflection, dynamic loading, plugins, or other complex runtime mechanisms.

### 5.2. AI helps cut the time to assess blast radius

Instead of having a security engineer dig through each repository, AI can query the inventory that's already been collected and produce a report:

- Affected repositories and services.
- Versions in use.
- Artifacts and deployment environments.
- Level of public exposure.
- Service owner.
- Applicable patch or mitigation.
- Missing information that still needs verification.

AI shouldn't conjure an asset list out of guesswork. Every important conclusion must be traceable to data from repositories, SBOMs, registries, or cloud inventory.

## 6. Automating security in GitLab CI/CD

For organizations running GitLab Self-Managed, CI/CD is an important integration point but not the only data source.

A security pipeline should include multiple layers of checks.

| Check layer | Goal |
|---|---|
| Secret scanning | Detect credentials committed into repositories |
| SAST | Find security issues in source code |
| SCA | Detect dependencies with known vulnerabilities |
| IaC scanning | Detect insecure Terraform, Kubernetes, or cloud configuration |
| Container scanning | Inspect the packages and OS layer inside an image |
| DAST and API security testing | Test the behavior of the running application |
| SBOM and artifact provenance | Track software components and where an artifact came from |
| Security policy gates | Stop builds or releases that violate policy |

The OWASP DevSecOps Guideline also recommends integrating controls such as SAST, SCA, secret scanning, IaC scanning, DAST, API security, and supply chain security into the development process. [3]

### 6.1. Not every finding should block the pipeline

A practical policy can be split into three groups:

- **Block:** verified critical violations, or things that must be blocked under organizational policy.
- **Require approval:** high risk, but needs further assessment of blast radius or of whether a patch can be applied.
- **Track and remediate:** issues below the release-blocking threshold that still need an owner and a deadline.

Policy must spell out the conditions, exceptions, approvers, and exception deadlines.

AI shouldn't be allowed to decide on its own to waive a finding just because it thinks the probability of exploitation is low.

### 6.2. Protecting the CI/CD system itself

CI/CD has read access to source code, creates artifacts, and often holds deployment permissions. That makes it a valuable target for attackers too.

You need to control:

- Runner isolation and runner access permissions.
- Protected branches and protected environments.
- Access to tokens, cloud credentials, and signing keys.
- Which image, package, and dependency sources are allowed.
- Permission to modify pipelines and security configuration.
- Artifact signing, provenance, and pre-deploy checks.

An AI agent involved in code review shouldn't have default access to secrets, write access to repositories, or permission to deploy to production.

## 7. Using AI to review code with a security-first mindset

AI coding assistants can help surface issues that rule-based scanners struggle to assess fully, especially when a vulnerability depends on business logic or on interaction between multiple components.

An AI security reviewer can focus on:

- Authentication and authorization.
- Broken access control and IDOR.
- SQL injection and input handling problems.
- SSRF and access to internal resources.
- Race conditions and concurrency bugs.
- Insecure deserialization.
- Leakage of sensitive data.
- Mistakes in session management.
- Permission checks on business operations.
- Error handling flows and sensitive information in logs.

For example, an API may require a valid logged-in user and still allow access to another user's data if the backend doesn't check who owns the resource.

SAST can catch some suspicious patterns, but AI given the business rules, API contracts, and permission model can support a more complete analysis of the flow.

AI review doesn't replace SAST, security tests, or human review, though. A finding should only be treated as verified when there's strong enough evidence — a test that reproduces the bug, for instance, or a technical analysis confirmed by someone with the expertise.

### Security context for AI coding agents

Instead of just telling the agent to "write secure code", organizations should provide structured security context:

- Mandatory security requirements.
- Approved authentication and authorization patterns.
- Shared security libraries.
- Forbidden anti-patterns.
- Rules for handling secrets and sensitive data.
- Threat models and trust boundaries.
- Security test cases.
- Review criteria and merge conditions.

These guidelines need to be versioned, reviewed, and checked automatically. When a rule changes, the affected projects and AI agents must receive the updated version.

OWASP SAMM recommends combining guidance written for AI with predefined controls, such as static analysis rules and a controlled build process, rather than relying on prompts alone. [4]

## 8. AI-assisted remediation: from finding to verified patch

Fast detection only means something if the organization can also fix things fast.

An AI-Native Security system can automatically prepare pull requests for suitable cases.

The process consists of:

1. Read the security advisory and identify the affected version.
2. Find the relevant dependencies in the repository and lockfile.
3. Determine which version the vendor has patched.
4. Propose an upgrade or create a patch.
5. Generate or update regression tests.
6. Run unit tests, integration tests, and security scans.
7. Check for changes outside the intended scope.
8. Create a merge request with evidence and review guidance.
9. Ask a reviewer to approve.
10. Deploy through the standard pipeline and verify the runtime state.

For common dependencies, the pull request step can be automated to a high degree. But changes involving authentication, cryptography, authorization, database migrations, or production configuration need a stricter review process.

### When is AI allowed to fix things automatically?

Actions can be classified into three levels:

- **Automatic:** collect advisories, identify repositories, generate reports, open tickets, and create PRs that aren't merged.
- **Needs approval:** merge a patch, change security configuration, or roll out a fix with large impact.
- **Human-controlled:** change production permissions, handle sensitive data, take actions that could cause widespread disruption, or investigate a serious incident.

The goal is to shorten handling time without opening another path for AI or an attacker to take control of the system.

## 9. AWS and production runtime security

Security doesn't end when code is merged.

An application can contain no vulnerabilities in its source code and still be compromised by overly broad IAM configuration, a leaked secret, an easily attacked container image, or an unexpectedly public service.

With AWS, an AI-Native Security system should combine data sources on:

- AWS Config and resource configuration.
- IAM Access Analyzer and access permissions.
- Amazon GuardDuty and threat detection signals.
- AWS Security Hub if it fits the existing architecture.
- ECR image scanning and container inventory.
- CloudTrail and important API activity.
- Network exposure, security groups, and public endpoints.
- Secrets Manager, KMS, and credential lifecycle.

Those services don't all have to be rolled out at once. Organizations should make the most of the tools they already have first, then fill in the missing layers.

AI can aggregate findings from multiple sources to explain the connection between a software vulnerability and the permissions of the service running it.

For example, a service with RCE that also holds overly broad access to S3 can create more risk than the same vulnerability in an environment with tightly restricted permissions.

But foundational defenses still have to be enforced through ordinary mechanisms:

- Least privilege for IAM roles.
- Separation of dev, staging, and production environments.
- No credentials embedded in images or source code.
- Restricted network access.
- Run containers with minimal privileges.
- Protect the metadata service and credentials.
- Limit resources and isolate processes.
- Control egress and access to internal services where appropriate.

AI supports the analysis; IAM, network policy, isolation, and runtime controls are the layers that directly limit the impact once a vulnerability is exploited.

## 10. Detecting signs of compromise and responding to incidents

Organizations can't always patch before an attacker exploits a vulnerability.

So AI-Native Security also needs to cover detection and response after a system shows signs of intrusion.

Signals worth monitoring can include:

- Unusual processes spawned by a web server or application worker.
- Unusual outbound connections.
- Access to credentials or a secret store outside normal behavior.
- IAM policy changes or unexpected access key creation.
- Unexpected changes to system files or runtime configuration.
- Request patterns associated with a CVE that's being exploited.
- Abnormal API and service account behavior.

AI can link these signals to new advisories, build a timeline, and propose hypotheses about the attack path.

Detecting anomalous behavior doesn't automatically prove that a particular CVE was exploited, though. Signal, hypothesis, and evidence need to be kept clearly apart.

### A controlled automated response process

When there are signs of compromise, the system can:

1. Collect and preserve the relevant logs and evidence.
2. Identify the affected assets and identities.
3. Assess severity and how far it has spread.
4. Notify the incident response team.
5. Propose isolating workloads, revoking credentials, or blocking traffic.
6. Execute containment actions per an approved playbook.
7. Check for persistence, lateral movement, and other signs of compromise.
8. Verify recovery and update the defenses.

Actions such as isolating systems or revoking credentials need to be designed with clear permissions and conditions. Over-eager automated response can cause an outage, while responding too slowly can leave an attacker operating.

## 11. Security Knowledge Base: turning every vulnerability into a new layer of defense

One of the problems in large organizations is that security knowledge tends to be scattered.

One team may have successfully handled an SSRF bug while another team still makes the same mistake. One service may already have a safe authorization pattern, yet a new project implements a different mechanism from scratch.

AI-Native Security needs a security knowledge base containing at least:

- Security standards and engineering guardrails.
- Threat models and trust boundaries.
- Security architecture patterns.
- The list of approved dependencies.
- The CVE handling process.
- Verified findings.
- Regression tests and bug detection rules.
- Incident reports and postmortems.
- Rules for handling secrets and sensitive data.
- Guidance for coding agents and reviewer agents.

The important thing is that the knowledge base has versions, provenance, an owner, and an approval process.

AI shouldn't be allowed to write an unverified conclusion into the official knowledge base and then have that conclusion become policy for the whole organization.

A suitable feedback loop would be:

**Finding → Verification → Root cause analysis → Reusable security control → Automated enforcement → Continuous validation.**

That's how knowledge from individual incidents becomes shared defensive capability.

## 12. Securing the AI agent system itself

An AI-Native Security system can become a new attack target if permissions and trust boundaries aren't designed up front.

An AI agent may read source code, query vulnerability databases, create pull requests, call APIs, or propose operational actions. If the agent is granted too many permissions, one bug in the workflow can have a bigger impact than a bug in an ordinary chatbot.

Risks to consider include:

- Prompt injection through repositories, issues, pull requests, or external documents.
- Secrets leaking through prompts and model context.
- An agent executing commands beyond its allowed scope.
- Use of a malicious package suggested by AI.
- AI producing a wrong security finding or missing a problem.
- An agent fixing code and then approving its own change.
- Abuse of access to GitLab, cloud, or production.

### Protection principles

**First, least privilege.** Each agent gets only the permissions its task requires.

**Second, separate the right to propose from the right to execute.** An agent that analyzes CVEs doesn't get to deploy patches by default. An agent that creates a PR isn't allowed to merge that PR itself.

**Third, don't put secrets into model context unless necessary.** Prefer short-lived credentials, limited access, and issuance through a controlled system.

**Fourth, treat repository content and external data as untrusted.** Instructions in a README, issue, or comment must not be able to change an agent's permissions or policy.

**Fifth, every important action needs an audit trail.** You need to know which sources the agent read, what evidence it used, what it proposed, and who approved the next action.

**Sixth, don't use AI output as the only control.** Conditions such as a dependency having a banned CVE, an artifact that isn't signed, or a deploy without approval must be checked by predefined rules.

OWASP SAMM also stresses treating the AI steps in a pipeline as components that process untrusted data, while avoiding giving them access to secrets or unnecessary write permissions. [4]

## 13. A practical rollout roadmap

You shouldn't start by building a complete AI security system with dozens of agents. The more practical path is to start from a problem you can measure: detecting and handling CVEs across every repository and every artifact that's running.

### Phase 1 — Continuous Vulnerability Visibility

**Goal:** don't miss vulnerable systems just because a repository has no new commits.

Main work:

- Compile a list of the repositories and services currently in operation.
- Scan dependencies and container images on a schedule.
- Collect SBOMs for important artifacts.
- Connect vulnerability advisories and threat intelligence sources.
- Identify service owners and deployment environments.
- Produce CVE reports by risk level.
- Set up an escalation mechanism for urgent vulnerabilities.

**Expected outcome:** when a critical CVE is published, the team can quickly identify the assets that may be affected.

### Phase 2 — AI-Assisted Triage and Remediation

**Goal:** shorten the time from detection to having a remediation plan.

Main work:

- Use AI to synthesize advisories and technical evidence.
- Correlate CVEs with the internal inventory.
- Propose priority levels and explain the reasoning.
- Create tickets for service owners.
- Generate PRs that upgrade dependencies.
- Write tests and report the impact of the patch.
- Require review and run security gates before merge.

**Expected outcome:** less manual analysis time and a higher share of findings handled on schedule.

### Phase 3 — Security Gates and Runtime Verification

**Goal:** make sure known vulnerabilities don't easily come back, and verify the state of production.

Main work:

- Standardize policy in CI/CD.
- Apply artifact and container image checks.
- Protect the build pipeline and deployment credentials.
- Connect cloud security findings.
- Check the runtime version after deploy.
- Add detection rules from verified incidents.

**Expected outcome:** control over both how software is produced and the state of the software that's running.

### Phase 4 — Security Engineering Intelligence

**Goal:** move from handling individual vulnerabilities to preventing recurring classes of bugs.

Main work:

- Build a versioned security knowledge base.
- Analyze root causes from findings and incidents.
- Turn recurring bugs into automated rules.
- Provide security context to AI coding agents.
- Check compliance with the security architecture.
- Measure how effective the defenses are.

**Expected outcome:** the system not only detects and handles problems but also keeps improving its ability to prevent similar ones.

## 14. Reference technologies and tools

You don't have to replace every tool you already have. Pick the components that fit your current ecosystem.

| Need | Tool or approach |
|---|---|
| Source code and CI/CD | GitLab Self-Managed |
| SAST, SCA, and secret scanning | GitLab Security features or compatible specialized tools |
| Dependency and image scanning | Trivy, Grype, or your existing scanner |
| SBOM | Syft or an equivalent tool |
| IaC checks | Checkov, Trivy, or an equivalent tool |
| Normalizing security findings | SARIF and structured data formats |
| Vulnerability intelligence | CVE, vendor advisories, CISA KEV |
| Cloud security | AWS Config, GuardDuty, Security Hub, and suitable services |
| AI-assisted analysis | An LLM combined with retrieval from verified sources |
| Workflow orchestration | GitLab pipelines, job workers, or a workflow engine |
| Policy enforcement | Pipeline gates, policy-as-code, and deployment rules |
| Security knowledge base | A version-controlled repository combined with a search system |

This list is a set of reference options, not a requirement to deploy everything at once. Integration capability, licensing, and actual features need to be verified against the tool versions and your deployment environment.

## 15. Measuring the effectiveness of AI-Native Security

A system with many agents, or one that produces many reports, doesn't mean better security.

Real outcomes need to be measured:

| Metric | Meaning |
|---|---|
| Asset inventory coverage | Share of important assets with complete inventory |
| SBOM coverage | Share of important artifacts that have an SBOM |
| Mean Time to Detect (MTTD) | Time from a signal appearing to detection |
| Mean Time to Triage | Time to determine blast radius and priority |
| Mean Time to Remediate (MTTR) | Time to handle a vulnerability |
| KEV remediation compliance | Share of vulnerabilities in the actively exploited category handled on schedule |
| Exploitable exposure window | How long an asset stays in an exploitable state |
| False-positive rate | Share of alerts that turn out to be wrong after verification |
| Patch verification rate | Share of patches verified on both artifact and runtime |
| Recurrence rate | How often classes of bugs that were already fixed come back |

Set a baseline before rolling out, then compare results over time.

Don't set the goal as simply reducing the number of findings, because the count can fall if scanners aren't running or the inventory is incomplete. Metrics need to be read together with coverage and detection quality.

## 16. Architectural principles to hold onto

From the layers above, a few important principles emerge.

**1. Security must run continuously, not only when there's a commit.**

Advisories, dependencies, artifacts, cloud assets, and runtime all need to be tracked.

**2. AI needs the real context of the system.**

A CVE only has operational meaning when it's tied to a version, an artifact, an environment, exposure, and how important the asset is.

**3. AI doesn't replace predefined controls.**

AI analyzes and proposes; the policy engine, scanners, tests, and approval gates verify or enforce the rules.

**4. Automate remediation but control the right to execute.**

Creating a PR can be automated. Merging, deploying, and actions that affect production need appropriate control conditions.

**5. Every important conclusion needs evidence.**

Don't just store the AI's output — store the advisory source, the dependency version, scanner output, test results, and the relevant runtime state.

**6. Security knowledge must be reused.**

A verified finding needs to become a test, a rule, an architecture pattern, or a policy that can be applied to other projects.

**7. Secure the AI system itself.**

Agents, model context, tool permissions, credentials, and workflows all have to sit inside the threat model of the security system itself.

## Conclusion

In the AI era, the attacker's advantage comes not only from being able to find vulnerabilities but from the speed of turning a discovery into an exploit. Meanwhile, many organizations still handle security through manual, fragmented processes that depend on when a developer changes code.

AI-Native Security aims at a different model: a system that continuously tracks assets, ingests vulnerability information, determines blast radius, prioritizes remediation, supports patch creation, and verifies the state after deployment.

AI reduces the volume of analysis work. Security automation turns rules into enforceable controls. Runtime monitoring catches the risks that remain after software ships. The knowledge feedback loop turns every problem handled into a chance to improve the defensive system.

**The goal isn't to use AI to scan more; it's to shorten the entire window from when a risk appears to when the organization understands the blast radius, controls its exposure, and verifies that the risk has been handled.**

That is the foundation of a proactive security system in the AI era.

### Demo repository

https://github.com/hungpt99-dev/ai-native-security-platform

I'm using this repository to explore how to implement an AI-Native Security workflow in a practical way, from detecting vulnerabilities through to remediation and verification.

---

## References

[1] [OpenAI — Patch the Planet: Coordinated Disclosure of Critical Vulnerabilities](https://openai.com/index/coordinated-disclosure-of-critical-vulnerabilities/)

[2] [CERT-EU — Critical Vulnerabilities in PHP, Security Advisory 2026-018](https://www.cert.europa.eu/publications/security-advisories/2026-018/)

[3] [OWASP — DevSecOps Guideline](https://owasp.org/projects/devsecops-guideline)

[4] [OWASP SAMM — Guidance for AI-Assisted Development](https://owaspsamm.org/docs/guides/ai-assisted-development/)

[5] [CISA — Known Exploited Vulnerabilities Catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)
