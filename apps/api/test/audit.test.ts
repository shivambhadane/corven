import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createCtx, validAgent, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const audit = (org: string, id: string) => ctx.registry.repo.listAudit(ctx.handle.db, org, id);

describe("audit trail", () => {
  it("records creation, update, status, capability and identity changes in order", async () => {
    const op = who("operator");
    const a = (await api.post("/api/v1/agents", op, validAgent({ name: "audited", capabilities: ["a.b"] }))).body.data;
    await api.patch(`/api/v1/agents/${a.id}`, op, { name: "audited-2" });
    await api.post(`/api/v1/agents/${a.id}/status`, op, { status: "suspended", reason: "routine check" });
    await api.put(`/api/v1/agents/${a.id}/capabilities`, op, { capabilities: ["c.d"] });
    await api.put(`/api/v1/agents/${a.id}/identities`, op, { identities: [{ identityType: "did", identityValue: "did:x:1" }] });

    const log = await audit(op.org, a.id);
    expect(log.map((l) => l.action)).toEqual([
      "agent.created",
      "agent.updated",
      "agent.status_changed",
      "agent.capabilities_changed",
      "agent.identities_changed",
    ]);
    expect(log.every((l) => l.actorId === op.actor && l.organizationId === op.org)).toBe(true);
    expect(log[0]!.beforeState).toBeNull();
    expect((log[0]!.afterState as any).name).toBe("audited");
    expect((log[1]!.beforeState as any).name).toBe("audited");
    expect((log[1]!.afterState as any).name).toBe("audited-2");
    expect((log[2]!.beforeState as any).status).toBe("active");
    expect((log[2]!.afterState as any).status).toBe("suspended");
  });

  it("does not audit failed or rejected operations", async () => {
    const op = who("operator");
    const a = (await api.post("/api/v1/agents", op, validAgent())).body.data;
    await api.post(`/api/v1/agents/${a.id}/status`, op, { status: "active", reason: "no-op" }); // 409
    await api.patch(`/api/v1/agents/${a.id}`, op, { status: "x" }); // 400
    expect(await audit(op.org, a.id)).toHaveLength(1);
  });

  it("exposes no HTTP route that can modify or delete audit history", async () => {
    const op = who("admin");
    const a = (await api.post("/api/v1/agents", op, validAgent())).body.data;
    const urls = [`/api/v1/agents/${a.id}/audit`, `/api/v1/agents/${a.id}/audit-logs`, `/api/v1/audit`, `/api/v1/agents/${a.id}/history/1`];
    for (const url of urls) {
      for (const m of ["PUT", "PATCH", "DELETE", "POST"] as const) {
        const res = await ctx.app.inject({ method: m, url, headers: { "x-dev-actor-id": op.actor, "x-dev-org-id": op.org, "x-dev-role": "admin" }, payload: {} });
        expect(res.statusCode, `${m} ${url}`).toBe(404);
      }
    }
    // The history endpoint is read-only too.
    expect((await api.put(`/api/v1/agents/${a.id}/history`, op, {})).status).toBe(404);
    expect((await api.delete(`/api/v1/agents/${a.id}/history`, op)).status).toBe(404);
    expect((await api.delete(`/api/v1/agents/${a.id}`, op)).status).toBe(404); // agents are never deleted
  });

  it("the database itself rejects UPDATE/DELETE/TRUNCATE on audit and history", async () => {
    const op = who("operator");
    const a = (await api.post("/api/v1/agents", op, validAgent())).body.data;
    const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);
    for (const table of ["agent_audit_logs", "agent_status_history"]) {
      await expect(q(`update ${table} set created_at = now() where agent_id = $1`, [a.id])).rejects.toMatchObject({ code: "23001" });
      await expect(q(`delete from ${table} where agent_id = $1`, [a.id])).rejects.toMatchObject({ code: "23001" });
      await expect(q(`truncate ${table}`)).rejects.toMatchObject({ code: "23001" });
    }
    expect(await audit(op.org, a.id)).toHaveLength(1);
  });

  it("agents cannot be hard-deleted while history exists (FK restrict)", async () => {
    const op = who("operator");
    const a = (await api.post("/api/v1/agents", op, validAgent())).body.data;
    await expect(ctx.handle.pool.query("delete from agents where id = $1", [a.id])).rejects.toMatchObject({ code: "23503" });
  });

  it("audit is organization-scoped", async () => {
    const op = who("operator");
    const a = (await api.post("/api/v1/agents", op, validAgent())).body.data;
    expect(await audit(who("admin").org, a.id)).toHaveLength(0);
  });
});
