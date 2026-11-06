import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import {
  discoveryObservations,
  discoveryReconciliationResults,
  discoveryReviews,
  discoveryRuns,
  discoveryRuntimeEvents,
  discoverySources,
} from "../../../db/schema.js";
import type { DiscoveryRunStatus, DiscoverySourceType, ObservationStatus, ReconciliationOutcome } from "../types.js";

export type SourceRow = typeof discoverySources.$inferSelect;
export type RunRow = typeof discoveryRuns.$inferSelect;
export type ObservationRow = typeof discoveryObservations.$inferSelect;
export type ResultRow = typeof discoveryReconciliationResults.$inferSelect;
export type ReviewRow = typeof discoveryReviews.$inferSelect;

export interface Page {
  limit: number;
  offset: number;
}

/** Organization-scoped persistence for discovery state. Results and reviews have no update or delete. */
export class DiscoveryRepository {
  // ---- sources
  async insertSource(tx: Executor, v: { organizationId: string; type: DiscoverySourceType; name: string; configuration: Record<string, unknown>; freshnessWindowHours: number; createdBy: string | null }): Promise<SourceRow> {
    const [r] = await tx.insert(discoverySources).values(v).returning();
    return r!;
  }
  async findSource(tx: Executor, org: string, id: string): Promise<SourceRow | null> {
    return (await tx.select().from(discoverySources).where(and(eq(discoverySources.organizationId, org), eq(discoverySources.id, id))))[0] ?? null;
  }
  async listSources(tx: Executor, org: string, page: Page): Promise<{ items: SourceRow[]; total: number }> {
    const where = eq(discoverySources.organizationId, org);
    const items = await tx.select().from(discoverySources).where(where).orderBy(desc(discoverySources.createdAt), desc(discoverySources.id)).limit(page.limit).offset(page.offset);
    const t = await tx.select({ n: count() }).from(discoverySources).where(where);
    return { items, total: t[0]?.n ?? 0 };
  }
  async listAllSources(tx: Executor, org: string): Promise<SourceRow[]> {
    return tx.select().from(discoverySources).where(eq(discoverySources.organizationId, org)).orderBy(asc(discoverySources.name), asc(discoverySources.id));
  }
  async updateSource(tx: Executor, org: string, id: string, patch: Partial<{ name: string; enabled: boolean; configuration: Record<string, unknown>; freshnessWindowHours: number; lastSuccessfulRunAt: Date }>): Promise<SourceRow> {
    const [r] = await tx.update(discoverySources).set({ ...patch, updatedAt: new Date() }).where(and(eq(discoverySources.organizationId, org), eq(discoverySources.id, id))).returning();
    return r!;
  }

  // ---- runs
  async insertRun(tx: Executor, v: { organizationId: string; sourceId: string; sourceType: DiscoverySourceType; requestedBy: string | null }): Promise<RunRow> {
    const [r] = await tx.insert(discoveryRuns).values(v).returning();
    return r!;
  }
  async findRun(tx: Executor, org: string, id: string, opts: { forUpdate?: boolean } = {}): Promise<RunRow | null> {
    const q = tx.select().from(discoveryRuns).where(and(eq(discoveryRuns.organizationId, org), eq(discoveryRuns.id, id)));
    return (await (opts.forUpdate ? q.for("update") : q))[0] ?? null;
  }
  async listRuns(tx: Executor, org: string, f: { sourceId?: string | undefined; status?: DiscoveryRunStatus | undefined }, page: Page): Promise<{ items: RunRow[]; total: number }> {
    const conds: SQL[] = [eq(discoveryRuns.organizationId, org)];
    if (f.sourceId) conds.push(eq(discoveryRuns.sourceId, f.sourceId));
    if (f.status) conds.push(eq(discoveryRuns.status, f.status));
    const where = and(...conds);
    const items = await tx.select().from(discoveryRuns).where(where).orderBy(desc(discoveryRuns.createdAt), desc(discoveryRuns.id)).limit(page.limit).offset(page.offset);
    const t = await tx.select({ n: count() }).from(discoveryRuns).where(where);
    return { items, total: t[0]?.n ?? 0 };
  }
  async updateRun(tx: Executor, org: string, id: string, patch: Partial<Omit<RunRow, "id" | "organizationId" | "createdAt">>): Promise<RunRow> {
    const [r] = await tx.update(discoveryRuns).set(patch).where(and(eq(discoveryRuns.organizationId, org), eq(discoveryRuns.id, id))).returning();
    return r!;
  }

  // ---- observations
  /** Returns true if a new row was written; a retried run's duplicate record is ignored. */
  async insertObservation(tx: Executor, v: typeof discoveryObservations.$inferInsert): Promise<boolean> {
    const rows = await tx.insert(discoveryObservations).values(v).onConflictDoNothing().returning({ id: discoveryObservations.id });
    return rows.length > 0;
  }
  async findObservation(tx: Executor, org: string, id: string, opts: { forUpdate?: boolean } = {}): Promise<ObservationRow | null> {
    const q = tx.select().from(discoveryObservations).where(and(eq(discoveryObservations.organizationId, org), eq(discoveryObservations.id, id)));
    return (await (opts.forUpdate ? q.for("update") : q))[0] ?? null;
  }
  async listObservations(tx: Executor, org: string, runId: string, status: ObservationStatus | undefined, page: Page): Promise<{ items: ObservationRow[]; total: number }> {
    const conds: SQL[] = [eq(discoveryObservations.organizationId, org), eq(discoveryObservations.runId, runId)];
    if (status) conds.push(eq(discoveryObservations.processingStatus, status));
    const where = and(...conds);
    const items = await tx.select().from(discoveryObservations).where(where).orderBy(asc(discoveryObservations.externalRecordId), asc(discoveryObservations.id)).limit(page.limit).offset(page.offset);
    const t = await tx.select({ n: count() }).from(discoveryObservations).where(where);
    return { items, total: t[0]?.n ?? 0 };
  }
  async takeByStatus(tx: Executor, org: string, runId: string, status: ObservationStatus, limit: number): Promise<ObservationRow[]> {
    return tx.select().from(discoveryObservations)
      .where(and(eq(discoveryObservations.organizationId, org), eq(discoveryObservations.runId, runId), eq(discoveryObservations.processingStatus, status)))
      .orderBy(asc(discoveryObservations.externalRecordId), asc(discoveryObservations.id)).limit(limit);
  }
  async updateObservation(tx: Executor, org: string, id: string, patch: Partial<Pick<ObservationRow, "processingStatus" | "rejectionReason" | "normalized" | "resolved" | "reconciliationOutcome" | "dependencyId" | "registryOutcome">>): Promise<ObservationRow> {
    const [r] = await tx.update(discoveryObservations).set({ ...patch, updatedAt: new Date() }).where(and(eq(discoveryObservations.organizationId, org), eq(discoveryObservations.id, id))).returning();
    return r!;
  }
  async countByStatus(tx: Executor, org: string, runId: string): Promise<Record<string, number>> {
    const rows = await tx.select({ s: discoveryObservations.processingStatus, n: count() }).from(discoveryObservations)
      .where(and(eq(discoveryObservations.organizationId, org), eq(discoveryObservations.runId, runId))).groupBy(discoveryObservations.processingStatus);
    return Object.fromEntries(rows.map((r) => [r.s, r.n]));
  }
  async countRegistryOutcomes(tx: Executor, org: string, runId: string): Promise<Record<string, number>> {
    const rows = await tx.select({ s: discoveryObservations.registryOutcome, n: count() }).from(discoveryObservations)
      .where(and(eq(discoveryObservations.organizationId, org), eq(discoveryObservations.runId, runId))).groupBy(discoveryObservations.registryOutcome);
    return Object.fromEntries(rows.filter((r) => r.s).map((r) => [r.s!, r.n]));
  }
  async dependencyIdsSeenInRun(tx: Executor, org: string, runId: string): Promise<Set<string>> {
    const rows = await tx.select({ d: discoveryObservations.dependencyId }).from(discoveryObservations)
      .where(and(eq(discoveryObservations.organizationId, org), eq(discoveryObservations.runId, runId), sql`${discoveryObservations.dependencyId} is not null`));
    return new Set(rows.map((r) => r.d!));
  }

  // ---- results and reviews (append-only)
  async insertResult(tx: Executor, v: { organizationId: string; runId: string; observationId?: string | null; dependencyId?: string | null; outcome: ReconciliationOutcome; reason: string }): Promise<void> {
    await tx.insert(discoveryReconciliationResults).values({ ...v, observationId: v.observationId ?? null, dependencyId: v.dependencyId ?? null });
  }
  async listResults(tx: Executor, org: string, runId: string, outcome: ReconciliationOutcome | undefined, page: Page): Promise<{ items: ResultRow[]; total: number }> {
    const conds: SQL[] = [eq(discoveryReconciliationResults.organizationId, org), eq(discoveryReconciliationResults.runId, runId)];
    if (outcome) conds.push(eq(discoveryReconciliationResults.outcome, outcome));
    const where = and(...conds);
    const items = await tx.select().from(discoveryReconciliationResults).where(where).orderBy(asc(discoveryReconciliationResults.outcome), asc(discoveryReconciliationResults.createdAt), asc(discoveryReconciliationResults.id)).limit(page.limit).offset(page.offset);
    const t = await tx.select({ n: count() }).from(discoveryReconciliationResults).where(where);
    return { items, total: t[0]?.n ?? 0 };
  }
  async countResults(tx: Executor, org: string, runId: string): Promise<Record<string, number>> {
    const rows = await tx.select({ s: discoveryReconciliationResults.outcome, n: count() }).from(discoveryReconciliationResults)
      .where(and(eq(discoveryReconciliationResults.organizationId, org), eq(discoveryReconciliationResults.runId, runId))).groupBy(discoveryReconciliationResults.outcome);
    return Object.fromEntries(rows.map((r) => [r.s, r.n]));
  }
  async insertReview(tx: Executor, v: { organizationId: string; observationId: string; decision: "approve" | "reject" | "defer"; reviewerId: string; reason: string | null }): Promise<ReviewRow> {
    const [r] = await tx.insert(discoveryReviews).values(v).returning();
    return r!;
  }
  async listReviews(tx: Executor, org: string, observationId: string): Promise<ReviewRow[]> {
    return tx.select().from(discoveryReviews).where(and(eq(discoveryReviews.organizationId, org), eq(discoveryReviews.observationId, observationId))).orderBy(asc(discoveryReviews.reviewedAt), asc(discoveryReviews.id));
  }

  // ---- runtime events
  async insertEvent(tx: Executor, v: { organizationId: string; sourceId: string; eventId: string; payload: Record<string, unknown>; receivedBy: string | null }): Promise<boolean> {
    const rows = await tx.insert(discoveryRuntimeEvents).values(v).onConflictDoNothing().returning({ id: discoveryRuntimeEvents.id });
    return rows.length > 0;
  }
  /** Events not yet consumed, or already consumed by THIS run (so a retried collection sees the same events). */
  async eventsForRun(tx: Executor, org: string, sourceId: string, runId: string) {
    return tx.select().from(discoveryRuntimeEvents)
      .where(and(eq(discoveryRuntimeEvents.organizationId, org), eq(discoveryRuntimeEvents.sourceId, sourceId), or(isNull(discoveryRuntimeEvents.consumedRunId), eq(discoveryRuntimeEvents.consumedRunId, runId))))
      .orderBy(asc(discoveryRuntimeEvents.receivedAt), asc(discoveryRuntimeEvents.id));
  }
  async markEventsConsumed(tx: Executor, org: string, ids: string[], runId: string): Promise<void> {
    if (ids.length) await tx.update(discoveryRuntimeEvents).set({ consumedRunId: runId }).where(and(eq(discoveryRuntimeEvents.organizationId, org), inArray(discoveryRuntimeEvents.id, ids)));
  }
  async countPendingEvents(tx: Executor, org: string, sourceId: string): Promise<number> {
    const t = await tx.select({ n: count() }).from(discoveryRuntimeEvents).where(and(eq(discoveryRuntimeEvents.organizationId, org), eq(discoveryRuntimeEvents.sourceId, sourceId), isNull(discoveryRuntimeEvents.consumedRunId)));
    return t[0]?.n ?? 0;
  }
}
