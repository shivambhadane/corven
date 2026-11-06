import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { RegistryGraphInputProvider } from "../adapters/registry-graph-input.provider.js";
import { buildGraph } from "../core/builder.js";
import { detectCycles } from "../core/cycles.js";
import { weaklyConnectedComponents } from "../core/components.js";
import { exportGraph } from "../core/export.js";
import type { Graph } from "../core/graph.js";
import { findPaths } from "../core/paths.js";
import { bfs, dfs, reachability } from "../core/traversal.js";
import { GraphError } from "../errors.js";
import type { BuildReport, Direction, GraphFilter } from "../types/graph.types.js";

export interface BuiltGraph {
  graph: Graph;
  report: BuildReport;
  durationMs: number;
}

/**
 * Stable service interface for other CORVEN modules and for the HTTP layer.
 * Every call builds from the registries (one consistent snapshot), so results
 * always reflect current canonical data; nothing is cached or persisted here.
 * Nothing it returns lets a caller mutate graph internals.
 */
export class GraphQueryService {
  constructor(private readonly input: RegistryGraphInputProvider) {}

  /** For internal modules: organization-explicit, no principal. */
  async build(organizationId: string): Promise<BuiltGraph> {
    const started = performance.now();
    const input = await this.input.load(organizationId);
    const { graph, report } = buildGraph(organizationId, input);
    return { graph, report, durationMs: Math.round((performance.now() - started) * 100) / 100 };
  }

  /** For the HTTP layer: the organization comes from the authenticated principal only. */
  async buildFor(principal: Principal): Promise<BuiltGraph> {
    assertCan(principal, "graph:read");
    return this.build(principal.organizationId);
  }

  // Thin, typed wrappers so consumers do not need to know the core module layout.
  traverse(graph: Graph, algorithm: "bfs" | "dfs", start: string, o: { direction?: Direction; maxDepth?: number; filter?: GraphFilter }) {
    return (algorithm === "bfs" ? bfs : dfs)(graph, start, o);
  }
  reachability = reachability;
  paths = findPaths;
  components = weaklyConnectedComponents;
  cycles = detectCycles;
  export = exportGraph;
}

export function overview(graph: Graph) {
  const count = <T extends string | null>(items: readonly T[]) => {
    const out: Record<string, number> = {};
    for (const i of items) out[i ?? "none"] = (out[i ?? "none"] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort(([x], [y]) => (x < y ? -1 : 1)));
  };
  return {
    organizationId: graph.organizationId,
    metadata: { nodeCount: graph.metadata.nodeCount, edgeCount: graph.metadata.edgeCount, builtAt: graph.metadata.builtAt.toISOString() },
    nodesByEntityType: count(graph.nodes().map((n) => n.entityType)),
    nodesByStatus: count(graph.nodes().map((n) => n.status)),
    edgesByDependencyType: count(graph.edges().map((e) => e.dependencyType)),
    edgesByStatus: count(graph.edges().map((e) => e.status)),
  };
}

export const requireNodeParam = (graph: Graph, id: string) => {
  const n = graph.getNode(id);
  if (!n) throw new GraphError("NODE_NOT_FOUND", "Node not found in this graph");
  return n;
};
