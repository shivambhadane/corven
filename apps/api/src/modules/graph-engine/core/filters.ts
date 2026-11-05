import { GraphError } from "../errors.js";
import {
  EDGE_DEPENDENCY_TYPES,
  EDGE_STATUSES,
  LIMITS,
  NODE_TYPES,
  type Direction,
  type GraphEdge,
  type GraphFilter,
  type GraphNode,
} from "../types/graph.types.js";
import type { Graph } from "./graph.js";

export interface CompiledFilter {
  nodeOk(n: GraphNode): boolean;
  /** Edge passes its own criteria AND both endpoints pass the node criteria. */
  edgeOk(e: GraphEdge): boolean;
}

const check = (name: string, values: readonly string[] | undefined, allowed: readonly string[]) => {
  for (const v of values ?? []) {
    if (!allowed.includes(v)) throw new GraphError("INVALID_FILTER", `Unknown ${name} "${v}"`);
  }
};

/**
 * Compiles a filter once so traversal, paths, components and cycles all apply
 * it identically. By default only ACTIVE edges are considered.
 */
export function compileFilter(graph: Graph, filter: GraphFilter = {}): CompiledFilter {
  check("entity type", filter.entityTypes, NODE_TYPES);
  check("dependency type", filter.dependencyTypes, EDGE_DEPENDENCY_TYPES);
  check("edge status", filter.edgeStatuses, EDGE_STATUSES);
  if (filter.minConfidence !== undefined && !(filter.minConfidence >= 0 && filter.minConfidence <= 1)) {
    throw new GraphError("INVALID_FILTER", "minConfidence must be between 0 and 1");
  }

  const entityTypes = filter.entityTypes?.length ? new Set<string>(filter.entityTypes) : null;
  const nodeStatuses = filter.nodeStatuses?.length ? new Set<string>(filter.nodeStatuses) : null;
  const depTypes = filter.dependencyTypes?.length ? new Set<string>(filter.dependencyTypes) : null;
  const edgeStatuses = new Set<string>(filter.edgeStatuses?.length ? filter.edgeStatuses : ["active"]);
  const minConfidence = filter.minConfidence ?? 0;

  const nodeOk = (n: GraphNode) =>
    (!entityTypes || entityTypes.has(n.entityType)) && (!nodeStatuses || (n.status !== null && nodeStatuses.has(n.status)));

  const edgeOk = (e: GraphEdge) => {
    if (depTypes && !depTypes.has(e.dependencyType)) return false;
    if (!edgeStatuses.has(e.status)) return false;
    if (e.confidence < minConfidence) return false;
    const s = graph.getNode(e.sourceNodeId);
    const t = graph.getNode(e.targetNodeId);
    return !!s && !!t && nodeOk(s) && nodeOk(t);
  };
  return { nodeOk, edgeOk };
}

export function assertDepth(maxDepth: number, cap: number = LIMITS.maxDepth): void {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new GraphError("INVALID_FILTER", "maxDepth must be a non-negative integer");
  if (maxDepth > cap) throw new GraphError("MAX_DEPTH_EXCEEDED", `maxDepth must be at most ${cap}`, { limit: cap });
}

export interface Step {
  edge: GraphEdge;
  next: string;
}

/** Admissible steps out of a node in the requested direction, in deterministic order. */
export function stepsFrom(graph: Graph, nodeId: string, direction: Direction, filter: CompiledFilter): Step[] {
  const steps: Step[] = [];
  if (direction !== "reverse") {
    for (const edge of graph.outgoingEdges(nodeId)) if (filter.edgeOk(edge)) steps.push({ edge, next: edge.targetNodeId });
  }
  if (direction !== "forward") {
    for (const edge of graph.incomingEdges(nodeId)) if (filter.edgeOk(edge)) steps.push({ edge, next: edge.sourceNodeId });
  }
  if (direction === "both") steps.sort((a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : 0));
  return steps;
}
