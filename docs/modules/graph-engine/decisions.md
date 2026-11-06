# Graph Engine Decisions

Architecture decision records for the Graph Engine. Status is **accepted and implemented** unless stated. Each record gives context, the decision, alternatives, and consequences. Overview: [README.md](README.md).

| ADR | Decision |
|---|---|
| [001](#adr-001-in-memory-graph-representation) | In-memory graph representation |
| [002](#adr-002-adjacency-lists) | Adjacency-list data structure |
| [003](#adr-003-no-graph-database-for-the-mvp) | No graph database for the MVP |
| [004](#adr-004-bfs-for-unweighted-shortest-paths) | BFS for unweighted shortest paths |
| [005](#adr-005-iterative-dfs-with-re-expansion) | Iterative DFS, with re-expansion |
| [006](#adr-006-weakly-connected-components-for-the-mvp) | Weakly connected components for the MVP |
| [007](#adr-007-directed-cycle-detection-that-only-reports) | Directed cycle detection that only reports |
| [008](#adr-008-the-registry-remains-the-source-of-truth) | The registry remains the canonical source of truth |
| [009](#adr-009-rebuild-per-request-from-one-consistent-snapshot) | Rebuild per request from one consistent snapshot |
| [010](#adr-010-the-graph-engine-does-not-enforce-or-interpret) | The Graph Engine does not enforce or interpret |
| [011](#adr-011-bounded-computation-with-reported-truncation) | Bounded computation with reported truncation |
| [012](#adr-012-pure-core-and-a-single-database-adapter) | Pure core and a single database adapter |
| [013](#adr-013-invalid-records-are-reported-not-fatal) | Invalid records are reported, not fatal |
| [014](#adr-014-node-identity-and-value-conventions) | Node identity and value conventions |

---

## ADR-001: In-memory graph representation

**Context.** The PRD calls for a graph engine for registered agents and resources. The MVP target is about 1,000 nodes and 5,000 edges per organization.
**Decision.** Represent the graph as an immutable in-memory object built from registry data, with no persistence of its own.
**Alternatives.** Materialize the graph in tables; keep a long-lived mutable in-process graph updated incrementally; persist it in a graph database.
**Rationale.** At the target size an in-memory build takes tens of milliseconds ([testing.md](testing.md)). An immutable object cannot be corrupted by callers and is safe to share. No second copy of the truth exists to go stale.
**Consequences.** Cost grows with graph size on every request; a hard limit (50,000 nodes, 250,000 edges) protects the process. Persisting a graph at a point in time is a separate concern (planned Graph Snapshot Service). **Revisit** if measured build time becomes a bottleneck or graphs far exceed the limit.

## ADR-002: Adjacency lists

**Context.** Traversal must not rescan all edges at every step.
**Decision.** Keep outgoing and incoming adjacency lists per node, referencing edge objects shared with the edge index, pre-sorted by (neighbour id, edge id).
**Alternatives.** Adjacency matrix; edge list only; maps of sets of edge ids (as sketched in the PRD).
**Rationale.** A matrix is O(V²) in memory and wasteful for sparse dependency graphs. A bare edge list forces O(E) scans per step. Adjacency lists give O(V + E) memory and O(degree) neighbour access. Sorting once at build time makes every algorithm deterministic. Edge objects are frozen and shared, so there are no copies to keep consistent. A **multigraph** is supported because two nodes may share several dependency types.
**Consequences.** The PRD sketched `Map<string, Set<string>>` of edge ids; the implementation stores frozen edge references in arrays and keeps the maps private behind methods. Public behavior is the same; internal mutation by callers is impossible.

## ADR-003: No graph database for the MVP

**Context.** Graph databases (for example Neo4j) offer query languages and traversal engines.
**Decision.** Do not introduce one. The data stays in PostgreSQL; the graph is computed in TypeScript.
**Alternatives.** A graph database; PostgreSQL recursive queries for every graph operation.
**Rationale.** A graph database adds infrastructure, a second copy of the data to keep consistent, and cost, for a graph of a few thousand edges. The hackathon scope favors few moving parts. Recursive SQL was kept only where the data lives in the database already (the Dependency Registry's authority-cycle check); a general query engine in SQL would couple algorithms to the database and be harder to test.
**Consequences.** Algorithms are plain TypeScript, testable without a database. If graphs grow by orders of magnitude, or incremental queries become necessary, this decision should be revisited.

## ADR-004: BFS for unweighted shortest paths

**Context.** "Shortest path" must mean something defined and cheap. Edges carry confidence and relationship types, but no cost.
**Decision.** Define shortest as fewest edges, found by breadth-first search with predecessor tracking.
**Alternatives.** Dijkstra with confidence or cost weights; A*; bidirectional search.
**Rationale.** BFS is optimal for unweighted graphs in O(V + E). Weights would require choosing what confidence means as a cost, which is a modelling decision not made yet; inventing one would produce numbers that look precise and are not.
**Consequences.** Shortest path ignores confidence. Weighted analysis is a documented future extension. Ties are broken by smallest ids for determinism.

## ADR-005: Iterative DFS, with re-expansion

**Context.** The PRD prefers an iterative DFS. A depth-limited DFS with a global "visited" set has a known flaw: a node first reached along a deep path is not expanded again when a shorter route is found, so nodes within the depth limit can be missed.
**Decision.** Use an explicit stack, and re-expand a node when a shallower route to it is found. The final depth of each node is its minimum hop count.
**Alternatives.** Recursive DFS; iterative DFS without re-expansion; iterative deepening.
**Rationale.** Recursion limits graph depth to the call stack. Without re-expansion the traversal result depends on neighbour order and disagrees with BFS for the same limit. The flaw was found by the performance test, which compared DFS and BFS on a 1,000-node graph, and is now guarded by a randomized equivalence test.
**Consequences.** DFS can cost up to O(`maxDepth` · (V + E)) instead of O(V + E) (measured 134 to 243 ms versus 8 to 16 ms at 1,000 nodes and 5,000 edges, depth 100). Callers who only need the reachable set and depths should use BFS.

## ADR-006: Weakly connected components for the MVP

**Context.** A structural summary of how the inventory splits into independent parts is useful; the PRD requires weak components for the MVP.
**Decision.** Implement weakly connected components (direction ignored). Use strongly connected components only internally, for cycle detection.
**Alternatives.** Strongly connected components as the primary result; both.
**Rationale.** Weak components answer "what is connected at all" cheaply. Strong components answer a different question that cycle reporting already needs. Exposing one without the other would invite misuse, so the API labels the semantics in its response (`"weakly connected (edge direction ignored)"`).
**Consequences.** Component membership must never be used to answer reachability; docs and API say so ([algorithms.md](algorithms.md#directed-traversal-versus-weak-components)). Exposing strong components is possible later because the algorithm exists.

## ADR-007: Directed cycle detection that only reports

**Context.** Cycles are not automatically invalid: operational loops can be legitimate. Authority cycles are already rejected when a dependency is created.
**Decision.** Detect directed cycles with Tarjan's strongly connected components, then enumerate simple cycles inside cyclic components with bounds, and report them. Never modify the registry or reject data.
**Alternatives.** DFS coloring (finds that a cycle exists, not each cycle); Johnson's algorithm (exact enumeration, unbounded output); report components only.
**Rationale.** Tarjan finds cyclic parts in linear time. Enumerating every cycle can be exponential, so output is bounded by `maxCycles`, `maxLength` and a search budget, and truncation is reported. Each cycle is found once from its smallest node.
**Consequences.** A report may be a bounded sample; components whose cycles are all too long are counted but unlisted. The meaning of a cycle (acceptable or not) stays with the business rules in the registry and later modules.

## ADR-008: The registry remains the source of truth

**Context.** Two sources of dependency truth would diverge.
**Decision.** The registries own agents, resources and dependencies. The Graph Engine only reads them, never writes, and stores nothing.
**Alternatives.** A graph table updated by triggers or by the registry services; a cache with invalidation.
**Rationale.** Derived data has to be rebuilt or invalidated whenever its inputs change; a missed update would make incident decisions rest on a wrong graph. Rebuilding avoids that class of bug. The adapter's transaction is read-only, and a test asserts that registry rows, versions and audit counts do not change.
**Consequences.** Every graph reflects the current registry state. Point-in-time graphs need an explicit snapshot mechanism.

## ADR-009: Rebuild per request from one consistent snapshot

**Context.** The PRD sketches `POST /build` followed by reads of a built graph, which implies stored state in the process.
**Decision.** Each request builds a fresh graph inside one read-only `REPEATABLE READ` transaction. `POST /build` validates and reports; it persists nothing.
**Alternatives.** A per-process cache with a time-to-live or version marker; a shared cache; a stored graph.
**Rationale.** A process cache goes stale and behaves differently with more than one instance. Reading agents, resources and dependencies in separate transactions could build a graph from inconsistent states. One snapshot avoids that and never blocks writers (MVCC). At 1,000 nodes and 5,000 edges a rebuild is cheap ([testing.md](testing.md#measured-performance)).
**Consequences.** Repeated queries repeat the build cost; two builds can differ if the registries change between them. **Revisit** with measurements if bursts of queries become costly; add caching keyed on a registry version marker, not a timer.

## ADR-010: The Graph Engine does not enforce or interpret

**Context.** Later modules need graph structure to decide things. Mixing decisions into the graph would couple modules and make the structure untrustworthy.
**Decision.** The engine answers structural questions only. It does not classify nodes (compromised, exposed), plan containment, revoke or approve anything, and does not use a language model.
**Alternatives.** Embed blast-radius classification in the graph.
**Rationale.** Structure is deterministic and testable in isolation; interpretation depends on incident context, policy and thresholds that belong to the Blast-Radius and Containment modules. Reachability does not imply compromise or exploitability, and the API says so.
**Consequences.** Downstream modules compose the pure functions themselves. Nothing here can cause an enforcement action.

## ADR-011: Bounded computation with reported truncation

**Context.** Path and cycle enumeration can be exponential; requests must not hang the API.
**Decision.** Every search has hard limits (depth, path and cycle counts, a search budget, graph size). Exceeding a *requested* limit above the cap is a `400`; hitting a *search* bound returns the partial result with a `truncated` flag and reason. "No path" is a normal result.
**Alternatives.** Unbounded enumeration; hard errors on truncation; timeouts only.
**Rationale.** Silent truncation would let a caller read a partial list as complete; an error would discard a useful partial result. Timeouts alone are non-deterministic. Counting expansions is deterministic and testable.
**Consequences.** Consumers must read `truncated`, `truncatedByDepth` and `truncationReason`. Limits are constants in `types/graph.types.ts` and can be tuned with measurements.

## ADR-012: Pure core and a single database adapter

**Context.** Graph algorithms should be testable without Fastify or a database, and reusable by other modules.
**Decision.** Keep `core/` free of Fastify and database imports. Only `RegistryGraphInputProvider` reads the database, converting rows into plain records.
**Alternatives.** Algorithms that query the database directly; an ORM-coupled graph model.
**Rationale.** Pure functions over plain data give fast, deterministic unit tests (hand-built graphs in a few lines) and let Blast-Radius and Containment call the same functions without HTTP.
**Consequences.** One more mapping step (registry rows to plain records), accepted for testability.

## ADR-013: Invalid records are reported, not fatal

**Context.** One corrupt record should not hide the rest of an organization's inventory during an incident; yet silent skipping would hide corruption.
**Decision.** The builder skips invalid or cross-organization records and returns a report with their ids and reason codes; a strict mode fails the build instead. A final integrity check guards the result.
**Alternatives.** Fail the whole build on any invalid record; ignore invalid records silently.
**Rationale.** The database already prevents most invalid states, so reports should be rare; when they occur the operator still gets a graph and an explicit warning. Reports carry ids and fixed messages only, so they leak nothing.
**Consequences.** Consumers should check `report` when exactness matters; they may opt into strict mode.

## ADR-014: Node identity and value conventions

**Context.** Agent and resource uuids come from different tables, and the PRD examples use uppercase enumerations.
**Decision.** Node ids are `agent:<uuid>` and `resource:<uuid>`; edge ids equal dependency ids; all enumerated values are lowercase, matching the registries. Resource nodes have `status: null`.
**Alternatives.** Bare uuids; a shared entity-id table; uppercase constants.
**Rationale.** A prefixed id is unambiguous, human-readable and pattern-validatable. Matching the registries' value spelling avoids a translation layer that could drift. A shared id table would require changing the registries for no functional benefit.
**Consequences.** Clients parse the prefix only for display; `getNodeByEntity` resolves from registry ids without parsing.

Related: [architecture.md](architecture.md), [algorithms.md](algorithms.md), [../../architecture/01-system-architecture.md](../../architecture/01-system-architecture.md).
