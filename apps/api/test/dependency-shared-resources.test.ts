import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDep, mkAgent, mkResource, resourceDep, mkAgents } from "./dep-helpers.js";
import { client, createCtx, uniqueName, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());
const D = "/api/v1/dependencies";

describe("shared resources", () => {
  it("lets several agents reference ONE resource record", async () => {
    const op = who("operator");
    const customerApi = await mkResource(api, op, "Customer API");
    const agents = await Promise.all(["Support", "Database", "Analytics"].map((n) => mkAgent(api, op, uniqueName(n))));
    for (const a of agents) await createDep(api, op, resourceDep(a, customerApi));

    const incoming = await api.get(`${D}?targetType=resource&targetId=${customerApi}`, op);
    expect(incoming.body.pagination.total).toBe(3);
    expect(new Set(incoming.body.data.map((d: any) => d.sourceId))).toEqual(new Set(agents));

    const resources = await api.get("/api/v1/resources", op);
    expect(resources.body.data.filter((r: any) => r.name === "Customer API")).toHaveLength(1);
  });

  it("does not create duplicate resources: names are unique per organization", async () => {
    const op = who("operator");
    expect((await api.post("/api/v1/resources", op, { name: "Customer API", resourceType: "api" })).status).toBe(201);
    const dup = await api.post("/api/v1/resources", op, { name: "customer api", resourceType: "api" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("RESOURCE_NAME_CONFLICT");
    // another organization may use the same name
    expect((await api.post("/api/v1/resources", who("operator"), { name: "Customer API", resourceType: "api" })).status).toBe(201);
  });

  it("removing one relationship neither deletes the resource nor disturbs the others", async () => {
    const op = who("operator");
    const res = await mkResource(api, op);
    const [a1, a2, a3] = await mkAgents(api, op, 3);
    const d1 = await createDep(api, op, resourceDep(a1, res));
    const d2 = await createDep(api, op, resourceDep(a2, res));
    const d3 = await createDep(api, op, resourceDep(a3, res));

    expect((await api.delete(`${D}/${d1.id}`, op)).status).toBe(200);

    expect((await api.get(`/api/v1/resources/${res}`, op)).status).toBe(200);
    for (const d of [d2, d3]) {
      const got = (await api.get(`${D}/${d.id}`, op)).body.data;
      expect(got).toMatchObject({ status: "active", version: 1, targetId: res });
    }
    const active = await api.get(`${D}?targetId=${res}&status=active`, op);
    expect(active.body.pagination.total).toBe(2);
    expect((await api.get(`${D}?targetId=${res}&status=inactive`, op)).body.pagination.total).toBe(1);
  });

  it("keeps the removed relationship retrievable (soft removal)", async () => {
    const op = who("operator");
    const [res, a] = [await mkResource(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, resourceDep(a, res));
    await api.delete(`${D}/${d.id}`, op);
    const got = await api.get(`${D}/${d.id}`, op);
    expect(got.status).toBe(200);
    expect(got.body.data.status).toBe("inactive");
  });
});
