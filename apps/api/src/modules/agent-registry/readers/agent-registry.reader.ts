import type { Database } from "../../../db/client.js";
import type { AgentRepository } from "../repositories/agent.repository.js";
import type { Agent } from "../types/agent.types.js";

/**
 * Read-only, organization-explicit access to the Agent Registry for other
 * modules (e.g. Dependency Discovery). It takes an organizationId instead of a
 * Principal because callers are internal; they must obtain that id from their
 * own authenticated context, never from external input.
 */
export class AgentRegistryReader {
  constructor(
    private readonly db: Database,
    private readonly repo: AgentRepository,
  ) {}

  getAgent(organizationId: string, agentId: string): Promise<Agent | null> {
    return this.repo.findAgent(this.db, organizationId, agentId);
  }

  /** Unbounded: intended for resolution caches inside background jobs. */
  async listAgents(organizationId: string): Promise<Agent[]> {
    const out: Agent[] = [];
    const limit = 500;
    for (let offset = 0; ; offset += limit) {
      const { items } = await this.repo.listAgents(this.db, organizationId, { limit, offset });
      out.push(...items);
      if (items.length < limit) return out;
    }
  }

  findAgentByExternalReference(organizationId: string, externalReference: string): Promise<Agent | null> {
    return this.repo.findByExternalReference(this.db, organizationId, externalReference);
  }

  /** Declared (not verified, not effective) capability names. Empty if the agent is not in the organization. */
  async getCapabilities(organizationId: string, agentId: string): Promise<string[]> {
    if (!(await this.getAgent(organizationId, agentId))) return [];
    return this.repo.getCapabilities(this.db, agentId);
  }

  /** AgentEntityValidator: does this agent exist in this organization? */
  async validateAgentReference(organizationId: string, agentId: string): Promise<boolean> {
    return (await this.getAgent(organizationId, agentId)) !== null;
  }
}
