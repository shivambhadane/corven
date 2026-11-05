import { randomBytes } from "node:crypto";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
    adminUrl: string;
  }
}

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://corven:corven_local_only@127.0.0.1:54329/postgres";

/**
 * Creates a throwaway database on a REAL PostgreSQL, applies the real
 * migrations, and drops it afterwards. Fails loudly if Postgres is not
 * reachable (start it with `docker compose up -d --wait`). It never skips.
 */
export default async function setup(project: TestProject) {
  const dbName = `corven_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach test PostgreSQL at ${ADMIN_URL.replace(/:[^:@/]*@/, ":***@")}. ` +
        `Run "docker compose up -d --wait" from the repo root. (${(err as Error).message})`,
    );
  }
  await admin.query(`CREATE DATABASE ${dbName}`);

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const handle = createDb(url.toString());
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }

  project.provide("dbUrl", url.toString());
  project.provide("adminUrl", ADMIN_URL);

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  };
}
