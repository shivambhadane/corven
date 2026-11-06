import { useEffect, useState } from "react";
import { health, session, setSession, uuid, type Role, type Session } from "./api";
import {
  Agents,
  ApiKeys,
  Approvals,
  Gateway,
  GraphView,
  IncidentDetail,
  Incidents,
  Overview,
  PlanUsage,
  TeamMembers,
  Webhooks,
} from "./pages";
import { Logo, Overlays } from "./ui";

const OPS_NAV: Array<[string, string]> = [
  ["overview", "Overview"],
  ["incidents", "Incidents"],
  ["approvals", "Approvals"],
  ["agents", "Agents"],
  ["graph", "Graph"],
  ["gateway", "Gateway"],
];

const SAAS_NAV: Array<[string, string]> = [
  ["api-keys", "API Keys"],
  ["webhooks", "Webhooks"],
  ["team", "Team & Access"],
  ["billing", "Plan & Usage"],
];

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

        <div className="workspace-box">
          <div className="workspace-header">
            <span className="workspace-name">{s.orgName || "Enterprise Workspace"}</span>
            <span className={`tier-badge tier-${s.tier || "pro"}`}>{s.tier || "pro"}</span>
          </div>
          <div className="mono muted" style={{ fontSize: "11px" }} title={s.org}>
            org {s.org.slice(0, 8)}…
          </div>
        </div>

        <nav>
          <div className="side-section-title">Operations</div>
          {OPS_NAV.map(([k, label]) => (
            <a
              key={k}
              href={`#/${k}`}
              className={page === k || (page === "incident" && k === "incidents") ? "on" : ""}
            >
              {label}
            </a>
          ))}

          <div className="side-section-title" style={{ marginTop: "var(--s-4)" }}>SaaS Platform</div>
          {SAAS_NAV.map(([k, label]) => (
            <a
              key={k}
              href={`#/${k}`}
              className={page === k ? "on" : ""}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="who">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="muted">Role</span>
            <b>{s.role}</b>
          </div>
          <select
            aria-label="Role"
            value={s.role}
            onChange={(e) => {
              const x = { ...s, role: e.target.value as Role, actor: uuid() };
              setSession(x);
              setS(x);
            }}
          >
            {(["admin", "operator", "approver", "viewer"] as Role[]).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
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
        {page === "api-keys" && <ApiKeys />}
        {page === "webhooks" && <Webhooks />}
        {page === "team" && <TeamMembers />}
        {page === "billing" && <PlanUsage />}
      </main>
    </div>
  );
}

function SignIn({ onIn, up }: { onIn: (s: Session) => void; up: boolean | null }) {
  const [tab, setTab] = useState<"workspace" | "apikey">("workspace");
  const [org, setOrg] = useState(() => localStorage.getItem("corven.lastOrg") ?? uuid());
  const [orgName, setOrgName] = useState("Acme CyberSec Corp");
  const [tier, setTier] = useState<"starter" | "pro" | "enterprise">("pro");
  const [role, setRole] = useState<Role>("admin");
  const [apiKey, setApiKey] = useState("");

  const handleSignIn = () => {
    localStorage.setItem("corven.lastOrg", org);
    onIn({
      org,
      actor: uuid(),
      role,
      orgName: orgName.trim() || "Default Workspace",
      tier,
      apiKey: tab === "apikey" && apiKey.trim() ? apiKey.trim() : undefined,
    });
  };

  return (
    <div className="signin">
      <Overlays />
      <div className="card narrow">
        <a className="brand" href="/" style={{ marginBottom: "var(--s-1)" }}><Logo />CORVEN</a>
        <h2 style={{ fontSize: "1.1rem", textTransform: "none", color: "var(--text)", margin: "0 0 4px" }}>
          Sign In to Operator Console
        </h2>
        <p className="muted" style={{ margin: "0 0 var(--s-3)", fontSize: "13px" }}>
          Autonomous AI incident containment and blast-radius governance.
        </p>

        <div className="tabs">
          <button
            type="button"
            className={`tab ${tab === "workspace" ? "active" : ""}`}
            onClick={() => setTab("workspace")}
          >
            Workspace Login
          </button>
          <button
            type="button"
            className={`tab ${tab === "apikey" ? "active" : ""}`}
            onClick={() => setTab("apikey")}
          >
            M2M API Token
          </button>
        </div>

        {tab === "workspace" ? (
          <>
            <label>
              Organization Name
              <input
                placeholder="Acme CyberSec Corp"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </label>
            <label>
              Organization ID (UUID)
              <div className="row">
                <input
                  className="mono"
                  value={org}
                  onChange={(e) => setOrg(e.target.value.trim())}
                />
                <button type="button" onClick={() => setOrg(uuid())}>Generate</button>
              </div>
            </label>
            <div className="row">
              <label style={{ flex: 1 }}>
                Role
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {(["admin", "operator", "approver", "viewer"] as Role[]).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label style={{ flex: 1 }}>
                Subscription Tier
                <select value={tier} onChange={(e) => setTier(e.target.value as any)}>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro ($299/mo)</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </label>
            </div>
          </>
        ) : (
          <>
            <label>
              M2M Service Token (x-api-key)
              <input
                className="mono"
                placeholder="crv_live_xxxxxxxxxxxxxxxx"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value.trim())}
              />
            </label>
            <div style={{ fontSize: "12px", color: "var(--text-3)", lineHeight: 1.4 }}>
              Used by autonomous CI/CD pipelines, agent orchestration runtimes, and Cloud SIEM integrations to authenticate machine-to-machine requests.
            </div>
          </>
        )}

        <button
          className="primary"
          style={{ marginTop: "var(--s-2)" }}
          disabled={tab === "workspace" ? !/^[0-9a-f-]{36}$/i.test(org) : !apiKey.trim()}
          onClick={handleSignIn}
        >
          {tab === "workspace" ? "Access Workspace" : "Authenticate M2M Token"}
        </button>

        <div className={`api ${up ? "ok" : "down"}`}>
          Control Plane API: {up === null ? "checking connection…" : up ? "connected (TLS / mTLS ready)" : "offline — verify backend process is active"}
        </div>
      </div>
    </div>
  );
}
