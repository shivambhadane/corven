import { buildApp } from "./app.js";
import { devHeaderAuthenticator, failClosedAuthenticator } from "./auth/dev-auth.js";
import { createFirebaseVerifier } from "./auth/firebase.js";
import { EnsResolver } from "./modules/agent-registry/index.js";
import { randomBytes } from "node:crypto";
import { createDb } from "./db/client.js";
import { loadArkivConfig, SdkArkivClient, defaultEvidenceConfig, loadEthereumConfig } from "./modules/evidence-service/index.js";
import { existsSync } from "node:fs";
import { ResourceExecutors, SimulatedExecutor } from "./modules/authorization-gateway/index.js";
import { PgBossTicker } from "./modules/orchestrator/index.js";
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

// Human sign-in through Firebase. These are PUBLIC identifiers (the same values every Firebase web app ships to browsers);
// no service account or secret is needed because ID tokens are verified against Google's published public keys.
const fbProject = process.env.FIREBASE_PROJECT_ID?.trim();
const firebase = fbProject
  ? {
      verifier: createFirebaseVerifier({ projectId: fbProject }),
      publicConfig: {
        apiKey: process.env.FIREBASE_WEB_API_KEY?.trim() ?? "",
        authDomain: process.env.FIREBASE_AUTH_DOMAIN?.trim() || `${fbProject}.firebaseapp.com`,
        projectId: fbProject,
        appId: process.env.FIREBASE_APP_ID?.trim() ?? "",
      },
    }
  : null;
if (firebase && (!firebase.publicConfig.apiKey || !firebase.publicConfig.appId)) {
  process.stderr.write("FIREBASE_PROJECT_ID is set but FIREBASE_WEB_API_KEY or FIREBASE_APP_ID is missing\n");
  process.exit(1);
}

if (production) {
  if (!firebase || !firebase.publicConfig.apiKey || !firebase.publicConfig.appId) {
    process.stderr.write("Production requires FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY, and FIREBASE_APP_ID\n");
    process.exit(1);
  }
  if (process.env.CORVEN_SIMULATED_EXECUTORS === "1") {
    process.stderr.write("CORVEN_SIMULATED_EXECUTORS must not be enabled in production\n");
    process.exit(1);
  }
}

// ENS (Sepolia) resolution for the integrations page. Uses the server's Sepolia RPC; the URL never leaves the server.
const ensRpc = process.env.ENS_RPC_URL?.trim() || process.env.ETHEREUM_SEPOLIA_RPC_URL?.trim();
const ensLookup = ensRpc
  ? (() => {
      const r = new EnsResolver({ rpcUrl: ensRpc, chain: "sepolia" });
      return { network: "Ethereum Sepolia", resolveName: async (n: string) => (await r.resolveName(n)) ?? null };
    })()
  : null;

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
// Arkiv (Rabdi DB-Chain). A real client is built only from real configuration. If Arkiv is disabled or not configured there is
// NO fallback to an in-memory stand-in: anchoring to Arkiv simply reports that it is unavailable.
const arkivCfg = loadArkivConfig(process.env);
// Ethereum (Sepolia / Anvil). A client is constructed when the RPC URL and contract address are configured.
const ethCfg = loadEthereumConfig(process.env);
const evidenceConfig = defaultEvidenceConfig({
  arkivState: arkivCfg.state === "configured" ? { state: "configured" } : arkivCfg.state === "disabled" ? { state: "disabled", reason: arkivCfg.reason } : { state: "not_configured", reason: arkivCfg.reason, missing: arkivCfg.missing },
  ...(arkivCfg.state === "configured" ? { arkiv: new SdkArkivClient(arkivCfg.config, { log: (event, fields) => process.stdout.write(`${JSON.stringify({ level: "info", event, ...fields })}\n`) }) } : {}),
  ...(ethCfg.state === "configured" ? { ethereum: ethCfg.client } : {}),
  log: (event, fields) => process.stdout.write(`${JSON.stringify({ level: "info", event, ...fields })}\n`),
});
// Resource executors. No real external resource is wired yet; under development auth every resource gets a SimulatedExecutor
// (flagged "simulated" on every execution record) so the full response can be exercised. CORVEN_SIMULATED_EXECUTORS=0 turns it off.
const executors = new ResourceExecutors();
if (devAuth && process.env.CORVEN_SIMULATED_EXECUTORS !== "0") executors.setDefault(new SimulatedExecutor());

// The landing page and the built console are served from the same origin when present.
// The website is the Next.js app in frontend/ (it proxies /api/v1 here). CORVEN_WEB_DIR can still serve a static build from this process.
const webDir = process.env.CORVEN_WEB_DIR;
const web = { dir: webDir && existsSync(`${webDir}/index.html`) ? webDir : undefined };

const app = await buildApp({
  evidenceConfig,
  web,
  db: handle.db,
  // No production authenticator exists yet: without the dev adapter every
  // request is rejected with 401 (fail closed).
  authenticate: devAuth ? devHeaderAuthenticator : failClosedAuthenticator,
  devAuth,
  integrations: {
    ethereumState: ethCfg.state === "configured" ? { state: "configured" } : { state: ethCfg.state === "disabled" ? "disabled" : "not_configured", reason: ethCfg.reason },
    ens: ensLookup,
  },
  ...(firebase ? { firebase } : {}),
  discoveryQueue,
  gatewayOptions: { agentAuth: defaultAgentAuthConfig(tokenSecret), executors },
  logger: true,
});
if (devAuth) app.log.warn("DEVELOPMENT AUTH ENABLED: request headers are trusted. Never use this in production.");
else if (!firebase) app.log.warn("No authenticator is configured (no FIREBASE_PROJECT_ID, no dev auth): all API requests will receive 401.");
if (firebase) app.log.info(`Firebase sign-in enabled for project ${firebase.publicConfig.projectId}`);
if (arkivCfg.state !== "configured") app.log.warn(`Arkiv anchoring is ${arkivCfg.state}: ${arkivCfg.reason}`);
else if (arkivCfg.config.publicEndpoint) app.log.warn("Arkiv is using the public, rate-limited endpoint (no access key).");
if (ethCfg.state === "configured") app.log.info(`Ethereum anchoring configured (contract: ${ethCfg.client.contractAddress}, signer: ${ethCfg.client.signerAddress ?? "read-only"})`);
else app.log.warn(`Ethereum anchoring is ${ethCfg.state}: ${ethCfg.reason}`);
if (!tokenSecret) app.log.warn("AGENT_TOKEN_SECRET is not set: agent authentication is disabled.");

// The incident-response workflow is driven by a pg-boss schedule. ORCHESTRATOR_TICKER=off leaves it to manual
// POST /workflows/:id/run calls (useful when debugging a single workflow).
if (process.env.ORCHESTRATOR_TICKER !== "off") {
  const ticker = new PgBossTicker(databaseUrl, app.orchestrator.orchestrator, (e) => app.log.error({ err: e }, "orchestrator ticker error"));
  await ticker.start();
  app.addHook("onClose", async () => void (await ticker.stop()));
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");
await app.listen({ port, host });
app.log.info(`CORVEN API on http://${host}:${port}${web.dir ? ` · static web app at /` : ""}`);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down gracefully...");
  const timeout = setTimeout(() => {
    app.log.error("Forced shutdown after timeout (15s)");
    process.exit(1);
  }, 15000);
  try {
    await app.close();
    await handle.close();
    clearTimeout(timeout);
    app.log.info("Server and database pool closed cleanly.");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during graceful shutdown");
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

