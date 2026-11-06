import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { systemPrincipal } from "../../../auth/system.js";
import type { Database } from "../../../db/client.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../errors.js";
import { pgError } from "../../agent-registry/services/shared.js";
import type { DependencyService } from "../../dependency-registry/services/dependency.service.js";
import type { DependencyRegistryWriter } from "../../dependency-registry/services/dependency-writer.service.js";
import { ADAPTERS, validateRuntimeEvent } from "../core/adapters.js";
import { findSecretKey, redactPayload } from "../core/redact.js";
import type { DiscoveryRepository, ObservationRow, RunRow, SourceRow } from "../repositories/discovery.repository.js";
import type { JobQueue } from "../jobs/queue.js";
import type { DiscoveryRunStatus, DiscoverySourceType, ObservationStatus, ReconciliationOutcome } from "../types.js";
import { submitObservation } from "./apply.js";

export interface Page {
  limit: number;
  offset: number;
}

const checkConfiguration = (type: DiscoverySourceType, configuration: Record<string, unknown>) => {
  const secret = findSecretKey(configuration);
  if (secret) throw new ValidationError(`Configuration key "${secret}" looks like a secret; credentials do not belong in discovery sources`);
  try {
    ADAPTERS[type].validateConfiguration(configuration);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
};

export class DiscoveryService {
  constructor(
    private readonly db: Database,
    private readonly repo: DiscoveryRepository,
    private readonly queue: JobQueue,
    private readonly writer: DependencyRegistryWriter,
    private readonly dependencies: DependencyService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ------------------------------------------------------------ sources

  async createSource(p: Principal, input: { type: DiscoverySourceType; name: string; configuration?: Record<string, unknown> | undefined; freshnessWindowHours?: number | undefined }): Promise<SourceRow> {
    assertCan(p, "discovery:write");
    const configuration = input.configuration ?? (input.type === "runtime_gateway" ? {} : { documents: [] });
    checkConfiguration(input.type, configuration);
    try {
      return await this.repo.insertSource(this.db, { organizationId: p.organizationId, type: input.type, name: input.name.trim(), configuration, freshnessWindowHours: input.freshnessWindowHours ?? 168, createdBy: p.actorId });
    } catch (e) {
      if (pgError(e).constraint === "discovery_sources_org_name_unique") throw new ConflictError("A discovery source with this name already exists", "SOURCE_NAME_CONFLICT");
      throw e;
    }
  }

  async getSource(p: Principal, id: string): Promise<SourceRow> {
    assertCan(p, "discovery:read");
    const s = await this.repo.findSource(this.db, p.organizationId, id);
    if (!s) throw new NotFoundError("Discovery source not found");
    return s;
  }

  async listSources(p: Principal, page: Page) {
    assertCan(p, "discovery:read");
    return this.repo.listSources(this.db, p.organizationId, page);
  }

  async updateSource(p: Principal, id: string, patch: { name?: string | undefined; enabled?: boolean | undefined; configuration?: Record<string, unknown> | undefined; freshnessWindowHours?: number | undefined }): Promise<SourceRow> {
    assertCan(p, "discovery:write");
    const cur = await this.getSourceUnchecked(p.organizationId, id);
    if (patch.configuration !== undefined) checkConfiguration(cur.type as DiscoverySourceType, patch.configuration);
    try {
      return await this.repo.updateSource(this.db, p.organizationId, id, {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.configuration !== undefined ? { configuration: patch.configuration } : {}),
        ...(patch.freshnessWindowHours !== undefined ? { freshnessWindowHours: patch.freshnessWindowHours } : {}),
      });
    } catch (e) {
      if (pgError(e).constraint === "discovery_sources_org_name_unique") throw new ConflictError("A discovery source with this name already exists", "SOURCE_NAME_CONFLICT");
      throw e;
    }
  }

  private async getSourceUnchecked(org: string, id: string): Promise<SourceRow> {
    const s = await this.repo.findSource(this.db, org, id);
    if (!s) throw new NotFoundError("Discovery source not found");
    return s;
  }

  // ------------------------------------------------------------ runtime events (separately permissioned ingestion boundary)

  /**
   * Stores gateway events for a runtime source. Requires `discovery:ingest`. Today that permission is
   * held by authenticated operators and admins only; per-producer service authentication and signatures
   * do not exist yet, so events are NOT treated as independently verified.
   */
  async ingestEvents(p: Principal, sourceId: string, events: unknown[]): Promise<{ accepted: number; duplicates: number; invalid: Array<{ index: number; reason: string }> }> {
    assertCan(p, "discovery:ingest");
    const src = await this.getSourceUnchecked(p.organizationId, sourceId);
    if (src.type !== "runtime_gateway") throw new ConflictError("Events can only be ingested into a runtime_gateway source", "SOURCE_TYPE_MISMATCH");
    if (!src.enabled) throw new ConflictError("The source is disabled", "SOURCE_DISABLED");
    if (events.length > 500) throw new ValidationError("At most 500 events per request");
    let accepted = 0, duplicates = 0;
    const invalid: Array<{ index: number; reason: string }> = [];
    await this.db.transaction(async (tx) => {
      for (const [index, ev] of events.entries()) {
        const err = validateRuntimeEvent(ev);
        if (err) { invalid.push({ index, reason: err }); continue; }
        const e = ev as Record<string, unknown>;
        const stored = await this.repo.insertEvent(tx, { organizationId: p.organizationId, sourceId, eventId: String(e.eventId), payload: redactPayload(e), receivedBy: p.actorId });
        if (stored) accepted++;
        else duplicates++;
      }
    });
    return { accepted, duplicates, invalid };
  }

  // ------------------------------------------------------------ runs

  async startRun(p: Principal, sourceId: string): Promise<RunRow> {
    assertCan(p, "discovery:run");
    const src = await this.getSourceUnchecked(p.organizationId, sourceId);
    if (!src.enabled) throw new ConflictError("The source is disabled", "SOURCE_DISABLED");
    let run: RunRow;
    try {
      run = await this.repo.insertRun(this.db, { organizationId: p.organizationId, sourceId, sourceType: src.type as DiscoverySourceType, requestedBy: p.actorId });
    } catch (e) {
      if (pgError(e).constraint === "discovery_runs_one_active_per_source") throw new ConflictError("A run for this source is already pending or running", "RUN_IN_PROGRESS");
      throw e;
    }
    // Persisted first, queued second: a lost job leaves a visible pending run.
    await this.queue.enqueue({ runId: run.id, organizationId: p.organizationId });
    return run;
  }

  async getRun(p: Principal, id: string): Promise<RunRow> {
    assertCan(p, "discovery:read");
    const r = await this.repo.findRun(this.db, p.organizationId, id);
    if (!r) throw new NotFoundError("Discovery run not found");
    return r;
  }

  async listRuns(p: Principal, f: { sourceId?: string | undefined; status?: DiscoveryRunStatus | undefined }, page: Page) {
    assertCan(p, "discovery:read");
    return this.repo.listRuns(this.db, p.organizationId, f, page);
  }

  async cancelRun(p: Principal, id: string): Promise<RunRow> {
    assertCan(p, "discovery:run");
    const r = await this.getRun(p, id);
    if (r.status !== "pending" && r.status !== "running") throw new ConflictError(`A ${r.status} run cannot be cancelled`, "RUN_NOT_CANCELLABLE");
    return this.repo.updateRun(this.db, p.organizationId, id, { status: "cancelled", completedAt: this.now() });
  }

  async listObservations(p: Principal, runId: string, status: ObservationStatus | undefined, page: Page) {
    assertCan(p, "discovery:read");
    await this.getRun(p, runId);
    return this.repo.listObservations(this.db, p.organizationId, runId, status, page);
  }

  async getObservation(p: Principal, id: string): Promise<{ observation: ObservationRow; reviews: Awaited<ReturnType<DiscoveryRepository["listReviews"]>> }> {
    assertCan(p, "discovery:read");
    const o = await this.repo.findObservation(this.db, p.organizationId, id);
    if (!o) throw new NotFoundError("Observation not found");
    return { observation: o, reviews: await this.repo.listReviews(this.db, p.organizationId, id) };
  }

  async listResults(p: Principal, runId: string, outcome: ReconciliationOutcome | undefined, page: Page) {
    assertCan(p, "discovery:read");
    await this.getRun(p, runId);
    return this.repo.listResults(this.db, p.organizationId, runId, outcome, page);
  }

  // ------------------------------------------------------------ review

  /**
   * A human decision on an observation the pipeline would not apply by itself. Approving submits it
   * through the registry boundary (and, for a dependency a human had removed, reactivates it).
   * Approving a relationship is NOT approval to execute any security action.
   */
  async review(p: Principal, observationId: string, input: { decision: "approve" | "reject" | "defer"; reason?: string | undefined }) {
    assertCan(p, "discovery:review");
    const org = p.organizationId;
    return this.db.transaction(async (tx) => {
      const obs = await this.repo.findObservation(tx, org, observationId, { forUpdate: true });
      if (!obs) throw new NotFoundError("Observation not found");
      if (obs.processingStatus !== "pending_review") throw new ConflictError(`Only observations pending review can be reviewed (this one is ${obs.processingStatus})`, "OBSERVATION_NOT_REVIEWABLE");
      if (input.decision === "reject" && !input.reason?.trim()) throw new ValidationError("A reason is required to reject");

      const review = await this.repo.insertReview(tx, { organizationId: org, observationId, decision: input.decision, reviewerId: p.actorId, reason: input.reason?.trim() || null });
      if (input.decision === "defer") return { observation: obs, review };
      if (input.decision === "reject") {
        const updated = await this.repo.updateObservation(tx, org, observationId, { processingStatus: "review_rejected" });
        return { observation: updated, review };
      }

      // approve: through the registry's service boundary
      let res = await submitObservation(this.writer, org, obs, { approvedByReview: true });
      let outcome: string = res.registryOutcome;
      if (res.registryOutcome === "rejected" && res.reasonCode === "INACTIVE_REQUIRES_REVIEW" && res.dependencyId) {
        // The registry will not resurrect by itself; this human decision is the explicit reactivation.
        await this.dependencies.update(systemPrincipal(org), res.dependencyId, { status: "active" });
        outcome = "reactivated";
        res = { ...res, registryOutcome: "updated" };
      }
      if (res.registryOutcome === "rejected") {
        throw new ConflictError(`The registry rejected this relationship: ${res.reasonCode}`, "REGISTRY_REJECTED");
      }
      const updated = await this.repo.updateObservation(tx, org, observationId, { processingStatus: "applied", registryOutcome: outcome, dependencyId: res.dependencyId ?? obs.dependencyId });
      return { observation: updated, review };
    });
  }

  // ------------------------------------------------------------ coverage

  /** Which sources exist, whether they are fresh, and what is waiting for a human. Absence of observation is not proof of absence. */
  async coverage(p: Principal) {
    assertCan(p, "discovery:read");
    const org = p.organizationId;
    const sources = await this.repo.listAllSources(this.db, org);
    const now = this.now().getTime();
    const out = [];
    for (const s of sources) {
      const ageMs = s.lastSuccessfulRunAt ? now - s.lastSuccessfulRunAt.getTime() : null;
      out.push({
        sourceId: s.id, name: s.name, type: s.type, enabled: s.enabled, freshnessWindowHours: s.freshnessWindowHours,
        lastSuccessfulRunAt: s.lastSuccessfulRunAt,
        neverScanned: s.lastSuccessfulRunAt === null,
        stale: ageMs !== null && ageMs > s.freshnessWindowHours * 3_600_000,
        pendingRuntimeEvents: s.type === "runtime_gateway" ? await this.repo.countPendingEvents(this.db, org, s.id) : null,
      });
    }
    return {
      sources: out,
      statement: "Coverage describes only the configured sources. Dependencies that no configured source can see, or interactions that never pass through CORVEN, are not represented; the absence of a relationship is not proof that none exists.",
    };
  }
}
