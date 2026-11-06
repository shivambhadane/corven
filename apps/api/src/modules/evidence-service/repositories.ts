import { and, asc, desc, eq, sql } from "drizzle-orm";
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

  /**
   * Atomically takes the right to attempt an Arkiv anchor. Succeeds (returns the row) only if there is no anchor yet, or the
   * existing one is failed (and the caller may retry), or it is an abandoned in-flight claim. A confirmed anchor, an anchor that
   * already has an external reference, and a fresh claim held by someone else are never taken.
   */
  async claimArkivAnchor(tx: Executor, v: { organizationId: string; evidenceId: string; anchoredHash: string; chainId: number; now: Date; staleBefore: Date; allowFailed: boolean }): Promise<AnchorRow | null> {
    const failedOk = v.allowFailed ? sql`or ${t.evidenceAnchors.status} = 'failed'` : sql``;
    const rows = await tx
      .insert(t.evidenceAnchors)
      .values({ organizationId: v.organizationId, evidenceId: v.evidenceId, target: "arkiv", status: "submitted", anchoredHash: v.anchoredHash, chainId: v.chainId, attempts: 1, lastAttemptAt: v.now, retryable: true })
      .onConflictDoUpdate({
        target: [t.evidenceAnchors.evidenceId, t.evidenceAnchors.target],
        set: { status: "submitted", attempts: sql`${t.evidenceAnchors.attempts} + 1`, lastAttemptAt: v.now, nextAttemptAt: null, updatedAt: v.now },
        setWhere: sql`(${t.evidenceAnchors.status} = 'submitted' and ${t.evidenceAnchors.externalReference} is null and ${t.evidenceAnchors.lastAttemptAt} < ${v.staleBefore}) ${failedOk}`,
      })
      .returning();
    return rows[0] ?? null;
  }
  async markAnchor(tx: Executor, id: string, patch: Partial<typeof t.evidenceAnchors.$inferInsert>): Promise<void> {
    await tx.update(t.evidenceAnchors).set({ ...patch, updatedAt: new Date() }).where(eq(t.evidenceAnchors.id, id));
  }
  /** Arkiv anchors that need attention now: failed and retryable and due, or created and still unconfirmed and due, or abandoned claims. */
  async arkivDue(tx: Executor, now: Date, staleBefore: Date, maxAttempts: number, limit = 25): Promise<Array<{ evidence: EvidenceRow; anchor: AnchorRow }>> {
    const rows = await tx
      .select({ anchor: t.evidenceAnchors })
      .from(t.evidenceAnchors)
      .where(and(eq(t.evidenceAnchors.target, "arkiv"), sql`(
          (${t.evidenceAnchors.status} = 'failed' and ${t.evidenceAnchors.retryable} and ${t.evidenceAnchors.attempts} < ${maxAttempts} and (${t.evidenceAnchors.nextAttemptAt} is null or ${t.evidenceAnchors.nextAttemptAt} <= ${now}))
       or (${t.evidenceAnchors.status} = 'submitted' and ${t.evidenceAnchors.externalReference} is not null and (${t.evidenceAnchors.nextAttemptAt} is null or ${t.evidenceAnchors.nextAttemptAt} <= ${now}))
       or (${t.evidenceAnchors.status} = 'submitted' and ${t.evidenceAnchors.externalReference} is null and ${t.evidenceAnchors.lastAttemptAt} < ${staleBefore}))`))
      .limit(limit);
    const out: Array<{ evidence: EvidenceRow; anchor: AnchorRow }> = [];
    for (const r of rows) {
      const ev = await this.find(tx, r.anchor.organizationId, r.anchor.evidenceId);
      if (ev) out.push({ evidence: ev, anchor: r.anchor });
    }
    return out;
  }
  /** Counts for observability, scoped to one organization. */
  async anchorStats(tx: Executor, org: string, target: string) {
    const rows = await tx.select({ status: t.evidenceAnchors.status, errorCode: t.evidenceAnchors.errorCode, retryable: t.evidenceAnchors.retryable, n: sql<number>`count(*)::int`, attempts: sql<number>`coalesce(sum(${t.evidenceAnchors.attempts}),0)::int` })
      .from(t.evidenceAnchors).where(and(eq(t.evidenceAnchors.organizationId, org), eq(t.evidenceAnchors.target, target))).groupBy(t.evidenceAnchors.status, t.evidenceAnchors.errorCode, t.evidenceAnchors.retryable);
    return rows;
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
