import { and, asc, count, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { schema } from "../../../db/client.js";
import type { ActorType, AnalysisReference, Incident, IncidentStatus, ReferenceKind, Severity } from "../types.js";

const t = schema;
const one = <T>(rows: T[]): T | null => rows[0] ?? null;

export interface ListFilter {
  statuses?: IncidentStatus[] | undefined;
  severities?: Severity[] | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
  agentId?: string | undefined;
  assigneeId?: string | undefined;
}

export interface EventRow {
  id: string;
  seq: number;
  organizationId: string;
  incidentId: string;
  eventType: string;
  actorId: string;
  actorType: ActorType;
  data: Record<string, unknown>;
  correlationId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

/** All SQL for incidents. Every method takes the organization explicitly and filters on it. */
export class IncidentRepository {
  // ---- incidents
  async insert(tx: Executor, v: typeof t.incidents.$inferInsert): Promise<Incident | null> {
    const rows = await tx.insert(t.incidents).values(v).onConflictDoNothing().returning();
    return one(rows) as Incident | null;
  }

  async find(tx: Executor, org: string, id: string): Promise<Incident | null> {
    return one(await tx.select().from(t.incidents).where(and(eq(t.incidents.organizationId, org), eq(t.incidents.id, id)))) as Incident | null;
  }

  /** Row lock for the duration of the transaction: serializes concurrent changes to one incident. */
  async lock(tx: Executor, org: string, id: string): Promise<Incident | null> {
    return one(await tx.select().from(t.incidents).where(and(eq(t.incidents.organizationId, org), eq(t.incidents.id, id))).for("update")) as Incident | null;
  }

  async findByDetection(tx: Executor, org: string, source: string, reference: string): Promise<Incident | null> {
    return one(
      await tx.select().from(t.incidents).where(and(eq(t.incidents.organizationId, org), eq(t.incidents.detectionSource, source), eq(t.incidents.detectionReference, reference))),
    ) as Incident | null;
  }

  async update(tx: Executor, org: string, id: string, patch: Partial<typeof t.incidents.$inferInsert>): Promise<Incident> {
    const rows = await tx
      .update(t.incidents)
      .set({ ...patch, version: sql`${t.incidents.version} + 1`, updatedAt: new Date() })
      .where(and(eq(t.incidents.organizationId, org), eq(t.incidents.id, id)))
      .returning();
    return rows[0] as Incident;
  }

  async list(tx: Executor, org: string, f: ListFilter, page: { limit: number; offset: number }): Promise<{ items: Incident[]; total: number }> {
    const conds: SQL[] = [eq(t.incidents.organizationId, org)];
    if (f.statuses?.length) conds.push(inArray(t.incidents.status, f.statuses));
    if (f.severities?.length) conds.push(inArray(t.incidents.severity, f.severities));
    if (f.createdFrom) conds.push(gte(t.incidents.createdAt, f.createdFrom));
    if (f.createdTo) conds.push(lte(t.incidents.createdAt, f.createdTo));
    if (f.assigneeId) conds.push(eq(t.incidents.assigneeId, f.assigneeId));
    if (f.agentId) {
      conds.push(
        sql`exists (select 1 from ${t.incidentAgents} ia where ia.incident_id = ${t.incidents.id} and ia.organization_id = ${t.incidents.organizationId} and ia.agent_id = ${f.agentId})`,
      );
    }
    const where = and(...conds);
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(t.incidents).where(where);
    const items = await tx.select().from(t.incidents).where(where).orderBy(desc(t.incidents.createdAt), desc(t.incidents.id)).limit(page.limit).offset(page.offset);
    return { items: items as Incident[], total: Number(n) };
  }

  // ---- append-only history
  async addState(tx: Executor, v: typeof t.incidentStateHistory.$inferInsert) {
    return one(await tx.insert(t.incidentStateHistory).values(v).onConflictDoNothing().returning());
  }
  async findStateByKey(tx: Executor, org: string, incidentId: string, key: string) {
    return one(await tx.select().from(t.incidentStateHistory).where(and(eq(t.incidentStateHistory.organizationId, org), eq(t.incidentStateHistory.incidentId, incidentId), eq(t.incidentStateHistory.idempotencyKey, key))));
  }
  listStates(tx: Executor, org: string, incidentId: string) {
    return tx.select().from(t.incidentStateHistory).where(and(eq(t.incidentStateHistory.organizationId, org), eq(t.incidentStateHistory.incidentId, incidentId))).orderBy(asc(t.incidentStateHistory.createdAt), asc(t.incidentStateHistory.id));
  }

  /** Returns null when an event with the same idempotency key already exists. */
  async addEvent(tx: Executor, v: typeof t.incidentEvents.$inferInsert): Promise<EventRow | null> {
    return one(await tx.insert(t.incidentEvents).values(v).onConflictDoNothing().returning()) as EventRow | null;
  }
  async listEvents(tx: Executor, org: string, incidentId: string, page: { limit: number; offset: number }): Promise<{ items: EventRow[]; total: number }> {
    const where = and(eq(t.incidentEvents.organizationId, org), eq(t.incidentEvents.incidentId, incidentId));
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(t.incidentEvents).where(where);
    const items = await tx.select().from(t.incidentEvents).where(where).orderBy(asc(t.incidentEvents.seq)).limit(page.limit).offset(page.offset);
    return { items: items as EventRow[], total: Number(n) };
  }

  async addAudit(tx: Executor, v: typeof t.incidentAuditLogs.$inferInsert) {
    await tx.insert(t.incidentAuditLogs).values(v);
  }
  listAudit(tx: Executor, org: string, incidentId: string) {
    return tx.select().from(t.incidentAuditLogs).where(and(eq(t.incidentAuditLogs.organizationId, org), eq(t.incidentAuditLogs.incidentId, incidentId))).orderBy(asc(t.incidentAuditLogs.createdAt), asc(t.incidentAuditLogs.id));
  }

  // ---- associations
  async addAgent(tx: Executor, v: typeof t.incidentAgents.$inferInsert) {
    return one(await tx.insert(t.incidentAgents).values(v).onConflictDoNothing().returning());
  }
  listAgents(tx: Executor, org: string, incidentId: string) {
    return tx.select().from(t.incidentAgents).where(and(eq(t.incidentAgents.organizationId, org), eq(t.incidentAgents.incidentId, incidentId))).orderBy(asc(t.incidentAgents.createdAt), asc(t.incidentAgents.id));
  }
  async addResource(tx: Executor, v: typeof t.incidentResources.$inferInsert) {
    return one(await tx.insert(t.incidentResources).values(v).onConflictDoNothing().returning());
  }
  listResources(tx: Executor, org: string, incidentId: string) {
    return tx.select().from(t.incidentResources).where(and(eq(t.incidentResources.organizationId, org), eq(t.incidentResources.incidentId, incidentId))).orderBy(asc(t.incidentResources.createdAt), asc(t.incidentResources.id));
  }

  // ---- assignments and notes
  async addAssignment(tx: Executor, v: typeof t.incidentAssignments.$inferInsert) {
    return one(await tx.insert(t.incidentAssignments).values(v).returning());
  }
  listAssignments(tx: Executor, org: string, incidentId: string) {
    return tx.select().from(t.incidentAssignments).where(and(eq(t.incidentAssignments.organizationId, org), eq(t.incidentAssignments.incidentId, incidentId))).orderBy(asc(t.incidentAssignments.createdAt), asc(t.incidentAssignments.id));
  }
  async addNote(tx: Executor, v: typeof t.incidentNotes.$inferInsert) {
    return one(await tx.insert(t.incidentNotes).values(v).returning());
  }
  async listNotes(tx: Executor, org: string, incidentId: string, page: { limit: number; offset: number }) {
    const where = and(eq(t.incidentNotes.organizationId, org), eq(t.incidentNotes.incidentId, incidentId));
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(t.incidentNotes).where(where);
    const items = await tx.select().from(t.incidentNotes).where(where).orderBy(asc(t.incidentNotes.createdAt), asc(t.incidentNotes.id)).limit(page.limit).offset(page.offset);
    return { items, total: Number(n) };
  }

  // ---- analysis references
  async nextRefVersion(tx: Executor, org: string, incidentId: string, kind: ReferenceKind): Promise<number> {
    const [r] = await tx
      .select({ v: sql<number>`coalesce(max(${t.incidentAnalysisReferences.version}), 0)` })
      .from(t.incidentAnalysisReferences)
      .where(and(eq(t.incidentAnalysisReferences.organizationId, org), eq(t.incidentAnalysisReferences.incidentId, incidentId), eq(t.incidentAnalysisReferences.kind, kind)));
    return Number(r?.v ?? 0) + 1;
  }
  async addRef(tx: Executor, v: typeof t.incidentAnalysisReferences.$inferInsert): Promise<AnalysisReference> {
    const rows = await tx.insert(t.incidentAnalysisReferences).values(v).returning();
    return rows[0] as AnalysisReference;
  }
  async findRef(tx: Executor, org: string, incidentId: string, id: string): Promise<AnalysisReference | null> {
    return one(
      await tx.select().from(t.incidentAnalysisReferences).where(and(eq(t.incidentAnalysisReferences.organizationId, org), eq(t.incidentAnalysisReferences.incidentId, incidentId), eq(t.incidentAnalysisReferences.id, id))),
    ) as AnalysisReference | null;
  }
  async listRefs(tx: Executor, org: string, incidentId: string, kind?: ReferenceKind): Promise<AnalysisReference[]> {
    const conds = [eq(t.incidentAnalysisReferences.organizationId, org), eq(t.incidentAnalysisReferences.incidentId, incidentId)];
    if (kind) conds.push(eq(t.incidentAnalysisReferences.kind, kind));
    return (await tx.select().from(t.incidentAnalysisReferences).where(and(...conds)).orderBy(asc(t.incidentAnalysisReferences.kind), asc(t.incidentAnalysisReferences.version))) as AnalysisReference[];
  }
}
