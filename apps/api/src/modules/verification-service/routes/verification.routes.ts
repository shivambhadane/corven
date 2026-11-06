import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { safeCorrelationId } from "../../incident-management/core/validation.js";
import type { CheckRow, RunRow } from "../repositories/verification.repository.js";
import type { VerificationService } from "../services/verification.service.js";

const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ format: "uuid" });
const Empty = Type.Object({}, strict);
const Check = Type.Object({ agentId: Uuid, resourceId: Uuid, action: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.:-]+$" }) }, strict);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const corr = (req: { id: string; headers: Record<string, string | string[] | undefined> }) => {
  const h = req.headers["x-correlation-id"];
  return { correlationId: safeCorrelationId(Array.isArray(h) ? h[0] : h, req.id) };
};

export const runDto = (r: RunRow) => ({
  id: r.id, incidentId: r.incidentId, approvalId: r.approvalId, planReferenceId: r.planReferenceId, planHash: r.planHash, snapshotId: r.snapshotId, snapshotHash: r.snapshotHash,
  attempt: r.attempt, retryOf: r.retryOf, status: r.status, incidentOutcome: r.incidentOutcome, incidentSynced: r.incidentSynced, summary: r.summary, resultHash: r.resultHash,
  requestedBy: r.requestedBy, startedAt: iso(r.startedAt), completedAt: iso(r.completedAt), createdAt: iso(r.createdAt),
});
const checkDto = (c: CheckRow) => ({
  sequence: c.seq, category: c.category, purpose: c.purpose, agentId: c.agentId, resourceId: c.resourceId, action: c.action, expected: c.expected, actual: c.actual,
  result: c.result, detail: c.detail, executionReference: c.executionReference, limitation: c.limitation, observedAt: iso(c.observedAt),
});
const detail = (x: Awaited<ReturnType<VerificationService["get"]>>) => ({ ...runDto(x.run), resultHashMatches: x.resultHashMatches, checks: x.checks.map(checkDto) });

export const verificationRoutes: FastifyPluginAsyncTypebox<{ verification: VerificationService }> = async (app, { verification }) => {
  app.post("/verification/run", {
    schema: { body: Type.Object({ incidentId: Uuid, healthyChecks: Type.Optional(Type.Array(Check, { maxItems: 100 })), maliciousChecks: Type.Optional(Type.Array(Check, { maxItems: 100 })), idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }, strict) },
  }, async (req, reply) => reply.code(201).send({ data: detail(await verification.start(req.principal, req.body, corr(req))) }));
  app.get("/verification/:id", { schema: { params: Type.Object({ id: Uuid }, strict), querystring: Empty } }, async (req) => ({ data: detail(await verification.get(req.principal, req.params.id)) }));
  app.post("/verification/:id/retry", { schema: { params: Type.Object({ id: Uuid }, strict), body: Type.Optional(Empty) } }, async (req, reply) => reply.code(201).send({ data: detail(await verification.retry(req.principal, req.params.id, corr(req))) }));
  app.get("/incidents/:incidentId/verification", { schema: { params: Type.Object({ incidentId: Uuid }, strict), querystring: Empty } }, async (req) => ({ data: (await verification.listForIncident(req.principal, req.params.incidentId)).map(runDto) }));
};
