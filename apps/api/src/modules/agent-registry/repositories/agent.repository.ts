import { and, asc, count, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import {
  agentAuditLogs,
  agentCapabilities,
  agentIdentities,
  agents,
  agentStatusHistory,
} from "../../../db/schema.js";
import type {
  Agent,
  AgentIdentity,
  AgentStatus,
  AgentType,
  AuditAction,
  AuditLogEntry,
  IdentityType,
  StatusHistoryEntry,
  VerificationStatus,
} from "../types/agent.types.js";

/**
 * All queries are scoped by organizationId. Methods take an Executor so that
 * services can run several of them in one transaction.
 */

export interface ListFilters {
  status?: AgentStatus | undefined;
  agentType?: AgentType | undefined;
  search?: string | undefined;
  limit: number;
  offset: number;
}

const toAgent = (r: typeof agents.$inferSelect): Agent => ({
  id: r.id,
  organizationId: r.organizationId,
  name: r.name,
  description: r.description,
  agentType: r.agentType as AgentType,
  status: r.status as AgentStatus,
  runtimeType: r.runtimeType,
  ownerReference: r.ownerReference,
  externalReference: r.externalReference,
  metadata: r.metadata,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toIdentity = (r: typeof agentIdentities.$inferSelect): AgentIdentity => ({
  id: r.id,
  agentId: r.agentId,
  identityType: r.identityType as IdentityType,
  identityValue: r.identityValue,
  verificationStatus: r.verificationStatus as VerificationStatus,
  chainId: r.chainId,
  verifiedAt: r.verifiedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class AgentRepository {
  async insertAgent(
    tx: Executor,
    v: {
      organizationId: string;
      name: string;
      description: string | null;
      agentType: AgentType;
      status: AgentStatus;
      runtimeType?: string | null;
      ownerReference?: string | null;
      externalReference?: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<Agent> {
    const [row] = await tx.insert(agents).values(v).returning();
    return toAgent(row!);
  }

  async findAgent(tx: Executor, organizationId: string, id: string, opts: { forUpdate?: boolean } = {}): Promise<Agent | null> {
    const q = tx
      .select()
      .from(agents)
      .where(and(eq(agents.organizationId, organizationId), eq(agents.id, id)));
    const rows = await (opts.forUpdate ? q.for("update") : q);
    return rows[0] ? toAgent(rows[0]) : null;
  }

  async findByExternalReference(tx: Executor, organizationId: string, externalReference: string): Promise<Agent | null> {
    const rows = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.organizationId, organizationId), sql`lower(${agents.externalReference}) = lower(${externalReference})`));
    return rows[0] ? toAgent(rows[0]) : null;
  }

  async listAgents(tx: Executor, organizationId: string, f: ListFilters): Promise<{ items: Agent[]; total: number }> {
    const conds: SQL[] = [eq(agents.organizationId, organizationId)];
    if (f.status) conds.push(eq(agents.status, f.status));
    if (f.agentType) conds.push(eq(agents.agentType, f.agentType));
    if (f.search) conds.push(ilike(agents.name, `%${escapeLike(f.search)}%`));
    const where = and(...conds);
    const [rows, totals] = await Promise.all([
      tx.select().from(agents).where(where).orderBy(desc(agents.createdAt), desc(agents.id)).limit(f.limit).offset(f.offset),
      tx.select({ n: count() }).from(agents).where(where),
    ]);
    return { items: rows.map(toAgent), total: totals[0]?.n ?? 0 };
  }

  async updateAgent(
    tx: Executor,
    organizationId: string,
    id: string,
    patch: Partial<{
      name: string;
      description: string | null;
      agentType: AgentType;
      runtimeType: string | null;
      ownerReference: string | null;
      externalReference: string | null;
      metadata: Record<string, unknown>;
      status: AgentStatus;
    }>,
  ): Promise<Agent> {
    const [row] = await tx
      .update(agents)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(agents.organizationId, organizationId), eq(agents.id, id)))
      .returning();
    return toAgent(row!);
  }

  // ----- capabilities

  async getCapabilities(tx: Executor, agentId: string): Promise<string[]> {
    const rows = await tx.select({ c: agentCapabilities.capability }).from(agentCapabilities).where(eq(agentCapabilities.agentId, agentId)).orderBy(asc(agentCapabilities.capability));
    return rows.map((r) => r.c);
  }

  async replaceCapabilities(tx: Executor, agentId: string, next: readonly string[]): Promise<void> {
    const current = new Set(await this.getCapabilities(tx, agentId));
    const wanted = new Set(next);
    const toRemove = [...current].filter((c) => !wanted.has(c));
    const toAdd = [...wanted].filter((c) => !current.has(c));
    if (toRemove.length) {
      await tx.delete(agentCapabilities).where(and(eq(agentCapabilities.agentId, agentId), inArray(agentCapabilities.capability, toRemove)));
    }
    if (toAdd.length) {
      await tx.insert(agentCapabilities).values(toAdd.map((capability) => ({ agentId, capability })));
    }
  }

  // ----- identities

  async getIdentities(tx: Executor, organizationId: string, agentId: string): Promise<AgentIdentity[]> {
    const rows = await tx
      .select()
      .from(agentIdentities)
      .where(and(eq(agentIdentities.organizationId, organizationId), eq(agentIdentities.agentId, agentId)))
      .orderBy(asc(agentIdentities.createdAt), asc(agentIdentities.id));
    return rows.map(toIdentity);
  }

  async insertIdentity(
    tx: Executor,
    v: { organizationId: string; agentId: string; identityType: IdentityType; identityValue: string; chainId: number | null },
  ): Promise<AgentIdentity> {
    // verification_status always starts as 'unverified'; callers cannot choose.
    const [row] = await tx.insert(agentIdentities).values({ ...v, verificationStatus: "unverified", verifiedAt: null }).returning();
    return toIdentity(row!);
  }

  async deleteIdentities(tx: Executor, organizationId: string, agentId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await tx.delete(agentIdentities).where(and(eq(agentIdentities.organizationId, organizationId), eq(agentIdentities.agentId, agentId), inArray(agentIdentities.id, ids)));
  }

  async setIdentityVerification(
    tx: Executor,
    organizationId: string,
    agentId: string,
    identityId: string,
    status: VerificationStatus,
  ): Promise<AgentIdentity | null> {
    const [row] = await tx
      .update(agentIdentities)
      .set({ verificationStatus: status, verifiedAt: status === "verified" ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(agentIdentities.organizationId, organizationId), eq(agentIdentities.agentId, agentId), eq(agentIdentities.id, identityId)))
      .returning();
    return row ? toIdentity(row) : null;
  }

  // ----- history and audit (append-only)

  async insertStatusHistory(
    tx: Executor,
    v: { organizationId: string; agentId: string; previousStatus: AgentStatus | null; newStatus: AgentStatus; actorId: string | null; reason: string; incidentId: string | null },
  ): Promise<void> {
    await tx.insert(agentStatusHistory).values(v);
  }

  async listStatusHistory(
    tx: Executor,
    organizationId: string,
    agentId: string,
    page: { limit: number; offset: number },
  ): Promise<{ items: StatusHistoryEntry[]; total: number }> {
    const where = and(eq(agentStatusHistory.organizationId, organizationId), eq(agentStatusHistory.agentId, agentId));
    const [rows, totals] = await Promise.all([
      tx.select().from(agentStatusHistory).where(where).orderBy(desc(agentStatusHistory.createdAt), desc(agentStatusHistory.id)).limit(page.limit).offset(page.offset),
      tx.select({ n: count() }).from(agentStatusHistory).where(where),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        agentId: r.agentId,
        previousStatus: r.previousStatus as AgentStatus | null,
        newStatus: r.newStatus as AgentStatus,
        actorId: r.actorId,
        reason: r.reason,
        incidentId: r.incidentId,
        createdAt: r.createdAt,
      })),
      total: totals[0]?.n ?? 0,
    };
  }

  async insertAudit(
    tx: Executor,
    v: { organizationId: string; agentId: string; actorId: string | null; action: AuditAction; beforeState: unknown; afterState: unknown },
  ): Promise<void> {
    await tx.insert(agentAuditLogs).values(v);
  }

  /** Read-only; used by tests and future audit tooling. There is no update or delete method. */
  async listAudit(tx: Executor, organizationId: string, agentId: string): Promise<AuditLogEntry[]> {
    const rows = await tx
      .select()
      .from(agentAuditLogs)
      .where(and(eq(agentAuditLogs.organizationId, organizationId), eq(agentAuditLogs.agentId, agentId)))
      .orderBy(asc(agentAuditLogs.createdAt), sql`${agentAuditLogs.id}`);
    return rows.map((r) => ({ ...r, action: r.action as AuditAction }));
  }
}
