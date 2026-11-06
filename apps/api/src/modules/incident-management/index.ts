import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import type { BlastRadiusService } from "../blast-radius/services/blast-radius.service.js";
import type { ContainmentService } from "../containment/services/containment.service.js";
import type { SnapshotService } from "../graph-snapshot/services/snapshot.service.js";
import { IncidentReader } from "./readers/incident.reader.js";
import { IncidentRepository } from "./repositories/incident.repository.js";
import { incidentRoutes } from "./routes/incident.routes.js";
import { IncidentAnalysisService } from "./services/analysis.service.js";
import { IncidentService, type AgentLookup, type ResourceLookup } from "./services/incident.service.js";

export interface IncidentDeps {
  agents: AgentLookup;
  resources: ResourceLookup;
  snapshots: SnapshotService;
  blast: BlastRadiusService;
  containment: ContainmentService;
}

export function createIncidentManagement(db: Database, deps: IncidentDeps, repo: IncidentRepository = new IncidentRepository()) {
  return {
    repo,
    incidents: new IncidentService(db, repo, deps.agents, deps.resources),
    analysis: new IncidentAnalysisService(db, repo, deps.snapshots, deps.blast, deps.containment),
    /** For Approval, Gateway, Verification and Evidence. */
    reader: new IncidentReader(db, repo),
  };
}

export async function registerIncidentManagement(app: FastifyInstance, engine: ReturnType<typeof createIncidentManagement>) {
  await app.register(incidentRoutes, { prefix: "/api/v1/incidents", incidents: engine.incidents, analysis: engine.analysis });
}

export type { AgentLookup, ResourceLookup } from "./services/incident.service.js";
export { TRANSITIONS, edgeFor } from "./core/state-machine.js";
export * from "./types.js";
