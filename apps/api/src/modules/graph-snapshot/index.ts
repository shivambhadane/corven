import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import type { GraphQueryService } from "../graph-engine/services/graph-query.service.js";
import { SnapshotRepository } from "./repositories/snapshot.repository.js";
import { snapshotRoutes } from "./routes/snapshot.routes.js";
import { SnapshotService } from "./services/snapshot.service.js";

export function createGraphSnapshots(db: Database, graphs: GraphQueryService, repo: SnapshotRepository = new SnapshotRepository()) {
  return { repo, snapshots: new SnapshotService(db, repo, graphs) };
}

export async function registerGraphSnapshots(app: FastifyInstance, engine: ReturnType<typeof createGraphSnapshots>) {
  await app.register(snapshotRoutes, { prefix: "/api/v1/graph/snapshots", snapshots: engine.snapshots });
}
