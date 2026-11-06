import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it, inject } from "vitest";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

const down = (f: string) => readFileSync(fileURLToPath(new URL(`../drizzle/down/${f}`, import.meta.url)), "utf8");

describe("migrations", () => {
  it("apply cleanly, roll back with the down scripts, and re-apply", async () => {
    const dbName = `corven_mig_${randomBytes(5).toString("hex")}`;
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(inject("adminUrl"));
    url.pathname = `/${dbName}`;
    const handle = createDb(url.toString());
    const tables = async () =>
      (await handle.pool.query("select table_name from information_schema.tables where table_schema='public' and table_name in ('agents','agent_capabilities','agent_identities','agent_status_history','agent_audit_logs','dependencies','dependency_versions','dependency_audit_logs','dependency_evidence','graph_snapshots','resources','discovery_sources','discovery_runs','discovery_observations','discovery_reconciliation_results','discovery_reviews','discovery_runtime_events','incidents','incident_state_history','incident_events','incident_audit_logs','incident_agents','incident_resources','incident_assignments','incident_notes','incident_analysis_references','agent_credentials','credential_rotation_history','permissions','resource_enforcement','gateway_audit_logs','gateway_decisions','execution_records','enforcement_actions','enforcement_action_events','approval_policies','approval_requests','approval_decisions','approval_audit_logs','verification_runs','verification_checks','evidence_records','evidence_anchors','evidence_verification_logs','incident_workflows','workflow_events','api_keys','organizations','organization_members','webhooks','webhook_deliveries','users') order by 1")).rows.map((r) => r.table_name);
    try {
      await runMigrations(handle.db);
      await runMigrations(handle.db); // idempotent
      const expected = [
        "agent_audit_logs", "agent_capabilities", "agent_credentials", "agent_identities", "agent_status_history", "agents", "api_keys", "approval_audit_logs", "approval_decisions", "approval_policies", "approval_requests", "credential_rotation_history",
        "dependencies", "dependency_audit_logs", "dependency_evidence", "dependency_versions", "discovery_observations", "discovery_reconciliation_results", "discovery_reviews", "discovery_runs", "discovery_runtime_events", "discovery_sources", "enforcement_action_events", "enforcement_actions", "evidence_anchors", "evidence_records", "evidence_verification_logs", "execution_records", "gateway_audit_logs", "gateway_decisions", "graph_snapshots", "incident_agents", "incident_analysis_references", "incident_assignments", "incident_audit_logs", "incident_events", "incident_notes", "incident_resources", "incident_state_history", "incident_workflows", "incidents", "organization_members", "organizations", "permissions", "resource_enforcement", "resources", "users", "verification_checks", "verification_runs", "webhook_deliveries", "webhooks", "workflow_events",
      ];
      expect(await tables()).toEqual(expected);

      // newest first
      for (const f of [
        "0024_users", "0023_saas_platform", "0022_arkiv_anchor_state", "0021_orchestration_append_only", "0020_orchestration",
        "0019_evidence_append_only", "0018_evidence_service",
        "0017_verification_append_only", "0016_verification_service",
        "0015_approval_append_only", "0014_approval_service",
        "0013_gateway_append_only", "0012_authorization_gateway",
        "0011_incident_append_only", "0010_incident_management",
        "0009_discovery_append_only", "0008_dependency_discovery",
        "0007_snapshot_append_only", "0006_graph_snapshots",
        "0005_evidence_append_only", "0004_discovery_prerequisites",
        "0003_dependency_append_only", "0002_dependency_registry",
        "0001_append_only_audit", "0000_agent_registry",
      ]) await handle.pool.query(down(`${f}.down.sql`));
      expect(await tables()).toEqual([]);

      await handle.pool.query("drop schema drizzle cascade");
      await runMigrations(handle.db);
      expect(await tables()).toEqual(expected);
    } finally {
      await handle.close();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });
});
