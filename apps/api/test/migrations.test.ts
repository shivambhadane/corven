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
      (await handle.pool.query("select table_name from information_schema.tables where table_schema='public' and table_name in ('agents','agent_capabilities','agent_identities','agent_status_history','agent_audit_logs','dependencies','dependency_versions','dependency_audit_logs','dependency_evidence','resources') order by 1")).rows.map((r) => r.table_name);
    try {
      await runMigrations(handle.db);
      await runMigrations(handle.db); // idempotent
      const expected = [
        "agent_audit_logs", "agent_capabilities", "agent_identities", "agent_status_history", "agents",
        "dependencies", "dependency_audit_logs", "dependency_evidence", "dependency_versions", "resources",
      ];
      expect(await tables()).toEqual(expected);

      // newest first
      for (const f of [
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
