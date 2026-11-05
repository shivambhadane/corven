# Demo Script

Submission requirement: a demo video of 2 to 4 minutes that communicates value through a **working** incident. This document has two scripts: what can be shown honestly **today**, and the **target** script once the incident modules exist. Do not show the target script's steps as working until they are.

## The scenario ("Acme")

Five agents and shared resources:

| Agent | Role |
|---|---|
| Support | Customer conversations; delegates payment requests to Payment |
| Payment | Executes payments; uses the Payment Wallet and the shared Customer API; triggers Analytics |
| Database | Reads customer data through the shared Customer API |
| Analytics | Records transactions; triggers Email |
| Email | Sends receipts |

Resources: **Customer API** (shared by Support, Payment and Database) and **Payment Wallet**.
Edges: Support →(authority) Payment; Payment →(resource) Wallet; Payment →(resource) Customer API; Support →(resource) Customer API; Database →(resource) Customer API; Payment →(operational) Analytics →(operational) Email.
Incident: **Payment is compromised.**

## Today's demo (about 2 to 3 minutes, all real)

| Time | Show | Say |
|---|---|---|
| 0:00 | Landing page hero | "AI agents hold wallets, APIs and each other's trust. When one is compromised, switching it off isn't enough." |
| 0:20 | Landing page example, step through the four stages | "Revoking the shared API for everyone stops the attacker, and breaks Support and Database. This is what minimum safe containment is meant to avoid." Say clearly that this stage is an illustration |
| 0:50 | Terminal: register the five agents, two resources and the dependencies through the API (seed script) | "This is the registry. Every dependency is typed, versioned, has provenance and confidence, and an audit trail that the database refuses to edit." |
| 1:30 | `GET /graph/paths` from Support to Email; `GET /graph/reachability` Email → Support (false); `GET /graph/cycles` | "The graph is rebuilt from the registries, directed and deterministic. Reachability here is structural, not proof of compromise." |
| 2:00 | Try to create an authority cycle; try a cross-organization reference | "The registry rejects delegation cycles and cross-tenant references, in the application and in the database." |
| 2:20 | `docs/modules/06-containment-engine.md` and the status table on the landing page | "Blast radius, containment, enforcement, verification and evidence are designed and not built yet. Here is exactly what is and isn't done." |

## Target demo (3 to 4 minutes, requires the planned modules)

| Time | Beat | What the audience sees |
|---|---|---|
| 0:00 | Problem | One compromised agent, one shared API |
| 0:20 | Normal operation | Dashboard graph, all healthy, five agents |
| 0:40 | Incident | Payment attempts an unauthorized operation; incident opens |
| 1:00 | Blast radius | Compromised, exposed (Wallet, Customer API), potentially affected (Analytics, Email), with explaining paths |
| 1:30 | Plan | Cut Payment's own grants only; Support and Database access preserved; one uncertain action waits for approval; explanations per action |
| 2:00 | Approval and execution | Operator approves; actions execute; statuses move planned → approved → submitted → executed |
| 2:30 | Verification | The blocked operation is denied; Support still reads the Customer API; Database too |
| 3:00 | Evidence | Timeline, hashes, signature check, chain and Arkiv references; ENS identity shown for the compromised agent |
| 3:30 | Close | Limits stated: only what routes through CORVEN is enforced; what is verified is what was tested |

## Preparation checklist

- [ ] A seed script creating the Acme data (agents, resources, dependencies) reproducibly
- [ ] Terminal commands saved as a script; a clean database before recording
- [ ] Landing page deployed or served locally
- [ ] Screen recording at readable font size; no secrets visible (check terminal history, environment variables, tabs)
- [ ] Captions or a transcript for accessibility

## Honesty rules for the demo

1. Label illustrations as illustrations. Never present a mock as real output.
2. Do not claim containment succeeded unless verification actually passed.
3. State the limits out loud: uninstrumented dependencies, independent credentials and completed transactions are outside CORVEN's control.
4. Say which parts use development-only authentication.
5. Do not name or imply any partner integration that is not actually working in the demo.

## Submission checklist (from the PRD)

Project name and description, GitHub repository, working application, public demo URL where possible, 2 to 4 minute video, technical explanation, selected partner integrations, AI usage and attribution ([05-ai-usage-attribution.md](05-ai-usage-attribution.md)), and a clear distinction between new work and reused public libraries.
