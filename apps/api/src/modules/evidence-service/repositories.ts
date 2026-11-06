import { and, asc, desc, eq } from "drizzle-orm";
import type { Executor } from "../../db/client.js";
import { schema } from "../../db/client.js";
import type { EvidenceStatus } from "./types.js";

const t = schema;
const one = <R>(rows: R[]): R | null => rows[0] ?? null;
export type EvidenceRow = Omit<typeof t.evidenceRecords.$inferSelect, "status"> & { status: EvidenceStatus };
export type AnchorRow = typeof t.evidenceAnchors.$inferSelect;

export class EvidenceRepository {
  async insert(tx: Executor, v: typeof t.evidenceRecords.$inferInsert): Promise<EvidenceRow> {
    return (await tx.insert(t.evidenceRecords).values(v).returning())[0] as EvidenceRow;
  }
  async latest(tx: Executor, org: string, incidentId: string): Promise<EvidenceRow | null> {
    return one(await tx.select().from(t.evidenceRecords).where(and(eq(t.evidenceRecords.organizationId, org), eq(t.evidenceRecords.incidentId, incidentId))).orderBy(desc(t.evidenceRecords.sequence)).limit(1)) as EvidenceRow | null;
  }
  async find(tx: Executor, org: string, id: string): Promise<EvidenceRow | null> {
    return one(await tx.select().from(t.evidenceRecords).where(and(eq(t.evidenceRecords.organizationId, org), eq(t.evidenceRecords.id, id)))) as EvidenceRow | null;
  }
  async listForIncident(tx: Executor, org: string, incidentId: string): Promise<EvidenceRow[]> {
    return (await tx.select().from(t.evidenceRecords).where(and(eq(t.evidenceRecords.organizationId, org), eq(t.evidenceRecords.incidentId, incidentId))).orderBy(asc(t.evidenceRecords.sequence))) as EvidenceRow[];
  }
  async setStatus(tx: Executor, org: string, id: string, status: EvidenceStatus, verifiedAt?: Date): Promise<void> {
    await tx.update(t.evidenceRecords).set({ status, updatedAt: new Date(), ...(verifiedAt ? { lastVerifiedAt: verifiedAt } : {}) }).where(and(eq(t.evidenceRecords.organizationId, org), eq(t.evidenceRecords.id, id)));
  }
  /** Evidence with submitted anchors, across organizations, for the background confirmation poll. */
  async pendingAnchorEvidence(tx: Executor, limit = 50): Promise<EvidenceRow[]> {
    const ids = await tx.selectDistinct({ id: t.evidenceAnchors.evidenceId, org: t.evidenceAnchors.organizationId }).from(t.evidenceAnchors).where(eq(t.evidenceAnchors.status, "submitted")).limit(limit);
    const out: EvidenceRow[] = [];
    for (const i of ids) { const r = await this.find(tx, i.org, i.id); if (r) out.push(r); }
    return out;
  }
  listAnchors(tx: Executor, org: string, evidenceId: string): Promise<AnchorRow[]> {
    return tx.select().from(t.evidenceAnchors).where(and(eq(t.evidenceAnchors.organizationId, org), eq(t.evidenceAnchors.evidenceId, evidenceId))).orderBy(asc(t.evidenceAnchors.target));
  }
  async upsertAnchor(tx: Executor, v: typeof t.evidenceAnchors.$inferInsert, attempts: number): Promise<AnchorRow> {
    return (await tx.insert(t.evidenceAnchors).values(v).onConflictDoUpdate({ target: [t.evidenceAnchors.evidenceId, t.evidenceAnchors.target], set: { status: v.status, externalReference: v.externalReference ?? null, blockNumber: v.blockNumber ?? null, confirmations: v.confirmations ?? null, requiredConfirmations: v.requiredConfirmations ?? null, error: v.error ?? null, attempts, updatedAt: new Date() } }).returning())[0]!;
  }
  async updateAnchor(tx: Executor, id: string, patch: Partial<typeof t.evidenceAnchors.$inferInsert>): Promise<void> {
    await tx.update(t.evidenceAnchors).set({ ...patch, updatedAt: new Date() }).where(eq(t.evidenceAnchors.id, id));
  }
  async addLog(tx: Executor, v: typeof t.evidenceVerificationLogs.$inferInsert): Promise<void> {
    await tx.insert(t.evidenceVerificationLogs).values(v);
  }
  listLogs(tx: Executor, org: string, evidenceId: string) {
    return tx.select().from(t.evidenceVerificationLogs).where(and(eq(t.evidenceVerificationLogs.organizationId, org), eq(t.evidenceVerificationLogs.evidenceId, evidenceId))).orderBy(asc(t.evidenceVerificationLogs.createdAt), asc(t.evidenceVerificationLogs.id));
  }
}
