/**
 * SERVICE-LEVEL TESTS with a SCRIPTED FAKE Arkiv client (labelled as such) against the real database. They prove how the
 * Evidence Service behaves around Arkiv: claims, idempotency, retries, reconciliation, status honesty, tenancy, privacy.
 * Behaviour of the real network is tested separately in test/arkiv-rabdi.test.ts.
 */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ArkivClient } from "../src/modules/evidence-service/adapters/anchors.js";
import { buildEntityValues, compareEntity, refOf, type ArkivEvidenceInput, type ArkivExpected } from "../src/modules/evidence-service/adapters/arkiv/entity.js";
import { ArkivError, MAX_ARKIV_ATTEMPTS, type ArkivErrorCode } from "../src/modules/evidence-service/adapters/arkiv/errors.js";
import type { ReadBackResult } from "../src/modules/evidence-service/adapters/arkiv/sdk-client.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

const SECRET = "SECRET-ACCESS-KEY-do-not-leak-0123456789";

/** A programmable stand-in. It stores real entity values, so read-back uses the real comparison code. */
class ScriptedArkiv implements ArkivClient {
  readonly name = "scripted-arkiv";
  publishCalls = 0;
  createdEntities = 0;
  inputs: ArkivEvidenceInput[] = [];
  entities = new Map<string, Record<string, unknown>>();
  publishErrors: ArkivError[] = [];
  readBackErrors: ArkivError[] = [];
  readBackOverride: ReadBackResult | null = null;
  async publish(_p: unknown, input?: ArkivEvidenceInput) {
    this.publishCalls++;
    if (!input) throw new ArkivError("ARKIV_INVALID_ENTITY", "inputs required");
    this.inputs.push(input);
    const err = this.publishErrors.shift();
    if (err) throw err;
    const values = buildEntityValues(input);
    for (const [k, row] of this.entities) if ((row.evidenceRef as { value: string }).value === values.evidenceRef) return { entityKey: k, txHash: null, expiresAtBlock: "1000", reused: true };
    const key = `0x${randomBytes(32).toString("hex")}`;
    const wrap = (v: unknown) => ({ value: v });
    this.entities.set(key, { evidenceRef: wrap(values.evidenceRef), incidentRef: wrap(values.incidentRef), orgRef: wrap(values.orgRef), evidenceHash: wrap(values.evidenceHash), previousHash: wrap(values.previousHash), schemaVersion: wrap(BigInt(input.schemaVersion)), sequence: wrap(BigInt(input.sequence)), createdAt: wrap(values.createdAt), contentType: wrap(values.contentType), producer: wrap("CORVEN") });
    this.createdEntities++;
    return { entityKey: key, txHash: `0x${"cd".repeat(32)}`, expiresAtBlock: "8062234", reused: false };
  }
  async readBack(key: string, expected: ArkivExpected): Promise<ReadBackResult> {
    const err = this.readBackErrors.shift();
    if (err) throw err;
    if (this.readBackOverride) return this.readBackOverride;
    const row = this.entities.get(key);
    if (!row) return { outcome: "not_found" };
    const cmp = compareEntity(row, expected);
    return cmp.outcome === "match" ? { outcome: "match", owner: "0xowner", expiresAtBlock: "8062234" } : cmp;
  }
  async findExisting(expected: ArkivExpected) {
    const ref = buildEntityValues(expected).evidenceRef;
    for (const [k, row] of this.entities) if ((row.evidenceRef as { value: string }).value === ref) return k;
    return null;
  }
  async queryByIncident() {
    return [...this.entities.keys()].map((entityKey) => ({ entityKey, owner: "0xowner" }));
  }
}

let ctx: TestCtx;
let api: ReturnType<typeof client>;
let fake: ScriptedArkiv;
const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
const original = { arkiv: null as unknown, now: null as unknown, log: null as unknown, state: null as unknown };

beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
  Object.assign(original, { arkiv: ctx.evidenceConfig.arkiv, now: ctx.evidenceConfig.now, log: ctx.evidenceConfig.log, state: ctx.evidenceConfig.arkivState });
  ctx.evidenceConfig.now = () => new Date(Date.now() + ctx.clock.offsetMs);
  ctx.evidenceConfig.log = (event, fields) => void logs.push({ event, fields });
});
afterAll(() => ctx.close());
afterEach(() => {
  ctx.clock.offsetMs = 0;
  ctx.evidenceConfig.arkiv = original.arkiv as never;
  vi.restoreAllMocks();
});
const use = () => {
  fake = new ScriptedArkiv();
  ctx.evidenceConfig.arkiv = fake;
  return fake;
};

const E = "/api/v1/evidence";
async function evidence(title = "Anchoring to Arkiv") {
  const op = who("operator");
  const admin = who("admin", op.org);
  const inc = (await api.post("/api/v1/incidents", op, { title, description: "customer PII-LIKE-DETAIL", severity: "low" })).body.data;
  await api.post(`/api/v1/incidents/${inc.id}/notes`, op, { content: "private-operator-note" });
  const e = (await api.post(`${E}/generate`, op, { incidentId: inc.id })).body.data;
  return { op, admin, inc, e };
}
const anchor = (w: ReturnType<typeof who>, id: string) => api.post(`${E}/${id}/anchor`, w, { targets: ["arkiv"] });
const arkivOf = async (w: ReturnType<typeof who>, id: string) => (await api.get(`${E}/${id}`, w)).body.data.anchors.find((a: { target: string }) => a.target === "arkiv");
const entitiesFor = (id: string) => [...fake.entities.values()].filter((r) => (r.evidenceRef as { value: string }).value === refOf("evidence", id)).length;
const publishesFor = (id: string) => fake.inputs.filter((i) => i.evidenceId === id).length; // maintenance also works on other tests' records in the shared database
const maintain = () => ctx.app.evidence.evidence.runMaintenance();
const advance = (ms: number) => void (ctx.clock.offsetMs += ms);

describe("creating and confirming an anchor", () => {
  it("creates the entity, records its key and transaction, reads it back, and only then confirms", async () => {
    use();
    const { admin, e } = await evidence();
    const r = await anchor(admin, e.id);
    expect(r.status).toBe(202);
    const a = r.body.data.anchors[0];
    expect(a).toMatchObject({ target: "arkiv", status: "confirmed", errorCode: null, retryable: true, attempts: 1, chainId: 7794095, externalTx: `0x${"cd".repeat(32)}`, externalExpiresBlock: 8062234, anchoredHash: e.contentHash });
    expect(a.externalReference).toMatch(/^0x[0-9a-f]{64}$/);
    expect(entitiesFor(e.id)).toBe(1);
    expect(r.body.data.status).toBe("anchored");
  });

  it("persists the entity reference BEFORE reading back: a failing read-back keeps the key", async () => {
    use();
    fake.readBackErrors.push(new ArkivError("ARKIV_NETWORK", "arkiv unavailable"), new ArkivError("ARKIV_NETWORK", "arkiv unavailable")); // the attempt and the refresh that follows it
    const { admin, e } = await evidence();
    const a = (await anchor(admin, e.id)).body.data.anchors[0];
    expect(a.status).toBe("failed");
    expect(a.externalReference).toMatch(/^0x[0-9a-f]{64}$/); // the entity exists and its key is not lost
    expect(a.errorCode).toBe("ARKIV_NETWORK");
    expect(entitiesFor(e.id)).toBe(1);
  });

  it("anchoring requires internally verified evidence: tampered evidence is refused and nothing is published", async () => {
    use();
    const { admin, e } = await evidence();
    const q = (sql: string, p: unknown[]) => ctx.handle.pool.query(sql, p);
    await q("alter table evidence_records disable trigger evidence_records_guard", []);
    try { await q("update evidence_records set content = jsonb_set(content, '{incident,severity}', '\"critical\"') where id=$1", [e.id]); } finally { await q("alter table evidence_records enable trigger evidence_records_guard", []); }
    const r = await anchor(admin, e.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("EVIDENCE_INVALID");
    expect(fake.publishCalls).toBe(0);
  });

  it("only administrators and the system can anchor; viewers and operators cannot", async () => {
    use();
    const { op, e } = await evidence();
    expect((await anchor(op, e.id)).status).toBe(403);
    expect((await anchor(who("viewer", op.org), e.id)).status).toBe(403);
    expect(fake.publishCalls).toBe(0);
  });
});

describe("duplicate prevention and idempotency", () => {
  it("anchoring twice, or from many callers at once, creates exactly one entity", async () => {
    use();
    const { admin, e } = await evidence();
    await Promise.all(Array.from({ length: 6 }, () => anchor(admin, e.id)));
    await anchor(admin, e.id);
    expect(entitiesFor(e.id)).toBe(1);
    const a = await arkivOf(admin, e.id);
    expect(a.status).toBe("confirmed");
    const rows = (await ctx.handle.pool.query("select count(*)::int n from evidence_anchors where evidence_id=$1 and target='arkiv'", [e.id])).rows[0].n;
    expect(rows).toBe(1);
  });

  it("a confirmed anchor is never touched again, by anyone", async () => {
    use();
    const { admin, e } = await evidence();
    await anchor(admin, e.id);
    const calls = publishesFor(e.id);
    await anchor(admin, e.id);
    await maintain();
    expect(publishesFor(e.id)).toBe(calls);
    await expect(ctx.handle.pool.query("update evidence_anchors set status='failed' where evidence_id=$1 and target='arkiv'", [e.id])).rejects.toMatchObject({ code: "23001" });
  });

  it("a lost database write after the entity was created is reconciled without a second entity", async () => {
    use();
    const { admin, e } = await evidence();
    // The entity is created on Arkiv, then recording its key fails (the database blinks).
    const repo = ctx.app.evidence.repo;
    const real = repo.markAnchor.bind(repo);
    let first = true;
    vi.spyOn(repo, "markAnchor").mockImplementation(async (...args) => {
      if (first) { first = false; throw new Error("database unavailable"); }
      return real(...args);
    });
    await anchor(admin, e.id).catch(() => undefined);
    expect(entitiesFor(e.id)).toBe(1); // it exists on Arkiv
    const a1 = (await ctx.handle.pool.query("select status, external_reference from evidence_anchors where evidence_id=$1 and target='arkiv'", [e.id])).rows[0];
    expect(a1.external_reference).toBeNull(); // CORVEN does not know its key
    // The claim goes stale, the maintenance pass finds the existing entity instead of creating another.
    advance(3 * 60_000);
    await maintain();
    expect(entitiesFor(e.id)).toBe(1);
    expect(publishesFor(e.id)).toBe(2);
    const a2 = await arkivOf(admin, e.id);
    expect(a2).toMatchObject({ status: "confirmed" });
  });

  it("a worker restart in the middle (entity recorded, not yet confirmed) is finished by maintenance", async () => {
    use();
    fake.readBackOverride = { outcome: "not_found" };
    const { admin, e } = await evidence();
    expect((await arkivOf(admin, (await anchor(admin, e.id), e.id))).status).toBe("submitted");
    fake.readBackOverride = null;
    advance(2 * 60_000);
    await maintain();
    expect((await arkivOf(admin, e.id)).status).toBe("confirmed");
    expect(entitiesFor(e.id)).toBe(1);
  });
});

describe("read-back honesty", () => {
  it("a hash mismatch is NEVER confirmed, is permanent, and does not damage the internal record", async () => {
    use();
    const { admin, e } = await evidence();
    fake.readBackOverride = { outcome: "mismatch", field: "evidenceHash" };
    const a = (await anchor(admin, e.id)).body.data.anchors[0];
    expect(a).toMatchObject({ status: "failed", errorCode: "ARKIV_READBACK_MISMATCH", retryable: false });
    expect(a.error).toMatch(/did not match/);
    fake.readBackOverride = null;
    advance(60 * 60_000);
    await maintain(); // permanent: maintenance does not retry it into agreement
    expect((await arkivOf(admin, e.id)).status).toBe("failed");
    const v = (await api.post(`${E}/${e.id}/verify`, admin, {})).body.data;
    expect(v.valid).toBe(true); // internal integrity is separate from external anchoring
    expect(v.steps.find((s: { name: string }) => s.name === "sources_unchanged").result).toBe("passed");
  });

  it("a malformed entity is permanent too", async () => {
    use();
    const { admin, e } = await evidence();
    fake.readBackOverride = { outcome: "malformed", field: "evidenceHash" };
    expect((await anchor(admin, e.id)).body.data.anchors[0]).toMatchObject({ status: "failed", errorCode: "ARKIV_MALFORMED_ENTITY", retryable: false });
  });

  it("an entity that is not readable yet stays submitted, never confirmed, and confirms when it appears", async () => {
    use();
    const { admin, e } = await evidence();
    fake.readBackOverride = { outcome: "not_found" };
    const a = (await anchor(admin, e.id)).body.data.anchors[0];
    expect(a).toMatchObject({ status: "submitted", errorCode: "ARKIV_NOT_INDEXED" });
    expect((await api.get(`${E}/${e.id}`, admin)).body.data.status).toBe("anchor_pending");
    fake.readBackOverride = null;
    advance(5 * 60_000);
    await maintain();
    expect(await arkivOf(admin, e.id)).toMatchObject({ status: "confirmed", errorCode: null });
    expect((await api.get(`${E}/${e.id}`, admin)).body.data.status).toBe("anchored");
  });

  it("an entity that never becomes readable ends as a visible, non-retryable failure", async () => {
    use();
    const { admin, e } = await evidence();
    fake.readBackOverride = { outcome: "not_found" };
    await anchor(admin, e.id);
    for (let i = 0; i < MAX_ARKIV_ATTEMPTS + 2; i++) {
      advance(35 * 60_000);
      await maintain();
    }
    expect(await arkivOf(admin, e.id)).toMatchObject({ status: "failed", retryable: false, errorCode: "ARKIV_NOT_INDEXED" });
  });
});

describe("failure handling and retries", () => {
  const fail = (code: ArkivErrorCode, msg = "fail") => new ArkivError(code, msg);

  it.each([
    ["ARKIV_NETWORK", true], ["ARKIV_TIMEOUT", true], ["ARKIV_RATE_LIMITED", true], ["ARKIV_INSUFFICIENT_FUNDS", true], ["ARKIV_TX_FAILED", true],
    ["ARKIV_AUTH_FAILED", false], ["ARKIV_NOT_CONFIGURED", false], ["ARKIV_WRONG_NETWORK", false], ["ARKIV_INVALID_ENTITY", false],
  ] as const)("%s is recorded with its code and retryable=%s", async (code, retryable) => {
    use();
    fake.publishErrors.push(fail(code));
    const { admin, e } = await evidence();
    const a = (await anchor(admin, e.id)).body.data.anchors[0];
    expect(a).toMatchObject({ status: "failed", errorCode: code, retryable });
    expect(a.nextAttemptAt === null).toBe(!retryable);
  });

  it("a transient failure is retried by maintenance after its backoff, not before, and then succeeds", async () => {
    use();
    fake.publishErrors.push(fail("ARKIV_RATE_LIMITED"));
    const { admin, e } = await evidence();
    await anchor(admin, e.id);
    await maintain();
    expect(publishesFor(e.id)).toBe(1); // not due yet
    advance(31_000);
    await maintain();
    expect(await arkivOf(admin, e.id)).toMatchObject({ status: "confirmed", attempts: 2, errorCode: null });
    expect(entitiesFor(e.id)).toBe(1);
  });

  it("backoff grows and retries are bounded: a permanently failing network ends non-retryable", async () => {
    use();
    for (let i = 0; i < 20; i++) fake.publishErrors.push(fail("ARKIV_NETWORK"));
    const { admin, e } = await evidence();
    await anchor(admin, e.id);
    const waits: number[] = [];
    for (let i = 0; i < MAX_ARKIV_ATTEMPTS + 3; i++) {
      const a = await arkivOf(admin, e.id);
      if (a.nextAttemptAt) waits.push(new Date(a.nextAttemptAt).getTime() - new Date(a.lastAttemptAt ?? a.updatedAt).getTime());
      advance(31 * 60_000);
      await maintain();
    }
    const last = await arkivOf(admin, e.id);
    expect(last).toMatchObject({ status: "failed", retryable: false, attempts: MAX_ARKIV_ATTEMPTS });
    expect(publishesFor(e.id)).toBe(MAX_ARKIV_ATTEMPTS);
    expect(waits.every((w) => w <= 31 * 60_000)).toBe(true);
  });

  it("invalid credentials are NOT retried in a loop; fixing the cause and asking again works", async () => {
    use();
    fake.publishErrors.push(fail("ARKIV_AUTH_FAILED", "Arkiv rejected the access key"));
    const { admin, e } = await evidence();
    await anchor(admin, e.id);
    for (let i = 0; i < 5; i++) { advance(60 * 60_000); await maintain(); }
    expect(publishesFor(e.id)).toBe(1);
    expect(await arkivOf(admin, e.id)).toMatchObject({ status: "failed", errorCode: "ARKIV_AUTH_FAILED", retryable: false });
    expect((await anchor(admin, e.id)).body.data.anchors[0]).toMatchObject({ status: "confirmed", attempts: 2 }); // a person retried after fixing the key
  });

  it("a hostile exception from the SDK cannot leak into the anchor record", async () => {
    use();
    const { admin, e } = await evidence();
    vi.spyOn(fake, "publish").mockRejectedValueOnce(new Error(`boom X-API-KEY: ${SECRET} https://rpc.rabdi.db-chain.testnet.arkiv.network/${SECRET}`));
    const r = await anchor(admin, e.id);
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    const row = (await ctx.handle.pool.query("select error, error_code from evidence_anchors where evidence_id=$1", [e.id])).rows[0];
    expect(row).toMatchObject({ error_code: "ARKIV_UNKNOWN", error: "Unexpected Arkiv error" });
    expect(JSON.stringify(row)).not.toMatch(/X-API-KEY|https?:/);
  });

  it("an Arkiv outage never affects internal evidence validity or Ethereum anchoring", async () => {
    use();
    const { admin, e } = await evidence();
    fake.publishErrors.push(fail("ARKIV_NETWORK"));
    const r = await api.post(`${E}/${e.id}/anchor`, admin, { targets: ["arkiv", "ethereum"] });
    const by = Object.fromEntries(r.body.data.anchors.map((a: { target: string; status: string }) => [a.target, a.status]));
    expect(by).toEqual({ arkiv: "failed", ethereum: "submitted" });
    expect((await api.post(`${E}/${e.id}/verify`, admin, {})).body.data.valid).toBe(true);
  });
});

describe("verification of anchored evidence", () => {
  it("re-reads the entity; a changed or deleted entity is reported, and the confirmed record is not rewritten", async () => {
    use();
    const { admin, e } = await evidence();
    await anchor(admin, e.id);
    const step = async () => (await api.post(`${E}/${e.id}/verify`, admin, {})).body.data.steps.find((s: { name: string }) => s.name === "anchor_arkiv");
    expect((await step()).result).toBe("passed");
    const [key] = [...fake.entities.keys()];
    fake.readBackOverride = { outcome: "mismatch", field: "evidenceHash" };
    expect((await step()).result).toBe("failed");
    fake.readBackOverride = { outcome: "not_found" };
    expect((await step()).result).toBe("failed");
    fake.readBackOverride = null;
    expect(key).toBeTruthy();
    expect((await arkivOf(admin, e.id)).status).toBe("confirmed");
  });

  it("entity retrieval validates what the network returns", async () => {
    use();
    const { admin, op, e } = await evidence();
    await anchor(admin, e.id);
    expect((await api.get(`${E}/${e.id}/arkiv`, op)).body.data).toMatchObject({ anchor: { status: "confirmed" }, live: { outcome: "match" } });
    fake.readBackOverride = { outcome: "malformed", field: "evidenceHash" };
    expect((await api.get(`${E}/${e.id}/arkiv`, op)).body.data.live).toEqual({ outcome: "malformed", field: "evidenceHash" });
    fake.readBackErrors.push(new ArkivError("ARKIV_TIMEOUT", "timed out"));
    fake.readBackOverride = null;
    expect((await api.get(`${E}/${e.id}/arkiv`, op)).body.data.live).toEqual({ outcome: "unavailable", errorCode: "ARKIV_TIMEOUT" });
  });
});

describe("privacy: nothing sensitive leaves CORVEN", () => {
  it("the data given to Arkiv is only references, the hash and the sealed metadata", async () => {
    use();
    const { admin, inc, e } = await evidence("TITLE-MUST-NOT-LEAVE");
    await anchor(admin, e.id);
    const sent = fake.inputs[0]!;
    expect(Object.keys(sent).sort()).toEqual(["contentHash", "createdAt", "evidenceId", "incidentId", "organizationId", "previousHash", "schemaVersion", "sequence"]);
    // what the chain actually stores is derived from that input
    const stored = JSON.stringify([...fake.entities.values()], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    for (const forbidden of ["TITLE-MUST-NOT-LEAVE", "PII-LIKE-DETAIL", "private-operator-note", admin.org, inc.id, e.id, "Anchoring"]) expect(stored, forbidden).not.toContain(forbidden);
    expect(stored).toContain(e.contentHash);
  });
});

describe("tenant isolation and observability", () => {
  it("another organization sees nothing: anchors, entity reads, incident queries and stats are all scoped", async () => {
    use();
    const { admin, op, inc, e } = await evidence();
    await anchor(admin, e.id);
    const other = who("admin");
    expect((await api.get(`${E}/${e.id}/arkiv`, other)).status).toBe(404);
    expect((await api.get(`${E}/arkiv/incidents/${inc.id}`, other)).status).toBe(404);
    expect((await api.post(`${E}/${e.id}/anchor`, other, { targets: ["arkiv"] })).status).toBe(404);
    expect((await api.get(`${E}/arkiv/stats`, other)).body.data).toMatchObject({ pending: 0, confirmed: 0, failed: 0 });
    expect((await api.get(`${E}/arkiv/incidents/${inc.id}`, op)).body.data).toMatchObject({ queried: true, entities: [{ entityKey: expect.stringMatching(/^0x/) }] });
  });

  it("reports counts, retries and error categories without secrets or incident content", async () => {
    use();
    fake.publishErrors.push(new ArkivError("ARKIV_RATE_LIMITED", "Arkiv rate limit reached"));
    const a1 = await evidence();
    await anchor(a1.admin, a1.e.id); // failed, retryable
    const stats = (await api.get(`${E}/arkiv/stats`, a1.op)).body.data;
    expect(stats).toMatchObject({ pending: 0, confirmed: 0, failed: 1, failedRetryable: 1, failedPermanent: 0, totalAttempts: 1, errorsByCode: { ARKIV_RATE_LIMITED: 1 }, state: expect.any(String) });
    advance(31_000);
    await maintain();
    const after = (await api.get(`${E}/arkiv/stats`, a1.op)).body.data;
    expect(after).toMatchObject({ confirmed: 1, failed: 0, totalAttempts: 2 });
    expect(JSON.stringify(after)).not.toMatch(/0x[0-9a-f]{64}|TITLE|PII/);
  });

  it("health is available to administrators only and states why Arkiv is off when it is", async () => {
    const { op, admin } = await evidence();
    expect((await api.get(`${E}/arkiv/health`, op)).status).toBe(403);
    expect((await api.get(`${E}/arkiv/health`, who("viewer", op.org))).status).toBe(403);
    ctx.evidenceConfig.arkiv = null;
    ctx.evidenceConfig.arkivState = { state: "not_configured", reason: "ARKIV_ACCESS_KEY is empty", missing: ["ARKIV_ACCESS_KEY"] };
    expect((await api.get(`${E}/arkiv/health`, admin)).body.data).toEqual({ status: "not_configured", reason: "ARKIV_ACCESS_KEY is empty", missing: ["ARKIV_ACCESS_KEY"], health: null });
    ctx.evidenceConfig.arkivState = { state: "disabled", reason: "ARKIV_ENABLED=false" };
    expect((await api.get(`${E}/arkiv/health`, admin)).body.data).toMatchObject({ status: "disabled" });
    // and an attempt to anchor says so loudly instead of silently succeeding with something else
    const fresh = await evidence();
    const r = await anchor(fresh.admin, fresh.e.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("TARGET_NOT_CONFIGURED");
    ctx.evidenceConfig.arkivState = original.state as never;
  });

  it("emits structured logs that never contain keys or incident content", async () => {
    use();
    logs.length = 0;
    const { admin, e } = await evidence("TITLE-MUST-NOT-LEAVE");
    fake.publishErrors.push(new ArkivError("ARKIV_NETWORK", "arkiv unavailable"));
    await anchor(admin, e.id);
    advance(31_000);
    await maintain();
    expect(logs.map((l) => l.event)).toEqual(expect.arrayContaining(["arkiv.anchor.attempt", "arkiv.anchor.failed", "arkiv.anchor.confirmed"]));
    const dump = JSON.stringify(logs);
    for (const forbidden of [SECRET, "TITLE-MUST-NOT-LEAVE", "PII-LIKE-DETAIL", "private-operator-note", "X-API-KEY"]) expect(dump).not.toContain(forbidden);
  });

  it("the Arkiv status endpoints never expose configuration secrets", async () => {
    use();
    const { admin } = await evidence();
    const body = JSON.stringify([(await api.get(`${E}/arkiv/health`, admin)).body, (await api.get(`${E}/arkiv/stats`, admin)).body]);
    expect(body).not.toMatch(/ACCESS_KEY|PRIVATE_KEY|X-API-KEY|apiKey/i);
  });
});
