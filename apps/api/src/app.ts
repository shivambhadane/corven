import Fastify, { type FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import addFormats from "ajv-formats";
import type { Authenticator, Principal } from "./auth/principal.js";
import type { Database } from "./db/client.js";
import { AppError, UnauthorizedError } from "./errors.js";
import { createAgentRegistry, registerAgentRegistry } from "./modules/agent-registry/index.js";
import { AgentRegistryReader } from "./modules/agent-registry/readers/agent-registry.reader.js";
import { createBlastRadius, registerBlastRadius } from "./modules/blast-radius/index.js";
import { createContainment, registerContainment } from "./modules/containment/index.js";
import { createDependencyDiscovery, registerDependencyDiscovery } from "./modules/dependency-discovery/index.js";
import type { JobQueue } from "./modules/dependency-discovery/jobs/queue.js";
import { createAuthorizationGateway, registerAuthorizationGateway, type GatewayHooks, type ResourceExecutors, type ApprovalVerifier, type AgentAuthConfig } from "./modules/authorization-gateway/index.js";
import { createApprovalService, registerApprovalService } from "./modules/approval-service/index.js";
import { createVerificationService, registerVerificationService } from "./modules/verification-service/index.js";
import { createEvidenceService, registerEvidenceService, type EvidenceConfig } from "./modules/evidence-service/index.js";
import { createOrchestrator, registerOrchestrator } from "./modules/orchestrator/index.js";
import { createIncidentManagement, registerIncidentManagement } from "./modules/incident-management/index.js";
import { createGraphSnapshots, registerGraphSnapshots } from "./modules/graph-snapshot/index.js";
import { createGraphEngine, registerGraphEngine } from "./modules/graph-engine/index.js";
import { createDependencyRegistry, registerDependencyRegistry } from "./modules/dependency-registry/index.js";

declare module "fastify" {
  interface FastifyInstance {
    incidentManagement: ReturnType<typeof createIncidentManagement>;
    gateway: ReturnType<typeof createAuthorizationGateway>;
    approvals: ReturnType<typeof createApprovalService>;
    verification: ReturnType<typeof createVerificationService>;
    evidence: ReturnType<typeof createEvidenceService>;
    orchestrator: ReturnType<typeof createOrchestrator>;
    routeTable: Array<{ method: string; url: string; auth: string }>;
  }
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
  incidentManagement?: ReturnType<typeof createIncidentManagement>;
  gateway?: ReturnType<typeof createAuthorizationGateway>;
  approvals?: ReturnType<typeof createApprovalService>;
  verification?: ReturnType<typeof createVerificationService>;
  evidence?: ReturnType<typeof createEvidenceService>;
  orchestrator?: ReturnType<typeof createOrchestrator>;
  /** Arkiv/Ethereum clients and confirmation depth. Without clients, anchoring is unavailable (records are still sealed locally). */
  evidenceConfig?: EvidenceConfig;
  /** Clock for time-based rules (approval expiry and execution windows). Tests move it; production uses real time. */
  now?: () => Date;
  /** Gateway wiring when `gateway` is not supplied. */
  gatewayOptions?: { agentAuth?: AgentAuthConfig | null; hooks?: GatewayHooks; executors?: ResourceExecutors; approvals?: ApprovalVerifier };
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
  // Every route that is registered, with how it authenticates. Used by the release audit test; carries no request data.
  const routeTable: Array<{ method: string; url: string; auth: string }> = [];
  app.addHook("onRoute", (r) => {
    for (const method of Array.isArray(r.method) ? r.method : [r.method]) routeTable.push({ method, url: r.url, auth: (r.config as { auth?: string } | undefined)?.auth ?? "human" });
  });
  app.decorate("routeTable", routeTable);

  app.addHook("onRequest", async (req) => {
    if (req.url === "/health") return;
    // Machine-facing routes authenticate themselves (an agent token) or are the public token exchange.
    if (req.routeOptions.config?.auth) return;
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
  const blastRadius = opts.blastRadius ?? createBlastRadius(liveGraph);
  const containment = opts.containment ?? createContainment(liveGraph);
  await registerBlastRadius(app, blastRadius);
  await registerContainment(app, containment);
  const incidents =
    opts.incidentManagement ??
    createIncidentManagement(opts.db, {
      agents: new AgentRegistryReader(opts.db, registry.repo),
      resources: { getResource: (org, id) => dependencyRegistry.resourcesRepo.find(opts.db, org, id) },
      snapshots: snapshots.snapshots,
      blast: blastRadius.blast,
      containment: containment.containment,
    });
  await registerIncidentManagement(app, incidents);
  const approvals = opts.approvals ?? createApprovalService(opts.db, incidents, opts.now);
  await registerApprovalService(app, approvals);
  const agentReader = new AgentRegistryReader(opts.db, registry.repo);
  const resourceLookup = { getResource: (org: string, id: string) => dependencyRegistry.resourcesRepo.find(opts.db, org, id) };
  const gateway =
    opts.gateway ??
    createAuthorizationGateway(opts.db, {
      agents: agentReader,
      resources: resourceLookup,
      resolver: {
        // A request names a resource by id, external reference or name, in that order.
        resolve: async (org, ref) =>
          (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref) ? await dependencyRegistry.resourcesRepo.find(opts.db, org, ref) : null) ??
          (await dependencyRegistry.resourcesRepo.findByExternalReference(opts.db, org, ref)) ??
          (await dependencyRegistry.resourcesRepo.findByName(opts.db, org, ref)),
      },
      coverageGraph: liveGraph,
      incidents: incidents.reader,
      agentStatus: registry.status,
      // The gateway asks the Approval Service whether this exact plan is approved; nothing else can say yes.
      approvals: approvals.approvals,
      ...opts.gatewayOptions,
    });
  await registerAuthorizationGateway(app, gateway);
  const verification =
    opts.verification ??
    createVerificationService(opts.db, incidents, {
      prober: gateway.gateway,
      snapshots: snapshots.snapshots,
      lookups: {
        agentExists: async (org, id) => (await agentReader.getAgent(org, id)) !== null,
        resourceExists: async (org, id) => (await resourceLookup.getResource(org, id)) !== null,
      },
    });
  await registerVerificationService(app, verification);
  const evidence = opts.evidence ?? createEvidenceService(opts.db, incidents, opts.evidenceConfig);
  await registerEvidenceService(app, evidence);
  const orchestrator =
    opts.orchestrator ??
    createOrchestrator(opts.db, {
      incidents: incidents.incidents, reader: incidents.reader, analysis: incidents.analysis, approvals: approvals.approvals, enforcement: gateway.enforcement,
      gateway: gateway.gateway, verification: verification.verification, evidence: evidence.evidence,
    }, opts.now);
  await registerOrchestrator(app, orchestrator);
  // Exposed so trusted in-process modules (and tests) can use the service as the `system` principal. Never reachable over HTTP.
  app.decorate("incidentManagement", incidents);
  app.decorate("gateway", gateway);
  app.decorate("approvals", approvals);
  app.decorate("verification", verification);
  app.decorate("evidence", evidence);
  app.decorate("orchestrator", orchestrator);
  const discovery = opts.discovery ?? createDependencyDiscovery(opts.db, registry.repo, dependencyRegistry, opts.discoveryQueue);
  await registerDependencyDiscovery(app, discovery);
  await discovery.start();
  app.addHook("onClose", async () => void (await discovery.queue.stop()));
  return app;
}
