import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authority, createDep, mkAgent, mkResource, operational, resourceDep, mkAgents } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());
const D = "/api/v1/dependencies";

describe("retrieval and response shape", () => {
  it("returns 201 on create and 200 on get, with the documented envelope", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const created = await api.post(D, op, authority(a, b));
    expect(created.status).toBe(201);
    const got = await api.get(`${D}/${created.body.data.id}`, who("viewer", op.org));
    expect(got.status).toBe(200);
    expect(Object.keys(got.body)).toEqual(["data"]);
    expect(Object.keys(got.body.data).sort()).toEqual([
      "confidence", "createdAt", "dependencyType", "id", "lastVerifiedAt", "metadata", "observedAt", "organizationId",
      "provenance", "relationship", "sourceId", "sourceType", "status", "targetId", "targetType", "updatedAt", "version",
    ]);
  });

  it("404 for unknown, 400 for a malformed id", async () => {
    const op = who("viewer");
    expect((await api.get(`${D}/${randomUUID()}`, op)).status).toBe(404);
    expect((await api.get(`${D}/not-a-uuid`, op)).status).toBe(400);
    expect((await api.patch(`${D}/${randomUUID()}`, who("operator"), { confidence: 0.5 })).status).toBe(404);
    expect((await api.delete(`${D}/${randomUUID()}`, who("operator"))).status).toBe(404);
  });
});

describe("listing, filtering and pagination", () => {
  async function world() {
    const op = who("operator");
    const [a, b, c] = await mkAgents(api, op, 3);
    const r = await mkResource(api, op);
    const ab = await createDep(api, op, authority(a, b));
    const ac = await createDep(api, op, operational(a, c));
    const ar = await createDep(api, op, resourceDep(a, r));
    const bc = await createDep(api, op, operational(b, c));
    await api.delete(`${D}/${bc.id}`, op);
    return { op, a, b, c, r, ab, ac, ar, bc };
  }

  it("filters by type, status, source and target", async () => {
    const { op, a, b, c, r, ab, ac, ar, bc } = await world();
    const ids = async (qs: string) => (await api.get(`${D}?${qs}`, op)).body.data.map((d: any) => d.id).sort();
    expect(await ids("dependencyType=authority")).toEqual([ab.id]);
    expect(await ids("dependencyType=operational")).toEqual([ac.id, bc.id].sort());
    expect(await ids("status=inactive")).toEqual([bc.id]);
    expect(await ids("dependencyType=operational&status=active")).toEqual([ac.id]);
    expect(await ids(`sourceId=${a}`)).toEqual([ab.id, ac.id, ar.id].sort());
    expect(await ids(`targetId=${c}`)).toEqual([ac.id, bc.id].sort());
    expect(await ids(`sourceId=${b}&targetId=${c}`)).toEqual([bc.id]);
    expect(await ids(`targetType=resource&targetId=${r}`)).toEqual([ar.id]);
    expect(await ids(`sourceType=resource`)).toEqual([]);
  });

  it("paginates with deterministic ordering and accurate totals", async () => {
    const { op } = await world();
    const all = (await api.get(`${D}?limit=100`, op)).body.data.map((d: any) => d.id);
    expect(all).toHaveLength(4);
    const p1 = await api.get(`${D}?page=1&limit=3`, op);
    const p2 = await api.get(`${D}?page=2&limit=3`, op);
    expect(p1.body.pagination).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
    expect([...p1.body.data, ...p2.body.data].map((d: any) => d.id)).toEqual(all);
    expect((await api.get(`${D}?page=3&limit=3`, op)).body.data).toEqual([]);
    // repeatable
    expect((await api.get(`${D}?page=1&limit=3`, op)).body.data.map((d: any) => d.id)).toEqual(p1.body.data.map((d: any) => d.id));
  });

  it("validates query parameters", async () => {
    const op = who("viewer");
    for (const qs of ["limit=0", "limit=101", "page=0", "page=abc", "sourceId=x", "targetType=workflow", "direction=both"]) {
      expect((await api.get(`${D}?${qs}`, op)).status, qs).toBe(400);
    }
  });
});

describe("GET /agents/:agentId/dependencies", () => {
  it("returns incoming, outgoing or both, filterable by type and status", async () => {
    const op = who("operator");
    const [a, b, c] = await mkAgents(api, op, 3);
    const r = await mkResource(api, op);
    const out1 = await createDep(api, op, authority(b, a)); // incoming to a
    const in1 = await createDep(api, op, operational(a, c)); // outgoing from a
    const in2 = await createDep(api, op, resourceDep(a, r)); // outgoing from a
    await createDep(api, op, operational(b, c)); // unrelated
    const list = async (qs = "") => (await api.get(`/api/v1/agents/${a}/dependencies${qs}`, op)).body.data.map((d: any) => d.id).sort();
    expect(await list()).toEqual([out1.id, in1.id, in2.id].sort());
    expect(await list("?direction=both")).toEqual([out1.id, in1.id, in2.id].sort());
    expect(await list("?direction=incoming")).toEqual([out1.id]);
    expect(await list("?direction=outgoing")).toEqual([in1.id, in2.id].sort());
    expect(await list("?direction=outgoing&dependencyType=resource")).toEqual([in2.id]);
    await api.delete(`${D}/${in1.id}`, op);
    expect(await list("?direction=outgoing&status=inactive")).toEqual([in1.id]);
    expect(await list("?direction=outgoing&status=active")).toEqual([in2.id]);
    const paged = await api.get(`/api/v1/agents/${a}/dependencies?limit=2&page=2`, op);
    expect(paged.body.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(paged.body.data).toHaveLength(1);
  });

  it("does not match resources that merely share an id with nothing, and 404s for unknown agents", async () => {
    const op = who("operator");
    expect((await api.get(`/api/v1/agents/${randomUUID()}/dependencies`, op)).status).toBe(404);
    expect((await api.get(`/api/v1/agents/nope/dependencies`, op)).status).toBe(400);
    expect((await api.get(`/api/v1/agents/${await mkAgent(api, op)}/dependencies?direction=sideways`, op)).status).toBe(400);
  });
});

describe("update and delete over HTTP", () => {
  it("PATCH returns 200 with the new version; DELETE returns 200 with the inactive record", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, operational(a, b));
    const p = await api.patch(`${D}/${d.id}`, op, { confidence: 0.3, metadata: { note: "x" } });
    expect(p.status).toBe(200);
    expect(p.body.data).toMatchObject({ confidence: 0.3, version: 2 });
    const del = await api.delete(`${D}/${d.id}`, op);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ status: "inactive", version: 3 });
  });

  it("rejects invalid PATCH bodies", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, operational(a, b));
    for (const body of [{ confidence: 2 }, { status: "deleted" }, { provenance: { source: "x" } }, { relationship: "" }, { expectedVersion: 0 }, { metadata: "str" }]) {
      expect((await api.patch(`${D}/${d.id}`, op, body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("resources (minimum model)", () => {
  it("creates, gets and lists resources; exposes no update or delete", async () => {
    const op = who("operator");
    const created = await api.post("/api/v1/resources", op, { name: "Ledger DB", resourceType: "database", description: "primary ledger" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: "Ledger DB", resourceType: "database", organizationId: op.org });
    expect((await api.get(`/api/v1/resources/${created.body.data.id}`, op)).status).toBe(200);
    expect((await api.get("/api/v1/resources", op)).body.pagination.total).toBe(1);
    expect((await api.patch(`/api/v1/resources/${created.body.data.id}`, op, { name: "x" })).status).toBe(404);
    expect((await api.delete(`/api/v1/resources/${created.body.data.id}`, op)).status).toBe(404);
  });

  it("validates resources", async () => {
    const op = who("operator");
    for (const body of [{ resourceType: "api" }, { name: "x", resourceType: "toaster" }, { name: "   ", resourceType: "api" }, { name: "x", resourceType: "api", organizationId: randomUUID() }]) {
      expect((await api.post("/api/v1/resources", op, body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});
