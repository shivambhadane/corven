# Incident-Response Orchestration

**Status: implemented and tested.** Code: `apps/api/src/modules/orchestrator`. Tested against the real modules and database; the pg-boss ticker is tested against the real queue with a stand-in orchestrator.

## Purpose

Connect Incident Management, the Gateway, Approval, Verification and Evidence into one durable workflow, so a trusted detection signal becomes: analysed -> approval requested -> **a person decides** -> enforced -> verified -> evidence sealed and anchored, without a long-running function and without anyone calling each step by hand.

## What it will never do

- **Approve.** It requests approval and waits. Rejection, expiry, cancellation or invalidation end the workflow (`stopped`); a person decides what happens next.
- **Claim containment.** Only a fully passed Verification run moves an incident to `contained`. A failed or partial result is carried through to evidence as exactly that.
- **Enforce an unapproved or altered plan.** The Gateway re-verifies the approval and the plan before each action.

## Documents

| Document | Contents |
|---|---|
| [workflow.md](workflow.md) | State derivation, steps, outcomes, leases, retries, restarts |
| [phase2-architecture.md](phase2-architecture.md) | How all five modules fit together, with diagrams |
| [events.md](events.md) | Event contracts across modules |
| [api.md](api.md) | Endpoints and operations |
| [testing.md](testing.md) | End-to-end and failure scenarios |
