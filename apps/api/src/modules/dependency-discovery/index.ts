import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import type { AgentRepository } from "../agent-registry/repositories/agent.repository.js";
import type { createDependencyRegistry } from "../dependency-registry/index.js";
import { InlineJobQueue, type JobQueue } from "./jobs/queue.js";
import { DiscoveryRepository } from "./repositories/discovery.repository.js";
import { discoveryRoutes } from "./routes/discovery.routes.js";
import { DiscoveryService } from "./services/discovery.service.js";
import { DiscoveryRunner } from "./services/runner.js";

export function createDependencyDiscovery(
  db: Database,
  agents: AgentRepository,
  depRegistry: ReturnType<typeof createDependencyRegistry>,
  queue: JobQueue = new InlineJobQueue(),
  now: () => Date = () => new Date(),
) {
  const repo = new DiscoveryRepository();
  const runner = new DiscoveryRunner(db, repo, agents, depRegistry.resourcesRepo, depRegistry.repo, depRegistry.writer, now);
  const discovery = new DiscoveryService(db, repo, queue, depRegistry.writer, depRegistry.dependencies, now);
  return {
    repo, runner, discovery, queue,
    /** Connects the queue to the runner. Call once at startup. */
    start: () => queue.start((job) => runner.execute(job.organizationId, job.runId).then(() => undefined)),
  };
}

export async function registerDependencyDiscovery(app: FastifyInstance, engine: ReturnType<typeof createDependencyDiscovery>) {
  await app.register(discoveryRoutes, { prefix: "/api/v1/discovery", discovery: engine.discovery });
}
