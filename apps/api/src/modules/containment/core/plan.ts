import { canonicalHash } from "../../../common/canonical.js";
import { analyzeBlastRadius } from "../../blast-radius/core/analyze.js";
import type { Graph } from "../../graph-engine/core/graph.js";
import { GraphError } from "../../graph-engine/errors.js";
import type { GraphEdge } from "../../graph-engine/types/graph.types.js";
import {
  CONTAINMENT_LIMITATIONS,
  type ActionKind,
  type ApprovalReason,
  type Blocker,
  type ContainmentAction,
  type ContainmentInput,
  type ContainmentPlan,
  type PreservedWorkflow,
} from "../types.js";
import { FlowNetwork } from "./maxflow.js";

/** Larger than any finite cut: edge costs are at most 1e6 and graphs at most 250,000 edges. */
const INF = 1e12;
const MAX_COST = 1_000_000;
const MAX_WORKFLOWS = 200;

const active = (e: GraphEdge) => e.status === "active";

/**
 * Minimum-safe containment planning. Pure, deterministic.
 *
 * Model: a flow network over the part of the graph that connects the
 * compromised agents to the protected nodes. A controllable edge costs its
 * revocation cost; an edge CORVEN cannot revoke, or that a healthy workflow
 * needs, has infinite capacity. The minimum s-t cut is then the cheapest set of
 * revocations that disconnects every compromised agent from every protected
 * node without touching an uncuttable edge. Among all minimum cuts the one with
 * the smallest source side is returned (unique, and closest to the compromised
 * agent, which prefers agent-specific access over shared resources).
 *
 * Every plan is re-verified in the model before it is returned.
 */
export function planContainment(graph: Graph, input: ContainmentInput): ContainmentPlan {
  const sources = [...new Set(input.sourceNodeIds)].sort();
  const protectedIds = [...new Set(input.protectedNodeIds)].sort();
  if (protectedIds.length === 0) throw new GraphError("INVALID_NODE", "At least one protected node is required");
  for (const id of protectedIds) if (!graph.hasNode(id)) throw new GraphError("NODE_NOT_FOUND", "Protected node not found in this graph");
  const blast = analyzeBlastRadius(graph, sources, input.options ?? {}); // validates sources
  if (protectedIds.some((p) => sources.includes(p))) throw new GraphError("INVALID_NODE", "A compromised agent cannot also be a protected node");

  const workflows = input.healthyWorkflows ?? [];
  if (workflows.length > MAX_WORKFLOWS) throw new GraphError("INVALID_FILTER", `At most ${MAX_WORKFLOWS} healthy workflows`);
  if (new Set(workflows.map((w) => w.id)).size !== workflows.length) throw new GraphError("INVALID_FILTER", "Workflow ids must be unique");

  // ---- coverage and costs
  const defaultCost = input.coverage?.defaultCost ?? 1;
  const checkCost = (c: number) => {
    if (!Number.isInteger(c) || c < 1 || c > MAX_COST) throw new GraphError("INVALID_FILTER", `Costs must be integers from 1 to ${MAX_COST}`);
  };
  checkCost(defaultCost);
  for (const c of Object.values(input.coverage?.edgeCosts ?? {})) checkCost(c);
  const uncontrollable = new Set(input.coverage?.uncontrollableEdgeIds ?? []);
  const costOf = (e: GraphEdge) => input.coverage?.edgeCosts?.[e.id] ?? defaultCost;

  // ---- the attack region: reachable from the sources over ALL active edges (weak edges are assumed real)
  const fromSources = forwardReach(graph, sources, () => true);
  const toProtected = backwardReach(graph, protectedIds, () => true);
  const attackNodes = new Set([...fromSources].filter((n) => toProtected.has(n)));
  const attackReachesProtected = protectedIds.some((p) => fromSources.has(p));

  // ---- healthy workflows -> preserved (uncuttable) edges
  const preserved = new Map<string, string[]>(); // edgeId -> workflow ids
  const preservedWorkflows: PreservedWorkflow[] = [];
  for (const w of [...workflows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    let edgeIds: string[] = [];
    let pathNodes: string[] = [];
    let satisfied = true;
    let note: string | null = null;
    if (w.edgeIds?.length) {
      for (const id of w.edgeIds) {
        const e = graph.getEdge(id);
        if (!e || !active(e)) throw new GraphError("INVALID_EDGE", `Workflow ${w.id} requires an edge that is not an active edge of this graph`);
      }
      edgeIds = [...w.edgeIds];
    } else if (w.from && w.to) {
      if (!graph.hasNode(w.from) || !graph.hasNode(w.to)) throw new GraphError("NODE_NOT_FOUND", `Workflow ${w.id} references an unknown node`);
      const p = preferredPath(graph, w.from, w.to, fromSources);
      if (!p) { satisfied = false; note = "No path exists between the workflow's endpoints in the current graph; nothing to preserve."; }
      else { edgeIds = p.edgeIds; pathNodes = p.nodeIds; }
    } else {
      throw new GraphError("INVALID_FILTER", `Workflow ${w.id} needs either from and to, or edgeIds`);
    }
    for (const id of edgeIds) preserved.set(id, [...(preserved.get(id) ?? []), w.id]);
    preservedWorkflows.push({ id: w.id, name: w.name ?? null, satisfied, preservedEdgeIds: [...new Set(edgeIds)].sort(), pathNodeIds: pathNodes, note });
  }

  const uncertainEdgeIds = blast.uncertainEdgeIds;
  const compromisedOrExposed = new Set(blast.impacted.filter((n) => n.classification === "compromised" || n.classification === "exposed").map((n) => n.nodeId));

  const finish = (status: ContainmentPlan["status"], actions: ContainmentAction[], blockers: Blocker[], explanation: string): ContainmentPlan => {
    const approvalReasons = new Set<ApprovalReason>(actions.flatMap((a) => a.approvalReasons));
    const total = actions.reduce((n, a) => n + a.cost, 0);
    if (input.options?.costApprovalThreshold !== undefined && total > input.options.costApprovalThreshold) approvalReasons.add("cost_threshold");
    if (status === "feasible" && uncertainEdgeIds.some((id) => attackNodes.has(graph.getEdge(id)!.sourceNodeId))) approvalReasons.add("uncertain_dependencies_in_attack_region");
    const cutIds = new Set(actions.map((a) => a.edgeId));
    const verification = verify(graph, sources, protectedIds, cutIds, preservedWorkflows, workflows);
    if (status === "feasible" && (!verification.protectedUnreachableAfterCut || !verification.workflowsStillSatisfied)) {
      throw new GraphError("INVALID_GRAPH", "Containment plan failed its own verification; this is a planner bug");
    }
    const sortedReasons = [...approvalReasons].sort();
    const body = {
      version: 1, status, sources, protected: protectedIds,
      actions: actions.map((a) => ({ edgeId: a.edgeId, kind: a.kind, cost: a.cost })).sort((x, y) => (x.edgeId < y.edgeId ? -1 : 1)),
      preserved: preservedWorkflows.map((w) => ({ id: w.id, edges: w.preservedEdgeIds })),
    };
    return {
      status, planHash: canonicalHash(body), sourceNodeIds: sources, protectedNodeIds: protectedIds, actions, totalCost: total,
      preservedWorkflows, blockers, uncertainDependencyEdgeIds: uncertainEdgeIds,
      approvalRequired: sortedReasons.length > 0, approvalReasons: sortedReasons,
      verification, explanation, limitations: [...CONTAINMENT_LIMITATIONS],
    };
  };

  if (!attackReachesProtected) {
    return finish("no_action_needed", [], [], "No protected node is reachable from the compromised agents through active registered dependencies, so no revocation is needed in the model.");
  }

  // ---- flow network over the attack region
  const nodeIds = [...attackNodes].sort();
  const idx = new Map(nodeIds.map((id, i) => [id, i]));
  const S = nodeIds.length, T = S + 1;
  const net = new FlowNetwork(nodeIds.length + 2);
  const arcEdge = new Map<number, GraphEdge>();
  for (const e of graph.edges()) {
    if (!active(e) || !attackNodes.has(e.sourceNodeId) || !attackNodes.has(e.targetNodeId)) continue;
    const fixed = uncontrollable.has(e.id) || preserved.has(e.id);
    const arc = net.addArc(idx.get(e.sourceNodeId)!, idx.get(e.targetNodeId)!, fixed ? INF : costOf(e));
    arcEdge.set(arc, e);
  }
  for (const s of sources) if (idx.has(s)) net.addArc(S, idx.get(s)!, INF);
  for (const p of protectedIds) if (idx.has(p)) net.addArc(idx.get(p)!, T, INF);

  const flow = net.maxFlow(S, T, INF);
  if (flow >= INF) {
    const blockers = findBlockers(graph, sources, protectedIds, (e) => uncontrollable.has(e.id) || preserved.has(e.id), preserved, uncontrollable);
    return finish("infeasible", [], blockers,
      "No set of controllable revocations separates the compromised agents from every protected node without breaking a preserved workflow or an edge CORVEN cannot revoke. The blockers show one attack path made only of such edges.");
  }

  const reach = net.residualReachable(S);
  const cut: GraphEdge[] = [];
  for (const [arc, e] of arcEdge) {
    if (reach[net.arcFrom(arc)] && !reach[net.arcTo(arc)]) cut.push(e);
  }
  cut.sort((a, b) => (a.id < b.id ? -1 : 1));

  const cutIds = new Set(cut.map((e) => e.id));
  const actions = cut.map((e) => buildAction(graph, e, sources, protectedIds, cutIds, compromisedOrExposed, uncertainEdgeIds, costOf(e), input));
  return finish("feasible", actions, [],
    `Revoking ${actions.length} dependenc${actions.length === 1 ? "y" : "ies"} at total cost ${actions.reduce((n, a) => n + a.cost, 0)} disconnects every compromised agent from every protected node while keeping the preserved workflows intact. Among minimum-cost cuts this is the one closest to the compromised agents.`);
}

// ---------------------------------------------------------------- helpers

function forwardReach(graph: Graph, starts: readonly string[], pred: (e: GraphEdge) => boolean, skip?: ReadonlySet<string>): Set<string> {
  const seen = new Set(starts);
  const q = [...starts];
  for (let h = 0; h < q.length; h++) {
    for (const e of graph.outgoingEdges(q[h]!)) {
      if (!active(e) || !pred(e) || skip?.has(e.id) || seen.has(e.targetNodeId)) continue;
      seen.add(e.targetNodeId);
      q.push(e.targetNodeId);
    }
  }
  return seen;
}

function backwardReach(graph: Graph, starts: readonly string[], pred: (e: GraphEdge) => boolean): Set<string> {
  const seen = new Set(starts);
  const q = [...starts];
  for (let h = 0; h < q.length; h++) {
    for (const e of graph.incomingEdges(q[h]!)) {
      if (!active(e) || !pred(e) || seen.has(e.sourceNodeId)) continue;
      seen.add(e.sourceNodeId);
      q.push(e.sourceNodeId);
    }
  }
  return seen;
}

/** Shortest path from `from` to `to`, preferring edges outside the attack region so workflows rarely pin attack edges. */
function preferredPath(graph: Graph, from: string, to: string, attackRegion: ReadonlySet<string>): { nodeIds: string[]; edgeIds: string[] } | null {
  if (from === to) return { nodeIds: [from], edgeIds: [] };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { node: string; edge: string }>();
  const done = new Set<string>();
  // simple deterministic Dijkstra (graphs are small; selection is by (distance, id))
  const open = new Set<string>([from]);
  while (open.size > 0) {
    let u = "";
    let best = Infinity;
    for (const n of open) { const d = dist.get(n)!; if (d < best || (d === best && n < u)) { best = d; u = n; } }
    open.delete(u);
    if (done.has(u)) continue;
    done.add(u);
    if (u === to) break;
    for (const e of graph.outgoingEdges(u)) {
      if (!active(e)) continue;
      const w = 1 + (attackRegion.has(e.sourceNodeId) ? 1000 : 0);
      const nd = best + w;
      const cur = dist.get(e.targetNodeId);
      if (cur === undefined || nd < cur) { dist.set(e.targetNodeId, nd); prev.set(e.targetNodeId, { node: u, edge: e.id }); open.add(e.targetNodeId); }
    }
  }
  if (!prev.has(to)) return null;
  const nodeIds = [to];
  const edgeIds: string[] = [];
  for (let cur = to; cur !== from; ) { const p = prev.get(cur)!; edgeIds.push(p.edge); nodeIds.push(p.node); cur = p.node; }
  return { nodeIds: nodeIds.reverse(), edgeIds: edgeIds.reverse() };
}

function shortest(graph: Graph, from: string, goal: (n: string) => boolean, skip?: ReadonlySet<string>): { nodeIds: string[]; edgeIds: string[] } | null {
  const prev = new Map<string, { node: string; edge: string }>();
  const seen = new Set([from]);
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const u = q[h]!;
    if (goal(u)) {
      const nodeIds = [u];
      const edgeIds: string[] = [];
      for (let cur = u; cur !== from; ) { const p = prev.get(cur)!; edgeIds.push(p.edge); nodeIds.push(p.node); cur = p.node; }
      return { nodeIds: nodeIds.reverse(), edgeIds: edgeIds.reverse() };
    }
    for (const e of graph.outgoingEdges(u)) {
      if (!active(e) || skip?.has(e.id) || seen.has(e.targetNodeId)) continue;
      seen.add(e.targetNodeId);
      prev.set(e.targetNodeId, { node: u, edge: e.id });
      q.push(e.targetNodeId);
    }
  }
  return null;
}

function findBlockers(
  graph: Graph, sources: readonly string[], protectedIds: readonly string[], fixed: (e: GraphEdge) => boolean,
  preserved: Map<string, string[]>, uncontrollable: Set<string>,
): Blocker[] {
  // shortest source -> protected path using only edges that cannot be cut
  const prev = new Map<string, { node: string; edge: GraphEdge }>();
  const seen = new Set(sources);
  const q = [...sources];
  let hit: string | null = null;
  const prot = new Set(protectedIds);
  for (let h = 0; h < q.length && !hit; h++) {
    const u = q[h]!;
    for (const e of graph.outgoingEdges(u)) {
      if (!active(e) || !fixed(e) || seen.has(e.targetNodeId)) continue;
      seen.add(e.targetNodeId);
      prev.set(e.targetNodeId, { node: u, edge: e });
      if (prot.has(e.targetNodeId)) { hit = e.targetNodeId; break; }
      q.push(e.targetNodeId);
    }
  }
  const out: Blocker[] = [];
  for (let cur = hit; cur && prev.has(cur); ) {
    const p = prev.get(cur)!;
    out.push({
      edgeId: p.edge.id, sourceNodeId: p.edge.sourceNodeId, targetNodeId: p.edge.targetNodeId,
      reason: preserved.has(p.edge.id) ? "preserved_by_workflow" : "not_controllable",
      workflowIds: [...(preserved.get(p.edge.id) ?? [])].sort(),
    });
    cur = p.node;
  }
  void uncontrollable;
  return out.reverse();
}

const KIND: Record<GraphEdge["dependencyType"], ActionKind> = {
  authority: "revoke_authority",
  resource: "revoke_resource_access",
  operational: "block_operational_trigger",
};

function buildAction(
  graph: Graph, e: GraphEdge, sources: readonly string[], protectedIds: readonly string[], cutIds: ReadonlySet<string>,
  compromisedOrExposed: ReadonlySet<string>, uncertainEdgeIds: readonly string[], cost: number, input: ContainmentInput,
): ContainmentAction {
  const prot = new Set(protectedIds);
  const toSource = sources.map((s) => shortest(graph, s, (n) => n === e.sourceNodeId)).find((p) => p !== null) ?? null;
  const after = shortest(graph, e.targetNodeId, (n) => prot.has(n));
  const examplePath = toSource && after
    ? { nodeIds: [...toSource.nodeIds, ...after.nodeIds], edgeIds: [...toSource.edgeIds, e.id, ...after.edgeIds] }
    : null;
  const blocks = [...forwardReach(graph, [e.targetNodeId], () => true)].filter((n) => prot.has(n)).sort();
  const affectsHealthyAgent = !compromisedOrExposed.has(e.sourceNodeId);
  const reasons: ApprovalReason[] = [];
  if (affectsHealthyAgent) reasons.push("affects_healthy_agent");
  if (e.confidence < (input.options?.confidenceThreshold ?? 0.5) || uncertainEdgeIds.includes(e.id)) reasons.push("uncertain_dependency");
  if ((input.options?.highValueNodeIds ?? []).some((h) => h === e.targetNodeId || h === e.sourceNodeId)) reasons.push("high_value_target");
  const src = graph.getNode(e.sourceNodeId)!, tgt = graph.getNode(e.targetNodeId)!;
  const dependents = tgt.entityType === "resource"
    ? graph.incomingEdges(tgt.id).filter((x) => active(x) && x.id !== e.id && !cutIds.has(x.id)).map((x) => graph.getNode(x.sourceNodeId)!.name)
    : [];
  const why =
    `Revoking "${e.relationship}" (${e.dependencyType}) from ${src.name} to ${tgt.name} cuts ${blocks.length} protected node(s) off from the compromised agent` +
    (affectsHealthyAgent ? `; ${src.name} is not compromised or exposed, so a healthy agent loses this access.` : `; ${src.name} is already compromised or exposed, so no healthy agent loses access.`) +
    (dependents.length ? ` Other dependents of ${tgt.name} keep their access: ${[...new Set(dependents)].sort().join(", ")}.` : "");
  return {
    edgeId: e.id, kind: KIND[e.dependencyType], sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId,
    dependencyType: e.dependencyType, relationship: e.relationship, cost, confidence: e.confidence,
    blocksProtectedNodeIds: blocks, exampleAttackPath: examplePath, affectsHealthyAgent, approvalReasons: reasons.sort(), why,
  };
}

function verify(
  graph: Graph, sources: readonly string[], protectedIds: readonly string[], cut: ReadonlySet<string>,
  preserved: PreservedWorkflow[], workflows: ReadonlyArray<{ id: string; from?: string | undefined; to?: string | undefined; edgeIds?: string[] | undefined }>,
): ContainmentPlan["verification"] {
  const afterCut = forwardReach(graph, sources, () => true, cut);
  const protectedUnreachableAfterCut = protectedIds.every((p) => !afterCut.has(p));
  let workflowsStillSatisfied = true;
  for (const w of workflows) {
    const pw = preserved.find((x) => x.id === w.id)!;
    if (!pw.satisfied) continue;
    if (pw.preservedEdgeIds.some((id) => cut.has(id))) workflowsStillSatisfied = false;
    if (w.from && w.to && !forwardReach(graph, [w.from], () => true, cut).has(w.to)) workflowsStillSatisfied = false;
  }
  return { protectedUnreachableAfterCut, workflowsStillSatisfied };
}
