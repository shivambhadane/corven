import { Type } from "typebox";

const Uuid = Type.String({ format: "uuid" });
const NonBlank = { pattern: "\\S" };

export const CreateApiKeyBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80, ...NonBlank }),
    scopes: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 40 }))),
    expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
  },
  { additionalProperties: false },
);

export const ApiKeyParams = Type.Object(
  {
    id: Uuid,
  },
  { additionalProperties: false },
);

const ApiKeyDtoSchema = Type.Object({
  id: Uuid,
  organizationId: Uuid,
  name: Type.String(),
  prefix: Type.String(),
  scopes: Type.Array(Type.String()),
  lastUsedAt: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  revokedAt: Type.Union([Type.String(), Type.Null()]),
  createdBy: Uuid,
  createdAt: Type.String(),
});

const CreatedApiKeyDtoSchema = Type.Intersect([
  ApiKeyDtoSchema,
  Type.Object({
    rawKey: Type.String(),
  }),
]);

export const responses = {
  created: {
    201: Type.Object({ data: CreatedApiKeyDtoSchema }),
  },
  list: {
    200: Type.Object({ data: Type.Array(ApiKeyDtoSchema) }),
  },
  item: {
    200: Type.Object({ data: ApiKeyDtoSchema }),
  },
};
