import type { Decision, Permission, ReasonCode } from "../types.js";

/** Everything the evaluator needs, already loaded. It does no I/O, so every rule is testable on its own. */
export interface PolicyInput {
  now: Date;
  action: string;
  payload: unknown;
  agent: { status: string } | null;
  credentialActive: boolean;
  resource: { id: string } | null;
  /** Active permissions of this agent on this resource (any action). */
  permissions: readonly Permission[];
  /** An executed containment restriction blocks this agent from this resource. */
  restricted: boolean;
}

const deny = (...codes: ReasonCode[]): Decision => ({ decision: "deny", reasonCodes: codes, permissionId: null, permissionVersion: null });

/**
 * Deny by default. Every check must pass for "allow". The first failing check
 * is reported together with any others that are cheap to know, so a denial
 * explains itself. Registry capabilities and dependency edges are not inputs:
 * they are descriptive and never authorize.
 */
export function evaluate(i: PolicyInput): Decision {
  const reasons: ReasonCode[] = [];
  if (!i.agent) return deny("AGENT_NOT_FOUND");
  if (i.agent.status !== "active") reasons.push("AGENT_NOT_ACTIVE");
  if (!i.credentialActive) reasons.push("CREDENTIAL_INACTIVE");
  if (!i.resource) reasons.push("RESOURCE_UNKNOWN");
  if (reasons.length > 0) return deny(...reasons);

  if (i.restricted) return deny("RESTRICTED_BY_CONTAINMENT");

  const grants = i.permissions.filter((p) => p.status === "active" && p.action === i.action);
  if (grants.length === 0) return deny("NO_PERMISSION");

  let lastDenial: ReasonCode = "NO_PERMISSION";
  for (const g of grants) {
    const c = g.constraints;
    if (c.expiresAt && new Date(c.expiresAt).getTime() <= i.now.getTime()) {
      lastDenial = "PERMISSION_EXPIRED";
      continue;
    }
    if (c.maxAmount !== undefined) {
      const amount = (i.payload as { amount?: unknown } | null)?.amount;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount > c.maxAmount || amount < 0) {
        lastDenial = "CONSTRAINT_VIOLATED";
        continue;
      }
    }
    return { decision: "allow", reasonCodes: ["ALLOWED"], permissionId: g.id, permissionVersion: g.version };
  }
  return deny(lastDenial);
}
