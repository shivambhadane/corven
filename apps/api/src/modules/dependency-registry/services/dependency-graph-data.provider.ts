import type { Database } from "../../../db/client.js";
import type { DependencyRepository } from "../repositories/dependency.repository.js";
import type { Dependency, DependencyType } from "../types/dependency.types.js";

/**
 * Stable read interface for the future Graph Engine. Read-only and
 * organization-explicit (internal caller).
 *
 * `observedAfter` filters on freshness = the later of observed_at and
 * last_verified_at; edges with neither are excluded when the filter is used.
 * Only ACTIVE dependencies are returned. Confidence is returned as stored;
 * evidence is available separately from the evidence endpoint.
 */
export class DependencyGraphDataProvider {
  constructor(
    private readonly db: Database,
    private readonly repo: DependencyRepository,
  ) {}

  listActiveDependencies(
    organizationId: string,
    filters: { observedAfter?: Date | undefined; dependencyTypes?: DependencyType[] | undefined } = {},
  ): Promise<Dependency[]> {
    return this.repo.listActive(this.db, organizationId, filters);
  }

  getDependency(organizationId: string, dependencyId: string): Promise<Dependency | null> {
    return this.repo.find(this.db, organizationId, dependencyId);
  }
}
