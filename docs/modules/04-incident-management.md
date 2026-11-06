# Incident Management

**Status: planned (design).** Nothing in this document is implemented. It depends on the built Graph Engine and registries, and orchestrates the other planned modules.

## Purpose

Own the lifecycle of a security incident from detection to resolution: who or what triggered it, which graph it was analysed against, the plan, the approval, what was executed, what was verified, and the evidence trail. It is the orchestrator; the heavy logic lives in the modules it calls.

## Responsibilities

- Create an incident against a registered agent; mark that agent `compromised` through the Agent Registry (with the incident id on the status history row).
- Pin the graph used for analysis, so decisions are reproducible even if the registry changes later.
- Drive the state machine and record every transition.
- Call Blast-Radius, Containment, Approval, the Gateway, Verification and Evidence in order, and keep their outputs.
- Distinguish planned, approved, submitted, executed and verified containment, and never call a partial result contained.

Not responsible for: computing impact (Blast-Radius), planning (Containment), enforcing (Gateway), proving (Evidence).

## State machine

States from the PRD: `detected`, `investigating`, `analyzing`, `containment_proposed`, `awaiting_approval`, `containing`, `contained`, `verified`, `failed`, `resolved`.

| From | To | Condition |
|---|---|---|
| detected | investigating | operator or automation picks it up |
| detected, investigating | analyzing | analysis started |
| investigating | resolved | judged a false positive (reason required) |
| analyzing | containment_proposed | impact and plan produced |
| analyzing | failed | analysis could not complete (reason recorded) |
| containment_proposed | awaiting_approval | plan needs approval |
| containment_proposed | containing | no approval required by policy |
| awaiting_approval | containing | approved (decision bound to this plan version) |
| awaiting_approval | containment_proposed | rejected or plan changed: re-plan |
| containing | contained | every action executed |
| containing | failed | any action failed or was only partially applied |
| contained | verified | verification passed |
| contained | failed | verification failed |
| failed | containment_proposed | operator retries with a new plan |
| failed, verified | resolved | operator closes it (reason required) |

Every other transition is rejected. Transitions are decided by one policy module (same pattern as the agent status policy) and each writes an event row.

**Partial execution:** the execution record carries a per-action outcome and an overall `complete | partial | failed`. Only `complete` allows `contained`.

## Domain model

`Incident`: `id`, `organizationId`, `sourceAgentId`, `incidentType`, `triggerEvent` (structured, no secrets), `severity` (`low | medium | high | critical`), `status`, `graphSnapshotId`, `currentPlanId`, `createdAt`, `updatedAt`, `resolvedAt`.
`IncidentEvent` (append-only): `incidentId`, `type`, `from`, `to`, `actorId`, `payload`, `createdAt`.

## Planned tables

`incidents`, `incident_events` (append-only, same trigger pattern as the existing history tables). Foreign keys to agents, the planned `graph_snapshots`, `containment_plans`, `approvals`, `execution_records`, `verification_results`, `evidence_records`, all composite on `(id, organization_id)`.

## Planned API (`/api/v1/incidents`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | Open an incident for an agent |
| GET | `/`, `/:id` | List and read (filters: status, severity, source agent) |
| POST | `/:id/analyze` | Run blast-radius analysis |
| POST | `/:id/plan` | Generate a containment plan |
| POST | `/:id/execute` | Execute an approved plan |
| POST | `/:id/verify` | Run verification |
| POST | `/:id/resolve` | Close with a reason |
| GET | `/:id/events` | Timeline (read-only) |

Permissions to add: `incident:read`, `incident:write`, `incident:resolve`.

## Rules

- Opening an incident and marking the agent compromised happen in one transaction.
- The graph snapshot is created at analysis time and never changes.
- A rejected, changed or expired plan can never execute as approved.
- Idempotent endpoints: repeating `execute` for the same plan does not re-apply actions.
- Background steps (execution, verification) are jobs that retry transient failures and record permanent ones.

## Errors

`INCIDENT_NOT_FOUND` 404; `INVALID_INCIDENT_TRANSITION` 409; `PLAN_NOT_APPROVED` 409; `PLAN_STALE` 409 (graph changed materially since planning, if that check is adopted); `EXECUTION_PARTIAL` reported in the result, never as success.

## Tests to write

Transition matrix (exhaustive), atomic open-and-mark-compromised, tenant isolation, concurrency on transitions, rejected plan cannot execute, partial execution never reaches `contained`, event log append-only.

## Open questions

- Who can open an incident: operator only, or also an authenticated signal source (Chainlink CRE, automation)?
- Is a graph "materially changed" check required before executing an old plan?
