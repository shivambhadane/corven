import type { DependencyRegistryWriter } from "../../dependency-registry/services/dependency-writer.service.js";
import type { EvidenceInput } from "../../dependency-registry/types/dependency.types.js";
import type { ObservationRow } from "../repositories/discovery.repository.js";
import { type ExistingDependency } from "../core/reconcile.js";
import { SOURCE_REF_PREFIX, type NormalizedObservation, type ResolvedObservation } from "../types.js";

export interface RegistryResult {
  registryOutcome: "created" | "updated" | "unchanged" | "rejected";
  dependencyId?: string | undefined;
  reasonCode?: string | undefined;
  reason?: string | undefined;
}

/**
 * Submits ONE observation through the Dependency Registry's service boundary.
 * Discovery never writes dependency tables itself.
 */
export async function submitObservation(
  writer: DependencyRegistryWriter,
  organizationId: string,
  obs: Pick<ObservationRow, "id" | "sourceId" | "sourceReference" | "runId" | "observedAt" | "normalized" | "resolved">,
  opts: { approvedByReview?: boolean } = {},
): Promise<RegistryResult> {
  const n = obs.normalized as NormalizedObservation;
  const r = obs.resolved as ResolvedObservation;
  const match = { sourceType: r.source.type, sourceId: r.source.id, targetType: r.target.type, targetId: r.target.id, dependencyType: n.dependencyType } as const;

  // Merge only the keys the source stated into what the registry already has, so silence never wipes data.
  // The existing label is kept: it is descriptive, and sources name the same dependency differently.
  const existing = await writer.findMatching(organizationId, match);
  let metadata: Record<string, unknown> | undefined;
  if (Object.keys(n.metadata).length > 0) metadata = { ...(existing?.metadata ?? {}), ...n.metadata };

  const evidence: EvidenceInput = {
    sourceType: n.evidenceSourceType,
    sourceReference: `${SOURCE_REF_PREFIX(obs.sourceId)}${obs.sourceReference}`.slice(0, 500),
    discoveryRunId: obs.runId,
    evidenceKind: n.evidenceKind,
    ...(n.evidence.reference ? { evidenceReference: n.evidence.reference.slice(0, 500) } : {}),
    confidence: r.confidence,
    observedAt: obs.observedAt,
  };

  const res = await writer.createOrUpdate({
    organizationId, ...match, relationship: existing?.relationship ?? n.relationship, metadata, evidence: [evidence],
    approvedByReview: opts.approvedByReview ?? false,
  });
  return { registryOutcome: res.outcome, dependencyId: res.dependencyId, reasonCode: res.reasonCode, reason: res.reason };
}

export const toExisting = (d: { id: string; status: "active" | "inactive"; relationship: string; metadata: Record<string, unknown>; provenance: { source: string } }): ExistingDependency => ({
  id: d.id, status: d.status, relationship: d.relationship, metadata: d.metadata, provenanceSource: d.provenance.source,
});
