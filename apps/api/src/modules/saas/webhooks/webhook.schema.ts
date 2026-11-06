import { Type } from "typebox";

const Uuid = Type.String({ format: "uuid" });

export const CreateWebhookBody = Type.Object(
  {
    url: Type.String({ minLength: 8, maxLength: 2000 }),
    events: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 60 }))),
  },
  { additionalProperties: false },
);

export const WebhookParams = Type.Object(
  {
    id: Uuid,
  },
  { additionalProperties: false },
);

export const ListDeliveriesQuery = Type.Object(
  {
    webhookId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);

const WebhookDtoSchema = Type.Object({
  id: Uuid,
  organizationId: Uuid,
  url: Type.String(),
  secret: Type.String(),
  events: Type.Array(Type.String()),
  status: Type.String(),
  createdAt: Type.String(),
});

const DeliveryDtoSchema = Type.Object({
  id: Uuid,
  organizationId: Uuid,
  webhookId: Uuid,
  event: Type.String(),
  statusCode: Type.Union([Type.Integer(), Type.Null()]),
  durationMs: Type.Union([Type.Integer(), Type.Null()]),
  success: Type.Boolean(),
  error: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export const responses = {
  created: {
    201: Type.Object({ data: WebhookDtoSchema }),
  },
  list: {
    200: Type.Object({ data: Type.Array(WebhookDtoSchema) }),
  },
  item: {
    200: Type.Object({ data: WebhookDtoSchema }),
  },
  deliveries: {
    200: Type.Object({ data: Type.Array(DeliveryDtoSchema) }),
  },
};
