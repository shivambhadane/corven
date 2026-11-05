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

describe("capabilities", () => {
  it("adds capabilities (normalised, deduped, sorted)", async () => {
    const op = who("operator");
    const a = await create(op);
    const res = await api.put(`/api/v1/agents/${a.id}/capabilities`, op, { capabilities: ["Payment.Initiate", "analytics.read", "payment.initiate"] });
    expect(res.status).toBe(200);
    expect(res.body.data.capabilities).toEqual(["analytics.read", "payment.initiate"]);
  });

  it("replaces the set (add, keep and remove) and audits before/after", async () => {
    const op = who("operator");
    const a = await create(op, { capabilities: ["a.one", "a.two"] });
    await api.put(`/api/v1/agents/${a.id}/capabilities`, op, { capabilities: ["a.two", "a.three"] });
    const got = (await api.get(`/api/v1/agents/${a.id}`, op)).body.data;
    expect(got.capabilities).toEqual(["a.three", "a.two"]);
    const audit = (await ctx.registry.repo.listAudit(ctx.handle.db, op.org, a.id)).filter((x) => x.action === "agent.capabilities_changed");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.beforeState).toEqual({ capabilities: ["a.one", "a.two"] });
    expect(audit[0]!.afterState).toEqual({ capabilities: ["a.three", "a.two"] });
  });

  it("can clear all capabilities", async () => {
    const op = who("operator");
    const a = await create(op, { capabilities: ["x.y"] });
    const res = await api.put(`/api/v1/agents/${a.id}/capabilities`, op, { capabilities: [] });
    expect(res.body.data.capabilities).toEqual([]);
  });

  it.each([
    ["no dot", "customer"],
    ["spaces", "customer read"],
    ["uppercase symbols", "Customer-Read"],
    ["leading digit", "1a.b"],
    ["injection-ish", "a.b'; drop table agents;--"],
    ["empty", ""],
  ])("rejects malformed capability: %s", async (_l, cap) => {
    const op = who("operator");
    const a = await create(op);
    const res = await api.put(`/api/v1/agents/${a.id}/capabilities`, op, { capabilities: [cap] });
    expect(res.status).toBe(400);
  });

  it("rejects more than 100 capabilities and unknown body fields", async () => {
    const op = who("operator");
    const a = await create(op);
    const many = Array.from({ length: 101 }, (_, i) => `cap.n${i}`);
    expect((await api.put(`/api/v1/agents/${a.id}/capabilities`, op, { capabilities: many })).status).toBe(400);
    expect((await api.put(`/api/v1/agents/${a.id}/capabilities`, op, { capabilities: [], extra: 1 })).status).toBe(400);
  });

  it("is isolated across organizations", async () => {
    const a = await create(who("operator"));
    const res = await api.put(`/api/v1/agents/${a.id}/capabilities`, who("admin"), { capabilities: ["x.y"] });
    expect(res.status).toBe(404);
    expect((await api.put(`/api/v1/agents/${randomUUID()}/capabilities`, who("admin"), { capabilities: [] })).status).toBe(404);
  });

  it("forbids viewers", async () => {
    const op = who("operator");
    const a = await create(op);
    expect((await api.put(`/api/v1/agents/${a.id}/capabilities`, who("viewer", op.org), { capabilities: [] })).status).toBe(403);
  });

  it("does not grant authorization: a capability is plain data", async () => {
    const op = who("operator");
    const a = await create(op);
    const res = await api.put(`/api/v1/agents/${a.id}/capabilities`, op, { capabilities: ["payment.initiate"] });
    expect(res.body.data).toEqual({ capabilities: ["payment.initiate"] });
    // No endpoint exists that evaluates or enforces capabilities in this module.
    expect((await api.post(`/api/v1/agents/${a.id}/authorize`, op, {})).status).toBe(404);
  });
});
