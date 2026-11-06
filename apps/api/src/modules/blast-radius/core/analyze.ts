import type { Graph } from "../../graph-engine/core/graph.js";
import { GraphError } from "../../graph-engine/errors.js";
import type { GraphEdge } from "../../graph-engine/types/graph.types.js";
import {
  BLAST_RADIUS_LIMITATIONS,
  type BlastRadiusOptions,
  type BlastRadiusResult,
  type Classification,
  type ExposureKind,
  type ImpactPath,
  type ImpactedNode,
  type SharedResourceExposure,
} from "../types.js";

const MAX_SOURCES = 50;

interface Reach {
  exposed: Set<string>; // includes the sources
  affected: Set<string>;
  prev: Map<string, { from: string; edge: string }>;
  depth: Map<string, number>;
}

/**
 * Blast-radius analysis over an immutable graph. Pure and deterministic.
 *
 * Propagation (forward, active edges only):
 *   exposed:              the compromised agent can use or direct these.
 *                         agent --authority--> agent, agent --resource--> resource, from an
 *                         exposed agent (compromised or exposed).
 *   potentially_affected: reached through operational edges from an exposed or
 *                         affected node. Operational links imply no authority, so the chain
 *                         stops at operational edges.
 * It is computed twice: over "certain" edges (confidence at or above the
 * threshold, not stale) and over all active edges. Nodes reachable only through
 * the weaker set are "uncertain".
 */
export function analyzeBlastRadius(graph: Graph, sourceNodeIds: readonly string[], options: BlastRadiusOptions = {}): BlastRadiusResult {
  const sources = [...new Set(sourceNodeIds)].sort();
  if (sources.length === 0) throw new GraphError("INVALID_NODE", "At least one compromised agent is required");
  if (sources.length > MAX_SOURCES) throw new GraphError("INVALID_FILTER", `At most ${MAX_SOURCES} compromised agents per analysis`);
  for (const id of sources) {
    const n = graph.getNode(id);
    if (!n) throw new GraphError("NODE_NOT_FOUND", "Node not found in this graph");
    if (n.entityType !== "agent") throw new GraphError("INVALID_NODE", "A compromised node must be an agent");
  }
  const threshold = options.confidenceThreshold ?? 0.5;
  if (!(threshold >= 0 && threshold <= 1)) throw new GraphError("INVALID_FILTER", "confidenceThreshold must be between 0 and 1");
  const staleAfterMs = options.staleAfterMs ?? null;
  if (staleAfterMs !== null && !(staleAfterMs > 0)) throw new GraphError("INVALID_FILTER", "staleAfterMs must be positive");
  const now = (options.now ?? new Date()).getTime();

  const isActive = (e: GraphEdge) => e.status === "active";
  const isStale = (e: GraphEdge) => {
    if (staleAfterMs === null) return false;
    const t = Math.max(e.lastVerifiedAt?.getTime() ?? -Infinity, e.observedAt?.getTime() ?? -Infinity);
    return Number.isFinite(t) && now - t > staleAfterMs;
  };
  const isStrong = (e: GraphEdge) => isActive(e) && e.confidence >= threshold && !isStale(e);

  const strong = reach(graph, sources, isStrong);
  const weak = reach(graph, sources, isActive);

  const classification = new Map<string, Classification>();
  const impacted: ImpactedNode[] = [];

  const kindsInto = (id: string, inSet: (n: string) => boolean, pred: (e: GraphEdge) => boolean, onlyOperational: boolean): ExposureKind[] => {
    const kinds = new Set<ExposureKind>();
    for (const e of graph.incomingEdges(id)) {
      if (!pred(e) || !inSet(e.sourceNodeId)) continue;
      if (onlyOperational && e.dependencyType !== "operational") continue;
      kinds.add(e.dependencyType);
    }
    return [...kinds].sort();
  };

  const pathTo = (r: Reach, id: string): ImpactPath | null => {
    if (!r.prev.has(id)) return sources.includes(id) ? { nodeIds: [id], edgeIds: [], length: 0 } : null;
    const nodeIds = [id];
    const edgeIds: string[] = [];
    for (let cur = id; r.prev.has(cur); ) {
      const p = r.prev.get(cur)!;
      edgeIds.push(p.edge);
      nodeIds.push(p.from);
      cur = p.from;
    }
    return { nodeIds: nodeIds.reverse(), edgeIds: edgeIds.reverse(), length: edgeIds.length };
  };

  for (const id of sources) {
    classification.set(id, "compromised");
    impacted.push({ nodeId: id, classification: "compromised", exposureKinds: [], depth: 0, path: { nodeIds: [id], edgeIds: [], length: 0 }, wouldBe: null, reasons: ["Reported as compromised"] });
  }
  for (const id of strong.exposed) {
    if (sources.includes(id)) continue;
    classification.set(id, "exposed");
    const node = graph.getNode(id)!;
    impacted.push({
      nodeId: id, classification: "exposed",
      exposureKinds: kindsInto(id, (n) => strong.exposed.has(n), isStrong, false).filter((k) => k !== "operational"),
      depth: strong.depth.get(id)!, path: pathTo(strong, id), wouldBe: null,
      reasons: [node.entityType === "resource" ? "A compromised or exposed agent has a resource dependency on it" : "Authority is delegated to it by a compromised or exposed agent"],
    });
  }
  for (const id of strong.affected) {
    classification.set(id, "potentially_affected");
    impacted.push({
      nodeId: id, classification: "potentially_affected",
      exposureKinds: ["operational"], depth: strong.depth.get(id)!, path: pathTo(strong, id), wouldBe: null,
      reasons: ["Reached only through operational dependencies, which imply no authority"],
    });
  }

  // Weak-only reach -> uncertain
  for (const [id, wouldBe] of [
    ...[...weak.exposed].filter((n) => !sources.includes(n)).map((n) => [n, "exposed"] as const),
    ...[...weak.affected].map((n) => [n, "potentially_affected"] as const),
  ]) {
    if (classification.has(id)) continue;
    classification.set(id, "uncertain");
    impacted.push({
      nodeId: id, classification: "uncertain",
      exposureKinds: kindsInto(id, (n) => weak.exposed.has(n) || weak.affected.has(n), isActive, wouldBe === "potentially_affected"),
      depth: weak.depth.get(id)!, path: pathTo(weak, id), wouldBe,
      reasons: ["Reached only through dependencies below the confidence threshold or past the staleness limit"],
    });
  }

  // Delegators of compromised or exposed agents: inherited authority is not modelled -> uncertain
  const delegateTargets = new Set<string>([...sources, ...[...strong.exposed].filter((n) => graph.getNode(n)?.entityType === "agent")]);
  for (const target of [...delegateTargets].sort()) {
    for (const e of graph.incomingEdges(target)) {
      if (!isActive(e) || e.dependencyType !== "authority" || classification.has(e.sourceNodeId)) continue;
      classification.set(e.sourceNodeId, "uncertain");
      impacted.push({
        nodeId: e.sourceNodeId, classification: "uncertain", exposureKinds: ["authority"], depth: 1,
        path: { nodeIds: [e.sourceNodeId, target], edgeIds: [e.id], length: 1 }, wouldBe: null,
        reasons: ["Delegates authority to a compromised or exposed agent; inherited authority is not modelled"],
      });
    }
  }

  const rank: Record<Classification, number> = { compromised: 0, exposed: 1, potentially_affected: 2, uncertain: 3 };
  impacted.sort((a, b) => rank[a.classification] - rank[b.classification] || a.depth - b.depth || (a.nodeId < b.nodeId ? -1 : 1));

  // Shared resources: other dependents of every exposed resource
  const sharedResources: SharedResourceExposure[] = [];
  for (const n of impacted) {
    if (n.classification !== "exposed" || graph.getNode(n.nodeId)!.entityType !== "resource") continue;
    const dependents = graph
      .incomingEdges(n.nodeId)
      .filter((e) => isActive(e))
      .map((e) => ({ nodeId: e.sourceNodeId, edgeId: e.id, classification: (classification.get(e.sourceNodeId) ?? "healthy") as Classification | "healthy" }));
    sharedResources.push({ resourceNodeId: n.nodeId, dependents });
  }

  const region = new Set<string>([...sources, ...weak.exposed, ...weak.affected]);
  const uncertainEdgeIds = graph
    .edges()
    .filter((e) => isActive(e) && region.has(e.sourceNodeId) && !isStrong(e))
    .map((e) => e.id);

  const healthyNodeIds = graph.nodes().filter((n) => !classification.has(n.id)).map((n) => n.id);
  const summary: BlastRadiusResult["summary"] = { compromised: 0, exposed: 0, potentially_affected: 0, uncertain: 0, healthy: healthyNodeIds.length };
  for (const n of impacted) summary[n.classification]++;

  return {
    graph: { organizationId: graph.organizationId, nodeCount: graph.metadata.nodeCount, edgeCount: graph.metadata.edgeCount },
    sourceNodeIds: sources,
    options: { confidenceThreshold: threshold, staleAfterMs },
    impacted, healthyNodeIds, sharedResources, uncertainEdgeIds, summary,
    limitations: [...BLAST_RADIUS_LIMITATIONS],
  };
}

function reach(graph: Graph, sources: readonly string[], pred: (e: GraphEdge) => boolean): Reach {
  const exposed = new Set<string>(sources);
  const affected = new Set<string>();
  const prev = new Map<string, { from: string; edge: string }>();
  const depth = new Map<string, number>(sources.map((s) => [s, 0]));

  // Phase 1: exposure closure over authority and resource edges.
  const q = [...sources];
  for (let head = 0; head < q.length; head++) {
    const u = q[head]!;
    for (const e of graph.outgoingEdges(u)) {
      if (!pred(e) || (e.dependencyType !== "authority" && e.dependencyType !== "resource")) continue;
      if (exposed.has(e.targetNodeId)) continue;
      exposed.add(e.targetNodeId);
      prev.set(e.targetNodeId, { from: u, edge: e.id });
      depth.set(e.targetNodeId, depth.get(u)! + 1);
      q.push(e.targetNodeId);
    }
  }
  // Phase 2: operational spread from every exposed or affected node. Seeds sit at different
  // depths, so expand level by level to keep depths minimal.
  const buckets = new Map<number, string[]>();
  for (const id of [...exposed].sort()) (buckets.get(depth.get(id)!) ?? buckets.set(depth.get(id)!, []).get(depth.get(id)!)!).push(id);
  for (let d = 0; buckets.size > 0; d++) {
    const level = buckets.get(d);
    if (!level) continue;
    buckets.delete(d);
    for (const u of level.sort()) {
      for (const e of graph.outgoingEdges(u)) {
        if (!pred(e) || e.dependencyType !== "operational") continue;
        if (exposed.has(e.targetNodeId) || affected.has(e.targetNodeId)) continue;
        affected.add(e.targetNodeId);
        prev.set(e.targetNodeId, { from: u, edge: e.id });
        depth.set(e.targetNodeId, d + 1);
        (buckets.get(d + 1) ?? buckets.set(d + 1, []).get(d + 1)!).push(e.targetNodeId);
      }
    }
  }
  return { exposed, affected, prev, depth };
}
