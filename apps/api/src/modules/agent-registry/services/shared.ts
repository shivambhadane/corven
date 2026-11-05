import { ConflictError, NotFoundError } from "../../../errors.js";
import type { Executor } from "../../../db/client.js";
import type { Agent, AgentIdentity } from "../types/agent.types.js";
import type { AgentRepository } from "../repositories/agent.repository.js";

/** Extracts the Postgres error code/constraint from a (possibly wrapped) driver error. */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const o = e as { code?: string; constraint?: string; cause?: unknown };
    if (typeof o.code === "string" && o.code.length === 5) return { code: o.code, ...(o.constraint ? { constraint: o.constraint } : {}) };
    e = o.cause;
  }
  return {};
}

/** Converts known unique-violation errors into safe 409s. Anything else is rethrown untouched. */
export function mapUniqueViolation(err: unknown): never {
  const { code, constraint } = pgError(err);
  if (code === "23505") {
    if (constraint === "agents_org_name_unique") {
      throw new ConflictError("An agent with this name already exists in your organization", "AGENT_NAME_CONFLICT");
    }
    if (constraint === "agent_identities_org_unique") {
      throw new ConflictError("This identity is already registered to an agent in your organization", "IDENTITY_CONFLICT");
    }
    throw new ConflictError("Conflicting resource");
  }
  throw err;
}

/** Cross-organization and unknown IDs are indistinguishable: both are 404. */
export async function loadAgent(
  repo: AgentRepository,
  tx: Executor,
  organizationId: string,
  agentId: string,
  forUpdate = false,
): Promise<Agent> {
  const agent = await repo.findAgent(tx, organizationId, agentId, { forUpdate });
  if (!agent) throw new NotFoundError("Agent not found");
  return agent;
}

/** Audit snapshot of the agent row itself (never includes anything outside the registry). */
export const agentSnapshot = (a: Agent) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  agentType: a.agentType,
  status: a.status,
  metadata: a.metadata,
});

export const identitySnapshot = (i: AgentIdentity) => ({
  id: i.id,
  identityType: i.identityType,
  identityValue: i.identityValue,
  chainId: i.chainId,
  verificationStatus: i.verificationStatus,
  verifiedAt: i.verifiedAt ? i.verifiedAt.toISOString() : null,
});
