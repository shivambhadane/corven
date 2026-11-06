import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { systemPrincipal } from "../src/auth/system.js";
import { SimulatedExecutor, type ResourceExecutor } from "../src/modules/authorization-gateway/index.js";
import { authority, createDep, mkAgent, mkResource, operational, resourceDep } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx, type Who } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const V = "/api/v1/verification";
const I = "/api/v1/incidents";
const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);
const adminP = (w: Who) => ({ actorId: w.actor, organizationId: w.org, role: "admin" as const });

/**
 * Acme, compromised payment agent, with real grants, credentials, executors and an approved plan.
 * `enforce`: which plan actions to apply before verification ("all", "first", "none").
 */
async function scenario(opts: { enforce?: "all" | "first" | "none"; mode?: "gateway" | "advisory" | "none"; probe?: boolean } = {}) {
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
  const executor: ResourceExecutor & { calls?: unknown[] } = opts.probe === false ? { name: "no-probe", simulated: true, execute: async () => ({ status: "executed" }) } : new SimulatedExecutor();
  ctx.executors.register(wallet, executor);
  ctx.executors.register(customerApi, executor);
  for (const r of [wallet, customerApi]) if ((opts.mode ?? "gateway") !== "none") await api.put(`/api/v1/gateway/resources/${r}/enforcement`, admin, { mode: opts.mode ?? "gateway" });
  for (const a of [support, payment, analytics, database]) await api.post("/api/v1/agent-auth/credentials", admin, { agentId: a });
  const grant = (agentId: string, resourceId: string, action: string) => api.post("/api/v1/permissions", admin, { agentId, resourceId, action });
  await grant(payment, wallet, "transfer");
  await grant(payment, customerApi, "read");
  await grant(support, customerApi, "read");
  await grant(database, customerApi, "read");

  const inc = (await api.post(I, op, { title: "Payment agent compromised", severity: "critical", agents: [{ agentId: payment, relationship: "compromised" }] })).body.data;
  await api.post(`${I}/${inc.id}/transition`, op, { to: "investigating", reason: "triage" });
  await api.post(`${I}/${inc.id}/graph-snapshot`, op, {});
  const plan = (await api.post(`${I}/${inc.id}/containment-plan`, op, { protectedNodeIds: [`resource:${wallet}`, `resource:${customerApi}`] })).body.data;
  await api.post(`${I}/${inc.id}/transition`, op, { to: "containment_planned", reason: "plan ready" });
  const approval = (await api.post("/api/v1/approvals", op, { incidentId: inc.id })).body.data;
  expect((await api.post(`/api/v1/approvals/${approval.id}/approve`, approver, {})).body.data.status).toBe("approved");
  const planHash = plan.reference.planHash as string;
  const actions = plan.result.plan.actions as Array<{ edgeId: string; kind: string; sourceNodeId: string; targetNodeId: string }>;
  expect(actions).toHaveLength(2); // payment->wallet and payment->customerApi; support and database keep their access
  const toApply = opts.enforce === "none" ? [] : opts.enforce === "first" ? actions.slice(0, 1) : actions;
  await ctx.app.incidentManagement.incidents.transition(systemPrincipal(admin.org, randomUUID()), inc.id, { to: "containing", reason: "enforcing the approved plan" });
  if (toApply.length) await ctx.app.gateway.enforcement.applyPlan(adminP(admin), { incidentId: inc.id, planHash, actions: toApply, keyPrefix: `p-${inc.id}`, reason: "enforce the approved plan" });
  return { admin, op, approver, support, payment, analytics, database, wallet, customerApi, inc, plan, planHash, actions, approval, executor };
}
type S = Awaited<ReturnType<typeof scenario>>;
const run = async (s: S, body: Record<string, unknown> = {}, w: Who = s.op) => api.post(`${V}/run`, w, { incidentId: s.inc.id, ...body });
const incStatus = async (s: S) => (await api.get(`${I}/${s.inc.id}`, s.op)).body.data.status;
const byCat = (checks: any[], cat: string) => checks.filter((c) => c.category === cat);

describe("full containment", () => {
  it("verifies the malicious paths are blocked and healthy paths still work, then marks the incident contained", async () => {
    const s = await scenario();
    const r = await run(s);
    expect(r.status).toBe(201);
    const v = r.body.data;
    expect(v).toMatchObject({ status: "passed", incidentOutcome: "contained", incidentSynced: true, attempt: 1, approvalId: s.approval.id, planHash: s.planHash, resultHashMatches: true });
    expect(v.resultHash).toMatch(/^[0-9a-f]{64}$/);

    const neg = byCat(v.checks, "NEGATIVE_ACCESS_TEST");
    expect(neg.map((c: any) => `${c.agentId === s.payment}:${c.action}:${c.result}`).sort()).toEqual(["true:read:passed", "true:transfer:passed"]);
    expect(neg.every((c: any) => c.actual.startsWith("denied:") && c.actual.includes("RESTRICTED_BY_CONTAINMENT"))).toBe(true);
    const pos = byCat(v.checks, "POSITIVE_ACCESS_TEST");
    expect(pos.map((c: any) => c.agentId).sort()).toEqual([s.support, s.database].sort());
    expect(pos.every((c: any) => c.result === "passed" && c.actual === "allow:reachable")).toBe(true);
    expect(byCat(v.checks, "PERMISSION_PERSISTENCE_TEST").map((c: any) => c.result)).toEqual(["passed", "passed"]);
    expect(byCat(v.checks, "PATH_BLOCK_TEST")[0]).toMatchObject({ result: "passed", actual: "unreachable" });
    expect(byCat(v.checks, "BYPASS_RESISTANCE_TEST").map((c: any) => c.result)).toEqual(["passed", "passed"]);
    // customer-api has healthy dependents and answered; the wallet is used only by the compromised agent, so it is reported as not checked
    expect(byCat(v.checks, "RESOURCE_HEALTH_TEST").map((c: any) => [c.resourceId, c.result])).toEqual([[s.customerApi, "passed"]]);
    expect(v.summary.notChecked).toEqual([`Resource ${s.wallet}: no healthy agent has access, so its availability was not checked`]);

    expect(await incStatus(s)).toBe("contained");
    const tl = (await api.get(`${I}/${s.inc.id}/timeline?limit=200`, s.op)).body.data;
    const transitions = tl.filter((e: any) => e.eventType === "incident.transitioned").map((e: any) => e.data.to);
    expect(transitions.slice(-2)).toEqual(["verifying", "contained"]);
    expect(tl.find((e: any) => e.eventType === "verification.result_received").data).toMatchObject({ runId: v.id, status: "passed", resultHash: v.resultHash });
    // verification never executes anything
    expect((s.executor as SimulatedExecutor).calls).toHaveLength(0);
    expect((s.executor as SimulatedExecutor).probes.length).toBeGreaterThan(0);
    expect((await api.get(`${I}/${s.inc.id}/verification`, who("viewer", s.admin.org))).body.data.map((x: any) => x.id)).toEqual([v.id]);
  });
});

describe("honest outcomes", () => {
  it("only part of the plan enforced: partial, never contained", async () => {
    const s = await scenario({ enforce: "first" });
    const v = (await run(s)).body.data;
    expect(v.status).toBe("partially_verified");
    expect(v.incidentOutcome).toBe("partially_contained");
    expect(byCat(v.checks, "NEGATIVE_ACCESS_TEST").some((c: any) => c.result === "failed" && c.actual.startsWith("allowed:"))).toBe(true);
    expect(byCat(v.checks, "PERMISSION_PERSISTENCE_TEST").some((c: any) => c.actual === "no_enforcement_action")).toBe(true);
    expect(byCat(v.checks, "PATH_BLOCK_TEST")[0].result).toBe("failed");
    expect(await incStatus(s)).toBe("partially_contained");
  });

  it("nothing enforced: failed, and the incident is containment_failed", async () => {
    const s = await scenario({ enforce: "none" });
    const v = (await run(s)).body.data;
    expect(v.status).toBe("failed");
    expect(await incStatus(s)).toBe("containment_failed");
    expect(byCat(v.checks, "NEGATIVE_ACCESS_TEST").every((c: any) => c.result === "failed")).toBe(true);
  });

  it("a healthy path broken by containment is reported, not hidden", async () => {
    const s = await scenario();
    const g = (await api.get(`/api/v1/permissions?agentId=${s.support}&status=active`, s.admin)).body.data[0];
    await api.post(`/api/v1/permissions/${g.id}/revoke`, s.admin, { reason: "collateral" });
    await api.post(`/api/v1/agents/${s.database}/status`, s.admin, { status: "suspended", reason: "collateral damage" });
    const v = (await run(s)).body.data;
    expect(v.status).toBe("partially_verified");
    const pos = byCat(v.checks, "POSITIVE_ACCESS_TEST");
    // support's grant is gone, so it is no longer derived; database is suspended: denied
    expect(pos.find((c: any) => c.agentId === s.database)).toMatchObject({ result: "failed", actual: "deny:not_attempted" });
    expect(await incStatus(s)).toBe("partially_contained");
  });

  it("an explicitly named healthy path that no longer works fails the run's continuity", async () => {
    const s = await scenario();
    const v = (await run(s, { healthyChecks: [{ agentId: s.support, resourceId: s.wallet, action: "read" }] })).body.data;
    expect(byCat(v.checks, "POSITIVE_ACCESS_TEST").find((c: any) => c.resourceId === s.wallet)).toMatchObject({ result: "failed", actual: "deny:not_attempted" });
    expect(v.status).toBe("partially_verified");
  });

  it("a re-grant after containment is caught even though the restriction still denies", async () => {
    const s = await scenario();
    await api.post("/api/v1/permissions", s.admin, { agentId: s.payment, resourceId: s.wallet, action: "transfer" });
    const v = (await run(s)).body.data;
    expect(byCat(v.checks, "NEGATIVE_ACCESS_TEST").every((c: any) => c.result === "passed")).toBe(true);
    expect(byCat(v.checks, "PERMISSION_PERSISTENCE_TEST").find((c: any) => c.resourceId === s.wallet)).toMatchObject({ result: "failed", actual: "grants_active" });
    expect(v.status).toBe("partially_verified");
  });

  it("resources not declared gateway-only cannot be called bypass-resistant", async () => {
    const s = await scenario({ mode: "advisory" });
    const v = (await run(s)).body.data;
    expect(byCat(v.checks, "BYPASS_RESISTANCE_TEST").every((c: any) => c.result === "inconclusive" && c.actual === "advisory")).toBe(true);
    expect(v.status).toBe("partially_verified");
    expect(v.summary.limitations.join(" ")).toMatch(/cannot test routes/);
  });

  it("without a resource probe, healthy operation is inconclusive, not assumed", async () => {
    const s = await scenario({ probe: false });
    const v = (await run(s)).body.data;
    expect(byCat(v.checks, "POSITIVE_ACCESS_TEST").every((c: any) => c.result === "inconclusive" && c.actual === "allow:no_probe")).toBe(true);
    expect(v.status).toBe("partially_verified");
  });

  it("a resource that is down fails health and continuity", async () => {
    const s = await scenario();
    (s.executor as SimulatedExecutor).reachable = false;
    const v = (await run(s)).body.data;
    expect(byCat(v.checks, "RESOURCE_HEALTH_TEST").every((c: any) => c.result === "failed")).toBe(true);
    expect(v.status).toBe("partially_verified");
  });
});

describe("inconclusive runs, retries and recovery", () => {
  it("a run that cannot observe anything is inconclusive, leaves the incident in verifying, and can be retried", async () => {
    const s = await scenario();
    const spy = vi.spyOn(ctx.app.incidentManagement.analysis, "verify").mockRejectedValueOnce(new Error("snapshot store unavailable"));
    let first: any;
    try {
      first = (await run(s)).body.data;
    } finally { spy.mockRestore(); }
    expect(first).toMatchObject({ status: "inconclusive", incidentOutcome: null, checks: [] });
    expect(first.summary.error).toMatch(/snapshot store unavailable/);
    expect(await incStatus(s)).toBe("verifying");

    const retry = await api.post(`${V}/${first.id}/retry`, s.op, {});
    expect(retry.status).toBe(201);
    expect(retry.body.data).toMatchObject({ status: "passed", attempt: 2, retryOf: first.id });
    expect(await incStatus(s)).toBe("contained");
    // retrying the same run again returns the same retry, and a final run cannot be re-rolled
    expect((await api.post(`${V}/${first.id}/retry`, s.op, {})).body.data.id).toBe(retry.body.data.id);
    expect((await api.post(`${V}/${retry.body.data.id}/retry`, s.op, {})).body.error.code).toBe("VERIFICATION_NOT_RETRYABLE");
  });

  it("retries are bounded", async () => {
    const s = await scenario();
    const spy = vi.spyOn(ctx.app.incidentManagement.analysis, "verify").mockRejectedValue(new Error("down"));
    try {
      let cur = (await run(s)).body.data;
      for (let i = 2; i <= 3; i++) {
        cur = (await api.post(`${V}/${cur.id}/retry`, s.op, {})).body.data;
        expect(cur).toMatchObject({ status: "inconclusive", attempt: i });
      }
      expect((await api.post(`${V}/${cur.id}/retry`, s.op, {})).body.error.code).toBe("RETRY_LIMIT_REACHED");
    } finally { spy.mockRestore(); }
  });

  it("a transient probe failure makes that check inconclusive, not passed", async () => {
    const s = await scenario();
    const spy = vi.spyOn(ctx.app.gateway.gateway, "probe").mockRejectedValueOnce(new Error("timeout"));
    let v: any;
    try {
      v = (await run(s)).body.data;
    } finally { spy.mockRestore(); }
    const bad = v.checks.find((c: any) => c.actual === "probe_error");
    expect(bad).toMatchObject({ result: "inconclusive", detail: { transient: true } });
    expect(v.status).toBe("partially_verified");
  });

  it("if the incident update fails after a run, the result is kept and the sweep finishes it", async () => {
    const s = await scenario();
    const real = ctx.app.incidentManagement.incidents.transition.bind(ctx.app.incidentManagement.incidents);
    const spy = vi.spyOn(ctx.app.incidentManagement.incidents, "transition").mockImplementation(async (p, id, input, meta) => {
      if (input.to === "contained") throw new Error("database blip");
      return real(p, id, input, meta);
    });
    let v: any;
    try {
      v = (await run(s)).body.data;
    } finally { spy.mockRestore(); }
    expect(v).toMatchObject({ status: "passed", incidentSynced: false });
    expect(await incStatus(s)).toBe("verifying");
    expect((await ctx.app.verification.verification.runMaintenance()).reconciled).toBeGreaterThanOrEqual(1);
    expect(await incStatus(s)).toBe("contained");
    await ctx.app.verification.verification.runMaintenance();
    const events = (await api.get(`${I}/${s.inc.id}/timeline?limit=200`, s.op)).body.data.filter((e: any) => e.eventType === "verification.result_received");
    expect(events).toHaveLength(1);
  });
});

describe("preconditions, permissions and tenancy", () => {
  it("only runs for an incident under containment with an approved plan", async () => {
    const op = who("operator");
    const inc = (await api.post(I, op, { title: "x", severity: "low" })).body.data;
    expect((await api.post(`${V}/run`, op, { incidentId: inc.id })).body.error.code).toBe("INCIDENT_NOT_VERIFIABLE");
    expect((await api.post(`${V}/run`, op, { incidentId: randomUUID() })).body.error.code).toBe("INCIDENT_NOT_FOUND");
    const s = await scenario();
    expect((await run(s, { healthyChecks: [{ agentId: randomUUID(), resourceId: s.wallet, action: "read" }] })).body.error.code).toBe("TARGET_NOT_FOUND");
    expect((await run(s, { status: "passed" })).status).toBe(400);
  });

  it("one active run per incident; an idempotency key returns the same run", async () => {
    const s = await scenario();
    await q("insert into verification_runs (organization_id, incident_id, plan_reference_id, plan_hash, snapshot_id, snapshot_hash, status, requested_by, requested_by_type) values ($1,$2,$3,$4,$5,$6,'running',$7,'human')",
      [s.admin.org, s.inc.id, s.plan.reference.id, s.planHash, s.plan.reference.snapshotId, s.plan.reference.snapshotHash, s.op.actor]);
    expect((await run(s)).body.error.code).toBe("VERIFICATION_IN_PROGRESS");

    const t = await scenario();
    const a = (await run(t, { idempotencyKey: "verify-1" })).body.data;
    const b = (await run(t, { idempotencyKey: "verify-1" })).body.data;
    expect(b.id).toBe(a.id);
  });

  it("viewers and approvers read; only operators, admins and the system run", async () => {
    const s = await scenario();
    for (const w of [who("viewer", s.admin.org), s.approver]) expect((await run(s, {}, w)).status).toBe(403);
    const v = (await run(s)).body.data;
    for (const w of [who("viewer", s.admin.org), s.approver]) expect((await api.get(`${V}/${v.id}`, w)).status).toBe(200);
  });

  it("another organization sees nothing", async () => {
    const s = await scenario();
    const v = (await run(s)).body.data;
    const other = who("admin");
    expect((await api.get(`${V}/${v.id}`, other)).status).toBe(404);
    expect((await api.post(`${V}/${v.id}/retry`, other, {})).status).toBe(404);
    expect((await api.get(`${I}/${s.inc.id}/verification`, other)).status).toBe(404);
    expect((await api.post(`${V}/run`, other, { incidentId: s.inc.id })).status).toBe(404);
  });
});

describe("verification evidence integrity", () => {
  it("checks are append-only, a completed run is final, and tampering is detected by the result hash", async () => {
    const s = await scenario();
    const v = (await run(s)).body.data;
    await expect(q("update verification_checks set result='passed' where run_id=$1", [v.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from verification_checks where run_id=$1", [v.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update verification_runs set status='failed' where id=$1", [v.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update verification_runs set result_hash=$2 where id=$1", [v.id, "0".repeat(64)])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from verification_runs where id=$1", [v.id])).rejects.toMatchObject({ code: "23001" });
    await q("alter table verification_checks disable trigger verification_checks_append_only");
    try {
      await q("update verification_checks set result='passed', actual='denied:forged' where run_id=$1 and category='POSITIVE_ACCESS_TEST'", [v.id]);
    } finally {
      await q("alter table verification_checks enable trigger verification_checks_append_only");
    }
    expect((await api.get(`${V}/${v.id}`, s.op)).body.data.resultHashMatches).toBe(false);
  });
});
