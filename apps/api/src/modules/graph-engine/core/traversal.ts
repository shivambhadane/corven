import { GraphError } from "../errors.js";
import { LIMITS, type Direction, type GraphFilter, type ReachabilityResult, type TraversalResult, type TraversalVisit } from "../types/graph.types.js";
import { assertDepth, compileFilter, stepsFrom } from "./filters.js";
import type { Graph } from "./graph.js";

export interface TraversalOptions {
  direction?: Direction;
  maxDepth?: number;
  filter?: GraphFilter;
}

const requireNode = (graph: Graph, id: string) => {
  const n = graph.getNode(id);
  if (!n) throw new GraphError("NODE_NOT_FOUND", "Node not found in this graph");
  return n;
};

/**
 * Breadth-first traversal. `depth` is the minimum number of hops. A node
 * sitting at maxDepth is not expanded; `truncatedByDepth` reports whether that
 * hid anything. O(V + E).
 */
export function bfs(graph: Graph, startNodeId: string, options: TraversalOptions = {}): TraversalResult {
  const { direction = "forward", maxDepth = LIMITS.defaultDepth } = options;
  assertDepth(maxDepth);
  requireNode(graph, startNodeId);
  const filter = compileFilter(graph, options.filter);

  const visited = new Set<string>([startNodeId]);
  const visits: TraversalVisit[] = [{ nodeId: startNodeId, depth: 0, viaEdgeId: null, fromNodeId: null }];
  const edgeIds = new Set<string>();
  let truncated = false;

  for (let head = 0; head < visits.length; head++) {
    const cur = visits[head]!;
    const steps = stepsFrom(graph, cur.nodeId, direction, filter);
    if (cur.depth >= maxDepth) {
      if (steps.some((s) => !visited.has(s.next))) truncated = true;
      continue;
    }
    for (const s of steps) {
      edgeIds.add(s.edge.id);
      if (visited.has(s.next)) continue;
      visited.add(s.next);
      visits.push({ nodeId: s.next, depth: cur.depth + 1, viaEdgeId: s.edge.id, fromNodeId: cur.nodeId });
    }
  }
  return { algorithm: "bfs", startNodeId, direction, maxDepth, visited: visits, edgeIds: [...edgeIds].sort(), truncatedByDepth: truncated };
}

/**
 * Depth-first traversal (pre-order), iterative so graph size cannot overflow
 * the call stack. Nodes appear in first-discovery order, smallest neighbour
 * first.
 *
 * A node is RE-EXPANDED when a shallower route to it is found. Without that, a
 * depth-limited DFS would miss nodes that lie within maxDepth hops but were
 * first reached along a deep path. The final `depth` of every node therefore
 * equals its minimum hop count, the visited set equals BFS's for the same
 * limit, and each node is re-expanded at most maxDepth times:
 * O(maxDepth * (V + E)) worst case, O(V + E) on typical graphs.
 */
export function dfs(graph: Graph, startNodeId: string, options: TraversalOptions = {}): TraversalResult {
  const { direction = "forward", maxDepth = LIMITS.defaultDepth } = options;
  assertDepth(maxDepth);
  requireNode(graph, startNodeId);
  const filter = compileFilter(graph, options.filter);

  const byNode = new Map<string, TraversalVisit>();
  const visits: TraversalVisit[] = [];
  const edgeIds = new Set<string>();
  const stack: TraversalVisit[] = [{ nodeId: startNodeId, depth: 0, viaEdgeId: null, fromNodeId: null }];

  while (stack.length > 0) {
    const cur = stack.pop()!;
    const known = byNode.get(cur.nodeId);
    if (known) {
      if (known.depth <= cur.depth) continue; // already reached at least this shallowly
      known.depth = cur.depth; // shallower route: update in place and re-expand
      known.viaEdgeId = cur.viaEdgeId;
      known.fromNodeId = cur.fromNodeId;
    } else {
      const visit: TraversalVisit = { ...cur };
      byNode.set(cur.nodeId, visit);
      visits.push(visit);
    }
    if (cur.depth >= maxDepth) continue;

    const steps = stepsFrom(graph, cur.nodeId, direction, filter);
    for (const s of steps) edgeIds.add(s.edge.id);
    // Push in reverse so the smallest neighbour is explored first.
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i]!;
      const seen = byNode.get(s.next);
      if (!seen || seen.depth > cur.depth + 1) {
        stack.push({ nodeId: s.next, depth: cur.depth + 1, viaEdgeId: s.edge.id, fromNodeId: cur.nodeId });
      }
    }
  }

  // The limit hid something if any node sitting exactly at maxDepth still has an unvisited admissible neighbour.
  let truncated = false;
  for (const v of visits) {
    if (v.depth === maxDepth && stepsFrom(graph, v.nodeId, direction, filter).some((s) => !byNode.has(s.next))) {
      truncated = true;
      break;
    }
  }
  return { algorithm: "dfs", startNodeId, direction, maxDepth, visited: visits, edgeIds: [...edgeIds].sort(), truncatedByDepth: truncated };
}

/**
 * Structural reachability: a node trivially reaches itself (depth 0).
 * "reachable" says nothing about compromise or enforceability. Direction
 * "both" deliberately ignores edge direction and is only used when asked for.
 */
export function reachability(graph: Graph, sourceNodeId: string, targetNodeId: string, options: TraversalOptions = {}): ReachabilityResult {
  const { direction = "forward", maxDepth = LIMITS.defaultDepth } = options;
  assertDepth(maxDepth);
  requireNode(graph, sourceNodeId);
  requireNode(graph, targetNodeId);
  if (sourceNodeId === targetNodeId) return { reachable: true, depth: 0, truncatedByDepth: false };
  const filter = compileFilter(graph, options.filter);

  const visited = new Set<string>([sourceNodeId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: sourceNodeId, depth: 0 }];
  let truncated = false;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const steps = stepsFrom(graph, cur.id, direction, filter);
    if (cur.depth >= maxDepth) {
      if (steps.some((s) => !visited.has(s.next))) truncated = true;
      continue;
    }
    for (const s of steps) {
      if (s.next === targetNodeId) return { reachable: true, depth: cur.depth + 1, truncatedByDepth: false };
      if (!visited.has(s.next)) {
        visited.add(s.next);
        queue.push({ id: s.next, depth: cur.depth + 1 });
      }
    }
  }
  return { reachable: false, depth: null, truncatedByDepth: truncated };
}
