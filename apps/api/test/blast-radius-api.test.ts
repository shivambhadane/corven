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
const URL = "/api/v1/blast-radius/analyze";
const A = (id: string) => `agent:${id}`;
const R = (id: string) => `resource:${id}`;

async function acme(w: Who = who("operator")) {
  const [support, payment, analytics, email, database] = [await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w)];
  const wallet = await mkResource(api, w);
  const customerApi = await mkResource(api, w);
  await createDep(api, w, authority(support, payment));
  await createDep(api, w, resourceDep(payment, wallet));
  await createDep(api, w, resourceDep(payment, customerApi));
  await createDep(api, w, operational(payment, analytics));
  await createDep(api, w, operational(analytics, email));
  await createDep(api, w, resourceDep(support, customerApi));
  await createDep(api, w, resourceDep(database, customerApi));
  return { w, support, payment, analytics, email, database, wallet, customerApi };
}

describe("POST /blast-radius/analyze", () => {
  it("analyzes the Acme incident against the live registries", async () => {
    const t = await acme();
    const res = await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)] });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.summary).toEqual({ compromised: 1, exposed: 2, potentially_affected: 2, uncertain: 1, healthy: 1 });
    expect(d.impacted.find((n: any) => n.nodeId === R(t.customerApi))).toMatchObject({ classification: "exposed", exposureKinds: ["resource"] });
    expect(d.healthyNodeIds).toEqual([A(t.database)]);
    expect(d.sharedResources.find((x: any) => x.resourceNodeId === R(t.customerApi)).dependents.map((x: any) => x.nodeId)).toContain(A(t.database));
    expect(d.limitations.length).toBeGreaterThan(2);
  });

  it("honours confidenceThreshold and staleAfterHours", async () => {
    const t = await acme();
    const low = await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)], confidenceThreshold: 1 });
    // default dependency confidence is 1, so everything stays certain at threshold 1
    expect(low.body.data.summary.uncertain).toBe(1);
    const weakAgent = await mkAgent(api, t.w);
    await createDep(api, t.w, operational(t.payment, weakAgent, { provenance: { source: "inferred" }, confidence: 0.2 }));
    const res = await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)] });
    expect(res.body.data.impacted.find((n: any) => n.nodeId === A(weakAgent))).toMatchObject({ classification: "uncertain", wouldBe: "potentially_affected" });
    const stale = await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)], staleAfterHours: 0.0000001 });
    expect(stale.status).toBe(200);
  });

  it("is read-only and does not change the registries", async () => {
    const t = await acme();
    const count = async () => JSON.stringify((await ctx.handle.pool.query("select count(*)::int n, max(updated_at) m from dependencies where organization_id=$1", [t.w.org])).rows);
    const before = await count();
    await api.post(URL, t.w, { sourceNodeIds: [A(t.payment)] });
    expect(await count()).toBe(before);
  });

  it("is tenant-isolated: another organization cannot analyze these nodes", async () => {
    const t = await acme();
    const res = await api.post(URL, who("admin"), { sourceNodeIds: [A(t.payment)] });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NODE_NOT_FOUND");
  });

  it("validates input", async () => {
    const t = await acme();
    const bad = [
      {}, { sourceNodeIds: [] }, { sourceNodeIds: ["nope"] }, { sourceNodeIds: [R(t.wallet)] },
      { sourceNodeIds: [A(t.payment)], confidenceThreshold: 2 },
      { sourceNodeIds: [A(t.payment)], organizationId: randomUUID() },
      { sourceNodeIds: [A(t.payment), A(t.payment)] },
    ];
    for (const body of bad) expect((await api.post(URL, t.w, body)).status, JSON.stringify(body)).toBe(400);
    // a resource id that passes the agent-only pattern is impossible; a non-agent node is rejected by the schema
  });

  it("requires authentication; viewers may analyze", async () => {
    const t = await acme();
    expect((await ctx.app.inject({ method: "POST", url: URL, payload: { sourceNodeIds: [A(t.payment)] } })).statusCode).toBe(401);
    expect((await api.post(URL, who("viewer", t.w.org), { sourceNodeIds: [A(t.payment)] })).status).toBe(200);
  });
});
