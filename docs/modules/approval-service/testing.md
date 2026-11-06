# Approval Service: testing

| File | Focus |
|---|---|
| `test/approval-core.test.ts` (12) | Digest determinism and sensitivity to every bound field, risk assessment, required counts, defaults, policy validation |
| `test/approval-api.test.ts` (23) | Request binding and incident transition; refusals (role, state, missing incident, plan taken from body); integrity failure at request; elevated plans; approval by an approver with system transition and timeline; viewers and operators refused; separation of duties on and off; multiple approvers and duplicate decisions; rejection; concurrent approvals; expiry on decision and by sweep; cancellation rules; invalidation by tampering before and after approval; withdrawal race; gateway enforcement through the real service and execution window; recovery of a failed incident update; policy RBAC, validation and copy-on-request; tenant isolation; listing; append-only and frozen binding |
| `test/gateway-api.test.ts` | Plan-based enforcement path |
| `test/migrations.test.ts` | 0014 and 0015 up, down, up |

Full suite at the time of writing: 661 tests in 41 files; `tsc` and ESLint clean.

Not covered: real human authentication, notification of approvers, and large numbers of pending requests.
