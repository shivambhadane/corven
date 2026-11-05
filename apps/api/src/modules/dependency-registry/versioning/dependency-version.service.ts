import type { Executor } from "../../../db/client.js";
import type { DependencyRepository } from "../repositories/dependency.repository.js";
import type { ChangeType, Dependency } from "../types/dependency.types.js";

/** Plain-JSON snapshot of a dependency. Used for version rows and audit before/after state. */
export const dependencySnapshot = (d: Dependency) => ({
  id: d.id,
  sourceType: d.sourceType,
  sourceId: d.sourceId,
  targetType: d.targetType,
  targetId: d.targetId,
  dependencyType: d.dependencyType,
  relationship: d.relationship,
  metadata: d.metadata,
  provenance: d.provenance,
  confidence: d.confidence,
  observedAt: d.observedAt ? d.observedAt.toISOString() : null,
  lastVerifiedAt: d.lastVerifiedAt ? d.lastVerifiedAt.toISOString() : null,
  status: d.status,
  version: d.version,
});

/** Appends one immutable version row per recorded change (the database rejects updates and deletes). */
export class DependencyVersionService {
  constructor(private readonly repo: DependencyRepository) {}

  async record(tx: Executor, dependency: Dependency, changeType: ChangeType, actorId: string | null): Promise<void> {
    await this.repo.insertVersion(tx, {
      organizationId: dependency.organizationId,
      dependencyId: dependency.id,
      version: dependency.version,
      changeType,
      changedBy: actorId,
      state: dependencySnapshot(dependency),
    });
  }
}
