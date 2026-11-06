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
  | "incident:event";

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
  ]),
  viewer: new Set<Permission>(["agent:read", "dependency:read", "resource:read", "graph:read", "analysis:read", "snapshot:read", "discovery:read", "incident:read"]),
  // Internal actor (discovery, and later approval, gateway, verification): reads the inventory, writes dependencies, and may publish incident events and trusted transitions.
  system: new Set<Permission>(["agent:read", "dependency:read", "dependency:write", "resource:read", "graph:read", "analysis:read", "snapshot:read", "discovery:read", "incident:read", "incident:write", "incident:transition", "incident:event"]),
};

export function can(principal: Principal, permission: Permission): boolean {
  return GRANTS[principal.role].has(permission);
}

export function assertCan(principal: Principal, permission: Permission): void {
  if (!can(principal, permission)) throw new ForbiddenError();
}
