# Approval Service: API

Base `/api/v1`. Human principal required. Unknown fields are a 400; the plan, hash and decider are never taken from a body.

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/approvals` | `approval:request` (admin, operator) | `{incidentId, comment?}`. 201 with the full request. Incident must be `containment_planned` with a feasible, reproducible current plan |
| GET | `/approvals` | `approval:read` | `status`, `incidentId`, `page`, `limit` |
| GET | `/approvals/:id` | `approval:read` | Request, decisions, approvals received and remaining |
| POST | `/approvals/:id/approve` | `approval:decide` (admin, approver) | `{comment?}` |
| POST | `/approvals/:id/reject` | `approval:decide` | `{comment}` required |
| POST | `/approvals/:id/cancel` | `approval:request` | `{reason}`; requester or admin only |
| GET | `/approvals/:id/history` | `approval:read` | Audit trail |
| GET / PUT | `/approval-policy` | read / `approval:policy` (admin) | |

Internal: `ApprovalService.isPlanApproved(org, incidentId, planHash)` (used by the gateway) and `runMaintenance()` (expiry and reconciliation).

## Errors

| Status | Code |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 403 | `FORBIDDEN`, `SEPARATION_OF_DUTIES` |
| 404 | `APPROVAL_NOT_FOUND`, `INCIDENT_NOT_FOUND` |
| 409 | `INCIDENT_NOT_READY`, `APPROVAL_PENDING`, `APPROVAL_NOT_PENDING`, `ALREADY_DECIDED`, `APPROVAL_EXPIRED`, `APPROVAL_INVALIDATED`, `PLAN_INTEGRITY_FAILED` |
| 422 | `CONTAINMENT_PLAN_REQUIRED`, `PLAN_NOT_FEASIBLE` |

Another organization's requests are 404.
