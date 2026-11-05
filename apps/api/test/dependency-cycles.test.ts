import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authority, createDep, mkAgent, operational, resourceDep, mkResource, mkAgents } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());
const D = "/api/v1/dependencies";

describe("cycle handling", () => {
  it("permits operational cycles (direct and indirect)", async () => {
    const op = who("operator");
    const [a, b, c] = await mkAgents(api, op, 3);
    expect((await api.post(D, op, operational(a, b))).status).toBe(201);
    expect((await api.post(D, op, operational(b, a))).status).toBe(201); // direct cycle
    expect((await api.post(D, op, operational(b, c))).status).toBe(201);
    expect((await api.post(D, op, operational(c, a))).status).toBe(201); // indirect cycle
  });

  it("permits an authority diamond (not a cycle)", async () => {
    const op = who("operator");
    const [a, b, c, d] = await mkAgents(api, op, 4);
    for (const [s, t] of [[a, b], [a, c], [b, d], [c, d]]) expect((await api.post(D, op, authority(s!, t!))).status).toBe(201);
  });

  it("rejects a direct authority cycle with a clear 422 including the cycle", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    await createDep(api, op, authority(a, b));
    const res = await api.post(D, op, authority(b, a));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("AUTHORITY_CYCLE");
    expect(res.body.error.message).toMatch(/cycle/i);
    expect(res.body.error.details.cycle).toEqual([b, a, b]);
  });

  it("rejects an indirect authority cycle (A->B->C, then C->A)", async () => {
    const op = who("operator");
    const [a, b, c] = await mkAgents(api, op, 3);
    await createDep(api, op, authority(a, b));
    await createDep(api, op, authority(b, c));
    const res = await api.post(D, op, authority(c, a));
    expect(res.status).toBe(422);
    expect(res.body.error.details.cycle).toEqual([c, a, b, c]);
    // nothing was written
    expect((await api.get(`${D}?sourceId=${c}`, op)).body.pagination.total).toBe(0);
  });

  it("does not let operational or resource edges mask or create authority cycles", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    await createDep(api, op, authority(a, b));
    await createDep(api, op, operational(b, a)); // operational back-edge: fine
    const r = await mkResource(api, op);
    await createDep(api, op, resourceDep(b, r));
    expect((await api.post(D, op, authority(b, a))).status).toBe(422); // authority back-edge: still a cycle
  });

  it("ignores inactive authority edges when checking cycles", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const ab = await createDep(api, op, authority(a, b));
    await api.delete(`${D}/${ab.id}`, op);
    expect((await api.post(D, op, authority(b, a))).status).toBe(201);
  });

  it("re-checks cycles when an authority edge is reactivated", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const ab = await createDep(api, op, authority(a, b));
    await api.delete(`${D}/${ab.id}`, op);
    await createDep(api, op, authority(b, a)); // legitimate now
    const res = await api.patch(`${D}/${ab.id}`, op, { status: "active" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("AUTHORITY_CYCLE");
    expect((await api.get(`${D}/${ab.id}`, op)).body.data.status).toBe("inactive");
  });

  it("is organization-scoped: another org's authority edges never form a cycle with mine", async () => {
    const orgA = who("operator");
    const orgB = who("operator");
    const [a1, a2] = [await mkAgent(api, orgA), await mkAgent(api, orgA)];
    const [b1, b2] = [await mkAgent(api, orgB), await mkAgent(api, orgB)];
    await createDep(api, orgA, authority(a1, a2));
    await createDep(api, orgB, authority(b2, b1));
    expect((await api.post(D, orgA, authority(a2, a1))).status).toBe(422);
    expect((await api.post(D, orgB, authority(b1, b2))).status).toBe(422);
  });

  it("serialises concurrent opposite authority edges: at most one wins", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const results = await Promise.all([
      api.post(D, op, authority(a, b)),
      api.post(D, op, authority(b, a)),
      api.post(D, op, authority(a, b)),
      api.post(D, op, authority(b, a)),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 422 || r.status === 409)).toBe(true);
    const all = await api.get(`${D}?dependencyType=authority&status=active`, op);
    expect(all.body.pagination.total).toBe(1);
  });
});
