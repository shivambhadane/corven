import type { GraphEdge, GraphMetadata, GraphNode, NodeType } from "../types/graph.types.js";

const EMPTY: readonly GraphEdge[] = Object.freeze([]);

/**
 * Immutable directed multigraph over agents and resources. Built once by
 * buildGraph(); there are no mutators. Adjacency stores edge ids per node,
 * sorted by (neighbour node id, edge id) so every traversal is deterministic.
 * Accessors return frozen objects or fresh arrays, so callers cannot corrupt
 * the internal indexes.
 */
export class Graph {
  readonly organizationId: string;
  readonly metadata: Readonly<GraphMetadata>;

  private readonly nodesById: ReadonlyMap<string, GraphNode>;
  private readonly edgesById: ReadonlyMap<string, GraphEdge>;
  private readonly outgoing: ReadonlyMap<string, readonly GraphEdge[]>;
  private readonly incoming: ReadonlyMap<string, readonly GraphEdge[]>;
  private readonly byEntity: ReadonlyMap<string, GraphNode>;
  private readonly sortedNodes: readonly GraphNode[];
  private readonly sortedEdges: readonly GraphEdge[];

  /** Use buildGraph(); the constructor trusts that its inputs were validated. */
  constructor(organizationId: string, nodes: readonly GraphNode[], edges: readonly GraphEdge[], builtAt: Date = new Date()) {
    this.organizationId = organizationId;

    const frozenNodes = nodes.map((n) => Object.freeze({ ...n }));
    const frozenEdges = edges.map((e) =>
      Object.freeze({ ...e, provenance: Object.freeze({ ...e.provenance }), metadata: Object.freeze({ ...e.metadata }) }),
    );
    this.sortedNodes = Object.freeze([...frozenNodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
    this.sortedEdges = Object.freeze([...frozenEdges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
    this.nodesById = new Map(this.sortedNodes.map((n) => [n.id, n]));
    this.edgesById = new Map(this.sortedEdges.map((e) => [e.id, e]));
    this.byEntity = new Map(this.sortedNodes.map((n) => [`${n.entityType}:${n.entityId}`, n]));

    const out = new Map<string, GraphEdge[]>();
    const inc = new Map<string, GraphEdge[]>();
    for (const e of this.sortedEdges) {
      (out.get(e.sourceNodeId) ?? out.set(e.sourceNodeId, []).get(e.sourceNodeId)!).push(e);
      (inc.get(e.targetNodeId) ?? inc.set(e.targetNodeId, []).get(e.targetNodeId)!).push(e);
    }
    const byNeighbour = (key: "targetNodeId" | "sourceNodeId") => (a: GraphEdge, b: GraphEdge) =>
      a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    for (const list of out.values()) list.sort(byNeighbour("targetNodeId"));
    for (const list of inc.values()) list.sort(byNeighbour("sourceNodeId"));
    this.outgoing = new Map([...out].map(([k, v]) => [k, Object.freeze(v)]));
    this.incoming = new Map([...inc].map(([k, v]) => [k, Object.freeze(v)]));

    this.metadata = Object.freeze({ nodeCount: this.sortedNodes.length, edgeCount: this.sortedEdges.length, builtAt });
  }

  hasNode(id: string): boolean {
    return this.nodesById.has(id);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodesById.get(id);
  }

  getNodeByEntity(entityType: NodeType, entityId: string): GraphNode | undefined {
    return this.byEntity.get(`${entityType}:${entityId}`);
  }

  getEdge(id: string): GraphEdge | undefined {
    return this.edgesById.get(id);
  }

  /** All nodes, sorted by id. */
  nodes(): readonly GraphNode[] {
    return this.sortedNodes;
  }

  /** All edges, sorted by id. */
  edges(): readonly GraphEdge[] {
    return this.sortedEdges;
  }

  outgoingEdges(nodeId: string): readonly GraphEdge[] {
    return this.outgoing.get(nodeId) ?? EMPTY;
  }

  incomingEdges(nodeId: string): readonly GraphEdge[] {
    return this.incoming.get(nodeId) ?? EMPTY;
  }
}

export const nodeIdFor = (entityType: NodeType, entityId: string): string => `${entityType}:${entityId}`;
