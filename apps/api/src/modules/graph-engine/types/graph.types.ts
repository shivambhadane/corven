/**
 * Graph Engine domain types. Values mirror the registries (lowercase), so the
 * graph never reinterprets what a dependency means.
 *
 * Edge direction is the registry's source -> target:
 *   authority    delegator  -> delegate
 *   resource     agent      -> resource it accesses
 *   operational  caller     -> callee
 */
export const NODE_TYPES = ["agent", "resource"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_DEPENDENCY_TYPES = ["authority", "resource", "operational"] as const;
export type EdgeDependencyType = (typeof EDGE_DEPENDENCY_TYPES)[number];

export const EDGE_STATUSES = ["active", "inactive"] as const;
export type EdgeStatus = (typeof EDGE_STATUSES)[number];

export interface GraphNode {
  /** `agent:<uuid>` or `resource:<uuid>`: unambiguous across both tables. */
  readonly id: string;
  readonly organizationId: string;
  readonly entityType: NodeType;
  readonly entityId: string;
  readonly name: string;
  /** Agent lifecycle status; `null` for resources, which have none. */
  readonly status: string | null;
  /** agentType or resourceType. */
  readonly subtype: string;
  readonly externalReference: string | null;
}

export interface GraphEdge {
  /** Equal to the dependency id. */
  readonly id: string;
  readonly dependencyId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly dependencyType: EdgeDependencyType;
  readonly relationship: string;
  readonly status: EdgeStatus;
  readonly confidence: number;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ----- plain inputs (decoupled from the database and from the registries' classes)

export interface AgentRecord {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  agentType: string;
  externalReference: string | null;
}

export interface ResourceRecord {
  id: string;
  organizationId: string;
  name: string;
  resourceType: string;
  externalReference: string | null;
}

export interface DependencyRecord {
  id: string;
  organizationId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  dependencyType: string;
  relationship: string;
  status: string;
  confidence: number;
  provenance: Record<string, unknown>;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphInput {
  agents: readonly AgentRecord[];
  resources: readonly ResourceRecord[];
  dependencies: readonly DependencyRecord[];
}

// ----- filters and traversal options

export type Direction = "forward" | "reverse" | "both";

export interface GraphFilter {
  entityTypes?: readonly NodeType[] | undefined;
  nodeStatuses?: readonly string[] | undefined;
  dependencyTypes?: readonly EdgeDependencyType[] | undefined;
  /** Defaults to ["active"]: inactive dependencies are excluded unless asked for. */
  edgeStatuses?: readonly EdgeStatus[] | undefined;
  minConfidence?: number | undefined;
}

export interface BuildIssue {
  kind: "node" | "edge";
  code:
    | "DUPLICATE_NODE"
    | "DUPLICATE_EDGE"
    | "CROSS_TENANT_REFERENCE"
    | "DANGLING_EDGE"
    | "INVALID_DEPENDENCY_TYPE"
    | "INVALID_STATUS"
    | "INVALID_CONFIDENCE"
    | "INVALID_ENDPOINT_TYPE";
  /** Registry id of the offending record. Never contains record contents. */
  recordId: string;
  message: string;
}

export interface BuildReport {
  issues: BuildIssue[];
  invalidNodeCount: number;
  invalidEdgeCount: number;
}

export interface GraphMetadata {
  nodeCount: number;
  edgeCount: number;
  builtAt: Date;
}

export interface TraversalVisit {
  nodeId: string;
  depth: number;
  /** Edge used to reach this node; null for the start node. */
  viaEdgeId: string | null;
  fromNodeId: string | null;
}

export interface TraversalResult {
  algorithm: "bfs" | "dfs";
  startNodeId: string;
  direction: Direction;
  maxDepth: number;
  visited: TraversalVisit[];
  /** Every admissible edge examined from a visited node, sorted. */
  edgeIds: string[];
  /** True when the depth limit stopped at least one expansion. */
  truncatedByDepth: boolean;
}

export interface GraphPath {
  nodeIds: string[];
  edgeIds: string[];
  length: number;
}

export interface PathSearchResult {
  found: boolean;
  shortest: GraphPath | null;
  paths: GraphPath[];
  /** More paths exist than maxPaths, or the search budget ran out. */
  truncated: boolean;
  truncationReason: "max_paths" | "search_budget" | null;
}

export interface ReachabilityResult {
  reachable: boolean;
  /** Hop count of a shortest connection, when reachable. */
  depth: number | null;
  /** The depth limit stopped the search before it could conclude "unreachable". */
  truncatedByDepth: boolean;
}

export interface ComponentInfo {
  index: number;
  nodeIds: string[];
  edgeCount: number;
}

export interface CycleInfo {
  /** Rotated to start at the smallest node id. */
  nodeIds: string[];
  edgeIds: string[];
  length: number;
}

export interface CycleReport {
  cycles: CycleInfo[];
  /** Strongly connected components that contain at least one cycle. */
  cyclicComponentCount: number;
  truncated: boolean;
  truncationReason: "max_cycles" | "search_budget" | null;
}

export const LIMITS = {
  maxDepth: 100,
  defaultDepth: 10,
  maxPaths: 100,
  defaultPaths: 10,
  maxPathDepth: 25,
  maxCycles: 500,
  defaultCycles: 50,
  maxCycleLength: 50,
  defaultCycleLength: 10,
  /** Hard cap on graph size for in-memory construction. */
  maxNodes: 50_000,
  maxEdges: 250_000,
  /** Upper bound on search-tree expansions for path and cycle enumeration. */
  searchBudget: 200_000,
} as const;
