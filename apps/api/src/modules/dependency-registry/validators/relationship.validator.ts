import type { Executor } from "../../../db/client.js";
import { UnprocessableError, ValidationError } from "../../../errors.js";
import { assertSafeMetadata } from "../../agent-registry/policies/agent-input.policy.js";
import type { AgentRepository } from "../../agent-registry/repositories/agent.repository.js";
import {
  assertCompatibleEndpoints,
  assertFreshness,
  assertNotSelfReference,
  assertRequiredMetadata,
  resolveConfidence,
} from "../policies/relationship.policy.js";
import type { DependencyRepository } from "../repositories/dependency.repository.js";
import type { ResourceRepository } from "../repositories/resource.repository.js";
import type { DependencyType, Endpoint, Provenance } from "../types/dependency.types.js";

export interface RawNewDependency {
  sourceType: Endpoint["type"];
  sourceId: string;
  targetType: Endpoint["type"];
  targetId: string;
  dependencyType: DependencyType;
  relationship: string;
  metadata?: Record<string, unknown> | undefined;
  provenance: Provenance;
  confidence?: number | undefined;
  observedAt?: string | undefined;
  lastVerifiedAt?: string | undefined;
}

export interface NormalizedNewDependency {
  sourceType: Endpoint["type"];
  sourceId: string;
  targetType: Endpoint["type"];
  targetId: string;
  dependencyType: DependencyType;
  relationship: string;
  metadata: Record<string, unknown>;
  provenance: Provenance;
  confidence: number;
  observedAt: Date | null;
  lastVerifiedAt: Date | null;
}

const RELATIONSHIP = /^[a-z][a-z0-9_.:-]*$/;

export function normalizeRelationship(label: string): string {
  const v = label.trim();
  if (v.length === 0 || v.length > 100 || !RELATIONSHIP.test(v)) {
    throw new ValidationError('relationship must be lowercase letters, digits and "_.:-", starting with a letter (max 100)');
  }
  return v;
}

export const parseDate = (v: string | null | undefined): Date | null => (v ? new Date(v) : null);

/** Cleans a provenance object (drops blanks, trims). Secrets must never go in `reference`/`note`. */
export function normalizeProvenance(p: Provenance): Provenance {
  const out: Provenance = { source: p.source };
  if (p.reference?.trim()) out.reference = p.reference.trim();
  if (p.note?.trim()) out.note = p.note.trim();
  return out;
}

export class RelationshipValidator {
  constructor(
    private readonly agents: AgentRepository,
    private readonly resources: ResourceRepository,
    private readonly deps: DependencyRepository,
  ) {}

  /** Pure validation + normalisation of a new relationship. Throws before touching the database. */
  normalizeNew(input: RawNewDependency): NormalizedNewDependency {
    const source: Endpoint = { type: input.sourceType, id: input.sourceId };
    const target: Endpoint = { type: input.targetType, id: input.targetId };
    assertNotSelfReference(source, target);
    assertCompatibleEndpoints(input.dependencyType, source, target);

    const metadata = assertSafeMetadata(input.metadata ?? {});
    assertRequiredMetadata(input.dependencyType, metadata);

    const provenance = normalizeProvenance(input.provenance);
    const confidence = resolveConfidence(provenance.source, input.confidence);
    const observedAt = parseDate(input.observedAt);
    const lastVerifiedAt = parseDate(input.lastVerifiedAt);
    assertFreshness(observedAt, lastVerifiedAt);

    return {
      sourceType: source.type,
      sourceId: source.id,
      targetType: target.type,
      targetId: target.id,
      dependencyType: input.dependencyType,
      relationship: normalizeRelationship(input.relationship),
      metadata,
      provenance,
      confidence,
      observedAt,
      lastVerifiedAt,
    };
  }

  /**
   * Both endpoints must exist IN THE CALLER'S ORGANIZATION. A missing entity
   * and an entity in another organization are deliberately indistinguishable.
   */
  async assertEndpointsExist(tx: Executor, organizationId: string, source: Endpoint, target: Endpoint): Promise<void> {
    for (const [role, e] of [["source", source], ["target", target]] as const) {
      const found =
        e.type === "agent"
          ? await this.agents.findAgent(tx, organizationId, e.id)
          : await this.resources.find(tx, organizationId, e.id);
      if (!found) {
        throw new UnprocessableError("ENDPOINT_NOT_FOUND", `The ${role} ${e.type} was not found`, { role, type: e.type });
      }
    }
  }

  /**
   * Authority cycles are prohibited: adding source->target is rejected if target
   * already reaches source through ACTIVE authority edges. Operational and
   * resource dependencies are never cycle-checked. The caller must hold
   * lockAuthorityEdges() so concurrent inserts cannot jointly create a cycle.
   */
  async assertNoAuthorityCycle(tx: Executor, organizationId: string, sourceId: string, targetId: string): Promise<void> {
    const path = await this.deps.findAuthorityPath(tx, organizationId, targetId, sourceId);
    if (path) {
      throw new UnprocessableError(
        "AUTHORITY_CYCLE",
        "This authority dependency would create a delegation cycle",
        { cycle: [sourceId, ...path] },
      );
    }
  }
}
