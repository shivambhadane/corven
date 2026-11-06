import { sql } from "drizzle-orm";
import {
  check,
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
