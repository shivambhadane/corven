import { assertCan } from "../../auth/permissions.js";
import type { Principal } from "../../auth/principal.js";
import { systemPrincipal } from "../../auth/system.js";
import type { Database } from "../../db/client.js";
import { AppError, ConflictError, NotFoundError } from "../../errors.js";
import type { ApprovalService } from "../approval-service/services/approval.service.js";
import type { EnforcementService } from "../authorization-gateway/services/enforcement.service.js";
import type { GatewayService } from "../authorization-gateway/services/gateway.service.js";
import { toContainmentCoverage } from "../authorization-gateway/core/coverage.js";
import type { EvidenceService } from "../evidence-service/services/evidence.service.js";
import type { IncidentReader } from "../incident-management/readers/incident.reader.js";
import type { IncidentAnalysisService } from "../incident-management/services/analysis.service.js";
import type { IncidentService } from "../incident-management/services/incident.service.js";
import type { DetectionSource, Severity } from "../incident-management/types.js";
import type { VerificationService } from "../verification-service/services/verification.service.js";
import type { WorkflowRepository, WorkflowRow } from "./repository.js";
import { backoffSeconds, LEASE_SECONDS, MAX_VERIFICATION_ATTEMPTS, ORCHESTRATOR_ACTOR_ID, TERMINAL, type StepResult } from "./types.js";

export interface OrchestratorDeps {
  incidents: IncidentService;
  reader: IncidentReader;
  analysis: IncidentAnalysisService;
  approvals: ApprovalService;
  enforcement: EnforcementService;
  gateway: GatewayService;
  verification: VerificationService;
  evidence: EvidenceService;
}

export interface Signal {
  title: string;
  severity: Severity;
  source: Exclude<DetectionSource, "manual">;
  /** The signal's id in the producing system; makes intake idempotent. */
  reference: string;
  compromisedAgentIds: string[];
}

const workflowNotFound = () => Object.assign(new NotFoundError("Workflow not found"), { code: "WORKFLOW_NOT_FOUND" });

/**
 * Drives an incident through the response without ever deciding anything a person must decide.
 *
 *   analysis (snapshot, blast radius, plan with real gateway coverage) -> request approval
 *   -> [a person approves or rejects] -> enforce the approved plan -> verify -> evidence -> anchor
 *
 * Every run re-derives the next action from the real state of the modules, so a duplicate
 * delivery, a retry or a restart repeats nothing. The orchestrator never approves, never
 * marks an incident contained (Verification does), and stops, visibly, when it cannot proceed.
 */
export class Orchestrator {
  constructor(
    private readonly db: Database,
    private readonly repo: WorkflowRepository,
    private readonly d: OrchestratorDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private sys = (org: string): Principal => systemPrincipal(org, ORCHESTRATOR_ACTOR_ID);

  // ------------------------------------------------------------------ start

  async start(p: Principal, incidentId: string, meta: { correlationId?: string | undefined } = {}) {
    assertCan(p, "workflow:run");
    return this.create(p.organizationId, incidentId, p.actorId, p.role === "system" ? "system" : "human", meta.correlationId);
  }

  /** A trusted detection source opens an incident and starts the response. Repeating the same signal changes nothing. */
  async openFromSignal(organizationId: string, signal: Signal, meta: { correlationId?: string | undefined } = {}) {
    const sys = this.sys(organizationId);
    const { incident, created } = await this.d.incidents.create(sys, {
      title: signal.title, severity: signal.severity, detectionSource: signal.source, detectionReference: signal.reference,
      agents: signal.compromisedAgentIds.map((agentId) => ({ agentId, relationship: "compromised" as const, source: "system" as const })),
    }, meta);
    const wf = await this.create(organizationId, incident.id, ORCHESTRATOR_ACTOR_ID, "system", meta.correlationId);
    return { incident, incidentCreated: created, workflow: wf.workflow, workflowCreated: wf.created };
  }

  private async create(org: string, incidentId: string, by: string, byType: "human" | "system", correlationId?: string) {
    if (!(await this.d.reader.getIncident(org, incidentId))) throw Object.assign(new NotFoundError("Incident not found"), { code: "INCIDENT_NOT_FOUND" });
    const row = await this.repo.insert(this.db, { organizationId: org, incidentId, startedBy: by, startedByType: byType, correlationId: correlationId ?? null, nextRunAt: this.now() });
    if (row) {
      await this.repo.addEvent(this.db, org, row.id, "started", { by, byType });
      return { workflow: row, created: true };
    }
    return { workflow: (await this.repo.findForIncident(this.db, org, incidentId))!, created: false };
  }

  // ------------------------------------------------------------------ human controls

  async get(p: Principal, id: string) {
    assertCan(p, "workflow:read");
    const wf = await this.repo.find(this.db, p.organizationId, id);
    if (!wf) throw workflowNotFound();
    return { workflow: wf, events: await this.repo.listEvents(this.db, p.organizationId, id) };
  }

  async forIncident(p: Principal, incidentId: string) {
    assertCan(p, "workflow:read");
    const wf = await this.repo.findForIncident(this.db, p.organizationId, incidentId);
    if (!wf) throw workflowNotFound();
    return this.get(p, wf.id);
  }

  /** Re-opens a failed, blocked or stopped workflow after a person has dealt with the cause. */
  async retry(p: Principal, id: string) {
    assertCan(p, "workflow:run");
    const wf = await this.repo.find(this.db, p.organizationId, id);
    if (!wf) throw workflowNotFound();
    if (!["failed", "blocked", "stopped"].includes(wf.status)) throw new ConflictError(`A ${wf.status} workflow cannot be retried`, "WORKFLOW_NOT_RETRYABLE");
    await this.repo.update(this.db, id, { status: "running", attempts: 0, lastError: null, outcome: null, finishedAt: null, nextRunAt: this.now(), leaseUntil: null, approvalRequested: false, step: "analysis" });
    await this.repo.addEvent(this.db, wf.organizationId, id, "retried", { by: p.actorId, previousStatus: wf.status, previousOutcome: wf.outcome });
    return (await this.repo.find(this.db, p.organizationId, id))!;
  }

  async cancel(p: Principal, id: string, reason: string) {
    assertCan(p, "workflow:run");
    const wf = await this.repo.find(this.db, p.organizationId, id);
    if (!wf) throw workflowNotFound();
    if (TERMINAL.has(wf.status)) throw new ConflictError(`The workflow is already ${wf.status}`, "WORKFLOW_FINISHED");
    await this.repo.update(this.db, id, { status: "cancelled", outcome: "cancelled_by_user", finishedAt: this.now(), leaseUntil: null });
    await this.repo.addEvent(this.db, wf.organizationId, id, "cancelled", { by: p.actorId, reason: reason.slice(0, 300) });
    return (await this.repo.find(this.db, p.organizationId, id))!;
  }

  // ------------------------------------------------------------------ running

  /** Runs every due workflow once (and as far as it can go). This is what the background ticker calls. */
  async tick(limit = 10): Promise<{ processed: number }> {
    const now = this.now();
    const claimed = await this.db.transaction((tx) => this.repo.claimDue(tx, now, new Date(now.getTime() + LEASE_SECONDS * 1000), limit));
    for (const wf of claimed) await this.run(wf);
    return { processed: claimed.length };
  }

  /** Runs one workflow now, if nobody else holds it. For tests and for an immediate nudge after a person's decision. */
  async runNow(organizationId: string, id: string): Promise<WorkflowRow | null> {
    const now = this.now();
    const wf = await this.repo.claimOne(this.db, organizationId, id, now, new Date(now.getTime() + LEASE_SECONDS * 1000));
    if (!wf) return this.repo.find(this.db, organizationId, id);
    await this.run(wf);
    return this.repo.find(this.db, organizationId, id);
  }

  /** Background upkeep that other modules need: approval expiry, interrupted verification runs, anchor confirmations. */
  async maintenance() {
    return {
      approvals: await this.d.approvals.runMaintenance(),
      verification: await this.d.verification.runMaintenance(undefined, this.now()),
      evidence: await this.d.evidence.runMaintenance(),
    };
  }

  private async run(start: WorkflowRow): Promise<void> {
    let wf = start;
    try {
      for (let i = 0; i < 12; i++) {
        const r = await this.advance(wf);
        wf = (await this.repo.find(this.db, wf.organizationId, wf.id))!;
        if (r.kind === "again") {
          await this.repo.update(this.db, wf.id, { step: r.step, attempts: 0, lastError: null });
          await this.repo.addEvent(this.db, wf.organizationId, wf.id, "step", { step: r.step });
          continue;
        }
        if (r.kind === "wait") {
          await this.repo.update(this.db, wf.id, { status: "waiting", step: r.step, attempts: 0, lastError: null, nextRunAt: new Date(this.now().getTime() + r.seconds * 1000), leaseUntil: null });
          return;
        }
        const status = r.kind === "done" ? "completed" : r.kind;
        await this.repo.update(this.db, wf.id, { status, outcome: r.outcome, finishedAt: this.now(), leaseUntil: null, attempts: 0 });
        await this.repo.addEvent(this.db, wf.organizationId, wf.id, status, { outcome: r.outcome });
        return;
      }
      // Made progress for a dozen steps in one run: yield and continue on the next tick.
      await this.repo.update(this.db, wf.id, { status: "running", nextRunAt: this.now(), leaseUntil: null });
    } catch (e) {
      const attempts = wf.attempts + 1;
      const message = (e instanceof AppError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : "error").slice(0, 400);
      if (attempts >= wf.maxAttempts) {
        await this.repo.update(this.db, wf.id, { status: "failed", outcome: "retries_exhausted", attempts, lastError: message, finishedAt: this.now(), leaseUntil: null });
        await this.repo.addEvent(this.db, wf.organizationId, wf.id, "failed", { attempts, error: message });
      } else {
        await this.repo.update(this.db, wf.id, { status: "running", attempts, lastError: message, nextRunAt: new Date(this.now().getTime() + backoffSeconds(attempts) * 1000), leaseUntil: null });
        await this.repo.addEvent(this.db, wf.organizationId, wf.id, "retry_scheduled", { attempts, error: message, afterSeconds: backoffSeconds(attempts) });
      }
    }
  }

  // ------------------------------------------------------------------ one step

  /** Looks at the real state and does the next thing. Idempotent: every write has a key or checks first. */
  private async advance(wf: WorkflowRow): Promise<StepResult> {
    const org = wf.organizationId;
    const id = wf.incidentId;
    const sys = this.sys(org);
    const inc = await this.d.reader.getIncident(org, id);
    if (!inc) return { kind: "stopped", outcome: "incident_missing" };
    const key = (s: string) => `workflow:${wf.id}:${s}`;

    switch (inc.status) {
      case "detected":
        await this.d.incidents.transition(sys, id, { to: "investigating", reason: "Automated response started", idempotencyKey: key("investigating") });
        return { kind: "again", step: "analysis" };

      case "investigating": {
        if (wf.approvalRequested) return { kind: "stopped", outcome: "returned_to_investigation" }; // approval expired, cancelled, withdrawn or invalidated: a person decides what next
        try {
          if (!(await this.d.reader.getCurrentSnapshotReference(org, id))) await this.d.analysis.attachSnapshot(sys, id, { label: `Automated response ${wf.id}` });
          if (!(await this.d.reader.getIncident(org, id))!.currentBlastRefId) await this.d.analysis.attachBlastRadius(sys, id, {});
          if (!(await this.d.reader.getCurrentPlanReference(org, id))) {
            // Only edges CORVEN can actually enforce are cut; the planner routes around the rest or reports a blocker.
            const coverage = toContainmentCoverage(await this.d.gateway.coverage(sys));
            await this.d.analysis.attachContainmentPlan(sys, id, { coverage });
          }
        } catch (e) {
          if (e instanceof AppError && e.code === "NO_COMPROMISED_AGENTS") return { kind: "blocked", outcome: "no_compromised_agents" };
          throw e;
        }
        const plan = (await this.d.reader.getCurrentPlanReference(org, id))!;
        if (plan.planStatus !== "feasible") return { kind: "blocked", outcome: `plan_${plan.planStatus}` };
        await this.d.incidents.transition(sys, id, { to: "containment_planned", reason: "Containment plan generated", idempotencyKey: key("planned") });
        return { kind: "again", step: "approval" };
      }

      case "containment_planned":
        await this.d.approvals.request(sys, { incidentId: id, comment: "Requested by the automated response" });
        await this.repo.update(this.db, wf.id, { approvalRequested: true });
        return { kind: "wait", step: "awaiting_approval", seconds: 30 };

      case "awaiting_approval":
        await this.d.approvals.runMaintenance(); // expires overdue requests, finishes interrupted incident updates
        return { kind: "wait", step: "awaiting_approval", seconds: 30 };

      case "rejected":
        return { kind: "stopped", outcome: "approval_rejected" };

      case "approved":
        await this.d.incidents.transition(sys, id, { to: "containing", reason: "Enforcing the approved plan", idempotencyKey: key("containing") });
        return { kind: "again", step: "enforcing" };

      case "containing": {
        const plan = (await this.d.reader.getCurrentPlanReference(org, id))!;
        const recomputed = await this.d.analysis.verify(sys, id, plan.id);
        const actions = (recomputed.result as { plan: { actions: Array<{ edgeId: string; kind: string; sourceNodeId: string; targetNodeId: string }> } } | null)?.plan.actions;
        if (!actions) return { kind: "blocked", outcome: "plan_not_reproducible" };
        try {
          // Idempotent per action: a restart continues instead of repeating. Failed or unsupported actions are recorded and
          // verification will say so; they are not hidden here.
          await this.d.enforcement.applyPlan(sys, { incidentId: id, planHash: plan.planHash!, actions, keyPrefix: `wf-${wf.id}`, reason: "Enforcing the approved containment plan" });
        } catch (e) {
          if (e instanceof AppError && e.code === "APPROVAL_REQUIRED") return { kind: "blocked", outcome: "approval_no_longer_valid" };
          throw e;
        }
        await this.verifyOnce(wf, sys);
        return { kind: "again", step: "verifying" };
      }

      case "verifying": {
        const runs = await this.d.verification.listForIncident(sys, id);
        const last = runs[0];
        if (last && (last.status === "pending" || last.status === "running")) return { kind: "wait", step: "verifying", seconds: 15 };
        if (wf.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) return { kind: "blocked", outcome: "verification_inconclusive" };
        await this.verifyOnce(wf, sys, last);
        return { kind: "again", step: "verifying" };
      }

      case "contained":
      case "partially_contained":
      case "containment_failed": {
        let evidenceId = wf.evidenceId;
        if (!evidenceId) {
          evidenceId = (await this.d.evidence.generate(sys, id)).id;
          await this.repo.update(this.db, wf.id, { evidenceId, step: "evidence" });
          await this.repo.addEvent(this.db, org, wf.id, "evidence_generated", { evidenceId });
        }
        try {
          // Only the targets this deployment can actually reach; none configured is not an error.
          const targets = this.d.evidence.anchorTargets();
          if (targets.length > 0) await this.d.evidence.anchor(sys, evidenceId, targets);
          else await this.repo.addEvent(this.db, org, wf.id, "anchoring_skipped", { reason: "NO_ANCHOR_TARGET_CONFIGURED" });
        } catch (e) {
          // Anchoring is best effort and never changes the outcome: not configured, or the evidence failed integrity checks.
          await this.repo.addEvent(this.db, org, wf.id, "anchoring_skipped", { reason: e instanceof AppError ? e.code : "error" });
        }
        return { kind: "done", outcome: inc.status };
      }

      case "resolved":
      case "closed":
        return { kind: "done", outcome: inc.status };
      case "false_positive":
        return { kind: "stopped", outcome: "false_positive" };
    }
  }

  private async verifyOnce(wf: WorkflowRow, sys: Principal, last?: { id: string; status: string }) {
    const attempt = wf.verificationAttempts + 1;
    await this.repo.update(this.db, wf.id, { verificationAttempts: attempt });
    try {
      if (last?.status === "inconclusive") await this.d.verification.retry(sys, last.id);
      else await this.d.verification.start(sys, { incidentId: wf.incidentId, idempotencyKey: `workflow:${wf.id}:verify:${attempt}` });
    } catch (e) {
      if (e instanceof AppError && e.code === "VERIFICATION_IN_PROGRESS") return; // someone else is verifying; the next step waits for it
      throw e;
    }
  }
}
