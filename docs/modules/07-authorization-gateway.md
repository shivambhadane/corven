# Authorization and Enforcement Gateway (index)

**Status: implemented and tested** with the limits below. Documentation: [authorization-enforcement/](authorization-enforcement/README.md).

Implemented: per-agent machine credentials with rotation and revocation, short-lived signed tokens, a deny-by-default policy evaluator over PostgreSQL, a pre-check/re-check/execute boundary that is at-most-once and fails closed, enforcement adapters for permissions, agent suspension and CORVEN credentials, coverage reporting that feeds the Containment Engine.

Not implemented: real external resource executors (simulated only), an on-chain adapter, enforcement of delegation and agent-to-agent edges, mTLS, rate limiting, and the Approval Service that the plan-approval path depends on.

Earlier design decisions: the gateway runs in-process; PostgreSQL is the permission source of truth; agents authenticate with machine tokens (not wallet signatures or Firebase).
