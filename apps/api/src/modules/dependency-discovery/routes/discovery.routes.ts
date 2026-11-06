import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { ObservationRow, ResultRow, RunRow, SourceRow } from "../repositories/discovery.repository.js";
import type { DiscoveryService } from "../services/discovery.service.js";

const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ format: "uuid" });
const SourceType = Type.Union([Type.Literal("agent_configuration"), Type.Literal("workflow_definition"), Type.Literal("runtime_gateway")]);
const Config = Type.Record(Type.String(), Type.Unknown());
const Page = { page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })) };
const Empty = Type.Object({}, strict);
const IdParams = Type.Object({ id: Uuid }, strict);
const RunStatus = Type.Union(["pending", "running", "completed", "completed_with_errors", "failed", "cancelled"].map((v) => Type.Literal(v)) as never);
const ObsStatus = Type.Union(["pending", "normalized", "resolved", "rejected", "unresolved", "pending_review", "applied", "review_rejected"].map((v) => Type.Literal(v)) as never);
const Outcome = Type.Union(["new", "unchanged", "modified", "missing", "conflicting", "stale", "unresolved"].map((v) => Type.Literal(v)) as never);

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const sourceDto = (s: SourceRow) => ({
  id: s.id, organizationId: s.organizationId, type: s.type, name: s.name, enabled: s.enabled, freshnessWindowHours: s.freshnessWindowHours,
  configuration: s.configuration, lastSuccessfulRunAt: iso(s.lastSuccessfulRunAt), createdBy: s.createdBy, createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
});
const runDto = (r: RunRow) => ({
  id: r.id, organizationId: r.organizationId, sourceId: r.sourceId, sourceType: r.sourceType, status: r.status, requestedBy: r.requestedBy,
  startedAt: iso(r.startedAt), completedAt: iso(r.completedAt), collectedAt: iso(r.collectedAt), createdAt: iso(r.createdAt),
  summary: {
    recordsCollected: r.recordsCollected, observationsCreated: r.observationsCreated, relationshipsCreated: r.relationshipsCreated,
    relationshipsUpdated: r.relationshipsUpdated, relationshipsUnchanged: r.relationshipsUnchanged, relationshipsRejected: r.relationshipsRejected,
    unresolvedObservations: r.unresolvedObservations, pendingReview: r.pendingReview, missingRelationships: r.missingRelationships,
  },
  sourceWasStale: r.sourceWasStale, errorSummary: r.errorSummary,
});
const obsDto = (o: ObservationRow) => ({
  id: o.id, runId: o.runId, sourceId: o.sourceId, sourceType: o.sourceType, externalRecordId: o.externalRecordId, sourceReference: o.sourceReference,
  observedAt: iso(o.observedAt), processingStatus: o.processingStatus, rejectionReason: o.rejectionReason, rawEvidence: o.rawEvidence,
  normalized: o.normalized, resolved: o.resolved, reconciliationOutcome: o.reconciliationOutcome, dependencyId: o.dependencyId, registryOutcome: o.registryOutcome,
  createdAt: iso(o.createdAt), updatedAt: iso(o.updatedAt),
});
const resultDto = (r: ResultRow) => ({ id: r.id, runId: r.runId, observationId: r.observationId, dependencyId: r.dependencyId, outcome: r.outcome, reason: r.reason, createdAt: iso(r.createdAt) });
const pageInfo = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
const off = (page: number, limit: number) => ({ limit, offset: (page - 1) * limit });

export const discoveryRoutes: FastifyPluginAsyncTypebox<{ discovery: DiscoveryService }> = async (app, { discovery }) => {
  // ----- sources
  app.post("/sources", { schema: { body: Type.Object({ type: SourceType, name: Type.String({ minLength: 1, maxLength: 120, pattern: "\\S" }), configuration: Type.Optional(Config), freshnessWindowHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 8760 })) }, strict) } },
    async (req, reply) => reply.code(201).send({ data: sourceDto(await discovery.createSource(req.principal, req.body)) }));
  app.get("/sources", { schema: { querystring: Type.Object(Page, strict) } }, async (req) => {
    const { page = 1, limit = 50 } = req.query;
    const { items, total } = await discovery.listSources(req.principal, off(page, limit));
    return { data: items.map(sourceDto), pagination: pageInfo(page, limit, total) };
  });
  app.get("/sources/:id", { schema: { params: IdParams, querystring: Empty } }, async (req) => ({ data: sourceDto(await discovery.getSource(req.principal, req.params.id)) }));
  app.patch("/sources/:id", { schema: { params: IdParams, body: Type.Object({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 120, pattern: "\\S" })), enabled: Type.Optional(Type.Boolean()), configuration: Type.Optional(Config), freshnessWindowHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 8760 })) }, { ...strict, minProperties: 1 }) } },
    async (req) => ({ data: sourceDto(await discovery.updateSource(req.principal, req.params.id, req.body)) }));
  app.post("/sources/:id/events", { schema: { params: IdParams, body: Type.Object({ events: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 500 }) }, strict) } },
    async (req, reply) => reply.code(202).send({ data: await discovery.ingestEvents(req.principal, req.params.id, req.body.events) }));

  // ----- runs
  app.post("/sources/:id/runs", { schema: { params: IdParams, querystring: Empty } }, async (req, reply) => {
    const run = await discovery.startRun(req.principal, req.params.id);
    return reply.code(202).send({ data: { runId: run.id, status: run.status } });
  });
  app.get("/runs", { schema: { querystring: Type.Object({ ...Page, sourceId: Type.Optional(Uuid), status: Type.Optional(RunStatus) }, strict) } }, async (req) => {
    const { page = 1, limit = 50, sourceId, status } = req.query;
    const { items, total } = await discovery.listRuns(req.principal, { sourceId, status: status as never }, off(page, limit));
    return { data: items.map(runDto), pagination: pageInfo(page, limit, total) };
  });
  app.get("/runs/:id", { schema: { params: IdParams, querystring: Empty } }, async (req) => ({ data: runDto(await discovery.getRun(req.principal, req.params.id)) }));
  app.post("/runs/:id/cancel", { schema: { params: IdParams, querystring: Empty } }, async (req) => ({ data: runDto(await discovery.cancelRun(req.principal, req.params.id)) }));
  app.get("/runs/:id/observations", { schema: { params: IdParams, querystring: Type.Object({ ...Page, status: Type.Optional(ObsStatus) }, strict) } }, async (req) => {
    const { page = 1, limit = 50, status } = req.query;
    const { items, total } = await discovery.listObservations(req.principal, req.params.id, status as never, off(page, limit));
    return { data: items.map(obsDto), pagination: pageInfo(page, limit, total) };
  });
  app.get("/runs/:id/results", { schema: { params: IdParams, querystring: Type.Object({ ...Page, outcome: Type.Optional(Outcome) }, strict) } }, async (req) => {
    const { page = 1, limit = 50, outcome } = req.query;
    const { items, total } = await discovery.listResults(req.principal, req.params.id, outcome as never, off(page, limit));
    return { data: items.map(resultDto), pagination: pageInfo(page, limit, total) };
  });

  // ----- observations and review
  app.get("/observations/:id", { schema: { params: IdParams, querystring: Empty } }, async (req) => {
    const { observation, reviews } = await discovery.getObservation(req.principal, req.params.id);
    return { data: { ...obsDto(observation), reviews: reviews.map((r) => ({ id: r.id, decision: r.decision, reviewerId: r.reviewerId, reason: r.reason, reviewedAt: iso(r.reviewedAt) })) } };
  });
  app.post("/observations/:id/review", { schema: { params: IdParams, body: Type.Object({ decision: Type.Union([Type.Literal("approve"), Type.Literal("reject"), Type.Literal("defer")]), reason: Type.Optional(Type.String({ maxLength: 1000 })) }, strict) } }, async (req) => {
    const { observation, review } = await discovery.review(req.principal, req.params.id, req.body);
    return { data: { observation: obsDto(observation), review: { id: review.id, decision: review.decision, reviewerId: review.reviewerId, reason: review.reason, reviewedAt: iso(review.reviewedAt) } } };
  });

  app.get("/coverage", { schema: { querystring: Empty } }, async (req) => ({ data: await discovery.coverage(req.principal) }));
};
