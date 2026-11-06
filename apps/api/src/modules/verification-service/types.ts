export const CATEGORIES = ["NEGATIVE_ACCESS_TEST", "POSITIVE_ACCESS_TEST", "PERMISSION_PERSISTENCE_TEST", "PATH_BLOCK_TEST", "RESOURCE_HEALTH_TEST", "BYPASS_RESISTANCE_TEST"] as const;
export type Category = (typeof CATEGORIES)[number];
export type CheckResult = "passed" | "failed" | "inconclusive";
export type RunStatus = "pending" | "running" | "passed" | "failed" | "partially_verified" | "inconclusive";

export interface CheckRecord {
  category: Category;
  /** security: is the malicious path closed? continuity: does healthy work still happen? */
  purpose: "security" | "continuity";
  agentId: string | null;
  resourceId: string | null;
  action: string | null;
  expected: "deny" | "allow" | "blocked" | "intact" | "reachable" | "gateway_only";
  actual: string;
  result: CheckResult;
  detail: Record<string, unknown>;
  executionReference: string | null;
  limitation: string | null;
}

export const MAX_ATTEMPTS = 3;

export interface RequestMeta {
  correlationId?: string | undefined;
}
