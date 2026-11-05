import { GraphError } from "../errors.js";
import {
  LIMITS,
  type GraphFilter,
  type GraphPath,
  type PathSearchResult,
} from "../types/graph.types.js";
import { assertDepth, compileFilter, stepsFrom, type CompiledFilter } from "./filters.js";
import type { Graph } from "./graph.js";

const requireNode = (graph: Graph, id: string) => {
  if (!graph.hasNode(id)) throw new GraphError("NODE_NOT_FOUND", "Node not found in this graph");
};

/** Shortest path (fewest edges) following edge direction. BFS with predecessors, O(V + E). */
export function shortestPath(graph: Graph, sourceNodeId: string, targetNodeId: string, options: { filter?: GraphFilter; maxDepth?: number } = {}): GraphPath | null {
  const maxDepth = options.maxDepth ?? LIMITS.maxPathDepth;
  assertDepth(maxDepth, LIMITS.maxDepth);
  requireNode(graph, sourceNodeId);
  requireNode(graph, targetNodeId);
  const filter = compileFilter(graph, options.filter);
  return shortestWith(graph, sourceNodeId, targetNodeId, maxDepth, filter);
}

function shortestWith(graph: Graph, sourceNodeId: string, targetNodeId: string, maxDepth: number, filter: CompiledFilter): GraphPath | null {
  if (sourceNodeId === targetNodeId) return { nodeIds: [sourceNodeId], edgeIds: [], length: 0 };
  const prev = new Map<string, { node: string; edge: string }>();
  const depth = new Map<string, number>([[sourceNodeId, 0]]);
  const queue = [sourceNodeId];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const d = depth.get(cur)!;
    if (d >= maxDepth) continue;
    for (const s of stepsFrom(graph, cur, "forward", filter)) {
      if (depth.has(s.next)) continue;
      depth.set(s.next, d + 1);
      prev.set(s.next, { node: cur, edge: s.edge.id });
      if (s.next === targetNodeId) return rebuild(prev, sourceNodeId, targetNodeId);
      queue.push(s.next);
    }
  }
  return null;
}

function rebuild(prev: Map<string, { node: string; edge: string }>, source: string, target: string): GraphPath {
  const nodeIds = [target];
  const edgeIds: string[] = [];
  for (let cur = target; cur !== source; ) {
    const p = prev.get(cur)!;
    edgeIds.push(p.edge);
    nodeIds.push(p.node);
    cur = p.node;
  }
  nodeIds.reverse();
  edgeIds.reverse();
  return { nodeIds, edgeIds, length: edgeIds.length };
}

/**
 * Bounded enumeration of simple paths (no repeated node), shortest first, in a
 * deterministic order. Three independent bounds keep it safe on cyclic or
 * dense graphs: maxPaths, maxDepth, and a global search budget. Parallel edges
 * between the same two nodes yield distinct paths.
 *
 * Method: iterative deepening over exact path length, pruned with each node's
 * hop distance to the target, so work is spent only on branches that can still
 * finish in time.
 */
export function findPaths(
  graph: Graph,
  sourceNodeId: string,
  targetNodeId: string,
  options: { filter?: GraphFilter; maxDepth?: number; maxPaths?: number } = {},
): PathSearchResult {
  const maxDepth = options.maxDepth ?? LIMITS.defaultDepth;
  const maxPaths = options.maxPaths ?? LIMITS.defaultPaths;
  assertDepth(maxDepth, LIMITS.maxPathDepth);
  if (!Number.isInteger(maxPaths) || maxPaths < 1) throw new GraphError("INVALID_FILTER", "maxPaths must be a positive integer");
  if (maxPaths > LIMITS.maxPaths) throw new GraphError("MAX_PATHS_EXCEEDED", `maxPaths must be at most ${LIMITS.maxPaths}`, { limit: LIMITS.maxPaths });
  requireNode(graph, sourceNodeId);
  requireNode(graph, targetNodeId);
  const filter = compileFilter(graph, options.filter);

  const shortest = shortestWith(graph, sourceNodeId, targetNodeId, maxDepth, filter);
  if (!shortest) return { found: false, shortest: null, paths: [], truncated: false, truncationReason: null };
  if (sourceNodeId === targetNodeId) return { found: true, shortest, paths: [shortest], truncated: false, truncationReason: null };

  const dist = hopsTo(graph, targetNodeId, filter);
  const found: GraphPath[] = [];
  let budget = LIMITS.searchBudget;
  let budgetOut = false;
  const onPath = new Set<string>([sourceNodeId]);
  const nodeStack = [sourceNodeId];
  const edgeStack: string[] = [];

  const dive = (cur: string, remaining: number): boolean => {
    // returns true to stop the whole search
    if (remaining === 0) {
      if (cur === targetNodeId) {
        found.push({ nodeIds: [...nodeStack], edgeIds: [...edgeStack], length: edgeStack.length });
        return found.length > maxPaths; // keep one extra to know if more exist
      }
      return false;
    }
    for (const s of stepsFrom(graph, cur, "forward", filter)) {
      if (--budget < 0) { budgetOut = true; return true; }
      if (onPath.has(s.next)) continue;
      const d = dist.get(s.next);
      if (d === undefined || d > remaining - 1) continue;
      if (s.next === targetNodeId && remaining - 1 !== 0) continue; // a simple path ends the first time it reaches the target
      onPath.add(s.next);
      nodeStack.push(s.next);
      edgeStack.push(s.edge.id);
      const stop = dive(s.next, remaining - 1);
      edgeStack.pop();
      nodeStack.pop();
      onPath.delete(s.next);
      if (stop) return true;
    }
    return false;
  };

  for (let length = shortest.length; length <= maxDepth; length++) {
    if (dive(sourceNodeId, length)) break;
  }

  let truncated = false;
  let reason: PathSearchResult["truncationReason"] = null;
  if (found.length > maxPaths) {
    found.length = maxPaths;
    truncated = true;
    reason = "max_paths";
  } else if (budgetOut) {
    truncated = true;
    reason = "search_budget";
  }
  const paths = found.length > 0 ? found : [shortest];
  return { found: true, shortest, paths, truncated, truncationReason: reason };
}

/** Hop distance from every node to `target` following edge direction (reverse BFS). */
function hopsTo(graph: Graph, target: string, filter: CompiledFilter): Map<string, number> {
  const dist = new Map<string, number>([[target, 0]]);
  const queue = [target];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const d = dist.get(cur)!;
    for (const s of stepsFrom(graph, cur, "reverse", filter)) {
      if (dist.has(s.next)) continue;
      dist.set(s.next, d + 1);
      queue.push(s.next);
    }
  }
  return dist;
}

/** For callers that must have a path. */
export function requirePath(graph: Graph, sourceNodeId: string, targetNodeId: string, options: { filter?: GraphFilter; maxDepth?: number } = {}): GraphPath {
  const p = shortestPath(graph, sourceNodeId, targetNodeId, options);
  if (!p) throw new GraphError("PATH_NOT_FOUND", "No path exists between these nodes under the given filters");
  return p;
}
