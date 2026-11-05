import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createCtx, validAgent, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const create = async (w: ReturnType<typeof who>, over = {}) => (await api.post("/api/v1/agents", w, validAgent(over))).body.data;

describe("retrieval", () => {
  it("retrieves an agent with capabilities and identities", async () => {
    const op = who("operator");
    const a = await create(op, { capabilities: ["email.send"], identities: [{ identityType: "evm_address", identityValue: "0x" + "ab".repeat(20), chainId: 11155111 }] });
    const res = await api.get(`/api/v1/agents/${a.id}`, who("viewer", op.org));
    expect(res.status).toBe(200);
    expect(res.body.data.capabilities).toEqual(["email.send"]);
    expect(res.body.data.identities[0]).toMatchObject({ verificationStatus: "unverified", verifiedAt: null, chainId: 11155111 });
  });

  it("returns 404 for an unknown agent", async () => {
    const res = await api.get(`/api/v1/agents/${randomUUID()}`, who("viewer"));
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed agent id", async () => {
    const res = await api.get("/api/v1/agents/not-a-uuid", who("viewer"));
    expect(res.status).toBe(400);
  });

  it("returns 404 (not 403) for an agent in another organization", async () => {
    const a = await create(who("operator"));
    const res = await api.get(`/api/v1/agents/${a.id}`, who("admin")); // different org
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("Agent not found");
  });
});

describe("listing", () => {
  it("is scoped to the caller's organization", async () => {
    const orgA = who("operator");
    const orgB = who("operator");
    await create(orgA);
    await create(orgB);
    const res = await api.get("/api/v1/agents", orgA);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data.every((x: any) => x.organizationId === orgA.org)).toBe(true);
  });

  it("paginates deterministically", async () => {
    const op = who("operator");
    for (let i = 0; i < 5; i++) await create(op);
    const p1 = await api.get("/api/v1/agents?limit=2&offset=0", op);
    const p2 = await api.get("/api/v1/agents?limit=2&offset=2", op);
    const p3 = await api.get("/api/v1/agents?limit=2&offset=4", op);
    expect(p1.body.pagination).toEqual({ limit: 2, offset: 0, total: 5 });
    const ids = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((x: any) => x.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("filters by status, agentType and name search", async () => {
    const op = who("operator");
    const a = await create(op, { name: "Alpha_Search%", agentType: "wallet" });
    await create(op, { name: "Beta", agentType: "llm" });
    await api.post(`/api/v1/agents/${a.id}/status`, op, { status: "suspended", reason: "testing filter" });

    expect((await api.get("/api/v1/agents?status=suspended", op)).body.data.map((x: any) => x.id)).toEqual([a.id]);
    expect((await api.get("/api/v1/agents?agentType=wallet", op)).body.data).toHaveLength(1);
    expect((await api.get("/api/v1/agents?search=alpha", op)).body.data).toHaveLength(1);
    // LIKE wildcards in the search term are escaped, not interpreted
    expect((await api.get("/api/v1/agents?search=%25", op)).body.data).toHaveLength(1); // matches literal '%' in Alpha_Search%
    expect((await api.get("/api/v1/agents?search=Al_ha", op)).body.data).toHaveLength(0);
  });

  it("validates query parameters", async () => {
    const op = who("viewer");
    expect((await api.get("/api/v1/agents?limit=0", op)).status).toBe(400);
    expect((await api.get("/api/v1/agents?limit=101", op)).status).toBe(400);
    expect((await api.get("/api/v1/agents?status=bogus", op)).status).toBe(400);
    expect((await api.get("/api/v1/agents?organizationId=" + randomUUID(), op)).status).toBe(400);
  });
});
