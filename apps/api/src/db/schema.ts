import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
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
