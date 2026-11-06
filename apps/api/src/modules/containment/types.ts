import type { BlastRadiusOptions } from "../blast-radius/types.js";

/** A healthy workflow that must keep working: either "from must still reach to", or explicit required edges. */
export interface WorkflowRequirement {
  id: string;
  name?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  edgeIds?: string[] | undefined;
}

/**
 * Which edges CORVEN can actually revoke, and what revoking costs. Until the
 * Authorization Gateway reports real coverage, the default is "every edge is
 * controllable at cost 1"; pass `uncontrollableEdgeIds` to model gaps.
 */
export interface EnforcementCoverage {
  uncontrollableEdgeIds?: string[] | undefined;
  edgeCosts?: Record<string, number> | undefined;
  defaultCost?: number | undefined;
}

export interface ContainmentOptions extends BlastRadiusOptions {
  /** Plans costing more than this require approval. */
  costApprovalThreshold?: number | undefined;
  /** Touching these nodes requires approval. */
  highValueNodeIds?: string[] | undefined;
}

export interface ContainmentInput {
  sourceNodeIds: string[];
  protectedNodeIds: string[];
  healthyWorkflows?: WorkflowRequirement[] | undefined;
  coverage?: EnforcementCoverage | undefined;
  options?: ContainmentOptions | undefined;
}

export type PlanStatus = "feasible" | "infeasible" | "no_action_needed";
export type ActionKind = "revoke_authority" | "revoke_resource_access" | "block_operational_trigger";
export type ApprovalReason = "affects_healthy_agent" | "uncertain_dependency" | "high_value_target" | "cost_threshold" | "uncertain_dependencies_in_attack_region";

export interface ContainmentAction {
  edgeId: string;
  kind: ActionKind;
  sourceNodeId: string;
  targetNodeId: string;
  dependencyType: "authority" | "resource" | "operational";
  relationship: string;
  cost: number;
  confidence: number;
  /** Protected nodes that become unreachable through this edge. */
  blocksProtectedNodeIds: string[];
  /** One attack path (source to protected node) that this action cuts. */
  exampleAttackPath: { nodeIds: string[]; edgeIds: string[] } | null;
  /** True when the edge's source is neither compromised nor exposed, so a healthy agent loses this access. */
  affectsHealthyAgent: boolean;
  approvalReasons: ApprovalReason[];
  why: string;
}

export interface PreservedWorkflow {
  id: string;
  name: string | null;
  satisfied: boolean;
  /** The edges fixed as untouchable for this workflow. */
  preservedEdgeIds: string[];
  pathNodeIds: string[];
  note: string | null;
}

export interface Blocker {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  reason: "preserved_by_workflow" | "not_controllable";
  workflowIds: string[];
}

export interface ContainmentPlan {
  status: PlanStatus;
  /** Hash over the canonical plan content (status, inputs, actions, preserved edges). Stable under reordering. */
  planHash: string;
  sourceNodeIds: string[];
  protectedNodeIds: string[];
  actions: ContainmentAction[];
  totalCost: number;
  preservedWorkflows: PreservedWorkflow[];
  /** Present when status is "infeasible": a shortest attack path made only of edges that cannot be cut. */
  blockers: Blocker[];
  uncertainDependencyEdgeIds: string[];
  approvalRequired: boolean;
  approvalReasons: ApprovalReason[];
  verification: { protectedUnreachableAfterCut: boolean; workflowsStillSatisfied: boolean };
  explanation: string;
  limitations: string[];
}

export const CONTAINMENT_LIMITATIONS = [
  "The plan is computed on the registered dependency graph. Dependencies CORVEN does not know about, and credentials outside its enforcement points, are not covered.",
  "Workflow preservation is sound but not complete: one admissible path per workflow is fixed as untouchable, so a feasible plan may be reported infeasible if a different path would have worked.",
  "Only edge revocations are modelled. Suspending an agent is not planned here.",
  "Planned is not approved, submitted, executed or verified; this module only produces plans.",
] as const;
