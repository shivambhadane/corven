# Event Flow

## Today: no event bus

The system is synchronous. There are no queues, jobs or published events yet. What exists is **transactional recording**: every state change writes its record in the same database transaction, so the history is the event log.

| Change | Records written in the same transaction |
|---|---|
| Agent registered | agent, initial status history row, audit row |
| Agent status changed | status update, status history row, audit row |
| Dependency created | dependency, version 1, audit row (and evidence when created by the discovery writer) |
| Dependency updated, activated, deactivated, removed | row update, version row, audit row |
| Discovery writer observation | evidence rows appended; `last_verified_at` moved forward without a version |

Failures roll everything back (tested by injecting failures into the audit, version and evidence writes).

## Planned: background processing and events

_Note: Phase 2 modules (incidents, gateway, approval, verification, evidence) are implemented. They record their facts synchronously in their own tables and on the incident timeline; there is still no event bus or outbox._

Discovery and integration retries run as pg-boss jobs over PostgreSQL. Suggested internal events:

```text
discovery.run.requested        discovery.run.started
discovery.observation.collected  discovery.observation.normalized
discovery.observation.resolved   discovery.observation.rejected
discovery.reconciliation.completed  discovery.review.required
discovery.run.completed
dependency.created  dependency.updated  dependency.deactivated
incident.opened  incident.transitioned  plan.proposed  approval.decided
action.executed  verification.completed  evidence.appended
```

## Requirements for the event layer

- **Persist before publishing:** run state is saved before work is queued. Use a transactional outbox where a database change must reliably enqueue a job.
- **Idempotent jobs:** a retry must not duplicate evidence or dependencies. The existing idempotency mechanisms (unique evidence index, idempotent `createOrUpdate`) are designed for this.
- **Retry transient failures; record permanent ones.**
- **Isolation:** organization and run identifiers travel with every message.
- **Never deactivate on failure:** a failed or stale source must not change dependency state. Missing observations are recorded, not acted on.
- **Duplicate runtime events** (same event id) are ignored.

## Ordering and consistency

Per-dependency changes serialize on the row lock. Authority-edge changes serialize per organization on an advisory lock, so two concurrent requests cannot jointly create a cycle. Incident transitions will serialize on the incident row.

## Sequence diagrams

See [architecture/07-incident-sequence-diagrams.md](../architecture/07-incident-sequence-diagrams.md).
