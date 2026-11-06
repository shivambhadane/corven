import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import { PermissionEnforcementAdapter, AgentStatusEnforcementAdapter, CredentialEnforcementAdapter } from "./adapters/local.adapters.js";
import { ResourceExecutors } from "./adapters/resource-executor.js";
import type { EnforcementAdapter } from "./adapters/types.js";
import { GatewayRepository } from "./repositories/gateway.repository.js";
import { adminRoutes, agentFacingRoutes } from "./routes/gateway.routes.js";
import { AgentAuthService, defaultAgentAuthConfig, type AgentAuthConfig, type AgentLookup } from "./services/agent-auth.service.js";
import { denyAllApprovals, EnforcementService, type ApprovalVerifier, type IncidentPlanReader } from "./services/enforcement.service.js";
import { GatewayService, type CoverageGraphLoader, type GatewayHooks, type ResourceResolver } from "./services/gateway.service.js";
import { PermissionService, type ResourceLookup } from "./services/permission.service.js";
import type { AgentStatusService } from "../agent-registry/services/agent-status.service.js";

export interface GatewayDeps {
  agents: AgentLookup;
  resources: ResourceLookup;
  resolver: ResourceResolver;
  coverageGraph: CoverageGraphLoader;
  incidents: IncidentPlanReader;
  agentStatus: AgentStatusService;
  /** Replaced by the Approval Service. The default approves nothing. */
  approvals?: ApprovalVerifier;
  /** Null disables agent authentication: token issuance and every gateway call fail closed with 503. */
  agentAuth?: AgentAuthConfig | null;
  hooks?: GatewayHooks;
  executors?: ResourceExecutors;
  /** Extra adapters (for example a future on-chain adapter). */
  extraAdapters?: EnforcementAdapter[];
}

export function createAuthorizationGateway(db: Database, deps: GatewayDeps, repo: GatewayRepository = new GatewayRepository()) {
  const auth = new AgentAuthService(db, repo, deps.agents, deps.agentAuth ?? defaultAgentAuthConfig(null));
  const executors = deps.executors ?? new ResourceExecutors();
  const adapters: EnforcementAdapter[] = [new PermissionEnforcementAdapter(db, repo), new AgentStatusEnforcementAdapter(deps.agentStatus), new CredentialEnforcementAdapter(auth), ...(deps.extraAdapters ?? [])];
  return {
    repo,
    auth,
    executors,
    adapters,
    permissions: new PermissionService(db, repo, deps.agents, deps.resources),
    gateway: new GatewayService(db, repo, deps.agents, deps.resolver, executors, deps.coverageGraph, deps.hooks),
    enforcement: new EnforcementService(db, repo, adapters, deps.agents, deps.resources, deps.incidents, deps.approvals ?? denyAllApprovals),
  };
}

export async function registerAuthorizationGateway(app: FastifyInstance, g: ReturnType<typeof createAuthorizationGateway>) {
  const deps = { auth: g.auth, gateway: g.gateway, permissions: g.permissions, enforcement: g.enforcement };
  await app.register(agentFacingRoutes, { prefix: "/api/v1", ...deps });
  await app.register(adminRoutes, { prefix: "/api/v1", ...deps });
}

export { toContainmentCoverage, classifyEdges } from "./core/coverage.js";
export { SimulatedExecutor, ResourceExecutors } from "./adapters/resource-executor.js";
export type * from "./types.js";
export type { GatewayHooks } from "./services/gateway.service.js";
export type { ApprovalVerifier } from "./services/enforcement.service.js";
export type { AgentAuthConfig } from "./services/agent-auth.service.js";
export { defaultAgentAuthConfig } from "./services/agent-auth.service.js";
export type { ResourceExecutor, ExecutionContext, ExecutorOutcome } from "./adapters/resource-executor.js";
export type { ProbeResult } from "./services/gateway.service.js";
export type { ProbeOutcome } from "./adapters/resource-executor.js";
