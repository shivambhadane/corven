import { randomUUID } from "node:crypto";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { systemPrincipal } from "../../../auth/system.js";
import { canonicalHash } from "../../../common/canonical.js";
import type { Database } from "../../../db/client.js";
import { AppError } from "../../../errors.js";
import type { IncidentService } from "../../incident-management/services/incident.service.js";
import type { ArkivClient, EthereumAnchorClient } from "../adapters/anchors.js";
import { backoffMs, classifyArkivError, MAX_ARKIV_ATTEMPTS } from "../adapters/arkiv/errors.js";
import { RABDI_CHAIN_ID } from "../adapters/arkiv/config.js";
import type { ArkivExpected } from "../adapters/arkiv/entity.js";
import { collectIncident, EVIDENCE_LIMITATIONS, notesPrefixHash, timelinePrefixHash } from "../core/collect.js";
import { sealedVsCurrent } from "../core/consistency.js";
import { evidenceInvalid, evidenceNotFound, incidentNotFound, sequenceConflict, targetNotConfigured } from "../errors.js";
import type { AnchorRow, EvidenceRepository, EvidenceRow } from "../repositories.js";
import { EVIDENCE_SCHEMA_VERSION, type AnchorTarget, type RequestMeta } from "../types.js";

/** Fixed audit identity for the incident events Evidence writes. */
export const EVIDENCE_ACTOR_ID = "00000000-0000-4000-8000-0000000e71de";

export interface EvidenceConfig {
  arkiv: ArkivClient | null;
  /** Why the Arkiv client is absent (disabled, not configured), for status reporting. Never contains secrets. */
  arkivState?: { state: "disabled" | "not_configured" | "configured"; reason?: string; missing?: string[] };
  /** Safe structured logging: event name and non-secret fields only. */
  log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  ethereum: EthereumAnchorClient | null;
  /** Blocks on top of the including block before an Ethereum anchor counts. */
  requiredConfirmations: number;
  now: () => Date;
}
export const defaultEvidenceConfig = (over: Partial<EvidenceConfig> = {}): EvidenceConfig => ({ arkiv: null, ethereum: null, requiredConfirmations: 3, now: () => new Date(), ...over });

export interface VerificationStep {
  name: string;
  result: "passed" | "failed" | "unavailable";
  detail?: unknown;
}

const ARKIV_CLAIM_STALE_MS = 2 * 60_000;
const expectedOf = (r: EvidenceRow): ArkivExpected => ({
  evidenceId: r.id, incidentId: r.incidentId, organizationId: r.organizationId, contentHash: r.contentHash, previousHash: r.previousHash,
  schemaVersion: r.schemaVersion, sequence: r.sequence, createdAt: r.createdAt.toISOString(),
});
const actorType = (p: Principal) => (p.role === "system" ? "system" : "human") as "human" | "system";
const safeError = (e: unknown) => (e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 200) : "failed");

/**
 * Creates and checks tamper-evident incident records.
 *
 * - generate: reads the incident and everything the other modules recorded
 *   about it, read only, in one consistent snapshot; builds a schema-versioned
 *   canonical document; seals it with its SHA-256 and links it to the previous
 *   record of the same incident (hash chain).
 * - verify: recomputes the hash, checks the chain, checks that everything sealed
 *   is still present and unchanged in the append-only sources, and re-checks
 *   external anchors. Internal failures make the record `invalid` (terminal).
 * - anchor: publishes only the hash and identifiers to Arkiv and Ethereum. An
 *   anchor is confirmed only after read-back (Arkiv) or after the transaction is
 *   mined, successful, carries the hash and has enough confirmations (Ethereum).
 *   Anchoring problems never invalidate the internal record.
 */
export class EvidenceService {
  constructor(
    private readonly db: Database,
    private readonly repo: EvidenceRepository,
    private readonly incidents: IncidentService,
    private readonly cfg: EvidenceConfig,
  ) {}

  // ------------------------------------------------------------------ generate

  async generate(p: Principal, incidentId: string, meta: RequestMeta = {}): Promise<EvidenceRow> {
    assertCan(p, "evidence:generate");
    const org = p.organizationId;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const row = await this.db.transaction(
          async (tx) => {
            const content = await collectIncident(tx, org, incidentId);
            if (!content) throw incidentNotFound();
            const prev = await this.repo.latest(tx, org, incidentId);
            const id = randomUUID();
            const now = this.cfg.now();
            const document = {
              schemaVersion: EVIDENCE_SCHEMA_VERSION, evidenceId: id, organizationId: org, incidentId, sequence: (prev?.sequence ?? 0) + 1,
              previous: prev ? { evidenceId: prev.id, contentHash: prev.contentHash } : null, generatedAt: now.toISOString(),
              generatedBy: { id: p.actorId, type: actorType(p) }, ...content, limitations: [...EVIDENCE_LIMITATIONS],
            };
            return this.repo.insert(tx, {
              id, organizationId: org, incidentId, sequence: document.sequence, schemaVersion: EVIDENCE_SCHEMA_VERSION, previousEvidenceId: prev?.id ?? null, previousHash: prev?.contentHash ?? null,
              content: document as never, contentHash: canonicalHash(document), status: "sealed", createdBy: p.actorId, createdByType: actorType(p), createdAt: now,
            });
          },
          { isolationLevel: "repeatable read", accessMode: "read write" },
        );
        // Best effort: the record exists either way. The timeline entry is idempotent.
        await this.incidents.recordExternalEvent(systemPrincipal(org, EVIDENCE_ACTOR_ID), incidentId, { type: "evidence.generated", data: { evidenceId: row.id, sequence: row.sequence, contentHash: row.contentHash, schemaVersion: row.schemaVersion }, idempotencyKey: `evidence:${row.id}` }, meta).catch(() => undefined);
        return row;
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "23505" || code === "40001") continue; // concurrent generation: sequence taken, or serialization failure
        throw e;
      }
    }
    throw sequenceConflict();
  }

  // ------------------------------------------------------------------ read

  async get(p: Principal, id: string) {
    assertCan(p, "evidence:read");
    const record = await this.repo.find(this.db, p.organizationId, id);
    if (!record) throw evidenceNotFound();
    return { record, anchors: await this.repo.listAnchors(this.db, p.organizationId, id) };
  }

  async listForIncident(p: Principal, incidentId: string) {
    assertCan(p, "evidence:read");
    return this.repo.listForIncident(this.db, p.organizationId, incidentId);
  }

  async logs(p: Principal, id: string) {
    assertCan(p, "evidence:read");
    if (!(await this.repo.find(this.db, p.organizationId, id))) throw evidenceNotFound();
    return this.repo.listLogs(this.db, p.organizationId, id);
  }

  // ------------------------------------------------------------------ verify

  async verify(p: Principal, id: string) {
    assertCan(p, "evidence:verify");
    const org = p.organizationId;
    const record = await this.repo.find(this.db, org, id);
    if (!record) throw evidenceNotFound();
    const internal = await this.verifyInternal(record);
    const anchors = await this.refreshAnchors(record);
    const anchorSteps = anchors.steps;
    const internallyValid = internal.every((s) => s.result === "passed");
    const steps = [...internal, ...anchorSteps];

    await this.db.transaction(async (tx) => {
      await this.repo.addLog(tx, { organizationId: org, evidenceId: id, valid: internallyValid, checks: steps as never, actorId: p.actorId, actorType: actorType(p) });
      if (!internallyValid) await this.repo.setStatus(tx, org, id, "invalid", this.cfg.now());
      else await this.repo.setStatus(tx, org, id, this.statusAfter(record.status, anchors.rows), this.cfg.now());
    });
    return { valid: internallyValid, steps, anchors: anchors.rows, record: (await this.repo.find(this.db, org, id))! };
  }

  private statusAfter(current: EvidenceRow["status"], anchors: AnchorRow[]): EvidenceRow["status"] {
    if (anchors.length === 0) return current === "invalid" ? "invalid" : "sealed";
    if (anchors.every((a) => a.status === "confirmed")) return "verified";
    if (anchors.some((a) => a.status === "submitted")) return "anchor_pending";
    return "anchor_failed";
  }

  private async verifyInternal(r: EvidenceRow): Promise<VerificationStep[]> {
    const steps: VerificationStep[] = [];
    const recomputed = canonicalHash(r.content);
    steps.push({ name: "content_hash", result: recomputed === r.contentHash ? "passed" : "failed", detail: { stored: r.contentHash, recomputed } });
    steps.push({ name: "schema_version", result: r.schemaVersion === EVIDENCE_SCHEMA_VERSION ? "passed" : "failed", detail: { version: r.schemaVersion, supported: EVIDENCE_SCHEMA_VERSION } });

    if (!r.previousEvidenceId) {
      steps.push({ name: "chain", result: r.sequence === 1 ? "passed" : "failed", detail: r.sequence === 1 ? "first record" : "a record after the first has no predecessor" });
    } else {
      const prev = await this.repo.find(this.db, r.organizationId, r.previousEvidenceId);
      const ok = !!prev && prev.contentHash === r.previousHash && canonicalHash(prev.content) === prev.contentHash && prev.sequence === r.sequence - 1;
      steps.push({ name: "chain", result: ok ? "passed" : "failed", detail: { previous: r.previousEvidenceId, previousHash: r.previousHash } });
    }

    const doc = r.content as { evidenceId?: string; incidentId?: string; organizationId?: string; sequence?: number; timeline?: { eventCount?: number; timelineHash?: string }; notes?: { count?: number; contentHash?: string } };
    steps.push({ name: "binding", result: doc.evidenceId === r.id && doc.incidentId === r.incidentId && doc.organizationId === r.organizationId && doc.sequence === r.sequence ? "passed" : "failed" });

    try {
      const now = await this.db.transaction(async (tx) => ({
        content: await collectIncident(tx, r.organizationId, r.incidentId),
        timelinePrefix: await timelinePrefixHash(tx, r.organizationId, r.incidentId, doc.timeline?.eventCount ?? 0),
        notesPrefix: await notesPrefixHash(tx, r.organizationId, r.incidentId, doc.notes?.count ?? 0),
      }), { isolationLevel: "repeatable read", accessMode: "read only" });
      const mismatches = now.content ? sealedVsCurrent(r.content as never, now.content) : ["the incident no longer exists"];
      if (now.timelinePrefix !== doc.timeline?.timelineHash) mismatches.push("the sealed part of the incident timeline differs");
      if (now.notesPrefix !== doc.notes?.contentHash) mismatches.push("the sealed incident notes differ");
      steps.push({ name: "sources_unchanged", result: mismatches.length ? "failed" : "passed", detail: mismatches.length ? mismatches : "everything sealed is still present and unchanged in the source records" });
    } catch (e) {
      steps.push({ name: "sources_unchanged", result: "unavailable", detail: safeError(e) });
    }
    return steps;
  }

  // ------------------------------------------------------------------ anchor

  async anchor(p: Principal, id: string, targets: AnchorTarget[] = ["arkiv", "ethereum"]) {
    assertCan(p, "evidence:anchor");
    const org = p.organizationId;
    const record = await this.repo.find(this.db, org, id);
    if (!record) throw evidenceNotFound();
    if (record.status === "invalid") throw evidenceInvalid();
    for (const t of targets) if (!(t === "arkiv" ? this.cfg.arkiv : this.cfg.ethereum)) throw targetNotConfigured(t);
    // Never publish a hash that does not verify internally.
    const internal = await this.verifyInternal(record);
    if (internal.some((s) => s.result === "failed")) {
      await this.repo.setStatus(this.db, org, id, "invalid", this.cfg.now());
      throw evidenceInvalid();
    }
    const existing = new Map((await this.repo.listAnchors(this.db, org, id)).map((a) => [a.target, a]));

    for (const target of [...new Set(targets)]) {
      const prior = existing.get(target);
      if (target === "arkiv") {
        await this.attemptArkiv(record, prior, true); // a person asked: a failed anchor is retried now, whatever its backoff
        continue;
      }
      if (prior?.status === "confirmed" || prior?.status === "submitted") continue; // do not publish twice; refresh instead
      const attempts = (prior?.attempts ?? 0) + 1;
      try {
        {
          const eth = this.cfg.ethereum!;
          const { txHash } = await eth.submit(record.contentHash, { evidenceId: record.id, incidentId: record.incidentId, schemaVersion: record.schemaVersion, sequence: record.sequence });
          // Submitted is not anchored. It becomes confirmed only in refreshAnchors, after enough confirmations.
          await this.repo.upsertAnchor(this.db, { organizationId: org, evidenceId: id, target, status: "submitted", anchoredHash: record.contentHash, externalReference: txHash, chainId: eth.chainId, contractAddress: eth.contractAddress, requiredConfirmations: this.cfg.requiredConfirmations, confirmations: 0 }, attempts);
        }
      } catch (e) {
        await this.repo.upsertAnchor(this.db, { organizationId: org, evidenceId: id, target, status: "failed", anchoredHash: record.contentHash, error: safeError(e), chainId: this.cfg.ethereum!.chainId }, attempts);
      }
    }
    const refreshed = await this.refreshAnchors(record);
    await this.syncStatus(record, refreshed.rows);
    return { record: (await this.repo.find(this.db, org, id))!, anchors: refreshed.rows };
  }

  /** Re-reads external state for submitted and confirmed anchors. Pure observation plus recording what was seen. */
  async refresh(p: Principal, id: string) {
    assertCan(p, "evidence:anchor");
    const record = await this.repo.find(this.db, p.organizationId, id);
    if (!record) throw evidenceNotFound();
    const r = await this.refreshAnchors(record);
    await this.syncStatus(record, r.rows);
    return { record: (await this.repo.find(this.db, p.organizationId, id))!, anchors: r.rows, steps: r.steps };
  }

  // ------------------------------------------------------------------ Arkiv

  /**
   * One attempt to anchor on Arkiv, safe to repeat from any worker:
   *  1. atomically claim the anchor (nobody else is creating it, and it is not confirmed);
   *  2. publish, which reuses an existing entity for this evidence instead of creating a second one;
   *  3. record the entity key IMMEDIATELY, before reading back, so a crash or a database error afterwards cannot lose it;
   *  4. read the entity back and compare every field: only an exact match confirms.
   * A request being sent, or an entity being created, is never a confirmation.
   */
  private async attemptArkiv(record: EvidenceRow, prior: AnchorRow | undefined, force: boolean): Promise<void> {
    const arkiv = this.cfg.arkiv;
    if (!arkiv) return;
    const now = this.cfg.now();
    const expected = expectedOf(record);
    if (prior?.status === "confirmed") return;
    const due = prior?.status === "failed" && prior.retryable && prior.attempts < MAX_ARKIV_ATTEMPTS && (!prior.nextAttemptAt || prior.nextAttemptAt <= now);
    if (prior?.status === "failed" && !force && !due) return;
    if (prior?.status === "submitted" && prior.externalReference) {
      if (force || !prior.nextAttemptAt || prior.nextAttemptAt <= now) await this.confirmArkiv(record, prior, expected);
      return;
    }
    const claim = await this.repo.claimArkivAnchor(this.db, {
      organizationId: record.organizationId, evidenceId: record.id, anchoredHash: record.contentHash, chainId: RABDI_CHAIN_ID, now,
      staleBefore: new Date(now.getTime() - ARKIV_CLAIM_STALE_MS), allowFailed: force || due,
    });
    if (!claim) return; // confirmed, or another worker holds a fresh claim
    if (claim.externalReference) {
      await this.confirmArkiv(record, claim, expected);
      return;
    }
    this.cfg.log?.("arkiv.anchor.attempt", { evidenceId: record.id, attempt: claim.attempts });
    try {
      const published = await arkiv.publish({ evidenceId: record.id, contentHash: record.contentHash, schemaVersion: record.schemaVersion, sequence: record.sequence }, expected);
      await this.repo.markAnchor(this.db, claim.id, {
        externalReference: published.entityKey, externalTx: published.txHash ?? null, externalExpiresBlock: published.expiresAtBlock ? Number(published.expiresAtBlock) : null,
        status: "submitted", error: null, errorCode: null, chainId: RABDI_CHAIN_ID,
      });
      await this.confirmArkiv(record, { ...claim, externalReference: published.entityKey }, expected);
    } catch (e) {
      await this.failArkiv(claim, e);
    }
  }

  private async confirmArkiv(record: EvidenceRow, anchor: AnchorRow, expected: ArkivExpected): Promise<void> {
    const arkiv = this.cfg.arkiv!;
    try {
      const rb = await arkiv.readBack(anchor.externalReference!, expected);
      if (rb.outcome === "match") {
        await this.repo.markAnchor(this.db, anchor.id, { status: "confirmed", error: null, errorCode: null, retryable: true, nextAttemptAt: null, ...(rb.expiresAtBlock && /^\d+$/.test(rb.expiresAtBlock) ? { externalExpiresBlock: Number(rb.expiresAtBlock) } : {}) });
        this.cfg.log?.("arkiv.anchor.confirmed", { evidenceId: record.id, entityKey: anchor.externalReference! });
      } else if (rb.outcome === "not_found") {
        // Not visible yet (indexing delay) or gone. Never confirmed. Bounded: after the attempt limit it becomes a visible failure.
        const attempts = anchor.attempts + 1;
        const exhausted = attempts >= MAX_ARKIV_ATTEMPTS;
        await this.repo.markAnchor(this.db, anchor.id, exhausted
          ? { status: "failed", attempts, retryable: false, errorCode: "ARKIV_NOT_INDEXED", error: "The entity could not be read back from Arkiv after repeated attempts", nextAttemptAt: null }
          : { status: "submitted", attempts, errorCode: "ARKIV_NOT_INDEXED", error: "Waiting for the entity to become readable", nextAttemptAt: new Date(this.cfg.now().getTime() + backoffMs(attempts, "ARKIV_NOT_INDEXED")) });
      } else {
        // The network returned something that is not what CORVEN sealed. Permanent: it is not retried into agreement.
        const code = rb.outcome === "mismatch" ? "ARKIV_READBACK_MISMATCH" : "ARKIV_MALFORMED_ENTITY";
        await this.repo.markAnchor(this.db, anchor.id, { status: "failed", retryable: false, errorCode: code, error: rb.outcome === "mismatch" ? `Read-back from Arkiv did not match the sealed record (${rb.field})` : `The Arkiv entity is malformed (${rb.field})`, nextAttemptAt: null });
        this.cfg.log?.("arkiv.anchor.rejected", { evidenceId: record.id, errorCode: code, field: rb.field });
      }
    } catch (e) {
      await this.failArkiv(anchor, e);
    }
  }

  private async failArkiv(anchor: AnchorRow, e: unknown): Promise<void> {
    const err = classifyArkivError(e);
    const attempts = anchor.attempts;
    const retryable = err.retryable && attempts < MAX_ARKIV_ATTEMPTS;
    this.cfg.log?.("arkiv.anchor.failed", { evidenceId: anchor.evidenceId, errorCode: err.code, retryable, attempt: attempts });
    await this.repo.markAnchor(this.db, anchor.id, {
      status: "failed", error: err.message, errorCode: err.code, retryable,
      nextAttemptAt: retryable ? new Date(this.cfg.now().getTime() + backoffMs(attempts, err.code)) : null,
    });
  }

  /** Re-reads one Arkiv anchor for verification. Confirmed anchors never change status here: a disagreement is reported, not rewritten. */
  private async checkArkiv(record: EvidenceRow, a: AnchorRow): Promise<VerificationStep> {
    const arkiv = this.cfg.arkiv!;
    try {
      const rb = await arkiv.readBack(a.externalReference!, expectedOf(record));
      if (rb.outcome === "match") {
        if (a.status !== "confirmed") await this.confirmArkiv(record, a, expectedOf(record));
        return { name: "anchor_arkiv", result: "passed", detail: { entityKey: a.externalReference } };
      }
      if (rb.outcome === "not_found") {
        if (a.status === "confirmed") return { name: "anchor_arkiv", result: "failed", detail: "the published record is missing or its hash differs (it may have expired or been deleted; the anchor remains recorded as it was confirmed)" };
        return { name: "anchor_arkiv", result: "unavailable", detail: "the entity is not readable yet" };
      }
      if (a.status !== "confirmed") await this.confirmArkiv(record, a, expectedOf(record));
      return { name: "anchor_arkiv", result: "failed", detail: rb.outcome === "mismatch" ? `the published record differs from the sealed record (${rb.field})` : `the published record is malformed (${rb.field})` };
    } catch (e) {
      return { name: "anchor_arkiv", result: "unavailable", detail: classifyArkivError(e).message };
    }
  }

  /** Live connectivity check. Reports disabled / not configured / unavailable / operational; configuration alone is never "operational". */
  async arkivHealth(p: Principal) {
    assertCan(p, "evidence:anchor");
    const s = this.cfg.arkivState;
    if (s?.state === "disabled") return { status: "disabled" as const, reason: s.reason ?? "disabled", health: null };
    if (!this.cfg.arkiv) return { status: "not_configured" as const, reason: s?.reason ?? "Arkiv is not configured", missing: s?.missing ?? [], health: null };
    const h = this.cfg.arkiv.health ? await this.cfg.arkiv.health() : null;
    return { status: h ? (h.state === "operational" ? ("operational" as const) : ("unavailable" as const)) : ("operational" as const), health: h };
  }

  /** Counts for operators. Organization-scoped; contains no secrets and no incident content. */
  async arkivStats(p: Principal) {
    assertCan(p, "evidence:read");
    const rows = await this.repo.anchorStats(this.db, p.organizationId, "arkiv");
    const n = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((a, r) => a + r.n, 0);
    const byCode: Record<string, number> = {};
    for (const r of rows) if (r.errorCode) byCode[r.errorCode] = (byCode[r.errorCode] ?? 0) + r.n;
    return {
      pending: n((r) => r.status === "submitted"), confirmed: n((r) => r.status === "confirmed"),
      failed: n((r) => r.status === "failed"), failedRetryable: n((r) => r.status === "failed" && r.retryable), failedPermanent: n((r) => r.status === "failed" && !r.retryable),
      totalAttempts: rows.reduce((a, r) => a + r.attempts, 0), errorsByCode: byCode,
      state: this.cfg.arkivState?.state ?? (this.cfg.arkiv ? "configured" : "not_configured"),
    };
  }

  /** The anchor for one evidence record, plus a live read of the entity (or its absence), validated against the sealed record. */
  async arkivEntity(p: Principal, evidenceId: string) {
    assertCan(p, "evidence:read");
    const record = await this.repo.find(this.db, p.organizationId, evidenceId);
    if (!record) throw evidenceNotFound();
    const anchor = (await this.repo.listAnchors(this.db, p.organizationId, evidenceId)).find((a) => a.target === "arkiv") ?? null;
    let live: { outcome: string; field?: string } | { outcome: "unavailable"; errorCode: string } | null = null;
    if (anchor?.externalReference && this.cfg.arkiv) {
      try {
        const rb = await this.cfg.arkiv.readBack(anchor.externalReference, expectedOf(record));
        live = rb.outcome === "match" ? { outcome: "match" } : rb.outcome === "not_found" ? { outcome: "not_found" } : { outcome: rb.outcome, field: rb.field };
      } catch (e) {
        live = { outcome: "unavailable", errorCode: classifyArkivError(e).code };
      }
    }
    return { anchor, live };
  }

  /** Entities Arkiv holds for an incident of this organization (the incident must have evidence here: another organization's id finds nothing). */
  async arkivIncident(p: Principal, incidentId: string) {
    assertCan(p, "evidence:read");
    const mine = await this.repo.listForIncident(this.db, p.organizationId, incidentId);
    if (mine.length === 0) throw evidenceNotFound();
    if (!this.cfg.arkiv?.queryByIncident) return { entities: [] as Array<{ entityKey: string; owner: string }>, queried: false };
    try {
      return { entities: await this.cfg.arkiv.queryByIncident(incidentId), queried: true };
    } catch (e) {
      throw new Error(classifyArkivError(e).message);
    }
  }

  /** Polls Ethereum confirmations for evidence with submitted anchors, and works through Arkiv anchors that are due. Safe to repeat. */
  async runMaintenance(): Promise<{ refreshed: number; arkiv: number }> {
    let arkiv = 0;
    if (this.cfg.arkiv) {
      const now = this.cfg.now();
      for (const { evidence, anchor } of await this.repo.arkivDue(this.db, now, new Date(now.getTime() - ARKIV_CLAIM_STALE_MS), MAX_ARKIV_ATTEMPTS)) {
        try {
          await this.attemptArkiv(evidence, anchor, false);
          await this.syncStatus(evidence, await this.repo.listAnchors(this.db, evidence.organizationId, evidence.id));
          arkiv++;
        } catch {
          /* the next pass tries again */
        }
      }
    }
    let refreshed = 0;
    for (const r of await this.repo.pendingAnchorEvidence(this.db)) {
      try {
        const x = await this.refreshAnchors(r);
        await this.syncStatus(r, x.rows);
        refreshed++;
      } catch {
        /* the next poll tries again */
      }
    }
    return { refreshed, arkiv };
  }

  private async syncStatus(record: EvidenceRow, anchors: AnchorRow[]) {
    const cur = (await this.repo.find(this.db, record.organizationId, record.id))!;
    if (cur.status === "invalid" || anchors.length === 0) return;
    const next: EvidenceRow["status"] = anchors.every((a) => a.status === "confirmed") ? (cur.status === "verified" ? "verified" : "anchored") : anchors.some((a) => a.status === "submitted") ? "anchor_pending" : "anchor_failed";
    if (next === cur.status) return;
    await this.repo.setStatus(this.db, record.organizationId, record.id, next);
    if (next === "anchored") {
      await this.incidents.recordExternalEvent(systemPrincipal(record.organizationId, EVIDENCE_ACTOR_ID), record.incidentId, { type: "evidence.generated", data: { evidenceId: record.id, anchored: true, contentHash: record.contentHash }, idempotencyKey: `evidence:${record.id}:anchored` }, {}).catch(() => undefined);
    }
  }

  private async refreshAnchors(record: EvidenceRow): Promise<{ rows: AnchorRow[]; steps: VerificationStep[] }> {
    const steps: VerificationStep[] = [];
    for (const a of await this.repo.listAnchors(this.db, record.organizationId, record.id)) {
      if (!a.externalReference || (a.status === "failed" && (a.target === "ethereum" || !a.retryable))) continue; // a permanent failure is not re-read into agreement
      const name = `anchor_${a.target}`;
      try {
        if (a.target === "arkiv" && this.cfg.arkiv) {
          steps.push(await this.checkArkiv(record, a));
        } else if (a.target === "ethereum" && this.cfg.ethereum) {
          const s = await this.cfg.ethereum.status(a.externalReference);
          const hashOk = s.dataContainsHash(record.contentHash);
          const required = a.requiredConfirmations ?? this.cfg.requiredConfirmations;
          if (s.state === "reverted" || (s.state === "mined" && !hashOk)) {
            if (a.status !== "confirmed") await this.repo.updateAnchor(this.db, a.id, { status: "failed", confirmations: s.confirmations, blockNumber: s.blockNumber, error: s.state === "reverted" ? "Transaction reverted" : "Transaction does not carry the evidence hash" });
            steps.push({ name, result: "failed", detail: s.state === "reverted" ? "transaction reverted" : "transaction does not carry the evidence hash" });
          } else if (s.state === "mined" && s.confirmations >= required) {
            if (a.status !== "confirmed") await this.repo.updateAnchor(this.db, a.id, { status: "confirmed", confirmations: s.confirmations, blockNumber: s.blockNumber, error: null });
            steps.push({ name, result: "passed", detail: { txHash: a.externalReference, blockNumber: s.blockNumber, confirmations: s.confirmations, required } });
          } else {
            await this.repo.updateAnchor(this.db, a.id, { confirmations: s.confirmations, blockNumber: s.blockNumber });
            steps.push({ name, result: "unavailable", detail: { state: s.state, confirmations: s.confirmations, required, note: "not yet anchored: submitted or not enough confirmations" } });
          }
        }
      } catch (e) {
        steps.push({ name, result: "unavailable", detail: safeError(e) });
      }
    }
    return { rows: await this.repo.listAnchors(this.db, record.organizationId, record.id), steps };
  }
}

export { AppError };
