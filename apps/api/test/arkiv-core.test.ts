/**
 * UNIT TESTS (no network). The health tests use a fake HTTP transport and are labelled as such; real Rabdi
 * behaviour is covered by test/arkiv-rabdi.test.ts, which talks to the actual network.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isRabdiUrl, loadArkivConfig, RABDI_CHAIN_ID, RABDI_RPC_URL } from "../src/modules/evidence-service/adapters/arkiv/config.js";
import { buildEntityValues, compareEntity, constantTimeEqual, refOf, type ArkivEvidenceInput } from "../src/modules/evidence-service/adapters/arkiv/entity.js";
import { ArkivError, backoffMs, classifyArkivError, MAX_ARKIV_ATTEMPTS } from "../src/modules/evidence-service/adapters/arkiv/errors.js";
import { SdkArkivClient } from "../src/modules/evidence-service/adapters/arkiv/sdk-client.js";

const SECRET_KEY = "SECRET-ACCESS-KEY-do-not-leak-0123456789";
const SIGNER = `0x${"11".repeat(32)}`;
const env = (over: Record<string, string | undefined> = {}) => ({ ARKIV_NETWORK: "rabdi", ARKIV_ACCESS_KEY: SECRET_KEY, ...over });
const input = (over: Partial<ArkivEvidenceInput> = {}): ArkivEvidenceInput => ({
  evidenceId: randomUUID(), incidentId: randomUUID(), organizationId: randomUUID(), contentHash: "ab".repeat(32), previousHash: null, schemaVersion: 1, sequence: 1, createdAt: "2026-11-06T10:00:00.000Z", ...over,
});

describe("configuration states", () => {
  it("is disabled only when explicitly switched off", () => {
    expect(loadArkivConfig(env({ ARKIV_ENABLED: "false" }))).toMatchObject({ state: "disabled" });
    expect(loadArkivConfig(env({ ARKIV_ENABLED: "FALSE" })).state).toBe("disabled");
    expect(loadArkivConfig(env({ ARKIV_ENABLED: "true" })).state).toBe("configured");
    expect(loadArkivConfig(env()).state).toBe("configured");
  });
  it("is not configured without an access key, unless the public endpoint is explicitly allowed", () => {
    expect(loadArkivConfig(env({ ARKIV_ACCESS_KEY: "" }))).toMatchObject({ state: "not_configured", missing: ["ARKIV_ACCESS_KEY"] });
    expect(loadArkivConfig(env({ ARKIV_ACCESS_KEY: undefined })).state).toBe("not_configured");
    const pub = loadArkivConfig(env({ ARKIV_ACCESS_KEY: "", ARKIV_ALLOW_PUBLIC_ENDPOINT: "true" }));
    expect(pub).toMatchObject({ state: "configured", config: { publicEndpoint: true, accessKey: "" } });
  });
  it("refuses any network or chain id except Rabdi", () => {
    expect(loadArkivConfig(env({ ARKIV_NETWORK: "mainnet" })).state).toBe("not_configured");
    expect(loadArkivConfig({ ARKIV_ACCESS_KEY: SECRET_KEY }).state).toBe("not_configured"); // network not stated
    expect(loadArkivConfig(env({ ARKIV_CHAIN_ID: "1" })).state).toBe("not_configured");
    expect(loadArkivConfig(env({ ARKIV_CHAIN_ID: String(RABDI_CHAIN_ID) })).state).toBe("configured");
  });
  it("refuses any RPC URL that is not exactly the Rabdi endpoint (SSRF)", () => {
    for (const bad of ["http://rpc.rabdi.db-chain.testnet.arkiv.network", "https://evil.example.com", "https://rpc.rabdi.db-chain.testnet.arkiv.network.evil.com", "https://user:pw@rpc.rabdi.db-chain.testnet.arkiv.network", "https://rpc.rabdi.db-chain.testnet.arkiv.network/some-key", "https://rpc.rabdi.db-chain.testnet.arkiv.network:8443", "https://127.0.0.1", "https://169.254.169.254/latest", "file:///etc/passwd"]) {
      expect(isRabdiUrl(bad), bad).toBe(false);
      expect(loadArkivConfig(env({ ARKIV_RPC_URL: bad })).state, bad).toBe("not_configured");
    }
    expect(isRabdiUrl(RABDI_RPC_URL)).toBe(true);
    expect(isRabdiUrl(`${RABDI_RPC_URL}/`)).toBe(true);
  });
  it("validates the signer key without ever echoing it", () => {
    const ok = loadArkivConfig(env({ ARKIV_SIGNER_PRIVATE_KEY: SIGNER }));
    expect(ok).toMatchObject({ state: "configured", config: { signerPrivateKey: SIGNER } });
    expect(loadArkivConfig(env({ ARKIV_SIGNER_PRIVATE_KEY: SIGNER.slice(2) }))).toMatchObject({ state: "configured" }); // 0x optional
    const bad = loadArkivConfig(env({ ARKIV_SIGNER_PRIVATE_KEY: "not-a-key-0xdeadbeef" }));
    expect(bad.state).toBe("not_configured");
    expect(JSON.stringify(bad)).not.toContain("deadbeef");
    expect(loadArkivConfig(env()).state === "configured" && (loadArkivConfig(env()) as { config: { signerPrivateKey: unknown } }).config.signerPrivateKey).toBeNull(); // read-only
  });
  it("no non-configured state mentions the access key", () => {
    for (const e of [env({ ARKIV_ENABLED: "false" }), env({ ARKIV_NETWORK: "x" }), env({ ARKIV_RPC_URL: `https://evil.example/${SECRET_KEY}` }), env({ ARKIV_CHAIN_ID: "5", ARKIV_SIGNER_PRIVATE_KEY: "bad" })]) {
      expect(JSON.stringify(loadArkivConfig(e))).not.toContain(SECRET_KEY);
    }
  });
});

describe("entity schema and privacy", () => {
  it("builds opaque references and stores the hash exactly", () => {
    const i = input({ previousHash: "cd".repeat(32) });
    const v = buildEntityValues(i);
    expect(v.evidenceHash).toBe(i.contentHash);
    expect(v.previousHash).toBe("cd".repeat(32));
    expect(v).toMatchObject({ contentType: "application/json", producer: "CORVEN" });
    expect(v.evidenceRef).toBe(refOf("evidence", i.evidenceId));
    expect(v.evidenceRef).toMatch(/^[0-9a-f]{64}$/);
    expect(buildEntityValues(input({ previousHash: null })).previousHash).toBe("");
  });
  it("contains no internal identifier, free text or secret", () => {
    const i = input();
    const dump = JSON.stringify(buildEntityValues(i), (_k, val) => (typeof val === "bigint" ? val.toString() : val));
    for (const forbidden of [i.evidenceId, i.incidentId, i.organizationId]) expect(dump).not.toContain(forbidden);
    expect(Object.keys(buildEntityValues(i)).sort()).toEqual(["contentType", "createdAt", "evidenceHash", "evidenceRef", "incidentRef", "orgRef", "previousHash", "producer", "schemaVersion", "sequence"]);
  });
  it("references are deterministic, case-insensitive and domain-separated", () => {
    const u = randomUUID();
    expect(refOf("evidence", u)).toBe(refOf("evidence", u.toUpperCase()));
    expect(new Set([refOf("evidence", u), refOf("incident", u), refOf("org", u)]).size).toBe(3);
  });
  it.each([
    ["a non-uuid evidence id", { evidenceId: "ev-1" }],
    ["a non-uuid organization", { organizationId: "acme" }],
    ["a short hash", { contentHash: "abcd" }],
    ["a non-hex hash", { contentHash: "zz".repeat(32) }],
    ["a bad previous hash", { previousHash: "12" }],
    ["version 0", { schemaVersion: 0 }],
    ["sequence 0", { sequence: 0 }],
    ["a fractional version", { schemaVersion: 1.5 }],
    ["an invalid date", { createdAt: "yesterday" }],
  ])("rejects %s before anything is built", (_n, over) => {
    expect(() => buildEntityValues(input(over as Partial<ArkivEvidenceInput>))).toThrowError(ArkivError);
  });
  it("accepts a 0x-prefixed hash and normalises case", () => {
    expect(buildEntityValues(input({ contentHash: `0x${"AB".repeat(32)}` })).evidenceHash).toBe("ab".repeat(32));
  });
});

describe("read-back comparison", () => {
  const row = (i: ArkivEvidenceInput, over: Record<string, unknown> = {}) => {
    const v = buildEntityValues(i);
    const wrap = (x: unknown) => ({ value: x });
    return { evidenceRef: wrap(v.evidenceRef), incidentRef: wrap(v.incidentRef), orgRef: wrap(v.orgRef), evidenceHash: wrap(v.evidenceHash), previousHash: wrap(v.previousHash), schemaVersion: wrap(BigInt(i.schemaVersion)), sequence: wrap(BigInt(i.sequence)), createdAt: wrap(v.createdAt), contentType: wrap(v.contentType), producer: wrap("CORVEN"), ...over };
  };
  it("matches an identical entity", () => {
    const i = input();
    expect(compareEntity(row(i), i)).toEqual({ outcome: "match" });
  });
  it("a different hash is a mismatch and never a match", () => {
    const i = input();
    expect(compareEntity(row(i, { evidenceHash: { value: "00".repeat(32) } }), i)).toEqual({ outcome: "mismatch", field: "evidenceHash" });
    expect(compareEntity(row(i, { evidenceHash: { value: "AB".repeat(32) } }), i)).toMatchObject({ outcome: "malformed" }); // upper case is not what was stored
  });
  it.each([
    ["evidenceRef", { evidenceRef: { value: "f".repeat(64) } }],
    ["incidentRef", { incidentRef: { value: "f".repeat(64) } }],
    ["orgRef", { orgRef: { value: "f".repeat(64) } }],
    ["previousHash", { previousHash: { value: "e".repeat(64) } }],
    ["schemaVersion", { schemaVersion: { value: 2n } }],
    ["sequence", { sequence: { value: 9n } }],
    ["producer", { producer: { value: "SOMEONE-ELSE" } }],
  ])("a different %s is a mismatch", (field, over) => {
    const i = input();
    expect(compareEntity(row(i, over), i)).toEqual({ outcome: "mismatch", field });
  });
  it("malformed or hostile entities are rejected, not coerced", () => {
    const i = input();
    expect(compareEntity({}, i)).toMatchObject({ outcome: "malformed" });
    expect(compareEntity(row(i, { evidenceHash: { value: 12345 } }), i)).toEqual({ outcome: "malformed", field: "evidenceHash" });
    expect(compareEntity(row(i, { schemaVersion: { value: "1" } }), i)).toEqual({ outcome: "malformed", field: "schemaVersion" });
    expect(compareEntity(row(i, { evidenceHash: { value: "not-a-hash" } }), i)).toEqual({ outcome: "malformed", field: "evidenceHash" });
    expect(compareEntity(row(i, { producer: undefined }), i)).toMatchObject({ outcome: "malformed" });
  });
  it("constant-time equality is exact", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("error classification and retry policy", () => {
  const cases: Array<[string, unknown, string, boolean]> = [
    ["a 401", { status: 401 }, "ARKIV_AUTH_FAILED", false],
    ["INVALID_KEY text", new Error("INVALID_KEY unknown API key"), "ARKIV_AUTH_FAILED", false],
    ["a 429", { status: 429 }, "ARKIV_RATE_LIMITED", true],
    ["the anonymous query budget", { status: 429, message: "ANON_COST_LIMITED unauthenticated query budget exhausted; get an API key" }, "ARKIV_QUOTA_EXCEEDED", true],
    ["rate limit text", new Error("Too Many Requests"), "ARKIV_RATE_LIMITED", true],
    ["insufficient funds", { shortMessage: "insufficient funds for gas * price + value" }, "ARKIV_INSUFFICIENT_FUNDS", true],
    ["a timeout", { name: "TimeoutError", message: "The request timed out" }, "ARKIV_TIMEOUT", true],
    ["an abort", { name: "AbortError" }, "ARKIV_TIMEOUT", true],
    ["a missing entity", { name: "NoEntityFoundError" }, "ARKIV_NOT_INDEXED", true],
    ["a schema mismatch", { name: "SchemaMismatchError" }, "ARKIV_INVALID_ENTITY", false],
    ["a reverted tx", { name: "EntityMutationError", message: "execution reverted" }, "ARKIV_TX_FAILED", true],
    ["a refused connection", new Error("connect ECONNREFUSED 127.0.0.1:1"), "ARKIV_NETWORK", true],
    ["a 503", { status: 503 }, "ARKIV_NETWORK", true],
    ["something unknown", new Error("kaboom"), "ARKIV_UNKNOWN", true],
  ];
  it.each(cases)("%s -> %s (retryable %s)", (_n, e, code, retry) => {
    const c = classifyArkivError(e);
    expect(c.code).toBe(code);
    expect(c.retryable).toBe(retry);
  });
  it("never lets the original message through", () => {
    const c = classifyArkivError(new Error(`401 Unauthorized at https://rpc.rabdi.db-chain.testnet.arkiv.network/${SECRET_KEY} with X-API-KEY ${SECRET_KEY}`));
    expect(c.message).not.toContain(SECRET_KEY);
    expect(c.message).not.toMatch(/https?:/);
  });
  it("permanent failures are not retryable", () => {
    for (const code of ["ARKIV_AUTH_FAILED", "ARKIV_READBACK_MISMATCH", "ARKIV_MALFORMED_ENTITY", "ARKIV_WRONG_NETWORK", "ARKIV_NOT_CONFIGURED", "ARKIV_DISABLED"] as const) expect(new ArkivError(code, "x").retryable, code).toBe(false);
  });
  it("backoff is exponential, bounded, and longer for insufficient funds", () => {
    expect([1, 2, 3].map((n) => backoffMs(n, "ARKIV_NETWORK"))).toEqual([30_000, 60_000, 120_000]);
    expect(backoffMs(50, "ARKIV_NETWORK")).toBe(30 * 60_000);
    expect(backoffMs(1, "ARKIV_INSUFFICIENT_FUNDS")).toBeGreaterThan(backoffMs(1, "ARKIV_NETWORK"));
    expect(backoffMs(1, "ARKIV_QUOTA_EXCEEDED")).toBeGreaterThan(backoffMs(1, "ARKIV_NETWORK"));
    expect(MAX_ARKIV_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ARKIV_ATTEMPTS).toBeLessThan(20);
  });
});

describe("health check (fake HTTP transport)", () => {
  type Call = { url: string; headers: Record<string, string>; method: string };
  const transport = (answers: Record<string, unknown> | ((m: string) => { status: number; body: unknown }), calls: Call[] = []) => async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    const m = JSON.parse(init.body).method as string;
    calls.push({ url, headers: init.headers, method: m });
    const r = typeof answers === "function" ? answers(m) : { status: 200, body: { jsonrpc: "2.0", id: 1, result: answers[m] } };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const cfg = (over: Record<string, unknown> = {}) => {
    const s = loadArkivConfig(env(over as Record<string, string>));
    if (s.state !== "configured") throw new Error("config");
    return s.config;
  };

  it("is operational only after a real answer on the right chain, and sends the key in a header, never in the URL", async () => {
    const calls: Call[] = [];
    const c = new SdkArkivClient(cfg(), { fetch: transport({ eth_chainId: "0x76edaf", eth_blockNumber: "0x45da7" }, calls) });
    const h = await c.health();
    expect(h).toMatchObject({ provider: "arkiv", network: "rabdi", chainId: 7794095, connected: true, authenticated: true, state: "operational", blockNumber: 286119, canWrite: false, errorCode: null });
    expect(calls.map((x) => x.method)).toEqual(["eth_chainId", "eth_blockNumber"]);
    for (const call of calls) {
      expect(call.headers["X-API-KEY"]).toBe(SECRET_KEY);
      expect(call.url).toBe(RABDI_RPC_URL);
      expect(call.url).not.toContain(SECRET_KEY);
    }
    expect(JSON.stringify(h)).not.toContain(SECRET_KEY);
  });
  it("a wrong chain is never operational", async () => {
    const h = await new SdkArkivClient(cfg(), { fetch: transport({ eth_chainId: "0x1", eth_blockNumber: "0x10" }) }).health();
    expect(h).toMatchObject({ chainId: 1, connected: true, state: "wrong_network", authenticated: false, errorCode: "ARKIV_WRONG_NETWORK" });
  });
  it("a rejected key is reported as auth_failed and not authenticated", async () => {
    const h = await new SdkArkivClient(cfg(), { fetch: transport(() => ({ status: 401, body: { error: "INVALID_KEY", message: "unknown API key" } })) }).health();
    expect(h).toMatchObject({ connected: false, authenticated: false, state: "auth_failed", errorCode: "ARKIV_AUTH_FAILED" });
    expect(JSON.stringify(h)).not.toContain(SECRET_KEY);
  });
  it("rate limiting and outages are unavailable, with a code", async () => {
    expect((await new SdkArkivClient(cfg(), { fetch: transport(() => ({ status: 429, body: {} })) }).health())).toMatchObject({ state: "unavailable", errorCode: "ARKIV_RATE_LIMITED" });
    const down = async () => { throw new Error("connect ECONNREFUSED"); };
    expect(await new SdkArkivClient(cfg(), { fetch: down as never }).health()).toMatchObject({ state: "unavailable", errorCode: "ARKIV_NETWORK", connected: false });
  });
  it("garbage answers are not accepted as a block number", async () => {
    const h = await new SdkArkivClient(cfg(), { fetch: transport({ eth_chainId: "0x76edaf", eth_blockNumber: "banana" }) }).health();
    expect(h.state).toBe("unavailable");
    expect(h.blockNumber).toBeNull();
  });
  it("the public endpoint is reported as not authenticated", async () => {
    const calls: Call[] = [];
    const h = await new SdkArkivClient(cfg({ ARKIV_ACCESS_KEY: "", ARKIV_ALLOW_PUBLIC_ENDPOINT: "true" }), { fetch: transport({ eth_chainId: "0x76edaf", eth_blockNumber: "0x1" }, calls) }).health();
    expect(h).toMatchObject({ state: "operational", authenticated: false, publicEndpoint: true });
    expect(calls[0]!.headers["X-API-KEY"]).toBeUndefined();
  });
  it("writing without a signer is refused with a clear code", async () => {
    await expect(new SdkArkivClient(cfg()).publish({}, input())).rejects.toMatchObject({ code: "ARKIV_NOT_CONFIGURED" });
  });
  it("invalid input never reaches the network", async () => {
    const calls: Call[] = [];
    const c = new SdkArkivClient(cfg({ ARKIV_SIGNER_PRIVATE_KEY: SIGNER }), { fetch: transport({}, calls) });
    await expect(c.publish({}, input({ contentHash: "short" }))).rejects.toMatchObject({ code: "ARKIV_INVALID_ENTITY" });
    expect(calls).toEqual([]);
  });
});
