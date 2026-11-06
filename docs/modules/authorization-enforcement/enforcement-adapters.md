# Enforcement adapters and coverage

## Contract

```ts
interface EnforcementAdapter {
  name: string;
  supports(kind): boolean;
  apply(ctx): Promise<AdapterResult>;       // executed | submitted | failed
  supportsRollback(kind): boolean;
  rollback(ctx): Promise<AdapterResult>;
}
// AdapterResult: status, detail, failureReason?, externalReference?, verificationRequired[], observedAt
```

`executed` means **CORVEN's own enforcement state changed**. It is never evidence that the compromised agent can no longer act; that is Verification's job, which is why every result lists `verificationRequired` tests. An action with no adapter is stored as `unsupported` with the reason, and is not success.

## Adapters

| Adapter | Kind | Effect | Rollback |
|---|---|---|---|
| `permission` | `revoke_resource_access` | Revokes the agent's active grants on the resource; the executed action itself is an active restriction that denies any later grant | Yes: lifts the restriction. Revoked grants are **not** restored |
| `agent-status` | `suspend_agent` | Suspends the agent through the Agent Registry status service (history and audit apply; the caller's permissions apply, so a failure is recorded `failed`) | No (reactivate in the Agent Registry) |
| `credential` | `revoke_credentials` | Revokes the agent's CORVEN machine credential; issued tokens stop working at once. Other credentials are not touched | No (issue a new one) |
| *(none)* | `revoke_authority`, `block_operational_trigger` | -- | -- |
| *(not built)* | on-chain | -- | -- |

## Applying actions

`POST /enforcement/apply` (admin, `enforcement:apply`). The action needs an **approval basis**:

- `plan_approval`: `incidentId` + `planHash` where the incident is `approved` or `containing`, the hash equals the incident's **current** plan reference, and the `ApprovalVerifier` confirms an approval for that exact hash. The default verifier approves nothing, so this path is closed until the Approval Service exists.
- `admin_override`: `adminOverride: true`, an administrator, and a reason of at least 10 characters. Recorded as `admin_override`.

Refusals create no action row. `idempotencyKey` makes a retry return the original action. `EnforcementService.applyPlan` (for the future orchestrator) checks the approval once and applies each plan action under `<prefix>:<edgeId>`, so a restart continues instead of repeating. Each step is an append-only `enforcement_action_events` row: `pending -> executed | failed | unsupported`, later `rolled_back`.

`POST /enforcement/revoke` rolls back an executed, reversible action. The route names are `apply` and `revoke` as in the brief; "revoke" here means *revoke the enforcement action*.

## Coverage

| Class | Meaning |
|---|---|
| `CONTROLLED` | Resource edge (agent -> resource) where an administrator declared the resource `gateway`: all access is supposed to pass the gateway |
| `PARTIALLY_CONTROLLED` | Resource declared `advisory`: access outside the gateway is not controlled |
| `UNKNOWN` | Resource edge with no declaration |
| `NOT_CONTROLLED` | Authority and operational edges: no enforcement point exists |

Declarations: `PUT /gateway/resources/:id/enforcement {mode}` (admin). CORVEN cannot discover bypass routes; the declaration is a statement by a person and the report says so. The limitations list is part of the response.

`toContainmentCoverage(report)` produces `{uncontrollableEdgeIds (NOT_CONTROLLED + UNKNOWN), edgeCosts (partial = 2)}` for the Containment Engine; tested end to end (an uncontrollable cut makes the plan infeasible with that edge as the blocker).

## Writing a real adapter later

Implement the interface, report `submitted` until the external system confirms, supply `externalReference`, and list the checks Verification must run. Register it through `extraAdapters`.
