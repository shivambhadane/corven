import type { Database } from "../../../db/client.js";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { normalizeCapabilities } from "../policies/agent-input.policy.js";
import type { AgentRepository } from "../repositories/agent.repository.js";
import { loadAgent } from "./shared.js";

/** Capabilities are descriptive registry data. They are NOT authorization grants. */
export class AgentCapabilityService {
  constructor(
    private readonly db: Database,
    private readonly repo: AgentRepository,
  ) {}

  async replace(principal: Principal, agentId: string, capabilities: string[]): Promise<string[]> {
    assertCan(principal, "agent:write");
    const next = normalizeCapabilities(capabilities);
    const org = principal.organizationId;
    return this.db.transaction(async (tx) => {
      await loadAgent(this.repo, tx, org, agentId, true);
      const before = await this.repo.getCapabilities(tx, agentId);
      await this.repo.replaceCapabilities(tx, agentId, next);
      await this.repo.insertAudit(tx, {
        organizationId: org,
        agentId,
        actorId: principal.actorId,
        action: "agent.capabilities_changed",
        beforeState: { capabilities: before },
        afterState: { capabilities: next },
      });
      return next;
    });
  }
}
