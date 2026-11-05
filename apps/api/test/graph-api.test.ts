import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GraphError } from "../src/modules/graph-engine/errors.js";
import { GraphQueryService } from "../src/modules/graph-engine/services/graph-query.service.js";
import { authority, createDep, mkAgent, mkAgents, mkResource, operational, resourceDep } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx, type Who } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());
const G = "/api/v1/graph";
const A = (id: string) => `agent:${id}`;
const R = (id: string) => `resource:${id}`;

/**
 * support -(authority)-> payment -(operational)-> analytics -(operational)-> email
 * payment -(resource)-> wallet ; support -(resource)-> customerApi ; db -(resource)-> customerApi
 * analytics -(operational)-> payment   (a legitimate operational cycle)
 */
async function world(w: Who = who("operator")) {
  const [support, payment, analytics, email] = await mkAgents(api, w, 4);
  const db = await mkAgent(api, w);
  const loner = await mkAgent(api, w);
  const wallet = await mkResource(api, w);
  const customerApi = await mkResource(api, w);
  const deps = {
    sp: await createDep(api, w, authority(support, payment)),
    pa: await createDep(api, w, operational(payment, analytics)),
    ae: await createDep(api, w, operational(analytics, email)),
    ap: await createDep(api, w, operational(analytics, payment)),
    pw: await createDep(api, w, resourceDep(payment, wallet)),
    sc: await createDep(api, w, resourceDep(support, customerApi)),
    dc: await createDep(api, w, resourceDep(db, customerApi, { confidence: 0.4 })),
  };
  return { w, support, payment, analytics, email, db, loner, wallet, customerApi, deps };
}

describe("build and overview", () => {
  it("builds a graph from canonical registry data, with shared resources once", async () => {
    const t = await world();
    const res = await api.post(`${G}/build`, t.w);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.organizationId).toBe(t.w.org);
    expect(d.metadata).toMatchObject({ nodeCount: 8, edgeCount: 7 });
    expect(d.metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(d.nodesByEntityType).toEqual({ agent: 6, resource: 2 });
    expect(d.edgesByDependencyType).toEqual({ authority: 1, operational: 3, resource: 3 });
    expect(d.report).toEqual({ invalidNodeCount: 0, invalidEdgeCount: 0, issues: [], issuesTruncated: false });
    const incoming = await api.get(`${G}/edges?targetNodeId=${R(t.customerApi)}`, t.w);
    expect(incoming.body.data.map((e: any) => e.sourceNodeId).sort()).toEqual([A(t.db), A(t.support)].sort());
  });

  it("GET / matches and counts inactive edges separately", async () => {
    const t = await world();
    await api.delete(`/api/v1/dependencies/${t.deps.ae.id}`, t.w);
    const d = (await api.get(G, t.w)).body.data;
    expect(d.edgesByStatus).toEqual({ active: 6, inactive: 1 });
    expect(d.metadata.edgeCount).toBe(7);
  });

  it("an empty organization yields an empty graph", async () => {
    const d = (await api.get(G, who("viewer"))).body.data;
    expect(d.metadata).toMatchObject({ nodeCount: 0, edgeCount: 0 });
  });

  it("is read-only: building does not change any registry record", async () => {
    const t = await world();
    const snap = async () =>
      JSON.stringify([
        (await ctx.handle.pool.query("select id, updated_at, status, version from dependencies where organization_id=$1 order by id", [t.w.org])).rows,
        (await ctx.handle.pool.query("select id, updated_at, status from agents where organization_id=$1 order by id", [t.w.org])).rows,
        (await ctx.handle.pool.query("select count(*) from dependency_versions where organization_id=$1", [t.w.org])).rows,
        (await ctx.handle.pool.query("select count(*) from dependency_audit_logs where organization_id=$1", [t.w.org])).rows,
      ]);
    const before = await snap();
    await api.post(`${G}/build`, t.w);
    await api.get(`${G}/export`, t.w);
    await api.get(`${G}/cycles`, t.w);
    expect(await snap()).toBe(before);
  });

  it("is deterministic: two builds export identical nodes and edges", async () => {
    const t = await world();
    const one = (await api.get(`${G}/export`, t.w)).body.data;
    const two = (await api.get(`${G}/export`, t.w)).body.data;
    expect({ ...two, builtAt: 0 }).toEqual({ ...one, builtAt: 0 });
  });
});

describe("nodes and edges", () => {
  it("lists and filters nodes with pagination", async () => {
    const t = await world();
    expect((await api.get(`${G}/nodes?entityType=resource`, t.w)).body.pagination.total).toBe(2);
    expect((await api.get(`${G}/nodes?entityType=agent&status=active`, t.w)).body.pagination.total).toBe(6);
    await api.post(`/api/v1/agents/${t.loner}/status`, t.w, { status: "suspended", reason: "routine check" });
    expect((await api.get(`${G}/nodes?status=suspended`, t.w)).body.data.map((n: any) => n.entityId)).toEqual([t.loner]);
    const p1 = await api.get(`${G}/nodes?limit=5&page=1`, t.w);
    const p2 = await api.get(`${G}/nodes?limit=5&page=2`, t.w);
    expect(p1.body.pagination).toEqual({ page: 1, limit: 5, total: 8, totalPages: 2 });
    expect([...p1.body.data, ...p2.body.data].map((n: any) => n.id)).toEqual((await api.get(`${G}/nodes`, t.w)).body.data.map((n: any) => n.id));
  });

  it("gets a node with its degree and returns 404/400 for bad ids", async () => {
    const t = await world();
    const n = (await api.get(`${G}/nodes/${A(t.payment)}`, t.w)).body.data;
    expect(n).toMatchObject({ id: A(t.payment), entityType: "agent", entityId: t.payment, outgoing: { active: 2, inactive: 0 }, incoming: { active: 2, inactive: 0 } });
    expect((await api.get(`${G}/nodes/${R(t.wallet)}`, t.w)).body.data).toMatchObject({ entityType: "resource", status: null });
    expect((await api.get(`${G}/nodes/${A(randomUUID())}`, t.w)).status).toBe(404);
    expect((await api.get(`${G}/nodes/${A(randomUUID())}`, t.w)).body.error.code).toBe("NODE_NOT_FOUND");
    expect((await api.get(`${G}/nodes/not-a-node`, t.w)).status).toBe(400);
  });

  it("filters edges by type, status, endpoints and confidence; default is active only", async () => {
    const t = await world();
    await api.delete(`/api/v1/dependencies/${t.deps.ae.id}`, t.w);
    const ids = async (qs: string) => (await api.get(`${G}/edges?${qs}`, t.w)).body.data.map((e: any) => e.dependencyId).sort();
    expect(await ids("")).toHaveLength(6);
    expect(await ids("status=inactive")).toEqual([t.deps.ae.id]);
    expect(await ids("dependencyType=authority")).toEqual([t.deps.sp.id]);
    expect(await ids(`sourceNodeId=${A(t.support)}`)).toEqual([t.deps.sp.id, t.deps.sc.id].sort());
    expect(await ids(`targetNodeId=${R(t.customerApi)}&minConfidence=0.5`)).toEqual([t.deps.sc.id]);
    const e = (await api.get(`${G}/edges?dependencyType=authority`, t.w)).body.data[0];
    expect(e).toMatchObject({ sourceNodeId: A(t.support), targetNodeId: A(t.payment), dependencyType: "authority", confidence: 1, provenance: { source: "manual" }, version: 1 });
    expect((await api.get(`${G}/edges?limit=2&page=2`, t.w)).body.data).toHaveLength(2);
  });
});

describe("neighbours and traversal", () => {
  it("returns outgoing, incoming or both neighbours and respects depth and type filters", async () => {
    const t = await world();
    const ids = async (qs: string) => (await api.get(`${G}/nodes/${A(t.payment)}/neighbours?${qs}`, t.w)).body.data.neighbours.map((n: any) => n.node.id).sort();
    expect(await ids("direction=outgoing")).toEqual([A(t.analytics), R(t.wallet)].sort());
    expect(await ids("direction=incoming")).toEqual([A(t.analytics), A(t.support)].sort());
    expect(await ids("direction=both")).toEqual([A(t.analytics), A(t.support), R(t.wallet)].sort());
    expect(await ids("direction=outgoing&maxDepth=2")).toEqual([A(t.analytics), A(t.email), R(t.wallet)].sort());
    expect(await ids("direction=outgoing&dependencyTypes=resource")).toEqual([R(t.wallet)]);
    const res = (await api.get(`${G}/nodes/${A(t.payment)}/neighbours?direction=outgoing`, t.w)).body.data;
    expect(res).toMatchObject({ truncatedByDepth: true, node: { id: A(t.payment) } });
    expect(res.edges).toHaveLength(2);
  });

  it("BFS and DFS traversals, reverse direction, depth limits", async () => {
    const t = await world();
    const bfs = (await api.get(`${G}/traverse?startNodeId=${A(t.support)}&algorithm=bfs`, t.w)).body.data;
    expect(bfs.visited[0]).toMatchObject({ depth: 0, viaEdgeId: null });
    expect(bfs.visited.find((v: any) => v.nodeId === A(t.email)).depth).toBe(3);
    const dfs = (await api.get(`${G}/traverse?startNodeId=${A(t.support)}&algorithm=dfs`, t.w)).body.data;
    expect(new Set(dfs.visited.map((v: any) => v.nodeId))).toEqual(new Set(bfs.visited.map((v: any) => v.nodeId)));
    const rev = (await api.get(`${G}/traverse?startNodeId=${A(t.email)}&direction=reverse&dependencyTypes=operational`, t.w)).body.data;
    expect(rev.visited.map((v: any) => v.nodeId).sort()).toEqual([A(t.email), A(t.analytics), A(t.payment)].sort());
    expect((await api.get(`${G}/traverse?startNodeId=${A(t.support)}&maxDepth=1`, t.w)).body.data.truncatedByDepth).toBe(true);
  });

  it("rejects depths beyond the limit with a structured error and unknown nodes with 404", async () => {
    const t = await world();
    const over = await api.get(`${G}/traverse?startNodeId=${A(t.support)}&maxDepth=101`, t.w);
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe("MAX_DEPTH_EXCEEDED");
    expect((await api.get(`${G}/traverse?startNodeId=${A(randomUUID())}`, t.w)).status).toBe(404);
    expect((await api.get(`${G}/traverse`, t.w)).status).toBe(400);
  });

  it("includeInactive brings inactive edges into traversal", async () => {
    const t = await world();
    await api.delete(`/api/v1/dependencies/${t.deps.ae.id}`, t.w);
    const q = (extra: string) => api.get(`${G}/traverse?startNodeId=${A(t.analytics)}${extra}`, t.w);
    expect((await q("")).body.data.visited.map((v: any) => v.nodeId)).not.toContain(A(t.email));
    expect((await q("&includeInactive=true")).body.data.visited.map((v: any) => v.nodeId)).toContain(A(t.email));
  });
});

describe("reachability and paths", () => {
  it("answers directed reachability with filters and depth", async () => {
    const t = await world();
    const q = (s: string, e: string, extra = "") => api.get(`${G}/reachability?sourceNodeId=${s}&targetNodeId=${e}${extra}`, t.w).then((r) => r.body.data);
    expect(await q(A(t.support), A(t.email))).toMatchObject({ reachable: true, depth: 3 });
    expect(await q(A(t.email), A(t.support))).toMatchObject({ reachable: false, depth: null });
    expect(await q(A(t.email), A(t.support), "&direction=reverse")).toMatchObject({ reachable: true });
    expect(await q(A(t.support), A(t.email), "&dependencyTypes=authority")).toMatchObject({ reachable: false });
    expect(await q(A(t.support), A(t.email), "&maxDepth=2")).toMatchObject({ reachable: false, truncatedByDepth: true });
    expect(await q(A(t.support), A(t.loner))).toMatchObject({ reachable: false });
    expect((await api.get(`${G}/reachability?sourceNodeId=${A(t.support)}&targetNodeId=${A(randomUUID())}`, t.w)).status).toBe(404);
  });

  it("discovers paths with context, shortest first, and a clean not-found result", async () => {
    const t = await world();
    const res = (await api.get(`${G}/paths?sourceNodeId=${A(t.support)}&targetNodeId=${A(t.email)}`, t.w)).body.data;
    expect(res.found).toBe(true);
    expect(res.shortest.nodeIds).toEqual([A(t.support), A(t.payment), A(t.analytics), A(t.email)]);
    expect(res.paths).toHaveLength(1); // the analytics->payment loop cannot produce a second simple path
    expect(res.nodes.map((n: any) => n.id).sort()).toEqual(res.shortest.nodeIds.slice().sort());
    expect(res.edges).toHaveLength(3);
    const none = await api.get(`${G}/paths?sourceNodeId=${A(t.email)}&targetNodeId=${A(t.support)}`, t.w);
    expect(none.status).toBe(200);
    expect(none.body.data).toMatchObject({ found: false, shortest: null, paths: [], truncated: false });
  });

  it("bounds path enumeration and rejects excessive limits", async () => {
    const t = await world();
    const q = (extra: string) => api.get(`${G}/paths?sourceNodeId=${A(t.support)}&targetNodeId=${A(t.email)}${extra}`, t.w);
    expect((await q("&maxPaths=101")).body.error.code).toBe("MAX_PATHS_EXCEEDED");
    expect((await q("&maxDepth=26")).body.error.code).toBe("MAX_DEPTH_EXCEEDED");
    expect((await q("&maxPaths=0")).status).toBe(400);
    expect((await q("&maxDepth=2")).body.data.found).toBe(false);
  });
});

describe("components, cycles and export", () => {
  it("reports weakly connected components including isolated nodes", async () => {
    const t = await world();
    const d = (await api.get(`${G}/components`, t.w)).body.data;
    expect(d.count).toBe(2);
    expect(d.semantics).toMatch(/weakly/);
    const sizes = d.components.map((c: any) => c.nodeIds.length).sort((x: number, y: number) => x - y);
    expect(sizes).toEqual([1, 7]);
    expect(d.components.find((c: any) => c.nodeIds.length === 1).nodeIds).toEqual([A(t.loner)]);
    const authOnly = (await api.get(`${G}/components?dependencyTypes=authority`, t.w)).body.data;
    expect(authOnly.components.filter((c: any) => c.nodeIds.length > 1)).toHaveLength(1);
  });

  it("reports the operational cycle with its nodes and edges, and none when filtered out", async () => {
    const t = await world();
    const d = (await api.get(`${G}/cycles`, t.w)).body.data;
    expect(d.cycles).toHaveLength(1);
    expect(d.cycles[0].nodeIds.slice().sort()).toEqual([A(t.analytics), A(t.payment)].sort());
    expect(d.cycles[0].edges.map((e: any) => e.dependencyId).sort()).toEqual([t.deps.pa.id, t.deps.ap.id].sort());
    expect(d).toMatchObject({ cyclicComponentCount: 1, truncated: false });
    expect((await api.get(`${G}/cycles?dependencyTypes=authority`, t.w)).body.data.cycles).toEqual([]);
    expect((await api.get(`${G}/cycles?maxCycles=501`, t.w)).body.error.code).toBe("MAX_PATHS_EXCEEDED");
    expect((await api.get(`${G}/cycles?maxLength=51`, t.w)).body.error.code).toBe("MAX_DEPTH_EXCEEDED");
  });

  it("exports a serialisable graph honouring filters", async () => {
    const t = await world();
    const all = (await api.get(`${G}/export`, t.w)).body.data;
    expect(all.nodes).toHaveLength(8);
    expect(all.edges).toHaveLength(7);
    expect(Date.parse(all.edges[0].createdAt)).not.toBeNaN();
    const agents = (await api.get(`${G}/export?entityType=agent`, t.w)).body.data;
    expect(agents.nodes.every((n: any) => n.entityType === "agent")).toBe(true);
    expect(agents.edges.every((e: any) => e.dependencyType !== "resource")).toBe(true);
  });
});

describe("security", () => {
  it("is tenant-isolated: another organization sees none of it and its node ids are unknown", async () => {
    const t = await world();
    const other = who("admin");
    expect((await api.get(G, other)).body.data.metadata.nodeCount).toBe(0);
    expect((await api.get(`${G}/export`, other)).body.data.nodes).toEqual([]);
    expect((await api.get(`${G}/nodes/${A(t.support)}`, other)).status).toBe(404);
    expect((await api.get(`${G}/traverse?startNodeId=${A(t.support)}`, other)).status).toBe(404);
    expect((await api.get(`${G}/paths?sourceNodeId=${A(t.support)}&targetNodeId=${A(t.email)}`, other)).status).toBe(404);
    // the original organization is unaffected
    expect((await api.get(G, t.w)).body.data.metadata.nodeCount).toBe(8);
  });

  it("never accepts an organization id from the client", async () => {
    const t = await world();
    const other = who("operator");
    expect((await api.get(`${G}/nodes?organizationId=${other.org}`, t.w)).status).toBe(400);
    expect((await api.get(`${G}/export?organizationId=${other.org}`, t.w)).status).toBe(400);
    expect((await api.post(`${G}/build?organizationId=${other.org}`, t.w)).status).toBe(400);
  });

  it("requires authentication; viewers may read; unknown query fields are rejected", async () => {
    const t = await world();
    for (const [m, url] of [["POST", `${G}/build`], ["GET", G], ["GET", `${G}/nodes`], ["GET", `${G}/edges`], ["GET", `${G}/components`], ["GET", `${G}/cycles`], ["GET", `${G}/export`]] as const) {
      expect((await ctx.app.inject({ method: m, url })).statusCode, `${m} ${url}`).toBe(401);
    }
    const viewer = who("viewer", t.w.org);
    expect((await api.post(`${G}/build`, viewer)).status).toBe(200);
    expect((await api.get(`${G}/nodes?bogus=1`, viewer)).status).toBe(400);
  });

  it("has no route that writes: POST/PUT/PATCH/DELETE on graph resources do not exist", async () => {
    const t = await world();
    for (const [m, url] of [["PUT", `${G}/nodes`], ["POST", `${G}/nodes`], ["DELETE", `${G}/edges`], ["PATCH", `${G}/edges`], ["POST", `${G}/edges`]] as const) {
      const res = await ctx.app.inject({ method: m, url, headers: { "x-dev-actor-id": t.w.actor, "x-dev-org-id": t.w.org, "x-dev-role": "admin" }, payload: {} });
      expect(res.statusCode, `${m} ${url}`).toBe(404);
    }
  });

  it("does not leak internals when graph construction fails", async () => {
    const failing = await createCtx(undefined, undefined, (real) => ({
      ...real,
      graphs: new GraphQueryService({
        load: async () => {
          const e = new GraphError("GRAPH_BUILD_FAILED", "The graph could not be built from the registries");
          (e as { cause?: unknown }).cause = new Error("relation \"agents\" does not exist (secret detail)");
          throw e;
        },
      } as never),
    }));
    try {
      const res = await client(failing.app).get(G, who("viewer"));
      expect(res.status).toBe(500);
      expect(res.body.error).toEqual({ code: "GRAPH_BUILD_FAILED", message: "The graph could not be built from the registries" });
      expect(res.raw).not.toMatch(/relation|secret detail|agents/);
    } finally {
      await failing.close();
    }
  });
});
