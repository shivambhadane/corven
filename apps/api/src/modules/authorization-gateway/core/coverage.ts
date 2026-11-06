import type { ContainmentInput } from "../../containment/types.js";
import type { ControlClass, EnforcementMode } from "../types.js";

export interface CoverageEdge {
  edgeId: string;
  dependencyType: "authority" | "resource" | "operational";
  sourceNodeId: string;
  targetNodeId: string;
  classification: ControlClass;
  reason: string;
  /** Adapter that could act on this edge, if any. */
  adapter: string | null;
}

export interface CoverageReport {
  organizationId: string;
  generatedAt: string;
  summary: Record<ControlClass, number>;
  edges: CoverageEdge[];
  limitations: string[];
}

export const COVERAGE_LIMITATIONS = [
  "Only resource edges (agent to resource) can be enforced, by revoking the agent's grants and blocking the pair at the gateway.",
  "Authority (delegation) and operational (agent to agent) edges have no enforcement point yet: CORVEN cannot stop them.",
  "A resource is CONTROLLED only if an administrator declared that all access to it goes through the gateway. CORVEN cannot detect access that bypasses the gateway.",
  "Independent credentials (wallet keys, API keys, database passwords) are not revoked by CORVEN unless they are the agent's CORVEN machine credential.",
] as const;

export interface EdgeInput {
  id: string;
  dependencyType: "authority" | "resource" | "operational";
  sourceNodeId: string;
  targetNodeId: string;
}

/** Pure classification of the organization's active edges. */
export function classifyEdges(organizationId: string, edges: readonly EdgeInput[], modeByResourceNode: ReadonlyMap<string, EnforcementMode>, now: Date): CoverageReport {
  const out: CoverageEdge[] = edges.map((e) => {
    const base = { edgeId: e.id, dependencyType: e.dependencyType, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId };
    if (e.dependencyType !== "resource") {
      return { ...base, classification: "NOT_CONTROLLED" as const, adapter: null, reason: `No enforcement point exists for ${e.dependencyType} dependencies` };
    }
    const mode = modeByResourceNode.get(e.targetNodeId);
    if (mode === "gateway") return { ...base, classification: "CONTROLLED" as const, adapter: "permission", reason: "The resource is declared gateway-protected: revoking the agent's grants takes effect" };
    if (mode === "advisory") return { ...base, classification: "PARTIALLY_CONTROLLED" as const, adapter: "permission", reason: "The resource is only advisory: access outside the gateway is not controlled" };
    return { ...base, classification: "UNKNOWN" as const, adapter: null, reason: "Nobody has declared how this resource is protected" };
  });
  out.sort((a, b) => (a.edgeId < b.edgeId ? -1 : 1));
  const summary: Record<ControlClass, number> = { CONTROLLED: 0, PARTIALLY_CONTROLLED: 0, NOT_CONTROLLED: 0, UNKNOWN: 0 };
  for (const e of out) summary[e.classification]++;
  return { organizationId, generatedAt: now.toISOString(), summary, edges: out, limitations: [...COVERAGE_LIMITATIONS] };
}

/**
 * Turns the report into the Containment Engine's coverage input. Edges CORVEN
 * cannot control are marked uncontrollable, so the planner either routes around
 * them or reports a blocker. Partially controlled edges cost more, so a fully
 * controlled cut is preferred when one exists.
 */
export function toContainmentCoverage(report: CoverageReport): NonNullable<ContainmentInput["coverage"]> {
  const uncontrollableEdgeIds = report.edges.filter((e) => e.classification === "NOT_CONTROLLED" || e.classification === "UNKNOWN").map((e) => e.edgeId);
  const edgeCosts: Record<string, number> = {};
  for (const e of report.edges) if (e.classification === "PARTIALLY_CONTROLLED") edgeCosts[e.edgeId] = 2;
  return { uncontrollableEdgeIds, edgeCosts, defaultCost: 1 };
}
