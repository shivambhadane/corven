import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemPrincipal } from "../src/auth/system.js";
import { authority, createDep, mkAgent, mkResource, operational, resourceDep } from "./dep-helpers.js";
import { client, createCtx, who, type TestCtx, type Who } from "./helpers.js";

let ctx: TestCtx;
let api: ReturnType<typeof client>;
beforeAll(async () => {
  ctx = await createCtx();
  api = client(ctx.app);
});
afterAll(() => ctx.close());

const I = "/api/v1/incidents";
const A = (id: string) => `agent:${id}`;
const q = (sql: string, p: unknown[] = []) => ctx.handle.pool.query(sql, p);
const svc = () => ctx.app.incidentManagement.incidents;
const sys = (org: string) => systemPrincipal(org, randomUUID());

/** Acme network: payment is the compromised agent. */
async function acme(w: Who = who("operator")) {
  const [support, payment, analytics, email, database] = [await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w), await mkAgent(api, w)];
  const wallet = await mkResource(api, w);
  const customerApi = await mkResource(api, w);
  await createDep(api, w, authority(support, payment));
  await createDep(api, w, resourceDep(payment, wallet));
  await createDep(api, w, resourceDep(payment, customerApi));
  await createDep(api, w, operational(payment, analytics));
  await createDep(api, w, operational(analytics, email));
  await createDep(api, w, resourceDep(support, customerApi));
  await createDep(api, w, resourceDep(database, customerApi));
  return { w, support, payment, analytics, email, database, wallet, customerApi };
}
type Net = Awaited<ReturnType<typeof acme>>;

const create = async (w: Who, over: Record<string, unknown> = {}) => {
  const r = await api.post(I, w, { title: "Payment agent anomaly", severity: "high", ...over });
  if (r.status !== 201) throw new Error(r.raw);
  return r.body.data;
};
const move = (w: Who, id: string, to: string, extra: Record<string, unknown> = {}) => api.post(`${I}/${id}/transition`, w, { to, reason: `move to ${to}`, ...extra });
const get = async (w: Who, id: string) => (await api.get(`${I}/${id}`, w)).body.data;
const status = async (w: Who, id: string) => (await get(w, id)).status;
const sysMove = (org: string, id: string, to: string, extra: Record<string, unknown> = {}) => svc().transition(sys(org), id, { to: to as never, reason: `system: ${to}`, ...extra });

/** An incident with the compromised payment agent, a snapshot and a feasible plan, in `investigating`. */
async function planned(t: Net) {
  const inc = await create(t.w, { agents: [{ agentId: t.payment, relationship: "compromised" }] });
  expect((await move(t.w, inc.id, "investigating")).status).toBe(200);
  expect((await api.post(`${I}/${inc.id}/graph-snapshot`, t.w, {})).status).toBe(201);
  const plan = await api.post(`${I}/${inc.id}/containment-plan`, t.w, {});
  expect(plan.status).toBe(201);
  return { inc, plan: plan.body.data };
}

describe("creation", () => {
  it("creates an incident with the principal's organization and identity, and an initial history and timeline", async () => {
    const t = await acme();
    const inc = await create(t.w, { description: "Unexpected wallet calls", agents: [{ agentId: t.payment, relationship: "compromised" }], resources: [{ resourceId: t.wallet, relationship: "exposed" }] });
    expect(inc).toMatchObject({ title: "Payment agent anomaly", severity: "high", status: "detected", detectionSource: "manual", detectionReference: null, createdBy: t.w.actor, createdByType: "human", organizationId: t.w.org, assigneeId: null, version: 1 });

    const tl = (await api.get(`${I}/${inc.id}/timeline`, t.w)).body.data;
    expect(tl.map((e: any) => e.eventType)).toEqual(["incident.created", "incident.agent_associated", "incident.resource_associated"]);
    expect(tl.map((e: any) => e.sequence)).toEqual([...tl.map((e: any) => e.sequence)].sort((a, b) => a - b));
    expect(tl[0]).toMatchObject({ actorId: t.w.actor, actorType: "human", data: { severity: "high", detectionSource: "manual" } });
    const hist = (await api.get(`${I}/${inc.id}/state-history`, t.w)).body.data;
    expect(hist).toMatchObject([{ from: null, to: "detected", actorId: t.w.actor }]);
    const audit = (await q("select action, actor_id from incident_audit_logs where incident_id=$1 order by created_at", [inc.id])).rows;
    expect(audit.map((r) => r.action)).toEqual(["incident.created", "incident.agent_associated", "incident.resource_associated"]);
  });

  it("rejects fields the caller must not control (organization, creator, status, source)", async () => {
    const w = who("operator");
    for (const extra of [{ organizationId: randomUUID() }, { createdBy: randomUUID() }, { status: "contained" }, { detectionSource: "runtime_signal" }, { detectionReference: "x" }, { assigneeId: randomUUID() }]) {
      const r = await api.post(I, w, { title: "t", severity: "low", ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("validates input: title, severity, sizes, associations", async () => {
    const w = who("operator");
    const bad = [{ title: "   ", severity: "low" }, { title: "t", severity: "urgent" }, { title: "t", severity: "LOW" }, { title: "x".repeat(201), severity: "low" }, { title: "t", severity: "low", description: "d".repeat(8001) }, { severity: "low" }, { title: "t" }];
    for (const b of bad) expect((await api.post(I, w, b)).status, JSON.stringify(b).slice(0, 60)).toBe(400);
    expect((await api.post(I, w, { title: "t", severity: "low", agents: [{ agentId: "nope", relationship: "compromised" }] })).status).toBe(400);
    expect((await api.post(I, w, { title: "t", severity: "low", agents: [{ agentId: randomUUID(), relationship: "boss" }] })).status).toBe(400);
  });

  it("supports all five severities", async () => {
    const w = who("operator");
    for (const severity of ["critical", "high", "medium", "low", "informational"]) expect((await create(w, { severity })).severity).toBe(severity);
  });

  it("is atomic: a bad agent reference creates nothing", async () => {
    const t = await acme();
    const before = (await q("select count(*)::int n from incidents where organization_id=$1", [t.w.org])).rows[0].n;
    const r = await api.post(I, t.w, { title: "t", severity: "low", agents: [{ agentId: t.payment, relationship: "observed" }, { agentId: randomUUID(), relationship: "observed" }] });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("AGENT_NOT_FOUND");
    expect((await q("select count(*)::int n from incidents where organization_id=$1", [t.w.org])).rows[0].n).toBe(before);
  });

  it("rolls back everything when a later step fails inside the transaction", async () => {
    const t = await acme();
    // the same agent+relationship twice violates the association uniqueness inside the create transaction
    const r = await api.post(I, t.w, { title: "dup", severity: "low", agents: [{ agentId: t.payment, relationship: "observed" }, { agentId: t.payment, relationship: "observed" }] });
    expect(r.status).toBe(409);
    expect((await q("select count(*)::int n from incidents where organization_id=$1 and title='dup'", [t.w.org])).rows[0].n).toBe(0);
    expect((await q("select count(*)::int n from incident_events e join incidents i on i.id=e.incident_id where i.title='dup'")).rows[0].n).toBe(0);
  });

  it("refuses credentials in titles and descriptions", async () => {
    const w = who("operator");
    const r = await api.post(I, w, { title: "t", severity: "low", description: "found key AKIAABCDEFGHIJKLMNOP in logs" });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("CONTAINS_SECRET");
  });
});

describe("internal signals", () => {
  it("only the system principal can create from a detection source, and a repeated signal returns the same incident", async () => {
    const w = who("operator");
    const org = w.org;
    await expect(svc().create({ actorId: w.actor, organizationId: org, role: "operator" }, { title: "t", severity: "high", detectionSource: "runtime_signal", detectionReference: "sig-1" })).rejects.toMatchObject({ statusCode: 403 });

    const first = await svc().create(sys(org), { title: "Gateway anomaly", severity: "critical", detectionSource: "runtime_signal", detectionReference: "sig-1" });
    const again = await svc().create(sys(org), { title: "Gateway anomaly (retry)", severity: "critical", detectionSource: "runtime_signal", detectionReference: "sig-1" });
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false });
    expect(again.incident.id).toBe(first.incident.id);
    expect(first.incident).toMatchObject({ detectionSource: "runtime_signal", createdByType: "system" });
    expect((await api.get(`${I}/${first.incident.id}/timeline`, w)).body.pagination.total).toBe(1);

    // the same reference in another source or organization is a different incident
    expect((await svc().create(sys(org), { title: "x", severity: "low", detectionSource: "internal_event", detectionReference: "sig-1" })).created).toBe(true);
    expect((await svc().create(sys(randomUUID()), { title: "x", severity: "low", detectionSource: "runtime_signal", detectionReference: "sig-1" })).created).toBe(true);
    await expect(svc().create(sys(org), { title: "x", severity: "low", detectionSource: "runtime_signal" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("concurrent identical signals produce exactly one incident", async () => {
    const org = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => svc().create(sys(org), { title: "burst", severity: "high", detectionSource: "automated_detection", detectionReference: "burst-1" })));
    expect(new Set(results.map((r) => r.incident.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("the system role is not obtainable over HTTP", async () => {
    const r = await ctx.app.inject({ method: "POST", url: I, headers: { "x-dev-actor-id": randomUUID(), "x-dev-org-id": randomUUID(), "x-dev-role": "system" }, payload: { title: "t", severity: "low" } });
    expect(r.statusCode).toBe(401);
  });
});

describe("retrieval, update and filtering", () => {
  it("returns detail with available transitions and current references", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const d = await get(t.w, inc.id);
    expect(d.availableTransitions).toEqual([{ to: "investigating", recovery: false }, { to: "false_positive", recovery: false }]);
    expect(d.current).toEqual({ snapshot: null, blastRadius: null, containmentPlan: null });
    expect((await api.get(`${I}/${randomUUID()}`, t.w)).body.error.code).toBe("INCIDENT_NOT_FOUND");
    expect((await api.get(`${I}/not-a-uuid`, t.w)).status).toBe(400);
  });

  it("updates title, description and severity with audit, and refuses status through PATCH", async () => {
    const t = await acme();
    const inc = await create(t.w);
    expect((await api.patch(`${I}/${inc.id}`, t.w, { status: "contained" })).status).toBe(400);
    expect((await api.patch(`${I}/${inc.id}`, t.w, {})).status).toBe(400);
    const r = await api.patch(`${I}/${inc.id}`, t.w, { severity: "critical", title: "Renamed" });
    expect(r.body.data).toMatchObject({ severity: "critical", title: "Renamed", version: 2, status: "detected" });
    const tl = (await api.get(`${I}/${inc.id}/timeline`, t.w)).body.data.map((e: any) => e.eventType);
    expect(tl).toEqual(["incident.created", "incident.severity_changed", "incident.updated"]);
    const sev = (await q("select before_state, after_state from incident_audit_logs where incident_id=$1 and action='incident.severity_changed'", [inc.id])).rows[0];
    expect(sev).toMatchObject({ before_state: { severity: "high" }, after_state: { severity: "critical" } });
    // an unchanged value writes nothing
    const n = (await api.get(`${I}/${inc.id}/timeline`, t.w)).body.pagination.total;
    await api.patch(`${I}/${inc.id}`, t.w, { severity: "critical" });
    expect((await api.get(`${I}/${inc.id}/timeline`, t.w)).body.pagination.total).toBe(n);
  });

  it("lists with filters, stable order and pagination, scoped to the organization", async () => {
    const t = await acme();
    const other = who("operator");
    await create(other, { title: "foreign" });
    const a = await create(t.w, { severity: "critical", agents: [{ agentId: t.payment, relationship: "compromised" }] });
    const b = await create(t.w, { severity: "low", title: "second" });
    const c = await create(t.w, { severity: "low", title: "third" });
    await move(t.w, b.id, "investigating");

    const all = (await api.get(`${I}?limit=100`, t.w)).body;
    expect(all.pagination.total).toBe(3);
    expect(all.data.map((i: any) => i.id)).toEqual([c.id, b.id, a.id]); // newest first
    expect((await api.get(`${I}?status=investigating`, t.w)).body.data.map((i: any) => i.id)).toEqual([b.id]);
    expect((await api.get(`${I}?status=investigating&status=detected`, t.w)).body.pagination.total).toBe(3);
    expect((await api.get(`${I}?severity=low`, t.w)).body.pagination.total).toBe(2);
    expect((await api.get(`${I}?severity=critical&status=detected`, t.w)).body.data.map((i: any) => i.id)).toEqual([a.id]);
    expect((await api.get(`${I}?agentId=${t.payment}`, t.w)).body.data.map((i: any) => i.id)).toEqual([a.id]);
    expect((await api.get(`${I}?createdFrom=${new Date(Date.now() + 3_600_000).toISOString()}`, t.w)).body.pagination.total).toBe(0);
    expect((await api.get(`${I}?createdTo=${new Date(Date.now() + 3_600_000).toISOString()}`, t.w)).body.pagination.total).toBe(3);
    const p1 = (await api.get(`${I}?limit=2&page=1`, t.w)).body;
    const p2 = (await api.get(`${I}?limit=2&page=2`, t.w)).body;
    expect([...p1.data, ...p2.data].map((i: any) => i.id)).toEqual([c.id, b.id, a.id]);
    expect(p1.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect((await api.get(`${I}?status=bogus`, t.w)).status).toBe(400);
    expect((await api.get(`${I}?limit=1000`, t.w)).status).toBe(400);
    expect((await api.get(`${I}?agentId=${t.payment}`, other)).body.pagination.total).toBe(0);
  });
});

describe("lifecycle", () => {
  it("rejects every transition not in the graph, with the allowed targets", async () => {
    const t = await acme();
    const inc = await create(t.w);
    for (const to of ["contained", "approved", "containing", "resolved", "closed", "awaiting_approval", "detected"]) {
      const r = await move(t.w, inc.id, to);
      expect(r.status, to).toBe(409);
      expect(r.body.error).toMatchObject({ code: "INVALID_INCIDENT_TRANSITION", details: { from: "detected", to, allowed: ["investigating", "false_positive"] } });
    }
    expect(await status(t.w, inc.id)).toBe("detected");
  });

  it("requires a reason, validates the target and expectedStatus", async () => {
    const t = await acme();
    const inc = await create(t.w);
    expect((await api.post(`${I}/${inc.id}/transition`, t.w, { to: "investigating" })).status).toBe(400);
    expect((await api.post(`${I}/${inc.id}/transition`, t.w, { to: "investigating", reason: "   " })).status).toBe(400);
    expect((await api.post(`${I}/${inc.id}/transition`, t.w, { to: "nowhere", reason: "x" })).status).toBe(400);
    expect((await api.post(`${I}/${inc.id}/transition`, t.w, { to: "investigating", reason: "x", status: "contained" })).status).toBe(400);
    const stale = await move(t.w, inc.id, "investigating", { expectedStatus: "investigating" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_INCIDENT_STATE");
    expect((await move(t.w, inc.id, "investigating", { expectedStatus: "detected" })).status).toBe(200);
  });

  it("walks the whole happy path; people and trusted modules each make only their own transitions", async () => {
    const t = await acme();
    const { inc } = await planned(t);
    const org = t.w.org;

    // a person cannot assert approval, enforcement, verification or containment
    expect((await move(t.w, inc.id, "containment_planned")).status).toBe(200);
    expect((await move(t.w, inc.id, "awaiting_approval")).status).toBe(200);
    for (const to of ["approved", "rejected"]) {
      const r = await move(t.w, inc.id, to);
      expect(r.status, to).toBe(403);
      expect(r.body.error.code).toBe("TRANSITION_NOT_PERMITTED");
    }
    expect((await sysMove(org, inc.id, "approved")).incident.status).toBe("approved");
    expect((await move(t.w, inc.id, "containing")).status).toBe(403);
    expect((await sysMove(org, inc.id, "containing")).incident.status).toBe("containing");
    expect((await move(t.w, inc.id, "contained")).status).toBe(409); // not even a valid edge
    expect((await move(t.w, inc.id, "verifying")).status).toBe(403);
    await sysMove(org, inc.id, "verifying");
    expect((await move(t.w, inc.id, "contained")).status).toBe(403);
    expect((await sysMove(org, inc.id, "contained")).incident.status).toBe("contained");
    expect((await move(t.w, inc.id, "resolved")).status).toBe(200);
    expect((await move(t.w, inc.id, "closed")).status).toBe(200);

    const hist = (await api.get(`${I}/${inc.id}/state-history`, t.w)).body.data.map((h: any) => `${h.from}>${h.to}:${h.actorType}`);
    expect(hist).toEqual([
      "null>detected:human", "detected>investigating:human", "investigating>containment_planned:human", "containment_planned>awaiting_approval:human",
      "awaiting_approval>approved:system", "approved>containing:system", "containing>verifying:system", "verifying>contained:system", "contained>resolved:human", "resolved>closed:human",
    ]);
    const types = (await api.get(`${I}/${inc.id}/timeline?limit=200`, t.w)).body.data.map((e: any) => e.eventType);
    expect(types).toContain("approval.requested");
    expect(types.filter((x: string) => x === "incident.transitioned")).toHaveLength(9);
  });

  it("failed or partial enforcement never becomes contained", async () => {
    const t = await acme();
    const { inc } = await planned(t);
    for (const to of ["containment_planned", "awaiting_approval"]) await move(t.w, inc.id, to);
    await sysMove(t.w.org, inc.id, "approved");
    await sysMove(t.w.org, inc.id, "containing");
    await sysMove(t.w.org, inc.id, "containment_failed");
    await expect(sysMove(t.w.org, inc.id, "contained")).rejects.toMatchObject({ code: "INVALID_INCIDENT_TRANSITION" });
    // recovery path: a new plan is required, and the old one is stale
    expect((await move(t.w, inc.id, "containment_planned")).body.error.code).toBe("CONTAINMENT_PLAN_STALE");
    expect((await api.post(`${I}/${inc.id}/containment-plan`, t.w, {})).status).toBe(201);
    expect((await move(t.w, inc.id, "containment_planned")).status).toBe(200);
  });

  it("partial containment stays distinct and resolving it needs an explicit residual-risk acknowledgement", async () => {
    const t = await acme();
    const { inc } = await planned(t);
    for (const to of ["containment_planned", "awaiting_approval"]) await move(t.w, inc.id, to);
    await sysMove(t.w.org, inc.id, "approved");
    await sysMove(t.w.org, inc.id, "containing");
    await sysMove(t.w.org, inc.id, "verifying");
    await sysMove(t.w.org, inc.id, "partially_contained");
    expect(await status(t.w, inc.id)).toBe("partially_contained");
    expect((await move(t.w, inc.id, "contained")).status).toBe(409);
    const refused = await move(t.w, inc.id, "resolved");
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("RESIDUAL_RISK_NOT_ACKNOWLEDGED");
    expect((await move(t.w, inc.id, "resolved", { acknowledgeResidualRisk: true })).status).toBe(200);
    const ev = (await api.get(`${I}/${inc.id}/timeline?limit=200`, t.w)).body.data.filter((e: any) => e.eventType === "incident.transitioned").pop();
    expect(ev.data).toMatchObject({ to: "resolved", residualRiskAcknowledged: true });
  });

  it("requires a fresh, feasible plan before planning and before approval", async () => {
    const t = await acme();
    const inc = await create(t.w, { agents: [{ agentId: t.payment, relationship: "compromised" }] });
    await move(t.w, inc.id, "investigating");
    expect((await move(t.w, inc.id, "containment_planned")).body.error.code).toBe("CONTAINMENT_PLAN_REQUIRED");
    await api.post(`${I}/${inc.id}/graph-snapshot`, t.w, {});
    await api.post(`${I}/${inc.id}/containment-plan`, t.w, {});
    expect((await move(t.w, inc.id, "containment_planned")).status).toBe(200);

    // an infeasible plan cannot go to approval: every edge uncontrollable
    const edges = (await api.get("/api/v1/graph/edges?limit=100", t.w)).body.data.map((e: any) => e.id);
    const infeasible = await api.post(`${I}/${inc.id}/containment-plan`, t.w, { coverage: { uncontrollableEdgeIds: edges } });
    expect(infeasible.body.data.reference.planStatus).toBe("infeasible");
    const r = await move(t.w, inc.id, "awaiting_approval");
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("PLAN_NOT_FEASIBLE");
  });

  it("false positive, closing, and explicit audited reopen (admin only); closed incidents are immutable", async () => {
    const t = await acme();
    const admin = who("admin", t.w.org);
    const inc = await create(t.w);
    expect((await move(t.w, inc.id, "false_positive")).status).toBe(200);
    expect((await move(t.w, inc.id, "closed")).status).toBe(200);

    // closed: no changes of any kind
    const frozen = [
      api.patch(`${I}/${inc.id}`, t.w, { title: "x" }), api.post(`${I}/${inc.id}/notes`, t.w, { content: "late" }), api.post(`${I}/${inc.id}/assign`, t.w, { assigneeId: randomUUID() }),
      api.post(`${I}/${inc.id}/agents`, t.w, { agentId: t.payment, relationship: "observed" }), api.post(`${I}/${inc.id}/graph-snapshot`, t.w, {}),
    ];
    for (const r of await Promise.all(frozen)) expect(r.body.error.code).toBe("INCIDENT_CLOSED");

    // an operator cannot reopen; an admin can, with a reason
    const denied = await move(t.w, inc.id, "investigating");
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    expect((await move(admin, inc.id, "investigating")).status).toBe(200);
    const reopen = (await api.get(`${I}/${inc.id}/timeline?limit=200`, t.w)).body.data.filter((e: any) => e.eventType === "incident.transitioned").pop();
    expect(reopen).toMatchObject({ actorId: admin.actor, data: { from: "closed", to: "investigating", recovery: true } });
    // history survived closing and reopening
    expect((await api.get(`${I}/${inc.id}/state-history`, t.w)).body.data.map((h: any) => h.to)).toEqual(["detected", "false_positive", "closed", "investigating"]);
  });

  it("serializes concurrent transitions: exactly one wins", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const rs = await Promise.all(Array.from({ length: 6 }, () => move(t.w, inc.id, "investigating", { expectedStatus: "detected" })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
    expect((await api.get(`${I}/${inc.id}/state-history`, t.w)).body.data).toHaveLength(2);
  });

  it("internal transitions are idempotent and reject key reuse for a different target", async () => {
    const t = await acme();
    const { inc } = await planned(t);
    for (const to of ["containment_planned", "awaiting_approval"]) await move(t.w, inc.id, to);
    const key = "approval-evt-1";
    const first = await sysMove(t.w.org, inc.id, "approved", { idempotencyKey: key, data: { approvalId: "ap-1" } });
    const retry = await sysMove(t.w.org, inc.id, "approved", { idempotencyKey: key, data: { approvalId: "ap-1" } });
    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    await expect(sysMove(t.w.org, inc.id, "rejected", { idempotencyKey: key })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await api.get(`${I}/${inc.id}/state-history`, t.w)).body.data.filter((h: any) => h.to === "approved")).toHaveLength(1);
    const ev = (await api.get(`${I}/${inc.id}/timeline?limit=200`, t.w)).body.data.filter((e: any) => e.eventType === "incident.transitioned" && e.data.to === "approved");
    expect(ev).toHaveLength(1);
    expect(ev[0].data.context).toEqual({ approvalId: "ap-1" });
  });

  it("people cannot attach structured context to a transition and viewers cannot transition", async () => {
    const t = await acme();
    const inc = await create(t.w);
    await expect(svc().transition({ actorId: t.w.actor, organizationId: t.w.org, role: "operator" }, inc.id, { to: "investigating", reason: "x", data: { a: 1 } })).rejects.toMatchObject({ statusCode: 403 });
    const viewer = who("viewer", t.w.org);
    expect((await move(viewer, inc.id, "investigating")).status).toBe(403);
  });
});

describe("agent and resource associations", () => {
  it("associates agents with defaults, never changes agent status, and refuses duplicates", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const r = await api.post(`${I}/${inc.id}/agents`, t.w, { agentId: t.payment, relationship: "compromised", sourceReference: "alert-17" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ relationship: "compromised", suspectedCompromised: true, impact: "direct", source: "manual", createdBy: t.w.actor, sourceReference: "alert-17" });
    expect((await api.post(`${I}/${inc.id}/agents`, t.w, { agentId: t.analytics, relationship: "dependent" })).body.data).toMatchObject({ suspectedCompromised: false, impact: "indirect" });
    expect((await api.post(`${I}/${inc.id}/agents`, t.w, { agentId: t.database, relationship: "preserved" })).body.data.impact).toBe("none");
    // the same agent under another relationship is allowed; the same pair twice is not
    expect((await api.post(`${I}/${inc.id}/agents`, t.w, { agentId: t.payment, relationship: "affected" })).status).toBe(201);
    const dup = await api.post(`${I}/${inc.id}/agents`, t.w, { agentId: t.payment, relationship: "compromised" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ALREADY_ASSOCIATED");
    expect((await api.post(`${I}/${inc.id}/agents`, t.w, { agentId: t.email, relationship: "compromised", suspectedCompromised: false })).body.error.code).toBe("INCONSISTENT_ASSOCIATION");

    expect((await api.get(`${I}/${inc.id}/agents`, t.w)).body.data).toHaveLength(4);
    // association must not touch the Agent Registry
    expect((await api.get(`/api/v1/agents/${t.payment}`, t.w)).body.data.status).toBe("active");
    expect((await q("select count(*)::int n from agent_status_history where agent_id=$1", [t.payment])).rows[0].n).toBe(1);
  });

  it("ignores a client-supplied source: HTTP associations are always manual", async () => {
    const t = await acme();
    const inc = await create(t.w);
    expect((await api.post(`${I}/${inc.id}/agents`, t.w, { agentId: t.payment, relationship: "affected", source: "blast_radius" })).status).toBe(400);
    await expect(svc().addAgent({ actorId: t.w.actor, organizationId: t.w.org, role: "operator" }, inc.id, { agentId: t.payment, relationship: "affected", source: "blast_radius" })).rejects.toMatchObject({ statusCode: 403 });
    const row = await svc().addAgent(sys(t.w.org), inc.id, { agentId: t.payment, relationship: "affected", source: "blast_radius", sourceReference: "ref" });
    expect(row.source).toBe("blast_radius");
  });

  it("associates resources, copying the type from the registry", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const r = await api.post(`${I}/${inc.id}/resources`, t.w, { resourceId: t.wallet, relationship: "exposed", impactClassification: "exposed", sourceReference: "blast:1" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ resourceType: "api", relationship: "exposed", impactClassification: "exposed", source: "manual" });
    expect((await api.post(`${I}/${inc.id}/resources`, t.w, { resourceId: t.customerApi, relationship: "protected" })).body.data.impactClassification).toBe("unassessed");
    expect((await api.post(`${I}/${inc.id}/resources`, t.w, { resourceId: t.wallet, relationship: "exposed" })).status).toBe(409);
    expect((await api.get(`${I}/${inc.id}/resources`, t.w)).body.data).toHaveLength(2);
    expect((await api.post(`${I}/${inc.id}/resources`, t.w, { resourceId: t.wallet, relationship: "exposed", impactClassification: "doomed" })).status).toBe(400);
  });
});

describe("assignment and notes", () => {
  it("assigns, records the history and reassigns", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const a1 = randomUUID();
    const a2 = randomUUID();
    const r = await api.post(`${I}/${inc.id}/assign`, t.w, { assigneeId: a1, note: "on call" });
    expect(r.body.data.incident.assigneeId).toBe(a1);
    expect(r.body.data.assignment).toMatchObject({ assigneeId: a1, assignedBy: t.w.actor, note: "on call" });
    await api.post(`${I}/${inc.id}/assign`, t.w, { assigneeId: a2 });
    expect((await api.get(`${I}/${inc.id}/assignments`, t.w)).body.data.map((a: any) => a.assigneeId)).toEqual([a1, a2]);
    expect((await get(t.w, inc.id)).assigneeId).toBe(a2);
    expect((await api.get(`${I}?assigneeId=${a2}`, t.w)).body.pagination.total).toBe(1);
    const ev = (await api.get(`${I}/${inc.id}/timeline`, t.w)).body.data.filter((e: any) => e.eventType === "incident.assigned");
    expect(ev[1].data).toMatchObject({ assigneeId: a2, previousAssigneeId: a1 });
    expect((await api.post(`${I}/${inc.id}/assign`, t.w, { assigneeId: "someone" })).status).toBe(400);
    expect((await api.post(`${I}/${inc.id}/assign`, t.w, { assigneeId: a1, assignedBy: randomUUID() })).status).toBe(400);
  });

  it("adds notes by the authenticated author, in order, never editable, and refuses credentials", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const n1 = await api.post(`${I}/${inc.id}/notes`, t.w, { content: "Wallet calls began at 14:02." });
    expect(n1.status).toBe(201);
    expect(n1.body.data).toMatchObject({ authorId: t.w.actor, content: "Wallet calls began at 14:02." });
    await api.post(`${I}/${inc.id}/notes`, t.w, { content: "Correction: 14:05." });
    expect((await api.get(`${I}/${inc.id}/notes`, t.w)).body.data.map((n: any) => n.content)).toEqual(["Wallet calls began at 14:02.", "Correction: 14:05."]);
    expect((await api.post(`${I}/${inc.id}/notes`, t.w, { content: "x", authorId: randomUUID() })).status).toBe(400);
    expect((await api.post(`${I}/${inc.id}/notes`, t.w, { content: "  " })).status).toBe(400);
    expect((await api.post(`${I}/${inc.id}/notes`, t.w, { content: "x".repeat(4001) })).status).toBe(400);
    const secret = await api.post(`${I}/${inc.id}/notes`, t.w, { content: "-----BEGIN PRIVATE KEY-----\nMIIE..." });
    expect(secret.status).toBe(422);
    expect(secret.body.error.code).toBe("CONTAINS_SECRET");
    expect(secret.raw).not.toMatch(/MIIE/);
    await expect(q("update incident_notes set content='edited' where incident_id=$1", [inc.id])).rejects.toMatchObject({ code: "23001" });
    // the timeline records that a note exists, not its text
    const ev = (await api.get(`${I}/${inc.id}/timeline`, t.w)).body.data.find((e: any) => e.eventType === "incident.note_added");
    expect(JSON.stringify(ev)).not.toMatch(/14:0/);
  });
});

describe("analysis references", () => {
  it("pins a snapshot by id and hash without copying the graph", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const r = await api.post(`${I}/${inc.id}/graph-snapshot`, t.w, { label: "pre-incident" });
    expect(r.status).toBe(201);
    const ref = r.body.data;
    expect(ref).toMatchObject({ kind: "graph_snapshot", version: 1, snapshotFormatVersion: 1 });
    expect(ref.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ref.summary).toMatchObject({ nodeCount: 7, edgeCount: 7 });
    const snap = (await api.get(`/api/v1/graph/snapshots/${ref.snapshotId}`, t.w)).body.data;
    expect(snap).toMatchObject({ contentHash: ref.snapshotHash, incidentId: inc.id, label: "pre-incident" });
    expect(ref.snapshotCapturedAt).toBe(snap.builtAt);
    expect(JSON.stringify(ref)).not.toMatch(/"nodes"|"edges"/);
    expect((await get(t.w, inc.id)).current.snapshot.id).toBe(ref.id);
    // attaching an existing snapshot is also supported
    const second = await api.post(`${I}/${inc.id}/graph-snapshot`, t.w, { snapshotId: ref.snapshotId });
    expect(second.body.data).toMatchObject({ version: 2, snapshotId: ref.snapshotId });
  });

  it("blast radius needs a snapshot and compromised agents, is computed on the pinned snapshot, and is reproducible", async () => {
    const t = await acme();
    const inc = await create(t.w);
    expect((await api.post(`${I}/${inc.id}/blast-radius`, t.w, {})).body.error.code).toBe("SNAPSHOT_REQUIRED");
    await api.post(`${I}/${inc.id}/graph-snapshot`, t.w, {});
    expect((await api.post(`${I}/${inc.id}/blast-radius`, t.w, {})).body.error.code).toBe("NO_COMPROMISED_AGENTS");
    await api.post(`${I}/${inc.id}/agents`, t.w, { agentId: t.payment, relationship: "compromised" });

    // the registry changes after the snapshot: the analysis must not see it
    await createDep(api, t.w, resourceDep(t.payment, await mkResource(api, t.w)));

    const r = await api.post(`${I}/${inc.id}/blast-radius`, t.w, {});
    expect(r.status).toBe(201);
    const { reference, result } = r.body.data;
    expect(reference).toMatchObject({ kind: "blast_radius", version: 1, resultHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(reference.input.sourceNodeIds).toEqual([A(t.payment)]);
    expect(result.graph.edgeCount).toBe(7);
    expect(result.impacted.find((n: any) => n.nodeId === `resource:${t.wallet}`).classification).toBe("exposed");
    expect(result.healthyNodeIds).toContain(A(t.database));
    expect(reference.summary).toMatchObject({ impactedCount: result.impacted.length, graph: { edgeCount: 7 } });

    const v = (await api.get(`${I}/${inc.id}/analysis/${reference.id}/verify`, t.w)).body.data;
    expect(v).toMatchObject({ reproducible: true, snapshotHashMatches: true, storedResultHash: reference.resultHash, computedResultHash: reference.resultHash });
    expect((await get(t.w, inc.id)).current.blastRadius.id).toBe(reference.id);
  });

  it("honours explicit sources and thresholds, and keeps them as the input", async () => {
    const t = await acme();
    const inc = await create(t.w);
    await api.post(`${I}/${inc.id}/graph-snapshot`, t.w, {});
    const r = await api.post(`${I}/${inc.id}/blast-radius`, t.w, { sourceNodeIds: [A(t.analytics)], confidenceThreshold: 0.9, staleAfterHours: 24 });
    expect(r.body.data.reference.input).toMatchObject({ sourceNodeIds: [A(t.analytics)], confidenceThreshold: 0.9, staleAfterHours: 24 });
    expect(r.body.data.result.options.confidenceThreshold).toBe(0.9);
    expect((await api.get(`${I}/${inc.id}/analysis/${r.body.data.reference.id}/verify`, t.w)).body.data.reproducible).toBe(true);
    expect((await api.post(`${I}/${inc.id}/blast-radius`, t.w, { sourceNodeIds: [`resource:${t.wallet}`] })).status).toBe(400);
    expect((await api.post(`${I}/${inc.id}/blast-radius`, t.w, { confidenceThreshold: 2 })).status).toBe(400);
  });

  it("stores a containment plan reference with its hash and status; the plan is a proposal, not an approval", async () => {
    const t = await acme();
    const { inc, plan } = await planned(t);
    const { reference, result } = plan;
    expect(reference).toMatchObject({ kind: "containment_plan", version: 1, planHash: result.plan.planHash, planStatus: "feasible" });
    expect(reference.summary).toMatchObject({ status: "feasible", totalCost: 2, actionCount: 2, approvalRequired: false, protectedWasDefaulted: true });
    expect(await status(t.w, inc.id)).toBe("investigating"); // generating a plan changes nothing about the lifecycle
    const tl = (await api.get(`${I}/${inc.id}/timeline?limit=100`, t.w)).body.data.map((e: any) => e.eventType);
    expect(tl).toContain("incident.containment_plan_attached");
    expect(tl).not.toContain("approval.granted");
    expect((await api.get(`${I}/${inc.id}/analysis/${reference.id}/verify`, t.w)).body.data).toMatchObject({ reproducible: true, computedResultHash: reference.resultHash });
    const again = await api.post(`${I}/${inc.id}/containment-plan`, t.w, { protectedNodeIds: [`resource:${t.wallet}`] });
    expect(again.body.data.reference).toMatchObject({ version: 2 });
    expect(again.body.data.reference.planHash).not.toBe(reference.planHash);
    expect((await get(t.w, inc.id)).current.containmentPlan.id).toBe(again.body.data.reference.id);
    expect((await api.get(`${I}/${inc.id}/analysis?kind=containment_plan`, t.w)).body.data.map((r: any) => r.version)).toEqual([1, 2]);
  });

  it("a new snapshot supersedes the blast radius and plan, which stay in history", async () => {
    const t = await acme();
    const { inc } = await planned(t);
    await api.post(`${I}/${inc.id}/blast-radius`, t.w, {});
    expect((await get(t.w, inc.id)).current.containmentPlan).not.toBeNull();
    await api.post(`${I}/${inc.id}/graph-snapshot`, t.w, {});
    const d = await get(t.w, inc.id);
    expect(d.current.blastRadius).toBeNull();
    expect(d.current.containmentPlan).toBeNull();
    expect((await api.get(`${I}/${inc.id}/analysis`, t.w)).body.data.map((r: any) => r.kind).sort()).toEqual(["blast_radius", "containment_plan", "graph_snapshot", "graph_snapshot"]);
    expect((await move(t.w, inc.id, "containment_planned")).body.error.code).toBe("CONTAINMENT_PLAN_REQUIRED");
  });

  it("locks the plan once approval is requested", async () => {
    const t = await acme();
    const { inc } = await planned(t);
    await move(t.w, inc.id, "containment_planned");
    await move(t.w, inc.id, "awaiting_approval");
    const r = await api.post(`${I}/${inc.id}/containment-plan`, t.w, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PLAN_LOCKED");
    expect((await api.post(`${I}/${inc.id}/graph-snapshot`, t.w, {})).body.error.code).toBe("ANALYSIS_NOT_ALLOWED");
    const ev = (await api.get(`${I}/${inc.id}/timeline?limit=100`, t.w)).body.data.find((e: any) => e.eventType === "approval.requested");
    expect(ev.data.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await ctx.app.incidentManagement.reader.getCurrentPlanReference(t.w.org, inc.id))?.planHash).toBe(ev.data.planHash);
  });

  it("detects a tampered snapshot: verification reports it and new analysis refuses to run", async () => {
    const t = await acme();
    const { inc, plan } = await planned(t);
    const snapId = plan.reference.snapshotId;
    await q("alter table graph_snapshots disable trigger graph_snapshots_append_only");
    await q("update graph_snapshots set payload = jsonb_set(payload, '{nodes}', '[]'::jsonb) where id=$1", [snapId]);
    await q("alter table graph_snapshots enable trigger graph_snapshots_append_only");
    const v = (await api.get(`${I}/${inc.id}/analysis/${plan.reference.id}/verify`, t.w)).body.data;
    expect(v).toMatchObject({ reproducible: false, snapshotHashMatches: false });
    const r = await api.post(`${I}/${inc.id}/blast-radius`, t.w, {});
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("SNAPSHOT_INTEGRITY_FAILED");
  });

  it("references are append-only", async () => {
    const t = await acme();
    const { inc } = await planned(t);
    await expect(q("update incident_analysis_references set plan_status='feasible' where incident_id=$1", [inc.id])).rejects.toMatchObject({ code: "23001" });
    await expect(q("delete from incident_analysis_references where incident_id=$1", [inc.id])).rejects.toMatchObject({ code: "23001" });
  });
});

describe("external events (contract for later modules)", () => {
  it("records approval, enforcement, verification and evidence events once per idempotency key", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const s = sys(t.w.org);
    const publish = (type: string, key: string, data: Record<string, unknown> = {}) => svc().recordExternalEvent(s, inc.id, { type: type as never, data, idempotencyKey: key }, { correlationId: "corr-1" });
    expect(await publish("approval.granted", "a1", { approvalId: "ap-1", planHash: "abc" })).toEqual({ recorded: true });
    expect(await publish("approval.granted", "a1", { approvalId: "ap-1", planHash: "abc" })).toEqual({ recorded: false });
    for (const [type, key] of [["enforcement.result_received", "e1"], ["verification.result_received", "v1"], ["evidence.generated", "ev1"], ["detection.signal_received", "d1"]]) expect((await publish(type!, key!)).recorded).toBe(true);
    const tl = (await api.get(`${I}/${inc.id}/timeline?limit=100`, t.w)).body.data;
    expect(tl.map((e: any) => e.eventType)).toEqual(["incident.created", "approval.granted", "enforcement.result_received", "verification.result_received", "evidence.generated", "detection.signal_received"]);
    expect(tl[1]).toMatchObject({ actorType: "system", correlationId: "corr-1", data: { approvalId: "ap-1" } });
    expect(await status(t.w, inc.id)).toBe("detected"); // an event never changes lifecycle state
  });

  it("is concurrency-safe for duplicate deliveries", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const rs = await Promise.all(Array.from({ length: 8 }, () => svc().recordExternalEvent(sys(t.w.org), inc.id, { type: "evidence.generated", data: { n: 1 }, idempotencyKey: "same" })));
    expect(rs.filter((r) => r.recorded)).toHaveLength(1);
    expect((await q("select count(*)::int n from incident_events where incident_id=$1 and event_type='evidence.generated'", [inc.id])).rows[0].n).toBe(1);
  });

  it("is internal only, validated, secret-free, and accepted late on a closed incident", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const human = { actorId: t.w.actor, organizationId: t.w.org, role: "admin" as const };
    await expect(svc().recordExternalEvent(human, inc.id, { type: "evidence.generated", data: {}, idempotencyKey: "k" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc().recordExternalEvent(sys(t.w.org), inc.id, { type: "incident.created" as never, data: {}, idempotencyKey: "k" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc().recordExternalEvent(sys(t.w.org), inc.id, { type: "evidence.generated", data: {}, idempotencyKey: "" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc().recordExternalEvent(sys(t.w.org), inc.id, { type: "evidence.generated", data: { apiKey: "abc" }, idempotencyKey: "k" })).rejects.toMatchObject({ code: "CONTAINS_SECRET" });
    await expect(svc().recordExternalEvent(sys(t.w.org), inc.id, { type: "evidence.generated", data: { blob: "x".repeat(9000) }, idempotencyKey: "k" })).rejects.toMatchObject({ statusCode: 400 });
    // there is no HTTP route for it
    expect((await api.post(`${I}/${inc.id}/events`, t.w, { type: "approval.granted" })).status).toBe(404);
    await move(t.w, inc.id, "false_positive");
    await move(t.w, inc.id, "closed");
    expect((await svc().recordExternalEvent(sys(t.w.org), inc.id, { type: "evidence.generated", data: { bundle: "b1" }, idempotencyKey: "late" })).recorded).toBe(true);
  });
});

describe("tenant isolation and permissions", () => {
  it("another organization sees 404 for every incident endpoint and cannot reference foreign entities", async () => {
    const a = await acme();
    const b = await acme();
    const { inc, plan } = await planned(a);
    const ref = plan.reference.id;
    const gets = [`${I}/${inc.id}`, `${I}/${inc.id}/agents`, `${I}/${inc.id}/resources`, `${I}/${inc.id}/timeline`, `${I}/${inc.id}/notes`, `${I}/${inc.id}/assignments`, `${I}/${inc.id}/state-history`, `${I}/${inc.id}/analysis`, `${I}/${inc.id}/analysis/${ref}/verify`];
    for (const url of gets) {
      const r = await api.get(url, b.w);
      expect(r.status, url).toBe(404);
      expect(r.body.error.code, url).toMatch(/INCIDENT_NOT_FOUND/);
    }
    const posts: Array<[string, object]> = [
      [`${I}/${inc.id}/transition`, { to: "false_positive", reason: "x" }], [`${I}/${inc.id}/agents`, { agentId: b.payment, relationship: "observed" }], [`${I}/${inc.id}/resources`, { resourceId: b.wallet, relationship: "observed" }],
      [`${I}/${inc.id}/assign`, { assigneeId: randomUUID() }], [`${I}/${inc.id}/notes`, { content: "x" }], [`${I}/${inc.id}/graph-snapshot`, {}], [`${I}/${inc.id}/blast-radius`, {}], [`${I}/${inc.id}/containment-plan`, {}],
    ];
    for (const [url, body] of posts) expect((await api.post(url, b.w, body)).status, url).toBe(404);
    expect((await api.patch(`${I}/${inc.id}`, b.w, { title: "pwn" })).status).toBe(404);
    expect(await status(a.w, inc.id)).toBe("investigating");
    expect((await api.get(I, b.w)).body.pagination.total).toBe(0);
  });

  it("cross-tenant agents, resources and snapshots are refused as references", async () => {
    const a = await acme();
    const b = await acme();
    const inc = await create(a.w);
    const agent = await api.post(`${I}/${inc.id}/agents`, a.w, { agentId: b.payment, relationship: "compromised" });
    expect(agent.status).toBe(404);
    expect(agent.body.error.code).toBe("AGENT_NOT_FOUND");
    expect((await api.post(`${I}/${inc.id}/resources`, a.w, { resourceId: b.wallet, relationship: "exposed" })).body.error.code).toBe("RESOURCE_NOT_FOUND");
    const foreignSnap = (await api.post("/api/v1/graph/snapshots", b.w, {})).body.data;
    const snap = await api.post(`${I}/${inc.id}/graph-snapshot`, a.w, { snapshotId: foreignSnap.id });
    expect(snap.status).toBe(404);
    expect(snap.body.error.code).toBe("SNAPSHOT_NOT_FOUND");
    // explicit source nodes from another tenant do not exist in this tenant's graph
    await api.post(`${I}/${inc.id}/graph-snapshot`, a.w, {});
    expect((await api.post(`${I}/${inc.id}/blast-radius`, a.w, { sourceNodeIds: [A(b.payment)] })).status).toBe(404);
    expect((await api.post(I, a.w, { title: "t", severity: "low", agents: [{ agentId: b.payment, relationship: "observed" }] })).status).toBe(404);
    // and the database itself refuses a cross-tenant association
    await expect(q("insert into incident_agents (organization_id, incident_id, agent_id, relationship, impact, source, created_by) values ($1,$2,$3,'observed','none','manual',$4)", [a.w.org, inc.id, b.payment, a.w.actor])).rejects.toMatchObject({ code: "23503" });
  });

  it("enforces roles: viewers read, operators write and transition, only admins recover", async () => {
    const t = await acme();
    const viewer = who("viewer", t.w.org);
    const inc = await create(t.w);
    expect((await api.get(`${I}/${inc.id}`, viewer)).status).toBe(200);
    expect((await api.get(I, viewer)).status).toBe(200);
    expect((await api.get(`${I}/${inc.id}/timeline`, viewer)).status).toBe(200);
    expect((await api.post(I, viewer, { title: "t", severity: "low" })).status).toBe(403);
    expect((await api.patch(`${I}/${inc.id}`, viewer, { title: "t" })).status).toBe(403);
    expect((await api.post(`${I}/${inc.id}/notes`, viewer, { content: "x" })).status).toBe(403);
    expect((await api.post(`${I}/${inc.id}/assign`, viewer, { assigneeId: randomUUID() })).status).toBe(403);
    expect((await api.post(`${I}/${inc.id}/agents`, viewer, { agentId: t.payment, relationship: "observed" })).status).toBe(403);
    expect((await api.post(`${I}/${inc.id}/graph-snapshot`, viewer, {})).status).toBe(403);
    expect((await api.post(`${I}/${inc.id}/transition`, viewer, { to: "investigating", reason: "x" })).status).toBe(403);
    expect((await api.get(I, null)).status).toBe(401);
    expect((await api.get(I, { ...t.w, role: "superuser" as never })).status).toBe(401);
  });

  it("the actor on every record is the authenticated identity, never a body value", async () => {
    const t = await acme();
    const inc = await create(t.w);
    await api.post(`${I}/${inc.id}/notes`, t.w, { content: "n" });
    await move(t.w, inc.id, "investigating");
    const actors = (await q(`select actor_id from incident_events where incident_id=$1 union select actor_id from incident_audit_logs where incident_id=$1 union select actor_id from incident_state_history where incident_id=$1`, [inc.id])).rows.map((r) => r.actor_id);
    expect(actors).toEqual([t.w.actor]);
  });
});

describe("history cannot be rewritten", () => {
  it("timeline, state history, audit, associations and assignments reject UPDATE, DELETE and TRUNCATE", async () => {
    const t = await acme();
    const inc = await create(t.w, { agents: [{ agentId: t.payment, relationship: "observed" }], resources: [{ resourceId: t.wallet, relationship: "observed" }] });
    await api.post(`${I}/${inc.id}/assign`, t.w, { assigneeId: randomUUID() });
    await api.post(`${I}/${inc.id}/notes`, t.w, { content: "n" });
    for (const table of ["incident_events", "incident_state_history", "incident_audit_logs", "incident_agents", "incident_resources", "incident_assignments", "incident_notes"]) {
      await expect(q(`update ${table} set organization_id = organization_id where incident_id=$1`, [inc.id]), `update ${table}`).rejects.toMatchObject({ code: "23001" });
      await expect(q(`delete from ${table} where incident_id=$1`, [inc.id]), `delete ${table}`).rejects.toMatchObject({ code: "23001" });
      await expect(q(`truncate ${table}`), `truncate ${table}`).rejects.toMatchObject({ code: "23001" });
    }
  });

  it("an incident row cannot be hard-deleted while history references it", async () => {
    const t = await acme();
    const inc = await create(t.w);
    await expect(q("delete from incidents where id=$1", [inc.id])).rejects.toMatchObject({ code: "23503" });
  });

  it("errors never leak SQL or internals", async () => {
    const t = await acme();
    const inc = await create(t.w);
    const responses = [await api.get(`${I}/${inc.id}/analysis/${randomUUID()}/verify`, t.w), await api.post(`${I}/${inc.id}/blast-radius`, t.w, {}), await move(t.w, inc.id, "contained")];
    for (const r of responses) expect(r.raw).not.toMatch(/select |insert |constraint|relation "|stack|at \w+ \(/i);
  });
});
