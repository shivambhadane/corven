import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { assertCan } from "../../auth/permissions.js";
import { safeCorrelationId } from "../incident-management/core/validation.js";
import type { WorkflowRow } from "./repository.js";
import type { Orchestrator } from "./service.js";

const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ format: "uuid" });
const Empty = Type.Object({}, strict);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
export const workflowDto = (w: WorkflowRow) => ({
  id: w.id, incidentId: w.incidentId, status: w.status, step: w.step, outcome: w.outcome, attempts: w.attempts, maxAttempts: w.maxAttempts, lastError: w.lastError,
  nextRunAt: iso(w.nextRunAt), approvalRequested: w.approvalRequested, evidenceId: w.evidenceId, verificationAttempts: w.verificationAttempts, startedBy: w.startedBy,
  startedByType: w.startedByType, createdAt: iso(w.createdAt), updatedAt: iso(w.updatedAt), finishedAt: iso(w.finishedAt),
});

export const orchestratorRoutes: FastifyPluginAsyncTypebox<{ orchestrator: Orchestrator }> = async (app, { orchestrator }) => {
  app.post("/workflows", { schema: { body: Type.Object({ incidentId: Uuid }, strict) } }, async (req, reply) => {
    const h = req.headers["x-correlation-id"];
    const { workflow, created } = await orchestrator.start(req.principal, req.body.incidentId, { correlationId: safeCorrelationId(Array.isArray(h) ? h[0] : h, req.id) });
    return reply.code(created ? 201 : 200).send({ data: { ...workflowDto(workflow), created } });
  });
  app.get("/workflows/:id", { schema: { params: Type.Object({ id: Uuid }, strict), querystring: Empty } }, async (req) => {
    const { workflow, events } = await orchestrator.get(req.principal, req.params.id);
    return { data: { ...workflowDto(workflow), events: events.map((e) => ({ sequence: e.seq, type: e.type, detail: e.detail, at: iso(e.createdAt) })) } };
  });
  app.get("/incidents/:incidentId/workflow", { schema: { params: Type.Object({ incidentId: Uuid }, strict), querystring: Empty } }, async (req) => {
    const { workflow, events } = await orchestrator.forIncident(req.principal, req.params.incidentId);
    return { data: { ...workflowDto(workflow), events: events.map((e) => ({ sequence: e.seq, type: e.type, detail: e.detail, at: iso(e.createdAt) })) } };
  });
  app.post("/workflows/:id/retry", { schema: { params: Type.Object({ id: Uuid }, strict), body: Type.Optional(Empty) } }, async (req) => ({ data: workflowDto(await orchestrator.retry(req.principal, req.params.id)) }));
  app.post("/workflows/:id/cancel", { schema: { params: Type.Object({ id: Uuid }, strict), body: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 300 }) }, strict) } }, async (req) => ({
    data: workflowDto(await orchestrator.cancel(req.principal, req.params.id, req.body.reason)),
  }));
  // Nudges this organization's workflow now (after a person's decision) instead of waiting for the next tick.
  app.post("/workflows/:id/run", { schema: { params: Type.Object({ id: Uuid }, strict), body: Type.Optional(Empty) } }, async (req) => {
    assertCan(req.principal, "workflow:run");
    const wf = await orchestrator.runNow(req.principal.organizationId, req.params.id);
    return { data: wf ? workflowDto(wf) : null };
  });
};
