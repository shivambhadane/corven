import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCtx, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(() => ctx.close());

const fill = (url: string) => url.replace(/:[A-Za-z]+/g, () => randomUUID());

describe("release audit: authentication on every route", () => {
  it("inventory is not empty and has the expected machine-facing routes", () => {
    const t = ctx.app.routeTable;
    expect(t.length).toBeGreaterThan(150);
    expect(t.filter((r) => r.auth === "agent").map((r) => r.url).sort()).toEqual(["/api/v1/gateway/check", "/api/v1/gateway/execute"]);
    expect(t.filter((r) => r.auth === "public").map((r) => r.url)).toEqual(["/api/v1/agent-auth/token"]);
  });

  it("every human route rejects an unauthenticated request with 401 before doing anything", async () => {
    const human = ctx.app.routeTable.filter((r) => r.auth === "human" && r.url !== "/health" && r.method !== "HEAD" && r.method !== "OPTIONS");
    const failures: string[] = [];
    for (const r of human) {
      const res = await ctx.app.inject({ method: r.method as "GET", url: fill(r.url), payload: r.method === "GET" || r.method === "DELETE" ? undefined : {} });
      if (res.statusCode !== 401) failures.push(`${r.method} ${r.url} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it("agent routes reject missing, malformed and human credentials", async () => {
    for (const url of ["/api/v1/gateway/check", "/api/v1/gateway/execute"]) {
      const body = { requestId: "r1", resource: "x", action: "read" };
      expect((await ctx.app.inject({ method: "POST", url, payload: body })).statusCode).toBe(401);
      expect((await ctx.app.inject({ method: "POST", url, payload: body, headers: { authorization: "Bearer not-a-token" } })).statusCode).toBe(401);
      expect((await ctx.app.inject({ method: "POST", url, payload: body, headers: { "x-dev-actor-id": randomUUID(), "x-dev-org-id": randomUUID(), "x-dev-role": "admin" } })).statusCode).toBe(401);
    }
  });

  it("the system role and unknown roles cannot be claimed over HTTP", async () => {
    for (const role of ["system", "root", "owner", ""]) {
      const res = await ctx.app.inject({ method: "GET", url: "/api/v1/incidents", headers: { "x-dev-actor-id": randomUUID(), "x-dev-org-id": randomUUID(), "x-dev-role": role } });
      expect(res.statusCode, role).toBe(401);
    }
  });

  it("unknown routes and methods do not leak internals", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/does-not-exist", headers: { "x-dev-actor-id": randomUUID(), "x-dev-org-id": randomUUID(), "x-dev-role": "admin" } });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(/stack|at \w+ \(|select |relation/i);
  });
});

describe("release audit: the permission matrix", () => {
  it("only the intended roles can decide, enforce or anchor", async () => {
    const { can } = await import("../src/auth/permissions.js");
    const roles = ["admin", "operator", "viewer", "approver", "system"] as const;
    const holders = (perm: Parameters<typeof can>[1]) => roles.filter((r) => can({ actorId: "a", organizationId: "o", role: r }, perm));
    expect(holders("approval:decide")).toEqual(["admin", "approver"]);
    expect(holders("enforcement:apply")).toEqual(["admin", "system"]);
    expect(holders("evidence:anchor")).toEqual(["admin", "system"]);
    expect(holders("credential:manage")).toEqual(["admin"]);
    expect(holders("permission:write")).toEqual(["admin"]);
    expect(holders("approval:policy")).toEqual(["admin"]);
    expect(holders("incident:recover")).toEqual(["admin"]);
    expect(holders("incident:event")).toEqual(["system"]);
    expect(holders("agent:recover")).toEqual(["admin"]);
    // a viewer holds no write permission of any kind
    const viewerPerms = (await import("../src/auth/permissions.js")).can;
    for (const p of ["agent:write", "dependency:write", "resource:write", "snapshot:write", "discovery:write", "incident:write", "incident:transition", "approval:request", "verification:run", "evidence:generate", "workflow:run"] as const) {
      expect(viewerPerms({ actorId: "a", organizationId: "o", role: "viewer" }, p), p).toBe(false);
    }
  });
});
