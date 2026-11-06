import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(() => ctx.close());

describe("SaaS: M2M API Keys", () => {
  it("allows admin to create an API key with crv_live_ prefix", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    const res = await c.post("/api/v1/saas/api-keys", admin, {
      name: "CI/CD Deployment Bot",
      scopes: ["agents:read", "containment:execute"],
      expiresInDays: 30,
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.name).toBe("CI/CD Deployment Bot");
    expect(res.body.data.prefix.startsWith("crv_live_")).toBe(true);
    expect(res.body.data.rawKey.startsWith("crv_live_")).toBe(true);
    expect(res.body.data.rawKey.length).toBeGreaterThan(40);
    expect(res.body.data.scopes).toEqual(["agents:read", "containment:execute"]);
    expect(res.body.data.expiresAt).not.toBeNull();
  });

  it("forbids non-admin (e.g. viewer or operator) from creating API keys", async () => {
    const c = client(ctx.app);
    const viewer = who("viewer");

    const res = await c.post("/api/v1/saas/api-keys", viewer, {
      name: "Sneaky Viewer Key",
    });

    expect(res.status).toBe(403);
  });

  it("lists API keys for the calling organization", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    await c.post("/api/v1/saas/api-keys", admin, { name: "Key 1" });
    await c.post("/api/v1/saas/api-keys", admin, { name: "Key 2" });

    const listRes = await c.get("/api/v1/saas/api-keys", admin);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBe(2);
    // Listing must NEVER return rawKey (only prefix)
    for (const k of listRes.body.data) {
      expect(k.rawKey).toBeUndefined();
      expect(k.prefix.startsWith("crv_live_")).toBe(true);
    }
  });

  it("authenticates requests using Authorization: Bearer crv_live_...", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    const created = await c.post("/api/v1/saas/api-keys", admin, {
      name: "Bearer Key",
      scopes: ["*"],
    });
    const rawKey = created.body.data.rawKey;

    // Use rawKey with Authorization Bearer header
    const authRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/saas/api-keys",
      headers: {
        authorization: `Bearer ${rawKey}`,
      },
    });

    expect(authRes.statusCode).toBe(200);
    const body = authRes.json();
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("authenticates requests using x-api-key: crv_live_...", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    const created = await c.post("/api/v1/saas/api-keys", admin, {
      name: "X-Api-Key Header Key",
      scopes: ["*"],
    });
    const rawKey = created.body.data.rawKey;

    const authRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/saas/api-keys",
      headers: {
        "x-api-key": rawKey,
      },
    });

    expect(authRes.statusCode).toBe(200);
  });

  it("allows revoking an API key and subsequent authentication is rejected", async () => {
    const c = client(ctx.app);
    const admin = who("admin");

    const created = await c.post("/api/v1/saas/api-keys", admin, {
      name: "Temporary Key",
    });
    const keyId = created.body.data.id;
    const rawKey = created.body.data.rawKey;

    // Revoke key
    const delRes = await c.delete(`/api/v1/saas/api-keys/${keyId}`, admin);
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.revokedAt).not.toBeNull();

    // Trying to use revoked key must fail with 401
    const testRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/saas/api-keys",
      headers: {
        "x-api-key": rawKey,
      },
    });
    expect(testRes.statusCode).toBe(401);
  });

  it("rejects an invalid or tampered API key", async () => {
    const testRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/saas/api-keys",
      headers: {
        authorization: "Bearer crv_live_fakefakefakefakefakefakefakefake",
      },
    });
    expect(testRes.statusCode).toBe(401);
  });
});
