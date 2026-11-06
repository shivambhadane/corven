# Gateway testing

| File | Focus |
|---|---|
| `test/gateway-core.test.ts` (20) | JWT verification (wrong key, tampering, `none`, expiry, issuer, audience, malformed), credential format and hashing, every policy rule and constraint, coverage classification and the containment mapping |
| `test/gateway-api.test.ts` (38) | Credential issue/rotate/revoke, generic failures, expiry via a controllable clock, forged/mis-addressed tokens, human/agent separation, suspended and compromised agents, fail-closed without a key, permissions (RBAC, validation, revoke-only trigger), allow/deny with recorded decisions and no payload storage, body spoofing, resource resolution, constraints, in-flight revocation, at-most-once under concurrency, executor failure / submitted / missing, storage failure (503), tenant isolation, enforcement (restriction beats grants, rollback, unsupported, suspend, credential revoke, idempotency, approval refusals, append-only), coverage feeding the planner, and approved-plan enforcement with malicious and healthy paths |
| `test/migrations.test.ts` | Up, down, re-up for 0012 and 0013 |

Not covered: load, a real external resource, mTLS, and a real Approval Service (a test double stands in for `ApprovalVerifier`).
