# Testing Strategy

## Principles

- **Test against real PostgreSQL.** No database mocks. Constraints, triggers, locks and transactions are the point, so the tests run on a real server.
- **Test the security properties directly:** tenant isolation, mass assignment, forbidden roles, append-only history, atomicity under injected failures, concurrency.
- **Core algorithms are pure** (graph, and later blast radius and containment), so they are unit-tested without Fastify, the database or a chain.
- Report measured numbers, not targets.

## Infrastructure

| Piece | Detail |
|---|---|
| Runner | Vitest 5, `pnpm test` from the repo root |
| Database | `docker compose up -d --wait` starts PostgreSQL 17 on `127.0.0.1:54329`. `test/global-setup.ts` creates a throwaway database, applies the real migrations and drops it afterwards. **If PostgreSQL is unreachable the run fails; it never skips** |
| Isolation | Each test uses fresh random organization ids, so tests do not interfere and need no cleanup (history tables are append-only anyway) |
| HTTP | Tests call the Fastify app with `inject()` through a small client; no network needed |
| Fault injection | Subclassed repositories throw at chosen points (audit, version or evidence writes) to prove rollback |
| Quality gates | `pnpm typecheck` (TypeScript 6 strict, `noUncheckedIndexedAccess`) and `pnpm lint` (ESLint) |

## Current suites (367 tests, 27 files)

| Area | Files | What they prove |
|---|---|---|
| Agent Registry | `registration`, `retrieval`, `update`, `lifecycle`, `capabilities`, `identities`, `audit`, `auth`, `policy`, `agent-external-reference` | Validation, duplicates, pagination, filters, protected fields, the full status-transition matrix, recovery authorization, history, rollback on audit failure, concurrency (exactly one winner), identities can never self-verify, audit cannot be modified over HTTP or SQL |
| Dependency Registry | `dependency-registration`, `-validation`, `-shared-resources`, `-cycles`, `-versioning`, `-security`, `-api`, `-evidence`, `-writer`, `relationship-policy`, `resource-references` | The exhaustive endpoint-type matrix, DB-level foreign keys and CHECKs via raw SQL, shared resources, operational vs authority cycles including concurrent creation, contiguous versions under concurrent updates, no-op updates, optimistic concurrency, evidence integrity, writer idempotency under concurrency |
| Graph Engine | `graph-core`, `-traversal`, `-paths-structure`, `-api`, `-performance` | Construction and every integrity failure, immutability, BFS/DFS equivalence on random graphs, bounded path and cycle enumeration, components, tenant isolation, read-only guarantee, no leakage on build failure |
| Database | `migrations` | All migrations up, down and up again |

## Performance (measured)

Graph Engine testing in detail: [../modules/graph-engine/testing.md](../modules/graph-engine/testing.md).

Graph Engine at 1,000 nodes and 5,000 edges on the development machine, one run: build 22 ms, BFS 8 ms, DFS 134 ms, reachability under 1 ms, bounded path search 5 ms, components 6 ms, cycles 48 ms, export 10 ms; end to end `POST /graph/build` about 116 ms server-side. These are single measurements, not guarantees; assertions in the tests are generous ceilings.

## Gaps

- **No CI.** The checks run locally only. GitHub Actions should run install, lint, typecheck, tests (with a PostgreSQL service) and build on every pull request.
- No coverage reporting; no mutation testing.
- No load or soak tests; no security scanning (dependencies, secrets, SAST).
- No end-to-end browser tests (no dashboard yet).
- Foundry contract tests do not exist (no contracts).

## Planned test strategy per upcoming module

| Module | Highlights |
|---|---|
| Discovery | Adapter parsing and malformed input, normalization, entity resolution (unknown, ambiguous, cross-organization), reconciliation outcomes, retry without duplicates, source failure never deactivates |
| Blast radius | Each classification on small graphs; shared resource dependents; golden test on the demo graph |
| Containment | Known minimum cuts; infeasible cases; determinism under reordering; brute-force comparison on small random graphs; re-verification catches bad plans |
| Gateway, approval, verification | Fail closed on each outage; hash-bound approvals; verification honesty |
| Evidence | Canonicalization stability, chain verification, detection of edits, removals and reordering |
| Contracts | Foundry unit, fuzz and adversarial tests (replay, invalid signatures, expiry) |

## End-to-end scenario (target)

The PRD's 12 steps: register five agents; register permissions and resource dependencies; run normal operations; simulate compromise; open an incident; calculate blast radius; generate the plan; approve; execute; verify the compromised operation is blocked; verify a healthy agent still works; retrieve the evidence. Not runnable yet; steps 1 and 2 are covered by existing tests.

## Acceptance (from the PRD)

Core modules have automated tests (true for built modules); containment edge cases covered (not yet); contract tests pass (none); external failures handled (designed); the complete demo scenario passes (not yet); known limitations documented (yes).
