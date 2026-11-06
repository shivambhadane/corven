import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemPrincipal } from "../src/auth/system.js";
import { SimulatedExecutor } from "../src/modules/authorization-gateway/index.js";
import { authority, createDep, mkAgent, mkResource, resourceDep } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx, type Who } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const E = "/api/v1/evidence";
const I = "/api/v1/incidents";
const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);
const adminP = (w: Who) => ({ actorId: w.actor, organizationId: w.org, role: "admin" as const });

/** The full compromised-agent scenario, driven through every module to `contained`. */
async function contained() {
  const admin = who("admin");
  const op = who("operator", admin.org);
  const approver = who("approver", admin.org);
  const [support, payment] = [await mkAgent(api, admin), await mkAgent(api, admin)];
  const wallet = await mkResource(api, admin);
  const customerApi = await mkResource(api, admin);
  await createDep(api, admin, authority(support, payment));
  await createDep(api, admin, resourceDep(payment, wallet));
  await createDep(api, admin, resourceDep(payment, customerApi));
  await createDep(api, admin, resourceDep(support, customerApi));
  const ex = new SimulatedExecutor();
  ctx.executors.register(wallet, ex);
  ctx.executors.register(customerApi, ex);
  for (const r of [wallet, customerApi]) await api.put(`/api/v1/gateway/resources/${r}/enforcement`, admin, { mode: "gateway" });
  for (const a of [support, payment]) await api.post("/api/v1/agent-auth/credentials", admin, { agentId: a });
  for (const [a, r, act] of [[payment, wallet, "transfer"], [payment, customerApi, "read"], [support, customerApi, "read"]]) await api.post("/api/v1/permissions", admin, { agentId: a, resourceId: r, action: act });

  const inc = (await api.post(I, op, { title: "Payment agent compromised", description: "Customer PII-LIKE-DETAIL observed leaving", severity: "critical", agents: [{ agentId: payment, relationship: "compromised" }], resources: [{ resourceId: wallet, relationship: "exposed", impactClassification: "exposed" }] })).body.data;
  await api.post(`${I}/${inc.id}/transition`, op, { to: "investigating", reason: "triage with private-reason-text" });
  await api.post(`${I}/${inc.id}/notes`, op, { content: "wallet calls began at 14:02 note-secret-text" });
  await api.post(`${I}/${inc.id}/graph-snapshot`, op, {});
  await api.post(`${I}/${inc.id}/blast-radius`, op, {});
  const plan = (await api.post(`${I}/${inc.id}/containment-plan`, op, { protectedNodeIds: [`resource:${wallet}`, `resource:${customerApi}`] })).body.data;
  await api.post(`${I}/${inc.id}/transition`, op, { to: "containment_planned", reason: "plan ready" });
  const ap = (await api.post("/api/v1/approvals", op, { incidentId: inc.id })).body.data;
  await api.post(`/api/v1/approvals/${ap.id}/approve`, approver, { comment: "approver-comment-text" });
  await ctx.app.incidentManagement.incidents.transition(systemPrincipal(admin.org, randomUUID()), inc.id, { to: "containing", reason: "enforcing" });
  await ctx.app.gateway.enforcement.applyPlan(adminP(admin), { incidentId: inc.id, planHash: plan.reference.planHash, actions: plan.result.plan.actions, keyPrefix: `p-${inc.id}`, reason: "enforce the approved plan" });
  const v = (await api.post("/api/v1/verification/run", op, { incidentId: inc.id })).body.data;
  expect(v.status).toBe("passed");
  expect((await api.get(`${I}/${inc.id}`, op)).body.data.status).toBe("contained");
  return { admin, op, approver, support, payment, wallet, inc, plan, ap, v };
}
type S = Awaited<ReturnType<typeof contained>>;
const generate = async (s: S, w: Who = s.op) => {
  const r = await api.post(`${E}/generate`, w, { incidentId: s.inc.id });
  if (r.status !== 201) throw new Error(r.raw);
  return r.body.data;
};
const verify = async (s: S, id: string, w: Who = s.op) => (await api.post(`${E}/${id}/verify`, w, {})).body.data;
const step = (v: any, name: string) => v.steps.find((x: any) => x.name === name);
const tamper = async (table: string, trigger: string, sql: string, params: unknown[]) => {
  await q(`alter table ${table} disable trigger ${trigger}`);
  try { await q(sql, params); } finally { await q(`alter table ${table} enable trigger ${trigger}`); }
};

describe("generating evidence", () => {
  it("seals a canonical, schema-versioned record of the whole response", async () => {
    const s = await contained();
    const e = await generate(s);
    expect(e).toMatchObject({ incidentId: s.inc.id, sequence: 1, schemaVersion: 1, status: "sealed", previousEvidenceId: null, previousHash: null, createdBy: s.op.actor });
    expect(e.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const c = e.content;
    expect(c).toMatchObject({ schemaVersion: 1, evidenceId: e.id, organizationId: s.admin.org, incidentId: s.inc.id, sequence: 1, previous: null });
    expect(c.incident).toMatchObject({ id: s.inc.id, severity: "critical", status: "contained", detectionSource: "manual" });
    expect(c.incident.stateHistory.map((h: any) => h.to)).toEqual(["detected", "investigating", "containment_planned", "awaiting_approval", "approved", "containing", "verifying", "contained"]);
    expect(c.agents).toEqual([expect.objectContaining({ agentId: s.payment, relationship: "compromised" })]);
    expect(c.resources).toEqual([expect.objectContaining({ resourceId: s.wallet, relationship: "exposed" })]);
    expect(c.analysis.map((a: any) => a.kind).sort()).toEqual(["blast_radius", "containment_plan", "graph_snapshot"]);
    expect(c.analysis.find((a: any) => a.kind === "containment_plan")).toMatchObject({ planHash: s.plan.reference.planHash, snapshotHash: s.plan.reference.snapshotHash });
    expect(c.approvals).toEqual([expect.objectContaining({ approvalId: s.ap.id, status: "approved", planHash: s.plan.reference.planHash, approvalDigest: s.ap.approvalDigest, decisions: [expect.objectContaining({ decision: "approve", role: "approver", decidedBy: s.approver.actor })] })]);
    expect(c.enforcement).toHaveLength(2);
    expect(c.enforcement.every((a: any) => a.status === "executed" && a.approvalBasis === "plan_approval" && a.history.length >= 2)).toBe(true);
    expect(c.verification).toEqual([expect.objectContaining({ runId: s.v.id, status: "passed", resultHash: s.v.resultHash, incidentOutcome: "contained" })]);
    expect(c.timeline.eventCount).toBeGreaterThan(10);
    expect(c.limitations.join(" ")).toMatch(/does not prove that the recorded events happened/);
  });

  it("keeps free text, secrets and credentials out of the record", async () => {
    const s = await contained();
    const e = await generate(s);
    const text = JSON.stringify(e.content);
    for (const leaked of ["PII-LIKE-DETAIL", "private-reason-text", "note-secret-text", "approver-comment-text", "Customer PII"]) expect(text).not.toContain(leaked);
    expect(text).not.toMatch(/secret_hash|cvn_|BEGIN .*PRIVATE KEY|Bearer /);
    expect(e.content.incident.descriptionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.content.notes).toMatchObject({ count: 1 });
    // the title is metadata the responders chose to make public inside the organization, and is kept
    expect(e.content.incident.title).toBe("Payment agent compromised");
  });

  it("is deterministic: sealed content is stored and the hash is reproducible from it", async () => {
    const s = await contained();
    const e = await generate(s);
    const stored = (await api.get(`${E}/${e.id}`, s.op)).body.data;
    expect(stored.contentHash).toBe(e.contentHash);
    expect(stored.content).toEqual(e.content);
    expect(await verify(s, e.id)).toMatchObject({ valid: true });
  });

  it("chains successive records of the same incident", async () => {
    const s = await contained();
    const first = await generate(s);
    await api.post(`${I}/${s.inc.id}/notes`, s.op, { content: "follow-up" });
    const second = await generate(s);
    expect(second).toMatchObject({ sequence: 2, previousEvidenceId: first.id, previousHash: first.contentHash });
    expect(second.content.previous).toEqual({ evidenceId: first.id, contentHash: first.contentHash });
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(second.content.timeline.eventCount).toBeGreaterThan(first.content.timeline.eventCount);
    // the earlier record is still valid even though the incident has moved on
    expect((await verify(s, first.id)).valid).toBe(true);
    expect((await verify(s, second.id)).valid).toBe(true);
    expect((await api.get(`${I}/${s.inc.id}/evidence`, s.op)).body.data.map((x: any) => x.sequence)).toEqual([1, 2]);
  });

  it("concurrent generation produces distinct, consecutive, correctly chained records", async () => {
    const s = await contained();
    const rs = await Promise.all(Array.from({ length: 4 }, () => api.post(`${E}/generate`, s.op, { incidentId: s.inc.id })));
    const ok = rs.filter((r) => r.status === 201).map((r) => r.body.data);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const list = (await api.get(`${I}/${s.inc.id}/evidence`, s.op)).body.data;
    expect(list.map((x: any) => x.sequence)).toEqual(list.map((_: unknown, i: number) => i + 1));
    for (let i = 1; i < list.length; i++) expect(list[i].previousHash).toBe(list[i - 1].contentHash);
  });

  it("records an evidence.generated event on the incident timeline", async () => {
    const s = await contained();
    const e = await generate(s);
    const tl = (await api.get(`${I}/${s.inc.id}/timeline?limit=200`, s.op)).body.data;
    expect(tl.find((x: any) => x.eventType === "evidence.generated")).toMatchObject({ actorType: "system", data: { evidenceId: e.id, contentHash: e.contentHash } });
  });

  it("works for an incident that is not contained, and says so", async () => {
    const op = who("operator");
    const inc = (await api.post(I, op, { title: "Early", severity: "low" })).body.data;
    const e = (await api.post(`${E}/generate`, op, { incidentId: inc.id })).body.data;
    expect(e.content.incident.status).toBe("detected");
    expect(e.content.verification).toEqual([]);
    expect(e.content.approvals).toEqual([]);
  });

  it("enforces roles and tenancy", async () => {
    const s = await contained();
    expect((await api.post(`${E}/generate`, who("viewer", s.admin.org), { incidentId: s.inc.id })).status).toBe(403);
    expect((await api.post(`${E}/generate`, s.approver, { incidentId: s.inc.id })).status).toBe(403);
    const other = who("admin");
    expect((await api.post(`${E}/generate`, other, { incidentId: s.inc.id })).body.error.code).toBe("INCIDENT_NOT_FOUND");
    const e = await generate(s);
    for (const w of [who("viewer", s.admin.org), s.approver]) expect((await api.get(`${E}/${e.id}`, w)).status).toBe(200);
    expect((await api.get(`${E}/${e.id}`, other)).status).toBe(404);
    expect((await api.post(`${E}/${e.id}/verify`, other, {})).status).toBe(404);
    expect((await api.post(`${E}/${e.id}/anchor`, other, {})).status).toBe(404);
    expect((await api.get(`${I}/${s.inc.id}/evidence`, other)).status === 404 || (await api.get(`${I}/${s.inc.id}/evidence`, other)).body.data.length === 0).toBe(true);
    expect((await api.post(`${E}/generate`, s.op, { incidentId: s.inc.id, content: {} })).status).toBe(400);
  });
});

describe("verification", () => {
  it("passes for untouched evidence and logs the verification", async () => {
    const s = await contained();
    const e = await generate(s);
    const v = await verify(s, e.id);
    expect(v.valid).toBe(true);
    expect(v.steps.map((x: any) => `${x.name}:${x.result}`)).toEqual(["content_hash:passed", "schema_version:passed", "chain:passed", "binding:passed", "sources_unchanged:passed"]);
    const logs = (await api.get(`${E}/${e.id}/verifications`, s.op)).body.data;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ valid: true, actorId: s.op.actor });
    expect((await api.get(`${E}/${e.id}`, s.op)).body.data.lastVerifiedAt).not.toBeNull();
  });

  it("detects tampered content", async () => {
    const s = await contained();
    const e = await generate(s);
    await tamper("evidence_records", "evidence_records_guard", "update evidence_records set content = jsonb_set(content, '{incident,severity}', '\"low\"') where id=$1", [e.id]);
    const v = await verify(s, e.id);
    expect(v.valid).toBe(false);
    expect(step(v, "content_hash").result).toBe("failed");
    expect(v.status).toBe("invalid");
    await expect(q("update evidence_records set status='sealed' where id=$1", [e.id])).rejects.toMatchObject({ code: "23001" }); // invalid is terminal
  });

  it("detects a tampered stored hash and a forged binding", async () => {
    const s = await contained();
    const e = await generate(s);
    await tamper("evidence_records", "evidence_records_guard", "update evidence_records set content_hash=$2 where id=$1", [e.id, "0".repeat(64)]);
    expect(step(await verify(s, e.id), "content_hash").result).toBe("failed");
  });

  it("detects a broken chain (an earlier record was altered)", async () => {
    const s = await contained();
    const first = await generate(s);
    const second = await generate(s);
    await tamper("evidence_records", "evidence_records_guard", "update evidence_records set content = jsonb_set(content, '{incident,title}', '\"changed\"') where id=$1", [first.id]);
    const v = await verify(s, second.id);
    expect(step(v, "chain").result).toBe("failed");
    expect(v.valid).toBe(false);
  });

  it.each([
    ["incident_state_history", "incident_state_history_append_only", "update incident_state_history set to_status='contained' where incident_id=$1 and to_status='investigating'", "state history"],
    ["incident_events", "incident_events_append_only", "update incident_events set event_type='incident.note_added' where incident_id=$1 and event_type='incident.created'", "timeline"],
    ["incident_notes", "incident_notes_append_only", "update incident_notes set content='rewritten' where incident_id=$1", "notes"],
    ["incident_analysis_references", "incident_analysis_references_append_only", "update incident_analysis_references set plan_hash=$2 where incident_id=$1 and kind='containment_plan'", "analysis"],
    ["approval_decisions", "approval_decisions_append_only", "update approval_decisions set decision='reject' where approval_id in (select id from approval_requests where incident_id=$1)", "approval"],
    ["enforcement_actions", "enforcement_actions_guard", "update enforcement_actions set status='failed' where incident_id=$1", "enforcement"],
  ])("detects a source record altered after sealing: %s", async (table, trigger, sql, _label) => {
    const s = await contained();
    const e = await generate(s);
    expect((await verify(s, e.id)).valid).toBe(true);
    await tamper(table, trigger, sql, sql.includes("$2") ? [s.inc.id, "f".repeat(64)] : [s.inc.id]);
    const v = await verify(s, e.id);
    expect(step(v, "sources_unchanged").result, `${table}: ${JSON.stringify(step(v, "sources_unchanged").detail)}`).toBe("failed");
    expect(v.valid).toBe(false);
  });

  it("detects a verification result that was altered", async () => {
    const s = await contained();
    const e = await generate(s);
    await tamper("verification_runs", "verification_runs_guard", "update verification_runs set result_hash=$2 where id=$1", [s.v.id, "e".repeat(64)]);
    expect(step(await verify(s, e.id), "sources_unchanged").result).toBe("failed");
  });

  it("does not mistake legitimate later activity for tampering", async () => {
    const s = await contained();
    const e = await generate(s);
    await api.post(`${I}/${s.inc.id}/notes`, s.op, { content: "later" });
    await api.post(`${I}/${s.inc.id}/transition`, s.op, { to: "resolved", reason: "done" });
    await api.post(`${I}/${s.inc.id}/transition`, s.op, { to: "closed", reason: "done" });
    expect((await verify(s, e.id)).valid).toBe(true);
  });
});

describe("anchoring", () => {
  it("anchors only the hash: Arkiv confirms on read-back; Ethereum stays pending until mined and confirmed", async () => {
    const s = await contained();
    const e = await generate(s);
    const r = await api.post(`${E}/${e.id}/anchor`, s.admin, {});
    expect(r.status).toBe(202);
    const anchors = Object.fromEntries(r.body.data.anchors.map((a: any) => [a.target, a]));
    expect(anchors.arkiv).toMatchObject({ status: "confirmed", anchoredHash: e.contentHash });
    expect(anchors.ethereum).toMatchObject({ status: "submitted", confirmations: 0, requiredConfirmations: 3, chainId: 11155111 });
    expect(r.body.data.status).toBe("anchor_pending"); // submitted is not anchored

    // what left the process contains identifiers and the hash, not the evidence
    const published = ctx.arkiv.entities.get(anchors.arkiv.externalReference)!;
    expect(published).toEqual({ evidenceId: e.id, contentHash: e.contentHash, schemaVersion: 1, sequence: 1 });
    expect(JSON.stringify([...ctx.arkiv.entities.values()])).not.toContain("Payment agent");
    expect(ctx.chain.txs.get(anchors.ethereum.externalReference)!.data).toBe(`0x${e.contentHash}`);

    // mined but too few confirmations: still not anchored
    ctx.chain.mine();
    let rf = (await api.post(`${E}/${e.id}/anchors/refresh`, s.admin, {})).body.data;
    expect(rf.status).toBe("anchor_pending");
    expect(rf.anchors.find((a: any) => a.target === "ethereum")).toMatchObject({ status: "submitted", confirmations: 1 });
    ctx.chain.mine(2);
    rf = (await api.post(`${E}/${e.id}/anchors/refresh`, s.admin, {})).body.data;
    expect(rf.status).toBe("anchored");
    expect(rf.anchors.find((a: any) => a.target === "ethereum")).toMatchObject({ status: "confirmed", confirmations: 4 });
    expect((await api.get(`${E}/${e.id}`, s.op)).body.data.status).toBe("anchored");
    expect((await api.get(`${I}/${s.inc.id}/timeline?limit=200`, s.op)).body.data.some((x: any) => x.data?.anchored === true)).toBe(true);

    const v = await verify(s, e.id);
    expect(v).toMatchObject({ valid: true, status: "verified" });
    expect(step(v, "anchor_arkiv").result).toBe("passed");
    expect(step(v, "anchor_ethereum")).toMatchObject({ result: "passed", detail: { confirmations: 4, required: 3 } });
  });

  it("an unavailable Arkiv or node never invalidates the record; it is reported and can be retried", async () => {
    const s = await contained();
    const e = await generate(s);
    ctx.arkiv.available = false;
    ctx.chain.available = false;
    try {
      const r = await api.post(`${E}/${e.id}/anchor`, s.admin, {});
      expect(r.status).toBe(202);
      expect(r.body.data.status).toBe("anchor_failed");
      expect(r.body.data.anchors.map((a: any) => [a.target, a.status, a.error])).toEqual([["arkiv", "failed", "arkiv unavailable"], ["ethereum", "failed", "rpc unavailable"]]);
      expect((await verify(s, e.id)).valid).toBe(true); // internally still valid
    } finally { ctx.arkiv.available = true; ctx.chain.available = true; }
    const retry = await api.post(`${E}/${e.id}/anchor`, s.admin, {});
    expect(retry.body.data.anchors.map((a: any) => [a.target, a.status, a.attempts])).toEqual([["arkiv", "confirmed", 2], ["ethereum", "submitted", 2]]);
  });

  it("a reverted transaction or one that does not carry the hash is a failed anchor, never anchored", async () => {
    const s = await contained();
    const e = await generate(s);
    await api.post(`${E}/${e.id}/anchor`, s.admin, { targets: ["ethereum"] });
    const tx = (await api.get(`${E}/${e.id}`, s.op)).body.data.anchors[0].externalReference;
    ctx.chain.revert(tx);
    ctx.chain.mine(5);
    const rf = (await api.post(`${E}/${e.id}/anchors/refresh`, s.admin, {})).body.data;
    expect(rf.status).toBe("anchor_failed");
    expect(rf.anchors[0]).toMatchObject({ status: "failed", error: "Transaction reverted" });

    const f = await generate(s);
    await api.post(`${E}/${f.id}/anchor`, s.admin, { targets: ["ethereum"] });
    const tx2 = (await api.get(`${E}/${f.id}`, s.op)).body.data.anchors[0].externalReference;
    ctx.chain.txs.get(tx2)!.data = `0x${"9".repeat(64)}`;
    ctx.chain.mine(5);
    const rf2 = (await api.post(`${E}/${f.id}/anchors/refresh`, s.admin, {})).body.data;
    expect(rf2.anchors[0]).toMatchObject({ status: "failed", error: "Transaction does not carry the evidence hash" });
  });

  it("verification notices external records that no longer match", async () => {
    const s = await contained();
    const e = await generate(s);
    const r = await api.post(`${E}/${e.id}/anchor`, s.admin, { targets: ["arkiv"] });
    const key = r.body.data.anchors[0].externalReference;
    ctx.arkiv.entities.set(key, { ...ctx.arkiv.entities.get(key)!, contentHash: "1".repeat(64) });
    const v = await verify(s, e.id);
    expect(step(v, "anchor_arkiv").result).toBe("failed");
    expect(v.valid).toBe(true); // the internal record is intact; the external copy is what disagrees
    ctx.arkiv.entities.delete(key);
    expect(step(await verify(s, e.id), "anchor_arkiv").result).toBe("failed");
  });

  it("refuses to anchor invalid evidence, anchors nothing twice, and needs configured targets and permission", async () => {
    const s = await contained();
    const e = await generate(s);
    expect((await api.post(`${E}/${e.id}/anchor`, s.op, {})).status).toBe(403); // operators generate and verify; anchoring is an admin act
    expect((await api.post(`${E}/${e.id}/anchor`, who("viewer", s.admin.org), {})).status).toBe(403);
    await api.post(`${E}/${e.id}/anchor`, s.admin, { targets: ["arkiv"] });
    const n = ctx.arkiv.entities.size;
    await api.post(`${E}/${e.id}/anchor`, s.admin, { targets: ["arkiv"] });
    expect(ctx.arkiv.entities.size).toBe(n);

    const bad = await generate(s);
    await tamper("evidence_records", "evidence_records_guard", "update evidence_records set content = jsonb_set(content, '{incident,severity}', '\"low\"') where id=$1", [bad.id]);
    const r = await api.post(`${E}/${bad.id}/anchor`, s.admin, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("EVIDENCE_INVALID");
    expect(ctx.arkiv.entities.size).toBe(n); // nothing was published
    expect((await api.get(`${E}/${bad.id}`, s.op)).body.data.status).toBe("invalid");
  });

  it("anchors are final once confirmed and can never be rewritten", async () => {
    const s = await contained();
    const e = await generate(s);
    await api.post(`${E}/${e.id}/anchor`, s.admin, { targets: ["arkiv"] });
    await expect(q("update evidence_anchors set status='failed' where evidence_id=$1", [e.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update evidence_anchors set anchored_hash=$2 where evidence_id=$1", [e.id, "0".repeat(64)])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from evidence_anchors where evidence_id=$1", [e.id])).rejects.toMatchObject({ code: "23001" });
  });
});

describe("records are immutable", () => {
  it("sealed content, hash and chain cannot change; nothing is deleted; logs are append-only", async () => {
    const s = await contained();
    const e = await generate(s);
    await verify(s, e.id);
    for (const sql of ["update evidence_records set content='{}'::jsonb where id=$1", "update evidence_records set content_hash=repeat('0',64) where id=$1", "update evidence_records set sequence=9 where id=$1", "update evidence_records set previous_hash=repeat('0',64) where id=$1", "delete from evidence_records where id=$1"]) {
      await expect(q(sql, [e.id]), sql).rejects.toMatchObject({ code: "23001" });
    }
    await expect(q("truncate evidence_records")).rejects.toMatchObject({ code: expect.stringMatching(/^(23001|0A000)$/) });
    await expect(q("update evidence_verification_logs set valid=false where evidence_id=$1", [e.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from evidence_verification_logs where evidence_id=$1", [e.id])).rejects.toMatchObject({ code: "23001" });
  });
});
