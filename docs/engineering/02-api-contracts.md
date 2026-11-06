# API Contracts

All endpoints below exist today. Base: `/api/v1`. Request and response schemas are TypeBox, defined next to each route in `apps/api/src/modules/*/schemas/`; they are the authoritative reference. Per-module docs explain behavior in depth.

## Conventions

- **Envelope:** success `{ "data": … }`; lists add `"pagination"`; errors `{ "error": { "code", "message", "details"? } }`.
- **Unknown fields are rejected** with 400 `VALIDATION_ERROR` (this also means `organizationId` can never be sent).
- **Pagination differs by module:** agents use `limit` (1–100, default 20) and `offset`; dependencies, resources and graph lists use `page` and `limit` and return `{ page, limit, total, totalPages }`.
- **Ordering:** newest first with `id` as tie-breaker; graph collections are sorted by id.
- **Organization:** always derived from the authenticated principal. Another organization's resources return 404.
- **Authentication (development only):** headers `x-dev-actor-id` (uuid), `x-dev-org-id` (uuid), `x-dev-role` (`admin | operator | viewer`), and the server started with `CORVEN_DEV_AUTH=1`. Without that setting every request is 401. This adapter is not production authentication.
- **Health:** `GET /health` is public.

## Roles

| Role | Can |
|---|---|
| viewer | all reads |
| operator | reads, create and update agents, resources and dependencies, change agent status except recovery |
| admin | everything an operator can, plus recovery from `compromised` and identity verification |

Details: [04-authorization-model.md](04-authorization-model.md).

## Agents (`/agents`)

| Method | Path | Notes |
|---|---|---|
| POST | `/` | 201. Status is always `active`; `externalReference`, `ownerReference`, `runtimeType`, capabilities and identities optional |
| GET | `/` | Filters `status`, `agentType`, `search`; `limit`, `offset` |
| GET | `/:agentId` | Includes capabilities and identities |
| PATCH | `/:agentId` | `name`, `description`, `agentType`, `runtimeType`, `ownerReference`, `externalReference`, `metadata`. Not status |
| POST | `/:agentId/status` | `{ status, reason, incidentId? }`. Recovery from `compromised` is admin-only and needs a reason of at least 10 characters |
| GET | `/:agentId/history` | Status history |
| PUT | `/:agentId/capabilities` | Replaces the set |
| PUT | `/:agentId/identities` | Replaces the set; callers cannot set verification |
| GET | `/:agentId/dependencies` | `direction` incoming/outgoing/both, `dependencyType`, `status`, `page`, `limit` |

## Resources (`/resources`)

| Method | Path | Notes |
|---|---|---|
| POST | `/` | `name`, `resourceType`, optional `description`, `externalReference`, `metadata` |
| GET | `/`, `/:resourceId` | No update or delete exists |

## Dependencies (`/dependencies`)

| Method | Path | Notes |
|---|---|---|
| POST | `/` | 201. `sourceType`, `sourceId`, `targetType`, `targetId`, `dependencyType`, `relationship`, `metadata?`, `provenance`, `confidence?`, `observedAt?`, `lastVerifiedAt?` |
| GET | `/` | Filters `dependencyType`, `status`, `sourceType`, `sourceId`, `targetType`, `targetId` |
| GET | `/:dependencyId` | |
| PATCH | `/:dependencyId` | `relationship`, `metadata`, `provenance`, `confidence`, `observedAt`, `lastVerifiedAt`, `status`, optional `expectedVersion`. Source, target and type are immutable. A no-op creates no version |
| DELETE | `/:dependencyId` | Soft removal: 200 with the inactive record, event recorded as `removed`. Optional `?expectedVersion=` |
| GET | `/:dependencyId/versions` | Read-only history |
| GET | `/:dependencyId/evidence` | Read-only evidence |

Authority edges require `metadata.scope`; resource edges require `metadata.accessLevel` (`read`, `write`, `admin`, `unknown`).

## Graph (`/graph`)

Full reference with parameters, responses and errors: [../modules/graph-engine/api.md](../modules/graph-engine/api.md). All read-only, require `graph:read`, rebuild the graph from the registries per request. Array filters use repeated parameters.

| Method | Path | Purpose |
|---|---|---|
| POST | `/build` | Validate and report: counts, build duration, integrity issues. Stores nothing |
| GET | `/` | Overview counts |
| GET | `/nodes`, `/nodes/:nodeId` | Nodes are `agent:<uuid>` or `resource:<uuid>` |
| GET | `/edges` | Filters by type, status (default active), endpoints, `minConfidence` |
| GET | `/nodes/:nodeId/neighbours` | `direction` incoming/outgoing/both, `maxDepth`, filters |
| GET | `/traverse` | `algorithm` bfs/dfs, `direction`, `maxDepth` |
| GET | `/reachability` | `sourceNodeId`, `targetNodeId`, `direction`, `maxDepth` |
| GET | `/paths` | Shortest path plus bounded enumeration (`maxPaths` ≤ 100, `maxDepth` ≤ 25) |
| GET | `/components` | Weakly connected components |
| GET | `/cycles` | Bounded cycle report |
| GET | `/export` | Plain JSON nodes and edges |

Limits: traversal depth ≤ 100, `maxCycles` ≤ 500, cycle length ≤ 50.

## Status codes

200, 201 as above; 400 validation and over-limit requests; 401 unauthenticated; 403 forbidden; 404 not found or in another organization; 409 conflicts and invalid transitions; 422 relationship rule violations; 500 generic. The full code catalog is in [08-error-handling.md](08-error-handling.md).

## Not exposed on purpose

No audit-log read endpoint, no hard delete, no identity-verification endpoint (it is an internal operation for a future ENS verifier), no resource update, no way to edit history.

## Planned APIs

Discovery (`/discovery/*`), incidents, approvals, verification and evidence are described in their module documents and are not implemented.
