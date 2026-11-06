import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import { AgentRegistryReader } from "./readers/agent-registry.reader.js";
import { AgentRepository } from "./repositories/agent.repository.js";
import { agentRoutes } from "./routes/agent.routes.js";
import { AgentCapabilityService } from "./services/agent-capability.service.js";
import { AgentIdentityService } from "./services/agent-identity.service.js";
import { AgentStatusService } from "./services/agent-status.service.js";
import { AgentService } from "./services/agent.service.js";

export function createAgentRegistry(db: Database, repo: AgentRepository = new AgentRepository()) {
  return {
    repo,
    reader: new AgentRegistryReader(db, repo),
    agents: new AgentService(db, repo),
    status: new AgentStatusService(db, repo),
    capabilities: new AgentCapabilityService(db, repo),
    identities: new AgentIdentityService(db, repo),
  };
}

export async function registerAgentRegistry(app: FastifyInstance, registry: ReturnType<typeof createAgentRegistry>) {
  await app.register(agentRoutes, { prefix: "/api/v1/agents", ...registry });
}

export type { AgentRepository };
export { EnsResolver, type EnsResolverConfig, type EnsVerificationResult } from "./services/ens-resolver.js";
