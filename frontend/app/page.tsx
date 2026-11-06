import type { Metadata } from "next";
import Link from "next/link";
import { AgentLoop, GlobeMark, PixelBlocks, PixelRing, VerificationTopology } from "@/components/landing/Figures";
import { PlatformList } from "@/components/landing/PlatformList";
import styles from "@/components/landing/landing.module.css";

export const metadata: Metadata = {
  title: "CORVEN — Incident Response for Autonomous AI Agents",
  description:
    "Contain compromised autonomous AI agents with minimum safe authorization changes without disrupting healthy workflows. Verified with active probes and sealed on chain.",
};

const REPO = "https://github.com/shivambhadane/corven";
const doc = (path: string) => `${REPO}/blob/main/${path}`;

function Arrow() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function Eyebrow({ children, light = false }: { children: string; light?: boolean }) {
  return <p className={light ? `${styles.eyebrow} ${styles.eyebrowLight}` : styles.eyebrow}>{children}</p>;
}

export default function LandingPage() {
  return (
    <div className={styles.lp}>
      <div className={styles.topRule} aria-hidden="true" />

      <header className={styles.nav}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true" />
          CORVEN
        </Link>
        <nav className={styles.navLinks} aria-label="Sections">
          <a href="#how">Containment</a>
          <a href="#platform">Architecture</a>
          <a href="#agents">Agent Swarm</a>
          <a href="#build">Deployment</a>
        </nav>
        <div className={styles.navRight}>
          <a href={REPO} className={styles.navPlain} target="_blank" rel="noopener noreferrer">GitHub</a>
          <Link href="/login" className={styles.navPlain}>Login</Link>
          <Link href="/dashboard" className={styles.navOutline}>Dashboard <Arrow /></Link>
          <Link href="/dashboard" className={styles.navCta}>Launch Console <Arrow /></Link>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className={styles.hero}>
          <div className={styles.heroMain}>
            <Eyebrow>Cross-System Incident Response for Autonomous AI</Eyebrow>
            <h1 className={styles.heroTitle}>Contain compromised agents without breaking healthy workflows.</h1>
          </div>
          <div className={styles.heroSide}>
            <p className={styles.typed}>
              CORVEN INCIDENT RESPONSE <span className={styles.cursor}>_</span>
            </p>
            <div className={styles.heroSideBody}>
              <div className={styles.downArrows} aria-hidden="true">
                <span>↓</span>
                <span>↓</span>
                <span>↓</span>
              </div>
              <p className={styles.heroLede}>
                When an autonomous AI agent is breached, blind revocation causes catastrophic downtime. CORVEN traces
                real-time dependency graphs, calculates minimum safe containment, and proves isolation on-chain.
              </p>
              <div className={styles.buttons}>
                <Link href="/dashboard" className={styles.btnDark}>Launch Console <Arrow /></Link>
                <a href="#how" className={styles.btnOutline}>How it contains</a>
              </div>
            </div>
          </div>
        </section>

        <div className={styles.bandGlobe} role="img" aria-label="Red halftone globe">
          <GlobeMark />
        </div>

        {/* figure 01 */}
        <section className={styles.figure} id="how" aria-labelledby="how-title">
          <div className={styles.figHead}>
            <span>FIG. 01 — CONTAINMENT TOPOLOGY</span>
            <span>EVERY INCIDENT · PROVEN ISOLATION</span>
          </div>
          <h2 id="how-title" className={styles.srOnly}>How an incident is contained</h2>
          <div className={styles.figScroll}>
            <VerificationTopology />
          </div>
          <div className={styles.pillars}>
            <p><sup>01</sup>Directed Dependency Graph</p>
            <p><sup>02</sup>Minimum Safe Cut</p>
            <p><sup>03</sup>Cryptographic Evidence</p>
          </div>
        </section>

        <div className={styles.bandField}>
          <span className={styles.bandWord}>CONTAINED</span>
        </div>

        {/* built for */}
        <section className={styles.builtFor}>
          <PixelRing />
          <h2 className={styles.builtTitle}>Built for autonomous systems wired into production.</h2>
          <p className={styles.builtText}>
            When agents hold cloud credentials, database access, and delegated authority, CORVEN ensures one breach{" "}
            <span>does not take down your entire enterprise infrastructure.</span>
          </p>
          <span className={styles.dottedArrow} aria-hidden="true" />
          <div className={styles.builtCorners}>
            <span>INFRASTRUCTURE STACK</span>
            <span>PROVEN ON-CHAIN</span>
          </div>
        </section>
        <ul className={styles.stack} aria-label="Built with">
          {["TypeScript", "Fastify", "PostgreSQL", "Drizzle", "Foundry", "Arkiv", "Next.js", "Ethereum"].map((name) => (
            <li key={name} className={name === "Arkiv" || name === "Ethereum" ? styles.stackHot : undefined}>{name}</li>
          ))}
        </ul>

        {/* platform */}
        <section className={styles.platform} id="platform" aria-labelledby="platform-title">
          <Eyebrow light>The Architecture</Eyebrow>
          <h2 id="platform-title" className={styles.platformTitle}>The security fabric for autonomous agent networks.</h2>
          <div className={styles.platformBody}>
            <p className={styles.platformAside}>
              From the dependency registry to active gateway probes, CORVEN unifies blast-radius graph traversal,
              plan-bound human approvals, and tamper-evident evidence into one incident response layer.
            </p>
            <PlatformList />
          </div>
        </section>

        {/* latest */}
        <section className={styles.latest} aria-labelledby="latest-title">
          <Eyebrow>From the Architecture</Eyebrow>
          <h2 id="latest-title" className={styles.latestTitle}>The engines behind dependency-aware response.</h2>
          <div className={styles.cards}>
            <article>
              <p className={styles.cardTag}><span className={styles.cardIcon}>∑</span>Graph Engine</p>
              <h3>Deterministic Blast Radius Traversal.</h3>
              <p>Tarjan cycle detection and reachability analysis map every asset, credential, and downstream workflow the compromised agent can touch.</p>
              <a href={doc("docs/modules/graph-engine/README.md")}>Read engine spec <Arrow /></a>
            </article>
            <article>
              <p className={styles.cardTag}><span className={styles.cardIcon}>◇</span>Containment</p>
              <h3>Minimum Safe Cut Boundary.</h3>
              <p>Calculates the minimal set of authorization revokes that severs attack paths while guaranteeing 0% innocent workflow disruption.</p>
              <a href={doc("docs/modules/containment/README.md")}>How it contains <Arrow /></a>
            </article>
            <article>
              <p className={styles.cardTag}><span className={styles.cardIcon}>⌘</span>Evidence</p>
              <h3>Dual Arkiv &amp; Ethereum Anchoring.</h3>
              <p>Hash-chained incident audit logs sealed immutably on Arkiv decentralized storage and verified via Ethereum smart contracts.</p>
              <a href={doc("docs/modules/evidence/README.md")}>Evidence architecture <Arrow /></a>
            </article>
          </div>
        </section>

        <div className={styles.redBand} aria-hidden="true" />

        {/* agents */}
        <section className={styles.agents} id="agents" aria-labelledby="agents-title">
          <div className={styles.agentsHead}>
            <div>
              <Eyebrow>The Agent Swarm</Eyebrow>
              <h2 id="agents-title" className={styles.agentsTitle}>Acme Corporation Reference Swarm.</h2>
            </div>
            <div className={styles.agentsAside}>
              <p>
                Four interconnected autonomous agents holding cloud credentials, banking rails, and delegated tokens — simulated in our live incident benchmark.
              </p>
              <Link href="/dashboard" className={styles.btnOutlineDark}>Open Incident Console <Arrow /></Link>
            </div>
          </div>
          <div className={styles.figure2}>
            <div className={styles.figHead}>
              <span>FIG. 02 — INCIDENT RESPONSE LIFECYCLE</span>
              <span>AUTONOMOUS DISCOVERY · PLAN-BOUND APPROVAL · ON-CHAIN PROOF</span>
            </div>
            <AgentLoop />
          </div>
          <div className={styles.features}>
            <article><span>A01</span><h3>Support Agent</h3><p>Customer-facing LLM with delegated API credentials to downstream payment settlement.</p></article>
            <article><span>A02</span><h3>Payments Agent</h3><p>Financial orchestrator holding credentials to enterprise banking rails.</p></article>
            <article><span>A03</span><h3>Settlement Agent</h3><p>High-security escrow and smart contract execution worker.</p></article>
            <article><span>A04</span><h3>Analytics Agent</h3><p>Telemetry aggregator with read-only database grants and isolated audit trails.</p></article>
          </div>
        </section>

        {/* call to action */}
        <section className={styles.cta} id="build" aria-labelledby="cta-title">
          <div>
            <Eyebrow light>Production Ready</Eyebrow>
            <h2 id="cta-title" className={styles.ctaTitle}>Run the complete containment lifecycle locally.</h2>
            <p>
              One command boots PostgreSQL, applies schema migrations, starts the Fastify control plane, and launches the operator console.
            </p>
          </div>
          <div className={styles.buttons}>
            <Link href="/dashboard" className={styles.btnRed}>Launch Console <Arrow /></Link>
            <a href={REPO} className={styles.btnOutlineLight} target="_blank" rel="noopener noreferrer">Read the docs</a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerCard}>
          <div className={styles.footerBrand}>
            <span className={styles.logo}>
              <span className={styles.logoMark} aria-hidden="true" />
              CORVEN
            </span>
            <p>Infrastructure for Trusted Autonomous Systems.</p>
            <PixelBlocks />
          </div>
          <nav className={styles.footerCols} aria-label="Footer">
            <div>
              <h4>Product</h4>
              <Link href="/dashboard">Console</Link>
              <Link href="/dashboard">Incident Monitor</Link>
              <a href="#how">Containment</a>
            </div>
            <div>
              <h4>Modules</h4>
              <a href={`${REPO}/tree/main/apps/api/src/modules/graph-engine`}>Graph Engine</a>
              <a href={`${REPO}/tree/main/apps/api/src/modules/containment`}>Containment</a>
              <a href={`${REPO}/tree/main/apps/api/src/modules/authorization-gateway`}>Gateway</a>
              <a href={`${REPO}/tree/main/apps/api/src/modules/evidence`}>Evidence Service</a>
            </div>
            <div>
              <h4>Docs</h4>
              <a href={doc("docs/00-project-overview.md")}>Project Overview</a>
              <a href={doc("docs/01-problem-statement.md")}>Problem Statement</a>
              <a href={doc("docs/02-product-requirements.md")}>Requirements</a>
              <a href={doc("docs/03-use-cases.md")}>Use Cases</a>
            </div>
            <div>
              <h4>Project</h4>
              <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
            </div>
          </nav>
        </div>
        <p className={styles.wordmark} aria-hidden="true">CORVEN</p>
        <div className={styles.footerBar}>
          <span>© 2026 CORVEN</span>
          <span>ETHGlobal Mumbai 2026</span>
          <span>From Scratch Track</span>
          <span className={styles.footerBarRight}>Cross-System Containment Without Collateral Damage.</span>
        </div>
      </footer>
    </div>
  );
}
