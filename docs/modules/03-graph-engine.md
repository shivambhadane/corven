# Graph Engine (Module 4 in the PRD; file numbered 03 in `docs/modules/`)

Status: **implemented** (`apps/api/src/modules/graph-engine`). Read-only over the registries. Authentication is still the development-only adapter (see Module 1).

## 1. Purpose and scope

Turns the canonical registry records (agents, resources, dependencies) into an immutable, directed, typed in-memory graph and answers structural questions about it: neighbours, traversal, reachability, paths, components and cycles.

**Not implemented here (other modules):** snapshots or historical graphs, blast-radius, incident handling, containment, enforcement, approvals, ENS/chain/Arkiv integration, any write to the registries. Reachability here is *structural*: it never means "compromised" or "revocable".

## 2. Architecture

```
graph-engine/
├── types/graph.types.ts          domain types, LIMITS
├── errors.ts                     GraphError (structured codes)
├── core/                         pure TypeScript: no Fastify, no database
│   ├── graph.ts                  immutable Graph (adjacency lists)
│   ├── builder.ts                buildGraph() + checkIntegrity()
│   ├── filters.ts                one compiled filter shared by every algorithm
│   ├── traversal.ts              bfs, dfs, reachability
│   ├── paths.ts                  shortestPath, findPaths, requirePath
│   ├── components.ts             weakly connected components
│   ├── cycles.ts                 Tarjan SCC + bounded cycle enumeration
│   └── export.ts                 serialisable export
├── adapters/registry-graph-input.provider.ts   the only code that touches the database
├── services/graph-query.service.ts             stable interface for other modules
└── schemas | controllers | routes              HTTP
```

The registry stays the source of truth. The graph is **rebuilt from the registries on every request** inside one read-only `REPEATABLE READ` transaction, so agents, resources and dependencies come from the same instant. Nothing is cached or stored, so results can never be stale and nothing needs invalidation. At the measured size this costs about 100 ms (section 12). A cache can be added later if measurements justify it.

## 3. Graph model

- **Nodes:** `agent:<uuid>` and `resource:<uuid>` (the prefix keeps the two id spaces apart). Fields: `id`, `organizationId`, `entityType`, `entityId`, `name`, `status` (agent lifecycle status; **`null` for resources**, which have none), `subtype` (agent or resource type), `externalReference`.
- **Edges:** one per dependency (edge id = dependency id). Fields: `dependencyId`, `sourceNodeId`, `targetNodeId`, `dependencyType`, `relationship`, `status`, `confidence`, `provenance`, `metadata`, `version`, timestamps.
- **Values are lowercase** (`agent`, `authority`, `active`...), matching the registries, rather than the PRD's uppercase examples.
- **Direction is the registry's source → target:** authority = delegator → delegate; resource = agent → resource it accesses; operational = caller → callee. Reverse direction is never assumed. Queries choose `forward`, `reverse` or `both` explicitly.
- **Shared resources are one node.** Parallel edges (same pair, different type) are distinct edges. Agents in any status, including `compromised`, stay in the graph.
- **Immutable and deterministic.** `Graph` has no mutators, everything it returns is frozen or a copy, and adjacency is sorted by (neighbour id, edge id) so identical registry data and filters give identical results.

## 4. Construction and integrity

`buildGraph(organizationId, input, { strict? })` skips and **reports** invalid records (ids and reasons only, never record contents), or throws `INVALID_GRAPH` in strict mode. Checked: duplicate nodes/edges, records of another organization (`CROSS_TENANT_REFERENCE`, never included), dangling edges, unsupported endpoint/dependency type or status, confidence outside [0, 1]. A final `checkIntegrity` pass asserts every edge has both endpoints and every node belongs to the graph's organization. Inventories above 50,000 nodes or 250,000 edges fail with `GRAPH_BUILD_FAILED`.

The database already enforces most of this (composite foreign keys, CHECK constraints), so reported issues should be rare; the check protects against data read inconsistently or manipulated outside the application.

## 5. Filters

One filter object, compiled once and applied identically by traversal, reachability, paths, components, cycles and export: entity types, node statuses, dependency types, edge statuses, minimum confidence. **By default only active edges are considered.** An edge is admissible only if it passes the edge criteria *and* both endpoint nodes pass the node criteria. Unknown values fail with `INVALID_FILTER`.

## 6. Algorithms

| Operation | Method | Cost | Notes |
|---|---|---|---|
| BFS | queue + visited set | O(V + E) | `depth` = minimum hops |
| DFS | iterative explicit stack | O(V + E) typical | Re-expands a node when a shallower route is found, so a depth-limited DFS finds exactly what BFS finds, with the same depths (found by the performance test, covered by a randomised equivalence test). Worst case O(maxDepth·(V + E)) |
| Reachability | BFS with early exit | O(V + E) | A node reaches itself (depth 0). `truncatedByDepth` tells you when the limit may have hidden the answer |
| Shortest path | BFS with predecessors | O(V + E) | Fewest edges; unweighted |
| Path enumeration | iterative deepening over exact length, pruned by hop-distance-to-target | bounded | Simple paths only, shortest first, deterministic. Bounded by `maxPaths`, `maxDepth` and a search budget; reports `truncated` and why |
| Weak components | union-find | near-linear | Direction **ignored** (documented in the response). Not a reachability answer. Isolated nodes included |
| Cycles | iterative Tarjan SCC, then bounded enumeration of simple cycles inside cyclic components, each found once from its smallest node | bounded | Bounded by `maxCycles`, `maxLength`, search budget. A component with only very long cycles is still counted in `cyclicComponentCount` |

Limits: traversal depth ≤ 100, path depth ≤ 25, `maxPaths` ≤ 100, `maxCycles` ≤ 500, cycle length ≤ 50, search budget 200,000 expansions. Exceeding a requested limit is a structured 400 (`MAX_DEPTH_EXCEEDED`, `MAX_PATHS_EXCEEDED`); hitting a *search* bound is reported in the result, not an error.

"No path" and "not reachable" are **normal results** (HTTP 200, `found: false`), not errors. `PATH_NOT_FOUND` exists for internal callers that must have a path (`requirePath`).

Cycles are only reported. The registry already rejects authority cycles, so reports are mainly operational cycles, which can be legitimate.

## 7. API

Base path `/api/v1/graph`. All routes are read-only, require `graph:read` (viewer, operator, admin), derive the organization from the authenticated principal, reject unknown query fields (so `organizationId` in a query is a 400) and use the shared `{ data }` / `{ error }` envelopes. Array filters use repeated parameters (`dependencyTypes=authority&dependencyTypes=resource`).

| Method | Path | Purpose |
|---|---|---|
| POST | `/build` | Build, validate and report: counts, build duration, integrity report. Stores nothing |
| GET | `/` | Overview: counts by type and status |
| GET | `/nodes`, `/nodes/:nodeId` | List (entityType, status, page, limit) / one node with degree counts |
| GET | `/edges` | Filter by dependencyType, status (default active), sourceNodeId, targetNodeId, minConfidence |
| GET | `/nodes/:nodeId/neighbours` | `direction` incoming/outgoing/both, `maxDepth`, filters |
| GET | `/traverse` | BFS or DFS from a start node (addition to the PRD list) |
| GET | `/reachability` | source, target, direction, maxDepth, filters |
| GET | `/paths` | shortest path plus bounded enumeration, with the referenced nodes and edges |
| GET | `/components` | weakly connected components |
| GET | `/cycles` | bounded cycle report with edges |
| GET | `/export` | plain-JSON nodes and edges for visualisation or a future snapshot service (addition) |

Errors: `NODE_NOT_FOUND` 404, `INVALID_FILTER` 400, `MAX_DEPTH_EXCEEDED` 400, `MAX_PATHS_EXCEEDED` 400, `GRAPH_BUILD_FAILED` 500 (message is generic; the cause is logged server-side only), `INVALID_GRAPH` / `CROSS_TENANT_REFERENCE` 500, plus the shared validation/401/403 errors.

## 8. Interface for other modules

`createGraphEngine(...).graphs` (`GraphQueryService`): `build(organizationId)` returns `{ graph, report, durationMs }`, and the core functions (`bfs`, `dfs`, `reachability`, `findPaths`, `shortestPath`, `weaklyConnectedComponents`, `detectCycles`, `exportGraph`) take the immutable `Graph`. The future Snapshot Service can persist `exportGraph(graph)`; Blast-Radius can use the traversal and path functions without any HTTP layer. The graph engine never classifies a node as compromised or exposed.

## 9. Security

- Tenant isolation: the principal's organization is the only input to the registry reads; records of other organizations are rejected by the builder even if they appeared; another organization's node ids are simply unknown (404).
- Read-only: only `SELECT`s, in a read-only transaction; a test compares registry rows, versions and audit counts before and after graph calls.
- Bounded work: depth, path, cycle and search limits; no request can trigger unbounded enumeration.
- No internals out: responses contain frozen/copied data only; build failures return a generic message.
- Metadata on edges comes from the registry, which already rejects secret-looking keys.

## 10. Observability

`POST /build` logs node and edge counts, issue count and build duration (structured, no record contents) and returns `durationMs`. Truncation is reported in each result (`truncated`, `truncatedByDepth`, `truncationReason`) rather than logged.

## 11. Testing

`pnpm test` (real PostgreSQL). 102 tests were added.

| File | Covers |
|---|---|
| `graph-core.test.ts` | construction, shared resources, direction, determinism, every integrity failure, strict mode, immutability, export |
| `graph-traversal.test.ts` | BFS, DFS (including BFS/DFS equivalence on random graphs), reachability, filters, depth, cycles, errors |
| `graph-paths-structure.test.ts` | shortest path, bounded enumeration (including a dense layered graph with 4^11 paths), components, cycles, SCC |
| `graph-api.test.ts` | every endpoint, filters, pagination, tenant isolation, read-only guarantee, determinism, failure leakage |
| `graph-performance.test.ts` | timings at 1,000 nodes / 5,000 edges, in memory and end to end |

## 12. Performance (measured)

Targets from the PRD: 1,000 nodes and 5,000 edges. Measured on the development machine (Node 24, local PostgreSQL 17 in Docker), one run, a seeded random graph of 800 agents and 200 resources:

| Operation | Time |
|---|---:|
| Build from records | 22 ms |
| BFS (depth 100) | 8 ms |
| DFS (depth 100) | 134 ms |
| Reachability / shortest path | < 1 ms |
| Path enumeration (max 100 paths, depth 8) | 5 ms |
| Weak components | 6 ms |
| Cycles (max 50, length ≤ 6) | 48 ms |
| Export | 10 ms |
| **End to end** `POST /build` (registries → graph), server side | 116 ms |
| End to end request wall time | 134 ms |

These are single measurements on one machine, not capacity guarantees. The tests assert only generous ceilings. DFS is slower than BFS because of the re-expansion described in section 6.

## 13. Differences from the PRD

| PRD | Implemented |
|---|---|
| Uppercase `AGENT`, `AUTHORITY`... | Lowercase, matching the registries |
| `status: string` on nodes | `string \| null` (resources have no status) |
| `POST /build` then queries on a built graph | Graph rebuilt per request from a consistent snapshot; `/build` validates and reports |
| Paths and reachability "direction" unspecified | `forward`, `reverse`, `both`; `both` ignores edge direction and is opt-in |
| Not listed | Added `GET /traverse` and `GET /export` |
| Persistence / caching | None, by design |

## Known limitations

- The graph describes **registered** dependencies only; undiscovered or uninstrumented ones are absent, and a recorded dependency may not be in use.
- Rebuilding per request is simple and always fresh but repeats work for bursts of queries; no cache or incremental update exists.
- In-memory limits: 50,000 nodes / 250,000 edges.
- Component analysis is weak connectivity only; strongly connected components are used internally for cycles but not exposed.
- Cycle and path enumeration are bounded, so very dense graphs may report `truncated`.
- Edge confidence is returned as stored; no evidence history is attached (see `GET /dependencies/:id/evidence`).
- Authentication is still development-only.
