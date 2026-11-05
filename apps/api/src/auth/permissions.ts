import { ForbiddenError } from "../errors.js";
import type { Principal, Role } from "./principal.js";

export type Permission =
  | "agent:read"
  | "agent:write"
  | "agent:status"
  | "agent:recover"
  | "agent:identity:verify";

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    "agent:read",
    "agent:write",
    "agent:status",
    "agent:recover",
    "agent:identity:verify",
  ]),
  operator: new Set<Permission>(["agent:read", "agent:write", "agent:status"]),
  viewer: new Set<Permission>(["agent:read"]),
};

export function can(principal: Principal, permission: Permission): boolean {
  return GRANTS[principal.role].has(permission);
}

export function assertCan(principal: Principal, permission: Permission): void {
  if (!can(principal, permission)) throw new ForbiddenError();
}
