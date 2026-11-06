# Authorization

Implemented as a pure function, `core/policy.ts`, over state that the service has just loaded from PostgreSQL. **Deny by default**: an `allow` needs every check to pass.

## Inputs

Agent status, whether the presented credential is still active, the resolved resource, the agent's active permissions on that resource, whether a containment restriction applies, the action and payload, and the clock. **Registry capabilities and dependency edges are not inputs**: they are descriptive and never authorize.

## Rules, in order

1. Unknown agent -> `AGENT_NOT_FOUND`.
2. Agent not `active` (`suspended`, `compromised`, `inactive`) -> `AGENT_NOT_ACTIVE`.
3. Credential not active -> `CREDENTIAL_INACTIVE`.
4. Resource unknown in this organization -> `RESOURCE_UNKNOWN`.
5. An executed `revoke_resource_access` restriction on (agent, resource) -> `RESTRICTED_BY_CONTAINMENT`, which beats any grant, including one created later.
6. No active permission for exactly this action -> `NO_PERMISSION`.
7. Constraints: `expiresAt` passed -> `PERMISSION_EXPIRED`; `maxAmount` set and `payload.amount` missing, non-numeric, negative or larger -> `CONSTRAINT_VIOLATED`. If several grants exist, any one satisfying its constraints allows.

Allowed decisions carry the permission id and version used. Every decision (`check`, `precheck`, `recheck`) is recorded with its reason codes; the payload is **never** stored, only its SHA-256.

## Permissions

An administrator grants `(agent, resource, action, constraints)`; the pair must exist in the organization. One active grant per agent/resource/action. Revocation is the only permitted change (database trigger), bumps `version`, and requires a reason. Everything is audited in `gateway_audit_logs`.

## Resolving the resource

A request names a resource by id, external reference or name, in that order, always within the token's organization.

## Source of truth

PostgreSQL. A decision is made from the current rows on every request; there is no cache, so there is no stale-permission window other than the millisecond one described in [architecture.md](architecture.md). If the database cannot be read, the request is denied (503). Ethereum is not on this path.

## Not built

Role/attribute policies beyond `maxAmount` and `expiresAt`, a policy language, per-action rate limits, and incident-aware restrictions beyond containment actions (an agent associated with an incident is not restricted unless an enforcement action was applied or its status changed).
