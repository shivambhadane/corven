# Incident Management

**Status: implemented and tested.** Code: `apps/api/src/modules/incident-management`. Human authentication is still the development-only adapter (Firebase is not implemented).

## Purpose

The lifecycle coordinator for security incidents. It records a signal, ties it to the agents and resources involved, pins the exact graph snapshot, blast-radius analysis and containment plan used, tracks a deterministic lifecycle, and keeps an append-only timeline and audit trail.

## What it deliberately does not do

- It does not authorize operations, approve plans, execute containment or verify anything. Those belong to the Gateway, Approval, Verification and Evidence modules, none of which exist yet.
- It never changes an agent's status. Associating an agent with an incident is a record; suspending or marking an agent compromised is a separate Agent Registry action.
- It never claims containment. The states that assert approval, enforcement, verification and containment (`approved`, `rejected`, `containing`, `verifying`, `contained`, `partially_contained`, `containment_failed`) can only be entered by the internal `system` principal, which no HTTP request can obtain. Until those modules exist nothing can move an incident past `awaiting_approval` except tests that act as `system`.

## Documents

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | Components, flows, integration boundaries, why no background jobs |
| [lifecycle.md](lifecycle.md) | State machine, transition rules, guards, who may do what |
| [data-model.md](data-model.md) | Tables, constraints, append-only enforcement |
| [api.md](api.md) | Endpoint reference and error codes |
| [events.md](events.md) | Timeline event contract and the interface for later modules |
| [security.md](security.md) | Trust boundaries, tenant isolation, threats |
| [testing.md](testing.md) | Test strategy and what is covered |

## Naming

The brief lists states and severities in upper case (`AWAITING_APPROVAL`). The codebase uses lower-case enums everywhere, so the stored and API values are lower case (`awaiting_approval`). The mapping is one-to-one.

## Known limitations

See the end of [security.md](security.md). The main ones: no user or membership model (assignees are validated only as UUIDs), no automatic signal ingestion transport, and attached analysis is stored as a verifiable reference rather than a full result.
