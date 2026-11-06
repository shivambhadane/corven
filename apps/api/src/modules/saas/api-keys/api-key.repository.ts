import { and, desc, eq, isNull } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { apiKeys } from "../../../db/schema.js";
import type { ApiKeyRecord, ApiKeyScope } from "./api-key.types.js";

const toRecord = (r: typeof apiKeys.$inferSelect): ApiKeyRecord => ({
  id: r.id,
  organizationId: r.organizationId,
  name: r.name,
  prefix: r.prefix,
  keyHash: r.keyHash,
  scopes: (r.scopes as ApiKeyScope[]) ?? [],
  lastUsedAt: r.lastUsedAt,
  expiresAt: r.expiresAt,
  revokedAt: r.revokedAt,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
});

export class ApiKeyRepository {
  async create(db: Executor, record: typeof apiKeys.$inferInsert): Promise<ApiKeyRecord> {
    const [row] = await db.insert(apiKeys).values(record).returning();
    return toRecord(row!);
  }

  async findByHash(db: Executor, keyHash: string): Promise<ApiKeyRecord | null> {
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));
    return row ? toRecord(row) : null;
  }

  async findById(db: Executor, organizationId: string, id: string): Promise<ApiKeyRecord | null> {
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.organizationId, organizationId), eq(apiKeys.id, id)));
    return row ? toRecord(row) : null;
  }

  async list(db: Executor, organizationId: string): Promise<ApiKeyRecord[]> {
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.organizationId, organizationId))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(toRecord);
  }

  async revoke(db: Executor, organizationId: string, id: string, revokedAt: Date): Promise<ApiKeyRecord | null> {
    const [row] = await db
      .update(apiKeys)
      .set({ revokedAt })
      .where(and(eq(apiKeys.organizationId, organizationId), eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async touchLastUsed(db: Executor, id: string, date: Date): Promise<void> {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: date })
      .where(eq(apiKeys.id, id));
  }
}
