import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { APPROVAL_ACTOR_ID, systemPrincipal } from "../../../auth/system.js";
import type { Database } from "../../../db/client.js";
import { AppError, ValidationError } from "../../../errors.js";
import type { IncidentReader } from "../../incident-management/readers/incident.reader.js";
import type { IncidentAnalysisService } from "../../incident-management/services/analysis.service.js";
import type { IncidentService } from "../../incident-management/services/incident.service.js";
import type { AnalysisReference } from "../../incident-management/types.js";
import { approvalDigest, assessRisk, DEFAULT_POLICY, requiredFor, validatePolicy } from "../core/binding.js";
import {
  alreadyDecided, approvalExpired, approvalInvalidated, approvalNotFound, approvalPending, incidentNotFound, incidentNotReady, notPending, notRequester,
  planIntegrityFailed, planNotFeasible, planRequired, separationOfDuties,
} from "../errors.js";
import type { ApprovalRepository, ApprovalRow } from "../repositories/approval.repository.js";
import { APPROVAL_SCHEMA_VERSION, type ApprovalPolicy, type ApprovalStatus, type RequestMeta } from "../types.js";

const actorType = (p: Principal) => (p.role === "system" ? "system" : "human") as "human" | "system";
const minutes = (n: number) => n * 60_000;

type Integrity = { ok: true; resultHash: string } | { ok: false; reason: string };

/**
 * Human approval of one exact containment plan.
 *
 * - A request is bound to the incident's current plan reference by an approval
 *   digest (schema-versioned canonical hash of plan hash, snapshot hash and
 *   result hash). The plan is recomputed from its pinned snapshot when the
 *   request is made, at every approval, and again when the gateway asks whether
 *   it may execute. Any difference invalidates the approval.
 * - Policy: required approvals (more for elevated-risk plans), separation of
 *   duties, expiry of pending requests, and an execution window after approval.
 * - The incident lifecycle and timeline are updated after each final decision,
 *   idempotently, and retried by `reconcile` if that step fails.
 */
export class ApprovalService {
  constructor(
    private readonly db: Database,
    private readonly repo: ApprovalRepository,
    private readonly incidents: IncidentService,
    private readonly reader: IncidentReader,
    private readonly analysis: IncidentAnalysisService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ------------------------------------------------------------------ policy

  async getPolicy(p: Principal): Promise<ApprovalPolicy & { isDefault: boolean }> {
    assertCan(p, "approval:read");
    const row = await this.repo.getPolicy(this.db, p.organizationId);
    return row ? { ...pick(row), isDefault: false } : { ...DEFAULT_POLICY, isDefault: true };
  }

  async setPolicy(p: Principal, policy: ApprovalPolicy, meta: RequestMeta = {}) {
    assertCan(p, "approval:policy");
    const err = validatePolicy(policy);
    if (err) throw new ValidationError(err);
    return this.db.transaction(async (tx) => {
      const before = await this.repo.getPolicy(tx, p.organizationId);
      const row = await this.repo.upsertPolicy(tx, p.organizationId, policy, p.actorId);
      await this.repo.addAudit(tx, { organizationId: p.organizationId, actorId: p.actorId, actorType: actorType(p), action: "approval.policy_changed", beforeState: before ? pick(before) : null, afterState: policy as never, correlationId: meta.correlationId ?? null });
      return { ...pick(row), isDefault: false };
    });
  }

  // ------------------------------------------------------------------ request

  async request(p: Principal, input: { incidentId: string; comment?: string | undefined }, meta: RequestMeta = {}): Promise<ApprovalRow> {
    assertCan(p, "approval:request");
    const org = p.organizationId;
    const incident = await this.reader.getIncident(org, input.incidentId);
    if (!incident) throw incidentNotFound();
    if (incident.status !== "containment_planned") throw incidentNotReady(incident.status);
    const plan = await this.reader.getCurrentPlanReference(org, input.incidentId);
    if (!plan || !plan.planHash) throw planRequired();
    if (plan.planStatus !== "feasible") throw planNotFeasible(plan.planStatus);
    const integrity = await this.integrity(org, input.incidentId, plan);
    if (!integrity.ok) throw planIntegrityFailed(integrity.reason);

    const policy = await this.policyFor(org);
    const { risk, reasons } = assessRisk(plan.summary);
    const required = requiredFor(policy, risk);
    const binding = { organizationId: org, incidentId: input.incidentId, planReferenceId: plan.id, planVersion: plan.version, planHash: plan.planHash, snapshotHash: plan.snapshotHash, resultHash: integrity.resultHash };
    const now = this.now();

    const approval = await this.db.transaction(async (tx) => {
      const row = await this.repo.insert(tx, {
        ...binding, schemaVersion: APPROVAL_SCHEMA_VERSION, approvalDigest: approvalDigest(binding), risk, riskReasons: reasons as never, policy: policy as never, requiredApprovals: required,
        status: "pending", requestedBy: p.actorId, comment: input.comment?.trim() || null, expiresAt: new Date(now.getTime() + minutes(policy.expiryMinutes)),
      });
      if (!row) throw approvalPending();
      await this.audit(tx, p, row.id, "approval.requested", null, { planHash: row.planHash, approvalDigest: row.approvalDigest, risk, requiredApprovals: required, policy }, meta);
      return row;
    });

    // Moving the incident writes `approval.requested` (with the plan hash) to its timeline. If the incident moved
    // underneath us, the request is cancelled instead of being left pending for a plan nobody is waiting on.
    try {
      await this.incidents.transition(p, input.incidentId, { to: "awaiting_approval", reason: `Approval requested (${approval.id})`, expectedStatus: "containment_planned" }, meta);
    } catch (e) {
      await this.close(approval, "cancelled", `The incident could not move to awaiting_approval: ${e instanceof AppError ? e.code : "error"}`, p, meta, true);
      throw e;
    }
    return (await this.repo.find(this.db, org, approval.id))!;
  }

  // ------------------------------------------------------------------ decide

  async approve(p: Principal, id: string, comment: string | undefined, meta: RequestMeta = {}) {
    return this.decide(p, id, "approve", comment, meta);
  }

  async reject(p: Principal, id: string, comment: string, meta: RequestMeta = {}) {
    if (!comment?.trim()) throw new ValidationError("A rejection needs a comment");
    return this.decide(p, id, "reject", comment, meta);
  }

  private async decide(p: Principal, id: string, decision: "approve" | "reject", comment: string | undefined, meta: RequestMeta) {
    assertCan(p, "approval:decide");
    const org = p.organizationId;
    const pre = await this.repo.find(this.db, org, id);
    if (!pre) throw approvalNotFound();
    if (pre.status !== "pending") throw notPending(pre.status);
    // Recompute the plan BEFORE taking the lock (it is the slow part). Done for rejections too, so the record says what was reviewed.
    const integrity = await this.verifyBinding(pre);

    type Outcome = { kind: "decided"; row: ApprovalRow } | { kind: "expired"; row: ApprovalRow } | { kind: "invalidated"; row: ApprovalRow; why: string };
    const outcome: Outcome = await this.db.transaction(async (tx) => {
      const cur = await this.repo.lock(tx, org, id);
      if (!cur) throw approvalNotFound();
      if (cur.status !== "pending") throw notPending(cur.status);
      const now = this.now();
      if (cur.expiresAt.getTime() <= now.getTime()) {
        const row = await this.repo.update(tx, org, id, { status: "expired", closedReason: "Expired before a decision" });
        await this.audit(tx, p, id, "approval.expired", { status: "pending" }, { status: "expired" }, meta);
        return { kind: "expired" as const, row };
      }
      if (cur.policy.separationOfDuties && decision === "approve" && cur.requestedBy === p.actorId) throw separationOfDuties();
      if (!integrity.ok) {
        const row = await this.repo.update(tx, org, id, { status: "invalidated", closedReason: integrity.reason });
        await this.audit(tx, p, id, "approval.invalidated", { status: "pending" }, { status: "invalidated", reason: integrity.reason }, meta);
        return { kind: "invalidated" as const, row, why: integrity.reason };
      }
      const d = await this.repo.addDecision(tx, { organizationId: org, approvalId: id, decision, decidedBy: p.actorId, role: p.role, comment: comment?.trim() || null, planHash: cur.planHash, approvalDigest: cur.approvalDigest });
      if (!d) throw alreadyDecided();
      await this.audit(tx, p, id, "approval.decision_recorded", null, { decision, planHash: cur.planHash, approvalDigest: cur.approvalDigest, comment: d.comment }, meta);

      let row = cur;
      if (decision === "reject") {
        row = await this.repo.update(tx, org, id, { status: "rejected", decidedAt: now, closedReason: d.comment });
      } else {
        const approvals = (await this.repo.listDecisions(tx, org, id)).filter((x) => x.decision === "approve").length;
        if (approvals >= cur.requiredApprovals) {
          row = await this.repo.update(tx, org, id, { status: "approved", decidedAt: now, executableUntil: new Date(now.getTime() + minutes(cur.policy.executionWindowMinutes)) });
        }
      }
      if (row.status !== "pending") await this.audit(tx, p, id, `approval.${row.status}`, { status: "pending" }, { status: row.status }, meta);
      return { kind: "decided" as const, row };
    });

    if (outcome.row.status !== "pending") await this.reconcileOne(outcome.row, meta);
    if (outcome.kind === "expired") throw approvalExpired();
    if (outcome.kind === "invalidated") throw approvalInvalidated(outcome.why);
    return this.get(p, id);
  }

  // ------------------------------------------------------------------ cancel, read

  async cancel(p: Principal, id: string, reason: string, meta: RequestMeta = {}) {
    assertCan(p, "approval:request");
    if (!reason?.trim()) throw new ValidationError("A reason is required");
    const row = await this.repo.find(this.db, p.organizationId, id);
    if (!row) throw approvalNotFound();
    if (row.requestedBy !== p.actorId && p.role !== "admin") throw notRequester();
    if (row.status !== "pending") throw notPending(row.status);
    await this.close(row, "cancelled", reason.trim(), p, meta, false);
    return this.get(p, id);
  }

  async get(p: Principal, id: string) {
    assertCan(p, "approval:read");
    let row = await this.repo.find(this.db, p.organizationId, id);
    if (!row) throw approvalNotFound();
    if (row.status === "pending" && row.expiresAt.getTime() <= this.now().getTime()) {
      await this.close(row, "expired", "Expired before a decision", systemPrincipal(row.organizationId, APPROVAL_ACTOR_ID), {}, false);
      row = (await this.repo.find(this.db, p.organizationId, id))!;
    }
    const decisions = await this.repo.listDecisions(this.db, p.organizationId, id);
    const approvals = decisions.filter((d) => d.decision === "approve").length;
    return { approval: row, decisions, approvalsReceived: approvals, approvalsRemaining: row.status === "pending" ? Math.max(0, row.requiredApprovals - approvals) : 0 };
  }

  async list(p: Principal, f: { status?: ApprovalStatus | undefined; incidentId?: string | undefined }, page: { limit: number; offset: number }) {
    assertCan(p, "approval:read");
    return this.repo.list(this.db, p.organizationId, f, page);
  }

  async history(p: Principal, id: string) {
    assertCan(p, "approval:read");
    if (!(await this.repo.find(this.db, p.organizationId, id))) throw approvalNotFound();
    return this.repo.listAudit(this.db, p.organizationId, id);
  }

  // ------------------------------------------------------------------ the gateway's question

  /**
   * ApprovalVerifier for the Enforcement Gateway. True only if an approved,
   * unexpired-for-execution approval exists for this incident and exact plan
   * hash, the plan is still the incident's current plan, and recomputing the
   * plan from its pinned snapshot reproduces the approved digest. A failed
   * recheck invalidates the approval. Any error answers false (fail closed).
   */
  async isPlanApproved(organizationId: string, incidentId: string, planHash: string): Promise<boolean> {
    try {
      const [a] = await this.repo.findApprovedFor(this.db, organizationId, incidentId, planHash);
      if (!a || !a.executableUntil || a.executableUntil.getTime() <= this.now().getTime()) return false;
      const integrity = await this.verifyBinding(a);
      if (!integrity.ok) {
        await this.close(a, "invalidated", integrity.reason, systemPrincipal(organizationId, APPROVAL_ACTOR_ID), {}, false);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ maintenance (sweep)

  /** Expires overdue pending requests and finishes any incident updates that failed earlier. Safe to run repeatedly and concurrently. */
  async runMaintenance(): Promise<{ expired: number; reconciled: number }> {
    let expired = 0;
    for (const row of await this.repo.expiredPending(this.db, this.now())) {
      if (await this.close(row, "expired", "Expired before a decision", systemPrincipal(row.organizationId, APPROVAL_ACTOR_ID), {}, false)) expired++;
    }
    let reconciled = 0;
    for (const row of await this.repo.unsynced(this.db)) if (await this.reconcileOne(row, {})) reconciled++;
    return { expired, reconciled };
  }

  // ------------------------------------------------------------------ internals

  /** Moves a request out of pending (or approved -> invalidated) and syncs the incident. Returns false if someone else already did. */
  private async close(row: ApprovalRow, status: "expired" | "cancelled" | "invalidated", reason: string, p: Principal, meta: RequestMeta, markSynced: boolean): Promise<boolean> {
    const updated = await this.db.transaction(async (tx) => {
      const cur = await this.repo.lock(tx, row.organizationId, row.id);
      if (!cur) return null;
      const allowed = cur.status === "pending" || (status === "invalidated" && cur.status === "approved");
      if (!allowed) return null;
      const u = await this.repo.update(tx, row.organizationId, row.id, { status, closedReason: reason, ...(markSynced ? { incidentSynced: true } : {}) });
      await this.audit(tx, p, row.id, `approval.${status}`, { status: cur.status }, { status, reason }, meta);
      return u;
    });
    if (!updated) return false;
    if (!markSynced) await this.reconcileOne(updated, meta);
    return true;
  }

  /**
   * Makes the incident reflect a final approval status. Every write is
   * idempotent (keys derive from the approval id), so this can be retried after
   * a crash or a transient failure until `incident_synced` is true.
   */
  private async reconcileOne(a: ApprovalRow, meta: RequestMeta): Promise<boolean> {
    const sys = systemPrincipal(a.organizationId, APPROVAL_ACTOR_ID);
    const key = (s: string) => `approval:${a.id}:${s}`;
    const decisions = await this.repo.listDecisions(this.db, a.organizationId, a.id);
    const data = { approvalId: a.id, planHash: a.planHash, approvalDigest: a.approvalDigest, status: a.status, reason: a.closedReason, deciders: decisions.map((d) => ({ by: d.decidedBy, decision: d.decision })) };
    try {
      const incident = await this.reader.getIncident(a.organizationId, a.incidentId);
      if (!incident) return false;
      if (a.status === "approved") {
        if (incident.status === "awaiting_approval") {
          await this.incidents.transition(sys, a.incidentId, { to: "approved", reason: `Approved: ${a.id}`, idempotencyKey: key("approved"), data }, meta);
        } else if (incident.status !== "approved" && incident.status !== "containing" && incident.status !== "verifying") {
          // The incident moved on without this approval (for example a person withdrew the request): it must not be usable.
          await this.close(a, "invalidated", `The incident left awaiting_approval (${incident.status}) before the approval completed`, sys, meta, false);
          return true;
        }
        await this.incidents.recordExternalEvent(sys, a.incidentId, { type: "approval.granted", data, idempotencyKey: key("granted") }, meta);
      } else if (a.status === "rejected") {
        if (incident.status === "awaiting_approval") await this.incidents.transition(sys, a.incidentId, { to: "rejected", reason: `Rejected: ${a.closedReason ?? a.id}`, idempotencyKey: key("rejected"), data }, meta);
        await this.incidents.recordExternalEvent(sys, a.incidentId, { type: "approval.rejected", data, idempotencyKey: key("rejected-event") }, meta);
      } else if (a.status === "expired" || a.status === "cancelled" || a.status === "invalidated") {
        const back = a.status === "invalidated" ? ["awaiting_approval", "approved"] : ["awaiting_approval"];
        if (back.includes(incident.status)) await this.incidents.transition(sys, a.incidentId, { to: "investigating", reason: `Approval ${a.status}: ${a.closedReason ?? a.id}`, idempotencyKey: key(`withdrawn-${a.status}`), data }, meta);
        await this.incidents.recordExternalEvent(sys, a.incidentId, { type: `approval.${a.status}` as "approval.expired", data, idempotencyKey: key(a.status) }, meta);
      } else {
        return false;
      }
      await this.repo.update(this.db, a.organizationId, a.id, { incidentSynced: true });
      return true;
    } catch {
      // Left unsynced; runMaintenance retries. Nothing here can make an approval valid by failing.
      return false;
    }
  }

  /** Recomputes the plan on its pinned snapshot and checks it against what the request was bound to. */
  private async verifyBinding(a: ApprovalRow): Promise<Integrity> {
    const current = await this.reader.getCurrentPlanReference(a.organizationId, a.incidentId);
    if (!current || current.id !== a.planReferenceId) return { ok: false, reason: "the incident's current plan is no longer the one under approval" };
    const integrity = await this.integrity(a.organizationId, a.incidentId, current);
    if (!integrity.ok) return integrity;
    const digest = approvalDigest({ organizationId: a.organizationId, incidentId: a.incidentId, planReferenceId: current.id, planVersion: current.version, planHash: current.planHash ?? "", snapshotHash: current.snapshotHash, resultHash: integrity.resultHash });
    if (digest !== a.approvalDigest) return { ok: false, reason: "the recomputed plan does not match the approved digest" };
    return integrity;
  }

  private async integrity(org: string, incidentId: string, plan: AnalysisReference): Promise<Integrity> {
    try {
      const v = await this.analysis.verify(systemPrincipal(org, APPROVAL_ACTOR_ID), incidentId, plan.id);
      if (!v.reproducible || !v.computedResultHash) return { ok: false, reason: v.snapshotHashMatches ? "the plan is not reproducible from its pinned snapshot" : "the pinned snapshot no longer matches its hash" };
      const recomputedPlanHash = (v.result as { plan?: { planHash?: string } } | null)?.plan?.planHash;
      if (recomputedPlanHash !== plan.planHash) return { ok: false, reason: "the recomputed plan hash differs from the stored plan hash" };
      return { ok: true, resultHash: v.computedResultHash };
    } catch (e) {
      return { ok: false, reason: `the plan could not be recomputed (${e instanceof AppError ? e.code : "error"})` };
    }
  }

  private async policyFor(org: string): Promise<ApprovalPolicy> {
    const row = await this.repo.getPolicy(this.db, org);
    return row ? pick(row) : DEFAULT_POLICY;
  }

  private async audit(tx: Parameters<ApprovalRepository["addAudit"]>[0], p: Principal, approvalId: string, action: string, before: unknown, after: unknown, meta: RequestMeta) {
    await this.repo.addAudit(tx, { organizationId: p.organizationId, approvalId, actorId: p.actorId, actorType: actorType(p), action, beforeState: (before ?? null) as never, afterState: (after ?? null) as never, correlationId: meta.correlationId ?? null });
  }
}

const pick = (r: ApprovalPolicy): ApprovalPolicy => ({ requiredApprovals: r.requiredApprovals, elevatedRequiredApprovals: r.elevatedRequiredApprovals, separationOfDuties: r.separationOfDuties, expiryMinutes: r.expiryMinutes, executionWindowMinutes: r.executionWindowMinutes });
