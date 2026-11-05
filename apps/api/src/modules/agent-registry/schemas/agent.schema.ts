import { Type, type Static } from "typebox";
import { AGENT_STATUSES, AGENT_TYPES, IDENTITY_TYPES, VERIFICATION_STATUSES } from "../types/agent.types.js";

// Literal unions are spelled out so TypeScript infers precise types. The
// compile-time checks below fail if these drift from the domain constants.
export const AgentStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("suspended"),
  Type.Literal("compromised"),
  Type.Literal("inactive"),
]);
export const AgentTypeSchema = Type.Union([
  Type.Literal("llm"),
  Type.Literal("workflow"),
  Type.Literal("service"),
  Type.Literal("wallet"),
  Type.Literal("other"),
]);
const IdentityTypeSchema = Type.Union([
  Type.Literal("ens"),
  Type.Literal("evm_address"),
  Type.Literal("did"),
  Type.Literal("api_client"),
  Type.Literal("other"),
]);
const VerificationStatusSchema = Type.Union([
  Type.Literal("unverified"),
  Type.Literal("pending"),
  Type.Literal("verified"),
  Type.Literal("failed"),
]);

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _statusInSync: Same<Static<typeof AgentStatusSchema>, (typeof AGENT_STATUSES)[number]> = true;
const _typeInSync: Same<Static<typeof AgentTypeSchema>, (typeof AGENT_TYPES)[number]> = true;
const _identityInSync: Same<Static<typeof IdentityTypeSchema>, (typeof IDENTITY_TYPES)[number]> = true;
const _verificationInSync: Same<Static<typeof VerificationStatusSchema>, (typeof VERIFICATION_STATUSES)[number]> = true;
void [_statusInSync, _typeInSync, _identityInSync, _verificationInSync];

const NonBlank = { pattern: "\\S" };
const Uuid = Type.String({ format: "uuid" });
const NameSchema = Type.String({ minLength: 1, maxLength: 120, ...NonBlank });
const DescriptionSchema = Type.String({ maxLength: 2000 });
const MetadataSchema = Type.Record(Type.String(), Type.Unknown());

export const IdentityInputSchema = Type.Object(
  {
    identityType: IdentityTypeSchema,
    identityValue: Type.String({ minLength: 1, maxLength: 255, ...NonBlank }),
    chainId: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

// ---------- request schemas (additionalProperties:false => mass assignment is a 400)

export const CreateAgentBody = Type.Object(
  {
    name: NameSchema,
    description: Type.Optional(DescriptionSchema),
    agentType: AgentTypeSchema,
    capabilities: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 100 })),
    identities: Type.Optional(Type.Array(IdentityInputSchema, { maxItems: 20 })),
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const UpdateAgentBody = Type.Object(
  {
    name: Type.Optional(NameSchema),
    description: Type.Optional(Type.Union([DescriptionSchema, Type.Null()])),
    agentType: Type.Optional(AgentTypeSchema),
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const ChangeStatusBody = Type.Object(
  {
    status: AgentStatusSchema,
    reason: Type.String({ minLength: 1, maxLength: 1000, ...NonBlank }),
    incidentId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);

export const PutCapabilitiesBody = Type.Object(
  { capabilities: Type.Array(Type.String({ maxLength: 100 }), { maxItems: 100 }) },
  { additionalProperties: false },
);

export const PutIdentitiesBody = Type.Object(
  { identities: Type.Array(IdentityInputSchema, { maxItems: 20 }) },
  { additionalProperties: false },
);

export const AgentParams = Type.Object({ agentId: Uuid }, { additionalProperties: false });

export const ListAgentsQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
    offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
    status: Type.Optional(AgentStatusSchema),
    agentType: Type.Optional(AgentTypeSchema),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);

export const HistoryQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
    offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  },
  { additionalProperties: false },
);

// ---------- response schemas (also act as an allow-list when serialising)

const IdentityResponse = Type.Object({
  id: Uuid,
  identityType: IdentityTypeSchema,
  identityValue: Type.String(),
  verificationStatus: VerificationStatusSchema,
  chainId: Type.Union([Type.Integer(), Type.Null()]),
  verifiedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const agentResponseProps = {
  id: Uuid,
  organizationId: Uuid,
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  agentType: AgentTypeSchema,
  status: AgentStatusSchema,
  metadata: MetadataSchema,
  createdAt: Type.String(),
  updatedAt: Type.String(),
};
const AgentResponse = Type.Object(agentResponseProps);

const AgentDetailResponse = Type.Object({
  ...agentResponseProps,
  capabilities: Type.Array(Type.String()),
  identities: Type.Array(IdentityResponse),
});

const HistoryResponse = Type.Object({
  id: Uuid,
  agentId: Uuid,
  previousStatus: Type.Union([AgentStatusSchema, Type.Null()]),
  newStatus: AgentStatusSchema,
  actorId: Type.Union([Uuid, Type.Null()]),
  reason: Type.String(),
  incidentId: Type.Union([Uuid, Type.Null()]),
  createdAt: Type.String(),
});

const Pagination = Type.Object({ limit: Type.Integer(), offset: Type.Integer(), total: Type.Integer() });
const ErrorEnvelope = Type.Object({
  error: Type.Object({ code: Type.String(), message: Type.String(), details: Type.Optional(Type.Unknown()) }),
});

export const responses = {
  agent: { 200: Type.Object({ data: AgentDetailResponse }), 404: ErrorEnvelope },
  created: { 201: Type.Object({ data: AgentDetailResponse }) },
  list: { 200: Type.Object({ data: Type.Array(AgentResponse), pagination: Pagination }) },
  capabilities: { 200: Type.Object({ data: Type.Object({ capabilities: Type.Array(Type.String()) }) }) },
  identities: { 200: Type.Object({ data: Type.Object({ identities: Type.Array(IdentityResponse) }) }) },
  history: { 200: Type.Object({ data: Type.Array(HistoryResponse), pagination: Pagination }) },
};
