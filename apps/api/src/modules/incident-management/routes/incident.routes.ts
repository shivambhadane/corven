import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { safeCorrelationId } from "../core/validation.js";
import type { EventRow } from "../repositories/incident.repository.js";
import type { IncidentAnalysisService } from "../services/analysis.service.js";
import type { IncidentService } from "../services/incident.service.js";
import {
  AGENT_IMPACTS, AGENT_RELATIONSHIPS, IMPACT_CLASSIFICATIONS, RESOURCE_RELATIONSHIPS, SEVERITIES, STATUSES, type AnalysisReference, type Incident,
} from "../types.js";

const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ format: "uuid" });
const lit = <const T extends readonly string[]>(vals: T) => Type.Unsafe<T[number]>(Type.Union(vals.map((v) => Type.Literal(v)) as never));
const Severity = lit(SEVERITIES);
const Status = lit(STATUSES);
const Page = { page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })) };
const Empty = Type.Object({}, strict);
const IdParams = Type.Object({ incidentId: Uuid }, strict);
const RefParams = Type.Object({ incidentId: Uuid, referenceId: Uuid }, strict);
const Text = (max: number) => Type.String({ minLength: 1, maxLength: max, pattern: "\\S" });
const NodeId = Type.String({ pattern: "^(agent|resource):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });
const AgentNodeId = Type.String({ pattern: "^agent:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });

// `source` is deliberately absent from every request body: over HTTP all associations are "manual".
const AgentAssoc = Type.Object({ agentId: Uuid, relationship: lit(AGENT_RELATIONSHIPS), suspectedCompromised: Type.Optional(Type.Boolean()), impact: Type.Optional(lit(AGENT_IMPACTS)), sourceReference: Type.Optional(Type.String({ maxLength: 500 })) }, strict);
const ResourceAssoc = Type.Object({ resourceId: Uuid, relationship: lit(RESOURCE_RELATIONSHIPS), impactClassification: Type.Optional(lit(IMPACT_CLASSIFICATIONS)), sourceReference: Type.Optional(Type.String({ maxLength: 500 })) }, strict);

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const pageInfo = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
const off = (page: number, limit: number) => ({ limit, offset: (page - 1) * limit });
const list = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

export const incidentDto = (i: Incident) => ({
  id: i.id, organizationId: i.organizationId, title: i.title, description: i.description, severity: i.severity, status: i.status,
  detectionSource: i.detectionSource, detectionReference: i.detectionReference, createdBy: i.createdBy, createdByType: i.createdByType,
  assigneeId: i.assigneeId, stateEnteredAt: iso(i.stateEnteredAt), version: i.version, createdAt: iso(i.createdAt), updatedAt: iso(i.updatedAt),
});
export const refDto = (r: AnalysisReference) => ({
  id: r.id, incidentId: r.incidentId, kind: r.kind, version: r.version, snapshotId: r.snapshotId, snapshotHash: r.snapshotHash, snapshotCapturedAt: iso(r.snapshotBuiltAt),
  snapshotFormatVersion: r.snapshotFormatVersion, engineVersion: r.engineVersion, input: r.input, resultHash: r.resultHash, planHash: r.planHash, planStatus: r.planStatus,
  summary: r.summary, createdBy: r.createdBy, createdAt: iso(r.createdAt),
});
const eventDto = (e: EventRow) => ({
  id: e.id, sequence: e.seq, incidentId: e.incidentId, eventType: e.eventType, actorId: e.actorId, actorType: e.actorType, data: e.data,
  correlationId: e.correlationId, occurredAt: iso(e.createdAt),
});

export const incidentRoutes: FastifyPluginAsyncTypebox<{ incidents: IncidentService; analysis: IncidentAnalysisService }> = async (app, { incidents, analysis }) => {
  const meta = (req: { id: string; headers: Record<string, string | string[] | undefined> }) => {
    const h = req.headers["x-correlation-id"];
    return { correlationId: safeCorrelationId(Array.isArray(h) ? h[0] : h, req.id) };
  };

  // ----- incidents
  app.post("/", {
    schema: {
      body: Type.Object({
        title: Text(200), description: Type.Optional(Type.String({ maxLength: 8000 })), severity: Severity,
        agents: Type.Optional(Type.Array(AgentAssoc, { maxItems: 50 })), resources: Type.Optional(Type.Array(ResourceAssoc, { maxItems: 50 })),
      }, strict),
    },
  }, async (req, reply) => {
    // Organization, creator and detection source are NOT taken from the body: they come from the principal, and HTTP creation is always "manual".
    const { incident } = await incidents.create(req.principal, { ...req.body, detectionSource: "manual" }, meta(req));
    return reply.code(201).send({ data: incidentDto(incident) });
  });

  app.get("/", {
    schema: {
      querystring: Type.Object({
        ...Page, status: Type.Optional(Type.Union([Status, Type.Array(Status, { maxItems: 14 })])), severity: Type.Optional(Type.Union([Severity, Type.Array(Severity, { maxItems: 5 })])),
        createdFrom: Type.Optional(Type.String({ format: "date-time" })), createdTo: Type.Optional(Type.String({ format: "date-time" })), agentId: Type.Optional(Uuid), assigneeId: Type.Optional(Uuid),
      }, strict),
    },
  }, async (req) => {
    const { page = 1, limit = 50, status, severity, createdFrom, createdTo, agentId, assigneeId } = req.query;
    const { items, total } = await incidents.list(req.principal, {
      statuses: list(status) as never, severities: list(severity) as never,
      createdFrom: createdFrom ? new Date(createdFrom) : undefined, createdTo: createdTo ? new Date(createdTo) : undefined, agentId, assigneeId,
    }, off(page, limit));
    return { data: items.map(incidentDto), pagination: pageInfo(page, limit, total) };
  });

  app.get("/:incidentId", { schema: { params: IdParams, querystring: Empty } }, async (req) => {
    const inc = await incidents.get(req.principal, req.params.incidentId);
    const refs = await analysis.currentReferences(req.principal, inc);
    return {
      data: {
        ...incidentDto(inc),
        availableTransitions: incidents.availableTransitions(req.principal, inc),
        current: { snapshot: refs.snapshot && refDto(refs.snapshot), blastRadius: refs.blastRadius && refDto(refs.blastRadius), containmentPlan: refs.containmentPlan && refDto(refs.containmentPlan) },
      },
    };
  });

  // Status is intentionally not patchable: lifecycle changes go through /transition.
  app.patch("/:incidentId", {
    schema: { params: IdParams, body: Type.Object({ title: Type.Optional(Text(200)), description: Type.Optional(Type.String({ maxLength: 8000 })), severity: Type.Optional(Severity) }, { ...strict, minProperties: 1 }) },
  }, async (req) => ({ data: incidentDto(await incidents.update(req.principal, req.params.incidentId, req.body, meta(req))) }));

  app.post("/:incidentId/transition", {
    schema: {
      params: IdParams,
      body: Type.Object({ to: Status, reason: Text(1000), expectedStatus: Type.Optional(Status), acknowledgeResidualRisk: Type.Optional(Type.Boolean()) }, strict),
    },
  }, async (req) => {
    const { incident } = await incidents.transition(req.principal, req.params.incidentId, req.body as never, meta(req));
    return { data: incidentDto(incident) };
  });

  app.get("/:incidentId/state-history", { schema: { params: IdParams, querystring: Empty } }, async (req) => ({
    data: (await incidents.stateHistory(req.principal, req.params.incidentId)).map((s) => ({
      id: s.id, from: s.fromStatus, to: s.toStatus, actorId: s.actorId, actorType: s.actorType, reason: s.reason, correlationId: s.correlationId, at: iso(s.createdAt),
    })),
  }));

  // ----- associations
  app.post("/:incidentId/agents", { schema: { params: IdParams, body: AgentAssoc } }, async (req, reply) => {
    const row = await incidents.addAgent(req.principal, req.params.incidentId, req.body, meta(req));
    return reply.code(201).send({ data: agentDto(row) });
  });
  app.get("/:incidentId/agents", { schema: { params: IdParams, querystring: Empty } }, async (req) => ({ data: (await incidents.listAgents(req.principal, req.params.incidentId)).map(agentDto) }));
  app.post("/:incidentId/resources", { schema: { params: IdParams, body: ResourceAssoc } }, async (req, reply) => {
    const row = await incidents.addResource(req.principal, req.params.incidentId, req.body, meta(req));
    return reply.code(201).send({ data: resourceDto(row) });
  });
  app.get("/:incidentId/resources", { schema: { params: IdParams, querystring: Empty } }, async (req) => ({ data: (await incidents.listResources(req.principal, req.params.incidentId)).map(resourceDto) }));

  // ----- assignment and notes
  app.post("/:incidentId/assign", { schema: { params: IdParams, body: Type.Object({ assigneeId: Uuid, note: Type.Optional(Type.String({ maxLength: 1000 })) }, strict) } }, async (req) => {
    const { incident, assignment } = await incidents.assign(req.principal, req.params.incidentId, req.body, meta(req));
    return { data: { incident: incidentDto(incident), assignment: { id: assignment.id, assigneeId: assignment.assigneeId, assignedBy: assignment.assignedBy, note: assignment.note, assignedAt: iso(assignment.createdAt) } } };
  });
  app.get("/:incidentId/assignments", { schema: { params: IdParams, querystring: Empty } }, async (req) => ({
    data: (await incidents.listAssignments(req.principal, req.params.incidentId)).map((a) => ({ id: a.id, assigneeId: a.assigneeId, assignedBy: a.assignedBy, note: a.note, assignedAt: iso(a.createdAt) })),
  }));
  app.post("/:incidentId/notes", { schema: { params: IdParams, body: Type.Object({ content: Text(4000) }, strict) } }, async (req, reply) => {
    const n = await incidents.addNote(req.principal, req.params.incidentId, req.body.content, meta(req));
    return reply.code(201).send({ data: noteDto(n) });
  });
  app.get("/:incidentId/notes", { schema: { params: IdParams, querystring: Type.Object(Page, strict) } }, async (req) => {
    const { page = 1, limit = 50 } = req.query;
    const { items, total } = await incidents.listNotes(req.principal, req.params.incidentId, off(page, limit));
    return { data: items.map(noteDto), pagination: pageInfo(page, limit, total) };
  });

  // ----- timeline
  app.get("/:incidentId/timeline", { schema: { params: IdParams, querystring: Type.Object(Page, strict) } }, async (req) => {
    const { page = 1, limit = 50 } = req.query;
    const { items, total } = await incidents.timeline(req.principal, req.params.incidentId, off(page, limit));
    return { data: items.map(eventDto), pagination: pageInfo(page, limit, total) };
  });

  // ----- analysis references
  app.post("/:incidentId/graph-snapshot", {
    schema: { params: IdParams, body: Type.Object({ snapshotId: Type.Optional(Uuid), label: Type.Optional(Text(200)) }, strict) },
  }, async (req, reply) => reply.code(201).send({ data: refDto(await analysis.attachSnapshot(req.principal, req.params.incidentId, req.body, meta(req))) }));

  app.post("/:incidentId/blast-radius", {
    schema: {
      params: IdParams,
      body: Type.Object({
        sourceNodeIds: Type.Optional(Type.Array(AgentNodeId, { minItems: 1, maxItems: 50, uniqueItems: true })),
        confidenceThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), staleAfterHours: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      }, strict),
    },
  }, async (req, reply) => {
    const { result, ...ref } = await analysis.attachBlastRadius(req.principal, req.params.incidentId, req.body, meta(req));
    return reply.code(201).send({ data: { reference: refDto(ref), result } });
  });

  app.post("/:incidentId/containment-plan", {
    schema: {
      params: IdParams,
      body: Type.Object({
        sourceNodeIds: Type.Optional(Type.Array(AgentNodeId, { minItems: 1, maxItems: 50, uniqueItems: true })),
        protectedNodeIds: Type.Optional(Type.Array(NodeId, { maxItems: 500, uniqueItems: true })),
        healthyWorkflows: Type.Optional(Type.Array(Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }), name: Type.Optional(Type.String({ maxLength: 200 })), from: Type.Optional(NodeId), to: Type.Optional(NodeId), edgeIds: Type.Optional(Type.Array(Uuid, { maxItems: 500 })) }, strict), { maxItems: 100 })),
        coverage: Type.Optional(Type.Object({ uncontrollableEdgeIds: Type.Optional(Type.Array(Uuid, { maxItems: 5000 })), edgeCosts: Type.Optional(Type.Record(Uuid, Type.Integer({ minimum: 1, maximum: 1_000_000 }))), defaultCost: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })) }, strict)),
        options: Type.Optional(Type.Object({ confidenceThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), staleAfterHours: Type.Optional(Type.Number({ exclusiveMinimum: 0 })), costApprovalThreshold: Type.Optional(Type.Integer({ minimum: 0 })), highValueNodeIds: Type.Optional(Type.Array(NodeId, { maxItems: 500 })) }, strict)),
      }, strict),
    },
  }, async (req, reply) => {
    const { result, ...ref } = await analysis.attachContainmentPlan(req.principal, req.params.incidentId, req.body as never, meta(req));
    return reply.code(201).send({ data: { reference: refDto(ref), result } });
  });

  app.get("/:incidentId/analysis", { schema: { params: IdParams, querystring: Type.Object({ kind: Type.Optional(lit(["graph_snapshot", "blast_radius", "containment_plan"] as const)) }, strict) } }, async (req) => ({
    data: (await analysis.list(req.principal, req.params.incidentId, req.query.kind as never)).map(refDto),
  }));
  app.get("/:incidentId/analysis/:referenceId/verify", { schema: { params: RefParams, querystring: Empty } }, async (req) => ({ data: await analysis.verify(req.principal, req.params.incidentId, req.params.referenceId) }));
};

const agentDto = (a: { id: string; incidentId: string; agentId: string; relationship: string; suspectedCompromised: boolean; impact: string; source: string; sourceReference: string | null; createdBy: string; createdAt: Date }) => ({
  id: a.id, incidentId: a.incidentId, agentId: a.agentId, relationship: a.relationship, suspectedCompromised: a.suspectedCompromised, impact: a.impact,
  source: a.source, sourceReference: a.sourceReference, createdBy: a.createdBy, associatedAt: iso(a.createdAt),
});
const resourceDto = (r: { id: string; incidentId: string; resourceId: string; resourceType: string; relationship: string; impactClassification: string; source: string; sourceReference: string | null; createdBy: string; createdAt: Date }) => ({
  id: r.id, incidentId: r.incidentId, resourceId: r.resourceId, resourceType: r.resourceType, relationship: r.relationship, impactClassification: r.impactClassification,
  source: r.source, sourceReference: r.sourceReference, createdBy: r.createdBy, associatedAt: iso(r.createdAt),
});
const noteDto = (n: { id: string; incidentId: string; authorId: string; content: string; createdAt: Date }) => ({ id: n.id, incidentId: n.incidentId, authorId: n.authorId, content: n.content, createdAt: iso(n.createdAt) });
