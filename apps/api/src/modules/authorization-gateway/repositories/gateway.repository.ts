import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { Executor } from "../../../db/client.js";
import { schema } from "../../../db/client.js";
import type { ActionKind, EnforcementMode, EnforcementStatus, Permission } from "../types.js";

const t = schema;
const one = <R>(rows: R[]): R | null => rows[0] ?? null;

export type CredentialRow = typeof t.agentCredentials.$inferSelect;
export type DecisionRow = typeof t.gatewayDecisions.$inferSelect;
export type ExecutionRow = typeof t.executionRecords.$inferSelect;
export type ActionRow = Omit<typeof t.enforcementActions.$inferSelect, "kind" | "status"> & { kind: ActionKind; status: EnforcementStatus };
export type ActionEventRow = typeof t.enforcementActionEvents.$inferSelect;
export type HistoryRow = typeof t.credentialRotationHistory.$inferSelect;

/** All SQL for the gateway. Every method that is tenant-scoped takes the organization explicitly. */
export class GatewayRepository {
  // ---- credentials
  async insertCredential(tx: Executor, v: typeof t.agentCredentials.$inferInsert): Promise<CredentialRow> {
    return (await tx.insert(t.agentCredentials).values(v).returning())[0]!;
  }
  /** Looked up by id alone: the caller presents `cvn_<id>.<secret>` and does not yet know the organization. */
  async findCredentialById(tx: Executor, id: string): Promise<CredentialRow | null> {
    return one(await tx.select().from(t.agentCredentials).where(eq(t.agentCredentials.id, id)));
  }
  async lockActiveCredential(tx: Executor, org: string, agentId: string): Promise<CredentialRow | null> {
    return one(await tx.select().from(t.agentCredentials).where(and(eq(t.agentCredentials.organizationId, org), eq(t.agentCredentials.agentId, agentId), eq(t.agentCredentials.status, "active"))).for("update"));
  }
  async findActiveCredential(tx: Executor, org: string, agentId: string): Promise<CredentialRow | null> {
    return one(await tx.select().from(t.agentCredentials).where(and(eq(t.agentCredentials.organizationId, org), eq(t.agentCredentials.agentId, agentId), eq(t.agentCredentials.status, "active"))));
  }
  async revokeCredential(tx: Executor, org: string, id: string, by: string, reason: string): Promise<void> {
    await tx.update(t.agentCredentials).set({ status: "revoked", revokedAt: new Date(), revokedBy: by, revokeReason: reason }).where(and(eq(t.agentCredentials.organizationId, org), eq(t.agentCredentials.id, id)));
  }
  async addCredentialHistory(tx: Executor, v: typeof t.credentialRotationHistory.$inferInsert): Promise<void> {
    await tx.insert(t.credentialRotationHistory).values(v);
  }
  listCredentialHistory(tx: Executor, org: string, agentId: string): Promise<HistoryRow[]> {
    return tx.select().from(t.credentialRotationHistory).where(and(eq(t.credentialRotationHistory.organizationId, org), eq(t.credentialRotationHistory.agentId, agentId))).orderBy(asc(t.credentialRotationHistory.createdAt), asc(t.credentialRotationHistory.id));
  }

  // ---- permissions
  async insertPermission(tx: Executor, v: typeof t.permissions.$inferInsert): Promise<Permission | null> {
    return one(await tx.insert(t.permissions).values(v).onConflictDoNothing().returning()) as Permission | null;
  }
  async findPermission(tx: Executor, org: string, id: string): Promise<Permission | null> {
    return one(await tx.select().from(t.permissions).where(and(eq(t.permissions.organizationId, org), eq(t.permissions.id, id)))) as Permission | null;
  }
  async lockPermission(tx: Executor, org: string, id: string): Promise<Permission | null> {
    return one(await tx.select().from(t.permissions).where(and(eq(t.permissions.organizationId, org), eq(t.permissions.id, id))).for("update")) as Permission | null;
  }
  async listPermissions(tx: Executor, org: string, f: { agentId?: string | undefined; resourceId?: string | undefined; status?: "active" | "revoked" | undefined }, page: { limit: number; offset: number }) {
    const conds = [eq(t.permissions.organizationId, org)];
    if (f.agentId) conds.push(eq(t.permissions.agentId, f.agentId));
    if (f.resourceId) conds.push(eq(t.permissions.resourceId, f.resourceId));
    if (f.status) conds.push(eq(t.permissions.status, f.status));
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(t.permissions).where(and(...conds));
    const items = await tx.select().from(t.permissions).where(and(...conds)).orderBy(desc(t.permissions.createdAt), desc(t.permissions.id)).limit(page.limit).offset(page.offset);
    return { items: items as Permission[], total: Number(n) };
  }
  async activePermissionsFor(tx: Executor, org: string, agentId: string, resourceId: string): Promise<Permission[]> {
    return (await tx.select().from(t.permissions).where(and(eq(t.permissions.organizationId, org), eq(t.permissions.agentId, agentId), eq(t.permissions.resourceId, resourceId), eq(t.permissions.status, "active")))) as Permission[];
  }
  async revokePermission(tx: Executor, org: string, id: string, by: string, reason: string): Promise<Permission> {
    const rows = await tx.update(t.permissions).set({ status: "revoked", revokedAt: new Date(), revokedBy: by, revokeReason: reason, version: sql`${t.permissions.version} + 1` }).where(and(eq(t.permissions.organizationId, org), eq(t.permissions.id, id), eq(t.permissions.status, "active"))).returning();
    return rows[0] as Permission;
  }
  async revokePairPermissions(tx: Executor, org: string, agentId: string, resourceId: string, by: string, reason: string): Promise<Permission[]> {
    return (await tx.update(t.permissions).set({ status: "revoked", revokedAt: new Date(), revokedBy: by, revokeReason: reason, version: sql`${t.permissions.version} + 1` }).where(and(eq(t.permissions.organizationId, org), eq(t.permissions.agentId, agentId), eq(t.permissions.resourceId, resourceId), eq(t.permissions.status, "active"))).returning()) as Permission[];
  }

  // ---- resource enforcement mode
  async upsertMode(tx: Executor, org: string, resourceId: string, mode: EnforcementMode, by: string) {
    const rows = await tx.insert(t.resourceEnforcement).values({ organizationId: org, resourceId, mode, updatedBy: by }).onConflictDoUpdate({ target: [t.resourceEnforcement.organizationId, t.resourceEnforcement.resourceId], set: { mode, updatedBy: by, updatedAt: new Date() } }).returning();
    return rows[0]!;
  }
  async getMode(tx: Executor, org: string, resourceId: string) {
    return one(await tx.select().from(t.resourceEnforcement).where(and(eq(t.resourceEnforcement.organizationId, org), eq(t.resourceEnforcement.resourceId, resourceId))));
  }
  listModes(tx: Executor, org: string) {
    return tx.select().from(t.resourceEnforcement).where(eq(t.resourceEnforcement.organizationId, org));
  }

  async addAudit(tx: Executor, v: typeof t.gatewayAuditLogs.$inferInsert): Promise<void> {
    await tx.insert(t.gatewayAuditLogs).values(v);
  }

  // ---- decisions and executions
  async insertDecision(tx: Executor, v: typeof t.gatewayDecisions.$inferInsert): Promise<DecisionRow> {
    return (await tx.insert(t.gatewayDecisions).values(v).returning())[0]!;
  }
  listDecisions(tx: Executor, org: string, agentId: string, page: { limit: number; offset: number }) {
    return tx.select().from(t.gatewayDecisions).where(and(eq(t.gatewayDecisions.organizationId, org), eq(t.gatewayDecisions.agentId, agentId))).orderBy(desc(t.gatewayDecisions.createdAt), desc(t.gatewayDecisions.id)).limit(page.limit).offset(page.offset);
  }
  /** Returns null if this (agent, request id) was already claimed: the operation must not run twice. */
  async claimExecution(tx: Executor, v: typeof t.executionRecords.$inferInsert): Promise<ExecutionRow | null> {
    return one(await tx.insert(t.executionRecords).values(v).onConflictDoNothing().returning());
  }
  async findExecution(tx: Executor, org: string, agentId: string, requestId: string): Promise<ExecutionRow | null> {
    return one(await tx.select().from(t.executionRecords).where(and(eq(t.executionRecords.organizationId, org), eq(t.executionRecords.agentId, agentId), eq(t.executionRecords.requestId, requestId))));
  }
  async finalizeExecution(tx: Executor, org: string, id: string, patch: Partial<typeof t.executionRecords.$inferInsert>): Promise<ExecutionRow> {
    const rows = await tx.update(t.executionRecords).set({ ...patch, updatedAt: new Date() }).where(and(eq(t.executionRecords.organizationId, org), eq(t.executionRecords.id, id))).returning();
    return rows[0]!;
  }

  // ---- enforcement
  async insertAction(tx: Executor, v: typeof t.enforcementActions.$inferInsert): Promise<ActionRow | null> {
    return one(await tx.insert(t.enforcementActions).values(v).onConflictDoNothing().returning()) as ActionRow | null;
  }
  async findAction(tx: Executor, org: string, id: string): Promise<ActionRow | null> {
    return one(await tx.select().from(t.enforcementActions).where(and(eq(t.enforcementActions.organizationId, org), eq(t.enforcementActions.id, id)))) as ActionRow | null;
  }
  async lockAction(tx: Executor, org: string, id: string): Promise<ActionRow | null> {
    return one(await tx.select().from(t.enforcementActions).where(and(eq(t.enforcementActions.organizationId, org), eq(t.enforcementActions.id, id))).for("update")) as ActionRow | null;
  }
  async findActionByKey(tx: Executor, org: string, key: string): Promise<ActionRow | null> {
    return one(await tx.select().from(t.enforcementActions).where(and(eq(t.enforcementActions.organizationId, org), eq(t.enforcementActions.idempotencyKey, key)))) as ActionRow | null;
  }
  async updateAction(tx: Executor, org: string, id: string, patch: Partial<typeof t.enforcementActions.$inferInsert>): Promise<ActionRow> {
    const rows = await tx.update(t.enforcementActions).set({ ...patch, updatedAt: new Date() }).where(and(eq(t.enforcementActions.organizationId, org), eq(t.enforcementActions.id, id))).returning();
    return rows[0] as ActionRow;
  }
  async listActions(tx: Executor, org: string, f: { incidentId?: string | undefined; agentId?: string | undefined }, page: { limit: number; offset: number }) {
    const conds = [eq(t.enforcementActions.organizationId, org)];
    if (f.incidentId) conds.push(eq(t.enforcementActions.incidentId, f.incidentId));
    if (f.agentId) conds.push(eq(t.enforcementActions.agentId, f.agentId));
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(t.enforcementActions).where(and(...conds));
    const items = await tx.select().from(t.enforcementActions).where(and(...conds)).orderBy(desc(t.enforcementActions.createdAt), desc(t.enforcementActions.id)).limit(page.limit).offset(page.offset);
    return { items: items as ActionRow[], total: Number(n) };
  }
  async addActionEvent(tx: Executor, v: typeof t.enforcementActionEvents.$inferInsert): Promise<void> {
    await tx.insert(t.enforcementActionEvents).values(v);
  }
  listActionEvents(tx: Executor, org: string, actionId: string): Promise<ActionEventRow[]> {
    return tx.select().from(t.enforcementActionEvents).where(and(eq(t.enforcementActionEvents.organizationId, org), eq(t.enforcementActionEvents.actionId, actionId))).orderBy(asc(t.enforcementActionEvents.seq));
  }
  /** An executed revoke_resource_access action that has not been rolled back is an active restriction. */
  async hasRestriction(tx: Executor, org: string, agentId: string, resourceId: string): Promise<boolean> {
    const rows = await tx.select({ id: t.enforcementActions.id }).from(t.enforcementActions).where(and(eq(t.enforcementActions.organizationId, org), eq(t.enforcementActions.agentId, agentId), eq(t.enforcementActions.resourceId, resourceId), eq(t.enforcementActions.kind, "revoke_resource_access"), eq(t.enforcementActions.status, "executed"))).limit(1);
    return rows.length > 0;
  }
}
