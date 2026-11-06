/**
 * Arkiv (Rabdi DB-Chain) configuration, read from the environment (the repository's .env, loaded by the process).
 *
 *   ARKIV_ENABLED                  "false" turns the integration off. Anything else leaves it on.
 *   ARKIV_NETWORK                  must be "rabdi" (the only network CORVEN targets)
 *   ARKIV_CHAIN_ID                 7794095 (default); anything else is refused
 *   ARKIV_RPC_URL                  optional; if set it must be exactly the Rabdi endpoint (https, no credentials, no path), never an arbitrary host
 *   ARKIV_ACCESS_KEY               the Arkiv Hub access key for Rabdi. SECRET. Sent in the X-API-KEY header, never in a URL
 *   ARKIV_SIGNER_PRIVATE_KEY       the wallet that creates entities (pays tGLM). SECRET. Without it the client can read and verify, not write
 *   ARKIV_ALLOW_PUBLIC_ENDPOINT    "true" explicitly allows the key-less, heavily rate-limited public endpoint (development only)
 *
 * The result is a state, not a guess: configuration is never reported as working. Whether the endpoint actually answers
 * and accepts the key is established by the health check.
 */
export const RABDI_CHAIN_ID = 7794095;
export const RABDI_RPC_URL = "https://rpc.rabdi.db-chain.testnet.arkiv.network";
export const RABDI_EXPLORER = "https://rabdi.explorer.arkiv.network";

export type ArkivConfigState =
  | { state: "disabled"; reason: string }
  | { state: "not_configured"; missing: string[]; reason: string }
  | { state: "configured"; config: ArkivConfig };

export interface ArkivConfig {
  chainId: number;
  rpcUrl: string;
  /** Empty only when the public endpoint was explicitly allowed. */
  accessKey: string;
  publicEndpoint: boolean;
  /** Null: read-only (health, query, verify); creating entities is refused. */
  signerPrivateKey: `0x${string}` | null;
}

type Env = Record<string, string | undefined>;

export function loadArkivConfig(env: Env = process.env): ArkivConfigState {
  if (env.ARKIV_ENABLED?.trim().toLowerCase() === "false") return { state: "disabled", reason: "ARKIV_ENABLED=false" };
  const problems: string[] = [];

  const network = (env.ARKIV_NETWORK ?? "").trim().toLowerCase();
  if (network && network !== "rabdi") problems.push(`ARKIV_NETWORK must be "rabdi" (got a different value)`);
  if (!network) problems.push("ARKIV_NETWORK");

  const chainId = env.ARKIV_CHAIN_ID?.trim() ? Number(env.ARKIV_CHAIN_ID) : RABDI_CHAIN_ID;
  if (chainId !== RABDI_CHAIN_ID) problems.push(`ARKIV_CHAIN_ID must be ${RABDI_CHAIN_ID}`);

  const rpcUrl = (env.ARKIV_RPC_URL ?? "").trim().replace(/\/+$/, "") || RABDI_RPC_URL;
  if (!isRabdiUrl(rpcUrl)) problems.push("ARKIV_RPC_URL must be exactly the Rabdi endpoint (https, that host, no path or credentials)");

  const accessKey = (env.ARKIV_ACCESS_KEY ?? "").trim();
  const allowPublic = env.ARKIV_ALLOW_PUBLIC_ENDPOINT?.trim().toLowerCase() === "true";
  const missing: string[] = [];
  if (!accessKey && !allowPublic) missing.push("ARKIV_ACCESS_KEY");
  if (problems.length) return { state: "not_configured", missing: problems, reason: `Invalid Arkiv configuration: ${problems.join("; ")}` };
  if (missing.length) return { state: "not_configured", missing, reason: "ARKIV_ACCESS_KEY is empty (set it, or set ARKIV_ALLOW_PUBLIC_ENDPOINT=true for development)" };

  const rawKey = (env.ARKIV_SIGNER_PRIVATE_KEY ?? "").trim();
  let signerPrivateKey: `0x${string}` | null = null;
  if (rawKey) {
    const k = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) return { state: "not_configured", missing: ["ARKIV_SIGNER_PRIVATE_KEY"], reason: "ARKIV_SIGNER_PRIVATE_KEY is not a 32-byte hex private key" };
    signerPrivateKey = k as `0x${string}`;
  }
  return { state: "configured", config: { chainId, rpcUrl, accessKey, publicEndpoint: !accessKey, signerPrivateKey } };
}

/** Only the Rabdi endpoint is ever contacted: an environment variable cannot point the service at another host (SSRF). */
export function isRabdiUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === new URL(RABDI_RPC_URL).hostname && !u.username && !u.password && (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash && (!u.port || u.port === "443");
  } catch {
    return false;
  }
}
