import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { GraphError } from "../errors.js";
import { LIMITS } from "../types/graph.types.js";
import { edgeDto, nodeDto, pageInfo, pathsWithContext, reportDto, toFilter } from "../controllers/graph.controller.js";
import {
  ComponentsQuery,
  CyclesQuery,
  EmptyQuery,
  ExportQuery,
  ListEdgesQuery,
  ListNodesQuery,
  NeighboursQuery,
  NodeParams,
  PathsQuery,
  ReachabilityQuery,
  TraverseQuery,
} from "../schemas/graph.schema.js";
import { overview, requireNodeParam, type GraphQueryService } from "../services/graph-query.service.js";

const slice = <T>(items: T[], page: number, limit: number) => items.slice((page - 1) * limit, page * limit);

export const graphRoutes: FastifyPluginAsyncTypebox<{ graphs: GraphQueryService }> = async (app, { graphs }) => {
  // The organization always comes from the authenticated principal. Every request
  // builds a fresh, consistent graph from the registries (nothing is stored).

  app.post("/build", { schema: { querystring: EmptyQuery } }, async (req) => {
    const { graph, report, durationMs } = await graphs.buildFor(req.principal);
    req.log.info({ nodes: graph.metadata.nodeCount, edges: graph.metadata.edgeCount, invalid: report.issues.length, durationMs }, "graph built");
    return { data: { ...overview(graph), metadata: { ...overview(graph).metadata, durationMs }, report: reportDto(report) } };
  });

  app.get("/", { schema: { querystring: EmptyQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    return { data: overview(graph) };
  });

  app.get("/nodes", { schema: { querystring: ListNodesQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    const { entityType, status, page = 1, limit = 50 } = req.query;
    const all = graph.nodes().filter((n) => (!entityType || n.entityType === entityType) && (!status || n.status === status));
    return { data: slice(all, page, limit).map(nodeDto), pagination: pageInfo(page, limit, all.length) };
  });

  app.get("/nodes/:nodeId", { schema: { params: NodeParams, querystring: EmptyQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    const node = requireNodeParam(graph, req.params.nodeId);
    const count = (edges: readonly { status: string }[]) => ({
      active: edges.filter((e) => e.status === "active").length,
      inactive: edges.filter((e) => e.status === "inactive").length,
    });
    return { data: { ...nodeDto(node), outgoing: count(graph.outgoingEdges(node.id)), incoming: count(graph.incomingEdges(node.id)) } };
  });

  app.get("/edges", { schema: { querystring: ListEdgesQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    const { dependencyType, status = "active", sourceNodeId, targetNodeId, minConfidence = 0, page = 1, limit = 50 } = req.query;
    const all = graph.edges().filter(
      (e) =>
        e.status === status &&
        (!dependencyType || e.dependencyType === dependencyType) &&
        (!sourceNodeId || e.sourceNodeId === sourceNodeId) &&
        (!targetNodeId || e.targetNodeId === targetNodeId) &&
        e.confidence >= minConfidence,
    );
    return { data: slice(all, page, limit).map(edgeDto), pagination: pageInfo(page, limit, all.length) };
  });

  app.get("/nodes/:nodeId/neighbours", { schema: { params: NodeParams, querystring: NeighboursQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    const start = requireNodeParam(graph, req.params.nodeId);
    const { direction = "both", maxDepth = 1 } = req.query;
    const dir = direction === "outgoing" ? "forward" : direction === "incoming" ? "reverse" : "both";
    const res = graphs.traverse(graph, "bfs", start.id, { direction: dir, maxDepth, filter: toFilter(req.query) });
    return {
      data: {
        node: nodeDto(start),
        direction,
        maxDepth,
        neighbours: res.visited.slice(1).map((v) => ({ node: nodeDto(graph.getNode(v.nodeId)!), depth: v.depth, viaEdgeId: v.viaEdgeId, fromNodeId: v.fromNodeId })),
        edges: res.edgeIds.map((id) => edgeDto(graph.getEdge(id)!)),
        truncatedByDepth: res.truncatedByDepth,
      },
    };
  });

  app.get("/traverse", { schema: { querystring: TraverseQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    const { startNodeId, algorithm = "bfs", direction = "forward", maxDepth = LIMITS.defaultDepth } = req.query;
    const res = graphs.traverse(graph, algorithm, startNodeId, { direction, maxDepth, filter: toFilter(req.query) });
    return {
      data: {
        algorithm: res.algorithm,
        startNodeId,
        direction,
        maxDepth,
        visited: res.visited.map((v) => ({ ...v, node: nodeDto(graph.getNode(v.nodeId)!) })),
        edges: res.edgeIds.map((id) => edgeDto(graph.getEdge(id)!)),
        truncatedByDepth: res.truncatedByDepth,
      },
    };
  });

  app.get("/reachability", { schema: { querystring: ReachabilityQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    const { sourceNodeId, targetNodeId, direction = "forward", maxDepth = LIMITS.defaultDepth } = req.query;
    const res = graphs.reachability(graph, sourceNodeId, targetNodeId, { direction, maxDepth, filter: toFilter(req.query) });
    return { data: { sourceNodeId, targetNodeId, direction, maxDepth, ...res } };
  });

  app.get("/paths", { schema: { querystring: PathsQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    const { sourceNodeId, targetNodeId, maxPaths = LIMITS.defaultPaths, maxDepth = LIMITS.defaultDepth } = req.query;
    const res = graphs.paths(graph, sourceNodeId, targetNodeId, { maxPaths, maxDepth, filter: toFilter(req.query) });
    return { data: { sourceNodeId, targetNodeId, ...res, ...pathsWithContext(graph, res.paths) } };
  });

  app.get("/components", { schema: { querystring: ComponentsQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    const components = graphs.components(graph, toFilter(req.query));
    return { data: { semantics: "weakly connected (edge direction ignored)", count: components.length, components } };
  });

  app.get("/cycles", { schema: { querystring: CyclesQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    const { maxCycles = LIMITS.defaultCycles, maxLength = LIMITS.defaultCycleLength } = req.query;
    const res = graphs.cycles(graph, { maxCycles, maxLength, filter: toFilter(req.query) });
    const cycles = res.cycles.map((c) => ({ ...c, edges: c.edgeIds.map((id) => edgeDto(graph.getEdge(id)!)) }));
    return { data: { ...res, cycles } };
  });

  app.get("/export", { schema: { querystring: ExportQuery } }, async (req) => {
    const { graph } = await graphs.buildFor(req.principal);
    return { data: graphs.export(graph, toFilter(req.query)) };
  });
};

export { GraphError };
