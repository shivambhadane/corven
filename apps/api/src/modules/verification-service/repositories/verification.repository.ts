import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { schema } from "../../../db/client.js";
import type { RunStatus } from "../types.js";

const t = schema;
const one = <R>(rows: R[]): R | null => rows[0] ?? null;
export type RunRow = Omit<typeof t.verificationRuns.$inferSelect, "status"> & { status: RunStatus };
export type CheckRow = typeof t.verificationChecks.$inferSelect;

export class VerificationRepository {
  async insertRun(tx: Executor, v: typeof t.verificationRuns.$inferInsert): Promise<RunRow | null> {
    return one(await tx.insert(t.verificationRuns).values(v).onConflictDoNothing().returning()) as RunRow | null;
  }
  async findRun(tx: Executor, org: string, id: string): Promise<RunRow | null> {
    return one(await tx.select().from(t.verificationRuns).where(and(eq(t.verificationRuns.organizationId, org), eq(t.verificationRuns.id, id)))) as RunRow | null;
  }
  async findByKey(tx: Executor, org: string, key: string): Promise<RunRow | null> {
    return one(await tx.select().from(t.verificationRuns).where(and(eq(t.verificationRuns.organizationId, org), eq(t.verificationRuns.idempotencyKey, key)))) as RunRow | null;
  }
  async activeFor(tx: Executor, org: string, incidentId: string): Promise<RunRow | null> {
    return one(await tx.select().from(t.verificationRuns).where(and(eq(t.verificationRuns.organizationId, org), eq(t.verificationRuns.incidentId, incidentId), sql`${t.verificationRuns.status} in ('pending','running')`))) as RunRow | null;
  }
  async updateRun(tx: Executor, org: string, id: string, patch: Partial<typeof t.verificationRuns.$inferInsert>): Promise<RunRow> {
    return (await tx.update(t.verificationRuns).set({ ...patch, updatedAt: new Date() }).where(and(eq(t.verificationRuns.organizationId, org), eq(t.verificationRuns.id, id))).returning())[0] as RunRow;
  }
  async listForIncident(tx: Executor, org: string, incidentId: string): Promise<RunRow[]> {
    return (await tx.select().from(t.verificationRuns).where(and(eq(t.verificationRuns.organizationId, org), eq(t.verificationRuns.incidentId, incidentId))).orderBy(desc(t.verificationRuns.createdAt), desc(t.verificationRuns.id))) as RunRow[];
  }
  async unsynced(tx: Executor, limit = 100): Promise<RunRow[]> {
    return (await tx.select().from(t.verificationRuns).where(and(sql`${t.verificationRuns.status} in ('passed','failed','partially_verified','inconclusive')`, eq(t.verificationRuns.incidentSynced, false))).limit(limit)) as RunRow[];
  }
  async insertChecks(tx: Executor, rows: Array<typeof t.verificationChecks.$inferInsert>): Promise<void> {
    if (rows.length) await tx.insert(t.verificationChecks).values(rows);
  }
  listChecks(tx: Executor, org: string, runId: string): Promise<CheckRow[]> {
    return tx.select().from(t.verificationChecks).where(and(eq(t.verificationChecks.organizationId, org), eq(t.verificationChecks.runId, runId))).orderBy(asc(t.verificationChecks.seq));
  }
  /** Permissions of an agent on a resource in any status, to learn which actions it was able to perform before containment. */
  pairPermissions(tx: Executor, org: string, agentId: string, resourceId: string) {
    return tx.select().from(t.permissions).where(and(eq(t.permissions.organizationId, org), eq(t.permissions.agentId, agentId), eq(t.permissions.resourceId, resourceId)));
  }
  activePermissionsOn(tx: Executor, org: string, resourceId: string) {
    return tx.select().from(t.permissions).where(and(eq(t.permissions.organizationId, org), eq(t.permissions.resourceId, resourceId), eq(t.permissions.status, "active")));
  }
  enforcementFor(tx: Executor, org: string, incidentId: string, planHash: string) {
    return tx.select().from(t.enforcementActions).where(and(eq(t.enforcementActions.organizationId, org), eq(t.enforcementActions.incidentId, incidentId), eq(t.enforcementActions.planHash, planHash))).orderBy(asc(t.enforcementActions.createdAt));
  }
  modes(tx: Executor, org: string) {
    return tx.select().from(t.resourceEnforcement).where(eq(t.resourceEnforcement.organizationId, org));
  }
  async latestApproval(tx: Executor, org: string, incidentId: string, planHash: string) {
    return one(await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.organizationId, org), eq(t.approvalRequests.incidentId, incidentId), eq(t.approvalRequests.planHash, planHash), eq(t.approvalRequests.status, "approved"))).orderBy(desc(t.approvalRequests.decidedAt)).limit(1));
  }
}
