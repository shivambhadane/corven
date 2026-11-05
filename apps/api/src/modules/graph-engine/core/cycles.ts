import { GraphError } from "../errors.js";
import { LIMITS, type CycleInfo, type CycleReport, type GraphFilter } from "../types/graph.types.js";
import { compileFilter, stepsFrom } from "./filters.js";
import type { Graph } from "./graph.js";

/**
 * Directed cycle report. Cycles are not errors by themselves: an operational
 * cycle can be legitimate, and authority cycles are already rejected by the
 * registry. This only reports.
 *
 * 1. Tarjan's algorithm (iterative) finds strongly connected components, O(V + E).
 * 2. Inside each cyclic component, simple cycles are enumerated, each exactly
 *    once (a cycle is found only from its smallest node), bounded by
 *    maxCycles, maxLength and a global search budget. Parallel edges give
 *    distinct cycles.
 *
 * A component can be cyclic while all its cycles are longer than maxLength; it
 * is still counted in `cyclicComponentCount`.
 */
export function detectCycles(
  graph: Graph,
  options: { filter?: GraphFilter; maxCycles?: number; maxLength?: number } = {},
): CycleReport {
  const maxCycles = options.maxCycles ?? LIMITS.defaultCycles;
  const maxLength = options.maxLength ?? LIMITS.defaultCycleLength;
  if (!Number.isInteger(maxCycles) || maxCycles < 1) throw new GraphError("INVALID_FILTER", "maxCycles must be a positive integer");
  if (maxCycles > LIMITS.maxCycles) throw new GraphError("MAX_PATHS_EXCEEDED", `maxCycles must be at most ${LIMITS.maxCycles}`, { limit: LIMITS.maxCycles });
  if (!Number.isInteger(maxLength) || maxLength < 1) throw new GraphError("INVALID_FILTER", "maxLength must be a positive integer");
  if (maxLength > LIMITS.maxCycleLength) throw new GraphError("MAX_DEPTH_EXCEEDED", `maxLength must be at most ${LIMITS.maxCycleLength}`, { limit: LIMITS.maxCycleLength });
  const filter = compileFilter(graph, options.filter);

  const nodeIds = graph.nodes().filter((n) => filter.nodeOk(n)).map((n) => n.id);
  const sccs = stronglyConnectedComponents(graph, nodeIds, (id) => stepsFrom(graph, id, "forward", filter).map((s) => s.next));

  const cycles: CycleInfo[] = [];
  let budget = LIMITS.searchBudget;
  let budgetOut = false;
  let capped = false;
  let cyclicComponentCount = 0;

  for (const comp of sccs) {
    const hasSelfLoop = comp.length === 1 && stepsFrom(graph, comp[0]!, "forward", filter).some((s) => s.next === comp[0]);
    if (comp.length < 2 && !hasSelfLoop) continue;
    cyclicComponentCount++;
    if (capped || budgetOut) continue;

    const members = new Set(comp);
    const order = [...comp].sort();
    const rank = new Map(order.map((id, i) => [id, i]));

    for (const start of order) {
      if (capped || budgetOut) break;
      const startRank = rank.get(start)!;
      const nodeStack = [start];
      const edgeStack: string[] = [];
      const onPath = new Set<string>([start]);

      const dive = (cur: string): boolean => {
        for (const s of stepsFrom(graph, cur, "forward", filter)) {
          if (--budget < 0) { budgetOut = true; return true; }
          if (!members.has(s.next)) continue;
          if (s.next === start) {
            cycles.push({ nodeIds: [...nodeStack], edgeIds: [...edgeStack, s.edge.id], length: edgeStack.length + 1 });
            if (cycles.length > maxCycles) { capped = true; return true; }
            continue;
          }
          if (rank.get(s.next)! < startRank || onPath.has(s.next) || edgeStack.length + 1 >= maxLength) continue;
          onPath.add(s.next);
          nodeStack.push(s.next);
          edgeStack.push(s.edge.id);
          const stop = dive(s.next);
          edgeStack.pop();
          nodeStack.pop();
          onPath.delete(s.next);
          if (stop) return true;
        }
        return false;
      };
      dive(start);
    }
  }

  let truncated = false;
  let reason: CycleReport["truncationReason"] = null;
  if (cycles.length > maxCycles) {
    cycles.length = maxCycles;
    truncated = true;
    reason = "max_cycles";
  } else if (budgetOut) {
    truncated = true;
    reason = "search_budget";
  }
  cycles.sort((a, b) => a.length - b.length || (a.nodeIds.join() < b.nodeIds.join() ? -1 : a.nodeIds.join() > b.nodeIds.join() ? 1 : 0));
  return { cycles, cyclicComponentCount, truncated, truncationReason: reason };
}

/** Iterative Tarjan SCC. Returns components in a deterministic order (each sorted, list sorted by first id). */
export function stronglyConnectedComponents(graph: Graph, nodeIds: readonly string[], neighbours: (id: string) => string[]): string[][] {
  void graph;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const root of nodeIds) {
    if (index.has(root)) continue;
    const work: Array<{ id: string; next: string[]; i: number }> = [];
    const enter = (id: string) => {
      index.set(id, counter);
      low.set(id, counter);
      counter++;
      stack.push(id);
      onStack.add(id);
      work.push({ id, next: neighbours(id), i: 0 });
    };
    enter(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      if (frame.i < frame.next.length) {
        const w = frame.next[frame.i++]!;
        if (!index.has(w)) enter(w);
        else if (onStack.has(w)) low.set(frame.id, Math.min(low.get(frame.id)!, index.get(w)!));
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1]!;
          low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
        }
        if (low.get(frame.id) === index.get(frame.id)) {
          const comp: string[] = [];
          for (let w: string; ; ) {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
            if (w === frame.id) break;
          }
          result.push(comp.sort());
        }
      }
    }
  }
  return result.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
}
