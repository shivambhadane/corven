# Blast-Radius Engine

**Status: planned (design).** Builds directly on the implemented Graph Engine; no new storage is required beyond persisting results with an incident.

## Purpose

Given a graph and a compromised agent, say what that agent can affect, through which relationships, and how sure we are. It classifies entities and explains each classification with a path. It does not decide what to do about them.

## Inputs and outputs

Input: an immutable `Graph` (from the Graph Engine; for an incident, the pinned snapshot), the source agent node, and options (confidence threshold, freshness window).
Output: for every node, a classification plus the explaining paths.

| Class | Meaning |
|---|---|
| `compromised` | The source agent |
| `exposed` | Reachable through authority or resource dependencies: the compromised agent can use or direct it |
| `potentially_affected` | Reachable only through operational dependencies: it may be triggered or disrupted |
| `healthy` | Not reachable from the source under any dependency type |
| `uncertain` | Reached only through low-confidence or stale edges, or adjacent to a known coverage gap |

Each exposure has a **kind**: authority exposure, resource exposure or operational impact, taken from the edge types on its path. The three are never merged.

## Proposed rules (MVP)

1. Traverse **forward** from the source over active edges.
2. `authority` edges: agents the source delegates to are `exposed` (the source can direct them).
3. `resource` edges: the resource is `exposed`. Agents reached by authority edges then extend to their own resource edges.
4. `operational` edges: reached nodes are `potentially_affected` unless already `exposed`.
5. A node reached only through edges below the confidence threshold, or whose edges were not verified within the freshness window, is `uncertain`, not `exposed`.
6. **Shared resources:** for each exposed resource, also list its *other* dependents. They are not compromised, but they depend on something that is. This list is the input the containment engine needs to avoid breaking them.
7. Every classified node carries the shortest path (edge ids) from the source, plus up to N alternative paths, using the existing bounded path functions.

## Open design questions

| Question | Default until decided |
|---|---|
| **Inherited authority.** If the source *holds* authority delegated by Support, resources Support can reach within that scope may be exposed too | Mark the delegators `uncertain`; do not mark their resources `exposed`. Needs a scope model beyond `metadata.scope` |
| Should `inactive` edges ever count? | No, but show them as context |
| Confidence threshold and freshness window | Configurable per organization; no value is claimed to be calibrated |
| Unknown or uninstrumented dependencies | Reported as a coverage gap; requires discovery coverage data |

## What it must say honestly

- Reachability is structural. `exposed` does not mean the attacker used it or can exploit it.
- The result is only as complete as the registered dependencies. A dependency CORVEN never learned about is invisible.
- Every result states the graph snapshot, the filters, the thresholds and whether any search was truncated.

## Interface

```ts
interface BlastRadiusService {
  analyze(graph: Graph, sourceNodeId: string, options?: AnalysisOptions): BlastRadiusResult;
}
```

Pure function over the graph: no database, no Fastify. Deterministic for identical input.

## Planned API

`POST /api/v1/incidents/:id/analyze` stores the result with the incident. A standalone read-only `GET /api/v1/graph/blast-radius?sourceNodeId=…` is optional for exploration.

## Tests to write

Each class on small hand-built graphs; shared resource dependents listed; operational-only reach is `potentially_affected`; low-confidence edges give `uncertain`; cycles terminate; determinism; the Acme demo graph from [project/04-demo-script.md](../project/04-demo-script.md) as a golden test.
