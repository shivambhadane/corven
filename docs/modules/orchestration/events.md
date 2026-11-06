# Event contracts

There is **no external event bus**. Facts are recorded synchronously in each module's own tables, and surfaced on the incident timeline through one idempotent interface. This section lists them.

## Incident timeline (`incident_events`, append-only, ordered by `sequence`)

| Event | Written by | Idempotency key |
|---|---|---|
| `incident.created`, `.updated`, `.severity_changed`, `.assigned`, `.agent_associated`, `.resource_associated`, `.snapshot_attached`, `.blast_radius_attached`, `.containment_plan_attached`, `.transitioned`, `.note_added` | Incident Management | n/a (inside the writing transaction) |
| `approval.requested` | Incident Management, on entering `awaiting_approval` (plan hash included) | n/a |
| `approval.granted`, `.rejected`, `.expired`, `.cancelled`, `.invalidated` | Approval Service | `approval:<id>:<status>` |
| `verification.result_received` | Verification Service | `verification:<runId>` |
| `evidence.generated` | Evidence Service (`anchored: true` when confirmed) | `evidence:<id>`, `evidence:<id>:anchored` |
| `detection.signal_received`, `enforcement.result_received` | reserved; the Gateway does not yet write to the timeline (its results are in `enforcement_actions` and `enforcement_action_events` and are sealed into evidence) | |

Every event carries: id, sequence, incident, organization, type, actor id and type, data, correlation id, time. A repeated key records nothing. Data is limited to 8 KiB and must not contain credentials.

## Lifecycle transitions made by modules (as `system`, with idempotency keys)

| Module | Transition | Key |
|---|---|---|
| Approval | `awaiting_approval -> approved / rejected / investigating` | `approval:<id>:approved` etc. |
| Orchestrator | `detected -> investigating`, `investigating -> containment_planned`, `approved -> containing` | `workflow:<id>:...` |
| Verification | `containing -> verifying`; `verifying -> contained / partially_contained / containment_failed` | `verification:<run>:start / outcome` |

## Workflow log (`workflow_events`, append-only)

`started`, `step`, `retry_scheduled`, `evidence_generated`, `anchoring_skipped`, `completed`, `stopped`, `blocked`, `failed`, `retried`, `cancelled`, each with detail.

## Not implemented

Outbound webhooks/streams, a dead-letter queue (terminal failures stay visible as `failed` workflows), schema-versioned event envelopes beyond the evidence and approval digests.
