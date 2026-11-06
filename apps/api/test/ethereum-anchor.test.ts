import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createPublicClient, createWalletClient, decodeFunctionData, defineChain, encodeFunctionData, http, toFunctionSelector, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVIDENCE_ANCHOR_ABI, evidenceRef, incidentRef, ViemEthereumAnchor } from "../src/modules/evidence-service/adapters/viem-ethereum.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

const ARTIFACT = fileURLToPath(new URL("../../../contracts/out/EvidenceAnchor.sol/EvidenceAnchor.json", import.meta.url));
const haveArtifact = existsSync(ARTIFACT);
const haveAnvil = (() => {
  try {
    return spawn("anvil", ["--version"]).pid !== undefined;
  } catch {
    return false;
  }
})();
// This suite needs the compiled contract (`forge build` in contracts/) and the `anvil` binary. When either is missing it is
// skipped LOUDLY by name, not silently passed; CI must build the contract first.
const runnable = haveArtifact && haveAnvil;

const CHAIN_ID = 11155111; // local Anvil is started with Sepolia's chain id so the client's chain checks are exercised for real
const hashA = `0x${"ab".repeat(32)}`;
const hashB = `0x${"cd".repeat(32)}`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let anvil: ChildProcess;
let rpc: string;
let ctx: TestCtx;
let api: ReturnType<typeof client>;

const chain = defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1"] } } });
const raw = async (method: string, params: unknown[] = []) => {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return ((await r.json()) as { result: unknown }).result;
};
const mine = (n: number) => raw("anvil_mine", [`0x${n.toString(16)}`]);

let owner: ReturnType<typeof privateKeyToAccount>;
let signerKey: Hex;
let contract: Hex;
let pub: ReturnType<typeof createPublicClient>;

async function deploy(): Promise<Hex> {
  const art = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { abi: never; bytecode: { object: Hex } };
  const wallet = createWalletClient({ chain: { ...chain, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc), account: owner });
  pub = createPublicClient({ chain, transport: http(rpc) });
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [owner.address, privateKeyToAccount(signerKey).address] });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return rc.contractAddress!;
}
const mk = (over: Partial<ConstructorParameters<typeof ViemEthereumAnchor>[0]> = {}) => new ViemEthereumAnchor({ rpcUrl: rpc, chainId: CHAIN_ID, contractAddress: contract, privateKey: signerKey, ...over });
const ref = (n: number, seq = 1) => ({ evidenceId: uuid(n), incidentId: uuid(900), schemaVersion: 1, sequence: seq });

beforeAll(async () => {
  if (!runnable) return;
  const port = 18_000 + Math.floor(Math.random() * 1000);
  rpc = `http://127.0.0.1:${port}`;
  anvil = spawn("anvil", ["--port", String(port), "--chain-id", String(CHAIN_ID), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await raw("eth_chainId")) === "0xaa36a7") break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  owner = privateKeyToAccount(generatePrivateKey());
  signerKey = generatePrivateKey();
  for (const a of [owner.address, privateKeyToAccount(signerKey).address]) await raw("anvil_setBalance", [a, "0x56BC75E2D63100000"]);
  contract = await deploy();
  ctx = await createCtx();
  api = client(ctx.app);
}, 60_000);
afterAll(async () => {
  anvil?.kill();
  await ctx?.close();
});

describe("references and ABI", () => {
  it("are deterministic, domain-separated and case-insensitive", () => {
    const e = evidenceRef(uuid(1));
    expect(e).toMatch(/^0x[0-9a-f]{64}$/);
    expect(evidenceRef(uuid(1).toUpperCase())).toBe(e);
    expect(evidenceRef(uuid(2))).not.toBe(e);
    expect(incidentRef(uuid(1))).not.toBe(e); // an incident and an evidence record with the same uuid do not collide
  });
  it.skipIf(!haveArtifact)("the client's ABI matches the compiled contract (functions, events, errors)", () => {
    const art = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { abi: Array<{ type: string; name?: string; inputs?: Array<{ type: string }> }> };
    const sig = (x: { name?: string; inputs?: Array<{ type: string }> }) => `${x.name}(${(x.inputs ?? []).map((i) => i.type.replace(/^tuple$/, "tuple")).join(",")})`;
    const compiled = new Set(art.abi.filter((x) => ["function", "event", "error"].includes(x.type)).map((x) => `${x.type}:${sig(x)}`));
    for (const item of EVIDENCE_ANCHOR_ABI) expect(compiled, `${item.type}:${sig(item as never)}`).toContain(`${item.type}:${sig(item as never)}`);
    expect(toFunctionSelector("anchorEvidence(bytes32,bytes32,bytes32,uint32,uint32)")).toBe(encodeFunctionData({ abi: EVIDENCE_ANCHOR_ABI, functionName: "anchorEvidence", args: [hashA as Hex, hashA as Hex, hashA as Hex, 1, 1] }).slice(0, 10));
  });
});

describe("construction and safety", () => {
  it("refuses Ethereum mainnet", () => {
    expect(() => new ViemEthereumAnchor({ rpcUrl: "http://x", chainId: 1, contractAddress: "0x0000000000000000000000000000000000000001" })).toThrow(/mainnet/i);
  });
  it("rejects a malformed key without echoing it", () => {
    const secret = "0x1234";
    try { new ViemEthereumAnchor({ rpcUrl: "http://x", chainId: CHAIN_ID, contractAddress: "0x0000000000000000000000000000000000000001", privateKey: secret }); expect.unreachable(); }
    catch (e) { expect(String(e)).toMatch(/32-byte/); expect(String(e)).not.toContain("1234"); }
  });
  it("exposes only the public address of its signer", () => {
    const key = generatePrivateKey();
    const c = new ViemEthereumAnchor({ rpcUrl: "http://x", chainId: CHAIN_ID, contractAddress: "0x0000000000000000000000000000000000000001", privateKey: key });
    expect(c.signerAddress).toBe(privateKeyToAccount(key).address);
    const dump = (JSON.stringify(c) + String(Object.values(c)) + inspect(c, { depth: 4, showHidden: true })).toLowerCase();
    expect(dump).not.toContain(key.slice(2).toLowerCase()); // the private key does not appear anywhere in the object, even when it is dumped in full
  });
  it.skipIf(!runnable)("cannot submit without a signer or without references", async () => {
    await expect(mk({ privateKey: undefined }).submit(hashA, ref(1))).rejects.toThrow(/No signer/);
    await expect(mk().submit(hashA)).rejects.toThrow(/evidence id/);
  });
  it.skipIf(!runnable)("refuses an endpoint on a different chain or a contract address with no code", async () => {
    await expect(mk({ chainId: 17000 }).submit(hashA, ref(1))).rejects.toThrow(/chain id 11155111, expected 17000/);
    await expect(mk({ contractAddress: "0x0000000000000000000000000000000000000001" }).submit(hashA, ref(1))).rejects.toThrow(/No contract code/);
  });
  it.skipIf(!runnable)("errors never contain the RPC URL", async () => {
    const dead = new ViemEthereumAnchor({ rpcUrl: "http://127.0.0.1:1/SECRET-API-KEY", chainId: CHAIN_ID, contractAddress: contract, privateKey: signerKey });
    try { await dead.submit(hashA, ref(1)); expect.unreachable(); } catch (e) { expect(String(e)).not.toContain("SECRET-API-KEY"); expect(String(e)).not.toContain("127.0.0.1:1"); }
    await expect(dead.status(hashA)).rejects.not.toThrow(/SECRET-API-KEY/);
  });
});

describe.skipIf(!runnable)("against a real EVM (local Anvil)", () => {
  it("submits, reports confirmations growing, and finds the hash in the contract's event", async () => {
    const c = mk();
    expect(await c.signerIsAuthorized()).toBe(true);
    const { txHash } = await c.submit(hashA, ref(10));
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    let s = await c.status(txHash);
    expect(s.state).toBe("mined"); // anvil mines immediately
    expect(s.confirmations).toBe(1);
    expect(s.dataContainsHash(hashA)).toBe(true);
    expect(s.dataContainsHash(hashB)).toBe(false);
    expect(s.dataContainsHash(hashA.toUpperCase().replace("0X", "0x"))).toBe(true);
    await mine(2);
    s = await c.status(txHash);
    expect(s.confirmations).toBe(3);
    expect(await c.verifyOnChain(uuid(10), hashA)).toBe(true);
    expect(await c.verifyOnChain(uuid(10), hashB)).toBe(false);
    expect(await c.verifyOnChain(uuid(11), hashA)).toBe(false);
  });

  it("is idempotent: a repeated submit returns the original transaction and sends nothing", async () => {
    const c = mk();
    const first = await c.submit(hashA.replace("ab", "ac"), ref(20));
    await pub.waitForTransactionReceipt({ hash: first.txHash as Hex });
    const before = BigInt((await raw("eth_blockNumber")) as string);
    const again = await c.submit(hashA.replace("ab", "ac"), ref(20));
    expect(again.txHash).toBe(first.txHash);
    expect(BigInt((await raw("eth_blockNumber")) as string)).toBe(before); // no new block: no new transaction
    // the same evidence with a different hash is refused loudly
    await expect(c.submit(hashB, ref(20))).rejects.toThrow(/DIFFERENT hash/);
  });

  it("a call that would revert fails in the dry run and spends nothing", async () => {
    const c = mk();
    const nonceBefore = await raw("eth_getTransactionCount", [c.signerAddress, "latest"]);
    const { txHash } = await c.submit(`0x${"e1".repeat(32)}`, ref(30));
    await expect(c.submit(`0x${"e1".repeat(32)}`, ref(31))).rejects.toThrow(/HashAlreadyAnchored/); // same hash under another reference
    expect(txHash).toBeTruthy();
    const nonceAfter = await raw("eth_getTransactionCount", [c.signerAddress, "latest"]);
    expect(BigInt(nonceAfter as string) - BigInt(nonceBefore as string)).toBe(1n); // only the first one cost a transaction
  });

  it("an unauthorised signer is stopped before any transaction", async () => {
    const stranger = generatePrivateKey();
    await raw("anvil_setBalance", [privateKeyToAccount(stranger).address, "0x56BC75E2D63100000"]);
    const c = mk({ privateKey: stranger });
    expect(await c.signerIsAuthorized()).toBe(false);
    await expect(c.submit(hashB, ref(40))).rejects.toThrow(/NotAuthorizedSigner/);
    expect(await c.verifyOnChain(uuid(40), hashB)).toBe(false);
  });

  it("a REVERTED transaction is reported as reverted and never carries the hash", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    await raw("anvil_setBalance", [stranger.address, "0x56BC75E2D63100000"]);
    const wallet = createWalletClient({ chain: { ...chain, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc), account: stranger });
    const data = encodeFunctionData({ abi: EVIDENCE_ANCHOR_ABI, functionName: "anchorEvidence", args: [evidenceRef(uuid(50)), incidentRef(uuid(900)), hashB as Hex, 1, 1] });
    const txHash = await wallet.sendTransaction({ to: contract, data, gas: 300_000n }); // an explicit gas limit skips estimation, so it is mined and reverts
    const s = await mk().status(txHash);
    expect(s.state).toBe("reverted");
    expect(s.dataContainsHash(hashB)).toBe(false); // the hash is in the calldata, but a reverted call anchors nothing
    expect(decodeFunctionData({ abi: EVIDENCE_ANCHOR_ABI, data }).functionName).toBe("anchorEvidence");
    expect(await mk().verifyOnChain(uuid(50), hashB)).toBe(false);
  });

  it("a transaction that merely contains the hash, or goes to another address, does not count", async () => {
    const acct = privateKeyToAccount(signerKey);
    const wallet = createWalletClient({ chain: { ...chain, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc), account: acct });
    const plain = await wallet.sendTransaction({ to: "0x00000000000000000000000000000000000000aa", data: hashB as Hex, value: 0n });
    const s = await mk().status(plain);
    expect(s.state).toBe("mined");
    expect(s.dataContainsHash(hashB)).toBe(false); // right data, wrong destination
    // a call to a DIFFERENT copy of the contract is not the configured contract
    const other = await deploy();
    const viaOther = await mk({ contractAddress: other }).submit(`0x${"f2".repeat(32)}`, ref(60));
    const s2 = await mk().status(viaOther.txHash);
    expect(s2.state).toBe("mined");
    expect(s2.dataContainsHash(`0x${"f2".repeat(32)}`)).toBe(false);
  });

  it("reports a pending transaction as pending, then mined once a block is produced", async () => {
    await raw("evm_setAutomine", [false]);
    try {
      const c = mk();
      const { txHash } = await c.submit(`0x${"a7".repeat(32)}`, ref(70));
      expect((await c.status(txHash)).state).toBe("pending");
      expect((await c.status(txHash)).dataContainsHash(`0x${"a7".repeat(32)}`)).toBe(false);
      await raw("evm_mine");
      const s = await c.status(txHash);
      expect(s.state).toBe("mined");
      expect(s.dataContainsHash(`0x${"a7".repeat(32)}`)).toBe(true);
    } finally { await raw("evm_setAutomine", [true]); }
  });

  it("an unknown transaction is not_found", async () => {
    expect((await mk().status(`0x${"00".repeat(31)}01`)).state).toBe("not_found");
  });
});

describe.skipIf(!runnable)("inside the Evidence Service (real contract, real database)", () => {
  async function evidence() {
    const op = who("operator");
    const admin = who("admin", op.org);
    const inc = (await api.post("/api/v1/incidents", op, { title: "On-chain anchoring", severity: "low" })).body.data;
    const e = (await api.post("/api/v1/evidence/generate", op, { incidentId: inc.id })).body.data;
    return { admin, op, inc, e };
  }
  const withChain = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = ctx.evidenceConfig.ethereum;
    ctx.evidenceConfig.ethereum = mk();
    ctx.evidenceConfig.arkiv = null;
    try { return await fn(); } finally { ctx.evidenceConfig.ethereum = prev; ctx.evidenceConfig.arkiv = ctx.arkiv; }
  };

  it("a submitted transaction is NOT anchored; it becomes anchored only after three confirmations, then verifies on chain", async () => {
    await withChain(async () => {
      const { admin, e } = await evidence();
      const r = await api.post(`/api/v1/evidence/${e.id}/anchor`, admin, { targets: ["ethereum"] });
      expect(r.status).toBe(202);
      let a = r.body.data.anchors[0];
      expect(a).toMatchObject({ target: "ethereum", status: "submitted", chainId: CHAIN_ID, requiredConfirmations: 3 });
      expect(a.externalReference).toMatch(/^0x[0-9a-f]{64}$/);
      expect(r.body.data.status).toBe("anchor_pending");
      // mined with 1 confirmation: still not anchored
      let rf = (await api.post(`/api/v1/evidence/${e.id}/anchors/refresh`, admin, {})).body.data;
      expect(rf.status).toBe("anchor_pending");
      expect(rf.anchors[0]).toMatchObject({ status: "submitted", confirmations: 1 });
      await mine(1);
      rf = (await api.post(`/api/v1/evidence/${e.id}/anchors/refresh`, admin, {})).body.data;
      expect(rf.anchors[0]).toMatchObject({ status: "submitted", confirmations: 2 });
      await mine(1);
      rf = (await api.post(`/api/v1/evidence/${e.id}/anchors/refresh`, admin, {})).body.data;
      expect(rf.status).toBe("anchored");
      expect(rf.anchors[0]).toMatchObject({ status: "confirmed", confirmations: 3 });
      a = rf.anchors[0];
      expect(await mk().verifyOnChain(e.id, e.contentHash)).toBe(true); // the contract itself agrees
      // evidence verification re-checks the transaction
      const v = (await api.post(`/api/v1/evidence/${e.id}/verify`, admin, {})).body.data;
      expect(v).toMatchObject({ valid: true, status: "verified" });
      expect(v.steps.find((s: { name: string }) => s.name === "anchor_ethereum").result).toBe("passed");
      // anchoring again changes nothing and sends no transaction
      const blocks = await raw("eth_blockNumber");
      await api.post(`/api/v1/evidence/${e.id}/anchor`, admin, { targets: ["ethereum"] });
      expect(await raw("eth_blockNumber")).toBe(blocks);
    });
  });

  it("an unauthorised signer makes the anchor fail visibly, spends nothing, and recovers once authorised", async () => {
    await withChain(async () => {
      const { admin, e } = await evidence();
      const stranger = generatePrivateKey();
      await raw("anvil_setBalance", [privateKeyToAccount(stranger).address, "0x56BC75E2D63100000"]);
      const real = ctx.evidenceConfig.ethereum;
      ctx.evidenceConfig.ethereum = mk({ privateKey: stranger });
      const r = await api.post(`/api/v1/evidence/${e.id}/anchor`, admin, { targets: ["ethereum"] });
      expect(r.body.data.status).toBe("anchor_failed");
      expect(r.body.data.anchors[0]).toMatchObject({ status: "failed" });
      expect(r.body.data.anchors[0].error).toMatch(/NotAuthorizedSigner/);
      expect(r.body.data.anchors[0].error).not.toContain(rpc);
      expect((await api.post(`/api/v1/evidence/${e.id}/verify`, admin, {})).body.data.valid).toBe(true); // the record itself is untouched
      ctx.evidenceConfig.ethereum = real;
      const retry = await api.post(`/api/v1/evidence/${e.id}/anchor`, admin, { targets: ["ethereum"] });
      expect(retry.body.data.anchors[0]).toMatchObject({ status: "submitted", attempts: 2 });
      expect(await mk().verifyOnChain(e.id, e.contentHash)).toBe(true);
    });
  });

  it("the anchoring wiring never reads the private key from anywhere but the client's config", async () => {
    const sources = ["../src/modules/evidence-service/services/evidence.service.ts", "../src/modules/evidence-service/adapters/viem-ethereum.ts"].map((p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")).join("\n");
    expect(sources).not.toMatch(/process\.env/);
    expect(sources).not.toMatch(/console\./);
  });
});
