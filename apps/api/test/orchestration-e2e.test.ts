import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SimulatedExecutor } from "../src/modules/authorization-gateway/index.js";
import { PgBossTicker } from "../src/modules/orchestrator/index.js";
import { authority, createDep, mkAgent, mkResource, operational, resourceDep } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";
import { inject } from "vitest";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const I = "/api/v1/incidents";
const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);
const orch = () => ctx.app.orchestrator.orchestrator;

/** Acme: Support Agent (delegates to) Payment Agent, which uses the wallet and the customer API; Support and Database also use the customer API. */
async function network(opts: { declareGateway?: boolean } = {}) {
  const admin = who("admin");
  const op = who("operator", admin.org);
  const approver = who("approver", admin.org);
  const [support, payment, analytics, database] = [await mkAgent(api, admin), await mkAgent(api, admin), await mkAgent(api, admin), await mkAgent(api, admin)];
  const wallet = await mkResource(api, admin);
  const customerApi = await mkResource(api, admin);
  await createDep(api, admin, authority(support, payment));
  await createDep(api, admin, resourceDep(payment, wallet));
  await createDep(api, admin, resourceDep(payment, customerApi));
  await createDep(api, admin, resourceDep(support, customerApi));
  await createDep(api, admin, resourceDep(database, customerApi));
  await createDep(api, admin, operational(payment, analytics));
  const executor = new SimulatedExecutor();
  ctx.executors.register(wallet, executor);
  ctx.executors.register(customerApi, executor);
  if (opts.declareGateway !== false) for (const r of [wallet, customerApi]) await api.put(`/api/v1/gateway/resources/${r}/enforcement`, admin, { mode: "gateway" });
  for (const a of [support, payment, analytics, database]) await api.post("/api/v1/agent-auth/credentials", admin, { agentId: a });
  const grant = (agentId: string, resourceId: string, action: string) => api.post("/api/v1/permissions", admin, { agentId, resourceId, action });
  await grant(payment, wallet, "transfer");
  await grant(payment, customerApi, "read");
  await grant(support, customerApi, "read");
  await grant(database, customerApi, "read");
  return { admin, op, approver, support, payment, analytics, database, wallet, customerApi, executor };
}
type N = Awaited<ReturnType<typeof network>>;
const signal = (n: N, over: Record<string, unknown> = {}) => orch().openFromSignal(n.admin.org, { title: "Support agent compromised", severity: "critical", source: "runtime_signal", reference: `sig-${randomUUID()}`, compromisedAgentIds: [n.support], ...over } as never);
const status = async (n: N, incidentId: string) => (await api.get(`${I}/${incidentId}`, n.op)).body.data.status;
const wfOf = async (n: N, wfId: string) => (await api.get(`/api/v1/workflows/${wfId}`, n.op)).body.data;
const approve = async (n: N, incidentId: string) => {
  const a = (await api.get(`/api/v1/approvals?incidentId=${incidentId}&status=pending`, n.op)).body.data[0];
  return api.post(`/api/v1/approvals/${a.id}/approve`, n.approver, { comment: "reviewed" });
};

describe("the full compromised Support Agent scenario", () => {
  it("runs from a trusted signal to verified, hash-sealed, anchored evidence, with a person approving the exact plan", async () => {
    const n = await network();
    // support is compromised: it delegates to payment, so payment is in its blast radius, and it uses the customer API
    const s = await signal(n);
    expect(s).toMatchObject({ incidentCreated: true, workflowCreated: true });
    expect(s.incident).toMatchObject({ detectionSource: "runtime_signal", createdByType: "system", status: "detected" });

    // 1. the automation analyses and requests approval, then stops: it never approves
    let wf = (await orch().runNow(n.admin.org, s.workflow.id))!;
    expect(wf).toMatchObject({ status: "waiting", step: "awaiting_approval", approvalRequested: true });
    expect(await status(n, s.incident.id)).toBe("awaiting_approval");
    const refs = (await api.get(`${I}/${s.incident.id}/analysis`, n.op)).body.data.map((r: any) => r.kind).sort();
    expect(refs).toEqual(["blast_radius", "containment_plan", "graph_snapshot"]);
    const pending = (await api.get(`/api/v1/approvals?incidentId=${s.incident.id}`, n.op)).body.data;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: "pending", requestedBy: expect.any(String) });
    // the plan honoured real enforcement coverage: the delegation edge cannot be enforced, so it was excluded from cuts
    const planRef = (await api.get(`${I}/${s.incident.id}/analysis?kind=containment_plan`, n.op)).body.data[0];
    expect(planRef.input.coverage.uncontrollableEdgeIds.length).toBeGreaterThan(0);
    expect(planRef.planStatus).toBe("feasible");
    // nothing has been enforced yet
    expect((await api.get(`/api/v1/enforcement?incidentId=${s.incident.id}`, n.admin)).body.pagination.total).toBe(0);
    // re-running while waiting does nothing new
    await orch().runNow(n.admin.org, s.workflow.id);
    expect((await api.get(`/api/v1/approvals?incidentId=${s.incident.id}`, n.op)).body.data).toHaveLength(1);

    // 2. a person approves; the workflow enforces, verifies, seals evidence and anchors it
    expect((await approve(n, s.incident.id)).body.data.status).toBe("approved");
    wf = (await orch().runNow(n.admin.org, s.workflow.id))!;
    expect(wf).toMatchObject({ status: "completed", outcome: "contained" });
    expect(await status(n, s.incident.id)).toBe("contained");

    // the malicious path is closed and the healthy path works, through the real gateway
    const tokens = Object.fromEntries(await Promise.all([n.support, n.payment, n.database].map(async (a) => {
      const c = (await api.post("/api/v1/agent-auth/rotate", n.admin, { agentId: a, reason: "test token" })).body.data.credential;
      return [a, (await ctx.app.inject({ method: "POST", url: "/api/v1/agent-auth/token", payload: { credential: c } })).json().data.token];
    })));
    const call = (a: string, resource: string, action: string) => ctx.app.inject({ method: "POST", url: "/api/v1/gateway/execute", headers: { authorization: `Bearer ${tokens[a]}` }, payload: { requestId: randomUUID(), resource, action } });
    expect((await call(n.support, n.customerApi, "read")).statusCode).toBe(403); // compromised agent contained
    expect((await call(n.database, n.customerApi, "read")).statusCode).toBe(200); // healthy agent unaffected

    // evidence: sealed, verified internally, anchored to Arkiv; Ethereum waits for confirmations
    const evidence = (await api.get(`${I}/${s.incident.id}/evidence`, n.op)).body.data;
    expect(evidence).toHaveLength(1);
    expect(wf.evidenceId).toBe(evidence[0].id);
    let ev = (await api.get(`/api/v1/evidence/${evidence[0].id}`, n.op)).body.data;
    expect(ev.status).toBe("anchor_pending");
    expect(ev.anchors.map((a: any) => `${a.target}:${a.status}`)).toEqual(["arkiv:confirmed", "ethereum:submitted"]);
    ctx.chain.mine(3);
    await orch().maintenance(); // the background poll confirms the transaction
    ev = (await api.get(`/api/v1/evidence/${evidence[0].id}`, n.op)).body.data;
    expect(ev.status).toBe("anchored");
    const verified = (await api.post(`/api/v1/evidence/${ev.id}/verify`, n.op, {})).body.data;
    expect(verified).toMatchObject({ valid: true, status: "verified" });
    expect(ev.content.approvals[0].decisions[0].decidedBy).toBe(n.approver.actor);
    expect(ev.content.verification[0].status).toBe("passed");
    expect(ev.content.enforcement.length).toBeGreaterThan(0);

    const events = (await api.get(`/api/v1/workflows/${wf.id}`, n.op)).body.data.events.map((e: any) => e.type);
    expect(events).toEqual(expect.arrayContaining(["started", "step", "evidence_generated", "completed"]));
  });
});

describe("duplicates, restarts and workers", () => {
  it("a repeated signal and concurrent workers produce one incident, one workflow and one of every effect", async () => {
    const n = await network();
    const ref = `dup-${randomUUID()}`;
    const [a, b] = await Promise.all([signal(n, { reference: ref }), signal(n, { reference: ref })]);
    expect(b.incident.id).toBe(a.incident.id);
    expect(b.workflow.id).toBe(a.workflow.id);
    expect([a, b].filter((x) => x.workflowCreated)).toHaveLength(1);

    await Promise.all(Array.from({ length: 5 }, () => orch().runNow(n.admin.org, a.workflow.id)));
    expect((await api.get(`/api/v1/approvals?incidentId=${a.incident.id}`, n.op)).body.data).toHaveLength(1);
    const kinds = (await api.get(`${I}/${a.incident.id}/analysis`, n.op)).body.data.map((r: any) => r.kind).sort();
    expect(kinds).toEqual(["blast_radius", "containment_plan", "graph_snapshot"]);
    expect(await status(n, a.incident.id)).toBe("awaiting_approval");
  });

  it("a worker that dies holding a lease is replaced once the lease expires, and does not double-work", async () => {
    const n = await network();
    const s = await signal(n);
    const now = new Date(Date.now() + ctx.clock.offsetMs);
    expect(await ctx.app.orchestrator.repo.claimOne(ctx.handle.db, n.admin.org, s.workflow.id, now, new Date(now.getTime() + 120_000))).not.toBeNull(); // "crashed" worker
    expect((await orch().runNow(n.admin.org, s.workflow.id))!.step).toBe("analysis"); // leased: nothing happens
    expect(await status(n, s.incident.id)).toBe("detected");
    ctx.clock.offsetMs = 3 * 60_000;
    try {
      expect((await orch().runNow(n.admin.org, s.workflow.id))!.status).toBe("waiting");
    } finally { ctx.clock.offsetMs = 0; }
    expect(await status(n, s.incident.id)).toBe("awaiting_approval");
  });

  it("a restart in the middle of enforcement continues without repeating work", async () => {
    const n = await network();
    const s = await signal(n);
    await orch().runNow(n.admin.org, s.workflow.id);
    await approve(n, s.incident.id);
    // the "previous worker" enforced the first action, moved the incident to containing, then died
    const plan = (await ctx.app.incidentManagement.reader.getCurrentPlanReference(n.admin.org, s.incident.id))!;
    const actions = (await ctx.app.incidentManagement.analysis.verify({ actorId: randomUUID(), organizationId: n.admin.org, role: "system" }, s.incident.id, plan.id)).result as { plan: { actions: Array<{ edgeId: string; kind: string; sourceNodeId: string; targetNodeId: string }> } };
    expect(actions.plan.actions.length).toBeGreaterThan(1);
    await ctx.app.incidentManagement.incidents.transition({ actorId: randomUUID(), organizationId: n.admin.org, role: "system" }, s.incident.id, { to: "containing", reason: "worker 1 started enforcing" });
    await ctx.app.gateway.enforcement.applyPlan({ actorId: randomUUID(), organizationId: n.admin.org, role: "system" }, { incidentId: s.incident.id, planHash: plan.planHash!, actions: actions.plan.actions.slice(0, 1), keyPrefix: `wf-${s.workflow.id}`, reason: "Enforcing the approved containment plan" });
    const wf = (await orch().runNow(n.admin.org, s.workflow.id))!;
    expect(wf).toMatchObject({ status: "completed", outcome: "contained" });
    const done = (await api.get(`/api/v1/enforcement?incidentId=${s.incident.id}&limit=100`, n.admin)).body.data;
    expect(done).toHaveLength(actions.plan.actions.length); // each action exactly once
    expect(done.every((a: any) => a.status === "executed")).toBe(true);
  });

  it("tick processes due workflows; the pg-boss ticker drives tick and maintenance", async () => {
    const n = await network();
    const s = await signal(n);
    expect((await orch().tick(50)).processed).toBeGreaterThanOrEqual(1);
    expect((await wfOf(n, s.workflow.id)).status).toBe("waiting");
    // waiting workflows are not picked up before their next run time
    expect((await ctx.app.orchestrator.repo.claimDue(ctx.handle.db, new Date(), new Date(Date.now() + 1000), 50)).some((w) => w.id === s.workflow.id)).toBe(false);

    let ticks = 0;
    const fake = { tick: async () => void ticks++, maintenance: async () => ({}) } as never;
    const ticker = new PgBossTicker(inject("dbUrl"), fake);
    await ticker.start();
    try {
      await ticker.nudge();
      const deadline = Date.now() + 20_000;
      while (ticks === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      expect(ticks).toBeGreaterThanOrEqual(1);
    } finally { await ticker.stop(); }
  }, 40_000);
});

describe("human decisions end the automation, they are not overridden", () => {
  it("a rejected approval stops the workflow; nothing is enforced", async () => {
    const n = await network();
    const s = await signal(n);
    await orch().runNow(n.admin.org, s.workflow.id);
    const a = (await api.get(`/api/v1/approvals?incidentId=${s.incident.id}&status=pending`, n.op)).body.data[0];
    await api.post(`/api/v1/approvals/${a.id}/reject`, n.approver, { comment: "support agent is needed for payroll" });
    const wf = (await orch().runNow(n.admin.org, s.workflow.id))!;
    expect(wf).toMatchObject({ status: "stopped", outcome: "approval_rejected" });
    expect(await status(n, s.incident.id)).toBe("rejected");
    expect((await api.get(`/api/v1/enforcement?incidentId=${s.incident.id}`, n.admin)).body.pagination.total).toBe(0);
    expect((await api.get(`${I}/${s.incident.id}/evidence`, n.op)).body.data).toEqual([]);
  });

  it("an approval that expires returns the incident to investigation and the workflow stops, without enforcing", async () => {
    const n = await network();
    const s = await signal(n);
    await orch().runNow(n.admin.org, s.workflow.id);
    ctx.clock.offsetMs = 61 * 60_000;
    try {
      await orch().runNow(n.admin.org, s.workflow.id); // maintenance expires the request
      expect(await status(n, s.incident.id)).toBe("investigating");
      expect(await orch().runNow(n.admin.org, s.workflow.id)).toMatchObject({ status: "stopped", outcome: "returned_to_investigation" });
    } finally { ctx.clock.offsetMs = 0; }
    expect((await api.get(`/api/v1/enforcement?incidentId=${s.incident.id}`, n.admin)).body.pagination.total).toBe(0);
  });

  it("a plan altered after approval is not enforced: the workflow blocks and nothing runs", async () => {
    const n = await network();
    const s = await signal(n);
    await orch().runNow(n.admin.org, s.workflow.id);
    await approve(n, s.incident.id);
    const snap = (await api.get(`${I}/${s.incident.id}/analysis?kind=graph_snapshot`, n.op)).body.data[0];
    await q("alter table graph_snapshots disable trigger graph_snapshots_append_only");
    try { await q("update graph_snapshots set payload = jsonb_set(payload, '{edges}', '[]'::jsonb) where id=$1", [snap.snapshotId]); } finally { await q("alter table graph_snapshots enable trigger graph_snapshots_append_only"); }
    const wf = (await orch().runNow(n.admin.org, s.workflow.id))!;
    expect(wf.status).toBe("blocked");
    expect(["plan_not_reproducible", "approval_no_longer_valid"]).toContain(wf.outcome);
    expect((await api.get(`/api/v1/enforcement?incidentId=${s.incident.id}`, n.admin)).body.pagination.total).toBe(0);
    expect(await status(n, s.incident.id)).not.toBe("contained");
  });

  it("cancelling a workflow stops it; a cancelled workflow does nothing more", async () => {
    const n = await network();
    const s = await signal(n);
    expect((await api.post(`/api/v1/workflows/${s.workflow.id}/cancel`, who("viewer", n.admin.org), { reason: "x" })).status).toBe(403);
    const c = await api.post(`/api/v1/workflows/${s.workflow.id}/cancel`, n.op, { reason: "handled manually" });
    expect(c.body.data).toMatchObject({ status: "cancelled", outcome: "cancelled_by_user" });
    expect((await orch().runNow(n.admin.org, s.workflow.id))!.status).toBe("cancelled");
    expect(await status(n, s.incident.id)).toBe("detected");
    expect((await api.post(`/api/v1/workflows/${s.workflow.id}/cancel`, n.op, { reason: "again" })).body.error.code).toBe("WORKFLOW_FINISHED");
  });
});

describe("containment that does not fully work is reported as such", () => {
  async function approved() {
    const n = await network();
    const s = await signal(n);
    await orch().runNow(n.admin.org, s.workflow.id);
    await approve(n, s.incident.id);
    return { n, s };
  }

  it("an enforcement adapter that fails leaves partial containment, never contained", async () => {
    const { n, s } = await approved();
    const adapter = ctx.app.gateway.adapters.find((a) => a.name === "permission")!;
    const real = adapter.apply.bind(adapter);
    let calls = 0;
    const spy = vi.spyOn(adapter, "apply").mockImplementation(async (c) => { if (++calls === 1) throw new Error("adapter unavailable"); return real(c); });
    let wf;
    try { wf = (await orch().runNow(n.admin.org, s.workflow.id))!; } finally { spy.mockRestore(); }
    const actions = (await api.get(`/api/v1/enforcement?incidentId=${s.incident.id}&limit=100`, n.admin)).body.data;
    expect(actions.filter((a: any) => a.status === "failed")).toHaveLength(1);
    expect(actions.filter((a: any) => a.status === "executed").length).toBe(actions.length - 1);
    expect(await status(n, s.incident.id)).toBe("partially_contained");
    expect(wf).toMatchObject({ status: "completed", outcome: "partially_contained" });
    const run = (await api.get(`${I}/${s.incident.id}/verification`, n.op)).body.data[0];
    expect(run.status).toBe("partially_verified");
    // evidence records the failure honestly
    const ev = (await api.get(`/api/v1/evidence/${wf.evidenceId}`, n.op)).body.data;
    expect(ev.content.enforcement.filter((a: any) => a.status === "failed")).toHaveLength(1);
    expect(ev.content.verification[0].status).toBe("partially_verified");
  });

  it("every adapter failing is containment_failed", async () => {
    const { n, s } = await approved();
    const adapter = ctx.app.gateway.adapters.find((a) => a.name === "permission")!;
    const spy = vi.spyOn(adapter, "apply").mockRejectedValue(new Error("adapter unavailable"));
    let wf;
    try { wf = (await orch().runNow(n.admin.org, s.workflow.id))!; } finally { spy.mockRestore(); }
    expect(await status(n, s.incident.id)).toBe("containment_failed");
    expect(wf).toMatchObject({ status: "completed", outcome: "containment_failed" });
  });

  it("a healthy workflow broken by containment, or a resource that is down, is not called contained", async () => {
    const { n, s } = await approved();
    n.executor.reachable = false;
    const wf = (await orch().runNow(n.admin.org, s.workflow.id))!;
    expect(await status(n, s.incident.id)).toBe("partially_contained");
    expect(wf.outcome).toBe("partially_contained");
  });

  it("an inconclusive verification is retried, then succeeds", async () => {
    const { n, s } = await approved();
    const real = ctx.app.incidentManagement.analysis.verify.bind(ctx.app.incidentManagement.analysis);
    // analysis.verify is called by: the orchestrator (1), the approval re-check before enforcing (2), then verification (3, and 4 on retry)
    let calls = 0;
    const spy = vi.spyOn(ctx.app.incidentManagement.analysis, "verify").mockImplementation(async (...a) => { if (++calls === 3) throw new Error("snapshot store unavailable"); return real(...a); });
    let wf;
    try { wf = (await orch().runNow(n.admin.org, s.workflow.id))!; } finally { spy.mockRestore(); }
    expect(wf).toMatchObject({ status: "completed", outcome: "contained", verificationAttempts: 2 });
    const runs = (await api.get(`${I}/${s.incident.id}/verification`, n.op)).body.data;
    expect(runs.map((r: any) => r.status).sort()).toEqual(["inconclusive", "passed"]);
  });

  it("verification that stays inconclusive blocks the workflow with the incident still verifying", async () => {
    const { n, s } = await approved();
    const real = ctx.app.incidentManagement.analysis.verify.bind(ctx.app.incidentManagement.analysis);
    let calls = 0;
    const spy = vi.spyOn(ctx.app.incidentManagement.analysis, "verify").mockImplementation(async (...a) => { if (++calls >= 3) throw new Error("down"); return real(...a); });
    let wf;
    try { wf = (await orch().runNow(n.admin.org, s.workflow.id))!; } finally { spy.mockRestore(); }
    expect(wf).toMatchObject({ status: "blocked", outcome: "verification_inconclusive" });
    expect(await status(n, s.incident.id)).toBe("verifying");
    expect((await api.get(`${I}/${s.incident.id}/evidence`, n.op)).body.data).toEqual([]); // no evidence of a containment that was not established
  });

  it("an interrupted verification run is closed as inconclusive by maintenance", async () => {
    const { n, s } = await approved();
    await ctx.app.incidentManagement.incidents.transition({ actorId: randomUUID(), organizationId: n.admin.org, role: "system" }, s.incident.id, { to: "containing", reason: "x" }).catch(() => undefined);
    const plan = (await ctx.app.incidentManagement.reader.getCurrentPlanReference(n.admin.org, s.incident.id))!;
    const approval = (await api.get(`/api/v1/approvals?incidentId=${s.incident.id}&status=approved`, n.op)).body.data[0];
    await q("insert into verification_runs (organization_id, incident_id, approval_id, plan_reference_id, plan_hash, snapshot_id, snapshot_hash, status, requested_by, requested_by_type, updated_at) values ($1,$2,$3,$4,$5,$6,$7,'running',$8,'system', now() - interval '1 hour')",
      [n.admin.org, s.incident.id, approval.id, plan.id, plan.planHash, plan.snapshotId, plan.snapshotHash, randomUUID()]);
    expect((await ctx.app.verification.verification.runMaintenance()).interrupted).toBeGreaterThanOrEqual(1);
    const runs = (await api.get(`${I}/${s.incident.id}/verification`, n.op)).body.data;
    expect(runs[0]).toMatchObject({ status: "inconclusive" });
    expect(runs[0].summary.error).toMatch(/interrupted/);
  });
});

describe("analysis that cannot lead to a safe plan", () => {
  it("no compromised agent: blocked", async () => {
    const n = await network();
    const s = await signal(n, { compromisedAgentIds: [] });
    expect(await orch().runNow(n.admin.org, s.workflow.id)).toMatchObject({ status: "blocked", outcome: "no_compromised_agents" });
    expect(await status(n, s.incident.id)).toBe("investigating");
  });
  it("resources whose protection nobody declared cannot be cut: the plan is infeasible and the workflow blocks", async () => {
    const n = await network({ declareGateway: false });
    const s = await signal(n);
    const wf = (await orch().runNow(n.admin.org, s.workflow.id))!;
    expect(wf).toMatchObject({ status: "blocked", outcome: "plan_infeasible" });
    expect(await status(n, s.incident.id)).toBe("investigating");
    expect((await api.get(`/api/v1/approvals?incidentId=${s.incident.id}`, n.op)).body.data).toEqual([]); // an infeasible plan is never put in front of an approver
  });
});

describe("failure handling of the workflow itself", () => {
  it("transient failures are retried with backoff, exhaust into a visible failure, and a person can retry", async () => {
    const n = await network();
    const s = await signal(n);
    const spy = vi.spyOn(ctx.app.gateway.gateway, "coverage").mockRejectedValue(new Error("database unavailable"));
    try {
      let wf = (await orch().runNow(n.admin.org, s.workflow.id))!;
      expect(wf).toMatchObject({ status: "running", attempts: 1 });
      expect(wf.lastError).toMatch(/database unavailable/);
      expect(new Date(wf.nextRunAt).getTime()).toBeGreaterThan(Date.now());
      for (let i = 0; i < 4; i++) wf = (await orch().runNow(n.admin.org, s.workflow.id))!;
      expect(wf).toMatchObject({ status: "failed", outcome: "retries_exhausted", attempts: 5 });
    } finally { spy.mockRestore(); }
    const events = (await wfOf(n, s.workflow.id)).events.map((e: any) => e.type);
    expect(events.filter((t: string) => t === "retry_scheduled")).toHaveLength(4);
    expect(events).toContain("failed");
    expect((await api.post(`/api/v1/workflows/${s.workflow.id}/retry`, who("viewer", n.admin.org), {})).status).toBe(403);
    expect((await api.post(`/api/v1/workflows/${s.workflow.id}/retry`, n.op, {})).body.data).toMatchObject({ status: "running", attempts: 0 });
    expect(await orch().runNow(n.admin.org, s.workflow.id)).toMatchObject({ status: "waiting", step: "awaiting_approval" });
    expect((await api.post(`/api/v1/workflows/${s.workflow.id}/retry`, n.op, {})).body.error.code).toBe("WORKFLOW_NOT_RETRYABLE");
  });
});

describe("tenancy, permissions and the audit trail", () => {
  it("another organization cannot see, start, retry, cancel or run a workflow", async () => {
    const n = await network();
    const other = who("admin");
    const s = await signal(n);
    expect((await api.get(`/api/v1/workflows/${s.workflow.id}`, other)).status).toBe(404);
    expect((await api.get(`${I}/${s.incident.id}/workflow`, other)).status).toBe(404);
    expect((await api.post(`/api/v1/workflows/${s.workflow.id}/cancel`, other, { reason: "x" })).status).toBe(404);
    expect((await api.post(`/api/v1/workflows/${s.workflow.id}/retry`, other, {})).status).toBe(404);
    expect((await api.post("/api/v1/workflows", other, { incidentId: s.incident.id })).body.error.code).toBe("INCIDENT_NOT_FOUND");
    expect((await orch().runNow(other.org, s.workflow.id))).toBeNull();
    expect(await status(n, s.incident.id)).toBe("detected");
  });

  it("people start workflows for existing incidents; roles are enforced; events are append-only", async () => {
    const n = await network();
    const inc = (await api.post(I, n.op, { title: "Manual", severity: "high", agents: [{ agentId: n.support, relationship: "compromised" }] })).body.data;
    expect((await api.post("/api/v1/workflows", who("viewer", n.admin.org), { incidentId: inc.id })).status).toBe(403);
    expect((await api.post("/api/v1/workflows", n.approver, { incidentId: inc.id })).status).toBe(403);
    const first = await api.post("/api/v1/workflows", n.op, { incidentId: inc.id });
    expect(first.status).toBe(201);
    const again = await api.post("/api/v1/workflows", n.op, { incidentId: inc.id });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect((await api.get(`/api/v1/workflows/${first.body.data.id}`, n.approver)).status).toBe(200);
    expect((await api.get(`${I}/${inc.id}/workflow`, who("viewer", n.admin.org))).body.data.startedByType).toBe("human");
    await expect(q("update workflow_events set type='x' where workflow_id=$1", [first.body.data.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from incident_workflows where id=$1", [first.body.data.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update incident_workflows set incident_id=$2 where id=$1", [first.body.data.id, randomUUID()])).rejects.toMatchObject({ code: expect.stringMatching(/^(23001|23503)$/) });
  });

  it("the automation never approves: every approval decision in a full run is by a person", async () => {
    const n = await network();
    const s = await signal(n);
    await orch().runNow(n.admin.org, s.workflow.id);
    await approve(n, s.incident.id);
    await orch().runNow(n.admin.org, s.workflow.id);
    const deciders = (await q("select d.decided_by, d.role from approval_decisions d join approval_requests r on r.id=d.approval_id where r.incident_id=$1", [s.incident.id])).rows;
    expect(deciders).toEqual([{ decided_by: n.approver.actor, role: "approver" }]);
    const states = (await q("select to_status, actor_type from incident_state_history where incident_id=$1 order by created_at", [s.incident.id])).rows;
    const approvedBy = states.find((x) => x.to_status === "approved")!;
    expect(approvedBy.actor_type).toBe("system"); // recorded by the Approval Service on behalf of the approver it recorded
  });
});
