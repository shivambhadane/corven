import { and, asc, count, desc, eq, lt, sql } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { schema } from "../../../db/client.js";
import type { ApprovalPolicy, ApprovalStatus, Risk } from "../types.js";

const t = schema;
const one = <R>(rows: R[]): R | null => rows[0] ?? null;

export type ApprovalRow = Omit<typeof t.approvalRequests.$inferSelect, "status" | "risk" | "policy" | "riskReasons"> & { status: ApprovalStatus; risk: Risk; policy: ApprovalPolicy; riskReasons: string[] };
export type DecisionRow = typeof t.approvalDecisions.$inferSelect;

export class ApprovalRepository {
  async getPolicy(tx: Executor, org: string) {
    return one(await tx.select().from(t.approvalPolicies).where(eq(t.approvalPolicies.organizationId, org)));
  }
  async upsertPolicy(tx: Executor, org: string, p: ApprovalPolicy, by: string) {
    return (await tx.insert(t.approvalPolicies).values({ organizationId: org, ...p, updatedBy: by }).onConflictDoUpdate({ target: t.approvalPolicies.organizationId, set: { ...p, updatedBy: by, updatedAt: new Date() } }).returning())[0]!;
  }

  /** Null when the incident already has a pending request (partial unique index). */
  async insert(tx: Executor, v: typeof t.approvalRequests.$inferInsert): Promise<ApprovalRow | null> {
    return one(await tx.insert(t.approvalRequests).values(v).onConflictDoNothing().returning()) as ApprovalRow | null;
  }
  async find(tx: Executor, org: string, id: string): Promise<ApprovalRow | null> {
    return one(await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.organizationId, org), eq(t.approvalRequests.id, id)))) as ApprovalRow | null;
  }
  async lock(tx: Executor, org: string, id: string): Promise<ApprovalRow | null> {
    return one(await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.organizationId, org), eq(t.approvalRequests.id, id))).for("update")) as ApprovalRow | null;
  }
  async findPendingForIncident(tx: Executor, org: string, incidentId: string): Promise<ApprovalRow | null> {
    return one(await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.organizationId, org), eq(t.approvalRequests.incidentId, incidentId), eq(t.approvalRequests.status, "pending")))) as ApprovalRow | null;
  }
  async findApprovedFor(tx: Executor, org: string, incidentId: string, planHash: string): Promise<ApprovalRow[]> {
    return (await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.organizationId, org), eq(t.approvalRequests.incidentId, incidentId), eq(t.approvalRequests.planHash, planHash), eq(t.approvalRequests.status, "approved"))).orderBy(desc(t.approvalRequests.decidedAt))) as ApprovalRow[];
  }
  async update(tx: Executor, org: string, id: string, patch: Partial<typeof t.approvalRequests.$inferInsert>): Promise<ApprovalRow> {
    return (await tx.update(t.approvalRequests).set({ ...patch, updatedAt: new Date() }).where(and(eq(t.approvalRequests.organizationId, org), eq(t.approvalRequests.id, id))).returning())[0] as ApprovalRow;
  }
  async list(tx: Executor, org: string, f: { status?: ApprovalStatus | undefined; incidentId?: string | undefined }, page: { limit: number; offset: number }) {
    const conds = [eq(t.approvalRequests.organizationId, org)];
    if (f.status) conds.push(eq(t.approvalRequests.status, f.status));
    if (f.incidentId) conds.push(eq(t.approvalRequests.incidentId, f.incidentId));
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(t.approvalRequests).where(and(...conds));
    const items = await tx.select().from(t.approvalRequests).where(and(...conds)).orderBy(desc(t.approvalRequests.createdAt), desc(t.approvalRequests.id)).limit(page.limit).offset(page.offset);
    return { items: items as ApprovalRow[], total: Number(n) };
  }
  /** Across all organizations: used by the background sweep, which acts per organization afterwards. */
  async expiredPending(tx: Executor, now: Date, limit = 100): Promise<ApprovalRow[]> {
    return (await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.status, "pending"), lt(t.approvalRequests.expiresAt, now))).limit(limit)) as ApprovalRow[];
  }
  async unsynced(tx: Executor, limit = 100): Promise<ApprovalRow[]> {
    return (await tx.select().from(t.approvalRequests).where(and(sql`${t.approvalRequests.status} <> 'pending'`, eq(t.approvalRequests.incidentSynced, false))).limit(limit)) as ApprovalRow[];
  }

  /** Null if this person already decided this request. */
  async addDecision(tx: Executor, v: typeof t.approvalDecisions.$inferInsert): Promise<DecisionRow | null> {
    return one(await tx.insert(t.approvalDecisions).values(v).onConflictDoNothing().returning());
  }
  listDecisions(tx: Executor, org: string, approvalId: string): Promise<DecisionRow[]> {
    return tx.select().from(t.approvalDecisions).where(and(eq(t.approvalDecisions.organizationId, org), eq(t.approvalDecisions.approvalId, approvalId))).orderBy(asc(t.approvalDecisions.createdAt), asc(t.approvalDecisions.id));
  }
  async addAudit(tx: Executor, v: typeof t.approvalAuditLogs.$inferInsert): Promise<void> {
    await tx.insert(t.approvalAuditLogs).values(v);
  }
  listAudit(tx: Executor, org: string, approvalId: string) {
    return tx.select().from(t.approvalAuditLogs).where(and(eq(t.approvalAuditLogs.organizationId, org), eq(t.approvalAuditLogs.approvalId, approvalId))).orderBy(asc(t.approvalAuditLogs.seq));
  }
}
