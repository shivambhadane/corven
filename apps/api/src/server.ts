import { buildApp } from "./app.js";
import { devHeaderAuthenticator, failClosedAuthenticator } from "./auth/dev-auth.js";
import { randomBytes } from "node:crypto";
import { createDb } from "./db/client.js";
import { defaultAgentAuthConfig } from "./modules/authorization-gateway/index.js";
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
// Agent tokens are signed with AGENT_TOKEN_SECRET (base64 or hex of at least 32 bytes). Without it agent
// authentication is DISABLED (token issuance and gateway calls return 503), except under dev auth, where an
// ephemeral key is generated and every token dies on restart.
const rawSecret = process.env.AGENT_TOKEN_SECRET;
const tokenSecret = rawSecret ? (/^[0-9a-f]{64,}$/i.test(rawSecret) ? Buffer.from(rawSecret, "hex") : Buffer.from(rawSecret, "base64")) : devAuth ? randomBytes(32) : null;
if (tokenSecret && tokenSecret.length < 32) {
  process.stderr.write("AGENT_TOKEN_SECRET must decode to at least 32 bytes\n");
  process.exit(1);
}
const app = await buildApp({
  db: handle.db,
  // No production authenticator exists yet: without the dev adapter every
  // request is rejected with 401 (fail closed).
  authenticate: devAuth ? devHeaderAuthenticator : failClosedAuthenticator,
  discoveryQueue,
  gatewayOptions: { agentAuth: defaultAgentAuthConfig(tokenSecret) },
  logger: true,
});
if (devAuth) app.log.warn("DEVELOPMENT AUTH ENABLED: request headers are trusted. Never use this in production.");
else app.log.warn("No production authenticator is configured: all API requests will receive 401.");
if (!tokenSecret) app.log.warn("AGENT_TOKEN_SECRET is not set: agent authentication is disabled.");

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "127.0.0.1" });
