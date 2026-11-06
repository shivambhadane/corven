import { randomBytes } from "node:crypto";
import type { AnchorPayload } from "../types.js";

/**
 * Arkiv: publishes the anchor payload as an entity and reads it back. The
 * service counts an Arkiv anchor as confirmed only when the record it reads back
 * carries the same content hash.
 */
export interface ArkivClient {
  readonly name: string;
  publish(payload: AnchorPayload): Promise<{ entityKey: string }>;
  fetch(entityKey: string): Promise<AnchorPayload | null>;
}

export type TxState = "pending" | "mined" | "reverted" | "not_found";

/**
 * Ethereum: submits a transaction whose data carries the content hash, and reports
 * its state. Anchored means mined, successful, carrying the hash, and buried
 * under the required number of confirmations; a submitted transaction is not.
 */
export interface EthereumAnchorClient {
  readonly name: string;
  readonly chainId: number;
  readonly contractAddress: string | null;
  submit(contentHash: string): Promise<{ txHash: string }>;
  status(txHash: string): Promise<{ state: TxState; blockNumber: number | null; confirmations: number; dataContainsHash: (hash: string) => boolean }>;
}

// ---------------------------------------------------------------------------
// Test doubles. They are NOT integrations: nothing leaves the process.
// ---------------------------------------------------------------------------

export class InMemoryArkiv implements ArkivClient {
  readonly name = "in-memory-arkiv";
  readonly entities = new Map<string, AnchorPayload>();
  available = true;
  async publish(p: AnchorPayload) {
    if (!this.available) throw new Error("arkiv unavailable");
    const entityKey = `0x${randomBytes(32).toString("hex")}`;
    this.entities.set(entityKey, { ...p });
    return { entityKey };
  }
  async fetch(key: string) {
    if (!this.available) throw new Error("arkiv unavailable");
    return this.entities.get(key) ?? null;
  }
}

export class InMemoryChain implements EthereumAnchorClient {
  readonly name = "in-memory-chain";
  readonly chainId = 11155111;
  readonly contractAddress = null;
  head = 100;
  available = true;
  readonly txs = new Map<string, { data: string; block: number | null; reverted: boolean }>();
  async submit(contentHash: string) {
    if (!this.available) throw new Error("rpc unavailable");
    const txHash = `0x${randomBytes(32).toString("hex")}`;
    this.txs.set(txHash, { data: `0x${contentHash}`, block: null, reverted: false });
    return { txHash };
  }
  /** Includes every pending transaction in the next block, then adds `extra` empty blocks. */
  mine(extra = 0) {
    this.head++;
    for (const tx of this.txs.values()) if (tx.block === null) tx.block = this.head;
    this.head += extra;
  }
  revert(txHash: string) {
    const t = this.txs.get(txHash);
    if (t) {
      t.reverted = true;
      t.block ??= ++this.head;
    }
  }
  async status(txHash: string) {
    if (!this.available) throw new Error("rpc unavailable");
    const t = this.txs.get(txHash);
    const data = t?.data ?? "";
    const dataContainsHash = (h: string) => data.toLowerCase().includes(h.toLowerCase());
    if (!t) return { state: "not_found" as const, blockNumber: null, confirmations: 0, dataContainsHash };
    if (t.block === null) return { state: "pending" as const, blockNumber: null, confirmations: 0, dataContainsHash };
    return { state: t.reverted ? ("reverted" as const) : ("mined" as const), blockNumber: t.block, confirmations: this.head - t.block + 1, dataContainsHash };
  }
}

// ---------------------------------------------------------------------------
// Real, read-only Ethereum access over standard JSON-RPC (no dependencies).
// Submitting needs a transaction signer; without one, submit fails and the
// anchor is recorded as failed. It is never reported as anchored.
// ---------------------------------------------------------------------------

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export class JsonRpcEthereumAnchor implements EthereumAnchorClient {
  readonly name = "json-rpc";
  constructor(
    private readonly rpcUrl: string,
    readonly chainId: number,
    readonly contractAddress: string | null,
    private readonly signer: ((contentHash: string) => Promise<string>) | null = null,
    private readonly fetchImpl: Fetch = globalThis.fetch as unknown as Fetch,
  ) {}

  async submit(contentHash: string) {
    if (!this.signer) throw new Error("No transaction signer is configured; CORVEN cannot submit anchor transactions");
    return { txHash: await this.signer(contentHash) };
  }

  async status(txHash: string) {
    const [receipt, tx, head] = await Promise.all([this.call("eth_getTransactionReceipt", [txHash]), this.call("eth_getTransactionByHash", [txHash]), this.call("eth_blockNumber", [])]);
    const input = String((tx as { input?: string } | null)?.input ?? "").toLowerCase();
    const dataContainsHash = (h: string) => input.includes(h.toLowerCase());
    if (!tx) return { state: "not_found" as const, blockNumber: null, confirmations: 0, dataContainsHash };
    if (!receipt) return { state: "pending" as const, blockNumber: null, confirmations: 0, dataContainsHash };
    const r = receipt as { status?: string; blockNumber?: string };
    const block = parseInt(r.blockNumber ?? "0x0", 16);
    const confirmations = parseInt(String(head), 16) - block + 1;
    return { state: r.status === "0x1" ? ("mined" as const) : ("reverted" as const), blockNumber: block, confirmations, dataContainsHash };
  }

  private async call(method: string, params: unknown[]): Promise<unknown> {
    const res = await this.fetchImpl(this.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (!res.ok) throw new Error(`RPC ${method} failed`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`RPC ${method}: ${body.error.message ?? "error"}`);
    return body.result ?? null;
  }
}
