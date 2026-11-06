import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import { WorkflowRepository } from "./repository.js";
import { orchestratorRoutes } from "./routes.js";
import { Orchestrator, type OrchestratorDeps } from "./service.js";

export function createOrchestrator(db: Database, deps: OrchestratorDeps, now?: () => Date, repo = new WorkflowRepository()) {
  return { repo, orchestrator: new Orchestrator(db, repo, deps, now) };
}
export async function registerOrchestrator(app: FastifyInstance, o: ReturnType<typeof createOrchestrator>) {
  await app.register(orchestratorRoutes, { prefix: "/api/v1", orchestrator: o.orchestrator });
}
export { PgBossTicker } from "./ticker.js";
export { ORCHESTRATOR_ACTOR_ID } from "./types.js";
export type { Signal } from "./service.js";
