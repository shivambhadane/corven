# Module 1 — Agent Registry

Status: **implemented** (`apps/api/src/modules/agent-registry`). Authentication is a development-only adapter; see [Known limitations](#known-limitations).

## 1. Purpose

The Agent Registry holds CORVEN's authoritative application records about registered autonomous agents: who they are, what they declare they can do, their lifecycle status, and an append-only history of every change. Later modules (Dependency Registry, Graph Engine, Incident Management, Authorization Gateway) will read these records.

Registration does **not** prove an agent is trustworthy or uncompromised. A registered `active` agent means only "CORVEN knows about it and nobody has flagged it".

## 2. Responsibilities

| In scope | Out of scope (future modules) |
|---|---|
| Register, list, retrieve, update agents | Dependencies, permissions, resources (Dependency Registry) |
| Lifecycle status with validated transitions | Incident creation and detection (Incident Management) |
| Declared capabilities (descriptive) | Enforcing or evaluating capabilities (Authorization Gateway) |
| Identity **metadata** (unverified by default) | Live ENS resolution/verification (ENS integration) |
| Append-only status history and audit log | Blockchain transactions, Arkiv writes, evidence hashing |
| Tenant isolation, RBAC, mass-assignment protection | Real authentication, organizations, users |

Capabilities are **descriptive data only**. Having `payment.initiate` registered grants nothing.

## 3. Component architecture

```
apps/api/src
├── app.ts                       Fastify build: auth hook, error envelope, ajv config
├── server.ts                    process entry (refuses dev auth in production)
├── errors.ts                    AppError hierarchy (safe, client-visible errors)
├── auth/                        Principal, permissions (RBAC), dev-only authenticator
├── db/                          Drizzle schema, client, migrator
└── modules/agent-registry/
    ├── routes/agent.routes.ts           HTTP + TypeBox schemas (thin)
    ├── controllers/agent.controller.ts  entity -> DTO mappers
    ├── schemas/agent.schema.ts          request + response schemas
    ├── services/                        business logic, transactions
    │   ├── agent.service.ts             register / get / list / update
    │   ├── agent-status.service.ts      status changes + history
    │   ├── agent-capability.service.ts
    │   ├── agent-identity.service.ts    incl. the only verification path
    │   └── shared.ts                    org-scoped load, pg error mapping, audit snapshots
    ├── repositories/agent.repository.ts SQL only; every query org-scoped
    ├── policies/
    │   ├── agent-status.policy.ts       the transition table (single source of truth)
    │   └── agent-input.policy.ts        capability/identity/metadata rules
    └── types/agent.types.ts
```

Controllers are thin, services own business rules and transactions, the repository owns SQL, and lifecycle rules live only in the status policy.

## 4. Domain model

- **Agent**: `id` (uuid, server-generated), `organizationId`, `name` (1–120, unique per org, case-insensitive), `description`, `agentType` (`llm | workflow | service | wallet | other`), `status`, `runtimeType?`, `ownerReference?`, `externalReference?` (unique per org, case-insensitive; the stable key Dependency Discovery resolves against), `metadata` (JSON object), `createdAt`, `updatedAt`.
- **Capability**: dotted lowercase string, e.g. `customer.read`. Max 100 per agent. Normalised (trim, lowercase), deduplicated, sorted.
- **Identity**: `identityType` (`ens | evm_address | did | api_client | other`), `identityValue`, `chainId?`, `verificationStatus` (`unverified | pending | verified | failed`), `verifiedAt?`. Max 20 per agent. Unique per org on (type, lower(value), chain).
- **Status history entry** and **audit log entry**: append-only (section 5).

Metadata must not contain secrets. A best-effort guard rejects keys that look like secrets (`password`, `token`, `api_key`, `private_key`, `mnemonic`, ...), limits size to 8 KB and depth to 5. It is a guardrail, not a scanner: it cannot detect secrets in values.

## 5. Database schema

Defined in `apps/api/src/db/schema.ts`; migrations in `apps/api/drizzle/`.

| Table | Key points |
|---|---|
| `agents` | unique `(organization_id, lower(name))`; CHECK on status/type/non-blank name; indexes on org+status, org+type, org+created |
| `agent_capabilities` | unique `(agent_id, capability)`; FK `ON DELETE RESTRICT` |
| `agent_identities` | carries `organization_id` for per-org uniqueness; CHECK `verified_at IS NOT NULL` iff status is `verified` |
| `agent_status_history` | `previous_status` is NULL only for the initial registration entry; `incident_id` is an unconstrained uuid until the Incident module exists |
| `agent_audit_logs` | `before_state` / `after_state` JSONB snapshots |

Notes:

- `organization_id` has **no foreign key** because no organizations table exists yet.
- `agent_status_history` and `agent_audit_logs` are append-only **at the database level**: triggers reject `UPDATE`, `DELETE` and `TRUNCATE` (migration `0001_append_only_audit`). Agents are never hard-deleted (FK `RESTRICT`).
- All timestamps are `timestamptz`. `updated_at` is set by the application on every write.
- Drizzle Kit has no down migrations. Hand-written reverses are in `apps/api/drizzle/down/`; `test/migrations.test.ts` applies up, down and up again.

## 6. API

Base path `/api/v1/agents`. Success: `{ "data": ... }` (lists add `"pagination": { limit, offset, total }`). Error: `{ "error": { "code", "message", "details"? } }`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/` | `agent:write` | 201. Status is always `active`; cannot be supplied |
| GET | `/` | `agent:read` | `limit` (1–100, default 20), `offset`, `status`, `agentType`, `search` |
| GET | `/:agentId` | `agent:read` | includes capabilities and identities |
| PATCH | `/:agentId` | `agent:write` | only `name`, `description`, `agentType`, `metadata` |
| POST | `/:agentId/status` | `agent:status` (+ `agent:recover` for recoveries) | body `{ status, reason, incidentId? }` |
| GET | `/:agentId/history` | `agent:read` | newest first, paginated |
| PUT | `/:agentId/capabilities` | `agent:write` | replaces the whole set |
| PUT | `/:agentId/identities` | `agent:write` | replaces the set; callers cannot set verification |

HTTP status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found **or in another organization**, 409 conflict / invalid transition, 500 generic.

There are no audit endpoints, no delete endpoint, and no HTTP route that verifies identities.

## 7. Status lifecycle

Single source of truth: `policies/agent-status.policy.ts`. A reason is required for every change.

| From \ To | active | suspended | compromised | inactive |
|---|---|---|---|---|
| **active** | — | ordinary | ordinary | ordinary |
| **suspended** | ordinary | — | ordinary | ordinary |
| **compromised** | **recovery** | **recovery** | — | **recovery** |
| **inactive** | ordinary | ✗ | ordinary | — |

- *ordinary* needs `agent:status` (admin, operator).
- *recovery* needs `agent:recover` (**admin only**) and a reason of at least 10 characters.
- **Every** exit from `compromised` is a recovery. Otherwise an operator could do `compromised → inactive → active` and bypass the control.
- Status cannot be changed through PATCH (the field is rejected).
- The change, its history row and its audit row are written in **one transaction** with the agent row locked (`SELECT … FOR UPDATE`), so concurrent changes serialise and are validated against the real current status.

## 8. Security considerations

| Control | Where |
|---|---|
| Tenant isolation: `organizationId` comes only from the authenticated principal; every query filters on it | auth hook, repository |
| Cross-org and unknown IDs both return 404 (no existence oracle) | `loadAgent` |
| RBAC: viewer = read; operator = read/write/status; admin = + recovery + identity verification | `auth/permissions.ts` |
| Mass-assignment protection: `additionalProperties:false` and `removeAdditional:false`, so unknown fields are a 400, not silently dropped | schemas, `app.ts` |
| Response allow-list: response schemas strip anything not declared | route schemas |
| Identities cannot be self-declared verified; the only path is `AgentIdentityService.recordVerification`, admin-only and not exposed over HTTP; DB CHECK ties `verified_at` to `verified` | identity service, schema |
| A changed identity value is treated as a new identity and starts `unverified` | identity service |
| Append-only audit/history enforced by DB triggers | migration 0001 |
| No internal errors to clients; unique violations mapped to fixed messages | error handler, `mapUniqueViolation` |
| `LIKE` wildcards in search terms are escaped | repository |
| No secrets in metadata (best-effort) | input policy |
| Dev auth refuses to start when `NODE_ENV=production` | `server.ts` |

## 9. Error handling

All errors use the envelope above. `AppError` subclasses carry safe messages. Anything else is logged server-side (`req.log.error`) and returned as `500 INTERNAL_ERROR` with no detail. Request bodies are not logged.

## 10. Testing

`pnpm test` (Vitest) runs against a **real PostgreSQL** (`docker compose up -d --wait`). `test/global-setup.ts` creates a throwaway database, applies the real migrations, and drops it afterwards. If Postgres is unreachable the run fails; it never skips.

| File | Covers |
|---|---|
| `registration.test.ts` | valid/invalid input, mass assignment, duplicates, org isolation, secrets in metadata |
| `retrieval.test.ts` | get/list, pagination, filters, LIKE escaping, cross-org 404 |
| `update.test.ts` | permitted updates, protected fields, conflicts |
| `lifecycle.test.ts` | transitions, recovery authorization, history, rollback on audit failure, concurrency |
| `capabilities.test.ts` | normalisation, replacement + audit, malformed input, isolation |
| `identities.test.ts` | metadata storage, verification rules, uniqueness, DB constraint |
| `audit.test.ts` | audit contents, no mutating routes, DB triggers, FK restrict |
| `auth.test.ts` | 401 on every route, fail-closed default, org source |
| `policy.test.ts` | full 4×4 transition matrix, input policy units |
| `migrations.test.ts` | up, idempotent re-run, down, up again |

## 11. Running it

```bash
corepack enable
pnpm install
docker compose up -d --wait            # Postgres on 127.0.0.1:54329 (local throwaway credentials)
export DATABASE_URL=postgres://corven:corven_local_only@127.0.0.1:54329/corven
pnpm --filter @corven/api db:migrate
CORVEN_DEV_AUTH=1 pnpm --filter @corven/api start   # DEV ONLY: trusts x-dev-* headers
pnpm typecheck && pnpm lint && pnpm test
```

Dev auth headers: `x-dev-actor-id` (uuid), `x-dev-org-id` (uuid), `x-dev-role` (`admin|operator|viewer`). Without `CORVEN_DEV_AUTH=1` every API request returns 401.

## Known limitations

- **No real authentication, users, organizations or role management exist.** Auth is an `Authenticator` interface; the only implementations are a fail-closed default and a development header adapter. Production needs a real authenticator (and an organizations table + FK) before this module is exposed.
- `incident_id` on status history is not validated (no incidents module yet).
- Identity verification (e.g. ENS resolution) is **not implemented**. `recordVerification` exists as the future integration point.
- Metadata secret detection is name-based only.
- No agent deletion, no audit read endpoint, no optimistic-concurrency (ETag) on PATCH.
- Down migrations are manual scripts, not generated by tooling.
- No rate limiting.

## Future integration points

- **Dependency Registry / Graph Engine** read agents, capabilities and statuses via the repository/service.
- **Incident Management** will mark agents `compromised` through `AgentStatusService.changeStatus` with `incidentId`.
- **Authorization Gateway** will consult status (`suspended`/`compromised` ⇒ deny); capabilities remain advisory input.
- **ENS adapter** will call `recordVerification`.
- **Evidence Service** will hash audit/history rows.

## Addendum: references and the reader (for Dependency Discovery)

- `externalReference`, `ownerReference` and `runtimeType` are optional, set at registration or with PATCH (null clears them), included in audit snapshots, and unique-checked (`409 AGENT_EXTERNAL_REF_CONFLICT`). `externalReference` must match `^[A-Za-z0-9][A-Za-z0-9._:/@-]*$`.
- `AgentRegistryReader` (`modules/agent-registry/readers`) is an internal, read-only, organization-explicit interface for other modules: `getAgent`, `listAgents`, `findAgentByExternalReference`, `getCapabilities` and `validateAgentReference`. It takes an `organizationId`, not a principal, so callers must get that id from their own authenticated context.
- Registering a reference does not prove an agent is what the reference claims.
