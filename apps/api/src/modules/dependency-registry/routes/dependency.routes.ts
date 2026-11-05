import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { pageInfo, toDependencyDto, toEvidenceDto, toVersionDto } from "../controllers/dependency.controller.js";
import {
  AgentDependenciesQuery,
  AgentParams,
  CreateDependencyBody,
  DeleteQuery,
  DependencyParams,
  ListDependenciesQuery,
  UpdateDependencyBody,
  VersionsQuery,
  dependencyResponses,
} from "../schemas/dependency.schema.js";
import type { DependencyService } from "../services/dependency.service.js";

const offsetOf = (page: number, limit: number) => (page - 1) * limit;

export const dependencyRoutes: FastifyPluginAsyncTypebox<{ dependencies: DependencyService }> = async (app, { dependencies }) => {
  app.post("/", { schema: { body: CreateDependencyBody, response: dependencyResponses.created } }, async (req, reply) => {
    const created = await dependencies.create(req.principal, req.body);
    return reply.code(201).send({ data: toDependencyDto(created) });
  });

  app.get("/", { schema: { querystring: ListDependenciesQuery, response: dependencyResponses.list } }, async (req) => {
    const { page = 1, limit = 20, ...filters } = req.query;
    const { items, total } = await dependencies.list(req.principal, { ...filters, limit, offset: offsetOf(page, limit) });
    return { data: items.map(toDependencyDto), pagination: pageInfo(page, limit, total) };
  });

  app.get("/:dependencyId", { schema: { params: DependencyParams, response: dependencyResponses.one } }, async (req) => {
    return { data: toDependencyDto(await dependencies.get(req.principal, req.params.dependencyId)) };
  });

  app.patch("/:dependencyId", { schema: { params: DependencyParams, body: UpdateDependencyBody, response: dependencyResponses.one } }, async (req) => {
    return { data: toDependencyDto(await dependencies.update(req.principal, req.params.dependencyId, req.body)) };
  });

  // Soft removal: the record, its versions and audit history are kept.
  app.delete("/:dependencyId", { schema: { params: DependencyParams, querystring: DeleteQuery, response: dependencyResponses.one } }, async (req) => {
    return { data: toDependencyDto(await dependencies.remove(req.principal, req.params.dependencyId, req.query.expectedVersion)) };
  });

  app.get("/:dependencyId/versions", { schema: { params: DependencyParams, querystring: VersionsQuery, response: dependencyResponses.versions } }, async (req) => {
    const { page = 1, limit = 20 } = req.query;
    const { items, total } = await dependencies.listVersions(req.principal, req.params.dependencyId, { limit, offset: offsetOf(page, limit) });
    return { data: items.map(toVersionDto), pagination: pageInfo(page, limit, total) };
  });

  app.get("/:dependencyId/evidence", { schema: { params: DependencyParams, querystring: VersionsQuery, response: dependencyResponses.evidence } }, async (req) => {
    const { page = 1, limit = 20 } = req.query;
    const { items, total } = await dependencies.listEvidence(req.principal, req.params.dependencyId, { limit, offset: offsetOf(page, limit) });
    return { data: items.map(toEvidenceDto), pagination: pageInfo(page, limit, total) };
  });
};

export const agentDependencyRoutes: FastifyPluginAsyncTypebox<{ dependencies: DependencyService }> = async (app, { dependencies }) => {
  app.get("/:agentId/dependencies", { schema: { params: AgentParams, querystring: AgentDependenciesQuery, response: dependencyResponses.list } }, async (req) => {
    const { page = 1, limit = 20, direction = "both", dependencyType, status } = req.query;
    const { items, total } = await dependencies.listForAgent(req.principal, req.params.agentId, {
      dependencyType,
      status,
      agent: { id: req.params.agentId, direction },
      limit,
      offset: offsetOf(page, limit),
    });
    return { data: items.map(toDependencyDto), pagination: pageInfo(page, limit, total) };
  });
};
