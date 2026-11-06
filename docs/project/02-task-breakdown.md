# Task Breakdown

Checklist view of the roadmap. `[x]` done and tested, `[~]` partly done, `[ ]` not started. Status as of 6 November 2026.

## Foundation

- [x] pnpm workspace and TypeScript strict configuration
- [x] Fastify app, TypeBox validation, unknown fields rejected, error envelope
- [x] Drizzle schema and migrations with hand-written down scripts
- [x] Local PostgreSQL (Docker Compose)
- [x] Vitest on real PostgreSQL (throwaway database per run)
- [x] RBAC permissions and the fail-closed authenticator
- [ ] **Real authentication, users, organizations, memberships**
- [ ] GitHub Actions CI (install, lint, typecheck, test, build)
- [ ] Rate limiting
- [ ] Dependency and secret scanning

## Agent Registry (done)

- [x] Register, list, get, update with filters and pagination
- [x] Lifecycle policy; admin-only recovery; status history
- [x] Capabilities, identities (never self-verified)
- [x] External reference, owner reference, runtime type
- [x] Append-only audit; atomic writes
- [x] `AgentRegistryReader`
- [ ] Audit read endpoint
- [ ] ENS verification (`recordVerification` exists as the entry point)

## Dependency Registry (done)

- [x] Resources (minimum model) with external references
- [x] Typed dependencies, relationship validation, per-type metadata
- [x] Authority cycle prevention (advisory lock), operational cycles allowed
- [x] Versioning, audit, optimistic concurrency, soft removal
- [x] Append-only evidence; `DependencyRegistryWriter`; `DependencyGraphDataProvider`
- [ ] Resource audit trail, update and removal (out of scope for now)

## Graph Engine (done; PR pending)

- [x] Immutable graph, builder, integrity report
- [x] BFS, DFS, reachability, shortest path, bounded path enumeration
- [x] Weak components, cycle detection
- [x] API (12 endpoints), tenant isolation, read-only guarantee
- [x] Performance measured at 1,000 nodes / 5,000 edges
- [ ] Graph snapshots (separate module)
- [ ] Caching / incremental updates (only if measurements justify)

## Dependency Discovery (done)

- [x] Registry-side prerequisites (writer, evidence, readers, system principal)
- [x] Discovery sources, runs, observations tables and API
- [x] pg-boss jobs and outbox
- [x] Adapters: agent configuration, workflow definition, runtime gateway
- [x] Normalization, entity resolution, confidence rules
- [x] Reconciliation: new, unchanged, modified, missing, conflicting, stale, unresolved
- [x] Human review
- [ ] Authenticated gateway-event ingestion (ingestion exists; producer authentication waits for the gateway)
- [x] End-to-end discovery test

## Graph Snapshots (done)

- [x] Immutable snapshots with hash verification, diff, API

## Blast-Radius Engine

- [x] Resolve the inherited-authority question (delegators reported as uncertain; inheritance not modelled)
- [x] Classification rules, explaining paths, shared-resource dependents
- [x] Unit and golden tests on the demo graph
- [x] API

## Containment Engine

- [x] Algorithm design review ([modules/06](../modules/06-containment-engine.md))
- [x] Max-flow core with deterministic minimum cut and tests
- [x] Workflow preservation and re-verification
- [x] Planner, explanations, approval triggers
- [x] Brute-force comparison and performance tests

## Incident Management, Gateway, Approval, Verification, Evidence

- [x] Incident state machine, tables, API (done; see modules/incident-management)
- [x] Gateway placement decision; policy evaluator; enforcement adapters; fail-closed behavior (done; real resource executors and an on-chain adapter remain)
- [x] Approval bound to plan hash (done; see modules/approval-service)
- [ ] Verification checks and honest results
- [ ] Evidence: canonical hashing, chain, signing, verification, anchoring

## Integrations and contracts

- [ ] Permission-source decision; contract implementation and Foundry tests
- [ ] Chain adapter with fake; Anvil integration
- [ ] ENS adapter and verifier
- [ ] Arkiv adapter (after confirming its data model)
- [ ] Chainlink CRE (optional)

## Frontend

- [x] Landing page (`apps/landing`)
- [ ] Next.js dashboard: overview, graph (React Flow), incident detail, containment and approval, evidence viewer

## Deployment and submission

- [ ] Docker image, EC2, Neon, Vercel, secrets, TLS
- [ ] Seed script for the demo scenario
- [ ] End-to-end scenario test
- [ ] Demo video (2 to 4 minutes), technical explanation, submission form
- [x] AI attribution document; [ ] keep it current
