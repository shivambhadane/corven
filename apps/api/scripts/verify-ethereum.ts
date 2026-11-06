/**
 * Read-only check of the Ethereum configuration. Sends no transaction and signs nothing.
 *
 *   pnpm eth:verify [--expect 0xYourDevAddress]
 *
 * Reads ETHEREUM_SEPOLIA_RPC_URL, ETHEREUM_CHAIN_ID, ETHEREUM_SIGNER_PRIVATE_KEY and
 * EVIDENCE_ANCHOR_CONTRACT_ADDRESS from the environment (loaded from the repository's .env by
 * the package script). The RPC URL and the private key are never printed; only the public
 * address derived from the key is.
 */
import { createPublicClient, getAddress, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SEPOLIA = 11155111;
const out = (line: string) => process.stdout.write(`${line}\n`);
let failed = false;
const check = (name: string, ok: boolean, detail: string) => {
  out(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
  if (!ok) failed = true;
};

const url = process.env.ETHEREUM_SEPOLIA_RPC_URL ?? "";
const configuredChain = Number(process.env.ETHEREUM_CHAIN_ID ?? "");
const rawKey = process.env.ETHEREUM_SIGNER_PRIVATE_KEY ?? "";
const contract = process.env.ETHEREUM_CONTRACT ?? process.env.EVIDENCE_ANCHOR_CONTRACT_ADDRESS ?? "";
const expectIdx = process.argv.indexOf("--expect");
const expected = expectIdx > 0 ? process.argv[expectIdx + 1] : undefined;

check("RPC URL configured", url.length > 0 && /^https?:\/\//.test(url), url ? `https URL of ${url.length} characters (not shown)` : "ETHEREUM_SEPOLIA_RPC_URL is empty");
check("ETHEREUM_CHAIN_ID", configuredChain === SEPOLIA, `configured ${Number.isFinite(configuredChain) ? configuredChain : "none"}, required ${SEPOLIA}`);
if (!url) process.exit(1);

// Derive the address locally. The key is never printed, logged or sent anywhere.
let derived: Hex | undefined;
if (!rawKey) out("INFO  signer key: not configured");
else {
  try {
    derived = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex).address;
    out(`INFO  signer key: configured; derived public address ${derived}`);
  } catch {
    check("signer key format", false, "ETHEREUM_SIGNER_PRIVATE_KEY is not a valid 32-byte hex private key (value not shown)");
  }
}
if (expected) {
  if (!isAddress(expected)) check("expected address", false, "--expect is not a valid address");
  else if (derived) check("signer matches expected address", getAddress(expected) === derived, getAddress(expected) === derived ? "derived address equals the expected address" : "derived address DIFFERS from the expected address");
  else out("INFO  no signer key to compare with the expected address");
}

const client = createPublicClient({ transport: http(url, { timeout: 20_000, retryCount: 1 }) });
const scrub = (e: unknown) => String(e instanceof Error ? e.message : e).split(url).join("<rpc-url>").slice(0, 200);
try {
  const chainId = await client.getChainId();
  check("eth_chainId", chainId === SEPOLIA, `${chainId} (0x${chainId.toString(16)}); required ${SEPOLIA} (0xaa36a7)${chainId === 1 ? " - THIS IS ETHEREUM MAINNET" : ""}`);
  if (chainId !== SEPOLIA) {
    out("STOP  The endpoint is not Sepolia. Nothing else is checked.");
    process.exit(1);
  }
  const head = await client.getBlockNumber();
  check("eth_blockNumber", head > 0n, head.toString());
  const subject = (expected && isAddress(expected) ? getAddress(expected) : derived) as Hex | undefined;
  if (subject) {
    const [balance, nonce] = await Promise.all([client.getBalance({ address: subject }), client.getTransactionCount({ address: subject })]);
    check("eth_getBalance", true, `${subject}: ${(Number(balance) / 1e18).toFixed(6)} ETH (${balance} wei)`);
    check("eth_getTransactionCount", true, `${subject}: ${nonce}`);
  } else out("INFO  no address to query: pass --expect <address> or configure the signer key");
  if (contract) {
    const code = await client.getCode({ address: getAddress(contract) });
    check("EVIDENCE_ANCHOR_CONTRACT_ADDRESS", !!code && code !== "0x", code && code !== "0x" ? `contract code present (${(code.length - 2) / 2} bytes)` : "no contract code at this address on Sepolia");
  } else out("INFO  EVIDENCE_ANCHOR_CONTRACT_ADDRESS: empty (nothing deployed yet)");
} catch (e) {
  check("RPC request", false, scrub(e));
}
process.exit(failed ? 1 : 0);
