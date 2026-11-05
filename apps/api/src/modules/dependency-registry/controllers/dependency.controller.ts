import type { Dependency, DependencyEvidence, DependencyVersion, Resource } from "../types/dependency.types.js";

/** DTO mappers; controllers stay thin. */
const iso = (d: Date) => d.toISOString();

export const toDependencyDto = (d: Dependency) => ({
  id: d.id,
  organizationId: d.organizationId,
  sourceType: d.sourceType,
  sourceId: d.sourceId,
  targetType: d.targetType,
  targetId: d.targetId,
  dependencyType: d.dependencyType,
  relationship: d.relationship,
  metadata: d.metadata,
  provenance: d.provenance,
  confidence: d.confidence,
  observedAt: d.observedAt ? iso(d.observedAt) : null,
  lastVerifiedAt: d.lastVerifiedAt ? iso(d.lastVerifiedAt) : null,
  status: d.status,
  version: d.version,
  createdAt: iso(d.createdAt),
  updatedAt: iso(d.updatedAt),
});

export const toVersionDto = (v: DependencyVersion) => ({
  id: v.id,
  dependencyId: v.dependencyId,
  version: v.version,
  changeType: v.changeType,
  changedBy: v.changedBy,
  state: v.state,
  createdAt: iso(v.createdAt),
});

export const toEvidenceDto = (e: DependencyEvidence) => ({
  id: e.id,
  dependencyId: e.dependencyId,
  sourceType: e.sourceType,
  sourceReference: e.sourceReference,
  discoveryRunId: e.discoveryRunId,
  evidenceKind: e.evidenceKind,
  evidenceReference: e.evidenceReference,
  sourceVersion: e.sourceVersion,
  confidence: e.confidence,
  observedAt: iso(e.observedAt),
  createdAt: iso(e.createdAt),
});

export const toResourceDto = (r: Resource) => ({
  id: r.id,
  organizationId: r.organizationId,
  name: r.name,
  resourceType: r.resourceType,
  description: r.description,
  externalReference: r.externalReference,
  metadata: r.metadata,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

export const pageInfo = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
