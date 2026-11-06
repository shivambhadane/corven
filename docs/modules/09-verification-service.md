# Verification Service

**Status: planned (design).**

## Purpose

Confirm that containment achieved its intended outcome. A transaction being submitted, or an adapter returning success, is not verification.

## What it checks

1. **Blocked path:** retry the previously attempted compromised operation at the enforcement boundary and expect it to be denied.
2. **Healthy path:** run an unaffected healthy workflow and expect it to succeed.
3. **Comparison:** expected versus observed for every check, with discrepancies recorded.
4. **Model check:** with the cut edges removed, re-run reachability in the pinned graph: the source reaches no protected entity and every preserved workflow pair is still reachable. (This checks the plan against the model, not reality.)

## Rules

- The verifier acts through the Authorization Gateway as its own identity, so it tests the real boundary and not a shortcut.
- The result is one of: `verified`, `verified_with_gaps` (some paths could not be tested, listed), `failed` (a discrepancy), or `not_run`. Never `verified` when any required check failed or was skipped.
- Probes must be safe: read-only or sandboxed operations. A verifier must not itself cause damage.
- Coverage is part of the result: which protected paths and healthy workflows were actually tested, and which were not.
- Failure is reported clearly with an actionable next step; the incident is not marked verified.

## Domain model

`VerificationRun`: `id`, `incidentId`, `planId`, `status`, `startedAt`, `completedAt`.
`VerificationCheck`: `runId`, `kind` (`blocked_path | healthy_path | model`), `description`, `expected`, `observed`, `outcome` (`pass | fail | skipped | error`), `evidenceRef`.

## Limits to state in the product

- Verification proves behavior only for what was tested; it does not prove no other path exists.
- Paths outside CORVEN's enforcement boundary cannot be verified.
- Time matters: a check is a point-in-time result.

## Planned API

`POST /api/v1/incidents/:id/verify`, `GET /api/v1/incidents/:id/verification`. Permission: `verification:run`.

## Errors

`VERIFICATION_FAILED` is a result, not an HTTP error; `VERIFICATION_NOT_POSSIBLE` 409 when the plan was not executed.

## Tests to write

Pass; blocked operation unexpectedly allowed (fail); healthy workflow broken (fail); skipped checks give `verified_with_gaps`; model check catches a bad plan; verifier identity recorded; no probe has side effects.
