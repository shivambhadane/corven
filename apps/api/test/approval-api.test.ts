import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDep, mkAgent, mkResource, authority, operational, resourceDep } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx, type Who } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const A = "/api/v1/approvals";
const I = "/api/v1/incidents";
const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);
const svc = () => ctx.app.approvals.approvals;

/** An Acme incident in containment_planned with a feasible plan for the compromised payment agent. */
async function planned(opts: { elevated?: boolean } = {}) {
  const admin = who("admin");
  const op = who("operator", admin.org);
  const approver = who("approver", admin.org);
  const approver2 = who("approver", admin.org);
  const [support, payment, analytics] = [await mkAgent(api, admin), await mkAgent(api, admin), await mkAgent(api, admin)];
  const wallet = await mkResource(api, admin);
  const customerApi = await mkResource(api, admin);
  await createDep(api, admin, authority(support, payment));
  await createDep(api, admin, resourceDep(payment, wallet));
  const pc = await createDep(api, admin, resourceDep(payment, customerApi));
  await createDep(api, admin, operational(payment, analytics));
  const inc = (await api.post(I, op, { title: "Payment agent compromised", severity: "critical", agents: [{ agentId: payment, relationship: "compromised" }] })).body.data;
  await api.post(`${I}/${inc.id}/transition`, op, { to: "investigating", reason: "triage" });
  await api.post(`${I}/${inc.id}/graph-snapshot`, op, {});
  const body = { protectedNodeIds: [`resource:${wallet}`, `resource:${customerApi}`], ...(opts.elevated ? { options: { costApprovalThreshold: 1 } } : {}) };
  const plan = (await api.post(`${I}/${inc.id}/containment-plan`, op, body)).body.data;
  expect((await api.post(`${I}/${inc.id}/transition`, op, { to: "containment_planned", reason: "plan ready" })).status).toBe(200);
  return { admin, op, approver, approver2, support, payment, wallet, customerApi, pc, inc, plan, planHash: plan.reference.planHash as string };
}
type T = Awaited<ReturnType<typeof planned>>;
const request = async (t: T, w: Who = t.op) => {
  const r = await api.post(A, w, { incidentId: t.inc.id, comment: "please review" });
  if (r.status !== 201) throw new Error(r.raw);
  return r.body.data;
};
const incStatus = async (t: T) => (await api.get(`${I}/${t.inc.id}`, t.op)).body.data.status;
const timeline = async (t: T) => (await api.get(`${I}/${t.inc.id}/timeline?limit=200`, t.op)).body.data as any[];

describe("requesting approval", () => {
  it("binds the request to the exact current plan and moves the incident to awaiting_approval", async () => {
    const t = await planned();
    const a = await request(t);
    expect(a).toMatchObject({
      status: "pending", incidentId: t.inc.id, planReferenceId: t.plan.reference.id, planVersion: 1, planHash: t.planHash, snapshotHash: t.plan.reference.snapshotHash,
      resultHash: t.plan.reference.resultHash, schemaVersion: 1, risk: "standard", requiredApprovals: 1, requestedBy: t.op.actor, approvalsReceived: 0, approvalsRemaining: 1,
      policy: { requiredApprovals: 1, separationOfDuties: true, expiryMinutes: 60 },
    });
    expect(a.approvalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(a.expiresAt).getTime() - new Date(a.createdAt).getTime()).toBeGreaterThan(59 * 60_000);
    expect(await incStatus(t)).toBe("awaiting_approval");
    const req = (await timeline(t)).find((e) => e.eventType === "approval.requested");
    expect(req.data.planHash).toBe(t.planHash);
    expect((await api.get(`${A}/${a.id}/history`, t.op)).body.data.map((h: any) => h.action)).toEqual(["approval.requested"]);
  });

  it("refuses when the incident is not ready, already pending, or the caller may not request", async () => {
    const t = await planned();
    expect((await api.post(A, t.approver, { incidentId: t.inc.id })).status).toBe(403); // approvers decide, they do not request
    expect((await api.post(A, who("viewer", t.admin.org), { incidentId: t.inc.id })).status).toBe(403);
    await request(t);
    const again = await api.post(A, t.op, { incidentId: t.inc.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INCIDENT_NOT_READY"); // it is now awaiting_approval
    expect((await api.post(A, t.op, { incidentId: randomUUID() })).body.error.code).toBe("INCIDENT_NOT_FOUND");
    const early = (await api.post(I, t.op, { title: "x", severity: "low" })).body.data;
    expect((await api.post(A, t.op, { incidentId: early.id })).body.error.code).toBe("INCIDENT_NOT_READY");
    expect((await api.post(A, t.op, { incidentId: t.inc.id, planHash: t.planHash })).status).toBe(400); // the plan is never taken from the body
  });

  it("refuses a plan that cannot be recomputed from its pinned snapshot", async () => {
    const t = await planned();
    await tamperSnapshot(t.plan.reference.snapshotId);
    const r = await api.post(A, t.op, { incidentId: t.inc.id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PLAN_INTEGRITY_FAILED");
    expect(await incStatus(t)).toBe("containment_planned");
  });

  it("elevated-risk plans need the elevated number of approvals", async () => {
    const t = await planned({ elevated: true });
    const a = await request(t);
    expect(a).toMatchObject({ risk: "elevated", requiredApprovals: 2 });
    expect(a.riskReasons).toContain("cost_threshold");
  });
});

describe("deciding", () => {
  it("an authorized approver approves; the incident is approved through the system with the approval recorded", async () => {
    const t = await planned();
    const a = await request(t);
    const r = await api.post(`${A}/${a.id}/approve`, t.approver, { comment: "matches the blast radius" });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: "approved", approvalsReceived: 1, approvalsRemaining: 0, incidentSynced: true });
    expect(r.body.data.decisions).toEqual([expect.objectContaining({ decision: "approve", decidedBy: t.approver.actor, role: "approver", planHash: t.planHash, approvalDigest: a.approvalDigest, comment: "matches the blast radius" })]);
    expect(new Date(r.body.data.executableUntil).getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect(await incStatus(t)).toBe("approved");
    const tl = await timeline(t);
    const tr = tl.filter((e) => e.eventType === "incident.transitioned").pop();
    expect(tr).toMatchObject({ actorType: "system", data: { from: "awaiting_approval", to: "approved", context: { approvalId: a.id, planHash: t.planHash, approvalDigest: a.approvalDigest } } });
    expect(tl.find((e) => e.eventType === "approval.granted").data.deciders).toEqual([{ by: t.approver.actor, decision: "approve" }]);
    // a decision is final
    expect((await api.post(`${A}/${a.id}/approve`, t.approver2, {})).body.error.code).toBe("APPROVAL_NOT_PENDING");
    expect((await api.post(`${A}/${a.id}/reject`, t.approver2, { comment: "late" })).body.error.code).toBe("APPROVAL_NOT_PENDING");
  });

  it("viewers and operators can never approve; the backend checks, not the client", async () => {
    const t = await planned();
    const a = await request(t);
    for (const w of [who("viewer", t.admin.org), t.op, who("operator", t.admin.org)]) {
      const r = await api.post(`${A}/${a.id}/approve`, w, {});
      expect(r.status).toBe(403);
    }
    expect((await api.post(`${A}/${a.id}/approve`, t.approver, { decidedBy: t.admin.actor })).status).toBe(400);
    expect((await api.get(`${A}/${a.id}`, t.op)).body.data.status).toBe("pending");
  });

  it("separation of duties: a requester cannot approve their own request unless the policy allows it", async () => {
    const t = await planned();
    const a = await request(t, t.admin);
    const self = await api.post(`${A}/${a.id}/approve`, t.admin, {});
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("SEPARATION_OF_DUTIES");
    expect((await api.post(`${A}/${a.id}/approve`, t.approver, {})).body.data.status).toBe("approved");

    const u = await planned();
    await api.put("/api/v1/approval-policy", u.admin, { requiredApprovals: 1, elevatedRequiredApprovals: 1, separationOfDuties: false, expiryMinutes: 60, executionWindowMinutes: 60 });
    const b = await request(u, u.admin);
    expect(b.policy.separationOfDuties).toBe(false);
    expect((await api.post(`${A}/${b.id}/approve`, u.admin, {})).body.data.status).toBe("approved");
  });

  it("multiple approvers: each counts once, and the last required approval completes it", async () => {
    const t = await planned();
    await api.put("/api/v1/approval-policy", t.admin, { requiredApprovals: 2, elevatedRequiredApprovals: 3, separationOfDuties: true, expiryMinutes: 60, executionWindowMinutes: 60 });
    const a = await request(t);
    expect(a.requiredApprovals).toBe(2);
    expect((await api.post(`${A}/${a.id}/approve`, t.approver, {})).body.data).toMatchObject({ status: "pending", approvalsReceived: 1, approvalsRemaining: 1 });
    expect(await incStatus(t)).toBe("awaiting_approval");
    const twice = await api.post(`${A}/${a.id}/approve`, t.approver, {});
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("ALREADY_DECIDED");
    expect((await api.post(`${A}/${a.id}/approve`, t.approver2, {})).body.data).toMatchObject({ status: "approved", approvalsReceived: 2 });
    expect(await incStatus(t)).toBe("approved");
  });

  it("a rejection needs a comment and ends the request; the incident is rejected", async () => {
    const t = await planned();
    const a = await request(t);
    expect((await api.post(`${A}/${a.id}/reject`, t.approver, {})).status).toBe(400);
    const r = await api.post(`${A}/${a.id}/reject`, t.approver, { comment: "would cut the healthy support path" });
    expect(r.body.data).toMatchObject({ status: "rejected", closedReason: "would cut the healthy support path" });
    expect(await incStatus(t)).toBe("rejected");
    expect((await timeline(t)).some((e) => e.eventType === "approval.rejected")).toBe(true);
    // a rejected plan cannot be enforced
    const e = await api.post("/api/v1/enforcement/apply", t.admin, { kind: "revoke_resource_access", agentId: t.payment, resourceId: t.wallet, incidentId: t.inc.id, planHash: t.planHash, reason: "enforce the plan" });
    expect(e.status).toBe(403);
  });

  it("concurrent final approvals: exactly one decides", async () => {
    const t = await planned();
    const a = await request(t);
    const extra = Array.from({ length: 4 }, () => who("approver", t.admin.org));
    const rs = await Promise.all([t.approver, t.approver2, ...extra].map((w) => api.post(`${A}/${a.id}/approve`, w, {})));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).every((r) => r.body.error.code === "APPROVAL_NOT_PENDING")).toBe(true);
    expect((await q("select count(*)::int n from approval_decisions where approval_id=$1", [a.id])).rows[0].n).toBe(1);
    expect((await q("select count(*)::int n from incident_state_history where incident_id=$1 and to_status='approved'", [t.inc.id])).rows[0].n).toBe(1);
  });
});

describe("expiry, cancellation and invalidation", () => {
  it("a pending request expires; a late decision is refused and the incident returns to investigating", async () => {
    const t = await planned();
    const a = await request(t);
    ctx.clock.offsetMs = 61 * 60_000;
    try {
      const r = await api.post(`${A}/${a.id}/approve`, t.approver, {});
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("APPROVAL_EXPIRED");
    } finally { ctx.clock.offsetMs = 0; }
    expect((await api.get(`${A}/${a.id}`, t.op)).body.data.status).toBe("expired");
    expect(await incStatus(t)).toBe("investigating");
    expect((await timeline(t)).some((e) => e.eventType === "approval.expired")).toBe(true);
  });

  it("the maintenance sweep expires overdue requests without anyone touching them", async () => {
    const t = await planned();
    const a = await request(t);
    ctx.clock.offsetMs = 61 * 60_000;
    try {
      const r = await svc().runMaintenance();
      expect(r.expired).toBeGreaterThanOrEqual(1);
      expect((await svc().runMaintenance()).expired).toBe(0); // idempotent
    } finally { ctx.clock.offsetMs = 0; }
    expect((await q("select status, incident_synced from approval_requests where id=$1", [a.id])).rows[0]).toEqual({ status: "expired", incident_synced: true });
    expect(await incStatus(t)).toBe("investigating");
  });

  it("the requester or an administrator can cancel; others cannot", async () => {
    const t = await planned();
    const a = await request(t);
    expect((await api.post(`${A}/${a.id}/cancel`, who("operator", t.admin.org), { reason: "not mine" })).status).toBe(403);
    expect((await api.post(`${A}/${a.id}/cancel`, t.approver, { reason: "x" })).status).toBe(403);
    const r = await api.post(`${A}/${a.id}/cancel`, t.op, { reason: "plan needs another look" });
    expect(r.body.data).toMatchObject({ status: "cancelled", closedReason: "plan needs another look" });
    expect(await incStatus(t)).toBe("investigating");
    expect((await api.post(`${A}/${a.id}/cancel`, t.admin, { reason: "again" })).body.error.code).toBe("APPROVAL_NOT_PENDING");
  });

  it("a plan whose snapshot changed after the request is invalidated at approval time, not approved", async () => {
    const t = await planned();
    const a = await request(t);
    await tamperSnapshot(t.plan.reference.snapshotId);
    const r = await api.post(`${A}/${a.id}/approve`, t.approver, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("APPROVAL_INVALIDATED");
    expect((await api.get(`${A}/${a.id}`, t.op)).body.data).toMatchObject({ status: "invalidated", decisions: [] });
    expect(await incStatus(t)).toBe("investigating");
  });

  it("if the incident is withdrawn while approval is pending, a later approval is invalidated and cannot be used", async () => {
    const t = await planned();
    const a = await request(t);
    await api.post(`${I}/${t.inc.id}/transition`, t.op, { to: "investigating", reason: "new evidence" });
    const r = await api.post(`${A}/${a.id}/approve`, t.approver, {});
    // The plan reference is still current, so the decision is recorded, but the incident no longer waits for it:
    // reconciliation invalidates the approval instead of approving an incident that is back in investigation.
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: "invalidated", decisions: [expect.objectContaining({ decidedBy: t.approver.actor })] });
    expect(r.body.data.closedReason).toMatch(/left awaiting_approval \(investigating\)/);
    expect(await svc().isPlanApproved(t.admin.org, t.inc.id, t.planHash)).toBe(false);
    expect(await incStatus(t)).toBe("investigating");
  });
});

describe("the gateway relies on the approval", () => {
  it("enforcement of the approved plan succeeds through the real Approval Service, and stops when the execution window closes", async () => {
    const t = await planned();
    const a = await request(t);
    const body = { kind: "revoke_resource_access", agentId: t.payment, resourceId: t.wallet, incidentId: t.inc.id, planHash: t.planHash, reason: "enforce the approved plan" };
    expect((await api.post("/api/v1/enforcement/apply", t.admin, body)).body.error.code).toBe("APPROVAL_REQUIRED"); // pending is not approved
    await api.post(`${A}/${a.id}/approve`, t.approver, {});
    expect(await svc().isPlanApproved(t.admin.org, t.inc.id, t.planHash)).toBe(true);
    expect(await svc().isPlanApproved(t.admin.org, t.inc.id, "0".repeat(64))).toBe(false);
    expect(await svc().isPlanApproved(who("admin").org, t.inc.id, t.planHash)).toBe(false); // another organization
    const ok = await api.post("/api/v1/enforcement/apply", t.admin, body);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ status: "executed", approvalBasis: "plan_approval", approvalRef: `plan:${t.planHash}` });

    ctx.clock.offsetMs = 61 * 60_000;
    try {
      expect(await svc().isPlanApproved(t.admin.org, t.inc.id, t.planHash)).toBe(false);
      const late = await api.post("/api/v1/enforcement/apply", t.admin, { ...body, resourceId: t.customerApi });
      expect(late.body.error.code).toBe("APPROVAL_REQUIRED");
    } finally { ctx.clock.offsetMs = 0; }
  });

  it("an approved plan whose snapshot is altered afterwards is invalidated when the gateway asks", async () => {
    const t = await planned();
    const a = await request(t);
    await api.post(`${A}/${a.id}/approve`, t.approver, {});
    await tamperSnapshot(t.plan.reference.snapshotId);
    expect(await svc().isPlanApproved(t.admin.org, t.inc.id, t.planHash)).toBe(false);
    expect((await api.get(`${A}/${a.id}`, t.op)).body.data).toMatchObject({ status: "invalidated" });
    expect(await incStatus(t)).toBe("investigating");
    expect((await timeline(t)).some((e) => e.eventType === "approval.invalidated")).toBe(true);
  });
});

describe("recovery after a failed incident update", () => {
  it("a decision whose incident update fails stays recorded and is completed by the sweep", async () => {
    const t = await planned();
    const a = await request(t);
    const spy = vi.spyOn(ctx.app.incidentManagement.incidents, "transition").mockRejectedValueOnce(new Error("database blip"));
    try {
      expect((await api.post(`${A}/${a.id}/approve`, t.approver, {})).body.data).toMatchObject({ status: "approved", incidentSynced: false });
    } finally { spy.mockRestore(); }
    expect(await incStatus(t)).toBe("awaiting_approval");
    const r = await svc().runMaintenance();
    expect(r.reconciled).toBeGreaterThanOrEqual(1);
    expect(await incStatus(t)).toBe("approved");
    expect((await q("select incident_synced from approval_requests where id=$1", [a.id])).rows[0].incident_synced).toBe(true);
    // replaying reconciliation writes nothing twice
    await svc().runMaintenance();
    expect((await timeline(t)).filter((e) => e.eventType === "approval.granted")).toHaveLength(1);
  });
});

describe("policy", () => {
  it("returns the conservative default until an administrator sets one", async () => {
    const admin = who("admin");
    expect((await api.get("/api/v1/approval-policy", who("viewer", admin.org))).body.data).toMatchObject({ requiredApprovals: 1, elevatedRequiredApprovals: 2, separationOfDuties: true, isDefault: true });
    const body = { requiredApprovals: 2, elevatedRequiredApprovals: 3, separationOfDuties: true, expiryMinutes: 30, executionWindowMinutes: 15 };
    expect((await api.put("/api/v1/approval-policy", who("operator", admin.org), body)).status).toBe(403);
    expect((await api.put("/api/v1/approval-policy", who("approver", admin.org), body)).status).toBe(403);
    expect((await api.put("/api/v1/approval-policy", admin, body)).body.data).toMatchObject({ ...body, isDefault: false });
    expect((await api.put("/api/v1/approval-policy", admin, { ...body, elevatedRequiredApprovals: 1 })).status).toBe(400);
    expect((await api.put("/api/v1/approval-policy", admin, { ...body, requiredApprovals: 9 })).status).toBe(400);
    expect((await api.get("/api/v1/approval-policy", who("viewer", who("admin").org))).body.data.isDefault).toBe(true); // other organizations unaffected
  });

  it("a request keeps the policy it was created under", async () => {
    const t = await planned();
    const a = await request(t);
    await api.put("/api/v1/approval-policy", t.admin, { requiredApprovals: 3, elevatedRequiredApprovals: 3, separationOfDuties: true, expiryMinutes: 30, executionWindowMinutes: 15 });
    expect((await api.post(`${A}/${a.id}/approve`, t.approver, {})).body.data.status).toBe("approved");
  });
});

describe("tenant isolation and integrity of the record", () => {
  it("another organization cannot see, decide, cancel or list approvals", async () => {
    const t = await planned();
    const a = await request(t);
    const other = who("admin");
    const otherApprover = who("approver", other.org);
    expect((await api.get(`${A}/${a.id}`, other)).status).toBe(404);
    expect((await api.get(`${A}/${a.id}/history`, other)).status).toBe(404);
    expect((await api.post(`${A}/${a.id}/approve`, otherApprover, {})).status).toBe(404);
    expect((await api.post(`${A}/${a.id}/cancel`, other, { reason: "x" })).status).toBe(404);
    expect((await api.get(A, other)).body.pagination.total).toBe(0);
    expect((await api.post(A, other, { incidentId: t.inc.id })).body.error.code).toBe("INCIDENT_NOT_FOUND");
    expect((await api.get(`${A}/${a.id}`, t.op)).body.data.status).toBe("pending");
  });

  it("lists by status and incident", async () => {
    const t = await planned();
    const a = await request(t);
    expect((await api.get(`${A}?status=pending&incidentId=${t.inc.id}`, t.op)).body.data.map((x: any) => x.id)).toEqual([a.id]);
    expect((await api.get(`${A}?status=approved&incidentId=${t.inc.id}`, t.op)).body.data).toEqual([]);
    expect((await api.get(`${A}?status=bogus`, t.op)).status).toBe(400);
  });

  it("decisions and audit are append-only; the plan binding can never change; a decided request cannot be reopened", async () => {
    const t = await planned();
    const a = await request(t);
    await api.post(`${A}/${a.id}/approve`, t.approver, { comment: "ok" });
    await expect(q("update approval_decisions set decision='reject' where approval_id=$1", [a.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from approval_decisions where approval_id=$1", [a.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update approval_audit_logs set action='x' where approval_id=$1", [a.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update approval_requests set plan_hash=$2 where id=$1", [a.id, "0".repeat(64)])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update approval_requests set approval_digest=$2 where id=$1", [a.id, "0".repeat(64)])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update approval_requests set status='pending' where id=$1", [a.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from approval_requests where id=$1", [a.id])).rejects.toMatchObject({ code: "23001" });
    const hist = (await api.get(`${A}/${a.id}/history`, t.op)).body.data;
    expect(hist.map((h: any) => h.action)).toEqual(["approval.requested", "approval.decision_recorded", "approval.approved"]);
    expect(hist[1]).toMatchObject({ actorId: t.approver.actor, after: { decision: "approve", planHash: t.planHash, comment: "ok" } });
  });
});

/** Changes a stored snapshot behind the triggers, as a privileged attacker could. */
async function tamperSnapshot(snapshotId: string) {
  await q("alter table graph_snapshots disable trigger graph_snapshots_append_only");
  try {
    await q("update graph_snapshots set payload = jsonb_set(payload, '{edges}', '[]'::jsonb) where id=$1", [snapshotId]);
  } finally {
    await q("alter table graph_snapshots enable trigger graph_snapshots_append_only");
  }
}
