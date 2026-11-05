export const AGENT_STATUSES = ["active", "suspended", "compromised", "inactive"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_TYPES = ["llm", "workflow", "service", "wallet", "other"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const IDENTITY_TYPES = ["ens", "evm_address", "did", "api_client", "other"] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];

export const VERIFICATION_STATUSES = ["unverified", "pending", "verified", "failed"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const AUDIT_ACTIONS = [
  "agent.created",
  "agent.updated",
  "agent.status_changed",
  "agent.capabilities_changed",
  "agent.identities_changed",
  "agent.identity_verification_recorded",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface Agent {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  agentType: AgentType;
  status: AgentStatus;
  runtimeType: string | null;
  ownerReference: string | null;
  /** Stable external key used for entity resolution (unique per organization, case-insensitive). */
  externalReference: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentIdentity {
  id: string;
  agentId: string;
  identityType: IdentityType;
  identityValue: string;
  verificationStatus: VerificationStatus;
  chainId: number | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** An agent together with its capabilities and identities. */
export interface AgentDetail extends Agent {
  capabilities: string[];
  identities: AgentIdentity[];
}

export interface StatusHistoryEntry {
  id: string;
  organizationId: string;
  agentId: string;
  previousStatus: AgentStatus | null;
  newStatus: AgentStatus;
  actorId: string | null;
  reason: string;
  incidentId: string | null;
  createdAt: Date;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  agentId: string;
  actorId: string | null;
  action: AuditAction;
  beforeState: unknown;
  afterState: unknown;
  createdAt: Date;
}
