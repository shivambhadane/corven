import { and, desc, eq } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { webhookDeliveries, webhooks } from "../../../db/schema.js";
import type { WebhookDeliveryRecord, WebhookRecord } from "./webhook.types.js";

const toWebhookRecord = (r: typeof webhooks.$inferSelect): WebhookRecord => ({
  id: r.id,
  organizationId: r.organizationId,
  url: r.url,
  secret: r.secret,
  events: (r.events as string[]) ?? ["*"],
  status: r.status as "active" | "disabled",
  createdAt: r.createdAt,
});

const toDeliveryRecord = (r: typeof webhookDeliveries.$inferSelect): WebhookDeliveryRecord => ({
  id: r.id,
  organizationId: r.organizationId,
  webhookId: r.webhookId,
  event: r.event,
  statusCode: r.statusCode,
  durationMs: r.durationMs,
  success: r.success,
  error: r.error,
  createdAt: r.createdAt,
});

export class WebhookRepository {
  async createWebhook(db: Executor, record: typeof webhooks.$inferInsert): Promise<WebhookRecord> {
    const [row] = await db.insert(webhooks).values(record).returning();
    return toWebhookRecord(row!);
  }

  async listWebhooks(db: Executor, organizationId: string): Promise<WebhookRecord[]> {
    const rows = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.organizationId, organizationId))
      .orderBy(desc(webhooks.createdAt));
    return rows.map(toWebhookRecord);
  }

  async findById(db: Executor, organizationId: string, id: string): Promise<WebhookRecord | null> {
    const [row] = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.organizationId, organizationId), eq(webhooks.id, id)));
    return row ? toWebhookRecord(row) : null;
  }

  async deleteWebhook(db: Executor, organizationId: string, id: string): Promise<WebhookRecord | null> {
    const [row] = await db
      .delete(webhooks)
      .where(and(eq(webhooks.organizationId, organizationId), eq(webhooks.id, id)))
      .returning();
    return row ? toWebhookRecord(row) : null;
  }

  async findActiveByOrg(db: Executor, organizationId: string): Promise<WebhookRecord[]> {
    const rows = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.organizationId, organizationId), eq(webhooks.status, "active")));
    return rows.map(toWebhookRecord);
  }

  async recordDelivery(db: Executor, record: typeof webhookDeliveries.$inferInsert): Promise<WebhookDeliveryRecord> {
    const [row] = await db.insert(webhookDeliveries).values(record).returning();
    return toDeliveryRecord(row!);
  }

  async listDeliveries(db: Executor, organizationId: string, webhookId?: string): Promise<WebhookDeliveryRecord[]> {
    const condition = webhookId
      ? and(eq(webhookDeliveries.organizationId, organizationId), eq(webhookDeliveries.webhookId, webhookId))
      : eq(webhookDeliveries.organizationId, organizationId);

    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(condition)
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    return rows.map(toDeliveryRecord);
  }
}
