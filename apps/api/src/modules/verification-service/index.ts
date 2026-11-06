import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import type { createIncidentManagement } from "../incident-management/index.js";
import { VerificationRepository } from "./repositories/verification.repository.js";
import { verificationRoutes } from "./routes/verification.routes.js";
import { VerificationService, type Lookups, type Prober, type SnapshotGraphs } from "./services/verification.service.js";

export function createVerificationService(db: Database, incidents: ReturnType<typeof createIncidentManagement>, deps: { prober: Prober; snapshots: SnapshotGraphs; lookups: Lookups }, repo = new VerificationRepository()) {
  return { repo, verification: new VerificationService(db, repo, incidents.incidents, incidents.reader, incidents.analysis, deps.snapshots, deps.prober, deps.lookups) };
}

export async function registerVerificationService(app: FastifyInstance, v: ReturnType<typeof createVerificationService>) {
  await app.register(verificationRoutes, { prefix: "/api/v1", verification: v.verification });
}

export { aggregate, incidentOutcomeFor, reachableProtected } from "./core/outcome.js";
export { VERIFICATION_ACTOR_ID } from "./services/verification.service.js";
export * from "./types.js";
