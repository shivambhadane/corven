import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportGraph } from "../src/modules/graph-engine/core/export.js";
import { buildGraph } from "../src/modules/graph-engine/core/builder.js";
import { contentHash, diffPayloads, graphFromPayload, snapshotPayload } from "../src/modules/graph-snapshot/core/snapshot.js";
import { authority, createDep, mkAgent, mkResource, operational, resourceDep } from "./dep-helpers.js";
import { ORG, a, spec } from "./graph-fixtures.js";
import { client, createCtx, who, type TestCtx, type Who } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());
const S = "/api/v1/graph/snapshots";
const A = (id: string) => `agent:${id}`;

async function world(w: Who = who("operator")) {
  const [support, payment, analytics] = [await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w)];
  const wallet = await mkResource(api, w);
  const deps = {
    sp: await createDep(api, w, authority(support, payment)),
    pw: await createDep(api, w, resourceDep(payment, wallet)),
    pa: await createDep(api, w, operational(payment, analytics)),
  };
  return { w, support, payment, analytics, wallet, deps };
}

describe("snapshot core (pure)", () => {
  const G = () => buildGraph(ORG, spec(["x", "y", "R:z"], [["x", "y", "authority"], ["y", "R:z", "resource"], ["x", "R:z", "resource", { status: "inactive" }]])).graph;

  it("stores every edge status and excludes build time from the hash", () => {
    const p = snapshotPayload(G());
    expect(p.edges).toHaveLength(3);
    const one = contentHash(ORG, p);
    const two = contentHash(ORG, snapshotPayload(buildGraph(ORG, spec(["x", "y", "R:z"], [["x", "y", "authority"], ["y", "R:z", "resource"], ["x", "R:z", "resource", { status: "inactive" }]]), { builtAt: new Date(1) }).graph));
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the hash covers the organization and any content change", () => {
    const p = snapshotPayload(G());
    expect(contentHash("other-org", p)).not.toBe(contentHash(ORG, p));
    const tampered = { ...p, edges: p.edges.map((e, i) => (i === 0 ? { ...e, confidence: 0.1 } : e)) };
    expect(contentHash(ORG, tampered)).not.toBe(contentHash(ORG, p));
    expect(contentHash(ORG, { ...p, nodes: [...p.nodes].reverse() })).not.toBe(contentHash(ORG, p)); // order is part of the canonical form
  });

  it("round-trips: a graph rebuilt from the payload exports identically", () => {
    const g = G();
    const back = graphFromPayload(ORG, snapshotPayload(g), g.metadata.builtAt);
    const all = { edgeStatuses: ["active", "inactive"] as const };
    expect(exportGraph(back, { ...all, edgeStatuses: ["active", "inactive"] })).toEqual(exportGraph(g, { edgeStatuses: ["active", "inactive"] }));
    expect(back.getEdge(g.edges()[0]!.id)!.createdAt).toBeInstanceOf(Date);
  });

  it("diffs by id and names changed fields without exposing values", () => {
    const before = snapshotPayload(G());
    const g2 = buildGraph(ORG, spec(["x", "y", "R:z", "w"], [["x", "y", "authority"], ["y", "R:z", "resource", { confidence: 0.4 }]])).graph;
    const after = snapshotPayload(g2);
    const d = diffPayloads(before, after);
    expect(d.nodes.added).toEqual([a("w")]);
    expect(d.edges.removed).toHaveLength(1);
    expect(d.edges.changed).toEqual([{ id: expect.any(String), fields: ["confidence"] }]);
    expect(d.identical).toBe(false);
    expect(diffPayloads(before, before).identical).toBe(true);
    expect(JSON.stringify(d)).not.toContain("0.4");
  });
});

describe("snapshot API", () => {
  it("creates, lists, reads and verifies a snapshot", async () => {
    const t = await world();
    const created = await api.post(S, t.w, { label: "  before incident ", incidentId: randomUUID() });
    expect(created.status).toBe(201);
    const snap = created.body.data;
    expect(snap).toMatchObject({ label: "before incident", nodeCount: 4, edgeCount: 3, createdBy: t.w.actor, organizationId: t.w.org });
    expect(snap.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await api.get(`${S}/${snap.id}`, t.w)).body.data.id).toBe(snap.id);
    expect((await api.get(S, t.w)).body.pagination.total).toBe(1);
    expect((await api.get(`${S}?incidentId=${snap.incidentId}`, t.w)).body.data).toHaveLength(1);
    expect((await api.get(`${S}?incidentId=${randomUUID()}`, t.w)).body.data).toHaveLength(0);
    const g = (await api.get(`${S}/${snap.id}/graph`, t.w)).body.data;
    expect(g.nodes).toHaveLength(4);
    expect(g.edges).toHaveLength(3);
    const v = (await api.get(`${S}/${snap.id}/verify`, t.w)).body.data;
    expect(v).toEqual({ valid: true, storedHash: snap.contentHash, computedHash: snap.contentHash });
  });

  it("identical registry state gives an identical hash; a registry change gives a different one", async () => {
    const t = await world();
    const s1 = (await api.post(S, t.w, {})).body.data;
    const s2 = (await api.post(S, t.w, {})).body.data;
    expect(s2.id).not.toBe(s1.id);
    expect(s2.contentHash).toBe(s1.contentHash);
    await api.patch(`/api/v1/dependencies/${t.deps.pw.id}`, t.w, { confidence: 0.3, provenance: { source: "imported" } });
    expect((await api.post(S, t.w, {})).body.data.contentHash).not.toBe(s1.contentHash);
  });

  it("is a frozen point in time: later registry changes do not alter what blast radius and containment see", async () => {
    const t = await world();
    const snap = (await api.post(S, t.w, { label: "pinned" })).body.data;
    // the world changes after the snapshot
    const extra = await mkAgent(api, t.w);
    await createDep(api, t.w, operational(t.payment, extra));
    await api.delete(`/api/v1/dependencies/${t.deps.pa.id}`, t.w);

    const pinned = (await api.post("/api/v1/blast-radius/analyze", t.w, { sourceNodeIds: [A(t.payment)], snapshotId: snap.id })).body.data;
    expect(pinned.graph.nodeCount).toBe(4);
    expect(pinned.impacted.find((n: any) => n.nodeId === A(t.analytics))).toMatchObject({ classification: "potentially_affected" });
    expect(pinned.impacted.find((n: any) => n.nodeId === A(extra))).toBeUndefined();

    const live = (await api.post("/api/v1/blast-radius/analyze", t.w, { sourceNodeIds: [A(t.payment)] })).body.data;
    expect(live.graph.nodeCount).toBe(5);
    expect(live.impacted.find((n: any) => n.nodeId === A(t.analytics))).toBeUndefined(); // removed live
    expect(live.impacted.find((n: any) => n.nodeId === A(extra))).toBeDefined();

    const plan = (await api.post("/api/v1/containment/plan", t.w, { sourceNodeIds: [A(t.payment)], protectedNodeIds: [A(t.analytics)], snapshotId: snap.id })).body.data;
    expect(plan.status).toBe("feasible");
    expect(plan.actions[0].edgeId).toBe(t.deps.pa.id);
  });

  it("the loaded snapshot graph equals the live graph at snapshot time", async () => {
    const t = await world();
    const snap = (await api.post(S, t.w, {})).body.data;
    const live = (await api.get("/api/v1/graph/export?includeInactive=true", t.w)).body.data;
    const stored = (await api.get(`${S}/${snap.id}/graph`, t.w)).body.data;
    expect(stored.nodes).toEqual(live.nodes);
    expect(stored.edges).toEqual(live.edges);
  });

  it("diffs two snapshots", async () => {
    const t = await world();
    const s1 = (await api.post(S, t.w, {})).body.data;
    const extra = await mkAgent(api, t.w);
    await createDep(api, t.w, operational(t.analytics, extra));
    await api.delete(`/api/v1/dependencies/${t.deps.pa.id}`, t.w);
    const s2 = (await api.post(S, t.w, {})).body.data;
    const d = (await api.get(`${S}/${s1.id}/diff/${s2.id}`, t.w)).body.data;
    expect(d.identical).toBe(false);
    expect(d.nodes.added).toEqual([A(extra)]);
    expect(d.edges.added).toHaveLength(1);
    expect(d.edges.changed).toEqual([{ id: t.deps.pa.id, fields: ["status", "version"] }]);
    expect((await api.get(`${S}/${s1.id}/diff/${s1.id}`, t.w)).body.data.identical).toBe(true);
  });
});

describe("snapshot integrity and immutability", () => {
  const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);

  it("the database rejects UPDATE, DELETE and TRUNCATE", async () => {
    const t = await world();
    const snap = (await api.post(S, t.w, {})).body.data;
    await expect(q("update graph_snapshots set label = 'x' where id = $1", [snap.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from graph_snapshots where id = $1", [snap.id])).rejects.toMatchObject({ code: "23001" });
    // Once incident_analysis_references points at snapshots, Postgres itself refuses TRUNCATE (0A000, "referenced in a foreign key")
    // before the append-only trigger (23001) runs. Either way the table cannot be truncated.
    await expect(q("truncate graph_snapshots")).rejects.toMatchObject({ code: expect.stringMatching(/^(23001|0A000)$/) });
  });

  it("exposes no HTTP route that modifies or deletes a snapshot", async () => {
    const t = await world();
    const snap = (await api.post(S, t.w, {})).body.data;
    for (const m of ["PUT", "PATCH", "DELETE"] as const) {
      const res = await ctx.app.inject({ method: m, url: `${S}/${snap.id}`, headers: { "x-dev-actor-id": t.w.actor, "x-dev-org-id": t.w.org, "x-dev-role": "admin" }, payload: {} });
      expect(res.statusCode, m).toBe(404);
    }
  });

  it("detects a tampered payload: verify reports it, and loading, analysis and planning refuse it", async () => {
    const t = await world();
    const snap = (await api.post(S, t.w, {})).body.data;
    await q("alter table graph_snapshots disable trigger graph_snapshots_append_only");
    try {
      await q("update graph_snapshots set payload = jsonb_set(payload, '{edges,0,confidence}', '0.01') where id = $1", [snap.id]);
    } finally {
      await q("alter table graph_snapshots enable trigger graph_snapshots_append_only");
    }
    const v = (await api.get(`${S}/${snap.id}/verify`, t.w)).body.data;
    expect(v.valid).toBe(false);
    expect(v.storedHash).toBe(snap.contentHash);
    expect(v.computedHash).not.toBe(snap.contentHash);
    const g = await api.get(`${S}/${snap.id}/graph`, t.w);
    expect(g.status).toBe(500);
    expect(g.body.error.code).toBe("SNAPSHOT_INTEGRITY_FAILED");
    expect(g.raw).not.toMatch(/confidence|0\.01|payload/);
    expect((await api.post("/api/v1/blast-radius/analyze", t.w, { sourceNodeIds: [A(t.payment)], snapshotId: snap.id })).status).toBe(500);
    expect((await api.post("/api/v1/containment/plan", t.w, { sourceNodeIds: [A(t.payment)], snapshotId: snap.id })).status).toBe(500);
  });
});

describe("snapshot security", () => {
  it("is tenant-isolated", async () => {
    const t = await world();
    const snap = (await api.post(S, t.w, {})).body.data;
    const other = who("admin");
    expect((await api.get(`${S}/${snap.id}`, other)).status).toBe(404);
    expect((await api.get(`${S}/${snap.id}`, other)).body.error.code).toBe("SNAPSHOT_NOT_FOUND");
    expect((await api.get(`${S}/${snap.id}/graph`, other)).status).toBe(404);
    expect((await api.get(`${S}/${snap.id}/verify`, other)).status).toBe(404);
    expect((await api.get(`${S}/${snap.id}/diff/${snap.id}`, other)).status).toBe(404);
    expect((await api.get(S, other)).body.pagination.total).toBe(0);
    expect((await api.post("/api/v1/blast-radius/analyze", other, { sourceNodeIds: [A(t.payment)], snapshotId: snap.id })).status).toBe(404);
  });

  it("viewers read but cannot create; unauthenticated is 401; input is validated", async () => {
    const t = await world();
    const viewer = who("viewer", t.w.org);
    const snap = (await api.post(S, t.w, {})).body.data;
    expect((await api.get(S, viewer)).status).toBe(200);
    expect((await api.get(`${S}/${snap.id}/graph`, viewer)).status).toBe(200);
    expect((await api.post(S, viewer, {})).status).toBe(403);
    expect((await ctx.app.inject({ method: "GET", url: S })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "POST", url: S, payload: {} })).statusCode).toBe(401);
    for (const body of [{ label: "   " }, { organizationId: randomUUID() }, { incidentId: "nope" }, { label: "x".repeat(201) }]) {
      expect((await api.post(S, t.w, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await api.get(`${S}/not-a-uuid`, t.w)).status).toBe(400);
    expect((await api.get(`${S}/${randomUUID()}`, t.w)).status).toBe(404);
  });

  it("creating a snapshot does not change the registries", async () => {
    const t = await world();
    const rows = async () => JSON.stringify((await ctx.handle.pool.query("select count(*)::int n, max(updated_at) m from dependencies where organization_id=$1", [t.w.org])).rows);
    const before = await rows();
    await api.post(S, t.w, {});
    expect(await rows()).toBe(before);
  });
});
