import type { Graph } from "../core/graph.js";
import type { BuildReport, EdgeStatus, GraphEdge, GraphFilter, GraphNode, GraphPath, NodeType, EdgeDependencyType } from "../types/graph.types.js";

/** Serialisation helpers. Plain JSON only; no internal structures leave the module. */
export const nodeDto = (n: GraphNode) => ({ ...n });

export const edgeDto = (e: GraphEdge) => ({
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
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

export const pageInfo = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });

export interface FilterQuery {
  dependencyTypes?: EdgeDependencyType[] | undefined;
  includeInactive?: boolean | undefined;
  minConfidence?: number | undefined;
  entityType?: NodeType | undefined;
}

/** Query string -> GraphFilter. Active edges only unless includeInactive is set. */
export function toFilter(q: FilterQuery): GraphFilter {
  return {
    dependencyTypes: q.dependencyTypes,
    edgeStatuses: q.includeInactive ? (["active", "inactive"] as EdgeStatus[]) : ["active"],
    minConfidence: q.minConfidence,
    entityTypes: q.entityType ? [q.entityType] : undefined,
  };
}

export const reportDto = (r: BuildReport) => ({
  invalidNodeCount: r.invalidNodeCount,
  invalidEdgeCount: r.invalidEdgeCount,
  issues: r.issues.slice(0, 50),
  issuesTruncated: r.issues.length > 50,
});

/** Paths reference ids; include the referenced nodes and edges so a client needs no second call. */
export function pathsWithContext(graph: Graph, paths: GraphPath[]) {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const p of paths) {
    p.nodeIds.forEach((n) => nodeIds.add(n));
    p.edgeIds.forEach((e) => edgeIds.add(e));
  }
  return {
    nodes: [...nodeIds].sort().map((id) => nodeDto(graph.getNode(id)!)),
    edges: [...edgeIds].sort().map((id) => edgeDto(graph.getEdge(id)!)),
  };
}
