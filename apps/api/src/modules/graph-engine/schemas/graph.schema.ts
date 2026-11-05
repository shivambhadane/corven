import { Type } from "typebox";

const Literals = {
  entityType: Type.Union([Type.Literal("agent"), Type.Literal("resource")]),
  dependencyType: Type.Union([Type.Literal("authority"), Type.Literal("resource"), Type.Literal("operational")]),
  edgeStatus: Type.Union([Type.Literal("active"), Type.Literal("inactive")]),
  traverseDirection: Type.Union([Type.Literal("forward"), Type.Literal("reverse"), Type.Literal("both")]),
  neighbourDirection: Type.Union([Type.Literal("incoming"), Type.Literal("outgoing"), Type.Literal("both")]),
};

/** `agent:<uuid>` or `resource:<uuid>`. */
const NodeId = Type.String({ pattern: "^(agent|resource):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });

const DependencyTypes = Type.Optional(Type.Array(Literals.dependencyType, { maxItems: 3, uniqueItems: true }));
const FilterProps = {
  dependencyTypes: DependencyTypes,
  includeInactive: Type.Optional(Type.Boolean()),
  minConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
};
const Page = {
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
};
const strict = { additionalProperties: false } as const;

// ---------- requests
export const NodeParams = Type.Object({ nodeId: NodeId }, strict);
export const EmptyQuery = Type.Object({}, strict);
export const ListNodesQuery = Type.Object({ entityType: Type.Optional(Literals.entityType), status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })), ...Page }, strict);
export const ListEdgesQuery = Type.Object(
  {
    dependencyType: Type.Optional(Literals.dependencyType),
    status: Type.Optional(Literals.edgeStatus),
    sourceNodeId: Type.Optional(NodeId),
    targetNodeId: Type.Optional(NodeId),
    minConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    ...Page,
  },
  strict,
);
export const NeighboursQuery = Type.Object(
  {
    direction: Type.Optional(Literals.neighbourDirection),
    maxDepth: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    ...FilterProps,
  },
  strict,
);
export const TraverseQuery = Type.Object(
  {
    startNodeId: NodeId,
    algorithm: Type.Optional(Type.Union([Type.Literal("bfs"), Type.Literal("dfs")])),
    direction: Type.Optional(Literals.traverseDirection),
    maxDepth: Type.Optional(Type.Integer({ minimum: 0 })),
    ...FilterProps,
  },
  strict,
);
export const ReachabilityQuery = Type.Object(
  {
    sourceNodeId: NodeId,
    targetNodeId: NodeId,
    direction: Type.Optional(Literals.traverseDirection),
    maxDepth: Type.Optional(Type.Integer({ minimum: 0 })),
    ...FilterProps,
  },
  strict,
);
export const PathsQuery = Type.Object(
  {
    sourceNodeId: NodeId,
    targetNodeId: NodeId,
    maxPaths: Type.Optional(Type.Integer({ minimum: 1 })),
    maxDepth: Type.Optional(Type.Integer({ minimum: 0 })),
    ...FilterProps,
  },
  strict,
);
export const ComponentsQuery = Type.Object({ entityType: Type.Optional(Literals.entityType), ...FilterProps }, strict);
export const CyclesQuery = Type.Object(
  { maxCycles: Type.Optional(Type.Integer({ minimum: 1 })), maxLength: Type.Optional(Type.Integer({ minimum: 1 })), ...FilterProps },
  strict,
);
export const ExportQuery = Type.Object({ entityType: Type.Optional(Literals.entityType), ...FilterProps }, strict);
