import { randomBytes } from "node:crypto";
import { ArkivError } from "./arkiv/errors.js";
import type { ArkivEvidenceInput, ArkivExpected } from "./arkiv/entity.js";
import type { ArkivHealth, ReadBackResult } from "./arkiv/sdk-client.js";
import type { AnchorPayload } from "../types.js";

/**
 * Arkiv: stores one entity of commitments per evidence record and reads it back.
 *
 * An Arkiv anchor is confirmed only when the entity READ BACK from Arkiv matches the record on every field (hash,
 * references, schema version, sequence, owner). Creating an entity is a submission, not a confirmation.
 * `publish` must be idempotent: for evidence that already has an entity it returns that entity and creates nothing.
 */
export interface ArkivClient {
  readonly name: string;
  publish(payload: AnchorPayload, input?: ArkivEvidenceInput): Promise<{ entityKey: string; txHash?: string | null; expiresAtBlock?: string | null; reused?: boolean }>;
  readBack(entityKey: string, expected: ArkivExpected): Promise<ReadBackResult>;
  /** Finds an entity already created for this evidence (reconciliation after a lost database write). */
  findExisting?(expected: ArkivExpected): Promise<string | null>;
  health?(): Promise<ArkivHealth>;
  queryByEvidence?(evidenceId: string): Promise<Array<{ entityKey: string; owner: string }>>;
  queryByIncident?(incidentId: string): Promise<Array<{ entityKey: string; owner: string }>>;
}

export interface AnchorRef {
  evidenceId: string;
  incidentId: string;
  schemaVersion: number;
  sequence: number;
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
  /**
   * `ref` carries the public identifiers a contract call needs (the evidence and incident ids,
   * schema version and chain position). Clients that only put the hash in transaction data may ignore it.
   * Must not send a second transaction for an anchor that already exists on chain.
   */
  submit(contentHash: string, ref?: AnchorRef): Promise<{ txHash: string }>;
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
    if (!this.available) throw new ArkivError("ARKIV_NETWORK", "arkiv unavailable");
    for (const [k, v] of this.entities) if (v.evidenceId === p.evidenceId && v.contentHash === p.contentHash) return { entityKey: k, reused: true };
    const entityKey = `0x${randomBytes(32).toString("hex")}`;
    this.entities.set(entityKey, { ...p });
    return { entityKey, txHash: null, expiresAtBlock: null, reused: false };
  }
  async fetch(key: string) {
    if (!this.available) throw new ArkivError("ARKIV_NETWORK", "arkiv unavailable");
    return this.entities.get(key) ?? null;
  }
  async readBack(key: string, expected: ArkivExpected): Promise<ReadBackResult> {
    const e = await this.fetch(key);
    if (!e) return { outcome: "not_found" };
    if (e.evidenceId !== expected.evidenceId) return { outcome: "mismatch", field: "evidenceRef" };
    if (e.contentHash !== expected.contentHash) return { outcome: "mismatch", field: "evidenceHash" };
    if (e.schemaVersion !== expected.schemaVersion) return { outcome: "mismatch", field: "schemaVersion" };
    if (e.sequence !== expected.sequence) return { outcome: "mismatch", field: "sequence" };
    return { outcome: "match", owner: "in-memory", expiresAtBlock: "0" };
  }
  async findExisting(expected: ArkivExpected) {
    for (const [k, v] of this.entities) if (v.evidenceId === expected.evidenceId && v.contentHash === expected.contentHash) return k;
    return null;
  }
}

export class InMemoryChain implements EthereumAnchorClient {
  readonly name = "in-memory-chain";
  readonly chainId = 11155111;
  readonly contractAddress = null;
  head = 100;
  available = true;
  readonly txs = new Map<string, { data: string; block: number | null; reverted: boolean }>();
  async submit(contentHash: string, _ref?: AnchorRef) {
    void _ref;
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

  async submit(contentHash: string, _ref?: AnchorRef) {
    void _ref;
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
