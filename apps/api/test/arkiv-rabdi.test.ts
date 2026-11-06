/**
 * REAL INTEGRATION TESTS against the Arkiv Rabdi DB-Chain public testnet, through the official SDK. No mocks of Arkiv.
 *
 * They create a handful of tiny entities (a few thousandths of a tGLM, about 6 seconds each) and are therefore opt-in:
 *
 *   ARKIV_RABDI_TESTS=1 ARKIV_NETWORK=rabdi ARKIV_SIGNER_PRIVATE_KEY=0x... \
 *     [ARKIV_ACCESS_KEY=...  |  ARKIV_ALLOW_PUBLIC_ENDPOINT=true] pnpm vitest run test/arkiv-rabdi.test.ts
 *
 * Without ARKIV_RABDI_TESTS=1 the suite is SKIPPED, by name; it does not pass silently. The signer must hold test tGLM.
 * Test records contain only random identifiers and a hash of random bytes.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createPublicClient } from "@arkiv-network/sdk";
import { defineChain, http } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadArkivConfig, RABDI_CHAIN_ID, RABDI_RPC_URL, type ArkivConfig } from "../src/modules/evidence-service/adapters/arkiv/config.js";
import type { ArkivEvidenceInput } from "../src/modules/evidence-service/adapters/arkiv/entity.js";
import { SdkArkivClient } from "../src/modules/evidence-service/adapters/arkiv/sdk-client.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

const enabled = process.env.ARKIV_RABDI_TESTS === "1";
const state = loadArkivConfig(process.env);
const cfg: ArkivConfig | null = state.state === "configured" && state.config.signerPrivateKey ? state.config : null;
const runnable = enabled && cfg !== null;
const d = describe.skipIf(!runnable);
if (!runnable) {
  describe("Rabdi integration (SKIPPED)", () => {
    it.skip(`not run: ${!enabled ? "set ARKIV_RABDI_TESTS=1" : state.state !== "configured" ? `Arkiv is ${state.state}` : "ARKIV_SIGNER_PRIVATE_KEY is empty"}`, () => undefined);
  });
}

const fresh = (over: Partial<ArkivEvidenceInput> = {}): ArkivEvidenceInput => ({
  evidenceId: randomUUID(), incidentId: randomUUID(), organizationId: randomUUID(), contentHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
  previousHash: null, schemaVersion: 1, sequence: 1, createdAt: new Date().toISOString(), ...over,
});

let c: SdkArkivClient;
beforeAll(() => {
  if (cfg) c = new SdkArkivClient(cfg);
});

d("Arkiv Rabdi: connectivity and authentication", () => {
  it("answers with chain id 7794095 and a valid hexadecimal block number", async () => {
    const h: Record<string, string> = { "content-type": "application/json", ...(cfg!.accessKey ? { "X-API-KEY": cfg!.accessKey } : {}) };
    const rpc = async (method: string) => ((await (await fetch(RABDI_RPC_URL, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }) })).json()) as { result: string }).result;
    expect(Number.parseInt(await rpc("eth_chainId"), 16)).toBe(RABDI_CHAIN_ID);
    expect(await rpc("eth_blockNumber")).toMatch(/^0x[0-9a-f]+$/);
  }, 60_000);

  it("the SDK health check reports an operational Rabdi connection", async () => {
    const hl = await c.health();
    expect(hl).toMatchObject({ provider: "arkiv", network: "rabdi", chainId: RABDI_CHAIN_ID, connected: true, state: "operational", errorCode: null, canWrite: true, publicEndpoint: cfg!.publicEndpoint });
    expect(hl.blockNumber).toBeGreaterThan(0);
    expect(BigInt(hl.signerBalanceWei!)).toBeGreaterThan(0n);
    expect(hl.authenticated).toBe(!cfg!.publicEndpoint);
    expect(JSON.stringify(hl)).not.toContain(cfg!.accessKey || "no-key-configured");
  }, 60_000);

  it("an invalid access key is rejected by Rabdi and reported as an authentication failure", async () => {
    const bad = new SdkArkivClient({ ...cfg!, accessKey: "invalid-key-for-test", publicEndpoint: false });
    const hl = await bad.health();
    expect(hl).toMatchObject({ state: "auth_failed", authenticated: false, errorCode: "ARKIV_AUTH_FAILED" });
    await expect(bad.readBack(`0x${"11".repeat(32)}`, fresh())).rejects.toMatchObject({ code: "ARKIV_AUTH_FAILED", retryable: false });
    await expect(bad.publish({}, fresh())).rejects.toMatchObject({ code: "ARKIV_AUTH_FAILED", retryable: false });
  }, 60_000);

  it("a wallet with no tGLM fails with ARKIV_INSUFFICIENT_FUNDS (no funds are needed to see this)", async () => {
    const broke = new SdkArkivClient({ ...cfg!, signerPrivateKey: generatePrivateKey() });
    await expect(broke.publish({}, fresh())).rejects.toMatchObject({ code: "ARKIV_INSUFFICIENT_FUNDS", retryable: true });
  }, 90_000);

  it("an unreachable network is reported as unavailable, not as success", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("connect ECONNREFUSED"); });
    try {
      const down = new SdkArkivClient(cfg!);
      expect(await down.health()).toMatchObject({ state: "unavailable", connected: false, errorCode: "ARKIV_NETWORK" });
    } finally { vi.unstubAllGlobals(); }
  });
});

d("Arkiv Rabdi: entity creation, retrieval and read-back", () => {
  const input = fresh();
  let entityKey = "";

  it("creates a real entity and returns its key, transaction and expiry", async () => {
    const r = await c.publish({}, input);
    expect(r).toMatchObject({ reused: false });
    expect(r.entityKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Number(r.expiresAtBlock)).toBeGreaterThan((await c.health()).blockNumber!);
    entityKey = r.entityKey;
  }, 120_000);

  it("retrieves it and the read-back matches every field, including the owner", async () => {
    let rb = await c.readBack(entityKey, input);
    for (let i = 0; i < 6 && rb.outcome !== "match"; i++) { await new Promise((r) => setTimeout(r, 2000)); rb = await c.readBack(entityKey, input); } // indexing delay
    expect(rb).toMatchObject({ outcome: "match", owner: c.signerAddress });
  }, 90_000);

  it("a different hash, reference, version or sequence is a mismatch", async () => {
    expect(await c.readBack(entityKey, { ...input, contentHash: "cd".repeat(32) })).toEqual({ outcome: "mismatch", field: "evidenceHash" });
    expect(await c.readBack(entityKey, { ...input, incidentId: randomUUID() })).toEqual({ outcome: "mismatch", field: "incidentRef" });
    expect(await c.readBack(entityKey, { ...input, sequence: 2 })).toEqual({ outcome: "mismatch", field: "sequence" });
    expect(await c.readBack(entityKey, { ...input, schemaVersion: 2 })).toEqual({ outcome: "mismatch", field: "schemaVersion" });
  }, 90_000);

  it("a key that does not exist is not_found", async () => {
    expect(await c.readBack(`0x${"11".repeat(32)}`, input)).toEqual({ outcome: "not_found" });
    expect(await c.readBack("not-a-key", input)).toMatchObject({ outcome: "malformed" });
  }, 60_000);

  it("is idempotent: publishing the same evidence again reuses the entity and creates nothing", async () => {
    const again = await c.publish({}, input);
    expect(again).toMatchObject({ entityKey, reused: true, txHash: null });
    expect((await c.queryByEvidence(input.evidenceId)).map((x) => x.entityKey)).toEqual([entityKey]);
  }, 120_000);

  it("can be found by evidence reference and by incident reference, and by nothing else", async () => {
    expect(await c.queryByEvidence(input.evidenceId)).toEqual([{ entityKey, owner: c.signerAddress }]);
    expect((await c.queryByIncident(input.incidentId)).map((x) => x.entityKey)).toEqual([entityKey]);
    expect(await c.queryByEvidence(randomUUID())).toEqual([]);
    expect(await c.queryByIncident(randomUUID())).toEqual([]);
  }, 90_000);

  it("stores only commitments on the public chain", async () => {
    const chain = defineChain({ id: RABDI_CHAIN_ID, name: "Rabdi", nativeCurrency: { name: "Golem", symbol: "tGLM", decimals: 18 }, rpcUrls: { default: { http: [RABDI_RPC_URL] } } });
    const pub = createPublicClient({ chain, transport: http(RABDI_RPC_URL, { fetchOptions: { headers: cfg!.accessKey ? { "X-API-KEY": cfg!.accessKey } : {} } }) });
    const raw = JSON.stringify(await pub.getEntity(entityKey as `0x${string}`), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    for (const internal of [input.evidenceId, input.incidentId, input.organizationId]) expect(raw).not.toContain(internal);
    expect(raw).toContain(input.contentHash);
    expect(raw).toContain("corven.evidence.v1");
  }, 60_000);
});

d("Arkiv Rabdi: inside the Evidence Service (real chain, real database)", () => {
  let ctx: TestCtx;
  let api: ReturnType<typeof client>;
  let original: unknown;
  beforeAll(async () => {
    ctx = await createCtx();
    api = client(ctx.app);
    original = ctx.evidenceConfig.arkiv;
    ctx.evidenceConfig.arkiv = c;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    ctx.evidenceConfig.arkiv = original as never;
    await ctx.close();
  });

  async function evidence() {
    const op = who("operator");
    const admin = who("admin", op.org);
    const inc = (await api.post("/api/v1/incidents", op, { title: "Rabdi integration", description: "PRIVATE-DESCRIPTION", severity: "low" })).body.data;
    const e = (await api.post("/api/v1/evidence/generate", op, { incidentId: inc.id })).body.data;
    return { op, admin, inc, e };
  }
  const arkivAnchor = async (w: ReturnType<typeof who>, id: string) => (await api.get(`/api/v1/evidence/${id}`, w)).body.data.anchors.find((a: { target: string }) => a.target === "arkiv");

  it("anchors verified evidence: the entity is created, read back, and confirmed with its key persisted", async () => {
    const { op, admin, e } = await evidence();
    const r = await api.post(`/api/v1/evidence/${e.id}/anchor`, admin, { targets: ["arkiv"] });
    expect(r.status).toBe(202);
    const a = r.body.data.anchors[0];
    expect(a).toMatchObject({ target: "arkiv", status: "confirmed", chainId: RABDI_CHAIN_ID, anchoredHash: e.contentHash, errorCode: null, attempts: 1 });
    expect(a.externalReference).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.externalTx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.externalExpiresBlock).toBeGreaterThan(0);

    // the persisted key really is the entity on Rabdi, and it carries the sealed hash
    expect(await c.readBack(a.externalReference, { evidenceId: e.id, incidentId: e.incidentId, organizationId: op.org, contentHash: e.contentHash, previousHash: e.previousHash, schemaVersion: e.schemaVersion, sequence: e.sequence, createdAt: e.createdAt })).toMatchObject({ outcome: "match" });

    // verification re-reads it; entity retrieval endpoint reports a live match
    expect((await api.post(`/api/v1/evidence/${e.id}/verify`, admin, {})).body.data).toMatchObject({ valid: true });
    expect((await api.get(`/api/v1/evidence/${e.id}/arkiv`, op)).body.data).toMatchObject({ anchor: { status: "confirmed" }, live: { outcome: "match" } });
    expect((await api.get(`/api/v1/evidence/arkiv/stats`, op)).body.data.confirmed).toBeGreaterThanOrEqual(1);

    // duplicate prevention against the real chain
    const before = (await c.queryByEvidence(e.id)).length;
    await api.post(`/api/v1/evidence/${e.id}/anchor`, admin, { targets: ["arkiv"] });
    await ctx.app.evidence.evidence.runMaintenance();
    expect(before).toBe(1);
    expect((await c.queryByEvidence(e.id)).length).toBe(1);
  }, 180_000);

  it("recovers from a lost database write after the real entity was created, without a second entity", async () => {
    const { admin, e } = await evidence();
    const repo = ctx.app.evidence.repo;
    const real = repo.markAnchor.bind(repo);
    let first = true;
    vi.spyOn(repo, "markAnchor").mockImplementation(async (...args) => {
      if (first) { first = false; throw new Error("database unavailable"); }
      return real(...args);
    });
    await api.post(`/api/v1/evidence/${e.id}/anchor`, admin, { targets: ["arkiv"] });
    expect((await c.queryByEvidence(e.id)).length).toBe(1); // it exists on Rabdi
    expect((await ctx.handle.pool.query("select external_reference from evidence_anchors where evidence_id=$1 and target='arkiv'", [e.id])).rows[0].external_reference).toBeNull(); // but CORVEN lost the key
    ctx.evidenceConfig.now = () => new Date(Date.now() + 5 * 60_000); // the abandoned claim is now stale
    try { await ctx.app.evidence.evidence.runMaintenance(); } finally { ctx.evidenceConfig.now = () => new Date(); }
    expect((await c.queryByEvidence(e.id)).length).toBe(1); // still exactly one
    expect(await arkivAnchor(admin, e.id)).toMatchObject({ status: "confirmed" });
  }, 240_000);

  it("a failed Arkiv call leaves internal evidence valid and does not corrupt it", async () => {
    const { admin, e } = await evidence();
    vi.stubGlobal("fetch", async () => { throw new Error("connect ECONNREFUSED"); });
    let r;
    try {
      const down = new SdkArkivClient(cfg!);
      ctx.evidenceConfig.arkiv = down;
      r = await api.post(`/api/v1/evidence/${e.id}/anchor`, admin, { targets: ["arkiv"] });
    } finally { vi.unstubAllGlobals(); ctx.evidenceConfig.arkiv = c; }
    expect(r.body.data.anchors[0]).toMatchObject({ status: "failed", retryable: true });
    expect(r.body.data.anchors[0].errorCode).toMatch(/ARKIV_(NETWORK|UNKNOWN)/);
    expect((await api.post(`/api/v1/evidence/${e.id}/verify`, admin, {})).body.data.valid).toBe(true);
  }, 120_000);
});

afterAll(() => undefined);
