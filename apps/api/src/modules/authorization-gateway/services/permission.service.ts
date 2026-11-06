import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { ValidationError } from "../../../errors.js";
import { alreadyRevoked, notFound, permissionExists } from "../errors.js";
import type { GatewayRepository } from "../repositories/gateway.repository.js";
import type { EnforcementMode, Permission, PermissionConstraints, RequestMeta } from "../types.js";
import type { AgentLookup } from "./agent-auth.service.js";

export interface ResourceLookup {
  /** By id. */
  getResource(organizationId: string, resourceId: string): Promise<{ id: string; resourceType: string; name: string } | null>;
}

const ACTION = /^[A-Za-z0-9_.:-]{1,64}$/;
const actorType = (p: Principal) => (p.role === "system" ? "system" : "human") as "human" | "system";

/** Grants and revocations of agent permissions, and the declaration of how each resource is protected. */
export class PermissionService {
  constructor(
    private readonly db: Database,
    private readonly repo: GatewayRepository,
    private readonly agents: AgentLookup,
    private readonly resources: ResourceLookup,
  ) {}

  async grant(p: Principal, input: { agentId: string; resourceId: string; action: string; constraints?: PermissionConstraints | undefined }, meta: RequestMeta = {}): Promise<Permission> {
    assertCan(p, "permission:write");
    if (!ACTION.test(input.action)) throw new ValidationError("action must be 1-64 characters from A-Z a-z 0-9 _ . : -");
    const c = input.constraints ?? {};
    if (c.expiresAt && !(new Date(c.expiresAt).getTime() > Date.now())) throw new ValidationError("constraints.expiresAt must be in the future");
    if (!(await this.agents.getAgent(p.organizationId, input.agentId))) throw notFound("Agent", "AGENT_NOT_FOUND");
    if (!(await this.resources.getResource(p.organizationId, input.resourceId))) throw notFound("Resource", "RESOURCE_NOT_FOUND");
    return this.db.transaction(async (tx) => {
      const row = await this.repo.insertPermission(tx, { organizationId: p.organizationId, agentId: input.agentId, resourceId: input.resourceId, action: input.action, constraints: c as never, grantedBy: p.actorId });
      if (!row) throw permissionExists();
      await this.repo.addAudit(tx, { organizationId: p.organizationId, actorId: p.actorId, actorType: actorType(p), action: "permission.granted", targetType: "permission", targetId: row.id, afterState: { agentId: row.agentId, resourceId: row.resourceId, action: row.action, constraints: row.constraints }, correlationId: meta.correlationId ?? null });
      return row;
    });
  }

  async revoke(p: Principal, id: string, reason: string, meta: RequestMeta = {}): Promise<Permission> {
    assertCan(p, "permission:write");
    if (!reason.trim()) throw new ValidationError("A reason is required");
    return this.db.transaction(async (tx) => {
      const cur = await this.repo.lockPermission(tx, p.organizationId, id);
      if (!cur) throw notFound("Permission", "PERMISSION_NOT_FOUND");
      if (cur.status === "revoked") throw alreadyRevoked();
      const row = await this.repo.revokePermission(tx, p.organizationId, id, p.actorId, reason.trim());
      await this.repo.addAudit(tx, { organizationId: p.organizationId, actorId: p.actorId, actorType: actorType(p), action: "permission.revoked", targetType: "permission", targetId: id, beforeState: { status: "active", version: cur.version }, afterState: { status: "revoked", version: row.version, reason: reason.trim() }, correlationId: meta.correlationId ?? null });
      return row;
    });
  }

  async get(p: Principal, id: string): Promise<Permission> {
    assertCan(p, "permission:read");
    const row = await this.repo.findPermission(this.db, p.organizationId, id);
    if (!row) throw notFound("Permission", "PERMISSION_NOT_FOUND");
    return row;
  }

  async list(p: Principal, f: { agentId?: string | undefined; resourceId?: string | undefined; status?: "active" | "revoked" | undefined }, page: { limit: number; offset: number }) {
    assertCan(p, "permission:read");
    return this.repo.listPermissions(this.db, p.organizationId, f, page);
  }

  async setEnforcementMode(p: Principal, resourceId: string, mode: EnforcementMode, meta: RequestMeta = {}) {
    assertCan(p, "permission:write");
    if (!(await this.resources.getResource(p.organizationId, resourceId))) throw notFound("Resource", "RESOURCE_NOT_FOUND");
    return this.db.transaction(async (tx) => {
      const before = await this.repo.getMode(tx, p.organizationId, resourceId);
      const row = await this.repo.upsertMode(tx, p.organizationId, resourceId, mode, p.actorId);
      await this.repo.addAudit(tx, { organizationId: p.organizationId, actorId: p.actorId, actorType: actorType(p), action: "resource_enforcement.set", targetType: "resource", targetId: resourceId, beforeState: before ? { mode: before.mode } : null, afterState: { mode }, correlationId: meta.correlationId ?? null });
      return row;
    });
  }

  async listEnforcementModes(p: Principal) {
    assertCan(p, "gateway:read");
    return this.repo.listModes(this.db, p.organizationId);
  }
}
