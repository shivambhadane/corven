import { createPublicClient, createWalletClient, ExpirationTime, type PublicArkivClient, type WalletArkivClient } from "@arkiv-network/sdk";
import { eq } from "@arkiv-network/sdk/query";
import { defineChain, http, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { RABDI_CHAIN_ID, RABDI_EXPLORER, RABDI_RPC_URL, type ArkivConfig } from "./config.js";
import { ArkivError, classifyArkivError } from "./errors.js";
import { buildEntityValues, compareEntity, EvidenceEntity, refOf, type ArkivEvidenceInput, type ArkivExpected } from "./entity.js";

export type LogFn = (event: string, fields: Record<string, string | number | boolean | null>) => void;

export interface ArkivHealth {
  provider: "arkiv";
  network: "rabdi";
  /** The chain id the endpoint reported, or null if it did not answer. */
  chainId: number | null;
  connected: boolean;
  /** True only when an access key was sent and the endpoint accepted it. False on the public endpoint. */
  authenticated: boolean;
  publicEndpoint: boolean;
  /** operational: answered, right chain, key accepted (or public mode). */
  state: "operational" | "unavailable" | "auth_failed" | "wrong_network";
  blockNumber: number | null;
  signerAddress: string | null;
  /** tGLM balance of the signer in wei, as a decimal string, or null. */
  signerBalanceWei: string | null;
  canWrite: boolean;
  checkedAt: string;
  errorCode: string | null;
  explorer: string;
}

export type ReadBackResult =
  | { outcome: "match"; owner: string; expiresAtBlock: string }
  | { outcome: "mismatch"; field: string }
  | { outcome: "malformed"; field: string }
  | { outcome: "not_found" };

export interface PublishResult {
  entityKey: string;
  txHash: string | null;
  /** The block at which the entity expires, as the chain recorded it. */
  expiresAtBlock: string | null;
  /** True when an entity for this evidence already existed and was reused: nothing was created. */
  reused: boolean;
}

const TIMEOUT_MS = 15_000;
/** ~180 days. Entities expire; the chain allows at most ~182. Extending an entity is a separate, documented gap. */
const LIFETIME_DAYS = 180;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * The real Arkiv integration, over the official SDK (@arkiv-network/sdk 1.0.x) on the Rabdi DB-Chain.
 *
 * - The access key travels in the X-API-KEY header (never in a URL), so it cannot leak through URLs in SDK or transport errors.
 * - Only the Rabdi endpoint is contacted; the host is fixed by configuration validation.
 * - `publish` first asks the chain whether this evidence already has an entity owned by the signer, and reuses it:
 *   a retry, a restart or a lost database write cannot create a second entity.
 * - Everything leaving this class is a classified ArkivError with a generic message.
 */
export class SdkArkivClient {
  readonly name = "arkiv-sdk-rabdi";
  private readonly pub: PublicArkivClient;
  private readonly wallet: WalletArkivClient | null;
  private readonly account: PrivateKeyAccount | null;
  private readonly accessKey: string;
  private readonly fetchImpl: FetchLike;
  private lastHealth: ArkivHealth | null = null;

  constructor(private readonly cfg: ArkivConfig, private readonly opts: { fetch?: FetchLike; log?: LogFn } = {}) {
    this.accessKey = cfg.accessKey;
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    const chain = defineChain({ id: RABDI_CHAIN_ID, name: "Rabdi", nativeCurrency: { name: "Golem", symbol: "tGLM", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } }, blockExplorers: { default: { name: "Rabdi Explorer", url: RABDI_EXPLORER } }, testnet: true });
    const transport = http(cfg.rpcUrl, { timeout: TIMEOUT_MS, retryCount: 0, fetchOptions: { headers: this.authHeaders() } });
    this.pub = createPublicClient({ chain, transport, cacheTime: 0 });
    this.account = cfg.signerPrivateKey ? privateKeyToAccount(cfg.signerPrivateKey) : null;
    this.wallet = this.account ? createWalletClient({ chain, transport, account: this.account }) : null;
  }

  get signerAddress(): string | null {
    return this.account?.address ?? null;
  }
  get canWrite(): boolean {
    return this.wallet !== null;
  }
  get health_(): ArkivHealth | null {
    return this.lastHealth;
  }

  // ------------------------------------------------------------------ health

  /** A real round trip: chain id, block number, and (if a signer is configured) its tGLM balance. Configuration alone is never "healthy". */
  async health(): Promise<ArkivHealth> {
    const base: ArkivHealth = {
      provider: "arkiv", network: "rabdi", chainId: null, connected: false, authenticated: false, publicEndpoint: this.cfg.publicEndpoint, state: "unavailable", blockNumber: null,
      signerAddress: this.signerAddress, signerBalanceWei: null, canWrite: this.canWrite, checkedAt: new Date().toISOString(), errorCode: null, explorer: RABDI_EXPLORER,
    };
    try {
      const chainHex = await this.rpc<string>("eth_chainId");
      const chainId = Number.parseInt(chainHex, 16);
      base.chainId = Number.isFinite(chainId) ? chainId : null;
      base.connected = true;
      if (chainId !== RABDI_CHAIN_ID) return this.done({ ...base, state: "wrong_network", errorCode: "ARKIV_WRONG_NETWORK" });
      const head = await this.rpc<string>("eth_blockNumber");
      if (!/^0x[0-9a-f]+$/i.test(head)) return this.done({ ...base, errorCode: "ARKIV_UNKNOWN" });
      base.blockNumber = Number.parseInt(head, 16);
      base.authenticated = !this.cfg.publicEndpoint; // an invalid key is answered with 401, so a successful answer WITH a key means it was accepted
      if (this.account) base.signerBalanceWei = (await this.pub.getBalance({ address: this.account.address })).toString();
      return this.done({ ...base, state: "operational" });
    } catch (e) {
      const err = classifyArkivError(e);
      return this.done({ ...base, state: err.code === "ARKIV_AUTH_FAILED" ? "auth_failed" : "unavailable", errorCode: err.code, authenticated: false });
    }
  }

  private done(h: ArkivHealth): ArkivHealth {
    this.lastHealth = h;
    this.opts.log?.("arkiv.health", { state: h.state, chainId: h.chainId, authenticated: h.authenticated, errorCode: h.errorCode });
    return h;
  }

  // ------------------------------------------------------------------ write

  async publish(_payload: unknown, input?: ArkivEvidenceInput): Promise<PublishResult> {
    if (!input) throw new ArkivError("ARKIV_INVALID_ENTITY", "The entity inputs (references, previous hash, creation time) are required");
    const values = buildEntityValues(input); // validates before anything leaves CORVEN
    if (!this.wallet || !this.account) throw new ArkivError("ARKIV_NOT_CONFIGURED", "No Arkiv signer is configured; CORVEN cannot create entities");
    try {
      await this.assertNetwork();
      const existing = await this.findEntities(input);
      if (existing.length > 0) {
        // Never a second entity for the same evidence. If the one that exists says something else, that is a hard error.
        for (const row of existing) {
          const cmp = compareEntity(row, input);
          if (cmp.outcome === "match") {
            this.opts.log?.("arkiv.publish.reused", { evidenceRef: values.evidenceRef });
            return { entityKey: String(row.$key), txHash: null, expiresAtBlock: row.$expiresAt !== undefined ? String(row.$expiresAt) : null, reused: true };
          }
        }
        throw new ArkivError("ARKIV_READBACK_MISMATCH", "An entity for this evidence already exists on Arkiv with different content");
      }
      const r = await this.wallet.createEntity(EvidenceEntity, values, { expiration: ExpirationTime.fromDays(LIFETIME_DAYS) });
      this.opts.log?.("arkiv.publish.created", { evidenceRef: values.evidenceRef, entityKey: r.entityKey });
      return { entityKey: r.entityKey, txHash: r.txHash, expiresAtBlock: r.expiresAt !== undefined ? String(r.expiresAt) : null, reused: false };
    } catch (e) {
      const err = classifyArkivError(e);
      this.opts.log?.("arkiv.publish.failed", { evidenceRef: values.evidenceRef, errorCode: err.code });
      throw err;
    }
  }

  // ------------------------------------------------------------------ read

  /** Finds the entity (or entities) this signer already created for the evidence. Used for idempotency and for reconciliation after a lost write. */
  async findExisting(expected: ArkivExpected): Promise<string | null> {
    try {
      const rows = await this.findEntities(expected);
      for (const row of rows) if (compareEntity(row, expected).outcome === "match") return String(row.$key);
      return null;
    } catch (e) {
      throw classifyArkivError(e);
    }
  }

  /** Finds entities by the evidence reference (any owner) for verification and audit. Rows are untrusted data. */
  async queryByEvidence(evidenceId: string): Promise<Array<{ entityKey: string; owner: string }>> {
    return this.queryRef("evidenceRef", refOf("evidence", evidenceId));
  }
  async queryByIncident(incidentId: string): Promise<Array<{ entityKey: string; owner: string }>> {
    return this.queryRef("incidentRef", refOf("incident", incidentId));
  }

  /**
   * Retrieves the entity again and compares every field with what CORVEN expects. `match` also requires that the
   * entity is owned by this deployment's signer when one is configured. Transport and authentication problems throw.
   */
  async readBack(entityKey: string, expected: ArkivExpected): Promise<ReadBackResult> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(entityKey)) return { outcome: "malformed", field: "entityKey" };
    try {
      const row = (await this.pub.getEntity(entityKey as Hex, EvidenceEntity)) as unknown as Record<string, unknown>;
      const cmp = compareEntity(row, expected);
      if (cmp.outcome !== "match") return cmp;
      const owner = String(row.$owner ?? "");
      if (this.account && owner.toLowerCase() !== this.account.address.toLowerCase()) return { outcome: "mismatch", field: "owner" };
      return { outcome: "match", owner, expiresAtBlock: String(row.$expiresAt ?? "") };
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (name === "NoEntityFoundError") return { outcome: "not_found" };
      if (name === "SchemaMismatchError") return { outcome: "malformed", field: "schema" };
      throw classifyArkivError(e);
    }
  }

  // ------------------------------------------------------------------ internals

  private async queryRef(col: "evidenceRef" | "incidentRef", value: string) {
    try {
      const r = await this.pub.select({ $key: true, $owner: true }).from(EvidenceEntity).where(eq(col, value)).limit(50).fetch();
      return (r.entities as Array<{ $key: string; $owner: string }>).map((x) => ({ entityKey: String(x.$key), owner: String(x.$owner) }));
    } catch (e) {
      throw classifyArkivError(e);
    }
  }

  /**
   * Entities this signer already created for the evidence. Deliberately cheap: one keys-only query (limit 3), then a direct
   * read of each candidate, because the key-less public endpoint has a small query budget and wide selects spend it quickly.
   */
  private async findEntities(i: ArkivExpected) {
    const ref = refOf("evidence", i.evidenceId);
    let q = this.pub.select({ $key: true }).from(EvidenceEntity).where(eq("evidenceRef", ref)).limit(3);
    if (this.account) q = q.ownedBy(this.account.address);
    const keys = ((await q.fetch()).entities as unknown as Array<{ $key: string }>).map((e) => String(e.$key));
    const rows: Array<Record<string, unknown>> = [];
    for (const key of keys) {
      try {
        rows.push((await this.pub.getEntity(key as Hex, EvidenceEntity)) as unknown as Record<string, unknown>);
      } catch (e) {
        if ((e as { name?: string }).name === "NoEntityFoundError") continue; // expired or deleted between the query and the read
        throw e;
      }
    }
    return rows;
  }

  private async assertNetwork(): Promise<void> {
    const id = await this.pub.getChainId();
    if (id !== RABDI_CHAIN_ID) throw new ArkivError("ARKIV_WRONG_NETWORK", "The endpoint is not the Rabdi DB-Chain");
  }

  private authHeaders(): Record<string, string> {
    return this.accessKey ? { "X-API-KEY": this.accessKey } : {};
  }

  private async rpc<T>(method: string): Promise<T> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(this.cfg.rpcUrl, { method: "POST", headers: { "content-type": "application/json", ...this.authHeaders() }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }), signal: ctl.signal });
      if (!res.ok) throw Object.assign(new Error("rpc"), { status: res.status });
      const body = (await res.json()) as { result?: T; error?: { message?: string } };
      if (body.error || body.result === undefined) throw Object.assign(new Error("rpc"), { status: 502 });
      return body.result;
    } catch (e) {
      throw classifyArkivError(e);
    } finally {
      clearTimeout(t);
    }
  }
}

export { RABDI_RPC_URL };
