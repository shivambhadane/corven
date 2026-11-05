import { describe, expect, it } from "vitest";
import { bfs, dfs, reachability } from "../src/modules/graph-engine/core/traversal.js";
import { GraphError } from "../src/modules/graph-engine/errors.js";
import { a, build, r } from "./graph-fixtures.js";

// support -> payment -> analytics -> email ;  payment -> R:wallet ; db -> R:api ; support -> db
const world = () =>
  build(
    ["support", "payment", "analytics", "email", "db", "R:wallet", "R:api", "island"],
    [
      ["support", "payment", "authority"],
      ["payment", "analytics", "operational"],
      ["analytics", "email", "operational"],
      ["payment", "R:wallet", "resource"],
      ["support", "db", "operational"],
      ["db", "R:api", "resource"],
    ],
  );

describe("BFS", () => {
  it("visits each node once with minimum depth and reports the discovered relationships", () => {
    const res = bfs(world(), a("support"));
    expect(res.visited.map((v) => [v.nodeId, v.depth])).toEqual([
      [a("support"), 0], [a("db"), 1], [a("payment"), 1], [r("api"), 2], [a("analytics"), 2], [r("wallet"), 2], [a("email"), 3],
    ]);
    expect(res.visited[0]).toMatchObject({ viaEdgeId: null, fromNodeId: null });
    expect(res.visited.find((v) => v.nodeId === a("email"))).toMatchObject({ fromNodeId: a("analytics") });
    expect(res.edgeIds).toHaveLength(6);
    expect(res.truncatedByDepth).toBe(false);
    expect(new Set(res.visited.map((v) => v.nodeId)).size).toBe(res.visited.length);
  });

  it("honours maxDepth and says when it cut something off", () => {
    const res = bfs(world(), a("support"), { maxDepth: 1 });
    expect(res.visited.map((v) => v.nodeId)).toEqual([a("support"), a("db"), a("payment")]);
    expect(res.truncatedByDepth).toBe(true);
    expect(bfs(world(), a("support"), { maxDepth: 3 }).truncatedByDepth).toBe(false);
    expect(bfs(world(), a("support"), { maxDepth: 0 }).visited).toHaveLength(1);
  });

  it("traverses in reverse and does not assume symmetry", () => {
    const g = world();
    expect(bfs(g, a("email"), { direction: "reverse" }).visited.map((v) => v.nodeId)).toEqual([a("email"), a("analytics"), a("payment"), a("support")]);
    expect(bfs(g, a("email")).visited).toHaveLength(1); // nothing downstream of email
    expect(bfs(g, a("payment"), { direction: "both", maxDepth: 1 }).visited.map((v) => v.nodeId).sort()).toEqual([r("wallet"), a("analytics"), a("payment"), a("support")].sort());
  });

  it("filters by dependency type, status and confidence consistently", () => {
    const g = build(["x", "y", "z"], [["x", "y", "authority"], ["y", "z", "operational"], ["x", "z", "operational", { status: "inactive" }], ["x", "y", "resource" as never, { dependencyType: "operational", confidence: 0.3 }]]);
    expect(bfs(g, a("x"), { filter: { dependencyTypes: ["authority"] } }).visited.map((v) => v.nodeId)).toEqual([a("x"), a("y")]);
    expect(bfs(g, a("x"), { filter: { dependencyTypes: ["operational"] } }).visited.map((v) => v.nodeId)).toEqual([a("x"), a("y"), a("z")]);
    expect(bfs(g, a("x"), { filter: { edgeStatuses: ["inactive"] } }).visited.map((v) => v.nodeId)).toEqual([a("x"), a("z")]);
    expect(bfs(g, a("x"), { filter: { minConfidence: 0.5, dependencyTypes: ["operational"] } }).visited.map((v) => v.nodeId)).toEqual([a("x")]);
  });

  it("filters by entity type and node status (excluded nodes block traversal)", () => {
    const g = world();
    expect(bfs(g, a("support"), { filter: { entityTypes: ["agent"] } }).visited.map((v) => v.nodeId).every((id) => id.startsWith("agent:"))).toBe(true);
    const compromised = build(["s", "m", "t"], [["s", "m"], ["m", "t"]]);
    expect(bfs(compromised, a("s"), { filter: { nodeStatuses: ["suspended"] } }).visited.map((v) => v.nodeId)).toEqual([a("s")]);
  });

  it("is safe on cycles", () => {
    const g = build(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]]);
    expect(bfs(g, a("a")).visited).toHaveLength(3);
    expect(bfs(g, a("a"), { direction: "reverse" }).visited).toHaveLength(3);
  });

  it("rejects an unknown start node and bad depths with structured errors", () => {
    expect(() => bfs(world(), "agent:ghost")).toThrowError(GraphError);
    expect(() => bfs(world(), "agent:ghost")).toThrow(/not found/i);
    expect(() => bfs(world(), a("support"), { maxDepth: 101 })).toThrow(/at most 100/);
    expect(() => bfs(world(), a("support"), { maxDepth: -1 })).toThrow();
    expect(() => bfs(world(), a("support"), { maxDepth: 1.5 })).toThrow();
    expect(() => bfs(world(), a("support"), { filter: { dependencyTypes: ["bogus" as never] } })).toThrow(/Unknown dependency type/);
    expect(() => bfs(world(), a("support"), { filter: { minConfidence: 2 } })).toThrow(/minConfidence/);
  });

  it("handles an isolated node", () => {
    expect(bfs(world(), a("island")).visited).toHaveLength(1);
  });
});

describe("DFS", () => {
  it("visits each node once, pre-order, smallest neighbour first", () => {
    const res = dfs(world(), a("support"));
    expect(res.visited.map((v) => v.nodeId)).toEqual([a("support"), a("db"), r("api"), a("payment"), a("analytics"), a("email"), r("wallet")]);
    expect(new Set(res.visited.map((v) => v.nodeId)).size).toBe(7);
  });

  it("covers the same nodes as BFS", () => {
    const g = world();
    expect(new Set(dfs(g, a("support")).visited.map((v) => v.nodeId))).toEqual(new Set(bfs(g, a("support")).visited.map((v) => v.nodeId)));
  });

  it("handles cycles without infinite recursion and respects maxDepth", () => {
    const g = build(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]]);
    expect(dfs(g, a("a")).visited).toHaveLength(3);
    const limited = dfs(g, a("a"), { maxDepth: 1 });
    expect(limited.visited.map((v) => v.nodeId)).toEqual([a("a"), a("b")]);
    expect(limited.truncatedByDepth).toBe(true);
  });

  it("supports reverse direction and filters", () => {
    const g = world();
    expect(dfs(g, a("email"), { direction: "reverse" }).visited.map((v) => v.nodeId)).toEqual([a("email"), a("analytics"), a("payment"), a("support")]);
    expect(dfs(g, a("support"), { filter: { dependencyTypes: ["authority"] } }).visited.map((v) => v.nodeId)).toEqual([a("support"), a("payment")]);
  });

  it("depth-limited DFS finds exactly the nodes BFS finds, with the same minimum depths (random graphs)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let round = 0; round < 25; round++) {
      const n = 40;
      const names = Array.from({ length: n }, (_, i) => `n${i}`);
      const seen = new Set<string>();
      const deps: Array<[string, string]> = [];
      for (let k = 0; k < 110; k++) {
        const s = Math.floor(rnd() * n), t = Math.floor(rnd() * n);
        if (s !== t && !seen.has(`${s}>${t}`)) { seen.add(`${s}>${t}`); deps.push([names[s]!, names[t]!]); }
      }
      const g = build(names, deps);
      for (const maxDepth of [1, 2, 3, 5, 8, 100]) {
        for (const direction of ["forward", "reverse", "both"] as const) {
          const b = bfs(g, a("n0"), { maxDepth, direction });
          const d = dfs(g, a("n0"), { maxDepth, direction });
          const depthOf = (r: typeof b) => new Map(r.visited.map((v) => [v.nodeId, v.depth]));
          expect(depthOf(d)).toEqual(depthOf(b));
          expect(d.truncatedByDepth).toBe(b.truncatedByDepth);
        }
      }
    }
  });

  it("handles a 40,000-node chain, stopping at the depth limit (traversal depth is capped at 100)", () => {
    const n = 40_000;
    const names = Array.from({ length: n }, (_, i) => `n${i}`);
    const deps = names.slice(1).map((nm, i): [string, string] => [names[i]!, nm]);
    const g = build(names, deps);
    const res = dfs(g, a("n0"), { maxDepth: 100 });
    expect(res.visited).toHaveLength(101);
    expect(res.truncatedByDepth).toBe(true);
  });
});

describe("reachability", () => {
  it("is true along a directed path and false against it", () => {
    const g = world();
    expect(reachability(g, a("support"), a("email"))).toMatchObject({ reachable: true, depth: 3 });
    expect(reachability(g, a("email"), a("support"))).toMatchObject({ reachable: false, depth: null });
    expect(reachability(g, a("email"), a("support"), { direction: "reverse" })).toMatchObject({ reachable: true, depth: 3 });
    expect(reachability(g, a("support"), a("island"))).toMatchObject({ reachable: false });
  });

  it("treats a node as reaching itself", () => {
    expect(reachability(world(), a("island"), a("island"))).toEqual({ reachable: true, depth: 0, truncatedByDepth: false });
  });

  it("respects filters: an authority-only view cannot reach through operational edges", () => {
    const g = world();
    expect(reachability(g, a("support"), a("analytics"), { filter: { dependencyTypes: ["authority"] } }).reachable).toBe(false);
    expect(reachability(g, a("support"), a("payment"), { filter: { dependencyTypes: ["authority"] } }).reachable).toBe(true);
  });

  it("respects maxDepth and reports when the limit may have hidden an answer", () => {
    const g = world();
    expect(reachability(g, a("support"), a("email"), { maxDepth: 2 })).toEqual({ reachable: false, depth: null, truncatedByDepth: true });
    expect(reachability(g, a("support"), a("island"), { maxDepth: 10 }).truncatedByDepth).toBe(false);
  });

  it("direction 'both' ignores edge direction only when asked", () => {
    expect(reachability(world(), a("email"), a("support"), { direction: "both" }).reachable).toBe(true);
  });

  it("throws NODE_NOT_FOUND for unknown endpoints", () => {
    expect(() => reachability(world(), a("support"), "agent:ghost")).toThrow(/not found/i);
    expect(() => reachability(world(), "agent:ghost", a("support"))).toThrow(/not found/i);
  });
});
