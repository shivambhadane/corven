import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { buildApp } from "../src/app.js";
import { failClosedAuthenticator } from "../src/auth/dev-auth.js";
import { createDb } from "../src/db/client.js";
import { DemoTokens, demoActor } from "../src/modules/demo/index.js";
import { client, createCtx, who, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(() => ctx.close());

const start = async () => {
  const res = await ctx.app.inject({ method: "POST", url: "/api/v1/demo/sessions", remoteAddress: `10.0.0.${Math.floor(Math.random() * 250) + 1}` });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data as { token: string; organizationId: string; agents: Array<{ key: string; id: string }>; resources: Array<{ key: string; id: string }>; credentialsIssued: boolean };
};
const as = (token: string, persona = "operator") => ({ "x-corven-demo": token, "x-corven-demo-persona": persona });
const req = async (method: "GET" | "POST" | "PUT", url: string, headers: Record<string, string>, payload?: object) => {
  const res = await ctx.app.inject({ method, url: `/api/v1${url}`, headers, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() as any };
};

describe("public demo: sandbox", () => {
  it("needs no account and seeds the deterministic Acme network: 5 agents, 3 resources, 7 dependencies", async () => {
    const d = await start();
    expect(d.agents.map((a) => a.key)).toEqual(["support", "payment", "database", "analytics", "email"]);
    expect(d.resources.map((r) => r.key)).toEqual(["customerApi", "wallet", "emailProvider"]);
    expect(d.credentialsIssued).toBe(true);
    const g = await req("GET", "/graph/export", as(d.token));
    expect(g.status).toBe(200);
    expect(g.body.data.nodes).toHaveLength(8);
    expect(g.body.data.edges).toHaveLength(7);
  });

  it("runs the REAL response end to end: analysis, plan, human approval, enforcement, verification, evidence", async () => {
    const d = await start();
    const id = (k: string) => d.agents.find((a) => a.key === k)!.id;
    const incRes = await req("POST", "/incidents", as(d.token), { title: "Support Agent credentials compromised", severity: "critical", agents: [{ agentId: id("support"), relationship: "compromised" }] });
    expect(incRes.status, JSON.stringify(incRes.body)).toBe(201);
    const inc = incRes.body.data;
    const wfRes = await req("POST", "/workflows", as(d.token), { incidentId: inc.id });
    expect(wfRes.status, JSON.stringify(wfRes.body)).toBe(201);
    const wf = wfRes.body.data;
    let w = (await req("POST", `/workflows/${wf.id}/run`, as(d.token), {})).body.data;
    expect(`${w.status}/${w.step}`).toBe("waiting/awaiting_approval");
    const detail = (await req("GET", `/incidents/${inc.id}`, as(d.token))).body.data;
    expect(detail.current.containmentPlan.planStatus).toBe("feasible");
    expect((await req("GET", `/enforcement?incidentId=${inc.id}`, as(d.token, "admin"))).body.pagination.total).toBe(0);

    // the operator who started the response cannot approve it; the separate approver persona can
    const approval = (await req("GET", `/approvals?incidentId=${inc.id}&status=pending`, as(d.token, "approver"))).body.data[0];
    expect((await req("POST", `/approvals/${approval.id}/approve`, as(d.token, "operator"), { comment: "self" })).status).toBe(403);
    expect((await req("POST", `/approvals/${approval.id}/approve`, as(d.token, "approver"), { comment: "demo approval" })).body.data.status).toBe("approved");

    w = (await req("POST", `/workflows/${wf.id}/run`, as(d.token), {})).body.data;
    expect(w.status).toBe("completed");
    expect((await req("GET", `/incidents/${inc.id}`, as(d.token))).body.data.status).toBe("contained");
    expect((await req("GET", `/incidents/${inc.id}/verification`, as(d.token))).body.data[0].status).toBe("passed");
    const actions = (await req("GET", `/enforcement?incidentId=${inc.id}`, as(d.token, "admin"))).body.data;
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a: { status: string }) => a.status === "executed")).toBe(true);
    const ev = (await req("GET", `/evidence/${w.evidenceId}`, as(d.token))).body.data;
    expect(ev.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await req("POST", `/evidence/${ev.id}/verify`, as(d.token), {})).body.data.valid).toBe(true);
  });

  it("reset is a new, clean sandbox: none of the previous session's incidents are visible", async () => {
    const a = await start();
    await req("POST", "/incidents", as(a.token), { title: "old", severity: "low" });
    const b = await start();
    expect(b.organizationId).not.toBe(a.organizationId);
    expect((await req("GET", "/incidents", as(b.token))).body.data).toHaveLength(0);
  });
});

describe("public demo: isolation and limits", () => {
  it("a demo token sees only its own sandbox, never another organization's data", async () => {
    const d = await start();
    const c = client(ctx.app);
    const victim = who("admin");
    const agent = (await c.post("/api/v1/agents", victim, { name: "private-agent", agentType: "llm" })).body.data;
    expect((await req("GET", `/agents/${agent.id}`, as(d.token))).status).toBe(404);
    // dev headers alongside a demo token do not widen access: the demo token wins and stays confined
    const mixed = await ctx.app.inject({ method: "GET", url: `/api/v1/agents/${agent.id}`, headers: { ...as(d.token), "x-dev-actor-id": victim.actor, "x-dev-org-id": victim.org, "x-dev-role": "admin" } });
    expect(mixed.statusCode).toBe(404);
  });

  it("cannot reach account features: API keys, webhooks, members, organization settings", async () => {
    const d = await start();
    for (const url of ["/saas/api-keys", "/saas/webhooks", "/saas/organizations/members", "/saas/organizations/current"]) {
      expect((await req("GET", url, as(d.token, "admin"))).status, url).toBe(403);
    }
    expect((await req("POST", "/saas/webhooks", as(d.token, "admin"), { url: "http://169.254.169.254/" })).status).toBe(403);
  });

  it("rejects tampered, expired and foreign tokens, and personas that are not offered", async () => {
    const d = await start();
    const [head, sig] = d.token.split(".");
    expect((await req("GET", "/incidents", { "x-corven-demo": `${head}.${sig!.slice(0, -2)}xx` })).status).toBe(401);
    expect((await req("GET", "/incidents", { "x-corven-demo": d.token.replace("cdemo_", "cdemo_x") })).status).toBe(401);
    const foreign = new DemoTokens().issue(d.organizationId, 600).token; // signed with a different key
    expect((await req("GET", "/incidents", { "x-corven-demo": foreign })).status).toBe(401);
    for (const persona of ["system", "viewer", "root"]) expect((await req("GET", "/incidents", as(d.token, persona))).status, persona).toBe(401);

    const later = new DemoTokens(Buffer.alloc(32, 1), () => new Date(Date.now() + 3 * 3600_000));
    const issued = new DemoTokens(Buffer.alloc(32, 1)).issue(d.organizationId, 3600).token;
    expect(later.verify(issued)).toBeNull();
    expect(new DemoTokens(Buffer.alloc(32, 1)).verify(issued)?.org).toBe(d.organizationId);
  });

  it("personas are distinct actors so separation of duties applies", () => {
    const org = "11111111-1111-4111-8111-111111111111";
    expect(new Set(["admin", "operator", "approver"].map((p) => demoActor(org, p as "admin")))).toHaveProperty("size", 3);
    expect(demoActor(org, "operator")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("limits how many sandboxes one client can start, and can be switched off", async () => {
    const handle = createDb(inject("dbUrl"));
    const limited = await buildApp({ db: handle.db, authenticate: failClosedAuthenticator, demo: { perClientPerHour: 2 } });
    const off = await buildApp({ db: handle.db, authenticate: failClosedAuthenticator, demo: false });
    try {
      const go = () => limited.inject({ method: "POST", url: "/api/v1/demo/sessions", remoteAddress: "10.9.9.9" });
      expect((await go()).statusCode).toBe(201);
      expect((await go()).statusCode).toBe(201);
      const third = await go();
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe("DEMO_RATE_LIMITED");
      expect([401, 404]).toContain((await off.inject({ method: "POST", url: "/api/v1/demo/sessions" })).statusCode);
    } finally {
      await limited.close();
      await off.close();
      await handle.close();
    }
  });
});
