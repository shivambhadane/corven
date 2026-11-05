import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createCtx, uniqueName, validAgent, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

describe("agent references (for entity resolution)", () => {
  it("stores externalReference, ownerReference and runtimeType", async () => {
    const op = who("operator");
    const res = await api.post("/api/v1/agents", op, validAgent({ externalReference: "support-agent", ownerReference: "team-support", runtimeType: "langgraph" }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ externalReference: "support-agent", ownerReference: "team-support", runtimeType: "langgraph" });
    const plain = await api.post("/api/v1/agents", op, validAgent());
    expect(plain.body.data).toMatchObject({ externalReference: null, ownerReference: null, runtimeType: null });
  });

  it("enforces uniqueness per organization, case-insensitively, with a safe 409", async () => {
    const op = who("operator");
    await api.post("/api/v1/agents", op, validAgent({ externalReference: "Payment-Agent" }));
    const dup = await api.post("/api/v1/agents", op, validAgent({ externalReference: "payment-agent" }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("AGENT_EXTERNAL_REF_CONFLICT");
    expect(dup.raw).not.toMatch(/constraint|agents_org|duplicate key/i);
    expect((await api.post("/api/v1/agents", who("operator"), validAgent({ externalReference: "payment-agent" }))).status).toBe(201);
  });

  it("allows many agents without an external reference", async () => {
    const op = who("operator");
    for (let i = 0; i < 3; i++) expect((await api.post("/api/v1/agents", op, validAgent())).status).toBe(201);
  });

  it("can be set, changed and cleared with PATCH, and is audited", async () => {
    const op = who("operator");
    const a = (await api.post("/api/v1/agents", op, validAgent())).body.data;
    expect((await api.patch(`/api/v1/agents/${a.id}`, op, { externalReference: "ref-1" })).body.data.externalReference).toBe("ref-1");
    expect((await api.patch(`/api/v1/agents/${a.id}`, op, { externalReference: null })).body.data.externalReference).toBeNull();
    const log = (await ctx.registry.repo.listAudit(ctx.handle.db, op.org, a.id)).filter((l) => l.action === "agent.updated");
    expect((log[0]!.afterState as any).externalReference).toBe("ref-1");
  });

  it.each([["has space", "a b"], ["leading dash", "-x"], ["injection", "x'; drop"], ["too long", "x".repeat(256)]])("rejects an invalid externalReference: %s", async (_l, ref) => {
    expect((await api.post("/api/v1/agents", who("operator"), validAgent({ externalReference: ref }))).status).toBe(400);
  });
});

describe("AgentRegistryReader (internal, organization-explicit)", () => {
  it("resolves by external reference within the organization only", async () => {
    const orgA = who("operator");
    const orgB = who("operator");
    const a = (await api.post("/api/v1/agents", orgA, validAgent({ externalReference: "shared-name" }))).body.data;
    await api.post("/api/v1/agents", orgB, validAgent({ externalReference: "shared-name" }));
    const reader = ctx.registry.reader;
    expect((await reader.findAgentByExternalReference(orgA.org, "SHARED-NAME"))?.id).toBe(a.id);
    expect(await reader.findAgentByExternalReference(orgA.org, "nope")).toBeNull();
    expect((await reader.findAgentByExternalReference(orgB.org, "shared-name"))?.id).not.toBe(a.id);
  });

  it("getAgent, listAgents, getCapabilities and validateAgentReference are tenant-scoped", async () => {
    const orgA = who("operator");
    const orgB = who("operator");
    const a = (await api.post("/api/v1/agents", orgA, validAgent({ name: uniqueName("r"), capabilities: ["x.y"] }))).body.data;
    const reader = ctx.registry.reader;
    expect((await reader.getAgent(orgA.org, a.id))?.id).toBe(a.id);
    expect(await reader.getAgent(orgB.org, a.id)).toBeNull();
    expect(await reader.getAgent(orgA.org, randomUUID())).toBeNull();
    expect((await reader.listAgents(orgA.org)).map((x) => x.id)).toEqual([a.id]);
    expect(await reader.listAgents(orgB.org)).toEqual([]);
    expect(await reader.getCapabilities(orgA.org, a.id)).toEqual(["x.y"]);
    expect(await reader.getCapabilities(orgB.org, a.id)).toEqual([]);
    expect(await reader.validateAgentReference(orgA.org, a.id)).toBe(true);
    expect(await reader.validateAgentReference(orgB.org, a.id)).toBe(false);
  });
});

describe("internal system principal", () => {
  it("cannot be obtained over HTTP: x-dev-role=system is rejected", async () => {
    const w = who("admin");
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/agents", headers: { "x-dev-actor-id": w.actor, "x-dev-org-id": w.org, "x-dev-role": "system" } });
    expect(res.statusCode).toBe(401);
  });
});
