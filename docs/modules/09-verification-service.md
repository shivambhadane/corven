# Verification Service (index)

**Status: implemented and tested.** Documentation: [verification-service/](verification-service/README.md).

Verification checks an incident's approved containment against the live gateway decision path and the pinned graph. Security checks: negative access, permission persistence, path blocking and bypass resistance. Continuity checks: positive access and resource health, through non-destructive probes. Results are `passed`, `failed` or `inconclusive` per check and `passed`, `partially_verified`, `failed` or `inconclusive` per run. Only a full pass moves the incident to `contained`; an inconclusive run leaves it in `verifying` for a bounded retry. Evidence is append-only and hash-sealed.

Not built: probes against real external resources (executors are simulated), scheduled verification, and clean-up of runs interrupted by a crash.
