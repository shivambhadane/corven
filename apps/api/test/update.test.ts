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

describe("update", () => {
  it("updates permitted properties and advances updatedAt only", async () => {
    const op = who("operator");
    const a = await create(op);
    await new Promise((r) => setTimeout(r, 15));
    const res = await api.patch(`/api/v1/agents/${a.id}`, op, { name: "Renamed", description: "d", agentType: "service", metadata: { k: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Renamed", description: "d", agentType: "service", metadata: { k: 1 }, status: "active", id: a.id, organizationId: op.org, createdAt: a.createdAt });
    expect(Date.parse(res.body.data.updatedAt)).toBeGreaterThan(Date.parse(a.updatedAt));
  });

  it("clears the description with null", async () => {
    const op = who("operator");
    const a = await create(op, { description: "x" });
    const res = await api.patch(`/api/v1/agents/${a.id}`, op, { description: null });
    expect(res.body.data.description).toBeNull();
  });

  it.each([
    ["id", { id: "11111111-1111-4111-8111-111111111111" }],
    ["organizationId", { organizationId: "11111111-1111-4111-8111-111111111111" }],
    ["status", { status: "inactive" }],
    ["createdAt", { createdAt: "2000-01-01T00:00:00Z" }],
    ["updatedAt", { updatedAt: "2000-01-01T00:00:00Z" }],
    ["capabilities", { capabilities: ["a.b"] }],
  ])("rejects protected field %s", async (_f, body) => {
    const op = who("operator");
    const a = await create(op);
    const res = await api.patch(`/api/v1/agents/${a.id}`, op, body);
    expect(res.status).toBe(400);
    const after = (await api.get(`/api/v1/agents/${a.id}`, op)).body.data;
    expect(after.status).toBe("active");
    expect(after.organizationId).toBe(op.org);
  });

  it("rejects an empty patch, bad types and secret-looking metadata", async () => {
    const op = who("operator");
    const a = await create(op);
    expect((await api.patch(`/api/v1/agents/${a.id}`, op, {})).status).toBe(400);
    expect((await api.patch(`/api/v1/agents/${a.id}`, op, { agentType: "robot" })).status).toBe(400);
    expect((await api.patch(`/api/v1/agents/${a.id}`, op, { metadata: { private_key: "0x1" } })).status).toBe(400);
  });

  it("returns 409 when renaming onto an existing name", async () => {
    const op = who("operator");
    const a = await create(op);
    const b = await create(op);
    const res = await api.patch(`/api/v1/agents/${b.id}`, op, { name: a.name });
    expect(res.status).toBe(409);
  });

  it("cannot update an agent in another organization", async () => {
    const a = await create(who("operator"));
    const res = await api.patch(`/api/v1/agents/${a.id}`, who("admin"), { name: "hijack" });
    expect(res.status).toBe(404);
  });

  it("forbids viewers", async () => {
    const op = who("operator");
    const a = await create(op);
    expect((await api.patch(`/api/v1/agents/${a.id}`, who("viewer", op.org), { name: "n" })).status).toBe(403);
  });
});
