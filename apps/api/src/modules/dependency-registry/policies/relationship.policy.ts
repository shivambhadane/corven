import { UnprocessableError } from "../../../errors.js";
import {
  ACCESS_LEVELS,
  type DependencyType,
  type EntityType,
  type Endpoint,
} from "../types/dependency.types.js";

/**
 * Pure relationship rules. No database access here.
 *
 * Source/target compatibility (also enforced by the dependencies_type_matrix_check
 * CHECK constraint as defence in depth):
 *
 *   authority    agent    -> agent
 *   resource     agent    -> resource
 *   operational  agent    -> agent | resource,  resource -> agent
 *
 * resource -> resource is not supported by this module.
 * Self-reference is rejected for every type.
 */
const MATRIX: Record<DependencyType, ReadonlyArray<readonly [EntityType, EntityType]>> = {
  authority: [["agent", "agent"]],
  resource: [["agent", "resource"]],
  operational: [
    ["agent", "agent"],
    ["agent", "resource"],
    ["resource", "agent"],
  ],
};

export function assertCompatibleEndpoints(type: DependencyType, source: Endpoint, target: Endpoint): void {
  const ok = MATRIX[type].some(([s, t]) => s === source.type && t === target.type);
  if (!ok) {
    const allowed = MATRIX[type].map(([s, t]) => `${s}->${t}`).join(", ");
    throw new UnprocessableError(
      "RELATIONSHIP_TYPE_MISMATCH",
      `A ${type} dependency cannot go from ${source.type} to ${target.type} (allowed: ${allowed})`,
      { dependencyType: type, sourceType: source.type, targetType: target.type },
    );
  }
}

export function assertNotSelfReference(source: Endpoint, target: Endpoint): void {
  if (source.type === target.type && source.id === target.id) {
    throw new UnprocessableError("SELF_REFERENCE", "A dependency cannot reference the same entity as source and target");
  }
}

const SCOPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/**
 * Per-type required metadata:
 *   authority    metadata.scope        dotted lowercase string, what authority is delegated
 *   resource     metadata.accessLevel  read | write | admin
 *   operational  nothing required
 */
export function assertRequiredMetadata(type: DependencyType, metadata: Record<string, unknown>): void {
  if (type === "authority") {
    const scope = metadata.scope;
    if (typeof scope !== "string" || scope.length > 100 || !SCOPE.test(scope)) {
      throw new UnprocessableError(
        "MISSING_REQUIRED_METADATA",
        'An authority dependency requires metadata.scope, a dotted lowercase string such as "payment.execute"',
        { required: "scope" },
      );
    }
  } else if (type === "resource") {
    const level = metadata.accessLevel;
    if (typeof level !== "string" || !(ACCESS_LEVELS as readonly string[]).includes(level)) {
      throw new UnprocessableError(
        "MISSING_REQUIRED_METADATA",
        `A resource dependency requires metadata.accessLevel (${ACCESS_LEVELS.join(" | ")})`,
        { required: "accessLevel" },
      );
    }
  }
}

/** Only authority dependencies have a prohibited-cycle rule. Operational cycles are legitimate. */
export const forbidsCycles = (type: DependencyType): boolean => type === "authority";

/** Confidence defaults to 1 only for manual declarations; every other source must state it. */
export function resolveConfidence(source: string, confidence: number | undefined): number {
  if (confidence === undefined) {
    if (source === "manual") return 1;
    throw new UnprocessableError("CONFIDENCE_REQUIRED", `confidence is required when provenance.source is "${source}"`);
  }
  return confidence;
}

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function assertFreshness(observedAt: Date | null, lastVerifiedAt: Date | null, now = new Date()): void {
  const limit = now.getTime() + MAX_CLOCK_SKEW_MS;
  for (const [label, d] of [["observedAt", observedAt], ["lastVerifiedAt", lastVerifiedAt]] as const) {
    if (d && d.getTime() > limit) {
      throw new UnprocessableError("INVALID_FRESHNESS", `${label} must not be in the future`);
    }
  }
  if (observedAt && lastVerifiedAt && lastVerifiedAt.getTime() < observedAt.getTime()) {
    throw new UnprocessableError("INVALID_FRESHNESS", "lastVerifiedAt must not be earlier than observedAt");
  }
}
