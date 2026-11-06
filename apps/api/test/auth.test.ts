import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { failClosedAuthenticator } from "../src/auth/dev-auth.js";
import { defaultEvidenceConfig } from "../src/modules/evidence-service/index.js";
import { defaultAgentAuthConfig, ResourceExecutors } from "../src/modules/authorization-gateway/index.js";
import { InlineJobQueue } from "../src/modules/dependency-discovery/jobs/queue.js";
import { client, createCtx, validAgent, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

describe("authentication boundary", () => {
  it("rejects unauthenticated requests on every agent route", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const calls: [string, string][] = [
      ["POST", "/api/v1/agents"],
      ["GET", "/api/v1/agents"],
      ["GET", `/api/v1/agents/${id}`],
      ["PATCH", `/api/v1/agents/${id}`],
      ["POST", `/api/v1/agents/${id}/status`],
      ["GET", `/api/v1/agents/${id}/history`],
      ["PUT", `/api/v1/agents/${id}/capabilities`],
      ["PUT", `/api/v1/agents/${id}/identities`],
    ];
    for (const [m, url] of calls) {
      const res = await ctx.app.inject({ method: m as "GET", url, payload: m === "GET" ? undefined : {} });
      expect(res.statusCode, `${m} ${url}`).toBe(401);
    }
  });

  it("rejects malformed dev headers", async () => {
    const bad = [
      { "x-dev-actor-id": "nope", "x-dev-org-id": "nope", "x-dev-role": "admin" },
      { "x-dev-actor-id": who("admin").actor, "x-dev-org-id": who("admin").org, "x-dev-role": "root" },
    ];
    for (const headers of bad) {
      expect((await ctx.app.inject({ method: "GET", url: "/api/v1/agents", headers })).statusCode).toBe(401);
    }
  });

  it("fails closed when only the default authenticator is configured", async () => {
    const app = await buildApp({ db: ctx.handle.db, authenticate: failClosedAuthenticator });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agents",
      headers: { "x-dev-actor-id": who("admin").actor, "x-dev-org-id": who("admin").org, "x-dev-role": "admin" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("the organization comes from the principal, never from the request", async () => {
    const op = who("operator");
    const a = (await api.post("/api/v1/agents", op, validAgent())).body.data;
    expect(a.organizationId).toBe(op.org);
    const withQuery = await api.get(`/api/v1/agents?organizationId=${who("admin").org}`, op);
    expect(withQuery.status).toBe(400);
  });

  it("health is public and unknown routes return a JSON 404 envelope", async () => {
    const health = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });

    const live = await ctx.app.inject({ method: "GET", url: "/health/live" });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });

    const ready = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready" });

    const readyQuery = await ctx.app.inject({ method: "GET", url: "/health?probe=readiness" });
    expect(readyQuery.statusCode).toBe(200);
    expect(readyQuery.json()).toEqual({ status: "ready" });

    const res = await api.get("/api/v1/nope", who("admin"));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("malformed JSON yields a safe 400", async () => {
    const op = who("operator");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/agents",
      headers: { "content-type": "application/json", "x-dev-actor-id": op.actor, "x-dev-org-id": op.org, "x-dev-role": "operator" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBeDefined();
  });

  it("readiness probe returns 503 unready when database fails", async () => {
    const brokenDb = {
      ...ctx.handle.db,
      execute: async () => {
        throw new Error("connection terminated");
      },
    } as unknown as typeof ctx.handle.db;

    const failingApp = await buildApp({
      evidenceConfig: defaultEvidenceConfig(),
      db: brokenDb,
      authenticate: failClosedAuthenticator,
      discoveryQueue: new InlineJobQueue(),
      gatewayOptions: { agentAuth: defaultAgentAuthConfig(null), executors: new ResourceExecutors() },
      logger: false,
    });

    const res = await failingApp.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unready" });

    const queryRes = await failingApp.inject({ method: "GET", url: "/health?probe=readiness" });
    expect(queryRes.statusCode).toBe(503);
    expect(queryRes.json()).toEqual({ status: "unready" });

    // Liveness remains ok even when DB is failing (ALB won't restart immediately if just unready)
    const liveRes = await failingApp.inject({ method: "GET", url: "/health/live" });
    expect(liveRes.statusCode).toBe(200);
    expect(liveRes.json()).toEqual({ status: "ok" });

    await failingApp.close();
  });
});
