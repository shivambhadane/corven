# Check categories

| Category | Purpose | Derived from | Passes when | Otherwise |
|---|---|---|---|---|
| `PERMISSION_PERSISTENCE_TEST` | security | each `revoke_resource_access` action in the approved plan | its enforcement action is `executed` and no active grant exists for the pair | failed: `no_enforcement_action`, `action_<status>`, or `grants_active` (a re-grant after containment) |
| `NEGATIVE_ACCESS_TEST` | security | every action a compromised agent was ever granted on a protected resource, plus `maliciousChecks` | the live gateway decision for the agent's current state is **deny** | failed when allowed; inconclusive on a probe error |
| `PATH_BLOCK_TEST` | security | the pinned snapshot graph | with the actually executed cut edges removed, no source reaches a protected resource | failed, listing what is still reachable and which actions were not executed |
| `BYPASS_RESISTANCE_TEST` | security | each protected resource | the resource is declared gateway-only | inconclusive: CORVEN cannot test routes outside the gateway |
| `POSITIVE_ACCESS_TEST` | continuity | every active grant of a non-compromised agent on a protected resource, plus `healthyChecks` | allowed **and** the resource's non-destructive probe answered | failed when denied or unreachable; inconclusive when the executor cannot be probed or the probe errors |
| `RESOURCE_HEALTH_TEST` | continuity | each protected resource with healthy dependents | at least one healthy probe reached it | failed |

## What the probe is

`GatewayService.probe(org, agent, {resource, action})` runs the same decision path as a real operation, using the agent's **current** credential state (not a token it holds), records the decision, and if allowed calls the executor's optional `probe()`. Executors must implement `probe` without side effects. Nothing is executed.

## Limits

- Healthy-path observation is only as real as the executor; today's executors are simulated.
- Negative tests show what the gateway would allow. They cannot show what an agent can do outside CORVEN's boundary (stated in the bypass checks).
- Path blocking is structural and covers only registered dependencies.
- An agent with no CORVEN credential is denied by the gateway; the check says so instead of claiming the agent is contained elsewhere.
