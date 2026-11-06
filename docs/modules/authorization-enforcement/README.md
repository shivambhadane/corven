# Authorization & Enforcement Gateway

**Status: implemented and tested** (code: `apps/api/src/modules/authorization-gateway`). Human authentication is still the development-only adapter; **agent** authentication is real (see [authentication.md](authentication.md)). Resource executors are **simulated only**: CORVEN does not yet proxy calls to a real external API.

## Purpose

The controlled execution boundary for agent operations and the place where containment is enforced. An agent presents a short-lived machine token; the gateway decides from CORVEN's own current state whether the operation is allowed, re-checks immediately before touching the resource, and records what happened. Containment actions are applied through enforcement adapters that report honestly what they changed.

## What is real and what is not

| Piece | State |
|---|---|
| Per-agent machine credentials (hashed), rotation, revocation, short-lived HS256 tokens | Real |
| Deny-by-default policy over PostgreSQL grants, agent status, containment restrictions | Real |
| Pre-check and re-check around execution, at-most-once per request id, fail-closed | Real |
| Enforcement adapters: permission revocation + restriction, agent suspension (via Agent Registry), CORVEN credential revocation | Real, but they control only CORVEN-owned state |
| Resource executors | **Simulated** (`SimulatedExecutor`) or caller-supplied; none talks to an external system |
| On-chain enforcement adapter | **Not built** |
| Authority (delegation) and operational (agent-to-agent) edges | **No enforcement point**: reported `NOT_CONTROLLED`, actions recorded `unsupported` |
| Approval verification | Implemented by the Approval Service (`isPlanApproved`); without it the default approves nothing |
| Revoking independent credentials (wallet keys, API keys, DB passwords) | **Not possible**; every adapter result says so |

## Documents

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | Components, request flow, in-flight recheck, trust boundaries |
| [authentication.md](authentication.md) | Credentials, tokens, rotation, revocation |
| [authorization.md](authorization.md) | Policy rules, reason codes, constraints, permission source of truth |
| [enforcement-adapters.md](enforcement-adapters.md) | Adapter contract, adapters, coverage, approval basis |
| [data-model.md](data-model.md) | Tables and guards |
| [api.md](api.md) | Endpoints and errors |
| [events.md](events.md) | Records and what is (not yet) published |
| [security.md](security.md) | Threats, mitigations, limitations |
| [testing.md](testing.md) | Test strategy and results |
