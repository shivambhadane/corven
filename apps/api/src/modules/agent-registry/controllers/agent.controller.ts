import type { Agent, AgentDetail, AgentIdentity, StatusHistoryEntry } from "../types/agent.types.js";

/** DTO mappers. Controllers stay thin: HTTP in, service call, mapped DTO out. */
const iso = (d: Date) => d.toISOString();

export const toAgentDto = (a: Agent) => ({
  id: a.id,
  organizationId: a.organizationId,
  name: a.name,
  description: a.description,
  agentType: a.agentType,
  status: a.status,
  metadata: a.metadata,
  createdAt: iso(a.createdAt),
  updatedAt: iso(a.updatedAt),
});

export const toIdentityDto = (i: AgentIdentity) => ({
  id: i.id,
  identityType: i.identityType,
  identityValue: i.identityValue,
  verificationStatus: i.verificationStatus,
  chainId: i.chainId,
  verifiedAt: i.verifiedAt ? iso(i.verifiedAt) : null,
  createdAt: iso(i.createdAt),
  updatedAt: iso(i.updatedAt),
});

export const toAgentDetailDto = (a: AgentDetail) => ({
  ...toAgentDto(a),
  capabilities: a.capabilities,
  identities: a.identities.map(toIdentityDto),
});

export const toHistoryDto = (h: StatusHistoryEntry) => ({
  id: h.id,
  agentId: h.agentId,
  previousStatus: h.previousStatus,
  newStatus: h.newStatus,
  actorId: h.actorId,
  reason: h.reason,
  incidentId: h.incidentId,
  createdAt: iso(h.createdAt),
});
