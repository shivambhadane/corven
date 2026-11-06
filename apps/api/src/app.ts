import Fastify, { type FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import addFormats from "ajv-formats";
import type { Authenticator, Principal } from "./auth/principal.js";
import type { Database } from "./db/client.js";
import { AppError, UnauthorizedError } from "./errors.js";
import { createAgentRegistry, registerAgentRegistry } from "./modules/agent-registry/index.js";
import { createBlastRadius, registerBlastRadius } from "./modules/blast-radius/index.js";
import { createContainment, registerContainment } from "./modules/containment/index.js";
import { createDependencyDiscovery, registerDependencyDiscovery } from "./modules/dependency-discovery/index.js";
import type { JobQueue } from "./modules/dependency-discovery/jobs/queue.js";
import { createGraphSnapshots, registerGraphSnapshots } from "./modules/graph-snapshot/index.js";
import { createGraphEngine, registerGraphEngine } from "./modules/graph-engine/index.js";
import { createDependencyRegistry, registerDependencyRegistry } from "./modules/dependency-registry/index.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
}

export interface BuildAppOptions {
  db: Database;
  authenticate: Authenticator;
  registry?: ReturnType<typeof createAgentRegistry>;
  dependencyRegistry?: ReturnType<typeof createDependencyRegistry>;
  graphEngine?: ReturnType<typeof createGraphEngine>;
  blastRadius?: ReturnType<typeof createBlastRadius>;
  containment?: ReturnType<typeof createContainment>;
  graphSnapshots?: ReturnType<typeof createGraphSnapshots>;
  discovery?: ReturnType<typeof createDependencyDiscovery>;
  /** Background queue for discovery runs. Defaults to an in-process queue; the server uses pg-boss. */
  discoveryQueue?: JobQueue;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    ajv: {
      // Unknown properties must be REJECTED (400), not silently stripped, so
      // attempts at mass assignment are visible.
      customOptions: { removeAdditional: false, coerceTypes: "array", allErrors: false },
      plugins: [addFormats as never],
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorateRequest("principal");

  app.addHook("onRequest", async (req) => {
    if (req.url === "/health") return;
    const principal = opts.authenticate(req.headers);
    if (!principal) throw new UnauthorizedError();
    req.principal = principal;
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      // Server-side failures keep their cause in the log only; the client sees the safe message.
      if (err.statusCode >= 500) req.log.error({ err, cause: (err as { cause?: unknown }).cause }, "request failed");
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
      });
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: e.message ?? "Invalid request" } });
    }
    if (typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: "BAD_REQUEST", message: "Invalid request" } });
    }
    // Unexpected: log server-side, never leak internals (SQL, stack, constraint names).
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  const registry = opts.registry ?? createAgentRegistry(opts.db);
  await registerAgentRegistry(app, registry);
  const dependencyRegistry = opts.dependencyRegistry ?? createDependencyRegistry(opts.db, registry.repo);
  await registerDependencyRegistry(app, dependencyRegistry);
  const graphEngine = opts.graphEngine ?? createGraphEngine(opts.db, registry.repo, dependencyRegistry.resourcesRepo, dependencyRegistry.repo);
  const snapshots = opts.graphSnapshots ?? createGraphSnapshots(opts.db, graphEngine.graphs);
  await registerGraphSnapshots(app, snapshots);
  await registerGraphEngine(app, graphEngine);
  /** Live graph, or a hash-verified pinned snapshot when a snapshot id is given. */
  const liveGraph = {
    load: async (principal: Principal, snapshotId?: string) =>
      snapshotId ? snapshots.snapshots.loadGraph(principal, snapshotId) : (await graphEngine.graphs.buildFor(principal)).graph,
  };
  await registerBlastRadius(app, opts.blastRadius ?? createBlastRadius(liveGraph));
  await registerContainment(app, opts.containment ?? createContainment(liveGraph));
  const discovery = opts.discovery ?? createDependencyDiscovery(opts.db, registry.repo, dependencyRegistry, opts.discoveryQueue);
  await registerDependencyDiscovery(app, discovery);
  await discovery.start();
  app.addHook("onClose", async () => void (await discovery.queue.stop()));
  return app;
}
