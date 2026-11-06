# Verification API

Base `/api/v1`. Human principal; the orchestrator calls the service as `system`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/verification/run` | `verification:run` (admin, operator, system) | `{incidentId, healthyChecks?[], maliciousChecks?[], idempotencyKey?}`; each check `{agentId, resourceId, action}`. 201 with the run and its checks |
| GET | `/verification/:id` | `verification:read` (all human roles) | Run, checks, `resultHashMatches` |
| POST | `/verification/:id/retry` | `verification:run` | Only inconclusive runs; at most 3 attempts |
| GET | `/incidents/:incidentId/verification` | `verification:read` | Runs for an incident, newest first |

Errors: `INCIDENT_NOT_FOUND`, `VERIFICATION_NOT_FOUND`, `TARGET_NOT_FOUND` (404); `INCIDENT_NOT_VERIFIABLE`, `VERIFICATION_IN_PROGRESS`, `VERIFICATION_NOT_RETRYABLE`, `RETRY_LIMIT_REACHED` (409); `NO_APPROVED_PLAN` (422). Another organization's runs are 404.
