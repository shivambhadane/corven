import { ForbiddenError } from "../errors.js";
import type { Principal, Role } from "./principal.js";

export type Permission =
  | "agent:read"
  | "agent:write"
  | "agent:status"
  | "agent:recover"
  | "agent:identity:verify"
  | "dependency:read"
  | "dependency:write"
  | "resource:read"
  | "resource:write"
  | "graph:read"
  | "analysis:read"
  | "snapshot:read"
  | "snapshot:write"
  | "discovery:read"
  | "discovery:write"
  | "discovery:run"
  | "discovery:ingest"
  | "discovery:review"
  | "incident:read"
  | "incident:write"
  | "incident:transition"
  | "incident:recover"
  | "incident:event"
  | "gateway:read"
  | "permission:read"
  | "permission:write"
  | "credential:manage"
  | "enforcement:read"
  | "enforcement:apply"
  | "approval:read"
  | "approval:request"
  | "approval:decide"
  | "approval:policy"
  | "verification:read"
  | "verification:run";

const GRANTS: Record<Role | "system", ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    "agent:read",
    "agent:write",
    "agent:status",
    "agent:recover",
    "agent:identity:verify",
    "dependency:read",
    "dependency:write",
    "resource:read",
    "resource:write",
    "graph:read",
    "analysis:read",
    "snapshot:read",
    "snapshot:write",
    "discovery:read",
    "discovery:write",
    "discovery:run",
    "discovery:ingest",
    "discovery:review",
    "incident:read",
    "incident:write",
    "incident:transition",
    "incident:recover",
    "gateway:read",
    "permission:read",
    "permission:write",
    "credential:manage",
    "enforcement:read",
    "enforcement:apply",
    "approval:read",
    "approval:request",
    "approval:decide",
    "approval:policy",
    "verification:read",
    "verification:run",
  ]),
  operator: new Set<Permission>([
    "agent:read",
    "agent:write",
    "agent:status",
    "dependency:read",
    "dependency:write",
    "resource:read",
    "resource:write",
    "graph:read",
    "analysis:read",
    "snapshot:read",
    "snapshot:write",
    "discovery:read",
    "discovery:write",
    "discovery:run",
    "discovery:ingest",
    "discovery:review",
    "incident:read",
    "incident:write",
    "incident:transition",
    "gateway:read",
    "permission:read",
    "enforcement:read",
    "approval:read",
    "approval:request",
    "verification:read",
    "verification:run",
  ]),
  viewer: new Set<Permission>(["agent:read", "dependency:read", "resource:read", "graph:read", "analysis:read", "snapshot:read", "discovery:read", "incident:read", "gateway:read", "permission:read", "enforcement:read", "approval:read", "verification:read"]),
  // A person who may approve or reject containment plans. Approving is all they can change.
  approver: new Set<Permission>(["agent:read", "dependency:read", "resource:read", "graph:read", "analysis:read", "snapshot:read", "discovery:read", "incident:read", "gateway:read", "permission:read", "enforcement:read", "approval:read", "approval:decide", "verification:read"]),
  // Internal actor (discovery, and later approval, gateway, verification): reads the inventory, writes dependencies, and may publish incident events and trusted transitions.
  system: new Set<Permission>(["agent:read", "dependency:read", "dependency:write", "resource:read", "graph:read", "analysis:read", "snapshot:read", "discovery:read", "incident:read", "incident:write", "incident:transition", "incident:event", "gateway:read", "permission:read", "enforcement:read", "enforcement:apply", "approval:read", "verification:read", "verification:run"]),
};

export function can(principal: Principal, permission: Permission): boolean {
  return GRANTS[principal.role].has(permission);
}

export function assertCan(principal: Principal, permission: Permission): void {
  if (!can(principal, permission)) throw new ForbiddenError();
}
