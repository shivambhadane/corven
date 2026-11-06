# Gateway API

Base `/api/v1`. **Agent routes** use `Authorization: Bearer <token>` and never a human principal; **admin routes** use the human principal. Unknown fields are a 400. Errors: `{ error: { code, message, details? } }`.

## Agent-facing

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/agent-auth/token` | none (credential in body) | `{credential}` -> `{token, tokenType, expiresIn, expiresAt}`; `cache-control: no-store` |
| POST | `/gateway/check` | agent | `{resource, action, payload?, requestId?}` -> decision, no execution |
| POST | `/gateway/execute` | agent | `{requestId, resource, action, payload?}`. 200 executed, 202 submitted, 403 `OPERATION_DENIED` (details: reason codes, decision id), 502 `EXECUTION_FAILED`. Idempotent per `requestId` (<=100 chars `[A-Za-z0-9._:-]`); payload <= 16 KiB |

## Administration

| Method | Path | Permission |
|---|---|---|
| POST | `/agent-auth/credentials` | `credential:manage` (admin) -> 201, secret shown once |
| POST | `/agent-auth/rotate`, `/agent-auth/revoke` | admin |
| GET | `/agent-auth/credentials/:agentId/history` | admin |
| POST/GET | `/permissions`, GET `/permissions/:id` | write: admin; read: admin, operator, viewer |
| POST | `/permissions/:id/revoke` | admin |
| PUT/GET | `/gateway/resources/:id/enforcement`, `/gateway/resources/enforcement` | admin write; read `gateway:read` |
| GET | `/gateway/coverage` | `gateway:read` |
| GET | `/gateway/agents/:agentId/decisions` | `gateway:read` |
| POST | `/enforcement/apply`, `/enforcement/revoke` | `enforcement:apply` (admin; the `system` role in-process) |
| GET | `/enforcement`, `/enforcement/:id` | `enforcement:read` |

## Error codes

`INVALID_CREDENTIAL`, `INVALID_TOKEN` (401); `AGENT_AUTH_UNAVAILABLE`, `ENFORCEMENT_UNAVAILABLE` (503, the request was denied); `OPERATION_DENIED` (403); `EXECUTION_FAILED` (502); `EXECUTION_IN_PROGRESS` (409, outcome unknown, not retried); `CREDENTIAL_EXISTS`, `PERMISSION_EXISTS`, `ALREADY_REVOKED`, `ROLLBACK_NOT_SUPPORTED` (409); `APPROVAL_REQUIRED` (403); `INVALID_ENFORCEMENT_TARGET` (422); `AGENT_NOT_FOUND`, `RESOURCE_NOT_FOUND`, `PERMISSION_NOT_FOUND`, `ENFORCEMENT_ACTION_NOT_FOUND`, `INCIDENT_NOT_FOUND`, `NO_ACTIVE_CREDENTIAL` (404).

Internal enforcement is limited to administrators over HTTP; the orchestrator calls `EnforcementService` in-process as the `system` principal.
