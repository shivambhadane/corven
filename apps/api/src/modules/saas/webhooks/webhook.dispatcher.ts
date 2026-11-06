import { createHmac, randomUUID } from "node:crypto";
import type { Database } from "../../../db/client.js";
import type { WebhookRepository } from "./webhook.repository.js";
import type { WebhookDeliveryRecord } from "./webhook.types.js";

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export class WebhookDispatcher {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly db: Database,
    private readonly repo: WebhookRepository,
    customFetch?: typeof fetch,
  ) {
    this.fetchImpl = customFetch ?? globalThis.fetch;
  }

  async dispatch(
    organizationId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookDeliveryRecord[]> {
    const activeHooks = await this.repo.findActiveByOrg(this.db, organizationId);
    const matchingHooks = activeHooks.filter(
      (h) => h.events.includes("*") || h.events.includes(event),
    );

    if (matchingHooks.length === 0) {
      return [];
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const bodyObj = {
      event,
      timestamp,
      organizationId,
      data: payload,
    };
    const bodyStr = JSON.stringify(bodyObj);

    const deliveries: WebhookDeliveryRecord[] = [];

    for (const hook of matchingHooks) {
      const deliveryId = randomUUID();
      const signature = signWebhookPayload(hook.secret, timestamp, bodyStr);
      const startTime = Date.now();
      let statusCode: number | null = null;
      let success = false;
      let errorMsg: string | null = null;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await this.fetchImpl(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Corven-Webhook-Dispatcher/1.0",
            "X-Corven-Delivery": deliveryId,
            "X-Corven-Event": event,
            "X-Corven-Timestamp": timestamp.toString(),
            "X-Corven-Signature": `t=${timestamp},v1=${signature}`,
          },
          body: bodyStr,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        statusCode = response.status;
        success = response.ok;
        if (!response.ok) {
          errorMsg = `HTTP status ${response.status}`;
        }
      } catch (err) {
        success = false;
        errorMsg = err instanceof Error ? err.message : "Network error during delivery";
      }

      const durationMs = Date.now() - startTime;

      const record = await this.repo.recordDelivery(this.db, {
        organizationId,
        webhookId: hook.id,
        event,
        statusCode,
        durationMs,
        success,
        error: errorMsg,
      });

      deliveries.push(record);
    }

    return deliveries;
  }
}
