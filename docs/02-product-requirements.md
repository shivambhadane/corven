# CORVEN — Product Requirements Document

**Document:** Product Requirements Document (PRD)
**Version:** 0.1
**Status:** Initial Draft
**Project:** CORVEN
**Tagline:** Infrastructure for Trusted Autonomous Systems
**Category:** Cross-System Incident Response for Autonomous AI Networks
**Event:** ETHGlobal Mumbai 2026
**Development Approach:** From Scratch, documentation-first, module-by-module

---

# 1. Executive Summary

CORVEN is a cross-system incident-response infrastructure layer designed to help organizations understand, contain and investigate security incidents across interconnected autonomous AI agents.

As autonomous agents gain access to wallets, APIs, databases, credentials and other agents, compromising one agent can expose multiple connected systems through delegated authority and shared dependencies.

Existing security mechanisms often focus on individual identities, permissions, transactions or runtime activity. However, understanding the complete operational impact of a compromised agent and containing it without unnecessarily disrupting healthy operations remains a difficult problem.

CORVEN aims to address this by introducing a dependency-aware incident-response system that:

1. Discovers and maps relationships between agents, permissions, credentials, resources and workflows.
2. Analyzes the impact of a compromised agent across connected systems.
3. Calculates the minimum safe containment boundary.
4. Executes authorized containment actions through controlled enforcement points.
5. Verifies that compromised operations are blocked while unaffected workflows remain operational.
6. Generates verifiable evidence of the incident and response.

**Core proposition:**

> CORVEN does not just identify a compromised agent. It determines what that agent can affect, calculates the smallest safe containment boundary, executes the response and proves what happened.

# 2. Problem Statement

## 2.1 Background

Autonomous AI agents are increasingly being integrated into business applications and decentralized systems.

They can interact with:

- Blockchain wallets and smart contracts.
- External APIs.
- Databases and storage systems.
- Other autonomous agents.
- MCP servers and external tools.
- Cloud services.
- Delegated credentials and permissions.
- Business workflows.

These integrations create interconnected systems in which one agent may depend on or exercise authority over multiple other components.

## 2.2 The Problem

When an agent is compromised, simply disabling its process or identity may not be sufficient.

The compromised agent may have:

- Delegated permissions to other agents.
- Access to shared credentials.
- Access to resources used by healthy agents.
- Triggered operations that are already in progress.
- Created dependencies that are not visible from its own identity.
- Access to external systems that CORVEN does not directly control.

Organizations need to understand the full impact of an incident and determine which permissions or execution paths must be blocked.

## 2.3 Key Challenges

| Challenge              | Description                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Fragmented visibility  | Dependencies are spread across different systems.                                              |
| Delegated authority    | Permissions may be passed from one agent to another.                                           |
| Hidden blast radius    | One compromised agent may affect several downstream components.                                |
| Shared resources       | Blindly revoking shared access can disrupt healthy agents.                                     |
| Incomplete enforcement | Independent systems may have credentials or permissions outside the response system's control. |
| Limited verification   | An organization may not know whether containment actually worked.                              |
| Evidence integrity     | Incident response records need to be verifiable and tamper-evident.                            |

## 2.4 Proposed Solution

CORVEN introduces a dependency-aware response layer that combines graph analysis, deterministic containment planning, controlled authorization enforcement and verifiable incident records.

The primary innovation target is:

**Cross-system dependency-aware incident response with minimum safe containment and post-containment verification.**

This must be demonstrated through actual system behavior rather than presented only as a conceptual feature.

# 3. Product Vision and Objectives

## 3.1 Vision

Build infrd safely and veastructure that enables organizations to responrifiably when autonomous AI agents or their connected systems are compromised.

## 3.2 Primary Objectives

1. Provide a unified representation of agent dependencies.
2. Identify the potential blast radius of a compromised agent.
3. Distinguish authority, resource and operational dependencies.
4. Calculate the smallest safe set of controllable authorization changes.
5. Prevent compromised operations through enforcement points.
6. Preserve unaffected agent workflows.
7. Generate verifiable incident evidence.
8. Integrate decentralized identity and evidence systems.
9. Provide an understandable incident-response dashboard.

## 3.3 Success Criteria

CORVEN should demonstrate:

- A compromised agent can be identified as the incident source.
- The system can reconstruct relevant dependencies.
- The affected agents, resources and workflows can be identified.
- A deterministic containment plan can be generated.
- The response can block a compromised operation.
- A healthy agent can continue performing an unaffected operation.
- The response can be independently verified through recorded evidence.

# 4. Target Users

## 4.1 Primary Users

**AI infrastructure operators**

Organizations operating multiple autonomous agents with access to external resources.

**Security engineers**

Teams responsible for investigating and responding to compromised agents.

**Protocol and platform developers**

Developers building agent ecosystems with delegated permissions and connected resources.

**Enterprise infrastructure teams**

Teams managing agent access to databases, APIs, cloud services and internal systems.

## 4.2 User Needs

| User                    | Requirement                                              |
| ----------------------- | -------------------------------------------------------- |
| Security engineer       | Understand incident impact and affected components.      |
| Infrastructure operator | Contain compromised agents without unnecessary downtime. |
| Platform developer      | Register agents, dependencies and permissions.           |
| Auditor                 | Verify incident actions and response history.            |

# 5. Product Scope

## 5.1 In Scope

The initial product will focus on:

- Agent registration and identity references.
- Permission and delegation relationships.
- Resource and workflow dependency registration.
- Dependency graph construction.
- Blast-radius analysis.
- Minimum-safe-containment calculation.
- Controlled authorization enforcement.
- Incident lifecycle management.
- Post-containment verification.
- Verifiable incident evidence.
- ENS integration.
- Arkiv integration.
- Chainlink CRE integration, subject to time and integration feasibility.
- Web dashboard.
- Testnet smart contracts.
- Cloud deployment.

## 5.2 Out of Scope for the Initial MVP

- Universal support for every agent framework.
- Automatic control over arbitrary third-party credentials.
- Multi-chain execution.
- Reversing completed blockchain transactions.
- Replacing existing wallet security platforms.
- Building a new universal agent identity protocol.
- Building a general-purpose AI security scanner.
- Guaranteed detection of every malicious action.
- Autonomous high-impact revocation without appropriate authorization.
- Kubernetes-based distributed infrastructure.
- Complex machine-learning threat detection.

# 6. Core Functional Requirements

## FR-01: Agent Registry

CORVEN must maintain a registry of agents participating in its monitored environment.

Required information:

- Internal agent identifier.
- Agent name.
- Owner or controlling entity.
- Identity reference.
- Parent or delegating agent, if applicable.
- Status.
- Registered permissions.
- Associated resources.
- Creation and update timestamps.

Expected capabilities:

- Register an agent.
- Retrieve agent information.
- Update agent metadata.
- Mark an agent as active, suspended or compromised.
- Retrieve an agent's dependencies.

**Acceptance criteria:**

- Agents can be registered with validated identifiers.
- Duplicate identifiers are rejected.
- Relationships to other registered agents can be represented.
- Agent status changes are recorded.

## FR-02: Dependency Registry

CORVEN must maintain explicit relationships between agents and connected components.

Supported entity types:

- Agents.
- Credentials.
- Permissions.
- Resources.
- Workflows.
- External systems.

Supported relationship types:

1. **Authority dependency:** An agent delegates or receives permission.
2. **Resource dependency:** An agent can access or use a resource.
3. **Operational dependency:** A workflow or agent requires another component to operate.

**Acceptance criteria:**

- Dependencies can be created and retrieved.
- Relationship types are explicitly represented.
- Invalid relationships are rejected.
- Shared resources can have multiple dependent agents.
- Dependency changes can be recorded.

## FR-03: Dependency Graph Engine

CORVEN must construct a graph representing the registered environment.

The graph should support:

- Nodes representing agents, credentials, permissions, resources and workflows.
- Typed edges representing dependencies.
- Directional relationships.
- Dependency traversal.
- Path identification.
- Shared dependency detection.
- Reachability analysis.

**Acceptance criteria:**

- The graph can be constructed from registered data.
- The engine can identify downstream dependencies.
- It can distinguish different dependency types.
- It can identify shared resources and paths.
- Graph results are deterministic for identical inputs.

## FR-04: Incident Management

CORVEN must provide an incident lifecycle.

Proposed incident states:

- Detected.
- Investigating.
- Analyzing.
- Containment proposed.
- Awaiting approval.
- Containing.
- Contained.
- Verified.
- Failed.
- Resolved.

Required incident information:

- Incident ID.
- Source agent.
- Incident type.
- Triggering event.
- Severity.
- Affected entities.
- Current status.
- Containment plan.
- Approval information.
- Execution results.
- Evidence references.
- Timestamps.

**Acceptance criteria:**

- An incident can be created against a registered agent.
- Its status follows validated state transitions.
- All important state changes are recorded.
- Failed or partial responses are distinguishable from successful containment.

## FR-05: Blast-Radius Analysis

CORVEN must calculate the potential impact of an incident.

The analysis should identify:

- Directly affected agents.
- Downstream delegated agents.
- Accessible credentials.
- Accessible resources.
- Affected workflows.
- Shared dependencies.
- Uninstrumented or unknown dependencies.

The engine must distinguish between:

- Authority exposure.
- Resource exposure.
- Operational impact.

**Acceptance criteria:**

- The compromised source is identified.
- Relevant downstream paths are discovered.
- Shared resources are identified.
- Healthy and potentially affected workflows are distinguished.
- Results include the paths and relationships that explain the impact.

## FR-06: Minimum Safe Containment Engine

This is CORVEN's central technical capability.

The engine must determine the smallest safe set of controllable permission or authorization changes that blocks the compromised paths while preserving healthy workflows.

Inputs:

- Dependency graph.
- Compromised agent.
- Protected resources.
- Healthy workflows.
- Available enforcement points.
- Revocation costs or impact weights.
- Authorization constraints.

Outputs:

- Proposed containment actions.
- Affected permissions.
- Protected resources.
- Preserved workflows.
- Expected impact.
- Uncertain dependencies.
- Approval requirements.

Potential algorithmic direction:

- Graph traversal.
- Path analysis.
- Weighted minimum-cut or constrained hitting-set formulation.
- Deterministic selection of controllable authorization changes.

The final algorithm will be specified and justified in the containment-engine design document.

Important constraints:

- A shared resource must not be revoked globally if only one agent's access needs to be blocked.
- Agent-specific permissions should be preferred where they achieve safe containment.
- Healthy workflows must be included in the optimization constraints.
- In-flight operations must recheck authorization at the execution boundary.
- High-impact or uncertain changes should require approval.

**Acceptance criteria:**

- Identical inputs produce identical plans.
- Compromised paths are blocked in the modeled graph.
- Healthy workflows remain reachable where feasible.
- The engine explains why each action is proposed.
- Impossible or uncertain containment is reported rather than presented as success.

## FR-07: Authorization and Enforcement Gateway

CORVEN must enforce authorization decisions at controlled execution boundaries.

Responsibilities:

- Receive an operation request.
- Identify the requesting agent.
- Validate its current authorization.
- Check the relevant permission state.
- Reject unauthorized operations.
- Record the execution result.
- Recheck authorization for relevant in-flight operations.

**Acceptance criteria:**

- Authorized operations succeed.
- Revoked or blocked operations fail.
- Permission changes take effect at the controlled execution boundary.
- Enforcement results are recorded.
- Enforcement failures are not reported as successful containment.

CORVEN cannot directly revoke independent credentials or permissions that do not pass through its enforcement mechanisms.

## FR-08: Human Approval

CORVEN must support human approval for sensitive containment actions.

Approval may be required when:

- Shared resources may be affected.
- A proposed change has significant operational impact.
- Dependency information is incomplete.
- An action affects a high-value resource.
- The containment plan is ambiguous.

**Acceptance criteria:**

- A plan can be presented for approval.
- Approval and rejection are recorded.
- Only authorized users can approve sensitive actions.
- A rejected plan cannot be executed as approved.

## FR-09: Post-Containment Verification

CORVEN must verify that containment has achieved its intended outcome.

Verification must include:

- Attempting the previously blocked compromised operation.
- Checking the enforcement response.
- Testing an unaffected healthy workflow.
- Comparing expected and observed outcomes.
- Recording any discrepancies.

**Acceptance criteria:**

- A blocked compromised operation is confirmed at the enforcement boundary.
- A healthy workflow is demonstrated to remain functional.
- Failed verification is reported clearly.
- An incident is not marked verified merely because a transaction was submitted.

## FR-10: Verifiable Evidence

CORVEN must generate evidence of incident analysis and response.

Evidence may include:

- Incident metadata.
- Dependency graph snapshot or reference.
- Blast-radius result.
- Containment plan.
- Approval record.
- Execution result.
- Verification result.
- Timestamps.
- Cryptographic hashes.
- Relevant transaction references.

Cryptographic direction:

- Hash incident records.
- Use signed structured records where appropriate.
- Use hash-linked evidence to expose modifications.
- Provide a way to verify record integrity independently.

**Acceptance criteria:**

- Evidence is generated for completed response stages.
- Integrity can be checked independently.
- Failed and partial actions remain represented.
- Evidence references can be retrieved.

# 7. Blockchain and Ecosystem Integrations

These integrations must support the core product. They must not exist only to satisfy sponsor requirements.

## 7.1 Ethereum

Purpose:

- Execute relevant authorization changes.
- Record smart contract events.
- Provide verifiable transaction references.
- Support on-chain response evidence.

Initial network: Ethereum Sepolia.

## 7.2 ENS

Purpose:

- Represent agent identities through ENS names.
- Explore hierarchical agent identities.
- Associate agent identity with ownership and delegation relationships.
- Use applicable ENS access-control and lifecycle capabilities.

The integration must connect identity information to actual CORVEN authorization and enforcement.

Registering an ENS name alone does not revoke wallet, API or database permissions.

## 7.3 Arkiv

Purpose:

- Store incident snapshots.
- Store dependency or delegation records where appropriate.
- Preserve containment plans and outcomes.
- Retrieve historical incident records.
- Provide user-visible querying of stored evidence.

Requirements:

- Follow the applicable Arkiv data and ownership model.
- Use real Arkiv writes and reads.
- Make stored records useful to the incident workflow.
- Preserve verifiable references to records.

## 7.4 Chainlink CRE

Purpose:

- Connect an external incident signal or data source to a workflow.
- Execute a meaningful response workflow.
- Interact with the relevant on-chain component.
- Record the workflow result.

Potential flow:

1. Receive an external incident signal.
2. Validate the signal.
3. Trigger the CRE workflow.
4. Call the appropriate on-chain response mechanism.
5. Record and verify the resulting status.

The workflow must have a meaningful role in CORVEN rather than being a decorative integration.

# 8. Product Dashboard Requirements

The dashboard will provide an operational interface for security engineers and infrastructure operators.

## 8.1 Overview

Display:

- Registered agents.
- Active incidents.
- Current security status.
- Connected resources.
- Recent response activity.
- Verification status.

## 8.2 Dependency Graph

Display:

- Agent nodes.
- Permission nodes.
- Credential nodes.
- Resource nodes.
- Workflow nodes.
- Typed dependency edges.
- Compromised paths.
- Shared resources.
- Containment actions.

The graph should support selecting nodes and inspecting their relationships.

## 8.3 Incident Detail

Display:

- Incident source.
- Severity.
- Incident timeline.
- Blast radius.
- Affected entities.
- Containment recommendations.
- Approval status.
- Execution status.
- Evidence references.

## 8.4 Containment Interface

Display:

- Proposed actions.
- Why each action is necessary.
- Expected impact.
- Healthy workflows to preserve.
- Risks and uncertainty.
- Approval and execution controls.

## 8.5 Evidence Viewer

Display:

- Incident record.
- Evidence hash.
- Signature verification status.
- On-chain transaction references.
- Arkiv record references.
- Response timeline.

# 9. Proposed System Architecture

The architecture will separate responsibilities into independently testable modules.

## 9.1 Application Layer

**Web application**

- Next.js.
- TypeScript.
- Tailwind CSS.
- shadcn/ui.
- React Flow.

Responsibilities:

- User interface.
- Dependency graph visualization.
- Incident investigation.
- Containment approval.
- Evidence inspection.

## 9.2 API and Orchestration Layer

**Backend API**

- Node.js.
- TypeScript.
- Fastify.

Responsibilities:

- API requests.
- Authentication and authorization.
- Incident orchestration.
- Communication between services.
- Validation.
- Audit events.

## 9.3 Core Domain Modules

1. Agent Registry.
2. Dependency Registry.
3. Graph Engine.
4. Incident Management.
5. Blast-Radius Engine.
6. Containment Engine.
7. Authorization Gateway.
8. Approval Service.
9. Verification Service.
10. Evidence Service.

These modules should have clear interfaces and can initially run within a modular backend rather than requiring separate microservices.

## 9.4 Integration Layer

1. Ethereum integration.
2. ENS integration.
3. Arkiv integration.
4. Chainlink CRE integration.

Each integration should be isolated behind a defined adapter interface.

## 9.5 Data Layer

Initial database: PostgreSQL.

Potential tables/entities:

- users.
- agents.
- identities.
- permissions.
- credentials.
- resources.
- workflows.
- dependencies.
- incidents.
- incident_events.
- containment_plans.
- containment_actions.
- approvals.
- execution_records.
- evidence_records.

The database is the operational source of truth for application state. Blockchain and Arkiv records provide additional verifiability and persistence, not a replacement for every database query.

# 10. Deployment and Infrastructure Requirements

CORVEN must support local development, testnet integration and a publicly accessible demonstration environment.

## 10.1 Local Development

Expected tools:

- Ubuntu development environment.
- Node.js and TypeScript.
- Docker and Docker Compose.
- PostgreSQL or development database.
- Foundry.
- Local Ethereum development node through Anvil.
- Git and GitHub.

Requirements:

- Reproducible setup.
- Environment-based configuration.
- Local testing without paid services.
- Clear startup instructions.

## 10.2 Cloud Deployment

Proposed deployment architecture:

| Component             | Proposed platform         |
| --------------------- | ------------------------- |
| Frontend              | Vercel                    |
| Backend API           | AWS EC2 initially         |
| Container runtime     | Docker                    |
| Database              | Neon PostgreSQL initially |
| Source control        | GitHub                    |
| CI/CD                 | GitHub Actions            |
| DNS and TLS           | Cloudflare, if required   |
| Blockchain            | Ethereum Sepolia          |
| Decentralized records | Arkiv                     |

AWS EC2 is the initial deployment choice because a single small instance can host the backend and optional worker without introducing unnecessary infrastructure.

## 10.3 AWS Requirements

AWS may host:

- Backend API.
- Background worker, if required.
- Containerized services.
- Application logs.
- Supporting storage and backups where justified.

AWS credits: approximately $100, subject to eligibility and expiration.

Cost-control requirements:

- Use small instances.
- Avoid unnecessary managed services.
- Avoid expensive networking infrastructure.
- Set budget alerts.
- Monitor actual usage.
- Shut down unused resources.
- Verify which services are eligible for the available credits.

## 10.4 CI/CD

GitHub Actions should support:

1. Dependency installation.
2. Linting.
3. Type checking.
4. Unit tests.
5. Contract tests.
6. Build validation.
7. Deployment of approved changes.

Secrets must be stored in the hosting provider's secret-management facility, not committed to Git.

## 10.5 Deployment Acceptance Criteria

- The frontend is publicly accessible.
- The backend API is publicly reachable over HTTPS.
- Health checks are available.
- Database connectivity works.
- Environment secrets are configured safely.
- Smart contracts are deployed to the selected testnet.
- Integrations can be demonstrated.
- The full incident scenario works in the deployed environment.

# 11. Security Requirements

CORVEN itself must be designed as security-sensitive infrastructure.

## 11.1 Authentication

- Authenticated access to administrative operations.
- Secure handling of sessions and tokens.
- No exposed administrative endpoints.
- Protected approval operations.

## 11.2 Authorization

- Role-based access to sensitive operations.
- Ownership checks for registered agents and resources.
- Approval controls for high-impact actions.
- Explicit authorization before execution.

## 11.3 Application Security

- Validate all external input.
- Protect against unauthorized API access.
- Avoid logging credentials or private keys.
- Use secure secret management.
- Apply rate limits where appropriate.
- Validate external integration responses.

## 11.4 Smart Contract Security

- Explicit access controls.
- Validated state transitions.
- Replay protection where relevant.
- Safe signature verification.
- Expiration handling.
- Revocation checks.
- Unit and adversarial tests.

## 11.5 Evidence Security

- Cryptographic integrity checks.
- Signed records where appropriate.
- Clear separation between submitted and verified evidence.
- No misleading success status for failed transactions.

# 12. Non-Functional Requirements

| Category        | Requirement                                                                      |
| --------------- | -------------------------------------------------------------------------------- |
| Reliability     | Failures must be reported explicitly.                                            |
| Determinism     | Identical graph inputs must produce consistent analysis and containment results. |
| Security        | Unauthorized operations must be rejected at controlled execution boundaries.     |
| Explainability  | Containment decisions must include their reasoning and affected paths.           |
| Usability       | An operator should understand the incident and proposed response quickly.        |
| Maintainability | Modules must have clear responsibilities and interfaces.                         |
| Testability     | Core algorithms must be testable without external blockchain services.           |
| Observability   | Important operations must produce structured logs and status information.        |
| Scalability     | Architecture should allow larger dependency graphs without requiring a redesign. |
| Cost efficiency | Initial deployment should fit within available free resources and credits.       |

Performance targets will be established after benchmarking the graph engine and containment algorithm. We should not invent throughput or latency guarantees before testing.

# 13. Error Handling and Failure Scenarios

CORVEN must explicitly handle:

- Agent not found.
- Invalid dependency.
- Circular or inconsistent dependency relationships.
- Incomplete graph information.
- Unavailable external APIs.
- RPC provider failure.
- Blockchain transaction failure.
- Arkiv write or read failure.
- CRE workflow failure.
- Unauthorized approval.
- Partial containment.
- Failed verification.
- Database unavailability.
- Expired or revoked credentials.

A partial response must never be reported as a fully contained incident.

Where a response cannot be completed safely, CORVEN must preserve the incident state, report the failure and provide an actionable next step.

# 14. Testing Strategy

## 14.1 Unit Testing

Test:

- Agent registration.
- Dependency validation.
- Graph construction.
- Graph traversal.
- Blast-radius analysis.
- Containment calculations.
- Permission evaluation.
- Evidence hashing.

## 14.2 Integration Testing

Test:

- API to database.
- Registry to graph engine.
- Graph engine to containment engine.
- Containment engine to authorization gateway.
- Backend to smart contracts.
- Backend to ENS.
- Backend to Arkiv.
- Backend to CRE.

## 14.3 Smart Contract Testing

Use Foundry to test:

- Valid authorization.
- Unauthorized authorization.
- Delegation constraints.
- Revocation.
- Expiration.
- Invalid signatures.
- Replay attempts.
- State transitions.

## 14.4 End-to-End Testing

The primary end-to-end scenario:

1. Register five agents.
2. Register permissions and resource dependencies.
3. Execute normal operations.
4. Simulate compromise of one agent.
5. Generate an incident.
6. Calculate the blast radius.
7. Generate a minimum-safe-containment plan.
8. Approve the plan.
9. Execute containment.
10. Verify the compromised operation is blocked.
11. Verify a healthy agent still performs its operation.
12. Retrieve the incident evidence.

## 14.5 Testing Acceptance Criteria

- Core domain modules have automated tests.
- Containment edge cases are covered.
- Smart contract tests pass.
- External integration failures are handled.
- The complete demo scenario passes.
- Known limitations are documented.

# 15. Development Roadmap

Development will follow a documentation-first and module-by-module approach.

## Phase 1 — Product and Architecture

- Finalize the PRD.
- Define use cases.
- Establish MVP scope.
- Define domain model.
- Define graph model.
- Define service boundaries.
- Document the threat model.

## Phase 2 — Core Backend

- Agent registry.
- Dependency registry.
- Graph engine.
- Incident management.
- Blast-radius analysis.
- Containment engine.

## Phase 3 — Enforcement

- Authorization gateway.
- Permission evaluation.
- Human approval.
- Revocation mechanisms.
- Post-containment verification.

## Phase 4 — Blockchain Integrations

- Solidity contracts.
- Ethereum Sepolia.
- ENS integration.
- Arkiv integration.
- Chainlink CRE integration, if feasible.

## Phase 5 — Evidence and Dashboard

- Evidence generation.
- Cryptographic verification.
- Dependency graph UI.
- Incident investigation UI.
- Containment approval UI.
- Evidence viewer.

## Phase 6 — Deployment and Validation

- Docker setup.
- AWS deployment.
- Frontend deployment.
- Database setup.
- CI/CD.
- Security testing.
- End-to-end demo.

The sequence can be adjusted based on integration blockers and available hackathon time, but core graph analysis and containment must remain the priority.

# 16. Primary Demo Scenario

The demo must communicate CORVEN's value through a working incident.

**Initial state**

A network contains five agents, connected resources, delegated permissions and healthy workflows.

**Incident**

One agent becomes compromised and attempts an unauthorized operation using its connected permissions.

**Analysis**

CORVEN:

- Identifies the incident source.
- Reconstructs affected dependency paths.
- Identifies downstream agents and resources.
- Detects shared dependencies.
- Calculates the potential blast radius.

**Containment**

CORVEN:

- Generates a minimum-safe-containment plan.
- Explains each proposed action.
- Requests approval where required.
- Executes the approved authorization changes.

**Verification**

CORVEN:

- Confirms that the compromised operation is blocked.
- Demonstrates that an unaffected healthy agent still succeeds.
- Records the incident response.

**Evidence**

The dashboard displays:

- Incident timeline.
- Dependency analysis.
- Containment plan.
- Execution results.
- Verification results.
- Relevant blockchain and Arkiv references.

# 17. Hackathon Submission Requirements

The project will be developed under ETHGlobal Mumbai 2026's Classic — From Scratch track.

The submission should include:

- Project name and description.
- GitHub repository.
- Working application.
- Public demonstration URL where possible.
- Demo video between 2 and 4 minutes.
- Technical explanation.
- Partner integrations selected in the submission.
- AI usage and attribution.
- Clear distinction between newly developed work and reused public libraries.

Development requirements:

- Start project-specific work after the official hackathon start.
- Maintain meaningful, incremental commits.
- Document AI assistance.
- Avoid large unexplained commits.
- Maintain evidence of project development.
- Ensure the repository accurately reflects the work completed during the event.

# 18. Risks and Constraints

| Risk                                                          | Mitigation                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| Scope too large for solo development                          | Prioritize graph analysis, containment and verification.      |
| Blockchain integration complexity                             | Keep integrations behind adapters and test independently.     |
| ENS capabilities do not directly control external permissions | Connect identity to an actual enforcement mechanism.          |
| Arkiv integration takes longer than expected                  | Build the evidence model independently first.                 |
| CRE integration becomes a distraction                         | Implement only if it supports a meaningful incident workflow. |
| Incorrect containment calculation                             | Use deterministic algorithms and extensive test cases.        |
| Shared resources disrupt healthy agents                       | Model resource dependencies explicitly.                       |
| Independent credentials cannot be revoked                     | Display enforcement coverage and limitations.                 |
| Cloud costs exceed available credits                          | Use small infrastructure and budget alerts.                   |
| Incomplete incident visibility                                | Track unknown dependencies and uncertainty explicitly.        |

# 19. Explicit Product Limitations

CORVEN must not claim:

1. That it can control every external agent or resource.
2. That it can revoke independent credentials outside its enforcement boundary.
3. That it can reverse completed blockchain transactions.
4. That its graph contains every possible dependency.
5. That an AI-generated recommendation is automatically safe.
6. That submitting a transaction means containment succeeded.
7. That a recorded incident is independently verified unless its integrity has actually been checked.

The product must clearly distinguish:

- Planned containment.
- Approved containment.
- Submitted containment.
- Executed containment.
- Verified containment.

# 20. Definition of Done

The initial CORVEN MVP is considered complete when:

- [ ] Agents can be registered.
- [ ] Dependencies can be represented and retrieved.
- [ ] A typed dependency graph can be constructed.
- [ ] A compromised agent's blast radius can be calculated.
- [ ] A deterministic containment plan can be generated.
- [ ] Shared resources and healthy workflows are considered.
- [ ] Authorization changes can be enforced at controlled execution boundaries.
- [ ] Human approval works for sensitive actions.
- [ ] Compromised operations can be blocked.
- [ ] Healthy workflows can continue.
- [ ] Response results can be verified.
- [ ] Verifiable evidence can be generated and retrieved.
- [ ] Meaningful ENS and Arkiv integrations are demonstrated.
- [ ] Chainlink CRE is integrated if feasible within the development window.
- [ ] The frontend demonstrates the complete workflow.
- [ ] Automated tests pass.
- [ ] The application is deployed and accessible.
- [ ] Technical limitations are clearly documented.
- [ ] Git history and AI attribution are maintained.

---

# Final Product Definition

CORVEN is a dependency-aware incident-response infrastructure layer for autonomous AI networks.

It maps the relationships between agents, permissions, credentials, resources and workflows; calculates the impact of a compromised agent; determines the minimum safe containment boundary; enforces authorized changes through controlled execution points; verifies that healthy workflows remain operational; and produces verifiable incident evidence.

**Its central technical differentiator is not simply detecting or disabling a compromised agent. It is minimizing cross-system damage while preserving healthy operations and proving the outcome.**
