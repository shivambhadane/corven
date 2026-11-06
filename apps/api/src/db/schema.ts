import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Agent Registry schema.
 *
 * `organization_id` is an opaque UUID supplied by the authenticated principal.
 * There is no organizations table yet (no organization module exists), so no
 * foreign key is declared for it. Tenant isolation is enforced by always
 * filtering on it in the repository.
 *
 * Agents are never hard-deleted; audit and history tables reference them with
 * ON DELETE RESTRICT. Audit and history tables are append-only (see the
 * triggers in the 0001 migration).
 */

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    agentType: varchar("agent_type", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    runtimeType: varchar("runtime_type", { length: 64 }),
    ownerReference: varchar("owner_reference", { length: 255 }),
    /** Stable external key (e.g. "support-agent") used by Dependency Discovery for entity resolution. */
    externalReference: varchar("external_reference", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agents_org_external_ref_unique")
      .on(t.organizationId, sql`lower(${t.externalReference})`)
      .where(sql`${t.externalReference} is not null`),
    // Lets child tables reference (id, organization_id) so the database itself
    // guarantees a referenced agent belongs to the same organization.
    unique("agents_id_org_unique").on(t.id, t.organizationId),
    uniqueIndex("agents_org_name_unique").on(t.organizationId, sql`lower(${t.name})`),
    index("agents_org_status_idx").on(t.organizationId, t.status),
    index("agents_org_type_idx").on(t.organizationId, t.agentType),
    index("agents_org_created_idx").on(t.organizationId, t.createdAt, t.id),
    check("agents_status_check", sql`${t.status} in ('active','suspended','compromised','inactive')`),
    check("agents_type_check", sql`${t.agentType} in ('llm','workflow','service','wallet','other')`),
    check("agents_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

export const agentCapabilities = pgTable(
  "agent_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    capability: varchar("capability", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_capabilities_unique").on(t.agentId, t.capability)],
);

export const agentIdentities = pgTable(
  "agent_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    identityType: varchar("identity_type", { length: 32 }).notNull(),
    identityValue: varchar("identity_value", { length: 255 }).notNull(),
    verificationStatus: varchar("verification_status", { length: 32 }).notNull().default("unverified"),
    chainId: integer("chain_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_identities_org_unique").on(
      t.organizationId,
      t.identityType,
      sql`lower(${t.identityValue})`,
      sql`coalesce(${t.chainId}, 0)`,
    ),
    index("agent_identities_agent_idx").on(t.agentId),
    check(
      "agent_identities_type_check",
      sql`${t.identityType} in ('ens','evm_address','did','api_client','other')`,
    ),
    check(
      "agent_identities_verification_check",
      sql`${t.verificationStatus} in ('unverified','pending','verified','failed')`,
    ),
    check(
      "agent_identities_verified_at_check",
      sql`(${t.verificationStatus} = 'verified') = (${t.verifiedAt} is not null)`,
    ),
  ],
);

export const agentStatusHistory = pgTable(
  "agent_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    previousStatus: varchar("previous_status", { length: 32 }),
    newStatus: varchar("new_status", { length: 32 }).notNull(),
    actorId: uuid("actor_id"),
    reason: text("reason").notNull(),
    incidentId: uuid("incident_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_status_history_agent_idx").on(t.organizationId, t.agentId, t.createdAt),
    check(
      "agent_status_history_new_check",
      sql`${t.newStatus} in ('active','suspended','compromised','inactive')`,
    ),
    check(
      "agent_status_history_prev_check",
      sql`${t.previousStatus} is null or ${t.previousStatus} in ('active','suspended','compromised','inactive')`,
    ),
  ],
);

export const agentAuditLogs = pgTable(
  "agent_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id"),
    action: varchar("action", { length: 64 }).notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_audit_logs_agent_idx").on(t.organizationId, t.agentId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Dependency Registry
// ---------------------------------------------------------------------------

/**
 * Minimum resource model, only what dependency validation needs. This is not a
 * Resource Management module: resources can be created and read, nothing more.
 */
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    resourceType: varchar("resource_type", { length: 32 }).notNull(),
    description: text("description"),
    externalReference: varchar("external_reference", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("resources_org_external_ref_unique")
      .on(t.organizationId, sql`lower(${t.externalReference})`)
      .where(sql`${t.externalReference} is not null`),
    unique("resources_id_org_unique").on(t.id, t.organizationId),
    uniqueIndex("resources_org_name_unique").on(t.organizationId, sql`lower(${t.name})`),
    index("resources_org_created_idx").on(t.organizationId, t.createdAt, t.id),
    check(
      "resources_type_check",
      sql`${t.resourceType} in ('api','database','wallet','credential','storage','service','workflow','mcp_server','queue','other')`,
    ),
    check("resources_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

/**
 * Polymorphic endpoints use SEPARATE reference columns per target table, each
 * with a real composite foreign key (id, organization_id). A CHECK forces
 * exactly the column matching *_type to be set. For the unused column the
 * composite FK is skipped (NULL), which is exactly what we want. `source_id` /
 * `target_id` are generated convenience columns.
 */
export const dependencies = pgTable(
  "dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    sourceType: varchar("source_type", { length: 16 }).notNull(),
    sourceAgentId: uuid("source_agent_id"),
    sourceResourceId: uuid("source_resource_id"),
    sourceId: uuid("source_id").generatedAlwaysAs(sql`coalesce(source_agent_id, source_resource_id)`),
    targetType: varchar("target_type", { length: 16 }).notNull(),
    targetAgentId: uuid("target_agent_id"),
    targetResourceId: uuid("target_resource_id"),
    targetId: uuid("target_id").generatedAlwaysAs(sql`coalesce(target_agent_id, target_resource_id)`),
    dependencyType: varchar("dependency_type", { length: 16 }).notNull(),
    relationship: varchar("relationship", { length: 100 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
    confidence: doublePrecision("confidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("dependencies_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ columns: [t.sourceAgentId, t.organizationId], foreignColumns: [agents.id, agents.organizationId], name: "dependencies_source_agent_fk" }).onDelete("restrict"),
    foreignKey({ columns: [t.sourceResourceId, t.organizationId], foreignColumns: [resources.id, resources.organizationId], name: "dependencies_source_resource_fk" }).onDelete("restrict"),
    foreignKey({ columns: [t.targetAgentId, t.organizationId], foreignColumns: [agents.id, agents.organizationId], name: "dependencies_target_agent_fk" }).onDelete("restrict"),
    foreignKey({ columns: [t.targetResourceId, t.organizationId], foreignColumns: [resources.id, resources.organizationId], name: "dependencies_target_resource_fk" }).onDelete("restrict"),
    // one relationship per ordered pair and type, regardless of status
    uniqueIndex("dependencies_pair_unique").on(
      t.organizationId,
      t.sourceType,
      sql`coalesce(${t.sourceAgentId}, ${t.sourceResourceId})`,
      t.targetType,
      sql`coalesce(${t.targetAgentId}, ${t.targetResourceId})`,
      t.dependencyType,
    ),
    index("dependencies_org_source_idx").on(t.organizationId, t.sourceType, t.sourceAgentId, t.sourceResourceId),
    index("dependencies_org_target_idx").on(t.organizationId, t.targetType, t.targetAgentId, t.targetResourceId),
    index("dependencies_org_type_status_idx").on(t.organizationId, t.dependencyType, t.status),
    index("dependencies_org_created_idx").on(t.organizationId, t.createdAt, t.id),
    check("dependencies_source_type_check", sql`${t.sourceType} in ('agent','resource')`),
    check("dependencies_target_type_check", sql`${t.targetType} in ('agent','resource')`),
    check("dependencies_type_check", sql`${t.dependencyType} in ('authority','resource','operational')`),
    check("dependencies_status_check", sql`${t.status} in ('active','inactive')`),
    check("dependencies_confidence_check", sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
    check("dependencies_version_check", sql`${t.version} >= 1`),
    check("dependencies_relationship_not_blank", sql`length(btrim(${t.relationship})) > 0`),
    check(
      "dependencies_source_ref_check",
      sql`(${t.sourceType} = 'agent' and ${t.sourceAgentId} is not null and ${t.sourceResourceId} is null)
        or (${t.sourceType} = 'resource' and ${t.sourceResourceId} is not null and ${t.sourceAgentId} is null)`,
    ),
    check(
      "dependencies_target_ref_check",
      sql`(${t.targetType} = 'agent' and ${t.targetAgentId} is not null and ${t.targetResourceId} is null)
        or (${t.targetType} = 'resource' and ${t.targetResourceId} is not null and ${t.targetAgentId} is null)`,
    ),
    check(
      "dependencies_no_self_reference",
      sql`not (${t.sourceType} = ${t.targetType} and coalesce(${t.sourceAgentId}, ${t.sourceResourceId}) = coalesce(${t.targetAgentId}, ${t.targetResourceId}))`,
    ),
    // Defence in depth: the same source/target compatibility matrix as the application policy.
    check(
      "dependencies_type_matrix_check",
      sql`(${t.dependencyType} = 'authority' and ${t.sourceType} = 'agent' and ${t.targetType} = 'agent')
        or (${t.dependencyType} = 'resource' and ${t.sourceType} = 'agent' and ${t.targetType} = 'resource')
        or (${t.dependencyType} = 'operational' and not (${t.sourceType} = 'resource' and ${t.targetType} = 'resource'))`,
    ),
  ],
);

export const dependencyVersions = pgTable(
  "dependency_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    dependencyId: uuid("dependency_id").notNull(),
    version: integer("version").notNull(),
    changeType: varchar("change_type", { length: 16 }).notNull(),
    changedBy: uuid("changed_by"),
    state: jsonb("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.dependencyId, t.organizationId], foreignColumns: [dependencies.id, dependencies.organizationId], name: "dependency_versions_dependency_fk" }).onDelete("restrict"),
    uniqueIndex("dependency_versions_unique").on(t.dependencyId, t.version),
    check(
      "dependency_versions_change_check",
      sql`${t.changeType} in ('created','updated','activated','deactivated','removed')`,
    ),
  ],
);

export const dependencyAuditLogs = pgTable(
  "dependency_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    dependencyId: uuid("dependency_id").notNull(),
    actorId: uuid("actor_id"),
    action: varchar("action", { length: 64 }).notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.dependencyId, t.organizationId], foreignColumns: [dependencies.id, dependencies.organizationId], name: "dependency_audit_logs_dependency_fk" }).onDelete("restrict"),
    index("dependency_audit_logs_dep_idx").on(t.organizationId, t.dependencyId, t.createdAt),
  ],
);

/**
 * Append-only evidence supporting a dependency. A dependency row summarises the
 * current accepted state; every observation that supports it is kept here, so
 * fresh observations never need to bump the dependency version.
 * `discovery_run_id` has no foreign key yet (the discovery tables arrive in a
 * later stage).
 */
export const dependencyEvidence = pgTable(
  "dependency_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    dependencyId: uuid("dependency_id").notNull(),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    sourceReference: varchar("source_reference", { length: 500 }),
    discoveryRunId: uuid("discovery_run_id"),
    evidenceKind: varchar("evidence_kind", { length: 16 }).notNull(),
    evidenceReference: varchar("evidence_reference", { length: 500 }),
    sourceVersion: varchar("source_version", { length: 100 }),
    confidence: doublePrecision("confidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.dependencyId, t.organizationId], foreignColumns: [dependencies.id, dependencies.organizationId], name: "dependency_evidence_dependency_fk" }).onDelete("restrict"),
    index("dependency_evidence_dep_idx").on(t.organizationId, t.dependencyId, t.observedAt),
    // A retried run must not duplicate evidence.
    uniqueIndex("dependency_evidence_run_unique")
      .on(t.dependencyId, t.discoveryRunId, t.sourceType, sql`coalesce(${t.sourceReference}, '')`)
      .where(sql`${t.discoveryRunId} is not null`),
    check(
      "dependency_evidence_source_check",
      sql`${t.sourceType} in ('manual','agent_configuration','workflow_definition','permission_configuration','runtime_event','external_integration')`,
    ),
    check("dependency_evidence_kind_check", sql`${t.evidenceKind} in ('declared','configured','observed')`),
    check("dependency_evidence_confidence_check", sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
  ],
);

// ---------------------------------------------------------------------------
// Graph Snapshot Service
// ---------------------------------------------------------------------------

/**
 * Immutable point-in-time copy of an organization's graph (all edge statuses).
 * `content_hash` is the SHA-256 of the canonical JSON of the organization id,
 * nodes and edges (build time excluded), so identical graphs hash identically
 * and any change to the stored payload is detectable. Append-only (triggers).
 * `incident_id` has no foreign key until the Incident module exists.
 */
export const graphSnapshots = pgTable(
  "graph_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    label: varchar("label", { length: 200 }),
    incidentId: uuid("incident_id"),
    createdBy: uuid("created_by"),
    nodeCount: integer("node_count").notNull(),
    edgeCount: integer("edge_count").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull(),
    builtAt: timestamp("built_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("graph_snapshots_id_org_unique").on(t.id, t.organizationId),
    index("graph_snapshots_org_created_idx").on(t.organizationId, t.createdAt, t.id),
    index("graph_snapshots_org_incident_idx").on(t.organizationId, t.incidentId),
    check("graph_snapshots_hash_check", sql`length(${t.contentHash}) = 64`),
    check("graph_snapshots_counts_check", sql`${t.nodeCount} >= 0 and ${t.edgeCount} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Dependency Discovery
// ---------------------------------------------------------------------------

/**
 * A configured source of dependency evidence. Config and workflow sources hold
 * their documents in `configuration` (never read from disk or a URL).
 * No credentials belong in `configuration`.
 */
export const discoverySources = pgTable(
  "discovery_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    freshnessWindowHours: integer("freshness_window_hours").notNull().default(168),
    lastSuccessfulRunAt: timestamp("last_successful_run_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("discovery_sources_id_org_unique").on(t.id, t.organizationId),
    uniqueIndex("discovery_sources_org_name_unique").on(t.organizationId, sql`lower(${t.name})`),
    index("discovery_sources_org_idx").on(t.organizationId, t.createdAt, t.id),
    check("discovery_sources_type_check", sql`${t.type} in ('agent_configuration','workflow_definition','runtime_gateway')`),
    check("discovery_sources_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("discovery_sources_freshness_check", sql`${t.freshnessWindowHours} between 1 and 8760`),
  ],
);

export const discoveryRuns = pgTable(
  "discovery_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    requestedBy: uuid("requested_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    recordsCollected: integer("records_collected").notNull().default(0),
    observationsCreated: integer("observations_created").notNull().default(0),
    relationshipsCreated: integer("relationships_created").notNull().default(0),
    relationshipsUpdated: integer("relationships_updated").notNull().default(0),
    relationshipsUnchanged: integer("relationships_unchanged").notNull().default(0),
    relationshipsRejected: integer("relationships_rejected").notNull().default(0),
    unresolvedObservations: integer("unresolved_observations").notNull().default(0),
    pendingReview: integer("pending_review").notNull().default(0),
    missingRelationships: integer("missing_relationships").notNull().default(0),
    sourceWasStale: boolean("source_was_stale").notNull().default(false),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("discovery_runs_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ columns: [t.sourceId, t.organizationId], foreignColumns: [discoverySources.id, discoverySources.organizationId], name: "discovery_runs_source_fk" }).onDelete("restrict"),
    // at most one active run per source
    uniqueIndex("discovery_runs_one_active_per_source").on(t.sourceId).where(sql`${t.status} in ('pending','running')`),
    index("discovery_runs_org_idx").on(t.organizationId, t.createdAt, t.id),
    check("discovery_runs_status_check", sql`${t.status} in ('pending','running','completed','completed_with_errors','failed','cancelled')`),
  ],
);

export const discoveryObservations = pgTable(
  "discovery_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    runId: uuid("run_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    externalRecordId: varchar("external_record_id", { length: 400 }).notNull(),
    sourceReference: varchar("source_reference", { length: 400 }).notNull(),
    /** Redacted and size-limited; never the unrestricted source payload. */
    rawEvidence: jsonb("raw_evidence").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    processingStatus: varchar("processing_status", { length: 24 }).notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    normalized: jsonb("normalized"),
    resolved: jsonb("resolved"),
    reconciliationOutcome: varchar("reconciliation_outcome", { length: 16 }),
    dependencyId: uuid("dependency_id"),
    registryOutcome: varchar("registry_outcome", { length: 16 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("discovery_observations_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ columns: [t.runId, t.organizationId], foreignColumns: [discoveryRuns.id, discoveryRuns.organizationId], name: "discovery_observations_run_fk" }).onDelete("restrict"),
    // a retried run cannot duplicate a record
    uniqueIndex("discovery_observations_run_record_unique").on(t.runId, t.externalRecordId),
    index("discovery_observations_run_idx").on(t.organizationId, t.runId, t.processingStatus),
    check(
      "discovery_observations_status_check",
      sql`${t.processingStatus} in ('pending','normalized','resolved','rejected','unresolved','pending_review','applied','review_rejected')`,
    ),
    check(
      "discovery_observations_outcome_check",
      sql`${t.reconciliationOutcome} is null or ${t.reconciliationOutcome} in ('new','unchanged','modified','missing','conflicting','stale','unresolved')`,
    ),
  ],
);

export const discoveryReconciliationResults = pgTable(
  "discovery_reconciliation_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    runId: uuid("run_id").notNull(),
    observationId: uuid("observation_id"),
    dependencyId: uuid("dependency_id"),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.runId, t.organizationId], foreignColumns: [discoveryRuns.id, discoveryRuns.organizationId], name: "discovery_results_run_fk" }).onDelete("restrict"),
    index("discovery_results_run_idx").on(t.organizationId, t.runId, t.outcome),
    check("discovery_results_outcome_check", sql`${t.outcome} in ('new','unchanged','modified','missing','conflicting','stale','unresolved')`),
  ],
);

export const discoveryReviews = pgTable(
  "discovery_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    observationId: uuid("observation_id").notNull(),
    decision: varchar("decision", { length: 16 }).notNull(),
    reviewerId: uuid("reviewer_id").notNull(),
    reason: text("reason"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.observationId, t.organizationId], foreignColumns: [discoveryObservations.id, discoveryObservations.organizationId], name: "discovery_reviews_observation_fk" }).onDelete("restrict"),
    index("discovery_reviews_obs_idx").on(t.organizationId, t.observationId, t.reviewedAt),
    check("discovery_reviews_decision_check", sql`${t.decision} in ('approve','reject','defer')`),
  ],
);

/** Gateway events received for a runtime source. Unique per source, so duplicates are ignored. */
export const discoveryRuntimeEvents = pgTable(
  "discovery_runtime_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    eventId: varchar("event_id", { length: 200 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedBy: uuid("received_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    consumedRunId: uuid("consumed_run_id"),
  },
  (t) => [
    foreignKey({ columns: [t.sourceId, t.organizationId], foreignColumns: [discoverySources.id, discoverySources.organizationId], name: "discovery_events_source_fk" }).onDelete("restrict"),
    uniqueIndex("discovery_events_source_event_unique").on(t.sourceId, t.eventId),
    index("discovery_events_pending_idx").on(t.sourceId, t.consumedRunId),
  ],
);

// ---------------------------------------------------------------------------
// Incident Management
// ---------------------------------------------------------------------------

const INCIDENT_STATUSES = "'detected','investigating','containment_planned','awaiting_approval','approved','containing','verifying','contained','partially_contained','containment_failed','rejected','false_positive','resolved','closed'";

/**
 * The current state of an incident. History lives in the append-only tables
 * below; this row is the only mutable one. `version` increases on every change.
 * The `current_*_ref_id` pointers name the analysis references that are in force;
 * attaching a new snapshot clears the blast-radius and plan pointers because both
 * were computed on the previous one.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    severity: varchar("severity", { length: 16 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("detected"),
    detectionSource: varchar("detection_source", { length: 32 }).notNull(),
    /** Id of the signal in the producing system; with the source it makes signal intake idempotent. */
    detectionReference: varchar("detection_reference", { length: 200 }),
    createdBy: uuid("created_by").notNull(),
    createdByType: varchar("created_by_type", { length: 8 }).notNull(),
    assigneeId: uuid("assignee_id"),
    stateEnteredAt: timestamp("state_entered_at", { withTimezone: true }).notNull().defaultNow(),
    currentSnapshotRefId: uuid("current_snapshot_ref_id"),
    currentBlastRefId: uuid("current_blast_ref_id"),
    currentPlanRefId: uuid("current_plan_ref_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("incidents_id_org_unique").on(t.id, t.organizationId),
    uniqueIndex("incidents_org_detection_unique").on(t.organizationId, t.detectionSource, t.detectionReference).where(sql`${t.detectionReference} is not null`),
    index("incidents_org_created_idx").on(t.organizationId, t.createdAt, t.id),
    index("incidents_org_status_idx").on(t.organizationId, t.status),
    index("incidents_org_severity_idx").on(t.organizationId, t.severity),
    check("incidents_status_check", sql.raw(`status in (${INCIDENT_STATUSES})`)),
    check("incidents_severity_check", sql`${t.severity} in ('critical','high','medium','low','informational')`),
    check("incidents_source_check", sql`${t.detectionSource} in ('manual','internal_event','runtime_signal','automated_detection')`),
    check("incidents_created_by_type_check", sql`${t.createdByType} in ('human','system')`),
    check("incidents_title_check", sql`length(btrim(${t.title})) > 0`),
  ],
);

const incidentFk = (name: string, t: { incidentId: AnyPgColumn; organizationId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.incidentId, t.organizationId], foreignColumns: [incidents.id, incidents.organizationId] }).onDelete("restrict");

/** Append-only. One row per lifecycle transition. */
export const incidentStateHistory = pgTable(
  "incident_state_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    fromStatus: varchar("from_status", { length: 32 }),
    toStatus: varchar("to_status", { length: 32 }).notNull(),
    actorId: uuid("actor_id").notNull(),
    actorType: varchar("actor_type", { length: 8 }).notNull(),
    reason: text("reason").notNull(),
    correlationId: varchar("correlation_id", { length: 100 }),
    idempotencyKey: varchar("idempotency_key", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    incidentFk("incident_state_history_incident_fk", t),
    index("incident_state_history_idx").on(t.organizationId, t.incidentId, t.createdAt),
    uniqueIndex("incident_state_history_idem_unique").on(t.incidentId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("incident_state_history_to_check", sql.raw(`to_status in (${INCIDENT_STATUSES})`)),
    check("incident_state_history_actor_type_check", sql`${t.actorType} in ('human','system')`),
  ],
);

/** Append-only timeline. `seq` gives a stable total order. */
export const incidentEvents = pgTable(
  "incident_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    actorId: uuid("actor_id").notNull(),
    actorType: varchar("actor_type", { length: 8 }).notNull(),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    correlationId: varchar("correlation_id", { length: 100 }),
    idempotencyKey: varchar("idempotency_key", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    incidentFk("incident_events_incident_fk", t),
    index("incident_events_idx").on(t.organizationId, t.incidentId, t.seq),
    uniqueIndex("incident_events_idem_unique").on(t.incidentId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("incident_events_actor_type_check", sql`${t.actorType} in ('human','system')`),
  ],
);

/** Append-only security audit: who changed what, with before and after state. */
export const incidentAuditLogs = pgTable(
  "incident_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    actorType: varchar("actor_type", { length: 8 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id"),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    correlationId: varchar("correlation_id", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [incidentFk("incident_audit_logs_incident_fk", t), index("incident_audit_logs_idx").on(t.organizationId, t.incidentId, t.createdAt)],
);

/** Append-only. An agent can be associated under several relationships. */
export const incidentAgents = pgTable(
  "incident_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    relationship: varchar("relationship", { length: 16 }).notNull(),
    suspectedCompromised: boolean("suspected_compromised").notNull().default(false),
    impact: varchar("impact", { length: 16 }).notNull(),
    source: varchar("source", { length: 24 }).notNull(),
    sourceReference: varchar("source_reference", { length: 500 }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    incidentFk("incident_agents_incident_fk", t),
    foreignKey({ name: "incident_agents_agent_fk", columns: [t.agentId, t.organizationId], foreignColumns: [agents.id, agents.organizationId] }).onDelete("restrict"),
    unique("incident_agents_unique").on(t.incidentId, t.agentId, t.relationship),
    index("incident_agents_agent_idx").on(t.organizationId, t.agentId),
    check("incident_agents_relationship_check", sql`${t.relationship} in ('compromised','affected','dependent','observed','preserved')`),
    check("incident_agents_impact_check", sql`${t.impact} in ('direct','indirect','none')`),
    check("incident_agents_source_check", sql`${t.source} in ('manual','blast_radius','discovery','system')`),
  ],
);

/** Append-only. `resource_type` is copied from the registry at association time. */
export const incidentResources = pgTable(
  "incident_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    resourceType: varchar("resource_type", { length: 32 }).notNull(),
    relationship: varchar("relationship", { length: 16 }).notNull(),
    impactClassification: varchar("impact_classification", { length: 24 }).notNull(),
    source: varchar("source", { length: 24 }).notNull(),
    sourceReference: varchar("source_reference", { length: 500 }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    incidentFk("incident_resources_incident_fk", t),
    foreignKey({ name: "incident_resources_resource_fk", columns: [t.resourceId, t.organizationId], foreignColumns: [resources.id, resources.organizationId] }).onDelete("restrict"),
    unique("incident_resources_unique").on(t.incidentId, t.resourceId, t.relationship),
    check("incident_resources_relationship_check", sql`${t.relationship} in ('exposed','affected','protected','observed')`),
    check("incident_resources_impact_check", sql`${t.impactClassification} in ('exposed','potentially_affected','uncertain','healthy','unassessed')`),
    check("incident_resources_source_check", sql`${t.source} in ('manual','blast_radius','discovery','system')`),
  ],
);

/** Append-only assignment history; the current assignee is `incidents.assignee_id`. */
export const incidentAssignments = pgTable(
  "incident_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    assigneeId: uuid("assignee_id").notNull(),
    assignedBy: uuid("assigned_by").notNull(),
    note: varchar("note", { length: 1000 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [incidentFk("incident_assignments_incident_fk", t), index("incident_assignments_idx").on(t.organizationId, t.incidentId, t.createdAt)],
);

/** Append-only. Notes are never edited; a correction is a new note. */
export const incidentNotes = pgTable(
  "incident_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    authorId: uuid("author_id").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    incidentFk("incident_notes_incident_fk", t),
    index("incident_notes_idx").on(t.organizationId, t.incidentId, t.createdAt),
    check("incident_notes_content_check", sql`length(btrim(${t.content})) > 0 and length(${t.content}) <= 4000`),
  ],
);

/**
 * Append-only references to analysis performed for an incident. Nothing is
 * copied: the snapshot is referenced by id and hash, and blast-radius and plan
 * results are identified by a canonical result hash over the engines'
 * deterministic output for the pinned snapshot and the stored input.
 */
export const incidentAnalysisReferences = pgTable(
  "incident_analysis_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    /** Per incident and kind, starting at 1. */
    version: integer("version").notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    snapshotBuiltAt: timestamp("snapshot_built_at", { withTimezone: true }).notNull(),
    snapshotFormatVersion: integer("snapshot_format_version").notNull(),
    engineVersion: varchar("engine_version", { length: 32 }).notNull(),
    input: jsonb("input").notNull().default(sql`'{}'::jsonb`),
    resultHash: varchar("result_hash", { length: 64 }),
    planHash: varchar("plan_hash", { length: 64 }),
    planStatus: varchar("plan_status", { length: 24 }),
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    incidentFk("incident_analysis_refs_incident_fk", t),
    foreignKey({ name: "incident_analysis_refs_snapshot_fk", columns: [t.snapshotId, t.organizationId], foreignColumns: [graphSnapshots.id, graphSnapshots.organizationId] }).onDelete("restrict"),
    unique("incident_analysis_refs_version_unique").on(t.incidentId, t.kind, t.version),
    unique("incident_analysis_refs_id_org_unique").on(t.id, t.organizationId),
    index("incident_analysis_refs_idx").on(t.organizationId, t.incidentId, t.kind, t.version),
    check("incident_analysis_refs_kind_check", sql`${t.kind} in ('graph_snapshot','blast_radius','containment_plan')`),
    check("incident_analysis_refs_hash_check", sql`${t.snapshotHash} ~ '^[0-9a-f]{64}$'`),
    check("incident_analysis_refs_plan_check", sql`(${t.kind} = 'containment_plan') = (${t.planHash} is not null)`),
  ],
);

// ---------------------------------------------------------------------------
// Authorization & Enforcement Gateway
// ---------------------------------------------------------------------------

/**
 * Machine credential for one agent. Only a SHA-256 hash of the high-entropy
 * secret is stored; the secret itself is shown once at issue time. At most one
 * credential per agent is active (rotation revokes the previous one).
 */
export const agentCredentials = pgTable(
  "agent_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    secretHash: varchar("secret_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by"),
    revokeReason: text("revoke_reason"),
  },
  (t) => [
    unique("agent_credentials_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ name: "agent_credentials_agent_fk", columns: [t.agentId, t.organizationId], foreignColumns: [agents.id, agents.organizationId] }).onDelete("restrict"),
    uniqueIndex("agent_credentials_one_active").on(t.agentId).where(sql`${t.status} = 'active'`),
    index("agent_credentials_agent_idx").on(t.organizationId, t.agentId, t.createdAt),
    check("agent_credentials_status_check", sql`${t.status} in ('active','revoked')`),
    check("agent_credentials_hash_check", sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Append-only history of credential issue, rotation and revocation. */
export const credentialRotationHistory = pgTable(
  "credential_rotation_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    credentialId: uuid("credential_id").notNull(),
    previousCredentialId: uuid("previous_credential_id"),
    action: varchar("action", { length: 16 }).notNull(),
    actorId: uuid("actor_id").notNull(),
    actorType: varchar("actor_type", { length: 8 }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "credential_history_credential_fk", columns: [t.credentialId, t.organizationId], foreignColumns: [agentCredentials.id, agentCredentials.organizationId] }).onDelete("restrict"),
    index("credential_history_agent_idx").on(t.organizationId, t.agentId, t.createdAt),
    check("credential_history_action_check", sql`${t.action} in ('issued','rotated','revoked')`),
  ],
);

/**
 * A grant: this agent may perform this action on this resource. Registry
 * capabilities and dependency edges never authorize anything; only a grant does.
 * Mutable only to revoke (a trigger enforces that).
 */
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    constraints: jsonb("constraints").notNull().default(sql`'{}'::jsonb`),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    version: integer("version").notNull().default(1),
    grantedBy: uuid("granted_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by"),
    revokeReason: text("revoke_reason"),
  },
  (t) => [
    unique("permissions_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ name: "permissions_agent_fk", columns: [t.agentId, t.organizationId], foreignColumns: [agents.id, agents.organizationId] }).onDelete("restrict"),
    foreignKey({ name: "permissions_resource_fk", columns: [t.resourceId, t.organizationId], foreignColumns: [resources.id, resources.organizationId] }).onDelete("restrict"),
    uniqueIndex("permissions_one_active").on(t.organizationId, t.agentId, t.resourceId, t.action).where(sql`${t.status} = 'active'`),
    index("permissions_lookup_idx").on(t.organizationId, t.agentId, t.resourceId, t.status),
    check("permissions_status_check", sql`${t.status} in ('active','revoked')`),
    check("permissions_action_check", sql`length(btrim(${t.action})) > 0`),
  ],
);

/** How a resource is protected: every access goes through the gateway, or only some does. */
export const resourceEnforcement = pgTable(
  "resource_enforcement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    mode: varchar("mode", { length: 16 }).notNull(),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "resource_enforcement_resource_fk", columns: [t.resourceId, t.organizationId], foreignColumns: [resources.id, resources.organizationId] }).onDelete("restrict"),
    unique("resource_enforcement_unique").on(t.organizationId, t.resourceId),
    check("resource_enforcement_mode_check", sql`${t.mode} in ('gateway','advisory')`),
  ],
);

/** Append-only audit of grants, revocations and enforcement-mode changes. */
export const gatewayAuditLogs = pgTable(
  "gateway_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    actorType: varchar("actor_type", { length: 8 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id"),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    correlationId: varchar("correlation_id", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gateway_audit_logs_idx").on(t.organizationId, t.createdAt)],
);

/** Append-only record of every authorization decision, including denials. The payload is never stored, only its hash. */
export const gatewayDecisions = pgTable(
  "gateway_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    requestId: varchar("request_id", { length: 100 }).notNull(),
    stage: varchar("stage", { length: 12 }).notNull(),
    resourceRef: varchar("resource_ref", { length: 200 }).notNull(),
    resourceId: uuid("resource_id"),
    action: varchar("action", { length: 64 }).notNull(),
    decision: varchar("decision", { length: 8 }).notNull(),
    reasonCodes: jsonb("reason_codes").notNull(),
    permissionId: uuid("permission_id"),
    permissionVersion: integer("permission_version"),
    payloadHash: varchar("payload_hash", { length: 64 }),
    credentialId: uuid("credential_id"),
    correlationId: varchar("correlation_id", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gateway_decisions_request_stage").on(t.organizationId, t.agentId, t.requestId, t.stage),
    index("gateway_decisions_agent_idx").on(t.organizationId, t.agentId, t.createdAt),
    check("gateway_decisions_stage_check", sql`${t.stage} in ('check','precheck','recheck')`),
    check("gateway_decisions_decision_check", sql`${t.decision} in ('allow','deny')`),
  ],
);

/**
 * One row per protected operation, claimed as 'pending' BEFORE anything runs
 * (at-most-once execution per agent and request id) and finalized exactly once.
 * A row stuck in 'pending' means the outcome is unknown, and is never retried.
 */
export const executionRecords = pgTable(
  "execution_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    requestId: varchar("request_id", { length: 100 }).notNull(),
    resourceRef: varchar("resource_ref", { length: 200 }).notNull(),
    resourceId: uuid("resource_id"),
    action: varchar("action", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    precheckDecisionId: uuid("precheck_decision_id"),
    recheckDecisionId: uuid("recheck_decision_id"),
    executor: varchar("executor", { length: 64 }),
    simulated: boolean("simulated").notNull().default(false),
    externalReference: varchar("external_reference", { length: 500 }),
    failureReason: text("failure_reason"),
    result: jsonb("result"),
    payloadHash: varchar("payload_hash", { length: 64 }),
    correlationId: varchar("correlation_id", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("execution_records_request_unique").on(t.organizationId, t.agentId, t.requestId),
    index("execution_records_agent_idx").on(t.organizationId, t.agentId, t.createdAt),
    check("execution_records_status_check", sql`${t.status} in ('pending','denied','failed','submitted','executed')`),
  ],
);

/**
 * A containment or emergency restriction applied through an adapter. 'executed'
 * means CORVEN's own enforcement state changed; it is not proof of containment
 * (that is Verification's job). An executed `revoke_resource_access` action is
 * also an active restriction that the policy evaluator honours until rolled back.
 */
export const enforcementActions = pgTable(
  "enforcement_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id"),
    planHash: varchar("plan_hash", { length: 64 }),
    edgeId: uuid("edge_id"),
    kind: varchar("kind", { length: 32 }).notNull(),
    agentId: uuid("agent_id"),
    resourceId: uuid("resource_id"),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    adapter: varchar("adapter", { length: 64 }),
    approvalBasis: varchar("approval_basis", { length: 24 }).notNull(),
    approvalRef: varchar("approval_ref", { length: 200 }),
    reason: text("reason").notNull(),
    result: jsonb("result"),
    failureReason: text("failure_reason"),
    externalReference: varchar("external_reference", { length: 500 }),
    idempotencyKey: varchar("idempotency_key", { length: 200 }),
    requestedBy: uuid("requested_by").notNull(),
    requestedByType: varchar("requested_by_type", { length: 8 }).notNull(),
    correlationId: varchar("correlation_id", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("enforcement_actions_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ name: "enforcement_actions_incident_fk", columns: [t.incidentId, t.organizationId], foreignColumns: [incidents.id, incidents.organizationId] }).onDelete("restrict"),
    foreignKey({ name: "enforcement_actions_agent_fk", columns: [t.agentId, t.organizationId], foreignColumns: [agents.id, agents.organizationId] }).onDelete("restrict"),
    foreignKey({ name: "enforcement_actions_resource_fk", columns: [t.resourceId, t.organizationId], foreignColumns: [resources.id, resources.organizationId] }).onDelete("restrict"),
    uniqueIndex("enforcement_actions_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("enforcement_actions_restriction_idx").on(t.organizationId, t.agentId, t.resourceId, t.status),
    index("enforcement_actions_incident_idx").on(t.organizationId, t.incidentId, t.createdAt),
    check("enforcement_actions_status_check", sql`${t.status} in ('pending','submitted','executed','failed','unsupported','rolled_back')`),
    check("enforcement_actions_kind_check", sql`${t.kind} in ('revoke_resource_access','suspend_agent','revoke_credentials','revoke_authority','block_operational_trigger')`),
    check("enforcement_actions_basis_check", sql`${t.approvalBasis} in ('plan_approval','admin_override')`),
  ],
);

/** Append-only: every status an enforcement action passed through, so submitted, executed and failed stay distinguishable. */
export const enforcementActionEvents = pgTable(
  "enforcement_action_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id").notNull(),
    actionId: uuid("action_id").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    actorId: uuid("actor_id").notNull(),
    actorType: varchar("actor_type", { length: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "enforcement_action_events_action_fk", columns: [t.actionId, t.organizationId], foreignColumns: [enforcementActions.id, enforcementActions.organizationId] }).onDelete("restrict"),
    index("enforcement_action_events_idx").on(t.organizationId, t.actionId, t.seq),
  ],
);

// ---------------------------------------------------------------------------
// Approval Service
// ---------------------------------------------------------------------------

/** One policy per organization. Each approval request copies the policy it was created under. */
export const approvalPolicies = pgTable(
  "approval_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requiredApprovals: integer("required_approvals").notNull(),
    elevatedRequiredApprovals: integer("elevated_required_approvals").notNull(),
    separationOfDuties: boolean("separation_of_duties").notNull(),
    expiryMinutes: integer("expiry_minutes").notNull(),
    executionWindowMinutes: integer("execution_window_minutes").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("approval_policies_org_unique").on(t.organizationId),
    check("approval_policies_counts_check", sql`${t.requiredApprovals} between 1 and 5 and ${t.elevatedRequiredApprovals} between ${t.requiredApprovals} and 5`),
    check("approval_policies_minutes_check", sql`${t.expiryMinutes} between 5 and 10080 and ${t.executionWindowMinutes} between 5 and 1440`),
  ],
);

/**
 * A request to approve one exact containment plan. `approval_digest` binds the
 * approval to the incident, the plan reference, the engine's plan hash, the
 * pinned snapshot hash and the canonical result hash (schema-versioned).
 * Only status and decision fields move; a trigger freezes the binding.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    planReferenceId: uuid("plan_reference_id").notNull(),
    planVersion: integer("plan_version").notNull(),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    resultHash: varchar("result_hash", { length: 64 }).notNull(),
    schemaVersion: integer("schema_version").notNull(),
    approvalDigest: varchar("approval_digest", { length: 64 }).notNull(),
    risk: varchar("risk", { length: 16 }).notNull(),
    riskReasons: jsonb("risk_reasons").notNull().default(sql`'[]'::jsonb`),
    policy: jsonb("policy").notNull(),
    requiredApprovals: integer("required_approvals").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    requestedBy: uuid("requested_by").notNull(),
    comment: text("comment"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    executableUntil: timestamp("executable_until", { withTimezone: true }),
    closedReason: text("closed_reason"),
    /** Whether the incident lifecycle and timeline reflect the final status yet. Retried until true. */
    incidentSynced: boolean("incident_synced").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("approval_requests_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ name: "approval_requests_incident_fk", columns: [t.incidentId, t.organizationId], foreignColumns: [incidents.id, incidents.organizationId] }).onDelete("restrict"),
    foreignKey({ name: "approval_requests_plan_fk", columns: [t.planReferenceId, t.organizationId], foreignColumns: [incidentAnalysisReferences.id, incidentAnalysisReferences.organizationId] }).onDelete("restrict"),
    uniqueIndex("approval_requests_one_pending").on(t.organizationId, t.incidentId).where(sql`${t.status} = 'pending'`),
    index("approval_requests_org_idx").on(t.organizationId, t.createdAt, t.id),
    index("approval_requests_lookup_idx").on(t.organizationId, t.incidentId, t.planHash, t.status),
    check("approval_requests_status_check", sql`${t.status} in ('pending','approved','rejected','expired','cancelled','invalidated')`),
    check("approval_requests_risk_check", sql`${t.risk} in ('standard','elevated')`),
    check("approval_requests_hash_check", sql`${t.planHash} ~ '^[0-9a-f]{64}$' and ${t.approvalDigest} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Append-only. One decision per approver per request; it records exactly what was reviewed. */
export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    approvalId: uuid("approval_id").notNull(),
    decision: varchar("decision", { length: 8 }).notNull(),
    decidedBy: uuid("decided_by").notNull(),
    role: varchar("role", { length: 16 }).notNull(),
    comment: text("comment"),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    approvalDigest: varchar("approval_digest", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "approval_decisions_request_fk", columns: [t.approvalId, t.organizationId], foreignColumns: [approvalRequests.id, approvalRequests.organizationId] }).onDelete("restrict"),
    unique("approval_decisions_one_per_approver").on(t.approvalId, t.decidedBy),
    check("approval_decisions_decision_check", sql`${t.decision} in ('approve','reject')`),
  ],
);

/** Append-only audit of requests, decisions, closures and policy changes. */
export const approvalAuditLogs = pgTable(
  "approval_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id").notNull(),
    approvalId: uuid("approval_id"),
    actorId: uuid("actor_id").notNull(),
    actorType: varchar("actor_type", { length: 8 }).notNull(),
    action: varchar("action", { length: 48 }).notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    correlationId: varchar("correlation_id", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approval_audit_logs_idx").on(t.organizationId, t.approvalId, t.seq)],
);

// ---------------------------------------------------------------------------
// Verification Service
// ---------------------------------------------------------------------------

/**
 * One verification of an incident's containment. Status moves pending -> running
 * -> a final status exactly once (trigger). `result_hash` is the canonical hash
 * of all its checks, so the evidence of what was observed can be re-verified.
 */
export const verificationRuns = pgTable(
  "verification_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    approvalId: uuid("approval_id"),
    planReferenceId: uuid("plan_reference_id").notNull(),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    attempt: integer("attempt").notNull().default(1),
    retryOf: uuid("retry_of"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    summary: jsonb("summary"),
    resultHash: varchar("result_hash", { length: 64 }),
    incidentOutcome: varchar("incident_outcome", { length: 32 }),
    incidentSynced: boolean("incident_synced").notNull().default(false),
    idempotencyKey: varchar("idempotency_key", { length: 200 }),
    requestedBy: uuid("requested_by").notNull(),
    requestedByType: varchar("requested_by_type", { length: 8 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("verification_runs_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ name: "verification_runs_incident_fk", columns: [t.incidentId, t.organizationId], foreignColumns: [incidents.id, incidents.organizationId] }).onDelete("restrict"),
    foreignKey({ name: "verification_runs_plan_fk", columns: [t.planReferenceId, t.organizationId], foreignColumns: [incidentAnalysisReferences.id, incidentAnalysisReferences.organizationId] }).onDelete("restrict"),
    foreignKey({ name: "verification_runs_approval_fk", columns: [t.approvalId, t.organizationId], foreignColumns: [approvalRequests.id, approvalRequests.organizationId] }).onDelete("restrict"),
    uniqueIndex("verification_runs_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    uniqueIndex("verification_runs_one_active").on(t.organizationId, t.incidentId).where(sql`${t.status} in ('pending','running')`),
    index("verification_runs_incident_idx").on(t.organizationId, t.incidentId, t.createdAt),
    check("verification_runs_status_check", sql`${t.status} in ('pending','running','passed','failed','partially_verified','inconclusive')`),
  ],
);

/** Append-only. Each check is written once, with its definition and what was actually observed. */
export const verificationChecks = pgTable(
  "verification_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    runId: uuid("run_id").notNull(),
    seq: integer("seq").notNull(),
    category: varchar("category", { length: 32 }).notNull(),
    purpose: varchar("purpose", { length: 16 }).notNull(),
    agentId: uuid("agent_id"),
    resourceId: uuid("resource_id"),
    action: varchar("action", { length: 64 }),
    expected: varchar("expected", { length: 16 }).notNull(),
    actual: varchar("actual", { length: 32 }).notNull(),
    result: varchar("result", { length: 16 }).notNull(),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    executionReference: varchar("execution_reference", { length: 200 }),
    limitation: text("limitation"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "verification_checks_run_fk", columns: [t.runId, t.organizationId], foreignColumns: [verificationRuns.id, verificationRuns.organizationId] }).onDelete("restrict"),
    unique("verification_checks_seq_unique").on(t.runId, t.seq),
    check("verification_checks_category_check", sql`${t.category} in ('NEGATIVE_ACCESS_TEST','POSITIVE_ACCESS_TEST','PERMISSION_PERSISTENCE_TEST','PATH_BLOCK_TEST','RESOURCE_HEALTH_TEST','BYPASS_RESISTANCE_TEST')`),
    check("verification_checks_purpose_check", sql`${t.purpose} in ('security','continuity')`),
    check("verification_checks_result_check", sql`${t.result} in ('passed','failed','inconclusive')`),
  ],
);

// ---------------------------------------------------------------------------
// Evidence Service
// ---------------------------------------------------------------------------

/**
 * A sealed, canonical incident record. `content` is the canonical document and
 * `content_hash` its SHA-256; both are frozen by a trigger. Records for the same
 * incident form a hash chain through `previous_hash`. Only the lifecycle status
 * and verification bookkeeping move.
 */
export const evidenceRecords = pgTable(
  "evidence_records",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    sequence: integer("sequence").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    previousEvidenceId: uuid("previous_evidence_id"),
    previousHash: varchar("previous_hash", { length: 64 }),
    content: jsonb("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdByType: varchar("created_by_type", { length: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("evidence_records_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ name: "evidence_records_incident_fk", columns: [t.incidentId, t.organizationId], foreignColumns: [incidents.id, incidents.organizationId] }).onDelete("restrict"),
    unique("evidence_records_sequence_unique").on(t.incidentId, t.sequence),
    index("evidence_records_incident_idx").on(t.organizationId, t.incidentId, t.sequence),
    check("evidence_records_status_check", sql`${t.status} in ('sealed','anchor_pending','anchored','anchor_failed','verified','invalid')`),
    check("evidence_records_hash_check", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** One external anchor of an evidence hash. Only the hash and identifiers leave CORVEN, never the content. */
export const evidenceAnchors = pgTable(
  "evidence_anchors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
    target: varchar("target", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    anchoredHash: varchar("anchored_hash", { length: 64 }).notNull(),
    externalReference: varchar("external_reference", { length: 200 }),
    chainId: integer("chain_id"),
    contractAddress: varchar("contract_address", { length: 64 }),
    blockNumber: bigint("block_number", { mode: "number" }),
    confirmations: integer("confirmations"),
    requiredConfirmations: integer("required_confirmations"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "evidence_anchors_evidence_fk", columns: [t.evidenceId, t.organizationId], foreignColumns: [evidenceRecords.id, evidenceRecords.organizationId] }).onDelete("restrict"),
    unique("evidence_anchors_one_per_target").on(t.evidenceId, t.target),
    check("evidence_anchors_target_check", sql`${t.target} in ('arkiv','ethereum')`),
    check("evidence_anchors_status_check", sql`${t.status} in ('submitted','confirmed','failed')`),
  ],
);

/** Append-only log of every integrity verification and what each step found. */
export const evidenceVerificationLogs = pgTable(
  "evidence_verification_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
    valid: boolean("valid").notNull(),
    checks: jsonb("checks").notNull(),
    actorId: uuid("actor_id").notNull(),
    actorType: varchar("actor_type", { length: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "evidence_verification_logs_evidence_fk", columns: [t.evidenceId, t.organizationId], foreignColumns: [evidenceRecords.id, evidenceRecords.organizationId] }).onDelete("restrict"),
    index("evidence_verification_logs_idx").on(t.organizationId, t.evidenceId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Incident-response orchestration
// ---------------------------------------------------------------------------

/**
 * One durable workflow per incident. The row IS the work item: `next_run_at`, `lease_until`, `attempts`
 * and `last_error` make it a retryable job that survives restarts. The step is informational; every
 * run re-derives what to do from the real state of the incident, approval, enforcement and verification.
 */
export const incidentWorkflows = pgTable(
  "incident_workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("running"),
    step: varchar("step", { length: 24 }).notNull().default("analysis"),
    outcome: varchar("outcome", { length: 40 }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    approvalRequested: boolean("approval_requested").notNull().default(false),
    evidenceId: uuid("evidence_id"),
    verificationAttempts: integer("verification_attempts").notNull().default(0),
    startedBy: uuid("started_by").notNull(),
    startedByType: varchar("started_by_type", { length: 8 }).notNull(),
    correlationId: varchar("correlation_id", { length: 100 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("incident_workflows_id_org_unique").on(t.id, t.organizationId),
    foreignKey({ name: "incident_workflows_incident_fk", columns: [t.incidentId, t.organizationId], foreignColumns: [incidents.id, incidents.organizationId] }).onDelete("restrict"),
    uniqueIndex("incident_workflows_one_per_incident").on(t.organizationId, t.incidentId),
    index("incident_workflows_due_idx").on(t.status, t.nextRunAt),
    check("incident_workflows_status_check", sql`${t.status} in ('running','waiting','completed','stopped','blocked','failed','cancelled')`),
  ],
);

/** Append-only log of what the workflow did and why it stopped. */
export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id").notNull(),
    workflowId: uuid("workflow_id").notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "workflow_events_workflow_fk", columns: [t.workflowId, t.organizationId], foreignColumns: [incidentWorkflows.id, incidentWorkflows.organizationId] }).onDelete("restrict"),
    index("workflow_events_idx").on(t.organizationId, t.workflowId, t.seq),
  ],
);
