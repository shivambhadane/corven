export const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = [
  "detected", "investigating", "containment_planned", "awaiting_approval", "approved", "containing", "verifying",
  "contained", "partially_contained", "containment_failed", "rejected", "false_positive", "resolved", "closed",
] as const;
export type IncidentStatus = (typeof STATUSES)[number];

export const DETECTION_SOURCES = ["manual", "internal_event", "runtime_signal", "automated_detection"] as const;
export type DetectionSource = (typeof DETECTION_SOURCES)[number];

export const AGENT_RELATIONSHIPS = ["compromised", "affected", "dependent", "observed", "preserved"] as const;
export type AgentRelationship = (typeof AGENT_RELATIONSHIPS)[number];
export const AGENT_IMPACTS = ["direct", "indirect", "none"] as const;
export type AgentImpact = (typeof AGENT_IMPACTS)[number];

export const RESOURCE_RELATIONSHIPS = ["exposed", "affected", "protected", "observed"] as const;
export type ResourceRelationship = (typeof RESOURCE_RELATIONSHIPS)[number];
export const IMPACT_CLASSIFICATIONS = ["exposed", "potentially_affected", "uncertain", "healthy", "unassessed"] as const;
export type ImpactClassification = (typeof IMPACT_CLASSIFICATIONS)[number];

/** Who recorded an association. Over HTTP only "manual" is accepted. */
export type AssociationSource = "manual" | "blast_radius" | "discovery" | "system";

export type ActorType = "human" | "system";
export type ReferenceKind = "graph_snapshot" | "blast_radius" | "containment_plan";

/**
 * Timeline event types. The first group is written by this module. The second
 * group is the contract for modules that do not exist yet: they publish these
 * through IncidentService.recordExternalEvent as the `system` principal.
 */
export const INTERNAL_EVENT_TYPES = [
  "incident.created", "incident.updated", "incident.severity_changed", "incident.assigned", "incident.agent_associated",
  "incident.resource_associated", "incident.snapshot_attached", "incident.blast_radius_attached", "incident.containment_plan_attached",
  "incident.transitioned", "incident.note_added", "approval.requested",
] as const;
export const EXTERNAL_EVENT_TYPES = [
  "detection.signal_received", "approval.granted", "approval.rejected", "enforcement.result_received",
  "verification.result_received", "evidence.generated",
] as const;
export type InternalEventType = (typeof INTERNAL_EVENT_TYPES)[number];
export type ExternalEventType = (typeof EXTERNAL_EVENT_TYPES)[number];
export type EventType = InternalEventType | ExternalEventType;

/** Version of the snapshot payload layout this module understands. The snapshot table itself carries no version field. */
export const SNAPSHOT_FORMAT_VERSION = 1;
/** Recorded with every analysis reference so a later change to an engine is visible. */
export const ENGINE_VERSION = "1";

export interface Incident {
  id: string;
  organizationId: string;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  detectionSource: DetectionSource;
  detectionReference: string | null;
  createdBy: string;
  createdByType: ActorType;
  assigneeId: string | null;
  stateEnteredAt: Date;
  currentSnapshotRefId: string | null;
  currentBlastRefId: string | null;
  currentPlanRefId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalysisReference {
  id: string;
  organizationId: string;
  incidentId: string;
  kind: ReferenceKind;
  version: number;
  snapshotId: string;
  snapshotHash: string;
  snapshotBuiltAt: Date;
  snapshotFormatVersion: number;
  engineVersion: string;
  input: Record<string, unknown>;
  resultHash: string | null;
  planHash: string | null;
  planStatus: string | null;
  summary: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
}

export interface RequestMeta {
  correlationId?: string | undefined;
}
