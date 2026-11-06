# Dependency Discovery

**Status: implemented and tested.** Code: `apps/api/src/modules/dependency-discovery`. Authentication is still the development-only adapter.

## Purpose

Find dependencies between agents and resources from the places they are already declared or observed, and submit them to the Dependency Registry **with evidence**, so the graph does not depend on someone typing every edge by hand.

## The rule that shapes everything

Discovery proposes; the registry decides. Discovery never writes to registry tables directly. It calls `DependencyRegistryWriter.createOrUpdate`, which applies all registry rules, versioning and audit. Discovery also never creates `authority` edges: delegation cannot be inferred from configuration or traffic, so a human records it.

## Pipeline

`collect -> normalize -> resolve -> reconcile -> apply (or hold for review)`

| Stage | Behaviour |
|---|---|
| Collect (adapters) | Read a source and return raw records. Adapters only collect; they do not interpret |
| Normalize | Explicit mapping of a record to a proposed relationship. A malformed record becomes a `rejected` observation with a reason; the rest of the run continues |
| Resolve | Match references to registered entities: external reference, then id, then name. Ambiguous or unknown references stay `unresolved`. **Discovery never creates agents or resources** |
| Reconcile | Compare with the registry (below) |
| Apply | Submit auto-accepted proposals through the registry writer, with evidence |

### Sources and confidence

| Source type | Produces | Relationship | Confidence |
|---|---|---|---|
| `workflow_definition` | consecutive steps -> operational | `triggers` | 0.95 |
| `agent_configuration` | tool with `targetAgent` -> operational; tool with a resource -> resource (`accessLevel` defaults to `unknown`) | `invokes`, `accesses` | 0.90 |
| `runtime_gateway` | events ingested over the API, consumed once per run | `calls` | 0.85 (allowed/completed), 0.65 (attempted/denied) |

Confidence values are policy constants, not calibrated probabilities. Proposals at or above **0.8** are applied automatically; lower ones wait for a human.

### Reconciliation outcomes

| Outcome | Meaning | Automatic? |
|---|---|---|
| `new` | No matching dependency | If confidence ≥ 0.8 |
| `unchanged` | Matches an active dependency | Yes: only evidence is appended |
| `modified` | The source states metadata that differs from a discovered dependency | If confidence ≥ 0.8 |
| `conflicting` | The dependency is inactive, differs from a **manual** one, or two proposals in one run state different values for the same key | Never; review required |
| `missing` | A scanning source stopped reporting a relationship | Recorded only. **Nothing is deactivated** |
| `stale` | The source has not been scanned successfully within its freshness window | Recorded only |
| `unresolved` | An endpoint could not be resolved | Never creates anything |

The relationship **label** is not compared, because different sources name the same dependency differently. Only metadata keys a source actually states count as a difference, so a silent source never wipes data. The registry still raises a dependency's confidence to the strongest evidence, which is a new version.

### Safety properties

- A failed or cancelled run never deactivates or alters anything.
- One active run per source (partial unique index); `RUN_IN_PROGRESS` otherwise.
- Runs are resumable: a retry finishes unprocessed observations and does not duplicate evidence (same run id, source reference).
- Runtime events are deduplicated per source by `eventId`; secret-looking fields are redacted and payloads size-limited before storage.
- Evidence `sourceReference` convention: `src:<sourceId>/<reference>`.
- Registry changes made by discovery are attributed to the internal discovery actor in version history.

## Jobs

Runs execute in the background. The run row is written first, then queued, so a lost job leaves a visible `pending` run. Production uses **pg-boss** on the same PostgreSQL (queue `discovery.run`, 3 retries with backoff); `DISCOVERY_QUEUE=inline` uses an in-process queue for local use and tests.

## API (`/api/v1/discovery`)

| Method | Path | Permission |
|---|---|---|
| POST | `/sources` | `discovery:write` |
| GET | `/sources`, `/sources/:id` | `discovery:read` |
| PATCH | `/sources/:id` | `discovery:write` (name, enabled, configuration) |
| POST | `/sources/:id/events` | `discovery:ingest` (runtime sources only, ≤500 events) |
| POST | `/sources/:id/runs` | `discovery:run` (202) |
| GET | `/runs`, `/runs/:id` | `discovery:read` |
| POST | `/runs/:id/cancel` | `discovery:run` |
| GET | `/runs/:id/observations`, `/runs/:id/results`, `/observations/:id` | `discovery:read` |
| POST | `/observations/:id/review` | `discovery:review`. `decision` approve, reject (reason required) or defer |
| GET | `/coverage` | `discovery:read`. Per-source freshness; states that absence of a relationship is not proof |

Errors: `SOURCE_NAME_CONFLICT`, `SOURCE_DISABLED`, `SOURCE_TYPE_MISMATCH`, `RUN_IN_PROGRESS`, `RUN_NOT_CANCELLABLE` (409), `OBSERVATION_NOT_REVIEWABLE` (409), `INACTIVE_REQUIRES_REVIEW`, `REGISTRY_REJECTED`.

## Data

Migrations `0008_dependency_discovery` and `0009_discovery_append_only`: `discovery_sources`, `discovery_runs`, `discovery_observations`, `discovery_reconciliation_results`, `discovery_reviews`, `discovery_runtime_events`. Reconciliation results and reviews are append-only (SQLSTATE 23001).

## Limitations

- Only three source types; no live crawling of external systems. Config and workflow documents are supplied inline in the source configuration.
- **Runtime events are not authenticated as coming from a gateway.** `discovery:ingest` is granted to human roles today. Event authenticity needs the Authorization Gateway (threat T19).
- Discovery sees only what a source declares or reports. Absence is not evidence of absence.
- No scheduling: runs are started by API call.
- Confidence and the 0.8 auto-accept threshold are policy values.

## Tests

`discovery-core.test.ts` (pure stages), `discovery-pipeline.test.ts` (end-to-end through the API incl. review, conflicts, missing, stale, failure, resumability, tenancy), `discovery-pgboss.test.ts` (real queue delivery and retry).
