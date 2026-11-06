#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING CORVEN (./run.sh), over HTTP, as the console does it:
 * landing and console are served, the demo network is created, a compromise is raised, the workflow analyses and
 * waits for a person, an approver approves the exact plan, the workflow enforces, verifies and seals evidence,
 * and the evidence is anchored on Arkiv (when configured). Prints no secrets. Exit code 0 only if everything passed.
 *
 *   node scripts/smoke-e2e.mjs [http://127.0.0.1:3001]
 */
import { randomUUID } from "node:crypto";

const BASE = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
const org = randomUUID();
const as = (role) => ({ "x-dev-actor-id": randomUUID(), "x-dev-org-id": org, "x-dev-role": role });
const admin = as("admin"), operator = as("operator"), approver = as("approver");
let failures = 0;
const ok = (cond, what, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}${extra ? `  (${extra})` : ""}`); if (!cond) failures++; return cond; };
async function call(method, path, headers, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  if (!res.ok && json) throw new Error(`${method} ${path} -> ${res.status} ${json.error?.code}: ${json.error?.message}`);
  return { status: res.status, json, text };
}
const get = (p, h) => call("GET", `/api/v1${p}`, h);
const post = (p, h, b = {}) => call("POST", `/api/v1${p}`, h, b);
const put = (p, h, b) => call("PUT", `/api/v1${p}`, h, b);

try {
  // 1. what a visitor sees
  ok((await call("GET", "/health")).json?.status === "ok", "API health");
  const landing = await call("GET", "/", {});
  ok(landing.status === 200 && /CORVEN/.test(landing.text), "landing page served at /");
  ok(landing.text.includes('href="/console/"'), "landing page links to the console");
  const consoleHtml = await call("GET", "/console/", {});
  ok(consoleHtml.status === 200 && consoleHtml.text.includes('id="root"'), "console served at /console/");
  const asset = consoleHtml.text.match(/src="(\/console\/assets\/[^"]+\.js)"/)?.[1];
  ok(asset && (await call("GET", asset, {})).status === 200, "console bundle loads");
  ok((await fetch(`${BASE}/api/v1/incidents`)).status === 401, "API refuses unauthenticated requests");

  // 2. the demo network (same calls as the console's "Load demo network")
  const s = Date.now().toString(36);
  const agent = async (n) => (await post("/agents", admin, { name: `${n}-${s}`, agentType: "llm", externalReference: `${n}-${s}` })).json.data.id;
  const resource = async (n) => (await post("/resources", admin, { name: `${n}-${s}`, resourceType: "api" })).json.data.id;
  const support = await agent("support-agent"), payment = await agent("payment-agent"), analytics = await agent("analytics-agent"), database = await agent("database-agent");
  const wallet = await resource("wallet"), customerApi = await resource("customer-api");
  const dep = (b) => post("/dependencies", admin, { provenance: { source: "manual" }, ...b });
  await dep({ sourceType: "agent", sourceId: support, targetType: "agent", targetId: payment, dependencyType: "authority", relationship: "delegates_authority", metadata: { scope: "payment.execute" } });
  for (const [a, r] of [[payment, wallet], [payment, customerApi], [support, customerApi], [database, customerApi]]) await dep({ sourceType: "agent", sourceId: a, targetType: "resource", targetId: r, dependencyType: "resource", relationship: "accesses", metadata: { accessLevel: "read" } });
  await dep({ sourceType: "agent", sourceId: payment, targetType: "agent", targetId: analytics, dependencyType: "operational", relationship: "triggers" });
  for (const r of [wallet, customerApi]) await put(`/gateway/resources/${r}/enforcement`, admin, { mode: "gateway" });
  for (const a of [support, payment, analytics, database]) await post("/agent-auth/credentials", admin, { agentId: a });
  for (const [a, r, action] of [[payment, wallet, "transfer"], [payment, customerApi, "read"], [support, customerApi, "read"], [database, customerApi, "read"]]) await post("/permissions", admin, { agentId: a, resourceId: r, action });
  const graph = (await get("/graph/export", operator)).json.data;
  ok(graph.nodes.length === 6 && graph.edges.length === 6, "demo network registered", `${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  // 3. a compromise, and the automated response up to the human decision
  const inc = (await post("/incidents", operator, { title: "Support agent compromised", severity: "critical", agents: [{ agentId: support, relationship: "compromised" }] })).json.data;
  const wf = (await post("/workflows", operator, { incidentId: inc.id })).json.data;
  let w = (await post(`/workflows/${wf.id}/run`, operator)).json.data;
  ok(w.status === "waiting" && w.step === "awaiting_approval", "workflow analysed and is waiting for a person", `${w.status}/${w.step}${w.lastError ? ` ${w.lastError}` : ""}`);
  const detail = (await get(`/incidents/${inc.id}`, operator)).json.data;
  ok(detail.status === "awaiting_approval" && detail.current.containmentPlan?.planStatus === "feasible", "a feasible containment plan was produced", detail.current.containmentPlan ? `${detail.current.containmentPlan.summary.actionCount} actions` : "no plan");
  ok((await get(`/enforcement?incidentId=${inc.id}`, admin)).json.pagination.total === 0, "nothing enforced before approval");

  // 4. a person approves the exact plan
  const approval = (await get(`/approvals?incidentId=${inc.id}&status=pending`, approver)).json.data[0];
  ok(!!approval, "approval request is pending");
  const decided = (await post(`/approvals/${approval.id}/approve`, approver, { comment: "smoke test" })).json.data;
  ok(decided.status === "approved", "approver approved the plan");

  // 5. enforcement, verification, evidence, anchoring
  w = (await post(`/workflows/${wf.id}/run`, operator)).json.data;
  ok(w.status === "completed", "workflow completed", `${w.status} outcome=${w.outcome}${w.lastError ? ` ${w.lastError}` : ""}`);
  const finalInc = (await get(`/incidents/${inc.id}`, operator)).json.data;
  ok(finalInc.status === "contained", "incident contained (verified, not assumed)", finalInc.status);
  const runs = (await get(`/incidents/${inc.id}/verification`, operator)).json.data;
  ok(runs[0]?.status === "passed", "verification passed", runs[0]?.status);
  const actions = (await get(`/enforcement?incidentId=${inc.id}`, admin)).json.data;
  ok(actions.length > 0 && actions.every((a) => a.status === "executed"), "containment actions executed", `${actions.length} actions`);
  const ev = (await get(`/evidence/${w.evidenceId}`, operator)).json.data;
  ok(/^[0-9a-f]{64}$/.test(ev.contentHash), "evidence sealed", `sha256 ${ev.contentHash.slice(0, 12)}…`);
  const v = (await post(`/evidence/${ev.id}/verify`, operator)).json.data;
  ok(v.valid === true, "evidence verifies", v.steps.map((x) => `${x.name}:${x.result}`).join(" "));
  const arkivAnchor = ev.anchors.find((a) => a.target === "arkiv");
  const health = (await get("/evidence/arkiv/health", admin)).json.data;
  if (health.status === "operational") {
    ok(health.health.chainId === 7794095, "Arkiv Rabdi reachable", `authenticated=${health.health.authenticated} block ${health.health.blockNumber}`);
    ok(arkivAnchor?.status === "confirmed", "evidence anchored on Arkiv and read back", arkivAnchor ? `${arkivAnchor.status} ${arkivAnchor.externalReference ?? ""} ${arkivAnchor.errorCode ?? ""}` : "no anchor");
  } else {
    console.log(`SKIP  Arkiv anchoring: Arkiv is ${health.status}${health.reason ? ` (${health.reason})` : ""}`);
  }
} catch (e) {
  ok(false, "unexpected error", e.message);
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
console.log(`(organization used: ${org}; sign in to the console with it to see this run)`);
process.exit(failures === 0 ? 0 : 1);
