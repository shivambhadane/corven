"use client";

import { useState } from "react";
import Link from "next/link";
import { UserNav } from "@/components/UserNav";
import { short } from "@/lib/format";
import styles from "./dashboard.module.css";

const ACME_SWARM = [
  {
    name: "Support Agent",
    role: "Customer-facing LLM",
    model: "claude-3-5-sonnet",
    credentials: "Delegated JWT + OAuth",
    target: "Payments Gateway",
    status: "Healthy · Monitored",
    trust: "99.8%",
  },
  {
    name: "Payments Agent",
    role: "Financial Orchestrator",
    model: "gpt-4o-financial",
    credentials: "AWS IAM + Stripe Secret",
    target: "Banking API Rails",
    status: "Healthy · Zero Disruption",
    trust: "100%",
  },
  {
    name: "Settlement Agent",
    role: "On-Chain Worker",
    model: "deepseek-r1-escrow",
    credentials: "EVM Signer Key",
    target: "EvidenceAnchor.sol",
    status: "Healthy · Attested",
    trust: "99.9%",
  },
  {
    name: "Analytics Agent",
    role: "Telemetry Aggregator",
    model: "qwen-2.5-coder",
    credentials: "PostgreSQL Read-Only",
    target: "Metrics Vault",
    status: "Healthy · Isolated",
    trust: "99.4%",
  },
];

const EVIDENCE_RECORDS = [
  {
    incidentId: "inc_9f8a12e4b3",
    title: "Support Agent Credential Compromise",
    rootHash: "0x7d8a9e01f2bc3456789abcdef0123456789abcdef0123456789abcdef0123456",
    actionsCount: 3,
    arkivStatus: "Confirmed (Block #41289)",
    ethStatus: "Sealed On-Chain",
    disruption: "0% innocent paths broken",
  },
  {
    incidentId: "inc_3c1d44e8a1",
    title: "Payments Token Exfiltration Simulation",
    rootHash: "0x4b2c1a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1",
    actionsCount: 2,
    arkivStatus: "Confirmed (Block #41204)",
    ethStatus: "Sealed On-Chain",
    disruption: "0% innocent paths broken",
  },
];

export default function DashboardPage() {
  const [tab, setTab] = useState<"overview" | "swarm" | "evidence">("overview");
  const [simulating, setSimulating] = useState(false);
  const [simulationLog, setSimulationLog] = useState<string[]>([
    "✓ Graph engine initialized: 4 agents, 6 resources, 8 dependencies mapped.",
    "✓ Authorization gateway active: reverse proxies listening on port 3001.",
    "✓ Evidence service connected: Arkiv Rabdi SDK ready · Ethereum signer active.",
  ]);

  const handleSimulateCompromise = () => {
    setSimulating(true);
    setSimulationLog((prev) => [...prev, "🚨 Compromise event raised: Support Agent credential anomaly detected."]);
    setTimeout(() => {
      setSimulationLog((prev) => [
        ...prev,
        "🔍 Graph traversal: Tracing reachability tree across delegated payment tokens…",
      ]);
    }, 400);
    setTimeout(() => {
      setSimulationLog((prev) => [
        ...prev,
        "✂️ Minimum safe containment cut calculated: 2 actions required (0 innocent workflows broken).",
      ]);
    }, 850);
    setTimeout(() => {
      setSimulationLog((prev) => [
        ...prev,
        "🔒 Enforcement executed at Gateway: Token revoked · Support Agent isolated · Payments rails protected.",
        "⛓️ Cryptographic evidence anchored: Merkle root sealed on Ethereum and Arkiv.",
      ]);
      setSimulating(false);
    }, 1400);
  };

  return (
    <div className={styles.dashboardPage}>
      <div className={styles.topRule} aria-hidden="true" />

      <header className={styles.nav}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true" />
          CORVEN // Operator Console
        </Link>

        <nav className={styles.tabs} aria-label="Dashboard Views">
          <button
            type="button"
            className={`${styles.tab} ${tab === "overview" ? styles.tabActive : ""}`}
            onClick={() => setTab("overview")}
          >
            Incident Monitor &amp; Containment
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === "swarm" ? styles.tabActive : ""}`}
            onClick={() => setTab("swarm")}
          >
            Agent Swarm &amp; Topology
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === "evidence" ? styles.tabActive : ""}`}
            onClick={() => setTab("evidence")}
          >
            Evidence &amp; On-Chain Seals
          </button>
        </nav>

        <div className={styles.navRight}>
          <UserNav />
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.titleRow}>
          <div>
            <div className={styles.eyebrow}>Acme Corporation // Production Cluster</div>
            <h1 className={styles.pageTitle}>Incident Response &amp; Agent Topology</h1>
            <p className={styles.pageSubtitle}>
              Continuous dependency mapping, blast-radius graph traversal, plan-bound human approvals, and cryptographic evidence verification.
            </p>
          </div>
          <div>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleSimulateCompromise}
              disabled={simulating}
              style={{ background: "var(--red)", color: "#ffffff", borderColor: "var(--red)", fontWeight: 600 }}
            >
              {simulating ? "Analyzing Blast Radius…" : "⚡ Simulate Breach in Sandbox"}
            </button>
          </div>
        </div>

        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statVal}>4</span>
            <span className={styles.statLabel}>Monitored Agents</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statVal} style={{ color: "var(--red)" }}>
              {simulating ? "1 Active" : "0 Active"}
            </span>
            <span className={styles.statLabel}>Open Incidents</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statVal}>100%</span>
            <span className={styles.statLabel}>Containment Accuracy</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statVal}>0%</span>
            <span className={styles.statLabel}>Collateral Disruption</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statVal}>2 Confirmed</span>
            <span className={styles.statLabel}>Arkiv &amp; Eth Anchors</span>
          </div>
        </div>

        {tab === "overview" && (
          <div className={styles.mainGrid}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Live Containment Pipeline &amp; Telemetry</h2>
                <span className={styles.mono} style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Real-time Graph Traversal
                </span>
              </div>
              <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ background: "var(--paper)", border: "1px solid var(--line)", padding: "16px", borderRadius: "2px" }}>
                  <div className={styles.eyebrow} style={{ margin: "0 0 6px" }}>Pipeline Lifecycle</div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "12.5px" }}>
                    <span className={`${styles.badge} ${styles.badgeOk}`}>1 · Discovery</span>
                    <span className={`${styles.badge} ${simulating ? styles.badgeRed : styles.badgeOk}`}>2 · Blast Radius</span>
                    <span className={`${styles.badge} ${simulating ? styles.badgePending : styles.badgeOk}`}>3 · Containment Plan</span>
                    <span className={`${styles.badge} ${styles.badgeOk}`}>4 · Human Approval</span>
                    <span className={`${styles.badge} ${styles.badgeOk}`}>5 · Enforcement</span>
                    <span className={`${styles.badge} ${styles.badgeOk}`}>6 · Evidence Sealed</span>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className={styles.eyebrow}>Incident Response Execution Log</div>
                  <div style={{ background: "#0c0c0c", color: "#f1f1f1", padding: "16px", borderRadius: "2px", fontFamily: "var(--mono)", fontSize: "12.5px", lineHeight: "1.6", maxHeight: "280px", overflowY: "auto" }}>
                    {simulationLog.map((line, idx) => (
                      <div key={idx} style={{ color: line.includes("🚨") ? "#ff4d4f" : line.includes("✂️") ? "#faad14" : "#a6e22e" }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <div className={styles.side}>
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>Enforcement Gateways</h2>
                </div>
                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Payments Reverse Proxy</span>
                    <span className={`${styles.badge} ${styles.badgeOk}`}>Online · Enforcing</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Customer Support Token Bridge</span>
                    <span className={`${styles.badge} ${simulating ? styles.badgeRed : styles.badgeOk}`}>
                      {simulating ? "Isolated · Cut" : "Online · Monitored"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Database Credentials Vault</span>
                    <span className={`${styles.badge} ${styles.badgeOk}`}>Protected · 0% Impact</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Ethereum Smart Contract Anchor</span>
                    <span className={`${styles.badge} ${styles.badgeOk}`}>Ethereum Sepolia</span>
                  </div>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>System Invariant</h2>
                </div>
                <div style={{ padding: "16px", fontSize: "13.5px", color: "var(--muted)", lineHeight: "1.5" }}>
                  <strong style={{ color: "var(--ink)" }}>Minimum Safe Containment:</strong> Every containment plan is computed using the graph cut algorithm. It strictly severs reachable paths to the compromised entity without terminating dependent, healthy workflows.
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "swarm" && (
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Monitored Agent Swarm &amp; Dependencies</h2>
              <span className={styles.mono} style={{ fontSize: "12px", color: "var(--muted)" }}>
                4 Autonomous Entities
              </span>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Agent Name</th>
                  <th>Enterprise Role</th>
                  <th>LLM / Runtime Model</th>
                  <th>Delegated Credentials</th>
                  <th>Downstream Target</th>
                  <th>Health Status</th>
                </tr>
              </thead>
              <tbody>
                {ACME_SWARM.map((agent) => (
                  <tr key={agent.name}>
                    <td>
                      <strong>{agent.name}</strong>
                    </td>
                    <td>{agent.role}</td>
                    <td className={styles.mono}>{agent.model}</td>
                    <td className={styles.mono}>{agent.credentials}</td>
                    <td className={styles.mono}>{agent.target}</td>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeOk}`}>
                        {agent.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === "evidence" && (
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Cryptographic Evidence Vault &amp; Proofs</h2>
              <span className={styles.mono} style={{ fontSize: "12px", color: "var(--muted)" }}>
                Immutable Audit Trail
              </span>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Incident Identifier</th>
                  <th>Title / Summary</th>
                  <th>Merkle Root Hash</th>
                  <th>Containment Actions</th>
                  <th>Arkiv Decentralized Storage</th>
                  <th>Ethereum Anchor Status</th>
                </tr>
              </thead>
              <tbody>
                {EVIDENCE_RECORDS.map((record) => (
                  <tr key={record.incidentId}>
                    <td className={styles.mono}>
                      <strong>{record.incidentId}</strong>
                    </td>
                    <td>{record.title}</td>
                    <td className={styles.mono}>{short(record.rootHash, 10, 8)}</td>
                    <td className={styles.mono}>{record.actionsCount} revokes (0% disruption)</td>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeOk}`}>
                        {record.arkivStatus}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeOk}`}>
                        {record.ethStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
