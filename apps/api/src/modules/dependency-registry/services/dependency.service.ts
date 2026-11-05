import { isDeepStrictEqual } from "node:util";
import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Database } from "../../../db/client.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../errors.js";
import { assertSafeMetadata } from "../../agent-registry/policies/agent-input.policy.js";
import type { AgentRepository } from "../../agent-registry/repositories/agent.repository.js";
import { pgError } from "../../agent-registry/services/shared.js";
import type { DependencyAuditService } from "../audit/dependency-audit.service.js";
import { assertFreshness, assertRequiredMetadata, forbidsCycles } from "../policies/relationship.policy.js";
import type { DependencyFilters, DependencyPatch, DependencyRepository } from "../repositories/dependency.repository.js";
import type {
  ChangeType,
  Dependency,
  DependencyAuditAction,
  DependencyEvidence,
  DependencyStatus,
  DependencyVersion,
  Provenance,
} from "../types/dependency.types.js";
import {
  normalizeProvenance,
  normalizeRelationship,
  parseDate,
  type RawNewDependency,
  type RelationshipValidator,
} from "../validators/relationship.validator.js";
import type { DependencyVersionService } from "../versioning/dependency-version.service.js";

export interface UpdateDependencyInput {
  /** Optimistic concurrency: reject if the stored version differs. */
  expectedVersion?: number | undefined;
  relationship?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  provenance?: Provenance | undefined;
  confidence?: number | undefined;
  observedAt?: string | null | undefined;
  lastVerifiedAt?: string | null | undefined;
  status?: DependencyStatus | undefined;
}

export class DependencyService {
  constructor(
    private readonly db: Database,
    private readonly deps: DependencyRepository,
    private readonly agents: AgentRepository,
    private readonly validator: RelationshipValidator,
    private readonly versions: DependencyVersionService,
    private readonly audit: DependencyAuditService,
  ) {}

  async create(principal: Principal, input: RawNewDependency): Promise<Dependency> {
    assertCan(principal, "dependency:write");
    const n = this.validator.normalizeNew(input);
    const org = principal.organizationId;

    try {
      return await this.db.transaction(async (tx) => {
        if (forbidsCycles(n.dependencyType)) await this.deps.lockAuthorityEdges(tx, org);

        await this.validator.assertEndpointsExist(tx, org, { type: n.sourceType, id: n.sourceId }, { type: n.targetType, id: n.targetId });

        const existing = await this.deps.findByPair(tx, org, n);
        if (existing) {
          throw new ConflictError(
            existing.status === "inactive"
              ? "This dependency already exists but is inactive; reactivate it with PATCH status=active"
              : "This dependency already exists",
            "DEPENDENCY_EXISTS",
          );
        }
        if (forbidsCycles(n.dependencyType)) await this.validator.assertNoAuthorityCycle(tx, org, n.sourceId, n.targetId);

        const created = await this.deps.insert(tx, { organizationId: org, ...n });
        await this.versions.record(tx, created, "created", principal.actorId);
        await this.audit.record(tx, "dependency.created", principal.actorId, null, created);
        return created;
      });
    } catch (err) {
      return this.mapUnique(err);
    }
  }

  async get(principal: Principal, id: string): Promise<Dependency> {
    assertCan(principal, "dependency:read");
    const dep = await this.deps.find(this.db, principal.organizationId, id);
    if (!dep) throw new NotFoundError("Dependency not found");
    return dep;
  }

  async list(principal: Principal, filters: DependencyFilters): Promise<{ items: Dependency[]; total: number }> {
    assertCan(principal, "dependency:read");
    return this.deps.list(this.db, principal.organizationId, filters);
  }

  async listForAgent(principal: Principal, agentId: string, filters: DependencyFilters): Promise<{ items: Dependency[]; total: number }> {
    assertCan(principal, "dependency:read");
    const org = principal.organizationId;
    return this.db.transaction(async (tx) => {
      if (!(await this.agents.findAgent(tx, org, agentId))) throw new NotFoundError("Agent not found");
      return this.deps.list(tx, org, filters);
    });
  }

  async listVersions(principal: Principal, id: string, page: { limit: number; offset: number }): Promise<{ items: DependencyVersion[]; total: number }> {
    assertCan(principal, "dependency:read");
    const org = principal.organizationId;
    return this.db.transaction(async (tx) => {
      if (!(await this.deps.find(tx, org, id))) throw new NotFoundError("Dependency not found");
      return this.deps.listVersions(tx, org, id, page);
    });
  }

  async listEvidence(principal: Principal, id: string, page: { limit: number; offset: number }): Promise<{ items: DependencyEvidence[]; total: number }> {
    assertCan(principal, "dependency:read");
    const org = principal.organizationId;
    return this.db.transaction(async (tx) => {
      if (!(await this.deps.find(tx, org, id))) throw new NotFoundError("Dependency not found");
      return this.deps.listEvidence(tx, org, id, page);
    });
  }

  /**
   * Source, target and dependencyType are immutable. A no-op update (nothing
   * actually differs) returns the current record and does NOT create a version.
   */
  async update(principal: Principal, id: string, input: UpdateDependencyInput): Promise<Dependency> {
    assertCan(principal, "dependency:write");
    const org = principal.organizationId;
    const { expectedVersion, ...changes } = input;
    if (Object.values(changes).every((v) => v === undefined)) {
      throw new ValidationError("No changes supplied");
    }

    return this.db.transaction(async (tx) => {
      const current = await this.deps.find(tx, org, id, { forUpdate: true });
      if (!current) throw new NotFoundError("Dependency not found");
      if (expectedVersion !== undefined && expectedVersion !== current.version) {
        throw new ConflictError(`Dependency is at version ${current.version}, not ${expectedVersion}`, "VERSION_CONFLICT");
      }

      const next = {
        relationship: changes.relationship !== undefined ? normalizeRelationship(changes.relationship) : current.relationship,
        metadata: changes.metadata !== undefined ? assertSafeMetadata(changes.metadata) : current.metadata,
        provenance: changes.provenance !== undefined ? normalizeProvenance(changes.provenance) : current.provenance,
        confidence: changes.confidence !== undefined ? changes.confidence : current.confidence,
        observedAt: changes.observedAt !== undefined ? parseDate(changes.observedAt) : current.observedAt,
        lastVerifiedAt: changes.lastVerifiedAt !== undefined ? parseDate(changes.lastVerifiedAt) : current.lastVerifiedAt,
        status: changes.status ?? current.status,
      };
      assertRequiredMetadata(current.dependencyType, next.metadata);
      assertFreshness(next.observedAt, next.lastVerifiedAt);

      const patch: DependencyPatch = {};
      if (next.relationship !== current.relationship) patch.relationship = next.relationship;
      if (!isDeepStrictEqual(next.metadata, current.metadata)) patch.metadata = next.metadata;
      if (!isDeepStrictEqual(next.provenance, current.provenance)) patch.provenance = next.provenance;
      if (next.confidence !== current.confidence) patch.confidence = next.confidence;
      if (next.observedAt?.getTime() !== current.observedAt?.getTime()) patch.observedAt = next.observedAt;
      if (next.lastVerifiedAt?.getTime() !== current.lastVerifiedAt?.getTime()) patch.lastVerifiedAt = next.lastVerifiedAt;
      if (next.status !== current.status) patch.status = next.status;
      if (Object.keys(patch).length === 0) return current;

      const reactivating = patch.status === "active";
      if (reactivating && forbidsCycles(current.dependencyType)) {
        await this.deps.lockAuthorityEdges(tx, org);
        await this.validator.assertNoAuthorityCycle(tx, org, current.sourceId, current.targetId);
      }

      const updated = await this.deps.update(tx, org, id, patch);
      let change: ChangeType = "updated";
      let action: DependencyAuditAction = "dependency.updated";
      if (patch.status === "inactive") [change, action] = ["deactivated", "dependency.deactivated"];
      else if (reactivating) [change, action] = ["activated", "dependency.activated"];

      await this.versions.record(tx, updated, change, principal.actorId);
      await this.audit.record(tx, action, principal.actorId, current, updated);
      return updated;
    });
  }

  /**
   * DELETE semantics: a soft removal. The row, its versions and its audit
   * history are kept; status becomes `inactive` and the event is recorded as
   * `removed`. It can be restored with PATCH status=active (recorded as `activated`).
   */
  async remove(principal: Principal, id: string, expectedVersion?: number, reason?: string): Promise<Dependency> {
    assertCan(principal, "dependency:write");
    const org = principal.organizationId;
    return this.db.transaction(async (tx) => {
      const current = await this.deps.find(tx, org, id, { forUpdate: true });
      if (!current) throw new NotFoundError("Dependency not found");
      if (expectedVersion !== undefined && expectedVersion !== current.version) {
        throw new ConflictError(`Dependency is at version ${current.version}, not ${expectedVersion}`, "VERSION_CONFLICT");
      }
      if (current.status === "inactive") throw new ConflictError("Dependency is already inactive", "ALREADY_INACTIVE");

      const removed = await this.deps.update(tx, org, id, { status: "inactive" });
      await this.versions.record(tx, removed, "removed", principal.actorId);
      await this.audit.record(tx, "dependency.removed", principal.actorId, current, removed, reason);
      return removed;
    });
  }

  private mapUnique(err: unknown): never {
    const { code, constraint } = pgError(err);
    if (code === "23505" && constraint === "dependencies_pair_unique") {
      throw new ConflictError("This dependency already exists", "DEPENDENCY_EXISTS");
    }
    throw err;
  }
}
