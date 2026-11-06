# Authorization Model

This covers authorization of **people and internal actors using CORVEN's API**, which is built (apart from real authentication). Authorization of **agent operations** (the gateway) is implemented: [modules/authorization-enforcement/](../modules/authorization-enforcement/README.md).

## Principal

Every request resolves to a `Principal`: `{ actorId, organizationId, role }`. `organizationId` comes only from the principal, never from a body, query or URL. The role is `admin`, `operator`, `viewer`, `approver` (decides containment approvals and changes nothing else), or `system` (internal only).

## Authentication state (read this first)

| Piece | State |
|---|---|
| `Authenticator` interface | Built |
| Fail-closed default (rejects everything) | Built |
| Development header adapter (`x-dev-*`) | Built; trusts headers; refuses to start when `NODE_ENV=production` |
| Real authentication (identity provider, tokens, sessions), users, organizations, memberships | **Not built** |

Until real authentication exists the API must not be reachable from outside a developer machine.

## Permission matrix (implemented in `apps/api/src/auth/permissions.ts`)

| Permission | admin | operator | viewer | system |
|---|:-:|:-:|:-:|:-:|
| `agent:read` | ✓ | ✓ | ✓ | ✓ |
| `agent:write` (register, update, capabilities, identities) | ✓ | ✓ | | |
| `agent:status` (ordinary transitions) | ✓ | ✓ | | |
| `agent:recover` (exit from `compromised`) | ✓ | | | |
| `agent:identity:verify` | ✓ | | | |
| `dependency:read` | ✓ | ✓ | ✓ | ✓ |
| `dependency:write` | ✓ | ✓ | | ✓ |
| `resource:read` | ✓ | ✓ | ✓ | ✓ |
| `resource:write` | ✓ | ✓ | | |
| `graph:read` | ✓ | ✓ | ✓ | ✓ |

Later modules add (see each module's docs): `incident:*`, `gateway:read`, `permission:read/write`, `credential:manage`, `enforcement:read/apply`, and `approval:read` (all human roles), `approval:request` (admin, operator), `approval:decide` (admin, **approver**), `approval:policy` (admin), `verification:read` (all human roles), `verification:run` (admin, operator, system), `evidence:read` (all human roles), `evidence:generate` and `evidence:verify` (admin, operator, system), `evidence:anchor` (admin, system). The `approver` role has read access plus `approval:decide` only.

The `system` role belongs to internal modules. HTTP authenticators only ever return human roles, and a test asserts `x-dev-role: system` is rejected.

## Rules

1. **Tenant isolation:** repositories always filter by `organization_id`. A resource in another organization is reported as not found (404), indistinguishable from a missing one.
2. **Agent lifecycle:** the transition table is the only authority on which status changes exist. Every exit from `compromised` is a recovery requiring `agent:recover` and a reason of at least 10 characters, so a compromised agent cannot be laundered back via `inactive`.
3. **Mass assignment:** protected fields (`id`, `organizationId`, status via PATCH, timestamps, `version`) are rejected, not ignored.
4. **Identity verification:** callers cannot set `verified`; only an internal, admin-gated operation can, and it is not exposed over HTTP.
5. **Capabilities are not permissions.** They describe what an agent is registered to do.
6. **Discovery is limited:** the `system` actor can write dependencies but cannot create authority edges from configuration, workflow or runtime evidence alone; that needs manual or permission-configuration evidence, or an approved review. It cannot write agents or resources.
7. **Forbidden writes leave no trace** in versions or audit rows.

## Planned permissions

| Permission | For |
|---|---|
| `discovery:read/write/run/review` | Discovery sources, runs and reviews |
| `incident:read/write/resolve` | Incident lifecycle |
| `verification:run` | Verification |
| `evidence:read` | Evidence retrieval |
| `organization:admin` | Membership management |

## Authorization of agent operations (planned)

Deny by default. A decision depends on current agent status, permission state and policy, is rechecked at execution time, and is recorded. Registered capabilities and dependency edges never authorize an operation by themselves.
