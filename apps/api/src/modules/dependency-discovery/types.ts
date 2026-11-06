export const SOURCE_TYPES = ["agent_configuration", "workflow_definition", "runtime_gateway"] as const;
export type DiscoverySourceType = (typeof SOURCE_TYPES)[number];

export const RUN_STATUSES = ["pending", "running", "completed", "completed_with_errors", "failed", "cancelled"] as const;
export type DiscoveryRunStatus = (typeof RUN_STATUSES)[number];

export const OBSERVATION_STATUSES = ["pending", "normalized", "resolved", "rejected", "unresolved", "pending_review", "applied", "review_rejected"] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const RECONCILIATION_OUTCOMES = ["new", "unchanged", "modified", "missing", "conflicting", "stale", "unresolved"] as const;
export type ReconciliationOutcome = (typeof RECONCILIATION_OUTCOMES)[number];

export type EvidenceKind = "declared" | "configured" | "observed";
export type EntityKind = "agent" | "resource";
export type DependencyKind = "operational" | "resource";

/** A source-specific record collected by an adapter. No entity ids exist yet. */
export interface RawDiscoveryRecord {
  externalRecordId: string;
  /** Where in the source this came from, e.g. "doc-1#support-agent->payment-service". */
  sourceReference: string;
  payload: Record<string, unknown>;
  observedAt: Date;
}

export interface NormalizedObservation {
  sourceEntity: { type: EntityKind; reference: string };
  targetEntity: { type: EntityKind; reference: string };
  dependencyType: DependencyKind;
  relationship: string;
  /** Only keys the source actually stated. Never invented. */
  metadata: Record<string, unknown>;
  evidenceKind: EvidenceKind;
  evidenceSourceType: "agent_configuration" | "workflow_definition" | "runtime_event";
  /** Runtime outcome, when the evidence is a gateway event. */
  outcome?: "attempted" | "allowed" | "denied" | "completed" | undefined;
  evidence: { operation?: string | undefined; timestamp: string; sourceVersion?: string | undefined; reference?: string | undefined };
}

export interface ResolvedEntity {
  id: string;
  matchedBy: "external_reference" | "id" | "name";
}

export interface ResolvedObservation {
  source: ResolvedEntity & { type: EntityKind };
  target: ResolvedEntity & { type: EntityKind };
  confidence: number;
  confidenceRule: string;
}

export type ResolutionResult =
  | { status: "resolved"; entity: ResolvedEntity }
  | { status: "unresolved"; reason: string }
  | { status: "ambiguous"; reason: string };

export const SOURCE_REF_PREFIX = (sourceId: string) => `src:${sourceId}/`;

/** Observations below this confidence need a human before they can create or change a dependency. */
export const AUTO_ACCEPT_THRESHOLD = 0.8;
