# Gateway events

**Nothing is published to an event bus yet.** The gateway's durable records are its events: `gateway_decisions`, `execution_records`, `enforcement_actions` with `enforcement_action_events`, `gateway_audit_logs` and `credential_rotation_history`.

It does not yet write to the Incident Management timeline. The planned mapping, to be implemented by the orchestration stage using `IncidentService.recordExternalEvent`:

| Gateway fact | Incident timeline event |
|---|---|
| Enforcement action submitted / executed / failed | `enforcement.result_received` (with action id, kind, status, `verificationRequired`) |
| Plan enforcement started | transition `approved -> containing` (system) |

Idempotency keys already exist on enforcement actions (`<prefix>:<edgeId>`), so the orchestrator can retry safely.
