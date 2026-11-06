import { randomBytes } from "node:crypto";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../errors.js";
import type { WebhookRepository } from "./webhook.repository.js";
import type {
  CreateWebhookInput,
  WebhookDeliveryDto,
  WebhookDeliveryRecord,
  WebhookDto,
  WebhookRecord,
} from "./webhook.types.js";

export function toWebhookDto(r: WebhookRecord): WebhookDto {
  return {
    id: r.id,
    organizationId: r.organizationId,
    url: r.url,
    secret: r.secret,
    events: r.events,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toDeliveryDto(r: WebhookDeliveryRecord): WebhookDeliveryDto {
  return {
    id: r.id,
    organizationId: r.organizationId,
    webhookId: r.webhookId,
    event: r.event,
    statusCode: r.statusCode,
    durationMs: r.durationMs,
    success: r.success,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  };
}

export class WebhookService {
  constructor(
    private readonly db: Database,
    private readonly repo: WebhookRepository,
  ) {}

  async createWebhook(principal: Principal, input: CreateWebhookInput): Promise<WebhookDto> {
    if (principal.role !== "admin" && principal.role !== "system") {
      throw new ForbiddenError("Only organization administrators can configure webhooks");
    }

    const trimmedUrl = input.url.trim();
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      throw new ValidationError("Webhook URL must start with http:// or https://");
    }

    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    const events = input.events && input.events.length > 0 ? input.events : ["*"];

    const created = await this.repo.createWebhook(this.db, {
      organizationId: principal.organizationId,
      url: trimmedUrl,
      secret,
      events,
      status: "active",
    });

    return toWebhookDto(created);
  }

  async listWebhooks(principal: Principal): Promise<WebhookDto[]> {
    const hooks = await this.repo.listWebhooks(this.db, principal.organizationId);
    return hooks.map(toWebhookDto);
  }

  async deleteWebhook(principal: Principal, id: string): Promise<WebhookDto> {
    if (principal.role !== "admin" && principal.role !== "system") {
      throw new ForbiddenError("Only organization administrators can delete webhooks");
    }

    const deleted = await this.repo.deleteWebhook(this.db, principal.organizationId, id);
    if (!deleted) {
      throw new NotFoundError("Webhook not found");
    }
    return toWebhookDto(deleted);
  }

  async listDeliveries(principal: Principal, webhookId?: string): Promise<WebhookDeliveryDto[]> {
    const deliveries = await this.repo.listDeliveries(this.db, principal.organizationId, webhookId);
    return deliveries.map(toDeliveryDto);
  }
}
