import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { SnapshotMeta } from "../repositories/snapshot.repository.js";
import type { SnapshotService } from "../services/snapshot.service.js";

const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ format: "uuid" });
const Params = Type.Object({ snapshotId: Uuid }, strict);
const DiffParams = Type.Object({ fromId: Uuid, toId: Uuid }, strict);
const CreateBody = Type.Object({ label: Type.Optional(Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" })), incidentId: Type.Optional(Uuid) }, strict);
const ListQuery = Type.Object(
  { page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })), incidentId: Type.Optional(Uuid) },
  strict,
);
const Empty = Type.Object({}, strict);

const dto = (m: SnapshotMeta) => ({
  id: m.id, organizationId: m.organizationId, label: m.label, incidentId: m.incidentId, createdBy: m.createdBy,
  nodeCount: m.nodeCount, edgeCount: m.edgeCount, contentHash: m.contentHash,
  builtAt: m.builtAt.toISOString(), createdAt: m.createdAt.toISOString(),
});

export const snapshotRoutes: FastifyPluginAsyncTypebox<{ snapshots: SnapshotService }> = async (app, { snapshots }) => {
  app.post("/", { schema: { body: CreateBody } }, async (req, reply) => reply.code(201).send({ data: dto(await snapshots.create(req.principal, req.body)) }));

  app.get("/", { schema: { querystring: ListQuery } }, async (req) => {
    const { page = 1, limit = 20, incidentId } = req.query;
    const { items, total } = await snapshots.list(req.principal, { limit, offset: (page - 1) * limit }, incidentId);
    return { data: items.map(dto), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  });

  app.get("/:snapshotId", { schema: { params: Params, querystring: Empty } }, async (req) => ({ data: dto(await snapshots.get(req.principal, req.params.snapshotId)) }));

  app.get("/:snapshotId/graph", { schema: { params: Params, querystring: Empty } }, async (req) => {
    const rec = await snapshots.getPayload(req.principal, req.params.snapshotId);
    return { data: { snapshot: dto(rec), nodes: rec.payload.nodes, edges: rec.payload.edges } };
  });

  app.get("/:snapshotId/verify", { schema: { params: Params, querystring: Empty } }, async (req) => ({ data: await snapshots.verify(req.principal, req.params.snapshotId) }));

  app.get("/:fromId/diff/:toId", { schema: { params: DiffParams, querystring: Empty } }, async (req) => ({ data: await snapshots.diff(req.principal, req.params.fromId, req.params.toId) }));
};
