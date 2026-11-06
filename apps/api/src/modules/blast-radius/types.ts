export type Classification = "compromised" | "exposed" | "potentially_affected" | "uncertain";
export type ExposureKind = "authority" | "resource" | "operational";

export interface BlastRadiusOptions {
  /** Edges below this confidence are "uncertain", not "certain". Default 0.5 (a policy value, not a calibrated probability). */
  confidenceThreshold?: number | undefined;
  /** If set, an edge whose latest freshness (lastVerifiedAt or observedAt) is older than this is uncertain. Unknown freshness is not stale. */
  staleAfterMs?: number | undefined;
  /** Reference time for staleness. Defaults to now. */
  now?: Date | undefined;
}

export interface ImpactPath {
  nodeIds: string[];
  edgeIds: string[];
  length: number;
}

export interface ImpactedNode {
  nodeId: string;
  classification: Classification;
  /** Dependency types through which the node is reached from the compromised/exposed set. */
  exposureKinds: ExposureKind[];
  /** Hops from the nearest compromised agent. */
  depth: number;
  /** Shortest explaining path. */
  path: ImpactPath | null;
  /** For "uncertain" nodes reached through weak edges: what the node would be if those edges are real. */
  wouldBe: "exposed" | "potentially_affected" | null;
  reasons: string[];
}

export interface SharedResourceExposure {
  resourceNodeId: string;
  /** Other dependents of this exposed resource: they are not necessarily compromised. */
  dependents: Array<{ nodeId: string; edgeId: string; classification: Classification | "healthy" }>;
}

export interface BlastRadiusResult {
  graph: { organizationId: string; nodeCount: number; edgeCount: number };
  sourceNodeIds: string[];
  options: { confidenceThreshold: number; staleAfterMs: number | null };
  impacted: ImpactedNode[];
  healthyNodeIds: string[];
  sharedResources: SharedResourceExposure[];
  /** Active edges inside the reachable region that are below the confidence threshold or stale. */
  uncertainEdgeIds: string[];
  summary: Record<Classification | "healthy", number>;
  limitations: string[];
}

export const BLAST_RADIUS_LIMITATIONS = [
  "Reachability is structural: 'exposed' means connected by registered dependencies, not that the compromised agent used or can exploit the path.",
  "Only dependencies registered with CORVEN are considered; unregistered or uninstrumented dependencies are invisible, so 'healthy' does not prove isolation.",
  "Inherited authority is not modelled: delegators of a compromised or exposed agent are reported as uncertain, and the resources they could reach are not marked exposed.",
  "Confidence and freshness thresholds are policy values, not calibrated probabilities.",
] as const;
