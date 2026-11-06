import { randomUUID } from "node:crypto";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { systemPrincipal } from "../../../auth/system.js";
import { canonicalHash } from "../../../common/canonical.js";
import type { Database } from "../../../db/client.js";
import { AppError } from "../../../errors.js";
import type { IncidentService } from "../../incident-management/services/incident.service.js";
import type { ArkivClient, EthereumAnchorClient } from "../adapters/anchors.js";
import { collectIncident, EVIDENCE_LIMITATIONS, notesPrefixHash, timelinePrefixHash } from "../core/collect.js";
import { sealedVsCurrent } from "../core/consistency.js";
import { evidenceInvalid, evidenceNotFound, incidentNotFound, sequenceConflict, targetNotConfigured } from "../errors.js";
import type { AnchorRow, EvidenceRepository, EvidenceRow } from "../repositories.js";
import { EVIDENCE_SCHEMA_VERSION, type AnchorPayload, type AnchorTarget, type RequestMeta } from "../types.js";

/** Fixed audit identity for the incident events Evidence writes. */
export const EVIDENCE_ACTOR_ID = "00000000-0000-4000-8000-0000000e71de";

export interface EvidenceConfig {
  arkiv: ArkivClient | null;
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
    const payload: AnchorPayload = { evidenceId: record.id, contentHash: record.contentHash, schemaVersion: record.schemaVersion, sequence: record.sequence };
    const existing = new Map((await this.repo.listAnchors(this.db, org, id)).map((a) => [a.target, a]));

    for (const target of [...new Set(targets)]) {
      const prior = existing.get(target);
      if (prior?.status === "confirmed" || prior?.status === "submitted") continue; // do not publish twice; refresh instead
      const attempts = (prior?.attempts ?? 0) + 1;
      try {
        if (target === "arkiv") {
          const { entityKey } = await this.cfg.arkiv!.publish(payload);
          const back = await this.cfg.arkiv!.fetch(entityKey);
          const ok = back?.contentHash === record.contentHash && back.evidenceId === record.id;
          await this.repo.upsertAnchor(this.db, { organizationId: org, evidenceId: id, target, status: ok ? "confirmed" : "failed", anchoredHash: record.contentHash, externalReference: entityKey, error: ok ? null : "Read-back from Arkiv did not match the published hash" }, attempts);
        } else {
          const eth = this.cfg.ethereum!;
          const { txHash } = await eth.submit(record.contentHash, { evidenceId: record.id, incidentId: record.incidentId, schemaVersion: record.schemaVersion, sequence: record.sequence });
          // Submitted is not anchored. It becomes confirmed only in refreshAnchors, after enough confirmations.
          await this.repo.upsertAnchor(this.db, { organizationId: org, evidenceId: id, target, status: "submitted", anchoredHash: record.contentHash, externalReference: txHash, chainId: eth.chainId, contractAddress: eth.contractAddress, requiredConfirmations: this.cfg.requiredConfirmations, confirmations: 0 }, attempts);
        }
      } catch (e) {
        await this.repo.upsertAnchor(this.db, { organizationId: org, evidenceId: id, target, status: "failed", anchoredHash: record.contentHash, error: safeError(e), ...(target === "ethereum" ? { chainId: this.cfg.ethereum!.chainId } : {}) }, attempts);
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

  /** Polls Ethereum confirmations for evidence with submitted anchors. Safe to repeat. */
  async runMaintenance(): Promise<{ refreshed: number }> {
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
    return { refreshed };
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
      if (a.status === "failed" || !a.externalReference) continue;
      const name = `anchor_${a.target}`;
      try {
        if (a.target === "arkiv" && this.cfg.arkiv) {
          const back = await this.cfg.arkiv.fetch(a.externalReference);
          const ok = back?.contentHash === record.contentHash && back.evidenceId === record.id;
          steps.push({ name, result: ok ? "passed" : "failed", detail: ok ? { entityKey: a.externalReference } : "the published record is missing or its hash differs" });
          if (!ok && a.status === "confirmed") steps[steps.length - 1]!.detail = "the published record is missing or its hash differs (the anchor remains recorded as it was confirmed)";
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
