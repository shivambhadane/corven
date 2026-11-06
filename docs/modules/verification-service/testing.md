# Verification: testing

| File | Focus |
|---|---|
| `test/verification-core.test.ts` | Aggregation (pass, fail, partial, inconclusive; bypass cannot count as blocking), incident mapping, path reachability with removed edges |
| `test/verification-api.test.ts` (18) | Full scenario: approved plan enforced, malicious paths denied, healthy agents probed, incident `contained`, nothing executed. Honest outcomes: partial enforcement, nothing enforced, broken healthy paths, explicit healthy checks, re-grant after containment, undeclared bypass, executor without probe, resource down. Inconclusive run, retry, retry limit, transient probe failure, recovery of a failed incident update. Preconditions, one active run, idempotency, roles, tenant isolation, append-only checks, final runs, tamper detection by result hash |

Full suite at the time of writing: 686 tests in 43 files; `tsc` and ESLint clean.

Two defects were found and fixed while writing these tests:
1. The incident module's credential-key guard matched any key containing "pass", so it rejected `counts.passed` in event data and verification results never reached the timeline. It now matches password and passphrase forms only (tested).
2. A protected resource with no healthy dependents was reported inconclusive, which would have blocked `contained` forever. It is now listed under `notChecked` instead.
