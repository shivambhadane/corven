import { describe, expect, it } from "vitest";
import { weaklyConnectedComponents } from "../src/modules/graph-engine/core/components.js";
import { detectCycles, stronglyConnectedComponents } from "../src/modules/graph-engine/core/cycles.js";
import { findPaths, requirePath, shortestPath } from "../src/modules/graph-engine/core/paths.js";
import { LIMITS } from "../src/modules/graph-engine/types/graph.types.js";
import { a, build, r } from "./graph-fixtures.js";

describe("shortest path", () => {
  const g = () => build(["s", "a", "b", "c", "t", "x"], [["s", "a"], ["a", "b"], ["b", "t"], ["s", "c"], ["c", "t"], ["t", "x"]]);

  it("returns the fewest-edge path with nodes and edges", () => {
    const p = shortestPath(g(), a("s"), a("t"))!;
    expect(p.length).toBe(2);
    expect(p.nodeIds).toEqual([a("s"), a("c"), a("t")]);
    expect(p.edgeIds).toHaveLength(2);
  });

  it("returns null when no directed path exists (a normal result, not an error)", () => {
    expect(shortestPath(g(), a("x"), a("s"))).toBeNull();
    expect(shortestPath(build(["p", "q"], []), a("p"), a("q"))).toBeNull();
  });

  it("source equals target is the empty path", () => {
    expect(shortestPath(g(), a("s"), a("s"))).toEqual({ nodeIds: [a("s")], edgeIds: [], length: 0 });
  });

  it("respects dependency-type filters and depth", () => {
    const h = build(["s", "m", "t"], [["s", "m", "authority"], ["m", "t", "operational"]]);
    expect(shortestPath(h, a("s"), a("t"), { filter: { dependencyTypes: ["authority"] } })).toBeNull();
    expect(shortestPath(h, a("s"), a("t"))).not.toBeNull();
    expect(shortestPath(h, a("s"), a("t"), { maxDepth: 1 })).toBeNull();
  });

  it("works with cycles and unknown nodes", () => {
    const c = build(["a", "b", "c"], [["a", "b"], ["b", "a"], ["b", "c"]]);
    expect(shortestPath(c, a("a"), a("c"))!.nodeIds).toEqual([a("a"), a("b"), a("c")]);
    expect(() => shortestPath(c, a("a"), "agent:ghost")).toThrow(/not found/i);
  });

  it("requirePath raises PATH_NOT_FOUND for callers that need one", () => {
    expect(() => requirePath(g(), a("x"), a("s"))).toThrow(/No path/);
    try { requirePath(g(), a("x"), a("s")); } catch (e) { expect((e as { code: string }).code).toBe("PATH_NOT_FOUND"); }
  });
});

describe("path discovery", () => {
  const diamond = () => build(["s", "a", "b", "c", "t"], [["s", "a"], ["s", "b"], ["a", "t"], ["b", "t"], ["a", "c"], ["c", "t"]]);

  it("finds all simple paths, shortest first, deterministically", () => {
    const res = findPaths(diamond(), a("s"), a("t"));
    expect(res.found).toBe(true);
    expect(res.paths.map((p) => p.nodeIds.map((n) => n.slice(6)).join(">"))).toEqual(["s>a>t", "s>b>t", "s>a>c>t"]);
    expect(res.shortest!.length).toBe(2);
    expect(res.truncated).toBe(false);
    expect(findPaths(diamond(), a("s"), a("t"))).toEqual(res);
  });

  it("every returned path is simple, directed and uses real edges", () => {
    const g = diamond();
    for (const p of findPaths(g, a("s"), a("t")).paths) {
      expect(new Set(p.nodeIds).size).toBe(p.nodeIds.length);
      p.edgeIds.forEach((id, i) => {
        const e = g.getEdge(id)!;
        expect([e.sourceNodeId, e.targetNodeId]).toEqual([p.nodeIds[i], p.nodeIds[i + 1]]);
      });
    }
  });

  it("limits the number of paths and says so", () => {
    const res = findPaths(diamond(), a("s"), a("t"), { maxPaths: 2 });
    expect(res.paths).toHaveLength(2);
    expect(res).toMatchObject({ truncated: true, truncationReason: "max_paths" });
    expect(findPaths(diamond(), a("s"), a("t"), { maxPaths: 3 })).toMatchObject({ truncated: false });
  });

  it("limits depth", () => {
    expect(findPaths(diamond(), a("s"), a("t"), { maxDepth: 2 }).paths).toHaveLength(2);
  });

  it("returns found:false when there is no path", () => {
    expect(findPaths(diamond(), a("t"), a("s"))).toEqual({ found: false, shortest: null, paths: [], truncated: false, truncationReason: null });
  });

  it("cycles cannot cause repeated nodes or infinite loops", () => {
    const g = build(["s", "a", "b", "t"], [["s", "a"], ["a", "b"], ["b", "a"], ["b", "t"]]);
    const res = findPaths(g, a("s"), a("t"));
    expect(res.paths.map((p) => p.nodeIds.length)).toEqual([4]);
  });

  it("parallel edges between the same nodes are distinct paths", () => {
    const g = build(["s", "t"], [["s", "t", "authority"], ["s", "t", "operational"]]);
    expect(findPaths(g, a("s"), a("t")).paths).toHaveLength(2);
  });

  it("applies filters and rejects over-limit requests with structured errors", () => {
    const g = build(["s", "m", "t"], [["s", "m", "authority"], ["m", "t", "operational"]]);
    expect(findPaths(g, a("s"), a("t"), { filter: { dependencyTypes: ["authority"] } }).found).toBe(false);
    expect(() => findPaths(g, a("s"), a("t"), { maxPaths: LIMITS.maxPaths + 1 })).toThrow(/maxPaths must be at most/);
    expect(() => findPaths(g, a("s"), a("t"), { maxDepth: LIMITS.maxPathDepth + 1 })).toThrow(/at most/);
    expect(() => findPaths(g, a("s"), a("t"), { maxPaths: 0 })).toThrow();
  });

  it("stays bounded on a dense layered graph (enumeration is capped, not exhaustive)", () => {
    // 12 layers x 4 nodes, fully connected between layers: 4^11 paths exist.
    const layers = 12, width = 4;
    const names = ["s", "t"];
    const deps: Array<[string, string]> = [];
    const L = (i: number, j: number) => `l${i}_${j}`;
    for (let i = 0; i < layers; i++) for (let j = 0; j < width; j++) names.push(L(i, j));
    for (let j = 0; j < width; j++) { deps.push(["s", L(0, j)]); deps.push([L(layers - 1, j), "t"]); }
    for (let i = 0; i < layers - 1; i++) for (let j = 0; j < width; j++) for (let k = 0; k < width; k++) deps.push([L(i, j), L(i + 1, k)]);
    const g = build(names, deps);
    const t0 = performance.now();
    const res = findPaths(g, a("s"), a("t"), { maxPaths: 100, maxDepth: 25 });
    expect(res.paths).toHaveLength(100);
    expect(res.truncated).toBe(true);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe("weakly connected components", () => {
  it("groups by connectivity ignoring direction, includes isolated nodes, and is deterministic", () => {
    const g = build(["a", "b", "c", "d", "e", "R:z", "lone"], [["a", "b"], ["c", "b"], ["d", "R:z", "resource"]]);
    const comps = weaklyConnectedComponents(g);
    expect(comps.map((c) => c.nodeIds)).toEqual([[a("a"), a("b"), a("c")], [a("d"), r("z")], [a("e")], [a("lone")]]);
    expect(comps.map((c) => c.edgeCount)).toEqual([2, 1, 0, 0]);
    expect(comps.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(weaklyConnectedComponents(g)).toEqual(comps);
  });

  it("does not duplicate nodes across components", () => {
    const g = build(["a", "b", "c", "d"], [["a", "b"], ["c", "d"], ["b", "c"]]);
    const all = weaklyConnectedComponents(g).flatMap((c) => c.nodeIds);
    expect(all).toHaveLength(4);
    expect(new Set(all).size).toBe(4);
    expect(weaklyConnectedComponents(g)).toHaveLength(1);
  });

  it("applies filters: dropping an edge type can split a component", () => {
    const g = build(["a", "b", "c"], [["a", "b", "authority"], ["b", "c", "operational"]]);
    expect(weaklyConnectedComponents(g)).toHaveLength(1);
    expect(weaklyConnectedComponents(g, { dependencyTypes: ["authority"] }).map((c) => c.nodeIds)).toEqual([[a("a"), a("b")], [a("c")]]);
    expect(weaklyConnectedComponents(g, { entityTypes: ["resource"] })).toEqual([]);
  });

  it("an empty graph has no components", () => {
    expect(weaklyConnectedComponents(build([], []))).toEqual([]);
  });

  it("is not the same as directed reachability", () => {
    const g = build(["a", "b"], [["a", "b"]]);
    expect(weaklyConnectedComponents(g)).toHaveLength(1);
    expect(shortestPath(g, a("b"), a("a"))).toBeNull();
  });
});

describe("cycle detection", () => {
  it("finds a simple directed cycle with its nodes and edges", () => {
    const g = build(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["c", "a"], ["c", "d"]]);
    const rep = detectCycles(g);
    expect(rep.cycles).toHaveLength(1);
    expect(rep.cycles[0]).toMatchObject({ nodeIds: [a("a"), a("b"), a("c")], length: 3 });
    expect(rep.cycles[0]!.edgeIds).toHaveLength(3);
    expect(rep.cyclicComponentCount).toBe(1);
    expect(rep.truncated).toBe(false);
  });

  it("reports nothing for a DAG and for an empty graph", () => {
    expect(detectCycles(build(["a", "b", "c"], [["a", "b"], ["b", "c"], ["a", "c"]]))).toEqual({ cycles: [], cyclicComponentCount: 0, truncated: false, truncationReason: null });
    expect(detectCycles(build([], [])).cycles).toEqual([]);
  });

  it("reports each cycle once, including overlapping cycles", () => {
    const g = build(["a", "b", "c"], [["a", "b"], ["b", "a"], ["b", "c"], ["c", "b"]]);
    const keys = detectCycles(g).cycles.map((c) => c.nodeIds.join(">"));
    expect(keys.sort()).toEqual([`${a("a")}>${a("b")}`, `${a("b")}>${a("c")}`].sort());
  });

  it("does not confuse an undirected loop with a directed cycle", () => {
    expect(detectCycles(build(["a", "b", "c"], [["a", "b"], ["a", "c"], ["b", "c"]])).cycles).toEqual([]);
  });

  it("filters by dependency type: a mixed-type loop is not an operational cycle", () => {
    const g = build(["a", "b"], [["a", "b", "operational"], ["b", "a", "authority"]]);
    expect(detectCycles(g).cycles).toHaveLength(1);
    expect(detectCycles(g, { filter: { dependencyTypes: ["operational"] } }).cycles).toEqual([]);
  });

  it("ignores inactive edges by default", () => {
    const g = build(["a", "b"], [["a", "b"], ["b", "a", "operational", { status: "inactive" }]]);
    expect(detectCycles(g).cycles).toEqual([]);
    expect(detectCycles(g, { filter: { edgeStatuses: ["active", "inactive"] } }).cycles).toHaveLength(1);
  });

  it("parallel edges form distinct cycles", () => {
    const g = build(["a", "b"], [["a", "b", "authority"], ["a", "b", "operational"], ["b", "a", "operational"]]);
    expect(detectCycles(g).cycles).toHaveLength(2);
  });

  it("bounds the report: maxCycles and maxLength", () => {
    // complete digraph on 6 nodes has many cycles
    const names = ["a", "b", "c", "d", "e", "f"];
    const deps: Array<[string, string]> = [];
    for (const x of names) for (const y of names) if (x !== y) deps.push([x, y]);
    const g = build(names, deps);
    const capped = detectCycles(g, { maxCycles: 5 });
    expect(capped.cycles).toHaveLength(5);
    expect(capped).toMatchObject({ truncated: true, truncationReason: "max_cycles" });
    const short = detectCycles(g, { maxLength: 2, maxCycles: 500 });
    expect(short.cycles.every((c) => c.length <= 2)).toBe(true);
    expect(short.cycles).toHaveLength(15);
    expect(() => detectCycles(g, { maxCycles: LIMITS.maxCycles + 1 })).toThrow();
    expect(() => detectCycles(g, { maxLength: LIMITS.maxCycleLength + 1 })).toThrow();
  });

  it("a very long cycle is flagged as a cyclic component even if longer than maxLength; and Tarjan is iterative", () => {
    const n = 20_000;
    const names = Array.from({ length: n }, (_, i) => `n${i}`);
    const deps = names.map((nm, i): [string, string] => [nm, names[(i + 1) % n]!]);
    const g = build(names, deps);
    const rep = detectCycles(g);
    expect(rep.cyclicComponentCount).toBe(1);
    expect(rep.cycles).toEqual([]);
  });

  it("strongly connected components partition the nodes", () => {
    const g = build(["a", "b", "c", "d"], [["a", "b"], ["b", "a"], ["b", "c"], ["c", "d"], ["d", "c"]]);
    const ids = g.nodes().map((n) => n.id);
    const sccs = stronglyConnectedComponents(g, ids, (id) => g.outgoingEdges(id).map((e) => e.targetNodeId));
    expect(sccs).toEqual([[a("a"), a("b")], [a("c"), a("d")]]);
  });
});
