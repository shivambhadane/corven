import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;
/** Either the root database or a transaction handle. */
export type Executor = Parameters<Parameters<Database["transaction"]>[0]>[0] | Database;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string): DbHandle {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on("error", () => undefined);
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export { schema };
