# Evidence API

Base `/api/v1`. Unknown fields are a 400. Organization from the principal; another organization's records are 404.

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/evidence/generate` | `evidence:generate` (admin, operator, system) | `{incidentId}` -> 201 with the sealed record and content |
| GET | `/evidence/:id` | `evidence:read` (all human roles, system) | Record, content, anchors |
| POST | `/evidence/:id/verify` | `evidence:verify` (admin, operator, system) | `{valid, status, steps, anchors}`; logged |
| POST | `/evidence/:id/anchor` | `evidence:anchor` (admin, system) | `{targets?: ["arkiv","ethereum"]}` -> 202. Refuses invalid evidence (`EVIDENCE_INVALID`) and unconfigured targets (`TARGET_NOT_CONFIGURED`); never republishes a submitted or confirmed anchor |
| POST | `/evidence/:id/anchors/refresh` | `evidence:anchor` | Re-reads external state; confirms Ethereum anchors once enough confirmations exist |
| GET | `/evidence/:id/verifications` | `evidence:read` | Verification log |
| GET | `/incidents/:incidentId/evidence` | `evidence:read` | Records for an incident, in sequence order |

Errors: `EVIDENCE_NOT_FOUND`, `INCIDENT_NOT_FOUND` (404); `EVIDENCE_INVALID`, `TARGET_NOT_CONFIGURED`, `EVIDENCE_GENERATION_CONFLICT` (409).

Configuration: `buildApp({ evidenceConfig })` with `arkiv`, `ethereum` clients and `requiredConfirmations`. The server does not configure real clients yet, so anchoring returns `TARGET_NOT_CONFIGURED` in a stock deployment.
