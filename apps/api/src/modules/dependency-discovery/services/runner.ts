import type { Database } from "../../../db/client.js";
import { AppError, NotFoundError } from "../../../errors.js";
import type { AgentRepository } from "../../agent-registry/repositories/agent.repository.js";
import type { DependencyRepository } from "../../dependency-registry/repositories/dependency.repository.js";
import type { ResourceRepository } from "../../dependency-registry/repositories/resource.repository.js";
import type { DependencyRegistryWriter } from "../../dependency-registry/services/dependency-writer.service.js";
import { assertCompatibleEndpoints, assertNotSelfReference } from "../../dependency-registry/policies/relationship.policy.js";
import { ADAPTERS, type DiscoveryContext } from "../core/adapters.js";
import { confidenceFor } from "../core/confidence.js";
import { normalize } from "../core/normalize.js";
import { classify, findIntraRunConflicts, type KeyedProposal } from "../core/reconcile.js";
import { redactPayload } from "../core/redact.js";
import { memoizeLookup, resolveEntity, type EntityLookup } from "../core/resolve.js";
import type { DiscoveryRepository, ObservationRow, RunRow, SourceRow } from "../repositories/discovery.repository.js";
import { SOURCE_REF_PREFIX, type EntityKind, type NormalizedObservation, type ResolvedObservation } from "../types.js";
import { submitObservation, toExisting } from "./apply.js";

const BATCH = 200;
const TERMINAL = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

class PermanentRunError extends Error {}

/**
 * Executes one discovery run: collect -> normalize -> resolve -> validate ->
 * reconcile -> complete.
 *
 * - Restartable: each stage only touches observations in the stage's input
 *   status, and the registry writer is idempotent, so a retry continues and
 *   never duplicates anything.
 * - Writes to the registry ONLY through DependencyRegistryWriter.
 * - A failed or partial run never deactivates a dependency. (Nothing here
 *   deactivates at all: a relationship that stops being reported is recorded
 *   as `missing`, not removed.)
 */
export class DiscoveryRunner {
  constructor(
    private readonly db: Database,
    private readonly repo: DiscoveryRepository,
    private readonly agents: AgentRepository,
    private readonly resources: ResourceRepository,
    private readonly deps: DependencyRepository,
    private readonly writer: DependencyRegistryWriter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(organizationId: string, runId: string): Promise<RunRow> {
    const org = organizationId;
    let run = await this.repo.findRun(this.db, org, runId);
    if (!run) throw new NotFoundError("Discovery run not found");
    if (TERMINAL.has(run.status)) return run;

    const source = await this.repo.findSource(this.db, org, run.sourceId);
    try {
      if (!source) throw new PermanentRunError("The discovery source no longer exists");
      if (!source.enabled) throw new PermanentRunError("The discovery source is disabled");

      run = await this.begin(run, source);
      if (!(await this.stillActive(org, runId))) return (await this.repo.findRun(this.db, org, runId))!;
      if (!run.collectedAt) run = await this.collect(run, source);
      if (!(await this.stillActive(org, runId))) return (await this.repo.findRun(this.db, org, runId))!;
      await this.resolveStage(run);
      if (!(await this.stillActive(org, runId))) return (await this.repo.findRun(this.db, org, runId))!;
      await this.reconcileStage(run, source);
      return await this.complete(run, source);
    } catch (err) {
      if (err instanceof PermanentRunError || err instanceof AppError) {
        // Deterministic problems (bad configuration, disabled source) will not fix themselves: fail the run.
        return this.repo.updateRun(this.db, org, runId, { status: "failed", completedAt: this.now(), errorSummary: String((err as Error).message).slice(0, 500) });
      }
      // Anything else (for example a database outage) may be transient: leave the run `running` and let the queue retry.
      throw err;
    }
  }

  private async stillActive(org: string, runId: string): Promise<boolean> {
    const r = await this.repo.findRun(this.db, org, runId);
    return !!r && !TERMINAL.has(r.status);
  }

  private async begin(run: RunRow, source: SourceRow): Promise<RunRow> {
    if (run.startedAt) return this.repo.updateRun(this.db, run.organizationId, run.id, { status: "running" });
    const started = this.now();
    const stale = !!source.lastSuccessfulRunAt && started.getTime() - source.lastSuccessfulRunAt.getTime() > source.freshnessWindowHours * 3_600_000;
    const updated = await this.repo.updateRun(this.db, run.organizationId, run.id, { status: "running", startedAt: started, sourceWasStale: stale });
    if (stale) {
      await this.repo.insertResult(this.db, {
        organizationId: run.organizationId, runId: run.id, outcome: "stale",
        reason: `The source had not been successfully scanned for more than ${source.freshnessWindowHours} hours before this run. Earlier evidence from it is stale; no relationship was removed.`,
      });
    }
    return updated;
  }

  // ------------------------------------------------------------ collect

  private async collect(run: RunRow, source: SourceRow): Promise<RunRow> {
    const org = run.organizationId;
    const adapter = ADAPTERS[source.type as keyof typeof ADAPTERS];
    try { adapter.validateConfiguration(source.configuration); } catch (e) { throw new PermanentRunError(`Invalid source configuration: ${(e as Error).message}`); }

    return this.db.transaction(async (tx) => {
      let eventRows: Awaited<ReturnType<DiscoveryRepository["eventsForRun"]>> = [];
      const ctx: DiscoveryContext = { organizationId: org, discoveryRunId: run.id, sourceId: source.id, now: this.now() };
      if (source.type === "runtime_gateway") {
        eventRows = await this.repo.eventsForRun(tx, org, source.id, run.id);
        ctx.loadRuntimeEvents = async () => eventRows.map((e) => ({ eventId: e.eventId, payload: e.payload, receivedAt: e.receivedAt }));
      }

      let collected = 0;
      let created = 0;
      for await (const rec of adapter.discover(source.configuration, ctx)) {
        collected++;
        const base = { organizationId: org, runId: run.id, sourceId: source.id, sourceType: source.type, externalRecordId: rec.externalRecordId.slice(0, 400), sourceReference: rec.sourceReference.slice(0, 400), observedAt: rec.observedAt };
        if ("rejected" in rec) {
          if (await this.repo.insertObservation(tx, { ...base, rawEvidence: redactPayload(rec.payload), processingStatus: "rejected", rejectionReason: rec.reason.slice(0, 500) })) created++;
          continue;
        }
        const norm = normalize(source.type as never, rec);
        const row = norm.ok
          ? { ...base, rawEvidence: redactPayload(rec.payload), processingStatus: "normalized" as const, normalized: norm.observation }
          : { ...base, rawEvidence: redactPayload(rec.payload), processingStatus: "rejected" as const, rejectionReason: norm.reason.slice(0, 500) };
        if (await this.repo.insertObservation(tx, row)) created++;
      }
      await this.repo.markEventsConsumed(tx, org, eventRows.filter((e) => e.consumedRunId === null).map((e) => e.id), run.id);
      return this.repo.updateRun(tx, org, run.id, { collectedAt: this.now(), recordsCollected: collected, observationsCreated: created });
    });
  }

  // ------------------------------------------------------------ resolve + validate

  private entityLookup(org: string): EntityLookup {
    return memoizeLookup({
      byExternalReference: async (t, ref) => ((t === "agent" ? await this.agents.findByExternalReference(this.db, org, ref) : await this.resources.findByExternalReference(this.db, org, ref))?.id ?? null),
      byId: async (t, id) => ((t === "agent" ? await this.agents.findAgent(this.db, org, id) : await this.resources.find(this.db, org, id))?.id ?? null),
      byName: async (t, name) => ((t === "agent" ? await this.agents.findByName(this.db, org, name) : await this.resources.findByName(this.db, org, name))?.id ?? null),
    });
  }

  private async resolveStage(run: RunRow): Promise<void> {
    const org = run.organizationId;
    const lookup = this.entityLookup(org);
    for (;;) {
      const batch = await this.repo.takeByStatus(this.db, org, run.id, "normalized", BATCH);
      if (batch.length === 0) return;
      for (const obs of batch) {
        const n = obs.normalized as NormalizedObservation;
        const [src, tgt] = [await resolveEntity(lookup, n.sourceEntity.type, n.sourceEntity.reference), await resolveEntity(lookup, n.targetEntity.type, n.targetEntity.reference)];
        if (src.status !== "resolved" || tgt.status !== "resolved") {
          const reason = [src, tgt].filter((x) => x.status !== "resolved").map((x) => (x as { reason: string }).reason).join("; ");
          await this.repo.updateObservation(this.db, org, obs.id, { processingStatus: "unresolved", rejectionReason: reason.slice(0, 500), reconciliationOutcome: "unresolved" });
          await this.repo.insertResult(this.db, { organizationId: org, runId: run.id, observationId: obs.id, outcome: "unresolved", reason: reason.slice(0, 500) });
          continue;
        }
        const reject = async (reason: string) => void (await this.repo.updateObservation(this.db, org, obs.id, { processingStatus: "rejected", rejectionReason: reason.slice(0, 500) }));
        try {
          const s = { type: n.sourceEntity.type as EntityKind, id: src.entity.id }, t = { type: n.targetEntity.type as EntityKind, id: tgt.entity.id };
          assertNotSelfReference(s, t);
          assertCompatibleEndpoints(n.dependencyType, s, t);
        } catch (e) {
          await reject((e as Error).message);
          continue;
        }
        const conf = confidenceFor(n);
        const resolved: ResolvedObservation = {
          source: { type: n.sourceEntity.type, ...src.entity }, target: { type: n.targetEntity.type, ...tgt.entity },
          confidence: conf.confidence, confidenceRule: conf.rule,
        };
        await this.repo.updateObservation(this.db, org, obs.id, { processingStatus: "resolved", resolved });
      }
    }
  }

  // ------------------------------------------------------------ reconcile

  private keyOf(n: NormalizedObservation, r: ResolvedObservation): string {
    return `${r.source.type}:${r.source.id}>${r.target.type}:${r.target.id}|${n.dependencyType}`;
  }

  private async reconcileStage(run: RunRow, source: SourceRow): Promise<void> {
    const org = run.organizationId;
    // Disagreement between sources is judged over the WHOLE run once, before anything is applied.
    // Observations already applied or parked by an earlier attempt are included, so a retry sees the same picture.
    const pool = [
      ...(await this.repo.takeByStatus(this.db, org, run.id, "resolved", 20_000)),
      ...(await this.repo.takeByStatus(this.db, org, run.id, "applied", 20_000)),
      ...(await this.repo.takeByStatus(this.db, org, run.id, "pending_review", 20_000)),
    ];
    const intra = findIntraRunConflicts(
      pool.map((o): KeyedProposal => {
        const n = o.normalized as NormalizedObservation, r = o.resolved as ResolvedObservation;
        return { key: this.keyOf(n, r), observationId: o.id, relationship: n.relationship, metadata: n.metadata, confidence: r.confidence };
      }),
    );
    for (;;) {
      const batch = await this.repo.takeByStatus(this.db, org, run.id, "resolved", BATCH);
      if (batch.length === 0) break; // every processed observation leaves the "resolved" status, so this terminates
      await this.reconcileBatch(run, batch, intra);
    }
    await this.detectMissing(run, source);
  }

  private async reconcileBatch(run: RunRow, batch: ObservationRow[], intra: ReadonlySet<string>): Promise<void> {
    const org = run.organizationId;
    for (const obs of batch) {
      const n = obs.normalized as NormalizedObservation, r = obs.resolved as ResolvedObservation;
      const existing = await this.writer.findMatching(org, { sourceType: r.source.type, sourceId: r.source.id, targetType: r.target.type, targetId: r.target.id, dependencyType: n.dependencyType });
      let cls = classify(existing ? toExisting(existing) : null, { relationship: n.relationship, metadata: n.metadata, confidence: r.confidence });
      if (intra.has(obs.id)) cls = { outcome: "conflicting", autoApply: false, reason: "Sources disagree about this dependency within the same run" };

      if (!cls.autoApply) {
        await this.repo.updateObservation(this.db, org, obs.id, { processingStatus: "pending_review", reconciliationOutcome: cls.outcome, dependencyId: existing?.id ?? null });
        await this.repo.insertResult(this.db, { organizationId: org, runId: run.id, observationId: obs.id, dependencyId: existing?.id ?? null, outcome: cls.outcome, reason: cls.reason });
        continue;
      }
      const res = await submitObservation(this.writer, org, obs);
      if (res.registryOutcome === "rejected") {
        const reason = `${res.reasonCode}: ${res.reason}`.slice(0, 500);
        await this.repo.updateObservation(this.db, org, obs.id, { processingStatus: "rejected", rejectionReason: reason, reconciliationOutcome: cls.outcome, registryOutcome: "rejected", dependencyId: res.dependencyId ?? existing?.id ?? null });
        await this.repo.insertResult(this.db, { organizationId: org, runId: run.id, observationId: obs.id, dependencyId: res.dependencyId ?? null, outcome: cls.outcome, reason });
        continue;
      }
      await this.repo.updateObservation(this.db, org, obs.id, { processingStatus: "applied", reconciliationOutcome: cls.outcome, registryOutcome: res.registryOutcome, dependencyId: res.dependencyId ?? null });
      await this.repo.insertResult(this.db, { organizationId: org, runId: run.id, observationId: obs.id, dependencyId: res.dependencyId ?? null, outcome: cls.outcome, reason: cls.reason });
    }
  }

  /**
   * "Missing" means: a dependency this source used to support was not reported in this
   * complete scan. It is recorded for review. It is NEVER deactivated automatically:
   * absence of evidence is not proof the dependency is gone. Event streams are not
   * scans, so runtime sources never report missing dependencies.
   */
  private async detectMissing(run: RunRow, source: SourceRow): Promise<void> {
    if (source.type === "runtime_gateway") return;
    const org = run.organizationId;
    const supported = await this.deps.listActiveIdsByEvidencePrefix(this.db, org, SOURCE_REF_PREFIX(source.id));
    const seen = await this.repo.dependencyIdsSeenInRun(this.db, org, run.id);
    for (const id of supported) {
      if (seen.has(id)) continue;
      await this.repo.insertResult(this.db, {
        organizationId: org, runId: run.id, dependencyId: id, outcome: "missing",
        reason: "This source reported the dependency in an earlier scan but not in this one. The dependency was NOT deactivated; a human must decide.",
      });
    }
  }

  // ------------------------------------------------------------ complete

  private async complete(run: RunRow, source: SourceRow): Promise<RunRow> {
    const org = run.organizationId;
    const status = await this.repo.countByStatus(this.db, org, run.id);
    const registry = await this.repo.countRegistryOutcomes(this.db, org, run.id);
    const results = await this.repo.countResults(this.db, org, run.id);
    const rejected = status.rejected ?? 0;
    const finished = await this.repo.updateRun(this.db, org, run.id, {
      status: rejected > 0 ? "completed_with_errors" : "completed",
      completedAt: this.now(),
      relationshipsCreated: registry.created ?? 0,
      relationshipsUpdated: registry.updated ?? 0,
      relationshipsUnchanged: registry.unchanged ?? 0,
      relationshipsRejected: rejected,
      unresolvedObservations: status.unresolved ?? 0,
      pendingReview: status.pending_review ?? 0,
      missingRelationships: results.missing ?? 0,
    });
    await this.repo.updateSource(this.db, org, source.id, { lastSuccessfulRunAt: this.now() });
    return finished;
  }
}
