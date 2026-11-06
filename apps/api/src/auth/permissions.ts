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
  | "discovery:review";

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
  ]),
  viewer: new Set<Permission>(["agent:read", "dependency:read", "resource:read", "graph:read", "analysis:read", "snapshot:read", "discovery:read"]),
  // Internal discovery actor: reads the inventory and writes dependencies only.
  system: new Set<Permission>(["agent:read", "dependency:read", "dependency:write", "resource:read", "graph:read", "analysis:read", "snapshot:read", "discovery:read"]),
};

export function can(principal: Principal, permission: Permission): boolean {
  return GRANTS[principal.role].has(permission);
}

export function assertCan(principal: Principal, permission: Permission): void {
  if (!can(principal, permission)) throw new ForbiddenError();
}
