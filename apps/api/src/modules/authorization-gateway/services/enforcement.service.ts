import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { ValidationError } from "../../../errors.js";
import type { AdapterContext, EnforcementAdapter } from "../adapters/types.js";
import { approvalRequired, invalidTarget, notFound, rollbackNotSupported } from "../errors.js";
import type { ActionRow, GatewayRepository } from "../repositories/gateway.repository.js";
import { ACTION_KINDS, type ActionKind, type ApprovalBasis, type RequestMeta } from "../types.js";
import type { AgentLookup } from "./agent-auth.service.js";
import type { ResourceLookup } from "./permission.service.js";

/**
 * The Approval Service (not built yet) will implement this. Until then the default
 * verifier approves nothing, so plan-based enforcement is refused (fail closed) and
 * only an explicit administrator override, which is recorded as such, can enforce.
 */
export interface ApprovalVerifier {
  isPlanApproved(organizationId: string, incidentId: string, planHash: string): Promise<boolean>;
}
export const denyAllApprovals: ApprovalVerifier = { isPlanApproved: async () => false };

/** Structural subset of IncidentReader: the gateway reads incidents, it never writes them. */
export interface IncidentPlanReader {
  getIncident(organizationId: string, incidentId: string): Promise<{ id: string; status: string } | null>;
  getCurrentPlanReference(organizationId: string, incidentId: string): Promise<{ planHash: string | null } | null>;
}

export interface ApplyInput {
  kind: ActionKind;
  agentId?: string | undefined;
  resourceId?: string | undefined;
  edgeId?: string | undefined;
  reason: string;
  incidentId?: string | undefined;
  planHash?: string | undefined;
  /** Administrator override: enforce without a plan approval. Recorded as `admin_override`. */
  adminOverride?: boolean | undefined;
  idempotencyKey?: string | undefined;
}

export interface PlanAction {
  edgeId: string;
  kind: string;
  sourceNodeId: string;
  targetNodeId: string;
}

const PLAN_KIND: Record<string, ActionKind> = { revoke_resource_access: "revoke_resource_access", revoke_authority: "revoke_authority", block_operational_trigger: "block_operational_trigger" };
const nodeId = (n: string, prefix: "agent" | "resource") => (n.startsWith(`${prefix}:`) ? n.slice(prefix.length + 1) : undefined);
const actorType = (p: Principal) => (p.role === "system" ? "system" : "human") as "human" | "system";

/**
 * Applies and lifts enforcement actions through adapters. It records every step
 * so "submitted", "executed" and "failed" stay distinct, and an action that no
 * adapter supports is recorded as `unsupported`, never as success.
 */
export class EnforcementService {
  constructor(
    private readonly db: Database,
    private readonly repo: GatewayRepository,
    private readonly adapters: readonly EnforcementAdapter[],
    private readonly agents: AgentLookup,
    private readonly resources: ResourceLookup,
    private readonly incidents: IncidentPlanReader,
    private readonly approvals: ApprovalVerifier = denyAllApprovals,
  ) {}

  async apply(p: Principal, input: ApplyInput, meta: RequestMeta = {}): Promise<{ action: ActionRow; replayed: boolean }> {
    assertCan(p, "enforcement:apply");
    const basis = await this.authorize(p, input);
    return this.applyOne(p, input, basis, meta);
  }

  /**
   * Applies every action of an approved plan. The approval is checked once for the
   * whole plan; each action is idempotent under `<keyPrefix>:<edgeId>`, so a
   * retried or restarted run continues where it stopped instead of repeating work.
   */
  async applyPlan(p: Principal, input: { incidentId: string; planHash: string; actions: readonly PlanAction[]; keyPrefix: string; reason: string }, meta: RequestMeta = {}) {
    assertCan(p, "enforcement:apply");
    const basis = await this.authorize(p, { incidentId: input.incidentId, planHash: input.planHash, reason: input.reason });
    const out: Array<{ action: ActionRow; replayed: boolean }> = [];
    for (const a of input.actions) {
      const kind = PLAN_KIND[a.kind];
      if (!kind) throw invalidTarget(`Unknown plan action kind ${a.kind}`);
      const agentId = nodeId(a.sourceNodeId, "agent");
      const resourceId = nodeId(a.targetNodeId, "resource");
      const agent = agentId ?? nodeId(a.targetNodeId, "agent");
      out.push(await this.applyOne(p, { kind, ...(agent ? { agentId: agent } : {}), ...(resourceId ? { resourceId } : {}), edgeId: a.edgeId, incidentId: input.incidentId, planHash: input.planHash, reason: input.reason, idempotencyKey: `${input.keyPrefix}:${a.edgeId}` }, basis, meta));
    }
    return out;
  }

  /** Lifts an executed restriction. Only supported where the adapter can actually undo it. */
  async rollback(p: Principal, actionId: string, reason: string, meta: RequestMeta = {}): Promise<ActionRow> {
    assertCan(p, "enforcement:apply");
    if (!reason.trim()) throw new ValidationError("A reason is required");
    const a = await this.db.transaction((tx) => this.repo.lockAction(tx, p.organizationId, actionId));
    if (!a) throw notFound("Enforcement action", "ENFORCEMENT_ACTION_NOT_FOUND");
    const adapter = this.adapters.find((x) => x.supports(a.kind));
    if (a.status !== "executed" || !adapter?.supportsRollback(a.kind)) throw rollbackNotSupported(`${a.kind} in status ${a.status} cannot be rolled back (${adapter ? "only an executed, reversible action can" : "no adapter"})`);
    const res = await adapter.rollback(this.ctx(p, a, reason));
    return this.db.transaction(async (tx) => {
      const updated = await this.repo.updateAction(tx, p.organizationId, a.id, { status: "rolled_back" });
      await this.repo.addActionEvent(tx, { organizationId: p.organizationId, actionId: a.id, status: "rolled_back", detail: { reason: reason.trim(), adapter: adapter.name, result: res.detail, correlationId: meta.correlationId ?? null } as never, actorId: p.actorId, actorType: actorType(p) });
      return updated;
    });
  }

  async get(p: Principal, id: string) {
    assertCan(p, "enforcement:read");
    const action = await this.repo.findAction(this.db, p.organizationId, id);
    if (!action) throw notFound("Enforcement action", "ENFORCEMENT_ACTION_NOT_FOUND");
    return { action, events: await this.repo.listActionEvents(this.db, p.organizationId, id) };
  }

  async list(p: Principal, f: { incidentId?: string | undefined; agentId?: string | undefined }, page: { limit: number; offset: number }) {
    assertCan(p, "enforcement:read");
    return this.repo.listActions(this.db, p.organizationId, f, page);
  }

  // ------------------------------------------------------------------ internals

  /** Decides on what authority this enforcement is allowed. Throws if there is none. */
  private async authorize(p: Principal, input: Pick<ApplyInput, "incidentId" | "planHash" | "adminOverride" | "reason">): Promise<ApprovalBasis> {
    if (input.reason.trim().length < 10) throw new ValidationError("reason must be at least 10 characters");
    if (input.adminOverride) {
      if (p.role !== "admin") throw approvalRequired("Only an administrator can enforce without a plan approval");
      return "admin_override";
    }
    if (!input.incidentId || !input.planHash) throw approvalRequired("Enforcement needs an approved containment plan (incidentId and planHash), or an administrator override");
    const org = p.organizationId;
    const incident = await this.incidents.getIncident(org, input.incidentId);
    if (!incident) throw notFound("Incident", "INCIDENT_NOT_FOUND");
    if (incident.status !== "approved" && incident.status !== "containing") throw approvalRequired(`The incident is ${incident.status}; enforcement requires approved or containing`);
    const current = await this.incidents.getCurrentPlanReference(org, input.incidentId);
    if (!current || current.planHash !== input.planHash) throw approvalRequired("planHash is not the incident's current containment plan");
    if (!(await this.approvals.isPlanApproved(org, input.incidentId, input.planHash))) throw approvalRequired("No approval exists for this exact plan");
    return "plan_approval";
  }

  private async applyOne(p: Principal, input: ApplyInput, basis: ApprovalBasis, meta: RequestMeta): Promise<{ action: ActionRow; replayed: boolean }> {
    if (!ACTION_KINDS.includes(input.kind)) throw invalidTarget(`Unknown action kind ${input.kind}`);
    const org = p.organizationId;
    if (input.idempotencyKey) {
      const prior = await this.repo.findActionByKey(this.db, org, input.idempotencyKey);
      if (prior) return { action: prior, replayed: true };
    }
    await this.validateTarget(org, input);

    const inserted = await this.db.transaction(async (tx) => {
      const row = await this.repo.insertAction(tx, {
        organizationId: org, incidentId: input.incidentId ?? null, planHash: input.planHash ?? null, edgeId: input.edgeId ?? null, kind: input.kind, agentId: input.agentId ?? null, resourceId: input.resourceId ?? null,
        status: "pending", approvalBasis: basis, approvalRef: basis === "plan_approval" ? `plan:${input.planHash}` : `admin:${p.actorId}`, reason: input.reason.trim(), idempotencyKey: input.idempotencyKey ?? null,
        requestedBy: p.actorId, requestedByType: actorType(p), correlationId: meta.correlationId ?? null,
      });
      if (row) await this.repo.addActionEvent(tx, { organizationId: org, actionId: row.id, status: "pending", detail: { basis, edgeId: input.edgeId ?? null } as never, actorId: p.actorId, actorType: actorType(p) });
      return row;
    });
    if (!inserted) {
      // A concurrent request with the same idempotency key won the insert.
      const prior = await this.repo.findActionByKey(this.db, org, input.idempotencyKey!);
      if (prior) return { action: prior, replayed: true };
      throw invalidTarget("Enforcement action could not be recorded");
    }

    const adapter = this.adapters.find((a) => a.supports(input.kind));
    if (!adapter) {
      return { action: await this.finish(p, inserted, "unsupported", null, { failureReason: `No enforcement adapter supports ${input.kind}; CORVEN cannot enforce this` }, { supported: false }), replayed: false };
    }
    try {
      const res = await adapter.apply(this.ctx(p, inserted, input.reason));
      const extra = res.failureReason ? { failureReason: res.failureReason } : {};
      return { action: await this.finish(p, inserted, res.status, adapter.name, { ...extra, ...(res.externalReference ? { externalReference: res.externalReference } : {}), result: res as never }, res.detail), replayed: false };
    } catch (e) {
      return { action: await this.finish(p, inserted, "failed", adapter.name, { failureReason: e instanceof Error ? e.message.slice(0, 300) : "adapter error" }, {}), replayed: false };
    }
  }

  private async finish(p: Principal, a: ActionRow, status: ActionRow["status"], adapter: string | null, patch: { failureReason?: string; externalReference?: string; result?: never }, detail: Record<string, unknown>) {
    return this.db.transaction(async (tx) => {
      const updated = await this.repo.updateAction(tx, a.organizationId, a.id, { status, adapter, ...patch });
      await this.repo.addActionEvent(tx, { organizationId: a.organizationId, actionId: a.id, status, detail: { ...detail, ...(patch.failureReason ? { failureReason: patch.failureReason } : {}) } as never, actorId: p.actorId, actorType: actorType(p) });
      return updated;
    });
  }

  private ctx(p: Principal, a: ActionRow, reason: string): AdapterContext {
    return { organizationId: a.organizationId, actionId: a.id, kind: a.kind, agentId: a.agentId, resourceId: a.resourceId, reason: reason.trim(), incidentId: a.incidentId, principal: p };
  }

  private async validateTarget(org: string, i: ApplyInput): Promise<void> {
    const needsAgent = i.kind === "revoke_resource_access" || i.kind === "suspend_agent" || i.kind === "revoke_credentials";
    if (needsAgent && !i.agentId) throw invalidTarget(`${i.kind} needs agentId`);
    if (i.kind === "revoke_resource_access" && !i.resourceId) throw invalidTarget("revoke_resource_access needs resourceId");
    if (i.agentId && !(await this.agents.getAgent(org, i.agentId))) throw notFound("Agent", "AGENT_NOT_FOUND");
    if (i.resourceId && !(await this.resources.getResource(org, i.resourceId))) throw notFound("Resource", "RESOURCE_NOT_FOUND");
    if (i.incidentId && !(await this.incidents.getIncident(org, i.incidentId))) throw notFound("Incident", "INCIDENT_NOT_FOUND");
  }
}
