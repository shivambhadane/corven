"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "./landing.css";

export default function LandingPage() {
  const [heroUrl, setHeroUrl] = useState("https://api.acme-ai.com/agents/v1/orchestrator");
  const [heroStatus, setHeroStatus] = useState("Ready to simulate: Instant blast-radius graph traversal and minimal containment cut.");
  const [simulating, setSimulating] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [sla, setSla] = useState("15m");

  const runSimulation = () => {
    setSimulating(true);
    setHeroStatus("Scanning topology & credentials…");
    setTimeout(() => {
      setHeroStatus("Graphing 28 dependent tools & IAM roles…");
    }, 400);
    setTimeout(() => {
      setHeroStatus("✓ Topology secure: Minimum safe cut boundary calculated (0 innocent paths affected).");
      setSimulating(false);
    }, 950);
  };

  return (
    <div className="corven-landing">
      {/* 1. TOP ANNOUNCEMENT BAR */}
      <aside className="top-bar" aria-label="Announcement">
        <span>Autonomous AI Incident Containment &amp; Dynamic Blast Radius Defense — Now in Public Beta</span>
        <a href="http://127.0.0.1:3000/app">Launch Operator Console &rarr;</a>
      </aside>

      {/* 2. NAVBAR */}
      <header className="nav">
        <div className="wrap nav-inner">
          <Link className="brand" href="/" aria-label="CORVEN home">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 2L3 8V16C3 23.5 8.5 28.5 16 30C23.5 28.5 29 23.5 29 16V8L16 2Z" fill="#0055ff"/>
              <path d="M16 7L8 11V16C8 20.8 11.4 24.2 16 25.5C20.6 24.2 24 20.8 24 16V11L16 7Z" fill="#ffffff" fillOpacity="0.25"/>
              <path d="M12 16L15 19L20 13" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>CORVEN</span>
          </Link>

          <nav className="nav-menu" aria-label="Primary">
            <a className="nav-link" href="#features">Product <span style={{ fontSize: "10px" }}>▾</span></a>
            <a className="nav-link" href="#enterprise">Resources <span style={{ fontSize: "10px" }}>▾</span></a>
            <a className="nav-link" href="#features">Solutions <span style={{ fontSize: "10px" }}>▾</span></a>
            <a className="nav-link" href="#enterprise">Pricing</a>
            <a className="nav-link" href="#partners">Partners</a>
          </nav>

          <div className="nav-actions">
            <a className="btn-login" href="http://127.0.0.1:3000/login">Login</a>
            <a className="btn-primary" href="http://127.0.0.1:3000/app">Get Started &rarr;</a>
          </div>
        </div>
      </header>

      <main>
        {/* 3. HERO SECTION WITH FLANKING ILLUSTRATIONS & INTERACTIVE CARD */}
        <section className="hero">
          <div className="wrap hero-wrapper">
            {/* Left Flanking Illustration */}
            <svg className="hero-art hero-art-left" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M70 70L120 40L170 70V170L120 200L70 170V70Z" fill="#0055ff"/>
              <path d="M70 70L120 40L170 70L120 100L70 70Z" fill="#4d88ff"/>
              <path d="M120 100L170 70V170L120 200V100Z" fill="#0043cc"/>
              <line x1="120" y1="40" x2="120" y2="10" stroke="#0055ff" strokeWidth="3" strokeLinecap="round"/>
              <circle cx="120" cy="8" r="4" fill="#0055ff"/>
              <line x1="95" y1="55" x2="70" y2="25" stroke="#0055ff" strokeWidth="2.5" strokeLinecap="round"/>
              <circle cx="68" cy="23" r="3" fill="#4d88ff"/>
              <rect x="85" y="115" width="22" height="4" rx="2" fill="#ffffff" opacity="0.8"/>
              <rect x="85" y="125" width="16" height="4" rx="2" fill="#ffffff" opacity="0.8"/>
              <rect x="85" y="135" width="20" height="4" rx="2" fill="#ffffff" opacity="0.8"/>
              <path d="M145 155C180 155 190 220 230 220" stroke="#0055ff" strokeWidth="3" strokeDasharray="4 4"/>
            </svg>

            {/* Center Content */}
            <div className="hero-content">
              <h1>24/7 AI Blast-Radius Containment for Autonomous Agents</h1>
              <p className="hero-subtitle">
                Adaptive incident isolation without breaking innocent workflows. CORVEN discovers agent dependencies, maps blast radius, and cuts attack paths before breaches spread.
              </p>

              {/* Interactive Input Card */}
              <div className="hero-input-card">
                <div className="hero-input-label">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0055ff" strokeWidth="2"><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="9"/></svg>
                  <span>Give us your agent endpoint, tool schema or repo URL to inspect:</span>
                </div>
                <input
                  className="hero-input-field"
                  type="text"
                  value={heroUrl}
                  onChange={(e) => setHeroUrl(e.target.value)}
                  placeholder="https://api.yourdomain.com/agents/..."
                />
                <div className="hero-input-actions">
                  <div className="hero-mode-pill">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0055ff" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    <span>Test in sandbox environment</span>
                  </div>
                  <button className="hero-btn-action" type="button" disabled={simulating} onClick={runSimulation}>
                    <span>{simulating ? "Scanning…" : "Simulate Incident"}</span>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </button>
                </div>
                <div style={{ marginTop: "10px", fontSize: "12px", color: heroStatus.includes("✓") ? "var(--ok)" : "var(--ink-3)", fontFamily: "var(--mono)", fontWeight: heroStatus.includes("✓") ? 600 : 400 }}>
                  {heroStatus}
                </div>
              </div>
            </div>

            {/* Right Flanking Illustration */}
            <svg className="hero-art hero-art-right" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M60 90L120 60L180 90L160 190L120 210L80 190L60 90Z" fill="#0055ff"/>
              <path d="M60 90L120 60L180 90L120 120L60 90Z" fill="#4d88ff"/>
              <path d="M120 120L180 90L160 190L120 210V120Z" fill="#0043cc"/>
              <line x1="120" y1="100" x2="160" y2="20" stroke="#0055ff" strokeWidth="4" strokeLinecap="round"/>
              <line x1="130" y1="105" x2="190" y2="35" stroke="#0055ff" strokeWidth="4" strokeLinecap="round"/>
              <circle cx="160" cy="20" r="5" fill="#4d88ff"/>
              <circle cx="190" cy="35" r="5" fill="#4d88ff"/>
              <path d="M100 145V165C100 172 120 178 120 178C120 178 140 172 140 165V145L120 138L100 145Z" fill="#ffffff" opacity="0.9"/>
            </svg>
          </div>
        </section>

        {/* 4. METRICS / SOCIAL PROOF TICKER STRIP */}
        <div className="metrics-ticker">
          <div className="wrap ticker-items">
            <div className="ticker-item"><span>🛡️ 10,000+ Agent Workflows Protected</span></div>
            <div className="ticker-dot" />
            <div className="ticker-item"><span>⚡ &lt; 120ms Containment Latency</span></div>
            <div className="ticker-dot" />
            <div className="ticker-item"><span>🔒 100% Cryptographic Audit Trail</span></div>
            <div className="ticker-dot" />
            <div className="ticker-item"><span>🎯 0% Innocent Workflows Disrupted</span></div>
            <div className="ticker-dot" />
            <div className="ticker-item"><span>🌐 99.99% Multi-Cloud SLA</span></div>
          </div>
        </div>

        {/* 5. CUSTOMER PROOF & 4x2 LOGO GRID */}
        <section className="proof-section">
          <div className="wrap proof-grid">
            <div className="proof-narrative">
              <h3>
                Thousands of security teams trust CORVEN to handle autonomous agent risk every shift — without a broken workflow or a missed attack.
              </h3>
              <a className="proof-link" href="#features">Read customer incident stories &rarr;</a>
            </div>

            <div className="logo-matrix">
              <div className="logo-box">
                <div className="logo-box-title">AWS IAM</div>
                <div className="logo-box-subtitle">Policy Isolation</div>
              </div>
              <div className="logo-box">
                <div className="logo-box-title">GitHub</div>
                <div className="logo-box-subtitle">Token Revocation</div>
              </div>
              <div className="logo-box">
                <div className="logo-box-title">Slack</div>
                <div className="logo-box-subtitle">Approval Bots</div>
              </div>
              <div className="logo-box">
                <div className="logo-box-title">Datadog</div>
                <div className="logo-box-subtitle">SIEM Streaming</div>
              </div>
              <div className="logo-box">
                <div className="logo-box-title">Anthropic</div>
                <div className="logo-box-subtitle">Model Safety</div>
              </div>
              <div className="logo-box">
                <div className="logo-box-title">OpenAI</div>
                <div className="logo-box-subtitle">API Governance</div>
              </div>
              <div className="logo-box">
                <div className="logo-box-title">CrowdStrike</div>
                <div className="logo-box-subtitle">EDR Containment</div>
              </div>
              <div className="logo-box">
                <div className="logo-box-title">Ethereum</div>
                <div className="logo-box-subtitle">Arkiv Anchors</div>
              </div>
            </div>
          </div>
        </section>

        {/* 6. FEATURE SPLIT SECTION 1 (99% ACCURACY) */}
        <section className="split-section" id="features">
          <div className="wrap split-container">
            <div className="split-text">
              <h2>Contain Every Breach with 99.9% Accuracy</h2>
              <p className="lead">
                CORVEN stops compromised agents in real time by isolating permissions, cutting tokens, and freezing affected resources — while innocent agents keep operating without disruption.
              </p>
              <ul className="split-checklist">
                <li>
                  <div className="check-icon">✓</div>
                  <span>Sub-second blast radius mapping across multi-cloud IAM and vector databases</span>
                </li>
                <li>
                  <div className="check-icon">✓</div>
                  <span>Minimum safe cut calculation preserves non-malicious agent workflows</span>
                </li>
                <li>
                  <div className="check-icon">✓</div>
                  <span>Multi-modal policy engine with deterministic human approval gates</span>
                </li>
                <li>
                  <div className="check-icon">✓</div>
                  <span>Real-time EVM smart contract and Arkiv evidence anchoring</span>
                </li>
              </ul>
              <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                <a className="btn-primary" href="http://127.0.0.1:3000/app">See Containment Engine &rarr;</a>
                <a className="btn-outline" href="#faq">Contact Us</a>
              </div>
            </div>

            <div className="blue-card-container">
              <div className="floating-card">
                <div className="floating-card-header">
                  <span className="floating-card-title">Agent: data-fetcher-04</span>
                  <span className="floating-tag tag-crit">Compromised</span>
                </div>
                <div className="floating-card-details">
                  <span>Target: AWS S3 PII Bucket</span>
                  <b style={{ color: "var(--crit)" }}>Token Revoked ($0 breach)</b>
                </div>
              </div>

              <div className="floating-card">
                <div className="floating-card-header">
                  <span className="floating-card-title">Workflow: payment-settlement</span>
                  <span className="floating-tag tag-ok">Contained</span>
                </div>
                <div className="floating-card-details">
                  <span>Safe Paths: Preserved (3/3)</span>
                  <b style={{ color: "var(--ok)" }}>Execution Time: 42ms</b>
                </div>
              </div>

              <div className="floating-card">
                <div className="floating-card-header">
                  <span className="floating-card-title">Evidence Anchor: 0x7b9c...f4a2</span>
                  <span className="floating-tag tag-blue">On-Chain Sealed</span>
                </div>
                <div className="floating-card-details">
                  <span>Block: #218491 (Ethereum)</span>
                  <b>Verifier: Arkiv Rabdi</b>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. THREE-CARD GRID */}
        <section className="features-section">
          <div className="wrap">
            <div className="section-header-split">
              <h2>One Security Fabric for Every Way Agents Execute</h2>
              <p>
                From autonomous tool-calling to multi-agent swarms and continuous CI/CD pipelines, CORVEN safeguards your entire autonomous stack.
              </p>
            </div>

            <div className="three-cards-grid">
              <article className="feature-card-item">
                <div className="feature-card-art">
                  <svg viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M40 70L80 45L120 70L80 95L40 70Z" fill="#0055ff"/>
                    <path d="M80 45L120 70V85L80 60V45Z" fill="#003db3"/>
                    <path d="M40 70L80 95V105L40 80V70Z" fill="#4d88ff"/>
                    <path d="M45 45C45 35 115 35 115 45L105 55L95 50L65 50L55 55L45 45Z" fill="#0055ff"/>
                    <circle cx="80" cy="70" r="12" fill="#ffffff" opacity="0.3"/>
                  </svg>
                </div>
                <h3>Tool &amp; API Calls</h3>
                <p style={{ color: "var(--ink-2)", fontSize: "14px", lineHeight: "1.5" }}>
                  Inspect and isolate rogue tool calls, database queries, and vector store extractions before unauthorized writes occur.
                </p>
                <a className="feature-card-link" href="http://127.0.0.1:3000/app">See capabilities &rarr;</a>
              </article>

              <article className="feature-card-item">
                <div className="feature-card-art">
                  <svg viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M30 65L80 35L130 65L80 95L30 65Z" fill="#0055ff"/>
                    <path d="M80 35L130 65V78L80 48V35Z" fill="#003db3"/>
                    <path d="M30 65L80 95V108L30 78V65Z" fill="#4d88ff"/>
                    <polygon points="60,52 80,40 100,52 80,64" fill="#ffffff" opacity="0.8"/>
                    <circle cx="45" cy="85" r="8" fill="#111317"/>
                    <circle cx="115" cy="85" r="8" fill="#111317"/>
                  </svg>
                </div>
                <h3>Agent-to-Agent Swarms</h3>
                <p style={{ color: "var(--ink-2)", fontSize: "14px", lineHeight: "1.5" }}>
                  Track inter-agent delegation protocols, prevent prompt injection contagion, and cut malicious peer connections instantly.
                </p>
                <a className="feature-card-link" href="http://127.0.0.1:3000/app">See workflow &rarr;</a>
              </article>

              <article className="feature-card-item">
                <div className="feature-card-art">
                  <svg viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="65" y="60" width="30" height="50" fill="#003db3"/>
                    <path d="M50 40L110 40L100 65L60 65Z" fill="#0055ff"/>
                    <rect x="58" y="44" width="44" height="16" rx="2" fill="#ffffff" opacity="0.9"/>
                    <circle cx="35" cy="55" r="6" fill="#0055ff"/>
                    <path d="M28 85C28 72 42 72 42 85" fill="#0055ff"/>
                  </svg>
                </div>
                <h3>Cloud &amp; CI/CD Pipelines</h3>
                <p style={{ color: "var(--ink-2)", fontSize: "14px", lineHeight: "1.5" }}>
                  Prevent poisoned prompts in GitHub Actions, Kubernetes pods, and autonomous cloud deployments from escalating privileges.
                </p>
                <a className="feature-card-link" href="http://127.0.0.1:3000/app">See docs &rarr;</a>
              </article>
            </div>
          </div>
        </section>

        {/* 8. ROYAL BLUE RADAR/WAVE FEATURE BANNER */}
        <div className="wrap">
          <section className="radar-banner">
            <div className="radar-col-left">
              <h3>Govern agent permissions dynamically.</h3>
              <p>
                Continuous dependency graph tracking ensures least-privilege boundary enforcement across every autonomous agent action.
              </p>
            </div>

            <div className="radar-col-center">
              <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <circle cx="100" cy="100" r="90" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeDasharray="4 4"/>
                <circle cx="100" cy="100" r="65" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5"/>
                <circle cx="100" cy="100" r="40" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"/>
                <circle cx="100" cy="100" r="10" fill="#ffffff"/>
                <circle cx="100" cy="35" r="6" fill="#10b981"/>
                <circle cx="145" cy="55" r="5" fill="#10b981"/>
                <circle cx="165" cy="100" r="7" fill="#10b981"/>
                <circle cx="140" cy="150" r="6" fill="#10b981"/>
                <circle cx="100" cy="165" r="6" fill="#10b981"/>
                <circle cx="55" cy="140" r="6" fill="#10b981"/>
                <circle cx="35" cy="100" r="7" fill="#ef4444"/>
                <line x1="100" y1="100" x2="35" y2="100" stroke="#ef4444" strokeWidth="2" strokeDasharray="4 4"/>
              </svg>
            </div>

            <div className="radar-col-right">
              <p>
                Allow security teams to inspect, simulate, or approve incident cuts with complete confidence.
              </p>
              <a className="btn-white" href="http://127.0.0.1:3000/app">Launch Visualizer &rarr;</a>
            </div>
          </section>
        </div>

        {/* 9. INTEGRATION STRIP SECTION */}
        <section className="integration-section">
          <div className="wrap">
            <div className="section-header-split" style={{ marginBottom: "32px" }}>
              <h2>Seamless Integration with Your Security Stack</h2>
              <p>
                Plug into your existing stack in minutes. CORVEN connects with leading cloud providers, secret managers, and SIEM platforms.
              </p>
            </div>

            <div className="integration-ribbon">
              <div className="integration-logos">
                <div className="integration-logo-item">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#0055ff"><path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/></svg>
                  <span>AWS Cloud</span>
                </div>
                <div className="integration-logo-item">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#111317"><circle cx="12" cy="12" r="10"/></svg>
                  <span>GitHub</span>
                </div>
                <div className="integration-logo-item">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#4a154b"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>
                  <span>Slack</span>
                </div>
                <div className="integration-logo-item">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#632ca6"><polygon points="12,2 22,22 2,22"/></svg>
                  <span>Datadog</span>
                </div>
                <div className="integration-logo-item">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#007dc1"><circle cx="12" cy="12" r="8"/></svg>
                  <span>Okta</span>
                </div>
                <div className="integration-logo-item">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#326ce5"><circle cx="12" cy="12" r="9"/></svg>
                  <span>Kubernetes</span>
                </div>
              </div>
              <div className="integration-pill">+ All Major Cloud, Identity &amp; Model Providers</div>
            </div>
          </div>
        </section>

        {/* 10. FEATURE SPLIT SECTION 3 */}
        <section className="split-section" style={{ background: "var(--surface)" }}>
          <div className="wrap split-container">
            <div className="split-text">
              <h2>Never Miss a Breach with Always-On Threat Detection</h2>
              <p className="lead">
                Continuous dependency graphing monitors every credential exchange and resource access in real time. If an agent goes rogue, containment is triggered in under 120 milliseconds.
              </p>
              <a className="btn-primary" href="http://127.0.0.1:3000/app">Simulate Live Incident &rarr;</a>

              <div style={{ background: "#ffffff", border: "1px solid var(--hair)", borderRadius: "12px", padding: "20px 24px", marginTop: "32px", display: "flex", gap: "28px" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--ink-3)", textTransform: "uppercase", fontWeight: 600 }}>Monitored Agents</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--ink)" }}>4,820</div>
                </div>
                <div style={{ borderLeft: "1px solid var(--hair)", paddingLeft: "28px" }}>
                  <div style={{ fontSize: "12px", color: "var(--ink-3)", textTransform: "uppercase", fontWeight: 600 }}>Average Mitigation</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--ok)" }}>&lt; 84ms</div>
                </div>
                <div style={{ borderLeft: "1px solid var(--hair)", paddingLeft: "28px" }}>
                  <div style={{ fontSize: "12px", color: "var(--ink-3)", textTransform: "uppercase", fontWeight: 600 }}>Saved Impact</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--blue)" }}>$4.2M</div>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div style={{ background: "#ffffff", border: "1px solid var(--hair)", borderRadius: "var(--r-md)", padding: "24px 20px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "8px" }}>Pre-Incident</div>
                <h4 style={{ marginBottom: "12px" }}>Active Baseline</h4>
                <div style={{ fontSize: "13px", color: "var(--ink-2)", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div>• Active Roles: 18</div>
                  <div>• Shared Keys: 4</div>
                  <div>• Healthy Latency: 18ms</div>
                </div>
              </div>

              <div style={{ background: "#ffffff", border: "1px solid #c7d9ff", borderRadius: "var(--r-md)", padding: "24px 20px", boxShadow: "var(--shadow-md)" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ok)", textTransform: "uppercase", marginBottom: "8px" }}>Post-Cut</div>
                <h4 style={{ marginBottom: "12px" }}>Contained State</h4>
                <div style={{ fontSize: "13px", color: "var(--ink-2)", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ color: "var(--crit)", fontWeight: 600 }}>• Cut Edge: data-agent &rarr; pii</div>
                  <div style={{ color: "var(--ok)", fontWeight: 600 }}>• Innocent Traffic: 100%</div>
                  <div>• Verified: Signed by Arkiv</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 11. ROYAL BLUE PROCESS CARD */}
        <div className="wrap">
          <section className="process-banner">
            <div className="process-content">
              <h2>Behind the Defense. How CORVEN Works.</h2>
              <ul className="process-steps">
                <li>
                  <span>①</span>
                  <div><b>Autonomous Discovery:</b> Continuously auto-discovers agents, credentials, and downstream resources across clouds.</div>
                </li>
                <li>
                  <span>②</span>
                  <div><b>Real-Time Blast Radius:</b> Calculates dynamic reachability via Tarjan graph cycles and reachability algorithms.</div>
                </li>
                <li>
                  <span>③</span>
                  <div><b>Plan-Bound Human Approval:</b> Operator signs off on exact cryptographic cut boundaries with zero panic or over-reach.</div>
                </li>
                <li>
                  <span>④</span>
                  <div><b>Multi-Cloud Enforcement &amp; Proof:</b> Dispatches atomic cuts and anchors tamper-evident cryptographic proof on Ethereum.</div>
                </li>
              </ul>
              <a className="btn-white" href="http://127.0.0.1:3000/app">Read Architecture Whitepaper &rarr;</a>
            </div>
          </section>
        </div>

        {/* 12. ENTERPRISE DARK CARD */}
        <section className="enterprise-section" id="enterprise">
          <div className="wrap">
            <div className="dark-enterprise-card">
              <div className="dark-card-header">
                <h2>CORVEN for Enterprise</h2>
                <select
                  className="sla-dropdown"
                  value={sla}
                  onChange={(e) => setSla(e.target.value)}
                  aria-label="SLA Option"
                >
                  <option value="15m">Guaranteed 15m Response SLA</option>
                  <option value="1h">1-Hour Standard Cloud SLA</option>
                  <option value="custom">Custom Dedicated Incident Bridge</option>
                </select>
              </div>

              <div className="dark-card-grid">
                <div className="dark-grid-item">
                  <div className="dark-grid-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  </div>
                  <h4>Single-Tenant Private VPC</h4>
                  <p>Dedicated control plane and storage. Zero multi-tenant data sharing, with custom KMS encryption keys managed by your security team.</p>
                </div>

                <div className="dark-grid-item">
                  <div className="dark-grid-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"/><path d="M18 8l4 4-4 4"/><path d="M8 12h14"/></svg>
                  </div>
                  <h4>Custom Connectors &amp; SIEM</h4>
                  <p>Bi-directional webhooks and native ingestion for Splunk, Datadog Cloud SIEM, CrowdStrike Falcon, and Jira Enterprise incident queues.</p>
                </div>

                <div className="dark-grid-item">
                  <div className="dark-grid-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  <h4>Dedicated Incident Architect</h4>
                  <p>
                    {sla === "15m" && "15-minute guaranteed incident containment SLA with direct PagerDuty / Slack escalation and named support leads."}
                    {sla === "1h" && "1-hour standard cloud containment response SLA with automated multi-cloud fallback isolation."}
                    {sla === "custom" && "Custom dedicated incident bridge with dedicated security engineer on call 24/7/365."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 13. PARTNERSHIP SECTION */}
        <section className="partner-section" id="partners">
          <div className="wrap partner-container">
            <div className="partner-left">
              <h2>Partner with CORVEN</h2>
              <p>
                Expand your cyber-defense offering with autonomous agent containment technology. We partner with MSSPs, cloud security consultancies, and AI platforms.
              </p>
              <a className="btn-primary" href="#faq">Become a Partner &rarr;</a>
            </div>

            <div className="partner-2x2-grid">
              <div className="partner-grid-box">
                <div className="partner-box-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <h4>Co-Sell &amp; Marketplace</h4>
                <p>Direct AWS &amp; Azure marketplace listings with unified cloud billing.</p>
              </div>

              <div className="partner-grid-box">
                <div className="partner-box-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20"/></svg>
                </div>
                <h4>Scale Across Client Fleets</h4>
                <p>Manage multi-tenant containment policies through a single pane of glass.</p>
              </div>

              <div className="partner-grid-box">
                <div className="partner-box-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </div>
                <h4>Dedicated Partner Lead</h4>
                <p>Direct access to security research leads and roadmap feature prioritization.</p>
              </div>

              <div className="partner-grid-box">
                <div className="partner-box-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </div>
                <h4>Joint Incident Playbooks</h4>
                <p>Pre-packaged response playbooks for agent-based financial and medical applications.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 14. RESEARCH BANNER */}
        <div className="wrap">
          <section className="research-banner">
            <div className="research-info">
              <h3>CORVEN Security Research</h3>
              <p>
                Benchmarking autonomous agent vulnerabilities, prompt injection propagation, and graph containment strategies.
              </p>
            </div>
            <a className="btn-white" href="#faq">Read Research Papers &rarr;</a>
          </section>
        </div>

        {/* 15. FAQ ACCORDION SECTION */}
        <section className="faq-section" id="faq">
          <div className="wrap">
            <h2>Questions we can answer</h2>
            <div className="faq-accordion">
              {[
                {
                  q: "What is autonomous blast-radius containment, and how does it protect my stack?",
                  a: "Autonomous blast-radius containment is the process of mapping what a compromised agent or credential can reach, calculating the minimum set of dependencies to sever, and executing those cuts before attackers can move laterally. Unlike whole-system shutdowns, CORVEN keeps innocent agents and healthy business operations running smoothly.",
                },
                {
                  q: "How quickly can CORVEN isolate a compromised agent without killing healthy jobs?",
                  a: "CORVEN calculates containment boundaries in under 25 milliseconds and enforces cuts across cloud IAM, GitHub app tokens, and API gateways in under 120 milliseconds. Because decisions are calculated over immutable graph snapshots, only the malicious edge is severed.",
                },
                {
                  q: "Does CORVEN work with our current cloud and identity providers?",
                  a: "Yes. CORVEN provides turn-key connectors for AWS IAM, GitHub App Tokens, Slack Approval Gating, Kubernetes Pod policies, and leading identity systems like Okta.",
                },
                {
                  q: "How does on-chain cryptographic evidence anchoring prevent audit tampering?",
                  a: "Every incident record, proposed containment cut, human approval signature, and verification output is SHA-256 hashed into an append-only chain. That chain root is anchored onto EVM blockchains and Arkiv, ensuring complete mathematical proof of non-repudiation.",
                },
                {
                  q: "Can we run CORVEN in our private VPC or on-prem environment?",
                  a: "Yes. For Enterprise tier customers, CORVEN can be deployed into single-tenant AWS or Azure VPCs or fully on-premises with customer-managed cryptographic keys and private model integrations.",
                },
              ].map((item, idx) => (
                <div key={idx} className={`faq-item ${openFaq === idx ? "open" : ""}`}>
                  <button className="faq-question" type="button" onClick={() => setOpenFaq(openFaq === idx ? null : idx)}>
                    <span>{item.q}</span>
                    <span className="faq-icon">+</span>
                  </button>
                  <div className="faq-answer">{item.a}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 16. BOTTOM CTA BANNER */}
        <div className="wrap">
          <section className="bottom-cta-banner">
            <h2>Get started today with containment that protects your autonomous agents.</h2>
            <a className="btn-white" style={{ fontSize: "16px", padding: "12px 28px" }} href="http://127.0.0.1:3000/app">Launch Operator Console &rarr;</a>
          </section>
        </div>
      </main>

      {/* 17. FOOTER */}
      <footer className="footer">
        <div className="wrap">
          <div className="footer-grid">
            <div className="footer-brand">
              <Link className="brand" href="/">
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none"><path d="M16 2L3 8V16C3 23.5 8.5 28.5 16 30C23.5 28.5 29 23.5 29 16V8L16 2Z" fill="#0055ff"/><path d="M12 16L15 19L20 13" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round"/></svg>
                <span>CORVEN</span>
              </Link>
              <p>© 2026 CORVEN AI Inc. All Rights Reserved.</p>
              <div className="newsletter-form">
                <input className="newsletter-input" type="email" placeholder="Sign up for updates" />
                <button className="btn-primary" style={{ padding: "8px 14px", fontSize: "13px" }} type="button">Subscribe</button>
              </div>
            </div>

            <div className="footer-col">
              <h5>Company</h5>
              <ul>
                <li><a href="#features">About</a></li>
                <li><a href="#features">Customers</a></li>
                <li><a href="#partners">Partners</a></li>
                <li><a href="#enterprise">Careers</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <h5>Resources</h5>
              <ul>
                <li><a href="http://127.0.0.1:3000/app">Console</a></li>
                <li><a href="#faq">Documentation</a></li>
                <li><a href="#enterprise">Security Specs</a></li>
                <li><a href="#features">Status Page</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <h5>Legal</h5>
              <ul>
                <li><a href="#faq">Privacy Policy</a></li>
                <li><a href="#faq">Terms of Service</a></li>
                <li><a href="#enterprise">Compliance (SOC2)</a></li>
                <li><a href="#faq">Security Disclosure</a></li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <div>Continuous Incident Containment for Agent Fleets</div>
            <div style={{ display: "flex", gap: "18px" }}>
              <a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
              <a href="https://twitter.com" target="_blank" rel="noreferrer">Twitter / X</a>
              <a href="https://linkedin.com" target="_blank" rel="noreferrer">LinkedIn</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
