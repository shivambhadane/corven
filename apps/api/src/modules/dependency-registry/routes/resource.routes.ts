import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { pageInfo, toResourceDto } from "../controllers/dependency.controller.js";
import { CreateResourceBody, ListResourcesQuery, ResourceParams, resourceResponses } from "../schemas/dependency.schema.js";
import type { ResourceService } from "../services/resource.service.js";

export const resourceRoutes: FastifyPluginAsyncTypebox<{ resources: ResourceService }> = async (app, { resources }) => {
  app.post("/", { schema: { body: CreateResourceBody, response: resourceResponses.created } }, async (req, reply) => {
    return reply.code(201).send({ data: toResourceDto(await resources.create(req.principal, req.body)) });
  });

  app.get("/", { schema: { querystring: ListResourcesQuery, response: resourceResponses.list } }, async (req) => {
    const { page = 1, limit = 20 } = req.query;
    const { items, total } = await resources.list(req.principal, { limit, offset: (page - 1) * limit });
    return { data: items.map(toResourceDto), pagination: pageInfo(page, limit, total) };
  });

  app.get("/:resourceId", { schema: { params: ResourceParams, response: resourceResponses.one } }, async (req) => {
    return { data: toResourceDto(await resources.get(req.principal, req.params.resourceId)) };
  });
};
