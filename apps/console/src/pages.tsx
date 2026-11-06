import { useState } from "react";
import { api, session, type Session } from "./api";
import { go } from "./app";
import { seedAcme } from "./demo";
import { Card, Empty, Err, Pill, short, useAction, useLoad, when } from "./ui";

const me = () => session() as Session;
const demoKey = () => `corven.demo.${me().org}`;
const loadDemo = () => JSON.parse(localStorage.getItem(demoKey()) ?? "null") as null | Record<string, string>;
const reason = (what: string) => window.prompt(`Reason for ${what}`, what)?.trim();

// ---------------------------------------------------------------------------------------------- Overview
export function Overview() {
  const d = useLoad(async () => {
    const [incidents, approvals, agents, arkiv] = await Promise.all([
      api.get("/incidents?limit=200"), api.get("/approvals?status=pending&limit=200"), api.get("/agents?limit=1"), api.get("/evidence/arkiv/stats").catch(() => null),
    ]);
    const byStatus: Record<string, number> = {};
    for (const i of incidents.data) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    return { incidents: incidents.data as any[], total: incidents.pagination.total as number, byStatus, approvals: approvals.data as any[], agents: agents.pagination.total as number, arkiv };
  });
  const act = useAction();
  const [log, setLog] = useState<string[]>([]);
  const [health, setHealth] = useState<any>(null);
  const demo = loadDemo();
  const role = me().role;

  const seed = () => act.run(async () => {
    setLog([]);
    const ids = await seedAcme(me(), (m) => setLog((l) => [...l, m]));
    localStorage.setItem(demoKey(), JSON.stringify(ids));
  }, d.reload);
  const compromise = () => act.run(async () => {
    const ids = loadDemo()!;
    const inc = (await api.post("/incidents", { title: "Support agent compromised", description: "Unexpected transfer requests observed from the support agent.", severity: "critical", agents: [{ agentId: ids.support, relationship: "compromised" }] })).data;
    const wf = (await api.post("/workflows", { incidentId: inc.id })).data;
    await api.post(`/workflows/${wf.id}/run`);
    go(`incident/${inc.id}`);
  });

  return (
    <>
      <h1>Overview</h1>
      <div className="stats">
        <Stat label="Incidents" v={d.data?.total} />
        <Stat label="Awaiting approval" v={d.data?.approvals.length} />
        <Stat label="Contained" v={d.data?.byStatus.contained ?? 0} />
        <Stat label="Agents" v={d.data?.agents} />
        <Stat label="Arkiv anchors confirmed" v={d.data?.arkiv?.data.confirmed} />
      </div>
      <Err e={d.error} />
      <Card title="Demo: the Acme network" actions={<>
        {role === "admin" && <button onClick={seed} disabled={act.busy}>{demo ? "Load another copy" : "Load demo network"}</button>}
        {demo && (role === "admin" || role === "operator") && <button className="primary" onClick={compromise} disabled={act.busy}>Simulate a compromise</button>}
      </>}>
        <p className="muted">Registers four agents and two gateway-protected resources with dependencies, machine credentials and grants, then lets you raise an incident for a compromised Support Agent and run the full response: analysis, a containment plan, <b>your approval</b>, enforcement, verification and evidence.</p>
        {role !== "admin" && !demo && <p className="muted">Sign in as <b>admin</b> to load the demo network.</p>}
        {demo && <p className="muted">Demo network loaded in this organization.</p>}
        {log.length > 0 && <pre className="log">{log.join("\n")}</pre>}
        <Err e={act.error} />
      </Card>
      <Card title="Arkiv evidence anchoring" actions={role === "admin" && <button onClick={() => act.run(async () => setHealth((await api.get("/evidence/arkiv/health")).data))}>Check Rabdi connection</button>}>
        {d.data?.arkiv ? <p>Pending {d.data.arkiv.data.pending} · confirmed {d.data.arkiv.data.confirmed} · failed {d.data.arkiv.data.failed} · state <Pill v={d.data.arkiv.data.state} /></p> : <Empty>No Arkiv statistics.</Empty>}
        {health && <pre className="log">{JSON.stringify(health, null, 2)}</pre>}
      </Card>
      <Card title="Recent incidents">
        <IncidentTable rows={(d.data?.incidents ?? []).slice(0, 8)} />
      </Card>
    </>
  );
}
const Stat = ({ label, v }: { label: string; v: number | undefined }) => <div className="stat"><div className="n">{v ?? "…"}</div><div className="muted">{label}</div></div>;

// ---------------------------------------------------------------------------------------------- Incidents
function IncidentTable({ rows }: { rows: any[] }) {
  if (rows.length === 0) return <Empty>No incidents.</Empty>;
  return (
    <table>
      <thead><tr><th>Title</th><th>Severity</th><th>Status</th><th>Source</th><th>Created</th></tr></thead>
      <tbody>{rows.map((i) => <tr key={i.id} className="click" onClick={() => go(`incident/${i.id}`)}><td>{i.title}</td><td><Pill v={i.severity} /></td><td><Pill v={i.status} /></td><td>{i.detectionSource}</td><td>{when(i.createdAt)}</td></tr>)}</tbody>
    </table>
  );
}

export function Incidents() {
  const [status, setStatus] = useState("");
  const d = useLoad(() => api.get(`/incidents?limit=100${status ? `&status=${status}` : ""}`), [status]);
  const act = useAction();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("high");
  return (
    <>
      <h1>Incidents</h1>
      {me().role !== "viewer" && me().role !== "approver" && (
        <Card title="Report an incident">
          <div className="row">
            <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>{["critical", "high", "medium", "low", "informational"].map((s) => <option key={s}>{s}</option>)}</select>
            <button className="primary" disabled={!title.trim() || act.busy} onClick={() => act.run(async () => go(`incident/${(await api.post("/incidents", { title, severity })).data.id}`))}>Create</button>
          </div>
          <Err e={act.error} />
        </Card>
      )}
      <Card title="All incidents" actions={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">any status</option>{["detected", "investigating", "containment_planned", "awaiting_approval", "approved", "containing", "verifying", "contained", "partially_contained", "containment_failed", "rejected", "false_positive", "resolved", "closed"].map((s) => <option key={s}>{s}</option>)}</select>}>
        <Err e={d.error} />
        <IncidentTable rows={d.data?.data ?? []} />
      </Card>
    </>
  );
}

export function IncidentDetail({ id }: { id: string }) {
  const d = useLoad(async () => {
    const opt = (p: Promise<any>) => p.catch(() => null);
    const [inc, timeline, agents, workflow, approvals, runs, evidence] = await Promise.all([
      api.get(`/incidents/${id}`), api.get(`/incidents/${id}/timeline?limit=200`), api.get(`/incidents/${id}/agents`), opt(api.get(`/incidents/${id}/workflow`)),
      api.get(`/approvals?incidentId=${id}&limit=50`), opt(api.get(`/incidents/${id}/verification`)), opt(api.get(`/incidents/${id}/evidence`)),
    ]);
    const ev = await Promise.all(((evidence?.data ?? []) as any[]).map((e) => api.get(`/evidence/${e.id}`).then((r) => r.data)));
    return { inc: inc.data, timeline: timeline.data as any[], agents: agents.data as any[], workflow: workflow?.data ?? null, approvals: approvals.data as any[], runs: (runs?.data ?? []) as any[], evidence: ev };
  }, [id]);
  const act = useAction();
  const run = (fn: () => Promise<unknown>) => act.run(fn, d.reload);
  if (!d.data) return <><h1>Incident</h1><Err e={d.error} />{d.loading && <p className="muted">Loading…</p>}</>;
  const { inc, timeline, agents, workflow, approvals, runs, evidence } = d.data;
  const role = me().role;
  const canWrite = role === "admin" || role === "operator";

  return (
    <>
      <h1>{inc.title} <Pill v={inc.severity} /> <Pill v={inc.status} /></h1>
      <p className="muted mono">incident {inc.id} · {inc.detectionSource} · created {when(inc.createdAt)}</p>
      <Err e={act.error} />
      {act.busy && <p className="muted">Working…</p>}

      <div className="grid2">
        <Card title="Automated response" actions={canWrite && (workflow
          ? <><button onClick={() => run(() => api.post(`/workflows/${workflow.id}/run`))}>Run now</button>{["failed", "blocked", "stopped"].includes(workflow.status) && <button onClick={() => run(() => api.post(`/workflows/${workflow.id}/retry`))}>Retry</button>}</>
          : <button className="primary" onClick={() => run(async () => { const w = (await api.post("/workflows", { incidentId: id })).data; await api.post(`/workflows/${w.id}/run`); })}>Start</button>)}>
          {workflow ? (
            <>
              <p>Status <Pill v={workflow.status} /> · step <b>{workflow.step}</b>{workflow.outcome && <> · outcome <Pill v={workflow.outcome} /></>}</p>
              {workflow.lastError && <div className="err">{workflow.lastError}</div>}
              {workflow.status === "waiting" && workflow.step === "awaiting_approval" && <div className="warn">Waiting for a person to approve the containment plan (Approvals, as <b>approver</b> or <b>admin</b>). Then press <b>Run now</b>.</div>}
              <ul className="events">{(workflow.events ?? []).slice(-8).map((e: any) => <li key={e.sequence}><span className="muted">{when(e.at)}</span> {e.type} {e.detail?.step ?? e.detail?.outcome ?? ""}</li>)}</ul>
            </>
          ) : <Empty>Not started. The workflow analyses, requests approval, enforces, verifies and seals evidence; it never approves on its own.</Empty>}
        </Card>

        <Card title="Lifecycle">
          <div className="row wrap">
            {canWrite && (inc.availableTransitions as any[]).map((t) => <button key={t.to} onClick={() => { const r = reason(`moving to ${t.to}`); if (r) run(() => api.post(`/incidents/${id}/transition`, { to: t.to, reason: r, ...(t.to === "resolved" && inc.status === "partially_contained" ? { acknowledgeResidualRisk: true } : {}) })); }}>→ {t.to}</button>)}
            {(inc.availableTransitions as any[]).length === 0 && <Empty>No transitions available to your role from here.</Empty>}
          </div>
          <h3>Analysis</h3>
          <p className="muted">Snapshot {inc.current.snapshot ? <code>{short(inc.current.snapshot.snapshotHash, 12)}</code> : "—"} · Blast radius {inc.current.blastRadius ? `${inc.current.blastRadius.summary.impactedCount} impacted` : "—"} · Plan {inc.current.containmentPlan ? <><Pill v={inc.current.containmentPlan.planStatus} /> {inc.current.containmentPlan.summary.actionCount} actions</> : "—"}</p>
          {canWrite && <div className="row wrap">
            <button onClick={() => run(() => api.post(`/incidents/${id}/graph-snapshot`, {}))}>Capture snapshot</button>
            <button onClick={() => run(() => api.post(`/incidents/${id}/blast-radius`, {}))}>Blast radius</button>
            <button onClick={() => run(() => api.post(`/incidents/${id}/containment-plan`, {}))}>Containment plan</button>
          </div>}
        </Card>
      </div>

      <div className="grid2">
        <Card title="Approvals">
          {approvals.length === 0 ? <Empty>None requested.</Empty> : approvals.map((a) => <ApprovalRow key={a.id} a={a} onDone={d.reload} />)}
        </Card>
        <Card title="Agents involved">
          {agents.length === 0 ? <Empty>None associated.</Empty> : <table><tbody>{agents.map((a) => <tr key={a.id}><td className="mono">{short(a.agentId)}</td><td><Pill v={a.relationship} /></td><td>{a.impact}</td></tr>)}</tbody></table>}
        </Card>
      </div>

      <Card title="Verification" actions={canWrite && ["containing", "verifying"].includes(inc.status) && <button onClick={() => run(() => api.post("/verification/run", { incidentId: id }))}>Run verification</button>}>
        {runs.length === 0 ? <Empty>No verification runs.</Empty> : runs.map((r) => <VerificationRun key={r.id} id={r.id} />)}
      </Card>

      <Card title="Evidence" actions={canWrite && <button onClick={() => run(() => api.post("/evidence/generate", { incidentId: id }))}>Generate evidence</button>}>
        {evidence.length === 0 ? <Empty>No sealed evidence yet.</Empty> : evidence.map((e: any) => (
          <div key={e.id} className="evidence">
            <p>#{e.sequence} <Pill v={e.status} /> <span className="mono">sha256 {e.contentHash.slice(0, 16)}…</span> <span className="muted">{when(e.createdAt)}</span></p>
            <div className="row wrap">
              <button onClick={() => run(async () => { const v = (await api.post(`/evidence/${e.id}/verify`, {})).data; alert(`${v.valid ? "VALID" : "INVALID"}\n\n${v.steps.map((s: any) => `${s.name}: ${s.result}`).join("\n")}`); })}>Verify integrity</button>
              {role === "admin" && <button onClick={() => run(() => api.post(`/evidence/${e.id}/anchor`, { targets: ["arkiv"] }))}>Anchor on Arkiv</button>}
              {role === "admin" && <button onClick={() => run(() => api.post(`/evidence/${e.id}/anchors/refresh`, {}))}>Refresh anchors</button>}
            </div>
            {e.anchors.length > 0 && <table><tbody>{e.anchors.map((a: any) => <tr key={a.target}><td>{a.target}</td><td><Pill v={a.status} /></td><td className="mono">{a.externalReference ? (a.target === "arkiv" ? <a href={`https://rabdi.explorer.arkiv.network/entity/${a.externalReference}`} target="_blank" rel="noreferrer">{short(a.externalReference, 14)}</a> : short(a.externalReference, 14)) : "—"}</td><td className="muted">{a.errorCode ?? a.error ?? ""}</td></tr>)}</tbody></table>}
          </div>
        ))}
      </Card>

      <Card title="Timeline">
        <ul className="events">{timeline.map((t) => <li key={t.id}><span className="muted">{when(t.occurredAt)}</span> <b>{t.eventType}</b> <span className="muted">{t.actorType}</span> {t.data?.to ? `→ ${t.data.to}` : ""}</li>)}</ul>
      </Card>
    </>
  );
}

function VerificationRun({ id }: { id: string }) {
  const d = useLoad(() => api.get(`/verification/${id}`).then((r) => r.data), [id]);
  if (!d.data) return null;
  const r = d.data;
  return (
    <details className="run">
      <summary><Pill v={r.status} /> attempt {r.attempt} · {r.checks.length} checks · {when(r.completedAt)} {r.resultHashMatches === false && <b className="bad">result hash mismatch</b>}</summary>
      <table><thead><tr><th>Check</th><th>Expected</th><th>Observed</th><th>Result</th></tr></thead>
        <tbody>{r.checks.map((c: any) => <tr key={c.sequence}><td>{c.category.replace(/_TEST$/, "").toLowerCase().replace(/_/g, " ")}{c.action ? ` (${c.action})` : ""}</td><td>{c.expected}</td><td className="mono">{c.actual}</td><td><Pill v={c.result} /></td></tr>)}</tbody></table>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------- Approvals
function ApprovalRow({ a, onDone }: { a: any; onDone: () => void }) {
  const act = useAction();
  const role = me().role;
  const canDecide = (role === "approver" || role === "admin") && a.status === "pending";
  return (
    <div className="approval">
      <p><Pill v={a.status} /> plan <code>{a.planHash.slice(0, 12)}…</code> · risk <Pill v={a.risk} /> · needs {a.requiredApprovals} · expires {when(a.expiresAt)}</p>
      {canDecide && <div className="row">
        <button className="primary" onClick={() => act.run(() => api.post(`/approvals/${a.id}/approve`, { comment: "Reviewed in the console" }), onDone)}>Approve exact plan</button>
        <button onClick={() => { const c = reason("rejecting"); if (c) act.run(() => api.post(`/approvals/${a.id}/reject`, { comment: c }), onDone); }}>Reject</button>
      </div>}
      {a.status === "pending" && !canDecide && <p className="muted">Only an <b>approver</b> or <b>admin</b> can decide; the requester cannot approve their own request.</p>}
      <Err e={act.error} />
    </div>
  );
}

export function Approvals() {
  const d = useLoad(() => api.get("/approvals?limit=100"));
  return (
    <>
      <h1>Approvals</h1>
      <Card title="Requests">
        <Err e={d.error} />
        {(d.data?.data ?? []).length === 0 ? <Empty>No approval requests.</Empty> : (d.data!.data as any[]).map((a) => (
          <div key={a.id}><a href={`#/incident/${a.incidentId}`}>Incident {short(a.incidentId)}</a><ApprovalRow a={a} onDone={d.reload} /></div>
        ))}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Agents
export function Agents() {
  const d = useLoad(() => api.get("/agents?limit=100"));
  const act = useAction();
  const [name, setName] = useState("");
  const [type, setType] = useState("llm");
  const canWrite = me().role === "admin" || me().role === "operator";
  return (
    <>
      <h1>Agents</h1>
      {canWrite && <Card title="Register an agent">
        <div className="row"><input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select value={type} onChange={(e) => setType(e.target.value)}>{["llm", "workflow", "service", "wallet", "other"].map((t) => <option key={t}>{t}</option>)}</select>
          <button className="primary" disabled={!name.trim()} onClick={() => act.run(() => api.post("/agents", { name, agentType: type }), () => (setName(""), d.reload()))}>Register</button></div>
        <Err e={act.error} />
      </Card>}
      <Card title={`Registered (${d.data?.pagination.total ?? "…"})`}>
        <Err e={d.error} />
        <table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th></th></tr></thead>
          <tbody>{(d.data?.data ?? []).map((a: any) => <tr key={a.id}><td>{a.name}</td><td>{a.agentType}</td><td><Pill v={a.status} /></td>
            <td>{canWrite && a.status === "active" && <button onClick={() => { const r = reason("suspending"); if (r) act.run(() => api.post(`/agents/${a.id}/status`, { status: "suspended", reason: r }), d.reload); }}>Suspend</button>}</td></tr>)}</tbody></table>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Graph
const COLORS: Record<string, string> = { authority: "#c2410c", resource: "#2563eb", operational: "#059669" };
export function GraphView() {
  const d = useLoad(() => api.get("/graph/export").then((r) => r.data));
  if (!d.data) return <><h1>Dependency graph</h1><Err e={d.error} /></>;
  const nodes = d.data.nodes as any[];
  const edges = d.data.edges as any[];
  const agents = nodes.filter((n) => n.entityType === "agent");
  const resources = nodes.filter((n) => n.entityType === "resource");
  const H = Math.max(agents.length, resources.length) * 64 + 40;
  const pos = new Map<string, { x: number; y: number }>();
  agents.forEach((n, i) => pos.set(n.id, { x: 160 + (i % 2) * 180, y: 40 + i * 64 }));
  resources.forEach((n, i) => pos.set(n.id, { x: 760, y: 40 + i * 64 }));
  return (
    <>
      <h1>Dependency graph</h1>
      <Card title={`${nodes.length} nodes · ${edges.length} edges`} actions={<span className="legend">{Object.entries(COLORS).map(([k, c]) => <span key={k}><i style={{ background: c }} /> {k}</span>)}</span>}>
        {nodes.length === 0 ? <Empty>Nothing registered yet. Load the demo network from the Overview.</Empty> : (
          <svg viewBox={`0 0 960 ${H}`} className="graph">
            <defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#888" /></marker></defs>
            {edges.map((e) => { const a = pos.get(e.sourceNodeId), b = pos.get(e.targetNodeId); if (!a || !b) return null; const mx = (a.x + b.x) / 2; return <path key={e.id} d={`M${a.x + 70},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x - 70},${b.y}`} stroke={COLORS[e.dependencyType] ?? "#888"} strokeDasharray={e.status === "active" ? "" : "4 4"} fill="none" strokeWidth={2} markerEnd="url(#arr)"><title>{`${e.dependencyType}: ${e.relationship}`}</title></path>; })}
            {nodes.map((n) => { const p = pos.get(n.id)!; return <g key={n.id}><rect x={p.x - 70} y={p.y - 16} width={140} height={32} rx={6} className={`node ${n.entityType} st-${n.status ?? ""}`} /><text x={p.x} y={p.y + 4} textAnchor="middle">{n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name}</text></g>; })}
          </svg>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Gateway
export function Gateway() {
  const d = useLoad(async () => ({ coverage: (await api.get("/gateway/coverage")).data, permissions: (await api.get("/permissions?limit=100")).data as any[] }));
  return (
    <>
      <h1>Authorization gateway</h1>
      <Err e={d.error} />
      {d.data && <>
        <Card title="Enforcement coverage">
          <p>{Object.entries(d.data.coverage.summary).map(([k, v]) => <span key={k} className="kv"><Pill v={k.toLowerCase()} /> {String(v)}</span>)}</p>
          <ul className="muted">{(d.data.coverage.limitations as string[]).map((l) => <li key={l}>{l}</li>)}</ul>
        </Card>
        <Card title={`Grants (${d.data.permissions.length})`}>
          <table><thead><tr><th>Agent</th><th>Resource</th><th>Action</th><th>Status</th></tr></thead>
            <tbody>{d.data.permissions.map((p) => <tr key={p.id}><td className="mono">{short(p.agentId)}</td><td className="mono">{short(p.resourceId)}</td><td>{p.action}</td><td><Pill v={p.status} /></td></tr>)}</tbody></table>
        </Card>
      </>}
    </>
  );
}
