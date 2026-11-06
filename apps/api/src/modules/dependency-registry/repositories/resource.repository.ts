import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { resources } from "../../../db/schema.js";
import type { Resource, ResourceType } from "../types/dependency.types.js";

const toResource = (r: typeof resources.$inferSelect): Resource => ({
  id: r.id,
  organizationId: r.organizationId,
  name: r.name,
  resourceType: r.resourceType as ResourceType,
  description: r.description,
  externalReference: r.externalReference,
  metadata: r.metadata,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Minimum resource persistence: insert and read only. No update, no delete. */
export class ResourceRepository {
  async insert(
    tx: Executor,
    v: { organizationId: string; name: string; resourceType: ResourceType; description: string | null; externalReference: string | null; metadata: Record<string, unknown> },
  ): Promise<Resource> {
    const [row] = await tx.insert(resources).values(v).returning();
    return toResource(row!);
  }

  async find(tx: Executor, organizationId: string, id: string): Promise<Resource | null> {
    const rows = await tx.select().from(resources).where(and(eq(resources.organizationId, organizationId), eq(resources.id, id)));
    return rows[0] ? toResource(rows[0]) : null;
  }

  async listAll(tx: Executor, organizationId: string): Promise<Resource[]> {
    const out: Resource[] = [];
    const limit = 500;
    for (let offset = 0; ; offset += limit) {
      const { items } = await this.list(tx, organizationId, { limit, offset });
      out.push(...items);
      if (items.length < limit) return out;
    }
  }

  async findByName(tx: Executor, organizationId: string, name: string): Promise<Resource | null> {
    const rows = await tx.select().from(resources).where(and(eq(resources.organizationId, organizationId), sql`lower(${resources.name}) = lower(${name})`));
    return rows[0] ? toResource(rows[0]) : null;
  }

  async findByExternalReference(tx: Executor, organizationId: string, externalReference: string): Promise<Resource | null> {
    const rows = await tx
      .select()
      .from(resources)
      .where(and(eq(resources.organizationId, organizationId), sql`lower(${resources.externalReference}) = lower(${externalReference})`));
    return rows[0] ? toResource(rows[0]) : null;
  }

  async list(tx: Executor, organizationId: string, page: { limit: number; offset: number }): Promise<{ items: Resource[]; total: number }> {
    const where = eq(resources.organizationId, organizationId);
    const rows = await tx.select().from(resources).where(where).orderBy(desc(resources.createdAt), desc(resources.id)).limit(page.limit).offset(page.offset);
    const totals = await tx.select({ n: count() }).from(resources).where(where);
    return { items: rows.map(toResource), total: totals[0]?.n ?? 0 };
  }
}
