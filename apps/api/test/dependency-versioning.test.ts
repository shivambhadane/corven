import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DependencyRepository } from "../src/modules/dependency-registry/repositories/dependency.repository.js";
import { authority, createDep, mkAgent, operational, mkAgents } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());
const D = "/api/v1/dependencies";

const versions = async (w: ReturnType<typeof who>, id: string) => (await api.get(`${D}/${id}/versions`, w)).body.data as any[];
const audit = (org: string, id: string) => ctx.depRegistry.repo.listAudit(ctx.handle.db, org, id);

describe("versioning and audit", () => {
  it("records creation as version 1 with history and an audit row", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, authority(a, b));
    expect(d.version).toBe(1);
    const v = await versions(op, d.id);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ version: 1, changeType: "created", changedBy: op.actor });
    expect(v[0].state).toMatchObject({ relationship: "delegates_authority", status: "active", version: 1 });
    const log = await audit(op.org, d.id);
    expect(log.map((l) => l.action)).toEqual(["dependency.created"]);
    expect(log[0]!.beforeState).toBeNull();
    expect(log[0]!.actorId).toBe(op.actor);
  });

  it("increments the version on every modification and keeps old versions unchanged", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, authority(a, b, { confidence: 0.5 }));

    const u1 = await api.patch(`${D}/${d.id}`, op, { confidence: 0.8, provenance: { source: "imported", reference: "ticket-9" } });
    expect(u1.status).toBe(200);
    expect(u1.body.data).toMatchObject({ version: 2, confidence: 0.8, provenance: { source: "imported", reference: "ticket-9" } });
    const u2 = await api.patch(`${D}/${d.id}`, op, { metadata: { scope: "payment.refund" }, relationship: "delegates_refunds", lastVerifiedAt: "2026-03-01T00:00:00Z" });
    expect(u2.body.data).toMatchObject({ version: 3, metadata: { scope: "payment.refund" }, relationship: "delegates_refunds" });

    const v = await versions(op, d.id); // newest first
    expect(v.map((x) => x.version)).toEqual([3, 2, 1]);
    expect(v.map((x) => x.changeType)).toEqual(["updated", "updated", "created"]);
    // Historical states are exactly what they were at the time.
    expect(v[2].state).toMatchObject({ confidence: 0.5, metadata: { scope: "payment.execute" }, relationship: "delegates_authority", version: 1 });
    expect(v[1].state).toMatchObject({ confidence: 0.8, metadata: { scope: "payment.execute" }, version: 2 });
    expect(v[0].state).toMatchObject({ metadata: { scope: "payment.refund" }, version: 3 });

    const log = await audit(op.org, d.id);
    expect(log.map((l) => l.action)).toEqual(["dependency.created", "dependency.updated", "dependency.updated"]);
    expect((log[1]!.beforeState as any).confidence).toBe(0.5);
    expect((log[1]!.afterState as any).confidence).toBe(0.8);
  });

  it("records deactivation, removal and reactivation as distinct events", async () => {
    const op = who("operator");
    const [a, b, c] = await mkAgents(api, op, 3);
    const d = await createDep(api, op, operational(a, b));
    expect((await api.patch(`${D}/${d.id}`, op, { status: "inactive" })).body.data).toMatchObject({ status: "inactive", version: 2 });
    expect((await api.patch(`${D}/${d.id}`, op, { status: "active" })).body.data).toMatchObject({ status: "active", version: 3 });
    const removed = await api.delete(`${D}/${d.id}`, op);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ status: "inactive", version: 4 });

    expect((await versions(op, d.id)).map((x) => x.changeType)).toEqual(["removed", "activated", "deactivated", "created"]);
    expect((await audit(op.org, d.id)).map((l) => l.action)).toEqual([
      "dependency.created", "dependency.deactivated", "dependency.activated", "dependency.removed",
    ]);

    // removing twice is an explicit conflict and writes nothing
    const again = await api.delete(`${D}/${d.id}`, op);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_INACTIVE");
    expect(await versions(op, d.id)).toHaveLength(4);
    void c;
  });

  it("a no-op update returns the record without creating a version or audit row", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, authority(a, b, { confidence: 0.7 }));
    const res = await api.patch(`${D}/${d.id}`, op, { confidence: 0.7, relationship: "delegates_authority", metadata: { scope: "payment.execute" } });
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(1);
    expect(await versions(op, d.id)).toHaveLength(1);
    expect(await audit(op.org, d.id)).toHaveLength(1);
  });

  it("supports optimistic concurrency with expectedVersion", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, operational(a, b));
    await api.patch(`${D}/${d.id}`, op, { relationship: "calls" });
    const stale = await api.patch(`${D}/${d.id}`, op, { expectedVersion: 1, relationship: "invokes" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect((await api.delete(`${D}/${d.id}?expectedVersion=1`, op)).status).toBe(409);
    expect((await api.patch(`${D}/${d.id}`, op, { expectedVersion: 2, relationship: "invokes" })).body.data.version).toBe(3);
  });

  it("serialises concurrent updates: versions stay contiguous", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, operational(a, b));
    await Promise.all([1, 2, 3, 4, 5].map((i) => api.patch(`${D}/${d.id}`, op, { relationship: `label_${i}` })));
    const v = await versions(op, d.id);
    expect(v.map((x) => x.version)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("source, target and dependency type are immutable", async () => {
    const op = who("operator");
    const [a, b, c] = await mkAgents(api, op, 3);
    const d = await createDep(api, op, operational(a, b));
    for (const body of [{ sourceId: c }, { targetId: c }, { dependencyType: "authority" }, { sourceType: "resource" }, { organizationId: op.org }, { version: 9 }]) {
      expect((await api.patch(`${D}/${d.id}`, op, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await api.patch(`${D}/${d.id}`, op, {})).status).toBe(400);
    expect((await api.get(`${D}/${d.id}`, op)).body.data).toMatchObject({ sourceId: a, targetId: b, version: 1 });
  });

  it("still enforces per-type metadata on update (422) and secret guard (400)", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, authority(a, b));
    expect((await api.patch(`${D}/${d.id}`, op, { metadata: {} })).status).toBe(422);
    expect((await api.patch(`${D}/${d.id}`, op, { metadata: { scope: "a.b", password: "x" } })).status).toBe(400);
    expect((await api.patch(`${D}/${d.id}`, op, { observedAt: "2999-01-01T00:00:00Z" })).status).toBe(422);
    expect((await versions(op, d.id))).toHaveLength(1);
  });

  it("can clear freshness timestamps with null", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, operational(a, b, { observedAt: "2026-01-01T00:00:00Z" }));
    const res = await api.patch(`${D}/${d.id}`, op, { observedAt: null });
    expect(res.body.data.observedAt).toBeNull();
    expect(res.body.data.version).toBe(2);
  });
});

describe("immutability of history in the database", () => {
  const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);

  it("rejects UPDATE/DELETE/TRUNCATE on dependency_versions and dependency_audit_logs", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, operational(a, b));
    for (const table of ["dependency_versions", "dependency_audit_logs"]) {
      await expect(q(`update ${table} set created_at = now() where dependency_id=$1`, [d.id])).rejects.toMatchObject({ code: "23001" });
      await expect(q(`delete from ${table} where dependency_id=$1`, [d.id])).rejects.toMatchObject({ code: "23001" });
      await expect(q(`truncate ${table}`)).rejects.toMatchObject({ code: "23001" });
    }
    await expect(q("delete from dependencies where id=$1", [d.id])).rejects.toMatchObject({ code: "23503" });
    expect(await versions(op, d.id)).toHaveLength(1);
  });

  it("exposes no HTTP route that modifies history", async () => {
    const op = who("admin");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const d = await createDep(api, op, operational(a, b));
    for (const m of ["PUT", "PATCH", "DELETE", "POST"] as const) {
      const res = await ctx.app.inject({ method: m, url: `${D}/${d.id}/versions`, headers: { "x-dev-actor-id": op.actor, "x-dev-org-id": op.org, "x-dev-role": "admin" }, payload: {} });
      expect(res.statusCode, m).toBe(404);
    }
  });
});

describe("atomicity", () => {
  it("rolls back creation if the audit write fails", async () => {
    class FailingAudit extends DependencyRepository {
      override async insertAudit(): Promise<void> {
        throw new Error("simulated audit failure");
      }
    }
    const bad = await createCtx(undefined, new FailingAudit());
    try {
      const badApi = client(bad.app);
      const op = who("operator");
      const [a, b] = [await mkAgent(badApi, op), await mkAgent(badApi, op)];
      const res = await badApi.post(D, op, authority(a, b));
      expect(res.status).toBe(500);
      expect(res.raw).not.toMatch(/simulated|stack/i);
      expect((await badApi.get(D, op)).body.pagination.total).toBe(0);
      // and the pair is not blocked by a half-written row
      const count = await bad.handle.pool.query("select count(*)::int n from dependency_versions where organization_id=$1", [op.org]);
      expect(count.rows[0].n).toBe(0);
    } finally {
      await bad.close();
    }
  });

  it("rolls back an update if the version write fails", async () => {
    let fail = false;
    class FailingVersion extends DependencyRepository {
      override async insertVersion(...args: Parameters<DependencyRepository["insertVersion"]>): Promise<void> {
        if (fail) throw new Error("simulated version failure");
        return super.insertVersion(...args);
      }
    }
    const bad = await createCtx(undefined, new FailingVersion());
    try {
      const badApi = client(bad.app);
      const op = who("operator");
      const [a, b] = [await mkAgent(badApi, op), await mkAgent(badApi, op)];
      const d = await createDep(badApi, op, operational(a, b));
      fail = true;
      expect((await badApi.patch(`${D}/${d.id}`, op, { relationship: "changed" })).status).toBe(500);
      expect((await badApi.delete(`${D}/${d.id}`, op)).status).toBe(500);
      const after = (await badApi.get(`${D}/${d.id}`, op)).body.data;
      expect(after).toMatchObject({ relationship: "triggers", version: 1, status: "active" });
    } finally {
      await bad.close();
    }
  });
});
