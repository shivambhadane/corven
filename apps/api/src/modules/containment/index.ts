import type { FastifyInstance } from "fastify";
import type { GraphLoader } from "../blast-radius/services/blast-radius.service.js";
import { containmentRoutes } from "./routes/containment.routes.js";
import { ContainmentService } from "./services/containment.service.js";

export function createContainment(loader: GraphLoader) {
  return { containment: new ContainmentService(loader) };
}

export async function registerContainment(app: FastifyInstance, engine: ReturnType<typeof createContainment>) {
  await app.register(containmentRoutes, { prefix: "/api/v1/containment", containment: engine.containment });
}

export { planContainment } from "./core/plan.js";
export type * from "./types.js";
