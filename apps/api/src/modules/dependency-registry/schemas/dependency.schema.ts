import { Type, type Static } from "typebox";
import {
  DEPENDENCY_STATUSES,
  DEPENDENCY_TYPES,
  ENTITY_TYPES,
  PROVENANCE_SOURCES,
  RESOURCE_TYPES,
  CHANGE_TYPES,
} from "../types/dependency.types.js";

// Literal unions are spelled out so TypeScript infers precise types; the checks
// below fail compilation if they drift from the domain constants.
export const EntityTypeSchema = Type.Union([Type.Literal("agent"), Type.Literal("resource")]);
export const DependencyTypeSchema = Type.Union([Type.Literal("authority"), Type.Literal("resource"), Type.Literal("operational")]);
export const DependencyStatusSchema = Type.Union([Type.Literal("active"), Type.Literal("inactive")]);
const ProvenanceSourceSchema = Type.Union([
  Type.Literal("manual"),
  Type.Literal("imported"),
  Type.Literal("discovered"),
  Type.Literal("inferred"),
]);
export const ResourceTypeSchema = Type.Union([
  Type.Literal("api"),
  Type.Literal("database"),
  Type.Literal("wallet"),
  Type.Literal("credential"),
  Type.Literal("storage"),
  Type.Literal("service"),
  Type.Literal("workflow"),
  Type.Literal("mcp_server"),
  Type.Literal("queue"),
  Type.Literal("other"),
]);
const ChangeTypeSchema = Type.Union([
  Type.Literal("created"),
  Type.Literal("updated"),
  Type.Literal("activated"),
  Type.Literal("deactivated"),
  Type.Literal("removed"),
]);

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _a: Same<Static<typeof EntityTypeSchema>, (typeof ENTITY_TYPES)[number]> = true;
const _b: Same<Static<typeof DependencyTypeSchema>, (typeof DEPENDENCY_TYPES)[number]> = true;
const _c: Same<Static<typeof DependencyStatusSchema>, (typeof DEPENDENCY_STATUSES)[number]> = true;
const _d: Same<Static<typeof ProvenanceSourceSchema>, (typeof PROVENANCE_SOURCES)[number]> = true;
const _e: Same<Static<typeof ResourceTypeSchema>, (typeof RESOURCE_TYPES)[number]> = true;
const _f: Same<Static<typeof ChangeTypeSchema>, (typeof CHANGE_TYPES)[number]> = true;
void [_a, _b, _c, _d, _e, _f];

const Uuid = Type.String({ format: "uuid" });
const NonBlank = { pattern: "\\S" };
const Metadata = Type.Record(Type.String(), Type.Unknown());
const Confidence = Type.Number({ minimum: 0, maximum: 1 });
const DateTime = Type.String({ format: "date-time" });

export const ProvenanceSchema = Type.Object(
  {
    source: ProvenanceSourceSchema,
    reference: Type.Optional(Type.String({ maxLength: 500 })),
    note: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false },
);

// ---------- requests (unknown fields => 400; org id is never accepted)

export const CreateDependencyBody = Type.Object(
  {
    sourceType: EntityTypeSchema,
    sourceId: Uuid,
    targetType: EntityTypeSchema,
    targetId: Uuid,
    dependencyType: DependencyTypeSchema,
    relationship: Type.String({ minLength: 1, maxLength: 100, ...NonBlank }),
    metadata: Type.Optional(Metadata),
    provenance: ProvenanceSchema,
    confidence: Type.Optional(Confidence),
    observedAt: Type.Optional(DateTime),
    lastVerifiedAt: Type.Optional(DateTime),
  },
  { additionalProperties: false },
);

export const UpdateDependencyBody = Type.Object(
  {
    expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    relationship: Type.Optional(Type.String({ minLength: 1, maxLength: 100, ...NonBlank })),
    metadata: Type.Optional(Metadata),
    provenance: Type.Optional(ProvenanceSchema),
    confidence: Type.Optional(Confidence),
    observedAt: Type.Optional(Type.Union([DateTime, Type.Null()])),
    lastVerifiedAt: Type.Optional(Type.Union([DateTime, Type.Null()])),
    status: Type.Optional(DependencyStatusSchema),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const DependencyParams = Type.Object({ dependencyId: Uuid }, { additionalProperties: false });
export const AgentParams = Type.Object({ agentId: Uuid }, { additionalProperties: false });
export const DeleteQuery = Type.Object({ expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false });

const PageProps = {
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
};

export const ListDependenciesQuery = Type.Object(
  {
    ...PageProps,
    dependencyType: Type.Optional(DependencyTypeSchema),
    status: Type.Optional(DependencyStatusSchema),
    sourceType: Type.Optional(EntityTypeSchema),
    sourceId: Type.Optional(Uuid),
    targetType: Type.Optional(EntityTypeSchema),
    targetId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);

export const AgentDependenciesQuery = Type.Object(
  {
    ...PageProps,
    direction: Type.Optional(Type.Union([Type.Literal("incoming"), Type.Literal("outgoing"), Type.Literal("both")], { default: "both" })),
    dependencyType: Type.Optional(DependencyTypeSchema),
    status: Type.Optional(DependencyStatusSchema),
  },
  { additionalProperties: false },
);

export const VersionsQuery = Type.Object(PageProps, { additionalProperties: false });

// ---------- responses (allow-list when serialising)

const DependencyResponse = Type.Object({
  id: Uuid,
  organizationId: Uuid,
  sourceType: EntityTypeSchema,
  sourceId: Uuid,
  targetType: EntityTypeSchema,
  targetId: Uuid,
  dependencyType: DependencyTypeSchema,
  relationship: Type.String(),
  metadata: Metadata,
  provenance: ProvenanceSchema,
  confidence: Type.Number(),
  observedAt: Type.Union([Type.String(), Type.Null()]),
  lastVerifiedAt: Type.Union([Type.String(), Type.Null()]),
  status: DependencyStatusSchema,
  version: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const VersionResponse = Type.Object({
  id: Uuid,
  dependencyId: Uuid,
  version: Type.Integer(),
  changeType: ChangeTypeSchema,
  changedBy: Type.Union([Uuid, Type.Null()]),
  state: Type.Unknown(),
  createdAt: Type.String(),
});

const EvidenceResponse = Type.Object({
  id: Uuid,
  dependencyId: Uuid,
  sourceType: Type.Union([
    Type.Literal("manual"),
    Type.Literal("agent_configuration"),
    Type.Literal("workflow_definition"),
    Type.Literal("permission_configuration"),
    Type.Literal("runtime_event"),
    Type.Literal("external_integration"),
  ]),
  sourceReference: Type.Union([Type.String(), Type.Null()]),
  discoveryRunId: Type.Union([Uuid, Type.Null()]),
  evidenceKind: Type.Union([Type.Literal("declared"), Type.Literal("configured"), Type.Literal("observed")]),
  evidenceReference: Type.Union([Type.String(), Type.Null()]),
  sourceVersion: Type.Union([Type.String(), Type.Null()]),
  confidence: Type.Number(),
  observedAt: Type.String(),
  createdAt: Type.String(),
});

const Pagination = Type.Object({ page: Type.Integer(), limit: Type.Integer(), total: Type.Integer(), totalPages: Type.Integer() });

export const dependencyResponses = {
  one: { 200: Type.Object({ data: DependencyResponse }) },
  created: { 201: Type.Object({ data: DependencyResponse }) },
  list: { 200: Type.Object({ data: Type.Array(DependencyResponse), pagination: Pagination }) },
  versions: { 200: Type.Object({ data: Type.Array(VersionResponse), pagination: Pagination }) },
  evidence: { 200: Type.Object({ data: Type.Array(EvidenceResponse), pagination: Pagination }) },
};

// ---------- resources (minimum model)

export const CreateResourceBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120, ...NonBlank }),
    resourceType: ResourceTypeSchema,
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    externalReference: Type.Optional(Type.String({ minLength: 1, maxLength: 255, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/@-]*$" })),
    metadata: Type.Optional(Metadata),
  },
  { additionalProperties: false },
);
export const ResourceParams = Type.Object({ resourceId: Uuid }, { additionalProperties: false });
export const ListResourcesQuery = Type.Object(PageProps, { additionalProperties: false });

const ResourceResponse = Type.Object({
  id: Uuid,
  organizationId: Uuid,
  name: Type.String(),
  resourceType: ResourceTypeSchema,
  description: Type.Union([Type.String(), Type.Null()]),
  externalReference: Type.Union([Type.String(), Type.Null()]),
  metadata: Metadata,
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const resourceResponses = {
  one: { 200: Type.Object({ data: ResourceResponse }) },
  created: { 201: Type.Object({ data: ResourceResponse }) },
  list: { 200: Type.Object({ data: Type.Array(ResourceResponse), pagination: Pagination }) },
};
