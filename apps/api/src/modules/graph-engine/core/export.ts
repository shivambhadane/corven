import type { GraphFilter } from "../types/graph.types.js";
import { compileFilter } from "./filters.js";
import type { Graph } from "./graph.js";

/**
 * Serializable, frontend-agnostic export (plain JSON values, stable order).
 * Intended for visualisation and for the future Snapshot Service. Contains no
 * internal indexes.
 */
export function exportGraph(graph: Graph, filterSpec: GraphFilter = {}) {
  const filter = compileFilter(graph, filterSpec);
  return {
    organizationId: graph.organizationId,
    builtAt: graph.metadata.builtAt.toISOString(),
    nodes: graph.nodes().filter((n) => filter.nodeOk(n)).map((n) => ({ ...n })),
    edges: graph.edges().filter((e) => filter.edgeOk(e)).map((e) => ({
      id: e.id,
      dependencyId: e.dependencyId,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      dependencyType: e.dependencyType,
      relationship: e.relationship,
      status: e.status,
      confidence: e.confidence,
      provenance: { ...e.provenance },
      metadata: { ...e.metadata },
      version: e.version,
      observedAt: e.observedAt ? e.observedAt.toISOString() : null,
      lastVerifiedAt: e.lastVerifiedAt ? e.lastVerifiedAt.toISOString() : null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
  };
}
