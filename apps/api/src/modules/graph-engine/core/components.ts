import type { ComponentInfo, GraphFilter } from "../types/graph.types.js";
import { compileFilter } from "./filters.js";
import type { Graph } from "./graph.js";

/**
 * Weakly connected components: groups of nodes joined by admissible edges
 * IGNORING direction. This is a structural grouping only; it must not be used
 * to answer reachability, which is directional. Isolated nodes (under the
 * filter) form their own component. Output order is deterministic.
 */
export function weaklyConnectedComponents(graph: Graph, filterSpec: GraphFilter = {}): ComponentInfo[] {
  const filter = compileFilter(graph, filterSpec);
  const nodes = graph.nodes().filter((n) => filter.nodeOk(n));

  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    for (let cur = x; cur !== root; ) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // keep the smaller id as root so results do not depend on edge order
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  const admissible = graph.edges().filter((e) => filter.edgeOk(e));
  for (const e of admissible) union(e.sourceNodeId, e.targetNodeId);

  const groups = new Map<string, { nodeIds: string[]; edgeCount: number }>();
  for (const n of nodes) {
    const r = find(n.id);
    (groups.get(r) ?? groups.set(r, { nodeIds: [], edgeCount: 0 }).get(r)!).nodeIds.push(n.id);
  }
  for (const e of admissible) groups.get(find(e.sourceNodeId))!.edgeCount++;

  return [...groups.values()]
    .map((g) => ({ nodeIds: g.nodeIds.sort(), edgeCount: g.edgeCount }))
    .sort((a, b) => (a.nodeIds[0]! < b.nodeIds[0]! ? -1 : 1))
    .map((g, index) => ({ index, ...g }));
}
