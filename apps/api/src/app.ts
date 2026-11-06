import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import addFormats from "ajv-formats";
import type { Authenticator, Principal } from "./auth/principal.js";
import { sql } from "drizzle-orm";
import type { Database } from "./db/client.js";
import { AppError, ForbiddenError, UnauthorizedError } from "./errors.js";
import { createAgentRegistry, registerAgentRegistry } from "./modules/agent-registry/index.js";
import { AgentRegistryReader } from "./modules/agent-registry/readers/agent-registry.reader.js";
import { createBlastRadius, registerBlastRadius } from "./modules/blast-radius/index.js";
import { createContainment, registerContainment } from "./modules/containment/index.js";
import { createDependencyDiscovery, registerDependencyDiscovery } from "./modules/dependency-discovery/index.js";
import type { JobQueue } from "./modules/dependency-discovery/jobs/queue.js";
import { createAuthorizationGateway, registerAuthorizationGateway, type GatewayHooks, type ResourceExecutors, type ApprovalVerifier, type AgentAuthConfig } from "./modules/authorization-gateway/index.js";
import { createApprovalService, registerApprovalService } from "./modules/approval-service/index.js";
import { createVerificationService, registerVerificationService } from "./modules/verification-service/index.js";
import { createEvidenceService, defaultEvidenceConfig, registerEvidenceService, type EvidenceConfig } from "./modules/evidence-service/index.js";
import { createOrchestrator, registerOrchestrator } from "./modules/orchestrator/index.js";
import { createIncidentManagement, registerIncidentManagement } from "./modules/incident-management/index.js";
import { createGraphSnapshots, registerGraphSnapshots } from "./modules/graph-snapshot/index.js";
import { createGraphEngine, registerGraphEngine } from "./modules/graph-engine/index.js";
import { createDependencyRegistry, registerDependencyRegistry } from "./modules/dependency-registry/index.js";
import { createSaasModule, registerSaasRoutes, createApiKeyAuthenticator } from "./modules/saas/index.js";
import type { FirebaseVerifier } from "./auth/firebase.js";
import { chainAuthenticators, createFirebaseAuthenticator, createUserResolver } from "./auth/firebase-authenticator.js";
import { UserRepository } from "./modules/users/user.repository.js";
import { UserService } from "./modules/users/user.service.js";
import { userRoutes, type PublicAuthConfig } from "./modules/users/user.routes.js";
import { integrationRoutes, type EnsLookup, type IntegrationState } from "./modules/integrations/routes.js";
import { createDemoAuthenticator, demoRoutes, DemoTokens, WindowLimiter } from "./modules/demo/index.js";

declare module "fastify" {
  interface FastifyInstance {
    incidentManagement: ReturnType<typeof createIncidentManagement>;
    gateway: ReturnType<typeof createAuthorizationGateway>;
    approvals: ReturnType<typeof createApprovalService>;
    verification: ReturnType<typeof createVerificationService>;
    evidence: ReturnType<typeof createEvidenceService>;
    orchestrator: ReturnType<typeof createOrchestrator>;
    saas: ReturnType<typeof createSaasModule>;
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
  saas?: ReturnType<typeof createSaasModule>;
  /** Human sign-in through Firebase. Without it, only the fallback `authenticate` (development headers) can identify a person. */
  firebase?: { verifier: FirebaseVerifier; publicConfig: NonNullable<PublicAuthConfig["firebase"]> };
  discovery?: ReturnType<typeof createDependencyDiscovery>;
  /** Background queue for discovery runs. Defaults to an in-process queue; the server uses pg-boss. */
  discoveryQueue?: JobQueue;
  /**
   * The public demo: anyone can start an isolated, seeded sandbox organization (no account). On by default; `false` turns
   * it off. Limits are per client IP and global, per hour.
   */
  demo?: false | { tokens?: DemoTokens; perClientPerHour?: number; globalPerHour?: number };
  /** Sponsor integration status not visible from the evidence config (why Ethereum is off) and the ENS lookup, if configured. */
  integrations?: { ethereumState?: { state: IntegrationState; reason?: string | undefined }; ens?: EnsLookup | null };
  /** Tells the console whether the development sign-in is available. Informational only; it does not enable anything. */
  devAuth?: boolean;
  logger?: boolean;
  /** The built web app (landing page, sign-in pages and operator console: one React app) served from the same origin as the API. */
  web?: { dir?: string | undefined };
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const saas = opts.saas ?? createSaasModule(opts.db);
  const users = new UserService(opts.db, new UserRepository(), saas.organizations, saas.orgRepo, opts.now);
  // Order: machine API keys, then Firebase sign-in, then the fallback (development headers, or fail closed).
  const demoTokens = opts.demo === false ? null : (opts.demo?.tokens ?? new DemoTokens());
  // Order: machine API keys, then a demo sandbox token, then Firebase sign-in, then the fallback (development headers, or fail closed).
  const authenticator = createApiKeyAuthenticator(
    saas.apiKeys,
    chainAuthenticators(...(demoTokens ? [createDemoAuthenticator(demoTokens)] : []), ...(opts.firebase ? [createFirebaseAuthenticator(opts.firebase.verifier, users)] : []), opts.authenticate),
  );
  const resolveUser = opts.firebase ? createUserResolver(opts.firebase.verifier, users) : null;

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
  app.decorateRequest("user");
  // Every route that is registered, with how it authenticates. Used by the release audit test; carries no request data.
  const routeTable: Array<{ method: string; url: string; auth: string }> = [];
  app.addHook("onRoute", (r) => {
    for (const method of Array.isArray(r.method) ? r.method : [r.method]) routeTable.push({ method, url: r.url, auth: (r.config as { auth?: string } | undefined)?.auth ?? "human" });
  });
  app.decorate("routeTable", routeTable);

  app.addHook("onRequest", async (req) => {
    if (req.url === "/health" || req.url.startsWith("/health/") || req.url.startsWith("/health?")) return;
    // Only the API requires a principal. The landing page and the console's static files are public; the console then
    // calls the API, which authenticates every request.
    if (!req.url.startsWith("/api/")) return;
    const auth = req.routeOptions.config?.auth;
    // A signed-in person who may not belong to an organization yet (/me, creating the first organization): identity only.
    if (auth === "user") {
      const u = resolveUser ? await resolveUser(req.headers) : null;
      if (!u) throw new UnauthorizedError();
      req.user = u;
      return;
    }
    // Machine-facing routes authenticate themselves (an agent token) or are the public token exchange.
    if (auth) return;
    const principal = await authenticator(req.headers);
    if (!principal) throw new UnauthorizedError();
    // A demo sandbox can exercise the incident-response engine, never the account: no keys, webhooks, members or settings.
    if (principal.demo && req.url.startsWith("/api/v1/saas/")) throw new ForbiddenError("Not available in the demo");
    req.principal = principal;
  });

  app.get("/health", async (req, reply) => {
    const query = req.query as { probe?: string } | undefined;
    if (query?.probe === "readiness") {
      try {
        await opts.db.execute(sql`SELECT 1`);
        return { status: "ready" };
      } catch (err) {
        app.log.error({ err }, "Readiness check failed: database unavailable");
        return reply.status(503).send({ status: "unready" });
      }
    }
    return { status: "ok" };
  });

  app.get("/health/ready", async (_req, reply) => {
    try {
      await opts.db.execute(sql`SELECT 1`);
      return { status: "ready" };
    } catch (err) {
      app.log.error({ err }, "Readiness check failed: database unavailable");
      return reply.status(503).send({ status: "unready" });
    }
  });

  app.get("/health/live", async () => ({ status: "ok" }));

  // Defence in depth for everything we serve; none of it is needed by the Firebase sign-in popup.
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("x-content-type-options", "nosniff");
    void reply.header("referrer-policy", "strict-origin-when-cross-origin");
    void reply.header("x-frame-options", "DENY");
  });
  const webDir = opts.web?.dir;
  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: "/",
      index: ["index.html"],
      decorateReply: true,
      // Built assets are content-hashed and safe to cache forever; the HTML shell must always be revalidated.
      setHeaders: (res, filePath) => res.header("cache-control", filePath.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"),
    });
  }

  app.setNotFoundHandler((req, reply) => {
    // Client-side routes (/login, /app, ...) are answered with the app shell so deep links and refreshes work. The API
    // and anything that looks like a file keep a real 404.
    const path = req.url.split("?")[0] ?? "";
    if (webDir && (req.method === "GET" || req.method === "HEAD") && !path.startsWith("/api/") && path !== "/health" && !/\.[a-z0-9]{1,8}$/i.test(path)) {
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    }
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
  if (demoTokens) {
    const d = opts.demo || {};
    await app.register(demoRoutes, {
      prefix: "/api/v1",
      tokens: demoTokens,
      executors: gateway.executors,
      perClient: new WindowLimiter(d.perClientPerHour ?? 12, 60 * 60 * 1000),
      global: new WindowLimiter(d.globalPerHour ?? 300, 60 * 60 * 1000),
    });
  }
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
  await app.register(integrationRoutes, { prefix: "/api/v1", evidence: opts.evidenceConfig ?? defaultEvidenceConfig(), ethereumState: opts.integrations?.ethereumState, ens: opts.integrations?.ens ?? null });
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
  await registerSaasRoutes(app, saas);
  await app.register(userRoutes, { prefix: "/api/v1", users, config: { devAuth: opts.devAuth === true, firebase: opts.firebase?.publicConfig ?? null } });
  app.decorate("saas", saas);
  const discovery = opts.discovery ?? createDependencyDiscovery(opts.db, registry.repo, dependencyRegistry, opts.discoveryQueue);
  await registerDependencyDiscovery(app, discovery);
  await discovery.start();
  app.addHook("onClose", async () => void (await discovery.queue.stop()));
  return app;
}
