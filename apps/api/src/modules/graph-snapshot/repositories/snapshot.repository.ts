import { and, count, desc, eq } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { graphSnapshots } from "../../../db/schema.js";
import type { SnapshotPayload } from "../core/snapshot.js";

export interface SnapshotMeta {
  id: string;
  organizationId: string;
  label: string | null;
  incidentId: string | null;
  createdBy: string | null;
  nodeCount: number;
  edgeCount: number;
  contentHash: string;
  builtAt: Date;
  createdAt: Date;
}
export interface SnapshotRecord extends SnapshotMeta {
  payload: SnapshotPayload;
}

const meta = (r: typeof graphSnapshots.$inferSelect): SnapshotMeta => ({
  id: r.id, organizationId: r.organizationId, label: r.label, incidentId: r.incidentId, createdBy: r.createdBy,
  nodeCount: r.nodeCount, edgeCount: r.edgeCount, contentHash: r.contentHash, builtAt: r.builtAt, createdAt: r.createdAt,
});

/** Organization-scoped. There is no update or delete method: snapshots are immutable. */
export class SnapshotRepository {
  async insert(tx: Executor, v: Omit<SnapshotRecord, "id" | "createdAt">): Promise<SnapshotMeta> {
    const [row] = await tx.insert(graphSnapshots).values({ ...v, payload: v.payload as never }).returning();
    return meta(row!);
  }

  async find(tx: Executor, organizationId: string, id: string): Promise<SnapshotRecord | null> {
    const rows = await tx.select().from(graphSnapshots).where(and(eq(graphSnapshots.organizationId, organizationId), eq(graphSnapshots.id, id)));
    return rows[0] ? { ...meta(rows[0]), payload: rows[0].payload as SnapshotPayload } : null;
  }

  async list(tx: Executor, organizationId: string, page: { limit: number; offset: number }, incidentId?: string): Promise<{ items: SnapshotMeta[]; total: number }> {
    const where = incidentId ? and(eq(graphSnapshots.organizationId, organizationId), eq(graphSnapshots.incidentId, incidentId)) : eq(graphSnapshots.organizationId, organizationId);
    const rows = await tx
      .select({
        id: graphSnapshots.id, organizationId: graphSnapshots.organizationId, label: graphSnapshots.label, incidentId: graphSnapshots.incidentId,
        createdBy: graphSnapshots.createdBy, nodeCount: graphSnapshots.nodeCount, edgeCount: graphSnapshots.edgeCount,
        contentHash: graphSnapshots.contentHash, builtAt: graphSnapshots.builtAt, createdAt: graphSnapshots.createdAt,
      })
      .from(graphSnapshots).where(where).orderBy(desc(graphSnapshots.createdAt), desc(graphSnapshots.id)).limit(page.limit).offset(page.offset);
    const totals = await tx.select({ n: count() }).from(graphSnapshots).where(where);
    return { items: rows, total: totals[0]?.n ?? 0 };
  }
}
