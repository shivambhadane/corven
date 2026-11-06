import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { systemPrincipal } from "../src/auth/system.js";
import { signToken } from "../src/modules/authorization-gateway/core/jwt.js";
import { SimulatedExecutor, type ResourceExecutor } from "../src/modules/authorization-gateway/index.js";
import { authority, createDep, mkAgent, mkResource, operational, resourceDep } from "./dep-helpers.js";
import { client, createCtx, uniqueName, who, type TestCtx, type Who } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);
const sys = (org: string) => systemPrincipal(org, randomUUID());
const gw = () => ctx.app.gateway;

/** Machine-facing call: bearer token, no human headers. */
async function agentCall(token: string | null, url: string, body: unknown, extra: Record<string, string> = {}) {
  const res = await ctx.app.inject({ method: "POST", url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, payload: body as object });
  let json: any = null;
  try { json = res.json(); } catch { /* */ }
  return { status: res.statusCode, body: json, raw: res.body, headers: res.headers };
}
const exec = (token: string, body: Record<string, unknown>) => agentCall(token, "/api/v1/gateway/execute", { requestId: randomUUID(), ...body });

/** Org with an admin, two agents and two resources, all with tokens. */
async function world() {
  const admin = who("admin");
  const op = who("operator", admin.org);
  const support = await mkAgent(api, admin);
  const payment = await mkAgent(api, admin);
  const wallet = await mkResource(api, admin, uniqueName("wallet"));
  const customerApi = await mkResource(api, admin, uniqueName("customer-api"));
  const executor = new SimulatedExecutor();
  ctx.executors.register(wallet, executor);
  ctx.executors.register(customerApi, executor);
  const w = { admin, op, support, payment, wallet, customerApi, executor };
  return w;
}
const issue = async (w: Who, agentId: string) => {
  const r = await api.post("/api/v1/agent-auth/credentials", w, { agentId });
  if (r.status !== 201) throw new Error(r.raw);
  return r.body.data as { credentialId: string; credential: string };
};
const tokenFor = async (w: Who, agentId: string) => {
  const c = await issue(w, agentId);
  const r = await agentCall(null, "/api/v1/agent-auth/token", { credential: c.credential });
  if (r.status !== 200) throw new Error(r.raw);
  return { token: r.body.data.token as string, ...c };
};
const grant = async (w: Who, agentId: string, resourceId: string, action = "transfer", constraints?: object) => {
  const r = await api.post("/api/v1/permissions", w, { agentId, resourceId, action, ...(constraints ? { constraints } : {}) });
  if (r.status !== 201) throw new Error(r.raw);
  return r.body.data;
};

describe("credentials and tokens", () => {
  it("issues a credential once, stores only its hash, and exchanges it for a short-lived token", async () => {
    const w = await world();
    const c = await issue(w.admin, w.support);
    expect(c.credential).toMatch(/^cvn_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const secret = c.credential.split(".")[1]!;
    const row = (await q("select secret_hash from agent_credentials where id=$1", [c.credentialId])).rows[0];
    expect(row.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify((await q("select * from gateway_audit_logs where target_id=$1", [c.credentialId])).rows)).not.toContain(secret);
    expect(JSON.stringify((await q("select * from credential_rotation_history where credential_id=$1", [c.credentialId])).rows)).not.toContain(secret);

    const r = await agentCall(null, "/api/v1/agent-auth/token", { credential: c.credential });
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body.data).toMatchObject({ tokenType: "Bearer", expiresIn: 300 });
    const payload = JSON.parse(Buffer.from(r.body.data.token.split(".")[1], "base64url").toString());
    expect(payload).toMatchObject({ iss: "corven", aud: "corven-gateway", sub: w.support, org: w.admin.org, cid: c.credentialId });
    expect(payload.exp - payload.iat).toBe(300);
  });

  it("only an administrator manages credentials; one active credential per agent", async () => {
    const w = await world();
    for (const who_ of [w.op, who("viewer", w.admin.org)]) expect((await api.post("/api/v1/agent-auth/credentials", who_, { agentId: w.support })).status).toBe(403);
    await issue(w.admin, w.support);
    const again = await api.post("/api/v1/agent-auth/credentials", w.admin, { agentId: w.support });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CREDENTIAL_EXISTS");
    expect((await api.post("/api/v1/agent-auth/credentials", w.admin, { agentId: randomUUID() })).body.error.code).toBe("AGENT_NOT_FOUND");
    expect((await api.post("/api/v1/agent-auth/credentials", w.admin, { agentId: w.payment, expiresAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
  });

  it("every credential failure looks the same", async () => {
    const w = await world();
    const c = await issue(w.admin, w.support);
    const wrongSecret = `cvn_${c.credentialId}.${"A".repeat(43)}`;
    const unknownId = `cvn_${randomUUID()}.${c.credential.split(".")[1]}`;
    const results = [await agentCall(null, "/api/v1/agent-auth/token", { credential: wrongSecret }), await agentCall(null, "/api/v1/agent-auth/token", { credential: unknownId }), await agentCall(null, "/api/v1/agent-auth/token", { credential: "garbage-garbage" })];
    for (const r of results) expect(r.body.error).toEqual({ code: "INVALID_CREDENTIAL", message: "The credential is invalid, expired or revoked" });
    expect((await agentCall(null, "/api/v1/agent-auth/token", {})).status).toBe(400);
    expect((await agentCall(null, "/api/v1/agent-auth/token", { credential: c.credential, agentId: w.payment })).status).toBe(400);
  });

  it("rotation revokes the old credential and its tokens immediately", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(200);

    expect((await api.post("/api/v1/agent-auth/rotate", w.op, { agentId: w.support, reason: "scheduled" })).status).toBe(403);
    const rot = await api.post("/api/v1/agent-auth/rotate", w.admin, { agentId: w.support, reason: "scheduled rotation" });
    expect(rot.status).toBe(200);
    expect(rot.body.data.credentialId).not.toBe(a.credentialId);

    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).body.error.code).toBe("INVALID_TOKEN"); // old token dies at once
    expect((await agentCall(null, "/api/v1/agent-auth/token", { credential: a.credential })).status).toBe(401);
    const fresh = await agentCall(null, "/api/v1/agent-auth/token", { credential: rot.body.data.credential });
    expect((await exec(fresh.body.data.token, { resource: w.wallet, action: "transfer" })).status).toBe(200);

    const hist = (await api.get(`/api/v1/agent-auth/credentials/${w.support}/history`, w.admin)).body.data;
    expect(hist.map((h: any) => h.action)).toEqual(["issued", "rotated"]);
    expect(hist[1]).toMatchObject({ previousCredentialId: a.credentialId, reason: "scheduled rotation" });
    expect((await api.post("/api/v1/agent-auth/rotate", w.admin, { agentId: w.payment, reason: "x" })).body.error.code).toBe("NO_ACTIVE_CREDENTIAL");
  });

  it("revocation takes effect on tokens already issued", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(200);
    expect((await api.post("/api/v1/agent-auth/revoke", w.admin, { agentId: w.support, reason: "lost credential" })).body.data).toMatchObject({ revoked: true, credentialId: a.credentialId });
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(401);
    expect((await api.post("/api/v1/agent-auth/revoke", w.admin, { agentId: w.support, reason: "again" })).body.data.revoked).toBe(false); // already none: a no-op, not an error
  });

  it("expired credentials and expired tokens are refused", async () => {
    const w = await world();
    const exp = await api.post("/api/v1/agent-auth/credentials", w.admin, { agentId: w.support, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    ctx.clock.offsetMs = 120_000;
    try {
      expect((await agentCall(null, "/api/v1/agent-auth/token", { credential: exp.body.data.credential })).status).toBe(401);
    } finally { ctx.clock.offsetMs = 0; }
    const a = await tokenFor(w.admin, w.payment);
    ctx.clock.offsetMs = 301_000; // past the 5 minute lifetime
    try {
      const r = await exec(a.token, { resource: w.wallet, action: "transfer" });
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe("INVALID_TOKEN");
    } finally { ctx.clock.offsetMs = 0; }
  });

  it("rejects forged, tampered, mis-addressed and missing tokens", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    const body = { resource: w.wallet, action: "transfer" };
    const other = await world();
    const claims = JSON.parse(Buffer.from(a.token.split(".")[1]!, "base64url").toString());
    const forgedBySomeoneElse = signToken(Buffer.alloc(32, 1), claims);
    const swappedAgent = signToken(Buffer.alloc(32, 7), { ...claims, sub: w.payment }); // validly signed, but credential belongs to another agent
    const swappedOrg = signToken(Buffer.alloc(32, 7), { ...claims, org: other.admin.org });
    const wrongAud = signToken(Buffer.alloc(32, 7), { ...claims, aud: "somewhere-else" });
    for (const t of [forgedBySomeoneElse, swappedAgent, swappedOrg, wrongAud, "x.y.z", "", a.token + "x"]) expect((await exec(t, body)).status, t.slice(0, 20)).toBe(401);
    expect((await agentCall(null, "/api/v1/gateway/execute", { requestId: "r", ...body })).status).toBe(401);
    expect((await ctx.app.inject({ method: "POST", url: "/api/v1/gateway/execute", headers: { authorization: `Basic ${a.token}` }, payload: { requestId: "r", ...body } })).statusCode).toBe(401);
    // a human principal is not an agent
    expect((await api.post("/api/v1/gateway/execute", w.admin, { requestId: "r", ...body })).status).toBe(401);
    // and an agent token is not a human principal
    const human = await ctx.app.inject({ method: "GET", url: "/api/v1/permissions", headers: { authorization: `Bearer ${a.token}` } });
    expect(human.statusCode).toBe(401);
  });

  it("agents that are not active cannot obtain or use tokens", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    await api.post(`/api/v1/agents/${w.support}/status`, w.admin, { status: "suspended", reason: "investigating" });
    const r = await exec(a.token, { resource: w.wallet, action: "transfer" });
    expect(r.status).toBe(403);
    expect(r.body.error.details.reasonCodes).toContain("AGENT_NOT_ACTIVE");
    expect((await agentCall(null, "/api/v1/agent-auth/token", { credential: a.credential })).status).toBe(401);

    const bad = await tokenFor(w.admin, w.payment);
    await grant(w.admin, w.payment, w.wallet);
    await api.post(`/api/v1/agents/${w.payment}/status`, w.admin, { status: "compromised", reason: "confirmed takeover" });
    expect((await exec(bad.token, { resource: w.wallet, action: "transfer" })).body.error.details.reasonCodes).toContain("AGENT_NOT_ACTIVE");
    expect((await agentCall(null, "/api/v1/agent-auth/token", { credential: bad.credential })).status).toBe(401);
  });

  it("agent authentication fails closed when no signing key is configured", async () => {
    const { AgentAuthService, defaultAgentAuthConfig } = await import("../src/modules/authorization-gateway/services/agent-auth.service.js");
    const svc = new AgentAuthService(ctx.handle.db, gw().repo, { getAgent: async () => null }, defaultAgentAuthConfig(null));
    await expect(svc.exchange(`cvn_${randomUUID()}.${"A".repeat(43)}`)).rejects.toMatchObject({ statusCode: 503, code: "AGENT_AUTH_UNAVAILABLE" });
    await expect(svc.authenticate("Bearer a.b.c")).rejects.toMatchObject({ statusCode: 503 });
    expect(() => new AgentAuthService(ctx.handle.db, gw().repo, { getAgent: async () => null }, defaultAgentAuthConfig(Buffer.alloc(8)))).toThrow(/32 bytes/);
  });
});

describe("permissions", () => {
  it("admins grant and revoke; others read or are refused", async () => {
    const w = await world();
    const viewer = who("viewer", w.admin.org);
    expect((await api.post("/api/v1/permissions", w.op, { agentId: w.support, resourceId: w.wallet, action: "transfer" })).status).toBe(403);
    const g = await grant(w.admin, w.support, w.wallet, "transfer", { maxAmount: 100 });
    expect(g).toMatchObject({ status: "active", version: 1, action: "transfer", constraints: { maxAmount: 100 }, grantedBy: w.admin.actor });
    expect((await api.post("/api/v1/permissions", w.admin, { agentId: w.support, resourceId: w.wallet, action: "transfer" })).body.error.code).toBe("PERMISSION_EXISTS");
    expect((await api.get(`/api/v1/permissions?agentId=${w.support}`, viewer)).body.pagination.total).toBe(1);
    expect((await api.get(`/api/v1/permissions/${g.id}`, w.op)).body.data.id).toBe(g.id);
    expect((await api.post(`/api/v1/permissions/${g.id}/revoke`, w.op, { reason: "x" })).status).toBe(403);
    const rv = await api.post(`/api/v1/permissions/${g.id}/revoke`, w.admin, { reason: "no longer needed" });
    expect(rv.body.data).toMatchObject({ status: "revoked", version: 2, revokedBy: w.admin.actor, revokeReason: "no longer needed" });
    expect((await api.post(`/api/v1/permissions/${g.id}/revoke`, w.admin, { reason: "again" })).body.error.code).toBe("ALREADY_REVOKED");
    await grant(w.admin, w.support, w.wallet); // can be granted again once revoked
    expect((await api.get(`/api/v1/permissions?status=active&agentId=${w.support}`, w.admin)).body.pagination.total).toBe(1);
  });

  it("validates input and the resource and agent must be in the organization", async () => {
    const w = await world();
    const o = await world();
    const bad = [{ action: "has space" }, { action: "" }, { constraints: { maxAmount: -1 } }, { constraints: { unknown: 1 } }, { constraints: { expiresAt: new Date(Date.now() - 1000).toISOString() } }, { extra: 1 }];
    for (const b of bad) expect((await api.post("/api/v1/permissions", w.admin, { agentId: w.support, resourceId: w.wallet, action: "transfer", ...b })).status, JSON.stringify(b)).toBe(400);
    expect((await api.post("/api/v1/permissions", w.admin, { agentId: o.support, resourceId: w.wallet, action: "transfer" })).body.error.code).toBe("AGENT_NOT_FOUND");
    expect((await api.post("/api/v1/permissions", w.admin, { agentId: w.support, resourceId: o.wallet, action: "transfer" })).body.error.code).toBe("RESOURCE_NOT_FOUND");
    await expect(q("insert into permissions (organization_id, agent_id, resource_id, action, granted_by) values ($1,$2,$3,'x',$4)", [w.admin.org, o.support, w.wallet, w.admin.actor])).rejects.toMatchObject({ code: "23503" });
  });

  it("a permission can only ever be revoked, never edited or deleted", async () => {
    const w = await world();
    const g = await grant(w.admin, w.support, w.wallet);
    await expect(q("update permissions set action='root' where id=$1", [g.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update permissions set agent_id=$2 where id=$1", [g.id, w.payment])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from permissions where id=$1", [g.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("truncate permissions")).rejects.toMatchObject({ code: expect.stringMatching(/^(23001|0A000)$/) });
    await api.post(`/api/v1/permissions/${g.id}/revoke`, w.admin, { reason: "done" });
    await expect(q("update permissions set status='active' where id=$1", [g.id])).rejects.toMatchObject({ code: "23001" });
  });
});

describe("the gateway", () => {
  it("allows a granted operation, records both decisions and the execution, and never stores the payload", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    const g = await grant(w.admin, w.support, w.wallet);
    const requestId = randomUUID();
    const r = await agentCall(a.token, "/api/v1/gateway/execute", { requestId, resource: w.wallet, action: "transfer", payload: { amount: 5000, note: "private-payload-marker" } }, { "x-correlation-id": "corr-77" });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ requestId, status: "executed", simulated: true, replayed: false, decision: { decision: "allow", reasonCodes: ["ALLOWED"] } });
    expect(w.executor.calls.at(-1)).toMatchObject({ agentId: w.support, organizationId: w.admin.org, action: "transfer", authorization: { permissionId: g.id, permissionVersion: 1 } });

    const decisions = (await q("select stage, decision, payload_hash, correlation_id, credential_id from gateway_decisions where request_id=$1 order by created_at", [requestId])).rows;
    expect(decisions.map((d) => `${d.stage}:${d.decision}`)).toEqual(["precheck:allow", "recheck:allow"]);
    expect(decisions[0]).toMatchObject({ correlation_id: "corr-77", credential_id: a.credentialId });
    expect(decisions[0].payload_hash).toMatch(/^[0-9a-f]{64}$/);
    const everything = JSON.stringify([...(await q("select * from gateway_decisions")).rows, ...(await q("select * from execution_records where request_id=$1", [requestId])).rows]);
    expect(everything).not.toContain("private-payload-marker");
    const ex = (await q("select status, simulated, precheck_decision_id, recheck_decision_id from execution_records where request_id=$1", [requestId])).rows[0];
    expect(ex).toMatchObject({ status: "executed", simulated: true });
    expect(ex.precheck_decision_id).not.toBe(ex.recheck_decision_id);
  });

  it("denies by default and records why", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    const r = await exec(a.token, { resource: w.wallet, action: "transfer" });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: "OPERATION_DENIED", details: { reasonCodes: ["NO_PERMISSION"] } });
    expect(w.executor.calls).toHaveLength(0);
    await grant(w.admin, w.support, w.wallet, "read");
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(403); // a grant for another action is not a grant
    expect((await exec(a.token, { resource: w.customerApi, action: "read" })).body.error.details.reasonCodes).toEqual(["NO_PERMISSION"]); // nor is a grant on another resource
    expect((await exec(a.token, { resource: "no-such-resource", action: "read" })).body.error.details.reasonCodes).toEqual(["RESOURCE_UNKNOWN"]);
    expect(w.executor.calls).toHaveLength(0);
    const shown = (await api.get(`/api/v1/gateway/agents/${w.support}/decisions`, w.admin)).body.data;
    expect(shown.some((d: any) => d.decision === "deny" && d.reasonCodes.includes("NO_PERMISSION"))).toBe(true);
  });

  it("identifies the agent only from the token, never from the body", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.payment, w.wallet); // payment has the grant, support does not
    for (const spoof of [{ agentId: w.payment }, { organizationId: w.admin.org }, { agent: w.payment }]) {
      expect((await exec(a.token, { resource: w.wallet, action: "transfer", ...spoof })).status).toBe(400);
    }
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(403);
    expect((await agentCall(a.token, "/api/v1/gateway/execute", { requestId: "bad id!", resource: "x", action: "y" })).status).toBe(400);
    expect((await agentCall(a.token, "/api/v1/gateway/execute", { requestId: "r".repeat(101), resource: "x", action: "y" })).status).toBe(400);
  });

  it("resolves a resource by id, external reference or name", async () => {
    const w = await world();
    const ref = `ext-${randomUUID()}`;
    const named = await api.post("/api/v1/resources", w.admin, { name: uniqueName("payment-api"), resourceType: "api", externalReference: ref });
    ctx.executors.register(named.body.data.id, w.executor);
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, named.body.data.id);
    for (const r of [named.body.data.id, ref, named.body.data.name]) expect((await exec(a.token, { resource: r, action: "transfer" })).status, r).toBe(200);
  });

  it("applies constraints: amount limits and expiry", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet, "transfer", { maxAmount: 1000, expiresAt: new Date(Date.now() + 1500).toISOString() });
    expect((await exec(a.token, { resource: w.wallet, action: "transfer", payload: { amount: 999 } })).status).toBe(200);
    const over = await exec(a.token, { resource: w.wallet, action: "transfer", payload: { amount: 5000 } });
    expect(over.body.error.details.reasonCodes).toEqual(["CONSTRAINT_VIOLATED"]);
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).body.error.details.reasonCodes).toEqual(["CONSTRAINT_VIOLATED"]);
    await new Promise((r) => setTimeout(r, 1700));
    expect((await exec(a.token, { resource: w.wallet, action: "transfer", payload: { amount: 1 } })).body.error.details.reasonCodes).toEqual(["PERMISSION_EXPIRED"]);
  });

  it("revoking a permission denies later requests at once", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    const g = await grant(w.admin, w.support, w.wallet);
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(200);
    await api.post(`/api/v1/permissions/${g.id}/revoke`, w.admin, { reason: "off" });
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(403);
  });

  it("re-checks immediately before executing: a revocation between pre-check and execution wins", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    const g = await grant(w.admin, w.support, w.wallet);
    ctx.hooks.afterPrecheck = async () => { await api.post(`/api/v1/permissions/${g.id}/revoke`, w.admin, { reason: "revoked mid-flight" }); };
    try {
      const requestId = randomUUID();
      const r = await agentCall(a.token, "/api/v1/gateway/execute", { requestId, resource: w.wallet, action: "transfer" });
      expect(r.status).toBe(403);
      expect(r.body.error.details.reasonCodes).toEqual(expect.arrayContaining(["REVOKED_BEFORE_EXECUTION", "NO_PERMISSION"]));
      expect(w.executor.calls).toHaveLength(0); // the resource was never touched
      const stages = (await q("select stage, decision from gateway_decisions where request_id=$1 order by created_at", [requestId])).rows.map((d) => `${d.stage}:${d.decision}`);
      expect(stages).toEqual(["precheck:allow", "recheck:deny"]);
      expect((await q("select status from execution_records where request_id=$1", [requestId])).rows[0].status).toBe("denied");
    } finally { delete ctx.hooks.afterPrecheck; }
  });

  it("is at-most-once per request id, including concurrent duplicates", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    const requestId = randomUUID();
    const body = { requestId, resource: w.wallet, action: "transfer", payload: { amount: 1 } };
    const rs = await Promise.all(Array.from({ length: 6 }, () => agentCall(a.token, "/api/v1/gateway/execute", body)));
    expect(w.executor.calls.filter((c) => c.requestId === requestId)).toHaveLength(1);
    for (const r of rs) expect([200, 409]).toContain(r.status);
    expect(rs.filter((r) => r.status === 200 && r.body.data.replayed === false)).toHaveLength(1);
    const later = await agentCall(a.token, "/api/v1/gateway/execute", body);
    expect(later.body.data).toMatchObject({ status: "executed", replayed: true });
    expect(w.executor.calls.filter((c) => c.requestId === requestId)).toHaveLength(1);
    expect((await q("select count(*)::int n from execution_records where request_id=$1", [requestId])).rows[0].n).toBe(1);
  });

  it("an authorized operation whose executor fails is recorded as failed, never as executed", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    const boom: ResourceExecutor = { name: "boom", simulated: false, execute: async () => { throw new Error("upstream 500"); } };
    ctx.executors.register(w.wallet, boom);
    await grant(w.admin, w.support, w.wallet);
    const requestId = randomUUID();
    const r = await agentCall(a.token, "/api/v1/gateway/execute", { requestId, resource: w.wallet, action: "transfer" });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatchObject({ code: "EXECUTION_FAILED", details: { failureReason: "upstream 500" } });
    expect((await q("select status, executor, failure_reason from execution_records where request_id=$1", [requestId])).rows[0]).toMatchObject({ status: "failed", executor: "boom", failure_reason: "upstream 500" });
    // a retry with the same request id does not run it again
    const retry = await agentCall(a.token, "/api/v1/gateway/execute", { requestId, resource: w.wallet, action: "transfer" });
    expect(retry.status).toBe(502);
    expect(retry.body.error.details.failureReason).toBe("upstream 500");
  });

  it("reports submitted separately from executed, and refuses resources with no executor", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    const async_: ResourceExecutor = { name: "queue", simulated: false, execute: async () => ({ status: "submitted", externalReference: "job-42" }) };
    ctx.executors.register(w.wallet, async_);
    await grant(w.admin, w.support, w.wallet);
    const sub = await exec(a.token, { resource: w.wallet, action: "transfer" });
    expect(sub.status).toBe(202);
    expect(sub.body.data).toMatchObject({ status: "submitted", externalReference: "job-42", simulated: false });

    const bare = await mkResource(api, w.admin, uniqueName("bare"));
    await grant(w.admin, w.support, bare);
    const none = await exec(a.token, { resource: bare, action: "transfer" });
    expect(none.status).toBe(502);
    expect(none.body.error.details.failureReason).toBe("EXECUTOR_NOT_CONFIGURED");
  });

  it("fails closed when the policy store is unavailable", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    const spy = vi.spyOn(gw().repo, "activePermissionsFor").mockRejectedValue(new Error("connection refused: secret-host"));
    try {
      const requestId = randomUUID();
      const r = await agentCall(a.token, "/api/v1/gateway/execute", { requestId, resource: w.wallet, action: "transfer" });
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe("ENFORCEMENT_UNAVAILABLE");
      expect(r.raw).not.toContain("secret-host");
      expect(w.executor.calls).toHaveLength(0);
      expect((await q("select status, failure_reason from execution_records where request_id=$1", [requestId])).rows[0]).toMatchObject({ status: "failed", failure_reason: "ENFORCEMENT_UNAVAILABLE" });
      const chk = await agentCall(a.token, "/api/v1/gateway/check", { resource: w.wallet, action: "transfer" });
      expect(chk.status).toBe(503);
    } finally { spy.mockRestore(); }
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(200); // recovered
  });

  it("check returns a decision without executing anything", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    const ok = await agentCall(a.token, "/api/v1/gateway/check", { resource: w.wallet, action: "transfer" });
    expect(ok.body.data).toMatchObject({ decision: "allow", reasonCodes: ["ALLOWED"] });
    const no = await agentCall(a.token, "/api/v1/gateway/check", { resource: w.wallet, action: "delete" });
    expect(no.body.data).toMatchObject({ decision: "deny", reasonCodes: ["NO_PERMISSION"] });
    expect(w.executor.calls).toHaveLength(0);
    expect((await q("select count(*)::int n from execution_records where agent_id=$1", [w.support])).rows[0].n).toBe(0);
  });

  it("rejects oversized payloads", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    expect((await exec(a.token, { resource: w.wallet, action: "transfer", payload: { blob: "x".repeat(17_000) } })).status).toBe(400);
  });
});

describe("tenant isolation", () => {
  it("an agent cannot reach another organization's resource, and admins cannot see or change another organization's data", async () => {
    const a = await world();
    const b = await world();
    const tokenA = await tokenFor(a.admin, a.support);
    await grant(b.admin, b.support, b.wallet);
    // same resource id, wrong organization: it does not exist for this agent
    expect((await exec(tokenA.token, { resource: b.wallet, action: "transfer" })).body.error.details.reasonCodes).toEqual(["RESOURCE_UNKNOWN"]);
    expect(b.executor.calls).toHaveLength(0);

    const gA = await grant(a.admin, a.support, a.wallet);
    expect((await api.get(`/api/v1/permissions/${gA.id}`, b.admin)).status).toBe(404);
    expect((await api.post(`/api/v1/permissions/${gA.id}/revoke`, b.admin, { reason: "x" })).status).toBe(404);
    expect((await api.get("/api/v1/permissions", b.admin)).body.data.every((p: any) => p.agentId === b.support)).toBe(true);
    expect((await api.post("/api/v1/agent-auth/rotate", b.admin, { agentId: a.support, reason: "x" })).status).toBe(404);
    expect((await api.post("/api/v1/agent-auth/revoke", b.admin, { agentId: a.support, reason: "x" })).status).toBe(404);
    expect((await api.get(`/api/v1/gateway/agents/${a.support}/decisions`, b.admin)).body.data).toEqual([]);
    expect((await api.put(`/api/v1/gateway/resources/${a.wallet}/enforcement`, b.admin, { mode: "gateway" })).status).toBe(404);
    expect((await api.post("/api/v1/enforcement/apply", b.admin, { kind: "suspend_agent", agentId: a.support, reason: "hostile takeover", adminOverride: true })).status).toBe(404);
    expect((await api.post("/api/v1/enforcement/apply", b.admin, { kind: "revoke_resource_access", agentId: b.support, resourceId: a.wallet, reason: "hostile takeover", adminOverride: true })).status).toBe(404);
  });

  it("decisions and executions are tied to the token's organization even for the same request id", async () => {
    const a = await world();
    const b = await world();
    const ta = await tokenFor(a.admin, a.support);
    const tb = await tokenFor(b.admin, b.support);
    await grant(a.admin, a.support, a.wallet);
    await grant(b.admin, b.support, b.wallet);
    const requestId = "shared-id";
    expect((await agentCall(ta.token, "/api/v1/gateway/execute", { requestId, resource: a.wallet, action: "transfer" })).status).toBe(200);
    expect((await agentCall(tb.token, "/api/v1/gateway/execute", { requestId, resource: b.wallet, action: "transfer" })).body.data.replayed).toBe(false);
  });
});

describe("enforcement", () => {
  const apply = (w: Who, body: Record<string, unknown>) => api.post("/api/v1/enforcement/apply", w, { reason: "contain compromised agent", ...body });

  it("revoke_resource_access removes the grants AND blocks the pair, even for a new grant, until rolled back", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    const p = await tokenFor(w.admin, w.payment);
    await grant(w.admin, w.support, w.wallet);
    await grant(w.admin, w.payment, w.wallet);
    const r = await apply(w.admin, { kind: "revoke_resource_access", agentId: w.support, resourceId: w.wallet, adminOverride: true });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: "executed", adapter: "permission", approvalBasis: "admin_override", replayed: false });
    expect(r.body.data.result.detail.revokedPermissionIds).toHaveLength(1);
    expect(r.body.data.result.verificationRequired.join(" ")).toMatch(/NEGATIVE_ACCESS_TEST/);

    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(403); // contained
    expect((await exec(p.token, { resource: w.wallet, action: "transfer" })).status).toBe(200); // healthy path untouched
    await grant(w.admin, w.support, w.wallet); // somebody re-grants...
    const still = await exec(a.token, { resource: w.wallet, action: "transfer" });
    expect(still.body.error.details.reasonCodes).toEqual(["RESTRICTED_BY_CONTAINMENT"]); // ...the restriction still holds

    const back = await api.post("/api/v1/enforcement/revoke", w.admin, { actionId: r.body.data.id, reason: "false alarm" });
    expect(back.body.data.status).toBe("rolled_back");
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(200); // the new grant works again; the old ones were NOT restored
    const detail = (await api.get(`/api/v1/enforcement/${r.body.data.id}`, w.admin)).body.data;
    expect(detail.events.map((e: any) => e.status)).toEqual(["pending", "executed", "rolled_back"]);
    expect((await api.post("/api/v1/enforcement/revoke", w.admin, { actionId: r.body.data.id, reason: "twice" })).body.error.code).toBe("ROLLBACK_NOT_SUPPORTED");
  });

  it("needs an approval basis: operators, viewers and unapproved plans are refused", async () => {
    const w = await world();
    const body = { kind: "revoke_resource_access", agentId: w.support, resourceId: w.wallet };
    expect((await apply(w.op, { ...body, adminOverride: true })).status).toBe(403);
    expect((await apply(w.op, body)).status).toBe(403);
    expect((await apply(who("viewer", w.admin.org), { ...body, adminOverride: true })).status).toBe(403);
    const none = await apply(w.admin, body);
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe("APPROVAL_REQUIRED");
    expect((await apply(w.admin, { ...body, incidentId: randomUUID(), planHash: "a".repeat(64) })).status).toBe(404);
    expect((await apply(w.admin, { ...body, adminOverride: true, reason: "short" })).status).toBe(400);
    expect((await q("select count(*)::int n from enforcement_actions where organization_id=$1", [w.admin.org])).rows[0].n).toBe(0); // refusals leave no action
  });

  it("an action no adapter supports is recorded as unsupported, never as success", async () => {
    const w = await world();
    const r = await apply(w.admin, { kind: "revoke_authority", agentId: w.support, adminOverride: true });
    expect(r.body.data).toMatchObject({ status: "unsupported", adapter: null });
    expect(r.body.data.failureReason).toMatch(/CORVEN cannot enforce this/);
    expect((await apply(w.admin, { kind: "block_operational_trigger", agentId: w.support, adminOverride: true })).body.data.status).toBe("unsupported");
    expect((await api.post("/api/v1/enforcement/revoke", w.admin, { actionId: r.body.data.id, reason: "x" })).body.error.code).toBe("ROLLBACK_NOT_SUPPORTED");
  });

  it("suspend_agent goes through the Agent Registry and stops the agent everywhere", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    const r = await apply(w.admin, { kind: "suspend_agent", agentId: w.support, adminOverride: true });
    expect(r.body.data).toMatchObject({ status: "executed", adapter: "agent-status" });
    expect((await api.get(`/api/v1/agents/${w.support}`, w.admin)).body.data.status).toBe("suspended");
    expect((await q("select count(*)::int n from agent_status_history where agent_id=$1 and new_status='suspended'", [w.support])).rows[0].n).toBe(1);
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).body.error.details.reasonCodes).toContain("AGENT_NOT_ACTIVE");
    // suspending twice fails honestly rather than reporting success
    const again = await apply(w.admin, { kind: "suspend_agent", agentId: w.support, adminOverride: true });
    expect(again.body.data.status).toBe("failed");
  });

  it("revoke_credentials ends the agent's CORVEN access but says other credentials are untouched", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    const r = await apply(w.admin, { kind: "revoke_credentials", agentId: w.support, adminOverride: true });
    expect(r.body.data).toMatchObject({ status: "executed", adapter: "credential" });
    expect(r.body.data.result.verificationRequired.join(" ")).toMatch(/NOT revoked/);
    expect((await exec(a.token, { resource: w.wallet, action: "transfer" })).status).toBe(401);
    expect((await agentCall(null, "/api/v1/agent-auth/token", { credential: a.credential })).status).toBe(401);
  });

  it("is idempotent under an idempotency key", async () => {
    const w = await world();
    await grant(w.admin, w.support, w.wallet);
    const body = { kind: "revoke_resource_access", agentId: w.support, resourceId: w.wallet, adminOverride: true, idempotencyKey: "run-1:e1" };
    const first = await apply(w.admin, body);
    const second = await apply(w.admin, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ id: first.body.data.id, replayed: true });
    const rs = await Promise.all(Array.from({ length: 5 }, () => apply(w.admin, { ...body, idempotencyKey: "race" })));
    expect(new Set(rs.map((r) => r.body.data.id)).size).toBe(1);
    expect((await q("select count(*)::int n from enforcement_actions where idempotency_key='race'")).rows[0].n).toBe(1);
  });

  it("enforcement history is append-only and the action identity cannot be rewritten", async () => {
    const w = await world();
    const r = await apply(w.admin, { kind: "revoke_authority", agentId: w.support, adminOverride: true });
    await expect(q("update enforcement_action_events set status='executed' where action_id=$1", [r.body.data.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from enforcement_actions where id=$1", [r.body.data.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update enforcement_actions set kind='suspend_agent' where id=$1", [r.body.data.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update enforcement_actions set agent_id=$2 where id=$1", [r.body.data.id, w.payment])).rejects.toMatchObject({ code: "23001" });
  });

  it("execution records are finalized exactly once; decisions and credential history are append-only", async () => {
    const w = await world();
    const a = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.support, w.wallet);
    const requestId = randomUUID();
    await agentCall(a.token, "/api/v1/gateway/execute", { requestId, resource: w.wallet, action: "transfer" });
    await expect(q("update execution_records set status='denied' where request_id=$1", [requestId])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from execution_records where request_id=$1", [requestId])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update gateway_decisions set decision='allow' where request_id=$1", [requestId])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from credential_rotation_history where agent_id=$1", [w.support])).rejects.toMatchObject({ code: "23001" });
    await expect(q("update gateway_audit_logs set action='x'")).rejects.toMatchObject({ code: "23001" });
    await expect(q("update agent_credentials set secret_hash=$2 where id=$1", [a.credentialId, "0".repeat(64)])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from agent_credentials where id=$1", [a.credentialId])).rejects.toMatchObject({ code: "23001" });
  });
});

describe("coverage", () => {
  it("reports what can be controlled and feeds the containment planner", async () => {
    const admin = who("admin");
    const [support, payment, analytics] = [await mkAgent(api, admin), await mkAgent(api, admin), await mkAgent(api, admin)];
    const wallet = await mkResource(api, admin);
    const customerApi = await mkResource(api, admin);
    const d = {
      sp: await createDep(api, admin, authority(support, payment)),
      pw: await createDep(api, admin, resourceDep(payment, wallet)),
      pc: await createDep(api, admin, resourceDep(payment, customerApi)),
      pa: await createDep(api, admin, operational(payment, analytics)),
    };
    await api.put(`/api/v1/gateway/resources/${wallet}/enforcement`, admin, { mode: "gateway" });
    await api.put(`/api/v1/gateway/resources/${customerApi}/enforcement`, admin, { mode: "advisory" });
    expect((await api.put(`/api/v1/gateway/resources/${wallet}/enforcement`, who("operator", admin.org), { mode: "gateway" })).status).toBe(403);
    expect((await api.get("/api/v1/gateway/resources/enforcement", admin)).body.data).toHaveLength(2);

    const cov = (await api.get("/api/v1/gateway/coverage", who("viewer", admin.org))).body.data;
    const by = Object.fromEntries(cov.edges.map((e: any) => [e.edgeId, e.classification]));
    expect(by).toEqual({ [d.sp.id]: "NOT_CONTROLLED", [d.pw.id]: "CONTROLLED", [d.pc.id]: "PARTIALLY_CONTROLLED", [d.pa.id]: "NOT_CONTROLLED" });
    expect(cov.summary).toEqual({ CONTROLLED: 1, PARTIALLY_CONTROLLED: 1, NOT_CONTROLLED: 2, UNKNOWN: 0 });
    expect((await api.get("/api/v1/gateway/coverage", null)).status).toBe(401);

    // the planner honours it: the wallet and customer-api edges are cuttable, the operational edge is not
    const plan = (await api.post("/api/v1/containment/plan", admin, { sourceNodeIds: [`agent:${payment}`], protectedNodeIds: [`resource:${wallet}`, `resource:${customerApi}`], coverage: toCov(cov) })).body.data;
    expect(plan.status).toBe("feasible");
    expect(plan.actions.map((a: any) => a.edgeId).sort()).toEqual([d.pw.id, d.pc.id].sort());
    // declare the customer-api edge uncontrollable and the plan becomes infeasible, with that edge as the blocker
    const none = await api.post("/api/v1/containment/plan", admin, { sourceNodeIds: [`agent:${payment}`], protectedNodeIds: [`resource:${customerApi}`], coverage: { uncontrollableEdgeIds: [d.pc.id] } });
    expect(none.body.data.status).toBe("infeasible");
  });
});

const toCov = (report: any) => ({
  uncontrollableEdgeIds: report.edges.filter((e: any) => e.classification === "NOT_CONTROLLED" || e.classification === "UNKNOWN").map((e: any) => e.edgeId),
  edgeCosts: Object.fromEntries(report.edges.filter((e: any) => e.classification === "PARTIALLY_CONTROLLED").map((e: any) => [e.edgeId, 2])),
});

describe("approved containment of a compromised agent (plan-based enforcement)", () => {
  /** Acme: payment is compromised. Incident has a snapshot and a feasible plan and is driven to `approved` as the system. */
  async function approvedIncident() {
    const w = await world();
    const analytics = await mkAgent(api, w.admin);
    await createDep(api, w.admin, authority(w.support, w.payment));
    await createDep(api, w.admin, resourceDep(w.payment, w.wallet));
    await createDep(api, w.admin, resourceDep(w.payment, w.customerApi));
    await createDep(api, w.admin, resourceDep(w.support, w.customerApi));
    await createDep(api, w.admin, operational(w.payment, analytics));
    const op = w.op;
    const inc = (await api.post("/api/v1/incidents", op, { title: "Payment agent compromised", severity: "critical", agents: [{ agentId: w.payment, relationship: "compromised" }] })).body.data;
    await api.post(`/api/v1/incidents/${inc.id}/transition`, op, { to: "investigating", reason: "triage" });
    await api.post(`/api/v1/incidents/${inc.id}/graph-snapshot`, op, {});
    const planRes = await api.post(`/api/v1/incidents/${inc.id}/containment-plan`, op, { protectedNodeIds: [`resource:${w.wallet}`, `resource:${w.customerApi}`], coverage: { uncontrollableEdgeIds: [] } });
    const plan = planRes.body.data;
    await api.post(`/api/v1/incidents/${inc.id}/transition`, op, { to: "containment_planned", reason: "plan ready" });
    await api.post(`/api/v1/incidents/${inc.id}/transition`, op, { to: "awaiting_approval", reason: "request approval" });
    const s = ctx.app.incidentManagement.incidents;
    await s.transition(sys(w.admin.org), inc.id, { to: "approved", reason: "approved by test double" });
    return { w, inc, plan, planHash: plan.reference.planHash as string, actions: plan.result.plan.actions as Array<{ edgeId: string; kind: string; sourceNodeId: string; targetNodeId: string }> };
  }

  it("refuses without an approval and enforces the exact approved plan once approved", async () => {
    const { w, inc, planHash, actions } = await approvedIncident();
    const tokenPay = await tokenFor(w.admin, w.payment);
    const tokenSup = await tokenFor(w.admin, w.support);
    await grant(w.admin, w.payment, w.wallet);
    await grant(w.admin, w.payment, w.customerApi, "read");
    await grant(w.admin, w.support, w.customerApi, "read");
    const body = { kind: "revoke_resource_access", agentId: w.payment, resourceId: w.wallet, incidentId: inc.id, planHash, reason: "execute approved plan" };

    // no approval on file for this plan
    expect((await api.post("/api/v1/enforcement/apply", w.admin, body)).body.error.code).toBe("APPROVAL_REQUIRED");
    ctx.approvedPlans.add(`${w.admin.org}:${inc.id}:${"f".repeat(64)}`);
    expect((await api.post("/api/v1/enforcement/apply", w.admin, body)).status).toBe(403); // an approval for a different plan does not count
    expect((await api.post("/api/v1/enforcement/apply", w.admin, { ...body, planHash: "e".repeat(64) })).body.error.message).toMatch(/current containment plan/);

    ctx.approvedPlans.add(`${w.admin.org}:${inc.id}:${planHash}`);
    
    const principal = { actorId: w.admin.actor, organizationId: w.admin.org, role: "admin" as const };
    const results = await gw().enforcement.applyPlan(principal, { incidentId: inc.id, planHash, actions, keyPrefix: `plan-${planHash.slice(0, 8)}`, reason: "execute approved plan" });
    expect(results).toHaveLength(actions.length);
    expect(results.every((r) => r.action.status === "executed" && r.action.approvalBasis === "plan_approval" && r.action.planHash === planHash)).toBe(true);

    // malicious path closed, healthy path open
    expect((await exec(tokenPay.token, { resource: w.wallet, action: "transfer" })).status).toBe(403);
    expect((await exec(tokenPay.token, { resource: w.customerApi, action: "read" })).status).toBe(403);
    expect((await exec(tokenSup.token, { resource: w.customerApi, action: "read" })).status).toBe(200);

    // a restart repeats the same keys and changes nothing
    const again = await gw().enforcement.applyPlan(principal, { incidentId: inc.id, planHash, actions, keyPrefix: `plan-${planHash.slice(0, 8)}`, reason: "execute approved plan" });
    expect(again.every((r) => r.replayed)).toBe(true);
    expect(again.map((r) => r.action.id)).toEqual(results.map((r) => r.action.id));

    const listed = (await api.get(`/api/v1/enforcement?incidentId=${inc.id}`, w.op)).body;
    expect(listed.pagination.total).toBe(actions.length);
  });

  it("refuses when the incident is not in an enforceable state", async () => {
    const { w, inc, planHash } = await approvedIncident();
    ctx.approvedPlans.add(`${w.admin.org}:${inc.id}:${planHash}`);
    await ctx.app.incidentManagement.incidents.transition(sys(w.admin.org), inc.id, { to: "investigating", reason: "approval withdrawn" });
    const r = await api.post("/api/v1/enforcement/apply", w.admin, { kind: "revoke_resource_access", agentId: w.payment, resourceId: w.wallet, incidentId: inc.id, planHash, reason: "execute approved plan" });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/requires approved or containing/);
  });
});
