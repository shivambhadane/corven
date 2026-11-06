# Orchestration API

Base `/api/v1`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/workflows` | `workflow:run` (admin, operator, system) | `{incidentId}`; 201 new, 200 if one exists |
| GET | `/workflows/:id`, `/incidents/:incidentId/workflow` | `workflow:read` (all human roles) | Workflow with its event log |
| POST | `/workflows/:id/run` | `workflow:run` | Runs it now if no other worker holds it |
| POST | `/workflows/:id/retry` | `workflow:run` | Only failed, blocked or stopped |
| POST | `/workflows/:id/cancel` | `workflow:run` | `{reason}` |

In-process (trusted): `Orchestrator.openFromSignal(organizationId, { title, severity, source, reference, compromisedAgentIds })` creates the incident (idempotent on `source` + `reference`) and starts its workflow. It is deliberately **not** an HTTP endpoint: a detection source must be authenticated as an internal module, and no machine-authentication for detectors exists yet.

Errors: `WORKFLOW_NOT_FOUND`, `INCIDENT_NOT_FOUND` (404); `WORKFLOW_NOT_RETRYABLE`, `WORKFLOW_FINISHED` (409).
