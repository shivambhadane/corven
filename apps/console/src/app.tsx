import { useEffect, useState } from "react";
import { health, session, setSession, uuid, type Role, type Session } from "./api";
import { Agents, Approvals, Gateway, GraphView, IncidentDetail, Incidents, Overview } from "./pages";
import { Logo, Overlays } from "./ui";

const NAV: Array<[string, string]> = [["overview", "Overview"], ["incidents", "Incidents"], ["approvals", "Approvals"], ["agents", "Agents"], ["graph", "Graph"], ["gateway", "Gateway"]];

function useRoute() {
  const read = () => (location.hash.replace(/^#\/?/, "") || "overview").split("/");
  const [route, set] = useState(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
export const go = (path: string) => (location.hash = `/${path}`);

export function App() {
  const [s, setS] = useState<Session | null>(session());
  const [up, setUp] = useState<boolean | null>(null);
  const route = useRoute();
  useEffect(() => void health().then(setUp), []);

  if (!s) return <SignIn onIn={(x) => (setSession(x), setS(x))} up={up} />;
  const [page, id] = route;
  return (
    <div className="shell">
      <Overlays />
      <aside className="side">
        <a className="brand" href="/"><Logo />CORVEN</a>
        <nav>{NAV.map(([k, label]) => <a key={k} href={`#/${k}`} className={page === k || (page === "incident" && k === "incidents") ? "on" : ""}>{label}</a>)}</nav>
        <div className="who">
          <div><span className="muted">role</span> <b>{s.role}</b></div>
          <div className="mono muted" title={s.org}>org {s.org.slice(0, 8)}…</div>
          <select aria-label="Role" value={s.role} onChange={(e) => { const x = { ...s, role: e.target.value as Role, actor: uuid() }; setSession(x); setS(x); }}>
            {(["admin", "operator", "approver", "viewer"] as Role[]).map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="link" onClick={() => (setSession(null), setS(null))}>Sign out</button>
          <div className={`api ${up ? "ok" : "down"}`}>API {up === null ? "…" : up ? "online" : "offline"}</div>
        </div>
      </aside>
      <main>
        {page === "overview" && <Overview />}
        {page === "incidents" && <Incidents />}
        {page === "incident" && id && <IncidentDetail id={id} />}
        {page === "approvals" && <Approvals />}
        {page === "agents" && <Agents />}
        {page === "graph" && <GraphView />}
        {page === "gateway" && <Gateway />}
      </main>
    </div>
  );
}

function SignIn({ onIn, up }: { onIn: (s: Session) => void; up: boolean | null }) {
  const [org, setOrg] = useState(() => localStorage.getItem("corven.lastOrg") ?? uuid());
  const [role, setRole] = useState<Role>("admin");
  return (
    <div className="signin">
      <Overlays />
      <div className="card narrow">
        <a className="brand" href="/"><Logo />CORVEN</a>
        <p className="muted">Operator console</p>
        <div className="warn" role="note">Development sign-in. The API trusts these values only when it runs with <code>CORVEN_DEV_AUTH=1</code>; real authentication is not built yet.</div>
        <label>Organization id<div className="row"><input className="mono" value={org} onChange={(e) => setOrg(e.target.value.trim())} /><button onClick={() => setOrg(uuid())}>New</button></div></label>
        <label>Role<select value={role} onChange={(e) => setRole(e.target.value as Role)}>{(["admin", "operator", "approver", "viewer"] as Role[]).map((r) => <option key={r}>{r}</option>)}</select></label>
        <button className="primary" disabled={!/^[0-9a-f-]{36}$/i.test(org)} onClick={() => { localStorage.setItem("corven.lastOrg", org); onIn({ org, actor: uuid(), role }); }}>Sign in</button>
        <div className={`api ${up ? "ok" : "down"}`}>API {up === null ? "checking…" : up ? "online" : "offline: start it with pnpm dev"}</div>
      </div>
    </div>
  );
}
