import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authority, createDep, mkAgent, mkResource, operational, resourceDep } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx, type Who } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());
const URL = "/api/v1/containment/plan";
const A = (id: string) => `agent:${id}`;
const R = (id: string) => `resource:${id}`;

async function acme(w: Who = who("operator")) {
  const [support, payment, analytics, email, database] = [await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w)];
  const wallet = await mkResource(api, w);
  const customerApi = await mkResource(api, w);
  const deps = {
    sp: await createDep(api, w, authority(support, payment)),
    pw: await createDep(api, w, resourceDep(payment, wallet)),
    pc: await createDep(api, w, resourceDep(payment, customerApi)),
    pa: await createDep(api, w, operational(payment, analytics)),
    ae: await createDep(api, w, operational(analytics, email)),
    sc: await createDep(api, w, resourceDep(support, customerApi)),
    dc: await createDep(api, w, resourceDep(database, customerApi)),
  };
  return { w, support, payment, analytics, email, database, wallet, customerApi, deps };
}

describe("POST /containment/plan", () => {
  it("plans minimum safe containment for the live Acme network", async () => {
    const t = await acme();
    const res = await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)], protectedNodeIds: [R(t.wallet), R(t.customerApi)] });
    expect(res.status).toBe(200);
    const p = res.body.data;
    expect(p).toMatchObject({ status: "feasible", totalCost: 2, approvalRequired: false, protectedWasDefaulted: false });
    expect(p.actions.map((x: any) => x.edgeId).sort()).toEqual([t.deps.pw.id, t.deps.pc.id].sort());
    expect(p.verification).toEqual({ protectedUnreachableAfterCut: true, workflowsStillSatisfied: true });
    expect(p.planHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("defaults the protected set to the exposed resources", async () => {
    const t = await acme();
    const res = await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)] });
    expect(res.body.data.protectedWasDefaulted).toBe(true);
    expect(res.body.data.protectedNodeIds.sort()).toEqual([R(t.wallet), R(t.customerApi)].sort());
    expect(res.body.data.status).toBe("feasible");
  });

  it("preserves a healthy workflow and reports infeasibility with blockers", async () => {
    const t = await acme();
    const ok = await api.post(URL, t.w, {
      sourceNodeIds: [A(t.payment)], protectedNodeIds: [R(t.customerApi)],
      healthyWorkflows: [{ id: "support-reads-api", name: "Support reads customers", from: A(t.support), to: R(t.customerApi) }],
    });
    expect(ok.body.data.preservedWorkflows[0]).toMatchObject({ id: "support-reads-api", satisfied: true, preservedEdgeIds: [t.deps.sc.id] });
    const bad = await api.post(URL, t.w, {
      sourceNodeIds: [A(t.payment)], protectedNodeIds: [R(t.customerApi)],
      healthyWorkflows: [{ id: "payments", edgeIds: [t.deps.pc.id] }],
    });
    expect(bad.body.data.status).toBe("infeasible");
    expect(bad.body.data.blockers[0]).toMatchObject({ edgeId: t.deps.pc.id, reason: "preserved_by_workflow", workflowIds: ["payments"] });
  });

  it("honours coverage costs and approval options", async () => {
    const t = await acme();
    const res = await api.post(URL, t.w, {
      sourceNodeIds: [A(t.payment)], protectedNodeIds: [R(t.wallet)],
      coverage: { edgeCosts: { [t.deps.pw.id]: 7 } },
      options: { costApprovalThreshold: 5, highValueNodeIds: [R(t.wallet)] },
    });
    expect(res.body.data.totalCost).toBe(7);
    expect(res.body.data.approvalReasons).toEqual(["cost_threshold", "high_value_target"]);
  });

  it("is read-only and stores nothing", async () => {
    const t = await acme();
    const snap = async () => JSON.stringify((await ctx.handle.pool.query("select count(*)::int n, max(updated_at) m from dependencies where organization_id=$1", [t.w.org])).rows);
    const before = await snap();
    await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)] });
    expect(await snap()).toBe(before);
  });

  it("is tenant-isolated", async () => {
    const t = await acme();
    expect((await api.post(URL, who("admin"), { sourceNodeIds: [A(t.payment)], protectedNodeIds: [R(t.wallet)] })).status).toBe(404);
    // edge ids of another organization cannot be used as workflow edges
    const other = await acme();
    const res = await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)], protectedNodeIds: [R(t.wallet)], healthyWorkflows: [{ id: "x", edgeIds: [other.deps.pw.id] }] });
    expect([404, 422]).toContain(res.status);
  });

  it("validates input and requires authentication", async () => {
    const t = await acme();
    const bad = [
      {}, { sourceNodeIds: [] }, { sourceNodeIds: [R(t.wallet)] },
      { sourceNodeIds: [A(t.payment)], protectedNodeIds: ["nope"] },
      { sourceNodeIds: [A(t.payment)], organizationId: randomUUID() },
      { sourceNodeIds: [A(t.payment)], coverage: { defaultCost: 0 } },
      { sourceNodeIds: [A(t.payment)], healthyWorkflows: [{ id: "w", extra: 1 }] },
    ];
    for (const body of bad) expect((await api.post(URL, t.w, body)).status, JSON.stringify(body)).toBe(400);
    expect((await ctx.app.inject({ method: "POST", url: URL, payload: { sourceNodeIds: [A(t.payment)] } })).statusCode).toBe(401);
    expect((await api.post(URL, who("viewer", t.w.org), { sourceNodeIds: [A(t.payment)] })).status).toBe(200);
  });

  it("returns a structured error when the protected node is the compromised agent", async () => {
    const t = await acme();
    const res = await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)], protectedNodeIds: [A(t.payment)] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_NODE");
  });
});
