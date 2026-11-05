import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authority, operational, resourceDep, mkAgent, mkResource, mkAgents } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const D = "/api/v1/dependencies";

describe("registration of the three dependency types", () => {
  it("registers an authority dependency (agent -> agent)", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const res = await api.post(D, op, authority(a, b, { confidence: 0.9 }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      organizationId: op.org, sourceType: "agent", sourceId: a, targetType: "agent", targetId: b,
      dependencyType: "authority", status: "active", version: 1, confidence: 0.9,
      metadata: { scope: "payment.execute" }, provenance: { source: "manual" },
    });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("registers a resource dependency (agent -> resource)", async () => {
    const op = who("operator");
    const [a, r] = [await mkAgent(api, op), await mkResource(api, op)];
    const res = await api.post(D, op, resourceDep(a, r));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ dependencyType: "resource", targetType: "resource", targetId: r, confidence: 1 });
  });

  it("registers operational dependencies in every allowed direction, and they imply no authority", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const r = await mkResource(api, op, undefined, "workflow");
    expect((await api.post(D, op, operational(a, b))).status).toBe(201);
    expect((await api.post(D, op, { ...operational(a, r), targetType: "resource" })).status).toBe(201);
    expect((await api.post(D, op, { ...operational(r, a), sourceType: "resource", targetType: "agent" })).status).toBe(201);
    // An operational edge never counts as authority: filtering by authority finds nothing.
    const auth = await api.get(`${D}?dependencyType=authority`, op);
    expect(auth.body.data).toHaveLength(0);
  });

  it("rejects a duplicate (same pair and type) with a clear 409, even if the first is inactive", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const first = (await api.post(D, op, authority(a, b))).body.data;
    const dup = await api.post(D, op, authority(a, b, { relationship: "other_label" }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DEPENDENCY_EXISTS");
    await api.delete(`${D}/${first.id}`, op);
    const again = await api.post(D, op, authority(a, b));
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/inactive/);
    expect(again.raw).not.toMatch(/dependencies_pair_unique|duplicate key/i);
  });

  it("allows the same pair under a different dependency type", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    expect((await api.post(D, op, authority(a, b))).status).toBe(201);
    expect((await api.post(D, op, operational(a, b))).status).toBe(201);
  });

  it("treats direction as meaningful: a->b and b->a are different relationships", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    expect((await api.post(D, op, operational(a, b))).status).toBe(201);
    expect((await api.post(D, op, operational(b, a))).status).toBe(201);
  });
});

describe("request validation", () => {
  it("rejects an invalid dependency type, entity type and status values", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    expect((await api.post(D, op, authority(a, b, { dependencyType: "friendship" }))).status).toBe(400);
    expect((await api.post(D, op, authority(a, b, { sourceType: "workflow" }))).status).toBe(400);
    expect((await api.get(`${D}?status=deleted`, op)).status).toBe(400);
    expect((await api.get(`${D}?dependencyType=bogus`, op)).status).toBe(400);
  });

  it.each([
    ["non-uuid sourceId", { sourceId: "nope" }],
    ["confidence above 1", { confidence: 1.1 }],
    ["confidence below 0", { confidence: -0.1 }],
    ["blank relationship", { relationship: "  " }],
    ["bad date", { observedAt: "yesterday" }],
    ["unknown provenance source", { provenance: { source: "rumour" } }],
    ["unknown provenance field", { provenance: { source: "manual", secret: "x" } }],
    ["unknown top-level field", { version: 5 }],
    ["client-supplied organizationId", { organizationId: "11111111-1111-4111-8111-111111111111" }],
    ["client-supplied status", { status: "inactive" }],
    ["client-supplied id", { id: "11111111-1111-4111-8111-111111111111" }],
  ])("rejects %s (400)", async (_l, over) => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const res = await api.post(D, op, authority(a, b, over));
    expect(res.status).toBe(400);
  });

  it("rejects an uppercase / malformed relationship label", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    expect((await api.post(D, op, authority(a, b, { relationship: "Delegates Authority" }))).status).toBe(400);
  });

  it("requires per-type metadata (422)", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const r = await mkResource(api, op);
    for (const [body, code] of [
      [authority(a, b, { metadata: {} }), "MISSING_REQUIRED_METADATA"],
      [authority(a, b, { metadata: { scope: "Not A Scope" } }), "MISSING_REQUIRED_METADATA"],
      [resourceDep(a, r, { metadata: {} }), "MISSING_REQUIRED_METADATA"],
      [resourceDep(a, r, { metadata: { accessLevel: "root" } }), "MISSING_REQUIRED_METADATA"],
    ] as const) {
      const res = await api.post(D, op, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(code);
    }
  });

  it("rejects secrets in metadata", async () => {
    const op = who("operator");
    const [a, b] = [await mkAgent(api, op), await mkAgent(api, op)];
    const res = await api.post(D, op, authority(a, b, { metadata: { scope: "a.b", api_key: "abc" } }));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/secret/i);
  });
});

describe("provenance, confidence and freshness", () => {
  it("defaults confidence to 1 only for manual provenance; other sources must state it", async () => {
    const op = who("operator");
    const [a, b, c] = [await mkAgent(api, op), await mkAgent(api, op), await mkAgent(api, op)];
    const inferred = await api.post(D, op, operational(a, b, { provenance: { source: "inferred", reference: "trace-123" } }));
    expect(inferred.status).toBe(422);
    expect(inferred.body.error.code).toBe("CONFIDENCE_REQUIRED");
    const ok = await api.post(D, op, operational(a, c, { provenance: { source: "discovered", note: "seen in logs" }, confidence: 0.4 }));
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ confidence: 0.4, provenance: { source: "discovered", note: "seen in logs" } });
  });

  it("accepts boundary confidences 0 and 1", async () => {
    const op = who("operator");
    const [a, b, c] = [await mkAgent(api, op), await mkAgent(api, op), await mkAgent(api, op)];
    expect((await api.post(D, op, operational(a, b, { confidence: 0 }))).body.data.confidence).toBe(0);
    expect((await api.post(D, op, operational(a, c, { confidence: 1 }))).body.data.confidence).toBe(1);
  });

  it("stores observedAt / lastVerifiedAt and rejects future or inverted times", async () => {
    const op = who("operator");
    const [a, b, c, d] = await mkAgents(api, op, 4);
    const ok = await api.post(D, op, operational(a, b, { observedAt: "2026-01-01T00:00:00Z", lastVerifiedAt: "2026-02-01T00:00:00Z" }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.observedAt).toBe("2026-01-01T00:00:00.000Z");
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const f = await api.post(D, op, operational(a, c, { observedAt: future }));
    expect(f.status).toBe(422);
    expect(f.body.error.code).toBe("INVALID_FRESHNESS");
    const inv = await api.post(D, op, operational(a, d, { observedAt: "2026-02-01T00:00:00Z", lastVerifiedAt: "2026-01-01T00:00:00Z" }));
    expect(inv.status).toBe(422);
  });
});

