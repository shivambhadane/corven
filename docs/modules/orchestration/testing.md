# Orchestration and end-to-end testing

`test/orchestration-e2e.test.ts` (21 tests) runs the real modules against PostgreSQL.

| Scenario | Result checked |
|---|---|
| Full compromised Support Agent | Signal -> incident, snapshot, blast radius, plan with real coverage -> approval requested and **nothing enforced** -> person approves -> enforced, verified, `contained` -> evidence sealed, Arkiv confirmed, Ethereum submitted -> confirmations -> anchored -> evidence verifies. Malicious agent denied, healthy agent allowed through the gateway |
| Duplicate signal; five concurrent workers | One incident, one workflow, one approval, one snapshot/blast/plan |
| Worker dies holding a lease | Nothing happens while leased; continues after lease expiry |
| Restart mid-enforcement | Each action exactly once |
| pg-boss ticker | Real queue delivers the tick |
| Approval rejected | Workflow `stopped`, nothing enforced, no evidence |
| Approval expired | Incident back to investigation, `stopped`, nothing enforced |
| Plan altered after approval | Workflow `blocked`, nothing enforced |
| Enforcement adapter fails (one action / all) | `partially_contained` / `containment_failed`, recorded in verification and evidence |
| Resource down / healthy path broken | `partially_contained` |
| Verification inconclusive, then fine | Retried, `contained` |
| Verification stays inconclusive | `blocked`, incident still `verifying`, no evidence |
| Interrupted verification run | Closed `inconclusive` by maintenance |
| No compromised agents; unenforceable plan | `blocked`; an infeasible plan never reaches an approver |
| Transient errors | Backoff, exhaustion to `failed`, human retry |
| Cross-tenant access; roles; append-only log | Refused |
| Who approved | Only the approver; the automation never decides |

`test/release-audit.test.ts` (6): every route is authenticated (route inventory), agent routes reject human and malformed credentials, `system` cannot be claimed, and the permission matrix gives approve/enforce/anchor/credential powers only to the intended roles.

"Database unavailable" is covered at the module level (gateway fail-closed 503, workflow retry/backoff on storage errors, approval and verification reconciliation); there is no test that stops the real PostgreSQL server mid-run.
