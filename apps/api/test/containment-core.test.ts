import { describe, expect, it } from "vitest";
import { planContainment } from "../src/modules/containment/core/plan.js";
import { FlowNetwork } from "../src/modules/containment/core/maxflow.js";
import { buildGraph } from "../src/modules/graph-engine/core/builder.js";
import { ORG, a, r, spec } from "./graph-fixtures.js";

const G = (names: string[], deps: Parameters<typeof spec>[1]) => buildGraph(ORG, spec(names, deps)).graph;
const edgeId = (g: ReturnType<typeof G>, s: string, t: string, type?: string) =>
  g.edges().find((e) => e.sourceNodeId === s && e.targetNodeId === t && (!type || e.dependencyType === type))!.id;

const acme = () =>
  G(["support", "payment", "analytics", "email", "database", "R:wallet", "R:customerApi"], [
    ["support", "payment", "authority"],
    ["payment", "R:wallet", "resource"],
    ["payment", "R:customerApi", "resource"],
    ["payment", "analytics", "operational"],
    ["analytics", "email", "operational"],
    ["support", "R:customerApi", "resource"],
    ["database", "R:customerApi", "resource"],
  ]);

describe("max flow (Dinic)", () => {
  it("computes classic flows and the residual source side", () => {
    const n = new FlowNetwork(4); // 0 -> 1 (3), 0 -> 2 (2), 1 -> 2 (1), 1 -> 3 (2), 2 -> 3 (3)
    n.addArc(0, 1, 3); n.addArc(0, 2, 2); n.addArc(1, 2, 1); n.addArc(1, 3, 2); n.addArc(2, 3, 3);
    expect(n.maxFlow(0, 3)).toBe(5);
    expect(n.residualReachable(0)).toEqual([true, false, false, false].map(Boolean).map((v, i) => i === 0 ? true : v));
  });
  it("handles parallel arcs, no path and early stop", () => {
    const n = new FlowNetwork(3);
    n.addArc(0, 1, 2); n.addArc(0, 1, 3);
    expect(n.maxFlow(0, 2)).toBe(0);
    const m = new FlowNetwork(2);
    m.addArc(0, 1, 5); m.addArc(0, 1, 5);
    expect(m.maxFlow(0, 1, 7)).toBeGreaterThanOrEqual(7);
  });
  it("survives a 20,000-node chain without recursion", () => {
    const N = 20_000;
    const n = new FlowNetwork(N);
    for (let i = 0; i < N - 1; i++) n.addArc(i, i + 1, i === 9_999 ? 1 : 100);
    expect(n.maxFlow(0, N - 1)).toBe(1);
  });
});

describe("containment plan: the Acme incident", () => {
  const plan = () => planContainment(acme(), { sourceNodeIds: [a("payment")], protectedNodeIds: [r("wallet"), r("customerApi")] });

  it("cuts only the compromised agent's own grants and keeps healthy dependents' access", () => {
    const g = acme();
    const p = plan();
    expect(p.status).toBe("feasible");
    expect(p.totalCost).toBe(2);
    expect(p.actions.map((x) => x.edgeId).sort()).toEqual([edgeId(g, a("payment"), r("wallet")), edgeId(g, a("payment"), r("customerApi"))].sort());
    expect(p.actions.every((x) => x.kind === "revoke_resource_access" && !x.affectsHealthyAgent)).toBe(true);
    // Support's and Database's access to the shared API are untouched
    const cut = new Set(p.actions.map((x) => x.edgeId));
    expect(cut.has(edgeId(g, a("support"), r("customerApi")))).toBe(false);
    expect(cut.has(edgeId(g, a("database"), r("customerApi")))).toBe(false);
    expect(p.verification).toEqual({ protectedUnreachableAfterCut: true, workflowsStillSatisfied: true });
    expect(p.approvalRequired).toBe(false);
  });

  it("explains every action", () => {
    const p = plan();
    for (const act of p.actions) {
      expect(act.why).toMatch(/Revoking .* from payment to/);
      expect(act.exampleAttackPath!.nodeIds[0]).toBe(a("payment"));
      expect(act.blocksProtectedNodeIds.length).toBeGreaterThan(0);
    }
    expect(p.actions.find((x) => x.targetNodeId === r("customerApi"))!.why).toMatch(/Other dependents of customerApi keep their access: database, support/);
  });

  it("does not cut operational links when their targets are not protected", () => {
    expect(plan().actions.some((x) => x.dependencyType === "operational")).toBe(false);
  });

  it("protecting a downstream agent cuts the operational trigger", () => {
    const p = planContainment(acme(), { sourceNodeIds: [a("payment")], protectedNodeIds: [a("email")] });
    expect(p.actions).toHaveLength(1);
    expect(p.actions[0]).toMatchObject({ kind: "block_operational_trigger", sourceNodeId: a("payment"), targetNodeId: a("analytics") });
  });
});

describe("containment plan: closest to the source and cost", () => {
  it("prefers the cut next to the compromised agent among equal-cost cuts", () => {
    const g = G(["c", "m", "R:t"], [["c", "m", "operational"], ["m", "R:t", "resource"]]);
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")] });
    expect(p.actions).toHaveLength(1);
    expect(p.actions[0]!.sourceNodeId).toBe(a("c")); // c -> m, not m -> t
  });

  it("uses per-edge costs to move the cut", () => {
    const g = G(["c", "m", "R:t"], [["c", "m", "operational"], ["m", "R:t", "resource"]]);
    const cheap = edgeId(g, a("m"), r("t"));
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], coverage: { edgeCosts: { [edgeId(g, a("c"), a("m"))]: 10, [cheap]: 2 } } });
    expect(p.actions.map((x) => x.edgeId)).toEqual([cheap]);
    expect(p.totalCost).toBe(2);
  });

  it("finds a true minimum cut over several paths (cheaper to cut the shared bottleneck)", () => {
    const g = G(["s", "a", "b", "m", "R:t"], [["s", "a"], ["s", "b"], ["a", "m"], ["b", "m"], ["m", "R:t", "resource"]]);
    const p = planContainment(g, { sourceNodeIds: [a("s")], protectedNodeIds: [r("t")] });
    expect(p.totalCost).toBe(1);
    expect(p.actions[0]).toMatchObject({ sourceNodeId: a("m"), targetNodeId: r("t") });
  });

  it("cuts parallel dependencies between the same pair separately", () => {
    const g = G(["c", "R:t"], [["c", "R:t", "resource"], ["c", "R:t", "resource", { relationship: "second" }]]);
    // second dependency of the same type/pair is a different row in the fixture
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")] });
    expect(p.actions).toHaveLength(2);
  });

  it("plans for several compromised agents and several protected nodes", () => {
    const g = G(["c1", "c2", "R:t1", "R:t2", "h"], [["c1", "R:t1", "resource"], ["c2", "R:t2", "resource"], ["h", "R:t1", "resource"]]);
    const p = planContainment(g, { sourceNodeIds: [a("c2"), a("c1")], protectedNodeIds: [r("t1"), r("t2")] });
    expect(p.actions).toHaveLength(2);
    expect(p.actions.map((x) => x.sourceNodeId).sort()).toEqual([a("c1"), a("c2")]);
  });
});

describe("containment plan: healthy workflows and coverage", () => {
  it("preserves a workflow by cutting elsewhere", () => {
    // c -> m -> t is the attack; the healthy workflow needs h -> m, which is not cut
    const g = G(["c", "h", "m", "R:t"], [["c", "m", "operational"], ["h", "m", "operational"], ["m", "R:t", "resource"]]);
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], healthyWorkflows: [{ id: "wf", from: a("h"), to: a("m") }] });
    expect(p.status).toBe("feasible");
    expect(p.preservedWorkflows[0]).toMatchObject({ id: "wf", satisfied: true, preservedEdgeIds: [edgeId(g, a("h"), a("m"))] });
    expect(p.verification.workflowsStillSatisfied).toBe(true);
  });

  it("a workflow that needs the shared edge forces a different cut", () => {
    // attack c -> m -> t; healthy workflow x -> m -> t needs m -> t, so the cut must be c -> m
    const g = G(["c", "x", "m", "R:t"], [["c", "m", "operational"], ["x", "m", "operational"], ["m", "R:t", "resource"]]);
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], healthyWorkflows: [{ id: "wf", from: a("x"), to: r("t") }] });
    expect(p.status).toBe("feasible");
    expect(p.actions.map((x) => x.sourceNodeId)).toEqual([a("c")]);
    expect(p.preservedWorkflows[0]!.preservedEdgeIds).toHaveLength(2);
  });

  it("is infeasible when the only attack path is a preserved workflow, and names the blockers", () => {
    const g = G(["c", "R:t"], [["c", "R:t", "resource"]]);
    const e = edgeId(g, a("c"), r("t"));
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], healthyWorkflows: [{ id: "payments", edgeIds: [e] }] });
    expect(p.status).toBe("infeasible");
    expect(p.actions).toEqual([]);
    expect(p.blockers).toEqual([{ edgeId: e, sourceNodeId: a("c"), targetNodeId: r("t"), reason: "preserved_by_workflow", workflowIds: ["payments"] }]);
    expect(p.verification.protectedUnreachableAfterCut).toBe(false);
  });

  it("is infeasible when the attack path cannot be revoked", () => {
    const g = G(["c", "m", "R:t"], [["c", "m", "operational"], ["m", "R:t", "resource"]]);
    const all = g.edges().map((e) => e.id);
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], coverage: { uncontrollableEdgeIds: all } });
    expect(p.status).toBe("infeasible");
    expect(p.blockers.map((b) => b.reason)).toEqual(["not_controllable", "not_controllable"]);
  });

  it("routes around an uncontrollable edge when another cut exists", () => {
    const g = G(["c", "m", "R:t"], [["c", "m", "operational"], ["m", "R:t", "resource"]]);
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], coverage: { uncontrollableEdgeIds: [edgeId(g, a("c"), a("m"))] } });
    expect(p.actions.map((x) => x.sourceNodeId)).toEqual([a("m")]);
  });

  it("reports a workflow with no path instead of failing", () => {
    const g = G(["c", "x", "y", "R:t"], [["c", "R:t", "resource"]]);
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], healthyWorkflows: [{ id: "gone", from: a("x"), to: a("y") }] });
    expect(p.status).toBe("feasible");
    expect(p.preservedWorkflows[0]).toMatchObject({ id: "gone", satisfied: false });
    expect(p.preservedWorkflows[0]!.note).toMatch(/No path exists/);
  });

  it("prefers a workflow path outside the attack region", () => {
    // x -> R:t has two routes: via the compromised c (attack region) or via h; the planner should pin the h route
    const g = G(["c", "x", "h", "R:t"], [["x", "c", "operational"], ["c", "R:t", "resource"], ["x", "h", "operational"], ["h", "R:t", "resource"]]);
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], healthyWorkflows: [{ id: "wf", from: a("x"), to: r("t") }] });
    expect(p.status).toBe("feasible");
    expect(p.preservedWorkflows[0]!.pathNodeIds).toEqual([a("x"), a("h"), r("t")]);
  });
});

describe("containment plan: approval", () => {
  it("requires approval when a healthy agent would lose access", () => {
    // protected resource only reachable through a healthy agent's edge once c's own edge is fixed
    const g = G(["c", "h", "R:t"], [["c", "h", "operational"], ["h", "R:t", "resource"]]);
    const eCH = edgeId(g, a("c"), a("h"));
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], coverage: { uncontrollableEdgeIds: [eCH] } });
    expect(p.actions[0]).toMatchObject({ sourceNodeId: a("h"), affectsHealthyAgent: true });
    expect(p.approvalRequired).toBe(true);
    expect(p.approvalReasons).toContain("affects_healthy_agent");
  });

  it("requires approval for uncertain edges, high-value targets and over-threshold cost", () => {
    const g = G(["c", "R:t"], [["c", "R:t", "resource", { confidence: 0.2 }]]);
    const p = planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")], options: { highValueNodeIds: [r("t")], costApprovalThreshold: 0 } });
    expect(p.approvalReasons).toEqual(["cost_threshold", "high_value_target", "uncertain_dependencies_in_attack_region", "uncertain_dependency"]);
    expect(p.uncertainDependencyEdgeIds).toHaveLength(1);
  });

  it("an own-grants-only plan on certain edges needs no approval", () => {
    expect(planContainment(acme(), { sourceNodeIds: [a("payment")], protectedNodeIds: [r("wallet")] }).approvalRequired).toBe(false);
  });
});

describe("containment plan: no action, validation, determinism", () => {
  it("reports no action needed when protected nodes are unreachable", () => {
    const p = planContainment(acme(), { sourceNodeIds: [a("database")], protectedNodeIds: [r("wallet")] });
    expect(p.status).toBe("no_action_needed");
    expect(p.actions).toEqual([]);
    expect(p.verification.protectedUnreachableAfterCut).toBe(true);
  });

  it("rejects bad input", () => {
    const g = acme();
    const base = { sourceNodeIds: [a("payment")], protectedNodeIds: [r("wallet")] };
    expect(() => planContainment(g, { ...base, protectedNodeIds: [] })).toThrow(/protected node is required/);
    expect(() => planContainment(g, { ...base, protectedNodeIds: ["resource:ghost"] })).toThrow(/not found/);
    expect(() => planContainment(g, { ...base, protectedNodeIds: [a("payment")] })).toThrow(/cannot also be a protected/);
    expect(() => planContainment(g, { ...base, sourceNodeIds: [r("wallet")] })).toThrow(/must be an agent/);
    expect(() => planContainment(g, { ...base, coverage: { defaultCost: 0 } })).toThrow(/Costs must be integers/);
    expect(() => planContainment(g, { ...base, coverage: { edgeCosts: { x: 1.5 } } })).toThrow(/Costs must be integers/);
    expect(() => planContainment(g, { ...base, healthyWorkflows: [{ id: "w" }] })).toThrow(/needs either/);
    expect(() => planContainment(g, { ...base, healthyWorkflows: [{ id: "w", edgeIds: ["nope"] }] })).toThrow(/not an active edge/);
    expect(() => planContainment(g, { ...base, healthyWorkflows: [{ id: "w", from: "agent:x", to: a("email") }] })).toThrow(/unknown node/);
    expect(() => planContainment(g, { ...base, healthyWorkflows: [{ id: "w", from: a("support"), to: a("payment") }, { id: "w", from: a("support"), to: a("payment") }] })).toThrow(/unique/);
  });

  it("is deterministic and the hash is stable under reordering", () => {
    const g = acme();
    const base = { sourceNodeIds: [a("payment")], protectedNodeIds: [r("wallet"), r("customerApi")] };
    const one = planContainment(g, base);
    const two = planContainment(g, { ...base, protectedNodeIds: [r("customerApi"), r("wallet"), r("wallet")] });
    expect(two).toEqual(one);
    expect(one.planHash).toMatch(/^[0-9a-f]{64}$/);
    const changed = planContainment(g, { ...base, protectedNodeIds: [r("wallet")] });
    expect(changed.planHash).not.toBe(one.planHash);
  });

  it("ignores inactive edges and never mutates the graph", () => {
    const g = G(["c", "R:t"], [["c", "R:t", "resource", { status: "inactive" }]]);
    const before = JSON.stringify(g.edges());
    expect(planContainment(g, { sourceNodeIds: [a("c")], protectedNodeIds: [r("t")] }).status).toBe("no_action_needed");
    expect(JSON.stringify(g.edges())).toBe(before);
  });

  it("states its limitations", () => {
    expect(planContainment(acme(), { sourceNodeIds: [a("payment")], protectedNodeIds: [r("wallet")] }).limitations.join(" ")).toMatch(/sound but not complete.*Planned is not approved/s);
  });
});

describe("containment plan: agrees with brute force on random graphs", () => {
  // tiny deterministic PRNG
  const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  it("matches the exact optimum (cost and feasibility) on 200 random instances", () => {
    const rnd = prng(2026);
    let feasible = 0, infeasible = 0;
    for (let round = 0; round < 200; round++) {
      const n = 4 + Math.floor(rnd() * 3); // 4..6 nodes
      const names = Array.from({ length: n }, (_, i) => `n${i}`);
      const deps: Array<[string, string]> = [];
      const seen = new Set<string>();
      const m = 4 + Math.floor(rnd() * 7); // 4..10 edges
      for (let k = 0; k < m; k++) {
        const s = Math.floor(rnd() * n), t = Math.floor(rnd() * n);
        if (s !== t && !seen.has(`${s}>${t}`)) { seen.add(`${s}>${t}`); deps.push([names[s]!, names[t]!]); }
      }
      const g = G(names, deps);
      const edges = g.edges();
      const costs: Record<string, number> = {};
      const fixed = new Set<string>();
      for (const e of edges) { costs[e.id] = 1 + Math.floor(rnd() * 4); if (rnd() < 0.25) fixed.add(e.id); }
      const src = a("n0"), prot = a(`n${n - 1}`);
      const plan = planContainment(g, { sourceNodeIds: [src], protectedNodeIds: [prot], coverage: { edgeCosts: costs, uncontrollableEdgeIds: [...fixed] } });

      // brute force over subsets of controllable edges
      const ctl = edges.filter((e) => !fixed.has(e.id));
      const reaches = (cut: Set<string>) => {
        const seenN = new Set([src]); const q = [src];
        for (let h = 0; h < q.length; h++) for (const e of g.outgoingEdges(q[h]!)) if (!cut.has(e.id) && !seenN.has(e.targetNodeId)) { seenN.add(e.targetNodeId); q.push(e.targetNodeId); }
        return seenN.has(prot);
      };
      let best = Infinity;
      for (let mask = 0; mask < 1 << ctl.length; mask++) {
        const cut = new Set<string>(); let cost = 0;
        ctl.forEach((e, i) => { if (mask & (1 << i)) { cut.add(e.id); cost += costs[e.id]!; } });
        if (cost < best && !reaches(cut)) best = cost;
      }
      if (!reaches(new Set())) { expect(plan.status).toBe("no_action_needed"); continue; }
      if (best === Infinity) { infeasible++; expect(plan.status).toBe("infeasible"); }
      else {
        feasible++;
        expect(plan.status).toBe("feasible");
        expect(plan.totalCost).toBe(best);
        expect(plan.verification.protectedUnreachableAfterCut).toBe(true);
        expect(plan.actions.every((x) => !fixed.has(x.edgeId))).toBe(true);
      }
    }
    expect(feasible).toBeGreaterThan(30);
    expect(infeasible).toBeGreaterThan(5);
  });
});

describe("containment plan: scale", () => {
  it("plans on 1,000 nodes / 5,000 edges quickly", () => {
    const rnd = (() => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); })();
    const names = Array.from({ length: 1000 }, (_, i) => `n${i}`);
    const seen = new Set<string>();
    const deps: Array<[string, string]> = [];
    while (deps.length < 5000) { const s = Math.floor(rnd() * 1000), t = Math.floor(rnd() * 1000); if (s !== t && !seen.has(`${s}>${t}`)) { seen.add(`${s}>${t}`); deps.push([names[s]!, names[t]!]); } }
    const g = G(names, deps);
    const t0 = performance.now();
    const p = planContainment(g, { sourceNodeIds: [a("n0")], protectedNodeIds: [a("n999"), a("n500")] });
    const ms = performance.now() - t0;
    process.stdout.write(`\n[containment] 1,000 nodes / 5,000 edges: status ${p.status}, ${p.actions.length} actions, ${Math.round(ms)} ms\n`);
    expect(["feasible", "no_action_needed"]).toContain(p.status);
    expect(p.verification.protectedUnreachableAfterCut).toBe(true);
    expect(ms).toBeLessThan(5000);
  });
});
