import type { Principal } from "../../../auth/principal.js";
import type { Executor } from "../../../db/client.js";
import type { IncidentRepository } from "../repositories/incident.repository.js";
import type { ActorType, EventType, Incident, RequestMeta } from "../types.js";

export const actorTypeOf = (p: Principal): ActorType => (p.role === "system" ? "system" : "human");

export interface Change {
  /** Timeline event, and the audit action (same name). */
  event: EventType;
  data?: Record<string, unknown>;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  idempotencyKey?: string | undefined;
}

/**
 * Writes the timeline event and the audit row for one change, inside the
 * caller's transaction. Returns false if an event with the same idempotency
 * key already exists (nothing is written then).
 */
export async function recordChange(repo: IncidentRepository, tx: Executor, inc: Pick<Incident, "id" | "organizationId">, p: Principal, meta: RequestMeta, c: Change): Promise<boolean> {
  const ev = await repo.addEvent(tx, {
    organizationId: inc.organizationId,
    incidentId: inc.id,
    eventType: c.event,
    actorId: p.actorId,
    actorType: actorTypeOf(p),
    data: c.data ?? {},
    correlationId: meta.correlationId ?? null,
    idempotencyKey: c.idempotencyKey ?? null,
  });
  if (!ev) return false;
  await repo.addAudit(tx, {
    organizationId: inc.organizationId,
    incidentId: inc.id,
    actorId: p.actorId,
    actorType: actorTypeOf(p),
    action: c.event,
    targetType: c.targetType,
    targetId: c.targetId ?? null,
    beforeState: (c.before ?? null) as never,
    afterState: (c.after ?? null) as never,
    correlationId: meta.correlationId ?? null,
  });
  return true;
}
