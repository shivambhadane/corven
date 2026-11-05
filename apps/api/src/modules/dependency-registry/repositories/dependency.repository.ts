import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { dependencies, dependencyAuditLogs, dependencyEvidence, dependencyVersions } from "../../../db/schema.js";
import type {
  ChangeType,
  Dependency,
  DependencyAuditAction,
  DependencyAuditEntry,
  DependencyEvidence,
  EvidenceInput,
  EvidenceKind,
  EvidenceSourceType,
  DependencyStatus,
  DependencyType,
  DependencyVersion,
  EntityType,
  Provenance,
} from "../types/dependency.types.js";

export type Direction = "incoming" | "outgoing" | "both";

export interface DependencyFilters {
  dependencyType?: DependencyType | undefined;
  status?: DependencyStatus | undefined;
  sourceType?: EntityType | undefined;
  sourceId?: string | undefined;
  targetType?: EntityType | undefined;
  targetId?: string | undefined;
  /** Agent-centric filter (used by GET /agents/:id/dependencies). */
  agent?: { id: string; direction: Direction } | undefined;
  limit: number;
  offset: number;
}

export interface NewDependency {
  organizationId: string;
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  dependencyType: DependencyType;
  relationship: string;
  metadata: Record<string, unknown>;
  provenance: Provenance;
  confidence: number;
  observedAt: Date | null;
  lastVerifiedAt: Date | null;
}

export type DependencyPatch = Partial<{
  relationship: string;
  metadata: Record<string, unknown>;
  provenance: Provenance;
  confidence: number;
  observedAt: Date | null;
  lastVerifiedAt: Date | null;
  status: DependencyStatus;
}>;

const toDependency = (r: typeof dependencies.$inferSelect): Dependency => ({
  id: r.id,
  organizationId: r.organizationId,
  sourceType: r.sourceType as EntityType,
  sourceId: r.sourceId!,
  targetType: r.targetType as EntityType,
  targetId: r.targetId!,
  dependencyType: r.dependencyType as DependencyType,
  relationship: r.relationship,
  metadata: r.metadata,
  provenance: r.provenance as unknown as Provenance,
  confidence: r.confidence,
  observedAt: r.observedAt,
  lastVerifiedAt: r.lastVerifiedAt,
  status: r.status as DependencyStatus,
  version: r.version,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Every query is organization-scoped. Methods take an Executor so services can use one transaction. */
export class DependencyRepository {
  async insert(tx: Executor, v: NewDependency): Promise<Dependency> {
    const [row] = await tx
      .insert(dependencies)
      .values({
        organizationId: v.organizationId,
        sourceType: v.sourceType,
        sourceAgentId: v.sourceType === "agent" ? v.sourceId : null,
        sourceResourceId: v.sourceType === "resource" ? v.sourceId : null,
        targetType: v.targetType,
        targetAgentId: v.targetType === "agent" ? v.targetId : null,
        targetResourceId: v.targetType === "resource" ? v.targetId : null,
        dependencyType: v.dependencyType,
        relationship: v.relationship,
        metadata: v.metadata,
        provenance: v.provenance as unknown as Record<string, unknown>,
        confidence: v.confidence,
        observedAt: v.observedAt,
        lastVerifiedAt: v.lastVerifiedAt,
        status: "active",
        version: 1,
      })
      .returning();
    return toDependency(row!);
  }

  async find(tx: Executor, organizationId: string, id: string, opts: { forUpdate?: boolean } = {}): Promise<Dependency | null> {
    const q = tx.select().from(dependencies).where(and(eq(dependencies.organizationId, organizationId), eq(dependencies.id, id)));
    const rows = await (opts.forUpdate ? q.for("update") : q);
    return rows[0] ? toDependency(rows[0]) : null;
  }

  async findByPair(
    tx: Executor,
    organizationId: string,
    pair: { sourceType: EntityType; sourceId: string; targetType: EntityType; targetId: string; dependencyType: DependencyType },
  ): Promise<Dependency | null> {
    const rows = await tx
      .select()
      .from(dependencies)
      .where(
        and(
          eq(dependencies.organizationId, organizationId),
          eq(dependencies.sourceType, pair.sourceType),
          eq(dependencies.sourceId, pair.sourceId),
          eq(dependencies.targetType, pair.targetType),
          eq(dependencies.targetId, pair.targetId),
          eq(dependencies.dependencyType, pair.dependencyType),
        ),
      );
    return rows[0] ? toDependency(rows[0]) : null;
  }

  async list(tx: Executor, organizationId: string, f: DependencyFilters): Promise<{ items: Dependency[]; total: number }> {
    const conds: SQL[] = [eq(dependencies.organizationId, organizationId)];
    if (f.dependencyType) conds.push(eq(dependencies.dependencyType, f.dependencyType));
    if (f.status) conds.push(eq(dependencies.status, f.status));
    if (f.sourceType) conds.push(eq(dependencies.sourceType, f.sourceType));
    if (f.sourceId) conds.push(eq(dependencies.sourceId, f.sourceId));
    if (f.targetType) conds.push(eq(dependencies.targetType, f.targetType));
    if (f.targetId) conds.push(eq(dependencies.targetId, f.targetId));
    if (f.agent) {
      const out = and(eq(dependencies.sourceType, "agent"), eq(dependencies.sourceAgentId, f.agent.id));
      const inc = and(eq(dependencies.targetType, "agent"), eq(dependencies.targetAgentId, f.agent.id));
      conds.push((f.agent.direction === "outgoing" ? out : f.agent.direction === "incoming" ? inc : or(out, inc))!);
    }
    const where = and(...conds);
    const [rows, totals] = await Promise.all([
      tx.select().from(dependencies).where(where).orderBy(desc(dependencies.createdAt), desc(dependencies.id)).limit(f.limit).offset(f.offset),
      tx.select({ n: count() }).from(dependencies).where(where),
    ]);
    return { items: rows.map(toDependency), total: totals[0]?.n ?? 0 };
  }

  /** Applies the patch and bumps version by exactly one. Caller must hold the row lock. */
  async update(tx: Executor, organizationId: string, id: string, patch: DependencyPatch): Promise<Dependency> {
    const { provenance, ...rest } = patch;
    const [row] = await tx
      .update(dependencies)
      .set({
        ...rest,
        ...(provenance ? { provenance: provenance as unknown as Record<string, unknown> } : {}),
        version: sql`${dependencies.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(dependencies.organizationId, organizationId), eq(dependencies.id, id)))
      .returning();
    return toDependency(row!);
  }

  // ----- authority cycle support (NOT a general graph engine)

  /** Serialises authority-edge mutations per organization so two concurrent inserts cannot jointly form a cycle. */
  async lockAuthorityEdges(tx: Executor, organizationId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"corven:authority:" + organizationId}, 0))`);
  }

  /**
   * Returns an existing path of ACTIVE authority edges from `from` to `to`
   * (agent ids, inclusive), or null. Used only to decide whether adding
   * `to -> from` would close a cycle. Bounded depth; follows authority edges only.
   */
  async findAuthorityPath(tx: Executor, organizationId: string, from: string, to: string): Promise<string[] | null> {
    const res = await tx.execute<{ path: string[] }>(sql`
      with recursive walk(node, path) as (
        select ${from}::uuid, array[${from}::uuid]
        union all
        select d.target_agent_id, w.path || d.target_agent_id
        from walk w
        join dependencies d on d.source_agent_id = w.node
        where d.organization_id = ${organizationId}::uuid
          and d.dependency_type = 'authority'
          and d.status = 'active'
          and d.source_type = 'agent' and d.target_type = 'agent'
          and not (d.target_agent_id = any (w.path))
          and cardinality(w.path) < 200
      )
      select path from walk where node = ${to}::uuid limit 1
    `);
    const row = res.rows[0];
    return row ? row.path : null;
  }

  // ----- versions and audit (append-only)

  async insertVersion(
    tx: Executor,
    v: { organizationId: string; dependencyId: string; version: number; changeType: ChangeType; changedBy: string | null; state: unknown },
  ): Promise<void> {
    await tx.insert(dependencyVersions).values(v);
  }

  async listVersions(tx: Executor, organizationId: string, dependencyId: string, page: { limit: number; offset: number }): Promise<{ items: DependencyVersion[]; total: number }> {
    const where = and(eq(dependencyVersions.organizationId, organizationId), eq(dependencyVersions.dependencyId, dependencyId));
    const [rows, totals] = await Promise.all([
      tx.select().from(dependencyVersions).where(where).orderBy(desc(dependencyVersions.version)).limit(page.limit).offset(page.offset),
      tx.select({ n: count() }).from(dependencyVersions).where(where),
    ]);
    return { items: rows.map((r) => ({ ...r, changeType: r.changeType as ChangeType })), total: totals[0]?.n ?? 0 };
  }

  async insertAudit(
    tx: Executor,
    v: { organizationId: string; dependencyId: string; actorId: string | null; action: DependencyAuditAction; beforeState: unknown; afterState: unknown },
  ): Promise<void> {
    await tx.insert(dependencyAuditLogs).values(v);
  }

  /** Read-only; there is deliberately no update or delete method. */
  async listAudit(tx: Executor, organizationId: string, dependencyId: string): Promise<DependencyAuditEntry[]> {
    const rows = await tx
      .select()
      .from(dependencyAuditLogs)
      .where(and(eq(dependencyAuditLogs.organizationId, organizationId), eq(dependencyAuditLogs.dependencyId, dependencyId)))
      .orderBy(asc(dependencyAuditLogs.createdAt), asc(dependencyAuditLogs.id));
    return rows.map((r) => ({ ...r, action: r.action as DependencyAuditAction }));
  }

  // ----- evidence (append-only)

  /** Inserts evidence; a retried run's duplicate is ignored. Returns true if a new row was written. */
  async insertEvidence(tx: Executor, organizationId: string, dependencyId: string, e: EvidenceInput): Promise<boolean> {
    const rows = await tx
      .insert(dependencyEvidence)
      .values({
        organizationId,
        dependencyId,
        sourceType: e.sourceType,
        sourceReference: e.sourceReference ?? null,
        discoveryRunId: e.discoveryRunId ?? null,
        evidenceKind: e.evidenceKind,
        evidenceReference: e.evidenceReference ?? null,
        sourceVersion: e.sourceVersion ?? null,
        confidence: e.confidence,
        observedAt: e.observedAt,
      })
      .onConflictDoNothing()
      .returning({ id: dependencyEvidence.id });
    return rows.length > 0;
  }

  async listEvidence(
    tx: Executor,
    organizationId: string,
    dependencyId: string,
    page: { limit: number; offset: number },
  ): Promise<{ items: DependencyEvidence[]; total: number }> {
    const where = and(eq(dependencyEvidence.organizationId, organizationId), eq(dependencyEvidence.dependencyId, dependencyId));
    const [rows, totals] = await Promise.all([
      tx.select().from(dependencyEvidence).where(where).orderBy(desc(dependencyEvidence.observedAt), desc(dependencyEvidence.id)).limit(page.limit).offset(page.offset),
      tx.select({ n: count() }).from(dependencyEvidence).where(where),
    ]);
    return {
      items: rows.map((r) => ({
        ...r,
        sourceType: r.sourceType as EvidenceSourceType,
        evidenceKind: r.evidenceKind as EvidenceKind,
      })),
      total: totals[0]?.n ?? 0,
    };
  }

  /**
   * Moves last_verified_at forward (never backward) WITHOUT creating a version:
   * a fresh observation of an unchanged relationship is not a change to it.
   * The observation itself is preserved in dependency_evidence.
   */
  async touchVerified(tx: Executor, organizationId: string, id: string, at: Date): Promise<void> {
    await tx
      .update(dependencies)
      .set({ lastVerifiedAt: sql`greatest(coalesce(${dependencies.lastVerifiedAt}, ${at.toISOString()}::timestamptz), ${at.toISOString()}::timestamptz)` })
      .where(and(eq(dependencies.organizationId, organizationId), eq(dependencies.id, id)));
  }

  // ----- bulk read for the future Graph Engine

  async listActive(
    tx: Executor,
    organizationId: string,
    f: { observedAfter?: Date | undefined; dependencyTypes?: DependencyType[] | undefined } = {},
  ): Promise<Dependency[]> {
    const conds: SQL[] = [eq(dependencies.organizationId, organizationId), eq(dependencies.status, "active")];
    if (f.dependencyTypes?.length) conds.push(inArray(dependencies.dependencyType, f.dependencyTypes));
    if (f.observedAfter) {
      conds.push(
        sql`greatest(coalesce(${dependencies.observedAt}, '-infinity'::timestamptz), coalesce(${dependencies.lastVerifiedAt}, '-infinity'::timestamptz)) >= ${f.observedAfter.toISOString()}::timestamptz`,
      );
    }
    const rows = await tx.select().from(dependencies).where(and(...conds)).orderBy(asc(dependencies.createdAt), asc(dependencies.id));
    return rows.map(toDependency);
  }
}
