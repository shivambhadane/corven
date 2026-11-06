import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { inject } from "vitest";
import { buildApp } from "../src/app.js";
import { devHeaderAuthenticator } from "../src/auth/dev-auth.js";
import type { Role } from "../src/auth/principal.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { createAgentRegistry } from "../src/modules/agent-registry/index.js";
import { defaultAgentAuthConfig, ResourceExecutors, type GatewayHooks } from "../src/modules/authorization-gateway/index.js";
import { defaultEvidenceConfig, InMemoryArkiv, InMemoryChain } from "../src/modules/evidence-service/index.js";
import { createDependencyDiscovery } from "../src/modules/dependency-discovery/index.js";
import { InlineJobQueue } from "../src/modules/dependency-discovery/jobs/queue.js";
import { createGraphEngine } from "../src/modules/graph-engine/index.js";
import { createDependencyRegistry } from "../src/modules/dependency-registry/index.js";
import type { DependencyRepository } from "../src/modules/dependency-registry/repositories/dependency.repository.js";
import type { AgentRepository } from "../src/modules/agent-registry/repositories/agent.repository.js";

export interface TestCtx {
  handle: DbHandle;
  app: FastifyInstance;
  registry: ReturnType<typeof createAgentRegistry>;
  depRegistry: ReturnType<typeof createDependencyRegistry>;
  graphEngine: ReturnType<typeof createGraphEngine>;
  /** In-process discovery queue: `await ctx.queue.idle()` waits for started runs to finish. */
  queue: InlineJobQueue;
  discovery: ReturnType<typeof createDependencyDiscovery>;
  /** Gateway test controls: executors per resource, a hook between pre-check and re-check, a clock offset, and which plans count as approved. */
  executors: ResourceExecutors;
  hooks: GatewayHooks;
  clock: { offsetMs: number };
  approvedPlans: Set<string>;
  /** In-memory stand-ins for Arkiv and an Ethereum node (test doubles, not integrations). */
  arkiv: InMemoryArkiv;
  chain: InMemoryChain;
  /** The evidence config the app uses; tests can swap `ethereum` for a client talking to a local chain. */
  evidenceConfig: ReturnType<typeof defaultEvidenceConfig>;
  close(): Promise<void>;
}

export async function createCtx(repo?: AgentRepository, depRepo?: DependencyRepository, graphOverride?: (real: ReturnType<typeof createGraphEngine>) => ReturnType<typeof createGraphEngine>): Promise<TestCtx> {
  const handle = createDb(inject("dbUrl"));
  const registry = createAgentRegistry(handle.db, repo);
  const depRegistry = createDependencyRegistry(handle.db, registry.repo, depRepo);
  const realGraph = createGraphEngine(handle.db, registry.repo, depRegistry.resourcesRepo, depRegistry.repo);
  const graphEngine = graphOverride ? graphOverride(realGraph) : realGraph;
  const queue = new InlineJobQueue();
  const discovery = createDependencyDiscovery(handle.db, registry.repo, depRegistry, queue);
  const executors = new ResourceExecutors();
  const hooks: GatewayHooks = {};
  const clock = { offsetMs: 0 };
  const approvedPlans = new Set<string>();
  const agentAuth = { ...defaultAgentAuthConfig(Buffer.alloc(32, 7)), now: () => new Date(Date.now() + clock.offsetMs) };
  // Tests may pre-approve a plan directly (gateway tests); otherwise the real Approval Service decides.
  let realApprovals: { isPlanApproved(o: string, i: string, h: string): Promise<boolean> } | null = null;
  const approvals = { isPlanApproved: async (org: string, incidentId: string, planHash: string) => approvedPlans.has(`${org}:${incidentId}:${planHash}`) || (realApprovals ? realApprovals.isPlanApproved(org, incidentId, planHash) : false) };
  const arkiv = new InMemoryArkiv();
  const chain = new InMemoryChain();
  const evidenceConfig = defaultEvidenceConfig({ arkiv, ethereum: chain, requiredConfirmations: 3 });
  const app = await buildApp({ db: handle.db, authenticate: devHeaderAuthenticator, registry, dependencyRegistry: depRegistry, graphEngine, discovery, gatewayOptions: { agentAuth, hooks, executors, approvals }, now: () => new Date(Date.now() + clock.offsetMs), evidenceConfig });
  realApprovals = app.approvals.approvals;
  await app.ready();
  return {
    handle,
    app,
    registry,
    depRegistry,
    graphEngine,
    queue,
    discovery,
    executors,
    hooks,
    clock,
    approvedPlans,
    arkiv,
    chain,
    evidenceConfig,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

export interface Who {
  org: string;
  actor: string;
  role: Role;
}

export const newOrg = () => randomUUID();
export const who = (role: Role, org: string = randomUUID()): Who => ({ org, actor: randomUUID(), role });

const headers = (w: Who) => ({
  "x-dev-actor-id": w.actor,
  "x-dev-org-id": w.org,
  "x-dev-role": w.role,
});

export function client(app: FastifyInstance) {
  const call = async (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, w: Who | null, body?: unknown) => {
    const res = await app.inject({
      method,
      url,
      headers: w ? headers(w) : {},
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    let json: any = null;
    try {
      json = res.json();
    } catch {
      /* non-JSON */
    }
    return { status: res.statusCode, body: json, raw: res.body };
  };
  return {
    get: (url: string, w: Who | null) => call("GET", url, w),
    post: (url: string, w: Who | null, body?: unknown) => call("POST", url, w, body),
    patch: (url: string, w: Who | null, body?: unknown) => call("PATCH", url, w, body),
    put: (url: string, w: Who | null, body?: unknown) => call("PUT", url, w, body),
    delete: (url: string, w: Who | null) => call("DELETE", url, w),
  };
}

let seq = 0;
export const uniqueName = (prefix = "agent") => `${prefix}-${Date.now().toString(36)}-${++seq}`;

export const validAgent = (over: Record<string, unknown> = {}) => ({
  name: uniqueName(),
  agentType: "llm",
  ...over,
});
