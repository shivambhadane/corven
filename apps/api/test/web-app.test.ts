import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { buildApp } from "../src/app.js";
import { failClosedAuthenticator } from "../src/auth/dev-auth.js";
import { createDb, type DbHandle } from "../src/db/client.js";

let dir: string;
let handle: DbHandle;
let app: FastifyInstance;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "corven-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), '<!doctype html><div id="root"></div><title>CORVEN</title>');
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1)");
  handle = createDb(inject("dbUrl"));
  app = await buildApp({ db: handle.db, authenticate: failClosedAuthenticator, web: { dir } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("web app serving", () => {
  it("serves the app shell at / without authentication, revalidated every time", async () => {
    const res = await app.inject({ url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="root"');
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("answers client-side routes with the shell so deep links and refreshes work, including the old /console/ path", async () => {
    for (const url of ["/login", "/signup", "/forgot-password", "/verify-email", "/onboarding", "/app", "/app/", "/console/", "/console/anything?x=1"]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('id="root"');
    }
  });

  it("caches content-hashed assets for a year", async () => {
    const res = await app.inject({ url: "/assets/index-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("keeps real 404s for missing files and unknown API routes, and never leaks the shell for them", async () => {
    expect((await app.inject({ url: "/assets/missing.js" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/favicon.ico" })).statusCode).toBe(404);
    const api = await app.inject({ url: "/api/v1/does-not-exist" });
    expect(api.statusCode).toBe(401); // the API still requires authentication first
    expect(api.body).not.toContain("root");
    expect((await app.inject({ method: "POST", url: "/login" })).statusCode).toBe(404);
  });

  it("the API stays authenticated while the shell is public, and sets defensive headers", async () => {
    expect((await app.inject({ url: "/api/v1/agents" })).statusCode).toBe(401);
    const h = (await app.inject({ url: "/" })).headers;
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
  });
});
