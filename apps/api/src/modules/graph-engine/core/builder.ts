import { GraphError } from "../errors.js";
import {
  EDGE_DEPENDENCY_TYPES,
  EDGE_STATUSES,
  LIMITS,
  NODE_TYPES,
  type BuildIssue,
  type BuildReport,
  type EdgeDependencyType,
  type EdgeStatus,
  type GraphEdge,
  type GraphInput,
  type GraphNode,
  type NodeType,
} from "../types/graph.types.js";
import { Graph, nodeIdFor } from "./graph.js";

export interface BuildOptions {
  /** Throw INVALID_GRAPH if any record is invalid, instead of skipping and reporting. */
  strict?: boolean;
  builtAt?: Date;
}

const isOneOf = <T extends string>(set: readonly T[], v: unknown): v is T => typeof v === "string" && (set as readonly string[]).includes(v);

/**
 * Builds an immutable Graph from plain registry records.
 *
 * Invalid records are skipped and REPORTED (ids and reasons only, never
 * contents), so one bad record cannot hide the rest of the inventory; with
 * `strict` they fail the build instead. Records that belong to a different
 * organization are never included.
 */
export function buildGraph(organizationId: string, input: GraphInput, options: BuildOptions = {}): { graph: Graph; report: BuildReport } {
  const total = input.agents.length + input.resources.length;
  if (total > LIMITS.maxNodes || input.dependencies.length > LIMITS.maxEdges) {
    throw new GraphError("GRAPH_BUILD_FAILED", "The organization's inventory exceeds the in-memory graph size limit", {
      maxNodes: LIMITS.maxNodes,
      maxEdges: LIMITS.maxEdges,
    });
  }

  const issues: BuildIssue[] = [];
  const nodes = new Map<string, GraphNode>();
  let invalidNodeCount = 0;
  let invalidEdgeCount = 0;

  const addNode = (entityType: NodeType, r: { id: string; organizationId: string; name: string }, status: string | null, subtype: string, externalReference: string | null) => {
    const reject = (code: BuildIssue["code"], message: string) => {
      invalidNodeCount++;
      issues.push({ kind: "node", code, recordId: r.id, message });
    };
    if (r.organizationId !== organizationId) return reject("CROSS_TENANT_REFERENCE", `${entityType} belongs to a different organization`);
    const id = nodeIdFor(entityType, r.id);
    if (nodes.has(id)) return reject("DUPLICATE_NODE", `Duplicate ${entityType} record`);
    nodes.set(id, Object.freeze({ id, organizationId, entityType, entityId: r.id, name: r.name, status, subtype, externalReference }));
  };
  for (const a of input.agents) addNode("agent", a, a.status, a.agentType, a.externalReference);
  for (const r of input.resources) addNode("resource", r, null, r.resourceType, r.externalReference);

  const edges = new Map<string, GraphEdge>();
  for (const d of input.dependencies) {
    const reject = (code: BuildIssue["code"], message: string) => {
      invalidEdgeCount++;
      issues.push({ kind: "edge", code, recordId: d.id, message });
    };
    if (d.organizationId !== organizationId) { reject("CROSS_TENANT_REFERENCE", "Dependency belongs to a different organization"); continue; }
    if (!isOneOf(NODE_TYPES, d.sourceType) || !isOneOf(NODE_TYPES, d.targetType)) { reject("INVALID_ENDPOINT_TYPE", "Dependency endpoint type is not agent or resource"); continue; }
    if (!isOneOf(EDGE_DEPENDENCY_TYPES, d.dependencyType)) { reject("INVALID_DEPENDENCY_TYPE", "Unsupported dependency type"); continue; }
    if (!isOneOf(EDGE_STATUSES, d.status)) { reject("INVALID_STATUS", "Unsupported dependency status"); continue; }
    if (typeof d.confidence !== "number" || !(d.confidence >= 0 && d.confidence <= 1)) { reject("INVALID_CONFIDENCE", "Confidence must be a number between 0 and 1"); continue; }
    if (edges.has(d.id)) { reject("DUPLICATE_EDGE", "Duplicate dependency record"); continue; }
    const sourceNodeId = nodeIdFor(d.sourceType, d.sourceId);
    const targetNodeId = nodeIdFor(d.targetType, d.targetId);
    if (!nodes.has(sourceNodeId) || !nodes.has(targetNodeId)) { reject("DANGLING_EDGE", "Dependency references an entity that is not in this graph"); continue; }

    edges.set(
      d.id,
      Object.freeze({
        id: d.id,
        dependencyId: d.id,
        sourceNodeId,
        targetNodeId,
        dependencyType: d.dependencyType as EdgeDependencyType,
        relationship: d.relationship,
        status: d.status as EdgeStatus,
        confidence: d.confidence,
        provenance: d.provenance,
        metadata: d.metadata,
        version: d.version,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }),
    );
  }

  const report: BuildReport = { issues, invalidNodeCount, invalidEdgeCount };
  if (options.strict && issues.length > 0) {
    throw new GraphError("INVALID_GRAPH", "The registry data contains records that cannot form a valid graph", {
      invalidNodeCount,
      invalidEdgeCount,
      issues: issues.slice(0, 20),
    });
  }

  const graph = new Graph(organizationId, [...nodes.values()], [...edges.values()], options.builtAt);
  const problems = checkIntegrity(graph);
  if (problems.length > 0) throw new GraphError("INVALID_GRAPH", "Graph failed its integrity check", { problems: problems.slice(0, 20) });
  return { graph, report };
}

/** Structural integrity: every edge has both endpoints, and everything belongs to the graph's organization. */
export function checkIntegrity(graph: Graph): string[] {
  const problems: string[] = [];
  for (const n of graph.nodes()) {
    if (n.organizationId !== graph.organizationId) problems.push(`node ${n.id} belongs to another organization`);
    if (n.id !== nodeIdFor(n.entityType, n.entityId)) problems.push(`node ${n.id} has an inconsistent identity`);
  }
  for (const e of graph.edges()) {
    if (!graph.hasNode(e.sourceNodeId)) problems.push(`edge ${e.id} has a missing source`);
    if (!graph.hasNode(e.targetNodeId)) problems.push(`edge ${e.id} has a missing target`);
  }
  return problems;
}
