# Incident Management (index)

**Status: implemented and tested.** Documentation: [incident-management/](incident-management/README.md).

| Document | Contents |
|---|---|
| [incident-management/README.md](incident-management/README.md) | Purpose, scope, what it does not do |
| [incident-management/architecture.md](incident-management/architecture.md) | Components, analysis references, transactions |
| [incident-management/lifecycle.md](incident-management/lifecycle.md) | State machine and guards |
| [incident-management/data-model.md](incident-management/data-model.md) | Tables and constraints |
| [incident-management/api.md](incident-management/api.md) | Endpoints and error codes |
| [incident-management/events.md](incident-management/events.md) | Timeline and the contract for later modules |
| [incident-management/security.md](incident-management/security.md) | Trust boundaries, threats, limitations |
| [incident-management/testing.md](incident-management/testing.md) | Test strategy |

Summary: Incident Management records a security incident, links it to agents and resources, pins the graph snapshot, blast-radius analysis and containment plan used (as verifiable references), enforces a deterministic lifecycle, and keeps an append-only timeline and audit trail. It does not approve, enforce or verify anything; the states that claim those outcomes can only be set by trusted internal modules, which do not exist yet.
