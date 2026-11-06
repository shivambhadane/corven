# Workflow

## Durable by design

`incident_workflows` has one row per incident, and the row is the work item: `status`, `step`, `next_run_at`, `lease_until`, `attempts`, `last_error`. There is no in-memory coordination. `POST` of a signal and the start of a workflow are database writes; workers find due rows.

**Each run derives the next action from the real state** (incident status, approval, enforcement actions, verification runs, evidence), not from the `step` field, which is informational. Consequently a duplicate delivery, a retry or a restart repeats nothing: every write either has an idempotency key (`workflow:<id>:planned`, `wf-<id>:<edgeId>`, `workflow:<id>:verify:<n>`) or checks first.

## What a run does, by incident status

| Incident status | Action |
|---|---|
| `detected` | -> `investigating` |
| `investigating` | Attach a snapshot, blast radius, and a containment plan built with the Gateway's **coverage report** (edges CORVEN cannot enforce are excluded from cuts). Plan not `feasible` -> workflow `blocked` (`plan_infeasible`, ...). Otherwise -> `containment_planned`. If an approval was already requested earlier, the workflow `stopped` instead of replanning: a person decides |
| `containment_planned` | Request approval (as the system), then wait |
| `awaiting_approval` | Wait; each check also runs the approval expiry/reconciliation sweep |
| `rejected` | `stopped` (`approval_rejected`) |
| `approved` | -> `containing` |
| `containing` | Apply the approved plan through the Gateway (idempotent per action; failures are recorded, not hidden), then start verification |
| `verifying` | A run in progress: wait. Last run inconclusive: retry (at most 3 attempts, then `blocked` `verification_inconclusive`) |
| `contained`, `partially_contained`, `containment_failed` | Generate evidence once, try to anchor (best effort, never changes the outcome), `completed` with the incident status as outcome |
| `resolved`, `closed` | `completed` |
| `false_positive` | `stopped` |

Blocking reasons seen by a person: `no_compromised_agents`, `plan_infeasible`, `plan_not_reproducible`, `approval_no_longer_valid`, `verification_inconclusive`, `returned_to_investigation`, `approval_rejected`.

## Statuses

`running` and `waiting` are live; `completed`, `stopped`, `blocked`, `failed`, `cancelled` are terminal. A person can **retry** a failed, blocked or stopped workflow after fixing the cause, or **cancel** a live one.

## Leases, retries, restarts

- A worker claims due workflows with `UPDATE ... FOR UPDATE SKIP LOCKED`, setting `lease_until` (2 minutes). Others skip a leased workflow. A crashed worker's lease simply expires and the next worker continues (tested).
- A step that throws schedules a retry with exponential backoff (5 s, 10 s, ... capped at 5 min), up to 5 attempts, then `failed` / `retries_exhausted`. Every retry and the final failure are in the append-only `workflow_events` log with the error.
- A run does at most 12 steps, then yields to the next tick.
- Restart in the middle of enforcement is covered by the per-action idempotency keys: tested by enforcing part of the plan "in a previous worker", then running the workflow.

## Background upkeep (`maintenance()`)

Approval expiry and incident reconciliation; closing verification runs a crash left `pending`/`running` (they become `inconclusive`, "interrupted", which unblocks a retry); polling Ethereum confirmations for submitted anchors.

## The pg-boss ticker

`PgBossTicker` registers a recurring job (every minute) and a `nudge()`; its worker calls `maintenance()` then `tick()`. pg-boss only wakes the orchestrator: a lost or duplicated wake-up is harmless, because the state is in the tables. It starts with the server unless `ORCHESTRATOR_TICKER=off`. Redis and other queues are not used.

## Limits

- Latency: a person's approval is noticed on the next tick (up to a minute) unless `POST /workflows/:id/run` is called. Approvals do not yet nudge the ticker automatically.
- A crash during a verification run leaves a `running` row until maintenance closes it (10 minutes).
- One workflow per incident; replanning after a rejection needs a person to retry it.
