import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { safeCorrelationId } from "../incident-management/core/validation.js";
import type { AnchorRow, EvidenceRow } from "./repositories.js";
import type { EvidenceService } from "./services/evidence.service.js";

const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ format: "uuid" });
const Empty = Type.Object({}, strict);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const corr = (req: { id: string; headers: Record<string, string | string[] | undefined> }) => {
  const h = req.headers["x-correlation-id"];
  return { correlationId: safeCorrelationId(Array.isArray(h) ? h[0] : h, req.id) };
};
const summary = (r: EvidenceRow) => ({
  id: r.id, incidentId: r.incidentId, sequence: r.sequence, schemaVersion: r.schemaVersion, status: r.status, contentHash: r.contentHash, previousEvidenceId: r.previousEvidenceId,
  previousHash: r.previousHash, createdBy: r.createdBy, createdByType: r.createdByType, createdAt: iso(r.createdAt), lastVerifiedAt: iso(r.lastVerifiedAt),
});
const anchorDto = (a: AnchorRow) => ({
  target: a.target, status: a.status, anchoredHash: a.anchoredHash, externalReference: a.externalReference, chainId: a.chainId, contractAddress: a.contractAddress, blockNumber: a.blockNumber,
  confirmations: a.confirmations, requiredConfirmations: a.requiredConfirmations, error: a.error, attempts: a.attempts, updatedAt: iso(a.updatedAt),
});
const Targets = Type.Optional(Type.Array(Type.Union([Type.Literal("arkiv"), Type.Literal("ethereum")]), { minItems: 1, maxItems: 2, uniqueItems: true }));

export const evidenceRoutes: FastifyPluginAsyncTypebox<{ evidence: EvidenceService }> = async (app, { evidence }) => {
  app.post("/evidence/generate", { schema: { body: Type.Object({ incidentId: Uuid }, strict) } }, async (req, reply) => {
    const r = await evidence.generate(req.principal, req.body.incidentId, corr(req));
    return reply.code(201).send({ data: { ...summary(r), content: r.content } });
  });
  app.get("/evidence/:id", { schema: { params: Type.Object({ id: Uuid }, strict), querystring: Empty } }, async (req) => {
    const { record, anchors } = await evidence.get(req.principal, req.params.id);
    return { data: { ...summary(record), content: record.content, anchors: anchors.map(anchorDto) } };
  });
  app.post("/evidence/:id/verify", { schema: { params: Type.Object({ id: Uuid }, strict), body: Type.Optional(Empty) } }, async (req) => {
    const r = await evidence.verify(req.principal, req.params.id);
    return { data: { valid: r.valid, status: r.record.status, steps: r.steps, anchors: r.anchors.map(anchorDto) } };
  });
  app.post("/evidence/:id/anchor", { schema: { params: Type.Object({ id: Uuid }, strict), body: Type.Object({ targets: Targets }, strict) } }, async (req, reply) => {
    const r = await evidence.anchor(req.principal, req.params.id, req.body.targets);
    return reply.code(202).send({ data: { ...summary(r.record), anchors: r.anchors.map(anchorDto) } });
  });
  app.post("/evidence/:id/anchors/refresh", { schema: { params: Type.Object({ id: Uuid }, strict), body: Type.Optional(Empty) } }, async (req) => {
    const r = await evidence.refresh(req.principal, req.params.id);
    return { data: { ...summary(r.record), anchors: r.anchors.map(anchorDto), steps: r.steps } };
  });
  app.get("/evidence/:id/verifications", { schema: { params: Type.Object({ id: Uuid }, strict), querystring: Empty } }, async (req) => ({
    data: (await evidence.logs(req.principal, req.params.id)).map((l) => ({ valid: l.valid, checks: l.checks, actorId: l.actorId, actorType: l.actorType, at: iso(l.createdAt) })),
  }));
  app.get("/incidents/:incidentId/evidence", { schema: { params: Type.Object({ incidentId: Uuid }, strict), querystring: Empty } }, async (req) => ({
    data: (await evidence.listForIncident(req.principal, req.params.incidentId)).map(summary),
  }));
};
