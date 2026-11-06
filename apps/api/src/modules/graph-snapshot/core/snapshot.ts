import { canonicalHash } from "../../../common/canonical.js";
import { Graph } from "../../graph-engine/core/graph.js";
import { exportGraph } from "../../graph-engine/core/export.js";
import type { GraphEdge, GraphNode } from "../../graph-engine/types/graph.types.js";

export type ExportedGraph = ReturnType<typeof exportGraph>;
export interface SnapshotPayload {
  nodes: ExportedGraph["nodes"];
  edges: ExportedGraph["edges"];
}

/** Everything about a graph except when it was built. */
export function snapshotPayload(g: Graph): SnapshotPayload {
  const exp = exportGraph(g, { edgeStatuses: ["active", "inactive"] });
  return { nodes: exp.nodes, edges: exp.edges };
}

/** SHA-256 of the canonical content (organization, nodes, edges). Build time is excluded so equal graphs hash equal. */
export const contentHash = (organizationId: string, payload: SnapshotPayload): string => canonicalHash({ organizationId, nodes: payload.nodes, edges: payload.edges });

/** Rebuilds an immutable Graph from a stored payload. */
export function graphFromPayload(organizationId: string, payload: SnapshotPayload, builtAt: Date): Graph {
  const nodes = payload.nodes as unknown as GraphNode[];
  const edges = payload.edges.map(
    (e) =>
      ({
        ...e,
        createdAt: new Date(e.createdAt),
        updatedAt: new Date(e.updatedAt),
        observedAt: e.observedAt ? new Date(e.observedAt) : null,
        lastVerifiedAt: e.lastVerifiedAt ? new Date(e.lastVerifiedAt) : null,
      }) as unknown as GraphEdge,
  );
  return new Graph(organizationId, nodes, edges, builtAt);
}

export interface SnapshotDiff {
  nodes: { added: string[]; removed: string[]; changed: Array<{ id: string; fields: string[] }> };
  edges: { added: string[]; removed: string[]; changed: Array<{ id: string; fields: string[] }> };
  identical: boolean;
}

/** Compares two stored graphs by id. Reports ids and the names of the fields that differ, not their values. */
export function diffPayloads(a: SnapshotPayload, b: SnapshotPayload): SnapshotDiff {
  const cmp = <T extends { id: string }>(x: readonly T[], y: readonly T[]) => {
    const mx = new Map(x.map((i) => [i.id, i]));
    const my = new Map(y.map((i) => [i.id, i]));
    const added = [...my.keys()].filter((k) => !mx.has(k)).sort();
    const removed = [...mx.keys()].filter((k) => !my.has(k)).sort();
    const changed: Array<{ id: string; fields: string[] }> = [];
    for (const [id, i] of [...mx].sort(([p], [q]) => (p < q ? -1 : 1))) {
      const j = my.get(id);
      if (!j) continue;
      const fields = [...new Set([...Object.keys(i), ...Object.keys(j)])]
        .filter((f) => canonicalHash((i as Record<string, unknown>)[f]) !== canonicalHash((j as Record<string, unknown>)[f]))
        .filter((f) => f !== "updatedAt")
        .sort();
      if (fields.length) changed.push({ id, fields });
    }
    return { added, removed, changed };
  };
  const nodes = cmp(a.nodes, b.nodes);
  const edges = cmp(a.edges, b.edges);
  const identical = [nodes, edges].every((d) => d.added.length + d.removed.length + d.changed.length === 0);
  return { nodes, edges, identical };
}
