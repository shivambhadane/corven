import { and, asc, eq } from "drizzle-orm";
import { canonicalHash } from "../../../common/canonical.js";
import type { Executor } from "../../../db/client.js";
import { schema as t } from "../../../db/client.js";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const hashText = (s: string | null | undefined) => (s ? canonicalHash(s) : null);

export const EVIDENCE_LIMITATIONS = [
  "A hash proves that this content has not changed since it was sealed. It does not prove that the recorded events happened as described.",
  "Free text (incident description, reasons, comments, notes) is represented only by hashes, to keep personal and sensitive data out of the record.",
  "Actor identities are CORVEN ids from the authenticator in use; human authentication is still development-only.",
  "Verification and enforcement results cover only CORVEN's enforcement boundary and registered dependencies.",
] as const;

/**
 * Reads everything the incident's evidence needs, read only, from the tables of
 * the modules that produced it. Must run inside one REPEATABLE READ transaction
 * so every section reflects the same moment. Ordering is deterministic.
 */
export async function collectIncident(tx: Executor, org: string, incidentId: string) {
  const byInc = <T extends { organizationId: unknown; incidentId: unknown }>(tbl: T) => and(eq((tbl as never as typeof t.incidentEvents).organizationId, org), eq((tbl as never as typeof t.incidentEvents).incidentId, incidentId));
  const [incident] = await tx.select().from(t.incidents).where(and(eq(t.incidents.organizationId, org), eq(t.incidents.id, incidentId)));
  if (!incident) return null;

  const states = await tx.select().from(t.incidentStateHistory).where(byInc(t.incidentStateHistory)).orderBy(asc(t.incidentStateHistory.createdAt), asc(t.incidentStateHistory.id));
  const agents = await tx.select().from(t.incidentAgents).where(byInc(t.incidentAgents)).orderBy(asc(t.incidentAgents.createdAt), asc(t.incidentAgents.id));
  const resources = await tx.select().from(t.incidentResources).where(byInc(t.incidentResources)).orderBy(asc(t.incidentResources.createdAt), asc(t.incidentResources.id));
  const refs = await tx.select().from(t.incidentAnalysisReferences).where(byInc(t.incidentAnalysisReferences)).orderBy(asc(t.incidentAnalysisReferences.kind), asc(t.incidentAnalysisReferences.version));
  const events = await tx.select().from(t.incidentEvents).where(byInc(t.incidentEvents)).orderBy(asc(t.incidentEvents.seq));
  const notes = await tx.select().from(t.incidentNotes).where(byInc(t.incidentNotes)).orderBy(asc(t.incidentNotes.createdAt), asc(t.incidentNotes.id));
  const approvals = await tx.select().from(t.approvalRequests).where(byInc(t.approvalRequests)).orderBy(asc(t.approvalRequests.createdAt), asc(t.approvalRequests.id));
  const decisions = approvals.length ? await tx.select().from(t.approvalDecisions).where(eq(t.approvalDecisions.organizationId, org)).orderBy(asc(t.approvalDecisions.createdAt), asc(t.approvalDecisions.id)) : [];
  const actions = await tx.select().from(t.enforcementActions).where(and(eq(t.enforcementActions.organizationId, org), eq(t.enforcementActions.incidentId, incidentId))).orderBy(asc(t.enforcementActions.createdAt), asc(t.enforcementActions.id));
  const actionEvents = actions.length ? await tx.select().from(t.enforcementActionEvents).where(eq(t.enforcementActionEvents.organizationId, org)).orderBy(asc(t.enforcementActionEvents.seq)) : [];
  const runs = await tx.select().from(t.verificationRuns).where(byInc(t.verificationRuns)).orderBy(asc(t.verificationRuns.createdAt), asc(t.verificationRuns.id));

  const agentIds = [...new Set(agents.map((a) => a.agentId))];
  const identities = agentIds.length ? (await tx.select().from(t.agentIdentities).where(eq(t.agentIdentities.organizationId, org)).orderBy(asc(t.agentIdentities.createdAt), asc(t.agentIdentities.id))).filter((i) => agentIds.includes(i.agentId)) : [];

  const approvalIds = new Set(approvals.map((a) => a.id));
  const actionIds = new Set(actions.map((a) => a.id));
  const timelineEvents = events.map((e) => ({ id: e.id, sequence: e.seq, type: e.eventType, actorId: e.actorId, actorType: e.actorType, at: iso(e.createdAt) }));

  return {
    incident: {
      id: incident.id, title: incident.title, descriptionHash: hashText(incident.description), severity: incident.severity, status: incident.status,
      detectionSource: incident.detectionSource, detectionReference: incident.detectionReference, createdBy: incident.createdBy, createdByType: incident.createdByType, createdAt: iso(incident.createdAt),
      stateHistory: states.map((s) => ({ from: s.fromStatus, to: s.toStatus, actorId: s.actorId, actorType: s.actorType, reasonHash: hashText(s.reason), at: iso(s.createdAt) })),
    },
    agents: agents.map((a) => ({ agentId: a.agentId, relationship: a.relationship, suspectedCompromised: a.suspectedCompromised, impact: a.impact, source: a.source, at: iso(a.createdAt) })),
    // Identity references as registered (for example an ENS name and its recorded verification state). This is a record of
    // what CORVEN held at sealing time, not a live on-chain resolution, and not proof of ownership or authority.
    identities: identities.map((i) => ({ agentId: i.agentId, type: i.identityType, value: i.identityValue, verificationStatus: i.verificationStatus, chainId: i.chainId, verifiedAt: iso(i.verifiedAt) })),
    resources: resources.map((r) => ({ resourceId: r.resourceId, resourceType: r.resourceType, relationship: r.relationship, impactClassification: r.impactClassification, source: r.source, at: iso(r.createdAt) })),
    analysis: refs.map((r) => ({
      referenceId: r.id, kind: r.kind, version: r.version, snapshotId: r.snapshotId, snapshotHash: r.snapshotHash, snapshotFormatVersion: r.snapshotFormatVersion,
      engineVersion: r.engineVersion, resultHash: r.resultHash, planHash: r.planHash, planStatus: r.planStatus, at: iso(r.createdAt),
    })),
    approvals: approvals.map((a) => ({
      approvalId: a.id, status: a.status, planReferenceId: a.planReferenceId, planHash: a.planHash, approvalDigest: a.approvalDigest, schemaVersion: a.schemaVersion, risk: a.risk,
      requiredApprovals: a.requiredApprovals, requestedBy: a.requestedBy, createdAt: iso(a.createdAt), decidedAt: iso(a.decidedAt), executableUntil: iso(a.executableUntil), closedReasonHash: hashText(a.closedReason),
      decisions: decisions.filter((d) => d.approvalId === a.id).map((d) => ({ decidedBy: d.decidedBy, role: d.role, decision: d.decision, planHash: d.planHash, approvalDigest: d.approvalDigest, commentHash: hashText(d.comment), at: iso(d.createdAt) })),
    })).filter((a) => approvalIds.has(a.approvalId)),
    enforcement: actions.map((a) => ({
      actionId: a.id, kind: a.kind, status: a.status, adapter: a.adapter, approvalBasis: a.approvalBasis, approvalRef: a.approvalRef, planHash: a.planHash, edgeId: a.edgeId,
      agentId: a.agentId, resourceId: a.resourceId, failureReason: a.failureReason, externalReference: a.externalReference, requestedBy: a.requestedBy, requestedByType: a.requestedByType,
      history: actionEvents.filter((e) => e.actionId === a.id && actionIds.has(a.id)).map((e) => ({ status: e.status, actorType: e.actorType, at: iso(e.createdAt) })),
    })),
    verification: runs.map((r) => ({
      runId: r.id, status: r.status, attempt: r.attempt, retryOf: r.retryOf, approvalId: r.approvalId, planHash: r.planHash, snapshotHash: r.snapshotHash, resultHash: r.resultHash,
      incidentOutcome: r.incidentOutcome, counts: (r.summary as { counts?: unknown } | null)?.counts ?? null, completedAt: iso(r.completedAt),
    })),
    timeline: { eventCount: events.length, timelineHash: canonicalHash(events.map((e) => ({ id: e.id, seq: e.seq, type: e.eventType, actorId: e.actorId, actorType: e.actorType, data: e.data, correlationId: e.correlationId, at: iso(e.createdAt) }))), events: timelineEvents },
    notes: { count: notes.length, contentHash: canonicalHash(notes.map((n) => ({ id: n.id, authorId: n.authorId, content: n.content, at: iso(n.createdAt) }))) },
  };
}

/** Hash of the first `count` timeline events, computed the same way as at sealing. Used to prove the sealed prefix is unchanged. */
export async function timelinePrefixHash(tx: Executor, org: string, incidentId: string, count: number): Promise<string> {
  const events = await tx.select().from(t.incidentEvents).where(and(eq(t.incidentEvents.organizationId, org), eq(t.incidentEvents.incidentId, incidentId))).orderBy(asc(t.incidentEvents.seq)).limit(count);
  return canonicalHash(events.map((e) => ({ id: e.id, seq: e.seq, type: e.eventType, actorId: e.actorId, actorType: e.actorType, data: e.data, correlationId: e.correlationId, at: iso(e.createdAt) })));
}

export async function notesPrefixHash(tx: Executor, org: string, incidentId: string, count: number): Promise<string> {
  const notes = await tx.select().from(t.incidentNotes).where(and(eq(t.incidentNotes.organizationId, org), eq(t.incidentNotes.incidentId, incidentId))).orderBy(asc(t.incidentNotes.createdAt), asc(t.incidentNotes.id)).limit(count);
  return canonicalHash(notes.map((n) => ({ id: n.id, authorId: n.authorId, content: n.content, at: iso(n.createdAt) })));
}
