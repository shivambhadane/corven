import {
  createPublicClient, createWalletClient, defineChain, getAddress, http, keccak256, parseAbi, parseEventLogs, toBytes,
  type Address, type Hex, type PublicClient, type Transport, type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { AnchorRef, EthereumAnchorClient, TxState } from "./anchors.js";

/** The contract's interface, as the client needs it. A test compares it with the compiled artifact so it cannot drift. */
export const EVIDENCE_ANCHOR_ABI = parseAbi([
  "function anchorEvidence(bytes32 evidenceRef, bytes32 incidentRef, bytes32 evidenceHash, uint32 schemaVersion, uint32 sequence)",
  "function getAnchor(bytes32 evidenceRef) view returns ((bytes32 incidentRef, bytes32 evidenceHash, uint32 schemaVersion, uint32 sequence, address anchoredBy, uint64 blockNumber, uint64 timestamp))",
  "function isAnchored(bytes32 evidenceRef) view returns (bool)",
  "function verify(bytes32 evidenceRef, bytes32 evidenceHash) view returns (bool)",
  "function isSigner(address account) view returns (bool)",
  "event EvidenceAnchored(bytes32 indexed evidenceRef, bytes32 indexed incidentRef, bytes32 indexed evidenceHash, uint32 schemaVersion, uint32 sequence, address anchoredBy)",
  "error NotAuthorizedSigner(address caller)",
  "error ZeroValue(string field)",
  "error InvalidVersion(uint32 value)",
  "error EvidenceAlreadyAnchored(bytes32 evidenceRef)",
  "error HashAlreadyAnchored(bytes32 evidenceHash, bytes32 existingEvidenceRef)",
]);

/** On-chain references are domain-separated commitments, so a reviewer holding the uuid can recompute them. */
export const evidenceRef = (evidenceId: string): Hex => keccak256(toBytes(`corven.evidence.v1:${evidenceId.toLowerCase()}`));
export const incidentRef = (incidentId: string): Hex => keccak256(toBytes(`corven.incident.v1:${incidentId.toLowerCase()}`));
const asHash = (h: string): Hex => (`0x${h.replace(/^0x/, "").toLowerCase()}` as Hex);

export interface ViemAnchorConfig {
  /** An http(s) JSON-RPC URL. Never logged or included in errors. */
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  /** 32-byte hex private key. Without it the client can read but not submit. Never logged, serialized or included in errors. */
  privateKey?: string | undefined;
  /** For tests: a custom transport instead of http(rpcUrl). */
  transport?: Transport;
}

const MAINNET = 1;

/**
 * Anchors evidence hashes in the EvidenceAnchor contract and reports the truth about them.
 *
 *  - It refuses Ethereum mainnet, and refuses to talk to an endpoint whose chain id differs from the configured one.
 *  - `submit` never sends a second transaction for an anchor that already exists on chain, simulates the call first
 *    (so a call that would revert costs nothing), and returns only a transaction hash. A hash is a submission, not an anchor.
 *  - `status` reports mined / reverted / pending, the confirmation count, and whether the hash is present in an
 *    `EvidenceAnchored` event emitted BY THE CONFIGURED CONTRACT in a SUCCESSFUL transaction to it. A transfer, a call to another
 *    contract, or a reverted call that merely contains the hash does not count.
 */
export class ViemEthereumAnchor implements EthereumAnchorClient {
  readonly name = "viem-evidence-anchor";
  readonly chainId: number;
  readonly contractAddress: string;
  private readonly contract: Address;
  private readonly rpcUrl: string;
  private readonly pub: PublicClient;
  private readonly wallet: WalletClient | null;
  private readonly account: PrivateKeyAccount | null;
  private networkChecked = false;

  constructor(cfg: ViemAnchorConfig) {
    if (cfg.chainId === MAINNET) throw new Error("Ethereum mainnet is not supported: CORVEN anchors only on Sepolia or a local chain");
    if (!Number.isInteger(cfg.chainId) || cfg.chainId <= 0) throw new Error("A valid chain id is required");
    this.chainId = cfg.chainId;
    this.rpcUrl = cfg.rpcUrl;
    this.contract = getAddress(cfg.contractAddress);
    this.contractAddress = this.contract;
    const chain = defineChain({ id: cfg.chainId, name: `chain-${cfg.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } });
    const transport = cfg.transport ?? http(cfg.rpcUrl, { timeout: 20_000, retryCount: 1 });
    // cacheTime 0: viem otherwise caches eth_blockNumber for seconds, which would make confirmation counts stale.
    this.pub = createPublicClient({ chain, transport, cacheTime: 0 });
    this.account = cfg.privateKey ? this.parseKey(cfg.privateKey) : null;
    this.wallet = this.account ? createWalletClient({ chain, transport, account: this.account }) : null;
  }

  /** The public address of the signer, or null when no key is configured. */
  get signerAddress(): Address | null {
    return this.account?.address ?? null;
  }

  async submit(contentHash: string, ref?: AnchorRef): Promise<{ txHash: string }> {
    if (!this.wallet || !this.account) throw new Error("No signer is configured; CORVEN cannot submit anchor transactions");
    if (!ref) throw new Error("An anchor needs the evidence id, incident id, schema version and sequence");
    return this.guard(async () => {
      await this.assertNetwork();
      const hash = asHash(contentHash);
      const eRef = evidenceRef(ref.evidenceId);

      // Idempotency: if this evidence is already anchored, never send another transaction. Return the one that did it.
      const existing = await this.pub.readContract({ address: this.contract, abi: EVIDENCE_ANCHOR_ABI, functionName: "getAnchor", args: [eRef] });
      if (existing.evidenceHash !== `0x${"0".repeat(64)}`) {
        if (existing.evidenceHash.toLowerCase() !== hash.toLowerCase()) throw new Error("This evidence reference is already anchored with a DIFFERENT hash; refusing to continue");
        const logs = await this.pub.getLogs({ address: this.contract, event: EVIDENCE_ANCHOR_ABI[5], args: { evidenceRef: eRef }, fromBlock: BigInt(existing.blockNumber), toBlock: BigInt(existing.blockNumber) });
        const tx = logs[0]?.transactionHash;
        if (!tx) throw new Error("The evidence is already anchored but its transaction could not be located");
        return { txHash: tx };
      }

      const args = [eRef, incidentRef(ref.incidentId), hash, ref.schemaVersion, ref.sequence] as const;
      // A dry run (eth_call): a call that would revert (unauthorised signer, duplicate hash...) fails here and spends nothing.
      await this.pub.simulateContract({ address: this.contract, abi: EVIDENCE_ANCHOR_ABI, functionName: "anchorEvidence", args, account: this.account });
      const txHash = await this.wallet!.writeContract({ address: this.contract, abi: EVIDENCE_ANCHOR_ABI, functionName: "anchorEvidence", args, account: this.account!, chain: this.wallet!.chain });
      return { txHash };
    });
  }

  async status(txHash: string) {
    return this.guard(async () => {
      const hash = txHash as Hex;
      const [tx, receipt, head] = await Promise.all([
        this.pub.getTransaction({ hash }).catch(notFoundAsNull),
        this.pub.getTransactionReceipt({ hash }).catch(notFoundAsNull),
        this.pub.getBlockNumber(),
      ]);
      if (!tx) return { state: "not_found" as TxState, blockNumber: null, confirmations: 0, dataContainsHash: () => false };
      if (!receipt) return { state: "pending" as TxState, blockNumber: null, confirmations: 0, dataContainsHash: () => false };

      const blockNumber = Number(receipt.blockNumber);
      const confirmations = Number(head - receipt.blockNumber) + 1;
      const ok = receipt.status === "success" && receipt.to?.toLowerCase() === this.contract.toLowerCase();
      const anchored = ok
        ? new Set(parseEventLogs({ abi: EVIDENCE_ANCHOR_ABI, eventName: "EvidenceAnchored", logs: receipt.logs.filter((l) => l.address.toLowerCase() === this.contract.toLowerCase()) }).map((l) => (l.args.evidenceHash as string).toLowerCase()))
        : new Set<string>();
      return {
        state: (receipt.status === "success" ? "mined" : "reverted") as TxState,
        blockNumber,
        confirmations,
        dataContainsHash: (h: string) => anchored.has(asHash(h)),
      };
    });
  }

  /** Reads the contract itself: is this evidence anchored under exactly this hash? Independent of any transaction. */
  async verifyOnChain(evidenceId: string, contentHash: string): Promise<boolean> {
    return this.guard(async () => {
      await this.assertNetwork();
      return this.pub.readContract({ address: this.contract, abi: EVIDENCE_ANCHOR_ABI, functionName: "verify", args: [evidenceRef(evidenceId), asHash(contentHash)] });
    });
  }

  /** Whether the configured signer is currently authorised on the contract (a read; sends nothing). */
  async signerIsAuthorized(): Promise<boolean> {
    if (!this.account) return false;
    return this.guard(async () => {
      await this.assertNetwork();
      return this.pub.readContract({ address: this.contract, abi: EVIDENCE_ANCHOR_ABI, functionName: "isSigner", args: [this.account!.address] });
    });
  }

  // ------------------------------------------------------------------ internals

  private async assertNetwork(): Promise<void> {
    if (this.networkChecked) return;
    const actual = await this.pub.getChainId();
    if (actual !== this.chainId) throw new Error(`The RPC endpoint reports chain id ${actual}, expected ${this.chainId}; refusing to continue`);
    const code = await this.pub.getCode({ address: this.contract });
    if (!code || code === "0x") throw new Error("No contract code at the configured address on this chain");
    this.networkChecked = true;
  }

  private parseKey(key: string): PrivateKeyAccount {
    const k = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("The configured signer key is not a 32-byte hex private key");
    return privateKeyToAccount(k);
  }

  /** Library errors can embed the RPC URL or request bodies. Everything leaving this class is reduced to a short, scrubbed message. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const raw = e as { shortMessage?: string; message?: string; cause?: { data?: { errorName?: string } }; name?: string };
      const named = raw.cause?.data?.errorName;
      let msg = named ? `Contract reverted: ${named}` : (raw.shortMessage ?? raw.message ?? "request failed");
      for (const secret of [this.rpcUrl]) if (secret) msg = msg.split(secret).join("<rpc-url>");
      msg = msg.replace(/https?:\/\/\S+/g, "<url>").replace(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, (m, off: number, all: string) => (all.slice(Math.max(0, off - 14), off).toLowerCase().includes("hash") ? m : "<hex32>")).split("\n")[0]!.slice(0, 240);
      throw new Error(msg);
    }
  }
}


const notFoundAsNull = (e: unknown): null => {
  const name = (e as { name?: string }).name ?? "";
  if (name === "TransactionNotFoundError" || name === "TransactionReceiptNotFoundError") return null;
  throw e;
};

export type EthereumConfigState =
  | { state: "disabled"; reason: string }
  | { state: "not_configured"; missing: string[]; reason: string }
  | { state: "configured"; client: ViemEthereumAnchor };

export function loadEthereumConfig(env: Record<string, string | undefined>): EthereumConfigState {
  if (env.ETHEREUM_ENABLED?.trim().toLowerCase() === "false") return { state: "disabled", reason: "ETHEREUM_ENABLED=false" };
  const rpcUrl = (env.ETHEREUM_SEPOLIA_RPC_URL ?? env.ETHEREUM_RPC_URL ?? "").trim();
  const contractAddress = (env.EVIDENCE_ANCHOR_CONTRACT_ADDRESS ?? env.ETHEREUM_CONTRACT ?? "").trim();
  const chainId = env.ETHEREUM_CHAIN_ID ? Number(env.ETHEREUM_CHAIN_ID) : 11155111;
  const privateKey = (env.ETHEREUM_SIGNER_PRIVATE_KEY ?? "").trim() || undefined;

  const missing: string[] = [];
  if (!rpcUrl) missing.push("ETHEREUM_SEPOLIA_RPC_URL");
  if (!contractAddress) missing.push("EVIDENCE_ANCHOR_CONTRACT_ADDRESS");
  if (missing.length > 0) {
    return { state: "not_configured", missing, reason: `Missing Ethereum configuration: ${missing.join(", ")}` };
  }

  try {
    const client = new ViemEthereumAnchor({ rpcUrl, chainId, contractAddress, privateKey });
    return { state: "configured", client };
  } catch (e) {
    return { state: "not_configured", missing: [], reason: (e as Error).message };
  }
}
