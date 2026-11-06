import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { safeCorrelationId } from "../../incident-management/core/validation.js";
import { ExecutionFailedError, OperationDeniedError } from "../errors.js";
import type { AgentAuthService } from "../services/agent-auth.service.js";
import type { EnforcementService } from "../services/enforcement.service.js";
import type { GatewayService } from "../services/gateway.service.js";
import type { PermissionService } from "../services/permission.service.js";
import type { AuthenticatedAgent } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    agent: AuthenticatedAgent;
  }
  interface FastifyContextConfig {
    /** "agent": authenticated by a machine token in this route's own preHandler. "public": no authentication (token exchange). Default: human principal. */
    auth?: "agent" | "public";
  }
}

const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ format: "uuid" });
const Empty = Type.Object({}, strict);
const Page = { page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })) };
const Reason = Type.String({ minLength: 1, maxLength: 1000, pattern: "\\S" });
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const pageInfo = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
const off = (page: number, limit: number) => ({ limit, offset: (page - 1) * limit });
const corr = (req: { id: string; headers: Record<string, string | string[] | undefined> }) => {
  const h = req.headers["x-correlation-id"];
  return { correlationId: safeCorrelationId(Array.isArray(h) ? h[0] : h, req.id) };
};

const permissionDto = (p: import("../types.js").Permission) => ({
  id: p.id, agentId: p.agentId, resourceId: p.resourceId, action: p.action, constraints: p.constraints, status: p.status, version: p.version, grantedBy: p.grantedBy,
  createdAt: iso(p.createdAt), revokedAt: iso(p.revokedAt), revokedBy: p.revokedBy, revokeReason: p.revokeReason,
});
const actionDto = (a: import("../repositories/gateway.repository.js").ActionRow) => ({
  id: a.id, incidentId: a.incidentId, planHash: a.planHash, edgeId: a.edgeId, kind: a.kind, agentId: a.agentId, resourceId: a.resourceId, status: a.status, adapter: a.adapter,
  approvalBasis: a.approvalBasis, approvalRef: a.approvalRef, reason: a.reason, result: a.result, failureReason: a.failureReason, externalReference: a.externalReference,
  requestedBy: a.requestedBy, requestedByType: a.requestedByType, createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt),
});

export interface GatewayRouteDeps {
  auth: AgentAuthService;
  gateway: GatewayService;
  permissions: PermissionService;
  enforcement: EnforcementService;
}

/** Machine-facing routes: authenticated by a short-lived agent token, never by a human principal. */
export const agentFacingRoutes: FastifyPluginAsyncTypebox<GatewayRouteDeps> = async (app, { auth, gateway }) => {
  app.post("/agent-auth/token", { config: { auth: "public" }, schema: { body: Type.Object({ credential: Type.String({ minLength: 10, maxLength: 200 }) }, strict) } }, async (req, reply) => {
    // Never cache or log tokens; the response is the only place a token appears.
    void reply.header("cache-control", "no-store");
    return { data: await auth.exchange(req.body.credential) };
  });

  const agentRoute = { config: { auth: "agent" as const }, preHandler: async (req: import("fastify").FastifyRequest) => { req.agent = await auth.authenticate(req.headers.authorization); } };
  const RequestBody = Type.Object({
    requestId: Type.String({ minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9._:-]+$" }),
    resource: Type.String({ minLength: 1, maxLength: 200 }),
    action: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.:-]+$" }),
    payload: Type.Optional(Type.Unknown()),
  }, strict);

  app.post("/gateway/check", { ...agentRoute, schema: { body: Type.Object({ requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9._:-]+$" })), resource: RequestBody.properties.resource, action: RequestBody.properties.action, payload: Type.Optional(Type.Unknown()) }, strict) } },
    async (req) => ({ data: await gateway.check(req.agent, req.body, corr(req)) }));

  app.post("/gateway/execute", { ...agentRoute, schema: { body: RequestBody } }, async (req, reply) => {
    const r = await gateway.execute(req.agent, req.body, corr(req));
    if (r.status === "denied") throw new OperationDeniedError({ decisionId: r.decision.id, reasonCodes: r.decision.reasonCodes, executionId: r.executionId });
    if (r.status === "failed") throw new ExecutionFailedError({ executionId: r.executionId, failureReason: r.failureReason });
    return reply.code(r.status === "submitted" ? 202 : 200).send({ data: r });
  });
};

/** Human-facing administration: permissions, credentials, coverage and enforcement. */
export const adminRoutes: FastifyPluginAsyncTypebox<GatewayRouteDeps> = async (app, { auth, gateway, permissions, enforcement }) => {
  // ----- credentials
  const Expiry = Type.Optional(Type.String({ format: "date-time" }));
  app.post("/agent-auth/credentials", { schema: { body: Type.Object({ agentId: Uuid, expiresAt: Expiry, reason: Type.Optional(Reason) }, strict) } }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const { agentId, expiresAt, reason } = req.body;
    return reply.code(201).send({ data: await auth.issue(req.principal, agentId, { expiresAt: expiresAt ? new Date(expiresAt) : undefined, reason }) });
  });
  app.post("/agent-auth/rotate", { schema: { body: Type.Object({ agentId: Uuid, expiresAt: Expiry, reason: Reason }, strict) } }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const { agentId, expiresAt, reason } = req.body;
    return { data: await auth.rotate(req.principal, agentId, { expiresAt: expiresAt ? new Date(expiresAt) : undefined, reason }) };
  });
  app.post("/agent-auth/revoke", { schema: { body: Type.Object({ agentId: Uuid, reason: Reason }, strict) } }, async (req) => ({ data: await auth.revoke(req.principal, req.body.agentId, req.body.reason) }));
  app.get("/agent-auth/credentials/:agentId/history", { schema: { params: Type.Object({ agentId: Uuid }, strict), querystring: Empty } }, async (req) => ({
    data: (await auth.history(req.principal, req.params.agentId)).map((h) => ({ id: h.id, credentialId: h.credentialId, previousCredentialId: h.previousCredentialId, action: h.action, actorId: h.actorId, actorType: h.actorType, reason: h.reason, at: iso(h.createdAt) })),
  }));

  // ----- permissions
  const Constraints = Type.Object({ maxAmount: Type.Optional(Type.Number({ minimum: 0 })), expiresAt: Type.Optional(Type.String({ format: "date-time" })) }, strict);
  app.post("/permissions", { schema: { body: Type.Object({ agentId: Uuid, resourceId: Uuid, action: Type.String({ minLength: 1, maxLength: 64 }), constraints: Type.Optional(Constraints) }, strict) } }, async (req, reply) =>
    reply.code(201).send({ data: permissionDto(await permissions.grant(req.principal, req.body, corr(req))) }));
  app.get("/permissions", { schema: { querystring: Type.Object({ ...Page, agentId: Type.Optional(Uuid), resourceId: Type.Optional(Uuid), status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("revoked")])) }, strict) } }, async (req) => {
    const { page = 1, limit = 50, ...f } = req.query;
    const { items, total } = await permissions.list(req.principal, f, off(page, limit));
    return { data: items.map(permissionDto), pagination: pageInfo(page, limit, total) };
  });
  app.get("/permissions/:id", { schema: { params: Type.Object({ id: Uuid }, strict), querystring: Empty } }, async (req) => ({ data: permissionDto(await permissions.get(req.principal, req.params.id)) }));
  app.post("/permissions/:id/revoke", { schema: { params: Type.Object({ id: Uuid }, strict), body: Type.Object({ reason: Reason }, strict) } }, async (req) => ({ data: permissionDto(await permissions.revoke(req.principal, req.params.id, req.body.reason, corr(req))) }));

  // ----- gateway administration
  app.put("/gateway/resources/:resourceId/enforcement", { schema: { params: Type.Object({ resourceId: Uuid }, strict), body: Type.Object({ mode: Type.Union([Type.Literal("gateway"), Type.Literal("advisory")]) }, strict) } }, async (req) => {
    const r = await permissions.setEnforcementMode(req.principal, req.params.resourceId, req.body.mode, corr(req));
    return { data: { resourceId: r.resourceId, mode: r.mode, updatedBy: r.updatedBy, updatedAt: iso(r.updatedAt) } };
  });
  app.get("/gateway/resources/enforcement", { schema: { querystring: Empty } }, async (req) => ({ data: (await permissions.listEnforcementModes(req.principal)).map((r) => ({ resourceId: r.resourceId, mode: r.mode, updatedBy: r.updatedBy, updatedAt: iso(r.updatedAt) })) }));
  app.get("/gateway/coverage", { schema: { querystring: Empty } }, async (req) => ({ data: await gateway.coverage(req.principal) }));
  app.get("/gateway/agents/:agentId/decisions", { schema: { params: Type.Object({ agentId: Uuid }, strict), querystring: Type.Object(Page, strict) } }, async (req) => {
    const { page = 1, limit = 50 } = req.query;
    const items = await gateway.decisions(req.principal, req.params.agentId, off(page, limit));
    return { data: items.map((d) => ({ id: d.id, requestId: d.requestId, stage: d.stage, resource: d.resourceRef, action: d.action, decision: d.decision, reasonCodes: d.reasonCodes, permissionId: d.permissionId, at: iso(d.createdAt) })) };
  });

  // ----- enforcement (administrators; the orchestrator calls the service directly)
  app.post("/enforcement/apply", {
    schema: {
      body: Type.Object({
        kind: Type.Union(["revoke_resource_access", "suspend_agent", "revoke_credentials", "revoke_authority", "block_operational_trigger"].map((k) => Type.Literal(k)) as never) as never as ReturnType<typeof Type.String>,
        agentId: Type.Optional(Uuid), resourceId: Type.Optional(Uuid), edgeId: Type.Optional(Uuid), reason: Type.String({ minLength: 10, maxLength: 1000 }),
        incidentId: Type.Optional(Uuid), planHash: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })), adminOverride: Type.Optional(Type.Boolean()),
        idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      }, strict),
    },
  }, async (req, reply) => {
    const { action, replayed } = await enforcement.apply(req.principal, req.body as never, corr(req));
    return reply.code(replayed ? 200 : 201).send({ data: { ...actionDto(action), replayed } });
  });
  app.post("/enforcement/revoke", { schema: { body: Type.Object({ actionId: Uuid, reason: Reason }, strict) } }, async (req) => ({ data: actionDto(await enforcement.rollback(req.principal, req.body.actionId, req.body.reason, corr(req))) }));
  app.get("/enforcement", { schema: { querystring: Type.Object({ ...Page, incidentId: Type.Optional(Uuid), agentId: Type.Optional(Uuid) }, strict) } }, async (req) => {
    const { page = 1, limit = 50, ...f } = req.query;
    const { items, total } = await enforcement.list(req.principal, f, off(page, limit));
    return { data: items.map(actionDto), pagination: pageInfo(page, limit, total) };
  });
  app.get("/enforcement/:id", { schema: { params: Type.Object({ id: Uuid }, strict), querystring: Empty } }, async (req) => {
    const { action, events } = await enforcement.get(req.principal, req.params.id);
    return { data: { ...actionDto(action), events: events.map((e) => ({ sequence: e.seq, status: e.status, detail: e.detail, actorId: e.actorId, actorType: e.actorType, at: iso(e.createdAt) })) } };
  });
};
