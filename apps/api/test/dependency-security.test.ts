import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authority, createDep, mkAgent, mkResource, operational } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());
const D = "/api/v1/dependencies";

async function seed() {
  const owner = who("operator");
  const [a, b] = [await mkAgent(api, owner), await mkAgent(api, owner)];
  const dep = await createDep(api, owner, authority(a, b));
  return { owner, a, b, dep };
}

describe("tenant isolation", () => {
  it("rejects cross-tenant reads (404, indistinguishable from unknown)", async () => {
    const { dep } = await seed();
    const intruder = who("admin");
    const res = await api.get(`${D}/${dep.id}`, intruder);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual((await api.get(`${D}/${randomUUID()}`, intruder)).body.error);
    expect((await api.get(`${D}/${dep.id}/versions`, intruder)).status).toBe(404);
  });

  it("rejects cross-tenant updates and leaves the record untouched", async () => {
    const { owner, dep } = await seed();
    const intruder = who("admin");
    expect((await api.patch(`${D}/${dep.id}`, intruder, { confidence: 0.1 })).status).toBe(404);
    expect((await api.patch(`${D}/${dep.id}`, intruder, { status: "inactive" })).status).toBe(404);
    const after = (await api.get(`${D}/${dep.id}`, owner)).body.data;
    expect(after).toMatchObject({ version: 1, status: "active", confidence: 1 });
  });

  it("rejects cross-tenant deletion", async () => {
    const { owner, dep } = await seed();
    expect((await api.delete(`${D}/${dep.id}`, who("admin"))).status).toBe(404);
    expect((await api.get(`${D}/${dep.id}`, owner)).body.data.status).toBe("active");
  });

  it("lists only the caller's organization, and a filter cannot reach another org's ids", async () => {
    const { owner, a, dep } = await seed();
    const other = who("operator");
    await createDep(api, other, operational(await mkAgent(api, other), await mkAgent(api, other)));
    const mine = await api.get(D, owner);
    expect(mine.body.data.every((d: any) => d.organizationId === owner.org)).toBe(true);
    const probe = await api.get(`${D}?sourceId=${a}`, other);
    expect(probe.body.pagination.total).toBe(0);
    expect(probe.body.data.find((d: any) => d.id === dep.id)).toBeUndefined();
  });

  it("agent dependency listing is tenant-scoped: another org gets 404 for the agent", async () => {
    const { a } = await seed();
    expect((await api.get(`/api/v1/agents/${a}/dependencies`, who("admin"))).status).toBe(404);
  });

  it("resources are tenant-scoped too", async () => {
    const owner = who("operator");
    const r = await mkResource(api, owner);
    expect((await api.get(`/api/v1/resources/${r}`, who("admin"))).status).toBe(404);
    expect((await api.get("/api/v1/resources", who("admin"))).body.pagination.total).toBe(0);
  });

  it("the organization is taken from the principal, never from the request", async () => {
    const owner = who("operator");
    const [a, b] = [await mkAgent(api, owner), await mkAgent(api, owner)];
    const other = who("operator");
    expect((await api.post(D, owner, authority(a, b, { organizationId: other.org }))).status).toBe(400);
    expect((await api.get(`${D}?organizationId=${other.org}`, owner)).status).toBe(400);
    const ok = await createDep(api, owner, authority(a, b));
    expect(ok.organizationId).toBe(owner.org);
  });
});

describe("authorization", () => {
  it("rejects unauthenticated requests on every dependency route", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const calls: [string, string][] = [
      ["POST", D], ["GET", D], ["GET", `${D}/${id}`], ["PATCH", `${D}/${id}`], ["DELETE", `${D}/${id}`],
      ["GET", `${D}/${id}/versions`], ["GET", `/api/v1/agents/${id}/dependencies`],
      ["POST", "/api/v1/resources"], ["GET", "/api/v1/resources"], ["GET", `/api/v1/resources/${id}`],
    ];
    for (const [m, url] of calls) {
      const res = await ctx.app.inject({ method: m as "GET", url, payload: m === "GET" || m === "DELETE" ? undefined : {} });
      expect(res.statusCode, `${m} ${url}`).toBe(401);
    }
  });

  it("viewers can read but cannot create, update, remove or create resources", async () => {
    const { owner, a, b, dep } = await seed();
    const viewer = who("viewer", owner.org);
    expect((await api.get(`${D}/${dep.id}`, viewer)).status).toBe(200);
    expect((await api.get(D, viewer)).status).toBe(200);
    expect((await api.get(`/api/v1/agents/${a}/dependencies`, viewer)).status).toBe(200);
    expect((await api.post(D, viewer, operational(a, b))).status).toBe(403);
    expect((await api.patch(`${D}/${dep.id}`, viewer, { confidence: 0.2 })).status).toBe(403);
    expect((await api.delete(`${D}/${dep.id}`, viewer)).status).toBe(403);
    expect((await api.post("/api/v1/resources", viewer, { name: "x", resourceType: "api" })).status).toBe(403);
    expect((await api.get(`${D}/${dep.id}`, owner)).body.data).toMatchObject({ version: 1, status: "active" });
  });

  it("a forbidden write is not audited or versioned", async () => {
    const { owner, dep } = await seed();
    await api.patch(`${D}/${dep.id}`, who("viewer", owner.org), { confidence: 0.2 });
    expect((await api.get(`${D}/${dep.id}/versions`, owner)).body.pagination.total).toBe(1);
  });

  it("errors never leak SQL, constraint names or stack traces", async () => {
    const op = who("operator");
    const a = await mkAgent(api, op);
    const r = await mkResource(api, op);
    const cases = [
      await api.post(D, op, authority(a, a)),
      await api.post(D, op, authority(a, randomUUID())),
      await api.post(D, op, { ...authority(a, r), targetType: "resource" }),
    ];
    for (const c of cases) expect(c.raw).not.toMatch(/constraint|violates|pg_|stack|dependencies_|syntax error/i);
  });
});

