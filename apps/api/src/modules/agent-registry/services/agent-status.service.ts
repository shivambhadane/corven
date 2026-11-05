import type { Database } from "../../../db/client.js";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { permissionForTransition, transitionKind, validateReason } from "../policies/agent-status.policy.js";
import type { AgentRepository } from "../repositories/agent.repository.js";
import type { Agent, AgentStatus, StatusHistoryEntry } from "../types/agent.types.js";
import { agentSnapshot, loadAgent } from "./shared.js";

export class AgentStatusService {
  constructor(
    private readonly db: Database,
    private readonly repo: AgentRepository,
  ) {}

  /**
   * Changes status, writes status history and an audit record in ONE
   * transaction. The agent row is locked so concurrent changes serialise and
   * each one is validated against the true current status.
   */
  async changeStatus(
    principal: Principal,
    agentId: string,
    input: { status: AgentStatus; reason: string; incidentId?: string | undefined },
  ): Promise<Agent> {
    assertCan(principal, "agent:status"); // baseline; recovery needs more, checked below
    const org = principal.organizationId;
    return this.db.transaction(async (tx) => {
      const current = await loadAgent(this.repo, tx, org, agentId, true);
      const kind = transitionKind(current.status, input.status);
      assertCan(principal, permissionForTransition(kind));
      validateReason(kind, input.reason);

      const updated = await this.repo.updateAgent(tx, org, agentId, { status: input.status });
      await this.repo.insertStatusHistory(tx, {
        organizationId: org,
        agentId,
        previousStatus: current.status,
        newStatus: input.status,
        actorId: principal.actorId,
        reason: input.reason.trim(),
        incidentId: input.incidentId ?? null,
      });
      await this.repo.insertAudit(tx, {
        organizationId: org,
        agentId,
        actorId: principal.actorId,
        action: "agent.status_changed",
        beforeState: agentSnapshot(current),
        afterState: { ...agentSnapshot(updated), transition: kind, reason: input.reason.trim(), incidentId: input.incidentId ?? null },
      });
      return updated;
    });
  }

  async history(
    principal: Principal,
    agentId: string,
    page: { limit: number; offset: number },
  ): Promise<{ items: StatusHistoryEntry[]; total: number }> {
    assertCan(principal, "agent:read");
    const org = principal.organizationId;
    return this.db.transaction(async (tx) => {
      await loadAgent(this.repo, tx, org, agentId);
      return this.repo.listStatusHistory(tx, org, agentId, page);
    });
  }
}
