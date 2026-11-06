import type { Category, CheckRecord, RunStatus } from "../types.js";

/** Checks that observe whether the malicious path itself is closed. Bypass resistance describes the environment, not the path, so it cannot make a run count as "something was blocked". */
const BLOCKING: ReadonlySet<Category> = new Set(["NEGATIVE_ACCESS_TEST", "PERMISSION_PERSISTENCE_TEST", "PATH_BLOCK_TEST"]);

/**
 * Turns checks into a run status. Deliberately strict:
 *  - passed: every check passed (security AND continuity).
 *  - inconclusive: nothing could be observed, or no security check exists.
 *  - failed: no check of the malicious path itself passed, and at least one failed (nothing is blocked).
 *  - partially_verified: anything in between, including healthy paths broken or
 *    some checks inconclusive. Never reported as full containment.
 */
export function aggregate(checks: readonly CheckRecord[]): { status: Exclude<RunStatus, "pending" | "running">; counts: Record<string, number> } {
  const counts = { passed: 0, failed: 0, inconclusive: 0, securityPassed: 0, securityFailed: 0, continuityFailed: 0 };
  for (const c of checks) {
    counts[c.result]++;
    if (BLOCKING.has(c.category) && c.result === "passed") counts.securityPassed++;
    if (BLOCKING.has(c.category) && c.result === "failed") counts.securityFailed++;
    if (c.purpose === "continuity" && c.result === "failed") counts.continuityFailed++;
  }
  const security = checks.filter((c) => c.purpose === "security");
  if (checks.length === 0 || security.length === 0 || counts.inconclusive === checks.length) return { status: "inconclusive", counts };
  if (counts.passed === checks.length) return { status: "passed", counts };
  if (counts.securityFailed > 0 && counts.securityPassed === 0) return { status: "failed", counts };
  return { status: "partially_verified", counts };
}

/** The incident state a run justifies. Inconclusive justifies nothing: the incident stays in verifying. */
export const incidentOutcomeFor = (s: Exclude<RunStatus, "pending" | "running">): "contained" | "partially_contained" | "containment_failed" | null =>
  s === "passed" ? "contained" : s === "partially_verified" ? "partially_contained" : s === "failed" ? "containment_failed" : null;

/** Reachability over the pinned graph with the enforced edges removed: which protected nodes can sources still reach? */
export function reachableProtected(edges: ReadonlyArray<{ id: string; sourceNodeId: string; targetNodeId: string }>, removed: ReadonlySet<string>, sources: readonly string[], protectedNodes: readonly string[]): string[] {
  const out = new Map<string, string[]>();
  for (const e of edges) if (!removed.has(e.id)) (out.get(e.sourceNodeId) ?? out.set(e.sourceNodeId, []).get(e.sourceNodeId)!).push(e.targetNodeId);
  const seen = new Set(sources);
  const queue = [...sources];
  while (queue.length) {
    for (const n of out.get(queue.shift()!) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return protectedNodes.filter((p) => seen.has(p)).sort();
}
