import { Type } from "typebox";

const Uuid = Type.String({ format: "uuid" });
const NonBlank = { pattern: "\\S" };

export const CreateOrganizationBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120, ...NonBlank }),
    slug: Type.String({ minLength: 2, maxLength: 60, pattern: "^[A-Za-z0-9-]+$" }),
    tier: Type.Optional(Type.Union([Type.Literal("starter"), Type.Literal("pro"), Type.Literal("enterprise")])),
  },
  { additionalProperties: false },
);

export const UpdateOrganizationBody = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120, ...NonBlank })),
    settings: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

export const InviteMemberBody = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 255, format: "email" }),
    role: Type.Union([
      Type.Literal("admin"),
      Type.Literal("operator"),
      Type.Literal("approver"),
      Type.Literal("viewer"),
    ]),
  },
  { additionalProperties: false },
);

export const MemberParams = Type.Object(
  {
    memberId: Uuid,
  },
  { additionalProperties: false },
);

const OrganizationDtoSchema = Type.Object({
  id: Uuid,
  name: Type.String(),
  slug: Type.String(),
  tier: Type.String(),
  planStatus: Type.String(),
  settings: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const MemberDtoSchema = Type.Object({
  id: Uuid,
  organizationId: Uuid,
  email: Type.String(),
  role: Type.String(),
  status: Type.String(),
  createdAt: Type.String(),
});

export const responses = {
  org: {
    200: Type.Object({ data: OrganizationDtoSchema }),
  },
  orgCreated: {
    201: Type.Object({ data: OrganizationDtoSchema }),
  },
  memberCreated: {
    201: Type.Object({ data: MemberDtoSchema }),
  },
  memberList: {
    200: Type.Object({ data: Type.Array(MemberDtoSchema) }),
  },
  memberItem: {
    200: Type.Object({ data: MemberDtoSchema }),
  },
};
