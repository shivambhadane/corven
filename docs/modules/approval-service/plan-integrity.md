# Plan integrity

## The approval digest

```
approvalDigest = SHA-256( canonicalJSON({
  schemaVersion: 1, organizationId, incidentId, planReferenceId, planVersion,
  planHash,       // the Containment Engine's canonical plan hash
  snapshotHash,   // hash of the immutable graph snapshot the plan was computed on
  resultHash      // canonical hash of the engine's full output for that snapshot and input
}))
```

Canonical JSON is `common/canonical.ts`: keys sorted recursively, no whitespace, UTF-8. Changing what is hashed requires a new `schemaVersion`.

Binding to the snapshot and full result, not only the action list, means a plan recomputed on a different graph or with different inputs cannot match even if it happened to contain the same actions.

## Where it is re-verified

| When | What happens |
|---|---|
| Request | The plan is recomputed from its pinned snapshot with its stored input; the recomputed plan hash must equal the stored one, or the request is refused (`PLAN_INTEGRITY_FAILED`) |
| Every approve or reject | Recomputed again before the decision is recorded; the plan must still be the incident's current plan and reproduce the digest, otherwise the request is **invalidated** |
| Gateway asks `isPlanApproved(org, incident, planHash)` | Approved, inside the execution window, still the current plan, and recomputation reproduces the digest. A failure invalidates the approval. Any error answers **no** |

The gateway additionally requires that the incident is `approved` or `containing` and that `planHash` is the incident's current plan.

## What a modified plan means in practice

Legitimately, a plan cannot change during approval: Incident Management locks plan generation once approval is requested (`PLAN_LOCKED`) and snapshots are immutable. The checks above therefore target tampering below the application (a privileged database user editing a snapshot) and engine changes. Tests alter a stored snapshot behind its triggers and show the request refused, a pending approval invalidated, and an approved plan invalidated when the gateway asks.

A new plan always needs a new approval: the incident must go back through `containment_planned`, and the approval is bound to one plan reference.

## Limits

The digest proves the approved content is what is being executed; it does not prove the approver's identity, which comes from the (development) authenticator. Approvals are not signed.
