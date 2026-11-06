# Incident Management: testing

Run: `pnpm --filter @corven/api test`. Tests use a real PostgreSQL (throwaway database per run).

| File | Focus |
|---|---|
| `test/incident-core.test.ts` (20 tests) | State machine properties, system-only transitions, invariants, secret guard, correlation ids |
| `test/incident-api.test.ts` (46 tests) | Creation and validation, atomicity and rollback, signal idempotency and concurrency, update and audit, filtering and pagination, full lifecycle by humans and `system`, failed and partial containment, plan guards, close and admin reopen, concurrent transitions, idempotent internal transitions, associations, assignment, notes, snapshot / blast-radius / plan references and reproducibility, tamper detection, plan lock, external events, tenant isolation, role enforcement, append-only triggers, error hygiene |
| `test/migrations.test.ts` | Up, down and re-up for migrations 0010 and 0011 |

The suite also drives a compromised-agent scenario against the real Graph, Snapshot, Blast-Radius and Containment services (no mocks of Phase 1).

## One change to an existing test

`test/graph-snapshot.test.ts` asserted that `TRUNCATE graph_snapshots` fails with the trigger's code 23001. Incident analysis references now point at snapshots by foreign key, so PostgreSQL refuses the truncate first with `0A000`. The assertion now accepts either code, with a comment; every other assertion is unchanged.

## Result at the time of writing

Full suite: 568 tests passing in 37 files; `tsc --noEmit` and ESLint clean.

## Not covered

No load test for incident listing at large volumes; no test with real human authentication (not implemented); the external-event interface is exercised only by in-process callers because no real producer exists yet.
