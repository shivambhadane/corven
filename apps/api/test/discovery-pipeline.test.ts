import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DISCOVERY_ACTOR_ID } from "../src/auth/system.js";
import { validAgent, client, createCtx, uniqueName, who, type TestCtx, type Who } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const D = "/api/v1/discovery";
const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();
const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);

async function agent(w: Who, externalReference: string, name = uniqueName(externalReference)): Promise<string> {
  const r = await api.post("/api/v1/agents", w, validAgent({ name, externalReference }));
  if (r.status !== 201) throw new Error(r.raw);
  return r.body.data.id;
}
async function resource(w: Who, externalReference: string): Promise<string> {
  const r = await api.post("/api/v1/resources", w, { name: uniqueName(externalReference), resourceType: "api", externalReference });
  if (r.status !== 201) throw new Error(r.raw);
  return r.body.data.id;
}
async function source(w: Who, type: string, configuration?: unknown, name = uniqueName("src")) {
  const r = await api.post(`${D}/sources`, w, { type, name, ...(configuration !== undefined ? { configuration } : {}) });
  if (r.status !== 201) throw new Error(r.raw);
  return r.body.data;
}
async function run(w: Who, sourceId: string) {
  const r = await api.post(`${D}/sources/${sourceId}/runs`, w);
  if (r.status !== 202) throw new Error(`start failed: ${r.raw}`);
  await ctx.queue.idle();
  return (await api.get(`${D}/runs/${r.body.data.runId}`, w)).body.data;
}
const deps = async (w: Who, qs = "") => (await api.get(`/api/v1/dependencies?limit=100${qs}`, w)).body.data as any[];
const observations = async (w: Who, runId: string, status = "") => (await api.get(`${D}/runs/${runId}/observations?limit=100${status ? `&status=${status}` : ""}`, w)).body.data as any[];
const results = async (w: Who, runId: string, outcome = "") => (await api.get(`${D}/runs/${runId}/results?limit=100${outcome ? `&outcome=${outcome}` : ""}`, w)).body.data as any[];

/** Acme: five agents with external references, and a shared Customer API. */
async function acme(w: Who = who("operator")) {
  const ids = {
    support: await agent(w, "support-agent"), payment: await agent(w, "payment-agent"), database: await agent(w, "database-agent"),
    analytics: await agent(w, "analytics-agent"), email: await agent(w, "email-agent"), api: await resource(w, "customer-api"),
  };
  return { w, ...ids };
}
const supportConfig = {
  agent: "support-agent",
  tools: [
    { name: "payment-service", targetAgent: "payment-agent", operation: "request_payment" },
    { name: "customer-api", resourceType: "api" },
  ],
};

describe("configuration discovery, end to end", () => {
  it("discovers declared relationships and submits them through the registry with evidence", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "support", content: supportConfig }] });
    const r = await run(t.w, src.id);
    expect(r.status).toBe("completed");
    expect(r.summary).toMatchObject({ recordsCollected: 2, observationsCreated: 2, relationshipsCreated: 2, relationshipsUnchanged: 0, relationshipsRejected: 0, unresolvedObservations: 0, pendingReview: 0 });

    const all = await deps(t.w);
    expect(all).toHaveLength(2);
    const op = all.find((d) => d.dependencyType === "operational");
    expect(op).toMatchObject({ sourceId: t.support, targetId: t.payment, relationship: "invokes", confidence: 0.9, status: "active", version: 1, provenance: { source: "discovered" } });
    const res = all.find((d) => d.dependencyType === "resource");
    expect(res).toMatchObject({ sourceId: t.support, targetId: t.api, relationship: "accesses", metadata: { accessLevel: "unknown" }, confidence: 0.9 });

    const ev = (await api.get(`/api/v1/dependencies/${op.id}/evidence`, t.w)).body.data;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ sourceType: "agent_configuration", evidenceKind: "configured", discoveryRunId: r.id, confidence: 0.9 });
    expect(ev[0].sourceReference).toBe(`src:${src.id}/support#support-agent->payment-service`);
    expect((await api.get(`/api/v1/dependencies/${op.id}/versions`, t.w)).body.data[0].changedBy).toBe(DISCOVERY_ACTOR_ID);
    // discovery never creates authority
    expect(await deps(t.w, "&dependencyType=authority")).toHaveLength(0);
  });

  it("is idempotent: a second run changes nothing but appends evidence, and re-executing a finished run is a no-op", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "support", content: supportConfig }] });
    const r1 = await run(t.w, src.id);
    const r2 = await run(t.w, src.id);
    expect(r2.summary).toMatchObject({ relationshipsCreated: 0, relationshipsUnchanged: 2, relationshipsUpdated: 0 });
    expect((await results(t.w, r2.id)).map((x) => x.outcome)).toEqual(["unchanged", "unchanged"]);
    for (const d of await deps(t.w)) {
      expect(d.version).toBe(1);
      expect((await api.get(`/api/v1/dependencies/${d.id}/evidence`, t.w)).body.pagination.total).toBe(2);
    }
    const before = await deps(t.w);
    const again = await ctx.discovery.runner.execute(t.w.org, r1.id);
    expect(again.status).toBe("completed");
    expect(await deps(t.w)).toEqual(before);
    expect((await observations(t.w, r1.id)).length).toBe(2);
  });

  it("stores redacted, bounded raw evidence and never trusts display names alone", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "support", content: supportConfig }] });
    const r = await run(t.w, src.id);
    const o = (await observations(t.w, r.id))[0];
    expect(o.rawEvidence).toBeTypeOf("object");
    expect(o).toMatchObject({ processingStatus: "applied", reconciliationOutcome: "new", registryOutcome: "created" });
    expect(o.resolved.source.matchedBy).toBe("external_reference");
  });
});

describe("workflow discovery", () => {
  it("turns consecutive steps into operational 'triggers' with confidence 0.95, never authority", async () => {
    const t = await acme();
    const wf = { workflowId: "customer-payment-flow", steps: [{ agent: "support-agent", operation: "request_payment" }, { agent: "payment-agent", operation: "execute_payment" }, { agent: "analytics-agent", operation: "record_transaction" }] };
    const src = await source(t.w, "workflow_definition", { documents: [{ id: "wf1", content: wf }] });
    const r = await run(t.w, src.id);
    expect(r.summary.relationshipsCreated).toBe(2);
    const all = await deps(t.w);
    expect(all.map((d) => [d.sourceId, d.targetId, d.dependencyType, d.relationship, d.confidence]).sort()).toEqual([
      [t.payment, t.analytics, "operational", "triggers", 0.95], [t.support, t.payment, "operational", "triggers", 0.95],
    ].sort());
    expect(await deps(t.w, "&dependencyType=authority")).toHaveLength(0);
    const ev = (await api.get(`/api/v1/dependencies/${all[0].id}/evidence`, t.w)).body.data[0];
    expect(ev).toMatchObject({ sourceType: "workflow_definition", evidenceKind: "declared", evidenceReference: "workflow:customer-payment-flow" });
  });

  it("different sources naming the same dependency differently do not make the registry flip", async () => {
    const t = await acme();
    const cfg = await source(t.w, "agent_configuration", { documents: [{ id: "s", content: { agent: "support-agent", tools: [{ name: "pay", targetAgent: "payment-agent" }] } }] });
    const wf = await source(t.w, "workflow_definition", { documents: [{ id: "w", content: { workflowId: "w", steps: [{ agent: "support-agent" }, { agent: "payment-agent" }] } }] });
    await run(t.w, cfg.id);
    const second = await run(t.w, wf.id);
    // reconciliation sees no difference (labels are not compared); the registry only raises confidence to the stronger evidence
    expect((await results(t.w, second.id))[0].outcome).toBe("unchanged");
    const [d] = await deps(t.w);
    expect(d).toMatchObject({ relationship: "invokes", confidence: 0.95, version: 2 });
    expect((await api.get(`/api/v1/dependencies/${d.id}/evidence`, t.w)).body.pagination.total).toBe(2);
    await run(t.w, cfg.id); // weaker source again: no flip back
    expect(await deps(t.w)).toMatchObject([{ relationship: "invokes", confidence: 0.95, version: 2 }]);
  });
});

describe("runtime gateway discovery", () => {
  const ev = (id: string, outcome: string, over: Record<string, unknown> = {}) => ({ eventId: id, sourceAgent: "support-agent", targetAgent: "payment-agent", operation: "request_payment", outcome, timestamp: hourAgo(), ...over });

  it("ingests events, ignores duplicates, reports invalid ones, and consumes events exactly once", async () => {
    const t = await acme();
    const src = await source(t.w, "runtime_gateway");
    const ing = await api.post(`${D}/sources/${src.id}/events`, t.w, { events: [ev("e1", "allowed"), ev("e1", "allowed"), { eventId: "bad" }, ev("e2", "completed", { sourceAgent: "analytics-agent", targetAgent: "email-agent" })] });
    expect(ing.status).toBe(202);
    expect(ing.body.data).toMatchObject({ accepted: 2, duplicates: 1 });
    expect(ing.body.data.invalid).toEqual([{ index: 2, reason: "sourceAgent and targetAgent are required" }]);
    expect((await api.get(`${D}/coverage`, t.w)).body.data.sources[0].pendingRuntimeEvents).toBe(2);

    const r = await run(t.w, src.id);
    expect(r.summary).toMatchObject({ recordsCollected: 2, relationshipsCreated: 2 });
    expect((await deps(t.w)).every((d) => d.relationship === "calls" && d.confidence === 0.85)).toBe(true);
    expect((await api.get(`${D}/coverage`, t.w)).body.data.sources[0].pendingRuntimeEvents).toBe(0);
    const r2 = await run(t.w, src.id); // nothing new: consumed events are not re-read
    expect(r2.summary.recordsCollected).toBe(0);
    expect((await q("select count(*)::int n from discovery_runtime_events where consumed_run_id = $1", [r.id])).rows[0].n).toBe(2);
  });

  it("attempted or denied interactions are weaker evidence and wait for a human", async () => {
    const t = await acme();
    const src = await source(t.w, "runtime_gateway");
    await api.post(`${D}/sources/${src.id}/events`, t.w, { events: [ev("d1", "denied"), ev("a1", "attempted", { sourceAgent: "analytics-agent", targetAgent: "email-agent" })] });
    const r = await run(t.w, src.id);
    expect(r.summary).toMatchObject({ relationshipsCreated: 0, pendingReview: 2 });
    expect(await deps(t.w)).toHaveLength(0);
    const pending = await observations(t.w, r.id, "pending_review");
    expect(pending).toHaveLength(2);
    expect(pending[0].resolved.confidence).toBe(0.65);
    expect((await results(t.w, r.id)).map((x) => x.outcome)).toEqual(["new", "new"]);
  });

  it("redacts secrets in stored events and observations", async () => {
    const t = await acme();
    const src = await source(t.w, "runtime_gateway");
    await api.post(`${D}/sources/${src.id}/events`, t.w, { events: [ev("s1", "allowed", { authorization: "Bearer topsecret", extra: { apiKey: "k-123" } })] });
    const r = await run(t.w, src.id);
    const o = (await observations(t.w, r.id))[0];
    expect(JSON.stringify(o)).not.toMatch(/topsecret|k-123/);
    expect(o.rawEvidence.authorization).toBe("[redacted]");
    expect(JSON.stringify((await q("select payload from discovery_runtime_events where source_id=$1", [src.id])).rows)).not.toMatch(/topsecret|k-123/);
  });

  it("only runtime sources accept events", async () => {
    const t = await acme();
    const cfg = await source(t.w, "agent_configuration", { documents: [] });
    const res = await api.post(`${D}/sources/${cfg.id}/events`, t.w, { events: [ev("x", "allowed")] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SOURCE_TYPE_MISMATCH");
  });
});

describe("entity resolution in the pipeline", () => {
  it("unknown agents stay unresolved and never become entities or dependencies", async () => {
    const t = await acme();
    const cfg = { agent: "support-agent", tools: [{ name: "ghost", targetAgent: "ghost-agent" }, { name: "pay", targetAgent: "payment-agent" }] };
    const r = await run(t.w, (await source(t.w, "agent_configuration", { documents: [{ id: "d", content: cfg }] })).id);
    expect(r.summary).toMatchObject({ relationshipsCreated: 1, unresolvedObservations: 1 });
    const un = await observations(t.w, r.id, "unresolved");
    expect(un).toHaveLength(1);
    expect(un[0].rejectionReason).toMatch(/No registered agent matches "ghost-agent"/);
    expect((await results(t.w, r.id, "unresolved"))).toHaveLength(1);
    expect((await api.get("/api/v1/agents?search=ghost", t.w)).body.pagination.total).toBe(0);
  });

  it("an ambiguous reference is reported, not guessed", async () => {
    const t = await acme();
    // one agent has externalReference "twin"; a different agent's NAME is "twin"
    await agent(t.w, "twin", "other-name");
    await api.post("/api/v1/agents", t.w, validAgent({ name: "twin" }));
    const r = await run(t.w, (await source(t.w, "agent_configuration", { documents: [{ id: "d", content: { agent: "support-agent", tools: [{ name: "t", targetAgent: "twin" }] } }] })).id);
    expect(r.summary.unresolvedObservations).toBe(1);
    expect((await observations(t.w, r.id, "unresolved"))[0].rejectionReason).toMatch(/matches more than one/);
  });

  it("never resolves to another organization's entities", async () => {
    const t = await acme();
    const other = who("operator");
    await agent(other, "foreign-agent");
    const r = await run(t.w, (await source(t.w, "agent_configuration", { documents: [{ id: "d", content: { agent: "support-agent", tools: [{ name: "f", targetAgent: "foreign-agent" }] } }] })).id);
    expect(r.summary).toMatchObject({ unresolvedObservations: 1, relationshipsCreated: 0 });
    expect(await deps(other)).toHaveLength(0);
  });

  it("malformed documents become rejected observations with a reason; the rest of the run proceeds", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "good", content: supportConfig }, { id: "bad", content: { nonsense: true } }] });
    const r = await run(t.w, src.id);
    expect(r.status).toBe("completed_with_errors");
    expect(r.summary).toMatchObject({ relationshipsCreated: 2, relationshipsRejected: 1 });
    const rej = await observations(t.w, r.id, "rejected");
    expect(rej[0].rejectionReason).toMatch(/must be an object with an agent and a tools array/);
  });
});

describe("reconciliation outcomes", () => {
  it("modified: a source that states new metadata updates a discovered dependency (versioned)", async () => {
    const t = await acme();
    const cfg = (level?: string) => ({ documents: [{ id: "d", content: { agent: "support-agent", tools: [{ name: "customer-api", resourceType: "api", ...(level ? { accessLevel: level } : {}) }] } }] });
    const src = await source(t.w, "agent_configuration", cfg());
    await run(t.w, src.id);
    expect((await deps(t.w))[0].metadata.accessLevel).toBe("unknown");
    await api.patch(`${D}/sources/${src.id}`, t.w, { configuration: cfg("write") });
    const r2 = await run(t.w, src.id);
    expect(r2.summary.relationshipsUpdated).toBe(1);
    expect((await results(t.w, r2.id))[0]).toMatchObject({ outcome: "modified" });
    expect((await deps(t.w))[0]).toMatchObject({ metadata: { accessLevel: "write" }, version: 2 });
  });

  it("conflicting: a manual dependency is never overwritten; a human decides", async () => {
    const t = await acme();
    const manual = await api.post("/api/v1/dependencies", t.w, { sourceType: "agent", sourceId: t.support, targetType: "resource", targetId: t.api, dependencyType: "resource", relationship: "accesses", metadata: { accessLevel: "read" }, provenance: { source: "manual" } });
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "d", content: { agent: "support-agent", tools: [{ name: "customer-api", resourceType: "api", accessLevel: "write" }] } }] });
    const r = await run(t.w, src.id);
    expect(r.summary).toMatchObject({ pendingReview: 1, relationshipsUpdated: 0 });
    expect((await api.get(`/api/v1/dependencies/${manual.body.data.id}`, t.w)).body.data.metadata.accessLevel).toBe("read");
    const [obs] = await observations(t.w, r.id, "pending_review");
    expect(obs.reconciliationOutcome).toBe("conflicting");

    const approve = await api.post(`${D}/observations/${obs.id}/review`, t.w, { decision: "approve", reason: "access was widened" });
    expect(approve.status).toBe(200);
    expect(approve.body.data.observation).toMatchObject({ processingStatus: "applied", registryOutcome: "updated" });
    expect((await api.get(`/api/v1/dependencies/${manual.body.data.id}`, t.w)).body.data).toMatchObject({ metadata: { accessLevel: "write" }, version: 2 });
  });

  it("conflicting: an inactive dependency is not resurrected by discovery; approval reactivates it", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "d", content: supportConfig }] });
    await run(t.w, src.id);
    const d = (await deps(t.w)).find((x) => x.dependencyType === "operational");
    await api.delete(`/api/v1/dependencies/${d.id}`, t.w);

    const r2 = await run(t.w, src.id);
    expect(r2.summary).toMatchObject({ pendingReview: 1, relationshipsUnchanged: 1 });
    expect((await api.get(`/api/v1/dependencies/${d.id}`, t.w)).body.data.status).toBe("inactive");
    const [obs] = await observations(t.w, r2.id, "pending_review");
    expect(obs.reconciliationOutcome).toBe("conflicting");

    const res = await api.post(`${D}/observations/${obs.id}/review`, t.w, { decision: "approve" });
    expect(res.status).toBe(200);
    expect(res.body.data.observation.registryOutcome).toBe("reactivated");
    expect((await api.get(`/api/v1/dependencies/${d.id}`, t.w)).body.data.status).toBe("active");
  });

  it("conflicting: sources that state different access levels in the same run are parked", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [
      { id: "a", content: { agent: "support-agent", tools: [{ name: "customer-api", resourceType: "api", accessLevel: "read" }] } },
      { id: "b", content: { agent: "support-agent", tools: [{ name: "customer-api", resourceType: "api", accessLevel: "write" }] } },
    ] });
    const r = await run(t.w, src.id);
    expect(r.summary).toMatchObject({ pendingReview: 2, relationshipsCreated: 0 });
    expect((await results(t.w, r.id)).map((x) => x.outcome)).toEqual(["conflicting", "conflicting"]);
    expect(await deps(t.w)).toHaveLength(0);
  });

  it("missing: a relationship a source stops reporting is recorded, never deactivated", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "d", content: supportConfig }] });
    await run(t.w, src.id);
    const resDep = (await deps(t.w)).find((x) => x.dependencyType === "resource");
    await api.patch(`${D}/sources/${src.id}`, t.w, { configuration: { documents: [{ id: "d", content: { agent: "support-agent", tools: [supportConfig.tools[0]] } }] } });
    const r2 = await run(t.w, src.id);
    expect(r2.summary).toMatchObject({ missingRelationships: 1, relationshipsUnchanged: 1 });
    const missing = await results(t.w, r2.id, "missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ dependencyId: resDep.id });
    expect(missing[0].reason).toMatch(/NOT deactivated/);
    expect((await api.get(`/api/v1/dependencies/${resDep.id}`, t.w)).body.data).toMatchObject({ status: "active", version: 1 });
  });

  it("runtime sources are event streams, not scans: they never report missing", async () => {
    const t = await acme();
    const src = await source(t.w, "runtime_gateway");
    await api.post(`${D}/sources/${src.id}/events`, t.w, { events: [{ eventId: "m1", sourceAgent: "support-agent", targetAgent: "payment-agent", outcome: "allowed", timestamp: hourAgo() }] });
    await run(t.w, src.id);
    const r2 = await run(t.w, src.id);
    expect(r2.summary.missingRelationships).toBe(0);
    expect((await deps(t.w))[0].status).toBe("active");
  });

  it("stale: a source not successfully scanned within its window is flagged, and nothing is removed", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "d", content: supportConfig }] });
    expect((await api.get(`${D}/coverage`, t.w)).body.data.sources.find((s: any) => s.sourceId === src.id)).toMatchObject({ neverScanned: true, stale: false });
    await run(t.w, src.id);
    await q("update discovery_sources set last_successful_run_at = now() - interval '30 days' where id = $1", [src.id]);
    expect((await api.get(`${D}/coverage`, t.w)).body.data.sources.find((s: any) => s.sourceId === src.id)).toMatchObject({ stale: true, neverScanned: false });
    const r2 = await run(t.w, src.id);
    expect(r2.sourceWasStale).toBe(true);
    expect(await results(t.w, r2.id, "stale")).toHaveLength(1);
    expect((await deps(t.w)).every((d) => d.status === "active")).toBe(true);
    expect((await api.get(`${D}/coverage`, t.w)).body.data.sources.find((s: any) => s.sourceId === src.id).stale).toBe(false);
    expect((await api.get(`${D}/coverage`, t.w)).body.data.statement).toMatch(/absence of a relationship is not proof/);
  });
});

describe("failures never damage the registry", () => {
  it("a run that fails (invalid configuration) leaves every dependency exactly as it was", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "d", content: supportConfig }] });
    await run(t.w, src.id);
    const before = JSON.stringify(await deps(t.w));
    await q("update discovery_sources set configuration = '{\"documents\":\"broken\"}'::jsonb where id = $1", [src.id]);
    const r = await run(t.w, src.id);
    expect(r.status).toBe("failed");
    expect(r.errorSummary).toMatch(/Invalid source configuration/);
    expect(JSON.stringify(await deps(t.w))).toBe(before);
    // the failed run did not count as a successful scan
    const src2 = (await api.get(`${D}/sources/${src.id}`, t.w)).body.data;
    expect(src2.lastSuccessfulRunAt).not.toBeNull();
  });

  it("a deleted-or-disabled source cannot run; one active run per source; cancelled runs do nothing", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "d", content: supportConfig }] });
    await q("insert into discovery_runs (organization_id, source_id, source_type, status) values ($1,$2,$3,'pending')", [t.w.org, src.id, src.type]);
    const dup = await api.post(`${D}/sources/${src.id}/runs`, t.w);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("RUN_IN_PROGRESS");
    const pendingId = (await q("select id from discovery_runs where source_id=$1", [src.id])).rows[0].id;
    const cancelled = await api.post(`${D}/runs/${pendingId}/cancel`, t.w);
    expect(cancelled.body.data.status).toBe("cancelled");
    expect((await ctx.discovery.runner.execute(t.w.org, pendingId)).status).toBe("cancelled");
    expect((await api.post(`${D}/runs/${pendingId}/cancel`, t.w)).body.error.code).toBe("RUN_NOT_CANCELLABLE");
    expect(await deps(t.w)).toHaveLength(0);

    await api.patch(`${D}/sources/${src.id}`, t.w, { enabled: false });
    const off = await api.post(`${D}/sources/${src.id}/runs`, t.w);
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe("SOURCE_DISABLED");
  });

  it("the pipeline is resumable: observations left half-processed are finished by a retry, without duplicates", async () => {
    const t = await acme();
    const src = await source(t.w, "agent_configuration", { documents: [{ id: "d", content: supportConfig }] });
    const r = await run(t.w, src.id);
    // simulate a crash after collection: roll the run back to running and observations to 'normalized'
    await q("update discovery_runs set status='running' where id=$1", [r.id]);
    await q("update discovery_observations set processing_status='normalized', resolved=null, reconciliation_outcome=null, registry_outcome=null where run_id=$1", [r.id]);
    const finished = await ctx.discovery.runner.execute(t.w.org, r.id);
    expect(finished.status).toBe("completed");
    expect(await deps(t.w)).toHaveLength(2);
    for (const d of await deps(t.w)) {
      expect(d.version).toBe(1);
      expect((await api.get(`/api/v1/dependencies/${d.id}/evidence`, t.w)).body.pagination.total).toBe(1); // same run id: evidence not duplicated
    }
  });
});

describe("review", () => {
  async function pending(w: Who) {
    const src = await source(w, "runtime_gateway");
    await api.post(`${D}/sources/${src.id}/events`, w, { events: [{ eventId: uniqueName("e"), sourceAgent: "support-agent", targetAgent: "payment-agent", outcome: "attempted", timestamp: hourAgo() }] });
    const r = await run(w, src.id);
    return (await observations(w, r.id, "pending_review"))[0];
  }

  it("approve creates the dependency; the decision is recorded and cannot be repeated", async () => {
    const t = await acme();
    const obs = await pending(t.w);
    const res = await api.post(`${D}/observations/${obs.id}/review`, t.w, { decision: "approve", reason: "seen in logs" });
    expect(res.body.data.observation).toMatchObject({ processingStatus: "applied", registryOutcome: "created" });
    expect(res.body.data.review).toMatchObject({ decision: "approve", reviewerId: t.w.actor, reason: "seen in logs" });
    expect(await deps(t.w)).toHaveLength(1);
    const again = await api.post(`${D}/observations/${obs.id}/review`, t.w, { decision: "approve" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("OBSERVATION_NOT_REVIEWABLE");
    const got = (await api.get(`${D}/observations/${obs.id}`, t.w)).body.data;
    expect(got.reviews).toHaveLength(1);
  });

  it("reject requires a reason and keeps the dependency out of the registry", async () => {
    const t = await acme();
    const obs = await pending(t.w);
    expect((await api.post(`${D}/observations/${obs.id}/review`, t.w, { decision: "reject" })).status).toBe(400);
    const res = await api.post(`${D}/observations/${obs.id}/review`, t.w, { decision: "reject", reason: "test traffic" });
    expect(res.body.data.observation.processingStatus).toBe("review_rejected");
    expect(await deps(t.w)).toHaveLength(0);
  });

  it("defer leaves it pending and can be decided later", async () => {
    const t = await acme();
    const obs = await pending(t.w);
    const d = await api.post(`${D}/observations/${obs.id}/review`, t.w, { decision: "defer", reason: "ask the owner" });
    expect(d.body.data.observation.processingStatus).toBe("pending_review");
    expect((await api.post(`${D}/observations/${obs.id}/review`, t.w, { decision: "approve" })).status).toBe(200);
    expect((await api.get(`${D}/observations/${obs.id}`, t.w)).body.data.reviews.map((r: any) => r.decision)).toEqual(["defer", "approve"]);
  });

  it("only observations pending review can be reviewed", async () => {
    const t = await acme();
    const r = await run(t.w, (await source(t.w, "agent_configuration", { documents: [{ id: "d", content: supportConfig }] })).id);
    const [applied] = await observations(t.w, r.id, "applied");
    expect((await api.post(`${D}/observations/${applied.id}/review`, t.w, { decision: "approve" })).status).toBe(409);
    expect((await api.post(`${D}/observations/${randomUUID()}/review`, t.w, { decision: "approve" })).status).toBe(404);
  });

  it("append-only: reviews and reconciliation results cannot be altered", async () => {
    const t = await acme();
    const obs = await pending(t.w);
    await api.post(`${D}/observations/${obs.id}/review`, t.w, { decision: "defer" });
    await expect(q("update discovery_reviews set reason='x' where observation_id=$1", [obs.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from discovery_reviews where observation_id=$1", [obs.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update discovery_reconciliation_results set reason='x' where observation_id=$1", [obs.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("truncate discovery_reconciliation_results")).rejects.toMatchObject({ code: "23001" });
  });
});

describe("Phase 1 end to end: discover -> graph -> blast radius -> containment", () => {
  it("builds the Acme network from discovered evidence and plans minimum safe containment on it", async () => {
    const t = await acme();
    const cfgs = await source(t.w, "agent_configuration", { documents: [
      { id: "support", content: supportConfig },
      { id: "payment", content: { agent: "payment-agent", tools: [{ name: "customer-api", resourceType: "api" }, { name: "wallet-svc", targetAgent: "analytics-agent" }] } },
      { id: "database", content: { agent: "database-agent", tools: [{ name: "customer-api", resourceType: "api" }] } },
    ] });
    const wf = await source(t.w, "workflow_definition", { documents: [{ id: "w", content: { workflowId: "notify", steps: [{ agent: "analytics-agent" }, { agent: "email-agent" }] } }] });
    expect((await run(t.w, cfgs.id)).status).toBe("completed");
    expect((await run(t.w, wf.id)).status).toBe("completed");

    // discovery cannot know delegation; a human records the authority edge, with a scope
    await api.post("/api/v1/dependencies", t.w, { sourceType: "agent", sourceId: t.support, targetType: "agent", targetId: t.payment, dependencyType: "authority", relationship: "delegates_authority", metadata: { scope: "payment.execute" }, provenance: { source: "manual" } });

    const graph = (await api.get("/api/v1/graph", t.w)).body.data;
    expect(graph.metadata.nodeCount).toBe(6);
    expect(graph.edgesByDependencyType).toEqual({ authority: 1, operational: 3, resource: 3 });

    const blast = (await api.post("/api/v1/blast-radius/analyze", t.w, { sourceNodeIds: [`agent:${t.payment}`] })).body.data;
    expect(blast.impacted.find((n: any) => n.nodeId === `resource:${t.api}`)).toMatchObject({ classification: "exposed" });
    expect(blast.impacted.find((n: any) => n.nodeId === `agent:${t.email}`)).toMatchObject({ classification: "potentially_affected" });
    expect(blast.healthyNodeIds).toContain(`agent:${t.database}`);

    const snap = (await api.post("/api/v1/graph/snapshots", t.w, { label: "pre-incident" })).body.data;
    const res = await api.post("/api/v1/containment/plan", t.w, { sourceNodeIds: [`agent:${t.payment}`], protectedNodeIds: [`resource:${t.api}`], snapshotId: snap.id,
      healthyWorkflows: [{ id: "support-reads-api", from: `agent:${t.support}`, to: `resource:${t.api}` }, { id: "database-reads-api", from: `agent:${t.database}`, to: `resource:${t.api}` }] });
    expect(res.status).toBe(200);
    const p = res.body.data;
    expect(p).toMatchObject({ status: "feasible", totalCost: 1, approvalRequired: false });
    expect(p.actions).toHaveLength(1);
    expect(p.actions[0]).toMatchObject({ sourceNodeId: `agent:${t.payment}`, targetNodeId: `resource:${t.api}`, kind: "revoke_resource_access", affectsHealthyAgent: false });
    expect(p.preservedWorkflows.map((w: any) => w.satisfied)).toEqual([true, true]);
    expect(p.verification).toEqual({ protectedUnreachableAfterCut: true, workflowsStillSatisfied: true });
  });
});
