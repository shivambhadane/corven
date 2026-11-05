import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import type { AgentRepository } from "../agent-registry/repositories/agent.repository.js";
import { DependencyAuditService } from "./audit/dependency-audit.service.js";
import { DependencyRepository } from "./repositories/dependency.repository.js";
import { ResourceRepository } from "./repositories/resource.repository.js";
import { agentDependencyRoutes, dependencyRoutes } from "./routes/dependency.routes.js";
import { resourceRoutes } from "./routes/resource.routes.js";
import { DependencyGraphDataProvider } from "./services/dependency-graph-data.provider.js";
import { DependencyRegistryWriter } from "./services/dependency-writer.service.js";
import { DependencyService } from "./services/dependency.service.js";
import { ResourceService } from "./services/resource.service.js";
import { RelationshipValidator } from "./validators/relationship.validator.js";
import { DependencyVersionService } from "./versioning/dependency-version.service.js";

/** Reuses the Agent Registry's repository for agent lookups; agent logic is not duplicated. */
export function createDependencyRegistry(
  db: Database,
  agents: AgentRepository,
  deps: DependencyRepository = new DependencyRepository(),
) {
  const resourcesRepo = new ResourceRepository();
  const validator = new RelationshipValidator(agents, resourcesRepo, deps);
  const versions = new DependencyVersionService(deps);
  const audit = new DependencyAuditService(deps);
  const dependencies = new DependencyService(db, deps, agents, validator, versions, audit);
  return {
    repo: deps,
    resourcesRepo,
    dependencies,
    resources: new ResourceService(db, resourcesRepo),
    /** Internal boundary for Dependency Discovery. Not exposed over HTTP. */
    writer: new DependencyRegistryWriter(db, deps, validator, versions, audit, dependencies),
    /** Stable read interface for the future Graph Engine. */
    graphData: new DependencyGraphDataProvider(db, deps),
  };
}

export async function registerDependencyRegistry(app: FastifyInstance, registry: ReturnType<typeof createDependencyRegistry>) {
  await app.register(dependencyRoutes, { prefix: "/api/v1/dependencies", dependencies: registry.dependencies });
  await app.register(agentDependencyRoutes, { prefix: "/api/v1/agents", dependencies: registry.dependencies });
  await app.register(resourceRoutes, { prefix: "/api/v1/resources", resources: registry.resources });
}
