import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { safeCorrelationId } from "../../incident-management/core/validation.js";
import type { ApprovalRow, DecisionRow } from "../repositories/approval.repository.js";
import type { ApprovalService } from "../services/approval.service.js";
import { APPROVAL_STATUSES } from "../types.js";

const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ format: "uuid" });
const IdParams = Type.Object({ id: Uuid }, strict);
const Empty = Type.Object({}, strict);
const Comment = Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" });
const Page = { page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })) };
const Status = Type.Unsafe<(typeof APPROVAL_STATUSES)[number]>(Type.Union(APPROVAL_STATUSES.map((s) => Type.Literal(s)) as never));
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const corr = (req: { id: string; headers: Record<string, string | string[] | undefined> }) => {
  const h = req.headers["x-correlation-id"];
  return { correlationId: safeCorrelationId(Array.isArray(h) ? h[0] : h, req.id) };
};

export const approvalDto = (a: ApprovalRow) => ({
  id: a.id, incidentId: a.incidentId, status: a.status, planReferenceId: a.planReferenceId, planVersion: a.planVersion, planHash: a.planHash, snapshotHash: a.snapshotHash,
  resultHash: a.resultHash, schemaVersion: a.schemaVersion, approvalDigest: a.approvalDigest, risk: a.risk, riskReasons: a.riskReasons, policy: a.policy,
  requiredApprovals: a.requiredApprovals, requestedBy: a.requestedBy, comment: a.comment, expiresAt: iso(a.expiresAt), decidedAt: iso(a.decidedAt),
  executableUntil: iso(a.executableUntil), closedReason: a.closedReason, incidentSynced: a.incidentSynced, createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt),
});
const decisionDto = (d: DecisionRow) => ({ id: d.id, decision: d.decision, decidedBy: d.decidedBy, role: d.role, comment: d.comment, planHash: d.planHash, approvalDigest: d.approvalDigest, at: iso(d.createdAt) });
const detail = (r: Awaited<ReturnType<ApprovalService["get"]>>) => ({ ...approvalDto(r.approval), decisions: r.decisions.map(decisionDto), approvalsReceived: r.approvalsReceived, approvalsRemaining: r.approvalsRemaining });

export const approvalRoutes: FastifyPluginAsyncTypebox<{ approvals: ApprovalService }> = async (app, { approvals }) => {
  app.post("/approvals", { schema: { body: Type.Object({ incidentId: Uuid, comment: Type.Optional(Comment) }, strict) } }, async (req, reply) => {
    const row = await approvals.request(req.principal, req.body, corr(req));
    return reply.code(201).send({ data: detail(await approvals.get(req.principal, row.id)) });
  });
  app.get("/approvals", { schema: { querystring: Type.Object({ ...Page, status: Type.Optional(Status), incidentId: Type.Optional(Uuid) }, strict) } }, async (req) => {
    const { page = 1, limit = 50, ...f } = req.query;
    const { items, total } = await approvals.list(req.principal, f, { limit, offset: (page - 1) * limit });
    return { data: items.map(approvalDto), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  });
  app.get("/approvals/:id", { schema: { params: IdParams, querystring: Empty } }, async (req) => ({ data: detail(await approvals.get(req.principal, req.params.id)) }));
  app.post("/approvals/:id/approve", { schema: { params: IdParams, body: Type.Object({ comment: Type.Optional(Comment) }, strict) } }, async (req) => ({
    data: detail(await approvals.approve(req.principal, req.params.id, req.body.comment, corr(req))),
  }));
  app.post("/approvals/:id/reject", { schema: { params: IdParams, body: Type.Object({ comment: Comment }, strict) } }, async (req) => ({
    data: detail(await approvals.reject(req.principal, req.params.id, req.body.comment, corr(req))),
  }));
  app.post("/approvals/:id/cancel", { schema: { params: IdParams, body: Type.Object({ reason: Comment }, strict) } }, async (req) => ({
    data: detail(await approvals.cancel(req.principal, req.params.id, req.body.reason, corr(req))),
  }));
  app.get("/approvals/:id/history", { schema: { params: IdParams, querystring: Empty } }, async (req) => ({
    data: (await approvals.history(req.principal, req.params.id)).map((h) => ({ sequence: h.seq, action: h.action, actorId: h.actorId, actorType: h.actorType, before: h.beforeState, after: h.afterState, correlationId: h.correlationId, at: iso(h.createdAt) })),
  }));

  const Policy = Type.Object({
    requiredApprovals: Type.Integer({ minimum: 1, maximum: 5 }), elevatedRequiredApprovals: Type.Integer({ minimum: 1, maximum: 5 }), separationOfDuties: Type.Boolean(),
    expiryMinutes: Type.Integer({ minimum: 5, maximum: 10080 }), executionWindowMinutes: Type.Integer({ minimum: 5, maximum: 1440 }),
  }, strict);
  app.get("/approval-policy", { schema: { querystring: Empty } }, async (req) => ({ data: await approvals.getPolicy(req.principal) }));
  app.put("/approval-policy", { schema: { body: Policy } }, async (req) => ({ data: await approvals.setPolicy(req.principal, req.body, corr(req)) }));
};
