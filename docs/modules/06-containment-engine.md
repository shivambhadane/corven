# Containment Engine

**Status: planned (design).** This is CORVEN's central technical capability and the riskiest module. The algorithm below is a **proposal for review**, chosen to be exactly solvable and explainable. It is not implemented.

## Purpose

Find the smallest-cost set of authorization changes that blocks every attack path from the compromised agent to the protected entities, while keeping healthy workflows working. Report honestly when that is impossible or uncertain.

## Inputs

| Input | Source |
|---|---|
| Graph (the incident's pinned snapshot) | Graph Engine |
| Blast-radius result | Blast-Radius Engine |
| Compromised agent(s) | Incident |
| Protected entities (resources or agents that must become unreachable) | Operator / policy |
| Healthy workflows to preserve | Operator / policy (required relationships) |
| Enforcement points: which edges CORVEN can actually revoke, and at what cost | Authorization Gateway coverage |
| Cost or impact weights; approval thresholds | Policy |

## Output

An ordered, explained plan: proposed actions (each: which edge or node, which kind of revocation, cost, the attack paths it blocks, why it was chosen), preserved workflows, protected entities and their blocked status in the model, uncertain dependencies, approval requirements, and a **feasibility status**.

## Problem formulation

Restrict to the subgraph reachable from the source. Build a flow network:

- **Source** `s` = compromised agent (a super-source if several).
- **Sink** `t*` = a super-sink with infinite-capacity edges from every protected entity.
- **Edge capacity:**
  - controllable edge (an enforcement point exists): its revocation cost (default 1; higher for shared or high-impact);
  - **uncontrollable** edge (CORVEN cannot revoke it): ∞;
  - edge on a **preserved workflow path:** ∞.
- **Node capacity** (to model suspending an agent): split the node into in and out with the cost of suspension between them.

A minimum `s–t` cut is then a minimum-cost set of controllable edges whose removal disconnects the source from every protected entity without touching an uncontrollable or preserved edge. Maximum flow gives it exactly in polynomial time (Dinic: O(V²E) worst case, fast in practice at the 1,000-node / 5,000-edge target).

**If the minimum cut has infinite value**, no safe containment exists in the model. The engine returns `infeasible`, with the blocking edges (the uncontrollable or preserved edges on every cheapest path), instead of presenting a weaker plan as success.

## Determinism

Equal inputs must give equal plans. Costs are integers, adjacency is sorted by id, and among all minimum cuts the engine always returns the one with the **smallest source side** (the nodes reachable from `s` in the residual graph after max flow). That cut is unique, independent of which max flow was found, and it prefers cutting close to the compromised agent, which matches the rule "prefer agent-specific permissions over shared ones".

## Preserving healthy workflows: sound, not always complete

A workflow is given as a required relationship (node A must still reach node B) or as explicit edges. Keeping *connectivity* for several pairs while cutting others is NP-hard in general. The proposal is conservative:

1. For each healthy workflow, pick one admissible path (shortest, by the graph engine) and set its edges to ∞.
2. Solve the min cut.
3. **Re-verify in the model:** remove the cut edges and check, with the graph engine, that the source reaches no protected entity and every workflow pair is still reachable. If a check fails, the plan is rejected rather than reported.

This is **sound** (a returned plan satisfies its constraints in the modelled graph) but not **complete** (a feasible plan may be missed if a different workflow path would have worked). `infeasible` therefore means "not found with these preserved paths", and the result says which paths were fixed. An exact formulation (integer programming) is the documented fallback if the conservative one proves too restrictive.

## Rules from the PRD that the engine must keep

- A shared resource is never revoked globally if only one agent's access needs blocking: edges are cut per dependent, and the shared resource's other dependents are protected by ∞ capacity on their preserved edges.
- Agent-specific permissions are preferred (closest-to-source cut, plus lower cost for agent-specific edges).
- Healthy workflows are constraints, not afterthoughts.
- In-flight operations must recheck authorization at the execution boundary (Gateway); the plan is not the only line of defence.
- High-impact or uncertain changes require approval; uncertain dependencies are reported, never silently assumed absent.
- Impossible or uncertain containment is reported as such.

## Approval triggers

A plan requires human approval if any action touches a shared resource, exceeds a cost threshold, depends on an edge below the confidence threshold or past the freshness window, affects a high-value resource, or the solution is not unique in cost.

## Plan states

`planned` → `approved` → `submitted` → `executed` → `verified`. This module produces only `planned`. The others are produced by Approval, the Gateway and Verification.

## Interface

```ts
interface ContainmentPlanner {
  plan(input: ContainmentInput): ContainmentPlan; // pure and deterministic
}
```

Pure function: no database, no Fastify, no chain. The graph primitives (BFS, paths, reachability) already exist; the max-flow routine is new, as a pure module with its own tests.

## Planned tables

`containment_plans` (version, plan hash, feasibility, inputs reference), `containment_actions` (kind, edge or node, cost, explanation, preserved/blocked paths).

## Tests to write

Hand-built graphs with known minimum cuts; the Acme scenario (cut only Payment's own grants; keep Support and Database access to the shared API); infeasible case (the only route uses a preserved edge); uncontrollable edges; multiple sources; ties (stable choice); determinism under input reordering; re-verification catches a deliberately broken plan; a property test comparing against brute force on small random graphs; performance at 1,000 nodes / 5,000 edges.

## Open questions

- How are healthy workflows entered: explicit edge lists, or "A must reach B" requirements?
- Cost model: flat cost 1, per-edge weights, or impact scores?
- Which entities are protected by default?
- Do we need the exact (integer programming) formulation, or is the conservative one enough?
