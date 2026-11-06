import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Database, Executor } from "../../../db/client.js";
import { ForbiddenError, UnprocessableError, ValidationError } from "../../../errors.js";
import { allowedFrom, edgeFor, type Edge } from "../core/state-machine.js";
import { dataSize, findSecretInData, findSecretInText, MAX_EVENT_DATA_BYTES } from "../core/validation.js";
import {
  agentNotFound, alreadyAssociated, idempotencyConflict, incidentClosed, incidentNotFound, InvalidIncidentTransitionError,
  resourceNotFound, staleState, TransitionNotPermittedError,
} from "../errors.js";
import type { EventRow, IncidentRepository, ListFilter } from "../repositories/incident.repository.js";
import {
  EXTERNAL_EVENT_TYPES, type AgentImpact, type AgentRelationship, type AssociationSource, type DetectionSource, type ExternalEventType,
  type ImpactClassification, type Incident, type IncidentStatus, type RequestMeta, type ResourceRelationship, type Severity,
} from "../types.js";
import { actorTypeOf, recordChange } from "./shared.js";

/** Narrow ports onto the registries: the incident module needs "does it exist here", nothing more. */
export interface AgentLookup {
  getAgent(organizationId: string, agentId: string): Promise<{ id: string } | null>;
}
export interface ResourceLookup {
  getResource(organizationId: string, resourceId: string): Promise<{ id: string; resourceType: string } | null>;
}

export interface AgentAssociationInput {
  agentId: string;
  relationship: AgentRelationship;
  suspectedCompromised?: boolean | undefined;
  impact?: AgentImpact | undefined;
  source?: AssociationSource | undefined;
  sourceReference?: string | undefined;
}
export interface ResourceAssociationInput {
  resourceId: string;
  relationship: ResourceRelationship;
  impactClassification?: ImpactClassification | undefined;
  source?: AssociationSource | undefined;
  sourceReference?: string | undefined;
}
export interface CreateIncidentInput {
  title: string;
  description?: string | undefined;
  severity: Severity;
  detectionSource?: DetectionSource | undefined;
  /** The signal's id in the producing system. Required for non-manual sources; makes intake idempotent. */
  detectionReference?: string | undefined;
  agents?: AgentAssociationInput[] | undefined;
  resources?: ResourceAssociationInput[] | undefined;
}
export interface TransitionInput {
  to: IncidentStatus;
  reason: string;
  /** Optimistic check: fail if the incident is not in this state. */
  expectedStatus?: IncidentStatus | undefined;
  acknowledgeResidualRisk?: boolean | undefined;
  /** Required for retried internal calls: a repeat returns the first result and writes nothing. */
  idempotencyKey?: string | undefined;
  /** Structured context from a trusted module (for example the approval id). Stored on the timeline event. */
  data?: Record<string, unknown> | undefined;
}

const norm = (s: string) => s.trim();
const defaultImpact = (r: AgentRelationship): AgentImpact => (r === "compromised" || r === "affected" ? "direct" : r === "dependent" ? "indirect" : "none");

/**
 * The incident lifecycle coordinator. It records, orders and guards; it does not
 * authorize operations, approve plans, execute containment or claim containment:
 * the transitions that assert those facts can only be made by the `system`
 * principal, which no HTTP request can obtain.
 */
export class IncidentService {
  constructor(
    private readonly db: Database,
    private readonly repo: IncidentRepository,
    private readonly agents: AgentLookup,
    private readonly resources: ResourceLookup,
  ) {}

  // ------------------------------------------------------------------ create / read

  async create(p: Principal, input: CreateIncidentInput, meta: RequestMeta = {}): Promise<{ incident: Incident; created: boolean }> {
    assertCan(p, "incident:write");
    const source = input.detectionSource ?? "manual";
    if (source !== "manual") {
      assertCan(p, "incident:event");
      if (!input.detectionReference) throw new ValidationError("detectionReference is required for signals from a detection source");
    } else if (input.detectionReference) {
      throw new ValidationError("detectionReference applies only to automated detection sources");
    }
    const title = norm(input.title);
    if (!title) throw new ValidationError("title must not be blank");
    this.assertNoSecret(input.description ?? "", "description");
    this.assertNoSecret(title, "title");
    for (const a of input.agents ?? []) await this.assertAgent(p.organizationId, a.agentId);
    for (const r of input.resources ?? []) await this.assertResource(p.organizationId, r.resourceId);

    return this.db.transaction(async (tx) => {
      if (input.detectionReference) {
        const existing = await this.repo.findByDetection(tx, p.organizationId, source, input.detectionReference);
        if (existing) return { incident: existing, created: false };
      }
      const inc = await this.repo.insert(tx, {
        organizationId: p.organizationId, title, description: input.description ?? "", severity: input.severity, status: "detected",
        detectionSource: source, detectionReference: input.detectionReference ?? null, createdBy: p.actorId, createdByType: actorTypeOf(p),
      });
      if (!inc) {
        // Lost a race with an identical signal: return the winner.
        const winner = await this.repo.findByDetection(tx, p.organizationId, source, input.detectionReference ?? "");
        if (winner) return { incident: winner, created: false };
        throw new ValidationError("Incident could not be created");
      }
      await this.repo.addState(tx, { organizationId: inc.organizationId, incidentId: inc.id, fromStatus: null, toStatus: "detected", actorId: p.actorId, actorType: actorTypeOf(p), reason: "Incident created", correlationId: meta.correlationId ?? null });
      await recordChange(this.repo, tx, inc, p, meta, {
        event: "incident.created", targetType: "incident", targetId: inc.id,
        data: { title, severity: inc.severity, detectionSource: source, detectionReference: inc.detectionReference },
        after: { status: inc.status, severity: inc.severity, title },
      });
      for (const a of input.agents ?? []) await this.associateAgent(tx, p, inc, a, meta);
      for (const r of input.resources ?? []) await this.associateResource(tx, p, inc, r, meta);
      return { incident: inc, created: true };
    });
  }

  async get(p: Principal, id: string): Promise<Incident> {
    assertCan(p, "incident:read");
    const inc = await this.repo.find(this.db, p.organizationId, id);
    if (!inc) throw incidentNotFound();
    return inc;
  }

  async list(p: Principal, filter: ListFilter, page: { limit: number; offset: number }) {
    assertCan(p, "incident:read");
    return this.repo.list(this.db, p.organizationId, filter, page);
  }

  /** The transitions this caller could attempt from the incident's current state (a hint, not a promise: guards still apply). */
  availableTransitions(p: Principal, inc: Incident): Array<{ to: IncidentStatus; recovery: boolean }> {
    const actor = actorTypeOf(p);
    return allowedFrom(inc.status)
      .filter((e) => e.actors.includes(actor) && (!e.recovery || p.role === "admin"))
      .map((e) => ({ to: e.to, recovery: e.recovery === true }));
  }

  // ------------------------------------------------------------------ update

  async update(p: Principal, id: string, patch: { title?: string | undefined; description?: string | undefined; severity?: Severity | undefined }, meta: RequestMeta = {}): Promise<Incident> {
    assertCan(p, "incident:write");
    if (patch.title !== undefined && !norm(patch.title)) throw new ValidationError("title must not be blank");
    if (patch.title !== undefined) this.assertNoSecret(patch.title, "title");
    if (patch.description !== undefined) this.assertNoSecret(patch.description, "description");
    return this.db.transaction(async (tx) => {
      const inc = await this.open(tx, p, id);
      const next: Partial<typeof inc> = {};
      if (patch.title !== undefined && norm(patch.title) !== inc.title) next.title = norm(patch.title);
      if (patch.description !== undefined && patch.description !== inc.description) next.description = patch.description;
      if (patch.severity !== undefined && patch.severity !== inc.severity) next.severity = patch.severity;
      if (Object.keys(next).length === 0) return inc;
      const updated = await this.repo.update(tx, p.organizationId, id, next);
      const before = { title: inc.title, description: inc.description, severity: inc.severity };
      const after = { title: updated.title, description: updated.description, severity: updated.severity };
      if (next.severity) {
        await recordChange(this.repo, tx, inc, p, meta, { event: "incident.severity_changed", targetType: "incident", targetId: id, data: { from: inc.severity, to: next.severity }, before: { severity: inc.severity }, after: { severity: next.severity } });
      }
      if (next.title !== undefined || next.description !== undefined) {
        await recordChange(this.repo, tx, inc, p, meta, { event: "incident.updated", targetType: "incident", targetId: id, data: { fields: Object.keys(next).filter((k) => k !== "severity") }, before, after });
      }
      return updated;
    });
  }

  // ------------------------------------------------------------------ lifecycle

  async transition(p: Principal, id: string, input: TransitionInput, meta: RequestMeta = {}): Promise<{ incident: Incident; replayed: boolean }> {
    assertCan(p, "incident:transition");
    const reason = norm(input.reason);
    if (!reason) throw new ValidationError("A reason is required for every transition");
    if (reason.length > 1000) throw new ValidationError("reason must be at most 1000 characters");
    this.assertNoSecret(reason, "reason");
    if (input.data !== undefined) this.assertEventData(input.data);
    const actor = actorTypeOf(p);
    if (input.data !== undefined && actor !== "system") throw new ForbiddenError("Only trusted internal modules may attach structured data to a transition");

    return this.db.transaction(async (tx) => {
      const inc = await this.repo.lock(tx, p.organizationId, id);
      if (!inc) throw incidentNotFound();

      if (input.idempotencyKey) {
        const prior = await this.repo.findStateByKey(tx, p.organizationId, id, input.idempotencyKey);
        if (prior) {
          if (prior.toStatus !== input.to) throw idempotencyConflict();
          return { incident: inc, replayed: true };
        }
      }
      if (input.expectedStatus && input.expectedStatus !== inc.status) throw staleState(input.expectedStatus, inc.status);

      const edge = edgeFor(inc.status, input.to);
      if (!edge) throw new InvalidIncidentTransitionError(inc.status, input.to, allowedFrom(inc.status).map((e) => e.to));
      this.assertEdgePermitted(p, actor, edge, inc.status);
      await this.checkGuards(tx, p, inc, edge, input);

      const now = new Date();
      const updated = await this.repo.update(tx, p.organizationId, id, { status: input.to, stateEnteredAt: now });
      await this.repo.addState(tx, {
        organizationId: p.organizationId, incidentId: id, fromStatus: inc.status, toStatus: input.to, actorId: p.actorId, actorType: actor,
        reason, correlationId: meta.correlationId ?? null, idempotencyKey: input.idempotencyKey ?? null,
      });
      await recordChange(this.repo, tx, inc, p, meta, {
        event: "incident.transitioned", targetType: "incident", targetId: id,
        data: { from: inc.status, to: input.to, reason, recovery: edge.recovery === true, ...(input.acknowledgeResidualRisk ? { residualRiskAcknowledged: true } : {}), ...(input.data ? { context: input.data } : {}) },
        before: { status: inc.status }, after: { status: input.to },
      });
      if (input.to === "awaiting_approval") {
        // The Approval Service (not built) will consume this and answer with approval.granted / approval.rejected.
        const plan = inc.currentPlanRefId ? await this.repo.findRef(tx, p.organizationId, id, inc.currentPlanRefId) : null;
        await recordChange(this.repo, tx, inc, p, meta, {
          event: "approval.requested", targetType: "containment_plan", targetId: plan?.id ?? null,
          data: { planReferenceId: plan?.id ?? null, planHash: plan?.planHash ?? null, planVersion: plan?.version ?? null },
        });
      }
      return { incident: updated, replayed: false };
    });
  }

  private assertEdgePermitted(p: Principal, actor: "human" | "system", edge: Edge, from: IncidentStatus): void {
    if (!edge.actors.includes(actor)) {
      throw new TransitionNotPermittedError(
        actor === "human"
          ? `Moving from ${from} to ${edge.to} is recorded by a trusted internal module (approval, enforcement or verification), not by a person`
          : `Moving from ${from} to ${edge.to} must be decided by a person`,
      );
    }
    if (edge.recovery) assertCan(p, "incident:recover");
  }

  private async checkGuards(tx: Executor, p: Principal, inc: Incident, edge: Edge, input: TransitionInput): Promise<void> {
    for (const g of edge.guards ?? []) {
      if (g === "residual_risk_acknowledged") {
        if (!input.acknowledgeResidualRisk) throw new UnprocessableError("RESIDUAL_RISK_NOT_ACKNOWLEDGED", "Resolving a partially contained incident requires acknowledgeResidualRisk: true");
        continue;
      }
      const plan = inc.currentPlanRefId ? await this.repo.findRef(tx, p.organizationId, inc.id, inc.currentPlanRefId) : null;
      if (g === "fresh_plan") {
        if (!plan) throw new UnprocessableError("CONTAINMENT_PLAN_REQUIRED", "Generate a containment plan on the current snapshot before planning containment");
        if (plan.createdAt < inc.stateEnteredAt) throw new UnprocessableError("CONTAINMENT_PLAN_STALE", `The current plan predates the incident entering ${inc.status}; generate a new plan`);
      }
      if (g === "feasible_plan" && plan?.planStatus !== "feasible") {
        throw new UnprocessableError("PLAN_NOT_FEASIBLE", `Only a feasible plan can be sent for approval (current plan status: ${plan?.planStatus ?? "none"})`);
      }
    }
  }

  // ------------------------------------------------------------------ associations

  async addAgent(p: Principal, id: string, input: AgentAssociationInput, meta: RequestMeta = {}) {
    assertCan(p, "incident:write");
    await this.assertAgent(p.organizationId, input.agentId);
    return this.db.transaction(async (tx) => {
      const inc = await this.open(tx, p, id);
      return this.associateAgent(tx, p, inc, input, meta);
    });
  }

  private async associateAgent(tx: Executor, p: Principal, inc: Incident, input: AgentAssociationInput, meta: RequestMeta) {
    const source = this.association(p, input.source);
    const suspected = input.suspectedCompromised ?? input.relationship === "compromised";
    if (input.relationship === "compromised" && !suspected) throw new UnprocessableError("INCONSISTENT_ASSOCIATION", "An agent related as compromised is suspected compromised by definition");
    if (input.sourceReference) this.assertNoSecret(input.sourceReference, "sourceReference");
    // Association never changes the agent's status. Suspending or marking it compromised is a separate, explicit Agent Registry action.
    const row = await this.repo.addAgent(tx, {
      organizationId: inc.organizationId, incidentId: inc.id, agentId: input.agentId, relationship: input.relationship, suspectedCompromised: suspected,
      impact: input.impact ?? defaultImpact(input.relationship), source, sourceReference: input.sourceReference ?? null, createdBy: p.actorId,
    });
    if (!row) throw alreadyAssociated();
    await recordChange(this.repo, tx, inc, p, meta, {
      event: "incident.agent_associated", targetType: "incident_agent", targetId: row.id,
      data: { agentId: row.agentId, relationship: row.relationship, suspectedCompromised: row.suspectedCompromised, impact: row.impact, source },
      after: { agentId: row.agentId, relationship: row.relationship },
    });
    return row;
  }

  async listAgents(p: Principal, id: string) {
    await this.get(p, id);
    return this.repo.listAgents(this.db, p.organizationId, id);
  }

  async addResource(p: Principal, id: string, input: ResourceAssociationInput, meta: RequestMeta = {}) {
    assertCan(p, "incident:write");
    await this.assertResource(p.organizationId, input.resourceId);
    return this.db.transaction(async (tx) => {
      const inc = await this.open(tx, p, id);
      return this.associateResource(tx, p, inc, input, meta);
    });
  }

  private async associateResource(tx: Executor, p: Principal, inc: Incident, input: ResourceAssociationInput, meta: RequestMeta) {
    const source = this.association(p, input.source);
    const res = await this.resources.getResource(inc.organizationId, input.resourceId);
    if (!res) throw resourceNotFound();
    if (input.sourceReference) this.assertNoSecret(input.sourceReference, "sourceReference");
    const row = await this.repo.addResource(tx, {
      organizationId: inc.organizationId, incidentId: inc.id, resourceId: res.id, resourceType: res.resourceType, relationship: input.relationship,
      impactClassification: input.impactClassification ?? "unassessed", source, sourceReference: input.sourceReference ?? null, createdBy: p.actorId,
    });
    if (!row) throw alreadyAssociated();
    await recordChange(this.repo, tx, inc, p, meta, {
      event: "incident.resource_associated", targetType: "incident_resource", targetId: row.id,
      data: { resourceId: row.resourceId, resourceType: row.resourceType, relationship: row.relationship, impactClassification: row.impactClassification, source },
      after: { resourceId: row.resourceId, relationship: row.relationship },
    });
    return row;
  }

  async listResources(p: Principal, id: string) {
    await this.get(p, id);
    return this.repo.listResources(this.db, p.organizationId, id);
  }

  // ------------------------------------------------------------------ assignment and notes

  async assign(p: Principal, id: string, input: { assigneeId: string; note?: string | undefined }, meta: RequestMeta = {}) {
    assertCan(p, "incident:write");
    if (input.note) this.assertNoSecret(input.note, "note");
    return this.db.transaction(async (tx) => {
      const inc = await this.open(tx, p, id);
      const row = await this.repo.addAssignment(tx, { organizationId: p.organizationId, incidentId: id, assigneeId: input.assigneeId, assignedBy: p.actorId, note: input.note ?? null });
      const updated = await this.repo.update(tx, p.organizationId, id, { assigneeId: input.assigneeId });
      await recordChange(this.repo, tx, inc, p, meta, {
        event: "incident.assigned", targetType: "incident", targetId: id, data: { assigneeId: input.assigneeId, previousAssigneeId: inc.assigneeId },
        before: { assigneeId: inc.assigneeId }, after: { assigneeId: input.assigneeId },
      });
      return { incident: updated, assignment: row! };
    });
  }

  async listAssignments(p: Principal, id: string) {
    await this.get(p, id);
    return this.repo.listAssignments(this.db, p.organizationId, id);
  }

  async addNote(p: Principal, id: string, content: string, meta: RequestMeta = {}) {
    assertCan(p, "incident:write");
    const text = content.trim();
    if (!text) throw new ValidationError("A note must not be blank");
    this.assertNoSecret(text, "note");
    return this.db.transaction(async (tx) => {
      const inc = await this.open(tx, p, id);
      const row = (await this.repo.addNote(tx, { organizationId: p.organizationId, incidentId: id, authorId: p.actorId, content: text }))!;
      await recordChange(this.repo, tx, inc, p, meta, { event: "incident.note_added", targetType: "incident_note", targetId: row.id, data: { noteId: row.id, length: text.length }, after: { noteId: row.id } });
      return row;
    });
  }

  async listNotes(p: Principal, id: string, page: { limit: number; offset: number }) {
    await this.get(p, id);
    return this.repo.listNotes(this.db, p.organizationId, id, page);
  }

  // ------------------------------------------------------------------ timeline, history, audit

  async timeline(p: Principal, id: string, page: { limit: number; offset: number }): Promise<{ items: EventRow[]; total: number }> {
    await this.get(p, id);
    return this.repo.listEvents(this.db, p.organizationId, id, page);
  }

  async stateHistory(p: Principal, id: string) {
    await this.get(p, id);
    return this.repo.listStates(this.db, p.organizationId, id);
  }

  // ------------------------------------------------------------------ events from other modules

  /**
   * The entry point for modules that do not exist yet (approval, gateway,
   * verification, evidence, detection). Records a fact on the timeline; it never
   * changes state, which stays an explicit `transition`. Idempotent per
   * (incident, idempotencyKey), so a retried delivery records once.
   */
  async recordExternalEvent(
    p: Principal,
    id: string,
    input: { type: ExternalEventType; data: Record<string, unknown>; idempotencyKey: string },
    meta: RequestMeta = {},
  ): Promise<{ recorded: boolean }> {
    assertCan(p, "incident:event");
    if (!(EXTERNAL_EVENT_TYPES as readonly string[]).includes(input.type)) throw new ValidationError(`Unknown event type ${input.type}`);
    if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new ValidationError("idempotencyKey is required (at most 200 characters)");
    this.assertEventData(input.data);
    return this.db.transaction(async (tx) => {
      const inc = await this.repo.lock(tx, p.organizationId, id);
      if (!inc) throw incidentNotFound();
      // Late facts (for example evidence) are accepted on a closed incident: the timeline is a record, not a gate.
      const recorded = await recordChange(this.repo, tx, inc, p, meta, { event: input.type, targetType: "incident", targetId: id, data: input.data, idempotencyKey: input.idempotencyKey });
      return { recorded };
    });
  }

  // ------------------------------------------------------------------ helpers

  /** Loads and locks the incident and refuses changes once it is closed. */
  private async open(tx: Executor, p: Principal, id: string): Promise<Incident> {
    const inc = await this.repo.lock(tx, p.organizationId, id);
    if (!inc) throw incidentNotFound();
    if (inc.status === "closed") throw incidentClosed();
    return inc;
  }

  private association(p: Principal, requested: AssociationSource | undefined): AssociationSource {
    if (requested === undefined || requested === "manual") return "manual";
    assertCan(p, "incident:event");
    return requested;
  }

  private async assertAgent(org: string, agentId: string): Promise<void> {
    if (!(await this.agents.getAgent(org, agentId))) throw agentNotFound();
  }
  private async assertResource(org: string, resourceId: string): Promise<void> {
    if (!(await this.resources.getResource(org, resourceId))) throw resourceNotFound();
  }

  private assertNoSecret(text: string, field: string): void {
    const what = findSecretInText(text);
    if (what) throw new UnprocessableError("CONTAINS_SECRET", `${field} appears to contain ${what}. Remove it; incident records must not hold credentials`);
  }
  private assertEventData(data: Record<string, unknown>): void {
    if (dataSize(data) > MAX_EVENT_DATA_BYTES) throw new ValidationError(`Event data must be at most ${MAX_EVENT_DATA_BYTES} bytes`);
    const secret = findSecretInData(data);
    if (secret) throw new UnprocessableError("CONTAINS_SECRET", `Event data contains something that looks like a credential at "${secret}"`);
  }
}
