# Authorization and Enforcement Gateway

**Status: planned (design).** None of this is implemented. Several decisions are open; they are marked **Decision needed**.

## Purpose

Be the controlled execution boundary where authorization is checked and containment is enforced. A containment plan only has effect where an enforcement point exists; the gateway is where those points live.

## Responsibilities

- Receive an operation request, identify the requesting agent, check its **current** authorization and status, reject what is not permitted, and record the result.
- **Recheck authorization at execution time** for in-flight operations, so a revocation takes effect on work already started.
- Execute approved containment actions through enforcement adapters.
- Report which edges are controllable (enforcement coverage), which the Containment Engine needs.
- Emit runtime evidence (attempted, denied, allowed, succeeded, failed) for discovery and for the evidence trail.

CORVEN **cannot** revoke independent credentials or permissions that do not pass through its enforcement mechanisms. Registering an agent or an ENS name does not revoke wallet, API or database permissions.

## Decisions needed

| # | Decision | Options | Notes |
|---|---|---|---|
| 1 | Where does the gateway run? | Inside the API process, or a separately reachable enforcement point agents call | A separate point is a cleaner trust boundary; in-process is simpler for the MVP |
| 2 | What is the permission source of truth the gateway checks? | PostgreSQL, the on-chain contracts, or PostgreSQL mirrored to chain | The PRD describes both; a mismatch means a revoked permission could still be honoured |
| 3 | How do agents authenticate to the gateway? | Signed requests, service tokens, wallet signatures | Must be decided before runtime evidence can be trusted |

## Components

| Component | Role |
|---|---|
| Request intake | Authenticates the agent, validates the operation |
| Policy evaluator | Deterministic decision from agent status, permission state and policy; deny by default |
| Enforcement adapters | Apply and revoke: agent adapter (suspend, block routes), credential adapter (revoke or scope grants CORVEN controls), on-chain adapter (via the Ethereum adapter) |
| Recorder | Writes every outcome |

## Enforcement result model

Per action: `submitted`, `executed`, `failed` with a reason. For on-chain actions, "submitted" becomes "executed" only after the transaction is confirmed. An enforcement failure is never reported as containment.

## Rules

1. Fail closed: if the policy store, authenticator or an adapter is unavailable, the operation is denied and the incident is not marked contained.
2. A `suspended` or `compromised` agent's operations are denied.
3. Capabilities registered in the Agent Registry are descriptive. They are an input to policy, never a grant on their own.
4. Revocation granularity follows the plan: block this agent's access, not the shared resource for everyone.
5. Every decision is recorded with agent, operation, outcome and reason, and carries the incident id when relevant.

## Planned interfaces

```ts
interface EnforcementPoint {
  coverage(organizationId: string): Promise<ControllableEdge[]>;
  apply(action: ContainmentAction): Promise<ActionResult>;
  revoke(action: ContainmentAction): Promise<ActionResult>;
  check(agentId: string, operation: Operation): Promise<Decision>;
}
```

## Planned data

Permission state (location depends on decision 2), `execution_records` (per action: plan id, action id, status, reason, transaction reference, timestamps), gateway decision log.

## Errors

`OPERATION_DENIED` 403; `ENFORCEMENT_UNAVAILABLE` 503 (denies); `ACTION_FAILED` and `ACTION_PARTIAL` carried in execution results.

## Tests to write

Allowed and denied operations; status-based denial; revoke then in-flight recheck; fail-closed on each dependency outage; adapter failure leaves the incident uncontained; coverage report matches adapters; tenant isolation.

## Interaction with existing modules

Reads agent status and capabilities through `AgentRegistryReader`. Dependencies are context for planning, not enforcement: operational and authority edges in the registry do not by themselves permit any operation.
