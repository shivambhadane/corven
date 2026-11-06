# CORVEN — Project Overview

**Tagline:** Infrastructure for Trusted Autonomous Systems
**Category:** Cross-system incident response for autonomous AI agent networks
**Event:** ETHGlobal Mumbai 2026 (Classic, From Scratch track)
**Docs last reviewed:** 6 November 2026

## What CORVEN is

CORVEN is a dependency-aware incident-response layer for networks of autonomous AI agents. Agents hold wallets, API access, credentials and delegated authority from each other. When one is compromised, switching it off is not enough, and revoking everything it touched breaks healthy agents. CORVEN is meant to:

1. **Discover** agents, resources and the dependencies between them, with evidence and confidence.
2. **Analyze** what a compromised agent can reach (the blast radius).
3. **Contain** it with the smallest safe set of authorization changes.
4. **Verify** that compromised paths are blocked and healthy workflows still run.
5. **Prove** what happened with hash-linked, independently checkable evidence.

The central differentiator is not detecting or disabling a compromised agent. It is minimizing cross-system damage while preserving healthy operations, and proving the outcome.

## Where the project stands

| Area | State |
|---|---|
| Agent Registry | Built and tested |
| Dependency Registry (typed dependencies, versions, evidence, internal writer) | Built and tested |
| Graph Engine (immutable graph, traversal, paths, components, cycles) | Built and tested (on branch `feature/graph-engine` until merged) |
| Dependency Discovery | In progress: registry-side groundwork only |
| Incident Management, Blast-Radius, Containment, Gateway, Approval, Verification, Evidence | Designed in these docs, not built |
| Smart contracts, ENS, Arkiv, Chainlink CRE | Designed, not built |
| Dashboard | Not built. A static landing page exists in `apps/landing` |
| Authentication | **Development-only adapter.** No real authentication or organizations yet |

See [project/01-implementation-roadmap.md](project/01-implementation-roadmap.md) and [project/06-known-limitations.md](project/06-known-limitations.md). Every document says plainly whether it describes something built or something planned.

## Repository layout (actual)

```text
corven/
├── apps/
│   ├── api/            Fastify + TypeScript + Drizzle API (built modules live here)
│   │   ├── src/modules/{agent-registry,dependency-registry,graph-engine}
│   │   ├── src/{auth,db,app.ts,server.ts,errors.ts}
│   │   ├── drizzle/    SQL migrations (+ down/ scripts)
│   │   └── test/       Vitest suites (real PostgreSQL)
│   └── landing/        Static marketing page
├── contracts/          Reserved for Solidity/Foundry (empty)
├── docs/               This documentation
├── docker-compose.yml  Local PostgreSQL
└── README.md
```

Planned but not created: `apps/web` (dashboard), `packages/*`, `integrations/*`. The README's earlier layout sketch lists them as intentions.

## Documentation map

| Folder | Contents |
|---|---|
| `01-problem-statement`, `02-product-requirements`, `03-use-cases`, `04-mvp-scope` | Why, what, for whom, how much |
| `architecture/` | System, container, module, deployment, data and security architecture; incident sequences |
| `modules/` | One document per domain module (built modules describe the code; planned ones are designs). The Graph Engine has its own folder: [modules/graph-engine/](modules/graph-engine/README.md) |
| `engineering/` | Database schema, API contracts, event flow, authorization, contracts, threat model, evidence verification, errors, testing |
| `integrations/` | Ethereum, ENS, Arkiv, Chainlink CRE designs |
| `operations/` | Infrastructure plan, deployment, configuration, monitoring |
| `project/` | Roadmap, tasks, commit strategy, demo script, AI attribution, limitations |
| `architecture/icepanel/` | The C4 model imported into IcePanel (proposal + import files) |

## Technology (actual versus planned)

| Layer | In use | Planned |
|---|---|---|
| Backend | Node.js 24, TypeScript 6, Fastify 5, TypeBox | pg-boss (background jobs) |
| Data | PostgreSQL 17, Drizzle ORM | Neon (hosted) |
| Testing | Vitest against real PostgreSQL | Foundry for contracts |
| Frontend | Static HTML/CSS (landing) | Next.js, Tailwind, shadcn/ui, React Flow |
| Chain and identity | none | Solidity, Ethereum Sepolia, ENS, Arkiv, Chainlink CRE |
| Infrastructure | Docker Compose (local) | Vercel, AWS EC2, GitHub Actions |

## Running it

See [operations/02-deployment-guide.md](operations/02-deployment-guide.md). In short: `docker compose up -d --wait`, `pnpm install`, `pnpm test`.

## Design principles

Deterministic enforcement (never an AI model alone), least-disruptive containment, verifiable response, explicit authority boundaries, and transparent limitations. The explicit limitations are in [project/06-known-limitations.md](project/06-known-limitations.md).
