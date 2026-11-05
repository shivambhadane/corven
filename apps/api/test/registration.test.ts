import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createCtx, uniqueName, validAgent, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

describe("registration", () => {
  it("registers a valid agent with server-set defaults", async () => {
    const op = who("operator");
    const res = await api.post("/api/v1/agents", op, {
      name: "  Billing Bot ",
      description: "Handles invoices",
      agentType: "workflow",
      capabilities: ["Payment.Initiate", "customer.read", "customer.read"],
      metadata: { team: "finance" },
    });
    expect(res.status).toBe(201);
    const a = res.body.data;
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.organizationId).toBe(op.org);
    expect(a.name).toBe("Billing Bot");
    expect(a.status).toBe("active");
    expect(a.capabilities).toEqual(["customer.read", "payment.initiate"]);
    expect(a.createdAt).toBe(a.updatedAt);
    expect(Date.parse(a.createdAt)).not.toBeNaN();
  });

  it("records an initial status-history entry", async () => {
    const op = who("operator");
    const { body } = await api.post("/api/v1/agents", op, validAgent());
    const h = await api.get(`/api/v1/agents/${body.data.id}/history`, op);
    expect(h.body.data).toHaveLength(1);
    expect(h.body.data[0]).toMatchObject({ previousStatus: null, newStatus: "active", actorId: op.actor });
  });

  it.each([
    ["missing name", { agentType: "llm" }],
    ["missing agentType", { name: "x" }],
    ["blank name", { name: "   ", agentType: "llm" }],
    ["name too long", { name: "x".repeat(121), agentType: "llm" }],
    ["invalid agentType", { name: "x", agentType: "robot" }],
    ["malformed capability", { name: "x", agentType: "llm", capabilities: ["NOT A CAP"] }],
    ["non-object metadata", { name: "x", agentType: "llm", metadata: "str" }],
  ])("rejects %s", async (_label, body) => {
    const res = await api.post("/api/v1/agents", who("operator"), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a client-supplied organizationId, status or id (mass assignment)", async () => {
    const op = who("operator");
    for (const extra of [
      { organizationId: who("admin").org },
      { status: "compromised" },
      { id: "11111111-1111-4111-8111-111111111111" },
      { createdAt: "2000-01-01T00:00:00Z" },
    ]) {
      const res = await api.post("/api/v1/agents", op, validAgent(extra));
      expect(res.status).toBe(400);
    }
  });

  it("rejects secret-looking metadata keys", async () => {
    const res = await api.post("/api/v1/agents", who("operator"), validAgent({ metadata: { nested: { apiKey: "abc" } } }));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/secret/i);
  });

  it("rejects a duplicate name in the same organization (case-insensitive)", async () => {
    const op = who("operator");
    const name = uniqueName("dup");
    expect((await api.post("/api/v1/agents", op, validAgent({ name }))).status).toBe(201);
    const dup = await api.post("/api/v1/agents", op, validAgent({ name: name.toUpperCase() }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("AGENT_NAME_CONFLICT");
    expect(dup.raw).not.toMatch(/agents_org_name_unique|constraint|duplicate key/i);
  });

  it("allows the same name in a different organization", async () => {
    const name = uniqueName("shared");
    expect((await api.post("/api/v1/agents", who("operator"), validAgent({ name }))).status).toBe(201);
    expect((await api.post("/api/v1/agents", who("operator"), validAgent({ name }))).status).toBe(201);
  });

  it("forbids viewers from registering", async () => {
    const res = await api.post("/api/v1/agents", who("viewer"), validAgent());
    expect(res.status).toBe(403);
  });

  it("does not leave a partial agent behind when registration fails mid-way", async () => {
    const op = who("operator");
    const name = uniqueName("atomic");
    // Second identity duplicates the first -> rejected before/during the transaction.
    const res = await api.post("/api/v1/agents", op, validAgent({
      name,
      identities: [
        { identityType: "ens", identityValue: "a.eth" },
        { identityType: "ens", identityValue: "A.eth" },
      ],
    }));
    expect(res.status).toBe(400);
    const list = await api.get(`/api/v1/agents?search=${name}`, op);
    expect(list.body.data).toHaveLength(0);
  });
});
