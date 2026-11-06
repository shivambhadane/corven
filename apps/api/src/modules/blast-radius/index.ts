import type { FastifyInstance } from "fastify";
import { blastRadiusRoutes } from "./routes/blast-radius.routes.js";
import { BlastRadiusService, type GraphLoader } from "./services/blast-radius.service.js";

export function createBlastRadius(loader: GraphLoader) {
  return { blast: new BlastRadiusService(loader) };
}

export async function registerBlastRadius(app: FastifyInstance, engine: ReturnType<typeof createBlastRadius>) {
  await app.register(blastRadiusRoutes, { prefix: "/api/v1/blast-radius", blast: engine.blast });
}

export { analyzeBlastRadius } from "./core/analyze.js";
export type * from "./types.js";
