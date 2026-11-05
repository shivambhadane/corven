import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentRepository } from "../src/modules/agent-registry/repositories/agent.repository.js";
import { client, createCtx, validAgent, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const create = async (w: ReturnType<typeof who>) => (await api.post("/api/v1/agents", w, validAgent())).body.data;
const setStatus = (id: string, w: ReturnType<typeof who>, status: string, reason = "valid reason text", extra = {}) =>
  api.post(`/api/v1/agents/${id}/status`, w, { status, reason, ...extra });

describe("valid transitions", () => {
  it.each([
    ["active", "suspended"],
    ["active", "compromised"],
    ["active", "inactive"],
  ])("operator: active -> %s", async (_a, to) => {
    const op = who("operator");
    const a = await create(op);
    const res = await setStatus(a.id, op, to);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(to);
  });

  it("operator can suspend then reactivate", async () => {
    const op = who("operator");
    const a = await create(op);
    await setStatus(a.id, op, "suspended");
    expect((await setStatus(a.id, op, "active")).body.data.status).toBe("active");
  });

  it("operator can reactivate an inactive agent", async () => {
    const op = who("operator");
    const a = await create(op);
    await setStatus(a.id, op, "inactive");
    expect((await setStatus(a.id, op, "active")).status).toBe(200);
  });
});

describe("invalid transitions", () => {
  it("rejects a no-op transition", async () => {
    const op = who("operator");
    const a = await create(op);
    const res = await setStatus(a.id, op, "active");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("rejects inactive -> suspended", async () => {
    const op = who("operator");
    const a = await create(op);
    await setStatus(a.id, op, "inactive");
    expect((await setStatus(a.id, op, "suspended")).status).toBe(409);
  });

  it("rejects an unknown status and a missing/blank reason", async () => {
    const op = who("operator");
    const a = await create(op);
    expect((await setStatus(a.id, op, "deleted")).status).toBe(400);
    expect((await setStatus(a.id, op, "suspended", "   ")).status).toBe(400);
    expect((await api.post(`/api/v1/agents/${a.id}/status`, op, { status: "suspended" })).status).toBe(400);
  });

  it("does not change status or write history when rejected", async () => {
    const op = who("operator");
    const a = await create(op);
    await setStatus(a.id, op, "active");
    const h = await api.get(`/api/v1/agents/${a.id}/history`, op);
    expect(h.body.pagination.total).toBe(1);
  });
});

describe("compromised recovery", () => {
  it("PATCH cannot change status", async () => {
    const op = who("operator");
    const a = await create(op);
    await setStatus(a.id, op, "compromised");
    expect((await api.patch(`/api/v1/agents/${a.id}`, op, { status: "active" })).status).toBe(400);
  });

  it("operator cannot move a compromised agent anywhere (every exit is a recovery)", async () => {
    const op = who("operator");
    const a = await create(op);
    await setStatus(a.id, op, "compromised");
    for (const to of ["active", "suspended", "inactive"]) {
      const res = await setStatus(a.id, op, to);
      expect(res.status, to).toBe(403);
    }
    expect((await api.get(`/api/v1/agents/${a.id}`, op)).body.data.status).toBe("compromised");
  });

  it("closes the compromised -> inactive -> active laundering route", async () => {
    const op = who("operator");
    const a = await create(op);
    await setStatus(a.id, op, "compromised");
    expect((await setStatus(a.id, op, "inactive")).status).toBe(403);
  });

  it("admin can recover with a substantive reason, recorded as a recovery", async () => {
    const op = who("operator");
    const admin = who("admin", op.org);
    const a = await create(op);
    await setStatus(a.id, op, "compromised");
    expect((await setStatus(a.id, admin, "active", "short")).status).toBe(409); // reason too short
    const ok = await setStatus(a.id, admin, "active", "Credentials rotated and host rebuilt");
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe("active");
    const audit = await ctx.registry.repo.listAudit(ctx.handle.db, op.org, a.id);
    const last = audit.at(-1)!;
    expect(last.action).toBe("agent.status_changed");
    expect((last.afterState as any).transition).toBe("recovery");
  });

  it("viewers cannot change status", async () => {
    const op = who("operator");
    const a = await create(op);
    expect((await setStatus(a.id, who("viewer", op.org), "suspended")).status).toBe(403);
  });
});

describe("status history", () => {
  it("records previous/new status, actor, reason and incident", async () => {
    const op = who("operator");
    const a = await create(op);
    const incidentId = randomUUID();
    await setStatus(a.id, op, "compromised", "anomalous wallet calls", { incidentId });
    const h = await api.get(`/api/v1/agents/${a.id}/history`, op);
    expect(h.body.data[0]).toMatchObject({
      agentId: a.id,
      previousStatus: "active",
      newStatus: "compromised",
      actorId: op.actor,
      reason: "anomalous wallet calls",
      incidentId,
    });
    expect(h.body.data[1]).toMatchObject({ previousStatus: null, newStatus: "active" });
  });

  it("is organization-scoped", async () => {
    const a = await create(who("operator"));
    expect((await api.get(`/api/v1/agents/${a.id}/history`, who("admin"))).status).toBe(404);
  });

  it("rejects a malformed incidentId", async () => {
    const op = who("operator");
    const a = await create(op);
    expect((await setStatus(a.id, op, "suspended", "valid reason text", { incidentId: "nope" })).status).toBe(400);
  });
});

describe("atomicity", () => {
  it("rolls back the status change if the audit write fails", async () => {
    class FailingAudit extends AgentRepository {
      override async insertAudit(...args: Parameters<AgentRepository["insertAudit"]>): Promise<void> {
        if (args[1].action === "agent.status_changed") throw new Error("simulated audit failure");
        return super.insertAudit(...args);
      }
    }
    const bad = await createCtx(new FailingAudit());
    try {
      const badApi = client(bad.app);
      const op = who("operator");
      const a = (await badApi.post("/api/v1/agents", op, validAgent())).body.data;
      const res = await badApi.post(`/api/v1/agents/${a.id}/status`, op, { status: "suspended", reason: "should roll back" });
      expect(res.status).toBe(500);
      expect(res.raw).not.toMatch(/simulated|stack/i); // internals not leaked

      const after = (await badApi.get(`/api/v1/agents/${a.id}`, op)).body.data;
      expect(after.status).toBe("active");
      const h = await badApi.get(`/api/v1/agents/${a.id}/history`, op);
      expect(h.body.pagination.total).toBe(1);
    } finally {
      await bad.close();
    }
  });

  it("rolls back registration if the audit write fails", async () => {
    class FailingAudit extends AgentRepository {
      override async insertAudit(): Promise<void> {
        throw new Error("simulated audit failure");
      }
    }
    const bad = await createCtx(new FailingAudit());
    try {
      const badApi = client(bad.app);
      const op = who("operator");
      const name = "ghost-" + randomUUID();
      expect((await badApi.post("/api/v1/agents", op, validAgent({ name, capabilities: ["a.b"] }))).status).toBe(500);
      expect((await badApi.get(`/api/v1/agents?search=${name}`, op)).body.data).toHaveLength(0);
    } finally {
      await bad.close();
    }
  });

  it("serialises concurrent changes: exactly one wins", async () => {
    const op = who("operator");
    const a = await create(op);
    const results = await Promise.all([
      setStatus(a.id, op, "suspended"),
      setStatus(a.id, op, "suspended"),
      setStatus(a.id, op, "suspended"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const h = await api.get(`/api/v1/agents/${a.id}/history`, op);
    expect(h.body.pagination.total).toBe(2);
  });
});

