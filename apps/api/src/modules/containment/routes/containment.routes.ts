import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { ContainmentService } from "../services/containment.service.js";

const NodeId = Type.String({ pattern: "^(agent|resource):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });
const AgentId = Type.String({ pattern: "^agent:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });
const strict = { additionalProperties: false } as const;

const Body = Type.Object(
  {
    sourceNodeIds: Type.Array(AgentId, { minItems: 1, maxItems: 50, uniqueItems: true }),
    protectedNodeIds: Type.Optional(Type.Array(NodeId, { maxItems: 500, uniqueItems: true })),
    healthyWorkflows: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ minLength: 1, maxLength: 100 }),
            name: Type.Optional(Type.String({ maxLength: 200 })),
            from: Type.Optional(NodeId),
            to: Type.Optional(NodeId),
            edgeIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }), { maxItems: 500 })),
          },
          strict,
        ),
        { maxItems: 200 },
      ),
    ),
    coverage: Type.Optional(
      Type.Object(
        {
          uncontrollableEdgeIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }), { maxItems: 5000 })),
          edgeCosts: Type.Optional(Type.Record(Type.String({ format: "uuid" }), Type.Integer({ minimum: 1, maximum: 1_000_000 }))),
          defaultCost: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
        },
        strict,
      ),
    ),
    options: Type.Optional(
      Type.Object(
        {
          confidenceThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          staleAfterHours: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
          costApprovalThreshold: Type.Optional(Type.Integer({ minimum: 0 })),
          highValueNodeIds: Type.Optional(Type.Array(NodeId, { maxItems: 500 })),
        },
        strict,
      ),
    ),
    snapshotId: Type.Optional(Type.String({ format: "uuid" })),
  },
  strict,
);

/** POST because the request is a structured document. It is read-only and stores nothing: a plan is a proposal. */
export const containmentRoutes: FastifyPluginAsyncTypebox<{ containment: ContainmentService }> = async (app, { containment }) => {
  app.post("/plan", { schema: { body: Body } }, async (req) => {
    const { options, ...rest } = req.body;
    const { staleAfterHours, ...opts } = options ?? {};
    const out = await containment.plan(req.principal, {
      ...rest,
      options: { ...opts, ...(staleAfterHours !== undefined ? { staleAfterMs: staleAfterHours * 3_600_000 } : {}) },
    });
    return { data: { ...out.plan, protectedWasDefaulted: out.protectedWasDefaulted } };
  });
};
