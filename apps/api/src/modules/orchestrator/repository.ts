import { and, asc, desc, eq, lte, or, sql, isNull } from "drizzle-orm";
import type { Executor } from "../../db/client.js";
import { schema } from "../../db/client.js";
import type { WorkflowStatus } from "./types.js";

const t = schema;
const one = <R>(rows: R[]): R | null => rows[0] ?? null;
export type WorkflowRow = Omit<typeof t.incidentWorkflows.$inferSelect, "status"> & { status: WorkflowStatus };

export class WorkflowRepository {
  async insert(tx: Executor, v: typeof t.incidentWorkflows.$inferInsert): Promise<WorkflowRow | null> {
    return one(await tx.insert(t.incidentWorkflows).values(v).onConflictDoNothing().returning()) as WorkflowRow | null;
  }
  async find(tx: Executor, org: string, id: string): Promise<WorkflowRow | null> {
    return one(await tx.select().from(t.incidentWorkflows).where(and(eq(t.incidentWorkflows.organizationId, org), eq(t.incidentWorkflows.id, id)))) as WorkflowRow | null;
  }
  async findForIncident(tx: Executor, org: string, incidentId: string): Promise<WorkflowRow | null> {
    return one(await tx.select().from(t.incidentWorkflows).where(and(eq(t.incidentWorkflows.organizationId, org), eq(t.incidentWorkflows.incidentId, incidentId)))) as WorkflowRow | null;
  }
  /**
   * Claims up to `limit` due workflows. A claim is a lease: another worker skips a workflow whose lease has not
   * expired, and a crashed worker's lease simply runs out. `SKIP LOCKED` keeps concurrent claimers from blocking.
   */
  async claimDue(tx: Executor, now: Date, leaseUntil: Date, limit: number): Promise<WorkflowRow[]> {
    const rows = await tx.execute(sql`
      update incident_workflows w set lease_until = ${leaseUntil}, updated_at = ${now}
      where w.id in (
        select id from incident_workflows
        where status in ('running','waiting') and next_run_at <= ${now} and (lease_until is null or lease_until <= ${now})
        order by next_run_at, id limit ${limit} for update skip locked)
      returning w.*`);
    const list = rows.rows as Array<Record<string, unknown>>;
    if (list.length === 0) return [];
    const ids = list.map((r) => r.id as string);
    return (await tx.select().from(t.incidentWorkflows).where(sql`${t.incidentWorkflows.id} in ${ids}`).orderBy(asc(t.incidentWorkflows.nextRunAt))) as WorkflowRow[];
  }
  async claimOne(tx: Executor, org: string, id: string, now: Date, leaseUntil: Date): Promise<WorkflowRow | null> {
    const rows = await tx.update(t.incidentWorkflows).set({ leaseUntil, updatedAt: now }).where(and(eq(t.incidentWorkflows.organizationId, org), eq(t.incidentWorkflows.id, id), sql`${t.incidentWorkflows.status} in ('running','waiting')`, or(isNull(t.incidentWorkflows.leaseUntil), lte(t.incidentWorkflows.leaseUntil, now)))).returning();
    return one(rows) as WorkflowRow | null;
  }
  async update(tx: Executor, id: string, patch: Partial<typeof t.incidentWorkflows.$inferInsert>): Promise<WorkflowRow> {
    return (await tx.update(t.incidentWorkflows).set({ ...patch, updatedAt: new Date(), version: sql`${t.incidentWorkflows.version} + 1` } as never).where(eq(t.incidentWorkflows.id, id)).returning())[0] as WorkflowRow;
  }
  async addEvent(tx: Executor, org: string, workflowId: string, type: string, detail: Record<string, unknown> = {}): Promise<void> {
    await tx.insert(t.workflowEvents).values({ organizationId: org, workflowId, type, detail: detail as never });
  }
  listEvents(tx: Executor, org: string, workflowId: string) {
    return tx.select().from(t.workflowEvents).where(and(eq(t.workflowEvents.organizationId, org), eq(t.workflowEvents.workflowId, workflowId))).orderBy(asc(t.workflowEvents.seq));
  }
  async list(tx: Executor, org: string, limit: number) {
    return (await tx.select().from(t.incidentWorkflows).where(eq(t.incidentWorkflows.organizationId, org)).orderBy(desc(t.incidentWorkflows.createdAt)).limit(limit)) as WorkflowRow[];
  }
}
