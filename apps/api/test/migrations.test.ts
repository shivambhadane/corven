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
      (await handle.pool.query("select table_name from information_schema.tables where table_schema='public' and table_name like 'agent%' order by 1")).rows.map((r) => r.table_name);
    try {
      await runMigrations(handle.db);
      await runMigrations(handle.db); // idempotent
      expect(await tables()).toEqual(["agent_audit_logs", "agent_capabilities", "agent_identities", "agent_status_history", "agents"]);

      await handle.pool.query(down("0001_append_only_audit.down.sql"));
      await handle.pool.query(down("0000_agent_registry.down.sql"));
      expect(await tables()).toEqual([]);

      await handle.pool.query("drop schema drizzle cascade");
      await runMigrations(handle.db);
      expect(await tables()).toHaveLength(5);
    } finally {
      await handle.close();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });
});
