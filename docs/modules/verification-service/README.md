# Verification Service

**Status: implemented and tested.** Code: `apps/api/src/modules/verification-service`. Probes against real external resources depend on resource executors, which are **simulated** today.

## Purpose

Establish, independently of what enforcement reported, whether containment worked: the compromised agent can no longer do what it could, the cut really separates it from the protected resources, and healthy agents can still do their work. Only a run in which every check passed moves an incident to `contained`.

## Principles

- **Observe, do not trust.** Checks evaluate the live gateway decision for the agent's *current* identity state, read permissions and enforcement rows directly, and recompute reachability on the pinned graph. They do not reuse enforcement's own result.
- **Never destructive.** Nothing is executed. Healthy paths are observed through the resource executor's optional, non-destructive `probe`.
- **Honest results.** Every check is `passed`, `failed` or `inconclusive`. Anything that could not be observed is inconclusive, and an inconclusive or partial run is never reported as full containment.

## Documents

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | Components, run flow, incident mapping, retries and recovery |
| [verification-model.md](verification-model.md) | Run statuses, aggregation rules, evidence hash |
| [test-types.md](test-types.md) | The six check categories and how each is derived |
| [api.md](api.md) | Endpoints and errors |
| [testing.md](testing.md) | Tests and results |
