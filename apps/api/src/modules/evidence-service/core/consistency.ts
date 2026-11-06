import { canonicalJson } from "../../../common/canonical.js";

// The sealed document is schemaless JSON by design; its shape is fixed by schemaVersion, not by the type system.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/**
 * Compares a sealed document with what the source modules hold now. The sources
 * are append-only, so everything sealed must still be there unchanged; things
 * added afterwards are fine (they belong to a later record). Lifecycle statuses
 * that legitimately move (an approval that was later invalidated, the incident's
 * own status) are not compared. Returns human-readable mismatches.
 */
export function sealedVsCurrent(sealed: Json, current: Json): string[] {
  const out: string[] = [];
  const index = <T extends Json>(xs: T[], key: string) => new Map(xs.map((x) => [x[key], x]));
  const same = (what: string, a: Json | undefined, b: Json | undefined, fields: string[]) => {
    if (!b) return out.push(`${what} is missing now`);
    for (const f of fields) if (canonicalJson(a?.[f] ?? null) !== canonicalJson(b[f] ?? null)) out.push(`${what}: ${f} differs`);
  };

  same("incident", sealed.incident, current.incident, ["id", "title", "descriptionHash", "severity", "detectionSource", "detectionReference", "createdBy", "createdAt"]);
  const histNow: Json[] = current.incident.stateHistory;
  (sealed.incident.stateHistory as Json[]).forEach((h, i) => {
    if (canonicalJson(h) !== canonicalJson(histNow[i] ?? null)) out.push(`state history entry ${i + 1} differs`);
  });

  for (const [section, key, fields] of [
    ["analysis", "referenceId", ["kind", "version", "snapshotId", "snapshotHash", "resultHash", "planHash", "planStatus"]],
    ["approvals", "approvalId", ["planHash", "approvalDigest", "planReferenceId", "requestedBy", "createdAt"]],
    ["enforcement", "actionId", ["kind", "planHash", "edgeId", "agentId", "resourceId", "approvalBasis", "requestedBy"]],
    ["verification", "runId", ["planHash", "snapshotHash", "resultHash", "attempt", "approvalId"]],
  ] as const) {
    const now = index(current[section] as Json[], key);
    for (const s of sealed[section] as Json[]) same(`${section} ${s[key]}`, s, now.get(s[key]), [...fields]);
  }
  // Append-only decisions of each sealed approval must all still be there, unchanged.
  const approvalsNow = index(current.approvals as Json[], "approvalId");
  for (const a of sealed.approvals as Json[]) {
    const decisionsNow: Json[] = approvalsNow.get(a.approvalId)?.decisions ?? [];
    (a.decisions as Json[]).forEach((d, i) => {
      if (canonicalJson(d) !== canonicalJson(decisionsNow[i] ?? null)) out.push(`approval ${a.approvalId}: decision ${i + 1} differs`);
    });
  }
  // Enforcement history is append-only: the sealed part must be unchanged, and each action's status must agree with its own latest history entry.
  const actionsNow = index(current.enforcement as Json[], "actionId");
  for (const a of sealed.enforcement as Json[]) {
    const now = actionsNow.get(a.actionId);
    if (!now) continue;
    (a.history as Json[]).forEach((h, i) => {
      if (canonicalJson(h) !== canonicalJson((now.history as Json[])[i] ?? null)) out.push(`enforcement ${a.actionId}: history entry ${i + 1} differs`);
    });
  }
  for (const a of current.enforcement as Json[]) {
    const last = (a.history as Json[]).at(-1);
    if (last && last.status !== a.status) out.push(`enforcement ${a.actionId}: status ${a.status} does not match its recorded history (${last.status})`);
  }
  for (const section of ["agents", "resources"] as const) {
    const now = current[section] as Json[];
    (sealed[section] as Json[]).forEach((x, i) => {
      if (canonicalJson(x) !== canonicalJson(now[i] ?? null)) out.push(`${section} association ${i + 1} differs`);
    });
  }
  return out;
}
