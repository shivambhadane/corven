import { buildApp } from "./app.js";
import { devHeaderAuthenticator, failClosedAuthenticator } from "./auth/dev-auth.js";
import { createDb } from "./db/client.js";
import { InlineJobQueue, PgBossJobQueue } from "./modules/dependency-discovery/jobs/queue.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}

const production = process.env.NODE_ENV === "production";
const devAuth = process.env.CORVEN_DEV_AUTH === "1";
if (devAuth && production) {
  process.stderr.write("CORVEN_DEV_AUTH must not be enabled when NODE_ENV=production\n");
  process.exit(1);
}

const handle = createDb(databaseUrl);
// Discovery runs execute in the background. pg-boss (over the same PostgreSQL) is the default;
// DISCOVERY_QUEUE=inline runs them in-process, which is only suitable for local experiments.
const discoveryQueue = process.env.DISCOVERY_QUEUE === "inline" ? new InlineJobQueue() : new PgBossJobQueue(databaseUrl, (e) => process.stderr.write(`pg-boss error: ${e.message}\n`));
const app = await buildApp({
  db: handle.db,
  // No production authenticator exists yet: without the dev adapter every
  // request is rejected with 401 (fail closed).
  authenticate: devAuth ? devHeaderAuthenticator : failClosedAuthenticator,
  discoveryQueue,
  logger: true,
});
if (devAuth) app.log.warn("DEVELOPMENT AUTH ENABLED: request headers are trusted. Never use this in production.");
else app.log.warn("No production authenticator is configured: all API requests will receive 401.");

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "127.0.0.1" });
