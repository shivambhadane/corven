# Graph Engine (index)

The Graph Engine documentation lives in [graph-engine/](graph-engine/README.md). This file is kept so existing links and the PRD's numbered module list still resolve (the PRD calls it Module 4; the numbered files under `modules/` follow its original ten-module list, where the graph is third).

**Status:** implemented and tested. Read-only over the registries. Authentication is still the development-only adapter.

| Document | Contents |
|---|---|
| [graph-engine/README.md](graph-engine/README.md) | Purpose, scope, position in CORVEN, interfaces, design principles, status |
| [graph-engine/architecture.md](graph-engine/architecture.md) | Components, construction and query flows, trust boundaries, failure scenarios |
| [graph-engine/data-model.md](graph-engine/data-model.md) | Nodes, edges, graph, identities, validation, serialization, example |
| [graph-engine/algorithms.md](graph-engine/algorithms.md) | BFS, DFS, reachability, shortest path, bounded paths, components, cycles |
| [graph-engine/api.md](graph-engine/api.md) | Endpoint reference |
| [graph-engine/testing.md](graph-engine/testing.md) | Test strategy, measured performance, acceptance criteria |
| [graph-engine/decisions.md](graph-engine/decisions.md) | Architecture decision records |

One-paragraph summary: the Graph Engine turns the canonical agents, resources and dependencies of one organization into an immutable, directed, typed in-memory graph (rebuilt from one consistent registry snapshot on each request) and answers structural questions: neighbours, traversal, reachability, shortest and bounded paths, weakly connected components and directed cycles. It does not store graphs, classify impact, plan containment or enforce anything, and graph reachability is structural: it neither proves compromise nor an executable attack path, and it only covers dependencies registered with CORVEN.
