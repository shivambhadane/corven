import type { Database } from "../../../db/client.js";
import type { AgentStatusService } from "../../agent-registry/services/agent-status.service.js";
import type { GatewayRepository } from "../repositories/gateway.repository.js";
import type { AgentAuthService } from "../services/agent-auth.service.js";
import type { ActionKind } from "../types.js";
import { result, type AdapterContext, type EnforcementAdapter } from "./types.js";

/**
 * Revokes an agent's grants on a resource. Together with the action row itself
 * (an executed restriction the policy evaluator honours) this stops the agent
 * at the gateway. It does not touch credentials the agent holds elsewhere.
 */
export class PermissionEnforcementAdapter implements EnforcementAdapter {
  readonly name = "permission";
  readonly coverage = "CONTROLLED_LOCAL" as const;
  constructor(
    private readonly db: Database,
    private readonly repo: GatewayRepository,
  ) {}
  supports = (k: ActionKind) => k === "revoke_resource_access";
  supportsRollback = (k: ActionKind) => k === "revoke_resource_access";

  async apply(ctx: AdapterContext) {
    const revoked = await this.db.transaction((tx) =>
      this.repo.revokePairPermissions(tx, ctx.organizationId, ctx.agentId!, ctx.resourceId!, ctx.principal.actorId, `containment action ${ctx.actionId}: ${ctx.reason}`),
    );
    const mode = await this.repo.getMode(this.db, ctx.organizationId, ctx.resourceId!);
    return result("executed", { revokedPermissionIds: revoked.map((p) => p.id), restrictionActive: true, resourceEnforcementMode: mode?.mode ?? "undeclared" }, [
      "NEGATIVE_ACCESS_TEST: the agent is denied on this resource through the gateway",
      ...(mode?.mode === "gateway" ? [] : ["BYPASS_RESISTANCE_TEST: the resource is not declared gateway-only, so access outside the gateway is not controlled"]),
    ]);
  }

  async rollback() {
    // Lifting the restriction is done by the service (the action leaves 'executed'). Revoked grants are deliberately NOT restored.
    return result("executed", { restrictionLifted: true, grantsRestored: false }, ["Re-grant permissions explicitly if the agent should have access again"]);
  }
}

/** Suspends the agent through the Agent Registry's own status service, so its history and audit rules apply. */
export class AgentStatusEnforcementAdapter implements EnforcementAdapter {
  readonly name = "agent-status";
  readonly coverage = "CONTROLLED_LOCAL" as const;
  constructor(private readonly status: AgentStatusService) {}
  supports = (k: ActionKind) => k === "suspend_agent";
  supportsRollback = () => false;

  async apply(ctx: AdapterContext) {
    try {
      const agent = await this.status.changeStatus(ctx.principal, ctx.agentId!, { status: "suspended", reason: ctx.reason, incidentId: ctx.incidentId ?? undefined });
      return result("executed", { agentStatus: agent.status }, ["NEGATIVE_ACCESS_TEST: every operation by the agent is denied", "The agent's credentials and external permissions are unaffected"]);
    } catch (e) {
      return result("failed", {}, [], { failureReason: e instanceof Error ? e.message : "status change failed" });
    }
  }
  async rollback(): Promise<never> {
    throw new Error("Reactivate the agent through the Agent Registry");
  }
}

/** Revokes the agent's CORVEN machine credential. Tokens already issued stop working immediately because they are checked against it. */
export class CredentialEnforcementAdapter implements EnforcementAdapter {
  readonly name = "credential";
  readonly coverage = "CONTROLLED_LOCAL" as const;
  constructor(private readonly auth: AgentAuthService) {}
  supports = (k: ActionKind) => k === "revoke_credentials";
  supportsRollback = () => false;

  async apply(ctx: AdapterContext) {
    const r = await this.auth.revokeForAgent(ctx.organizationId, ctx.agentId!, { actorId: ctx.principal.actorId, actorType: ctx.principal.role === "system" ? "system" : "human" }, `containment action ${ctx.actionId}: ${ctx.reason}`);
    return result("executed", { credentialRevoked: r.revoked, credentialId: r.credentialId, note: r.revoked ? undefined : "The agent had no active CORVEN credential" }, ["NEGATIVE_ACCESS_TEST: the agent cannot obtain a token", "Credentials issued by other systems (API keys, wallet keys) are NOT revoked"]);
  }
  async rollback(): Promise<never> {
    throw new Error("Issue a new credential instead");
  }
}
