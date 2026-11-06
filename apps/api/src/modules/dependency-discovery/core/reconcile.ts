import { isDeepStrictEqual } from "node:util";
import { AUTO_ACCEPT_THRESHOLD, type ReconciliationOutcome } from "../types.js";

export interface ExistingDependency {
  id: string;
  status: "active" | "inactive";
  relationship: string;
  metadata: Record<string, unknown>;
  provenanceSource: string;
}

export interface Proposal {
  relationship: string;
  metadata: Record<string, unknown>;
  confidence: number;
}

export interface Classification {
  outcome: ReconciliationOutcome;
  /** Whether it may be submitted to the registry without a human. */
  autoApply: boolean;
  reason: string;
}

/** Only keys the source stated are compared, so a source that is silent about a key never overwrites it. */
export const metadataDiffers = (existing: Record<string, unknown>, observed: Record<string, unknown>): boolean =>
  Object.entries(observed).some(([k, v]) => !isDeepStrictEqual(existing[k], v));

/**
 * Compares one proposal with the registry's current state. Pure.
 *
 *   new         nothing matches                          auto if confidence >= 0.8
 *   unchanged   matches an active dependency             auto (only appends evidence)
 *   modified    metadata differs from a discovered       auto if confidence >= 0.8
 *               dependency
 *   conflicting existing is inactive (a human removed    never auto: review required
 *               it) or differs from a MANUAL one
 *
 * The relationship LABEL is descriptive and is NOT compared: different sources name the same
 * dependency differently ("invokes", "triggers"), and comparing labels would make the registry
 * flip between them on every run. Only the keys a source states in `metadata` count as a difference.
 */
export function classify(existing: ExistingDependency | null, p: Proposal): Classification {
  if (!existing) {
    return { outcome: "new", autoApply: p.confidence >= AUTO_ACCEPT_THRESHOLD, reason: p.confidence >= AUTO_ACCEPT_THRESHOLD ? "No matching dependency" : `Confidence ${p.confidence} is below ${AUTO_ACCEPT_THRESHOLD}: review required` };
  }
  if (existing.status === "inactive") {
    return { outcome: "conflicting", autoApply: false, reason: "The dependency exists but is inactive; reactivating it needs a human decision" };
  }
  const differs = metadataDiffers(existing.metadata, p.metadata);
  if (!differs) return { outcome: "unchanged", autoApply: true, reason: "Matches the registered dependency; only evidence is appended" };
  if (existing.provenanceSource === "manual") {
    return { outcome: "conflicting", autoApply: false, reason: "Differs from a manually registered dependency; a human must decide which is right" };
  }
  return { outcome: "modified", autoApply: p.confidence >= AUTO_ACCEPT_THRESHOLD, reason: p.confidence >= AUTO_ACCEPT_THRESHOLD ? "Differs from the registered dependency" : `Confidence ${p.confidence} is below ${AUTO_ACCEPT_THRESHOLD}: review required` };
}

export interface KeyedProposal extends Proposal {
  key: string;
  observationId: string;
}

/** Finds proposals within one run that disagree about the same dependency (same pair and type). */
export function findIntraRunConflicts(items: readonly KeyedProposal[]): Set<string> {
  const byKey = new Map<string, KeyedProposal[]>();
  for (const i of items) (byKey.get(i.key) ?? byKey.set(i.key, []).get(i.key)!).push(i);
  const conflicting = new Set<string>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const first = group[0]!;
    // Sources disagree when they state different values for the same metadata key (for example accessLevel).
    const disagree = group.some((g) => Object.entries(g.metadata).some(([k, v]) => k in first.metadata && !isDeepStrictEqual(first.metadata[k], v)));
    if (disagree) group.forEach((g) => conflicting.add(g.observationId));
  }
  return conflicting;
}
