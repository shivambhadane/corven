# Gateway security

## Trust boundaries

- The agent is identified only by a verified token whose credential is checked against the database on every request. Bodies cannot name an agent or organization.
- Organization comes from the token (agents) or the human principal (admin routes). Every query filters on it; foreign ids are 404. The database adds composite foreign keys.
- Enforcement needs an approval basis. Plan approval is verified through a port that denies by default; an administrator override is explicit and recorded.
- The `system` principal is never obtainable over HTTP.

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| Forged or tampered token, `alg: none`, wrong audience | HS256 only, signature, issuer, audience, expiry checks (tested) |
| Stolen credential or token | Rotation and revocation take effect immediately because tokens are checked against the credential row; tokens live 5 minutes; only a hash of the secret is stored |
| Credential enumeration | One generic error for every failure |
| Revoked agent keeps working | Status and credential are re-read on every request and again before execution |
| Time-of-check/time-of-use | Re-check right before the executor; permission version passed to resources that can verify; the remaining window is documented |
| Duplicate or replayed operations | Claim before executing; unknown outcome is never retried |
| Gateway outage treated as allow | Every storage failure is a 503 denial |
| Payload leakage into logs | Only the payload hash is stored; results are size-limited |
| Re-granting a contained agent by mistake | The containment restriction beats grants until rolled back |
| Tampering with decisions or enforcement history | Append-only / finalize-once triggers |
| Claiming containment from a submitted action | Separate statuses; `executed` is documented as local state only; verification requirements listed |
| Cross-tenant use | See above; tested for credentials, permissions, decisions, enforcement and coverage |

## Limitations

- Simulated executors only; the gateway cannot yet protect a real external API.
- CORVEN cannot detect or stop access that bypasses the gateway, or revoke credentials it did not issue.
- No enforcement for delegation or agent-to-agent edges.
- No rate limiting or lockout on token exchange (a 256-bit secret makes guessing infeasible, but flooding is not throttled).
- Bearer tokens are not bound to a client (no mTLS or proof of possession).
- A symmetric signing key means anyone holding `AGENT_TOKEN_SECRET` can mint tokens; store it in a secret manager and rotate it (rotation invalidates all tokens).
- Human authentication is the development adapter.
- The approval check is an interface until the Approval Service exists.
