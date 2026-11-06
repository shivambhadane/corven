# Graph Engine Testing Strategy

Tests are in `apps/api/test/` and run with Vitest (`pnpm test` from the repository root). The general project strategy is in [../../engineering/09-testing-strategy.md](../../engineering/09-testing-strategy.md); this document covers the Graph Engine. Overview: [README.md](README.md).

**Current state:** 102 Graph Engine tests in 5 files, all passing, verified on 6 November 2026 against a real PostgreSQL 17 together with typecheck and lint. They sit inside the repository's 367 tests.

## Principles

1. **Algorithms are tested in isolation.** `core/` is pure, so graphs are built by hand from a few lines and the expected result is computed by reasoning, not by the code under test.
2. **Integration tests use real PostgreSQL**, with real migrations and the real registry modules to create data. No database mocks.
3. **Properties over examples where it matters.** Two algorithms are cross-checked against each other on randomized graphs.
4. **Security properties are asserted directly:** tenant isolation, read-only behavior, no leakage on failure.
5. **Bounds are tests too.** Every limit has a test that hits it, and truncation flags are asserted.
6. **Measure, do not claim.** Performance tests print timings; their assertions are generous ceilings.

## Suites

| File | Tests | Level | What it proves |
|---|---:|---|---|
| `graph-core.test.ts` | 25 | Unit | Construction, integrity, immutability, export |
| `graph-traversal.test.ts` | 20 | Unit | BFS, DFS, reachability, filters, depth limits |
| `graph-paths-structure.test.ts` | 30 | Unit | Shortest path, bounded path enumeration, weak components, cycles, SCC |
| `graph-api.test.ts` | 23 | Integration | Every endpoint over HTTP against PostgreSQL, tenant isolation, read-only guarantee |
| `graph-performance.test.ts` | 4 | Performance | 1,000 nodes / 5,000 edges, in memory and end to end |

### Unit: construction and integrity (`graph-core`)

- Agents and resources become nodes, dependencies directed edges; direction is not symmetric.
- Lookup by id and by entity identity; an agent and a resource with the same raw id are different nodes.
- A shared resource is one node with several incoming edges.
- Empty graph and isolated nodes; parallel edges of different types stay distinct.
- Determinism: input order does not change the export.
- **Integrity tests:** duplicate nodes, duplicate edges, missing source or target, records from another organization (never included), an edge pointing at another organization's node (dangling), invalid dependency type, status, endpoint type and confidence (including `NaN`), strict mode throws `INVALID_GRAPH`, oversized inventory fails with `GRAPH_BUILD_FAILED`, `checkIntegrity` detects a hand-built broken graph, reports never contain record contents.
- **Immutability:** frozen nodes, edges, provenance, metadata, arrays and metadata; mutation attempts throw; mutating the input after the build does not change the graph.
- Export is plain JSON, ISO dates, honors filters.

### Unit: traversal (`graph-traversal`)

BFS depths and discovered edges; `maxDepth` and `truncatedByDepth`; forward, reverse and both; filters by dependency type, edge status, minimum confidence, entity type and node status; cycles; unknown node and bad depths; isolated start. DFS pre-order, equivalence with BFS, depth limits, filters. **Randomized equivalence:** 25 random graphs × 6 depth limits × 3 directions assert that depth-limited DFS produces exactly BFS's nodes, depths and truncation flag (this caught a real bug, see [decisions.md](decisions.md) ADR-005). Reachability: directed, itself, filters, depth, `both`, unknown nodes. A 40,000-node chain stops at the depth cap.

### Unit: paths and structure (`graph-paths-structure`)

Shortest path (fewest edges, none, itself, filters and depth, `requirePath` raising `PATH_NOT_FOUND`). Path enumeration: all simple paths shortest first, deterministic; every path is simple, directed and uses real edges; `maxPaths`, `maxDepth`, no path, cycles, parallel edges, filters, over-limit requests; a dense layered graph with 4^11 paths stays bounded. Weak components: grouping, isolated nodes, no duplicated nodes, filters, empty graph, and that membership is not reachability. Cycles: simple, none in a DAG, overlapping cycles once each, undirected loop is not a directed cycle, type filters, inactive edges, parallel edges, `maxCycles` and `maxLength`, a 20,000-node ring (iterative Tarjan), SCC partition.

### Integration (`graph-api`)

Builds a real organization through the registry APIs, then exercises every endpoint:

- **Build and overview:** counts, shared resource once, inactive edges counted separately, empty organization.
- **Read-only:** registry rows, versions and audit counts are identical before and after `build`, `export` and `cycles`.
- **Determinism:** two builds export identical nodes and edges.
- **Nodes and edges:** filters, pagination, degree counts, `404` and `400` for bad ids, default-active edge filtering.
- **Neighbours, traverse, reachability, paths:** directions, depth, dependency-type filters, `includeInactive`, structured limit errors, a clean not-found result.
- **Components, cycles, export.**
- **Security:** a second organization sees none of it and gets `404` for the first organization's node ids; `organizationId` in any query is rejected; unauthenticated is `401` on every route; viewers may read; unknown query fields are `400`; no write routes exist; a failing build returns a generic body without internal detail (fault injected through a stub input provider).

### Performance (`graph-performance`)

A seeded random graph of 800 agents and 200 resources with 5,000 edges, in memory, plus an end-to-end run that seeds 1,000 agents and 5,000 dependencies directly into PostgreSQL and calls the API. Targets come from the PRD (1,000 nodes, 5,000 edges); they are engineering targets, not capacity guarantees.

## Test fixtures

| Fixture | Purpose |
|---|---|
| `graph-fixtures.ts` (`spec`, `build`, `a`, `r`, `ORG`) | Build a `Graph` from a few lines: agents are plain names, resources are written `"R:name"`, dependencies are `[source, target, type?, overrides?]`. Ids are readable (`agent:support`) |
| `helpers.ts` (`createCtx`, `client`, `who`) | Start the real Fastify app against the throwaway database; call it with development-auth headers; create fresh random organizations per test |
| `dep-helpers.ts` (`mkAgent`, `mkResource`, `authority`, `operational`, `resourceDep`, `createDep`) | Create registry data through the real APIs |
| `global-setup.ts` | Creates a throwaway database, runs all migrations, drops it afterwards. **Fails** if PostgreSQL is unreachable; it never skips |
| Fault injection | `createCtx` accepts an override of the graph engine, used to simulate a failing build |

Each integration test uses fresh random organization ids, so tests do not interfere and need no cleanup.

## Measured performance

Same code, same machine, two runs on 6 November 2026 (milliseconds; 1,000 nodes, 5,000 edges):

| Operation | Run 1 | Run 2 |
|---|---:|---:|
| Build from records | 22 | 19 |
| BFS (depth 100) | 8 | 16 |
| DFS (depth 100) | 134 | 243 |
| Reachability | < 1 | 1.4 |
| Shortest path | < 1 | 1.4 |
| Path enumeration (max 100 paths, depth 8) | 5 | 9 |
| Weak components | 6 | 11 |
| Cycles (max 50, length ≤ 6) | 48 | 62 |
| Export | 10 | 16 |
| `POST /build` server-side (registries → graph) | 116 | 205 |
| `POST /build` request wall time | 134 | 229 |

Timings vary run to run with machine load, so read them as an order of magnitude: tens of milliseconds for the algorithms and a few hundred milliseconds end to end at this size. Environment: local development machine, Node 24, PostgreSQL 17 in Docker. This shows the PRD target of 1,000 nodes and 5,000 edges is comfortably handled by an on-demand rebuild; it says nothing about larger graphs or production hardware. Assertions are ceilings (build under 2 s, traversals under 1 s, structural analyses under 5 s, end to end under 10 s).

## Edge cases covered

Empty graph; isolated nodes; self-reach; cycles in every traversal; parallel edges; shared resources; inactive edges; compromised or suspended agent nodes (node-status filters); resources with `null` status; unknown and cross-organization node ids; maximum and over-maximum limits; truncation flags; a 20,000-node ring; a 40,000-node chain; dense graphs; filters that remove every node.

## Not covered yet

- No CI: the suites run locally only.
- No property tests for paths and cycles against a brute-force oracle (only BFS/DFS equivalence is randomized).
- No test with the future real authenticator.
- No load or concurrency test of many simultaneous builds, and none for very large organizations beyond the size-limit check.
- No test on production-like hardware.

## Acceptance criteria and evidence

| ID | Criterion (PRD section 16) | Evidence |
|---|---|---|
| AC-01 | Graph construction uses canonical registry data | `graph-api` builds from data created through the registry APIs; the adapter reads the registry repositories |
| AC-02 | Agents and resources are nodes | `graph-core` |
| AC-03 | Dependencies are directed edges | `graph-core`, `graph-api` |
| AC-04 | Shared resources represented once | `graph-core`, `graph-api` |
| AC-05 | Incoming and outgoing queries correct | `graph-core`, `graph-api` (neighbours, node degree) |
| AC-06 | BFS and DFS correct | `graph-traversal` incl. randomized equivalence |
| AC-07 | Reachability correct | `graph-traversal`, `graph-api` |
| AC-08 | Shortest path correct | `graph-paths-structure`, `graph-api` |
| AC-09 | Path enumeration bounded | `graph-paths-structure` (dense layered graph), `graph-api` (limits) |
| AC-10 | Weak components correct | `graph-paths-structure`, `graph-api` |
| AC-11 | Directed cycles detected and reported | `graph-paths-structure`, `graph-api` |
| AC-12 | Type and status filters work | `graph-traversal`, `graph-api` |
| AC-13 | Cross-tenant access prevented | `graph-core` (builder), `graph-api` (HTTP) |
| AC-14 | Registry records not modified | `graph-api` read-only assertion |
| AC-15 | Unit and integration tests pass | 102/102 passing; repository total 367/367 |
| AC-16 | APIs follow API conventions | `graph-api`; [api.md](api.md) |
| AC-17 | Documentation and limitations complete | This folder; [../../project/06-known-limitations.md](../../project/06-known-limitations.md) |

Related: [architecture.md](architecture.md), [algorithms.md](algorithms.md), [decisions.md](decisions.md).
