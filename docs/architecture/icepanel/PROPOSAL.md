# CORVEN C4 model — proposal (not yet imported)

Status: **draft awaiting approval**. Nothing has been uploaded to IcePanel.
Machine-readable model: [model.json](model.json) (30 objects, 40 connections, namespace `corven`).
Target landscape: `corven landscape` (`yngAt5NE5oF5SlvQ05qT`), currently empty.

## L1 — System context
- Actors: Security Operator, Agent Owner, Auditor.
- CORVEN (the system).
- External: Monitored AI Agents, Protected Resources, Incident Signal Source, ENS, Ethereum Sepolia, Arkiv, Chainlink CRE.

## L2 — Containers (inside CORVEN)
| Container | Type | Notes |
|---|---|---|
| Web Dashboard | app | Next.js, TypeScript, Tailwind, shadcn/ui, React Flow |
| Backend API | app | Fastify, Node.js. Modular monolith |
| PostgreSQL | store | Operational source of truth |
| CORVEN Contracts | app | Solidity/Foundry on Sepolia |

Graph and containment engines are **components of the Backend API**, not separate containers.

## L3 — Components (inside Backend API)
Ten PRD modules: Agent Registry, Dependency Registry, Graph Engine, Incident Management, Blast-Radius Engine, Containment Engine, Authorization Gateway, Approval Service, Verification Service, Evidence Service.
Plus four adapters: Ethereum, ENS, Arkiv, CRE.

Incident Management is the orchestrator. It calls Blast-Radius, Containment, Approval, Gateway, Verification and Evidence in order.

## Contradictions and gaps found in the docs
1. **Engines as containers vs modules.** The assignment lists Graph/Containment engines and the gateway at L2. The PRD (9.3) says modules run in a modular backend. Proposal: components.
2. **Authorization Gateway placement.** PRD calls it a "controlled execution boundary" that agents hit, which suggests a separately reachable enforcement point. Proposal keeps it in-process (components of Backend API). **Decision needed.**
3. **Source of truth for permissions.** PRD 9.5 says the database is the source of truth, but 7.1 and FR-07 have contracts enforcing permission state. Which one the gateway checks is undefined.
4. **Chainlink CRE direction.** PRD 7.4 has CRE calling "the on-chain response mechanism". Model draws CRE to Contracts and CRE to Backend API (signal intake). Pick one.
5. **Signal source** is not defined anywhere. Modelled as a placeholder external system.
6. **Evidence signing key** owner and storage are unspecified.
7. **Dashboard authentication/roles** (FR-08, 11.1) name no identity provider or mechanism. Not modelled.
8. **shadcn/ui** is in the PRD stack but not the README.
9. [docs/02-product-requirements.md](../../02-product-requirements.md) line 95 is garbled text.
10. README status table still lists the PRD as "Planned".
11. README `packages/graph-engine` and `containment-engine` are libraries inside the monolith, consistent with the proposal.

## Not modelled yet (deliberately)
- Flows (registration, incident response, blast radius, containment, verification, evidence).
- Deployment view (Vercel, EC2, Neon, Docker, GitHub Actions).
- Technology icons: need a catalog lookup after approval.
- Trust boundaries and data ownership beyond descriptions.

## Next steps once approved
1. Import `model.json`, then delete the leftover "Default domain".
2. Create L1, L2, L3 diagrams (one story each) with hand-placed layout.
3. Run `verify` and hand over the landscape link.
4. Add flows and the deployment view as follow-ups.
