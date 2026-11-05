import type { Executor } from "../../../db/client.js";
import type { DependencyRepository } from "../repositories/dependency.repository.js";
import type { Dependency, DependencyAuditAction } from "../types/dependency.types.js";
import { dependencySnapshot } from "../versioning/dependency-version.service.js";

/** Writes append-only audit rows. Always call inside the same transaction as the change. */
export class DependencyAuditService {
  constructor(private readonly repo: DependencyRepository) {}

  async record(
    tx: Executor,
    action: DependencyAuditAction,
    actorId: string | null,
    before: Dependency | null,
    after: Dependency,
  ): Promise<void> {
    await this.repo.insertAudit(tx, {
      organizationId: after.organizationId,
      dependencyId: after.id,
      actorId,
      action,
      beforeState: before ? dependencySnapshot(before) : null,
      afterState: dependencySnapshot(after),
    });
  }
}
