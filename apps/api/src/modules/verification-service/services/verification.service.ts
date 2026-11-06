import { randomUUID } from "node:crypto";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { systemPrincipal } from "../../../auth/system.js";
import { canonicalHash } from "../../../common/canonical.js";
import type { Database } from "../../../db/client.js";
import type { ProbeResult } from "../../authorization-gateway/index.js";
import type { Graph } from "../../graph-engine/core/graph.js";
import type { IncidentReader } from "../../incident-management/readers/incident.reader.js";
import type { IncidentAnalysisService } from "../../incident-management/services/analysis.service.js";
import type { IncidentService } from "../../incident-management/services/incident.service.js";
import { aggregate, incidentOutcomeFor, reachableProtected } from "../core/outcome.js";
import { badTarget, incidentNotFound, inProgress, noApprovedPlan, notRetryable, notVerifiable, retryLimit, runNotFound } from "../errors.js";
import type { RunRow, VerificationRepository } from "../repositories/verification.repository.js";
import { MAX_ATTEMPTS, type CheckRecord, type RequestMeta } from "../types.js";

/** Fixed audit identity for the incident transitions Verification makes. */
export const VERIFICATION_ACTOR_ID = "00000000-0000-4000-8000-0000000fe41f";

export interface Prober {
  probe(organizationId: string, agentId: string, input: { requestId: string; resource: string; action: string }): Promise<ProbeResult>;
}
export interface SnapshotGraphs {
  loadGraph(principal: Principal, snapshotId: string): Promise<Graph>;
}
export interface Lookups {
  agentExists(org: string, id: string): Promise<boolean>;
  resourceExists(org: string, id: string): Promise<boolean>;
}
export interface ExplicitCheck {
  agentId: string;
  resourceId: string;
  action: string;
}
export interface StartInput {
  incidentId: string;
  /** Extra healthy paths that must still work (beyond those derived from active grants). */
  healthyChecks?: ExplicitCheck[] | undefined;
  /** Extra operations that must now be denied. */
  maliciousChecks?: ExplicitCheck[] | undefined;
  idempotencyKey?: string | undefined;
}

type PlanView = {
  sourceNodeIds: string[];
  protectedNodeIds: string[];
  actions: Array<{ edgeId: string; kind: string; sourceNodeId: string; targetNodeId: string }>;
};

const actorType = (p: Principal) => (p.role === "system" ? "system" : "human") as "human" | "system";
const idOf = (node: string, prefix: "agent" | "resource") => (node.startsWith(`${prefix}:`) ? node.slice(prefix.length + 1) : null);

/**
 * Independently checks that containment worked.
 *
 * Security checks ask whether the compromised agent can still do what it could
 * do before (through the gateway's live decision path), whether revoked grants
 * stayed revoked, whether the enforced cut actually separates sources from the
 * protected resources on the pinned graph, and whether the protected resources
 * are declared gateway-only. Continuity checks ask whether healthy agents can
 * still reach the resources they are allowed to, using the resource's
 * non-destructive probe. Nothing is executed.
 *
 * It reads the gateway's and approval's tables directly (read only) on purpose:
 * it must observe the resulting state, not trust what enforcement reported.
 */
export class VerificationService {
  constructor(
    private readonly db: Database,
    private readonly repo: VerificationRepository,
    private readonly incidents: IncidentService,
    private readonly reader: IncidentReader,
    private readonly analysis: IncidentAnalysisService,
    private readonly snapshots: SnapshotGraphs,
    private readonly prober: Prober,
    private readonly lookups: Lookups,
  ) {}

  async start(p: Principal, input: StartInput, meta: RequestMeta = {}) {
    assertCan(p, "verification:run");
    return this.begin(p, input, 1, null, meta);
  }

  async retry(p: Principal, runId: string, meta: RequestMeta = {}) {
    assertCan(p, "verification:run");
    const prev = await this.repo.findRun(this.db, p.organizationId, runId);
    if (!prev) throw runNotFound();
    if (prev.status !== "inconclusive") throw notRetryable(`Only an inconclusive run can be retried (this one is ${prev.status}); a final result is not re-rolled`);
    if (prev.attempt >= MAX_ATTEMPTS) throw retryLimit();
    const inputs = (prev.summary as { input?: StartInput } | null)?.input ?? { incidentId: prev.incidentId };
    return this.begin(p, { ...inputs, idempotencyKey: `retry:${prev.id}` }, prev.attempt + 1, prev.id, meta);
  }

  async get(p: Principal, runId: string) {
    assertCan(p, "verification:read");
    const run = await this.repo.findRun(this.db, p.organizationId, runId);
    if (!run) throw runNotFound();
    const checks = await this.repo.listChecks(this.db, p.organizationId, runId);
    // Evidence integrity: the stored result hash must still match the checks.
    const integrity = run.resultHash ? canonicalHash(checks.map(checkForHash)) === run.resultHash : null;
    return { run, checks, resultHashMatches: integrity };
  }

  async listForIncident(p: Principal, incidentId: string) {
    assertCan(p, "verification:read");
    if (!(await this.reader.getIncident(p.organizationId, incidentId))) throw incidentNotFound();
    return this.repo.listForIncident(this.db, p.organizationId, incidentId);
  }

  /**
   * Retries incident updates that failed after a run completed, and closes runs a crash left
   * `pending` or `running`: they become `inconclusive` ("interrupted"), which unblocks the
   * incident for a retry and is never mistaken for containment. Idempotent.
   */
  async runMaintenance(staleAfterMs = 10 * 60_000, now: Date = new Date()): Promise<{ reconciled: number; interrupted: number }> {
    let interrupted = 0;
    for (const r of await this.repo.staleActive(this.db, new Date(now.getTime() - staleAfterMs))) {
      const summary = { ...((r.summary as object | null) ?? {}), counts: aggregate([]).counts, error: "The run was interrupted before it finished", limitations: [], notChecked: [] };
      await this.repo.updateRun(this.db, r.organizationId, r.id, { status: "inconclusive", completedAt: now, resultHash: canonicalHash([]), summary: summary as never });
      interrupted++;
    }
    let reconciled = 0;
    for (const r of await this.repo.unsynced(this.db)) if (await this.syncIncident(r, {})) reconciled++;
    return { reconciled, interrupted };
  }

  // ------------------------------------------------------------------ run

  private async begin(p: Principal, input: StartInput, attempt: number, retryOf: string | null, meta: RequestMeta) {
    const org = p.organizationId;
    if (input.idempotencyKey) {
      const prior = await this.repo.findByKey(this.db, org, input.idempotencyKey);
      if (prior) return this.get(p, prior.id);
    }
    const incident = await this.reader.getIncident(org, input.incidentId);
    if (!incident) throw incidentNotFound();
    if (incident.status !== "containing" && incident.status !== "verifying") throw notVerifiable(incident.status);
    const planRef = await this.reader.getCurrentPlanReference(org, input.incidentId);
    if (!planRef?.planHash) throw noApprovedPlan();
    const approval = await this.repo.latestApproval(this.db, org, input.incidentId, planRef.planHash);
    if (!approval) throw noApprovedPlan();
    for (const c of [...(input.healthyChecks ?? []), ...(input.maliciousChecks ?? [])]) {
      if (!(await this.lookups.agentExists(org, c.agentId))) throw badTarget("Agent not found");
      if (!(await this.lookups.resourceExists(org, c.resourceId))) throw badTarget("Resource not found");
    }

    const run = await this.repo.insertRun(this.db, {
      organizationId: org, incidentId: input.incidentId, approvalId: approval.id, planReferenceId: planRef.id, planHash: planRef.planHash, snapshotId: planRef.snapshotId, snapshotHash: planRef.snapshotHash,
      attempt, retryOf, status: "pending", idempotencyKey: input.idempotencyKey ?? null, requestedBy: p.actorId, requestedByType: actorType(p),
      summary: { input: { incidentId: input.incidentId, healthyChecks: input.healthyChecks ?? [], maliciousChecks: input.maliciousChecks ?? [] } } as never,
    });
    if (!run) {
      if (input.idempotencyKey) {
        const prior = await this.repo.findByKey(this.db, org, input.idempotencyKey);
        if (prior) return this.get(p, prior.id);
      }
      throw inProgress();
    }

    const sys = systemPrincipal(org, VERIFICATION_ACTOR_ID);
    if (incident.status === "containing") {
      await this.incidents.transition(sys, input.incidentId, { to: "verifying", reason: `Verification run ${run.id} started`, idempotencyKey: `verification:${run.id}:start`, data: { runId: run.id } }, meta);
    }
    await this.repo.updateRun(this.db, org, run.id, { status: "running", startedAt: new Date() });

    let checks: CheckRecord[];
    let notChecked: string[] = [];
    let error: string | null = null;
    try {
      ({ checks, notChecked } = await this.buildChecks(sys, run, input));
    } catch (e) {
      checks = [];
      error = e instanceof Error ? e.message.slice(0, 300) : "verification failed";
    }
    const { status, counts } = aggregate(checks);
    const outcome = incidentOutcomeFor(status);
    const rows = checks.map((c, i) => ({ organizationId: org, runId: run.id, seq: i + 1, ...c, detail: c.detail as never }));
    await this.db.transaction(async (tx) => {
      await this.repo.insertChecks(tx, rows);
      const stored = await this.repo.listChecks(tx, org, run.id);
      await this.repo.updateRun(tx, org, run.id, {
        status, completedAt: new Date(), incidentOutcome: outcome, resultHash: canonicalHash(stored.map(checkForHash)),
        summary: { input: (run.summary as { input: unknown }).input, counts, ...(error ? { error } : {}), limitations: limitationsOf(checks), notChecked } as never,
      });
    });
    const final = (await this.repo.findRun(this.db, org, run.id))!;
    await this.syncIncident(final, meta);
    return this.get(p, run.id);
  }

  private async buildChecks(sys: Principal, run: RunRow, input: StartInput): Promise<{ checks: CheckRecord[]; notChecked: string[] }> {
    const notChecked: string[] = [];
    const org = run.organizationId;
    const v = await this.analysis.verify(sys, run.incidentId, run.planReferenceId);
    if (!v.snapshotHashMatches || !v.result) throw new Error("The plan's pinned snapshot no longer verifies; nothing can be checked against it");
    const plan = (v.result as { plan: PlanView }).plan;
    const sources = plan.sourceNodeIds.map((n) => idOf(n, "agent")).filter((x): x is string => !!x);
    const protectedResources = plan.protectedNodeIds.map((n) => idOf(n, "resource")).filter((x): x is string => !!x);
    const enforcement = await this.repo.enforcementFor(this.db, org, run.incidentId, run.planHash);
    const checks: CheckRecord[] = [];
    const probeId = () => `verify:${run.id}:${randomUUID().slice(0, 8)}`;

    // 1. PERMISSION_PERSISTENCE: every resource revocation in the plan is in force and nothing was re-granted.
    for (const a of plan.actions.filter((x) => x.kind === "revoke_resource_access")) {
      const agentId = idOf(a.sourceNodeId, "agent");
      const resourceId = idOf(a.targetNodeId, "resource");
      const action = enforcement.find((e) => e.edgeId === a.edgeId);
      const active = agentId && resourceId ? (await this.repo.pairPermissions(this.db, org, agentId, resourceId)).filter((x) => x.status === "active") : [];
      const ok = action?.status === "executed" && active.length === 0;
      checks.push({
        category: "PERMISSION_PERSISTENCE_TEST", purpose: "security", agentId, resourceId, action: null, expected: "blocked",
        actual: !action ? "no_enforcement_action" : action.status !== "executed" ? `action_${action.status}` : active.length ? "grants_active" : "revoked_and_restricted",
        result: ok ? "passed" : "failed", detail: { edgeId: a.edgeId, enforcementActionId: action?.id ?? null, activeGrantIds: active.map((x) => x.id) }, executionReference: action?.id ?? null, limitation: null,
      });
    }

    // 2. NEGATIVE_ACCESS: everything the compromised agents were able to do on protected resources must now be denied.
    const negatives: ExplicitCheck[] = [...(input.maliciousChecks ?? [])];
    for (const agentId of sources) {
      for (const resourceId of protectedResources) {
        for (const action of new Set((await this.repo.pairPermissions(this.db, org, agentId, resourceId)).map((x) => x.action))) negatives.push({ agentId, resourceId, action });
      }
    }
    for (const n of dedupe(negatives)) {
      const r = await this.safeProbe(org, n, probeId());
      const result = r.error ? "inconclusive" : r.decision === "deny" ? "passed" : "failed";
      checks.push({
        category: "NEGATIVE_ACCESS_TEST", purpose: "security", ...n, expected: "deny", actual: r.error ? "probe_error" : r.decision === "deny" ? `denied:${(r.reasonCodes ?? []).join(",")}` : `allowed:${r.observed}`,
        result, detail: { reasonCodes: r.reasonCodes ?? [], observed: r.observed ?? null, hasCredential: r.hasCredential ?? null, ...(r.error ? { error: r.error, transient: true } : {}) },
        executionReference: r.decisionId ?? null, limitation: r.hasCredential === false ? "The agent has no active CORVEN credential; this shows the gateway would deny it, not what it can do elsewhere" : null,
      });
    }

    // 3. PATH_BLOCK: on the pinned graph, with the edges that were actually enforced removed, sources must not reach protected resources.
    const graph = await this.snapshots.loadGraph(sys, run.snapshotId);
    const enforcedEdges = new Set(enforcement.filter((e) => e.status === "executed" && e.edgeId).map((e) => e.edgeId!));
    const still = reachableProtected(graph.edges().filter((e) => e.status === "active"), enforcedEdges, plan.sourceNodeIds, plan.protectedNodeIds);
    checks.push({
      category: "PATH_BLOCK_TEST", purpose: "security", agentId: null, resourceId: null, action: null, expected: "blocked", actual: still.length ? `reachable:${still.length}` : "unreachable",
      result: still.length ? "failed" : "passed", detail: { stillReachable: still, enforcedEdgeIds: [...enforcedEdges].sort(), unenforced: enforcement.filter((e) => e.status !== "executed").map((e) => ({ id: e.id, kind: e.kind, status: e.status })) },
      executionReference: null, limitation: "Structural: computed on the pinned dependency graph, so it covers only registered dependencies",
    });

    // 4. BYPASS_RESISTANCE: only a resource declared gateway-only can be said to have no route around the gateway.
    const modes = new Map((await this.repo.modes(this.db, org)).map((m) => [m.resourceId, m.mode]));
    for (const resourceId of protectedResources) {
      const mode = modes.get(resourceId) ?? "undeclared";
      checks.push({
        category: "BYPASS_RESISTANCE_TEST", purpose: "security", agentId: null, resourceId, action: null, expected: "gateway_only", actual: mode,
        result: mode === "gateway" ? "passed" : "inconclusive", detail: { mode }, executionReference: null,
        limitation: mode === "gateway" ? "Based on an administrator's declaration that all access passes the gateway; CORVEN cannot observe access outside it" : "CORVEN cannot test routes to this resource that do not pass the gateway",
      });
    }

    // 5. POSITIVE_ACCESS: healthy agents keep the access they are allowed (live decision + non-destructive probe).
    const sourceSet = new Set(sources);
    const positives: ExplicitCheck[] = [...(input.healthyChecks ?? [])];
    for (const resourceId of protectedResources) {
      for (const g of await this.repo.activePermissionsOn(this.db, org, resourceId)) if (!sourceSet.has(g.agentId)) positives.push({ agentId: g.agentId, resourceId, action: g.action });
    }
    const reached = new Set<string>();
    for (const c of dedupe(positives)) {
      const r = await this.safeProbe(org, c, probeId());
      let result: CheckRecord["result"];
      let limitation: string | null = null;
      if (r.error || r.observed === "probe_error") {
        result = "inconclusive";
        limitation = "The probe failed; this may be transient";
      } else if (r.decision === "deny") result = "failed";
      else if (r.observed === "reachable") {
        result = "passed";
        reached.add(c.resourceId);
        if (r.simulated) limitation = "The resource executor is simulated";
      } else if (r.observed === "no_probe") {
        result = "inconclusive";
        limitation = "Authorized, but the resource cannot be probed, so continued operation was not observed";
      } else result = "failed";
      checks.push({
        category: "POSITIVE_ACCESS_TEST", purpose: "continuity", ...c, expected: "allow", actual: r.error ? "probe_error" : `${r.decision}:${r.observed}`, result,
        detail: { reasonCodes: r.reasonCodes ?? [], observed: r.observed ?? null, ...(r.error ? { error: r.error, transient: true } : {}) }, executionReference: r.decisionId ?? null, limitation,
      });
    }

    // 6. RESOURCE_HEALTH: each protected resource that healthy agents depend on answered at least one healthy probe.
    //    A resource no healthy agent can use has no healthy path to preserve; it is listed as not checked, not counted.
    for (const resourceId of protectedResources) {
      if (!positives.some((x) => x.resourceId === resourceId)) {
        notChecked.push(`Resource ${resourceId}: no healthy agent has access, so its availability was not checked`);
        continue;
      }
      checks.push({
        category: "RESOURCE_HEALTH_TEST", purpose: "continuity", agentId: null, resourceId, action: null, expected: "reachable",
        actual: reached.has(resourceId) ? "reachable" : "not_observed", result: reached.has(resourceId) ? "passed" : "failed", detail: {}, executionReference: null, limitation: null,
      });
    }
    return { checks, notChecked };
  }

  private async safeProbe(org: string, c: ExplicitCheck, requestId: string): Promise<Partial<ProbeResult> & { error?: string }> {
    try {
      return await this.prober.probe(org, c.agentId, { requestId, resource: c.resourceId, action: c.action });
    } catch (e) {
      return { error: e instanceof Error ? e.message.slice(0, 200) : "probe failed" };
    }
  }

  /** Moves the incident to what the run justifies and records the result on its timeline. Idempotent; retried by runMaintenance. */
  private async syncIncident(run: RunRow, meta: RequestMeta): Promise<boolean> {
    const sys = systemPrincipal(run.organizationId, VERIFICATION_ACTOR_ID);
    try {
      const incident = await this.reader.getIncident(run.organizationId, run.incidentId);
      if (!incident) return false;
      const data = { runId: run.id, status: run.status, resultHash: run.resultHash, counts: (run.summary as { counts?: unknown } | null)?.counts ?? null, attempt: run.attempt };
      if (run.incidentOutcome && incident.status === "verifying") {
        await this.incidents.transition(sys, run.incidentId, { to: run.incidentOutcome as "contained", reason: `Verification ${run.status} (run ${run.id})`, idempotencyKey: `verification:${run.id}:outcome`, data }, meta);
      }
      await this.incidents.recordExternalEvent(sys, run.incidentId, { type: "verification.result_received", data, idempotencyKey: `verification:${run.id}` }, meta);
      await this.repo.updateRun(this.db, run.organizationId, run.id, { incidentSynced: true });
      return true;
    } catch {
      return false;
    }
  }
}

const dedupe = (xs: ExplicitCheck[]) => [...new Map(xs.map((x) => [`${x.agentId}|${x.resourceId}|${x.action}`, x])).values()];
const limitationsOf = (checks: CheckRecord[]) => [...new Set(checks.map((c) => c.limitation).filter((x): x is string => !!x))];
/** What the result hash covers: the observations, not database ids or timestamps. */
export const checkForHash = (c: { seq: number; category: string; purpose: string; agentId: string | null; resourceId: string | null; action: string | null; expected: string; actual: string; result: string; detail: unknown; executionReference: string | null; limitation: string | null }) => ({
  seq: c.seq, category: c.category, purpose: c.purpose, agentId: c.agentId, resourceId: c.resourceId, action: c.action, expected: c.expected, actual: c.actual, result: c.result, detail: c.detail, executionReference: c.executionReference, limitation: c.limitation,
});
