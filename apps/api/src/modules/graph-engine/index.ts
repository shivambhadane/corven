import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import type { AgentRepository } from "../agent-registry/repositories/agent.repository.js";
import type { DependencyRepository } from "../dependency-registry/repositories/dependency.repository.js";
import type { ResourceRepository } from "../dependency-registry/repositories/resource.repository.js";
import { RegistryGraphInputProvider } from "./adapters/registry-graph-input.provider.js";
import { graphRoutes } from "./routes/graph.routes.js";
import { GraphQueryService } from "./services/graph-query.service.js";

export function createGraphEngine(db: Database, agents: AgentRepository, resources: ResourceRepository, dependencies: DependencyRepository) {
  const input = new RegistryGraphInputProvider(db, agents, resources, dependencies);
  return { input, graphs: new GraphQueryService(input) };
}

export async function registerGraphEngine(app: FastifyInstance, engine: ReturnType<typeof createGraphEngine>) {
  await app.register(graphRoutes, { prefix: "/api/v1/graph", graphs: engine.graphs });
}

export { GraphError } from "./errors.js";
export type { Graph } from "./core/graph.js";
