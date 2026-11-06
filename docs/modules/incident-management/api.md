# Incident Management: API

Base path `/api/v1/incidents`. Authentication is the development header adapter. Unknown body or query fields are a 400. The organization, actor and detection source are **never** read from a body. Responses are `{ data }`, lists add `{ pagination: { page, limit, total, totalPages } }`. Errors are `{ error: { code, message, details? } }`.

Permissions: `incident:read` (admin, operator, viewer), `incident:write` and `incident:transition` (admin, operator), `incident:recover` (admin), `incident:event` (system only). Analysis endpoints also need `analysis:read`; creating a snapshot needs `snapshot:write`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/` | write | Create (201). Body `{title, severity, description?, agents?[], resources?[]}`. Source is always `manual` |
| GET | `/` | read | List. Filters: `status` and `severity` (repeatable), `createdFrom`, `createdTo`, `agentId`, `assigneeId`, `page`, `limit` (max 200). Newest first, ties by id |
| GET | `/:incidentId` | read | Detail with `availableTransitions` for the caller and the current references |
| PATCH | `/:incidentId` | write | Body `{title?, description?, severity?}` (at least one). Rejects `status` |
| POST | `/:incidentId/transition` | transition | Body `{to, reason, expectedStatus?, acknowledgeResidualRisk?}` |
| GET | `/:incidentId/state-history` | read | Every transition |
| POST/GET | `/:incidentId/agents` | write / read | Associate `{agentId, relationship, suspectedCompromised?, impact?, sourceReference?}` (201) |
| POST/GET | `/:incidentId/resources` | write / read | Associate `{resourceId, relationship, impactClassification?, sourceReference?}` (201) |
| POST | `/:incidentId/assign` | write | `{assigneeId, note?}` |
| GET | `/:incidentId/assignments` | read | Assignment history |
| POST/GET | `/:incidentId/notes` | write / read | `{content}` (201); paginated list |
| GET | `/:incidentId/timeline` | read | Paginated, ordered by `sequence` |
| POST | `/:incidentId/graph-snapshot` | write | `{snapshotId?}` pins an existing snapshot, otherwise captures a new one (`label?`). 201, returns the reference |
| POST | `/:incidentId/blast-radius` | write | `{sourceNodeIds?, confidenceThreshold?, staleAfterHours?}`. Sources default to the incident's compromised agents. 201, `{reference, result}` |
| POST | `/:incidentId/containment-plan` | write | Same inputs as `/containment/plan` minus `snapshotId`. 201, `{reference, result}` |
| GET | `/:incidentId/analysis` | read | All references; `?kind=` filter |
| GET | `/:incidentId/analysis/:referenceId/verify` | read | Re-runs the engine on the pinned snapshot and compares hashes |

There is deliberately no HTTP endpoint to publish events or to make system transitions.

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | schema, size, blank text, unknown field |
| 403 | `FORBIDDEN` | missing permission (including recovery) |
| 403 | `TRANSITION_NOT_PERMITTED` | a person tried a trusted-module transition, or the reverse |
| 404 | `INCIDENT_NOT_FOUND`, `AGENT_NOT_FOUND`, `RESOURCE_NOT_FOUND`, `REFERENCE_NOT_FOUND`, `SNAPSHOT_NOT_FOUND` | missing, or in another organization |
| 409 | `INVALID_INCIDENT_TRANSITION` | not in the graph; `details` lists the allowed targets |
| 409 | `STALE_INCIDENT_STATE`, `INCIDENT_CLOSED`, `ALREADY_ASSOCIATED`, `IDEMPOTENCY_CONFLICT` | |
| 409 | `SNAPSHOT_REQUIRED`, `ANALYSIS_NOT_ALLOWED`, `PLAN_LOCKED` | analysis ordering and state rules |
| 422 | `CONTAINMENT_PLAN_REQUIRED`, `CONTAINMENT_PLAN_STALE`, `PLAN_NOT_FEASIBLE`, `RESIDUAL_RISK_NOT_ACKNOWLEDGED` | transition guards |
| 422 | `NO_COMPROMISED_AGENTS`, `INCONSISTENT_ASSOCIATION`, `SNAPSHOT_CHANGED`, `CONTAINS_SECRET` | domain rules |
| 500 | `SNAPSHOT_INTEGRITY_FAILED` | the pinned snapshot no longer matches its hash |

Internal errors never include SQL, constraint names or stack traces.
