# Module 2 — Dependency Registry

Status: **implemented** (`apps/api/src/modules/dependency-registry`). Authentication is still the development-only adapter from Module 1; see [Known limitations](#known-limitations).

## 1. Purpose and scope

The Dependency Registry stores validated, versioned relationships between agents and resources. It is a data source for later modules; it does **not** traverse, analyse or act on the graph.

**Implemented here:** dependency CRUD (soft removal), three typed relationship kinds, relationship validation, authority-cycle prevention, provenance/confidence/freshness, per-change version history, append-only audit, and a *minimum* resource model.

**Not implemented here (other modules):** Dependency Discovery ([dependency-discovery.md](dependency-discovery.md); its registry prerequisites are in section 16), graph snapshots ([graph-snapshot.md](graph-snapshot.md)), blast-radius analysis and containment (modules 05 and 06), and resource management beyond create and read. The Graph Engine is a separate, implemented module that **reads** this registry; see [graph-engine/](graph-engine/README.md).

## 2. Responsibilities

- Register relationships between registered agents and resources, in the caller's organization only.
- Keep authority, resource and operational relationships distinct.
- Validate every relationship against explicit rules before it is stored.
- Preserve every historical state of a relationship; never silently overwrite.
- Record every change in an audit log in the same transaction.

## 3. Dependency types

| Type | Meaning | Direction | Allowed endpoints |
|---|---|---|---|
| `authority` | Source **delegates** authority to target | grantor → delegate | agent → agent |
| `resource` | Source **accesses/relies on** target | agent → resource | agent → resource |
| `operational` | Source **needs or triggers** target to do its work | caller → callee | agent → agent, agent → resource, resource → agent |

An operational dependency **never implies authority**: the types are separate values in the domain, in the database (`dependency_type` + CHECK), and in every query. Authority-cycle checks look at `authority` edges only.

`resource → resource` is not supported. Workflows are modelled as resources of type `workflow`.

## 4. Relationship semantics

- One relationship per **ordered pair and type** (`a→b authority`, `b→a authority` and `a→b operational` are all different). `relationship` is a free-text label (`^[a-z][a-z0-9_.:-]*$`, max 100) that describes it; it is not part of uniqueness.
- **Self-reference is rejected for every type** (422 `SELF_REFERENCE`, also a DB CHECK).
- Per-type required metadata (MVP rules):
  - `authority`: `metadata.scope`, a dotted lowercase string such as `payment.execute`.
  - `resource`: `metadata.accessLevel` ∈ `read | write | admin | unknown` (`unknown` is for discovered access whose level the source does not state).
  - `operational`: none.
- Agent status is not a precondition: a `compromised` or `suspended` agent can still be mapped, because that is exactly when dependencies matter.

## 5. Domain model

`Dependency` (`types/dependency.types.ts`): `id`, `organizationId`, `sourceType`/`sourceId`, `targetType`/`targetId` (`agent | resource`), `dependencyType`, `relationship`, `metadata` (JSON object), `provenance`, `confidence`, `observedAt?`, `lastVerifiedAt?`, `status` (`active | inactive`), `version`, `createdAt`, `updatedAt`.

- **provenance**: `{ source: manual | imported | discovered | inferred, reference?, note? }`. Do not put secrets in `reference` or `note`.
- **confidence**: number in **[0, 1]** inclusive (DB CHECK). Defaults to `1` only when `provenance.source` is `manual`; every other source must state it (422 `CONFIDENCE_REQUIRED`).
- **freshness**: `observedAt` and `lastVerifiedAt` must not be in the future (5 minute clock-skew allowance), and `lastVerifiedAt` must not precede `observedAt`.
- **Immutable after creation:** `sourceType`, `sourceId`, `targetType`, `targetId`, `dependencyType`, `organizationId`. To change them, remove the relationship and create a new one.
- **metadata** reuses the Agent Registry guard: JSON object, ≤ 8 KB, depth ≤ 5, secret-looking key names rejected (best effort, key names only).

`Resource` (minimum model): `id`, `organizationId`, `name` (unique per org, case-insensitive), `resourceType` (`api | database | wallet | credential | storage | service | workflow | mcp_server | queue | other`), `description`, `externalReference` (optional, unique per org, case-insensitive), `metadata`, timestamps. A `credential` resource is a *reference* to something that exists elsewhere; never store the secret.

## 6. Database schema

Migrations `0002_dependency_registry` and `0003_dependency_append_only` (hand-written reverses in `apps/api/drizzle/down/`).

| Table | Purpose |
|---|---|
| `resources` | minimum resource entities; unique `(organization_id, lower(name))` |
| `dependencies` | current state; see integrity strategy below |
| `dependency_versions` | one immutable row per version: `(dependency_id, version)` unique, `change_type`, `changed_by`, full `state` JSON |
| `dependency_audit_logs` | one immutable row per event with `before_state` / `after_state` |

`agents` gained a `UNIQUE (id, organization_id)` constraint so other tables can reference it. Later amendments to Module 1's schema are listed in section 16.

Indexes on `dependencies`: `(org, source_type, source_agent_id, source_resource_id)`, `(org, target_type, target_agent_id, target_resource_id)`, `(org, dependency_type, status)`, `(org, created_at, id)`, plus the unique pair index.

`dependency_versions` and `dependency_audit_logs` reject `UPDATE`, `DELETE` and `TRUNCATE` through triggers (same function as Module 1). Dependencies, agents and resources are never hard-deleted (FKs are `ON DELETE RESTRICT`).

## 7. Entity integrity strategy

Polymorphic references are the classic place where integrity is only claimed. Here it is actually enforced:

- Separate columns per target table: `source_agent_id`, `source_resource_id`, `target_agent_id`, `target_resource_id`.
- **Real composite foreign keys** on `(<column>, organization_id)` → `agents(id, organization_id)` or `resources(id, organization_id)`. A reference to a nonexistent entity **or to an entity in another organization** is rejected by PostgreSQL itself (SQLSTATE 23503). Where the column is NULL (the unused side), the composite FK is not evaluated.
- CHECK constraints force exactly the column matching `source_type`/`target_type` to be set.
- Generated stored columns `source_id` and `target_id` (`coalesce(...)`) give a single id to filter and index.
- CHECK constraints repeat the type matrix, the no-self-reference rule, confidence range and status/type values (defence in depth; the application validates first and returns friendlier errors).

What the database does **not** enforce: authority cycles (checked in the application under a lock) and per-type required metadata.

## 8. API contracts

Envelope: `{ "data": ... }`; lists add `"pagination": { page, limit, total, totalPages }`. Errors: `{ "error": { code, message, details? } }`. Dependency endpoints paginate with `page` (≥1) and `limit` (1–100, default 20), unlike Module 1's `limit`/`offset`, as specified for this module. Ordering is `created_at DESC, id DESC`.

| Method | Path | Permission | Result |
|---|---|---|---|
| POST | `/api/v1/dependencies` | `dependency:write` | 201 |
| GET | `/api/v1/dependencies` | `dependency:read` | 200; filters `dependencyType`, `status`, `sourceType`, `sourceId`, `targetType`, `targetId` |
| GET | `/api/v1/dependencies/:dependencyId` | `dependency:read` | 200 |
| PATCH | `/api/v1/dependencies/:dependencyId` | `dependency:write` | 200; fields `relationship`, `metadata`, `provenance`, `confidence`, `observedAt`, `lastVerifiedAt`, `status`, optional `expectedVersion` |
| DELETE | `/api/v1/dependencies/:dependencyId` | `dependency:write` | **200 with the inactive record** (soft removal); optional `?expectedVersion=` |
| GET | `/api/v1/dependencies/:dependencyId/versions` | `dependency:read` | 200, newest first (read-only addition) |
| GET | `/api/v1/agents/:agentId/dependencies` | `dependency:read` | 200; `direction` = `incoming \| outgoing \| both` (default `both`), `dependencyType`, `status`, `page`, `limit`; 404 if the agent is not in your organization |
| POST / GET | `/api/v1/resources`, `/api/v1/resources/:resourceId` | `resource:write` / `resource:read` | minimum resource model; no update or delete |

Roles: `viewer` reads; `operator` and `admin` write.

**DELETE semantics.** It is a soft removal: the row stays, `status` becomes `inactive`, a version row is appended and the event is audited as `removed`. Deleting an already inactive dependency returns 409 `ALREADY_INACTIVE`. A removed dependency can be restored with `PATCH {status: "active"}` (recorded as `activated`, and cycle-checked again for authority edges). Creating the same pair again returns 409 `DEPENDENCY_EXISTS` (the message says when the existing one is inactive).

Error codes: 400 `VALIDATION_ERROR` (schema/shape, unknown fields, secrets in metadata); 422 `ENDPOINT_NOT_FOUND`, `RELATIONSHIP_TYPE_MISMATCH`, `SELF_REFERENCE`, `MISSING_REQUIRED_METADATA`, `CONFIDENCE_REQUIRED`, `INVALID_FRESHNESS`, `AUTHORITY_CYCLE`; 409 `DEPENDENCY_EXISTS`, `VERSION_CONFLICT`, `ALREADY_INACTIVE`, `RESOURCE_NAME_CONFLICT`; 401/403/404 as in Module 1.

## 9. Validation rules (in order)

1. Request schema: types, formats, `additionalProperties: false` (unknown fields such as `organizationId`, `status`, `version`, `id` are a 400).
2. Not a self-reference; source/target types allowed for the dependency type (section 3).
3. Metadata safe (size, depth, secret-looking keys) and per-type required metadata present.
4. Provenance normalised; confidence resolved and within [0, 1]; freshness valid.
5. Database-backed, inside the transaction: both endpoints exist **in the caller's organization**. A missing entity and an entity in another organization return the identical 422, so existence is not leaked.
6. Duplicate pair check (409), backed by the unique index.
7. Authority only: cycle check (section 10).

## 10. Cycle handling

| Type | Cycles |
|---|---|
| `operational` | **Allowed.** Mutual and circular workflows are legitimate. |
| `resource` | Cannot form cycles (agent → resource only). |
| `authority` | **Prohibited.** Adding `S → T` is rejected (422 `AUTHORITY_CYCLE`, with `details.cycle`) if `T` already reaches `S` through **active** authority edges in the same organization. |

Details: the check is a bounded recursive query over authority edges only, inside the registry (not a Graph Engine). Inactive edges are ignored, so removing a delegation unblocks the reverse one. Reactivating an authority edge re-runs the check. Authority-edge creation and reactivation take a per-organization advisory lock (`pg_advisory_xact_lock`) so two concurrent requests cannot jointly create a cycle; this is covered by a concurrency test. A diamond (`A→B, A→C, B→D, C→D`) is not a cycle and is allowed.

## 11. Versioning and audit

- `dependencies.version` starts at 1 and increases by exactly 1 per recorded change.
- Each change appends a `dependency_versions` row (full state, `change_type`: `created | updated | activated | deactivated | removed`, actor) and a `dependency_audit_logs` row (`dependency.created | updated | activated | deactivated | removed`, before/after).
- The change, version row and audit row commit **in one transaction**, with the dependency row locked (`SELECT … FOR UPDATE`). Concurrent updates serialise and versions stay contiguous. If a version or audit write fails, the whole change rolls back (tested).
- A PATCH that changes nothing returns the current record and creates **no** version or audit row.
- `expectedVersion` gives optimistic concurrency (409 `VERSION_CONFLICT`).
- History is append-only in the database and no HTTP route can modify it.

## 12. Security boundaries

| Control | Where |
|---|---|
| `organizationId` only from the authenticated principal; all queries scoped to it | auth hook, repositories |
| Cross-tenant read, update, delete and version access return 404 | service layer |
| Cross-organization references blocked in the application **and** by composite FKs | validator, schema |
| RBAC on every operation (`dependency:*`, `resource:*`) | `auth/permissions.ts` |
| Mass-assignment protection; response allow-lists | schemas |
| Immutable endpoints and type after creation | PATCH schema + service |
| No internal errors (SQL, constraint names, stacks) to clients | error handler, mapped conflicts |
| Append-only history/audit via triggers | migration 0003 |
| Secrets rejected in metadata (name-based, best effort) | shared metadata guard |

## 13. Error handling

Same envelope and safe-error rules as Module 1: `AppError` subclasses carry client-safe messages; anything unexpected is logged server-side and returned as `500 INTERNAL_ERROR`. Domain violations use 422 with stable codes. A unique violation on the pair index is mapped to `DEPENDENCY_EXISTS`.

## 14. Testing

`pnpm test` runs against a real PostgreSQL (see Module 1, section 11). 107 tests were added.

| File | Covers |
|---|---|
| `dependency-registration.test.ts` | the three types, duplicates, invalid input, per-type metadata, provenance/confidence/freshness |
| `dependency-validation.test.ts` | missing/wrong/cross-org endpoints, self-reference, and database-level FK/CHECK integrity via raw SQL |
| `dependency-shared-resources.test.ts` | many agents → one resource, no duplicates, removal leaves resource and siblings intact |
| `dependency-cycles.test.ts` | operational cycles, authority cycles (direct/indirect), inactive edges, reactivation, tenant scope, concurrency |
| `dependency-versioning.test.ts` | version increments, immutable history, audit, no-op updates, optimistic concurrency, DB triggers, rollback on failure |
| `dependency-security.test.ts` | cross-tenant read/update/delete, viewers, 401s, no error leakage |
| `dependency-api.test.ts` | envelopes, filters, pagination, agent dependencies by direction, resources |
| `relationship-policy.test.ts` | exhaustive 3×2×2 endpoint matrix and policy units |
| `migrations.test.ts` (extended) | all four migrations up, down in reverse, up again |

## 15. Future integration

- **Dependency Discovery** will create `discovered`/`inferred` dependencies through `DependencyService.create` with `provenance` and `confidence`; nothing here performs discovery.
- **Graph Engine** (implemented, [graph-engine/](graph-engine/README.md)) reads `dependencies` (all statuses, with type, confidence and provenance) and builds the structural graph; traversal, reachability, paths, components and cycles live there, and the authority cycle check in this module is not a substitute for them. **Graph snapshots** (implemented) persist immutable graphs from the Graph Engine's export and do not read this registry directly.
- **Blast-radius and containment** will rely on the distinction between `authority`, `resource` and `operational` edges and on `metadata.scope` / `metadata.accessLevel`.
- **Evidence Service** will hash `dependency_versions` / `dependency_audit_logs`.

## Known limitations

- **Authentication is still development-only** (see Module 1). There are no users or organizations tables, so `organization_id` has no FK.
- **Resource creation is not audited** and resources cannot be updated or removed; that belongs to a future Resource Registry.
- `resource → resource` and workflow-as-first-class-entity relationships are not supported.
- Per-type required metadata (`scope`, `accessLevel`) is an MVP convention, not a settled schema.
- Metadata secret detection is name-based only; `provenance.reference`/`note` are not scanned.
- Soft removal only: there is no hard delete and no purge.
- `incidentId`-style links to incidents do not exist yet.
- Down migrations are manual scripts.
- No rate limiting.

## 16. Amendments for Dependency Discovery (Stage A)

These changes make the registry safe for an automated writer. Discovery itself (sources, adapters, runs, observations, reconciliation) is **not** implemented.

### Evidence is separate from the dependency row

`dependency_evidence` is an append-only table (migration 0004/0005) holding every observation that supports a dependency: `sourceType` (`manual | agent_configuration | workflow_definition | permission_configuration | runtime_event | external_integration`), `sourceReference`, `discoveryRunId`, `evidenceKind` (`declared | configured | observed`), `evidenceReference`, `sourceVersion`, `confidence`, `observedAt`. Composite FK to `(dependency_id, organization_id)`; triggers reject UPDATE/DELETE/TRUNCATE; a partial unique index on `(dependency_id, discovery_run_id, source_type, source_reference)` makes a retried run unable to duplicate evidence. `discovery_run_id` has no FK until the discovery tables exist. `GET /api/v1/dependencies/:id/evidence` lists it (read-only).

The `dependencies.provenance` column keeps a single summary of the first accepted source. The full evidence history is the evidence table. This is a deliberate divergence from "provenance as an array on the row": a fresh observation of an unchanged relationship must not create a version.

### Internal writer: `DependencyRegistryWriter`

Not exposed over HTTP. Acts as the internal discovery principal (`role: "system"`, fixed actor id `00000000-0000-4000-8000-00000000d15c`). The `system` role can read the inventory and write dependencies only; it cannot write agents or resources, and `x-dev-role: system` is rejected by the HTTP authenticator.

- `createOrUpdate(input)` returns `{ outcome: created | updated | unchanged | rejected, dependencyId?, version?, reasonCode?, reason?, evidenceAdded }`. Domain-rule violations are returned as `rejected` with a stable code (`ENDPOINT_NOT_FOUND`, `RELATIONSHIP_TYPE_MISMATCH`, `SELF_REFERENCE`, `AUTHORITY_CYCLE`, `MISSING_REQUIRED_METADATA`, `EVIDENCE_REQUIRED`, `INVALID_CONFIDENCE`, `INVALID_FRESHNESS`, ...); unexpected failures throw.
- **Matching key:** organization + source + target + `dependencyType`. `relationship` is an attribute: a different label is an update, not a new row.
- **Idempotent:** repeating a call, including concurrently, yields one dependency; the first writer gets `created`, the rest `unchanged`; evidence is never duplicated for the same run/source.
- **`unchanged`** means the stored relationship did not change. New evidence is still appended, and `last_verified_at` moves forward (never backward) **without a version**; the observation itself is preserved in the evidence table.
- **`updated`** (versioned, audited) happens when the relationship label differs, supplied `metadata` differs, or the strongest evidence confidence rises. Dependency `confidence` is the **highest** confidence among its evidence; weaker later evidence never lowers it.
- **Inactive dependencies are not resurrected.** A new observation of an inactive dependency is stored as evidence and returned as `rejected` with `INACTIVE_REQUIRES_REVIEW`.
- **Authority edges** may be created by the writer only when at least one evidence item is `manual` or `permission_configuration`, or `approvedByReview` is true. Configuration, workflow, runtime and integration evidence alone are rejected with `AUTHORITY_REQUIRES_EXPLICIT_SOURCE`: sequence or tool use does not prove delegation. They can still create `operational` and `resource` edges.
- **Resource access** without a stated level is stored as `accessLevel: "unknown"`.
- `deactivate(org, id, reason)` is a soft removal (`removed` event) with the reason stored in the audit row; a reason is required.
- `findMatching(org, key)` returns the matching dependency (any status) or null.
- Everything runs in one transaction; a failed evidence write rolls back the creation (tested).

### Read interface for graph consumers: `DependencyGraphDataProvider`

`listActiveDependencies(org, { observedAfter?, dependencyTypes? })` and `getDependency(org, id)`. Active dependencies only, organization-explicit, read-only. `observedAfter` filters on freshness, the later of `observed_at` and `last_verified_at`; edges with neither are excluded when the filter is used. Evidence is read separately. No graph traversal exists here.

**Relationship to the Graph Engine.** The implemented [Graph Engine](graph-engine/README.md) does **not** use this provider. To build a consistent graph it reads agents, resources and dependencies (all statuses) directly from the registry repositories inside one read-only `REPEATABLE READ` transaction (`RegistryGraphInputProvider`). `DependencyGraphDataProvider` remains available for other read-only consumers that only need active dependencies; today nothing consumes it.

### Changes to Module 1 and resources

- Agents gained optional `externalReference` (unique per org, case-insensitive; the key discovery resolves names against), `ownerReference` and `runtimeType`. `AgentRegistryReader` (internal, organization-explicit) provides `getAgent`, `listAgents`, `findAgentByExternalReference`, `getCapabilities` (declared names only) and `validateAgentReference`.
- Resources gained optional `externalReference` (unique per org) and `metadata`, and the types `mcp_server` and `queue`.

### Where this differs from the architecture document

| Architecture doc | Implemented |
|---|---|
| `provenance: DependencyProvenance[]` on the dependency | Single summary on the row plus the append-only evidence table |
| Writer takes one top-level `confidence` | Each evidence item has its own confidence; the dependency keeps the highest |
| `findMatching` key includes `relationship` | Key is source + target + type; relationship is an attribute |
| Agent identity types `wallet`, `service_account`, `external_id`; statuses `mismatch`, `unavailable` | Module 1's `evm_address`, `did`, `api_client`, `other`; `pending`, `failed` kept |
| Capability rows with `source` and `verified` | Plain declared capability names |
| `getCapabilities` returns capability objects | Returns names |

### Additional limitations

- Observed-again inactive dependencies can only be reactivated by a human (PATCH `status: active`).
- `last_verified_at` can run ahead of the latest version snapshot's value, because freshness updates are deliberately not versioned.
- `listAgents` in the reader pages internally but is unbounded; it is meant for resolution caches in background jobs.
