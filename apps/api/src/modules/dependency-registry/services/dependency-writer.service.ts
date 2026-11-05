import { isDeepStrictEqual } from "node:util";
import { systemPrincipal } from "../../../auth/system.js";
import type { Database } from "../../../db/client.js";
import { AppError, UnprocessableError, ValidationError } from "../../../errors.js";
import { pgError } from "../../agent-registry/services/shared.js";
import type { DependencyAuditService } from "../audit/dependency-audit.service.js";
import { forbidsCycles } from "../policies/relationship.policy.js";
import type { DependencyRepository } from "../repositories/dependency.repository.js";
import type {
  Dependency,
  DependencyType,
  EntityType,
  EvidenceInput,
  EvidenceSourceType,
  ProvenanceSource,
} from "../types/dependency.types.js";
import type { NormalizedNewDependency, RelationshipValidator } from "../validators/relationship.validator.js";
import type { DependencyVersionService } from "../versioning/dependency-version.service.js";
import type { DependencyService } from "./dependency.service.js";

/** Input for the internal writer used by Dependency Discovery. */
export interface CreateDependencyInput {
  organizationId: string;
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  dependencyType: DependencyType;
  relationship: string;
  metadata?: Record<string, unknown> | undefined;
  /** At least one. Each item carries its own confidence; the dependency keeps the highest. */
  evidence: EvidenceInput[];
  /** True only when a human reviewer approved this relationship (unlocks authority edges). */
  approvedByReview?: boolean | undefined;
}

export interface UpsertDependencyResult {
  dependencyId?: string;
  outcome: "created" | "updated" | "unchanged" | "rejected";
  version?: number;
  reasonCode?: string;
  reason?: string;
  evidenceAdded: number;
}

export interface DependencyMatchKey {
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  dependencyType: DependencyType;
}

/** The ONLY evidence sources that may create an authority edge without human review. */
const AUTHORITY_SOURCES: ReadonlySet<EvidenceSourceType> = new Set(["manual", "permission_configuration"]);

const PROVENANCE_FOR: Record<EvidenceSourceType, ProvenanceSource> = {
  manual: "manual",
  agent_configuration: "discovered",
  workflow_definition: "discovered",
  permission_configuration: "discovered",
  runtime_event: "discovered",
  external_integration: "imported",
};

class Rejection extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The service boundary Dependency Discovery must use. It never writes tables
 * directly: it goes through the same validator, repository, version and audit
 * services as the HTTP path, acting as the internal discovery principal.
 *
 * Matching key: organization + source + target + dependencyType. `relationship`
 * is an attribute; a different label on the same pair is an update, not a new row.
 */
export class DependencyRegistryWriter {
  constructor(
    private readonly db: Database,
    private readonly deps: DependencyRepository,
    private readonly validator: RelationshipValidator,
    private readonly versions: DependencyVersionService,
    private readonly audit: DependencyAuditService,
    private readonly service: DependencyService,
  ) {}

  findMatching(organizationId: string, key: DependencyMatchKey): Promise<Dependency | null> {
    return this.deps.findByPair(this.db, organizationId, key);
  }

  /**
   * Idempotent. Repeating the same call returns "unchanged" and adds no evidence.
   * Domain-rule violations are returned as outcome "rejected" with a reason code;
   * unexpected failures throw.
   */
  async createOrUpdate(input: CreateDependencyInput): Promise<UpsertDependencyResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(input);
      } catch (err) {
        if (err instanceof Rejection) return { outcome: "rejected", reasonCode: err.code, reason: err.message, evidenceAdded: 0 };
        // Two concurrent first-writers: the loser retries and takes the update path.
        const { code, constraint } = pgError(err);
        if (attempt === 0 && code === "23505" && constraint === "dependencies_pair_unique") continue;
        throw err;
      }
    }
  }

  async deactivate(organizationId: string, dependencyId: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new ValidationError("A reason is required to deactivate a dependency");
    await this.service.remove(systemPrincipal(organizationId), dependencyId, undefined, reason.trim());
  }

  // ------------------------------------------------------------------

  private async attempt(input: CreateDependencyInput): Promise<UpsertDependencyResult> {
    const org = input.organizationId;
    const actor = systemPrincipal(org).actorId;

    if (input.evidence.length === 0) throw new Rejection("EVIDENCE_REQUIRED", "At least one piece of evidence is required");
    this.assertEvidence(input.evidence);

    if (
      input.dependencyType === "authority" &&
      !input.approvedByReview &&
      !input.evidence.some((e) => AUTHORITY_SOURCES.has(e.sourceType))
    ) {
      throw new Rejection(
        "AUTHORITY_REQUIRES_EXPLICIT_SOURCE",
        "Authority dependencies require manual or permission-configuration evidence, or human review approval",
      );
    }

    const confidence = Math.max(...input.evidence.map((e) => e.confidence));
    const times = input.evidence.map((e) => e.observedAt.getTime());
    const earliest = new Date(Math.min(...times));
    const latest = new Date(Math.max(...times));
    const primary = input.evidence[0]!;

    const metadata = { ...(input.metadata ?? {}) };
    // Discovered resource access rarely states a level. Record that honestly.
    if (input.dependencyType === "resource" && metadata.accessLevel === undefined) metadata.accessLevel = "unknown";

    let normalized: NormalizedNewDependency;
    try {
      normalized = this.validator.normalizeNew({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        targetType: input.targetType,
        targetId: input.targetId,
        dependencyType: input.dependencyType,
        relationship: input.relationship,
        metadata,
        provenance: {
          source: PROVENANCE_FOR[primary.sourceType],
          ...(primary.sourceReference ? { reference: primary.sourceReference } : {}),
        },
        confidence,
        observedAt: earliest.toISOString(),
        lastVerifiedAt: latest.toISOString(),
      });
    } catch (err) {
      if (err instanceof UnprocessableError) throw new Rejection(err.code, err.message);
      if (err instanceof ValidationError) throw new Rejection("VALIDATION_ERROR", err.message);
      throw err;
    }

    try {
      return await this.db.transaction(async (tx) => {
        if (forbidsCycles(normalized.dependencyType)) await this.deps.lockAuthorityEdges(tx, org);

        await this.validator.assertEndpointsExist(tx, org, { type: normalized.sourceType, id: normalized.sourceId }, { type: normalized.targetType, id: normalized.targetId });

        const existing = await this.deps.findByPair(tx, org, normalized);

        if (!existing) {
          if (forbidsCycles(normalized.dependencyType)) await this.validator.assertNoAuthorityCycle(tx, org, normalized.sourceId, normalized.targetId);
          const created = await this.deps.insert(tx, { organizationId: org, ...normalized });
          await this.versions.record(tx, created, "created", actor);
          await this.audit.record(tx, "dependency.created", actor, null, created);
          const added = await this.addEvidence(tx, org, created.id, input.evidence);
          return { dependencyId: created.id, outcome: "created" as const, version: created.version, evidenceAdded: added };
        }

        const locked = (await this.deps.find(tx, org, existing.id, { forUpdate: true }))!;
        const added = await this.addEvidence(tx, org, locked.id, input.evidence);

        if (locked.status === "inactive") {
          // A human removed this. Observing it again is evidence for review, not a reason to resurrect it.
          return {
            dependencyId: locked.id,
            outcome: "rejected" as const,
            version: locked.version,
            reasonCode: "INACTIVE_REQUIRES_REVIEW",
            reason: "The dependency is inactive; reactivation requires an explicit human decision",
            evidenceAdded: added,
          };
        }

        const patch: Parameters<DependencyRepository["update"]>[3] = {};
        if (normalized.relationship !== locked.relationship) patch.relationship = normalized.relationship;
        if (input.metadata !== undefined && !isDeepStrictEqual(normalized.metadata, locked.metadata)) patch.metadata = normalized.metadata;
        if (confidence > locked.confidence) patch.confidence = confidence; // confidence = strongest evidence, only ever rises here

        if (Object.keys(patch).length === 0) {
          await this.deps.touchVerified(tx, org, locked.id, latest);
          return { dependencyId: locked.id, outcome: "unchanged" as const, version: locked.version, evidenceAdded: added };
        }

        const updated = await this.deps.update(tx, org, locked.id, { ...patch, lastVerifiedAt: latest });
        await this.versions.record(tx, updated, "updated", actor);
        await this.audit.record(tx, "dependency.updated", actor, locked, updated);
        return { dependencyId: updated.id, outcome: "updated" as const, version: updated.version, evidenceAdded: added };
      });
    } catch (err) {
      if (err instanceof UnprocessableError) throw new Rejection(err.code, err.message);
      if (err instanceof AppError && err.statusCode === 400) throw new Rejection(err.code, err.message);
      throw err;
    }
  }

  private async addEvidence(tx: Parameters<DependencyRepository["insertEvidence"]>[0], org: string, id: string, items: EvidenceInput[]): Promise<number> {
    let added = 0;
    for (const e of items) if (await this.deps.insertEvidence(tx, org, id, e)) added++;
    return added;
  }

  private assertEvidence(items: EvidenceInput[]): void {
    const future = Date.now() + 5 * 60 * 1000;
    for (const e of items) {
      if (!(e.confidence >= 0 && e.confidence <= 1)) throw new Rejection("INVALID_CONFIDENCE", "Evidence confidence must be between 0 and 1");
      if (Number.isNaN(e.observedAt.getTime())) throw new Rejection("INVALID_FRESHNESS", "Evidence observedAt is not a valid date");
      if (e.observedAt.getTime() > future) throw new Rejection("INVALID_FRESHNESS", "Evidence observedAt must not be in the future");
      if ((e.sourceReference?.length ?? 0) > 500 || (e.evidenceReference?.length ?? 0) > 500) {
        throw new Rejection("EVIDENCE_TOO_LONG", "Evidence references must be at most 500 characters");
      }
    }
  }
}
