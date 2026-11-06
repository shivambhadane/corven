# Error Handling

## Envelope

Every error response:

```json
{ "error": { "code": "DEPENDENCY_EXISTS", "message": "This dependency already exists", "details": { } } }
```

`details` is optional and only ever contains client-safe data. Unexpected failures return `500 INTERNAL_ERROR` with a generic message and are logged server-side with their cause. Request bodies are not logged, and raw database errors (SQL, constraint names, stack traces) never reach clients. Unique violations are mapped to fixed, safe messages.

Routes that do not exist return `404 NOT_FOUND` in the same envelope.

## Implementation

`AppError` (in `apps/api/src/errors.ts`) carries `statusCode`, `code`, `message`, `details`. Subclasses: `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `InvalidStatusTransitionError` 409, `ValidationError` 400, `UnprocessableError` 422, and `GraphError` (graph engine codes). One error handler in `app.ts` turns them into the envelope.

## Code catalog (implemented)

### Generic

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Schema or shape violation, unknown field, malformed id, secret-looking metadata key |
| 400 | `BAD_REQUEST` | Other client errors (for example malformed JSON) |
| 401 | `UNAUTHORIZED` | Not authenticated |
| 403 | `FORBIDDEN` | Role lacks the permission |
| 404 | `NOT_FOUND` | Missing, or in another organization; unknown route |
| 409 | `CONFLICT` | Generic conflict |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

### Agent Registry

| Status | Code | When |
|---|---|---|
| 409 | `AGENT_NAME_CONFLICT` | Name already used in the organization |
| 409 | `AGENT_EXTERNAL_REF_CONFLICT` | External reference already used |
| 409 | `IDENTITY_CONFLICT` | Identity already registered to an agent in the organization |
| 409 | `INVALID_STATUS_TRANSITION` | Transition not in the table, no-op, missing reason, recovery reason too short |

### Dependency Registry

| Status | Code | When |
|---|---|---|
| 409 | `DEPENDENCY_EXISTS` | Same pair and type already exists (message says when it is inactive) |
| 409 | `VERSION_CONFLICT` | `expectedVersion` differs from the stored version |
| 409 | `ALREADY_INACTIVE` | Removing an inactive dependency |
| 409 | `RESOURCE_NAME_CONFLICT`, `RESOURCE_EXTERNAL_REF_CONFLICT` | Resource uniqueness |
| 422 | `ENDPOINT_NOT_FOUND` | Source or target missing or in another organization (same answer for both) |
| 422 | `RELATIONSHIP_TYPE_MISMATCH` | Endpoint types not allowed for the dependency type |
| 422 | `SELF_REFERENCE` | Source equals target |
| 422 | `MISSING_REQUIRED_METADATA` | Authority without `scope`, resource without `accessLevel` |
| 422 | `CONFIDENCE_REQUIRED` | Non-manual provenance without confidence |
| 422 | `INVALID_FRESHNESS` | Future or inverted timestamps |
| 422 | `AUTHORITY_CYCLE` | Would create a delegation cycle; `details.cycle` lists it |

### Discovery writer (returned as `outcome: "rejected"` with `reasonCode`, not as HTTP errors)

`EVIDENCE_REQUIRED`, `INVALID_CONFIDENCE`, `INVALID_FRESHNESS`, `EVIDENCE_TOO_LONG`, `AUTHORITY_REQUIRES_EXPLICIT_SOURCE`, `INACTIVE_REQUIRES_REVIEW`, plus the validation codes above.

### Graph Engine

| Status | Code | When |
|---|---|---|
| 404 | `NODE_NOT_FOUND` | Unknown node in this graph |
| 400 | `INVALID_FILTER` | Unknown filter value, bad numbers |
| 400 | `MAX_DEPTH_EXCEEDED`, `MAX_PATHS_EXCEEDED` | Requested limit above the cap |
| 500 | `GRAPH_BUILD_FAILED` | Build failed or inventory too large (generic message; cause in the server log) |
| 500 | `INVALID_GRAPH`, `CROSS_TENANT_REFERENCE` | Integrity failures that should never occur |
| – | `PATH_NOT_FOUND` | For internal callers requiring a path; the API returns 200 with `found: false` instead |

"No path" and "not reachable" are results, not errors, so they cannot be confused with a failure.

## Failure scenarios from the PRD

| Scenario | Behavior |
|---|---|
| Agent not found | 404 (also for other organizations) |
| Invalid or inconsistent dependency | 422 with a specific code |
| Circular dependency | Authority cycles rejected (`AUTHORITY_CYCLE`); operational cycles allowed and reported by the graph |
| Incomplete graph information | Invalid records are skipped and listed in the build report; limits are reported |
| Database unavailable | 500, generic; nothing is half-written because each change is one transaction |
| Unauthorized approval, partial containment, failed verification, chain or integration failure | Designed in the planned modules: never reported as success |

## Rules for new modules

1. Throw `AppError` subclasses with stable codes; never expose internals.
2. A domain result that is not a failure (no path, unchanged, rejected observation) is returned as data, not thrown.
3. Partial success is never success: return per-item outcomes and an overall status that reflects the worst case.
4. On any doubt about authorization or verification, fail closed.
5. Failed and partial work stays recorded.
