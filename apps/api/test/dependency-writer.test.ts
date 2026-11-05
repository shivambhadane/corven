import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DISCOVERY_ACTOR_ID, systemPrincipal } from "../src/auth/system.js";
import { assertCan } from "../src/auth/permissions.js";
import { DependencyRepository } from "../src/modules/dependency-registry/repositories/dependency.repository.js";
import type { CreateDependencyInput } from "../src/modules/dependency-registry/services/dependency-writer.service.js";
import type { EvidenceInput } from "../src/modules/dependency-registry/types/dependency.types.js";
import { mkAgent, mkAgents, mkResource } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const ev = (over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  sourceType: "agent_configuration",
  sourceReference: "cfg/support.json",
  discoveryRunId: randomUUID(),
  evidenceKind: "declared",
  confidence: 0.9,
  observedAt: new Date("2026-11-01T10:00:00Z"),
  ...over,
});

const op = (org: string, a: string, b: string, over: Partial<CreateDependencyInput> = {}): CreateDependencyInput => ({
  organizationId: org,
  sourceType: "agent", sourceId: a, targetType: "agent", targetId: b,
  dependencyType: "operational", relationship: "triggers",
  evidence: [ev()],
  ...over,
});

const writer = () => ctx.depRegistry.writer;
const evidenceOf = async (w: ReturnType<typeof who>, id: string) => (await api.get(`/api/v1/dependencies/${id}/evidence`, w)).body.data as any[];

describe("createOrUpdate: created / unchanged / updated", () => {
  it("creates a dependency with evidence, version 1 and the discovery actor", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const r = await writer().createOrUpdate(op(w.org, a, b));
    expect(r).toMatchObject({ outcome: "created", version: 1, evidenceAdded: 1 });
    const dep = (await api.get(`/api/v1/dependencies/${r.dependencyId}`, w)).body.data;
    expect(dep).toMatchObject({ dependencyType: "operational", confidence: 0.9, provenance: { source: "discovered", reference: "cfg/support.json" }, status: "active", version: 1 });
    const versions = (await api.get(`/api/v1/dependencies/${r.dependencyId}/versions`, w)).body.data;
    expect(versions[0].changedBy).toBe(DISCOVERY_ACTOR_ID);
    const audit = await ctx.depRegistry.repo.listAudit(ctx.handle.db, w.org, r.dependencyId!);
    expect(audit[0]).toMatchObject({ action: "dependency.created", actorId: DISCOVERY_ACTOR_ID });
  });

  it("is idempotent: the same call again is unchanged and adds no evidence or version", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const input = op(w.org, a, b);
    const first = await writer().createOrUpdate(input);
    const again = await writer().createOrUpdate(input); // identical, including discoveryRunId
    expect(again).toMatchObject({ outcome: "unchanged", dependencyId: first.dependencyId, version: 1, evidenceAdded: 0 });
    expect(await evidenceOf(w, first.dependencyId!)).toHaveLength(1);
    expect((await api.get(`/api/v1/dependencies/${first.dependencyId}/versions`, w)).body.pagination.total).toBe(1);
  });

  it("a later run's observation adds evidence but does not bump the version, and moves freshness forward", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const first = await writer().createOrUpdate(op(w.org, a, b));
    const later = await writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ discoveryRunId: randomUUID(), observedAt: new Date("2026-11-03T10:00:00Z") })] }));
    expect(later).toMatchObject({ outcome: "unchanged", version: 1, evidenceAdded: 1 });
    expect(await evidenceOf(w, first.dependencyId!)).toHaveLength(2);
    const dep = (await api.get(`/api/v1/dependencies/${first.dependencyId}`, w)).body.data;
    expect(dep.lastVerifiedAt).toBe("2026-11-03T10:00:00.000Z");
    expect(dep.version).toBe(1);
    // freshness never moves backward
    await writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ discoveryRunId: randomUUID(), observedAt: new Date("2026-10-01T00:00:00Z") })] }));
    expect((await api.get(`/api/v1/dependencies/${first.dependencyId}`, w)).body.data.lastVerifiedAt).toBe("2026-11-03T10:00:00.000Z");
  });

  it("raises confidence to the strongest evidence as a versioned update", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const first = await writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ confidence: 0.65, sourceType: "runtime_event", evidenceKind: "observed" })] }));
    const up = await writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ confidence: 0.95, sourceType: "workflow_definition" })] }));
    expect(up).toMatchObject({ outcome: "updated", version: 2, dependencyId: first.dependencyId });
    const dep = (await api.get(`/api/v1/dependencies/${first.dependencyId}`, w)).body.data;
    expect(dep.confidence).toBe(0.95);
    // weaker evidence later never lowers it
    const weaker = await writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ confidence: 0.2 })] }));
    expect(weaker).toMatchObject({ outcome: "unchanged", version: 2 });
    expect((await api.get(`/api/v1/dependencies/${first.dependencyId}`, w)).body.data.confidence).toBe(0.95);
    expect(await evidenceOf(w, first.dependencyId!)).toHaveLength(3);
  });

  it("a different relationship label or supplied metadata is a versioned update", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    await writer().createOrUpdate(op(w.org, a, b, { metadata: { operation: "request_payment" } }));
    const relabel = await writer().createOrUpdate(op(w.org, a, b, { relationship: "invokes", metadata: { operation: "request_payment" } }));
    expect(relabel).toMatchObject({ outcome: "updated", version: 2 });
    const remeta = await writer().createOrUpdate(op(w.org, a, b, { relationship: "invokes", metadata: { operation: "refund" }, evidence: [ev({ discoveryRunId: randomUUID() })] }));
    expect(remeta).toMatchObject({ outcome: "updated", version: 3 });
    // metadata omitted => not compared
    expect((await writer().createOrUpdate(op(w.org, a, b, { relationship: "invokes", evidence: [ev({ discoveryRunId: randomUUID() })] }))).outcome).toBe("unchanged");
  });

  it("records resource access with accessLevel 'unknown' when the source does not state it", async () => {
    const w = who("operator");
    const [a, r] = [await mkAgent(api, w), await mkResource(api, w)];
    const res = await writer().createOrUpdate({
      organizationId: w.org, sourceType: "agent", sourceId: a, targetType: "resource", targetId: r,
      dependencyType: "resource", relationship: "accesses", evidence: [ev()],
    });
    expect(res.outcome).toBe("created");
    expect((await api.get(`/api/v1/dependencies/${res.dependencyId}`, w)).body.data.metadata).toEqual({ accessLevel: "unknown" });
  });

  it("keeps an explicitly stated access level", async () => {
    const w = who("operator");
    const [a, r] = [await mkAgent(api, w), await mkResource(api, w)];
    const res = await writer().createOrUpdate({
      organizationId: w.org, sourceType: "agent", sourceId: a, targetType: "resource", targetId: r,
      dependencyType: "resource", relationship: "accesses", metadata: { accessLevel: "write" }, evidence: [ev()],
    });
    expect((await api.get(`/api/v1/dependencies/${res.dependencyId}`, w)).body.data.metadata.accessLevel).toBe("write");
  });

  it("is safe under concurrency: one dependency, one 'created', the rest 'unchanged'", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const run = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ discoveryRunId: run })] }))));
    expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "unchanged")).toHaveLength(5);
    expect(new Set(results.map((r) => r.dependencyId)).size).toBe(1);
    expect(await evidenceOf(w, results[0]!.dependencyId!)).toHaveLength(1);
    expect((await api.get(`/api/v1/dependencies?sourceId=${a}`, w)).body.pagination.total).toBe(1);
  });
});

describe("createOrUpdate: rejections (never throw for domain rules)", () => {
  it("rejects authority edges from config/workflow/runtime evidence alone", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    for (const sourceType of ["agent_configuration", "workflow_definition", "runtime_event", "external_integration"] as const) {
      const r = await writer().createOrUpdate(op(w.org, a, b, { dependencyType: "authority", relationship: "delegates", metadata: { scope: "payment.execute" }, evidence: [ev({ sourceType })] }));
      expect(r).toMatchObject({ outcome: "rejected", reasonCode: "AUTHORITY_REQUIRES_EXPLICIT_SOURCE" });
    }
    expect((await api.get(`/api/v1/dependencies?dependencyType=authority`, w)).body.pagination.total).toBe(0);
  });

  it("allows authority from permission_configuration, manual, or an approved review", async () => {
    const w = who("operator");
    const [a, b, c, d] = await mkAgents(api, w, 4);
    const meta = { scope: "payment.execute" };
    expect((await writer().createOrUpdate(op(w.org, a, b, { dependencyType: "authority", metadata: meta, evidence: [ev({ sourceType: "permission_configuration" })] }))).outcome).toBe("created");
    expect((await writer().createOrUpdate(op(w.org, a, c, { dependencyType: "authority", metadata: meta, evidence: [ev({ sourceType: "manual" })] }))).outcome).toBe("created");
    expect((await writer().createOrUpdate(op(w.org, a, d, { dependencyType: "authority", metadata: meta, approvedByReview: true, evidence: [ev({ sourceType: "workflow_definition" })] }))).outcome).toBe("created");
  });

  it("an explicit authority source still needs a scope", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const r = await writer().createOrUpdate(op(w.org, a, b, { dependencyType: "authority", evidence: [ev({ sourceType: "permission_configuration" })] }));
    expect(r).toMatchObject({ outcome: "rejected", reasonCode: "MISSING_REQUIRED_METADATA" });
  });

  it("rejects authority cycles", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const meta = { scope: "a.b" };
    await writer().createOrUpdate(op(w.org, a, b, { dependencyType: "authority", metadata: meta, evidence: [ev({ sourceType: "manual" })] }));
    const r = await writer().createOrUpdate(op(w.org, b, a, { dependencyType: "authority", metadata: meta, evidence: [ev({ sourceType: "manual" })] }));
    expect(r).toMatchObject({ outcome: "rejected", reasonCode: "AUTHORITY_CYCLE" });
  });

  it("rejects unknown endpoints, cross-organization endpoints, self-reference and wrong types", async () => {
    const w = who("operator");
    const other = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const foreign = await mkAgent(api, other);
    expect(await writer().createOrUpdate(op(w.org, a, randomUUID()))).toMatchObject({ outcome: "rejected", reasonCode: "ENDPOINT_NOT_FOUND" });
    expect(await writer().createOrUpdate(op(w.org, a, foreign))).toMatchObject({ outcome: "rejected", reasonCode: "ENDPOINT_NOT_FOUND" });
    expect(await writer().createOrUpdate(op(w.org, a, a))).toMatchObject({ outcome: "rejected", reasonCode: "SELF_REFERENCE" });
    expect(await writer().createOrUpdate(op(w.org, a, b, { dependencyType: "resource" }))).toMatchObject({ outcome: "rejected", reasonCode: "RELATIONSHIP_TYPE_MISMATCH" });
    expect((await api.get("/api/v1/dependencies", w)).body.pagination.total).toBe(0);
  });

  it("rejects missing, invalid or future evidence", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    expect(await writer().createOrUpdate(op(w.org, a, b, { evidence: [] }))).toMatchObject({ outcome: "rejected", reasonCode: "EVIDENCE_REQUIRED" });
    expect(await writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ confidence: 1.5 })] }))).toMatchObject({ outcome: "rejected", reasonCode: "INVALID_CONFIDENCE" });
    expect(await writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ observedAt: new Date(Date.now() + 86_400_000) })] }))).toMatchObject({ outcome: "rejected", reasonCode: "INVALID_FRESHNESS" });
    expect(await writer().createOrUpdate(op(w.org, a, b, { metadata: { token: "abc" } }))).toMatchObject({ outcome: "rejected", reasonCode: "VALIDATION_ERROR" });
  });

  it("does not resurrect an inactive dependency, but keeps the new evidence for review", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const first = await writer().createOrUpdate(op(w.org, a, b));
    await api.delete(`/api/v1/dependencies/${first.dependencyId}`, w);
    const r = await writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ discoveryRunId: randomUUID() })] }));
    expect(r).toMatchObject({ outcome: "rejected", reasonCode: "INACTIVE_REQUIRES_REVIEW", dependencyId: first.dependencyId, evidenceAdded: 1 });
    expect((await api.get(`/api/v1/dependencies/${first.dependencyId}`, w)).body.data).toMatchObject({ status: "inactive", version: 2 });
  });
});

describe("deactivate and findMatching", () => {
  it("deactivate removes softly with the reason in the audit trail, as the discovery actor", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const first = await writer().createOrUpdate(op(w.org, a, b));
    await writer().deactivate(w.org, first.dependencyId!, "confirmed removed by owner");
    const dep = (await api.get(`/api/v1/dependencies/${first.dependencyId}`, w)).body.data;
    expect(dep.status).toBe("inactive");
    const audit = await ctx.depRegistry.repo.listAudit(ctx.handle.db, w.org, first.dependencyId!);
    expect(audit.at(-1)).toMatchObject({ action: "dependency.removed", actorId: DISCOVERY_ACTOR_ID });
    expect((audit.at(-1)!.afterState as any).reason).toBe("confirmed removed by owner");
  });

  it("requires a reason and respects tenancy", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const first = await writer().createOrUpdate(op(w.org, a, b));
    await expect(writer().deactivate(w.org, first.dependencyId!, "  ")).rejects.toMatchObject({ statusCode: 400 });
    await expect(writer().deactivate(who("operator").org, first.dependencyId!, "reason")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("findMatching finds by org + endpoints + type, never across organizations", async () => {
    const w = who("operator");
    const [a, b] = await mkAgents(api, w, 2);
    const first = await writer().createOrUpdate(op(w.org, a, b));
    const key = { sourceType: "agent", sourceId: a, targetType: "agent", targetId: b, dependencyType: "operational" } as const;
    expect((await writer().findMatching(w.org, key))?.id).toBe(first.dependencyId);
    expect(await writer().findMatching(who("operator").org, key)).toBeNull();
    expect(await writer().findMatching(w.org, { ...key, dependencyType: "authority" })).toBeNull();
  });
});

describe("atomicity and permissions", () => {
  it("rolls back a creation if the evidence write fails", async () => {
    class FailingEvidence extends DependencyRepository {
      override async insertEvidence(): Promise<boolean> {
        throw new Error("simulated evidence failure");
      }
    }
    const bad = await createCtx(undefined, new FailingEvidence());
    try {
      const w = who("operator");
      const badApi = client(bad.app);
      const [a, b] = await mkAgents(badApi, w, 2);
      await expect(bad.depRegistry.writer.createOrUpdate(op(w.org, a, b))).rejects.toThrow(/simulated/);
      expect((await badApi.get("/api/v1/dependencies", w)).body.pagination.total).toBe(0);
    } finally {
      await bad.close();
    }
  });

  it("the system principal can write dependencies but not agents", () => {
    const sys = systemPrincipal(randomUUID());
    expect(() => assertCan(sys, "dependency:write")).not.toThrow();
    expect(() => assertCan(sys, "agent:write")).toThrow();
    expect(() => assertCan(sys, "agent:status")).toThrow();
    expect(() => assertCan(sys, "agent:recover")).toThrow();
    expect(() => assertCan(sys, "resource:write")).toThrow();
  });
});

describe("DependencyGraphDataProvider", () => {
  it("lists only active dependencies of the organization, filterable by type and freshness", async () => {
    const w = who("operator");
    const other = who("operator");
    const [a, b, c] = await mkAgents(api, w, 3);
    const r = await mkResource(api, w);
    const old = await writer().createOrUpdate(op(w.org, a, b, { evidence: [ev({ observedAt: new Date("2026-01-01T00:00:00Z") })] }));
    const fresh = await writer().createOrUpdate(op(w.org, a, c, { evidence: [ev({ observedAt: new Date("2026-11-01T00:00:00Z") })] }));
    const res = await writer().createOrUpdate({ organizationId: w.org, sourceType: "agent", sourceId: a, targetType: "resource", targetId: r, dependencyType: "resource", relationship: "accesses", evidence: [ev()] });
    const removed = await writer().createOrUpdate(op(w.org, b, c));
    await writer().deactivate(w.org, removed.dependencyId!, "gone");
    const [x, y] = await mkAgents(api, other, 2);
    await writer().createOrUpdate(op(other.org, x, y));

    const g = ctx.depRegistry.graphData;
    const ids = async (f = {}) => (await g.listActiveDependencies(w.org, f)).map((d) => d.id).sort();
    expect(await ids()).toEqual([old.dependencyId, fresh.dependencyId, res.dependencyId].sort());
    expect(await ids({ dependencyTypes: ["resource"] })).toEqual([res.dependencyId]);
    expect(await ids({ observedAfter: new Date("2026-06-01T00:00:00Z") })).toEqual([fresh.dependencyId, res.dependencyId].sort());
    expect((await g.getDependency(w.org, old.dependencyId!))?.id).toBe(old.dependencyId);
    expect(await g.getDependency(other.org, old.dependencyId!)).toBeNull();
    expect(await g.listActiveDependencies(randomUUID())).toEqual([]);
  });
});
