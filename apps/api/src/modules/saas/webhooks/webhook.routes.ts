import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  CreateWebhookBody,
  ListDeliveriesQuery,
  WebhookParams,
  responses,
} from "./webhook.schema.js";
import type { WebhookService } from "./webhook.service.js";

export interface WebhookRoutesOptions {
  webhooks: WebhookService;
}

export const webhookRoutes: FastifyPluginAsyncTypebox<WebhookRoutesOptions> = async (app, { webhooks }) => {
  app.post("/", { schema: { body: CreateWebhookBody, response: responses.created } }, async (req, reply) => {
    const created = await webhooks.createWebhook(req.principal, req.body as never);
    return reply.code(201).send({ data: created });
  });

  app.get("/", { schema: { response: responses.list } }, async (req) => {
    const hooks = await webhooks.listWebhooks(req.principal);
    return { data: hooks };
  });

  app.delete("/:id", { schema: { params: WebhookParams, response: responses.item } }, async (req) => {
    const deleted = await webhooks.deleteWebhook(req.principal, req.params.id);
    return { data: deleted };
  });

  app.get("/deliveries", { schema: { querystring: ListDeliveriesQuery, response: responses.deliveries } }, async (req) => {
    const deliveries = await webhooks.listDeliveries(req.principal, req.query.webhookId);
    return { data: deliveries };
  });
};
