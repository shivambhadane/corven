import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ApiKeyParams, CreateApiKeyBody, responses } from "./api-key.schema.js";
import type { ApiKeyService } from "./api-key.service.js";

export interface ApiKeyRoutesOptions {
  apiKeys: ApiKeyService;
}

export const apiKeyRoutes: FastifyPluginAsyncTypebox<ApiKeyRoutesOptions> = async (app, { apiKeys }) => {
  app.post("/", { schema: { body: CreateApiKeyBody, response: responses.created } }, async (req, reply) => {
    const created = await apiKeys.createKey(req.principal, req.body as never);
    return reply.code(201).send({ data: created });
  });

  app.get("/", { schema: { response: responses.list } }, async (req) => {
    const keys = await apiKeys.listKeys(req.principal);
    return { data: keys };
  });

  app.delete("/:id", { schema: { params: ApiKeyParams, response: responses.item } }, async (req) => {
    const revoked = await apiKeys.revokeKey(req.principal, req.params.id);
    return { data: revoked };
  });
};
