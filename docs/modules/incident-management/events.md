# Incident Management: events

The timeline (`incident_events`) is the module's event record. Each row has an id, a stable `sequence`, incident and organization, `eventType`, actor id and type (`human` or `system`), structured `data`, correlation id and `occurredAt`. Nothing rewrites or deletes a row.

## Events written by this module

`incident.created`, `incident.updated`, `incident.severity_changed`, `incident.assigned`, `incident.agent_associated`, `incident.resource_associated`, `incident.snapshot_attached`, `incident.blast_radius_attached`, `incident.containment_plan_attached`, `incident.transitioned` (data: from, to, reason, recovery flag, optional residual-risk acknowledgement and the caller's `context`), `incident.note_added` (records that a note exists and its length, not its text), `approval.requested` (data: plan reference id, `planHash`, plan version; written when an incident enters `awaiting_approval`).

"Investigation started", "resolved" and "closed" are `incident.transitioned` events with the relevant `to`.

## Contract for modules that do not exist yet

Later modules publish facts with `IncidentService.recordExternalEvent(principal, incidentId, { type, data, idempotencyKey }, meta)` as the `system` principal (`incident:event`):

| Type | Intended producer |
|---|---|
| `detection.signal_received` | detection sources |
| `approval.granted`, `approval.rejected` | Approval Service |
| `enforcement.result_received` | Authorization and Enforcement Gateway |
| `verification.result_received` | Verification Service |
| `evidence.generated` | Evidence Service |

Rules:
- `idempotencyKey` is required (at most 200 characters). A repeated key records nothing and returns `{ recorded: false }`; concurrent duplicates record exactly once.
- `data` is at most 8 KiB and must not contain credential-like keys or values (`CONTAINS_SECRET`).
- An event never changes lifecycle state. State changes are explicit `transition` calls (as `system`, with an `idempotencyKey` and optional `data` such as the approval id), so an event and its transition are separate, auditable facts.
- Events are accepted on a closed incident, so late evidence can still be recorded.
- Incident creation from a detection source: `IncidentService.create(systemPrincipal, { detectionSource, detectionReference, ... })`. The same source and reference return the existing incident (`created: false`).

For reading, later modules use `IncidentReader` (`getIncident`, `getCurrentPlanReference`, `getCurrentSnapshotReference`), which is organization-explicit. The plan reference's `planHash` is what an approval must bind to.

## Not implemented

There is no external event bus or outbox for incident events yet. The cross-module orchestration stage will add one on pg-boss.
