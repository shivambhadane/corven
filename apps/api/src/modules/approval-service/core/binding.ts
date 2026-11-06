import { canonicalHash } from "../../../common/canonical.js";
import { APPROVAL_SCHEMA_VERSION, DEFAULT_POLICY, type ApprovalPolicy, type Risk } from "../types.js";

export interface Binding {
  schemaVersion: number;
  organizationId: string;
  incidentId: string;
  planReferenceId: string;
  planVersion: number;
  planHash: string;
  snapshotHash: string;
  resultHash: string;
}

/**
 * The approval digest: SHA-256 over the canonical JSON (sorted keys, no
 * whitespace, see common/canonical.ts) of everything that identifies the exact
 * plan a person reviewed. It covers the engine's own plan hash AND the pinned
 * snapshot hash and full-result hash, so a plan recomputed on a different graph
 * or with different inputs cannot match even if the action list were identical.
 */
export const approvalDigest = (b: Omit<Binding, "schemaVersion">): string => canonicalHash({ ...b, schemaVersion: APPROVAL_SCHEMA_VERSION });

/** Elevated when the Containment Engine itself asked for approval (healthy agents affected, uncertain edges, cost, high-value targets). */
export function assessRisk(summary: Record<string, unknown>): { risk: Risk; reasons: string[] } {
  const reasons = Array.isArray(summary.approvalReasons) ? (summary.approvalReasons as unknown[]).filter((r): r is string => typeof r === "string") : [];
  return { risk: summary.approvalRequired === true || reasons.length > 0 ? "elevated" : "standard", reasons };
}

export const requiredFor = (policy: ApprovalPolicy, risk: Risk): number => (risk === "elevated" ? policy.elevatedRequiredApprovals : policy.requiredApprovals);

export function validatePolicy(p: ApprovalPolicy): string | null {
  const int = (n: number) => Number.isInteger(n);
  if (![p.requiredApprovals, p.elevatedRequiredApprovals, p.expiryMinutes, p.executionWindowMinutes].every(int)) return "all counts and durations must be integers";
  if (p.requiredApprovals < 1 || p.requiredApprovals > 5) return "requiredApprovals must be between 1 and 5";
  if (p.elevatedRequiredApprovals < p.requiredApprovals || p.elevatedRequiredApprovals > 5) return "elevatedRequiredApprovals must be between requiredApprovals and 5";
  if (p.expiryMinutes < 5 || p.expiryMinutes > 10080) return "expiryMinutes must be between 5 and 10080";
  if (p.executionWindowMinutes < 5 || p.executionWindowMinutes > 1440) return "executionWindowMinutes must be between 5 and 1440";
  return null;
}

export { DEFAULT_POLICY };
