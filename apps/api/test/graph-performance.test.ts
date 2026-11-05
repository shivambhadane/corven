import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGraph } from "../src/modules/graph-engine/core/builder.js";
import { weaklyConnectedComponents } from "../src/modules/graph-engine/core/components.js";
import { detectCycles } from "../src/modules/graph-engine/core/cycles.js";
import { exportGraph } from "../src/modules/graph-engine/core/export.js";
import { findPaths, shortestPath } from "../src/modules/graph-engine/core/paths.js";
import { bfs, dfs, reachability } from "../src/modules/graph-engine/core/traversal.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";
import { ORG, spec } from "./graph-fixtures.js";

/**
 * Initial engineering targets from the PRD: 1,000 nodes / 5,000 edges.
 * These tests MEASURE and print timings; the assertions are deliberately
 * generous ceilings, not claims of production capacity.
 */
const NODES = 1000;
const EDGES = 5000;
const timings: Record<string, number> = {};
const time = <T>(label: string, fn: () => T): T => {
  const t0 = performance.now();
  const out = fn();
  timings[label] = Math.round((performance.now() - t0) * 100) / 100;
  return out;
};

// small deterministic PRNG so runs are comparable
const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

describe("performance: 1,000 nodes / 5,000 edges (in memory)", () => {
  const rnd = prng(42);
  const names = [...Array.from({ length: 800 }, (_, i) => `a${i}`), ...Array.from({ length: 200 }, (_, i) => `R:r${i}`)];
  const seen = new Set<string>();
  const deps: Array<[string, string, string]> = [];
  while (deps.length < EDGES) {
    const s = names[Math.floor(rnd() * 800)]!; // sources are agents
    const t = names[Math.floor(rnd() * NODES)]!;
    if (s === t || seen.has(`${s}>${t}`)) continue;
    seen.add(`${s}>${t}`);
    deps.push([s, t, t.startsWith("R:") ? "resource" : "operational"]);
  }
  const input = spec(names, deps);

  const built = time("build", () => buildGraph(ORG, input));
  const g = built.graph;

  afterAll(() => {
    process.stdout.write(`\n[graph performance, ${NODES} nodes / ${EDGES} edges] ${JSON.stringify(timings)} (ms)\n`);
  });

  it("builds the expected graph quickly", () => {
    expect(g.metadata).toMatchObject({ nodeCount: NODES, edgeCount: EDGES });
    expect(built.report.issues).toEqual([]);
    expect(timings.build).toBeLessThan(2000);
  });

  it("traverses, finds reachability and shortest paths", () => {
    const start = "agent:a0";
    const b = time("bfs", () => bfs(g, start, { maxDepth: 100 }));
    const d = time("dfs", () => dfs(g, start, { maxDepth: 100 }));
    expect(new Set(d.visited.map((v) => v.nodeId))).toEqual(new Set(b.visited.map((v) => v.nodeId)));
    expect(b.visited.length).toBeGreaterThan(100);
    time("reachability", () => reachability(g, start, "agent:a799", { maxDepth: 100 }));
    time("shortestPath", () => shortestPath(g, start, "agent:a799", { maxDepth: 100 }));
    for (const k of ["bfs", "dfs", "reachability", "shortestPath"]) expect(timings[k]).toBeLessThan(1000);
  });

  it("bounded path enumeration, components, cycles and export stay within bounds", () => {
    const paths = time("findPaths(max 100)", () => findPaths(g, "agent:a0", "agent:a799", { maxPaths: 100, maxDepth: 8 }));
    expect(paths.paths.length).toBeLessThanOrEqual(100);
    const comps = time("components", () => weaklyConnectedComponents(g));
    expect(comps.reduce((n, c) => n + c.nodeIds.length, 0)).toBe(NODES);
    const cyc = time("cycles(max 50)", () => detectCycles(g, { maxCycles: 50, maxLength: 6 }));
    expect(cyc.cycles.length).toBeLessThanOrEqual(50);
    const ex = time("export", () => exportGraph(g));
    expect(ex.edges).toHaveLength(EDGES);
    for (const k of ["findPaths(max 100)", "components", "cycles(max 50)", "export"]) expect(timings[k]).toBeLessThan(5000);
  });
});

describe("performance: end to end through the API and PostgreSQL", () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createCtx();
  });
  afterAll(() => ctx.close());

  it("builds a 1,000-node / 5,000-edge organization from the registries", async () => {
    const w = who("operator", randomUUID());
    const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);
    await q("insert into agents (organization_id, name, agent_type) select $1, 'agent-' || g, 'llm' from generate_series(1, 1000) g", [w.org]);
    await q(
      `with ranked as (select id, row_number() over (order by name) rn from agents where organization_id = $1)
       insert into dependencies (organization_id, source_type, source_agent_id, target_type, target_agent_id, dependency_type, relationship, provenance, confidence)
       select $1, 'agent', s.id, 'agent', t.id, 'operational', 'calls', '{"source":"manual"}', 0.9
       from generate_series(0, 4999) i
       join ranked s on s.rn = (i % 1000) + 1
       join ranked t on t.rn = ((i % 1000) + (i / 1000) + 1) % 1000 + 1`,
      [w.org],
    );
    const api = client(ctx.app);
    const t0 = performance.now();
    const res = await api.post("/api/v1/graph/build", w);
    const wall = Math.round(performance.now() - t0);
    expect(res.status).toBe(200);
    expect(res.body.data.metadata).toMatchObject({ nodeCount: 1000, edgeCount: 5000 });
    expect(res.body.data.report.issues).toEqual([]);
    process.stdout.write(`\n[graph e2e] POST /build: server build ${res.body.data.metadata.durationMs} ms (registries -> graph), request wall time ${wall} ms\n`);
    expect(wall).toBeLessThan(10_000);

    const t1 = performance.now();
    const reach = await api.get(`/api/v1/graph/reachability?sourceNodeId=agent:${(await q("select id from agents where organization_id=$1 and name='agent-1'", [w.org])).rows[0].id}&targetNodeId=agent:${(await q("select id from agents where organization_id=$1 and name='agent-500'", [w.org])).rows[0].id}&maxDepth=100`, w);
    expect(reach.status).toBe(200);
    process.stdout.write(`[graph e2e] GET /reachability (includes a full rebuild): ${Math.round(performance.now() - t1)} ms\n`);
  });
});
