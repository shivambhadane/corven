import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { BlastRadiusService } from "../services/blast-radius.service.js";

const NodeId = Type.String({ pattern: "^agent:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });
const Body = Type.Object(
  {
    sourceNodeIds: Type.Array(NodeId, { minItems: 1, maxItems: 50, uniqueItems: true }),
    confidenceThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    staleAfterHours: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    snapshotId: Type.Optional(Type.String({ format: "uuid" })),
  },
  { additionalProperties: false },
);

/**
 * POST because the request carries a list of compromised agents. It is read-only:
 * it computes an analysis and stores nothing.
 */
export const blastRadiusRoutes: FastifyPluginAsyncTypebox<{ blast: BlastRadiusService }> = async (app, { blast }) => {
  app.post("/analyze", { schema: { body: Body } }, async (req) => {
    const { sourceNodeIds, confidenceThreshold, staleAfterHours, snapshotId } = req.body;
    const result = await blast.analyze(req.principal, {
      sourceNodeIds,
      confidenceThreshold,
      staleAfterMs: staleAfterHours !== undefined ? staleAfterHours * 3_600_000 : undefined,
      snapshotId,
    });
    return { data: result };
  });
};
