import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { UnprocessableError } from "../../../errors.js";
import { canonicalHash } from "../../../common/canonical.js";
import type { BlastRadiusService } from "../../blast-radius/services/blast-radius.service.js";
import type { ContainmentService } from "../../containment/services/containment.service.js";
import type { ContainmentInput } from "../../containment/types.js";
import type { SnapshotService } from "../../graph-snapshot/services/snapshot.service.js";
import { SnapshotIntegrityError } from "../../graph-snapshot/services/snapshot.service.js";
import { ANALYSIS_STATES, PLAN_STATES } from "../core/state-machine.js";
import { analysisNotAllowed, incidentClosed, incidentNotFound, planLocked, referenceNotFound, snapshotRequired } from "../errors.js";
import type { IncidentRepository } from "../repositories/incident.repository.js";
import { ENGINE_VERSION, SNAPSHOT_FORMAT_VERSION, type AnalysisReference, type Incident, type ReferenceKind, type RequestMeta } from "../types.js";
import { recordChange } from "./shared.js";

export interface BlastInput {
  sourceNodeIds?: string[] | undefined;
  confidenceThreshold?: number | undefined;
  staleAfterHours?: number | undefined;
}
export interface PlanInput {
  sourceNodeIds?: string[] | undefined;
  protectedNodeIds?: string[] | undefined;
  healthyWorkflows?: ContainmentInput["healthyWorkflows"];
  coverage?: ContainmentInput["coverage"];
  options?: { confidenceThreshold?: number | undefined; staleAfterHours?: number | undefined; costApprovalThreshold?: number | undefined; highValueNodeIds?: string[] | undefined } | undefined;
}

/**
 * Attaches analysis to an incident by REFERENCE. Nothing is copied: a snapshot is
 * pinned by id and hash, and a blast-radius or plan reference stores the engine
 * input, a canonical hash of the engine's output and a small summary. Both
 * engines are deterministic over an immutable snapshot, so the full result can
 * be recomputed and compared against the stored hash at any time (`verify`).
 */
export class IncidentAnalysisService {
  constructor(
    private readonly db: Database,
    private readonly repo: IncidentRepository,
    private readonly snapshots: SnapshotService,
    private readonly blast: BlastRadiusService,
    private readonly containment: ContainmentService,
  ) {}

  // ------------------------------------------------------------------ snapshot

  /** Pins an existing snapshot, or captures a new one when `snapshotId` is omitted. */
  async attachSnapshot(p: Principal, incidentId: string, input: { snapshotId?: string | undefined; label?: string | undefined }, meta: RequestMeta = {}): Promise<AnalysisReference> {
    assertCan(p, "incident:write");
    const pre = await this.repo.find(this.db, p.organizationId, incidentId);
    if (!pre) throw incidentNotFound();
    this.assertState(pre, ANALYSIS_STATES, analysisNotAllowed);

    let snap;
    if (input.snapshotId) snap = await this.snapshots.get(p, input.snapshotId); // 404 for a snapshot in another organization
    else snap = await this.snapshots.create(p, { label: input.label ?? `Incident ${incidentId}`, incidentId });
    const check = await this.snapshots.verify(p, snap.id);
    if (!check.valid) throw new SnapshotIntegrityError();

    return this.db.transaction(async (tx) => {
      const inc = await this.repo.lock(tx, p.organizationId, incidentId);
      if (!inc) throw incidentNotFound();
      this.assertState(inc, ANALYSIS_STATES, analysisNotAllowed);
      const ref = await this.repo.addRef(tx, {
        organizationId: p.organizationId, incidentId, kind: "graph_snapshot", version: await this.repo.nextRefVersion(tx, p.organizationId, incidentId, "graph_snapshot"),
        snapshotId: snap.id, snapshotHash: snap.contentHash, snapshotBuiltAt: snap.builtAt, snapshotFormatVersion: SNAPSHOT_FORMAT_VERSION, engineVersion: ENGINE_VERSION,
        input: { snapshotId: snap.id }, resultHash: null, planHash: null, planStatus: null,
        summary: { nodeCount: snap.nodeCount, edgeCount: snap.edgeCount, label: snap.label, snapshotCreatedAt: snap.createdAt.toISOString() }, createdBy: p.actorId,
      });
      // Blast radius and plans were computed on the previous snapshot and no longer apply; they stay in history.
      await this.repo.update(tx, p.organizationId, incidentId, { currentSnapshotRefId: ref.id, currentBlastRefId: null, currentPlanRefId: null });
      await recordChange(this.repo, tx, inc, p, meta, {
        event: "incident.snapshot_attached", targetType: "analysis_reference", targetId: ref.id,
        data: { referenceId: ref.id, snapshotId: snap.id, snapshotHash: snap.contentHash, version: ref.version, supersededBlastReferenceId: inc.currentBlastRefId, supersededPlanReferenceId: inc.currentPlanRefId },
        before: { currentSnapshotRefId: inc.currentSnapshotRefId }, after: { currentSnapshotRefId: ref.id },
      });
      return ref;
    });
  }

  // ------------------------------------------------------------------ blast radius

  async attachBlastRadius(p: Principal, incidentId: string, input: BlastInput, meta: RequestMeta = {}): Promise<AnalysisReference & { result: unknown }> {
    assertCan(p, "incident:write");
    assertCan(p, "analysis:read");
    const { inc, snapshotRef } = await this.context(p, incidentId, ANALYSIS_STATES, analysisNotAllowed);
    const sourceNodeIds = input.sourceNodeIds?.length ? input.sourceNodeIds : await this.compromisedNodes(p, incidentId);
    const stored = { sourceNodeIds, ...(input.confidenceThreshold !== undefined ? { confidenceThreshold: input.confidenceThreshold } : {}), ...(input.staleAfterHours !== undefined ? { staleAfterHours: input.staleAfterHours } : {}), analysedAt: new Date().toISOString() };
    const result = await this.computeBlast(p, snapshotRef.snapshotId, stored);

    return this.db.transaction(async (tx) => {
      const locked = await this.repo.lock(tx, p.organizationId, incidentId);
      if (!locked) throw incidentNotFound();
      this.assertSameContext(locked, inc);
      const ref = await this.repo.addRef(tx, {
        organizationId: p.organizationId, incidentId, kind: "blast_radius", version: await this.repo.nextRefVersion(tx, p.organizationId, incidentId, "blast_radius"),
        snapshotId: snapshotRef.snapshotId, snapshotHash: snapshotRef.snapshotHash, snapshotBuiltAt: snapshotRef.snapshotBuiltAt, snapshotFormatVersion: snapshotRef.snapshotFormatVersion,
        engineVersion: ENGINE_VERSION, input: stored, resultHash: canonicalHash(result), planHash: null, planStatus: null,
        summary: {
          counts: result.summary, impactedCount: result.impacted.length, sharedResourceCount: result.sharedResources.length, uncertainEdgeCount: result.uncertainEdgeIds.length,
          graph: result.graph, options: result.options, limitationCount: result.limitations.length,
        },
        createdBy: p.actorId,
      });
      await this.repo.update(tx, p.organizationId, incidentId, { currentBlastRefId: ref.id });
      await recordChange(this.repo, tx, locked, p, meta, {
        event: "incident.blast_radius_attached", targetType: "analysis_reference", targetId: ref.id,
        data: { referenceId: ref.id, snapshotReferenceId: snapshotRef.id, resultHash: ref.resultHash, version: ref.version, counts: result.summary, uncertainEdgeCount: result.uncertainEdgeIds.length },
        before: { currentBlastRefId: locked.currentBlastRefId }, after: { currentBlastRefId: ref.id },
      });
      return { ...ref, result };
    });
  }

  // ------------------------------------------------------------------ containment plan

  async attachContainmentPlan(p: Principal, incidentId: string, input: PlanInput, meta: RequestMeta = {}): Promise<AnalysisReference & { result: unknown }> {
    assertCan(p, "incident:write");
    assertCan(p, "analysis:read");
    const { inc, snapshotRef } = await this.context(p, incidentId, PLAN_STATES, planLocked);
    const sourceNodeIds = input.sourceNodeIds?.length ? input.sourceNodeIds : await this.compromisedNodes(p, incidentId);
    const stored = {
      sourceNodeIds,
      ...(input.protectedNodeIds ? { protectedNodeIds: input.protectedNodeIds } : {}),
      ...(input.healthyWorkflows ? { healthyWorkflows: input.healthyWorkflows } : {}),
      ...(input.coverage ? { coverage: input.coverage } : {}),
      ...(input.options ? { options: input.options } : {}),
      analysedAt: new Date().toISOString(),
    };
    const result = await this.computePlan(p, snapshotRef.snapshotId, stored);
    const plan = result.plan;

    return this.db.transaction(async (tx) => {
      const locked = await this.repo.lock(tx, p.organizationId, incidentId);
      if (!locked) throw incidentNotFound();
      this.assertSameContext(locked, inc);
      this.assertState(locked, PLAN_STATES, planLocked);
      const ref = await this.repo.addRef(tx, {
        organizationId: p.organizationId, incidentId, kind: "containment_plan", version: await this.repo.nextRefVersion(tx, p.organizationId, incidentId, "containment_plan"),
        snapshotId: snapshotRef.snapshotId, snapshotHash: snapshotRef.snapshotHash, snapshotBuiltAt: snapshotRef.snapshotBuiltAt, snapshotFormatVersion: snapshotRef.snapshotFormatVersion,
        engineVersion: ENGINE_VERSION, input: stored, resultHash: canonicalHash(result), planHash: plan.planHash, planStatus: plan.status,
        summary: {
          status: plan.status, totalCost: plan.totalCost, actionCount: plan.actions.length, approvalRequired: plan.approvalRequired, approvalReasons: plan.approvalReasons,
          preservedWorkflowCount: plan.preservedWorkflows.length, unsatisfiedWorkflowCount: plan.preservedWorkflows.filter((w) => !w.satisfied).length,
          blockerCount: plan.blockers.length, uncertainDependencyCount: plan.uncertainDependencyEdgeIds.length, verification: plan.verification,
          protectedWasDefaulted: result.protectedWasDefaulted, limitationCount: plan.limitations.length,
        },
        createdBy: p.actorId,
      });
      await this.repo.update(tx, p.organizationId, incidentId, { currentPlanRefId: ref.id });
      await recordChange(this.repo, tx, locked, p, meta, {
        event: "incident.containment_plan_attached", targetType: "analysis_reference", targetId: ref.id,
        // A generated plan is a proposal: it is not approved, enforced or verified.
        data: { referenceId: ref.id, planHash: plan.planHash, planStatus: plan.status, version: ref.version, totalCost: plan.totalCost, actionCount: plan.actions.length, approvalRequired: plan.approvalRequired },
        before: { currentPlanRefId: locked.currentPlanRefId }, after: { currentPlanRefId: ref.id },
      });
      return { ...ref, result };
    });
  }

  // ------------------------------------------------------------------ read and verify

  async list(p: Principal, incidentId: string, kind?: ReferenceKind): Promise<AnalysisReference[]> {
    assertCan(p, "incident:read");
    if (!(await this.repo.find(this.db, p.organizationId, incidentId))) throw incidentNotFound();
    return this.repo.listRefs(this.db, p.organizationId, incidentId, kind);
  }

  async currentReferences(p: Principal, inc: Incident) {
    const get = (id: string | null) => (id ? this.repo.findRef(this.db, p.organizationId, inc.id, id) : Promise.resolve(null));
    return { snapshot: await get(inc.currentSnapshotRefId), blastRadius: await get(inc.currentBlastRefId), containmentPlan: await get(inc.currentPlanRefId) };
  }

  /** Recomputes the analysis from the pinned snapshot and the stored input and compares it with the stored hash. */
  async verify(p: Principal, incidentId: string, referenceId: string) {
    assertCan(p, "incident:read");
    assertCan(p, "analysis:read");
    if (!(await this.repo.find(this.db, p.organizationId, incidentId))) throw incidentNotFound();
    const ref = await this.repo.findRef(this.db, p.organizationId, incidentId, referenceId);
    if (!ref) throw referenceNotFound();

    const snap = await this.snapshots.get(p, ref.snapshotId);
    const snapshot = await this.snapshots.verify(p, ref.snapshotId);
    const snapshotMatches = snap.contentHash === ref.snapshotHash && snapshot.valid;
    if (ref.kind === "graph_snapshot") return { referenceId, kind: ref.kind, reproducible: snapshotMatches, snapshotHashMatches: snapshotMatches, storedResultHash: null, computedResultHash: null, result: null };
    if (!snapshotMatches) return { referenceId, kind: ref.kind, reproducible: false, snapshotHashMatches: false, storedResultHash: ref.resultHash, computedResultHash: null, result: null };

    const result = ref.kind === "blast_radius" ? await this.computeBlast(p, ref.snapshotId, ref.input as never) : await this.computePlan(p, ref.snapshotId, ref.input as never);
    const computed = canonicalHash(result);
    return { referenceId, kind: ref.kind, reproducible: computed === ref.resultHash, snapshotHashMatches: true, storedResultHash: ref.resultHash, computedResultHash: computed, result };
  }

  // ------------------------------------------------------------------ internals

  private computeBlast(p: Principal, snapshotId: string, input: { sourceNodeIds: string[]; confidenceThreshold?: number; staleAfterHours?: number; analysedAt: string }) {
    return this.blast.analyze(p, {
      sourceNodeIds: input.sourceNodeIds, snapshotId, now: new Date(input.analysedAt),
      confidenceThreshold: input.confidenceThreshold,
      staleAfterMs: input.staleAfterHours !== undefined ? input.staleAfterHours * 3_600_000 : undefined,
    });
  }

  private computePlan(p: Principal, snapshotId: string, input: PlanInput & { sourceNodeIds: string[]; analysedAt: string }) {
    const o = input.options;
    return this.containment.plan(p, {
      sourceNodeIds: input.sourceNodeIds, protectedNodeIds: input.protectedNodeIds, healthyWorkflows: input.healthyWorkflows, coverage: input.coverage, snapshotId,
      options: { ...(o ?? {}), now: new Date(input.analysedAt), staleAfterMs: o?.staleAfterHours !== undefined ? o.staleAfterHours * 3_600_000 : undefined },
    });
  }

  /** Incident plus its current snapshot reference; rejects when analysis is not allowed in the current state. */
  private async context(p: Principal, incidentId: string, states: ReadonlySet<string>, fail: (s: string) => Error) {
    const inc = await this.repo.find(this.db, p.organizationId, incidentId);
    if (!inc) throw incidentNotFound();
    this.assertState(inc, states, fail);
    const snapshotRef = inc.currentSnapshotRefId ? await this.repo.findRef(this.db, p.organizationId, incidentId, inc.currentSnapshotRefId) : null;
    if (!snapshotRef) throw snapshotRequired();
    // Re-verify the pinned snapshot at the moment it is used.
    const check = await this.snapshots.verify(p, snapshotRef.snapshotId);
    if (!check.valid || check.storedHash !== snapshotRef.snapshotHash) throw new SnapshotIntegrityError();
    return { inc, snapshotRef };
  }

  private assertState(inc: Incident, states: ReadonlySet<string>, fail: (s: string) => Error): void {
    if (inc.status === "closed") throw incidentClosed();
    if (!states.has(inc.status)) throw fail(inc.status);
  }

  /** The snapshot may not have been replaced while the analysis ran. */
  private assertSameContext(locked: Incident, before: Incident): void {
    if (locked.currentSnapshotRefId !== before.currentSnapshotRefId) {
      throw new UnprocessableError("SNAPSHOT_CHANGED", "The incident's snapshot changed while the analysis was running; run it again");
    }
  }

  private async compromisedNodes(p: Principal, incidentId: string): Promise<string[]> {
    const nodes = (await this.repo.listAgents(this.db, p.organizationId, incidentId)).filter((a) => a.relationship === "compromised").map((a) => `agent:${a.agentId}`);
    if (nodes.length === 0) throw new UnprocessableError("NO_COMPROMISED_AGENTS", "Associate at least one compromised agent with the incident, or pass sourceNodeIds");
    return [...new Set(nodes)];
  }
}
