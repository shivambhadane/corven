# Graph Engine API Reference

Base path: `/api/v1/graph`. Verified against `routes/graph.routes.ts` and `schemas/graph.schema.ts`.

**Implementation status of every route below: implemented and tested** (`apps/api/test/graph-api.test.ts`). The ten routes proposed in the PRD are all implemented; `GET /traverse` and `GET /export` are additional implemented routes. Nothing in this document is only proposed. Planned API surface (snapshots, blast radius) is not part of this module.

Overview and semantics: [README.md](README.md). Shared API conventions: [../../engineering/02-api-contracts.md](../../engineering/02-api-contracts.md).

## Common behavior (applies to every endpoint)

### Authentication and authorization

Every route requires an authenticated principal with the `graph:read` permission, granted to `admin`, `operator`, `viewer` and the internal `system` role. All routes are **read-only**, including `POST /build`, which only validates and reports (it stores nothing).

Authentication is currently a **development-only** header adapter (`x-dev-actor-id`, `x-dev-org-id`, `x-dev-role`, enabled with `CORVEN_DEV_AUTH=1`). Without it every request is `401`. This is not production authentication; see [../../engineering/04-authorization-model.md](../../engineering/04-authorization-model.md).

### Tenant isolation

- The organization is taken **only** from the authenticated principal. It cannot be supplied by the client: every route rejects unknown query parameters, so `organizationId` in a query string is a `400`.
- The graph is built from that organization's registry rows only. Another organization's nodes and edges do not exist in it, so a node id from another organization returns `404 NODE_NOT_FOUND`, indistinguishable from an id that never existed.
- Responses never contain data from another organization.

### Request validation

TypeBox schemas with `additionalProperties: false`. Unknown fields: `400 VALIDATION_ERROR`. Node ids must match `^(agent|resource):<uuid>$`. Array parameters use **repeated** query parameters (`dependencyTypes=authority&dependencyTypes=resource`), not comma-separated values. Booleans are `true` / `false`.

### Common filter parameters

Accepted by `neighbours`, `traverse`, `reachability`, `paths`, `components`, `cycles` and `export`.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `dependencyTypes` | repeated `authority` \| `resource` \| `operational` | all | Keep only these dependency types |
| `includeInactive` | boolean | `false` | Also consider inactive edges. **By default only active edges are considered** |
| `minConfidence` | number 0 to 1 | 0 | Ignore edges with lower confidence |
| `entityType` | `agent` \| `resource` | all | (`components`, `export` only) restrict nodes to this type |

An edge is admissible only if it passes these and both of its endpoint nodes pass the node filters.

### Response envelope

Success: `{ "data": … }`; list endpoints add `"pagination": { "page", "limit", "total", "totalPages" }` (`page` ≥ 1; `limit` 1 to 500, default 50). Errors: `{ "error": { "code", "message", "details"? } }`.

### Shared errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Schema violation, unknown field, malformed node id |
| 400 | `MAX_DEPTH_EXCEEDED` | A depth or length above its cap |
| 400 | `MAX_PATHS_EXCEEDED` | `maxPaths` or `maxCycles` above its cap |
| 400 | `INVALID_FILTER` | Invalid filter value (for example a negative depth) |
| 401 | `UNAUTHORIZED` | Not authenticated |
| 403 | `FORBIDDEN` | Missing `graph:read` |
| 404 | `NODE_NOT_FOUND` | Unknown node in this organization's graph |
| 500 | `GRAPH_BUILD_FAILED` | Build failed or the inventory exceeds 50,000 nodes or 250,000 edges. Generic message; the cause is logged server-side only |
| 500 | `INVALID_GRAPH` | Integrity check failed after construction (indicates a bug) |

Limits: traversal depth ≤ 100; `paths` depth ≤ 25; `maxPaths` ≤ 100; `maxCycles` ≤ 500; cycle `maxLength` ≤ 50. **A search that merely finds nothing is a `200`**, never an error.

Every request rebuilds the graph from the registries inside one consistent snapshot ([architecture.md](architecture.md#graph-query-request-flow)).

---

## `POST /api/v1/graph/build`

**Purpose.** Build and validate the graph, and report what was built and any invalid records. Stores nothing.
**Parameters.** None. Any query parameter is rejected.
**Response `200`.**

```json
{ "data": {
    "organizationId": "…",
    "metadata": { "nodeCount": 1000, "edgeCount": 5000, "builtAt": "2026-11-06T09:30:00.000Z", "durationMs": 116.3 },
    "nodesByEntityType": { "agent": 800, "resource": 200 },
    "nodesByStatus": { "active": 800, "none": 200 },
    "edgesByDependencyType": { "operational": 4000, "resource": 1000 },
    "edgesByStatus": { "active": 5000 },
    "report": { "invalidNodeCount": 0, "invalidEdgeCount": 0, "issues": [], "issuesTruncated": false }
} }
```

`report.issues` is limited to 50 entries; each has `kind`, `code`, `recordId` and a fixed `message` (never record contents). Resources count under status `none`.
**Errors.** `401`, `403`, `400`, `500 GRAPH_BUILD_FAILED`.

## `GET /api/v1/graph`

**Purpose.** Overview of the current graph.
**Parameters.** None. **Response `200`.** The same overview fields as `POST /build` (`organizationId`, `metadata` without `durationMs`, the four count maps), without `report`.
**Errors.** As shared.

## `GET /api/v1/graph/nodes`

**Purpose.** List nodes, sorted by id.
**Parameters.** `entityType` (`agent` \| `resource`), `status` (string, 1 to 32 characters; matches the agent lifecycle status exactly, so resources never match), `page`, `limit`.
**Response `200`.** `data`: array of nodes; `pagination`.

```json
{ "data": [ { "id": "agent:3c1e…", "organizationId": "…", "entityType": "agent", "entityId": "3c1e…",
              "name": "Payment", "status": "active", "subtype": "llm", "externalReference": "payment-agent" } ],
  "pagination": { "page": 1, "limit": 50, "total": 7, "totalPages": 1 } }
```

**Errors.** As shared. **Tenant isolation.** Lists only this organization's entities.

## `GET /api/v1/graph/nodes/:nodeId`

**Purpose.** One node with its degree counts.
**Parameters.** Path `nodeId` (`agent:<uuid>` or `resource:<uuid>`); no query parameters.
**Response `200`.** The node fields plus `outgoing` and `incoming`, each `{ "active": n, "inactive": n }`.

```json
{ "data": { "id": "agent:3c1e…", "entityType": "agent", "name": "Payment", "status": "active",
            "outgoing": { "active": 2, "inactive": 0 }, "incoming": { "active": 2, "inactive": 0 } } }
```

**Errors.** `404 NODE_NOT_FOUND` (also for another organization's id), `400` malformed id, shared.

## `GET /api/v1/graph/edges`

**Purpose.** List edges (dependencies as directed edges), sorted by id.
**Parameters.** `dependencyType`, `status` (`active` \| `inactive`, **default `active`**), `sourceNodeId`, `targetNodeId`, `minConfidence` (0 to 1), `page`, `limit`.
**Response `200`.** `data`: array of edges; `pagination`.

```json
{ "data": [ { "id": "9a7f…", "dependencyId": "9a7f…",
              "sourceNodeId": "agent:3c1e…", "targetNodeId": "resource:55b0…",
              "dependencyType": "resource", "relationship": "accesses", "status": "active",
              "confidence": 0.9, "provenance": { "source": "manual" },
              "metadata": { "accessLevel": "write" }, "version": 1,
              "createdAt": "2026-11-06T09:00:00.000Z", "updatedAt": "2026-11-06T09:00:00.000Z" } ],
  "pagination": { "page": 1, "limit": 50, "total": 7, "totalPages": 1 } }
```

To see both statuses use two calls; there is no combined value for `status` here (the `includeInactive` flag belongs to the traversal endpoints).
**Errors.** As shared.

## `GET /api/v1/graph/nodes/:nodeId/neighbours`

**Purpose.** Nodes connected to a node, within a depth, as a breadth-first expansion.
**Parameters.** Path `nodeId`. Query: `direction` (`outgoing` = follow edges, `incoming` = follow edges backwards, `both` = ignore direction; **default `both`**), `maxDepth` (integer 1 to 100, default 1), and the common filters.
**Response `200`.**

```json
{ "data": {
    "node": { "id": "agent:3c1e…", "name": "Payment", "…": "…" },
    "direction": "outgoing", "maxDepth": 1,
    "neighbours": [ { "node": { "id": "agent:8d20…", "name": "Analytics", "…": "…" },
                      "depth": 1, "viaEdgeId": "…", "fromNodeId": "agent:3c1e…" } ],
    "edges": [ { "id": "…", "…": "…" } ],
    "truncatedByDepth": true
} }
```

`neighbours` excludes the start node; `edges` are the admissible edges examined. `truncatedByDepth` is `true` when more nodes exist beyond the depth.
**Errors.** `404 NODE_NOT_FOUND`, `400 MAX_DEPTH_EXCEEDED` / validation, shared.

## `GET /api/v1/graph/reachability`

**Purpose.** Is there a directed path from one node to another? Structural only.
**Parameters.** `sourceNodeId`, `targetNodeId` (both required), `direction` (`forward` default, `reverse`, `both`), `maxDepth` (default 10, ≤ 100), common filters.
**Response `200`.**

```json
{ "data": { "sourceNodeId": "agent:…", "targetNodeId": "agent:…", "direction": "forward", "maxDepth": 10,
            "reachable": true, "depth": 3, "truncatedByDepth": false } }
```

`reachable: false` with `truncatedByDepth: true` means "not found within the limit". `reachable: true` does not mean compromised or exploitable.
**Errors.** `404 NODE_NOT_FOUND` (source or target), `400 MAX_DEPTH_EXCEEDED`, shared.

## `GET /api/v1/graph/paths`

**Purpose.** Shortest path and bounded enumeration of simple directed paths between two nodes.
**Parameters.** `sourceNodeId`, `targetNodeId` (required), `maxPaths` (default 10, ≤ 100), `maxDepth` (default 10, ≤ 25), common filters. Direction is always forward.
**Response `200`.**

```json
{ "data": {
    "sourceNodeId": "agent:…", "targetNodeId": "agent:…",
    "found": true,
    "shortest": { "length": 3, "nodeIds": ["agent:a…", "agent:b…", "agent:c…", "agent:d…"], "edgeIds": ["…", "…", "…"] },
    "paths": [ { "length": 3, "nodeIds": ["…"], "edgeIds": ["…"] } ],
    "truncated": false, "truncationReason": null,
    "nodes": [ { "id": "agent:a…", "…": "…" } ],
    "edges": [ { "id": "…", "…": "…" } ]
} }
```

`nodes` and `edges` include every node and edge referenced by the returned paths. No path: `200` with `found: false`, `shortest: null`, `paths: []`. `truncated` is `true` with `truncationReason` `max_paths` or `search_budget` when the result is only a sample of the shortest paths.
**Errors.** `404 NODE_NOT_FOUND`, `400 MAX_PATHS_EXCEEDED` / `MAX_DEPTH_EXCEEDED`, shared.

## `GET /api/v1/graph/components`

**Purpose.** Weakly connected components: groups joined by admissible edges **ignoring direction**.
**Parameters.** `entityType` and the common filters.
**Response `200`.**

```json
{ "data": { "semantics": "weakly connected (edge direction ignored)", "count": 2,
            "components": [ { "index": 0, "nodeIds": ["agent:…", "resource:…"], "edgeCount": 7 },
                            { "index": 1, "nodeIds": ["agent:…"], "edgeCount": 0 } ] } }
```

Isolated nodes appear as single-node components. Membership says nothing about reachability.
**Errors.** As shared.

## `GET /api/v1/graph/cycles`

**Purpose.** Report directed cycles. Cycles are not errors; operational cycles can be legitimate, and authority cycles are already rejected by the registry.
**Parameters.** `maxCycles` (default 50, ≤ 500), `maxLength` (default 10, ≤ 50), common filters (except `entityType`).
**Response `200`.**

```json
{ "data": { "cycles": [ { "nodeIds": ["agent:a…", "agent:b…"], "edgeIds": ["…", "…"], "length": 2,
                          "edges": [ { "id": "…", "…": "…" } ] } ],
            "cyclicComponentCount": 1, "truncated": false, "truncationReason": null } }
```

`truncated` with `max_cycles` or `search_budget` means the report is not exhaustive. A component whose cycles are all longer than `maxLength` is counted in `cyclicComponentCount` but lists none.
**Errors.** `400 MAX_PATHS_EXCEEDED` for `maxCycles` above the cap and `400 MAX_DEPTH_EXCEEDED` for `maxLength` above the cap (naming note: the cycle bound reuses the path-limit code), shared.

## `GET /api/v1/graph/traverse` (implemented; not in the PRD list)

**Purpose.** Breadth-first or depth-first traversal from a node.
**Parameters.** `startNodeId` (required), `algorithm` (`bfs` default \| `dfs`), `direction` (`forward` default \| `reverse` \| `both`), `maxDepth` (default 10, ≤ 100), common filters.
**Response `200`.** `algorithm`, `startNodeId`, `direction`, `maxDepth`, `visited` (each: `nodeId`, `depth`, `viaEdgeId`, `fromNodeId`, and the `node`), `edges`, `truncatedByDepth`.
**Errors.** `404 NODE_NOT_FOUND`, `400 MAX_DEPTH_EXCEEDED`, shared.

## `GET /api/v1/graph/export` (implemented; not in the PRD list)

**Purpose.** A serialisable graph (nodes and edges) for visualisation or a future snapshot consumer. Format: [data-model.md](data-model.md#serialization-format).
**Parameters.** `entityType` and the common filters.
**Response `200`.** `data`: `{ organizationId, builtAt, nodes[], edges[] }`, sorted by id.
**Errors.** As shared.

---

## Not part of this API

No write operations exist: no create, update or delete of nodes, edges or graphs. There is no snapshot, blast-radius or containment endpoint; those belong to planned modules. The graph is not persisted, so there is no "get a previous graph".

Related: [architecture.md](architecture.md), [algorithms.md](algorithms.md), [testing.md](testing.md).
