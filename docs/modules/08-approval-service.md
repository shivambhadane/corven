# Approval Service

**Status: planned (design).**

## Purpose

Put a human decision between a proposed containment plan and its execution when the plan is sensitive, and make that decision impossible to reuse for anything the human did not see.

## When approval is required

Any one of: a shared resource is affected; an action's impact or cost exceeds a threshold; a dependency is uncertain (low confidence, stale, or incomplete information); a high-value resource is touched; the plan is ambiguous (several equal-cost solutions); a recovery from `compromised`. The Containment Engine reports which triggers fired.

## Core guarantee: binding to the exact plan

An approval is bound to the **plan hash**: a SHA-256 over the canonical serialization of the plan version and its full action set. If the plan changes in any way, the hash changes, the approval no longer matches, and a new approval is required. A rejected plan, a changed plan or an expired approval can never execute as approved.

## Domain model

`Approval`: `id`, `organizationId`, `incidentId`, `planId`, `planVersion`, `planHash`, `requestedBy`, `requestedAt`, `decision` (`pending | approved | rejected | expired`), `decidedBy`, `decidedAt`, `reason`, `expiresAt`.
Append-only decision history.

## Rules

- Only users with the approval permission can decide; the requester cannot approve their own request when separation of duties is enabled (policy option).
- A reason is required for rejection and for approving an uncertain or shared-resource plan.
- Approvals expire, because the graph and the situation change.
- Deciding twice, or on a non-pending approval, is a conflict.
- Every request and decision is audited and recorded as evidence.
- "Approved" is not "executed" and not "verified". The UI and API keep the stages separate.

## Planned API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/incidents/:id/approvals` | Request approval of the current plan |
| GET | `/api/v1/incidents/:id/approvals` | History |
| POST | `/api/v1/approvals/:id/decision` | `approved` or `rejected`, with reason |

Permissions to add: `approval:request`, `approval:decide`.

## Errors

`PLAN_HASH_MISMATCH` 409 (plan changed since the request); `APPROVAL_EXPIRED` 409; `APPROVAL_NOT_PENDING` 409; `SELF_APPROVAL_FORBIDDEN` 403.

## Tests to write

Hash binding (change one action, approval invalid); rejection blocks execution; expiry; double decision; role checks; separation of duties; audit rows; tenant isolation.

## Open questions

Is separation of duties required for the demo? How long do approvals live? Can an approval cover a plan whose only changes are reordering of actions? (Proposal: no, the hash is over a canonical order, so reordering is not a change, but any content change is.)
