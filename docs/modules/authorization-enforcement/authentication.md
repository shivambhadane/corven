# Agent authentication

Machine identity is separate from human identity. Firebase login tokens and wallet signatures are not used for agents.

## Bootstrap credential

`cvn_<credentialId>.<secret>`; the secret is 32 random bytes (base64url). Only its SHA-256 is stored (a plain hash is adequate for a 256-bit random secret; there is nothing to brute-force). It is shown **once**, in the response that creates it (`cache-control: no-store`). At most one credential per agent is active (partial unique index). Optional `expiresAt`.

| Operation | Endpoint | Who |
|---|---|---|
| Issue | `POST /agent-auth/credentials` | admin (`credential:manage`) |
| Rotate | `POST /agent-auth/rotate` | admin; revokes the old credential and issues the new one in one transaction |
| Revoke | `POST /agent-auth/revoke` | admin; revoking when none is active is a no-op |
| History | `GET /agent-auth/credentials/:agentId/history` | admin; append-only: issued / rotated / revoked, actor, reason |
| Exchange | `POST /agent-auth/token` | public (the credential is the authentication) |

## Token

HS256 JWT with `iss=corven`, `aud=corven-gateway`, `sub=agentId`, `org`, `cid=credentialId`, `jti`, `iat`, `nbf`, `exp` (default lifetime 300 s). Only HS256 is accepted; the header `alg` is verified, never used to choose the algorithm (`none` and other algorithms are rejected). The signing key is `AGENT_TOKEN_SECRET` (at least 32 bytes). Without it, agent authentication is disabled and fails closed. Under the development authenticator, `server.ts` generates an ephemeral key.

## Validation on every request

Signature, issuer, audience, `exp`/`nbf`, and then the **database**: the credential named by `cid` must be active, unexpired, and belong to the same agent and organization as the claims. So revoking or rotating a credential, or an agent leaving the `active` state, cuts off tokens that were already issued instead of waiting for them to expire. The agent identity comes only from the verified token; a body that names an agent or organization is rejected (400).

Every credential failure returns the same `INVALID_CREDENTIAL` (and token failures `INVALID_TOKEN`), so a caller learns nothing about which part was wrong. Agents that are not `active` cannot obtain tokens.

## Replay

Bearer tokens are valid until expiry (or revocation of the credential); `jti` is carried but not tracked. Protection against replayed **operations** is the per-agent `requestId`: a repeated request id never executes twice and returns the original outcome.

## Not built

Asymmetric workload identity and mTLS (the token module is one file to replace), rate limiting and lockout on failed exchanges, credential scoping (a token grants whatever the agent's permissions allow), and automatic expiry reminders.
