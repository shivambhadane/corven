import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkAgents } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const ev = (over = {}) => ({
  sourceType: "workflow_definition" as const, sourceReference: "wf/payment.json", evidenceKind: "declared" as const,
  confidence: 0.95, observedAt: new Date("2026-11-02T00:00:00Z"), ...over,
});

async function seed() {
  const w = who("operator");
  const [a, b] = await mkAgents(api, w, 2);
  const r = await ctx.depRegistry.writer.createOrUpdate({
    organizationId: w.org, sourceType: "agent", sourceId: a, targetType: "agent", targetId: b,
    dependencyType: "operational", relationship: "triggers", evidence: [ev(), ev({ sourceType: "runtime_event", evidenceKind: "observed", confidence: 0.85, sourceReference: "evt_1" })],
  });
  return { w, id: r.dependencyId! };
}

describe("evidence endpoint", () => {
  it("lists evidence, newest observation first, with pagination", async () => {
    const { w, id } = await seed();
    const res = await api.get(`/api/v1/dependencies/${id}/evidence`, who("viewer", w.org));
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data[0]).toMatchObject({ dependencyId: id, evidenceKind: expect.any(String), confidence: expect.any(Number) });
    expect(Object.keys(res.body.data[0]).sort()).toEqual([
      "confidence", "createdAt", "dependencyId", "discoveryRunId", "evidenceKind", "evidenceReference",
      "id", "observedAt", "sourceReference", "sourceType", "sourceVersion",
    ]);
    expect((await api.get(`/api/v1/dependencies/${id}/evidence?limit=1&page=2`, w)).body.data).toHaveLength(1);
  });

  it("is tenant-scoped and requires authentication", async () => {
    const { id } = await seed();
    expect((await api.get(`/api/v1/dependencies/${id}/evidence`, who("admin"))).status).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: `/api/v1/dependencies/${id}/evidence` })).statusCode).toBe(401);
  });

  it("has no route that modifies evidence", async () => {
    const { w, id } = await seed();
    for (const m of ["PUT", "PATCH", "DELETE", "POST"] as const) {
      const res = await ctx.app.inject({ method: m, url: `/api/v1/dependencies/${id}/evidence`, headers: { "x-dev-actor-id": w.actor, "x-dev-org-id": w.org, "x-dev-role": "operator" }, payload: {} });
      expect(res.statusCode, m).toBe(404);
    }
  });
});

describe("evidence integrity in the database", () => {
  const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);

  it("rejects UPDATE, DELETE and TRUNCATE", async () => {
    const { id } = await seed();
    await expect(q("update dependency_evidence set confidence = 0 where dependency_id = $1", [id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from dependency_evidence where dependency_id = $1", [id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("truncate dependency_evidence")).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from dependencies where id = $1", [id])).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects evidence pointing at another organization's dependency (composite FK)", async () => {
    const { id } = await seed();
    await expect(
      q("insert into dependency_evidence (organization_id, dependency_id, source_type, evidence_kind, confidence, observed_at) values ($1,$2,'manual','declared',1,now())", [who("operator").org, id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("CHECK constraints reject bad source types, kinds and confidence", async () => {
    const { w, id } = await seed();
    const ins = (src: string, kind: string, conf: number) =>
      q("insert into dependency_evidence (organization_id, dependency_id, source_type, evidence_kind, confidence, observed_at) values ($1,$2,$3,$4,$5,now())", [w.org, id, src, kind, conf]);
    await expect(ins("guess", "declared", 1)).rejects.toMatchObject({ code: "23514" });
    await expect(ins("manual", "rumoured", 1)).rejects.toMatchObject({ code: "23514" });
    await expect(ins("manual", "declared", 2)).rejects.toMatchObject({ code: "23514" });
  });
});
