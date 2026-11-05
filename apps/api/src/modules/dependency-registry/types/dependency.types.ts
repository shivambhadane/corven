export const ENTITY_TYPES = ["agent", "resource"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * authority:   source DELEGATES authority to target (source is the grantor).
 * resource:    source (an agent) ACCESSES / relies on target (a resource).
 * operational: source needs/triggers target to do its work. Implies NO authority.
 */
export const DEPENDENCY_TYPES = ["authority", "resource", "operational"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const DEPENDENCY_STATUSES = ["active", "inactive"] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export const PROVENANCE_SOURCES = ["manual", "imported", "discovered", "inferred"] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

/** "unknown" is for discovered resource access whose level the source does not state. */
export const ACCESS_LEVELS = ["read", "write", "admin", "unknown"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const RESOURCE_TYPES = ["api", "database", "wallet", "credential", "storage", "service", "workflow", "mcp_server", "queue", "other"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const CHANGE_TYPES = ["created", "updated", "activated", "deactivated", "removed"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const AUDIT_ACTIONS = [
  "dependency.created",
  "dependency.updated",
  "dependency.activated",
  "dependency.deactivated",
  "dependency.removed",
] as const;
export type DependencyAuditAction = (typeof AUDIT_ACTIONS)[number];

export interface Provenance {
  source: ProvenanceSource;
  reference?: string;
  note?: string;
}

export interface Endpoint {
  type: EntityType;
  id: string;
}

export interface Dependency {
  id: string;
  organizationId: string;
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  dependencyType: DependencyType;
  relationship: string;
  metadata: Record<string, unknown>;
  provenance: Provenance;
  /** 0 (no confidence) to 1 (certain), inclusive. */
  confidence: number;
  observedAt: Date | null;
  lastVerifiedAt: Date | null;
  status: DependencyStatus;
  /** Starts at 1 and increases by exactly 1 on every recorded change. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DependencyVersion {
  id: string;
  organizationId: string;
  dependencyId: string;
  version: number;
  changeType: ChangeType;
  changedBy: string | null;
  state: unknown;
  createdAt: Date;
}

export interface DependencyAuditEntry {
  id: string;
  organizationId: string;
  dependencyId: string;
  actorId: string | null;
  action: DependencyAuditAction;
  beforeState: unknown;
  afterState: unknown;
  createdAt: Date;
}

export interface Resource {
  id: string;
  organizationId: string;
  name: string;
  resourceType: ResourceType;
  description: string | null;
  /** Stable external key used for entity resolution (unique per organization, case-insensitive). */
  externalReference: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export const EVIDENCE_SOURCE_TYPES = [
  "manual",
  "agent_configuration",
  "workflow_definition",
  "permission_configuration",
  "runtime_event",
  "external_integration",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

/** declared: stated by a document; configured: set up in a system; observed: seen happening. */
export const EVIDENCE_KINDS = ["declared", "configured", "observed"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** One observation supporting a dependency. Append-only; never edited or removed. */
export interface DependencyEvidence {
  id: string;
  organizationId: string;
  dependencyId: string;
  sourceType: EvidenceSourceType;
  sourceReference: string | null;
  discoveryRunId: string | null;
  evidenceKind: EvidenceKind;
  evidenceReference: string | null;
  sourceVersion: string | null;
  confidence: number;
  observedAt: Date;
  createdAt: Date;
}

export interface EvidenceInput {
  sourceType: EvidenceSourceType;
  sourceReference?: string | undefined;
  discoveryRunId?: string | undefined;
  evidenceKind: EvidenceKind;
  evidenceReference?: string | undefined;
  sourceVersion?: string | undefined;
  confidence: number;
  observedAt: Date;
}
