# Use Cases

## Actors

| Actor | Description | Needs |
|---|---|---|
| Security operator | Security engineer or infrastructure operator responding to incidents | Understand impact, approve containment, avoid downtime |
| Agent owner / platform developer | Registers agents, resources and dependencies | A reliable, low-friction registry |
| Auditor | Reviews what happened | Independently verifiable history |
| Discovery pipeline (internal) | Automated collector of dependency evidence | A safe write path into the registry |
| Monitored agents | The agents CORVEN protects | Healthy workflows keep running |

## Status legend

**Built** = implemented and tested. **Planned** = designed only. **Partial** = some parts built.

## Use cases

| ID | Use case | Actor | Status | Module |
|---|---|---|---|---|
| UC-01 | Register an agent with capabilities, identities and an external reference | Owner | Built | Agent Registry |
| UC-02 | Change an agent's lifecycle status; recover a compromised agent under admin control | Operator, admin | Built | Agent Registry |
| UC-03 | Register a resource shared by several agents | Owner | Built | Dependency Registry |
| UC-04 | Record a typed dependency (authority, resource, operational) with provenance and confidence | Owner | Built | Dependency Registry |
| UC-05 | See a dependency's full version history and supporting evidence | Operator, auditor | Built | Dependency Registry |
| UC-06 | Ask what an agent depends on and what depends on it | Operator | Built | Dependency Registry, Graph Engine |
| UC-07 | Ask whether A can reach B, and through which paths | Operator | Built | Graph Engine |
| UC-08 | Find cycles and weakly connected groups | Operator | Built | Graph Engine |
| UC-09 | Discover dependencies automatically from configurations, workflows and gateway events | Pipeline | Partial | Dependency Discovery (registry-side groundwork only) |
| UC-10 | Review an uncertain or conflicting discovery finding | Operator | Planned | Dependency Discovery |
| UC-11 | Open an incident against a compromised agent | Operator, signal | Planned | Incident Management |
| UC-12 | Compute the blast radius with explaining paths | Operator | Planned | Blast-Radius Engine |
| UC-13 | Generate a minimum-safe-containment plan that preserves healthy workflows | Operator | Planned | Containment Engine |
| UC-14 | Approve or reject a plan (bound to the exact plan version) | Operator | Planned | Approval Service |
| UC-15 | Enforce an approved plan at controlled boundaries and recheck in-flight operations | System | Planned | Authorization Gateway |
| UC-16 | Verify containment: the blocked operation fails, a healthy workflow still works | System | Planned | Verification Service |
| UC-17 | Retrieve and independently verify the incident evidence | Auditor | Planned | Evidence Service |
| UC-18 | Resolve agent identity through ENS | System | Planned | ENS integration |
| UC-19 | Store and retrieve incident snapshots | System | Planned | Arkiv integration |
| UC-20 | Trigger a response workflow from an external incident signal | System | Planned | Chainlink CRE integration |

## Primary scenario

The demo scenario (see [project/04-demo-script.md](project/04-demo-script.md)): five agents share a Customer API; the Payment agent is compromised; CORVEN identifies the incident source, reconstructs dependency paths, finds downstream agents and shared resources, proposes a plan, executes the approved changes, confirms the compromised operation is blocked while a healthy agent still succeeds, and shows the evidence.

## Detailed flows

### UC-04 Record a dependency (built)

1. Operator submits source, target, type, relationship label, metadata, provenance and confidence.
2. The API validates the shape (unknown fields are rejected), then the relationship rules: allowed endpoint types for the dependency type, no self-reference, per-type required metadata, confidence and freshness.
3. Inside one transaction: both endpoints must exist in the caller's organization; authority edges are cycle-checked; the dependency, its first version row and an audit row are written.
4. Response `201` with version 1.

### UC-07 Reachability (built)

1. The caller names a source and target node and optional filters (dependency type, status, minimum confidence, direction, depth).
2. The API builds the graph from one consistent registry snapshot and runs a bounded breadth-first search.
3. The answer says whether a path exists, the shortest path, and whether the search was cut short. "No path" is a normal result.

### UC-13 Containment (planned)

See [modules/06-containment-engine.md](modules/06-containment-engine.md).
