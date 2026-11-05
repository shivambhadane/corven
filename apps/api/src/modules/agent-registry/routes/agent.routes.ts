import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { toAgentDetailDto, toAgentDto, toHistoryDto, toIdentityDto } from "../controllers/agent.controller.js";
import {
  AgentParams,
  ChangeStatusBody,
  CreateAgentBody,
  HistoryQuery,
  ListAgentsQuery,
  PutCapabilitiesBody,
  PutIdentitiesBody,
  UpdateAgentBody,
  responses,
} from "../schemas/agent.schema.js";
import type { AgentCapabilityService } from "../services/agent-capability.service.js";
import type { AgentIdentityService } from "../services/agent-identity.service.js";
import type { AgentStatusService } from "../services/agent-status.service.js";
import type { AgentService } from "../services/agent.service.js";

export interface AgentRoutesOptions {
  agents: AgentService;
  status: AgentStatusService;
  capabilities: AgentCapabilityService;
  identities: AgentIdentityService;
}

export const agentRoutes: FastifyPluginAsyncTypebox<AgentRoutesOptions> = async (app, { agents, status, capabilities, identities }) => {
  app.post("/", { schema: { body: CreateAgentBody, response: responses.created } }, async (req, reply) => {
    const created = await agents.register(req.principal, req.body);
    return reply.code(201).send({ data: toAgentDetailDto(created) });
  });

  app.get("/", { schema: { querystring: ListAgentsQuery, response: responses.list } }, async (req) => {
    const { limit = 20, offset = 0, status: st, agentType, search } = req.query;
    const { items, total } = await agents.list(req.principal, { limit, offset, status: st, agentType, search });
    return { data: items.map(toAgentDto), pagination: { limit, offset, total } };
  });

  app.get("/:agentId", { schema: { params: AgentParams, response: responses.agent } }, async (req) => {
    return { data: toAgentDetailDto(await agents.get(req.principal, req.params.agentId)) };
  });

  app.patch("/:agentId", { schema: { params: AgentParams, body: UpdateAgentBody, response: responses.agent } }, async (req) => {
    return { data: toAgentDetailDto(await agents.update(req.principal, req.params.agentId, req.body)) };
  });

  app.post("/:agentId/status", { schema: { params: AgentParams, body: ChangeStatusBody, response: responses.agent } }, async (req) => {
    await status.changeStatus(req.principal, req.params.agentId, req.body);
    return { data: toAgentDetailDto(await agents.get(req.principal, req.params.agentId)) };
  });

  app.get("/:agentId/history", { schema: { params: AgentParams, querystring: HistoryQuery, response: responses.history } }, async (req) => {
    const { limit = 20, offset = 0 } = req.query;
    const { items, total } = await status.history(req.principal, req.params.agentId, { limit, offset });
    return { data: items.map(toHistoryDto), pagination: { limit, offset, total } };
  });

  app.put("/:agentId/capabilities", { schema: { params: AgentParams, body: PutCapabilitiesBody, response: responses.capabilities } }, async (req) => {
    const caps = await capabilities.replace(req.principal, req.params.agentId, req.body.capabilities);
    return { data: { capabilities: caps } };
  });

  app.put("/:agentId/identities", { schema: { params: AgentParams, body: PutIdentitiesBody, response: responses.identities } }, async (req) => {
    const list = await identities.replace(req.principal, req.params.agentId, req.body.identities);
    return { data: { identities: list.map(toIdentityDto) } };
  });
};
