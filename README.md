# CORVEN

### Infrastructure for Trusted Autonomous Systems

**Cross-System Incident Response for Autonomous AI Networks**

CORVEN is an incident-response infrastructure layer designed to help organizations understand, contain and investigate security incidents across interconnected autonomous AI agents.

As AI agents gain access to wallets, APIs, databases, credentials and other agents, compromising one agent can expose an entire network of connected resources and workflows.

Stopping a compromised agent alone may not be enough.

CORVEN aims to identify the full impact of a compromised agent, calculate the smallest safe containment boundary, execute the response and generate verifiable evidence — while preserving unaffected operations.

---

## The Problem

Autonomous agents increasingly operate with delegated permissions and access to shared resources.

A compromised agent may:

- Access sensitive resources through delegated permissions.
- Pass authority to other agents.
- Trigger operations across connected systems.
- Disrupt workflows that depend on shared credentials or resources.
- Leave organizations without a clear, verifiable incident history.

Most security controls focus on individual identities, permissions, transactions or runtime activity.

**The missing layer is cross-system incident response that understands dependencies and minimizes operational disruption.**

## Our Approach

CORVEN is designed around five capabilities:

| Capability | Responsibility                                                                       |
| ---------- | ------------------------------------------------------------------------------------ |
| Discover   | Map agents, permissions, credentials, resources and workflows.                       |
| Analyze    | Trace dependencies and calculate the incident blast radius.                          |
| Contain    | Determine and execute the minimum safe containment plan.                             |
| Verify     | Confirm that compromised paths are blocked and healthy workflows remain operational. |
| Prove      | Generate verifiable evidence of the incident and response.                           |

## How It Works

1. **Map the environment:** Build a dependency graph of agents and connected resources.
2. **Detect an incident:** Identify a compromised agent or suspicious operation.
3. **Calculate impact:** Trace affected agents, permissions, resources and workflows.
4. **Plan containment:** Determine the smallest safe set of authorization changes.
5. **Execute and verify:** Apply containment through controlled enforcement points and test unaffected workflows.
6. **Record evidence:** Preserve a verifiable incident timeline and response record.

## Technical Direction

The planned technology stack includes:

- **Frontend:** Next.js, TypeScript, Tailwind CSS
- **Backend:** Node.js, Fastify
- **Database:** PostgreSQL
- **Dependency visualization:** React Flow
- **Graph and containment engine:** TypeScript
- **Smart contracts:** Solidity, Foundry
- **Blockchain:** Ethereum Sepolia
- **Agent identity:** ENS
- **Decentralized records:** Arkiv
- **Workflow integration:** Chainlink CRE

Technology choices and integrations may evolve during implementation.

## Core Design Principles

- **Deterministic enforcement:** Security decisions must not depend solely on an AI model.
- **Least-disruptive containment:** Protect healthy workflows wherever possible.
- **Verifiable response:** Incident actions should produce independently checkable evidence.
- **Explicit authority boundaries:** Only permissions and operations controlled by CORVEN can be directly enforced or revoked.
- **Transparent limitations:** Uninstrumented dependencies and irreversible completed actions must be clearly identified.

## Project Status

<text>Early implementation. The registries and the graph engine are built and tested; the incident-response modules are designed but not built.</text>

| Area                                       | Status                                    |
| ------------------------------------------ | ----------------------------------------- |
| Documentation (PRD, architecture, modules) | Written (see [docs/](docs/))              |
| Agent Registry                             | Built and tested                          |
| Dependency Registry                        | Built and tested                          |
| Graph Engine                               | Built and tested ([docs](docs/modules/graph-engine/README.md)) |
| Graph Snapshots                            | Built and tested ([docs](docs/modules/graph-snapshot.md)) |
| Dependency Discovery                       | Implemented (config, workflow, runtime sources; pg-boss queue) ([docs](docs/modules/dependency-discovery.md)) |
| Incident Management                        | Built and tested ([docs](docs/modules/incident-management/README.md)) |
| Blast-Radius and Containment engines       | Built and tested ([blast radius](docs/modules/05-blast-radius-engine.md), [containment](docs/modules/06-containment-engine.md)) |
| Authorization & Enforcement Gateway        | Built and tested; executors simulated ([docs](docs/modules/authorization-enforcement/README.md)) |
| Approval Service                           | Built and tested ([docs](docs/modules/approval-service/README.md)) |
| Verification Service                       | Built and tested; probes use simulated executors ([docs](docs/modules/verification-service/README.md)) |
| Incident-response orchestration            | Built and tested ([docs](docs/modules/orchestration/README.md)) |
| Evidence Service                           | Built and tested; Arkiv integrated and tested on Rabdi; Ethereum contract and client tested locally, not deployed ([docs](docs/modules/evidence-service/README.md)) |
| Smart contracts, ENS, Arkiv, Chainlink CRE | Designed, not built                      |
| Dashboard                                  | Not started (landing page: `apps/landing`) |
| Authentication                             | **Development-only adapter**              |
| CI and cloud deployment                    | Not started                               |

Exact scope, limits and the roadmap: [docs/project/06-known-limitations.md](docs/project/06-known-limitations.md) and [docs/project/01-implementation-roadmap.md](docs/project/01-implementation-roadmap.md).

## Repository Structure

```text
corven/
├── apps/
│   ├── api/            Fastify + TypeScript + Drizzle API (registries, graph engine, tests)
│   └── landing/        Static landing page
├── contracts/          Reserved for Solidity/Foundry
├── docs/               Documentation (start at docs/00-project-overview.md)
├── docker-compose.yml  Local PostgreSQL
└── README.md
```

Planned but not created: `apps/web` (dashboard), `packages/*`, `integrations/*`.

## Quick Start

```bash
corepack enable && pnpm install
docker compose up -d --wait
pnpm typecheck && pnpm lint && pnpm test
```

More in [docs/operations/02-deployment-guide.md](docs/operations/02-deployment-guide.md). The API has no production authentication yet; do not expose it publicly.

## Scope and Limitations

CORVEN is an incident-response layer, not a universal security guarantee.

It can only enforce controls over systems and operations integrated with its enforcement mechanisms. It cannot automatically reverse completed blockchain transactions or revoke independent credentials outside its control.

Containment decisions involving shared resources or uncertain dependencies may require human approval.

## Development

CORVEN is being developed for **ETHGlobal Mumbai 2026**, under the Classic — From Scratch track.

Development will follow a documentation-first, module-by-module process with incremental implementation, testing and version-controlled commits.

## License

To be determined.
